import { describe, expect, it } from 'vitest';
import { areLoadoutConfigsEquivalent } from '../src/loadout/LoadoutRules';
import { resolveLoadoutSelectionIds, sanitizeCommittedLoadoutForMode } from '../src/loadout/LoadoutRules';
import { DEFAULT_LOADOUT, resolveUtilityIdForMode, UTILITY_CONFIGS, WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';

describe('loadout config semantic equality', () => {
  it('ignores object-key order while preserving array order', () => {
    const left = { id: 'TEST', nested: { alpha: 1, beta: 2 }, values: [1, 2] };
    const reordered = { values: [1, 2], nested: { beta: 2, alpha: 1 }, id: 'TEST' };
    const changedArray = { values: [2, 1], nested: { beta: 2, alpha: 1 }, id: 'TEST' };
    expect(areLoadoutConfigsEquivalent(left, reordered)).toBe(true);
    expect(areLoadoutConfigsEquivalent(left, changedArray)).toBe(false);
  });
});

describe('mode-specific weapon availability', () => {
  it.each(['constructor', 'toString', '__proto__'])('sanitizes inherited registry keys in committed loadouts: %s', (id) => {
    const snapshot = sanitizeCommittedLoadoutForMode({
      weapon1: id, weapon2: id, utility: id, ultimate: id,
      coopDefenseClassId: null, coopDefenseProfile: null,
    }, 'deathmatch');
    expect(snapshot).toMatchObject({
      weapon1: DEFAULT_LOADOUT.weapon1.id,
      weapon2: DEFAULT_LOADOUT.weapon2.id,
      utility: DEFAULT_LOADOUT.utility.id,
      ultimate: DEFAULT_LOADOUT.ultimate.id,
    });
    expect(resolveUtilityIdForMode(id, 'deathmatch')).toBeUndefined();
  });

  it('sanitizes Inspector support weapons when switching to PvP', () => {
    const snapshot = resolveLoadoutSelectionIds(
      { weapon2: WEAPON_CONFIGS.OVERCHARGE_CORE },
      'team_deathmatch',
    );

    expect(snapshot.weapon2).toBe('P90');
  });

  it('commits concrete inherited utility IDs per mode', () => {
    const coop = resolveLoadoutSelectionIds({ utility: UTILITY_CONFIGS.ROCK_BARRIER }, 'coop_defense');
    const normal = resolveLoadoutSelectionIds({ utility: UTILITY_CONFIGS.ROCK_BARRIER }, 'deathmatch');
    const coopTurret = resolveLoadoutSelectionIds({ utility: UTILITY_CONFIGS.SPORE_TURRET }, 'coop_defense');

    expect(coop.utility).toBe('ROCK_BARRIER');
    expect(normal.utility).toBe('ROCK_BARRIER');
    expect(coopTurret.utility).toBe('SPORE_TURRET');
  });
});
