/** Slot identity survives an effective target switch, never an unused contact or gesture. */
export function accumulatePlasmaBurnerCharges(progress: number[], effective: readonly boolean[], intervalMs: number,
  multiplier: number, intervalSeconds: number): number[] {
  progress.length = effective.length;
  const spawns: number[] = [];
  for (let slot = 0; slot < effective.length; slot++) {
    if (!effective[slot] || intervalSeconds <= 0) { progress[slot] = 0; continue; }
    const value = (progress[slot] ?? 0) + intervalMs / 1000 * multiplier / intervalSeconds;
    if (value + 1e-10 >= 1) { spawns.push(slot); progress[slot] = Math.max(0, value - 1) % 1; }
    else progress[slot] = value;
  }
  return spawns;
}
