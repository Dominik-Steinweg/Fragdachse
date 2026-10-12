import * as Phaser from 'phaser';
import { ALLIED_PALETTE, DEPTH, VOID_PALETTE } from '../config';
import type { GroundFireVisualStyle } from '../types';
import {
  createEmitter,
  fillRadialGradientTexture,
  killAllAndResetParticlePositions,
  setEmitterTintArray,
} from './EffectUtils';
import { ensureVoidFlameTextures, FLAME_COLORS_OUTER, FLAME_COLORS_SPARK, TEX_VOID_FLAME_EMBER, TEX_VOID_FLAME_SPARK } from './FlameShared';

const TEX_FIREBALL_CORE = '__fireball_core';
const TEX_FIREBALL_GLOW = '__fireball_glow';
const TEX_FIREBALL_NEUTRAL = '__fireball_neutral';
const TEX_FIREBALL_NEUTRAL_GLOW = '__fireball_neutral_glow';

interface FireballVisual {
  style: GroundFireVisualStyle;
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
    ensureVoidFlameTextures(scene);
    this.generateTextures();
    this.tail = createEmitter(scene, 0, 0, TEX_VOID_FLAME_EMBER, {
      lifespan: { min: 360, max: 680 }, frequency: -1, quantity: 1,
      speedX: { min: -15, max: 15 }, speedY: { min: -24, max: 2 },
      scale: { start: 0.72, end: 0.05 }, alpha: { start: 0.78, end: 0 },
      tint: [...FLAME_COLORS_OUTER], rotate: { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD, maxParticles: 420, reserve: 100, emitting: false,
    }, DEPTH.PROJECTILES - 0.2, undefined, 'fireball');
    this.sparks = createEmitter(scene, 0, 0, TEX_VOID_FLAME_SPARK, {
      lifespan: { min: 240, max: 480 }, frequency: -1, quantity: 1,
      speedX: { min: -40, max: 40 }, speedY: { min: -46, max: 18 },
      scale: { start: 0.82, end: 0.03 }, alpha: { start: 0.9, end: 0 },
      tint: [...FLAME_COLORS_SPARK], blendMode: Phaser.BlendModes.ADD,
      maxParticles: 180, reserve: 50, emitting: false,
    }, DEPTH.PROJECTILES + 0.2, undefined, 'fireball');
  }

  createVisual(id: number, x: number, y: number, size: number, style: GroundFireVisualStyle = 'normal'): void {
    if (this.visuals.has(id)) return;
    const scale = Math.max(0.5, size / 28);
    const glow = this.scene.add.image(x, y, TEX_FIREBALL_GLOW)
      .setDepth(DEPTH.PROJECTILES - 0.1).setBlendMode(Phaser.BlendModes.ADD).setScale(scale);
    const core = this.scene.add.image(x, y, TEX_FIREBALL_CORE)
      .setDepth(DEPTH.PROJECTILES + 0.1).setBlendMode(Phaser.BlendModes.ADD).setScale(scale);
    if (style !== 'normal') {
      const palette = style === 'allied' ? ALLIED_PALETTE : VOID_PALETTE;
      core.setTexture(TEX_FIREBALL_NEUTRAL).setTint(palette.bright);
      glow.setTexture(TEX_FIREBALL_NEUTRAL_GLOW).setTint(palette.primary).setAlpha(0.65);
    }
    this.visuals.set(id, { style, core, glow, lastTrailX: x, lastTrailY: y, lastTrailAt: 0 });
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
    const palette = visual.style === 'allied' ? ALLIED_PALETTE : visual.style === 'void' ? VOID_PALETTE : null;
    setEmitterTintArray(this.tail, palette ? [palette.primary, palette.deep] : [...FLAME_COLORS_OUTER]);
    setEmitterTintArray(this.sparks, palette ? [palette.core, palette.bright] : [...FLAME_COLORS_SPARK]);
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
    // Der world-scoped Projectile-Owner räumt auch zwischen Runden auf; die
    // szenenweiten Pool-Emitter bleiben deshalb fuer die naechste Runde erhalten.
    killAllAndResetParticlePositions(this.tail);
    killAllAndResetParticlePositions(this.sparks);
  }

  private generateTextures(): void {
    for (const [key, size] of [[TEX_FIREBALL_NEUTRAL, 48], [TEX_FIREBALL_NEUTRAL_GLOW, 72]] as const) {
      fillRadialGradientTexture(this.scene.textures, key, size, [
        [0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.9)'],
        [0.6, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)'],
      ]);
    }
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
