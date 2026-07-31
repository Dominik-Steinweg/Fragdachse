import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStoredCoopDefenseLoadout,
  getStoredCoopDefenseLoadoutSlot,
  getStoredCoopDefenseProgress,
  resetStoredCoopDefenseCharacter,
  setStoredCoopDefenseClassId,
  setStoredCoopDefenseClassesUnlocked,
  setStoredCoopDefenseLoadoutSlot,
  setStoredLoadoutSlot,
  switchStoredCoopDefenseClassLoadout,
} from '../src/utils/localPreferences';

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

describe('coop-defense class loadout persistence', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps each class loadout independent', () => {
    setStoredCoopDefenseClassesUnlocked(true);
    setStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon1', 'AK47');
    setStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon2', 'P90');
    setStoredCoopDefenseLoadoutSlot('inspector_gadachs', 'weapon1', 'GLOCK');
    setStoredCoopDefenseLoadoutSlot('inspector_gadachs', 'weapon2', 'OVERCHARGE_CORE');

    expect(getStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon1')).toBe('AK47');
    expect(getStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon2')).toBe('P90');
    expect(getStoredCoopDefenseLoadoutSlot('inspector_gadachs', 'weapon1')).toBe('GLOCK');
    expect(getStoredCoopDefenseLoadoutSlot('inspector_gadachs', 'weapon2')).toBe('OVERCHARGE_CORE');
  });

  it('switches class and both loadouts in one preferences write', () => {
    setStoredCoopDefenseClassesUnlocked(true);
    const writesBeforeSwitch = storage.writeCount;

    switchStoredCoopDefenseClassLoadout(
      'dachs_nukem',
      'inspector_gadachs',
      { weapon1: 'AK47', utility: 'FELSEN' },
      { weapon1: 'GLOCK', weapon2: 'ENERGIEINJEKTOR' },
    );

    expect(storage.writeCount).toBe(writesBeforeSwitch + 1);
    expect(getStoredCoopDefenseProgress().selectedClassId).toBe('inspector_gadachs');
    expect(getStoredCoopDefenseLoadout('dachs_nukem')).toMatchObject({
      weapon1: 'AK47',
      utility: 'FELSEN',
    });
    expect(getStoredCoopDefenseLoadout('inspector_gadachs')).toMatchObject({
      weapon1: 'GLOCK',
      weapon2: 'ENERGIEINJEKTOR',
    });
  });

  it('copies the old shared selection to Dachs Nukem when classes unlock', () => {
    setStoredLoadoutSlot('weapon1', 'AK47');
    setStoredCoopDefenseClassesUnlocked(true);

    expect(getStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon1')).toBe('AK47');
  });

  it('clears class loadouts with the character reset', () => {
    setStoredCoopDefenseClassesUnlocked(true);
    setStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon1', 'AK47');

    resetStoredCoopDefenseCharacter();

    expect(getStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon1')).toBeNull();
  });
});
