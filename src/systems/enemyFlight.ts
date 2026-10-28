/**
 * Host flight core of announced enemy jumps (toad hop, rabbit pounce): clients interpolate a body
 * from origin to target over takeoffAt → landAt, so the host keeps the body on that timeline and
 * re-describes it when physics slows the flight (time bubble, slow status).
 */

export interface EnemyFlightLine {
  readonly originX: number;
  readonly originY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly takeoffAt: number;
  readonly landAt: number;
}

/** Host bookkeeping of one flight: last movement (stall detection) and last re-time. */
export interface EnemyFlightTracker {
  lastX: number;
  lastY: number;
  lastMovedAt: number;
  retimedAt: number;
}

export type EnemyFlightStep =
  /** The body reached the target; `early` when it arrived before the announced landing. */
  | { readonly kind: 'arrived'; readonly early: boolean }
  /** Interrupted, stalled or overdue: the flight ends where the body is. */
  | { readonly kind: 'abort' }
  /** Still airborne; `retime` stretches the published timeline around the current progress. */
  | { readonly kind: 'air'; readonly retime?: { readonly takeoffAt: number; readonly landAt: number } };

/** Below this residual distance a flight counts as having reached its landing point. */
export const ENEMY_FLIGHT_ARRIVAL_EPSILON_PX = 3;
/** A body further behind its timeline than this republishes a stretched flight. */
const RETIME_LAG_PX = 8;
const RETIME_INTERVAL_MS = 100;
const RETIME_END_GUARD_MS = 34;
/** A flight without movement for this long ends where the body is. */
const STALL_MS = 120;
/** A flight lasting this many times its plan is aborted (frozen in a time bubble, wedged). */
const MAX_FLIGHT_STRETCH = 4;
const NOMINAL_FRAME_S = 1 / 60;

export function beginEnemyFlightTracking(tracker: EnemyFlightTracker, x: number, y: number, now: number): void {
  tracker.lastX = x; tracker.lastY = y; tracker.lastMovedAt = now; tracker.retimedAt = now;
}

/**
 * Nominal flight velocity of the authored air time; slowing is applied by physics, and a stretched
 * timeline only re-describes it for clients. The last frame is shortened so the body stops on target.
 */
export function enemyFlightVelocity(flight: EnemyFlightLine, x: number, y: number, nominalAirMs: number): { vx: number; vy: number } {
  const dx = flight.targetX - x, dy = flight.targetY - y, remaining = Math.hypot(dx, dy);
  if (remaining <= ENEMY_FLIGHT_ARRIVAL_EPSILON_PX) return { vx: 0, vy: 0 };
  const length = Math.hypot(flight.targetX - flight.originX, flight.targetY - flight.originY);
  const speed = Math.min(length / Math.max(1, nominalAirMs) * 1000, remaining / NOMINAL_FRAME_S);
  return { vx: dx / remaining * speed, vy: dy / remaining * speed };
}

/** One airborne host frame of `flight` for a body at (x, y); updates `tracker`. */
export function stepEnemyFlight(flight: EnemyFlightLine, tracker: EnemyFlightTracker, x: number, y: number, now: number,
  nominalAirMs: number, interrupted: boolean): EnemyFlightStep {
  if (Math.hypot(x - tracker.lastX, y - tracker.lastY) >= 0.5) { tracker.lastMovedAt = now; tracker.lastX = x; tracker.lastY = y; }
  const remaining = Math.hypot(flight.targetX - x, flight.targetY - y);
  if (remaining <= ENEMY_FLIGHT_ARRIVAL_EPSILON_PX) return { kind: 'arrived', early: now < flight.landAt };
  const stalled = now - tracker.lastMovedAt > STALL_MS;
  const overdue = now > flight.takeoffAt + (flight.landAt - flight.takeoffAt) * MAX_FLIGHT_STRETCH
    || now > flight.takeoffAt + nominalAirMs * MAX_FLIGHT_STRETCH;
  if (interrupted || stalled || overdue) return { kind: 'abort' };
  const length = Math.hypot(flight.targetX - flight.originX, flight.targetY - flight.originY);
  const travelled = Math.max(0, length - remaining);
  const planned = length * Math.min(1, (now - flight.takeoffAt) / Math.max(1, flight.landAt - flight.takeoffAt));
  const elapsed = Math.max(1, now - flight.takeoffAt);
  const speed = Math.max(1e-3, travelled / elapsed);
  const landAt = now + remaining / speed;
  const due = now - tracker.retimedAt >= RETIME_INTERVAL_MS || now >= flight.landAt;
  const lagging = planned - travelled > RETIME_LAG_PX;
  // Near the planned landing a flight that will arrive late is stretched, so clients never see it land short.
  const endingLate = now >= flight.landAt
    || (now >= flight.landAt - RETIME_END_GUARD_MS && landAt > flight.landAt + RETIME_END_GUARD_MS);
  if (!due || (!lagging && !endingLate)) return { kind: 'air' };
  // Slowed flight: stretch the timeline around the current progress so clients keep the body where
  // it is and the arc continues without a jump.
  const progress = Math.min(0.99, travelled / Math.max(1e-6, length));
  tracker.retimedAt = now;
  return { kind: 'air', retime: { takeoffAt: landAt - (landAt - now) / (1 - progress), landAt } };
}
