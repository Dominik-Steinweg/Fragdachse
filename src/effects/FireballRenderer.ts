import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { createEmitter, fillRadialGradientTexture } from './EffectUtils';
import { ensureFlameTextures, FLAME_COLORS_OUTER, FLAME_COLORS_SPARK, TEX_FLAME_EMBER, TEX_FLAME_SPARK } from './FlameShared';

const TEX_FIREBALL_CORE = '__fireball_core';
const TEX_FIREBALL_GLOW = '__fireball_glow';

interface FireballVisual {
  core: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  lastTrailX: number;
  lastTrailY: number;
  lastTrailAt: number;
}

/** Gepoolte Feuerball-Darstellung: nur zwei Bilder je Projektil, gemeinsame Schweif-Emitter. */
export class FireballRenderer {
  private readonly visuals = new Map<number, FireballVisual>();
  private readonly tail: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private readonly scene: Phaser.Scene) {
    ensureFlameTextures(scene);
    this.generateTextures();
    this.tail = createEmitter(scene, 0, 0, TEX_FLAME_EMBER, {
      lifespan: { min: 360, max: 680 }, frequency: -1, quantity: 1,
      speedX: { min: -15, max: 15 }, speedY: { min: -24, max: 2 },
      scale: { start: 0.72, end: 0.05 }, alpha: { start: 0.78, end: 0 },
      tint: [...FLAME_COLORS_OUTER], rotate: { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD, maxParticles: 420, reserve: 100, emitting: false,
    }, DEPTH.PROJECTILES - 0.2);
    this.sparks = createEmitter(scene, 0, 0, TEX_FLAME_SPARK, {
      lifespan: { min: 240, max: 480 }, frequency: -1, quantity: 1,
      speedX: { min: -40, max: 40 }, speedY: { min: -46, max: 18 },
      scale: { start: 0.82, end: 0.03 }, alpha: { start: 0.9, end: 0 },
      tint: [...FLAME_COLORS_SPARK], blendMode: Phaser.BlendModes.ADD,
      maxParticles: 180, reserve: 50, emitting: false,
    }, DEPTH.PROJECTILES + 0.2);
  }

  createVisual(id: number, x: number, y: number, size: number): void {
    if (this.visuals.has(id)) return;
    const scale = Math.max(0.5, size / 28);
    const glow = this.scene.add.image(x, y, TEX_FIREBALL_GLOW)
      .setDepth(DEPTH.PROJECTILES - 0.1).setBlendMode(Phaser.BlendModes.ADD).setScale(scale);
    const core = this.scene.add.image(x, y, TEX_FIREBALL_CORE)
      .setDepth(DEPTH.PROJECTILES + 0.1).setBlendMode(Phaser.BlendModes.ADD).setScale(scale);
    this.visuals.set(id, { core, glow, lastTrailX: x, lastTrailY: y, lastTrailAt: 0 });
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    const now = this.scene.time.now;
    const scale = Math.max(0.5, size / 28);
    const pulse = 1 + Math.sin(now * 0.007 + id) * 0.09;
    visual.core.setPosition(x, y).setRotation(now * 0.0013).setScale(scale * pulse);
    visual.glow.setPosition(x, y).setRotation(-now * 0.0007).setScale(scale * (1.04 + Math.cos(now * 0.004) * 0.08));
    if (now - visual.lastTrailAt < 36) return;
    const speed = Math.max(1, Math.hypot(vx, vy));
    const tx = x - vx / speed * size * 0.55;
    const ty = y - vy / speed * size * 0.55;
    this.tail.emitParticleAt((tx + visual.lastTrailX) * 0.5, (ty + visual.lastTrailY) * 0.5, 2);
    if ((id + Math.floor(now / 72)) % 2 === 0) this.sparks.emitParticleAt(tx, ty, 1);
    visual.lastTrailX = tx;
    visual.lastTrailY = ty;
    visual.lastTrailAt = now;
  }

  has(id: number): boolean { return this.visuals.has(id); }
  getActiveIds(): number[] { return [...this.visuals.keys()]; }

  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    visual.core.destroy();
    visual.glow.destroy();
    this.visuals.delete(id);
  }

  destroyAll(): void {
    for (const id of [...this.visuals.keys()]) this.destroyVisual(id);
    // ProjectileManager.destroyAll() wird auch zwischen Runden aufgerufen; die
    // szenenweiten Pool-Emitter bleiben deshalb fuer die naechste Runde erhalten.
    this.tail.killAll();
    this.sparks.killAll();
  }

  private generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_FIREBALL_CORE, 48, [
      [0, 'rgba(255,255,235,1)'], [0.2, 'rgba(255,224,96,1)'],
      [0.56, 'rgba(255,88,18,0.95)'], [1, 'rgba(160,18,0,0)'],
    ]);
    fillRadialGradientTexture(this.scene.textures, TEX_FIREBALL_GLOW, 72, [
      [0, 'rgba(255,190,65,0.72)'], [0.42, 'rgba(255,76,12,0.3)'],
      [1, 'rgba(130,10,0,0)'],
    ]);
  }
}
