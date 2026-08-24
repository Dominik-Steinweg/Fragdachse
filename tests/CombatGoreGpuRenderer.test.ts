import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
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

import { CombatGoreGpuRenderer } from '../src/effects/CombatGoreGpuRenderer';
import { BLOOD_HIT_VFX } from '../src/config';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { evaluateFakeAnimation, findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

interface CanvasStats {
  drawCalls: number;
  imageReads: number;
}

function makeCanvasFactory(stats: CanvasStats) {
  return (width: number, height: number) => ({
    width,
    height,
    getContext: () => ({
      clearRect: () => {},
      drawImage: () => { stats.drawCalls += 1; },
      getImageData: () => {
        stats.imageReads += 1;
        const data = new Uint8ClampedArray(width * height * 4);
        for (let index = 0; index < data.length; index += 4) {
          data[index] = 120;
          data[index + 1] = 40;
          data[index + 2] = 30;
          data[index + 3] = 255;
        }
        return { data };
      },
    }),
  }) as unknown as HTMLCanvasElement;
}

function setup() {
  resetGpuVfxAtlasForTests();
  const scene = makeFakeGpuVfxScene();
  const source = scene.textures.createCanvas('zombie_badger', 8, 8);
  source.add('walk-2', 0, 0, 0, 8, 8);
  const gpu = new GpuVfxSystem(scene as never);
  const stats: CanvasStats = { drawCalls: 0, imageReads: 0 };
  const renderer = new CombatGoreGpuRenderer(scene as never, makeCanvasFactory(stats));
  renderer.registerGpuVfx(gpu);
  return { scene, renderer, stats, gpu };
}

function addVisualTexture(
  scene: ReturnType<typeof makeFakeGpuVfxScene>,
  key: string,
  frame = '__BASE',
  width = 64,
  height = 64,
) {
  const texture = scene.textures.createCanvas(key, width, height);
  if (frame !== '__BASE') texture.add(frame, 0, 0, 0, width, height);
  return texture;
}

const death = {
  type: 'death' as const,
  x: 320,
  y: 240,
  targetId: 'enemy-1',
  targetColor: 0x8d2429,
  textureKey: 'zombie_badger',
  frame: 'walk-2',
  displayWidth: 64,
  displayHeight: 48,
  rotation: Math.PI / 2,
  tint: 0x6aa0c8,
  dirX: 1,
  dirY: 0,
  seed: 0x12345678,
};

describe('combat gore gpu renderer', () => {
  afterEach(() => {
    qualityFactors.critical = 1;
    qualityFactors.standard = 1;
    qualityFactors.decorative = 1;
  });

  it('reuses one normalized visual template for repeated frames and emits no CPU objects', () => {
    const { scene, renderer, stats } = setup();

    renderer.playDeath(death);
    renderer.playDeath({ ...death, targetId: 'enemy-2', x: 420 });

    expect(renderer.fragmentTemplateCache.size).toBe(1);
    expect(stats.drawCalls).toBe(1);
    expect(stats.imageReads).toBe(1);
    expect(scene.objects).toHaveLength(0);
    expect(findFakeLane(scene, 'gore-normal').members.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'gore-add').members.length).toBeGreaterThan(0);
  });

  it('accepts static, animated, large and allied visual snapshots through one renderer', () => {
    const { scene, renderer, stats } = setup();
    addVisualTexture(scene, 'badger');
    addVisualTexture(scene, 'badger_walking', 'walk-4');
    addVisualTexture(scene, 'enemy_rabid_badger');
    addVisualTexture(scene, 'enemy_grave_titan');

    renderer.playDeath({ ...death, textureKey: 'badger', frame: '__BASE', displayWidth: 32, displayHeight: 32 });
    renderer.playDeath({
      ...death,
      textureKey: 'badger_walking',
      frame: 'walk-4',
      displayWidth: 32,
      displayHeight: 32,
      rotation: -0.4,
      tint: 0xe6a2d0,
    });
    renderer.playDeath({ ...death, textureKey: 'enemy_rabid_badger', frame: '__BASE', displayWidth: 22, displayHeight: 22 });
    renderer.playDeath({
      ...death,
      textureKey: 'enemy_grave_titan',
      frame: '__BASE',
      displayWidth: 68,
      displayHeight: 68,
      tint: 0x89d66d,
    });
    // Allied entities reuse the same captured frame and therefore the same analysis cache entry.
    renderer.playDeath({ ...death, targetId: 'allied-1', tint: 0x89d66d });

    expect(renderer.fragmentTemplateCache.size).toBe(5);
    expect(stats.drawCalls).toBe(5);
    expect(stats.imageReads).toBe(5);
    expect(findFakeLane(scene, 'gore-normal').members.length).toBeGreaterThan(100);
    expect(scene.objects).toHaveLength(0);
  });

  it('keeps blood deterministic and separates killshot details through the shared lanes', () => {
    const { scene, renderer } = setup();
    const stains: number[] = [];
    const hit = {
      type: 'hit' as const,
      x: 100,
      y: 120,
      targetId: 'enemy-1',
      totalDamage: 52,
      hpLost: 52,
      armorLost: 0,
      isKill: true,
      isCritical: true,
      dirX: 1,
      dirY: 0,
      seed: 42,
    };

    renderer.playHit(hit, (...args) => stains.push(args[7]));

    expect(stains.length).toBeGreaterThan(0);
    expect(findFakeLane(scene, 'gore-normal').members.length).toBeGreaterThan(10);
    expect(scene.objects).toHaveLength(0);
  });

  it('drops decorative micro-details before critical silhouette members under quality pressure', () => {
    qualityFactors.standard = 0.35;
    qualityFactors.decorative = 0;
    const { renderer, gpu } = setup();

    renderer.playDeath(death);

    const report = gpu.buildReport();
    const main = report.effects.find((effect) => effect.label === 'death.fragment')!;
    const micro = report.effects.find((effect) => effect.label === 'death.micro-fragment')!;
    const glow = report.effects.find((effect) => effect.label === 'death.glow')!;
    expect(main.spawns).toBeGreaterThan(0);
    expect(micro.qualityDrops).toBeGreaterThan(0);
    expect(glow.qualityDrops).toBeGreaterThan(0);
  });

  it('keeps the complete death silhouette distributed when quality reduces main fragments', () => {
    qualityFactors.critical = 0.35;
    qualityFactors.standard = 0;
    qualityFactors.decorative = 0;
    const { scene, renderer, gpu } = setup();
    addVisualTexture(scene, 'full_animated_badger', 'walk-1', 64, 64);

    renderer.playDeath({
      ...death,
      textureKey: 'full_animated_badger',
      frame: 'walk-1',
      displayWidth: 32,
      displayHeight: 32,
      rotation: 0,
    });

    const report = gpu.buildReport();
    const main = report.effects.find((effect) => effect.label === 'death.fragment')!;
    const members = findFakeLane(scene, 'gore-normal').members.slice(0, main.spawns);
    const xRange = Math.max(...members.map((member) => member.x.base))
      - Math.min(...members.map((member) => member.x.base));
    const yRange = Math.max(...members.map((member) => member.y.base))
      - Math.min(...members.map((member) => member.y.base));

    expect(main.spawns).toBeGreaterThan(0);
    expect(xRange).toBeGreaterThan(20);
    expect(yRange).toBeGreaterThan(20);
  });

  it('applies the lethal hit direction to both death fragments and glow', () => {
    const directed = setup();
    const radial = setup();
    const radialDeath = { ...death, dirX: 0, dirY: 0 };

    directed.renderer.playDeath(death);
    radial.renderer.playDeath(radialDeath);

    const directedMain = directed.gpu.buildReport().effects
      .find((effect) => effect.label === 'death.fragment')!.spawns;
    const directedFragments = findFakeLane(directed.scene, 'gore-normal').members.slice(0, directedMain);
    const radialFragments = findFakeLane(radial.scene, 'gore-normal').members.slice(0, directedMain);
    const mainImpulse = directedFragments.reduce(
      (sum, member, index) => sum + member.x.amplitude - radialFragments[index]!.x.amplitude,
      0,
    ) / directedFragments.length;

    const directedGlow = findFakeLane(directed.scene, 'gore-add').members;
    const radialGlow = findFakeLane(radial.scene, 'gore-add').members;
    const glowImpulse = directedGlow.reduce(
      (sum, member, index) => sum + member.x.amplitude - radialGlow[index]!.x.amplitude,
      0,
    ) / directedGlow.length;

    expect(mainImpulse).toBeGreaterThan(20);
    expect(glowImpulse).toBeGreaterThan(20);
  });

  it('restores aggressive killshot scale, travel and high-quality stain count', () => {
    const normal = setup();
    const killshot = setup();
    const normalStains: number[] = [];
    const killshotStains: number[] = [];
    const hit = {
      type: 'hit' as const,
      x: 100,
      y: 120,
      targetId: 'enemy-1',
      totalDamage: 52,
      hpLost: 52,
      armorLost: 0,
      isKill: false,
      isCritical: true,
      dirX: 1,
      dirY: 0,
      seed: 0xdecafbad,
    };

    normal.renderer.playHit(hit, (...args) => normalStains.push(args[2]));
    killshot.renderer.playHit({ ...hit, isKill: true }, (...args) => killshotStains.push(args[2]));

    const normalMembers = findFakeLane(normal.scene, 'gore-normal').members;
    const killshotMembers = findFakeLane(killshot.scene, 'gore-normal').members;
    const normalCoreScale = evaluateFakeAnimation(normalMembers[0]!.scaleY, 0);
    const killshotCoreScale = evaluateFakeAnimation(killshotMembers[0]!.scaleY, 0);
    const normalStreakScale = evaluateFakeAnimation(normalMembers[1]!.scaleY, 0);
    const killshotStreakScale = evaluateFakeAnimation(killshotMembers[1]!.scaleY, 0);
    const normalStreakTravel = Math.hypot(normalMembers[1]!.x.amplitude, normalMembers[1]!.y.amplitude);
    const killshotStreakTravel = Math.hypot(killshotMembers[1]!.x.amplitude, killshotMembers[1]!.y.amplitude);

    expect(killshotCoreScale / normalCoreScale).toBeGreaterThanOrEqual(2.2);
    expect(killshotStreakScale / normalStreakScale).toBeGreaterThanOrEqual(1.6);
    expect(killshotStreakTravel / normalStreakTravel).toBeGreaterThanOrEqual(2.0);
    expect(killshotStains.length).toBeGreaterThanOrEqual(normalStains.length);
    expect(killshotStains.length).toBeGreaterThanOrEqual(BLOOD_HIT_VFX.bands.heavy.stainCountMin);
    expect(killshotStains[0]).toBeGreaterThan(normalStains[0]! * 1.8);
  });
});
