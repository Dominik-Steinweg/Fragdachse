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
    // Zunge und Ballen sind weiss und tragen beide Stile; nur die Funken haben ein Void-Frame.
    expect(core.members.slice(-6).every((member) => member.frame === 'flame-tongue')).toBe(true);
    expect(outer.members.slice(-4).every((member) => member.frame === 'flame-billow')).toBe(true);
    expect(spark.members.at(-1)?.frame).toBe('flame-spark');
    // Laenge der Zunge = (10 + size * 0.35) / 32 Frame-Breite, entlang der Stroemung um 1.15
    // gestreckt: die Querachse traegt den reinen Groessenverlauf.
    expect(core.members.at(-1)?.scaleY.base).toBeCloseTo(24 / 32, 10);
    expect(core.members.at(-1)?.scaleX.base).toBeCloseTo(24 / 32 * 1.15, 10);
    expect(core.members.at(-1)?.alpha.base).toBeCloseTo(0.58, 10);
    // Nur ein Hauch Weissglut beim Zuenden: additiv hebt jeder entsaettigte Beitrag alle drei
    // Kanaele an, und die Huelle deckt die groesste Flaeche ab.
    expect(core.members.at(-1)?.tintBlend.base).toBeCloseTo(0.62, 10);
    expect(core.members.at(-1)?.tintBlend.amplitude).toBeCloseTo(0.38, 10);
    expect(outer.members.at(-1)?.tintBlend.base).toBeCloseTo(0.9, 10);
    // Frisch gezuendet: beide Stroeme ziehen aus dem heissen Band.
    expect(core.members.at(-1)?.tint).toBe(0xffc65a);
    expect(outer.members.at(-1)?.tint).toBe(0xffc65a);
    expect(spark.members.at(-1)?.scaleX.base).toBeCloseTo(0.6, 10);
    expect(spark.members.at(-1)?.alpha.base).toBeCloseTo(1, 10);
    expect(spark.members.at(-1)?.tint).toBe(0xffaa44);
    expect(spark.members.at(-1)?.y.ease).toBe('Gravity');
    // Ohne Hitbox-Geschwindigkeit bleibt vom Startimpuls nur der Auftrieb.
    expect(spark.members.at(-1)?.y.amplitude).toBe(-14);

    renderer.destroyVisual(1);
    renderer.createVisual(2, 100, 120, 40, VOID_FIRE_COLOR);
    registry.update(50);
    expect(core.members.slice(-6).every((member) => member.frame === 'flame-tongue')).toBe(true);
    expect(outer.members.slice(-4).every((member) => member.frame === 'flame-billow')).toBe(true);
    expect(spark.members.at(-1)?.frame).toBe('flame-spark-void');
    expect(core.members.at(-1)?.tint).toBe(0xd79bff);
    expect(outer.members.at(-1)?.tint).toBe(0xd79bff);
    expect(spark.members.at(-1)?.tint).toBe(0xd477ff);
  });

  it('streams along the flight path instead of clustering on the hitbox', () => {
    const { registry, renderer, core, outer } = setup();
    renderer.createVisual(1, 0, 0, 20, 0xff6600);
    // Zwei Frames Flug nach rechts: erst danach ist genug Strecke fuer den vollen Nachlauf da.
    renderer.updateVisual(1, 40, 0, 24, 400, 0);
    registry.update(16);
    renderer.updateVisual(1, 80, 0, 28, 400, 0);
    registry.update(20);

    const smearPx = 400 * 0.085;
    for (const member of [...core.members, ...outer.members].slice(-4)) {
      // Der Spawn liegt zwischen Kopf und Nachlaufende, nicht auf einem Punkt.
      expect(member.x.base).toBeLessThanOrEqual(80);
      expect(member.x.base).toBeGreaterThanOrEqual(80 - smearPx);
      // Und er stroemt in Schussrichtung weiter, statt nach Norden zu treiben.
      expect(member.x.amplitude).toBeGreaterThan(0);
    }
    // Ohne Querstreuung (Math.random ist fixiert) bleibt nur der kleine Auftrieb uebrig.
    expect(core.members.at(-1)?.y.amplitude).toBeLessThan(0);
    expect(core.members.at(-1)?.y.base).toBe(0);
  });

  it('cools the jet down along its lifetime', () => {
    const { registry, renderer, core, outer } = setup();
    renderer.createVisual(1, 0, 0, 60, 0xff6600);
    renderer.updateVisual(1, 0, 0, 60, 400, 0);
    registry.update(20);
    const hotOuter = outer.members.at(-1)?.tint;

    // Jenseits der Temperaturrampe zieht der Ballen aus dem kalten Band, der Kern bleibt
    // bewusst im mittleren: ein Flammenkern brennt bis zuletzt heller als seine Huelle.
    registry.update(600);
    expect(hotOuter).toBe(0xffc65a);
    expect(outer.members.at(-1)?.tint).toBe(0xc93a0a);
    expect(core.members.at(-1)?.tint).toBe(0xff7412);
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
    // Der Spawn liegt im Nachlauf, wo die Hitbox noch schmaler war: size 80 * 0.875.
    expect(core.members[2].scaleY.base).toBeCloseTo((10 + 70 * 0.35) / 32, 10);
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

  it('keeps the lighting cadence and variant profile', () => {
    const { renderer } = setup();
    const lighting = { setLight: vi.fn(), releaseLight: vi.fn() };
    renderer.setLightingSystem(lighting as never);
    renderer.createVisual(6, 40, 50, 30, VOID_FIRE_COLOR);
    renderer.updateVisual(6, 44, 55, 32, 0, 0);

    expect(lighting.setLight).toHaveBeenCalledWith(
      'flame:6',
      'voidFlameProjectile',
      44,
      55,
      { radiusPx: 96 + 32 * 2.55 },
    );
    renderer.destroyVisual(6);
    expect(lighting.releaseLight).toHaveBeenCalledWith('flame:6');
  });

  it('lights the nozzle of every chain, independent of the id stride', () => {
    const { renderer } = setup();
    const lighting = { setLight: vi.fn(), releaseLight: vi.fn() };
    renderer.setLightingSystem(lighting as never);

    // Keine der beiden Ids faellt auf die Schrittweite; das Muendungslicht haengt allein am
    // Kettenschluessel und wandert mit der juengsten Hitbox weiter.
    renderer.createVisual(7, 10, 10, 20, 0xff6600, 'player-a');
    renderer.updateVisual(7, 10, 10, 20, 400, 0);
    expect(lighting.setLight).toHaveBeenCalledWith(
      'flameMuzzle:player-a', 'flameProjectile', 10, 10, { radiusPx: 150 },
    );

    renderer.createVisual(8, 38, 10, 20, 0xff6600, 'player-a');
    lighting.setLight.mockClear();
    renderer.updateVisual(7, 40, 10, 24, 400, 0);
    renderer.updateVisual(8, 12, 10, 20, 400, 0);
    // Die aeltere Hitbox erneuert das Muendungslicht nicht mehr.
    expect(lighting.setLight).toHaveBeenCalledWith(
      'flameMuzzle:player-a', 'flameProjectile', 12, 10, { radiusPx: 150 },
    );
    expect(lighting.setLight).not.toHaveBeenCalledWith(
      'flameMuzzle:player-a', 'flameProjectile', 40, 10, { radiusPx: 150 },
    );

    renderer.destroyVisual(7);
    expect(lighting.releaseLight).not.toHaveBeenCalledWith('flameMuzzle:player-a');
    renderer.destroyVisual(8);
    expect(lighting.releaseLight).toHaveBeenCalledWith('flameMuzzle:player-a');
  });

  it('bridges each hitbox to its predecessor in the same chain', () => {
    const { registry, renderer, outer } = setup();
    // Zwei Hitboxen derselben Quelle, quer zueinander versetzt wie beim Strafen.
    renderer.createVisual(1, 100, 0, 30, 0xff6600, 'player-a');
    renderer.updateVisual(1, 100, 0, 30, 400, 0);
    renderer.createVisual(2, 70, 24, 24, 0xff6600, 'player-a');
    renderer.updateVisual(2, 70, 24, 24, 400, 0);
    registry.update(20);

    // Die juengere Hitbox emittiert auf der Strecke zu ihrem Vorgaenger, nicht um sich selbst.
    const bridged = outer.members.at(-1);
    expect(bridged?.x.base).toBeCloseTo(85, 6);
    expect(bridged?.y.base).toBeCloseTo(12, 6);
    // Groesse und damit Ballendurchmesser laufen entlang der Bruecke ineinander.
    expect(bridged?.scaleY.base).toBeCloseTo((12 + 27 * 0.42) / 32, 6);

    // Eine fremde Quelle wird nicht verkettet, auch wenn sie unmittelbar daneben liegt: sie
    // faellt auf ihren eigenen Nachlauf zurueck.
    renderer.createVisual(3, 40, 26, 24, 0xff6600, 'player-b');
    renderer.updateVisual(3, 72, 26, 24, 400, 0);
    registry.update(20);
    const unbridged = outer.members.at(-1);
    expect(unbridged?.x.base).toBeCloseTo(72 - 32 / 2, 6);
    expect(unbridged?.y.base).toBeCloseTo(26, 6);
  });
});
