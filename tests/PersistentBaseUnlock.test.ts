import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_PROGRESS_STORAGE_KEY,
  getStoredCoopDefenseProgress,
  getStoredHighestUnlockedCoopDefenseMapId,
  getStoredPersistentBaseUnlocked,
  invalidateLocalStorageCache,
  setStoredPersistentBaseUnlocked,
  unlockStoredCoopDefenseMapAfterVictory,
  unlockStoredPersistentBaseAfterVictory,
} from '../src/utils/localPreferences';
import { PERSISTENT_BASE_UNLOCK_AFTER_MAP_ID } from '../src/config/persistentBase';
import { INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID } from '../src/config/coopDefenseMapUnlocks';

/**
 * Phase 3A – die persistente Basis ist ein eigenstaendiges Entitlement.
 *
 * Abgesicherter Pflichtzustand: Nicht "Map 2 ist freigeschaltet" impliziert nebenbei die Basis,
 * sondern die Progression vergibt sie ausdruecklich. Deshalb ist das Entitlement unabhaengig vom
 * Mapfortschritt schreib- und lesbar – und ueberlebt einen Reload.
 */

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('Persistente Basis – Freischaltung', () => {
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

  it('beginnt gesperrt, obwohl die Freischaltmap von Anfang an spielbar ist', () => {
    expect(getStoredPersistentBaseUnlocked()).toBe(false);
    expect(getStoredCoopDefenseProgress().persistentBaseUnlocked).toBe(false);
    // Genau deshalb braucht es ein eigenes Entitlement: Map 1 ist offen, die Basis nicht.
    expect(getStoredHighestUnlockedCoopDefenseMapId())
      .toBe(INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID);
    expect(PERSISTENT_BASE_UNLOCK_AFTER_MAP_ID).toBe(INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID);
  });

  it('vergibt sie beim Sieg auf der Freischaltmap und nur dort', () => {
    expect(unlockStoredPersistentBaseAfterVictory('2')).toBe(false);
    expect(unlockStoredPersistentBaseAfterVictory('17')).toBe(false);
    expect(getStoredPersistentBaseUnlocked()).toBe(false);

    expect(unlockStoredPersistentBaseAfterVictory(PERSISTENT_BASE_UNLOCK_AFTER_MAP_ID)).toBe(true);
    expect(getStoredPersistentBaseUnlocked()).toBe(true);

    // Der zweite Sieg auf derselben Map vergibt nichts Neues.
    expect(unlockStoredPersistentBaseAfterVictory(PERSISTENT_BASE_UNLOCK_AFTER_MAP_ID)).toBe(false);
    expect(getStoredPersistentBaseUnlocked()).toBe(true);
  });

  it('ueberlebt einen Reload', () => {
    unlockStoredPersistentBaseAfterVictory(PERSISTENT_BASE_UNLOCK_AFTER_MAP_ID);
    expect(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)).not.toBeNull();

    // Derselbe Speicher, frisch gelesen: genau das, was ein Reload tut.
    invalidateLocalStorageCache();
    expect(getStoredPersistentBaseUnlocked()).toBe(true);
  });

  it('bleibt vom Mapfortschritt unabhaengig', () => {
    // Ein Mapfortschritt allein vergibt nichts ...
    unlockStoredCoopDefenseMapAfterVictory(PERSISTENT_BASE_UNLOCK_AFTER_MAP_ID);
    setStoredPersistentBaseUnlocked(false);
    expect(getStoredHighestUnlockedCoopDefenseMapId())
      .not.toBe(INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID);
    expect(getStoredPersistentBaseUnlocked()).toBe(false);

    // ... und das Entitlement laesst sich unabhaengig davon setzen.
    expect(setStoredPersistentBaseUnlocked(true)).toBe(true);
    expect(setStoredPersistentBaseUnlocked(true)).toBe(false);
    expect(getStoredPersistentBaseUnlocked()).toBe(true);
  });

  it('backfillt fehlende V4-Felder nicht aus dem Mapfortschritt', () => {
    const write = (coopDefense: Record<string, unknown>): void => {
      const raw = JSON.parse(storage.getItem(LOCAL_PROGRESS_STORAGE_KEY)!);
      raw.coopDefense = { ...raw.coopDefense, ...coopDefense };
      delete raw.coopDefense.persistentBaseUnlocked;
      storage.setItem(LOCAL_PROGRESS_STORAGE_KEY, JSON.stringify(raw));
      invalidateLocalStorageCache();
    };

    // Ein Dokument des aktuellen Schemas als Vorlage.
    setStoredPersistentBaseUnlocked(false);

    // Wer die Freischaltmap noch nicht geschlagen hat, bekommt nichts geschenkt.
    write({ highestUnlockedMapId: INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID });
    expect(getStoredPersistentBaseUnlocked()).toBe(false);

    // Auch wer sie laengst geschlagen hat, bekommt durch ein unvollstaendiges Dokument nichts
    // rueckwirkend gutgeschrieben. Der Decoder setzt kontrolliert einen frischen V4-Stand.
    write({ highestUnlockedMapId: '5' });
    expect(getStoredPersistentBaseUnlocked()).toBe(false);
  });
});
