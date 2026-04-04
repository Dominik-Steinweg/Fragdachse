import Phaser from 'phaser';
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
const TEX_HYDRA_SPARK = '__hydra_spark';
const TEX_HYDRA_WISP = '__hydra_wisp';

interface HydraVisual {
  glow: Phaser.GameObjects.Image;
  membrane: Phaser.GameObjects.Image;
  halo: Phaser.GameObjects.Image;
  coreEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  shellEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
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
      [0.22, 'rgba(236,250,255,0.98)'],
      [0.5, 'rgba(170,234,255,0.82)'],
      [0.78, 'rgba(57,133,175,0.24)'],
      [1, 'rgba(5,18,35,0.0)'],
    ]);

    fillRadialGradientTexture(this.scene.textures, TEX_HYDRA_GLOW, 60, [
      [0, 'rgba(214,248,255,0.66)'],
      [0.28, 'rgba(138,223,255,0.38)'],
      [0.6, 'rgba(57,133,175,0.15)'],
      [1, 'rgba(0,0,0,0.0)'],
    ]);

    fillRadialGradientTexture(this.scene.textures, TEX_HYDRA_SPARK, 10, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.36, 'rgba(214,247,255,0.86)'],
      [0.68, 'rgba(107,194,234,0.36)'],
      [1, 'rgba(14,28,52,0.0)'],
    ]);

    fillRadialGradientTexture(this.scene.textures, TEX_HYDRA_WISP, 30, [
      [0, 'rgba(206,247,255,0.34)'],
      [0.4, 'rgba(115,210,242,0.2)'],
      [0.78, 'rgba(52,103,150,0.08)'],
      [1, 'rgba(0,0,0,0.0)'],
    ]);

    ensureCanvasTexture(this.scene.textures, TEX_HYDRA_MEMBRANE, 34, 34, (ctx) => {
      const cx = 17;
      const cy = 17;
      ctx.strokeStyle = 'rgba(255,255,255,0.82)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, 7.8, Math.PI * 0.12, Math.PI * 1.95);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(184,236,255,0.54)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(cx, cy, 10.8, Math.PI * 0.68, Math.PI * 2.22);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(98,188,227,0.34)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy, 5.4, Math.PI * 1.08, Math.PI * 2.8);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.26)';
      for (const node of [
        { x: 10, y: 13, r: 1.4 },
        { x: 22, y: 12, r: 1.2 },
        { x: 20, y: 23, r: 1.3 },
        { x: 14, y: 22, r: 1.1 },
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
      0.84,
      mixColors(color, 0xbcefff, 0.3),
    );

    const halo = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_HYDRA_GLOW),
      DEPTH.PROJECTILES + 0.15,
      0.42,
      mixColors(color, 0xffffff, 0.18),
    );

    const membrane = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_HYDRA_MEMBRANE),
      DEPTH.PROJECTILES + 0.7,
      0.94,
      mixColors(color, 0xffffff, 0.12),
    );

    const coreEmitter = createEmitter(this.scene, x, y, TEX_HYDRA_CORE, {
      lifespan: { min: 110, max: 220 },
      frequency: 14,
      quantity: 2,
      speedX: { min: -18, max: 18 },
      speedY: { min: -18, max: 18 },
      scale: { start: 0.64, end: 0.1 },
      alpha: { start: 0.98, end: 0 },
      tint: [0xffffff, mixColors(color, 0xd8f8ff, 0.18), mixColors(color, 0x1f4e7d, 0.2)],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.PROJECTILES + 1.1);

    const shellEmitter = createEmitter(this.scene, x, y, TEX_HYDRA_SPARK, {
      lifespan: { min: 170, max: 320 },
      frequency: 22,
      quantity: 1,
      speedX: { min: -34, max: 34 },
      speedY: { min: -34, max: 34 },
      scale: { start: 0.82, end: 0.08 },
      alpha: { start: 0.78, end: 0 },
      tint: [0xffffff, mixColors(color, 0xe8fbff, 0.12), mixColors(color, 0x0a1e36, 0.28)],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.PROJECTILES + 0.85);

    const wakeEmitter = createEmitter(this.scene, x, y, TEX_HYDRA_WISP, {
      lifespan: { min: 220, max: 420 },
      frequency: 24,
      quantity: 1,
      speedX: { min: -22, max: 22 },
      speedY: { min: -22, max: 22 },
      scale: { start: 0.82, end: 0.14 },
      alpha: { start: 0.5, end: 0 },
      tint: [mixColors(color, 0xffffff, 0.08), color, mixColors(color, 0x10253f, 0.3)],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.PROJECTILES - 0.05);

    this.visuals.set(id, {
      glow,
      membrane,
      halo,
      coreEmitter,
      shellEmitter,
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
    const heading = Math.atan2(vy, vx);
    const spread = Math.max(size * 0.52, 6);
    const wakeX = x - nx * Math.max(size * 0.9, 9);
    const wakeY = y - ny * Math.max(size * 0.9, 9);

    visual.glow.setPosition(x, y);
    visual.glow.setScale(Math.max(size / 11, 0.95) * (1.06 + pulse * 0.08));
    visual.glow.setAlpha(0.72 + pulse * 0.08);
    visual.glow.setTint(mixColors(color, 0xcaf6ff, 0.24));

    visual.halo.setPosition(x, y);
    visual.halo.setScale(Math.max(size / 14, 0.8) * (1.18 + wobble * 0.1));
    visual.halo.setAlpha(0.34 + pulse * 0.05);
    visual.halo.setTint(mixColors(color, 0xffffff, 0.1));

    visual.membrane.setPosition(x, y);
    visual.membrane.setRotation(heading + pulse * 0.18);
    visual.membrane.setScale(Math.max(size / 14.5, 0.72), Math.max(size / 15.5, 0.68) * (1 + wobble * 0.05));
    visual.membrane.setAlpha(0.86 + pulse * 0.05);
    visual.membrane.setTint(mixColors(color, 0xffffff, 0.12));

    visual.coreEmitter.setPosition(x, y);
    setCircleEmitZone(visual.coreEmitter, spread * 0.32, 2, true);
    visual.coreEmitter.setParticleScale(Math.max(size / 20, 0.34), 0.08);

    visual.shellEmitter.setPosition(x, y);
    setCircleEmitZone(visual.shellEmitter, spread * 0.82, 1, true);
    visual.shellEmitter.setParticleScale(Math.max(size / 22, 0.3), 0.08);

    visual.wakeEmitter.setPosition(wakeX, wakeY);
    setCircleEmitZone(visual.wakeEmitter, spread * 0.58, 1, true);
    visual.wakeEmitter.setParticleScale(Math.max(size / 24, 0.24), 0.12);

    const now = this.scene.time.now;
    const distance = Phaser.Math.Distance.Between(visual.lastTrailX, visual.lastTrailY, wakeX, wakeY);
    if (distance >= Math.max(size * 0.55, 7) || now - visual.lastTrailAt >= 26) {
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
    destroyEmitter(visual.wakeEmitter);
    visual.glow.destroy();
    visual.halo.destroy();
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
      0.82,
      mixColors(color, 0xe4fbff, 0.24),
    ).setScale(Math.max(1.1, scale * 1.65));

    const membrane = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_HYDRA_MEMBRANE),
      DEPTH.PROJECTILES + 1.6,
      0.94,
      mixColors(color, 0xffffff, 0.14),
    ).setScale(Math.max(0.9, scale * 1.08));

    const burst = createEmitter(this.scene, x, y, TEX_HYDRA_SPARK, {
      lifespan: { min: 180, max: 360 },
      quantity: 20,
      speed: { min: 34, max: 190 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.92, end: 0.06 },
      alpha: { start: 0.96, end: 0 },
      tint: [0xffffff, mixColors(color, 0xe8fbff, 0.12), mixColors(color, 0x0d1d35, 0.24)],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.PROJECTILES + 1.75);
    burst.explode(20, 0, 0);

    this.scene.tweens.add({
      targets: glow,
      alpha: 0,
      scaleX: glow.scaleX * 1.7,
      scaleY: glow.scaleY * 1.7,
      duration: 240,
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
    this.scene.time.delayedCall(420, () => destroyEmitter(burst));
  }

  playSplitImpact(x: number, y: number, color: number, childAngles: number[], scale = 1): void {
    if (!isPointInsideArena(x, y)) return;

    this.playImpact(x, y, color, Math.max(scale, 1));

    const pulse = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_HYDRA_GLOW),
      DEPTH.PROJECTILES + 1.5,
      0.92,
      mixColors(color, 0xffffff, 0.18),
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
        tint: [0xffffff, mixColors(color, 0xe8fbff, 0.08), mixColors(color, 0x0b1d33, 0.22)],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      }, DEPTH.PROJECTILES + 1.85);
      emitter.explode(7, 0, 0);
      this.scene.time.delayedCall(320, () => destroyEmitter(emitter));

      const wisp = this.scene.add.image(x, y, TEX_HYDRA_WISP)
        .setDepth(DEPTH.PROJECTILES + 0.9)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0.55)
        .setTint(mixColors(color, 0xcff8ff, 0.14))
        .setScale(Math.max(scale * 0.75, 0.65), Math.max(scale * 0.32, 0.24))
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
      .setAlpha(0.36)
      .setTint(mixColors(color, 0xc9f7ff, 0.12))
      .setScale(Math.max(size / 18, 0.56), Math.max(size / 28, 0.24))
      .setRotation(rotation + Phaser.Math.FloatBetween(-0.22, 0.22));

    this.trailWisps.add(wisp);
    this.scene.tweens.add({
      targets: wisp,
      alpha: 0,
      scaleX: wisp.scaleX * 1.85,
      scaleY: wisp.scaleY * 1.3,
      x: x + Phaser.Math.Between(-9, 9),
      y: y + Phaser.Math.Between(-9, 9),
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.trailWisps.delete(wisp);
        wisp.destroy();
      },
    });
  }
}