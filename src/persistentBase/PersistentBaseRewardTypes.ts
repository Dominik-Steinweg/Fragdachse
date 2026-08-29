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
  return {
    schemaVersion: PERSISTENT_BASE_REWARD_STATE_SCHEMA_VERSION,
    revision: value.revision,
    placements,
  };
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
  };
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
