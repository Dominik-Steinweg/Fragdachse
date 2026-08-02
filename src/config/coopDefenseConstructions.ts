import type { ConstructionId, PlaceableKind, TurretWeaponId } from '../types';

export interface CoopDefenseConstructionDefinition {
  readonly id: ConstructionId;
  readonly displayName: string;
  readonly description: string;
  readonly weaponId: TurretWeaponId;
  /**
   * Optionales individuelles Loadout-Icon des Konstrukts. Solange es `null` ist, verwenden
   * Slot und Unlock-Knoten gemeinsam das temporaere Icon aus `unlockUpgradeId`.
   */
  readonly iconKey: string | null;
  readonly unlockUpgradeId: string;
  readonly maxHp: number;
  readonly targetRange: number;
  readonly placementRange: number;
  readonly muzzleOffset: number;
  /** Anteil an der festen Konstruktionskapazitaet, solange das Konstrukt steht. */
  readonly capacityCost: number;
  readonly color: number;
}

export const COOP_DEFENSE_CONSTRUCTION_IDS: readonly ConstructionId[] = [
  'rocket_turret',
  'machine_gun_turret',
  'flame_turret',
];

export const DEFAULT_COOP_DEFENSE_CONSTRUCTION_ID: ConstructionId = 'rocket_turret';

/**
 * Grundkapazitaet des Inspectors. Sie ersetzt die frueheren Adrenalinkosten als einzige
 * Obergrenze fuer gleichzeitig stehende Konstrukte und ist damit unabhaengig von Rundendauer,
 * Adrenalin, Cooldowns und Anzahl abgewehrter Wellen.
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

/**
 * Einheitlicher Bau-Cooldown fuer alle Konstrukte. Begrenzend ist die Kapazitaet, nicht
 * dieser Cooldown; er verhindert lediglich, dass eine ganze Verteidigungslinie in einem
 * einzigen Frame entsteht.
 */
export const COOP_DEFENSE_BUILD_COOLDOWN_MS = 500;

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

export const COOP_DEFENSE_CONSTRUCTIONS: Readonly<Record<ConstructionId, CoopDefenseConstructionDefinition>> =
  Object.freeze({
    rocket_turret: {
      id: 'rocket_turret',
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
    },
    machine_gun_turret: {
      id: 'machine_gun_turret',
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
    },
    flame_turret: {
      id: 'flame_turret',
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
