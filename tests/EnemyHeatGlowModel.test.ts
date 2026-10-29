import { describe, expect, it } from 'vitest';
import { ALLIED_PALETTE, VOID_PALETTE } from '../src/config';
import { enemyHeatGlowAt, type EnemyHeatGlow } from '../src/effects/enemyHeatGlowModel';

const channels = (color: number) => ({ r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff });
const glow = (...args: Parameters<typeof enemyHeatGlowAt> extends [unknown, ...infer Rest] ? Rest : never) =>
  ({ ...enemyHeatGlowAt({} as EnemyHeatGlow, ...args) });

describe('heat glow model', () => {
  it('charges in ember red and tips into void violet only shortly before full heat', () => {
    const half = channels(glow('charge', 0.5, 1000, 0, false).color);
    expect(half.r).toBeGreaterThan(half.b * 3);
    const nearFull = glow('charge', 0.99, 1000, 0, false);
    const tipped = channels(nearFull.color), violet = channels(VOID_PALETTE.bright);
    expect(Math.abs(tipped.b - violet.b)).toBeLessThan(40);
    expect(nearFull.alpha).toBeGreaterThan(glow('charge', 0.5, 1000, 0, false).alpha);
    // Cold bodies stay dark and cost no ground light.
    expect(glow('charge', 0.1, 1000, 0, false).light).toBe(0);
  });

  it('throbs fast in the warning and never shows a white or yellow core', () => {
    const samples = [0, 31, 62, 94].map(t => glow('telegraph', 1, 10_000 + t, 0, false));
    expect(Math.max(...samples.map(s => s.alpha)) - Math.min(...samples.map(s => s.alpha))).toBeGreaterThan(0.1);
    for (const sample of samples) {
      const { r, g, b } = channels(sample.color);
      expect(b).toBeGreaterThan(g);
      expect(r - g).toBeGreaterThan(20);
    }
  });

  it('counts the warning down with a bright throb that speeds up towards the burst', () => {
    const warningMs = 1200;
    const peaks = (from: number, to: number) => {
      let count = 0, previous = 0, rising = false;
      for (let elapsed = from; elapsed <= to; elapsed += 4) {
        const alpha = glow('telegraph', 1, 50_000 + elapsed, 0, false, 0, elapsed, warningMs).alpha;
        if (alpha < previous && rising) count++;
        rising = alpha > previous; previous = alpha;
      }
      return count;
    };
    expect(peaks(900, 1200)).toBeGreaterThan(peaks(0, 300) * 2);
    expect(glow('telegraph', 1, 50_000, 0, false, 0, 600, warningMs).alpha).toBeGreaterThanOrEqual(0.7);
  });

  it('flashes at the burst and cools down to dormant embers', () => {
    const flash = glow('vent', 0, 5010, 5000, false), cooled = glow('vent', 0, 6000, 5000, false);
    expect(flash.alpha).toBeGreaterThan(cooled.alpha);
    expect(cooled.light).toBe(0);
  });

  it('keeps allied bodies in the allied palette, never in hostile red', () => {
    for (const phase of ['charge', 'hold', 'telegraph', 'vent'] as const) {
      const { r, g } = channels(glow(phase, 0.7, 2000, 1500, true).color);
      expect(g, phase).toBeGreaterThan(r);
    }
    expect(channels(glow('hold', 1, 0, 0, true).color).g).toBeGreaterThanOrEqual(channels(ALLIED_PALETTE.primary).g);
  });
});
