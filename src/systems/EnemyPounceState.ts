/**
 * Replicated, host-decided pounce of one enemy (the Rabid Rabbit). The host publishes every
 * transition with a growing `revision`; clients only draw the timeline (aim stance with a landing
 * zone that predicts the target's path, the locked zone, the flight on its line, the recovery).
 *
 * Timeline (host time, ms): `aimAt` → `lockAt` (the zone follows the predicted landing point) →
 * `landing.takeoffAt` (zone fixed) → `landing.landAt` (impact) → `landing.recoverUntil`. The landing
 * is null until the lock; the phase is derived from timestamps and never sent.
 */
// Append-only: the index is the wire code.
export const ENEMY_POUNCE_TARGET_KINDS = ['player', 'decoy'] as const;
export type EnemyPounceTargetKind = typeof ENEMY_POUNCE_TARGET_KINDS[number];

export type EnemyPouncePhase = 'idle' | 'aim' | 'lock' | 'air' | 'recover';

export interface EnemyPounceTargetRef {
  readonly kind: EnemyPounceTargetKind;
  readonly id: string;
}

/** Host-locked landing: announced point, flight timeline and whether the impact still counts. */
export interface EnemyPounceLanding {
  readonly x: number;
  readonly y: number;
  readonly takeoffAt: number;
  readonly landAt: number;
  readonly recoverUntil: number;
  /** False after an abort (stun, teleport in the air): the body comes down without an impact. */
  readonly armed: boolean;
}

export interface EnemyPounce {
  readonly target: EnemyPounceTargetRef;
  /** Where the body stands while aiming; the flight starts here. */
  readonly originX: number;
  readonly originY: number;
  readonly aimAt: number;
  readonly lockAt: number;
  readonly landing: EnemyPounceLanding | null;
}

export interface EnemyPounceState {
  readonly revision: number;
  readonly pounce: EnemyPounce | null;
}

export const EMPTY_ENEMY_POUNCE_STATE: EnemyPounceState = Object.freeze({ revision: 0, pounce: null });

export function enemyPouncePhaseAt(state: EnemyPounceState, now: number): EnemyPouncePhase {
  const pounce = state.pounce;
  if (!pounce || now < pounce.aimAt) return 'idle';
  const landing = pounce.landing;
  // Until the host publishes the lock the body keeps aiming, even past `lockAt`.
  if (!landing) return 'aim';
  if (now < landing.takeoffAt) return 'lock';
  if (now < landing.landAt) return 'air';
  return now < landing.recoverUntil ? 'recover' : 'idle';
}

/** Flight progress in [0, 1]; 0 before take-off, 1 once landed. */
export function enemyPounceAirProgress(landing: EnemyPounceLanding, now: number): number {
  return Math.max(0, Math.min(1, (now - landing.takeoffAt) / Math.max(1, landing.landAt - landing.takeoffAt)));
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Structural validation for decoded or remote state; invalid optional state is ignored. */
export function isEnemyPounceState(value: unknown): value is EnemyPounceState {
  if (!value || typeof value !== 'object') return false;
  const state = value as EnemyPounceState;
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) return false;
  const pounce = state.pounce;
  if (pounce === null) return true;
  if (!pounce || typeof pounce !== 'object') return false;
  const target = pounce.target;
  if (!target || typeof target !== 'object' || !ENEMY_POUNCE_TARGET_KINDS.includes(target.kind)
    || typeof target.id !== 'string' || target.id.length === 0) return false;
  if (![pounce.originX, pounce.originY, pounce.aimAt, pounce.lockAt].every(finite) || pounce.aimAt > pounce.lockAt) return false;
  const landing = pounce.landing;
  if (landing === null) return true;
  return !!landing && typeof landing === 'object' && typeof landing.armed === 'boolean'
    && [landing.x, landing.y, landing.takeoffAt, landing.landAt, landing.recoverUntil].every(finite)
    && landing.takeoffAt <= landing.landAt && landing.landAt <= landing.recoverUntil;
}
