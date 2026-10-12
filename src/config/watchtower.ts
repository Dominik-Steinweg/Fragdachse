/** Occupancy tuning only; footprint and HP belong to COOP_DEFENSE_CONSTRUCTIONS. */
export const WATCHTOWER_OCCUPANCY_RULES = Object.freeze({
  capacity: 4,
  rangeMultiplier: 1.2,
  adrenalineRegenMultiplier: 1.5,
  // Same interaction reach as TURRET_CONTROL_RULES.range, without a config -> system import.
  enterRangePx: 100,
  // v2: inner rail ~27 px, corner posts ~26 px; the ladder notch ends at ~24 px.
  // Centres stop at +/-23 px on solid boards, including beside the entry opening.
  platformInsetPx: 9,
});

export const WATCHTOWER_TEXTURE_KEY = 'construction_watchtower';
/** watchtower-v2 canvas at 32 px/BU; includes transparent margin beyond the footprint. */
export const WATCHTOWER_DISPLAY_SIZE = 72;
export const WATCHTOWER_COLLAPSE_SOURCE_ID = 'environment.watchtower_collapse';

export const WATCHTOWER_REWARD_ICON_KEY = 'reward_watchtower';
