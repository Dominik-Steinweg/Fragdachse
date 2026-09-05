import type { LoadoutSlot, ProjectileSpawnConfig, ProjectileRuntimeRecord } from '../types';
import type { ProjectilePhysicsBinding } from './ProjectilePhysicsBinding';
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
import {
  ProjectileFlightProcessor,
  type ProjectileCoreStageResult,
} from './ProjectileFlightProcessor';
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
  ProjectileExternalInteractionAccess,
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
import type {
  ProjectileCollisionTargetQueryPort,
  ProjectileImpactCandidate,
  ProjectileTargetabilityPort,
  ProjectileWorldBlockerPort,
} from './ProjectileTargetPort';
import { createInheritedProjectilePayload } from './projectileSpawnPayloadAdapter';
import { ProjectileStore } from './ProjectileStore';

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

export interface ProjectileHostStageResult {
  /** Typed requests; domain fan-out is resolved after the post-projectile stage. */
  projectileExplosions: ProjectileExplosionRequest[];
  grenadePayloads: ProjectileGrenadePayloadRequest[];
  countdownEvents: Array<{ x: number; y: number; value: number }>;
}

/**
 * Noch nicht migrierte Host-Simulation eines Projectiles (`03 §5.1`).
 *
 * Sie erzeugt und entsorgt weiterhin Physics-Handle, Collider und Darstellung, besitzt aber weder
 * Identity noch Registry: beides liegt beim Owner. Jede hier genannte Operation entfällt mit dem
 * Cutover ihres Fachbereichs (Phasen 3–14).
 */
export interface ProjectilePhysicsBindingPort {
  /** Verbindet das Phaser-Physics-Binding mit dem kanonischen Store dieser World. */
  bindOwner(owner: ProjectileRuntimeOwnerPort | null): void;
  /** Baut Physics-Handle, Collider, Spawn-Darstellung und Runtime-Record zu einer vergebenen Id. */
  createProjectile(
    id: ProjectileId,
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
    hostNowMs: number,
    provenance: ProjectileProvenance,
  ): ProjectileRuntimeRecord;
  /** Gibt Physics-, Collider- und Darstellungsressourcen eines entfernten Records frei. */
  releaseProjectileResources(record: ProjectileRuntimeRecord): void;
  /** Führt den Physics-/Effect-Rest nach dem deterministischen Flight-Stage aus. */
  runProjectileEffectsStage?(
    deltaMs: number,
    nowMs: number,
    coreStage: ProjectileCoreStageResult,
  ): ProjectileHostStageResult;
  /** Übergangshilfe für die bestehende Spawn-Initialisierung. */
  setProjectileTimeFieldPort?(port: ProjectileTimeFieldPort | null): void;
  setHostFrameTime?(nowMs: number): void;
  /** Semantische External-Interaction-Brücke; Runtime-Records bleiben intern. */
  externalInteraction?: ProjectileExternalInteractionAccess;
  /** Der Physics-Binding-Owner schreibt den kanonischen Burn-Zustand. */
  applyProjectileBurnAugment?(projectileId: ProjectileId, augment: ProjectileBurnAugment): boolean;
  /** Queues a typed explosion or terminal lifecycle after an authoritative Direct Outcome. */
  completeDirectImpact?(
    projectileId: ProjectileId,
    target: ProjectileCombatTargetRef,
    impact: { readonly x: number; readonly y: number },
    outcome: ProjectileDirectImpactOutcome,
  ): boolean;
  /** Applies the small same-frame domain outcome to projectile continuation state. */
  completeProjectileExplosion?(projectileId: ProjectileId, damagedTargetKeys: readonly string[]): void;
  /** Räumt den registry-fremden Rest ab: Physics-Binding-State wird world-lokal freigegeben. */
  releaseWorldState(): void;
}

/**
 * Owner-vermittelte Operationen für den noch nicht migrierten Host-Code (`03 §5.1`).
 *
 * Der Seam zeigt ausschließlich auf denselben kanonischen Store; er kopiert nichts, vergibt keine
 * zweite Identity und wird nicht an neue Consumer verteilt.
 */
export interface ProjectileRuntimeOwnerPort {
  /** Internal binding seam; the Store itself never crosses the World boundary. */
  readonly readProjectileStepOrder: () => readonly ProjectileRuntimeRecord[];
  readonly readActiveProjectileRecords: () => ReadonlySet<ProjectileRuntimeRecord>;
  readonly readProjectileRecord: (id: ProjectileId) => ProjectileRuntimeRecord | undefined;
  readonly deactivateProjectileRecord: (record: ProjectileRuntimeRecord) => void;
  readonly dropProjectileStepEntryAt: (index: number) => void;
  /** Erstellt ein Projectile aus der aufgelösten, bestehenden Spawn-Payload. */
  spawnProjectileConfig(
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
  ): ProjectileId;
  /** Entfernt ein Projectile vollständig; unbekannte Ids sind wirkungslos. */
  destroyProjectile(id: ProjectileId): void;
  /** Queues a Hydra split without exposing Runtime records to the physics binding. */
  queueHydraSplit?(
    projectileId: ProjectileId,
    impactX: number,
    impactY: number,
    outgoingVx: number,
    outgoingVy: number,
  ): boolean;
  /** Beendet Identity und Aktivmenge und gibt die Ressourcen frei; der Step-Eintrag bleibt. */
  releaseProjectile(record: ProjectileRuntimeRecord): void;
  /** Host Frame: deterministische Flight-/Lifetime-/Homing-Verarbeitung. */
  runHostProjectileStage?(deltaMs: number, nowMs: number): ProjectileHostStageResult;
  /** Completes the local Mini-Rocket state machine after deferred explosion resolution. */
  resumeMiniRocketExplosion?(projectileId: ProjectileId): void;
  setProjectileTimeFieldPort?(port: ProjectileTimeFieldPort | null): void;
  setProjectileTargetQueryPort?(port: ProjectileTargetQueryPort | null): void;
  setProjectileTargetabilityPort?(port: ProjectileTargetabilityPort | null): void;
  setLineOfFireReadPort?(port: LineOfFireReadPort | null): void;
  resolveProjectileHoming?(request: ProjectileHomingRequest, simulatedAgeMs: number, forceSearch?: boolean): boolean;
  setHostFrameTime?(nowMs: number): void;
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
  private readonly bindingOwner: ProjectileRuntimeOwnerPort;
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
  private collisionTargetQueryPort: ProjectileCollisionTargetQueryPort | null = null;
  private worldBlockerPort: ProjectileWorldBlockerPort | null = null;
  private targetabilityPort: ProjectileTargetabilityPort | null = null;
  private barrierPort: ProjectileBarrierPort | null = null;
  private directImpactPort: ProjectileCombatPort | null = null;
  private readonly physicsBinding: ProjectilePhysicsBinding;
  private readonly hostNowMs: () => number;
  private readonly onDestroy?: () => void;
  private projectileTimeFieldPort: ProjectileTimeFieldPort | null = null;
  private readonly pendingNextStageSpawns: PendingNextStageProjectileSpawn[] = [];
  private completedInteractionStages = 0;
  private hasStartedInteractionStage = false;
  private hostFrameNowMs = 0;
  private interactionNowMs = 0;
  private destroyed = false;

  constructor(options: WorldProjectileRuntimeOptions) {
    this.physicsBinding = options.physicsBinding as ProjectilePhysicsBinding;
    this.presentation = options.presentation;
    this.hostNowMs = options.hostNowMs;
    this.onDestroy = options.onDestroy;
    this.projectiles = new ProjectileStore(options.identityScope);
    const runtime = this;
    this.bindingOwner = {
      readProjectileStepOrder: () => runtime.projectiles.stepOrder,
      readActiveProjectileRecords: () => runtime.projectiles.activeRecords,
      readProjectileRecord: (id) => runtime.projectiles.getById(id),
      deactivateProjectileRecord: (record) => runtime.projectiles.deactivate(record),
      dropProjectileStepEntryAt: (index) => runtime.projectiles.dropStepEntryAt(index),
      spawnProjectileConfig: (x, y, angle, ownerId, cfg) => runtime.spawnProjectileConfig(x, y, angle, ownerId, cfg),
      destroyProjectile: (id) => runtime.destroyProjectile(id),
      queueHydraSplit: (projectileId, impactX, impactY, outgoingVx, outgoingVy) => (
        runtime.queueHydraSplit(projectileId, impactX, impactY, outgoingVx, outgoingVy)
      ),
      releaseProjectile: (record) => runtime.releaseProjectile(record),
      runHostProjectileStage: (deltaMs, nowMs) => runtime.runHostProjectileStage(deltaMs, nowMs),
      resumeMiniRocketExplosion: (projectileId) => runtime.resumeMiniRocketExplosion(projectileId),
      setProjectileTimeFieldPort: (port) => runtime.setProjectileTimeFieldPort(port),
      setProjectileTargetQueryPort: (port) => runtime.setProjectileTargetQueryPort(port),
      setProjectileTargetabilityPort: (port) => runtime.setProjectileTargetabilityPort(port),
      setLineOfFireReadPort: (port) => runtime.setLineOfFireReadPort(port),
      resolveProjectileHoming: (request, simulatedAgeMs, forceSearch) => (
        runtime.resolveProjectileHoming(request, simulatedAgeMs, forceSearch)
      ),
      setHostFrameTime: (nowMs) => runtime.setHostFrameTime(nowMs),
    };
    this.collisionDependencies = {
      get targetQuery() { return runtime.collisionTargetQueryPort; },
      get targetability() { return runtime.targetabilityPort; },
      get worldBlocker() { return runtime.worldBlockerPort; },
      get directImpact() { return runtime.directImpactPort; },
      destroyProjectile: (id) => this.destroyProjectile(id),
      applyDefense: (record, defense, candidate) => this.applyDefense(record, defense, candidate),
      completeDirectImpact: (record, target, impact, outcome) => (
        this.physicsBinding.completeDirectImpact?.(record.id, target, impact, outcome) ?? false
      ),
    };
    this.physicsBinding.bindOwner(this.bindingOwner);
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
    this.physicsBinding.applyPlasmaSwarmImpact(impact);
  }

  setNaturalFlameExpiryCallback(callback: Parameters<ProjectilePhysicsBinding['setNaturalFlameExpiryCallback']>[0]): void {
    this.physicsBinding.setNaturalFlameExpiryCallback(callback);
  }

  setProjectileImpactCallback(callback: Parameters<ProjectilePhysicsBinding['setProjectileImpactCallback']>[0]): void {
    this.physicsBinding.setProjectileImpactCallback(callback);
  }

  setProjectileResolvedCallback(callback: Parameters<ProjectilePhysicsBinding['setProjectileResolvedCallback']>[0]): void {
    this.physicsBinding.setProjectileResolvedCallback(callback);
  }

  setMiniRocketDestroyedCallback(callback: Parameters<ProjectilePhysicsBinding['setMiniRocketDestroyedCallback']>[0]): void {
    this.physicsBinding.setMiniRocketDestroyedCallback(callback);
  }

  setStandaloneExplosionRequestCallback(callback: Parameters<ProjectilePhysicsBinding['setStandaloneExplosionRequestCallback']>[0]): void {
    this.physicsBinding.setStandaloneExplosionRequestCallback(callback);
  }

  setProximityPulseCallback(callback: Parameters<ProjectilePhysicsBinding['setProximityPulseCallback']>[0]): void {
    this.physicsBinding.setProximityPulseCallback(callback);
  }

  setTimeBubbleFactorProvider(provider: Parameters<ProjectilePhysicsBinding['setTimeBubbleFactorProvider']>[0]): void {
    this.physicsBinding.setTimeBubbleFactorProvider(provider);
  }

  setHomingTargetProvider(provider: Parameters<ProjectilePhysicsBinding['setHomingTargetProvider']>[0]): void {
    this.physicsBinding.setHomingTargetProvider(provider);
  }

  setHomingLineOfFireChecker(checker: Parameters<ProjectilePhysicsBinding['setHomingLineOfFireChecker']>[0]): void {
    this.physicsBinding.setHomingLineOfFireChecker(checker);
  }

  setRockHitCallback(callback: Parameters<ProjectilePhysicsBinding['setRockHitCallback']>[0]): void {
    this.physicsBinding.setRockHitCallback(callback);
  }

  setObstacleKindResolver(resolver: Parameters<ProjectilePhysicsBinding['setObstacleKindResolver']>[0]): void {
    this.physicsBinding.setObstacleKindResolver(resolver);
  }

  setBaseHitCallback(callback: Parameters<ProjectilePhysicsBinding['setBaseHitCallback']>[0]): void {
    this.physicsBinding.setBaseHitCallback(callback);
  }

  setSupportImpactCallback(callback: Parameters<ProjectilePhysicsBinding['setSupportImpactCallback']>[0]): void {
    this.physicsBinding.setSupportImpactCallback(callback);
  }

  setRockGroup(...args: Parameters<ProjectilePhysicsBinding['setRockGroup']>): void {
    this.physicsBinding.setRockGroup(...args);
  }

  setBaseGroup(...args: Parameters<ProjectilePhysicsBinding['setBaseGroup']>): void {
    this.physicsBinding.setBaseGroup(...args);
  }

  setObstacleIndex(...args: Parameters<ProjectilePhysicsBinding['setObstacleIndex']>): void {
    this.physicsBinding.setObstacleIndex(...args);
  }

  setTrainGroup(...args: Parameters<ProjectilePhysicsBinding['setTrainGroup']>): void {
    this.physicsBinding.setTrainGroup(...args);
  }

  setTrainHitCallback(callback: Parameters<ProjectilePhysicsBinding['setTrainHitCallback']>[0]): void {
    this.physicsBinding.setTrainHitCallback(callback);
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
  queueHydraSplit(
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
    this.removeCapabilityIds(record.id);
    this.projectiles.detach(record);
    this.physicsBinding.releaseProjectileResources(record);
  }

  searchDetonableProjectiles(request: ProjectileDetonationSearchRequest): readonly ProjectileDetonationTarget[] {
    if (this.destroyed) return [];
    return this.physicsBinding.externalInteraction?.searchDetonableProjectiles(this.detonableIds, request) ?? [];
  }

  detonateProjectile(
    projectileId: ProjectileId,
    detonatorOwnerId: string,
  ): ProjectileDetonationOutcome | null {
    if (this.destroyed || !this.detonableIds.has(projectileId)) return null;
    return this.physicsBinding.externalInteraction?.detonateProjectile(projectileId, detonatorOwnerId) ?? null;
  }

  detonateOverlappingProjectiles(): readonly ProjectileDetonationOutcome[] {
    if (this.destroyed) return [];
    return this.physicsBinding.externalInteraction?.detonateOverlappingProjectiles(
      this.detonatorIds,
      this.detonableIds,
    ) ?? [];
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

    const applied = this.physicsBinding.applyProjectileBurnAugment?.(projectileId, augment) ?? false;
    if (!applied) return false;
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
   * dessen schmale Ergebnisse an das nachgelagerte Physics-/Effect-Binding weiter.
   */
  runHostProjectileStage(deltaMs: number, nowMs: number): ProjectileHostStageResult {
    if (this.destroyed) return emptyHostStageResult();
    this.setHostFrameTime(nowMs);
    const coreStage = this.flightProcessor.run(this.projectiles.stepOrder, deltaMs, nowMs);
    const stage = this.physicsBinding.runProjectileEffectsStage?.(deltaMs, nowMs, coreStage)
      ?? {
        projectileExplosions: [],
        grenadePayloads: [],
        countdownEvents: coreStage.countdownEvents,
      };
    this.runMiniRocketStateStage();
    this.presentation.syncHostRenderers(this.presentationProjectiles);
    return stage;
  }

  setProjectileTimeFieldPort(port: ProjectileTimeFieldPort | null): void {
    this.projectileTimeFieldPort = port;
    this.flightProcessor.setTimeFieldPort(port);
    this.physicsBinding.setProjectileTimeFieldPort?.(port);
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

  resumeMiniRocketExplosion(projectileId: ProjectileId): void {
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

  resolveProjectileHoming(request: ProjectileHomingRequest, simulatedAgeMs: number, forceSearch = false): boolean {
    return this.homingController.update(request, simulatedAgeMs, forceSearch);
  }

  setHostFrameTime(nowMs: number): void {
    this.hostFrameNowMs = nowMs;
    this.physicsBinding.setHostFrameTime?.(nowMs);
    this.directImpactPort?.setHostFrameTime?.(nowMs);
  }

  /** World-Teardown: kein Record, kein Identity-Eintrag und kein Restzustand überlebt ihn. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingNextStageSpawns.length = 0;
    this.completedInteractionStages = 0;
    this.hasStartedInteractionStage = false;
    for (const record of this.projectiles.stepOrder) {
      this.projectiles.detach(record);
      this.physicsBinding.releaseProjectileResources(record);
    }
    this.projectiles.clear();
    this.detonableIds.clear();
    this.detonatorIds.clear();
    this.translocatorPuckIds.clear();
    this.travelEffectIds.clear();
    this.deflectorIds.clear();
    this.collisionProcessor.reset();
    this.burnAugments.clear();
    this.threatSamples.length = 0;
    this.travelSamples.length = 0;
    this.activeProjectilesByOwner.clear();
    this.flightProcessor.reset();
    this.projectileTimeFieldPort = null;
    this.projectileReplicationAdapter?.reset();
    this.projectileReplicationAdapter = null;
    this.presentation.releaseWorldPresentation();
    this.presentationStates.length = 0;
    this.clientReplica.reset();
    this.physicsBinding.releaseWorldState();
    this.physicsBinding.bindOwner(null);
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
    const record = this.physicsBinding.createProjectile(id, x, y, angle, ownerId, cfg, spawnHostNowMs, provenance);
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
  return Math.max(0.0001, Math.min(1, value));
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

function emptyHostStageResult(): ProjectileHostStageResult {
  return { projectileExplosions: [], grenadePayloads: [], countdownEvents: [] };
}
