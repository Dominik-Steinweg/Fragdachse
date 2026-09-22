import { COOP_DEFENSE_MAP_CONFIGS } from '../config/coopDefenseMaps';
import type { CoopDefenseProgressPreferences } from '../utils/localPreferences';
import { isPersistentBaseRewardCellAllowed, getPersistentConstructionFootprint } from './PersistentBasePlacementRules';
import { resolvePersistentBaseBuildAreaForStage, resolvePersistentBaseCell, isCellInsidePersistentBaseBuildArea,
  type PersistentBaseBuildArea } from './PersistentBaseCore';
import type { PersistentBaseRewardId, PersistentBaseRewardPlacement } from './PersistentBaseRewardTypes';
import type { PersistentConstruction } from './PersistentBaseTypes';

export type BaseEditorObject = { readonly kind: 'reward'; readonly id: PersistentBaseRewardId }
  | { readonly kind: 'construction'; readonly id: string };
export type BaseEditorPlacementFailure = 'outside' | 'surface' | 'occupied' | 'locked' | 'unknown';

/** A value-only draft. Neither renderer updates nor cancel can write progress. */
export class PersistentBaseEditorModel {
  readonly area: PersistentBaseBuildArea;
  readonly rewards: PersistentBaseRewardPlacement[];
  readonly constructions: PersistentConstruction[];
  /** Removed personal builds stay available in this draft until Apply/Cancel. */
  readonly availableConstructions: readonly PersistentConstruction[];
  constructor(readonly baseline: CoopDefenseProgressPreferences) {
    this.area = resolvePersistentBaseBuildAreaForStage(baseline.persistentBaseAreaStage);
    this.rewards = baseline.persistentBaseRewardState.placements.map(p => ({ ...p }));
    this.constructions = baseline.personalBaseContribution.constructions.map(p => ({ ...p, tool: { ...p.tool } }));
    this.availableConstructions = this.constructions.map(p => ({ ...p, tool: { ...p.tool } }));
  }
  get unplaced(): readonly PersistentBaseRewardId[] {
    return this.baseline.persistentBaseRewardUnlocks.filter(id => !this.rewards.some(p => p.rewardId === id));
  }
  get dirty(): boolean {
    return JSON.stringify(this.rewards) !== JSON.stringify(this.baseline.persistentBaseRewardState.placements)
      || JSON.stringify(this.constructions) !== JSON.stringify(this.baseline.personalBaseContribution.constructions);
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
      if (!this.baseline.persistentBaseRewardUnlocks.includes(object.id)) return 'locked';
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
      occupied.add(`${reward.relativeGridX},${reward.relativeGridY}`);
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
        && resolvePersistentBaseCell({ gridX: 0, gridY: 0 }, cx, cy, undefined, this.area)?.domain === 'base-surface') return 'surface';
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
      const index = this.rewards.findIndex(p => p.rewardId === object.id);
      if (index >= 0) this.rewards.splice(index, 1);
    } else {
      const index = this.constructions.findIndex(p => p.persistentId === object.id);
      if (index >= 0) this.constructions.splice(index, 1);
    }
  }
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
