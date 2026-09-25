import { describe, expect, it, vi } from 'vitest';
import { TranslocatorTeleportRenderer } from '../src/effects/TranslocatorTeleportRenderer';
import type { GpuVfxSpawnSpec } from '../src/effects/gpu/GpuVfxSpawnSpec';
import type { GpuVfxEmissionTick } from '../src/effects/gpu/GpuVfxSystem';
import type { PortalPair } from '../src/systems/PortalTraversal';

vi.mock('phaser', () => ({ BlendModes: { ADD: 1, NORMAL: 0 } }));
vi.mock('../src/effects/EffectUtils', () => ({
  mixColors: (color: number) => color, makeAdditive: () => {}, registerGraphicsObject: () => {},
}));
vi.mock('../src/effects/gpu/GpuVfxAtlas', () => ({
  GpuVfxFrameId: { ExplosionRing: 1, DeathGlow: 2, ExplosionSpark: 3 }, getGpuVfxFrame: () => ({ width: 32 }),
}));
vi.mock('../src/effects/gpu/GpuVfxEffects', () => ({ GpuVfxEffectId: { TranslocatorPortal: 0 } }));

function setup() {
  const graphics = () => {
    const g: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['setDepth', 'clear', 'fillStyle', 'fillCircle', 'lineStyle', 'strokeCircle',
      'beginPath', 'arc', 'strokePath', 'lineBetween', 'destroy']) g[method] = vi.fn(() => g);
    return g;
  };
  let nextSource = 0;
  const ticks = new Set<GpuVfxEmissionTick>();
  const gpu = {
    emissionGeneration: 0, isSuppressed: () => false,
    createSpec: () => ({} as GpuVfxSpawnSpec), createSource: () => nextSource++,
    releaseSource: vi.fn(), spawn: vi.fn((_spec: GpuVfxSpawnSpec, _source: number, _now: number) => true),
    quality: { scaleFrequency: (n: number) => n, scaleDiscreteBurst: (_effect: number, n: number) => n },
    registerEmission: (tick: GpuVfxEmissionTick) => { ticks.add(tick); return () => { ticks.delete(tick); }; },
  };
  const scene = { add: { graphics }, cameras: { main: { worldView: { x: 0, y: 0, right: 800, bottom: 600 } } },
    tweens: { addCounter: () => ({ remove: vi.fn() }) } };
  const renderer = new TranslocatorTeleportRenderer(scene as never, gpu as never);
  const pair: PortalPair = { id: 'pair', ownerId: 'owner', a: { x: 100, y: 100 }, b: { x: 400, y: 100 },
    radius: 16, reentryDistance: 40, damageBonus: 0, createdAt: 0, expiresAt: 15000 };
  const frame = (now: number) => { for (const tick of ticks) tick(16, now); };
  return { renderer, gpu, pair, frame, ticks };
}

describe('translocator portal presentation lifetime', () => {
  it('emits after the GPU sweep and releases closed portals and world-owned effects', () => {
    const w = setup();
    w.renderer.syncPortals([w.pair], 500);
    expect(w.gpu.spawn).not.toHaveBeenCalled();
    w.frame(500);
    expect(w.gpu.spawn).toHaveBeenCalled();
    const portalSource = w.gpu.spawn.mock.calls[0][1];
    w.gpu.spawn.mockClear();
    w.renderer.syncPortals([], 600);
    w.frame(600);
    expect(w.gpu.releaseSource).toHaveBeenCalledWith(portalSource);
    expect(w.gpu.spawn).not.toHaveBeenCalled();
    w.renderer.playFlash(100, 100, 0xffffff, 'end');
    w.renderer.destroy(); w.renderer.destroy();
    w.frame(700);
    expect(w.ticks.size).toBe(0);
    expect(w.gpu.spawn).not.toHaveBeenCalled();
    expect(w.gpu.releaseSource).toHaveBeenCalledTimes(2);
  });

  it('drops queued bursts when the GPU generation is invalidated', () => {
    const w = setup();
    w.renderer.playFlash(100, 100, 0xffffff, 'end');
    w.gpu.emissionGeneration++;
    w.frame(500);
    expect(w.gpu.spawn).not.toHaveBeenCalled();
    w.renderer.syncPortals([w.pair], 600);
    w.frame(600);
    expect(w.gpu.spawn).toHaveBeenCalled();
    w.renderer.destroy();
  });
});
