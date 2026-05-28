import { HP_MAX } from '../config';
import type { CoopDefenseUpgradeProfile, LoadoutCommitSnapshot } from '../types';
import {
  cloneCoopDefenseUpgradeProfile,
  COOP_DEFENSE_PLAYER_STAT_MAX_HP,
  getCoopDefenseResolvedEffectTotals,
  sanitizeCoopDefenseUpgradeProfile,
} from '../utils/coopDefenseUpgrades';

export interface CoopDefensePlayerRuntimeModifiers {
  additiveStats: Readonly<Record<string, number>>;
  percentageStats: Readonly<Record<string, number>>;
  maxHp: number;
}

const DEFAULT_RUNTIME_MODIFIERS: CoopDefensePlayerRuntimeModifiers = {
  additiveStats: Object.freeze({}),
  percentageStats: Object.freeze({}),
  maxHp: HP_MAX,
};

export class CoopDefensePlayerModifierSystem {
  private readonly committedProfiles = new Map<string, CoopDefenseUpgradeProfile>();
  private readonly runtimeModifiers = new Map<string, CoopDefensePlayerRuntimeModifiers>();

  syncPlayers(entries: Iterable<readonly [string, LoadoutCommitSnapshot | null]>): void {
    const nextPlayerIds = new Set<string>();

    for (const [playerId, snapshot] of entries) {
      nextPlayerIds.add(playerId);
      this.syncPlayer(playerId, snapshot);
    }

    for (const playerId of [...this.committedProfiles.keys()]) {
      if (!nextPlayerIds.has(playerId)) this.committedProfiles.delete(playerId);
    }
    for (const playerId of [...this.runtimeModifiers.keys()]) {
      if (!nextPlayerIds.has(playerId)) this.runtimeModifiers.delete(playerId);
    }
  }

  syncPlayer(playerId: string, snapshot: LoadoutCommitSnapshot | null): void {
    const rawProfile = snapshot?.coopDefenseProfile;
    if (!rawProfile) {
      this.committedProfiles.delete(playerId);
      this.runtimeModifiers.delete(playerId);
      return;
    }

    const profile = sanitizeCoopDefenseUpgradeProfile(rawProfile);
    this.committedProfiles.set(playerId, cloneCoopDefenseUpgradeProfile(profile));
    this.runtimeModifiers.set(playerId, this.resolveRuntimeModifiers(profile));
  }

  getCommittedProfile(playerId: string): CoopDefenseUpgradeProfile | null {
    const profile = this.committedProfiles.get(playerId);
    return profile ? cloneCoopDefenseUpgradeProfile(profile) : null;
  }

  getModifiers(playerId: string): CoopDefensePlayerRuntimeModifiers {
    return this.runtimeModifiers.get(playerId) ?? DEFAULT_RUNTIME_MODIFIERS;
  }

  getNumericStat(playerId: string, stat: string): number {
    return this.getModifiers(playerId).additiveStats[stat] ?? 0;
  }

  getPercentageStat(playerId: string, stat: string): number {
    return this.getModifiers(playerId).percentageStats[stat] ?? 0;
  }

  getResolvedStat(playerId: string, stat: string, baseValue: number): number {
    const additive = this.getNumericStat(playerId, stat);
    const percentage = this.getPercentageStat(playerId, stat);
    return Math.max(0, (baseValue + additive) * (1 + percentage));
  }

  getMaxHp(playerId: string): number {
    return this.getModifiers(playerId).maxHp;
  }

  clear(): void {
    this.committedProfiles.clear();
    this.runtimeModifiers.clear();
  }

  private resolveRuntimeModifiers(profile: CoopDefenseUpgradeProfile): CoopDefensePlayerRuntimeModifiers {
    const totals = getCoopDefenseResolvedEffectTotals(profile);
    return {
      additiveStats: totals.additive,
      percentageStats: totals.percentage,
      maxHp: HP_MAX + (totals.additive[COOP_DEFENSE_PLAYER_STAT_MAX_HP] ?? 0),
    };
  }
}