import type * as Phaser from 'phaser';
import { ensureCanvasTexture } from './EffectUtils';
import type { FootprintVariant } from '../config/movementEffects';

export const FOOTPRINT_TEXTURE_KEYS = {
  compact: '__movement_paw_compact', clawed: '__movement_paw_clawed', broad: '__movement_paw_broad',
  titan: '__movement_paw_titan',
} as const;

/** The Grave Titan's paw is drawn smooth at its own size instead of from a pixel mask. */
export const TITAN_PAW_SIZE = { width: 32, height: 44 } as const;

/** North-facing, hand-authored masks: toe gaps survive the small display size.
 * Two ink weights soften worn edges without blurring the pixel silhouette. */
export const FOOTPRINT_PIXELS: Readonly<Record<Exclude<FootprintVariant, 'titan'>, readonly string[]>> = {
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
  ensureCanvasTexture(scene.textures, FOOTPRINT_TEXTURE_KEYS.titan, TITAN_PAW_SIZE.width, TITAN_PAW_SIZE.height, drawTitanPaw);
}

/**
 * North-facing print of the Grave Titan's paw (recipe `paw`: a broad foot, three toe knuckles and
 * ivory claws): a wide sole with a notch at the heel, three oval toe pads and thin claw marks ahead
 * of them. Pads are pressed in: a bright rim around a fainter floor, so the large print (and its
 * glowing copy) reads as an imprint rather than a filled blob.
 */
function drawTitanPaw(ctx: CanvasRenderingContext2D): void {
  const rim = 1.3, floor = 0.42;
  const pads = [[12.8, 33, 7.6, 7.6, 0.2], [19.2, 33, 7.6, 7.6, -0.2], [16, 29, 8.8, 5.4, 0]] as const;
  const toes = [[5.8, 18, 3.4, 4.8, -0.32], [16, 14.6, 3.6, 5, 0], [26.2, 18, 3.4, 4.8, 0.32]] as const;
  // One path per layer: overlapping lobes fill as a union instead of stacking their alpha.
  const union = (shrink: number): void => {
    ctx.beginPath();
    for (const [x, y, rx, ry, rotation] of [...pads, ...toes]) {
      ctx.moveTo(x + (rx - shrink) * Math.cos(rotation), y + (rx - shrink) * Math.sin(rotation));
      ctx.ellipse(x, y, rx - shrink, ry - shrink, rotation, 0, Math.PI * 2);
    }
  };
  ctx.fillStyle = '#ffffff';
  union(0);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  union(rim);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = floor;
  union(rim);
  ctx.fill();
  // Claws: thin, tapering marks pressed in ahead of each toe.
  ctx.globalAlpha = 0.85;
  for (const [x, y, , , rotation] of toes) {
    ctx.beginPath();
    ctx.moveTo(x - 1.3, y - 4.6);
    ctx.lineTo(x + 1.3, y - 4.6);
    ctx.lineTo(x + Math.sin(rotation) * 8, y - 6 - Math.cos(rotation) * 6.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
