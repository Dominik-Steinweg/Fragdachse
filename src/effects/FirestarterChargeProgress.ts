/** Local interpolation of a replicated charge sample; never a gameplay clock. */
export interface FirestarterChargeSample { progress: number; at: number }
export function sampleFirestarterCharge(previous: FirestarterChargeSample | null | undefined, reported: number, now: number): FirestarterChargeSample {
  const progress = Math.max(0, Math.min(1, reported));
  return !previous || previous.progress !== progress ? { progress, at: now } : previous;
}
export function firestarterChargeProgress(sample: FirestarterChargeSample, now: number, telegraphMs: number): number {
  return Math.min(1, sample.progress + Math.max(0, now - sample.at) / Math.max(1, telegraphMs));
}
