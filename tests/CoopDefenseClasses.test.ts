import { fakeEntity } from './fakeEntity';
import { describe, expect, it } from 'vitest';
import { CoopDefensePlayerModifierSystem } from '../src/systems/CoopDefensePlayerModifierSystem';
import { COOP_DEFENSE_CLASS_DEFINITIONS, getCoopDefenseClassDefinition } from '../src/config/coopDefenseClasses';
import { HP_MAX } from '../src/config';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  canLevelDownCoopDefenseUpgrade,
  getCoopDefenseConstructionSlotCapacity,
  getCoopDefenseUpgradeCategories,
  getCoopDefenseUpgradeDefinition,
  getUnlockedCoopDefenseConstructionIds,
  levelDownCoopDefenseUpgrade,
  levelUpCoopDefenseUpgrade,
} from '../src/utils/coopDefenseUpgrades';
import type { CoopDefenseClassId, CoopDefenseUpgradeProfile, LoadoutCommitSnapshot } from '../src/types';
import { isCoopDefenseReadyLoadoutComplete, resolveLoadoutSelectionIds } from '../src/loadout/LoadoutRules';
import { RepairDroneSystem } from '../src/systems/RepairDroneSystem';
import type { SyncedPlaceableRock } from '../src/types';
import {
  COOP_DEFENSE_REPAIR_DRONE_CONFIG,
} from '../src/config/coopDefenseConstructions';
import { getClassTooltipLines } from '../src/i18n/contentPresentation';

function commit(
  classId: CoopDefenseClassId,
  profile = buildDefaultCoopDefenseUpgradeProfile(classId),
): LoadoutCommitSnapshot {
  return {
    weapon1: 'GLOCK',
    weapon2: classId === 'inspector_gadachs' ? 'PLASMA_BURNER' : 'P90',
    utility: 'FELSEN',
    ultimate: 'GAUSS',
    coopDefenseClassId: classId,
    coopDefenseProfile: profile,
  };
}

describe('coop-defense classes', () => {
  it('keeps German class tooltip text readable', () => {
    expect(getClassTooltipLines('dachs_of_steel', 'de')).toContain(
      'Stärke: hält Gegnerwellen direkt an der Basis auf.',
    );
  });

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

  it('keeps default-class upgrades active without granting a specialization bonus', () => {
    const profile = levelUpCoopDefenseUpgrade(
      buildDefaultCoopDefenseUpgradeProfile(),
      'hp',
      20,
      0,
      'dachs_nukem',
    )!;
    const snapshot = resolveLoadoutSelectionIds(undefined, 'coop_defense', profile, null);
    expect(snapshot.coopDefenseClassId).toBeNull();
    expect(isCoopDefenseReadyLoadoutComplete(snapshot)).toBe(true);

    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('default', snapshot);
    expect(system.getClassId('default')).toBeNull();
    expect(system.getMaxHp('default')).toBeGreaterThan(HP_MAX);
    expect(system.resolveOutgoingDamage('default', 'enemy', 100, true, () => 0)).toEqual({
      amount: 100,
      isCritical: false,
    });
  });

  it('commits the Inspector weapon instead of falling back to the P90', () => {
    const snapshot = resolveLoadoutSelectionIds(
      undefined,
      'coop_defense',
      buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs'),
      'inspector_gadachs',
    );

    expect(snapshot.weapon2).toBe('PLASMA_BURNER');
    expect(isCoopDefenseReadyLoadoutComplete(snapshot)).toBe(true);
    expect(isCoopDefenseReadyLoadoutComplete({ ...snapshot, weapon2: 'P90' })).toBe(false);
    expect(isCoopDefenseReadyLoadoutComplete({ ...snapshot, weapon2: null })).toBe(false);
  });

  it('applies Nukem damage, deterministic critical hits and movement speed', () => {
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('nukem', commit('dachs_nukem'));

    const nukem = getCoopDefenseClassDefinition('dachs_nukem');
    expect(system.resolveOutgoingDamage('nukem', 'enemy', 100, true, () => 0.5)).toEqual({
      amount: 100 * nukem.outgoingDamageMultiplier,
      isCritical: false,
    });
    expect(system.resolveOutgoingDamage('nukem', 'enemy', 100, true, () => 0.05)).toEqual({
      amount: 100 * nukem.outgoingDamageMultiplier * nukem.criticalDamageMultiplier,
      isCritical: true,
    });
    expect(system.getResolvedStat('nukem', 'player.runSpeed', 200))
      .toBeCloseTo(200 * nukem.runSpeedMultiplier);
  });

  it('applies Steel durability and regeneration bonuses', () => {
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('steel', commit('dachs_of_steel'));

    const steel = getCoopDefenseClassDefinition('dachs_of_steel');
    expect(system.getMaxHp('steel')).toBeCloseTo(HP_MAX * steel.maxHpMultiplier);
    expect(system.getHpRegenPerSecond('steel')).toBe(steel.hpRegenBonusPerSecond);
    expect(system.getResolvedStat('steel', 'player.maxArmor', 100))
      .toBeCloseTo(100 * steel.maxArmorMultiplier);
  });

  it('uses the standard adrenaline baseline and the class-specific upgrade tree', () => {
    const system = new CoopDefensePlayerModifierSystem();
    const profile = levelUpCoopDefenseUpgrade(
      buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs'),
      'inspector_repair_drone',
      20,
      0,
      'inspector_gadachs',
    )!;
    system.syncPlayer('inspector', commit('inspector_gadachs', profile));

    // Der Inspector gewinnt Adrenalin wie jede andere Klasse; begrenzend ist die Baukapazitaet.
    expect(system.getResolvedStat('inspector', 'player.adrenalineRegenRate', 5)).toBe(5);
    expect(system.getCommittedProfile('inspector')?.upgrades.inspector_repair_drone.level).toBe(1);
    const categories = getCoopDefenseUpgradeCategories('inspector_gadachs');
    const generalIds = categories.find(category => category.id === 'general')!.upgrades.map(upgrade => upgrade.id);
    const weapon2Ids = categories.find(category => category.id === 'weapon2')!.upgrades.map(upgrade => upgrade.id);
    const constructionIds = categories.find(category => category.id === 'construction')!.upgrades.map(upgrade => upgrade.id);
    expect(generalIds).not.toContain('run_speed');
    expect(generalIds).not.toContain('burrow_speed');
    expect(generalIds).not.toContain('burrow_cost');
    // Waffe 2 traegt nur noch die Adrenalinfaehigkeiten, die Konstrukte stehen in ihrer
    // eigenen Kategorie.
    expect(weapon2Ids).toEqual([
      'unlock_plasma_burner',
      'unlock_overcharge_core',
      'overcharge_radius',
      'overcharge_duration',
      'overcharge_power',
      'overcharge_cost',
      'unlock_energy_injector',
    ]);
    expect(constructionIds).toContain('unlock_rocket_turret');
    expect(constructionIds).toContain('unlock_rock_barrier');
    expect(constructionIds).toContain('unlock_spore_turret');
    expect(constructionIds).toContain('unlock_tesla_turret');
  });

  it('keeps constructions and the reinforcement matrix out of the other classes', () => {
    for (const classId of ['dachs_nukem', 'dachs_of_steel'] as const) {
      const categories = getCoopDefenseUpgradeCategories(classId);
      expect(categories.find(category => category.id === 'construction')).toBeUndefined();
      const weapon2Ids = categories.find(category => category.id === 'weapon2')!.upgrades.map(upgrade => upgrade.id);
      expect(weapon2Ids).not.toContain('unlock_overcharge_core');
      expect(weapon2Ids).not.toContain('unlock_plasma_burner');
      expect(weapon2Ids).not.toContain('unlock_energy_injector');
      expect(weapon2Ids).toContain('unlock_p90');
    }
  });
});

describe('Inspector construction slots', () => {
  it('starts with the rocket turret, separates unlocks from slots and validates slot refunds', () => {
    let profile: CoopDefenseUpgradeProfile = buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs');
    const initialCapacity = getCoopDefenseConstructionSlotCapacity(profile);
    expect(initialCapacity).toBeGreaterThan(0);
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
      'unlock_tesla_turret',
      20,
      0,
      'inspector_gadachs',
    )!;
    expect(getUnlockedCoopDefenseConstructionIds(profile)).toEqual([
      'rocket_turret',
      'machine_gun_turret',
      'tesla_turret',
    ]);

    profile = levelUpCoopDefenseUpgrade(
      profile,
      'inspector_construction_slots',
      20,
      0,
      'inspector_gadachs',
    )!;
    const slotUpgrade = getCoopDefenseUpgradeDefinition('inspector_construction_slots')!;
    const slotEffect = slotUpgrade.effects.find((effect) => effect.stat === 'construction.slots');
    expect(getCoopDefenseConstructionSlotCapacity(profile)).toBe(
      initialCapacity + (slotEffect?.value ?? 0),
    );
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
        getAllPlayers: () => [fakeEntity({ id: 'inspector',
          color: 0x55ff99, active: true, x: 0, y: 0 })],
      } as never,
      { isAlive: () => true } as never,
      placement as never,
      () => true,
    );

    system.update(1000);
    expect(construction.hp).toBe(50 + COOP_DEFENSE_REPAIR_DRONE_CONFIG.repairPerSecond);
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
