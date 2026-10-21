import { describe, expect, it } from 'vitest';
import { PLAYER_CAMERA_ZOOM, PlayerCameraZoom, wheelDeltaPixels } from '../src/effects/camera/PlayerCameraZoom';

describe('player camera zoom', () => {
  it('never zooms out beyond the default view and never past its maximum', () => {
    const zoom = new PlayerCameraZoom();
    zoom.nudge(100);
    expect(zoom.targetZoom).toBe(1);
    for (let i = 0; i < 50; i++) zoom.nudge(-100);
    expect(zoom.targetZoom).toBe(PLAYER_CAMERA_ZOOM.max);
    for (let i = 0; i < 50; i++) zoom.nudge(100);
    expect(zoom.targetZoom).toBe(1);
  });

  it('glides to the wheel target and samples idempotently within a frame', () => {
    const zoom = new PlayerCameraZoom();
    zoom.sample(0);
    zoom.nudge(-100);
    const early = zoom.sample(16);
    expect(early).toBeGreaterThan(1);
    expect(early).toBeLessThan(zoom.targetZoom);
    expect(zoom.sample(16)).toBe(early);
    expect(zoom.sample(5000)).toBe(zoom.targetZoom);
  });

  it('treats line- and page-based wheels like pixel wheels and one event as at most one notch', () => {
    expect(wheelDeltaPixels(3, 1)).toBeGreaterThanOrEqual(99);
    expect(wheelDeltaPixels(1, 2)).toBeGreaterThan(100);
    const huge = new PlayerCameraZoom(), notch = new PlayerCameraZoom();
    huge.nudge(-5000);
    notch.nudge(-100);
    expect(huge.targetZoom).toBe(notch.targetZoom);
  });
});
