import rawCoopDefenseUpgrades from '../config/coopDefenseUpgrades.json';
import type { CoopDefenseUpgradeProfile, CoopDefenseUpgradeState } from '../types';

export interface CoopDefenseUpgradeDefinition {
  id: string;
  label: string;
  maxLevel: number;
  defaultUnlocked: boolean;
}

interface CoopDefenseUpgradeRegistryFile {
  upgrades: readonly CoopDefenseUpgradeDefinition[];
}

export const COOP_DEFENSE_HP_UPGRADE_ID = 'hp';

const COOP_DEFENSE_UPGRADE_REGISTRY = normalizeUpgradeRegistry(
  rawCoopDefenseUpgrades as CoopDefenseUpgradeRegistryFile,
);

export const COOP_DEFENSE_UPGRADE_DEFINITIONS: Record<string, CoopDefenseUpgradeDefinition> = Object.freeze(
  Object.fromEntries(
    COOP_DEFENSE_UPGRADE_REGISTRY.upgrades.map((definition) => [definition.id, definition]),
  ) as Record<string, CoopDefenseUpgradeDefinition>,
);

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeLevelValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function cloneUpgradeState(state: CoopDefenseUpgradeState): CoopDefenseUpgradeState {
  return {
    unlocked: state.unlocked,
    level: state.level,
  };
}

export function getCoopDefenseUpgradeDefinition(upgradeId: string): CoopDefenseUpgradeDefinition | null {
  return COOP_DEFENSE_UPGRADE_DEFINITIONS[upgradeId] ?? null;
}

export function buildDefaultCoopDefenseUpgradeProfile(): CoopDefenseUpgradeProfile {
  const upgrades: Record<string, CoopDefenseUpgradeState> = {};

  for (const definition of Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)) {
    upgrades[definition.id] = {
      unlocked: definition.defaultUnlocked,
      level: 0,
    };
  }

  return { upgrades };
}

export function cloneCoopDefenseUpgradeProfile(profile: CoopDefenseUpgradeProfile): CoopDefenseUpgradeProfile {
  const upgrades: Record<string, CoopDefenseUpgradeState> = {};
  for (const [upgradeId, state] of Object.entries(profile.upgrades)) {
    upgrades[upgradeId] = cloneUpgradeState(state);
  }
  return { upgrades };
}

export function isCoopDefenseUpgradeProfileEqual(
  left: CoopDefenseUpgradeProfile | null | undefined,
  right: CoopDefenseUpgradeProfile | null | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;

  const normalizedLeft = sanitizeCoopDefenseUpgradeProfile(left);
  const normalizedRight = sanitizeCoopDefenseUpgradeProfile(right);
  const upgradeIds = new Set([
    ...Object.keys(normalizedLeft.upgrades),
    ...Object.keys(normalizedRight.upgrades),
  ]);

  for (const upgradeId of upgradeIds) {
    const leftState = getCoopDefenseUpgradeState(normalizedLeft, upgradeId);
    const rightState = getCoopDefenseUpgradeState(normalizedRight, upgradeId);
    if (leftState.unlocked !== rightState.unlocked || leftState.level !== rightState.level) {
      return false;
    }
  }

  return true;
}

export function sanitizeCoopDefenseUpgradeProfile(raw: unknown): CoopDefenseUpgradeProfile {
  const defaults = buildDefaultCoopDefenseUpgradeProfile();
  const input = raw && typeof raw === 'object' && 'upgrades' in raw
    ? (raw as { upgrades?: unknown }).upgrades
    : undefined;
  const nextProfile = cloneCoopDefenseUpgradeProfile(defaults);

  if (input && typeof input === 'object') {
    for (const [upgradeId, value] of Object.entries(input)) {
      if (!value || typeof value !== 'object') continue;
      const definition = getCoopDefenseUpgradeDefinition(upgradeId);
      const fallback = nextProfile.upgrades[upgradeId] ?? {
        unlocked: false,
        level: 0,
      };
      const unlocked = sanitizeBoolean(
        (value as { unlocked?: unknown }).unlocked,
        definition?.defaultUnlocked ?? fallback.unlocked,
      );
      const maxLevel = definition?.maxLevel ?? Number.MAX_SAFE_INTEGER;
      const level = Math.min(maxLevel, sanitizeLevelValue((value as { level?: unknown }).level));
      nextProfile.upgrades[upgradeId] = { unlocked, level };
    }
  }

  return nextProfile;
}

export function getCoopDefenseUpgradeState(
  profile: CoopDefenseUpgradeProfile,
  upgradeId: string,
): CoopDefenseUpgradeState {
  const definition = getCoopDefenseUpgradeDefinition(upgradeId);
  const stored = profile.upgrades[upgradeId];

  if (!stored) {
    return {
      unlocked: definition?.defaultUnlocked ?? false,
      level: 0,
    };
  }

  return cloneUpgradeState(stored);
}

export function getSpentCoopDefenseUpgradePoints(profile: CoopDefenseUpgradeProfile): number {
  return Object.values(profile.upgrades)
    .reduce((sum, state) => sum + Math.max(0, Math.floor(state.level)), 0);
}

export function getAvailableCoopDefenseUpgradePoints(
  playerLevel: number,
  profile: CoopDefenseUpgradeProfile,
): number {
  const earnedPoints = Math.max(0, Math.floor(playerLevel) - 1);
  return Math.max(0, earnedPoints - getSpentCoopDefenseUpgradePoints(profile));
}

export function canLevelUpCoopDefenseUpgrade(
  profile: CoopDefenseUpgradeProfile,
  upgradeId: string,
  playerLevel: number,
): boolean {
  const definition = getCoopDefenseUpgradeDefinition(upgradeId);
  if (!definition) return false;

  const state = getCoopDefenseUpgradeState(profile, upgradeId);
  if (!state.unlocked || state.level >= definition.maxLevel) return false;

  return getAvailableCoopDefenseUpgradePoints(playerLevel, profile) > 0;
}

export function levelUpCoopDefenseUpgrade(
  profile: CoopDefenseUpgradeProfile,
  upgradeId: string,
  playerLevel: number,
): CoopDefenseUpgradeProfile | null {
  if (!canLevelUpCoopDefenseUpgrade(profile, upgradeId, playerLevel)) {
    return null;
  }

  const definition = getCoopDefenseUpgradeDefinition(upgradeId);
  if (!definition) return null;

  const nextProfile = cloneCoopDefenseUpgradeProfile(profile);
  const state = getCoopDefenseUpgradeState(nextProfile, upgradeId);
  nextProfile.upgrades[upgradeId] = {
    unlocked: state.unlocked,
    level: Math.min(definition.maxLevel, state.level + 1),
  };
  return nextProfile;
}

export function canLevelDownCoopDefenseUpgrade(
  profile: CoopDefenseUpgradeProfile,
  upgradeId: string,
): boolean {
  const definition = getCoopDefenseUpgradeDefinition(upgradeId);
  if (!definition) return false;

  const state = getCoopDefenseUpgradeState(profile, upgradeId);
  return state.level > 0;
}

export function levelDownCoopDefenseUpgrade(
  profile: CoopDefenseUpgradeProfile,
  upgradeId: string,
): CoopDefenseUpgradeProfile | null {
  if (!canLevelDownCoopDefenseUpgrade(profile, upgradeId)) {
    return null;
  }

  const nextProfile = cloneCoopDefenseUpgradeProfile(profile);
  const state = getCoopDefenseUpgradeState(nextProfile, upgradeId);
  nextProfile.upgrades[upgradeId] = {
    unlocked: state.unlocked,
    level: Math.max(0, state.level - 1),
  };
  return nextProfile;
}

function normalizeUpgradeRegistry(registry: CoopDefenseUpgradeRegistryFile): CoopDefenseUpgradeRegistryFile {
  const uniqueUpgradeIds = new Set<string>();
  const upgrades = registry.upgrades.map((definition) => normalizeUpgradeDefinition(definition));

  for (const definition of upgrades) {
    if (uniqueUpgradeIds.has(definition.id)) {
      throw new Error(`[coopDefenseUpgrades] Duplicate upgrade id: ${definition.id}`);
    }
    uniqueUpgradeIds.add(definition.id);
  }

  return { upgrades };
}

function normalizeUpgradeDefinition(definition: CoopDefenseUpgradeDefinition): CoopDefenseUpgradeDefinition {
  return {
    id: definition.id,
    label: definition.label,
    maxLevel: Math.max(1, Math.floor(definition.maxLevel)),
    defaultUnlocked: definition.defaultUnlocked,
  };
}