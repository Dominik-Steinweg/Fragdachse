import type { LoadoutSlot, ProjectileSpawnConfig, TrackedProjectile } from '../types';
import type { WorldScopedBinding } from '../world/WorldRuntime';
import type { ProjectileIdentityScope } from './ProjectileIdentityScope';
import { toLegacyProjectileSpawnConfig } from './legacyProjectileSpawnPayload';
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
  LegacyProjectileExternalInteractionAccess,
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
import type {
  ProjectileBarrierPort,
  ProjectileBarrierResolution,
  ProjectileDefenseResolution,
  ProjectileDirectImpactPort,
} from './ProjectileInteractionPorts';
import type {
  ProjectileCollisionTargetQueryPort,
  ProjectileImpactCandidate,
  ProjectileTargetabilityPort,
  ProjectileWorldBlockerPort,
} from './ProjectileTargetPort';
import { createInheritedProjectilePayload } from './legacyProjectileSpawnPayload';
import { ProjectileStore, type LegacyProjectileStoreAccess } from './ProjectileStore';

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

export interface ProjectileHostStageResult {
  explodedProjectiles: import('../types').ExplodedProjectile[];
  explodedGrenades: import('../types').ExplodedGrenade[];
  countdownEvents: Array<{ x: number; y: number; value: number }>;
}

/**
 * Noch nicht migrierte Host-Simulation eines Projectiles (`03 §5.1`).
 *
 * Sie erzeugt und entsorgt weiterhin Physics-Handle, Collider und Darstellung, besitzt aber weder
 * Identity noch Registry: beides liegt beim Owner. Jede hier genannte Operation entfällt mit dem
 * Cutover ihres Fachbereichs (Phasen 3–14).
 */
export interface LegacyProjectileHostSimulation {
  /** Verbindet die Legacy-Verarbeitung mit dem kanonischen Store dieser World. */
  bindProjectileOwner(owner: ProjectileOwnerSeam | null): void;
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
  ): TrackedProjectile;
  /** Gibt Physics-, Collider- und Darstellungsressourcen eines entfernten Records frei. */
  releaseProjectileResources(record: TrackedProjectile): void;
  /** Führt nur die noch nicht migrierten Collision-/Effect-/Presentation-Reste aus. */
  runLegacyProjectileStage?(
    deltaMs: number,
    nowMs: number,
    coreStage: ProjectileCoreStageResult,
  ): ProjectileHostStageResult;
  /** Übergangshilfe für die bestehende Spawn-Initialisierung. */
  setProjectileTimeFieldPort?(port: ProjectileTimeFieldPort | null): void;
  setHostFrameTime?(nowMs: number): void;
  /** Semantische External-Interaction-Brücke; Runtime-Records bleiben intern. */
  externalInteraction?: LegacyProjectileExternalInteractionAccess;
  /** Übergangshilfe: der Legacy-Simulationsowner schreibt den kanonischen Burn-Zustand. */
  applyProjectileBurnAugment?(projectileId: ProjectileId, augment: ProjectileBurnAugment): boolean;
  /** Räumt den registry-fremden Rest ab: Renderer, Snapshot-Zustand und Client-Visuals. */
  releaseWorldProjectileState(): void;
}

/**
 * Owner-vermittelte Operationen für den noch nicht migrierten Host-Code (`03 §5.1`).
 *
 * Der Seam zeigt ausschließlich auf denselben kanonischen Store; er kopiert nichts, vergibt keine
 * zweite Identity und wird nicht an neue Consumer verteilt.
 */
export interface ProjectileOwnerSeam {
  readonly store: LegacyProjectileStoreAccess;
  /** Spawn im Legacy-Payload-Shape der noch nicht migrierten Quellen. */
  spawnLegacyProjectile(
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
  ): ProjectileId;
  /** Entfernt ein Projectile vollständig; unbekannte Ids sind wirkungslos. */
  destroyProjectile(id: ProjectileId): void;
  /** Beendet Identity und Aktivmenge und gibt die Ressourcen frei; der Step-Eintrag bleibt. */
  releaseProjectile(record: TrackedProjectile): void;
  /** Host Frame: deterministische Flight-/Lifetime-/Homing-Verarbeitung. */
  runHostProjectileStage?(deltaMs: number, nowMs: number): ProjectileHostStageResult;
  setProjectileTimeFieldPort?(port: ProjectileTimeFieldPort | null): void;
  setProjectileTargetQueryPort?(port: ProjectileTargetQueryPort | null): void;
  setProjectileTargetabilityPort?(port: ProjectileTargetabilityPort | null): void;
  setLineOfFireReadPort?(port: LineOfFireReadPort | null): void;
  resolveProjectileHoming?(request: ProjectileHomingRequest, simulatedAgeMs: number, forceSearch?: boolean): boolean;
  setHostFrameTime?(nowMs: number): void;
}

export interface WorldProjectileRuntimeOptions {
  readonly simulation: LegacyProjectileHostSimulation;
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
 * Flight, Kollision, Wirkung und Darstellung liegen bis zu ihren Cutover-Phasen weiterhin in der
 * Legacy-Simulation; sie arbeitet dabei auf **demselben** Store, nie auf einer Kopie.
 */
export class WorldProjectileRuntime implements
  ProjectileSpawnPort,
  ProjectileOwnerSeam,
  ProjectileExternalInteractionPort,
  TranslocatorProjectilePort,
  ProjectileThreatReadPort,
  ProjectileDiagnosticsReadPort,
  ProjectilePresentationReadPort,
  ProjectileTravelReadPort,
  ProjectileEnvironmentInteractionPort,
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
  /** Capability-Index der aktiven Luftstöße, die gegnerische Projectiles umlenken. */
  private readonly deflectorIds = new Set<ProjectileId>();
  private readonly collisionDependencies: ProjectileCollisionDependencies;
  private collisionTargetQueryPort: ProjectileCollisionTargetQueryPort | null = null;
  private worldBlockerPort: ProjectileWorldBlockerPort | null = null;
  private targetabilityPort: ProjectileTargetabilityPort | null = null;
  private barrierPort: ProjectileBarrierPort | null = null;
  private directImpactPort: ProjectileDirectImpactPort | null = null;
  private readonly simulation: LegacyProjectileHostSimulation;
  private readonly hostNowMs: () => number;
  private readonly onDestroy?: () => void;
  private interactionNowMs = 0;
  private destroyed = false;

  constructor(options: WorldProjectileRuntimeOptions) {
    this.simulation = options.simulation;
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
    };
    this.simulation.bindProjectileOwner(this);
  }

  get store(): LegacyProjectileStoreAccess {
    return this.projectiles;
  }

  /** Anzahl der aktuell wirksamen Projectiles dieser World. */
  get activeCount(): number {
    return this.projectiles.activeCount;
  }

  spawnProjectile(request: ProjectileSpawnRequest): ProjectileSpawnResult {
    const { origin } = request;
    return this.spawnResolved(
      origin.x,
      origin.y,
      origin.angle,
      request.provenance.allegiance.ownerId,
      toLegacyProjectileSpawnConfig(request),
      request.provenance,
    );
  }

  spawnLegacyProjectile(
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
  ): ProjectileId {
    return this.spawnResolved(x, y, angle, ownerId, cfg, createLegacyProjectileProvenance(ownerId, cfg));
  }

  destroyProjectile(id: ProjectileId): void {
    const record = this.projectiles.getById(id);
    if (!record) return;
    const index = this.projectiles.indexOfStepEntry(record);
    if (index === -1) return;
    this.releaseProjectile(record);
    this.projectiles.dropStepEntryAt(index);
  }

  releaseProjectile(record: TrackedProjectile): void {
    this.removeCapabilityIds(record.id);
    this.projectiles.detach(record);
    this.simulation.releaseProjectileResources(record);
  }

  searchDetonableProjectiles(request: ProjectileDetonationSearchRequest): readonly ProjectileDetonationTarget[] {
    if (this.destroyed) return [];
    return this.simulation.externalInteraction?.searchDetonableProjectiles(this.detonableIds, request) ?? [];
  }

  detonateProjectile(
    projectileId: ProjectileId,
    detonatorOwnerId: string,
  ): ProjectileDetonationOutcome | null {
    if (this.destroyed || !this.detonableIds.has(projectileId)) return null;
    return this.simulation.externalInteraction?.detonateProjectile(projectileId, detonatorOwnerId) ?? null;
  }

  detonateOverlappingProjectiles(): readonly ProjectileDetonationOutcome[] {
    if (this.destroyed) return [];
    return this.simulation.externalInteraction?.detonateOverlappingProjectiles(
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

    const applied = this.simulation.applyProjectileBurnAugment?.(projectileId, augment) ?? false;
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

  hasActiveProjectileStyle(style: import('../types').ProjectileStyle): boolean {
    for (const record of this.projectiles.activeRecords) {
      if (record.projectileStyle === style && record.sprite.active) return true;
    }
    return false;
  }

  /**
   * Host Frame Port: der Owner taktet zuerst den Runtime-Core und reicht danach ausschließlich
   * dessen schmale Ergebnisse an die noch offene Legacy-Phase weiter.
   */
  runHostProjectileStage(deltaMs: number, nowMs: number): ProjectileHostStageResult {
    if (this.destroyed) return emptyHostStageResult();
    this.setHostFrameTime(nowMs);
    const coreStage = this.flightProcessor.run(this.projectiles.stepOrder, deltaMs, nowMs);
    return this.simulation.runLegacyProjectileStage?.(deltaMs, nowMs, coreStage)
      ?? {
        explodedProjectiles: [],
        explodedGrenades: [],
        countdownEvents: coreStage.countdownEvents,
      };
  }

  setProjectileTimeFieldPort(port: ProjectileTimeFieldPort | null): void {
    this.flightProcessor.setTimeFieldPort(port);
    this.simulation.setProjectileTimeFieldPort?.(port);
  }

  setProjectileTargetQueryPort(port: ProjectileTargetQueryPort | null): void {
    this.homingController.setTargetQueryPort(port);
  }

  setProjectileTargetabilityPort(port: ProjectileTargetabilityPort | null): void {
    this.targetabilityPort = port;
    this.homingController.setTargetabilityPort(port);
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

  setProjectileDirectImpactPort(port: ProjectileDirectImpactPort | null): void {
    this.directImpactPort = port;
  }

  /**
   * Host Frame: externe Barrieren, Projectile↔Projectile-Deflexion und Target-Kandidaten.
   *
   * Die Stage steht dort, wo die Interaktion fachlich hingehört – vor Flight/Expiry und nach den
   * Travel-/Environment-Schritten des Frames.
   */
  runHostInteractionStage(nowMs: number): void {
    if (this.destroyed) return;
    this.interactionNowMs = nowMs;
    this.setHostFrameTime(nowMs);
    this.runBarrierStage(nowMs);
    this.runDeflectionStage(nowMs);
    this.collisionProcessor.run(this.projectiles.activeRecords, nowMs, this.collisionDependencies);
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
        nowMs,
      });
      if (resolution.kind === 'passed') continue;
      this.applyBarrierResolution(record, resolution, nowMs);
    }
  }

  private applyBarrierResolution(
    record: TrackedProjectile,
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
      if (target.projectileStyle === 'leaf_blower') continue;
      // Geworfene Utilities fliegen weiter; nur echte Geschosse werden umgelenkt.
      if (target.isGrenade) continue;
      if (target.miniRocketDeferredExplosion || target.miniRocketSpent) continue;

      const targetBounds = target.sprite.getBounds();
      for (const deflectorId of this.deflectorIds) {
        const blower = this.projectiles.getById(deflectorId);
        if (!blower || blower.pendingDestroy || !this.projectiles.activeRecords.has(blower)) continue;
        const blowerOwnerId = blower.provenance.allegiance.ownerId;
        if (blowerOwnerId === target.provenance.allegiance.ownerId) continue;
        if (this.targetabilityPort && !this.targetabilityPort.canDamageOwner(
          target.provenance,
          blowerOwnerId,
          target.allowTeamDamage === true,
        )) continue;
        if (!boundsOverlap(targetBounds, blower.sprite.getBounds())) continue;

        this.deflectProjectile(target, blower, nowMs);
        break;
      }
    }
  }

  private deflectProjectile(target: TrackedProjectile, blower: TrackedProjectile, nowMs: number): void {
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
  }

  /** Target-lokale Defense: Absorption entfernt, Reflexion erzeugt den Nachfolger beim Owner. */
  private applyDefense(
    record: TrackedProjectile,
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
    record: TrackedProjectile,
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

  resolveProjectileHoming(request: ProjectileHomingRequest, simulatedAgeMs: number, forceSearch = false): boolean {
    return this.homingController.update(request, simulatedAgeMs, forceSearch);
  }

  setHostFrameTime(nowMs: number): void {
    this.simulation.setHostFrameTime?.(nowMs);
  }

  /** World-Teardown: kein Record, kein Identity-Eintrag und kein Restzustand überlebt ihn. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const record of this.projectiles.stepOrder) {
      this.projectiles.detach(record);
      this.simulation.releaseProjectileResources(record);
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
    this.simulation.releaseWorldProjectileState();
    this.simulation.bindProjectileOwner(null);
    this.onDestroy?.();
  }

  private spawnResolved(
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
    provenance: ProjectileProvenance,
  ): ProjectileId {
    const id = this.projectiles.allocateId();
    const record = this.simulation.createProjectile(id, x, y, angle, ownerId, cfg, this.hostNowMs(), provenance);
    this.projectiles.insert(record);
    if (record.detonable) this.detonableIds.add(id);
    if (record.detonator) this.detonatorIds.add(id);
    if (record.projectileStyle === 'translocator_puck') this.translocatorPuckIds.add(id);
    if (record.leafBlowerDeflectsProjectiles && record.projectileStyle === 'leaf_blower') this.deflectorIds.add(id);
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

function hasTravelEffect(record: TrackedProjectile): boolean {
  return record.canReceiveFireImbue === true
    || record.fireTrail !== undefined
    || record.awpCorridorHalfWidth !== undefined
    || record.awpCorridorDamage !== undefined
    || record.awpCorridorDotDurationMs !== undefined
    || record.awpCorridorDotTickIntervalMs !== undefined
    || record.awpCorridorKnockback !== undefined
    || record.awpCorridorKnockbackDurationMs !== undefined;
}

function createTravelPathEffect(record: TrackedProjectile): ProjectileTravelCapabilities['pathEffect'] {
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

function createLegacyProjectileProvenance(
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
  return { explodedProjectiles: [], explodedGrenades: [], countdownEvents: [] };
}
