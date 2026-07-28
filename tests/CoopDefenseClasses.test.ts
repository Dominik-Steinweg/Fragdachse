import { describe, expect, it } from 'vitest';
import { CoopDefensePlayerModifierSystem } from '../src/systems/CoopDefensePlayerModifierSystem';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  canLevelDownCoopDefenseUpgrade,
  getCoopDefenseConstructionSlotCapacity,
  getCoopDefenseUpgradeCategories,
  getUnlockedCoopDefenseConstructionIds,
  levelDownCoopDefenseUpgrade,
  levelUpCoopDefenseUpgrade,
} from '../src/utils/coopDefenseUpgrades';
import type { CoopDefenseClassId, CoopDefenseUpgradeProfile, LoadoutCommitSnapshot } from '../src/types';
import { resolveLoadoutSelectionIds } from '../src/loadout/LoadoutRules';
import { RepairDroneSystem } from '../src/systems/RepairDroneSystem';
import type { SyncedPlaceableRock } from '../src/types';

function commit(
  classId: CoopDefenseClassId,
  profile = buildDefaultCoopDefenseUpgradeProfile(classId),
): LoadoutCommitSnapshot {
  return {
    weapon1: 'GLOCK',
    weapon2: classId === 'inspector_gadachs' ? null : 'P90',
    utility: 'FELSEN',
    ultimate: 'GAUSS',
    coopDefenseClassId: classId,
    coopDefenseProfile: profile,
  };
}

describe('coop-defense classes', () => {
  it('does not alter loadout slots outside coop defense', () => {
    const snapshot = resolveLoadoutSelectionIds(
      undefined,
      'deathmatch',
      buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs'),
      'inspector_gadachs',
    );
    expect(snapshot.weapon2).not.toBeNull();
    expect(snapshot.coopDefenseClassId).toBeNull();
    expect(snapshot.coopDefenseProfile).toBeNull();
  });

  it('applies Nukem damage, deterministic critical hits and movement speed', () => {
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('nukem', commit('dachs_nukem'));

    expect(system.resolveOutgoingDamage('nukem', 'enemy', 100, true, () => 0.5)).toEqual({
      amount: 150,
      isCritical: false,
    });
    expect(system.resolveOutgoingDamage('nukem', 'enemy', 100, true, () => 0.05)).toEqual({
      amount: 300,
      isCritical: true,
    });
    expect(system.getResolvedStat('nukem', 'player.runSpeed', 200)).toBe(240);
  });

  it('applies Steel durability and regeneration bonuses', () => {
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('steel', commit('dachs_of_steel'));

    expect(system.getMaxHp('steel')).toBe(200);
    expect(system.getHpRegenPerSecond('steel')).toBe(10);
    expect(system.getResolvedStat('steel', 'player.maxArmor', 100)).toBe(200);
  });

  it('uses the Inspector adrenaline baseline and class-specific upgrade tree', () => {
    const system = new CoopDefensePlayerModifierSystem();
    const profile = levelUpCoopDefenseUpgrade(
      buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs'),
      'inspector_repair_drone',
      20,
      0,
      'inspector_gadachs',
    )!;
    system.syncPlayer('inspector', commit('inspector_gadachs', profile));

    expect(system.getResolvedStat('inspector', 'player.adrenalineRegenRate', 5)).toBe(0.5);
    expect(system.getCommittedProfile('inspector')?.upgrades.inspector_repair_drone.level).toBe(1);
    const categories = getCoopDefenseUpgradeCategories('inspector_gadachs');
    const generalIds = categories.find(category => category.id === 'general')!.upgrades.map(upgrade => upgrade.id);
    const weapon2Ids = categories.find(category => category.id === 'weapon2')!.upgrades.map(upgrade => upgrade.id);
    expect(generalIds).not.toContain('run_speed');
    expect(generalIds).not.toContain('burrow_speed');
    expect(generalIds).not.toContain('burrow_cost');
    expect(weapon2Ids).toEqual([
      'unlock_rocket_turret',
      'unlock_machine_gun_turret',
      'unlock_flame_turret',
    ]);
  });
});

describe('Inspector construction slots', () => {
  it('starts with the rocket turret, separates unlocks from slots and validates slot refunds', () => {
    let profile: CoopDefenseUpgradeProfile = buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs');
    expect(getCoopDefenseConstructionSlotCapacity(profile)).toBe(3);
    expect(getUnlockedCoopDefenseConstructionIds(profile)).toEqual(['rocket_turret']);

    profile = levelUpCoopDefenseUpgrade(
      profile,
      'unlock_machine_gun_turret',
      20,
      0,
      'inspector_gadachs',
    )!;
    expect(getUnlockedCoopDefenseConstructionIds(profile)).toEqual([
      'rocket_turret',
      'machine_gun_turret',
    ]);
    expect(levelUpCoopDefenseUpgrade(
      profile,
      'unlock_flame_turret',
      20,
      0,
      'inspector_gadachs',
    )).not.toBeNull();

    profile = levelUpCoopDefenseUpgrade(
      profile,
      'inspector_construction_slots',
      20,
      0,
      'inspector_gadachs',
    )!;
    expect(getCoopDefenseConstructionSlotCapacity(profile)).toBe(4);
    expect(canLevelDownCoopDefenseUpgrade(
      profile,
      'inspector_construction_slots',
      'inspector_gadachs',
    )).toBe(true);
    expect(levelDownCoopDefenseUpgrade(
      profile,
      'inspector_construction_slots',
      'inspector_gadachs',
    )).not.toBeNull();
  });
});

describe('Inspector repair drone', () => {
  it('repairs only damaged owned constructions and returns to orbit afterwards', () => {
    const construction: SyncedPlaceableRock = {
      id: 7,
      kind: 'turret',
      constructionId: 'rocket_turret',
      gridX: 1,
      gridY: 0,
      hp: 50,
      maxHp: 100,
      ownerId: 'inspector',
      ownerColor: 0x55ff99,
      expiresAt: 0,
      warningStartsAt: 0,
      angle: 0,
    };
    const placement = {
      getOwnedConstructions: (ownerId: string) => ownerId === 'inspector' ? [construction] : [],
      getRuntimeRock: (id: number) => id === construction.id ? construction : undefined,
      getWorldPointForCell: () => ({ x: 48, y: 0 }),
      repairRock: (_id: number, amount: number) => {
        construction.hp = Math.min(construction.maxHp, construction.hp + amount);
        return construction;
      },
    };
    const system = new RepairDroneSystem(
      {
        getAllPlayers: () => [{
          id: 'inspector',
          color: 0x55ff99,
          sprite: { active: true, x: 0, y: 0 },
        }],
      } as never,
      { isAlive: () => true } as never,
      placement as never,
      () => true,
    );

    system.update(1000);
    expect(construction.hp).toBe(60);
    expect(system.getSnapshot()[0]).toMatchObject({
      ownerId: 'inspector',
      phase: 'repairing',
      targetConstructionId: 7,
    });

    construction.hp = construction.maxHp;
    system.update(100);
    expect(system.getSnapshot()[0].phase).toBe('orbiting');
    expect(system.getSnapshot()[0].targetConstructionId).toBeUndefined();
  });
});
