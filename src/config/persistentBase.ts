/** Zentrale, versionierte Regeln fuer die persistente Basis. */
export const PERSISTENT_BASE_STATE_SCHEMA_VERSION = 2;
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

/** Map-Sieg, der die naechste semantische Area-Stufe dauerhaft freischaltet. */
export const PERSISTENT_BASE_AREA_STAGE_UNLOCK_AFTER_MAP_ID = '10';

/**
 * Schemaversion des persoenlichen Basisbeitrags.
 *
 * Er ist ein eigenes Subdokument neben dem uebrigen Fortschritt: Jeder Spieler nimmt genau diesen
 * Beitrag zu jedem Host mit, unabhaengig davon, in wessen Raum er gerade spielt.
 */
export const PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION = 1;

/** Obergrenze eines einzelnen Beitrags an der Speicher- und Netzwerkgrenze. */
export const MAX_PERSISTENT_CONSTRUCTIONS_PER_CONTRIBUTION = 512;

/** Version of the host-owned persistent-base reward placement document. */
export const PERSISTENT_BASE_REWARD_STATE_SCHEMA_VERSION = 1;

/** A base has one placement slot per unlocked reward in 3D-1. */
export const MAX_PERSISTENT_BASE_REWARD_PLACEMENTS = 32;
