import { BaseWeapon } from '../BaseWeapon';
import { WEAPON_CONFIGS } from '../LoadoutConfig';

/** Primärwaffe: mittlerer Schaden, 200ms Cooldown. */
export class TestWeapon1 extends BaseWeapon {
  readonly config = WEAPON_CONFIGS.TEST_WEAPON_1;
}
