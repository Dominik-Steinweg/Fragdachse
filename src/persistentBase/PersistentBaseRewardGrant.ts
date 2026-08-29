import {
  clonePersistentBaseRewardGrant,
  isPersistentBaseRewardId,
  type PersistentBaseRewardGrant,
  type PersistentBaseRewardId,
} from './PersistentBaseRewardTypes';

export interface PersistentBaseRewardGrantRecipients {
  readonly localPlayerId: string;
  readonly applyLocal: (rewardIds: readonly PersistentBaseRewardId[]) => void;
  readonly confirmForPlayer: (playerId: string, grant: PersistentBaseRewardGrant) => void;
}

export interface PersistentBaseRewardGrantResult {
  readonly rewardIds: readonly PersistentBaseRewardId[];
  readonly newlyGrantedByPlayerId: ReadonlyMap<string, readonly PersistentBaseRewardId[]>;
}

/** Shared idempotent grant path for map victory and secondary-objective authoring. */
export class PersistentBaseRewardGrantService {
  private readonly cumulativeByPlayer = new Map<string, Set<PersistentBaseRewardId>>();
  private readonly revisionByPlayer = new Map<string, number>();

  grant(
    rewardIds: readonly PersistentBaseRewardId[],
    eligiblePlayerIds: readonly string[],
    recipients: PersistentBaseRewardGrantRecipients,
  ): PersistentBaseRewardGrantResult {
    if (!Array.isArray(rewardIds) || rewardIds.some((rewardId) => !isPersistentBaseRewardId(rewardId))) {
      return { rewardIds: [], newlyGrantedByPlayerId: new Map() };
    }
    const normalizedIds = [...new Set(rewardIds)] as PersistentBaseRewardId[];
    const newlyGrantedByPlayerId = new Map<string, readonly PersistentBaseRewardId[]>();
    const seenPlayers = new Set<string>();
    for (const playerId of eligiblePlayerIds) {
      if (typeof playerId !== 'string' || playerId.trim().length === 0 || seenPlayers.has(playerId)) continue;
      seenPlayers.add(playerId);
      const granted = this.cumulativeByPlayer.get(playerId) ?? new Set<PersistentBaseRewardId>();
      const newlyGranted = normalizedIds.filter((id) => !granted.has(id));
      if (newlyGranted.length === 0) continue;
      for (const id of newlyGranted) granted.add(id);
      this.cumulativeByPlayer.set(playerId, granted);
      newlyGrantedByPlayerId.set(playerId, newlyGranted);
      if (playerId === recipients.localPlayerId) {
        recipients.applyLocal(newlyGranted);
      } else {
        const nextGrant: PersistentBaseRewardGrant = {
          revision: (this.revisionByPlayer.get(playerId) ?? 0) + 1,
          rewardIds: [...granted].filter(isPersistentBaseRewardId),
        };
        this.revisionByPlayer.set(playerId, nextGrant.revision);
        recipients.confirmForPlayer(playerId, clonePersistentBaseRewardGrant(nextGrant));
      }
    }
    return { rewardIds: normalizedIds, newlyGrantedByPlayerId };
  }
}
