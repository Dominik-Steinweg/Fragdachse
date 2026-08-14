import { describe, expect, it } from 'vitest';
import type { CoopDefenseClassId, GameMode, LoadoutSlot } from '../src/types';
import {
  describeLoadoutItem,
  describeLoadoutTool,
  getLoadoutSlotItems,
  getSelectableLoadoutItems,
} from '../src/loadout/LoadoutCatalog';
import { DEFAULT_LOADOUT } from '../src/loadout/LoadoutConfig';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  getCoopDefenseUpgradeTextureKey,
  hasCoopDefenseDedicatedUpgradeIcon,
  isCoopDefenseLoadoutItemSelectable,
  levelUpCoopDefenseUpgrade,
} from '../src/utils/coopDefenseUpgrades';
import { getCoopDefenseProgressSnapshot } from '../src/utils/coopDefenseProgression';
import { getLocale } from '../src/i18n';
import { getLoadoutItemName } from '../src/i18n/contentPresentation';

const COOP_DEFENSE: GameMode = 'coop_defense' as GameMode;
const SLOTS: readonly LoadoutSlot[] = ['weapon1', 'weapon2', 'utility', 'ultimate'];
const CLASSES: readonly CoopDefenseClassId[] = ['dachs_nukem', 'dachs_of_steel', 'inspector_gadachs'];

describe('loadout catalog', () => {
  it('offers only unlocked items per slot and never an empty list', () => {
    for (const classId of CLASSES) {
      const profile = buildDefaultCoopDefenseUpgradeProfile(classId);
      for (const slot of SLOTS) {
        const items = getSelectableLoadoutItems(slot, COOP_DEFENSE, profile, classId);
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
          // Der Fallback-Eintrag darf als einziger ungefiltert durchkommen.
          if (items.length === 1 && item.id === DEFAULT_LOADOUT[slot].id) continue;
          expect(isCoopDefenseLoadoutItemSelectable(profile, slot, item.id, classId)).toBe(true);
        }
      }
    }
  });

  it('starts Inspector with the Plasmabrenner in weapon 2', () => {
    const profile = buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs');
    const weapon2 = getSelectableLoadoutItems('weapon2', COOP_DEFENSE, profile, 'inspector_gadachs');
    const progress = getCoopDefenseProgressSnapshot(0, profile, 0, 'inspector_gadachs');
    const weapon2Category = progress.upgradeCategories.find((category) => category.id === 'weapon2');

    expect(weapon2.map((item) => item.id)).toEqual(['PLASMA_BURNER']);
    expect(weapon2Category?.upgrades[0]?.id).toBe('unlock_plasma_burner');

    const withMatrix = levelUpCoopDefenseUpgrade(
      profile,
      'unlock_overcharge_core',
      20,
      0,
      'inspector_gadachs',
    )!;
    expect(getSelectableLoadoutItems('weapon2', COOP_DEFENSE, withMatrix, 'inspector_gadachs')
      .map((item) => item.id))
      .toEqual(['PLASMA_BURNER', 'OVERCHARGE_CORE']);
  });

  it('grows the selectable list when the matching unlock is skilled', () => {
    const classId: CoopDefenseClassId = 'dachs_nukem';
    const base = buildDefaultCoopDefenseUpgradeProfile(classId);
    const before = getSelectableLoadoutItems('utility', COOP_DEFENSE, base, classId);
    expect(before.map((item) => item.id)).not.toContain('SMOKE_GRENADE');

    const skilled = levelUpCoopDefenseUpgrade(base, 'unlock_smoke_grenade', 20, 0, classId)!;
    const after = getSelectableLoadoutItems('utility', COOP_DEFENSE, skilled, classId);
    expect(after.map((item) => item.id)).toContain('SMOKE_GRENADE');
  });

  it('mirrors the selectable items in the progress snapshot', () => {
    const classId: CoopDefenseClassId = 'dachs_of_steel';
    const profile = buildDefaultCoopDefenseUpgradeProfile(classId);
    const snapshot = getCoopDefenseProgressSnapshot(0, profile, 0, classId);
    for (const slot of SLOTS) {
      expect(snapshot.unlockedItemsBySlot[slot].map((item) => item.id)).toEqual(
        getSelectableLoadoutItems(slot, COOP_DEFENSE, profile, classId).map((item) => item.id),
      );
    }
  });

  it('presents both tool kinds with the same accent so they read as equivalent', () => {
    const construction = describeLoadoutTool({ kind: 'construction', id: 'rocket_turret' });
    const utility = describeLoadoutTool({ kind: 'utility', id: 'HE_GRENADE' });
    expect(construction.accentColor).toBe(utility.accentColor);
    // Slot und Unlock-Knoten teilen dasselbe dedizierte Artwork.
    expect(construction.textureKey).toBe('UPGRADE_UNLOCK_ROCKET_TURRET');
    expect(utility.textureKey).toBe('HE_GRENADE');
  });

  it('loads and uses dedicated artwork for every turret construction slot', () => {
    for (const id of ['unlock_rocket_turret', 'unlock_machine_gun_turret', 'unlock_flame_turret']) {
      expect(hasCoopDefenseDedicatedUpgradeIcon(id)).toBe(true);
    }
    expect(describeLoadoutTool({ kind: 'construction', id: 'rocket_turret' }).textureKey)
      .toBe('UPGRADE_UNLOCK_ROCKET_TURRET');
    expect(describeLoadoutTool({ kind: 'construction', id: 'machine_gun_turret' }).textureKey)
      .toBe('UPGRADE_UNLOCK_MACHINE_GUN_TURRET');
    expect(describeLoadoutTool({ kind: 'construction', id: 'flame_turret' }).textureKey)
      .toBe('UPGRADE_UNLOCK_FLAME_TURRET');
  });

  it('keeps Inspector support weapons out of PvP loadout lists', () => {
    const supportWeapons = ['OVERCHARGE_CORE', 'PLASMA_BURNER', 'ENERGY_INJECTOR'];
    for (const mode of ['deathmatch', 'team_deathmatch', 'capture_the_beer'] as const) {
      const weapon2Ids = getLoadoutSlotItems('weapon2', mode).map((item) => item.id);
      for (const weaponId of supportWeapons) expect(weapon2Ids).not.toContain(weaponId);
    }

    const coopWeapon2Ids = getLoadoutSlotItems('weapon2', COOP_DEFENSE).map((item) => item.id);
    for (const weaponId of supportWeapons) expect(coopWeapon2Ids).toContain(weaponId);
  });

  it('uses final dedicated upgrade icons without undoing existing aliases', () => {
    expect(getCoopDefenseUpgradeTextureKey('dash_fire_trail')).toBe('UPGRADE_DASH_FIRE_TRAIL');
    expect(getCoopDefenseUpgradeTextureKey('shotgun_range')).toBe('UPGRADE_SHOTGUN_RANGE');
    expect(getCoopDefenseUpgradeTextureKey('glock_adrenaline_gain')).toBe('UPGRADE_GLOCK_ADRENALINE_GAIN');
    expect(getCoopDefenseUpgradeTextureKey('flamethrower_adrenalin_efficiency')).toBe(
      'UPGRADE_FLAMETHROWER_ADRENALIN_EFFICIENCY',
    );
    for (const id of [
      'unlock_plasma_burner',
      'unlock_overcharge_core',
      'unlock_energy_injector',
      'unlock_tesla_turret',
      'unlock_gravity_turret',
      'unlock_slow_bubble_turret',
      'unlock_medic_pedestal',
      'unlock_armor_pedestal',
      'unlock_rock_barrier',
      'unlock_spore_turret',
    ]) {
      expect(getCoopDefenseUpgradeTextureKey(id)).toBe(`UPGRADE_${id.toUpperCase()}`);
    }
    expect(getCoopDefenseUpgradeTextureKey('unlock_armageddon')).toBe('UPGRADE_UNLOCK_ARMAGEDDON');
  });

  it('keeps internal Coop utility variants out of user-facing catalog lists', () => {
    const utilityIds = getLoadoutSlotItems('utility', COOP_DEFENSE).map((item) => item.id);
    expect(utilityIds).not.toContain('ROCK_BARRIER_COOP');
    expect(utilityIds).not.toContain('SPORE_TURRET_COOP');
    expect(utilityIds).toContain('ROCK_BARRIER');
    expect(utilityIds).toContain('SPORE_TURRET');
  });

  it('resolves display names from the config a slot actually uses', () => {
    expect(describeLoadoutItem('weapon1', 'GLOCK').displayName).toBe('Glock');
    expect(describeLoadoutItem('utility', 'HE_GRENADE').displayName).toBe(getLoadoutItemName('HE_GRENADE', getLocale()));
    expect(describeLoadoutItem('weapon1', 'UNKNOWN_ITEM').displayName).toBe('UNKNOWN ITEM');
    expect(describeLoadoutItem('weapon1', 'LEAF_BLOWER').displayName).toBe('Laubbläser');
    expect(describeLoadoutItem('weapon2', 'PLASMA_BURNER').displayName).toBe('Plasmabrenner');
  });

  it('uses the dedicated upgrade artwork in the four Ultimate slots', () => {
    expect(describeLoadoutItem('ultimate', 'ARMAGEDDON').textureKey).toBe('UPGRADE_UNLOCK_ARMAGEDDON');
    expect(describeLoadoutItem('ultimate', 'GAUSS_RIFLE').textureKey).toBe('UPGRADE_UNLOCK_GAUSS_RIFLE');
    expect(describeLoadoutItem('ultimate', 'AIRSTRIKE').textureKey).toBe('UPGRADE_UNLOCK_AIRSTRIKE');
    expect(describeLoadoutItem('ultimate', 'HONEY_BADGER_RAGE').textureKey)
      .toBe('UPGRADE_UNLOCK_HONEY_BADGER_RAGE');
  });

  it('uses the dedicated upgrade artwork for Inspector weapon 2 slots', () => {
    expect(describeLoadoutItem('weapon2', 'PLASMA_BURNER').textureKey)
      .toBe('UPGRADE_UNLOCK_PLASMA_BURNER');
    expect(describeLoadoutItem('weapon2', 'OVERCHARGE_CORE').textureKey)
      .toBe('UPGRADE_UNLOCK_OVERCHARGE_CORE');
    expect(describeLoadoutItem('weapon2', 'ENERGY_INJECTOR').textureKey)
      .toBe('UPGRADE_UNLOCK_ENERGY_INJECTOR');
  });
});
