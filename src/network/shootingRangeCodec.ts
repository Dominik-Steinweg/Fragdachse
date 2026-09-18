import type { ShootingRangeState } from '../shootingRange/ShootingRangeContracts';
import { SHOOTING_RANGE } from '../shootingRange/ShootingRangeLayout';

/** Complete refresh: sample timestamps are implicit at the shared display interval. */
export function encodeShootingRange(state: ShootingRangeState | null | undefined): unknown {
  if (!state) return null;
  return [state.session, state.enabled ? 1 : 0, state.count, state.supply ? 1 : 0,
    state.targets.map(target => target ? [target.id, target.generation] : null), state.dps, state.scale,
    state.samples[0]?.at ?? null, state.samples.map(sample => sample.dps)];
}
export function decodeShootingRange(value: unknown): ShootingRangeState | null {
  if (!Array.isArray(value) || value.length !== 9) return null;
  const [session, enabled, count, supply, targets, dps, scale, first, samples] = value;
  const finite = (number: unknown): number is number => typeof number === 'number' && Number.isFinite(number) && number >= 0;
  if (!Number.isSafeInteger(session) || session < 0 || (enabled !== 0 && enabled !== 1)
    || !Number.isInteger(count) || count < 1 || count > SHOOTING_RANGE.targets.length || (supply !== 0 && supply !== 1)
    || !Array.isArray(targets) || targets.length !== (enabled ? count : 0)
    || !finite(dps) || !finite(scale) || scale <= 0 || dps > scale || (!enabled && supply)
    || !Array.isArray(samples) || samples.length > SHOOTING_RANGE.historyMs / SHOOTING_RANGE.sampleIntervalMs + 1
    || !samples.every(finite) || (samples.length ? !finite(first) : first !== null)) return null;
  const ids = new Set<string>();
  for (const target of targets) {
    if (target === null) continue;
    if (!Array.isArray(target) || target.length !== 2 || typeof target[0] !== 'string' || target[0].length < 1
      || target[0].length > 120 || !Number.isSafeInteger(target[1]) || target[1] <= 0 || ids.has(target[0])) return null;
    ids.add(target[0]);
  }
  return { session, enabled: !!enabled, count, supply: !!supply,
    targets: targets.map(target => target ? { id: target[0], generation: target[1] } : null), dps, scale,
    samples: samples.map((value, index) => ({ at: first + index * SHOOTING_RANGE.sampleIntervalMs, dps: value })) };
}
