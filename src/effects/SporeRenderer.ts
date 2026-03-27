import Phaser from 'phaser';
import { DEPTH, isPointInsideArena } from '../config';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  setCircleEmitZone,
} from './EffectUtils';

const TEX_SPORE_CORE = '__spore_core';
const TEX_SPORE_GLOW = '__spore_glow';
const TEX_SPORE_CLUSTER = '__spore_cluster';
const TEX_SPORE_MOTE = '__spore_mote';
const TEX_SPORE_TRAIL = '__spore_trail';

interface SporeVisual {
  glow: Phaser.GameObjects.Image;
  cluster: Phaser.GameObjects.Image;
  coreEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  wakeEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  lastTrailX: number;
  lastTrailY: number;
  lastTrailAt: number;
}

export class SporeRenderer {
  private visuals = new Map<number, SporeVisual>();
  private trailPuffs = new Set<Phaser.GameObjects.Image>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_SPORE_CORE, 18, [
      [0, 'rgba(247,255,226,1.0)'],
      [0.24, 'rgba(226,255,173,0.96)'],
      [0.55, 'rgba(161,224,95,0.7)'],
      [1, 'rgba(61,115,34,0.0)'],
    ]);

    fillRadialGradientTexture(this.scene.textures, TEX_SPORE_GLOW, 54, [
      [0, 'rgba(204,255,118,0.48)'],
      [0.35, 'rgba(121,201,74,0.26)'],
      [0.72, 'rgba(65,112,38,0.08)'],
      [1, 'rgba(0,0,0,0.0)'],
    ]);

    fillRadialGradientTexture(this.scene.textures, TEX_SPORE_MOTE, 10, [
      [0, 'rgba(251,255,237,1.0)'],
      [0.35, 'rgba(202,246,123,0.9)'],
      [0.72, 'rgba(112,183,67,0.28)'],
      [1, 'rgba(34,62,18,0.0)'],
    ]);

    fillRadialGradientTexture(this.scene.textures, TEX_SPORE_TRAIL, 28, [
      [0, 'rgba(226,255,160,0.35)'],
      [0.42, 'rgba(146,217,89,0.22)'],
      [0.78, 'rgba(88,128,49,0.08)'],
      [1, 'rgba(0,0,0,0.0)'],
    ]);

    ensureCanvasTexture(this.scene.textures, TEX_SPORE_CLUSTER, 32, 32, (ctx) => {
      const cx = 16;
      const cy = 16;
      const nodes = [
        { x: 16, y: 16, r: 5.5, a: 0.95 },
        { x: 11, y: 14, r: 4.2, a: 0.82 },
        { x: 20, y: 13, r: 3.8, a: 0.78 },
        { x: 14, y: 20, r: 3.6, a: 0.72 },
        { x: 21, y: 19, r: 3.1, a: 0.68 },
      ];

      for (const node of nodes) {
        const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.r);
        gradient.addColorStop(0, `rgba(247,255,229,${node.a})`);
        gradient.addColorStop(0.45, `rgba(201,244,118,${node.a * 0.95})`);
        gradient.addColorStop(1, 'rgba(85,132,42,0.0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = 'rgba(55,98,28,0.7)';
      for (const dot of [
        { x: 10, y: 11, r: 1.1 },
        { x: 22, y: 11, r: 1.0 },
        { x: 17, y: 22, r: 1.2 },
        { x: 24, y: 18, r: 0.9 },
      ]) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = 'rgba(245,255,228,0.45)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(cx, cy, 9.5, Math.PI * 0.18, Math.PI * 1.72);
      ctx.stroke();
    });
  }

  createVisual(id: number, x: number, y: number, size: number, color: number): void {
    if (this.visuals.has(id)) return;

    const glow = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_SPORE_GLOW),
      DEPTH.PROJECTILES - 0.2,
      0.62,
      Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(color),
        Phaser.Display.Color.ValueToColor(0x95d85b),
        100,
        42,
      ).color,
    );

    const cluster = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_SPORE_CLUSTER),
      DEPTH.PROJECTILES + 0.5,
      0.96,
      color,
    );

    const coreEmitter = createEmitter(this.scene, x, y, TEX_SPORE_CORE, {
      lifespan: { min: 90, max: 170 },
      frequency: 16,
      quantity: 2,
      speedX: { min: -10, max: 10 },
      speedY: { min: -10, max: 10 },
      scale: { start: 0.62, end: 0.08 },
      alpha: { start: 0.95, end: 0 },
      tint: [0xf5ffdf, color, 0x7db749],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.PROJECTILES + 1);

    const wakeEmitter = createEmitter(this.scene, x, y, TEX_SPORE_MOTE, {
      lifespan: { min: 180, max: 320 },
      frequency: 18,
      quantity: 1,
      speedX: { min: -18, max: 18 },
      speedY: { min: -18, max: 18 },
      scale: { start: 0.54, end: 0.05 },
      alpha: { start: 0.72, end: 0 },
      tint: [0xe8ffbf, 0xa2dd61, 0x5c8b32],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.PROJECTILES + 0.2);

    this.visuals.set(id, {
      glow,
      cluster,
      coreEmitter,
      wakeEmitter,
      lastTrailX: x,
      lastTrailY: y,
      lastTrailAt: this.scene.time.now,
    });
    this.updateVisual(id, x, y, size, 0, 0, color);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number, color: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    const speed = Math.max(1, Math.hypot(vx, vy));
    const nx = vx / speed;
    const ny = vy / speed;
    const pulse = Math.sin(this.scene.time.now * 0.018 + id * 0.37);
    const rotation = Math.atan2(vy, vx);
    const spread = Math.max(size * 0.46, 4.5);
    const trailX = x - nx * Math.max(size * 0.75, 8);
    const trailY = y - ny * Math.max(size * 0.75, 8);

    visual.glow.setPosition(x, y);
    visual.glow.setScale(Math.max(size / 13, 0.78) * (1.02 + pulse * 0.08));
    visual.glow.setAlpha(0.52 + pulse * 0.08);
    visual.glow.setTint(Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(color),
      Phaser.Display.Color.ValueToColor(0x83cc4a),
      100,
      40,
    ).color);

    visual.cluster.setPosition(x, y);
    visual.cluster.setRotation(rotation + pulse * 0.16);
    visual.cluster.setScale(Math.max(size / 15, 0.72), Math.max(size / 16, 0.68));
    visual.cluster.setTint(color);

    visual.coreEmitter.setPosition(x, y);
    setCircleEmitZone(visual.coreEmitter, spread * 0.38, 2, true);
    visual.coreEmitter.setParticleScale(Math.max(size / 22, 0.3), 0.08);

    visual.wakeEmitter.setPosition(trailX, trailY);
    setCircleEmitZone(visual.wakeEmitter, spread * 0.72, 1, true);
    visual.wakeEmitter.setParticleScale(Math.max(size / 26, 0.22), 0.05);

    const now = this.scene.time.now;
    const distance = Phaser.Math.Distance.Between(visual.lastTrailX, visual.lastTrailY, trailX, trailY);
    if (distance >= Math.max(size * 0.48, 6) || now - visual.lastTrailAt >= 24) {
      this.spawnTrailPuff(trailX, trailY, size, rotation + Math.PI);
      visual.lastTrailX = trailX;
      visual.lastTrailY = trailY;
      visual.lastTrailAt = now;
    }
  }

  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    destroyEmitter(visual.coreEmitter);
    destroyEmitter(visual.wakeEmitter);
    visual.glow.destroy();
    visual.cluster.destroy();
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
    for (const puff of this.trailPuffs) {
      puff.destroy();
    }
    this.trailPuffs.clear();
  }

  playImpact(x: number, y: number, color: number, scale = 1): void {
    if (!isPointInsideArena(x, y)) return;

    const glow = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_SPORE_GLOW),
      DEPTH.PROJECTILES + 1.3,
      0.72,
      color,
    ).setScale(Math.max(1, scale * 1.8));

    const cluster = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_SPORE_CLUSTER),
      DEPTH.PROJECTILES + 1.5,
      0.92,
      color,
    ).setScale(Math.max(0.9, scale * 1.05));

    const burst = createEmitter(this.scene, x, y, TEX_SPORE_MOTE, {
      lifespan: { min: 220, max: 420 },
      quantity: 28,
      speed: { min: 30, max: 155 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0.08 },
      alpha: { start: 0.95, end: 0 },
      tint: [0xf2ffd8, color, 0x74ab3c],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.PROJECTILES + 1.7);
    setCircleEmitZone(burst, Math.max(8, scale * 9), 28, true);
    burst.explode(28, 0, 0);

    const haze = createEmitter(this.scene, x, y, TEX_SPORE_TRAIL, {
      lifespan: { min: 260, max: 540 },
      quantity: 10,
      speed: { min: 14, max: 62 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.95, end: 0.2 },
      alpha: { start: 0.5, end: 0 },
      tint: [0xd7ff9d, 0x98d65a, 0x577d30],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.FIRE + 0.2);
    haze.explode(10, 0, 0);

    this.scene.tweens.add({
      targets: glow,
      alpha: 0,
      scaleX: glow.scaleX * 1.7,
      scaleY: glow.scaleY * 1.7,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => glow.destroy(),
    });
    this.scene.tweens.add({
      targets: cluster,
      alpha: 0,
      scaleX: cluster.scaleX * 1.45,
      scaleY: cluster.scaleY * 1.45,
      rotation: cluster.rotation + 0.9,
      duration: 220,
      ease: 'Cubic.easeOut',
      onComplete: () => cluster.destroy(),
    });
    this.scene.time.delayedCall(560, () => {
      destroyEmitter(burst);
      destroyEmitter(haze);
    });
  }

  private spawnTrailPuff(x: number, y: number, size: number, rotation: number): void {
    const puff = this.scene.add.image(x, y, TEX_SPORE_TRAIL)
      .setDepth(DEPTH.PROJECTILES - 0.3)
      .setAlpha(0.44)
      .setTint(0x9ad85c)
      .setScale(Math.max(size / 20, 0.5), Math.max(size / 28, 0.32))
      .setRotation(rotation + Phaser.Math.FloatBetween(-0.28, 0.28));

    this.trailPuffs.add(puff);
    this.scene.tweens.add({
      targets: puff,
      alpha: 0,
      scaleX: puff.scaleX * 1.8,
      scaleY: puff.scaleY * 1.45,
      x: x + Phaser.Math.Between(-8, 8),
      y: y + Phaser.Math.Between(-8, 8),
      duration: 280,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.trailPuffs.delete(puff);
        puff.destroy();
      },
    });
  }
}