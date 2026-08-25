import type { PersistentBaseAnchor, PersistentConstruction, PersistentPlayerBaseContribution } from './PersistentBaseTypes';
import { isPersistentFootprintInsideZone } from './PersistentBaseZone';

export type PersistentCompositeSource = 'authored' | 'base-reward' | 'host' | 'guest';

export interface PersistentGridCellOffset {
  readonly dx: number;
  readonly dy: number;
}

export interface PersistentCompositeCandidate {
  readonly blueprint: PersistentConstruction;
  readonly ownerId: string;
  readonly source: Exclude<PersistentCompositeSource, 'authored'>;
  readonly footprint: readonly PersistentGridCellOffset[];
  readonly capacityCost?: number;
}

export interface PersistentCompositeActiveEntry extends PersistentCompositeCandidate {
  readonly gridX: number;
  readonly gridY: number;
}

export type PersistentCompositeConflictReason = 'outside-zone' | 'authored-collision' | 'collision' | 'capacity' | 'unknown-tool';

export interface PersistentCompositeConflict {
  readonly ownerId: string;
  readonly persistentId: string;
  readonly toolId: string;
  readonly reason: PersistentCompositeConflictReason;
}

export interface PersistentBaseCompositeMergeInput {
  readonly anchor: PersistentBaseAnchor;
  readonly radiusCells: number;
  readonly authoredCells?: ReadonlySet<string>;
  readonly baseRewards?: readonly PersistentCompositeCandidate[];
  readonly hostContribution?: PersistentPlayerBaseContribution | null;
  readonly guestContributions?: readonly PersistentPlayerBaseContribution[];
  readonly resolveTool: (toolId: string) => {
    readonly footprint: readonly PersistentGridCellOffset[];
    readonly capacityCost?: number;
  } | null;
  readonly capacityMaxByOwner?: ReadonlyMap<string, number>;
}

export interface PersistentBaseCompositeMergeResult {
  readonly active: readonly PersistentCompositeActiveEntry[];
  readonly conflicts: readonly PersistentCompositeConflict[];
  readonly conflictsByOwner: ReadonlyMap<string, readonly PersistentCompositeConflict[]>;
}

/**
 * Deterministically resolves the authored base, host contribution and current guest contributions.
 * The function is deliberately pure: the host can use it for authority and clients can use it for
 * previews without ever being able to write the resulting state back to persistence.
 */
export function mergePersistentBaseComposite(
  input: PersistentBaseCompositeMergeInput,
): PersistentBaseCompositeMergeResult {
  const candidates: PersistentCompositeCandidate[] = [];
  for (const candidate of input.baseRewards ?? []) candidates.push({ ...candidate });
  if (input.hostContribution) {
    appendContribution(candidates, input.hostContribution, 'host');
  }
  const guests = [...(input.guestContributions ?? [])]
    .filter((contribution) => contribution.ownerId !== input.hostContribution?.ownerId)
    .sort((left, right) => compareOwnerIds(left.ownerId, right.ownerId));
  for (const contribution of guests) appendContribution(candidates, contribution, 'guest');

  const occupied = new Set<string>(input.authoredCells ?? []);
  const usedCapacity = new Map<string, number>();
  const active: PersistentCompositeActiveEntry[] = [];
  const conflicts: PersistentCompositeConflict[] = [];

  // Reward candidates are appended before personal candidates; contributions themselves already
  // preserve placement order. This makes the priority visible in the algorithm, not accidental.
  for (const candidate of candidates) {
    const toolId = candidate.blueprint.tool.id;
    const resolved = input.resolveTool(toolId);
    if (!resolved) {
      conflicts.push(conflict(candidate, 'unknown-tool'));
      continue;
    }
    const footprint = resolved.footprint.length > 0 ? resolved.footprint : candidate.footprint;
    const gridX = input.anchor.gridX + candidate.blueprint.relativeGridX;
    const gridY = input.anchor.gridY + candidate.blueprint.relativeGridY;
    if (!isPersistentFootprintInsideZone(gridX, gridY, footprint, input.anchor, input.radiusCells)) {
      conflicts.push(conflict(candidate, 'outside-zone'));
      continue;
    }
    const cells = footprint.map((offset) => `${gridX + offset.dx}:${gridY + offset.dy}`);
    if (cells.some((key) => (input.authoredCells?.has(key) ?? false))) {
      conflicts.push(conflict(candidate, 'authored-collision'));
      continue;
    }
    if (cells.some((key) => occupied.has(key))) {
      conflicts.push(conflict(candidate, 'collision'));
      continue;
    }
    const cost = Math.max(0, resolved.capacityCost ?? candidate.capacityCost ?? 0);
    const max = input.capacityMaxByOwner?.get(candidate.ownerId);
    const nextUsed = (usedCapacity.get(candidate.ownerId) ?? 0) + cost;
    if (max !== undefined && nextUsed > max) {
      conflicts.push(conflict(candidate, 'capacity'));
      continue;
    }
    usedCapacity.set(candidate.ownerId, nextUsed);
    for (const key of cells) occupied.add(key);
    active.push({ ...candidate, footprint, gridX, gridY });
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
  source: 'host' | 'guest',
): void {
  const entries = [...contribution.constructions]
    .sort(compareConstructions)
    .map((blueprint) => ({
      blueprint,
      ownerId: contribution.ownerId,
      source,
      footprint: [],
    } satisfies PersistentCompositeCandidate));
  target.push(...entries);
}

function compareConstructions(left: PersistentConstruction, right: PersistentConstruction): number {
  return left.placementOrder - right.placementOrder
    || compareOwnerIds(left.ownerId ?? '', right.ownerId ?? '')
    || compareOwnerIds(left.persistentId, right.persistentId);
}

function compareOwnerIds(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
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

