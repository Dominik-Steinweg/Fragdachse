import type { SyncedPlaceableRock } from '../types';
import {
  clonePersistentBaseState,
  normalizePersistentToolRef,
  type PersistentBaseAnchor,
  type PersistentConstruction,
  type PersistentToolRef,
} from './PersistentBaseTypes';
import { isPersistentFootprintInsideZone } from './PersistentBaseZone';

export interface GuestPersistentConstruction extends PersistentConstruction {
  readonly ownerId: string;
}

/**
 * Host-only, room-scoped guest blueprint state. It intentionally has no repository/localStorage
 * dependency: the state survives ArenaScene teardown/map changes, but dies with the room or the
 * guest owner. A mission starts from a baseline and commits only live runtime objects on victory.
 */
export class PersistentBaseRoomState {
  private committed = new Map<string, GuestPersistentConstruction[]>();
  private baseline: Map<string, GuestPersistentConstruction[]> | null = null;
  private working: Map<string, GuestPersistentConstruction[]> | null = null;
  private readonly runtimeBlueprints = new Map<number, GuestPersistentConstruction>();
  private nextPlacementOrder = 0;
  private newIdCounter = 0;

  get hasActiveMission(): boolean {
    return this.working !== null;
  }

  beginMission(): void {
    if (this.working) return;
    this.baseline = cloneGuestMap(this.committed);
    this.working = cloneGuestMap(this.committed);
    this.runtimeBlueprints.clear();
  }

  getCommittedBlueprints(): readonly GuestPersistentConstruction[] {
    return flattenGuestMap(this.committed);
  }

  getWorkingBlueprints(): readonly GuestPersistentConstruction[] {
    return flattenGuestMap(this.working ?? this.committed);
  }

  registerRestored(blueprint: GuestPersistentConstruction, runtimeId: number): void {
    if (!this.working) return;
    this.runtimeBlueprints.set(runtimeId, cloneGuestBlueprint(blueprint));
  }

  registerNew(
    runtimeRock: SyncedPlaceableRock,
    ownerId: string,
    tool: PersistentToolRef,
    footprint: readonly { readonly dx: number; readonly dy: number }[],
    anchor: PersistentBaseAnchor,
    activeRadiusCells: number,
  ): GuestPersistentConstruction | null {
    if (!this.working
      || !ownerId
      || runtimeRock.ownerId !== ownerId
      || runtimeRock.expiresAt > 0
      || !isPersistentFootprintInsideZone(
        runtimeRock.gridX,
        runtimeRock.gridY,
        footprint,
        anchor,
        activeRadiusCells,
      )) return null;

    const placementOrder = this.nextPlacementOrder++;
    let persistentId = `guest-pb-${placementOrder}`;
    while (this.hasPersistentId(persistentId)) {
      this.newIdCounter += 1;
      persistentId = `guest-pb-${placementOrder}-${this.newIdCounter}`;
    }
    const blueprint: GuestPersistentConstruction = {
      persistentId,
      ownerId,
      tool: normalizePersistentToolRef(tool),
      relativeGridX: runtimeRock.gridX - anchor.gridX,
      relativeGridY: runtimeRock.gridY - anchor.gridY,
      angle: Number.isFinite(runtimeRock.angle) ? runtimeRock.angle : 0,
      placementOrder,
    };
    const ownerBlueprints = this.working.get(ownerId) ?? [];
    ownerBlueprints.push(blueprint);
    this.working.set(ownerId, ownerBlueprints);
    this.runtimeBlueprints.set(runtimeRock.id, cloneGuestBlueprint(blueprint));
    return cloneGuestBlueprint(blueprint);
  }

  /**
   * Removes an owner from committed and current mission state. Runtime IDs are returned so the
   * lifecycle coordinator can remove the corresponding host-side construction exactly once.
   */
  removeGuestSessionOwner(ownerId: string): readonly number[] {
    this.committed.delete(ownerId);
    this.baseline?.delete(ownerId);
    this.working?.delete(ownerId);
    const runtimeIds: number[] = [];
    for (const [runtimeId, blueprint] of this.runtimeBlueprints) {
      if (blueprint.ownerId !== ownerId) continue;
      runtimeIds.push(runtimeId);
      this.runtimeBlueprints.delete(runtimeId);
    }
    return runtimeIds;
  }

  /** Keeps live guest blueprints while an ArenaScene/map is torn down. */
  detachRuntimeObjects(isRuntimeObjectAlive: (runtimeId: number) => boolean): void {
    if (!this.working) return;
    for (const [runtimeId, blueprint] of this.runtimeBlueprints) {
      if (isRuntimeObjectAlive(runtimeId)) continue;
      removeBlueprint(this.working, blueprint);
    }
    this.runtimeBlueprints.clear();
  }

  commit(isRuntimeObjectAlive: (runtimeId: number) => boolean): void {
    if (!this.working || !this.baseline) return;
    const next = new Map<string, GuestPersistentConstruction[]>();
    for (const [, blueprints] of this.baseline) {
      for (const blueprint of blueprints) {
        if (!findBlueprint(this.working, blueprint.ownerId, blueprint.persistentId)) continue;
        const runtimeId = findRuntimeId(this.runtimeBlueprints, blueprint);
        if (runtimeId === undefined || isRuntimeObjectAlive(runtimeId)) appendGuest(next, blueprint);
      }
    }
    for (const blueprint of flattenGuestMap(this.working)) {
      const baselineBlueprint = findBlueprint(this.baseline, blueprint.ownerId, blueprint.persistentId);
      if (baselineBlueprint) continue;
      const runtimeId = findRuntimeId(this.runtimeBlueprints, blueprint);
      if (runtimeId === undefined || isRuntimeObjectAlive(runtimeId)) appendGuest(next, blueprint);
    }
    for (const blueprints of next.values()) {
      blueprints.sort(compareGuestBlueprints);
    }
    this.committed = next;
    this.baseline = null;
    this.working = null;
    this.runtimeBlueprints.clear();
  }

  rollback(): void {
    if (this.baseline) this.committed = cloneGuestMap(this.baseline);
    this.baseline = null;
    this.working = null;
    this.runtimeBlueprints.clear();
  }

  discardMission(): void {
    this.baseline = null;
    this.working = null;
    this.runtimeBlueprints.clear();
  }

  private hasPersistentId(persistentId: string): boolean {
    return [...this.committed.values(), ...(this.working ? [...this.working.values()] : [])]
      .some((entries) => entries.some((entry) => entry.persistentId === persistentId));
  }
}

function appendGuest(
  map: Map<string, GuestPersistentConstruction[]>,
  blueprint: GuestPersistentConstruction,
): void {
  const entries = map.get(blueprint.ownerId) ?? [];
  if (!entries.some((entry) => entry.persistentId === blueprint.persistentId)) entries.push(cloneGuestBlueprint(blueprint));
  map.set(blueprint.ownerId, entries);
}

function removeBlueprint(
  map: Map<string, GuestPersistentConstruction[]>,
  blueprint: GuestPersistentConstruction,
): void {
  const entries = map.get(blueprint.ownerId);
  if (!entries) return;
  const remaining = entries.filter((entry) => entry.persistentId !== blueprint.persistentId);
  if (remaining.length === 0) map.delete(blueprint.ownerId);
  else map.set(blueprint.ownerId, remaining);
}

function findRuntimeId(
  runtimeBlueprints: ReadonlyMap<number, GuestPersistentConstruction>,
  blueprint: GuestPersistentConstruction,
): number | undefined {
  for (const [runtimeId, candidate] of runtimeBlueprints) {
    if (candidate.ownerId === blueprint.ownerId && candidate.persistentId === blueprint.persistentId) return runtimeId;
  }
  return undefined;
}

function findBlueprint(
  map: ReadonlyMap<string, readonly GuestPersistentConstruction[]>,
  ownerId: string,
  persistentId: string,
): GuestPersistentConstruction | undefined {
  return map.get(ownerId)?.find((entry) => entry.persistentId === persistentId);
}

function flattenGuestMap(map: ReadonlyMap<string, readonly GuestPersistentConstruction[]>): GuestPersistentConstruction[] {
  return [...map.values()]
    .flatMap((entries) => entries.map(cloneGuestBlueprint))
    .sort(compareGuestBlueprints);
}

function cloneGuestMap(
  map: ReadonlyMap<string, readonly GuestPersistentConstruction[]>,
): Map<string, GuestPersistentConstruction[]> {
  return new Map([...map.entries()].map(([ownerId, entries]) => [
    ownerId,
    entries.map(cloneGuestBlueprint),
  ]));
}

function cloneGuestBlueprint(blueprint: GuestPersistentConstruction): GuestPersistentConstruction {
  return { ...blueprint, tool: { ...blueprint.tool } };
}

function compareGuestBlueprints(left: GuestPersistentConstruction, right: GuestPersistentConstruction): number {
  return left.placementOrder - right.placementOrder
    || (left.ownerId < right.ownerId ? -1 : left.ownerId > right.ownerId ? 1 : 0)
    || (left.persistentId < right.persistentId ? -1 : left.persistentId > right.persistentId ? 1 : 0);
}
