import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadoutToolRef } from '../src/types';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  getCoopDefenseUpgradeState,
  getLoadoutToolSlots,
  levelUpCoopDefenseUpgrade,
  respecCoopDefenseUpgradeCategory,
  setLoadoutToolSlots,
} from '../src/utils/coopDefenseUpgrades';
import {
  getStoredCoopDefenseProgress,
  resetStoredCoopDefenseUpgradeProfiles,
  setStoredCoopDefenseClassesUnlocked,
  setStoredCoopDefenseTotalXp,
  setStoredCoopDefenseUpgradeProfile,
} from '../src/utils/localPreferences';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('coop-defense respec', () => {
  it('resets only the selected category to starting levels', () => {
    let profile = buildDefaultCoopDefenseUpgradeProfile('dachs_nukem');
    profile = levelUpCoopDefenseUpgrade(profile, 'hp', 20, 0, 'dachs_nukem')!;
    profile = levelUpCoopDefenseUpgrade(profile, 'glock_adrenaline_gain', 20, 0, 'dachs_nukem')!;

    const reset = respecCoopDefenseUpgradeCategory(profile, 'weapon1', 'dachs_nukem');

    expect(reset).not.toBeNull();
    expect(getCoopDefenseUpgradeState(reset!, 'glock_adrenaline_gain', 'dachs_nukem').level).toBe(0);
    expect(getCoopDefenseUpgradeState(reset!, 'unlock_glock', 'dachs_nukem').level).toBe(1);
    expect(getCoopDefenseUpgradeState(reset!, 'hp', 'dachs_nukem').level).toBe(1);
  });

  it('removes Inspector tools whose construction unlocks were respecced', () => {
    let profile = buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs');
    profile = levelUpCoopDefenseUpgrade(
      profile,
      'unlock_machine_gun_turret',
      50,
      0,
      'inspector_gadachs',
    )!;
    const tools: LoadoutToolRef[] = [
      { kind: 'construction', id: 'rocket_turret' },
      { kind: 'construction', id: 'machine_gun_turret' },
    ];
    profile = setLoadoutToolSlots(profile, tools, tools[1]);

    const reset = respecCoopDefenseUpgradeCategory(profile, 'construction', 'inspector_gadachs');

    expect(reset).not.toBeNull();
    expect(getCoopDefenseUpgradeState(reset!, 'unlock_machine_gun_turret', 'inspector_gadachs').level).toBe(0);
    expect(getLoadoutToolSlots(reset!)).toEqual([
      { kind: 'construction', id: 'rocket_turret' },
    ]);
    expect(reset!.selectedTool).toEqual({ kind: 'construction', id: 'rocket_turret' });
  });

  describe('persistent full respec', () => {
    beforeEach(() => {
      vi.stubGlobal('window', { localStorage: new MemoryStorage() });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('resets every class profile while preserving shared progression', () => {
      setStoredCoopDefenseTotalXp(500);
      setStoredCoopDefenseClassesUnlocked(true);

      const stored = getStoredCoopDefenseProgress();
      const nukem = levelUpCoopDefenseUpgrade(
        stored.profilesByClass.dachs_nukem,
        'hp',
        20,
        0,
        'dachs_nukem',
      )!;
      const steel = levelUpCoopDefenseUpgrade(
        stored.profilesByClass.dachs_of_steel,
        'max_armor',
        20,
        0,
        'dachs_of_steel',
      )!;
      const inspector = levelUpCoopDefenseUpgrade(
        stored.profilesByClass.inspector_gadachs,
        'unlock_machine_gun_turret',
        20,
        0,
        'inspector_gadachs',
      )!;
      setStoredCoopDefenseUpgradeProfile(nukem, 'dachs_nukem');
      setStoredCoopDefenseUpgradeProfile(steel, 'dachs_of_steel');
      setStoredCoopDefenseUpgradeProfile(inspector, 'inspector_gadachs');

      resetStoredCoopDefenseUpgradeProfiles();

      const reset = getStoredCoopDefenseProgress();
      expect(reset.totalXp).toBe(500);
      expect(reset.classesUnlocked).toBe(true);
      expect(reset.selectedClassId).toBe('dachs_nukem');
      expect(reset.defaultProfile.upgrades.hp.level).toBe(0);
      expect(reset.profilesByClass.dachs_nukem.upgrades.hp.level).toBe(0);
      expect(reset.profilesByClass.dachs_of_steel.upgrades.max_armor.level).toBe(0);
      expect(reset.profilesByClass.inspector_gadachs.upgrades.unlock_machine_gun_turret.level).toBe(0);
    });

    it('keeps the other class profile unchanged when the active class is reset', () => {
      setStoredCoopDefenseClassesUnlocked(true);
      const stored = getStoredCoopDefenseProgress();
      const nukem = levelUpCoopDefenseUpgrade(
        stored.profilesByClass.dachs_nukem,
        'hp',
        20,
        0,
        'dachs_nukem',
      )!;
      const steel = levelUpCoopDefenseUpgrade(
        stored.profilesByClass.dachs_of_steel,
        'max_armor',
        20,
        0,
        'dachs_of_steel',
      )!;
      setStoredCoopDefenseUpgradeProfile(nukem, 'dachs_nukem');
      setStoredCoopDefenseUpgradeProfile(steel, 'dachs_of_steel');

      setStoredCoopDefenseUpgradeProfile(
        buildDefaultCoopDefenseUpgradeProfile('dachs_nukem'),
        'dachs_nukem',
      );

      const reset = getStoredCoopDefenseProgress();
      expect(reset.profilesByClass.dachs_nukem.upgrades.hp.level).toBe(0);
      expect(reset.profilesByClass.dachs_of_steel.upgrades.max_armor.level).toBe(1);
    });
  });
});
