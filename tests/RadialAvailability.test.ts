import { describe, expect, it } from 'vitest';
import {
  getRadialCooldownFraction,
  resolvePersistentBaseRewardRadialAvailability,
} from '../src/ui/RadialAvailability';
import type { PersistentBaseRewardRuntimeState } from '../src/config/persistentBaseRewards';

function rewardState(
  availability: PersistentBaseRewardRuntimeState['availability'],
  cooldownRemainingMs = 0,
  cooldownTotalMs = 0,
): PersistentBaseRewardRuntimeState {
  return {
    rewardId: 'watchtower',
    availability,
    cooldownRemainingMs,
    cooldownTotalMs,
    placement: availability === 'placed' ? {
      rewardId: 'watchtower',
      persistentId: 'reward-watchtower',
      relativeGridX: 0,
      relativeGridY: 0,
      angle: 0,
      placementOrder: 0,
    } : null,
  };
}

describe('generic radial availability', () => {
  it('normalizes cooldown fractions and clamps invalid values', () => {
    expect(getRadialCooldownFraction(2_500, 5_000)).toBe(0.5);
    expect(getRadialCooldownFraction(-1, 5_000)).toBe(0);
    expect(getRadialCooldownFraction(9_000, 5_000)).toBe(1);
    expect(getRadialCooldownFraction(1, 0)).toBe(0);
  });

  it('keeps reconstruction visible but unavailable and separates capacity from cooldown', () => {
    expect(resolvePersistentBaseRewardRadialAvailability(
      rewardState('reconstruction-cooldown', 2_500, 5_000),
    )).toMatchObject({
      available: false,
      reason: 'cooldown',
      cooldownFraction: 0.5,
    });
    expect(resolvePersistentBaseRewardRadialAvailability(
      rewardState('available'),
      false,
    )).toMatchObject({
      available: false,
      reason: 'capacity',
      cooldownFraction: 0,
    });
    expect(resolvePersistentBaseRewardRadialAvailability(rewardState('locked')).reason).toBe('locked');
    expect(resolvePersistentBaseRewardRadialAvailability(rewardState('placed')).reason).toBe('placed');
  });
});
