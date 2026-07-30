import { HP_MAX } from '../config';
import {
  getCoopDefenseClassDefinition,
  type CoopDefenseClassDefinition,
} from '../config/coopDefenseClasses';
import type { CoopDefenseClassId, CoopDefenseUpgradeProfile, LoadoutCommitSnapshot } from '../types';
import {
  cloneCoopDefenseUpgradeProfile,
  COOP_DEFENSE_PLAYER_STAT_HP_REGEN_PER_SECOND,
  COOP_DEFENSE_PLAYER_STAT_MAX_HP,
  getCoopDefenseResolvedEffectTotals,
  sanitizeCoopDefenseUpgradeProfile,
} from '../utils/coopDefenseUpgrades';

export interface CoopDefensePlayerRuntimeModifiers {
  /** `null` ist die bonuslose Default-Klasse vor Abschluss von Map 5. */
  classId: CoopDefenseClassId | null;
  additiveStats: Readonly<Record<string, number>>;
  percentageStats: Readonly<Record<string, number>>;
  maxHp: number;
  hpRegenPerSecond: number;
}

const DEFAULT_RUNTIME_MODIFIERS: CoopDefensePlayerRuntimeModifiers = {
  classId: null,
  additiveStats: Object.freeze({}),
  percentageStats: Object.freeze({}),
  maxHp: HP_MAX,
  hpRegenPerSecond: 0,
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
    const classId = snapshot?.coopDefenseClassId ?? null;
    if (!rawProfile) {
      this.committedProfiles.delete(playerId);
      this.runtimeModifiers.delete(playerId);
      return;
    }

    const profile = sanitizeCoopDefenseUpgradeProfile(rawProfile, classId ?? undefined);
    this.committedProfiles.set(playerId, cloneCoopDefenseUpgradeProfile(profile, classId ?? undefined));
    this.runtimeModifiers.set(playerId, this.resolveRuntimeModifiers(profile, classId));
  }

  getCommittedProfile(playerId: string): CoopDefenseUpgradeProfile | null {
    const profile = this.committedProfiles.get(playerId);
    const classId = this.runtimeModifiers.get(playerId)?.classId;
    return profile ? cloneCoopDefenseUpgradeProfile(profile, classId ?? undefined) : null;
  }

  getModifiers(playerId: string): CoopDefensePlayerRuntimeModifiers {
    return this.runtimeModifiers.get(playerId) ?? DEFAULT_RUNTIME_MODIFIERS;
  }

  getClassId(playerId: string): CoopDefenseClassId | null {
    return this.runtimeModifiers.get(playerId)?.classId ?? null;
  }

  getClassDefinition(playerId: string): CoopDefenseClassDefinition | null {
    const classId = this.getClassId(playerId);
    return classId ? getCoopDefenseClassDefinition(classId) : null;
  }

  resolveOutgoingDamage(
    attackerId: string | undefined,
    targetId: string,
    amount: number,
    allowCritical: boolean,
    random: () => number = Math.random,
  ): { amount: number; isCritical: boolean } {
    if (!attackerId || attackerId === targetId || amount <= 0) {
      return { amount, isCritical: false };
    }
    const definition = this.getClassDefinition(attackerId);
    if (!definition) return { amount, isCritical: false };

    const isCritical = allowCritical
      && definition.criticalChance > 0
      && random() < definition.criticalChance;
    return {
      amount: amount
        * definition.outgoingDamageMultiplier
        * (isCritical ? definition.criticalDamageMultiplier : 1),
      isCritical,
    };
  }

  getNumericStat(playerId: string, stat: string): number {
    return this.getModifiers(playerId).additiveStats[stat] ?? 0;
  }

  getPercentageStat(playerId: string, stat: string): number {
    return this.getModifiers(playerId).percentageStats[stat] ?? 0;
  }

  getResolvedStat(playerId: string, stat: string, baseValue: number): number {
    const classDefinition = this.getClassDefinition(playerId);
    const resolvedBase = stat === 'player.adrenalineRegenRate'
      ? (classDefinition?.adrenalineRegenPerSecond ?? baseValue)
      : baseValue;
    const additive = this.getNumericStat(playerId, stat);
    const percentage = this.getPercentageStat(playerId, stat);
    let value = Math.max(0, (resolvedBase + additive) * (1 + percentage));
    if (stat === 'player.runSpeed') value *= classDefinition?.runSpeedMultiplier ?? 1;
    if (stat === 'player.maxArmor') value *= classDefinition?.maxArmorMultiplier ?? 1;
    return value;
  }

  getMaxHp(playerId: string): number {
    return this.getModifiers(playerId).maxHp;
  }

  getHpRegenPerSecond(playerId: string): number {
    return this.getModifiers(playerId).hpRegenPerSecond;
  }

  clear(): void {
    this.committedProfiles.clear();
    this.runtimeModifiers.clear();
  }

  private resolveRuntimeModifiers(
    profile: CoopDefenseUpgradeProfile,
    classId: CoopDefenseClassId | null,
  ): CoopDefensePlayerRuntimeModifiers {
    const totals = getCoopDefenseResolvedEffectTotals(profile, classId ?? undefined);
    const classDefinition = classId ? getCoopDefenseClassDefinition(classId) : null;
    return {
      classId,
      additiveStats: totals.additive,
      percentageStats: totals.percentage,
      maxHp: (
        HP_MAX + (totals.additive[COOP_DEFENSE_PLAYER_STAT_MAX_HP] ?? 0)
      ) * (1 + (totals.percentage[COOP_DEFENSE_PLAYER_STAT_MAX_HP] ?? 0))
        * (classDefinition?.maxHpMultiplier ?? 1),
      hpRegenPerSecond: (
        totals.additive[COOP_DEFENSE_PLAYER_STAT_HP_REGEN_PER_SECOND] ?? 0
      ) + (classDefinition?.hpRegenBonusPerSecond ?? 0),
    };
  }
}
