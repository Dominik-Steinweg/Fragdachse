/**
 * LivingBarEffect — reusable "breathing liquid" particle effect for bars.
 *
 * Two layers of slow, overlapping blob particles (additive blend) plus an
 * optional pulsing, pre-baked aura. Used by ArenaHUD, UtilityChargeIndicator,
 * and the lobby colour indicator.
 */
import * as Phaser from 'phaser';
import { getGraphicsQualityController, getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { killAllAndResetParticlePositions } from '../effects/EffectUtils';
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
const CORE_FREQUENCY_MS = 30;
const OUTER_FREQUENCY_MS = 36;
const CORE_PARTICLE_CAP = 52;
const OUTER_PARTICLE_CAP = 64;

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
 * Kostenhinweis: Jede Instanz erzeugt zwei begrenzte Emitter mit 28–33 Partikeln pro Sekunde
 * und animiert an jedem davon `scale` und `alpha` über die Lebenszeit. Wer den Effekt
 * vervielfacht (etwa je Upgrade-Knoten), vervielfacht diese Kosten weiterhin linear.
 *
 * Im `low`-Profil ist der Effekt vollständig abgeschaltet: Ohne den Schalter blieben zwar die
 * Partikel über `particleFactors.decorative` aus, die Emitter-Objekte und der Aura-Tween
 * liefen aber weiter.
 */
export class LivingBarEffect {
  idleCore:  Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  idleOuter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  readonly emitZone:  Phaser.Geom.Rectangle;

  breathAura: Phaser.GameObjects.Image | null = null;
  breathGlow: GlowHandle | null = null;
  breathTween: Phaser.Tweens.Tween | null = null;

  private active = true;
  private glowTarget: Phaser.GameObjects.Image | null;
  private enabled: boolean;
  private filterGlowEnabled: boolean;
  private readonly container: Phaser.GameObjects.Container;
  private readonly barHeight: number;
  private readonly barX: number;
  private readonly barY: number;
  private filledWidth: number;
  private readonly opts: LivingBarEffectOpts | undefined;
  private unsubscribeQuality: (() => void) | null = null;

  constructor(
    private scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
    x: number, y: number, w: number, h: number,
    private palette: LivingBarPalette,
    opts?: LivingBarEffectOpts,
  ) {
    this.container = container;
    this.barHeight = h;
    this.barX = x;
    this.barY = y;
    this.filledWidth = w;
    this.opts = opts;
    const qualityProfile = getGraphicsQualityProfile(scene);
    this.enabled = qualityProfile.livingBarEffects;
    this.filterGlowEnabled = qualityProfile.externalDecorativeFilters;
    this.glowTarget = opts?.glowTarget ?? null;
    // Die Zone wird auch im abgeschalteten Zustand gefuehrt: `setFilledWidth()` schreibt
    // weiterhin hinein, und die Aufrufer sollen keine Fallunterscheidung brauchen.
    this.emitZone = new Phaser.Geom.Rectangle(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2));

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
      this.createEmitters();
      this.setFilledWidth(this.filledWidth);
    }
  }

  private applyEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.createEmitters();
      if (this.active) this.setFilledWidth(this.filledWidth);
      else {
        this.stopEmitter(this.idleCore);
        this.stopEmitter(this.idleOuter);
        this.removeGlowVisual();
      }
      return;
    }
    this.removeGlowVisual();
    this.idleCore?.destroy();
    this.idleOuter?.destroy();
    this.idleCore = null;
    this.idleOuter = null;
  }

  private createEmitters(): void {
    const scene = this.scene;
    const container = this.container;
    const opts = this.opts;
    const palette = this.palette;
    const h = this.barHeight;

    ensureLivingBarTextures(scene);
    const intensity = opts?.intensity ?? 1.0;
    const zoneData = randomEmitZoneData(this.emitZone as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource);

    // Scale particle sizes relative to bar height (reference = 14px)
    const sf = Math.max(0.3, h / 14);

    this.idleCore = scene.add.particles(0, 0, TEX_BLOB, {
      lifespan:  { min: 1200, max: 1500 },
      frequency: CORE_FREQUENCY_MS,
      quantity:  1,
      maxAliveParticles: CORE_PARTICLE_CAP,
      reserve: CORE_PARTICLE_CAP,
      emitting: false,
      speedX:    { min: -2, max: 2 },
      speedY:    { min: -1, max: 1 },
      scale:     { start: 1.0 * sf, end: 0.4 * sf },
      alpha:     { start: 0.05 * intensity, end: 0.03 * intensity },
      tint:      [palette.mid, palette.dark, palette.light],
      blendMode: Phaser.BlendModes.ADD,
    });
    getGraphicsQualityController(scene)?.setEmitterImportance(this.idleCore, 'decorative');
    this.idleCore.addEmitZone(zoneData);
    if (opts?.scrollFactor !== undefined) this.idleCore.setScrollFactor(opts.scrollFactor);
    container.add(this.idleCore);

    this.idleOuter = scene.add.particles(0, 0, TEX_BLOB, {
      lifespan:  { min: 1000, max: 2500 },
      frequency: OUTER_FREQUENCY_MS,
      quantity:  1,
      maxAliveParticles: OUTER_PARTICLE_CAP,
      reserve: OUTER_PARTICLE_CAP,
      emitting: false,
      speedX:    { min: -1, max: 1 },
      speedY:    { min: -0.5, max: 0.5 },
      scale:     { start: 1.5 * sf, end: 0.7 * sf },
      alpha:     { start: 0.1 * intensity, end: 0.03 * intensity },
      tint:      [palette.dark, palette.mid],
      blendMode: Phaser.BlendModes.ADD,
    });
    getGraphicsQualityController(scene)?.setEmitterImportance(this.idleOuter, 'decorative');
    this.idleOuter.addEmitZone(zoneData);
    if (opts?.scrollFactor !== undefined) this.idleOuter.setScrollFactor(opts.scrollFactor);
    container.add(this.idleOuter);

    this.ensureGlowVisual();
  }

  /** Update the particle spawn region width (call when bar fill changes). */
  setFilledWidth(w: number): void {
    this.filledWidth = Math.max(0, w);
    if (w > 4) {
      this.emitZone.width = w - 2;
      if (this.active) {
        this.startEmitter(this.idleCore);
        this.startEmitter(this.idleOuter);
        this.ensureGlowVisual();
        this.syncAuraGeometry();
      }
    } else {
      this.emitZone.width = 0;
      this.stopEmitter(this.idleCore);
      this.stopEmitter(this.idleOuter);
      this.removeGlowVisual();
    }
  }

  /** Pause the effect (particles stop, glow removed). */
  stop(): void {
    this.active = false;
    this.stopEmitter(this.idleCore);
    this.stopEmitter(this.idleOuter);
    this.removeGlowVisual();
  }

  /** Resume the effect (particles start, glow added). */
  start(): void {
    this.active = true;
    if (this.emitZone.width > 2) {
      this.startEmitter(this.idleCore);
      this.startEmitter(this.idleOuter);
      this.ensureGlowVisual();
      this.breathAura?.setVisible(true);
      this.breathTween?.resume();
    }
  }

  private rebuildGlowVisual(): void {
    this.removeGlowVisual();
    this.ensureGlowVisual();
  }

  /** High erhaelt den urspruenglichen Filter-Glow; medium nutzt den guenstigen Textur-Fallback. */
  private ensureGlowVisual(): void {
    if (!this.enabled || !this.glowTarget || this.emitZone.width <= 2) return;
    if (this.filterGlowEnabled) this.ensureFilterGlow();
    else this.ensureAura();
  }

  private ensureFilterGlow(): void {
    if (!this.glowTarget || this.breathGlow) return;
    const intensity = this.opts?.intensity ?? 1;
    this.breathGlow = addExternalGlow(this.glowTarget, this.palette.mid, 0, 0, false, 0.1, 6);
    if (!this.breathGlow) return;
    this.breathTween = this.scene.tweens.add({
      targets: this.breathGlow,
      outerStrength: 2.5 * intensity,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private ensureAura(): void {
    if (!this.enabled) return;
    if (!this.glowTarget || this.breathAura || this.emitZone.width <= 2) return;
    const intensity = this.opts?.intensity ?? 1;
    this.breathAura = this.scene.add.image(0, 0, TEX_BLOB)
      .setTint(this.palette.mid)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.1 * intensity);
    if (this.opts?.scrollFactor !== undefined) this.breathAura.setScrollFactor(this.opts.scrollFactor);
    this.container.addAt(this.breathAura, 0);
    this.syncAuraGeometry();
    this.breathTween = this.scene.tweens.add({
      targets: this.breathAura,
      alpha: { from: 0.08 * intensity, to: 0.2 * intensity },
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private syncAuraGeometry(): void {
    if (!this.breathAura) return;
    const width = Math.max(1, this.filledWidth);
    this.breathAura
      .setPosition(this.barX + width * 0.5, this.barY + this.barHeight * 0.5)
      .setDisplaySize(width + 16, this.barHeight * 3.2)
      .setVisible(this.active && width > 4);
  }

  private startEmitter(emitter: Phaser.GameObjects.Particles.ParticleEmitter | null): void {
    if (!emitter) return;
    emitter.setActive(true);
    if (!emitter.emitting) emitter.start();
  }

  private stopEmitter(emitter: Phaser.GameObjects.Particles.ParticleEmitter | null): void {
    if (!emitter) return;
    if (!emitter.active && !emitter.emitting) return;
    emitter.stop();
    killAllAndResetParticlePositions(emitter);
    emitter.setActive(false);
  }

  private removeGlowVisual(): void {
    if (this.breathTween) {
      this.breathTween.destroy();
      this.breathTween = null;
    }
    if (this.breathGlow && this.glowTarget) {
      removeExternalFx(this.glowTarget, this.breathGlow);
      this.breathGlow = null;
    }
    this.breathAura?.destroy();
    this.breathAura = null;
  }

  destroy(): void {
    this.unsubscribeQuality?.();
    this.unsubscribeQuality = null;
    this.stop();
    this.removeGlowVisual();
    this.idleCore?.destroy();
    this.idleOuter?.destroy();
    this.idleCore = null;
    this.idleOuter = null;
  }
}
