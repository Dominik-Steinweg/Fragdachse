import type { CoopDefenseEnemyHeatBurstConfig } from '../config/coopDefenseEnemies';
import { enemyHeatAt, enemyHeatBurstPhaseAt, type EnemyHeatBurstState } from './EnemyHeatBurstState';
import { pounceUnitHash } from './enemyPounceRules';

/**
 * Pure heat-cycle rules shared by the host decision and the client presentation: per-body charge
 * time, the speed ramp, the burst grid of the pack cascade and the fizzle size.
 */

/** Charge time of one body: fixed per body (a steady rhythm), spread over the authored range. */
export function heatChargeMs(enemyId: string, config: CoopDefenseEnemyHeatBurstConfig): number {
  return Math.round(config.chargeMinMs + (config.chargeMaxMs - config.chargeMinMs) * pounceUnitHash(enemyId, 0, 23));
}

/** Speed factor at heat `heat` in [0, 1]: eased from 1 to 1 + boost. */
export function heatSpeedFactor(heat: number, config: CoopDefenseEnemyHeatBurstConfig): number {
  return 1 + config.speedBoost * Math.pow(Math.max(0, Math.min(1, heat)), config.speedCurveExponent);
}

/** Speed factor of a body at host time `now`: ramps while charging, holds at full, back to 1 after the burst. */
export function heatSpeedFactorAt(state: EnemyHeatBurstState, config: CoopDefenseEnemyHeatBurstConfig, now: number): number {
  return heatSpeedFactor(enemyHeatAt(state, now), config);
}

/** True while the body runs its warning (the burst is booked and the zone shows). */
export function isHeatTelegraphAt(state: EnemyHeatBurstState, now: number): boolean {
  return enemyHeatBurstPhaseAt(state, now) === 'telegraph';
}

/** Offset of a body's burst on its grid slot, in [-jitterMs, jitterMs], new for every cycle. */
export function heatSlotJitterMs(enemyId: string, cycle: number, config: CoopDefenseEnemyHeatBurstConfig): number {
  return (2 * pounceUnitHash(enemyId, cycle, 29) - 1) * config.cascade.jitterMs;
}

/** Host time of grid slot `slot` for one body and cycle. */
export function heatSlotTime(slot: number, jitterMs: number, config: CoopDefenseEnemyHeatBurstConfig): number {
  return slot * config.cascade.stepMs + jitterMs;
}

/** First grid slot whose burst lies at or after `earliest`. */
export function heatFirstSlotAtOrAfter(earliest: number, jitterMs: number, config: CoopDefenseEnemyHeatBurstConfig): number {
  return Math.ceil((earliest - jitterMs) / config.cascade.stepMs);
}

/** Fizzle radius of a body killed at heat `heat`; null below the authored minimum heat. */
export function heatFizzleRadius(heat: number, config: CoopDefenseEnemyHeatBurstConfig): number | null {
  const { minHeat, minRadiusPx, maxRadiusPx } = config.fizzle;
  if (heat < minHeat) return null;
  const share = minHeat >= 1 ? 1 : (heat - minHeat) / (1 - minHeat);
  return minRadiusPx + (maxRadiusPx - minRadiusPx) * Math.max(0, Math.min(1, share));
}
