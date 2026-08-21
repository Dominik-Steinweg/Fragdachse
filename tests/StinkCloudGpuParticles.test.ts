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
    subscribe: () => () => {},
  }),
}));

import {
  StinkCloudGpuParticles,
  type StinkCloudParticleTints,
} from '../src/effects/StinkCloudGpuParticles';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GPU_VFX_LANES } from '../src/effects/gpu/GpuVfxRenderLanes';
import { DEPTH } from '../src/config';
import type { DamageZoneVisualStyle } from '../src/types';
import { findFakeLane, makeFakeGpuVfxScene, type FakeGpuMemberSnapshot } from './fakeGpuVfxScene';

const BASE_DEPTH = DEPTH.STINK;

const TINT = {
  inner:  0x111111,
  accent: 0x222222,
  plume:  0x333333,
  edge:   0x444444,
};

const TINTS: StinkCloudParticleTints = {
  inner:  [TINT.inner],
  accent: [TINT.accent],
  plume:  [TINT.plume],
  edge:   [TINT.edge],
};

function setup() {
  const scene = makeFakeGpuVfxScene();
  const registry = new GpuVfxSystem(scene as never);
  const particles = new StinkCloudGpuParticles(registry);
  return {
    scene,
    registry,
    particles,
    // Sechs logische Pfade auf zwei physischen Lanes: der Blend-Mode ist layerglobal, alles
    // andere unterscheidet sich nur pro Member.
    normal: findFakeLane(scene, 'stink-normal'),
    add:    findFakeLane(scene, 'stink-add'),
  };
}

/** Spawns eines logischen Effekts – die Lane ist geteilt, die Statistik nicht. */
function spawnsOf(registry: GpuVfxSystem, label: string): number {
  return registry.buildReport().effects.find((effect) => effect.label === label)?.spawns ?? 0;
}

function membersWithTint(members: readonly FakeGpuMemberSnapshot[], tint: number) {
  return members.filter((member) => member.tint === tint);
}

/** Ein Frame wie im Spiel: erst der Wolken-Sync aus `updateVisual`, dann der Backend-Tick. */
function frame(
  particles: StinkCloudGpuParticles,
  registry: GpuVfxSystem,
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
  resetGpuVfxAtlasForTests();
  qualityFactors.standard = 1;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('stink cloud gpu particles', () => {
  it('spawns four logical families into two shared lanes, whatever the cloud count', () => {
    const { scene, registry, particles, normal, add } = setup();
    // Die Lanes entstehen aus dem Manifest, nicht je Wolke.
    expect(scene.layers.length).toBe(GPU_VFX_LANES.length);

    for (let id = 1; id <= 10; id += 1) addCloud(particles, id, id % 2 ? 'stink' : 'electric');
    for (let id = 1; id <= 10; id += 1) {
      particles.syncCloud(id, 100 * id, 200, 180, 1, 0, true);
    }
    registry.update(50);
    expect(scene.layers.length).toBe(GPU_VFX_LANES.length);
    expect(scene.emitters.length).toBe(0);

    // Genau zwei bespielte Lanes, und keine fremde.
    const others = scene.layers.filter((layer) => layer !== normal && layer !== add);
    expect(normal.edited.length).toBeGreaterThan(0);
    expect(add.edited.length).toBeGreaterThan(0);
    expect(others.every((layer) => layer.edited.length === 0)).toBe(true);

    // Vier logische Effekte bleiben trotzdem einzeln auswertbar.
    for (const label of ['stink.inner', 'stink.plume', 'stink.accent', 'stink.edge']) {
      expect(spawnsOf(registry, label)).toBeGreaterThan(0);
    }

    // Beide Lanes teilen sich den Atlas und dasselbe Motiv.
    expect([normal, add].every((lane) => lane.key === '__gpu_vfx_atlas')).toBe(true);
    expect([normal, add].every((lane) => lane.members.every((m) => m.frame === 'stink-puff'))).toBe(true);
  });

  it('keeps the depth band contract of the cloud visuals', () => {
    // Im Band 16.8…17.2 liegt ausser der Stinkwolke nichts. Reihenfolge von unten nach oben:
    //   16.88 groundGlow · 16.92 damageAura · 16.96 reactionPulse · 17.0 Container (Haze/Blobs)
    //   17.02 stink-normal · 17.03 Spawn-Flash (ADD) · 17.04 stink-add
    //   17.05 Spawn-Burst-Emitter (ADD) · 17.1 Fairness-Kreis (ADD)
    // Beide GPU-Lanes liegen ueber dem Container; alles, was zwischen ihnen liegt, ist additiv
    // und damit reihenfolgeunabhaengig.
    const { normal, add } = setup();
    expect(normal.blendMode).toBe(0);
    expect(add.blendMode).toBe(1);

    expect(normal.depth).toBeGreaterThan(BASE_DEPTH);
    expect(normal.depth).toBeCloseTo(BASE_DEPTH + 0.02, 10);
    expect(add.depth).toBeCloseTo(BASE_DEPTH + 0.04, 10);
    expect(normal.depth).toBeLessThan(add.depth);
    // Unter dem Spawn-Burst-Emitter (+0.05) und dem Fairness-Kreis (+0.1).
    expect(add.depth).toBeLessThan(BASE_DEPTH + 0.05);

    for (const lane of [normal, add]) {
      expect(lane.enabledEases).toEqual(['Linear']);
      expect(lane.added).toBe(lane.size);
    }
  });

  it('emits nothing at 60 fps, exactly like the emitters it replaces', () => {
    // `updateVisual()` ruft pro Frame `setFrequency()`, das Phasers Flow-Zaehler zurueckstellt.
    // Bei Frequenzen von 18-92 ms erreicht er auf 16,7-ms-Frames nie null.
    const { registry, particles, normal, add } = setup();
    addCloud(particles, 1);

    for (let f = 0; f < 120; f += 1) frame(particles, registry, 16.7);

    expect(normal.edited).toEqual([]);
    expect(add.edited).toEqual([]);
  });

  it('keeps both cloud lanes idle and hidden in that 60 fps state', () => {
    // Sechs logische Pfade, die nichts emittieren, duerfen keine Instanzen kosten.
    const { registry, particles, normal, add } = setup();
    addCloud(particles, 1);

    for (let f = 0; f < 120; f += 1) frame(particles, registry, 16.7);

    expect(normal.visible).toBe(false);
    expect(add.visible).toBe(false);
    expect(registry.getStats()?.['stink-normal'].liveCount).toBe(0);
    expect(registry.getStats()?.['stink-add'].liveCount).toBe(0);
  });

  it('emits the same counts as the old flow once a frame outruns the frequency', () => {
    // Bei alpha 1 sind die Frequenzen inner 34, plume 42, accent 18, edge 24 ms. Ein 50-ms-Frame
    // ergibt daraus 1x2, 1x2, 2x1 und 2x3 Partikel.
    const { registry, particles, normal, add } = setup();
    addCloud(particles, 1);

    frame(particles, registry, 50);

    expect(spawnsOf(registry, 'stink.inner')).toBe(2);
    expect(spawnsOf(registry, 'stink.plume')).toBe(2);
    expect(spawnsOf(registry, 'stink.accent')).toBe(2);
    expect(spawnsOf(registry, 'stink.edge')).toBe(6);
    // Eine gewoehnliche Wolke: inner und plume normal, accent und edge additiv.
    expect(normal.edited.length).toBe(4);
    expect(add.edited.length).toBe(8);
  });

  it('follows the alpha ramp of the frequencies', () => {
    // Bei alpha 0 sind die Frequenzen inner 74, plume 92, accent 54, edge 54 ms – ein 50-ms-Frame
    // reicht dann fuer keine einzige Familie.
    const { registry, particles, normal, add } = setup();
    addCloud(particles, 1);

    particles.syncCloud(1, 400, 300, 180, 0.02, 0, true);
    registry.update(50);

    expect(normal.edited).toEqual([]);
    expect(add.edited).toEqual([]);
  });

  it('does not emit while the cloud is invisible', () => {
    const { registry, particles, add } = setup();
    addCloud(particles, 1);

    particles.syncCloud(1, 400, 300, 180, 0, 0, false);
    registry.update(50);
    expect(add.edited).toEqual([]);
  });

  it('scales the flow density through the frequency only', () => {
    // `applyEmitterProfile` streckte das Intervall ueber `particleFactors.standard`. Die Quantity
    // bleibt unangetastet, sonst ginge der Faktor quadratisch ein: inner 34 -> round(34/0.5) = 68,
    // ein 50-ms-Frame reicht dann nicht mehr.
    qualityFactors.standard = 0.5;
    const { registry, particles, normal } = setup();
    addCloud(particles, 1);

    frame(particles, registry, 50);
    expect(normal.edited).toEqual([]);
    expect(spawnsOf(registry, 'stink.inner')).toBe(0);
    expect(spawnsOf(registry, 'stink.plume')).toBe(0);
    // edge 24 -> 48; ein 50-ms-Frame ergibt genau eine Emission zu drei Partikeln.
    expect(spawnsOf(registry, 'stink.edge')).toBe(3);
    // accent 18 -> 36; genau eine Emission zu einem Partikel.
    expect(spawnsOf(registry, 'stink.accent')).toBe(1);
  });

  it('emits nothing when the quality factor is zero', () => {
    qualityFactors.standard = 0;
    const { registry, particles, normal, add } = setup();
    addCloud(particles, 1);

    for (let f = 0; f < 20; f += 1) frame(particles, registry, 50);

    for (const lane of [normal, add]) expect(lane.edited).toEqual([]);
    // Verworfen wird auf Effektebene gezaehlt, nicht als Kapazitaetsproblem.
    const report = registry.buildReport();
    const inner = report.effects.find((effect) => effect.label === 'stink.inner')!;
    expect(inner.spawns).toBe(0);
    expect(inner.qualityDrops).toBeGreaterThan(0);
    expect(inner.capacityDrops).toBe(0);
  });

  it('routes inner and plume to the additive lane for electric and void variants', () => {
    const { registry, particles, normal, add } = setup();
    addCloud(particles, 1, 'electric');
    addCloud(particles, 2, 'spore_void');
    addCloud(particles, 3, 'stink');

    for (const id of [1, 2, 3]) particles.syncCloud(id, 100 * id, 200, 180, 1, 0, true);
    registry.update(50);

    // Nur die eine gewoehnliche Wolke schickt inner und plume auf die NORMAL-Lane.
    expect(normal.edited.length).toBe(4);
    // Zwei additive Wolken vollstaendig (2 x 12) plus accent und edge der gewoehnlichen (8).
    expect(add.edited.length).toBe(32);

    // Die logische Statistik bleibt davon unberuehrt: drei Wolken, gleiche Zahl je Familie.
    expect(spawnsOf(registry, 'stink.inner')).toBe(6);
    expect(spawnsOf(registry, 'stink.plume')).toBe(6);
    expect(spawnsOf(registry, 'stink.accent')).toBe(6);
    expect(spawnsOf(registry, 'stink.edge')).toBe(18);
  });

  it('takes the per-family tint of the cloud variant', () => {
    const { registry, particles, normal, add } = setup();
    addCloud(particles, 1);

    frame(particles, registry, 50);

    expect(membersWithTint(normal.members, TINT.inner).length).toBe(2);
    expect(membersWithTint(normal.members, TINT.plume).length).toBe(2);
    expect(membersWithTint(add.members, TINT.accent).length).toBe(2);
    expect(membersWithTint(add.members, TINT.edge).length).toBe(6);
  });

  it('walks the edge zone points in order around the current radius', () => {
    // `edgeZone(target, 56)` verteilt 56 Punkte gleichmaessig auf dem Kreisrand; Phasers
    // EdgeZone laeuft sie der Reihe nach ab, beginnend bei Index 0.
    const { registry, particles, add } = setup();
    addCloud(particles, 1);

    frame(particles, registry, 50);

    const edgeMembers = membersWithTint(add.members, TINT.edge);
    const target = Math.max(180 * 0.86, 12);
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 56) * Math.PI * 2;
      expect(edgeMembers[i].x.base).toBeCloseTo(400 + Math.cos(angle) * target, 8);
      expect(edgeMembers[i].y.base).toBeCloseTo(300 + Math.sin(angle) * target, 8);
    }
  });

  it('spawns at the current cloud position and never edits a member again', () => {
    const { registry, particles, add } = setup();
    addCloud(particles, 1);

    particles.syncCloud(1, 400, 300, 180, 1, 0, true);
    registry.update(50);
    const firstBatch = membersWithTint(add.members, TINT.edge).length;
    expect(firstBatch).toBeGreaterThan(0);

    // Wolke wandert; neue Puffs starten dort, alte bleiben in Weltkoordinaten stehen.
    particles.syncCloud(1, 900, 300, 180, 1, 0, true);
    registry.update(50);

    const edgeMembers = membersWithTint(add.members, TINT.edge);
    const target = Math.max(180 * 0.86, 12);
    const distanceTo = (index: number, cx: number) =>
      Math.hypot(edgeMembers[index].x.base - cx, edgeMembers[index].y.base - 300);
    for (let i = 0; i < firstBatch; i += 1) expect(distanceTo(i, 400)).toBeCloseTo(target, 8);
    for (let i = firstBatch; i < edgeMembers.length; i += 1) {
      expect(distanceTo(i, 900)).toBeCloseTo(target, 8);
    }

    // Kein Slot wurde zweimal bespielt, es gab also kein Nach-Editieren.
    expect(new Set(add.edited).size).toBe(add.edited.length);
  });

  it('holds emission and does not catch up while the ablation suppresses gpu particles', () => {
    const { registry, particles, add } = setup();
    addCloud(particles, 1);

    frame(particles, registry, 50);
    const before = add.edited.length;
    expect(before).toBeGreaterThan(0);

    registry.setSuppressed(true);
    for (let f = 0; f < 40; f += 1) frame(particles, registry, 50);
    expect(add.edited.length).toBe(before);
    expect(add.visible).toBe(false);

    registry.setSuppressed(false);
    frame(particles, registry, 50);
    // Genau ein Frame Emission, kein Nachholen der 40 unterdrueckten Frames.
    expect(add.edited.length - before).toBe(8);
  });

  it('releases exactly the members of a removed cloud', () => {
    const { registry, particles, normal, add } = setup();
    addCloud(particles, 1);
    addCloud(particles, 2);

    for (const id of [1, 2]) particles.syncCloud(id, 100 * id, 200, 180, 1, 0, true);
    registry.update(50);
    expect(add.edited.length).toBe(16);
    expect(normal.edited.length).toBe(8);

    particles.releaseCloud(1);
    // Nur die Member der einen Wolke, ueber beide Lanes hinweg.
    expect(add.patched.length).toBe(8);
    expect(normal.patched.length).toBe(4);
    expect(registry.getStats()?.['stink-add'].liveCount).toBe(8);

    // Die entfernte Wolke emittiert nicht mehr.
    particles.syncCloud(2, 200, 200, 180, 1, 0, true);
    registry.update(50);
    expect(add.edited.length).toBe(16 + 8);
  });

  it('releases members left behind in the other blend lane after a variant switch', () => {
    const { registry, particles, normal, add } = setup();
    addCloud(particles, 1, 'stink');
    frame(particles, registry, 50);
    expect(normal.edited.length).toBe(4);

    // Variantenwechsel: das Wolkenbild wird neu aufgebaut, registerCloud raeumt vorher auf.
    particles.registerCloud(1, 'electric', TINTS);
    expect(normal.patched.length).toBe(4);

    const beforeAdd = add.edited.length;
    frame(particles, registry, 50);
    // Jetzt landen inner und plume ebenfalls additiv.
    expect(add.edited.length - beforeAdd).toBe(12);
    expect(normal.edited.length).toBe(4);
  });

  it('clears every cloud on teardown', () => {
    const { registry, particles, normal, add } = setup();
    addCloud(particles, 1);
    addCloud(particles, 2);
    for (const id of [1, 2]) particles.syncCloud(id, 100 * id, 200, 180, 1, 0, true);
    registry.update(50);

    particles.releaseAll();
    expect(add.patched.length).toBe(add.edited.length);
    expect(normal.patched.length).toBe(normal.edited.length);
    expect(registry.getStats()?.['stink-add'].liveCount).toBe(0);

    // Nach dem Teardown emittiert nichts mehr, bis wieder Wolken angemeldet werden.
    const spawned = add.edited.length;
    for (const id of [1, 2]) particles.syncCloud(id, 100 * id, 200, 180, 1, 0, true);
    registry.update(50);
    expect(add.edited.length).toBe(spawned);
  });

  it('drops spawns at the pool limit instead of overwriting living members', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry, particles, add } = setup();
    // Weit mehr Wolken, als die Kapazitaet in einer Lebenszeit traegt.
    for (let id = 1; id <= 60; id += 1) addCloud(particles, id);

    for (let f = 0; f < 12; f += 1) {
      for (let id = 1; id <= 60; id += 1) particles.syncCloud(id, 100, 200, 180, 1, 0, true);
      registry.update(50);
    }

    const stats = registry.getStats()?.['stink-add'];
    expect(stats!.liveCount).toBeLessThanOrEqual(stats!.capacity);
    expect(stats!.capacityDrops).toBeGreaterThan(0);
    // Jeder Edit gehoert zu genau einem Rearm: kein lebender Slot wurde ueberschrieben.
    expect(add.edited.length).toBe(stats!.rearms);
    warn.mockRestore();
  });
});
