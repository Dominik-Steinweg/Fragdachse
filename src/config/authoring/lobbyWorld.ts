import {
  LOBBY_SPAWN_EXCLUSION_ZONES,
  LOBBY_WORLD_HEIGHT_CELLS,
  LOBBY_WORLD_WIDTH_CELLS,
} from '../../arena/LobbyWorldLayout';
import type { WorldDefinition } from './WorldDefinition';

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

const LOBBY_WORLD_DEFINITION: WorldDefinition = {
  id: LOBBY_WORLD_DEFINITION_ID,
  metrics: {
    widthCells: LOBBY_WORLD_WIDTH_CELLS,
    heightCells: LOBBY_WORLD_HEIGHT_CELLS,
  },
  // Die Geometrie ist vollstaendig authored; es gibt nichts zu generieren.
  terrain: {},
  bases: [],
  // Die LobbyWorld folgt dem aktuell gewaehlten Spielmodus. Sie ist damit im Deathmatch
  // frei fuer alle, in Coop kooperativ und in Team-Modi teambezogen – ohne Fake-Activity.
  actionPolicy: { combat: true, playerRelationships: 'game-mode' },
  presentationPolicy: { previewWithoutParticipation: true },
  participationPolicy: { selfAdmit: true },
  spawnExclusionZones: LOBBY_SPAWN_EXCLUSION_ZONES,
  // Die tatsaechliche Lobby-Uhrzeit ist host-autoritativ und wird beim Aufbau gelesen; dieser
  // Wert ist nur die Grundstimmung der World selbst.
  initialTimeOfDay: '12:00',
};

export function getLobbyWorldDefinition(): WorldDefinition {
  return LOBBY_WORLD_DEFINITION;
}
