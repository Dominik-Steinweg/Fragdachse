import {
  DEFAULT_PERSISTENT_BASE_RADIUS_CELLS,
  MAX_PERSISTENT_BASE_RADIUS_CELLS,
  MAX_PERSISTENT_CONSTRUCTIONS_PER_CONTRIBUTION,
  PERSISTENT_BASE_STATE_SCHEMA_VERSION,
  PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
} from '../config/persistentBase';
import { normalizeConstructionId } from '../config/coopDefenseConstructions';

export type PersistentToolKind = 'construction' | 'utility';

export interface PersistentToolRef {
  readonly kind: PersistentToolKind;
  readonly id: string;
}

export interface PersistentConstruction {
  readonly persistentId: string;
  readonly tool: PersistentToolRef;
  readonly relativeGridX: number;
  readonly relativeGridY: number;
  readonly angle: number;
  readonly placementOrder: number;
}

export interface PersistentBaseState {
  readonly schemaVersion: typeof PERSISTENT_BASE_STATE_SCHEMA_VERSION;
  readonly radiusCells: number;
  readonly revision: number;
  readonly constructions: readonly PersistentConstruction[];
}

/**
 * Der persoenliche, geraetelokale Beitrag eines Spielers zur persistenten Basis.
 *
 * Verbindlicher Zweck: **Es gibt genau einen Besitzpfad fuer persoenliche Konstruktionen**,
 * unabhaengig davon, ob der Besitzer gerade Host oder Gast ist. Der Beitrag gehoert dem Spieler
 * und reist mit ihm in jeden Raum; welche seiner Konstruktionen dort tatsaechlich stehen,
 * entscheidet allein der Host des jeweiligen Raums.
 *
 * Die ownerId ist eine dauerhafte Geraete-/Profilidentitaet und darf niemals aus Peer-ID,
 * Room-ID oder Session abgeleitet werden - sonst waere derselbe Spieler in zwei Raeumen zwei
 * verschiedene Besitzer.
 */
export interface PersistentPlayerBaseContribution {
  readonly schemaVersion: typeof PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION;
  readonly ownerId: string;
  /**
   * Monotone Revision genau dieses Beitrags. Sie sichert die Konsistenz zwischen Besitzer und
   * Host und ist ausdruecklich weder eine World- noch eine Activity-Revision.
   */
  readonly revision: number;
  readonly constructions: readonly PersistentConstruction[];
}

export const DEFAULT_PERSISTENT_PLAYER_BASE_CONTRIBUTION: PersistentPlayerBaseContribution = Object.freeze({
  schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
  ownerId: '',
  revision: 0,
  constructions: Object.freeze([]),
});

export function clonePersistentPlayerBaseContribution(
  contribution: PersistentPlayerBaseContribution,
): PersistentPlayerBaseContribution {
  return {
    schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
    ownerId: contribution.ownerId,
    revision: contribution.revision,
    constructions: contribution.constructions.map(clonePersistentConstruction),
  };
}

/**
 * Grenze fuer Speicher **und** Netzwerk: Ein Beitrag kommt entweder vollstaendig gueltig an oder
 * gar nicht. Bekannte Tool-IDs, Freischaltungen, Weltgeometrie und Kollisionen werden hier
 * bewusst nicht geprueft - das entscheidet der Composite-Merge beim Host.
 */
export function sanitizePersistentPlayerBaseContribution(
  value: unknown,
): PersistentPlayerBaseContribution | null {
  if (!isRecord(value)
    || value.schemaVersion !== PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION
    || !isStableOwnerId(value.ownerId)
    || !isSafeIntegerInRange(value.revision, 0, Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  const constructions = sanitizePersistentConstructions(value.constructions);
  if (!constructions) return null;
  return {
    schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
    ownerId: value.ownerId,
    revision: value.revision,
    constructions,
  };
}

/** Eine Besitzeridentitaet ist ein nicht leerer, laengenbegrenzter String - sonst nichts. */
export function isStableOwnerId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

export type PersistentPlacementOrigin = 'restored' | 'new';

export interface PersistentRuntimeMetadata {
  readonly persistentId: string;
  readonly placementOrder: number;
  readonly origin: PersistentPlacementOrigin;
}

/** Normalizes historical utility/Coop aliases at the persistence boundary only. */
export function normalizePersistentToolRef(tool: PersistentToolRef): PersistentToolRef {
  const constructionId = normalizeConstructionId(tool.id);
  return constructionId ? { kind: 'construction', id: constructionId } : { ...tool };
}

export interface PersistentBaseAnchor {
  readonly gridX: number;
  readonly gridY: number;
}

export const DEFAULT_PERSISTENT_BASE_STATE: PersistentBaseState = Object.freeze({
  schemaVersion: PERSISTENT_BASE_STATE_SCHEMA_VERSION,
  radiusCells: DEFAULT_PERSISTENT_BASE_RADIUS_CELLS,
  revision: 0,
  constructions: Object.freeze([]),
});

export function clonePersistentConstruction(construction: PersistentConstruction): PersistentConstruction {
  return {
    persistentId: construction.persistentId,
    tool: normalizePersistentToolRef(construction.tool),
    relativeGridX: construction.relativeGridX,
    relativeGridY: construction.relativeGridY,
    angle: construction.angle,
    placementOrder: construction.placementOrder,
  };
}

export function clonePersistentBaseState(state: PersistentBaseState): PersistentBaseState {
  return {
    schemaVersion: PERSISTENT_BASE_STATE_SCHEMA_VERSION,
    radiusCells: state.radiusCells,
    revision: state.revision,
    constructions: state.constructions.map(clonePersistentConstruction),
  };
}

/**
 * Gemeinsame Blueprint-Validierung von Zustand und Beitrag.
 *
 * Eine einzige Liste mit doppelter persistentId, einem unbekannten Tool-Ref oder einem Wert
 * ausserhalb des zulaessigen Bereichs macht die gesamte Nutzlast ungueltig; teilweise
 * uebernommene Blueprints waeren stiller Datenverlust.
 */
export function sanitizePersistentConstructions(value: unknown): PersistentConstruction[] | null {
  if (!Array.isArray(value) || value.length > MAX_PERSISTENT_CONSTRUCTIONS_PER_CONTRIBUTION) return null;
  const seenIds = new Set<string>();
  const constructions: PersistentConstruction[] = [];
  for (const rawConstruction of value) {
    if (!isRecord(rawConstruction)
      || typeof rawConstruction.persistentId !== 'string'
      || rawConstruction.persistentId.trim().length === 0
      || rawConstruction.persistentId.length > 128
      || seenIds.has(rawConstruction.persistentId)
      || !isPersistentToolRef(rawConstruction.tool)
      || !isSafeIntegerInRange(rawConstruction.relativeGridX, -1_000_000, 1_000_000)
      || !isSafeIntegerInRange(rawConstruction.relativeGridY, -1_000_000, 1_000_000)
      || typeof rawConstruction.angle !== 'number'
      || !Number.isFinite(rawConstruction.angle)
      || !isSafeIntegerInRange(rawConstruction.placementOrder, 0, Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    seenIds.add(rawConstruction.persistentId);
    constructions.push({
      persistentId: rawConstruction.persistentId,
      tool: normalizePersistentToolRef(rawConstruction.tool),
      relativeGridX: rawConstruction.relativeGridX,
      relativeGridY: rawConstruction.relativeGridY,
      angle: rawConstruction.angle,
      placementOrder: rawConstruction.placementOrder,
    });
  }
  return constructions;
}

/**
 * Storage-only validation. Known tool IDs, unlocks, map geometry and collisions belong to the
 * restore planner and are deliberately not consulted here.
 */
export function sanitizePersistentBaseState(value: unknown): PersistentBaseState | null {
  if (!isRecord(value)
    || value.schemaVersion !== PERSISTENT_BASE_STATE_SCHEMA_VERSION
    || !isSafeIntegerInRange(value.radiusCells, 0, MAX_PERSISTENT_BASE_RADIUS_CELLS)
    || !isSafeIntegerInRange(value.revision, 0, Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  const constructions = sanitizePersistentConstructions(value.constructions);
  if (!constructions) return null;

  return {
    schemaVersion: PERSISTENT_BASE_STATE_SCHEMA_VERSION,
    radiusCells: value.radiusCells,
    revision: value.revision,
    constructions,
  };
}

function isPersistentToolRef(value: unknown): value is PersistentToolRef {
  return isRecord(value)
    && (value.kind === 'construction' || value.kind === 'utility')
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && value.id.length <= 128;
}

function isSafeIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= min
    && value <= max;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
