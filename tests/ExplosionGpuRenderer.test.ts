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
import { findFakeLane, makeFakeGpuVfxScene, evaluateFakeAnimation } from './fakeGpuVfxScene';
import { MortarMuzzleVfx } from '../src/effects/MortarMuzzleVfx';

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
  it('runs the mortar through the shared combat chain with delayed secondary and smoke stages', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new ExplosionGpuRenderer();
    renderer.registerGpuVfx(system);
    renderer.spawnCombatExplosion({ x: 20, y: 30, radius: 117, style: 'mortar',
      palette: { core: 0xffffff, hot: 0xbb66ff, body: 0x9922ee, outer: 0x552277, ember: 0x443322, smoke: 0x302830 } });
    expect(scene.layers.flatMap(lane => lane.members).length).toBeGreaterThan(0);
    expect(renderer.getPendingStageCount()).toBeGreaterThan(0);
    expect(scene.emitters).toHaveLength(0);
  });

  it('cleans muzzle particles independently of the dead source and honours the quality budget', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const muzzle = new MortarMuzzleVfx(system);
    const release = vi.spyOn(system, 'releaseSource');
    const charge = muzzle.createCharge();
    muzzle.chargeAt(charge, 0, 0, 1, 0xbb66ff);
    muzzle.thump(0, 0, 0xbb66ff, 0x443355, 0);
    muzzle.release(charge);
    expect(release).toHaveBeenCalledTimes(1);
    system.update(1600); muzzle.update();
    expect(release).toHaveBeenCalledTimes(2);
    muzzle.clear();
    expect(release).toHaveBeenCalledTimes(2);
    system.destroy();
    qualityFactors.standard = 0;
    const quietScene = makeFakeGpuVfxScene();
    const quietSystem = new GpuVfxSystem(quietScene as never);
    const quiet = new MortarMuzzleVfx(quietSystem);
    quiet.thump(0, 0, 0xbb66ff, 0x443355, 0);
    expect(quietScene.layers.flatMap(lane => lane.edited)).toHaveLength(0);
    quiet.clear(); quietSystem.destroy();
  });

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

  it('renders the ASMD combo as a pure energy discharge without fire, debris or smoke', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new ExplosionGpuRenderer();
    renderer.registerGpuVfx(system);

    const palette = {
      core: 0xf4e8ff, hot: 0xd09cff, body: 0xa04dff,
      outer: 0x3a1f66, ember: 0x2a1748, smoke: 0x1d1a30,
    };
    renderer.spawnCombatExplosion({ x: 100, y: 100, radius: 100, style: 'asmd_combo', palette });

    const edited = scene.layers.filter((layer) => layer.edited.length > 0).map((layer) => layer.name);
    expect(edited).toEqual(['explosion-spark']);
    // Nur die beiden verzögerten Ausstoßwellen; kein Rauch- oder Sekundärballen-Stage.
    expect(renderer.getPendingStageCount()).toBe(2);
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
