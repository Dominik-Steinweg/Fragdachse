import { describe, expect, it } from 'vitest';

import {
  buildGroundFireTraversal,
  sampleGroundFireHeat,
  sampleGroundFireMotion,
  type GroundFireMotionSample,
} from '../src/effects/GroundFireMotionField';

function directionReversals(values: readonly number[]): number {
  let previousDirection = 0;
  let reversals = 0;
  for (let index = 1; index < values.length; index += 1) {
    const direction = Math.sign(values[index] - values[index - 1]);
    if (direction === 0) continue;
    if (previousDirection !== 0 && direction !== previousDirection) reversals += 1;
    previousDirection = direction;
  }
  return reversals;
}

describe('GroundFire motion field', () => {
  it('builds complete, deterministic and layer-specific cell permutations', () => {
    const count = 96;
    const seed = 0x1234abcd;
    const first = buildGroundFireTraversal(count, seed, 11);
    const repeated = buildGroundFireTraversal(count, seed, 11);
    const secondLayer = buildGroundFireTraversal(count, seed, 23);

    expect([...first]).toEqual([...repeated]);
    expect([...first].sort((left, right) => left - right)).toEqual(
      Array.from({ length: count }, (_, index) => index),
    );
    expect([...first]).not.toEqual([...secondLayer]);
  });

  it('does not walk a rectangular field monotonically along either grid axis', () => {
    const width = 12;
    const firstWindow = [...buildGroundFireTraversal(width * 8, 0x51f15e5d, 71)].slice(0, 40);
    const xs = firstWindow.map(index => index % width);
    const ys = firstWindow.map(index => Math.floor(index / width));

    expect(directionReversals(xs)).toBeGreaterThanOrEqual(10);
    expect(directionReversals(ys)).toBeGreaterThanOrEqual(10);
  });

  it('is deterministic and changes smoothly between neighbouring frames and positions', () => {
    const seed = 0x2c1b3c6d;
    const atFrame = sampleGroundFireHeat(144, 208, 4_000, seed);
    const repeated = sampleGroundFireHeat(144, 208, 4_000, seed);
    const nextFrame = sampleGroundFireHeat(144, 208, 4_016, seed);
    const neighbour = sampleGroundFireHeat(150, 208, 4_000, seed);

    expect(repeated).toBe(atFrame);
    expect(Math.abs(nextFrame - atFrame)).toBeLessThan(0.02);
    expect(Math.abs(neighbour - atFrame)).toBeLessThan(0.2);
  });

  it('morphs local hot spots instead of advancing one wave front across the area', () => {
    const deltas: number[] = [];
    for (let gridY = 0; gridY < 4; gridY += 1) {
      for (let gridX = 0; gridX < 8; gridX += 1) {
        const x = gridX * 32;
        const y = gridY * 32;
        deltas.push(
          sampleGroundFireHeat(x, y, 2_000, 0x7f4a7c15)
          - sampleGroundFireHeat(x, y, 1_400, 0x7f4a7c15),
        );
      }
    }

    expect(deltas.filter(value => value > 0.005).length).toBeGreaterThanOrEqual(6);
    expect(deltas.filter(value => value < -0.005).length).toBeGreaterThanOrEqual(6);
  });

  it('returns a normalized, temporally stable local curl direction', () => {
    const first: GroundFireMotionSample = { x: 0, y: 0, heat: 0 };
    const next: GroundFireMotionSample = { x: 0, y: 0, heat: 0 };
    sampleGroundFireMotion(96, 128, 3_200, 0x27d4eb2d, first);
    sampleGroundFireMotion(96, 128, 3_216, 0x27d4eb2d, next);

    expect(Math.hypot(first.x, first.y)).toBeCloseTo(1, 6);
    expect(first.x * next.x + first.y * next.y).toBeGreaterThan(0.98);
  });
});
