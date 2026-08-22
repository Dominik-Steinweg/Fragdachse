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
import { LeafBlowerRenderer } from '../src/effects/LeafBlowerRenderer';
import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

describe('leaf blower gpu particles', () => {
  beforeEach(() => {
    resetGpuVfxAtlasForTests();
    vi.spyOn(Math, 'random').mockReturnValue(0);
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
    expect(lane.members.every((member) => member.tint === 0x283c50)).toBe(true);
    expect(lane.members.every((member) => member.x.duration >= 360)).toBe(true);
    expect(lane.members.every((member) => member.x.duration <= 860)).toBe(true);
    expect(lane.members.every((member) => member.x.amplitude < 0)).toBe(true);
    expect(lane.members.every((member) => member.rotation.ease === 'Linear')).toBe(true);
    expect(lane.members.every((member) => Math.abs(member.scaleX.base - 82 / 102) < 1e-10)).toBe(true);
    expect(lane.members.every((member) => Math.abs(member.alpha.base - 0.96) < 1e-10)).toBe(true);
  });

  it('samples at spawn and never changes a leaf tint afterwards', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new LeafBlowerRenderer(scene as never);
    renderer.registerGpuVfx(system);
    const sample = vi.fn(() => 0x123456);
    renderer.setTerrainColorSnapshot({ sample } as unknown as TerrainColorSnapshot);
    renderer.createVisual(7, 200, 220, 24);
    renderer.updateVisual(7, 200, 220, 24, 80, 0);

    system.update(40);
    const lane = findFakeLane(scene, 'world-debris');
    const firstTint = lane.members[0].tint;
    expect(sample).toHaveBeenCalledTimes(5);
    expect(firstTint).toBe(0x123456);

    renderer.updateVisual(7, 800, 900, 64, 0, 80);
    system.update(40);
    expect(sample).toHaveBeenCalledTimes(10);
    expect(lane.members[0].tint).toBe(firstTint);
    expect(lane.members.slice(5).every((member) => member.tint === firstTint)).toBe(true);
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
    expect(spec.effect).toBe(GpuVfxEffectId.LeafDebris);
    expect(findFakeLane(scene, 'world-debris').blendMode).toBe(0);
  });
});
