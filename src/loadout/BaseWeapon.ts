import type { WeaponConfig } from './LoadoutConfig';
import { BaseLoadoutItem } from './BaseLoadoutItem';

/** Basisklasse für Projektilwaffen. Konkrete Waffen erweitern diese Klasse. */
export abstract class BaseWeapon extends BaseLoadoutItem<WeaponConfig> {
  constructor(config: WeaponConfig) { super(config); }
}
