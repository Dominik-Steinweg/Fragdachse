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
import { COOP_DEFENSE_CONSTRUCTION_MAX_SLOTS } from '../src/config/coopDefenseConstructions';

describe('shared tool slots', () => {
  it('migrates the standard rocket and HE tools and auto-equips unlocks until full', () => {
    let profile = buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs');
    const initialCapacity = getCoopDefenseConstructionSlotCapacity(profile);
    expect(initialCapacity).toBeGreaterThan(0);
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
    const changed = setLoadoutToolSlots(profile, onlyUtility);
    expect(getLoadoutToolSlots(changed)).toEqual(onlyUtility);
    const empty = setLoadoutToolSlots(profile, []);
    expect(getLoadoutToolSlots(empty)).toEqual([]);
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
    expect(construction?.upgrades.find((node) => node.id === 'unlock_rock_barrier')?.toolRef)
      .toEqual({ kind: 'construction', id: 'rock_barrier' });
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

  it('honors the configured capacity cap and blocks a refund while the removed slot is occupied', () => {
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
    const capacityAfterFirstUpgrade = getCoopDefenseConstructionSlotCapacity(profile);
    expect(capacityAfterFirstUpgrade).toBeGreaterThan(0);
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
    expect(getCoopDefenseConstructionSlotCapacity(profile)).toBeLessThanOrEqual(
      COOP_DEFENSE_CONSTRUCTION_MAX_SLOTS,
    );
    expect(getCoopDefenseConstructionSlotCapacity(profile)).toBeGreaterThanOrEqual(
      capacityAfterFirstUpgrade,
    );
  });

});

describe('category naming per class', () => {
  it('shows construction only for the Inspector while the shared categories remain available', () => {
    const inspector = getCoopDefenseUpgradeCategories('inspector_gadachs');
    expect(inspector.some((category) => category.id === 'weapon2')).toBe(true);
    expect(inspector.some((category) => category.id === 'utility')).toBe(true);
    expect(inspector.some((category) => category.id === 'construction')).toBe(true);

    const nukem = getCoopDefenseUpgradeCategories('dachs_nukem');
    expect(nukem.find((category) => category.id === 'construction')).toBeUndefined();
  });
});
