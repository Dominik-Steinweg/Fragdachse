import type { CoopDefenseEnemyHeatBurstConfig } from '../config/coopDefenseEnemies';
import { enemyHeatBurstPhaseAt, type EnemyHeatBurstState } from './EnemyHeatBurstState';
import { pounceUnitHash } from './enemyPounceRules';

/**
 * Pure heat rules shared by the host decision and the client presentation: the speed of a stage,
 * the salvo pause of a stage (with the fixed per-body spread that keeps a pack apart) and the fizzle
 * size of a killed body.
 */

/** Speed factor at `stage`: rises linearly from 1 (cold) to 1 + boost (all stages). */
export function heatStageSpeedFactor(stage: number, config: CoopDefenseEnemyHeatBurstConfig): number {
  return 1 + config.speedBoost * Math.max(0, Math.min(1, stage / config.stages));
}

/** Speed factor of a replicated heat state; it never falls back while the body lives. */
export function heatSpeedFactorOf(state: EnemyHeatBurstState, config: CoopDefenseEnemyHeatBurstConfig): number {
  return heatStageSpeedFactor(state.stage, config);
}

/** Fixed spread of one body's salvo pause in [1 - jitter, 1 + jitter] (hashed from its id). */
export function heatSalvoPauseSpread(enemyId: string, config: CoopDefenseEnemyHeatBurstConfig): number {
  return 1 + (2 * pounceUnitHash(enemyId, 0, 31) - 1) * config.salvoPauseJitter;
}

/** Pause after a salvo spat at `stage` (the stage before the salvo's step), with the body's spread. */
export function heatSalvoPauseMs(stage: number, enemyId: string, config: CoopDefenseEnemyHeatBurstConfig): number {
  const pauses = config.salvoPauseMsByStage;
  return Math.round(pauses[Math.max(0, Math.min(pauses.length - 1, stage))] * heatSalvoPauseSpread(enemyId, config));
}

/** True while the meltdown warning runs (the zone shows, the body stands). */
export function isHeatTelegraphAt(state: EnemyHeatBurstState, now: number): boolean {
  return enemyHeatBurstPhaseAt(state, now) === 'telegraph';
}

/** Fizzle radius of a body killed at `stage`; null below the authored minimum stage. */
export function heatFizzleRadius(stage: number, config: CoopDefenseEnemyHeatBurstConfig): number | null {
  const { minStage, minRadiusPx, maxRadiusPx } = config.fizzle;
  if (stage < minStage || stage <= 0) return null;
  const share = config.stages <= minStage ? 1 : (stage - minStage) / (config.stages - minStage);
  return minRadiusPx + (maxRadiusPx - minRadiusPx) * Math.max(0, Math.min(1, share));
}
