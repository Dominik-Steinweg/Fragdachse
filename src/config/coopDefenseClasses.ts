import type { CoopDefenseClassId } from '../types';
import { getCoopDefenseMapIdsInOrder } from './coopDefenseMapUnlocks';

export interface CoopDefenseClassDefinition {
  readonly id: CoopDefenseClassId;
  /** Map victory after which this class becomes selectable. */
  readonly unlockAfterMapId: string;
  readonly outgoingDamageMultiplier: number;
  readonly criticalChance: number;
  readonly criticalDamageMultiplier: number;
  readonly runSpeedMultiplier: number;
  readonly maxHpMultiplier: number;
  readonly maxArmorMultiplier: number;
  readonly hpRegenBonusPerSecond: number;
  readonly adrenalineRegenPerSecond?: number;
  readonly adrenalinePerEnemyDeath?: number;
  readonly excludedGeneralUpgradeIds: readonly string[];
}

export const COOP_DEFENSE_CLASS_IDS: readonly CoopDefenseClassId[] = [
  'dachs_nukem',
  'dachs_of_steel',
  'inspector_gadachs',
];

export const DEFAULT_COOP_DEFENSE_CLASS_ID: CoopDefenseClassId = 'dachs_nukem';

/** Legacy alias retained for older callers; class-specific definitions remain authoritative. */
export const COOP_DEFENSE_CLASS_UNLOCK_AFTER_MAP_ID = '5';

export const COOP_DEFENSE_CLASS_DEFINITIONS: Readonly<Record<CoopDefenseClassId, CoopDefenseClassDefinition>> =
  Object.freeze({
    dachs_nukem: {
      id: 'dachs_nukem',
      unlockAfterMapId: '5',
      outgoingDamageMultiplier: 1.5,
      criticalChance: 0.1,
      criticalDamageMultiplier: 2,
      runSpeedMultiplier: 1.2,
      maxHpMultiplier: 1,
      maxArmorMultiplier: 1,
      hpRegenBonusPerSecond: 0,
      excludedGeneralUpgradeIds: [],
    },
    dachs_of_steel: {
      id: 'dachs_of_steel',
      unlockAfterMapId: '5',
      outgoingDamageMultiplier: 1,
      criticalChance: 0,
      criticalDamageMultiplier: 1,
      runSpeedMultiplier: 1,
      maxHpMultiplier: 2,
      maxArmorMultiplier: 2,
      hpRegenBonusPerSecond: 10,
      excludedGeneralUpgradeIds: [],
    },
    inspector_gadachs: {
      id: 'inspector_gadachs',
      unlockAfterMapId: '10',
      outgoingDamageMultiplier: 1,
      criticalChance: 0,
      criticalDamageMultiplier: 1,
      runSpeedMultiplier: 1,
      maxHpMultiplier: 1,
      maxArmorMultiplier: 1,
      hpRegenBonusPerSecond: 0,
      // Adrenalingewinn ist bewusst identisch zu den anderen Klassen: passive Regeneration
      // plus Primaerwaffentreffer. Die Klassenstaerke haengt an der Baukapazitaet, nicht an
      // einer eigenen Ressourcenkurve.
      excludedGeneralUpgradeIds: ['run_speed', 'burrow_speed'],
    },
  });

export function isCoopDefenseClassId(value: unknown): value is CoopDefenseClassId {
  return typeof value === 'string' && COOP_DEFENSE_CLASS_IDS.includes(value as CoopDefenseClassId);
}

export function sanitizeCoopDefenseClassId(
  value: unknown,
  fallback: CoopDefenseClassId = DEFAULT_COOP_DEFENSE_CLASS_ID,
): CoopDefenseClassId {
  return isCoopDefenseClassId(value) ? value : fallback;
}

export function getCoopDefenseClassDefinition(classId: CoopDefenseClassId): CoopDefenseClassDefinition {
  return COOP_DEFENSE_CLASS_DEFINITIONS[classId];
}

export function getCoopDefenseClassUnlockAfterMapId(classId: CoopDefenseClassId): string {
  return getCoopDefenseClassDefinition(classId).unlockAfterMapId;
}

export function isCoopDefenseClassUnlocked(classId: CoopDefenseClassId, highestUnlockedMapId: string): boolean {
  const mapOrder = getCoopDefenseMapIdsInOrder();
  const highestIndex = mapOrder.indexOf(highestUnlockedMapId);
  const unlockIndex = mapOrder.indexOf(getCoopDefenseClassUnlockAfterMapId(classId));
  return highestIndex >= 0 && unlockIndex >= 0 && highestIndex >= unlockIndex;
}

export function getUnlockedCoopDefenseClassIds(highestUnlockedMapId: string): readonly CoopDefenseClassId[] {
  return COOP_DEFENSE_CLASS_IDS.filter((classId) => isCoopDefenseClassUnlocked(classId, highestUnlockedMapId));
}
