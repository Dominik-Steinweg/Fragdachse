import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_LOCAL_PREFERENCES_KEY,
  LOCAL_PROGRESS_SCHEMA_VERSION,
  LOCAL_PROGRESS_STORAGE_KEY,
  LOCAL_SETTINGS_STORAGE_KEY,
  exportStoredGameProgressJson,
  getStoredCoopDefenseProgress,
  getStoredGraphicsQuality,
  getStoredMasterVolume,
  getStoredPlayerName,
  getStoredLocale,
  importStoredGameProgressJson,
  invalidateLocalStorageCache,
  resetStoredCoopDefenseCharacter,
  setStoredCoopDefenseTotalXp,
  setStoredCoopDefenseUpgradeProfile,
  setStoredGraphicsQuality,
  setStoredMasterVolume,
  setStoredLocale,
} from '../src/utils/localPreferences';
import { resolveBrowserLocale } from '../src/i18n/types';
import { buildDefaultCoopDefenseUpgradeProfile } from '../src/utils/coopDefenseUpgrades';

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

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    invalidateLocalStorageCache();
  });

  afterEach(() => {
    invalidateLocalStorageCache();
    vi.unstubAllGlobals();
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

  it('loads a current schema document after cache invalidation', () => {
    setStoredCoopDefenseTotalXp(77);
    const raw = storage.getItem(LOCAL_PROGRESS_STORAGE_KEY);
    expect(JSON.parse(raw!).schemaVersion).toBe(LOCAL_PROGRESS_SCHEMA_VERSION);

    invalidateLocalStorageCache();
    expect(getStoredCoopDefenseProgress().totalXp).toBe(77);
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
