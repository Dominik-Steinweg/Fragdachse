import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStoredLocalOwnerId,
  getStoredPersonalBaseContribution,
  invalidateLocalStorageCache,
  setStoredPersonalBaseContribution,
} from '../src/utils/localPreferences';
import { PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION } from '../src/config/persistentBase';
import type { PersistentPlayerBaseContribution } from '../src/persistentBase/PersistentBaseTypes';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  writeCount = 0;

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    this.writeCount += 1;
    this.values.set(key, value);
  }
}

function contribution(
  ownerId: string,
  revision: number,
  persistentId: string,
): PersistentPlayerBaseContribution {
  return {
    schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
    ownerId,
    revision,
    constructions: [{
      persistentId,
      tool: { kind: 'construction', id: 'rock_barrier' },
      relativeGridX: 1,
      relativeGridY: 0,
      angle: 0,
      placementOrder: 0,
    }],
  };
}

describe('Persistent Base – lokale bestaetigte Contribution', () => {
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

  it('speichert nur den eigenen host-bestaetigten Stand monoton und ohne Runtime-HP', () => {
    const localOwnerId = getStoredLocalOwnerId();
    const incoming = contribution('foreign-owner', 4, 'confirmed');
    const withRuntimeFields = {
      ...incoming,
      constructions: [{
        ...incoming.constructions[0],
        hp: 17,
        maxHp: 1650,
        runtimeId: 42,
      }],
    } as unknown as PersistentPlayerBaseContribution;

    expect(setStoredPersonalBaseContribution(withRuntimeFields)).toBe(true);
    expect(getStoredPersonalBaseContribution()).toEqual({
      ...incoming,
      ownerId: localOwnerId,
    });
    expect(JSON.stringify(getStoredPersonalBaseContribution())).not.toMatch(/"(?:hp|maxHp|runtimeId)"/);

    // Wiederholte bzw. veraltete reliable Zustandskopien duerfen keinen Ruecksprung erzeugen.
    expect(setStoredPersonalBaseContribution(contribution('foreign-owner', 4, 'different'))).toBe(false);
    expect(setStoredPersonalBaseContribution(contribution('foreign-owner', 3, 'stale'))).toBe(false);
    expect(setStoredPersonalBaseContribution(contribution('foreign-owner', 5, 'newer'))).toBe(true);
    expect(getStoredPersonalBaseContribution().revision).toBe(5);
  });
});
