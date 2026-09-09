import type { TimeBubblePrismEmitterConfig } from '../types';
import type { TimeBubblePrismUpgradeConfig } from './LoadoutTypes';

/** One resolution for the cast payload and the upgrade descriptions. */
export function resolveTimeBubblePrismEmitter(
  authored: TimeBubblePrismUpgradeConfig | undefined,
): TimeBubblePrismEmitterConfig | undefined {
  if (!authored || authored.level === 0) return undefined;
  const { level, intervalsMs, ...emitter } = authored;
  return structuredClone({ ...emitter, intervalMs: intervalsMs[level - 1] });
}
