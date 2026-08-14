import { describe, expect, it } from 'vitest';
import {
  RoomStatisticsLedger,
  calculateRoomWinRate,
  resolvePvpWinnerIds,
} from '../src/network/RoomStatistics';
import { formatRoomWinRate, sortRoomStatistics } from '../src/ui/RoomStatisticsModel';

const profile = (id: string, name = id, teamId: 'blue' | 'red' | null = null) => ({
  id,
  name,
  colorHex: 0xabcdef,
  teamId,
});

describe('host room statistics ledger', () => {
  it('aggregates multiple rounds and modes without resetting or duplicating reconnects', () => {
    const ledger = new RoomStatisticsLedger();
    ledger.ensurePlayer(profile('p1', 'Alpha'));
    ledger.ensurePlayer(profile('p2', 'Bravo'));

    // Runde 1: effektive Werte kommen bereits reduziert/clamped aus den zentralen Systemen.
    ledger.add('p1', 'damageDealt', 7.5);
    ledger.add('p1', 'damageTaken', 5.25);
    ledger.increment('p1', 'pveKills');
    ledger.increment('p1', 'powerUpsCollected');
    // Reconnect: gleiche ID aktualisiert nur die Anzeige, nie den Eintrag.
    ledger.ensurePlayer(profile('p1', 'Alpha zurück', 'blue'));

    // Runde 2 in einem anderen Modus.
    ledger.add('p1', 'damageDealt', 12.5);
    ledger.increment('p1', 'pvpKills');
    ledger.increment('p1', 'pvpDeaths');
    ledger.add('p1', 'healingReceived', 3);
    ledger.add('p1', 'armorReceived', 2);

    const snapshot = ledger.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot.find((entry) => entry.id === 'p1')).toMatchObject({
      name: 'Alpha zurück',
      teamId: 'blue',
      damageDealt: 20,
      damageTaken: 5.25,
      pveKills: 1,
      pvpKills: 1,
      pvpDeaths: 1,
      healingReceived: 3,
      armorReceived: 2,
    });
    expect(snapshot.find((entry) => entry.id === 'p1')).not.toHaveProperty('winRate');
  });

  it('counts only eligible completed PvP matches and derives win rate', () => {
    const ledger = new RoomStatisticsLedger();
    ledger.ensurePlayer(profile('winner'));
    ledger.ensurePlayer(profile('drawn'));
    ledger.ensurePlayer(profile('spectator'));

    ledger.recordCompletedPvpMatch(['winner', 'drawn'], new Set(['winner']));
    ledger.recordCompletedPvpMatch(['winner', 'drawn'], new Set()); // Draw: Match ja, Sieg nein.

    const winner = ledger.get('winner')!;
    const drawn = ledger.get('drawn')!;
    const spectator = ledger.get('spectator')!;
    expect(winner).toMatchObject({ pvpMatchesPlayed: 2, pvpWins: 1 });
    expect(drawn).toMatchObject({ pvpMatchesPlayed: 2, pvpWins: 0 });
    expect(spectator).toMatchObject({ pvpMatchesPlayed: 0, pvpWins: 0 });
    expect(calculateRoomWinRate(winner)).toBe(0.5);
    expect(calculateRoomWinRate({ pvpWins: 0, pvpMatchesPlayed: 0 })).toBeNull();
    expect(formatRoomWinRate({ pvpWins: 0, pvpMatchesPlayed: 0 })).toBe('—');
  });

  it('resolves deathmatch, team wins and draws without inventing a winner', () => {
    expect(resolvePvpWinnerIds('deathmatch', [
      { id: 'a', teamId: null, frags: 4 },
      { id: 'b', teamId: null, frags: 2 },
    ])).toEqual(new Set(['a']));
    expect(resolvePvpWinnerIds('deathmatch', [
      { id: 'a', teamId: null, frags: 4 },
      { id: 'b', teamId: null, frags: 4 },
    ])).toEqual(new Set());
    expect(resolvePvpWinnerIds('team_deathmatch', [
      { id: 'a', teamId: 'blue', frags: 1, teamScore: 7 },
      { id: 'b', teamId: 'blue', frags: 0, teamScore: 7 },
      { id: 'c', teamId: 'red', frags: 8, teamScore: 4 },
    ])).toEqual(new Set(['a', 'b']));
    expect(sortRoomStatistics([
      { ...profile('low'), damageDealt: 1, damageTaken: 5, pvpKills: 0, pveKills: 0, pvpDeaths: 0, pveDeaths: 0, pvpWins: 0, pvpMatchesPlayed: 0, healingReceived: 0, armorReceived: 0, powerUpsCollected: 0, utilitiesUsed: 0, constructionsBuilt: 0, ultimatesUsed: 0 },
      { ...profile('high'), damageDealt: 3, damageTaken: 0, pvpKills: 0, pveKills: 0, pvpDeaths: 0, pveDeaths: 0, pvpWins: 0, pvpMatchesPlayed: 0, healingReceived: 0, armorReceived: 0, powerUpsCollected: 0, utilitiesUsed: 0, constructionsBuilt: 0, ultimatesUsed: 0 },
    ]).map((entry) => entry.id)).toEqual(['high', 'low']);
  });

  it('starts a new room with an empty ledger', () => {
    const oldRoom = new RoomStatisticsLedger();
    oldRoom.ensurePlayer(profile('old'));
    oldRoom.increment('old', 'pvpKills');

    const newRoom = new RoomStatisticsLedger();
    expect(newRoom.snapshot()).toEqual([]);
  });
});
