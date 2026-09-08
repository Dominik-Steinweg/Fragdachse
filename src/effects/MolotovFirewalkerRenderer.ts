import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { ensureFlameTextures, TEX_FLAME_GLOW, TEX_FLAME_EMBER } from './FlameShared';
import { configureAdditiveImage, createEmitter, destroyEmitter, registerGraphicsObject } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';

/** A low golden foot glow and a few embers distinguish the buff from damaging body fire. */
export class MolotovFirewalkerRenderer {
  private readonly glow: Phaser.GameObjects.Image;
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private nextSparkAt = 0;

  constructor(private readonly scene: Phaser.Scene) {
    ensureFlameTextures(scene);
    this.glow = configureAdditiveImage(scene.add.image(0, 0, TEX_FLAME_GLOW),
      DEPTH.PLAYERS - 0.02, 0.4, 0xffbf45).setVisible(false);
    registerGraphicsObject(scene, 'playerStatus', this.glow);
    this.sparks = createEmitter(scene, 0, 0, TEX_FLAME_EMBER, {
      emitting: false, maxParticles: 12,
      x: { min: -6, max: 6 }, y: { min: -4, max: 4 },
      speed: { min: 8, max: 22 }, lifespan: { min: 180, max: 360 },
      scale: { start: 0.24, end: 0 }, alpha: { start: 0.8, end: 0 },
      tint: [0xffd66b, 0xffa62b], blendMode: Phaser.BlendModes.ADD,
    }, DEPTH.PLAYERS + 0.12, 'standard', 'molotovFirewalker');
  }

  sync(x: number, y: number, size: number, visible: boolean): void {
    this.glow.setVisible(visible);
    this.sparks.setVisible(visible);
    if (!visible) { this.sparks.killAll(); return; }
    const now = this.scene.time.now;
    const pulse = 0.9 + Math.sin(now * 0.009) * 0.1;
    this.glow.setPosition(x, y).setDisplaySize(size * 1.25, size * 1.25)
      .setAlpha(emissiveAlpha(0.38 * pulse));
    this.sparks.setPosition(x, y);
    if (now >= this.nextSparkAt) {
      this.nextSparkAt = now + 90;
      this.sparks.explode(1);
    }
  }

  destroy(): void {
    this.glow.destroy();
    destroyEmitter(this.sparks);
  }
}
