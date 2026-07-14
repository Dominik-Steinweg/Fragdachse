import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { addInternalGlow, setInternalFxPadding } from '../utils/phaserFx';
import {
  circleZone,
  createEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
} from './EffectUtils';

const TEX_BLACK_HOLE = '__black_hole';
const TEX_BLACK_HOLE_HORIZON = '__black_hole_horizon';
const TEX_BLACK_HOLE_MOTE = '__black_hole_mote';
const TEX_BLACK_HOLE_WISP = '__black_hole_wisp';

function createInwardOrbitCallback(
  centerX: number,
  centerY: number,
  tangentialSpeed: number,
  inwardSpeed: number,
): (particle: Phaser.GameObjects.Particles.Particle) => void {
  return (particle) => {
    const offsetX = particle.x - centerX;
    const offsetY = particle.y - centerY;
    const distance = Math.max(1, Math.hypot(offsetX, offsetY));
    const inwardX = -offsetX / distance;
    const inwardY = -offsetY / distance;
    const tangentX = -offsetY / distance;
    const tangentY = offsetX / distance;
    const tangentialVariance = Phaser.Math.FloatBetween(0.58, 1.24);
    const inwardVariance = Phaser.Math.FloatBetween(0.82, 1.62);
    const particleScale = Phaser.Math.FloatBetween(0.58, 1.38);

    particle.velocityX = tangentX * tangentialSpeed * tangentialVariance + inwardX * inwardSpeed * inwardVariance;
    particle.velocityY = tangentY * tangentialSpeed * tangentialVariance + inwardY * inwardSpeed * inwardVariance;
    particle.rotation = Math.atan2(particle.velocityY, particle.velocityX);
    particle.scaleX *= particleScale;
    particle.scaleY *= particleScale;
  };
}

/** A deliberately restrained local visual for host-synchronized black-hole fields. */
export class BlackHoleRenderer {
  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    ensureCanvasTexture(this.scene.textures, TEX_BLACK_HOLE, 256, 256, (ctx) => {
      const center = 128;
      const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
      gradient.addColorStop(0, 'rgba(0,0,0,0.94)');
      gradient.addColorStop(0.12, 'rgba(10,4,22,0.82)');
      gradient.addColorStop(0.28, 'rgba(24,10,44,0.38)');
      gradient.addColorStop(0.55, 'rgba(18,8,38,0.11)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
    });

    fillRadialGradientTexture(this.scene.textures, TEX_BLACK_HOLE_HORIZON, 128, [
      [0, 'rgba(0,0,0,0.98)'],
      [0.23, 'rgba(3,1,8,0.96)'],
      [0.43, 'rgba(30,9,56,0.9)'],
      [0.56, 'rgba(151,90,214,0.58)'],
      [0.68, 'rgba(212,168,255,0.16)'],
      [1, 'rgba(54,20,96,0)'],
    ]);

    fillRadialGradientTexture(this.scene.textures, TEX_BLACK_HOLE_MOTE, 20, [
      [0, 'rgba(255,255,255,0.96)'],
      [0.24, 'rgba(231,205,255,0.74)'],
      [0.62, 'rgba(148,89,210,0.2)'],
      [1, 'rgba(75,32,120,0)'],
    ]);

    ensureCanvasTexture(this.scene.textures, TEX_BLACK_HOLE_WISP, 72, 24, (ctx) => {
      const gradient = ctx.createLinearGradient(2, 12, 70, 12);
      gradient.addColorStop(0, 'rgba(182,125,244,0)');
      gradient.addColorStop(0.24, 'rgba(194,147,248,0.14)');
      gradient.addColorStop(0.52, 'rgba(242,224,255,0.56)');
      gradient.addColorStop(0.78, 'rgba(179,121,238,0.17)');
      gradient.addColorStop(1, 'rgba(124,70,193,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(2, 12);
      ctx.quadraticCurveTo(19, 3, 42, 7);
      ctx.quadraticCurveTo(62, 8, 70, 12);
      ctx.quadraticCurveTo(60, 16, 39, 18);
      ctx.quadraticCurveTo(17, 20, 2, 12);
      ctx.closePath();
      ctx.fill();
    });
  }

  play(x: number, y: number, radius: number, durationMs: number): void {
    const diameter = Math.max(24, radius * 2);
    const fadeDuration = Math.min(280, Math.max(160, durationMs * 0.2));
    const fadeDelay = Math.max(0, durationMs - fadeDuration);
    const core = this.scene.add.image(x, y, TEX_BLACK_HOLE)
      .setDepth(DEPTH.FIRE - 0.1)
      .setBlendMode(Phaser.BlendModes.NORMAL)
      .setDisplaySize(diameter * 1.06, diameter * 0.9)
      .setAlpha(0);
    const horizon = this.scene.add.image(x, y, TEX_BLACK_HOLE_HORIZON)
      .setDepth(DEPTH.FIRE - 0.07)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(Math.max(16, diameter * 0.25), Math.max(16, diameter * 0.21))
      .setAlpha(0);
    setInternalFxPadding(horizon, 12);
    addInternalGlow(horizon, 0x9c64df, 0.09, 0.015, false, 0.12, 7);

    const outerOrbitEmitter = createEmitter(this.scene, x, y, TEX_BLACK_HOLE_MOTE, {
      lifespan: { min: 920, max: 1320 },
      frequency: 34,
      quantity: { min: 1, max: 2 },
      maxParticles: 72,
      maxAliveParticles: 48,
      reserve: 48,
      emitZone: circleZone(radius * 0.96),
      speed: 0,
      emitCallback: createInwardOrbitCallback(0, 0, 58, 16),
      scale: { start: 0.56, end: 0.04 },
      alpha: { start: 0.42, end: 0 },
      tint: [0x7847a9, 0xa970df, 0xe5c7ff],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.FIRE - 0.055).setAlpha(0);
    outerOrbitEmitter.createGravityWell({
      x: 0,
      y: 0,
      power: 1.7,
      epsilon: Math.max(40, radius * 0.36),
      gravity: 26,
    });
    outerOrbitEmitter.emitParticle(18);

    const wispEmitter = createEmitter(this.scene, x, y, TEX_BLACK_HOLE_WISP, {
      lifespan: { min: 880, max: 1280 },
      frequency: 54,
      quantity: { min: 1, max: 2 },
      maxParticles: 48,
      maxAliveParticles: 32,
      reserve: 32,
      emitZone: circleZone(radius * 0.76),
      speed: 0,
      emitCallback: createInwardOrbitCallback(0, 0, 44, 20),
      scale: { start: 0.58, end: 0.07 },
      alpha: { start: 0.28, end: 0 },
      tint: [0x8050b4, 0xb985ea, 0xe1c2ff],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.FIRE - 0.052).setAlpha(0);
    wispEmitter.createGravityWell({
      x: 0,
      y: 0,
      power: 1.35,
      epsilon: Math.max(34, radius * 0.3),
      gravity: 21,
    });
    wispEmitter.emitParticle(12);

    const innerOrbitEmitter = createEmitter(this.scene, x, y, TEX_BLACK_HOLE_MOTE, {
      lifespan: { min: 900, max: 1420 },
      frequency: 24,
      quantity: { min: 1, max: 2 },
      maxParticles: 84,
      maxAliveParticles: 54,
      reserve: 54,
      emitZone: circleZone(radius * 0.34),
      speed: 0,
      emitCallback: createInwardOrbitCallback(0, 0, 58, 25),
      scale: { start: 0.5, end: 0.03 },
      alpha: { start: 0.64, end: 0 },
      tint: [0xa46be0, 0xd7a9ff, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.FIRE - 0.05).setAlpha(0);
    innerOrbitEmitter.createGravityWell({
      x: 0,
      y: 0,
      power: 2,
      epsilon: Math.max(24, radius * 0.2),
      gravity: 28,
    });
    innerOrbitEmitter.emitParticle(10);

    this.scene.tweens.add({
      targets: [core, horizon, outerOrbitEmitter, wispEmitter, innerOrbitEmitter],
      alpha: { from: 0, to: 1 },
      duration: 150,
      ease: 'Sine.easeOut',
    });
    this.scene.tweens.add({
      targets: core,
      scaleX: { from: 0.92, to: 1.04 },
      scaleY: { from: 0.92, to: 1.04 },
      duration: Math.max(180, durationMs),
      ease: 'Sine.easeInOut',
    });
    this.scene.tweens.add({
      targets: horizon,
      scaleX: { from: 0.98, to: 1.01 },
      scaleY: { from: 0.98, to: 1.01 },
      alpha: { from: 0.12, to: 0.24 },
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.scene.time.delayedCall(fadeDelay, () => {
      outerOrbitEmitter.stop();
      wispEmitter.stop();
      innerOrbitEmitter.stop();
    });
    this.scene.tweens.add({
      targets: [core, horizon, outerOrbitEmitter, wispEmitter, innerOrbitEmitter],
      alpha: 0,
      delay: fadeDelay,
      duration: fadeDuration,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.scene.tweens.killTweensOf([core, horizon, outerOrbitEmitter, wispEmitter, innerOrbitEmitter]);
        core.destroy();
        horizon.destroy();
        destroyEmitter(outerOrbitEmitter);
        destroyEmitter(wispEmitter);
        destroyEmitter(innerOrbitEmitter);
      },
    });
  }
}
