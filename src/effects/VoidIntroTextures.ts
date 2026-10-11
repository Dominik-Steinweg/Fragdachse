import type * as Phaser from 'phaser';
import { ensureCanvasTexture } from './EffectUtils';

export const VOID_INTRO_GLOW_TEXTURE = '__void_rift_glow';
export const VOID_INTRO_RING_TEXTURE = '__void_rift_ring';

/** Shared soft anticipation glow and shock ring for void boss entrances. */
export function ensureVoidIntroTextures(textures: Phaser.Textures.TextureManager): void {
  ensureCanvasTexture(textures, VOID_INTRO_GLOW_TEXTURE, 128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });
  ensureCanvasTexture(textures, VOID_INTRO_RING_TEXTURE, 256, 256, (ctx) => {
    for (const [width, alpha] of [[18, 0.18], [8, 0.45], [3, 1]] as const) {
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(128, 128, 116, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}
