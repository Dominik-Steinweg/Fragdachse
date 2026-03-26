import Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  fillRadialGradientTexture,
  setCircleEmitZone,
} from './EffectUtils';

const TEX_GAUSS_CORE = '__gauss_core';
const TEX_GAUSS_HALO = '__gauss_halo';
const TEX_GAUSS_ARC = '__gauss_arc';

const DEPTH_GAUSS_HALO = DEPTH.PROJECTILES - 0.2;
const DEPTH_GAUSS_CORE = DEPTH.PROJECTILES + 0.2;
const DEPTH_GAUSS_ARC = DEPTH.PROJECTILES + 0.3;

interface GaussVisual {
  halo: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Image;
  arcEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
}

export class GaussRenderer {
  private visuals = new Map<number, GaussVisual>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    const textures = this.scene.textures;
    fillRadialGradientTexture(textures, TEX_GAUSS_CORE, 28, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.22, 'rgba(222,250,255,0.95)'],
      [0.58, 'rgba(113,227,255,0.45)'],
      [1, 'rgba(28,78,120,0.0)'],
    ]);
    fillRadialGradientTexture(textures, TEX_GAUSS_HALO, 54, [
      [0, 'rgba(143,233,255,0.58)'],
      [0.42, 'rgba(76,194,255,0.26)'],
      [0.78, 'rgba(42,92,160,0.08)'],
      [1, 'rgba(0,0,0,0.0)'],
    ]);
    fillRadialGradientTexture(textures, TEX_GAUSS_ARC, 10, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.4, 'rgba(143,233,255,0.8)'],
      [1, 'rgba(143,233,255,0.0)'],
    ]);
  }

  createVisual(id: number, x: number, y: number, size: number, color: number): void {
    if (this.visuals.has(id)) return;

    const halo = configureAdditiveImage(this.scene.add.image(x, y, TEX_GAUSS_HALO), DEPTH_GAUSS_HALO, 0.55, COLORS.BLUE_2);
    const core = configureAdditiveImage(this.scene.add.image(x, y, TEX_GAUSS_CORE), DEPTH_GAUSS_CORE, 0.95, color);
    halo.setScale(Math.max(0.9, size / 18));
    core.setScale(Math.max(0.65, size / 20));

    const arcEmitter = createEmitter(this.scene, x, y, TEX_GAUSS_ARC, {
      lifespan: { min: 70, max: 130 },
      frequency: 12,
      quantity: 2,
      speedX: { min: -20, max: 20 },
      speedY: { min: -20, max: 20 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [0xffffff, color, COLORS.BLUE_1],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH_GAUSS_ARC);
    setCircleEmitZone(arcEmitter, Math.max(6, size * 0.45), 2);

    this.visuals.set(id, { halo, core, arcEmitter });
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number, color: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    const speed = Math.sqrt(vx * vx + vy * vy);
    const pulse = 0.78 + 0.22 * Math.sin(this.scene.time.now * 0.03 + id);
    const rotation = Math.atan2(vy, vx);

    visual.halo.setPosition(x, y).setRotation(rotation).setScale(Math.max(1.0, size / 16) * (1.5 + speed / 1800 * 0.7)).setAlpha(0.28 + pulse * 0.22).setTint(COLORS.BLUE_2);
    visual.core.setPosition(x, y).setRotation(rotation).setScale(
      Math.max(0.8, size / 14) * (1.4 + speed / 2200),
      Math.max(0.65, size / 20) * (0.8 + pulse * 0.2),
    ).setAlpha(0.82 + pulse * 0.18).setTint(color);
    visual.arcEmitter.setPosition(x, y);
    visual.arcEmitter.setParticleSpeed(Math.max(22, 18 + speed * 0.03), Math.max(12, 10 + speed * 0.015));
    visual.arcEmitter.setParticleTint([0xffffff, color, COLORS.BLUE_1]);
    setCircleEmitZone(visual.arcEmitter, Math.max(7, size * 0.5), 2, true);
  }

  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    visual.halo.destroy();
    visual.core.destroy();
    destroyEmitter(visual.arcEmitter);
    this.visuals.delete(id);
  }

  has(id: number): boolean {
    return this.visuals.has(id);
  }

  getActiveIds(): number[] {
    return [...this.visuals.keys()];
  }

  destroyAll(): void {
    for (const id of [...this.visuals.keys()]) {
      this.destroyVisual(id);
    }
  }
}