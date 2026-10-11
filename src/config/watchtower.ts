/** Occupancy tuning only; footprint and HP belong to COOP_DEFENSE_CONSTRUCTIONS. */
export const WATCHTOWER_OCCUPANCY_RULES = Object.freeze({
  capacity: 4,
  rangeMultiplier: 1.2,
  adrenalineRegenMultiplier: 1.5,
  // Same interaction reach as TURRET_CONTROL_RULES.range, without a config -> system import.
  enterRangePx: 100,
  // Rail inner edge is ~21 px from centre; keep centres on the planks.
  platformInsetPx: 14,
});

export const WATCHTOWER_TEXTURE_KEY = 'construction_watchtower';
export const WATCHTOWER_COLLAPSE_SOURCE_ID = 'environment.watchtower_collapse';

export const WATCHTOWER_REWARD_ICON_KEY = 'reward_watchtower';
