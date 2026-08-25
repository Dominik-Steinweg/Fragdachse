import { describe, expect, it } from 'vitest';
import {
  getPlaceableCapacityCost,
  getToolCapacityCost,
  normalizeConstructionId,
  resolveConstructionCapacity,
} from '../src/config/coopDefenseConstructions';
import type { CoopDefenseUpgradeProfile, LoadoutCommitSnapshot } from '../src/types';
import {
  getConstructionAccessContext,
  getActiveConstructionToolRefs,
  resolveConstructionAccess,
} from '../src/systems/ConstructionAccessResolver';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  getCoopDefenseUpgradeDefinitionsForCategory,
  isCoopDefenseLoadoutItemSelectable,
  levelUpCoopDefenseUpgrade,
} from '../src/utils/coopDefenseUpgrades';

function profile(unlocked: string, tools: LoadoutCommitSnapshot['tools']): CoopDefenseUpgradeProfile {
  return {
    upgrades: {
      [unlocked]: { unlocked: true, level: 1 },
    },
    toolLoadout: tools ? [...tools] : [],
  };
}

function committed(
  classId: LoadoutCommitSnapshot['coopDefenseClassId'],
  utility: string,
  coopProfile: CoopDefenseUpgradeProfile,
  tools?: LoadoutCommitSnapshot['tools'],
): LoadoutCommitSnapshot {
  return {
    weapon1: 'GLOCK',
    weapon2: 'P90',
    utility,
    ultimate: 'ARMAGEDDON',
    coopDefenseClassId: classId,
    coopDefenseProfile: coopProfile,
    tools,
  };
}

describe('phase-2 construction identity and access', () => {
  it('normalizes historical aliases only at the boundary', () => {
    expect(normalizeConstructionId('ROCK_BARRIER')).toBe('rock_barrier');
    expect(normalizeConstructionId('ROCK_BARRIER_COOP')).toBe('rock_barrier');
    expect(normalizeConstructionId('SPORE_TURRET_COOP')).toBe('spore_turret');
    expect(getToolCapacityCost({ kind: 'utility', id: 'ROCK_BARRIER_COOP' })).toBe(1);
    expect(getPlaceableCapacityCost({ kind: 'rock' })).toBe(0);
    expect(getPlaceableCapacityCost({ kind: 'rock', constructionId: 'rock_barrier' })).toBe(1);
    expect(getPlaceableCapacityCost({
      kind: 'rock',
      constructionId: 'rock_barrier',
      ownership: 'base-owned',
    })).toBe(0);
  });

  it('uses configured mode/class capacity without team-size leakage', () => {
    expect(resolveConstructionCapacity({ gameMode: 'coop_defense', classId: 'dachs_nukem' })).toBe(30);
    expect(resolveConstructionCapacity({ gameMode: 'coop_defense', classId: 'dachs_of_steel', modifiers: 7 })).toBe(37);
    expect(resolveConstructionCapacity({ gameMode: 'coop_defense', classId: 'inspector_gadachs' })).toBe(100);
    expect(resolveConstructionCapacity({ gameMode: 'deathmatch', classId: null, modifiers: 4 })).toBe(104);
  });

  it('separates unlocked, active loadout and class eligibility', () => {
    const rockProfile = profile('unlock_rock_barrier', [{ kind: 'construction', id: 'rock_barrier' }]);
    const rockCommitted = committed('dachs_nukem', 'ROCK_BARRIER', rockProfile, rockProfile.toolLoadout);
    const rockAccess = resolveConstructionAccess(
      'rock_barrier',
      getConstructionAccessContext('coop_defense', rockCommitted),
    );
    expect(rockAccess).toMatchObject({ allowed: true, unlocked: true, active: true });
    expect(getActiveConstructionToolRefs(getConstructionAccessContext('coop_defense', rockCommitted)))
      .toEqual([{ kind: 'construction', id: 'rock_barrier' }]);

    const dormant = resolveConstructionAccess(
      'spore_turret',
      getConstructionAccessContext('coop_defense', rockCommitted),
    );
    expect(dormant.reason).toBe('locked');

    const inspectorProfile = profile('unlock_rocket_turret', [{ kind: 'construction', id: 'rocket_turret' }]);
    const inspector = resolveConstructionAccess(
      'rocket_turret',
      getConstructionAccessContext(
        'coop_defense',
        committed('inspector_gadachs', 'HE_GRENADE', inspectorProfile, inspectorProfile.toolLoadout),
      ),
    );
    expect(inspector.allowed).toBe(true);
    const unselected = resolveConstructionAccess(
      'rocket_turret',
      getConstructionAccessContext(
        'coop_defense',
        committed('inspector_gadachs', 'HE_GRENADE', inspectorProfile, []),
      ),
    );
    expect(unselected.reason).toBe('not-in-loadout');
  });

  it('keeps shared construction unlocks in the normal class utility path', () => {
    for (const classId of ['dachs_nukem', 'dachs_of_steel'] as const) {
      const utilityDefinitions = getCoopDefenseUpgradeDefinitionsForCategory('utility', classId);
      expect(utilityDefinitions.map((definition) => definition.id)).toEqual(expect.arrayContaining([
        'unlock_rock_barrier',
        'unlock_spore_turret',
      ]));

      let coopProfile = buildDefaultCoopDefenseUpgradeProfile(classId);
      coopProfile = levelUpCoopDefenseUpgrade(coopProfile, 'unlock_rock_barrier', 100, 0, classId) ?? coopProfile;
      expect(isCoopDefenseLoadoutItemSelectable(coopProfile, 'utility', 'ROCK_BARRIER', classId)).toBe(true);
      expect(isCoopDefenseLoadoutItemSelectable(coopProfile, 'utility', 'ROCK_BARRIER_COOP', classId)).toBe(true);
    }
  });
});
