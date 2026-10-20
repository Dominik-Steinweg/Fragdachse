/** Kill-feed and combat source of everything that falls with a collapsing bridge. */
export const BRIDGE_COLLAPSE_SOURCE_ID = 'environment.bridge_collapse';
/** Non-player killer of the fall itself: no frags, no teamkill, no drop. */
export const BRIDGE_COLLAPSE_KILLER_ID = '__bridge__';

/** Authoritative demolition rules (host); clients only read them for presentation. */
export const BRIDGE_DEMOLITION_RULES = {
  /** Burning fuse between planting and the collapse. */
  fuseMs: 5000,
  /** Shift range around the deck rectangle, in px. */
  interactRangePx: 40,
  /** Enemy-only blast around the charge point. */
  blastRadiusPx: 112,
  blastDamage: 140,
  /** Bosses keep their footing; the fall costs them this share of their maximum HP. */
  bossDamageFraction: 0.35,
} as const;
