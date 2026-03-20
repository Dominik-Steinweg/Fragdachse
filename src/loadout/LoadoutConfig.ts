import { RAGE_MAX } from '../config';
import type { LoadoutSlot, DetonableConfig, DetonatorConfig, ProjectileStyle } from '../types';

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
  readonly hitArcDegrees: number;       // Öffnungswinkel vor dem Spieler
}

export interface FlamethrowerWeaponFireConfig {
  readonly type: 'flamethrower';
  readonly projectileSpeed: number;     // px/s – Anfangsgeschwindigkeit der Hitbox
  readonly hitboxStartSize: number;     // px – Startgröße der Hitbox
  readonly hitboxEndSize: number;       // px – Maximalgröße nach Wachstum
  readonly hitboxGrowRate: number;      // px/s – Wachstumsrate der Hitbox
  readonly velocityDecay: number;       // Geschwindigkeits-Faktor pro Sekunde (0-1)
}

export type WeaponFireConfig =
  | ProjectileWeaponFireConfig
  | HitscanWeaponFireConfig
  | MeleeWeaponFireConfig
  | FlamethrowerWeaponFireConfig;

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

  // Visuelles Override
  readonly projectileColor?: number;         // Überschreibt Spielerfarbe für Projektil-Visuals (hex)
  readonly projectileStyle?: ProjectileStyle; // 'bullet' (eckig, Standard) | 'ball' (rund)

  // Detonations-System
  readonly detonable?:  DetonableConfig;  // Projektile dieser Waffe können gezündet werden
  readonly detonator?:  DetonatorConfig;  // Diese Waffe zündet passende Detonables

  // Objekt-Schadens-Multiplikatoren (optional, Default = 1.0 = 100%)
  readonly rockDamageMult?:  number;  // Schadensfaktor gegen Felsen (0 = kein Schaden)
  readonly trainDamageMult?: number;  // Schadensfaktor gegen den Zug (0 = kein Schaden)
}

export type UtilityType = 'explosive' | 'smoke' | 'molotov' | 'bfg';

export interface InstantUtilityActivationConfig {
  readonly type: 'instant';
}

export interface ChargedThrowUtilityActivationConfig {
  readonly type: 'charged_throw';
  readonly minThrowSpeed: number;      // px/s bei kurzem Antippen
  readonly fullChargeDuration: number; // ms bis Maximalgeschwindigkeit
}

export interface ChargedGateUtilityActivationConfig {
  readonly type: 'charged_gate';
  readonly fullChargeDuration: number; // ms – muss voll aufgeladen werden um zu feuern
}

export type UtilityActivationConfig =
  | InstantUtilityActivationConfig
  | ChargedThrowUtilityActivationConfig
  | ChargedGateUtilityActivationConfig;

interface BaseUtilityConfig {
  readonly id: string;
  readonly displayName: string;
  readonly type: UtilityType;
  readonly cooldown: number;        // ms
  readonly activation: UtilityActivationConfig;
  readonly projectileSpeed: number; // px/s maximale Wurfgeschwindigkeit
  readonly projectileSize: number;  // px
  readonly fuseTime: number;        // ms bis Explosion
  readonly maxBounces: number;      // 0 = kein Abprallen, >0 = Explosion nach n Abprallern

  readonly allowedSlots: readonly LoadoutSlot[]; // Slots, in die dieses Utility eingesetzt werden darf

  // Objekt-Schadens-Multiplikatoren (optional, Default = 1.0 = 100%)
  readonly rockDamageMult?:  number;  // Schadensfaktor gegen Felsen (0 = kein Schaden)
  readonly trainDamageMult?: number;  // Schadensfaktor gegen den Zug (0 = kein Schaden)

  // Spezial-Flags (optional)
  /** Goldene Explosion + Kamera-Shake (Heilige Handgranate etc.) */
  readonly holyExplosion?: boolean;
  /** Kein Cooldown-Publish nach Nutzung – für Ammo-basierte Einmal-Items,
   *  damit der Cooldown der wiederhergestellten Utility nicht überschrieben wird. */
  readonly skipCooldownPublish?: boolean;
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

export interface BfgUtilityConfig extends BaseUtilityConfig {
  readonly type: 'bfg';
  readonly directDamage: number;    // HP-Schaden bei Direkttreffer
  readonly laserDamage: number;     // Schaden pro Laser-Treffer
  readonly laserRadius: number;     // Laser-Reichweite in px
  readonly laserInterval: number;   // ms zwischen Laser-Salven
}

export type UtilityConfig = ExplosiveUtilityConfig | SmokeUtilityConfig | MolotovUtilityConfig | BfgUtilityConfig;

const STANDARD_GRENADE_CHARGE = {
  type: 'charged_throw',
  minThrowSpeed: 50,
  fullChargeDuration: 700,
} as const satisfies ChargedThrowUtilityActivationConfig;

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
      projectileSpeed:      900,
      projectileSize:       2,
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
    projectileStyle:      'bullet' as ProjectileStyle,
  } as WeaponConfig,

  USP: {
    id:                   'USP',
    displayName:          'USP',
    cooldown:             250,
    damage:               14,
    range:                600,        
    fire: {
      type:                 'projectile',
      projectileSpeed:      1200,
      projectileSize:       3,
      projectileMaxBounces: 1,
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
    projectileStyle:      'bullet' as ProjectileStyle,
  } as WeaponConfig,

  ASMD_PRIM: {
    id:                   'ASMD_PRIM',
    displayName:          'ASMD Primär',
    cooldown:             500,
    damage:               10,
    range:                650,
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
    // ASMD Primary zündet ASMD Secondary-Bälle (und später weitere Tags wenn gewünscht)
    detonator: {
      triggerTags: ['asmd_ball'],
    } satisfies DetonatorConfig,
    rockDamageMult:  0,   // ASMD Primary macht keinen Schaden an Felsen
  } as WeaponConfig,

  BITE: {
    id:                   'BITE',
    displayName:          'Dachsbiss',
    cooldown:             350,
    damage:               50,
    range:                80,        
    fire: {
      type:                 'melee',
      hitArcDegrees:        60,
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
    trainDamageMult: 1.5, // 150% Schaden am Zug
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
      projectileSpeed:      1200,
      projectileSize:       2,
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
    projectileStyle:      'bullet' as ProjectileStyle,
  } as WeaponConfig,

  AK47: {
    id:                   'AK47',
    displayName:          'AK-47',
    cooldown:             100,
    damage:               14,
    range:                1000,        
    fire: {
      type:                 'projectile',
      projectileSpeed:      1200,
      projectileSize:       3,
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
    projectileStyle:      'bullet' as ProjectileStyle,
  } as WeaponConfig,

  SHOTGUN: {
    id:                   'SHOTGUN',
    displayName:          'Schrotflinte',
    cooldown:             700,
    damage:               15,       // Schaden pro Pellet
    range:                230,
    fire: {
      type:                 'projectile',
      projectileSpeed:      1600,
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
    projectileStyle:      'bullet' as ProjectileStyle,
  } as WeaponConfig,

  /**
   * ASMD Secondary – langsamer Energieball (Projektil), der durch ASMD Primary (Hitscan)
   * oder andere konfigurierte Detonatoren gezündet werden kann.
   * Basiert auf dem ASMD Shock Rifle Secondary Fire aus Unreal Tournament.
   */
  ASMD_SEC: {
    id:                   'ASMD_SEC',
    displayName:          'ASMD Sekundär',
    cooldown:             500,
    damage:               20,          // Direkttreffer-Schaden
    range:                500,         
    fire: {
      type:                 'projectile',
      projectileSpeed:      350,
      projectileSize:       16,
      projectileMaxBounces: 0,
    },
    allowedSlots:         ['weapon2'],
    adrenalinCost:        20,
    adrenalinGain:        0,
    spreadStanding:       0,
    spreadMoving:         0,
    spreadPerShot:        0,
    maxDynamicSpread:     0,
    spreadRecoveryDelay:  400,
    spreadRecoveryRate:   5,
    spreadRecoverySpeed:  100,
    // Runder Energieball – wird in Spielerfarbe gezeichnet.
    // projectileColor kann gesetzt werden um die Farbe zu überschreiben (hier nicht gesetzt).
    projectileStyle:  'ball' satisfies ProjectileStyle,
    // Detonations-Tag: wird durch ASMD_PRIM (und spätere Detonatoren mit diesem Tag) gezündet
    detonable: {
      tag:            'asmd_ball',
      aoeDamage:      80,
      aoeRadius:      80,
      allowCrossTeam: true,   // Jeder ASMD-Primary-Schuss kann ASMD-Bälle anderer Spieler zünden
    } satisfies DetonableConfig,
  } as WeaponConfig,

  /**
   * FLAMMENWERFER – Kontinu-Feuer-Waffe (Weapon2-Slot)
   * Niedrige Pro-Treffer-Damage, hohe Feuerrate, kurze Reichweite.
   * Host spawnt unsichtbare, wachsende Hitboxen; Clients rendern Flammenpartikel.
   */
  FLAMETHROWER: {
    id:                   'FLAMETHROWER',
    displayName:          'Flammenwerfer',
    cooldown:             70,          // 20 Hitboxen/s
    damage:               4,           // pro Hitbox-Treffer
    range:                250,         // px maximale Flammenreichweite
    fire: {
      type:               'flamethrower',
      projectileSpeed:    400,         // px/s Anfangsgeschwindigkeit
      hitboxStartSize:    14,           // px Startgröße
      hitboxEndSize:      120,          // px Maximalgröße
      hitboxGrowRate:     60,          // px/s Wachstum
      velocityDecay:      0.82,        // 95% der Geschwindigkeit verbleiben pro Sekunde → ~750 px Reichweite
    },
    allowedSlots:         ['weapon2'],
    adrenalinCost:        0.5,           // Adrenalin-Kosten pro Hitbox
    adrenalinGain:        0,           // kein Adrenalin-Gewinn bei Treffer
    spreadStanding:       8,
    spreadMoving:         12,
    spreadPerShot:        0.3,
    maxDynamicSpread:     6,
    spreadRecoveryDelay:  300,
    spreadRecoveryRate:   4,
    spreadRecoverySpeed:  100,
    projectileStyle:      'flame' as ProjectileStyle,
    projectileColor:      0xff6600,    // feste Flammenfarbe (nicht Spielerfarbe)
    rockDamageMult:       0,           // Flammen machen keinen Schaden an Felsen
    trainDamageMult:      0.05,        // 5% Schaden am Zug
  } as WeaponConfig,

} as const;

export const UTILITY_CONFIGS = {
  HE_GRENADE: {
    id:              'HE_GRENADE',
    displayName:     'HE Granate',
    type:            'explosive',
    cooldown:        6000,
    activation:      STANDARD_GRENADE_CHARGE,
    projectileSpeed: 500,
    projectileSize:  10,
    fuseTime:        750,
    maxBounces:      3,
    aoeRadius:       80,
    aoeDamage:       60,
    allowedSlots:    ['utility'],
  } as UtilityConfig,

  SMOKE_GRENADE: {
    id:                     'SMOKE_GRENADE',
    displayName:            'Smoke Granate',
    type:                   'smoke',
    cooldown:               7000,
    activation:             STANDARD_GRENADE_CHARGE,
    projectileSpeed:        500,
    projectileSize:         10,
    fuseTime:               750,
    maxBounces:             3,
    smokeRadius:            240,
    smokeExpandDuration:    500,
    smokeLingerDuration:    7000,
    smokeDissipateDuration: 2000,
    smokeMaxAlpha:          0.95,
    allowedSlots:           ['utility'],
  } as UtilityConfig,

  MOLOTOV_GRENADE: {
    id:                 'MOLOTOV_GRENADE',
    displayName:        'Molotov',
    type:               'molotov',
    cooldown:           8000,
    activation:         STANDARD_GRENADE_CHARGE,
    projectileSpeed:    500,
    projectileSize:     10,
    fuseTime:           750,
    maxBounces:         3,
    fireRadius:         160,
    fireDamagePerTick:  8,
    fireTickInterval:   200,
    fireLingerDuration: 4000,
    rockDamageMult:     0,  // Molotov macht keinen Schaden an Felsen
    allowedSlots:       ['utility'],
  } as UtilityConfig,

  HOLY_HAND_GRENADE: {
    id:              'HOLY_HAND_GRENADE',
    displayName:     'Heilige Handgranate',
    type:            'explosive',
    cooldown:        0,             // Ammo-basiert (Einzelschuss), kein Cooldown
    activation:      STANDARD_GRENADE_CHARGE,
    projectileSpeed: 500,
    projectileSize:  14,
    fuseTime:        3000,          // 3 Sekunden Zünder
    maxBounces:      999,             // bleibt liegen
    aoeRadius:       250,           // riesiger Radius
    aoeDamage:       200,           // massiver Schaden
    allowedSlots:         [],            // NICHT im Loadout-Menü wählbar
    trainDamageMult:      1.0,           // 100% Schaden am Zug
    holyExplosion:        true,          // goldene Explosion + Kamera-Shake
    skipCooldownPublish:  true,          // kein Cooldown-Publish (Ammo-basiert, Rollback stellt alten CD her)
  } as UtilityConfig,

  BFG: {
    id:                  'BFG',
    displayName:         'BFG',
    type:                'bfg',
    cooldown:            0,             // Ammo-basiert (Einzelschuss), kein Cooldown
    activation:          { type: 'charged_gate', fullChargeDuration: 900 } as ChargedGateUtilityActivationConfig,
    projectileSpeed:     250,           // langsames, großes Projektil
    projectileSize:      32,
    fuseTime:            0,             // kein Zünder
    maxBounces:          0,
    directDamage:        200,           // massiver Direkttreffer-Schaden
    laserDamage:         10,            // Schaden pro Laser-Treffer
    laserRadius:         256,           // Laser-Reichweite in px
    laserInterval:       100,           // alle 100ms Laser-Salve
    allowedSlots:        [],            // NICHT im Loadout-Menü wählbar
    skipCooldownPublish: true,          // kein Cooldown-Publish (Ammo-basiert, Rollback stellt alten CD her)
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
