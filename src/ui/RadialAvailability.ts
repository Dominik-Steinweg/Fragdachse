import type { PersistentBaseRewardRuntimeState } from '../config/persistentBaseRewards';

export type RadialAvailabilityReason = 'available' | 'locked' | 'placed' | 'cooldown' | 'capacity';

export interface RadialAvailabilityState {
  readonly available: boolean;
  readonly reason: RadialAvailabilityReason;
  readonly cooldownRemainingMs: number;
  readonly cooldownTotalMs: number;
  /** Fraction of a radial cooldown mask that is still covered, in [0, 1]. */
  readonly cooldownFraction: number;
}

export function getRadialCooldownFraction(
  cooldownRemainingMs: number,
  cooldownTotalMs: number,
): number {
  if (!Number.isFinite(cooldownRemainingMs) || !Number.isFinite(cooldownTotalMs) || cooldownTotalMs <= 0) return 0;
  return Math.max(0, Math.min(1, cooldownRemainingMs / cooldownTotalMs));
}

/** Maps the host-owned reward state to the same availability contract used by radial entries. */
export function resolvePersistentBaseRewardRadialAvailability(
  state: PersistentBaseRewardRuntimeState,
  canPlace = true,
): RadialAvailabilityState {
  const reason: RadialAvailabilityReason = state.availability === 'available'
    ? canPlace ? 'available' : 'capacity'
    : state.availability === 'reconstruction-cooldown' ? 'cooldown'
      : state.availability;
  return {
    available: reason === 'available',
    reason,
    cooldownRemainingMs: Math.max(0, state.cooldownRemainingMs),
    cooldownTotalMs: Math.max(0, state.cooldownTotalMs),
    cooldownFraction: getRadialCooldownFraction(state.cooldownRemainingMs, state.cooldownTotalMs),
  };
}
