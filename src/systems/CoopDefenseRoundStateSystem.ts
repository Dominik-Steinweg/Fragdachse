import type { CoopDefenseMapObjective } from '../config/coopDefenseMaps';
import type { BaseManager } from '../entities/BaseManager';
import type { RoundOutcome } from '../network/NetworkBridge';

export interface CoopDefenseRoundStateSystemOptions {
  readonly baseManager: BaseManager;
  /** Standard `survive`: Sieg ueber das Zeitlimit. */
  readonly objective?: CoopDefenseMapObjective;
  readonly getSecondsLeft: () => number;
  readonly isBossDefeated?: () => boolean;
}

/**
 * Entscheidet host-autoritativ ueber Sieg und Niederlage einer Coop-Defense-Runde.
 *
 * Verloren wird immer ueber die eigenen Basen. Gewonnen wird je nach Map ueber das Zeitlimit
 * (`survive`), den Boss (`defeat-boss`) oder die Zerstoerung aller feindlichen Basen
 * (`destroy-hostile-bases`).
 */
export class CoopDefenseRoundStateSystem {
  private concluded = false;
  private readonly baseManager: BaseManager;
  private readonly objective: CoopDefenseMapObjective;
  private readonly getSecondsLeft: () => number;
  private readonly isBossDefeated: () => boolean;

  constructor(options: CoopDefenseRoundStateSystemOptions) {
    this.baseManager = options.baseManager;
    this.objective = options.objective ?? 'survive';
    this.getSecondsLeft = options.getSecondsLeft;
    this.isBossDefeated = options.isBossDefeated ?? (() => false);
  }

  update(): RoundOutcome | null {
    if (this.concluded) return null;

    // Nur eigene Basen zaehlen: sonst waere mit gefallener Gegnerbasis auch die Niederlage
    // ausgeloest oder – schlimmer – gar nicht mehr moeglich.
    if (this.baseManager.getTotalHp('friendly') <= 0) {
      this.concluded = true;
      return 'defeat';
    }

    if (this.objective === 'defeat-boss') {
      if (this.isBossDefeated()) {
        this.concluded = true;
        return 'victory';
      }
      return null;
    }

    if (this.objective === 'destroy-hostile-bases') {
      // Der Guard schuetzt gegen einen Sofortsieg, falls eine Map ohne feindliche Basis das
      // Ziel doch einmal an der Normalisierung vorbei setzt.
      if (this.baseManager.hasFaction('hostile') && this.baseManager.getTotalHp('hostile') <= 0) {
        this.concluded = true;
        return 'victory';
      }
      return null;
    }

    if (this.getSecondsLeft() <= 0) {
      this.concluded = true;
      return 'victory';
    }

    return null;
  }

  applyDebugBaseDamage(amount: number): void {
    if (amount <= 0 || this.concluded) return;

    const targetBase = this.baseManager
      .getBasesByFaction('friendly')
      .find((base) => base.getHp() > 0);
    if (!targetBase) return;

    this.baseManager.applyDamage(targetBase.id, amount);
  }
}
