import {
  MAX_PERSISTENT_BASE_REWARD_PLACEMENTS,
  PERSISTENT_BASE_REWARD_STATE_SCHEMA_VERSION,
} from '../config/persistentBase';

export const PERSISTENT_BASE_REWARD_IDS = [
  'base_adrenaline_pedestal',
  'base_spore_turret',
  'base_health_pedestal',
  'base_rocket_turret',
  'base_holy_hand_grenade_pedestal',
] as const;

export type PersistentBaseRewardId = typeof PERSISTENT_BASE_REWARD_IDS[number];

export type PersistentBaseRewardCategory = 'basePedestal' | 'baseTurret';
export type PersistentBaseRewardPlacementRule = 'base-surface' | 'courtyard-build-area';

export interface PersistentBaseRewardPlacement {
  readonly rewardId: PersistentBaseRewardId;
  readonly relativeGridX: number;
  readonly relativeGridY: number;
  readonly angle: number;
}

export interface PersistentBaseRewardState {
  readonly schemaVersion: typeof PERSISTENT_BASE_REWARD_STATE_SCHEMA_VERSION;
  readonly revision: number;
  readonly placements: readonly PersistentBaseRewardPlacement[];
  /** Rewards that have already occupied the base once; used by the later dismantle contract. */
  readonly everPlacedRewardIds?: readonly PersistentBaseRewardId[];
}

/** Complete host-owned reward projection shared with every peer. */
export interface PersistentBaseRewardSessionState {
  readonly worldRevision: number;
  readonly revision: number;
  readonly availableRewardIds: readonly PersistentBaseRewardId[];
  readonly placements: readonly PersistentBaseRewardPlacement[];
}

/** World-bound host request for a first-time reward placement. */
export interface PersistentBaseRewardPlacementRequest {
  readonly worldRevision: number;
  readonly rewardId: PersistentBaseRewardId;
  readonly relativeGridX: number;
  readonly relativeGridY: number;
  readonly angle: number;
}

export interface PersistentBaseRewardGrant {
  /** Monotone per-player confirmation revision, not a round or world revision. */
  readonly revision: number;
  /** Cumulative set of reward IDs confirmed for one player. */
  readonly rewardIds: readonly PersistentBaseRewardId[];
}

export type PersistentBaseRewardStatus = 'locked' | 'unplaced' | 'placed';

export const DEFAULT_PERSISTENT_BASE_REWARD_STATE: PersistentBaseRewardState = Object.freeze({
  schemaVersion: PERSISTENT_BASE_REWARD_STATE_SCHEMA_VERSION,
  revision: 0,
  placements: Object.freeze([]),
  everPlacedRewardIds: Object.freeze([]),
});

export function isPersistentBaseRewardId(value: unknown): value is PersistentBaseRewardId {
  return typeof value === 'string'
    && (PERSISTENT_BASE_REWARD_IDS as readonly string[]).includes(value);
}

/** Strictly validates a reward list: unknown and duplicate IDs invalidate the whole value. */
export function sanitizePersistentBaseRewardIds(value: unknown): PersistentBaseRewardId[] | null {
  if (!Array.isArray(value) || value.length > PERSISTENT_BASE_REWARD_IDS.length) return null;
  const seen = new Set<PersistentBaseRewardId>();
  const result: PersistentBaseRewardId[] = [];
  for (const rawId of value) {
    if (!isPersistentBaseRewardId(rawId) || seen.has(rawId)) return null;
    seen.add(rawId);
    result.push(rawId);
  }
  return result;
}

export function sanitizePersistentBaseRewardPlacement(value: unknown): PersistentBaseRewardPlacement | null {
  if (!isRecord(value)
    || !isPersistentBaseRewardId(value.rewardId)
    || !isSafeIntegerInRange(value.relativeGridX, -1_000_000, 1_000_000)
    || !isSafeIntegerInRange(value.relativeGridY, -1_000_000, 1_000_000)
    || typeof value.angle !== 'number'
    || !Number.isFinite(value.angle)) {
    return null;
  }
  return {
    rewardId: value.rewardId,
    relativeGridX: value.relativeGridX,
    relativeGridY: value.relativeGridY,
    angle: value.angle,
  };
}

export function sanitizePersistentBaseRewardState(value: unknown): PersistentBaseRewardState | null {
  if (!isRecord(value)
    || value.schemaVersion !== PERSISTENT_BASE_REWARD_STATE_SCHEMA_VERSION
    || !isSafeIntegerInRange(value.revision, 0, Number.MAX_SAFE_INTEGER)
    || !Array.isArray(value.placements)
    || value.placements.length > MAX_PERSISTENT_BASE_REWARD_PLACEMENTS) {
    return null;
  }
  const seen = new Set<PersistentBaseRewardId>();
  const placements: PersistentBaseRewardPlacement[] = [];
  for (const rawPlacement of value.placements) {
    const placement = sanitizePersistentBaseRewardPlacement(rawPlacement);
    if (!placement || seen.has(placement.rewardId)) return null;
    seen.add(placement.rewardId);
    placements.push(placement);
  }
  const rawEverPlaced = value.everPlacedRewardIds === undefined
    ? placements.map((placement) => placement.rewardId)
    : sanitizePersistentBaseRewardIds(value.everPlacedRewardIds);
  if (!rawEverPlaced) return null;
  const everPlacedRewardIds = [...new Set(rawEverPlaced)] as PersistentBaseRewardId[];
  if (placements.some((placement) => !everPlacedRewardIds.includes(placement.rewardId))) return null;
  const normalized: PersistentBaseRewardState = {
    schemaVersion: PERSISTENT_BASE_REWARD_STATE_SCHEMA_VERSION,
    revision: value.revision,
    placements,
    ...(value.everPlacedRewardIds === undefined ? {} : { everPlacedRewardIds }),
  };
  // Keep the 3D-1 wire/save shape backward-compatible when reading a legacy state. The store
  // treats the placement list as the implicit history in that case; new writes include the
  // explicit one-time-placement marker.
  return normalized;
}

export function sanitizePersistentBaseRewardGrant(value: unknown): PersistentBaseRewardGrant | null {
  if (!isRecord(value)
    || !isSafeIntegerInRange(value.revision, 0, Number.MAX_SAFE_INTEGER)) return null;
  const rewardIds = sanitizePersistentBaseRewardIds(value.rewardIds);
  if (!rewardIds) return null;
  return { revision: value.revision, rewardIds };
}

export function clonePersistentBaseRewardPlacement(
  placement: PersistentBaseRewardPlacement,
): PersistentBaseRewardPlacement {
  return { ...placement };
}

export function clonePersistentBaseRewardState(
  state: PersistentBaseRewardState,
): PersistentBaseRewardState {
  return {
    schemaVersion: PERSISTENT_BASE_REWARD_STATE_SCHEMA_VERSION,
    revision: state.revision,
    placements: state.placements.map(clonePersistentBaseRewardPlacement),
    everPlacedRewardIds: [...(state.everPlacedRewardIds ?? state.placements.map((placement) => placement.rewardId))],
  };
}

export function clonePersistentBaseRewardSessionState(
  state: PersistentBaseRewardSessionState,
): PersistentBaseRewardSessionState {
  return {
    worldRevision: state.worldRevision,
    revision: state.revision,
    availableRewardIds: [...state.availableRewardIds],
    placements: state.placements.map(clonePersistentBaseRewardPlacement),
  };
}

export function sanitizePersistentBaseRewardSessionState(
  value: unknown,
): PersistentBaseRewardSessionState | null {
  if (!isRecord(value)
    || !isSafeIntegerInRange(value.worldRevision, 0, Number.MAX_SAFE_INTEGER)
    || !isSafeIntegerInRange(value.revision, 0, Number.MAX_SAFE_INTEGER)) return null;
  const availableRewardIds = sanitizePersistentBaseRewardIds(value.availableRewardIds);
  if (!availableRewardIds || !Array.isArray(value.placements)) return null;
  const placements = sanitizePersistentBaseRewardState({
    schemaVersion: PERSISTENT_BASE_REWARD_STATE_SCHEMA_VERSION,
    revision: value.revision,
    placements: value.placements,
  });
  if (!placements) return null;
  if (placements.placements.some((placement) => !availableRewardIds.includes(placement.rewardId))) return null;
  return {
    worldRevision: value.worldRevision,
    revision: value.revision,
    availableRewardIds,
    placements: placements.placements,
  };
}

export function sanitizePersistentBaseRewardPlacementRequest(
  value: unknown,
): PersistentBaseRewardPlacementRequest | null {
  if (!isRecord(value)
    || !isSafeIntegerInRange(value.worldRevision, 0, Number.MAX_SAFE_INTEGER)) return null;
  const placement = sanitizePersistentBaseRewardPlacement(value);
  if (!placement) return null;
  return { worldRevision: value.worldRevision, ...placement };
}

export function clonePersistentBaseRewardGrant(
  grant: PersistentBaseRewardGrant,
): PersistentBaseRewardGrant {
  return { revision: grant.revision, rewardIds: [...grant.rewardIds] };
}

export function getPersistentBaseRewardStatus(
  rewardId: PersistentBaseRewardId,
  unlocks: readonly PersistentBaseRewardId[],
  state: PersistentBaseRewardState,
): PersistentBaseRewardStatus {
  if (!unlocks.includes(rewardId)) return 'locked';
  return state.placements.some((placement) => placement.rewardId === rewardId)
    ? 'placed'
    : 'unplaced';
}

function isSafeIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= min
    && value <= max;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
