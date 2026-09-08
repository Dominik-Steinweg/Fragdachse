import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
  },
}));

const qualityFactors = { critical: 1, standard: 1, decorative: 1 };
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: qualityFactors }),
    subscribe: () => () => {},
  }),
}));

import type { GroundFireVisualStyle, SyncedBurningGroundCell } from '../src/types';
import { GroundFireClusterRenderer } from '../src/effects/GroundFireClusterRenderer';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GPU_VFX_LANES, GpuVfxLaneId } from '../src/effects/gpu/GpuVfxRenderLanes';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function cells(width: number, height: number, style: GroundFireVisualStyle = 'normal'): SyncedBurningGroundCell[] {
  const result: SyncedBurningGroundCell[] = [];
  for (let gridY = 0; gridY < height; gridY += 1) {
    for (let gridX = 0; gridX < width; gridX += 1) {
      result.push({
        id: gridY * width + gridX + 1,
        gridX,
        gridY,
        expiresAt: 100_000,
        intensity: 1,
        visualStyle: style,
      });
    }
  }
  return result;
}

function setup() {
  const scene = makeFakeGpuVfxScene();
  const system = new GpuVfxSystem(scene as never);
  const renderer = new GroundFireClusterRenderer();
  renderer.registerGpuVfx(system);
  return { scene, system, renderer, lane: findFakeLane(scene, 'ground-fire') };
}

beforeEach(() => {
  resetGpuVfxAtlasForTests();
  qualityFactors.standard = 1;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GroundFire GPU particles', () => {
  it('starts a new surface at steady density with staggered particle ages', () => {
    const { system, renderer, lane } = setup();
    renderer.syncGround({ cells: cells(12, 8) }, 0);
    system.update(16);
    const initial = system.getLaneStats(GpuVfxLaneId.GroundFire)!.liveCount;
    const aged = lane.members.filter(member => member.creationTime < 0);
    expect(aged.length).toBeGreaterThan(initial * 0.8);
    expect(new Set(aged.map(member => member.creationTime)).size).toBeGreaterThan(10);
    for (let frame = 0; frame < 240; frame++) system.update(16);
    const steady = system.getLaneStats(GpuVfxLaneId.GroundFire)!.liveCount;
    expect(initial).toBeGreaterThan(steady * 0.8);
    expect(initial).toBeLessThan(steady * 1.2);
    expect(system.getLaneStats(GpuVfxLaneId.GroundFire)!.capacityDrops).toBe(0);
  });

  it('populates only new trail cells and never reheats refreshed or split surfaces', () => {
    const { system, renderer } = setup();
    const positions: number[] = [];
    const originalSpawn = system.spawn.bind(system);
    const spawn = vi.spyOn(system, 'spawn').mockImplementation((spec, source, now, age, out) => {
      if ((age ?? 0) > 0) positions.push(spec.x);
      return originalSpawn(spec, source, now, age, out);
    });
    const initial = cells(8, 4);
    renderer.syncGround({ cells: initial }, 0);
    system.update(16);
    spawn.mockClear();
    positions.length = 0;
    const trail = cells(4, 1).map(cell => ({ ...cell, id: cell.id + 100, gridX: cell.gridX + 8 }));
    renderer.syncGround({ cells: [...initial, ...trail] }, 16);
    system.update(0);
    const warmed = spawn.mock.calls.filter(call => (call[3] ?? 0) > 0);
    expect(warmed.length).toBeGreaterThan(0);
    expect(positions.every(x => x >= 8 * 16 - 16 && x <= 12 * 16 + 16)).toBe(true);
    spawn.mockClear();
    renderer.syncGround({ cells: [...initial, ...trail].map(cell => ({ ...cell, expiresAt: 110_000 })) }, 17);
    system.update(0);
    expect(spawn).not.toHaveBeenCalled();
    renderer.syncGround({ cells: [...initial, ...trail.slice(1)] }, 18);
    system.update(0);
    expect(spawn.mock.calls.filter(call => (call[3] ?? 0) > 0)).toHaveLength(0);
  });

  it('keeps trail ground at full base alpha beside stronger overlapping fire', () => {
    function capture(overlap: number) {
      const { renderer, system } = setup();
      const emitted: Array<{ x: number; alpha: number; frame: number }> = [];
      const spawn = system.spawn.bind(system);
      vi.spyOn(system, 'spawn').mockImplementation((spec, source, now, age, out) => {
        if (spec.effect === GpuVfxEffectId.GroundFireHeatBody || spec.effect === GpuVfxEffectId.GroundFireOuter
          || spec.effect === GpuVfxEffectId.GroundFireCore) {
          emitted.push({ x: spec.x, alpha: spec.alphaStart, frame: spec.frame });
        }
        return spawn(spec, source, now, age, out);
      });
      renderer.syncGround({ cells: cells(12, 1).map(cell => ({ ...cell, intensity: cell.gridX === 0 ? overlap : 1 })) }, 0);
      system.update(0);
      return emitted.filter(member => member.x > 48);
    }
    const ordinary = capture(1);
    resetGpuVfxAtlasForTests();
    const overlapping = capture(8);
    expect(overlapping.length).toBe(ordinary.length);
    expect(ordinary.length).toBeGreaterThan(0);
    expect(overlapping.map(member => member.alpha)).toEqual(ordinary.map(member => member.alpha));
  });

  it('scales the initial population with quality and clears queued ignition on teardown', () => {
    const full = setup(); full.renderer.syncGround({ cells: cells(12, 8) }, 0); full.system.update(0);
    const fullCount = full.system.getLaneStats(GpuVfxLaneId.GroundFire)!.liveCount;
    resetGpuVfxAtlasForTests(); qualityFactors.standard = 0.5;
    const reduced = setup(); reduced.renderer.syncGround({ cells: cells(12, 8) }, 0); reduced.system.update(0);
    expect(reduced.system.getLaneStats(GpuVfxLaneId.GroundFire)!.liveCount).toBeLessThan(fullCount);
    reduced.renderer.syncGround({ cells: cells(16, 8) }, 1);
    reduced.renderer.clear(); reduced.system.update(0);
    expect(reduced.system.getLaneStats(GpuVfxLaneId.GroundFire)!.liveCount).toBe(0);
  });

  it('preserves distant trail emission when its connection to a large fire expires', () => {
    function capture(disconnect: boolean) {
      const { renderer, system } = setup();
      const area = cells(16, 16).map(cell => ({ ...cell, intensity: 2 }));
      const trail = cells(32, 1).map(cell => ({ ...cell, id: cell.id + 1000, gridX: cell.gridX + 16 }));
      const emitted: object[] = [];
      const spawn = system.spawn.bind(system);
      vi.spyOn(system, 'spawn').mockImplementation((spec, source, now, age, out) => {
        if (spec.x > 33 * 16) emitted.push({ ...spec, now, age });
        return spawn(spec, source, now, age, out);
      });
      renderer.syncGround({ cells: [...area, ...trail] }, 0);
      for (let frame = 0; frame < 60; frame++) system.update(16);
      emitted.length = 0;
      renderer.syncGround({ cells: [...area, ...(disconnect ? trail.slice(1) : trail)] }, 960);
      for (let frame = 0; frame < 120; frame++) system.update(16);
      return emitted;
    }
    const connected = capture(false);
    resetGpuVfxAtlasForTests();
    const disconnected = capture(true);
    expect(connected.length).toBeGreaterThan(0);
    expect(disconnected).toEqual(connected);
  });

  it('keeps large surfaces inside the existing shared lane budget', () => {
    const { renderer, system } = setup();
    renderer.syncGround({ cells: cells(48, 40) }, 0);
    for (let frame = 0; frame < 240; frame++) system.update(16);
    const stats = system.getLaneStats(GpuVfxLaneId.GroundFire)!;
    expect(stats.liveCount).toBeGreaterThan(0);
    expect(stats.peakLive).toBeLessThan(GPU_VFX_LANES[GpuVfxLaneId.GroundFire].capacity);
    expect(stats.capacityDrops).toBe(0);
  });

  it('emits a dense ambient spark rain plus rarer large outliers across the area', () => {
    const { system, renderer, lane } = setup();
    renderer.syncGround({ cells: cells(12, 8) }, 0);

    for (let frame = 0; frame < 240; frame += 1) system.update(16);

    const sparks = lane.members.filter(member => member.frame === 'flame-spark');
    const ambient = sparks.filter(member => member.scaleX.base < 1.8);
    const accents = sparks.filter(member => member.scaleX.base >= 1.8);
    const coveredColumns = new Set(ambient.map(member => Math.floor(member.x.base / 16)));
    const coveredRows = new Set(ambient.map(member => Math.floor(member.y.base / 16)));

    expect(ambient.length).toBeGreaterThan(90);
    expect(accents.length).toBeGreaterThanOrEqual(6);
    expect(ambient.length).toBeGreaterThan(accents.length * 5);
    expect(coveredColumns.size).toBe(12);
    expect(coveredRows.size).toBe(8);
    expect(lane.size).toBe(6144);
  });

  it('mixes every organic surface and bed motif instead of repeating one circle', () => {
    const { system, renderer, lane } = setup();
    renderer.syncGround({ cells: cells(12, 8) }, 0);
    for (let frame = 0; frame < 240; frame += 1) system.update(16);

    const frames = new Set(lane.members.map(member => member.frame));
    const required = [
      'ground-fire-surface',
      'ground-fire-surface-b',
      'ground-fire-surface-c',
      'ground-fire-bed',
      'ground-fire-bed-b',
    ];
    expect(required.every(frame => frames.has(frame))).toBe(true);
  });

  it('turns an impact into four bright sparks and one stretched outlier', () => {
    const { renderer, lane } = setup();
    renderer.spawnImpact(160, 192, 'normal');

    const sparks = lane.members.filter(member => member.frame === 'flame-spark');
    expect(sparks).toHaveLength(5);
    expect(sparks.filter(member => member.scaleX.base >= 1.8)).toHaveLength(1);
    expect(sparks.every(member => member.alpha.base >= 0.78)).toBe(true);
  });

  it('keeps normal and void sparks in their own hot palettes', () => {
    const normal = setup();
    normal.renderer.spawnImpact(80, 96, 'normal');
    const normalSpark = normal.lane.members.find(member => member.frame === 'flame-spark')!;

    resetGpuVfxAtlasForTests();
    const voidFire = setup();
    voidFire.renderer.spawnImpact(80, 96, 'void');
    const voidSpark = voidFire.lane.members.find(member => member.frame === 'flame-spark')!;

    expect(normalSpark.tint & 0xff).toBeLessThan(0xb0);
    expect(voidSpark.tint & 0xff).toBeGreaterThanOrEqual(0xff);
  });

  it('clears every living GroundFire member without destroying the shared lane', () => {
    const { scene, system, renderer, lane } = setup();
    renderer.syncGround({ cells: cells(6, 4) }, 0);
    for (let frame = 0; frame < 80; frame += 1) system.update(16);
    const spawned = lane.edited.length;
    expect(spawned).toBeGreaterThan(0);

    renderer.clear();

    expect(lane.patched.length).toBe(spawned);
    expect(scene.layers).toHaveLength(GPU_VFX_LANES.length);
  });
});
