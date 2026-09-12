import { describe, expect, it } from 'vitest';
import type { GameMode, TeamId } from '../src/types';
import { getLobbyReliefBounds, LOBBY_CARD, LOBBY_ROSTER_ROW_STEP } from '../src/ui/LobbyLayout';
import {
  buildLobbyRosterSlots,
  canJoinLobbyTeam,
  LOBBY_TEAM_CAPACITY,
  pickAutomaticTeam,
} from '../src/lobby/LobbyRosterLayout';

const players = (count: number, teamId: TeamId | null = null, prefix = 'p') =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, teamId }));

it('fits decorative relief entirely between the occupied roster and its footer, hiding it on overflow', () => {
  for (let rows = 0; rows <= 12; rows++) {
    const height = rows * LOBBY_ROSTER_ROW_STEP;
    const bounds = getLobbyReliefBounds(height);
    if (!bounds) continue;
    expect(bounds.y - bounds.height / 2).toBeGreaterThan(LOBBY_CARD.rosterTop + height);
    expect(bounds.y + bounds.height / 2).toBeLessThan(LOBBY_CARD.rosterBottom);
    expect(bounds.width).toBeLessThanOrEqual(LOBBY_CARD.contentWidth);
  }
  expect(getLobbyReliefBounds(LOBBY_CARD.rosterBottom - LOBBY_CARD.rosterTop)).toBeNull();
});

describe('LobbyRosterLayout', () => {
  for (const mode of ['deathmatch', 'coop_defense'] as const satisfies readonly GameMode[]) {
    for (const count of [1, 2, 6, 11, 12]) {
      it(`${mode} shows occupied rows and one invitation with ${count} players`, () => {
        const slots = buildLobbyRosterSlots(mode, players(count));
        expect(slots).toHaveLength(Math.min(count + 1, 12));
        expect(slots.every(slot => slot.column === 0)).toBe(true);
        expect(slots.map(slot => slot.row)).toEqual(slots.map((_, index) => index));
        expect(slots.filter(slot => slot.playerId).map(slot => slot.playerId)).toEqual(players(count).map(p => p.id));
        expect(slots.filter((slot) => slot.playerId !== null)).toHaveLength(count);
        expect(slots.filter((slot) => slot.invite)).toHaveLength(count < 12 ? 1 : 0);
      });
    }
  }

  for (const mode of ['team_deathmatch', 'capture_the_beer'] as const satisfies readonly GameMode[]) {
    for (const [blueCount, redCount] of [[1, 0], [3, 2], [6, 0], [6, 5], [6, 6]] as const) {
      it(`${mode} groups ${blueCount} vs ${redCount} vertically without empty rows`, () => {
        const slots = buildLobbyRosterSlots(mode, [
          ...players(blueCount, 'blue', 'b'),
          ...players(redCount, 'red', 'r'),
        ]);
        expect(slots.filter(slot => slot.teamId === 'blue' && slot.playerId)).toHaveLength(blueCount);
        expect(slots.filter(slot => slot.teamId === 'red' && slot.playerId)).toHaveLength(redCount);
        expect(slots.every(slot => slot.column === 0 && (slot.playerId !== null || slot.invite))).toBe(true);
        expect(slots.map(slot => slot.row)).toEqual(slots.map((_, index) => index));
        expect(slots.filter(slot => slot.teamId === 'blue').length).toBeLessThanOrEqual(LOBBY_TEAM_CAPACITY);
        expect(slots.filter(slot => slot.teamId === 'red').length).toBeLessThanOrEqual(LOBBY_TEAM_CAPACITY);
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
