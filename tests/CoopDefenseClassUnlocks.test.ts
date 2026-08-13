import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStoredCoopDefenseProgress,
  resetStoredCoopDefenseCharacter,
  setStoredCoopDefenseClassesUnlocked,
  setStoredCoopDefenseTotalXp,
  setStoredCoopDefenseUpgradeProfile,
  setStoredHighestUnlockedCoopDefenseMapId,
  unlockStoredCoopDefenseMapAfterVictory,
  unlockStoredCoopDefenseClassesAfterVictory,
} from '../src/utils/localPreferences';
import {
  getUnlockedCoopDefenseClassIds,
  isCoopDefenseClassUnlocked,
} from '../src/config/coopDefenseClasses';
import {
  getSpentCoopDefenseUpgradePoints,
  levelUpCoopDefenseUpgrade,
} from '../src/utils/coopDefenseUpgrades';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('coop-defense class unlock progression', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts locked and mirrors common default skills without charging unavailable Inspector skills', () => {
    const fresh = getStoredCoopDefenseProgress();
    expect(fresh.classesUnlocked).toBe(false);
    expect(fresh.unlockedClassIds).toEqual([]);

    const upgraded = levelUpCoopDefenseUpgrade(
      fresh.defaultProfile,
      'run_speed',
      20,
      0,
      'dachs_nukem',
    );
    expect(upgraded).not.toBeNull();
    setStoredCoopDefenseUpgradeProfile(upgraded!, 'dachs_nukem');

    const stored = getStoredCoopDefenseProgress();
    expect(stored.defaultProfile.upgrades.run_speed.level).toBe(1);
    expect(stored.profilesByClass.dachs_nukem.upgrades.run_speed.level).toBe(1);
    expect(stored.profilesByClass.dachs_of_steel.upgrades.run_speed.level).toBe(1);
    expect(stored.profilesByClass.inspector_gadachs.upgrades.run_speed.level).toBe(0);
    expect(getSpentCoopDefenseUpgradePoints(
      stored.profilesByClass.inspector_gadachs,
      'inspector_gadachs',
    )).toBeLessThan(getSpentCoopDefenseUpgradePoints(stored.defaultProfile, 'dachs_nukem'));
  });

  it('unlocks exactly once after a Map 5 victory and then separates class profiles', () => {
    expect(unlockStoredCoopDefenseClassesAfterVictory('4')).toBe(false);
    expect(unlockStoredCoopDefenseClassesAfterVictory('5')).toBe(true);
    expect(unlockStoredCoopDefenseClassesAfterVictory('5')).toBe(false);

    const unlocked = getStoredCoopDefenseProgress();
    expect(unlocked.classesUnlocked).toBe(true);
    expect(unlocked.unlockedClassIds).toEqual(['dachs_nukem', 'dachs_of_steel']);
    expect(isCoopDefenseClassUnlocked('inspector_gadachs', '5')).toBe(false);
    expect(getUnlockedCoopDefenseClassIds('5')).toEqual(['dachs_nukem', 'dachs_of_steel']);
    expect(unlocked.selectedClassId).toBe('dachs_nukem');

    expect(unlockStoredCoopDefenseClassesAfterVictory('8')).toBe(true);
    expect(getStoredCoopDefenseProgress().unlockedClassIds).toEqual([
      'dachs_nukem', 'dachs_of_steel', 'inspector_gadachs',
    ]);

    const upgradedNukem = levelUpCoopDefenseUpgrade(
      unlocked.profilesByClass.dachs_nukem,
      'hp',
      20,
      0,
      'dachs_nukem',
    );
    expect(upgradedNukem).not.toBeNull();
    setStoredCoopDefenseUpgradeProfile(upgradedNukem!, 'dachs_nukem');

    const separated = getStoredCoopDefenseProgress();
    expect(separated.profilesByClass.dachs_nukem.upgrades.hp.level).toBe(1);
    expect(separated.profilesByClass.dachs_of_steel.upgrades.hp.level).toBe(0);
    expect(separated.profilesByClass.inspector_gadachs.upgrades.hp.level).toBe(0);
  });

  it('does not unlock Inspector when Map 7 only unlocks Map 8', () => {
    expect(unlockStoredCoopDefenseClassesAfterVictory('5')).toBe(true);

    expect(unlockStoredCoopDefenseMapAfterVictory('5')).toBe(true);
    expect(unlockStoredCoopDefenseMapAfterVictory('6')).toBe(true);
    expect(unlockStoredCoopDefenseMapAfterVictory('7')).toBe(true);

    const beforeMap8Victory = getStoredCoopDefenseProgress();
    expect(beforeMap8Victory.highestUnlockedMapId).toBe('8');
    expect(beforeMap8Victory.unlockedClassIds).toEqual(['dachs_nukem', 'dachs_of_steel']);

    expect(unlockStoredCoopDefenseClassesAfterVictory('8')).toBe(true);
    expect(getStoredCoopDefenseProgress().unlockedClassIds).toEqual([
      'dachs_nukem', 'dachs_of_steel', 'inspector_gadachs',
    ]);
  });

  it('can be relocked for debugging and fully reset to a fresh character', () => {
    setStoredCoopDefenseTotalXp(500);
    setStoredHighestUnlockedCoopDefenseMapId('5');
    setStoredCoopDefenseClassesUnlocked(true);
    expect(setStoredCoopDefenseClassesUnlocked(false)).toBe(true);

    const relocked = getStoredCoopDefenseProgress();
    expect(relocked.classesUnlocked).toBe(false);
    expect(relocked.selectedClassId).toBe('dachs_nukem');

    resetStoredCoopDefenseCharacter();
    const reset = getStoredCoopDefenseProgress();
    expect(reset.totalXp).toBe(0);
    expect(reset.highestUnlockedMapId).toBe('1');
    expect(reset.completedBossMapIds).toEqual([]);
    expect(reset.classesUnlocked).toBe(false);
    expect(reset.defaultProfile.upgrades.hp.level).toBe(0);
  });
});
