import {
  getPersistentBaseRewardDefinition,
  type PersistentBaseRewardAvailability,
  type PersistentBaseRewardId,
  type PersistentBaseRewardPlacement,
  type PersistentBaseRewardRuntimeState,
} from '../config/persistentBaseRewards';
import { isCoopDefenseMapUnlocked } from '../config/coopDefenseMapUnlocks';

export interface PersistentBaseRewardStateOptions {
  readonly placements?: readonly PersistentBaseRewardPlacement[];
  readonly nowMs?: number;
}

/** Host-owned reward state. Personal clients may inspect it but never mutate it locally. */
export class PersistentBaseRewardState {
  private readonly placements = new Map<PersistentBaseRewardId, PersistentBaseRewardPlacement>();
  private readonly cooldownUntil = new Map<PersistentBaseRewardId, number>();
  private missionBaselinePlacements: Map<PersistentBaseRewardId, PersistentBaseRewardPlacement> | null = null;
  private missionBaselineCooldownUntil: Map<PersistentBaseRewardId, number> | null = null;

  constructor(options: PersistentBaseRewardStateOptions = {}) {
    for (const placement of options.placements ?? []) this.placements.set(placement.rewardId, { ...placement });
    this.nowMs = options.nowMs ?? 0;
  }

  private nowMs: number;

  setNow(nowMs: number): void {
    this.nowMs = Math.max(0, Number.isFinite(nowMs) ? nowMs : this.nowMs);
  }

  /** Starts the mission working copy. Editor mutations deliberately do not use this boundary. */
  beginMission(): void {
    if (this.missionBaselinePlacements) return;
    this.missionBaselinePlacements = clonePlacementMap(this.placements);
    this.missionBaselineCooldownUntil = new Map(this.cooldownUntil);
  }

  /** Victory keeps the current placement state but never carries a runtime rebuild timer forward. */
  commitMission(): void {
    this.missionBaselinePlacements = null;
    this.missionBaselineCooldownUntil = null;
    this.cooldownUntil.clear();
  }

  /** Defeat/abort restores the exact mission baseline, including whether a reward was placed. */
  rollbackMission(): void {
    if (!this.missionBaselinePlacements) return;
    this.placements.clear();
    for (const [rewardId, placement] of this.missionBaselinePlacements) {
      this.placements.set(rewardId, { ...placement });
    }
    this.cooldownUntil.clear();
    for (const [rewardId, until] of this.missionBaselineCooldownUntil ?? []) {
      this.cooldownUntil.set(rewardId, until);
    }
    this.missionBaselinePlacements = null;
    this.missionBaselineCooldownUntil = null;
  }

  getPlacement(rewardId: PersistentBaseRewardId): PersistentBaseRewardPlacement | null {
    const placement = this.placements.get(rewardId);
    return placement ? { ...placement } : null;
  }

  getPlacements(): PersistentBaseRewardPlacement[] {
    return [...this.placements.values()].sort((left, right) => left.placementOrder - right.placementOrder)
      .map((placement) => ({ ...placement }));
  }

  getRuntimeStates(highestUnlockedMapId: string, nowMs = this.nowMs): PersistentBaseRewardRuntimeState[] {
    return (['watchtower', 'holy_hand_pedestal', 'burrow'] as const)
      .map((rewardId) => this.getRuntimeState(rewardId, highestUnlockedMapId, nowMs));
  }

  getRuntimeState(
    rewardId: PersistentBaseRewardId,
    highestUnlockedMapId: string,
    nowMs = this.nowMs,
  ): PersistentBaseRewardRuntimeState {
    const definition = getPersistentBaseRewardDefinition(rewardId);
    if (!definition || !isCoopDefenseMapUnlocked(definition.unlockAfterMapId, highestUnlockedMapId)) {
      return state(rewardId, 'locked', 0, 0, null);
    }
    const placement = this.placements.get(rewardId);
    if (placement) return state(rewardId, 'placed', 0, 0, placement);
    const cooldownTotalMs = definition.rebuildCooldownMs;
    const remaining = Math.max(0, (this.cooldownUntil.get(rewardId) ?? 0) - nowMs);
    return state(
      rewardId,
      remaining > 0 ? 'reconstruction-cooldown' : 'available',
      remaining,
      cooldownTotalMs,
      null,
    );
  }

  place(
    rewardId: PersistentBaseRewardId,
    placement: PersistentBaseRewardPlacement,
    highestUnlockedMapId: string,
    nowMs = this.nowMs,
  ): boolean {
    const runtime = this.getRuntimeState(rewardId, highestUnlockedMapId, nowMs);
    if (runtime.availability !== 'available') return false;
    const definition = getPersistentBaseRewardDefinition(rewardId);
    if (!definition || placement.rewardId !== rewardId) return false;
    this.placements.set(rewardId, { ...placement });
    this.cooldownUntil.delete(rewardId);
    return true;
  }

  unplace(rewardId: PersistentBaseRewardId, highestUnlockedMapId: string): boolean {
    const runtime = this.getRuntimeState(rewardId, highestUnlockedMapId);
    if (runtime.availability !== 'placed') return false;
    this.placements.delete(rewardId);
    this.cooldownUntil.delete(rewardId);
    return true;
  }

  /** Atomically updates a placed reward's anchor-relative position without changing its identity. */
  reposition(
    rewardId: PersistentBaseRewardId,
    placement: PersistentBaseRewardPlacement,
    highestUnlockedMapId: string,
  ): boolean {
    const runtime = this.getRuntimeState(rewardId, highestUnlockedMapId);
    if (runtime.availability !== 'placed' || placement.rewardId !== rewardId) return false;
    const current = this.placements.get(rewardId);
    if (!current || placement.persistentId !== current.persistentId) return false;
    this.placements.set(rewardId, { ...placement });
    return true;
  }

  markRuntimeDestroyed(
    rewardId: PersistentBaseRewardId,
    highestUnlockedMapId: string,
    nowMs = this.nowMs,
  ): boolean {
    const runtime = this.getRuntimeState(rewardId, highestUnlockedMapId, nowMs);
    const definition = getPersistentBaseRewardDefinition(rewardId);
    if (runtime.availability !== 'placed' || !definition?.runtimeDestructible) return false;
    this.placements.delete(rewardId);
    this.cooldownUntil.set(rewardId, nowMs + definition.rebuildCooldownMs);
    return true;
  }
}

function clonePlacementMap(
  source: ReadonlyMap<PersistentBaseRewardId, PersistentBaseRewardPlacement>,
): Map<PersistentBaseRewardId, PersistentBaseRewardPlacement> {
  return new Map([...source.entries()].map(([rewardId, placement]) => [rewardId, { ...placement }]));
}

function state(
  rewardId: PersistentBaseRewardId,
  availability: PersistentBaseRewardAvailability,
  cooldownRemainingMs: number,
  cooldownTotalMs: number,
  placement: PersistentBaseRewardPlacement | null,
): PersistentBaseRewardRuntimeState {
  return { rewardId, availability, cooldownRemainingMs, cooldownTotalMs, placement };
}
