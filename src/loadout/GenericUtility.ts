import type { UtilityConfig } from './LoadoutConfig';
import { BaseUtility } from './BaseUtility';

/**
 * Generische Utility-Klasse für rein config-getriebene Utility-Items.
 * Kein eigener Logik-Code nötig – Config aus LoadoutConfig übergeben.
 *
 * @example
 *   new GenericUtility(UTILITY_CONFIGS.HE_GRENADE)
 */
export class GenericUtility extends BaseUtility {
  constructor(config: UtilityConfig) { super(config); }
}
