import * as Phaser from 'phaser';
import { DEPTH } from '../config';

const TEX_ROCKET_BODY = '__rocket_body';
const TEX_ROCKET_ACCENT = '__rocket_accent';
const TEX_ROCKET_SMOKE = '__rocket_smoke';
const TEX_ROCKET_EXHAUST = '__rocket_exhaust';
const TEX_ROCKET_GLOW = '__rocket_glow';
const TEX_ROCKET_ENGINE = '__rocket_engine';

interface RocketVisual {
  body: Phaser.GameObjects.Image;
  accent: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  engine: Phaser.GameObjects.Image;
  exhaustEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  accentColor: number;
  smokeColor: number;
  lastSmokeX: number;
  lastSmokeY: number;
  lastSmokeAt: number;
}

export class RocketRenderer {
  private rockets = new Map<number, RocketVisual>();
  private smokePuffs = new Set<Phaser.GameObjects.Image>();

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

    if (!tex.exists(TEX_ROCKET_ACCENT)) {
      const w = 28;
      const h = 12;
      const canvas = tex.createCanvas(TEX_ROCKET_ACCENT, w, h)!;
      const ctx = canvas.context;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(8, 3, 10, 2);
      ctx.fillRect(8, 7, 6, 1);
      ctx.beginPath();
      ctx.moveTo(2, 2);
      ctx.lineTo(7, 4);
      ctx.lineTo(2, 5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(2, h - 2);
      ctx.lineTo(7, h - 4);
      ctx.lineTo(2, h - 5);
      ctx.closePath();
      ctx.fill();
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

    if (!tex.exists(TEX_ROCKET_ENGINE)) {
      const w = 24;
      const h = 18;
      const canvas = tex.createCanvas(TEX_ROCKET_ENGINE, w, h)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(7, h / 2, 0, 7, h / 2, 10);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.28, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(2, h / 2);
      ctx.lineTo(w - 1, 2);
      ctx.lineTo(w - 1, h - 2);
      ctx.closePath();
      ctx.fill();
      canvas.refresh();
    }
  }

  createVisual(
    id: number,
    x: number,
    y: number,
    size: number,
    color: number,
    accentColor: number,
    smokeColor: number,
  ): void {
    if (this.rockets.has(id)) return;

    const body = this.scene.add.image(x, y, TEX_ROCKET_BODY)
      .setDepth(DEPTH.PROJECTILES)
      .setTint(color);
    const accent = this.scene.add.image(x, y, TEX_ROCKET_ACCENT)
      .setDepth(DEPTH.PROJECTILES + 1)
      .setAlpha(0.95)
      .setTint(accentColor);
    const glow = this.scene.add.image(x, y, TEX_ROCKET_GLOW)
      .setDepth(DEPTH.PROJECTILES - 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.42)
      .setTint(accentColor);
    const engine = this.scene.add.image(x, y, TEX_ROCKET_ENGINE)
      .setDepth(DEPTH.PROJECTILES)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.9)
      .setTint(accentColor)
      .setOrigin(0.2, 0.5);

    const exhaustEmitter = this.scene.add.particles(x, y, TEX_ROCKET_EXHAUST, {
      lifespan: { min: 80, max: 140 },
      frequency: 14,
      quantity: 1,
      speedX: { min: -12, max: 12 },
      speedY: { min: -12, max: 12 },
      scale: { start: 0.34, end: 0.05 },
      alpha: { start: 0.95, end: 0 },
      tint: [0xffffff, accentColor, accentColor],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    });
    exhaustEmitter.setDepth(DEPTH.PROJECTILES);

    this.rockets.set(id, {
      body,
      accent,
      glow,
      engine,
      exhaustEmitter,
      accentColor,
      smokeColor,
      lastSmokeX: x,
      lastSmokeY: y,
      lastSmokeAt: this.scene.time.now,
    });
    this.updateVisual(id, x, y, size, 1, 0);
  }

  private spawnSmokePuff(x: number, y: number, size: number, smokeColor: number): void {
    const puff = this.scene.add.image(x, y, TEX_ROCKET_SMOKE)
      .setDepth(DEPTH.FIRE)
      .setTint(smokeColor)
      .setAlpha(0.95)
      .setScale(Math.max(size / 28, 0.28));

    this.smokePuffs.add(puff);

    const driftX = Phaser.Math.Between(-6, 6);
    const driftY = Phaser.Math.Between(-10, -2);
    this.scene.tweens.add({
      targets: puff,
      x: x + driftX,
      y: y + driftY,
      alpha: 0,
      scale: puff.scaleX * 2.3,
      duration: 1000,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.smokePuffs.delete(puff);
        puff.destroy();
      },
    });
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

    visual.accent.setPosition(x, y);
    visual.accent.setRotation(angle);
    visual.accent.setScale(Math.max(size / 10, 0.8), Math.max(size / 10, 0.8));

    visual.glow.setPosition(x, y);
    visual.glow.setRotation(angle);
    visual.glow.setScale(Math.max(size / 12, 0.8));

    const engineOffset = size * 0.9;
    visual.engine.setPosition(x - nx * engineOffset, y - ny * engineOffset);
    visual.engine.setRotation(angle + Math.PI);
    visual.engine.setScale(Math.max(size / 12, 0.7), Math.max(size / 13, 0.6));
    visual.engine.setAlpha(0.72 + Math.min(speed / 1200, 0.22));

    const distSinceSmoke = Phaser.Math.Distance.Between(visual.lastSmokeX, visual.lastSmokeY, tailX, tailY);
    const now = this.scene.time.now;
    if (distSinceSmoke >= Math.max(size * 0.55, 5) || now - visual.lastSmokeAt >= 22) {
      this.spawnSmokePuff(tailX, tailY, size, visual.smokeColor);
      visual.lastSmokeX = tailX;
      visual.lastSmokeY = tailY;
      visual.lastSmokeAt = now;
    }

    visual.exhaustEmitter.setPosition(tailX, tailY);
    visual.exhaustEmitter.setParticleScale(Math.max(size / 34, 0.18), 0.05);
  }

  destroyVisual(id: number): void {
    const visual = this.rockets.get(id);
    if (!visual) return;
    visual.body.destroy();
    visual.accent.destroy();
    visual.glow.destroy();
    visual.engine.destroy();
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
    for (const puff of this.smokePuffs) {
      puff.destroy();
    }
    this.smokePuffs.clear();
  }
}