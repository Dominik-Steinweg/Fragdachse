/**
 * Replicated, host-decided gather-and-fire cycle of a salvo weapon with an authored `salvo.chargeMs`
 * (the Grave Titan's grave lights). The host publishes every transition with a growing `revision`;
 * clients only draw the timeline (gathering swarm, launched lights, refilling swarm).
 *
 * Timeline (host time, ms): `chargeStartAt` (gathering starts) → `fireAt` (first shot) → `endedAt`
 * (last shot or abort; 0 while the salvo runs) → `rechargedAt` (pause over, weapon ready; 0 while it
 * runs). `shotsFired` is published with the end; a cycle that ends with 0 shots was cancelled. The
 * phase is derived from the timestamps and never sent.
 */
export type EnemyVolleyPhase = 'ready' | 'charge' | 'fire' | 'recharge';

export interface EnemyVolleyState {
  readonly revision: number;
  readonly chargeStartAt: number;
  readonly fireAt: number;
  readonly endedAt: number;
  readonly rechargedAt: number;
  readonly shotsFired: number;
}

export const EMPTY_ENEMY_VOLLEY_STATE: EnemyVolleyState = Object.freeze({
  revision: 0, chargeStartAt: 0, fireAt: 0, endedAt: 0, rechargedAt: 0, shotsFired: 0,
});

export function enemyVolleyPhaseAt(state: EnemyVolleyState, now: number): EnemyVolleyPhase {
  if (state.revision === 0 || now < state.chargeStartAt) return 'ready';
  if (state.endedAt > 0 && now >= state.endedAt) return now < state.rechargedAt ? 'recharge' : 'ready';
  return now < state.fireAt ? 'charge' : 'fire';
}

/** Gather progress in [0, 1] during the charge, 1 afterwards until the cycle ends. */
export function enemyVolleyChargeAt(state: EnemyVolleyState, now: number): number {
  const phase = enemyVolleyPhaseAt(state, now);
  if (phase === 'fire') return 1;
  if (phase !== 'charge') return 0;
  return Math.max(0, Math.min(1, (now - state.chargeStartAt) / Math.max(1, state.fireAt - state.chargeStartAt)));
}

/** True when the cycle ended without a single shot (target lost, stunned, interrupted). */
export function isEnemyVolleyCancelled(state: EnemyVolleyState): boolean {
  return state.endedAt > 0 && state.shotsFired === 0;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Structural validation for decoded or remote state; invalid optional state is ignored. */
export function isEnemyVolleyState(value: unknown): value is EnemyVolleyState {
  if (!value || typeof value !== 'object') return false;
  const state = value as EnemyVolleyState;
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) return false;
  if (![state.chargeStartAt, state.fireAt, state.endedAt, state.rechargedAt].every(finite)) return false;
  if (!Number.isSafeInteger(state.shotsFired) || state.shotsFired < 0) return false;
  if (state.chargeStartAt > state.fireAt) return false;
  // The end, the recharge and the shot count are published together; the pause never ends before the salvo.
  if ((state.endedAt === 0) !== (state.rechargedAt === 0)) return false;
  if (state.endedAt === 0) return state.shotsFired === 0;
  return state.chargeStartAt <= state.endedAt && state.endedAt <= state.rechargedAt;
}
