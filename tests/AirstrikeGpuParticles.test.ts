import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phaser-Stub mit genau der Oberflaeche, die der AirstrikeRenderer benutzt. `Geom.Circle.Random`
 * ist bewusst Phasers echte Formel, weil die Flaechenverteilung der Spawn-Zone Teil des
 * migrierten Verhaltens ist.
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
import { DEPTH } from '../src/config';
import type { SyncedAirstrikeStrike } from '../src/types';

interface FakeLayer {
  key: string;
  size: number;
  gravity: number;
  timeElapsed: number;
  visible: boolean;
  depth: number;
  blendMode: number;
  enabledEases: string[];
  added: number;
  edited: number[];
  patched: number[];
  getDataByteSize(): number;
  addMember(): void;
  editMember(index: number): void;
  patchMember(index: number, data: Uint32Array, mask?: number[]): void;
  setVisible(visible: boolean): FakeLayer;
  setDepth(depth: number): FakeLayer;
  setBlendMode(mode: number): FakeLayer;
  setAnimationEnabled(name: string, enabled: boolean): FakeLayer;
}

function makeLayer(key: string, size: number): FakeLayer {
  const layer: FakeLayer = {
    key,
    size,
    gravity: 1024,
    timeElapsed: 0,
    visible: true,
    depth: 0,
    blendMode: 0,
    enabledEases: [],
    added: 0,
    edited: [],
    patched: [],
    getDataByteSize: () => 42 * 4,
    addMember: () => { layer.added += 1; },
    editMember: (index) => { layer.edited.push(index); },
    patchMember: (index) => { layer.patched.push(index); },
    setVisible: (visible) => { layer.visible = visible; return layer; },
    setDepth: (depth) => { layer.depth = depth; return layer; },
    setBlendMode: (mode) => { layer.blendMode = mode; return layer; },
    setAnimationEnabled: (name, enabled) => {
      if (enabled) layer.enabledEases.push(name);
      return layer;
    },
  };
  return layer;
}

function makeShape() {
  const shape = {
    destroyed: false,
    setDepth: () => shape,
    setBlendMode: () => shape,
    setStrokeStyle: () => shape,
    setPosition: () => shape,
    setAlpha: () => shape,
    setScale: () => shape,
    destroy: () => { shape.destroyed = true; },
  };
  return shape;
}

function makeScene() {
  const layers: FakeLayer[] = [];
  const shapes: ReturnType<typeof makeShape>[] = [];
  const scene = {
    layers,
    shapes,
    textures: { exists: () => true, createCanvas: () => null },
    tweens: { add: () => ({}) },
    add: {
      circle: () => { const s = makeShape(); shapes.push(s); return s; },
      rectangle: () => { const s = makeShape(); shapes.push(s); return s; },
      spriteGPULayer: (key: string, size: number) => {
        const layer = makeLayer(key, size);
        layers.push(layer);
        return layer;
      },
    },
  };
  return scene;
}

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
  const scene = makeScene();
  const renderer = new AirstrikeRenderer(scene as never);
  renderer.generateTextures();
  renderer.initGpuLayers();
  const [bomb, spark] = scene.layers;
  return { scene, renderer, bomb, spark };
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
    const { scene, renderer, bomb, spark } = setup();
    expect(scene.layers.length).toBe(2);

    renderer.sync([strike(1), strike(2), strike(3)]);
    renderer.updateParticles(200);
    expect(scene.layers.length).toBe(2);

    // Ein zweiter Init-Aufruf legt nichts Neues an.
    renderer.initGpuLayers();
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
    const { renderer, bomb, spark } = setup();
    renderer.sync([strike(1)]);

    renderer.updateParticles(69);
    expect(bomb.edited.length).toBe(0);
    expect(spark.edited.length).toBe(0);

    renderer.updateParticles(1);   // 70 ms: Spark-Startzaehler faellig
    expect(spark.edited.length).toBe(1);
    expect(bomb.edited.length).toBe(0);

    renderer.updateParticles(10);  // 80 ms: Bomb-Startzaehler faellig
    expect(bomb.edited.length).toBe(1);
  });

  it('ticks particles without a fresh sync, as the autonomous emitter did', () => {
    // Auf Clients laeuft sync() nur mit neuem Netzzustand; die Emission darf davon nicht abhaengen.
    const { renderer, bomb } = setup();
    renderer.sync([strike(1)]);

    for (let frame = 0; frame < 20; frame += 1) renderer.updateParticles(16);
    expect(bomb.edited.length).toBeGreaterThan(2);
  });

  it('hides a vanished strike immediately, like the old emitter destroy', () => {
    const { renderer, bomb, spark } = setup();
    renderer.sync([strike(1), strike(2)]);
    renderer.updateParticles(200);
    const spawned = bomb.edited.length;
    expect(spawned).toBeGreaterThan(0);

    renderer.sync([strike(2)]);
    // Genau die Member von Strike 1 sind stillgelegt, die von Strike 2 laufen weiter.
    expect(bomb.patched.length).toBeGreaterThan(0);
    expect(bomb.patched.length).toBeLessThan(spawned);
  });

  it('suppresses rendering and scheduler together, without catching up afterwards', () => {
    const { renderer, bomb, spark } = setup();
    renderer.sync([strike(1)]);
    renderer.updateParticles(200);
    const beforeSuppression = bomb.edited.length;
    expect(beforeSuppression).toBeGreaterThan(0);

    renderer.setSuppressed(true);
    expect(bomb.visible).toBe(false);
    expect(spark.visible).toBe(false);
    // Laufendes Material verschwindet sofort – GPU-Zeit laesst sich nicht einfrieren.
    expect(bomb.patched.length).toBe(beforeSuppression);

    for (let frame = 0; frame < 60; frame += 1) renderer.updateParticles(16);
    expect(bomb.edited.length).toBe(beforeSuppression);

    renderer.setSuppressed(false);
    expect(bomb.visible).toBe(true);
    // Kein Nachhol-Burst: der erste Frame nach der Freigabe emittiert hoechstens einen Member.
    renderer.updateParticles(16);
    expect(bomb.edited.length - beforeSuppression).toBeLessThanOrEqual(1);
  });

  it('retires live members when the layer clock wraps', () => {
    // `ElapseTimer` setzt `timeElapsed` nach einer Stunde zurueck, ohne die `creationTime` der
    // Member mitzuziehen. Ohne Eingriff extrapolieren deren Animationen schlagartig weit ueber
    // ihr Ende hinaus – additiv also ein Vollbild-Blitz.
    const { renderer, bomb, spark } = setup();
    renderer.sync([strike(1)]);
    bomb.timeElapsed = 3_599_900;
    spark.timeElapsed = 3_599_900;
    renderer.updateParticles(200);
    const liveBombs  = bomb.edited.length;
    const liveSparks = spark.edited.length;
    expect(liveBombs).toBeGreaterThan(0);
    expect(liveSparks).toBeGreaterThan(0);
    expect(bomb.patched.length).toBe(0);

    bomb.timeElapsed = 100;
    spark.timeElapsed = 100;
    renderer.updateParticles(16);
    expect(bomb.patched.length).toBe(liveBombs);
    expect(spark.patched.length).toBe(liveSparks);
  });

  it('clears every member and shape on teardown, keeping the shared layers alive', () => {
    const { scene, renderer, bomb, spark } = setup();
    renderer.sync([strike(1), strike(2)]);
    renderer.updateParticles(200);
    const spawnedBombs = bomb.edited.length;
    const spawnedSparks = spark.edited.length;

    renderer.clear();
    expect(bomb.patched.length).toBe(spawnedBombs);
    expect(spark.patched.length).toBe(spawnedSparks);
    expect(scene.shapes.every((shape) => shape.destroyed)).toBe(true);
    expect(scene.layers.length).toBe(2);

    // Nach dem Teardown darf ein neuer Strike sofort wieder emittieren.
    renderer.sync([strike(3)]);
    renderer.updateParticles(200);
    expect(bomb.edited.length).toBeGreaterThan(spawnedBombs);
  });
});
