/**
 * The wave that lifts a deactivated place's void haze (GDD Void-Gefahrenzonen V1, E11/E13). It runs
 * out from the place's centre; behind its front the creep falls to its residue and the trails its
 * enemies laid dissolve. One wave covers the place and its trails, so both read as one success.
 */
/** The front crosses the place in this time; a wave over long trails takes up to twice as long. */
export const LIFT_SEC = 3.2;
/** Texels behind the front reach their residue over this width (world px). */
export const LIFT_SOFT_PX = 140;

export interface VoidLiftWave {
  readonly x: number;
  readonly y: number;
  /** Radius the front reaches at the end (world px). */
  readonly radius: number;
  readonly durationSec: number;
}

const easeOut = (t: number): number => 1 - (1 - t) ** 2;

/**
 * A wave from a place's centre over `placeRadius`, reaching `reach` world px further out where its
 * trails lie (0 without trails). Longer reach runs a little longer, never more than twice LIFT_SEC.
 */
export function createVoidLiftWave(x: number, y: number, placeRadius: number, reach = 0): VoidLiftWave {
  const place = Math.max(1, placeRadius), radius = Math.max(place, reach > 0 ? reach + LIFT_SOFT_PX : 0);
  return { x, y, radius, durationSec: LIFT_SEC * Math.min(2, Math.sqrt(radius / place)) };
}

/** Front radius `elapsedSec` after the wave started. */
export function liftFront(wave: VoidLiftWave, elapsedSec: number): number {
  return wave.radius * easeOut(Math.max(0, Math.min(1, elapsedSec / wave.durationSec)));
}

/** Seconds after the start at which the front reaches `distance`; monotonic in the distance. */
export function liftArrivalSec(wave: VoidLiftWave, distance: number): number {
  const reached = Math.max(0, Math.min(1, distance / wave.radius));
  return wave.durationSec * (1 - Math.sqrt(1 - reached));
}

/** Strength of the wave's shimmer: swells in quickly, fades over the last third, a soft breath. */
export function liftStrength(wave: VoidLiftWave, elapsedSec: number): number {
  const t = Math.max(0, Math.min(1, elapsedSec / wave.durationSec));
  return Math.min(1, t / .08) * Math.min(1, (1 - t) / .35);
}
