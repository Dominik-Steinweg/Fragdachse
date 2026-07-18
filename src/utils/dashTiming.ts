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
