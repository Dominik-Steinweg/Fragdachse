import type { MuzzleOrigin } from '../config';
import type {
  BulletVisualPreset,
  BurnOnHitConfig,
  DetonableConfig,
  DetonatorConfig,
  EnergyBallVariant,
  GrenadeEffectConfig,
  GrenadeVisualPreset,
  GroundFireCellEffect,
  GroundFireVisualStyle,
  ImpactCloudConfig,
  LoadoutSlot,
  ProjectileEnergyInjectorPayload,
  ProjectileExplosionConfig,
  ProjectileHomingConfig,
  ProjectileProximityPulseConfig,
  ProjectilePathEffectKind,
  ProjectileStyle,
  ShotAudioKey,
  TracerConfig,
} from '../types';
import type { ProjectileId } from './ProjectileSpawnPort';

/**
 * Aufgelöster Spawn-Auftrag der oberen Execution-Grenze.
 *
 * Der Auftrag trennt die vier fachlich verschiedenen Dimensionen eines Projectiles – Ursprung,
 * Flug, Herkunft und Wirkung – von den rein passiven Darstellungsdaten. Er beschreibt Semantik,
 * keinen Lifecycle: Identity, Simulation und Teardown gehören der Projectile-Runtime.
 */
export interface ProjectileSpawnRequest {
  readonly origin: ProjectileSpawnOrigin;
  readonly flight: ProjectileFlightSpec;
  readonly provenance: ProjectileProvenance;
  readonly interaction: ProjectileInteractionSpec;
  readonly presentation: ProjectilePresentationDescriptor;
}

/** Gameplay-Ursprung des Schusses; die sichere Auflösung des Muzzle-Punkts bleibt Runtime-Sache. */
export interface ProjectileSpawnOrigin {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  /** Gewünschter physischer Mündungspunkt; die Runtime löst ihn kollisionssicher auf. */
  readonly gameplayMuzzleOrigin?: MuzzleOrigin;
}

// ── Flight ────────────────────────────────────────────────────────────────────

/** Flug-, Lebenszeit- und Kollisionsverhalten ohne Wirkungssemantik. */
export interface ProjectileFlightSpec {
  readonly speed: number;
  /** Kantenlänge/Durchmesser der Gameplay-Hitbox. */
  readonly size: number;
  readonly lifetimeMs: number;
  readonly maxBounces: number;
  readonly isGrenade: boolean;
  readonly initialBounceCount?: number;
  /** Reststrecke, ab der das Projectile seine Reichweite erschöpft hat. */
  readonly remainingRangePx?: number;
  /** Reale Zündzeit einer Granate; sie folgt Host-Zeit und keiner simulierten Zeitdimension. */
  readonly fuseTimeMs?: number;
  readonly homing?: ProjectileHomingConfig;
  /** Durchdringt logische Combat-Ziele, aber keine World-Blocker. */
  readonly piercesTargets?: boolean;
  readonly penetration?: ProjectilePenetrationSpec;
  readonly collisionFilter?: ProjectileCollisionFilterSpec;
  readonly drag?: ProjectileDragSpec;
  readonly hitboxGrowth?: ProjectileHitboxGrowthSpec;
  readonly split?: ProjectileSplitSpec;
  readonly miniRocket?: ProjectileMiniRocketFlightSpec;
  /** Flammen-Hitbox: kein Bounce-Verbrauch, eigene Travel-/Ablaufsemantik. */
  readonly isFlame?: boolean;
  /** Trifft mehrfach, ohne sich am Ziel zu verbrauchen. */
  readonly flamePiercing?: boolean;
  /** BFG-Flugkörper mit durchschlagender Bahn und eigener Puls-Sub-Attacke. */
  readonly isBfg?: boolean;
}

export interface ProjectilePenetrationSpec {
  readonly count?: number;
  readonly damageRetention?: number;
  readonly penetratesRocks?: boolean;
}

/** Quellbezogene Kollisionsausnahmen einer montierten Feuerquelle. */
export interface ProjectileCollisionFilterSpec {
  readonly ignoreBaseCollisions?: boolean;
  readonly ignoreRockIndex?: number;
}

/** Geschwindigkeitsabbau während des Fluges und beim Abprallen. */
export interface ProjectileDragSpec {
  readonly velocityDecayPerSec?: number;
  readonly frictionDelayMs?: number;
  readonly airFrictionDecayPerSec?: number;
  readonly bounceFrictionMultiplier?: number;
  readonly stopSpeedThreshold?: number;
}

/** Wachsende Gameplay-Hitbox (Flamme, Luftstoß). */
export interface ProjectileHitboxGrowthSpec {
  readonly growRatePerSec?: number;
  readonly maxSize?: number;
}

/** Aufteilung in Kindprojektile; die Kinder laufen über denselben Spawn-Pfad. */
export interface ProjectileSplitSpec {
  readonly count?: number;
  readonly spread?: number;
  readonly speedFactor?: number;
  readonly homing?: ProjectileHomingConfig;
}

/** Mehrstufige Mini-Rocket-Flugphasen inklusive Rückflug und Aufnahme. */
export interface ProjectileMiniRocketFlightSpec {
  readonly stageRangePx?: number;
  readonly returnEnabled?: boolean;
  readonly returnRangeBuffer?: number;
  readonly pickupRadius?: number;
  readonly pickupAdrenalineRefundFraction?: number;
  readonly pickupArmor?: number;
  readonly adrenalineCostPaid?: number;
  readonly safetyLifetimeMs?: number;
  readonly cascadeDamageBonusPerExplosion?: number;
}

// ── Provenance ────────────────────────────────────────────────────────────────

/**
 * Mehrdimensionale Herkunft eines Projectiles.
 *
 * Gameplay-Source, Attribution und Allegiance bleiben getrennt, damit Reflection/Deflection
 * Zurechnung und Zugehörigkeit ändern kann, ohne Herkunft oder Abstammung zu verlieren.
 */
export interface ProjectileProvenance {
  /** Entität, die das Projectile erzeugt hat. */
  readonly gameplaySourceId: string;
  /** Entität, der Treffer, Kills und Ressourcengewinn zugerechnet werden. */
  readonly attributionId: string;
  readonly allegiance: ProjectileAllegianceRef;
  /** Authored Waffen-/Ability-Id der Quelle (Killfeed, Statistik). */
  readonly weaponSourceId?: string;
  readonly sourceSlot?: LoadoutSlot;
  /** Quellkonstrukt einer automatischen Feuerquelle. */
  readonly sourceTurretId?: string;
  readonly lineage?: ProjectileLineage;
  readonly correlation?: ProjectileCorrelation;
}

/** Zugehörigkeit, aus der Freund-/Feind-Beziehungen aufgelöst werden. */
export interface ProjectileAllegianceRef {
  readonly ownerId: string;
  readonly allowTeamDamage?: boolean;
}

/**
 * Abstammung eines Projectiles.
 *
 * Kind-/Split-Spawns laufen über denselben Spawn-Pfad, erhalten eine eigene Identity und führen
 * die Abstammung nur so weit fort, wie ein Consumer sie tatsächlich braucht.
 */
export interface ProjectileLineage {
  /** Erzeugendes Projectile eines Kind-/Split-Spawns. */
  readonly parentProjectileId?: ProjectileId;
  /** Das Projectile wurde durch Reflection/Deflection übernommen. */
  readonly reflected?: boolean;
  /** Schwarmkinder erzeugen selbst keine weiteren Schwärme. */
  readonly plasmaSwarmChild?: boolean;
  /** Ursprungsziel, das erst verlassen werden muss, bevor es erneut getroffen werden darf. */
  readonly plasmaSwarmOriginEnemyId?: string;
}

/** Verknüpfung mehrerer Projectiles desselben fachlichen Vorgangs. */
export interface ProjectileCorrelation {
  /** Schuss-Id, über die zusammengehörende AK47-Projektile erkannt werden. */
  readonly ak47ShotId?: number;
}

/** Quelle, bei der Gameplay-Source, Attribution und Allegiance dieselbe Entität sind. */
export interface SingleOwnerProvenanceDetails {
  readonly weaponSourceId?: string;
  readonly allowTeamDamage?: boolean;
  readonly sourceSlot?: LoadoutSlot;
  readonly sourceTurretId?: string;
  readonly lineage?: ProjectileLineage;
  readonly correlation?: ProjectileCorrelation;
}

/**
 * Baut die Provenance einer Quelle, die alle drei Dimensionen heute selbst besetzt.
 *
 * Die Dimensionen bleiben im Contract getrennt: eine spätere Reflection darf Attribution und
 * Allegiance verschieben, ohne `gameplaySourceId` oder `lineage` zu überschreiben.
 */
export function createSingleOwnerProvenance(
  ownerId: string,
  details: SingleOwnerProvenanceDetails = {},
): ProjectileProvenance {
  return {
    gameplaySourceId: ownerId,
    attributionId: ownerId,
    allegiance: { ownerId, allowTeamDamage: details.allowTeamDamage },
    weaponSourceId: details.weaponSourceId,
    sourceSlot: details.sourceSlot,
    sourceTurretId: details.sourceTurretId,
    lineage: details.lineage,
    correlation: details.correlation,
  };
}

// ── Interaction ───────────────────────────────────────────────────────────────

/**
 * Wirkungsfähigkeiten eines Projectiles als Komposition benannter Zweige.
 *
 * Eine Mechanik ist eine Kombination von Fähigkeiten, kein eigener Projectile-Typ. Ein neues
 * optionales Feld auf dieser Ebene beschreibt eine wiederverwendbare Semantik; waffenspezifische
 * Parameter erweitern den kleinsten passenden Zweig.
 */
export interface ProjectileInteractionSpec {
  readonly directHit?: ProjectileDirectHitSpec;
  readonly explosion?: ProjectileExplosionConfig;
  /** Explosion ausschließlich bei Gegner-/Spielertreffern, nicht bei Wand oder Ablauf. */
  readonly enemyHitExplosion?: ProjectileExplosionConfig;
  readonly multiExplosion?: ProjectileMultiExplosionSpec;
  readonly impactCloud?: ImpactCloudConfig;
  /** Terminale Granatenwirkung beim Ablauf der Zündzeit. */
  readonly grenadeEffect?: GrenadeEffectConfig;
  readonly burn?: ProjectileBurnSpec;
  readonly pathEffect?: ProjectilePathEffectSpec;
  readonly impulse?: ProjectileImpulseSpec;
  readonly support?: ProjectileSupportSpec;
  readonly detonable?: DetonableConfig;
  readonly detonator?: DetonatorConfig;
  readonly proximityPulse?: ProjectileProximityPulseConfig;
}

/** Unmittelbare Trefferwirkung am getroffenen Ziel. */
export interface ProjectileDirectHitSpec {
  readonly damage: number;
  /** Ressourcengewinn der Attribution bei Treffer. */
  readonly adrenalinGain?: number;
  readonly rockDamageMult?: number;
  readonly trainDamageMult?: number;
  readonly baseDamageMult?: number;
  readonly slowFraction?: number;
  readonly slowDurationMs?: number;
  readonly vulnerabilityDurationMs?: number;
  readonly knockback?: number;
  readonly knockbackDurationMs?: number;
  readonly shotgun?: ProjectileShotgunHitSpec;
  readonly gaussChain?: ProjectileGaussChainSpec;
  readonly plasmaSwarm?: ProjectilePlasmaSwarmSpec;
  readonly ak47?: ProjectileAk47HitSpec;
}

/** Nahbereichsbonus und Verlangsamung eines Schrotschusses. */
export interface ProjectileShotgunHitSpec {
  readonly originX: number;
  readonly originY: number;
  readonly resolvedRange: number;
  readonly proximityMaxDamageBonus?: number;
  readonly slowFraction?: number;
  readonly slowDurationMs?: number;
}

/** Kettenreaktion auf weitere Ziele im Umkreis des Treffers. */
export interface ProjectileGaussChainSpec {
  readonly radius?: number;
  readonly damageFactor?: number;
}

/** Schwarmauslösung beim Treffer; die Kinder laufen über den normalen Spawn-Pfad. */
export interface ProjectilePlasmaSwarmSpec {
  readonly projectileCount?: number;
  readonly explosionRadius?: number;
  readonly explosionDamage?: number;
  readonly explosionSlowFraction?: number;
}

/** Trefferabhängige AK47-Feuerüberlegenheit. */
export interface ProjectileAk47HitSpec {
  readonly damageMultiplier?: number;
  readonly fireSuperiorityShot?: boolean;
}

/** Wiederholte Explosionen desselben Projectiles. */
export interface ProjectileMultiExplosionSpec {
  readonly count?: number;
  readonly coastMs?: number;
}

/** Brandwirkung und Aufnahmefähigkeit für Fire-Imbue-Augments. */
export interface ProjectileBurnSpec {
  readonly durationMs?: number;
  readonly damagePerTick?: number;
  readonly visualStyle?: GroundFireVisualStyle;
  /** Zusätzlicher Brand, der neben der Grundwirkung angewendet wird. */
  readonly supplemental?: BurnOnHitConfig;
  /** Das Projectile darf unterwegs ein Fire-Imbue-Augment aufnehmen. */
  readonly canReceiveFireImbue?: boolean;
}

/** Wirkung entlang der geflogenen Bahn statt am Treffpunkt. */
export interface ProjectilePathEffectSpec {
  readonly kind?: ProjectilePathEffectKind;
  readonly fireTrail?: GroundFireCellEffect;
  readonly fireTrailHalfWidthCells?: number;
  readonly awpCorridor?: ProjectileAwpCorridorSpec;
}

/** Aufgeladener AWP-Korridor entlang der Flugbahn. */
export interface ProjectileAwpCorridorSpec {
  readonly halfWidth?: number;
  readonly damage?: number;
  readonly dotDurationMs?: number;
  readonly dotTickIntervalMs?: number;
  readonly knockback?: number;
  readonly knockbackDurationMs?: number;
}

/** Gerichteter Luftstoß auf Ziele und gegnerische Projectiles. */
export interface ProjectileImpulseSpec {
  readonly minKnockback?: number;
  readonly maxKnockback?: number;
  /** Rückstoß auf die eigene Quelle. */
  readonly selfPush?: number;
  /** Der Stoß übernimmt getroffene gegnerische Projectiles. */
  readonly deflectsProjectiles?: boolean;
}

/** Unterstützende Wirkung ohne Schadensumweg. */
export interface ProjectileSupportSpec {
  readonly energyInjector?: ProjectileEnergyInjectorPayload;
}

// ── Presentation ──────────────────────────────────────────────────────────────

/**
 * Passive Darstellungsmetadaten.
 *
 * Sie werden mitgeführt, projiziert und repliziert, sind für die autoritative Simulation aber
 * opaque: kein Processor, Resolver oder Combat-Pfad verzweigt auf ein Feld dieses Descriptors.
 */
export interface ProjectilePresentationDescriptor {
  readonly color: number;
  readonly style?: ProjectileStyle;
  /** Spielerfarbe des Schützen für projektilspezifische Akzente. */
  readonly ownerColor?: number;
  readonly visualScale?: number;
  readonly bulletPreset?: BulletVisualPreset;
  readonly grenadePreset?: GrenadeVisualPreset;
  readonly energyBallVariant?: EnergyBallVariant;
  readonly sporeVariant?: 'spore' | 'spore_void';
  readonly smokeTrailColor?: number;
  readonly tracer?: TracerConfig;
  readonly shotAudioKey?: ShotAudioKey;
  readonly suppressSpawnFx?: boolean;
  /** Rein visueller Mündungsursprung; er verschiebt den Gameplay-Spawn nie. */
  readonly visualMuzzleOrigin?: { readonly x: number; readonly y: number };
}
