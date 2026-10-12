import type { KrakenBossConfig } from '../config/krakenBoss';
import type { KrakenPhase } from './KrakenState';

export type KrakenExitPhase = Extract<KrakenPhase, { kind: 'ashore' }>;
const unit = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => n * n * (3 - 2 * n);

/** Distance to a shore grip along the permitted route, including the swim to its first anchor.
 * Keep the configured shore margin in front of the fully wet body footprint. */
export function krakenExitShoreDistance(start: { x: number; y: number }, path: readonly { x: number; y: number }[],
  waterFree: (point: { x: number; y: number }) => boolean, margin: number): number | null {
  let from = start, travelled = 0;
  for (const to of path) {
    const length = Math.hypot(to.x - from.x, to.y - from.y), steps = Math.max(1, Math.ceil(length / 8));
    const point = (t: number) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    for (let i = 1; i <= steps; i++) if (!waterFree(point(i / steps))) {
      let lo = (i - 1) / steps, hi = i / steps;
      for (let n = 0; n < 8; n++) { const mid = (lo + hi) / 2; if (waterFree(point(mid))) lo = mid; else hi = mid; }
      return Math.max(0, travelled + length * lo - margin);
    }
    travelled += length; from = to;
  }
  return null;
}

/** Shared host-clock choreography. No integration, animation events or frame-rate dependence. */
export function krakenExitDistance(phase: KrakenExitPhase, now: number, config: KrakenBossConfig['exit']): number {
  if (now <= phase.gripAt) return config.gripDistanceRatio * unit((now - phase.moveAt) / (phase.gripAt - phase.moveAt)) ** 2;
  const pullAt = phase.gripAt + config.gripHoldMs;
  if (now <= pullAt) return config.gripDistanceRatio;
  if (now <= phase.heaveAt) return config.gripDistanceRatio + (config.heaveDistanceRatio - config.gripDistanceRatio)
    * smooth(unit((now - pullAt) / (phase.heaveAt - pullAt)));
  return config.heaveDistanceRatio + (1 - config.heaveDistanceRatio) * (1 - (1 - unit((now - phase.heaveAt) / (phase.endsAt - phase.heaveAt))) ** 2);
}

/** Derived anchor keeps the existing wire phase complete for joining clients. */
export function krakenExitRoarAt(phase: KrakenExitPhase, config: KrakenBossConfig['exit']): number {
  return phase.startedAt + config.roarAfterMs;
}
