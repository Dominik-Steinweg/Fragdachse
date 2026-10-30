import { describe, expect, it } from 'vitest';
import { ALLIED_PALETTE, VOID_PALETTE } from '../src/config';
import { enemyHeatGlowAt, HEAT_STEP_FLARE_MS, type EnemyHeatGlow } from '../src/effects/enemyHeatGlowModel';

const channels = (color: number) => ({ r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff });
const glow = (...args: Parameters<typeof enemyHeatGlowAt> extends [unknown, ...infer Rest] ? Rest : never) =>
  ({ ...enemyHeatGlowAt({} as EnemyHeatGlow, ...args) });
/** Settled glow of `stage` of 5, long after its step. */
const settled = (stage: number, allied = false) => glow('heat', stage, 5, 50_000, 1000, allied);

describe('heat glow model', () => {
  it('climbs in distinct stages from dormant embers to red and tips into void violet only at the top', () => {
    const levels = [0, 1, 2, 3, 4, 5].map(stage => settled(stage));
    for (let stage = 1; stage < levels.length; stage++) {
      expect(levels[stage].alpha, `stage ${stage}`).toBeGreaterThan(levels[stage - 1].alpha + 0.05);
    }
    const middle = channels(levels[2].color);
    expect(middle.r).toBeGreaterThan(middle.b * 3);
    const top = channels(levels[5].color), violet = channels(VOID_PALETTE.primary);
    expect(Math.abs(top.b - violet.b)).toBeLessThan(40);
    // Cold and barely heated bodies stay dark enough to cost no ground light.
    expect(levels[0].light).toBe(0);
    expect(levels[4].light).toBeGreaterThan(levels[2].light);
  });

  it('flares up at every step and settles back to the stage within the flare', () => {
    const step = 20_000;
    const flare = glow('heat', 3, 5, step + 30, step, false), after = glow('heat', 3, 5, step + HEAT_STEP_FLARE_MS + 10, step, false);
    expect(flare.flare).toBeGreaterThan(0.5);
    expect(flare.alpha).toBeGreaterThan(after.alpha + 0.15);
    expect(flare.light).toBeGreaterThan(after.light);
    expect(after.flare).toBe(0);
    // A cold body has no step to flare.
    expect(glow('heat', 0, 5, 30, 0, false).flare).toBe(0);
  });

  it('throbs fast in the warning and never shows a white or yellow core', () => {
    const samples = [0, 31, 62, 94].map(t => glow('telegraph', 5, 5, 10_000 + t, 0, false));
    expect(Math.max(...samples.map(s => s.alpha)) - Math.min(...samples.map(s => s.alpha))).toBeGreaterThan(0.1);
    for (const sample of [...samples, ...[1, 2, 3, 4, 5].map(stage => glow('heat', stage, 5, 1030, 1000, false))]) {
      const { r, g, b } = channels(sample.color);
      expect(r - g).toBeGreaterThan(20);
      expect(g).toBeLessThan(160);
      expect(Math.min(r, g, b)).toBeLessThan(200);
    }
  });

  it('counts the warning down with a bright throb that speeds up towards the burst', () => {
    const warningMs = 1400;
    const peaks = (from: number, to: number) => {
      let count = 0, previous = 0, rising = false;
      for (let elapsed = from; elapsed <= to; elapsed += 4) {
        const alpha = glow('telegraph', 5, 5, 50_000 + elapsed, 0, false, 0, elapsed, warningMs).alpha;
        if (alpha < previous && rising) count++;
        rising = alpha > previous; previous = alpha;
      }
      return count;
    };
    expect(peaks(1100, 1400)).toBeGreaterThan(peaks(0, 300) * 2);
    expect(glow('telegraph', 5, 5, 50_000, 0, false, 0, 700, warningMs).alpha).toBeGreaterThanOrEqual(0.7);
  });

  it('shows nothing of the body after its burst', () => {
    expect(glow('burst', 5, 5, 9000, 5000, false)).toMatchObject({ alpha: 0, light: 0 });
  });

  it('keeps allied bodies in the allied palette, never in hostile red', () => {
    for (const sample of [settled(2, true), settled(4, true), glow('telegraph', 5, 5, 2000, 1500, true)]) {
      const { r, g } = channels(sample.color);
      expect(g).toBeGreaterThan(r);
    }
    expect(channels(settled(5, true).color).g).toBeGreaterThanOrEqual(channels(ALLIED_PALETTE.primary).g);
  });
});
