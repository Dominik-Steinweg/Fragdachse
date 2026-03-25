import Phaser from 'phaser';
import { COLORS, DEPTH, isPointInsideArena } from '../config';
import type { EnergyBallVariant } from '../types';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  setCircleEmitZone,
} from './EffectUtils';

const TEX_ENERGY_CORE  = '__energy_ball_core';
const TEX_ENERGY_SHELL = '__energy_ball_shell';
const TEX_ENERGY_SPARK = '__energy_ball_spark';
const TEX_ENERGY_GLOW  = '__energy_ball_glow';
const TEX_PLASMA_CORE  = '__plasma_ball_core';
const TEX_PLASMA_SHELL = '__plasma_ball_shell';
const TEX_PLASMA_SPARK = '__plasma_ball_spark';
const TEX_PLASMA_GLOW  = '__plasma_ball_glow';

interface EnergyBallVisual {
  coreEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  shellEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  glowImage: Phaser.GameObjects.Image;
  shellImage: Phaser.GameObjects.Image;
}

interface EnergyBallVisualPreset {
  coreTintMix: number;
  shellTintMix: number;
  glowTintMix: number;
  glowAlpha: number;
  shellAlpha: number;
  spreadFactor: number;
  minSpread: number;
  coreZoneFactor: number;
  shellZoneFactor: number;
  glowScaleFactor: number;
  minGlowScale: number;
  shellScaleFactor: number;
  minShellScale: number;
  coreParticleScaleBase: number;
  coreParticleScaleFactor: number;
  shellParticleScaleBase: number;
  shellParticleScaleFactor: number;
  glowPulseAmplitude: number;
  shellPulseAmplitude: number;
}

interface EnergyBallTextureSet {
  core: string;
  shell: string;
  spark: string;
  glow: string;
}

const DEFAULT_VARIANT: EnergyBallVariant = 'default';

const ENERGY_BALL_TEXTURES: Record<EnergyBallVariant, EnergyBallTextureSet> = {
  default: {
    core: TEX_ENERGY_CORE,
    shell: TEX_ENERGY_SHELL,
    spark: TEX_ENERGY_SPARK,
    glow: TEX_ENERGY_GLOW,
  },
  plasma: {
    core: TEX_PLASMA_CORE,
    shell: TEX_PLASMA_SHELL,
    spark: TEX_PLASMA_SPARK,
    glow: TEX_PLASMA_GLOW,
  },
};

const ENERGY_BALL_PRESETS: Record<EnergyBallVariant, EnergyBallVisualPreset> = {
  default: {
    coreTintMix: 0.55,
    shellTintMix: 0.45,
    glowTintMix: 0.4,
    glowAlpha: 0.72,
    shellAlpha: 0.85,
    spreadFactor: 0.44,
    minSpread: 5,
    coreZoneFactor: 0.38,
    shellZoneFactor: 0.95,
    glowScaleFactor: 2.2 / 18,
    minGlowScale: 0.9,
    shellScaleFactor: 1.35 / 18,
    minShellScale: 0.85,
    coreParticleScaleBase: 0.4,
    coreParticleScaleFactor: 0.015,
    shellParticleScaleBase: 0.75,
    shellParticleScaleFactor: 0.012,
    glowPulseAmplitude: 0,
    shellPulseAmplitude: 0,
  },
  plasma: {
    coreTintMix: 0.12,
    shellTintMix: 0.1,
    glowTintMix: 0.06,
    glowAlpha: 0.84,
    shellAlpha: 0.62,
    spreadFactor: 0.5,
    minSpread: 3.2,
    coreZoneFactor: 0.32,
    shellZoneFactor: 0.88,
    glowScaleFactor: 5 / 18,
    minGlowScale: 0.72,
    shellScaleFactor: 1.08 / 18,
    minShellScale: 0.62,
    coreParticleScaleBase: 0.16,
    coreParticleScaleFactor: 0.014,
    shellParticleScaleBase: 0.28,
    shellParticleScaleFactor: 0.018,
    glowPulseAmplitude: 0.16,
    shellPulseAmplitude: 0.1,
  },
};

export class EnergyBallRenderer {
  private visuals = new Map<number, EnergyBallVisual>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    this.generateDefaultTextures();
    this.generatePlasmaTextures();
  }

  private generateDefaultTextures(): void {
    const textures = this.scene.textures;

    fillRadialGradientTexture(textures, TEX_ENERGY_CORE, 20, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.35, 'rgba(196,246,255,0.95)'],
      [0.7, 'rgba(115,190,211,0.3)'],
      [1, 'rgba(79,143,186,0.0)'],
    ]);

    ensureCanvasTexture(textures, TEX_ENERGY_SHELL, 28, 28, (ctx) => {
      const s = 28;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(164,221,219,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, 11.5, Math.PI * 0.2, Math.PI * 1.55);
      ctx.stroke();
    });

    fillRadialGradientTexture(textures, TEX_ENERGY_SPARK, 8, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.5, 'rgba(164,221,219,0.65)'],
      [1, 'rgba(79,143,186,0.0)'],
    ]);

    fillRadialGradientTexture(textures, TEX_ENERGY_GLOW, 56, [
      [0, 'rgba(164,221,219,0.55)'],
      [0.45, 'rgba(115,190,211,0.28)'],
      [1, 'rgba(23,32,56,0.0)'],
    ]);
  }

  private generatePlasmaTextures(): void {
    const textures = this.scene.textures;

    fillRadialGradientTexture(textures, TEX_PLASMA_CORE, 20, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.28, 'rgba(255,255,255,0.82)'],
      [0.56, 'rgba(214,214,214,0.34)'],
      [1, 'rgba(40,40,40,0.0)'],
    ]);

    ensureCanvasTexture(textures, TEX_PLASMA_SHELL, 28, 28, (ctx) => {
      const s = 28;
      ctx.strokeStyle = 'rgba(255,255,255,0.82)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, 8.4, Math.PI * 0.18, Math.PI * 1.72);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, 10.7, Math.PI * 0.78, Math.PI * 2.04);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, 6.4, Math.PI * 1.2, Math.PI * 2.3);
      ctx.stroke();
    });

    fillRadialGradientTexture(textures, TEX_PLASMA_SPARK, 8, [
      [0, 'rgba(255,255,255,0.96)'],
      [0.38, 'rgba(255,255,255,0.7)'],
      [0.72, 'rgba(190,190,190,0.2)'],
      [1, 'rgba(50,50,50,0.0)'],
    ]);

    fillRadialGradientTexture(textures, TEX_PLASMA_GLOW, 56, [
      [0, 'rgba(255,255,255,0.5)'],
      [0.32, 'rgba(255,255,255,0.22)'],
      [0.66, 'rgba(180,180,180,0.08)'],
      [1, 'rgba(0,0,0,0.0)'],
    ]);
  }

  createVisual(id: number, x: number, y: number, size: number, color: number, variant: EnergyBallVariant = DEFAULT_VARIANT): void {
    if (this.visuals.has(id)) return;

    const preset = this.getPreset(variant);
    const textureSet = this.getTextureSet(variant);
    const coreTints = this.getCoreParticleTints(color, variant, preset);
    const shellTints = this.getShellParticleTints(color, variant, preset);

    const coreEmitter = createEmitter(this.scene, x, y, textureSet.core, {
      lifespan: { min: 110, max: 220 },
      frequency: 16,
      quantity: 2,
      speedX: { min: -14, max: 14 },
      speedY: { min: -14, max: 14 },
      scale: { start: 0.55, end: 0.08 },
      alpha: { start: 0.95, end: 0 },
      tint: coreTints,
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.PROJECTILES + 1);

    const shellEmitter = createEmitter(this.scene, x, y, textureSet.spark, {
      lifespan: { min: 160, max: 320 },
      frequency: 28,
      quantity: 1,
      speedX: { min: -26, max: 26 },
      speedY: { min: -26, max: 26 },
      scale: { start: 0.85, end: 0.1 },
      alpha: { start: 0.8, end: 0 },
      tint: shellTints,
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.PROJECTILES + 0.5);

    const glowImage = configureAdditiveImage(
      this.scene.add.image(x, y, textureSet.glow),
      DEPTH.PROJECTILES - 0.2,
      preset.glowAlpha,
      this.getGlowTint(color, variant, preset),
    );

    const shellImage = configureAdditiveImage(
      this.scene.add.image(x, y, textureSet.shell),
      DEPTH.PROJECTILES + 0.8,
      preset.shellAlpha,
      this.getShellTint(color, variant, preset),
    );

    this.visuals.set(id, { coreEmitter, shellEmitter, glowImage, shellImage });
    this.updateVisual(id, x, y, size, 0, 0, color, variant);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number, color: number, variant: EnergyBallVariant = DEFAULT_VARIANT): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    const preset = this.getPreset(variant);

    void vx;
    void vy;

    const spread = Math.max(size * preset.spreadFactor, preset.minSpread);
    const pulse = Math.sin(this.scene.time.now * 0.02 + id * 0.7);
    const glowPulse = Math.max(0.3, 1 + pulse * preset.glowPulseAmplitude);
    const shellPulse = Math.max(0.4, 1 + Math.cos(this.scene.time.now * 0.016 + id * 0.4) * preset.shellPulseAmplitude);
    const glowScale = Math.max(size * preset.glowScaleFactor, preset.minGlowScale) * glowPulse;

    visual.coreEmitter.setPosition(x, y);
    setCircleEmitZone(visual.coreEmitter, spread * preset.coreZoneFactor, 2, true);
    visual.coreEmitter.setParticleScale(preset.coreParticleScaleBase + size * preset.coreParticleScaleFactor, 0.08);

    visual.shellEmitter.setPosition(x, y);
    setCircleEmitZone(visual.shellEmitter, spread * preset.shellZoneFactor, 1, true);
    visual.shellEmitter.setParticleScale(preset.shellParticleScaleBase + size * preset.shellParticleScaleFactor, 0.1);

    visual.glowImage.setPosition(x, y);
    visual.glowImage.setScale(glowScale);
    visual.glowImage.setAlpha(preset.glowAlpha * (0.92 + pulse * 0.05));
    visual.glowImage.setTint(this.getGlowTint(color, variant, preset));

    visual.shellImage.setPosition(x, y);
    visual.shellImage.setScale(Math.max(size * preset.shellScaleFactor, preset.minShellScale) * shellPulse);
    visual.shellImage.setRotation(this.scene.time.now * 0.006 + id * 0.15);
    visual.shellImage.setAlpha(preset.shellAlpha * (0.95 + pulse * 0.04));
    visual.shellImage.setTint(this.getShellTint(color, variant, preset));
  }

  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    destroyEmitter(visual.coreEmitter);
    destroyEmitter(visual.shellEmitter);
    visual.glowImage.destroy();
    visual.shellImage.destroy();
    this.visuals.delete(id);
  }

  has(id: number): boolean {
    return this.visuals.has(id);
  }

  getActiveIds(): number[] {
    return [...this.visuals.keys()];
  }

  destroyAll(): void {
    for (const id of this.getActiveIds()) {
      this.destroyVisual(id);
    }
  }

  playImpact(x: number, y: number, color: number, variant: EnergyBallVariant = DEFAULT_VARIANT, scale = 1): void {
    if (!isPointInsideArena(x, y)) return;
    const preset = this.getPreset(variant);
    const textureSet = this.getTextureSet(variant);
    const glowTint = this.getGlowTint(color, variant, preset);
    const shellTint = this.getShellTint(color, variant, preset);

    const glow = configureAdditiveImage(
      this.scene.add.image(x, y, textureSet.glow),
      DEPTH.PROJECTILES + 1.4,
      variant === 'plasma' ? 0.72 : 0.64,
      glowTint,
    ).setScale((preset.minGlowScale + scale * 0.7) * (variant === 'plasma' ? 1.15 : 1.35));

    this.scene.tweens.add({
      targets: glow,
      alpha: 0,
      scaleX: glow.scaleX * 1.6,
      scaleY: glow.scaleY * 1.6,
      duration: variant === 'plasma' ? 180 : 240,
      ease: 'Quad.easeOut',
      onComplete: () => glow.destroy(),
    });

    const shell = configureAdditiveImage(
      this.scene.add.image(x, y, textureSet.shell),
      DEPTH.PROJECTILES + 1.5,
      variant === 'plasma' ? 0.82 : 0.76,
      shellTint,
    ).setScale((preset.minShellScale + scale * 0.5) * 0.95);
    this.scene.tweens.add({
      targets: shell,
      alpha: 0,
      scaleX: shell.scaleX * 1.9,
      scaleY: shell.scaleY * 1.9,
      rotation: Math.PI * 0.65,
      duration: variant === 'plasma' ? 160 : 220,
      ease: 'Cubic.easeOut',
      onComplete: () => shell.destroy(),
    });

    const sparkEmitter = createEmitter(this.scene, x, y, textureSet.spark, {
      lifespan: { min: variant === 'plasma' ? 120 : 160, max: variant === 'plasma' ? 280 : 340 },
      quantity: variant === 'plasma' ? 12 : 16,
      frequency: -1,
      speed: { min: 40 * scale, max: 180 * scale },
      angle: { min: 0, max: 360 },
      scale: { start: variant === 'plasma' ? 0.65 : 0.9, end: 0.04 },
      alpha: { start: 0.95, end: 0 },
      tint: variant === 'plasma'
        ? [0xffffff, this.mixColor(color, 0xffffff, 0.18), this.mixColor(color, 0x000000, 0.15)]
        : [0xffffff, color, this.mixColor(color, COLORS.BLUE_1, 0.42)],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.PROJECTILES + 1.45);
    sparkEmitter.explode(variant === 'plasma' ? 12 : 16);
    this.scene.time.delayedCall(420, () => destroyEmitter(sparkEmitter));
  }

  private mixColor(source: number, target: number, t: number): number {
    const a = Phaser.Display.Color.IntegerToRGB(source);
    const b = Phaser.Display.Color.IntegerToRGB(target);
    return Phaser.Display.Color.GetColor(
      Math.round(a.r + (b.r - a.r) * t),
      Math.round(a.g + (b.g - a.g) * t),
      Math.round(a.b + (b.b - a.b) * t),
    );
  }

  private getPreset(variant: EnergyBallVariant | undefined): EnergyBallVisualPreset {
    return ENERGY_BALL_PRESETS[variant ?? DEFAULT_VARIANT] ?? ENERGY_BALL_PRESETS.default;
  }

  private getTextureSet(variant: EnergyBallVariant | undefined): EnergyBallTextureSet {
    return ENERGY_BALL_TEXTURES[variant ?? DEFAULT_VARIANT] ?? ENERGY_BALL_TEXTURES.default;
  }

  private getCoreParticleTints(color: number, variant: EnergyBallVariant, preset: EnergyBallVisualPreset): number[] {
    if (variant === 'plasma') {
      return [
        this.mixColor(color, 0xffffff, 0.12),
        color,
        this.mixColor(color, 0x000000, 0.16),
      ];
    }

    return [0xffffff, color, this.mixColor(color, COLORS.BLUE_1, preset.coreTintMix)];
  }

  private getShellParticleTints(color: number, variant: EnergyBallVariant, preset: EnergyBallVisualPreset): number[] {
    if (variant === 'plasma') {
      return [
        this.mixColor(color, 0xffffff, 0.08),
        this.mixColor(color, 0x000000, 0.12),
        this.mixColor(color, 0xffffff, 0.03),
      ];
    }

    return [0xffffff, this.mixColor(color, COLORS.BLUE_2, preset.shellTintMix), color];
  }

  private getGlowTint(color: number, variant: EnergyBallVariant, preset: EnergyBallVisualPreset): number {
    if (variant === 'plasma') {
      return this.mixColor(color, 0xffffff, preset.glowTintMix);
    }

    return this.mixColor(color, COLORS.BLUE_2, preset.glowTintMix);
  }

  private getShellTint(color: number, variant: EnergyBallVariant, preset: EnergyBallVisualPreset): number {
    if (variant === 'plasma') {
      return this.mixColor(color, 0xffffff, preset.shellTintMix);
    }

    return this.mixColor(color, COLORS.BLUE_1, preset.coreTintMix);
  }
}