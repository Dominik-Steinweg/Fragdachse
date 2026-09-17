import { DEFAULT_LOADOUT, WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../../loadout/LoadoutConfig';
import { resolveEffectiveLoadoutSelection, resolveLoadoutSelectionIds } from '../../loadout/LoadoutRules';
import { sanitizeCoopDefenseUpgradeProfile, COOP_DEFENSE_UPGRADE_DEFINITIONS } from '../../utils/coopDefenseUpgrades';
import type { LoadoutToolRef } from '../../types';
import presets from './build-presets.json';

export type PresetItem = keyof typeof presets;
export { presets };

export function buildPerformanceLoadout(itemId: PresetItem, construction = false) {
  const preset = presets[itemId];
  const requested: Record<string, number> = { ...preset.upgrades,
    ...(construction ? { unlock_rocket_turret: 1, unlock_rock_barrier: 1 } : {}) };
  const tools: LoadoutToolRef[] = construction
    ? [{ kind: 'construction', id: 'rocket_turret' }, { kind: 'construction', id: 'rock_barrier' }]
    : preset.slot === 'utility' ? [{ kind: 'utility', id: itemId }] : [];
  const classId = construction ? 'inspector_gadachs' as const : null;
  const profile = sanitizeCoopDefenseUpgradeProfile({ upgrades: Object.fromEntries(Object.entries(requested)
    .map(([id, level]) => [id, { unlocked: true, level }])), toolLoadout: tools }, classId ?? undefined);
  for (const [id, level] of Object.entries(requested)) {
    if (!COOP_DEFENSE_UPGRADE_DEFINITIONS[id] || profile.upgrades[id]?.level !== level) throw new Error(`Illegal frozen upgrade ${id}:${level}`);
  }
  const selection = { ...DEFAULT_LOADOUT,
    ...(preset.slot === 'weapon1' ? { weapon1: WEAPON_CONFIGS[itemId] } : {}),
    ...(preset.slot === 'weapon2' ? { weapon2: WEAPON_CONFIGS[itemId] } : {}),
    ...(preset.slot === 'utility' ? { utility: UTILITY_CONFIGS[itemId] } : {}),
    ...(preset.slot === 'ultimate' ? { ultimate: ULTIMATE_CONFIGS[itemId] } : {}) };
  const commit = resolveLoadoutSelectionIds(selection, 'coop_defense', profile, classId);
  if (commit[preset.slot as 'weapon1' | 'weapon2' | 'utility' | 'ultimate'] !== itemId) throw new Error(`Unreachable lab loadout ${itemId}`);
  commit.equippedItems = [];
  return { commit, effective: resolveEffectiveLoadoutSelection(selection, 'coop_defense', profile, classId),
    buildSignature: Object.entries(requested).sort(([a], [b]) => a.localeCompare(b)).map(([id, n]) => `${id}:${n}`).join('|') };
}
