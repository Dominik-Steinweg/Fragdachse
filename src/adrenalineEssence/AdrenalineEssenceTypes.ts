/** Match essence belongs to its Activity; explicit Lobby practice essence belongs to its World. */
export interface EssenceScope {
  readonly worldRevision: number;
  /** Positive for a real Activity; null only for the explicitly enabled Lobby World binding.
   * This absence never creates an ActivityDescriptor or enables other Worlds without Activity. */
  readonly activityRevision: number | null;
}

export interface EssencePoint { readonly x: number; readonly y: number }

export type EssenceAccessGroup =
  | { readonly kind: 'coop' }
  | { readonly kind: 'team'; readonly teamId: string }
  | { readonly kind: 'personal'; readonly playerId: string };

export function essenceAccessGroupKey(group: EssenceAccessGroup): string {
  return group.kind === 'coop' ? 'coop'
    : JSON.stringify([group.kind, group.kind === 'team' ? group.teamId : group.playerId]);
}

export function hasEssenceAccess(group: EssenceAccessGroup, candidate: EssenceAccessGroup | null): boolean {
  return candidate !== null && essenceAccessGroupKey(group) === essenceAccessGroupKey(candidate);
}

/** Visibility ignores death, resource capacity and burrow, but requires interactive participation. */
export function canSeeEssence(group: EssenceAccessGroup, player: Pick<EssencePlayerSnapshot, 'interactive' | 'accessGroup'>): boolean {
  return player.interactive && hasEssenceAccess(group, player.accessGroup);
}

export type EssenceCancelReason = 'death' | 'life' | 'burrow' | 'underground' | 'participation' | 'access' | 'disconnect' | 'teardown';

export interface EssencePlayerSnapshot extends EssencePoint {
  readonly playerId: string;
  readonly lifeRevision: number;
  readonly participationRevision: number;
  readonly interactive: boolean;
  readonly alive: boolean;
  /** False for burrow wind-up, underground, trapped and tunnel transit. */
  readonly collectible: boolean;
  readonly blockedReason?: 'burrow' | 'underground';
  readonly accessGroup: EssenceAccessGroup | null;
  readonly adrenaline: number;
  readonly maxAdrenaline: number;
}

/** Projection of a confirmed combat reward; no combat intent can call this seam by itself. */
export interface EssenceReward extends EssenceScope {
  readonly id: string;
  readonly creatorId: string;
  readonly authoredValue: number;
  readonly resolvedValue: number;
  readonly origin: EssencePoint;
  readonly createdAt: number;
  readonly seed: number;
  readonly accessGroup: EssenceAccessGroup;
  readonly weaponId?: string;
  readonly branchId?: string;
  readonly targetKind?: string;
  readonly distance?: number;
}

export interface EssenceClusterSnapshot {
  readonly id: string;
  readonly accessGroup: EssenceAccessGroup;
  readonly x: number;
  readonly y: number;
  readonly originX: number;
  readonly originY: number;
  readonly seed: number;
  readonly value: number;
  readonly createdAt: number;
  readonly landAt: number;
  /** Earliest remaining contribution expiry; later buckets retain their own host expiry. */
  readonly expiresAt: number;
  /** Cosmetic final fade must preserve younger buckets when the earliest bucket expires. */
  readonly lastExpiresAt?: number;
  readonly state: 'ejecting' | 'grounded';
  readonly lastMergeAt?: number;
}

export interface EssenceTransferSnapshot {
  readonly id: string;
  readonly clusterId: string;
  readonly accessGroup: EssenceAccessGroup;
  readonly playerId: string;
  readonly lifeRevision: number;
  readonly participationRevision: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly value: number;
  readonly startedAt: number;
  readonly arrivalAt: number;
  readonly seed: number;
}

export interface EssenceTransferReceipt extends EssenceScope {
  /** Transfer identity also deduplicates the terminal presentation signal. */
  readonly id: string;
  readonly status: 'committed' | 'returned' | 'expired' | 'cancelled';
  readonly reason?: EssenceCancelReason;
  readonly accessGroup: EssenceAccessGroup;
  readonly playerId: string;
  readonly lifeRevision: number;
  readonly participationRevision: number;
  readonly creditedValue: number;
  readonly returnedValue: number;
  readonly expiredValue: number;
  readonly resourceRevision: number;
  readonly completedAt: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly targetX: number;
  readonly targetY: number;
}

export interface EssenceState extends EssenceScope {
  readonly revision: number;
  readonly clusters: readonly EssenceClusterSnapshot[];
  /** Only active transfers, never historical arrival events, belong in full/JIP state. */
  readonly transfers: readonly EssenceTransferSnapshot[];
}

export interface EssenceAttributionDiagnostics {
  readonly creatorId: string;
  readonly weaponId: string;
  readonly branchId: string;
  readonly targetKind: string;
  readonly distanceBand: string;
  readonly rewardCount: number;
  readonly authoredValue: number;
  readonly materializedValue: number;
  readonly committedValue: number;
  readonly creatorCollectedValue: number;
  readonly allyCollectedValue: number;
}

export interface EssenceDiagnostics {
  readonly materializedValue: number;
  readonly authoredValue: number;
  readonly committedValue: number;
  readonly expiredValue: number;
  readonly placementFailedValue: number;
  readonly lifecycleDiscardedValue: number;
  readonly returnedValue: number;
  readonly expiredReturnValue: number;
  readonly ejectingValue: number;
  readonly groundedValue: number;
  readonly reservedValue: number;
  readonly activeValue: number;
  readonly conservationError: number;
  readonly rewardCount: number;
  readonly duplicateRewardCount: number;
  readonly staleRewardCount: number;
  readonly invalidRewardCount: number;
  readonly placementFailureCount: number;
  readonly mergeCount: number;
  readonly clusterCount: number;
  readonly contributionCount: number;
  readonly transferCount: number;
  readonly dedupeCount: number;
  readonly peakClusterCount: number;
  readonly peakTransferCount: number;
  readonly candidateChecks: number;
  readonly lineOfSightChecks: number;
  readonly meanLandingDelayMs: number;
  readonly meanTransferStartDelayMs: number;
  readonly meanTransferDurationMs: number;
  /** Accumulated wall-clock CPU diagnostics; these never enter authoritative decisions. */
  readonly cpuMs: Readonly<{ materialize: number; transfers: number; landingMergeExpiry: number; candidates: number }>;
  readonly cancellations: Readonly<Record<EssenceCancelReason, number>>;
  readonly byAttribution: readonly EssenceAttributionDiagnostics[];
}

export interface AdrenalineEssencePorts {
  readonly getPlayers: () => readonly EssencePlayerSnapshot[];
  /** Validates an already scattered candidate, using bounded nearby fallback if needed. */
  readonly resolveGroundPoint: (candidate: EssencePoint, seed: number) => EssencePoint | null;
  readonly hasLineOfSight: (from: EssencePoint, to: EssencePoint) => boolean;
  /** Atomically caps the already resolved amount; never applies gain modifiers again. */
  readonly commitResolvedGain: (playerId: string, value: number) => { readonly creditedValue: number; readonly resourceRevision: number };
  readonly onPlacementFailure?: (reward: EssenceReward) => void;
}

/** IEEE-754 values pass unchanged through host, JSON snapshots and resource commit.
 * This tolerance is only for conservation diagnostics/tests, never for deleting small values. */
export const ESSENCE_VALUE_TOLERANCE = 1e-9;
