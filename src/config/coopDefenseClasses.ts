import type { CoopDefenseClassId } from '../types';

export interface CoopDefenseClassDefinition {
  readonly id: CoopDefenseClassId;
  readonly displayName: string;
  readonly role: string;
  readonly description: string;
  /** Kurze Besonderheiten fuer das Mouse-over im Upgrade-Overlay. */
  readonly tooltipLines: readonly string[];
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

/** Ein Sieg auf dieser Map schaltet alle drei Spezialisierungen dauerhaft frei. */
export const COOP_DEFENSE_CLASS_UNLOCK_AFTER_MAP_ID = '5';

export const COOP_DEFENSE_CLASS_DEFINITIONS: Readonly<Record<CoopDefenseClassId, CoopDefenseClassDefinition>> =
  Object.freeze({
    dachs_nukem: {
      id: 'dachs_nukem',
      displayName: 'Dachs Nukem',
      role: 'Offensive',
      description: '+50% Schaden, 10% Krit-Chance, 200% Krit-Schaden und +20% Laufgeschwindigkeit.',
      tooltipLines: [
        'Loadout: Waffe 1, Waffe 2, Utility, Ultimate.',
        'Stärke: schnelles Töten auf Distanz und hohe Mobilität.',
      ],
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
      description: 'Doppelte Lebenspunkte und Rüstung, +10 HP/s und Rüstung aus eigenen Felszerstörungen.',
      tooltipLines: [
        'Loadout: Waffe 1, Waffe 2, Utility, Ultimate.',
        'Stärke: hält Gegnerwellen direkt an der Basis auf.',
      ],
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
      description: 'Baut dauerhafte Konstruktionen im Rahmen einer festen Baukapazität.',
      tooltipLines: [
        'Loadout: Waffe 1, Verstärkungsmatrix auf RMB, mehrere Utility-Slots, Ultimate.',
        'Konstrukte belegen Baukapazität (100 Punkte) statt Adrenalin.',
        'R hält das Utility-Rad offen, E setzt die Auswahl ein.',
        'Stärke: stellt bleibende Verteidigung auf und verstärkt sie im Ernstfall.',
      ],
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
