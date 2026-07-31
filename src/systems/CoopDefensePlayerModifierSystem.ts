import { HP_MAX } from '../config';
import {
  getCoopDefenseClassDefinition,
  type CoopDefenseClassDefinition,
} from '../config/coopDefenseClasses';
import type {
  CoopDefenseClassId,
  CoopDefenseItem,
  CoopDefenseUpgradeProfile,
  LoadoutCommitSnapshot,
} from '../types';
import { getCoopDefenseCommittedEffectTotals } from '../utils/coopDefenseItemEffects';
import {
  resolveCoopDefenseOutgoingDamage,
  resolveCoopDefenseStat,
} from '../utils/coopDefenseStats';
import {
  cloneCoopDefenseUpgradeProfile,
  COOP_DEFENSE_PLAYER_STAT_HP_REGEN_PER_SECOND,
  COOP_DEFENSE_PLAYER_STAT_MAX_HP,
  sanitizeCoopDefenseUpgradeProfile,
} from '../utils/coopDefenseUpgrades';

const EMPTY_ITEMS: readonly CoopDefenseItem[] = Object.freeze([]);

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
    const items = snapshot?.equippedItems ?? EMPTY_ITEMS;
    // Ausruestung wirkt auch ohne Upgrade-Profil; nur ohne beides gibt es nichts zu fuehren.
    if (!rawProfile && items.length === 0) {
      this.committedProfiles.delete(playerId);
      this.runtimeModifiers.delete(playerId);
      return;
    }

    const profile = rawProfile
      ? sanitizeCoopDefenseUpgradeProfile(rawProfile, classId ?? undefined)
      : null;
    if (profile) {
      this.committedProfiles.set(playerId, cloneCoopDefenseUpgradeProfile(profile, classId ?? undefined));
    } else {
      this.committedProfiles.delete(playerId);
    }
    this.runtimeModifiers.set(playerId, this.resolveRuntimeModifiers(profile, classId, items));
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
    // Bewusst kein Fruehausstieg ohne Klasse: die bonuslose Default-Klasse vor Abschluss von
    // Map 5 hat `classId === null`, muss aber Upgrade- und Item-Boni trotzdem erhalten.
    const modifiers = this.getModifiers(attackerId);
    return resolveCoopDefenseOutgoingDamage(
      { additive: modifiers.additiveStats, percentage: modifiers.percentageStats },
      modifiers.classId,
      amount,
      allowCritical,
      random,
    );
  }

  getNumericStat(playerId: string, stat: string): number {
    return this.getModifiers(playerId).additiveStats[stat] ?? 0;
  }

  getPercentageStat(playerId: string, stat: string): number {
    return this.getModifiers(playerId).percentageStats[stat] ?? 0;
  }

  getResolvedStat(playerId: string, stat: string, baseValue: number): number {
    const modifiers = this.getModifiers(playerId);
    return resolveCoopDefenseStat(
      { additive: modifiers.additiveStats, percentage: modifiers.percentageStats },
      modifiers.classId,
      stat,
      baseValue,
    );
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
    profile: CoopDefenseUpgradeProfile | null,
    classId: CoopDefenseClassId | null,
    items: readonly CoopDefenseItem[],
  ): CoopDefensePlayerRuntimeModifiers {
    // Ein gemeinsamer Bucket fuer Upgrades und Items: `maxHp` und `hpRegenPerSecond` unten
    // uebernehmen die Item-Werte dadurch ohne eigene Verdrahtung.
    const totals = getCoopDefenseCommittedEffectTotals(profile, classId, items);
    const classDefinition = classId ? getCoopDefenseClassDefinition(classId) : null;
    return {
      classId,
      additiveStats: totals.additive,
      percentageStats: totals.percentage,
      maxHp: resolveCoopDefenseStat(totals, classId, COOP_DEFENSE_PLAYER_STAT_MAX_HP, HP_MAX),
      hpRegenPerSecond: (
        totals.additive[COOP_DEFENSE_PLAYER_STAT_HP_REGEN_PER_SECOND] ?? 0
      ) + (classDefinition?.hpRegenBonusPerSecond ?? 0),
    };
  }
}
