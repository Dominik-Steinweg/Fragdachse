/** Optional authored multipliers for cosmetic weapon wakes; 1 preserves the base profile. */
export interface FogTrailModifiers {
  readonly fogTrailWidthFactor?: number;
  readonly fogTrailDurationFactor?: number;
}

// Keeps analytical ages below the 60-second GPU clock wrap and the existing trace capacity useful.
export const MAX_FOG_TRAIL_FACTOR = 8;
export function fogTrailFactor(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 1 : Math.max(0, Math.min(MAX_FOG_TRAIL_FACTOR, value));
}
