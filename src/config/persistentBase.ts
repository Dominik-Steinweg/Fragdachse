/** Zentrale, versionierte Regeln fuer die persistente Basis. */
export const PERSISTENT_BASE_STATE_SCHEMA_VERSION = 1;
export const DEFAULT_PERSISTENT_BASE_RADIUS_CELLS = 5;
export const MAX_PERSISTENT_BASE_RADIUS_CELLS = 10;
export const PERSISTENT_BASE_CLEARANCE_CELLS = 2;


/**
 * Map, deren erster Sieg die persistente Basis dauerhaft freischaltet.
 *
 * Das Entitlement ist bewusst eigenstaendig und nicht aus dem Mapfortschritt abgeleitet: Nicht
 * "Map 2 ist offen" impliziert nebenbei die Basis, sondern die Progression vergibt sie explizit.
 * Nur so lassen sich Freischaltung und Kampagnenfortschritt spaeter unabhaengig veraendern.
 */
export const PERSISTENT_BASE_UNLOCK_AFTER_MAP_ID = '1';
