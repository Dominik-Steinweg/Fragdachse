import { RAGE_MAX } from '../config';
import type { LoadoutSlot } from '../types';

// ── Item-Konfigurationstypen ──────────────────────────────────────────────────

export interface ProjectileWeaponFireConfig {
  readonly type: 'projectile';
  readonly projectileSpeed: number;     // px/s
  readonly projectileSize: number;      // px (quadratisch)
  readonly projectileMaxBounces: number;
}

export interface HitscanWeaponFireConfig {
  readonly type: 'hitscan';
  readonly traceThickness: number;      // px - für spätere Ray-/Sweep-Checks
}

export interface MeleeWeaponFireConfig {
  readonly type: 'melee';
  readonly hitRadius: number;           // px - Trefferkreis vor dem Spieler
  readonly hitArcDegrees: number;       // Öffnungswinkel vor dem Spieler
  readonly forwardOffset: number;       // px - Mittelpunkt des Trefferkreises vor dem Spieler
}

export type WeaponFireConfig =
  | ProjectileWeaponFireConfig
  | HitscanWeaponFireConfig
  | MeleeWeaponFireConfig;

export interface WeaponConfig {
  readonly id: string;
  readonly displayName: string;
  readonly cooldown: number;            // ms zwischen zwei Schüssen
  readonly damage: number;              // HP-Schaden pro Direkttreffer
  readonly range: number;               // px – Lifetime = range/speed*1000 ms
  readonly fire: WeaponFireConfig;

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

  // Multi-Projektil (Optional) – z.B. Shotgun
  // Sind beide Felder gesetzt und pelletCount > 1, werden alle Projektile gleichzeitig gefeuert.
  readonly pelletCount?:       number; // Anzahl gleichzeitig abgefeuerter Projektile
  readonly pelletSpreadAngle?: number; // Halbwinkel der Auffächerung in Grad ([-y, +y])
}

export type UtilityType = 'explosive' | 'smoke' | 'molotov';

interface BaseUtilityConfig {
  readonly id: string;
  readonly displayName: string;
  readonly type: UtilityType;
  readonly cooldown: number;        // ms
  readonly projectileSpeed: number; // px/s (langsam für Granaten)
  readonly projectileSize: number;  // px
  readonly fuseTime: number;        // ms bis Explosion
  readonly maxBounces: number;      // 0 = kein Abprallen, >0 = Explosion nach n Abprallern
}

export interface ExplosiveUtilityConfig extends BaseUtilityConfig {
  readonly type: 'explosive';
  readonly aoeRadius: number;       // px
  readonly aoeDamage: number;       // HP-Schaden im Radius
}

export interface SmokeUtilityConfig extends BaseUtilityConfig {
  readonly type: 'smoke';
  readonly smokeRadius: number;             // px
  readonly smokeExpandDuration: number;     // ms
  readonly smokeLingerDuration: number;     // ms
  readonly smokeDissipateDuration: number;  // ms
  readonly smokeMaxAlpha: number;           // 0-1
}

export interface MolotovUtilityConfig extends BaseUtilityConfig {
  readonly type: 'molotov';
  readonly fireRadius: number;          // px – Schadensradius
  readonly fireDamagePerTick: number;   // HP Schaden pro Tick
  readonly fireTickInterval: number;    // ms zwischen Damage-Ticks (z.B. 200)
  readonly fireLingerDuration: number;  // ms wie lange das Feuer brennt
}

export type UtilityConfig = ExplosiveUtilityConfig | SmokeUtilityConfig | MolotovUtilityConfig;

export interface UltimateConfig {
  readonly id: string;
  readonly displayName: string;
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
    displayName:          'Glock',
    cooldown:             150,
    damage:               10,
    range:                400,        
    fire: {
      type:                 'projectile',
      projectileSpeed:      700,
      projectileSize:       5,
      projectileMaxBounces: 10,
    },
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
    displayName:          'USP',
    cooldown:             250,
    damage:               14,
    range:                600,        
    fire: {
      type:                 'projectile',
      projectileSpeed:      1000,
      projectileSize:       5,
      projectileMaxBounces: 10,
    },
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

  ASMD_PRIM: {
    id:                   'ASMD_PRIM',
    displayName:          'ASMD Primär',
    cooldown:             500,
    damage:               10,
    range:                800,        
    fire: {
      type:                 'hitscan',
      traceThickness:       3,
   },
    allowedSlots:         ['weapon1'],
    adrenalinCost:        0,
    adrenalinGain:        5,
    spreadStanding:       0,
    spreadMoving:         0,
    spreadPerShot:        0,
    maxDynamicSpread:     0,
    spreadRecoveryDelay:  400,
    spreadRecoveryRate:   5,
    spreadRecoverySpeed:  100,
  } as WeaponConfig,

  BITE: {
    id:                   'BITE',
    displayName:          'Dachsbiss',
    cooldown:             250,
    damage:               50,
    range:                150,        
    fire: {
      type:                 'melee',
      hitRadius:            24,
      hitArcDegrees:        90,
      forwardOffset:        16,
   },
    allowedSlots:         ['weapon1'],
    adrenalinCost:        0,
    adrenalinGain:        50,
    spreadStanding:       0,
    spreadMoving:         0,
    spreadPerShot:        0,
    maxDynamicSpread:     0,
    spreadRecoveryDelay:  400,
    spreadRecoveryRate:   5,
    spreadRecoverySpeed:  100,
  } as WeaponConfig,

  /**
   * "WEAPON2" - Rechte Maustaste
   */

  P90: {
    id:                   'P90',
    displayName:          'P90',
    cooldown:             80,
    damage:               7,
    range:                500,        
    fire: {
      type:                 'projectile',
      projectileSpeed:      800,
      projectileSize:       3,
      projectileMaxBounces: 10,
    },
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
    displayName:          'AK-47',
    cooldown:             100,
    damage:               14,
    range:                1000,        
    fire: {
      type:                 'projectile',
      projectileSpeed:      1000,
      projectileSize:       4,
      projectileMaxBounces: 10,
    },
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

  SHOTGUN: {
    id:                   'SHOTGUN',
    displayName:          'Schrotflinte',
    cooldown:             700,
    damage:               20,       // Schaden pro Pellet
    range:                280,
    fire: {
      type:                 'projectile',
      projectileSpeed:      1200,
      projectileSize:       4,
      projectileMaxBounces: 1,
    },
    allowedSlots:         ['weapon2'],
    adrenalinCost:        20,
    adrenalinGain:        0,
    spreadStanding:       0,
    spreadMoving:         5,
    spreadPerShot:        5,
    maxDynamicSpread:     5,
    spreadRecoveryDelay:  500,
    spreadRecoveryRate:   3,
    spreadRecoverySpeed:  100,
    pelletCount:          5,
    pelletSpreadAngle:    16,
  } as WeaponConfig,

} as const;

export const UTILITY_CONFIGS = {
  HE_GRENADE: {
    id:              'HE_GRENADE',
    displayName:     'HE Granate',
    type:            'explosive',
    cooldown:        6000,
    projectileSpeed: 500,
    projectileSize:  10,
    fuseTime:        750,
    maxBounces:      3,
    aoeRadius:       80,
    aoeDamage:       60,
  } as UtilityConfig,

  SMOKE_GRENADE: {
    id:                     'SMOKE_GRENADE',
    displayName:            'Smoke Granate',
    type:                   'smoke',
    cooldown:               7000,
    projectileSpeed:        500,
    projectileSize:         10,
    fuseTime:               750,
    maxBounces:             3,
    smokeRadius:            240,
    smokeExpandDuration:    500,
    smokeLingerDuration:    7000,
    smokeDissipateDuration: 2000,
    smokeMaxAlpha:          0.95,
  } as UtilityConfig,

  MOLOTOV_GRENADE: {
    id:                 'MOLOTOV_GRENADE',
    displayName:        'Molotov',
    type:               'molotov',
    cooldown:           8000,
    projectileSpeed:    500,
    projectileSize:     10,
    fuseTime:           750,
    maxBounces:         3,
    fireRadius:         160,
    fireDamagePerTick:  8,
    fireTickInterval:   200,
    fireLingerDuration: 4000,
  } as UtilityConfig,
} as const;

export const ULTIMATE_CONFIGS = {
  HONEY_BADGER_RAGE: {
    id:                 'HONEY_BADGER_RAGE',
    displayName:        'Honigdachs-Wut',
    cooldown:           0,          // rage-gated, kein Zeitcooldown
    rageRequired:       RAGE_MAX,   // 300
    duration:           5000,
    speedMultiplier:    1.5,
    damageMultiplier:   1.5,
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
