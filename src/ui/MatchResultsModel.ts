import type { RoundResult, RoundState } from '../network/NetworkBridge';
import type { CoopDefenseClassId, CoopDefenseItem, CoopDefenseItemSlot, GameMode, TeamId } from '../types';
import type { CoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';
import { getLocale } from '../i18n';
import {
  compareCoopDefenseItems,
  getCoopDefenseItemSalvageXp,
  getCoopDefenseStashItems,
  getEquippedCoopDefenseItem,
  getFreeCoopDefenseStashSlots,
  normalizeCoopDefenseEpicGuaranteeCount,
  sortCoopDefenseItems,
  type CoopDefenseEquippedItemIds,
  type CoopDefenseItemComparisonRow,
} from '../utils/coopDefenseItems';

export type MatchResultOutcome = 'victory' | 'defeat' | 'draw' | 'aborted' | 'syncing';

export interface MatchProgressDelta {
  before: CoopDefenseProgressSnapshot;
  after: CoopDefenseProgressSnapshot;
  xpGained: number;
  newSkillPoints: number;
  newBossPoints: number;
  unlockedMapName: string | null;
  classesUnlocked: boolean;
  newlyUnlockedClassIds: readonly CoopDefenseClassId[];
  /**
   * Der Freischaltstand der Items steckt nicht im Fortschritts-Schnappschuss und laesst sich
   * deshalb nicht wie `classesUnlocked` aus before/after ableiten – er kommt vom Sieg-Verbuchen.
   */
  itemsUnlocked: boolean;
}

/** Ein angebotenes Item samt allem, was der Auswahlbildschirm dafuer braucht. */
export interface MatchItemRewardOption {
  readonly item: CoopDefenseItem;
  /** Aktuell ausgeruestetes Teil derselben Kategorie, `null` bei leerem Slot. */
  readonly equipped: CoopDefenseItem | null;
  /** Ein leerer Slot nimmt das Angebot direkt auf, auch wenn der Stash bereits voll ist. */
  readonly directEquip: boolean;
  readonly comparison: readonly CoopDefenseItemComparisonRow[];
  /** Freie Plaetze der Kategorie; bei `directEquip` wird kein Stash-Platz benoetigt. */
  readonly freeStashSlots: number;
  /** XP, die das Angebot selbst beim direkten Zerlegen einbringt. */
  readonly salvageXp: number;
  /** Nicht ausgeruestete Teile derselben Kategorie – die Auswahl bei vollem Inventar. */
  readonly stash: readonly CoopDefenseItem[];
}

export interface MatchItemRewardPresentation {
  readonly roundEndedAt: number;
  readonly mapId?: string;
  /** Position in der persistenten Queue (1-basiert fuer die Anzeige). */
  readonly queueIndex: number;
  readonly queueSize: number;
  /** Beim Würfeln angewandte Mindestanzahl epischer Optionen. */
  readonly epicGuaranteeCount: number;
  readonly options: readonly MatchItemRewardOption[];
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
  /** `null`, wenn die Map keine Items vergibt oder die Belohnung bereits abgeholt wurde. */
  itemReward: MatchItemRewardPresentation | null;
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

/** Liest die B8-Garantie ausschließlich aus dem autoritativen Ergebnis eines gültigen Sieges. */
export function resolveCoopDefenseEpicGuaranteeCount(
  results: readonly Pick<RoundResult, 'epicGuaranteeCount'>[],
  roundState: Pick<RoundState, 'status'> | null,
): number {
  if (roundState?.status !== 'victory') return 0;
  return normalizeCoopDefenseEpicGuaranteeCount(
    results.find((result) => typeof result.epicGuaranteeCount === 'number')?.epicGuaranteeCount,
  );
}

export function createMatchProgressDelta(
  before: CoopDefenseProgressSnapshot,
  after: CoopDefenseProgressSnapshot,
  xpGained: number,
  unlockedMapName: string | null,
  itemsUnlocked = false,
): MatchProgressDelta {
  return {
    before,
    after,
    xpGained: Math.max(0, Math.floor(xpGained)),
    newSkillPoints: Math.max(0, after.availableUpgradePoints - before.availableUpgradePoints),
    newBossPoints: Math.max(0, after.availableBossPoints - before.availableBossPoints),
    unlockedMapName,
    classesUnlocked: before.unlockedClassIds.length === 0 && after.unlockedClassIds.length > 0,
    newlyUnlockedClassIds: after.unlockedClassIds.filter((classId) => !before.unlockedClassIds.includes(classId)),
    itemsUnlocked,
  };
}

/**
 * Baut die Auswahlansicht eines offenen Angebots. Rein aus dem gespeicherten Stand abgeleitet,
 * damit dasselbe Angebot spaeter im Lobby-Item-Menue identisch dargestellt werden kann.
 */
export function createMatchItemRewardPresentation(
  pending: {
    roundEndedAt: number;
    mapId?: string;
    offers: readonly CoopDefenseItem[];
    epicGuaranteeCount?: number;
  } | null,
  ownedItems: readonly CoopDefenseItem[],
  equippedItemIds: CoopDefenseEquippedItemIds,
  queuePosition: { index: number; size: number } = { index: 0, size: 1 },
): MatchItemRewardPresentation | null {
  if (!pending || pending.offers.length === 0) return null;

  return {
    roundEndedAt: pending.roundEndedAt,
    ...(pending.mapId ? { mapId: pending.mapId } : {}),
    queueIndex: Math.max(1, Math.floor(queuePosition.index) + 1),
    queueSize: Math.max(1, Math.floor(queuePosition.size)),
    epicGuaranteeCount: normalizeCoopDefenseEpicGuaranteeCount(pending.epicGuaranteeCount),
    options: pending.offers.map((item) => {
      const equipped = getEquippedCoopDefenseItem(ownedItems, equippedItemIds, item.slot as CoopDefenseItemSlot);
      return {
        item,
        equipped,
        directEquip: equipped === null,
        comparison: compareCoopDefenseItems(item, equipped, getLocale()),
        freeStashSlots: getFreeCoopDefenseStashSlots(ownedItems, equippedItemIds, item.slot),
        salvageXp: getCoopDefenseItemSalvageXp(item),
        stash: sortCoopDefenseItems(
          getCoopDefenseStashItems(ownedItems, equippedItemIds, item.slot),
          'rarity',
        ),
      };
    }),
  };
}

function resolveTeamScore(results: readonly RoundResult[], teamId: TeamId): number {
  const entries = results.filter((entry) => entry.teamId === teamId);
  const authoritativeScore = entries.find((entry) => typeof entry.teamScore === 'number')?.teamScore;
  if (typeof authoritativeScore === 'number') return authoritativeScore;
  return entries.reduce((sum, entry) => sum + Math.max(0, Math.floor(entry.frags)), 0);
}
