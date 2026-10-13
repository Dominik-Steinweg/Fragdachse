import { describe, expect, it, vi } from 'vitest';
import {
  layoutFireControlCopies,
  type FireControlCopyPosition,
} from '../src/systems/fireControl/FireControlCopyLayout';

function ringPoint(index: number, total: number, radius = 10): FireControlCopyPosition {
  const angle = -Math.PI / 2 + 2 * Math.PI * index / total;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

function expectPosition(actual: FireControlCopyPosition, expected: FireControlCopyPosition): void {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

function onlyRingIndices(indices: readonly number[], total: number): (x: number, y: number) => boolean {
  const free = indices.map(index => ringPoint(index, total));
  return (x, y) => (x === 0 && y === 0) || free.some(point => Math.hypot(x - point.x, y - point.y) < 1e-7);
}

describe('fire control copy layout', () => {
  it('returns no slots for nonpositive counts without querying placement', () => {
    const isFree = vi.fn(() => false);
    for (const count of [0, -2]) {
      expect(layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0, pointX: 2, pointY: 3, count, ringRadius: 10, isFree })).toEqual([]);
    }
    expect(isFree).not.toHaveBeenCalled();
  });

  it('places a single copy beyond the projector in the player-to-point direction', () => {
    const input = { pointX: 12.5, pointY: -3, count: 1, ringRadius: 10 };
    expect(layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0, ...input, isFree: () => true })).toEqual([{ x: 42.5, y: -3 }]);
    expect(layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0, ...input, isFree: () => false })).toBeNull();
  });

  it('requires a free projector center even when every ring position is free', () => {
    expect(layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0,
      pointX: 0, pointY: 0, count: 3, ringRadius: 10, isFree: (x, y) => x !== 0 || y !== 0,
    })).toBeNull();
  });

  it.each([2, 3, 4, 6])('starts %i regular slots at the top and orders them clockwise', count => {
    const result = layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0, pointX: 7, pointY: 9, count, ringRadius: 10, isFree: () => true });
    expect(result).toHaveLength(count);
    for (let slot = 0; slot < count; slot++) {
      const offset = ringPoint(slot, count);
      expectPosition(result![slot], { x: 7 + offset.x, y: 9 + offset.y });
    }
  });

  it('takes the first free rotation to avoid a wall', () => {
    const input = {
      pointX: 0, pointY: 0, count: 2, ringRadius: 10, candidateCount: 8,
      isFree: (_x: number, y: number) => y >= -8,
    };
    const result = layoutFireControlCopies(input);
    expect(result).toHaveLength(2);
    expectPosition(result![0], ringPoint(1, 8));
    expectPosition(result![1], ringPoint(5, 8));
    expect(result!.every(point => input.isFree(point.x, point.y))).toBe(true);
  });

  it('uses 24 rotation steps when candidateCount is omitted', () => {
    const result = layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0,
      pointX: 0, pointY: 0, count: 2, ringRadius: 10, isFree: onlyRingIndices([1, 13], 24),
    });
    expect(result).toHaveLength(2);
    expectPosition(result![0], ringPoint(1, 24));
    expectPosition(result![1], ringPoint(13, 24));
  });

  it('falls back to the most separated free samples and uses lower indices for ties', () => {
    const result = layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0,
      pointX: 0, pointY: 0, count: 3, ringRadius: 10, candidateCount: 8,
      isFree: onlyRingIndices([0, 1, 2, 4, 6], 8),
    });
    expect(result).toHaveLength(3);
    for (const [slot, index] of [0, 2, 4].entries()) expectPosition(result![slot], ringPoint(index, 8));
  });

  it('accounts for the closing gap across the top when maximizing separation', () => {
    const result = layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0,
      pointX: 0, pointY: 0, count: 3, ringRadius: 10, candidateCount: 8,
      minSeparation: 0, isFree: onlyRingIndices([0, 3, 6, 7], 8),
    });
    expect(result).toHaveLength(3);
    for (const [slot, index] of [0, 3, 6].entries()) expectPosition(result![slot], ringPoint(index, 8));
  });

  it('returns null for too few free samples instead of a partial formation', () => {
    expect(layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0,
      pointX: 0, pointY: 0, count: 3, ringRadius: 10, candidateCount: 8,
      isFree: onlyRingIndices([0, 3], 8),
    })).toBeNull();
  });

  it('enforces separation in both regular and fallback formations', () => {
    const input = { pointX: 0, pointY: 0, count: 3, ringRadius: 10, candidateCount: 8 };
    expect(layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0, ...input, minSeparation: 18, isFree: () => true })).toBeNull();
    const isFree = onlyRingIndices([0, 1, 2], 8);
    expect(layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0, ...input, isFree })).toBeNull();
    const relaxed = layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0, ...input, isFree, minSeparation: 7 });
    expect(relaxed).toHaveLength(3);
    for (const a of relaxed!) for (const b of relaxed!) {
      if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(7);
    }
  });

  it('supports arbitrary counts when the supplied separation permits them', () => {
    const result = layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0,
      pointX: 0, pointY: 0, count: 9, ringRadius: 10, minSeparation: 1, candidateCount: 8, isFree: () => true,
    });
    expect(result).toHaveLength(9);
    for (const [slot, point] of result!.entries()) expectPosition(point, ringPoint(slot, 9));
  });

  it('is exactly reproducible and leaves the input intact', () => {
    const input = Object.freeze({
      pointX: 0, pointY: 0, count: 3, ringRadius: 10, candidateCount: 8,
      isFree: onlyRingIndices([0, 1, 3, 6], 8),
    });
    expect(layoutFireControlCopies(input)).toEqual(layoutFireControlCopies(input));
  });

  it('matches exhaustive optimal triples for every obstacle mask on a small ring', () => {
    // Eight samples cannot form an equilateral triangle, so every valid answer uses fallback.
    const total = 8;
    for (let mask = 0; mask < 2 ** total; mask++) {
      const free = Array.from({ length: total }, (_, i) => i).filter(i => mask & (1 << i));
      for (const minSeparation of [0, 10, 15]) {
        let best: number[] | null = null;
        let bestGap = -1;
        for (let a = 0; a < free.length; a++) for (let b = a + 1; b < free.length; b++) {
          for (let c = b + 1; c < free.length; c++) {
            const indices = [free[a], free[b], free[c]];
            let minGap = total;
            let minDistance = Infinity;
            for (let i = 0; i < indices.length; i++) for (let j = i + 1; j < indices.length; j++) {
              const delta = Math.abs(indices[i] - indices[j]);
              minGap = Math.min(minGap, delta, total - delta);
              const p = ringPoint(indices[i], total);
              const q = ringPoint(indices[j], total);
              minDistance = Math.min(minDistance, Math.hypot(p.x - q.x, p.y - q.y));
            }
            if (minDistance >= minSeparation && minGap > bestGap) {
              best = indices;
              bestGap = minGap;
            }
          }
        }
        const result = layoutFireControlCopies({ singleCopyOffsetPx: 30, directionAngle: 0,
          pointX: 0, pointY: 0, count: 3, ringRadius: 10, candidateCount: total,
          minSeparation, isFree: onlyRingIndices(free, total),
        });
        if (!best) expect(result).toBeNull();
        else {
          expect(result).toHaveLength(3);
          for (const [slot, index] of best.entries()) expectPosition(result![slot], ringPoint(index, total));
        }
      }
    }
  });
});
