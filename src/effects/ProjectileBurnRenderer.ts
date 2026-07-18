import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { createEmitter, destroyEmitter } from './EffectUtils';
import {
  ensureFlameTextures,
  TEX_FLAME_CORE,
  TEX_FLAME_EMBER,
  TEX_FLAME_GLOW,
  TEX_FLAME_SPARK,
} from './FlameShared';

interface BurningProjectileVisual {
  glow: Phaser.GameObjects.Image;
  x: number;
  y: number;
  lastEmitX: number;
  lastEmitY: number;
  size: number;
}

/** Starkes, rendererunabhaengiges Brand-Overlay fuer schnelle und kleine Projektile. */
export class ProjectileBurnRenderer {
  private readonly visuals = new Map<number, BurningProjectileVisual>();
  private readonly outer: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly core: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private readonly scene: Phaser.Scene) {
    ensureFlameTextures(scene);
    this.outer = createEmitter(scene, 0, 0, TEX_FLAME_EMBER, {
      lifespan: { min: 170, max: 360 },
      frequency: -1,
      speedX: { min: -25, max: 25 },
      speedY: { min: -55, max: -15 },
      gravityY: -24,
      scale: { start: 0.72, end: 0.04 },
      alpha: { start: 0.94, end: 0 },
      tint: [0xff7b21, 0xff4417, 0xe52611, 0xffad2f],
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: 900,
      reserve: 260,
      emitting: false,
    }, DEPTH.PROJECTILES + 0.34);
    this.core = createEmitter(scene, 0, 0, TEX_FLAME_CORE, {
      lifespan: { min: 120, max: 250 },
      frequency: -1,
      speedX: { min: -15, max: 15 },
      speedY: { min: -42, max: -9 },
      scale: { start: 0.52, end: 0.025 },
      alpha: { start: 1, end: 0 },
      tint: [0xffffff, 0xffe36b, 0xffa526, 0xff681c],
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: 720,
      reserve: 220,
      emitting: false,
    }, DEPTH.PROJECTILES + 0.39);
    this.sparks = createEmitter(scene, 0, 0, TEX_FLAME_SPARK, {
      lifespan: { min: 170, max: 380 },
      frequency: -1,
      speedX: { min: -52, max: 52 },
      speedY: { min: -105, max: -36 },
      gravityY: -30,
      scale: { start: 0.9, end: 0.04 },
      alpha: { start: 1, end: 0 },
      tint: [0xffffff, 0xffd94f, 0xff7a22, 0xed2d15],
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: 420,
      reserve: 128,
      emitting: false,
    }, DEPTH.PROJECTILES + 0.43);
  }

  sync(id: number, x: number, y: number, size: number, burning: boolean): void {
    if (!burning) {
      this.destroyVisual(id);
      return;
    }

    let visual = this.visuals.get(id);
    if (!visual) {
      const glow = this.scene.add.image(x, y, TEX_FLAME_GLOW)
        .setDepth(DEPTH.PROJECTILES + 0.28)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xff4d18)
        .setAlpha(0.78);
      visual = { glow, x, y, lastEmitX: x, lastEmitY: y, size };
      this.visuals.set(id, visual);
      this.emitAt(x, y, size, 3);
    }

    const dx = x - visual.lastEmitX;
    const dy = y - visual.lastEmitY;
    const distance = Math.hypot(dx, dy);
    const spacing = Math.max(3, Math.min(8, size * 0.75));
    const steps = Phaser.Math.Clamp(Math.ceil(distance / spacing), 1, 7);
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      this.emitAt(visual.lastEmitX + dx * t, visual.lastEmitY + dy * t, size, step === steps ? 2 : 1);
    }

    visual.x = x;
    visual.y = y;
    visual.lastEmitX = x;
    visual.lastEmitY = y;
    visual.size = size;
    const pulse = 0.88 + Math.sin(this.scene.time.now * 0.024 + id * 1.7) * 0.12;
    visual.glow
      .setPosition(x, y)
      .setScale(Math.max(0.68, size / 11) * pulse)
      .setAlpha(0.66 + pulse * 0.18);
  }

  retain(activeBurningIds: ReadonlySet<number>): void {
    for (const id of this.visuals.keys()) {
      if (!activeBurningIds.has(id)) this.destroyVisual(id);
    }
  }

  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    visual.glow.destroy();
    this.visuals.delete(id);
  }

  destroyAll(): void {
    for (const id of [...this.visuals.keys()]) this.destroyVisual(id);
    this.outer.killAll();
    this.core.killAll();
    this.sparks.killAll();
  }

  shutdown(): void {
    this.destroyAll();
    destroyEmitter(this.outer);
    destroyEmitter(this.core);
    destroyEmitter(this.sparks);
  }

  private emitAt(x: number, y: number, size: number, strength: number): void {
    const jitter = Math.max(1.5, size * 0.35);
    const px = x + Phaser.Math.FloatBetween(-jitter, jitter);
    const py = y + Phaser.Math.FloatBetween(-jitter, jitter);
    this.outer.emitParticleAt(px, py, Math.max(1, strength));
    this.core.emitParticleAt(px, py + 1, 1);
    if ((Math.floor(this.scene.time.now) + Math.round(x + y)) % 3 === 0) {
      this.sparks.emitParticleAt(px, py, 1);
    }
  }
}
