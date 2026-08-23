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
  qualityFactors.decorative = 1;
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

    const palette = {
      core: 0xffffff, hot: 0xffdd88, body: 0xff5522,
      outer: 0x772211, ember: 0x441108, smoke: 0x30282a,
    };
    for (const style of ['timebomb_pop', 'default', 'energy', 'mini_rocket_cascade',
      'holy', 'nuke', 'train', 'lightning'] as const) {
      renderer.spawnCombatExplosion({ x: 100, y: 100, radius: 80, style, palette });
    }
    renderer.spawnRegeneration(100, 100, 40, 8, 0x55ff88, 0xccffee);

    expect(scene.emitters).toHaveLength(0);
    expect(findFakeLane(scene, 'explosion-spark').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-ember-down').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-ember-up').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-accent').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-train-chunk').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-train-spark').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-holy-crown').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-train-core').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-nuke-plume').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-regeneration').edited.length).toBe(8);
  });

  it('keeps gravity variants in their compatible GPU lanes', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new ExplosionGpuRenderer();
    renderer.registerGpuVfx(system);

    const palette = {
      core: 0xffffff, hot: 0xffdd88, body: 0xff5522,
      outer: 0x772211, ember: 0x441108, smoke: 0x30282a,
    };
    renderer.spawnCombatExplosion({ x: 10, y: 20, radius: 40, style: 'default', palette });
    renderer.spawnCombatExplosion({ x: 10, y: 20, radius: 40, style: 'holy', palette });

    expect(findFakeLane(scene, 'explosion-ember-down').gravity).toBe(40);
    expect(findFakeLane(scene, 'explosion-ember-up').gravity).toBe(-180);
    expect(findFakeLane(scene, 'explosion-ember-down').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-ember-up').edited.length).toBeGreaterThan(0);
  });
});
