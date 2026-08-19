import { getWeaponConfig, type WeaponConfig } from '../../loadout/LoadoutConfig';
import { GenericWeapon } from '../../loadout/GenericWeapon';
import { WeaponFireExecutor } from '../../loadout/WeaponFireExecutor';
import { resolveShotPlan, resolveEffectivePelletCount } from '../../loadout/ShotPlanResolver';
import { HeadlessSingleTargetWorld } from './HeadlessSingleTargetWorld';
import { assertWeaponBalanceSupported } from './weaponCapabilityValidator';
import {
  isSpreadWithinTriggerDiscipline,
  calculateTriggerDisciplineReadyTime,
} from './triggerDiscipline';
import {
  DEFAULT_BENCHMARK_SEEDS,
  type SingleTargetBenchmarkOptions,
  type SingleTargetBenchmarkResult,
  type SingleTargetBenchmarkSetOptions,
  type SingleTargetBenchmarkAggregate,
} from './weaponBenchmarkTypes';
import type { WeaponSlot } from '../../types';

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
 * Ermittelt eine sinnvolle Standarddistanz zum Ziel passend zur Reichweite und zum Typ der Waffe.
 */
export function resolveDefaultTargetDistance(fireType: string, range: number): number {
  if (fireType === 'melee') {
    // Nahkampf: Ziel so platzieren, dass es sicher innerhalb der Reichweite liegt
    return Math.min(40, Math.max(10, range * 0.8));
  }
  // Fernkampf (Hitscan / Projektil): Standard-Prüfdistanz von 150px
  return Math.min(150, Math.max(40, range * 0.5));
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
  const attackWindowDurationMs = options.durationMs ?? 30_000;
  const stepDeltaMs = options.stepDeltaMs ?? 16;
  const seed = options.seed ?? 1;
  const maxSettleMs = options.maxSettleDurationMs ?? 5_000;
  const recordEvents = options.recordEvents ?? true;

  const targetDistance = options.targetDistance ?? resolveDefaultTargetDistance(config.fire.type, config.range);
  const world = new HeadlessSingleTargetWorld(targetDistance, seed, recordEvents);
  const weapon = new GenericWeapon(config);
  const executor = new WeaponFireExecutor(world);

  const shooterId = 'sim_player';
  const playerColor = 0xffffff;
  const shooterX = 0;
  const shooterY = 0;
  const targetX = world.target.x;
  const targetY = world.target.y;
  const targetAngle = Math.atan2(targetY - shooterY, targetX - shooterX);

  let currentTime = 0;
  const TIME_EPSILON = 1e-6;

  // ── Phase 1: Attack Window (Feuern + Simulation) ───────────────────────────
  while (currentTime < attackWindowDurationMs - TIME_EPSILON) {
    world.setTime(currentTime);

    const cooldownReady = !weapon.isOnCooldown(currentTime);
    const triggerReady = isSpreadWithinTriggerDiscipline(
      config,
      weapon.getDynamicSpread(),
      targetDistance,
      world.target.radius,
    );

    // 1. Feuern, wenn Cooldown abgelaufen ist UND Trigger Discipline Schussfreigabe erteilt
    if (cooldownReady && triggerReady) {
      const shotPlan = resolveShotPlan({
        config,
        aimAngle: targetAngle,
        dynamicSpread: weapon.getDynamicSpread(),
        isMoving: false,
        random: world.rng,
      });

      let anyFired = false;
      for (const shot of shotPlan.shots) {
        const fired = executor.fire(shot.config, {
          x: shooterX,
          y: shooterY,
          angle: shot.angle,
          targetX,
          targetY,
          ownerId: shooterId,
          ownerColor: playerColor,
          sourceSlot: slot,
        });
        if (fired) anyFired = true;
      }

      // Buchhaltung nur bei erfolgreichem Schuss
      if (anyFired) {
        world.recordShotFired();
        if (config.adrenalinCost > 0) {
          world.recordAdrenalineDrain(config.adrenalinCost, config.id);
        }
        weapon.addSpread();
        weapon.recordUse(currentTime);
      }
    }

    // 2. Nächsten exakten Ereignis-Zeitpunkt ermitteln
    const lastUsedAt = weapon.getLastUsedAt();
    const cooldownReadyTime = lastUsedAt < 0 ? 0 : lastUsedAt + config.cooldown;
    const recoveryStartTime = lastUsedAt < 0 ? 0 : lastUsedAt + config.spreadRecoveryDelay;
    const spreadReadyTime = calculateTriggerDisciplineReadyTime(
      config,
      weapon.getDynamicSpread(),
      lastUsedAt,
      currentTime,
      targetDistance,
      world.target.radius,
    );
    const nextActionTime = Math.max(cooldownReadyTime, spreadReadyTime);

    const nextStepBoundary = Math.min(attackWindowDurationMs, currentTime + stepDeltaMs);

    let nextTime = nextStepBoundary;
    if (cooldownReadyTime > currentTime + TIME_EPSILON && cooldownReadyTime < nextTime) {
      nextTime = cooldownReadyTime;
    }
    if (recoveryStartTime > currentTime + TIME_EPSILON && recoveryStartTime < nextTime) {
      nextTime = recoveryStartTime;
    }
    if (nextActionTime > currentTime + TIME_EPSILON && nextActionTime < nextTime) {
      nextTime = nextActionTime;
    }

    const subDelta = nextTime - currentTime;
    if (subDelta > TIME_EPSILON) {
      world.step(subDelta);

      const activeDecayDelta = Math.max(0, nextTime - Math.max(currentTime, recoveryStartTime));
      if (activeDecayDelta > 0) {
        weapon.decaySpread(activeDecayDelta, nextTime);
      }

      currentTime = Math.round(nextTime * 1e6) / 1e6;
      world.setTime(currentTime);
    } else {
      currentTime = Math.round(nextStepBoundary * 1e6) / 1e6;
      world.setTime(currentTime);
    }
  }

  // ── Phase 2: Settle Phase (keine neuen Schüsse, fliegende Projektile und Brand auslaufen lassen)
  const settleStart = currentTime;
  while (world.hasPendingCombatEffects(currentTime) && (currentTime - settleStart < maxSettleMs)) {
    const remainingSettle = maxSettleMs - (currentTime - settleStart);
    const stepMs = Math.min(stepDeltaMs, remainingSettle);
    if (stepMs <= 0) break;

    world.step(stepMs);
    currentTime += stepMs;
    world.setTime(currentTime);
  }
  const settleDurationMs = currentTime - settleStart;
  const settleTruncated = world.hasPendingCombatEffects(currentTime);

  // ── Phase 3: Metriken auswerten ───────────────────────────────────────────
  const totalDamage = world.getTotalDamage();
  const directDamage = world.getDirectDamage();
  const burnDamage = world.getBurnDamage();
  const shotsFired = world.getShotsFired();
  const hits = world.getHits();
  const totalExpectedPellets = shotsFired * resolveEffectivePelletCount(config);
  const hitRate = totalExpectedPellets > 0 ? hits / totalExpectedPellets : 0;
  const durationSec = attackWindowDurationMs / 1000;
  const dps = durationSec > 0 ? totalDamage / durationSec : 0;
  const directDps = durationSec > 0 ? directDamage / durationSec : 0;
  const burnDps = durationSec > 0 ? burnDamage / durationSec : 0;
  const adrenalineGenerated = world.getAdrenalineGenerated();
  const adrenalineSpent = world.getAdrenalineSpent();
  const adrenalineGeneratedPerSec = durationSec > 0 ? adrenalineGenerated / durationSec : 0;
  const adrenalineSpentPerSec = durationSec > 0 ? adrenalineSpent / durationSec : 0;

  return {
    weaponId: config.id,
    durationMs: attackWindowDurationMs,
    settleDurationMs,
    totalDamage,
    directDamage,
    burnDamage,
    dps,
    directDps,
    burnDps,
    shotsFired,
    hits,
    hitRate,
    adrenalineGenerated,
    adrenalineSpent,
    adrenalineGeneratedPerSec,
    adrenalineSpentPerSec,
    settleTruncated,
    damageEvents: world.getDamageEvents(),
    resourceEvents: world.getResourceEvents(),
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

  const runs: SingleTargetBenchmarkResult[] = [];
  const dpsValues: number[] = [];

  let totalDurationSec = 0;
  let totalDamage = 0;
  let totalDirectDamage = 0;
  let totalBurnDamage = 0;
  let totalShots = 0;
  let totalHits = 0;
  let totalPossiblePellets = 0;
  let totalAdrenalineGen = 0;
  let totalAdrenalineSpent = 0;
  let anyTruncated = false;

  const recordEvents = options.includeIndividualRuns ?? false;

  for (const seed of seeds) {
    const result = runWeaponSingleTargetBenchmark({
      weaponId: options.weaponId,
      weaponConfigOverride: options.weaponConfigOverride,
      sourceSlot: options.sourceSlot,
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
    totalShots += result.shotsFired;
    totalHits += result.hits;

    const config = options.weaponConfigOverride ?? getWeaponConfig(options.weaponId);
    const pelletsPerShot = config ? resolveEffectivePelletCount(config) : 1;
    totalPossiblePellets += result.shotsFired * pelletsPerShot;

    totalAdrenalineGen += result.adrenalineGenerated;
    totalAdrenalineSpent += result.adrenalineSpent;
    if (result.settleTruncated) anyTruncated = true;
  }

  const sortedDps = [...dpsValues].sort((a, b) => a - b);
  const expectedDps = totalDurationSec > 0 ? totalDamage / totalDurationSec : 0;
  const expectedDirectDps = totalDurationSec > 0 ? totalDirectDamage / totalDurationSec : 0;
  const expectedBurnDps = totalDurationSec > 0 ? totalBurnDamage / totalDurationSec : 0;
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
    seedCount: n,
    seeds: [...seeds],
    expectedDps,
    expectedDirectDps,
    expectedBurnDps,
    medianDps,
    p10Dps,
    p90Dps,
    minDps,
    maxDps,
    expectedHitRate,
    expectedShotsPerSecond,
    expectedAdrenalineGeneratedPerSec,
    expectedAdrenalineSpentPerSec,
    settleTruncated: anyTruncated ? true : undefined,
    runs: recordEvents ? runs : undefined,
  };
}
