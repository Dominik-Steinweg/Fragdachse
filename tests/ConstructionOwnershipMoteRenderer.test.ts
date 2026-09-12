import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 }, Math: {
  Clamp: (n: number, a: number, b: number) => Math.max(a, Math.min(b, n)),
  Linear: (a: number, b: number, t: number) => a + (b - a) * t,
} }));
const quality = vi.hoisted(() => ({ decorative: 1, standard: 1, critical: 1, changed: () => {} }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityController: () => ({
  getProfile: () => ({ particleFactors: quality }),
  subscribe: (fn: () => void) => { quality.changed = fn; return () => {}; },
}) }));
import { ConstructionOwnershipMoteRenderer } from '../src/effects/ConstructionOwnershipMoteRenderer';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

const target = { id: 1, x: 100, y: 100, width: 50, height: 50, color: 0x44aaff };
const view = { x: 0, y: 0, width: 400, height: 400, centerX: 200, centerY: 200 };
beforeEach(() => { resetGpuVfxAtlasForTests(); quality.decorative = 1; });
function setup() {
  const scene = makeFakeGpuVfxScene(); const gpu = new GpuVfxSystem(scene as never);
  const registration = vi.spyOn(gpu, 'registerEmission');
  const renderer = new ConstructionOwnershipMoteRenderer(gpu); const scope = {};
  renderer.openWorld(scope);
  return { scene, gpu, registration, renderer, scope, lane: findFakeLane(scene, 'explosion-accent') };
}
describe('construction ownership motes', () => {
  it('emits after the GPU sweep, bursts only on activation and emits sparse visible ambient', () => {
    const h = setup(); const outside = { ...target, id: 2, x: 900 };
    h.renderer.captureFrame(h.scope, false, [target], view); h.gpu.update(16);
    expect(h.lane.members).toHaveLength(0);
    h.renderer.captureFrame(h.scope, true, [target, outside], view);
    expect(h.lane.members).toHaveLength(0);
    h.gpu.update(16);
    const burst = h.lane.members.length; expect(burst).toBeGreaterThan(0);
    expect(h.lane.members.every(m => m.x.base < 200)).toBe(true);
    h.renderer.captureFrame(h.scope, true, [{ ...target }], view); h.gpu.update(16);
    expect(h.lane.members).toHaveLength(burst);
    // Entering the view does not replay the activation burst.
    h.renderer.captureFrame(h.scope, true, [target, { ...outside, x: 300 }], view); h.gpu.update(16);
    expect(h.lane.members).toHaveLength(burst);
    h.renderer.captureFrame(h.scope, true, [target], view); h.gpu.update(4000);
    expect(h.lane.members.length).toBeGreaterThan(burst);
    const ambient = h.lane.members.length;
    h.gpu.update(10_000); // No captured frame, no autonomous stale emission.
    expect(h.lane.members).toHaveLength(ambient);
    h.renderer.destroy(); h.gpu.destroy();
  });

  it('clears live particles on deactivate and rejects stale world calls with reused runtime IDs', () => {
    const h = setup(); h.renderer.captureFrame(h.scope, true, [target], view); h.gpu.update(16);
    h.renderer.captureFrame(h.scope, false, [], view);
    expect(h.lane.visible).toBe(false);
    const next = {}; h.renderer.openWorld(next);
    h.renderer.captureFrame(next, true, [{ ...target, x: 250 }], view); h.gpu.update(16);
    const count = h.lane.members.length;
    h.renderer.closeWorld(h.scope); h.renderer.openWorld(h.scope);
    h.renderer.captureFrame(h.scope, false, [], view);
    expect(h.lane.visible).toBe(true);
    h.renderer.captureFrame(next, true, [target], view); h.gpu.update(16);
    expect(h.lane.members).toHaveLength(count);
    expect(h.registration).toHaveBeenCalledOnce();
    // Offscreen removal may leave a short-lived mote, but closing the world must kill it.
    h.renderer.captureFrame(next, true, [], view); h.gpu.update(16);
    h.renderer.closeWorld(next); h.renderer.closeWorld(next);
    expect(h.lane.visible).toBe(false);
    h.renderer.destroy(); h.renderer.destroy(); h.gpu.destroy();
  });

  it('discards prepared commands across suppression and does not catch up when resumed', () => {
    const h = setup(); h.renderer.captureFrame(h.scope, true, [target], view);
    h.gpu.setSuppressed(true); h.gpu.update(10_000); h.gpu.setSuppressed(false); h.gpu.update(16);
    expect(h.lane.members).toHaveLength(0);
    h.renderer.captureFrame(h.scope, true, [target], view); h.gpu.update(16);
    expect(h.lane.members).toHaveLength(0);
    h.renderer.captureFrame(h.scope, false, [], view);
    h.renderer.captureFrame(h.scope, true, [target], view); h.gpu.update(16);
    expect(h.lane.members.length).toBeGreaterThan(0);
    h.renderer.destroy(); h.gpu.destroy();
  });

  it('honors decorative quality and never queues failed admission for retry', () => {
    const h = setup(); quality.decorative = 0; quality.changed();
    h.renderer.captureFrame(h.scope, true, [target], view); h.gpu.update(4000);
    expect(h.lane.members).toHaveLength(0);
    quality.decorative = 1; quality.changed();
    h.renderer.captureFrame(h.scope, false, [], view);
    const spawn = vi.spyOn(h.gpu, 'spawn').mockReturnValue(false);
    h.renderer.captureFrame(h.scope, true, [target], view); h.gpu.update(16);
    expect(spawn).toHaveBeenCalled(); const calls = spawn.mock.calls.length;
    h.renderer.captureFrame(h.scope, true, [target], view); h.gpu.update(16);
    expect(spawn).toHaveBeenCalledTimes(calls);
    spawn.mockRestore(); h.renderer.destroy(); h.gpu.destroy();
  });
});
