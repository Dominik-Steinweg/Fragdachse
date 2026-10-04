import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_LOCAL_PREFERENCES_KEY,
  LOCAL_PROGRESS_SCHEMA_VERSION,
  LOCAL_PROGRESS_STORAGE_KEY,
  LOCAL_SETTINGS_STORAGE_KEY,
  exportStoredGameProgressJson,
  getStoredLocalOwnerId,
  getStoredPersistentBaseState,
  getStoredPersistentBaseAreaStage,
  getStoredPersistentBaseHealthRewards,
  unlockStoredPersistentBaseHealthAfterVictory,
  getStoredPersonalBaseContribution,
  setStoredPersonalBaseContribution,
  getStoredCoopDefenseProgress,
  markStoredCoopDefenseMapCompleted,
  markStoredCoopDefenseRoundProcessed,
  getStoredGraphicsQuality,
  getStoredMasterVolume,
  getStoredMusicVolume,
  setStoredMusicVolume,
  getStoredPlayerName,
  getStoredLocale,
  importStoredGameProgressJson,
  importStoredGameProgressFile,
  invalidateLocalStorageCache,
  resetStoredCoopDefenseCharacter,
  setStoredCoopDefenseCheatProgress,
  setStoredCoopDefenseItemsUnlocked,
  setStoredCoopDefenseTotalXp,
  setStoredPendingCoopDefenseItemReward,
  claimStoredPendingCoopDefenseItemReward,
  unlockStoredCoopDefenseItemsAfterVictory,
  grantStoredPersistentBaseRewards,
  setStoredPersistentBaseUnlocked,
  setStoredPersistentBaseAreaStage,
  setStoredPersistentBaseState,
  setStoredCoopDefenseUpgradeProfile,
  setStoredGraphicsQuality,
  setStoredMasterVolume,
  setStoredLocale,
} from '../src/utils/localPreferences';
import { resolveBrowserLocale } from '../src/i18n/types';
import { buildDefaultCoopDefenseUpgradeProfile } from '../src/utils/coopDefenseUpgrades';
import { getCoopDefenseProgressSnapshot } from '../src/utils/coopDefenseProgression';
import { rollCoopDefenseItemOffer } from '../src/utils/coopDefenseItems';
import { COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID } from '../src/config/coopDefenseItems';
import { PERSISTENT_BASE_STATE_SCHEMA_VERSION } from '../src/config/persistentBase';
import type { PersistentBaseState } from '../src/persistentBase/PersistentBaseTypes';
import { getPersistentBaseRewardIds } from '../src/persistentBase/PersistentBaseRewardCatalog';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  reads = 0;
  writes = 0;
  throwOnWrite = false;

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null {
    this.reads += 1;
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    if (this.throwOnWrite) throw new Error('quota');
    this.writes += 1;
    this.values.set(key, value);
  }
}

describe('local progress generation', () => {
  let storage: MemoryStorage;

  it('preserves identified rewards and a legacy reward with the same time across export, reload and import', () => {
    const legacy = { roundEndedAt: 42, offers: rollCoopDefenseItemOffer(2, null) };
    const first = { ...legacy, roundIdentity: { roomCode: 'AAAAAA', roundRevision: 1 } };
    expect(unlockStoredCoopDefenseItemsAfterVictory(COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID, first)).toBe(true);
    expect(unlockStoredCoopDefenseItemsAfterVictory(COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID, { ...first, roundEndedAt: 43 })).toBe(false);
    expect(setStoredPendingCoopDefenseItemReward(legacy)).toBe(true);
    expect(setStoredPendingCoopDefenseItemReward({ ...legacy, roundIdentity: { roomCode: 'BBBBBB', roundRevision: 1 } })).toBe(true);
    expect(setStoredPendingCoopDefenseItemReward({ ...legacy, roundIdentity: { roomCode: 'AAAAAA', roundRevision: 2 } })).toBe(true);
    expect(setStoredPendingCoopDefenseItemReward(first)).toBe(false);
    const expected = getStoredCoopDefenseProgress().pendingItemRewards;
    expect(expected).toHaveLength(4);
    first.roundIdentity.roundRevision = 99;
    (getStoredCoopDefenseProgress().pendingItemRewards[0].roundIdentity as { roundRevision: number }).roundRevision = 98;
    expect(getStoredCoopDefenseProgress().pendingItemRewards).toEqual(expected);
    const exported = exportStoredGameProgressJson();
    invalidateLocalStorageCache(); expect(getStoredCoopDefenseProgress().pendingItemRewards).toEqual(expected);
    resetStoredCoopDefenseCharacter(); expect(importStoredGameProgressJson(exported).ok).toBe(true);
    expect(getStoredCoopDefenseProgress().pendingItemRewards).toEqual(expected);
  });

  it('requires an unambiguous reward identity to claim repeated item IDs at the same end time', () => {
    const reward = { roundEndedAt: 42, offers: rollCoopDefenseItemOffer(2, null) };
    const identity = { roomCode: 'AAAAAA', roundRevision: 1 };
    setStoredPendingCoopDefenseItemReward(reward);
    setStoredPendingCoopDefenseItemReward({ ...reward, roundIdentity: identity });
    const offerUid = reward.offers[0].uid;
    expect(claimStoredPendingCoopDefenseItemReward(42, offerUid)).toBeNull();
    expect(claimStoredPendingCoopDefenseItemReward(42, offerUid, offerUid, 'take', identity)).not.toBeNull();
    expect(claimStoredPendingCoopDefenseItemReward(42, offerUid, offerUid, 'take', identity)).toBeNull();
    expect(getStoredCoopDefenseProgress().pendingItemRewards).toHaveLength(1);
    expect(claimStoredPendingCoopDefenseItemReward(42, offerUid, offerUid, 'take', null)).not.toBeNull();
    expect(getStoredCoopDefenseProgress().pendingItemRewards).toHaveLength(0);
  });

  it('migrates unidentified rewards separately and rejects invalid reward identities atomically', () => {
    const legacy = { roundEndedAt: 42, offers: rollCoopDefenseItemOffer(2, null) };
    const exported = JSON.parse(exportStoredGameProgressJson());
    exported.progress.coopDefense.pendingItemReward = legacy;
    exported.progress.coopDefense.pendingItemRewards = [{ ...legacy, roundIdentity: { roomCode: 'AAAAAA', roundRevision: 1 } }];
    expect(importStoredGameProgressJson(JSON.stringify(exported)).ok).toBe(true);
    expect(getStoredCoopDefenseProgress().pendingItemRewards).toHaveLength(2);
    const before = storage.getItem(LOCAL_PROGRESS_STORAGE_KEY);
    for (const identity of [null, [], {}, { roomCode: 'AAAAAA' }, { roomCode: 'constructor', roundRevision: 1 },
      { roomCode: '__proto__', roundRevision: 1 }, { roomCode: 'AAAAAA', roundRevision: 0 },
      { roomCode: 'AAAAAA', roundRevision: 1.5 }, { roomCode: 'AAAAAA', roundRevision: '1' }]) {
      exported.progress.coopDefense.pendingItemRewards[0].roundIdentity = identity;
      expect(importStoredGameProgressJson(JSON.stringify(exported)).ok).toBe(false);
      expect(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)).toBe(before);
    }
  });

  it.each(['xp', 'item'] as const)('rejects a finite imported %s value whose derived runtime state overflows', kind => {
    setStoredCoopDefenseTotalXp(123);
    const validExport = exportStoredGameProgressJson();
    const corrupt = JSON.parse(validExport);
    if (kind === 'xp') corrupt.progress.coopDefense.totalXp = 1e308;
    else corrupt.progress.coopDefense.items = [{
      uid: 'overflow', slot: 'armor', rarity: 'blue', itemLevel: 1e308, baseValue: 25,
      affixes: [{ affixId: 'max_armor', value: 1 }],
    }];
    const storedBefore = storage.getItem(LOCAL_PROGRESS_STORAGE_KEY);
    expect(importStoredGameProgressJson(JSON.stringify(corrupt)).ok).toBe(false);
    expect(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)).toBe(storedBefore);
    invalidateLocalStorageCache();
    const progress = getStoredCoopDefenseProgress();
    const snapshot = getCoopDefenseProgressSnapshot(progress.totalXp);
    expect(progress.totalXp).toBe(123);
    expect(Number.isFinite(snapshot.level)).toBe(true);
    expect(Number.isFinite(snapshot.levelProgressFraction)).toBe(true);
    const exported = exportStoredGameProgressJson();
    resetStoredCoopDefenseCharacter();
    expect(importStoredGameProgressJson(exported).ok).toBe(true);
    expect(getStoredCoopDefenseProgress().totalXp).toBe(123);
  });

  it('preserves monotone per-room round credits through reload, export/import and reset', () => {
    markStoredCoopDefenseRoundProcessed(100_000, { roomCode: 'AAAAAA', roundRevision: 100 });
    markStoredCoopDefenseRoundProcessed(90_000, { roomCode: 'BBBBBB', roundRevision: 10 });
    markStoredCoopDefenseRoundProcessed(110_000, { roomCode: 'AAAAAA', roundRevision: 99 });
    expect(getStoredCoopDefenseProgress().processedRoundRevisionsByRoom).toEqual({ AAAAAA: 100, BBBBBB: 10 });
    const exported = exportStoredGameProgressJson();
    invalidateLocalStorageCache();
    expect(getStoredCoopDefenseProgress().processedRoundRevisionsByRoom).toEqual({ AAAAAA: 100, BBBBBB: 10 });
    resetStoredCoopDefenseCharacter();
    expect(getStoredCoopDefenseProgress().processedRoundRevisionsByRoom).toEqual({});
    expect(importStoredGameProgressJson(exported).ok).toBe(true);
    expect(getStoredCoopDefenseProgress().processedRoundRevisionsByRoom).toEqual({ AAAAAA: 100, BBBBBB: 10 });
    getStoredCoopDefenseProgress().processedRoundRevisionsByRoom.AAAAAA = 999;
    expect(getStoredCoopDefenseProgress().processedRoundRevisionsByRoom.AAAAAA).toBe(100);
  });

  it('migrates absent round ledgers and rejects corrupt ledgers atomically', () => {
    setStoredCoopDefenseTotalXp(123);
    const exported = JSON.parse(exportStoredGameProgressJson());
    delete exported.progress.coopDefense.processedRoundRevisionsByRoom;
    expect(importStoredGameProgressJson(JSON.stringify(exported)).ok).toBe(true);
    expect(getStoredCoopDefenseProgress().processedRoundRevisionsByRoom).toEqual({});
    const before = storage.getItem(LOCAL_PROGRESS_STORAGE_KEY);
    for (const invalid of [null, [], { AAAAAA: 0 }, { AAAAAA: 1.5 }, { AAAAAA: '100' },
      Object.fromEntries([['__proto__', 1]]), { constructor: 1 }]) {
      exported.progress.coopDefense.processedRoundRevisionsByRoom = invalid;
      expect(importStoredGameProgressJson(JSON.stringify(exported)).ok).toBe(false);
      expect(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)).toBe(before);
      expect(getStoredCoopDefenseProgress().totalXp).toBe(123);
    }
  });

  it('does not lower the legacy replay boundary when an identified host clock is earlier', () => {
    markStoredCoopDefenseRoundProcessed(200_000);
    markStoredCoopDefenseRoundProcessed(100_000, { roomCode: 'AAAAAA', roundRevision: 100 });
    invalidateLocalStorageCache();
    expect(getStoredCoopDefenseProgress().lastProcessedRoundEndedAt).toBe(200_000);
    expect(getStoredCoopDefenseProgress().processedRoundRevisionsByRoom).toEqual({ AAAAAA: 100 });
  });

  it('persists actual map wins through export/import and clears them on character reset', () => {
    expect(getStoredCoopDefenseProgress().completedMapIds).toEqual([]);
    expect(markStoredCoopDefenseMapCompleted('8')).toBe(true);
    expect(markStoredCoopDefenseMapCompleted('8')).toBe(false);
    const json = exportStoredGameProgressJson();
    resetStoredCoopDefenseCharacter();
    expect(getStoredCoopDefenseProgress().completedMapIds).toEqual([]);
    importStoredGameProgressJson(json);
    expect(getStoredCoopDefenseProgress().completedMapIds).toEqual(['8']);
  });

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    invalidateLocalStorageCache();
  });

  afterEach(() => {
    invalidateLocalStorageCache();
    vi.unstubAllGlobals();
  });

  it('grants independent health rewards once and preserves them through export, import and reset', () => {
    expect(getStoredPersistentBaseHealthRewards()).toEqual([]);
    expect(unlockStoredPersistentBaseHealthAfterVictory('3')).toBe(true);
    expect(unlockStoredPersistentBaseHealthAfterVictory('3')).toBe(false);
    expect(unlockStoredPersistentBaseHealthAfterVictory('7')).toBe(false);
    expect(getStoredPersistentBaseHealthRewards()).toEqual(['map-3']);
    expect(unlockStoredPersistentBaseHealthAfterVictory('2')).toBe(true);
    const exported = exportStoredGameProgressJson();
    resetStoredCoopDefenseCharacter();
    expect(getStoredPersistentBaseHealthRewards()).toEqual([]);
    expect(importStoredGameProgressJson(exported).ok).toBe(true);
    expect(getStoredPersistentBaseHealthRewards()).toEqual(['map-3', 'map-2']);
    invalidateLocalStorageCache();
    expect(getStoredPersistentBaseHealthRewards()).toEqual(['map-3', 'map-2']);
  });

  it.each([
    ['2', []], ['3', ['map-2']], ['4', ['map-2', 'map-3']], ['17', ['map-2', 'map-3']],
  ])('migrates V5 saves and exports at campaign map %s', (highest, rewards) => {
    const exported = JSON.parse(exportStoredGameProgressJson());
    exported.formatVersion = 5;
    exported.progress.schemaVersion = 5;
    exported.progress.coopDefense.highestUnlockedMapId = highest;
    delete exported.progress.coopDefense.persistentBaseHealthRewards;
    storage.setItem(LOCAL_PROGRESS_STORAGE_KEY, JSON.stringify(exported.progress));
    invalidateLocalStorageCache();
    expect(getStoredPersistentBaseHealthRewards()).toEqual(rewards);
    expect(importStoredGameProgressJson(JSON.stringify(exported)).ok).toBe(true);
    expect(getStoredPersistentBaseHealthRewards()).toEqual(rewards);
  });

  it('does not infer HP rewards from campaign unlocks in the current format and rejects corrupt rewards atomically', () => {
    const exported = JSON.parse(exportStoredGameProgressJson());
    exported.progress.coopDefense.highestUnlockedMapId = '17';
    expect(importStoredGameProgressJson(JSON.stringify(exported)).ok).toBe(true);
    expect(getStoredPersistentBaseHealthRewards()).toEqual([]);
    const before = exportStoredGameProgressJson();
    for (const invalid of [['map-2', 'map-2'], ['unknown'], 500, null]) {
      exported.progress.coopDefense.persistentBaseHealthRewards = invalid;
      expect(importStoredGameProgressJson(JSON.stringify(exported)).ok).toBe(false);
      expect(JSON.parse(exportStoredGameProgressJson()).progress).toEqual(JSON.parse(before).progress);
    }
  });

  it('resets alpha progress once while preserving legacy device settings', () => {
    storage.setItem(LEGACY_LOCAL_PREFERENCES_KEY, JSON.stringify({
      version: 18,
      audio: { masterVolume: 0.23, effectsVolume: 0.34, musicVolume: 0.45 },
      graphics: { quality: 'low' },
      progression: { coopDefense: { totalXp: 99_999, classesUnlocked: true } },
    }));

    expect(getStoredMasterVolume()).toBe(0.23);
    expect(getStoredGraphicsQuality()).toBe('low');
    expect(getStoredCoopDefenseProgress().totalXp).toBe(0);
    expect(storage.getItem(LOCAL_SETTINGS_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(LEGACY_LOCAL_PREFERENCES_KEY)).toBeNull();
  });

  it('discards obsolete graphics fields without losing audio or quality', () => {
    storage.setItem(LOCAL_SETTINGS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 2, locale: 'de', audio: { masterVolume: 0.2, effectsVolume: 0.3, musicVolume: 0.4 },
      graphics: { quality: 'low', weaponCameraKick: 0 },
    }));
    expect(getStoredGraphicsQuality()).toBe('low');
    expect(getStoredMasterVolume()).toBe(0.2);
    expect(JSON.parse(storage.getItem(LOCAL_SETTINGS_STORAGE_KEY)!).graphics).toEqual({ quality: 'low', groundFogEnabled: true });
    setStoredGraphicsQuality('high');
    invalidateLocalStorageCache();
    expect(getStoredGraphicsQuality()).toBe('high');
    expect(getStoredMasterVolume()).toBe(0.2);
  });

  it('enables unconfigured music while preserving saved volume including mute', () => {
    expect(getStoredMusicVolume()).toBeGreaterThan(0);
    setStoredMusicVolume(0);
    invalidateLocalStorageCache();
    expect(getStoredMusicVolume()).toBe(0);
    setStoredMusicVolume(0.27);
    invalidateLocalStorageCache();
    expect(getStoredMusicVolume()).toBe(0.27);
  });

  it('fills unconfigured music in current settings without resetting other saved settings', () => {
    storage.setItem(LOCAL_SETTINGS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 2, locale: 'de', audio: { masterVolume: 0, effectsVolume: 0.3 },
      graphics: { quality: 'low' },
    }));
    expect(getStoredMusicVolume()).toBeGreaterThan(0);
    expect(getStoredMasterVolume()).toBe(0);
    expect(getStoredGraphicsQuality()).toBe('low');
  });

  it('fills missing legacy music settings but preserves an explicit legacy mute', () => {
    storage.setItem(LEGACY_LOCAL_PREFERENCES_KEY, JSON.stringify({
      version: 18, audio: { masterVolume: 0.2, effectsVolume: 0.3 },
    }));
    expect(getStoredMusicVolume()).toBeGreaterThan(0);
    storage.clear();
    invalidateLocalStorageCache();
    storage.setItem(LEGACY_LOCAL_PREFERENCES_KEY, JSON.stringify({
      version: 18, audio: { masterVolume: 0.2, effectsVolume: 0.3, musicVolume: 0 },
    }));
    expect(getStoredMusicVolume()).toBe(0);
  });

  it('migrates a legacy utility once and preserves an explicit empty tool selection', () => {
    setStoredCoopDefenseTotalXp(77);
    const document = JSON.parse(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)!);
    document.loadout = { utility: 'ROCK_BARRIER' };
    document.coopDefense.defaultProfile = { levels: { unlock_rock_barrier: 1 } };
    storage.setItem(LOCAL_PROGRESS_STORAGE_KEY, JSON.stringify(document));
    invalidateLocalStorageCache();
    const migrated = getStoredCoopDefenseProgress().defaultProfile;
    expect(migrated.toolLoadout).toEqual([{ kind: 'construction', id: 'rock_barrier' }]);
    document.loadout.utility = 'SMOKE_GRENADE'; // Not unlocked in this legacy save.
    storage.setItem(LOCAL_PROGRESS_STORAGE_KEY, JSON.stringify(document));
    invalidateLocalStorageCache();
    expect(getStoredCoopDefenseProgress().defaultProfile.toolLoadout).toEqual([{ kind: 'utility', id: 'HE_GRENADE' }]);
    setStoredCoopDefenseUpgradeProfile({ ...migrated, toolLoadout: [] }, 'dachs_nukem');
    invalidateLocalStorageCache();
    expect(getStoredCoopDefenseProgress().defaultProfile.toolLoadout).toEqual([]);
  });

  it('loads a current schema document after cache invalidation', () => {
    setStoredCoopDefenseTotalXp(77);
    const raw = storage.getItem(LOCAL_PROGRESS_STORAGE_KEY);
    expect(JSON.parse(raw!).schemaVersion).toBe(LOCAL_PROGRESS_SCHEMA_VERSION);

    invalidateLocalStorageCache();
    expect(getStoredCoopDefenseProgress().totalXp).toBe(77);
  });

  it('stores the persistent base in the progress document and restores it through export/import', () => {
    const state: PersistentBaseState = {
      schemaVersion: PERSISTENT_BASE_STATE_SCHEMA_VERSION,
      revision: 4,
      constructions: [{
        persistentId: 'pb-test-1',
        tool: { kind: 'construction', id: 'rocket_turret' },
        relativeGridX: 2,
        relativeGridY: -1,
        angle: 0.5,
        placementOrder: 0,
      }],
    };
    setStoredPersistentBaseState(state);
    expect(getStoredPersistentBaseState()).toEqual(state);
    const exported = JSON.parse(exportStoredGameProgressJson());
    expect(exported.progress.schemaVersion).toBe(LOCAL_PROGRESS_SCHEMA_VERSION);
    expect(exported.progress.coopDefense.persistentBase).toEqual(state);

    setStoredPersistentBaseState({
      schemaVersion: PERSISTENT_BASE_STATE_SCHEMA_VERSION,
      revision: 0,
      constructions: [],
    });
    expect(importStoredGameProgressJson(JSON.stringify(exported)).ok).toBe(true);
    expect(getStoredPersistentBaseState()).toEqual(state);
  });

  it('schreibt einen host-bestaetigten Beitrag nur, wenn er tatsaechlich neuer ist', () => {
    const confirmed = {
      schemaVersion: 1 as const,
      ownerId: getStoredLocalOwnerId(),
      revision: 3,
      constructions: [],
    };
    expect(setStoredPersonalBaseContribution(confirmed)).toBe(true);
    const writesAfterFirst = storage.writes;

    // Der regelmaessige Sync sieht dieselbe Bestaetigung viele Frames lang. Ohne diese Grenze
    // schriebe er sie bei jedem Frame erneut in den lokalen Speicher.
    expect(setStoredPersonalBaseContribution(confirmed)).toBe(false);
    expect(setStoredPersonalBaseContribution(confirmed)).toBe(false);
    expect(storage.writes).toBe(writesAfterFirst);

    // Dieselbe Revision ersetzt auch keinen abweichenden Inhalt.
    expect(setStoredPersonalBaseContribution({
      ...confirmed,
      constructions: [{
        persistentId: 'sneaked-in',
        tool: { kind: 'construction' as const, id: 'rock_barrier' },
        relativeGridX: 0,
        relativeGridY: 0,
        angle: 0,
        placementOrder: 0,
      }],
    })).toBe(false);
    expect(getStoredPersonalBaseContribution().constructions).toEqual([]);

    // Ein echt neuerer Stand wird geschrieben.
    expect(setStoredPersonalBaseContribution({ ...confirmed, revision: 4 })).toBe(true);
    expect(getStoredPersonalBaseContribution().revision).toBe(4);
    expect(storage.writes).toBeGreaterThan(writesAfterFirst);
  });

  it('bindet den persoenlichen Beitrag an eine dauerhafte Besitzeridentitaet', () => {
    const ownerId = getStoredLocalOwnerId();
    expect(ownerId.length).toBeGreaterThan(0);
    // Sie ueberlebt einen Reload; sonst verloere der Spieler den Besitz an allem Gebauten.
    invalidateLocalStorageCache();
    expect(getStoredLocalOwnerId()).toBe(ownerId);
    expect(getStoredPersonalBaseContribution().ownerId).toBe(ownerId);
  });

  it('carries the persistent-base entitlement through export and import', () => {
    expect(getStoredCoopDefenseProgress().persistentBaseUnlocked).toBe(false);
    setStoredPersistentBaseUnlocked(true);

    const exported = JSON.parse(exportStoredGameProgressJson());
    expect(exported.progress.coopDefense.persistentBaseUnlocked).toBe(true);

    setStoredPersistentBaseUnlocked(false);
    expect(importStoredGameProgressJson(JSON.stringify(exported)).ok).toBe(true);
    expect(getStoredCoopDefenseProgress().persistentBaseUnlocked).toBe(true);

    // Ein kaputter Wert macht den Import ungueltig, statt still auf einen Default zu fallen.
    const corrupt = structuredClone(exported);
    corrupt.progress.coopDefense.persistentBaseUnlocked = 'yes';
    expect(importStoredGameProgressJson(JSON.stringify(corrupt)).ok).toBe(false);
    expect(getStoredCoopDefenseProgress().persistentBaseUnlocked).toBe(true);
  });

  it('carries the semantic persistent-base area stage through export and import', () => {
    expect(getStoredPersistentBaseAreaStage()).toBe(0);
    expect(setStoredPersistentBaseAreaStage(1)).toBe(true);
    expect(getStoredPersistentBaseAreaStage()).toBe(1);

    const exported = JSON.parse(exportStoredGameProgressJson());
    expect(exported.progress.coopDefense.persistentBaseAreaStage).toBe(1);

    resetStoredCoopDefenseCharacter();
    expect(getStoredPersistentBaseAreaStage()).toBe(0);
    expect(importStoredGameProgressJson(JSON.stringify(exported)).ok).toBe(true);
    expect(getStoredPersistentBaseAreaStage()).toBe(1);

    const corrupt = structuredClone(exported);
    corrupt.progress.coopDefense.persistentBaseAreaStage = 99;
    expect(importStoredGameProgressJson(JSON.stringify(corrupt)).ok).toBe(false);
    expect(getStoredPersistentBaseAreaStage()).toBe(1);
  });

  it('rejects V2 progress exports, duplicate persistent IDs and corrupt persistent-base data', () => {
    const envelope = JSON.parse(exportStoredGameProgressJson());

    const v2 = { ...envelope, formatVersion: 2 };
    expect(importStoredGameProgressJson(JSON.stringify(v2))).toEqual({
      ok: false,
      messageKey: 'ui.lobby.saveIncompatible',
    });

    const duplicate = structuredClone(envelope);
    duplicate.progress.coopDefense.persistentBase.constructions = [
      {
        persistentId: 'duplicate',
        tool: { kind: 'construction', id: 'rocket_turret' },
        relativeGridX: 0,
        relativeGridY: 0,
        angle: 0,
        placementOrder: 0,
      },
      {
        persistentId: 'duplicate',
        tool: { kind: 'utility', id: 'ROCK_BARRIER' },
        relativeGridX: 1,
        relativeGridY: 0,
        angle: 0,
        placementOrder: 1,
      },
    ];
    expect(importStoredGameProgressJson(JSON.stringify(duplicate))).toEqual({
      ok: false,
      messageKey: 'ui.lobby.saveInvalid',
    });

    const corrupt = structuredClone(envelope);
    corrupt.progress.coopDefense.persistentBase = {
      schemaVersion: 1,
      radiusCells: 99,
      revision: 0,
      constructions: [],
    };
    expect(importStoredGameProgressJson(JSON.stringify(corrupt))).toEqual({
      ok: false,
      messageKey: 'ui.lobby.saveInvalid',
    });
  });

  it('resets the persistent base with the character progress', () => {
    setStoredPersistentBaseState({
      schemaVersion: PERSISTENT_BASE_STATE_SCHEMA_VERSION,
      revision: 3,
      constructions: [],
    });
    resetStoredCoopDefenseCharacter();
    expect(getStoredPersistentBaseState()).toEqual({
      schemaVersion: PERSISTENT_BASE_STATE_SCHEMA_VERSION,
      revision: 0,
      constructions: [],
    });
  });

  it('resets the complete coop debug progress to its defaults', () => {
    setStoredCoopDefenseCheatProgress(12_345, 4, '10');
    setStoredCoopDefenseItemsUnlocked(true);
    setStoredPersistentBaseUnlocked(true);
    setStoredPersistentBaseAreaStage(1);
    grantStoredPersistentBaseRewards(getPersistentBaseRewardIds());

    resetStoredCoopDefenseCharacter();

    const progress = getStoredCoopDefenseProgress();
    expect(progress.totalXp).toBe(0);
    expect(progress.highestUnlockedMapId).toBe('1');
    expect(progress.completedBossMapIds).toEqual([]);
    expect(progress.unlockedClassIds).toEqual([]);
    expect(progress.classesUnlocked).toBe(false);
    expect(progress.itemsUnlocked).toBe(false);
    expect(progress.items).toEqual([]);
    expect(progress.persistentBaseUnlocked).toBe(false);
    expect(progress.persistentBaseAreaStage).toBe(0);
    expect(progress.persistentBaseRewardUnlocks).toEqual([]);
  });

  it('ignores progress under the previous storage key and preserves settings', () => {
    setStoredCoopDefenseTotalXp(99_999);
    const oldProgress = storage.getItem(LOCAL_PROGRESS_STORAGE_KEY);
    storage.setItem('fragdachse_progress_v1', oldProgress!);
    storage.removeItem(LOCAL_PROGRESS_STORAGE_KEY);
    storage.setItem(LOCAL_SETTINGS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 2,
      locale: 'de',
      audio: { masterVolume: 0.23, effectsVolume: 0.34, musicVolume: 0.45 },
      graphics: { quality: 'low' },
    }));
    invalidateLocalStorageCache();

    expect(getStoredCoopDefenseProgress().totalXp).toBe(0);
    expect(getStoredPlayerName()).toBeNull();
    expect(getStoredMasterVolume()).toBe(0.23);
    expect(getStoredGraphicsQuality()).toBe('low');
    expect(getStoredLocale()).toBe('de');
    expect(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)).not.toBeNull();
  });

  it('rejects exports from the previous progress generation', () => {
    setStoredCoopDefenseTotalXp(321);
    const envelope = JSON.parse(exportStoredGameProgressJson());
    envelope.formatVersion = 1;

    resetStoredCoopDefenseCharacter();
    const result = importStoredGameProgressJson(JSON.stringify(envelope));
    expect(result).toEqual({ ok: false, messageKey: 'ui.lobby.saveIncompatible' });
    expect(getStoredCoopDefenseProgress().totalXp).toBe(0);
  });

  it('stores only changed upgrade levels and no pre-unlock class copies', () => {
    const profile = buildDefaultCoopDefenseUpgradeProfile();
    profile.upgrades.hp.level = 1;
    setStoredCoopDefenseUpgradeProfile(profile);

    const raw = storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)!;
    const document = JSON.parse(raw);
    expect(raw).not.toContain('"unlocked"');
    expect(document.coopDefense.defaultProfile.levels.hp).toBe(1);
    expect(document.coopDefense.profilesByClass).toBeUndefined();
    expect(document.coopDefense.selectedClassId).toBeUndefined();
    invalidateLocalStorageCache();
    expect(getStoredCoopDefenseProgress().defaultProfile.upgrades.hp).toEqual({
      level: 1,
      unlocked: true,
    });
  });

  it('keeps settings separate from progress and character resets', () => {
    setStoredMasterVolume(0.31);
    setStoredGraphicsQuality('medium');
    const settingsBefore = storage.getItem(LOCAL_SETTINGS_STORAGE_KEY);
    setStoredCoopDefenseTotalXp(500);
    expect(storage.getItem(LOCAL_SETTINGS_STORAGE_KEY)).toBe(settingsBefore);

    resetStoredCoopDefenseCharacter();
    expect(getStoredMasterVolume()).toBe(0.31);
    expect(getStoredGraphicsQuality()).toBe('medium');
  });

  it('selects locale from the browser only until a valid device setting exists', () => {
    vi.stubGlobal('navigator', { language: 'de-AT' });
    expect(resolveBrowserLocale()).toBe('de');
    expect(getStoredLocale()).toBe('de');

    vi.stubGlobal('navigator', { language: 'fr-FR' });
    storage.removeItem(LOCAL_SETTINGS_STORAGE_KEY);
    invalidateLocalStorageCache();
    expect(resolveBrowserLocale()).toBe('en');
    expect(getStoredLocale()).toBe('en');

    setStoredLocale('de');
    vi.stubGlobal('navigator', { language: 'en-US' });
    invalidateLocalStorageCache();
    expect(getStoredLocale()).toBe('de');
  });

  it('sanitizes invalid stored locales and keeps locale out of progress', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    storage.setItem(LOCAL_SETTINGS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 2,
      locale: 'xx',
      audio: { masterVolume: 0.2, effectsVolume: 0.3, musicVolume: 0.4 },
      graphics: { quality: 'low' },
    }));
    invalidateLocalStorageCache();
    expect(getStoredLocale()).toBe('en');

    setStoredLocale('de');
    resetStoredCoopDefenseCharacter();
    expect(getStoredLocale()).toBe('de');
    const progress = JSON.parse(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)!);
    expect(progress.locale).toBeUndefined();
    expect(exportStoredGameProgressJson()).not.toContain('locale');
  });

  it('exports and imports the complete progress without device settings', () => {
    setStoredCoopDefenseTotalXp(321);
    setStoredMasterVolume(0.12);
    const json = exportStoredGameProgressJson();
    expect(json).not.toContain('masterVolume');

    setStoredCoopDefenseTotalXp(0);
    const result = importStoredGameProgressJson(json);
    expect(result.ok).toBe(true);
    expect(getStoredCoopDefenseProgress().totalXp).toBe(321);
    expect(getStoredMasterVolume()).toBe(0.12);
  });

  it('rejects invalid imports without changing the existing save', () => {
    setStoredCoopDefenseTotalXp(456);
    const before = storage.getItem(LOCAL_PROGRESS_STORAGE_KEY);
    const malformed = importStoredGameProgressJson('{broken');
    expect(malformed.ok).toBe(false);
    expect(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)).toBe(before);

    const envelope = JSON.parse(exportStoredGameProgressJson());
    envelope.progress.coopDefense.totalXp = 'lots';
    const manipulated = importStoredGameProgressJson(JSON.stringify(envelope));
    expect(manipulated.ok).toBe(false);
    expect(getStoredCoopDefenseProgress().totalXp).toBe(456);
  });

  it('finishes a cancelled file import without changing the existing save', async () => {
    setStoredCoopDefenseTotalXp(456);
    const before = storage.getItem(LOCAL_PROGRESS_STORAGE_KEY);
    const input = {
      files: [],
      click: vi.fn(),
      oncancel: null as (() => void) | null,
    };
    vi.stubGlobal('document', { createElement: () => input });
    const completed = vi.fn();
    void importStoredGameProgressFile().then(completed);

    input.oncancel?.();
    await Promise.resolve();

    expect(completed).toHaveBeenCalledWith({ ok: false, messageKey: 'ui.lobby.saveNoFile' });
    expect(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)).toBe(before);
  });

  it('rechecks import permission after reading the selected file', async () => {
    setStoredCoopDefenseTotalXp(321);
    const json = exportStoredGameProgressJson();
    setStoredCoopDefenseTotalXp(456);
    const before = storage.getItem(LOCAL_PROGRESS_STORAGE_KEY);
    let finishReading!: (json: string) => void;
    const reading = new Promise<string>((resolve) => { finishReading = resolve; });
    const input = {
      files: [{ size: json.length, text: () => reading }],
      click: vi.fn(),
      onchange: null as (() => Promise<void>) | null,
    };
    vi.stubGlobal('document', { createElement: () => input });
    let allowed = true;
    const result = importStoredGameProgressFile(() => allowed);
    const selected = input.onchange!();
    allowed = false;
    finishReading(json);
    await selected;
    expect(await result).toEqual({ ok: false, messageKey: 'ui.lobby.saveImportBlocked' });
    expect(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)).toBe(before);
    expect(getStoredCoopDefenseProgress().totalXp).toBe(456);
  });

  it('does not open the file picker when progress cannot be replaced', async () => {
    const createElement = vi.fn();
    vi.stubGlobal('document', { createElement });
    expect(await importStoredGameProgressFile(() => false))
      .toEqual({ ok: false, messageKey: 'ui.lobby.saveImportBlocked' });
    expect(createElement).not.toHaveBeenCalled();
  });

  it('serves repeated reads from cache and reloads only after explicit invalidation', () => {
    expect(getStoredCoopDefenseProgress().totalXp).toBe(0);
    const readsAfterLoad = storage.reads;
    expect(getStoredCoopDefenseProgress().totalXp).toBe(0);
    expect(getStoredMasterVolume()).toBeGreaterThanOrEqual(0);
    expect(storage.reads).toBe(readsAfterLoad);

    const document = JSON.parse(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)!);
    document.coopDefense.totalXp = 12;
    storage.setItem(LOCAL_PROGRESS_STORAGE_KEY, JSON.stringify(document));
    expect(getStoredCoopDefenseProgress().totalXp).toBe(0);
    invalidateLocalStorageCache();
    expect(getStoredCoopDefenseProgress().totalXp).toBe(12);
  });

  it('keeps the in-memory game usable when localStorage writes fail', () => {
    getStoredCoopDefenseProgress();
    storage.throwOnWrite = true;
    expect(() => setStoredCoopDefenseTotalXp(42)).not.toThrow();
    expect(getStoredCoopDefenseProgress().totalXp).toBe(42);
  });
});
