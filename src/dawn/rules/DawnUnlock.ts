import { COOP_DEFENSE_CAMPAIGN_MAP_COUNT } from '../../config/coopDefenseMaps';

export const DAWN_UNLOCK_AFTER_MAP_ID = String(COOP_DEFENSE_CAMPAIGN_MAP_COUNT);

/**
 * Selecting or unlocking the final map is insufficient: the host must have won it. The debug menu
 * may open Dawn separately (D-48); that flag never counts as a campaign win.
 */
export function isDawnUnlocked({ completedMapIds, dawn }: {
  readonly completedMapIds: readonly string[];
  readonly dawn?: { readonly debugUnlocked?: true } | null;
}): boolean {
  return completedMapIds.includes(DAWN_UNLOCK_AFTER_MAP_ID) || dawn?.debugUnlocked === true;
}
