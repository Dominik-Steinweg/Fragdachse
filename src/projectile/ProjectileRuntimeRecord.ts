import type {
  ProjectileProximityPulseConfig, ProjectileCollisionMode, ProjectileExplosionConfig,
  ImpactCloudConfig, ProjectileHomingConfig, ProjectileEnergyInjectorPayload, GrenadeEffectConfig,
  ProjectileStyle, BulletVisualPreset, GrenadeVisualPreset, EnergyBallVariant, TracerConfig,
  DetonableConfig, DetonatorConfig, GroundFireVisualStyle, GroundFireCellEffect,
  ProjectilePathEffectKind, ShotAudioKey, MiniRocketFlightPhase,
  ProjectileDamageSourceFactor,
} from '../types';
import type {
  ProjectileProvenance, ProjectileFlightSpec, ProjectileCollisionFilterSpec,
  ProjectileHitboxGrowthSpec, ProjectileDragSpec, ProjectileSplitSpec,
  ProjectilePenetrationSpec, ProjectileMiniRocketFlightSpec,
} from './ProjectileSpawnRequest';
import type { ProjectileBouncePresentation } from '../types';
import type { ProjectileBurnAugment } from './ProjectileTravelPort';
import type { ProjectileId } from './ProjectileSpawnPort';
import type { ProjectileHomingRequest } from '../entities/ProjectileHomingController';
import type { ProjectilePhysicsHandle } from './ProjectilePhysicsBinding';

/** Private authoritative state: never exported through a gameplay boundary. */
export interface ProjectileRuntimeRecord {
  /** Gameplay direction survives drag stopping the body; unrelated to visual spin. */
  grenadeLastDirection?: number;
  grenadeDemolitionTriggered?: boolean;
  readonly id: ProjectileId;
  lastX: number;
  lastY: number;
  pendingDestroy?: boolean;
  pendingExplosion?: boolean;
  bounceCount: number;
  readonly createdAt: number;
  provenance: ProjectileProvenance;
  damage: number;
  maxBounces: number;
  adrenalinGain: number;
  hitboxSize?: number;
  lastCountdownEmitted?: number | null;
  frictionActivated?: boolean;
  simulatedAgeMs?: number;
  appliedAirFrictionDecay?: number;
  timeBubbleFactor?: number;
  remainingRangePx?: number;
  bounceProcessedThisStep?: boolean;
  velocityAfterFirstBounce?: { x: number; y: number };
  /** Sole handle; the binding owns its Phaser resources, never gameplay state. */
  readonly physics: ProjectilePhysicsHandle;
  readonly spec: ProjectileResolvedSpec;
  /** Opaque transport data: only projections and presentation consume these fields. */
  presentation: ProjectilePresentationMetadata;
  /** Latest host-authoritative presentation outcome, repeated in dynamic snapshots until despawn. */
  lastBouncePresentation?: ProjectileBouncePresentation;
  interaction: ProjectileInteractionState;
  miniRocket: ProjectileMiniRocketState;
  contacts: ProjectileContactMemory;
}
export interface ProjectileResolvedSpec {
  readonly flight: ProjectileResolvedFlight;
  readonly interaction: ProjectileResolvedInteraction;
}
export interface ProjectileResolvedFlight extends Pick<ProjectileFlightSpec, 'lifetimeMs' | 'speed' | 'isGrenade'> {
  readonly originalBodySize?: number;
  readonly collisionMode: ProjectileCollisionMode;
  readonly isTranslocatorPuck?: boolean;
  readonly homing?: ProjectileHomingConfig;
  readonly piercesTargets?: boolean;
  readonly fuseTime?: number;
  readonly isFlame?: boolean;
  readonly isBfg?: boolean;
  readonly collisionFilter: ProjectileCollisionFilterSpec;
  readonly hitboxGrowth: ProjectileHitboxGrowthSpec;
  readonly drag: ProjectileDragSpec;
  readonly split: ProjectileSplitSpec;
  readonly penetration: ProjectilePenetrationSpec;
  readonly miniRocket: ProjectileMiniRocketFlightSpec;
}
export interface ProjectileResolvedInteraction {
  readonly proximityPulse?: ProjectileProximityPulseConfig;
  readonly enemyHitExplosion?: ProjectileExplosionConfig;
  readonly impactCloud?: ImpactCloudConfig;
  readonly energyInjectorPayload?: ProjectileEnergyInjectorPayload;
  readonly grenadeEffect?: GrenadeEffectConfig;
  readonly detonable?: DetonableConfig;
  readonly detonator?: DetonatorConfig;
  readonly multiExplosionCoastMs?: number;
  readonly directHit: {
    readonly appliedSourceDamageFactors?: readonly ProjectileDamageSourceFactor[];
    readonly plasmaSwarmEnabled?: boolean;
    readonly plasmaSwarmProjectileCount?: number;
    readonly plasmaSwarmExplosionRadius?: number;
    readonly plasmaSwarmExplosionDamage?: number;
    readonly plasmaSwarmExplosionSlowFraction?: number;
    readonly rockDamageMult?: number;
    readonly trainDamageMult?: number;
    readonly baseDamageMult?: number;
    readonly gaussChainRadius?: number;
    readonly gaussChainDamageFactor?: number;
    readonly ak47DamageMultiplier?: number;
    readonly ak47FireSuperiorityShot?: boolean;
    readonly shotgunOriginX?: number;
    readonly shotgunOriginY?: number;
    readonly shotgunResolvedRange?: number;
    readonly shotgunProximityMaxDamageBonus?: number;
    readonly shotgunSlowFraction?: number;
    readonly shotgunSlowDurationMs?: number;
    readonly hitSlowFraction?: number;
    readonly hitSlowDurationMs?: number;
    readonly hitVulnerabilityDurationMs?: number;
    readonly hitKnockback?: number;
    readonly hitKnockbackDurationMs?: number;
  };
  readonly burn: {
    readonly burnDurationMs?: number;
    readonly burnDamagePerTick?: number;
    readonly canReceiveFireImbue?: boolean;
  };
  readonly pathEffect: {
    readonly fireTrail?: GroundFireCellEffect;
    readonly pathEffectKind?: ProjectilePathEffectKind;
    readonly fireTrailHalfWidthCells?: number;
    readonly awpCorridorHalfWidth?: number;
    readonly awpCorridorDamage?: number;
    readonly awpCorridorDotDurationMs?: number;
    readonly awpCorridorDotTickIntervalMs?: number;
    readonly awpCorridorKnockback?: number;
    readonly awpCorridorKnockbackDurationMs?: number;
  };
  readonly impulse: {
    readonly leafBlowerMinKnockback?: number;
    readonly leafBlowerMaxKnockback?: number;
    readonly leafBlowerSelfPush?: number;
    readonly leafBlowerDeflectsProjectiles?: boolean;
  };
}
export interface ProjectilePresentationMetadata {
  readonly color: number;
  readonly ownerColor?: number;
  readonly visualMuzzleOrigin?: { x: number; y: number };
  readonly projectileVisualScale?: number;
  readonly smokeTrailColor?: number;
  readonly projectileStyle?: ProjectileStyle;
  readonly sporeVisualVariant?: 'spore' | 'spore_void';
  readonly bulletVisualPreset?: BulletVisualPreset;
  readonly grenadeVisualPreset?: GrenadeVisualPreset;
  readonly energyBallVariant?: EnergyBallVariant;
  readonly tracerConfig?: TracerConfig;
  readonly projectileBurnVisualStyle?: GroundFireVisualStyle;
  readonly shotAudioKey?: ShotAudioKey;
  readonly suppressSpawnFx?: boolean;
}
export interface ProjectileInteractionState {
  supportConsumed?: boolean;
  ak47HitConfirmed?: boolean;
  ak47StrategicRefunded?: boolean;
  lastProximityPulseAt?: number;
  explosion?: ProjectileExplosionConfig;
  guidance?: ProjectileHomingRequest;
  burnAugment?: ProjectileBurnAugment;
  pendingHydraSplit?: {
    x: number;
    y: number;
    angles: number[];
  };
  penetrationRemaining?: number;
  multiExplosionsRemaining?: number;
  multiExplosionExcludedTargetKeys?: Set<string>;
}
/** Continuation state; Mini Rocket adds its attack/coast/return phases. */
export interface ProjectileMiniRocketState {
  phase?: MiniRocketFlightPhase;
  coastUntilAgeMs?: number;
  nextExplosionAtAgeMs?: number;
  deferredExplosion?: boolean;
  deferredExplosionStopsAtObstacle?: boolean;
  spent?: boolean;
  destructionFxEmitted?: boolean;
  continuationVx?: number;
  continuationVy?: number;
  hasExploded?: boolean;
  returnReserveGranted?: boolean;
  explosionIndex?: number;
}
/** Distinct contact lifetimes stay distinct (penetration chain, flame, lifetime pierce). */
export interface ProjectileContactMemory {
  swarmOriginExited?: boolean;
  flamePierceHitIds?: Set<string>;
  hitObstacleIds?: Set<number>;
  bfgHitPlayers?: Set<string>;
  bfgHitRocks?: Set<number>;
  bfgHitTrain?: boolean;
  gaussHitPlayers?: Set<string>;
  gaussHitRocks?: Set<number>;
  gaussHitTrain?: boolean;
  hitBaseIds?: Set<string>;
  penetrationHitIds?: Set<string>;
  piercingHitIds?: Set<string>;
  penetratedRockIds?: Set<number>;
  awpCorridorHitIds?: Set<string>;
}
