import type { CoopDefenseClassId } from '../types';

export interface CoopDefenseClassDefinition {
  readonly id: CoopDefenseClassId;
  readonly displayName: string;
  readonly role: string;
  readonly description: string;
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

/**
 * `null` schaltet die Spezialisierungen sofort frei. Spaeter kann hier die letzte
 * Map eingetragen werden, die vor der Klassenauswahl abgeschlossen sein muss.
 */
export const COOP_DEFENSE_CLASS_UNLOCK_AFTER_MAP_ID: string | null = null;

export const COOP_DEFENSE_CLASS_DEFINITIONS: Readonly<Record<CoopDefenseClassId, CoopDefenseClassDefinition>> =
  Object.freeze({
    dachs_nukem: {
      id: 'dachs_nukem',
      displayName: 'Dachs Nukem',
      role: 'Offensive',
      description: '+50% Schaden, 10% Krit-Chance, 200% Krit-Schaden und +20% Laufgeschwindigkeit.',
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
      displayName: 'Dachs of Steel',
      role: 'Tank',
      description: 'Doppelte Lebenspunkte und Ruestung, +10 HP/s und Ruestung aus eigenen Felszerstoerungen.',
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
      displayName: 'Inspector Gadachs',
      role: 'Ingenieur',
      description: 'Ersetzt Sekundaerwaffen durch dauerhafte Konstruktionen und eine Reparaturdrohne.',
      outgoingDamageMultiplier: 1,
      criticalChance: 0,
      criticalDamageMultiplier: 1,
      runSpeedMultiplier: 1,
      maxHpMultiplier: 1,
      maxArmorMultiplier: 1,
      hpRegenBonusPerSecond: 0,
      adrenalineRegenPerSecond: 0.5,
      adrenalinePerEnemyDeath: 5,
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
