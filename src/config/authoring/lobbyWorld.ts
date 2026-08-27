import {
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
 * - `actionPolicy.combat = false` – in L1 wird in der Lobby nicht gekaempft.
 * - `presentationPolicy.previewWithoutParticipation = true` – sie ist sichtbar, ohne dass
 *   jemand an ihr teilnimmt. Das ist der einzige Grund, warum sie ueberhaupt eine eigene
 *   Policy braucht.
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
  actionPolicy: { combat: false },
  presentationPolicy: { previewWithoutParticipation: true },
  // Die tatsaechliche Lobby-Uhrzeit ist host-autoritativ und wird beim Aufbau gelesen; dieser
  // Wert ist nur die Grundstimmung der World selbst.
  initialTimeOfDay: '12:00',
};

export function getLobbyWorldDefinition(): WorldDefinition {
  return LOBBY_WORLD_DEFINITION;
}
