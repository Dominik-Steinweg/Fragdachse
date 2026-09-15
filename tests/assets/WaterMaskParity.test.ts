import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { WaterSurfaceModel } from '../../src/arena/WaterSurfaceModel';
import { CELL_SIZE } from '../../src/config';

// Deterministic shore geometry, including holes, isolated cells, tips, chunk seams and map edges.
const water = Array.from({ length: 32 * 24 }, (_, i) => ({ gridX: i % 32, gridY: Math.floor(i / 32) }))
  .filter(({ gridX: x, gridY: y }) => (x * 17 + y * 31) % 19 > 4 && !(x > 11 && x < 19 && y > 8 && y < 16));
const frame = { width: 32 * CELL_SIZE, height: 24 * CELL_SIZE };

describe('water mask pixel parity', () => {
  // Captured from the original synchronous bake before the batching/allocation optimization.
  it.each([
    [0, 0, '31d0b3a4579a19d77e43868c326ad552048eb514604d5d7f9a070d1f74194d46'],
    [512, 0, '89c58b8d6e3fe89e9d6e4dd58c48f4d86425eb132479f9850f7114ad71bd1b09'],
    [0, 512, '1c8d7368ef3c4dbbb386c9bb99bc7c86af106a7865350c10591489f74a501273'],
    [512, 512, 'e23a374d19c3af2a0c3fbcd83e7e5e8c8bc55dbc3170fcd0aaf5dad4f15bcd36'],
  ] as const)('keeps every packed byte at %i,%i', (x, y, expected) => {
    const model = new WaterSurfaceModel(water, frame);
    const work = model.bakeSteps(x, y, 512);
    let result = work.next();
    let pauses = 0;
    while (!result.done) { pauses++; result = work.next(); }
    expect(pauses).toBeGreaterThan(1);
    expect(createHash('sha256').update(result.value.data).digest('hex')).toBe(expected);
    expect(createHash('sha256').update(model.bake(x, y, 512).data).digest('hex')).toBe(expected);
  });
});
