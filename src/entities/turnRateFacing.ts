/**
 * One authoritative turn step: rotate `current` toward `heading` by at most `rateRadPerMs × elapsedMs`.
 * `locomotion` scales movement along `heading`: full speed when facing it, a slow shuffle when turned
 * away, so a slowly turning body cannot strafe or back-pedal at full speed.
 */
export function stepTurnRateFacing(current: number, heading: number | null, rateRadPerMs: number, elapsedMs: number):
  { readonly angle: number; readonly locomotion: number } {
  if (heading === null) return { angle: wrap(current), locomotion: 1 };
  const limit = rateRadPerMs * Math.max(0, elapsedMs);
  const angle = wrap(current + Math.max(-limit, Math.min(limit, wrap(heading - current))));
  const remaining = Math.abs(wrap(heading - angle));
  return { angle, locomotion: 0.25 + 0.75 * Math.max(0, Math.cos(remaining)) };
}

function wrap(angle: number): number { return Math.atan2(Math.sin(angle), Math.cos(angle)); }
