import { GenericWeapon } from '../../loadout/GenericWeapon';
import { WeaponFireExecutor } from '../../loadout/WeaponFireExecutor';
import { resolveShotPlan } from '../../loadout/ShotPlanResolver';
import type { WeaponConfig } from '../../loadout/LoadoutConfig';
import type { WeaponSlot } from '../../types';
import { HeadlessStaticTargetWorld } from './HeadlessStaticTargetWorld';

export interface StaticTargetAimState {
  readonly aimAngle: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly triggerTargetDistance: number;
  readonly triggerTargetRadius: number;
}

export interface StaticTargetBenchmarkController {
  readonly resolveAim: (
    config: WeaponConfig,
    world: HeadlessStaticTargetWorld,
  ) => StaticTargetAimState;
  readonly isTriggerReady: (
    config: WeaponConfig,
    dynamicSpread: number,
    aim: StaticTargetAimState,
  ) => boolean;
  readonly calculateTriggerReadyTime: (
    config: WeaponConfig,
    dynamicSpread: number,
    lastUsedAt: number,
    now: number,
    aim: StaticTargetAimState,
  ) => number;
}

export interface StaticTargetBenchmarkCoreOptions {
  readonly config: WeaponConfig;
  readonly sourceSlot: WeaponSlot;
  readonly world: HeadlessStaticTargetWorld;
  readonly controller: StaticTargetBenchmarkController;
  readonly measurementStartMs: number;
  readonly measurementEndMs: number;
  readonly stepDeltaMs: number;
  readonly maxSettleMs: number;
}

export interface StaticTargetBenchmarkCoreResult {
  readonly settleDurationMs: number;
  readonly settleTruncated: boolean;
  readonly primaryMetricComplete: boolean;
}

/**
 * Gemeinsame virtuelle Feuer-/Zeit-Orchestrierung fuer Single Target und Five Target.
 * Szenarien liefern nur Aim-/Trigger-Kontext und die bereits erzeugte World-Geometrie.
 */
export function runStaticTargetBenchmarkCore(
  options: StaticTargetBenchmarkCoreOptions,
): StaticTargetBenchmarkCoreResult {
  const {
    config,
    sourceSlot,
    world,
    controller,
    measurementStartMs,
    measurementEndMs,
    stepDeltaMs,
    maxSettleMs,
  } = options;
  if (!Number.isFinite(measurementStartMs) || !Number.isFinite(measurementEndMs) || measurementEndMs < measurementStartMs) {
    throw new Error('[WeaponBalanceLab] Ungueltiges Measurement Window fuer den statischen Benchmark.');
  }
  if (!Number.isFinite(stepDeltaMs) || stepDeltaMs <= 0) {
    throw new Error('[WeaponBalanceLab] stepDeltaMs muss positiv und endlich sein.');
  }
  if (!Number.isFinite(maxSettleMs) || maxSettleMs < 0) {
    throw new Error('[WeaponBalanceLab] maxSettleMs darf nicht negativ oder unendlich sein.');
  }
  const weapon = new GenericWeapon(config);
  const executor = new WeaponFireExecutor(world);
  const shooterId = 'sim_player';
  const playerColor = 0xffffff;
  const shooterX = 0;
  const shooterY = 0;
  let currentTime = 0;
  const TIME_EPSILON = 1e-6;

  while (currentTime < measurementEndMs - TIME_EPSILON) {
    world.setTime(currentTime);
    const aim = controller.resolveAim(config, world);
    const cooldownReady = !weapon.isOnCooldown(currentTime);
    const triggerReady = controller.isTriggerReady(
      config,
      weapon.getDynamicSpread(),
      aim,
    );

    if (cooldownReady && triggerReady) {
      const shotPlan = resolveShotPlan({
        config,
        aimAngle: aim.aimAngle,
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
          targetX: aim.targetX,
          targetY: aim.targetY,
          ownerId: shooterId,
          ownerColor: playerColor,
          sourceSlot,
        });
        if (fired) anyFired = true;
      }

      if (anyFired) {
        world.recordShotFired(currentTime);
        if (config.adrenalinCost > 0) {
          world.recordAdrenalineDrain(config.adrenalinCost, config.id, currentTime);
        }
        weapon.addSpread();
        weapon.recordUse(currentTime);
      }
    }

    const lastUsedAt = weapon.getLastUsedAt();
    const cooldownReadyTime = lastUsedAt < 0 ? 0 : lastUsedAt + config.cooldown;
    const recoveryStartTime = lastUsedAt < 0 ? 0 : lastUsedAt + config.spreadRecoveryDelay;
    // Die statischen Zielpositionen und die Aim-Policy ändern sich innerhalb dieses
    // synchronen Scheduling-Schritts nicht. Dieselbe Auflösung reicht auch für die
    // Trigger-Zeitberechnung und vermeidet eine zweite geometrische Berechnung.
    const nextAim = aim;
    const spreadReadyTime = controller.calculateTriggerReadyTime(
      config,
      weapon.getDynamicSpread(),
      lastUsedAt,
      currentTime,
      nextAim,
    );
    const nextActionTime = Math.max(cooldownReadyTime, spreadReadyTime);
    const nextStepBoundary = Math.min(measurementEndMs, currentTime + stepDeltaMs);

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
      if (activeDecayDelta > 0) weapon.decaySpread(activeDecayDelta, nextTime);
      currentTime = Math.round(nextTime * 1e6) / 1e6;
      world.setTime(currentTime);
    } else {
      currentTime = Math.round(nextStepBoundary * 1e6) / 1e6;
      world.setTime(currentTime);
    }
  }

  const settleStart = currentTime;
  while (world.hasPendingCombatEffects(currentTime) && (currentTime - settleStart < maxSettleMs)) {
    const remainingSettle = maxSettleMs - (currentTime - settleStart);
    const stepMs = Math.min(stepDeltaMs, remainingSettle);
    if (stepMs <= 0) break;
    world.step(stepMs);
    currentTime += stepMs;
    world.setTime(currentTime);
  }

  const settleTruncated = world.hasPendingCombatEffects(currentTime);
  return {
    settleDurationMs: currentTime - settleStart,
    settleTruncated,
    primaryMetricComplete: currentTime >= measurementEndMs - TIME_EPSILON,
  };
}
