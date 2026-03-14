import type { WeaponConfig } from './LoadoutConfig';
import { BaseLoadoutItem } from './BaseLoadoutItem';

/** Basisklasse für Projektilwaffen. Konkrete Waffen setzen nur config. */
export abstract class BaseWeapon extends BaseLoadoutItem<WeaponConfig> {}
