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

/**
 * Host-seitiger Zustand aller persoenlichen Beitraege einer persistenten Basis.
 *
 * Verbindlicher Zweck: **Ein einziger Besitzpfad.** Ob ein Beitrag dem Host oder einem Gast
 * gehoert, ist hier nur noch eine Besitzeridentitaet - es gibt keine zweite Datenstruktur mehr,
 * die Gaeste anders behandelt als den Host.
 *
 * Der Store ist bewusst frei von lokaler Persistenz: Ohne aktive Mission schreibt eine vom Host
 * akzeptierte Aenderung sofort den committed Stand fort. In einer Mission bleibt sie dagegen im
 * Working State, bis der Rundenausgang ueber Commit oder Rollback entscheidet. Speichern darf den
 * host-bestaetigten Stand ausschliesslich der jeweilige Besitzer auf seinem eigenen Geraet.
 */
/** Ein materialisierter Blueprint und das Runtime-Objekt, das ihn gerade darstellt. */
export interface PersistentRuntimeBinding {
  readonly runtimeId: number;
  readonly ownerId: string;
  readonly blueprint: PersistentConstruction;
}

export class PersistentBaseContributionStore {
  /** Vom Besitzer angebotener und vom Host akzeptierter Stand, ausserhalb einer Mission. */
  private readonly committed = new Map<string, PersistentPlayerBaseContribution>();
  /** Stand bei Missionsbeginn; die Rollback-Quelle. */
  private baseline: Map<string, PersistentPlayerBaseContribution> | null = null;
  /** Laufender Missionsstand, der bei Sieg fortgeschrieben wird. */
  private working: Map<string, PersistentPlayerBaseContribution> | null = null;
  private readonly runtimeBlueprints = new Map<number, { ownerId: string; blueprint: PersistentConstruction }>();
  private newIdCounter = 0;

  get hasActiveMission(): boolean {
    return this.working !== null;
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
    if (!this.working) return true;
    // Ein Beitrag, der waehrend der Mission neu dazukommt, gilt ab sofort mit; ein bereits
    // laufender Arbeitsstand wird dagegen nicht rueckwirkend ersetzt.
    if (!this.working.has(contribution.ownerId)) {
      this.working.set(contribution.ownerId, clonePersistentPlayerBaseContribution(contribution));
      this.baseline?.set(contribution.ownerId, clonePersistentPlayerBaseContribution(contribution));
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

  beginMission(): void {
    if (this.working) return;
    this.baseline = cloneMap(this.committed);
    this.working = cloneMap(this.committed);
    this.runtimeBlueprints.clear();
  }

  /** Bindet ein materialisiertes Runtime-Objekt an seinen Blueprint. */
  registerRestored(ownerId: string, blueprint: PersistentConstruction, runtimeId: number): void {
    for (const [existingId, existing] of this.runtimeBlueprints) {
      if (existing.ownerId !== ownerId || existing.blueprint.persistentId !== blueprint.persistentId) continue;
      this.runtimeBlueprints.delete(existingId);
    }
    this.runtimeBlueprints.set(runtimeId, { ownerId, blueprint: { ...blueprint, tool: { ...blueprint.tool } } });
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

    const target = this.working ?? this.committed;
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
      revision: this.working ? current.revision : current.revision + 1,
      constructions: [...current.constructions, blueprint],
    });
    this.runtimeBlueprints.set(runtime.id, { ownerId, blueprint });
    return { persistentId, placementOrder, origin: 'new' };
  }

  /** True, wenn dieser Blueprint bereits ein Runtime-Objekt in der Welt hat. */
  isMaterialized(ownerId: string, persistentId: string): boolean {
    return this.findRuntimeId(ownerId, persistentId) !== undefined;
  }

  /** Alle aktuell materialisierten Blueprints samt ihrer Runtime-Bindung. */
  getRuntimeBindings(): readonly PersistentRuntimeBinding[] {
    return [...this.runtimeBlueprints.entries()].map(([runtimeId, entry]) => ({
      runtimeId,
      ownerId: entry.ownerId,
      blueprint: entry.blueprint,
    }));
  }

  /**
   * Loest die Runtime-Bindung, ohne den Blueprint anzutasten.
   *
   * Das ist der Gegenbegriff zum Abriss: Wird eine Konstruktion durch einen Konflikt verdraengt,
   * verschwindet nur ihr Objekt aus der Welt. Ihr Besitzer behaelt sie und sie erscheint wieder,
   * sobald der Grund entfaellt.
   */
  releaseRuntimeBinding(runtimeId: number): boolean {
    return this.runtimeBlueprints.delete(runtimeId);
  }

  getRuntimeMetadata(runtimeId: number): PersistentRuntimeMetadata | null {
    const entry = this.runtimeBlueprints.get(runtimeId);
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
    const entry = this.runtimeBlueprints.get(runtimeId);
    if (!entry) return false;
    this.runtimeBlueprints.delete(runtimeId);
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
    this.baseline?.delete(ownerId);
    this.working?.delete(ownerId);
    const runtimeIds: number[] = [];
    for (const [runtimeId, entry] of this.runtimeBlueprints) {
      if (entry.ownerId !== ownerId) continue;
      runtimeIds.push(runtimeId);
      this.runtimeBlueprints.delete(runtimeId);
    }
    return runtimeIds;
  }

  /** Loest Runtime-Bindungen beim Kartenwechsel, ohne den Arbeitsstand zu verlieren. */
  detachRuntimeObjects(isRuntimeObjectAlive: (runtimeId: number) => boolean): void {
    if (!this.working) {
      this.runtimeBlueprints.clear();
      return;
    }
    for (const [runtimeId, entry] of this.runtimeBlueprints) {
      if (isRuntimeObjectAlive(runtimeId)) continue;
      // Ein zerstoertes Objekt faellt aus dem Arbeitsstand; ein Sieg schreibt es dann nicht fort.
      this.removeFromCurrent(entry.ownerId, entry.blueprint.persistentId);
    }
    this.runtimeBlueprints.clear();
  }

  /**
   * Schreibt den Arbeitsstand fort und liefert je Besitzer den bestaetigten neuen Beitrag.
   *
   * Nur der Host darf das Ergebnis erzeugen; gespeichert wird es anschliessend von jedem
   * Besitzer auf seinem eigenen Geraet. Genau deshalb steigt die Revision hier und nicht dort.
   */
  commit(isRuntimeObjectAlive: (runtimeId: number) => boolean): readonly PersistentPlayerBaseContribution[] {
    if (!this.working || !this.baseline) return [];
    const next = new Map<string, PersistentPlayerBaseContribution>();
    for (const [ownerId, contribution] of this.working) {
      const constructions = contribution.constructions.filter((blueprint) => {
        const runtimeId = this.findRuntimeId(ownerId, blueprint.persistentId);
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
    this.baseline = null;
    this.working = null;
    this.runtimeBlueprints.clear();
    return [...next.values()].sort((left, right) => compareIds(left.ownerId, right.ownerId));
  }

  /** Verwirft den Arbeitsstand. Der zuletzt bestaetigte Beitrag jedes Besitzers bleibt stehen. */
  rollback(): void {
    if (this.baseline) {
      this.committed.clear();
      for (const [ownerId, contribution] of this.baseline) {
        this.committed.set(ownerId, clonePersistentPlayerBaseContribution(contribution));
      }
    }
    this.baseline = null;
    this.working = null;
    this.runtimeBlueprints.clear();
  }

  private removeFromCurrent(ownerId: string, persistentId: string): void {
    const target = this.working ?? this.committed;
    const current = target.get(ownerId);
    if (!current) return;
    target.set(ownerId, {
      ...current,
      revision: this.working ? current.revision : current.revision + 1,
      constructions: current.constructions.filter((entry) => entry.persistentId !== persistentId),
    });
  }

  private findRuntimeId(ownerId: string, persistentId: string): number | undefined {
    for (const [runtimeId, entry] of this.runtimeBlueprints) {
      if (entry.ownerId === ownerId && entry.blueprint.persistentId === persistentId) return runtimeId;
    }
    return undefined;
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

function cloneMap(
  source: ReadonlyMap<string, PersistentPlayerBaseContribution>,
): Map<string, PersistentPlayerBaseContribution> {
  return new Map([...source.entries()].map(([ownerId, contribution]) => [
    ownerId,
    clonePersistentPlayerBaseContribution(contribution),
  ]));
}

function compareConstructions(left: PersistentConstruction, right: PersistentConstruction): number {
  return left.placementOrder - right.placementOrder
    || compareIds(left.persistentId, right.persistentId);
}

function compareIds(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
