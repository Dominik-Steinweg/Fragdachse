import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Geom: {
    Line: class Line {
      x1 = 0; y1 = 0; x2 = 0; y2 = 0;
      constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) { this.setTo(x1, y1, x2, y2); }
      setTo(x1: number, y1: number, x2: number, y2: number) {
        this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2; return this;
      }
    },
    Circle: class Circle {
      x = 0; y = 0; radius = 0;
      constructor(x = 0, y = 0, radius = 0) { this.setTo(x, y, radius); }
      setTo(x: number, y: number, radius: number) {
        this.x = x; this.y = y; this.radius = radius; return this;
      }
    },
    Rectangle: class Rectangle {
      x = 0; y = 0; width = 0; height = 0;
      constructor(x = 0, y = 0, width = 0, height = 0) { this.setTo(x, y, width, height); }
      setTo(x: number, y: number, width: number, height: number) {
        this.x = x; this.y = y; this.width = width; this.height = height; return this;
      }
    },
    Intersects: { GetLineToCircle: () => [] },
  },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
  },
}));

import { WEAPON_CONFIGS, type WeaponConfig } from '../../src/loadout/LoadoutConfig';
import { WeaponFireExecutor, type HitscanShotRequest, type MeleeSwingRequest } from '../../src/loadout/WeaponFireExecutor';
import { HeadlessSingleTargetWorld } from '../../src/debug/coopDefenseBalance/HeadlessSingleTargetWorld';
import { HeadlessStaticTargetWorld } from '../../src/debug/coopDefenseBalance/HeadlessStaticTargetWorld';
import {
  DEFAULT_FIVE_TARGET_SCENARIO_CONFIG,
  MELEE_FIVE_TARGET_SCENARIO_CONFIG,
} from '../../src/debug/coopDefenseBalance/scenarioTypes';
import { generateFiveTargetLayout } from '../../src/debug/coopDefenseBalance/fiveTargetLayout';
import { deriveBenchmarkSeeds } from '../../src/debug/coopDefenseBalance/benchmarkSeeds';
import {
  runWeaponFiveTargetBenchmark,
  runWeaponFiveTargetBenchmarkSet,
} from '../../src/debug/coopDefenseBalance/fiveTargetBenchmark';
import { runWeaponSingleTargetBenchmark } from '../../src/debug/coopDefenseBalance/weaponBenchmark';
import { analyzeWeaponFiveTargetProgression } from '../../src/debug/coopDefenseBalance/progressionAnalyzer';
import { validateWeaponBalanceCapabilities } from '../../src/debug/coopDefenseBalance/weaponCapabilityValidator';
import { resolveProjectileTargetImpact } from '../../src/combat/rules/ProjectileImpactResolver';
import { resolveFiveTargetAim } from '../../src/debug/coopDefenseBalance/fiveTargetAim';
import { headlessProjectileSpawnRequest } from '../HeadlessProjectileSpawnHelper';



function runLifetime(stepMs: number, lifetimeMs: number, hitTimeMs: number): HeadlessSingleTargetWorld {
  const world = new HeadlessSingleTargetWorld(150, 1, true);
  const collisionDistance = 150 - (world.target.radius + 1);
  world.spawnProjectile(headlessProjectileSpawnRequest(0, 0, 0, 'player', {
    speed: collisionDistance / (hitTimeMs / 1000),
    lifetimeMs,
  }));
  for (let now = 0; now < 250; now += stepMs) world.step(Math.min(stepMs, 250 - now));
  return world;
}

function fiveTargets(x = 40): readonly { id: string; x: number; y: number; radius: number }[] {
  return [
    { id: 'target_2', x, y: 0, radius: 16 },
    { id: 'target_1', x, y: 0, radius: 16 },
    { id: 'target_3', x, y: 20, radius: 16 },
    { id: 'target_4', x, y: -20, radius: 16 },
    { id: 'target_5', x: 80, y: 0, radius: 16 },
  ];
}

describe('Weapon Balance Lab V0.9 – Measurement Semantics & Static Five-Target Benchmark', () => {
  it('begrenzt Projektil-Sweeps auf die Lifetime und behandelt einen exakten Tie als Expiration', () => {
    expect(runLifetime(16, 110, 120).getHits()).toBe(0);
    expect(runLifetime(8, 110, 120).getHits()).toBe(0);
    expect(runLifetime(25, 110, 109).getHits()).toBe(1);
    expect(runLifetime(8, 110, 109).getHits()).toBe(1);
    expect(runLifetime(16, 110, 110).getHits()).toBe(0);
  });

  it('zaehlt Shots, Hits und Ressourcen primaer nur im Measurement Window', () => {
    const slowConfig: WeaponConfig = {
      id: 'SLOW_MEASUREMENT_GUN',
      cooldown: 500,
      damage: 100,
      range: 500,
      fire: { type: 'projectile', projectileSpeed: 100, projectileSize: 8, projectileMaxBounces: 0 },
      allowedSlots: ['weapon1'],
      adrenalinCost: 0,
      adrenalinGain: 10,
      spreadStanding: 0,
      spreadMoving: 0,
      spreadPerShot: 0,
      maxDynamicSpread: 0,
      spreadRecoveryDelay: 400,
      spreadRecoveryRate: 5,
      spreadRecoverySpeed: 100,
    };
    const result = runWeaponSingleTargetBenchmark({
      weaponId: slowConfig.id,
      weaponConfigOverride: slowConfig,
      sourceSlot: 'weapon1',
      durationMs: 100,
      targetDistance: 100,
      maxSettleDurationMs: 2000,
      scenarioConfig: {
        id: 'single_target_static.v1',
        version: 1,
        targetRadius: 16,
        targetDistance: 100,
        attackWindowMs: 100,
        warmupMs: 5000,
        settleLimitMs: 2000,
        triggerPolicy: 'spread_coverage_and_recovery',
        aimPolicy: 'target_center',
      },
    });

    expect(result.measurementShotsFired).toBe(1);
    expect(result.shotsFired).toBeGreaterThan(result.measurementShotsFired);
    expect(result.measurementTargetHits).toBe(0);
    expect(result.measurementProjectileHits).toBe(0);
    expect(result.measurementHitRate).toBe(0);
    expect(result.measurementAdrenalineGenerated).toBe(0);
    expect(result.adrenalineGenerated).toBeGreaterThan(0);
    expect(result.adrenalineGeneratedPerSec).toBe(0);
    expect(result.totalDamage).toBe(0);
    expect(result.tailDamage).toBeGreaterThan(0);

    const fiveTargetResult = runWeaponFiveTargetBenchmark({
      weaponId: slowConfig.id,
      weaponConfigOverride: slowConfig,
      sourceSlot: 'weapon1',
      durationMs: 100,
      stepDeltaMs: 16,
      maxSettleDurationMs: 2000,
      scenarioConfig: {
        ...DEFAULT_FIVE_TARGET_SCENARIO_CONFIG,
        attackWindowMs: 100,
        warmupMs: 5000,
        settleLimitMs: 2000,
      },
    });
    expect(fiveTargetResult.shotsFired).toBe(fiveTargetResult.measurementShotsFired);
    expect(fiveTargetResult.targetHits).toBe(1);
    expect(fiveTargetResult.adrenalineGenerated).toBe(10);
    expect(fiveTargetResult.damageYieldIncludingTail).toBeGreaterThan(0);
  });

  it('trennt Primary-Metric-Completeness von Tail-Completeness und beweist DPS trotz Tail-Truncation', () => {
    const config: WeaponConfig = {
      ...WEAPON_CONFIGS.GLOCK,
      id: 'GLOCK_TAIL_FIXTURE',
      burnOnHit: { durationMs: 3000, damagePerTick: 4 },
    };
    const result = runWeaponSingleTargetBenchmark({
      weaponId: config.id,
      weaponConfigOverride: config,
      sourceSlot: 'weapon1',
      durationMs: 1000,
      maxSettleDurationMs: 50,
    });
    expect(result.primaryMetricComplete).toBe(true);
    expect(result.tailComplete).toBe(false);
    expect(result.settleTruncated).toBe(true);

    const progression = analyzeWeaponFiveTargetProgression({
      weaponId: 'GLOCK',
      slot: 'weapon1',
      seeds: [1],
      durationMs: 100,
      scenarioConfig: { ...DEFAULT_FIVE_TARGET_SCENARIO_CONFIG, settleLimitMs: 0 },
    });
    const base = progression.stages.find((stage) => stage.stage === 'base')!;
    expect(base.provenMaximum).toBe(true);
    expect(base.incompleteCandidates).toBe(0);
    const mid = progression.stages.find((stage) => stage.stage === 'mid')!;
    expect(mid.tailIncompleteCandidates).toBeGreaterThan(0);
    expect(mid.provenMaximum).toBe(true);
  });

  it('erzeugt ein versioniertes, seed-stabiles Layout unabhaengig von Weapon-Range und Build', () => {
    const layoutA = generateFiveTargetLayout({ scenarioConfig: DEFAULT_FIVE_TARGET_SCENARIO_CONFIG, seed: 17 });
    const layoutB = generateFiveTargetLayout({ scenarioConfig: DEFAULT_FIVE_TARGET_SCENARIO_CONFIG, seed: 17 });
    const layoutC = generateFiveTargetLayout({ scenarioConfig: DEFAULT_FIVE_TARGET_SCENARIO_CONFIG, seed: 18 });
    expect(layoutA).toEqual(layoutB);
    expect(layoutC).not.toEqual(layoutA);
    expect(layoutA).toHaveLength(5);
    expect(layoutA.map((target) => target.id)).toEqual(['target_1', 'target_2', 'target_3', 'target_4', 'target_5']);
    for (const target of layoutA) expect(target.radius).toBe(DEFAULT_FIVE_TARGET_SCENARIO_CONFIG.targetRadius);
    for (let i = 0; i < layoutA.length; i += 1) {
      expect(layoutA[i].x).toBeGreaterThan(0);
      for (let j = 0; j < i; j += 1) {
        expect(Math.hypot(layoutA[i].x - layoutA[j].x, layoutA[i].y - layoutA[j].y))
          .toBeGreaterThanOrEqual(DEFAULT_FIVE_TARGET_SCENARIO_CONFIG.targetRadius * 2 + DEFAULT_FIVE_TARGET_SCENARIO_CONFIG.minimumTargetGap);
      }
    }
    const shortRange = generateFiveTargetLayout({
      scenarioConfig: { ...DEFAULT_FIVE_TARGET_SCENARIO_CONFIG, layoutRegion: { minX: 110, maxX: 250, minY: -120, maxY: 120 } },
      seed: 17,
    });
    expect(shortRange).toEqual(layoutA);

    const baseRun = runWeaponFiveTargetBenchmark({ weaponId: 'P90', sourceSlot: 'weapon2', seed: 17, durationMs: 100 });
    const rangeUpgradeRun = runWeaponFiveTargetBenchmark({
      weaponId: 'P90',
      sourceSlot: 'weapon2',
      weaponConfigOverride: { ...WEAPON_CONFIGS.P90, range: WEAPON_CONFIGS.P90.range + 1000 },
      seed: 17,
      durationMs: 100,
    });
    expect(rangeUpgradeRun.targetLayout).toEqual(baseRun.targetLayout);
  });

  it('haelt Layout- und Weapon-RNG getrennt', () => {
    const derived = deriveBenchmarkSeeds(42);
    const before = Array.from({ length: 4 }, () => {
      const rng = (() => {
        let state = derived.weaponSeed >>> 0;
        return () => {
          state = (state + 0x6d2b79f5) | 0;
          let t = Math.imul(state ^ (state >>> 15), 1 | state);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      return rng();
    });
    generateFiveTargetLayout({ seed: derived.layoutSeed });
    const after = Array.from({ length: 4 }, () => {
      const rng = (() => {
        let state = derived.weaponSeed >>> 0;
        return () => {
          state = (state + 0x6d2b79f5) | 0;
          let t = Math.imul(state ^ (state >>> 15), 1 | state);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      return rng();
    });
    expect(after).toEqual(before);
  });

  it('bewahrt die Runtime-Starting-Overlap-Semantik des Shared ProjectileImpactResolvers', () => {
    expect(resolveProjectileTargetImpact({ startX: 0, startY: 0, endX: 100, endY: 0, targetX: 50, targetY: 0, radius: 10 })?.distance).toBe(40);
    expect(resolveProjectileTargetImpact({ startX: 0, startY: 10, endX: 100, endY: 10, targetX: 50, targetY: 0, radius: 10 })?.distance).toBe(50);
    expect(resolveProjectileTargetImpact({ startX: 40, startY: 0, endX: 80, endY: 0, targetX: 50, targetY: 0, radius: 10, ignoreStartingOverlap: true })?.distance).toBe(20);
    expect(resolveProjectileTargetImpact({ startX: 45, startY: 0, endX: 80, endY: 0, targetX: 50, targetY: 0, radius: 10, ignoreStartingOverlap: true })?.distance).toBe(15);
    expect(resolveProjectileTargetImpact({ startX: 10, startY: 0, endX: 0, endY: 0, targetX: 0, targetY: 0, radius: 10, ignoreStartingOverlap: true })).toBeNull();
    expect(resolveProjectileTargetImpact({ startX: 0, startY: 0, endX: 5, endY: 0, targetX: 0, targetY: 0, radius: 10, ignoreStartingOverlap: true })).toBeNull();
  });

  it('waehlt bei Projectile, Hitscan und identischer Distanz deterministisch das naechste Ziel', () => {
    const world = new HeadlessStaticTargetWorld(fiveTargets(), 1, true, 16, 'five_target');
    world.spawnProjectile(headlessProjectileSpawnRequest(0, 0, 0, 'player', { speed: 1000, lifetimeMs: 1000 }));
    world.step(100);
    expect(world.getDamageEvents()[0]?.targetId).toBe('target_1');

    const hitscanWorld = new HeadlessStaticTargetWorld(fiveTargets(), 1, true, 16, 'five_target');
    hitscanWorld.resolveHitscan({
      shooterId: 'player', startX: 0, startY: 0, angle: 0, range: 100, damage: 10,
      traceThickness: 0, color: 0xffffff, adrenalinGain: 0, sourceId: 'hitscan',
      visualPreset: 'default', rockDamageMult: 1, trainDamageMult: 1, baseDamageMult: 1,
    } as HitscanShotRequest);
    expect(hitscanWorld.getDamageEvents()[0]?.targetId).toBe('target_1');
  });

  it('laesst Melee mehrere Targets pro Swing treffen und vergibt Adrenalin pro Treffer', () => {
    const targets = [
      { id: 'target_1', x: 40, y: -20, radius: 16 },
      { id: 'target_2', x: 40, y: 0, radius: 16 },
      { id: 'target_3', x: 40, y: 20, radius: 16 },
      { id: 'target_4', x: 100, y: 0, radius: 16 },
      { id: 'target_5', x: 120, y: 0, radius: 16 },
    ];
    const world = new HeadlessStaticTargetWorld(targets, 1, true, 16, 'five_target');
    const request: MeleeSwingRequest = {
      shooterId: 'player', x: 0, y: 0, angle: 0, range: 50, arcDegrees: 80, damage: 10,
      adrenalinGain: 2, hitAdrenaline: 3, sourceId: 'melee', color: 0xffffff,
      rockDamageMult: 1, trainDamageMult: 1, baseDamageMult: 1, visualPreset: 'default',
      hitHeal: 0, bloodEffectMultiplier: 1,
    };
    expect(world.resolveMelee(request)).toBe(true);
    expect(world.getHits()).toBe(3);
    expect(world.getAdrenalineGenerated()).toBe(15);
    expect(world.getDamageEvents().map((event) => event.targetId)).toEqual(['target_1', 'target_2', 'target_3']);
  });

  it('isoliert Burn-State pro targetId und klassifiziert statische 5T-Mechaniken zentral', () => {
    const world = new HeadlessStaticTargetWorld(fiveTargets(), 1, true, 16, 'five_target');
    world.setDamageMeasurementWindow(0, 500);
    world.burnStateMachine.applyHit({ targetId: 'target_1', attackerId: 'player', durationMs: 500, damagePerTick: 2, sourceKey: 'weapon:test', sourceId: 'test', now: 0 });
    world.burnStateMachine.applyHit({ targetId: 'target_2', attackerId: 'player', durationMs: 500, damagePerTick: 3, sourceKey: 'weapon:test', sourceId: 'test', now: 0 });
    world.step(250);
    expect(world.getDamageEvents().map((event) => event.targetId)).toEqual(['target_1', 'target_2']);
    expect(validateWeaponBalanceCapabilities({ ...WEAPON_CONFIGS.BITE, hitHeal: 1 }, 'five_target').supported).toBe(true);
    expect(validateWeaponBalanceCapabilities({ ...WEAPON_CONFIGS.P90, hitSlowFraction: 0.5, hitSlowDurationMs: 100 }, 'five_target').ignoredScenarioIrrelevant).toContain('hitSlow');
    expect(validateWeaponBalanceCapabilities({ ...WEAPON_CONFIGS.P90, killHeal: 1, killAdrenaline: 1 }, 'five_target').ignoredScenarioIrrelevant).toEqual(expect.arrayContaining(['killHeal', 'killAdrenaline']));
    expect(validateWeaponBalanceCapabilities({ ...WEAPON_CONFIGS.ASMD_PRIM, chainLightning: { ...WEAPON_CONFIGS.ASMD_PRIM.chainLightning!, maxJumps: 1 } }, 'five_target').supported).toBe(true);
  });

  it('liefert 5T-Expected-Total-DPS und getrennte Multi-Seed-Aggregate fuer die initialen Waffen', () => {
    const common = { seeds: [3, 1, 3, 2], durationMs: 500, stepDeltaMs: 16 } as const;
    const glock = runWeaponFiveTargetBenchmark({ weaponId: 'GLOCK', sourceSlot: 'weapon1', seed: 1, durationMs: 500 });
    const p90 = runWeaponFiveTargetBenchmark({ weaponId: 'P90', sourceSlot: 'weapon2', seed: 1, durationMs: 500 });
    const asmd = runWeaponFiveTargetBenchmark({ weaponId: 'ASMD_PRIM', sourceSlot: 'weapon1', seed: 1, durationMs: 500 });
    const bite = runWeaponFiveTargetBenchmark({ weaponId: 'BITE', sourceSlot: 'weapon1', seed: 1, durationMs: 500 });
    expect([glock, p90, asmd, bite].every((run) => run.scenarioId === 'five_target_static.v1' && run.scenarioVersion === 1)).toBe(true);
    expect(bite.targetLayout).toEqual(generateFiveTargetLayout({
      scenarioConfig: MELEE_FIVE_TARGET_SCENARIO_CONFIG,
      seed: bite.layoutSeed,
    }));
    expect(bite.targetsHitPerShot).toBeGreaterThan(1);
    const aggregate = runWeaponFiveTargetBenchmarkSet({ weaponId: 'BITE', sourceSlot: 'weapon1', ...common });
    const reversed = runWeaponFiveTargetBenchmarkSet({ weaponId: 'BITE', sourceSlot: 'weapon1', seeds: [2, 3, 1], durationMs: 500, stepDeltaMs: 16 });
    expect(aggregate.seeds).toEqual([1, 2, 3]);
    expect(aggregate.expectedDps).toBe(reversed.expectedDps);
    expect(aggregate.expectedTargetsHitPerShot).toBe(reversed.expectedTargetsHitPerShot);
  });

  it('integriert Shared Chain Lightning in 5T und hält Shotgun Chain weiterhin fail-closed', () => {
    const chainConfig: WeaponConfig = {
      ...WEAPON_CONFIGS.ASMD_PRIM,
      id: 'ASMD_CHAIN_FIXTURE',
      chainLightning: { ...WEAPON_CONFIGS.ASMD_PRIM.chainLightning!, maxJumps: 1 },
    };
    const chainRun = runWeaponFiveTargetBenchmark({ weaponId: chainConfig.id, weaponConfigOverride: chainConfig, sourceSlot: 'weapon1', durationMs: 600 });
    expect(chainRun.directDamage).toBe(10);
    expect(chainRun.chainDamage).toBeGreaterThan(0);
    expect(chainRun.chainDps).toBeGreaterThan(0);
    expect(chainRun.damageEvents.some((event) => event.damageKind === 'direct')).toBe(true);
    expect(chainRun.damageEvents.some((event) => event.damageKind === 'chain')).toBe(true);
    expect(chainRun.adrenalineGenerated).toBe(8 * (1 + chainRun.damageEvents.filter((event) => event.damageKind === 'chain').length));

    const singleTargetChain = runWeaponSingleTargetBenchmark({
      weaponId: chainConfig.id,
      weaponConfigOverride: chainConfig,
      sourceSlot: 'weapon1',
      durationMs: 600,
    });
    expect(singleTargetChain.chainDamage).toBe(0);
    expect(validateWeaponBalanceCapabilities(chainConfig, 'single_target_static').supported).toBe(true);

    const shotgunChainConfig: WeaponConfig = {
      ...WEAPON_CONFIGS.P90,
      id: 'P90_SHOTGUN_CHAIN_FIXTURE',
      pelletCount: 2,
      shotgunChainEnabled: 1,
      shotgunChainDamageRetention: 1,
      shotgunChainRadiusRetention: 1,
    };
    expect(validateWeaponBalanceCapabilities(shotgunChainConfig, 'five_target').supported).toBe(false);
    const progression = analyzeWeaponFiveTargetProgression({ weaponId: 'GLOCK', slot: 'weapon1', seeds: [1], durationMs: 100 });
    expect(progression.scenario).toBe('five_target');
    expect(progression.summaryText).toContain('Five-Target Progression');
  }, 30000);

  it('liefert fuer jede Aim-Klasse bei Target-Permutationen dieselbe Loesung und denselben Benchmarkwert', () => {
    const targets = [
      { id: 'target_1', x: 130, y: -18, radius: 16 },
      { id: 'target_2', x: 145, y: 0, radius: 16 },
      { id: 'target_3', x: 165, y: 24, radius: 16 },
      { id: 'target_4', x: 185, y: -28, radius: 16 },
      { id: 'target_5', x: 205, y: 10, radius: 16 },
    ] as const;
    const permuted = [targets[4], targets[1], targets[3], targets[0], targets[2]];

    const singleAimA = resolveFiveTargetAim('coverage_aware_v1', WEAPON_CONFIGS.ASMD_PRIM, targets);
    const singleAimB = resolveFiveTargetAim('coverage_aware_v1', WEAPON_CONFIGS.ASMD_PRIM, permuted);
    expect(singleAimB).toEqual(singleAimA);

    const pelletConfig: WeaponConfig = {
      ...WEAPON_CONFIGS.P90,
      id: 'P90_AIM_PERMUTATION_FIXTURE',
      pelletCount: 5,
      pelletSpreadAngle: 8,
    };
    expect(resolveFiveTargetAim('coverage_aware_v1', pelletConfig, permuted))
      .toEqual(resolveFiveTargetAim('coverage_aware_v1', pelletConfig, targets));
    expect(resolveFiveTargetAim('coverage_aware_v1', WEAPON_CONFIGS.BITE, permuted))
      .toEqual(resolveFiveTargetAim('coverage_aware_v1', WEAPON_CONFIGS.BITE, targets));

    const benchmarkOnce = (orderedTargets: readonly typeof targets[number][]) => {
      const world = new HeadlessStaticTargetWorld(orderedTargets, 1, true, 16, 'five_target');
      world.setDamageMeasurementWindow(0, 600);
      const aim = resolveFiveTargetAim('coverage_aware_v1', WEAPON_CONFIGS.ASMD_PRIM, orderedTargets);
      const fired = world.resolveHitscan({
        shooterId: 'sim_player',
        startX: 0,
        startY: 0,
        angle: aim.aimAngle,
        range: WEAPON_CONFIGS.ASMD_PRIM.range,
        damage: WEAPON_CONFIGS.ASMD_PRIM.damage,
        traceThickness: WEAPON_CONFIGS.ASMD_PRIM.fire.type === 'hitscan' ? WEAPON_CONFIGS.ASMD_PRIM.fire.traceThickness : 0,
        color: 0xffffff,
        adrenalinGain: WEAPON_CONFIGS.ASMD_PRIM.adrenalinGain,
        sourceId: WEAPON_CONFIGS.ASMD_PRIM.id,
        visualPreset: 'asmd_primary',
        rockDamageMult: 1,
        trainDamageMult: 1,
        baseDamageMult: 1,
      });
      if (fired) world.recordShotFired(0);
      return { aim, damage: world.getMeasurementTotalDamage(), events: world.getDamageEvents() };
    };

    const benchmarkA = benchmarkOnce(targets);
    const benchmarkB = benchmarkOnce(permuted);
    expect(benchmarkB).toEqual(benchmarkA);
  });
});