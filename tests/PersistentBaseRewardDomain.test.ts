import { describe, expect, it } from 'vitest';
import {
  getPersistentBaseRewardDefinition,
  PERSISTENT_BASE_REWARD_DEFINITIONS,
} from '../src/persistentBase/PersistentBaseRewardCatalog';
import {
  PersistentBaseRewardGrantService,
  type PersistentBaseRewardGrantRecipients,
} from '../src/persistentBase/PersistentBaseRewardGrant';
import { PersistentBaseRewardStore } from '../src/persistentBase/PersistentBaseRewardStore';
import {
  DEFAULT_PERSISTENT_BASE_REWARD_STATE,
  getPersistentBaseRewardStatus,
  sanitizePersistentBaseRewardState,
  type PersistentBaseRewardId,
} from '../src/persistentBase/PersistentBaseRewardTypes';

describe('Persistent Base Reward-Katalog', () => {
  it('contains the five stable IDs and existing runtime references', () => {
    expect(PERSISTENT_BASE_REWARD_DEFINITIONS.map((definition) => definition.id)).toEqual([
      'base_adrenaline_pedestal',
      'base_spore_turret',
      'base_health_pedestal',
      'base_rocket_turret',
      'base_holy_hand_grenade_pedestal',
    ]);
    expect(getPersistentBaseRewardDefinition('base_adrenaline_pedestal').gameplaySource).toEqual({
      kind: 'power-up-definition', powerUpDefId: 'ADRENALINE',
    });
    expect(getPersistentBaseRewardDefinition('base_adrenaline_pedestal').initialState)
      .toEqual({ respawnMs: 10_000, spawnOnArenaStart: true });
    expect(getPersistentBaseRewardDefinition('base_adrenaline_pedestal')).toMatchObject({
      category: 'basePedestal', placementRule: 'persistent-build-area',
    });
    expect(getPersistentBaseRewardDefinition('base_health_pedestal').gameplaySource).toEqual({
      kind: 'power-up-definition', powerUpDefId: 'HEALTH_PACK',
    });
    expect(getPersistentBaseRewardDefinition('base_health_pedestal').initialState)
      .toEqual({ respawnMs: 5_000, spawnOnArenaStart: true });
    expect(getPersistentBaseRewardDefinition('base_holy_hand_grenade_pedestal').gameplaySource).toEqual({
      kind: 'power-up-definition', powerUpDefId: 'HOLY_HAND_GRENADE',
    });
    expect(getPersistentBaseRewardDefinition('base_holy_hand_grenade_pedestal').initialState)
      .toEqual({ respawnMs: 30_000, spawnOnArenaStart: true });
    expect(getPersistentBaseRewardDefinition('base_spore_turret').gameplaySource).toEqual({
      kind: 'construction-definition', constructionId: 'spore_turret',
    });
    expect(getPersistentBaseRewardDefinition('base_spore_turret')).toMatchObject({
      category: 'baseTurret', placementRule: 'base-surface',
    });
    expect(getPersistentBaseRewardDefinition('base_rocket_turret').gameplaySource).toEqual({
      kind: 'construction-definition', constructionId: 'rocket_turret',
    });
  });
});

describe('PersistentBaseRewardState', () => {
  it('derives locked, unplaced and placed without storing a status', () => {
    const state = {
      ...DEFAULT_PERSISTENT_BASE_REWARD_STATE,
      placements: [{ rewardId: 'base_health_pedestal' as const, relativeGridX: 2, relativeGridY: -1, angle: 0 }],
    };
    expect(getPersistentBaseRewardStatus('base_adrenaline_pedestal', [], state)).toBe('locked');
    expect(getPersistentBaseRewardStatus('base_health_pedestal', ['base_health_pedestal'], state)).toBe('placed');
    expect(getPersistentBaseRewardStatus('base_spore_turret', ['base_spore_turret'], state)).toBe('unplaced');
    expect(Object.keys(state.placements[0]!)).toEqual(['rewardId', 'relativeGridX', 'relativeGridY', 'angle']);
  });

  it('rejects duplicate, unknown and runtime-shaped placement data', () => {
    const base = { schemaVersion: 1, revision: 1, placements: [] };
    expect(sanitizePersistentBaseRewardState({ ...base, placements: [
      { rewardId: 'unknown', relativeGridX: 0, relativeGridY: 0, angle: 0 },
    ] })).toBeNull();
    expect(sanitizePersistentBaseRewardState({ ...base, placements: [
      { rewardId: 'base_health_pedestal', relativeGridX: 0, relativeGridY: 0, angle: 0 },
      { rewardId: 'base_health_pedestal', relativeGridX: 1, relativeGridY: 0, angle: 0 },
    ] })).toBeNull();
    const sanitized = sanitizePersistentBaseRewardState({ ...base, placements: [{
      rewardId: 'base_health_pedestal', relativeGridX: 0, relativeGridY: 0, angle: 0,
      runtimeId: 17, hp: 100,
    }] });
    expect(sanitized).toEqual({
      schemaVersion: 1,
      revision: 1,
      placements: [{ rewardId: 'base_health_pedestal', relativeGridX: 0, relativeGridY: 0, angle: 0 }],
    });
  });

  it('keeps a one-time placement marker when a placement is rolled back', () => {
    const store = new PersistentBaseRewardStore();
    expect(store.placeReward({
      rewardId: 'base_spore_turret', relativeGridX: -2, relativeGridY: 0, angle: 0,
    })).toBe(true);
    expect(store.getState().everPlacedRewardIds).toEqual(['base_spore_turret']);

    store.beginMission();
    expect(store.dismantleReward('base_spore_turret')).toBe(true);
    store.rollback();
    expect(store.getState().placements).toHaveLength(1);
    expect(store.getState().everPlacedRewardIds).toEqual(['base_spore_turret']);

    store.beginMission();
    expect(store.dismantleReward('base_spore_turret')).toBe(true);
    store.commit();
    expect(store.getState().placements).toEqual([]);
    expect(store.canPlaceReward('base_spore_turret', ['base_spore_turret'])).toBe(false);
  });
});

describe('PersistentBaseRewardStore', () => {
  it('commits lobby changes and rolls mission changes back or forward', () => {
    const store = new PersistentBaseRewardStore();
    expect(store.placeReward({ rewardId: 'base_health_pedestal', relativeGridX: 1, relativeGridY: 2, angle: 0 })).toBe(true);
    expect(store.placeReward({ rewardId: 'base_health_pedestal', relativeGridX: 3, relativeGridY: 4, angle: 0 })).toBe(false);
    expect(store.getState().revision).toBe(1);

    store.beginMission();
    expect(store.dismantleReward('base_health_pedestal')).toBe(true);
    store.rollback();
    expect(store.getState().placements).toHaveLength(1);

    store.beginMission();
    expect(store.dismantleReward('base_health_pedestal')).toBe(true);
    const committed = store.commit();
    expect(committed?.placements).toEqual([]);
    expect(store.commit()).toBeNull();
  });

  it('restores the exact revision when a lobby placement is rolled back', () => {
    const store = new PersistentBaseRewardStore({
      ...DEFAULT_PERSISTENT_BASE_REWARD_STATE,
      revision: 7,
    });
    expect(store.placeReward({
      rewardId: 'base_health_pedestal', relativeGridX: 0, relativeGridY: 0, angle: 0,
    })).toBe(true);
    expect(store.rollbackPlacement('base_health_pedestal')).toBe(true);
    expect(store.getState()).toEqual({
      ...DEFAULT_PERSISTENT_BASE_REWARD_STATE,
      revision: 7,
    });
  });
});

describe('PersistentBaseRewardGrantService', () => {
  it('deduplicates rewards and only publishes new grants for eligible players', () => {
    const local: string[] = [];
    const localUnlocks = new Set<PersistentBaseRewardId>();
    const remoteUnlocks = new Set<PersistentBaseRewardId>();
    const confirmations: Array<{ playerId: string; rewardIds: readonly string[] }> = [];
    const service = new PersistentBaseRewardGrantService();
    const recipients: PersistentBaseRewardGrantRecipients = {
      localPlayerId: 'host',
      applyLocal: (ids) => {
        const newlyGranted = ids.filter((id) => !localUnlocks.has(id));
        newlyGranted.forEach((id) => localUnlocks.add(id));
        local.push(...newlyGranted);
        return newlyGranted;
      },
      confirmForPlayer: (playerId, ids) => {
        const newlyGranted = ids.filter((id) => !remoteUnlocks.has(id));
        newlyGranted.forEach((id) => remoteUnlocks.add(id));
        if (newlyGranted.length > 0) confirmations.push({ playerId, rewardIds: [...remoteUnlocks] });
        return newlyGranted;
      },
    };
    const first = service.grant(
      ['base_health_pedestal', 'base_health_pedestal'] as const,
      ['host', 'guest', 'guest'],
      recipients,
    );
    expect(first.newlyGrantedByPlayerId.get('host')).toEqual(['base_health_pedestal']);
    expect(first.newlyGrantedByPlayerId.get('guest')).toEqual(['base_health_pedestal']);
    expect(local).toEqual(['base_health_pedestal']);
    expect(confirmations).toEqual([{ playerId: 'guest', rewardIds: ['base_health_pedestal'] }]);

    service.grant(['base_health_pedestal'] as const, ['host', 'guest'], recipients);
    expect(local).toEqual(['base_health_pedestal']);
    expect(confirmations).toHaveLength(1);
    expect(service.grant(['unknown'] as never, ['host'], recipients).rewardIds).toEqual([]);
  });
});
