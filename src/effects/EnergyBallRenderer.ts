import Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import type { EnergyBallVariant } from '../types';
import { circleZone } from './EffectUtils';

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

    if (!textures.exists(TEX_ENERGY_CORE)) {
      const s = 20;
      const canvas = textures.createCanvas(TEX_ENERGY_CORE, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.35, 'rgba(196,246,255,0.95)');
      grad.addColorStop(0.7, 'rgba(115,190,211,0.3)');
      grad.addColorStop(1, 'rgba(79,143,186,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    if (!textures.exists(TEX_ENERGY_SHELL)) {
      const s = 28;
      const canvas = textures.createCanvas(TEX_ENERGY_SHELL, s, s)!;
      const ctx = canvas.context;
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
      canvas.refresh();
    }

    if (!textures.exists(TEX_ENERGY_SPARK)) {
      const s = 8;
      const canvas = textures.createCanvas(TEX_ENERGY_SPARK, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.5, 'rgba(164,221,219,0.65)');
      grad.addColorStop(1, 'rgba(79,143,186,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    if (!textures.exists(TEX_ENERGY_GLOW)) {
      const s = 56;
      const canvas = textures.createCanvas(TEX_ENERGY_GLOW, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(164,221,219,0.55)');
      grad.addColorStop(0.45, 'rgba(115,190,211,0.28)');
      grad.addColorStop(1, 'rgba(23,32,56,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }
  }

  private generatePlasmaTextures(): void {
    const textures = this.scene.textures;

    if (!textures.exists(TEX_PLASMA_CORE)) {
      const s = 20;
      const canvas = textures.createCanvas(TEX_PLASMA_CORE, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.28, 'rgba(255,255,255,0.82)');
      grad.addColorStop(0.56, 'rgba(214,214,214,0.34)');
      grad.addColorStop(1, 'rgba(40,40,40,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    if (!textures.exists(TEX_PLASMA_SHELL)) {
      const s = 28;
      const canvas = textures.createCanvas(TEX_PLASMA_SHELL, s, s)!;
      const ctx = canvas.context;
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
      canvas.refresh();
    }

    if (!textures.exists(TEX_PLASMA_SPARK)) {
      const s = 8;
      const canvas = textures.createCanvas(TEX_PLASMA_SPARK, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,0.96)');
      grad.addColorStop(0.38, 'rgba(255,255,255,0.7)');
      grad.addColorStop(0.72, 'rgba(190,190,190,0.2)');
      grad.addColorStop(1, 'rgba(50,50,50,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    if (!textures.exists(TEX_PLASMA_GLOW)) {
      const s = 56;
      const canvas = textures.createCanvas(TEX_PLASMA_GLOW, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,0.5)');
      grad.addColorStop(0.32, 'rgba(255,255,255,0.22)');
      grad.addColorStop(0.66, 'rgba(180,180,180,0.08)');
      grad.addColorStop(1, 'rgba(0,0,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }
  }

  createVisual(id: number, x: number, y: number, size: number, color: number, variant: EnergyBallVariant = DEFAULT_VARIANT): void {
    if (this.visuals.has(id)) return;

    const preset = this.getPreset(variant);
    const textureSet = this.getTextureSet(variant);
    const coreTints = this.getCoreParticleTints(color, variant, preset);
    const shellTints = this.getShellParticleTints(color, variant, preset);

    const coreEmitter = this.scene.add.particles(x, y, textureSet.core, {
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
    });
    coreEmitter.setDepth(DEPTH.PROJECTILES + 1);

    const shellEmitter = this.scene.add.particles(x, y, textureSet.spark, {
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
    });
    shellEmitter.setDepth(DEPTH.PROJECTILES + 0.5);

    const glowImage = this.scene.add.image(x, y, textureSet.glow)
      .setDepth(DEPTH.PROJECTILES - 0.2)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(preset.glowAlpha)
      .setTint(this.getGlowTint(color, variant, preset));

    const shellImage = this.scene.add.image(x, y, textureSet.shell)
      .setDepth(DEPTH.PROJECTILES + 0.8)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(preset.shellAlpha)
      .setTint(this.getShellTint(color, variant, preset));

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
    visual.coreEmitter.clearEmitZones();
    visual.coreEmitter.addEmitZone(circleZone(spread * preset.coreZoneFactor, 2));
    visual.coreEmitter.setParticleScale(preset.coreParticleScaleBase + size * preset.coreParticleScaleFactor, 0.08);

    visual.shellEmitter.setPosition(x, y);
    visual.shellEmitter.clearEmitZones();
    visual.shellEmitter.addEmitZone(circleZone(spread * preset.shellZoneFactor, 1));
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

    visual.coreEmitter.stop();
    visual.coreEmitter.destroy();
    visual.shellEmitter.stop();
    visual.shellEmitter.destroy();
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