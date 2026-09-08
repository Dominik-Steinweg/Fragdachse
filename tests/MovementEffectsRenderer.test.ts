import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 }, Math: {
  Clamp: (n: number, a: number, b: number) => Math.max(a, Math.min(b, n)),
  Linear: (a: number, b: number, t: number) => a + (b - a) * t,
} }));
const quality = vi.hoisted(() => ({ decorative: 1, standard: 1, critical: 1, changed: () => {} }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityController: () => ({
  getProfile: () => ({ particleFactors: quality }),
  subscribe: (fn: () => void) => { quality.changed = fn; return () => {}; },
}) }));

import { MovementEffectsRenderer } from '../src/effects/MovementEffectsRenderer';
import { createMovementVisualSample, type MovementVisualSample } from '../src/effects/MovementStepSampler';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { MOVEMENT_FX } from '../src/config/movementEffects';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';
import { TerrainColorSnapshot } from '../src/arena/TerrainColorSnapshot';

beforeEach(() => { resetGpuVfxAtlasForTests(); quality.decorative = quality.standard = 1; });
afterEach(() => vi.restoreAllMocks());

function setup() {
  const scene = makeFakeGpuVfxScene();
  const gpu = new GpuVfxSystem(scene as never);
  const burrow = { playDashTrail: vi.fn() };
  const renderer = new MovementEffectsRenderer(gpu, burrow);
  const world = {};
  renderer.openWorld(world);
  const sample: MovementVisualSample = { ...createMovementVisualSample(), id: 'p', visible: true, mode: 'walk', player: true };
  const source = { readMovementVisualSample: (out: MovementVisualSample) => Object.assign(out, sample) };
  const view = { x: -100, y: -100, width: 10000, height: 1000 };
  const frame = (dx = 0, delta = 16) => {
    sample.x += dx;
    renderer.captureFrame(delta, true, [source], [], view); gpu.update(delta);
  };
  return { scene, gpu, renderer, burrow, world, sample, source, view, frame, lane: findFakeLane(scene, 'movement-ground') };
}

describe('movement GPU presentation', () => {
  it('adds dirt only along a marked player dash and preserves the sampled direction and age', () => {
    const h = setup();
    h.sample.mode = 'dash'; h.frame(); h.frame(36);
    expect(h.burrow.playDashTrail).not.toHaveBeenCalled();
    h.sample.isBurrowDash = true; h.frame(36);
    expect(h.burrow.playDashTrail).toHaveBeenCalled();
    for (const [x, y, heading, size, age] of h.burrow.playDashTrail.mock.calls) {
      expect(x).toBeGreaterThan(36); expect(x).toBeLessThanOrEqual(72);
      expect(y).toBe(0); expect(heading).toBeCloseTo(0);
      expect(size).toBe(h.sample.size); expect(age).toBeGreaterThanOrEqual(0); expect(age).toBeLessThanOrEqual(16);
    }
    h.burrow.playDashTrail.mockClear();
    h.sample.mode = 'recovery'; h.frame(8);
    expect(h.burrow.playDashTrail).not.toHaveBeenCalled();
    h.sample.mode = 'dash'; h.sample.player = false; h.frame(36);
    expect(h.burrow.playDashTrail).not.toHaveBeenCalled();
    h.renderer.destroy(); h.gpu.destroy();
  });

  it('does not connect a Burrow dirt trail across hiding or a world reset', () => {
    const h = setup(); h.sample.isBurrowDash = true; h.sample.mode = 'dash';
    h.frame(); h.frame(24); expect(h.burrow.playDashTrail).toHaveBeenCalled();
    h.burrow.playDashTrail.mockClear();
    h.sample.visible = false; h.frame(48);
    h.sample.visible = true; h.frame(48);
    expect(h.burrow.playDashTrail).not.toHaveBeenCalled();
    h.renderer.closeWorld(h.world); h.frame(48);
    h.renderer.openWorld({}); h.frame(48);
    expect(h.burrow.playDashTrail).not.toHaveBeenCalled();
    h.frame(24); expect(h.burrow.playDashTrail).toHaveBeenCalled();
    h.renderer.destroy(); h.gpu.destroy();
  });

  it('points footprints at the look direction while dust follows the opposite travel direction', () => {
    const h = setup(); h.sample.facing = Math.PI; h.frame();
    for (let i = 0; i < 20; i++) h.frame(4);
    const prints = h.lane.members.filter(m => m.frame === 'movement-paw-compact');
    const dust = h.lane.members.filter(m => m.frame !== 'movement-paw-compact');
    expect(prints.length).toBeGreaterThan(0); expect(dust.length).toBeGreaterThan(0);
    expect(prints.every(m => Math.cos(m.rotation.base - Math.PI / 2) < -0.9)).toBe(true);
    expect(dust.every(m => m.x.amplitude < 0)).toBe(true);
  });
  it('reduces continuous dash dust with standard quality without accumulating catch-up particles', () => {
    const emitted = (factor: number) => {
      const h = setup();
      quality.standard = factor; quality.changed();
      h.sample.mode = 'dash'; h.frame(); // No discrete start burst for a first dash snapshot.
      for (let i = 0; i < 16; i++) h.frame(12);
      const count = h.lane.members.length;
      h.renderer.destroy(); h.gpu.destroy();
      return count;
    };
    const full = emitted(1);
    const reduced = emitted(0.5);
    expect(reduced).toBeGreaterThan(0);
    expect(reduced).toBeLessThan(full);
    expect(emitted(0)).toBe(0);
  });
  it('thins complete gait cycles so reduced quality retains both left and right paws', () => {
    const h = setup();
    quality.decorative = 0.5; quality.changed();
    h.frame();
    for (let i = 0; i < 64; i++) h.frame(4);
    const prints = h.lane.members.filter(m => m.frame === 'movement-paw-compact');
    expect(prints.some(m => m.y.base < 0)).toBe(true);
    expect(prints.some(m => m.y.base > 0)).toBe(true);
  });
  it('emits persistent world-space paw motifs and shorter moving dust from an actor', () => {
    const h = setup();
    h.renderer.setTerrainColorSnapshot(new TerrainColorSnapshot(1, 1, 0, 0, new Uint8Array([120, 95, 70])));
    h.frame();
    for (let i = 0; i < 20; i++) h.frame(4);
    const prints = h.lane.members.filter(m => m.frame === 'movement-paw-compact');
    const dust = h.lane.members.filter(m => m.frame !== 'movement-paw-compact');
    expect(prints.length).toBeGreaterThan(0); expect(dust.length).toBeGreaterThan(0);
    expect(prints.every(m => m.x.amplitude === 0 && m.y.amplitude === 0)).toBe(true);
    expect(dust.some(m => m.x.amplitude !== 0 || m.y.amplitude !== 0)).toBe(true);
    expect(new Set(dust.map(m => m.frame)).size).toBeGreaterThan(1);
    expect(new Set(dust.map(m => m.alpha.duration)).size).toBeGreaterThan(1);
    expect(dust.some(m => m.scaleX.amplitude !== m.scaleY.amplitude)).toBe(true);
    expect(prints[0].alpha.duration).toBeGreaterThan(dust[0].alpha.duration);
    const added = h.lane.added;
    h.sample.visible = false; h.frame();
    expect(h.lane.visible).toBe(true); // ordinary hide leaves residuals alive
    h.gpu.update(MOVEMENT_FX.footprintLifeMaxMs + 1);
    expect(h.lane.visible).toBe(false);
    expect(h.lane.added).toBe(added);
  });

  it('skips offscreen actors, reappearance and late snapshots without catch-up', () => {
    const h = setup(); h.frame();
    h.sample.x = 20000; h.frame();
    h.sample.x = 100; h.frame();
    expect(h.lane.members).toHaveLength(0);
    h.frame(4); expect(h.lane.members).toHaveLength(0);
    h.renderer.interruptSource('p');
    for (let i = 0; i < 20; i++) h.frame(10);
    expect(h.lane.members).toHaveLength(0);
  });

  it('changes quality without changing gait and invalidates pending samples on GPU suppression', () => {
    const h = setup(); h.frame();
    quality.decorative = 0; quality.changed();
    for (let i = 0; i < 20; i++) h.frame(4);
    expect(h.lane.members).toHaveLength(0);
    h.sample.mode = 'dash'; h.frame(12);
    expect(h.lane.members.length).toBeGreaterThan(0);
    h.renderer.captureFrame(16, true, [h.source], [], h.view);
    h.gpu.setSuppressed(true); h.gpu.setSuppressed(false); h.gpu.update(16);
    expect(h.lane.visible).toBe(false);
    const count = h.lane.members.length;
    quality.decorative = 1; quality.changed();
    h.sample.mode = 'walk'; h.frame();
    expect(h.lane.members).toHaveLength(count);
    for (let i = 0; i < 10; i++) h.frame(4);
    expect(h.lane.members.length).toBeGreaterThan(count);
  });

  it('closes a world completely, ignores stale close calls and accepts a world without activity', () => {
    const h = setup(); h.frame(); for (let i = 0; i < 12; i++) h.frame(4);
    expect(h.lane.visible).toBe(true);
    h.renderer.closeWorld(h.world);
    expect(h.lane.visible).toBe(false);
    h.frame(40); expect(h.lane.visible).toBe(false);
    const nextWorld = {}; h.renderer.openWorld(nextWorld); h.renderer.closeWorld(h.world);
    h.frame(); for (let i = 0; i < 12; i++) h.frame(4);
    expect(h.lane.visible).toBe(true);
    h.renderer.destroy(); h.renderer.destroy(); h.frame(40);
    expect(h.lane.visible).toBe(false);
  });
});
