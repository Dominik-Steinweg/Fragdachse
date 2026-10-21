import { describe, expect, it } from 'vitest';
import { CELL_SIZE } from '../src/config';
import {
  createPersistentBaseGravelCoverage,
  createPersistentBaseGravelState,
  getPersistentBaseGravelSurfaceSeed,
} from '../src/arena/PersistentBaseGravelField';
import { DirtSurfaceField } from '../src/arena/DirtSurfaceField';

const frame = { offsetX: 240, offsetY: 12, width: 64 * CELL_SIZE, height: 40 * CELL_SIZE };
const zone = { seed: 12345, anchor: { gridX: 30, gridY: 20 }, buildArea: { kind: 'radius', radiusCells: 6 } as const };

describe('Persistent base gravel coverage', () => {
  it('reports the gravel of exactly the field and state the ground streamer bakes', () => {
    const coverage = createPersistentBaseGravelCoverage(zone, frame)!;
    const state = createPersistentBaseGravelState({ ...zone, frame });
    expect(coverage.key).toBe(state.key);
    const field = new DirtSurfaceField(getPersistentBaseGravelSurfaceSeed(state.seed), state.cells, frame);
    for (let i = 0; i < 64; i++) {
      const x = frame.offsetX + (22 + i / 4) * CELL_SIZE, y = frame.offsetY + (14 + (i % 13)) * CELL_SIZE + 7;
      expect(coverage.coverageAt(x, y)).toBe(field.coverageAt(x, y));
    }
    const centre = (gridX: number, gridY: number) => [frame.offsetX + (gridX + .5) * CELL_SIZE, frame.offsetY + (gridY + .5) * CELL_SIZE] as const;
    expect(coverage.coverageAt(...centre(30, 20))).toBe(1);
    expect(coverage.coverageAt(...centre(30 + 12, 20))).toBe(0);
  });

  it('has nothing to report for a zone outside the World', () => {
    expect(createPersistentBaseGravelCoverage({ ...zone, anchor: { gridX: -40, gridY: -40 } }, frame)).toBeNull();
  });
});
