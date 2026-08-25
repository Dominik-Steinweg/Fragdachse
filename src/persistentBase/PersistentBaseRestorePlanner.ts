import type { PersistentBaseAnchor, PersistentBaseState, PersistentConstruction, PersistentToolKind } from './PersistentBaseTypes';
import { isPersistentFootprintInsideZone } from './PersistentBaseZone';

export interface PersistentRestoreToolDefinition {
  readonly kind: PersistentToolKind;
  readonly id: string;
  readonly footprint: readonly { readonly dx: number; readonly dy: number }[];
  readonly capacityCost: number;
  readonly maxHp: number;
  readonly unlocked: boolean;
}

export type PersistentDormantReason =
  | 'unknown-tool'
  | 'locked'
  | 'outside-zone'
  | 'collision'
  | 'capacity';

export interface PersistentRestoreCandidate {
  readonly blueprint: PersistentConstruction;
  readonly tool: PersistentRestoreToolDefinition;
  readonly gridX: number;
  readonly gridY: number;
}

export interface PersistentDormantEntry {
  readonly blueprint: PersistentConstruction;
  readonly reason: PersistentDormantReason;
}

export interface PersistentRestorePlan {
  readonly active: readonly PersistentRestoreCandidate[];
  readonly dormant: readonly PersistentDormantEntry[];
  readonly usedCapacity: number;
}

export interface PersistentRestorePlannerInput {
  readonly state: PersistentBaseState;
  readonly anchor: PersistentBaseAnchor;
  readonly activeRadiusCells: number;
  readonly capacityUsed: number;
  readonly capacityMax: number;
  readonly tools: readonly PersistentRestoreToolDefinition[];
  /** True for static map geometry and already materialized runtime geometry. */
  readonly isCellBlocked: (gridX: number, gridY: number) => boolean;
}

/**
 * Pure deterministic restore selection. Dormant entries are intentionally returned instead of
 * being dropped; the session commits them unchanged until the player can activate them later.
 */
export function planPersistentBaseRestore(input: PersistentRestorePlannerInput): PersistentRestorePlan {
  const tools = new Map(input.tools.map((tool) => [`${tool.kind}:${tool.id}`, tool] as const));
  const ordered = [...input.state.constructions].sort((left, right) => (
    left.placementOrder - right.placementOrder
      || comparePersistentIds(left.persistentId, right.persistentId)
  ));
  const occupied = new Set<string>();
  const active: PersistentRestoreCandidate[] = [];
  const dormant: PersistentDormantEntry[] = [];
  let usedCapacity = Math.max(0, input.capacityUsed);

  for (const blueprint of ordered) {
    const tool = tools.get(`${blueprint.tool.kind}:${blueprint.tool.id}`);
    if (!tool) {
      dormant.push({ blueprint, reason: 'unknown-tool' });
      continue;
    }
    if (!tool.unlocked) {
      dormant.push({ blueprint, reason: 'locked' });
      continue;
    }
    if (!isPersistentFootprintInsideZone(
      input.anchor.gridX + blueprint.relativeGridX,
      input.anchor.gridY + blueprint.relativeGridY,
      tool.footprint,
      input.anchor,
      input.activeRadiusCells,
    )) {
      dormant.push({ blueprint, reason: 'outside-zone' });
      continue;
    }

    const gridX = input.anchor.gridX + blueprint.relativeGridX;
    const gridY = input.anchor.gridY + blueprint.relativeGridY;
    const hasCollision = tool.footprint.some((cell) => {
      const targetX = gridX + cell.dx;
      const targetY = gridY + cell.dy;
      return input.isCellBlocked(targetX, targetY)
        || occupied.has(cellKey(targetX, targetY));
    });
    if (hasCollision) {
      dormant.push({ blueprint, reason: 'collision' });
      continue;
    }
    if (usedCapacity + tool.capacityCost > input.capacityMax) {
      dormant.push({ blueprint, reason: 'capacity' });
      continue;
    }

    for (const cell of tool.footprint) occupied.add(cellKey(gridX + cell.dx, gridY + cell.dy));
    usedCapacity += tool.capacityCost;
    active.push({ blueprint, tool, gridX, gridY });
  }

  return { active, dormant, usedCapacity };
}

function cellKey(gridX: number, gridY: number): string {
  return `${gridX}:${gridY}`;
}

function comparePersistentIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
