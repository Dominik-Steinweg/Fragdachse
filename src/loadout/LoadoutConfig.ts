import { RAGE_MAX } from '../config';
import type { LoadoutSlot } from '../types';

// ── Item-Konfigurationstypen ──────────────────────────────────────────────────

export interface WeaponConfig {
  readonly id: string;
  readonly cooldown: number;            // ms zwischen zwei Schüssen
  readonly damage: number;              // HP-Schaden pro Direkttreffer
  readonly projectileSpeed: number;     // px/s
  readonly projectileSize: number;      // px (quadratisch)
  readonly range: number;               // px – Lifetime = range/speed*1000 ms
  readonly projectileMaxBounces: number;
  readonly projectileColor: number;     // hex

  readonly allowedSlots: readonly LoadoutSlot[]; // Slots, in die diese Waffe eingesetzt werden darf

  // Ressourcen
  readonly adrenalinCost: number;       // Adrenalin-Kosten pro Schuss
  readonly adrenalinGain: number;       // Adrenalin-Gewinn bei Treffer

  // Spread (Bloom) in Grad
  readonly spreadStanding: number;      // Basis-Spread im Stand
  readonly spreadMoving: number;        // Basis-Spread in Bewegung
  readonly spreadPerShot: number;       // Bloom-Zunahme pro Schuss
  readonly maxDynamicSpread: number;    // Obergrenze des dynamischen Spreads

  // Spread-Recovery
  readonly spreadRecoveryDelay: number; // ms Wartezeit nach letztem Schuss vor Abbau
  readonly spreadRecoveryRate: number;  // Grad-Abbau pro Tick
  readonly spreadRecoverySpeed: number; // ms pro Tick (bestimmt Abbau-Geschwindigkeit)
}

export interface UtilityConfig {
  readonly id: string;
  readonly cooldown: number;        // ms
  readonly projectileSpeed: number; // px/s (langsam für Granaten)
  readonly projectileSize: number;  // px
  readonly projectileColor: number; // hex
  readonly fuseTime: number;        // ms bis Explosion
  readonly aoeRadius: number;       // px
  readonly aoeDamage: number;       // HP-Schaden im Radius
}

export interface UltimateConfig {
  readonly id: string;
  readonly cooldown: number;          // ms (0 = rage-gated, kein Zeitcooldown)
  readonly rageRequired: number;      // Rage-Wert zum Aktivieren (= RAGE_MAX)
  readonly duration: number;          // ms wie lange der Effekt anhält
  readonly speedMultiplier: number;   // z.B. 1.3 = 30% schneller
  readonly damageMultiplier: number;  // z.B. 2.0 = doppelter Schaden
  readonly rageDrainDuration: number; // ms über die Rage von max→0 sinkt
}

// ── Item-Registrierung ────────────────────────────────────────────────────────

export const WEAPON_CONFIGS = {
  /**
   * "WEAPON1" - Linke Maustaste
   */
  GLOCK: {
    id:                   'GLOCK',
    cooldown:             150,
    damage:               15,
    projectileSpeed:      700,
    projectileSize:       5,
    range:                400,        
    projectileMaxBounces: 10,
    projectileColor:      0xc09473,
    allowedSlots:         ['weapon1'],
    adrenalinCost:        0,
    adrenalinGain:        10,
    spreadStanding:       5,
    spreadMoving:         10,
    spreadPerShot:        5,
    maxDynamicSpread:     25,
    spreadRecoveryDelay:  400,
    spreadRecoveryRate:   5,
    spreadRecoverySpeed:  100,
  } as WeaponConfig,

  USP: {
    id:                   'USP',
    cooldown:             250,
    damage:               20,
    projectileSpeed:      1000,
    projectileSize:       5,
    range:                600,        
    projectileMaxBounces: 10,
    projectileColor:      0xc09473,
    allowedSlots:         ['weapon1'],
    adrenalinCost:        0,
    adrenalinGain:        10,
    spreadStanding:       0,
    spreadMoving:         20,
    spreadPerShot:        5,
    maxDynamicSpread:     25,
    spreadRecoveryDelay:  400,
    spreadRecoveryRate:   5,
    spreadRecoverySpeed:  100,
  } as WeaponConfig,




  /**
   * "WEAPON2" - Rechte Maustaste
   */

  P90: {
    id:                   'P90',
    cooldown:             80,
    damage:               10,
    projectileSpeed:      800,
    projectileSize:       3,
    range:                500,        
    projectileMaxBounces: 10,
    projectileColor:      0xaaddff,
    allowedSlots:         ['weapon2'],
    adrenalinCost:        4,
    adrenalinGain:        0,
    spreadStanding:       15,
    spreadMoving:         15,
    spreadPerShot:        2,
    maxDynamicSpread:     18,
    spreadRecoveryDelay:  400,
    spreadRecoveryRate:   3,
    spreadRecoverySpeed:  100,
  } as WeaponConfig,

  AK47: {
    id:                   'AK47',
    cooldown:             100,
    damage:               20,
    projectileSpeed:      1000,
    projectileSize:       4,
    range:                1000,        
    projectileMaxBounces: 10,
    projectileColor:      0xaaddff,
    allowedSlots:         ['weapon2'],
    adrenalinCost:        8,
    adrenalinGain:        0,
    spreadStanding:       0,
    spreadMoving:         15,
    spreadPerShot:        5,
    maxDynamicSpread:     30,
    spreadRecoveryDelay:  400,
    spreadRecoveryRate:   2,
    spreadRecoverySpeed:  100,
  } as WeaponConfig,

} as const;

export const UTILITY_CONFIGS = {
  HE_GRENADE: {
    id:              'HE_GRENADE',
    cooldown:        6000,
    projectileSpeed: 500,
    projectileSize:  10,
    projectileColor: 0x44aa22,
    fuseTime:        750,
    aoeRadius:       80,
    aoeDamage:       60,
  } as UtilityConfig,
} as const;

export const ULTIMATE_CONFIGS = {
  HONEY_BADGER_RAGE: {
    id:                 'HONEY_BADGER_RAGE',
    cooldown:           0,          // rage-gated, kein Zeitcooldown
    rageRequired:       RAGE_MAX,   // 300
    duration:           5000,
    speedMultiplier:    1.3,
    damageMultiplier:   2.0,
    rageDrainDuration:  5000,
  } as UltimateConfig,
} as const;

// ── Standard-Loadout für alle Spieler beim Spawn ──────────────────────────────

export const DEFAULT_LOADOUT = {
  weapon1:  WEAPON_CONFIGS.GLOCK,
  weapon2:  WEAPON_CONFIGS.P90,
  utility:  UTILITY_CONFIGS.HE_GRENADE,
  ultimate: ULTIMATE_CONFIGS.HONEY_BADGER_RAGE,
} as const;
