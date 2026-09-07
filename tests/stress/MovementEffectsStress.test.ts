import { expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 }, Math: {
  Clamp: (n: number, a: number, b: number) => Math.max(a, Math.min(b, n)),
  Linear: (a: number, b: number, t: number) => a + (b - a) * t,
} }));
vi.mock('../../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityController: () => ({
  getProfile: () => ({ particleFactors: { critical: 1, standard: 1, decorative: 1 } }), subscribe: () => () => {},
}) }));

import { MovementEffectsRenderer } from '../../src/effects/MovementEffectsRenderer';
import { createMovementVisualSample, type MovementVisualSample } from '../../src/effects/MovementStepSampler';
import { GpuVfxSystem } from '../../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../../src/effects/gpu/GpuVfxAtlas';
import { MOVEMENT_FX } from '../../src/config/movementEffects';
import { findFakeLane, makeFakeGpuVfxScene } from '../fakeGpuVfxScene';

it('bounds a large mixed crowd, reserves player contacts and retires all world residuals', () => {
  resetGpuVfxAtlasForTests();
  const scene = makeFakeGpuVfxScene();
  const gpu = new GpuVfxSystem(scene as never);
  const renderer = new MovementEffectsRenderer(gpu);
  const world = {}; renderer.openWorld(world);
  const sources = Array.from({ length: 1012 }, (_, i) => ({
    sample: { ...createMovementVisualSample(), id: String(i), player: i < 12, pawCount: i < 12 ? 2 : 4,
      mode: 'walk', visible: true, x: i < 12 ? -2000 : 0, y: i * 20 } as MovementVisualSample,
    readMovementVisualSample(out: MovementVisualSample) { Object.assign(out, this.sample); },
  }));
  const players = sources.slice(0, 12), enemies = sources.slice(12);
  const lane = findFakeLane(scene, 'movement-ground');
  const allocated = lane.added;
  for (let frame = 0; frame < 100; frame++) {
    for (const source of sources) source.sample.x += 8;
    renderer.captureFrame(16, true, players, enemies, { x: -3000, y: -100, width: 10000, height: 30000 });
    gpu.update(16);
    expect(gpu.getStats()!['movement-ground'].liveCount).toBeLessThanOrEqual(allocated);
  }
  const footprints = lane.members.filter(m => m.frame?.startsWith('movement-paw-'));
  expect(footprints.length).toBeLessThanOrEqual(MOVEMENT_FX.footprintCapacity);
  expect(footprints.filter(m => m.x.base < 0).length).toBeGreaterThan(0);
  expect(lane.added).toBe(allocated);
  renderer.closeWorld(world);
  expect(gpu.getStats()!['movement-ground'].liveCount).toBe(0);
  gpu.update(MOVEMENT_FX.footprintLifeMaxMs + 1);
  expect(lane.visible).toBe(false);
  renderer.destroy(); gpu.destroy();
});
