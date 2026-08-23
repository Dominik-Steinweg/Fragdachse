import type {
  CoopDefenseClassId,
  CoopDefenseItemRarity,
  CoopDefenseItemSlot,
} from '../../types';
import type { CoopDefenseMapObjective } from '../../config/coopDefenseMaps';

/** Globale Regelversion fuer Balance-Messungen. Bei systemweiten Balanceformeln erhoehen. */
// Erhoehen, wenn sich z. B. Damage-/Crit-/Armor-/Adrenalin-Formeln, globale Waffenbalance oder
// zentrale Item-/Upgrade-Wirkungen aendern und die Map-Signatur das nicht sicher erfassen kann.
export const COOP_DEFENSE_BALANCE_RULESET_VERSION = 1;
export const COOP_DEFENSE_BALANCE_STORAGE_SCHEMA_VERSION = 1;
export const COOP_DEFENSE_BALANCE_STORAGE_KEY = 'fragdachse_balance_lab_v1';
export const COOP_DEFENSE_BALANCE_MAX_ROUNDS = 500;
export const COOP_DEFENSE_BALANCE_MAX_COMMENT_LENGTH = 500;

export type BalanceModelQuality = 'EXACT' | 'REFERENCE' | 'DYNAMIC';
export type BalanceRoundOutcome = 'victory' | 'defeat';

export interface BalanceEnemyTotals {
  readonly count: number;
  readonly hp: number;
  readonly xp: number;
}

export interface BalanceStrongestEncounter {
  readonly encounterId: string;
  readonly enemyKinds: readonly string[];
  readonly totals: BalanceEnemyTotals;
}

export interface BalancePersistentSource {
  readonly id: string;
  readonly enemyKind: string;
  readonly source: 'map' | 'base';
  readonly sourceId?: string;
  readonly referenceEnemyCount: number;
  readonly referenceHp: number;
  readonly referenceXp: number;
  /** Markiert die Werte ausdruecklich als Referenz, nicht als Spawn-Garantie. */
  readonly isReferenceValue: true;
}

export interface BalanceMapSnapshot {
  readonly mapId: string;
  readonly displayName: string;
  readonly objective: CoopDefenseMapObjective;
  readonly balanceReferenceDurationSec: number;
  readonly survivalDurationSec: number | null;
  readonly respawnsPerPlayer: number | null;
  readonly arena: { readonly widthCells: number; readonly heightCells: number; readonly areaCells: number };
  readonly terrain: {
    readonly rockField: boolean;
    readonly rockFillRatio: number | null;
    readonly corridorCount: number;
    readonly corridorLengths: readonly number[];
    readonly trackMode: string;
    readonly trackPosition: string;
  };
  readonly finiteEnemyCount: number;
  readonly finiteEnemyHp: number;
  readonly finiteEnemyXp: number;
  readonly persistentReferenceEnemyCount: number;
  readonly persistentReferenceHp: number;
  readonly persistentReferenceXp: number;
  readonly persistentReferenceHpPerMinute: number;
  readonly totalReferenceHp: number;
  /** Persistente Quellen bleiben als Referenzwerte einzeln nachvollziehbar. */
  readonly persistentSources: readonly BalancePersistentSource[];
  readonly strongestEncounter: BalanceStrongestEncounter | null;
  readonly usedEnemyKinds: readonly string[];
  readonly boss: { readonly enemyKind: string; readonly hp: number; readonly xp: number } | null;
  readonly mechanicTags: readonly string[];
  readonly dynamicFactors: readonly string[];
  readonly modelQuality: BalanceModelQuality;
  readonly friendlyMainBaseHp: number;
  readonly friendlyOutpostHp: number;
  readonly friendlySpawnPointHp: number;
  readonly hostileMainBaseHp: number;
  readonly hostileOutpostHp: number;
  readonly hostileSpawnPointHp: number;
  readonly hostileVictoryTargetHp: number;
  readonly turretCount: number;
  readonly turretTypes: readonly string[];
  readonly powerUpCount: number;
  readonly powerUpTypes: readonly string[];
  readonly powerUpPedestalCount: number;
  readonly secondaryObjectiveXp: number;
  readonly context: {
    readonly train: boolean;
    readonly airstrike: boolean;
    readonly groundHazard: boolean;
    readonly secondaryObjectives: readonly string[];
    readonly fronts: readonly string[];
    readonly specialEnemyMethods: readonly string[];
  };
  readonly balanceSignature: string;
}

export interface BalanceItemSnapshot {
  readonly slot: CoopDefenseItemSlot;
  readonly rarity: CoopDefenseItemRarity;
  readonly itemLevel: number;
  readonly baseValue: number;
  readonly affixes: readonly { readonly affixId: string; readonly value: number }[];
}

export interface BalanceBuildSnapshot {
  readonly coopXpBefore: number | null;
  readonly levelBefore: number | null;
  readonly classId: CoopDefenseClassId | null;
  readonly weapon1: string | null;
  readonly weapon2: string | null;
  readonly utility: string | null;
  readonly ultimate: string | null;
  readonly upgradeProfile: Readonly<Record<string, number>> | null;
  readonly items: readonly BalanceItemSnapshot[] | null;
}

export interface BalanceRoundFeedback {
  readonly difficulty: 1 | 2 | 3 | 4 | 5;
  readonly pacing: 1 | 2 | 3 | 4 | 5;
  readonly comment: string;
}

export interface BalanceRoundRecord {
  readonly roundEndedAt: number;
  readonly mapId: string;
  readonly outcome: BalanceRoundOutcome;
  readonly durationMs: number | null;
  readonly sharedXp: number | null;
  readonly frags: number | null;
  readonly playerHp: number | null;
  readonly playerMaxHp: number | null;
  readonly playerHpPercent: number | null;
  readonly armor: number | null;
  readonly ownMainBaseHp: number | null;
  readonly ownMainBaseMaxHp: number | null;
  readonly ownMainBaseHpPercent: number | null;
  readonly hostileMainBaseHp: number | null;
  readonly hostileMainBaseMaxHp: number | null;
  readonly hostileMainBaseHpPercent: number | null;
  readonly survivalRemainingRespawns: number | null;
  readonly build: BalanceBuildSnapshot;
  readonly mapBalanceSignature: string;
  readonly rulesetVersion: number;
  readonly feedback: BalanceRoundFeedback | null;
}

export interface CoopDefenseBalanceLabDocument {
  readonly schemaVersion: typeof COOP_DEFENSE_BALANCE_STORAGE_SCHEMA_VERSION;
  readonly recordingEnabled: boolean;
  readonly rounds: readonly BalanceRoundRecord[];
}

export interface BalanceRoundClassification {
  readonly record: BalanceRoundRecord;
  readonly status: 'CURRENT' | 'STALE';
  readonly staleReason: string | null;
}

export interface BalanceMapMetrics {
  readonly currentRounds: number;
  readonly ratedRounds: number;
  readonly staleRounds: number;
  readonly victoryRate: number | null;
  readonly averageDurationMs: number | null;
  readonly medianDurationMs: number | null;
  readonly averageActualXp: number | null;
  readonly averageDifficulty: number | null;
  readonly averagePacing: number | null;
  readonly averageOwnBaseReserve: number | null;
}

export interface BalanceMapReport {
  readonly snapshot: BalanceMapSnapshot;
  readonly metrics: BalanceMapMetrics;
  readonly rounds: readonly BalanceRoundClassification[];
  readonly anomalies: readonly string[];
}

export interface CoopDefenseBalanceReport {
  readonly generatedAt: string;
  readonly rounds: readonly BalanceRoundClassification[];
  readonly maps: readonly BalanceMapReport[];
  readonly staleRoundCount: number;
  readonly currentRoundCount: number;
}
