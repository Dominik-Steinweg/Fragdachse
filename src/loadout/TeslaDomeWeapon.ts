import type { TeslaDomeWeaponFireConfig, WeaponConfig } from './LoadoutConfig';
import { BaseWeapon } from './BaseWeapon';

export class TeslaDomeWeapon extends BaseWeapon {
  constructor(config: WeaponConfig & { fire: TeslaDomeWeaponFireConfig }) {
    super(config);
  }

  get fireConfig(): TeslaDomeWeaponFireConfig {
    return this.config.fire as TeslaDomeWeaponFireConfig;
  }
}
