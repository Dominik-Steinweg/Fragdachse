import type { SyncedPlaceableRock } from '../types';
import type { PersistentBaseRepositoryPort } from './PersistentBaseRepository';
import {
  clonePersistentBaseState,
  type PersistentBaseAnchor,
  type PersistentBaseState,
  type PersistentConstruction,
  type PersistentRuntimeMetadata,
  type PersistentToolRef,
  normalizePersistentToolRef,
} from './PersistentBaseTypes';
import {
  isPersistentFootprintInsideZone,
  type PersistentBaseBuildAreaInput,
} from './PersistentBaseZone';
import {
  DEFAULT_PERSISTENT_BASE_BUILD_AREA,
  type PersistentBaseBuildArea,
} from './PersistentBaseCore';

export interface PersistentBaseSessionOptions {
  readonly anchor: PersistentBaseAnchor;
  /** Historischer Radiusweg; neue World-Sites uebergeben `activeBuildArea`. */
  readonly activeRadiusCells?: number;
  readonly activeBuildArea?: PersistentBaseBuildArea;
  readonly ownerId: string;
}

/**
 * Mission-local working copy. It records runtime identity only in memory; commit derives the new
 * long-term blueprint list from live runtime objects and therefore never saves HP or cooldowns.
 */
export class PersistentBaseSession {
  private readonly baseline: PersistentBaseState;
  private anchor: PersistentBaseAnchor;
  private activeRadiusCells: number;
  private activeBuildArea: PersistentBaseBuildAreaInput;
  private readonly ownerId: string;
  private readonly baselineRuntimeIds = new Map<string, number>();
  private readonly runtimeBlueprints = new Map<number, PersistentConstruction>();
  private readonly detachedRuntimeIds = new Set<number>();
  private readonly removedBaselineIds = new Set<string>();
  private nextPlacementOrder: number;
  private newIdCounter = 0;

  constructor(
    private readonly repository: PersistentBaseRepositoryPort,
    options: PersistentBaseSessionOptions,
    committedState = repository.load(),
  ) {
    this.baseline = clonePersistentBaseState(committedState);
    this.anchor = { ...options.anchor };
    this.activeRadiusCells = options.activeRadiusCells
      ?? (options.activeBuildArea?.kind === 'radius' ? options.activeBuildArea.radiusCells : 1);
    this.activeBuildArea = options.activeBuildArea
      ?? (options.activeRadiusCells === undefined
        ? DEFAULT_PERSISTENT_BASE_BUILD_AREA
        : { kind: 'radius', radiusCells: options.activeRadiusCells });
    this.ownerId = options.ownerId;
    this.nextPlacementOrder = this.baseline.constructions.reduce(
      (max, entry) => Math.max(max, entry.placementOrder),
      -1,
    ) + 1;
  }

  get committedState(): PersistentBaseState {
    return clonePersistentBaseState(this.baseline);
  }

  /** Working state used when a round crosses a map boundary before its outcome is known. */
  get workingState(): PersistentBaseState {
    const byId = new Map<string, PersistentConstruction>();
    for (const blueprint of this.baseline.constructions) {
      if (!this.removedBaselineIds.has(blueprint.persistentId)) byId.set(blueprint.persistentId, blueprint);
    }
    for (const blueprint of this.runtimeBlueprints.values()) {
      if (!this.baselineRuntimeIds.has(blueprint.persistentId)) byId.set(blueprint.persistentId, blueprint);
    }
    const constructions = [...byId.values()].sort(comparePersistentConstructions);
    return { ...this.baseline, constructions: constructions.map((entry) => ({ ...entry, tool: { ...entry.tool } })) };
  }

  get radiusCells(): number {
    return this.activeRadiusCells;
  }

  get buildArea(): PersistentBaseBuildAreaInput {
    return this.activeBuildArea;
  }

  rebindArena(
    anchor: PersistentBaseAnchor,
    activeRadiusCells: number,
    activeBuildArea?: PersistentBaseBuildArea,
  ): void {
    this.anchor = { ...anchor };
    this.activeRadiusCells = activeRadiusCells;
    this.activeBuildArea = activeBuildArea ?? { kind: 'radius', radiusCells: activeRadiusCells };
  }

  registerRestored(blueprint: PersistentConstruction, runtimeId: number): void {
    for (const [existingRuntimeId, existing] of this.runtimeBlueprints) {
      if (existing.persistentId !== blueprint.persistentId) continue;
      this.runtimeBlueprints.delete(existingRuntimeId);
      this.detachedRuntimeIds.delete(existingRuntimeId);
    }
    if (this.baseline.constructions.some((entry) => entry.persistentId === blueprint.persistentId)) {
      this.baselineRuntimeIds.set(blueprint.persistentId, runtimeId);
    }
    this.runtimeBlueprints.set(runtimeId, blueprint);
  }

  registerNew(
    runtimeRock: SyncedPlaceableRock,
    tool: PersistentToolRef,
    footprint: readonly { readonly dx: number; readonly dy: number }[],
  ): PersistentRuntimeMetadata | null {
    if (runtimeRock.ownerId !== this.ownerId
      || runtimeRock.expiresAt > 0
      || !isPersistentFootprintInsideZone(
        runtimeRock.gridX,
        runtimeRock.gridY,
        footprint,
        this.anchor,
        this.activeBuildArea,
      )) return null;

    const placementOrder = this.nextPlacementOrder++;
    let persistentId = `pb-${this.baseline.revision + 1}-${placementOrder}`;
    while (
      this.baseline.constructions.some((entry) => entry.persistentId === persistentId)
      || [...this.runtimeBlueprints.values()].some((entry) => entry.persistentId === persistentId)
    ) {
      this.newIdCounter += 1;
      persistentId = `pb-${this.baseline.revision + 1}-${placementOrder}-${this.newIdCounter}`;
    }
    const blueprint: PersistentConstruction = {
      persistentId,
      tool: normalizePersistentToolRef(tool),
      relativeGridX: runtimeRock.gridX - this.anchor.gridX,
      relativeGridY: runtimeRock.gridY - this.anchor.gridY,
      angle: Number.isFinite(runtimeRock.angle) ? runtimeRock.angle : 0,
      placementOrder,
    };
    this.runtimeBlueprints.set(runtimeRock.id, blueprint);
    return { persistentId, placementOrder, origin: 'new' };
  }

  getRuntimeMetadata(runtimeId: number): PersistentRuntimeMetadata | null {
    const blueprint = this.runtimeBlueprints.get(runtimeId);
    if (!blueprint) return null;
    return {
      persistentId: blueprint.persistentId,
      placementOrder: blueprint.placementOrder,
      origin: this.baselineRuntimeIds.has(blueprint.persistentId) ? 'restored' : 'new',
    };
  }

  commit(isRuntimeObjectAlive: (runtimeId: number) => boolean): PersistentBaseState {
    const constructions: PersistentConstruction[] = [];
    for (const blueprint of this.baseline.constructions) {
      if (this.removedBaselineIds.has(blueprint.persistentId)) continue;
      const runtimeId = this.baselineRuntimeIds.get(blueprint.persistentId);
      // Entries that were dormant at mission start have no runtime ID and survive unchanged.
      if (runtimeId === undefined || this.detachedRuntimeIds.has(runtimeId) || isRuntimeObjectAlive(runtimeId)) {
        constructions.push({ ...blueprint, tool: { ...blueprint.tool } });
      }
    }
    for (const [runtimeId, blueprint] of this.runtimeBlueprints) {
      if (this.baselineRuntimeIds.has(blueprint.persistentId)) continue;
      if (this.detachedRuntimeIds.has(runtimeId) || isRuntimeObjectAlive(runtimeId)) {
        constructions.push({ ...blueprint, tool: { ...blueprint.tool } });
      }
    }
    constructions.sort((left, right) => (
      left.placementOrder - right.placementOrder
        || comparePersistentIds(left.persistentId, right.persistentId)
    ));
    const nextState: PersistentBaseState = {
      ...this.baseline,
      revision: this.baseline.revision + 1,
      constructions,
    };
    this.repository.save(nextState);
    return nextState;
  }

  discard(): void {
    this.baselineRuntimeIds.clear();
    this.runtimeBlueprints.clear();
    this.detachedRuntimeIds.clear();
    this.removedBaselineIds.clear();
  }

  /** Detaches live runtime IDs while preserving the mission working copy for another map. */
  detachRuntimeObjects(isRuntimeObjectAlive: (runtimeId: number) => boolean): void {
    for (const [persistentId, runtimeId] of this.baselineRuntimeIds) {
      if (isRuntimeObjectAlive(runtimeId)) this.detachedRuntimeIds.add(runtimeId);
      else {
        this.baselineRuntimeIds.delete(persistentId);
        this.removedBaselineIds.add(persistentId);
      }
    }
    for (const [runtimeId, blueprint] of this.runtimeBlueprints) {
      if (this.baselineRuntimeIds.get(blueprint.persistentId) === runtimeId) continue;
      if (isRuntimeObjectAlive(runtimeId)) this.detachedRuntimeIds.add(runtimeId);
      else {
        this.runtimeBlueprints.delete(runtimeId);
        this.detachedRuntimeIds.delete(runtimeId);
      }
    }
  }
}

function comparePersistentConstructions(left: PersistentConstruction, right: PersistentConstruction): number {
  return left.placementOrder - right.placementOrder || comparePersistentIds(left.persistentId, right.persistentId);
}

function comparePersistentIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
