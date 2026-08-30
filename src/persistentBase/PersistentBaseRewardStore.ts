import {
  clonePersistentBaseRewardState,
  sanitizePersistentBaseRewardPlacement,
  sanitizePersistentBaseRewardState,
  type PersistentBaseRewardPlacement,
  type PersistentBaseRewardState,
  DEFAULT_PERSISTENT_BASE_REWARD_STATE,
} from './PersistentBaseRewardTypes';

/** Host-side value store for reward placements; it deliberately knows no world or renderer. */
export class PersistentBaseRewardStore {
  private committed: PersistentBaseRewardState;
  private baseline: PersistentBaseRewardState | null = null;
  private working: PersistentBaseRewardState | null = null;

  constructor(initialState: PersistentBaseRewardState = DEFAULT_PERSISTENT_BASE_REWARD_STATE) {
    const sanitized = sanitizePersistentBaseRewardState(initialState);
    if (!sanitized) throw new Error('Invalid initial persistent-base reward state');
    this.committed = clonePersistentBaseRewardState(sanitized);
  }

  get hasActiveMission(): boolean {
    return this.working !== null;
  }

  getState(): PersistentBaseRewardState {
    return clonePersistentBaseRewardState(this.working ?? this.committed);
  }

  /** Rehydrates the committed host state before a World is attached. */
  replaceCommittedState(state: PersistentBaseRewardState): boolean {
    if (this.hasActiveMission) return false;
    const sanitized = sanitizePersistentBaseRewardState(state);
    if (!sanitized) return false;
    this.committed = clonePersistentBaseRewardState(sanitized);
    this.baseline = null;
    this.working = null;
    return true;
  }

  canPlaceReward(
    rewardId: PersistentBaseRewardPlacement['rewardId'],
    unlocks: readonly PersistentBaseRewardPlacement['rewardId'][],
  ): boolean {
    const current = this.working ?? this.committed;
    // Canonical 3F placement gate: unlocked and currently unplaced. A dismantled reward becomes
    // placeable again; there is deliberately no placement history that could block a re-place.
    return unlocks.includes(rewardId)
      && !current.placements.some((entry) => entry.rewardId === rewardId);
  }

  beginMission(): void {
    if (this.working) return;
    this.baseline = clonePersistentBaseRewardState(this.committed);
    this.working = clonePersistentBaseRewardState(this.committed);
  }

  placeReward(placement: PersistentBaseRewardPlacement): boolean {
    const sanitized = sanitizePersistentBaseRewardPlacement(placement);
    if (!sanitized) return false;
    const current = this.working ?? this.committed;
    if (current.placements.some((entry) => entry.rewardId === sanitized.rewardId)) return false;
    this.replaceCurrent({
      ...current,
      // Mission edits remain working state; one revision is allocated at the outcome commit.
      revision: current.revision + (this.working ? 0 : 1),
      placements: [...current.placements, sanitized],
    });
    return true;
  }

  /**
   * Repositions an already placed reward.
   *
   * Deliberately not `dismantleReward` + `placeReward`: the reward keeps its identity, its
   * unlock and its position in the placement list, and only its cell and angle change.
   */
  moveReward(placement: PersistentBaseRewardPlacement): boolean {
    const sanitized = sanitizePersistentBaseRewardPlacement(placement);
    if (!sanitized) return false;
    const current = this.working ?? this.committed;
    if (!current.placements.some((entry) => entry.rewardId === sanitized.rewardId)) return false;
    this.replaceCurrent({
      ...current,
      revision: current.revision + (this.working ? 0 : 1),
      placements: current.placements.map((entry) => (
        entry.rewardId === sanitized.rewardId ? sanitized : entry
      )),
    });
    return true;
  }

  /** Reverts a just-applied placement when runtime materialization failed before commit. */
  rollbackPlacement(rewardId: PersistentBaseRewardPlacement['rewardId']): boolean {
    const current = this.working ?? this.committed;
    if (!current.placements.some((entry) => entry.rewardId === rewardId)) return false;
    this.replaceCurrent({
      ...current,
      // A lobby placement increments the committed revision before runtime materialization. A
      // failed request must restore the complete pre-request value, not just its placement list.
      revision: Math.max(0, current.revision - (this.working ? 0 : 1)),
      placements: current.placements.filter((entry) => entry.rewardId !== rewardId),
    });
    return true;
  }

  dismantleReward(rewardId: PersistentBaseRewardPlacement['rewardId']): boolean {
    const current = this.working ?? this.committed;
    if (!current.placements.some((entry) => entry.rewardId === rewardId)) return false;
    this.replaceCurrent({
      ...current,
      revision: current.revision + (this.working ? 0 : 1),
      placements: current.placements.filter((entry) => entry.rewardId !== rewardId),
    });
    return true;
  }

  /** Commits a lobby edit or mission result and returns the new committed value. */
  commit(): PersistentBaseRewardState | null {
    if (!this.working) return null;
    this.committed = {
      ...clonePersistentBaseRewardState(this.working),
      revision: this.working.revision + 1,
    };
    this.working = null;
    this.baseline = null;
    return clonePersistentBaseRewardState(this.committed);
  }

  rollback(): void {
    if (!this.working) return;
    this.committed = clonePersistentBaseRewardState(this.baseline ?? this.committed);
    this.working = null;
    this.baseline = null;
  }

  private replaceCurrent(next: PersistentBaseRewardState): void {
    const sanitized = sanitizePersistentBaseRewardState(next);
    if (!sanitized) throw new Error('Invalid persistent-base reward placement');
    if (this.working) this.working = sanitized;
    else this.committed = sanitized;
  }
}
