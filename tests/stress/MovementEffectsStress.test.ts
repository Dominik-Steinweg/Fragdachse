import { expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 }, Math: {
  Clamp: (n: number, a: number, b: number) => Math.max(a, Math.min(b, n)),
  Linear: (a: number, b: number, t: number) => a + (b - a) * t,
} }));
vi.mock('../../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityController: () => ({
  getProfile: () => ({ particleFactors: { critical: 1, standard: 1, decorative: 1 } }), subscribe: () => () => {},
}) }));

import { MovementEffectsRenderer } from '../../src/effects/MovementEffectsRenderer';
import { BurrowGpuRenderer } from '../../src/effects/BurrowGpuRenderer';
import { createMovementVisualSample, type MovementVisualSample } from '../../src/effects/MovementStepSampler';
import { GpuVfxSystem } from '../../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../../src/effects/gpu/GpuVfxAtlas';
import { MOVEMENT_FX } from '../../src/config/movementEffects';
import { findFakeLane, makeFakeGpuVfxScene } from '../fakeGpuVfxScene';

it('bounds a crowd of moving and stationary buried players followed by simultaneous Burrow dashes', () => {
  resetGpuVfxAtlasForTests();
  const scene = makeFakeGpuVfxScene();
  const gpu = new GpuVfxSystem(scene as never);
  const burrow = new BurrowGpuRenderer(gpu);
  const renderer = new MovementEffectsRenderer(gpu, burrow);
  const world = {}; renderer.openWorld(world); burrow.openWorld(world);
  const sources = Array.from({ length: 1012 }, (_, i) => ({
    sample: { ...createMovementVisualSample(), id: String(i), player: i < 12, pawCount: i < 12 ? 2 : 4,
      mode: 'walk', visible: true, x: i < 12 ? -2000 : 0, y: i * 20 } as MovementVisualSample,
    readMovementVisualSample(out: MovementVisualSample) { Object.assign(out, this.sample); },
  }));
  const players = sources.slice(0, 12), enemies = sources.slice(12);
  const buried = players.slice(0, 6).map(player => {
    player.sample.visible = false;
    const target = { x: player.sample.x, y: player.sample.y, rotation: 0, active: true };
    burrow.syncUnderground(player.sample.id, target);
    return { player, target };
  });
  const lane = findFakeLane(scene, 'movement-ground');
  const debris = findFakeLane(scene, 'world-debris');
  const allocated = lane.added;
  const flightAllocated = debris.added;
  for (let frame = 0; frame < 100; frame++) {
    if (frame === 50) {
      for (const player of players.slice(2)) {
        burrow.clearUnderground(player.sample.id);
        player.sample.visible = true; player.sample.isBurrowDash = true; player.sample.mode = 'dash';
        burrow.playExit(player.sample.x, player.sample.y);
      }
    }
    for (let i = 0; i < sources.length; i++) {
      // Some buried players stay still while the others dig through the same crowded frame.
      if (i >= 2) sources[i].sample.x += 8;
    }
    for (const { player, target } of buried) {
      target.x = player.sample.x; target.y = player.sample.y;
    }
    renderer.captureFrame(16, true, players, enemies, { x: -3000, y: -100, width: 10000, height: 30000 });
    gpu.update(16);
    expect(gpu.getStats()!['movement-ground'].liveCount).toBeLessThanOrEqual(allocated);
    expect(gpu.getStats()!['world-debris'].liveCount).toBeLessThanOrEqual(flightAllocated);
    if (frame === 49) expect(debris.members.length).toBeGreaterThan(0);
  }
  const footprints = lane.members.filter(m => m.frame?.startsWith('movement-paw-'));
  expect(footprints.length).toBeLessThanOrEqual(MOVEMENT_FX.footprintCapacity);
  expect(footprints.filter(m => m.x.base < 0).length).toBeGreaterThan(0);
  expect(lane.added).toBe(allocated);
  expect(debris.members.some(member => member.frame === 'explosion-chunk')).toBe(true);
  expect(debris.added).toBe(flightAllocated);
  renderer.closeWorld(world);
  burrow.closeWorld(world);
  expect(gpu.getStats()!['movement-ground'].liveCount).toBe(0);
  expect(gpu.getStats()!['world-debris'].liveCount).toBe(0);
  gpu.update(MOVEMENT_FX.footprintLifeMaxMs + 1);
  expect(lane.visible).toBe(false);
  expect(gpu.getStats()!['world-debris'].liveCount).toBe(0);
  // The next world must not inherit live underground source bindings from the old crowd.
  burrow.openWorld({});
  gpu.update(16);
  expect(gpu.getStats()!['movement-ground'].liveCount).toBe(0);
  expect(gpu.getStats()!['world-debris'].liveCount).toBe(0);
  renderer.destroy(); burrow.destroy(); gpu.destroy();
});
