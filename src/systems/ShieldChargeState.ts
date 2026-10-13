/**
 * Replicated, host-fixed shield charge of one enemy. The host decides every value; clients only
 * draw it (no target prediction). `revision` grows with every change so stale deltas never restart
 * a telegraph.
 *
 * Timeline (host time, ms): startedAt → windup (shield down, lane fixed) → runAt → run →
 * runEndsAt (planned end; an earlier stop republishes a shorter `length` and `runEndsAt`) →
 * recover → recoverUntil.
 */
export type ShieldChargePhase = 'none' | 'windup' | 'run' | 'recover';
export const SHIELD_CHARGE_PHASES = ['none', 'windup', 'run', 'recover'] as const satisfies readonly ShieldChargePhase[];

export interface ShieldChargeLane {
  readonly originX: number;
  readonly originY: number;
  /** Fixed world direction of the lane in radians. */
  readonly angle: number;
  /** Centre-line length from origin to the end point (already clipped by world geometry). */
  readonly length: number;
  /** Half width of the movement corridor (body radius). */
  readonly halfWidth: number;
  readonly startedAt: number;
  readonly runAt: number;
  readonly runEndsAt: number;
  readonly recoverUntil: number;
}

export interface ShieldChargeState {
  readonly revision: number;
  readonly phase: ShieldChargePhase;
  readonly lane: ShieldChargeLane | null;
}

export const EMPTY_SHIELD_CHARGE_STATE: ShieldChargeState = Object.freeze({ revision: 0, phase: 'none', lane: null });

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Structural validation for decoded or remote state; invalid optional state is ignored. */
export function isShieldChargeState(value: unknown): value is ShieldChargeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as ShieldChargeState;
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) return false;
  if (!(SHIELD_CHARGE_PHASES as readonly string[]).includes(state.phase)) return false;
  if (state.phase === 'none') return state.lane === null;
  const lane = state.lane;
  return !!lane && [lane.originX, lane.originY, lane.angle, lane.length, lane.halfWidth,
    lane.startedAt, lane.runAt, lane.runEndsAt, lane.recoverUntil].every(finite)
    && lane.length >= 0 && lane.halfWidth > 0
    && lane.startedAt <= lane.runAt && lane.runAt <= lane.runEndsAt && lane.runEndsAt <= lane.recoverUntil;
}

/** Point on the lane centre line at `distance` from the origin. */
export function shieldChargeLanePoint(lane: ShieldChargeLane, distance: number): { x: number; y: number } {
  return { x: lane.originX + Math.cos(lane.angle) * distance, y: lane.originY + Math.sin(lane.angle) * distance };
}
