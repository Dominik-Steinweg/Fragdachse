import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Math: {
    FloatBetween: (min: number, max: number) => min + Math.random() * (max - min),
    DegToRad: (degrees: number) => degrees * Math.PI / 180,
  },
}));

const qualityFactors = { critical: 1, standard: 1, decorative: 1 };
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: qualityFactors }),
    subscribe: () => () => {},
  }),
}));

import { ExplosionGpuRenderer } from '../src/effects/ExplosionGpuRenderer';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

beforeEach(() => {
  resetGpuVfxAtlasForTests();
  qualityFactors.critical = 1;
  qualityFactors.standard = 1;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('explosion gpu renderer', () => {
  it('uses GPU burst lanes for every migrated explosion family', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new ExplosionGpuRenderer();
    renderer.registerGpuVfx(system);

    renderer.spawnTimebombPop(100, 100, 40, 0xb82fff);
    renderer.spawnStandardSpark(100, 100, 5, 300, 600, 50, 120, 1.2, 0.9, [0xffffff]);
    renderer.spawnEnergyArc(100, 100, 80, 6, [0xffffff, 0x73bed3]);
    renderer.spawnEmber(100, 100, 4, 500, 1000, 20, 60, 0.8, 0.2, 0.7, [0xff4400], 40);
    renderer.spawnCascadeSparks(100, 100, 80, 7, [0xffffff]);
    renderer.spawnHolyCrown(100, 100, 80, 8);
    renderer.spawnNuke(100, 100, 750, 3, 2, 4, 5);
    renderer.spawnTrainExplosion(100, 100, 80, 0xffaa44, 0xfff0b8);
    renderer.spawnLightning(100, 100, 80, 6, 0x78dfff, 0xffffff, 0x3557d6);
    renderer.spawnRegeneration(100, 100, 40, 8, 0x55ff88, 0xccffee);

    expect(scene.emitters).toHaveLength(0);
    expect(findFakeLane(scene, 'explosion-spark').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-ember-down').edited.length).toBe(4);
    expect(findFakeLane(scene, 'explosion-ember-up').edited.length).toBe(2);
    expect(findFakeLane(scene, 'explosion-accent').edited.length).toBe(9 + 6);
    expect(findFakeLane(scene, 'explosion-cascade').edited.length).toBe(7);
    expect(findFakeLane(scene, 'explosion-train-chunk').edited.length).toBe(84);
    expect(findFakeLane(scene, 'explosion-train-spark').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-holy-crown').edited.length).toBe(8);
    expect(findFakeLane(scene, 'explosion-train-core').edited.length).toBe(31);
    expect(findFakeLane(scene, 'explosion-nuke-plume').edited.length).toBe(4);
    expect(findFakeLane(scene, 'explosion-nuke-fallout').edited.length).toBe(5);
    expect(findFakeLane(scene, 'explosion-regeneration').edited.length).toBe(8);
  });

  it('keeps gravity variants in their compatible GPU lanes', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new ExplosionGpuRenderer();
    renderer.registerGpuVfx(system);

    renderer.spawnEmber(10, 20, 1, 500, 500, 20, 20, 1, 0, 1, [0xffffff], 40);
    renderer.spawnEmber(10, 20, 1, 500, 500, 20, 20, 1, 0, 1, [0xffffff], -20);

    expect(findFakeLane(scene, 'explosion-ember-down').gravity).toBe(40);
    expect(findFakeLane(scene, 'explosion-ember-up').gravity).toBe(-180);
    expect(findFakeLane(scene, 'explosion-ember-down').edited).toHaveLength(1);
    expect(findFakeLane(scene, 'explosion-ember-up').edited).toHaveLength(1);
  });
});
