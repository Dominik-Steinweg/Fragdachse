import { describe, expect, it } from 'vitest';
import { areLoadoutConfigsEquivalent } from '../src/loadout/LoadoutRules';
import { resolveLoadoutSelectionIds } from '../src/loadout/LoadoutRules';
import { UTILITY_CONFIGS, WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';

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
  it('sanitizes Inspector support weapons when switching to PvP', () => {
    const snapshot = resolveLoadoutSelectionIds(
      { weapon2: WEAPON_CONFIGS.OVERCHARGE_CORE },
      'team_deathmatch',
    );

    expect(snapshot.weapon2).toBe('P90');
  });

  it('commits concrete inherited utility IDs per mode', () => {
    const coop = resolveLoadoutSelectionIds({ utility: UTILITY_CONFIGS.FELSBAU }, 'coop_defense');
    const normal = resolveLoadoutSelectionIds({ utility: UTILITY_CONFIGS.FELSBAU_COOP }, 'deathmatch');
    const coopTurret = resolveLoadoutSelectionIds({ utility: UTILITY_CONFIGS.FLIEGENPILZ }, 'coop_defense');

    expect(coop.utility).toBe('FELSBAU_COOP');
    expect(normal.utility).toBe('FELSBAU');
    expect(coopTurret.utility).toBe('FLIEGENPILZ_COOP');
  });
});
