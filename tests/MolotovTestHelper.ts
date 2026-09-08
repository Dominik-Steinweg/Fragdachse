import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals } from '../src/utils/coopDefenseUpgrades';

export const molotovLevels = {
  unlock_molotov_grenade: 1, molotov_grenade_radius: 1, molotov_grenade_duration: 1,
  molotov_burn_damage: 1, molotov_burn_duration: 1, molotov_wildfire: 1,
  molotov_wildfire_chunks: 3, molotov_firewalker: 3,
};

export function resolvedMolotov(levels: Record<string, number> = molotovLevels) {
  const profile = { upgrades: Object.fromEntries(Object.entries(levels)
    .map(([id, level]) => [id, { unlocked: level > 0, level }])) };
  const config = applyCoopDefenseModifiersToUtilityConfig(UTILITY_CONFIGS.MOLOTOV_GRENADE,
    getCoopDefenseResolvedEffectTotals(profile, 'dachs_nukem'));
  if (config.type !== 'molotov') throw Error('Expected Molotov');
  return config;
}
