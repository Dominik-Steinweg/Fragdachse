import type { GameMode } from '../../types';
import {
  buildLoadoutRegistries,
  isUltimateAllowedInMode,
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

export function findUltimateConfig(id: string | null | undefined): UltimateConfig | undefined {
  return id ? ULTIMATE_CONFIGS[id] : undefined;
}

export function getUltimateConfig(id: string): UltimateConfig {
  const config = findUltimateConfig(id);
  if (!config) throw new Error(`[loadout-content] Unbekannte Ultimate-ID: ${id}`);
  return config;
}

export { isUltimateAllowedInMode };

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
