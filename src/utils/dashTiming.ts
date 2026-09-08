import { DASH_F_MIN, PLAYER_DASH_BURST_EXPONENT, PLAYER_DASH_BURST_IMPULSE } from '../config';

/** Only the front-loaded impulse is amplified; every player burst ends at the same speed. */
export function getPlayerDashBurstSpeedFactor(progress: number, impulseMultiplier = 1): number {
  const remaining = 1 - Math.max(0, Math.min(1, progress));
  return DASH_F_MIN + PLAYER_DASH_BURST_IMPULSE * impulseMultiplier * remaining ** PLAYER_DASH_BURST_EXPONENT;
}

export interface DashBurstTiming {
  progress: number;
  shouldEnd: boolean;
}

export function getDashBurstTiming(
  elapsedSeconds: number,
  baseDurationSeconds: number,
  holdEnabled: boolean,
  dashHeld: boolean,
  maximumDurationFactor: number,
): DashBurstTiming {
  const elapsed = Math.max(0, elapsedSeconds);
  const baseDuration = Math.max(0.001, baseDurationSeconds);
  const maximumDuration = baseDuration * Math.max(1, maximumDurationFactor);
  const extending = holdEnabled && dashHeld && elapsed < maximumDuration;
  const curveDuration = extending ? maximumDuration : baseDuration;

  return {
    progress: Math.min(1, elapsed / curveDuration),
    shouldEnd: elapsed >= baseDuration && !extending,
  };
}
