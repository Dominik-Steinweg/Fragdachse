import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phaser-Stub mit genau der Oberflaeche, die AirstrikeRenderer und das GPU-VFX-Backend benutzen.
 * `Geom.Circle.Random` ist bewusst Phasers echte Formel, weil die Flaechenverteilung der
 * Spawn-Zone Teil des migrierten Verhaltens ist.
 */
vi.mock('phaser', () => {
  class Vector2 {
    constructor(public x = 0, public y = 0) {}
  }
  class Circle {
    constructor(public x = 0, public y = 0, public radius = 0) {}
    setTo(x: number, y: number, radius: number): this {
      this.x = x; this.y = y; this.radius = radius;
      return this;
    }
    static Random(circle: Circle, out: Vector2): Vector2 {
      const t = 2 * Math.PI * Math.random();
      const u = Math.random() + Math.random();
      const r = u > 1 ? 2 - u : u;
      out.x = circle.x + r * Math.cos(t) * circle.radius;
      out.y = circle.y + r * Math.sin(t) * circle.radius;
      return out;
    }
  }
  return {
    BlendModes: { NORMAL: 0, ADD: 1 },
    Geom: { Circle },
    Math: {
      Vector2,
      Clamp: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)),
      DegToRad: (deg: number) => (deg * Math.PI) / 180,
      FloatBetween: (min: number, max: number) => min + Math.random() * (max - min),
      Linear: (a: number, b: number, t: number) => a + (b - a) * t,
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

import { AirstrikeRenderer } from '../src/effects/AirstrikeRenderer';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GPU_VFX_LANES } from '../src/effects/gpu/GpuVfxRenderLanes';
import { DEPTH } from '../src/config';
import type { SyncedAirstrikeStrike } from '../src/types';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function strike(id: number, overrides: Partial<SyncedAirstrikeStrike> = {}): SyncedAirstrikeStrike {
  const now = Date.now();
  return {
    id,
    x: 100 * id,
    y: 200,
    radius: 150,
    armedAt: now,
    explodeAt: now + 2000,
    triggeredBy: 'player-1',
    ...overrides,
  };
}

function setup() {
  const scene = makeFakeGpuVfxScene();
  const system = new GpuVfxSystem(scene as never);
  const renderer = new AirstrikeRenderer(scene as never);
  renderer.generateTextures();
  renderer.registerGpuVfx(system);
  return {
    scene,
    system,
    renderer,
    bomb: findFakeLane(scene, 'airstrike-bomb'),
    spark: findFakeLane(scene, 'airstrike-spark'),
  };
}

beforeEach(() => {
  resetGpuVfxAtlasForTests();
  qualityFactors.standard = 1;
  // Deterministische Spawn-Werte; die Verteilung selbst ist nicht Gegenstand dieser Tests.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('airstrike gpu particles', () => {
  it('uses exactly two shared lanes, independent of the number of strikes', () => {
    const { scene, system, renderer, bomb, spark } = setup();
    // Die Lanes entstehen aus dem Manifest, nicht aus dem Effekt.
    expect(scene.layers.length).toBe(GPU_VFX_LANES.length);

    renderer.sync([strike(1), strike(2), strike(3)]);
    system.update(200);
    expect(scene.layers.length).toBe(GPU_VFX_LANES.length);

    // Ein zweiter Anmeldeversuch legt nichts Neues an.
    renderer.registerGpuVfx(system);
    expect(scene.layers.length).toBe(GPU_VFX_LANES.length);

    // Nur die beiden Airstrike-Lanes wurden bespielt.
    expect(bomb.edited.length).toBeGreaterThan(0);
    expect(spark.edited.length).toBeGreaterThan(0);
    const others = scene.layers.filter((layer) => layer !== bomb && layer !== spark);
    expect(others.every((layer) => layer.edited.length === 0)).toBe(true);
  });

  it('primes both lanes up front so the first strike triggers no shader rebuild', () => {
    const { bomb, spark } = setup();
    expect(bomb.enabledEases).toEqual(['Linear', 'Gravity']);
    expect(spark.enabledEases).toEqual(['Linear']);
    expect(bomb.added).toBe(bomb.size);
    expect(spark.added).toBe(spark.size);
    // Alle Member existieren schon; ein Spawn darf danach nur noch editieren.
    expect(bomb.edited).toEqual([]);
  });

  it('layers additively just above the objects the old emitters rendered in front of', () => {
    const { bomb, spark } = setup();
    expect(bomb.blendMode).toBe(1);
    expect(spark.blendMode).toBe(1);
    // Die alten Emitter entstanden zur Strike-Laufzeit und lagen bei gleicher Depth oben.
    expect(bomb.depth).toBeGreaterThan(DEPTH.PLAYERS);
    expect(bomb.depth).toBeLessThan(DEPTH.PLAYERS + 0.01);
    expect(spark.depth).toBeGreaterThan(DEPTH.PLAYERS - 1);
    // Muss unter DEPTH.ROCK_MOSS (9.08) bleiben.
    expect(spark.depth).toBeLessThan(DEPTH.PLAYERS - 1 + 0.08);
    expect(bomb.gravity).toBe(30);
  });

  it('draws both motifs from the shared atlas', () => {
    const { system, renderer, bomb, spark } = setup();
    renderer.sync([strike(1)]);
    system.update(200);

    expect(bomb.key).toBe('__gpu_vfx_atlas');
    expect(spark.key).toBe('__gpu_vfx_atlas');
    expect(bomb.members.every((member) => member.frame === 'airstrike-bomb')).toBe(true);
    expect(spark.members.every((member) => member.frame === 'airstrike-spark')).toBe(true);
  });

  it('keeps the gravity encoding of the falling bombs', () => {
    const { system, renderer, bomb } = setup();
    renderer.sync([strike(1)]);
    system.update(200);

    const member = bomb.members[0];
    expect(member.y.ease).toBe('Gravity');
    // Phaser kodiert `velocity` ganzzahlig.
    expect(Number.isInteger(member.y.amplitude)).toBe(true);
    expect(member.y.loop).toBe(false);
  });

  it('emits on the flow counters the old emitters started with', () => {
    const { system, renderer, bomb, spark } = setup();
    renderer.sync([strike(1)]);

    system.update(69);
    expect(bomb.edited.length).toBe(0);
    expect(spark.edited.length).toBe(0);

    system.update(1);   // 70 ms: Spark-Startzaehler faellig
    expect(spark.edited.length).toBe(1);
    expect(bomb.edited.length).toBe(0);

    system.update(10);  // 80 ms: Bomb-Startzaehler faellig
    expect(bomb.edited.length).toBe(1);
  });

  it('ticks particles without a fresh sync, as the autonomous emitter did', () => {
    // Auf Clients laeuft sync() nur mit neuem Netzzustand; die Emission darf davon nicht abhaengen.
    const { system, renderer, bomb } = setup();
    renderer.sync([strike(1)]);

    for (let frame = 0; frame < 20; frame += 1) system.update(16);
    expect(bomb.edited.length).toBeGreaterThan(2);
  });

  it('hides a vanished strike immediately, like the old emitter destroy', () => {
    const { system, renderer, bomb } = setup();
    renderer.sync([strike(1), strike(2)]);
    system.update(200);
    const spawned = bomb.edited.length;
    expect(spawned).toBeGreaterThan(0);

    renderer.sync([strike(2)]);
    // Genau die Member von Strike 1 sind stillgelegt, die von Strike 2 laufen weiter.
    expect(bomb.patched.length).toBeGreaterThan(0);
    expect(bomb.patched.length).toBeLessThan(spawned);
  });

  it('clears every member and shape on teardown, keeping the shared lanes alive', () => {
    const { scene, system, renderer, bomb, spark } = setup();
    renderer.sync([strike(1), strike(2)]);
    system.update(200);
    const spawnedBombs = bomb.edited.length;
    const spawnedSparks = spark.edited.length;

    renderer.clear();
    expect(bomb.patched.length).toBe(spawnedBombs);
    expect(spark.patched.length).toBe(spawnedSparks);
    expect(scene.objects.every((object) => object.destroyed)).toBe(true);
    expect(scene.layers.length).toBe(GPU_VFX_LANES.length);

    // Nach dem Teardown darf ein neuer Strike sofort wieder emittieren.
    renderer.sync([strike(3)]);
    system.update(200);
    expect(bomb.edited.length).toBeGreaterThan(spawnedBombs);
  });

  it('stretches the emission interval with the graphics quality', () => {
    // Vor der Zentralisierung konsumierte der Airstrike GraphicsQuality gar nicht: die alten
    // Emitter bekamen zwar eine skalierte `frequency`, `updateVisual()` ueberschrieb sie im
    // selben Frame, und ein `maxAliveParticles`-Deckel kam wegen `lifespan: {min,max}` nie
    // zustande. Auf `high` (Faktor 1) bleibt die Emission bitgleich.
    const high = setup();
    high.renderer.sync([strike(1)]);
    for (let frame = 0; frame < 30; frame += 1) high.system.update(16);
    const highSpawns = high.bomb.edited.length;

    qualityFactors.standard = 0.35;
    resetGpuVfxAtlasForTests();
    const low = setup();
    low.renderer.sync([strike(1)]);
    for (let frame = 0; frame < 30; frame += 1) low.system.update(16);

    expect(highSpawns).toBeGreaterThan(0);
    expect(low.bomb.edited.length).toBeLessThan(highSpawns);
  });

  it('stops emitting entirely at quality factor zero', () => {
    qualityFactors.standard = 0;
    const { scene, system, renderer, bomb, spark } = setup();
    renderer.sync([strike(1)]);
    for (let frame = 0; frame < 30; frame += 1) system.update(16);

    expect(bomb.edited.length).toBe(0);
    expect(spark.edited.length).toBe(0);
    // Der Telegraph selbst bleibt unberuehrt – Warnkreis und Fadenkreuz sind Shapes.
    expect(scene.objects.length).toBeGreaterThan(0);
    expect(scene.objects.some((object) => object.destroyed)).toBe(false);
  });
});
