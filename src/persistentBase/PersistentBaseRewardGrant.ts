import {
  sanitizePersistentBaseRewardGrantIds,
  type PersistentBaseRewardId,
} from './PersistentBaseRewardTypes';

export interface PersistentBaseRewardGrantRecipients {
  readonly localPlayerId: string;
  /** Applies the request to local persistence and returns IDs newly accepted there. */
  readonly applyLocal: (rewardIds: readonly PersistentBaseRewardId[]) => readonly PersistentBaseRewardId[];
  /**
   * Hands the request to the confirmation layer. That layer owns the cumulative/revision
   * state and returns IDs newly accepted there.
   */
  readonly confirmForPlayer: (
    playerId: string,
    rewardIds: readonly PersistentBaseRewardId[],
  ) => readonly PersistentBaseRewardId[];
}

export interface PersistentBaseRewardGrantResult {
  readonly rewardIds: readonly PersistentBaseRewardId[];
  readonly newlyGrantedByPlayerId: ReadonlyMap<string, readonly PersistentBaseRewardId[]>;
}

/** Shared idempotent grant path for map victory and secondary-objective authoring. */
export class PersistentBaseRewardGrantService {
  grant(
    rewardIds: readonly PersistentBaseRewardId[],
    eligiblePlayerIds: readonly string[],
    recipients: PersistentBaseRewardGrantRecipients,
  ): PersistentBaseRewardGrantResult {
    const normalizedIds = sanitizePersistentBaseRewardGrantIds(rewardIds);
    if (!normalizedIds || !Array.isArray(eligiblePlayerIds) || normalizedIds.length === 0) {
      return { rewardIds: [], newlyGrantedByPlayerId: new Map() };
    }
    const newlyGrantedByPlayerId = new Map<string, readonly PersistentBaseRewardId[]>();
    const seenPlayers = new Set<string>();
    for (const playerId of eligiblePlayerIds) {
      if (typeof playerId !== 'string' || playerId.trim().length === 0 || seenPlayers.has(playerId)) continue;
      seenPlayers.add(playerId);
      const accepted = playerId === recipients.localPlayerId
        ? recipients.applyLocal(normalizedIds)
        : recipients.confirmForPlayer(playerId, normalizedIds);
      const newlyGranted = (sanitizePersistentBaseRewardGrantIds(accepted) ?? [])
        .filter((rewardId) => normalizedIds.includes(rewardId));
      if (newlyGranted.length > 0) newlyGrantedByPlayerId.set(playerId, newlyGranted);
    }
    return { rewardIds: normalizedIds, newlyGrantedByPlayerId };
  }
}
