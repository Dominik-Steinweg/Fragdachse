import * as Phaser from 'phaser';
import { findNearestRectangleHit } from '../utils/geometry';
import type { LoadoutSlot, PlaceableKind, ProjectileSpawnConfig, ProjectileRuntimeRecord, SupportProjectileImpact } from '../types';
import {
  type ProjectilePhysicsBindingPort,
  type ProjectilePhysicsHandle,
  type ProjectilePhysicsMechanics,
} from './ProjectilePhysicsBinding';
import {
  resolveProjectileBodyProfile,
  MIN_BODY_LEN,
} from '../systems/ProjectileSpawnResolver';
import { resolveSafeMuzzleSpawn } from '../systems/ProjectileSpawnResolver';
import { effectiveAirFrictionDecay } from './ProjectileFlightProcessor';
import { ProjectileClientReplica, type ProjectileClientReplicaFrame } from './ProjectileClientReplica';
import type {
  ProjectilePresentationRuntime,
  ProjectilePresentationState,
} from './ProjectilePresentationRuntime';
import type { ShadowProjectileSample } from '../effects/ShadowConfig';
import type { ProjectileLightSample } from '../effects/LightingConfig';
import type { WorldScopedBinding } from '../world/WorldRuntime';
import type { ProjectileIdentityScope } from './ProjectileIdentityScope';
import { toProjectileSpawnConfig } from './projectileSpawnPayloadAdapter';
import { ProjectileFlightProcessor } from './ProjectileFlightProcessor';
import { ProjectileHomingController } from '../entities/ProjectileHomingController';
import type {
  LineOfFireReadPort,
  ProjectileHomingRequest,
  ProjectileTargetQueryPort,
} from '../entities/ProjectileHomingController';
import type { ProjectileId, ProjectileSpawnPort, ProjectileSpawnResult } from './ProjectileSpawnPort';
import {
  createSingleOwnerProvenance,
  type ProjectileAllegianceRef,
  type ProjectileProvenance,
  type ProjectileSpawnRequest,
} from './ProjectileSpawnRequest';
import type { ProjectileTimeFieldPort } from './ProjectileTimeFieldPort';
import {
  BURN_TICK_INTERVAL_MS,
} from '../config';
import type {
  ProjectileBurnAugment,
  ProjectileEnvironmentInteractionPort,
  ProjectileTravelCapabilities,
  ProjectileTravelReadPort,
  ProjectileTravelSample,
} from './ProjectileTravelPort';
import type {
  ProjectileExternalInteractionPort,
  ProjectileDetonationOutcome,
  ProjectileDetonationSearchRequest,
  ProjectileDetonationTarget,
  TranslocatorProjectilePort,
  TranslocatorPuckSpawnRequest,
} from './ProjectileExternalInteractionPort';
import type {
  ProjectileDiagnosticsReadPort,
  ProjectileDiagnosticsSummary,
  ProjectilePresentationReadPort,
  ProjectileThreatReadPort,
  ProjectileThreatSample,
} from './ProjectileReadPorts';
import {
  ProjectileCollisionProcessor,
  type ProjectileCollisionOutcome,
  type ProjectileCollisionDependencies,
} from './ProjectileCollisionProcessor';
import {
  ProjectileMiniRocketProcessor,
  type ProjectileMiniRocketStatePort,
} from './ProjectileMiniRocketProcessor';
import type {
  ProjectileBarrierPort,
  ProjectileBarrierResolution,
  ProjectileDefenseResolution,
} from './ProjectileInteractionPorts';
import type {
  ProjectileCombatPort,
  ProjectileCombatTargetRef,
  ProjectileDirectImpactOutcome,
  ProjectilePlasmaSwarmImpact,
} from './ProjectileCombatPort';
import type {
  ProjectileExplosionRequest,
  ProjectileExplosionContinuationPort,
  ProjectileExplosionOutcome,
  ProjectileGrenadePayloadRequest,
} from './ProjectileExplosionPort';
import type { ProjectileDetonableReadPort, ProjectileDetonableSample } from './ProjectileGameplayPort';
import type {
  ProjectileReplicationReadPort,
  ProjectileReplicationRecord,
} from './ProjectileReplicationAdapter';
import { ProjectileReplicationAdapter } from './ProjectileReplicationAdapter';
import {
  type ProjectileCollisionTargetQueryPort,
  type ProjectilePhysicsContact,
  type ProjectileImpactCandidate,
  projectileTargetPhysicalKey,
  type ProjectileTargetabilityPort,
  type ProjectileWorldBlockerPort,
} from './ProjectileTargetPort';
import type {
  ProjectileFlameExpiryEvent,
  ProjectileImpactSource,
  ProjectileLifecycleOutcome,
} from './ProjectileGameplayPort';
import type { ProjectileTrainImpactPort } from './ProjectileBoundaryPorts';
import {
  ProjectileLifecycleProcessor,
  type ProjectileLifecycleDependencies,
} from './ProjectileLifecycleProcessor';
import { createInheritedProjectilePayload } from './projectileSpawnPayloadAdapter';
import { ProjectileStore } from './ProjectileStore';
import { PLASMA_SWARM_EXPLOSION_DURATION_MS, resolvePlasmaSwarmProjectileProfile, resolvePlasmaSwarmRadialAngles, resolvePlasmaSwarmHoming } from '../systems/PlasmaCharge';

/** Parameter eines vom Owner erzeugten Reflect-/Deflect-Nachfolgers. */
interface ReflectedProjectileOptions {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly speed: number;
  readonly ownerId: string;
  readonly allegiance: ProjectileAllegianceRef;
  readonly damage: number;
  readonly color: number;
  readonly ownerColor: number;
  readonly sourceId: string;
  readonly sourceSlot?: LoadoutSlot;
  /** Übernommene Granate: Granatensemantik und Restzündzeit bleiben erhalten. */
  readonly keepGrenade: boolean;
  readonly nowMs: number;
}

/**
 * Ein Split-Kind wird erst nach Abschluss der laufenden Interaction-Stage materialisiert.
 * Die Queue transportiert weiterhin denselben semantischen Spawn-Pfad und die Provenance des
 * Eltern-Projectiles; sie ist kein zweiter Store und keine öffentliche Runtime-Fassade.
 */
interface PendingNextStageProjectileSpawn {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly ownerId: string;
  readonly cfg: ProjectileSpawnConfig;
  readonly provenance: ProjectileProvenance;
  readonly hostNowMs: number;
  /** Number of completed interaction stages after which this spawn is eligible. */
  readonly readyAfterCompletedStages: number;
}

interface ResolvedWorldContact {
  readonly outcome: ProjectileCollisionOutcome;
  readonly technicalContactConsumed: boolean;
}

export interface ProjectileHostStageResult {
  /** Typed requests; domain fan-out is resolved after the post-projectile stage. */
  projectileExplosions: ProjectileExplosionRequest[];
  grenadePayloads: ProjectileGrenadePayloadRequest[];
  countdownEvents: Array<{ x: number; y: number; value: number }>;
}

export interface WorldProjectileRuntimeOptions {
  readonly physicsBinding: ProjectilePhysicsBindingPort;
  /** World-scoped visual owner; it is never constructed by the physics binding. */
  readonly presentation: ProjectilePresentationRuntime;
  /** World-Revision-Scope für monotone Projectile-Identity über lokale Runtime-Rebuilds. */
  readonly identityScope: ProjectileIdentityScope;
  /** Hostautoritative Frame-/Weltzeit; die Runtime liest keine eigene Wall Clock. */
  readonly hostNowMs: () => number;
  /** Meldet der Composition, dass dieser Owner abgeräumt ist. */
  readonly onDestroy?: () => void;
}

/**
 * World-owned Owner der autoritativen Projectile-Registry.
 *
 * Er lebt und stirbt mit seiner `WorldRuntime`: Registry, Runtime-Records und ihr Teardown gehören
 * ihm allein; die monotone Identity-Vergabe kommt aus dem worldRevision-langlebigen Scope. Spawn
 * läuft ausschließlich über diese Grenze – aus der aufgelösten Execution über {@link spawnProjectile},
 * aus noch nicht migrierten Host-Quellen über den befristeten Seam.
 *
 * Phaser-Physics-Ressourcen und ihre Kollisionseinstiegspunkte liegen in einem world-komponierten
 * Binding; dieses arbeitet auf **demselben** Store, nie auf einer Kopie.
 */
export class WorldProjectileRuntime implements
  ProjectileSpawnPort,
  ProjectileExternalInteractionPort,
  TranslocatorProjectilePort,
  ProjectileThreatReadPort,
  ProjectileDiagnosticsReadPort,
  ProjectilePresentationReadPort,
  ProjectileTravelReadPort,
  ProjectileEnvironmentInteractionPort,
  ProjectileExplosionContinuationPort,
  ProjectileDetonableReadPort,
  ProjectileReplicationReadPort,
  WorldScopedBinding {
  private readonly projectiles: ProjectileStore;
  private readonly physicsHandles = new Map<ProjectileId, ProjectilePhysicsHandle>();
  private readonly flightProcessor = new ProjectileFlightProcessor();
  private readonly homingController = new ProjectileHomingController();
  private readonly detonableIds = new Set<ProjectileId>();
  private readonly detonatorIds = new Set<ProjectileId>();
  private readonly translocatorPuckIds = new Set<ProjectileId>();
  private readonly travelEffectIds = new Set<ProjectileId>();
  private readonly burnAugments = new Map<ProjectileId, ProjectileBurnAugment>();
  private readonly threatSamples: ProjectileThreatSample[] = [];
  private readonly travelSamples: ProjectileTravelSample[] = [];
  private readonly activeProjectilesByOwner = new Map<string, number>();
  private readonly collisionProcessor = new ProjectileCollisionProcessor();
  private readonly clientReplica = new ProjectileClientReplica();
  private readonly presentation: ProjectilePresentationRuntime;
  private readonly presentationStates: ProjectilePresentationState[] = [];
  private projectileReplicationAdapter: ProjectileReplicationAdapter | null = null;
  private readonly miniRocketProcessor = new ProjectileMiniRocketProcessor({
    getOwnerPosition: (ownerId) => this.miniRocketStatePort?.getOwnerPosition(ownerId) ?? null,
    updateHoming: (projectile, simulatedAgeMs, forceSearch) => (
      this.updateProjectileHoming(projectile, simulatedAgeMs, forceSearch)
    ),
    resetHoming: (projectile) => this.resetHomingState(projectile),
    onCollected: (projectile, x, y) => {
      this.miniRocketStatePort?.onOutcome({
        kind: 'mini-rocket-collected',
        projectileId: projectile.id,
        collectorId: projectile.ownerId,
        pickup: {
          x,
          y,
          color: projectile.color,
          ownerColor: projectile.ownerColor,
          adrenalineRefund: Math.max(0, projectile.miniRocketAdrenalineCostPaid ?? 0)
            * Math.max(0, projectile.miniRocketPickupAdrenalineRefundFraction ?? 0),
          armorRefund: Math.max(0, projectile.miniRocketPickupArmor ?? 0),
        },
      });
    },
  });
  private miniRocketStatePort: ProjectileMiniRocketStatePort | null = null;
  /** Capability-Index der aktiven Luftstöße, die gegnerische Projectiles umlenken. */
  private readonly deflectorIds = new Set<ProjectileId>();
  private readonly collisionDependencies: ProjectileCollisionDependencies;
  private readonly lifecycleProcessor: ProjectileLifecycleProcessor;
  private collisionTargetQueryPort: ProjectileCollisionTargetQueryPort | null = null;
  private worldBlockerPort: ProjectileWorldBlockerPort | null = null;
  private targetabilityPort: ProjectileTargetabilityPort | null = null;
  private barrierPort: ProjectileBarrierPort | null = null;
  private directImpactPort: ProjectileCombatPort | null = null;
  private projectileImpactEventCallback: ((projectile: ProjectileImpactSource) => void) | null = null;
  private naturalFlameExpiryCallback: ((projectile: ProjectileFlameExpiryEvent) => void) | null = null;
  private projectileResolvedCallback: ((outcome: ProjectileLifecycleOutcome) => void) | null = null;
  private miniRocketDestroyedCallback: ((projectile: ProjectileImpactSource) => void) | null = null;
  private standaloneExplosionRequestCallback: ((request: ProjectileExplosionRequest) => void) | null = null;
  private proximityPulseCallback: ((projectile: ProjectileImpactSource) => void) | null = null;
  private timeBubbleProvider: ((x: number, y: number, now: number, ownerId?: string) => number) | null = null;
  private homingTargetProvider: import('../entities/ProjectileHomingController').HomingTargetProvider | null = null;
  private homingLineOfFireChecker: import('../entities/ProjectileHomingController').HomingLineOfFireChecker | null = null;
  private rockHitCallback: ((rockId: number, damage: number, attackerId: string) => void) | null = null;
  private obstacleKindResolver: ((rockId: number) => PlaceableKind | undefined) | null = null;
  private baseHitCallback: ((baseId: string, damage: number, attackerId: string, projectile?: ProjectileImpactSource) => void) | null = null;
  private supportImpactCallback: ((projectile: ProjectileImpactSource, impact: SupportProjectileImpact) => void) | null = null;
  private trainImpactPort: ProjectileTrainImpactPort | null = null;
  private readonly physicsBinding: ProjectilePhysicsBindingPort;
  private readonly contactLine = new Phaser.Geom.Line();
  private readonly contactRect = new Phaser.Geom.Rectangle();
  private readonly contactPoints: Phaser.Math.Vector2[] = [];
  private readonly hostNowMs: () => number;
  private readonly onDestroy?: () => void;
  private projectileTimeFieldPort: ProjectileTimeFieldPort | null = null;
  private timeBubbleMovementPort: ProjectileTimeFieldPort | null = null;
  private readonly pendingNextStageSpawns: PendingNextStageProjectileSpawn[] = [];
  private completedInteractionStages = 0;
  private hasStartedInteractionStage = false;
  private hostFrameNowMs = 0;
  private interactionNowMs = 0;
  /** Same-frame bridge between technical Phaser contacts and canonical target candidates. */
  private readonly resolvedWorldContacts = new Map<string, boolean>();
  private contactFrameNowMs: number | null = null;
  private destroyed = false;

  constructor(options: WorldProjectileRuntimeOptions) {
    this.physicsBinding = options.physicsBinding;
    this.presentation = options.presentation;
    this.hostNowMs = options.hostNowMs;
    this.onDestroy = options.onDestroy;
    this.projectiles = new ProjectileStore(options.identityScope);
    const runtime = this;
    this.collisionDependencies = {
      get targetQuery() { return runtime.collisionTargetQueryPort; },
      get targetability() { return runtime.targetabilityPort; },
      get worldBlocker() { return runtime.worldBlockerPort; },
      get directImpact() { return runtime.directImpactPort; },
      destroyProjectile: (id) => this.destroyProjectile(id),
      applyDefense: (record, defense, candidate) => this.applyDefense(record, defense, candidate),
      completeDirectImpact: (record, target, impact, outcome) => this.completeDirectImpact(record, target, impact, outcome),
      resolveWorldImpact: (record, candidate) => this.resolveWorldImpact(record, candidate),
    };
    const lifecycleDependencies: ProjectileLifecycleDependencies = {
      queueDestroy: (projectile) => this.queueProjectileDestroy(projectile.id),
      release: (projectile) => this.releaseProjectile(projectile),
      dropStepEntryAt: (index) => this.projectiles.dropStepEntryAt(index),
      shouldSweepRocks: (projectile) => this.shouldSweepRocks(projectile),
      sweepRocks: (projectile) => this.sweepRocks(projectile),
      updateHoming: (projectile, simulatedAgeMs) => { this.updateProjectileHoming(projectile, simulatedAgeMs); },
      onImpact: (projectile, x, y) => this.projectileImpactEventCallback?.(this.createImpactSource(projectile, x, y)),
      onNaturalFlameExpiry: (projectile) => this.naturalFlameExpiryCallback?.(this.createImpactSource(projectile) as ProjectileFlameExpiryEvent),
      onProximityPulse: (projectile) => this.proximityPulseCallback?.(this.createImpactSource(projectile)),
      onSpentDestruction: (projectile) => this.miniRocketDestroyedCallback?.(this.createImpactSource(projectile)),
    };
    this.lifecycleProcessor = new ProjectileLifecycleProcessor(lifecycleDependencies);
    this.physicsBinding.setPhysicsContactHandler((contact) => this.reportPhysicsContact(contact));
  }

  /** Anzahl der aktuell wirksamen Projectiles dieser World. */
  get activeCount(): number {
    return this.projectiles.activeCount;
  }

  /** Builds the read-only host projection consumed by the world-scoped presentation owner. */
  private get presentationProjectiles(): readonly ProjectilePresentationState[] {
    const states = this.presentationStates;
    states.length = 0;
    for (const projectile of this.projectiles.stepOrder) {
      const sprite = projectile.sprite;
      states.push({
        id: projectile.id,
        ownerId: projectile.ownerId,
        x: sprite.x,
        y: sprite.y,
        vx: projectile.body.velocity.x,
        vy: projectile.body.velocity.y,
        size: sprite.displayWidth,
        color: projectile.color,
        ownerColor: projectile.ownerColor,
        projectileVisualScale: projectile.projectileVisualScale,
        smokeTrailColor: projectile.smokeTrailColor,
        style: projectile.projectileStyle,
        sporeVisualVariant: projectile.sporeVisualVariant,
        bulletVisualPreset: projectile.bulletVisualPreset,
        grenadeVisualPreset: projectile.grenadeVisualPreset,
        energyBallVariant: projectile.energyBallVariant,
        tracer: projectile.tracerConfig,
        shotAudioKey: projectile.shotAudioKey,
        suppressSpawnFx: projectile.suppressSpawnFx,
        miniRocketPhase: projectile.miniRocketPhase,
        miniRocketCascadeStage: (projectile.miniRocketCascadeDamageBonusPerExplosion ?? 0) > 0
          ? projectile.miniRocketExplosionIndex
          : undefined,
        projectileBurnVisualStyle: projectile.projectileBurnVisualStyle,
        burning: !projectile.isFlame && !projectile.isGrenade && (
          ((projectile.burnDurationMs ?? 0) > 0 && (projectile.burnDamagePerTick ?? 0) > 0)
          || ((projectile.supplementalBurnOnHit?.durationMs ?? 0) > 0
            && (projectile.supplementalBurnOnHit?.damagePerTick ?? 0) > 0)
        ),
        sourceTurretId: projectile.sourceTurretId,
      });
    }
    return states;
  }

  /** World-scoped Presentation owner; it is created and destroyed with this runtime. */
  getPresentationRuntime(): ProjectilePresentationRuntime {
    return this.presentation;
  }

  /** World-scoped client replica; it never crosses into authoritative gameplay. */
  getClientReplica(): ProjectileClientReplica {
    return this.clientReplica;
  }

  getDebugActiveProjectileCount(): number {
    return Math.max(this.projectiles.activeCount, this.clientReplica.size, this.presentation.clientVisualCount);
  }

  getShadowSamples(): readonly ShadowProjectileSample[] {
    return this.presentation.getShadowSamples(
      this.projectiles.activeCount > 0 ? this.presentationProjectiles : [],
      this.clientReplica,
    );
  }

  getLightSamples(): readonly ProjectileLightSample[] {
    return this.presentation.getLightSamples(
      this.projectiles.activeCount > 0 ? this.presentationProjectiles : [],
      this.clientReplica,
    );
  }

  setProjectileReplicationAdapter(adapter: ProjectileReplicationAdapter | null): void {
    this.projectileReplicationAdapter = adapter;
  }

  requestFullNetSnapshot(): void {
    this.projectileReplicationAdapter?.requestFullSnapshot();
  }

  getNetSnapshot() {
    return this.projectileReplicationAdapter?.getSnapshot(this.hostFrameNowMs) ?? null;
  }

  presentClientProjectileFrame(frame: ProjectileClientReplicaFrame, localPlayerId?: string): void {
    this.presentation.presentClientFrame(frame, localPlayerId);
  }

  clientExtrapolate(): void {
    this.presentation.extrapolateClient(this.clientReplica);
  }

  applyPlasmaSwarmImpact(impact: ProjectilePlasmaSwarmImpact): void {
    if (this.destroyed) return;
    this.standaloneExplosionRequestCallback?.({
      x: impact.x,
      y: impact.y,
      provenance: createSingleOwnerProvenance(impact.ownerId, {
        weaponSourceId: `${impact.sourceId}:swarm-explosion`,
        sourceSlot: impact.sourceSlot ?? 'weapon1',
        allowTeamDamage: impact.allowTeamDamage,
      }),
      effect: {
        radius: impact.explosionRadius, maxDamage: impact.explosionDamage, minDamage: impact.explosionDamage,
        knockback: 0, selfDamageMult: 0, damageTarget: 'enemies',
        enemySlowFraction: impact.explosionSlowFraction,
        enemySlowDurationMs: PLASMA_SWARM_EXPLOSION_DURATION_MS,
        baseDamageMult: 1, rockDamageMult: 1, trainDamageMult: 0,
        color: impact.color, visualStyle: 'energy',
      },
    });
    const profile = resolvePlasmaSwarmProjectileProfile({
      damage: impact.normalDamage, size: impact.normalSize, speed: impact.normalSpeed, range: impact.normalRange,
    });
    const speed = Math.max(1, profile.speed);
    const lifetime = Math.max(1, (profile.range / speed) * 1000);
    for (const angle of resolvePlasmaSwarmRadialAngles(impact.projectileCount)) {
      this.spawnProjectileConfig(impact.x, impact.y, angle, impact.ownerId, {
        speed, size: Math.max(1, profile.size), damage: profile.damage,
        color: impact.color, ownerColor: impact.ownerColor ?? impact.color, lifetime,
        remainingRangePx: profile.range, maxBounces: 0, isGrenade: false, adrenalinGain: 0,
        sourceId: 'weapon.plasma.swarm', homing: resolvePlasmaSwarmHoming(impact.homing),
        projectileStyle: impact.projectileStyle, energyBallVariant: impact.energyBallVariant,
        tracerConfig: impact.tracerConfig, allowTeamDamage: impact.allowTeamDamage,
        baseDamageMult: impact.baseDamageMult, suppressSpawnFx: true,
        plasmaSwarmProjectile: true, plasmaSwarmOriginEnemyId: impact.enemyId,
        sourceSlot: impact.sourceSlot ?? 'weapon1',
      });
    }
  }

  setNaturalFlameExpiryCallback(callback: ((projectile: ProjectileFlameExpiryEvent) => void) | null): void {
    this.naturalFlameExpiryCallback = callback;
  }

  setProjectileImpactCallback(callback: ((projectile: ProjectileImpactSource) => void) | null): void {
    this.projectileImpactEventCallback = callback;
  }

  setProjectileResolvedCallback(callback: ((outcome: ProjectileLifecycleOutcome) => void) | null): void {
    this.projectileResolvedCallback = callback;
  }

  setMiniRocketDestroyedCallback(callback: ((projectile: ProjectileImpactSource) => void) | null): void {
    this.miniRocketDestroyedCallback = callback;
  }

  setStandaloneExplosionRequestCallback(callback: ((request: ProjectileExplosionRequest) => void) | null): void {
    this.standaloneExplosionRequestCallback = callback;
  }

  setProximityPulseCallback(callback: ((projectile: ProjectileImpactSource) => void) | null): void {
    this.proximityPulseCallback = callback;
  }

  setTimeBubbleFactorProvider(provider: ((x: number, y: number, now: number, ownerId?: string) => number) | null): void {
    this.timeBubbleProvider = provider;
    this.timeBubbleMovementPort = provider ? {
      getMovementFactor: (x, y, nowMs, provenance) => provider(x, y, nowMs, provenance.allegiance.ownerId),
    } : null;
    this.flightProcessor.setTimeFieldPort(this.timeBubbleMovementPort ?? this.projectileTimeFieldPort);
  }

  setHomingTargetProvider(provider: import('../entities/ProjectileHomingController').HomingTargetProvider | null): void {
    this.homingTargetProvider = provider;
    this.homingController.setTargetQueryPort(provider ? { queryTargets: provider } : null);
  }

  setHomingLineOfFireChecker(checker: import('../entities/ProjectileHomingController').HomingLineOfFireChecker | null): void {
    this.homingLineOfFireChecker = checker;
    this.homingController.setLineOfFireReadPort(checker ? { hasClearLineOfFire: checker } : null);
  }

  setRockHitCallback(callback: ((rockId: number, damage: number, attackerId: string) => void) | null): void {
    this.rockHitCallback = callback;
  }

  setObstacleKindResolver(resolver: ((rockId: number) => PlaceableKind | undefined) | null): void {
    this.obstacleKindResolver = resolver;
  }

  setBaseHitCallback(callback: ((baseId: string, damage: number, attackerId: string, projectile?: ProjectileImpactSource) => void) | null): void {
    this.baseHitCallback = callback;
  }

  setSupportImpactCallback(callback: ((projectile: ProjectileImpactSource, impact: SupportProjectileImpact) => void) | null): void {
    this.supportImpactCallback = callback;
  }

  setRockGroup(...args: Parameters<ProjectilePhysicsBindingPort['setRockGroup']>): void {
    this.physicsBinding.setRockGroup(...args);
  }

  setBaseGroup(...args: Parameters<ProjectilePhysicsBindingPort['setBaseGroup']>): void {
    this.physicsBinding.setBaseGroup(...args);
  }

  setObstacleIndex(...args: Parameters<ProjectilePhysicsBindingPort['setObstacleIndex']>): void {
    this.physicsBinding.setObstacleIndex(...args);
  }

  setTrainGroup(...args: Parameters<ProjectilePhysicsBindingPort['setTrainGroup']>): void {
    this.physicsBinding.setTrainGroup(...args);
  }

  setTrainImpactPort(port: ProjectileTrainImpactPort | null): void {
    this.trainImpactPort = port;
  }

  private createImpactSource(
    projectile: ProjectileRuntimeRecord,
    x = projectile.sprite?.x ?? 0,
    y = projectile.sprite?.y ?? 0,
  ): ProjectileImpactSource {
    return {
      projectileId: projectile.id,
      ownerId: projectile.ownerId,
      provenance: projectile.provenance,
      x,
      y,
      velocityX: projectile.body?.velocity?.x ?? 0,
      velocityY: projectile.body?.velocity?.y ?? 0,
      color: projectile.color,
      ownerColor: projectile.ownerColor,
      sourceId: projectile.sourceId,
      sourceSlot: projectile.sourceSlot,
      allowTeamDamage: projectile.allowTeamDamage,
      damage: projectile.damage,
      ak47DamageMultiplier: projectile.ak47DamageMultiplier,
      baseDamageMult: projectile.baseDamageMult,
      rockDamageMult: projectile.rockDamageMult,
      trainDamageMult: projectile.trainDamageMult,
      impactCloud: projectile.impactCloud,
      energyInjectorPayload: projectile.energyInjectorPayload,
      proximityPulse: projectile.proximityPulse,
      isBfg: projectile.isBfg,
      isFlame: projectile.isFlame,
      hitboxSize: projectile.hitboxSize,
      hitboxMaxSize: projectile.hitboxMaxSize,
      bodyWidth: projectile.body?.width ?? 0,
      projectileStyle: projectile.projectileStyle,
      projectileBurnVisualStyle: projectile.projectileBurnVisualStyle,
      shotAudioKey: projectile.shotAudioKey,
      shotgunProximityMaxDamageBonus: projectile.shotgunProximityMaxDamageBonus,
      shotgunOriginX: projectile.shotgunOriginX,
      shotgunOriginY: projectile.shotgunOriginY,
      shotgunResolvedRange: projectile.shotgunResolvedRange,
    };
  }

  /**
   * Resolves a technical Phaser contact at the world-owned authority boundary.
   *
   * The PhysicsBinding supplies only a stable target identity and contact geometry. All damage,
   * support delivery, explosion queuing, and projectile consumption decisions happen here so a
   * collider callback cannot become a second gameplay authority.
   */
  private reportPhysicsContact(contact: ProjectilePhysicsContact): boolean {
    if (this.destroyed) return true;
    const projectile = this.projectiles.getById(contact.projectileId);
    if (!projectile || projectile.pendingDestroy || !this.projectiles.activeRecords.has(projectile)) return true;

    const bounceEligible = this.shouldBounceAfterContact(projectile, contact.target);
    if (bounceEligible && contact.target.kind !== 'world-boundary'
      && projectile.bounceProcessedThisStep && projectile.velocityAfterFirstBounce) {
      // Phaser may reflect each collider independently in one step. Restore the first
      // authoritative result before handling the next technical contact.
      projectile.body.velocity.x = projectile.velocityAfterFirstBounce.x;
      projectile.body.velocity.y = projectile.velocityAfterFirstBounce.y;
      return true;
    }
    const usesPenetratingRockContact = contact.target.kind === 'rock' && projectile.penetratesRocks
      && this.shouldBounceAfterContact(projectile, { kind: 'trunk' });
    const impactPoint = bounceEligible || usesPenetratingRockContact
      ? this.resolveContactImpactPoint(projectile, contact)
      : contact.target.kind === 'world-boundary'
        ? { x: contact.x, y: contact.y }
        : { x: projectile.sprite.x, y: projectile.sprite.y };
    if (bounceEligible) {
      const multiplier = projectile.bounceFrictionMultiplier;
      if (multiplier !== undefined && multiplier < 1) {
        projectile.body.velocity.x *= multiplier;
        projectile.body.velocity.y *= multiplier;
      }
      if (contact.target.kind !== 'world-boundary') {
        projectile.bounceProcessedThisStep = true;
        projectile.velocityAfterFirstBounce = {
          x: projectile.body.velocity.x, y: projectile.body.velocity.y,
        };
        this.presentation.playBounceImpact(projectile.id, contact.x, contact.y,
          projectile.body.velocity.x, projectile.body.velocity.y, projectile.color, projectile.projectileStyle);
      }
    }
    let consumed = false;
    switch (contact.target.kind) {
      case 'rock': {
        const resolution = this.resolveWorldImpactCandidate(projectile, {
          projectileId: projectile.id,
          target: { kind: 'rock', id: contact.target.id },
          x: impactPoint.x,
          y: impactPoint.y,
          source: contact.source,
        });
        consumed = resolution.technicalContactConsumed;
        break;
      }
      case 'trunk':
        consumed = this.resolveTrunkPhysicsContact(projectile);
        break;
      case 'base': {
        const resolution = this.resolveWorldImpactCandidate(projectile, {
          projectileId: projectile.id,
          target: { kind: 'base', id: contact.target.id },
          x: impactPoint.x,
          y: impactPoint.y,
          source: contact.source,
        });
        consumed = resolution.technicalContactConsumed;
        break;
      }
      case 'train': {
        const resolution = this.resolveWorldImpactCandidate(projectile, {
          projectileId: projectile.id,
          target: { kind: 'train', id: contact.target.id },
          x: impactPoint.x,
          y: impactPoint.y,
          source: contact.source,
        });
        consumed = resolution.technicalContactConsumed;
        break;
      }
      case 'world-boundary':
        consumed = this.resolveWorldBoundaryPhysicsContact(
          projectile,
          this.createImpactSource(projectile, impactPoint.x, impactPoint.y),
        );
        break;
    }
    if (!consumed && bounceEligible) {
      this.completeAuthoritativeBounce(projectile, impactPoint.x, impactPoint.y, contact.target.kind === 'world-boundary');
    }
    return consumed;
  }

  private resolveContactImpactPoint(
    projectile: ProjectileRuntimeRecord,
    contact: ProjectilePhysicsContact,
  ): { x: number; y: number } {
    const bounds = contact.targetBounds;
    if (!bounds) return { x: contact.x, y: contact.y };
    const line = this.contactLine.setTo(projectile.lastX, projectile.lastY, projectile.sprite.x, projectile.sprite.y);
    const rect = this.contactRect.setTo(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    const hit = findNearestRectangleHit(line, rect, this.contactPoints);
    return hit ? { x: hit.x, y: hit.y } : { x: contact.x, y: contact.y };
  }

  private shouldBounceAfterContact(
    projectile: ProjectileRuntimeRecord,
    target: ProjectilePhysicsContact['target'],
  ): boolean {
    if (projectile.isBfg || hasGaussDischarge(projectile)
      || (projectile.collisionMode === 'overlap' && projectile.piercesTargets === true)
      || projectile.isFlame || hasLeafBlowerCapability(projectile)) return false;
    if (target.kind === 'rock' && projectile.penetratesRocks === true) return false;
    if (projectile.isGrenade && projectile.maxBounces === 0) return false;
    if (projectile.impactCloud && projectile.maxBounces === 0) return false;
    if (projectile.explosion && projectile.maxBounces === 0) return false;
    return target.kind !== 'world-boundary' || !projectile.isBfg;
  }

  private completeAuthoritativeBounce(projectile: ProjectileRuntimeRecord, x: number, y: number, worldBoundary: boolean): void {
    if (this.queueHydraSplit(
      projectile.id, x, y, projectile.body.velocity.x, projectile.body.velocity.y,
    )) return;
    projectile.bounceCount += 1;
    if (worldBoundary) this.presentation.playBounceImpact(
      projectile.id, x, y, projectile.body.velocity.x, projectile.body.velocity.y,
      projectile.color, projectile.projectileStyle,
    );
    if (projectile.bounceCount > projectile.maxBounces) {
      projectile.body.setVelocity(0, 0);
      projectile.body.enable = false;
    }
  }

  private shouldSweepRocks(projectile: ProjectileRuntimeRecord): boolean {
    return projectile.collisionMode === 'sweep'
      && !projectile.isGrenade
      && !projectile.isFlame
      && !projectile.isBfg
      && !projectile.pendingDestroy
      && !projectile.bounceProcessedThisStep
      && !projectile.penetratesRocks;
  }

  private sweepRocks(projectile: ProjectileRuntimeRecord): void {
    const segmentLength = Math.hypot(projectile.sprite.x - projectile.lastX, projectile.sprite.y - projectile.lastY);
    if (segmentLength <= 0.5) return;
    const hit = this.physicsBinding.findNearestRockSweep(
      projectile.lastX, projectile.lastY, projectile.sprite.x, projectile.sprite.y,
      projectile.ignoreRockIndex,
    );
    if (!hit) return;
    const normalLength = Math.hypot(hit.normalX, hit.normalY) || 1;
    let nextVx = projectile.body.velocity.x;
    let nextVy = projectile.body.velocity.y;
    if (Math.abs(hit.normalX) > 0.001) nextVx *= -1;
    if (Math.abs(hit.normalY) > 0.001) nextVy *= -1;
    const frictionMultiplier = projectile.bounceFrictionMultiplier;
    if (frictionMultiplier !== undefined && frictionMultiplier < 1) {
      nextVx *= frictionMultiplier;
      nextVy *= frictionMultiplier;
    }
    projectile.bounceCount += 1;
    projectile.bounceProcessedThisStep = true;
    projectile.velocityAfterFirstBounce = { x: nextVx, y: nextVy };
    const resolution = this.resolveWorldImpactCandidate(projectile, {
      projectileId: projectile.id,
      target: { kind: 'rock', id: hit.rockIndex },
      x: hit.x,
      y: hit.y,
      source: 'physics-collider',
    });
    if (resolution.technicalContactConsumed) return;
    this.presentation.playBounceImpact(
      projectile.id, hit.x, hit.y, nextVx, nextVy, projectile.color, projectile.projectileStyle,
    );
    if (projectile.bounceCount > projectile.maxBounces) {
      projectile.body.reset(hit.x, hit.y);
      projectile.body.setVelocity(0, 0);
      projectile.body.enable = false;
      return;
    }
    const offsetDistance = Math.max(projectile.sprite.displayWidth * 0.5 + 0.5, 1);
    projectile.body.reset(
      hit.x + (hit.normalX / normalLength) * offsetDistance,
      hit.y + (hit.normalY / normalLength) * offsetDistance,
    );
    projectile.body.setVelocity(nextVx, nextVy);
  }

  private completeDirectImpact(
    projectile: ProjectileRuntimeRecord,
    target: ProjectileCombatTargetRef,
    impact: { readonly x: number; readonly y: number },
    outcome: ProjectileDirectImpactOutcome,
  ): boolean {
    if (!outcome.accepted || projectile.pendingDestroy) return false;
    if (projectile.impactCloud) this.projectileImpactEventCallback?.(this.createImpactSource(projectile, impact.x, impact.y));
    const targetKey = target.kind === 'player' ? `players:${target.id}`
      : target.kind === 'enemy' ? `enemies:${target.id}` : undefined;
    if (projectile.enemyHitExplosion) {
      this.lifecycleProcessor.triggerEnemyImpactExplosion(projectile);
      return false;
    }
    if (projectile.explosion) {
      this.lifecycleProcessor.triggerExplosion(projectile, targetKey);
      return !projectile.pendingDestroy;
    }
    this.queueProjectileDestroy(projectile.id);
    return false;
  }

  /**
   * Single authority for canonical World candidates from both collision modes and Phaser.
   * `technicalContactConsumed` preserves the adapter's bounce/stop contract without letting the
   * adapter execute a second domain effect when the same contact was already resolved here.
   */
  private resolveWorldImpact(
    projectile: ProjectileRuntimeRecord,
    candidate: ProjectileImpactCandidate,
  ): ProjectileCollisionOutcome {
    return this.resolveWorldImpactCandidate(projectile, candidate).outcome;
  }

  private resolveWorldImpactCandidate(
    projectile: ProjectileRuntimeRecord,
    candidate: ProjectileImpactCandidate,
  ): ResolvedWorldContact {
    const contactKey = `${candidate.projectileId}:${projectileTargetPhysicalKey(candidate.target)}`;
    const previousTechnicalConsumption = this.resolvedWorldContacts.get(contactKey);
    if (previousTechnicalConsumption !== undefined) {
      return {
        outcome: 'consumed',
        technicalContactConsumed: previousTechnicalConsumption,
      };
    }

    const impact = this.createImpactSource(projectile, candidate.x, candidate.y);
    let technicalContactConsumed = false;
    switch (candidate.target.kind) {
      case 'rock':
        if (!this.rememberPiercingWorldContact(projectile, candidate.target.kind, candidate.target.id)) {
          return { outcome: 'passed', technicalContactConsumed: false };
        }
        technicalContactConsumed = this.resolveRockPhysicsContact(
          projectile,
          candidate.target.id,
          candidate.x,
          candidate.y,
          impact,
        );
        if (projectile.penetratesRocks && this.shouldBounceAfterContact(projectile, { kind: 'trunk' })) {
          this.presentation.playBounceImpact(projectile.id, candidate.x, candidate.y,
            projectile.body.velocity.x, projectile.body.velocity.y, projectile.color, projectile.projectileStyle);
        }
        break;
      case 'base':
        technicalContactConsumed = this.resolveBasePhysicsContact(
          projectile,
          candidate.target.id,
          candidate.x,
          candidate.y,
          impact,
        );
        break;
      case 'train':
        if (!this.rememberPiercingWorldContact(projectile, candidate.target.kind, candidate.target.id)) {
          return { outcome: 'passed', technicalContactConsumed: false };
        }
        technicalContactConsumed = this.resolveTrainPhysicsContact(projectile, impact);
        break;
      case 'construction':
        // Runtime constructions are normalized to `rock` by the target query. Keep a legacy
        // candidate terminal if an adapter violates that contract, without a second identity.
        technicalContactConsumed = false;
        break;
      default:
        this.resolvedWorldContacts.set(contactKey, false);
        return { outcome: 'ignored', technicalContactConsumed: false };
    }

    this.resolvedWorldContacts.set(contactKey, technicalContactConsumed);
    return {
      outcome: shouldPassThroughWorldTarget(projectile) ? 'passed' : 'consumed',
      technicalContactConsumed,
    };
  }

  private rememberPiercingWorldContact(
    projectile: ProjectileRuntimeRecord,
    targetKind: 'rock' | 'train',
    targetId: number | string,
  ): boolean {
    if (projectile.isBfg === true) {
      if (targetKind === 'rock') {
        projectile.bfgHitRocks ??= new Set<number>();
        if (projectile.bfgHitRocks.has(Number(targetId))) return false;
        projectile.bfgHitRocks.add(Number(targetId));
      } else {
        if (projectile.bfgHitTrain) return false;
        projectile.bfgHitTrain = true;
      }
    }
    if (hasGaussDischarge(projectile)
      || (projectile.collisionMode === 'overlap' && projectile.piercesTargets === true
        && !projectile.isBfg && !projectile.isFlame && !hasLeafBlowerCapability(projectile))) {
      if (targetKind === 'rock') {
        projectile.gaussHitRocks ??= new Set<number>();
        if (projectile.gaussHitRocks.has(Number(targetId))) return false;
        projectile.gaussHitRocks.add(Number(targetId));
      } else {
        if (projectile.gaussHitTrain) return false;
        projectile.gaussHitTrain = true;
      }
    }
    if (targetKind === 'rock' && projectile.penetratesRocks) {
      projectile.penetratedRockIds ??= new Set<number>();
      if (projectile.penetratedRockIds.has(Number(targetId))) return false;
      projectile.penetratedRockIds.add(Number(targetId));
    }
    return true;
  }

  private resolveRockPhysicsContact(
    projectile: ProjectileRuntimeRecord,
    rockId: number,
    x: number,
    y: number,
    impact: ProjectileImpactSource,
  ): boolean {
    if (projectile.energyInjectorPayload) {
      if (projectile.supportConsumed) return true;
      projectile.supportConsumed = true;
      this.supportImpactCallback?.(impact, { kind: 'rock', rockId, x, y });
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.impactCloud && projectile.maxBounces === 0) {
      this.projectileImpactEventCallback?.(impact);
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.explosion && projectile.maxBounces === 0) {
      this.triggerProjectileExplosion(projectile.id);
      return true;
    }
    if (projectile.isFlame) {
      if (projectile.hitObstacleIds?.has(rockId)) return false;
      projectile.hitObstacleIds ??= new Set<number>();
      projectile.hitObstacleIds.add(rockId);
      const obstacleKind = this.obstacleKindResolver?.(rockId);
      const multiplier = obstacleKind !== undefined && obstacleKind !== 'rock'
        ? 1
        : projectile.rockDamageMult ?? 1;
      if (multiplier !== 0) this.rockHitCallback?.(rockId, projectile.damage * multiplier, projectile.ownerId);
      return false;
    }
    if (hasLeafBlowerCapability(projectile)) {
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.isGrenade && projectile.maxBounces === 0) return false;

    if (!projectile.isGrenade) {
      const obstacleKind = this.obstacleKindResolver?.(rockId);
      const multiplier = obstacleKind !== undefined && obstacleKind !== 'rock'
        ? 1
        : projectile.rockDamageMult ?? 1;
      if (multiplier !== 0) this.rockHitCallback?.(rockId, projectile.damage * multiplier, projectile.ownerId);
    }
    return false;
  }

  private resolveTrunkPhysicsContact(projectile: ProjectileRuntimeRecord): boolean {
    if (projectile.impactCloud && projectile.maxBounces === 0) {
      this.projectileImpactEventCallback?.(this.createImpactSource(projectile));
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.explosion && projectile.maxBounces === 0) {
      this.triggerProjectileExplosion(projectile.id);
      return true;
    }
    if (hasLeafBlowerCapability(projectile)) {
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    return false;
  }

  private resolveBasePhysicsContact(
    projectile: ProjectileRuntimeRecord,
    baseId: string,
    x: number,
    y: number,
    impact: ProjectileImpactSource,
  ): boolean {
    if (projectile.energyInjectorPayload) {
      if (projectile.supportConsumed) return true;
      projectile.supportConsumed = true;
      this.supportImpactCallback?.(impact, { kind: 'base', x, y });
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.impactCloud && projectile.maxBounces === 0) {
      this.applyBaseContact(projectile, baseId, impact);
      this.projectileImpactEventCallback?.(impact);
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.explosion && projectile.maxBounces === 0) {
      this.triggerProjectileExplosion(projectile.id);
      return true;
    }
    if (hasLeafBlowerCapability(projectile)) {
      this.applyBaseContact(projectile, baseId, impact);
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.isFlame) {
      this.applyBaseContact(projectile, baseId, impact);
      return false;
    }
    if (projectile.isGrenade && projectile.maxBounces === 0) return false;
    if (!projectile.explosion) this.applyBaseContact(projectile, baseId, impact);
    return false;
  }

  private applyBaseContact(
    projectile: ProjectileRuntimeRecord,
    baseId: string,
    impact: ProjectileImpactSource,
  ): void {
    if (projectile.damage <= 0 || projectile.hitBaseIds?.has(baseId)) return;
    projectile.hitBaseIds ??= new Set<string>();
    projectile.hitBaseIds.add(baseId);
    this.baseHitCallback?.(baseId, projectile.damage, projectile.ownerId, impact);
  }

  private resolveTrainPhysicsContact(
    projectile: ProjectileRuntimeRecord,
    impact: ProjectileImpactSource,
  ): boolean {
    const appliesTrainDamage = !projectile.isTranslocatorPuck && (projectile.trainDamageMult ?? 1) !== 0;
    const applyTrainDamage = (): void => {
      if (appliesTrainDamage) {
        this.trainImpactPort?.resolveTrainImpact({
          damage: projectile.damage * (projectile.trainDamageMult ?? 1),
          attributionId: projectile.ownerId,
        });
      }
    };
    if (projectile.impactCloud && projectile.maxBounces === 0) {
      applyTrainDamage();
      this.projectileImpactEventCallback?.(impact);
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.explosion && projectile.maxBounces === 0) {
      if (!projectile.miniRocketSpent) applyTrainDamage();
      this.triggerProjectileExplosion(projectile.id);
      return true;
    }
    if (projectile.isFlame || hasLeafBlowerCapability(projectile)) {
      applyTrainDamage();
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    applyTrainDamage();
    return projectile.isGrenade && projectile.maxBounces === 0;
  }

  private resolveWorldBoundaryPhysicsContact(
    projectile: ProjectileRuntimeRecord,
    impact: ProjectileImpactSource,
  ): boolean {
    if (projectile.isBfg) {
      projectile.bounceCount = projectile.maxBounces + 1;
      return false;
    }
    if (projectile.impactCloud && projectile.maxBounces === 0) {
      this.projectileImpactEventCallback?.(impact);
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.explosion && projectile.maxBounces === 0) {
      this.triggerProjectileExplosion(projectile.id);
      return true;
    }
    if (hasLeafBlowerCapability(projectile)) {
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    return false;
  }

  /** Liefert ausschließlich die Client-Projektion; interne Runtime-Records verlassen die World nicht. */
  readProjectileReplication(sink: (record: ProjectileReplicationRecord) => void): void {
    for (const projectile of this.projectiles.activeRecords) {
      const replication: ProjectileReplicationRecord = {
        id: projectile.id,
        createdAt: projectile.createdAt,
        static: {
          id: projectile.id,
          ownerId: projectile.ownerId,
          color: projectile.color,
          allowTeamDamage: projectile.allowTeamDamage,
          ownerColor: projectile.ownerColor,
          visualMuzzleOrigin: projectile.visualMuzzleOrigin,
          projectileVisualScale: projectile.projectileVisualScale,
          smokeTrailColor: projectile.smokeTrailColor,
          style: projectile.projectileStyle,
          sporeVisualVariant: projectile.sporeVisualVariant,
          bulletVisualPreset: projectile.bulletVisualPreset,
          grenadeVisualPreset: projectile.grenadeVisualPreset,
          energyBallVariant: projectile.energyBallVariant,
          velocityDecay: projectile.velocityDecay,
          tracer: projectile.tracerConfig,
          shotAudioKey: projectile.shotAudioKey,
          suppressSpawnFx: projectile.suppressSpawnFx,
        },
        dynamic: {
          id: projectile.id,
          x: Math.round(projectile.sprite.x),
          y: Math.round(projectile.sprite.y),
          vx: Math.round(projectile.body.velocity.x),
          vy: Math.round(projectile.body.velocity.y),
          size: Math.round(projectile.sprite.displayWidth),
          miniRocketPhase: projectile.miniRocketPhase,
          miniRocketCascadeStage: (projectile.miniRocketCascadeDamageBonusPerExplosion ?? 0) > 0
            ? projectile.miniRocketExplosionIndex
            : undefined,
          projectileBurnVisualStyle: projectile.projectileBurnVisualStyle,
          burning: this.hasVisibleProjectileBurn(projectile) || undefined,
        },
      };
      sink(replication);
    }
  }

  spawnProjectile(request: ProjectileSpawnRequest): ProjectileSpawnResult {
    if (this.destroyed) return null;
    const { origin } = request;
    return this.spawnResolved(
      origin.x,
      origin.y,
      origin.angle,
      request.provenance.allegiance.ownerId,
      toProjectileSpawnConfig(request),
      request.provenance,
    );
  }

  spawnProjectileConfig(
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
  ): ProjectileId {
    if (this.destroyed) return -1;
    return this.spawnResolved(x, y, angle, ownerId, cfg, createProjectileProvenance(ownerId, cfg));
  }

  destroyProjectile(id: ProjectileId): void {
    const record = this.projectiles.getById(id);
    if (!record) return;
    const index = this.projectiles.indexOfStepEntry(record);
    if (index === -1) return;
    this.releaseProjectile(record);
    this.projectiles.dropStepEntryAt(index);
  }

  /**
   * Owner-controlled deferred cleanup for technical contacts.
   *
   * The record remains addressable until the normal teardown pass, but leaves the active set
   * immediately so no later interaction in the current host frame can consume it again.
   */
  private queueProjectileDestroy(id: ProjectileId): void {
    const record = this.projectiles.getById(id);
    if (!record || record.pendingDestroy) return;
    record.pendingDestroy = true;
    record.body.setVelocity(0, 0);
    record.body.enable = false;
    this.projectiles.deactivate(record);
  }

  /**
   * Resolves a Hydra impact at the authoritative World boundary.
   *
   * The Physics Binding supplies only the contact point and post-bounce velocity. Split limits,
   * range, child payload, provenance and deferred materialization are all owner decisions.
   */
  private queueHydraSplit(
    projectileId: ProjectileId,
    impactX: number,
    impactY: number,
    outgoingVx: number,
    outgoingVy: number,
  ): boolean {
    if (this.destroyed) return false;
    const projectile = this.projectiles.getById(projectileId);
    if (!projectile || projectile.pendingDestroy || !this.projectiles.activeRecords.has(projectile)) return false;

    const splitCount = Math.max(0, Math.floor(projectile.splitCount ?? 0));
    if (splitCount <= 0) return false;

    const nextBounceCount = projectile.bounceCount + 1;
    const outgoingSpeed = Math.hypot(outgoingVx, outgoingVy);
    const nowMs = this.hostNowMs();
    const timeBubbleFactor = clampProjectileTimeFactor(
      this.projectileTimeFieldPort?.getMovementFactor(
        impactX,
        impactY,
        nowMs,
        projectile.provenance,
      ) ?? projectile.timeBubbleFactor ?? 1,
    );
    const childBaseSpeed = outgoingSpeed / timeBubbleFactor;
    const remainingRangePx = this.getRemainingRangeAfterImpact(projectile, impactX, impactY);
    const childAngles = this.getHydraSplitAngles(
      Math.atan2(outgoingVy, outgoingVx),
      splitCount,
      projectile.splitSpread ?? 0,
    );

    // Hydra owns the bounce terminal: a failed split is still consumed exactly as before.
    if (nextBounceCount > projectile.maxBounces
      || outgoingSpeed <= 0.001
      || remainingRangePx <= 0.5
      || childAngles.length === 0) {
      projectile.bounceCount = projectile.maxBounces + 1;
      projectile.body.reset(impactX, impactY);
      this.queueProjectileDestroy(projectile.id);
      return true;
    }

    const splitFactor = projectile.splitFactor ?? 1;
    const childSize = Math.max(4, (projectile.sprite.displayWidth / splitCount) * splitFactor);
    const childDamage = Math.max(1, (projectile.damage / splitCount) * splitFactor);
    const childAdrenalinGain = Math.max(0, (projectile.adrenalinGain / splitCount) * splitFactor);
    const childLifetime = (remainingRangePx / childBaseSpeed) * 1000;
    const childProvenance: ProjectileProvenance = {
      ...projectile.provenance,
      lineage: {
        ...projectile.provenance.lineage,
        parentProjectileId: projectile.id,
      },
    };

    projectile.pendingHydraSplit = {
      x: impactX,
      y: impactY,
      angles: childAngles,
    };
    this.queueProjectileDestroy(projectile.id);

    for (const childAngle of childAngles) {
      this.pendingNextStageSpawns.push({
        x: impactX,
        y: impactY,
        angle: childAngle,
        ownerId: projectile.ownerId,
        hostNowMs: nowMs,
        provenance: childProvenance,
        readyAfterCompletedStages: this.hasStartedInteractionStage
          ? this.completedInteractionStages
          : this.completedInteractionStages + 1,
        cfg: {
          ...createInheritedProjectilePayload(projectile),
          speed: childBaseSpeed,
          size: childSize,
          damage: childDamage,
          color: projectile.color,
          allowTeamDamage: projectile.allowTeamDamage,
          ignoreBaseCollisions: projectile.ignoreBaseCollisions,
          ownerColor: projectile.ownerColor,
          lifetime: childLifetime,
          maxBounces: projectile.maxBounces,
          isGrenade: projectile.isGrenade,
          isTranslocatorPuck: projectile.isTranslocatorPuck,
          collisionMode: projectile.collisionMode,
          adrenalinGain: childAdrenalinGain,
          sourceId: projectile.sourceId,
          explosion: projectile.explosion,
          enemyHitExplosion: projectile.enemyHitExplosion,
          impactCloud: projectile.impactCloud,
          sporeVisualVariant: projectile.sporeVisualVariant,
          homing: projectile.splitHoming ?? projectile.homing,
          projectileVisualScale: projectile.projectileVisualScale,
          smokeTrailColor: projectile.smokeTrailColor,
          fuseTime: projectile.fuseTime,
          grenadeEffect: projectile.grenadeEffect,
          projectileStyle: projectile.projectileStyle,
          bulletVisualPreset: projectile.bulletVisualPreset,
          grenadeVisualPreset: projectile.grenadeVisualPreset,
          energyBallVariant: projectile.energyBallVariant,
          tracerConfig: projectile.tracerConfig,
          detonable: projectile.detonable,
          detonator: projectile.detonator,
          rockDamageMult: projectile.rockDamageMult,
          trainDamageMult: projectile.trainDamageMult,
          baseDamageMult: projectile.baseDamageMult,
          isFlame: projectile.isFlame,
          hitboxGrowRate: projectile.hitboxGrowRate,
          hitboxMaxSize: projectile.hitboxMaxSize,
          velocityDecay: projectile.velocityDecay,
          burnDurationMs: projectile.burnDurationMs,
          burnDamagePerTick: projectile.burnDamagePerTick,
          projectileBurnVisualStyle: projectile.projectileBurnVisualStyle,
          leafBlowerMinKnockback: projectile.leafBlowerMinKnockback,
          leafBlowerMaxKnockback: projectile.leafBlowerMaxKnockback,
          leafBlowerSelfPush: projectile.leafBlowerSelfPush,
          isBfg: projectile.isBfg,
          piercesTargets: projectile.piercesTargets,
          penetrationCount: projectile.penetrationRemaining,
          penetrationDamageRetention: projectile.penetrationDamageRetention,
          penetratesRocks: projectile.penetratesRocks,
          flamePiercing: projectile.flamePierceHitIds !== undefined,
          leafBlowerDeflectsProjectiles: projectile.leafBlowerDeflectsProjectiles,
          proximityPulse: projectile.proximityPulse,
          gaussChainRadius: projectile.gaussChainRadius,
          gaussChainDamageFactor: projectile.gaussChainDamageFactor,
          frictionDelayMs: projectile.frictionDelayMs,
          airFrictionDecayPerSec: projectile.airFrictionDecayPerSec,
          bounceFrictionMultiplier: projectile.bounceFrictionMultiplier,
          stopSpeedThreshold: projectile.stopSpeedThreshold,
          sourceSlot: projectile.sourceSlot,
          shotAudioKey: projectile.shotAudioKey,
          splitCount: projectile.splitCount,
          splitSpread: projectile.splitSpread,
          splitFactor: projectile.splitFactor,
          splitHoming: projectile.splitHoming,
          initialBounceCount: nextBounceCount,
          remainingRangePx,
          suppressSpawnFx: true,
        },
      });
    }

    return true;
  }

  private releaseProjectile(record: ProjectileRuntimeRecord): void {
    const handle = this.physicsHandles.get(record.id);
    if (!handle) return;
    this.physicsHandles.delete(record.id);
    this.removeCapabilityIds(record.id);
    this.projectiles.detach(record);
    record.hitObstacleIds?.clear();
    record.hitBaseIds?.clear();
    const lifecycle: ProjectileLifecycleOutcome = record.miniRocketSpent
      ? { kind: 'mini-rocket-destroyed', projectileId: record.id }
      : {
          kind: 'resolved',
          projectileId: record.id,
          provenance: record.provenance,
          ...(record.ak47ShotId === undefined ? {} : {
            reaction: {
              ak47: {
                shotId: record.ak47ShotId,
                fireSuperiorityShot: record.ak47FireSuperiorityShot === true,
                hitConfirmed: record.ak47HitConfirmed === true,
              },
            },
          }),
        };
    this.projectileResolvedCallback?.(lifecycle);
    this.presentation.destroyProjectileVisuals({
      id: record.id, ownerId: record.ownerId, x: record.sprite.x, y: record.sprite.y,
      vx: record.body.velocity.x, vy: record.body.velocity.y, size: record.sprite.displayWidth,
      color: record.color, style: record.projectileStyle,
      energyBallVariant: record.energyBallVariant, sporeVisualVariant: record.sporeVisualVariant,
      pendingHydraSplit: record.pendingHydraSplit,
      destroyX: record.pendingHydraSplit?.x ?? record.sprite.x,
      destroyY: record.pendingHydraSplit?.y ?? record.sprite.y,
      destroyScale: record.sprite.displayWidth / 16,
    });
    this.physicsBinding.releaseProjectileResources(handle);
  }

  searchDetonableProjectiles(request: ProjectileDetonationSearchRequest): readonly ProjectileDetonationTarget[] {
    if (this.destroyed) return [];
    const line = new Phaser.Geom.Line(request.startX, request.startY, request.endX, request.endY);
    const targets: ProjectileDetonationTarget[] = [];
    for (const id of this.detonableIds) {
      const projectile = this.projectiles.getById(id);
      if (!projectile?.detonable) continue;
      if (!request.detonator.triggerTags.includes(projectile.detonable.tag)) continue;
      if (!projectile.detonable.allowCrossTeam && projectile.ownerId !== request.shooterId) continue;
      if (!Phaser.Geom.Intersects.LineToRectangle(line, projectile.sprite.getBounds())) continue;
      targets.push(createDetonationTarget(projectile));
    }
    return targets;
  }

  detonateProjectile(
    projectileId: ProjectileId,
    detonatorOwnerId: string,
  ): ProjectileDetonationOutcome | null {
    if (this.destroyed || !this.detonableIds.has(projectileId)) return null;
    const projectile = this.projectiles.getById(projectileId);
    if (!projectile?.detonable) return null;
    const target = createDetonationTarget(projectile);
    this.destroyProjectile(projectileId);
    return { ...target, detonatorOwnerId };
  }

  detonateOverlappingProjectiles(): readonly ProjectileDetonationOutcome[] {
    if (this.destroyed) return [];
    const outcomes: ProjectileDetonationOutcome[] = [];
    for (const detonator of this.projectiles.activeRecords) {
      if (!this.detonatorIds.has(detonator.id)) continue;
      for (const target of this.projectiles.activeRecords) {
        if (target.id === detonator.id || !this.detonableIds.has(target.id) || !target.detonable) continue;
        if (!detonator.detonator?.triggerTags.includes(target.detonable.tag)) continue;
        if (!target.detonable.allowCrossTeam && target.ownerId !== detonator.ownerId) continue;
        if (!boundsOverlap(detonator.sprite.getBounds(), target.sprite.getBounds())) continue;
        const result = this.detonateProjectile(target.id, detonator.ownerId);
        if (result) outcomes.push(result);
      }
    }
    return outcomes;
  }

  spawnPuck(request: TranslocatorPuckSpawnRequest): ProjectileId {
    if (this.destroyed) return -1;
    return this.spawnResolved(request.x, request.y, request.angle, request.ownerId, {
      speed: request.speed,
      size: request.size,
      damage: 0,
      color: request.color,
      ownerColor: request.ownerColor,
      lifetime: request.lifetimeMs,
      maxBounces: request.maxBounces,
      isGrenade: true,
      isTranslocatorPuck: true,
      adrenalinGain: 0,
      sourceId: request.sourceId,
      projectileStyle: 'translocator_puck',
      frictionDelayMs: request.frictionDelayMs,
      airFrictionDecayPerSec: request.airFrictionDecayPerSec,
      bounceFrictionMultiplier: request.bounceFrictionMultiplier,
      stopSpeedThreshold: request.stopSpeedThreshold,
    }, createSingleOwnerProvenance(request.ownerId, { weaponSourceId: request.sourceId }));
  }

  getPuckPosition(id: ProjectileId): { x: number; y: number } | null {
    if (!this.translocatorPuckIds.has(id)) return null;
    const record = this.projectiles.getById(id);
    if (!record || record.pendingDestroy || !this.projectiles.activeRecords.has(record)) return null;
    return { x: record.sprite.x, y: record.sprite.y };
  }

  consumePuck(id: ProjectileId): boolean {
    if (!this.translocatorPuckIds.has(id)) return false;
    const record = this.projectiles.getById(id);
    if (!record || record.pendingDestroy || !this.projectiles.activeRecords.has(record)) return false;
    this.destroyProjectile(id);
    return true;
  }

  getTravelSamples(): readonly ProjectileTravelSample[] {
    this.travelSamples.length = 0;
    if (this.destroyed) return this.travelSamples;
    for (const projectileId of this.travelEffectIds) {
      const record = this.projectiles.getById(projectileId);
      if (!record || record.pendingDestroy || !this.projectiles.activeRecords.has(record) || !record.sprite.active) continue;

      const pathEffect = createTravelPathEffect(record);
      this.travelSamples.push({
        projectileId: record.id,
        fromX: record.lastX,
        fromY: record.lastY,
        toX: record.sprite.x,
        toY: record.sprite.y,
        provenance: record.provenance,
        capabilities: {
          canReceiveFireImbue: record.canReceiveFireImbue === true && !record.isGrenade && !record.isFlame,
          pathEffect,
        },
      });
    }
    return this.travelSamples;
  }

  addBurnAugment(projectileId: ProjectileId, augment: ProjectileBurnAugment): boolean {
    if (this.destroyed) return false;
    const record = this.projectiles.getById(projectileId);
    if (!record || record.pendingDestroy || !this.projectiles.activeRecords.has(record)) return false;
    if (!record.canReceiveFireImbue || record.isGrenade || record.isFlame) return false;

    const current = this.burnAugments.get(projectileId)
      ?? (record.supplementalBurnOnHit
        ? {
          burn: record.supplementalBurnOnHit,
          provenance: record.supplementalBurnProvenance ?? record.provenance,
        }
        : undefined);
    if (current && burnDps(augment.burn) <= burnDps(current.burn)) return false;

    record.supplementalBurnOnHit = { ...augment.burn };
    record.supplementalBurnProvenance = augment.provenance;
    this.burnAugments.set(projectileId, augment);
    return true;
  }

  getThreatSamples(): readonly ProjectileThreatSample[] {
    this.threatSamples.length = 0;
    if (this.destroyed) return this.threatSamples;
    for (const record of this.projectiles.activeRecords) {
      if (!record.sprite.active) continue;
      const radius = Math.max(record.sprite.displayWidth, record.sprite.displayHeight) * 0.5;
      this.threatSamples.push({
        id: record.id,
        x: record.sprite.x,
        y: record.sprite.y,
        vx: record.body.velocity.x,
        vy: record.body.velocity.y,
        radius,
        provenance: record.provenance,
        dodgeRelevant: !record.isGrenade && !record.isFlame,
      });
    }
    return this.threatSamples;
  }

  getSummary(): ProjectileDiagnosticsSummary {
    this.activeProjectilesByOwner.clear();
    for (const record of this.projectiles.activeRecords) {
      this.activeProjectilesByOwner.set(
        record.provenance.allegiance.ownerId,
        (this.activeProjectilesByOwner.get(record.provenance.allegiance.ownerId) ?? 0) + 1,
      );
    }
    return {
      activeCount: this.projectiles.activeCount,
      activeProjectilesByOwner: this.activeProjectilesByOwner,
    };
  }

  hasActiveBfgProjectile(): boolean {
    for (const record of this.projectiles.activeRecords) {
      if (record.isBfg === true && record.sprite.active) return true;
    }
    return false;
  }

  /**
   * Host Frame Port: der Owner taktet zuerst den Runtime-Core und reicht danach ausschließlich
   * dessen Ergebnisse an den privaten Lifecycle-Processor weiter.
   */
  runHostProjectileStage(deltaMs: number, nowMs: number): ProjectileHostStageResult {
    if (this.destroyed) return emptyHostStageResult();
    this.setHostFrameTime(nowMs);
    const coreStage = this.flightProcessor.run(this.projectiles.stepOrder, deltaMs, nowMs);
    const stage = this.lifecycleProcessor.run(this.projectiles.stepOrder, coreStage);
    this.runMiniRocketStateStage();
    this.presentation.syncHostRenderers(this.presentationProjectiles);
    return stage;
  }

  setProjectileTimeFieldPort(port: ProjectileTimeFieldPort | null): void {
    this.projectileTimeFieldPort = port;
    this.flightProcessor.setTimeFieldPort(this.timeBubbleMovementPort ?? port);
  }

  setProjectileTargetQueryPort(port: ProjectileTargetQueryPort | null): void {
    this.homingController.setTargetQueryPort(port);
  }

  setProjectileTargetabilityPort(port: ProjectileTargetabilityPort | null): void {
    this.targetabilityPort = port;
    this.homingController.setTargetabilityPort(port);
  }

  /** Binds owner-position and lifecycle effects without exposing Runtime records to gameplay. */
  setProjectileMiniRocketStatePort(port: ProjectileMiniRocketStatePort | null): void {
    this.miniRocketStatePort = port;
  }

  setProjectileCollisionTargetQueryPort(port: ProjectileCollisionTargetQueryPort | null): void {
    this.collisionTargetQueryPort = port;
  }

  setProjectileWorldBlockerPort(port: ProjectileWorldBlockerPort | null): void {
    this.worldBlockerPort = port;
  }

  setProjectileBarrierPort(port: ProjectileBarrierPort | null): void {
    this.barrierPort = port;
  }

  setProjectileCombatPort(port: ProjectileCombatPort | null): void {
    this.directImpactPort = port;
  }

  readDetonableProjectiles(sink: (sample: ProjectileDetonableSample) => void): void {
    for (const projectileId of this.detonableIds) {
      const record = this.projectiles.getById(projectileId);
      if (!record || record.pendingDestroy || !this.projectiles.activeRecords.has(record) || !record.detonable) continue;
      sink({
        projectileId: record.id,
        ownerId: record.ownerId,
        x: record.sprite.x,
        y: record.sprite.y,
        tag: record.detonable.tag,
        allowCrossTeam: record.detonable.allowCrossTeam,
      });
    }
  }

  completeProjectileExplosion(projectileId: ProjectileId, outcome: ProjectileExplosionOutcome): void {
    void outcome;
    this.resumeMiniRocketExplosion(projectileId);
  }

  private triggerProjectileExplosion(id: ProjectileId, impactTargetKey?: string): boolean {
    const projectile = this.projectiles.getById(id);
    return projectile !== undefined && !projectile.pendingDestroy
      && this.lifecycleProcessor.triggerExplosion(projectile, impactTargetKey);
  }

  private resumeMiniRocketExplosion(projectileId: ProjectileId): void {
    const projectile = this.projectiles.getById(projectileId);
    if (!projectile || ((projectile.multiExplosionsRemaining ?? 0) <= 0 && !projectile.miniRocketSpent)) return;
    projectile.pendingExplosion = false;
    this.resetHomingState(projectile);
    if (projectile.miniRocketStageRangePx !== undefined) {
      this.miniRocketProcessor.completeExplosion(projectile);
    }
  }

  /**
   * Host Frame: externe Barrieren, Projectile↔Projectile-Deflexion und Target-Kandidaten.
   *
   * Die Stage steht dort, wo die Interaktion fachlich hingehört – vor Flight/Expiry und nach den
   * Travel-/Environment-Schritten des Frames.
   */
  runHostInteractionStage(nowMs: number): void {
    if (this.destroyed) return;
    this.flushPendingNextStageSpawns();
    this.hasStartedInteractionStage = true;
    this.interactionNowMs = nowMs;
    this.setHostFrameTime(nowMs);
    try {
      this.runBarrierStage(nowMs);
      this.runDeflectionStage(nowMs);
      this.collisionProcessor.run(this.projectiles.activeRecords, nowMs, this.collisionDependencies);
    } finally {
      this.completedInteractionStages += 1;
    }
  }

  private flushPendingNextStageSpawns(): void {
    const pendingCount = this.pendingNextStageSpawns.length;
    let retainedCount = 0;
    for (let index = 0; index < pendingCount; index += 1) {
      const pending = this.pendingNextStageSpawns[index];
      if (pending.readyAfterCompletedStages > this.completedInteractionStages) {
        this.pendingNextStageSpawns[retainedCount] = pending;
        retainedCount += 1;
        continue;
      }
      this.spawnResolved(
        pending.x,
        pending.y,
        pending.angle,
        pending.ownerId,
        pending.cfg,
        pending.provenance,
        pending.hostNowMs,
      );
    }
    if (retainedCount < pendingCount) {
      this.pendingNextStageSpawns.splice(retainedCount, pendingCount - retainedCount);
    }
  }

  private getHydraSplitAngles(baseAngle: number, splitCount: number, splitSpreadDeg: number): number[] {
    if (splitCount <= 0) return [];

    const half = Math.floor(splitCount / 2);
    const offsets: number[] = [];
    if (splitCount % 2 === 1) {
      for (let index = -half; index <= half; index += 1) offsets.push(index * splitSpreadDeg);
    } else {
      for (let index = -half; index <= -1; index += 1) offsets.push(index * splitSpreadDeg);
      for (let index = 1; index <= half; index += 1) offsets.push(index * splitSpreadDeg);
    }

    return offsets.map((offsetDeg) => baseAngle + (offsetDeg * Math.PI) / 180);
  }

  private getRemainingRangeAfterImpact(
    projectile: ProjectileRuntimeRecord,
    impactX: number,
    impactY: number,
  ): number {
    const baseRange = projectile.remainingRangePx
      ?? (Math.max(projectile.initialSpeed ?? Math.hypot(
        projectile.body.velocity.x,
        projectile.body.velocity.y,
      ), 0) * projectile.lifetime) / 1000;
    const impactDistance = Math.hypot(
      impactX - projectile.lastX,
      impactY - projectile.lastY,
    );
    return Math.max(0, baseRange - impactDistance);
  }

  /**
   * World-space Barriere vor jeder normalen Target-Interaction.
   *
   * Die Entscheidung trifft der Barrier-Owner hinter dem Port; Absorption und Reflexion mutieren
   * das Projectile ausschließlich hier.
   */
  private runBarrierStage(nowMs: number): void {
    const port = this.barrierPort;
    if (!port) return;
    for (const record of this.projectiles.activeRecords) {
      if (record.pendingDestroy) continue;
      // Geworfene Utilities passieren; nur übernehmbare Wurfgeschosse hält die Barriere auf.
      const capturable = record.grenadeEffect?.type === 'spawn_enemy';
      if (record.isGrenade && !capturable) continue;
      if (record.miniRocketDeferredExplosion || record.miniRocketSpent) continue;

      const resolution = port.resolveBarrier({
        projectileId: record.id,
        provenance: record.provenance,
        x: record.sprite.x,
        y: record.sprite.y,
        velocityX: record.body.velocity.x,
        velocityY: record.body.velocity.y,
        isGrenade: record.isGrenade,
        capturable,
        allowTeamDamage: record.allowTeamDamage === true,
        damage: record.damage,
        nowMs,
      });
      if (resolution.kind === 'passed') continue;
      this.applyBarrierResolution(record, resolution, nowMs);
    }
  }

  private applyBarrierResolution(
    record: ProjectileRuntimeRecord,
    resolution: ProjectileBarrierResolution,
    nowMs: number,
  ): void {
    if (resolution.kind === 'absorbed') {
      this.destroyProjectile(record.id);
      return;
    }
    if (resolution.kind !== 'reflected') return;
    const speed = Math.hypot(record.body.velocity.x, record.body.velocity.y) || 400;
    this.spawnReflectedProjectile(record, {
      x: record.sprite.x,
      y: record.sprite.y,
      angle: resolution.angle,
      speed,
      ownerId: resolution.attributionId,
      allegiance: resolution.allegiance,
      damage: resolution.keepGrenade ? 0 : record.damage,
      color: resolution.keepGrenade ? resolution.ownerColor : record.color,
      ownerColor: resolution.ownerColor,
      sourceId: resolution.sourceId,
      sourceSlot: resolution.sourceSlot,
      keepGrenade: resolution.keepGrenade,
      nowMs,
    });
    this.destroyProjectile(record.id);
  }

  /**
   * Projectile↔Projectile-Interaktion: ein Luftstoß übernimmt gegnerische Geschosse.
   *
   * Beide Seiten sind Runtime-Records, deshalb bleibt die gesamte Auflösung beim Owner; der
   * auslösende Gameplay-Code sieht nie einen Record.
   */
  private runDeflectionStage(nowMs: number): void {
    if (this.deflectorIds.size === 0) return;
    for (const target of this.projectiles.activeRecords) {
      if (target.pendingDestroy) continue;
      if (target.leafBlowerDeflectsProjectiles === true) continue;
      // Geworfene Utilities fliegen weiter; nur echte Geschosse werden umgelenkt.
      if (target.isGrenade) continue;
      if (target.miniRocketDeferredExplosion || target.miniRocketSpent) continue;

      for (const deflectorId of this.deflectorIds) {
        if (this.deflectProjectile(target.id, deflectorId, nowMs)) break;
      }
    }
  }

  deflectProjectile(projectileId: ProjectileId, deflectorId: ProjectileId, nowMs: number): boolean {
    const target = this.projectiles.getById(projectileId);
    const blower = this.projectiles.getById(deflectorId);
    if (!target || !blower || target === blower) return false;
    if (target.pendingDestroy || blower.pendingDestroy) return false;
    if (!this.projectiles.activeRecords.has(target) || !this.projectiles.activeRecords.has(blower)) return false;
    if (target.leafBlowerDeflectsProjectiles === true || target.isGrenade) return false;
    if (target.miniRocketDeferredExplosion || target.miniRocketSpent) return false;
    const blowerOwnerId = blower.provenance.allegiance.ownerId;
    if (blowerOwnerId === target.provenance.allegiance.ownerId) return false;
    if (this.targetabilityPort && !this.targetabilityPort.canDamageOwner(
      target.provenance,
      blowerOwnerId,
      target.allowTeamDamage === true,
    )) return false;
    if (!boundsOverlap(target.sprite.getBounds(), blower.sprite.getBounds())) return false;

    const blowLength = Math.hypot(blower.body.velocity.x, blower.body.velocity.y);
    const angle = blowLength > 0.001
      ? Math.atan2(blower.body.velocity.y, blower.body.velocity.x)
      : Math.atan2(-target.body.velocity.y, -target.body.velocity.x);
    const speed = Math.hypot(target.body.velocity.x, target.body.velocity.y) || 400;

    this.spawnReflectedProjectile(target, {
      x: target.sprite.x,
      y: target.sprite.y,
      angle,
      speed,
      ownerId: blower.provenance.allegiance.ownerId,
      allegiance: blower.provenance.allegiance,
      damage: target.damage,
      color: target.color,
      ownerColor: blower.ownerColor ?? target.color,
      sourceId: 'weapon.leaf_blower_deflect',
      sourceSlot: 'weapon1',
      keepGrenade: false,
      nowMs,
    });
    this.destroyProjectile(target.id);
    return true;
  }

  /** Target-lokale Defense: Absorption entfernt, Reflexion erzeugt den Nachfolger beim Owner. */
  private applyDefense(
    record: ProjectileRuntimeRecord,
    defense: ProjectileDefenseResolution,
    candidate: ProjectileImpactCandidate,
  ): void {
    if (defense.kind === 'reflected' && defense.damageFactor > 0) {
      this.spawnReflectedProjectile(record, {
        x: defense.originX,
        y: defense.originY,
        angle: Math.atan2(-record.body.velocity.y, -record.body.velocity.x),
        speed: Math.hypot(record.body.velocity.x, record.body.velocity.y),
        ownerId: defense.attributionId,
        allegiance: defense.allegiance,
        damage: record.damage * defense.damageFactor,
        color: record.color,
        ownerColor: record.ownerColor ?? record.color,
        sourceId: defense.sourceId,
        sourceSlot: defense.sourceSlot,
        keepGrenade: false,
        nowMs: this.interactionNowMs,
      });
    }
    this.destroyProjectile(record.id);
  }

  /**
   * Erzeugt den Nachfolger eines übernommenen Projectiles.
   *
   * Attribution und Allegiance wechseln, Gameplay-Source und Abstammung bleiben unterscheidbar;
   * die Restwirkung des Ursprungs bleibt erhalten.
   */
  private spawnReflectedProjectile(
    record: ProjectileRuntimeRecord,
    options: ReflectedProjectileOptions,
  ): void {
    const elapsed = Math.max(0, options.nowMs - record.createdAt);
    const remainingFuse = Math.max(1, (record.fuseTime ?? record.lifetime) - elapsed);
    const remainingLifetime = Math.max(1, record.lifetime - elapsed);
    const cfg: ProjectileSpawnConfig = {
      ...createInheritedProjectilePayload(record),
      speed: options.speed,
      size: Math.max(1, record.sprite.displayWidth),
      damage: options.damage,
      color: options.color,
      ownerColor: options.ownerColor,
      lifetime: options.keepGrenade ? remainingFuse : remainingLifetime,
      maxBounces: options.keepGrenade ? record.maxBounces : 0,
      isGrenade: options.keepGrenade,
      adrenalinGain: 0,
      sourceId: options.sourceId,
      projectileStyle: record.projectileStyle,
      reflected: true,
      sourceSlot: options.sourceSlot,
      ...(options.keepGrenade
        ? {
          fuseTime: remainingFuse,
          grenadeVisualPreset: record.grenadeVisualPreset,
          frictionDelayMs: record.frictionDelayMs,
          airFrictionDecayPerSec: record.airFrictionDecayPerSec,
          bounceFrictionMultiplier: record.bounceFrictionMultiplier,
          stopSpeedThreshold: record.stopSpeedThreshold,
        }
        : {
          bulletVisualPreset: record.bulletVisualPreset,
          tracerConfig: record.tracerConfig,
        }),
    };
    const provenance: ProjectileProvenance = {
      gameplaySourceId: record.provenance.gameplaySourceId,
      attributionId: options.ownerId,
      allegiance: options.allegiance,
      weaponSourceId: options.sourceId,
      sourceSlot: options.sourceSlot,
      sourceTurretId: record.provenance.sourceTurretId,
      lineage: {
        ...record.provenance.lineage,
        reflected: true,
        parentProjectileId: record.id,
      },
      correlation: record.provenance.correlation,
    };
    this.spawnResolved(options.x, options.y, options.angle, options.ownerId, cfg, provenance);
  }

  setLineOfFireReadPort(port: LineOfFireReadPort | null): void {
    this.homingController.setLineOfFireReadPort(port);
  }

  private runMiniRocketStateStage(): void {
    for (const projectile of this.projectiles.activeRecords) {
      if (projectile.pendingDestroy
        || projectile.miniRocketStageRangePx === undefined
        || !projectile.homing
        || (projectile.pendingExplosion && (projectile.multiExplosionsRemaining ?? 0) > 0)) continue;
      if (this.miniRocketProcessor.update(projectile, projectile.simulatedAgeMs ?? 0)) {
        this.destroyProjectile(projectile.id);
      }
    }
  }

  private createHomingRequest(projectile: ProjectileRuntimeRecord): ProjectileHomingRequest {
    if (projectile.homingRequest) return projectile.homingRequest;
    const state = projectile.homingState ??= {
      lockedTargetId: projectile.lockedTargetId ?? null,
      lockedTargetType: projectile.lockedTargetType,
      lastSearchAtSimulatedMs: projectile.lastHomingSearchAt,
    };
    const request: ProjectileHomingRequest = {
      ownerId: projectile.ownerId,
      homing: projectile.homing!,
      kinematics: {
        get x() { return projectile.sprite.x; },
        get y() { return projectile.sprite.y; },
        get velocityX() { return projectile.body.velocity.x; },
        get velocityY() { return projectile.body.velocity.y; },
        setVelocity: (x, y) => projectile.body.setVelocity(x, y),
      },
      state,
      excludedTargetKeys: projectile.multiExplosionExcludedTargetKeys,
    };
    projectile.homingRequest = request;
    return request;
  }

  private resetHomingState(projectile: ProjectileRuntimeRecord): void {
    const state = projectile.homingState ??= { lockedTargetId: null };
    state.lockedTargetId = null;
    state.lockedTargetType = undefined;
    state.lastSearchAtSimulatedMs = undefined;
    projectile.lockedTargetId = null;
    projectile.lockedTargetType = undefined;
    projectile.lastHomingSearchAt = undefined;
  }

  private hasVisibleProjectileBurn(projectile: ProjectileRuntimeRecord): boolean {
    if (projectile.isFlame || projectile.isGrenade) return false;
    return ((projectile.burnDurationMs ?? 0) > 0 && (projectile.burnDamagePerTick ?? 0) > 0)
      || ((projectile.supplementalBurnOnHit?.durationMs ?? 0) > 0
        && (projectile.supplementalBurnOnHit?.damagePerTick ?? 0) > 0);
  }

  private updateProjectileHoming(
    projectile: ProjectileRuntimeRecord,
    simulatedAgeMs: number,
    forceSearch = false,
  ): boolean {
    const foundTarget = this.homingController.update(
      this.createHomingRequest(projectile),
      simulatedAgeMs,
      forceSearch,
    );
    const state = projectile.homingState;
    if (state) {
      projectile.lockedTargetId = state.lockedTargetId;
      projectile.lockedTargetType = state.lockedTargetType;
      projectile.lastHomingSearchAt = state.lastSearchAtSimulatedMs;
    }
    return foundTarget;
  }

  setHostFrameTime(nowMs: number): void {
    if (this.contactFrameNowMs !== nowMs) {
      this.resolvedWorldContacts.clear();
      this.contactFrameNowMs = nowMs;
    }
    this.hostFrameNowMs = nowMs;
    this.directImpactPort?.setHostFrameTime?.(nowMs);
  }

  /** World-Teardown: kein Record, kein Identity-Eintrag und kein Restzustand überlebt ihn. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingNextStageSpawns.length = 0;
    this.completedInteractionStages = 0;
    this.hasStartedInteractionStage = false;
    for (const record of [...this.projectiles.stepOrder]) this.releaseProjectile(record);
    this.projectiles.clear();
    this.detonableIds.clear();
    this.detonatorIds.clear();
    this.translocatorPuckIds.clear();
    this.travelEffectIds.clear();
    this.deflectorIds.clear();
    this.resolvedWorldContacts.clear();
    this.contactFrameNowMs = null;
    this.collisionProcessor.reset();
    this.burnAugments.clear();
    this.threatSamples.length = 0;
    this.travelSamples.length = 0;
    this.activeProjectilesByOwner.clear();
    this.flightProcessor.reset();
    this.homingController.setTargetQueryPort(null);
    this.homingController.setTargetabilityPort(null);
    this.homingController.setLineOfFireReadPort(null);
    this.lifecycleProcessor.reset();
    this.physicsHandles.clear();
    this.projectileTimeFieldPort = null;
    this.timeBubbleMovementPort = null;
    this.collisionTargetQueryPort = null;
    this.worldBlockerPort = null;
    this.targetabilityPort = null;
    this.barrierPort = null;
    this.directImpactPort = null;
    this.trainImpactPort = null;
    this.miniRocketStatePort = null;
    this.homingTargetProvider = null;
    this.homingLineOfFireChecker = null;
    this.timeBubbleProvider = null;
    this.projectileImpactEventCallback = null;
    this.naturalFlameExpiryCallback = null;
    this.projectileResolvedCallback = null;
    this.miniRocketDestroyedCallback = null;
    this.standaloneExplosionRequestCallback = null;
    this.proximityPulseCallback = null;
    this.rockHitCallback = null;
    this.obstacleKindResolver = null;
    this.baseHitCallback = null;
    this.supportImpactCallback = null;
    this.projectileReplicationAdapter?.reset();
    this.projectileReplicationAdapter = null;
    this.presentation.releaseWorldPresentation();
    this.presentationStates.length = 0;
    this.clientReplica.reset();
    this.physicsBinding.releaseWorldState();
    this.physicsBinding.setPhysicsContactHandler(null);
    this.onDestroy?.();
  }

  private spawnResolved(
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
    provenance: ProjectileProvenance,
    spawnHostNowMs = this.hostNowMs(),
  ): ProjectileId {
    const id = this.projectiles.allocateId();
    const record = this.createProjectileRecord(id, x, y, angle, ownerId, cfg, spawnHostNowMs, provenance);
    this.projectiles.insert(record);
    if (record.detonable) this.detonableIds.add(id);
    if (record.detonator) this.detonatorIds.add(id);
    if (record.isTranslocatorPuck === true) this.translocatorPuckIds.add(id);
    if (record.leafBlowerDeflectsProjectiles === true) this.deflectorIds.add(id);
    if (hasTravelEffect(record)) this.travelEffectIds.add(id);
    if (record.supplementalBurnOnHit) {
      this.burnAugments.set(id, {
        burn: record.supplementalBurnOnHit,
        provenance: record.supplementalBurnProvenance ?? record.provenance,
      });
    }
    return id;
  }

  /** Creates authoritative state; the PhysicsBinding only creates the Phaser handle. */
  private createProjectileRecord(
    id: ProjectileId,
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
    hostNowMs: number,
    provenance: ProjectileProvenance,
  ): ProjectileRuntimeRecord {
    const bodyProfile = resolveProjectileBodyProfile(cfg, angle);
    const resolvedSpawn = cfg.gameplayMuzzleOrigin
      ? resolveSafeMuzzleSpawn(
        x, y, cfg.gameplayMuzzleOrigin, angle, cfg,
        this.physicsBinding.getSafeMuzzleGeometry(), bodyProfile,
      )
      : { x, y };
    const timeFactor = clampProjectileTimeFactor(this.timeBubbleProvider?.(
      resolvedSpawn.x, resolvedSpawn.y, hostNowMs, ownerId,
    ) ?? this.projectileTimeFieldPort?.getMovementFactor(
      resolvedSpawn.x, resolvedSpawn.y, hostNowMs, provenance,
    ) ?? 1);
    const mechanics = resolvePhysicsMechanics(cfg);
    const handle = this.physicsBinding.createPhysicsHandle({
      id, x: resolvedSpawn.x, y: resolvedSpawn.y, size: cfg.size, color: cfg.color,
      bodyWidth: bodyProfile.width,
      bodyHeight: bodyProfile.height,
      bodyOffsetX: bodyProfile.offsetX,
      bodyOffsetY: bodyProfile.offsetY,
      velocityX: Math.cos(angle) * cfg.speed * timeFactor,
      velocityY: Math.sin(angle) * cfg.speed * timeFactor,
      mechanics,
    });
    this.physicsHandles.set(id, handle);
    const record: ProjectileRuntimeRecord = {
      ...cfg,
      id,
      sprite: handle.sprite,
      body: handle.body,
      lastX: resolvedSpawn.x,
      lastY: resolvedSpawn.y,
      pendingDestroy: false,
      pendingExplosion: false,
      bounceCount: cfg.initialBounceCount ?? 0,
      createdAt: hostNowMs,
      ownerId,
      provenance,
      collisionMode: resolveProjectileCollisionMode(cfg),
      color: cfg.color,
      sourceId: cfg.sourceId ?? 'weapon.unknown',
      lifetime: cfg.lifetime,
      maxBounces: cfg.maxBounces,
      isGrenade: cfg.isGrenade,
      adrenalinGain: cfg.adrenalinGain,
      boundsListener: handle.boundsListener,
      colliders: handle.colliders,
      lockedTargetId: null,
      homingState: cfg.homing ? { lockedTargetId: null } : undefined,
      hitboxSize: cfg.size,
      flamePierceHitIds: cfg.isFlame && cfg.flamePiercing ? new Set<string>() : undefined,
      hitObstacleIds: cfg.isFlame ? new Set<number>() : undefined,
      penetrationRemaining: cfg.penetrationCount,
      penetrationHitIds: (cfg.penetrationCount ?? 0) > 0 ? new Set<string>() : undefined,
      piercingHitIds: (cfg.isBfg || cfg.piercesTargets
        || ((cfg.proximityPulse?.radius ?? 0) > 0 && (cfg.proximityPulse?.damage ?? 0) > 0))
        ? new Set<string>() : undefined,
      penetratedRockIds: cfg.penetratesRocks ? new Set<number>() : undefined,
      awpCorridorHitIds: cfg.awpCorridorHalfWidth !== undefined ? new Set<string>() : undefined,
      multiExplosionsRemaining: Math.max(1, Math.floor(cfg.multiExplosionCount ?? 1)),
      multiExplosionExcludedTargetKeys: (cfg.multiExplosionCount ?? 1) > 1 ? new Set<string>() : undefined,
      miniRocketPhase: cfg.miniRocketStageRangePx !== undefined ? 'attack' : undefined,
      miniRocketCoastUntilAgeMs: undefined,
      miniRocketNextExplosionAtAgeMs: undefined,
      miniRocketDeferredExplosion: false,
      miniRocketDeferredExplosionStopsAtObstacle: false,
      miniRocketSpent: false,
      miniRocketDestructionFxEmitted: false,
      miniRocketHasExploded: false,
      miniRocketReturnReserveGranted: false,
      miniRocketExplosionIndex: 0,
      ak47HitConfirmed: false,
      lastCountdownEmitted: null,
      lastProximityPulseAt: (cfg.proximityPulse?.radius ?? 0) > 0
        && (cfg.proximityPulse?.damage ?? 0) > 0 ? 0 : undefined,
      frictionActivated: false,
      simulatedAgeMs: 0,
      timeBubbleFactor: timeFactor,
      initialSpeed: cfg.speed,
      bounceProcessedThisStep: false,
      originalBodySize: cfg.size < MIN_BODY_LEN
        && cfg.isFlame !== true
        && !hasLeafBlowerCapability(cfg)
        && cfg.isBfg !== true
        && !hasGaussDischarge(cfg)
        && !cfg.isGrenade ? cfg.size : undefined,
    };
    if (cfg.airFrictionDecayPerSec !== undefined) {
      handle.body.useDamping = true;
      const effectiveDecay = !cfg.frictionDelayMs || cfg.frictionDelayMs <= 0
        ? effectiveAirFrictionDecay(cfg.airFrictionDecayPerSec, timeFactor) : 1;
      handle.body.setDrag(effectiveDecay, effectiveDecay);
      if (!cfg.frictionDelayMs || cfg.frictionDelayMs <= 0) {
        record.frictionActivated = true;
        record.appliedAirFrictionDecay = effectiveDecay;
      }
    }
    this.presentation.createSpawnRendererVisuals(id, handle.sprite, resolvedSpawn.x, resolvedSpawn.y, cfg);
    this.presentation.registerFallbackShape(handle.sprite);
    if (cfg.isBfg) this.presentation.createBfgVisual(id, resolvedSpawn.x, resolvedSpawn.y, cfg.size);
    this.presentation.createSpawnFeedback(id, resolvedSpawn.x, resolvedSpawn.y, x, y, angle, ownerId, cfg);
    return record;
  }

  private removeCapabilityIds(id: ProjectileId): void {
    this.deflectorIds.delete(id);
    this.detonableIds.delete(id);
    this.detonatorIds.delete(id);
    this.translocatorPuckIds.delete(id);
    this.travelEffectIds.delete(id);
    this.burnAugments.delete(id);
  }
}

function hasTravelEffect(record: ProjectileRuntimeRecord): boolean {
  return record.canReceiveFireImbue === true
    || record.fireTrail !== undefined
    || record.awpCorridorHalfWidth !== undefined
    || record.awpCorridorDamage !== undefined
    || record.awpCorridorDotDurationMs !== undefined
    || record.awpCorridorDotTickIntervalMs !== undefined
    || record.awpCorridorKnockback !== undefined
    || record.awpCorridorKnockbackDurationMs !== undefined;
}

function resolveProjectileCollisionMode(cfg: ProjectileSpawnConfig): import('../types').ProjectileCollisionMode {
  if (cfg.collisionMode) return cfg.collisionMode;
  if (cfg.isGrenade) return 'physics';
  if (cfg.isFlame === true || hasLeafBlowerCapability(cfg) || cfg.isBfg === true) return 'overlap';
  if ((cfg.proximityPulse?.radius ?? 0) > 0 && (cfg.proximityPulse?.damage ?? 0) > 0) return 'overlap';
  if (hasGaussDischarge(cfg)) return 'overlap';
  return 'sweep';
}

function resolvePhysicsMechanics(cfg: ProjectileSpawnConfig): ProjectilePhysicsMechanics {
  const bfg = cfg.isBfg === true;
  const gauss = hasGaussDischarge(cfg)
    || (cfg.collisionMode === 'overlap' && cfg.piercesTargets === true && !bfg
      && cfg.isFlame !== true && !hasLeafBlowerCapability(cfg));
  const flame = cfg.isFlame === true;
  const leaf = hasLeafBlowerCapability(cfg);
  const passThrough = bfg || gauss;
  const noBounce = flame || leaf || (cfg.isGrenade && cfg.maxBounces === 0)
    || ((cfg.impactCloud || cfg.explosion) && cfg.maxBounces === 0);
  const stopOnContact = cfg.isGrenade && cfg.maxBounces === 0;
  return {
    bodyResponse: noBounce || passThrough ? 'none' : 'bounce',
    rockContactMode: passThrough || (!noBounce && cfg.penetratesRocks === true) ? 'overlap' : 'collider',
    trunkContactMode: 'collider',
    baseContactMode: 'collider',
    trainContactMode: passThrough ? 'overlap' : 'collider',
    stopOnRockContact: stopOnContact,
    stopOnTrunkContact: stopOnContact,
    stopOnBaseContact: stopOnContact || flame,
    stopOnTrainContact: stopOnContact,
    stopOnWorldBoundary: flame || stopOnContact,
    worldBounds: true,
    rock: true,
    trunk: !passThrough,
    base: !passThrough && !cfg.ignoreBaseCollisions,
    train: true,
    ignoreRockIndex: cfg.ignoreRockIndex,
  };
}

function hasLeafBlowerCapability(
  projectile: Pick<ProjectileRuntimeRecord, 'leafBlowerMinKnockback' | 'leafBlowerMaxKnockback' | 'leafBlowerDeflectsProjectiles'>,
): boolean {
  return projectile.leafBlowerMinKnockback !== undefined
    || projectile.leafBlowerMaxKnockback !== undefined
    || projectile.leafBlowerDeflectsProjectiles === true;
}

function hasGaussDischarge(
  projectile: Pick<ProjectileRuntimeRecord, 'gaussChainRadius' | 'gaussChainDamageFactor'>,
): boolean {
  return (projectile.gaussChainRadius ?? 0) > 0
    && (projectile.gaussChainDamageFactor ?? 0) > 0;
}

function shouldPassThroughWorldTarget(projectile: ProjectileRuntimeRecord): boolean {
  return projectile.isBfg === true || hasGaussDischarge(projectile);
}

function createTravelPathEffect(record: ProjectileRuntimeRecord): ProjectileTravelCapabilities['pathEffect'] {
  const fireTrail = record.fireTrail
    ? {
      effect: record.fireTrail,
      halfWidthCells: Math.max(0, Math.floor(record.fireTrailHalfWidthCells ?? 0)),
      cellKey: `${Math.floor(record.sprite.x / 16)}:${Math.floor(record.sprite.y / 16)}`,
    }
    : undefined;
  const hasCorridor = record.awpCorridorHalfWidth !== undefined
    || record.awpCorridorDamage !== undefined
    || record.awpCorridorDotDurationMs !== undefined
    || record.awpCorridorDotTickIntervalMs !== undefined
    || record.awpCorridorKnockback !== undefined
    || record.awpCorridorKnockbackDurationMs !== undefined;
  const awpCorridor = hasCorridor
    ? {
      halfWidth: record.awpCorridorHalfWidth ?? 0,
      damage: record.awpCorridorDamage ?? 0,
      dotDurationMs: record.awpCorridorDotDurationMs,
      dotTickIntervalMs: record.awpCorridorDotTickIntervalMs,
      knockback: record.awpCorridorKnockback,
      knockbackDurationMs: record.awpCorridorKnockbackDurationMs,
    }
    : undefined;
  if (!fireTrail && !awpCorridor) return undefined;
  return { kind: record.pathEffectKind, fireTrail, awpCorridor };
}

function burnDps(burn: { damagePerTick: number }): number {
  return burn.damagePerTick * 1000 / BURN_TICK_INTERVAL_MS;
}

function clampProjectileTimeFactor(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function createProjectileProvenance(
  ownerId: string,
  cfg: ProjectileSpawnConfig,
): ProjectileProvenance {
  const hasLineage = cfg.reflected !== undefined
    || cfg.plasmaSwarmProjectile !== undefined
    || cfg.plasmaSwarmOriginEnemyId !== undefined;
  const lineage = hasLineage
    ? {
      reflected: cfg.reflected,
      plasmaSwarmChild: cfg.plasmaSwarmProjectile,
      plasmaSwarmOriginEnemyId: cfg.plasmaSwarmOriginEnemyId,
    }
    : undefined;
  const correlation = cfg.ak47ShotId === undefined
    ? undefined
    : { ak47ShotId: cfg.ak47ShotId };
  return createSingleOwnerProvenance(ownerId, {
    weaponSourceId: cfg.sourceId,
    sourceSlot: cfg.sourceSlot,
    sourceTurretId: cfg.sourceTurretId,
    allowTeamDamage: cfg.allowTeamDamage,
    lineage,
    correlation,
  });
}

function boundsOverlap(
  first: { left: number; right: number; top: number; bottom: number },
  second: { left: number; right: number; top: number; bottom: number },
): boolean {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top;
}

function createDetonationTarget(projectile: ProjectileRuntimeRecord): ProjectileDetonationTarget {
  return {
    id: projectile.id,
    x: projectile.sprite.x,
    y: projectile.sprite.y,
    projectileOwnerId: projectile.ownerId,
    effect: projectile.detonable!,
    sourceId: projectile.sourceId,
    sourceSlot: projectile.sourceSlot,
  };
}

function emptyHostStageResult(): ProjectileHostStageResult {
  return { projectileExplosions: [], grenadePayloads: [], countdownEvents: [] };
}
