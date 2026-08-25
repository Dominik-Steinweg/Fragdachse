import type { SyncedPlaceableRock } from '../types';
import type { PersistentBaseRepositoryPort } from './PersistentBaseRepository';
import {
  clonePersistentBaseState,
  type PersistentBaseAnchor,
  type PersistentBaseState,
  type PersistentConstruction,
  type PersistentRuntimeMetadata,
  type PersistentToolRef,
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
  private readonly anchor: PersistentBaseAnchor;
  private readonly activeRadiusCells: number;
  private readonly ownerId: string;
  private readonly baselineRuntimeIds = new Map<string, number>();
  private readonly runtimeBlueprints = new Map<number, PersistentConstruction>();
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

  get radiusCells(): number {
    return this.activeRadiusCells;
  }

  registerRestored(blueprint: PersistentConstruction, runtimeId: number): void {
    this.baselineRuntimeIds.set(blueprint.persistentId, runtimeId);
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
      tool: { ...tool },
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
      const runtimeId = this.baselineRuntimeIds.get(blueprint.persistentId);
      // Entries that were dormant at mission start have no runtime ID and survive unchanged.
      if (runtimeId === undefined || isRuntimeObjectAlive(runtimeId)) {
        constructions.push({ ...blueprint, tool: { ...blueprint.tool } });
      }
    }
    for (const [runtimeId, blueprint] of this.runtimeBlueprints) {
      if (this.baselineRuntimeIds.has(blueprint.persistentId)) continue;
      if (isRuntimeObjectAlive(runtimeId)) constructions.push({ ...blueprint, tool: { ...blueprint.tool } });
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
  }
}

function comparePersistentIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
