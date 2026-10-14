import { ULTIMATE_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUltimateConfig } from '../../src/loadout/CoopDefenseLoadoutModifiers';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS, getCoopDefenseResolvedEffectTotals } from '../../src/utils/coopDefenseUpgrades';

/** Upgrade only the ultimate under measurement; original turrets retain their neutral loadout. */
export function inspectorUltimate(id: 'HOLO_OFFENSIVE' | 'BOMBER_SQUADRON', full: boolean) {
  const prefix = id === 'HOLO_OFFENSIVE' ? 'holo_offensive' : 'bomber_squadron';
  const upgrades = Object.fromEntries(Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)
    .filter(d => d.id.includes(prefix))
    .map(d => [d.id, { unlocked: true, level: full ? d.maxLevel : (d.id.startsWith('unlock_') ? 1 : 0) }]));
  return applyCoopDefenseModifiersToUltimateConfig(ULTIMATE_CONFIGS[id],
    getCoopDefenseResolvedEffectTotals({ upgrades }, 'inspector_gadachs'));
}

export const HOLO_RAGE = 600;
export const INSPECTORS = ['inspector', 'p2', 'p3', 'p4'] as const;
