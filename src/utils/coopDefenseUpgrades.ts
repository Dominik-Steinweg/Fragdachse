import rawCoopDefenseUpgrades from '../config/coopDefenseUpgrades.json';
import {
  DEFAULT_COOP_DEFENSE_CLASS_ID,
  getCoopDefenseClassDefinition,
} from '../config/coopDefenseClasses';
import {
  COOP_DEFENSE_CONSTRUCTION_BASE_SLOTS,
  COOP_DEFENSE_CONSTRUCTION_IDS,
  COOP_DEFENSE_CONSTRUCTION_SLOT_UPGRADE_ID,
  COOP_DEFENSE_CONSTRUCTIONS,
} from '../config/coopDefenseConstructions';
import {
  isUltimateAllowedInMode,
  ULTIMATE_CONFIGS,
  UTILITY_CONFIGS,
  WEAPON_CONFIGS,
} from '../loadout/LoadoutConfig';
import type {
  CoopDefenseUpgradeProfile,
  CoopDefenseUpgradeState,
  CoopDefenseClassId,
  ConstructionId,
  GameMode,
  LoadoutSlot,
} from '../types';

export type CoopDefenseUpgradeCategoryId = 'general' | 'weapon1' | 'weapon2' | 'utility' | 'ultimate';
export type CoopDefenseUpgradeKind = 'upgrade' | 'unlock';
export type CoopDefenseUpgradeEffectMode = 'add_per_level' | 'add_percent_per_level';

const COOP_DEFENSE_UPGRADE_ICON_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ultimate_armor_rage: 'UPGRADE_ULTIMATE_RAGE_GAIN',
  dash_range: 'UPGRADE_DASH_RECOVERY',
  dash_fire_trail: 'UPGRADE_MOLOTOV_WILDFIRE',
  dash_impact_damage: 'UPGRADE_DASH_IMPACT',
  dash_overdrive: 'UPGRADE_DASH_RECOVERY',
  glock_adrenaline_gain: 'UPGRADE_ADRENALINE_GAIN',
  glock_stopping_power: 'UPGRADE_LAUBBLAESER_KNOCKBACK',
  asmd_secondary_dot_field_damage: 'UPGRADE_ASMD_SECONDARY_DOT_FIELD',
  asmd_secondary_combo_adrenaline: 'UPGRADE_ADRENALINE_GAIN',
  asmd_secondary_match_primary_range: 'UPGRADE_ASMD_PRIMARY_RANGE',
  asmd_secondary_arc_lightning: 'UPGRADE_ASMD_PRIMARY_CHAIN_LIGHTNING',
  asmd_secondary_arc_range: 'UPGRADE_ASMD_PRIMARY_RANGE',
  asmd_secondary_arc_damage: 'UPGRADE_ASMD_SECONDARY_DAMAGE',
  ak47_focus: 'UPGRADE_AK47_ACCURACY',
  ak47_focus_duration: 'UPGRADE_AK47_RANGE',
  ak47_focus_damage: 'UPGRADE_AK47_DAMAGE',
  ak47_fire_superiority: 'UPGRADE_AK47_ARMOR_PIERCER',
  ak47_fire_superiority_shots: 'UPGRADE_AK47_ADRENALINE_COST',
  ak47_fire_superiority_damage: 'UPGRADE_AK47_DAMAGE',
  shotgun_brake_load: 'UPGRADE_SHOTGUN_PELLET_SPREAD',
  shotgun_lightning_blast: 'UPGRADE_ASMD_PRIMARY_CHAIN_LIGHTNING',
  shotgun_lightning_slow: 'UPGRADE_TIME_BUBBLE_SLOW_STRENGTH',
  shotgun_round_shot: 'UPGRADE_SHOTGUN_PELLET_STORM',
  shotgun_proximity_damage: 'UPGRADE_SHOTGUN_PELLET_COUNT',
  shotgun_range: 'UPGRADE_ASMD_PRIMARY_RANGE',
  shotgun_thunder_avalanche: 'UPGRADE_ASMD_PRIMARY_CHAIN_LIGHTNING',
  shotgun_lightning_radius: 'UPGRADE_ASMD_SECONDARY_EXPLOSION_RADIUS',
  shotgun_lightning_damage: 'UPGRADE_ASMD_SECONDARY_DAMAGE',
  mini_rocket_thermobaric_charge: 'UPGRADE_MINI_ROCKET_LAUNCHER_EXPLOSION_RADIUS',
  mini_rocket_launcher_homing_turn: 'UPGRADE_P90_HOMING_TURN',
  mini_rocket_launcher_explosion_damage: 'UPGRADE_ROCKET_LAUNCHER_DIRECT_DAMAGE',
  mini_rocket_long_range_drive: 'UPGRADE_ROCKET_LAUNCHER_BLACK_HOLE',
  mini_rocket_triple_detonation: 'UPGRADE_SHOTGUN_PELLET_STORM',
  mini_rocket_cascade_charge: 'UPGRADE_ROCKET_LAUNCHER_DIRECT_DAMAGE',
  mini_rocket_homecoming_protocol: 'UPGRADE_TRANSLOCATOR_SPEED',
  mini_rocket_adrenaline_recovery: 'UPGRADE_ADRENALINE_GAIN',
  mini_rocket_armor_recovery: 'UPGRADE_ARMOR_REGENERATION',
  necromancy: 'UPGRADE_GUARDIAN_SPIRITS',
  necromancy_count: 'UPGRADE_GUARDIAN_SPIRITS',
  necromancy_hp: 'UPGRADE_HP',
  necromancy_vitality: 'UPGRADE_HP',
  necromancy_undying: 'UPGRADE_HP_REGENERATION',
  necromancy_revive_radius: 'UPGRADE_ASMD_PRIMARY_RANGE',
  necromancy_dominance: 'UPGRADE_GUARDIAN_SPIRIT_TRINITY',
  general_burning_projectiles: 'UPGRADE_NEGEV_BURNING_BULLETS',
  flamethrower_fire_ring: 'UPGRADE_FLAMETHROWER_BURN_DURATION',
  flamethrower_fire_ring_projectiles: 'UPGRADE_GLOCK_BURNING_BULLETS',
  flamethrower_fire_ring_damage: 'UPGRADE_FLAMETHROWER_BURN_DAMAGE',
  flamethrower_fire_ring_radius: 'UPGRADE_MOLOTOV_GRENADE_RADIUS',
  flamethrower_death_fire_burst: 'UPGRADE_MOLOTOV_WILDFIRE',
  flamethrower_adrenalin_efficiency: 'UPGRADE_AK47_ADRENALINE_COST',
  flamethrower_range: 'UPGRADE_ASMD_PRIMARY_RANGE',
  flamethrower_fireball: 'UPGRADE_ROCKET_LAUNCHER_BURNING_EXPLOSION',
  flamethrower_fireball_trail: 'UPGRADE_ROCKET_LAUNCHER_BURNING_EXPLOSION_DAMAGE',
  flamethrower_fireball_chunks: 'UPGRADE_MOLOTOV_WILDFIRE',
  armageddon_meteor_count: 'UPGRADE_WEAPON2_FIRE_RATE',
  armageddon_rage_required: 'UPGRADE_ULTIMATE_MAX_RAGE',
  armageddon_radius: 'UPGRADE_AIRSTRIKE_RADIUS',
  armageddon_fire_chunks: 'UPGRADE_MOLOTOV_WILDFIRE',
  inspector_construction_slots: 'UPGRADE_MAX_ADRENALINE',
  inspector_construction_hp: 'UPGRADE_HP',
  inspector_repair_drone: 'UPGRADE_GUARDIAN_SPIRITS',
});

export function getCoopDefenseUpgradeTextureKey(upgradeId: string): string {
  return COOP_DEFENSE_UPGRADE_ICON_ALIASES[upgradeId] ?? `UPGRADE_${upgradeId.toUpperCase()}`;
}

export interface CoopDefenseUpgradeEffectDefinition {
  stat: string;
  mode: CoopDefenseUpgradeEffectMode;
  value: number;
}

export interface CoopDefenseUpgradeRequirementDefinition {
  upgradeId: string;
  minLevel: number;
}

export interface CoopDefenseLoadoutUnlockDefinition {
  slot: LoadoutSlot;
  itemId: string;
}

export type CoopDefenseUpgradeLoadoutSelection = CoopDefenseLoadoutUnlockDefinition;

export interface CoopDefenseUpgradeDefinition {
  id: string;
  code?: string;
  label: string;
  description: string;
  categoryId: CoopDefenseUpgradeCategoryId;
  kind: CoopDefenseUpgradeKind;
  maxLevel: number;
  startingLevel: number;
  costPerLevel: number;
  bossPointCostPerLevel: number;
  refundable: boolean;
  sortOrder: number;
  requires: readonly CoopDefenseUpgradeRequirementDefinition[];
  effects: readonly CoopDefenseUpgradeEffectDefinition[];
  loadoutUnlock?: CoopDefenseLoadoutUnlockDefinition;
}

export interface CoopDefenseUpgradeCategoryDefinition {
  id: CoopDefenseUpgradeCategoryId;
  label: string;
  description: string;
  sortOrder: number;
  upgrades: readonly CoopDefenseUpgradeDefinition[];
}

export interface CoopDefenseResolvedEffectTotals {
  additive: Readonly<Record<string, number>>;
  percentage: Readonly<Record<string, number>>;
}

interface RawCoopDefenseUpgradeDefinition {
  id?: unknown;
  code?: unknown;
  label?: unknown;
  description?: unknown;
  kind?: unknown;
  maxLevel?: unknown;
  startingLevel?: unknown;
  costPerLevel?: unknown;
  bossPointCostPerLevel?: unknown;
  refundable?: unknown;
  sortOrder?: unknown;
  requires?: readonly unknown[];
  effects?: readonly unknown[];
  loadoutUnlock?: unknown;
}

interface RawCoopDefenseUpgradeCategoryDefinition {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  sortOrder?: unknown;
  upgrades?: readonly unknown[];
}

interface CoopDefenseUpgradeRegistryFile {
  categories: readonly RawCoopDefenseUpgradeCategoryDefinition[];
}

interface NormalizedCoopDefenseUpgradeRegistry {
  categories: readonly CoopDefenseUpgradeCategoryDefinition[];
  upgrades: readonly CoopDefenseUpgradeDefinition[];
}

const COOP_DEFENSE_MODE = 'coop_defense' as GameMode;
const CATEGORY_IDS: readonly CoopDefenseUpgradeCategoryId[] = ['general', 'weapon1', 'weapon2', 'utility', 'ultimate'];

export const COOP_DEFENSE_HP_UPGRADE_ID = 'hp';
export const COOP_DEFENSE_PLAYER_STAT_MAX_HP = 'player.maxHp';
export const COOP_DEFENSE_PLAYER_STAT_HP_REGEN_PER_SECOND = 'player.hpRegenPerSecond';

const COOP_DEFENSE_UPGRADE_REGISTRY = normalizeUpgradeRegistry(
  rawCoopDefenseUpgrades as CoopDefenseUpgradeRegistryFile,
);

export const COOP_DEFENSE_UPGRADE_CATEGORIES = Object.freeze([...COOP_DEFENSE_UPGRADE_REGISTRY.categories]);

export const COOP_DEFENSE_UPGRADE_DEFINITIONS: Record<string, CoopDefenseUpgradeDefinition> = Object.freeze(
  Object.fromEntries(
    COOP_DEFENSE_UPGRADE_REGISTRY.upgrades.map((definition) => [definition.id, definition]),
  ) as Record<string, CoopDefenseUpgradeDefinition>,
);

const COOP_DEFENSE_UPGRADE_ORDER = buildTopologicalUpgradeOrder(COOP_DEFENSE_UPGRADE_REGISTRY.upgrades);
const COOP_DEFENSE_UPGRADE_DEPENDENTS = buildDependentMap(COOP_DEFENSE_UPGRADE_REGISTRY.upgrades);
const COOP_DEFENSE_UPGRADES_BY_CATEGORY = new Map<CoopDefenseUpgradeCategoryId, readonly CoopDefenseUpgradeDefinition[]>(
  COOP_DEFENSE_UPGRADE_CATEGORIES.map((category) => [category.id, category.upgrades]),
);
const COOP_DEFENSE_LOADOUT_UNLOCKS = new Map<string, string>();
const INSPECTOR_UPGRADE_IDS = new Set([
  ...COOP_DEFENSE_CONSTRUCTION_IDS.map((id) => COOP_DEFENSE_CONSTRUCTIONS[id].unlockUpgradeId),
  'inspector_construction_slots',
  'inspector_construction_hp',
  'inspector_repair_drone',
]);

for (const definition of COOP_DEFENSE_UPGRADE_REGISTRY.upgrades) {
  if (!definition.loadoutUnlock) continue;
  COOP_DEFENSE_LOADOUT_UNLOCKS.set(
    getLoadoutUnlockKey(definition.loadoutUnlock.slot, definition.loadoutUnlock.itemId),
    definition.id,
  );
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeInteger(value: unknown, fallback: number, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.floor(value));
}

function sanitizeEffectValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value;
}

function sanitizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireString(value: unknown, errorMessage: string): string {
  const trimmed = sanitizeOptionalString(value);
  if (!trimmed) throw new Error(errorMessage);
  return trimmed;
}

function cloneUpgradeState(state: CoopDefenseUpgradeState): CoopDefenseUpgradeState {
  return {
    unlocked: state.unlocked,
    level: state.level,
  };
}

function getLoadoutUnlockKey(slot: LoadoutSlot, itemId: string): string {
  return `${slot}:${itemId}`;
}

function getResolvedUpgradeLevel(profile: CoopDefenseUpgradeProfile, upgradeId: string): number {
  return profile.upgrades[upgradeId]?.level ?? 0;
}

function areUpgradeRequirementsMet(
  definition: CoopDefenseUpgradeDefinition,
  levels: Readonly<Record<string, number>>,
): boolean {
  return definition.requires.every((requirement) => (levels[requirement.upgradeId] ?? 0) >= requirement.minLevel);
}

function collectUpgradeAndDependentIds(rootIds: readonly string[]): Set<string> {
  const result = new Set<string>();
  const queue = [...rootIds];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || result.has(id)) continue;
    result.add(id);
    queue.push(...(COOP_DEFENSE_UPGRADE_DEPENDENTS.get(id) ?? []));
  }
  return result;
}

function getUnavailableUpgradeIds(classId: CoopDefenseClassId): ReadonlySet<string> {
  if (classId !== 'inspector_gadachs') {
    return INSPECTOR_UPGRADE_IDS;
  }

  const excluded = collectUpgradeAndDependentIds(
    getCoopDefenseClassDefinition(classId).excludedGeneralUpgradeIds,
  );
  for (const definition of COOP_DEFENSE_UPGRADE_ORDER) {
    if (definition.categoryId === 'weapon2' && !INSPECTOR_UPGRADE_IDS.has(definition.id)) {
      excluded.add(definition.id);
    }
  }
  return excluded;
}

export function isCoopDefenseUpgradeAvailableForClass(
  upgradeId: string,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): boolean {
  return !getUnavailableUpgradeIds(classId).has(upgradeId);
}

function getConstructionSlotCapacity(levels: Readonly<Record<string, number>>): number {
  return COOP_DEFENSE_CONSTRUCTION_BASE_SLOTS
    + Math.max(0, levels[COOP_DEFENSE_CONSTRUCTION_SLOT_UPGRADE_ID] ?? 0);
}

function getUnlockedConstructionCount(levels: Readonly<Record<string, number>>): number {
  return COOP_DEFENSE_CONSTRUCTION_IDS.reduce((count, constructionId) => (
    count + ((levels[COOP_DEFENSE_CONSTRUCTIONS[constructionId].unlockUpgradeId] ?? 0) > 0 ? 1 : 0)
  ), 0);
}

function buildProfileFromRequestedLevels(
  requestedLevels: Readonly<Record<string, number>>,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): CoopDefenseUpgradeProfile {
  const resolvedLevels: Record<string, number> = {};
  const unavailableUpgradeIds = getUnavailableUpgradeIds(classId);

  for (const definition of COOP_DEFENSE_UPGRADE_ORDER) {
    if (unavailableUpgradeIds.has(definition.id)) {
      resolvedLevels[definition.id] = 0;
      continue;
    }
    const requestedLevel = Math.min(
      definition.maxLevel,
      Math.max(0, requestedLevels[definition.id] ?? definition.startingLevel),
    );
    if (!areUpgradeRequirementsMet(definition, resolvedLevels)) {
      resolvedLevels[definition.id] = 0;
      continue;
    }
    resolvedLevels[definition.id] = Math.max(definition.startingLevel, requestedLevel);
  }

  if (classId === 'inspector_gadachs') {
    let capacity = getConstructionSlotCapacity(resolvedLevels);
    for (const constructionId of COOP_DEFENSE_CONSTRUCTION_IDS) {
      const unlockId = COOP_DEFENSE_CONSTRUCTIONS[constructionId].unlockUpgradeId;
      if ((resolvedLevels[unlockId] ?? 0) <= 0) continue;
      if (capacity > 0) {
        capacity -= 1;
      } else {
        resolvedLevels[unlockId] = 0;
      }
    }
  }

  const upgrades: Record<string, CoopDefenseUpgradeState> = {};
  for (const definition of COOP_DEFENSE_UPGRADE_ORDER) {
    if (unavailableUpgradeIds.has(definition.id)) {
      upgrades[definition.id] = { unlocked: false, level: 0 };
      continue;
    }
    upgrades[definition.id] = {
      unlocked: areUpgradeRequirementsMet(definition, resolvedLevels),
      level: resolvedLevels[definition.id] ?? 0,
    };
  }

  return { upgrades };
}

function sanitizeRequestedLevel(value: unknown, definition: CoopDefenseUpgradeDefinition): number {
  return Math.min(
    definition.maxLevel,
    Math.max(0, sanitizeInteger(value, definition.startingLevel)),
  );
}

function getDefaultRequestedLevels(
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): Record<string, number> {
  const unavailableUpgradeIds = getUnavailableUpgradeIds(classId);
  return Object.fromEntries(
    COOP_DEFENSE_UPGRADE_ORDER.map((definition) => [
      definition.id,
      unavailableUpgradeIds.has(definition.id) ? 0 : definition.startingLevel,
    ]),
  ) as Record<string, number>;
}

function getSanitizedProfile(
  profile: CoopDefenseUpgradeProfile,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): CoopDefenseUpgradeProfile {
  return sanitizeCoopDefenseUpgradeProfile(profile, classId);
}

export function getCoopDefenseUpgradeCategories(
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): readonly CoopDefenseUpgradeCategoryDefinition[] {
  return COOP_DEFENSE_UPGRADE_CATEGORIES.map((category) => ({
    ...category,
    description: classId === 'inspector_gadachs' && category.id === 'weapon2'
      ? 'Konstruktionen des Inspector Gadachs.'
      : category.description,
    upgrades: category.upgrades.filter((definition) => (
      isCoopDefenseUpgradeAvailableForClass(definition.id, classId)
    )),
  }));
}

export function getCoopDefenseUpgradeDefinitionsForCategory(
  categoryId: CoopDefenseUpgradeCategoryId,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): readonly CoopDefenseUpgradeDefinition[] {
  return (COOP_DEFENSE_UPGRADES_BY_CATEGORY.get(categoryId) ?? []).filter((definition) => (
    isCoopDefenseUpgradeAvailableForClass(definition.id, classId)
  ));
}

export function getCoopDefenseUpgradeDefinition(upgradeId: string): CoopDefenseUpgradeDefinition | null {
  return COOP_DEFENSE_UPGRADE_DEFINITIONS[upgradeId] ?? null;
}

/** Finds the loadout item an upgrade belongs to, including upgrades below its unlock node. */
export function getCoopDefenseUpgradeLoadoutSelection(
  upgradeId: string,
): CoopDefenseUpgradeLoadoutSelection | null {
  const visited = new Set<string>();

  const resolve = (currentUpgradeId: string): CoopDefenseUpgradeLoadoutSelection | null => {
    if (visited.has(currentUpgradeId)) return null;
    visited.add(currentUpgradeId);

    const definition = getCoopDefenseUpgradeDefinition(currentUpgradeId);
    if (!definition) return null;
    if (definition.loadoutUnlock) return definition.loadoutUnlock;

    for (const requirement of definition.requires) {
      const selection = resolve(requirement.upgradeId);
      if (selection) return selection;
    }
    return null;
  };

  return resolve(upgradeId);
}

export function getCoopDefenseLoadoutUnlockUpgradeId(slot: LoadoutSlot, itemId: string): string | null {
  return COOP_DEFENSE_LOADOUT_UNLOCKS.get(getLoadoutUnlockKey(slot, itemId)) ?? null;
}

export function isCoopDefenseLoadoutItemUnlocked(
  profile: CoopDefenseUpgradeProfile,
  slot: LoadoutSlot,
  itemId: string,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): boolean {
  const upgradeId = getCoopDefenseLoadoutUnlockUpgradeId(slot, itemId);
  if (!upgradeId) return false;

  return getCoopDefenseUpgradeState(profile, upgradeId, classId).level > 0;
}

// Strikt: ein Item ist im Defense-Mode nur auswählbar, wenn seine loadoutUnlock-Freischaltung erfüllt ist.
export function isCoopDefenseLoadoutItemSelectable(
  profile: CoopDefenseUpgradeProfile,
  slot: LoadoutSlot,
  itemId: string,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): boolean {
  return isCoopDefenseLoadoutItemUnlocked(profile, slot, itemId, classId);
}

export function getCoopDefenseResolvedEffectTotals(
  profile: CoopDefenseUpgradeProfile,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): CoopDefenseResolvedEffectTotals {
  const safeProfile = getSanitizedProfile(profile, classId);
  const additive: Record<string, number> = {};
  const percentage: Record<string, number> = {};

  for (const definition of COOP_DEFENSE_UPGRADE_ORDER) {
    const level = getResolvedUpgradeLevel(safeProfile, definition.id);
    if (level <= 0) continue;

    for (const effect of definition.effects) {
      if (effect.mode === 'add_per_level') {
        additive[effect.stat] = (additive[effect.stat] ?? 0) + effect.value * level;
        continue;
      }
      if (effect.mode === 'add_percent_per_level') {
        percentage[effect.stat] = (percentage[effect.stat] ?? 0) + effect.value * level;
      }
    }
  }

  return {
    additive: Object.freeze(additive),
    percentage: Object.freeze(percentage),
  };
}

export function getCoopDefenseNumericStatTotals(
  profile: CoopDefenseUpgradeProfile,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): Readonly<Record<string, number>> {
  return getCoopDefenseResolvedEffectTotals(profile, classId).additive;
}

export function buildDefaultCoopDefenseUpgradeProfile(
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): CoopDefenseUpgradeProfile {
  return buildProfileFromRequestedLevels(getDefaultRequestedLevels(classId), classId);
}

export function cloneCoopDefenseUpgradeProfile(
  profile: CoopDefenseUpgradeProfile,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): CoopDefenseUpgradeProfile {
  const safeProfile = getSanitizedProfile(profile, classId);
  const upgrades: Record<string, CoopDefenseUpgradeState> = {};
  for (const [upgradeId, state] of Object.entries(safeProfile.upgrades)) {
    upgrades[upgradeId] = cloneUpgradeState(state);
  }
  return { upgrades };
}

export function isCoopDefenseUpgradeProfileEqual(
  left: CoopDefenseUpgradeProfile | null | undefined,
  right: CoopDefenseUpgradeProfile | null | undefined,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;

  const normalizedLeft = sanitizeCoopDefenseUpgradeProfile(left, classId);
  const normalizedRight = sanitizeCoopDefenseUpgradeProfile(right, classId);

  for (const definition of COOP_DEFENSE_UPGRADE_ORDER) {
    const leftState = normalizedLeft.upgrades[definition.id];
    const rightState = normalizedRight.upgrades[definition.id];
    if (!leftState || !rightState) return false;
    if (leftState.unlocked !== rightState.unlocked || leftState.level !== rightState.level) {
      return false;
    }
  }

  return true;
}

/**
 * Memo fuer {@link sanitizeCoopDefenseUpgradeProfile}.
 *
 * Die Funktion ist rein, laeuft aber ueber alle Upgrade-Definitionen und war in Messungen der
 * teuerste Einzelposten im Client-Frame – sie haengt an mehreren Pfaden, die pro Frame
 * mehrfach durchlaufen werden. Der Schluessel ist die Objektreferenz der Eingabe; eine
 * `WeakMap` haelt dabei nichts am Leben.
 *
 * Vertrag: Das zurueckgegebene Profil wird zwischen Aufrufern **geteilt** und darf deshalb
 * nicht veraendert werden. Alle Profil-Operationen hier bauen bereits neue Objekte
 * (siehe `buildProfileFromRequestedLevels`); wer das aufweicht, muss den Memo entfernen.
 */
const sanitizedProfileMemo = new WeakMap<object, Map<CoopDefenseClassId, CoopDefenseUpgradeProfile>>();

export function sanitizeCoopDefenseUpgradeProfile(
  raw: unknown,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): CoopDefenseUpgradeProfile {
  const memoKey = raw && typeof raw === 'object' ? (raw as object) : null;
  if (memoKey) {
    const cached = sanitizedProfileMemo.get(memoKey)?.get(classId);
    if (cached) return cached;
  }
  const result = buildSanitizedCoopDefenseUpgradeProfile(raw, classId);
  if (memoKey) {
    const byClass = sanitizedProfileMemo.get(memoKey) ?? new Map();
    byClass.set(classId, result);
    sanitizedProfileMemo.set(memoKey, byClass);
  }
  return result;
}

function buildSanitizedCoopDefenseUpgradeProfile(
  raw: unknown,
  classId: CoopDefenseClassId,
): CoopDefenseUpgradeProfile {
  const requestedLevels = getDefaultRequestedLevels(classId);
  const input = raw && typeof raw === 'object' && 'upgrades' in raw
    ? (raw as { upgrades?: unknown }).upgrades
    : undefined;

  if (input && typeof input === 'object') {
    for (const [upgradeId, value] of Object.entries(input)) {
      const definition = getCoopDefenseUpgradeDefinition(upgradeId);
      if (!definition || !value || typeof value !== 'object') continue;
      requestedLevels[upgradeId] = sanitizeRequestedLevel((value as { level?: unknown }).level, definition);
    }
  }

  return buildProfileFromRequestedLevels(requestedLevels, classId);
}

/** Removes boss-priced levels that are not backed by earned unique boss-map completions. */
export function constrainCoopDefenseUpgradeProfileToBossPoints(
  profile: CoopDefenseUpgradeProfile,
  earnedBossPoints: number,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): CoopDefenseUpgradeProfile {
  const safeProfile = sanitizeCoopDefenseUpgradeProfile(profile, classId);
  let remainingBossPoints = Math.max(0, Math.floor(earnedBossPoints));
  const requestedLevels: Record<string, number> = {};

  for (const definition of COOP_DEFENSE_UPGRADE_ORDER) {
    const currentLevel = getResolvedUpgradeLevel(safeProfile, definition.id);
    if (definition.bossPointCostPerLevel <= 0) {
      requestedLevels[definition.id] = currentLevel;
      continue;
    }

    const paidLevels = Math.max(0, currentLevel - definition.startingLevel);
    const affordablePaidLevels = Math.min(
      paidLevels,
      Math.floor(remainingBossPoints / definition.bossPointCostPerLevel),
    );
    requestedLevels[definition.id] = definition.startingLevel + affordablePaidLevels;
    remainingBossPoints -= affordablePaidLevels * definition.bossPointCostPerLevel;
  }

  return buildProfileFromRequestedLevels(requestedLevels, classId);
}

export function getCoopDefenseUpgradeState(
  profile: CoopDefenseUpgradeProfile,
  upgradeId: string,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): CoopDefenseUpgradeState {
  const safeProfile = getSanitizedProfile(profile, classId);
  const stored = safeProfile.upgrades[upgradeId];
  if (!stored) {
    return { unlocked: false, level: 0 };
  }
  return cloneUpgradeState(stored);
}

export function getSpentCoopDefenseUpgradePoints(
  profile: CoopDefenseUpgradeProfile,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): number {
  const safeProfile = getSanitizedProfile(profile, classId);
  let spentPoints = 0;

  for (const definition of COOP_DEFENSE_UPGRADE_ORDER) {
    const currentLevel = getResolvedUpgradeLevel(safeProfile, definition.id);
    const paidLevels = Math.max(0, currentLevel - definition.startingLevel);
    spentPoints += paidLevels * definition.costPerLevel;
  }

  return spentPoints;
}

export function getAvailableCoopDefenseUpgradePoints(
  playerLevel: number,
  profile: CoopDefenseUpgradeProfile,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): number {
  const earnedPoints = Math.max(0, Math.floor(playerLevel) - 1);
  return Math.max(0, earnedPoints - getSpentCoopDefenseUpgradePoints(profile, classId));
}

export function getSpentCoopDefenseBossPoints(
  profile: CoopDefenseUpgradeProfile,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): number {
  const safeProfile = getSanitizedProfile(profile, classId);
  let spentPoints = 0;

  for (const definition of COOP_DEFENSE_UPGRADE_ORDER) {
    const currentLevel = getResolvedUpgradeLevel(safeProfile, definition.id);
    const paidLevels = Math.max(0, currentLevel - definition.startingLevel);
    spentPoints += paidLevels * definition.bossPointCostPerLevel;
  }

  return spentPoints;
}

export function getAvailableCoopDefenseBossPoints(
  earnedBossPoints: number,
  profile: CoopDefenseUpgradeProfile,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): number {
  return Math.max(0, Math.floor(earnedBossPoints) - getSpentCoopDefenseBossPoints(profile, classId));
}

export function getCoopDefenseBlockingDependentUpgradeIds(
  profile: CoopDefenseUpgradeProfile,
  upgradeId: string,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): readonly string[] {
  const safeProfile = getSanitizedProfile(profile, classId);
  const state = safeProfile.upgrades[upgradeId];
  if (!state) return [];

  const nextLevel = Math.max(0, state.level - 1);
  const dependents = COOP_DEFENSE_UPGRADE_DEPENDENTS.get(upgradeId) ?? [];
  return dependents.filter((dependentId) => {
    const dependentState = safeProfile.upgrades[dependentId];
    if (!dependentState || dependentState.level <= 0) return false;

    const dependentDefinition = getCoopDefenseUpgradeDefinition(dependentId);
    if (!dependentDefinition) return false;

    return dependentDefinition.requires.some((requirement) => (
      requirement.upgradeId === upgradeId && nextLevel < requirement.minLevel
    ));
  });
}

export function canLevelUpCoopDefenseUpgrade(
  profile: CoopDefenseUpgradeProfile,
  upgradeId: string,
  playerLevel: number,
  earnedBossPoints = 0,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): boolean {
  const safeProfile = getSanitizedProfile(profile, classId);
  const definition = getCoopDefenseUpgradeDefinition(upgradeId);
  if (!definition || !isCoopDefenseUpgradeAvailableForClass(upgradeId, classId)) return false;

  const state = safeProfile.upgrades[upgradeId];
  if (!state || !state.unlocked || state.level >= definition.maxLevel) return false;

  if (
    classId === 'inspector_gadachs'
    && COOP_DEFENSE_CONSTRUCTION_IDS.some((constructionId) => (
      COOP_DEFENSE_CONSTRUCTIONS[constructionId].unlockUpgradeId === upgradeId
    ))
    && getUnlockedConstructionCount(
      Object.fromEntries(Object.entries(safeProfile.upgrades).map(([id, value]) => [id, value.level])),
    ) >= getConstructionSlotCapacity(
      Object.fromEntries(Object.entries(safeProfile.upgrades).map(([id, value]) => [id, value.level])),
    )
  ) {
    return false;
  }

  return getAvailableCoopDefenseUpgradePoints(playerLevel, safeProfile, classId) >= definition.costPerLevel
    && getAvailableCoopDefenseBossPoints(earnedBossPoints, safeProfile, classId) >= definition.bossPointCostPerLevel;
}

export function levelUpCoopDefenseUpgrade(
  profile: CoopDefenseUpgradeProfile,
  upgradeId: string,
  playerLevel: number,
  earnedBossPoints = 0,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): CoopDefenseUpgradeProfile | null {
  const safeProfile = getSanitizedProfile(profile, classId);
  if (!canLevelUpCoopDefenseUpgrade(safeProfile, upgradeId, playerLevel, earnedBossPoints, classId)) {
    return null;
  }

  const definition = getCoopDefenseUpgradeDefinition(upgradeId);
  if (!definition) return null;

  const nextRequestedLevels = Object.fromEntries(
    COOP_DEFENSE_UPGRADE_ORDER.map((entry) => [entry.id, getResolvedUpgradeLevel(safeProfile, entry.id)]),
  ) as Record<string, number>;
  nextRequestedLevels[upgradeId] = Math.min(definition.maxLevel, nextRequestedLevels[upgradeId] + 1);
  return buildProfileFromRequestedLevels(nextRequestedLevels, classId);
}

export function canLevelDownCoopDefenseUpgrade(
  profile: CoopDefenseUpgradeProfile,
  upgradeId: string,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): boolean {
  const safeProfile = getSanitizedProfile(profile, classId);
  const definition = getCoopDefenseUpgradeDefinition(upgradeId);
  if (!definition || !definition.refundable) return false;

  const state = safeProfile.upgrades[upgradeId];
  if (!state || state.level <= definition.startingLevel) return false;

  if (getCoopDefenseBlockingDependentUpgradeIds(safeProfile, upgradeId, classId).length > 0) return false;

  if (classId === 'inspector_gadachs' && upgradeId === COOP_DEFENSE_CONSTRUCTION_SLOT_UPGRADE_ID) {
    const levels = Object.fromEntries(
      Object.entries(safeProfile.upgrades).map(([id, value]) => [id, value.level]),
    ) as Record<string, number>;
    levels[upgradeId] = Math.max(0, levels[upgradeId] - 1);
    if (getUnlockedConstructionCount(levels) > getConstructionSlotCapacity(levels)) return false;
  }

  return true;
}

export function levelDownCoopDefenseUpgrade(
  profile: CoopDefenseUpgradeProfile,
  upgradeId: string,
  classId: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): CoopDefenseUpgradeProfile | null {
  const safeProfile = getSanitizedProfile(profile, classId);
  if (!canLevelDownCoopDefenseUpgrade(safeProfile, upgradeId, classId)) {
    return null;
  }

  const nextRequestedLevels = Object.fromEntries(
    COOP_DEFENSE_UPGRADE_ORDER.map((entry) => [entry.id, getResolvedUpgradeLevel(safeProfile, entry.id)]),
  ) as Record<string, number>;
  nextRequestedLevels[upgradeId] = Math.max(0, nextRequestedLevels[upgradeId] - 1);
  return buildProfileFromRequestedLevels(nextRequestedLevels, classId);
}

export function getCoopDefenseConstructionSlotCapacity(
  profile: CoopDefenseUpgradeProfile,
): number {
  const safeProfile = sanitizeCoopDefenseUpgradeProfile(profile, 'inspector_gadachs');
  const levels = Object.fromEntries(
    Object.entries(safeProfile.upgrades).map(([id, value]) => [id, value.level]),
  ) as Record<string, number>;
  return getConstructionSlotCapacity(levels);
}

export function getUnlockedCoopDefenseConstructionIds(
  profile: CoopDefenseUpgradeProfile,
): readonly ConstructionId[] {
  const safeProfile = sanitizeCoopDefenseUpgradeProfile(profile, 'inspector_gadachs');
  return COOP_DEFENSE_CONSTRUCTION_IDS.filter((constructionId) => (
    (safeProfile.upgrades[COOP_DEFENSE_CONSTRUCTIONS[constructionId].unlockUpgradeId]?.level ?? 0) > 0
  ));
}

function normalizeUpgradeRegistry(registry: CoopDefenseUpgradeRegistryFile): NormalizedCoopDefenseUpgradeRegistry {
  if (!Array.isArray(registry.categories)) {
    throw new Error('[coopDefenseUpgrades] categories must be an array');
  }

  const categories = registry.categories.map((category, index) => normalizeCategoryDefinition(category, index));
  const categoryIds = new Set<CoopDefenseUpgradeCategoryId>();
  const upgrades: CoopDefenseUpgradeDefinition[] = [];

  for (const category of categories) {
    if (categoryIds.has(category.id)) {
      throw new Error(`[coopDefenseUpgrades] Duplicate category id: ${category.id}`);
    }
    categoryIds.add(category.id);
    upgrades.push(...category.upgrades);
  }

  for (const categoryId of CATEGORY_IDS) {
    if (!categoryIds.has(categoryId)) {
      throw new Error(`[coopDefenseUpgrades] Missing category: ${categoryId}`);
    }
  }

  validateUniqueUpgradeIds(upgrades);
  validateUpgradeDefinitions(upgrades);

  return {
    categories,
    upgrades,
  };
}

function normalizeCategoryDefinition(
  rawCategory: RawCoopDefenseUpgradeCategoryDefinition,
  index: number,
): CoopDefenseUpgradeCategoryDefinition {
  const id = requireCategoryId(rawCategory.id, '[coopDefenseUpgrades] Category id is missing or invalid');
  const label = requireString(rawCategory.label, `[coopDefenseUpgrades] Missing label for category ${id}`);
  const description = requireString(
    rawCategory.description,
    `[coopDefenseUpgrades] Missing description for category ${id}`,
  );
  const sortOrder = sanitizeInteger(rawCategory.sortOrder, index, 0);
  const rawUpgrades = Array.isArray(rawCategory.upgrades) ? rawCategory.upgrades : [];

  return {
    id,
    label,
    description,
    sortOrder,
    upgrades: rawUpgrades.map((upgrade, upgradeIndex) => (
      normalizeUpgradeDefinition(upgrade as RawCoopDefenseUpgradeDefinition, id, upgradeIndex)
    )),
  };
}

function requireCategoryId(value: unknown, errorMessage: string): CoopDefenseUpgradeCategoryId {
  const id = sanitizeOptionalString(value);
  if (!id || !CATEGORY_IDS.includes(id as CoopDefenseUpgradeCategoryId)) {
    throw new Error(errorMessage);
  }
  return id as CoopDefenseUpgradeCategoryId;
}

function normalizeUpgradeDefinition(
  rawDefinition: RawCoopDefenseUpgradeDefinition,
  categoryId: CoopDefenseUpgradeCategoryId,
  index: number,
): CoopDefenseUpgradeDefinition {
  const id = requireString(rawDefinition.id, `[coopDefenseUpgrades] Missing upgrade id in category ${categoryId}`);
  const label = requireString(rawDefinition.label, `[coopDefenseUpgrades] Missing label for upgrade ${id}`);
  const description = requireString(rawDefinition.description, `[coopDefenseUpgrades] Missing description for upgrade ${id}`);
  const kind = rawDefinition.kind === 'unlock' ? 'unlock' : 'upgrade';
  const maxLevel = Math.max(1, sanitizeInteger(rawDefinition.maxLevel, 1, 1));
  const startingLevel = Math.min(maxLevel, sanitizeInteger(rawDefinition.startingLevel, 0, 0));
  const costPerLevel = sanitizeInteger(rawDefinition.costPerLevel, kind === 'unlock' && startingLevel > 0 ? 0 : 1, 0);
  const bossPointCostPerLevel = sanitizeInteger(rawDefinition.bossPointCostPerLevel, 0, 0);
  const refundable = sanitizeBoolean(rawDefinition.refundable, true);
  const sortOrder = sanitizeInteger(rawDefinition.sortOrder, index, 0);
  const requires = normalizeUpgradeRequirements(rawDefinition.requires, id);
  const effects = normalizeUpgradeEffects(rawDefinition.effects, id);
  const loadoutUnlock = normalizeLoadoutUnlock(rawDefinition.loadoutUnlock, id);

  return {
    id,
    code: sanitizeOptionalString(rawDefinition.code),
    label,
    description,
    categoryId,
    kind,
    maxLevel,
    startingLevel,
    costPerLevel,
    bossPointCostPerLevel,
    refundable,
    sortOrder,
    requires,
    effects,
    loadoutUnlock: loadoutUnlock ?? undefined,
  };
}

function normalizeUpgradeRequirements(
  rawRequirements: readonly unknown[] | undefined,
  upgradeId: string,
): readonly CoopDefenseUpgradeRequirementDefinition[] {
  if (!Array.isArray(rawRequirements)) return [];

  return rawRequirements.map((requirement, index) => {
    if (!requirement || typeof requirement !== 'object') {
      throw new Error(`[coopDefenseUpgrades] Invalid requirement ${index} on upgrade ${upgradeId}`);
    }

    return {
      upgradeId: requireString(
        (requirement as { upgradeId?: unknown }).upgradeId,
        `[coopDefenseUpgrades] Missing requirement upgradeId on ${upgradeId}`,
      ),
      minLevel: Math.max(1, sanitizeInteger((requirement as { minLevel?: unknown }).minLevel, 1, 1)),
    } satisfies CoopDefenseUpgradeRequirementDefinition;
  });
}

function normalizeUpgradeEffects(
  rawEffects: readonly unknown[] | undefined,
  upgradeId: string,
): readonly CoopDefenseUpgradeEffectDefinition[] {
  if (!Array.isArray(rawEffects)) return [];

  return rawEffects.map((effect, index) => {
    if (!effect || typeof effect !== 'object') {
      throw new Error(`[coopDefenseUpgrades] Invalid effect ${index} on upgrade ${upgradeId}`);
    }

    const stat = requireString(
      (effect as { stat?: unknown }).stat,
      `[coopDefenseUpgrades] Missing effect stat on upgrade ${upgradeId}`,
    );
    const mode = (effect as { mode?: unknown }).mode;
    if (mode !== 'add_per_level' && mode !== 'add_percent_per_level') {
      throw new Error(`[coopDefenseUpgrades] Invalid effect mode on upgrade ${upgradeId}: ${String(mode)}`);
    }

    return {
      stat,
      mode,
      value: sanitizeEffectValue((effect as { value?: unknown }).value),
    } satisfies CoopDefenseUpgradeEffectDefinition;
  });
}

function normalizeLoadoutUnlock(
  rawLoadoutUnlock: unknown,
  upgradeId: string,
): CoopDefenseLoadoutUnlockDefinition | null {
  if (!rawLoadoutUnlock) return null;
  if (typeof rawLoadoutUnlock !== 'object') {
    throw new Error(`[coopDefenseUpgrades] Invalid loadoutUnlock on upgrade ${upgradeId}`);
  }

  const slot = (rawLoadoutUnlock as { slot?: unknown }).slot;
  if (slot !== 'weapon1' && slot !== 'weapon2' && slot !== 'utility' && slot !== 'ultimate') {
    throw new Error(`[coopDefenseUpgrades] Invalid loadoutUnlock.slot on upgrade ${upgradeId}: ${String(slot)}`);
  }

  return {
    slot,
    itemId: requireString(
      (rawLoadoutUnlock as { itemId?: unknown }).itemId,
      `[coopDefenseUpgrades] Missing loadoutUnlock.itemId on upgrade ${upgradeId}`,
    ),
  } satisfies CoopDefenseLoadoutUnlockDefinition;
}

function validateUniqueUpgradeIds(upgrades: readonly CoopDefenseUpgradeDefinition[]): void {
  const uniqueUpgradeIds = new Set<string>();

  for (const definition of upgrades) {
    if (uniqueUpgradeIds.has(definition.id)) {
      throw new Error(`[coopDefenseUpgrades] Duplicate upgrade id: ${definition.id}`);
    }
    uniqueUpgradeIds.add(definition.id);
  }
}

function validateUpgradeDefinitions(upgrades: readonly CoopDefenseUpgradeDefinition[]): void {
  const upgradesById = new Map(upgrades.map((definition) => [definition.id, definition]));

  for (const definition of upgrades) {
    if (definition.startingLevel > 0 && definition.requires.length > 0) {
      throw new Error(`[coopDefenseUpgrades] Upgrade ${definition.id} cannot have startingLevel > 0 and prerequisites`);
    }
    if (definition.kind === 'unlock' && definition.maxLevel !== 1) {
      throw new Error(`[coopDefenseUpgrades] Unlock ${definition.id} must use maxLevel = 1`);
    }

    for (const requirement of definition.requires) {
      if (requirement.upgradeId === definition.id) {
        throw new Error(`[coopDefenseUpgrades] Upgrade ${definition.id} cannot depend on itself`);
      }
      const dependencyDefinition = upgradesById.get(requirement.upgradeId);
      if (!dependencyDefinition) {
        throw new Error(`[coopDefenseUpgrades] Upgrade ${definition.id} references unknown prerequisite ${requirement.upgradeId}`);
      }
      if (requirement.minLevel > dependencyDefinition.maxLevel) {
        throw new Error(
          `[coopDefenseUpgrades] Upgrade ${definition.id} requires level ${requirement.minLevel} of ${requirement.upgradeId}, but maxLevel is ${dependencyDefinition.maxLevel}`,
        );
      }
    }

    if (definition.loadoutUnlock) {
      validateLoadoutUnlockDefinition(definition);
    }
  }

  buildTopologicalUpgradeOrder(upgrades);
}

function validateLoadoutUnlockDefinition(definition: CoopDefenseUpgradeDefinition): void {
  const loadoutUnlock = definition.loadoutUnlock;
  if (!loadoutUnlock) return;

  if (definition.categoryId !== loadoutUnlock.slot) {
    throw new Error(
      `[coopDefenseUpgrades] Upgrade ${definition.id} is in category ${definition.categoryId} but unlocks slot ${loadoutUnlock.slot}`,
    );
  }

  switch (loadoutUnlock.slot) {
    case 'weapon1':
    case 'weapon2': {
      const weapon = WEAPON_CONFIGS[loadoutUnlock.itemId as keyof typeof WEAPON_CONFIGS];
      if (!weapon || !(weapon.allowedSlots as readonly string[]).includes(loadoutUnlock.slot)) {
        throw new Error(
          `[coopDefenseUpgrades] Upgrade ${definition.id} references invalid ${loadoutUnlock.slot} unlock ${loadoutUnlock.itemId}`,
        );
      }
      return;
    }
    case 'utility': {
      const utility = UTILITY_CONFIGS[loadoutUnlock.itemId as keyof typeof UTILITY_CONFIGS];
      if (!utility || !(utility.allowedSlots as readonly string[]).includes('utility')) {
        throw new Error(
          `[coopDefenseUpgrades] Upgrade ${definition.id} references invalid utility unlock ${loadoutUnlock.itemId}`,
        );
      }
      return;
    }
    case 'ultimate': {
      const ultimate = ULTIMATE_CONFIGS[loadoutUnlock.itemId as keyof typeof ULTIMATE_CONFIGS];
      if (!ultimate || !isUltimateAllowedInMode(ultimate, COOP_DEFENSE_MODE)) {
        throw new Error(
          `[coopDefenseUpgrades] Upgrade ${definition.id} references invalid coop-defense ultimate unlock ${loadoutUnlock.itemId}`,
        );
      }
      return;
    }
  }
}

function buildTopologicalUpgradeOrder(
  upgrades: readonly CoopDefenseUpgradeDefinition[],
): readonly CoopDefenseUpgradeDefinition[] {
  const upgradesById = new Map(upgrades.map((definition) => [definition.id, definition]));
  const visited = new Set<string>();
  const active = new Set<string>();
  const result: CoopDefenseUpgradeDefinition[] = [];

  const visit = (definition: CoopDefenseUpgradeDefinition): void => {
    if (visited.has(definition.id)) return;
    if (active.has(definition.id)) {
      throw new Error(`[coopDefenseUpgrades] Circular prerequisite chain detected at ${definition.id}`);
    }

    active.add(definition.id);
    for (const requirement of definition.requires) {
      const dependency = upgradesById.get(requirement.upgradeId);
      if (!dependency) {
        throw new Error(`[coopDefenseUpgrades] Unknown prerequisite ${requirement.upgradeId} on ${definition.id}`);
      }
      visit(dependency);
    }
    active.delete(definition.id);
    visited.add(definition.id);
    result.push(definition);
  };

  const sorted = [...upgrades].sort((left, right) => {
    if (left.categoryId !== right.categoryId) {
      return CATEGORY_IDS.indexOf(left.categoryId) - CATEGORY_IDS.indexOf(right.categoryId);
    }
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.label.localeCompare(right.label);
  });

  for (const definition of sorted) {
    visit(definition);
  }

  return result;
}

function buildDependentMap(
  upgrades: readonly CoopDefenseUpgradeDefinition[],
): ReadonlyMap<string, readonly string[]> {
  const dependents = new Map<string, string[]>();

  for (const definition of upgrades) {
    for (const requirement of definition.requires) {
      const bucket = dependents.get(requirement.upgradeId) ?? [];
      bucket.push(definition.id);
      dependents.set(requirement.upgradeId, bucket);
    }
  }

  return dependents;
}
