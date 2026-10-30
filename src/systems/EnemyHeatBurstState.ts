/**
 * Replicated, host-decided heat of one enemy (the Demon Badger). Every salvo the body spits adds a
 * heat stage that it keeps until it dies; the last stage starts its meltdown: a warning at a standing
 * body, then the burst in which it dies. The host publishes every transition with a growing
 * `revision`; clients only draw it (stage glow, step flare, warning zone, burst).
 *
 * `stage` counts the reached heat stages (0 = cold), `stageAt` is the host time of the last step (0
 * before the first). `telegraphAt`/`burstAt` (host time, ms) are 0 until the meltdown is booked. The
 * phase is derived from the timestamps and never sent.
 */
export type EnemyHeatBurstPhase = 'heat' | 'telegraph' | 'burst';

export interface EnemyHeatBurstState {
  readonly revision: number;
  readonly stage: number;
  readonly stageAt: number;
  readonly telegraphAt: number;
  readonly burstAt: number;
}

export const EMPTY_ENEMY_HEAT_BURST_STATE: EnemyHeatBurstState = Object.freeze({
  revision: 0, stage: 0, stageAt: 0, telegraphAt: 0, burstAt: 0,
});

/** Upper bound of a replicated stage count (authored configs stay far below it). */
export const MAX_ENEMY_HEAT_STAGES = 16;

/** `burst` once a booked burst has passed, so clients keep showing it until the body is removed. */
export function enemyHeatBurstPhaseAt(state: EnemyHeatBurstState, now: number): EnemyHeatBurstPhase {
  if (state.burstAt > 0 && now >= state.burstAt) return 'burst';
  return state.telegraphAt > 0 && now >= state.telegraphAt ? 'telegraph' : 'heat';
}

/** Heat in [0, 1]: the share of reached stages. */
export function enemyHeatAt(state: EnemyHeatBurstState, stages: number): number {
  return stages > 0 ? Math.max(0, Math.min(1, state.stage / stages)) : 0;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Structural validation for decoded or remote state; invalid optional state is ignored. */
export function isEnemyHeatBurstState(value: unknown): value is EnemyHeatBurstState {
  if (!value || typeof value !== 'object') return false;
  const state = value as EnemyHeatBurstState;
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) return false;
  if (!Number.isInteger(state.stage) || state.stage < 0 || state.stage > MAX_ENEMY_HEAT_STAGES) return false;
  if (![state.stageAt, state.telegraphAt, state.burstAt].every(finite) || state.stageAt < 0) return false;
  // The meltdown is booked as a pair: the warning starts after the last step and ends in the burst.
  if ((state.telegraphAt === 0) !== (state.burstAt === 0)) return false;
  return state.telegraphAt === 0 || (state.stage > 0 && state.stageAt <= state.telegraphAt && state.telegraphAt < state.burstAt);
}
