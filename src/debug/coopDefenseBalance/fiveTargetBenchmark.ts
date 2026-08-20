import { getWeaponConfig, type WeaponConfig } from '../../loadout/LoadoutConfig';
import { assertWeaponBalanceSupported } from './weaponCapabilityValidator';
import { resolveAndValidateWeaponSlot, calculatePercentile } from './weaponBenchmark';
import {
  assertFiveTargetScenarioConfig,
  DEFAULT_FIVE_TARGET_SCENARIO_CONFIG,
  resolveFiveTargetScenarioProfile,
  type FiveTargetScenarioConfig,
} from './scenarioTypes';
import {
  DEFAULT_BENCHMARK_SEEDS,
  type FiveTargetBenchmarkAggregate,
  type FiveTargetBenchmarkOptions,
  type FiveTargetBenchmarkResult,
  type FiveTargetBenchmarkSetOptions,
} from './weaponBenchmarkTypes';
import { deriveBenchmarkSeeds } from './benchmarkSeeds';
import { generateFiveTargetLayout } from './fiveTargetLayout';
import { HeadlessStaticTargetWorld } from './HeadlessStaticTargetWorld';
import { resolveFiveTargetAim, isFiveTargetTriggerReady, calculateFiveTargetTriggerReadyTime } from './fiveTargetAim';
import { runStaticTargetBenchmarkCore } from './staticTargetBenchmarkCore';

export function resolveFiveTargetScenarioConfig(
  options: FiveTargetBenchmarkOptions | FiveTargetBenchmarkSetOptions,
  fireType = 'projectile',
): FiveTargetScenarioConfig {
  const base = options.scenarioConfig ?? resolveFiveTargetScenarioProfile(fireType);
  const config: FiveTargetScenarioConfig = {
    ...base,
    attackWindowMs: options.durationMs ?? base.attackWindowMs,
    settleLimitMs: options.maxSettleDurationMs ?? base.settleLimitMs,
  };
  assertFiveTargetScenarioConfig(config);
  return config;
}

/** Fuehrt einen einzelnen deterministischen Five-Target-Lauf aus. */
export function runWeaponFiveTargetBenchmark(
  options: FiveTargetBenchmarkOptions,
): FiveTargetBenchmarkResult {
  const config = options.weaponConfigOverride ?? getWeaponConfig(options.weaponId);
  if (!config) {
    throw new Error(`[WeaponBalanceLab] Unbekannte Weapon-ID: "${options.weaponId}"`);
  }
  assertWeaponBalanceSupported(config, 'five_target');

  const slot = resolveAndValidateWeaponSlot(config, options.sourceSlot);
  const scenario = resolveFiveTargetScenarioConfig(options, config.fire.type);
  const benchmarkSeed = options.seed ?? 1;
  const seeds = deriveBenchmarkSeeds(benchmarkSeed);
  const recordEvents = options.recordEvents ?? true;
  const measurementStartMs = scenario.warmupMs;
  const measurementEndMs = measurementStartMs + scenario.attackWindowMs;
  const layout = generateFiveTargetLayout({ scenarioConfig: scenario, seed: seeds.layoutSeed });
  const world = new HeadlessStaticTargetWorld(
    layout,
    seeds.weaponSeed,
    recordEvents,
    scenario.targetRadius,
    'five_target',
  );
  world.setDamageMeasurementWindow(measurementStartMs, measurementEndMs);

  const core = runStaticTargetBenchmarkCore({
    config,
    sourceSlot: slot,
    world,
    measurementStartMs,
    measurementEndMs,
    stepDeltaMs: options.stepDeltaMs ?? 16,
    maxSettleMs: scenario.settleLimitMs,
    controller: {
      resolveAim: (_config, currentWorld) => {
        const aim = resolveFiveTargetAim(scenario.aimPolicy, config, currentWorld.targets);
        return {
          aimAngle: aim.aimAngle,
          targetX: aim.targetX,
          targetY: aim.targetY,
          triggerTargetDistance: aim.triggerTargetDistance,
          triggerTargetRadius: aim.triggerTargetRadius,
        };
      },
      isTriggerReady: (_config, dynamicSpread, aim) => isFiveTargetTriggerReady(
        scenario.triggerPolicy,
        config,
        dynamicSpread,
        aim,
      ),
      calculateTriggerReadyTime: (_config, dynamicSpread, lastUsedAt, now, aim) => calculateFiveTargetTriggerReadyTime(
        scenario.triggerPolicy,
        config,
        dynamicSpread,
        lastUsedAt,
        now,
        aim,
      ),
    },
  });

  const measurementTotalDamage = world.getMeasurementTotalDamage();
  const measurementDirectDamage = world.getMeasurementDirectDamage();
  const measurementBurnDamage = world.getMeasurementBurnDamage();
  const measurementChainDamage = world.getMeasurementChainDamage();
  const durationSec = scenario.attackWindowMs / 1000;
  const measurementShotsFired = world.getMeasurementShotsFired();
  const measurementTargetHits = world.getMeasurementTargetHits();
  const measurementProjectileHits = world.getMeasurementProjectileHits();
  const totalExpectedPellets = measurementShotsFired
    * Math.max(1, Math.round((config.pelletCount ?? 1) * (config.pelletCountMultiplier ?? 1)));

  return {
    weaponId: config.id,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    benchmarkSeed: seeds.benchmarkSeed,
    layoutSeed: seeds.layoutSeed,
    weaponSeed: seeds.weaponSeed,
    targetLayout: layout,
    warmupMs: scenario.warmupMs,
    measurementStartMs,
    measurementEndMs,
    durationMs: scenario.attackWindowMs,
    settleDurationMs: core.settleDurationMs,
    measurementTotalDamage,
    measurementDirectDamage,
    measurementBurnDamage,
    measurementChainDamage,
    totalDamage: measurementTotalDamage,
    directDamage: measurementDirectDamage,
    burnDamage: measurementBurnDamage,
    chainDamage: measurementChainDamage,
    damageYieldIncludingTail: world.getTotalDamage(),
    directDamageIncludingTail: world.getDirectDamage(),
    burnDamageIncludingTail: world.getBurnDamage(),
    chainDamageIncludingTail: world.getChainDamage(),
    tailDamage: world.getTailDamage(),
    tailDirectDamage: world.getTailDirectDamage(),
    tailBurnDamage: world.getTailBurnDamage(),
    tailChainDamage: world.getTailChainDamage(),
    dps: durationSec > 0 ? measurementTotalDamage / durationSec : 0,
    directDps: durationSec > 0 ? measurementDirectDamage / durationSec : 0,
    burnDps: durationSec > 0 ? measurementBurnDamage / durationSec : 0,
    chainDps: durationSec > 0 ? measurementChainDamage / durationSec : 0,
    targetHits: measurementTargetHits,
    measurementTargetHits,
    measurementProjectileHits,
    shotsFired: measurementShotsFired,
    measurementShotsFired,
    targetsHitPerShot: measurementShotsFired > 0 ? measurementTargetHits / measurementShotsFired : 0,
    projectileHitRate: config.fire.type === 'projectile' && totalExpectedPellets > 0
      ? measurementProjectileHits / totalExpectedPellets
      : undefined,
    adrenalineGenerated: world.getMeasurementAdrenalineGenerated(),
    adrenalineSpent: world.getMeasurementAdrenalineSpent(),
    measurementAdrenalineGenerated: world.getMeasurementAdrenalineGenerated(),
    measurementAdrenalineSpent: world.getMeasurementAdrenalineSpent(),
    adrenalineGeneratedPerSec: durationSec > 0
      ? world.getMeasurementAdrenalineGenerated() / durationSec
      : 0,
    adrenalineSpentPerSec: durationSec > 0
      ? world.getMeasurementAdrenalineSpent() / durationSec
      : 0,
    primaryMetricComplete: core.primaryMetricComplete,
    tailComplete: !core.settleTruncated,
    settleTruncated: core.settleTruncated,
    damageEvents: world.getDamageEvents(),
    resourceEvents: world.getResourceEvents(),
  };
}

/** Aggregiert Five-Target-Laeufe ueber deduplizierte, sortierte Seeds. */
export function runWeaponFiveTargetBenchmarkSet(
  options: FiveTargetBenchmarkSetOptions,
): FiveTargetBenchmarkAggregate {
  const rawSeeds = options.seeds && options.seeds.length > 0
    ? options.seeds
    : DEFAULT_BENCHMARK_SEEDS;
  const seeds = Array.from(new Set(rawSeeds)).sort((a, b) => a - b);
  const config = options.weaponConfigOverride ?? getWeaponConfig(options.weaponId);
  if (!config) {
    throw new Error(`[WeaponBalanceLab] Unbekannte Weapon-ID: "${options.weaponId}"`);
  }
  const scenario = resolveFiveTargetScenarioConfig(options, config.fire.type);
  const runs: FiveTargetBenchmarkResult[] = [];
  const dpsValues: number[] = [];
  const durationSec = scenario.attackWindowMs / 1000;
  let totalDamage = 0;
  let totalDirectDamage = 0;
  let totalBurnDamage = 0;
  let totalChainDamage = 0;
  let totalYield = 0;
  let totalTailDamage = 0;
  let totalShots = 0;
  let totalTargetHits = 0;
  let totalProjectileHits = 0;
  let totalPossiblePellets = 0;
  let totalAdrenalineGenerated = 0;
  let totalAdrenalineSpent = 0;
  let anyTruncated = false;
  let allPrimaryComplete = true;

  for (const seed of seeds) {
    const result = runWeaponFiveTargetBenchmark({
      weaponId: options.weaponId,
      weaponConfigOverride: options.weaponConfigOverride,
      sourceSlot: options.sourceSlot,
      scenarioConfig: scenario,
      durationMs: options.durationMs,
      stepDeltaMs: options.stepDeltaMs,
      maxSettleDurationMs: options.maxSettleDurationMs,
      recordEvents: options.includeIndividualRuns ?? false,
      seed,
    });
    if (options.includeIndividualRuns) runs.push(result);
    dpsValues.push(result.dps);
    totalDamage += result.measurementTotalDamage;
    totalDirectDamage += result.measurementDirectDamage;
    totalBurnDamage += result.measurementBurnDamage;
    totalChainDamage += result.measurementChainDamage;
    totalYield += result.damageYieldIncludingTail;
    totalTailDamage += result.tailDamage;
    totalShots += result.measurementShotsFired;
    totalTargetHits += result.measurementTargetHits;
    totalProjectileHits += result.measurementProjectileHits;
    totalPossiblePellets += result.measurementShotsFired
      * Math.max(1, Math.round((config.pelletCount ?? 1) * (config.pelletCountMultiplier ?? 1)));
    totalAdrenalineGenerated += result.measurementAdrenalineGenerated;
    totalAdrenalineSpent += result.measurementAdrenalineSpent;
    anyTruncated ||= Boolean(result.settleTruncated);
    allPrimaryComplete &&= result.primaryMetricComplete;
  }

  const sortedDps = [...dpsValues].sort((a, b) => a - b);
  return {
    weaponId: options.weaponId,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    seedCount: seeds.length,
    seeds: [...seeds],
    expectedDps: durationSec > 0 && seeds.length > 0 ? totalDamage / (durationSec * seeds.length) : 0,
    expectedDirectDps: durationSec > 0 && seeds.length > 0 ? totalDirectDamage / (durationSec * seeds.length) : 0,
    expectedBurnDps: durationSec > 0 && seeds.length > 0 ? totalBurnDamage / (durationSec * seeds.length) : 0,
    expectedChainDps: durationSec > 0 && seeds.length > 0 ? totalChainDamage / (durationSec * seeds.length) : 0,
    expectedDamageYieldIncludingTail: seeds.length > 0 ? totalYield / seeds.length : 0,
    expectedTailDamage: seeds.length > 0 ? totalTailDamage / seeds.length : 0,
    medianDps: calculatePercentile(sortedDps, 50),
    p10Dps: calculatePercentile(sortedDps, 10),
    p90Dps: calculatePercentile(sortedDps, 90),
    minDps: sortedDps[0] ?? 0,
    maxDps: sortedDps[sortedDps.length - 1] ?? 0,
    expectedTargetsHitPerShot: totalShots > 0 ? totalTargetHits / totalShots : 0,
    expectedProjectileHitRate: totalPossiblePellets > 0 ? totalProjectileHits / totalPossiblePellets : 0,
    expectedShotsPerSecond: durationSec > 0 ? totalShots / (durationSec * Math.max(1, seeds.length)) : 0,
    expectedAdrenalineGeneratedPerSec: durationSec > 0
      ? totalAdrenalineGenerated / (durationSec * Math.max(1, seeds.length))
      : 0,
    expectedAdrenalineSpentPerSec: durationSec > 0
      ? totalAdrenalineSpent / (durationSec * Math.max(1, seeds.length))
      : 0,
    primaryMetricComplete: allPrimaryComplete,
    tailComplete: !anyTruncated,
    settleTruncated: anyTruncated ? true : undefined,
    runs: options.includeIndividualRuns ? runs : undefined,
  };
}
