import type { UltimateConfig } from './LoadoutConfig';
import { BaseUltimate } from './BaseUltimate';

/**
 * Generische Ultimate-Klasse für rein config-getriebene Ultimates.
 * Kein eigener Logik-Code nötig – Config aus LoadoutConfig übergeben.
 *
 * @example
 *   new GenericUltimate(ULTIMATE_CONFIGS.HONEY_BADGER_RAGE)
 */
export class GenericUltimate extends BaseUltimate {
  constructor(config: UltimateConfig) { super(config); }
}
