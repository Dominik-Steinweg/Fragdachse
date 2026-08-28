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
import { BLOOD_HIT_VFX, COLORS, DEATH_DISINTEGRATION_VFX } from '../src/config';
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

function playFullDeath(
  sourceSize: number,
  displaySize = 32,
  overrides: Partial<typeof death> = {},
  isPlayerDeath = false,
) {
  const { scene, renderer, gpu } = setup();
  const textureKey = `full_death_${sourceSize}_${displaySize}`;
  addVisualTexture(scene, textureKey, 'walk-1', sourceSize, sourceSize);
  renderer.playDeath({
    ...death,
    textureKey,
    frame: 'walk-1',
    displayWidth: displaySize,
    displayHeight: displaySize,
    rotation: 0,
    dirX: 0,
    dirY: 0,
    ...overrides,
  }, isPlayerDeath);

  const report = gpu.buildReport();
  const mainCount = report.effects.find((effect) => effect.label === 'death.fragment')!.spawns;
  const microCount = report.effects.find((effect) => effect.label === 'death.micro-fragment')!.spawns;
  const fragmentGlow = report.effects.find((effect) => effect.label === 'death.fragment-glow')!;
  const gore = findFakeLane(scene, 'gore-normal').members;
  const main = gore.slice(0, mainCount);
  const micro = gore.slice(mainCount, mainCount + microCount);
  const glow = findFakeLane(scene, 'gore-add').members;
  const template = renderer.fragmentTemplateCache.get(textureKey, 'walk-1');
  return {
    displaySize, fragmentGlow, glow, main, mainCount, micro, microCount, renderer, report, template,
  };
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

  it('renders both idle frame 0 and a running frame through the death burst path', () => {
    for (const sample of [
      { frame: 0, textureFrame: '0' },
      { frame: 'walk-4', textureFrame: 'walk-4' },
    ] as const) {
      const { scene, renderer, gpu } = setup();
      const textureKey = `player_death_${sample.textureFrame}`;
      addVisualTexture(scene, textureKey, sample.textureFrame, 64, 64);

      renderer.playDeath({
        ...death,
        targetId: `player-${sample.textureFrame}`,
        textureKey,
        frame: sample.frame,
        displayWidth: 32,
        displayHeight: 32,
        rotation: 0,
      });

      const report = gpu.buildReport();
      expect(report.effects.find((effect) => effect.label === 'death.fragment')!.spawns)
        .toBeGreaterThan(0);
      expect(report.effects.find((effect) => effect.label === 'death.glow')!.spawns)
        .toBeGreaterThan(0);
      expect(renderer.fragmentTemplateCache.size).toBe(1);
    }
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
    const xRange = Math.max(...members.map((member) => evaluateFakeAnimation(member.x, 0)))
      - Math.min(...members.map((member) => evaluateFakeAnimation(member.x, 0)));
    const yRange = Math.max(...members.map((member) => evaluateFakeAnimation(member.y, 0)))
      - Math.min(...members.map((member) => evaluateFakeAnimation(member.y, 0)));

    expect(main.spawns).toBeGreaterThan(0);
    expect(xRange).toBeGreaterThan(20);
    expect(yRange).toBeGreaterThan(20);
  });

  it('keeps primary death fragments large and readable without an absolute luminance gate', () => {
    const sample = playFullDeath(64);
    const primary = sample.main[0]!;

    expect(evaluateFakeAnimation(primary.scaleY, 0)).toBeGreaterThan(1.4);
    expect(primary.scaleY.duration).toBeGreaterThanOrEqual(
      DEATH_DISINTEGRATION_VFX.durationMs - 80,
    );
    expect(primary.alpha.ease).toBe('Cubic.easeIn');
    expect(primary.frameAnimation).toMatchObject({
      name: 'death-disintegration',
      amplitude: 6,
      loop: false,
      yoyo: false,
    });
  });

  it('holds cohesion through 400 ms, then accelerates into the directed release', () => {
    const sample = playFullDeath(64, 32, { dirX: 1, dirY: 0 });
    const primary = sample.main[0]!;
    const lifeMs = primary.x.duration;
    const at = (animation: typeof primary.x, ms: number) => (
      evaluateFakeAnimation(animation, ms / lifeMs)
    );
    const startX = at(primary.x, 0);
    const startY = at(primary.y, 0);
    const cohesionTravel = Math.hypot(
      at(primary.x, 400) - startX,
      at(primary.y, 400) - startY,
    );
    const releaseTravel = Math.hypot(
      at(primary.x, 900) - startX,
      at(primary.y, 900) - startY,
    );

    expect(lifeMs).toBeGreaterThanOrEqual(1280);
    expect(lifeMs).toBeLessThanOrEqual(1420);
    expect(primary.x.ease).toBe('Cubic.easeIn');
    expect(cohesionTravel).toBeLessThan(9);
    expect(releaseTravel).toBeGreaterThan(cohesionTravel * 6);
    expect(evaluateFakeAnimation(primary.alpha, 400 / lifeMs)).toBeGreaterThan(0.94);
    expect(Math.abs(
      evaluateFakeAnimation(primary.rotation, 400 / lifeMs)
        - evaluateFakeAnimation(primary.rotation, 0),
    )).toBeLessThan(0.12);
  });

  it('uses 32–48 dominant fragments and only decorative fine-dust accents', () => {
    const normal = playFullDeath(64, 32);
    const large = playFullDeath(128, 72);

    expect(normal.mainCount).toBeGreaterThanOrEqual(32);
    expect(normal.mainCount).toBeLessThanOrEqual(48);
    expect(large.mainCount).toBe(48);
    expect(normal.micro.length).toBeGreaterThan(0);
    expect(normal.micro.every((member) => (
      member.frame === 'death-morph-dust' || member.frame === 'death-morph-fine-dust'
    ))).toBe(true);
    expect(normal.micro.every((member) => member.frameAnimation === null)).toBe(true);
    expect(normal.micro.every((member) => evaluateFakeAnimation(member.alpha, 0) < 0.5)).toBe(true);
    expect(normal.micro.every((member) => member.alpha.duration >= 1050)).toBe(true);
  });

  it('keeps death morphing deterministic for seed, texture and frame', () => {
    const first = playFullDeath(64, 32, { seed: 0xdecafbad, dirX: 0.8, dirY: -0.2 });
    const second = playFullDeath(64, 32, { seed: 0xdecafbad, dirX: 0.8, dirY: -0.2 });
    const summarize = (sample: typeof first) => sample.main.map((member) => ({
      x: evaluateFakeAnimation(member.x, 0),
      y: evaluateFakeAnimation(member.y, 0),
      travelX: member.x.amplitude,
      travelY: member.y.amplitude,
      life: member.x.duration,
      tint: member.tint,
      animation: member.frameAnimation?.name,
    }));

    expect(summarize(first)).toEqual(summarize(second));
  });

  it('keeps the template analysis on fixed 4x4 source blocks', () => {
    const { scene, renderer } = setup();

    for (const sourceSize of [32, 64, 128]) {
      const textureKey = `analysis_${sourceSize}`;
      addVisualTexture(scene, textureKey, 'walk-1', sourceSize, sourceSize);
      const template = renderer.fragmentTemplateCache.get(textureKey, 'walk-1');
      const first = template.chunks[0]!;

      expect(template.chunks).toHaveLength((sourceSize / 4) ** 2);
      expect(first.offsetX).toBeCloseTo(2 / sourceSize - 0.5, 10);
      expect(first.offsetY).toBeCloseTo(2 / sourceSize - 0.5, 10);
      expect(first.width).toBeCloseTo(4 / sourceSize, 10);
      expect(first.height).toBeCloseTo(4 / sourceSize, 10);
      expect(first.color).toBe(0x78281e);
      expect(first.brightness).toBeCloseTo((120 + 40 + 30) / (255 * 3), 10);
    }
  });

  it('normalizes visible fragment size across 32x32, 64x64 and 128x128 sources', () => {
    const samples = [32, 64, 128].map((sourceSize) => playFullDeath(sourceSize));
    const reference = samples[0]!;
    const referenceHeight = evaluateFakeAnimation(reference.main[0]!.scaleY, 0);
    const referenceWidth = evaluateFakeAnimation(reference.main[0]!.scaleX, 0);

    for (const sample of samples) {
      expect(sample.mainCount).toBe(reference.mainCount);
      expect(sample.microCount).toBe(reference.microCount);
      expect(evaluateFakeAnimation(sample.main[0]!.scaleY, 0)).toBeCloseTo(referenceHeight, 10);
      expect(evaluateFakeAnimation(sample.main[0]!.scaleX, 0)).toBeCloseTo(referenceWidth, 10);
      expect(evaluateFakeAnimation(sample.main[0]!.x, 0)).toBeCloseTo(
        death.x + sample.template.chunks[0]!.offsetX * sample.displaySize,
        10,
      );
      expect(evaluateFakeAnimation(sample.main[0]!.y, 0)).toBeCloseTo(
        death.y + sample.template.chunks[0]!.offsetY * sample.displaySize,
        10,
      );
    }
  });

  it('scales normalized fragments with the actual display size', () => {
    const fullSize = playFullDeath(64, 32);
    const compact = playFullDeath(64, 24);
    const fullHeight = evaluateFakeAnimation(fullSize.main[0]!.scaleY, 0);
    const compactHeight = evaluateFakeAnimation(compact.main[0]!.scaleY, 0);

    expect(compactHeight / fullHeight).toBeCloseTo(24 / 32, 10);
  });

  it('keeps equal-size player and enemy deaths equally present', () => {
    const player = playFullDeath(64, 32, {
      targetId: 'player-1',
      targetColor: COLORS.GREEN_2,
      tint: 0xffffff,
    });
    const enemy = playFullDeath(32, 32, {
      targetId: 'enemy-1',
      targetColor: COLORS.GREEN_2,
      tint: 0xffffff,
    });

    expect(player.mainCount).toBe(enemy.mainCount);
    expect(player.microCount).toBe(enemy.microCount);
    expect(evaluateFakeAnimation(player.main[0]!.scaleY, 0)).toBeCloseTo(
      evaluateFakeAnimation(enemy.main[0]!.scaleY, 0),
      10,
    );
    expect(player.glow).toHaveLength(enemy.glow.length);
    expect(evaluateFakeAnimation(player.glow[0]!.scaleY, 0)).toBeCloseTo(
      evaluateFakeAnimation(enemy.glow[0]!.scaleY, 0),
      10,
    );
  });

  it('keeps player material fragments natural while targetColor changes only the glow layer', () => {
    const neutralTarget = playFullDeath(64, 32, {
      targetId: 'player-neutral',
      targetColor: 0xffffff,
      tint: 0xffffff,
    }, true);
    const coloredTarget = playFullDeath(64, 32, {
      targetId: 'player-colored',
      targetColor: COLORS.BLUE_2,
      tint: 0xffffff,
    }, true);

    expect(coloredTarget.main[0]!.tint).toBe(neutralTarget.main[0]!.tint);
    expect(coloredTarget.fragmentGlow.spawns).toBeGreaterThanOrEqual(8);
    expect(coloredTarget.fragmentGlow.spawns).toBeLessThanOrEqual(12);
    expect(coloredTarget.fragmentGlow.laneLabel).toBe('gore-add');
    expect(coloredTarget.report.lanes.filter((lane) => lane.label === 'gore-add')).toHaveLength(1);
    expect(coloredTarget.glow[0]!.tint).toBe(COLORS.BLUE_2);

    const selectedMainIndex = 0;
    const material = coloredTarget.main[selectedMainIndex]!;
    const colorGlow = coloredTarget.glow[0]!;
    expect(evaluateFakeAnimation(colorGlow.x, 0)).toBeCloseTo(
      evaluateFakeAnimation(material.x, 0),
      10,
    );
    expect(evaluateFakeAnimation(colorGlow.y, 0)).toBeCloseTo(
      evaluateFakeAnimation(material.y, 0),
      10,
    );
    expect(colorGlow.x.amplitude).toBeCloseTo(material.x.amplitude, 10);
    expect(colorGlow.y.amplitude).toBeCloseTo(material.y.amplitude, 10);
    expect(colorGlow.rotation.base).toBeCloseTo(material.rotation.base, 10);
    expect(evaluateFakeAnimation(colorGlow.alpha, 0))
      .toBeCloseTo(DEATH_DISINTEGRATION_VFX.playerFragmentGlowAlpha, 10);
    expect(evaluateFakeAnimation(colorGlow.scaleY, 0) * 24)
      .toBeGreaterThan(evaluateFakeAnimation(material.scaleY, 0) * 4);
  });

  it('does not add player fragment glows to enemy deaths and keeps enemy tinting', () => {
    const neutral = playFullDeath(64, 32, {
      targetColor: 0xffffff,
      tint: 0xffffff,
    });
    const colored = playFullDeath(64, 32, {
      targetColor: COLORS.RED_2,
      tint: 0xffffff,
    });

    expect(neutral.fragmentGlow.spawns).toBe(0);
    expect(colored.fragmentGlow.spawns).toBe(0);
    expect(colored.main[0]!.tint).not.toBe(neutral.main[0]!.tint);
  });

  it('quality-scales the additional player glow without exceeding the selected main fragments', () => {
    qualityFactors.standard = 0.35;
    const sample = playFullDeath(64, 32, {
      targetId: 'player-quality',
      targetColor: COLORS.BLUE_2,
      tint: 0xffffff,
    }, true);

    expect(sample.fragmentGlow.spawns).toBeGreaterThan(0);
    expect(sample.fragmentGlow.spawns).toBeLessThan(10);
    expect(sample.fragmentGlow.capacityDrops).toBe(0);
  });

  it('keeps targetColor influence measurable for neutral sprite tint', () => {
    const neutral = playFullDeath(64, 32, {
      targetColor: 0xffffff,
      tint: 0xffffff,
    });
    const colored = playFullDeath(64, 32, {
      targetColor: COLORS.RED_2,
      tint: 0xffffff,
    });

    expect((colored.main[0]!.tint >> 8) & 0xff)
      .toBeLessThan((neutral.main[0]!.tint >> 8) & 0xff);
    expect(colored.main[0]!.tint & 0xff)
      .toBeLessThan(neutral.main[0]!.tint & 0xff);
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
