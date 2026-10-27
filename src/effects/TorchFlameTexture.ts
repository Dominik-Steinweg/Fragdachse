import type Phaser from 'phaser';
import { ensureCanvasTexture } from './EffectUtils';

export const TEX_TORCH_FLAME = '__torch_flame';

/** Torch flame colour by heat (1 at the hot head, 0 at rim and tip). */
const TORCH_FLAME_RAMP: readonly (readonly [number, number, number, number])[] = [
  [0, 214, 84, 34], [.3, 255, 146, 56], [.6, 255, 210, 118], [.85, 255, 246, 222], [1, 255, 252, 240],
];

/**
 * A torch flame seen from above, leaning downwind along +x: a round head over the torch tapers to a
 * tip. The colour is baked (white-hot head, yellow, orange rim, red tip) behind a one-pixel edge, so
 * a few overlapping members keep a readable flame silhouette instead of summing to a glow ball.
 */
export function ensureTorchFlameTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_TORCH_FLAME, 32, 16, (ctx) => {
    const image = ctx.createImageData(32, 16);
    const headX = 8, headY = 8, headRadius = 5.2, tipX = 30.5;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 32; x++) {
        const px = x + .5, py = y + .5;
        const along = Math.max(0, (px - headX) / (tipX - headX));
        const radius = headRadius * Math.pow(Math.max(0, 1 - along), .8);
        const distance = Math.hypot(Math.min(0, px - headX), py - headY);
        const coverage = Math.min(1, Math.max(0, radius - distance + .5));
        if (coverage <= 0) continue;
        const rim = Math.min(1, distance / Math.max(.01, radius));
        const heat = Math.max(0, (1 - along) * (1 - rim * rim));
        let stop = 1;
        while (stop < TORCH_FLAME_RAMP.length - 1 && TORCH_FLAME_RAMP[stop][0] < heat) stop += 1;
        const [h0, r0, g0, b0] = TORCH_FLAME_RAMP[stop - 1], [h1, r1, g1, b1] = TORCH_FLAME_RAMP[stop];
        const f = Math.min(1, Math.max(0, (heat - h0) / (h1 - h0)));
        const i = (y * 32 + x) * 4;
        image.data[i] = Math.round(r0 + (r1 - r0) * f);
        image.data[i + 1] = Math.round(g0 + (g1 - g0) * f);
        image.data[i + 2] = Math.round(b0 + (b1 - b0) * f);
        image.data[i + 3] = Math.round(255 * coverage * (.7 + .3 * heat) * (1 - along ** 3));
      }
    }
    ctx.putImageData(image, 0, 0);
  });
}
