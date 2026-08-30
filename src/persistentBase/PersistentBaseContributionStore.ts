import {
  arePersistentContributionsEqual,
  clonePersistentPlayerBaseContribution,
  normalizePersistentToolRef,
  type PersistentBaseAnchor,
  type PersistentConstruction,
  type PersistentPlayerBaseContribution,
  type PersistentRuntimeMetadata,
  type PersistentToolRef,
} from './PersistentBaseTypes';
import { PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION } from '../config/persistentBase';
import {
  isCellInsidePersistentBaseBuildArea,
  type PersistentBaseBuildArea,
} from './PersistentBaseCore';
import {
  PersistentBaseRuntimeBindings,
  type PersistentRuntimeBinding,
} from './PersistentBaseRuntimeBindings';
import type { PersistentBaseTransaction } from './PersistentBaseTransaction';

export type { PersistentRuntimeBinding } from './PersistentBaseRuntimeBindings';

/**
 * Der committed Beitragsstand aller Besitzer einer persistenten Basis.
 *
 * Verbindlicher Zweck: **Ein einziger Besitzpfad.** Ob ein Beitrag dem Host oder einem Gast
 * gehoert, ist hier nur noch eine Besitzeridentitaet - es gibt keine zweite Datenstruktur mehr,
 * die Gaeste anders behandelt als den Host.
 *
 * Der Speicher haelt genau eine Lifetime: den raumlanglebigen committed Stand. Der Arbeitsstand
 * einer laufenden Activity gehoert der {@link PersistentBaseTransaction}, die Runtime-Objekte
 * gehoeren der World. Beides wird hier nur benutzt, solange es existiert - ohne Transaktion
 * schreibt eine vom Host akzeptierte Aenderung sofort den committed Stand fort.
 *
 * Der Store ist bewusst frei von lokaler Persistenz: Speichern darf den host-bestaetigten Stand
 * ausschliesslich der jeweilige Besitzer auf seinem eigenen Geraet.
 */
export class PersistentBaseContributionStore {
  /** Vom Besitzer angebotener und vom Host akzeptierter Stand; er ueberlebt jede Activity. */
  private readonly committed = new Map<string, PersistentPlayerBaseContribution>();
  /**
   * Der Arbeitsstand der laufenden Activity. Er gehoert der Transaktion, nicht diesem Speicher:
   * Was dort steht, endet mit ihrem Abschluss.
   */
  private transaction: PersistentBaseTransaction | null = null;
  /**
   * Die Runtime-Objekte der laufenden World-Instanz. Sie gehoeren ihr; ausserhalb einer World
   * gibt es schlicht keine, und dieser leere Ersatz haelt jede Abfrage ohne Sonderfall am Leben.
   */
  private runtimeBindings: PersistentBaseRuntimeBindings = new PersistentBaseRuntimeBindings();
  private newIdCounter = 0;

  get hasActiveMission(): boolean {
    return this.working !== null;
  }

  /** Der committed Raumstand; die Ausgangslage jeder neuen Transaktion. */
  get committedContributions(): ReadonlyMap<string, PersistentPlayerBaseContribution> {
    return this.committed;
  }

  /**
   * Bindet den Arbeitsstand dieser Activity ein oder loest ihn wieder.
   *
   * Der Speicher besitzt ihn nicht: Ein abgeschlossener oder abgeloester Arbeitsstand ist fuer
   * ihn sofort unsichtbar, und jede Aenderung trifft wieder den committed Stand.
   */
  useTransaction(transaction: PersistentBaseTransaction | null): void {
    this.transaction = transaction;
  }

  /**
   * Bindet die Runtime-Objekte der laufenden World-Instanz.
   *
   * `null` bedeutet: keine World, also keine materialisierten Objekte. Der Speicher fuehrt dann
   * einen leeren Ersatz und keine eigenen Bindungen.
   */
  useWorldRuntimes(runtimeBindings: PersistentBaseRuntimeBindings | null): void {
    this.runtimeBindings = runtimeBindings ?? new PersistentBaseRuntimeBindings();
  }

  get ownerIds(): readonly string[] {
    return [...(this.working ?? this.committed).keys()].sort(compareIds);
  }

  /**
   * Uebernimmt den vom Besitzer angebotenen Beitrag.
   *
   * Waehrend einer laufenden Mission wird ein Angebot ignoriert: Der Arbeitsstand dieser Mission
   * gehoert dem Host, und ein Client duerfte ihn nicht per Angebot ueberschreiben.
   */
  offerContribution(contribution: PersistentPlayerBaseContribution): boolean {
    const stored = this.committed.get(contribution.ownerId);
    if (stored && contribution.revision < stored.revision) return false;
    // Dieselbe Revision darf sich wiederholen, aber nicht ihren Inhalt aendern: Sonst koennte ein
    // Client einen bereits akzeptierten Stand still gegen einen anderen austauschen.
    if (stored && contribution.revision === stored.revision) {
      return arePersistentContributionsEqual(stored, contribution);
    }
    this.committed.set(contribution.ownerId, clonePersistentPlayerBaseContribution(contribution));
    const working = this.working;
    if (!working) return true;
    // Ein Beitrag, der waehrend der Mission neu dazukommt, gilt ab sofort mit; ein bereits
    // laufender Arbeitsstand wird dagegen nicht rueckwirkend ersetzt.
    if (!working.has(contribution.ownerId)) {
      working.set(contribution.ownerId, clonePersistentPlayerBaseContribution(contribution));
      this.transaction?.adoptContributionAtStart(clonePersistentPlayerBaseContribution(contribution));
    }
    return true;
  }

  getContribution(ownerId: string): PersistentPlayerBaseContribution | null {
    const source = (this.working ?? this.committed).get(ownerId);
    return source ? clonePersistentPlayerBaseContribution(source) : null;
  }

  getCommittedContribution(ownerId: string): PersistentPlayerBaseContribution | null {
    const stored = this.committed.get(ownerId);
    return stored ? clonePersistentPlayerBaseContribution(stored) : null;
  }

  /** Der aktuelle Stand aller Besitzer, deterministisch nach Besitzeridentitaet sortiert. */
  getContributions(): readonly PersistentPlayerBaseContribution[] {
    const source = this.working ?? this.committed;
    return [...source.values()]
      .map(clonePersistentPlayerBaseContribution)
      .sort((left, right) => compareIds(left.ownerId, right.ownerId));
  }

  /** Bindet ein materialisiertes Runtime-Objekt an seinen Blueprint. */
  registerRestored(ownerId: string, blueprint: PersistentConstruction, runtimeId: number): void {
    this.runtimeBindings.rebind(runtimeId, ownerId, blueprint);
  }

  /**
   * Nimmt eine neu platzierte Konstruktion in den aktuellen Stand ihres Besitzers auf.
   *
   * Der Host ruft das erst, nachdem er die Platzierung selbst akzeptiert hat; die Pruefung hier
   * ist die letzte Zusicherung, dass nichts ausserhalb des Baubereichs persistent wird.
   */
  registerNew(
    ownerId: string,
    runtime: { readonly id: number; readonly gridX: number; readonly gridY: number; readonly angle: number; readonly ownerId: string; readonly expiresAt: number },
    tool: PersistentToolRef,
    footprint: readonly { readonly dx: number; readonly dy: number }[],
    anchor: PersistentBaseAnchor,
    buildArea: PersistentBaseBuildArea,
  ): PersistentRuntimeMetadata | null {
    if (!ownerId || runtime.expiresAt > 0) return null;
    const inside = (footprint.length > 0 ? footprint : [{ dx: 0, dy: 0 }]).every((offset) => (
      isCellInsidePersistentBaseBuildArea(
        runtime.gridX + offset.dx - anchor.gridX,
        runtime.gridY + offset.dy - anchor.gridY,
        buildArea,
      )
    ));
    if (!inside) return null;

    const working = this.working;
    const target = working ?? this.committed;
    const current = target.get(ownerId)
      ?? emptyContribution(ownerId, this.committed.get(ownerId)?.revision ?? 0);
    const placementOrder = current.constructions.reduce(
      (max, entry) => Math.max(max, entry.placementOrder),
      -1,
    ) + 1;
    let persistentId = `pb-${ownerId.slice(-8)}-${current.revision + 1}-${placementOrder}`;
    while (this.hasPersistentId(ownerId, persistentId)) {
      this.newIdCounter += 1;
      persistentId = `pb-${ownerId.slice(-8)}-${current.revision + 1}-${placementOrder}-${this.newIdCounter}`;
    }
    const blueprint: PersistentConstruction = {
      persistentId,
      tool: normalizePersistentToolRef(tool),
      relativeGridX: runtime.gridX - anchor.gridX,
      relativeGridY: runtime.gridY - anchor.gridY,
      angle: Number.isFinite(runtime.angle) ? runtime.angle : 0,
      placementOrder,
    };
    target.set(ownerId, {
      ...current,
      // Lobby-Aenderungen sind bereits der host-bestaetigte Commit. Eine Mission erhoeht ihre
      // Revision weiterhin erst gesammelt beim Victory-Commit.
      revision: working ? current.revision : current.revision + 1,
      constructions: [...current.constructions, blueprint],
    });
    this.runtimeBindings.bind(runtime.id, ownerId, blueprint);
    return { persistentId, placementOrder, origin: 'new' };
  }

  /**
   * Verschiebt eine vorhandene Konstruktion ihres Besitzers auf eine neue Zelle.
   *
   * Ausdruecklich keine Kombination aus Abriss und Neubau: `persistentId`, Werkzeug, Besitz und
   * `placementOrder` bleiben unveraendert, es aendern sich nur Position und Winkel. Der Aufrufer
   * hat das Ziel bereits gegen die Welt geprueft; die Pruefung hier ist die letzte Zusicherung,
   * dass nichts ausserhalb des Baubereichs persistent wird.
   */
  moveConstruction(
    ownerId: string,
    persistentId: string,
    target: { readonly relativeGridX: number; readonly relativeGridY: number; readonly angle: number },
    footprint: readonly { readonly dx: number; readonly dy: number }[],
    buildArea: PersistentBaseBuildArea,
  ): PersistentConstruction | null {
    if (!ownerId
      || !Number.isSafeInteger(target.relativeGridX)
      || !Number.isSafeInteger(target.relativeGridY)) return null;
    const inside = (footprint.length > 0 ? footprint : [{ dx: 0, dy: 0 }]).every((offset) => (
      isCellInsidePersistentBaseBuildArea(
        target.relativeGridX + offset.dx,
        target.relativeGridY + offset.dy,
        buildArea,
      )
    ));
    if (!inside) return null;

    const working = this.working;
    const store = working ?? this.committed;
    const current = store.get(ownerId);
    const existing = current?.constructions.find((entry) => entry.persistentId === persistentId);
    if (!current || !existing) return null;

    const moved: PersistentConstruction = {
      ...existing,
      tool: { ...existing.tool },
      relativeGridX: target.relativeGridX,
      relativeGridY: target.relativeGridY,
      angle: Number.isFinite(target.angle) ? target.angle : existing.angle,
    };
    store.set(ownerId, {
      ...current,
      // Wie bei Bau und Abriss: Lobby-Aenderungen sind bereits der host-bestaetigte Commit, eine
      // Mission erhoeht ihre Revision erst gesammelt beim Victory-Commit.
      revision: working ? current.revision : current.revision + 1,
      constructions: current.constructions.map((entry) => (
        entry.persistentId === persistentId ? moved : entry
      )),
    });
    // Dieselbe Runtime traegt weiterhin denselben Blueprint; nur sein Inhalt ist jetzt aktuell.
    this.runtimeBindings.updateBlueprint(ownerId, moved);
    return moved;
  }

  /** True, wenn dieser Blueprint bereits ein Runtime-Objekt in der Welt hat. */
  isMaterialized(ownerId: string, persistentId: string): boolean {
    return this.runtimeBindings.findRuntimeId(ownerId, persistentId) !== undefined;
  }

  /** Alle aktuell materialisierten Blueprints samt ihrer Runtime-Bindung. */
  getRuntimeBindings(): readonly PersistentRuntimeBinding[] {
    return this.runtimeBindings.entries();
  }

  /**
   * Loest die Runtime-Bindung, ohne den Blueprint anzutasten.
   *
   * Das ist der Gegenbegriff zum Abriss: Wird eine Konstruktion durch einen Konflikt verdraengt,
   * verschwindet nur ihr Objekt aus der Welt. Ihr Besitzer behaelt sie und sie erscheint wieder,
   * sobald der Grund entfaellt.
   */
  releaseRuntimeBinding(runtimeId: number): boolean {
    return this.runtimeBindings.release(runtimeId);
  }

  getRuntimeMetadata(runtimeId: number): PersistentRuntimeMetadata | null {
    const entry = this.runtimeBindings.get(runtimeId);
    if (!entry) return null;
    const baselineEntry = this.baseline?.get(entry.ownerId)?.constructions
      .some((candidate) => candidate.persistentId === entry.blueprint.persistentId);
    return {
      persistentId: entry.blueprint.persistentId,
      placementOrder: entry.blueprint.placementOrder,
      origin: baselineEntry ? 'restored' : 'new',
    };
  }

  /**
   * Entfernt die Konstruktion hinter einem Runtime-Objekt aus dem aktuellen Stand.
   *
   * Das ist der Abriss und damit die einzige Stelle, an der ein Blueprint absichtlich
   * verschwindet. Er unterscheidet sich ausdruecklich vom Konflikt: Ein Konflikt laesst den
   * Besitz stehen, ein Abriss gibt ihn auf.
   */
  removeByRuntimeId(runtimeId: number): boolean {
    const entry = this.runtimeBindings.get(runtimeId);
    if (!entry) return false;
    this.runtimeBindings.release(runtimeId);
    this.removeFromCurrent(entry.ownerId, entry.blueprint.persistentId);
    return true;
  }

  /**
   * Entfernt einen Besitzer vollstaendig aus dem Raum.
   *
   * Die zurueckgegebenen Runtime-IDs sind genau die Objekte, die aus der Welt verschwinden
   * muessen. Sein persoenlicher Save bleibt davon unberuehrt - er liegt auf seinem Geraet.
   */
  removeOwner(ownerId: string): readonly number[] {
    this.committed.delete(ownerId);
    this.transaction?.removeOwner(ownerId);
    return this.runtimeBindings.releaseOwner(ownerId);
  }

  /**
   * Schliesst den Bestand der endenden World ab, ohne den Arbeitsstand zu verlieren.
   *
   * Ein Objekt, das die World nicht ueberlebt hat, faellt aus dem Arbeitsstand; ein Sieg schreibt
   * es dann nicht fort. Die Runtime-Bindungen selbst gehoeren der World und werden von ihr
   * abgeraeumt.
   */
  finalizeWorldRuntimeObjects(isRuntimeObjectAlive: (runtimeId: number) => boolean): void {
    if (!this.working) return;
    for (const binding of this.runtimeBindings.entries()) {
      if (isRuntimeObjectAlive(binding.runtimeId)) continue;
      this.removeFromCurrent(binding.ownerId, binding.blueprint.persistentId);
    }
  }

  /**
   * Schreibt den Arbeitsstand fort und liefert je Besitzer den bestaetigten neuen Beitrag.
   *
   * Nur der Host darf das Ergebnis erzeugen; gespeichert wird es anschliessend von jedem
   * Besitzer auf seinem eigenen Geraet. Genau deshalb steigt die Revision hier und nicht dort.
   */
  commitTransaction(isRuntimeObjectAlive: (runtimeId: number) => boolean): readonly PersistentPlayerBaseContribution[] {
    const working = this.working;
    if (!working) return [];
    const next = new Map<string, PersistentPlayerBaseContribution>();
    for (const [ownerId, contribution] of working) {
      const constructions = contribution.constructions.filter((blueprint) => {
        const runtimeId = this.runtimeBindings.findRuntimeId(ownerId, blueprint.persistentId);
        // Ohne Runtime-Objekt war der Blueprint in dieser Runde dormant - etwa wegen eines
        // Konflikts. Er ueberlebt unveraendert; ein Konflikt loescht keinen Besitz.
        return runtimeId === undefined || isRuntimeObjectAlive(runtimeId);
      });
      next.set(ownerId, {
        schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
        ownerId,
        revision: contribution.revision + 1,
        constructions: [...constructions].sort(compareConstructions),
      });
    }
    this.committed.clear();
    for (const [ownerId, contribution] of next) this.committed.set(ownerId, contribution);
    return [...next.values()].sort((left, right) => compareIds(left.ownerId, right.ownerId));
  }

  /** Verwirft den Arbeitsstand. Der bei Missionsbeginn bestaetigte Beitrag bleibt stehen. */
  rollbackTransaction(): void {
    const baseline = this.baseline;
    if (!baseline) return;
    this.committed.clear();
    for (const [ownerId, contribution] of baseline) {
      this.committed.set(ownerId, clonePersistentPlayerBaseContribution(contribution));
    }
  }

  /** Der laufende Arbeitsstand, solange die Transaktion offen ist. */
  private get working(): Map<string, PersistentPlayerBaseContribution> | null {
    const transaction = this.transaction;
    return transaction?.isOpen === true ? transaction.contributions : null;
  }

  /** Die Ausgangslage der offenen Transaktion; die Rollback-Quelle. */
  private get baseline(): ReadonlyMap<string, PersistentPlayerBaseContribution> | null {
    const transaction = this.transaction;
    return transaction?.isOpen === true ? transaction.contributionsAtStart : null;
  }

  private removeFromCurrent(ownerId: string, persistentId: string): void {
    const working = this.working;
    const target = working ?? this.committed;
    const current = target.get(ownerId);
    if (!current) return;
    target.set(ownerId, {
      ...current,
      revision: working ? current.revision : current.revision + 1,
      constructions: current.constructions.filter((entry) => entry.persistentId !== persistentId),
    });
  }

  private hasPersistentId(ownerId: string, persistentId: string): boolean {
    const sources = [this.committed.get(ownerId), this.working?.get(ownerId)];
    return sources.some((contribution) => (
      contribution?.constructions.some((entry) => entry.persistentId === persistentId) ?? false
    ));
  }
}

function emptyContribution(ownerId: string, revision: number): PersistentPlayerBaseContribution {
  return {
    schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
    ownerId,
    revision,
    constructions: [],
  };
}

function compareConstructions(left: PersistentConstruction, right: PersistentConstruction): number {
  return left.placementOrder - right.placementOrder
    || compareIds(left.persistentId, right.persistentId);
}

function compareIds(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
