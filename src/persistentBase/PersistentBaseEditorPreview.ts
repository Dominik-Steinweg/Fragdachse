import { getCoopDefenseConstructionDefinition, normalizeConstructionId } from '../config/coopDefenseConstructions';
import { PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION } from '../config/persistentBase';
import {
  mergePersistentBaseComposite,
  type PersistentCompositeConflictReason,
  type PersistentCompositeTool,
} from './PersistentBaseComposite';
import type { PersistentBaseBuildArea } from './PersistentBaseCore';
import { getPersistentConstructionAppearance } from './PersistentBaseEditorAppearance';
import type { PersistentBaseEditorModel } from './PersistentBaseEditorModel';
import type { PersistentBaseEditorMateObject } from './PersistentBaseEditorWorld';
import { toWorldFootprint, type PersistentBaseFrame } from './PersistentBaseFrame';
import { getPersistentBaseRewardFootprint, isPersistentBaseRewardCellAllowed } from './PersistentBasePlacementRules';
import type { PersistentPlayerBaseContribution } from './PersistentBaseTypes';

/** A teammate in the room and the contribution they offer (replicated `pbo`). */
export interface PersistentBaseEditorMate {
  readonly ownerId: string;
  readonly color: number;
  readonly contribution: PersistentPlayerBaseContribution;
}

/** What the editor knows about the room to predict the host's merge on the shown map. */
export interface PersistentBaseEditorRoom {
  readonly localOwnerId: string;
  /** Owner of the room host's contribution; it wins every collision, as in a round. */
  readonly hostOwnerId: string;
  readonly mates: readonly PersistentBaseEditorMate[];
  /** The local owner's capacity on the shown map. Teammates' capacity is not known here. */
  readonly localCapacity: number;
  /** The local owner's access to a tool; a teammate's offered tools count as available. */
  readonly resolveLocalTool: (toolId: string) => PersistentCompositeTool | null;
}

export interface PersistentBaseEditorPreview {
  /** Teammates' constructions that the round would materialize, in World cells. */
  readonly mates: readonly PersistentBaseEditorMateObject[];
  /** Why own constructions would not stand on the shown map, by persistent id. */
  readonly conflicts: ReadonlyMap<string, PersistentCompositeConflictReason>;
}

/**
 * Predicts what the host would materialize on the shown map: the same merge as a round
 * (`mergePersistentBaseComposite`), with the draft in place of the local contribution.
 *
 * The prediction is no permission: the host validates again when the draft is applied and when
 * the round starts.
 */
export function resolvePersistentBaseEditorPreview(input: {
  readonly model: PersistentBaseEditorModel;
  readonly frame: PersistentBaseFrame;
  readonly siteArea: PersistentBaseBuildArea;
  readonly room: PersistentBaseEditorRoom;
  readonly isCellBlocked: (gridX: number, gridY: number) => boolean;
}): PersistentBaseEditorPreview {
  const { model, frame, siteArea, room } = input;
  const local: PersistentPlayerBaseContribution = {
    schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
    ownerId: room.localOwnerId,
    revision: model.baseline.personalBaseContribution.revision,
    constructions: model.constructions,
  };
  const contributions = [local, ...room.mates.map((mate) => mate.contribution).filter((entry) => entry.ownerId !== room.localOwnerId)];
  const reservedCells = new Set<string>();
  for (const placement of model.rewards) {
    if (!isPersistentBaseRewardCellAllowed(placement.rewardId, placement.relativeGridX, placement.relativeGridY, siteArea)) continue;
    const placed = toWorldFootprint(frame, placement.relativeGridX, placement.relativeGridY, getPersistentBaseRewardFootprint(placement.rewardId));
    for (const cell of placed.footprint) reservedCells.add(`${placed.gridX + cell.dx}:${placed.gridY + cell.dy}`);
  }
  const result = mergePersistentBaseComposite({
    frame,
    buildArea: siteArea,
    hostContribution: contributions.find((entry) => entry.ownerId === room.hostOwnerId) ?? null,
    guestContributions: contributions.filter((entry) => entry.ownerId !== room.hostOwnerId),
    resolveTool: (ownerId, toolId) => ownerId === room.localOwnerId ? room.resolveLocalTool(toolId) : resolveOfferedTool(toolId),
    capacityMaxByOwner: new Map([[room.localOwnerId, room.localCapacity]]),
    isCellBlocked: input.isCellBlocked,
    reservedCells,
  });
  const colors = new Map(room.mates.map((mate) => [mate.ownerId, mate.color]));
  const mates: PersistentBaseEditorMateObject[] = [];
  for (const entry of result.active) {
    if (entry.ownerId === room.localOwnerId) continue;
    const appearance = getPersistentConstructionAppearance(entry.blueprint);
    if (!appearance) continue;
    mates.push({ key: `${entry.ownerId}:${entry.blueprint.persistentId}`, color: colors.get(entry.ownerId) ?? 0xffffff,
      weapon: appearance.weapon, powerUpDefId: appearance.powerUpDefId, wall: appearance.wall, tint: appearance.ownerTintStrength,
      gridX: entry.gridX, gridY: entry.gridY, footprint: entry.footprint, angle: entry.angle });
  }
  const conflicts = new Map((result.conflictsByOwner.get(room.localOwnerId) ?? [])
    .map((conflict) => [conflict.persistentId, conflict.reason] as const));
  return { mates, conflicts };
}

/** A teammate's offered construction: the host confirmed it; only its geometry matters here. */
function resolveOfferedTool(toolId: string): PersistentCompositeTool | null {
  const id = normalizeConstructionId(toolId);
  if (!id) return null;
  const definition = getCoopDefenseConstructionDefinition(id);
  return { footprint: definition.footprint, capacityCost: definition.capacityCost };
}
