import { COOP_DEFENSE_MAP_CONFIGS } from '../config/coopDefenseMaps';
import type { CoopDefenseProgressPreferences } from '../utils/localPreferences';
import type { PersistentBaseAreaStage } from './PersistentBaseCore';
import { isPersistentBaseRewardCellAllowed, getPersistentConstructionFootprint, getPersistentBaseRewardFootprint, getPersistentBaseRewardCells } from './PersistentBasePlacementRules';
import { resolvePersistentBaseBuildAreaForStage, resolvePersistentBaseCell, isCellInsidePersistentBaseBuildArea,
  isPersistentBaseSolidDomain, type PersistentBaseBuildArea } from './PersistentBaseCore';
import type { PersistentBaseRewardId, PersistentBaseRewardPlacement } from './PersistentBaseRewardTypes';
import type { PersistentConstruction } from './PersistentBaseTypes';
import { rotatePersistentBaseQuarterTurnsClockwise, type PersistentBaseQuarterTurns } from './PersistentBaseFrame';

export type BaseEditorObject = { readonly kind: 'reward'; readonly id: PersistentBaseRewardId }
  | { readonly kind: 'construction'; readonly id: string };
export type BaseEditorPlacementFailure = 'outside' | 'surface' | 'occupied' | 'locked' | 'unknown';

/**
 * Die Basis des Raums, wie der Editor sie zeigt: Reward-Platzierungen und Ausrichtung gehoeren dem
 * Raum-Host. Nur der Host bearbeitet sie; ein Gast sieht die replizierte Projektion.
 */
export interface PersistentBaseEditorRoomBase {
  readonly placements: readonly PersistentBaseRewardPlacement[];
  readonly quarterTurns: PersistentBaseQuarterTurns;
  readonly editable: boolean;
}

/** A value-only draft. Neither renderer updates nor cancel can write progress. */
export class PersistentBaseEditorModel {
  readonly area: PersistentBaseBuildArea;
  readonly rewards: PersistentBaseRewardPlacement[] = [];
  readonly constructions: PersistentConstruction[] = [];
  /** Removed personal builds stay available in this draft until Apply/Cancel. */
  readonly availableConstructions: PersistentConstruction[] = [];
  /**
   * Die bearbeitete persoenliche Ausbaustufe. Sie umfasst die Dawn-Expansion und kann damit ueber
   * der gespeicherten Kampagnenstufe der Baseline liegen.
   */
  readonly areaStage: PersistentBaseAreaStage;
  private currentBaseline!: CoopDefenseProgressPreferences;
  private currentRoom!: PersistentBaseEditorRoomBase;
  private turns: PersistentBaseQuarterTurns = 0;
  /**
   * @param room Basis des Raums. Ohne Angabe ist es die eigene Basis aus `baseline`, also die Sicht
   *   des Hosts auf sein Dokument.
   */
  constructor(baseline: CoopDefenseProgressPreferences, areaStage?: PersistentBaseAreaStage, room?: PersistentBaseEditorRoomBase) {
    this.areaStage = areaStage ?? baseline.persistentBaseAreaStage;
    this.area = resolvePersistentBaseBuildAreaForStage(this.areaStage);
    this.reload(baseline, room);
  }
  get baseline(): CoopDefenseProgressPreferences { return this.currentBaseline; }
  /** Ob Rewards und Ausrichtung in diesem Entwurf bearbeitet werden duerfen (nur der Host). */
  get rewardsEditable(): boolean { return this.currentRoom.editable; }
  get quarterTurns(): PersistentBaseQuarterTurns { return this.turns; }
  /** Discards the draft and starts again from the latest confirmed documents. */
  reload(baseline: CoopDefenseProgressPreferences, room?: PersistentBaseEditorRoomBase): void {
    this.currentBaseline = baseline;
    this.currentRoom = room ?? {
      placements: baseline.persistentBaseRewardState.placements,
      quarterTurns: baseline.persistentBaseRewardState.quarterTurns,
      editable: true,
    };
    this.turns = this.currentRoom.quarterTurns;
    this.rewards.splice(0, this.rewards.length, ...this.currentRoom.placements.map(p => ({ ...p })));
    this.constructions.splice(0, this.constructions.length,
      ...baseline.personalBaseContribution.constructions.map(p => ({ ...p, tool: { ...p.tool } })));
    this.availableConstructions.splice(0, this.availableConstructions.length,
      ...this.constructions.map(p => ({ ...p, tool: { ...p.tool } })));
  }
  get unplaced(): readonly PersistentBaseRewardId[] {
    if (!this.rewardsEditable) return [];
    return this.baseline.persistentBaseRewardUnlocks.filter(id => !this.rewards.some(p => p.rewardId === id));
  }
  get constructionsChanged(): boolean {
    return JSON.stringify(this.constructions) !== JSON.stringify(this.baseline.personalBaseContribution.constructions);
  }
  get roomBaseChanged(): boolean {
    return this.rewardsEditable && (this.turns !== this.currentRoom.quarterTurns
      || JSON.stringify(this.rewards) !== JSON.stringify(this.currentRoom.placements));
  }
  get dirty(): boolean {
    return this.constructionsChanged || this.roomBaseChanged;
  }
  /** Turns the whole base clockwise; only the host owns the base's orientation. */
  rotate(): boolean {
    if (!this.rewardsEditable) return false;
    this.turns = rotatePersistentBaseQuarterTurnsClockwise(this.turns);
    return true;
  }
  getPosition(object: BaseEditorObject) {
    return object.kind === 'reward' ? this.rewards.find(p => p.rewardId === object.id)
      : this.constructions.find(p => p.persistentId === object.id);
  }
  getConstruction(id: string): PersistentConstruction | undefined {
    return this.constructions.find(p => p.persistentId === id)
      ?? this.availableConstructions.find(p => p.persistentId === id);
  }
  validate(object: BaseEditorObject, x: number, y: number): BaseEditorPlacementFailure | null {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return 'outside';
    let footprint: readonly { dx: number; dy: number }[] = [{ dx: 0, dy: 0 }];
    if (object.kind === 'reward') {
      footprint = getPersistentBaseRewardFootprint(object.id);
      if (!this.rewardsEditable || !this.baseline.persistentBaseRewardUnlocks.includes(object.id)) return 'locked';
      if (!isPersistentBaseRewardCellAllowed(object.id, x, y, this.area)) return 'surface';
    } else {
      const entry = this.getConstruction(object.id);
      const cells = entry && getPersistentConstructionFootprint(entry);
      if (!cells) return 'unknown';
      footprint = cells.length ? cells : footprint;
    }
    const occupied = new Set<string>();
    for (const reward of this.rewards) {
      if (object.kind === 'reward' && reward.rewardId === object.id) continue;
      for (const cell of getPersistentBaseRewardCells(reward)) occupied.add(`${cell.gridX},${cell.gridY}`);
    }
    for (const entry of this.constructions) {
      if (object.kind === 'construction' && entry.persistentId === object.id) continue;
      for (const cell of getPersistentConstructionFootprint(entry) ?? [{ dx: 0, dy: 0 }]) {
        occupied.add(`${entry.relativeGridX + cell.dx},${entry.relativeGridY + cell.dy}`);
      }
    }
    for (const cell of footprint) {
      const cx = x + cell.dx, cy = y + cell.dy;
      if (!isCellInsidePersistentBaseBuildArea(cx, cy, this.area)) return 'outside';
      if (object.kind === 'construction'
        && isPersistentBaseSolidDomain(resolvePersistentBaseCell({ gridX: 0, gridY: 0 }, cx, cy, this.area)?.domain)) return 'surface';
      if (occupied.has(`${cx},${cy}`)) return 'occupied';
    }
    return null;
  }
  move(object: BaseEditorObject, x: number, y: number): boolean {
    if (this.validate(object, x, y)) return false;
    if (object.kind === 'reward') {
      const index = this.rewards.findIndex(p => p.rewardId === object.id);
      const next = { rewardId: object.id, relativeGridX: x, relativeGridY: y, angle: index < 0 ? 0 : this.rewards[index]!.angle };
      if (index < 0) this.rewards.push(next); else this.rewards[index] = next;
    } else {
      const index = this.constructions.findIndex(p => p.persistentId === object.id);
      const next = { ...this.getConstruction(object.id)!, relativeGridX: x, relativeGridY: y };
      if (index < 0) {
        this.constructions.push(next);
        const order = this.availableConstructions.map(p => p.persistentId);
        this.constructions.sort((a, b) => order.indexOf(a.persistentId) - order.indexOf(b.persistentId));
      } else this.constructions[index] = next;
    }
    return true;
  }
  remove(object: BaseEditorObject): void {
    if (object.kind === 'reward') {
      if (!this.rewardsEditable) return;
      const index = this.rewards.findIndex(p => p.rewardId === object.id);
      if (index >= 0) this.rewards.splice(index, 1);
    } else {
      const index = this.constructions.findIndex(p => p.persistentId === object.id);
      if (index >= 0) this.constructions.splice(index, 1);
    }
  }
  /** Takes back everything this player may move off the base; true when anything moved. */
  clear(): boolean {
    const before = this.rewards.length + this.constructions.length;
    if (this.rewardsEditable) this.rewards.splice(0);
    this.constructions.splice(0);
    return this.rewards.length + this.constructions.length !== before;
  }
  /** The draft as it stands, for undo. */
  snapshot(): PersistentBaseEditorDraftState {
    return { turns: this.turns, rewards: this.rewards.map(p => ({ ...p })),
      constructions: this.constructions.map(p => ({ ...p, tool: { ...p.tool } })) };
  }
  /** Returns to a snapshot of this draft. */
  restore(state: PersistentBaseEditorDraftState): void {
    this.turns = state.turns;
    this.rewards.splice(0, this.rewards.length, ...state.rewards.map(p => ({ ...p })));
    this.constructions.splice(0, this.constructions.length, ...state.constructions.map(p => ({ ...p, tool: { ...p.tool } })));
  }
}

/** The editable part of a draft at one moment. */
export interface PersistentBaseEditorDraftState {
  readonly turns: PersistentBaseQuarterTurns;
  readonly rewards: readonly PersistentBaseRewardPlacement[];
  readonly constructions: readonly PersistentConstruction[];
}

export interface MissedBaseReward { readonly rewardId: PersistentBaseRewardId; readonly mapId: string; readonly objectiveId: string | null }
export function getMissedBaseRewards(progress: Pick<CoopDefenseProgressPreferences, 'completedMapIds' | 'persistentBaseRewardUnlocks'>): MissedBaseReward[] {
  const result: MissedBaseReward[] = [];
  for (const map of COOP_DEFENSE_MAP_CONFIGS) {
    if (!progress.completedMapIds.includes(map.mapId)) continue;
    const add = (ids: readonly PersistentBaseRewardId[] | undefined, objectiveId: string | null) => {
      for (const rewardId of ids ?? []) if (!progress.persistentBaseRewardUnlocks.includes(rewardId)
        && !result.some(p => p.rewardId === rewardId && p.mapId === map.mapId)) result.push({ rewardId, mapId: map.mapId, objectiveId });
    };
    add(map.persistentBaseRewardsOnVictory, null);
    for (const objective of map.secondaryObjectives ?? []) add(objective.rewards?.persistentBaseRewardsOnComplete, objective.id);
  }
  return result;
}
