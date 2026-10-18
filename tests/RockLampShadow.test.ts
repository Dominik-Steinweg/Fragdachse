import { describe, expect, it } from 'vitest';
import { firstRockSegment, rockLampShade, rockShadowSpan, ROCK_SHADOW_CONE_MARGIN } from '../src/effects/RockPenetrationShader';

/** Smooth V7-like coverage along one ray: rocks as [start, end] world px with a 3 px soft rim. */
const ray = (...rocks: [number, number][]) => (distance: number): number => {
  let coverage = 0;
  for (const [start, end] of rocks) {
    const rise = Math.min(1, Math.max(0, (distance - start + 1.5) / 3));
    const fall = Math.min(1, Math.max(0, (end - distance + 1.5) / 3));
    coverage = Math.max(coverage, Math.min(rise, fall));
  }
  return coverage;
};
const RADIUS = 420, REACH = 72, LIT_SHARE = 0.35;

describe('polar rock map', () => {
  it('finds the visible contour of the first rock on a ray', () => {
    const { enter, exit } = firstRockSegment(ray([100, 132], [200, 260]), RADIUS);
    expect(enter).toBeCloseTo(100, 0);
    expect(exit).toBeCloseTo(132, 0);
  });

  it('keeps an empty ray open to the radius and starts at the lamp inside rock', () => {
    expect(firstRockSegment(() => 0, RADIUS)).toEqual({ enter: RADIUS, exit: RADIUS });
    expect(firstRockSegment(ray([-10, 40]), RADIUS).enter).toBe(0);
  });

  it('maps a cone with margin and a radial lamp onto the full circle', () => {
    expect(rockShadowSpan('cone', 0.8)).toBeCloseTo(0.8 + ROCK_SHADOW_CONE_MARGIN * 2);
    expect(rockShadowSpan('radial', 0.8)).toBeCloseTo(Math.PI * 2);
  });
});

describe('lamp shade along a ray', () => {
  const shadeAlong = (coverage: (distance: number) => number) => {
    const { enter, exit } = firstRockSegment(coverage, RADIUS);
    return (distance: number) => rockLampShade(enter, exit, distance, REACH, LIT_SHARE);
  };

  it('lights everything before the first rock and the rock front within its reach', () => {
    const shade = shadeAlong(ray([150, 300]));
    for (let d = 1; d < 150; d += 4) expect(shade(d)).toBe(0);
    for (let d = 150; d <= 150 + REACH * LIT_SHARE; d += 2) expect(shade(d)).toBe(0);
    expect(shade(150 + REACH)).toBe(1);
  });

  it('never lights the ground behind a rock that casts the shadow, however thin the rock', () => {
    for (const width of [8, 20, 32, 60, 120]) {
      const shade = shadeAlong(ray([120, 120 + width]));
      for (let d = 120 + width + 4; d < RADIUS; d += 3) expect(shade(d), `${width} px rock at ${d}`).toBe(1);
    }
  });

  it('keeps a rock behind another rock dark, while a lone rock keeps its lit front', () => {
    const shaded = shadeAlong(ray([100, 130], [180, 240]));
    for (let d = 184; d < 240; d += 4) expect(shaded(d)).toBe(1);
    const alone = shadeAlong(ray([180, 240]));
    expect(alone(184)).toBe(0);
  });

  it('only darkens with distance along a ray', () => {
    const shade = shadeAlong(ray([90, 110], [160, 230]));
    let previous = 0;
    for (let d = 1; d < RADIUS; d += 1) { const next = shade(d); expect(next).toBeGreaterThanOrEqual(previous); previous = next; }
  });
});
