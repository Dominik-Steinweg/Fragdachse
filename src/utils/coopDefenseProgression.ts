import type { CoopDefenseUpgradeProfile } from '../types';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  COOP_DEFENSE_HP_UPGRADE_ID,
  getAvailableCoopDefenseUpgradePoints,
  getCoopDefenseUpgradeDefinition,
  getCoopDefenseUpgradeState,
  getSpentCoopDefenseUpgradePoints,
} from './coopDefenseUpgrades';

const XP_STEP = 25;

export interface CoopDefenseProgressSnapshot {
  totalXp: number;
  level: number;
  currentLevelStartXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpNeededForNextLevel: number;
  levelProgressFraction: number;
  spentUpgradePoints: number;
  availableUpgradePoints: number;
  hpUpgradeUnlocked: boolean;
  hpUpgradeLevel: number;
  hpUpgradeMaxLevel: number;
}

function sanitizeXp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function getCoopDefenseXpThresholdForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  const previousLevels = safeLevel - 1;
  return XP_STEP * previousLevels * safeLevel / 2;
}

export function getCoopDefenseLevelForXp(totalXp: number): number {
  const safeXp = sanitizeXp(totalXp);
  const progressUnits = safeXp / XP_STEP;
  const completedSteps = Math.floor((Math.sqrt(1 + 8 * progressUnits) - 1) / 2);
  return Math.max(1, completedSteps + 1);
}

export function getCoopDefenseProgressSnapshot(
  totalXp: number,
  profile: CoopDefenseUpgradeProfile = buildDefaultCoopDefenseUpgradeProfile(),
): CoopDefenseProgressSnapshot {
  const safeXp = sanitizeXp(totalXp);
  const level = getCoopDefenseLevelForXp(safeXp);
  const currentLevelStartXp = getCoopDefenseXpThresholdForLevel(level);
  const nextLevelXp = getCoopDefenseXpThresholdForLevel(level + 1);
  const xpSpan = Math.max(1, nextLevelXp - currentLevelStartXp);
  const spentUpgradePoints = getSpentCoopDefenseUpgradePoints(profile);
  const availableUpgradePoints = getAvailableCoopDefenseUpgradePoints(level, profile);
  const hpUpgradeState = getCoopDefenseUpgradeState(profile, COOP_DEFENSE_HP_UPGRADE_ID);
  const hpUpgradeMaxLevel = getCoopDefenseUpgradeDefinition(COOP_DEFENSE_HP_UPGRADE_ID)?.maxLevel ?? hpUpgradeState.level;

  return {
    totalXp: safeXp,
    level,
    currentLevelStartXp,
    nextLevelXp,
    xpIntoLevel: safeXp - currentLevelStartXp,
    xpNeededForNextLevel: nextLevelXp - safeXp,
    levelProgressFraction: Math.max(0, Math.min(1, (safeXp - currentLevelStartXp) / xpSpan)),
    spentUpgradePoints,
    availableUpgradePoints,
    hpUpgradeUnlocked: hpUpgradeState.unlocked,
    hpUpgradeLevel: hpUpgradeState.level,
    hpUpgradeMaxLevel,
  };
}