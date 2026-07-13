import type { CoopDefenseUpgradeProfile } from '../types';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  canLevelDownCoopDefenseUpgrade,
  canLevelUpCoopDefenseUpgrade,
  COOP_DEFENSE_HP_UPGRADE_ID,
  getAvailableCoopDefenseUpgradePoints,
  getAvailableCoopDefenseBossPoints,
  getCoopDefenseUpgradeCategories,
  getCoopDefenseUpgradeDefinition,
  getCoopDefenseUpgradeState,
  getSpentCoopDefenseUpgradePoints,
  getSpentCoopDefenseBossPoints,
  sanitizeCoopDefenseUpgradeProfile,
  type CoopDefenseLoadoutUnlockDefinition,
  type CoopDefenseUpgradeCategoryDefinition,
  type CoopDefenseUpgradeCategoryId,
  type CoopDefenseUpgradeDefinition,
  type CoopDefenseUpgradeKind,
  type CoopDefenseUpgradeRequirementDefinition,
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
  earnedBossPoints: number;
  spentBossPoints: number;
  availableBossPoints: number;
  hpUpgradeUnlocked: boolean;
  hpUpgradeLevel: number;
  hpUpgradeMaxLevel: number;
  upgradeCategories: readonly CoopDefenseUpgradeCategorySnapshot[];
}

export interface CoopDefenseUpgradeRequirementSnapshot {
  upgradeId: string;
  label: string;
  minLevel: number;
  currentLevel: number;
  satisfied: boolean;
}

export interface CoopDefenseUpgradeNodeSnapshot {
  id: string;
  code: string | null;
  label: string;
  description: string;
  categoryId: CoopDefenseUpgradeCategoryId;
  kind: CoopDefenseUpgradeKind;
  unlocked: boolean;
  level: number;
  startingLevel: number;
  maxLevel: number;
  refundable: boolean;
  costPerLevel: number;
  bossPointCostPerLevel: number;
  bossPointRequirementMet: boolean;
  canLevelUp: boolean;
  canLevelDown: boolean;
  requires: readonly CoopDefenseUpgradeRequirementSnapshot[];
  loadoutUnlock: CoopDefenseLoadoutUnlockDefinition | null;
}

export interface CoopDefenseUpgradeCategorySnapshot {
  id: CoopDefenseUpgradeCategoryId;
  label: string;
  description: string;
  upgrades: readonly CoopDefenseUpgradeNodeSnapshot[];
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
  earnedBossPoints = 0,
): CoopDefenseProgressSnapshot {
  const safeXp = sanitizeXp(totalXp);
  const safeProfile = sanitizeCoopDefenseUpgradeProfile(profile);
  const level = getCoopDefenseLevelForXp(safeXp);
  const currentLevelStartXp = getCoopDefenseXpThresholdForLevel(level);
  const nextLevelXp = getCoopDefenseXpThresholdForLevel(level + 1);
  const xpSpan = Math.max(1, nextLevelXp - currentLevelStartXp);
  const spentUpgradePoints = getSpentCoopDefenseUpgradePoints(safeProfile);
  const availableUpgradePoints = getAvailableCoopDefenseUpgradePoints(level, safeProfile);
  const safeEarnedBossPoints = Math.max(0, Math.floor(earnedBossPoints));
  const spentBossPoints = getSpentCoopDefenseBossPoints(safeProfile);
  const availableBossPoints = getAvailableCoopDefenseBossPoints(safeEarnedBossPoints, safeProfile);
  const hpUpgradeState = getCoopDefenseUpgradeState(safeProfile, COOP_DEFENSE_HP_UPGRADE_ID);
  const hpUpgradeMaxLevel = getCoopDefenseUpgradeDefinition(COOP_DEFENSE_HP_UPGRADE_ID)?.maxLevel ?? hpUpgradeState.level;
  const upgradeCategories = buildUpgradeCategorySnapshots(safeProfile, level, safeEarnedBossPoints);

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
    earnedBossPoints: safeEarnedBossPoints,
    spentBossPoints,
    availableBossPoints,
    hpUpgradeUnlocked: hpUpgradeState.unlocked,
    hpUpgradeLevel: hpUpgradeState.level,
    hpUpgradeMaxLevel,
    upgradeCategories,
  };
}

function buildUpgradeCategorySnapshots(
  profile: CoopDefenseUpgradeProfile,
  playerLevel: number,
  earnedBossPoints: number,
): readonly CoopDefenseUpgradeCategorySnapshot[] {
  return getCoopDefenseUpgradeCategories().map((category) => ({
    id: category.id,
    label: category.label,
    description: category.description,
    upgrades: category.upgrades.map((definition) => (
      buildUpgradeNodeSnapshot(profile, playerLevel, earnedBossPoints, category, definition)
    )),
  }));
}

function buildUpgradeNodeSnapshot(
  profile: CoopDefenseUpgradeProfile,
  playerLevel: number,
  earnedBossPoints: number,
  category: CoopDefenseUpgradeCategoryDefinition,
  definition: CoopDefenseUpgradeDefinition,
): CoopDefenseUpgradeNodeSnapshot {
  const state = getCoopDefenseUpgradeState(profile, definition.id);
  const availableBossPoints = getAvailableCoopDefenseBossPoints(earnedBossPoints, profile);

  return {
    id: definition.id,
    code: definition.code ?? null,
    label: definition.label,
    description: definition.description,
    categoryId: category.id,
    kind: definition.kind,
    unlocked: state.unlocked,
    level: state.level,
    startingLevel: definition.startingLevel,
    maxLevel: definition.maxLevel,
    refundable: definition.refundable,
    costPerLevel: definition.costPerLevel,
    bossPointCostPerLevel: definition.bossPointCostPerLevel,
    bossPointRequirementMet: availableBossPoints >= definition.bossPointCostPerLevel,
    canLevelUp: canLevelUpCoopDefenseUpgrade(profile, definition.id, playerLevel, earnedBossPoints),
    canLevelDown: canLevelDownCoopDefenseUpgrade(profile, definition.id),
    requires: definition.requires.map((requirement) => buildRequirementSnapshot(profile, requirement)),
    loadoutUnlock: definition.loadoutUnlock ?? null,
  };
}

function buildRequirementSnapshot(
  profile: CoopDefenseUpgradeProfile,
  requirement: CoopDefenseUpgradeRequirementDefinition,
): CoopDefenseUpgradeRequirementSnapshot {
  const state = getCoopDefenseUpgradeState(profile, requirement.upgradeId);
  const definition = getCoopDefenseUpgradeDefinition(requirement.upgradeId);

  return {
    upgradeId: requirement.upgradeId,
    label: definition?.label ?? requirement.upgradeId,
    minLevel: requirement.minLevel,
    currentLevel: state.level,
    satisfied: state.level >= requirement.minLevel,
  };
}
