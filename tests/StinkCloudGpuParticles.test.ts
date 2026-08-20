import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      Linear: (a: number, b: number, t: number) => a + (b - a) * t,
      DegToRad: (deg: number) => (deg * Math.PI) / 180,
      FloatBetween: (min: number, max: number) => min + Math.random() * (max - min),
    },
  };
});

const qualityFactors = { critical: 1, standard: 1, decorative: 1 };
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: qualityFactors }),
  }),
}));

import {
  StinkCloudGpuParticles,
  type StinkCloudParticleTints,
} from '../src/effects/StinkCloudGpuParticles';
import { GpuVfxRegistry } from '../src/effects/gpu/GpuVfxRegistry';
import type { DamageZoneVisualStyle } from '../src/types';
import { makeFakeGpuVfxScene, type FakeGpuLayer } from './fakeGpuVfxScene';

const BASE_DEPTH = 17;

const TINTS: StinkCloudParticleTints = {
  inner:  [0x111111],
  accent: [0x222222],
  plume:  [0x333333],
  edge:   [0x444444],
};

function setup() {
  const scene = makeFakeGpuVfxScene();
  const registry = new GpuVfxRegistry(scene as never);
  const particles = new StinkCloudGpuParticles(scene as never, registry, 'stink_puff', BASE_DEPTH);
  // Alle sechs Layer teilen sich dieselbe Textur; unterschieden wird ueber Tiefe und Blend.
  const layer = (depth: number, blendMode: number): FakeGpuLayer =>
    scene.layers.find((l) => Math.abs(l.depth - depth) < 1e-9 && l.blendMode === blendMode)!;
  return {
    scene,
    registry,
    particles,
    innerNormal: layer(BASE_DEPTH + 0.001, 0),
    innerAdd:    layer(BASE_DEPTH + 0.001, 1),
    plumeNormal: layer(BASE_DEPTH + 0.02, 0),
    plumeAdd:    layer(BASE_DEPTH + 0.02, 1),
    accent:      layer(BASE_DEPTH + 0.03, 1),
    edge:        layer(BASE_DEPTH + 0.04, 1),
  };
}

/** Ein Frame wie im Spiel: erst der Wolken-Sync aus `updateVisual`, dann der Registry-Tick. */
function frame(
  particles: StinkCloudGpuParticles,
  registry: GpuVfxRegistry,
  deltaMs: number,
  id = 1,
  alpha = 1,
  radius = 180,
): void {
  particles.syncCloud(id, 400, 300, radius, alpha, 0, alpha > 0.01);
  registry.update(deltaMs);
}

function addCloud(
  particles: StinkCloudGpuParticles,
  id: number,
  variant: DamageZoneVisualStyle = 'stink',
): void {
  particles.registerCloud(id, variant, TINTS);
}

beforeEach(() => {
  qualityFactors.standard = 1;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('stink cloud gpu particles', () => {
  it('creates exactly six shared layers, whatever the cloud count', () => {
    const { scene, registry, particles } = setup();
    expect(scene.layers.length).toBe(6);

    for (let id = 1; id <= 10; id += 1) addCloud(particles, id, id % 2 ? 'stink' : 'electric');
    for (let id = 1; id <= 10; id += 1) {
      particles.syncCloud(id, 100 * id, 200, 180, 1, 0, true);
    }
    registry.update(50);
    expect(scene.layers.length).toBe(6);
    expect(scene.emitters.length).toBe(0);
  });

  it('keeps the blend mode and depth order of the old emitters', () => {
    const { innerNormal, innerAdd, plumeNormal, plumeAdd, accent, edge } = setup();
    // inner/plume wechseln je Variante zwischen NORMAL und ADD, accent/edge sind immer additiv.
    expect(innerNormal.blendMode).toBe(0);
    expect(innerAdd.blendMode).toBe(1);
    expect(plumeNormal.blendMode).toBe(0);
    expect(plumeAdd.blendMode).toBe(1);
    expect(accent.blendMode).toBe(1);
    expect(edge.blendMode).toBe(1);

    // inner lag exakt auf dem Container mit Haze und Blobs und braucht deshalb den Epsilon-
    // Versatz; die Reihenfolge inner < plume < accent < edge bleibt erhalten.
    expect(innerNormal.depth).toBeGreaterThan(BASE_DEPTH);
    expect(innerNormal.depth).toBeLessThan(plumeNormal.depth);
    expect(plumeNormal.depth).toBeLessThan(accent.depth);
    expect(accent.depth).toBeLessThan(edge.depth);
    expect(edge.depth).toBeCloseTo(BASE_DEPTH + 0.04, 10);

    for (const layer of [innerNormal, innerAdd, plumeNormal, plumeAdd, accent, edge]) {
      expect(layer.enabledEases).toEqual(['Linear']);
      expect(layer.added).toBe(layer.size);
    }
  });

  it('emits nothing at 60 fps, exactly like the emitters it replaces', () => {
    // `updateVisual()` ruft pro Frame `setFrequency()`, das Phasers Flow-Zaehler zurueckstellt.
    // Bei Frequenzen von 18-92 ms erreicht er auf 16,7-ms-Frames nie null.
    const { registry, particles, innerNormal, plumeNormal, accent, edge } = setup();
    addCloud(particles, 1);

    for (let f = 0; f < 120; f += 1) frame(particles, registry, 16.7);

    expect(innerNormal.edited).toEqual([]);
    expect(plumeNormal.edited).toEqual([]);
    expect(accent.edited).toEqual([]);
    expect(edge.edited).toEqual([]);
  });

  it('emits the same counts as the old flow once a frame outruns the frequency', () => {
    // Bei alpha 1 sind die Frequenzen inner 34, plume 42, accent 18, edge 24 ms. Ein 50-ms-Frame
    // ergibt daraus 1x2, 1x2, 2x1 und 2x3 Partikel.
    const { registry, particles, innerNormal, plumeNormal, accent, edge } = setup();
    addCloud(particles, 1);

    frame(particles, registry, 50);

    expect(innerNormal.edited.length).toBe(2);
    expect(plumeNormal.edited.length).toBe(2);
    expect(accent.edited.length).toBe(2);
    expect(edge.edited.length).toBe(6);
  });

  it('follows the alpha ramp of the frequencies', () => {
    // Bei alpha 0 sind die Frequenzen inner 74, plume 92, accent 54, edge 54 ms – ein 50-ms-Frame
    // reicht dann fuer keine einzige Familie.
    const { registry, particles, innerNormal, plumeNormal, accent, edge } = setup();
    addCloud(particles, 1);

    particles.syncCloud(1, 400, 300, 180, 0.02, 0, true);
    registry.update(50);

    expect(innerNormal.edited).toEqual([]);
    expect(plumeNormal.edited).toEqual([]);
    expect(accent.edited).toEqual([]);
    expect(edge.edited).toEqual([]);
  });

  it('does not emit while the cloud is invisible', () => {
    const { registry, particles, edge } = setup();
    addCloud(particles, 1);

    particles.syncCloud(1, 400, 300, 180, 0, 0, false);
    registry.update(50);
    expect(edge.edited).toEqual([]);
  });

  it('scales the flow density through the frequency only', () => {
    // `applyEmitterProfile` streckte das Intervall ueber `particleFactors.standard`. Die Quantity
    // bleibt unangetastet, sonst ginge der Faktor quadratisch ein: inner 34 -> round(34/0.5) = 68,
    // ein 50-ms-Frame reicht dann nicht mehr.
    qualityFactors.standard = 0.5;
    const { registry, particles, innerNormal, edge } = setup();
    addCloud(particles, 1);

    frame(particles, registry, 50);
    expect(innerNormal.edited).toEqual([]);
    // edge 24 -> 48; ein 50-ms-Frame ergibt genau eine Emission zu drei Partikeln.
    expect(edge.edited.length).toBe(3);
  });

  it('emits nothing when the quality factor is zero', () => {
    qualityFactors.standard = 0;
    const { registry, particles, innerNormal, plumeNormal, accent, edge } = setup();
    addCloud(particles, 1);

    for (let f = 0; f < 20; f += 1) frame(particles, registry, 50);

    for (const layer of [innerNormal, plumeNormal, accent, edge]) expect(layer.edited).toEqual([]);
  });

  it('routes inner and plume to the additive layer for electric and void variants', () => {
    const { registry, particles, innerNormal, innerAdd, plumeNormal, plumeAdd, accent } = setup();
    addCloud(particles, 1, 'electric');
    addCloud(particles, 2, 'spore_void');
    addCloud(particles, 3, 'stink');

    for (const id of [1, 2, 3]) particles.syncCloud(id, 100 * id, 200, 180, 1, 0, true);
    registry.update(50);

    // Zwei additive Wolken, eine normale.
    expect(innerAdd.edited.length).toBe(4);
    expect(innerNormal.edited.length).toBe(2);
    expect(plumeAdd.edited.length).toBe(4);
    expect(plumeNormal.edited.length).toBe(2);
    // accent ist immer additiv, hier also alle drei Wolken.
    expect(accent.edited.length).toBe(6);
  });

  it('takes the per-family tint of the cloud variant', () => {
    const { registry, particles, innerNormal, accent, plumeNormal, edge } = setup();
    addCloud(particles, 1);

    frame(particles, registry, 50);

    expect(innerNormal.members[0].tint).toBe(0x111111);
    expect(accent.members[0].tint).toBe(0x222222);
    expect(plumeNormal.members[0].tint).toBe(0x333333);
    expect(edge.members[0].tint).toBe(0x444444);
  });

  it('walks the edge zone points in order around the current radius', () => {
    // `edgeZone(target, 56)` verteilt 56 Punkte gleichmaessig auf dem Kreisrand; Phasers
    // EdgeZone laeuft sie der Reihe nach ab, beginnend bei Index 0.
    const { registry, particles, edge } = setup();
    addCloud(particles, 1);

    frame(particles, registry, 50);

    const target = Math.max(180 * 0.86, 12);
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 56) * Math.PI * 2;
      expect(edge.members[i].x.base).toBeCloseTo(400 + Math.cos(angle) * target, 8);
      expect(edge.members[i].y.base).toBeCloseTo(300 + Math.sin(angle) * target, 8);
    }
  });

  it('spawns at the current cloud position and never edits a member again', () => {
    const { registry, particles, edge } = setup();
    addCloud(particles, 1);

    particles.syncCloud(1, 400, 300, 180, 1, 0, true);
    registry.update(50);
    const firstBatch = edge.edited.length;
    expect(firstBatch).toBeGreaterThan(0);

    // Wolke wandert; neue Puffs starten dort, alte bleiben in Weltkoordinaten stehen.
    particles.syncCloud(1, 900, 300, 180, 1, 0, true);
    registry.update(50);

    const target = Math.max(180 * 0.86, 12);
    const distanceTo = (index: number, cx: number) =>
      Math.hypot(edge.members[index].x.base - cx, edge.members[index].y.base - 300);
    for (let i = 0; i < firstBatch; i += 1) expect(distanceTo(i, 400)).toBeCloseTo(target, 8);
    for (let i = firstBatch; i < edge.members.length; i += 1) {
      expect(distanceTo(i, 900)).toBeCloseTo(target, 8);
    }

    // Kein Slot wurde zweimal bespielt, es gab also kein Nach-Editieren.
    expect(new Set(edge.edited).size).toBe(edge.edited.length);
  });

  it('holds emission and does not catch up while the ablation suppresses gpu particles', () => {
    const { registry, particles, edge } = setup();
    addCloud(particles, 1);

    frame(particles, registry, 50);
    const before = edge.edited.length;
    expect(before).toBeGreaterThan(0);

    registry.setSuppressed(true);
    for (let f = 0; f < 40; f += 1) frame(particles, registry, 50);
    expect(edge.edited.length).toBe(before);

    registry.setSuppressed(false);
    frame(particles, registry, 50);
    // Genau ein Frame Emission, kein Nachholen der 40 unterdrueckten Frames.
    expect(edge.edited.length - before).toBe(6);
  });

  it('releases exactly the members of a removed cloud', () => {
    const { registry, particles, edge } = setup();
    addCloud(particles, 1);
    addCloud(particles, 2);

    for (const id of [1, 2]) particles.syncCloud(id, 100 * id, 200, 180, 1, 0, true);
    registry.update(50);
    const spawned = edge.edited.length;
    expect(spawned).toBe(12);

    particles.releaseCloud(1);
    expect(edge.patched.length).toBe(6);
    expect(registry.getStats()?.['stink-edge'].activeSlots).toBe(6);

    // Die entfernte Wolke emittiert nicht mehr.
    particles.syncCloud(2, 200, 200, 180, 1, 0, true);
    registry.update(50);
    expect(edge.edited.length).toBe(spawned + 6);
  });

  it('releases members left behind in the other blend layer after a variant switch', () => {
    const { registry, particles, innerNormal, innerAdd } = setup();
    addCloud(particles, 1, 'stink');
    frame(particles, registry, 50);
    expect(innerNormal.edited.length).toBe(2);

    // Variantenwechsel: das Wolkenbild wird neu aufgebaut, registerCloud raeumt vorher auf.
    particles.registerCloud(1, 'electric', TINTS);
    expect(innerNormal.patched.length).toBe(2);

    frame(particles, registry, 50);
    expect(innerAdd.edited.length).toBe(2);
  });

  it('clears every cloud on teardown', () => {
    const { registry, particles, edge, innerNormal } = setup();
    addCloud(particles, 1);
    addCloud(particles, 2);
    for (const id of [1, 2]) particles.syncCloud(id, 100 * id, 200, 180, 1, 0, true);
    registry.update(50);

    particles.releaseAll();
    expect(edge.patched.length).toBe(edge.edited.length);
    expect(innerNormal.patched.length).toBe(innerNormal.edited.length);
    expect(registry.getStats()?.['stink-edge'].activeSlots).toBe(0);

    // Nach dem Teardown emittiert nichts mehr, bis wieder Wolken angemeldet werden.
    for (const id of [1, 2]) particles.syncCloud(id, 100 * id, 200, 180, 1, 0, true);
    registry.update(50);
    expect(edge.edited.length).toBe(12);
  });

  it('drops spawns at the pool limit instead of overwriting living members', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry, particles, edge } = setup();
    // Weit mehr Wolken, als die Edge-Kapazitaet in einer Lebenszeit traegt.
    for (let id = 1; id <= 60; id += 1) addCloud(particles, id);

    for (let f = 0; f < 12; f += 1) {
      for (let id = 1; id <= 60; id += 1) particles.syncCloud(id, 100, 200, 180, 1, 0, true);
      registry.update(50);
    }

    const stats = registry.getStats()?.['stink-edge'];
    expect(stats!.activeSlots).toBeLessThanOrEqual(stats!.capacity);
    expect(stats!.overruns).toBeGreaterThan(0);
    // Jeder Edit gehoert zu genau einem Rearm: kein lebender Slot wurde ueberschrieben.
    expect(edge.edited.length).toBe(stats!.rearms);
    warn.mockRestore();
  });
});
