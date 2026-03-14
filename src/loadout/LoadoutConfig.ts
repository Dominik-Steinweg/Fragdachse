import { RAGE_MAX } from '../config';

// ── Item-Konfigurationstypen ──────────────────────────────────────────────────

export interface WeaponConfig {
  readonly id: string;
  readonly cooldown: number;        // ms
  readonly damage: number;
  readonly projectileSpeed: number; // px/s
  readonly projectileSize: number;  // px (quadratisch)
  readonly projectileLifetime: number; // ms
  readonly projectileMaxBounces: number;
  readonly projectileColor: number; // hex
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
  TEST_WEAPON_1: {
    id:                   'TEST_WEAPON_1',
    cooldown:             200,
    damage:               15,
    projectileSpeed:      500,
    projectileSize:       6,
    projectileLifetime:   3000,
    projectileMaxBounces: 10,
    projectileColor:      0xc09473,
  } as WeaponConfig,

  TEST_WEAPON_2: {
    id:                   'TEST_WEAPON_2',
    cooldown:             100,
    damage:               8,
    projectileSpeed:      600,
    projectileSize:       4,
    projectileLifetime:   2000,
    projectileMaxBounces: 10,
    projectileColor:      0xaaddff,
  } as WeaponConfig,
} as const;

export const UTILITY_CONFIGS = {
  HE_GRENADE: {
    id:              'HE_GRENADE',
    cooldown:        6000,
    projectileSpeed: 200,
    projectileSize:  10,
    projectileColor: 0x44aa22,
    fuseTime:        1500,
    aoeRadius:       120,
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
  weapon1:  WEAPON_CONFIGS.TEST_WEAPON_1,
  weapon2:  WEAPON_CONFIGS.TEST_WEAPON_2,
  utility:  UTILITY_CONFIGS.HE_GRENADE,
  ultimate: ULTIMATE_CONFIGS.HONEY_BADGER_RAGE,
} as const;
