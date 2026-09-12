/**
 * LivingBarEffect — reusable "breathing liquid" effect for bars.
 *
 * Ein additiv getintetes Fenster der szenenweit geteilten {@link LivingFieldTexture} plus eine
 * optional pulsierende Aura. Genutzt von ArenaHUD, CenterHUD, AimSystem und den Overlays.
 *
 * Diese Datei hält außerdem die Farb- und Texturhelfer, die die Balken-Aufrufer gemeinsam nutzen
 * (`paletteFromColor`, `createGradientTexture`, `ensureLivingBarTextures`).
 */
import * as Phaser from 'phaser';
import { getGraphicsQualityController, getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { LivingBreathDriver } from '../effects/living/LivingBreathDriver';
import { LivingFieldTexture } from '../effects/living/LivingFieldTexture';
import { LIVING_FIELD_UNITS_PER_BAR_HEIGHT } from '../effects/living/livingFieldShader';
import { buildRoundedRectClipBands, type LivingBarRoundedClip, type LivingClipRect } from '../effects/living/livingClipGeometry';
import { addExternalGlow, removeExternalFx, type GlowHandle } from '../utils/phaserFx';

export type { LivingBarRoundedClip } from '../effects/living/livingClipGeometry';

// ── Public types ────────────────────────────────────────────────────────────

export interface LivingBarPalette {
  dark:  number;
  mid:   number;
  light: number;
}

// ── Colour helpers ──────────────────────────────────────────────────────────

export function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

export function rgbStr(hex: number, a = 1): string {
  const { r, g, b } = hexToRgb(hex);
  return a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

/** Derive a dark/mid/light palette from a single colour. */
export function paletteFromColor(color: number): LivingBarPalette {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return {
    dark:  (Math.round(r * 0.4) << 16) | (Math.round(g * 0.4) << 8) | Math.round(b * 0.4),
    mid:   (Math.round(r * 0.7) << 16) | (Math.round(g * 0.7) << 8) | Math.round(b * 0.7),
    light: color,
  };
}

// ── Shared textures ─────────────────────────────────────────────────────────

const TEX_BLOB = '_living_blob';

/**
 * Weicher Radialverlauf. Der Balkeneffekt selbst braucht ihn nur noch für die gebackene Aura;
 * einzelne unabhängige UI-/Gameplay-Effekte nutzen ihn weiter.
 */
export function ensureLivingBarTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX_BLOB)) return;
  const s = 20;
  const ct = scene.textures.createCanvas(TEX_BLOB, s, s)!;
  const ctx = ct.context;
  const half = s / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0,   'rgba(255,255,255,0.8)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.1)');
  grad.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  ct.refresh();
}

// ── Gradient texture factory ────────────────────────────────────────────────

/** Create (or re-create) a horizontal 3-stop gradient with glassy highlight. */
export function createGradientTexture(
  scene: Phaser.Scene, key: string,
  palette: LivingBarPalette, w: number, h: number,
): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const ct = scene.textures.createCanvas(key, w, h)!;
  const ctx = ct.context;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0,   rgbStr(palette.dark));
  grad.addColorStop(0.5, rgbStr(palette.mid));
  grad.addColorStop(1,   rgbStr(palette.light));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const topGrad = ctx.createLinearGradient(0, 0, 0, h);
  topGrad.addColorStop(0,   'rgba(255,255,255,0.3)');
  topGrad.addColorStop(0.4, 'rgba(255,255,255,0.05)');
  topGrad.addColorStop(0.6, 'rgba(0,0,0,0)');
  topGrad.addColorStop(1,   'rgba(0,0,0,0.15)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, w, h);
  ct.refresh();
}

// ── LivingBarEffect class ───────────────────────────────────────────────────

export type LivingBarSampling = 'bar' | 'compact';

export interface LivingBarEffectOpts {
  /** Vorhandenes Balkenbild fuer den konturgebundenen Shared-Glow. */
  glowTarget?: Phaser.GameObjects.Image;
  /** Set to 0 for screen-fixed HUD elements. Default: don't override. */
  scrollFactor?: number;
  /** Scales field alpha and glow strength. Default: 1.0 (full intensity). */
  intensity?: number;
  /** Default 'bar'; compact superimposes distinct windows of the same field. */
  sampling?: LivingBarSampling;
  /** Full shape in container-local coordinates, independent of the current fill rectangle. */
  clipShape?: LivingBarRoundedClip;
  /** Default true. Hidden UI owners should opt out until shown. */
  startActive?: boolean;
  /** Stable consumer identity, including when multiple nodes share local geometry and color. */
  variantKey?: string;
}

const COMPACT_SAMPLE_WEIGHTS = [1, 0.75, 0.55] as const;
const BAR_SAMPLE_WEIGHTS = [1] as const;

interface LivingFieldTile {
  readonly image: Phaser.GameObjects.Image;
  readonly bounds: LivingClipRect;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sampleWeight: number;
  readonly gradientLeft: number;
  readonly gradientRight: number;
  tintStart: number;
  tintEnd: number;
}

/**
 * Lebendiger Balken-Effekt für HUD, Menüs und Overlays.
 *
 * Der Effekt zeigt ein Fenster der szenenweit geteilten {@link LivingFieldTexture}: ein einziger
 * Shader-Quad rendert das Blob-Feld offscreen, jeder Balken ist danach nur noch ein additiv
 * getintetes `Image`. Eine zusätzliche Instanz kostet damit einen batchbaren Quad statt vieler
 * CPU-aktualisierter Partikel.
 *
 * Zwei Dinge, die beim Ändern zählen:
 * - Die Blobgröße hängt an der Balkenhöhe, nicht an der Balkenbreite: eine Balkenhöhe entspricht
 *   `LIVING_FIELD_UNITS_PER_BAR_HEIGHT` Feldeinheiten. Ein sehr breiter Balken wird deshalb aus
 *   mehreren Kacheln zusammengesetzt statt gestreckt — das Feld ist in X periodisch, die Kacheln
 *   stoßen nahtlos aneinander.
 * - Im `low`-Profil entsteht gar nichts: kein Image, keine Aura, keine Atem-Anmeldung. Ohne den
 *   Schalter bliebe sonst die Feldtextur für einen unsichtbaren Balken am Rendern.
 */
export class LivingBarEffect {
  breathAura: Phaser.GameObjects.Image | null = null;
  breathGlow: GlowHandle | null = null;

  private active: boolean;
  private destroyed = false;
  private readonly onContainerDestroy = () => this.destroy();
  private glowTarget: Phaser.GameObjects.Image | null;
  private enabled: boolean;
  private filterGlowEnabled: boolean;
  private readonly container: Phaser.GameObjects.Container;
  private readonly precedingSiblings: readonly Phaser.GameObjects.GameObject[];
  private readonly barHeight: number;
  private readonly barX: number;
  private readonly barY: number;
  private readonly fullWidth: number;
  private filledWidth: number;
  private readonly opts: LivingBarEffectOpts | undefined;
  private readonly baseIntensity: number;
  private readonly glowIntensity: number;
  private unsubscribeQuality: (() => void) | null = null;

  private field: LivingFieldTexture | null = null;
  private fieldActive = false;
  private breathDriver: LivingBreathDriver | null = null;
  private tiles: LivingFieldTile[] = [];
  /** Bildschirmpixel je Texturpixel. */
  private imageScale = 1;
  private energyIntensity = 0;

  constructor(
    private scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
    x: number, y: number, w: number, h: number,
    private palette: LivingBarPalette,
    opts?: LivingBarEffectOpts,
  ) {
    this.container = container;
    // Quality may destroy all field Images. Remember the surrounding authored objects so a
    // rebuild (including initially low quality) stays beneath later icons, text and borders.
    this.precedingSiblings = container.list.slice();
    this.active = opts?.startActive ?? true;
    this.barHeight = Number.isFinite(h) ? Math.max(1, h) : 1;
    this.barX = x;
    this.barY = y;
    this.fullWidth = Number.isFinite(w) ? Math.max(1, w) : 1;
    this.filledWidth = Number.isFinite(w) ? Math.max(0, w) : 0;
    this.opts = opts;
    this.baseIntensity = Phaser.Math.Clamp(opts?.intensity ?? 1, 0, 1);
    this.glowIntensity = opts?.intensity ?? 1;
    const qualityProfile = getGraphicsQualityProfile(scene);
    this.enabled = qualityProfile.livingBarEffects;
    this.filterGlowEnabled = qualityProfile.sharedGlow.enabled
      && qualityProfile.sharedGlow.importance.standard;
    this.glowTarget = opts?.glowTarget ?? null;
    this.container.once(Phaser.GameObjects.Events.DESTROY, this.onContainerDestroy);

    // Der Effekt muss auf Qualitaetswechsel zur Laufzeit reagieren: Die Instanzen leben so
    // lange wie ihr HUD-Element und wuerden sonst nach einem Wechsel von `low` auf `high`
    // dauerhaft abgeschaltet bleiben.
    this.unsubscribeQuality = getGraphicsQualityController(scene)?.subscribe((profile) => {
      const sharedGlowEnabled = profile.sharedGlow.enabled && profile.sharedGlow.importance.standard;
      const glowModeChanged = this.filterGlowEnabled !== sharedGlowEnabled;
      this.filterGlowEnabled = sharedGlowEnabled;
      this.applyEnabled(profile.livingBarEffects);
      if (glowModeChanged && this.enabled && this.active) this.rebuildGlowVisual();
    }) ?? null;

    if (this.enabled) {
      this.createTiles();
      this.syncPresentation();
    }
  }

  private applyEnabled(enabled: boolean): void {
    if (this.destroyed || this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.createTiles();
      this.syncPresentation();
      return;
    }
    this.removeGlowVisual();
    this.destroyTiles();
  }

  private createTiles(): void {
    if (this.field || this.destroyed) return;

    const rect = { x: this.barX, y: this.barY, width: this.fullWidth, height: this.barHeight };
    const bands = this.opts?.clipShape ? buildRoundedRectClipBands(this.opts.clipShape, rect) : [rect];
    if (!Number.isFinite(this.barX) || !Number.isFinite(this.barY) || bands.length === 0) return;

    const field = LivingFieldTexture.get(this.scene);
    // Ohne WebGL-Shader (Tests, exotische Kontexte) bleibt der Effekt still, statt einen
    // fehlenden Texturschluessel an `add.image` zu reichen.
    if (!field.isAvailable()) return;

    field.retain();
    this.field = field;

    const pixelsPerUnit = field.getPixelsPerUnit();
    this.imageScale = (this.barHeight / LIVING_FIELD_UNITS_PER_BAR_HEIGHT) / pixelsPerUnit;
    const textureWidth = field.getTextureWidth();
    const cropHeight = Math.min(
      field.getTextureHeight(),
      LIVING_FIELD_UNITS_PER_BAR_HEIGHT * pixelsPerUnit,
    );
    const verticalRange = Math.max(0, field.getTextureHeight() - cropHeight);
    const compact = this.opts?.sampling === 'compact';
    const weights = compact ? COMPACT_SAMPLE_WEIGHTS : BAR_SAMPLE_WEIGHTS;
    const keyHash = hashVariantKey(this.opts?.variantKey ?? '');
    const variation = variantFraction(this.barX, this.barY, this.palette.mid + keyHash);
    const sourceWidth = this.fullWidth / this.imageScale;
    let insertionIndex = 0;
    for (let index = this.precedingSiblings.length - 1; index >= 0; index -= 1) {
      const siblingIndex = this.container.getIndex(this.precedingSiblings[index]);
      if (siblingIndex >= 0) {
        insertionIndex = siblingIndex + 1;
        break;
      }
    }

    for (let sample = 0; sample < weights.length; sample += 1) {
      const cropTop = verticalRange * (sample === 0 ? variation
        : variantFraction(this.barX + sample * 37, this.barY, this.palette.mid + keyHash));
      // Fitting windows need no wrap; very shallow fills retain periodic X-tiling.
      const sourceRange = sourceWidth <= textureWidth ? textureWidth - sourceWidth : textureWidth;
      let sourceX = compact ? sourceRange * (sample + variation) / weights.length : 0;
      let covered = 0;
      while (covered < this.fullWidth) {
        const segmentWidth = Math.min(this.fullWidth - covered, (textureWidth - sourceX) * this.imageScale);
        const segmentLeft = this.barX + covered;
        const segmentRight = segmentLeft + segmentWidth;
        for (const band of bands) {
          const left = Math.max(band.x, segmentLeft);
          const right = Math.min(band.x + band.width, segmentRight);
          if (right <= left) continue;
          const sx = sourceX + (left - segmentLeft) / this.imageScale;
          const sy = cropTop + (band.y - this.barY) / this.imageScale;
          const image = this.scene.add.image(left - sx * this.imageScale, band.y - sy * this.imageScale, field.getTextureKey())
            .setOrigin(0, 0)
            .setScale(this.imageScale)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setVisible(false);
          if (this.opts?.scrollFactor !== undefined) image.setScrollFactor(this.opts.scrollFactor);
          this.container.addAt(image, insertionIndex++);
          this.tiles.push({
            image, sourceX: sx, sourceY: sy, sampleWeight: weights[sample],
            bounds: { x: left, y: band.y, width: right - left, height: band.height },
            gradientLeft: compact ? this.barX : segmentLeft,
            gradientRight: compact ? this.barX + this.fullWidth : segmentRight,
            tintStart: 0, tintEnd: 1,
          });
        }
        covered += segmentWidth;
        sourceX = 0;
      }
    }

    this.applyEnergyVisuals();
  }

  /**
   * Scale the existing living field for an energized state without adding another renderer.
   * The shared shader still supplies all moving structures; this only changes the tint/alpha of
   * the already visible field window and the existing shared glow.
   */
  setEnergyIntensity(intensity: number): void {
    if (this.destroyed) return;
    const next = Phaser.Math.Clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
    if (Math.abs(this.energyIntensity - next) < 0.001) return;
    this.energyIntensity = next;
    this.applyEnergyVisuals();
  }

  private applyEnergyVisuals(): void {
    const energy = this.energyIntensity;
    for (const tile of this.tiles) this.applyTileEnergy(tile);

    if (this.breathAura) {
      this.breathAura
        .setTint(energyTint(this.palette.mid, 0xffffff, energy * 0.65))
        .setAlpha(0.1 * this.glowIntensity * (1 + energy * 1.5));
      this.breathDriver?.register(
        this.breathAura,
        'alpha',
        0.08 * this.glowIntensity * (1 + energy * 1.5),
        0.2 * this.glowIntensity * (1 + energy * 1.5),
      );
    }
    if (this.breathGlow) {
      this.breathDriver?.register(
        this.breathGlow,
        'outerStrength',
        0,
        2.5 * this.glowIntensity * (1 + energy * 1.5),
      );
    }
  }

  /** Update the visible field region (call when bar fill changes). */
  setFilledWidth(w: number): void {
    const next = Number.isFinite(w) ? Math.max(0, w) : 0;
    if (this.destroyed || this.filledWidth === next) return;
    this.filledWidth = next;
    this.syncPresentation();
  }

  private applyTileEnergy(tile: LivingFieldTile): void {
    const energy = this.energyIntensity;
    const dark = energyTint(this.palette.dark, this.palette.light, energy * 0.28);
    const light = energyTint(this.palette.light, 0xffffff, energy * 0.72);
    const left = energyTint(dark, light, tile.tintStart);
    const right = energyTint(dark, light, tile.tintEnd);
    tile.image.setTint(left, right, left, right)
      .setAlpha(this.baseIntensity * (1 + energy * 0.2) * tile.sampleWeight);
  }

  private applyCrop(width: number): boolean {
    const fillRight = this.barX + width;
    let visible = false;
    for (const tile of this.tiles) {
      const right = Math.min(tile.bounds.x + tile.bounds.width, fillRight);
      if (right <= tile.bounds.x) {
        tile.image.setVisible(false);
        continue;
      }
      const gradientWidth = Math.min(fillRight, tile.gradientRight) - tile.gradientLeft;
      const tintStart = (tile.bounds.x - tile.gradientLeft) / gradientWidth;
      const tintEnd = (right - tile.gradientLeft) / gradientWidth;
      if (tile.tintStart !== tintStart || tile.tintEnd !== tintEnd) {
        tile.tintStart = tintStart;
        tile.tintEnd = tintEnd;
        this.applyTileEnergy(tile);
      }
      tile.image.setCrop(tile.sourceX, tile.sourceY,
        (right - tile.bounds.x) / this.imageScale, tile.bounds.height / this.imageScale);
      tile.image.setVisible(true);
      visible = true;
    }
    return visible;
  }

  private hideTiles(): void {
    for (const tile of this.tiles) tile.image.setVisible(false);
  }

  private setFieldActive(active: boolean): void {
    if (this.fieldActive === active) return;
    this.fieldActive = active;
    if (active) this.field?.activate();
    else this.field?.deactivate();
  }

  private syncPresentation(): void {
    const show = !this.destroyed && this.enabled && this.active && this.filledWidth > 4 && this.baseIntensity > 0;
    const visible = show && this.applyCrop(Math.min(this.filledWidth, this.fullWidth));
    if (!visible) this.hideTiles();
    this.setFieldActive(visible);
    if (visible) {
      this.ensureGlowVisual();
      this.syncAuraGeometry();
    } else this.removeGlowVisual();
  }

  private destroyTiles(): void {
    this.setFieldActive(false);
    for (const tile of this.tiles) tile.image.destroy();
    this.tiles = [];
    this.field?.release();
    this.field = null;
  }

  /** Pause the effect (field hidden, glow removed). */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.syncPresentation();
  }

  /** Resume the effect (field shown, glow added). */
  start(): void {
    if (this.destroyed || this.active) return;
    this.active = true;
    this.syncPresentation();
  }

  private rebuildGlowVisual(): void {
    this.removeGlowVisual();
    this.ensureGlowVisual();
  }

  /** High und medium nutzen den zentralen Shared-Glow; die Aura bleibt ein sicherer Fallback. */
  private ensureGlowVisual(): void {
    if (!this.fieldActive || !this.glowTarget) return;
    if (this.filterGlowEnabled) this.ensureFilterGlow();
    else this.ensureAura();
  }

  private ensureFilterGlow(): void {
    if (!this.glowTarget || this.breathGlow) return;
    const intensity = this.glowIntensity * (1 + this.energyIntensity * 1.5);
    this.breathGlow = addExternalGlow(this.glowTarget, this.palette.mid, 0, 0, false, 0.1, 6);
    if (!this.breathGlow) return;
    this.breathDriver = LivingBreathDriver.get(this.scene);
    this.breathDriver.register(this.breathGlow, 'outerStrength', 0, 2.5 * intensity);
  }

  private ensureAura(): void {
    if (!this.enabled) return;
    if (!this.glowTarget || this.breathAura || this.filledWidth <= 4) return;
    const energyScale = 1 + this.energyIntensity * 1.5;
    const intensity = this.glowIntensity;
    ensureLivingBarTextures(this.scene);
    this.breathAura = this.scene.add.image(0, 0, TEX_BLOB)
      .setTint(energyTint(this.palette.mid, 0xffffff, this.energyIntensity * 0.65))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.1 * intensity * energyScale);
    if (this.opts?.scrollFactor !== undefined) this.breathAura.setScrollFactor(this.opts.scrollFactor);
    this.container.addAt(this.breathAura, 0);
    this.syncAuraGeometry();
    this.breathDriver = LivingBreathDriver.get(this.scene);
    this.breathDriver.register(
      this.breathAura,
      'alpha',
      0.08 * intensity * energyScale,
      0.2 * intensity * energyScale,
    );
  }

  private syncAuraGeometry(): void {
    if (!this.breathAura) return;
    const width = Math.max(1, this.filledWidth);
    this.breathAura
      .setPosition(this.barX + width * 0.5, this.barY + this.barHeight * 0.5)
      .setDisplaySize(width + 16, this.barHeight * 3.2)
      .setVisible(this.active && width > 4);
  }

  private removeGlowVisual(): void {
    // Den Treiber nur anfassen, wenn wirklich etwas angemeldet war: sonst entstuende auf `low`
    // beim Aufraeumen noch ein Szenen-Update-Listener fuer einen Effekt, den es nie gab.
    if (!this.breathGlow && !this.breathAura) return;
    if (this.breathGlow && this.glowTarget) {
      this.breathDriver?.unregister(this.breathGlow);
      removeExternalFx(this.glowTarget, this.breathGlow);
      this.breathGlow = null;
    }
    if (this.breathAura) {
      this.breathDriver?.unregister(this.breathAura);
      this.breathAura.destroy();
      this.breathAura = null;
    }
    this.breathDriver = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.container.off(Phaser.GameObjects.Events.DESTROY, this.onContainerDestroy);
    this.unsubscribeQuality?.();
    this.unsubscribeQuality = null;
    this.stop();
    this.removeGlowVisual();
    this.destroyTiles();
  }
}

function hashVariantKey(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (Math.imul(hash, 31) + key.charCodeAt(index)) | 0;
  return hash;
}

/** Stabiler, aus der Balkengeometrie abgeleiteter Wert in [0, 1) für den Fensterversatz. */
function variantFraction(x: number, y: number, color: number): number {
  const mixed = Math.sin(x * 12.9898 + y * 78.233 + (color & 0xffff) * 0.0131) * 43758.5453;
  return mixed - Math.floor(mixed);
}

/** Lift the existing palette toward a brighter energized highlight without changing energy=0. */
function energyTint(color: number, target: number, amount: number): number {
  const t = Phaser.Math.Clamp(amount, 0, 1);
  const r = Math.round(((color >> 16) & 0xff) + ((((target >> 16) & 0xff) - ((color >> 16) & 0xff)) * t));
  const g = Math.round(((color >> 8) & 0xff) + ((((target >> 8) & 0xff) - ((color >> 8) & 0xff)) * t));
  const b = Math.round((color & 0xff) + (((target & 0xff) - (color & 0xff)) * t));
  return (r << 16) | (g << 8) | b;
}
