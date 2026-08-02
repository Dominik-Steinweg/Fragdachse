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
  COOP_DEFENSE_PENDING_UPGRADE_ICONS,
  buildDefaultCoopDefenseUpgradeProfile,
  getCoopDefenseUpgradeTextureKey,
  isCoopDefenseLoadoutItemSelectable,
  levelUpCoopDefenseUpgrade,
} from '../src/utils/coopDefenseUpgrades';
import { getCoopDefenseProgressSnapshot } from '../src/utils/coopDefenseProgression';

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
    // Slot und Unlock-Knoten teilen bis zum individuellen Artwork dasselbe temporaere Icon.
    expect(construction.textureKey).toBe('UPGRADE_UNLOCK_ROCKET_TURRET');
    expect(utility.textureKey).toBe('HE_GRENADE');
  });

  it('keeps Inspector support weapons out of PvP loadout lists', () => {
    const supportWeapons = ['OVERCHARGE_CORE', 'REPARATURSTRAHL', 'ENERGIEINJEKTOR'];
    for (const mode of ['deathmatch', 'team_deathmatch', 'capture_the_beer'] as const) {
      const weapon2Ids = getLoadoutSlotItems('weapon2', mode).map((item) => item.id);
      for (const weaponId of supportWeapons) expect(weapon2Ids).not.toContain(weaponId);
    }

    const coopWeapon2Ids = getLoadoutSlotItems('weapon2', COOP_DEFENSE).map((item) => item.id);
    for (const weaponId of supportWeapons) expect(coopWeapon2Ids).toContain(weaponId);
  });

  it('uses generated temporary upgrade icons without undoing existing aliases', () => {
    expect(COOP_DEFENSE_PENDING_UPGRADE_ICONS.has('dash_fire_trail')).toBe(true);
    expect(getCoopDefenseUpgradeTextureKey('dash_fire_trail')).toBe('UPGRADE_DASH_FIRE_TRAIL');
    expect(getCoopDefenseUpgradeTextureKey('shotgun_range')).toBe('UPGRADE_ASMD_PRIMARY_RANGE');
  });

  it('keeps internal Coop utility variants out of user-facing catalog lists', () => {
    const utilityIds = getLoadoutSlotItems('utility', COOP_DEFENSE).map((item) => item.id);
    expect(utilityIds).not.toContain('FELSBAU_COOP');
    expect(utilityIds).not.toContain('FLIEGENPILZ_COOP');
    expect(utilityIds).toContain('FELSBAU');
    expect(utilityIds).toContain('FLIEGENPILZ');
  });

  it('resolves display names from the config a slot actually uses', () => {
    expect(describeLoadoutItem('weapon1', 'GLOCK').displayName).toBe('Glock');
    expect(describeLoadoutItem('utility', 'HE_GRENADE').displayName).toBe('HE Granate');
    expect(describeLoadoutItem('weapon1', 'UNKNOWN_ITEM').displayName).toBe('UNKNOWN ITEM');
    expect(describeLoadoutItem('weapon1', 'LAUBBLAESER').displayName).toBe('Laubbläser');
    expect(describeLoadoutItem('weapon2', 'REPARATURSTRAHL').displayName).toBe('Plasmabrenner');
  });
});
