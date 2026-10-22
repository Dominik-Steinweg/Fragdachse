import { describe, expect, it } from 'vitest';
import { resolveLivingClip, type LivingBarRoundedClip } from '../src/effects/living/livingClipGeometry';

const node: LivingBarRoundedClip = { kind: 'roundedRect', x: -22, y: -22, width: 44, height: 44, radius: 10 };
const button: LivingBarRoundedClip = { ...node, x: -93, y: -20, width: 186, height: 40, radius: 12 };

describe('rounded living fill geometry', () => {
  it('masks full nodes and inset button faces with their own contour', () => {
    for (const shape of [node, button]) {
      expect(resolveLivingClip(shape, shape)).toEqual({
        clip: { x: shape.x, y: shape.y, width: shape.width, height: shape.height, radius: shape.radius },
        fill: { x: shape.x, y: shape.y, width: shape.width, height: shape.height },
      });
    }
  });

  it('keeps the upper edge of a half-filled node straight and full-width', () => {
    // The contour keeps its rounded lower corners; the fill edge is a separate, straight mask.
    expect(resolveLivingClip(node, { x: -22, y: 0, width: 44, height: 22 })).toEqual({
      clip: { x: -22, y: -22, width: 44, height: 44, radius: 10 },
      fill: { x: -22, y: 0, width: 44, height: 22 },
    });
  });

  it('crops fills against the original shape in both directions', () => {
    expect(resolveLivingClip(node, { x: -40, y: 10, width: 30, height: 100 })!.fill)
      .toEqual({ x: -22, y: 10, width: 12, height: 12 });
    for (const height of [0.001, 1, 4, 11, 22, 43, 44]) {
      for (const width of [0.001, 4, 12, 22, 44]) {
        const resolved = resolveLivingClip(node, { x: -22, y: 22 - height, width, height })!;
        const expected = { x: -22, y: 22 - height, width, height };
        for (const key of ['x', 'y', 'width', 'height'] as const) expect(resolved.fill[key]).toBeCloseTo(expected[key], 9);
        expect(resolved.clip.radius).toBe(10);
      }
    }
  });

  it('clamps oversized radii and supports a rectangle without rounding', () => {
    expect(resolveLivingClip({ ...node, radius: 100 }, node)!.clip.radius).toBe(22);
    expect(resolveLivingClip({ ...button, radius: 100 }, button)!.clip.radius).toBe(20);
    expect(resolveLivingClip({ ...node, radius: 0 }, node)!.clip.radius).toBe(0);
    expect(resolveLivingClip({ ...node, radius: -10 }, node)!.clip.radius).toBe(0);
  });

  it('produces nothing for empty, disjoint or non-finite geometry', () => {
    for (const fill of [{ ...node, width: 0 }, { ...node, height: -1 },
      { ...node, x: 100 }, { ...node, y: NaN }, { ...node, width: Infinity }]) {
      expect(resolveLivingClip(node, fill)).toBeNull();
    }
    expect(resolveLivingClip({ ...node, radius: NaN }, node)).toBeNull();
    expect(resolveLivingClip({ ...node, width: 0 }, node)).toBeNull();
  });
});
