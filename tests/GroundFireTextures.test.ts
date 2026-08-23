import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));

import {
  GROUND_FIRE_BED_VARIANT_COUNT,
  GROUND_FIRE_SURFACE_VARIANT_COUNT,
  sampleGroundFireBedAlpha,
  sampleGroundFireSurfaceAlpha,
} from '../src/effects/GroundFireTextures';

type AlphaSampler = (variant: number, u: number, v: number) => number;

function meanAlpha(sample: AlphaSampler, variant: number): number {
  let sum = 0;
  const size = 64;
  for (let y = 0; y < size; y += 1) {
    const v = ((y + 0.5) / size) * 2 - 1;
    for (let x = 0; x < size; x += 1) {
      const u = ((x + 0.5) / size) * 2 - 1;
      sum += sample(variant, u, v);
    }
  }
  return sum / (size * size);
}

function meanDifference(sample: AlphaSampler, first: number, second: number): number {
  let difference = 0;
  let count = 0;
  for (let y = 0; y < 32; y += 1) {
    const v = ((y + 0.5) / 32) * 2 - 1;
    for (let x = 0; x < 32; x += 1) {
      const u = ((x + 0.5) / 32) * 2 - 1;
      difference += Math.abs(sample(first, u, v) - sample(second, u, v));
      count += 1;
    }
  }
  return difference / count;
}

function silhouetteRadii(sample: AlphaSampler, variant: number): number[] {
  const radii: number[] = [];
  for (let step = 0; step < 32; step += 1) {
    const angle = step / 32 * Math.PI * 2;
    let edge = 0;
    for (let radiusStep = 1; radiusStep <= 100; radiusStep += 1) {
      const radius = radiusStep / 100;
      if (sample(variant, Math.cos(angle) * radius, Math.sin(angle) * radius) >= 0.055) edge = radius;
    }
    radii.push(edge);
  }
  return radii;
}

function expectOrganicFamily(sample: AlphaSampler, variants: number): void {
  const means = Array.from({ length: variants }, (_, variant) => meanAlpha(sample, variant));
  for (const mean of means) {
    expect(mean).toBeGreaterThan(0.07);
    expect(mean).toBeLessThan(0.34);
  }
  expect(Math.max(...means) - Math.min(...means)).toBeLessThan(0.08);

  for (let variant = 0; variant < variants; variant += 1) {
    const radii = silhouetteRadii(sample, variant);
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.16);
    let asymmetricOpposites = 0;
    for (let angle = 0; angle < radii.length / 2; angle += 1) {
      if (Math.abs(radii[angle] - radii[angle + radii.length / 2]) >= 0.04) {
        asymmetricOpposites += 1;
      }
    }
    expect(asymmetricOpposites).toBeGreaterThanOrEqual(6);
  }

  for (let first = 0; first < variants; first += 1) {
    for (let second = first + 1; second < variants; second += 1) {
      expect(meanDifference(sample, first, second)).toBeGreaterThan(0.025);
    }
  }
}

describe('GroundFire procedural textures', () => {
  it('keeps every motif exactly transparent at the frame border', () => {
    for (let variant = 0; variant < GROUND_FIRE_SURFACE_VARIANT_COUNT; variant += 1) {
      expect(sampleGroundFireSurfaceAlpha(variant, -1, 0)).toBe(0);
      expect(sampleGroundFireSurfaceAlpha(variant, 1, 0)).toBe(0);
      expect(sampleGroundFireSurfaceAlpha(variant, 0, -1)).toBe(0);
      expect(sampleGroundFireSurfaceAlpha(variant, 0, 1)).toBe(0);
    }
    for (let variant = 0; variant < GROUND_FIRE_BED_VARIANT_COUNT; variant += 1) {
      expect(sampleGroundFireBedAlpha(variant, -1, 0)).toBe(0);
      expect(sampleGroundFireBedAlpha(variant, 1, 0)).toBe(0);
      expect(sampleGroundFireBedAlpha(variant, 0, -1)).toBe(0);
      expect(sampleGroundFireBedAlpha(variant, 0, 1)).toBe(0);
    }
  });

  it('builds distinct, asymmetric surface motifs with comparable coverage', () => {
    expectOrganicFamily(sampleGroundFireSurfaceAlpha, GROUND_FIRE_SURFACE_VARIANT_COUNT);
  });

  it('builds distinct, asymmetric bed motifs with comparable coverage', () => {
    expectOrganicFamily(sampleGroundFireBedAlpha, GROUND_FIRE_BED_VARIANT_COUNT);
  });
});
