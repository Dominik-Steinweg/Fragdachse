import { COOP_DEFENSE_MAP_CONFIGS, type CoopDefenseMapConfig } from './coopDefenseMaps';

/**
 * Freischaltung der Coop-Defense-Maps: rein lokaler Einzelspieler-Fortschritt.
 *
 * Die Kampagne ist linear – gespeichert wird deshalb nur die hoechste freigeschaltete Map, alles
 * davor gilt automatisch als offen. Die Reihenfolge kommt aus der Map-Registry, nicht aus der
 * numerischen Map-ID: die Registry ist die einzige Stelle, an der die Kampagnenreihenfolge steht.
 */

/** Testmap – bleibt unabhaengig vom Fortschritt waehlbar. */
const ALWAYS_UNLOCKED_MAP_IDS: ReadonlySet<string> = new Set(['0']);

/** Freischaltstand eines neuen Spielers: alles bis einschliesslich Map 1. */
export const INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID = '1';
const LEGACY_HIGHEST_UNLOCKED_MAP_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  '16': '15',
});

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
  const migratedMapId = LEGACY_HIGHEST_UNLOCKED_MAP_ALIASES[trimmedMapId] ?? trimmedMapId;
  return indexOfMapId(migratedMapId) >= 0 ? migratedMapId : INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID;
}

export function isCoopDefenseMapUnlocked(mapId: string, highestUnlockedMapId: string): boolean {
  if (ALWAYS_UNLOCKED_MAP_IDS.has(mapId)) return true;
  const mapIndex = indexOfMapId(mapId);
  if (mapIndex < 0) return false;
  return mapIndex <= indexOfMapId(sanitizeHighestUnlockedCoopDefenseMapId(highestUnlockedMapId));
}

export function getUnlockedCoopDefenseMapConfigs(highestUnlockedMapId: string): readonly CoopDefenseMapConfig[] {
  return COOP_DEFENSE_MAP_CONFIGS.filter((mapConfig) => isCoopDefenseMapUnlocked(mapConfig.mapId, highestUnlockedMapId));
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
