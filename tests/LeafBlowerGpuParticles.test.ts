import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Linear: (start: number, end: number, amount: number) => start + (end - start) * amount,
    FloatBetween: (min: number, max: number) => min + (max - min) * Math.random(),
  },
}));

vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: { critical: 1, standard: 1, decorative: 1 } }),
    subscribe: () => () => {},
  }),
}));

import type { TerrainColorSnapshot } from '../src/arena/TerrainColorSnapshot';
import { LEAF_BLOWER_FX } from '../src/config/leafBlowerEffects';
import { createLeafBlowerMaterialSampler } from '../src/effects/LeafBlowerMaterial';
import { LEAF_BROWN_COLORS, LEAF_GREEN_COLORS, LeafBlowerRenderer } from '../src/effects/LeafBlowerRenderer';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import type { ArenaLayout } from '../src/types';
import { evaluateFakeAnimation, findFakeLane, makeFakeGpuVfxScene, type FakeGpuMemberSnapshot } from './fakeGpuVfxScene';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';

type MaterialLayout = Pick<ArenaLayout, 'dirt' | 'tracks' | 'water'>;

function seedRandom(seed: number): void {
  let state = seed >>> 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

function block(fromX: number, fromY: number, size: number): { gridX: number; gridY: number }[] {
  const cells: { gridX: number; gridY: number }[] = [];
  for (let x = fromX; x < fromX + size; x += 1) for (let y = fromY; y < fromY + size; y += 1) cells.push({ gridX: x, gridY: y });
  return cells;
}

function cellCenter(gridX: number, gridY: number): { x: number; y: number } {
  return { x: ARENA_OFFSET_X + (gridX + 0.5) * CELL_SIZE, y: ARENA_OFFSET_Y + (gridY + 0.5) * CELL_SIZE };
}

function setup(layout: MaterialLayout | null = null, sample: (x: number, y: number) => number = () => 0x6f7a50) {
  const scene = makeFakeGpuVfxScene();
  const system = new GpuVfxSystem(scene as never);
  const renderer = new LeafBlowerRenderer(scene as never);
  renderer.generateTextures();
  renderer.registerGpuVfx(system);
  renderer.setTerrainColorSnapshot({ sample } as unknown as TerrainColorSnapshot);
  renderer.setTerrainMaterialLayout(layout);
  return { scene, system, renderer };
}

/** Fliegt ein Projektil in `steps` Ticks geradlinig von `from` nach `to`. */
function fly(
  context: ReturnType<typeof setup>,
  id: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
  steps = 10,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const velocityScale = 1000 / (16 * steps);
  context.renderer.createVisual(id, from.x, from.y, size);
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    context.renderer.updateVisual(id, from.x + dx * t, from.y + dy * t, size, dx * velocityScale, dy * velocityScale);
    context.system.update(16);
  }
}

const isLeaf = (member: FakeGpuMemberSnapshot) => member.frame?.startsWith('leaf-blower-leaf-') ?? false;
const isGroundDebris = (member: FakeGpuMemberSnapshot) => isLeaf(member)
  || ['leaf-blower-grass-blade', 'leaf-blower-twig', 'leaf-blower-grain', 'leaf-blower-clod'].includes(member.frame ?? '');
const spawnX = (member: FakeGpuMemberSnapshot) => evaluateFakeAnimation(member.x, 0);

describe('leaf blower gpu stream', () => {
  beforeEach(() => {
    resetGpuVfxAtlasForTests();
    seedRandom(17);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spreads debris over the travelled path instead of bursting around the projectile', () => {
    const context = setup();
    const start = cellCenter(4, 4);
    context.renderer.createVisual(1, start.x, start.y, 20);
    context.renderer.updateVisual(1, start.x, start.y, 20, 400, 0);
    context.system.update(16);
    const lane = findFakeLane(context.scene, 'world-debris');
    expect(lane.members).toHaveLength(0);

    context.renderer.updateVisual(1, start.x + 120, start.y, 20, 400, 0);
    context.system.update(16);

    const leaves = lane.members.filter(isLeaf);
    expect(context.scene.emitters).toHaveLength(0);
    expect(leaves.length).toBeGreaterThan(10);
    const xs = leaves.map(spawnX);
    expect(Math.min(...xs)).toBeLessThan(start.x + 30);
    expect(Math.max(...xs)).toBeGreaterThan(start.x + 90);
    // Mitgerissen: das Laub bewegt sich in Strömungsrichtung weiter.
    expect(leaves.every((member) => evaluateFakeAnimation(member.x, 0.99) > spawnX(member))).toBe(true);
  });

  it('keeps leaves small while the dust veil widens with the growing area', () => {
    const measure = (size: number) => {
      seedRandom(5);
      const context = setup();
      fly(context, 1, cellCenter(4, 4), cellCenter(10, 4), size);
      const members = findFakeLane(context.scene, 'world-debris').members;
      const leafScales = members.filter(isLeaf).map((member) => evaluateFakeAnimation(member.scaleY, 0));
      const dust = members.filter((member) => member.frame === 'leaf-blower-dust')
        .map((member) => evaluateFakeAnimation(member.scaleY, 0));
      return { leafMax: Math.max(...leafScales), dustMean: dust.reduce((sum, value) => sum + value, 0) / dust.length };
    };
    const narrow = measure(12);
    const wide = measure(64);
    expect(narrow.leafMax).toBeLessThanOrEqual(LEAF_BLOWER_FX.leaf.scaleMax);
    expect(wide.leafMax).toBeLessThanOrEqual(LEAF_BLOWER_FX.leaf.scaleMax);
    expect(wide.dustMean).toBeGreaterThan(narrow.dustMean * 2);
  });

  it('lifts mostly green leaves from grass and mostly brown leaves from dirt', () => {
    const layout: MaterialLayout = { dirt: block(20, 0, 12), tracks: [] };
    const count = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const context = setup(layout);
      fly(context, 1, from, to, 24);
      const leaves = findFakeLane(context.scene, 'world-debris').members.filter(isLeaf);
      const brown = new Set(LEAF_BROWN_COLORS);
      const green = new Set(LEAF_GREEN_COLORS);
      return {
        brown: leaves.filter((member) => brown.has(member.tint)).length,
        green: leaves.filter((member) => green.has(member.tint)).length,
      };
    };
    const grass = count(cellCenter(2, 6), cellCenter(8, 6));
    const dirt = count(cellCenter(22, 6), cellCenter(28, 6));
    expect(grass.green).toBeGreaterThan(grass.brown);
    expect(dirt.brown).toBeGreaterThan(dirt.green);
  });

  it('blows no new leaves or dirt from water but leaves spray and ripples there', () => {
    const layout: MaterialLayout = { dirt: [], tracks: [], water: block(0, 0, 12) };
    const overWater = setup(layout);
    fly(overWater, 1, cellCenter(3, 5), cellCenter(8, 5), 24);
    const debris = findFakeLane(overWater.scene, 'world-debris').members;
    expect(debris.filter(isGroundDebris)).toHaveLength(0);
    expect(debris.some((member) => member.frame === 'leaf-blower-droplet')).toBe(true);
    expect(findFakeLane(overWater.scene, 'movement-ground').members).toHaveLength(0);
    expect(findFakeLane(overWater.scene, 'water-surface').members.length).toBeGreaterThan(0);

    const overGrass = setup(layout);
    fly(overGrass, 1, cellCenter(20, 5), cellCenter(26, 5), 24);
    const grassDebris = findFakeLane(overGrass.scene, 'world-debris').members;
    expect(grassDebris.some(isLeaf)).toBe(true);
    expect(grassDebris.some((member) => member.frame === 'leaf-blower-droplet')).toBe(false);
    expect(findFakeLane(overGrass.scene, 'water-surface').members).toHaveLength(0);
  });

  it('colors dust from the terrain under each spawn point', () => {
    const start = cellCenter(4, 4);
    const split = start.x + 60;
    const context = setup(null, (x) => (x < split ? 0x404040 : 0xa08060));
    fly(context, 1, start, { x: start.x + 120, y: start.y }, 20);
    const dust = findFakeLane(context.scene, 'world-debris').members.filter((member) => member.frame === 'leaf-blower-dust');
    const before = new Set(dust.filter((member) => spawnX(member) < split - 1).map((member) => member.tint));
    const after = new Set(dust.filter((member) => spawnX(member) > split + 1).map((member) => member.tint));
    expect(before.size).toBe(1);
    expect(after.size).toBe(1);
    expect([...before][0]).not.toBe([...after][0]);
  });

  it('lets the stream linger when the projectile ends', () => {
    const context = setup();
    fly(context, 3, cellCenter(4, 4), cellCenter(7, 4), 20);
    context.renderer.destroyVisual(3);
    expect(findFakeLane(context.scene, 'world-debris').patched).toEqual([]);
    expect(context.renderer.has(3)).toBe(false);
  });
});

describe('leaf blower material sampler', () => {
  it('follows the rounded water shoreline instead of the square cell', () => {
    const sampler = createLeafBlowerMaterialSampler({ dirt: [], tracks: [], water: [{ gridX: 5, gridY: 5 }] });
    const origin = { x: ARENA_OFFSET_X + 5 * CELL_SIZE, y: ARENA_OFFSET_Y + 5 * CELL_SIZE };
    expect(sampler.sample(origin.x + CELL_SIZE / 2, origin.y + CELL_SIZE / 2)).toBe('water');
    // Die Zellecke liegt außerhalb der abgerundeten Uferkontur und bleibt Ufer.
    expect(sampler.sample(origin.x + 0.5, origin.y + 0.5)).toBe('grass');
    expect(sampler.sample(origin.x + CELL_SIZE * 2, origin.y)).toBe('grass');
  });
});
