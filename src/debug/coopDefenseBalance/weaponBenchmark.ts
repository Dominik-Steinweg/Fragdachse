import { getWeaponConfig } from '../../loadout/LoadoutConfig';
import { GenericWeapon } from '../../loadout/GenericWeapon';
import { WeaponFireExecutor } from '../../loadout/WeaponFireExecutor';
import { resolveShotPlan, resolveEffectivePelletCount } from '../../loadout/ShotPlanResolver';
import { HeadlessSingleTargetWorld } from './HeadlessSingleTargetWorld';
import { assertWeaponBalanceSupported } from './weaponCapabilityValidator';
import {
  isSpreadWithinTriggerDiscipline,
  calculateTriggerDisciplineReadyTime,
} from './triggerDiscipline';
import type {
  SingleTargetBenchmarkOptions,
  SingleTargetBenchmarkResult,
} from './weaponBenchmarkTypes';

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
 * Führt einen deterministischen Headless-Single-Target-Benchmark für die angegebene Waffe aus.
 *
 * Simuliert das Feuern mit optimaler Trigger Discipline (Schussfreigabe nur bei zuverlässiger
 * Zielabdeckung) über das definierte Angriffsfenster (Attack Window) und lässt in der
 * anschließenden Settle-Phase verbleibende Projektile im Flug auflösen.
 *
 * Verwendet einen sub-step-genauen Event-Scheduler, damit die Feuerrate unabhängig von `stepDeltaMs`
 * mathematisch exakt auf den Cooldown-, Recovery- und Schussfreigabe-Zeitpunkten stattfindet.
 *
 * @param options Konfigurationsparameter des Benchmark-Laufs
 * @returns Strukturiertes Messergebnis inklusive DPS, Trefferquote und Event-Historie
 */
export function runWeaponSingleTargetBenchmark(
  options: SingleTargetBenchmarkOptions,
): SingleTargetBenchmarkResult {
  const config = options.weaponConfigOverride ?? getWeaponConfig(options.weaponId);
  if (!config) {
    throw new Error(`[WeaponBalanceLab] Unbekannte Weapon-ID: "${options.weaponId}"`);
  }

  // Capability-Check: nicht unterstützte Mechaniken explizit ablehnen
  assertWeaponBalanceSupported(config);

  const attackWindowDurationMs = options.durationMs ?? 30_000;
  const stepDeltaMs = options.stepDeltaMs ?? 16;
  const seed = options.seed ?? 1;
  const slot = options.sourceSlot ?? config.allowedSlots[0] ?? 'weapon1';
  const maxSettleMs = options.maxSettleDurationMs ?? 5_000;

  const targetDistance = options.targetDistance ?? resolveDefaultTargetDistance(config.fire.type, config.range);
  const world = new HeadlessSingleTargetWorld(targetDistance, seed);
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

  // ── Phase 2: Settle Phase (keine neuen Schüsse, fliegende Projektile auflösen)
  const settleStart = currentTime;
  while (world.hasActiveProjectiles() && (currentTime - settleStart < maxSettleMs)) {
    const remainingSettle = maxSettleMs - (currentTime - settleStart);
    const stepMs = Math.min(stepDeltaMs, remainingSettle);
    if (stepMs <= 0) break;

    world.step(stepMs);
    currentTime += stepMs;
    world.setTime(currentTime);
  }
  const settleDurationMs = currentTime - settleStart;

  // ── Phase 3: Metriken auswerten (DPS-Nenner ist exakt das Angriffsfenster) ──
  const totalDamage = world.getTotalDamage();
  const shotsFired = world.getShotsFired();
  const hits = world.getHits();
  const totalExpectedPellets = shotsFired * resolveEffectivePelletCount(config);
  const hitRate = totalExpectedPellets > 0 ? hits / totalExpectedPellets : 0;
  const durationSec = attackWindowDurationMs / 1000;
  const dps = durationSec > 0 ? totalDamage / durationSec : 0;
  const adrenalineGenerated = world.getAdrenalineGenerated();
  const adrenalineSpent = world.getAdrenalineSpent();
  const adrenalineGeneratedPerSec = durationSec > 0 ? adrenalineGenerated / durationSec : 0;
  const adrenalineSpentPerSec = durationSec > 0 ? adrenalineSpent / durationSec : 0;

  return {
    weaponId: config.id,
    durationMs: attackWindowDurationMs,
    settleDurationMs,
    totalDamage,
    dps,
    shotsFired,
    hits,
    hitRate,
    adrenalineGenerated,
    adrenalineSpent,
    adrenalineGeneratedPerSec,
    adrenalineSpentPerSec,
    damageEvents: world.getDamageEvents(),
    resourceEvents: world.getResourceEvents(),
  };
}
