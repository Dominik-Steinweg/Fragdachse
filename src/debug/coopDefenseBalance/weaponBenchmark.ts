import { getWeaponConfig, type WeaponConfig } from '../../loadout/LoadoutConfig';
import { resolveEffectivePelletCount } from '../../loadout/ShotPlanResolver';
import { HeadlessSingleTargetWorld } from './HeadlessSingleTargetWorld';
import { runStaticTargetBenchmarkCore } from './staticTargetBenchmarkCore';
import { assertWeaponBalanceSupported } from './weaponCapabilityValidator';
import {
  isSingleTargetTriggerReady,
  calculateSingleTargetTriggerReadyTime,
  resolveSingleTargetAimAngle,
} from './triggerDiscipline';
import {
  assertSingleTargetScenarioConfig,
  DEFAULT_SINGLE_TARGET_SCENARIO_CONFIG,
  resolveSingleTargetScenarioProfile,
  type SingleTargetScenarioConfig,
} from './scenarioTypes';
import {
  DEFAULT_BENCHMARK_SEEDS,
  type SingleTargetBenchmarkOptions,
  type SingleTargetBenchmarkResult,
  type SingleTargetBenchmarkSetOptions,
  type SingleTargetBenchmarkAggregate,
} from './weaponBenchmarkTypes';
import type { WeaponSlot } from '../../types';
import { buildBenchmarkRunCacheKey } from './scenarioCacheKey';

const singleTargetRunCache = new Map<string, SingleTargetBenchmarkResult>();

/**
 * Validiert den Waffen-Slot gegen die reale allowedSlots-Konfiguration der Waffe.
 */
export function resolveAndValidateWeaponSlot(
  config: WeaponConfig,
  requestedSlot?: string,
): WeaponSlot {
  if (requestedSlot !== undefined) {
    if (requestedSlot !== 'weapon1' && requestedSlot !== 'weapon2') {
      throw new Error(
        `[WeaponBalanceLab] Ungültiger Slot "${requestedSlot}". Für Waffenprogression sind ausschließlich "weapon1" oder "weapon2" zulässig.`,
      );
    }
    if (!config.allowedSlots.includes(requestedSlot as WeaponSlot)) {
      throw new Error(
        `[WeaponBalanceLab] Waffe "${config.id}" ist nicht für Slot "${requestedSlot}" zugelassen (erlaubt: ${config.allowedSlots.join(', ')}).`,
      );
    }
    return requestedSlot as WeaponSlot;
  }

  const validSlot = config.allowedSlots.find(
    (s): s is WeaponSlot => s === 'weapon1' || s === 'weapon2',
  );
  if (!validSlot) {
    throw new Error(
      `[WeaponBalanceLab] Waffe "${config.id}" besitzt keinen gültigen Waffen-Slot (allowedSlots: ${config.allowedSlots.join(', ')}).`,
    );
  }
  return validSlot;
}

/**
 * @deprecated Nur noch ein Kompatibilitaets-Export. Die Benchmark-Distanz kommt aus einem
 * versionierten Szenario-Profil und wird nicht aus Fire-Typ oder Weapon-Range berechnet.
 */
export function resolveDefaultTargetDistance(_fireType: string, _range: number): number {
  // Abwaertskompatibilitaet fuer alte Importe. Der Benchmark selbst verwendet diese
  // Funktion bewusst nicht mehr; die Distanz kommt ausschliesslich aus dem versionierten
  // SingleTargetScenarioConfig.
  return DEFAULT_SINGLE_TARGET_SCENARIO_CONFIG.targetDistance;
}

export function resolveSingleTargetScenarioConfig(
  options: SingleTargetBenchmarkOptions | SingleTargetBenchmarkSetOptions,
  fireType = 'projectile',
): SingleTargetScenarioConfig {
  const base = options.scenarioConfig
    ?? (fireType === 'projectile'
      ? DEFAULT_SINGLE_TARGET_SCENARIO_CONFIG
      : resolveSingleTargetScenarioProfile(fireType));
  const config: SingleTargetScenarioConfig = {
    ...base,
    attackWindowMs: options.durationMs ?? base.attackWindowMs,
    targetDistance: options.targetDistance ?? base.targetDistance,
    settleLimitMs: options.maxSettleDurationMs ?? base.settleLimitMs,
  };
  assertSingleTargetScenarioConfig(config);
  return config;
}

/**
 * Berechnet ein Quantil / Perzentil aus einem aufsteigend sortierten Zahlenarray via linearer Interpolation.
 */
export function calculatePercentile(sortedValues: readonly number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const clampedPercentile = Math.max(0, Math.min(100, percentile));
  const index = (clampedPercentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sortedValues[lower] + weight * (sortedValues[upper] - sortedValues[lower]);
}

/**
 * Führt einen deterministischen Headless-Single-Target-Benchmark für die angegebene Waffe aus.
 */
export function runWeaponSingleTargetBenchmark(
  options: SingleTargetBenchmarkOptions,
): SingleTargetBenchmarkResult {
  const config = options.weaponConfigOverride ?? getWeaponConfig(options.weaponId);
  if (!config) {
    throw new Error(`[WeaponBalanceLab] Unbekannte Weapon-ID: "${options.weaponId}"`);
  }

  // Capability-Check: nicht unterstützte Mechaniken explizit ablehnen
  assertWeaponBalanceSupported(config, 'single_target_static');

  const slot = resolveAndValidateWeaponSlot(config, options.sourceSlot);
  const scenario = resolveSingleTargetScenarioConfig(options, config.fire.type);
  const attackWindowDurationMs = scenario.attackWindowMs;
  const stepDeltaMs = options.stepDeltaMs ?? 16;
  const seed = options.seed ?? 1;
  const maxSettleMs = scenario.settleLimitMs;
  const recordEvents = options.recordEvents ?? true;
  const runCacheKey = buildBenchmarkRunCacheKey({
    weaponId: options.weaponId,
    slot,
    weaponConfig: config,
    scenario,
    scenarioKind: 'single_target_static',
    seed,
    stepDeltaMs,
  });
  const cachedRun = singleTargetRunCache.get(runCacheKey);
  if (cachedRun && !recordEvents) {
    return {
      ...cachedRun,
      damageEvents: [],
      resourceEvents: [],
    };
  }

  const targetDistance = scenario.targetDistance;
  const measurementStartMs = scenario.warmupMs;
  const measurementEndMs = measurementStartMs + attackWindowDurationMs;
  const world = new HeadlessSingleTargetWorld(
    targetDistance,
    seed,
    recordEvents,
    scenario.targetRadius,
  );
  world.setDamageMeasurementWindow(measurementStartMs, measurementEndMs);
  const core = runStaticTargetBenchmarkCore({
    config,
    sourceSlot: slot,
    world,
    measurementStartMs,
    measurementEndMs,
    stepDeltaMs,
    maxSettleMs,
    controller: {
      resolveAim: (_config, currentWorld) => ({
        aimAngle: resolveSingleTargetAimAngle(
          scenario.aimPolicy,
          0,
          0,
          currentWorld.target.x,
          currentWorld.target.y,
        ),
        targetX: currentWorld.target.x,
        targetY: currentWorld.target.y,
        triggerTargetDistance: targetDistance,
        triggerTargetRadius: currentWorld.target.radius,
      }),
      isTriggerReady: (_config, dynamicSpread, aim) => isSingleTargetTriggerReady(
        scenario.triggerPolicy,
        config,
        dynamicSpread,
        aim.triggerTargetDistance,
        aim.triggerTargetRadius,
      ),
      calculateTriggerReadyTime: (_config, dynamicSpread, lastUsedAt, now, aim) => calculateSingleTargetTriggerReadyTime(
        scenario.triggerPolicy,
        config,
        dynamicSpread,
        lastUsedAt,
        now,
        aim.triggerTargetDistance,
        aim.triggerTargetRadius,
      ),
    },
  });
  const settleDurationMs = core.settleDurationMs;
  const settleTruncated = core.settleTruncated;
  const primaryMetricComplete = core.primaryMetricComplete;

  // ── Phase 4: Metriken auswerten ────────────────────────────────────────────
  // Das Messfenster ist halboffen: [warmupMs, warmupMs + attackWindowMs).
  const totalDamage = world.getMeasurementTotalDamage();
  const directDamage = world.getMeasurementDirectDamage();
  const burnDamage = world.getMeasurementBurnDamage();
  const chainDamage = world.getMeasurementChainDamage();
  const damageYieldIncludingTail = world.getTotalDamage();
  const directDamageIncludingTail = world.getDirectDamage();
  const burnDamageIncludingTail = world.getBurnDamage();
  const chainDamageIncludingTail = world.getChainDamage();
  const shotsFired = world.getShotsFired();
  const hits = world.getHits();
  const measurementShotsFired = world.getMeasurementShotsFired();
  const measurementTargetHits = world.getMeasurementTargetHits();
  const measurementProjectileHits = world.getMeasurementProjectileHits();
  const totalExpectedPellets = measurementShotsFired * resolveEffectivePelletCount(config);
  const totalExpectedPelletsIncludingTail = shotsFired * resolveEffectivePelletCount(config);
  const hitRate = totalExpectedPelletsIncludingTail > 0 ? hits / totalExpectedPelletsIncludingTail : 0;
  const measurementHitRate = totalExpectedPellets > 0 ? measurementTargetHits / totalExpectedPellets : 0;
  const durationSec = attackWindowDurationMs / 1000;
  const dps = durationSec > 0 ? totalDamage / durationSec : 0;
  const directDps = durationSec > 0 ? directDamage / durationSec : 0;
  const burnDps = durationSec > 0 ? burnDamage / durationSec : 0;
  const chainDps = durationSec > 0 ? chainDamage / durationSec : 0;
  const adrenalineGenerated = world.getAdrenalineGenerated();
  const adrenalineSpent = world.getAdrenalineSpent();
  const measurementAdrenalineGenerated = world.getMeasurementAdrenalineGenerated();
  const measurementAdrenalineSpent = world.getMeasurementAdrenalineSpent();
  const adrenalineGeneratedPerSec = durationSec > 0 ? measurementAdrenalineGenerated / durationSec : 0;
  const adrenalineSpentPerSec = durationSec > 0 ? measurementAdrenalineSpent / durationSec : 0;

  const result: SingleTargetBenchmarkResult = {
    weaponId: config.id,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    warmupMs: scenario.warmupMs,
    measurementStartMs,
    measurementEndMs,
    durationMs: attackWindowDurationMs,
    settleDurationMs,
    totalDamage,
    directDamage,
    burnDamage,
    chainDamage,
    damageYieldIncludingTail,
    directDamageIncludingTail,
    burnDamageIncludingTail,
    chainDamageIncludingTail,
    tailDamage: world.getTailDamage(),
    tailDirectDamage: world.getTailDirectDamage(),
    tailBurnDamage: world.getTailBurnDamage(),
    tailChainDamage: world.getTailChainDamage(),
    dps,
    directDps,
    burnDps,
    chainDps,
    shotsFired,
    hits,
    hitRate,
    measurementShotsFired,
    measurementTargetHits,
    measurementProjectileHits,
    measurementHitRate,
    measurementAdrenalineGenerated,
    measurementAdrenalineSpent,
    adrenalineGenerated,
    adrenalineSpent,
    adrenalineGeneratedPerSec,
    adrenalineSpentPerSec,
    primaryMetricComplete,
    tailComplete: !settleTruncated,
    settleTruncated,
    damageEvents: world.getDamageEvents(),
    resourceEvents: world.getResourceEvents(),
  };
  singleTargetRunCache.set(runCacheKey, result);
  return recordEvents
    ? result
    : {
      ...result,
      damageEvents: [],
      resourceEvents: [],
    };
}

/**
 * Führt einen Multi-Seed-Benchmark aus und aggregiert die Ergebnisse deterministisch zu
 * Erwartungswerten (Mean), Median, P10/P90-Quantilen und Extremwerten.
 */
export function runWeaponSingleTargetBenchmarkSet(
  options: SingleTargetBenchmarkSetOptions,
): SingleTargetBenchmarkAggregate {
  const rawSeeds = options.seeds && options.seeds.length > 0
    ? options.seeds
    : DEFAULT_BENCHMARK_SEEDS;

  // Deterministische Normalisierung (Deduplizieren + Sortieren)
  const seeds = Array.from(new Set(rawSeeds)).sort((a, b) => a - b);
  const n = seeds.length;
  const aggregateConfig = options.weaponConfigOverride ?? getWeaponConfig(options.weaponId);
  const scenario = resolveSingleTargetScenarioConfig(options, aggregateConfig?.fire.type);

  const runs: SingleTargetBenchmarkResult[] = [];
  const dpsValues: number[] = [];

  let totalDurationSec = 0;
  let totalDamage = 0;
  let totalDirectDamage = 0;
  let totalBurnDamage = 0;
  let totalChainDamage = 0;
  let totalDamageYieldIncludingTail = 0;
  let totalTailDamage = 0;
  let totalShots = 0;
  let totalHits = 0;
  let totalPossiblePellets = 0;
  let totalAdrenalineGen = 0;
  let totalAdrenalineSpent = 0;
  let anyTruncated = false;
  let allPrimaryComplete = true;

  const recordEvents = options.includeIndividualRuns ?? false;

  for (const seed of seeds) {
    const result = runWeaponSingleTargetBenchmark({
      weaponId: options.weaponId,
      weaponConfigOverride: options.weaponConfigOverride,
      sourceSlot: options.sourceSlot,
      scenarioConfig: scenario,
      durationMs: options.durationMs,
      stepDeltaMs: options.stepDeltaMs,
      targetDistance: options.targetDistance,
      maxSettleDurationMs: options.maxSettleDurationMs,
      recordEvents,
      seed,
    });

    if (recordEvents) {
      runs.push(result);
    }
    dpsValues.push(result.dps);

    const durSec = (result.durationMs ?? 30_000) / 1000;
    totalDurationSec += durSec;
    totalDamage += result.totalDamage;
    totalDirectDamage += result.directDamage;
    totalBurnDamage += result.burnDamage;
    totalChainDamage += result.chainDamage;
    totalDamageYieldIncludingTail += result.damageYieldIncludingTail;
    totalTailDamage += result.tailDamage;
    totalShots += result.measurementShotsFired;
    totalHits += result.measurementTargetHits;

    const config = options.weaponConfigOverride ?? getWeaponConfig(options.weaponId);
    const pelletsPerShot = config ? resolveEffectivePelletCount(config) : 1;
    totalPossiblePellets += result.measurementShotsFired * pelletsPerShot;

    totalAdrenalineGen += result.measurementAdrenalineGenerated;
    totalAdrenalineSpent += result.measurementAdrenalineSpent;
    if (result.settleTruncated) anyTruncated = true;
    if (!result.primaryMetricComplete) allPrimaryComplete = false;
  }

  const sortedDps = [...dpsValues].sort((a, b) => a - b);
  const expectedDps = totalDurationSec > 0 ? totalDamage / totalDurationSec : 0;
  const expectedDirectDps = totalDurationSec > 0 ? totalDirectDamage / totalDurationSec : 0;
  const expectedBurnDps = totalDurationSec > 0 ? totalBurnDamage / totalDurationSec : 0;
  const expectedChainDps = totalDurationSec > 0 ? totalChainDamage / totalDurationSec : 0;
  const medianDps = calculatePercentile(sortedDps, 50);
  const p10Dps = calculatePercentile(sortedDps, 10);
  const p90Dps = calculatePercentile(sortedDps, 90);
  const minDps = sortedDps[0] ?? 0;
  const maxDps = sortedDps[sortedDps.length - 1] ?? 0;

  const expectedHitRate = totalPossiblePellets > 0 ? totalHits / totalPossiblePellets : 0;
  const expectedShotsPerSecond = totalDurationSec > 0 ? totalShots / totalDurationSec : 0;
  const expectedAdrenalineGeneratedPerSec = totalDurationSec > 0 ? totalAdrenalineGen / totalDurationSec : 0;
  const expectedAdrenalineSpentPerSec = totalDurationSec > 0 ? totalAdrenalineSpent / totalDurationSec : 0;

  return {
    weaponId: options.weaponId,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    seedCount: n,
    seeds: [...seeds],
    expectedDps,
    expectedDirectDps,
    expectedBurnDps,
    expectedChainDps,
    expectedDamageYieldIncludingTail: n > 0 ? totalDamageYieldIncludingTail / n : 0,
    expectedTailDamage: n > 0 ? totalTailDamage / n : 0,
    medianDps,
    p10Dps,
    p90Dps,
    minDps,
    maxDps,
    expectedHitRate,
    expectedShotsPerSecond,
    expectedAdrenalineGeneratedPerSec,
    expectedAdrenalineSpentPerSec,
    primaryMetricComplete: allPrimaryComplete,
    tailComplete: !anyTruncated,
    settleTruncated: anyTruncated ? true : undefined,
    runs: recordEvents ? runs : undefined,
  };
}
