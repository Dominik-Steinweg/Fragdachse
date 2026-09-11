import { scalePrimaryHitRewardIntent } from '../combat/PrimaryHitReward';
import { scalePortalDamagePayload } from '../combat/PortalDamagePayload';
import { acquirePortalDamage, findPortalCrossing, gatePortalExit, portalCircleEntry, portalDamageMultiplier, releasePortalGates,
  type PortalQueryPort } from '../systems/PortalTraversal';
import type { TimeBubbleChargePort } from '../systems/TimeBubbleChargePort';
import { createGrenadeFragments, isGrenadeFragment } from '../systems/GrenadeFragmentRules';
import { ProjectilePathRecorder } from './ProjectileFlightPath';
import { usesRockSweep } from './ProjectileRockSweep';
import { captureBounceContact, captureFlightStep, tracerBounceDebug } from './ProjectileBounceDiagnostics';
import * as Phaser from 'phaser';
import { findNearestRectangleHit } from '../utils/geometry';
import type { ProjectileRuntimeRecord } from './ProjectileRuntimeRecord';
import type {
  PlaceableKind,
  ProjectileBouncePresentation,
  ProjectileSpawnConfig,
  SupportProjectileImpact,
} from '../types';
import {
  type ProjectilePhysicsBindingPort,
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
import { ProjectileStore } from './ProjectileStore';
import { PLASMA_SWARM_EXPLOSION_DURATION_MS, resolvePlasmaSwarmProjectileProfile, resolvePlasmaSwarmRadialAngles, resolvePlasmaSwarmHoming } from '../systems/PlasmaCharge';

/** Parameter einer Übernahme bei stabiler Projectile-Identität. */
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
  /** Übernommene Granate: Granatensemantik und Restzündzeit bleiben erhalten. */
  readonly keepGrenade: boolean;
  readonly continuousTurn?: boolean;
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
  /** World source facts are captured before the actor can disappear. */
  readonly resolveProvenance?: (provenance: ProjectileProvenance) => ProjectileProvenance;
  /** Meldet der Composition, dass dieser Owner abgeräumt ist. */
  readonly onDestroy?: () => void;
}

/**
 * World-owned Owner der autoritativen Projectile-Registry.
 *
 * Er lebt und stirbt mit seiner `WorldRuntime`: Registry, Runtime-Records und ihr Teardown gehören
 * ihm allein; die monotone Identity-Vergabe kommt aus dem worldRevision-langlebigen Scope. Spawn
 * läuft ausschließlich über diese Grenze – aus der aufgelösten Execution über {@link spawnProjectile},
 * aus Child-Spawns über denselben privaten Spawn-Pfad.
 *
 * Phaser-Physics-Ressourcen und ihre Kollisionseinstiegspunkte liegen in einem world-komponierten
 * Binding; dieses kennt ausschließlich technische Handles und Kontakte.
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
  private readonly flightPaths = new ProjectilePathRecorder();
  private readonly flightContactPoints = new Map<number, { x: number; y: number }>();
  private readonly flightProcessor = new ProjectileFlightProcessor();
  private readonly homingController = new ProjectileHomingController();
  /** Derived from living guidance locks, grouped by immutable origin bubble rather than allegiance. */
  private readonly prismTargetClaims = new Map<number, Map<string, Set<ProjectileId>>>();
  private readonly prismClaimByProjectile = new Map<ProjectileId, { group: number; key: string }>();
  private readonly detonableIds = new Set<ProjectileId>();
  private readonly detonatorIds = new Set<ProjectileId>();
  private readonly translocatorPuckIds = new Set<ProjectileId>();
  private readonly travelEffectIds = new Set<ProjectileId>();
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
        collectorId: projectile.provenance.allegiance.ownerId,
        pickup: {
          x,
          y,
          color: projectile.presentation.color,
          ownerColor: projectile.presentation.ownerColor,
          adrenalineRefund: Math.max(0, projectile.spec.flight.miniRocket.adrenalineCostPaid ?? 0)
            * Math.max(0, projectile.spec.flight.miniRocket.pickupAdrenalineRefundFraction ?? 0),
          armorRefund: Math.max(0, projectile.spec.flight.miniRocket.pickupArmor ?? 0),
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
  private readonly resolveProvenance?: (provenance: ProjectileProvenance) => ProjectileProvenance;
  private readonly onDestroy?: () => void;
  private projectileTimeFieldPort: ProjectileTimeFieldPort | null = null;
  private readonly pendingNextStageSpawns: PendingNextStageProjectileSpawn[] = [];
  private readonly pendingGrenadeFragments = new Map<ProjectileId, readonly ProjectileSpawnRequest[]>();
  private completedInteractionStages = 0;
  private hasStartedInteractionStage = false;
  private hostFrameNowMs = 0;
  private interactionNowMs = 0;
  /** Same-frame bridge between technical Phaser contacts and canonical target candidates. */
  private readonly resolvedWorldContacts = new Map<string, ResolvedWorldContact>();
  private contactFrameNowMs: number | null = null;
  private destroyed = false;

  constructor(options: WorldProjectileRuntimeOptions) {
    this.physicsBinding = options.physicsBinding;
    this.presentation = options.presentation;
    this.hostNowMs = options.hostNowMs;
    this.resolveProvenance = options.resolveProvenance;
    this.onDestroy = options.onDestroy;
    this.projectiles = new ProjectileStore(options.identityScope);
    const runtime = this;
    this.collisionDependencies = {
      onGrenadeContact: (record, candidate) => this.resolveGrenadeContact(record, candidate),
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
      prepareGrenadePayload: (projectile) => this.prepareGrenadePayload(projectile),
      queueDestroy: (projectile) => this.queueProjectileDestroy(projectile.id),
      release: (projectile) => this.releaseProjectile(projectile),
      isCurrent: (projectile) => this.projectiles.getById(projectile.id) === projectile,
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
    this.physicsBinding.setMovementObserver?.((id, x, y, vx, vy) =>
      this.flightPaths.observe(id, x, y, vx, vy, this.hostNowMs()));
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
      const sprite = projectile.physics.sprite;
      const flightPath = this.flightPaths.read(projectile.id, this.hostNowMs());
      const pathHead = flightPath?.points[flightPath.points.length - 1];
      states.push({
        id: projectile.id,
        ownerId: projectile.provenance.allegiance.ownerId,
        x: pathHead?.x ?? sprite.x,
        y: pathHead?.y ?? sprite.y,
        vx: projectile.physics.body.velocity.x,
        vy: projectile.physics.body.velocity.y,
        size: sprite.displayWidth,
        color: projectile.presentation.color,
        ownerColor: projectile.presentation.ownerColor,
        projectileVisualScale: projectile.presentation.projectileVisualScale,
        smokeTrailColor: projectile.presentation.smokeTrailColor,
        style: projectile.presentation.projectileStyle,
        sporeVisualVariant: projectile.presentation.sporeVisualVariant,
        bulletVisualPreset: projectile.presentation.bulletVisualPreset,
        grenadeVisualPreset: projectile.presentation.grenadeVisualPreset,
        energyBallVariant: projectile.presentation.energyBallVariant,
        tracer: projectile.presentation.tracerConfig,
        shotAudioKey: projectile.presentation.shotAudioKey,
        suppressSpawnFx: projectile.presentation.suppressSpawnFx,
        miniRocketPhase: projectile.miniRocket.phase,
        miniRocketCascadeStage: (projectile.spec.flight.miniRocket.cascadeDamageBonusPerExplosion ?? 0) > 0
          ? projectile.miniRocket.explosionIndex
          : undefined,
        projectileBurnVisualStyle: projectile.presentation.projectileBurnVisualStyle,
        burning: !projectile.spec.flight.isFlame && !projectile.spec.flight.isGrenade && (
          ((projectile.spec.interaction.burn.burnDurationMs ?? 0) > 0 && (projectile.spec.interaction.burn.burnDamagePerTick ?? 0) > 0)
          || ((projectile.interaction.burnAugment?.burn?.durationMs ?? 0) > 0
            && (projectile.interaction.burnAugment?.burn?.damagePerTick ?? 0) > 0)
        ),
        sourceTurretId: projectile.provenance.sourceTurretId,
        flightPath,
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
      provenance: {
        ...impact.provenance,
        weaponSourceId: `${impact.provenance.weaponSourceId ?? 'weapon.plasma'}:swarm-explosion`,
      },
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
      this.spawnResolved(impact.x, impact.y, angle, {
        speed, size: Math.max(1, profile.size), damage: profile.damage,
        color: impact.color, ownerColor: impact.ownerColor ?? impact.color, lifetime,
        remainingRangePx: profile.range, maxBounces: 0, isGrenade: false, adrenalinGain: 0,
        homing: resolvePlasmaSwarmHoming(impact.homing),
        projectileStyle: impact.projectileStyle, energyBallVariant: impact.energyBallVariant,
        tracerConfig: impact.tracerConfig,
        baseDamageMult: impact.baseDamageMult, suppressSpawnFx: true,
      }, {
        ...impact.provenance,
        weaponSourceId: 'weapon.plasma.swarm',
        primaryHitReward: undefined,
        lineage: {
          ...impact.provenance.lineage,
          parentProjectileId: impact.projectileId,
          plasmaSwarmChild: true,
          plasmaSwarmOriginEnemyId: impact.enemyId,
        },
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
    x = projectile.physics.sprite?.x ?? 0,
    y = projectile.physics.sprite?.y ?? 0,
  ): ProjectileImpactSource {
    return {
      projectileId: projectile.id,
      ownerId: projectile.provenance.attributionId,
      provenance: projectile.provenance,
      x,
      y,
      velocityX: projectile.physics.body?.velocity?.x ?? 0,
      velocityY: projectile.physics.body?.velocity?.y ?? 0,
      color: projectile.presentation.color,
      ownerColor: projectile.presentation.ownerColor,
      sourceId: projectile.provenance.weaponSourceId ?? 'weapon.unknown',
      sourceSlot: projectile.provenance.sourceSlot,
      allowTeamDamage: projectile.provenance.allegiance.allowTeamDamage,
      damage: projectile.damage,
      ak47DamageMultiplier: projectile.spec.interaction.directHit.ak47DamageMultiplier,
      baseDamageMult: projectile.spec.interaction.directHit.baseDamageMult,
      rockDamageMult: projectile.spec.interaction.directHit.rockDamageMult,
      trainDamageMult: projectile.spec.interaction.directHit.trainDamageMult,
      impactCloud: projectile.spec.interaction.impactCloud,
      energyInjectorPayload: projectile.spec.interaction.energyInjectorPayload,
      proximityPulse: projectile.spec.interaction.proximityPulse,
      isBfg: projectile.spec.flight.isBfg,
      isFlame: projectile.spec.flight.isFlame,
      hitboxSize: projectile.hitboxSize,
      hitboxMaxSize: projectile.spec.flight.hitboxGrowth.maxSize,
      bodyWidth: projectile.physics.body?.width ?? 0,
      projectileStyle: projectile.presentation.projectileStyle,
      projectileBurnVisualStyle: projectile.presentation.projectileBurnVisualStyle,
      shotAudioKey: projectile.presentation.shotAudioKey,
      shotgunProximityMaxDamageBonus: projectile.spec.interaction.directHit.shotgunProximityMaxDamageBonus,
      shotgunOriginX: projectile.spec.interaction.directHit.shotgunOriginX,
      shotgunOriginY: projectile.spec.interaction.directHit.shotgunOriginY,
      shotgunResolvedRange: projectile.spec.interaction.directHit.shotgunResolvedRange,
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
      projectile.physics.body.velocity.x = projectile.velocityAfterFirstBounce.x;
      projectile.physics.body.velocity.y = projectile.velocityAfterFirstBounce.y;
      return true;
    }
    const usesPenetratingRockContact = contact.target.kind === 'rock' && projectile.spec.flight.penetration.penetratesRocks
      && this.shouldBounceAfterContact(projectile, { kind: 'trunk' });
    const impactPoint = bounceEligible || usesPenetratingRockContact
      ? this.resolveContactImpactPoint(projectile, contact)
      : contact.target.kind === 'world-boundary'
        ? { x: contact.x, y: contact.y }
        : { x: projectile.physics.sprite.x, y: projectile.physics.sprite.y };
    if (bounceEligible) {
      const multiplier = projectile.spec.flight.drag.bounceFrictionMultiplier;
      if (multiplier !== undefined && multiplier < 1) {
        projectile.physics.body.velocity.x *= multiplier;
        projectile.physics.body.velocity.y *= multiplier;
      }
      if (contact.target.kind !== 'world-boundary') {
        projectile.bounceProcessedThisStep = true;
        projectile.velocityAfterFirstBounce = {
          x: projectile.physics.body.velocity.x, y: projectile.physics.body.velocity.y,
        };
        this.playAuthoritativeBouncePresentation(
          projectile,
          impactPoint.x,
          impactPoint.y,
          projectile.physics.body.velocity.x,
          projectile.physics.body.velocity.y,
          true,
          contact.flightPosition ?? contact,
        );
      }
    }
    this.flightContactPoints.set(projectile.id, impactPoint);
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
      this.completeAuthoritativeBounce(projectile, impactPoint.x, impactPoint.y, contact.target.kind === 'world-boundary', contact.flightPosition ?? contact);
    }
    if (!projectile.pendingDestroy) this.flightContactPoints.delete(projectile.id);
    return consumed;
  }

  private resolveContactImpactPoint(
    projectile: ProjectileRuntimeRecord,
    contact: ProjectilePhysicsContact,
  ): { x: number; y: number } {
    const bounds = contact.targetBounds;
    if (!bounds) return { x: contact.x, y: contact.y };
    const line = this.contactLine.setTo(projectile.lastX, projectile.lastY, projectile.physics.sprite.x, projectile.physics.sprite.y);
    const rect = this.contactRect.setTo(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    const hit = findNearestRectangleHit(line, rect, this.contactPoints);
    return hit ? { x: hit.x, y: hit.y } : { x: contact.x, y: contact.y };
  }

  private shouldBounceAfterContact(
    projectile: ProjectileRuntimeRecord,
    target: ProjectilePhysicsContact['target'],
  ): boolean {
    if (projectile.spec.flight.isBfg || hasGaussDischarge(projectile.spec.interaction.directHit)
      || (projectile.spec.flight.collisionMode === 'overlap' && projectile.spec.flight.piercesTargets === true)
      || projectile.spec.flight.isFlame || hasLeafBlowerCapability(projectile.spec.interaction.impulse)) return false;
    if (target.kind === 'rock' && projectile.spec.flight.penetration.penetratesRocks === true) return false;
    if (projectile.spec.flight.isGrenade && projectile.maxBounces === 0) return false;
    if (projectile.spec.interaction.impactCloud && projectile.maxBounces === 0) return false;
    if (projectile.interaction.explosion && projectile.maxBounces === 0) return false;
    return target.kind !== 'world-boundary' || !projectile.spec.flight.isBfg;
  }

  private playAuthoritativeBouncePresentation(
    projectile: ProjectileRuntimeRecord,
    x: number,
    y: number,
    vx: number,
    vy: number,
    tracerBounce = true,
    flightPosition?: { readonly x: number; readonly y: number },
  ): void {
    const presentation: ProjectileBouncePresentation = {
      sequence: (projectile.lastBouncePresentation?.sequence ?? 0) + 1,
      x,
      y,
      vx,
      vy,
      tracerBounce,
    };
    if (tracerBounce) {
      this.flightPaths.bounce(projectile.id, flightPosition?.x ?? x, flightPosition?.y ?? y,
        vx, vy, this.hostNowMs(), presentation.sequence);
      captureBounceContact(projectile.id, presentation.sequence, x, y);
    } else {
      this.flightPaths.discardPending(projectile.id);
      this.flightPaths.append(projectile.id, x, y, vx, vy, this.hostNowMs(), false, presentation.sequence);
    }
    projectile.lastBouncePresentation = presentation;
    this.presentation.playBounceImpact(
      projectile.id,
      x,
      y,
      vx,
      vy,
      projectile.presentation.color,
      projectile.presentation.projectileStyle,
      tracerBounce,
    );
    this.projectileReplicationAdapter?.recordBouncePresentation(
      this.createProjectileReplicationRecord(projectile),
    );
  }

  private completeAuthoritativeBounce(projectile: ProjectileRuntimeRecord, x: number, y: number, worldBoundary: boolean,
    flightPosition: { readonly x: number; readonly y: number }): void {
    if (this.queueHydraSplit(
      projectile.id, x, y, projectile.physics.body.velocity.x, projectile.physics.body.velocity.y,
    )) return;
    projectile.bounceCount += 1;
    if (worldBoundary) this.playAuthoritativeBouncePresentation(
      projectile,
      x,
      y,
      projectile.physics.body.velocity.x,
      projectile.physics.body.velocity.y,
      true,
      flightPosition,
    );
    if (projectile.bounceCount > projectile.maxBounces) {
      projectile.physics.body.setVelocity(0, 0);
      projectile.physics.body.enable = false;
    }
  }

  private shouldSweepRocks(projectile: ProjectileRuntimeRecord): boolean {
    return usesRockSweep(projectile.spec.flight)
      && !projectile.pendingDestroy
      && !projectile.bounceProcessedThisStep;
  }

  private sweepRocks(projectile: ProjectileRuntimeRecord): void {
    const segmentLength = Math.hypot(projectile.physics.sprite.x - projectile.lastX, projectile.physics.sprite.y - projectile.lastY);
    if (segmentLength <= 0.5) return;
    const hit = this.physicsBinding.findNearestRockSweep(
      projectile.lastX, projectile.lastY, projectile.physics.sprite.x, projectile.physics.sprite.y,
      projectile.spec.flight.collisionFilter.ignoreRockIndex,
      projectile.physics.body.width / 2, projectile.physics.body.height / 2, projectile.id,
      !projectile.spec.flight.collisionFilter.ignoreBaseCollisions,
    );
    if (!hit) return;
    const normalLength = Math.hypot(hit.normalX, hit.normalY) || 1;
    let nextVx = projectile.physics.body.velocity.x;
    let nextVy = projectile.physics.body.velocity.y;
    if (Math.abs(hit.normalX) > 0.001) nextVx *= -1;
    if (Math.abs(hit.normalY) > 0.001) nextVy *= -1;
    const frictionMultiplier = projectile.spec.flight.drag.bounceFrictionMultiplier;
    if (frictionMultiplier !== undefined && frictionMultiplier < 1) {
      nextVx *= frictionMultiplier;
      nextVy *= frictionMultiplier;
    }
    projectile.bounceCount += 1;
    projectile.bounceProcessedThisStep = true;
    projectile.velocityAfterFirstBounce = { x: nextVx, y: nextVy };
    const resolution = this.resolveWorldImpactCandidate(projectile, {
      projectileId: projectile.id,
      target: hit.baseId === undefined ? { kind: 'rock', id: hit.rockIndex } : { kind: 'base', id: hit.baseId },
      x: hit.x,
      y: hit.y,
      source: 'physics-collider',
    }, true);
    // Impact callbacks may synchronously release the shot. Do not recreate its
    // bounce replication or reset a body whose lifetime already ended.
    if (resolution.technicalContactConsumed || projectile.pendingDestroy
      || !this.projectiles.activeRecords.has(projectile)) return;
    const offsetDistance = projectile.bounceCount > projectile.maxBounces ? 0
      : hit.centerX !== undefined ? 0.5 : Math.max(projectile.physics.sprite.displayWidth * 0.5 + 0.5, 1);
    const flightPosition = {
      x: (hit.centerX ?? hit.x) + (hit.normalX / normalLength) * offsetDistance,
      y: (hit.centerY ?? hit.y) + (hit.normalY / normalLength) * offsetDistance,
    };
    this.playAuthoritativeBouncePresentation(projectile, hit.x, hit.y, nextVx, nextVy, true, flightPosition);
    if (projectile.bounceCount > projectile.maxBounces) {
      projectile.physics.body.reset(flightPosition.x, flightPosition.y);
      projectile.physics.body.setVelocity(0, 0);
      projectile.physics.body.enable = false;
      return;
    }
    projectile.physics.body.reset(
      flightPosition.x,
      flightPosition.y,
    );
    projectile.physics.body.setVelocity(nextVx, nextVy);
  }

  private completeDirectImpact(
    projectile: ProjectileRuntimeRecord,
    target: ProjectileCombatTargetRef,
    impact: { readonly x: number; readonly y: number },
    outcome: ProjectileDirectImpactOutcome,
  ): boolean {
    if (!outcome.accepted || projectile.pendingDestroy) return false;
    this.flightContactPoints.set(projectile.id, impact);
    if (projectile.spec.interaction.impactCloud) this.projectileImpactEventCallback?.(this.createImpactSource(projectile, impact.x, impact.y));
    const targetKey = target.kind === 'player' ? `players:${target.id}`
      : target.kind === 'enemy' ? `enemies:${target.id}` : undefined;
    if (projectile.spec.interaction.enemyHitExplosion) {
      this.lifecycleProcessor.triggerEnemyImpactExplosion(projectile);
      return false;
    }
    if (projectile.interaction.explosion) {
      this.lifecycleProcessor.triggerExplosion(projectile, targetKey);
      if (!projectile.pendingDestroy) this.flightContactPoints.delete(projectile.id);
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
    awaitingFlightBounce = false,
  ): ResolvedWorldContact {
    this.flightContactPoints.set(projectile.id, candidate);
    try {
      const result = this.resolveWorldImpactCandidateCore(projectile, candidate);
      // A swept bounce supplies its center pivot after impact rules resolve. The
      // surface contact is only a flight endpoint when those rules stop the shot.
      if (result.outcome === 'consumed' && (!awaitingFlightBounce || result.technicalContactConsumed)) {
        this.flightPaths.discardPending(projectile.id);
        this.flightPaths.append(projectile.id, candidate.x, candidate.y,
          projectile.physics.body.velocity.x, projectile.physics.body.velocity.y, this.hostNowMs());
      }
      return result;
    }
    finally { if (!projectile.pendingDestroy) this.flightContactPoints.delete(projectile.id); }
  }

  private resolveWorldImpactCandidateCore(
    projectile: ProjectileRuntimeRecord,
    candidate: ProjectileImpactCandidate,
  ): ResolvedWorldContact {
    const contactKey = `${candidate.projectileId}:${projectileTargetPhysicalKey(candidate.target)}`;
    const previousResolution = this.resolvedWorldContacts.get(contactKey);
    if (previousResolution) return previousResolution;

    this.resolveGrenadeContact(projectile, candidate);

    const impact = this.createImpactSource(projectile, candidate.x, candidate.y);
    let technicalContactConsumed = false;
    switch (candidate.target.kind) {
      case 'rock':
        if (!this.rememberPiercingWorldContact(projectile, candidate.target.kind, candidate.target.id)) {
          const passed: ResolvedWorldContact = { outcome: 'passed', technicalContactConsumed: false };
          this.resolvedWorldContacts.set(contactKey, passed);
          return passed;
        }
        technicalContactConsumed = this.resolveRockPhysicsContact(
          projectile,
          candidate.target.id,
          candidate.x,
          candidate.y,
          impact,
        );
        if (projectile.spec.flight.penetration.penetratesRocks && this.shouldBounceAfterContact(projectile, { kind: 'trunk' })) {
          this.playAuthoritativeBouncePresentation(
            projectile,
            candidate.x,
            candidate.y,
            projectile.physics.body.velocity.x,
            projectile.physics.body.velocity.y,
            false,
          );
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
          const passed: ResolvedWorldContact = { outcome: 'passed', technicalContactConsumed: false };
          this.resolvedWorldContacts.set(contactKey, passed);
          return passed;
        }
        technicalContactConsumed = this.resolveTrainPhysicsContact(projectile, impact);
        break;
      case 'construction':
        // Runtime constructions are normalized to `rock` by the target query. Keep a legacy
        // candidate terminal if an adapter violates that contract, without a second identity.
        technicalContactConsumed = false;
        break;
      default:
        {
          const ignored: ResolvedWorldContact = { outcome: 'ignored', technicalContactConsumed: false };
          this.resolvedWorldContacts.set(contactKey, ignored);
          return ignored;
        }
    }

    const resolved: ResolvedWorldContact = {
      outcome: shouldPassThroughWorldTarget(projectile) ? 'passed' : 'consumed',
      technicalContactConsumed,
    };
    this.resolvedWorldContacts.set(contactKey, resolved);
    return resolved;
  }

  private rememberPiercingWorldContact(
    projectile: ProjectileRuntimeRecord,
    targetKind: 'rock' | 'train',
    targetId: number | string,
  ): boolean {
    if (projectile.spec.flight.isBfg === true) {
      if (targetKind === 'rock') {
        projectile.contacts.bfgHitRocks ??= new Set<number>();
        if (projectile.contacts.bfgHitRocks.has(Number(targetId))) return false;
        projectile.contacts.bfgHitRocks.add(Number(targetId));
      } else {
        if (projectile.contacts.bfgHitTrain) return false;
        projectile.contacts.bfgHitTrain = true;
      }
    }
    if (hasGaussDischarge(projectile.spec.interaction.directHit)
      || (projectile.spec.flight.collisionMode === 'overlap' && projectile.spec.flight.piercesTargets === true
        && !projectile.spec.flight.isBfg && !projectile.spec.flight.isFlame && !hasLeafBlowerCapability(projectile.spec.interaction.impulse))) {
      if (targetKind === 'rock') {
        projectile.contacts.gaussHitRocks ??= new Set<number>();
        if (projectile.contacts.gaussHitRocks.has(Number(targetId))) return false;
        projectile.contacts.gaussHitRocks.add(Number(targetId));
      } else {
        if (projectile.contacts.gaussHitTrain) return false;
        projectile.contacts.gaussHitTrain = true;
      }
    }
    if (targetKind === 'rock' && projectile.spec.flight.penetration.penetratesRocks) {
      projectile.contacts.penetratedRockIds ??= new Set<number>();
      if (projectile.contacts.penetratedRockIds.has(Number(targetId))) return false;
      projectile.contacts.penetratedRockIds.add(Number(targetId));
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
    if (projectile.spec.interaction.energyInjectorPayload) {
      if (projectile.interaction.supportConsumed) return true;
      projectile.interaction.supportConsumed = true;
      this.supportImpactCallback?.(impact, { kind: 'rock', rockId, x, y });
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.spec.interaction.impactCloud && projectile.maxBounces === 0) {
      this.projectileImpactEventCallback?.(impact);
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.interaction.explosion && projectile.maxBounces === 0) {
      this.triggerProjectileExplosion(projectile.id);
      return true;
    }
    if (projectile.spec.flight.isFlame) {
      if (projectile.contacts.hitObstacleIds?.has(rockId)) return false;
      projectile.contacts.hitObstacleIds ??= new Set<number>();
      projectile.contacts.hitObstacleIds.add(rockId);
      const obstacleKind = this.obstacleKindResolver?.(rockId);
      const multiplier = obstacleKind !== undefined && obstacleKind !== 'rock'
        ? 1
        : projectile.spec.interaction.directHit.rockDamageMult ?? 1;
      if (multiplier !== 0) this.rockHitCallback?.(rockId, projectile.damage * multiplier, projectile.provenance.attributionId);
      return false;
    }
    if (hasLeafBlowerCapability(projectile.spec.interaction.impulse)) {
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.spec.flight.isGrenade && projectile.maxBounces === 0) return false;

    if (!projectile.spec.flight.isGrenade) {
      const obstacleKind = this.obstacleKindResolver?.(rockId);
      const multiplier = obstacleKind !== undefined && obstacleKind !== 'rock'
        ? 1
        : projectile.spec.interaction.directHit.rockDamageMult ?? 1;
      if (multiplier !== 0) this.rockHitCallback?.(rockId, projectile.damage * multiplier, projectile.provenance.attributionId);
    }
    return false;
  }

  private resolveTrunkPhysicsContact(projectile: ProjectileRuntimeRecord): boolean {
    if (projectile.spec.interaction.impactCloud && projectile.maxBounces === 0) {
      this.projectileImpactEventCallback?.(this.createImpactSource(projectile));
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.interaction.explosion && projectile.maxBounces === 0) {
      this.triggerProjectileExplosion(projectile.id);
      return true;
    }
    if (hasLeafBlowerCapability(projectile.spec.interaction.impulse)) {
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
    if (projectile.spec.interaction.energyInjectorPayload) {
      if (projectile.interaction.supportConsumed) return true;
      projectile.interaction.supportConsumed = true;
      this.supportImpactCallback?.(impact, { kind: 'base', x, y });
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.spec.interaction.impactCloud && projectile.maxBounces === 0) {
      this.applyBaseContact(projectile, baseId, impact);
      this.projectileImpactEventCallback?.(impact);
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.interaction.explosion && projectile.maxBounces === 0) {
      this.triggerProjectileExplosion(projectile.id);
      return true;
    }
    if (hasLeafBlowerCapability(projectile.spec.interaction.impulse)) {
      this.applyBaseContact(projectile, baseId, impact);
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.spec.flight.isFlame) {
      this.applyBaseContact(projectile, baseId, impact);
      return false;
    }
    if (projectile.spec.flight.isGrenade && projectile.maxBounces === 0) return false;
    if (!projectile.interaction.explosion) this.applyBaseContact(projectile, baseId, impact);
    return false;
  }

  private applyBaseContact(
    projectile: ProjectileRuntimeRecord,
    baseId: string,
    impact: ProjectileImpactSource,
  ): void {
    if (projectile.damage <= 0 || projectile.contacts.hitBaseIds?.has(baseId)) return;
    projectile.contacts.hitBaseIds ??= new Set<string>();
    projectile.contacts.hitBaseIds.add(baseId);
    this.baseHitCallback?.(baseId, projectile.damage, projectile.provenance.attributionId, impact);
  }

  private resolveTrainPhysicsContact(
    projectile: ProjectileRuntimeRecord,
    impact: ProjectileImpactSource,
  ): boolean {
    const appliesTrainDamage = !projectile.spec.flight.isTranslocatorPuck && (projectile.spec.interaction.directHit.trainDamageMult ?? 1) !== 0;
    const applyTrainDamage = (): void => {
      if (appliesTrainDamage) {
        this.trainImpactPort?.resolveTrainImpact({
          damage: projectile.damage * (projectile.spec.interaction.directHit.trainDamageMult ?? 1),
          attributionId: projectile.provenance.attributionId,
        });
      }
    };
    if (projectile.spec.interaction.impactCloud && projectile.maxBounces === 0) {
      applyTrainDamage();
      this.projectileImpactEventCallback?.(impact);
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.interaction.explosion && projectile.maxBounces === 0) {
      if (!projectile.miniRocket.spent) applyTrainDamage();
      this.triggerProjectileExplosion(projectile.id);
      return true;
    }
    if (projectile.spec.flight.isFlame || hasLeafBlowerCapability(projectile.spec.interaction.impulse)) {
      applyTrainDamage();
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    applyTrainDamage();
    return projectile.spec.flight.isGrenade && projectile.maxBounces === 0;
  }

  private resolveWorldBoundaryPhysicsContact(
    projectile: ProjectileRuntimeRecord,
    impact: ProjectileImpactSource,
  ): boolean {
    if (projectile.spec.flight.isBfg) {
      projectile.bounceCount = projectile.maxBounces + 1;
      return false;
    }
    if (projectile.spec.interaction.impactCloud && projectile.maxBounces === 0) {
      this.projectileImpactEventCallback?.(impact);
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    if (projectile.interaction.explosion && projectile.maxBounces === 0) {
      this.triggerProjectileExplosion(projectile.id);
      return true;
    }
    if (hasLeafBlowerCapability(projectile.spec.interaction.impulse)) {
      this.queueProjectileDestroy(projectile.id);
      return true;
    }
    return false;
  }

  /** Liefert ausschließlich die Client-Projektion; interne Runtime-Records verlassen die World nicht. */
  readProjectileReplication(sink: (record: ProjectileReplicationRecord) => void): void {
    for (const projectile of this.projectiles.activeRecords) sink(this.createProjectileReplicationRecord(projectile));
  }

  private createProjectileReplicationRecord(projectile: ProjectileRuntimeRecord): ProjectileReplicationRecord {
    return {
      id: projectile.id,
      createdAt: projectile.createdAt,
      static: {
        id: projectile.id,
        ownerId: projectile.provenance.allegiance.ownerId,
        color: projectile.presentation.color,
        allowTeamDamage: projectile.provenance.allegiance.allowTeamDamage,
        ownerColor: projectile.presentation.ownerColor,
        sourceTurretId: projectile.provenance.sourceTurretId,
        visualMuzzleOrigin: projectile.presentation.visualMuzzleOrigin,
        projectileVisualScale: projectile.presentation.projectileVisualScale,
        smokeTrailColor: projectile.presentation.smokeTrailColor,
        style: projectile.presentation.projectileStyle,
        sporeVisualVariant: projectile.presentation.sporeVisualVariant,
        bulletVisualPreset: projectile.presentation.bulletVisualPreset,
        grenadeVisualPreset: projectile.presentation.grenadeVisualPreset,
        energyBallVariant: projectile.presentation.energyBallVariant,
        velocityDecay: projectile.spec.flight.drag.velocityDecayPerSec,
        tracer: projectile.presentation.tracerConfig,
        shotAudioKey: projectile.presentation.shotAudioKey,
        suppressSpawnFx: projectile.presentation.suppressSpawnFx,
      },
      dynamic: {
        id: projectile.id,
        x: Math.round(projectile.physics.sprite.x),
        y: Math.round(projectile.physics.sprite.y),
        vx: Math.round(projectile.physics.body.velocity.x),
        vy: Math.round(projectile.physics.body.velocity.y),
        size: Math.round(projectile.physics.sprite.displayWidth),
        miniRocketPhase: projectile.miniRocket.phase,
        miniRocketCascadeStage: (projectile.spec.flight.miniRocket.cascadeDamageBonusPerExplosion ?? 0) > 0
          ? projectile.miniRocket.explosionIndex
          : undefined,
        projectileBurnVisualStyle: projectile.presentation.projectileBurnVisualStyle,
        burning: this.hasVisibleProjectileBurn(projectile) || undefined,
        bounce: projectile.lastBouncePresentation,
        flightPath: this.flightPaths.read(projectile.id, this.hostNowMs()),
      },
    };
  }

  spawnProjectile(request: ProjectileSpawnRequest): ProjectileSpawnResult {
    if (this.destroyed) return null;
    const { origin } = request;
    return this.spawnResolved(
      origin.x,
      origin.y,
      origin.angle,
      toProjectileSpawnConfig(request),
      request.provenance,
    );
  }

  destroyProjectile(id: ProjectileId): void {
    const record = this.projectiles.getById(id);
    if (!record) return;
    this.releaseProjectile(record);
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
    this.removePrismTargetClaim(record.id);
    record.physics.body.setVelocity(0, 0);
    record.physics.body.enable = false;
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

    const splitCount = Math.max(0, Math.floor(projectile.spec.flight.split.count ?? 0));
    if (splitCount <= 0) return false;

    const nextBounceCount = projectile.bounceCount + 1;
    const outgoingSpeed = Math.hypot(outgoingVx, outgoingVy);
    const nowMs = this.hostNowMs();
    const timeBubbleFactor = clampProjectileTimeFactor(
      this.projectileTimeFieldPort?.getMovementFactor(
        impactX,
        impactY,
        nowMs,
      ) ?? projectile.timeBubbleFactor ?? 1,
    );
    const childBaseSpeed = outgoingSpeed / timeBubbleFactor;
    const remainingRangePx = this.getRemainingRangeAfterImpact(projectile, impactX, impactY);
    const childAngles = this.getHydraSplitAngles(
      Math.atan2(outgoingVy, outgoingVx),
      splitCount,
      projectile.spec.flight.split.spread ?? 0,
    );

    // Hydra owns the bounce terminal: a failed split is still consumed exactly as before.
    if (nextBounceCount > projectile.maxBounces
      || outgoingSpeed <= 0.001
      || remainingRangePx <= 0.5
      || childAngles.length === 0) {
      projectile.bounceCount = projectile.maxBounces + 1;
      projectile.physics.body.reset(impactX, impactY);
      this.queueProjectileDestroy(projectile.id);
      return true;
    }

    const splitFactor = projectile.spec.flight.split.speedFactor ?? 1;
    const childSize = Math.max(4, (projectile.physics.sprite.displayWidth / splitCount) * splitFactor);
    const childDamage = Math.max(1, (projectile.damage / splitCount) * splitFactor);
    const childAdrenalinGain = Math.max(0, (projectile.adrenalinGain / splitCount) * splitFactor);
    const childLifetime = (remainingRangePx / childBaseSpeed) * 1000;
    const childProvenance: ProjectileProvenance = {
      ...projectile.provenance,
      primaryHitReward: scalePrimaryHitRewardIntent(projectile.provenance.primaryHitReward, splitFactor / splitCount),
      lineage: {
        ...projectile.provenance.lineage,
        parentProjectileId: projectile.id,
      },
    };

    projectile.interaction.pendingHydraSplit = {
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
          color: projectile.presentation.color,
          allowTeamDamage: projectile.provenance.allegiance.allowTeamDamage,
          ignoreBaseCollisions: projectile.spec.flight.collisionFilter.ignoreBaseCollisions,
          ownerColor: projectile.presentation.ownerColor,
          lifetime: childLifetime,
          maxBounces: projectile.maxBounces,
          isGrenade: projectile.spec.flight.isGrenade,
          isTranslocatorPuck: projectile.spec.flight.isTranslocatorPuck,
          collisionMode: projectile.spec.flight.collisionMode,
          adrenalinGain: childAdrenalinGain,
          sourceId: projectile.provenance.weaponSourceId ?? 'weapon.unknown',
          explosion: projectile.interaction.explosion,
          enemyHitExplosion: projectile.spec.interaction.enemyHitExplosion,
          impactCloud: projectile.spec.interaction.impactCloud,
          sporeVisualVariant: projectile.presentation.sporeVisualVariant,
          homing: projectile.spec.flight.split.homing ?? projectile.spec.flight.homing,
          projectileVisualScale: projectile.presentation.projectileVisualScale,
          smokeTrailColor: projectile.presentation.smokeTrailColor,
          fuseTime: projectile.spec.flight.fuseTime,
          grenadeEffect: projectile.spec.interaction.grenadeEffect,
          projectileStyle: projectile.presentation.projectileStyle,
          bulletVisualPreset: projectile.presentation.bulletVisualPreset,
          grenadeVisualPreset: projectile.presentation.grenadeVisualPreset,
          energyBallVariant: projectile.presentation.energyBallVariant,
          tracerConfig: projectile.presentation.tracerConfig,
          detonable: projectile.spec.interaction.detonable,
          detonator: projectile.spec.interaction.detonator,
          rockDamageMult: projectile.spec.interaction.directHit.rockDamageMult,
          trainDamageMult: projectile.spec.interaction.directHit.trainDamageMult,
          baseDamageMult: projectile.spec.interaction.directHit.baseDamageMult,
          isFlame: projectile.spec.flight.isFlame,
          hitboxGrowRate: projectile.spec.flight.hitboxGrowth.growRatePerSec,
          hitboxMaxSize: projectile.spec.flight.hitboxGrowth.maxSize,
          velocityDecay: projectile.spec.flight.drag.velocityDecayPerSec,
          burnDurationMs: projectile.spec.interaction.burn.burnDurationMs,
          burnDamagePerTick: projectile.spec.interaction.burn.burnDamagePerTick,
          projectileBurnVisualStyle: projectile.presentation.projectileBurnVisualStyle,
          leafBlowerMinKnockback: projectile.spec.interaction.impulse.leafBlowerMinKnockback,
          leafBlowerMaxKnockback: projectile.spec.interaction.impulse.leafBlowerMaxKnockback,
          leafBlowerSelfPush: projectile.spec.interaction.impulse.leafBlowerSelfPush,
          isBfg: projectile.spec.flight.isBfg,
          piercesTargets: projectile.spec.flight.piercesTargets,
          penetrationCount: projectile.interaction.penetrationRemaining,
          penetrationDamageRetention: projectile.spec.flight.penetration.damageRetention,
          penetratesRocks: projectile.spec.flight.penetration.penetratesRocks,
          flamePiercing: projectile.contacts.flamePierceHitIds !== undefined,
          leafBlowerDeflectsProjectiles: projectile.spec.interaction.impulse.leafBlowerDeflectsProjectiles,
          proximityPulse: projectile.spec.interaction.proximityPulse,
          gaussChainRadius: projectile.spec.interaction.directHit.gaussChainRadius,
          gaussChainDamageFactor: projectile.spec.interaction.directHit.gaussChainDamageFactor,
          frictionDelayMs: projectile.spec.flight.drag.frictionDelayMs,
          airFrictionDecayPerSec: projectile.spec.flight.drag.airFrictionDecayPerSec,
          bounceFrictionMultiplier: projectile.spec.flight.drag.bounceFrictionMultiplier,
          stopSpeedThreshold: projectile.spec.flight.drag.stopSpeedThreshold,
          sourceSlot: projectile.provenance.sourceSlot,
          shotAudioKey: projectile.presentation.shotAudioKey,
          splitCount: projectile.spec.flight.split.count,
          splitSpread: projectile.spec.flight.split.spread,
          splitFactor: projectile.spec.flight.split.speedFactor,
          splitHoming: projectile.spec.flight.split.homing,
          initialBounceCount: nextBounceCount,
          remainingRangePx,
          suppressSpawnFx: true,
        },
      });
    }

    return true;
  }

  private releaseProjectile(record: ProjectileRuntimeRecord): void {
    this.removePrismTargetClaim(record.id);
    if (this.projectiles.getById(record.id) !== record) return;
    const handle = record.physics;
    if (!this.destroyed) {
      const finalContact = this.flightContactPoints.get(record.id);
      if (finalContact) {
        this.flightPaths.discardPending(record.id);
        this.flightPaths.append(record.id, finalContact.x, finalContact.y,
          record.physics.body.velocity.x, record.physics.body.velocity.y, this.hostNowMs());
      } else this.recordFlightPosition(record, this.hostNowMs());
      const finalRecord = this.createProjectileReplicationRecord(record);
      const flightPath = this.flightPaths.read(record.id, this.hostNowMs(), true);
      if (flightPath) {
        this.presentation.presentFinalPath?.({ ...finalRecord.static, ...finalRecord.dynamic, ownerId: finalRecord.static.ownerId,
          color: finalRecord.static.color ?? 0, flightPath });
        this.projectileReplicationAdapter?.recordFlightEnd({ ...finalRecord, dynamic: { ...finalRecord.dynamic, flightPath } });
      }
    }
    this.flightPaths.remove(record.id);
    this.flightContactPoints.delete(record.id);
    this.removeCapabilityIds(record.id);
    this.projectiles.detach(record);
    record.contacts.hitObstacleIds?.clear();
    record.contacts.hitBaseIds?.clear();
    const lifecycle: ProjectileLifecycleOutcome = record.miniRocket.spent
      ? { kind: 'mini-rocket-destroyed', projectileId: record.id }
      : {
          kind: 'resolved',
          projectileId: record.id,
          provenance: record.provenance,
          ...(record.grenadePayloadPending ? { grenadePayloadPending: true } : {}),
          ...(record.provenance.correlation?.ak47ShotId === undefined ? {} : {
            reaction: {
              ak47: {
                shotId: record.provenance.correlation?.ak47ShotId,
                fireSuperiorityShot: record.spec.interaction.directHit.ak47FireSuperiorityShot === true,
                hitConfirmed: record.interaction.ak47HitConfirmed === true,
              },
            },
          }),
        };
    this.presentation.destroyProjectileVisuals({
      id: record.id, ownerId: record.provenance.allegiance.ownerId, x: record.physics.sprite.x, y: record.physics.sprite.y,
      vx: record.physics.body.velocity.x, vy: record.physics.body.velocity.y, size: record.physics.sprite.displayWidth,
      color: record.presentation.color, style: record.presentation.projectileStyle,
      energyBallVariant: record.presentation.energyBallVariant, sporeVisualVariant: record.presentation.sporeVisualVariant,
      pendingHydraSplit: record.interaction.pendingHydraSplit,
      destroyX: record.interaction.pendingHydraSplit?.x ?? record.physics.sprite.x,
      destroyY: record.interaction.pendingHydraSplit?.y ?? record.physics.sprite.y,
      destroyScale: record.physics.sprite.displayWidth / 16,
    });
    this.physicsBinding.releaseProjectileResources(handle);
    // Finish all owned teardown before a reaction can remove siblings, spawn or destroy the World.
    this.projectileResolvedCallback?.(lifecycle);
  }

  searchDetonableProjectiles(request: ProjectileDetonationSearchRequest): readonly ProjectileDetonationTarget[] {
    if (this.destroyed) return [];
    const line = new Phaser.Geom.Line(request.startX, request.startY, request.endX, request.endY);
    const targets: ProjectileDetonationTarget[] = [];
    for (const id of this.detonableIds) {
      const projectile = this.projectiles.getById(id);
      if (!projectile?.spec.interaction.detonable || projectile.pendingDestroy
        || !this.projectiles.activeRecords.has(projectile)) continue;
      if (!request.detonator.triggerTags.includes(projectile.spec.interaction.detonable.tag)) continue;
      if (!projectile.spec.interaction.detonable.allowCrossTeam && projectile.provenance.allegiance.ownerId !== request.shooterId) continue;
      if (!Phaser.Geom.Intersects.LineToRectangle(line, projectile.physics.sprite.getBounds())) continue;
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
    if (!projectile?.spec.interaction.detonable || projectile.pendingDestroy
      || !this.projectiles.activeRecords.has(projectile)) return null;
    const target = createDetonationTarget(projectile);
    this.destroyProjectile(projectileId);
    return { ...target, detonatorOwnerId };
  }

  private readonly portalDetonations: ProjectileDetonationOutcome[] = [];

  detonateOverlappingProjectiles(): readonly ProjectileDetonationOutcome[] {
    const outcomes = this.portalDetonations.splice(0);
    return outcomes.concat(this.resolveProjectileDetonations(this.projectiles.activeRecords));
  }

  private resolveProjectileDetonations(records: Iterable<ProjectileRuntimeRecord>): ProjectileDetonationOutcome[] {
    if (this.destroyed) return [];
    const outcomes: ProjectileDetonationOutcome[] = [];
    for (const detonator of records) {
      if (!this.detonatorIds.has(detonator.id)) continue;
      for (const target of this.projectiles.activeRecords) {
        if (target.id === detonator.id || !this.detonableIds.has(target.id) || !target.spec.interaction.detonable) continue;
        if (!detonator.spec.interaction.detonator?.triggerTags.includes(target.spec.interaction.detonable.tag)) continue;
        if (!target.spec.interaction.detonable.allowCrossTeam && target.provenance.allegiance.ownerId !== detonator.provenance.allegiance.ownerId) continue;
        if (!boundsOverlap(detonator.physics.sprite.getBounds(), target.physics.sprite.getBounds())) {
          const segments = [...(detonator.portalTravel ?? []), { fromX: detonator.lastX, fromY: detonator.lastY,
            toX: detonator.physics.sprite.x, toY: detonator.physics.sprite.y }];
          const radius = (detonator.physics.sprite.displayWidth + target.physics.sprite.displayWidth) * 0.5;
          const intersects = segments.some(segment => {
            const from = { x: segment.fromX, y: segment.fromY }, to = { x: segment.toX, y: segment.toY };
            const t = portalCircleEntry(from, to, target.physics.sprite, radius);
            if (t === null) return false;
            const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
            const distance = Math.hypot(x - from.x, y - from.y);
            const blocker = this.worldBlockerPort?.getNearestBlockerDistance(from.x, from.y, x, y,
              detonator.spec.flight.penetration.penetratesRocks === true);
            return blocker == null || blocker > distance;
          });
          if (!intersects) continue;
        }
        const result = this.detonateProjectile(target.id, detonator.provenance.allegiance.ownerId);
        if (result) outcomes.push(result);
      }
    }
    return outcomes;
  }

  spawnPuck(request: TranslocatorPuckSpawnRequest): ProjectileId {
    if (this.destroyed) return -1;
    return this.spawnResolved(request.x, request.y, request.angle, {
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
    return { x: record.physics.sprite.x, y: record.physics.sprite.y };
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
      if (!record || record.pendingDestroy || !this.projectiles.activeRecords.has(record) || !record.physics.sprite.active) continue;

      const pathEffect = createTravelPathEffect(record);
      if (record.portalTravel) this.travelSamples.push(...record.portalTravel);
      this.travelSamples.push({
        projectileId: record.id,
        fromX: record.lastX,
        fromY: record.lastY,
        toX: record.physics.sprite.x,
        toY: record.physics.sprite.y,
        provenance: record.provenance,
        capabilities: {
          canReceiveFireImbue: record.spec.interaction.burn.canReceiveFireImbue === true && !record.spec.flight.isGrenade && !record.spec.flight.isFlame,
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
    if (!record.spec.interaction.burn.canReceiveFireImbue || record.spec.flight.isGrenade || record.spec.flight.isFlame) return false;

    const burn = scalePortalDamagePayload(augment.burn, portalDamageMultiplier(record.provenance.portalDamage));
    const current = record.interaction.burnAugment;
    if (current && burnDps(burn) <= burnDps(current.burn)) return false;
    record.interaction.burnAugment = {
      burn,
      provenance: { ...(this.resolveProvenance?.(augment.provenance) ?? augment.provenance),
        portalDamage: record.provenance.portalDamage },
    };
    return true;
  }

  getThreatSamples(): readonly ProjectileThreatSample[] {
    this.threatSamples.length = 0;
    if (this.destroyed) return this.threatSamples;
    for (const record of this.projectiles.activeRecords) {
      if (!record.physics.sprite.active) continue;
      const radius = Math.max(record.physics.sprite.displayWidth, record.physics.sprite.displayHeight) * 0.5;
      this.threatSamples.push({
        id: record.id,
        x: record.physics.sprite.x,
        y: record.physics.sprite.y,
        vx: record.physics.body.velocity.x,
        vy: record.physics.body.velocity.y,
        radius,
        provenance: record.provenance,
        dodgeRelevant: !record.spec.flight.isGrenade && !record.spec.flight.isFlame,
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
      if (record.spec.flight.isBfg === true && record.physics.sprite.active) return true;
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
    this.captureDebugFlightSteps('before-flight');
    const coreStage = this.flightProcessor.run(this.projectiles.stepOrder, deltaMs, nowMs);
    const stage = this.lifecycleProcessor.run(this.projectiles.stepOrder, coreStage);
    this.captureDebugFlightSteps('after-flight');
    if (this.destroyed) return emptyHostStageResult();
    this.runMiniRocketStateStage();
    for (const record of this.projectiles.activeRecords) {
      this.recordFlightPosition(record, nowMs);
      record.portalTravel = undefined;
    }
    this.presentation.syncHostRenderers(this.presentationProjectiles);
    return stage;
  }

  /** Domain has completed the primary AoE. Children remain owned by this live World runtime. */
  completeGrenadeDetonation(projectileId: ProjectileId): void {
    const fragments = this.pendingGrenadeFragments.get(projectileId);
    this.pendingGrenadeFragments.delete(projectileId);
    if (this.destroyed || !fragments) return;
    for (const request of fragments) {
      if (this.destroyed) break;
      this.spawnProjectile(request);
    }
  }

  private prepareGrenadePayload(projectile: ProjectileRuntimeRecord): ProjectileGrenadePayloadRequest {
    projectile.grenadePayloadPending = true;
    const { x, y } = projectile.physics.sprite;
    const effect = projectile.spec.interaction.grenadeEffect!;
    if (effect.type === 'damage' && !isGrenadeFragment(effect)) {
      this.pendingGrenadeFragments.set(projectile.id, createGrenadeFragments(effect,
        this.grenadeFragmentOrigin(projectile, x, y), 'cluster', Math.random));
    }
    return { projectileId: projectile.id, x, y, provenance: projectile.provenance, effect };
  }

  private grenadeFragmentOrigin(projectile: ProjectileRuntimeRecord, x: number, y: number) {
    const velocity = projectile.physics.body.velocity;
    const speed = Math.hypot(velocity.x, velocity.y);
    return { x, y, speed, provenance: projectile.provenance,
      direction: speed > 0.001 ? Math.atan2(velocity.y, velocity.x) : projectile.grenadeLastDirection ?? 0 };
  }

  private resolveGrenadeContact(projectile: ProjectileRuntimeRecord, contact: ProjectileImpactCandidate): void {
    const effect = projectile.spec.interaction.grenadeEffect;
    if (projectile.pendingDestroy || effect?.type !== 'damage' || isGrenadeFragment(effect)) return;
    const role = this.targetabilityPort?.getGrenadeContactRole?.(projectile.provenance, contact.target);
    if (role === 'character' && effect.impactFuse) {
      const velocity = projectile.physics.body.velocity;
      if (Math.hypot(velocity.x, velocity.y) > 0.001) projectile.grenadeLastDirection = Math.atan2(velocity.y, velocity.x);
      const vx = velocity.x, vy = velocity.y;
      projectile.physics.body.reset(contact.x, contact.y);
      projectile.physics.body.setVelocity(vx, vy);
      this.lifecycleProcessor.triggerGrenadeExplosion(projectile);
    } else if (role === 'structure' && (effect.demolitionLevel ?? 0) > 0 && !projectile.grenadeDemolitionTriggered) {
      projectile.grenadeDemolitionTriggered = true;
      const requests = createGrenadeFragments(effect, this.grenadeFragmentOrigin(projectile, contact.x, contact.y), 'demolition', Math.random);
      for (const request of requests) {
        if (this.destroyed) break;
        this.spawnProjectile(request);
      }
    }
  }

  setProjectileTimeFieldPort(port: ProjectileTimeFieldPort | null): void {
    this.projectileTimeFieldPort = port;
    this.flightProcessor.setTimeFieldPort(port);
  }

  private portalQuery: PortalQueryPort | null = null;

  setPortalQueryPort(port: PortalQueryPort | null): void {
    this.portalQuery = port;
    this.physicsBinding.setContactFilter?.(port ? (id, x, y) => {
      const record = this.projectiles.getById(id);
      if (!record || record.pendingDestroy) return true;
      const from = { x: record.lastX, y: record.lastY };
      const crossing = findPortalCrossing(port.getPortalPairs(), from, { x, y }, { gates: record.portalGates });
      if (!crossing) return true;
      const distance = Math.hypot(crossing.entry.x - from.x, crossing.entry.y - from.y);
      if (record.remainingRangePx !== undefined && distance >= record.remainingRangePx) return true;
      const blocker = this.worldBlockerPort?.getNearestBlockerDistance(from.x, from.y,
        crossing.entry.x, crossing.entry.y, record.spec.flight.penetration.penetratesRocks === true);
      if (blocker != null && blocker <= distance) return true;
      if (!record.spec.flight.penetration.penetratesRocks && this.physicsBinding.findNearestRockSweep(
        from.x, from.y, crossing.entry.x, crossing.entry.y,
        record.spec.flight.collisionFilter.ignoreRockIndex, record.physics.body.halfWidth,
        record.physics.body.halfHeight, record.id, !record.spec.flight.collisionFilter.ignoreBaseCollisions)) return true;
      return this.physicsBinding.findNearestPortalWorldSweep?.(from.x, from.y,
        crossing.entry.x, crossing.entry.y, record.physics.body.halfWidth, record.physics.body.halfHeight,
        shouldPassThroughWorldTarget(record)) != null;
    } : null);
  }

  private resolvePortalWorldContact(record: ProjectileRuntimeRecord,
    hit: import('./ProjectilePhysicsBinding').ProjectileRockSweepHit, nowMs: number): void {
    const body = record.physics.body;
    const vx = body.velocity.x, vy = body.velocity.y;
    body.reset(hit.x, hit.y); body.setVelocity(vx, vy);
    this.collisionProcessor.run([record], nowMs, this.collisionDependencies);
    if (record.pendingDestroy || !this.projectiles.activeRecords.has(record)) return;
    const dot = vx * hit.normalX + vy * hit.normalY;
    body.reset(hit.x + hit.normalX * 0.01, hit.y + hit.normalY * 0.01);
    body.setVelocity(vx - 2 * dot * hit.normalX, vy - 2 * dot * hit.normalY);
    this.reportPhysicsContact({ projectileId: record.id,
      target: hit.kind === 'train' ? { kind: 'train', id: 'main' } : { kind: hit.kind! },
      x: hit.x, y: hit.y, flightPosition: { x: record.physics.sprite.x, y: record.physics.sprite.y },
      velocityX: body.velocity.x, velocityY: body.velocity.y,
      source: hit.kind === 'world-boundary' ? 'world-boundary' : 'physics-collider' });
    if (record.spec.flight.isGrenade && record.maxBounces === 0) body.setVelocity(0, 0);
  }

  /** Resolve real prefixes before any travel consumer sees the post-Physics movement. */
  runHostPortalStage(nowMs: number, prepareTravel?: (sample: ProjectileTravelSample) => void): void {
    this.collisionProcessor.withTargetSnapshot(() => this.resolveHostPortals(nowMs, prepareTravel));
  }

  private resolveHostPortals(nowMs: number, prepareTravel?: (sample: ProjectileTravelSample) => void): void {
    if (this.destroyed) return;
    const pairs = this.portalQuery?.getPortalPairs();
    if (!pairs?.length) return;
    this.setHostFrameTime(nowMs);
    for (const record of this.projectiles.activeRecords) {
      if (record.pendingDestroy || record.pendingExplosion || record.miniRocket.deferredExplosion) continue;
      const gates = record.portalGates ??= new Map();
      let from = { x: record.lastX, y: record.lastY };
      let end = { x: record.physics.sprite.x, y: record.physics.sprite.y };
      releasePortalGates(gates, from);
      const zeroProgress = new Set<string>();
      while (!record.pendingDestroy && this.projectiles.activeRecords.has(record)) {
        const crossing = findPortalCrossing(pairs, from, end, { gates, excludedEndpoints: zeroProgress });
        const worldHit = record.portalFlightPending ? this.physicsBinding.findNearestPortalWorldSweep?.(
          from.x, from.y, end.x, end.y, record.physics.body.halfWidth, record.physics.body.halfHeight,
          shouldPassThroughWorldTarget(record)) : null;
        if (worldHit && (!crossing || Math.hypot(worldHit.x - from.x, worldHit.y - from.y)
          <= Math.hypot(crossing.entry.x - from.x, crossing.entry.y - from.y))) {
          this.resolvePortalWorldContact(record, worldHit, nowMs);
          break;
        }
        if (!crossing) break;
        const prefixLength = Math.hypot(crossing.entry.x - from.x, crossing.entry.y - from.y);
        if (record.remainingRangePx !== undefined && prefixLength >= record.remainingRangePx) break;
        const blocker = this.worldBlockerPort?.getNearestBlockerDistance(from.x, from.y,
          crossing.entry.x, crossing.entry.y, record.spec.flight.penetration.penetratesRocks === true);
        if (blocker != null && blocker <= prefixLength) break;
        if (this.shouldSweepRocks(record) && this.physicsBinding.findNearestRockSweep(from.x, from.y,
          crossing.entry.x, crossing.entry.y, record.spec.flight.collisionFilter.ignoreRockIndex,
          record.physics.body.halfWidth, record.physics.body.halfHeight, record.id,
          !record.spec.flight.collisionFilter.ignoreBaseCollisions)) break;
        const velocity = { x: record.physics.body.velocity.x, y: record.physics.body.velocity.y };
        record.physics.body.reset(crossing.entry.x, crossing.entry.y);
        record.physics.body.setVelocity(velocity.x, velocity.y);
        const sample: ProjectileTravelSample = { projectileId: record.id,
          fromX: from.x, fromY: from.y, toX: crossing.entry.x, toY: crossing.entry.y,
          provenance: record.provenance, capabilities: {
            canReceiveFireImbue: record.spec.interaction.burn.canReceiveFireImbue === true
              && !record.spec.flight.isGrenade && !record.spec.flight.isFlame,
            pathEffect: createTravelPathEffect(record),
          } };
        (record.portalTravel ??= []).push(sample);
        prepareTravel?.(sample);
        this.portalDetonations.push(...this.resolveProjectileDetonations([record]));
        this.runBarrierStage(nowMs, [record]);
        if (record.pendingDestroy || !this.projectiles.activeRecords.has(record)) break;
        this.collisionProcessor.run([record], nowMs, this.collisionDependencies);
        if (record.pendingDestroy || !this.projectiles.activeRecords.has(record)) break;
        if (this.shouldSweepRocks(record)) this.sweepRocks(record);
        if (record.pendingDestroy || record.bounceProcessedThisStep
          || record.physics.body.velocity.x !== velocity.x || record.physics.body.velocity.y !== velocity.y) break;
        if (record.remainingRangePx !== undefined) record.remainingRangePx -= prefixLength;
        this.flightPaths.redirect(record.id, crossing.entry.x, crossing.entry.y, velocity.x, velocity.y, nowMs, false);
        this.flightPaths.redirect(record.id, crossing.exit.x, crossing.exit.y, velocity.x, velocity.y, nowMs, true);
        const context = acquirePortalDamage(record.provenance.portalDamage, crossing.pair,
          this.portalQuery!.isPortalFriendly(crossing.pair.ownerId, record.provenance.allegiance.ownerId));
        const ratio = portalDamageMultiplier(context) / portalDamageMultiplier(record.provenance.portalDamage);
        if (ratio !== 1) {
          record.damage *= ratio;
          record.spec = { ...record.spec, interaction: scalePortalDamagePayload(record.spec.interaction, ratio) };
          record.interaction = { ...record.interaction,
            explosion: scalePortalDamagePayload(record.interaction.explosion, ratio),
            burnAugment: record.interaction.burnAugment ? { ...record.interaction.burnAugment,
              burn: scalePortalDamagePayload(record.interaction.burnAugment.burn, ratio) } : undefined };
          record.provenance = { ...record.provenance, portalDamage: context };
        }
        if (prefixLength > 1e-6) zeroProgress.clear();
        zeroProgress.add(crossing.sourceKey);
        gatePortalExit(gates, crossing);
        end = { x: crossing.exit.x + end.x - crossing.entry.x, y: crossing.exit.y + end.y - crossing.entry.y };
        from = crossing.exit;
        record.lastX = from.x; record.lastY = from.y;
        record.physics.body.reset(end.x, end.y);
        record.physics.body.setVelocity(velocity.x, velocity.y);
        record.portalFlightPending = true;
        releasePortalGates(gates, from);
      }
    }
  }

  private bubbleChargePort: Pick<TimeBubbleChargePort, 'observeProjectile'> | null = null;

  setTimeBubbleChargePort(port: Pick<TimeBubbleChargePort, 'observeProjectile'> | null): void {
    this.bubbleChargePort = port;
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
      if (!record || record.pendingDestroy || !this.projectiles.activeRecords.has(record) || !record.spec.interaction.detonable) continue;
      sink({
        projectileId: record.id,
        ownerId: record.provenance.allegiance.ownerId,
        x: record.physics.sprite.x,
        y: record.physics.sprite.y,
        tag: record.spec.interaction.detonable.tag,
        allowCrossTeam: record.spec.interaction.detonable.allowCrossTeam,
      });
    }
  }

  completeProjectileExplosion(projectileId: ProjectileId, outcome: ProjectileExplosionOutcome): void {
    const projectile = this.projectiles.getById(projectileId);
    if (!projectile || projectile.pendingDestroy) return;
    // The domain outcome is a same-frame receipt. Keep the physical keys at the Projectile owner
    // so the next coast/impact stage can preserve its established exclusion memory without
    // leaking a RuntimeRecord into Combat or re-running the AoE resolution.
    if (outcome.damagedTargetKeys.length > 0) {
      const excluded = projectile.interaction.multiExplosionExcludedTargetKeys
        ??= new Set<string>();
      for (const key of outcome.damagedTargetKeys) {
        if (typeof key === 'string' && key.length > 0) excluded.add(key);
      }
    }
    this.resumeMiniRocketExplosion(projectileId);
  }

  private triggerProjectileExplosion(id: ProjectileId, impactTargetKey?: string): boolean {
    const projectile = this.projectiles.getById(id);
    return projectile !== undefined && !projectile.pendingDestroy
      && this.lifecycleProcessor.triggerExplosion(projectile, impactTargetKey);
  }

  private resumeMiniRocketExplosion(projectileId: ProjectileId): void {
    const projectile = this.projectiles.getById(projectileId);
    if (!projectile || ((projectile.interaction.multiExplosionsRemaining ?? 0) <= 0 && !projectile.miniRocket.spent)) return;
    projectile.pendingExplosion = false;
    this.resetHomingState(projectile);
    if (projectile.spec.flight.miniRocket.stageRangePx !== undefined) {
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
    this.captureDebugFlightSteps('before-interaction');
    try {
      if (this.bubbleChargePort) for (const record of this.projectiles.activeRecords) {
        if (record.pendingDestroy) continue;
        const { x, y } = record.physics.sprite;
        this.bubbleChargePort.observeProjectile(record.id, x, y, record.damage, nowMs);
      }
      this.runBarrierStage(nowMs);
      this.runDeflectionStage(nowMs);
      // Barrier/deflection may have consumed the last projectile. Do not enter the collision
      // target provider in that empty stage; same-stage projectile additions still use the live
      // active Set when at least one record remains.
      if (this.projectiles.activeCount > 0) {
        this.collisionProcessor.run(this.projectiles.activeRecords, nowMs, this.collisionDependencies);
      }
      // Characters are checked on the original travel segment, before a wall reflects velocity.
      // Grenade world sweeps then preserve physical blocking even at upgraded throw speeds.
      for (const record of this.projectiles.activeRecords) {
        if (record.spec.flight.isGrenade && this.shouldSweepRocks(record)) this.sweepRocks(record);
      }
      this.captureDebugFlightSteps('after-interaction');
    } finally {
      this.completedInteractionStages += 1;
    }
  }

  private captureDebugFlightSteps(stage: string): void {
    if (!tracerBounceDebug.centerline) return;
    for (const record of this.projectiles.activeRecords) {
      const { sprite, body } = record.physics;
      captureFlightStep({ projectileId: record.id, stage,
        x: sprite.x, y: sprite.y, lastX: record.lastX, lastY: record.lastY,
        vx: body.velocity.x, vy: body.velocity.y, width: body.width, height: body.height,
        collisionMode: record.spec.flight.collisionMode, sweepEnabled: this.shouldSweepRocks(record),
        pendingDestroy: record.pendingDestroy === true, bounceProcessed: record.bounceProcessedThisStep === true });
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
      ?? (Math.max(projectile.spec.flight.speed ?? Math.hypot(
        projectile.physics.body.velocity.x,
        projectile.physics.body.velocity.y,
      ), 0) * projectile.spec.flight.lifetimeMs) / 1000;
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
  private runBarrierStage(nowMs: number, records: Iterable<ProjectileRuntimeRecord> = this.projectiles.activeRecords): void {
    const port = this.barrierPort;
    if (!port) return;
    for (const record of records) {
      if (record.pendingDestroy) continue;
      // Geworfene Utilities passieren; nur übernehmbare Wurfgeschosse hält die Barriere auf.
      const capturable = record.spec.interaction.grenadeEffect?.type === 'spawn_enemy';
      if (record.spec.flight.isGrenade && !capturable) continue;
      if (record.miniRocket.deferredExplosion || record.miniRocket.spent) continue;

      const request = {
        projectileId: record.id,
        provenance: record.provenance,
        x: record.physics.sprite.x,
        y: record.physics.sprite.y,
        velocityX: record.physics.body.velocity.x,
        velocityY: record.physics.body.velocity.y,
        isGrenade: record.spec.flight.isGrenade,
        capturable,
        allowTeamDamage: record.provenance.allegiance.allowTeamDamage === true,
        damage: record.damage,
        nowMs,
      };
      const contact = port.getNearestContact?.(request, record.lastX, record.lastY);
      if (port.getNearestContact && !contact) continue;
      if (contact) {
        const blocker = this.worldBlockerPort?.getNearestBlockerDistance(record.lastX, record.lastY,
          contact.x, contact.y, record.spec.flight.penetration.penetratesRocks === true);
        if (blocker != null && blocker <= contact.distance) continue;
        record.physics.body.reset(contact.x, contact.y);
        record.physics.body.setVelocity(request.velocityX, request.velocityY);
        this.collisionProcessor.run([record], nowMs, this.collisionDependencies);
        if (record.pendingDestroy || !this.projectiles.activeRecords.has(record)) continue;
        if (record.bounceProcessedThisStep || record.physics.body.velocity.x !== request.velocityX
          || record.physics.body.velocity.y !== request.velocityY) continue;
      }
      const resolution = port.resolveBarrier(contact ? { ...request, x: contact.x, y: contact.y } : request);
      if (resolution.kind === 'passed' && contact) {
        record.physics.body.reset(request.x, request.y);
        record.physics.body.setVelocity(request.velocityX, request.velocityY);
      }
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
    const speed = Math.hypot(record.physics.body.velocity.x, record.physics.body.velocity.y) || 400;
    this.redirectProjectile(record, {
      x: record.physics.sprite.x,
      y: record.physics.sprite.y,
      angle: resolution.angle,
      speed,
      ownerId: resolution.attributionId,
      allegiance: resolution.allegiance,
      damage: resolution.keepGrenade ? 0 : record.damage,
      color: resolution.keepGrenade ? resolution.ownerColor : record.presentation.color,
      ownerColor: resolution.ownerColor,
      keepGrenade: resolution.keepGrenade,
      nowMs,
    });
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
      if (target.spec.interaction.impulse.leafBlowerDeflectsProjectiles === true) continue;
      // Geworfene Utilities fliegen weiter; nur echte Geschosse werden umgelenkt.
      if (target.spec.flight.isGrenade) continue;
      if (target.miniRocket.deferredExplosion || target.miniRocket.spent) continue;

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
    if (target.spec.interaction.impulse.leafBlowerDeflectsProjectiles === true || target.spec.flight.isGrenade) return false;
    if (target.miniRocket.deferredExplosion || target.miniRocket.spent) return false;
    const blowerOwnerId = blower.provenance.allegiance.ownerId;
    if (blowerOwnerId === target.provenance.allegiance.ownerId) return false;
    if (this.targetabilityPort && !this.targetabilityPort.canDamageOwner(
      target.provenance,
      blowerOwnerId,
      target.provenance.allegiance.allowTeamDamage === true,
    )) return false;
    if (!boundsOverlap(target.physics.sprite.getBounds(), blower.physics.sprite.getBounds())) return false;

    const blowLength = Math.hypot(blower.physics.body.velocity.x, blower.physics.body.velocity.y);
    const angle = blowLength > 0.001
      ? Math.atan2(blower.physics.body.velocity.y, blower.physics.body.velocity.x)
      : Math.atan2(-target.physics.body.velocity.y, -target.physics.body.velocity.x);
    const speed = Math.hypot(target.physics.body.velocity.x, target.physics.body.velocity.y) || 400;

    this.redirectProjectile(target, {
      x: target.physics.sprite.x,
      y: target.physics.sprite.y,
      angle,
      speed,
      ownerId: blower.provenance.attributionId,
      allegiance: blower.provenance.allegiance,
      damage: target.damage,
      color: target.presentation.color,
      ownerColor: blower.presentation.ownerColor ?? target.presentation.color,
      keepGrenade: false,
      nowMs,
    });
    return true;
  }

  /** Target-lokale Defense: Absorption entfernt, Reflexion transformiert beim Owner. */
  private applyDefense(
    record: ProjectileRuntimeRecord,
    defense: ProjectileDefenseResolution,
    candidate: ProjectileImpactCandidate,
  ): void {
    if (defense.kind === 'reflected' && defense.damageFactor > 0) {
      this.redirectProjectile(record, {
        x: defense.originX,
        y: defense.originY,
        angle: Math.atan2(-record.physics.body.velocity.y, -record.physics.body.velocity.x),
        speed: Math.hypot(record.physics.body.velocity.x, record.physics.body.velocity.y),
        ownerId: defense.attributionId,
        allegiance: defense.allegiance,
        damage: record.damage * defense.damageFactor,
        color: record.presentation.color,
        ownerColor: record.presentation.ownerColor ?? record.presentation.color,
        keepGrenade: false,
        nowMs: this.interactionNowMs,
      });
      return;
    }
    this.destroyProjectile(record.id);
  }

  /**
   * Transformiert ein übernommenes Projectile bei stabiler Identity und unveränderter Lifetime.
   *
   * Attribution und Allegiance wechseln, Gameplay-Source und Abstammung bleiben unterscheidbar;
   * die Restwirkung des Ursprungs bleibt erhalten.
   */
  focusProjectilesInCircle(request: import('./ProjectileExternalInteractionPort').ProjectileFocusRequest): number {
    if (this.destroyed || ![request.x, request.y, request.radius, request.targetX, request.targetY, request.nowMs].every(Number.isFinite)
      || request.radius < 0) return 0;
    let count = 0;
    for (const record of this.projectiles.activeRecords) {
      if (record.pendingDestroy || record.pendingExplosion || record.miniRocket.spent || record.miniRocket.deferredExplosion) continue;
      const { x, y } = record.physics.sprite;
      if ((x - request.x) ** 2 + (y - request.y) ** 2 > request.radius ** 2) continue;
      const velocity = record.physics.body.velocity;
      const speed = Math.hypot(velocity.x, velocity.y);
      if (speed <= 0.001) continue;
      const angle = Math.hypot(request.targetX - x, request.targetY - y) > 0.001
        ? Math.atan2(request.targetY - y, request.targetX - x) : Math.atan2(velocity.y, velocity.x);
      this.redirectProjectile(record, {
        x, y, angle, speed, damage: record.damage, ownerId: request.ownerId,
        allegiance: { ownerId: request.ownerId, kind: 'player', allowTeamDamage: record.provenance.allegiance.allowTeamDamage },
        color: record.presentation.color, ownerColor: request.ownerColor,
        keepGrenade: true, continuousTurn: true, nowMs: request.nowMs,
      });
      if (record.spec.flight.isGrenade) record.grenadeLastDirection = angle;
      count++;
    }
    return count;
  }

  private redirectProjectile(
    record: ProjectileRuntimeRecord,
    options: ReflectedProjectileOptions,
  ): void {
    const provenance: ProjectileProvenance = {
      ...record.provenance,
      attributionId: options.ownerId,
      attributionKind: undefined,
      allegiance: options.allegiance,
      lineage: { ...record.provenance.lineage, reflected: true },
    };
    record.provenance = this.resolveProvenance?.(provenance) ?? provenance;
    record.damage = options.damage;
    // The explicit reward intent survives ownership transfer; provenance capture replaces its gain basis.
    record.maxBounces = options.keepGrenade ? record.maxBounces : 0;
    record.bounceCount = options.keepGrenade ? record.bounceCount : 0;
    record.presentation = { ...record.presentation, color: options.color, ownerColor: options.ownerColor };
    this.flightContactPoints.delete(record.id);
    record.physics.body.reset(options.x, options.y);
    record.lastX = options.x;
    record.lastY = options.y;
    record.physics.body.setVelocity(Math.cos(options.angle) * options.speed, Math.sin(options.angle) * options.speed);
    // Focus follows field removal. Re-evaluate remaining fields while preserving intrinsic speed.
    if (options.continuousTurn) this.flightProcessor.resolveMovementFactor(record, options.nowMs);
    this.flightPaths.redirect(record.id, options.x, options.y, record.physics.body.velocity.x,
      record.physics.body.velocity.y, options.nowMs, !options.continuousTurn);
    this.resetHomingState(record);
  }

  setLineOfFireReadPort(port: LineOfFireReadPort | null): void {
    this.homingController.setLineOfFireReadPort(port);
  }

  private runMiniRocketStateStage(): void {
    for (const projectile of this.projectiles.activeRecords) {
      if (projectile.pendingDestroy
        || projectile.spec.flight.miniRocket.stageRangePx === undefined
        || !projectile.spec.flight.homing
        || (projectile.pendingExplosion && (projectile.interaction.multiExplosionsRemaining ?? 0) > 0)) continue;
      if (this.miniRocketProcessor.update(projectile, projectile.simulatedAgeMs ?? 0)) {
        this.destroyProjectile(projectile.id);
      }
    }
  }

  private createHomingRequest(projectile: ProjectileRuntimeRecord): ProjectileHomingRequest {
    const runtime = this;
    return projectile.interaction.guidance ??= {
      get ownerId() { return projectile.provenance.allegiance.ownerId; },
      homing: projectile.spec.flight.homing!,
      isTargetClaimed: projectile.spec.flight.homingExcludedCircle?.bubbleId === undefined ? undefined : (id, type) => {
        const group = projectile.spec.flight.homingExcludedCircle!.bubbleId!;
        const claims = runtime.prismTargetClaims.get(group)?.get(`${type}:${id}`);
        return claims !== undefined && claims.size > (claims.has(projectile.id) ? 1 : 0);
      },
      get excludedCircle() {
        const circle = projectile.spec.flight.homingExcludedCircle;
        return circle?.bubbleId !== undefined
          && runtime.projectileTimeFieldPort?.isBubbleActive?.(circle.bubbleId, runtime.hostFrameNowMs) === false
          ? undefined : circle;
      },
      kinematics: {
        get x() { return projectile.physics.sprite.x; },
        get y() { return projectile.physics.sprite.y; },
        get velocityX() { return projectile.physics.body.velocity.x; },
        get velocityY() { return projectile.physics.body.velocity.y; },
        setVelocity: (x, y) => projectile.physics.body.setVelocity(x, y),
      },
      state: { lockedTargetId: null },
      excludedTargetKeys: projectile.interaction.multiExplosionExcludedTargetKeys,
      initialTargetProtection: projectile.spec.flight.collisionFilter.initialTargetProtection,
      excludedTarget: projectile.spec.flight.collisionFilter.excludedTarget,
    };
  }

  private resetHomingState(projectile: ProjectileRuntimeRecord): void {
    this.removePrismTargetClaim(projectile.id);
    const state = projectile.interaction.guidance?.state;
    if (!state) return;
    state.lockedTargetId = null;
    state.lockedTargetType = undefined;
    state.lastSearchAtSimulatedMs = undefined;
  }

  private hasVisibleProjectileBurn(projectile: ProjectileRuntimeRecord): boolean {
    if (projectile.spec.flight.isFlame || projectile.spec.flight.isGrenade) return false;
    return ((projectile.spec.interaction.burn.burnDurationMs ?? 0) > 0 && (projectile.spec.interaction.burn.burnDamagePerTick ?? 0) > 0)
      || ((projectile.interaction.burnAugment?.burn?.durationMs ?? 0) > 0
        && (projectile.interaction.burnAugment?.burn?.damagePerTick ?? 0) > 0);
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
      this.hostFrameNowMs,
    );
    this.updatePrismTargetClaim(projectile);
    return foundTarget;
  }

  private removePrismTargetClaim(id: ProjectileId): void {
    const previous = this.prismClaimByProjectile.get(id);
    if (!previous) return;
    const group = this.prismTargetClaims.get(previous.group)!;
    const claims = group.get(previous.key)!;
    claims.delete(id);
    if (claims.size === 0) group.delete(previous.key);
    if (group.size === 0) this.prismTargetClaims.delete(previous.group);
    this.prismClaimByProjectile.delete(id);
  }

  private updatePrismTargetClaim(projectile: ProjectileRuntimeRecord): void {
    const groupId = projectile.spec.flight.homingExcludedCircle?.bubbleId;
    const state = projectile.interaction.guidance?.state;
    const key = state?.lockedTargetId != null && state.lockedTargetType
      ? `${state.lockedTargetType}:${state.lockedTargetId}` : undefined;
    if (groupId === undefined || key === undefined || projectile.pendingDestroy) {
      this.removePrismTargetClaim(projectile.id);
      return;
    }
    const previous = this.prismClaimByProjectile.get(projectile.id);
    if (previous?.group === groupId && previous.key === key) return;
    this.removePrismTargetClaim(projectile.id);
    const group = this.prismTargetClaims.get(groupId) ?? new Map<string, Set<ProjectileId>>();
    const claims = group.get(key) ?? new Set<ProjectileId>();
    claims.add(projectile.id);
    group.set(key, claims);
    this.prismTargetClaims.set(groupId, group);
    this.prismClaimByProjectile.set(projectile.id, { group: groupId, key });
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
    this.portalQuery = null;
    this.bubbleChargePort = null;
    this.pendingGrenadeFragments.clear();
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingNextStageSpawns.length = 0;
    this.completedInteractionStages = 0;
    this.hasStartedInteractionStage = false;
    for (const record of [...this.projectiles.stepOrder]) this.releaseProjectile(record);
    this.projectiles.clear();
    this.flightPaths.clear();
    this.flightContactPoints.clear();
    this.detonableIds.clear();
    this.detonatorIds.clear();
    this.translocatorPuckIds.clear();
    this.travelEffectIds.clear();
    this.deflectorIds.clear();
    this.resolvedWorldContacts.clear();
    this.contactFrameNowMs = null;
    this.collisionProcessor.reset();
    this.threatSamples.length = 0;
    this.travelSamples.length = 0;
    this.activeProjectilesByOwner.clear();
    this.flightProcessor.reset();
    this.prismTargetClaims.clear();
    this.prismClaimByProjectile.clear();
    this.homingController.setTargetQueryPort(null);
    this.homingController.setTargetabilityPort(null);
    this.homingController.setLineOfFireReadPort(null);
    this.lifecycleProcessor.reset();
    this.projectileTimeFieldPort = null;
    this.collisionTargetQueryPort = null;
    this.worldBlockerPort = null;
    this.targetabilityPort = null;
    this.barrierPort = null;
    this.directImpactPort = null;
    this.trainImpactPort = null;
    this.miniRocketStatePort = null;
    this.projectileImpactEventCallback = null;
    this.naturalFlameExpiryCallback = null;
    this.portalDetonations.length = 0;
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
    cfg: ProjectileSpawnConfig,
    provenance: ProjectileProvenance,
    spawnHostNowMs = this.hostNowMs(),
  ): ProjectileId {
    provenance = this.resolveProvenance?.(provenance) ?? provenance;
    const id = this.projectiles.allocateId();
    const record = this.createProjectileRecord(id, x, y, angle, provenance.allegiance.ownerId, cfg, spawnHostNowMs, provenance);
    this.projectiles.insert(record);
    if (record.spec.interaction.detonable) this.detonableIds.add(id);
    if (record.spec.interaction.detonator) this.detonatorIds.add(id);
    if (record.spec.flight.isTranslocatorPuck === true) this.translocatorPuckIds.add(id);
    if (record.spec.interaction.impulse.leafBlowerDeflectsProjectiles === true) this.deflectorIds.add(id);
    if (hasTravelEffect(record)) this.travelEffectIds.add(id);
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
    const timeFactor = clampProjectileTimeFactor(this.projectileTimeFieldPort?.getMovementFactor(
      resolvedSpawn.x, resolvedSpawn.y, hostNowMs,
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
    const record: ProjectileRuntimeRecord = {
      id,
      grenadeLastDirection: cfg.isGrenade ? angle : undefined,
      lastX: resolvedSpawn.x,
      lastY: resolvedSpawn.y,
      pendingDestroy: false,
      pendingExplosion: false,
      bounceCount: cfg.initialBounceCount ?? 0,
      createdAt: hostNowMs,
      provenance,
      damage: cfg.damage,
      maxBounces: cfg.maxBounces,
      adrenalinGain: cfg.adrenalinGain,
      hitboxSize: cfg.size,
      lastCountdownEmitted: null,
      frictionActivated: false,
      simulatedAgeMs: 0,
      timeBubbleFactor: timeFactor,
      remainingRangePx: cfg.remainingRangePx,
      bounceProcessedThisStep: false,
      physics: handle,
      spec: {
        flight: {
          lifetimeMs: cfg.lifetime,
          isGrenade: cfg.isGrenade,
          speed: cfg.speed,
          speedVariation: cfg.speedVariation,
          originalBodySize: cfg.size < MIN_BODY_LEN
            && cfg.isFlame !== true
            && !hasLeafBlowerCapability(cfg)
            && cfg.isBfg !== true
            && !hasGaussDischarge(cfg)
            && !cfg.isGrenade ? cfg.size : undefined,
          collisionMode: resolveProjectileCollisionMode(cfg),
          isTranslocatorPuck: cfg.isTranslocatorPuck,
          homing: cfg.homing,
          homingExcludedCircle: cfg.homingExcludedCircle,
          piercesTargets: cfg.piercesTargets,
          fuseTime: cfg.fuseTime,
          isFlame: cfg.isFlame,
          isBfg: cfg.isBfg,
          collisionFilter: {
            ignoreBaseCollisions: cfg.ignoreBaseCollisions,
            ignoreRockIndex: cfg.ignoreRockIndex,
            excludedTarget: cfg.excludedTarget,
            initialTargetProtection: cfg.initialTargetProtection
          },
          hitboxGrowth: {
            growRatePerSec: cfg.hitboxGrowRate,
            maxSize: cfg.hitboxMaxSize
          },
          drag: {
            velocityDecayPerSec: cfg.velocityDecay,
            frictionDelayMs: cfg.frictionDelayMs,
            airFrictionDecayPerSec: cfg.airFrictionDecayPerSec,
            bounceFrictionMultiplier: cfg.bounceFrictionMultiplier,
            stopSpeedThreshold: cfg.stopSpeedThreshold
          },
          split: {
            count: cfg.splitCount,
            spread: cfg.splitSpread,
            speedFactor: cfg.splitFactor,
            homing: cfg.splitHoming
          },
          penetration: {
            damageRetention: cfg.penetrationDamageRetention,
            penetratesRocks: cfg.penetratesRocks
          },
          miniRocket: {
            stageRangePx: cfg.miniRocketStageRangePx,
            returnEnabled: cfg.miniRocketReturnEnabled,
            returnRangeBuffer: cfg.miniRocketReturnRangeBuffer,
            pickupRadius: cfg.miniRocketPickupRadius,
            pickupAdrenalineRefundFraction: cfg.miniRocketPickupAdrenalineRefundFraction,
            pickupArmor: cfg.miniRocketPickupArmor,
            adrenalineCostPaid: cfg.miniRocketAdrenalineCostPaid,
            safetyLifetimeMs: cfg.miniRocketSafetyLifetimeMs,
            cascadeDamageBonusPerExplosion: cfg.miniRocketCascadeDamageBonusPerExplosion
          }
        },
        interaction: {
          proximityPulse: cfg.proximityPulse,
          enemyHitExplosion: cfg.enemyHitExplosion,
          impactCloud: cfg.impactCloud,
          energyInjectorPayload: cfg.energyInjectorPayload,
          grenadeEffect: cfg.grenadeEffect,
          detonable: cfg.detonable,
          detonator: cfg.detonator,
          multiExplosionCoastMs: cfg.multiExplosionCoastMs,
          directHit: {
            appliedSourceDamageFactors: cfg.appliedSourceDamageFactors?.map((factor) => ({ ...factor })),
            plasmaSwarmEnabled: cfg.plasmaSwarmEnabled,
            plasmaSwarmProjectileCount: cfg.plasmaSwarmProjectileCount,
            plasmaSwarmExplosionRadius: cfg.plasmaSwarmExplosionRadius,
            plasmaSwarmExplosionDamage: cfg.plasmaSwarmExplosionDamage,
            plasmaSwarmExplosionSlowFraction: cfg.plasmaSwarmExplosionSlowFraction,
            rockDamageMult: cfg.rockDamageMult,
            trainDamageMult: cfg.trainDamageMult,
            baseDamageMult: cfg.baseDamageMult,
            gaussChainRadius: cfg.gaussChainRadius,
            gaussChainDamageFactor: cfg.gaussChainDamageFactor,
            ak47DamageMultiplier: cfg.ak47DamageMultiplier,
            ak47FireSuperiorityShot: cfg.ak47FireSuperiorityShot,
            shotgunOriginX: cfg.shotgunOriginX,
            shotgunOriginY: cfg.shotgunOriginY,
            shotgunResolvedRange: cfg.shotgunResolvedRange,
            shotgunProximityMaxDamageBonus: cfg.shotgunProximityMaxDamageBonus,
            shotgunSlowFraction: cfg.shotgunSlowFraction,
            shotgunSlowDurationMs: cfg.shotgunSlowDurationMs,
            hitSlowFraction: cfg.hitSlowFraction,
            hitSlowDurationMs: cfg.hitSlowDurationMs,
            hitVulnerabilityDurationMs: cfg.hitVulnerabilityDurationMs,
            hitStunDurationMs: cfg.hitStunDurationMs,
            hitKnockback: cfg.hitKnockback,
            hitKnockbackDurationMs: cfg.hitKnockbackDurationMs
          },
          burn: {
            burnDurationMs: cfg.burnDurationMs,
            burnDamagePerTick: cfg.burnDamagePerTick,
            canReceiveFireImbue: cfg.canReceiveFireImbue
          },
          pathEffect: {
            fireTrail: cfg.fireTrail,
            pathEffectKind: cfg.pathEffectKind,
            fireTrailHalfWidthCells: cfg.fireTrailHalfWidthCells,
            awpCorridorHalfWidth: cfg.awpCorridorHalfWidth,
            awpCorridorDamage: cfg.awpCorridorDamage,
            awpCorridorDotDurationMs: cfg.awpCorridorDotDurationMs,
            awpCorridorDotTickIntervalMs: cfg.awpCorridorDotTickIntervalMs,
            awpCorridorKnockback: cfg.awpCorridorKnockback,
            awpCorridorKnockbackDurationMs: cfg.awpCorridorKnockbackDurationMs
          },
          impulse: {
            leafBlowerMinKnockback: cfg.leafBlowerMinKnockback,
            leafBlowerMaxKnockback: cfg.leafBlowerMaxKnockback,
            leafBlowerSelfPush: cfg.leafBlowerSelfPush,
            leafBlowerDeflectsProjectiles: cfg.leafBlowerDeflectsProjectiles
          }
        },
      },
      presentation: {
        color: cfg.color,
        ownerColor: cfg.ownerColor,
        visualMuzzleOrigin: cfg.visualMuzzleOrigin,
        projectileVisualScale: cfg.projectileVisualScale,
        smokeTrailColor: cfg.smokeTrailColor,
        projectileStyle: cfg.projectileStyle,
        sporeVisualVariant: cfg.sporeVisualVariant,
        bulletVisualPreset: cfg.bulletVisualPreset,
        grenadeVisualPreset: cfg.grenadeVisualPreset,
        energyBallVariant: cfg.energyBallVariant,
        tracerConfig: cfg.tracerConfig,
        projectileBurnVisualStyle: cfg.projectileBurnVisualStyle,
        shotAudioKey: cfg.shotAudioKey,
        suppressSpawnFx: cfg.suppressSpawnFx,
      },
      interaction: {
        ak47HitConfirmed: false,
        lastProximityPulseAt: (cfg.proximityPulse?.radius ?? 0) > 0
          && (cfg.proximityPulse?.damage ?? 0) > 0 ? 0 : undefined,
        explosion: cfg.explosion,
        burnAugment: cfg.supplementalBurnOnHit ? {
          burn: cfg.supplementalBurnOnHit,
          provenance: cfg.supplementalBurnProvenance
            ? this.resolveProvenance?.(cfg.supplementalBurnProvenance) ?? cfg.supplementalBurnProvenance
            : provenance,
        } : undefined,
        penetrationRemaining: cfg.penetrationCount,
        multiExplosionsRemaining: Math.max(1, Math.floor(cfg.multiExplosionCount ?? 1)),
        multiExplosionExcludedTargetKeys: (cfg.multiExplosionCount ?? 1) > 1 ? new Set<string>() : undefined
      },
      miniRocket: cfg.miniRocketStageRangePx === undefined ? {} : { phase: 'attack' },
      contacts: {
        flamePierceHitIds: cfg.isFlame && cfg.flamePiercing ? new Set<string>() : undefined,
        hitObstacleIds: cfg.isFlame ? new Set<number>() : undefined,
        penetrationHitIds: (cfg.penetrationCount ?? 0) > 0 ? new Set<string>() : undefined,
        piercingHitIds: (cfg.isBfg || cfg.piercesTargets
          || ((cfg.proximityPulse?.radius ?? 0) > 0 && (cfg.proximityPulse?.damage ?? 0) > 0))
          ? new Set<string>() : undefined,
        penetratedRockIds: cfg.penetratesRocks ? new Set<number>() : undefined,
        awpCorridorHitIds: cfg.awpCorridorHalfWidth !== undefined ? new Set<string>() : undefined,
      },
    };
    if (cfg.homing) this.createHomingRequest(record);
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
    if (cfg.tracerConfig || cfg.projectileStyle === 'rocket' || cfg.canReceiveFireImbue
      || (cfg.burnDurationMs ?? 0) > 0) {
      this.flightPaths.begin(id, resolvedSpawn.x, resolvedSpawn.y, handle.body.velocity.x, handle.body.velocity.y, hostNowMs);
    }
    this.presentation.createSpawnRendererVisuals(id, handle.sprite, resolvedSpawn.x, resolvedSpawn.y, cfg, ownerId);
    this.presentation.registerFallbackShape(handle.sprite);
    if (cfg.isBfg) this.presentation.createBfgVisual(id, resolvedSpawn.x, resolvedSpawn.y, cfg.size);
    this.presentation.createSpawnFeedback(id, resolvedSpawn.x, resolvedSpawn.y, x, y, angle, ownerId, cfg);
    return record;
  }

  private recordFlightPosition(record: ProjectileRuntimeRecord, nowMs: number): void {
    const contact = this.flightContactPoints.get(record.id);
    if (contact && (record.pendingDestroy || !this.projectiles.activeRecords.has(record))) {
      this.flightPaths.discardPending(record.id);
      this.flightPaths.append(record.id, contact.x, contact.y, record.physics.body.velocity.x, record.physics.body.velocity.y, nowMs);
    } else {
      this.flightContactPoints.delete(record.id);
      if (!record.portalFlightPending && !this.flightPaths.commitThrough(record.id, record.physics.sprite.x, record.physics.sprite.y)) return;
      record.portalFlightPending = false;
      this.flightPaths.append(record.id, record.physics.sprite.x, record.physics.sprite.y,
        record.physics.body.velocity.x, record.physics.body.velocity.y, nowMs);
    }
  }

  private removeCapabilityIds(id: ProjectileId): void {
    this.deflectorIds.delete(id);
    this.detonableIds.delete(id);
    this.detonatorIds.delete(id);
    this.translocatorPuckIds.delete(id);
    this.travelEffectIds.delete(id);
  }
}

function hasTravelEffect(record: ProjectileRuntimeRecord): boolean {
  return record.spec.interaction.burn.canReceiveFireImbue === true
    || record.spec.interaction.pathEffect.fireTrail !== undefined
    || record.spec.interaction.pathEffect.awpCorridorHalfWidth !== undefined
    || record.spec.interaction.pathEffect.awpCorridorDamage !== undefined
    || record.spec.interaction.pathEffect.awpCorridorDotDurationMs !== undefined
    || record.spec.interaction.pathEffect.awpCorridorDotTickIntervalMs !== undefined
    || record.spec.interaction.pathEffect.awpCorridorKnockback !== undefined
    || record.spec.interaction.pathEffect.awpCorridorKnockbackDurationMs !== undefined;
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
    // Swept shots resolve rock contact, damage and reflection in sweepRocks.
    // An Arcade collider would reflect first from a potentially different tile face.
    rock: !usesRockSweep({ ...cfg, collisionMode: resolveProjectileCollisionMode(cfg),
      penetration: { penetratesRocks: cfg.penetratesRocks } }),
    trunk: !passThrough,
    base: !passThrough && !cfg.ignoreBaseCollisions
      && !usesRockSweep({ ...cfg, collisionMode: resolveProjectileCollisionMode(cfg),
        penetration: { penetratesRocks: cfg.penetratesRocks } }),
    train: true,
    ignoreRockIndex: cfg.ignoreRockIndex,
  };
}

function hasLeafBlowerCapability(
  projectile: Pick<ProjectileSpawnConfig, 'leafBlowerMinKnockback' | 'leafBlowerMaxKnockback' | 'leafBlowerDeflectsProjectiles'>,
): boolean {
  return projectile.leafBlowerMinKnockback !== undefined
    || projectile.leafBlowerMaxKnockback !== undefined
    || projectile.leafBlowerDeflectsProjectiles === true;
}

function hasGaussDischarge(
  projectile: Pick<ProjectileSpawnConfig, 'gaussChainRadius' | 'gaussChainDamageFactor'>,
): boolean {
  return (projectile.gaussChainRadius ?? 0) > 0
    && (projectile.gaussChainDamageFactor ?? 0) > 0;
}

function shouldPassThroughWorldTarget(projectile: ProjectileRuntimeRecord): boolean {
  return projectile.spec.flight.isBfg === true || hasGaussDischarge(projectile.spec.interaction.directHit);
}

function createTravelPathEffect(record: ProjectileRuntimeRecord): ProjectileTravelCapabilities['pathEffect'] {
  const fireTrail = record.spec.interaction.pathEffect.fireTrail
    ? {
      effect: record.spec.interaction.pathEffect.fireTrail,
      halfWidthCells: Math.max(0, Math.floor(record.spec.interaction.pathEffect.fireTrailHalfWidthCells ?? 0)),
      cellKey: `${Math.floor(record.physics.sprite.x / 16)}:${Math.floor(record.physics.sprite.y / 16)}`,
    }
    : undefined;
  const hasCorridor = record.spec.interaction.pathEffect.awpCorridorHalfWidth !== undefined
    || record.spec.interaction.pathEffect.awpCorridorDamage !== undefined
    || record.spec.interaction.pathEffect.awpCorridorDotDurationMs !== undefined
    || record.spec.interaction.pathEffect.awpCorridorDotTickIntervalMs !== undefined
    || record.spec.interaction.pathEffect.awpCorridorKnockback !== undefined
    || record.spec.interaction.pathEffect.awpCorridorKnockbackDurationMs !== undefined;
  const awpCorridor = hasCorridor
    ? {
      halfWidth: record.spec.interaction.pathEffect.awpCorridorHalfWidth ?? 0,
      damage: record.spec.interaction.pathEffect.awpCorridorDamage ?? 0,
      dotDurationMs: record.spec.interaction.pathEffect.awpCorridorDotDurationMs,
      dotTickIntervalMs: record.spec.interaction.pathEffect.awpCorridorDotTickIntervalMs,
      knockback: record.spec.interaction.pathEffect.awpCorridorKnockback,
      knockbackDurationMs: record.spec.interaction.pathEffect.awpCorridorKnockbackDurationMs,
    }
    : undefined;
  if (!fireTrail && !awpCorridor) return undefined;
  return { kind: record.spec.interaction.pathEffect.pathEffectKind, fireTrail, awpCorridor };
}

function burnDps(burn: { damagePerTick: number }): number {
  return burn.damagePerTick * 1000 / BURN_TICK_INTERVAL_MS;
}

function clampProjectileTimeFactor(value: number): number {
  return Math.max(0, Math.min(1, value));
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
    x: projectile.physics.sprite.x,
    y: projectile.physics.sprite.y,
    projectileOwnerId: projectile.provenance.allegiance.ownerId,
    effect: projectile.spec.interaction.detonable!,
    sourceId: projectile.provenance.weaponSourceId ?? 'weapon.unknown',
    sourceSlot: projectile.provenance.sourceSlot,
  };
}

function emptyHostStageResult(): ProjectileHostStageResult {
  return { projectileExplosions: [], grenadePayloads: [], countdownEvents: [] };
}

/**
 * Projiziert die verbleibenden Fähigkeiten für einen normalen Child-Spawn.
 *
 * Identity und Provenance bleiben am Spawn-Pfad; dieser Adapter kopiert keinen Runtime-State.
 */
function createInheritedProjectilePayload(
  record: ProjectileRuntimeRecord,
): Partial<ProjectileSpawnConfig> {
  return {
    appliedSourceDamageFactors: record.spec.interaction.directHit.appliedSourceDamageFactors
      ?.map((factor) => ({ ...factor })),
    explosion:            record.interaction.explosion,
    enemyHitExplosion:    record.spec.interaction.enemyHitExplosion,
    impactCloud:          record.spec.interaction.impactCloud,
    grenadeEffect:        record.spec.interaction.grenadeEffect,
    burnDurationMs:       record.spec.interaction.burn.burnDurationMs,
    burnDamagePerTick:    record.spec.interaction.burn.burnDamagePerTick,
    projectileBurnVisualStyle: record.presentation.projectileBurnVisualStyle,
    supplementalBurnOnHit: record.interaction.burnAugment?.burn,
    supplementalBurnProvenance: record.interaction.burnAugment?.provenance,
    canReceiveFireImbue:  record.spec.interaction.burn.canReceiveFireImbue,
    fireTrail:            record.spec.interaction.pathEffect.fireTrail,
    pathEffectKind:       record.spec.interaction.pathEffect.pathEffectKind,
    fireTrailHalfWidthCells: record.spec.interaction.pathEffect.fireTrailHalfWidthCells,
    awpCorridorHalfWidth: record.spec.interaction.pathEffect.awpCorridorHalfWidth,
    awpCorridorDamage:    record.spec.interaction.pathEffect.awpCorridorDamage,
    awpCorridorDotDurationMs: record.spec.interaction.pathEffect.awpCorridorDotDurationMs,
    awpCorridorDotTickIntervalMs: record.spec.interaction.pathEffect.awpCorridorDotTickIntervalMs,
    awpCorridorKnockback: record.spec.interaction.pathEffect.awpCorridorKnockback,
    awpCorridorKnockbackDurationMs: record.spec.interaction.pathEffect.awpCorridorKnockbackDurationMs,
    detonable:            record.spec.interaction.detonable,
    detonator:            record.spec.interaction.detonator,
    proximityPulse:       record.spec.interaction.proximityPulse,
    collisionMode:        record.spec.flight.collisionMode,
    isTranslocatorPuck:   record.spec.flight.isTranslocatorPuck,
    piercesTargets:       record.spec.flight.piercesTargets,
    penetrationCount:     record.interaction.penetrationRemaining,
    penetrationDamageRetention: record.spec.flight.penetration.damageRetention,
    penetratesRocks:      record.spec.flight.penetration.penetratesRocks,
    isFlame:              record.spec.flight.isFlame,
    flamePiercing:        record.contacts.flamePierceHitIds !== undefined,
    isBfg:                record.spec.flight.isBfg,
    leafBlowerDeflectsProjectiles: record.spec.interaction.impulse.leafBlowerDeflectsProjectiles,
    leafBlowerMinKnockback: record.spec.interaction.impulse.leafBlowerMinKnockback,
    leafBlowerMaxKnockback: record.spec.interaction.impulse.leafBlowerMaxKnockback,
    leafBlowerSelfPush:   record.spec.interaction.impulse.leafBlowerSelfPush,
    gaussChainRadius:     record.spec.interaction.directHit.gaussChainRadius,
    gaussChainDamageFactor: record.spec.interaction.directHit.gaussChainDamageFactor,
    rockDamageMult:       record.spec.interaction.directHit.rockDamageMult,
    trainDamageMult:      record.spec.interaction.directHit.trainDamageMult,
    baseDamageMult:       record.spec.interaction.directHit.baseDamageMult,
    hitSlowFraction:      record.spec.interaction.directHit.hitSlowFraction,
    hitSlowDurationMs:    record.spec.interaction.directHit.hitSlowDurationMs,
    hitVulnerabilityDurationMs: record.spec.interaction.directHit.hitVulnerabilityDurationMs,
    hitStunDurationMs: record.spec.interaction.directHit.hitStunDurationMs,
    hitKnockback:         record.spec.interaction.directHit.hitKnockback,
    hitKnockbackDurationMs: record.spec.interaction.directHit.hitKnockbackDurationMs,
  };
}
