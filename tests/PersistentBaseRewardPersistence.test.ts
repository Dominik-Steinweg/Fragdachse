import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_PROGRESS_SCHEMA_VERSION,
  LOCAL_PROGRESS_STORAGE_KEY,
  exportStoredGameProgressJson,
  getStoredPersistentBaseRewardState,
  getStoredPersistentBaseRewardUnlocks,
  grantStoredPersistentBaseRewards,
  importStoredGameProgressJson,
  invalidateLocalStorageCache,
  resetStoredCoopDefenseCharacter,
  setStoredPersistentBaseRewardState,
} from '../src/utils/localPreferences';
import { DEFAULT_PERSISTENT_BASE_REWARD_STATE } from '../src/persistentBase/PersistentBaseRewardTypes';
import { getPersistentBaseRewardIds } from '../src/persistentBase/PersistentBaseRewardCatalog';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('Persistent-Base-Rewards – V5-Persistenz', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    invalidateLocalStorageCache();
  });

  afterEach(() => {
    invalidateLocalStorageCache();
    vi.unstubAllGlobals();
  });

  it('starts without personal rewards and keeps placement state separate', () => {
    expect(getStoredPersistentBaseRewardUnlocks()).toEqual([]);
    expect(getStoredPersistentBaseRewardState()).toEqual(DEFAULT_PERSISTENT_BASE_REWARD_STATE);
    expect(grantStoredPersistentBaseRewards(['base_health_pedestal', 'base_health_pedestal'] as const))
      .toEqual(['base_health_pedestal']);
    expect(grantStoredPersistentBaseRewards(['base_health_pedestal'] as const)).toEqual([]);
    expect(getStoredPersistentBaseRewardState().placements).toEqual([]);
  });

  it('grants every catalog reward and keeps repeated grants idempotent', () => {
    const rewardIds = getPersistentBaseRewardIds();
    expect(grantStoredPersistentBaseRewards(rewardIds)).toEqual(rewardIds);
    expect(getStoredPersistentBaseRewardUnlocks()).toEqual(rewardIds);
    expect(grantStoredPersistentBaseRewards(rewardIds)).toEqual([]);
    expect(getStoredPersistentBaseRewardUnlocks()).toHaveLength(rewardIds.length);
  });

  it('rejects unknown and unowned placements, then round-trips a valid host state', () => {
    expect(setStoredPersistentBaseRewardState({
      schemaVersion: 1,
      revision: 1,
      placements: [{ rewardId: 'base_health_pedestal', relativeGridX: 0, relativeGridY: 0, angle: 0 }],
    })).toBe(false);
    expect(getStoredPersistentBaseRewardState()).toEqual(DEFAULT_PERSISTENT_BASE_REWARD_STATE);

    grantStoredPersistentBaseRewards(['base_health_pedestal'] as const);
    expect(setStoredPersistentBaseRewardState({
      schemaVersion: 1,
      revision: 1,
      placements: [{ rewardId: 'base_health_pedestal', relativeGridX: 2, relativeGridY: -1, angle: 0.5 }],
    })).toBe(true);
    expect(setStoredPersistentBaseRewardState({
      schemaVersion: 1,
      revision: 1,
      placements: [{ rewardId: 'base_health_pedestal', relativeGridX: 9, relativeGridY: 9, angle: 0 }],
    })).toBe(false);

    const exported = JSON.parse(exportStoredGameProgressJson());
    expect(exported.progress.schemaVersion).toBe(LOCAL_PROGRESS_SCHEMA_VERSION);
    expect(exported.progress.coopDefense.persistentBaseRewardUnlocks).toEqual(['base_health_pedestal']);
    expect(exported.progress.coopDefense.persistentBaseRewardState.placements).toHaveLength(1);

    resetStoredCoopDefenseCharacter();
    expect(importStoredGameProgressJson(JSON.stringify(exported)).ok).toBe(true);
    expect(getStoredPersistentBaseRewardUnlocks()).toEqual(['base_health_pedestal']);
    expect(getStoredPersistentBaseRewardState().revision).toBe(1);
  });

  it('rejects V3 and incomplete or cross-document V5 imports without backfill', () => {
    const exported = JSON.parse(exportStoredGameProgressJson());
    expect(importStoredGameProgressJson(JSON.stringify({ ...exported, formatVersion: 3 }))).toEqual({
      ok: false,
      messageKey: 'ui.lobby.saveIncompatible',
    });

    const missing = structuredClone(exported);
    delete missing.progress.coopDefense.persistentBaseRewardUnlocks;
    expect(importStoredGameProgressJson(JSON.stringify(missing)).ok).toBe(false);

    const unowned = structuredClone(exported);
    unowned.progress.coopDefense.persistentBaseRewardState = {
      schemaVersion: 1,
      revision: 4,
      placements: [{ rewardId: 'base_rocket_turret', relativeGridX: 0, relativeGridY: 0, angle: 0 }],
    };
    expect(importStoredGameProgressJson(JSON.stringify(unowned)).ok).toBe(false);

    // A legacy V3 storage key is ignored; it cannot synthesize a reward or placement.
    storage.setItem('fragdachse_progress_v3', JSON.stringify({ schemaVersion: 3, coopDefense: {
      highestUnlockedMapId: '9', persistentBaseUnlocked: true,
    } }));
    invalidateLocalStorageCache();
    expect(getStoredPersistentBaseRewardUnlocks()).toEqual([]);
    expect(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)).not.toBeNull();
  });
});
