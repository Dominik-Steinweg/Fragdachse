import { COOP_DEFENSE_CAMPAIGN_MAP_COUNT } from '../../config/coopDefenseMaps';

export const DAWN_UNLOCK_AFTER_MAP_ID = String(COOP_DEFENSE_CAMPAIGN_MAP_COUNT);

/** Selecting or unlocking the final map is insufficient: the host must have won it. */
export function isDawnUnlocked({ completedMapIds }: { readonly completedMapIds: readonly string[] }): boolean {
  return completedMapIds.includes(DAWN_UNLOCK_AFTER_MAP_ID);
}
