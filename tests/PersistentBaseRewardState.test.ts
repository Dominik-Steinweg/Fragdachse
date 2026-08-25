import { describe, expect, it } from 'vitest';
import { PersistentBaseRewardState } from '../src/persistentBase/PersistentBaseRewardState';
import {
  isPersistentBaseRewardEnemyTarget,
  type PersistentBaseRewardPlacement,
} from '../src/config/persistentBaseRewards';

const watchtowerPlacement: PersistentBaseRewardPlacement = {
  rewardId: 'watchtower',
  persistentId: 'reward-watchtower',
  relativeGridX: 1,
  relativeGridY: 0,
  angle: 0,
  placementOrder: 0,
};

describe('persistent base reward state', () => {
  it('targets structural rewards but never the indestructible pedestal', () => {
    expect(isPersistentBaseRewardEnemyTarget('watchtower')).toBe(true);
    expect(isPersistentBaseRewardEnemyTarget('burrow')).toBe(true);
    expect(isPersistentBaseRewardEnemyTarget('holy_hand_pedestal')).toBe(false);
  });

  it('separates unlock, placement and unique-state transitions', () => {
    const state = new PersistentBaseRewardState({ nowMs: 1_000 });

    expect(state.getRuntimeState('watchtower', '10').availability).toBe('locked');
    expect(state.getRuntimeState('watchtower', '11').availability).toBe('available');
    expect(state.place('watchtower', watchtowerPlacement, '11')).toBe(true);
    expect(state.getRuntimeState('watchtower', '11')).toMatchObject({
      availability: 'placed',
      placement: watchtowerPlacement,
    });
    expect(state.place('watchtower', watchtowerPlacement, '11')).toBe(false);
    expect(state.unplace('watchtower', '11')).toBe(true);
    expect(state.getRuntimeState('watchtower', '11').availability).toBe('available');
  });

  it('rolls back a destroyed reward and commits a reconstruction cooldown-free state', () => {
    const state = new PersistentBaseRewardState({
      placements: [watchtowerPlacement],
      nowMs: 0,
    });

    state.beginMission();
    expect(state.markRuntimeDestroyed('watchtower', '11', 100)).toBe(true);
    expect(state.getRuntimeState('watchtower', '11', 100)).toMatchObject({
      availability: 'reconstruction-cooldown',
      cooldownRemainingMs: 5_000,
      cooldownTotalMs: 5_000,
    });
    state.rollbackMission();
    expect(state.getRuntimeState('watchtower', '11', 100).availability).toBe('placed');

    state.beginMission();
    expect(state.markRuntimeDestroyed('watchtower', '11', 100)).toBe(true);
    state.commitMission();
    expect(state.getRuntimeState('watchtower', '11', 100).availability).toBe('available');
    expect(state.getPlacements()).toEqual([]);
  });

  it('keeps the holy-hand pedestal indestructible and available after explicit unplace', () => {
    const state = new PersistentBaseRewardState();
    const placement: PersistentBaseRewardPlacement = {
      rewardId: 'holy_hand_pedestal',
      persistentId: 'reward-holy_hand_pedestal',
      relativeGridX: 0,
      relativeGridY: 0,
      angle: 0,
      placementOrder: 0,
    };

    expect(state.place('holy_hand_pedestal', placement, '12')).toBe(true);
    expect(state.markRuntimeDestroyed('holy_hand_pedestal', '12', 50)).toBe(false);
    expect(state.getRuntimeState('holy_hand_pedestal', '12').availability).toBe('placed');
    expect(state.unplace('holy_hand_pedestal', '12')).toBe(true);
    expect(state.getRuntimeState('holy_hand_pedestal', '12').availability).toBe('available');
  });
});
