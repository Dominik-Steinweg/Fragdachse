import { SHOOTING_RANGE } from './ShootingRangeLayout';
import type { ShootingRangeState } from './ShootingRangeContracts';

/** Linear interpolation between confirmed samples; never invents peaks or extends stale data. */
export function shootingRangeChartPoints(state: ShootingRangeState, now: number): { x: number; value: number }[] {
  const samples = state.samples;
  if (!samples.length) return [];
  // Two samples of display latency let host and client scroll between already known values.
  const end = Math.max(samples[0].at, Math.min(now - SHOOTING_RANGE.sampleIntervalMs * 2, samples[samples.length - 1].at));
  const start = end - SHOOTING_RANGE.historyMs;
  const points: { x: number; value: number }[] = [];
  const append = (at: number, value: number) => points.push({ x: (at - start) / SHOOTING_RANGE.historyMs, value });
  for (let i = 0; i < samples.length; i++) {
    const current = samples[i], previous = samples[i - 1];
    if (current.at < start) continue;
    if (previous && previous.at < start) {
      append(start, previous.dps + (current.dps - previous.dps) * (start - previous.at) / (current.at - previous.at));
    }
    if (current.at > end) {
      if (previous && previous.at < end) {
        append(end, previous.dps + (current.dps - previous.dps) * (end - previous.at) / (current.at - previous.at));
      }
      break;
    }
    append(current.at, current.dps);
  }
  return points;
}
