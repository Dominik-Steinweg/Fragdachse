import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class FakeCircle {
    x: number;
    y: number;
    radius: number;

    constructor(x = 0, y = 0, radius = 0) {
      this.x = x;
      this.y = y;
      this.radius = radius;
    }

    setTo(x: number, y: number, radius: number): this {
      this.x = x;
      this.y = y;
      this.radius = radius;
      return this;
    }

    static Random(circle: FakeCircle, point: { x: number; y: number }): { x: number; y: number } {
      point.x = circle.x + circle.radius * 0.25;
      point.y = circle.y - circle.radius * 0.25;
      return point;
    }
  }

  class FakeVector2 {
    x: number;
    y: number;

    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
  }

  return {
    BlendModes: { NORMAL: 0, ADD: 1 },
    Geom: { Circle: FakeCircle },
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
      Linear: (start: number, end: number, amount: number) => start + (end - start) * amount,
      FloatBetween: (min: number, max: number) => min + (max - min) * 0.25,
      Vector2: FakeVector2,
    },
  };
});

vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: { critical: 1, standard: 1, decorative: 1 } }),
    subscribe: () => () => {},
  }),
}));

import { TerrainColorSnapshot } from '../src/arena/TerrainColorSnapshot';
import {
  compensateLeafTint,
  LEAF_BROWN_COLORS,
  LEAF_GREEN_COLORS,
  LeafBlowerRenderer,
} from '../src/effects/LeafBlowerRenderer';
import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';

describe('leaf blower gpu particles', () => {
  beforeEach(() => {
    resetGpuVfxAtlasForTests();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits the expected moving leaf members without a classical emitter', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new LeafBlowerRenderer(scene as never);
    renderer.generateTextures();
    renderer.registerGpuVfx(system);
    const terrainData = new Uint8Array(100 * 100 * 3);
    for (let index = 0; index < terrainData.length; index += 3) {
      terrainData[index] = 40;
      terrainData[index + 1] = 60;
      terrainData[index + 2] = 80;
    }
    renderer.setTerrainColorSnapshot(new TerrainColorSnapshot(100, 100, 0, 0, terrainData));
    renderer.createVisual(1, 100, 100, 20);
    renderer.updateVisual(1, 100, 100, 20, 100, 0);

    system.update(40);

    const lane = findFakeLane(scene, 'world-debris');
    expect(scene.emitters).toHaveLength(0);
    expect(lane.edited).toHaveLength(5);
    expect(lane.members.every((member) => member.frame === 'leaf-debris')).toBe(true);
    expect(lane.members.every((member) => member.tint === compensateLeafTint(LEAF_GREEN_COLORS[2]))).toBe(true);
    expect(lane.members.every((member) => member.x.duration >= 360)).toBe(true);
    expect(lane.members.every((member) => member.x.duration <= 860)).toBe(true);
    expect(lane.members.every((member) => member.x.amplitude < 0)).toBe(true);
    expect(lane.members.every((member) => member.rotation.ease === 'None')).toBe(true);
    expect(lane.members.every((member) => member.rotation.amplitude === 0)).toBe(true);
    expect(lane.members.every((member) => member.rotation.base >= 0 && member.rotation.base <= Math.PI * 2)).toBe(true);
    expect(lane.members.every((member) => Math.abs(member.scaleX.base - 82 / 102) < 1e-10)).toBe(true);
    expect(lane.members.every((member) => Math.abs(member.alpha.base - 0.96) < 1e-10)).toBe(true);
  });

  it('samples terrain for dust at spawn and holds every dust tint', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new LeafBlowerRenderer(scene as never);
    renderer.registerGpuVfx(system);
    const sample = vi.fn()
      .mockReturnValueOnce(0x707070)
      .mockReturnValue(0x8a6b4f);
    renderer.setTerrainColorSnapshot({ sample } as unknown as TerrainColorSnapshot);
    renderer.createVisual(7, 200, 220, 24);
    renderer.updateVisual(7, 200, 220, 24, 80, 0);

    system.update(40);
    const lane = findFakeLane(scene, 'world-debris');
    const firstLeafTint = lane.members[0].tint;
    expect(sample).not.toHaveBeenCalled();
    expect(lane.members.every((member) => member.frame === 'leaf-debris')).toBe(true);

    renderer.updateVisual(7, 800, 900, 64, 0, 80);
    system.update(40);
    const firstDust = lane.members.find((member) => member.frame === 'leaf-blower-dust');
    expect(firstDust?.tint).toBe(0x707070);
    expect(sample).toHaveBeenCalledTimes(1);
    expect(sample).toHaveBeenNthCalledWith(1, 800, 900);
    expect(lane.members.filter((member) => member.frame === 'leaf-debris').every((member) => member.tint === firstLeafTint)).toBe(true);

    system.update(80);
    expect(sample).toHaveBeenCalledTimes(2);
    const dustMembers = lane.members.filter((member) => member.frame === 'leaf-blower-dust');
    expect(dustMembers).toHaveLength(2);
    expect(dustMembers[0].tint).toBe(0x707070);
    expect(dustMembers[1].tint).toBe(0x8a6b4f);
    expect(sample).toHaveBeenNthCalledWith(2, 800, 900);
  });

  it('uses mostly green leaves on grass and a brown-heavy mix on dirt', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new LeafBlowerRenderer(scene as never);
    renderer.registerGpuVfx(system);
    renderer.setTerrainColorSnapshot({ sample: () => 0x888888 } as unknown as TerrainColorSnapshot);
    renderer.setTerrainMaterialLayout({
      dirt: [{ gridX: 1, gridY: 0 }],
      tracks: [],
    });
    renderer.createVisual(1, ARENA_OFFSET_X + CELL_SIZE / 2, ARENA_OFFSET_Y + CELL_SIZE / 2, 20);
    renderer.createVisual(2, ARENA_OFFSET_X + CELL_SIZE * 1.5, ARENA_OFFSET_Y + CELL_SIZE / 2, 20);
    renderer.updateVisual(1, ARENA_OFFSET_X + CELL_SIZE / 2, ARENA_OFFSET_Y + CELL_SIZE / 2, 20, 100, 0);
    renderer.updateVisual(2, ARENA_OFFSET_X + CELL_SIZE * 1.5, ARENA_OFFSET_Y + CELL_SIZE / 2, 20, 100, 0);

    system.update(40);

    const lane = findFakeLane(scene, 'world-debris');
    expect(lane.members.slice(0, 5).every((member) => member.tint === compensateLeafTint(LEAF_GREEN_COLORS[2]))).toBe(true);
    expect(lane.members.slice(5, 10).every((member) => member.tint === compensateLeafTint(LEAF_BROWN_COLORS[2]))).toBe(true);
  });

  it('adds brown leaves after 32px of grass-to-dirt travel and keeps the tint fixed', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new LeafBlowerRenderer(scene as never);
    renderer.registerGpuVfx(system);
    renderer.setTerrainColorSnapshot({ sample: () => 0x888888 } as unknown as TerrainColorSnapshot);
    renderer.setTerrainMaterialLayout({
      dirt: [{ gridX: 1, gridY: 0 }],
      tracks: [],
    });
    renderer.createVisual(1, ARENA_OFFSET_X + CELL_SIZE / 2, ARENA_OFFSET_Y + CELL_SIZE / 2, 20);
    renderer.updateVisual(1, ARENA_OFFSET_X + CELL_SIZE / 2, ARENA_OFFSET_Y + CELL_SIZE / 2, 20, 100, 0);
    system.update(40);
    const lane = findFakeLane(scene, 'world-debris');
    const grassTint = lane.members[0].tint;

    renderer.updateVisual(1, ARENA_OFFSET_X + CELL_SIZE * 1.5, ARENA_OFFSET_Y + CELL_SIZE / 2, 20, 100, 0);
    system.update(40);

    expect(lane.members.slice(0, 5).every((member) => member.tint === grassTint)).toBe(true);
    expect(lane.members.slice(5, 10).every((member) => member.tint === compensateLeafTint(LEAF_BROWN_COLORS[2]))).toBe(true);
  });

  it('does not change the leaf mix when dirt travel reaches a track, while the track dust is gray', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new LeafBlowerRenderer(scene as never);
    renderer.registerGpuVfx(system);
    renderer.setTerrainColorSnapshot({ sample: () => 0x707070 } as unknown as TerrainColorSnapshot);
    renderer.setTerrainMaterialLayout({
      dirt: [{ gridX: 0, gridY: 0 }],
      tracks: [{ gridX: 1, gridY: 0 }],
    });
    renderer.createVisual(1, ARENA_OFFSET_X + CELL_SIZE / 2, ARENA_OFFSET_Y + CELL_SIZE / 2, 20);
    renderer.updateVisual(1, ARENA_OFFSET_X + CELL_SIZE / 2, ARENA_OFFSET_Y + CELL_SIZE / 2, 20, 100, 0);
    system.update(40);
    renderer.updateVisual(1, ARENA_OFFSET_X + CELL_SIZE * 1.5, ARENA_OFFSET_Y + CELL_SIZE / 2, 20, 100, 0);
    system.update(40);

    const lane = findFakeLane(scene, 'world-debris');
    const leaves = lane.members.filter((member) => member.frame === 'leaf-debris');
    const dust = lane.members.find((member) => member.frame === 'leaf-blower-dust');
    expect(leaves.slice(0, 5).every((member) => member.tint === compensateLeafTint(LEAF_BROWN_COLORS[2]))).toBe(true);
    expect(leaves.slice(5, 10).every((member) => member.tint === compensateLeafTint(LEAF_BROWN_COLORS[2]))).toBe(true);
    expect(dust?.tint).toBe(0x707070);
  });

  it('compensates both natural palettes for the legacy multiply-tinted leaf texture', () => {
    for (const color of [...LEAF_GREEN_COLORS, ...LEAF_BROWN_COLORS]) {
      const tint = compensateLeafTint(color);
      const visible = (
        (Math.round(((0x8a * ((tint >> 16) & 0xff)) / 0xff)) << 16)
        | (Math.round(((0xa3 * ((tint >> 8) & 0xff)) / 0xff)) << 8)
        | Math.round((0x57 * (tint & 0xff)) / 0xff)
      );
      expect(Math.abs(((visible >> 16) & 0xff) - ((color >> 16) & 0xff))).toBeLessThanOrEqual(1);
      expect(Math.abs(((visible >> 8) & 0xff) - ((color >> 8) & 0xff))).toBeLessThanOrEqual(1);
      expect(Math.abs((visible & 0xff) - (color & 0xff))).toBeLessThanOrEqual(1);
    }
  });

  it('lets leaf members linger when their source is destroyed', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new LeafBlowerRenderer(scene as never);
    renderer.registerGpuVfx(system);
    renderer.setTerrainColorSnapshot({ sample: () => 0x123456 } as unknown as TerrainColorSnapshot);
    renderer.createVisual(3, 100, 100, 20);
    renderer.updateVisual(3, 100, 100, 20, 100, 0);
    system.update(40);

    renderer.destroyVisual(3);

    const lane = findFakeLane(scene, 'world-debris');
    expect(lane.patched).toEqual([]);
  });

  it('registers the leaf effect with the shared GPU manifest', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new LeafBlowerRenderer(scene as never);
    renderer.registerGpuVfx(system);

    const spec = system.createSpec(GpuVfxEffectId.LeafDebris);
    const dustSpec = system.createSpec(GpuVfxEffectId.LeafBlowerDust);
    expect(spec.effect).toBe(GpuVfxEffectId.LeafDebris);
    expect(dustSpec.effect).toBe(GpuVfxEffectId.LeafBlowerDust);
    expect(findFakeLane(scene, 'world-debris').blendMode).toBe(0);
  });
});
