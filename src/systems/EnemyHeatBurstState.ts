/**
 * Replicated, host-decided heat cycle of one enemy (the Demon Badger). The host publishes every
 * transition with a growing `revision`; clients only draw the timeline (glow ramp, travelling
 * warning zone, burst recoil, speed-matched gait).
 *
 * Timeline (host time, ms): `ventFromAt` (previous burst, 0 before the first) → `chargeStartAt`
 * (heat 0) → `fullAt` (heat 1, the body holds until its slot) → `telegraphAt` (warning) →
 * `burstAt`. `telegraphAt`/`burstAt` are 0 while no slot is booked. The phase is derived from the
 * timestamps and never sent.
 */
export type EnemyHeatBurstPhase = 'vent' | 'charge' | 'hold' | 'telegraph';

export interface EnemyHeatBurstState {
  readonly revision: number;
  readonly ventFromAt: number;
  readonly chargeStartAt: number;
  readonly fullAt: number;
  readonly telegraphAt: number;
  readonly burstAt: number;
}

export const EMPTY_ENEMY_HEAT_BURST_STATE: EnemyHeatBurstState = Object.freeze({
  revision: 0, ventFromAt: 0, chargeStartAt: 0, fullAt: 0, telegraphAt: 0, burstAt: 0,
});

/**
 * `vent` before the charge starts and once a booked burst has passed, so clients show the cool-down
 * before the host's next cycle arrives.
 */
export function enemyHeatBurstPhaseAt(state: EnemyHeatBurstState, now: number): EnemyHeatBurstPhase {
  if (state.revision === 0 || now < state.chargeStartAt || (state.burstAt > 0 && now >= state.burstAt)) return 'vent';
  if (now < state.fullAt) return 'charge';
  return state.telegraphAt > 0 && now >= state.telegraphAt ? 'telegraph' : 'hold';
}

/** Linear charge progress in [0, 1]: 0 while venting, 1 while holding or warning. */
export function enemyHeatAt(state: EnemyHeatBurstState, now: number): number {
  const phase = enemyHeatBurstPhaseAt(state, now);
  if (phase === 'vent') return 0;
  if (phase !== 'charge') return 1;
  return Math.max(0, Math.min(1, (now - state.chargeStartAt) / Math.max(1, state.fullAt - state.chargeStartAt)));
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Structural validation for decoded or remote state; invalid optional state is ignored. */
export function isEnemyHeatBurstState(value: unknown): value is EnemyHeatBurstState {
  if (!value || typeof value !== 'object') return false;
  const state = value as EnemyHeatBurstState;
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) return false;
  if (![state.ventFromAt, state.chargeStartAt, state.fullAt, state.telegraphAt, state.burstAt].every(finite)) return false;
  if (state.ventFromAt > state.chargeStartAt || state.chargeStartAt > state.fullAt) return false;
  // A slot is booked as a pair: the warning starts at full heat at the earliest and ends in the burst.
  if ((state.telegraphAt === 0) !== (state.burstAt === 0)) return false;
  return state.telegraphAt === 0 || (state.fullAt <= state.telegraphAt && state.telegraphAt < state.burstAt);
}
