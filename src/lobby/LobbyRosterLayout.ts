import { MAX_PLAYERS } from '../config';
import { hasTeamSelection } from '../gameModes';
import type { GameMode, TeamId } from '../types';

export const LOBBY_TEAM_CAPACITY = MAX_PLAYERS / 2;

export interface LobbyRosterPlayer {
  readonly id: string;
  readonly teamId: TeamId | null;
}

export interface LobbyRosterSlot {
  readonly column: 0 | 1;
  readonly row: number;
  readonly teamId: TeamId | null;
  readonly playerId: string | null;
  readonly invite: boolean;
}

/**
 * Pure Slot-Zuordnung fuer die Lobby. Die Eingabereihenfolge bleibt innerhalb eines Rasters
 * bzw. Teams stabil; freie Plaetze werden bis zur globalen Raumgrenze immer mit ausgegeben.
 */
export function buildLobbyRosterSlots(
  mode: GameMode,
  players: readonly LobbyRosterPlayer[],
): LobbyRosterSlot[] {
  if (!hasTeamSelection(mode)) {
    const visiblePlayers = players.slice(0, MAX_PLAYERS);
    const inviteIndex = visiblePlayers.length < MAX_PLAYERS ? visiblePlayers.length : -1;
    return Array.from({ length: MAX_PLAYERS }, (_, index) => ({
      column: (index % 2) as 0 | 1,
      row: Math.floor(index / 2),
      teamId: null,
      playerId: visiblePlayers[index]?.id ?? null,
      invite: index === inviteIndex,
    }));
  }

  const blue = players.filter((player) => player.teamId === 'blue').slice(0, LOBBY_TEAM_CAPACITY);
  const red = players.filter((player) => player.teamId === 'red').slice(0, LOBBY_TEAM_CAPACITY);
  const inviteTeam = pickInviteTeam(blue.length, red.length);

  return (['blue', 'red'] as const).flatMap((teamId, column) => {
    const teamPlayers = teamId === 'blue' ? blue : red;
    const inviteRow = inviteTeam === teamId ? teamPlayers.length : -1;
    return Array.from({ length: LOBBY_TEAM_CAPACITY }, (_, row) => ({
      column: column as 0 | 1,
      row,
      teamId,
      playerId: teamPlayers[row]?.id ?? null,
      invite: row === inviteRow,
    }));
  });
}

/** Kleinere Mannschaft gewinnt; bei Gleichstand deterministisch Blau. */
export function pickAutomaticTeam(blueCount: number, redCount: number): TeamId | null {
  if (blueCount >= LOBBY_TEAM_CAPACITY && redCount >= LOBBY_TEAM_CAPACITY) return null;
  if (blueCount >= LOBBY_TEAM_CAPACITY) return 'red';
  if (redCount >= LOBBY_TEAM_CAPACITY) return 'blue';
  return blueCount <= redCount ? 'blue' : 'red';
}

export function canJoinLobbyTeam(teamId: TeamId, blueCount: number, redCount: number): boolean {
  return (teamId === 'blue' ? blueCount : redCount) < LOBBY_TEAM_CAPACITY;
}

function pickInviteTeam(blueCount: number, redCount: number): TeamId | null {
  return pickAutomaticTeam(blueCount, redCount);
}
