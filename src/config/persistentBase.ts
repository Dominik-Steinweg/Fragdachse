/** Zentrale, versionierte Regeln fuer die persistente Basis. */
export const PERSISTENT_BASE_STATE_SCHEMA_VERSION = 1;
/** Version of the device-local personal contribution introduced by Phase 3. */
export const PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION = 4;
export const DEFAULT_PERSISTENT_BASE_RADIUS_CELLS = 5;
export const MAX_PERSISTENT_BASE_RADIUS_CELLS = 10;
export const PERSISTENT_BASE_CLEARANCE_CELLS = 2;

/** The first campaign victory which makes the base/editor available. */
export const PERSISTENT_BASE_UNLOCK_AFTER_MAP_ID = '10';
/** The first victory which expands the technical build zone. */
export const PERSISTENT_BASE_RADIUS_UPGRADE_AFTER_MAP_ID = '14';
/** Radius is campaign state; this is deliberately not derived from map geometry. */
export const PERSISTENT_BASE_RADIUS_AFTER_UPGRADE = Math.min(
  MAX_PERSISTENT_BASE_RADIUS_CELLS,
  DEFAULT_PERSISTENT_BASE_RADIUS_CELLS + 2,
);
