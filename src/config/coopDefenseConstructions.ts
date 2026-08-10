import rawCoopDefenseConstructionCooldowns from './coopDefenseConstructions.json';
import type { ConstructionId, EnergyInjectorConstructionEffect, PlaceableKind, TurretWeaponId } from '../types';

interface RawCoopDefenseConstructionCooldownDefinition {
  readonly buildCooldownMs?: unknown;
}

interface CoopDefenseConstructionBaseDefinition {
  readonly id: ConstructionId;
  readonly displayName: string;
  readonly description: string;
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
  /** Typisierte Wirkung des Energieinjektors; Felsen/Mauern besitzen keine Definition. */
  readonly energyInjectorEffect: EnergyInjectorConstructionEffect;
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
  | CoopDefenseWeaponConstructionDefinition
  | CoopDefensePowerUpPedestalDefinition;

export const COOP_DEFENSE_CONSTRUCTION_IDS: readonly ConstructionId[] = [
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
  const safeBonus = Number.isFinite(bonus) ? bonus : 0;
  return Math.max(0, COOP_DEFENSE_CONSTRUCTION_CAPACITY + safeBonus);
}

/** Stat-Schluessel des Kapazitaetsbonus im gemeinsamen Upgrade-/Item-Bucket. */
export const COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT = 'construction.capacity';

const COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS = loadConstructionBuildCooldowns();

/** Reichweite, in der eigene Konstrukte zurueckgebaut werden koennen. */
export const COOP_DEFENSE_DISMANTLE_RANGE = 320;

/**
 * Kapazitaetskosten der platzierbaren Utilities. Bewusst hier statt in `LoadoutConfig`,
 * damit die Kapazitaetsaufloesung ohne Import der Loadout-Configs auskommt.
 */
export const COOP_DEFENSE_UTILITY_CAPACITY_COSTS: Readonly<Record<string, number>> = Object.freeze({
  FELSBAU: 1,
  FLIEGENPILZ: 15,
});

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
    rocket_turret: {
      kind: 'turret',
      id: 'rocket_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.rocket_turret,
      displayName: 'Raketenturm',
      description: 'Verschießt automatisch Raketen mit Flächenschaden.',
      weaponId: 'TURRET_ROCKET',
      iconKey: null,
      unlockUpgradeId: 'unlock_rocket_turret',
      maxHp: 250,
      targetRange: 600,
      placementRange: 320,
      muzzleOffset: 18,
      capacityCost: 30,
      color: 0xff8a3d,
      energyInjectorEffect: { type: 'damage_turret', damageMultiplier: 1.25 },
    },
    machine_gun_turret: {
      kind: 'turret',
      id: 'machine_gun_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.machine_gun_turret,
      displayName: 'Maschinengewehrturm',
      description: 'Bekämpft einzelne Ziele mit hoher Feuerrate.',
      weaponId: 'TURRET_MG',
      iconKey: null,
      unlockUpgradeId: 'unlock_machine_gun_turret',
      maxHp: 180,
      targetRange: 550,
      placementRange: 320,
      muzzleOffset: 17,
      capacityCost: 10,
      color: 0xd8b46b,
      energyInjectorEffect: { type: 'damage_turret', damageMultiplier: 1.25 },
    },
    flame_turret: {
      kind: 'turret',
      id: 'flame_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.flame_turret,
      displayName: 'Flammenwerferturm',
      description: 'Entzündet Gegner in kurzer Reichweite kontinuierlich.',
      weaponId: 'TURRET_FLAME',
      iconKey: null,
      unlockUpgradeId: 'unlock_flame_turret',
      maxHp: 220,
      targetRange: 220,
      placementRange: 320,
      muzzleOffset: 16,
      capacityCost: 20,
      color: 0xff5f28,
      energyInjectorEffect: { type: 'damage_turret', damageMultiplier: 1.25 },
    },
    tesla_turret: {
      kind: 'turret',
      id: 'tesla_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.tesla_turret,
      displayName: 'Tesla-Turm',
      description: 'Erzeugt bei nahen Gegnern eine kleine Teslakuppel mit kontinuierlichem Schaden.',
      weaponId: 'TURRET_TESLA',
      iconKey: null,
      unlockUpgradeId: 'unlock_tesla_turret',
      maxHp: 200,
      targetRange: 96,
      placementRange: 320,
      muzzleOffset: 0,
      capacityCost: 25,
      color: 0x9ae7ff,
      energyInjectorEffect: { type: 'damage_turret', damageMultiplier: 1.25 },
    },
    gravity_turret: {
      kind: 'turret',
      id: 'gravity_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.gravity_turret,
      displayName: 'Gravitationsturm',
      description: 'Erzeugt am Einschlag ein schwarzes Loch, das Gegner anzieht.',
      weaponId: 'TURRET_GRAVITY',
      iconKey: null,
      unlockUpgradeId: 'unlock_gravity_turret',
      maxHp: 200,
      targetRange: 520,
      placementRange: 320,
      muzzleOffset: 16,
      capacityCost: 25,
      color: 0xa755ff,
      energyInjectorEffect: { type: 'gravity_pull', pullStrengthMultiplier: 1.5 },
    },
    slow_bubble_turret: {
      kind: 'turret',
      id: 'slow_bubble_turret',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.slow_bubble_turret,
      displayName: 'Slow-Bubble-Turm',
      description: 'Erzeugt am Einschlag eine kleine Zeitblase, die alle Einheiten verlangsamt.',
      weaponId: 'TURRET_SLOW_BUBBLE',
      iconKey: null,
      unlockUpgradeId: 'unlock_slow_bubble_turret',
      maxHp: 180,
      targetRange: 500,
      placementRange: 320,
      muzzleOffset: 16,
      capacityCost: 20,
      color: 0x8edcff,
      energyInjectorEffect: { type: 'slow_bubble', slowStrengthMultiplier: 1.5 },
    },
    medic_pedestal: {
      kind: 'pedestal',
      id: 'medic_pedestal',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.medic_pedestal,
      displayName: 'Medic-Podest',
      description: 'Stellt regelmaessig ein Medipack bereit.',
      powerUpDefId: 'HEALTH_PACK',
      iconKey: null,
      unlockUpgradeId: 'unlock_medic_pedestal',
      maxHp: 1,
      placementRange: 320,
      capacityCost: 30,
      color: 0x52d273,
      energyInjectorEffect: { type: 'powerup_cooldown', respawnTimeMultiplier: 0.5 },
      indestructible: true,
    },
    armor_pedestal: {
      kind: 'pedestal',
      id: 'armor_pedestal',
      buildCooldownMs: COOP_DEFENSE_CONSTRUCTION_BUILD_COOLDOWNS.armor_pedestal,
      displayName: 'Armor-Podest',
      description: 'Stellt regelmaessig ein Armor-Power-up bereit.',
      powerUpDefId: 'ARMOR',
      iconKey: null,
      unlockUpgradeId: 'unlock_armor_pedestal',
      maxHp: 1,
      placementRange: 320,
      capacityCost: 25,
      color: 0x5aa9ff,
      energyInjectorEffect: { type: 'powerup_cooldown', respawnTimeMultiplier: 0.5 },
      indestructible: true,
    },
  });

export function isConstructionId(value: unknown): value is ConstructionId {
  return typeof value === 'string'
    && COOP_DEFENSE_CONSTRUCTION_IDS.includes(value as ConstructionId);
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
  rock: { readonly kind: PlaceableKind; readonly constructionId?: ConstructionId },
): number {
  if (rock.constructionId) return COOP_DEFENSE_CONSTRUCTIONS[rock.constructionId]?.capacityCost ?? 0;
  if (rock.kind === 'rock') return COOP_DEFENSE_UTILITY_CAPACITY_COSTS.FELSBAU;
  if (rock.kind === 'turret') return COOP_DEFENSE_UTILITY_CAPACITY_COSTS.FLIEGENPILZ;
  return 0;
}

/**
 * Belegte Kapazitaet eines Spielers ueber einen Bestand platzierter Objekte. Bewusst eine
 * reine Funktion: Host, Client und Tests rechnen damit identisch, ohne Phaser-Abhaengigkeit.
 */
export function sumPlaceableCapacity(
  rocks: Iterable<{ readonly ownerId: string; readonly kind: PlaceableKind; readonly constructionId?: ConstructionId }>,
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
  return tool.kind === 'construction'
    ? COOP_DEFENSE_CONSTRUCTIONS[tool.id as ConstructionId]?.capacityCost ?? 0
    : COOP_DEFENSE_UTILITY_CAPACITY_COSTS[tool.id] ?? 0;
}
