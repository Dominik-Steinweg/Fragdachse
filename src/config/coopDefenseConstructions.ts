import rawCoopDefenseConstructionCooldowns from './coopDefenseConstructions.json';
import type { ConstructionId, ConstructionOwnership, CoopDefenseClassId, EnergyInjectorConstructionEffect, GameMode, PlaceableKind, TurretWeaponId } from '../types';

interface RawCoopDefenseConstructionCooldownDefinition {
  readonly buildCooldownMs?: unknown;
}

interface CoopDefenseConstructionBaseDefinition {
  readonly id: ConstructionId;
  readonly buildCooldownMs: number;
  /**
   * Optionales individuelles Loadout-Icon des Konstrukts. Solange es `null` ist, verwenden
   * Slot und Unlock-Knoten gemeinsam das temporaere Icon aus `unlockUpgradeId`.
   */
  readonly iconKey: string | null;
  readonly unlockUpgradeId: string;
  readonly maxHp: number;
  readonly placementRange: number;
  /** Anteil an der festen Konstruktionskapazitaet, solange das Konstrukt steht. */
  readonly capacityCost: number;
  readonly color: number;
  /** Shared footprint contract used by placement, restore and collision checks. */
  readonly footprint: readonly { readonly dx: number; readonly dy: number }[];
  /** Typisierte Wirkung des Energieinjektors; Felsen/Mauern besitzen keine Definition. */
  readonly energyInjectorEffect?: EnergyInjectorConstructionEffect;
}

export interface CoopDefenseBarrierConstructionDefinition extends CoopDefenseConstructionBaseDefinition {
  readonly kind: 'rock';
  readonly indestructible?: false;
}

export interface CoopDefenseWeaponConstructionDefinition extends CoopDefenseConstructionBaseDefinition {
  readonly kind: 'turret';
  readonly weaponId: TurretWeaponId;
  readonly targetRange: number;
  readonly muzzleOffset: number;
  readonly indestructible?: false;
}

export interface CoopDefensePowerUpPedestalDefinition extends CoopDefenseConstructionBaseDefinition {
  readonly kind: 'pedestal';
  readonly powerUpDefId: 'HEALTH_PACK' | 'ARMOR';
  readonly indestructible: true;
}

export type CoopDefenseConstructionDefinition =
  | CoopDefenseBarrierConstructionDefinition
  | CoopDefenseWeaponConstructionDefinition
  | CoopDefensePowerUpPedestalDefinition;

export const COOP_DEFENSE_CONSTRUCTION_IDS: readonly ConstructionId[] = [
  'rock_barrier',
  'spore_turret',
  'rocket_turret',
  'machine_gun_turret',
  'flame_turret',
  'tesla_turret',
  'gravity_turret',
  'slow_bubble_turret',
  'medic_pedestal',
  'armor_pedestal',
];

export const DEFAULT_COOP_DEFENSE_CONSTRUCTION_ID: ConstructionId = 'rocket_turret';

/**
 * Grundkapazitaet des Inspectors. Sie ersetzt die frueheren Adrenalinkosten als einzige
 * Obergrenze fuer gleichzeitig stehende Konstrukte und ist damit unabhaengig von Rundendauer,
 * Adrenalin, Cooldowns und Anzahl abgewehrter Angriffe.
 *
 * Ab dem Item-Affix "Baukapazitaet" ist sie nicht mehr das persoenliche Maximum – dafuer gibt
 * es {@link getCoopDefenseConstructionCapacity}.
 */
export const COOP_DEFENSE_CONSTRUCTION_CAPACITY = 100;
export const COOP_DEFENSE_NON_INSPECTOR_CONSTRUCTION_CAPACITY = 30;

/** Configured personal base capacities for every supported mode. */
export const CONSTRUCTION_CAPACITY_BY_GAME_MODE: Readonly<Record<GameMode, number>> = Object.freeze({
  deathmatch: COOP_DEFENSE_CONSTRUCTION_CAPACITY,
  team_deathmatch: COOP_DEFENSE_CONSTRUCTION_CAPACITY,
  capture_the_beer: COOP_DEFENSE_CONSTRUCTION_CAPACITY,
  coop_defense: COOP_DEFENSE_NON_INSPECTOR_CONSTRUCTION_CAPACITY,
});

export interface ConstructionCapacityResolverInput {
  readonly gameMode: GameMode;
  readonly classId: CoopDefenseClassId | null | undefined;
  /** Additive item/upgrade modifiers; malformed values are treated as zero. */
  readonly modifiers?: number | { readonly capacityBonus?: number } | null;
}

/**
 * Single capacity resolver for placement, preview, HUD, radial and restore. Capacity is personal
 * and never inferred from the number of players in the room.
 */
export function resolveConstructionCapacity(input: ConstructionCapacityResolverInput): number {
  const base = input.gameMode === 'coop_defense' && input.classId !== 'inspector_gadachs'
      ? COOP_DEFENSE_NON_INSPECTOR_CONSTRUCTION_CAPACITY
      : input.gameMode === 'coop_defense'
        ? COOP_DEFENSE_CONSTRUCTION_CAPACITY
      : CONSTRUCTION_CAPACITY_BY_GAME_MODE[input.gameMode] ?? 0;
  const rawBonus = typeof input.modifiers === 'number'
    ? input.modifiers
    : input.modifiers?.capacityBonus ?? 0;
  const bonus = Number.isFinite(rawBonus) ? rawBonus : 0;
  return Math.max(0, base + bonus);
}

/**
 * Persoenliches Kapazitaetsmaximum eines Spielers.
 *
 * Die einzige Stelle, an der Grundkapazitaet und Boni zusammenkommen: Host-Platzierungsgate,
 * Client-Vorschau, HUD und Radialmenue muessen denselben Wert sehen, sonst zeigt die Vorschau
 * Bauplaetze an, die der Host ablehnt. `bonus` ist die additive Summe aus `construction.capacity`
 * (Items, spaeter auch Upgrades); die Kapazitaetskosten der einzelnen Objekte bleiben bewusst
 * spielerunabhaengig.
 */
export function getCoopDefenseConstructionCapacity(bonus: number): number {
  return resolveConstructionCapacity({
    gameMode: 'coop_defense',
    classId: 'inspector_gadachs',
    modifiers: bonus,
  });
}

/** Stat-Schluessel des Kapazitaetsbonus im gemeinsamen Upgrade-/Item-Bucket. */
export const COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT = 'construction.capacity';

const COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS = loadConstructionBuildCooldowns();

/** Reichweite, in der eigene Konstrukte zurueckgebaut werden koennen. */
export const COOP_DEFENSE_DISMANTLE_RANGE = 320;

const SINGLE_CELL_FOOTPRINT = Object.freeze([{ dx: 0, dy: 0 }]);

export const COOP_DEFENSE_CONSTRUCTION_BASE_SLOTS = 3;
export const COOP_DEFENSE_CONSTRUCTION_MAX_SLOTS = 6;
export const COOP_DEFENSE_CONSTRUCTION_SLOT_UPGRADE_ID = 'inspector_construction_slots';
export const COOP_DEFENSE_CONSTRUCTION_HP_UPGRADE_ID = 'inspector_construction_hp';
export const COOP_DEFENSE_REPAIR_DRONE_UPGRADE_ID = 'inspector_repair_drone';
export const COOP_DEFENSE_CONSTRUCTION_HP_PER_LEVEL = 0.25;

export const COOP_DEFENSE_REPAIR_DRONE_CONFIG = Object.freeze({
  scanRadius: 400,
  repairPerSecond: 10,
  orbitRadius: 48,
  outboundSpeed: 620,
  returnSpeed: 720,
  repairDistance: 22,
});

function loadConstructionBuildCooldowns(): Readonly<Record<ConstructionId, number>> {
  const raw = rawCoopDefenseConstructionCooldowns as Record<string, RawCoopDefenseConstructionCooldownDefinition>;
  const cooldowns = {} as Record<ConstructionId, number>;

  for (const constructionId of COOP_DEFENSE_CONSTRUCTION_IDS) {
    const value = raw[constructionId]?.buildCooldownMs;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`[coopDefenseConstructions] Invalid buildCooldownMs for ${constructionId}`);
    }
    cooldowns[constructionId] = Math.floor(value);
  }

  for (const constructionId of Object.keys(raw)) {
    if (!COOP_DEFENSE_CONSTRUCTION_IDS.includes(constructionId as ConstructionId)) {
      throw new Error(`[coopDefenseConstructions] Unknown construction cooldown entry: ${constructionId}`);
    }
  }

  return Object.freeze(cooldowns);
}

export const COOP_DEFENSE_CONSTRUCTIONS: Readonly<Record<ConstructionId, CoopDefenseConstructionDefinition>> =
  Object.freeze({
    rock_barrier: {
      kind: 'rock',
      id: 'rock_barrier',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.rock_barrier,
      iconKey: null,
      unlockUpgradeId: 'unlock_rock_barrier',
      maxHp: 200,
      placementRange: 160,
      capacityCost: 1,
      color: 0x92705a,
      footprint: SINGLE_CELL_FOOTPRINT,
    },
    spore_turret: {
      kind: 'turret',
      id: 'spore_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.spore_turret,
      weaponId: 'TURRET_SPORES',
      iconKey: null,
      unlockUpgradeId: 'unlock_spore_turret',
      maxHp: 50,
      targetRange: 280,
      placementRange: 240,
      muzzleOffset: 26,
      capacityCost: 15,
      color: 0x9b65d8,
      footprint: SINGLE_CELL_FOOTPRINT,
      energyInjectorEffect: { type: 'damage_turret', damageMultiplier: 1.25 },
    },
    rocket_turret: {
      kind: 'turret',
      id: 'rocket_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.rocket_turret,
      weaponId: 'TURRET_ROCKET_BURST',
      iconKey: null,
      unlockUpgradeId: 'unlock_rocket_turret',
      maxHp: 250,
      targetRange: 600,
      placementRange: 320,
      muzzleOffset: 18,
      capacityCost: 30,
      color: 0xff8a3d,
      footprint: SINGLE_CELL_FOOTPRINT,
      energyInjectorEffect: { type: 'damage_turret', damageMultiplier: 1.25 },
    },
    machine_gun_turret: {
      kind: 'turret',
      id: 'machine_gun_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.machine_gun_turret,
      weaponId: 'TURRET_MG',
      iconKey: null,
      unlockUpgradeId: 'unlock_machine_gun_turret',
      maxHp: 180,
      targetRange: 550,
      placementRange: 320,
      muzzleOffset: 17,
      capacityCost: 10,
      color: 0xd8b46b,
      footprint: SINGLE_CELL_FOOTPRINT,
      energyInjectorEffect: { type: 'damage_turret', damageMultiplier: 1.25 },
    },
    flame_turret: {
      kind: 'turret',
      id: 'flame_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.flame_turret,
      weaponId: 'TURRET_FLAME',
      iconKey: null,
      unlockUpgradeId: 'unlock_flame_turret',
      maxHp: 220,
      targetRange: 220,
      placementRange: 320,
      muzzleOffset: 16,
      capacityCost: 20,
      color: 0xff5f28,
      footprint: SINGLE_CELL_FOOTPRINT,
      energyInjectorEffect: { type: 'damage_turret', damageMultiplier: 1.25 },
    },
    tesla_turret: {
      kind: 'turret',
      id: 'tesla_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.tesla_turret,
      weaponId: 'TURRET_TESLA',
      iconKey: null,
      unlockUpgradeId: 'unlock_tesla_turret',
      maxHp: 200,
      targetRange: 96,
      placementRange: 320,
      muzzleOffset: 0,
      capacityCost: 25,
      color: 0x9ae7ff,
      footprint: SINGLE_CELL_FOOTPRINT,
      energyInjectorEffect: { type: 'damage_turret', damageMultiplier: 1.25 },
    },
    gravity_turret: {
      kind: 'turret',
      id: 'gravity_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.gravity_turret,
      weaponId: 'TURRET_GRAVITY',
      iconKey: null,
      unlockUpgradeId: 'unlock_gravity_turret',
      maxHp: 200,
      targetRange: 520,
      placementRange: 320,
      muzzleOffset: 16,
      capacityCost: 25,
      color: 0xa755ff,
      footprint: SINGLE_CELL_FOOTPRINT,
      energyInjectorEffect: { type: 'gravity_pull', pullStrengthMultiplier: 1.5 },
    },
    slow_bubble_turret: {
      kind: 'turret',
      id: 'slow_bubble_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.slow_bubble_turret,
      weaponId: 'TURRET_SLOW_BUBBLE',
      iconKey: null,
      unlockUpgradeId: 'unlock_slow_bubble_turret',
      maxHp: 180,
      targetRange: 500,
      placementRange: 320,
      muzzleOffset: 16,
      capacityCost: 20,
      color: 0x8edcff,
      footprint: SINGLE_CELL_FOOTPRINT,
      energyInjectorEffect: { type: 'slow_bubble', slowStrengthMultiplier: 1.5 },
    },
    medic_pedestal: {
      kind: 'pedestal',
      id: 'medic_pedestal',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.medic_pedestal,
      powerUpDefId: 'HEALTH_PACK',
      iconKey: null,
      unlockUpgradeId: 'unlock_medic_pedestal',
      maxHp: 1,
      placementRange: 320,
      capacityCost: 30,
      color: 0x52d273,
      footprint: SINGLE_CELL_FOOTPRINT,
      energyInjectorEffect: { type: 'powerup_cooldown', respawnTimeMultiplier: 0.5 },
      indestructible: true,
    },
    armor_pedestal: {
      kind: 'pedestal',
      id: 'armor_pedestal',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.armor_pedestal,
      powerUpDefId: 'ARMOR',
      iconKey: null,
      unlockUpgradeId: 'unlock_armor_pedestal',
      maxHp: 1,
      placementRange: 320,
      capacityCost: 25,
      color: 0x5aa9ff,
      footprint: SINGLE_CELL_FOOTPRINT,
      energyInjectorEffect: { type: 'powerup_cooldown', respawnTimeMultiplier: 0.5 },
      indestructible: true,
    },
  });

/** @deprecated Compatibility view for presentation code; values are derived from the shared registry. */
export const COOP_DEFENSE_UTILITY_CAPACITY_COSTS: Readonly<Record<string, number>> = Object.freeze({
  ROCK_BARRIER: COOP_DEFENSE_CONSTRUCTIONS.rock_barrier.capacityCost,
  SPORE_TURRET: COOP_DEFENSE_CONSTRUCTIONS.spore_turret.capacityCost,
});

export function isConstructionId(value: unknown): value is ConstructionId {
  return typeof value === 'string'
    && COOP_DEFENSE_CONSTRUCTION_IDS.includes(value as ConstructionId);
}

/**
 * Canonical construction identity boundary. Historical utility IDs and their old Coop-only
 * lifetime variants are accepted only here; every runtime, snapshot and persistent blueprint
 * uses the returned lower-case construction ID.
 */
export function normalizeConstructionId(value: unknown): ConstructionId | null {
  if (typeof value !== 'string') return null;
  switch (value) {
    case 'rock_barrier':
    case 'ROCK_BARRIER':
    case 'ROCK_BARRIER_COOP':
      return 'rock_barrier';
    case 'spore_turret':
    case 'SPORE_TURRET':
    case 'SPORE_TURRET_COOP':
      return 'spore_turret';
    default:
      return isConstructionId(value) ? value : null;
  }
}

export function getConstructionIdForUtility(value: unknown): ConstructionId | null {
  const id = normalizeConstructionId(value);
  return id === 'rock_barrier' || id === 'spore_turret' ? id : null;
}

export function getUtilityIdForConstruction(constructionId: ConstructionId): string | null {
  if (constructionId === 'rock_barrier') return 'ROCK_BARRIER';
  if (constructionId === 'spore_turret') return 'SPORE_TURRET';
  return null;
}

export function getCoopDefenseConstructionDefinition(
  constructionId: ConstructionId,
): CoopDefenseConstructionDefinition {
  return COOP_DEFENSE_CONSTRUCTIONS[constructionId];
}

/**
 * Kapazitaetskosten eines stehenden Konstrukts. Die Kosten werden bewusst aus `kind` und
 * `constructionId` abgeleitet statt im `SyncedPlaceableRock` mitgefuehrt zu werden: Bei bis
 * zu hundert Mauern je Spieler spart das ein Feld pro Objekt im Replikationssnapshot.
 * Deshalb duerfen Kapazitaetskosten auch nicht spielerabhaengig modifiziert werden.
 */
export function getPlaceableCapacityCost(
  rock: {
    readonly kind: PlaceableKind;
    readonly constructionId?: ConstructionId | string;
    readonly ownership?: ConstructionOwnership;
    readonly toolRef?: { readonly kind: 'construction' | 'utility'; readonly id: string };
  },
): number {
  if (rock.ownership === 'base-owned') return 0;
  const constructionId = normalizeConstructionId(rock.constructionId)
    ?? normalizeConstructionId(rock.toolRef?.id);
  if (constructionId) return COOP_DEFENSE_CONSTRUCTIONS[constructionId].capacityCost;
  return 0;
}

/**
 * Belegte Kapazitaet eines Spielers ueber einen Bestand platzierter Objekte. Bewusst eine
 * reine Funktion: Host, Client und Tests rechnen damit identisch, ohne Phaser-Abhaengigkeit.
 */
export function sumPlaceableCapacity(
  rocks: Iterable<{
    readonly ownerId: string;
    readonly kind: PlaceableKind;
    readonly constructionId?: ConstructionId | string;
    readonly ownership?: ConstructionOwnership;
    readonly toolRef?: { readonly kind: 'construction' | 'utility'; readonly id: string };
  }>,
  ownerId: string,
): number {
  let used = 0;
  for (const rock of rocks) {
    if (rock.ownerId !== ownerId) continue;
    used += getPlaceableCapacityCost(rock);
  }
  return used;
}

/** Kapazitaetskosten eines noch nicht gebauten Werkzeugs aus dem Radialmenue. */
export function getToolCapacityCost(tool: { kind: 'construction' | 'utility'; id: string }): number {
  const constructionId = normalizeConstructionId(tool.id);
  return constructionId ? COOP_DEFENSE_CONSTRUCTIONS[constructionId].capacityCost : 0;
}
