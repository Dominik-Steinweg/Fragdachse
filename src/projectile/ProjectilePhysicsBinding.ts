import * as Phaser from 'phaser';
import type { RockPhysicsProxy } from '../arena/rocks/RockPhysicsProxy';
import {
  DEPTH,
} from '../config';
import type { ProjectileRuntimeRecord, ProjectileSpawnConfig, ProjectileHomingConfig, ProjectileCollisionMode } from '../types';
import type {
  HomingLineOfFireChecker,
  HomingTargetProvider,
  HomingTargetValidityChecker,
  LineOfFireReadPort,
  ProjectileHomingRequest,
  ProjectileTargetQueryPort,
  ProjectileTargetabilityPort,
} from '../entities/ProjectileHomingController';
import { OBSTACLE_ROCK, type ArenaObstacleIndex } from '../systems/ArenaObstacleIndex';
import { CombatGeometry } from '../systems/CombatGeometry';
import {
  LEAF_BLOWER_OBSTACLE_BODY_SCALE,
  MIN_BODY_LEN,
  resolveProjectileBodyProfile,
  resolveSafeMuzzleSpawn,
} from '../systems/ProjectileSpawnResolver';
import { type GeometryHit, findNearestRectangleHit as geomNearestRectangleHit } from '../utils/geometry';
import { getMiniRocketCascadeMultiplier } from '../utils/miniRocketCascade';
import type {
  ProjectilePhysicsBindingPort,
  ProjectileHostStageResult,
  ProjectileRuntimeOwnerPort,
} from './WorldProjectileRuntime';
import type { ProjectilePhysicsContact, ProjectilePhysicsContactTarget } from './ProjectileTargetPort';
import {
  effectiveAirFrictionDecay,
  type ProjectileCoreStageResult,
} from './ProjectileFlightProcessor';
import type { ProjectileTimeFieldPort } from './ProjectileTimeFieldPort';
import {
  EMPTY_PROJECTILE_PRESENTATION,
  type ProjectilePresentationPort,
} from './ProjectilePresentationPort';
import type {
  ProjectileExternalInteractionAccess,
  ProjectileDetonationOutcome,
  ProjectileDetonationSearchRequest,
  ProjectileDetonationTarget,
} from './ProjectileExternalInteractionPort';
import type { ProjectileBurnAugment } from './ProjectileTravelPort';
import type {
  ProjectileFlameExpiryEvent,
  ProjectileImpactSource,
  ProjectileLifecycleOutcome,
  ProjectileMiniRocketDestroyedOutcome,
  ProjectileResolvedOutcome,
} from './ProjectileGameplayPort';
import { createSingleOwnerProvenance, type ProjectileProvenance } from './ProjectileSpawnRequest';
import type {
  ProjectileCombatTargetRef,
  ProjectileDirectImpactOutcome,
  ProjectilePlasmaSwarmImpact,
} from './ProjectileCombatPort';
import type {
  ProjectileExplosionRequest,
  ProjectileExplosionOutcome,
  ProjectileGrenadePayloadRequest,
} from './ProjectileExplosionPort';
import {
  PLASMA_SWARM_EXPLOSION_DURATION_MS,
  resolvePlasmaSwarmProjectileProfile,
  resolvePlasmaSwarmRadialAngles,
  resolvePlasmaSwarmHoming,
} from '../systems/PlasmaCharge';

const NO_PROJECTILE_RECORDS: readonly ProjectileRuntimeRecord[] = [];
const NO_ACTIVE_PROJECTILES: ReadonlySet<ProjectileRuntimeRecord> = new Set<ProjectileRuntimeRecord>();

/**
 * World-local Phaser binding for ProjectileRuntime.
 *
 * This class owns only physics handles, colliders and the small adapter callbacks needed by the
 * world runtime. Identity, active membership and authoritative lifecycle decisions remain in
 * `WorldProjectileRuntime`.
 */
export class ProjectilePhysicsBinding implements ProjectilePhysicsBindingPort {
  private scene:       Phaser.Scene;
  /**
   * §5.1-Seam auf die kanonische Registry der laufenden World.
   *
   * Der Owner bindet ihn beim World-Aufbau und löst ihn beim Teardown wieder; ohne World gibt es
   * keine Host-Projectiles zu verarbeiten. Es ist derselbe Store, keine Kopie.
   */
  private owner: ProjectileRuntimeOwnerPort | null = null;
  private readonly scratchPoints: Phaser.Math.Vector2[] = [];

  private timeBubbleFactorProvider: ((x: number, y: number, now: number, ownerId?: string) => number) | null = null;
  private timeFieldPort: ProjectileTimeFieldPort | null = null;
  private hostFrameNowMs: number | null = null;

  /** Semantische Brücke für den world-owned External-Interaction-Port. */
  readonly externalInteraction: ProjectileExternalInteractionAccess = {
    searchDetonableProjectiles: (detonableIds, request) => (
      this.searchDetonableProjectiles(detonableIds, request)
    ),
    detonateProjectile: (projectileId, detonatorOwnerId) => (
      this.detonateProjectile(projectileId, detonatorOwnerId)
    ),
    detonateOverlappingProjectiles: (detonatorIds, detonableIds) => (
      this.detonateOverlappingProjectiles(detonatorIds, detonableIds)
    ),
  };

  // ── Radialer Projektil-Puls (Host-only, injiziert von ArenaScene) ────────
  private proximityPulseCallback: ((proj: ProjectileImpactSource) => void) | null = null;
  private naturalFlameExpiryCallback: ((projectile: ProjectileFlameExpiryEvent) => void) | null = null;

  // ── Homing-Port-Kompatibilität (die Verarbeitung liegt im World-Owner) ───
  private homingTargetProvider: HomingTargetProvider | null = null;
  private homingLineOfFireChecker: HomingLineOfFireChecker | null = null;
  private homingTargetValidityChecker: HomingTargetValidityChecker | null = null;

  // ── Host: gepufferte Explosionen explosiver Projektile ──────────────────
  private pendingProjectileExplosions: ProjectileExplosionRequest[] = [];
  private projectileImpactCallback: ((proj: ProjectileImpactSource) => void) | null = null;
  private projectileResolvedCallback: ((outcome: ProjectileLifecycleOutcome) => void) | null = null;
  private miniRocketDestroyedCallback: ((source: ProjectileImpactSource) => void) | null = null;
  private standaloneExplosionRequestCallback: ((request: ProjectileExplosionRequest) => void) | null = null;

  // ── Obstacle-Gruppen (werden nach Arena-Aufbau injiziert) ─────────────────
  private rockGroup:   Phaser.Physics.Arcade.StaticGroup | null = null;
  private rockObjects: (RockPhysicsProxy | null)[] | null = null;
  private trunkGroup:  Phaser.Physics.Arcade.StaticGroup | null = null;
  /** Geteilte räumliche Vorauswahl aus dem `CombatSystem` (siehe `setObstacleIndex`). */
  private obstacleIndex: ArenaObstacleIndex | null = null;
  /** Gemeinsame Segmentgeometrie über demselben Index; kein eigener Spatial Index. */
  private obstacleGeometry: CombatGeometry | null = null;
  /** Ziel der Kandidaten-Bounds bzw. des bislang besten Treffers (keine Allokation pro Fels). */
  private readonly scratchObstacleRect = new Phaser.Geom.Rectangle();
  private readonly scratchLine = new Phaser.Geom.Line();
  private readonly bestRockRect        = new Phaser.Geom.Rectangle();
  private readonly scratchTrainBounds  = new Phaser.Geom.Rectangle();
  /**
   * Coop-Defense-Basis-Gruppe. Wird wie die Trunk-Gruppe
   * behandelt: physische Kollision/Impact; direkter Schaden wird über den
   * zentralen Basistreffer-Callback weitergeleitet.
   */
  private baseGroup:   Phaser.Physics.Arcade.StaticGroup | null = null;
  // ── Zug-Kollision ─────────────────────────────────────────────────────────
  private trainGroup:  Phaser.Physics.Arcade.StaticGroup | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly presentation: ProjectilePresentationPort = EMPTY_PROJECTILE_PRESENTATION,
  ) {
    this.scene = scene;
  }

  /** Der world-owned Owner bindet und löst diese Verarbeitung mit seiner eigenen Lifetime. */
  bindOwner(owner: ProjectileRuntimeOwnerPort | null): void {
    this.owner = owner;
    owner?.setProjectileTimeFieldPort?.(this.timeFieldPort);
    owner?.setProjectileTargetQueryPort?.(
      this.homingTargetProvider ? { queryTargets: this.homingTargetProvider } : null,
    );
    owner?.setLineOfFireReadPort?.(
      this.homingLineOfFireChecker
        ? { hasClearLineOfFire: this.homingLineOfFireChecker }
        : null,
    );
    if (this.hostFrameNowMs !== null) owner?.setHostFrameTime?.(this.hostFrameNowMs);
  }

  /** Host: Verarbeitungsreihenfolge der laufenden World; außerhalb einer World leer. */
  private get projectiles(): readonly ProjectileRuntimeRecord[] {
    return this.owner?.readProjectileStepOrder() ?? NO_PROJECTILE_RECORDS;
  }

  /** Host: wirksame Projectiles der laufenden World; außerhalb einer World leer. */
  private get activeProjectiles(): ReadonlySet<ProjectileRuntimeRecord> {
    return this.owner?.readActiveProjectileRecords() ?? NO_ACTIVE_PROJECTILES;
  }

  // ── Gruppen injizieren (nach buildDynamic) ─────────────────────────────────

  /**
   * Setzt die Kollisions-Gruppen für Felsen und Trunks.
   * Wird nach World-Aufbau aufgerufen; bei null (World-Teardown) alles leeren.
   */
  setRockGroup(
    group:      Phaser.Physics.Arcade.StaticGroup | null,
    objects:    (RockPhysicsProxy | null)[] | null,
    trunkGroup: Phaser.Physics.Arcade.StaticGroup | null,
  ): void {
    this.rockGroup   = group;
    this.rockObjects = objects;
    this.trunkGroup  = trunkGroup;
  }

  /**
   * Übernimmt den Hindernis-Index des `CombatSystem` für die kontinuierliche
   * Fels-Kollision. Ohne Index fällt die Prüfung auf den vollständigen Scan zurück.
   */
  setObstacleIndex(index: ArenaObstacleIndex | null): void {
    this.obstacleIndex = index;
    this.obstacleGeometry = index ? new CombatGeometry(index) : null;
  }

  /**
   * Setzt die Coop-Defense-Basis-Gruppe. Geschosse reagieren physisch (Impact, Explosion,
   * Bounce) wie bei Felsen; direkter Schaden entsteht ausschliesslich ueber
   * {@link setBaseHitCallback}, dessen Empfaenger die Fraktion prueft.
   */
  setBaseGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void {
    this.baseGroup = group;
  }

  /** Creates the narrow host-gameplay view used by callbacks leaving the simulation seam. */
  private createImpactSource(proj: ProjectileRuntimeRecord, x = proj.sprite?.x ?? 0, y = proj.sprite?.y ?? 0): ProjectileImpactSource {
    return {
      projectileId: proj.id,
      ownerId: proj.ownerId,
      provenance: proj.provenance,
      x,
      y,
      velocityX: proj.body?.velocity?.x ?? 0,
      velocityY: proj.body?.velocity?.y ?? 0,
      color: proj.color,
      ownerColor: proj.ownerColor,
      sourceId: proj.sourceId,
      sourceSlot: proj.sourceSlot,
      allowTeamDamage: proj.allowTeamDamage,
      damage: proj.damage,
      ak47DamageMultiplier: proj.ak47DamageMultiplier,
      baseDamageMult: proj.baseDamageMult,
      rockDamageMult: proj.rockDamageMult,
      trainDamageMult: proj.trainDamageMult,
      impactCloud: proj.impactCloud,
      energyInjectorPayload: proj.energyInjectorPayload,
      proximityPulse: proj.proximityPulse,
      isBfg: proj.isBfg,
      isFlame: proj.isFlame,
      hitboxSize: proj.hitboxSize,
      hitboxMaxSize: proj.hitboxMaxSize,
      bodyWidth: proj.body?.width ?? 0,
      projectileStyle: proj.projectileStyle,
      projectileBurnVisualStyle: proj.projectileBurnVisualStyle,
      shotAudioKey: proj.shotAudioKey,
      shotgunProximityMaxDamageBonus: proj.shotgunProximityMaxDamageBonus,
      shotgunOriginX: proj.shotgunOriginX,
      shotgunOriginY: proj.shotgunOriginY,
      shotgunResolvedRange: proj.shotgunResolvedRange,
    };
  }

  /**
   * Setzt die StaticGroup des Zugs für Projektil-Kollision (Host-only).
   * null = kein Zug aktiv (deaktiviert die Kollision).
   */
  setTrainGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void {
    this.trainGroup = group;
  }

  /** Liefert die bereits für Projektilpfade relevante, aktive Gesamtfläche des Zugs. */
  private getActiveTrainBounds(): Phaser.Geom.Rectangle | null {
    if (!this.trainGroup) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const child of this.trainGroup.getChildren()) {
      const segment = child as Phaser.GameObjects.Rectangle;
      if (!segment.active) continue;
      const body = segment.body as Phaser.Physics.Arcade.StaticBody | null;
      if (body && !body.enable) continue;

      const halfWidth = segment.displayWidth * 0.5;
      const halfHeight = segment.displayHeight * 0.5;
      minX = Math.min(minX, segment.x - halfWidth);
      maxX = Math.max(maxX, segment.x + halfWidth);
      minY = Math.min(minY, segment.y - halfHeight);
      maxY = Math.max(maxY, segment.y + halfHeight);
    }

    if (!Number.isFinite(minX)) return null;
    return this.scratchTrainBounds.setTo(minX, minY, maxX - minX, maxY - minY);
  }

  setNaturalFlameExpiryCallback(
    callback: ((projectile: ProjectileFlameExpiryEvent) => void) | null,
  ): void {
    this.naturalFlameExpiryCallback = callback;
  }

  setTimeBubbleFactorProvider(provider: ((x: number, y: number, now: number, ownerId?: string) => number) | null): void {
    this.timeBubbleFactorProvider = provider;
    this.timeFieldPort = provider
      ? {
        getMovementFactor: (x, y, nowMs, provenance) => provider(
          x,
          y,
          nowMs,
          provenance.allegiance.ownerId,
        ),
      }
      : null;
    this.owner?.setProjectileTimeFieldPort?.(this.timeFieldPort);
  }

  setProjectileTimeFieldPort(port: ProjectileTimeFieldPort | null): void {
    this.timeFieldPort = port;
  }

  setHostFrameTime(nowMs: number): void {
    this.hostFrameNowMs = nowMs;
  }

  /** Registriert den gemeinsamen radialen Projektil-Puls (Host-only). */
  setProximityPulseCallback(cb: ((proj: ProjectileImpactSource) => void) | null): void {
    this.proximityPulseCallback = cb;
  }

  setProjectileImpactCallback(cb: ((proj: ProjectileImpactSource) => void) | null): void {
    this.projectileImpactCallback = cb;
  }

  /**
   * Completes the owner-side lifecycle after Combat has accepted a semantic direct outcome.
   * Combat never receives this record or calls these owner lifecycle operations itself.
   */
  completeDirectImpact(
    projectileId: number,
    target: ProjectileCombatTargetRef,
    impact: { readonly x: number; readonly y: number },
    outcome: ProjectileDirectImpactOutcome,
  ): boolean {
    const projectile = this.getLiveRecordById(projectileId);
    if (!projectile) return false;
    if (!outcome.accepted || projectile.pendingDestroy) return false;
    if (projectile.impactCloud) this.emitProjectileImpact(projectile, impact.x, impact.y);

    const impactTargetKey = target.kind === 'player'
      ? `players:${target.id}`
      : target.kind === 'enemy'
        ? `enemies:${target.id}`
        : undefined;
    const queuedExplosion = projectile.enemyHitExplosion
      ? this.triggerEnemyImpactExplosion(projectile.id)
      : projectile.explosion
        ? this.triggerProjectileExplosion(projectile.id, impactTargetKey)
        : false;
    if (!queuedExplosion) this.queueDestroyProjectile(projectile);
    return !projectile.pendingDestroy;
  }

  completeProjectileExplosion(projectileId: number, damagedTargetKeys: ProjectileExplosionOutcome['damagedTargetKeys']): void {
    this.resumeMultiExplosionProjectile(projectileId, damagedTargetKeys);
  }

  /** Applies the semantic Plasma reaction through the normal world-owned spawn path. */
  applyPlasmaSwarmImpact(impact: ProjectilePlasmaSwarmImpact): void {
    this.standaloneExplosionRequestCallback?.({
      x: impact.x,
      y: impact.y,
      provenance: createSingleOwnerProvenance(impact.ownerId, {
        weaponSourceId: `${impact.sourceId}:swarm-explosion`,
        sourceSlot: impact.sourceSlot ?? 'weapon1',
        allowTeamDamage: impact.allowTeamDamage,
      }),
      effect: {
        radius: impact.explosionRadius,
        maxDamage: impact.explosionDamage,
        minDamage: impact.explosionDamage,
        knockback: 0,
        selfDamageMult: 0,
        damageTarget: 'enemies',
        enemySlowFraction: impact.explosionSlowFraction,
        enemySlowDurationMs: PLASMA_SWARM_EXPLOSION_DURATION_MS,
        baseDamageMult: 1,
        rockDamageMult: 1,
        trainDamageMult: 0,
        color: impact.color,
        visualStyle: 'energy',
      },
    });

    const profile = resolvePlasmaSwarmProjectileProfile({
      damage: impact.normalDamage,
      size: impact.normalSize,
      speed: impact.normalSpeed,
      range: impact.normalRange,
    });
    const speed = Math.max(1, profile.speed);
    const lifetime = Math.max(1, (profile.range / speed) * 1000);
    for (const angle of resolvePlasmaSwarmRadialAngles(impact.projectileCount)) {
      this.spawnProjectileConfig(impact.x, impact.y, angle, impact.ownerId, {
        speed,
        size: Math.max(1, profile.size),
        damage: profile.damage,
        color: impact.color,
        ownerColor: impact.ownerColor ?? impact.color,
        lifetime,
        remainingRangePx: profile.range,
        maxBounces: 0,
        isGrenade: false,
        adrenalinGain: 0,
        sourceId: 'weapon.plasma.swarm',
        homing: resolvePlasmaSwarmHoming(impact.homing),
        projectileStyle: impact.projectileStyle,
        energyBallVariant: impact.energyBallVariant,
        tracerConfig: impact.tracerConfig,
        allowTeamDamage: impact.allowTeamDamage,
        baseDamageMult: impact.baseDamageMult,
        suppressSpawnFx: true,
        plasmaSwarmProjectile: true,
        plasmaSwarmOriginEnemyId: impact.enemyId,
        sourceSlot: impact.sourceSlot ?? 'weapon1',
      });
    }
  }

  setProjectileResolvedCallback(cb: ((outcome: ProjectileLifecycleOutcome) => void) | null): void {
    this.projectileResolvedCallback = cb;
  }

  setMiniRocketDestroyedCallback(cb: ((source: ProjectileImpactSource) => void) | null): void {
    this.miniRocketDestroyedCallback = cb;
  }

  /** Sends standalone domain effects to the host resolver; they do not enter the projectile store. */
  setStandaloneExplosionRequestCallback(cb: ((request: ProjectileExplosionRequest) => void) | null): void {
    this.standaloneExplosionRequestCallback = cb;
  }

  /** Registriert die Host-seitige Zielquelle für Homing-Projektile. */
  setHomingTargetProvider(cb: HomingTargetProvider | null): void {
    this.homingTargetProvider = cb;
    this.owner?.setProjectileTargetQueryPort?.(cb ? { queryTargets: cb } : null);
  }

  /** Registriert die Host-seitige Line-of-Fire-Prüfung für Homing-Projektile. */
  setHomingLineOfFireChecker(cb: ((sx: number, sy: number, ex: number, ey: number) => boolean) | null): void {
    this.homingLineOfFireChecker = cb;
    this.owner?.setLineOfFireReadPort?.(cb ? { hasClearLineOfFire: cb } : null);
  }

  // ── Host ──────────────────────────────────────────────────────────────────

  /**
   * Spawnt ein Projektil mit der übergebenen Konfiguration.
   * Granaten (isGrenade=true) haben keine Welt-/Hindernis-Kollision
   * und explodieren nach fuseTime ms.
   */
  /**
   * Übergang aus den bestehenden authored Spawn-Payloads; Identity und Registry bleiben beim Owner.
   *
   * Identity, Registry und Lifetime gehören dem world-owned Owner; dieser Aufruf reicht den
   * Auftrag nur an ihn weiter. Ohne gebundene World entsteht kein Projectile.
   */
  spawnProjectileConfig(
    x:       number,
    y:       number,
    angle:   number,
    ownerId: string,
    cfg:     ProjectileSpawnConfig,
  ): number {
    return this.owner?.spawnProjectileConfig(x, y, angle, ownerId, cfg) ?? -1;
  }

  /**
   * Baut Physics-Handle, Collider, Spawn-Darstellung und Runtime-Record zu einer bereits vom
   * Owner vergebenen Identity. Die Aufnahme in die Registry macht der Owner.
   */
  createProjectile(
    id:      number,
    x:       number,
    y:       number,
    angle:   number,
    ownerId: string,
    cfg:     ProjectileSpawnConfig,
    hostNowMs: number,
    provenance: ProjectileProvenance,
  ): ProjectileRuntimeRecord {
    // Style-Flags, die im weiteren Spawn-Ablauf (Shape, Anti-Tunneling, Body-Größe) gebraucht werden.
    // Die renderer- und collider-spezifische Style-Auswertung passiert in den jeweiligen Helfern.
    const isBall   = cfg.projectileStyle === 'ball';
    const isEnergyBall = cfg.projectileStyle === 'energy_ball';
    const isHydra = cfg.projectileStyle === 'hydra';
    const isSpore = cfg.projectileStyle === 'spore';
    const bodyProfile = resolveProjectileBodyProfile(cfg, angle);
    const resolvedSpawn = cfg.gameplayMuzzleOrigin
      ? resolveSafeMuzzleSpawn(
        x,
        y,
        cfg.gameplayMuzzleOrigin,
        angle,
        cfg,
        {
          geometry: this.obstacleGeometry,
          trainBounds: this.getActiveTrainBounds(),
          worldBounds: this.scene.physics.world.bounds,
        },
        bodyProfile,
      )
      : { x, y };

    // Physik-Shape: für 'bullet'/'flame'/'awp' unsichtbar (nur Kollisions-Body)
    const sprite: Phaser.GameObjects.Shape = (isBall || isEnergyBall || isHydra || isSpore)
      ? this.scene.add.circle(resolvedSpawn.x, resolvedSpawn.y, cfg.size / 2, cfg.color)
      : this.scene.add.rectangle(resolvedSpawn.x, resolvedSpawn.y, cfg.size, cfg.size, cfg.color);
    sprite.setDepth(DEPTH.PROJECTILES);

    this.presentation.createSpawnRendererVisuals(id, sprite, resolvedSpawn.x, resolvedSpawn.y, cfg);
    this.presentation.registerFallbackShape(sprite);

    this.scene.physics.add.existing(sprite);

    const body = sprite.body as Phaser.Physics.Arcade.Body;

    body.setVelocity(
      Math.cos(angle) * cfg.speed,
      Math.sin(angle) * cfg.speed,
    );

    const spawnProvenance = provenance;
    const initialTimeBubbleFactor = this.timeBubbleFactorProvider?.(
      resolvedSpawn.x,
      resolvedSpawn.y,
      hostNowMs,
      ownerId,
    ) ?? this.timeFieldPort?.getMovementFactor(
      resolvedSpawn.x,
      resolvedSpawn.y,
      hostNowMs,
      spawnProvenance,
    ) ?? 1;
    if (initialTimeBubbleFactor < 0.999) {
      body.setVelocity(body.velocity.x * initialTimeBubbleFactor, body.velocity.y * initialTimeBubbleFactor);
    }

    // Body-Profil und Safe-Muzzle verwenden dieselben Maße, bevor der Body existiert.
    body.setSize(bodyProfile.width, bodyProfile.height);
    body.setOffset(bodyProfile.offsetX, bodyProfile.offsetY);

    const tracked: ProjectileRuntimeRecord = {
      id,
      sprite,
      body,
      lastX:          resolvedSpawn.x,
      lastY:          resolvedSpawn.y,
      bounceCount:    cfg.initialBounceCount ?? 0,
      createdAt:      hostNowMs,
      ownerId,
      provenance,
      collisionMode:  resolveProjectileCollisionMode(cfg),
      ignoreBaseCollisions: cfg.ignoreBaseCollisions,
      ignoreRockIndex: cfg.ignoreRockIndex,
      color:          cfg.color,
      allowTeamDamage: cfg.allowTeamDamage,
      ownerColor:     cfg.ownerColor,
      visualMuzzleOrigin: cfg.visualMuzzleOrigin,
      boundsListener: () => {},
      colliders:      [],
      damage:         cfg.damage,
      lifetime:       cfg.lifetime,
      maxBounces:     cfg.maxBounces,
      isGrenade:      cfg.isGrenade,
      isTranslocatorPuck: cfg.isTranslocatorPuck,
      adrenalinGain:  cfg.adrenalinGain,
      sourceId:     cfg.sourceId ?? 'weapon.unknown',
      plasmaSwarmEnabled: cfg.plasmaSwarmEnabled,
      plasmaSwarmProjectile: cfg.plasmaSwarmProjectile,
      plasmaSwarmOriginEnemyId: cfg.plasmaSwarmOriginEnemyId,
      plasmaSwarmProjectileCount: cfg.plasmaSwarmProjectileCount,
      plasmaSwarmExplosionRadius: cfg.plasmaSwarmExplosionRadius,
      plasmaSwarmExplosionDamage: cfg.plasmaSwarmExplosionDamage,
      plasmaSwarmExplosionSlowFraction: cfg.plasmaSwarmExplosionSlowFraction,
      explosion:      cfg.explosion,
      enemyHitExplosion: cfg.enemyHitExplosion,
      impactCloud:    cfg.impactCloud,
      sporeVisualVariant: cfg.sporeVisualVariant,
      homing:         cfg.homing,
      energyInjectorPayload: cfg.energyInjectorPayload,
      sourceTurretId: cfg.sourceTurretId,
      projectileVisualScale: cfg.projectileVisualScale,
      smokeTrailColor: cfg.smokeTrailColor,
      lockedTargetId: null,
      homingState: cfg.homing ? { lockedTargetId: null } : undefined,
      fuseTime:        cfg.fuseTime,
      grenadeEffect:   cfg.grenadeEffect,
      projectileStyle: cfg.projectileStyle,
      bulletVisualPreset: cfg.bulletVisualPreset,
      grenadeVisualPreset: cfg.grenadeVisualPreset,
      energyBallVariant: cfg.energyBallVariant,
      tracerConfig:    cfg.tracerConfig,
      detonable:       cfg.detonable,
      detonator:       cfg.detonator,
      rockDamageMult:  cfg.rockDamageMult,
      trainDamageMult: cfg.trainDamageMult,
      baseDamageMult:   cfg.baseDamageMult,
      sourceSlot:      cfg.sourceSlot,
      shotAudioKey:    cfg.shotAudioKey,
      splitCount:      cfg.splitCount,
      splitSpread:     cfg.splitSpread,
      splitFactor:     cfg.splitFactor,
      splitHoming:     cfg.splitHoming,
      remainingRangePx: cfg.remainingRangePx,
      suppressSpawnFx: cfg.suppressSpawnFx,
      penetrationRemaining: cfg.penetrationCount,
      penetrationDamageRetention: cfg.penetrationDamageRetention,
      penetrationHitIds: (cfg.penetrationCount ?? 0) > 0 ? new Set<string>() : undefined,
      piercesTargets:  cfg.piercesTargets,
      piercingHitIds: (cfg.isBfg || cfg.piercesTargets
        || ((cfg.proximityPulse?.radius ?? 0) > 0 && (cfg.proximityPulse?.damage ?? 0) > 0))
        ? new Set<string>() : undefined,
      penetratesRocks: cfg.penetratesRocks,
      penetratedRockIds: cfg.penetratesRocks ? new Set<number>() : undefined,
      reflected: cfg.reflected,
      gaussChainRadius: cfg.gaussChainRadius,
      gaussChainDamageFactor: cfg.gaussChainDamageFactor,
      multiExplosionsRemaining: Math.max(1, Math.floor(cfg.multiExplosionCount ?? 1)),
      multiExplosionExcludedTargetKeys: (cfg.multiExplosionCount ?? 1) > 1
        ? new Set<string>()
        : undefined,
      multiExplosionCoastMs: cfg.multiExplosionCoastMs,
      miniRocketStageRangePx: cfg.miniRocketStageRangePx,
      miniRocketPhase: cfg.miniRocketStageRangePx !== undefined ? 'attack' : undefined,
      miniRocketCoastUntilAgeMs: undefined,
      miniRocketNextExplosionAtAgeMs: undefined,
      miniRocketDeferredExplosion: false,
      miniRocketDeferredExplosionStopsAtObstacle: false,
      miniRocketSpent: false,
      miniRocketDestructionFxEmitted: false,
      miniRocketHasExploded: false,
      miniRocketReturnEnabled: cfg.miniRocketReturnEnabled,
      miniRocketReturnRangeBuffer: cfg.miniRocketReturnRangeBuffer,
      miniRocketReturnReserveGranted: false,
      miniRocketPickupRadius: cfg.miniRocketPickupRadius,
      miniRocketPickupAdrenalineRefundFraction: cfg.miniRocketPickupAdrenalineRefundFraction,
      miniRocketPickupArmor: cfg.miniRocketPickupArmor,
      miniRocketAdrenalineCostPaid: cfg.miniRocketAdrenalineCostPaid,
      miniRocketSafetyLifetimeMs: cfg.miniRocketSafetyLifetimeMs,
      miniRocketCascadeDamageBonusPerExplosion: cfg.miniRocketCascadeDamageBonusPerExplosion,
      miniRocketExplosionIndex: 0,
      ak47ShotId: cfg.ak47ShotId,
      ak47HitConfirmed: false,
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
      hitKnockback: cfg.hitKnockback,
      hitKnockbackDurationMs: cfg.hitKnockbackDurationMs,
      // Flammenwerfer-Felder
      isFlame:         cfg.isFlame,
      hitboxGrowRate:  cfg.hitboxGrowRate,
      hitboxMaxSize:   cfg.hitboxMaxSize,
      hitboxSize:      cfg.size,
      velocityDecay:   cfg.velocityDecay,
      burnDurationMs:    cfg.burnDurationMs,
      burnDamagePerTick: cfg.burnDamagePerTick,
      projectileBurnVisualStyle: cfg.projectileBurnVisualStyle,
      flamePierceHitIds: cfg.isFlame && cfg.flamePiercing ? new Set<string>() : undefined,
      hitObstacleIds: cfg.isFlame ? new Set<number>() : undefined,
      canReceiveFireImbue: cfg.canReceiveFireImbue,
      supplementalBurnOnHit: cfg.supplementalBurnOnHit,
      supplementalBurnProvenance: cfg.supplementalBurnProvenance,
      fireTrail: cfg.fireTrail,
      pathEffectKind: cfg.pathEffectKind,
      lastFireTrailCellKey: undefined,
      fireTrailHalfWidthCells: cfg.fireTrailHalfWidthCells,
      awpCorridorHalfWidth: cfg.awpCorridorHalfWidth,
      awpCorridorDamage: cfg.awpCorridorDamage,
      awpCorridorDotDurationMs: cfg.awpCorridorDotDurationMs,
      awpCorridorDotTickIntervalMs: cfg.awpCorridorDotTickIntervalMs,
      awpCorridorKnockback: cfg.awpCorridorKnockback,
      awpCorridorKnockbackDurationMs: cfg.awpCorridorKnockbackDurationMs,
      awpCorridorHitIds: cfg.awpCorridorHalfWidth !== undefined ? new Set<string>() : undefined,
      leafBlowerMinKnockback: cfg.leafBlowerMinKnockback,
      leafBlowerMaxKnockback: cfg.leafBlowerMaxKnockback,
      leafBlowerSelfPush: cfg.leafBlowerSelfPush,
      leafBlowerDeflectsProjectiles: cfg.leafBlowerDeflectsProjectiles,
      initialSpeed:    cfg.speed,
      // Granaten-Countdown
      lastCountdownEmitted: null,
      // BFG-Felder
      isBfg:            cfg.isBfg,
      proximityPulse: cfg.proximityPulse,
      // Die Pulsphase beginnt pro Projektil beim Spawn. Dadurch wartet der
      // erste Puls das konfigurierte Intervall ab, statt bei jedem neuen
      // Projektil sofort auf dem gemeinsamen Host-Frame auszulösen.
      lastProximityPulseAt: (cfg.proximityPulse?.radius ?? 0) > 0
        && (cfg.proximityPulse?.damage ?? 0) > 0 ? 0 : undefined,
      // Anti-Tunneling
      originalBodySize: cfg.size < MIN_BODY_LEN
        && cfg.isFlame !== true
        && !hasLeafBlowerCapability(cfg)
        && cfg.isBfg !== true
        && !hasGaussDischarge(cfg)
        && !cfg.isGrenade
        ? cfg.size : undefined,

      // Erweiterte Flugphysik
      frictionDelayMs: cfg.frictionDelayMs,
      airFrictionDecayPerSec: cfg.airFrictionDecayPerSec,
      bounceFrictionMultiplier: cfg.bounceFrictionMultiplier,
      stopSpeedThreshold: cfg.stopSpeedThreshold,
      frictionActivated: false,
      simulatedAgeMs: 0,
      appliedAirFrictionDecay: undefined,
      timeBubbleFactor: initialTimeBubbleFactor,
    };

    // Phaser-Damping für Air-Friction vorbereiten
    if (cfg.airFrictionDecayPerSec !== undefined) {
      body.useDamping = true;
      // Drag erst nach frictionDelayMs aktivieren; bis dahin kein Luftwiderstand (Faktor 1)
      if (!cfg.frictionDelayMs || cfg.frictionDelayMs <= 0) {
        const effectiveDecay = effectiveAirFrictionDecay(cfg.airFrictionDecayPerSec, initialTimeBubbleFactor);
        body.setDrag(effectiveDecay, effectiveDecay);
        tracked.frictionActivated = true;
        tracked.appliedAirFrictionDecay = effectiveDecay;
      } else {
        body.setDrag(1, 1);
      }
    }

    this.setupProjectileColliders(id, resolvedSpawn.x, resolvedSpawn.y, sprite, body, tracked, cfg);

    this.presentation.createSpawnFeedback(id, resolvedSpawn.x, resolvedSpawn.y, x, y, angle, ownerId, cfg);

    return tracked;
  }

  /** Placeable turret shots ignore only their own supporting runtime rock. */
  private canCollideWithRockIndex(tracked: ProjectileRuntimeRecord, rockIndex: number): boolean {
    return tracked.ignoreRockIndex === undefined || rockIndex !== tracked.ignoreRockIndex;
  }

  private canCollideWithRock(tracked: ProjectileRuntimeRecord, rockGO: Phaser.GameObjects.GameObject): boolean {
    const rockIndex = this.rockObjects?.indexOf(rockGO as RockPhysicsProxy) ?? -1;
    return this.canCollideWithRockIndex(tracked, rockIndex);
  }

  /** Reports only the technical contact; WorldProjectileRuntime owns the domain outcome. */
  private reportPhysicsContact(
    tracked: ProjectileRuntimeRecord,
    target: ProjectilePhysicsContactTarget,
    x = tracked.sprite.x,
    y = tracked.sprite.y,
    source: ProjectilePhysicsContact['source'] = 'physics-collider',
  ): boolean {
    return this.owner?.reportPhysicsContact({
      projectileId: tracked.id,
      target,
      x,
      y,
      velocityX: tracked.body.velocity.x,
      velocityY: tracked.body.velocity.y,
      source,
    }) ?? false;
  }

  private getBaseId(baseObject: Phaser.GameObjects.GameObject): string | null {
    const baseId = baseObject.getData('baseId') as string | undefined;
    return baseId ?? null;
  }

  /**
   * Richtet je nach Projektiltyp die Welt-Bounds-/Hindernis-Collider ein:
   * BFG/Gauss durchdringen (Overlap-Schaden), Impact-Cloud/Explosion zerstören bei Kontakt,
   * Flamme/Leaf-Blower stoppen, normale Projektile abprallen, Granaten ohne Bounce bleiben liegen.
   */
  private setupProjectileColliders(
    id: number,
    x: number,
    y: number,
    sprite: Phaser.GameObjects.Shape,
    body: Phaser.Physics.Arcade.Body,
    tracked: ProjectileRuntimeRecord,
    cfg: ProjectileSpawnConfig,
  ): void {
    const isBfg = cfg.isBfg === true;
    const isGauss = hasGaussDischarge(cfg)
      || (cfg.collisionMode === 'overlap' && cfg.piercesTargets === true && cfg.isBfg !== true
        && cfg.isFlame !== true && !hasLeafBlowerCapability(cfg));
    const isFlame = cfg.isFlame === true;
    const isLeafBlower = hasLeafBlowerCapability(cfg);

    if (isBfg || isGauss) {
      // BFG: Welt-Bounds zerstören das Projektil; Felsen/Zug werden per Overlap beschädigt,
      // das Projektil fliegt aber durch alles durch (kein physischer Stopp).
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      const bfgBoundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        this.reportPhysicsContact(tracked, { kind: 'world-boundary' }, body.x + body.halfWidth, body.y + body.halfHeight, 'world-boundary');
      };
      tracked.boundsListener = bfgBoundsListener;
      this.scene.physics.world.on('worldbounds', bfgBoundsListener);

      // Felsen: Overlap → beschädigt Fels, Projektil fliegt weiter
      if (this.rockGroup) {
        const rockObjects = this.rockObjects;
        const c = this.scene.physics.add.overlap(sprite, this.rockGroup, (_proj, rockGO) => {
          if (!rockObjects) return;
          if (isGauss && !tracked.gaussHitRocks) tracked.gaussHitRocks = new Set();
          if (!isGauss && !tracked.bfgHitRocks) tracked.bfgHitRocks = new Set();
          const idx = rockObjects.indexOf(rockGO as RockPhysicsProxy);
          const hitSet = isGauss ? tracked.gaussHitRocks : tracked.bfgHitRocks;
          if (idx !== -1 && hitSet && !hitSet.has(idx)) {
            hitSet.add(idx);
            this.reportPhysicsContact(tracked, { kind: 'rock', id: idx });
          }
        }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
        tracked.colliders.push(c);
      }

      // Zug: Overlap → beschädigt Zug, Projektil fliegt weiter
      if (this.trainGroup) {
        const c = this.scene.physics.add.overlap(sprite, this.trainGroup, () => {
          if (isGauss ? tracked.gaussHitTrain : tracked.bfgHitTrain) return;
          if (isGauss) tracked.gaussHitTrain = true;
          else tracked.bfgHitTrain = true;
          this.reportPhysicsContact(tracked, { kind: 'train', id: 'main' });
        });
        tracked.colliders.push(c);
      }
      // Trunks: kein Collider/Overlap – Projektil fliegt einfach durch

      // Host-Presentation erhält nur den passiven Spawn-Projection-Impuls.
      if (isBfg) this.presentation.createBfgVisual(id, x, y, cfg.size);
    } else if (cfg.impactCloud && cfg.maxBounces === 0) {
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      body.setBounce(0, 0);
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        this.reportPhysicsContact(tracked, { kind: 'world-boundary' }, body.x + body.halfWidth, body.y + body.halfHeight, 'world-boundary');
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      if (this.rockGroup) {
        const c = this.scene.physics.add.collider(sprite, this.rockGroup, (_proj, rockGO) => {
          const idx = this.rockObjects?.indexOf(rockGO as RockPhysicsProxy) ?? -1;
          if (idx >= 0) this.reportPhysicsContact(tracked, { kind: 'rock', id: idx });
        }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
        tracked.colliders.push(c);
      }
      if (this.trunkGroup) {
        const c = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
          this.reportPhysicsContact(tracked, { kind: 'trunk' });
        });
        tracked.colliders.push(c);
      }
      if (this.baseGroup && !tracked.ignoreBaseCollisions) {
        const c = this.scene.physics.add.collider(sprite, this.baseGroup, (_proj, baseGO) => {
          const baseId = this.getBaseId(baseGO as Phaser.GameObjects.GameObject);
          if (baseId) this.reportPhysicsContact(tracked, { kind: 'base', id: baseId });
        });
        tracked.colliders.push(c);
      }
      if (this.trainGroup) {
        const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
          this.reportPhysicsContact(tracked, { kind: 'train', id: 'main' });
        });
        tracked.colliders.push(c);
      }
    } else if (cfg.explosion && cfg.maxBounces === 0) {
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      body.setBounce(0, 0);
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        this.reportPhysicsContact(tracked, { kind: 'world-boundary' }, body.x + body.halfWidth, body.y + body.halfHeight, 'world-boundary');
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      if (this.rockGroup) {
        const c = this.scene.physics.add.collider(sprite, this.rockGroup, (_proj, rockGO) => {
          const idx = this.rockObjects?.indexOf(rockGO as RockPhysicsProxy) ?? -1;
          if (idx >= 0) this.reportPhysicsContact(tracked, { kind: 'rock', id: idx });
        }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
        tracked.colliders.push(c);
      }
      if (this.trunkGroup) {
        const c = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
          this.reportPhysicsContact(tracked, { kind: 'trunk' });
        });
        tracked.colliders.push(c);
      }
      if (this.baseGroup && !tracked.ignoreBaseCollisions) {
        // Explosionsprojektile richten ihren Basisschaden ueber die Explosion selbst an
        // (`applyExplosionDamage`); ein direkter Treffer wuerde ihn sonst doppelt zaehlen.
        const c = this.scene.physics.add.collider(sprite, this.baseGroup, (_proj, baseGO) => {
          const baseId = this.getBaseId(baseGO as Phaser.GameObjects.GameObject);
          if (baseId) this.reportPhysicsContact(tracked, { kind: 'base', id: baseId });
        });
        tracked.colliders.push(c);
      }
      if (this.trainGroup) {
        const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
          this.reportPhysicsContact(tracked, { kind: 'train', id: 'main' });
        });
        tracked.colliders.push(c);
      }
    } else if (isFlame) {
      // Flammen: kein Bounce, Arena-Bounds und Hindernisse stoppen die Hitbox;
      // sie verweilt dann für die restliche Lifetime an der Aufprallstelle.
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        this.reportPhysicsContact(tracked, { kind: 'world-boundary' }, body.x + body.halfWidth, body.y + body.halfHeight, 'world-boundary');
        // Flamme an Wand → anhalten (Lifetime bestimmt weiterlaufend die Lebensdauer)
        body.setVelocity(0, 0);
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      this.setupFlameColliders(sprite, body, tracked);
    } else if (isLeafBlower) {
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        this.reportPhysicsContact(tracked, { kind: 'world-boundary' }, body.x + body.halfWidth, body.y + body.halfHeight, 'world-boundary');
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      this.setupLeafBlowerColliders(sprite, body, tracked);
    } else if (!cfg.isGrenade || cfg.maxBounces > 0) {
      // Bounce-Physik: für normale Projektile immer; für Granaten nur wenn maxBounces > 0
      this.setupBouncePhysics(sprite, body, tracked);
    } else if (cfg.isGrenade && cfg.maxBounces === 0) {
      // Granate ohne Bounces (z.B. Heilige Handgranate): Wand-Kollision, aber kein Abprallen.
      // Bleibt an der Aufprallstelle liegen und explodiert nach fuseTime.
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      body.setBounce(0, 0);
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        body.setVelocity(0, 0);
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      // Fels-/Trunk-/Zug-Kollision: Granate bleibt stecken
      if (this.rockGroup) {
        const c = this.scene.physics.add.collider(sprite, this.rockGroup, (_proj, rockGO) => {
          body.setVelocity(0, 0);
          const idx = this.rockObjects?.indexOf(rockGO as RockPhysicsProxy) ?? -1;
          if (idx >= 0) this.reportPhysicsContact(tracked, { kind: 'rock', id: idx });
        }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
        tracked.colliders.push(c);
      }
      if (this.trunkGroup) {
        const c = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
          body.setVelocity(0, 0);
          this.reportPhysicsContact(tracked, { kind: 'trunk' });
        });
        tracked.colliders.push(c);
      }
      if (this.baseGroup && !tracked.ignoreBaseCollisions) {
        const c = this.scene.physics.add.collider(sprite, this.baseGroup, (_proj, baseGO) => {
          body.setVelocity(0, 0);
          const baseId = this.getBaseId(baseGO as Phaser.GameObjects.GameObject);
          if (baseId) this.reportPhysicsContact(tracked, { kind: 'base', id: baseId });
        });
        tracked.colliders.push(c);
      }
      if (this.trainGroup) {
        const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
          body.setVelocity(0, 0);
          this.reportPhysicsContact(tracked, { kind: 'train', id: 'main' });
        });
        tracked.colliders.push(c);
      }
    }
  }

  /**
   * Richtet Fels-/Trunk-/Basis-/Zug-Kollision für Flammen-Hitboxen ein.
   * Felsen, Trunks und Basen stoppen die Flamme physisch (collider, kein Bounce);
   * Basen erhalten dabei direkten Schaden, die Flamme verweilt dann für ihre restliche Lifetime
   * an der Aufprallstelle.
   * Der Zug zerstört die Flamme sofort und erhält Schaden.
   */
  private setupFlameColliders(
    sprite:  Phaser.GameObjects.Shape,
    body:    Phaser.Physics.Arcade.Body,
    tracked: ProjectileRuntimeRecord,
  ): void {
    // Kein Abprallen: Flamme bleibt an der Aufprallstelle stehen
    body.setBounce(0, 0);

    if (this.rockGroup) {
      // collider statt overlap: Phaser stoppt den Body physisch am Felsen. Der
      // Callback meldet den Treffer nur einmal pro Flamme; Lebensdauer und
      // Zerstörung der Flamme bleiben vom Hindernis unabhängig.
      const c = this.scene.physics.add.collider(sprite, this.rockGroup, (_proj, rockGO) => {
        if (tracked.pendingDestroy) return;
        const idx = this.rockObjects?.indexOf(rockGO as RockPhysicsProxy) ?? -1;
        if (idx < 0) return;
        this.reportPhysicsContact(tracked, { kind: 'rock', id: idx });
      }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
      tracked.colliders.push(c);
    }
    if (this.trunkGroup) {
      const c = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
        this.reportPhysicsContact(tracked, { kind: 'trunk' });
      });
      tracked.colliders.push(c);
    }
    if (this.baseGroup && !tracked.ignoreBaseCollisions) {
      const c = this.scene.physics.add.collider(sprite, this.baseGroup, (_proj, baseGO) => {
        const baseId = this.getBaseId(baseGO as Phaser.GameObjects.GameObject);
        if (baseId) this.reportPhysicsContact(tracked, { kind: 'base', id: baseId });
        // A base blocks the flame physically, but the flame remains alive until its lifetime ends.
        body.setVelocity(0, 0);
      });
      tracked.colliders.push(c);
    }
    if (this.trainGroup) {
      // Zug: Flamme verursacht genau einmal Schaden und verschwindet sofort.
      const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
        this.reportPhysicsContact(tracked, { kind: 'train', id: 'main' });
      });
      tracked.colliders.push(c);
    }
  }

  private setupLeafBlowerColliders(
    sprite:  Phaser.GameObjects.Shape,
    body:    Phaser.Physics.Arcade.Body,
    tracked: ProjectileRuntimeRecord,
  ): void {
    body.setBounce(0, 0);

    if (this.rockGroup) {
      const c = this.scene.physics.add.collider(sprite, this.rockGroup, (_proj, rockGO) => {
        const idx = this.rockObjects?.indexOf(rockGO as RockPhysicsProxy) ?? -1;
        if (idx >= 0) this.reportPhysicsContact(tracked, { kind: 'rock', id: idx });
      }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
      tracked.colliders.push(c);
    }
    if (this.trunkGroup) {
      const c = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
        this.reportPhysicsContact(tracked, { kind: 'trunk' });
      });
      tracked.colliders.push(c);
    }
    if (this.baseGroup && !tracked.ignoreBaseCollisions) {
      const c = this.scene.physics.add.collider(sprite, this.baseGroup, (_proj, baseGO) => {
        const baseId = this.getBaseId(baseGO as Phaser.GameObjects.GameObject);
        if (baseId) this.reportPhysicsContact(tracked, { kind: 'base', id: baseId });
      });
      tracked.colliders.push(c);
    }
    if (this.trainGroup) {
      const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
        this.reportPhysicsContact(tracked, { kind: 'train', id: 'main' });
      });
      tracked.colliders.push(c);
    }
  }

  /**
   * Richtet Welt- und Hindernis-Kollision mit physikalischem Abprallen ein.
   * Wird von normalen Projektilen und bouncenden Granaten (maxBounces > 0) genutzt.
   *
   * @param applyRockDamage – true für normale Projektile (Felstreffer-Schaden);
   *                          false für Granaten (kein Felstrefferschaden beim Abprallen)
   */
  private setupBouncePhysics(
    sprite:          Phaser.GameObjects.Shape,
    body:            Phaser.Physics.Arcade.Body,
    tracked:         ProjectileRuntimeRecord,
  ): void {
    body.setCollideWorldBounds(true);
    body.onWorldBounds = true;
    // Elastischer Bounce (Richtungsumkehr durch Phaser); Geschwindigkeitsreduktion
    // erfolgt manuell über applyBounceFriction, damit die GESAMTE Geschwindigkeit
    // (nicht nur die Normalkomponente) mit dem Multiplikator reduziert wird.
    body.setBounce(1, 1);

    // Hilfsfunktion: reduziert bei jedem Abprallen die Gesamtgeschwindigkeit
    const applyBounceFriction = () => {
      const mult = tracked.bounceFrictionMultiplier;
      if (mult !== undefined && mult < 1) {
        body.velocity.x *= mult;
        body.velocity.y *= mult;
      }
    };

    const playImpact = (bx: number, by: number, bvx: number, bvy: number, col: number) => {
      this.presentation.playBounceImpact(tracked.id, bx, by, bvx, bvy, col, tracked.projectileStyle);
    };

    const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
      if (hitBody !== body) return;
      applyBounceFriction();
      const impact = this.getProjectileBodyCenter(tracked);
      this.reportPhysicsContact(tracked, { kind: 'world-boundary' }, impact.x, impact.y, 'world-boundary');
      if (this.owner?.queueHydraSplit?.(tracked.id, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
      tracked.bounceCount++;
      // Funken an Arena-Wand: Velocity ist nach Bounce bereits reflektiert
      playImpact(
        body.x + body.halfWidth, body.y + body.halfHeight,
        body.velocity.x, body.velocity.y,
        tracked.color,
      );
      // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
      if (tracked.bounceCount > tracked.maxBounces) {
        body.setVelocity(0, 0);
        body.enable = false;
      }
    };
    tracked.boundsListener = boundsListener;
    this.scene.physics.world.on('worldbounds', boundsListener);

    if (this.rockGroup) {
      const rockObjects = this.rockObjects;
      if (tracked.penetratesRocks) {
        const rockOverlap = this.scene.physics.add.overlap(sprite, this.rockGroup, (_proj, rockGO) => {
          const idx = rockObjects?.indexOf(rockGO as RockPhysicsProxy) ?? -1;
          if (idx < 0 || tracked.penetratedRockIds?.has(idx)) return;
          tracked.penetratedRockIds?.add(idx);
          const impact = this.resolveObstacleImpactPoint(tracked, rockGO as Phaser.GameObjects.GameObject);
          this.reportPhysicsContact(tracked, { kind: 'rock', id: idx }, impact.x, impact.y);
          playImpact(impact.x, impact.y, body.velocity.x, body.velocity.y, tracked.color);
        }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
        tracked.colliders.push(rockOverlap);
      } else {
      const rockCollider = this.scene.physics.add.collider(sprite, this.rockGroup, (_proj, rockGO) => {
        const idx = rockObjects?.indexOf(rockGO as RockPhysicsProxy) ?? -1;
        if (tracked.bounceProcessedThisStep) {
          // Phasers zweite Velocity-Spiegelung rückgängig machen, damit keine Doppelumkehr entsteht
          if (tracked.velocityAfterFirstBounce) {
            body.velocity.x = tracked.velocityAfterFirstBounce.x;
            body.velocity.y = tracked.velocityAfterFirstBounce.y;
          }
          return;
        }
        tracked.bounceProcessedThisStep = true;
        applyBounceFriction();
        tracked.velocityAfterFirstBounce = { x: body.velocity.x, y: body.velocity.y };
        const impact = this.resolveObstacleImpactPoint(tracked, rockGO as Phaser.GameObjects.GameObject);
        // Funken bei Fels-Aufprall
        playImpact(
          body.x + body.halfWidth, body.y + body.halfHeight,
          body.velocity.x, body.velocity.y,
          tracked.color,
        );
        if (idx !== -1 && this.reportPhysicsContact(tracked, { kind: 'rock', id: idx }, impact.x, impact.y)) return;
        if (this.owner?.queueHydraSplit?.(tracked.id, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
        tracked.bounceCount++;
        // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
        if (tracked.bounceCount > tracked.maxBounces) {
          body.setVelocity(0, 0);
          body.enable = false;
        }
      }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
      tracked.colliders.push(rockCollider);
      }
    }

    if (this.trunkGroup) {
      const trunkCollider = this.scene.physics.add.collider(sprite, this.trunkGroup, (_proj, trunkGO) => {
        if (tracked.bounceProcessedThisStep) {
          if (tracked.velocityAfterFirstBounce) {
            body.velocity.x = tracked.velocityAfterFirstBounce.x;
            body.velocity.y = tracked.velocityAfterFirstBounce.y;
          }
          return;
        }
        tracked.bounceProcessedThisStep = true;
        applyBounceFriction();
        tracked.velocityAfterFirstBounce = { x: body.velocity.x, y: body.velocity.y };
        const impact = this.resolveObstacleImpactPoint(tracked, trunkGO as Phaser.GameObjects.GameObject);
        // Funken bei Baumstamm-Aufprall
        playImpact(
          body.x + body.halfWidth, body.y + body.halfHeight,
          body.velocity.x, body.velocity.y,
          tracked.color,
        );
        if (this.reportPhysicsContact(tracked, { kind: 'trunk' }, impact.x, impact.y)) return;
        if (this.owner?.queueHydraSplit?.(tracked.id, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
        tracked.bounceCount++;
        // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
        if (tracked.bounceCount > tracked.maxBounces) {
          body.setVelocity(0, 0);
          body.enable = false;
        }
      });
      tracked.colliders.push(trunkCollider);
    }

    if (this.baseGroup && !tracked.ignoreBaseCollisions) {
      const baseCollider = this.scene.physics.add.collider(sprite, this.baseGroup, (_proj, baseGO) => {
        if (tracked.bounceProcessedThisStep) {
          if (tracked.velocityAfterFirstBounce) {
            body.velocity.x = tracked.velocityAfterFirstBounce.x;
            body.velocity.y = tracked.velocityAfterFirstBounce.y;
          }
          return;
        }
        tracked.bounceProcessedThisStep = true;
        applyBounceFriction();
        tracked.velocityAfterFirstBounce = { x: body.velocity.x, y: body.velocity.y };
        const impact = this.resolveObstacleImpactPoint(tracked, baseGO as Phaser.GameObjects.GameObject);
        playImpact(
          body.x + body.halfWidth, body.y + body.halfHeight,
          body.velocity.x, body.velocity.y,
          tracked.color,
        );
        const baseId = this.getBaseId(baseGO as Phaser.GameObjects.GameObject);
        if (baseId && this.reportPhysicsContact(tracked, { kind: 'base', id: baseId }, impact.x, impact.y)) return;
        if (this.owner?.queueHydraSplit?.(tracked.id, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
        tracked.bounceCount++;
        if (tracked.bounceCount > tracked.maxBounces) {
          body.setVelocity(0, 0);
          body.enable = false;
        }
      });
      tracked.colliders.push(baseCollider);
    }

    if (this.trainGroup) {
      const trainCollider = this.scene.physics.add.collider(sprite, this.trainGroup, (_proj, trainGO) => {
        if (tracked.bounceProcessedThisStep) {
          if (tracked.velocityAfterFirstBounce) {
            body.velocity.x = tracked.velocityAfterFirstBounce.x;
            body.velocity.y = tracked.velocityAfterFirstBounce.y;
          }
          return;
        }
        tracked.bounceProcessedThisStep = true;
        const impact = this.resolveObstacleImpactPoint(tracked, trainGO as Phaser.GameObjects.GameObject);
        // Funken bei Zug-Aufprall
        playImpact(
          body.x + body.halfWidth, body.y + body.halfHeight,
          body.velocity.x, body.velocity.y,
          tracked.color,
        );
        applyBounceFriction();
        tracked.velocityAfterFirstBounce = { x: body.velocity.x, y: body.velocity.y };
        if (this.reportPhysicsContact(tracked, { kind: 'train', id: 'main' }, impact.x, impact.y)) return;
        if (this.owner?.queueHydraSplit?.(tracked.id, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
        tracked.bounceCount++;
        // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
        if (tracked.bounceCount > tracked.maxBounces) {
          body.setVelocity(0, 0);
          body.enable = false;
        }
      });
      tracked.colliders.push(trainCollider);
    }
  }

  private shouldUseContinuousRockCollision(proj: ProjectileRuntimeRecord): boolean {
    return proj.collisionMode === 'sweep'
      && !proj.isGrenade
      && !proj.isFlame
      && !proj.isBfg
      && !proj.pendingDestroy
      && !proj.bounceProcessedThisStep
      && !proj.penetratesRocks
      && !!this.rockObjects;
  }

  private resolveContinuousRockCollision(proj: ProjectileRuntimeRecord): void {
    if (!this.rockObjects) return;

    const line = new Phaser.Geom.Line(proj.lastX, proj.lastY, proj.sprite.x, proj.sprite.y);
    const segmentLength = Phaser.Geom.Line.Length(line);
    if (segmentLength <= 0.5) return;

    // Als Objekt statt als lokale Variablen: der Besucher unten ist eine Closure, und
    // TypeScript verfolgt Zuweisungen aus einer Closure heraus nicht für die Narrowing-
    // Analyse – über Objektfelder bleiben die Typen nach der Abfrage erhalten.
    const best: {
      rockIndex: number;
      hit: GeometryHit | null;
    } = { rockIndex: -1, hit: null };

    const scanRock = (rockIndex: number, left: number, top: number, right: number, bottom: number): void => {
      if (!this.canCollideWithRockIndex(proj, rockIndex)) return;
      const rect = this.scratchObstacleRect.setTo(left, top, right - left, bottom - top);
      const hit = this.findNearestRectangleHit(line, rect);
      if (!hit) return;
      if (!best.hit || hit.distance < best.hit.distance) {
        best.hit = hit;
        best.rockIndex = rockIndex;
        // Das Scratch-Rechteck wird beim nächsten Kandidaten überschrieben, der
        // Aufprallwinkel braucht die Kanten aber noch – deshalb eine eigene Kopie.
        this.bestRockRect.setTo(left, top, right - left, bottom - top);
      }
    };

    if (this.obstacleIndex) {
      this.obstacleIndex.querySegment(
        line.x1, line.y1, line.x2, line.y2,
        (kind, rockIndex, left, top, right, bottom) => {
          if (kind === OBSTACLE_ROCK) scanRock(rockIndex, left, top, right, bottom);
          return false;
        },
        () => false,
      );
    } else {
      for (let i = 0; i < this.rockObjects.length; i++) {
        if (!this.canCollideWithRockIndex(proj, i)) continue;
        const rock = this.rockObjects[i];
        if (!rock?.active) continue;
        const bounds = rock.getBounds();
        scanRock(i, bounds.left, bounds.top, bounds.right, bounds.bottom);
      }
    }

    const bestHit = best.hit;
    const bestRockIndex = best.rockIndex;
    if (!bestHit || bestRockIndex < 0) return;
    const bestRect = this.bestRockRect;

    let nextVx = proj.body.velocity.x;
    let nextVy = proj.body.velocity.y;
    const normal = this.getRectangleImpactNormal(bestRect, bestHit.x, bestHit.y);

    if (Math.abs(normal.x) > 0.001) nextVx *= -1;
    if (Math.abs(normal.y) > 0.001) nextVy *= -1;

    const frictionMultiplier = proj.bounceFrictionMultiplier;
    if (frictionMultiplier !== undefined && frictionMultiplier < 1) {
      nextVx *= frictionMultiplier;
      nextVy *= frictionMultiplier;
    }

    proj.bounceCount++;

    if (this.reportPhysicsContact(proj, { kind: 'rock', id: bestRockIndex }, bestHit.x, bestHit.y)) return;

    this.presentation.playBounceImpact(proj.id, bestHit.x, bestHit.y, nextVx, nextVy, proj.color, proj.projectileStyle);

    if (proj.bounceCount > proj.maxBounces) {
      proj.body.reset(bestHit.x, bestHit.y);
      proj.body.setVelocity(0, 0);
      proj.body.enable = false;
      return;
    }

    const normalLength = Math.hypot(normal.x, normal.y) || 1;
    const offsetDistance = Math.max(proj.sprite.displayWidth * 0.5 + 0.5, 1);
    const resolvedX = bestHit.x + (normal.x / normalLength) * offsetDistance;
    const resolvedY = bestHit.y + (normal.y / normalLength) * offsetDistance;

    proj.body.reset(resolvedX, resolvedY);
    proj.body.setVelocity(nextVx, nextVy);
  }

  private getRectangleImpactNormal(
    rect: Phaser.Geom.Rectangle,
    x: number,
    y: number,
  ): { x: number; y: number } {
    const distances = [
      { axis: 'left', value: Math.abs(x - rect.left) },
      { axis: 'right', value: Math.abs(x - rect.right) },
      { axis: 'top', value: Math.abs(y - rect.top) },
      { axis: 'bottom', value: Math.abs(y - rect.bottom) },
    ] as const;

    const minDistance = Math.min(...distances.map((entry) => entry.value));
    const epsilon = 0.75;
    let nx = 0;
    let ny = 0;

    for (const entry of distances) {
      if (entry.value > minDistance + epsilon) continue;
      switch (entry.axis) {
        case 'left':
          nx -= 1;
          break;
        case 'right':
          nx += 1;
          break;
        case 'top':
          ny -= 1;
          break;
        case 'bottom':
          ny += 1;
          break;
      }
    }

    if (nx === 0 && ny === 0) {
      nx = projFallbackSign(x - rect.centerX);
      ny = projFallbackSign(y - rect.centerY);
    }

    return { x: nx, y: ny };
  }

  private findNearestRectangleHit(
    line: Phaser.Geom.Line,
    rect: Phaser.Geom.Rectangle,
  ): GeometryHit | null {
    return geomNearestRectangleHit(line, rect, this.scratchPoints);
  }

  private getProjectileBodyCenter(proj: ProjectileRuntimeRecord): { x: number; y: number } {
    return {
      x: proj.body.x + proj.body.halfWidth,
      y: proj.body.y + proj.body.halfHeight,
    };
  }

  private resolveObstacleImpactPoint(
    proj: ProjectileRuntimeRecord,
    obstacle?: Phaser.GameObjects.GameObject | null,
  ): { x: number; y: number } {
    const fallback = this.getProjectileBodyCenter(proj);
    if (!obstacle || !('getBounds' in obstacle) || typeof obstacle.getBounds !== 'function') {
      return fallback;
    }

    const line = new Phaser.Geom.Line(proj.lastX, proj.lastY, proj.sprite.x, proj.sprite.y);
    const hit = this.findNearestRectangleHit(line, obstacle.getBounds());
    return hit ? { x: hit.x, y: hit.y } : fallback;
  }

  /**
   * Markiert ein Projektil zur sofortigen Entfernung aus Host-Logik und Phaser-Kollision.
   * Das eigentliche Cleanup erfolgt gesammelt im nächsten hostUpdate().
   */
  private queueDestroyProjectile(proj: ProjectileRuntimeRecord): void {
    if (proj.pendingDestroy) return;
    proj.pendingDestroy = true;
    proj.body.setVelocity(0, 0);
    proj.body.enable = false;
    this.removeActiveProjectile(proj);
  }

  /** Beendet Identity und Aktivmenge über den Owner und gibt danach die Ressourcen frei. */
  private destroyProjectileRuntimeRecord(proj: ProjectileRuntimeRecord): void {
    if (this.owner) {
      this.owner.releaseProjectile(proj);
      return;
    }
    this.releaseProjectileResources(proj);
  }

  /**
   * Gibt Physics-, Collider- und Darstellungsressourcen eines vom Owner entfernten Records frei.
   * Registry und Identity sind zu diesem Zeitpunkt bereits beendet.
   */
  releaseProjectileResources(proj: ProjectileRuntimeRecord): void {
    proj.hitObstacleIds?.clear();
    proj.hitBaseIds?.clear();
    const lifecycle: ProjectileLifecycleOutcome = proj.miniRocketSpent
      ? ({ kind: 'mini-rocket-destroyed', projectileId: proj.id } satisfies ProjectileMiniRocketDestroyedOutcome)
      : ({
        kind: 'resolved',
        projectileId: proj.id,
        provenance: proj.provenance,
        ...(proj.ak47ShotId === undefined ? {} : {
          reaction: {
            ak47: {
              shotId: proj.ak47ShotId,
              fireSuperiorityShot: proj.ak47FireSuperiorityShot === true,
              hitConfirmed: proj.ak47HitConfirmed === true,
            },
          },
        }),
      } satisfies ProjectileResolvedOutcome);
    this.projectileResolvedCallback?.(lifecycle);
    this.scene.physics.world.off('worldbounds', proj.boundsListener);
    for (const c of proj.colliders) c.destroy();
    this.presentation.destroyProjectileVisuals({
      id: proj.id,
      ownerId: proj.ownerId,
      x: proj.sprite.x,
      y: proj.sprite.y,
      vx: proj.body.velocity.x,
      vy: proj.body.velocity.y,
      size: proj.sprite.displayWidth,
      color: proj.color,
      style: proj.projectileStyle,
      energyBallVariant: proj.energyBallVariant,
      sporeVisualVariant: proj.sporeVisualVariant,
      pendingHydraSplit: proj.pendingHydraSplit,
      destroyX: proj.pendingHydraSplit?.x ?? proj.sprite.x,
      destroyY: proj.pendingHydraSplit?.y ?? proj.sprite.y,
      destroyScale: proj.sprite.displayWidth / 16,
    });
    proj.sprite.destroy();
  }

  private removeActiveProjectile(proj: ProjectileRuntimeRecord): void {
    this.owner?.deactivateProjectileRecord(proj);
  }

  private queueProjectileExplosion(
    proj: ProjectileRuntimeRecord,
    allowMultiContinue = false,
    stopMultiContinuationAtObstacle = false,
  ): void {
    if (proj.pendingExplosion) return;
    if (!proj.explosion) {
      if (proj.miniRocketSpent) this.queueSpentMiniRocketDestruction(proj);
      return;
    }
    const simulatedAge = proj.simulatedAgeMs ?? 0;
    const nextExplosionAt = proj.miniRocketNextExplosionAtAgeMs ?? 0;
    if (proj.miniRocketStageRangePx !== undefined && simulatedAge < nextExplosionAt) {
      const velocityLength = proj.body.velocity.length();
      if (velocityLength > 0.001) {
        proj.miniRocketContinuationVx = proj.body.velocity.x;
        proj.miniRocketContinuationVy = proj.body.velocity.y;
      }
      proj.miniRocketDeferredExplosion = true;
      proj.miniRocketDeferredExplosionStopsAtObstacle =
        (proj.miniRocketDeferredExplosionStopsAtObstacle ?? false) || stopMultiContinuationAtObstacle;
      proj.body.setVelocity(0, 0);
      proj.body.enable = false;
      return;
    }
    proj.miniRocketDeferredExplosion = false;
    const stopsAtObstacle = (proj.miniRocketDeferredExplosionStopsAtObstacle ?? false)
      || stopMultiContinuationAtObstacle;
    proj.miniRocketDeferredExplosionStopsAtObstacle = false;
    const remaining = Math.max(1, proj.multiExplosionsRemaining ?? 1);
    const explosionIndex = Math.max(0, proj.miniRocketExplosionIndex ?? 0);
    const cascadeMultiplier = getMiniRocketCascadeMultiplier(
      explosionIndex,
      proj.miniRocketCascadeDamageBonusPerExplosion ?? 0,
    );
    const cascadeColor = proj.explosion.color === undefined
      ? undefined
      : this.resolveMiniRocketCascadeColor(proj.explosion.color, explosionIndex);
    const resolvedEffect = cascadeMultiplier > 1.0001
      ? {
          ...proj.explosion,
          radius: proj.explosion.radius * cascadeMultiplier,
          maxDamage: proj.explosion.maxDamage * cascadeMultiplier,
          minDamage: proj.explosion.minDamage === undefined
            ? undefined
            : proj.explosion.minDamage * cascadeMultiplier,
          color: cascadeColor,
          visualStyle: proj.explosion.visualStyle === 'mini_rocket'
            ? 'mini_rocket_cascade' as const
            : proj.explosion.visualStyle,
        }
      : proj.explosion;
    if (proj.miniRocketStageRangePx !== undefined) {
      proj.miniRocketExplosionIndex = explosionIndex + 1;
    }
    const isExtendedMiniRocket = proj.miniRocketStageRangePx !== undefined;
    const continuesChainAfterExplosion = !stopsAtObstacle
      && (allowMultiContinue || isExtendedMiniRocket)
      && remaining > 1;
    const returnsSpentAfterExplosion = isExtendedMiniRocket
      && proj.miniRocketReturnEnabled === true
      && !continuesChainAfterExplosion;
    const resumesAfterExplosion = continuesChainAfterExplosion || returnsSpentAfterExplosion;
    if (resumesAfterExplosion && isExtendedMiniRocket) {
      const velocityLength = proj.body.velocity.length();
      if (velocityLength > 0.001) {
        proj.miniRocketContinuationVx = proj.body.velocity.x;
        proj.miniRocketContinuationVy = proj.body.velocity.y;
      } else {
        const dx = proj.sprite.x - proj.lastX;
        const dy = proj.sprite.y - proj.lastY;
        const distance = Math.hypot(dx, dy);
        const fallbackSpeed = Math.max(1, (proj.initialSpeed ?? 1) * (proj.timeBubbleFactor ?? 1));
        if (distance > 0.001) {
          proj.miniRocketContinuationVx = (dx / distance) * fallbackSpeed;
          proj.miniRocketContinuationVy = (dy / distance) * fallbackSpeed;
        }
      }
    }
    proj.multiExplosionsRemaining = returnsSpentAfterExplosion ? 0 : remaining - 1;
    proj.miniRocketSpent = returnsSpentAfterExplosion;
    proj.pendingExplosion = true;
    this.pendingProjectileExplosions.push(this.createExplosionRequest(proj, resolvedEffect, resumesAfterExplosion));
    if (resumesAfterExplosion) {
      proj.body.setVelocity(0, 0);
      proj.body.enable = false;
    } else {
      this.queueDestroyProjectile(proj);
    }
  }

  private emitProjectileImpact(proj: ProjectileRuntimeRecord, x: number, y: number): void {
    this.projectileImpactCallback?.(this.createImpactSource(proj, x, y));
  }

  private createExplosionRequest(
    proj: ProjectileRuntimeRecord,
    effect: ProjectileRuntimeRecord['explosion'] = proj.explosion,
    continuesAfterExplosion = false,
  ): ProjectileExplosionRequest {
    if (!effect) throw new Error(`[ProjectilePhysicsBinding] explosion request without effect for ${proj.id}`);
    const excludedTargetKey = proj.multiExplosionExcludedTargetKeys?.values().next().value as string | undefined;
    return {
      x: proj.sprite.x,
      y: proj.sprite.y,
      projectileId: proj.id,
      provenance: proj.provenance,
      effect,
      continuation: continuesAfterExplosion
        ? { projectileId: proj.id, excludedTargetKey }
        : undefined,
    };
  }

  /** Applies a travel-acquired burn to the canonical record; callers never receive that record. */
  applyProjectileBurnAugment(id: number, augment: ProjectileBurnAugment): boolean {
      const projectile = this.getLiveRecordById(id);
    if (!projectile?.canReceiveFireImbue || projectile.isGrenade || projectile.isFlame) return false;
    if (projectile.supplementalBurnOnHit
      && augment.burn.damagePerTick <= projectile.supplementalBurnOnHit.damagePerTick) return false;
    projectile.supplementalBurnOnHit = { ...augment.burn };
    projectile.supplementalBurnProvenance = augment.provenance;
    return true;
  }

  private searchDetonableProjectiles(
    detonableIds: ReadonlySet<number>,
    request: ProjectileDetonationSearchRequest,
  ): readonly ProjectileDetonationTarget[] {
    this.scratchLine.setTo(request.startX, request.startY, request.endX, request.endY);
    const targets: ProjectileDetonationTarget[] = [];
    for (const projectileId of detonableIds) {
      const projectile = this.getLiveRecordById(projectileId);
      if (!projectile?.detonable) continue;
      if (!request.detonator.triggerTags.includes(projectile.detonable.tag)) continue;
      if (!projectile.detonable.allowCrossTeam && projectile.ownerId !== request.shooterId) continue;
      if (!Phaser.Geom.Intersects.LineToRectangle(this.scratchLine, projectile.sprite.getBounds())) continue;
      targets.push(createDetonationTarget(projectile));
    }
    return targets;
  }

  private detonateProjectile(
    projectileId: number,
    detonatorOwnerId: string,
  ): ProjectileDetonationOutcome | null {
    const projectile = this.getLiveRecordById(projectileId);
    if (!projectile?.detonable) return null;
    const target = createDetonationTarget(projectile);
    this.destroyProjectile(projectileId);
    return { ...target, detonatorOwnerId };
  }

  private detonateOverlappingProjectiles(
    detonatorIds: ReadonlySet<number>,
    detonableIds: ReadonlySet<number>,
  ): readonly ProjectileDetonationOutcome[] {
    const outcomes: ProjectileDetonationOutcome[] = [];
    const destroyedIds = new Set<number>();
    const active = this.activeProjectiles;
    for (const detonator of active) {
      if (!detonatorIds.has(detonator.id) || destroyedIds.has(detonator.id)) continue;
      for (const target of active) {
        if (!detonableIds.has(target.id) || destroyedIds.has(target.id)) continue;
        if (detonator.id === target.id || !target.detonable) continue;
        if (!detonator.detonator?.triggerTags.includes(target.detonable.tag)) continue;
        if (!target.detonable.allowCrossTeam && target.ownerId !== detonator.ownerId) continue;
        if (!Phaser.Geom.Intersects.RectangleToRectangle(
          detonator.sprite.getBounds(),
          target.sprite.getBounds(),
        )) continue;

        destroyedIds.add(target.id);
        const detonation = this.detonateProjectile(target.id, detonator.ownerId);
        if (detonation) outcomes.push(detonation);
      }
    }
    return outcomes;
  }

  private getLiveRecordById(id: number): ProjectileRuntimeRecord | undefined {
    const projectile = this.owner?.readProjectileRecord(id);
    if (!projectile || projectile.pendingDestroy || !this.owner?.readActiveProjectileRecords().has(projectile)) return undefined;
    return projectile;
  }

  /**
   * §5.1-Seam: einzelnes Projektil sofort zerstören (z.B. nach Spielertreffer).
   *
   * Die Entfernung selbst verantwortet der world-owned Owner; unbekannte Ids sind wirkungslos.
   */
  destroyProjectile(id: number): void {
    this.owner?.destroyProjectile(id);
  }

  triggerProjectileExplosion(id: number, impactTargetKey?: string): boolean {
    const proj = this.getLiveRecordById(id);
    if (!proj?.explosion) return false;
    // Nur das Ziel, das die aktuelle Explosion ausgeloest hat, wird waehrend der
    // anschliessenden Geradeausphase ignoriert. Andere Ziele und alle Phaser-
    // Hinderniscollider bleiben aktiv. Nach der Coast-Phase darf dasselbe Ziel
    // wieder gewaehlt und getroffen werden.
    proj.multiExplosionExcludedTargetKeys?.clear();
    if (impactTargetKey) proj.multiExplosionExcludedTargetKeys?.add(impactTargetKey);
    this.queueProjectileExplosion(proj, true);
    return true;
  }

  resumeMultiExplosionProjectile(id: number, excludedTargetKeys: readonly string[]): void {
    void excludedTargetKeys;
    this.owner?.resumeMiniRocketExplosion?.(id);
  }

  /**
   * Löst die "nur bei Gegner-Treffern"-Explosion eines Projektils aus (z.B. XXX-BOW
   * Explosivbolzen). Nutzt denselben Explosions-Pfad wie reguläre Projektil-Explosionen.
   */
  triggerEnemyImpactExplosion(id: number): boolean {
    const proj = this.getLiveRecordById(id);
    if (!proj?.enemyHitExplosion || proj.pendingExplosion) return false;
    proj.pendingExplosion = true;
    this.pendingProjectileExplosions.push({
      x: proj.sprite.x,
      y: proj.sprite.y,
      projectileId: proj.id,
      provenance: proj.provenance,
      effect: proj.enemyHitExplosion,
    });
    this.queueDestroyProjectile(proj);
    return true;
  }

  /**
   * Räumt beim World-Teardown den binding-eigenen Rest ab. Records, Identity, Snapshot und
   * Presentation werden von der World-Runtime in derselben Phase freigegeben.
   */
  releaseWorldState(): void {
    this.pendingProjectileExplosions = [];
  }

  /**
   * Host: Abgelaufene/explodierte Projektile entfernen, aktuelle Positionen zurückgeben.
   * Granaten die ihre fuseTime erreicht haben werden als typisierte Payload-Requests zurückgegeben.
   */
  hostUpdate(deltaMs = 16.67, nowMs?: number): ProjectileHostStageResult {
    const now = nowMs ?? this.resolveBindingHostNow(deltaMs);
    this.setHostFrameTime(now);
    return this.owner?.runHostProjectileStage?.(deltaMs, now) ?? {
      projectileExplosions: [],
      grenadePayloads: [],
      countdownEvents: [],
    };
  }

  /** Executes the binding remainder after the World-owned Flight/Lifetime core. */
  runProjectileEffectsStage(
    _deltaMs: number,
    nowMs: number,
    coreStage: ProjectileCoreStageResult,
  ): ProjectileHostStageResult {
    this.setHostFrameTime(nowMs);
    const projectileExplosions = this.pendingProjectileExplosions.splice(0);
    const grenadePayloads: ProjectileGrenadePayloadRequest[] = [];
    const countdownEvents = coreStage.countdownEvents;
    for (const projectile of this.projectiles) {
      if ((projectile.isFlame || hasLeafBlowerCapability(projectile))
        && projectile.hitboxSize !== undefined
        && Math.abs(projectile.sprite.displayWidth - projectile.hitboxSize) > 0.0001) {
        projectile.sprite.setDisplaySize(projectile.hitboxSize, projectile.hitboxSize);
      }
    }
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      if (!this.stepProjectileEffects(this.projectiles[index], coreStage, projectileExplosions, grenadePayloads)) {
        this.owner?.dropProjectileStepEntryAt(index);
      }
    }
    return { projectileExplosions, grenadePayloads, countdownEvents };
  }

  /**
   * Pro-Projektil-Schritt der nachgelagerten Physics-/Effect-Stufe: Kollision, Wirkung und
   * Spezialausgänge. Flight, Lifetime und Homing werden zuvor vom World-Owner verarbeitet.
   */
  private stepProjectileEffects(
    proj: ProjectileRuntimeRecord,
    coreStage: ProjectileCoreStageResult,
    projectileExplosions: ProjectileExplosionRequest[],
    grenadePayloads: ProjectileGrenadePayloadRequest[],
  ): boolean {
    if (proj.pendingDestroy) {
      this.destroyProjectileRuntimeRecord(proj);
      return false;
    }

    if (proj.isGrenade) {
      if (coreStage.grenadeExpiredIds.has(proj.id) && proj.grenadeEffect) {
        grenadePayloads.push({
          x: proj.sprite.x,
          y: proj.sprite.y,
          projectileId: proj.id,
          provenance: proj.provenance,
          effect: proj.grenadeEffect,
        });
        this.destroyProjectileRuntimeRecord(proj);
        return false;
      }
      proj.bounceProcessedThisStep = false;
      proj.velocityAfterFirstBounce = undefined;
      return true;
    }

    const awaitingContinuation = proj.pendingExplosion
      && (proj.multiExplosionsRemaining ?? 0) > 0;
    if (awaitingContinuation) {
      proj.lastX = proj.sprite.x;
      proj.lastY = proj.sprite.y;
      return true;
    }

    if (proj.miniRocketDeferredExplosion) {
      if ((proj.simulatedAgeMs ?? 0) >= (proj.miniRocketNextExplosionAtAgeMs ?? 0)) {
        this.queueProjectileExplosion(
          proj,
          true,
          proj.miniRocketDeferredExplosionStopsAtObstacle ?? false,
        );
      }
      proj.lastX = proj.sprite.x;
      proj.lastY = proj.sprite.y;
      return true;
    }

    if (coreStage.miniRocketSafetyExpiredIds.has(proj.id)) {
      this.destroyProjectileRuntimeRecord(proj);
      return false;
    }

    if (coreStage.lifetimeExpiredIds.has(proj.id) && proj.explosion) {
      projectileExplosions.push(this.createExplosionRequest(proj));
      this.destroyProjectileRuntimeRecord(proj);
      return false;
    }

    if (coreStage.lifetimeExpiredIds.has(proj.id) && proj.impactCloud) {
      this.emitProjectileImpact(proj, proj.sprite.x, proj.sprite.y);
      this.destroyProjectileRuntimeRecord(proj);
      return false;
    }

    if (this.shouldUseContinuousRockCollision(proj)) {
      this.resolveContinuousRockCollision(proj);
      if (proj.pendingDestroy) {
        this.destroyProjectileRuntimeRecord(proj);
        return false;
      }
    }

    if (coreStage.rangeDepletedIds.has(proj.id)
      && proj.miniRocketStageRangePx !== undefined
      && proj.explosion) {
      this.queueProjectileExplosion(proj, true);
      return true;
    }

    const dead = !awaitingContinuation
      && (coreStage.lifetimeExpiredIds.has(proj.id)
        || coreStage.rangeDepletedIds.has(proj.id)
        || coreStage.bounceLimitReachedIds.has(proj.id));
    if (dead) {
      if (proj.isFlame && coreStage.lifetimeExpiredIds.has(proj.id)) {
        this.naturalFlameExpiryCallback?.(this.createImpactSource(proj) as ProjectileFlameExpiryEvent);
      }
      if (proj.miniRocketSpent && coreStage.rangeDepletedIds.has(proj.id)) {
        this.emitSpentMiniRocketDestruction(proj);
      }
      this.destroyProjectileRuntimeRecord(proj);
    } else if (proj.homing && proj.miniRocketStageRangePx === undefined) {
      const simulatedAge = proj.simulatedAgeMs ?? 0;
      this.owner?.resolveProjectileHoming?.(this.createHomingRequest(proj), simulatedAge);
    }

    const proximityPulse = proj.proximityPulse;
    if (proximityPulse && proximityPulse.radius > 0 && proximityPulse.damage > 0) {
      const interval = Math.max(50, proximityPulse.scanIntervalMs);
      const simulatedAge = proj.simulatedAgeMs ?? 0;
      if (proj.lastProximityPulseAt === undefined || simulatedAge - proj.lastProximityPulseAt >= interval) {
        proj.lastProximityPulseAt = simulatedAge;
        this.proximityPulseCallback?.(this.createImpactSource(proj));
      }
    }

    proj.lastX = proj.sprite.x;
    proj.lastY = proj.sprite.y;
    proj.bounceProcessedThisStep = false;
    proj.velocityAfterFirstBounce = undefined;
    return !dead;
  }

  private createHomingRequest(proj: ProjectileRuntimeRecord): ProjectileHomingRequest {
    if (proj.homingRequest) return proj.homingRequest;
    const state = proj.homingState ??= {
      lockedTargetId: proj.lockedTargetId ?? null,
      lockedTargetType: proj.lockedTargetType,
      lastSearchAtSimulatedMs: proj.lastHomingSearchAt,
    };
    const request: ProjectileHomingRequest = {
      ownerId: proj.ownerId,
      homing: proj.homing!,
      kinematics: {
        get x() { return proj.sprite.x; },
        get y() { return proj.sprite.y; },
        get velocityX() { return proj.body.velocity.x; },
        get velocityY() { return proj.body.velocity.y; },
        setVelocity: (x, y) => proj.body.setVelocity(x, y),
      },
      state,
      excludedTargetKeys: proj.multiExplosionExcludedTargetKeys,
    };
    proj.homingRequest = request;
    return request;
  }

  private resolveBindingHostNow(deltaMs: number): number {
    if (this.hostFrameNowMs !== null) return this.hostFrameNowMs + Math.max(0, deltaMs);
    let latestCreatedAt = 0;
    for (const projectile of this.projectiles) latestCreatedAt = Math.max(latestCreatedAt, projectile.createdAt);
    return latestCreatedAt + Math.max(0, deltaMs);
  }

  private resolveMiniRocketCascadeColor(baseColor: number, explosionIndex: number): number {
    // Index 0 ist die urspruengliche Detonation. Die beiden anschliessenden
    // Kaskaden werden zunehmend rot, bleiben aber klar in derselben Palette.
    const redBlend = explosionIndex <= 0 ? 0 : explosionIndex === 1 ? 0.28 : 0.68;
    if (redBlend <= 0) return baseColor;
    return this.mixHexColor(baseColor, 0xff2418, redBlend);
  }

  private mixHexColor(source: number, target: number, amount: number): number {
    const t = Phaser.Math.Clamp(amount, 0, 1);
    const sourceR = (source >> 16) & 0xff;
    const sourceG = (source >> 8) & 0xff;
    const sourceB = source & 0xff;
    const targetR = (target >> 16) & 0xff;
    const targetG = (target >> 8) & 0xff;
    const targetB = target & 0xff;
    return Phaser.Display.Color.GetColor(
      Math.round(Phaser.Math.Linear(sourceR, targetR, t)),
      Math.round(Phaser.Math.Linear(sourceG, targetG, t)),
      Math.round(Phaser.Math.Linear(sourceB, targetB, t)),
    );
  }

  private emitSpentMiniRocketDestruction(proj: ProjectileRuntimeRecord): void {
    if (proj.miniRocketDestructionFxEmitted) return;
    proj.miniRocketDestructionFxEmitted = true;
    this.miniRocketDestroyedCallback?.(this.createImpactSource(proj));
  }

  private queueSpentMiniRocketDestruction(proj: ProjectileRuntimeRecord): void {
    if (proj.pendingDestroy) return;
    this.emitSpentMiniRocketDestruction(proj);
    this.queueDestroyProjectile(proj);
  }

}

function resolveProjectileCollisionMode(cfg: ProjectileSpawnConfig): ProjectileCollisionMode {
  if (cfg.collisionMode) return cfg.collisionMode;
  if (cfg.isGrenade) return 'physics';
  if (cfg.isFlame === true || hasLeafBlowerCapability(cfg) || cfg.isBfg === true) return 'overlap';
  if ((cfg.proximityPulse?.radius ?? 0) > 0 && (cfg.proximityPulse?.damage ?? 0) > 0) return 'overlap';
  if (hasGaussDischarge(cfg)) return 'overlap';
  return 'sweep';
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

function projFallbackSign(value: number): number {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}
