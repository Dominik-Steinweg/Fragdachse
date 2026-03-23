/**
 * LivingBarEffect — reusable "breathing liquid" particle effect for bars.
 *
 * Two layers of slow, overlapping blob particles (additive blend) plus an
 * optional pulsing PostFX glow.  Used by ArenaHUD, UtilityChargeIndicator,
 * and the lobby colour indicator.
 */
import Phaser from 'phaser';

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
    data: { type: 'random', source: rect } as Phaser.Types.GameObjects.Particles.EmitZoneData,
  };
}

// ── LivingBarEffect class ───────────────────────────────────────────────────

export interface LivingBarEffectOpts {
  /** GameObject that supports postFX (Image, Sprite) for breathing glow. */
  glowTarget?: Phaser.GameObjects.Image;
  /** Set to 0 for screen-fixed HUD elements. Default: don't override. */
  scrollFactor?: number;
  /** Scales particle alpha and glow strength (0–1). Default: 1.0 (full intensity). */
  intensity?: number;
}

export class LivingBarEffect {
  readonly idleCore:  Phaser.GameObjects.Particles.ParticleEmitter;
  readonly idleOuter: Phaser.GameObjects.Particles.ParticleEmitter;
  readonly emitZone:  Phaser.Geom.Rectangle;

  breathGlow:  Phaser.FX.Glow | null = null;
  breathTween: Phaser.Tweens.Tween | null = null;

  private active = true;
  private glowTarget: Phaser.GameObjects.Image | null;

  constructor(
    private scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
    x: number, y: number, w: number, h: number,
    private palette: LivingBarPalette,
    opts?: LivingBarEffectOpts,
  ) {
    ensureLivingBarTextures(scene);
    this.glowTarget = opts?.glowTarget ?? null;
    const intensity = opts?.intensity ?? 1.0;

    // Shared emit zone
    this.emitZone = new Phaser.Geom.Rectangle(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2));
    const zoneData = { type: 'random', source: this.emitZone } as Phaser.Types.GameObjects.Particles.EmitZoneData;

    // Scale particle sizes relative to bar height (reference = 14px)
    const sf = Math.max(0.3, h / 14);

    this.idleCore = scene.add.particles(0, 0, TEX_BLOB, {
      lifespan:  { min: 1200, max: 1500 },
      frequency: 10,
      quantity:  1,
      speedX:    { min: -2, max: 2 },
      speedY:    { min: -1, max: 1 },
      scale:     { start: 1.0 * sf, end: 0.4 * sf },
      alpha:     { start: 0.05 * intensity, end: 0.03 * intensity },
      tint:      [palette.mid, palette.dark, palette.light],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    });
    this.idleCore.addEmitZone(zoneData);
    if (opts?.scrollFactor !== undefined) this.idleCore.setScrollFactor(opts.scrollFactor);
    container.add(this.idleCore);

    this.idleOuter = scene.add.particles(0, 0, TEX_BLOB, {
      lifespan:  { min: 1000, max: 2500 },
      frequency: 10,
      quantity:  1,
      speedX:    { min: -1, max: 1 },
      speedY:    { min: -0.5, max: 0.5 },
      scale:     { start: 1.5 * sf, end: 0.7 * sf },
      alpha:     { start: 0.1 * intensity, end: 0.03 * intensity },
      tint:      [palette.dark, palette.mid],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    });
    this.idleOuter.addEmitZone(zoneData);
    if (opts?.scrollFactor !== undefined) this.idleOuter.setScrollFactor(opts.scrollFactor);
    container.add(this.idleOuter);

    // PostFX breathing glow
    if (this.glowTarget) {
      this.breathGlow = this.glowTarget.postFX.addGlow(palette.mid, 0, 0, false, 0.1, 6);
      this.breathTween = scene.tweens.add({
        targets: this.breathGlow,
        outerStrength: 2.5 * intensity,
        duration: 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  /** Update the particle spawn region width (call when bar fill changes). */
  setFilledWidth(w: number): void {
    if (w > 4) {
      this.emitZone.width = w - 2;
      if (this.active) {
        if (!this.idleCore.emitting) this.idleCore.start();
        if (!this.idleOuter.emitting) this.idleOuter.start();
        this.ensureGlow();
      }
    } else {
      this.emitZone.width = 0;
      this.idleCore.stop();
      this.idleOuter.stop();
      this.removeGlow();
    }
  }

  /** Pause the effect (particles stop, glow removed). */
  stop(): void {
    this.active = false;
    this.idleCore.stop();
    this.idleOuter.stop();
    this.removeGlow();
  }

  /** Resume the effect (particles start, glow added). */
  start(): void {
    this.active = true;
    if (this.emitZone.width > 2) {
      this.idleCore.start();
      this.idleOuter.start();
      this.ensureGlow();
    }
  }

  private ensureGlow(): void {
    if (!this.glowTarget || this.breathGlow || this.emitZone.width <= 2) return;
    this.breathGlow = this.glowTarget.postFX.addGlow(this.palette.mid, 0, 0, false, 0.1, 6);
    this.breathTween = this.scene.tweens.add({
      targets: this.breathGlow,
      outerStrength: 2.5,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private removeGlow(): void {
    if (this.breathTween) {
      this.breathTween.destroy();
      this.breathTween = null;
    }
    if (this.breathGlow && this.glowTarget) {
      this.glowTarget.postFX.remove(this.breathGlow);
      this.breathGlow = null;
    }
  }

  destroy(): void {
    this.stop();
    this.idleCore.destroy();
    this.idleOuter.destroy();
  }
}
