import {
  LOBBY_SPAWN_EXCLUSION_ZONES,
  LOBBY_SPAWN_FOCUS_CELL,
  LOBBY_WORLD_HEIGHT_CELLS,
  LOBBY_WORLD_WIDTH_CELLS,
} from '../../arena/LobbyWorldLayout';
import { buildPersistentBaseCoreBaseConfig } from '../../persistentBase/PersistentBaseCore';
import type { WorldDefinition, WorldPersistentBaseSiteDefinition } from './WorldDefinition';

/**
 * Die LobbyWorld als regulaere authored World.
 *
 * Sie ist keine Activity, kein GameMode und keine Sondersimulation: dieselbe
 * {@link WorldDefinition} wie jede Match-World, nur mit anderem Inhalt. Was sie besonders
 * macht, steht ausschliesslich in ihren Policies:
 *
 * - `actionPolicy.combat = true` – wer sie betritt, spielt mit dem normalen, von der Activity
 *   unabhaengigen World-Gameplay. Ein Treffer hier ist trotzdem kein Rundenereignis: Score,
 *   Rewards und Missionsfortschritt haengen an der Activity, nicht am Kampf.
 * - `presentationPolicy.previewWithoutParticipation = true` – sie ist sichtbar, ohne dass
 *   jemand an ihr teilnimmt.
 * - `participationPolicy.selfAdmit = true` – sie hat keine Activity, die ihre Besetzung taktet;
 *   deshalb entscheidet jeder Spieler selbst ueber Eintritt und Austritt.
 *
 * Ihre Geometrie liegt in `src/arena/LobbyWorldLayout.ts` und wird ueber die World-Layout-Quelle
 * aufgeloest, nicht ueber den prozeduralen Generator. Deshalb traegt diese Definition weder
 * Fuellgrad noch Felsfeld noch Gleise.
 */
export const LOBBY_WORLD_DEFINITION_ID = 'world:lobby';

/** True, wenn diese World-Identitaet die LobbyWorld meint. */
export function isLobbyWorldDefinitionId(definitionId: string): boolean {
  return definitionId === LOBBY_WORLD_DEFINITION_ID;
}

/** Basis-ID des persistenten Basiskerns in der LobbyWorld. */
export const LOBBY_PERSISTENT_BASE_ID = 'lobby-persistent-base';

/**
 * Die persistente Basis der Lobby steht in der Mitte der World.
 *
 * Das ist genau die Flaeche, die `LOBBY_UI_RESERVED_ZONES` seit jeher von Geometrie freihaelt,
 * und zugleich der authored Spawn-Fokus: Weil der Anker die Mittelzelle des Innenhofs ist,
 * materialisiert im eigenen Hof, wer das Testgelaende betritt.
 *
 * Die Basis existiert in dieser Definition unabhaengig davon, ob der Spieler sie besitzt. Ob sie
 * tatsaechlich aufgebaut wird, entscheidet der host-autoritative World-Parameter
 * `persistentBaseUnlocked` – eine Definition ist keine Progression.
 */
const LOBBY_PERSISTENT_BASE_SITE: WorldPersistentBaseSiteDefinition = {
  baseId: LOBBY_PERSISTENT_BASE_ID,
  anchor: { gridX: LOBBY_SPAWN_FOCUS_CELL.gridX, gridY: LOBBY_SPAWN_FOCUS_CELL.gridY },
  // Ohne Activity nimmt der Kern ohnehin keinen Schaden; der Wert ist die Grunddauerhaftigkeit
  // des Bauwerks, nicht die HP eines Missionsziels.
  hpMax: 5000,
};

const LOBBY_WORLD_DEFINITION: WorldDefinition = {
  id: LOBBY_WORLD_DEFINITION_ID,
  metrics: {
    widthCells: LOBBY_WORLD_WIDTH_CELLS,
    heightCells: LOBBY_WORLD_HEIGHT_CELLS,
  },
  // Die Geometrie ist vollstaendig authored; es gibt nichts zu generieren.
  terrain: {},
  // Die einzige Struktur der Lobby ist der persistente Basiskern; seine Form kommt aus der
  // kanonischen Kerngeometrie, nicht aus dieser Datei.
  bases: [buildPersistentBaseCoreBaseConfig(LOBBY_PERSISTENT_BASE_SITE)],
  persistentBaseSite: LOBBY_PERSISTENT_BASE_SITE,
  // Die LobbyWorld folgt dem aktuell gewaehlten Spielmodus. Sie ist damit im Deathmatch
  // frei fuer alle, in Coop kooperativ und in Team-Modi teambezogen – ohne Fake-Activity.
  actionPolicy: { combat: true, playerRelationships: 'game-mode' },
  presentationPolicy: { previewWithoutParticipation: true },
  participationPolicy: { selfAdmit: true },
  spawnExclusionZones: LOBBY_SPAWN_EXCLUSION_ZONES,
  // Das Testgelaende ist eine Buehne, kein Gefecht: wer es betritt, soll mittendrin stehen statt
  // erst quer ueber die World laufen zu muessen.
  spawnFocusCell: LOBBY_SPAWN_FOCUS_CELL,
  // Die tatsaechliche Lobby-Uhrzeit ist host-autoritativ und wird beim Aufbau gelesen; dieser
  // Wert ist nur die Grundstimmung der World selbst.
  initialTimeOfDay: '12:00',
};

export function getLobbyWorldDefinition(): WorldDefinition {
  return LOBBY_WORLD_DEFINITION;
}
