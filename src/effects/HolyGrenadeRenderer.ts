import * as Phaser from 'phaser';
import { DEPTH } from '../config';

const TEX_HOLY_GRENADE_BODY = '__holy_grenade_body';
const TEX_HOLY_GRENADE_TRIM = '__holy_grenade_trim';
const TEX_HOLY_GRENADE_PIN = '__holy_grenade_pin';
const TEX_HOLY_GRENADE_GLOW = '__holy_grenade_glow';
const TEX_HOLY_GRENADE_SPARK = '__holy_grenade_spark';

interface HolyGrenadeVisual {
  glow: Phaser.GameObjects.Image;
  body: Phaser.GameObjects.Image;
  trim: Phaser.GameObjects.Image;
  pin: Phaser.GameObjects.Image;
  sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
}

export class HolyGrenadeRenderer {
  private visuals = new Map<number, HolyGrenadeVisual>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    const textures = this.scene.textures;

    if (!textures.exists(TEX_HOLY_GRENADE_BODY)) {
      const s = 36;
      const canvas = textures.createCanvas(TEX_HOLY_GRENADE_BODY, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s * 0.38, s * 0.34, 2, s / 2, s / 2, s * 0.45);
      grad.addColorStop(0, 'rgba(255,250,212,1.0)');
      grad.addColorStop(0.25, 'rgba(244,221,129,0.98)');
      grad.addColorStop(0.65, 'rgba(212,168,59,0.98)');
      grad.addColorStop(1, 'rgba(111,71,18,1.0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2 + 2, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(255,243,194,0.72)';
      ctx.beginPath();
      ctx.arc(s / 2, s / 2 + 2, 11, Math.PI * 0.72, Math.PI * 1.84);
      ctx.stroke();
      canvas.refresh();
    }

    if (!textures.exists(TEX_HOLY_GRENADE_TRIM)) {
      const s = 36;
      const canvas = textures.createCanvas(TEX_HOLY_GRENADE_TRIM, s, s)!;
      const ctx = canvas.context;
      ctx.strokeStyle = 'rgba(110,64,10,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2 + 2, 10.5, Math.PI * 0.06, Math.PI * 0.94);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s / 2, s / 2 + 2, 10.5, Math.PI * 1.06, Math.PI * 1.94);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,248,236,0.95)';
      ctx.fillRect(s / 2 - 1.5, s / 2 - 7, 3, 15);
      ctx.fillRect(s / 2 - 6, s / 2 - 1.5, 12, 3);
      ctx.fillStyle = 'rgba(173,118,16,0.7)';
      ctx.fillRect(s / 2 - 0.5, s / 2 - 6, 1, 13);
      ctx.fillRect(s / 2 - 5, s / 2 - 0.5, 10, 1);
      canvas.refresh();
    }

    if (!textures.exists(TEX_HOLY_GRENADE_PIN)) {
      const w = 20;
      const h = 20;
      const canvas = textures.createCanvas(TEX_HOLY_GRENADE_PIN, w, h)!;
      const ctx = canvas.context;
      ctx.fillStyle = 'rgba(255,252,240,0.98)';
      ctx.fillRect(9, 4, 2, 8);
      ctx.fillRect(6, 1, 8, 2);
      ctx.fillRect(8, 0, 4, 4);
      ctx.strokeStyle = 'rgba(167,122,27,0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(10, 10, 5.8, Math.PI * 1.15, Math.PI * 1.92);
      ctx.stroke();
      canvas.refresh();
    }

    if (!textures.exists(TEX_HOLY_GRENADE_GLOW)) {
      const s = 64;
      const canvas = textures.createCanvas(TEX_HOLY_GRENADE_GLOW, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,245,196,0.52)');
      grad.addColorStop(0.36, 'rgba(255,210,92,0.22)');
      grad.addColorStop(0.7, 'rgba(255,182,52,0.08)');
      grad.addColorStop(1, 'rgba(255,182,52,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    if (!textures.exists(TEX_HOLY_GRENADE_SPARK)) {
      const s = 10;
      const canvas = textures.createCanvas(TEX_HOLY_GRENADE_SPARK, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.38, 'rgba(255,238,167,0.92)');
      grad.addColorStop(0.75, 'rgba(231,178,52,0.24)');
      grad.addColorStop(1, 'rgba(231,178,52,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }
  }

  createVisual(id: number, x: number, y: number, size: number): void {
    if (this.visuals.has(id)) return;

    const glow = this.scene.add.image(x, y, TEX_HOLY_GRENADE_GLOW)
      .setDepth(DEPTH.PROJECTILES - 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.68);

    const body = this.scene.add.image(x, y, TEX_HOLY_GRENADE_BODY)
      .setDepth(DEPTH.PROJECTILES)
      .setAlpha(0.98);

    const trim = this.scene.add.image(x, y, TEX_HOLY_GRENADE_TRIM)
      .setDepth(DEPTH.PROJECTILES + 0.2)
      .setAlpha(0.96);

    const pin = this.scene.add.image(x, y, TEX_HOLY_GRENADE_PIN)
      .setDepth(DEPTH.PROJECTILES + 0.3)
      .setOrigin(0.5, 0.78)
      .setAlpha(0.98);

    const sparkEmitter = this.scene.add.particles(x, y, TEX_HOLY_GRENADE_SPARK, {
      lifespan: { min: 160, max: 320 },
      frequency: 26,
      quantity: 1,
      speedX: { min: -18, max: 18 },
      speedY: { min: -18, max: 18 },
      scale: { start: 0.45, end: 0.02 },
      alpha: { start: 0.88, end: 0 },
      tint: [0xffffff, 0xfff0bc, 0xe0ae39],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    });
    sparkEmitter.setDepth(DEPTH.PROJECTILES - 0.4);

    this.visuals.set(id, { glow, body, trim, pin, sparkEmitter });
    this.updateVisual(id, x, y, size, 1, 0);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    const speed = Math.max(Math.hypot(vx, vy), 1);
    const angle = Math.atan2(vy, vx);
    const spin = this.scene.time.now * 0.012;
    const scale = Math.max(size / 18, 0.8);
    const nx = vx / speed;
    const ny = vy / speed;
    const trailingX = x - nx * (size * 0.55);
    const trailingY = y - ny * (size * 0.55);

    visual.glow.setPosition(x, y);
    visual.glow.setRotation(-spin * 0.2);
    visual.glow.setScale(scale * 1.7);
    visual.glow.setAlpha(0.56 + Math.min(speed / 1200, 0.18));

    visual.body.setPosition(x, y);
    visual.body.setRotation(spin);
    visual.body.setScale(scale);

    visual.trim.setPosition(x, y);
    visual.trim.setRotation(spin);
    visual.trim.setScale(scale);

    visual.pin.setPosition(x + Math.cos(spin - Math.PI / 2) * size * 0.06, y - size * 0.54);
    visual.pin.setRotation(angle * 0.15 + spin * 0.45);
    visual.pin.setScale(scale * 0.92);

    visual.sparkEmitter.setPosition(trailingX, trailingY);
    visual.sparkEmitter.setParticleSpeed(Math.max(size * 1.2, 14), 0);
    visual.sparkEmitter.setParticleScale(Math.max(scale * 0.45, 0.2), 0.02);
  }

  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    visual.glow.destroy();
    visual.body.destroy();
    visual.trim.destroy();
    visual.pin.destroy();
    visual.sparkEmitter.stop();
    visual.sparkEmitter.destroy();
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
}