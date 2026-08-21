import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class FakeCircle {
    x: number;
    y: number;
    radius: number;

    constructor(x: number, y: number, radius: number) {
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
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * circle.radius;
      point.x = circle.x + Math.cos(angle) * radius;
      point.y = circle.y + Math.sin(angle) * radius;
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
      FloatBetween: (min: number, max: number) => min + Math.random() * (max - min),
      Vector2: FakeVector2,
    },
  };
});

const qualityFactors = { critical: 1, standard: 1, decorative: 1 };
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: qualityFactors }),
    subscribe: () => () => {},
  }),
}));

import { DEPTH, VOID_FIRE_COLOR } from '../src/config';
import { FlameRenderer } from '../src/effects/FlameRenderer';
import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { GpuVfxLaneId } from '../src/effects/gpu/GpuVfxRenderLanes';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function setup() {
  const scene = makeFakeGpuVfxScene();
  const registry = new GpuVfxSystem(scene as never);
  const renderer = new FlameRenderer(scene as never);
  renderer.generateTextures();
  renderer.registerGpuVfx(registry);
  return {
    scene,
    registry,
    renderer,
    core: findFakeLane(scene, 'flame-core'),
    outer: findFakeLane(scene, 'flame-outer'),
    spark: findFakeLane(scene, 'flame-spark'),
  };
}

beforeEach(() => {
  resetGpuVfxAtlasForTests();
  qualityFactors.standard = 1;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('flame renderer gpu particles', () => {
  it('uses shared GPU lanes and creates no classical emitter per hitbox', () => {
    const { scene, registry, renderer, core, outer, spark } = setup();

    for (let id = 1; id <= 5; id += 1) renderer.createVisual(id, 100, 100, 32, 0xff6600);
    registry.update(50);

    expect(scene.emitters).toHaveLength(0);
    expect(core.edited).toHaveLength(30);
    expect(outer.edited).toHaveLength(20);
    expect(spark.edited).toHaveLength(5);
    expect(scene.layers.filter((layer) => layer.name.startsWith('flame-'))).toHaveLength(3);
  });

  it('keeps independent flow countdowns for each FlameVisual', () => {
    const { registry, renderer, core } = setup();

    renderer.createVisual(1, 0, 0, 32, 0xff6600);
    registry.update(8);
    expect(core.edited).toHaveLength(0);

    renderer.createVisual(2, 0, 0, 32, 0xff6600);
    registry.update(8);
    // Nur die erste Hitbox erreicht ihren eigenen 16-ms-Countdown.
    expect(core.edited).toHaveLength(2);

    registry.update(8);
    expect(core.edited).toHaveLength(4);
  });

  it('preserves normal and Void frames, curves, additive depth and spark gravity', () => {
    const { registry, renderer, core, outer, spark } = setup();
    renderer.createVisual(1, 100, 120, 40, 0xff6600);
    registry.update(50);

    expect(core.depth).toBe(DEPTH.FIRE + 0.05);
    expect(core.blendMode).toBe(1);
    expect(outer.depth).toBe(DEPTH.FIRE);
    expect(outer.blendMode).toBe(1);
    expect(spark.depth).toBe(DEPTH.FIRE + 0.1);
    expect(spark.blendMode).toBe(1);
    expect(spark.gravity).toBe(-30);
    expect(core.members.slice(-6).every((member) => member.frame === 'flame-core')).toBe(true);
    expect(outer.members.slice(-4).every((member) => member.frame === 'flame-outer')).toBe(true);
    expect(spark.members.at(-1)?.frame).toBe('flame-spark');
    expect(core.members.at(-1)?.scaleX.base).toBeCloseTo(0.7, 10);
    expect(core.members.at(-1)?.alpha.base).toBeCloseTo(0.9, 10);
    expect(core.members.at(-1)?.tint).toBe(0xff9922);
    expect(outer.members.at(-1)?.tint).toBe(0xdd2200);
    expect(spark.members.at(-1)?.scaleX.base).toBeCloseTo(0.6, 10);
    expect(spark.members.at(-1)?.alpha.base).toBeCloseTo(1, 10);
    expect(spark.members.at(-1)?.tint).toBe(0xffaa44);
    expect(spark.members.at(-1)?.y.ease).toBe('Gravity');
    expect(spark.members.at(-1)?.y.amplitude).toBe(-32);

    renderer.destroyVisual(1);
    renderer.createVisual(2, 100, 120, 40, VOID_FIRE_COLOR);
    registry.update(50);
    expect(core.members.slice(-6).every((member) => member.frame === 'flame-core-void')).toBe(true);
    expect(outer.members.slice(-4).every((member) => member.frame === 'flame-outer-void')).toBe(true);
    expect(spark.members.at(-1)?.frame).toBe('flame-spark-void');
    expect(core.members.at(-1)?.tint).toBe(0xd887ff);
    expect(outer.members.at(-1)?.tint).toBe(0x9d35ee);
    expect(spark.members.at(-1)?.tint).toBe(0xd477ff);
  });

  it('uses current position and size only for new members', () => {
    const { registry, renderer, core } = setup();
    renderer.createVisual(1, 100, 100, 20, 0xff6600);
    registry.update(16);
    const first = core.members[0];
    const firstX = first.x.base;
    renderer.updateVisual(1, 400, 300, 80, 120, 0);
    registry.update(16);

    expect(core.edited).toEqual([0, 1, 2, 3]);
    expect(core.members[0].x.base).toBe(firstX);
    expect(core.members[2].x.base).toBeGreaterThanOrEqual(368);
    expect(core.members[2].x.base).toBeLessThanOrEqual(432);
    expect(core.members[2].scaleX.base).toBeCloseTo(1.1, 10);
    expect(core.patched).toEqual([]);
  });

  it('releases only Flame sources and leaves other GPUFX effects alive', () => {
    const { registry, renderer, core, outer, spark } = setup();
    const rocketSpec = registry.createSpec(GpuVfxEffectId.RocketExhaust);
    rocketSpec.lifeMs = 10_000;
    const rocketSource = registry.createSource(GpuVfxEffectId.RocketExhaust);
    registry.spawn(rocketSpec, rocketSource, 0);
    renderer.createVisual(1, 100, 100, 32, 0xff6600);
    renderer.createVisual(2, 200, 100, 32, 0xff6600);
    registry.update(50);

    const releaseAll = vi.spyOn(registry, 'releaseAll');
    renderer.destroyVisual(1);
    expect(releaseAll).not.toHaveBeenCalled();
    expect(registry.getLaneStats(GpuVfxLaneId.RocketExhaust)?.liveCount).toBe(1);
    expect(core.patched.length).toBeGreaterThan(0);
    expect(outer.patched.length).toBeGreaterThan(0);
    expect(spark.patched.length).toBeGreaterThan(0);

    renderer.destroyAll();
    expect(releaseAll).not.toHaveBeenCalled();
    expect(registry.getLaneStats(GpuVfxLaneId.RocketExhaust)?.liveCount).toBe(1);
    expect(registry.getLaneStats(GpuVfxLaneId.FlameCore)?.liveCount).toBe(0);
    expect(registry.getLaneStats(GpuVfxLaneId.FlameOuter)?.liveCount).toBe(0);
    expect(registry.getLaneStats(GpuVfxLaneId.FlameSpark)?.liveCount).toBe(0);
  });

  it('keeps the existing lighting cadence and variant profile', () => {
    const { renderer } = setup();
    const lighting = { setLight: vi.fn(), releaseLight: vi.fn() };
    renderer.setLightingSystem(lighting as never);
    renderer.createVisual(4, 40, 50, 30, VOID_FIRE_COLOR);
    renderer.updateVisual(4, 44, 55, 32, 0, 0);

    expect(lighting.setLight).toHaveBeenCalledWith(
      'flame:4',
      'voidFlameProjectile',
      44,
      55,
      { radiusPx: 96 + 32 * 2.55 },
    );
    renderer.destroyVisual(4);
    expect(lighting.releaseLight).toHaveBeenCalledWith('flame:4');
  });
});
