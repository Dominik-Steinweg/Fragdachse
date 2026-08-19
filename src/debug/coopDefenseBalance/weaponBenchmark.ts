import { getWeaponConfig } from '../../loadout/LoadoutConfig';
import { GenericWeapon } from '../../loadout/GenericWeapon';
import { WeaponFireExecutor } from '../../loadout/WeaponFireExecutor';
import { resolveShotPlan, resolveEffectivePelletCount } from '../../loadout/ShotPlanResolver';
import { HeadlessSingleTargetWorld } from './HeadlessSingleTargetWorld';
import { assertWeaponBalanceSupported } from './weaponCapabilityValidator';
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
 * Simuliert das Feuern mit maximal zulässiger Kadenz über das definierte Angriffsfenster (Attack Window)
 * und lässt in der anschließenden Settle-Phase verbleibende Projektile im Flug auflösen.
 *
 * Verwendet einen sub-step-genauen Scheduler, damit die Feuerrate unabhängig von `stepDeltaMs`
 * mathematisch exakt auf den Cooldown-Zeitpunkten stattfindet.
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

  // ── Phase 1: Attack Window (Feuern + Simulation) ───────────────────────────
  while (currentTime < attackWindowDurationMs) {
    world.setTime(currentTime);

    // 1. Feuern, wenn Cooldown abgelaufen ist
    if (!weapon.isOnCooldown(currentTime)) {
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

      // Buchhaltung exakt wie in der Runtime nur bei erfolgreichem Schuss ausführen
      if (anyFired) {
        world.recordShotFired();
        if (config.adrenalinCost > 0) {
          world.recordAdrenalineDrain(config.adrenalinCost, config.id);
        }
        weapon.addSpread();
        weapon.recordUse(currentTime);
      }
    }

    // 2. Nächsten Zeitschritt ermitteln (Sub-Stepping auf exakte Cooldown-Ready-Events)
    const lastUsedAt = weapon.getLastUsedAt();
    const nextReadyTime = lastUsedAt < 0 ? 0 : lastUsedAt + config.cooldown;
    const nextStepBoundary = Math.min(attackWindowDurationMs, currentTime + stepDeltaMs);

    let nextTime: number;
    if (nextReadyTime > currentTime && nextReadyTime < nextStepBoundary) {
      nextTime = nextReadyTime;
    } else {
      nextTime = nextStepBoundary;
    }

    const subDelta = nextTime - currentTime;
    if (subDelta > 0) {
      world.step(subDelta);
      weapon.decaySpread(subDelta, nextTime);
      currentTime = nextTime;
      world.setTime(currentTime);
    } else {
      currentTime = nextStepBoundary;
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
