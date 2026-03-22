import Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';

const TEX_ROCKET_BODY = '__rocket_body';
const TEX_ROCKET_SMOKE = '__rocket_smoke';
const TEX_ROCKET_EXHAUST = '__rocket_exhaust';
const TEX_ROCKET_GLOW = '__rocket_glow';

interface RocketVisual {
  body: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  smokeEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  exhaustEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
}

export class RocketRenderer {
  private rockets = new Map<number, RocketVisual>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    const tex = this.scene.textures;

    if (!tex.exists(TEX_ROCKET_BODY)) {
      const w = 28;
      const h = 12;
      const canvas = tex.createCanvas(TEX_ROCKET_BODY, w, h)!;
      const ctx = canvas.context;
      ctx.fillStyle = '#f0d08a';
      ctx.beginPath();
      ctx.moveTo(2, h * 0.2);
      ctx.lineTo(w - 8, h * 0.2);
      ctx.lineTo(w - 2, h / 2);
      ctx.lineTo(w - 8, h * 0.8);
      ctx.lineTo(2, h * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#8c4e2d';
      ctx.fillRect(0, 3, 4, h - 6);
      ctx.fillStyle = '#b63f1e';
      ctx.fillRect(6, 2, 4, h - 4);
      canvas.refresh();
    }

    if (!tex.exists(TEX_ROCKET_SMOKE)) {
      const s = 24;
      const canvas = tex.createCanvas(TEX_ROCKET_SMOKE, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(190, 198, 202, 0.45)');
      grad.addColorStop(0.55, 'rgba(120, 136, 145, 0.22)');
      grad.addColorStop(1, 'rgba(70, 80, 88, 0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    if (!tex.exists(TEX_ROCKET_EXHAUST)) {
      const s = 18;
      const canvas = tex.createCanvas(TEX_ROCKET_EXHAUST, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.25, 'rgba(255,224,132,0.95)');
      grad.addColorStop(0.6, 'rgba(255,129,48,0.4)');
      grad.addColorStop(1, 'rgba(255,90,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    if (!tex.exists(TEX_ROCKET_GLOW)) {
      const s = 34;
      const canvas = tex.createCanvas(TEX_ROCKET_GLOW, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,214,122,0.5)');
      grad.addColorStop(0.5, 'rgba(255,140,60,0.18)');
      grad.addColorStop(1, 'rgba(255,90,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }
  }

  createVisual(id: number, x: number, y: number, size: number, color: number): void {
    if (this.rockets.has(id)) return;

    const body = this.scene.add.image(x, y, TEX_ROCKET_BODY)
      .setDepth(DEPTH.PROJECTILES)
      .setTint(color);
    const glow = this.scene.add.image(x, y, TEX_ROCKET_GLOW)
      .setDepth(DEPTH.PROJECTILES - 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.65)
      .setTint(0xffa347);

    const smokeEmitter = this.scene.add.particles(x, y, TEX_ROCKET_SMOKE, {
      lifespan: { min: 360, max: 620 },
      frequency: 18,
      quantity: 2,
      speedX: { min: -18, max: 18 },
      speedY: { min: -18, max: 18 },
      scale: { start: 0.26, end: 0.7 },
      alpha: { start: 0.62, end: 0 },
      rotate: { min: 0, max: 360 },
      tint: [COLORS.GREY_2, COLORS.GREY_3, COLORS.GREY_4],
      blendMode: Phaser.BlendModes.NORMAL,
      emitting: true,
    });
    smokeEmitter.setDepth(DEPTH.FIRE);

    const exhaustEmitter = this.scene.add.particles(x, y, TEX_ROCKET_EXHAUST, {
      lifespan: { min: 80, max: 140 },
      frequency: 18,
      quantity: 1,
      speedX: { min: -8, max: 8 },
      speedY: { min: -8, max: 8 },
      scale: { start: 0.24, end: 0.04 },
      alpha: { start: 0.95, end: 0 },
      tint: [0xffffff, 0xffdd88, 0xff8f32],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    });
    exhaustEmitter.setDepth(DEPTH.PROJECTILES);

    this.rockets.set(id, { body, glow, smokeEmitter, exhaustEmitter });
    this.updateVisual(id, x, y, size, 1, 0);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number): void {
    const visual = this.rockets.get(id);
    if (!visual) return;

    const angle = Math.atan2(vy, vx);
    const speed = Math.max(1, Math.sqrt(vx * vx + vy * vy));
    const nx = vx / speed;
    const ny = vy / speed;
    const tailX = x - nx * (size * 0.9);
    const tailY = y - ny * (size * 0.9);

    visual.body.setPosition(x, y);
    visual.body.setRotation(angle);
    visual.body.setScale(Math.max(size / 10, 0.8), Math.max(size / 10, 0.8));

    visual.glow.setPosition(x, y);
    visual.glow.setScale(Math.max(size / 12, 0.8));

    visual.smokeEmitter.setPosition(tailX, tailY);
    visual.smokeEmitter.setAlpha(0.8);
    visual.smokeEmitter.setParticleScale(Math.max(size / 32, 0.22), Math.max(size / 14, 0.75));

    visual.exhaustEmitter.setPosition(tailX, tailY);
    visual.exhaustEmitter.setParticleScale(Math.max(size / 34, 0.18), 0.05);
  }

  destroyVisual(id: number): void {
    const visual = this.rockets.get(id);
    if (!visual) return;
    visual.body.destroy();
    visual.glow.destroy();
    visual.smokeEmitter.stop();
    visual.smokeEmitter.destroy();
    visual.exhaustEmitter.stop();
    visual.exhaustEmitter.destroy();
    this.rockets.delete(id);
  }

  has(id: number): boolean {
    return this.rockets.has(id);
  }

  getActiveIds(): number[] {
    return [...this.rockets.keys()];
  }

  destroyAll(): void {
    for (const id of this.getActiveIds()) {
      this.destroyVisual(id);
    }
  }
}