import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 }, Math: {
  Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
} }));
vi.mock('../../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityController: () => null }));
import { GpuVfxSystem } from '../../src/effects/gpu/GpuVfxSystem';
import { GpuVfxLaneId } from '../../src/effects/gpu/GpuVfxRenderLanes';
import { resetGpuVfxAtlasForTests } from '../../src/effects/gpu/GpuVfxAtlas';
import { ZeusUpgradesGpuRenderer } from '../../src/effects/ZeusUpgradesGpuRenderer';
import { makeFakeGpuVfxScene } from '../fakeGpuVfxScene';
import type { ZeusSnapshot } from '../../src/systems/ZeusRuntime';

describe('electrical GPU material under multiple owners', () => {
  it.each([4, 12])('bounds and releases %i bodies with long ground traces', owners => {
    resetGpuVfxAtlasForTests();
    const gpu = new GpuVfxSystem(makeFakeGpuVfxScene() as never);
    const renderer = new ZeusUpgradesGpuRenderer(gpu);
    const state: ZeusSnapshot = {
      balls: Array.from({ length: owners }, (_, i) => ({ playerId: String(i), useId: i,
        x: 720, y: i * 48, radius: 16, color: 0, expiresAt: 5000, positionRevision: 0 })),
      ground: Array.from({ length: owners * 60 }, (_, n) => ({ id: n, ownerId: String(Math.floor(n / 60)),
        from: { x: n % 60 * 12, y: Math.floor(n / 60) * 48, radius: 16 },
        to: { x: n % 60 * 12 + 12, y: Math.floor(n / 60) * 48, radius: 16 },
        color: 0, createdAt: n % 60, expiresAt: 5000 })), stuns: [],
    };
    let peakGround = 0, peakBody = 0;
    const started = performance.now();
    for (let frame = 0; frame < 60; frame++) {
      const now = frame * 16;
      renderer.sync(state, now, id => ({ x: 720 + frame * 8, y: Number(id) * 48, radius: 16 }));
      gpu.update(16);
      peakGround = Math.max(peakGround, gpu.getLaneStats(GpuVfxLaneId.ElectricGround)!.liveCount);
      peakBody = Math.max(peakBody, gpu.getLaneStats(GpuVfxLaneId.ElectricBody)!.liveCount);
    }
    const elapsed = performance.now() - started;
    const effects = gpu.buildReport().effects.filter(e => e.label.startsWith('zeus.'));
    for (const core of effects.filter(e => e.label.endsWith('-core'))) {
      expect(core.capacityDrops).toBe(0);
    }
    const drops = effects
      .reduce((sum, e) => sum + e.capacityDrops, 0);
    renderer.clear(); gpu.update(0);
    expect(gpu.getLaneStats(GpuVfxLaneId.ElectricGround)!.liveCount).toBe(0);
    expect(gpu.getLaneStats(GpuVfxLaneId.ElectricBody)!.liveCount).toBe(0);
    console.info(`Zeus GPU controller ${owners} owners: ${elapsed.toFixed(1)} ms / 60 headless frames, peaks ${peakGround} ground + ${peakBody} body, ${drops} decorative glow drops; all cores preserved and all resources released.`);
    gpu.destroy();
  });
});
