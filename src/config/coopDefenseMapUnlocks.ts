import { COOP_DEFENSE_MAP_CONFIGS, type CoopDefenseMapConfig } from './coopDefenseMaps';

/**
 * Freischaltung der Coop-Defense-Maps: rein lokaler Einzelspieler-Fortschritt.
 *
 * Die Kampagne ist linear – gespeichert wird deshalb nur die hoechste freigeschaltete Map, alles
 * davor gilt automatisch als offen. Die Reihenfolge kommt aus der Map-Registry, nicht aus der
 * numerischen Map-ID: die Registry ist die einzige Stelle, an der die Kampagnenreihenfolge steht.
 */

/** Die Testmap wird nur explizit ueber das Debug-Overlay freigeschaltet. */
export const COOP_DEFENSE_TEST_MAP_ID = '0';

/** Freischaltstand eines neuen Spielers: alles bis einschliesslich Map 1. */
export const INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID = '1';

const MAP_ORDER: readonly string[] = COOP_DEFENSE_MAP_CONFIGS.map((mapConfig) => mapConfig.mapId);

if (!MAP_ORDER.includes(INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID)) {
  throw new Error(
    `[coopDefenseMapUnlocks] Unknown initial unlocked map id: ${INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID}`,
  );
}

function indexOfMapId(mapId: string): number {
  return MAP_ORDER.indexOf(mapId);
}

/** Unbekannte oder kaputte Staende fallen auf den Startfortschritt zurueck. */
export function sanitizeHighestUnlockedCoopDefenseMapId(mapId: unknown): string {
  if (typeof mapId !== 'string') return INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID;
  const trimmedMapId = mapId.trim();
  return trimmedMapId !== COOP_DEFENSE_TEST_MAP_ID && indexOfMapId(trimmedMapId) >= 0
    ? trimmedMapId : INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID;
}

export function isCoopDefenseMapUnlocked(mapId: string, highestUnlockedMapId: string, testMapUnlocked = false): boolean {
  if (mapId === COOP_DEFENSE_TEST_MAP_ID) return testMapUnlocked;
  const mapIndex = indexOfMapId(mapId);
  if (mapIndex < 0) return false;
  return mapIndex <= indexOfMapId(sanitizeHighestUnlockedCoopDefenseMapId(highestUnlockedMapId));
}

export function getUnlockedCoopDefenseMapConfigs(highestUnlockedMapId: string, testMapUnlocked = false): readonly CoopDefenseMapConfig[] {
  return COOP_DEFENSE_MAP_CONFIGS.filter((mapConfig) => isCoopDefenseMapUnlocked(mapConfig.mapId, highestUnlockedMapId, testMapUnlocked));
}

/** Alle Maps in Kampagnenreihenfolge – Auswahlreihenfolge des Debug-Dropdowns. */
export function getCoopDefenseMapIdsInOrder(): readonly string[] {
  return MAP_ORDER;
}

/** Map, die ein Sieg auf `mapId` freischaltet; `null` am Ende der Kampagne oder bei fremder ID. */
export function getCoopDefenseMapUnlockedByVictoryOn(mapId: string): string | null {
  const mapIndex = indexOfMapId(mapId);
  if (mapIndex < 0 || mapIndex + 1 >= MAP_ORDER.length) return null;
  return MAP_ORDER[mapIndex + 1];
}

/** Der weiter fortgeschrittene der beiden Staende. */
export function maxHighestUnlockedCoopDefenseMapId(mapIdA: string, mapIdB: string): string {
  const sanitizedA = sanitizeHighestUnlockedCoopDefenseMapId(mapIdA);
  const sanitizedB = sanitizeHighestUnlockedCoopDefenseMapId(mapIdB);
  return indexOfMapId(sanitizedA) >= indexOfMapId(sanitizedB) ? sanitizedA : sanitizedB;
}
