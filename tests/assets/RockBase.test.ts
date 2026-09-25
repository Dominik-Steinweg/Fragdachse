import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ROCK_47_SPRITESHEET_ORDER } from '../../src/arena/AutoTiler';
import {
  ROCK_BASE_AUTOTILE_SLOTS,
  ROCK_BASE_FRAME_MARGIN,
  ROCK_BASE_FRAME_SIZE,
  ROCK_BASE_PHASE_CELLS,
  ROCK_BASE_PHASES,
  getRockBaseFrame,
} from '../../src/arena/RockBaseConfig';
import { CELL_SIZE } from '../../src/config';

const N = 1, E = 4, S = 16, W = 64;
/** Rocks collide on the full cell: the drawn silhouette may only deviate by a few pixels. */
const MAX_EDGE_INSET_PX = 4;

describe('rock base atlas', () => {
  it('uses one frame per cell and a stable phase per grid position', () => {
    expect(ROCK_BASE_FRAME_SIZE).toBe(CELL_SIZE);
    expect(getRockBaseFrame(12, 3, 5)).toBe(getRockBaseFrame(12, 3 + ROCK_BASE_PHASE_CELLS, 5 - ROCK_BASE_PHASE_CELLS));
    expect(getRockBaseFrame(12, 3, 5)).not.toBe(getRockBaseFrame(12, 4, 5));
    expect(Math.floor(getRockBaseFrame(12, -1, -1) / ROCK_BASE_PHASES)).toBe(12);
  });

  it('keeps shared edges opaque and exposed edges close to the collision grid', async () => {
    const { data, info } = await sharp('public/assets/sprites/rock_base.png').ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const pitch = ROCK_BASE_FRAME_SIZE + ROCK_BASE_FRAME_MARGIN * 2;
    expect(info.width).toBe(ROCK_BASE_PHASES * pitch);
    expect(info.height).toBe(ROCK_BASE_AUTOTILE_SLOTS * pitch);
    const alpha = (slot: number, phase: number, x: number, y: number) =>
      data[((slot * pitch + ROCK_BASE_FRAME_MARGIN + y) * info.width + phase * pitch + ROCK_BASE_FRAME_MARGIN + x) * 4 + 3];
    const size = ROCK_BASE_FRAME_SIZE, inner = MAX_EDGE_INSET_PX;
    for (let slot = 0; slot < ROCK_BASE_AUTOTILE_SLOTS; slot++) {
      const mask = ROCK_47_SPRITESHEET_ORDER[slot];
      if (mask === undefined || mask < 0) continue;
      for (const phase of [0, 9, 27, ROCK_BASE_PHASES - 1]) {
        // Beyond the corner rounding, the body of every cell is solid.
        for (let y = inner; y < size - inner; y++) for (let x = inner; x < size - inner; x++) {
          expect(alpha(slot, phase, x, y)).toBe(255);
        }
        // An edge towards a neighbour continues seamlessly away from the corners.
        for (let i = 8; i < size - 8; i++) {
          if (mask & N) expect(alpha(slot, phase, i, 0)).toBe(255);
          if (mask & S) expect(alpha(slot, phase, i, size - 1)).toBe(255);
          if (mask & W) expect(alpha(slot, phase, 0, i)).toBe(255);
          if (mask & E) expect(alpha(slot, phase, size - 1, i)).toBe(255);
        }
      }
    }
  });
});
