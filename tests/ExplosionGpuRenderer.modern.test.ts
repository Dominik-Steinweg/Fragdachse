import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Math: { FloatBetween: (min: number, max: number) => min + Math.random() * (max - min) },
}));

const qualityFactors = { critical: 1, standard: 1, decorative: 1 };
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: qualityFactors }),
    subscribe: () => () => {},
  }),
}));

import { ExplosionGpuRenderer, type ExplosionCombatPalette } from '../src/effects/ExplosionGpuRenderer';
import type { CombatExplosionVisualStyle } from '../src/effects/ExplosionVisualProfiles';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

const PALETTE: ExplosionCombatPalette = {
  core: 0xffffff, hot: 0xffd272, body: 0xff5a20,
  outer: 0x8f2510, ember: 0x5a170a, smoke: 0x332d30,
};

function setup() {
  const scene = makeFakeGpuVfxScene();
  const system = new GpuVfxSystem(scene as never);
  const renderer = new ExplosionGpuRenderer();
  renderer.registerGpuVfx(system);
  return { scene, system, renderer };
}

function spawn(renderer: ExplosionGpuRenderer, style: CombatExplosionVisualStyle = 'default', radius = 96) {
  renderer.spawnCombatExplosion({ x: 100, y: 120, radius, style, palette: PALETTE });
}

beforeEach(() => {
  resetGpuVfxAtlasForTests();
  qualityFactors.critical = 1;
  qualityFactors.standard = 1;
  qualityFactors.decorative = 1;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => vi.restoreAllMocks());

describe('explosion gpu renderer', () => {
  it('builds the impact from structured frames and velocity-aligned streaks', () => {
    const { scene, renderer } = setup();
    spawn(renderer);

    expect(scene.emitters).toHaveLength(0);
    const body = findFakeLane(scene, 'explosion-ember-down').members;
    expect(body.some((member) => member.frame === 'explosion-core')).toBe(true);
    expect(body.some((member) => member.frame === 'explosion-fireball-a')).toBe(true);
    expect(body.some((member) => member.frame === 'explosion-fireball-b')).toBe(true);
    expect(body.some((member) => member.frame === 'explosion-chunk')).toBe(true);
    expect(body.some((member) => member.tintBlend.amplitude > 0)).toBe(true);

    const streak = findFakeLane(scene, 'explosion-spark').members[0];
    expect(streak.frame).toBe('explosion-streak');
    expect(streak.rotation.base).toBeCloseTo(Math.PI);
    expect(streak.scaleX.base).not.toBe(streak.scaleY.base);
    expect(streak.tintBlend.amplitude).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-accent').members[0].frame).toBe('explosion-ring');
  });

  it('stages secondary fireballs at 70 ms and smoke at 140 ms', () => {
    const { scene, system, renderer } = setup();
    spawn(renderer);
    const body = findFakeLane(scene, 'explosion-ember-down');
    const smoke = findFakeLane(scene, 'explosion-smoke');
    const impactCount = body.edited.length;

    expect(renderer.getPendingStageCount()).toBe(2);
    system.update(69);
    expect(body.edited.length).toBe(impactCount);
    system.update(1);
    expect(body.edited.length).toBeGreaterThan(impactCount);
    expect(smoke.edited).toHaveLength(0);
    system.update(70);
    expect(smoke.edited.length).toBeGreaterThanOrEqual(3);
    expect(renderer.getPendingStageCount()).toBe(0);
  });

  it('adds the mini-rocket cascade accent at 90 ms', () => {
    const { scene, system, renderer } = setup();
    spawn(renderer, 'mini_rocket_cascade', 64);
    const cascade = findFakeLane(scene, 'explosion-cascade');
    system.update(89);
    expect(cascade.edited).toHaveLength(0);
    system.update(1);
    expect(cascade.edited.length).toBeGreaterThanOrEqual(8);
  });

  it('covers every destructive style family without CPU emitters', () => {
    const { scene, renderer } = setup();
    const styles: CombatExplosionVisualStyle[] = [
      'default', 'rocket', 'mini_rocket', 'mini_rocket_cascade', 'energy', 'timebomb',
      'timebomb_pop', 'holy', 'lightning', 'train', 'nuke', 'void_nuke',
    ];
    for (const style of styles) spawn(renderer, style, style === 'nuke' || style === 'void_nuke' ? 180 : 72);

    expect(scene.emitters).toHaveLength(0);
    expect(findFakeLane(scene, 'explosion-holy-crown').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-train-chunk').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-nuke-plume').edited.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'explosion-train-spark').edited.length).toBeGreaterThan(0);
  });

  it('adds only ring and directed GPU streaks to the specialized lightning geometry', () => {
    const { scene, renderer } = setup();
    spawn(renderer, 'lightning', 90);
    expect(findFakeLane(scene, 'explosion-ember-down').edited).toHaveLength(0);
    expect(findFakeLane(scene, 'explosion-train-spark').members.every(
      (member) => member.frame === 'explosion-streak',
    )).toBe(true);
    expect(findFakeLane(scene, 'explosion-accent').members[0].frame).toBe('explosion-ring');
  });

  it('preserves the critical core and ring on low while removing decorative smoke', () => {
    qualityFactors.standard = 0.35;
    qualityFactors.decorative = 0;
    const { scene, system, renderer } = setup();
    spawn(renderer);
    system.update(140);

    expect(findFakeLane(scene, 'explosion-ember-down').members.some((member) => member.frame === 'explosion-core')).toBe(true);
    expect(findFakeLane(scene, 'explosion-accent').members.some((member) => member.frame === 'explosion-ring')).toBe(true);
    expect(findFakeLane(scene, 'explosion-smoke').edited).toHaveLength(0);
    expect(findFakeLane(scene, 'explosion-spark').edited.length).toBeLessThan(32);
  });

  it('bounds pending stages, clears them, and discards stale ablation work', () => {
    const { scene, system, renderer } = setup();
    for (let index = 0; index < 180; index += 1) spawn(renderer, 'default', 48);
    expect(renderer.getPendingStageCount()).toBe(256);
    // Ein Kaskadenakzent verdraengt bei voller Queue zuerst Rauch/Standardlagen.
    spawn(renderer, 'mini_rocket_cascade', 64);
    system.update(90);
    expect(findFakeLane(scene, 'explosion-cascade').edited.length).toBeGreaterThan(0);
    renderer.clearPending();
    expect(renderer.getPendingStageCount()).toBe(0);

    spawn(renderer, 'default', 72);
    const before = findFakeLane(scene, 'explosion-smoke').edited.length;
    system.setSuppressed(true);
    system.update(300);
    system.setSuppressed(false);
    system.update(1);
    expect(renderer.getPendingStageCount()).toBe(0);
    expect(findFakeLane(scene, 'explosion-smoke').edited.length).toBe(before);
  });

  it('keeps regeneration as its own non-destructive GPU effect', () => {
    const { scene, renderer } = setup();
    renderer.spawnRegeneration(100, 100, 40, 8, 0x55ff88, 0xccffee);
    expect(findFakeLane(scene, 'explosion-regeneration').edited).toHaveLength(8);
  });
});
