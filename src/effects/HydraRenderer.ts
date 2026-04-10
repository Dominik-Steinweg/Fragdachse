import * as Phaser from 'phaser';
import { DEPTH, isPointInsideArena } from '../config';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  mixColors,
  setCircleEmitZone,
} from './EffectUtils';

const TEX_HYDRA_CORE = '__hydra_core';
const TEX_HYDRA_GLOW = '__hydra_glow';
const TEX_HYDRA_MEMBRANE = '__hydra_membrane';
const TEX_HYDRA_CLUSTER = '__hydra_cluster';
const TEX_HYDRA_SPARK = '__hydra_spark';
const TEX_HYDRA_WISP = '__hydra_wisp';

interface HydraVisual {
  glow: Phaser.GameObjects.Image;
  membrane: Phaser.GameObjects.Image;
  cluster: Phaser.GameObjects.Image;
  coreEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  shellEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  moteEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  wakeEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  lastTrailX: number;
  lastTrailY: number;
  lastTrailAt: number;
}

export class HydraRenderer {
  private visuals = new Map<number, HydraVisual>();
  private trailWisps = new Set<Phaser.GameObjects.Image>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_HYDRA_CORE, 20, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.18, 'rgba(255,255,255,0.98)'],
      [0.46, 'rgba(244,244,244,0.82)'],
      [0.72, 'rgba(168,168,168,0.24)'],
      [1, 'rgba(10,10,10,0.0)'],
    ]);

    fillRadialGradientTexture(this.scene.textures, TEX_HYDRA_GLOW, 60, [
      [0, 'rgba(255,255,255,0.68)'],
      [0.26, 'rgba(255,255,255,0.34)'],
      [0.58, 'rgba(190,190,190,0.12)'],
      [1, 'rgba(0,0,0,0.0)'],
    ]);

    fillRadialGradientTexture(this.scene.textures, TEX_HYDRA_SPARK, 10, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.34, 'rgba(245,245,245,0.86)'],
      [0.66, 'rgba(180,180,180,0.36)'],
      [1, 'rgba(24,24,24,0.0)'],
    ]);

    ensureCanvasTexture(this.scene.textures, TEX_HYDRA_WISP, 44, 20, (ctx) => {
      const gradient = ctx.createLinearGradient(2, 10, 42, 10);
      gradient.addColorStop(0, 'rgba(255,255,255,0.0)');
      gradient.addColorStop(0.18, 'rgba(255,255,255,0.12)');
      gradient.addColorStop(0.56, 'rgba(255,255,255,0.34)');
      gradient.addColorStop(0.82, 'rgba(255,255,255,0.2)');
      gradient.addColorStop(1, 'rgba(255,255,255,0.0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(2, 10);
      ctx.quadraticCurveTo(13, 4, 28, 6);
      ctx.quadraticCurveTo(40, 8, 42, 10);
      ctx.quadraticCurveTo(40, 12, 28, 14);
      ctx.quadraticCurveTo(13, 16, 2, 10);
      ctx.closePath();
      ctx.fill();
    });

    ensureCanvasTexture(this.scene.textures, TEX_HYDRA_CLUSTER, 34, 34, (ctx) => {
      const nodes = [
        { x: 16.5, y: 16.5, r: 6.6, a: 0.92 },
        { x: 11.8, y: 14.6, r: 4.8, a: 0.72 },
        { x: 22.3, y: 13.2, r: 4.4, a: 0.68 },
        { x: 13.7, y: 22.1, r: 4.1, a: 0.64 },
        { x: 21.6, y: 21.2, r: 3.8, a: 0.58 },
      ];

      for (const node of nodes) {
        const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.r);
        gradient.addColorStop(0, `rgba(255,255,255,${node.a})`);
        gradient.addColorStop(0.48, `rgba(245,245,245,${node.a * 0.72})`);
        gradient.addColorStop(1, 'rgba(120,120,120,0.0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(8, 15);
      ctx.bezierCurveTo(13, 7, 22, 8, 26, 15);
      ctx.bezierCurveTo(28, 20, 21, 27, 14, 25);
      ctx.stroke();
    });

    ensureCanvasTexture(this.scene.textures, TEX_HYDRA_MEMBRANE, 34, 34, (ctx) => {
      const cx = 17;
      const cy = 17;
      ctx.strokeStyle = 'rgba(255,255,255,0.72)';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(7, 17);
      ctx.bezierCurveTo(8, 10, 13, 6.4, 18, 7.2);
      ctx.bezierCurveTo(24.5, 8.1, 28.4, 13.4, 27.3, 19.1);
      ctx.bezierCurveTo(26.2, 25.1, 19.8, 27.7, 13.9, 25.6);
      ctx.bezierCurveTo(9.6, 24.1, 6.1, 20.4, 7, 17);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx.lineWidth = 0.95;
      ctx.beginPath();
      ctx.moveTo(10.8, 11.6);
      ctx.quadraticCurveTo(cx, 5.5, 23.9, 11.4);
      ctx.quadraticCurveTo(28.4, 17.1, 22.7, 23.2);
      ctx.quadraticCurveTo(16.4, 28.3, 10.4, 22.6);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (const node of [
        { x: 9.8, y: 13.4, r: 1.2 },
        { x: 23.4, y: 11.9, r: 1.1 },
        { x: 21.5, y: 23.1, r: 1.15 },
        { x: 13.1, y: 23.6, r: 1.0 },
      ]) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  createVisual(id: number, x: number, y: number, size: number, color: number): void {
    if (this.visuals.has(id)) return;

    const glow = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_HYDRA_GLOW),
      DEPTH.PROJECTILES - 0.25,
      0.52,
      mixColors(color, 0xffffff, 0.04),
    );

    const membrane = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_HYDRA_MEMBRANE),
      DEPTH.PROJECTILES + 0.7,
      0.82,
      mixColors(color, 0xffffff, 0.06),
    );

    const cluster = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_HYDRA_CLUSTER),
      DEPTH.PROJECTILES + 0.55,
      0.9,
      mixColors(color, 0xffffff, 0.04),
    );

    const coreEmitter = createEmitter(this.scene, x, y, TEX_HYDRA_CORE, {
      lifespan: { min: 120, max: 240 },
      frequency: 12,
      quantity: 3,
      speedX: { min: -20, max: 20 },
      speedY: { min: -20, max: 20 },
      scale: { start: 0.72, end: 0.08 },
      alpha: { start: 0.98, end: 0 },
      tint: [0xffffff, color, mixColors(color, 0xffffff, 0.16)],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.PROJECTILES + 1.1);

    const shellEmitter = createEmitter(this.scene, x, y, TEX_HYDRA_SPARK, {
      lifespan: { min: 180, max: 360 },
      frequency: 16,
      quantity: 2,
      speedX: { min: -44, max: 44 },
      speedY: { min: -44, max: 44 },
      scale: { start: 0.94, end: 0.06 },
      alpha: { start: 0.86, end: 0 },
      tint: [0xffffff, color, mixColors(color, 0x080f19, 0.2)],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.PROJECTILES + 0.85);

    const moteEmitter = createEmitter(this.scene, x, y, TEX_HYDRA_SPARK, {
      lifespan: { min: 220, max: 420 },
      frequency: 20,
      quantity: 1,
      speedX: { min: -16, max: 16 },
      speedY: { min: -16, max: 16 },
      scale: { start: 0.46, end: 0.04 },
      alpha: { start: 0.62, end: 0 },
      tint: [mixColors(color, 0xffffff, 0.1), color, mixColors(color, 0x050a14, 0.3)],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.PROJECTILES + 0.95);

    const wakeEmitter = createEmitter(this.scene, x, y, TEX_HYDRA_WISP, {
      lifespan: { min: 220, max: 420 },
      frequency: 18,
      quantity: 1,
      speedX: { min: -12, max: 12 },
      speedY: { min: -12, max: 12 },
      scaleX: { start: 0.6, end: 0.12 },
      scaleY: { start: 0.32, end: 0.08 },
      rotate: { min: -8, max: 8 },
      alpha: { start: 0.12, end: 0 },
      tint: [mixColors(color, 0xffffff, 0.04), color, mixColors(color, 0x07101b, 0.18)],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.PROJECTILES - 0.05);

    this.visuals.set(id, {
      glow,
      membrane,
      cluster,
      coreEmitter,
      shellEmitter,
      moteEmitter,
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
    const pulse = Math.sin(this.scene.time.now * 0.018 + id * 0.43);
    const wobble = Math.cos(this.scene.time.now * 0.011 + id * 0.27);
    const drift = Math.sin(this.scene.time.now * 0.014 + id * 0.63);
    const heading = Math.atan2(vy, vx);
    const spread = Math.max(size * 0.54, 6.5);
    const wakeDistance = Math.max(size * 1.95, 20);
    const wakeX = x - nx * wakeDistance + -ny * drift * Math.max(size * 0.08, 1.4);
    const wakeY = y - ny * wakeDistance + nx * drift * Math.max(size * 0.08, 1.4);

    visual.glow.setPosition(x, y);
    visual.glow.setScale(Math.max(size / 13.8, 0.78) * (1.04 + pulse * 0.06));
    visual.glow.setAlpha(0.42 + pulse * 0.04);
    visual.glow.setTint(mixColors(color, 0xffffff, 0.03));

    visual.cluster.setPosition(x, y);
    visual.cluster.setRotation(-heading * 0.45 + wobble * 0.22);
    visual.cluster.setScale(Math.max(size / 14.6, 0.74) * (1.02 + pulse * 0.04));
    visual.cluster.setAlpha(0.9);
    visual.cluster.setTint(mixColors(color, 0xffffff, 0.02));

    visual.membrane.setPosition(x, y);
    visual.membrane.setRotation(heading + pulse * 0.26);
    visual.membrane.setScale(Math.max(size / 14.1, 0.76), Math.max(size / 17.2, 0.64) * (1 + wobble * 0.06));
    visual.membrane.setAlpha(0.62 + pulse * 0.06);
    visual.membrane.setTint(mixColors(color, 0xffffff, 0.04));

    visual.coreEmitter.setPosition(x, y);
    setCircleEmitZone(visual.coreEmitter, spread * 0.28, 3, true);
    visual.coreEmitter.setParticleScale(Math.max(size / 18, 0.42), 0.08);

    visual.shellEmitter.setPosition(x, y);
    setCircleEmitZone(visual.shellEmitter, spread * 0.88, 2, true);
    visual.shellEmitter.setParticleScale(Math.max(size / 21, 0.3), 0.05);

    visual.moteEmitter.setPosition(x + -ny * drift * 3, y + nx * drift * 3);
    setCircleEmitZone(visual.moteEmitter, spread * 0.46, 2, true);
    visual.moteEmitter.setParticleScale(Math.max(size / 30, 0.18), 0.04);

    visual.wakeEmitter.setPosition(wakeX, wakeY);
    visual.wakeEmitter.setAngle(Phaser.Math.RadToDeg(heading) + 180);
    setCircleEmitZone(visual.wakeEmitter, Math.max(size * 0.08, 1.6), 1, true);
    visual.wakeEmitter.setParticleScale(Math.max(size / 22, 0.26), 0.08);

    const now = this.scene.time.now;
    const distance = Phaser.Math.Distance.Between(visual.lastTrailX, visual.lastTrailY, wakeX, wakeY);
    if (distance >= Math.max(size * 0.7, 8) || now - visual.lastTrailAt >= 34) {
      this.spawnTrailWisp(wakeX, wakeY, size, heading + Math.PI, color);
      visual.lastTrailX = wakeX;
      visual.lastTrailY = wakeY;
      visual.lastTrailAt = now;
    }
  }

  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    destroyEmitter(visual.coreEmitter);
    destroyEmitter(visual.shellEmitter);
    destroyEmitter(visual.moteEmitter);
    destroyEmitter(visual.wakeEmitter);
    visual.glow.destroy();
    visual.cluster.destroy();
    visual.membrane.destroy();
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
    for (const wisp of this.trailWisps) {
      wisp.destroy();
    }
    this.trailWisps.clear();
  }

  playImpact(x: number, y: number, color: number, scale = 1): void {
    if (!isPointInsideArena(x, y)) return;

    const glow = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_HYDRA_GLOW),
      DEPTH.PROJECTILES + 1.4,
      0.62,
      mixColors(color, 0xffffff, 0.05),
    ).setScale(Math.max(0.9, scale * 1.15));

    const cluster = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_HYDRA_CLUSTER),
      DEPTH.PROJECTILES + 1.52,
      0.9,
      mixColors(color, 0xffffff, 0.03),
    ).setScale(Math.max(0.88, scale * 1.02));

    const membrane = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_HYDRA_MEMBRANE),
      DEPTH.PROJECTILES + 1.6,
      0.74,
      mixColors(color, 0xffffff, 0.08),
    ).setScale(Math.max(0.82, scale * 0.96));

    const burst = createEmitter(this.scene, x, y, TEX_HYDRA_SPARK, {
      lifespan: { min: 180, max: 360 },
      quantity: 20,
      speed: { min: 34, max: 190 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.92, end: 0.06 },
      alpha: { start: 0.96, end: 0 },
      tint: [0xffffff, color, mixColors(color, 0x0d1d35, 0.22)],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.PROJECTILES + 1.75);
    burst.explode(20, 0, 0);

    this.scene.tweens.add({
      targets: glow,
      alpha: 0,
      scaleX: glow.scaleX * 1.45,
      scaleY: glow.scaleY * 1.45,
      duration: 200,
      ease: 'Quad.easeOut',
      onComplete: () => glow.destroy(),
    });
    this.scene.tweens.add({
      targets: membrane,
      alpha: 0,
      scaleX: membrane.scaleX * 1.6,
      scaleY: membrane.scaleY * 1.6,
      rotation: Math.PI * 0.72,
      duration: 210,
      ease: 'Cubic.easeOut',
      onComplete: () => membrane.destroy(),
    });
    this.scene.tweens.add({
      targets: cluster,
      alpha: 0,
      scaleX: cluster.scaleX * 1.4,
      scaleY: cluster.scaleY * 1.28,
      rotation: 0.9,
      duration: 220,
      ease: 'Cubic.easeOut',
      onComplete: () => cluster.destroy(),
    });
    this.scene.time.delayedCall(420, () => destroyEmitter(burst));
  }

  playSplitImpact(x: number, y: number, color: number, childAngles: number[], scale = 1): void {
    if (!isPointInsideArena(x, y)) return;

    this.playImpact(x, y, color, Math.max(scale, 1));

    const pulse = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_HYDRA_GLOW),
      DEPTH.PROJECTILES + 1.5,
      0.92,
      color,
    ).setScale(Math.max(1.2, scale * 1.15));

    this.scene.tweens.add({
      targets: pulse,
      alpha: 0,
      scaleX: pulse.scaleX * 2.2,
      scaleY: pulse.scaleY * 2.2,
      duration: 190,
      ease: 'Quad.easeOut',
      onComplete: () => pulse.destroy(),
    });

    for (const angle of childAngles) {
      const emitter = createEmitter(this.scene, x, y, TEX_HYDRA_SPARK, {
        lifespan: { min: 140, max: 260 },
        quantity: 7,
        speed: { min: 85 * scale, max: 220 * scale },
        angle: {
          min: Phaser.Math.RadToDeg(angle) - 10,
          max: Phaser.Math.RadToDeg(angle) + 10,
        },
        scale: { start: 0.86, end: 0.05 },
        alpha: { start: 0.98, end: 0 },
        tint: [0xffffff, color, mixColors(color, 0x0b1d33, 0.18)],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      }, DEPTH.PROJECTILES + 1.85);
      emitter.explode(7, 0, 0);
      this.scene.time.delayedCall(320, () => destroyEmitter(emitter));

      const wisp = this.scene.add.image(x, y, TEX_HYDRA_WISP)
        .setDepth(DEPTH.PROJECTILES + 0.9)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0.58)
        .setTint(color)
        .setScale(Math.max(scale * 0.9, 0.72), Math.max(scale * 0.3, 0.24))
        .setRotation(angle);
      this.trailWisps.add(wisp);
      this.scene.tweens.add({
        targets: wisp,
        alpha: 0,
        x: x + Math.cos(angle) * Math.max(26, scale * 28),
        y: y + Math.sin(angle) * Math.max(26, scale * 28),
        scaleX: wisp.scaleX * 1.8,
        scaleY: wisp.scaleY * 1.25,
        duration: 220,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          this.trailWisps.delete(wisp);
          wisp.destroy();
        },
      });
    }
  }

  private spawnTrailWisp(x: number, y: number, size: number, rotation: number, color: number): void {
    const wisp = this.scene.add.image(x, y, TEX_HYDRA_WISP)
      .setDepth(DEPTH.PROJECTILES - 0.2)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.4)
      .setTint(mixColors(color, 0xffffff, 0.04))
      .setScale(Math.max(size / 20, 0.48), Math.max(size / 36, 0.12))
      .setRotation(rotation + Phaser.Math.FloatBetween(-0.3, 0.3));

    this.trailWisps.add(wisp);
    this.scene.tweens.add({
      targets: wisp,
      alpha: 0,
      scaleX: wisp.scaleX * 1.45,
      scaleY: wisp.scaleY * 1.08,
      x: x + Phaser.Math.Between(-6, 6),
      y: y + Phaser.Math.Between(-6, 6),
      duration: 1000,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.trailWisps.delete(wisp);
        wisp.destroy();
      },
    });
  }
}