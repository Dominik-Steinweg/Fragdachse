/** Permanent, independent victory rewards; current damage never belongs to this state. */
export const PERSISTENT_BASE_HEALTH_REWARDS = ['map-2', 'map-3'] as const;
export type PersistentBaseHealthReward = typeof PERSISTENT_BASE_HEALTH_REWARDS[number];
export const PERSISTENT_BASE_INITIAL_HP = 2500;
export const PERSISTENT_BASE_HEALTH_REWARD_HP = 500;

export function isPersistentBaseHealthRewards(value: unknown): value is PersistentBaseHealthReward[] {
  return Array.isArray(value) && new Set(value).size === value.length
    && value.every((id) => PERSISTENT_BASE_HEALTH_REWARDS.includes(id));
}

export function resolvePersistentBaseMaxHp(rewards: readonly PersistentBaseHealthReward[]): number {
  return PERSISTENT_BASE_INITIAL_HP + new Set(rewards).size * PERSISTENT_BASE_HEALTH_REWARD_HP;
}

export function getPersistentBaseHealthReward(mapId: string): PersistentBaseHealthReward | null {
  return mapId.trim() === '2' ? 'map-2' : mapId.trim() === '3' ? 'map-3' : null;
}
