import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 },
  Scenes: { Events: { PRE_RENDER: 'prerender', SHUTDOWN: 'shutdown' } },
  Math: { Linear: (a: number, b: number, t: number) => a + (b - a) * t } }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityController: () => ({
  getProfile: () => ({ particleFactors: { critical: 1, standard: 1, decorative: 1 } }), subscribe: () => () => {},
}) }));
import { VoidMeteorParticleTrail } from '../src/effects/VoidMeteorParticleTrail';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GpuVfxLaneId } from '../src/effects/gpu/GpuVfxRenderLanes';
import { makeFakeGpuVfxScene } from './fakeGpuVfxScene';

beforeEach(() => resetGpuVfxAtlasForTests());
function fixture() {
  const gpu = new GpuVfxSystem(makeFakeGpuVfxScene() as never);
  const trail = new VoidMeteorParticleTrail(gpu);
  const spawn = vi.spyOn(gpu, 'spawn');
  const lanes = [GpuVfxLaneId.VoidMeteorMaterial, GpuVfxLaneId.VoidMeteorEmission];
  const live = () => lanes.reduce((sum, lane) => sum + gpu.getLaneStats(lane)!.liveCount, 0);
  trail.start(42);
  trail.sync(500, 600, 2.5, 180, true);
  return { gpu, trail, spawn, lanes, live };
}

describe('Void meteor GPU particle lifecycle', () => {
  it('emits bounded layers, stops on impact and lets existing particles finish', () => {
    const f = fixture();
    for (let i = 0; i < 600; i++) f.gpu.update(16);
    for (const lane of f.lanes) {
      const stats = f.gpu.getLaneStats(lane)!;
      expect(stats.liveCount).toBeGreaterThan(0);
      expect(stats.capacityDrops).toBe(0);
    }
    const alive = f.live();
    f.trail.sync(500, 600, 2.5, 0, false);
    expect(f.live()).toBe(alive);
    f.spawn.mockClear();
    for (let i = 0; i < 130; i++) f.gpu.update(16);
    expect(f.spawn).not.toHaveBeenCalled();
    expect(f.live()).toBe(0);
    f.trail.destroy(); f.gpu.destroy();
  });

  it('clears surviving particles and unregisters emission on destroy', () => {
    const f = fixture();
    f.gpu.update(100); expect(f.live()).toBeGreaterThan(0);
    f.trail.clear(); expect(f.live()).toBe(0);
    f.trail.start(7); f.trail.sync(500, 600, 2.5, 180, true);
    f.gpu.update(100); expect(f.live()).toBeGreaterThan(0);
    f.trail.destroy(); f.trail.destroy();
    f.spawn.mockClear(); f.trail.sync(500, 600, 2.5, 180, true); f.gpu.update(100);
    expect(f.spawn).not.toHaveBeenCalled(); expect(f.live()).toBe(0);
    f.gpu.destroy();
  });

  it('does not replay emissions on zero-delta observations and scales with quality and speed', () => {
    const slow = fixture(), fast = fixture(), reduced = fixture();
    slow.trail.sync(500, 600, 2.5, 10, true);
    fast.trail.sync(500, 600, 2.5, 300, true);
    vi.spyOn(reduced.gpu.quality, 'scaleFrequency').mockReturnValue(0);
    for (const f of [slow, fast, reduced]) {
      f.gpu.update(0); expect(f.spawn).not.toHaveBeenCalled();
      for (let i = 0; i < 20; i++) f.gpu.update(16);
    }
    expect(fast.spawn.mock.calls.length).toBeGreaterThan(slow.spawn.mock.calls.length);
    expect(reduced.spawn).not.toHaveBeenCalled();
    for (const f of [slow, fast, reduced]) { f.trail.destroy(); f.gpu.destroy(); }
  });

  it('invalidates recycled sources on global clear and waits for the next observed flight', () => {
    const f = fixture();
    f.gpu.update(100); f.gpu.releaseAll();
    f.spawn.mockClear(); f.gpu.update(100);
    expect(f.spawn).not.toHaveBeenCalled(); expect(f.live()).toBe(0);
    f.trail.sync(500, 600, 2.5, 180, true); f.gpu.update(100);
    expect(f.live()).toBeGreaterThan(0);
    f.trail.destroy(); f.gpu.destroy();
  });
});
