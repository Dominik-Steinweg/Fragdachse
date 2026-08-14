import type { RoundState } from '../../network/NetworkBridge';
import type { GameMode, CoopDefenseItem, LoadoutCommitSnapshot } from '../../types';
import { getCoopDefenseMapBalanceSignature } from './analyzer';
import type {
  BalanceBuildSnapshot,
  BalanceItemSnapshot,
  BalanceRoundFeedback,
  BalanceRoundRecord,
} from './types';
import { COOP_DEFENSE_BALANCE_RULESET_VERSION } from './types';
import {
  getStoredCoopDefenseBalanceLab,
  setStoredCoopDefenseBalanceRecordingEnabled,
  updateStoredCoopDefenseBalanceFeedback,
  upsertStoredCoopDefenseBalanceRound,
} from '../../utils/localPreferences';
import type { CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import { COOP_DEFENSE_MAP_CONFIGS } from '../../config/coopDefenseMaps';

export interface BalanceRuntimeCapture {
  readonly gameMode: GameMode;
  readonly roundState: RoundState;
  readonly mapConfig: CoopDefenseMapConfig;
  readonly outcome: 'victory' | 'defeat';
  readonly sharedXp: number | null;
  readonly frags: number | null;
  readonly playerHp: number | null;
  readonly playerMaxHp: number | null;
  readonly armor: number | null;
  readonly ownMainBaseHp: number | null;
  readonly ownMainBaseMaxHp: number | null;
  readonly hostileMainBaseHp: number | null;
  readonly hostileMainBaseMaxHp: number | null;
  readonly survivalRemainingRespawns: number | null;
  readonly build: BalanceBuildSnapshot;
}

interface PendingBalanceRound {
  readonly capture: BalanceRuntimeCapture;
  readonly mapBalanceSignature: string;
}

function optionalNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function percent(value: number | null, max: number | null): number | null {
  if (value === null || max === null || max <= 0) return null;
  return Math.max(0, Math.min(1, value / max));
}

function itemSnapshot(item: CoopDefenseItem): BalanceItemSnapshot {
  return {
    slot: item.slot,
    rarity: item.rarity,
    itemLevel: Math.max(0, Math.floor(item.itemLevel)),
    baseValue: Number.isFinite(item.baseValue) ? item.baseValue : 0,
    affixes: item.affixes.map((affix) => ({
      affixId: affix.affixId,
      value: Number.isFinite(affix.value) ? affix.value : 0,
    })),
  };
}

/** Speichert nur Upgrade-Level und relevante Itemwerte, nie Runtime-/Phaser-Objekte. */
export function buildBalanceBuildSnapshot(
  coopXpBefore: number | null,
  levelBefore: number | null,
  committed: LoadoutCommitSnapshot | null,
): BalanceBuildSnapshot {
  const profile = committed?.coopDefenseProfile;
  const upgradeProfile = profile
    ? Object.fromEntries(
      Object.entries(profile.upgrades)
        .filter(([, state]) => Number.isFinite(state.level) && state.level > 0)
        .map(([id, state]) => [id, Math.floor(state.level)]),
    )
    : null;
  return {
    coopXpBefore: optionalNumber(coopXpBefore),
    levelBefore: optionalNumber(levelBefore),
    classId: committed?.coopDefenseClassId ?? null,
    weapon1: committed?.weapon1 ?? null,
    weapon2: committed?.weapon2 ?? null,
    utility: committed?.utility ?? null,
    ultimate: committed?.ultimate ?? null,
    upgradeProfile,
    items: committed?.equippedItems?.map(itemSnapshot) ?? null,
  };
}

export class CoopDefenseBalanceTracker {
  private pending: PendingBalanceRound | null = null;

  isRecordingEnabled(): boolean {
    return getStoredCoopDefenseBalanceLab().recordingEnabled;
  }

  setRecordingEnabled(enabled: boolean): void {
    setStoredCoopDefenseBalanceRecordingEnabled(enabled);
  }

  preparePendingRound(capture: BalanceRuntimeCapture): boolean {
    if (this.pending || !this.isRecordingEnabled()) return false;
    if (capture.gameMode !== 'coop_defense' || capture.roundState.status !== 'active') return false;
    if (capture.roundState.coopDefenseHumanPlayerCount !== 1) return false;
    if (capture.outcome !== 'victory' && capture.outcome !== 'defeat') return false;
    this.pending = {
      capture,
      mapBalanceSignature: getCoopDefenseMapBalanceSignature(capture.mapConfig),
    };
    return true;
  }

  finalizePendingRound(roundEndedAt: number): BalanceRoundRecord | null {
    const pending = this.pending;
    this.pending = null;
    if (!pending || !Number.isFinite(roundEndedAt) || roundEndedAt <= 0) return null;
    const { capture } = pending;
    const durationMs = Number.isFinite(capture.roundState.roundStartTime)
      ? Math.max(0, Math.floor(roundEndedAt - capture.roundState.roundStartTime))
      : null;
    const record: BalanceRoundRecord = {
      roundEndedAt: Math.floor(roundEndedAt),
      mapId: capture.mapConfig.mapId,
      outcome: capture.outcome,
      durationMs,
      sharedXp: optionalNumber(capture.sharedXp),
      frags: optionalNumber(capture.frags),
      playerHp: optionalNumber(capture.playerHp),
      playerMaxHp: optionalNumber(capture.playerMaxHp),
      playerHpPercent: percent(optionalNumber(capture.playerHp), optionalNumber(capture.playerMaxHp)),
      armor: optionalNumber(capture.armor),
      ownMainBaseHp: optionalNumber(capture.ownMainBaseHp),
      ownMainBaseMaxHp: optionalNumber(capture.ownMainBaseMaxHp),
      ownMainBaseHpPercent: percent(optionalNumber(capture.ownMainBaseHp), optionalNumber(capture.ownMainBaseMaxHp)),
      hostileMainBaseHp: optionalNumber(capture.hostileMainBaseHp),
      hostileMainBaseMaxHp: optionalNumber(capture.hostileMainBaseMaxHp),
      hostileMainBaseHpPercent: percent(optionalNumber(capture.hostileMainBaseHp), optionalNumber(capture.hostileMainBaseMaxHp)),
      survivalRemainingRespawns: optionalNumber(capture.survivalRemainingRespawns),
      build: capture.build,
      mapBalanceSignature: pending.mapBalanceSignature,
      rulesetVersion: COOP_DEFENSE_BALANCE_RULESET_VERSION,
      feedback: null,
    };
    const currentSignatures = new Map(
      COOP_DEFENSE_MAP_CONFIGS.map((mapConfig) => [mapConfig.mapId, getCoopDefenseMapBalanceSignature(mapConfig)]),
    );
    const staleRoundEndedAt = getStoredCoopDefenseBalanceLab().rounds
      .filter((entry) => (
        entry.rulesetVersion !== COOP_DEFENSE_BALANCE_RULESET_VERSION
        || currentSignatures.get(entry.mapId) !== entry.mapBalanceSignature
      ))
      .map((entry) => entry.roundEndedAt);
    upsertStoredCoopDefenseBalanceRound(record, staleRoundEndedAt);
    return record;
  }

  getRound(roundEndedAt: number): BalanceRoundRecord | null {
    return getStoredCoopDefenseBalanceLab().rounds.find((round) => round.roundEndedAt === roundEndedAt) ?? null;
  }

  hasRound(roundEndedAt: number): boolean {
    return this.getRound(roundEndedAt) !== null;
  }

  updateFeedback(roundEndedAt: number, feedback: BalanceRoundFeedback | null): boolean {
    return updateStoredCoopDefenseBalanceFeedback(roundEndedAt, feedback);
  }

  getRounds(): readonly BalanceRoundRecord[] {
    return getStoredCoopDefenseBalanceLab().rounds;
  }
}
