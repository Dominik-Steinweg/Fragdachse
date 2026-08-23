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
import {
  GROUND_FIRE_DENSITY_BUDGET_PER_CELL,
  GROUND_FIRE_MAX_EFFECTIVE_CELLS,
  GroundFireClusterRenderer,
} from '../src/effects/GroundFireClusterRenderer';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
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
  it('keeps the extreme spark budget inside the existing shared lane', () => {
    const required = GROUND_FIRE_DENSITY_BUDGET_PER_CELL
      * GROUND_FIRE_MAX_EFFECTIVE_CELLS
      * 5;
    expect(required).toBeCloseTo(5704, 5);
    expect(required).toBeLessThan(GPU_VFX_LANES[GpuVfxLaneId.GroundFire].capacity);
    expect(GPU_VFX_LANES[GpuVfxLaneId.GroundFire].capacity).toBe(6144);
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
