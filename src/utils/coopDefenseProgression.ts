import { COOP_DEFENSE_CLASS_IDS, DEFAULT_COOP_DEFENSE_CLASS_ID } from '../config/coopDefenseClasses';
import type { CoopDefenseClassId, CoopDefenseUpgradeProfile, GameMode, LoadoutSlot, LoadoutToolRef } from '../types';
import { getSelectableLoadoutItems, type LoadoutItemRef } from '../loadout/LoadoutCatalog';
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
  getCoopDefenseToolCapacity,
  getLoadoutToolRefForUpgrade,
  type CoopDefenseLoadoutUnlockDefinition,
  type CoopDefenseUpgradeCategoryDefinition,
  type CoopDefenseUpgradeCategoryId,
  type CoopDefenseUpgradeDefinition,
  type CoopDefenseUpgradeKind,
  type CoopDefenseUpgradeRequirementDefinition,
} from './coopDefenseUpgrades';

const FIRST_LEVEL_UP_XP = 10;
const XP_INCREASE_PER_LEVEL = 25;

export interface CoopDefenseProgressSnapshot {
  classId: CoopDefenseClassId;
  classesUnlocked: boolean;
  unlockedClassIds: readonly CoopDefenseClassId[];
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
  /** Freigeschaltete und damit im Overlay auswaehlbare Items je Loadout-Slot. */
  unlockedItemsBySlot: Readonly<Record<LoadoutSlot, readonly LoadoutItemRef[]>>;
  toolSlotCapacity: number;
  toolLoadout: readonly LoadoutToolRef[];
  selectedTool: LoadoutToolRef | null;
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
  toolRef: LoadoutToolRef | null;
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
  const completedLevelUps = safeLevel - 1;
  if (completedLevelUps === 0) return 0;
  return completedLevelUps * (
    2 * FIRST_LEVEL_UP_XP + (completedLevelUps - 1) * XP_INCREASE_PER_LEVEL
  ) / 2;
}

export function getCoopDefenseLevelForXp(totalXp: number): number {
  const safeXp = sanitizeXp(totalXp);
  // threshold(n) = n * (20 + 25 * (n - 1)) / 2 = (25n² - 5n) / 2,
  // where n is the number of completed level-ups.
  const completedLevelUps = Math.floor((5 + Math.sqrt(25 + 200 * safeXp)) / 50);
  return Math.max(1, completedLevelUps + 1);
}

export function getCoopDefenseProgressSnapshot(
  totalXp: number,
  profile: CoopDefenseUpgradeProfile = buildDefaultCoopDefenseUpgradeProfile(),
  earnedBossPoints = 0,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
  classesUnlocked = true,
  unlockedClassIds: readonly CoopDefenseClassId[] = classesUnlocked ? COOP_DEFENSE_CLASS_IDS : [],
): CoopDefenseProgressSnapshot {
  const safeXp = sanitizeXp(totalXp);
  const safeProfile = sanitizeCoopDefenseUpgradeProfile(profile, classId);
  const level = getCoopDefenseLevelForXp(safeXp);
  const currentLevelStartXp = getCoopDefenseXpThresholdForLevel(level);
  const nextLevelXp = getCoopDefenseXpThresholdForLevel(level + 1);
  const xpSpan = Math.max(1, nextLevelXp - currentLevelStartXp);
  const spentUpgradePoints = getSpentCoopDefenseUpgradePoints(safeProfile, classId);
  const availableUpgradePoints = getAvailableCoopDefenseUpgradePoints(level, safeProfile, classId);
  const safeEarnedBossPoints = Math.max(0, Math.floor(earnedBossPoints));
  const spentBossPoints = getSpentCoopDefenseBossPoints(safeProfile, classId);
  const availableBossPoints = getAvailableCoopDefenseBossPoints(safeEarnedBossPoints, safeProfile, classId);
  const hpUpgradeState = getCoopDefenseUpgradeState(safeProfile, COOP_DEFENSE_HP_UPGRADE_ID, classId);
  const hpUpgradeMaxLevel = getCoopDefenseUpgradeDefinition(COOP_DEFENSE_HP_UPGRADE_ID)?.maxLevel ?? hpUpgradeState.level;
  const upgradeCategories = buildUpgradeCategorySnapshots(safeProfile, level, safeEarnedBossPoints, classId);

  return {
    classId,
    classesUnlocked: unlockedClassIds.length > 0,
    unlockedClassIds,
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
    unlockedItemsBySlot: buildUnlockedItemsBySlot(safeProfile, classId),
    toolSlotCapacity: classId === 'inspector_gadachs' ? getCoopDefenseToolCapacity(safeProfile) : 0,
    toolLoadout: classId === 'inspector_gadachs' ? (safeProfile.toolLoadout ?? []) : [],
    selectedTool: classId === 'inspector_gadachs' ? (safeProfile.selectedTool ?? null) : null,
  };
}

const COOP_DEFENSE_MODE = 'coop_defense' as GameMode;
const LOADOUT_SLOTS: readonly LoadoutSlot[] = ['weapon1', 'weapon2', 'utility', 'ultimate'];

function buildUnlockedItemsBySlot(
  profile: CoopDefenseUpgradeProfile,
  classId: CoopDefenseClassId,
): Readonly<Record<LoadoutSlot, readonly LoadoutItemRef[]>> {
  return Object.fromEntries(
    LOADOUT_SLOTS.map((slot) => [
      slot,
      getSelectableLoadoutItems(slot, COOP_DEFENSE_MODE, profile, classId),
    ]),
  ) as Record<LoadoutSlot, readonly LoadoutItemRef[]>;
}

function buildUpgradeCategorySnapshots(
  profile: CoopDefenseUpgradeProfile,
  playerLevel: number,
  earnedBossPoints: number,
  classId: CoopDefenseClassId,
): readonly CoopDefenseUpgradeCategorySnapshot[] {
  return getCoopDefenseUpgradeCategories(classId).map((category) => ({
    id: category.id,
    label: category.label,
    description: category.description,
    upgrades: category.upgrades.map((definition) => (
      buildUpgradeNodeSnapshot(profile, playerLevel, earnedBossPoints, classId, category, definition)
    )),
  }));
}

function buildUpgradeNodeSnapshot(
  profile: CoopDefenseUpgradeProfile,
  playerLevel: number,
  earnedBossPoints: number,
  classId: CoopDefenseClassId,
  category: CoopDefenseUpgradeCategoryDefinition,
  definition: CoopDefenseUpgradeDefinition,
): CoopDefenseUpgradeNodeSnapshot {
  const state = getCoopDefenseUpgradeState(profile, definition.id, classId);
  const availableBossPoints = getAvailableCoopDefenseBossPoints(earnedBossPoints, profile, classId);

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
    canLevelUp: canLevelUpCoopDefenseUpgrade(profile, definition.id, playerLevel, earnedBossPoints, classId),
    canLevelDown: canLevelDownCoopDefenseUpgrade(profile, definition.id, classId),
    requires: definition.requires.map((requirement) => buildRequirementSnapshot(profile, classId, requirement)),
    loadoutUnlock: definition.loadoutUnlock ?? null,
    toolRef: classId === 'inspector_gadachs'
      ? getLoadoutToolRefForUpgrade(definition.id)
      : null,
  };
}

function buildRequirementSnapshot(
  profile: CoopDefenseUpgradeProfile,
  classId: CoopDefenseClassId,
  requirement: CoopDefenseUpgradeRequirementDefinition,
): CoopDefenseUpgradeRequirementSnapshot {
  const state = getCoopDefenseUpgradeState(profile, requirement.upgradeId, classId);
  const definition = getCoopDefenseUpgradeDefinition(requirement.upgradeId);

  return {
    upgradeId: requirement.upgradeId,
    label: definition?.label ?? requirement.upgradeId,
    minLevel: requirement.minLevel,
    currentLevel: state.level,
    satisfied: state.level >= requirement.minLevel,
  };
}
