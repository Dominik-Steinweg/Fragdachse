import { describe, expect, it } from 'vitest';
import { SPAWN_CAMERA_ZOOM, SpawnCameraZoom, spawnZoomReleaseCurve } from '../src/effects/camera/SpawnCameraZoom';

const { pushInMs, dwellMs, releaseMs } = SPAWN_CAMERA_ZOOM;

function samples(zoom: SpawnCameraZoom, fromMs: number, toMs: number, stepMs = 10): number[] {
  const out: number[] = [];
  for (let t = fromMs; t <= toMs; t += stepMs) out.push(zoom.sample(t));
  return out;
}

describe('spawn close-up zoom', () => {
  it('cuts into a close-up, pulls out without overshoot and ends exactly at the play view', () => {
    const zoom = new SpawnCameraZoom();
    expect(zoom.sample(0)).toBe(1);
    zoom.begin(1000, false);
    expect(zoom.sample(1000)).toBeGreaterThan(1);
    const pullOut = samples(zoom, 1000 + pushInMs + dwellMs, 1000 + pushInMs + dwellMs + releaseMs);
    pullOut.forEach((value, i) => {
      expect(value).toBeGreaterThanOrEqual(1);
      if (i > 0) expect(value).toBeLessThanOrEqual(pullOut[i - 1]);
    });
    expect(zoom.sample(1000 + pushInMs + dwellMs + releaseMs)).toBe(1);
    expect(zoom.sample(1_000_000)).toBe(1);
  });

  it('is a pure function of time, so repeated samples within one frame agree', () => {
    const zoom = new SpawnCameraZoom();
    zoom.begin(0, false);
    const t = pushInMs + dwellMs + releaseMs / 3;
    expect(zoom.sample(t)).toBe(zoom.sample(t));
  });

  it('holds a countdown close-up until released, then pulls out from where it stands', () => {
    const zoom = new SpawnCameraZoom();
    zoom.begin(0, true);
    expect(zoom.holding).toBe(true);
    const held = zoom.sample(pushInMs + dwellMs + releaseMs + 5000);
    expect(held).toBeGreaterThan(1);
    zoom.release(10_000);
    expect(zoom.holding).toBe(false);
    expect(zoom.sample(10_000)).toBeCloseTo(held, 3);
    expect(zoom.sample(10_000 + releaseMs)).toBe(1);
  });

  it('closes in on a death and lets the respawn continue from that level without a jump', () => {
    const zoom = new SpawnCameraZoom();
    zoom.begin(0, false);
    zoom.sample(10_000);
    zoom.death(10_000);
    expect(zoom.sample(10_000)).toBe(1);
    const closing = samples(zoom, 10_000, 10_000 + SPAWN_CAMERA_ZOOM.deathMs);
    closing.forEach((value, i) => { if (i > 0) expect(value).toBeGreaterThanOrEqual(closing[i - 1]); });
    const held = zoom.sample(30_000);
    expect(held).toBeCloseTo(SPAWN_CAMERA_ZOOM.cutZoom, 6);
    zoom.begin(30_000, false);
    expect(zoom.sample(30_000)).toBeCloseTo(held, 6);
    expect(zoom.sample(30_000 + pushInMs + dwellMs + releaseMs)).toBe(1);
  });

  it('drops the close-up at once when cancelled, without a figure to show', () => {
    const zoom = new SpawnCameraZoom();
    zoom.begin(0, true);
    zoom.cancel();
    expect(zoom.holding).toBe(false);
    expect(zoom.sample(50)).toBe(1);
  });

  it('starts and ends the pull-out at rest', () => {
    expect(spawnZoomReleaseCurve(0)).toBe(0);
    expect(spawnZoomReleaseCurve(1)).toBe(1);
    expect(spawnZoomReleaseCurve(0.001)).toBeLessThan(0.0001);
    expect(1 - spawnZoomReleaseCurve(0.999)).toBeLessThan(0.0001);
  });
});
