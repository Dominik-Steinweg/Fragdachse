import {
  clonePersistentPlayerBaseContribution,
  type PersistentPlayerBaseContribution,
} from './PersistentBaseTypes';
import {
  clonePersistentBaseRewardState,
  type PersistentBaseRewardState,
} from './PersistentBaseRewardTypes';

/** Identitaet, die eine host-seitig angenommene PB-Mutation beschreibt. */
export interface PersistentBaseMutationIdentity {
  readonly worldRevision: number;
  /** Fehlt bewusst fuer World-Operationen ohne laufende Activity/Transaction. */
  readonly activityRevision?: number;
}

/**
 * Die Instanz, fuer die ein Arbeitsstand geoeffnet wurde.
 *
 * Sie ist der Grund, aus dem ein verspaeteter Abschluss nichts mehr bewirkt: Er gehoert dann zu
 * einer anderen World- oder Activity-Instanz als der gerade offene Arbeitsstand.
 */
export interface PersistentBaseTransactionIdentity {
  readonly worldRevision: number;
  readonly activityRevision: number;
}

/** Wie ein Arbeitsstand endet. Es gibt genau diese beiden Ausgaenge und genau einmal einen. */
export type PersistentBaseTransactionOutcome = 'commit' | 'rollback';

/**
 * Der Arbeitsstand der persistenten Basis waehrend genau einer Activity.
 *
 * Er traegt die Ausgangslage (Baseline), den laufenden Stand (Working State), die Identitaet der
 * Instanz, zu der er gehoert, und eine eigene ID. Sein Abschluss ist terminal: `commit` oder
 * `rollback`, genau einmal. Danach nimmt er nichts mehr an - ein zweiter oder verspaeteter
 * Abschluss laeuft ins Leere, statt einen inzwischen neuen Arbeitsstand zu treffen.
 *
 * Ausdruecklich **nicht** hier: der committed Raumstand (er ueberlebt jede Activity) und die
 * Runtime-Objekte einer World (sie fallen mit ihr).
 */
export class PersistentBaseTransaction {
  private readonly contributionBaselineState: Map<string, PersistentPlayerBaseContribution>;
  private readonly contributionWorkingState: Map<string, PersistentPlayerBaseContribution>;
  private readonly rewardBaselineState: PersistentBaseRewardState;
  private rewardWorkingState: PersistentBaseRewardState;
  private terminalOutcome: PersistentBaseTransactionOutcome | null = null;

  constructor(
    readonly id: number,
    readonly identity: PersistentBaseTransactionIdentity,
    contributionBaseline: ReadonlyMap<string, PersistentPlayerBaseContribution>,
    rewardBaseline: PersistentBaseRewardState,
  ) {
    this.contributionBaselineState = cloneContributions(contributionBaseline);
    this.contributionWorkingState = cloneContributions(contributionBaseline);
    this.rewardBaselineState = clonePersistentBaseRewardState(rewardBaseline);
    this.rewardWorkingState = clonePersistentBaseRewardState(rewardBaseline);
  }

  /** True, solange dieser Arbeitsstand weder committed noch verworfen wurde. */
  get isOpen(): boolean {
    return this.terminalOutcome === null;
  }

  get outcome(): PersistentBaseTransactionOutcome | null {
    return this.terminalOutcome;
  }

  /** Die Beitraege bei Missionsbeginn; die Rollback-Quelle. */
  get contributionsAtStart(): ReadonlyMap<string, PersistentPlayerBaseContribution> {
    return this.contributionBaselineState;
  }

  /** Der laufende Beitragsstand dieser Activity. */
  get contributions(): Map<string, PersistentPlayerBaseContribution> {
    return this.contributionWorkingState;
  }

  get rewardsAtStart(): PersistentBaseRewardState {
    return this.rewardBaselineState;
  }

  get rewards(): PersistentBaseRewardState {
    return this.rewardWorkingState;
  }

  setRewards(state: PersistentBaseRewardState): void {
    if (!this.isOpen) return;
    this.rewardWorkingState = state;
  }

  /**
   * Nimmt einen erst waehrend der Activity eingetroffenen Beitrag in die Ausgangslage auf.
   *
   * Er war beim Start noch nicht da und darf deshalb bei einem Rollback nicht verschwinden: Sein
   * Besitzer hat ihn ausserhalb dieser Mission bestaetigt bekommen.
   */
  adoptContributionAtStart(contribution: PersistentPlayerBaseContribution): void {
    if (!this.isOpen) return;
    this.contributionBaselineState.set(contribution.ownerId, contribution);
  }

  /** Entfernt einen Besitzer aus Ausgangslage und Arbeitsstand; er verlaesst den Raum. */
  removeOwner(ownerId: string): void {
    this.contributionBaselineState.delete(ownerId);
    this.contributionWorkingState.delete(ownerId);
  }

  /** Gehoert ein Abschluss noch zu genau dieser Instanz? */
  belongsTo(identity: PersistentBaseTransactionIdentity): boolean {
    return this.identity.worldRevision === identity.worldRevision
      && this.identity.activityRevision === identity.activityRevision;
  }

  /**
   * Schliesst den Arbeitsstand ab. Liefert `false`, wenn er bereits abgeschlossen war - dann hat
   * dieser Aufruf nichts veraendert und darf auch nichts fortschreiben.
   */
  close(outcome: PersistentBaseTransactionOutcome): boolean {
    if (this.terminalOutcome !== null) return false;
    this.terminalOutcome = outcome;
    return true;
  }
}

function cloneContributions(
  source: ReadonlyMap<string, PersistentPlayerBaseContribution>,
): Map<string, PersistentPlayerBaseContribution> {
  return new Map([...source.entries()].map(([ownerId, contribution]) => [
    ownerId,
    clonePersistentPlayerBaseContribution(contribution),
  ]));
}
