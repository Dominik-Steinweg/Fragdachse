import { describe, expect, it } from 'vitest';
import {
  getArrowPointOnScreenViewEdge,
  getArrowPointOnWorldViewEdge,
  getVisibleWorldView,
  isWorldPointInsideView,
  type WorldViewRect,
} from '../src/ui/HostileBaseIndicator';

const view: WorldViewRect = {
  x: 100,
  y: 50,
  width: 800,
  height: 500,
  centerX: 500,
  centerY: 300,
};

describe('HostileBaseIndicator geometry', () => {
  it('pins a target to the correct screen edge while preserving its direction', () => {
    expect(getArrowPointOnWorldViewEdge(1_500, 300, view)).toEqual({ x: 890, y: 300 });
    expect(getArrowPointOnWorldViewEdge(-500, 300, view)).toEqual({ x: 110, y: 300 });
    expect(getArrowPointOnWorldViewEdge(500, -500, view).y).toBeCloseTo(60, 10);
    expect(getArrowPointOnWorldViewEdge(500, 1_100, view).y).toBeCloseTo(540, 10);
  });

  it('uses the corner edge for diagonal targets', () => {
    const point = getArrowPointOnWorldViewEdge(1_500, 1_000, view);
    expect(point.x).toBeCloseTo(842.86, 1);
    expect(point.y).toBe(540);
    expect(point.x).toBeGreaterThan(view.x);
    expect(point.x).toBeLessThan(view.x + view.width);
    expect(point.y).toBeGreaterThan(view.y);
    expect(point.y).toBeLessThan(view.y + view.height);
  });

  it('converts the world edge point to the fixed screen overlay coordinates', () => {
    expect(getArrowPointOnScreenViewEdge(1_500, 300, view, { x: 0, y: 0, zoom: 1 }, 20))
      .toEqual({ x: 780, y: 250 });
    expect(getArrowPointOnScreenViewEdge(1_500, 300, { ...view, x: 500, centerX: 900 }, { x: 0, y: 0, zoom: 2 }, 20))
      .toEqual({ x: 790, y: 250 });
  });

  it('switches to the world indicator exactly when the base centre enters the view', () => {
    expect(isWorldPointInsideView(100, 300, view)).toBe(true);
    expect(isWorldPointInsideView(99, 300, view)).toBe(false);
    expect(isWorldPointInsideView(900, 300, view)).toBe(true);
    expect(isWorldPointInsideView(901, 300, view)).toBe(false);
    expect(isWorldPointInsideView(500, 49, view)).toBe(false);
    expect(isWorldPointInsideView(500, 551, view)).toBe(false);
  });

  it('derives the visible world rect from an origin-(0, 0) camera instead of trusting worldView', () => {
    const camera = { width: 3_840, height: 2_160, originX: 0, originY: 0, zoom: 2, scrollX: 700, scrollY: 0 };
    expect(getVisibleWorldView(camera)).toEqual({
      x: 700,
      y: 0,
      width: 1_920,
      height: 1_080,
      centerX: 1_660,
      centerY: 540,
    });
  });

  it('reproduces Phasers centred worldView for an origin-(0.5, 0.5) camera', () => {
    const camera = { width: 3_840, height: 2_160, originX: 0.5, originY: 0.5, zoom: 2, scrollX: 700, scrollY: 0 };
    const centred = getVisibleWorldView(camera);
    expect(centred.x).toBe(700 + (3_840 - 1_920) / 2);
    expect(centred.y).toBe((2_160 - 1_080) / 2);
    expect(centred.width).toBe(1_920);
  });

  it('is a no-op at render scale 1', () => {
    const camera = { width: 1_920, height: 1_080, originX: 0, originY: 0, zoom: 1, scrollX: 320, scrollY: 0 };
    expect(getVisibleWorldView(camera)).toEqual({
      x: 320,
      y: 0,
      width: 1_920,
      height: 1_080,
      centerX: 1_280,
      centerY: 540,
    });
  });
});
