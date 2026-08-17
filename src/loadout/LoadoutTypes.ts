import type { DamageZoneVisualStyle, EnergyInjectorConstructionEffect, GroundFireVisualStyle } from '../types';
import type { BulletVisualPreset, BurnOnHitConfig, ChainLightningConfig, DamageOverTimeAreaConfig, FireChunkBurstConfig, GameMode, GrenadeVisualPreset, HitscanSupportEffect, HitscanVisualPreset, ImpactCloudConfig, LoadoutSlot, DetonableConfig, DetonatorConfig, EnergyBallVariant, ExplosionVisualStyle, LoadoutShotAudioConfig, MeleeDamageTarget, MeleeVisualPreset, PlaceableFootprintCell, ProjectileExplosionConfig, ProjectileHomingConfig, ProjectileProximityPulseConfig, ProjectileStyle, RadialDamageFalloffConfig, ShieldBlockCategory, TeslaDomeTargetType, TracerConfig } from '../types';

// ── Item-Konfigurationstypen ──────────────────────────────────────────────────

export interface ProjectileWeaponFireConfig {
  readonly type: 'projectile';
  readonly projectileSpeed: number;     // px/s
  readonly projectileSize: number;      // px (quadratisch)
  readonly projectileMaxBounces: number;
  readonly limitRangeToCursor?: boolean; // true = Reichweite dieses Schusses auf Cursor-Distanz begrenzen
  readonly impactExplosion?: ProjectileExplosionConfig;
  // Explosion, die NUR bei Treffern auf Gegner/Spieler ausgelöst wird (nicht an Wänden/am Lebensende).
  readonly enemyHitExplosion?: ProjectileExplosionConfig;
  readonly impactCloud?: ImpactCloudConfig;
  readonly homing?: ProjectileHomingConfig;
}

/** Turm-spezifische Salve: weitere Projektile werden mit kurzem Abstand gestartet. */
export interface TurretBurstConfig {
  readonly count: number;
  readonly intervalMs: number;
}

export interface HitscanWeaponFireConfig {
  readonly type: 'hitscan';
  readonly traceThickness: number;      // px - für spätere Ray-/Sweep-Checks
  readonly visualPreset?: HitscanVisualPreset;
  readonly supportEffect?: HitscanSupportEffect;
}

export interface MeleeWeaponFireConfig {
  readonly type: 'melee';
  readonly hitArcDegrees: number;       // Öffnungswinkel vor dem Spieler
  readonly visualPreset?: MeleeVisualPreset;
  readonly damageTargets?: readonly MeleeDamageTarget[];
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
  readonly piercingCount?: number;      // > 0 = Projektil trifft mehrere Ziele (kein Mehrfachtreffer)
  readonly kamikaze?: {
    readonly enabled: number;
    readonly inheritMolotovBonuses: number;
  };
  readonly burningGround?: {
    readonly cellSize: number;
    readonly durationMs: number;
    readonly igniteProjectiles: number;
    readonly createOnFlameExpiry: number;
  };
  readonly fireRing?: {
    readonly radius: number;
    readonly thickness: number;
    readonly igniteProjectiles: number;
  };
  readonly fireball?: {
    readonly enabled: number;
    readonly projectileSpeed: number;
    readonly projectileSize: number;
    readonly explosionRadius: number;
    readonly explosionMaxDamage: number;
    readonly explosionMinDamage: number;
    readonly explosionKnockback: number;
    readonly selfDamageMult: number;
    readonly trailEnabled: number;
    readonly chunkCount: number;
    readonly chunkSearchRadius: number;
    readonly chunkFlightMs: number;
    readonly groundDurationMs: number;
    readonly groundBurnDamagePerTick: number;
  };
}

export interface LeafBlowerWeaponFireConfig {
  readonly type: 'leaf_blower';
  readonly projectileSpeed: number;     // px/s – Anfangsgeschwindigkeit der Luft-Hitbox
  readonly hitboxStartSize: number;     // px – Startgröße der Hitbox
  readonly hitboxEndSize: number;       // px – Maximalgröße nach Wachstum
  readonly hitboxGrowRate: number;      // px/s – Wachstumsrate der Hitbox
  readonly velocityDecay: number;       // Geschwindigkeits-Faktor pro Sekunde (0-1)
  readonly minKnockback: number;        // px/s – spätester, schwächster Push
  readonly maxKnockback: number;        // px/s – stärkster Nahbereichs-Push
  readonly selfPush: number;            // px/s – additiver Rückschub für den Schützen während Dauerfeuer
  readonly deflectProjectiles: number;  // >0: gegnerische Projektile werden vom Luftstoß übernommen und zurückgeschleudert
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
  readonly chargeIntervalMs?: number;
  readonly maxChargeStacks?: number;
  readonly radiusBonusPerCharge?: number;
  readonly damageBonusPerCharge?: number;
}

export interface HealingAuraWeaponFireConfig {
  readonly type: 'healing_aura';
  readonly radius: number;
  readonly healPerTick: number;
  readonly tickInterval: number;
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
  readonly reflectionDamageFactor?: number;
  // Kuppel-Erweiterungen (0 = deaktiviert, hält den gerichteten Basis-Schild unverändert)
  readonly domeEnabled: number;            // >0: 360°-Kuppel statt gerichtetem Bogen (Boss a1)
  readonly domeRadius: number;             // Radius der Kuppel in px (d1 skaliert)
  readonly domeHealPerSecond: number;      // HP/s Heilung für Ziele in der Kuppel (a2)
  readonly domeToggleEnabled: number;      // >0: Rechtsklick toggelt die Kuppel statt Halten (Boss c)
  readonly domeReflectProjectiles: number; // >0: gegnerische Projektile prallen an der Kuppel ab (Boss d2)
}

/**
 * Klassenfaehigkeit des Inspectors auf Waffe 2: schleudert eine Matrix auf eine Zielposition
 * und schuetzt dort Verbündete, waehrend Gegner verwundbar werden.
 */
export interface ReinforcementMatrixWeaponFireConfig {
  readonly type: 'reinforcement_matrix';
  readonly projectileSpeed: number;
  readonly projectileSize: number;
  readonly radius: number;
  readonly durationMs: number;
  readonly damageReduction: number;
  readonly vulnerabilityBonus: number;
  readonly fieldColor: number;
}

/**
 * Klassenfaehigkeit des Inspectors auf Waffe 2: praezise Energiebolzen ohne Lenkwirkung.
 * Konstrukte erhalten eine typisierte Funktionsverstaerkung; Gegner werden verwundbar und
 * fuer freundliche Tuerme fokussiert. Folgekontakte erneuern den Einzelzielstatus.
 */
export interface EnergyInjectorWeaponFireConfig {
  readonly type: 'energy_injector';
  readonly projectileSpeed: number;
  readonly projectileSize: number;
  readonly durationMs: number;
  readonly vulnerabilityBonus: number;
  readonly focusDurationMs: number;
  readonly injectorColor: number;
}

/** @deprecated Technischer Alias fuer alte gespeicherte Loadout-Daten. */

export type WeaponFireConfig =
  | ProjectileWeaponFireConfig
  | HitscanWeaponFireConfig
  | MeleeWeaponFireConfig
  | FlamethrowerWeaponFireConfig
  | LeafBlowerWeaponFireConfig
  | TeslaDomeWeaponFireConfig
  | HealingAuraWeaponFireConfig
  | EnergyShieldWeaponFireConfig
  | ReinforcementMatrixWeaponFireConfig
  | EnergyInjectorWeaponFireConfig;

export interface WeaponConfigShape {
  readonly id: string;
  readonly cooldown: number;            // ms zwischen zwei Schüssen
  readonly damage: number;              // HP-Schaden pro Direkttreffer
  readonly range: number;               // px – Lifetime = range/speed*1000 ms
  readonly fire: WeaponFireConfig;
  /** Optionaler Burst für automatisierte Türme; normale Spielerwaffen ignorieren ihn. */
  readonly turretBurst?: TurretBurstConfig;

  readonly allowedSlots: readonly LoadoutSlot[]; // Slots, in die diese Waffe eingesetzt werden darf
  /** Optionaler Modusfilter; fehlt er, ist die Waffe in allen Spielmodi erlaubt. */
  readonly allowedModes?: readonly GameMode[];

  // Ressourcen
  readonly adrenalinCost: number;       // Adrenalin-Kosten pro Schuss
  readonly adrenalinGain: number;       // Adrenalin-Gewinn bei Treffer
  readonly damageReduction?: number;    // eingehender Schaden wird bei ausgeruesteter Waffe reduziert
  readonly hitKnockback?: number;       // gerichteter Rueckstoss bei einem direkten Projektiltreffer
  readonly hitKnockbackDurationMs?: number;

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
  readonly pelletCountMultiplier?: number;

  // Schrotflinten-Spezialisierung (optional; 0 = jeweiliger Effekt deaktiviert)
  readonly shotgunSlowFraction?: number;
  readonly shotgunSlowDurationMs?: number;
  readonly shotgunProximityMaxDamageBonus?: number;
  readonly shotgunLightningRadius?: number;
  readonly shotgunLightningDamage?: number;
  readonly shotgunLightningAppliesSlow?: number;
  readonly shotgunChainEnabled?: number;
  readonly shotgunChainDamageRetention?: number;
  readonly shotgunChainRadiusRetention?: number;
  readonly hitSlowFraction?: number;
  readonly hitSlowDurationMs?: number;
  /** Verwundbarkeitsdauer, die ein Direkttreffer auf dem Ziel setzt (0/undefined = keine). */
  readonly hitVulnerabilityDurationMs?: number;
  /**
   * Trefferchance pro Schuss, mit der die Treffer-Debuffs (`hitSlow*`, `hitVulnerabilityDurationMs`)
   * überhaupt mitgegeben werden. Ungesetzt/0 = Debuffs bleiben aus.
   */
  readonly hitDebuffChance?: number;

  // Hydra-Splitting (optional)
  readonly splitCount?:        number; // Anzahl der beim Bounce neu erzeugten Projektile
  readonly splitSpread?:       number; // Winkelabstand in Grad zwischen benachbarten Split-Bahnen
  readonly splitFactor?:       number; // Multiplikator nach der Grundteilung beim Split (1 = unverändert, 1.5 = stärkere Kinder)
  readonly splitHomingEnabled?: number;
  readonly homingEnabled?: number;
  readonly directDamageOverride?: number;
  readonly killHeal?: number;
  readonly killAdrenaline?: number;
  readonly hitHeal?: number;
  readonly hitAdrenaline?: number;
  readonly bloodEffectMultiplier?: number;
  /** Boss upgrade marker; the hit path resolves stacks and swarm projectiles. */
  readonly plasmaSwarmEnabled?: number;
  readonly plasmaSwarmProjectileCount?: number;
  readonly plasmaSwarmExplosionRadius?: number;
  readonly plasmaSwarmExplosionDamage?: number;
  readonly plasmaSwarmExplosionSlowFraction?: number;
  readonly sideBurstEveryShots?: number;
  readonly sideBurstCount?: number;
  readonly sideBurstAngleDegrees?: number;
  readonly sideBurstDamageFactor?: number;
  readonly penetrationCount?: number;
  readonly penetrationDamageRetention?: number;
  readonly penetratesRocks?: number;
  readonly warmupBurnThreshold?: number;
  readonly awpCharge?: AwpChargeConfig;
  readonly negevKillstreak?: NegevKillstreakConfig;
  readonly multiExplosionCount?: number;
  readonly multiExplosionCoastMs?: number;
  readonly miniRocketReturnEnabled?: number;
  readonly miniRocketReturnRangeBuffer?: number;
  readonly miniRocketPickupRadius?: number;
  readonly miniRocketPickupAdrenalineRefundFraction?: number;
  readonly miniRocketPickupArmor?: number;
  readonly miniRocketSafetyLifetimeMs?: number;
  readonly miniRocketCascadeDamageBonusPerExplosion?: number;
  readonly matchPrimaryRange?: number;
  readonly ak47Focus?: {
    readonly maxStacks: number;
    readonly damagePerStack: number;
    readonly fireSuperiorityShots: number;
    readonly fireControlEnabled: number;
    readonly fireControlSpreadPerStack: number;
    readonly fireControlRangePerStack: number;
    readonly fireControlProjectileSpeedPerStack: number;
    readonly strategicTargetEnabled: number;
    readonly strategicTargetDamageBonus: number;
    readonly targetPrioritizationEnabled: number;
    readonly explosiveTargetAcquisitionLevel: number;
  };
  /** Host-interner Snapshot fuer einen einzelnen AK-47-Schuss. */
  readonly ak47ShotId?: number;
  readonly ak47DamageMultiplier?: number;
  readonly ak47FireSuperiorityShot?: boolean;

  // Visuelles Override
  readonly projectileColor?: number;         // Überschreibt Spielerfarbe für Projektil-Visuals (hex)
  readonly projectileStyle?: ProjectileStyle; // 'bullet' (eckig, Standard) | 'ball' (rund)
  readonly projectileVisualScale?: number;   // optionaler Render-Faktor ohne Einfluss auf Hitbox/Physik
  readonly bulletVisualPreset?: BulletVisualPreset;
  readonly grenadeVisualPreset?: GrenadeVisualPreset;
  readonly energyBallVariant?: EnergyBallVariant;
  readonly projectileBurnVisualStyle?: GroundFireVisualStyle;
  readonly rocketSmokeTrailColor?: number;   // optionales Farb-Override für Raketenrauch, sonst Spielerfarbe

  // Detonations-System
  readonly detonable?:  DetonableConfig;  // Projektile dieser Waffe können gezündet werden
  readonly detonator?:  DetonatorConfig;  // Diese Waffe zündet passende Detonables

  // Kettenblitz (nur Hitscan-Waffen): Strahl springt nach dem Treffer weiter
  readonly chainLightning?: ChainLightningConfig;
  readonly proximityPulse?: ProjectileProximityPulseConfig;

  // Brennende Treffer: setzt getroffene Ziele in Brand (Projektil/Hitscan/Melee).
  // Für Explosions-Brand siehe ProjectileExplosionConfig.burnOnHit.
  readonly burnOnHit?: BurnOnHitConfig;

  // Objekt-Schadens-Multiplikatoren (optional, Default = 1.0 = 100%)
  readonly rockDamageMult?:  number;  // Schadensfaktor gegen Felsen (0 = kein Schaden)
  readonly trainDamageMult?: number;  // Schadensfaktor gegen den Zug (0 = kein Schaden)
  readonly baseDamageMult?: number;   // Schadensfaktor ausschliesslich gegen feindliche Coop-Basen

  // Shot-Feedback-Mechaniken (optional, data-driven)
  readonly holdSpeedFactor?:        number;  // Geschwindigkeits-Multiplikator während Feuerknopf gehalten (z.B. 0.5 = halbiert)
  readonly warmupSpeedMultiplier?:  number;  // Multiplikator für spreadPerShot-Rate (Negev-Aufwärmzeit), Default 1.0
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

export interface AwpChargeConfig {
  /** Zeit bis zum maximalen Schadensbonus; unabhaengig von der Scope-Zielzeit. */
  readonly durationMs: number;
  readonly maxDamageBonus: number;
  readonly fullChargeDamageBonus: number;
  readonly fireTrailDurationMs: number;
  readonly fireTrailBurnDurationMs: number;
  readonly fireTrailBurnDamagePerTick: number;
  readonly fireTrailHalfWidthCells: number;
  readonly corridorEnabled: number;
  readonly corridorHalfWidth: number;
  /** Gesamtschaden der Schneise; wird als kurzer DoT ueber corridorDotDurationMs verteilt. */
  readonly corridorDamage: number;
  /** Laufzeit des Schneisen-DoT – kurz genug, dass der Wegstoss sichtbar bleibt. */
  readonly corridorDotDurationMs: number;
  /** Abstand zweier DoT-Ticks; bestimmt zusammen mit der Laufzeit die Tick-Anzahl. */
  readonly corridorDotTickIntervalMs: number;
  readonly corridorKnockback: number;
  readonly corridorKnockbackDurationMs: number;
}

export interface NegevKillstreakConfig {
  readonly damageBonusPerKill: number;
  readonly healPerKill: number;
  readonly armorPerKill: number;
  readonly explosionEnabled: number;
  readonly explosionDamagePerKill: number;
  readonly explosionBaseRadius: number;
  readonly explosionRadiusPerKill: number;
  readonly explosionBaseKnockback: number;
  readonly explosionKnockbackPerKill: number;
  readonly fireChunkDurationMs: number;
  readonly fireChunkBurnDurationMs: number;
  readonly fireChunkBurnDamagePerTick: number;
}

export type UtilityType = 'explosive' | 'smoke' | 'molotov' | 'time_bubble' | 'bfg' | 'nuke' | 'stinkcloud' | 'translocator' | 'placeable_rock' | 'placeable_turret' | 'placeable_pedestal' | 'taser' | 'decoy';

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
  readonly kind: 'rock' | 'turret' | 'pedestal';
  readonly range: number;
  readonly footprint: readonly PlaceableFootprintCell[];
  readonly maxHp: number;
  readonly lifetimeMs: number;
  readonly previewAlpha: number;
  readonly ownerTintStrength: number;
  readonly warningPulseMs: number;
  readonly spawnShakeDuration: number;
  readonly spawnShakeIntensity: number;
  /** Missions-Podeste werden nicht durch Schaden entfernt. */
  readonly indestructible?: boolean;
}

export interface PlaceableRockPlacementConfig extends PlaceablePlacementConfig {
  readonly kind: 'rock';
  readonly enemyDestroyedExplosionRadius?: number;
  readonly enemyDestroyedExplosionDamage?: number;
  readonly enemyDestroyedExplosionKnockback?: number;
}

export interface PlaceableTurretPlacementConfig extends PlaceablePlacementConfig {
  readonly kind: 'turret';
  readonly targetRange: number;
  readonly muzzleOffset: number;
  readonly deathCloudRadius: number;
  /** Typisierte Verstaerkung des Energieinjektors fuer dieses Geschuetz. */
  readonly energyInjectorEffect?: EnergyInjectorConstructionEffect;
  readonly secondProjectileDamageFactor?: number;
  /** > 0 replaces the turret's spore weapon with the plasma variant (boss upgrade). */
  readonly plasmaWeaponEnabled?: number;
}

export interface PlaceableTunnelPlacementConfig {
  readonly kind: 'tunnel';
  readonly range: number;
  readonly entranceRadius: number;
  readonly previewAlpha: number;
  readonly ownerTintStrength: number;
}

export interface BaseUtilityConfig {
  readonly id: string;
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
  readonly baseDamageMult?: number;   // Schadensfaktor ausschliesslich gegen feindliche Coop-Basen

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
  readonly clusterCount?: number;
  readonly clusterRadiusFactor?: number;
  readonly clusterDamageFactor?: number;
}

export interface SmokeUtilityConfig extends BaseUtilityConfig {
  readonly type: 'smoke';
  readonly smokeRadius: number;             // px
  readonly smokeExpandDuration: number;     // ms
  readonly smokeLingerDuration: number;     // ms
  readonly smokeDissipateDuration: number;  // ms
  readonly smokeMaxAlpha: number;           // 0-1
  readonly smokeDotDamagePerTick: number;   // Schaden pro Tick (0 = deaktiviert; per Upgrade aktiviert)
  readonly smokeDotTickIntervalMs: number;  // ms zwischen Ticks
}

export interface MolotovUtilityConfig extends BaseUtilityConfig {
  readonly type: 'molotov';
  readonly fireRadius: number;          // px – Schadensradius
  readonly fireDamagePerTick: number;   // HP Schaden pro Tick
  readonly fireLingerDuration: number;  // ms wie lange das Feuer brennt
  readonly fireBurnDurationMs?:     number;  // ms – Dauer eines Burn-Stacks pro Tick
  readonly fireBurnDamagePerTick?:  number;  // HP Schaden pro Burn-Tick
  readonly wildfireEnabled?: number;
  readonly wildfirePanicSpeedMultiplier?: number;
  readonly wildfireTrailDurationMs?: number;
  readonly wildfireTrailDamagePerTick?: number;
}

export interface TimeBubbleUtilityConfig extends BaseUtilityConfig {
  readonly type: 'time_bubble';
  readonly bubbleRadius: number;
  readonly bubbleDuration: number;
  readonly projectileSlowFactor: number;
  readonly playerSlowFactor: number;
  readonly trainSlowFactor: number;
  readonly bubbleColor?: number;
  readonly bubbleDistortion?: number;
  readonly friendlyImmunity?: number;
}

export interface BfgUtilityConfig extends BaseUtilityConfig {
  readonly type: 'bfg';
  readonly range: number;          // px – maximale Hauptprojektil-Reichweite
  readonly directDamage: number;    // HP-Schaden bei Direkttreffer
  readonly proximityPulse: ProjectileProximityPulseConfig;
}

export interface NukeUtilityConfig extends BaseUtilityConfig {
  readonly type: 'nuke';
}

export interface StinkCloudUtilityConfig extends BaseUtilityConfig {
  readonly type: 'stinkcloud';
  readonly visualVariant?: DamageZoneVisualStyle;
  readonly cloudRadius: number;          // px – Schadensradius der Gaswolke
  readonly cloudDuration: number;        // ms – Gesamtdauer der Wolke
  readonly cloudDamagePerTick: number;   // HP Schaden pro Tick
  readonly cloudTickInterval: number;    // ms zwischen Damage-Ticks
  readonly continuous?: boolean;
  readonly afterCloudDurationMs?: number;
  readonly afterCloudRadiusFactor?: number;
  readonly afterCloudDamageFactor?: number;
}

export interface TaserUtilityConfig extends BaseUtilityConfig {
  readonly type: 'taser';
  readonly damage: number;
  readonly range: number;
  readonly hitArcDegrees: number;
  readonly visualPreset: MeleeVisualPreset;
  readonly chainCount?: number;
  readonly chainRadius?: number;
  readonly chainDamageFactor?: number;
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
  readonly explosionRadius?: number;
  readonly explosionDamage?: number;
  readonly explosionKnockback?: number;
}

export interface TranslocatorUtilityConfig extends BaseUtilityConfig {
  readonly type: 'translocator';
  readonly telefragRadius?: number;
  readonly telefragDamage?: number;
  readonly telefragKnockback?: number;
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

export interface PlaceablePedestalPlacementConfig extends PlaceablePlacementConfig {
  readonly kind: 'pedestal';
}

/** Einmaliger Missions-Override: setzt genau ein Runtime-PowerUp-Podest. */
export interface PlaceablePedestalUtilityConfig extends BaseUtilityConfig {
  readonly type: 'placeable_pedestal';
  readonly activation: PlacementModeUtilityActivationConfig;
  readonly placeable: PlaceablePedestalPlacementConfig;
  readonly rewardObjectiveId: string;
  readonly powerUpDefId: string;
}

export type PlaceableUtilityConfig = PlaceableRockUtilityConfig | PlaceableTurretUtilityConfig | PlaceablePedestalUtilityConfig;

export type UtilityConfigShape = ExplosiveUtilityConfig | SmokeUtilityConfig | MolotovUtilityConfig | TimeBubbleUtilityConfig | BfgUtilityConfig | NukeUtilityConfig | StinkCloudUtilityConfig | TaserUtilityConfig | DecoyUtilityConfig | TranslocatorUtilityConfig | PlaceableRockUtilityConfig | PlaceableTurretUtilityConfig | PlaceablePedestalUtilityConfig;

const STANDARD_GRENADE_CHARGE = {
  type: 'charged_throw',
  minThrowSpeed: 50,
  fullChargeDuration: 700,
} as const satisfies ChargedThrowUtilityActivationConfig;

export interface ArmageddonMeteorConfig {
  readonly variant?: 'normal' | 'void';
  readonly meteorSpawnRadius: number;   // px – Radius um den Spieler, in dem Meteore spawnen
  readonly meteorDamageRadius: number;  // px – AoE-Schadensradius beim Einschlag
  readonly meteorDamage: number;        // HP-Schaden pro Einschlag
  readonly meteorDamageFalloff?: RadialDamageFalloffConfig;
  readonly meteorFallDuration: number;  // ms – Vorwarnzeit bevor der Meteor einschlägt
  readonly meteorsPerSecond: number;    // Spawn-Rate (leicht zufällig verteilt)
  readonly meteorRadiusJitter: number;   // 0–1 – prozentuale Zufallsabweichung des Radius (0.1 = ±10%)
  readonly selfDamageMult: number;      // Selbstschadens-Multiplikator (0 = immun)
  readonly baseDamageMult?: number;     // Schadensfaktor ausschliesslich gegen feindliche Coop-Basen
  readonly rockDamageMult?: number;     // Schadensfaktor gegen Felsen (Default 1.0)
  readonly trainDamageMult?: number;    // Schadensfaktor gegen den Zug (Default 1.0)
  readonly fireChunkBurst: FireChunkBurstConfig;
  readonly cometStormEnabled: number;
  readonly cometSpawnRateDivisor: number;
  readonly cometFallDurationFactor: number;
  readonly cometRadiusFactor: number;
  readonly cometDamageFactor: number;
  readonly cometChunkCountFactor: number;
}

export interface BuffAuraConfig {
  readonly radius: number;
  readonly damagePerTick: number;
  readonly tickIntervalMs: number;
  /** Schadensfaktor ausschließlich gegen feindliche Coop-Basen. */
  readonly baseDamageMult?: number;
  readonly allySpeedMultiplier?: number;
  readonly allyDamageMultiplier?: number;
  readonly allyArmorPerTick?: number;
  readonly lingerMs?: number;
}

interface BaseUltimateConfig {
  readonly id: string;
  readonly cooldown: number;          // ms (0 = rage-gated, kein Zeitcooldown)
  readonly rageRequired: number;      // Mindest-Rage zum Aktivieren
  readonly allowedModes?: readonly GameMode[];
  /** Interne Varianten wie NPC-Fähigkeiten bleiben aus der Spieler-Auswahl heraus. */
  readonly catalogVisible?: boolean;
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
  readonly projectileStyle?: ProjectileStyle;
  readonly projectileVisualScale?: number;
  readonly tracerConfig: TracerConfig;
  readonly damage: number;
  readonly range: number;
  readonly rockDamageMult: number;
  readonly trainDamageMult?: number;
  readonly baseDamageMult?: number;
  readonly shotRecoilForce: number;
  readonly shotRecoilDuration: number;
  readonly shotAudio?: LoadoutShotAudioConfig;
  readonly chainRadius?: number;
  readonly chainDamageFactor?: number;
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
  /** Allgemeiner Schadensfaktor fuer feindliche Coop-Basen; Default 1.0. */
  readonly baseDamageMult?: number;
  /** Legacy-/NPC-Semantik: Schaden ausschliesslich an eigenen Friendly-Basen. */
  readonly friendlyBaseDamageMult?: number;
  readonly skipEnemyDamage?: boolean; // true: Coop-Gegner werden verschont (Zombie-Luftangriffe)
  readonly carpetStrikeCount?: number;
  readonly carpetOffset?: number;
  readonly carpetIntervalMs?: number;
  readonly carpetRadiusFactor?: number;
  readonly carpetDamageFactor?: number;
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

export type UltimateConfigShape = BuffUltimateConfig | GaussUltimateConfig | AirstrikeUltimateConfig | TunnelUltimateConfig;
