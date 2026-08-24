import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    FloatBetween: (min: number, max: number) => min + Math.random() * (max - min),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
  },
}));

const qualityFactors = { critical: 1, standard: 1, decorative: 1 };
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: qualityFactors }),
    subscribe: () => () => {},
  }),
}));

import { DEPTH, VOID_FIRE_COLOR } from '../src/config';
import { setEmissiveScale } from '../src/effects/EmissiveScale';
import { MuzzleFlashRenderer } from '../src/effects/MuzzleFlashRenderer';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { GPU_VFX_DEPTH_EPSILON } from '../src/effects/gpu/GpuVfxRenderLanes';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { evaluateFakeAnimation, findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function setup() {
  const scene = makeFakeGpuVfxScene();
  const system = new GpuVfxSystem(scene as never);
  const renderer = new MuzzleFlashRenderer(scene as never);
  renderer.registerGpuVfx(system);
  renderer.generateTextures();
  return { scene, system, renderer, lane: findFakeLane(scene, 'muzzle-flash') };
}

beforeEach(() => {
  resetGpuVfxAtlasForTests();
  qualityFactors.critical = 1;
  qualityFactors.standard = 1;
  qualityFactors.decorative = 1;
  setEmissiveScale(1);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('muzzle flash renderer gpu particles', () => {
  it('spawns no short-lived Phaser image, tween, emitter or cleanup timer', () => {
    const { scene, renderer, lane } = setup();
    const image = vi.spyOn(scene.add, 'image');
    const particles = vi.spyOn(scene.add, 'particles');
    const tween = vi.spyOn(scene.tweens, 'add');
    const delayedCall = vi.spyOn(scene.time, 'delayedCall');

    renderer.playProjectileFlash(100, 120, 1, 0, 'bullet', 'p90', undefined, 0x123456);

    expect(image).not.toHaveBeenCalled();
    expect(particles).not.toHaveBeenCalled();
    expect(tween).not.toHaveBeenCalled();
    expect(delayedCall).not.toHaveBeenCalled();
    expect(scene.objects).toHaveLength(0);
    expect(scene.emitters).toHaveLength(0);
    expect(lane.members).toHaveLength(8);
  });

  it('keeps body rotation, anisotropic scale growth, alpha fade and the additive lane contract', () => {
    const { renderer, lane } = setup();
    renderer.playProjectileFlash(100, 120, 0, 1, 'bullet', 'p90');

    const core = lane.members[0];
    const outer = lane.members[1];
    expect(lane.depth).toBe(DEPTH.PROJECTILES + 2 + GPU_VFX_DEPTH_EPSILON);
    expect(lane.blendMode).toBe(1);
    expect(lane.enabledEases).toEqual(expect.arrayContaining(['Linear', 'Quad.easeOut']));
    for (const body of [core, outer]) {
      expect(body.frame).toBe('muzzle-flash');
      expect(body.x.base).toBeCloseTo(100, 10);
      expect(body.y.base).toBeCloseTo(120 + 14 * 0.95, 10);
      expect(body.rotation.base).toBeCloseTo(Math.PI / 2, 10);
    }
    expect(core.scaleY.base).toBeCloseTo(0.58, 10);
    expect(core.scaleY.amplitude).toBeCloseTo(0.58 * 0.35, 10);
    expect(core.scaleX.base).toBeCloseTo(0.95, 10);
    expect(core.scaleX.amplitude).toBeCloseTo(0.95 * 0.35, 10);
    expect(core.scaleY.ease).toBe('Quad.easeOut');
    expect(evaluateFakeAnimation(core.alpha, 0)).toBeCloseTo(0.58, 10);
    expect(core.alpha.amplitude).toBeCloseTo(-0.58, 10);
    expect(core.alpha.ease).toBe('Quad.easeOut');
    expect(outer.scaleY.base).toBeCloseTo(0.58 * 1.35, 10);
    expect(outer.scaleY.amplitude).toBeCloseTo(0.58 * 1.35 * 0.12, 10);
    expect(outer.scaleX.base).toBeCloseTo(0.95 * 1.35, 10);
    expect(outer.scaleX.amplitude).toBeCloseTo(0.95 * 1.35 * 0.12, 10);
    expect(outer.scaleY.ease).toBe('Linear');
    expect(outer.alpha.base).toBeCloseTo(0.58 * 0.48, 10);
    expect(outer.alpha.amplitude).toBeCloseTo(-0.58 * 0.48, 10);
    expect(outer.alpha.ease).toBe('Linear');
    expect(outer.tintBlend.base).toBeCloseTo(0.42, 10);
    expect(outer.tintBlend.amplitude).toBeCloseTo(0.58, 10);
  });

  it('selects the old flash and energy motifs for every public preset path', () => {
    const cases: Array<(renderer: MuzzleFlashRenderer) => void> = [
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'default'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'glock'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'xbow'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'p90'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'ak47'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'shotgun'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'awp'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'gauss'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'negev'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'rocket'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'flame'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'energy_ball', undefined, 'default'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'energy_ball', undefined, 'plasma'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'hydra'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'bfg'),
      (renderer) => renderer.playProjectileFlash(0, 0, 1, 0, 'gauss'),
      (renderer) => renderer.playHitscanFlash(0, 0, 1, 0, 'default'),
      (renderer) => renderer.playHitscanFlash(0, 0, 1, 0, 'asmd_primary'),
    ];
    const expectedFrames = [
      'muzzle-flash', 'muzzle-flash', 'muzzle-flash', 'muzzle-flash', 'muzzle-flash',
      'muzzle-flash', 'muzzle-flash', 'muzzle-energy', 'muzzle-flash', 'muzzle-flash',
      'muzzle-flash', 'muzzle-energy', 'muzzle-energy', 'muzzle-energy', 'muzzle-energy',
      'muzzle-energy', 'muzzle-flash', 'muzzle-energy',
    ];
    const expectedSparkCounts = [5, 4, 2, 6, 8, 10, 11, 12, 7, 8, 5, 8, 8, 8, 8, 12, 5, 14];

    // Each case builds an independent atlas/system so the first member is the body.
    cases.forEach((play, index) => {
      const scene = makeFakeGpuVfxScene();
      const system = new GpuVfxSystem(scene as never);
      const renderer = new MuzzleFlashRenderer(scene as never);
      renderer.registerGpuVfx(system);
      play(renderer);
      const lane = findFakeLane(scene, 'muzzle-flash');
      expect(lane.members[0].frame).toBe(expectedFrames[index]);
      expect(lane.members[1].frame).toBe(expectedFrames[index]);
      expect(lane.members).toHaveLength(2 + expectedSparkCounts[index]);
    });
  });

  it('preserves Void-Flame body and spark tint semantics', () => {
    const { renderer, lane } = setup();
    renderer.playProjectileFlash(0, 0, 1, 0, 'flame', undefined, undefined, VOID_FIRE_COLOR);

    const tintValues = new Set(lane.members.slice(2).map((member) => member.tint));
    expect(lane.members[0].tint).toBe(VOID_FIRE_COLOR);
    expect(lane.members[1].tint).toBe(VOID_FIRE_COLOR);
    expect([...tintValues].every((tint) => [0xffffff, 0xdfb2ff, VOID_FIRE_COLOR].includes(tint))).toBe(true);
  });

  it('keeps spark count, lifetime, direction, speed, scale and alpha semantics', () => {
    const { renderer, lane } = setup();
    renderer.playProjectileFlash(10, 20, 0, -1, 'bullet', 'p90');

    const sparks = lane.members.slice(2);
    expect(sparks).toHaveLength(6);
    for (const spark of sparks) {
      expect(spark.frame).toBe('muzzle-spark');
      expect(spark.x.base).toBe(10);
      expect(spark.y.base).toBe(20);
      expect(spark.x.amplitude).toBeCloseTo(0, 10);
      expect(spark.y.amplitude).toBeCloseTo(-54 * 93 / 1000, 10);
      expect(spark.rotation.base).toBeCloseTo(-Math.PI / 2, 10);
      expect(spark.scaleY.base).toBeCloseTo(0.6, 10);
      expect(spark.scaleY.amplitude).toBeCloseTo(-0.56, 10);
      expect(spark.scaleX.base).toBeGreaterThan(0.6);
      expect(spark.alpha.base).toBeCloseTo(0.82, 10);
      expect(spark.alpha.amplitude).toBeCloseTo(-0.82, 10);
      expect(spark.scaleY.duration).toBeGreaterThanOrEqual(50);
      expect(spark.scaleY.duration).toBeLessThanOrEqual(120);
    }
    expect(sparks[0].scaleY.duration).toBe(93);
  });

  it('keeps the critical body visible while standard spark quality scales and reports drops', () => {
    const { system, renderer, lane } = setup();
    qualityFactors.standard = 0;
    renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'p90');

    expect(lane.members).toHaveLength(2);
    const report = system.buildReport();
    expect(report.effects.find((effect) => effect.label === 'muzzleFlash.body')?.spawns).toBe(2);
    expect(report.effects.find((effect) => effect.label === 'muzzleFlash.spark')?.spawns).toBe(0);
    expect(report.effects.find((effect) => effect.label === 'muzzleFlash.spark')?.qualityDrops).toBe(6);
  });

  it('uses discrete burst rounding without carrying quality between shots', () => {
    const { system, renderer, lane } = setup();
    qualityFactors.standard = 0.35;
    renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'p90');
    renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'p90');

    // round(6 * 0.35) = 2 for each independent explode-style burst; no second shot inherits a
    // fractional remainder from the first one.
    expect(lane.members).toHaveLength(8);
    const report = system.buildReport();
    expect(report.effects.find((effect) => effect.label === 'muzzleFlash.body')?.spawns).toBe(4);
    expect(report.effects.find((effect) => effect.label === 'muzzleFlash.spark')?.spawns).toBe(4);
    expect(report.effects.find((effect) => effect.label === 'muzzleFlash.spark')?.qualityDrops).toBe(8);
  });

  it('keeps body and sparks as separate profiler effects on one lane', () => {
    const { system, renderer } = setup();
    renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'p90');

    const report = system.buildReport();
    const body = report.effects.find((effect) => effect.label === 'muzzleFlash.body')!;
    const sparks = report.effects.find((effect) => effect.label === 'muzzleFlash.spark')!;
    expect(body.spawns).toBe(2);
    expect(sparks.spawns).toBe(6);
    expect(body.laneLabel).toBe('muzzle-flash');
    expect(sparks.laneLabel).toBe('muzzle-flash');
  });
});
