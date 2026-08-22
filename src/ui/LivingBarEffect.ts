/**
 * LivingBarEffect — reusable "breathing liquid" effect for bars.
 *
 * Ein additiv getintetes Fenster der szenenweit geteilten {@link LivingFieldTexture} plus eine
 * optional pulsierende Aura. Genutzt von ArenaHUD, CenterHUD, AimSystem und den Overlays.
 *
 * Diese Datei hält außerdem die Farb- und Texturhelfer, die die Balken-Aufrufer gemeinsam nutzen
 * (`paletteFromColor`, `createGradientTexture`, `ensureLivingBarTextures`, `rectZone`).
 */
import * as Phaser from 'phaser';
import { getGraphicsQualityController, getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { LivingBreathDriver } from '../effects/living/LivingBreathDriver';
import { LivingFieldTexture } from '../effects/living/LivingFieldTexture';
import { LIVING_FIELD_UNITS_PER_BAR_HEIGHT } from '../effects/living/livingFieldShader';
import { addExternalGlow, removeExternalFx, type GlowHandle } from '../utils/phaserFx';

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
 * die "energized"-Emitter in ArenaHUD und CenterHUD sowie einige Overlays nutzen ihn weiter.
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

// ── Emit-zone helper ────────────────────────────────────────────────────────

export function rectZone(x: number, y: number, w: number, h: number): {
  zone: Phaser.Geom.Rectangle;
  data: Phaser.Types.GameObjects.Particles.EmitZoneData;
} {
  const rect = new Phaser.Geom.Rectangle(x, y, w, h);
  return {
    zone: rect,
    data: randomEmitZoneData(rect as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource),
  };
}

export function randomEmitZoneData(
  source: Phaser.Types.GameObjects.Particles.RandomZoneSource,
): Phaser.Types.GameObjects.Particles.EmitZoneData {
  return { type: 'random', source } as unknown as Phaser.Types.GameObjects.Particles.EmitZoneData;
}

// ── LivingBarEffect class ───────────────────────────────────────────────────

export interface LivingBarEffectOpts {
  /** Vorhandenes Balkenbild; aktiviert Glow auf high und die gebackene Aura auf medium. */
  glowTarget?: Phaser.GameObjects.Image;
  /** Set to 0 for screen-fixed HUD elements. Default: don't override. */
  scrollFactor?: number;
  /** Scales particle alpha and glow strength (0–1). Default: 1.0 (full intensity). */
  intensity?: number;
}

/**
 * Lebendiger Balken-Effekt für HUD, Menüs und Overlays.
 *
 * Der Effekt zeigt ein Fenster der szenenweit geteilten {@link LivingFieldTexture}: ein einziger
 * Shader-Quad rendert das Blob-Feld offscreen, jeder Balken ist danach nur noch ein additiv
 * getintetes `Image`. Eine zusätzliche Instanz kostet damit einen batchbaren Quad statt zweier
 * Partikel-Emitter mit zusammen über hundert CPU-aktualisierten Partikeln.
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

  private active = true;
  private glowTarget: Phaser.GameObjects.Image | null;
  private enabled: boolean;
  private filterGlowEnabled: boolean;
  private readonly container: Phaser.GameObjects.Container;
  private readonly barHeight: number;
  private readonly barX: number;
  private readonly barY: number;
  private readonly fullWidth: number;
  private filledWidth: number;
  private readonly opts: LivingBarEffectOpts | undefined;
  private unsubscribeQuality: (() => void) | null = null;

  private field: LivingFieldTexture | null = null;
  private tiles: Phaser.GameObjects.Image[] = [];
  /** Bildschirmpixel je Texturpixel. */
  private imageScale = 1;
  /** Breite einer Kachel in Bildschirmpixeln. */
  private tileWidth = 1;
  private cropHeight = 1;
  private cropTop = 0;

  constructor(
    private scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
    x: number, y: number, w: number, h: number,
    private palette: LivingBarPalette,
    opts?: LivingBarEffectOpts,
  ) {
    this.container = container;
    this.barHeight = Math.max(1, h);
    this.barX = x;
    this.barY = y;
    this.fullWidth = Math.max(1, w);
    this.filledWidth = Math.max(0, w);
    this.opts = opts;
    const qualityProfile = getGraphicsQualityProfile(scene);
    this.enabled = qualityProfile.livingBarEffects;
    this.filterGlowEnabled = qualityProfile.externalDecorativeFilters;
    this.glowTarget = opts?.glowTarget ?? null;

    // Der Effekt muss auf Qualitaetswechsel zur Laufzeit reagieren: Die Instanzen leben so
    // lange wie ihr HUD-Element und wuerden sonst nach einem Wechsel von `low` auf `high`
    // dauerhaft abgeschaltet bleiben.
    this.unsubscribeQuality = getGraphicsQualityController(scene)?.subscribe((profile) => {
      const glowModeChanged = this.filterGlowEnabled !== profile.externalDecorativeFilters;
      this.filterGlowEnabled = profile.externalDecorativeFilters;
      this.applyEnabled(profile.livingBarEffects);
      if (glowModeChanged && this.enabled && this.active) this.rebuildGlowVisual();
    }) ?? null;

    if (this.enabled) {
      this.createTiles();
      this.setFilledWidth(this.filledWidth);
    }
  }

  private applyEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.createTiles();
      if (this.active) this.setFilledWidth(this.filledWidth);
      else {
        this.hideTiles();
        this.removeGlowVisual();
      }
      return;
    }
    this.removeGlowVisual();
    this.destroyTiles();
  }

  private createTiles(): void {
    if (this.tiles.length > 0) return;

    const field = LivingFieldTexture.get(this.scene);
    // Ohne WebGL-Shader (Tests, exotische Kontexte) bleibt der Effekt still, statt einen
    // fehlenden Texturschluessel an `add.image` zu reichen.
    if (!field.isAvailable()) return;

    field.retain();
    this.field = field;

    const pixelsPerUnit = field.getPixelsPerUnit();
    this.imageScale = (this.barHeight / LIVING_FIELD_UNITS_PER_BAR_HEIGHT) / pixelsPerUnit;
    this.tileWidth = field.getTextureWidth() * this.imageScale;
    this.cropHeight = Math.min(
      field.getTextureHeight(),
      LIVING_FIELD_UNITS_PER_BAR_HEIGHT * pixelsPerUnit,
    );
    // Der senkrechte Versatz ist die einzige Variation zwischen benachbarten Balken. Er ist
    // stetig und aus der Balkengeometrie abgeleitet, damit derselbe Balken nach einem
    // Qualitaetswechsel dasselbe Fenster zeigt.
    const verticalRange = Math.max(0, field.getTextureHeight() - this.cropHeight);
    this.cropTop = verticalRange * variantFraction(this.barX, this.barY, this.palette.mid);

    const intensity = Phaser.Math.Clamp(this.opts?.intensity ?? 1, 0, 1);
    const tileCount = Math.max(1, Math.ceil(this.fullWidth / this.tileWidth));

    for (let index = 0; index < tileCount; index += 1) {
      const tile = this.scene.add.image(0, 0, field.getTextureKey())
        .setOrigin(0, 0)
        .setScale(this.imageScale)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(intensity)
        .setVisible(false);
      // Eckweiser Tint bildet den dark→light-Verlauf ab, den die frueheren Partikel ueber ihre
      // Tint-Liste im Mittel erzeugt haben.
      tile.setTint(this.palette.dark, this.palette.light, this.palette.dark, this.palette.light);
      tile.setPosition(
        this.barX + index * this.tileWidth,
        this.barY - this.cropTop * this.imageScale,
      );
      if (this.opts?.scrollFactor !== undefined) tile.setScrollFactor(this.opts.scrollFactor);
      this.container.add(tile);
      this.tiles.push(tile);
    }

    this.ensureGlowVisual();
  }

  /** Update the visible field region (call when bar fill changes). */
  setFilledWidth(w: number): void {
    this.filledWidth = Math.max(0, w);

    if (w > 4 && this.active) {
      this.applyCrop(Math.min(this.filledWidth, this.fullWidth));
      this.ensureGlowVisual();
      this.syncAuraGeometry();
      return;
    }

    this.hideTiles();
    if (w <= 4) this.removeGlowVisual();
  }

  private applyCrop(width: number): void {
    if (this.tiles.length === 0 || this.imageScale <= 0) return;
    const textureWidth = this.field?.getTextureWidth() ?? 0;

    for (let index = 0; index < this.tiles.length; index += 1) {
      const tile = this.tiles[index];
      const covered = index * this.tileWidth;
      const remaining = width - covered;
      if (remaining <= 0) {
        tile.setVisible(false);
        continue;
      }
      const cropWidth = Math.min(textureWidth, remaining / this.imageScale);
      tile.setCrop(0, this.cropTop, cropWidth, this.cropHeight);
      tile.setVisible(true);
    }
  }

  private hideTiles(): void {
    for (const tile of this.tiles) tile.setVisible(false);
  }

  private destroyTiles(): void {
    for (const tile of this.tiles) tile.destroy();
    this.tiles = [];
    this.field?.release();
    this.field = null;
  }

  /** Pause the effect (field hidden, glow removed). */
  stop(): void {
    this.active = false;
    this.hideTiles();
    this.removeGlowVisual();
  }

  /** Resume the effect (field shown, glow added). */
  start(): void {
    this.active = true;
    if (this.filledWidth > 4) {
      this.applyCrop(Math.min(this.filledWidth, this.fullWidth));
      this.ensureGlowVisual();
      this.breathAura?.setVisible(true);
    }
  }

  private rebuildGlowVisual(): void {
    this.removeGlowVisual();
    this.ensureGlowVisual();
  }

  /** High erhaelt den urspruenglichen Filter-Glow; medium nutzt den guenstigen Textur-Fallback. */
  private ensureGlowVisual(): void {
    if (!this.enabled || !this.glowTarget || this.filledWidth <= 4) return;
    if (this.filterGlowEnabled) this.ensureFilterGlow();
    else this.ensureAura();
  }

  private ensureFilterGlow(): void {
    if (!this.glowTarget || this.breathGlow) return;
    const intensity = this.opts?.intensity ?? 1;
    this.breathGlow = addExternalGlow(this.glowTarget, this.palette.mid, 0, 0, false, 0.1, 6);
    if (!this.breathGlow) return;
    LivingBreathDriver.get(this.scene).register(this.breathGlow, 'outerStrength', 0, 2.5 * intensity);
  }

  private ensureAura(): void {
    if (!this.enabled) return;
    if (!this.glowTarget || this.breathAura || this.filledWidth <= 4) return;
    const intensity = this.opts?.intensity ?? 1;
    ensureLivingBarTextures(this.scene);
    this.breathAura = this.scene.add.image(0, 0, TEX_BLOB)
      .setTint(this.palette.mid)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.1 * intensity);
    if (this.opts?.scrollFactor !== undefined) this.breathAura.setScrollFactor(this.opts.scrollFactor);
    this.container.addAt(this.breathAura, 0);
    this.syncAuraGeometry();
    LivingBreathDriver.get(this.scene).register(this.breathAura, 'alpha', 0.08 * intensity, 0.2 * intensity);
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
    const breath = LivingBreathDriver.get(this.scene);
    if (this.breathGlow && this.glowTarget) {
      breath.unregister(this.breathGlow);
      removeExternalFx(this.glowTarget, this.breathGlow);
      this.breathGlow = null;
    }
    if (this.breathAura) {
      breath.unregister(this.breathAura);
      this.breathAura.destroy();
      this.breathAura = null;
    }
  }

  destroy(): void {
    this.unsubscribeQuality?.();
    this.unsubscribeQuality = null;
    this.stop();
    this.removeGlowVisual();
    this.destroyTiles();
  }
}

/** Stabiler, aus der Balkengeometrie abgeleiteter Wert in [0, 1) für den Fensterversatz. */
function variantFraction(x: number, y: number, color: number): number {
  const mixed = Math.sin(x * 12.9898 + y * 78.233 + (color & 0xffff) * 0.0131) * 43758.5453;
  return mixed - Math.floor(mixed);
}
