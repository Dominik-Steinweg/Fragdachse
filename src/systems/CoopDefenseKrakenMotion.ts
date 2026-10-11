import type { KrakenBossConfig } from '../config/krakenBoss';
import type { KrakenPhase } from './KrakenState';

export type KrakenExitPhase = Extract<KrakenPhase, { kind: 'ashore' }>;
const unit = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => n * n * (3 - 2 * n);

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
