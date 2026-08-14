import type { GameMode, PlayerProfile, TeamId } from '../types';

/** Alle persistenten Zähler eines Raums. `winRate` ist absichtlich kein gespeichertes Feld. */
export interface RoomStatisticsCounters {
  damageDealt: number;
  damageTaken: number;
  pvpKills: number;
  pveKills: number;
  pvpDeaths: number;
  pveDeaths: number;
  pvpWins: number;
  pvpMatchesPlayed: number;
  healingReceived: number;
  armorReceived: number;
  powerUpsCollected: number;
  utilitiesUsed: number;
  constructionsBuilt: number;
  ultimatesUsed: number;
}

/** Netzwerk- und UI-Modell eines Raumspielers. Die Reihenfolge bleibt transportfreundlich. */
export interface RoomPlayerStatistics extends RoomStatisticsCounters {
  id: string;
  name: string;
  colorHex: number;
  teamId: TeamId | null;
}

export type RoomStatisticsCounter = keyof RoomStatisticsCounters;

export const ROOM_STATISTICS_COUNTERS: readonly RoomStatisticsCounter[] = [
  'damageDealt',
  'damageTaken',
  'pvpKills',
  'pveKills',
  'pvpDeaths',
  'pveDeaths',
  'pvpWins',
  'pvpMatchesPlayed',
  'healingReceived',
  'armorReceived',
  'powerUpsCollected',
  'utilitiesUsed',
  'constructionsBuilt',
  'ultimatesUsed',
];

const INTEGER_COUNTERS = new Set<RoomStatisticsCounter>([
  'pvpKills',
  'pveKills',
  'pvpDeaths',
  'pveDeaths',
  'pvpWins',
  'pvpMatchesPlayed',
  'powerUpsCollected',
  'utilitiesUsed',
  'constructionsBuilt',
  'ultimatesUsed',
]);

function emptyCounters(): RoomStatisticsCounters {
  return {
    damageDealt: 0,
    damageTaken: 0,
    pvpKills: 0,
    pveKills: 0,
    pvpDeaths: 0,
    pveDeaths: 0,
    pvpWins: 0,
    pvpMatchesPlayed: 0,
    healingReceived: 0,
    armorReceived: 0,
    powerUpsCollected: 0,
    utilitiesUsed: 0,
    constructionsBuilt: 0,
    ultimatesUsed: 0,
  };
}

export function calculateRoomWinRate(entry: Pick<RoomPlayerStatistics, 'pvpWins' | 'pvpMatchesPlayed'>): number | null {
  return entry.pvpMatchesPlayed > 0 ? entry.pvpWins / entry.pvpMatchesPlayed : null;
}

export interface RoomStatisticsProfile {
  id: string;
  name: string;
  colorHex: number;
  teamId?: TeamId | null;
}

/**
 * Host-only accumulator. It deliberately has no reset method: the owning NetworkBridge is
 * recreated for a new room, while round/lobby transitions keep this instance alive.
 */
export class RoomStatisticsLedger {
  private readonly entries = new Map<string, RoomPlayerStatistics>();

  ensurePlayer(profile: RoomStatisticsProfile | PlayerProfile): RoomPlayerStatistics {
    const existing = this.entries.get(profile.id);
    if (existing) {
      existing.name = profile.name;
      existing.colorHex = profile.colorHex;
      existing.teamId = profile.teamId ?? null;
      return existing;
    }

    const entry: RoomPlayerStatistics = {
      id: profile.id,
      name: profile.name,
      colorHex: profile.colorHex,
      teamId: profile.teamId ?? null,
      ...emptyCounters(),
    };
    this.entries.set(profile.id, entry);
    return entry;
  }

  add(playerId: string, counter: RoomStatisticsCounter, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const entry = this.entries.get(playerId);
    if (!entry) return;
    const adjusted = INTEGER_COUNTERS.has(counter) ? Math.floor(amount) : amount;
    if (adjusted <= 0) return;
    entry[counter] += adjusted;
  }

  increment(playerId: string, counter: RoomStatisticsCounter): void {
    this.add(playerId, counter, 1);
  }

  recordCompletedPvpMatch(eligiblePlayerIds: readonly string[], winnerIds: ReadonlySet<string>): void {
    const eligible = new Set(eligiblePlayerIds);
    for (const playerId of eligible) {
      if (!this.entries.has(playerId)) continue;
      this.increment(playerId, 'pvpMatchesPlayed');
      if (winnerIds.has(playerId)) this.increment(playerId, 'pvpWins');
    }
  }

  get(playerId: string): RoomPlayerStatistics | undefined {
    return this.entries.get(playerId);
  }

  snapshot(): RoomPlayerStatistics[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }

}

export interface RoomPvpResult {
  id: string;
  teamId: TeamId | null;
  frags: number;
  teamScore?: number;
}

/** Liefert die echten Sieger einer abgeschlossenen PvP-Runde; bei Draw bleibt die Menge leer. */
export function resolvePvpWinnerIds(mode: GameMode, results: readonly RoomPvpResult[]): Set<string> {
  if (results.length === 0) return new Set();

  if (mode === 'team_deathmatch' || mode === 'capture_the_beer') {
    const blueScore = resolveTeamScore(results, 'blue');
    const redScore = resolveTeamScore(results, 'red');
    if (blueScore === redScore) return new Set();
    const winningTeam: TeamId = blueScore > redScore ? 'blue' : 'red';
    return new Set(results.filter((entry) => entry.teamId === winningTeam).map((entry) => entry.id));
  }

  const highestFrags = Math.max(...results.map((entry) => Math.max(0, Math.floor(entry.frags))));
  const winners = results.filter((entry) => Math.max(0, Math.floor(entry.frags)) === highestFrags);
  return winners.length === 1 ? new Set([winners[0].id]) : new Set();
}

function resolveTeamScore(results: readonly RoomPvpResult[], teamId: TeamId): number {
  const entries = results.filter((entry) => entry.teamId === teamId);
  const authoritativeScore = entries.find((entry) => typeof entry.teamScore === 'number')?.teamScore;
  if (typeof authoritativeScore === 'number' && Number.isFinite(authoritativeScore)) return authoritativeScore;
  return entries.reduce((sum, entry) => sum + Math.max(0, Math.floor(entry.frags)), 0);
}
