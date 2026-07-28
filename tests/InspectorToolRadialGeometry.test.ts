import { describe, expect, it } from 'vitest';
import { getInspectorToolRadialSegmentIndex } from '../src/ui/InspectorToolRadialGeometry';

describe('Inspector tool radial geometry', () => {
  it('keeps the current selection while the pointer is in the dead zone', () => {
    expect(getInspectorToolRadialSegmentIndex(0, 0, 6, 34)).toBeNull();
    expect(getInspectorToolRadialSegmentIndex(20, -20, 6, 34)).toBeNull();
  });

  it('resolves clockwise segments from twelve o clock without negative indices', () => {
    expect(getInspectorToolRadialSegmentIndex(0, -80, 4, 34)).toBe(0);
    expect(getInspectorToolRadialSegmentIndex(80, 0, 4, 34)).toBe(1);
    expect(getInspectorToolRadialSegmentIndex(0, 80, 4, 34)).toBe(2);
    expect(getInspectorToolRadialSegmentIndex(-80, 0, 4, 34)).toBe(3);
  });

  it('supports the complete six-slot Inspector capacity', () => {
    const directions = [
      [40, -70],
      [80, 0],
      [40, 70],
      [-40, 70],
      [-80, 0],
      [-40, -70],
    ] as const;
    expect(directions.map(([x, y]) => (
      getInspectorToolRadialSegmentIndex(x, y, 6, 34)
    ))).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
