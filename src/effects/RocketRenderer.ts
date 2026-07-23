import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { MiniRocketFlightPhase } from '../types';

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
  bodyColor: number;
  accentColor: number;
  smokeColor: number;
  visualScale: number;
  lastSmokeX: number;
  lastSmokeY: number;
  lastSmokeAt: number;
}

interface RocketSmokeParticle extends Phaser.GameObjects.Particles.Particle {
  rocketSmokeStartScale?: number;
}

export class RocketRenderer {
  private rockets = new Map<number, RocketVisual>();
  private smokeEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private nextSmokeScale = 1;
  private nextSmokeColor = 0xffffff;

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

    this.ensureSmokeEmitter();
  }

  private ensureSmokeEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    if (this.smokeEmitter) return this.smokeEmitter;

    this.smokeEmitter = this.scene.add.particles(0, 0, TEX_ROCKET_SMOKE, {
      lifespan: 1000,
      frequency: -1,
      speedX: { min: -6, max: 6 },
      speedY: { min: -10, max: -2 },
      scale: {
        onEmit: (particle?: Phaser.GameObjects.Particles.Particle) => {
          if (particle) {
            (particle as RocketSmokeParticle).rocketSmokeStartScale = this.nextSmokeScale;
          }
          return this.nextSmokeScale;
        },
        onUpdate: (particle: Phaser.GameObjects.Particles.Particle, _key: string, t: number) => {
          const startScale = (particle as RocketSmokeParticle).rocketSmokeStartScale ?? 1;
          return startScale * (1 + Phaser.Math.Easing.Quadratic.Out(t) * 1.3);
        },
      },
      alpha: { start: 0.95, end: 0, ease: 'Quad.easeOut' },
      tint: {
        onEmit: () => this.nextSmokeColor,
      },
      maxParticles: 640,
      maxAliveParticles: 640,
      reserve: 256,
      emitting: false,
    }).setDepth(DEPTH.FIRE);

    return this.smokeEmitter;
  }

  createVisual(
    id: number,
    x: number,
    y: number,
    size: number,
    color: number,
    accentColor: number,
    smokeColor: number,
    visualScale: number = 1,
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
      bodyColor: color,
      accentColor,
      smokeColor,
      visualScale,
      lastSmokeX: x,
      lastSmokeY: y,
      lastSmokeAt: this.scene.time.now,
    });
    this.updateVisual(id, x, y, size, 1, 0);
  }

  private spawnSmokePuff(x: number, y: number, visualSize: number, smokeColor: number): void {
    const emitter = this.ensureSmokeEmitter();
    this.nextSmokeScale = Math.max(visualSize / 28, 0.28);
    this.nextSmokeColor = smokeColor;
    emitter.emitParticleAt(x, y, 1);
  }

  updateVisual(
    id: number,
    x: number,
    y: number,
    size: number,
    vx: number,
    vy: number,
    miniRocketPhase?: MiniRocketFlightPhase,
    miniRocketCascadeStage = 0,
  ): void {
    const visual = this.rockets.get(id);
    if (!visual) return;

    const angle = Math.atan2(vy, vx);
    const speed = Math.max(1, Math.sqrt(vx * vx + vy * vy));
    const nx = vx / speed;
    const ny = vy / speed;
    const visualSize = size * visual.visualScale;
    const bodyScale = Math.max(size / 10, 0.8) * visual.visualScale;
    const glowScale = Math.max(size / 12, 0.8) * visual.visualScale;
    const engineScaleX = Math.max(size / 12, 0.7) * visual.visualScale;
    const engineScaleY = Math.max(size / 13, 0.6) * visual.visualScale;
    const tailX = x - nx * (visualSize * 0.9);
    const tailY = y - ny * (visualSize * 0.9);
    const pulse = 0.5 + Math.sin(this.scene.time.now * 0.012) * 0.5;
    const phaseColor = miniRocketPhase === 'return'
      ? 0x68ffe1
      : miniRocketPhase === 'coast'
        ? 0xffd36b
        : visual.accentColor;

    visual.body.setPosition(x, y);
    visual.body.setRotation(angle);
    visual.body.setScale(bodyScale, bodyScale);
    visual.body.setTint(visual.bodyColor);

    visual.accent.setPosition(x, y);
    visual.accent.setRotation(angle);
    visual.accent.setScale(bodyScale, bodyScale);
    visual.accent.setTint(phaseColor);
    visual.accent.setAlpha(miniRocketPhase === 'return' ? 0.8 + pulse * 0.2 : 0.95);

    visual.glow.setPosition(x, y);
    visual.glow.setRotation(angle);
    visual.glow.setScale(glowScale * (1 + Math.max(0, miniRocketCascadeStage) * 0.12));
    visual.glow.setTint(phaseColor);
    visual.glow.setAlpha(miniRocketPhase === 'return'
      ? 0.58 + pulse * 0.2
      : miniRocketPhase === 'coast'
        ? 0.5 + pulse * 0.14
      : Math.min(0.68, 0.42 + Math.max(0, miniRocketCascadeStage) * 0.1));

    const engineOffset = visualSize * 0.9;
    visual.engine.setPosition(x - nx * engineOffset, y - ny * engineOffset);
    visual.engine.setRotation(angle + Math.PI);
    visual.engine.setScale(engineScaleX, engineScaleY);
    visual.engine.setTint(phaseColor);
    visual.engine.setAlpha(0.72 + Math.min(speed / 1200, 0.22) + (miniRocketPhase === 'coast' ? pulse * 0.06 : 0));

    const distSinceSmoke = Phaser.Math.Distance.Between(visual.lastSmokeX, visual.lastSmokeY, tailX, tailY);
    const now = this.scene.time.now;
    if (distSinceSmoke >= Math.max(visualSize * 0.55, 5) || now - visual.lastSmokeAt >= 22) {
      const resolvedSmokeColor = miniRocketPhase === 'return'
        ? visual.accentColor
        : visual.smokeColor;
      this.spawnSmokePuff(tailX, tailY, visualSize, resolvedSmokeColor);
      visual.lastSmokeX = tailX;
      visual.lastSmokeY = tailY;
      visual.lastSmokeAt = now;
    }

    visual.exhaustEmitter.setPosition(tailX, tailY);
    visual.exhaustEmitter.setParticleScale(Math.max(size / 34, 0.18), 0.05);
  }

  playCollection(x: number, y: number, color: number): void {
    const ring = this.scene.add.circle(x, y, 8, color, 0.08)
      .setDepth(DEPTH.PROJECTILES + 1)
      .setStrokeStyle(2, color, 0.95)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: ring,
      radius: 38,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    const burst = this.scene.add.particles(x, y, TEX_ROCKET_EXHAUST, {
      lifespan: { min: 260, max: 480 },
      speed: { min: 35, max: 105 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.42, end: 0.02 },
      alpha: { start: 0.95, end: 0 },
      tint: [0xffffff, color, 0x68ffe1],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }).setDepth(DEPTH.PROJECTILES + 1);
    burst.explode(18, x, y);
    this.scene.time.delayedCall(520, () => burst.destroy());
  }

  playSpentDestruction(x: number, y: number, color: number): void {
    const flash = this.scene.add.circle(x, y, 3, color, 0.7)
      .setDepth(DEPTH.PROJECTILES + 1)
      .setStrokeStyle(1.5, 0xffffff, 0.85)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: flash,
      radius: 14,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });

    const sparks = this.scene.add.particles(x, y, TEX_ROCKET_EXHAUST, {
      lifespan: { min: 140, max: 280 },
      speed: { min: 18, max: 60 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.22, end: 0.02 },
      alpha: { start: 0.8, end: 0 },
      tint: [0xffffff, color, 0x8b949b],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }).setDepth(DEPTH.PROJECTILES + 1);
    sparks.explode(8, x, y);
    this.spawnSmokePuff(x, y, 6, color);
    this.scene.time.delayedCall(320, () => sparks.destroy());
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
    this.smokeEmitter?.killAll();
  }
}
