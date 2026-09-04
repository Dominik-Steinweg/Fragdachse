import type { ProjectileSpawnConfig, TrackedProjectile } from '../types';
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
  ProjectileTargetabilityPort,
} from '../entities/ProjectileHomingController';
import type { ProjectileId, ProjectileSpawnPort, ProjectileSpawnResult } from './ProjectileSpawnPort';
import {
  createSingleOwnerProvenance,
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
import { ProjectileStore, type LegacyProjectileStoreAccess } from './ProjectileStore';

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
  private readonly simulation: LegacyProjectileHostSimulation;
  private readonly hostNowMs: () => number;
  private readonly onDestroy?: () => void;
  private destroyed = false;

  constructor(options: WorldProjectileRuntimeOptions) {
    this.simulation = options.simulation;
    this.hostNowMs = options.hostNowMs;
    this.onDestroy = options.onDestroy;
    this.projectiles = new ProjectileStore(options.identityScope);
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
    this.homingController.setTargetabilityPort(port);
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

function emptyHostStageResult(): ProjectileHostStageResult {
  return { explodedProjectiles: [], explodedGrenades: [], countdownEvents: [] };
}
