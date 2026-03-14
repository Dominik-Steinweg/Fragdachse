import { BaseWeapon } from '../BaseWeapon';
import { WEAPON_CONFIGS } from '../LoadoutConfig';

/** Sekundärwaffe: geringerer Schaden, 100ms Cooldown, kleinere Projektile. */
export class TestWeapon2 extends BaseWeapon {
  readonly config = WEAPON_CONFIGS.TEST_WEAPON_2;
}
