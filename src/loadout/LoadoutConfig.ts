/**
 * Öffentliche Loadout-Fassade.
 *
 * Rohdaten, Variantenauflösung und Validierung liegen unter `content/`; bestehende
 * Spielsysteme können ihre bisherigen Imports unverändert weiterverwenden.
 */
export * from './LoadoutTypes';
export {
  DEFAULT_LOADOUT,
  LOADOUT_CATALOG_ENTRIES,
  ULTIMATE_CONFIGS,
  UTILITY_CONFIGS,
  WEAPON_CONFIGS,
  findUltimateConfig,
  getUtilityBaseId,
  findUtilityConfig,
  findWeaponConfig,
  getAvailableUltimateConfigs,
  getUltimateConfig,
  getUtilityConfig,
  getUtilityConfigForMode,
  getUtilityConfigLineage,
  getWeaponConfig,
  isUltimateAllowedInMode,
  isWeaponAllowedInMode,
  sanitizeWeaponForMode,
  sanitizeUltimateForMode,
  resolveUtilityIdForMode,
} from './content/LoadoutRegistry';
export type {
  DefaultLoadoutConfig,
  UltimateRegistry,
  UtilityRegistry,
  WeaponRegistry,
} from './content/LoadoutContentLoader';
export type {
  UltimateConfig,
  UtilityConfig,
  WeaponConfig,
} from './content/LoadoutSchemas';
