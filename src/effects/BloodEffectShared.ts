import * as Phaser from 'phaser';
import { ensureCanvasTexture } from './EffectUtils';

export const TEX_BLOOD_DROPLET = '__blood_droplet';
export const TEX_BLOOD_STREAK = '__blood_streak';
export const TEX_BLOOD_STAIN = '__blood_stain';

function resolveTextures(target: Phaser.Scene | Phaser.Textures.TextureManager): Phaser.Textures.TextureManager {
  return 'textures' in target ? target.textures : target;
}

export function ensureBloodHitTextures(target: Phaser.Scene | Phaser.Textures.TextureManager): void {
  const textures = resolveTextures(target);

  ensureCanvasTexture(textures, TEX_BLOOD_DROPLET, 14, 14, (ctx) => {
    const gradient = ctx.createRadialGradient(7, 7, 1, 7, 7, 7);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.65, 'rgba(255,255,255,0.78)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(7, 7, 6.2, 0, Math.PI * 2);
    ctx.fill();
  });

  ensureCanvasTexture(textures, TEX_BLOOD_STREAK, 36, 16, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(20, 8, 12, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.beginPath();
    ctx.ellipse(11, 8, 8, 2.7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.46)';
    ctx.beginPath();
    ctx.ellipse(5, 8, 4, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  ensureCanvasTexture(textures, TEX_BLOOD_STAIN, 42, 42, (ctx) => {
    const circles: Array<{ x: number; y: number; r: number; alpha: number }> = [
      { x: 18, y: 16, r: 8, alpha: 0.9 },
      { x: 24, y: 20, r: 10, alpha: 0.75 },
      { x: 14, y: 24, r: 7, alpha: 0.58 },
      { x: 28, y: 27, r: 6, alpha: 0.52 },
    ];

    for (const circle of circles) {
      ctx.fillStyle = `rgba(255,255,255,${circle.alpha})`;
      ctx.beginPath();
      ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

export interface BloodStainSpawnConfig {
  x: number;
  y: number;
  scale: number;
  alpha: number;
  fadeMs: number;
  tint: number;
  rotation: number;
  depth: number;
  stainDelayMs: number;
}

export function spawnBloodStain(scene: Phaser.Scene, config: BloodStainSpawnConfig): Phaser.GameObjects.Image {
  const stain = scene.add.image(config.x, config.y, TEX_BLOOD_STAIN)
    .setDepth(config.depth)
    .setTint(config.tint)
    .setAlpha(0)
    .setScale(config.scale * 0.82)
    .setRotation(config.rotation);

  scene.tweens.add({
    targets: stain,
    alpha: config.alpha,
    scaleX: config.scale,
    scaleY: config.scale,
    duration: 80,
    ease: 'Quad.easeOut',
  });

  scene.tweens.add({
    targets: stain,
    alpha: 0,
    delay: config.stainDelayMs,
    duration: config.fadeMs,
    ease: 'Sine.easeIn',
    onComplete: () => stain.destroy(),
  });

  return stain;
}