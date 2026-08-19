import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phaser-Stub mit genau der Oberflaeche, die AirstrikeRenderer und GpuVfxRegistry benutzen.
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
    BlendModes: { ADD: 1 },
    Geom: { Circle },
    Math: {
      Vector2,
      Clamp: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)),
      DegToRad: (deg: number) => (deg * Math.PI) / 180,
      FloatBetween: (min: number, max: number) => min + Math.random() * (max - min),
    },
  };
});

import { AirstrikeRenderer } from '../src/effects/AirstrikeRenderer';
import { GpuVfxRegistry } from '../src/effects/gpu/GpuVfxRegistry';
import { DEPTH } from '../src/config';
import type { SyncedAirstrikeStrike } from '../src/types';
import { makeFakeGpuVfxScene } from './fakeGpuVfxScene';

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
  const registry = new GpuVfxRegistry(scene as never);
  const renderer = new AirstrikeRenderer(scene as never);
  renderer.generateTextures();
  renderer.initGpuLayers(registry);
  const [bomb, spark] = scene.layers;
  return { scene, registry, renderer, bomb, spark };
}

beforeEach(() => {
  // Deterministische Spawn-Werte; die Verteilung selbst ist nicht Gegenstand dieser Tests.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('airstrike gpu particles', () => {
  it('creates exactly two shared layers, independent of the number of strikes', () => {
    const { scene, registry, renderer, bomb, spark } = setup();
    expect(scene.layers.length).toBe(2);

    renderer.sync([strike(1), strike(2), strike(3)]);
    registry.update(200);
    expect(scene.layers.length).toBe(2);

    // Ein zweiter Init-Aufruf legt nichts Neues an.
    renderer.initGpuLayers(registry);
    expect(scene.layers.length).toBe(2);
    expect(bomb.key).toBe('__airstrike_bomb');
    expect(spark.key).toBe('__airstrike_warn');
  });

  it('primes both layers up front so the first strike triggers no shader rebuild', () => {
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

  it('emits on the flow counters the old emitters started with', () => {
    const { registry, renderer, bomb, spark } = setup();
    renderer.sync([strike(1)]);

    registry.update(69);
    expect(bomb.edited.length).toBe(0);
    expect(spark.edited.length).toBe(0);

    registry.update(1);   // 70 ms: Spark-Startzaehler faellig
    expect(spark.edited.length).toBe(1);
    expect(bomb.edited.length).toBe(0);

    registry.update(10);  // 80 ms: Bomb-Startzaehler faellig
    expect(bomb.edited.length).toBe(1);
  });

  it('ticks particles without a fresh sync, as the autonomous emitter did', () => {
    // Auf Clients laeuft sync() nur mit neuem Netzzustand; die Emission darf davon nicht abhaengen.
    const { registry, renderer, bomb } = setup();
    renderer.sync([strike(1)]);

    for (let frame = 0; frame < 20; frame += 1) registry.update(16);
    expect(bomb.edited.length).toBeGreaterThan(2);
  });

  it('hides a vanished strike immediately, like the old emitter destroy', () => {
    const { registry, renderer, bomb } = setup();
    renderer.sync([strike(1), strike(2)]);
    registry.update(200);
    const spawned = bomb.edited.length;
    expect(spawned).toBeGreaterThan(0);

    renderer.sync([strike(2)]);
    // Genau die Member von Strike 1 sind stillgelegt, die von Strike 2 laufen weiter.
    expect(bomb.patched.length).toBeGreaterThan(0);
    expect(bomb.patched.length).toBeLessThan(spawned);
  });

  it('clears every member and shape on teardown, keeping the shared layers alive', () => {
    const { scene, registry, renderer, bomb, spark } = setup();
    renderer.sync([strike(1), strike(2)]);
    registry.update(200);
    const spawnedBombs = bomb.edited.length;
    const spawnedSparks = spark.edited.length;

    renderer.clear();
    expect(bomb.patched.length).toBe(spawnedBombs);
    expect(spark.patched.length).toBe(spawnedSparks);
    expect(scene.objects.every((object) => object.destroyed)).toBe(true);
    expect(scene.layers.length).toBe(2);

    // Nach dem Teardown darf ein neuer Strike sofort wieder emittieren.
    renderer.sync([strike(3)]);
    registry.update(200);
    expect(bomb.edited.length).toBeGreaterThan(spawnedBombs);
  });
});
