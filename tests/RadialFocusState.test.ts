import { describe, expect, it } from 'vitest';
import {
  RADIAL_FOCUS_DESATURATE,
  RADIAL_FOCUS_DARKEN,
  RADIAL_FOCUS_SOFTNESS_PX,
  resolveRadialFocusFrame,
  resolveRadialFocusSampling,
} from '../src/effects/postfx/radialFocusState';
import { ARENA_HEIGHT, ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_VIEWPORT_WIDTH } from '../src/config';

describe('radial focus state', () => {
  it('maps a world focus to final screen coordinates after camera feedback', () => {
    const frame = resolveRadialFocusFrame(1420, 640, 320, -18, 176, 1);

    expect(frame.focusX).toBe(1100);
    expect(frame.focusY).toBe(658);
    expect(frame.radiusPx).toBe(176);
    expect(frame.alpha).toBe(1);
    expect(frame.arenaRect).toEqual({
      x: ARENA_OFFSET_X,
      y: ARENA_OFFSET_Y,
      width: ARENA_VIEWPORT_WIDTH,
      height: ARENA_HEIGHT,
    });
  });

  it('clamps the overlay alpha but preserves a negative death-close radius', () => {
    const frame = resolveRadialFocusFrame(200, 300, 0, 0, -104, 2);

    expect(frame.radiusPx).toBe(-104);
    expect(frame.alpha).toBe(1);
    expect(resolveRadialFocusFrame(200, 300, 0, 0, 176, -1).alpha).toBe(0);
  });

  it('uses progressively cheaper sampling without changing the radial constants', () => {
    expect(resolveRadialFocusSampling('high')).toEqual({
      filterActive: true,
      sampleCount: 12,
      blurRadiusPx: 48,
    });
    expect(resolveRadialFocusSampling('medium')).toEqual({
      filterActive: true,
      sampleCount: 6,
      blurRadiusPx: 24,
    });
    expect(resolveRadialFocusSampling('low')).toEqual({
      filterActive: false,
      sampleCount: 0,
      blurRadiusPx: 0,
    });
    expect(RADIAL_FOCUS_SOFTNESS_PX).toBe(96);
    expect(RADIAL_FOCUS_DARKEN).toBeCloseTo(0.18);
    expect(RADIAL_FOCUS_DESATURATE).toBeCloseTo(0.58);
  });
});
