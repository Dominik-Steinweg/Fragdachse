import type { GameMode } from '../../types';
import {
  buildLoadoutRegistries,
  isUltimateAllowedInMode,
  isWeaponAllowedInMode,
  type RegistryLineage,
  type UltimateRegistry,
  type UtilityRegistry,
  type WeaponRegistry,
} from './LoadoutContentLoader';
import type { UltimateConfig, UtilityConfig, WeaponConfig } from './LoadoutSchemas';
import { getViteLoadoutContentSources } from './ViteContentSource';

const built = buildLoadoutRegistries(getViteLoadoutContentSources());

export const WEAPON_CONFIGS: WeaponRegistry = built.weapons;
export const UTILITY_CONFIGS: UtilityRegistry = built.utilities;
export const ULTIMATE_CONFIGS: UltimateRegistry = built.ultimates;
export const DEFAULT_LOADOUT = built.defaultLoadout;
export const LOADOUT_CATALOG_ENTRIES = built.catalog;
export const UTILITY_CONFIG_LINEAGES: RegistryLineage = built.lineages.utility;

const LEGACY_COOP_UTILITY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ROCK_BARRIER_COOP: 'ROCK_BARRIER',
  SPORE_TURRET_COOP: 'SPORE_TURRET',
});

export function findWeaponConfig(id: string | null | undefined): WeaponConfig | undefined {
  return id ? WEAPON_CONFIGS[id] : undefined;
}

export function getWeaponConfig(id: string): WeaponConfig {
  const config = findWeaponConfig(id);
  if (!config) throw new Error(`[loadout-content] Unbekannte Waffen-ID: ${id}`);
  return config;
}

export function findUtilityConfig(id: string | null | undefined): UtilityConfig | undefined {
  return id ? UTILITY_CONFIGS[id] : undefined;
}

export function getUtilityConfig(id: string): UtilityConfig {
  const config = findUtilityConfig(id);
  if (!config) throw new Error(`[loadout-content] Unbekannte Utility-ID: ${id}`);
  return config;
}

export function getUtilityConfigLineage(id: string): readonly string[] {
  return UTILITY_CONFIG_LINEAGES[id] ?? [];
}

export function getUtilityBaseId(id: string): string | undefined {
  const legacyBaseId = LEGACY_COOP_UTILITY_ALIASES[id];
  if (legacyBaseId) return legacyBaseId;
  const lineage = getUtilityConfigLineage(id);
  return lineage.length > 0 ? lineage[lineage.length - 1] : undefined;
}

export function resolveUtilityIdForMode(id: string, mode: GameMode): string | undefined {
  const baseId = getUtilityBaseId(id) ?? id;
  if (!UTILITY_CONFIGS[baseId]) return undefined;
  // The normal placeables are permanent constructions in every mode. There is no Coop-only
  // lifetime/config variant; legacy IDs have already been normalized above.
  return baseId;
}

export function getUtilityConfigForMode(
  configOrId: UtilityConfig | string | null | undefined,
  mode: GameMode,
): UtilityConfig | undefined {
  const id = typeof configOrId === 'string' ? configOrId : configOrId?.id;
  const resolvedId = id ? resolveUtilityIdForMode(id, mode) : undefined;
  return resolvedId ? UTILITY_CONFIGS[resolvedId] : undefined;
}

export function findUltimateConfig(id: string | null | undefined): UltimateConfig | undefined {
  return id ? ULTIMATE_CONFIGS[id] : undefined;
}

export function getUltimateConfig(id: string): UltimateConfig {
  const config = findUltimateConfig(id);
  if (!config) throw new Error(`[loadout-content] Unbekannte Ultimate-ID: ${id}`);
  return config;
}

export { isUltimateAllowedInMode, isWeaponAllowedInMode };

export function sanitizeWeaponForMode(
  config: WeaponConfig | undefined,
  slot: 'weapon1' | 'weapon2',
  mode: GameMode,
): WeaponConfig {
  if (config && config.allowedSlots.includes(slot) && isWeaponAllowedInMode(config, mode)) return config;
  return DEFAULT_LOADOUT[slot];
}

export function sanitizeUltimateForMode(config: UltimateConfig | undefined, mode: GameMode): UltimateConfig {
  if (config && isUltimateAllowedInMode(config, mode)) return config;
  return isUltimateAllowedInMode(DEFAULT_LOADOUT.ultimate, mode)
    ? DEFAULT_LOADOUT.ultimate
    : getUltimateConfig('ARMAGEDDON');
}

export function getAvailableUltimateConfigs(mode: GameMode): UltimateConfig[] {
  return LOADOUT_CATALOG_ENTRIES
    .filter((entry) => entry.kind === 'ultimate' && entry.slot === 'ultimate')
    .map((entry) => getUltimateConfig(entry.id))
    .filter((config) => config.catalogVisible !== false)
    .filter((config) => isUltimateAllowedInMode(config, mode));
}
