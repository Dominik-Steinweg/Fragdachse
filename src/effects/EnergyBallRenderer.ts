import Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import { circleZone } from './EffectUtils';

const TEX_ENERGY_CORE  = '__energy_ball_core';
const TEX_ENERGY_SHELL = '__energy_ball_shell';
const TEX_ENERGY_SPARK = '__energy_ball_spark';
const TEX_ENERGY_GLOW  = '__energy_ball_glow';

interface EnergyBallVisual {
  coreEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  shellEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  glowImage: Phaser.GameObjects.Image;
  shellImage: Phaser.GameObjects.Image;
}

export class EnergyBallRenderer {
  private visuals = new Map<number, EnergyBallVisual>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
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

  createVisual(id: number, x: number, y: number, size: number, color: number): void {
    if (this.visuals.has(id)) return;

    const coreEmitter = this.scene.add.particles(x, y, TEX_ENERGY_CORE, {
      lifespan: { min: 110, max: 220 },
      frequency: 16,
      quantity: 2,
      speedX: { min: -14, max: 14 },
      speedY: { min: -14, max: 14 },
      scale: { start: 0.55, end: 0.08 },
      alpha: { start: 0.95, end: 0 },
      tint: [0xffffff, color, this.mixColor(color, COLORS.BLUE_1, 0.55)],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    });
    coreEmitter.setDepth(DEPTH.PROJECTILES + 1);

    const shellEmitter = this.scene.add.particles(x, y, TEX_ENERGY_SPARK, {
      lifespan: { min: 160, max: 320 },
      frequency: 28,
      quantity: 1,
      speedX: { min: -26, max: 26 },
      speedY: { min: -26, max: 26 },
      scale: { start: 0.85, end: 0.1 },
      alpha: { start: 0.8, end: 0 },
      tint: [0xffffff, this.mixColor(color, COLORS.BLUE_2, 0.45), color],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    });
    shellEmitter.setDepth(DEPTH.PROJECTILES + 0.5);

    const glowImage = this.scene.add.image(x, y, TEX_ENERGY_GLOW)
      .setDepth(DEPTH.PROJECTILES - 0.2)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.72)
      .setTint(this.mixColor(color, COLORS.BLUE_2, 0.4));

    const shellImage = this.scene.add.image(x, y, TEX_ENERGY_SHELL)
      .setDepth(DEPTH.PROJECTILES + 0.8)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.85)
      .setTint(this.mixColor(color, COLORS.BLUE_1, 0.55));

    this.visuals.set(id, { coreEmitter, shellEmitter, glowImage, shellImage });
    this.updateVisual(id, x, y, size, 0, 0, color);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number, color: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    const spread = Math.max(size * 0.44, 5);
    const glowScale = Math.max(size / 18 * 2.2, 0.9);

    visual.coreEmitter.setPosition(x, y);
    visual.coreEmitter.clearEmitZones();
    visual.coreEmitter.addEmitZone(circleZone(spread * 0.38, 2));
    visual.coreEmitter.setParticleScale(0.4 + size * 0.015, 0.08);

    visual.shellEmitter.setPosition(x, y);
    visual.shellEmitter.clearEmitZones();
    visual.shellEmitter.addEmitZone(circleZone(spread * 0.95, 1));
    visual.shellEmitter.setParticleScale(0.75 + size * 0.012, 0.1);

    visual.glowImage.setPosition(x, y);
    visual.glowImage.setScale(glowScale);
    visual.glowImage.setTint(this.mixColor(color, COLORS.BLUE_2, 0.4));

    visual.shellImage.setPosition(x, y);
    visual.shellImage.setScale(Math.max(size / 18 * 1.35, 0.85));
    visual.shellImage.setRotation(this.scene.time.now * 0.006 + id * 0.15);
    visual.shellImage.setTint(this.mixColor(color, COLORS.BLUE_1, 0.55));
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
}