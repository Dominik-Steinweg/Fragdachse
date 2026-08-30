import { PersistentBaseContributionStore } from './PersistentBaseContributionStore';
import { PersistentBaseRewardStore } from './PersistentBaseRewardStore';
import type { PersistentBaseRuntimeBindings } from './PersistentBaseRuntimeBindings';
import {
  PersistentBaseTransaction,
  type PersistentBaseMutationIdentity,
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
  /**
   * Raum-langlebige Zuordnung zwischen einer aktuellen Raum-Spieler-ID und ihrem dauerhaften
   * Persistent-Base-Owner. Sie ist keine Ableitung aus einem Snapshot: Join, Leave und Rejoin
   * aendern diese Bindung ausdruecklich ueber diesen Owner.
   */
  private readonly persistentBaseOwnerByPlayerId = new Map<string, string>();
  private readonly playerIdByPersistentBaseOwnerId = new Map<string, string>();
  /**
   * Letzte vom Host je Raum-Spieler angenommene Contribution-Revision. Das ist der fachliche
   * Session-Revisionsstand des Ingests, nicht ein Transport-Cache: Leave loest ihn zusammen mit
   * der room-lokalen Owner-Bindung, Rejoin darf den Save erneut anbieten.
   */
  private readonly ingestedContributionRevisions = new Map<string, number>();
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
   * Registriert die Owner-Bindung eines Spielers im Raum.
   *
   * Ein Spieler kann innerhalb derselben RoomSession nicht still auf einen anderen Owner
   * umgebogen werden. Ein Owner kann ebenso wenig von einem zweiten Spieler beansprucht werden.
   * Ungueltige Claims veraendern keine der beiden Maps.
   */
  bindPlayerOwner(playerId: string, ownerId: string): boolean {
    if (!playerId || !ownerId) return false;
    const currentOwnerId = this.persistentBaseOwnerByPlayerId.get(playerId);
    if (currentOwnerId !== undefined && currentOwnerId !== ownerId) return false;
    const currentPlayerId = this.playerIdByPersistentBaseOwnerId.get(ownerId);
    if (currentPlayerId !== undefined && currentPlayerId !== playerId) return false;
    if (currentOwnerId === ownerId) return true;
    this.persistentBaseOwnerByPlayerId.set(playerId, ownerId);
    this.playerIdByPersistentBaseOwnerId.set(ownerId, playerId);
    return true;
  }

  getOwnerIdForPlayer(playerId: string): string | null {
    return this.persistentBaseOwnerByPlayerId.get(playerId) ?? null;
  }

  getPlayerIdForOwner(ownerId: string): string | null {
    return this.playerIdByPersistentBaseOwnerId.get(ownerId) ?? null;
  }

  /**
   * Nimmt einen validierten Beitrag genau einmal je Revision in den Room-State auf.
   *
   * Die Contribution selbst bleibt die kanonische Owner-Domain; dieser Owner koordiniert nur
   * die dazugehoerige Raum-Spieler-Bindung und den fachlichen Annahmestand. Ein gleicher oder
   * stale angebotener Stand veraendert weder Binding noch Contribution.
   */
  acceptContributionOffer(playerId: string, contribution: PersistentPlayerBaseContribution): boolean {
    if (!this.canBindPlayerOwner(playerId, contribution.ownerId)) return false;
    if (this.ingestedContributionRevisions.get(playerId) === contribution.revision) return false;
    if (!this.contributionStore.offerContribution(contribution)) return false;
    if (!this.bindPlayerOwner(playerId, contribution.ownerId)) return false;
    this.ingestedContributionRevisions.set(playerId, contribution.revision);
    return true;
  }

  /**
   * Prueft die fachliche Zugehoerigkeit einer laufenden PB-Mutation.
   *
   * Ohne Activity darf eine World-Operation keinen kuenstlichen Identifier benoetigen. Sobald
   * aber eine Transaction offen ist, ist ein fehlender oder fremder Activity-Identifier stale.
   * Die offene Transaction bleibt dabei die einzige Source of Truth fuer diese Entscheidung.
   */
  acceptsMutation(identity: PersistentBaseMutationIdentity): boolean {
    const activityRevision = identity.activityRevision;
    if (activityRevision !== undefined
      && (!Number.isSafeInteger(activityRevision) || activityRevision <= 0)) return false;

    const transaction = this.openTransaction;
    if (!transaction?.isOpen) return activityRevision === undefined;
    return activityRevision !== undefined
      && transaction.belongsTo({
        worldRevision: identity.worldRevision,
        activityRevision,
      });
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
    const playerId = this.playerIdByPersistentBaseOwnerId.get(ownerId);
    if (playerId !== undefined) {
      this.persistentBaseOwnerByPlayerId.delete(playerId);
      this.playerIdByPersistentBaseOwnerId.delete(ownerId);
      this.ingestedContributionRevisions.delete(playerId);
    }
    return this.contributionStore.removeOwner(ownerId);
  }

  /** Entfernt die room-lokale Bindung eines Spielers, ohne seinen persoenlichen Save anzutasten. */
  removePlayerOwner(playerId: string): readonly number[] {
    const ownerId = this.persistentBaseOwnerByPlayerId.get(playerId);
    this.ingestedContributionRevisions.delete(playerId);
    if (ownerId === undefined) return [];
    return this.removeOwner(ownerId);
  }

  private canBindPlayerOwner(playerId: string, ownerId: string): boolean {
    const currentOwnerId = this.persistentBaseOwnerByPlayerId.get(playerId);
    if (currentOwnerId !== undefined && currentOwnerId !== ownerId) return false;
    const currentPlayerId = this.playerIdByPersistentBaseOwnerId.get(ownerId);
    return currentPlayerId === undefined || currentPlayerId === playerId;
  }
}
