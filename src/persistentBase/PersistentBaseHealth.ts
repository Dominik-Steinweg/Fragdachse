/** Permanent, independent victory rewards; current damage never belongs to this state. */
export const PERSISTENT_BASE_HEALTH_REWARDS = ['map-2', 'map-3'] as const;
export type PersistentBaseHealthReward = typeof PERSISTENT_BASE_HEALTH_REWARDS[number];
export const PERSISTENT_BASE_INITIAL_HP = 2500;
export const PERSISTENT_BASE_HEALTH_REWARD_HP = 500;
/** Wire bound of the host-frozen extra core HP (Dawn expansion track). */
export const PERSISTENT_BASE_MAX_HP_BONUS = 50_000;

export function isPersistentBaseHealthRewards(value: unknown): value is PersistentBaseHealthReward[] {
  return Array.isArray(value) && new Set(value).size === value.length
    && value.every((id) => PERSISTENT_BASE_HEALTH_REWARDS.includes(id));
}

export function resolvePersistentBaseMaxHp(rewards: readonly PersistentBaseHealthReward[], hpBonus = 0): number {
  return PERSISTENT_BASE_INITIAL_HP + new Set(rewards).size * PERSISTENT_BASE_HEALTH_REWARD_HP + Math.max(0, hpBonus);
}

export function getPersistentBaseHealthReward(mapId: string): PersistentBaseHealthReward | null {
  return mapId.trim() === '2' ? 'map-2' : mapId.trim() === '3' ? 'map-3' : null;
}
