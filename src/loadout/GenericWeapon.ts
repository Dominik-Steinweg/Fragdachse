import type { WeaponConfig } from './LoadoutConfig';
import { BaseWeapon } from './BaseWeapon';

/**
 * Generische Waffen-Klasse für rein config-getriebene Waffen.
 * Kein eigener Logik-Code nötig – Config aus LoadoutConfig übergeben.
 *
 * @example
 *   new GenericWeapon(WEAPON_CONFIGS.TEST_WEAPON_1)
 */
export class GenericWeapon extends BaseWeapon {
  constructor(config: WeaponConfig) { super(config); }
}
