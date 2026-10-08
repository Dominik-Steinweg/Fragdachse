import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 },
  Scenes: { Events: { PRE_RENDER: 'prerender', SHUTDOWN: 'shutdown' } },
  Math: { Linear: (a: number, b: number, t: number) => a + (b - a) * t } }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityController: () => ({
  getProfile: () => ({ particleFactors: { critical: 1, standard: 1, decorative: 1 } }), subscribe: () => () => {},
}) }));
import { VoidHunterSparksRenderer } from '../src/effects/VoidHunterSparksRenderer';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GpuVfxLaneId } from '../src/effects/gpu/GpuVfxRenderLanes';
import type { BossPresenceSource } from '../src/effects/BossPresenceRenderer';
import { getCameraFocusOverride } from '../src/graphics/cameraFocusOverride';
import { readBossIntroState, VOID_SPARKS_INTRO } from '../src/config/bossIntros';
import { makeFakeGpuVfxScene } from './fakeGpuVfxScene';

beforeEach(() => resetGpuVfxAtlasForTests());

function setup() {
  const scene = Object.assign(makeFakeGpuVfxScene(), { cameras: { main: {
    width: 1100, height: 1100, originX: 0, originY: 0, zoom: 1, scrollX: -100, scrollY: -100,
  } } });
  const lights = new Map<string, { x: number; y: number }>();
  const lighting = {
    setLight: (key: string, _preset: string, x: number, y: number) => lights.set(key, { x, y }),
    releaseLight: (key: string) => lights.delete(key),
  };
  const gpu = new GpuVfxSystem(scene as never);
  const spawn = vi.spyOn(gpu, 'spawn');
  const renderer = new VoidHunterSparksRenderer(scene as never, gpu, lighting as never);
  const boss: BossPresenceSource = { id: 'boss', x: 200, y: 200, size: 78, visible: true, voidPhase: 1 };
  const live = () => gpu.getLaneStats(GpuVfxLaneId.ExplosionLowGlow)!.liveCount;
  return { scene, gpu, renderer, lights, boss, spawn, live };
}

describe('Void hunter GPU presentation', () => {
  it('continuously emits at the replicated position and releases particles and light on hiding/removal', () => {
    const f = setup();
    f.renderer.syncBosses([f.boss]); f.gpu.update(100);
    expect(f.live()).toBeGreaterThan(0);
    expect(f.lights.size).toBeGreaterThan(0);
    const lightBefore = [...f.lights.values()][0];
    f.gpu.update(100);
    expect([...f.lights.values()][0]).not.toEqual(lightBefore);
    f.renderer.syncBosses([{ ...f.boss, x: 500, y: 600 }]);
    f.spawn.mockClear(); f.gpu.update(100);
    expect(f.spawn).toHaveBeenCalled();
    for (const [spec] of f.spawn.mock.calls) {
      expect(Math.hypot(spec.x - 500, spec.y - 600)).toBeLessThanOrEqual(f.boss.size / 2);
    }
    f.renderer.syncBosses([{ ...f.boss, visible: false }]);
    expect(f.live()).toBe(0); expect(f.lights.size).toBe(0);
    f.renderer.syncBosses([f.boss]); f.gpu.update(100);
    expect(f.live()).toBeGreaterThan(0);
    f.renderer.syncBosses([]);
    expect(f.live()).toBe(0); expect(f.lights.size).toBe(0);
  });

  it('renders a late-joined intro before emergence and clears its focus/light/particles at completion', () => {
    const f = setup();
    const state = readBossIntroState({ preset: 'void-sparks', x: 220, y: 240, seed: 17, startedAtMs: 1000 })!;
    expect(state).not.toBeNull();
    const now = state.startedAtMs + VOID_SPARKS_INTRO.emergeAtMs / 2;
    f.renderer.syncIntro(state, now); f.gpu.update(100);
    expect(f.live()).toBeGreaterThan(0); expect(f.lights.size).toBeGreaterThan(0);
    expect(getCameraFocusOverride(f.scene as never)).toMatchObject({ x: state.x, y: state.y });
    expect(f.renderer.ownsSpawnAt(state, now)).toBe(true);
    f.renderer.syncIntro(state, state.startedAtMs + VOID_SPARKS_INTRO.durationMs + 1);
    expect(f.live()).toBe(0); expect(f.lights.size).toBe(0);
    expect(getCameraFocusOverride(f.scene as never)).toBeNull();
    f.renderer.syncIntro({ ...state, preset: 'graveyard-rise' }, now); f.gpu.update(100);
    expect(f.live()).toBe(0);
  });

  it('bounds steady-state load and cleans up on suppression, culling, world clear and destruction', () => {
    const f = setup();
    f.renderer.syncBosses([f.boss]);
    for (let i = 0; i < 600; i++) f.gpu.update(16);
    expect(f.gpu.getLaneStats(GpuVfxLaneId.ExplosionLowGlow)!.capacityDrops).toBe(0);
    expect(f.lights.size).toBeGreaterThan(0);
    const lightsAtSteadyState = f.lights.size;
    for (let i = 0; i < 600; i++) f.gpu.update(16);
    expect(f.lights.size).toBeLessThanOrEqual(lightsAtSteadyState);
    f.gpu.setSuppressed(true); f.renderer.syncBosses([f.boss]); f.gpu.update(16);
    expect(f.live()).toBe(0); expect(f.lights.size).toBe(0);
    f.gpu.setSuppressed(false); f.gpu.update(100);
    expect(f.live()).toBeGreaterThan(0);
    f.renderer.syncBosses([{ ...f.boss, x: 10000 }]); f.gpu.update(16);
    expect(f.live()).toBe(0); expect(f.lights.size).toBe(0);
    f.renderer.syncBosses([f.boss]); f.gpu.update(100); f.renderer.clear();
    expect(f.live()).toBe(0); expect(f.lights.size).toBe(0);
    f.renderer.syncBosses([f.boss]); f.gpu.update(100); f.renderer.destroy(); f.renderer.destroy();
    f.spawn.mockClear(); f.renderer.syncBosses([f.boss]); f.gpu.update(100);
    expect(f.spawn).not.toHaveBeenCalled(); expect(f.live()).toBe(0); expect(f.lights.size).toBe(0);
  });
});
