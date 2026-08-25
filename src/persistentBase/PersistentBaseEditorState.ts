import {
  getPersistentBaseRewardDefinition,
  type PersistentBaseRewardId,
  type PersistentBaseRewardPlacement,
  type PersistentBaseRewardRuntimeState,
} from '../config/persistentBaseRewards';
import type { LoadoutToolRef } from '../types';
import {
  clonePersistentPlayerBaseContribution,
  type PersistentBaseAnchor,
  type PersistentConstruction,
  type PersistentPlayerBaseContribution,
  type PersistentToolRef,
} from './PersistentBaseTypes';
import {
  mergePersistentBaseComposite,
  type PersistentBaseCompositeMergeResult,
  type PersistentCompositeActiveEntry,
  type PersistentCompositeCandidate,
  type PersistentCompositeConflict,
  type PersistentGridCellOffset,
} from './PersistentBaseComposite';
import { PersistentBaseRewardState } from './PersistentBaseRewardState';

export interface PersistentBaseEditorOptions {
  readonly ownerId: string;
  readonly anchor: PersistentBaseAnchor;
  readonly radiusCells: number;
  readonly resolveTool: (tool: PersistentToolRef) => {
    readonly footprint: readonly PersistentGridCellOffset[];
    readonly capacityCost?: number;
  } | null;
  readonly capacityMaxByOwner?: ReadonlyMap<string, number>;
  readonly authoredCells?: ReadonlySet<string>;
  readonly highestUnlockedMapId: string;
  readonly contributions?: readonly PersistentPlayerBaseContribution[];
  readonly rewardPlacements?: readonly PersistentBaseRewardPlacement[];
}

export interface PersistentBaseCompositeSnapshot {
  readonly schemaVersion: 4;
  readonly revision: number;
  readonly ownerId: string;
  readonly anchor: PersistentBaseAnchor;
  readonly radiusCells: number;
  readonly active: readonly PersistentCompositeActiveEntry[];
  readonly conflicts: readonly PersistentCompositeConflict[];
  readonly rewards: readonly PersistentBaseRewardRuntimeState[];
}

export type PersistentBaseEditorMutation =
  | {
    readonly operation: 'place';
    readonly ownerId: string;
    readonly revision: number;
    readonly tool: LoadoutToolRef;
    readonly relativeGridX: number;
    readonly relativeGridY: number;
    readonly angle: number;
  }
  | {
    readonly operation: 'remove' | 'reposition';
    readonly ownerId: string;
    readonly revision: number;
    readonly persistentId: string;
    readonly relativeGridX?: number;
    readonly relativeGridY?: number;
    readonly angle?: number;
  }
  | {
    readonly operation: 'reward-place';
    readonly ownerId: string;
    readonly revision: number;
    readonly rewardId: PersistentBaseRewardId;
    readonly relativeGridX: number;
    readonly relativeGridY: number;
    readonly angle: number;
  }
  | {
    readonly operation: 'reward-unplace';
    readonly ownerId: string;
    readonly revision: number;
    readonly rewardId: PersistentBaseRewardId;
  };

export interface PersistentBaseEditorMutationResult {
  readonly accepted: boolean;
  readonly reason?:
    | 'locked'
    | 'stale-revision'
    | 'not-owner'
    | 'not-found'
    | 'conflict'
    | 'occupied'
    | 'cooldown'
    | 'host-only'
    | 'invalid';
  readonly contribution?: PersistentPlayerBaseContribution;
  readonly snapshot: PersistentBaseCompositeSnapshot;
}

/**
 * Host-owned editor model. It uses the same composite merge and tool resolver as mission restore,
 * while keeping editor mutations immediately committed and completely independent from mission
 * rollback state.
 */
export class PersistentBaseEditorState {
  private readonly contributions = new Map<string, PersistentPlayerBaseContribution>();
  private readonly rewardState: PersistentBaseRewardState;
  private readonly options: PersistentBaseEditorOptions;
  private revision = 0;

  constructor(options: PersistentBaseEditorOptions) {
    this.options = options;
    for (const contribution of options.contributions ?? []) {
      this.contributions.set(contribution.ownerId, clonePersistentPlayerBaseContribution(contribution));
      this.revision = Math.max(this.revision, contribution.revision);
    }
    this.rewardState = new PersistentBaseRewardState({ placements: options.rewardPlacements });
    this.revision = Math.max(this.revision, this.rewardState.getPlacements().length);
  }

  getContribution(ownerId: string): PersistentPlayerBaseContribution | null {
    const contribution = this.contributions.get(ownerId);
    return contribution ? clonePersistentPlayerBaseContribution(contribution) : null;
  }

  getContributions(): PersistentPlayerBaseContribution[] {
    return [...this.contributions.values()]
      .sort((left, right) => compareOwnerIds(left.ownerId, right.ownerId))
      .map(clonePersistentPlayerBaseContribution);
  }

  getRewardState(): PersistentBaseRewardState {
    return this.rewardState;
  }

  getComposite(): PersistentBaseCompositeMergeResult {
    const host = this.contributions.get(this.options.ownerId) ?? null;
    const guests = [...this.contributions.values()].filter((entry) => entry.ownerId !== this.options.ownerId);
    const rewardCandidates = this.rewardState.getPlacements()
      .filter((placement) => this.rewardState.getRuntimeState(
        placement.rewardId,
        this.options.highestUnlockedMapId,
      ).availability === 'placed')
      .map((placement) => this.rewardCandidate(placement));
    return mergePersistentBaseComposite({
      anchor: this.options.anchor,
      radiusCells: this.options.radiusCells,
      authoredCells: this.options.authoredCells,
      baseRewards: rewardCandidates,
      hostContribution: host,
      guestContributions: guests,
      capacityMaxByOwner: this.options.capacityMaxByOwner,
      resolveTool: (toolId) => {
        const reward = getPersistentBaseRewardDefinition(toolId);
        if (reward) return { footprint: reward.footprint, capacityCost: reward.capacityCost };
        return this.options.resolveTool({ kind: 'construction', id: toolId });
      },
    });
  }

  getSnapshot(nowMs = Date.now()): PersistentBaseCompositeSnapshot {
    this.rewardState.setNow(nowMs);
    const composite = this.getComposite();
    return {
      schemaVersion: 4,
      revision: this.revision,
      ownerId: this.options.ownerId,
      anchor: { ...this.options.anchor },
      radiusCells: this.options.radiusCells,
      active: composite.active.map(cloneActiveEntry),
      conflicts: composite.conflicts.map((conflict) => ({ ...conflict })),
      rewards: this.rewardState.getRuntimeStates(this.options.highestUnlockedMapId, nowMs),
    };
  }

  getConflictsForOwner(ownerId: string): readonly PersistentCompositeConflict[] {
    return this.getComposite().conflictsByOwner.get(ownerId)?.map((conflict) => ({ ...conflict })) ?? [];
  }

  apply(mutation: PersistentBaseEditorMutation): PersistentBaseEditorMutationResult {
    const before = this.getSnapshot();
    if (!mutation.ownerId || !Number.isSafeInteger(mutation.revision) || mutation.revision < 0) {
      return { accepted: false, reason: 'invalid', snapshot: before };
    }
    if (mutation.operation === 'reward-unplace' && mutation.ownerId !== this.options.ownerId) {
      return { accepted: false, reason: 'host-only', snapshot: before };
    }

    const contribution = this.contributions.get(mutation.ownerId)
      ?? emptyContribution(mutation.ownerId);
    if (mutation.revision !== contribution.revision) {
      return { accepted: false, reason: 'stale-revision', snapshot: before };
    }

    if (mutation.operation === 'reward-place' || mutation.operation === 'reward-unplace') {
      return this.applyRewardMutation(mutation, before);
    }

    if (mutation.operation === 'reposition') {
      const rewardPlacement = this.rewardState.getPlacements()
        .find((placement) => placement.persistentId === mutation.persistentId);
      if (rewardPlacement) {
        if (mutation.ownerId !== this.options.ownerId) {
          return { accepted: false, reason: 'not-owner', snapshot: before };
        }
        if (!Number.isSafeInteger(mutation.relativeGridX)
          || !Number.isSafeInteger(mutation.relativeGridY)
          || !Number.isFinite(mutation.angle)) {
          return { accepted: false, reason: 'invalid', snapshot: before };
        }
        const relativeGridX = mutation.relativeGridX as number;
        const relativeGridY = mutation.relativeGridY as number;
        const angle = mutation.angle as number;
        const nextPlacement: PersistentBaseRewardPlacement = {
          ...rewardPlacement,
          relativeGridX,
          relativeGridY,
          angle,
        };
        if (!this.rewardState.reposition(
          rewardPlacement.rewardId,
          nextPlacement,
          this.options.highestUnlockedMapId,
        )) return { accepted: false, reason: 'not-found', snapshot: before };
        const after = this.getComposite();
        const active = after.active.some((entry) => entry.blueprint.persistentId === mutation.persistentId);
        if (!active) {
          this.rewardState.reposition(
            rewardPlacement.rewardId,
            rewardPlacement,
            this.options.highestUnlockedMapId,
          );
          return { accepted: false, reason: 'conflict', snapshot: before };
        }
        this.revision += 1;
        return { accepted: true, snapshot: this.getSnapshot() };
      }
    }

    const nextConstructions = contribution.constructions.map((entry) => ({ ...entry, tool: { ...entry.tool } }));
    if (mutation.operation === 'place') {
      const resolved = this.options.resolveTool(mutation.tool);
      if (!resolved
        || !Number.isSafeInteger(mutation.relativeGridX)
        || !Number.isSafeInteger(mutation.relativeGridY)
        || !Number.isFinite(mutation.angle)) {
        return { accepted: false, reason: 'invalid', snapshot: before };
      }
      const persistentId = this.createPersistentId(mutation.ownerId, nextConstructions);
      const placementOrder = nextConstructions.reduce((max, entry) => Math.max(max, entry.placementOrder), -1) + 1;
      nextConstructions.push({
        persistentId,
        tool: { ...mutation.tool },
        relativeGridX: mutation.relativeGridX,
        relativeGridY: mutation.relativeGridY,
        angle: Number.isFinite(mutation.angle) ? mutation.angle : 0,
        placementOrder,
        ownerId: mutation.ownerId,
      });
    } else {
      const index = nextConstructions.findIndex((entry) => entry.persistentId === mutation.persistentId);
      if (index < 0) return { accepted: false, reason: 'not-found', snapshot: before };
      if (nextConstructions[index].ownerId && nextConstructions[index].ownerId !== mutation.ownerId) {
        return { accepted: false, reason: 'not-owner', snapshot: before };
      }
      if (!this.isActive(mutation.persistentId)) return { accepted: false, reason: 'not-found', snapshot: before };
      if (mutation.operation === 'remove') {
        nextConstructions.splice(index, 1);
      } else {
        if (!Number.isSafeInteger(mutation.relativeGridX)
          || !Number.isSafeInteger(mutation.relativeGridY)
          || !Number.isFinite(mutation.angle)) {
          return { accepted: false, reason: 'invalid', snapshot: before };
        }
        const relativeGridX = mutation.relativeGridX as number;
        const relativeGridY = mutation.relativeGridY as number;
        const angle = mutation.angle as number;
        nextConstructions[index] = {
          ...nextConstructions[index],
          relativeGridX,
          relativeGridY,
          angle,
        };
      }
    }

    const next = {
      ...contribution,
      revision: contribution.revision + 1,
      constructions: nextConstructions,
    } satisfies PersistentPlayerBaseContribution;
    this.contributions.set(mutation.ownerId, next);
    const after = this.getComposite();
    const changedId = mutation.operation === 'place'
      ? nextConstructions[nextConstructions.length - 1]?.persistentId
      : mutation.persistentId;
    const changedActive = changedId ? after.active.some((entry) => entry.blueprint.persistentId === changedId) : true;
    if (!changedActive && mutation.operation !== 'remove') {
      this.contributions.set(mutation.ownerId, contribution);
      return { accepted: false, reason: 'conflict', snapshot: before };
    }
    this.revision += 1;
    return {
      accepted: true,
      contribution: clonePersistentPlayerBaseContribution(next),
      snapshot: this.getSnapshot(),
    };
  }

  private applyRewardMutation(
    mutation: Extract<PersistentBaseEditorMutation, { operation: 'reward-place' | 'reward-unplace' }>,
    before: PersistentBaseCompositeSnapshot,
  ): PersistentBaseEditorMutationResult {
    const rewardId = mutation.rewardId;
    const definition = getPersistentBaseRewardDefinition(rewardId);
    if (!definition) return { accepted: false, reason: 'invalid', snapshot: before };
    if (mutation.operation === 'reward-unplace') {
      if (!this.rewardState.unplace(rewardId, this.options.highestUnlockedMapId)) {
        return { accepted: false, reason: 'not-found', snapshot: before };
      }
      this.revision += 1;
      return { accepted: true, snapshot: this.getSnapshot() };
    }
    if (!Number.isSafeInteger(mutation.relativeGridX) || !Number.isSafeInteger(mutation.relativeGridY)
      || !Number.isFinite(mutation.angle)) {
      return { accepted: false, reason: 'invalid', snapshot: before };
    }
    const placement: PersistentBaseRewardPlacement = {
      rewardId,
      persistentId: `reward-${rewardId}`,
      relativeGridX: mutation.relativeGridX,
      relativeGridY: mutation.relativeGridY,
      angle: mutation.angle,
      placementOrder: this.nextRewardOrder(),
    };
    if (!this.rewardState.place(rewardId, placement, this.options.highestUnlockedMapId)) {
      const runtime = this.rewardState.getRuntimeState(rewardId, this.options.highestUnlockedMapId);
      return { accepted: false, reason: runtime.availability === 'reconstruction-cooldown' ? 'cooldown' : 'locked', snapshot: before };
    }
    const after = this.getComposite();
    const active = after.active.some((entry) => entry.blueprint.rewardId === rewardId);
    if (!active) {
      this.rewardState.unplace(rewardId, this.options.highestUnlockedMapId);
      return { accepted: false, reason: 'conflict', snapshot: before };
    }
    this.revision += 1;
    return { accepted: true, snapshot: this.getSnapshot() };
  }

  private rewardCandidate(placement: PersistentBaseRewardPlacement): PersistentCompositeCandidate {
    return {
      ownerId: this.options.ownerId,
      source: 'base-reward',
      footprint: getPersistentBaseRewardDefinition(placement.rewardId)?.footprint ?? [],
      capacityCost: 0,
      blueprint: {
        persistentId: placement.persistentId,
        tool: { kind: 'construction', id: placement.rewardId },
        relativeGridX: placement.relativeGridX,
        relativeGridY: placement.relativeGridY,
        angle: placement.angle,
        placementOrder: placement.placementOrder,
        ownerId: this.options.ownerId,
        rewardId: placement.rewardId,
      },
    };
  }

  private isActive(persistentId: string): boolean {
    return this.getComposite().active.some((entry) => entry.blueprint.persistentId === persistentId);
  }

  private nextRewardOrder(): number {
    return this.rewardState.getPlacements().reduce((max, placement) => Math.max(max, placement.placementOrder), -1) + 1;
  }

  private createPersistentId(ownerId: string, constructions: readonly PersistentConstruction[]): string {
    let order = constructions.length;
    let persistentId = `pb-${ownerId}-${order}`;
    while ([...this.contributions.values()].some((entry) => entry.constructions.some((item) => item.persistentId === persistentId))) {
      order += 1;
      persistentId = `pb-${ownerId}-${order}`;
    }
    return persistentId;
  }
}

function emptyContribution(ownerId: string): PersistentPlayerBaseContribution {
  return { schemaVersion: 4, ownerId, revision: 0, constructions: [] };
}

function cloneActiveEntry(entry: PersistentCompositeActiveEntry): PersistentCompositeActiveEntry {
  return { ...entry, blueprint: { ...entry.blueprint, tool: { ...entry.blueprint.tool } }, footprint: entry.footprint.map((cell) => ({ ...cell })) };
}

function compareOwnerIds(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
