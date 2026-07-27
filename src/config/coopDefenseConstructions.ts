import type { ConstructionId, TurretWeaponId } from '../types';

export interface CoopDefenseConstructionDefinition {
  readonly id: ConstructionId;
  readonly displayName: string;
  readonly description: string;
  readonly weaponId: TurretWeaponId;
  readonly unlockUpgradeId: string;
  readonly maxHp: number;
  readonly targetRange: number;
  readonly placementRange: number;
  readonly muzzleOffset: number;
  readonly adrenalineCost: number;
  readonly color: number;
}

export const COOP_DEFENSE_CONSTRUCTION_IDS: readonly ConstructionId[] = [
  'rocket_turret',
  'machine_gun_turret',
  'flame_turret',
];

export const DEFAULT_COOP_DEFENSE_CONSTRUCTION_ID: ConstructionId = 'rocket_turret';
export const COOP_DEFENSE_CONSTRUCTION_BASE_SLOTS = 2;
export const COOP_DEFENSE_CONSTRUCTION_MAX_SLOTS = 5;
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
      description: 'Verschiesst automatisch Raketen mit Flaechenschaden.',
      weaponId: 'ROCKET_LAUNCHER',
      unlockUpgradeId: 'unlock_rocket_turret',
      maxHp: 250,
      targetRange: 600,
      placementRange: 320,
      muzzleOffset: 18,
      adrenalineCost: 30,
      color: 0xff8a3d,
    },
    machine_gun_turret: {
      id: 'machine_gun_turret',
      displayName: 'Maschinengewehrturm',
      description: 'Bekämpft einzelne Ziele mit hoher Feuerrate.',
      weaponId: 'AK47',
      unlockUpgradeId: 'unlock_machine_gun_turret',
      maxHp: 180,
      targetRange: 550,
      placementRange: 320,
      muzzleOffset: 17,
      adrenalineCost: 30,
      color: 0xd8b46b,
    },
    flame_turret: {
      id: 'flame_turret',
      displayName: 'Flammenwerferturm',
      description: 'Entzuendet Gegner in kurzer Reichweite kontinuierlich.',
      weaponId: 'FLAMETHROWER',
      unlockUpgradeId: 'unlock_flame_turret',
      maxHp: 220,
      targetRange: 220,
      placementRange: 320,
      muzzleOffset: 16,
      adrenalineCost: 30,
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
