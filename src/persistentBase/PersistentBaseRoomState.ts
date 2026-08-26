import type { SyncedPlaceableRock } from '../types';
import {
  clonePersistentBaseState,
  normalizePersistentToolRef,
  type PersistentBaseAnchor,
  type PersistentConstruction,
  type PersistentPlayerBaseContribution,
  type PersistentToolRef,
} from './PersistentBaseTypes';
import { isPersistentFootprintInsideZone } from './PersistentBaseZone';

export interface GuestPersistentConstruction extends PersistentConstruction {
  readonly ownerId: string;
  /** Stable device owner used for deterministic guest ordering and conflict reporting. */
  readonly stableOwnerId?: string;
}

/**
 * Host-only, room-scoped guest blueprint state. It intentionally has no repository/localStorage
 * dependency: the state survives ArenaScene teardown/map changes, but dies with the room or the
 * guest owner. A mission starts from a baseline and commits only live runtime objects on victory.
 */
export class PersistentBaseRoomState {
  private committed = new Map<string, GuestPersistentConstruction[]>();
  private committedOwnerIds = new Map<string, string>();
  private committedRevisions = new Map<string, number>();
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

  /** Replaces the room's guest baseline with currently connected players' local contributions. */
  hydratePersonalContributions(
    contributions: readonly { readonly playerId: string; readonly contribution: PersistentPlayerBaseContribution }[],
  ): void {
    const next = new Map<string, GuestPersistentConstruction[]>();
    this.committedOwnerIds.clear();
    this.committedRevisions.clear();
    for (const entry of contributions) {
      const blueprints = entry.contribution.constructions.map((construction) => ({
        ...construction,
        ownerId: entry.playerId,
        stableOwnerId: entry.contribution.ownerId,
        tool: { ...construction.tool },
      }));
      next.set(entry.playerId, blueprints);
      this.committedOwnerIds.set(entry.playerId, entry.contribution.ownerId);
      this.committedRevisions.set(entry.playerId, entry.contribution.revision);
    }
    this.committed = next;
    if (this.working) {
      this.baseline = cloneGuestMap(next);
      this.working = cloneGuestMap(next);
    }
  }

  getCommittedPersonalContributions(): PersistentPlayerBaseContribution[] {
    return this.getCommittedPersonalContributionsByPlayer().map((entry) => entry.contribution);
  }

  getCommittedPersonalContributionsByPlayer(): readonly {
    readonly playerId: string;
    readonly contribution: PersistentPlayerBaseContribution;
  }[] {
    return [...this.committed.entries()].map(([playerId, blueprints]) => {
      const ownerId = this.committedOwnerIds.get(playerId) ?? blueprints[0]?.stableOwnerId ?? playerId;
      return {
        playerId,
        contribution: {
          schemaVersion: 4,
          ownerId,
          revision: this.committedRevisions.get(playerId) ?? 0,
          constructions: blueprints.map(({ ownerId: _ownerId, stableOwnerId: _stableOwnerId, ...blueprint }) => ({
            ...blueprint,
            ownerId,
            tool: { ...blueprint.tool },
          })),
        },
      };
    });
  }

  updateRuntimePlacement(runtimeId: number, gridX: number, gridY: number, angle: number, anchor: PersistentBaseAnchor): boolean {
    const current = this.runtimeBlueprints.get(runtimeId);
    if (!current) return false;
    this.runtimeBlueprints.set(runtimeId, {
      ...current,
      relativeGridX: gridX - anchor.gridX,
      relativeGridY: gridY - anchor.gridY,
      angle: Number.isFinite(angle) ? angle : current.angle,
    });
    return true;
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
    stableOwnerId = ownerId,
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
      stableOwnerId,
    };
    return this.registerAccepted(
      runtimeRock,
      blueprint,
      ownerId,
      stableOwnerId,
      footprint,
      anchor,
      activeRadiusCells,
    );
  }

  registerAccepted(
    runtimeRock: SyncedPlaceableRock,
    blueprint: PersistentConstruction,
    ownerId: string,
    stableOwnerId: string,
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
      )
      || this.hasPersistentId(blueprint.persistentId)) return null;
    const accepted: GuestPersistentConstruction = {
      ...blueprint,
      ownerId,
      stableOwnerId,
      tool: normalizePersistentToolRef(blueprint.tool),
    };
    const ownerBlueprints = this.working.get(ownerId) ?? [];
    ownerBlueprints.push(accepted);
    this.working.set(ownerId, ownerBlueprints);
    this.nextPlacementOrder = Math.max(this.nextPlacementOrder, accepted.placementOrder + 1);
    this.runtimeBlueprints.set(runtimeRock.id, cloneGuestBlueprint(accepted));
    return cloneGuestBlueprint(accepted);
  }

  removeRuntimePlacement(runtimeId: number): boolean {
    const blueprint = this.runtimeBlueprints.get(runtimeId);
    if (!blueprint) return false;
    this.runtimeBlueprints.delete(runtimeId);
    removeBlueprint(this.working ?? this.committed, blueprint);
    return true;
  }

  getWorkingPersonalContributionsByPlayer(): readonly {
    readonly playerId: string;
    readonly contribution: PersistentPlayerBaseContribution;
  }[] {
    return [...(this.working ?? this.committed).entries()].map(([playerId, blueprints]) => ({
      playerId,
      contribution: {
        schemaVersion: 4,
        ownerId: this.committedOwnerIds.get(playerId) ?? blueprints[0]?.stableOwnerId ?? playerId,
        revision: this.committedRevisions.get(playerId) ?? 0,
        constructions: blueprints.map(({ ownerId: _ownerId, stableOwnerId: _stableOwnerId, ...blueprint }) => ({
          ...blueprint,
          ownerId: this.committedOwnerIds.get(playerId) ?? blueprints[0]?.stableOwnerId ?? playerId,
          tool: { ...blueprint.tool },
        })),
      },
    }));
  }

  /**
   * Removes an owner from committed and current mission state. Runtime IDs are returned so the
   * lifecycle coordinator can remove the corresponding host-side construction exactly once.
   */
  removeGuestSessionOwner(ownerId: string): readonly number[] {
    this.committed.delete(ownerId);
    this.committedOwnerIds.delete(ownerId);
    this.committedRevisions.delete(ownerId);
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
    const ownerIds = new Set([...this.committed.keys(), ...next.keys()]);
    for (const playerId of ownerIds) {
      const previous = this.committed.get(playerId) ?? [];
      const updated = next.get(playerId) ?? [];
      if (!sameGuestBlueprints(previous, updated)) {
        this.committedRevisions.set(
          playerId,
          (this.committedRevisions.get(playerId) ?? 0) + 1,
        );
      }
      const ownerId = updated[0]?.stableOwnerId
        ?? previous[0]?.stableOwnerId
        ?? this.committedOwnerIds.get(playerId)
        ?? playerId;
      this.committedOwnerIds.set(playerId, ownerId);
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
    || ((left.stableOwnerId ?? left.ownerId) < (right.stableOwnerId ?? right.ownerId) ? -1
      : (left.stableOwnerId ?? left.ownerId) > (right.stableOwnerId ?? right.ownerId) ? 1 : 0)
    || (left.persistentId < right.persistentId ? -1 : left.persistentId > right.persistentId ? 1 : 0);
}

function sameGuestBlueprints(
  left: readonly GuestPersistentConstruction[],
  right: readonly GuestPersistentConstruction[],
): boolean {
  if (left.length !== right.length) return false;
  const orderedLeft = [...left].sort(compareGuestBlueprints);
  const orderedRight = [...right].sort(compareGuestBlueprints);
  return orderedLeft.every((entry, index) => {
    const candidate = orderedRight[index];
    return entry.persistentId === candidate.persistentId
      && entry.ownerId === candidate.ownerId
      && entry.stableOwnerId === candidate.stableOwnerId
      && entry.placementOrder === candidate.placementOrder
      && entry.relativeGridX === candidate.relativeGridX
      && entry.relativeGridY === candidate.relativeGridY
      && entry.angle === candidate.angle
      && entry.tool.kind === candidate.tool.kind
      && entry.tool.id === candidate.tool.id;
  });
}
