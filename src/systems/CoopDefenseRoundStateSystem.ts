import type { CoopDefenseMapObjective } from '../config/coopDefenseMaps';
import type { BaseManager } from '../entities/BaseManager';
import type { RoundOutcome } from '../network/NetworkBridge';

export interface CoopDefenseRoundStateSystemOptions {
  readonly baseManager: BaseManager;
  /** Explizites Map-Ziel; es gibt keinen impliziten Survival-Fallback. */
  readonly objective: CoopDefenseMapObjective;
  readonly getSecondsLeft: () => number;
  readonly isBossDefeated?: () => boolean;
  /** `repel-assault`: wird vom host-only MapDirector gesetzt, loest aber selbst keinen Sieg aus. */
  readonly isAssaultRepelled?: () => boolean;
  /** `survive`: true, sobald kein relevanter Teilnehmer mehr kaempfen oder respawnen kann. */
  readonly isSurvivalTeamWiped?: () => boolean;
  /** `advance`: host-autoritatives `isRouteComplete()` des Missionsfortschritts. */
  readonly isAdvanceComplete?: () => boolean;
  /** `advance`: true, sobald kein relevanter Teilnehmer mehr lebt oder regulaer zurueckkehren kann. */
  readonly isAdvanceTeamDefeated?: () => boolean;
}

/**
 * Entscheidet host-autoritativ ueber Sieg und Niederlage einer Coop-Defense-Runde.
 *
 * Verloren wird bei Survival und Vorstoss ausschliesslich ueber einen endgueltigen Spielerwipe,
 * sonst ueber die eigenen Basen. Gewonnen wird je nach Map ueber das vollstaendige
 * Abwehren des Assaults (`repel-assault`), das Zeitlimit (`survive`), den Boss (`defeat-boss`),
 * die Zerstoerung aller feindlichen Basen (`destroy-hostile-bases`) oder die vollstaendig
 * durchquerte Route bis zur Extraktion (`advance`).
 */
export class CoopDefenseRoundStateSystem {
  private concluded = false;
  private readonly baseManager: BaseManager;
  private readonly objective: CoopDefenseMapObjective;
  private readonly getSecondsLeft: () => number;
  private readonly isBossDefeated: () => boolean;
  private readonly isAssaultRepelled: () => boolean;
  private readonly isSurvivalTeamWiped: () => boolean;
  private readonly isAdvanceComplete: () => boolean;
  private readonly isAdvanceTeamDefeated: () => boolean;

  constructor(options: CoopDefenseRoundStateSystemOptions) {
    this.baseManager = options.baseManager;
    this.objective = options.objective;
    this.getSecondsLeft = options.getSecondsLeft;
    this.isBossDefeated = options.isBossDefeated ?? (() => false);
    this.isAssaultRepelled = options.isAssaultRepelled ?? (() => false);
    this.isSurvivalTeamWiped = options.isSurvivalTeamWiped ?? (() => false);
    this.isAdvanceComplete = options.isAdvanceComplete ?? (() => false);
    this.isAdvanceTeamDefeated = options.isAdvanceTeamDefeated ?? (() => false);
  }

  update(): RoundOutcome | null {
    if (this.concluded) return null;

    // Nur eigene Basen zaehlen: sonst waere mit gefallener Gegnerbasis auch die Niederlage
    // ausgeloest oder – schlimmer – gar nicht mehr moeglich.
    // `advance` kennt keine Basis-Niederlage: eine optionale Basis darf fallen, ohne die Mission
    // zu beenden.
    if (this.objective !== 'survive'
      && this.objective !== 'advance'
      && this.getTotalMainBaseHp('friendly') <= 0) {
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
      if (this.hasMainBase('hostile') && this.getTotalMainBaseHp('hostile') <= 0) {
        this.concluded = true;
        return 'victory';
      }
      return null;
    }

    if (this.objective === 'repel-assault') {
      if (this.isAssaultRepelled()) {
        this.concluded = true;
        return 'victory';
      }
      return null;
    }

    if (this.objective === 'advance') {
      // Die endgueltige Niederlage hat Vorrang, falls beide Signale im selben Host-Tick anliegen.
      // Ein momentaner Wipe mit laufenden Respawn-Timern ist ausdruecklich kein Defeat.
      if (this.isAdvanceTeamDefeated()) {
        this.concluded = true;
        return 'defeat';
      }
      if (this.isAdvanceComplete()) {
        this.concluded = true;
        return 'victory';
      }
      return null;
    }

    if (this.objective === 'survive') {
      if (this.isSurvivalTeamWiped()) {
        this.concluded = true;
        return 'defeat';
      }

      if (this.getSecondsLeft() <= 0) {
        this.concluded = true;
        return 'victory';
      }
    }

    return null;
  }

  applyDebugBaseDamage(amount: number): void {
    if (amount <= 0 || this.concluded) return;

    const manager = this.baseManager as BaseManager & {
      getMainBasesByFaction?: (faction: 'friendly' | 'hostile') => readonly { id: string; getHp: () => number }[];
    };
    const targetBase = (manager.getMainBasesByFaction?.('friendly') ?? this.baseManager.getBasesByFaction('friendly'))
      .find((base) => base.getHp() > 0);
    if (!targetBase) return;

    this.baseManager.applyDamage(targetBase.id, amount);
  }

  private getTotalMainBaseHp(faction: 'friendly' | 'hostile'): number {
    const manager = this.baseManager as BaseManager & {
      getTotalMainBaseHp?: (baseFaction: 'friendly' | 'hostile') => number;
    };
    return manager.getTotalMainBaseHp
      ? manager.getTotalMainBaseHp(faction)
      : manager.getTotalHp(faction);
  }

  private hasMainBase(faction: 'friendly' | 'hostile'): boolean {
    const manager = this.baseManager as BaseManager & {
      getMainBasesByFaction?: (baseFaction: 'friendly' | 'hostile') => readonly unknown[];
    };
    return manager.getMainBasesByFaction
      ? manager.getMainBasesByFaction(faction).length > 0
      : manager.hasFaction(faction);
  }
}
