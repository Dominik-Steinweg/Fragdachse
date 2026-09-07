import type * as Phaser from 'phaser';
import { ensureCanvasTexture } from './EffectUtils';
import type { FootprintVariant } from '../config/movementEffects';

export const FOOTPRINT_TEXTURE_KEYS = {
  compact: '__movement_paw_compact', clawed: '__movement_paw_clawed', broad: '__movement_paw_broad',
} as const;

/** North-facing, hand-authored masks: toe gaps survive the small display size.
 * Two ink weights soften worn edges without blurring the pixel silhouette. */
export const FOOTPRINT_PIXELS: Readonly<Record<FootprintVariant, readonly string[]>> = {
  compact: [
    '........', '...ss...', '.s.##.s.', '.#.##.#.', '.#....#.', '........',
    '..s##s..', '.s####s.', '.######.', '..####..', '..s##s..', '........',
  ],
  clawed: [
    '.s.ss.s.', '.#.##.#.', '.#.##.#.', '.s.##.s.', '..s..s..', '........',
    '...ss...', '..s##s..', '..####..', '..s##s..', '...##...', '...ss...',
  ],
  broad: [
    '.s.ss.s.', '##.##.##', 's#....#s', '.s....s.', '........', '..s##s..',
    '.s####s.', '.######.', 's#####s.', '.####s..', '..s##...', '........',
  ],
};

export function ensureMovementFootprintTextures(scene: Phaser.Scene): void {
  for (const variant of ['compact', 'clawed', 'broad'] as const) {
    ensureCanvasTexture(scene.textures, FOOTPRINT_TEXTURE_KEYS[variant], 8, 12, (ctx) => {
      const rows = FOOTPRINT_PIXELS[variant];
      for (let y = 0; y < rows.length; y++) {
        for (let x = 0; x < rows[y].length; x++) {
          const ink = rows[y][x];
          if (ink === '.') continue;
          ctx.fillStyle = ink === '#' ? '#ffffff' : 'rgba(255,255,255,0.55)';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });
  }
}
