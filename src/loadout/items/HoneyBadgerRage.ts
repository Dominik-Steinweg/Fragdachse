import { BaseUltimate } from '../BaseUltimate';
import { ULTIMATE_CONFIGS } from '../LoadoutConfig';

/**
 * HoneyBadger Rage – Ultimate.
 * Aktivierbar nur bei 300 Rage (RAGE_MAX).
 * Effekte für 5s: Spieler leuchtet rot, +30% Geschwindigkeit, ×2 Schaden.
 * Rage sinkt über 5s auf 0.
 */
export class HoneyBadgerRage extends BaseUltimate {
  readonly config = ULTIMATE_CONFIGS.HONEY_BADGER_RAGE;
}
