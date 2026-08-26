import type { SyncedPlaceableRock } from '../types';
import type { PersistentBaseRepositoryPort } from './PersistentBaseRepository';
import {
  clonePersistentBaseState,
  clonePersistentPlayerBaseContribution,
  type PersistentBaseAnchor,
  type PersistentBaseState,
  type PersistentConstruction,
  type PersistentPlayerBaseContribution,
  type PersistentRuntimeMetadata,
  type PersistentToolRef,
  normalizePersistentToolRef,
} from './PersistentBaseTypes';
import { isPersistentFootprintInsideZone } from './PersistentBaseZone';

export interface PersistentBaseSessionOptions {
  readonly anchor: PersistentBaseAnchor;
  readonly activeRadiusCells: number;
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
    this.activeRadiusCells = options.activeRadiusCells;
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

  getPersonalContribution(ownerId = this.ownerId): PersistentPlayerBaseContribution {
    return clonePersistentPlayerBaseContribution({
      schemaVersion: 4,
      ownerId,
      revision: this.baseline.revision,
      constructions: this.workingState.constructions.map((entry) => ({
        ...entry,
        ownerId: entry.ownerId ?? ownerId,
        tool: { ...entry.tool },
      })),
    });
  }

  getRuntimeIdForPersistentId(persistentId: string): number | null {
    return this.baselineRuntimeIds.get(persistentId)
      ?? [...this.runtimeBlueprints.entries()].find(([, blueprint]) => blueprint.persistentId === persistentId)?.[0]
      ?? null;
  }

  /** Updates the mission working copy only after the caller has validated the atomic move. */
  updateRuntimePlacement(runtimeId: number, gridX: number, gridY: number, angle: number): boolean {
    const current = this.runtimeBlueprints.get(runtimeId);
    if (!current) return false;
    const next = {
      ...current,
      relativeGridX: gridX - this.anchor.gridX,
      relativeGridY: gridY - this.anchor.gridY,
      angle: Number.isFinite(angle) ? angle : current.angle,
    };
    this.runtimeBlueprints.set(runtimeId, next);
    return true;
  }

  rebindArena(anchor: PersistentBaseAnchor, activeRadiusCells: number): void {
    this.anchor = { ...anchor };
    this.activeRadiusCells = activeRadiusCells;
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
    this.runtimeBlueprints.set(runtimeId, {
      ...blueprint,
      ownerId: blueprint.ownerId ?? this.ownerId,
      tool: { ...blueprint.tool },
    });
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
      this.activeRadiusCells,
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
      ownerId: this.ownerId,
    };
    return this.registerAccepted(runtimeRock, blueprint, footprint);
  }

  registerAccepted(
    runtimeRock: SyncedPlaceableRock,
    blueprint: PersistentConstruction,
    footprint: readonly { readonly dx: number; readonly dy: number }[],
  ): PersistentRuntimeMetadata | null {
    if (runtimeRock.expiresAt > 0
      || !isPersistentFootprintInsideZone(
        runtimeRock.gridX,
        runtimeRock.gridY,
        footprint,
        this.anchor,
        this.activeRadiusCells,
      )
      || this.baseline.constructions.some((entry) => entry.persistentId === blueprint.persistentId)
      || [...this.runtimeBlueprints.values()].some((entry) => entry.persistentId === blueprint.persistentId)) {
      return null;
    }
    const normalized = {
      ...blueprint,
      ownerId: blueprint.ownerId ?? this.ownerId,
      tool: { ...blueprint.tool },
    };
    this.nextPlacementOrder = Math.max(this.nextPlacementOrder, normalized.placementOrder + 1);
    this.runtimeBlueprints.set(runtimeRock.id, normalized);
    return {
      persistentId: normalized.persistentId,
      placementOrder: normalized.placementOrder,
      origin: 'new',
    };
  }

  removeRuntimePlacement(runtimeId: number): boolean {
    const blueprint = this.runtimeBlueprints.get(runtimeId);
    if (!blueprint) return false;
    this.runtimeBlueprints.delete(runtimeId);
    this.detachedRuntimeIds.delete(runtimeId);
    if (this.baselineRuntimeIds.get(blueprint.persistentId) === runtimeId) {
      this.baselineRuntimeIds.delete(blueprint.persistentId);
      this.removedBaselineIds.add(blueprint.persistentId);
    }
    return true;
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
