import * as Phaser from 'phaser';
import { COLORS, DEPTH_TRACE } from '../config';
import { createEmitter, destroyEmitter, fillRadialGradientTexture } from './EffectUtils';

const TEX_ROCK_DUST = '__rock_destruction_dust';

interface RockFragmentConfig {
  source: Phaser.GameObjects.Image;
}

export class RockDestructionRenderer {
  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_ROCK_DUST, 28, [
      [0, 'rgba(255,255,255,0.95)'],
      [0.26, 'rgba(255,255,255,0.5)'],
      [0.6, 'rgba(255,255,255,0.18)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  }

  playDestruction({ source }: RockFragmentConfig): void {
    const frameWidth = Math.max(1, Math.round(source.frame.width));
    const frameHeight = Math.max(1, Math.round(source.frame.height));
    const columns = Phaser.Math.Clamp(Math.round(frameWidth / 6), 4, 6);
    const rows = Phaser.Math.Clamp(Math.round(frameHeight / 6), 4, 6);
    const tint = source.tintTopLeft ?? 0xffffff;
    const worldScaleX = source.displayWidth / frameWidth;
    const worldScaleY = source.displayHeight / frameHeight;
    const depth = DEPTH_TRACE - 0.15;

    this.playDust(source.x, source.y, tint);

    for (let row = 0; row < rows; row += 1) {
      const cropY = Math.round((row * frameHeight) / rows);
      const nextCropY = Math.round(((row + 1) * frameHeight) / rows);
      const cropHeight = Math.max(1, nextCropY - cropY);

      for (let column = 0; column < columns; column += 1) {
        const cropX = Math.round((column * frameWidth) / columns);
        const nextCropX = Math.round(((column + 1) * frameWidth) / columns);
        const cropWidth = Math.max(1, nextCropX - cropX);
        const offsetX = ((cropX + cropWidth * 0.5) / frameWidth - 0.5) * source.displayWidth;
        const offsetY = ((cropY + cropHeight * 0.5) / frameHeight - 0.5) * source.displayHeight;
        const fragmentX = source.x + offsetX;
        const fragmentY = source.y + offsetY;
        const radialAngle = Phaser.Math.Angle.Between(source.x, source.y, fragmentX, fragmentY);
        const launchAngle = radialAngle + Phaser.Math.FloatBetween(-0.26, 0.26);
        const distance = Phaser.Math.FloatBetween(source.displayWidth * 0.28, source.displayWidth * 0.9);
        const driftX = Math.cos(launchAngle) * distance;
        const driftY = Math.sin(launchAngle) * distance - Phaser.Math.FloatBetween(4, 14);
        const settleY = Phaser.Math.FloatBetween(10, 26);
        const worldWidth = cropWidth * worldScaleX;
        const worldHeight = cropHeight * worldScaleY;
        const fragment = this.scene.add.image(fragmentX, fragmentY, source.texture.key, source.frame.name)
          .setCrop(cropX, cropY, cropWidth, cropHeight)
          .setDisplaySize(worldWidth, worldHeight)
          .setTint(tint)
          .setDepth(depth)
          .setAngle(source.angle);

        this.scene.tweens.add({
          targets: fragment,
          x: fragmentX + driftX,
          y: fragmentY + driftY + settleY,
          angle: fragment.angle + Phaser.Math.Between(-120, 120),
          alpha: 0,
          scaleX: Phaser.Math.FloatBetween(0.88, 1.08),
          scaleY: Phaser.Math.FloatBetween(0.88, 1.08),
          duration: Phaser.Math.Between(280, 460),
          ease: 'Cubic.easeOut',
          onComplete: () => fragment.destroy(),
        });
      }
    }
  }

  private playDust(x: number, y: number, tint: number): void {
    const emitter = createEmitter(this.scene, x, y, TEX_ROCK_DUST, {
      lifespan: { min: 220, max: 480 },
      speed: { min: 28, max: 96 },
      angle: { min: 0, max: 360 },
      quantity: 14,
      scale: { start: 0.52, end: 0.06 },
      alpha: { start: 0.34, end: 0 },
      tint: [tint, COLORS.BROWN_2, COLORS.BROWN_5],
      gravityY: 10,
      emitting: false,
    }, DEPTH_TRACE - 0.3);

    emitter.explode(16);
    this.scene.time.delayedCall(600, () => destroyEmitter(emitter));
  }
}