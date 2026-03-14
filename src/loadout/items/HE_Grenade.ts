import { BaseUtility } from '../BaseUtility';
import { UTILITY_CONFIGS } from '../LoadoutConfig';

/**
 * HE-Granate: Langsames Projektil in Mausrichtung.
 * Explodiert nach 1500ms mit AoE-Schaden (120px Radius, 60 Schaden).
 * 6000ms Cooldown.
 */
export class HE_Grenade extends BaseUtility {
  readonly config = UTILITY_CONFIGS.HE_GRENADE;
}
