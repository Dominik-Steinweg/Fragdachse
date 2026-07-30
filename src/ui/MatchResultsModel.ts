import type { RoundResult, RoundState } from '../network/NetworkBridge';
import type { GameMode, TeamId } from '../types';
import type { CoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';

export type MatchResultOutcome = 'victory' | 'defeat' | 'draw' | 'aborted' | 'syncing';

export interface MatchProgressDelta {
  before: CoopDefenseProgressSnapshot;
  after: CoopDefenseProgressSnapshot;
  xpGained: number;
  levelUps: number;
  newSkillPoints: number;
  newBossPoints: number;
  unlockedMapName: string | null;
  classesUnlocked: boolean;
}

export interface MatchResultsPresentation {
  outcome: MatchResultOutcome;
  mode: GameMode;
  modeLabel: string;
  mapLabel: string;
  localPlayerId: string;
  leaderboard: readonly RoundResult[];
  progress: MatchProgressDelta | null;
  technicalMessage: string | null;
}

export function sortMatchLeaderboard(results: readonly RoundResult[]): RoundResult[] {
  return [...results].sort((a, b) => {
    if (typeof a.teamScore === 'number' || typeof b.teamScore === 'number') {
      const teamScoreDelta = (b.teamScore ?? Number.NEGATIVE_INFINITY)
        - (a.teamScore ?? Number.NEGATIVE_INFINITY);
      if (teamScoreDelta !== 0) return teamScoreDelta;
    }
    const fragDelta = b.frags - a.frags;
    if (fragDelta !== 0) return fragDelta;
    return a.name.localeCompare(b.name, 'de');
  });
}

export function resolvePersonalMatchOutcome(
  mode: GameMode,
  localPlayerId: string,
  results: readonly RoundResult[],
  roundState: RoundState | null,
): MatchResultOutcome {
  if (roundState?.status === 'aborted') return 'aborted';
  if (mode === 'coop_defense') {
    if (roundState?.status === 'victory') return 'victory';
    if (roundState?.status === 'defeat') return 'defeat';
  }

  const local = results.find((entry) => entry.id === localPlayerId);
  if (!local || results.length === 0) return 'syncing';

  if (mode === 'team_deathmatch' || mode === 'capture_the_beer') {
    if (!local.teamId) return 'syncing';
    const blueScore = resolveTeamScore(results, 'blue');
    const redScore = resolveTeamScore(results, 'red');
    if (blueScore === redScore) return 'draw';
    const winningTeam: TeamId = blueScore > redScore ? 'blue' : 'red';
    return local.teamId === winningTeam ? 'victory' : 'defeat';
  }

  const highestFrags = Math.max(...results.map((entry) => entry.frags));
  if (local.frags < highestFrags) return 'defeat';
  const winners = results.filter((entry) => entry.frags === highestFrags);
  return winners.length === 1 ? 'victory' : 'draw';
}

export function createMatchProgressDelta(
  before: CoopDefenseProgressSnapshot,
  after: CoopDefenseProgressSnapshot,
  xpGained: number,
  unlockedMapName: string | null,
): MatchProgressDelta {
  return {
    before,
    after,
    xpGained: Math.max(0, Math.floor(xpGained)),
    levelUps: Math.max(0, after.level - before.level),
    newSkillPoints: Math.max(0, after.availableUpgradePoints - before.availableUpgradePoints),
    newBossPoints: Math.max(0, after.availableBossPoints - before.availableBossPoints),
    unlockedMapName,
    classesUnlocked: !before.classesUnlocked && after.classesUnlocked,
  };
}

function resolveTeamScore(results: readonly RoundResult[], teamId: TeamId): number {
  const entries = results.filter((entry) => entry.teamId === teamId);
  const authoritativeScore = entries.find((entry) => typeof entry.teamScore === 'number')?.teamScore;
  if (typeof authoritativeScore === 'number') return authoritativeScore;
  return entries.reduce((sum, entry) => sum + Math.max(0, Math.floor(entry.frags)), 0);
}
