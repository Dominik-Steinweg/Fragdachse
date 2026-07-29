import { describe, expect, it } from 'vitest';
import type { LoadoutToolRef } from '../src/types';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  canLevelDownCoopDefenseUpgrade,
  getCoopDefenseConstructionSlotCapacity,
  getCoopDefenseUpgradeCategories,
  getLoadoutToolRefForUpgrade,
  getLoadoutToolSlots,
  getUnlockedLoadoutToolRefs,
  levelUpCoopDefenseUpgrade,
  sanitizeCoopDefenseUpgradeProfile,
  setLoadoutToolSlots,
} from '../src/utils/coopDefenseUpgrades';
import { getCoopDefenseProgressSnapshot } from '../src/utils/coopDefenseProgression';

describe('shared tool slots', () => {
  it('migrates the standard rocket and HE tools and auto-equips unlocks until full', () => {
    let profile = buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs');
    expect(getCoopDefenseConstructionSlotCapacity(profile)).toBe(3);
    expect(getLoadoutToolSlots(profile)).toEqual([
      { kind: 'construction', id: 'rocket_turret' },
      { kind: 'utility', id: 'HE_GRENADE' },
    ]);

    profile = levelUpCoopDefenseUpgrade(profile, 'unlock_machine_gun_turret', 20, 0, 'inspector_gadachs')!;
    expect(getLoadoutToolSlots(profile)).toContainEqual({ kind: 'construction', id: 'machine_gun_turret' });

    profile = levelUpCoopDefenseUpgrade(profile, 'unlock_flame_turret', 20, 0, 'inspector_gadachs')!;
    expect(getLoadoutToolSlots(profile)).not.toContainEqual({ kind: 'construction', id: 'flame_turret' });
  });

  it('allows manual removal and re-equipping without a minimum fill', () => {
    const profile = buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs');
    const onlyUtility: LoadoutToolRef[] = [{ kind: 'utility', id: 'HE_GRENADE' }];
    const changed = setLoadoutToolSlots(profile, onlyUtility, onlyUtility[0]);
    expect(getLoadoutToolSlots(changed)).toEqual(onlyUtility);
    expect(changed.selectedTool).toEqual(onlyUtility[0]);
    const empty = setLoadoutToolSlots(profile, [], null);
    expect(getLoadoutToolSlots(empty)).toEqual([]);
    expect(empty.selectedTool).toBeNull();
  });

  it('maps construction and utility upgrades to the same shared tool contract', () => {
    expect(getLoadoutToolRefForUpgrade('unlock_machine_gun_turret')).toEqual({
      kind: 'construction',
      id: 'machine_gun_turret',
    });
    expect(getLoadoutToolRefForUpgrade('unlock_smoke_grenade')).toEqual({
      kind: 'utility',
      id: 'SMOKE_GRENADE',
    });
    expect(getLoadoutToolRefForUpgrade('inspector_construction_hp')).toBeNull();

    const progress = getCoopDefenseProgressSnapshot(
      0,
      buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs'),
      0,
      'inspector_gadachs',
    );
    // Die beiden gleichwertigen Utility-Bloecke des Inspectors: Konstruktion und Utility.
    const construction = progress.upgradeCategories.find((category) => category.id === 'construction');
    const utility = progress.upgradeCategories.find((category) => category.id === 'utility');
    expect(construction?.upgrades.find((node) => node.id === 'unlock_rocket_turret')?.toolRef)
      .toEqual({ kind: 'construction', id: 'rocket_turret' });
    expect(construction?.upgrades.find((node) => node.id === 'unlock_felsbau')?.toolRef)
      .toEqual({ kind: 'utility', id: 'FELSBAU' });
    expect(utility?.upgrades.find((node) => node.id === 'unlock_he_grenade')?.toolRef)
      .toEqual({ kind: 'utility', id: 'HE_GRENADE' });
  });

  it('can equip an unlocked utility into a free slot after removing a construction', () => {
    let profile = buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs');
    profile = levelUpCoopDefenseUpgrade(profile, 'unlock_smoke_grenade', 20, 0, 'inspector_gadachs')!;
    expect(getUnlockedLoadoutToolRefs(profile)).toContainEqual({ kind: 'utility', id: 'SMOKE_GRENADE' });

    profile = setLoadoutToolSlots(profile, [
      { kind: 'utility', id: 'HE_GRENADE' },
      { kind: 'utility', id: 'SMOKE_GRENADE' },
    ]);
    expect(getLoadoutToolSlots(profile)).toEqual([
      { kind: 'utility', id: 'HE_GRENADE' },
      { kind: 'utility', id: 'SMOKE_GRENADE' },
    ]);
  });

  it('caps capacity at six and blocks a refund while the removed slot is occupied', () => {
    let profile = buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs');
    profile = levelUpCoopDefenseUpgrade(profile, 'unlock_machine_gun_turret', 50, 0, 'inspector_gadachs')!;
    profile = levelUpCoopDefenseUpgrade(profile, 'unlock_flame_turret', 50, 0, 'inspector_gadachs')!;
    profile = levelUpCoopDefenseUpgrade(profile, 'inspector_construction_slots', 50, 0, 'inspector_gadachs')!;
    profile = setLoadoutToolSlots(profile, [
      { kind: 'construction', id: 'rocket_turret' },
      { kind: 'utility', id: 'HE_GRENADE' },
      { kind: 'construction', id: 'machine_gun_turret' },
      { kind: 'construction', id: 'flame_turret' },
    ]);
    expect(getCoopDefenseConstructionSlotCapacity(profile)).toBe(4);
    expect(canLevelDownCoopDefenseUpgrade(
      profile,
      'inspector_construction_slots',
      'inspector_gadachs',
    )).toBe(false);

    profile = setLoadoutToolSlots(profile, getLoadoutToolSlots(profile).slice(0, 3));
    expect(canLevelDownCoopDefenseUpgrade(
      profile,
      'inspector_construction_slots',
      'inspector_gadachs',
    )).toBe(true);

    profile = levelUpCoopDefenseUpgrade(profile, 'inspector_construction_slots', 50, 0, 'inspector_gadachs')!;
    profile = levelUpCoopDefenseUpgrade(profile, 'inspector_construction_slots', 50, 0, 'inspector_gadachs')!;
    expect(getCoopDefenseConstructionSlotCapacity(profile)).toBe(6);
  });

  it('still reads tool slots stored under the legacy inspector keys', () => {
    const legacy = {
      ...buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs'),
      toolLoadout: undefined,
      selectedTool: undefined,
      inspectorTools: [{ kind: 'utility', id: 'HE_GRENADE' }],
      inspectorSelectedTool: { kind: 'utility', id: 'HE_GRENADE' },
    };
    const migrated = sanitizeCoopDefenseUpgradeProfile(legacy, 'inspector_gadachs');
    expect(migrated.toolLoadout).toEqual([{ kind: 'utility', id: 'HE_GRENADE' }]);
    expect(migrated.selectedTool).toEqual({ kind: 'utility', id: 'HE_GRENADE' });
  });
});

describe('category naming per class', () => {
  it('keeps weapon 2 named consistently and shows construction only for the Inspector', () => {
    const inspector = getCoopDefenseUpgradeCategories('inspector_gadachs');
    expect(inspector.find((category) => category.id === 'weapon2')?.label).toBe('Waffe 2');
    expect(inspector.find((category) => category.id === 'construction')?.label).toBe('Konstruktion');
    expect(inspector.find((category) => category.id === 'utility')?.label).toBe('Utility');

    const nukem = getCoopDefenseUpgradeCategories('dachs_nukem');
    expect(nukem.find((category) => category.id === 'weapon2')?.label).toBe('Waffe 2');
    expect(nukem.find((category) => category.id === 'utility')?.label).toBe('Utility');
    expect(nukem.find((category) => category.id === 'construction')).toBeUndefined();
  });
});
