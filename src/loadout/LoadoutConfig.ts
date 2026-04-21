import { COLORS, RAGE_MAX } from '../config';
import type { BulletVisualPreset, GameMode, GrenadeVisualPreset, HitscanVisualPreset, ImpactCloudConfig, LoadoutSlot, DetonableConfig, DetonatorConfig, EnergyBallVariant, ExplosionVisualStyle, LoadoutShotAudioConfig, MeleeVisualPreset, PlaceableFootprintCell, ProjectileExplosionConfig, ProjectileHomingConfig, ProjectileStyle, RadialDamageFalloffConfig, ShieldBlockCategory, TeslaDomeTargetType, TracerConfig } from '../types';

// ── Item-Konfigurationstypen ──────────────────────────────────────────────────

export interface ProjectileWeaponFireConfig {
  readonly type: 'projectile';
  readonly projectileSpeed: number;     // px/s
  readonly projectileSize: number;      // px (quadratisch)
  readonly projectileMaxBounces: number;
  readonly limitRangeToCursor?: boolean; // true = Reichweite dieses Schusses auf Cursor-Distanz begrenzen
  readonly impactExplosion?: ProjectileExplosionConfig;
  readonly impactCloud?: ImpactCloudConfig;
  readonly homing?: ProjectileHomingConfig;
}

export interface HitscanWeaponFireConfig {
  readonly type: 'hitscan';
  readonly traceThickness: number;      // px - für spätere Ray-/Sweep-Checks
  readonly visualPreset?: HitscanVisualPreset;
}

export interface MeleeWeaponFireConfig {
  readonly type: 'melee';
  readonly hitArcDegrees: number;       // Öffnungswinkel vor dem Spieler
  readonly visualPreset?: MeleeVisualPreset;
}

export interface FlamethrowerWeaponFireConfig {
  readonly type: 'flamethrower';
  readonly projectileSpeed: number;     // px/s – Anfangsgeschwindigkeit der Hitbox
  readonly hitboxStartSize: number;     // px – Startgröße der Hitbox
  readonly hitboxEndSize: number;       // px – Maximalgröße nach Wachstum
  readonly hitboxGrowRate: number;      // px/s – Wachstumsrate der Hitbox
  readonly velocityDecay: number;       // Geschwindigkeits-Faktor pro Sekunde (0-1)
  readonly burnDurationMs: number;
  readonly burnDamagePerTick: number;
  readonly burnTickIntervalMs: number;
}

export interface TeslaDomeWeaponFireConfig {
  readonly type: 'tesla_dome';
  readonly radius: number;
  readonly damagePerTick: number;
  readonly tickInterval: number;
  readonly adrenalineDrainPerSecond: number;
  readonly movementSlowFactor: number;
  readonly requireLineOfSight: boolean;
  readonly targetTypes: readonly TeslaDomeTargetType[];
  readonly visualIndicatorAlpha: number;
  readonly visualFieldAlpha: number;
  readonly visualIdleArcCount: number;
  readonly visualIdleArcLength: number;
  readonly visualBoltThicknessMin: number;
  readonly visualBoltThicknessMax: number;
  readonly visualJitter: number;
  readonly visualBranchChance: number;
  readonly visualCoreParticleFrequency: number;
  readonly visualFieldParticleFrequency: number;
  readonly visualRimParticleFrequency: number;
  readonly visualImpactBurstScale: number;
  readonly visualWhiteness: number;
  readonly visualPulseSpeed: number;
}

export interface EnergyShieldWeaponFireConfig {
  readonly type: 'energy_shield';
  readonly blockArcDegrees: number;
  readonly anchorDistance: number;
  readonly visualRadius: number;
  readonly visualThickness: number;
  readonly adrenalineDrainPerSecond: number;
  readonly movementSlowFactor: number;
  readonly flashDurationMs: number;
  readonly flashMaxAlpha: number;
  readonly buffMax: number;
  readonly buffGainFactor: number;
  readonly buffDecayDelayMs: number;
  readonly buffDecayPerSecond: number;
  readonly buffMaxBonus: number;
  readonly blockableCategories: readonly ShieldBlockCategory[];
  readonly visualInnerAlpha: number;
  readonly visualOuterAlpha: number;
}

export type WeaponFireConfig =
  | ProjectileWeaponFireConfig
  | HitscanWeaponFireConfig
  | MeleeWeaponFireConfig
  | FlamethrowerWeaponFireConfig
  | TeslaDomeWeaponFireConfig
  | EnergyShieldWeaponFireConfig;

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
  readonly spreadPerShot: number;       // Bloom-Zunahme pro Schuss (negativ = Warmup-Mechanik, z.B. Negev)
  readonly maxDynamicSpread: number;    // Ober-/Untergrenze des dynamischen Spreads (negativ für Warmup-Waffen)

  // Spread-Recovery
  readonly spreadRecoveryDelay: number; // ms Wartezeit nach letztem Schuss vor Abbau
  readonly spreadRecoveryRate: number;  // Grad-Abbau pro Tick
  readonly spreadRecoverySpeed: number; // ms pro Tick (bestimmt Abbau-Geschwindigkeit)

  // Multi-Projektil (Optional) – z.B. Shotgun
  // Sind beide Felder gesetzt und pelletCount > 1, werden alle Projektile gleichzeitig gefeuert.
  readonly pelletCount?:       number; // Anzahl gleichzeitig abgefeuerter Projektile
  readonly pelletSpreadAngle?: number; // Halbwinkel der Auffächerung in Grad ([-y, +y])

  // Hydra-Splitting (optional)
  readonly splitCount?:        number; // Anzahl der beim Bounce neu erzeugten Projektile
  readonly splitSpread?:       number; // Winkelabstand in Grad zwischen benachbarten Split-Bahnen
  readonly splitFactor?:       number; // Multiplikator nach der Grundteilung beim Split (1 = unverändert, 1.5 = stärkere Kinder)

  // Visuelles Override
  readonly projectileColor?: number;         // Überschreibt Spielerfarbe für Projektil-Visuals (hex)
  readonly projectileStyle?: ProjectileStyle; // 'bullet' (eckig, Standard) | 'ball' (rund)
  readonly bulletVisualPreset?: BulletVisualPreset;
  readonly energyBallVariant?: EnergyBallVariant;
  readonly rocketSmokeTrailColor?: number;   // optionales Farb-Override für Raketenrauch, sonst Spielerfarbe

  // Detonations-System
  readonly detonable?:  DetonableConfig;  // Projektile dieser Waffe können gezündet werden
  readonly detonator?:  DetonatorConfig;  // Diese Waffe zündet passende Detonables

  // Objekt-Schadens-Multiplikatoren (optional, Default = 1.0 = 100%)
  readonly rockDamageMult?:  number;  // Schadensfaktor gegen Felsen (0 = kein Schaden)
  readonly trainDamageMult?: number;  // Schadensfaktor gegen den Zug (0 = kein Schaden)

  // Shot-Feedback-Mechaniken (optional, data-driven)
  readonly holdSpeedFactor?:   number;  // Geschwindigkeits-Multiplikator während Feuerknopf gehalten (z.B. 0.5 = halbiert)
  readonly shotRecoilForce?:   number;  // Rückstoßkraft in px/s – Anfangsgeschwindigkeit des Rückstoßimpulses
  readonly shotRecoilDuration?: number; // ms – wie lange der Rückstoß anhält (Default: 180ms, Quad-Ease-Out Decay)
  readonly shotScreenShake?: {          // Kamera-Shake direkt beim Schuss (nicht während Cooldown)
    readonly duration:  number;        // ms
    readonly intensity: number;        // 0–1 (Phaser shake intensity)
  };

  // Tracer-Leuchtlinie (optional, data-driven)
  // undefined = kein Tracer; TracerConfig.colorCore/colorGlow undefined = Spielerfarbe
  readonly tracerConfig?: TracerConfig;

  // Aim-Reticle (optional, data-driven)
  readonly showCrosshair?: boolean;      // false = Zielfadenkreuz ausblenden

  // Audio (optional, data-driven)
  readonly shotAudio?: LoadoutShotAudioConfig;

  // Scope-Mechanik (optional, data-driven) – aktiviert Zielrohr-Effekt mit fire-on-release
  readonly scopeConfig?: ScopeModeConfig;
}

/** Konfiguration für Waffen mit Einscop-Mechanik (z.B. AWP). */
export interface ScopeModeConfig {
  readonly scopeInMs: number;            // ms bis voller Scope (sichtbarer Kreis minimal), z.B. 1000
  readonly fullScopeViewRadius: number;  // Sichtbarer Radius in px bei vollem Scope, z.B. 64
  readonly edgeSoftnessPx: number;       // Weichheits-Breite am Rand der Sichtverdunkelung, z.B. 40
  readonly unscopedSpreadDeg: number;    // Streuung (Grad) bei scope=0 (sehr ungenau), z.B. 30
  readonly unscopeSpeedMs: number;       // ms zum Entscopen nach Schuss / Loslassen, z.B. 250
}

export type UtilityType = 'explosive' | 'smoke' | 'molotov' | 'bfg' | 'nuke' | 'stinkcloud' | 'translocator' | 'placeable_rock' | 'placeable_turret' | 'taser' | 'decoy';

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

export interface TargetedClickUtilityActivationConfig {
  readonly type: 'targeted_click';
}

export interface PlacementModeUtilityActivationConfig {
  readonly type: 'placement_mode';
}

export interface PlacementModeUltimateActivationConfig {
  readonly type: 'placement_mode';
}

export type UtilityActivationConfig =
  | InstantUtilityActivationConfig
  | ChargedThrowUtilityActivationConfig
  | ChargedGateUtilityActivationConfig
  | TargetedClickUtilityActivationConfig
  | PlacementModeUtilityActivationConfig;

export interface PlaceablePlacementConfig {
  readonly kind: 'rock' | 'turret';
  readonly range: number;
  readonly footprint: readonly PlaceableFootprintCell[];
  readonly maxHp: number;
  readonly lifetimeMs: number;
  readonly previewAlpha: number;
  readonly ownerTintStrength: number;
  readonly warningPulseMs: number;
  readonly spawnShakeDuration: number;
  readonly spawnShakeIntensity: number;
}

export interface PlaceableRockPlacementConfig extends PlaceablePlacementConfig {
  readonly kind: 'rock';
}

export interface PlaceableTurretPlacementConfig extends PlaceablePlacementConfig {
  readonly kind: 'turret';
  readonly targetRange: number;
  readonly muzzleOffset: number;
  readonly deathCloudRadius: number;
}

export interface PlaceableTunnelPlacementConfig {
  readonly kind: 'tunnel';
  readonly range: number;
  readonly entranceRadius: number;
  readonly previewAlpha: number;
  readonly ownerTintStrength: number;
}

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
  readonly allowTeamDamage?: boolean;

  readonly allowedSlots: readonly LoadoutSlot[]; // Slots, in die dieses Utility eingesetzt werden darf
  readonly shotAudio?: LoadoutShotAudioConfig;

  // Erweiterte Flugphysik (Friction / Decay)
  readonly frictionDelayMs?: number;        // ms Flugzeit bevor der Speed reduziert wird
  readonly airFrictionDecayPerSec?: number; // Faktor pro Sekunde (0.5 = halbiert sich jede Sekunde)
  readonly bounceFrictionMultiplier?: number; // Faktor, mit dem Speed beim Abprallen multipliziert wird
  readonly stopSpeedThreshold?: number;     // Speed (px/s), ab der das Projektil auf 0 stoppt

  // Objekt-Schadens-Multiplikatoren (optional, Default = 1.0 = 100%)
  readonly rockDamageMult?:  number;  // Schadensfaktor gegen Felsen (0 = kein Schaden)
  readonly trainDamageMult?: number;  // Schadensfaktor gegen den Zug (0 = kein Schaden)

  // Spezial-Flags (optional)
  /** Eigenes Projektil-Visual fuer geworfene Utilitys. */
  readonly projectileStyle?: ProjectileStyle;
  readonly grenadeVisualPreset?: GrenadeVisualPreset;
  /** Optionales Farb-Override fuer das Utility-Projektil. */
  readonly projectileColor?: number;
  /** Visueller Explosionsstil fuer Damage-Utilities (Heilige Handgranate etc.) */
  readonly explosionVisualStyle?: ExplosionVisualStyle;
  /** Kein Cooldown-Publish nach Nutzung – für Ammo-basierte Einmal-Items,
   *  damit der Cooldown der wiederhergestellten Utility nicht überschrieben wird. */
  readonly skipCooldownPublish?: boolean;
}

export interface ExplosiveUtilityConfig extends BaseUtilityConfig {
  readonly type: 'explosive';
  readonly aoeRadius: number;       // px
  readonly aoeDamage: number;       // HP-Schaden im Radius
  readonly damageFalloff?: RadialDamageFalloffConfig;
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
  readonly fireBurnDurationMs?:     number;  // ms – Dauer eines Burn-Stacks pro Tick
  readonly fireBurnDamagePerTick?:  number;  // HP Schaden pro Burn-Tick
  readonly fireBurnTickIntervalMs?: number;  // ms zwischen Burn-Ticks
}

export interface BfgUtilityConfig extends BaseUtilityConfig {
  readonly type: 'bfg';
  readonly directDamage: number;    // HP-Schaden bei Direkttreffer
  readonly laserDamage: number;     // Schaden pro Laser-Treffer
  readonly laserRadius: number;     // Laser-Reichweite in px
  readonly laserInterval: number;   // ms zwischen Laser-Salven
}

export interface NukeUtilityConfig extends BaseUtilityConfig {
  readonly type: 'nuke';
}

export interface StinkCloudUtilityConfig extends BaseUtilityConfig {
  readonly type: 'stinkcloud';
  readonly cloudRadius: number;          // px – Schadensradius der Gaswolke
  readonly cloudDuration: number;        // ms – Gesamtdauer der Wolke
  readonly cloudDamagePerTick: number;   // HP Schaden pro Tick
  readonly cloudTickInterval: number;    // ms zwischen Damage-Ticks
}

export interface TaserUtilityConfig extends BaseUtilityConfig {
  readonly type: 'taser';
  readonly damage: number;
  readonly range: number;
  readonly hitArcDegrees: number;
  readonly visualPreset: MeleeVisualPreset;
}

export interface DecoyUtilityConfig extends BaseUtilityConfig {
  readonly type: 'decoy';
  readonly decoyLifetimeMs: number;
  readonly stealthDurationMs: number;
  readonly stealthAlphaMin: number;
  readonly stealthAlphaMax: number;
  readonly stealthGlowOuterStrength: number;
  readonly wobblePeriodMs: number;
  readonly dissipateDustBurst: number;
}

export interface TranslocatorUtilityConfig extends BaseUtilityConfig {
  readonly type: 'translocator';
  // Translocator-spezifische Configs koennen hier rein
}

export interface PlaceableRockUtilityConfig extends BaseUtilityConfig {
  readonly type: 'placeable_rock';
  readonly activation: PlacementModeUtilityActivationConfig;
  readonly placeable: PlaceableRockPlacementConfig;
}

export interface PlaceableTurretUtilityConfig extends BaseUtilityConfig {
  readonly type: 'placeable_turret';
  readonly activation: PlacementModeUtilityActivationConfig;
  readonly placeable: PlaceableTurretPlacementConfig;
  readonly weaponId: string;
}

export type PlaceableUtilityConfig = PlaceableRockUtilityConfig | PlaceableTurretUtilityConfig;

export type UtilityConfig = ExplosiveUtilityConfig | SmokeUtilityConfig | MolotovUtilityConfig | BfgUtilityConfig | NukeUtilityConfig | StinkCloudUtilityConfig | TaserUtilityConfig | DecoyUtilityConfig | TranslocatorUtilityConfig | PlaceableRockUtilityConfig | PlaceableTurretUtilityConfig;

const STANDARD_GRENADE_CHARGE = {
  type: 'charged_throw',
  minThrowSpeed: 50,
  fullChargeDuration: 700,
} as const satisfies ChargedThrowUtilityActivationConfig;

export interface ArmageddonMeteorConfig {
  readonly meteorSpawnRadius: number;   // px – Radius um den Spieler, in dem Meteore spawnen
  readonly meteorDamageRadius: number;  // px – AoE-Schadensradius beim Einschlag
  readonly meteorDamage: number;        // HP-Schaden pro Einschlag
  readonly meteorDamageFalloff?: RadialDamageFalloffConfig;
  readonly meteorFallDuration: number;  // ms – Vorwarnzeit bevor der Meteor einschlägt
  readonly meteorsPerSecond: number;    // Spawn-Rate (leicht zufällig verteilt)
  readonly meteorRadiusJitter: number;   // 0–1 – prozentuale Zufallsabweichung des Radius (0.1 = ±10%)
  readonly selfDamageMult: number;      // Selbstschadens-Multiplikator (0 = immun)
  readonly rockDamageMult?: number;     // Schadensfaktor gegen Felsen (Default 1.0)
  readonly trainDamageMult?: number;    // Schadensfaktor gegen den Zug (Default 1.0)
}

export interface BuffAuraConfig {
  readonly radius: number;
  readonly damagePerTick: number;
  readonly tickIntervalMs: number;
}

interface BaseUltimateConfig {
  readonly id: string;
  readonly displayName: string;
  readonly cooldown: number;          // ms (0 = rage-gated, kein Zeitcooldown)
  readonly rageRequired: number;      // Mindest-Rage zum Aktivieren
  readonly allowedModes?: readonly GameMode[];
}

export interface BuffUltimateConfig extends BaseUltimateConfig {
  readonly type: 'buff';
  readonly duration: number;          // ms wie lange der Effekt anhält
  readonly speedMultiplier: number;   // z.B. 1.3 = 30% schneller
  readonly damageMultiplier: number;  // z.B. 2.0 = doppelter Schaden
  readonly armorPerTick: number;      // fixer Armor-Zuwachs pro Tick
  readonly armorTickIntervalMs: number; // Tick-Abstand für Armor-Regeneration
  readonly rageDrainDuration: number; // ms über die Rage von max→0 sinkt
  readonly armageddon?: ArmageddonMeteorConfig;
  readonly aura?: BuffAuraConfig;
}

export interface GaussUltimateConfig extends BaseUltimateConfig {
  readonly type: 'gauss';
  readonly rageCost: number;
  readonly chargeDuration: number;
  readonly chargeColor: number;
  readonly movementSlowFactor: number;
  readonly projectileSpeed: number;
  readonly projectileSize: number;
  readonly projectileColor: number;
  readonly bulletVisualPreset: BulletVisualPreset;
  readonly tracerConfig: TracerConfig;
  readonly damage: number;
  readonly range: number;
  readonly rockDamageMult: number;
  readonly trainDamageMult?: number;
  readonly shotRecoilForce: number;
  readonly shotRecoilDuration: number;
  readonly shotAudio?: LoadoutShotAudioConfig;
}

export interface AirstrikeUltimateConfig extends BaseUltimateConfig {
  readonly type: 'airstrike';
  readonly rageCost: number;          // Rage-Kosten pro Einschlag
  readonly delayMs: number;           // ms Verzögerung zwischen Zielen und Explosion
  readonly radius: number;            // AoE-Schadensradius (px)
  readonly maxDamage: number;         // Schaden im Zentrum
  readonly minDamage: number;         // Schaden am Rand
  readonly allowTeamDamage: boolean;
  readonly selfDamageMult: number;    // 0 = Auslöser immun
  readonly rockDamageMult: number;
  readonly trainDamageMult: number;
}

export interface TunnelUltimateConfig extends BaseUltimateConfig {
  readonly type: 'tunnel';
  readonly activation: PlacementModeUltimateActivationConfig;
  readonly rageCost: number;
  readonly placement: PlaceableTunnelPlacementConfig;
  readonly travelSpeed: number;
  readonly travelMinDurationMs: number;
  readonly travelMaxDurationMs: number;
  readonly buildLabel: string;
}

export type UltimateConfig = BuffUltimateConfig | GaussUltimateConfig | AirstrikeUltimateConfig | TunnelUltimateConfig;

const CAPTURE_THE_BEER_ONLY = ['capture_the_beer'] as const satisfies readonly GameMode[];

export function isUltimateAllowedInMode(config: UltimateConfig, mode: GameMode): boolean {
  if (!config.allowedModes || config.allowedModes.length === 0) return true;
  return config.allowedModes.includes(mode);
}

export function sanitizeUltimateForMode(config: UltimateConfig | undefined, mode: GameMode): UltimateConfig {
  if (config && isUltimateAllowedInMode(config, mode)) return config;
  return isUltimateAllowedInMode(DEFAULT_LOADOUT.ultimate, mode)
    ? DEFAULT_LOADOUT.ultimate
    : ULTIMATE_CONFIGS.ARMAGEDDON;
}

export function getAvailableUltimateConfigs(mode: GameMode): UltimateConfig[] {
  return Object.values(ULTIMATE_CONFIGS).filter((config) => isUltimateAllowedInMode(config, mode));
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
    damage:               6,
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
    projectileColor:      0xd2a25f,
    projectileStyle:      'bullet' as ProjectileStyle,
    bulletVisualPreset:   'glock' as BulletVisualPreset,
    tracerConfig: {
      widthCore:  1,
      widthGlow:  2,
      alphaCore:  0.25,
      alphaGlow:  0.05,
      segments:   4,
      fadeMs:     80,
      // maxLength:  80,   // nur letzten 80 px sichtbar (Schnellfeuer-Trail, kein Spawn-Schweif)
      // colorCore/colorGlow nicht gesetzt → Spielerfarbe wird verwendet
    } satisfies TracerConfig,
    shotAudio: {
      successKey: 'shot_glock',
      failureKey: 'shot_dry_trigger',
    },
  } as WeaponConfig,

  ASMD_PRIM: {
    id:                   'ASMD_PRIM',
    displayName:          'ASMD Primär',
    cooldown:             700,
    damage:               7,
    range:                650,
    fire: {
      type:                 'hitscan',
      traceThickness:       3,
      visualPreset:         'asmd_primary' as HitscanVisualPreset,
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
    shotAudio: {
      successKey: 'shot_asmd_primary',
      failureKey: 'shot_dry_trigger',
    },
  } as WeaponConfig,

  BITE: {
    id:                   'BITE',
    displayName:          'Dachsbiss',
    cooldown:             350,
    damage:               50,
    range:                50,        
    fire: {
      type:                 'melee',
      hitArcDegrees:        80,
      visualPreset:         'bite' satisfies MeleeVisualPreset,
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
    trainDamageMult:      1.5, // 150% Schaden am Zug
    shotAudio: {
      successKey: 'shot_bite',
      failureKey: 'shot_dry_trigger',
    },    
  } as WeaponConfig,

  TASER: {
    id:                   'TASER',
    displayName:          'Zeus',
    cooldown:             4000,
    damage:               200,
    range:                80,        
    fire: {
      type:                 'melee',
      hitArcDegrees:        70,
      visualPreset:         'zeus_taser' satisfies MeleeVisualPreset,
   },
    allowedSlots:         [],
    adrenalinCost:        0,
    adrenalinGain:        100,
    spreadStanding:       0,
    spreadMoving:         0,
    spreadPerShot:        0,
    maxDynamicSpread:     0,
    spreadRecoveryDelay:  400,
    spreadRecoveryRate:   5,
    spreadRecoverySpeed:  100,
    trainDamageMult: 1.0, // 100% Schaden am Zug
    rockDamageMult:  0,   // macht keinen Schaden an Felsen    
    shotAudio: {
      successKey: 'shot_zeus',
      failureKey: 'shot_dry_trigger',
    },        
  } as WeaponConfig,

  /**
   * Plasma Gun - schnell schießend, wenig schaden, leichtes Homig
   */
  PLASMA: {
    id:                   'PLASMA',
    displayName:          'Plasma Gun',
    cooldown:             120,
    damage:               3,          // Direkttreffer-Schaden
    range:                500,         
    fire: {
      type:                 'projectile',
      projectileSpeed:      500,
      projectileSize:       8,
      projectileMaxBounces: 0,
      homing: {
        acquireDelayMs:        200,
        searchRadius:          320,
        retargetIntervalMs:    100,
        maxTurnDegreesPerStep: 8,
        targetTypes:           ['players'],
        requireLineOfSight:    true,
        excludeOwner:          true,
        distanceWeight:        1,
        forwardWeight:         1,
      } satisfies ProjectileHomingConfig,
    },
    allowedSlots:         ['weapon1'],
    adrenalinCost:        0,
    adrenalinGain:        3,
    spreadStanding:       15,
    spreadMoving:         15,
    spreadPerShot:        0,
    maxDynamicSpread:     0,
    spreadRecoveryDelay:  400,
    spreadRecoveryRate:   5,
    spreadRecoverySpeed:  100,
    projectileStyle:      'energy_ball' satisfies ProjectileStyle,
    energyBallVariant:    'plasma' satisfies EnergyBallVariant,
    shotAudio: {
      successKey: 'shot_plasma',
      failureKey: 'shot_dry_trigger',
    },
  } as WeaponConfig,

  HYDRA: {
    id:                   'HYDRA',
    displayName:          'Hydra Gun',
    cooldown:             800,
    damage:               12,          // Direkttreffer-Schaden
    range:                1000,         
    fire: {
      type:                 'projectile',
      projectileSpeed:      300,
      projectileSize:       16,
      projectileMaxBounces: 3,
    },
    allowedSlots:         ['weapon1'],
    adrenalinCost:        0,
    adrenalinGain:        12,
    spreadStanding:       0,
    spreadMoving:         0,
    spreadPerShot:        0,
    maxDynamicSpread:     0,
    splitCount:           2, // Anzahl der zusätzlichen Projektile, die beim Aufprall abgespalten werden
    splitSpread:          5, // zusätzlicher Spread der abgespaltenen Projektile in Grad (z.B. 5 = ±5°)
    splitFactor:          1.5,
    spreadRecoveryDelay:  400,
    spreadRecoveryRate:   5,
    spreadRecoverySpeed:  100,
    projectileStyle:      'hydra' satisfies ProjectileStyle,
    shotAudio: {
      successKey: 'shot_hydra',
      failureKey: 'shot_dry_trigger',
    },
  } as WeaponConfig,

  XBOW: {
    id:                   'XBOW',
    displayName:          'XXX-BOW',
    cooldown:             700,
    damage:               5,       // Schaden pro Pellet
    range:                700,
    fire: {
      type:                 'projectile',
      projectileSpeed:      1300,
      projectileSize:       4,
      projectileMaxBounces: 1,
    },
    allowedSlots:         ['weapon1'],
    adrenalinCost:        0,
    adrenalinGain:        5,
    spreadStanding:       0,
    spreadMoving:         5,
    spreadPerShot:        5,
    maxDynamicSpread:     5,
    spreadRecoveryDelay:  500,
    spreadRecoveryRate:   3,
    spreadRecoverySpeed:  100,
    pelletCount:          3,
    pelletSpreadAngle:    5,
    projectileColor:      0x8d7a5a,
    projectileStyle:      'bullet' as ProjectileStyle,
    bulletVisualPreset:   'xbow' as BulletVisualPreset,
    tracerConfig: {
      widthCore:  1,
      widthGlow:  2,
      alphaCore:  0.24,
      alphaGlow:  0.08,
      segments:   5,
      fadeMs:     120,
      maxLength:  120,
    } satisfies TracerConfig,
    shotAudio: {
      successKey: 'shot_crossbow',
      failureKey: 'shot_dry_trigger',
    },
  } as WeaponConfig,

  /**
   * "WEAPON2" - Rechte Maustaste
   */

  P90: {
    id:                   'P90',
    displayName:          'P90',
    cooldown:             80,
    damage:               6,
    range:                500,        
    fire: {
      type:                 'projectile',
      projectileSpeed:      1200,
      projectileSize:       4,
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
    projectileColor:      0xd7b06b,
    projectileStyle:      'bullet' as ProjectileStyle,
    bulletVisualPreset:   'p90' as BulletVisualPreset,
    tracerConfig: {
      widthCore:  1,
      widthGlow:  4,
      alphaCore:  0.45,
      alphaGlow:  0.16,
      segments:   5,
      fadeMs:     140,
      maxLength:  95,
    } satisfies TracerConfig,
    shotAudio: {
      successKey: 'shot_p90',
      failureKey: 'shot_dry_trigger',
    },    
  } as WeaponConfig,

  AK47: {
    id:                   'AK47',
    displayName:          'AK-47',
    cooldown:             140,
    damage:               10,
    range:                1000,        
    fire: {
      type:                 'projectile',
      projectileSpeed:      1200,
      projectileSize:       6,
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
    projectileColor:      0xc88444,
    projectileStyle:      'bullet' as ProjectileStyle,
    bulletVisualPreset:   'ak47' as BulletVisualPreset,
    tracerConfig: {
      widthCore:  1.5,
      widthGlow:  4,
      alphaCore:  0.75,
      alphaGlow:  0.22,
      segments:   5,
      fadeMs:     220,
      maxLength:  150,
    } satisfies TracerConfig,
    shotAudio: {
      successKey: 'shot_ak47',
      failureKey: 'shot_dry_trigger',
    },
  } as WeaponConfig,

  SHOTGUN: {
    id:                   'SHOTGUN',
    displayName:          'Schrotflinte',
    cooldown:             700,
    damage:               10,       // Schaden pro Pellet
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
    projectileColor:      0xa9a097,
    projectileStyle:      'bullet' as ProjectileStyle,
    bulletVisualPreset:   'shotgun' as BulletVisualPreset,
    tracerConfig: {
      widthCore:  1.2,
      widthGlow:  3.5,
      alphaCore:  0.3,
      alphaGlow:  0.3,
      segments:   3,
      fadeMs:     210,
      maxLength:  150,
    } satisfies TracerConfig,
    shotAudio: {
      successKey: 'shot_shotgun',
      failureKey: 'shot_dry_trigger',
    },
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
    damage:               15,          // Direkttreffer-Schaden
    range:                500,         
    fire: {
      type:                 'projectile',
      projectileSpeed:      400,
      projectileSize:       16,
      projectileMaxBounces: 0,
    },
    allowedSlots:         ['weapon2'],
    adrenalinCost:        15,
    adrenalinGain:        0,
    spreadStanding:       0,
    spreadMoving:         0,
    spreadPerShot:        0,
    maxDynamicSpread:     0,
    spreadRecoveryDelay:  400,
    spreadRecoveryRate:   5,
    spreadRecoverySpeed:  100,
    // Additiver Energieball mit Partikelkern und Schweif.
    projectileStyle:  'energy_ball' satisfies ProjectileStyle,
    // Detonations-Tag: wird durch ASMD_PRIM (und spätere Detonatoren mit diesem Tag) gezündet
    detonable: {
      tag:            'asmd_ball',
      aoeDamage:      60,
      aoeRadius:      100,
      damageFalloff:  { minDamage: 30 } satisfies RadialDamageFalloffConfig,
      knockback:      950,
      selfKnockbackMult: 0.75,
      allowCrossTeam: true,   // Jeder ASMD-Primary-Schuss kann ASMD-Bälle anderer Spieler zünden
      explosionVisualStyle: 'energy',
    } satisfies DetonableConfig,
    shotAudio: {
      successKey: 'shot_asmd_secondary',
      failureKey: 'shot_dry_trigger',
    },
  } as WeaponConfig,

  ROCKET_LAUNCHER: {
    id:                   'ROCKET_LAUNCHER',
    displayName:          'Raketenwerfer',
    cooldown:             950,
    damage:               10,
    range:                900,
    fire: {
      type:                 'projectile',
      projectileSpeed:      600,
      projectileSize:       10,
      projectileMaxBounces: 0,
      limitRangeToCursor:   true,
      impactExplosion: {
        radius:          110,
        maxDamage:       30,
        minDamage:       5,
        knockback:       1250,
        selfDamageMult:  0.25,
        rockDamageMult:  1,
        trainDamageMult: 1.15,
        color:           0xff8a3d,
        visualStyle:     'rocket',
      } satisfies ProjectileExplosionConfig,
    },
    allowedSlots:         ['weapon2'],
    adrenalinCost:        30,
    adrenalinGain:        0,
    spreadStanding:       0,
    spreadMoving:         0,
    spreadPerShot:        0,
    maxDynamicSpread:     10,
    spreadRecoveryDelay:  450,
    spreadRecoveryRate:   3,
    spreadRecoverySpeed:  100,
    projectileStyle:      'rocket' as ProjectileStyle,
    projectileColor:      0xe8c170,
    rocketSmokeTrailColor: COLORS.GREY_2,
    trainDamageMult:      1.15,
    shotRecoilForce:      520,
    shotRecoilDuration:   170,
    shotScreenShake:      { duration: 120, intensity: 0.004 },
    shotAudio: {
      successKey: 'shot_rocketlauncher',
      failureKey: 'shot_dry_trigger',
    },
  } as WeaponConfig,

  MINI_ROCKET_LAUNCHER: {
    id:                   'MINI_ROCKET_LAUNCHER',
    displayName:          'Mini-Raketen',
    cooldown:             75,
    damage:               2,
    range:                700,
    fire: {
      type:                 'projectile',
      projectileSpeed:      550,
      projectileSize:       8,
      projectileMaxBounces: 0,
      limitRangeToCursor:   false,
      impactExplosion: {
        radius:          65,
        maxDamage:       3,
        minDamage:       1,
        knockback:       320,
        selfDamageMult:  1,
        rockDamageMult:  1,
        trainDamageMult: 1,
        color:           0xffb36b,
        visualStyle:     'mini_rocket',
      } satisfies ProjectileExplosionConfig,
      homing: {
        acquireDelayMs:        100,
        searchRadius:          300,
        retargetIntervalMs:    50,
        maxTurnDegreesPerStep: 18,
        targetTypes:           ['players'],
        requireLineOfSight:    true,
        excludeOwner:          true,
        distanceWeight:        1,
        forwardWeight:         1,
      } satisfies ProjectileHomingConfig,
    },
    allowedSlots:         ['weapon2'],
    adrenalinCost:        8,
    adrenalinGain:        0,
    spreadStanding:       5,
    spreadMoving:         9,
    spreadPerShot:        1.2,
    maxDynamicSpread:     12,
    spreadRecoveryDelay:  180,
    spreadRecoveryRate:   3,
    spreadRecoverySpeed:  100,
    projectileStyle:      'rocket' as ProjectileStyle,
    projectileColor:      0xf0c98a,
    rocketSmokeTrailColor: COLORS.GREY_2,    
    trainDamageMult:      1,
    shotRecoilForce:      180,
    shotRecoilDuration:   110,
    shotScreenShake:      { duration: 70, intensity: 0.0015 },
    shotAudio: {
      successKey: 'shot_minirocketlauncher',
      failureKey: 'shot_dry_trigger',
    },    
  } as WeaponConfig,

  SPOREN: {
    id:                   'SPOREN',
    displayName:          'Sporen',
    cooldown:             1250,
    damage:               3,
    range:                350,
    fire: {
      type:                 'projectile',
      projectileSpeed:      280,
      projectileSize:       10,
      projectileMaxBounces: 0,
      impactCloud: {
        radius:          32,
        duration:        1500,
        damagePerTick:   4,
        tickInterval:    150,
        rockDamageMult:  1,
        trainDamageMult: 1,
        visualVariant:   'spore',
      } satisfies ImpactCloudConfig,
      homing: {
        acquireDelayMs:        80,
        searchRadius:          320,
        retargetIntervalMs:    40,
        maxTurnDegreesPerStep: 20,
        targetTypes:           ['players'],
        requireLineOfSight:    true,
        excludeOwner:          true,
        distanceWeight:        1,
        forwardWeight:         0.5,
      } satisfies ProjectileHomingConfig,
    },
    allowedSlots:         [],
    adrenalinCost:        0,
    adrenalinGain:        0,
    spreadStanding:       0,
    spreadMoving:         0,
    spreadPerShot:        0,
    maxDynamicSpread:     0,
    spreadRecoveryDelay:  0,
    spreadRecoveryRate:   0,
    spreadRecoverySpeed:  100,
    projectileStyle:      'spore' as ProjectileStyle,
    projectileColor:      0xe7f28b,
    showCrosshair:        false,
    rockDamageMult:       1,
    trainDamageMult:      1,
    shotAudio: {
      successKey: 'shot_spore',
      failureKey: 'shot_dry_trigger',
    },        
  } as WeaponConfig,

  /**
   * AWP – Scharfschützengewehr (Weapon2-Slot)
   * Extrem hoher Schaden, geringe Feuerrate, kein Spread im Stand.
   * Beim Halten des Feuerknopfs: Bewegungsgeschwindigkeit halbiert.
   * Bei jedem Schuss: Rückstoß + Kamera-Shake beim Schützen.
   * Projektil-Stil 'awp': sichtbarer Rauchstreifen hinter dem Geschoss.
   */
  AWP: {
    id:                   'AWP',
    displayName:          'AWP',
    cooldown:             800,
    damage:               100,
    range:                1800,
    fire: {
      type:                 'projectile',
      projectileSpeed:      3500,
      projectileSize:       4,
      projectileMaxBounces: 1,
    },
    allowedSlots:         ['weapon2'],
    adrenalinCost:        40,
    adrenalinGain:        0,
    spreadStanding:       0,
    spreadMoving:         35,
    spreadPerShot:        5,
    maxDynamicSpread:     35,
    spreadRecoveryDelay:  0,
    spreadRecoveryRate:   10,
    spreadRecoverySpeed:  100,
    projectileStyle:      'awp' as ProjectileStyle,
    bulletVisualPreset:   'awp' as BulletVisualPreset,
    holdSpeedFactor:      0.5,
    shotRecoilForce:      750,         // px/s Anfangsimpuls (Quad-Ease-Out über shotRecoilDuration)
    shotRecoilDuration:   200,         // ms – Rückstoß hält 200ms an → deutlich sichtbar
    shotScreenShake:      { duration: 120, intensity: 0.006 },
    rockDamageMult:       1.0,
    tracerConfig: {
      widthCore:  2,
      widthGlow:  6,
      alphaCore:  0.95,
      alphaGlow:  0.45,
      segments:   6,
      fadeMs:     750,
      colorCore:  0xffffff,   // weißer Kern
      // colorGlow:  0xffdd66,   // gelb-goldener Halo
    } satisfies TracerConfig,
    scopeConfig: {
      scopeInMs:           1200,  // 1,5s bis voller Scope
      fullScopeViewRadius: 48,    // px sichtbarer Radius bei vollem Scope
      edgeSoftnessPx:      90,    // weicher Übergang am Rand
      unscopedSpreadDeg:   50,    // sehr ungenau ohne Scope
      unscopeSpeedMs:      250,   // schnelles Entscopen nach Schuss
    },
    shotAudio: {
      successKey: 'shot_awp',
      failureKey: 'shot_dry_trigger',
    },          
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
    damage:               2,           // reduzierter Direkttreffer; Burn trägt den Rest
    range:                250,         // px maximale Flammenreichweite
    fire: {
      type:               'flamethrower',
      projectileSpeed:    400,         // px/s Anfangsgeschwindigkeit
      hitboxStartSize:    14,           // px Startgröße
      hitboxEndSize:      120,          // px Maximalgröße
      hitboxGrowRate:     60,          // px/s Wachstum
      velocityDecay:      0.82,        // 95% der Geschwindigkeit verbleiben pro Sekunde → ~750 px Reichweite
      burnDurationMs:     2000,
      burnDamagePerTick:  0.25,
      burnTickIntervalMs: 250,
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
    trainDamageMult:      1,        // 100% Schaden am Zug
    shotAudio: {
      successKey: 'shot_flame',
      failureKey: 'shot_dry_trigger',
    },      
  } as WeaponConfig,

  TESLA_DOME: {
    id:                   'TESLA_DOME',
    displayName:          'Tesla-Kuppel',
    cooldown:             0,
    damage:               0,
    range:                0,
    fire: {
      type:                     'tesla_dome',
      radius:                   190,
      damagePerTick:            7,
      tickInterval:             180,
      adrenalineDrainPerSecond: 16,
      movementSlowFactor:       0.3,
      requireLineOfSight:       true,
      targetTypes:              ['players', 'train', 'turrets'] satisfies readonly TeslaDomeTargetType[],
      visualIndicatorAlpha:     0.08,
      visualFieldAlpha:         0.16,
      visualIdleArcCount:       4,
      visualIdleArcLength:      72,
      visualBoltThicknessMin:   0.9,
      visualBoltThicknessMax:   2.4,
      visualJitter:             11,
      visualBranchChance:       0.24,
      visualCoreParticleFrequency: 9,
      visualFieldParticleFrequency: 5,
      visualRimParticleFrequency: 4,
      visualImpactBurstScale:   0.95,
      visualWhiteness:          0.62,
      visualPulseSpeed:         0.0034,
    } satisfies TeslaDomeWeaponFireConfig,
    allowedSlots:         ['weapon2'],
    adrenalinCost:        0,
    adrenalinGain:        0,
    spreadStanding:       0,
    spreadMoving:         0,
    spreadPerShot:        0,
    maxDynamicSpread:     0,
    spreadRecoveryDelay:  0,
    spreadRecoveryRate:   0,
    spreadRecoverySpeed:  100,
    projectileColor:      0x9ae7ff,
    showCrosshair:        false,
    rockDamageMult:       0.55,
    trainDamageMult:      0.8,
  } as WeaponConfig,

  ENERGY_SHIELD: {
    id:                   'ENERGY_SHIELD',
    displayName:          'Energie-Schild',
    cooldown:             0,
    damage:               0,
    range:                0,
    fire: {
      type:                     'energy_shield',
      blockArcDegrees:          120,
      anchorDistance:           2,
      visualRadius:             18,
      visualThickness:          5,
      adrenalineDrainPerSecond: 50,
      movementSlowFactor:       0.1,
      flashDurationMs:          140,
      flashMaxAlpha:            1,
      buffMax:                  100,
      buffGainFactor:           2,
      buffDecayDelayMs:         2000,
      buffDecayPerSecond:       5,
      buffMaxBonus:             2,
      blockableCategories:      ['projectile', 'hitscan', 'melee', 'explosion', 'tesla'] satisfies readonly ShieldBlockCategory[],
      visualInnerAlpha:         0.56,
      visualOuterAlpha:         0.96,
    } satisfies EnergyShieldWeaponFireConfig,
    allowedSlots:         ['weapon2'],
    adrenalinCost:        0,
    adrenalinGain:        0,
    spreadStanding:       0,
    spreadMoving:         0,
    spreadPerShot:        0,
    maxDynamicSpread:     0,
    spreadRecoveryDelay:  0,
    spreadRecoveryRate:   0,
    spreadRecoverySpeed:  100,
    showCrosshair:        false,
  } as WeaponConfig,

  /**
   * NEGEV – Maschinengewehr mit inverser Spread-Mechanik (Weapon2-Slot)
   * Hoher Basis-Spread, wird durch Dauerfeuer präziser (negativer dynamischer Spread).
   * Bei Feuerpause geht die Genauigkeit schnell verloren.
   */
  NEGEV: {
    id:                   'NEGEV',
    displayName:          'Negev',
    cooldown:             60,
    damage:               5,
    range:                850,        
    fire: {
      type:                 'projectile',
      projectileSpeed:      1200,
      projectileSize:       2,
      projectileMaxBounces: 3,
    },
    allowedSlots:         ['weapon2'],
    adrenalinCost:        1,
    adrenalinGain:        0,
    spreadStanding:       35,         // hohe Basis-Ungenauigkeit
    spreadMoving:         43,         // noch ungenauer in Bewegung
    spreadPerShot:        -1,         // Dauerfeuer reduziert Spread (inverse Bloom)
    maxDynamicSpread:     -33,        // maximale Genauigkeitsverbesserung (→ Stand-Total = 5°)
    spreadRecoveryDelay:  100,        // schneller Genauigkeitsverlust nach Feuerpause
    spreadRecoveryRate:   15,         // schnelle Rückkehr zu voller Ungenauigkeit
    spreadRecoverySpeed:  100,
    projectileStyle:      'bullet' as ProjectileStyle,
    holdSpeedFactor:      0.3,
    projectileColor:      0xc79c4f,
    bulletVisualPreset:   'negev' as BulletVisualPreset,
    shotScreenShake:      { duration: 60, intensity: 0.002 },    
    tracerConfig: {
      widthCore:  1,
      widthGlow:  4,
      alphaCore:  0.45,
      alphaGlow:  0.15,
      segments:   4,
      fadeMs:     160,
      // maxLength:  80,   // nur letzten 80 px sichtbar (Schnellfeuer-Trail, kein Spawn-Schweif)
      // colorCore/colorGlow nicht gesetzt → Spielerfarbe wird verwendet
    } satisfies TracerConfig,
    shotAudio: {
      successKey: 'shot_negev',
      failureKey: 'shot_dry_trigger',
    },         
  } as WeaponConfig,

} as const;

export const UTILITY_CONFIGS = {
  HE_GRENADE: {
    id:              'HE_GRENADE',
    displayName:     'HE Granate',
    type:            'explosive',
    cooldown:        3000,
    activation:      STANDARD_GRENADE_CHARGE,
    projectileSpeed: 800,
    projectileSize:  10,
    fuseTime:        1000,
    maxBounces:      3,
    aoeRadius:       120,
    aoeDamage:       60,
    damageFalloff:   { minDamage: 10 } satisfies RadialDamageFalloffConfig,
    allowedSlots:    ['utility'],
    projectileStyle: 'grenade' as ProjectileStyle,
    grenadeVisualPreset: 'he' as GrenadeVisualPreset,
    projectileColor: 0x6f8151,
    frictionDelayMs:           300,
    airFrictionDecayPerSec:    0.3,
    bounceFrictionMultiplier:  0.7,
    stopSpeedThreshold:        20,
    shotAudio: {
      successKey: 'shot_throw',
      failureKey: 'shot_dry_trigger',
    },         
  } as UtilityConfig,

  SMOKE_GRENADE: {
    id:                     'SMOKE_GRENADE',
    displayName:            'Smoke Granate',
    type:                   'smoke',
    cooldown:               6000,
    activation:             STANDARD_GRENADE_CHARGE,
    projectileSpeed:        800,
    projectileSize:         10,
    fuseTime:               1000,
    maxBounces:             3,
    smokeRadius:            240,
    smokeExpandDuration:    500,
    smokeLingerDuration:    9000,
    smokeDissipateDuration: 2000,
    smokeMaxAlpha:          0.95,
    allowedSlots:           ['utility'],
    projectileStyle:        'grenade' as ProjectileStyle,
    grenadeVisualPreset:    'smoke' as GrenadeVisualPreset,
    projectileColor:        0x6a7680,
    frictionDelayMs:           300,
    airFrictionDecayPerSec:    0.3,
    bounceFrictionMultiplier:  0.7,
    stopSpeedThreshold:        20,    
    shotAudio: {
      successKey: 'shot_throw',
      failureKey: 'shot_dry_trigger',
    },     
  } as UtilityConfig,

  MOLOTOV_GRENADE: {
    id:                 'MOLOTOV_GRENADE',
    displayName:        'Molotov',
    type:               'molotov',
    cooldown:           5000,
    activation:         STANDARD_GRENADE_CHARGE,
    projectileSpeed:    800,
    projectileSize:     10,
    fuseTime:           1000,
    maxBounces:         3,
    fireRadius:         160,
    fireDamagePerTick:  4,
    fireTickInterval:   250,
    fireLingerDuration: 4000,
    fireBurnDurationMs:     2000,  // Burn-Stack hält 1,5 s pro Tick
    fireBurnDamagePerTick:  0.25,  // Gleicher Wert wie Flammenwerfer
    fireBurnTickIntervalMs: 250,   // Gleicher Takt wie Flammenwerfer
    rockDamageMult:     0,  // Molotov macht keinen Schaden an Felsen
    allowedSlots:       ['utility'],
    projectileStyle:    'grenade' as ProjectileStyle,
    grenadeVisualPreset:'molotov' as GrenadeVisualPreset,
    projectileColor:    0x8a4a20,
    frictionDelayMs:           300,
    airFrictionDecayPerSec:    0.3,
    bounceFrictionMultiplier:  0.7,
    stopSpeedThreshold:        20,    
    shotAudio: {
      successKey: 'shot_throw',
      failureKey: 'shot_dry_trigger',
    },     
  } as UtilityConfig,

  HOLY_HAND_GRENADE: {
    id:              'HOLY_HAND_GRENADE',
    displayName:     'Heilige Handgranate',
    type:            'explosive',
    allowTeamDamage: true,
    cooldown:        0,             // Ammo-basiert (Einzelschuss), kein Cooldown
    activation:      STANDARD_GRENADE_CHARGE,
    projectileSpeed: 900,
    projectileSize:  14,
    fuseTime:        3000,          // 3 Sekunden Zünder
    maxBounces:      10,             // bleibt liegen
    aoeRadius:       400,           // riesiger Radius
    aoeDamage:       250,           // massiver Schaden
    damageFalloff:   { minDamage: 50 } satisfies RadialDamageFalloffConfig,
    allowedSlots:         [],            // NICHT im Loadout-Menü wählbar
    projectileStyle:      'holy_grenade' as ProjectileStyle,
    projectileColor:      0xd9b13b,
    trainDamageMult:      1.0,           // 100% Schaden am Zug
    explosionVisualStyle: 'holy',        // goldene Explosion + Kamera-Shake
    skipCooldownPublish:  true,          // kein Cooldown-Publish (Ammo-basiert, Rollback stellt alten CD her)
    frictionDelayMs:           300,
    airFrictionDecayPerSec:    0.3,
    bounceFrictionMultiplier:  0.7,
    stopSpeedThreshold:        20,    
    shotAudio: {
      successKey: 'shot_hallelujah',
      failureKey: 'shot_dry_trigger',
    },     
  } as UtilityConfig,

  BFG: {
    id:                  'BFG',
    displayName:         'BFG',
    type:                'bfg',
    allowTeamDamage:     true,
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
    shotAudio: {
      successKey: 'shot_bfg',
      failureKey: 'shot_dry_trigger',
    },       
  } as UtilityConfig,

  NUKE: {
    id:                  'NUKE',
    displayName:         'Atombombe',
    type:                'nuke',
    allowTeamDamage:     true,
    cooldown:            0,             // Ammo-basiert (Einzelschuss), kein Cooldown
    activation:          { type: 'targeted_click' } as TargetedClickUtilityActivationConfig,
    projectileSpeed:     0,
    projectileSize:      0,
    fuseTime:            0,
    maxBounces:          0,
    allowedSlots:        [],            // NICHT im Loadout-Menü wählbar
    skipCooldownPublish: true,          // kein Cooldown-Publish (Ammo-basiert, Rollback stellt alten CD her)
  } as UtilityConfig,

  STINKDRUESEN: {
    id:                  'STINKDRUESEN',
    displayName:         'Stinkdrüsen',
    type:                'stinkcloud',
    cooldown:            8000,
    activation:          { type: 'instant' } as InstantUtilityActivationConfig,
    projectileSpeed:     0,             // Kein Projektil – Sofortaktivierung
    projectileSize:      0,
    fuseTime:            0,
    maxBounces:          0,
    cloudRadius:         180,           // px – Schadensradius
    cloudDuration:       4000,          // ms – Dauer der Gaswolke
    cloudDamagePerTick:  3,             // HP Schaden pro Tick
    cloudTickInterval:   250,           // ms zwischen Damage-Ticks (= 20 DPS)
    rockDamageMult:      0.1,           // 10% Schaden an Felsen
    trainDamageMult:     0.5,           // 50% Schaden am Zug
    allowedSlots:        ['utility'],
  } as UtilityConfig,

  TRANSLOCATOR: {
    id:                   'TRANSLOCATOR',
    displayName:          'Translocator',
    type:                 'translocator',
    cooldown:             3000,
    activation:           STANDARD_GRENADE_CHARGE,
    projectileSpeed:      600, 
    projectileSize:       16,
    fuseTime:             0,         // Kein auto-explode
    maxBounces:           3, 
    allowedSlots:         ['utility'],
    frictionDelayMs:           300,
    airFrictionDecayPerSec:    0.15,
    bounceFrictionMultiplier:  0.3,
    stopSpeedThreshold:        15,
    projectileStyle:      'translocator_puck' as ProjectileStyle,
    projectileColor:      COLORS.GREY_3,
    skipCooldownPublish:  true,      // Cooldown wird vom TranslocatorSystem gesetzt (beim Teleport), nicht beim Wurf.
    shotAudio: {
      successKey: 'shot_throw',
      failureKey: 'shot_dry_trigger',
    },      
  } as TranslocatorUtilityConfig,

  FELSBAU: {
    id:                  'FELSBAU',
    displayName:         'Felsbau',
    type:                'placeable_rock',
    cooldown:            1000,
    activation:          { type: 'placement_mode' } as PlacementModeUtilityActivationConfig,
    projectileSpeed:     0,
    projectileSize:      0,
    fuseTime:            0,
    maxBounces:          0,
    allowedSlots:        ['utility'],
    placeable: {
      kind:               'rock',
      range:              160,
      footprint:          [{ dx: 0, dy: 0 }] as const,
      maxHp:              200,
      lifetimeMs:         60000,
      previewAlpha:       0.5,
      ownerTintStrength:  0.85,
      warningPulseMs:     3500,
      spawnShakeDuration: 110,
      spawnShakeIntensity: 0.0025,
    },
  } as PlaceableRockUtilityConfig,

  FLIEGENPILZ: {
    id:                  'FLIEGENPILZ',
    displayName:         'Fliegenpilz',
    type:                'placeable_turret',
    cooldown:            10000,
    activation:          { type: 'placement_mode' } as PlacementModeUtilityActivationConfig,
    projectileSpeed:     0,
    projectileSize:      0,
    fuseTime:            0,
    maxBounces:          0,
    allowedSlots:        ['utility'],
    weaponId:            'SPOREN',
    placeable: {
      kind:               'turret',
      range:              240,
      footprint:          [{ dx: 0, dy: 0 }] as const,
      maxHp:              50,
      lifetimeMs:         10000,
      previewAlpha:       0.55,
      ownerTintStrength:  0.72,
      warningPulseMs:     3500,
      spawnShakeDuration: 120,
      spawnShakeIntensity: 0.0028,
      targetRange:        280,
      muzzleOffset:       26,
      deathCloudRadius:   64,
    },
  } as PlaceableTurretUtilityConfig,

  ZEUS_TASER: {
    id:              'ZEUS_TASER',
    displayName:     'Zeus',
    type:            'taser',
    cooldown:        4000,
    activation:      { type: 'instant' } as InstantUtilityActivationConfig,
    damage:          200,
    range:           80,
    hitArcDegrees:   70,
    visualPreset:    'zeus_taser' satisfies MeleeVisualPreset,
    allowedSlots:    ['utility'],
    projectileSpeed: 0,
    projectileSize:  0,
    fuseTime:        0,
    maxBounces:      0,
    trainDamageMult: 1.0,
    rockDamageMult:  0,
    shotAudio: {
      successKey: 'shot_zeus',
      failureKey: 'shot_dry_trigger',
    },            
  } as TaserUtilityConfig,

  DECOY: {
    id:                        'DECOY',
    displayName:               'Decoy',
    type:                      'decoy',
    cooldown:                  12000,
    activation:                { type: 'instant' } as InstantUtilityActivationConfig,
    projectileSpeed:           0,
    projectileSize:            0,
    fuseTime:                  0,
    maxBounces:                0,
    allowedSlots:              ['utility'],
    decoyLifetimeMs:           6000,
    stealthDurationMs:         6000,
    stealthAlphaMin:           0.1,
    stealthAlphaMax:           0.17,
    stealthGlowOuterStrength:  1.2,
    wobblePeriodMs:            2400,
    dissipateDustBurst:        18,
    skipCooldownPublish:       true,
  } as DecoyUtilityConfig,
} as const;

export const ULTIMATE_CONFIGS = {
  /**
   * ARMAGEDDON – Inspiriert vom Druiden-Skill aus Diablo 2.
   * Spawnt ~70 Meteore über 7 Sekunden im Radius um den Spieler.
   * Jeder Meteor zeigt einen Warnkreis, fällt dann herab und macht AoE-Schaden.
   */
  ARMAGEDDON: {
    type:               'buff',
    id:                 'ARMAGEDDON',
    displayName:        'Armageddon',
    cooldown:           0,
    rageRequired:       300,
    duration:           7000,
    speedMultiplier:    1.0,
    damageMultiplier:   1.0,
    armorPerTick:       0,
    armorTickIntervalMs: 200,
    rageDrainDuration:  7000,
    armageddon: {
      meteorSpawnRadius:  350,    // px um den Spieler
      meteorDamageRadius: 64,     // px AoE bei Einschlag (~1.5 Tiles)
      meteorDamage:       60,     // HP pro Meteor
      meteorDamageFalloff: { minDamage: 40 } satisfies RadialDamageFalloffConfig,
      meteorFallDuration: 1200,   // ms Vorwarnung
      meteorsPerSecond:   10,     // ~70 Meteore in 7 Sekunden
      meteorRadiusJitter: 0.1,    // ±10% Radius-Zufallsabweichung
      selfDamageMult:     0,      // Caster immun
      rockDamageMult:     0.5,
      trainDamageMult:    0.5,
    },
  } as BuffUltimateConfig,

  GAUSS_RIFLE: {
    type:               'gauss',
    id:                 'GAUSS_RIFLE',
    displayName:        'Gauss-Gewehr',
    cooldown:           0,
    rageRequired:       200,
    rageCost:           200,
    chargeDuration:     1500,
    chargeColor:        0x78d6ff,
    movementSlowFactor: 0.72,
    projectileSpeed:    1500,
    projectileSize:     16,
    projectileColor:    0xc8f6ff,
    bulletVisualPreset: 'gauss',
    tracerConfig: {
      widthCore:  8,
      widthGlow:  22,
      alphaCore:  0.96,
      alphaGlow:  0.72,
      segments:   12,
      fadeMs:     1400,
      maxLength:  340,
      colorCore:  0xf4ffff,
      colorGlow:  0x59c7ff,
    } satisfies TracerConfig,
    damage:             100,
    range:              1800,
    rockDamageMult:     2,
    trainDamageMult:    1,
    shotRecoilForce:    750,
    shotRecoilDuration: 200,
    shotAudio: {
      successKey: 'shot_gauss',
      failureKey: 'shot_dry_trigger',
    },
  } as GaussUltimateConfig,

  AIRSTRIKE: {
    type:               'airstrike',
    id:                 'AIRSTRIKE',
    displayName:        'Luftangriff',
    cooldown:           0,        // rage-gated, kein Zeitcooldown
    rageRequired:       200,      // Mindest-Rage zum Betreten des Zielmodus
    rageCost:           200,      // Rage-Kosten pro Einschlag
    delayMs:            2000,     // 2 Sek. Verzögerung vor Explosion
    radius:             150,      // px – AoE-Radius (größer als Armageddon-Meteor)
    maxDamage:          350,      // Schaden im Zentrum
    minDamage:          60,       // Schaden am Rand
    allowTeamDamage:    true,
    selfDamageMult:     0,        // Auslöser immun
    rockDamageMult:     0.5,
    trainDamageMult:    1.0,
  } as AirstrikeUltimateConfig,

  HONEY_BADGER_RAGE: {
    type:               'buff',
    id:                 'HONEY_BADGER_RAGE',
    displayName:        'Honigdachs-Wut',
    cooldown:           0,          // rage-gated, kein Zeitcooldown
    rageRequired:       300,
    duration:           6000,
    speedMultiplier:    1.5,
    damageMultiplier:   1.5,
    armorPerTick:       5,
    armorTickIntervalMs: 300,
    rageDrainDuration:  6000,
    aura: {
      radius:          128,
      damagePerTick:   20,
      tickIntervalMs:  500,
    },
  } as BuffUltimateConfig,

  DACHS_TUNNEL: {
    type:               'tunnel',
    id:                 'DACHS_TUNNEL',
    displayName:        'Dachstunnel',
    cooldown:           0,
    rageRequired:       200,
    rageCost:           200,
    allowedModes:       CAPTURE_THE_BEER_ONLY,
    activation:         { type: 'placement_mode' } as PlacementModeUltimateActivationConfig,
    placement: {
      kind:               'tunnel',
      range:              760,
      entranceRadius:     22,
      previewAlpha:       0.38,
      ownerTintStrength:  0.45,
      spawnShakeDuration: 150,
      spawnShakeIntensity: 0.0035,      
    } as PlaceableTunnelPlacementConfig,
    travelSpeed:         2400,
    travelMinDurationMs: 220,
    travelMaxDurationMs: 720,
    buildLabel:          'Dachstunnel',
  } as TunnelUltimateConfig,
} as const;

// ── Standard-Loadout für alle Spieler beim Spawn ──────────────────────────────

export const DEFAULT_LOADOUT = {
  weapon1:  WEAPON_CONFIGS.GLOCK,
  weapon2:  WEAPON_CONFIGS.P90,
  utility:  UTILITY_CONFIGS.HE_GRENADE,
  ultimate: ULTIMATE_CONFIGS.ARMAGEDDON,
} as const;
