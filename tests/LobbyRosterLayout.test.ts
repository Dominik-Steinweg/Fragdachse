import { describe, expect, it } from 'vitest';
import type { GameMode, TeamId } from '../src/types';
import {
  buildLobbyRosterSlots,
  canJoinLobbyTeam,
  LOBBY_TEAM_CAPACITY,
  pickAutomaticTeam,
} from '../src/lobby/LobbyRosterLayout';

const players = (count: number, teamId: TeamId | null = null, prefix = 'p') =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, teamId }));

describe('LobbyRosterLayout', () => {
  for (const mode of ['deathmatch', 'coop_defense'] as const satisfies readonly GameMode[]) {
    for (const count of [1, 2, 6, 11, 12]) {
      it(`${mode} keeps twelve stable slots with ${count} players`, () => {
        const slots = buildLobbyRosterSlots(mode, players(count));
        expect(slots).toHaveLength(12);
        expect(slots.filter((slot) => slot.playerId !== null)).toHaveLength(count);
        expect(slots.filter((slot) => slot.invite)).toHaveLength(count < 12 ? 1 : 0);
      });
    }
  }

  for (const mode of ['team_deathmatch', 'capture_the_beer'] as const satisfies readonly GameMode[]) {
    for (const [blueCount, redCount] of [[1, 0], [3, 2], [6, 0], [6, 5], [6, 6]] as const) {
      it(`${mode} lays out ${blueCount} vs ${redCount} in two capped columns`, () => {
        const slots = buildLobbyRosterSlots(mode, [
          ...players(blueCount, 'blue', 'b'),
          ...players(redCount, 'red', 'r'),
        ]);
        expect(slots.filter((slot) => slot.teamId === 'blue')).toHaveLength(LOBBY_TEAM_CAPACITY);
        expect(slots.filter((slot) => slot.teamId === 'red')).toHaveLength(LOBBY_TEAM_CAPACITY);
        expect(slots.filter((slot) => slot.invite)).toHaveLength(blueCount + redCount < 12 ? 1 : 0);
        const invite = slots.find((slot) => slot.invite);
        const expected = blueCount === 6 ? (redCount === 6 ? undefined : 'red') : blueCount <= redCount ? 'blue' : 'red';
        expect(invite?.teamId).toBe(expected);
      });
    }
  }

  it('uses deterministic blue tie-breaking and rejects a seventh team member', () => {
    expect(pickAutomaticTeam(3, 3)).toBe('blue');
    expect(pickAutomaticTeam(6, 5)).toBe('red');
    expect(pickAutomaticTeam(6, 6)).toBeNull();
    expect(canJoinLobbyTeam('blue', 6, 5)).toBe(false);
    expect(canJoinLobbyTeam('red', 6, 5)).toBe(true);
  });
});
