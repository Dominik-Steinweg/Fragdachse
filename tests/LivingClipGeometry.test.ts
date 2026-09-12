import { describe, expect, it } from 'vitest';
import { buildRoundedRectClipBands, type LivingBarRoundedClip, type LivingClipRect } from '../src/effects/living/livingClipGeometry';

const node: LivingBarRoundedClip = { kind: 'roundedRect', x: -22, y: -22, width: 44, height: 44, radius: 10 };

function inside(shape: LivingBarRoundedClip, x: number, y: number): boolean {
  const r = Math.max(0, Math.min(shape.radius, shape.width / 2, shape.height / 2));
  const dx = Math.max(shape.x + r - x, 0, x - (shape.x + shape.width - r));
  const dy = Math.max(shape.y + r - y, 0, y - (shape.y + shape.height - r));
  return dx * dx + dy * dy <= r * r + 1e-7;
}

function expectInscribed(shape: LivingBarRoundedClip, fill: LivingClipRect) {
  const bands = buildRoundedRectClipBands(shape, fill);
  for (const band of bands) {
    expect(band.width).toBeGreaterThan(0);
    expect(band.height).toBeGreaterThan(0);
    for (const x of [band.x, band.x + band.width]) {
      for (const y of [band.y, band.y + band.height]) {
        expect(inside(shape, x, y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(fill.x);
        expect(x).toBeLessThanOrEqual(fill.x + fill.width);
        expect(y).toBeGreaterThanOrEqual(fill.y);
        expect(y).toBeLessThanOrEqual(fill.y + fill.height);
      }
    }
  }
  for (let i = 1; i < bands.length; i++) {
    expect(bands[i].y).toBeGreaterThanOrEqual(bands[i - 1].y + bands[i - 1].height);
  }
  return bands;
}

describe('rounded living fill geometry', () => {
  it('inscribes full nodes and inset button faces without covering transparent corners', () => {
    for (const shape of [node, { ...node, x: -93, y: -20, width: 186, height: 40, radius: 12 }]) {
      expect(expectInscribed(shape, shape).length).toBeGreaterThan(0);
    }
  });

  it('keeps the upper edge of a half-filled node straight and full-width', () => {
    const bands = expectInscribed(node, { x: -22, y: 0, width: 44, height: 22 });
    expect(bands[0].x).toBe(-22);
    expect(bands[0].y).toBe(0);
    expect(bands[0].width).toBe(44);
    expect(bands.at(-1)!.width).toBeLessThan(44);
  });

  it('handles small fills and horizontal cropping against the original shape', () => {
    for (const height of [0.001, 1, 4, 11, 22, 43, 44]) {
      for (const width of [0.001, 4, 12, 22, 44]) {
        expectInscribed(node, { x: -22, y: 22 - height, width, height });
      }
    }
    expect(expectInscribed(node, { x: -22, y: 21, width: 44, height: 1 }).length).toBeGreaterThan(0);
  });

  it('clamps oversized radii and supports a rectangle without rounding', () => {
    expectInscribed({ ...node, radius: 100 }, node);
    expect(buildRoundedRectClipBands({ ...node, radius: 0 }, node)).toEqual([
      { x: -22, y: -22, width: 44, height: 44 },
    ]);
    expect(buildRoundedRectClipBands({ ...node, radius: -10 }, node)).toEqual(
      buildRoundedRectClipBands({ ...node, radius: 0 }, node));
  });

  it('produces no bands for empty, disjoint or non-finite geometry', () => {
    for (const fill of [{ ...node, width: 0 }, { ...node, height: -1 },
      { ...node, x: 100 }, { ...node, y: NaN }, { ...node, width: Infinity }]) {
      expect(buildRoundedRectClipBands(node, fill)).toEqual([]);
    }
    expect(buildRoundedRectClipBands({ ...node, radius: NaN }, node)).toEqual([]);
  });
});
