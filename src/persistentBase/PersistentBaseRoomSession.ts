import { PersistentBaseContributionStore } from './PersistentBaseContributionStore';
import { PersistentBaseRewardStore } from './PersistentBaseRewardStore';
import type { PersistentBaseRuntimeBindings } from './PersistentBaseRuntimeBindings';
import {
  PersistentBaseTransaction,
  type PersistentBaseTransactionIdentity,
  type PersistentBaseTransactionOutcome,
} from './PersistentBaseTransaction';
import type { PersistentPlayerBaseContribution } from './PersistentBaseTypes';

/**
 * Der raumlanglebige Zustand der persistenten Basis.
 *
 * Er lebt genau so lange wie der Raum: laenger als jede World und jede Activity, kuerzer als der
 * persoenliche Speicherstand eines Spielers. Er haelt den committed Stand aller Besitzer und der
 * Belohnungen und ist die **einzige** Stelle, an der ein Arbeitsstand geoeffnet und abgeschlossen
 * wird.
 *
 * Die drei Lifetimes bleiben dadurch getrennt:
 * - committed Raumstand: hier;
 * - Arbeitsstand einer Activity: {@link PersistentBaseTransaction};
 * - Runtime-Objekte einer World: `PersistentBaseWorldBinding`.
 */
export class PersistentBaseRoomSession {
  private readonly contributionStore = new PersistentBaseContributionStore();
  private readonly rewardStore = new PersistentBaseRewardStore();
  private openTransaction: PersistentBaseTransaction | null = null;
  private nextTransactionId = 1;

  /** Beitraege aller Besitzer dieses Raums. */
  get contributions(): PersistentBaseContributionStore {
    return this.contributionStore;
  }

  /** Belohnungsplatzierungen dieses Raums. */
  get rewards(): PersistentBaseRewardStore {
    return this.rewardStore;
  }

  /** Der laufende Arbeitsstand; `null`, solange keine Activity einen geoeffnet hat. */
  get transaction(): PersistentBaseTransaction | null {
    return this.openTransaction;
  }

  get hasOpenTransaction(): boolean {
    return this.openTransaction?.isOpen === true;
  }

  /**
   * Eroeffnet den Arbeitsstand einer Activity.
   *
   * Ein bereits offener Arbeitsstand derselben Instanz bleibt bestehen; ein Arbeitsstand einer
   * **anderen** Instanz wird zuvor verworfen - er gehoert zu einer Activity, die es nicht mehr
   * gibt, und darf den neuen Stand nicht mehr erreichen.
   */
  beginTransaction(identity: PersistentBaseTransactionIdentity): PersistentBaseTransaction {
    const current = this.openTransaction;
    if (current?.isOpen === true) {
      if (current.belongsTo(identity)) return current;
      this.completeTransaction('rollback', () => false);
    }
    const transaction = new PersistentBaseTransaction(
      this.nextTransactionId,
      identity,
      this.contributionStore.committedContributions,
      this.rewardStore.committedState,
    );
    this.nextTransactionId += 1;
    this.openTransaction = transaction;
    this.contributionStore.useTransaction(transaction);
    this.rewardStore.useTransaction(transaction);
    return transaction;
  }

  /**
   * Bindet die Runtime-Objekte der laufenden World-Instanz an den Raumzustand.
   *
   * Sie gehoeren der World; der Raum benutzt sie nur, solange sie steht.
   */
  useWorldRuntimes(runtimeBindings: PersistentBaseRuntimeBindings | null): void {
    this.contributionStore.useWorldRuntimes(runtimeBindings);
  }

  /**
   * Schliesst den Bestand der endenden World ab: Was als Runtime-Objekt noch steht, bleibt im
   * Arbeitsstand, alles andere faellt heraus.
   */
  finalizeWorldRuntimeObjects(isRuntimeObjectAlive: (runtimeId: number) => boolean): void {
    this.contributionStore.finalizeWorldRuntimeObjects(isRuntimeObjectAlive);
  }

  /**
   * Schliesst den Arbeitsstand genau einmal ab.
   *
   * `identity` ist der Schutz gegen einen verspaeteten Abschluss: Gehoert er zu einer anderen
   * World- oder Activity-Instanz als der offene Arbeitsstand, passiert nichts. Ohne Angabe gilt
   * der Abschluss fuer den gerade offenen Stand - das ist der technische Abbruch.
   */
  completeTransaction(
    outcome: PersistentBaseTransactionOutcome,
    isRuntimeObjectAlive: (runtimeId: number) => boolean,
    identity?: PersistentBaseTransactionIdentity,
  ): readonly PersistentPlayerBaseContribution[] {
    const transaction = this.openTransaction;
    if (!transaction || !transaction.isOpen) return [];
    if (identity && !transaction.belongsTo(identity)) return [];
    // Der Slot wird zuerst geleert: Ein zweiter oder verspaeteter Abschluss findet danach keinen
    // offenen Arbeitsstand mehr und kann denselben Stand nicht erneut buchen.
    this.openTransaction = null;

    let confirmed: readonly PersistentPlayerBaseContribution[] = [];
    if (outcome === 'commit') {
      confirmed = this.contributionStore.commitTransaction(isRuntimeObjectAlive);
      this.rewardStore.commitTransaction();
    } else {
      this.contributionStore.rollbackTransaction();
      this.rewardStore.rollbackTransaction();
    }

    // Erst jetzt ist der Ausgang terminal. Wer die Transaktion noch haelt, sieht sie geschlossen.
    transaction.close(outcome);
    this.contributionStore.useTransaction(null);
    this.rewardStore.useTransaction(null);
    return confirmed;
  }

  /** Entfernt einen Besitzer aus dem Raum und meldet seine Objekte, die aus der Welt fallen. */
  removeOwner(ownerId: string): readonly number[] {
    return this.contributionStore.removeOwner(ownerId);
  }
}
