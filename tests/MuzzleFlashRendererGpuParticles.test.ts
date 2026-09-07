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

import { DEPTH, VOID_FIRE_COLOR, MUZZLE_FLASH_VFX } from '../src/config';
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


import { resolveMuzzleProfile, MUZZLE_MAX_LIFETIME, type MuzzleFlashPreset } from '../src/effects/muzzleFlashModel';

describe('muzzle flash GPU presentation', () => {
  it('follows animated weapon recoil on a stationary owner and releases the flash after an item switch', () => {
    const { renderer, system, lane } = setup();
    const weapon = { x: 120, y: 100, rotation: Math.PI / 2, itemId: 'GLOCK' };
    renderer.setOwnerVisualSource({ getOwnerVisualState: () => null,
      readOwnerRenderPose: (_id, out) => { Object.assign(out, { x: 100, y: 100, rotation: Math.PI / 2 }); return true; },
      readOwnerHeldWeaponPose: (_id, out) => { Object.assign(out, weapon); return true; },
    });
    renderer.playProjectileFlash(120, 100, 1, 0, 'bullet', 'glock', undefined, undefined, 'shooter');
    system.update(1);
    const before = lane.patched.length;
    weapon.x -= 3;
    weapon.rotation += 0.02;
    system.update(1);
    expect(lane.patched.length - before).toBe(2);
    const active = system.buildReport().lanes.find(l => l.label === 'muzzle-flash')!.active;
    weapon.itemId = 'AWP';
    system.update(1);
    expect(system.buildReport().lanes.find(l => l.label === 'muzzle-flash')!.active).toBe(active - 2);
  });

  it('falls back to an unbound burst when tracking is full and reuses entries after teardown', () => {
    const { renderer, system, lane } = setup();
    qualityFactors.standard = 0;
    let x = 0;
    renderer.setOwnerVisualSource({ getOwnerVisualState: () => null,
      readOwnerRenderPose: (_id, out) => { out.x = x; out.y = 0; out.rotation = 0; return true; } });
    for (let i = 0; i < 129; i++) renderer.playHitscanFlash(10, 0, 1, 0, 'default', undefined, String(i));
    expect(lane.members).toHaveLength(258);
    x = 10; system.update(1);
    expect(lane.patched).toHaveLength(256);
    renderer.clear();
    expect(system.buildReport().lanes.find(l => l.label === 'muzzle-flash')!.active).toBe(2);
    system.releaseAll();
    renderer.playHitscanFlash(10, 0, 1, 0, 'default', undefined, 'new-world');
    const before = lane.patched.length;
    x = 20; system.update(1);
    expect(lane.patched.length - before).toBe(2);
  });

  it.each([Math.PI / 2, Math.PI, -Math.PI / 2])('follows the visible owner pose at rotation %f without touching sparks or animation time', (rotation) => {
    const { renderer, system, lane } = setup();
    const pose = { x: 100, y: 100, rotation: 0 };
    renderer.setOwnerVisualSource({ getOwnerVisualState: () => null,
      readOwnerRenderPose: (_id, out) => { Object.assign(out, pose); return true; } });
    renderer.playProjectileFlash(120, 104, 1, 0, 'bullet', 'ak47', undefined, undefined, 'a');
    const patches: { index: number; values: Float32Array; mask: number[] }[] = [];
    vi.spyOn(lane, 'patchMember').mockImplementation((index, data, mask) => {
      patches.push({ index, values: new Float32Array(data.buffer.slice(0)), mask: [...mask!] });
    });
    system.update(10);
    expect(patches).toHaveLength(0);
    pose.x = 200; pose.y = 150; pose.rotation = rotation;
    system.update(10);
    expect(patches).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const body = lane.members[i], patch = patches[i];
      expect(patch.mask).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 1]);
      expect(patch.values[8]).toBeCloseTo(rotation);
      for (const t of [0.1, 0.5, 0.9]) {
        const scale = evaluateFakeAnimation(body.scaleX, t);
        const x = evaluateFakeAnimation({ ...body.x, base: patch.values[0], amplitude: patch.values[1] }, t);
        const y = evaluateFakeAnimation({ ...body.y, base: patch.values[4], amplitude: patch.values[5] }, t);
        expect(x - 14 * scale * Math.cos(rotation)).toBeCloseTo(200 + 20 * Math.cos(rotation) - 4 * Math.sin(rotation), 4);
        expect(y - 14 * scale * Math.sin(rotation)).toBeCloseTo(150 + 20 * Math.sin(rotation) + 4 * Math.cos(rotation), 4);
      }
    }
    system.update(10);
    expect(patches).toHaveLength(2);
  });

  it('ends attached bodies when the owner disappears and leaves sparks alive', () => {
    const { renderer, system, lane } = setup();
    let visible = true;
    renderer.setOwnerVisualSource({ getOwnerVisualState: () => null,
      readOwnerRenderPose: (_id, out) => { Object.assign(out, { x: 0, y: 0, rotation: 0 }); return visible; } });
    renderer.playHitscanFlash(10, 0, 1, 0, 'asmd_primary', undefined, 'a');
    visible = false; system.update(1);
    expect(lane.patched).toEqual([0, 1]);
    expect(system.buildReport().lanes.find(l => l.label === 'muzzle-flash')!.active).toBe(resolveMuzzleProfile('asmd_primary').sparkCount);
    visible = true;
    renderer.playProjectileFlash(10, 0, 1, 0, 'gauss', undefined, undefined, undefined, 'b');
    renderer.clear();
    expect(lane.patched).toHaveLength(4);
    system.update(MUZZLE_MAX_LIFETIME + 1);
    expect(system.buildReport().lanes.find(l => l.label === 'muzzle-flash')!.active).toBe(0);
  });

  it('derives the existing light pulse from the same AK profile', () => {
    const { renderer } = setup();
    const pulse = vi.fn();
    renderer.setLightingSystem({ pulse } as never);
    renderer.playProjectileFlash(10, 20, 1, 0, 'bullet', 'ak47', undefined, 0xffcc88);
    const profile = resolveMuzzleProfile('ak47');
    expect(pulse).toHaveBeenCalledWith('muzzleFlash', 10, 20, {
      color: 0xffcc88, radiusPx: profile.lightRadius,
      intensity: profile.lightIntensity, durationMs: profile.lightDuration,
    });
  });

  it('uses existing GPU members without per-shot Phaser objects', () => {
    const { scene, renderer, lane } = setup();
    const image = vi.spyOn(scene.add, 'image'), particles = vi.spyOn(scene.add, 'particles');
    const tween = vi.spyOn(scene.tweens, 'add'), timer = vi.spyOn(scene.time, 'delayedCall');
    renderer.playProjectileFlash(10, 20, 1, 0, 'bullet', 'ak47');
    expect(image).not.toHaveBeenCalled(); expect(particles).not.toHaveBeenCalled();
    expect(tween).not.toHaveBeenCalled(); expect(timer).not.toHaveBeenCalled();
    expect(lane.members).toHaveLength(2 + resolveMuzzleProfile('ak47').sparkCount);
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])('anchors both growing bodies at the muzzle at angle %f', (angle) => {
    const { renderer, lane } = setup();
    renderer.playProjectileFlash(100, 120, Math.cos(angle), Math.sin(angle), 'bullet', 'ak47');
    expect(lane.depth).toBe(DEPTH.PROJECTILES + 2 + GPU_VFX_DEPTH_EPSILON);
    expect(lane.blendMode).toBe(1);
    for (const body of lane.members.slice(0, 2)) {
      expect(body.frame).toBe('muzzle-flash');
      for (const t of [0, 0.25, 0.5, 0.9]) {
        const scale = evaluateFakeAnimation(body.scaleX, t);
        expect(evaluateFakeAnimation(body.x, t) - Math.cos(angle) * 14 * scale).toBeCloseTo(100, 6);
        expect(evaluateFakeAnimation(body.y, t) - Math.sin(angle) * 14 * scale).toBeCloseTo(120, 6);
      }
      expect(evaluateFakeAnimation(body.alpha, 0.25)).toBeGreaterThan(evaluateFakeAnimation(body.alpha, 0) * 0.8);
    }
  });

  it('preserves daylight contrast, energy motifs and Void palette overrides', () => {
    const { renderer, lane } = setup();
    setEmissiveScale(0);
    renderer.playHitscanFlash(0, 0, 1, 0, 'asmd_primary');
    const dayAlpha = evaluateFakeAnimation(lane.members[0].alpha, 0);
    expect(lane.members[0].frame).toBe('muzzle-energy');
    const count = lane.members.length;
    setEmissiveScale(1);
    renderer.playProjectileFlash(0, 0, 1, 0, 'gauss');
    expect(lane.members[count].frame).toBe('muzzle-energy');
    expect(dayAlpha).toBeGreaterThan(0.7);
    const start = lane.members.length;
    renderer.playProjectileFlash(0, 0, 1, 0, 'flame', undefined, undefined, VOID_FIRE_COLOR);
    expect(lane.members[start].tint).toBe(VOID_FIRE_COLOR);
    expect(lane.members.slice(start + 2).every(m => [0xffffff, 0xdfb2ff, VOID_FIRE_COLOR].includes(m.tint))).toBe(true);
  });

  it('keeps long sparks directed away from the actual muzzle', () => {
    const { renderer, lane } = setup();
    renderer.playProjectileFlash(10, 20, 0, -1, 'bullet', 'ak47');
    for (const spark of lane.members.slice(2)) {
      expect(spark.frame).toBe('muzzle-spark');
      expect(spark.x.base).toBe(10); expect(spark.y.base).toBe(20);
      expect(spark.y.amplitude).toBeLessThan(0);
      expect(spark.rotation.base).toBeCloseTo(-Math.PI / 2);
      expect(spark.scaleX.base).toBeGreaterThan(spark.scaleY.base * 2);
      expect(evaluateFakeAnimation(spark.scaleY, 0.5)).toBeGreaterThan(spark.scaleY.base * 0.5);
      expect(spark.alpha.duration).toBeGreaterThan(lane.members[0].alpha.duration);
    }
  });

  it('scales and reports optional sparks without removing critical bodies', () => {
    const { renderer, system, lane } = setup();
    qualityFactors.standard = 0;
    renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'p90');
    expect(lane.members).toHaveLength(2);
    const spark = system.buildReport().effects.find(e => e.label === 'muzzleFlash.spark')!;
    expect(spark.qualityDrops).toBe(resolveMuzzleProfile('p90').sparkCount);
    qualityFactors.standard = 0.35;
    const reduced = setup();
    reduced.renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'p90');
    reduced.renderer.playProjectileFlash(0, 0, 1, 0, 'bullet', 'p90');
    expect(reduced.lane.members.length).toBe(2 * (2 + Math.round(resolveMuzzleProfile('p90').sparkCount * 0.35)));
  });

  it('separates shooters, suppresses rapid retriggers including light, and clears on teardown', () => {
    const { renderer, system, scene } = setup();
    const pulse = vi.fn();
    renderer.setLightingSystem({ pulse } as never);
    const fire = (owner: string, x = 0) => renderer.playProjectileFlash(x, 0, 1, 0, 'bullet', 'negev', undefined, undefined, owner);
    fire('a'); fire('a', 100); fire('b');
    expect(pulse).toHaveBeenCalledTimes(2);
    const light = { ...pulse.mock.calls[0][3] };
    expect(light.durationMs).toBeLessThanOrEqual(resolveMuzzleProfile('negev').outerDuration);
    system.update(60); scene.time.now += 60;
    fire('a');
    expect(pulse).toHaveBeenCalledTimes(3);
    renderer.clear(); fire('a');
    expect(pulse).toHaveBeenCalledTimes(4);
  });

  it.each(['p90', 'negev'] as const)('bounds twelve simultaneous %s streams and retires every member', (preset) => {
    const { renderer, system } = setup();
    let poseTime = 0;
    renderer.setOwnerVisualSource({ getOwnerVisualState: () => null,
      readOwnerRenderPose: (id, out) => {
        out.x = Number(id.slice(6)) * 30 + poseTime; out.y = poseTime; out.rotation = poseTime / 100;
        return true;
      } });
    const interval = preset === 'p90' ? 80 : 60;
    for (let time = 0; time < 3000; time += 20) {
      poseTime = time;
      system.update(20);
      if (time % interval === 0) for (let source = 0; source < 12; source++) {
        renderer.playProjectileFlash(source * 30, 0, 1, 0, 'bullet', preset, undefined, undefined, 'player' + source);
      }
    }
    const report = system.buildReport();
    expect(report.effects.find(e => e.label === 'muzzleFlash.body')!.capacityDrops).toBe(0);
    expect(report.lanes.find(l => l.label === 'muzzle-flash')!.highWaterMark).toBeLessThanOrEqual(1024);
    system.update(MUZZLE_MAX_LIFETIME + 1);
    expect(system.buildReport().lanes.find(l => l.label === 'muzzle-flash')!.active).toBe(0);
  });
});

describe('muzzle tuning model', () => {
  it('keeps the ballistic hierarchy and energy proportions', () => {
    for (const preset of ['glock', 'p90', 'negev'] as const) expect(resolveMuzzleProfile(preset).scaleX).toBeLessThan(resolveMuzzleProfile('ak47').scaleX);
    expect(resolveMuzzleProfile('shotgun').scaleX).toBeGreaterThan(resolveMuzzleProfile('ak47').scaleX);
    expect(resolveMuzzleProfile('awp').scaleX).toBeGreaterThan(resolveMuzzleProfile('shotgun').scaleX);
    for (const preset of ['gauss', 'asmd_primary', 'energy', 'plasma'] as const) expect(resolveMuzzleProfile(preset).useEnergyCore).toBe(true);
  });
  it('offers independent time, intensity and spark controls with finite upper bounds', () => {
    const base = resolveMuzzleProfile('ak47');
    const longer = resolveMuzzleProfile('ak47', { ...MUZZLE_FLASH_VFX, muzzleFlashDuration: 300 });
    expect(longer.duration).toBeGreaterThan(base.duration);
    expect(longer.scaleX).toBe(base.scaleX);
    expect(resolveMuzzleProfile('ak47', { ...MUZZLE_FLASH_VFX, muzzleFlashIntensity: 0 }).alpha).toBe(0);
    expect(resolveMuzzleProfile('ak47', { ...MUZZLE_FLASH_VFX, muzzleFlashIntensity: 0 }).lightIntensity).toBe(0);
    expect(resolveMuzzleProfile('ak47', { ...MUZZLE_FLASH_VFX, muzzleFlashSparkStrength: 0 }).sparkCount).toBe(0);
    for (const preset of ['ak47', 'awp', 'gauss', 'asmd_primary', 'p90', 'negev'] as MuzzleFlashPreset[]) {
      const cfg = resolveMuzzleProfile(preset, { muzzleFlashIntensity: Infinity, muzzleFlashDuration: 10000, muzzleFlashSparkStrength: NaN });
      expect(Number.isFinite(cfg.scaleX)).toBe(true);
      expect(cfg.sparkLifeMax).toBeLessThanOrEqual(MUZZLE_MAX_LIFETIME);
    }
  });
});
