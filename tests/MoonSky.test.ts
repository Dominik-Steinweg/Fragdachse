import { describe, expect, it } from 'vitest';
import { createMoonSky, moonIslandAt, resolveMoonBase, resolveMoonSky } from '../src/effects/sunlight/MoonSky';
import { createSunTuning } from '../src/effects/sunlight/SunAtmosphere';

const BLOOD = { openings: { cover: .7, light: [1, .03, .04] } };

describe('moon islands (Nachtsicht N-1/N-2)', () => {
  it('adds no light by day and fades in after dusk', () => {
    for (const minute of [8 * 60, 12 * 60, 17 * 60, 19 * 60 + 30]) {
      const moon = resolveMoonSky(minute, null, null, 0, createMoonSky());
      expect(moon.active).toBe(false);
      expect(moon.light).toEqual([0, 0, 0]);
      expect(moon.relief).toBe(0);
    }
    expect(resolveMoonSky(22 * 60 + 30, null, null, 0, createMoonSky()).active).toBe(true);
  });

  it('opens fewer islands in deep night than in the moonlit plateaus', () => {
    const deep = resolveMoonBase(60).cover;
    for (const moonlit of [21 * 60 + 45, 22 * 60, 4 * 60 + 30]) expect(deep).toBeGreaterThan(resolveMoonBase(moonlit).cover);
  });

  it('is continuous across midnight', () => {
    const before = resolveMoonSky(1440 - 1e-3, null, null, 0, createMoonSky());
    const after = resolveMoonSky(1e-3, null, null, 0, createMoonSky());
    expect(after.cover).toBeCloseTo(before.cover, 4);
    after.light.forEach((value, channel) => expect(value).toBeCloseTo(before.light[channel], 4));
  });

  it('lets a World disable its islands and an Activity override take over exactly', () => {
    expect(resolveMoonSky(23 * 60, { strength: 0 }, null, 0, createMoonSky()).active).toBe(false);
    const blood = resolveMoonSky(21 * 60, { strength: 0 }, BLOOD, 1, createMoonSky());
    expect(blood.active).toBe(true);
    expect(blood.cover).toBe(.7);
    expect(blood.light).toEqual([1, .03, .04]);
    const half = resolveMoonSky(23 * 60, null, BLOOD, .5, createMoonSky());
    const base = resolveMoonSky(23 * 60, null, null, 0, createMoonSky());
    expect(half.light[0]).toBeGreaterThan(base.light[0]);
    expect(half.light[0]).toBeLessThan(1);
  });

  it('maps the shared cloud field to bounded islands', () => {
    const tuning = createSunTuning();
    tuning.cloudCover = .62;
    const clouds = { tuning, timeSec: 42, strength: 1 };
    let lit = 0, samples = 0;
    for (let y = 0; y < 2000; y += 40) for (let x = 0; x < 4000; x += 40) {
      const island = moonIslandAt(x, y, clouds);
      expect(island).toBeGreaterThanOrEqual(0);
      expect(island).toBeLessThanOrEqual(1);
      lit += island; samples++;
    }
    // Islands, not a veil: most of the night stays dark.
    expect(lit / samples).toBeGreaterThan(.05);
    expect(lit / samples).toBeLessThan(.5);
  });
});
