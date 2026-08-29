import {
  isCellInsidePersistentBaseBuildArea,
  type PersistentBaseBuildArea,
} from './PersistentBaseCore';
import type {
  PersistentBaseAnchor,
  PersistentConstruction,
  PersistentPlayerBaseContribution,
} from './PersistentBaseTypes';

/**
 * Deterministischer Zusammenbau der sichtbaren persistenten Basis aus allen persoenlichen
 * Beitraegen.
 *
 * Verbindlicher Zweck: **Der Merge ist eine reine Funktion.** Er kennt weder Phaser noch das
 * Netzwerk und schreibt nichts zurueck. Der Host benutzt ihn als Autoritaet, ein Client duerfte
 * ihn fuer eine Vorschau benutzen, ohne dadurch je den autoritativen Zustand zu veraendern.
 *
 * Ebenso verbindlich: **Ein Konflikt loescht nichts.** Was hier nicht materialisiert wird, bleibt
 * im persoenlichen Save seines Besitzers stehen und erscheint wieder, sobald der Grund entfaellt.
 */

/** Woher ein Eintrag des Composites stammt. Die Reihenfolge ist zugleich seine Prioritaet. */
export type PersistentCompositeSource = 'host' | 'guest';

export interface PersistentGridCellOffset {
  readonly dx: number;
  readonly dy: number;
}

export interface PersistentCompositeCandidate {
  readonly blueprint: PersistentConstruction;
  readonly ownerId: string;
  readonly source: PersistentCompositeSource;
}

export interface PersistentCompositeActiveEntry extends PersistentCompositeCandidate {
  readonly footprint: readonly PersistentGridCellOffset[];
  readonly gridX: number;
  readonly gridY: number;
  readonly capacityCost: number;
}

/**
 * Warum ein gespeicherter Blueprint gerade nicht in der Welt steht.
 *
 * Jeder Grund ist voruebergehend und beschreibt die aktuelle World, nicht den Besitz: Dieselbe
 * Konstruktion kann im naechsten Raum wieder erscheinen.
 */
export type PersistentCompositeConflictReason =
  | 'unknown-tool'
  | 'locked'
  | 'not-in-loadout'
  | 'class-not-allowed'
  | 'mode-not-allowed'
  | 'outside-build-area'
  | 'authored-collision'
  | 'collision'
  | 'capacity';

export interface PersistentCompositeConflict {
  readonly ownerId: string;
  readonly persistentId: string;
  readonly toolId: string;
  readonly reason: PersistentCompositeConflictReason;
}

/** Was der Merge ueber ein Werkzeug des jeweiligen Besitzers wissen muss. */
export interface PersistentCompositeTool {
  readonly footprint: readonly PersistentGridCellOffset[];
  readonly capacityCost: number;
  /** Gesetzt, wenn der Besitzer dieses Werkzeug gerade nicht einsetzen darf. */
  readonly unavailableReason?: PersistentCompositeConflictReason;
}

export interface PersistentBaseCompositeMergeInput {
  readonly anchor: PersistentBaseAnchor;
  /** Die einzige Geometriequelle fuer "darf hier gebaut werden". */
  readonly buildArea: PersistentBaseBuildArea;
  /** Persoenlicher Beitrag des Hosts; er hat Vorrang vor allen Gastbeitraegen. */
  readonly hostContribution: PersistentPlayerBaseContribution | null;
  /** Beitraege der aktuell verbundenen Gaeste, in beliebiger Reihenfolge. */
  readonly guestContributions?: readonly PersistentPlayerBaseContribution[];
  /**
   * Werkzeuge des jeweiligen Besitzers.
   *
   * Absichtlich pro Besitzer: Ein Gast darf ein Werkzeug einsetzen, das der Host selbst nicht
   * freigeschaltet hat. Freischaltung, Klasse und Loadout gehoeren dem Besitzer der Konstruktion.
   */
  readonly resolveTool: (ownerId: string, toolId: string) => PersistentCompositeTool | null;
  /** Kapazitaet je Besitzer; ein gemeinsamer Basis-Pool waere ausdruecklich falsch. */
  readonly capacityMaxByOwner?: ReadonlyMap<string, number>;
  /** Bereits belegte Zellen: authored Weltgeometrie und feste Basisflaeche. */
  readonly isCellBlocked?: (gridX: number, gridY: number) => boolean;
  /** Cells already reserved by higher-priority authored/base-owned rewards. */
  readonly reservedCells?: ReadonlySet<string>;
}

export interface PersistentBaseCompositeMergeResult {
  readonly active: readonly PersistentCompositeActiveEntry[];
  readonly conflicts: readonly PersistentCompositeConflict[];
  readonly conflictsByOwner: ReadonlyMap<string, readonly PersistentCompositeConflict[]>;
}

/**
 * Prioritaet: authored Weltgeometrie, dann der Beitrag des Hosts, dann die Gaeste.
 *
 * Die Gaeste werden nach stabiler Besitzeridentitaet sortiert und nicht nach Beitrittsreihenfolge.
 * Nur dadurch liefert derselbe Raum mit denselben Spielern dasselbe Ergebnis, egal wer zuerst kam.
 */
export function mergePersistentBaseComposite(
  input: PersistentBaseCompositeMergeInput,
): PersistentBaseCompositeMergeResult {
  const candidates: PersistentCompositeCandidate[] = [];
  if (input.hostContribution) appendContribution(candidates, input.hostContribution, 'host');
  const guests = [...(input.guestContributions ?? [])]
    .filter((contribution) => contribution.ownerId !== input.hostContribution?.ownerId)
    .sort((left, right) => compareIds(left.ownerId, right.ownerId));
  for (const contribution of guests) appendContribution(candidates, contribution, 'guest');

  const occupied = new Set<string>(input.reservedCells ?? []);
  const usedCapacity = new Map<string, number>();
  const active: PersistentCompositeActiveEntry[] = [];
  const conflicts: PersistentCompositeConflict[] = [];

  for (const candidate of candidates) {
    const toolId = candidate.blueprint.tool.id;
    const tool = input.resolveTool(candidate.ownerId, toolId);
    if (!tool) {
      conflicts.push(conflict(candidate, 'unknown-tool'));
      continue;
    }
    if (tool.unavailableReason) {
      conflicts.push(conflict(candidate, tool.unavailableReason));
      continue;
    }

    const gridX = input.anchor.gridX + candidate.blueprint.relativeGridX;
    const gridY = input.anchor.gridY + candidate.blueprint.relativeGridY;
    const footprint = tool.footprint.length > 0 ? tool.footprint : [{ dx: 0, dy: 0 }];

    // Jede Zelle des Fussabdrucks muss im Baubereich liegen, nicht nur der Ursprung.
    const insideBuildArea = footprint.every((offset) => isCellInsidePersistentBaseBuildArea(
      gridX + offset.dx - input.anchor.gridX,
      gridY + offset.dy - input.anchor.gridY,
      input.buildArea,
    ));
    if (!insideBuildArea) {
      conflicts.push(conflict(candidate, 'outside-build-area'));
      continue;
    }

    const cells = footprint.map((offset) => cellKey(gridX + offset.dx, gridY + offset.dy));
    if (input.isCellBlocked
      && footprint.some((offset) => input.isCellBlocked!(gridX + offset.dx, gridY + offset.dy))) {
      conflicts.push(conflict(candidate, 'authored-collision'));
      continue;
    }
    if (cells.some((key) => occupied.has(key))) {
      conflicts.push(conflict(candidate, 'collision'));
      continue;
    }

    const capacityMax = input.capacityMaxByOwner?.get(candidate.ownerId);
    const nextUsed = (usedCapacity.get(candidate.ownerId) ?? 0) + Math.max(0, tool.capacityCost);
    if (capacityMax !== undefined && nextUsed > capacityMax) {
      conflicts.push(conflict(candidate, 'capacity'));
      continue;
    }

    usedCapacity.set(candidate.ownerId, nextUsed);
    for (const key of cells) occupied.add(key);
    active.push({
      ...candidate,
      footprint,
      gridX,
      gridY,
      capacityCost: Math.max(0, tool.capacityCost),
    });
  }

  const conflictsByOwner = new Map<string, PersistentCompositeConflict[]>();
  for (const item of conflicts) {
    const ownerConflicts = conflictsByOwner.get(item.ownerId) ?? [];
    ownerConflicts.push(item);
    conflictsByOwner.set(item.ownerId, ownerConflicts);
  }
  return { active, conflicts, conflictsByOwner };
}

function appendContribution(
  target: PersistentCompositeCandidate[],
  contribution: PersistentPlayerBaseContribution,
  source: PersistentCompositeSource,
): void {
  const ordered = [...contribution.constructions].sort(comparePersistentConstructions);
  for (const blueprint of ordered) {
    target.push({ blueprint, ownerId: contribution.ownerId, source });
  }
}

/** Innerhalb eines Beitrags entscheidet die Bau-Reihenfolge, bei Gleichstand die stabile ID. */
function comparePersistentConstructions(
  left: PersistentConstruction,
  right: PersistentConstruction,
): number {
  return left.placementOrder - right.placementOrder
    || compareIds(left.persistentId, right.persistentId);
}

function compareIds(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function cellKey(gridX: number, gridY: number): string {
  return `${gridX}:${gridY}`;
}

function conflict(
  candidate: PersistentCompositeCandidate,
  reason: PersistentCompositeConflictReason,
): PersistentCompositeConflict {
  return {
    ownerId: candidate.ownerId,
    persistentId: candidate.blueprint.persistentId,
    toolId: candidate.blueprint.tool.id,
    reason,
  };
}
