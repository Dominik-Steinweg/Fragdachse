import { describe, expect, it } from 'vitest';
import { groundHazardIgnitionDelay } from '../src/systems/GroundHazardSpread';
import type { CoopDefenseMapGroundHazardEventConfig } from '../src/config/coopDefenseMaps';

const event: CoopDefenseMapGroundHazardEventConfig = {
  id: 'front', type: 'ground-hazard', start: { type: 'time', atMs: 0 },
  area: { type: 'rectangle', gridX: 2, gridY: 3, widthCells: 20, heightCells: 24 },
  effect: { visualStyle: 'void', burnDurationMs: 1000, burnDamagePerTick: 1, sourceId: 'test' },
  spread: { direction: 'left-to-right', durationMs: 12000, roughnessCells: 2, warningLeadMs: 1000 },
};

describe('organic hazard arrival field', () => {
  it('keeps each row connected and monotone with a fixed start and end', () => {
    for (const seed of [1, 71, 993]) for (let y = 3; y < 27; y += 0.5) {
      let previous = -1;
      for (let x = 2; x <= 21.5; x += 0.5) {
        const delay = groundHazardIgnitionDelay(event, x, y, seed);
        expect(delay).toBeGreaterThan(previous); previous = delay;
      }
      expect(groundHazardIgnitionDelay(event, 2, y, seed)).toBe(0);
      expect(previous).toBe(event.spread!.durationMs);
    }
  });
  it('is reproducible, seed-specific and spatially smooth instead of a column wall', () => {
    const sample = (seed: number) => Array.from({ length: 48 }, (_, y) => groundHazardIgnitionDelay(event, 12, 3 + y / 2, seed));
    const a = sample(123); expect(a).toEqual(sample(123)); expect(a).not.toEqual(sample(124));
    expect(new Set(a).size).toBeGreaterThan(10);
    for (let i = 1; i < a.length; i++) expect(Math.abs(a[i] - a[i - 1])).toBeLessThan(event.spread!.durationMs / 20);
  });
  it('leaves ordinary hazards immediate and clamps the spreading field to its rectangle', () => {
    expect(groundHazardIgnitionDelay({ ...event, spread: undefined }, 12, 10, 1)).toBe(0);
    expect(groundHazardIgnitionDelay(event, -50, 10, 1)).toBe(0);
    expect(groundHazardIgnitionDelay(event, 100, 10, 1)).toBe(event.spread!.durationMs);
  });
});
