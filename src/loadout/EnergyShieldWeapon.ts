import type { EnergyShieldWeaponFireConfig, WeaponConfig } from './LoadoutConfig';
import { BaseWeapon } from './BaseWeapon';

export class EnergyShieldWeapon extends BaseWeapon {
  constructor(config: WeaponConfig & { fire: EnergyShieldWeaponFireConfig }) {
    super(config);
  }

  get fireConfig(): EnergyShieldWeaponFireConfig {
    return this.config.fire as EnergyShieldWeaponFireConfig;
  }
}