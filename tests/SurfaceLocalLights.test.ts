import { describe, expect, it } from 'vitest';
import { createSurfaceLightFrame, surfaceLightResponse, surfaceMoonResponse } from '../src/effects/SurfaceLocalLights';

function lamp(x: number, y: number, angle: number | null) {
  const frame = createSurfaceLightFrame();
  frame.count = 1; frame.ambient = .08;
  frame.position.set([x, y, 420, .9]);
  if (angle === null) frame.cone.set([1, 0, 0, 0]);
  else frame.cone.set([Math.cos(angle), Math.sin(angle), Math.PI * .12, Math.PI * .084]);
  frame.profile[0] = 1.4;
  return frame;
}

describe('relative surface form under lamps and moon (Nachtsicht N-4)', () => {
  it('keeps a flat surface and an unlit point exactly neutral', () => {
    const frame = lamp(0, 0, 0);
    expect(surfaceLightResponse(frame, 0, 0, 1, 100, 0)).toBeCloseTo(1, 12);
    // Behind the lamp the cone adds nothing; tilted faces there keep the ambient response.
    expect(surfaceLightResponse(frame, .6, 0, .8, -100, 0)).toBe(1);
    expect(surfaceLightResponse(createSurfaceLightFrame(), .6, 0, .8, 100, 0)).toBe(1);
  });

  it('brightens faces towards the lamp and darkens averted ones', () => {
    const frame = lamp(0, 0, 0);
    const towards = surfaceLightResponse(frame, -.6, 0, .8, 120, 0);
    const away = surfaceLightResponse(frame, .6, 0, .8, 120, 0);
    expect(towards).toBeGreaterThan(1);
    expect(away).toBeLessThan(1);
    // The ambient share is never removed: even a fully averted face keeps it.
    expect(away).toBeGreaterThan(0);
  });

  it('weakens with distance as the lamp loses dominance over the ambient', () => {
    const frame = lamp(0, 0, null);
    const near = surfaceLightResponse(frame, -.6, 0, .8, 60, 0);
    const far = surfaceLightResponse(frame, -.6, 0, .8, 380, 0);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(1);
  });

  it('applies moon relief only with a strength', () => {
    expect(surfaceMoonResponse([.5, 0, .8, 0], -.6, 0, .8)).toBe(1);
    expect(surfaceMoonResponse([.5, 0, .8, .5], 0, 0, 1)).toBeCloseTo(1, 12);
    expect(surfaceMoonResponse([.5, 0, .8, .5], .6, 0, .8)).toBeGreaterThan(1);
  });
});
