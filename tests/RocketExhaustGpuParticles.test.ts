import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Math: {
    FloatBetween: (min: number, max: number) => min + Math.random() * (max - min),
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
    Easing: { Quadratic: { Out: (t: number) => t * (2 - t) } },
  },
}));

const qualityFactors = { critical: 1, standard: 1, decorative: 1 };
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: qualityFactors }),
    subscribe: () => () => {},
  }),
}));

import { RocketRenderer } from '../src/effects/RocketRenderer';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GPU_VFX_LANES } from '../src/effects/gpu/GpuVfxRenderLanes';
import { DEPTH } from '../src/config';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function setup() {
  const scene = makeFakeGpuVfxScene();
  const registry = new GpuVfxSystem(scene as never);
  const renderer = new RocketRenderer(scene as never);
  renderer.generateTextures();
  renderer.registerGpuVfx(registry);
  return {
    scene,
    registry,
    renderer,
    exhaust: findFakeLane(scene, 'rocket-exhaust'),
    smoke: findFakeLane(scene, 'rocket-smoke'),
  };
}

function spawnRocket(renderer: RocketRenderer, id: number): void {
  renderer.createVisual(id, 100, 100, 10, 0xff0000, 0x00ff00, 0x888888);
}

beforeEach(() => {
  resetGpuVfxAtlasForTests();
  qualityFactors.standard = 1;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rocket exhaust gpu particles', () => {
  it('uses a single shared lane for every rocket', () => {
    const { scene, registry, renderer, exhaust } = setup();
    // Die Lanes entstehen aus dem Manifest, nicht je Rakete.
    expect(scene.layers.length).toBe(GPU_VFX_LANES.length);
    // Alle Lanes teilen sich den Atlas; das Motiv steckt im Frame des Members.
    expect(exhaust.key).toBe('__gpu_vfx_atlas');

    for (let id = 1; id <= 12; id += 1) spawnRocket(renderer, id);
    registry.update(100);
    expect(scene.layers.length).toBe(GPU_VFX_LANES.length);
    expect(exhaust.members.every((member) => member.frame === 'rocket-exhaust')).toBe(true);
  });

  it('creates no ParticleEmitter for the flight visuals any more', () => {
    // Weder pro Rakete noch geteilt: Exhaust und Smoke laufen beide ueber GPU-Layer. Klassische
    // Emitter entstehen nur noch in den Einmal-Bursts von playCollection/playSpentDestruction.
    const { renderer, scene } = setup();
    expect(scene.emitters.length).toBe(0);
    for (let id = 1; id <= 5; id += 1) spawnRocket(renderer, id);
    expect(scene.emitters.length).toBe(0);
  });

  it('primes the lane and sits additively just above the rocket body', () => {
    const { exhaust } = setup();
    expect(exhaust.blendMode).toBe(1);
    expect(exhaust.enabledEases).toEqual(['Linear']);
    expect(exhaust.added).toBe(exhaust.size);
    // Ueber Body und Engine (DEPTH.PROJECTILES), aber unter dem Accent (+1).
    expect(exhaust.depth).toBeGreaterThan(DEPTH.PROJECTILES);
    expect(exhaust.depth).toBeLessThan(DEPTH.PROJECTILES + 1);
  });

  it('emits on the 14 ms flow the old emitter used on high quality', () => {
    const { registry, renderer, exhaust } = setup();
    spawnRocket(renderer, 1);

    registry.update(13);
    expect(exhaust.edited.length).toBe(0);
    registry.update(1);
    expect(exhaust.edited.length).toBe(1);

    // 70 ms weiter sind bei 14 ms Takt genau fuenf zusaetzliche Partikel faellig.
    registry.update(70);
    expect(exhaust.edited.length).toBe(6);
  });

  it('keeps the GraphicsQuality frequency scaling of the old emitter', () => {
    // `applyEmitterProfile` streckte das Intervall ueber `particleFactors.standard`:
    // medium 0.65 -> round(14 / 0.65) = 22 ms.
    qualityFactors.standard = 0.65;
    const { registry, renderer, exhaust } = setup();
    spawnRocket(renderer, 1);

    registry.update(21);
    expect(exhaust.edited.length).toBe(0);
    registry.update(1);
    expect(exhaust.edited.length).toBe(1);
  });

  it('stops emitting when the quality profile zeroes the particle factor', () => {
    qualityFactors.standard = 0;
    const { registry, renderer, exhaust } = setup();
    spawnRocket(renderer, 1);

    for (let frame = 0; frame < 30; frame += 1) registry.update(16);
    expect(exhaust.edited.length).toBe(0);
  });

  it('spawns at the current tail position and never touches a member again', () => {
    const { registry, renderer, exhaust } = setup();
    spawnRocket(renderer, 1);

    registry.update(14);
    expect(exhaust.edited).toEqual([0]);

    // Die Rakete bewegt sich weiter; bereits gespawnte Member bekommen kein Update.
    renderer.updateVisual(1, 400, 100, 10, 200, 0);
    registry.update(14);
    expect(exhaust.edited).toEqual([0, 1]);
    expect(exhaust.patched).toEqual([]);
  });

  it('hides the exhaust of a destroyed rocket and stops its emission', () => {
    const { registry, renderer, exhaust } = setup();
    spawnRocket(renderer, 1);
    spawnRocket(renderer, 2);
    registry.update(100);
    const spawned = exhaust.edited.length;
    expect(spawned).toBeGreaterThan(0);

    renderer.destroyVisual(1);
    const hidden = exhaust.patched.length;
    expect(hidden).toBeGreaterThan(0);
    expect(hidden).toBeLessThan(spawned);

    // Die entfernte Rakete emittiert nicht mehr, die verbliebene schon.
    registry.update(100);
    expect(exhaust.edited.length).toBeGreaterThan(spawned);
  });

  it('drops spawns instead of overwriting living members when the pool is full', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry, renderer, exhaust } = setup();
    // Weit mehr Raketen, als die Kapazitaet bei 140 ms Lebenszeit gleichzeitig traegt.
    for (let id = 1; id <= 400; id += 1) spawnRocket(renderer, id);

    for (let frame = 0; frame < 40; frame += 1) registry.update(16);

    const stats = registry.getStats();
    const exhaustStats = stats?.['rocket-exhaust'];
    expect(exhaustStats).toBeDefined();
    expect(exhaustStats!.liveCount).toBeLessThanOrEqual(exhaustStats!.capacity);
    // Kein Slot wurde doppelt vergeben: jeder Edit gehoert zu genau einem Rearm.
    expect(exhaust.edited.length).toBe(exhaustStats!.rearms);
    warn.mockRestore();
  });

  it('releases every exhaust member on destroyAll', () => {
    const { registry, renderer, exhaust } = setup();
    spawnRocket(renderer, 1);
    spawnRocket(renderer, 2);
    registry.update(100);
    const spawned = exhaust.edited.length;

    renderer.destroyAll();
    expect(exhaust.patched.length).toBe(spawned);
    expect(registry.getStats()?.['rocket-exhaust'].liveCount).toBe(0);
  });
});
