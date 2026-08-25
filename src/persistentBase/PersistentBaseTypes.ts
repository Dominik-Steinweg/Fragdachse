import {
  DEFAULT_PERSISTENT_BASE_RADIUS_CELLS,
  MAX_PERSISTENT_BASE_RADIUS_CELLS,
  PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
  PERSISTENT_BASE_STATE_SCHEMA_VERSION,
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
  /** Stable owner on composite states; personal contributions carry it at the envelope level. */
  readonly ownerId?: string;
  /** Present only for host-owned persistent rewards. */
  readonly rewardId?: string;
}

export interface PersistentBaseState {
  readonly schemaVersion: typeof PERSISTENT_BASE_STATE_SCHEMA_VERSION;
  readonly radiusCells: number;
  readonly revision: number;
  readonly constructions: readonly PersistentConstruction[];
}

/** Device-local, host-independent contribution used by the Phase-3 composite merge. */
export interface PersistentPlayerBaseContribution {
  readonly schemaVersion: typeof PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION;
  readonly ownerId: string;
  readonly revision: number;
  readonly constructions: readonly PersistentConstruction[];
}

export const DEFAULT_PERSISTENT_PLAYER_BASE_CONTRIBUTION: PersistentPlayerBaseContribution = Object.freeze({
  schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
  ownerId: '',
  revision: 0,
  constructions: Object.freeze([]),
});

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

export function clonePersistentBaseState(state: PersistentBaseState): PersistentBaseState {
  return {
    schemaVersion: PERSISTENT_BASE_STATE_SCHEMA_VERSION,
    radiusCells: state.radiusCells,
    revision: state.revision,
    constructions: state.constructions.map((construction) => ({
      persistentId: construction.persistentId,
      tool: normalizePersistentToolRef(construction.tool),
      relativeGridX: construction.relativeGridX,
      relativeGridY: construction.relativeGridY,
      angle: construction.angle,
      placementOrder: construction.placementOrder,
      ...(construction.ownerId ? { ownerId: construction.ownerId } : {}),
      ...(construction.rewardId ? { rewardId: construction.rewardId } : {}),
    })),
  };
}

export function clonePersistentPlayerBaseContribution(
  contribution: PersistentPlayerBaseContribution,
): PersistentPlayerBaseContribution {
  return {
    schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
    ownerId: contribution.ownerId,
    revision: contribution.revision,
    constructions: contribution.constructions.map((construction) => ({
      persistentId: construction.persistentId,
      tool: normalizePersistentToolRef(construction.tool),
      relativeGridX: construction.relativeGridX,
      relativeGridY: construction.relativeGridY,
      angle: construction.angle,
      placementOrder: construction.placementOrder,
      ...(construction.ownerId ? { ownerId: construction.ownerId } : {}),
      ...(construction.rewardId ? { rewardId: construction.rewardId } : {}),
    })),
  };
}

export function sanitizePersistentPlayerBaseContribution(
  value: unknown,
): PersistentPlayerBaseContribution | null {
  if (!isRecord(value)
    || value.schemaVersion !== PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION
    || typeof value.ownerId !== 'string'
    || value.ownerId.trim().length === 0
    || value.ownerId.length > 128
    || !isSafeIntegerInRange(value.revision, 0, Number.MAX_SAFE_INTEGER)
    || !Array.isArray(value.constructions)
    || value.constructions.length > 512) {
    return null;
  }
  const seenIds = new Set<string>();
  const constructions: PersistentConstruction[] = [];
  for (const rawConstruction of value.constructions) {
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
    if (rawConstruction.ownerId !== undefined
      && (typeof rawConstruction.ownerId !== 'string' || rawConstruction.ownerId.length > 128)) return null;
    if (rawConstruction.rewardId !== undefined
      && (typeof rawConstruction.rewardId !== 'string' || rawConstruction.rewardId.length > 128)) return null;
    seenIds.add(rawConstruction.persistentId);
    constructions.push({
      persistentId: rawConstruction.persistentId,
      tool: normalizePersistentToolRef(rawConstruction.tool),
      relativeGridX: rawConstruction.relativeGridX,
      relativeGridY: rawConstruction.relativeGridY,
      angle: rawConstruction.angle,
      placementOrder: rawConstruction.placementOrder,
      ...(typeof rawConstruction.ownerId === 'string' ? { ownerId: rawConstruction.ownerId } : {}),
      ...(typeof rawConstruction.rewardId === 'string' ? { rewardId: rawConstruction.rewardId } : {}),
    });
  }
  return {
    schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
    ownerId: value.ownerId,
    revision: value.revision,
    constructions,
  };
}

/**
 * Storage-only validation. Known tool IDs, unlocks, map geometry and collisions belong to the
 * restore planner and are deliberately not consulted here.
 */
export function sanitizePersistentBaseState(value: unknown): PersistentBaseState | null {
  if (!isRecord(value)
    || value.schemaVersion !== PERSISTENT_BASE_STATE_SCHEMA_VERSION
    || !isSafeIntegerInRange(value.radiusCells, 0, MAX_PERSISTENT_BASE_RADIUS_CELLS)
    || !isSafeIntegerInRange(value.revision, 0, Number.MAX_SAFE_INTEGER)
    || !Array.isArray(value.constructions)
    || value.constructions.length > 512) {
    return null;
  }

  const seenIds = new Set<string>();
  const constructions: PersistentConstruction[] = [];
  for (const rawConstruction of value.constructions) {
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
