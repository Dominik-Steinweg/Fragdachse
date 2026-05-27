import { HP_MAX } from '../config';
import type { CoopDefenseUpgradeProfile, LoadoutCommitSnapshot } from '../types';
import {
  cloneCoopDefenseUpgradeProfile,
  COOP_DEFENSE_PLAYER_STAT_MAX_HP,
  getCoopDefenseNumericStatTotals,
  sanitizeCoopDefenseUpgradeProfile,
} from '../utils/coopDefenseUpgrades';

export interface CoopDefensePlayerRuntimeModifiers {
  numericStats: Readonly<Record<string, number>>;
  maxHp: number;
}

const DEFAULT_RUNTIME_MODIFIERS: CoopDefensePlayerRuntimeModifiers = {
  numericStats: Object.freeze({}),
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
    return this.getModifiers(playerId).numericStats[stat] ?? 0;
  }

  getMaxHp(playerId: string): number {
    return this.getModifiers(playerId).maxHp;
  }

  clear(): void {
    this.committedProfiles.clear();
    this.runtimeModifiers.clear();
  }

  private resolveRuntimeModifiers(profile: CoopDefenseUpgradeProfile): CoopDefensePlayerRuntimeModifiers {
    const numericStats = getCoopDefenseNumericStatTotals(profile);
    return {
      numericStats,
      maxHp: HP_MAX + (numericStats[COOP_DEFENSE_PLAYER_STAT_MAX_HP] ?? 0),
    };
  }
}