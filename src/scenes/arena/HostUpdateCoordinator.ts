import * as Phaser from 'phaser';
import { bridge }           from '../../network/bridge';
import { EMPTY_FULL_PROJECTILE_SNAPSHOT } from '../../network/projectileSnapshotCodec';
import {
  ENEMY_FLOW_FIELD_IDS,
  type FlowFieldCoordinator,
} from '../../systems/flowfield/FlowFieldCoordinator';
import { goalCellsToIndexes } from '../../systems/flowfield/FlowFieldSources';
import { NET_TICK_INTERVAL_MS, COLORS, DASH_T2_S, CELL_SIZE } from '../../config';
import { getUtilityConfigForMode, UTILITY_CONFIGS, WEAPON_CONFIGS }          from '../../loadout/LoadoutConfig';
import { COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT, getCoopDefenseConstructionDefinition, getToolCapacityCost, resolveConstructionCapacity } from '../../config/coopDefenseConstructions';
import { getActiveConstructionToolRefs, getConstructionAccessContext } from '../../systems/ConstructionAccessResolver';
import { COOP_DEFENSE_AFFIX_RULES } from '../../config/coopDefenseItems';
import type { AirstrikeUltimateConfig, PlaceableTurretUtilityConfig } from '../../loadout/LoadoutConfig';
import { buildLocalArenaHudData } from '../../ui/LocalArenaHudData';
import { bfgFlightRumble } from '../../effects/camera/cameraFeedbackPresets';
import { isVelocityMoving }  from '../../loadout/SpreadMath';
import { dequantizeAngle }   from '../../utils/angle';
import { computeProjectileExplosionDamage, computeRadialDamage, resolveProjectileExplosionFalloff } from '../../utils/radialDamage';
import { PICKUP_RADIUS, NUKE_CONFIG } from '../../powerups/PowerUpConfig';
import { CAPTURE_THE_BEER_MODE, isCoopDefenseMode, isTeamGameMode } from '../../gameModes';
import { getCoopDefenseMapConfig, isWeaponBalanceLabMapId } from '../../config/coopDefenseMaps';
import { buildCountdownGroundFirePreview } from '../../effects/CountdownGroundFirePreview';
import type { ArenaContext }      from './ArenaContext';
import type { LocalPlayerState }  from './LocalPlayerState';
import type { RockVisualHelper }  from './RockVisualHelper';
import type { RendererBundle }    from './RendererBundle';
import type { PlayerEntity }      from '../../entities/PlayerEntity';
import type { HitscanSupportEffect, LoadoutSlot, PlayerAimNetState, PlayerNetState, RadialDamageFalloffConfig, SupportProjectileImpact, SyncedActiveHudBuff, SyncedReinforcementMatrix, TeamId, TrackedProjectile } from '../../types';
import type { BaseManager } from '../../entities/BaseManager';
import type { AutomatedTurret, AutomatedTurretId } from '../../systems/TurretSystem';
import { emitArenaMapGridChanged } from './ArenaEvents';
import { hasCoopDefenseEnemyKind } from '../../config/coopDefenseEnemies';
import { BlackHoleSystem } from '../../systems/BlackHoleSystem';
import type { TargetFootprint } from '../../systems/ReinforcementMatrixSystem';
import type { HitscanSupportImpact } from '../../systems/CombatSystem';
import { EnemyDashVisualTracker } from '../../effects/EnemyDashVisuals';
import type { EnemyAiTargetCandidate } from '../../systems/EnemyAiTargetCatalog';
import { applyRadialEnvironmentDamage, type EnvironmentRockSink } from '../../systems/EnvironmentDamageResolver';
import { resolveDetonations, type DetonationEffectSink } from '../../systems/DetonationResolver';
import { COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID } from '../../systems/CoopDefenseAirstrikeEventHandler';
import type { RockPhysicsProxy } from '../../arena/rocks/RockPhysicsProxy';
import { toMapId } from '../../world/arenaDescriptorAdapter';
import type { PlayerCapabilities } from '../../world/PlayerCapabilities';

/**
 * Suchradius fuer den Basisturm hinter einem Basistreffer. Der Collider meldet nur die
 * getroffene Basiszelle, der Turm sitzt aber leicht versetzt darauf.
 */
const SUPPORT_BASE_TURRET_SEARCH_RADIUS = 64;
/** Toleranz fuer Streiftreffer an der Nachbarzelle eines platzierten Turms. */
const SUPPORT_TURRET_GRAZE_RADIUS = 24;
/** Sichtbare Groesse des Regenerationsstosses; bewusst klein gehalten. */
const SUPPORT_REGENERATION_EFFECT_RADIUS = 30;

export interface HostUpdatePerformanceMetrics {
  totalMs: number;
  enemyAiMs: number;
  /**
   * Unterposten von `enemyAiMs`: Aktivierung und Ziel-Sampling der Flowfields im Main Thread.
   * Die eigentliche Berechnung laeuft im Worker und taucht hier bewusst nicht auf - genau daran
   * laesst sich die Verlagerung im Trace ablesen.
   */
  navFlowFieldMs: number;
  /** Im Worker gemessene Rechenzeit des zuletzt eingegangenen Ergebnisses. */
  navWorkerComputeMs: number;
  playerSystemsMs: number;
  physicsMs: number;
  combatProjectilesMs: number;
  explosionsMs: number;
  areaEffectsMs: number;
  worldVisualsMs: number;
  hudMs: number;
  effectFlushMs: number;
  snapshotBuildMs: number;
  networkTick: boolean;
  explosionEventCount: number;
}

function emptyHostUpdatePerformanceMetrics(): HostUpdatePerformanceMetrics {
  return {
    totalMs: 0,
    enemyAiMs: 0,
    navFlowFieldMs: 0,
    navWorkerComputeMs: 0,
    playerSystemsMs: 0,
    physicsMs: 0,
    combatProjectilesMs: 0,
    explosionsMs: 0,
    areaEffectsMs: 0,
    worldVisualsMs: 0,
    hudMs: 0,
    effectFlushMs: 0,
    snapshotBuildMs: 0,
    networkTick: false,
    explosionEventCount: 0,
  };
}

/**
 * Runs every frame on the host.
 *
 * Owns the 20 Hz network-tick accumulator, leaderboard caching,
 * and all host-side simulation: physics, combat, projectiles, AoE,
 * area-effects, turrets, train, armageddon meteors, and state publishing.
 */
export class HostUpdateCoordinator {
  private active = true;
  private netTickAccumulator = 0;
  private leaderboardSignature = '';
  private cachedLeaderboardEntries: { name: string; colorHex: number; frags: number; ping: number; teamId: TeamId | null; teamScore?: number; sharedXp?: number }[] = [];
  private readonly dashPhase2StartTimes = new Map<string, number>();
  private readonly prevDashPhases       = new Map<string, number>();
  private readonly dashTrailTimers      = new Map<string, number>();
  private readonly prevBurrowPhases     = new Map<string, import('../../types').BurrowPhase>();
  private readonly burrowLoopHandles    = new Map<string, string>();
  private readonly prevStealthStates    = new Map<string, boolean>();
  private readonly prevAliveStates      = new Map<string, boolean>();
  private readonly heldActionUtilityIds = new Map<string, string | null>();
  private moveLoopHandle: string | null = null;
  private classicTrainSpawned = false;
  private lastEncounterPresentationSignature: string | null = null;
  private lastMapEventPresentationState: ReturnType<NonNullable<ArenaContext['coopDefenseMapEventDirector']>['getPresentationState']> | null | undefined;
  private lastSecondaryObjectivePresentationSignature: string | null = null;
  private readonly blackHoleSystem: BlackHoleSystem;
  private readonly enemyDashVisuals: EnemyDashVisualTracker;
  private lastPerformance = emptyHostUpdatePerformanceMetrics();
  private performanceMetricsEnabled = false;
  private coarsePerformanceMetricsEnabled = false;
  private playerCapabilitiesResolver: ((playerId: string) => PlayerCapabilities) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
    private readonly renderers: RendererBundle,
    private readonly localPlayerState: LocalPlayerState,
    private readonly rockVisualHelper: RockVisualHelper,
  ) {
    this.blackHoleSystem = new BlackHoleSystem(
      () => this.ctx.enemyManager,
      this.ctx.hostPhysics,
    );
    this.enemyDashVisuals = new EnemyDashVisualTracker(
      this.scene,
      this.ctx.effectSystem,
      this.ctx.gameAudioSystem,
      false,
    );
  }

  setActive(v: boolean): void { this.active = v; }

  setPlayerCapabilitiesResolver(resolver: (playerId: string) => PlayerCapabilities): void {
    this.playerCapabilitiesResolver = resolver;
  }

  /**
   * Ob dieser Peer die World lokal darstellt.
   *
   * Die autoritative Simulation haengt nicht davon ab: ein Host kann eine Shared World
   * fuehren, waehrend er selbst in der Lobby steht. Dann laeuft derselbe Tick ohne jede
   * Renderer-, HUD-, Effekt- und Audioausgabe - Darstellung ist Ausgabe, nie Voraussetzung.
   */
  private presentationActive = true;

  setPresentationActive(active: boolean): void { this.presentationActive = active; }

  /** Renderer nur, solange dieser Peer die World darstellt. */
  private get visuals(): RendererBundle | null {
    return this.presentationActive ? this.renderers : null;
  }

  /** Effekt- und Audioausgabe folgen derselben Entscheidung. */
  private get effects(): ArenaContext['effectSystem'] | null {
    return this.presentationActive ? this.ctx.effectSystem : null;
  }

  private get audio(): ArenaContext['gameAudioSystem'] | null {
    return this.presentationActive ? this.ctx.gameAudioSystem : null;
  }

  setPerformanceMetricsEnabled(enabled: boolean): void {
    if (this.coarsePerformanceMetricsEnabled === enabled) return;
    this.coarsePerformanceMetricsEnabled = enabled;
    // Companion diagnostics keep only the complete host step and existing worker counters.
    // Fine phase timing remains intentionally disabled so the diagnostics path does not add a
    // performance.now() pair around every simulation subsystem.
    this.performanceMetricsEnabled = false;
    if (!enabled) this.lastPerformance = emptyHostUpdatePerformanceMetrics();
  }

  setClassicTrainSpawned(v: boolean): void { this.classicTrainSpawned = v; }
  getClassicTrainSpawned(): boolean { return this.classicTrainSpawned; }

  resetPerRound(): void {
    this.active = true;
    this.netTickAccumulator = 0;
    this.leaderboardSignature = '';
    this.cachedLeaderboardEntries = [];
    this.dashPhase2StartTimes.clear();
    this.prevDashPhases.clear();
    this.dashTrailTimers.clear();
    this.prevBurrowPhases.clear();
    for (const h of this.burrowLoopHandles.values()) this.audio?.stopLoop(h);
    this.burrowLoopHandles.clear();
    this.prevStealthStates.clear();
    this.prevAliveStates.clear();
    this.heldActionUtilityIds.clear();
    if (this.moveLoopHandle) { this.audio?.stopLoop(this.moveLoopHandle); this.moveLoopHandle = null; }
    this.classicTrainSpawned = false;
    this.lastEncounterPresentationSignature = null;
    this.lastMapEventPresentationState = undefined;
    this.lastSecondaryObjectivePresentationSignature = null;
    this.blackHoleSystem.clear();
    this.enemyDashVisuals.reset();
    this.lastPerformance = emptyHostUpdatePerformanceMetrics();
  }

  /**
   * Bereitet die teuren, startkritischen Host-Caches im verborgenen Arena-Zustand vor.
   * Dieser Pfad darf keine Runde simulieren: Er baut nur die Hindernis- und Ziel-Indices aus
   * dem bereits initial gespawnten Zustand auf, damit der erste Gameplay-Frame nicht lazy
   * nachrechnen muss.
   */
  prepareStartupCaches(now: number): void {
    if (!bridge.isHost()) return;
    this.ctx.combatSystem.getObstacleIndex().prepare();
    this.updateEnemyFlowFields(now, 0, true);
  }

  runHostUpdate(delta: number): void {
    if (!this.active) {
      this.lastPerformance = emptyHostUpdatePerformanceMetrics();
      return;
    }
    // Loading is still inert. During the synchronized countdown we run this coordinator only to
    // publish/render presentation state; every authoritative system below keeps its own gameplay
    // gate via countdownActive.
    const countdownActive = bridge.isArenaCountdownActive();
    const worldMapId = this.ctx.world ? toMapId(this.ctx.world.descriptor.definitionId) : null;
    const activeMapConfig = worldMapId === null ? null : getCoopDefenseMapConfig(worldMapId);
    const weaponBalanceLabActive = worldMapId !== null && isWeaponBalanceLabMapId(worldMapId);
    // Activity-Systeme werden durch die Activity aktiviert und gruppiert – nicht durch
    // verstreute Nullable-Abfragen. Diese eine Entscheidung traegt beide Activity-Phasen.
    const coopMission = bridge.getActivityDescriptor()?.kind === 'coop-mission';
    if (!this.ctx.world) {
      this.lastPerformance = emptyHostUpdatePerformanceMetrics();
      return;
    }
    const startedAt = this.coarsePerformanceMetricsEnabled ? performance.now() : 0;
    const metrics = this.performanceMetricsEnabled ? emptyHostUpdatePerformanceMetrics() : null;
    const now = Date.now();
    let phaseStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;

    const heldActions = this.ctx.hostHeldActionSystem;
    heldActions?.clearExpired(now);
    if (countdownActive) {
      heldActions?.reset();
    } else if (heldActions) {
      for (const player of this.ctx.playerManager.getAllPlayers()) {
        const utilityId = this.ctx.loadoutManager?.getEquippedUtilityConfig(player.id)?.id ?? null;
        if (this.heldActionUtilityIds.has(player.id)
          && this.heldActionUtilityIds.get(player.id) !== utilityId) {
          heldActions.clearPlayer(player.id);
        }
        this.heldActionUtilityIds.set(player.id, utilityId);
        if (!(this.playerCapabilitiesResolver?.(player.id).canInteract ?? bridge.canPlayerAct(player.id))
          || !this.ctx.combatSystem.isAlive(player.id)
          || this.ctx.burrowSystem?.isBurrowed(player.id)
          || this.ctx.burrowSystem?.isStunned(player.id)) {
          heldActions.clearPlayer(player.id);
        }
      }
    }

    // Activity: Missionsfortschritt, Ziele und der daraus folgende Druck.
    if (coopMission) this.runCoopMissionProgressPhase(delta, now, countdownActive, weaponBalanceLabActive);
    if (!countdownActive) this.ctx.decoySystem.hostUpdateLifecycle(now);
    const navStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    this.updateEnemyFlowFields(now, delta);
    if (metrics) {
      metrics.navFlowFieldMs = performance.now() - navStartedAt;
      metrics.navWorkerComputeMs = this.ctx.flowFieldCoordinator?.getDiagnostics().lastWorkerComputeMs ?? 0;
    }
    // Activity: Gegner-Navigation, Bewegung und Kampf.
    if (coopMission) this.runCoopMissionCombatPhase(delta, now, countdownActive, weaponBalanceLabActive);
    if (metrics) metrics.enemyAiMs = performance.now() - phaseStartedAt;

    phaseStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    if (!countdownActive && this.ctx.coopDefenseItemRuntimeSystem) {
      const runtime = this.ctx.coopDefenseItemRuntimeSystem;
      runtime.hostUpdate(now);
      // Beide Positions-Affixe werden aus echter Distanz gespeist. Teleports werden im
      // Runtime-System ueber die gemeinsame Schrittgrenze verworfen.
      const players = this.ctx.playerManager.getAllPlayers();
      runtime.updateSurroundedPlayers(
        players,
        this.ctx.enemyManager,
        (playerId) => this.ctx.combatSystem.isAlive(playerId),
        (enemyId) => this.ctx.combatSystem.isAlive(enemyId),
        now,
      );
      for (const player of players) {
        const alive = this.ctx.combatSystem.isAlive(player.id);
        const glutwandererBursts = runtime.trackMovement(player.id, player.x, player.y);
        if (glutwandererBursts <= 0 || !alive || !player.active) continue;
        for (let burstIndex = 0; burstIndex < glutwandererBursts; burstIndex += 1) {
          this.ctx.flamethrowerUpgradeSystem?.hostCreateFireChunkBurst(
            player.id,
            player.x,
            player.y,
            {
              count: runtime.getGlutwandererChunkCount(player.id),
              searchRadius: COOP_DEFENSE_AFFIX_RULES.fireChunkRadius,
              flightMs: 320,
              igniteCenter: false,
              durationMs: COOP_DEFENSE_AFFIX_RULES.fireChunkGroundDurationMs,
              burnDurationMs: COOP_DEFENSE_AFFIX_RULES.fireChunkBurnDurationMs,
              burnDamagePerTick: COOP_DEFENSE_AFFIX_RULES.fireChunkBurnDamagePerTick,
              sourceId: 'powerup.GLUTWANDERER',
            },
            `glutwanderer:${player.id}:${now}:${burstIndex}`,
            now,
          );
        }
      }
    }

    if (!countdownActive && this.ctx.resourceSystem && this.ctx.burrowSystem) {
      for (const player of this.ctx.playerManager.getAllPlayers()) {
        if (!this.ctx.burrowSystem.isBurrowed(player.id)) {
          this.ctx.resourceSystem.regenTick(player.id, delta);
          this.ctx.combatSystem.hpRegenTick(player.id, delta);
          this.ctx.combatSystem.armorRegenTick(player.id, delta);
        }
      }
      this.ctx.burrowSystem.update(delta);
    }

    if (!countdownActive) {
      this.ctx.loadoutManager?.update(delta);
      this.ctx.powerUpSystem?.update(delta);
      this.ctx.tunnelSystem?.update(now);
    }

    this.blackHoleSystem.update(now);
    if (metrics) metrics.playerSystemsMs = performance.now() - phaseStartedAt;

    phaseStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    // Letzter Schritt vor der Physik: ein laufender Ausweichschritt überschreibt die
    // Wunschgeschwindigkeit aus Wegfindung und Angriffspause.
    if (!countdownActive) this.ctx.coopDefenseEnemyDodgeSystem?.hostUpdate(now);
    this.ctx.hostPhysics.update(countdownActive);
    if (!countdownActive) {
      this.ctx.reinforcementMatrixSystem?.update(now);
      this.ctx.energyInjectorSystem?.update(now);
      this.refreshMatrixVulnerabilities(now);
    }
    const decoys = countdownActive ? [] : this.ctx.decoySystem.createHostSnapshots();
    if (metrics) metrics.physicsMs = performance.now() - phaseStartedAt;

    phaseStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    if (!countdownActive) {
      this.ctx.detonationSystem?.checkProjectileDetonations();
      this.ctx.flamethrowerUpgradeSystem?.prepareProjectileBurns(now);
      this.ctx.weaponUpgradeSystem?.hostUpdate(now);
      this.ctx.combatSystem.update();
      this.ctx.combatSystem.updateBurnEffects(now);
    }

    const { explodedProjectiles, explodedGrenades, countdownEvents } = countdownActive
      ? { explodedProjectiles: [], explodedGrenades: [], countdownEvents: [] }
      : this.ctx.projectileManager.hostUpdate(delta);
    if (!countdownActive) this.ctx.ak47StrategicTargetSystem?.hostUpdate(now);
    const guardianSpirits = countdownActive
      ? []
      : (this.ctx.guardianSpiritSystem?.hostUpdate(now, delta) ?? []);
    this.visuals?.guardianSpirit.syncVisuals(guardianSpirits);
    if (!countdownActive) this.ctx.repairDroneSystem?.update(delta);
    const repairDrones = countdownActive
      ? []
      : (this.ctx.repairDroneSystem?.getSnapshot() ?? []);
    this.visuals?.repairDrone.syncVisuals(
      repairDrones,
      this.ctx.placementSystem?.getAllRuntimeRocks() ?? [],
    );
    const slimeTrail = countdownActive
      ? { cells: [], affectedEnemies: [] }
      : (this.ctx.slimeTrailSystem?.hostUpdate(now) ?? { cells: [], affectedEnemies: [] });
    this.visuals?.slimeTrail.syncVisuals(slimeTrail);
    if (!countdownActive) this.ctx.flamethrowerUpgradeSystem?.hostUpdate(now);
    if (metrics) metrics.combatProjectilesMs = performance.now() - phaseStartedAt;

    phaseStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    for (const evt of countdownEvents) {
      bridge.broadcastGrenadeCountdown(evt.x, evt.y, evt.value);
    }

    const detonations = countdownActive ? [] : (this.ctx.detonationSystem?.flushDetonations() ?? []);
    // Ablauf und Verrechnung liegen im gemeinsamen Resolver; hier stehen nur die
    // Host-Senken. Die Lobby verarbeitet ihre ASMD-Combo über denselben Weg.
    resolveDetonations(this.detonationEffectSink, detonations);

    for (const explosion of explodedProjectiles) {
      const matrix = explosion.effect.reinforcementMatrix ?? explosion.effect.overchargeField;
      if (matrix) {
        const field = this.ctx.reinforcementMatrixSystem?.spawnMatrix(
          explosion.ownerId,
          explosion.x,
          explosion.y,
          explosion.effect.radius,
          matrix.durationMs,
          matrix.damageReduction,
          matrix.vulnerabilityBonus,
          matrix.color,
          now,
        );
        if (field) {
          this.audio?.playSound(
            'sfx_place_spore_turret',
            field.x,
            field.y,
            explosion.ownerId,
          );
        }
        continue;
      }

      const timeBubble = explosion.effect.timeBubble;
      if (timeBubble) {
        const injectorEffect = explosion.sourceTurretId
          ? this.ctx.energyInjectorSystem?.getEffect(explosion.sourceTurretId, now)
          : null;
        const slowMultiplier = injectorEffect?.effect.type === 'slow_bubble'
          ? Math.max(1, injectorEffect.effect.slowStrengthMultiplier)
          : 1;
        const adjustedTimeBubble = slowMultiplier > 1
          ? {
            ...timeBubble,
            projectileSlowFactor: Math.max(0.05, 1 - (1 - timeBubble.projectileSlowFactor) * slowMultiplier),
            playerSlowFactor: Math.max(0.05, 1 - (1 - timeBubble.playerSlowFactor) * slowMultiplier),
            trainSlowFactor: Math.max(0.05, 1 - (1 - timeBubble.trainSlowFactor) * slowMultiplier),
          }
          : timeBubble;
        this.ctx.timeBubbleSystem?.hostCreateBubble(
          explosion.ownerId,
          explosion.x,
          explosion.y,
          adjustedTimeBubble,
          now,
        );
        continue;
      }

      const damagedTargetKeys = this.ctx.combatSystem.applyExplosionDamage(
        explosion.x,
        explosion.y,
        explosion.effect,
        explosion.ownerId,
        explosion.sourceSlot,
        explosion.sourceId ?? 'environment.explosion',
      );
      this.ctx.hostPhysics.applyRadialImpulse(
        explosion.x, explosion.y, explosion.effect.radius,
        explosion.effect.knockback, explosion.ownerId,
        explosion.effect.selfKnockbackMult ?? 1,
      );
      this.applyExplosionEnvironmentDamage(explosion.x, explosion.y, explosion.effect, explosion.ownerId);
      bridge.broadcastExplosionEffect(
        explosion.x, explosion.y, explosion.effect.radius,
        explosion.effect.color, explosion.effect.visualStyle,
      );
      const groundFire = explosion.effect.groundFire;
      if (groundFire && groundFire.radius > 0 && groundFire.lingerDuration > 0) {
        this.ctx.fireSystem.hostCreateZone(explosion.x, explosion.y, groundFire, explosion.ownerId);
      }
      if (explosion.effect.fireChunkBurst) {
        this.ctx.flamethrowerUpgradeSystem?.hostCreateFireChunkBurst(
          explosion.ownerId,
          explosion.x,
          explosion.y,
          explosion.effect.fireChunkBurst,
          `fireball-impact:${explosion.ownerId}`,
          now,
        );
      }
      if ((explosion.effect.blackHoleDurationMs ?? 0) > 0) {
        const durationMs = explosion.effect.blackHoleDurationMs ?? 0;
        const injectorEffect = explosion.sourceTurretId
          ? this.ctx.energyInjectorSystem?.getEffect(explosion.sourceTurretId, now)
          : null;
        const pullMultiplier = injectorEffect?.effect.type === 'gravity_pull'
          ? Math.max(1, injectorEffect.effect.pullStrengthMultiplier)
          : 1;
        this.blackHoleSystem.create(explosion.x, explosion.y, {
          radius: explosion.effect.radius,
          durationMs,
          pullStrength: (explosion.effect.blackHolePullStrength ?? 0) * pullMultiplier,
          ownerId: explosion.ownerId,
        }, now);
        bridge.broadcastBlackHoleEffect(explosion.x, explosion.y, explosion.effect.radius, durationMs);
      }
      if (explosion.continuesAfterExplosion && explosion.projectileId !== undefined) {
        this.ctx.projectileManager.resumeMultiExplosionProjectile(explosion.projectileId, damagedTargetKeys);
      }
    }

    for (const g of explodedGrenades) {
      if (g.effect.type === 'damage') {
        this.ctx.combatSystem.applyAoeDamage(g.x, g.y, g.effect.radius, g.effect.damage, g.ownerId, false, {
          category: 'explosion',
          allowTeamDamage: g.effect.allowTeamDamage,
          sourceId: 'weapon.grenade',
          sourceSlot: 'utility',
          damageFalloff: g.effect.damageFalloff,
          baseDamageMult: g.effect.baseDamageMult,
        });
        this.applyAoeEnvironmentDamage(
          g.x, g.y, g.effect.radius, g.effect.damage,
          g.effect.rockDamageMult ?? 1, g.effect.trainDamageMult ?? 1, g.ownerId,
          g.effect.damageFalloff,
        );
        bridge.broadcastExplosionEffect(g.x, g.y, g.effect.radius, undefined, g.effect.visualStyle);
        const clusterCount = Math.max(0, Math.floor(g.effect.clusterCount ?? 0));
        for (let index = 0; index < clusterCount; index += 1) {
          const angle = (Math.PI * 2 * index) / Math.max(1, clusterCount);
          const radius = g.effect.radius * (g.effect.clusterRadiusFactor ?? 0);
          const damage = g.effect.damage * (g.effect.clusterDamageFactor ?? 0);
          const cx = g.x + Math.cos(angle) * g.effect.radius * 0.45;
          const cy = g.y + Math.sin(angle) * g.effect.radius * 0.45;
          this.ctx.combatSystem.applyAoeDamage(cx, cy, radius, damage, g.ownerId, false, {
            category: 'explosion', allowTeamDamage: g.effect.allowTeamDamage, sourceId: 'weapon.cluster_charge', sourceSlot: 'utility',
            baseDamageMult: g.effect.baseDamageMult,
          });
          this.applyAoeEnvironmentDamage(cx, cy, radius, damage, g.effect.rockDamageMult ?? 1, g.effect.trainDamageMult ?? 1, g.ownerId);
          bridge.broadcastExplosionEffect(cx, cy, radius, undefined, g.effect.visualStyle);
        }
      } else if (g.effect.type === 'spawn_enemy') {
        this.spawnEnemiesFromGrenade(g.x, g.y, g.effect, g.ownerId);
      } else if (g.effect.type === 'fire') {
        this.ctx.fireSystem.hostCreateZone(g.x, g.y, g.effect, g.ownerId);
      } else if (g.effect.type === 'time_bubble') {
        this.ctx.timeBubbleSystem?.hostCreateBubble(g.ownerId, g.x, g.y, g.effect);
      } else {
        this.ctx.smokeSystem.hostCreateCloud(g.x, g.y, g.effect, g.ownerId);
      }
    }

    if (metrics) {
      metrics.explosionsMs = performance.now() - phaseStartedAt;
      metrics.explosionEventCount = detonations.length + explodedProjectiles.length + explodedGrenades.length;
    }
    phaseStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    const { synced: smokes, damageEvents: smokeDmg } = countdownActive
      ? { synced: [], damageEvents: [] }
      : this.ctx.smokeSystem.hostUpdate(Date.now());
    const {
      synced: fires,
      ground: liveBurningGround,
      damageEvents: fireDamageEvents,
      damageTick: fireDamageTick,
    } = countdownActive
      ? { synced: [], ground: { cells: [] }, damageEvents: [], damageTick: false }
      : this.ctx.fireSystem.hostUpdate(now);
    const burningGround = countdownActive && activeMapConfig
      ? buildCountdownGroundFirePreview(
        this.ctx.currentLayout,
        activeMapConfig,
        bridge.getArenaStartTime(),
      )
      : countdownActive ? { cells: [] } : liveBurningGround;
    this.visuals?.flamethrowerUpgrades.syncGround(burningGround, now);

    const { synced: stinkClouds, damageEvents: stinkDmg } = countdownActive
      ? { synced: [], damageEvents: [] }
      : this.ctx.stinkCloudSystem.hostUpdate(Date.now(), (id) => {
          const player = this.ctx.playerManager.getPlayer(id);
          if (player) {
            const profile = bridge.getConnectedPlayers().find(p => p.id === id);
            return {
              x:        player.x,
              y:        player.y,
              alive:    this.ctx.combatSystem.isAlive(id),
              burrowed: this.ctx.burrowSystem?.isBurrowed(id) ?? false,
              color:    profile?.colorHex ?? 0xffffff,
            };
          }

          const enemy = this.ctx.enemyManager?.getEnemy(id);
          if (!enemy?.sprite.active || enemy.getHp() <= 0) return null;
          return {
            x: enemy.sprite.x,
            y: enemy.sprite.y,
            alive: true,
            burrowed: false,
            color: 0x8aaa32,
          };
        });
    const timeBubbles = countdownActive ? [] : (this.ctx.timeBubbleSystem?.hostUpdate(Date.now()) ?? []);

    if (!countdownActive) {
      const turretCfg    = UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig;
      const turretWeapon = WEAPON_CONFIGS[turretCfg.weaponId as keyof typeof WEAPON_CONFIGS];
      this.ctx.turretSystem?.hostUpdate(Date.now(), turretCfg, turretWeapon);
    }

    const teslaDomes = countdownActive ? [] : (this.ctx.teslaDomeSystem?.hostUpdate(Date.now()) ?? []);
    const energyShields = countdownActive ? [] : (this.ctx.energyShieldSystem?.hostUpdate(Date.now()) ?? []);
    this.visuals?.timeBubble.syncVisuals(timeBubbles);
    this.visuals?.teslaDome.syncVisuals(teslaDomes);
    this.visuals?.energyShield.syncVisuals(energyShields);

    if (fireDamageTick) {
      for (const player of this.ctx.playerManager.getAllPlayers()) {
        if (!this.ctx.combatSystem.isAlive(player.id)) continue;
        const radius = player.getHitRadius();
        for (const contact of this.ctx.fireSystem.collectContacts(player.x, player.y, radius, now)) {
          if (contact.damageTarget === 'enemies') continue;
          if (contact.damagePerTick > 0 && player.id !== contact.ownerId) {
            this.ctx.combatSystem.applyDamage(
              player.id,
              Math.round(contact.damagePerTick),
              false,
              contact.ownerId,
              contact.sourceId,
              { sourceX: contact.x, sourceY: contact.y },
              { allowTeamDamage: contact.allowTeamDamage, damageKind: 'ground' },
            );
          }
          // Bodenfeuer darf seinen Besitzer oder dessen Team nicht entzuenden.
          // allowTeamDamage betrifft weiterhin nur den direkten Flaechenschaden.
          if (
            contact.burn
            && player.id !== contact.ownerId
            && this.ctx.combatSystem.canDamageTarget(contact.ownerId, player.id)
          ) {
            this.ctx.combatSystem.applyBurnHit(
              player.id,
              contact.ownerId,
              contact.burn.durationMs,
              contact.burn.damagePerTick,
              contact.sourceKey,
              contact.sourceId,
              'ground_fire',
              contact.visualStyle,
            );
          }
        }
      }

      for (const enemy of this.ctx.enemyManager?.getAllEnemies() ?? []) {
        if (!this.ctx.combatSystem.isAlive(enemy.id)) continue;
        for (const contact of this.ctx.fireSystem.collectContacts(
          enemy.sprite.x,
          enemy.sprite.y,
          enemy.getCollisionRadius(),
          now,
        )) {
          if (contact.damageTarget === 'players') continue;
          if (contact.damagePerTick > 0) {
            this.ctx.combatSystem.applyDamage(
              enemy.id,
              Math.round(contact.damagePerTick),
              false,
              contact.ownerId,
              contact.sourceId,
              { sourceX: contact.x, sourceY: contact.y },
              { allowTeamDamage: contact.allowTeamDamage, damageKind: 'ground' },
            );
          }
          if (contact.burn) {
            this.ctx.combatSystem.applyBurnHit(
              enemy.id,
              contact.ownerId,
              contact.burn.durationMs,
              contact.burn.damagePerTick,
              contact.sourceKey,
              contact.sourceId,
              'ground_fire',
              contact.visualStyle,
            );
          }
        }
      }
    }

    for (const ev of fireDamageEvents) {
      this.ctx.combatSystem.applyRadialHostileBaseDamage(
        ev.x, ev.y, ev.radius, ev.damage, ev.ownerId, undefined, undefined, ev.baseDamageMult,
      );
      this.applyAoeEnvironmentDamage(
        ev.x, ev.y, ev.radius, ev.damage,
        ev.rockDamageMult, ev.trainDamageMult, ev.ownerId,
      );
    }

    for (const ev of stinkDmg) {
      this.ctx.combatSystem.applyAoeDamage(ev.x, ev.y, ev.radius, ev.damage, ev.ownerId, false, {
        category: 'damage_over_time',
        sourceId: 'weapon.stink_cloud',
        sourceSlot: 'utility',
        baseDamageMult: ev.baseDamageMult,
      });
      this.applyAoeEnvironmentDamage(
        ev.x, ev.y, ev.radius, ev.damage,
        ev.rockDamageMult, ev.trainDamageMult, ev.ownerId,
      );
    }

    for (const ev of smokeDmg) {
      this.ctx.combatSystem.applyAoeDamage(ev.x, ev.y, ev.radius, ev.damage, ev.ownerId, false, {
        category: 'damage_over_time',
        sourceId: 'ultimate.thunderstorm',
        sourceSlot: 'utility',
      });
    }

    // Airstrike-Strikes detonieren
    if (!countdownActive) {
      this.ctx.airstrikeSystem?.update(Date.now());
    }

    const meteorImpacts = countdownActive ? [] : (this.ctx.armageddonSystem?.update(Date.now(), delta) ?? []);
    for (const mi of meteorImpacts) {
      if (mi.variant === 'void') {
        this.ctx.combatSystem.applyExplosionDamage(mi.x, mi.y, {
          radius: mi.radius,
          maxDamage: mi.damage,
          minDamage: mi.damageFalloff?.minDamage ?? mi.damage,
          knockback: 0,
          selfDamageMult: 0,
          allowTeamDamage: true,
          damageTarget: 'player-side',
        }, `void-armageddon:${mi.ownerId}`, 'ultimate', 'environment.void_meteor');
        bridge.broadcastExplosionEffect(mi.x, mi.y, mi.radius, 0xa631ff, 'energy');
      } else {
        this.ctx.combatSystem.applyAoeDamage(
          mi.x, mi.y, mi.radius, mi.damage, mi.ownerId,
          mi.selfDamageMult > 0,
          {
            category: 'explosion',
            sourceId: 'environment.meteor',
            sourceSlot: 'ultimate',
            damageFalloff: mi.damageFalloff,
            selfDamageMult: mi.selfDamageMult,
            baseDamageMult: mi.baseDamageMult,
          },
        );
        this.applyAoeEnvironmentDamage(
          mi.x, mi.y, mi.radius, mi.damage,
          mi.rockDamageMult, mi.trainDamageMult, mi.ownerId,
          mi.damageFalloff,
        );
        bridge.broadcastExplosionEffect(mi.x, mi.y, mi.radius, 0xff6622);
      }
      this.ctx.flamethrowerUpgradeSystem?.hostCreateFireChunkBurst(
        mi.ownerId,
        mi.x,
        mi.y,
        mi.fireChunkBurst,
        `armageddon-impact:${mi.id}`,
        now,
      );
    }

    if (metrics) metrics.explosionEventCount += meteorImpacts.length;
    if (metrics) metrics.areaEffectsMs = performance.now() - phaseStartedAt;
    phaseStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    if (!countdownActive
      && !isCoopDefenseMode(bridge.getArenaDescriptor()?.gameMode ?? bridge.getGameMode())
      && this.ctx.trainManager) {
      if (!this.classicTrainSpawned) {
        const trainEvent = bridge.getTrainEvent();
        if (trainEvent && Date.now() >= trainEvent.spawnAt) {
          this.ctx.trainManager.spawn();
          this.classicTrainSpawned = true;
          this.ctx.combatSystem.setTrainSegments(this.ctx.trainManager.getSegObjects());
        }
      }
      if (this.classicTrainSpawned) {
        this.ctx.trainManager.update(delta);
      }
    }

    // Host-local visuals each frame
    for (const player of this.ctx.playerManager.getAllPlayers()) {
      const hp    = this.ctx.combatSystem.getHP(player.id);
      const maxHp = this.ctx.combatSystem.getMaxHp(player.id);
      const armor = this.ctx.combatSystem.getArmor(player.id);
      const alive    = this.ctx.combatSystem.isAlive(player.id);
      const wasAlive = this.prevAliveStates.get(player.id) ?? false;
      if (alive && !wasAlive && !countdownActive) {
        this.audio?.playSound('sfx_player_spawn', player.x, player.y, player.id);
      }
      if (!countdownActive) this.prevAliveStates.set(player.id, alive);
      player.updateHP(hp, maxHp);
      player.updateArmor(armor);
      const burn = this.ctx.combatSystem.getBurnVisualState(player.id);
      player.updateBurnStacks(burn.stackCount, burn.visualStyle);
      player.setVisible(alive);
      player.setWalking(isVelocityMoving(player.body.velocity.x, player.body.velocity.y) && alive);
      player.setRageTint(this.ctx.loadoutManager?.isUltimateActive(player.id) ?? false);
      const isStealthed = this.ctx.decoySystem.isStealthed(player.id);
      const wasStealthed = this.prevStealthStates.get(player.id) ?? false;
      if (isStealthed !== wasStealthed) {
        this.effects?.playStealthTransitionEffect(player.x, player.y, !isStealthed, player.color);
      }
      player.setDecoyStealth(isStealthed);
      this.prevStealthStates.set(player.id, isStealthed);
      // Erst publizieren, dann lesen: Host und Clients leiten das getragene Item damit aus
      // derselben Quelle ab, statt der Host aus dem LoadoutManager und die Clients aus dem Netz.
      const heldSlot = this.ctx.loadoutManager?.getHeldItemSlot(player.id, now);
      if (heldSlot) bridge.publishHeldItemSlot(player.id, heldSlot);
      player.setHeldItemId(bridge.getPlayerHeldItemId(player.id));
      player.syncBar();
      const dashPhase = this.ctx.hostPhysics.getDashPhase(player.id);
      const prevDashPhase = this.prevDashPhases.get(player.id) ?? 0;
      if (dashPhase === 1 && prevDashPhase === 0) {
        this.audio?.playSound('sfx_dash', player.x, player.y, player.id);
      }
      // Flanke Erholung → kein Dash: der Nachbrenner setzt genau hier an. Die Dash-Phase ist der
      // einzige Zustand, den `HostPhysicsSystem` nach aussen meldet – ein eigener Callback dort
      // waere fuer diese eine Flanke unnoetig.
      if (dashPhase === 0 && prevDashPhase === 2) {
        this.ctx.coopDefenseItemRuntimeSystem?.registerDashCompleted(player.id, now);
      }
      this.prevDashPhases.set(player.id, dashPhase);
      if (dashPhase === 0) this.dashTrailTimers.delete(player.id);
      this.applyDashVisual(player, player.id, dashPhase, false);
    }

    for (const enemy of this.ctx.enemyManager?.getAllEnemies() ?? []) {
      const burn = this.ctx.combatSystem.getBurnVisualState(enemy.id);
      enemy.updateBurnStacks(burn.stackCount, burn.visualStyle);
      if (this.ctx.coopDefenseItemRuntimeSystem) {
        enemy.setVulnerable(
          this.ctx.coopDefenseItemRuntimeSystem.getEnemyIncomingDamageMultiplier(enemy.id, now) > 1,
        );
      }
      // Die Hitbox-Skalierung besorgt die Physik; hier fehlen nur Trail-Geister und Dash-Sound.
      if (this.presentationActive) this.enemyDashVisuals.sync(enemy);
    }

    const powerups    = this.ctx.powerUpSystem?.getWorldItemSnapshot() ?? [];
    const pedestals   = this.ctx.powerUpSystem?.getPedestalSnapshot()  ?? [];
    const nukes       = this.ctx.powerUpSystem?.getNukeSnapshot()      ?? [];
    const airstrikes  = this.ctx.airstrikeSystem?.getSnapshot()        ?? [];
    const meteors     = this.ctx.armageddonSystem?.getSnapshot()       ?? [];
    const train     = this.ctx.trainManager?.getNetSnapshot()        ?? null;
    const captureTheBeer = this.ctx.captureTheBeerSystem?.hostUpdate(!countdownActive) ?? null;
    const coopDefenseCarry = this.ctx.coopDefenseCarrySystem?.hostUpdate(!countdownActive) ?? [];
    this.ctx.coopDefenseCarryItems = coopDefenseCarry;
    const syncedNow = bridge.getSynchronizedNow();

    this.visuals?.train?.update(train);
    this.visuals?.beer.sync(captureTheBeer?.beers ?? []);
    this.visuals?.beer.syncCoopDefenseCarry(coopDefenseCarry);
    this.visuals?.powerUp.syncPedestals(pedestals);
    this.visuals?.powerUp.sync(powerups);
    this.visuals?.powerUp.updatePedestals(syncedNow);
    this.visuals?.nuke.sync(nukes);
    this.visuals?.airstrike.sync(airstrikes);
    this.visuals?.meteor.sync(meteors);
    if (!countdownActive) this.checkLocalPickup(powerups);

    const localId = bridge.getLocalPlayerId();
    for (const p of this.ctx.playerManager.getAllPlayers()) {
      if (p.id === localId) continue;
      const remoteInput = bridge.getPlayerInput(p.id);
      if (remoteInput) p.setRotation(dequantizeAngle(remoteInput.aim));
    }

    for (const player of this.ctx.playerManager.getAllPlayers()) {
      const burrowPhase = this.ctx.burrowSystem?.getPhase(player.id) ?? 'idle';
      this.applyBurrowVisual(player, burrowPhase);
    }

    if (metrics) metrics.worldVisualsMs = performance.now() - phaseStartedAt;
    phaseStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    // Local host HUD
    const localPlayer = this.ctx.playerManager.getPlayer(localId);
    if (localPlayer) {
      const isMovingLocal = isVelocityMoving(localPlayer.body.velocity.x, localPlayer.body.velocity.y);

      // Movement loop for local player
      const localAlive = this.ctx.combatSystem.isAlive(localId);
      const localBurrowed = this.ctx.burrowSystem?.isBurrowed(localId) ?? false;
      if (isMovingLocal && localAlive && !localBurrowed && !this.moveLoopHandle) {
        this.moveLoopHandle = this.audio?.startLoop('sfx_player_move') ?? null;
      } else if ((!isMovingLocal || !localAlive || localBurrowed) && this.moveLoopHandle) {
        this.audio?.stopLoop(this.moveLoopHandle);
        this.moveLoopHandle = null;
      }

      const aimLocal      = this.ctx.loadoutManager?.getAimNetState(localId, isMovingLocal)
                          ?? this.getDefaultAimState(isMovingLocal);
      this.ctx.aimSystem?.setAuthoritativeState(aimLocal);
      this.ctx.inputSystem.setLocalState(
        this.ctx.burrowSystem?.isStunned(localId) ?? false,
        this.ctx.burrowSystem?.isBurrowed(localId) ?? false,
        this.ctx.burrowSystem?.getPhase(localId) ?? 'idle',
      );
      localPlayer.setRotation(this.ctx.inputSystem.getAimAngle());
      const now = Date.now();
      const committedLoadout = bridge.getPlayerCommittedLoadout(localId);
      const gameMode = bridge.getArenaDescriptor()?.gameMode ?? bridge.getGameMode();
      const hasUtilityOverride = bridge.getPlayerUtilityOverrideId(localId) !== '';
      const inspectorUtilityAction = hasUtilityOverride
        ? null
        : this.ctx.inputSystem.getSelectedInspectorUtilityActionForHud();
      const selectedInspectorTool = hasUtilityOverride || inspectorUtilityAction ? undefined
        : (this.ctx.inputSystem.getSelectedInspectorToolForHud() ?? committedLoadout?.coopDefenseProfile?.selectedTool);
      const selectedInspectorUtilityBase = selectedInspectorTool?.kind === 'utility'
        ? getUtilityConfigForMode(selectedInspectorTool.id, gameMode)
        : undefined;
      const selectedInspectorUtility = selectedInspectorUtilityBase
        ? this.ctx.loadoutManager?.resolveUtilityConfig(localId, selectedInspectorUtilityBase) ?? selectedInspectorUtilityBase
        : undefined;
      const selectedInspectorConstruction = selectedInspectorTool?.kind === 'construction'
        ? getCoopDefenseConstructionDefinition(selectedInspectorTool.id)
        : undefined;
      const activeConstructionTool = selectedInspectorTool?.kind === 'construction'
        ? selectedInspectorTool
        : committedLoadout?.coopDefenseClassId === 'inspector_gadachs'
          ? null
          : getActiveConstructionToolRefs(getConstructionAccessContext(gameMode, committedLoadout))
            .find((tool) => tool.kind === 'construction') ?? null;
      const utilCfg   = selectedInspectorUtility ?? this.ctx.loadoutManager?.getEquippedUtilityConfig(localId);
      // Konstrukte belegen Baukapazitaet (BK) und zeigen ihre Kosten am Namen; reine
      // Utilities kosten nichts ausser ihrem Cooldown.
      const inspectorCapacityCost = activeConstructionTool ? getToolCapacityCost(activeConstructionTool) : 0;
      const utilityId = inspectorUtilityAction
        ? undefined
        : selectedInspectorConstruction
          ? `construction.${selectedInspectorConstruction.id}`
          : utilCfg?.id;
      const ultCfg    = this.ctx.loadoutManager?.getEquippedUltimateConfig(localId) ?? this.getFallbackUltimateConfig();
      const weapon2Cfg = this.ctx.loadoutManager?.getEquippedWeaponConfig(localId, 'weapon2');
      const activePowerUps = [
        ...(this.ctx.powerUpSystem?.getActiveBuffsForHUD(localId) ?? []),
        ...(this.ctx.loadoutManager?.getAk47HudBuffs(localId, now) ?? []),
        ...(this.ctx.loadoutManager?.getNegevHudBuffs(localId) ?? []),
        ...this.getMovementChargeHudBuffs(localId),
        ...this.getGlutwandererHudBuffs(localId),
        ...this.getSurroundedHudBuffs(localId, now),
      ];
      const teamBuff = this.getTeamBuffHudBuff(localId, now);
      const stealthBuff = this.ctx.decoySystem.getStealthBuff(localId, now);
      const shieldBuff = this.ctx.loadoutManager?.getShieldBuffHudState(localId, now);
      const ultimateThresholds = this.ctx.loadoutManager?.getUltimateThresholds(localId) ?? [ultCfg?.rageRequired ?? 300];
      const hudData = buildLocalArenaHudData({
        hp:                      this.ctx.combatSystem.getHP(localId),
        maxHp:                   this.ctx.combatSystem.getMaxHp(localId),
        armor:                   this.ctx.combatSystem.getArmor(localId),
        maxArmor:                this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(localId, 'player.maxArmor', 100) ?? 100,
        adrenaline:              this.ctx.resourceSystem?.getAdrenaline(localId) ?? 0,
        maxAdrenaline:           this.ctx.resourceSystem?.getMaxAdrenaline(localId) ?? 100,
        rage:                    this.ctx.resourceSystem?.getRage(localId) ?? 0,
        maxRage:                 this.ctx.resourceSystem?.getMaxRage(localId) ?? 600,
        isUltimateActive:        this.ctx.loadoutManager?.isUltimateActive(localId) ?? false,
        ultimateRequiredRage:    ultCfg?.rageRequired ?? 300,
        ultimateThresholds,
        ultimateId:              ultCfg?.id,
        weapon1CooldownFrac:     this.ctx.loadoutManager?.getCooldownFrac(localId, 'weapon1', now) ?? 0,
        weapon2CooldownFrac:     this.ctx.loadoutManager?.getCooldownFrac(localId, 'weapon2', now) ?? 0,
        utilityCooldownFrac:     this.getLocalUtilityCooldownFrac(),
        utilityId,
        utilityAction:            inspectorUtilityAction ?? undefined,
        utilityCapacityCost:     inspectorCapacityCost,
        adrenalineSyringeActive: (this.ctx.powerUpSystem?.getRegenMultiplier(localId) ?? 1) > 1,
        isUtilityOverridden:     bridge.getPlayerUtilityOverrideId(localId) !== '',
        activePowerUps:          [
          ...activePowerUps,
          ...(teamBuff ? [teamBuff] : []),
          ...(stealthBuff ? [stealthBuff] : []),
        ],
        shieldBuff,
        weapon2AdrenalineCost:   this.ctx.loadoutManager?.isAk47FireSuperiorityAvailable(localId)
          ? 0
          : (weapon2Cfg?.adrenalinCost ?? 0),
        constructionCapacityUsed: this.ctx.placementSystem?.getUsedCapacity(localId) ?? 0,
        constructionCapacityMax:  getActiveConstructionToolRefs(
          getConstructionAccessContext(gameMode, committedLoadout),
        ).length > 0
          ? resolveConstructionCapacity({
            gameMode,
            classId: committedLoadout?.coopDefenseClassId,
            modifiers: this.ctx.coopDefensePlayerModifierSystem?.getNumericStat(
              localId,
              COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT,
            ) ?? 0,
          })
          : 0,
      });
      this.localPlayerState.alive    = this.ctx.combatSystem.isAlive(localId);
      this.localPlayerState.burrowed = this.ctx.burrowSystem?.isBurrowed(localId) ?? false;
      // Das World-HUD ist eine Darstellungsflaeche. Ohne lokale World-Presentation entsteht
      // der Snapshot weiterhin - er wird nur nicht angezeigt.
      if (this.presentationActive) {
        this.ctx.leftPanel.updateArenaHUD(hudData);
        this.ctx.centerHUD.updateBottomStatus(
          hudData,
          this.ctx.inputSystem.isUtilityHudDisplayActive(),
        );
        this.ctx.playerStatusRing?.update(hudData);
      }
    }

    this.ctx.stinkCloudSystem.clientUpdate(delta);
    if (metrics) metrics.hudMs = performance.now() - phaseStartedAt;

    phaseStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    // Gesammelte Treffer-/Todes-Effekte dieses Frames als ein einziges Batch-RPC senden, statt pro
    // Treffer ein eigenes RPC (vermeidet Host-step-Spikes bei flächigem Massen-Schaden).
    bridge.flushEffects();
    if (metrics) metrics.effectFlushMs = performance.now() - phaseStartedAt;

    // ── Network tick throttle ─────────────────────────────────────────────
    this.netTickAccumulator += delta;
    if (this.netTickAccumulator < NET_TICK_INTERVAL_MS) {
      if (metrics) {
        metrics.totalMs = performance.now() - startedAt;
        this.lastPerformance = metrics;
      } else if (this.coarsePerformanceMetricsEnabled) {
        this.lastPerformance = {
          ...emptyHostUpdatePerformanceMetrics(),
          totalMs: performance.now() - startedAt,
          navWorkerComputeMs: this.ctx.flowFieldCoordinator?.getDiagnostics().lastWorkerComputeMs ?? 0,
        };
      }
      return;
    }
    this.netTickAccumulator -= NET_TICK_INTERVAL_MS;
    if (this.netTickAccumulator > NET_TICK_INTERVAL_MS) this.netTickAccumulator = 0;
    if (metrics) metrics.networkTick = true;
    // One coarse timing pair covers the complete net-tick snapshot path: request consumption,
    // temporary snapshot structures and the final publication. No fine-grained timers are added.
    const snapshotBuildStartedAt = this.coarsePerformanceMetricsEnabled ? performance.now() : 0;
    phaseStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;

    // Erst nach dem Throttle konsumieren: In Frames ohne Net-Tick muss die Anforderung
    // erhalten bleiben, damit der reliable Bootstrap garantiert veroeffentlicht wird.
    const fullSnapshotRequested = bridge.consumeFullGameStateRequest();
    if (fullSnapshotRequested) {
      this.ctx.rockRegistry?.requestFullNetSnapshot();
      this.ctx.powerUpSystem?.requestFullNetSnapshot();
      this.ctx.enemyManager?.requestFullNetSnapshot();
      this.ctx.projectileManager.requestFullNetSnapshot();
    }

    for (const expiredRock of this.ctx.placementSystem?.update(now) ?? []) {
      this.ctx.targetStatusSystem?.removeTarget({ targetType: 'construction', targetId: String(expiredRock.id) });
      this.ctx.energyInjectorSystem?.removeTarget({ targetType: 'construction', targetId: String(expiredRock.id) });
      if (expiredRock.kind === 'turret') {
        this.rockVisualHelper.spawnTurretDeathCloud(expiredRock);
      }
      if (expiredRock.kind === 'pedestal') {
        this.ctx.powerUpSystem?.unregisterConstructionPedestal(expiredRock.id);
      }
      this.rockVisualHelper.removePlaceableRockVisual(expiredRock, true);
      emitArenaMapGridChanged(this.scene.game.events, {
        reason: 'placeable_expired',
        source: expiredRock.kind === 'rock'
          ? 'placeable_rock'
          : expiredRock.kind === 'pedestal' ? 'placeable_pedestal' : 'placeable_turret',
        obstacleId: expiredRock.id,
        gridX: expiredRock.gridX,
        gridY: expiredRock.gridY,
      });
    }
    this.ctx.reinforcementMatrixSystem?.update(now);
    this.ctx.energyInjectorSystem?.update(now);

    const players: Record<string, PlayerNetState> = {};
    for (const player of this.ctx.playerManager.getAllPlayers()) {
      const hp         = this.ctx.combatSystem.getHP(player.id);
      const maxHp      = this.ctx.combatSystem.getMaxHp(player.id);
      const armor      = this.ctx.combatSystem.getArmor(player.id);
      const alive      = this.ctx.combatSystem.isAlive(player.id);
      const adrenaline = this.ctx.resourceSystem?.getAdrenaline(player.id) ?? 0;
      const rage       = this.ctx.resourceSystem?.getRage(player.id) ?? 0;
      const isBurrowed = this.ctx.burrowSystem?.isBurrowed(player.id) ?? false;
      const isStunned  = this.ctx.burrowSystem?.isStunned(player.id)  ?? false;
      const burrowPhase = this.ctx.burrowSystem?.getPhase(player.id) ?? 'idle';
      const isRaging   = this.ctx.loadoutManager?.isUltimateActive(player.id) ?? false;
      const activeUltimateId = this.ctx.loadoutManager?.getActiveUltimateId(player.id) ?? undefined;
      const burn = this.ctx.combatSystem.getBurnVisualState(player.id);
      const isChargingUltimate = this.ctx.loadoutManager?.isUltimateCharging(player.id) ?? false;
      const ultimateChargeFraction = this.ctx.loadoutManager?.getUltimateChargeFraction(player.id, now) ?? 0;
      const ultimateChargeRange    = this.ctx.loadoutManager?.getUltimateChargeRange(player.id) ?? 0;
      const isDecoyStealthed = this.ctx.decoySystem.isStealthed(player.id);
      const decoyStealthRemainingFrac = this.ctx.decoySystem.getStealthRemainingFrac(player.id, now);
      const isMoving = isVelocityMoving(player.body.velocity.x, player.body.velocity.y);
      const aim      = this.ctx.loadoutManager?.getAimNetState(player.id, isMoving)
                     ?? this.getDefaultAimState(isMoving);

      bridge.publishAdrSyringeActive(player.id, (this.ctx.powerUpSystem?.getRegenMultiplier(player.id) ?? 1) > 1);
      const activeBuffs = [
        ...(this.ctx.powerUpSystem?.getActiveBuffsForHUD(player.id) ?? []),
        ...(this.ctx.loadoutManager?.getAk47HudBuffs(player.id, now) ?? []),
        ...(this.ctx.loadoutManager?.getNegevHudBuffs(player.id) ?? []),
        ...this.getMovementChargeHudBuffs(player.id),
        ...this.getGlutwandererHudBuffs(player.id),
        ...this.getSurroundedHudBuffs(player.id, now),
      ];
      const teamBuff = this.getTeamBuffHudBuff(player.id, now);
      const stealthBuff = this.ctx.decoySystem.getStealthBuff(player.id, now);
      bridge.publishActiveBuffs(player.id, [
        ...activeBuffs,
        ...(teamBuff ? [teamBuff] : []),
        ...(stealthBuff ? [stealthBuff] : []),
      ]);
      bridge.publishShieldBuffHud(player.id, this.ctx.loadoutManager?.getShieldBuffHudState(player.id, now) ?? {
        visible: false,
        defId: 'SHIELD_OVERCHARGE',
        value: 0,
        maxValue: 1,
        damageBonusPct: 0,
      });

      const playerInput = bridge.getPlayerInput(player.id);
      players[player.id] = {
        x: Math.round(player.x),
        y: Math.round(player.y),
        rot: playerInput?.aim ?? 0,
        hp,
        maxHp,
        armor,
        alive,
        adrenaline: Math.round(adrenaline),
        rage: Math.round(rage),
        isBurrowed,
        isStunned,
        burrowPhase,
        isRaging,
        activeUltimateId,
        burnStacks: burn.stackCount,
        burnVisualStyle: burn.visualStyle,
        isChargingUltimate,
        ultimateChargeFraction,
        ultimateChargeRange,
        isDecoyStealthed,
        decoyStealthRemainingFrac,
        dashPhase: this.ctx.hostPhysics.getDashPhase(player.id),
        flameRingRadius: this.ctx.flamethrowerUpgradeSystem?.getActiveRingRadius(player.id),
        aim: {
          revision:             aim.revision,
          isMoving:             aim.isMoving,
          weapon1DynamicSpread: Math.round(aim.weapon1DynamicSpread * 10) / 10,
          weapon2DynamicSpread: Math.round(aim.weapon2DynamicSpread * 10) / 10,
        },
      };
    }

    this.visuals?.flamethrowerUpgrades.syncRings(players);
    // Waehrend des Countdowns gibt es keine Projektile; der als "voll" markierte Leer-Snapshot
    // raeumt einen etwaigen Client-Statikcache ab, statt ihn unveraendert stehen zu lassen.
    const projectiles = countdownActive
      ? EMPTY_FULL_PROJECTILE_SNAPSHOT
      : this.ctx.projectileManager.getNetSnapshot();
    const remoteControlTurrets = this.ctx.coopDefenseItemRuntimeSystem?.getRemoteControlSnapshot(
      this.ctx.playerManager.getAllPlayers().map((player) => player.id),
      this.ctx.turretSystem?.getTurrets() ?? [],
    ) ?? [];

    bridge.publishGameState({
      roundStartTime: bridge.getArenaStartTime(),
      players,
      projectiles,
      enemies: this.ctx.enemyManager?.getNetSnapshot() ?? null,
      // Delta-Snapshot inline (einmal pro Net-Tick, nach dem Throttle): der Aufruf VERBRAUCHT
      // die gesammelten Removals und HP-Änderungen. Weiter oben im Frame aufgerufen, würden
      // sie auf den ~2 von 3 Frames ohne Net-Tick ersatzlos verfallen.
      rocks: this.ctx.rockRegistry?.getNetSnapshot() ?? null,
      placeableRocks: this.ctx.placementSystem?.getNetSnapshot() ?? [],
      reinforcementMatrices: this.ctx.reinforcementMatrixSystem?.getNetSnapshot() ?? [],
      energyInjectorEffects: this.ctx.energyInjectorSystem?.getNetEffectSnapshot(now) ?? [],
      energyInjectorFocus: this.ctx.energyInjectorSystem?.getNetFocusSnapshot(now) ?? [],
      remoteControlTurrets,
      decoys,
      smokes,
      fires,
      stinkClouds,
      timeBubbles,
      teslaDomes,
      energyShields,
      guardianSpirits,
      repairDrones,
      slimeTrail,
      burningGround,
      targetVulnerabilities: this.ctx.targetStatusSystem?.getSnapshot(now) ?? [],
      ak47StrategicTargets: this.ctx.ak47StrategicTargetSystem?.getNetSnapshot(now) ?? [],
      // Ebenfalls verbrauchend – siehe `rocks`. Das volle Array oben (`powerups`, `pedestals`)
      // dient nur der host-lokalen Darstellung und dem eigenen Aufsammel-Check.
      powerups: this.ctx.powerUpSystem?.getNetSnapshot() ?? null,
      pedestals: this.ctx.powerUpSystem?.getPedestalNetSnapshot() ?? null,
      nukes,
      airstrikes,
      meteors,
      tunnels: this.ctx.tunnelSystem?.getSnapshot() ?? [],
      train,
      bases: this.ctx.baseManager?.getNetSnapshot() ?? [],
      captureTheBeer,
      coopDefenseCarry,
    }, fullSnapshotRequested);
    const snapshotBuildMs = this.coarsePerformanceMetricsEnabled
      ? Math.max(0, performance.now() - snapshotBuildStartedAt)
      : 0;

    // Direkt an den Physik-Projektilen statt am Wire-Snapshot: der Rumble ist reine Host-Praesentation
    // und haengt nicht davon ab, was in diesem Tick tatsaechlich uebertragen wurde.
    let bfgInFlight = false;
    for (const projectile of this.ctx.projectileManager.getActiveProjectiles()) {
      if (projectile.projectileStyle === 'bfg') { bfgInFlight = true; break; }
    }
    if (bfgInFlight) {
      if (this.presentationActive) this.ctx.visualFeedback.camera.request(bfgFlightRumble());
    }
    if (metrics) {
      metrics.snapshotBuildMs = snapshotBuildMs;
      metrics.totalMs = performance.now() - startedAt;
      this.lastPerformance = metrics;
    } else if (this.coarsePerformanceMetricsEnabled) {
      this.lastPerformance = {
        ...emptyHostUpdatePerformanceMetrics(),
        totalMs: performance.now() - startedAt,
        networkTick: true,
        snapshotBuildMs,
        navWorkerComputeMs: this.ctx.flowFieldCoordinator?.getDiagnostics().lastWorkerComputeMs ?? 0,
      };
    }
  }

  /**
   * Activity Update – Missionsfortschritt und Ziele.
   *
   * Position und Reihenfolge im Host-Tick sind unveraendert; neu ist allein, dass die Gruppe
   * durch die laufende Activity aktiviert wird statt durch die Nullbarkeit ihrer Systeme.
   */
  private runCoopMissionProgressPhase(
    delta: number,
    now: number,
    countdownActive: boolean,
    weaponBalanceLabActive: boolean,
  ): void {
    this.ctx.coopDefenseBossSystem?.hostUpdate(delta, countdownActive, now);
    this.ctx.coopDefenseMissionProgressSystem?.hostUpdate(
      delta,
      countdownActive || weaponBalanceLabActive,
      this.ctx.playerManager.getAllPlayers().map((player) => ({
        playerId: player.id,
        x: player.x,
        y: player.y,
        eligible: (this.playerCapabilitiesResolver?.(player.id).canUseMissionActions
          ?? bridge.canPlayerAct(player.id)) && this.ctx.combatSystem.isAlive(player.id),
      })),
    );
    this.ctx.coopDefenseMapDirector?.hostUpdate(delta, countdownActive);
    this.ctx.coopDefenseMapEventDirector?.hostUpdate(delta, countdownActive);
    this.ctx.coopDefenseSecondaryObjectiveSystem?.hostUpdate(delta, countdownActive);
    this.publishCoopDefenseEncounterPresentation();
    this.publishCoopDefenseMapEventPresentation();
    this.publishCoopDefenseSecondaryObjectivePresentation();
    // The objective snapshot is now current; activate prebuilt mission structures before
    // flow-field refresh and enemy movement in this same host frame.
    this.ctx.baseManager?.syncDormantStates();
    // Reward-Ausführung nach dem Zustandswechsel und vor dem Basis-Snapshot dieses Frames.
    this.ctx.coopDefenseObjectiveRepairSystem?.hostUpdate(delta, countdownActive);
    // Read active structure sources after the objective transition so pressure starts in the same
    // host frame in which its linked dormant base becomes active.
    this.ctx.coopDefensePersistentPressureSystem?.hostUpdate(delta, countdownActive);
  }

  /** Activity Update – Gegner-Navigation, Bewegung und Kampf. */
  private runCoopMissionCombatPhase(
    delta: number,
    now: number,
    countdownActive: boolean,
    weaponBalanceLabActive: boolean,
  ): void {
    if (!countdownActive) this.ctx.coopDefenseTimebombSystem?.hostUpdate(now);
    // Vor der Bewegung: Wer hat freien Boden erreicht bzw. seine maximale Grabzeit erschöpft?
    if (!countdownActive) this.ctx.coopDefenseEnemyBurrowSystem?.hostUpdate(now);
    // Gefechtsabstand vor der Bewegung bestimmen: das Ergebnis ersetzt für Fernkämpfer die
    // Wegfindung im selben Frame.
    if (!countdownActive) this.ctx.coopDefenseEnemyCombatPositioningSystem?.hostUpdate();
    this.ctx.enemyManager?.hostUpdateMovement(
      this.ctx.enemyFlowFieldService,
      this.ctx.enemyPlayerFlowFieldService,
      this.ctx.enemyStrategicFlowFieldService,
      this.ctx.enemyBossFlowFieldService,
      countdownActive || weaponBalanceLabActive,
      now,
      delta,
      this.ctx.fireSystem,
      (enemyId, at) => this.ctx.combatSystem.getActiveBurnSources(enemyId, at),
      this.ctx.coopDefenseEnemyTrainAwarenessSystem,
      this.ctx.coopDefenseEnemyBurrowSystem,
      this.ctx.coopDefenseEnemyCombatPositioningSystem,
      this.ctx.coopDefenseTimebombSystem,
      this.ctx.smokeSystem,
    );
    if (!countdownActive) this.ctx.necromancySystem?.hostUpdate(now, delta);
    if (!countdownActive && !weaponBalanceLabActive) {
      this.ctx.coopDefenseVoidHunterSystem?.hostUpdate(now);
      this.ctx.coopDefenseEnemyAbilitySystem?.hostUpdate(now);
      this.ctx.coopDefenseEnemyAttackSystem?.hostUpdate(delta, now);
    }
  }

  private publishCoopDefenseEncounterPresentation(): void {
    const state = this.ctx.coopDefenseMapDirector?.getPresentationState() ?? null;
    const signature = state
      ? [
        state.encounterId,
        state.sequenceIndex,
        state.sequenceCount,
        state.phase,
        state.phaseStartedAtMs,
        state.phaseEndsAtMs ?? 'open',
        state.spawnComplete ?? 'unknown',
        state.encounterFronts.join(','),
        state.fronts.join(','),
        // Jeder erledigte Gegner ist ein echter Anzeigewechsel und muss repliziert werden.
        state.enemiesDefeated ?? 'none',
        state.enemiesTotal ?? 'none',
      ].join('|')
      : null;
    if (signature === this.lastEncounterPresentationSignature) return;
    this.lastEncounterPresentationSignature = signature;
    bridge.publishCoopDefenseEncounterPresentationState(state);
  }

  private publishCoopDefenseMapEventPresentation(): void {
    const state = this.ctx.coopDefenseMapEventDirector?.getPresentationState() ?? null;
    // Der Director cached den immutable-looking Presentation-State bis zum echten
    // Lifecycle-Wechsel. Referenzvergleich verhindert sowohl JSON-Serialisierung als auch
    // eine neue reliable Publikation pro Renderframe.
    if (state === this.lastMapEventPresentationState) return;
    this.lastMapEventPresentationState = state;
    bridge.publishCoopDefenseMapEventPresentationState(state);
  }

  private publishCoopDefenseSecondaryObjectivePresentation(): void {
    const state = this.ctx.coopDefenseSecondaryObjectiveSystem?.getPresentationState() ?? null;
    const signature = state ? JSON.stringify(state) : null;
    if (signature === this.lastSecondaryObjectivePresentationSignature) return;
    this.lastSecondaryObjectivePresentationSignature = signature;
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(state);
  }

  getPerformanceMetrics(): HostUpdatePerformanceMetrics {
    return this.lastPerformance;
  }

  getLeaderboardEntries(): { name: string; colorHex: number; frags: number; ping: number; teamId: TeamId | null; teamScore?: number; sharedXp?: number }[] {
    const playerIds = bridge.getRoundResultEligiblePlayerIds();
    const signatureParts: string[] = [];
    const blueTeamScore = this.resolveTeamObjectiveScore('blue');
    const redTeamScore = this.resolveTeamObjectiveScore('red');
    const gameMode = bridge.getArenaDescriptor()?.gameMode ?? bridge.getGameMode();
    const sharedXp = isCoopDefenseMode(gameMode) ? bridge.getCoopDefenseRoundXp() : undefined;
    if (blueTeamScore !== null || redTeamScore !== null) {
      signatureParts.push(`ctb:${blueTeamScore ?? 0}:${redTeamScore ?? 0}`);
    }
    if (sharedXp !== undefined) {
      signatureParts.push(`cdxp:${sharedXp}`);
    }
    for (const playerId of playerIds) {
      signatureParts.push(`${playerId}:${bridge.getPlayerName(playerId)}:${bridge.getPlayerColor(playerId) ?? 0xffffff}:${bridge.getPlayerFrags(playerId)}:${bridge.getPlayerPing(playerId)}:${isTeamGameMode(gameMode) ? bridge.getPlayerTeam(playerId) ?? 'none' : 'none'}`);
    }
    const nextSignature = signatureParts.join('|');
    if (nextSignature === this.leaderboardSignature) return this.cachedLeaderboardEntries;
    this.leaderboardSignature = nextSignature;
    const entries = playerIds
      .map(playerId => ({
        name:     bridge.getPlayerName(playerId),
        colorHex: bridge.getPlayerColor(playerId) ?? 0xffffff,
        frags:    bridge.getPlayerFrags(playerId),
        // Das Leaderboard zeigt eine Zahl; solange nichts gemessen wurde, ist 0 die
        // ehrlichste Naeherung (der Host misst sich ohnehin nie selbst).
        ping:     bridge.getPlayerPing(playerId) ?? 0,
        teamId:   isTeamGameMode(gameMode) ? bridge.getPlayerTeam(playerId) : null,
        teamScore: this.resolveEntryTeamScore(playerId, blueTeamScore, redTeamScore),
        sharedXp,
      }));
    this.cachedLeaderboardEntries = isCoopDefenseMode(gameMode)
      ? entries
      : entries.sort((a, b) => b.frags - a.frags);
    return this.cachedLeaderboardEntries;
  }

  private resolveTeamObjectiveScore(teamId: TeamId): number | null {
    if ((bridge.getArenaDescriptor()?.gameMode ?? bridge.getGameMode()) !== CAPTURE_THE_BEER_MODE) return null;
    if (bridge.isHost()) {
      return this.ctx.captureTheBeerSystem?.getTeamScore(teamId) ?? 0;
    }
    return bridge.getLatestGameState()?.captureTheBeer?.scores[teamId] ?? 0;
  }

  private resolveEntryTeamScore(
    playerId: string,
    blueTeamScore: number | null,
    redTeamScore: number | null,
  ): number | undefined {
    if ((bridge.getArenaDescriptor()?.gameMode ?? bridge.getGameMode()) !== CAPTURE_THE_BEER_MODE) return undefined;
    const teamId = bridge.getPlayerTeam(playerId);
    if (teamId === 'blue') return blueTeamScore ?? 0;
    if (teamId === 'red') return redTeamScore ?? 0;
    return undefined;
  }

  // ── AoE helpers ──────────────────────────────────────────────────────────

  /**
   * Gemeinsamer Arena-Radiuspfad fuer Felsen. Der Grid-Index liefert nur eine konservative
   * Kandidatenmenge; aktive Objekte und exakte Trefferbedingungen bleiben beim Aufrufer.
   */
  private forEachArenaRockInRadius(
    x: number,
    y: number,
    radius: number,
    visit: (index: number, rock: RockPhysicsProxy) => void,
  ): void {
    const arenaResult = this.ctx.arenaResult;
    const world = this.ctx.world;
    if (!arenaResult || !world) return;
    arenaResult.rockGrid.forEachRockInRadius(
      x,
      y,
      radius,
      world.metrics.offsetX,
      world.metrics.offsetY,
      CELL_SIZE,
      (index) => {
        const rock = arenaResult.rockPhysicsProxies[index];
        if (!rock?.active) return;
        visit(index, rock);
      },
    );
  }

  applyAoeEnvironmentDamage(
    x: number, y: number, radius: number, damage: number,
    rockMult: number, trainMult: number, attackerId: string,
    damageFalloff?: RadialDamageFalloffConfig,
  ): void {
    const arenaResult = this.ctx.arenaResult;

    if (arenaResult) {
      // Der Fels-Anteil läuft über den gemeinsamen Kern; die Lobby benutzt denselben Resolver
      // mit ihrem lokalen Bestand, damit Falloff und `rockDamageMult` identisch wirken.
      applyRadialEnvironmentDamage(
        this.environmentRockSink,
        { x, y, radius, damage, rockDamageMult: rockMult, falloff: damageFalloff },
        attackerId,
        false,
      );
    }

    if (trainMult !== 0 && this.ctx.trainManager) {
      const trainState = this.ctx.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        for (const seg of this.ctx.trainManager.getSegObjects()) {
          if (!seg.active) continue;
          const b  = seg.getBounds();
          const dx = Math.max(b.left - x, 0, x - b.right);
          const dy = Math.max(b.top  - y, 0, y - b.bottom);
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= radius) {
            const scaledDamage = Math.round(computeRadialDamage(dist, radius, damage, damageFalloff) * trainMult);
            if (scaledDamage <= 0) continue;
            this.ctx.trainManager.applyDamage(scaledDamage, attackerId);
            break;
          }
        }
      }
    }
  }

  /**
   * Erzeugt am Explosions-/Detonationsort eine Schaden-über-Zeit-Fläche, sofern
   * konfiguriert und aktiv. Generisch nutzbar für Detonationen (ASMD-Ball) und
   * spätere Explosions-Upgrades (Rakete, HE-/Smoke-Granate, …). Der Flächenradius
   * basiert auf dem übergebenen Explosionsradius.
   */
  private spawnDotAreaFromExplosion(
    dot: import('../../types').DamageOverTimeAreaConfig | undefined,
    x: number, y: number,
    explosionRadius: number,
    ownerId: string,
    ownerColor: number,
  ): void {
    if (!dot || dot.damagePerTick <= 0 || dot.durationMs <= 0) return;
    this.ctx.stinkCloudSystem.hostCreateStationaryCloud(
      ownerId, ownerColor, x, y,
      explosionRadius * (dot.radiusScale ?? 1),
      dot.durationMs, dot.damagePerTick, dot.tickIntervalMs,
      dot.rockDamageMult ?? 1, dot.trainDamageMult ?? 1,
      dot.baseDamageMult ?? 1,
      dot.style,
    );
  }

  /**
   * Brutbombe des Wurf-Dachses: statt einer Explosion entstehen am Einschlagsort neue Gegner,
   * die sofort ihrem eigenen Bewegungsziel (Spieler) folgen.
   *
   * Hat ein Spieler die Bombe an seiner Reflexkuppel abgefangen, gehört sie ihm – die Brut
   * schlüpft dann als sein Verbündeter und verhält sich wie ein per Nekromantie wiederbelebter
   * Dachs (siehe NecromancySystem.captureAlly).
   */
  private spawnEnemiesFromGrenade(
    x: number, y: number,
    effect: import('../../types').SpawnEnemyGrenadeEffect,
    ownerId: string,
  ): void {
    const enemyManager = this.ctx.enemyManager;
    if (!enemyManager || !hasCoopDefenseEnemyKind(effect.enemyKind)) return;
    const capturedByPlayer = this.ctx.playerManager.getPlayer(ownerId) !== undefined;
    const originId = capturedByPlayer ? undefined : enemyManager.getEnemy(ownerId)?.originId;

    const baseAngle = Phaser.Math.RND.realInRange(0, Math.PI * 2);
    for (let index = 0; index < effect.count; index += 1) {
      const angle = baseAngle + index * (Math.PI * 2 / Math.max(1, effect.count));
      const spawnX = x + Math.cos(angle) * effect.offsetPx;
      const spawnY = y + Math.sin(angle) * effect.offsetPx;
      // Scheitert die Übernahme (Abfänger inzwischen tot), schlüpft die Brut regulär feindlich –
      // die Bombe soll nicht stillschweigend verpuffen.
      const captured = capturedByPlayer
        ? this.ctx.necromancySystem?.captureAlly(ownerId, spawnX, spawnY, effect.enemyKind) ?? null
        : null;
      if (!captured) {
        enemyManager.hostSpawnAtWorld(
          spawnX,
          spawnY,
          effect.enemyKind,
          originId ? { originId } : undefined,
        );
      }
    }
    bridge.broadcastExplosionEffect(x, y, effect.offsetPx * 2, effect.color, 'brood_hatch');
  }

  applyExplosionEnvironmentDamage(
    x: number, y: number,
    effect: import('../../types').ProjectileExplosionConfig,
    attackerId: string,
  ): void {
    const arenaResult = this.ctx.arenaResult;
    const rockMult  = effect.rockDamageMult  ?? 1;
    const trainMult = effect.trainDamageMult ?? 1;

    if (rockMult !== 0 && arenaResult) {
      applyRadialEnvironmentDamage(
        this.environmentRockSink,
        {
          x,
          y,
          radius: effect.radius,
          damage: effect.maxDamage,
          rockDamageMult: rockMult,
          falloff: resolveProjectileExplosionFalloff(effect),
        },
        attackerId,
        false,
      );
    }

    if (trainMult !== 0 && this.ctx.trainManager) {
      const trainState = this.ctx.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        let minDist = Infinity;
        for (const seg of this.ctx.trainManager.getSegObjects()) {
          if (!seg.active) continue;
          const b  = seg.getBounds();
          const dx = Math.max(b.left - x, 0, x - b.right);
          const dy = Math.max(b.top  - y, 0, y - b.bottom);
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d < minDist) minDist = d;
        }
        if (minDist <= effect.radius) {
          const damage = Math.round(computeProjectileExplosionDamage(minDist, effect) * trainMult);
          if (damage > 0) this.ctx.trainManager.applyDamage(damage, attackerId);
        }
      }
    }
  }

  applyNukeEnvironmentDamage(x: number, y: number, radius: number, triggeredBy: string): void {
    const arenaResult = this.ctx.arenaResult;
    const rockMult:  number = NUKE_CONFIG.rockDamageMult;
    const trainMult: number = NUKE_CONFIG.trainDamageMult;

    if (rockMult !== 0 && arenaResult) {
      applyRadialEnvironmentDamage(
        this.environmentRockSink,
        {
          x,
          y,
          radius,
          damage: NUKE_CONFIG.maxDamage,
          rockDamageMult: rockMult,
          falloff: { minDamage: NUKE_CONFIG.minDamage },
        },
        triggeredBy,
        false,
      );
    }

    if (trainMult !== 0 && this.ctx.trainManager) {
      const trainState = this.ctx.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        let minDist = Infinity;
        for (const seg of this.ctx.trainManager.getSegmentPositions()) {
          const d = Phaser.Math.Distance.Between(x, y, seg.x, seg.y);
          if (d < minDist) minDist = d;
        }
        if (minDist <= radius) {
          const baseDmg = computeRadialDamage(minDist, radius, NUKE_CONFIG.maxDamage, { minDamage: NUKE_CONFIG.minDamage });
          this.ctx.trainManager.applyDamage(Math.round(baseDmg * trainMult), triggeredBy);
        }
      }
    }
  }

  applyAirstrikeEnvironmentDamage(
    x:           number,
    y:           number,
    radius:      number,
    cfg:         AirstrikeUltimateConfig,
    triggeredBy: string,
  ): void {
    const arenaResult = this.ctx.arenaResult;
    const falloff = { minDamage: cfg.minDamage };
    const isEnemyAirstrike = triggeredBy === COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID;

    // Spieler-Schaden
    this.ctx.combatSystem.applyAoeDamage(x, y, radius, cfg.maxDamage, triggeredBy, cfg.selfDamageMult > 0, {
      category:       'explosion',
      sourceId:     'environment.airstrike',
      sourceSlot:     'ultimate',
      allowTeamDamage: cfg.allowTeamDamage,
      selfDamageMult:  cfg.selfDamageMult,
      damageFalloff:   falloff,
      skipEnemies:     cfg.skipEnemyDamage,
      baseDamageMult:  isEnemyAirstrike ? 0 : (cfg.baseDamageMult ?? 1),
    });

    // Legacy-Semantik: Zombie-/Map-Luftangriffe treffen nur die eigenen Basen.
    if ((cfg.friendlyBaseDamageMult ?? 0) > 0 && this.ctx.baseManager) {
      // Zombie-Luftangriffe treffen nur eigene Basen.
      for (const base of this.ctx.baseManager.getBasesByFaction('friendly')) {
        if (base.isInert?.() === true) continue;
        let minDist = Infinity;
        for (const cell of base.getCellBodies()) {
          const b  = cell.getBounds();
          const dx = Math.max(b.left - x, 0, x - b.right);
          const dy = Math.max(b.top  - y, 0, y - b.bottom);
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d < minDist) minDist = d;
        }
        if (minDist > radius) continue;
        const baseDmg = computeRadialDamage(minDist, radius, cfg.maxDamage, falloff);
        if (baseDmg > 0) {
          this.ctx.combatSystem.applyBaseDamage(
            base.id, baseDmg, triggeredBy, undefined, cfg.friendlyBaseDamageMult,
          );
        }
      }
    }

    // Felsen-Schaden
    if (cfg.rockDamageMult !== 0 && arenaResult) {
      applyRadialEnvironmentDamage(
        this.environmentRockSink,
        { x, y, radius, damage: cfg.maxDamage, rockDamageMult: cfg.rockDamageMult, falloff },
        triggeredBy,
        false,
      );
    }

    // Zug-Schaden
    if (cfg.trainDamageMult !== 0 && this.ctx.trainManager) {
      const trainState = this.ctx.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        let minDist = Infinity;
        for (const seg of this.ctx.trainManager.getSegmentPositions()) {
          const d = Phaser.Math.Distance.Between(x, y, seg.x, seg.y);
          if (d < minDist) minDist = d;
        }
        if (minDist <= radius) {
          const baseDmg = computeRadialDamage(minDist, radius, cfg.maxDamage, falloff);
          this.ctx.trainManager.applyDamage(Math.round(baseDmg * cfg.trainDamageMult), triggeredBy);
        }
      }
    }
  }

  /**
   * Gemeinsamer Gameplay-Resolver für alle radialen Projektil-Pulse.
   * BFG-Spielerziele bleiben bewusst außerhalb dieses Coop-Pfades.
   */
  resolveProjectileProximityPulse(proj: TrackedProjectile): { lines: { sx: number; sy: number; ex: number; ey: number }[] } {
    const config = proj.proximityPulse;
    const lines: { sx: number; sy: number; ex: number; ey: number }[] = [];
    if (!config || config.radius <= 0 || config.damage <= 0) return { lines };

    const originX = proj.sprite.x;
    const originY = proj.sprite.y;
    const radiusSquared = config.radius * config.radius;
    const lineTo = (x: number, y: number) => ({ sx: originX, sy: originY, ex: x, ey: y });

    // Nur feindliche Coop-Gegner sind gemeinsame Pulsziele. Die Faction-Regel
    // bleibt im CombatSystem; insbesondere allied/captured Enemies werden hier
    // nicht über getAllEnemies() blind beschädigt.
    for (const enemy of this.ctx.enemyManager?.getAllEnemies() ?? []) {
      if (!enemy.sprite.active || enemy.getHp() <= 0) continue;
      if (!this.ctx.combatSystem.canDamageTarget(proj.ownerId, enemy.id)) continue;
      if (Phaser.Math.Distance.Squared(originX, originY, enemy.sprite.x, enemy.sprite.y) > radiusSquared) continue;
      if (!this.ctx.combatSystem.hasLineOfSight(originX, originY, enemy.sprite.x, enemy.sprite.y)) continue;

      this.ctx.combatSystem.applyDamage(enemy.id, config.damage, false, proj.ownerId, proj.isBfg ? 'BFG' : 'ASMD Kugelgewitter', {
        sourceX: originX,
        sourceY: originY,
      }, {
        damageKind: 'direct',
      });
      lines.push(lineTo(enemy.sprite.x, enemy.sprite.y));
    }

    const arenaResult = this.ctx.arenaResult;
    if (arenaResult) {
      this.forEachArenaRockInRadius(originX, originY, config.radius, (i, rock) => {
        if (Phaser.Math.Distance.Squared(originX, originY, rock.x, rock.y) > radiusSquared) return;
        if (!this.ctx.combatSystem.hasLineOfSight(originX, originY, rock.x, rock.y, i)) return;
        const resolvedDamage = this.resolveObstacleDamage(
          i,
          config.damage * (proj.rockDamageMult ?? 1),
          proj.ownerId,
        );
        if (resolvedDamage <= 0) return;
        const newHp = this.rockVisualHelper.applyObstacleDamageById(i, resolvedDamage, proj.ownerId);
        if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(i, 'damage');
        lines.push(lineTo(rock.x, rock.y));
      });
    }

    const trainMult = proj.trainDamageMult ?? 1;
    if (trainMult !== 0 && this.ctx.trainManager) {
      const trainState = this.ctx.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        for (const seg of this.ctx.trainManager.getSegmentPositions()) {
          if (Phaser.Math.Distance.Squared(originX, originY, seg.x, seg.y) > radiusSquared) continue;
          if (!this.ctx.combatSystem.hasLineOfSight(originX, originY, seg.x, seg.y)) continue;
          this.ctx.trainManager.applyDamage(config.damage * trainMult, proj.ownerId);
          lines.push(lineTo(seg.x, seg.y));
          break;
        }
      }
    }

    return { lines };
  }

  /** BFG-only extension: preserve its existing player/friendly-fire pulse. */
  resolveBfgPlayerProximityPulse(proj: TrackedProjectile): { sx: number; sy: number; ex: number; ey: number }[] {
    const config = proj.proximityPulse;
    if (!config || config.radius <= 0 || config.damage <= 0) return [];
    const originX = proj.sprite.x;
    const originY = proj.sprite.y;
    const radiusSquared = config.radius * config.radius;
    const lines: { sx: number; sy: number; ex: number; ey: number }[] = [];

    for (const player of this.ctx.playerManager.getAllPlayers()) {
      if (player.id === proj.ownerId) continue;
      if (!this.ctx.combatSystem.isAlive(player.id)) continue;
      if (this.ctx.burrowSystem?.isBurrowed(player.id)) continue;
      if (Phaser.Math.Distance.Squared(originX, originY, player.x, player.y) > radiusSquared) continue;
      if (!this.ctx.combatSystem.hasLineOfSight(originX, originY, player.x, player.y)) continue;
      if (!this.ctx.combatSystem.canDamageTarget(proj.ownerId, player.id, proj.allowTeamDamage)) continue;
      if (this.ctx.energyShieldSystem?.tryBlockDamage({
        targetId: player.id,
        category: 'hitscan',
        damage: config.damage,
        sourceX: originX,
        sourceY: originY,
        now: Date.now(),
      })) continue;

      this.ctx.combatSystem.applyDamage(player.id, config.damage, false, proj.ownerId, 'BFG', {
        sourceX: originX,
        sourceY: originY,
      }, {
        allowTeamDamage: proj.allowTeamDamage,
        damageKind: 'direct',
      });
      lines.push({ sx: originX, sy: originY, ex: player.x, ey: player.y });
    }
    return lines;
  }

  applyTeslaRockDamage(index: number, damage: number, ownerId: string): void {
    if (!this.ctx.arenaResult || !this.ctx.currentLayout) return;
    const resolvedDamage = this.resolveObstacleDamage(index, damage, ownerId);
    if (resolvedDamage <= 0) return;
    const newHp = this.rockVisualHelper.applyObstacleDamageById(index, resolvedDamage, ownerId);
    if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(index, 'damage');
  }

  applyTeslaTurretDamage(id: number, damage: number, ownerId: string): void {
    const resolvedDamage = this.resolveObstacleDamage(id, damage, ownerId);
    if (resolvedDamage <= 0) return;
    const newHp = this.rockVisualHelper.applyObstacleDamageById(id, resolvedDamage, ownerId);
    if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(id, 'damage');
  }

  /**
   * Gameplay-Seite der gemeinsamen Detonationsverarbeitung: autoritativer Schaden, Rückstoß,
   * Umgebungsschaden und der replizierte Explosionskanal.
   */
  private readonly detonationEffectSink: DetonationEffectSink = {
    addComboAdrenaline: (ownerId, amount) => {
      this.ctx.resourceSystem?.addAdrenaline(ownerId, amount);
    },
    applyAoeDamage: (x, y, radius, damage, attackerId, falloff, baseDamageMult, sourceSlot) => {
      this.ctx.combatSystem.applyAoeDamage(x, y, radius, damage, attackerId, false, {
        category: 'explosion',
        sourceId: 'environment.detonation',
        damageFalloff: falloff,
        baseDamageMult,
        sourceSlot,
      });
    },
    applyRadialImpulse: (x, y, radius, force, attackerId, selfMultiplier) => {
      this.ctx.hostPhysics.applyRadialImpulse(x, y, radius, force, attackerId, selfMultiplier);
    },
    applyEnvironmentDamage: (x, y, radius, damage, rockMult, trainMult, attackerId, falloff) => {
      this.applyAoeEnvironmentDamage(x, y, radius, damage, rockMult, trainMult, attackerId, falloff);
    },
    playExplosion: (x, y, radius, color, visualStyle) => {
      bridge.broadcastExplosionEffect(x, y, radius, color, visualStyle);
    },
    // Optionale Schaden-über-Zeit-Fläche am Detonationsort (z.B. ASMD-Sekundär-Upgrade).
    spawnDotArea: (dot, x, y, explosionRadius, ownerId, ownerColor) => {
      this.spawnDotAreaFromExplosion(dot, x, y, explosionRadius, ownerId, ownerColor);
    },
    resolveOwnerColor: (ownerId) => bridge.getPlayerColor(ownerId),
  };

  /**
   * Gameplay-Seite des gemeinsamen Umgebungsschaden-Kerns: runden-autoritativer Felsbestand,
   * Zielstatus-Trichter und die replizierte Zerstörungsdarstellung.
   */
  private readonly environmentRockSink: EnvironmentRockSink = {
    forEachRockInRadius: (x, y, radius, visit) => {
      this.forEachArenaRockInRadius(x, y, radius, (index, rock) => {
        visit(index, rock.x, rock.y);
      });
    },
    resolveRockDamage: (index, damage, attackerId) => this.resolveObstacleDamage(index, damage, attackerId),
    applyRockDamage: (index, damage, attackerId) => this.rockVisualHelper.applyObstacleDamageById(index, damage, attackerId),
    onRockDestroyed: (index) => this.rockVisualHelper.handleDestroyedRock(index, 'damage'),
  };

  /** Alle autoritaeren Hindernis-/Konstruktpfade teilen denselben Zielstatus-Trichter. */
  private resolveObstacleDamage(index: number, damage: number, attackerId: string): number {
    const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(index);
    return this.ctx.combatSystem.resolveExternalTargetDamage(
      {
        targetType: runtimeRock?.constructionId ? 'construction' : 'rock',
        targetId: String(index),
      },
      damage,
      attackerId,
    );
  }

  /** Host-authoritative Kontextwirkung eines Plasmabrenner-Hitscans. */
  applyHitscanSupportImpact(
    impact: HitscanSupportImpact,
    effect: HitscanSupportEffect,
    attackerId: string,
    sourceSlot?: LoadoutSlot,
  ): void {
    if (impact.targetType === 'player') {
      // CombatSystem hat die Heilung bereits angewendet; hier wird nur der replizierte
      // Regenerationsimpuls erzeugt. Friendly Fire kann so auch bei fehlerhaften Clients
      // nicht aus dem VFX-Pfad entstehen.
      if (!bridge.isEnemyPair(attackerId, impact.targetId)) {
        this.emitRegenerationEffect(impact.x, impact.y, effect.beamColor);
      }
      return;
    }

    this.applySupportStructureImpact(
      attackerId,
      impact.targetType,
      impact.targetId,
      impact.x,
      impact.y,
      effect,
      sourceSlot,
    );
  }

  private applySupportStructureImpact(
    attackerId: string,
    targetType: 'rock' | 'base',
    targetId: string,
    x: number,
    y: number,
    effect: HitscanSupportEffect,
    sourceSlot?: LoadoutSlot,
  ): void {
    if (targetType === 'rock') {
      const rockId = Number(targetId);
      if (!Number.isInteger(rockId) || rockId < 0) return;
      const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(rockId);
      if (!runtimeRock) {
        const healed = this.rockVisualHelper.applyObstacleRepairById(rockId, effect.healPerHit);
        if (healed > 0) this.emitRegenerationEffect(x, y, effect.beamColor);
        return;
      }

      if (!bridge.isEnemyPair(attackerId, runtimeRock.ownerId)) {
        const healed = this.rockVisualHelper.applyObstacleRepairById(rockId, effect.healPerHit);
        if (healed > 0) this.emitRegenerationEffect(x, y, effect.beamColor);
        return;
      }

      if (effect.damagePerHit <= 0) return;
      const resolvedDamage = this.ctx.combatSystem.resolveExternalTargetDamage(
        {
          targetType: runtimeRock.constructionId ? 'construction' : 'rock',
          targetId: String(runtimeRock.id),
        },
        effect.damagePerHit,
        attackerId,
        sourceSlot,
      );
      const newHp = this.rockVisualHelper.applyObstacleDamageById(rockId, resolvedDamage, attackerId);
      if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(rockId, 'damage', attackerId);
      return;
    }

    const base = this.ctx.baseManager?.getBase(targetId) ?? this.findNearestBase(x, y);
    if (!base || base.isInert?.() === true || base.getHp() <= 0) return;
    if (base.faction === 'friendly') {
      const healed = this.healBase(base.id, effect.healPerHit);
      if (healed > 0) this.emitRegenerationEffect(x, y, effect.beamColor);
    } else if (effect.damagePerHit > 0) {
      // Basisschaden geht ausschliesslich ueber den zentralen Basistrichter, damit
      // Verwundbarkeit, Matrixschutz und ausgehende Modifikatoren gleich greifen.
      this.ctx.combatSystem.applyBaseDamage(
        base.id,
        effect.damagePerHit,
        attackerId,
        sourceSlot,
        effect.baseDamageMult ?? 1,
      );
    }
  }

  /**
   * Hindernistreffer eines Energieinjektor-Projektils.
   * Wird vom `ProjectileManager` aus dem Fels- bzw. Basis-Collider gemeldet, weil nur dort
   * bekannt ist, welches Hindernis getroffen wurde.
   *
   * Der Energieinjektor sucht am Einschlagsort einen Turm: bei Felstreffern ist das die
   * getroffene Konstruktion selbst, bei Basistreffern der naechstgelegene Basisturm.
   */
  applySupportProjectileImpact(projectile: TrackedProjectile, impact: SupportProjectileImpact): void {
    const injector = projectile.energyInjectorPayload;
    if (injector) {
      if (impact.kind === 'rock') {
        const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(impact.rockId);
        if (!runtimeRock) return; // Statische Felsen/Mauern sind absichtlich immun.
        const isHostile = bridge.isEnemyPair(projectile.ownerId, runtimeRock.ownerId);
        if (isHostile) {
          this.applyEnergyInjectorTargetHit('construction', String(runtimeRock.id), impact.x, impact.y, projectile);
          return;
        }
        const definition = runtimeRock.constructionId
          ? getCoopDefenseConstructionDefinition(runtimeRock.constructionId)
          : null;
        const world = this.rockVisualHelper.gridToWorld(runtimeRock.gridX, runtimeRock.gridY);
        const energyInjectorEffect = runtimeRock.energyInjectorEffect ?? definition?.energyInjectorEffect;
        if (!energyInjectorEffect) return;
        this.ctx.energyInjectorSystem?.applyConstructionEffect(
          String(runtimeRock.id),
          projectile.ownerId,
          world.x,
          world.y,
          energyInjectorEffect,
          injector,
          Date.now(),
        );
        return;
      }

      const base = this.findNearestBase(impact.x, impact.y);
      if (base?.faction === 'hostile') {
        this.applyEnergyInjectorTargetHit('base', base.id, impact.x, impact.y, projectile);
      }
      return;
    }

  }

  /** Matrix-verwundbarkeit wird als normaler Zielstatus bis zum Feldende erneuert. */
  private refreshMatrixVulnerabilities(now: number): void {
    const matrixSystem = this.ctx.reinforcementMatrixSystem;
    const statusSystem = this.ctx.targetStatusSystem;
    if (!matrixSystem || !statusSystem) return;

    const applyFromFootprint = (
      target: { targetType: 'player' | 'enemy' | 'base' | 'construction'; targetId: string },
      footprint: TargetFootprint,
      fieldApplies: (field: SyncedReinforcementMatrix) => boolean = () => true,
    ): void => {
      let expiresAt = 0;
      for (const field of matrixSystem.getOverlappingMatrices(footprint, now)) {
        if (!fieldApplies(field)) continue;
        if (field.vulnerabilityBonus <= 0) continue;
        expiresAt = Math.max(expiresAt, field.expiresAt);
      }
      if (expiresAt > now) statusSystem.applyVulnerability(target, expiresAt - now, now);
    };

    for (const player of this.ctx.playerManager.getAllPlayers()) {
      if (!this.ctx.combatSystem.isAlive(player.id)) continue;
      const bounds = player.getBounds();
      applyFromFootprint(
        { targetType: 'player', targetId: player.id },
        { x: bounds.centerX, y: bounds.centerY, width: bounds.width, height: bounds.height },
        (field) => bridge.isEnemyPair(field.ownerId, player.id),
      );
    }

    for (const enemy of this.ctx.enemyManager?.getAllEnemies() ?? []) {
      if (!enemy.sprite.active || enemy.getHp() <= 0) continue;
      const bounds = enemy.sprite.getBounds();
      applyFromFootprint(
        { targetType: 'enemy', targetId: enemy.id },
        { x: bounds.centerX, y: bounds.centerY, width: bounds.width, height: bounds.height },
      );
    }

    for (const base of this.ctx.baseManager?.getBasesByFaction('hostile') ?? []) {
      if (base.isInert?.() === true || base.getHp() <= 0) continue;
      const footprint = this.getBaseFootprint(base);
      if (footprint) applyFromFootprint({ targetType: 'base', targetId: base.id }, footprint);
    }

    for (const base of this.ctx.baseManager?.getBases() ?? []) {
      base.setVulnerable(statusSystem.isVulnerable({ targetType: 'base', targetId: base.id }, now));
    }

    for (const rock of this.ctx.placementSystem?.getAllRuntimeRocks() ?? []) {
      if (!rock.constructionId) continue;
      const world = this.rockVisualHelper.gridToWorld(rock.gridX, rock.gridY);
      const overlapping = matrixSystem.getOverlappingMatrices(
        { x: world.x, y: world.y, width: CELL_SIZE, height: CELL_SIZE },
        now,
      ).some((field) => bridge.isEnemyPair(field.ownerId, rock.ownerId));
      if (overlapping) {
        applyFromFootprint(
          { targetType: 'construction', targetId: String(rock.id) },
          { x: world.x, y: world.y, width: CELL_SIZE, height: CELL_SIZE },
          (field) => bridge.isEnemyPair(field.ownerId, rock.ownerId),
        );
      }
    }
  }

  private getBaseFootprint(base: ReturnType<BaseManager['getBases']>[number]): TargetFootprint | null {
    const parts = base.getCellBodies().map((body) => {
      const bounds = body.getBounds();
      return {
        x: bounds.centerX,
        y: bounds.centerY,
        width: bounds.width,
        height: bounds.height,
      } satisfies TargetFootprint;
    });
    if (parts.length === 0) return null;

    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const part of parts) {
      left = Math.min(left, part.x - part.width / 2);
      top = Math.min(top, part.y - part.height / 2);
      right = Math.max(right, part.x + part.width / 2);
      bottom = Math.max(bottom, part.y + part.height / 2);
    }
    return {
      x: (left + right) * 0.5,
      y: (top + bottom) * 0.5,
      width: right - left,
      height: bottom - top,
      parts,
    };
  }

  /** Heilt die dem Einschlag naechstgelegene lebende Basis; liefert die zugefuehrten HP. */
  private healBaseNear(x: number, y: number, amount: number): number {
    const base = this.findNearestBase(x, y, 'friendly');
    return base ? this.healBase(base.id, amount) : 0;
  }

  private findNearestBase(
    x: number,
    y: number,
    faction?: 'friendly' | 'hostile',
  ): ReturnType<BaseManager['getBases']>[number] | undefined {
    let bestBase: ReturnType<BaseManager['getBases']>[number] | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const base of faction
      ? (this.ctx.baseManager?.getBasesByFaction(faction) ?? [])
      : (this.ctx.baseManager?.getBases() ?? [])) {
      if (base.isInert?.() === true || base.getHp() <= 0) continue;
      const surface = base.getNearestSurfacePoint(x, y);
      if (!surface || surface.distance >= bestDistance) continue;
      bestBase = base;
      bestDistance = surface.distance;
    }
    return bestBase;
  }

  private healBase(baseId: string, amount: number): number {
    if (amount <= 0) return 0;
    const base = this.ctx.baseManager?.getBase(baseId);
    if (!base || base.isInert?.() === true || base.getHp() <= 0) return 0;
    const before = base.getHp();
    this.ctx.baseManager?.heal(baseId, amount);
    return base.getHp() - before;
  }

  applyEnergyInjectorTargetHit(
    targetType: 'player' | 'enemy' | 'construction' | 'base',
    targetId: string,
    x: number,
    y: number,
    projectile: TrackedProjectile,
  ): void {
    const payload = projectile.energyInjectorPayload;
    if (!payload || !this.ctx.targetStatusSystem) return;
    const now = Date.now();
    const target = { targetType, targetId } as const;
    this.ctx.targetStatusSystem.applyVulnerability(target, payload.durationMs, now);
    if (targetType === 'enemy' || targetType === 'base') {
      this.ctx.energyInjectorSystem?.setFocusTarget(
        projectile.ownerId,
        target,
        payload.focusDurationMs ?? payload.durationMs,
        now,
      );
    }
    bridge.broadcastExplosionEffect(x, y, 18, payload.color, 'energy');
  }

  private findTurretById(turretId: AutomatedTurretId): AutomatedTurret | undefined {
    return this.ctx.turretSystem?.getTurrets().find((turret) => turret.id === turretId);
  }

  private findNearestTurret(x: number, y: number, maxDistance: number): AutomatedTurret | undefined {
    let best: AutomatedTurret | undefined;
    let bestDistanceSq = maxDistance * maxDistance;
    for (const turret of this.ctx.turretSystem?.getTurrets() ?? []) {
      const dx = turret.x - x;
      const dy = turret.y - y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > bestDistanceSq) continue;
      best = turret;
      bestDistanceSq = distanceSq;
    }
    return best;
  }

  /**
   * HUD-Balken der Kinetischen Ladung.
   *
   * Als regulaerer `SyncedActiveHudBuff` ausgegeben und in dieselbe Liste gehaengt wie die
   * AK-47- und Negev-Buffs: dadurch erscheint der Balken ueber `publishActiveBuffs` auch bei
   * Clients, ohne dass dort etwas angepasst werden muss.
   */
  private getMovementChargeHudBuffs(playerId: string): SyncedActiveHudBuff[] {
    const runtime = this.ctx.coopDefenseItemRuntimeSystem;
    if (!runtime) return [];
    const bonus = this.ctx.coopDefensePlayerModifierSystem?.getItemAffixValue(playerId, 'movement_charge_damage') ?? 0;
    if (bonus <= 0) return [];
    const charged = runtime.hasMovementCharge(playerId);
    return [{
      defId: 'MOVEMENT_CHARGE',
      remainingFrac: runtime.getMovementChargeProgress(playerId),
      value: bonus,
      charged,
      intensity: charged ? 1 : 0.35,
    }];
  }

  private getGlutwandererHudBuffs(playerId: string): SyncedActiveHudBuff[] {
    const runtime = this.ctx.coopDefenseItemRuntimeSystem;
    const value = this.ctx.coopDefensePlayerModifierSystem?.getItemAffixValue(playerId, 'glutwanderer') ?? 0;
    if (!runtime || value <= 0) return [];
    return [{
      defId: 'GLUTWANDERER',
      remainingFrac: runtime.getGlutwandererProgress(playerId),
      count: runtime.getGlutwandererChunkCount(playerId),
      intensity: 0.35 + runtime.getGlutwandererProgress(playerId) * 0.65,
    }];
  }

  private getSurroundedHudBuffs(playerId: string, now: number): SyncedActiveHudBuff[] {
    const runtime = this.ctx.coopDefenseItemRuntimeSystem;
    const value = this.ctx.coopDefensePlayerModifierSystem?.getItemAffixValue(playerId, 'surrounded') ?? 0;
    if (!runtime || value <= 0 || !runtime.isSurrounded(playerId, now)) return [];
    return [{
      defId: 'SURROUNDED',
      remainingFrac: 1,
      value,
      intensity: 1,
    }];
  }

  private getTeamBuffHudBuff(playerId: string, now: number): SyncedActiveHudBuff | null {
    return this.ctx.coopDefenseTeamBuffSystem?.getHudBuff(
      now,
      bridge.canPlayerReceiveRoundRewards(playerId),
      this.ctx.combatSystem.isAlive(playerId),
    ) ?? null;
  }

  private emitRegenerationEffect(x: number, y: number, color: number): void {
    bridge.broadcastExplosionEffect(x, y, SUPPORT_REGENERATION_EFFECT_RADIUS, color, 'regeneration');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private applyDashVisual(player: PlayerEntity, id: string, curPhase: number, setScale = true): void {
    if (curPhase === 1) {
      if (setScale) player.setDashScale(0.5);
      const now = this.scene.time.now;
      const nextGhost = this.dashTrailTimers.get(id) ?? 0;
      if (now >= nextGhost) {
        this.effects?.playDashTrailGhost(player.x, player.y, player.color, 0.5, player.rotation);
        this.dashTrailTimers.set(id, now + 50);
      }
    } else if (curPhase === 2) {
      if (setScale) {
        const p2Start = this.dashPhase2StartTimes.get(id);
        const t = p2Start !== undefined
          ? Math.min(1, (this.scene.time.now - p2Start) / (DASH_T2_S * 1000))
          : 1;
        player.setDashScale(0.5 + 0.5 * t * t);
      }
    } else if (setScale) {
      player.setDashScale(1.0);
    }
  }

  private applyBurrowVisual(player: PlayerEntity, phase: import('../../types').BurrowPhase): void {
    const previousPhase = this.prevBurrowPhases.get(player.id) ?? 'idle';
    const shouldAnimate = previousPhase !== phase
      && ((phase === 'windup' && previousPhase === 'idle')
        || (phase === 'recovery' && (previousPhase === 'underground' || previousPhase === 'trapped')));

    // Burrow loop: start when entering underground, stop when leaving
    if (phase === 'underground' && previousPhase !== 'underground') {
      const handle = this.audio?.startLoop('sfx_burrowed', player.x, player.y, player.id);
      if (handle) this.burrowLoopHandles.set(player.id, handle);
    } else if (phase !== 'underground' && previousPhase === 'underground') {
      const handle = this.burrowLoopHandles.get(player.id);
      if (handle) { this.audio?.stopLoop(handle); this.burrowLoopHandles.delete(player.id); }
    } else if (phase === 'underground') {
      const handle = this.burrowLoopHandles.get(player.id);
      if (handle) this.audio?.updateLoopPosition(handle, player.x, player.y, player.id);
    }

    if (shouldAnimate) {
      this.effects?.playBurrowPhaseEffect(player.x, player.y, phase);
    }
    player.setBurrowPhase(phase, shouldAnimate);
    if (player.displayObject) this.effects?.syncBurrowState(player.id, phase, player.displayObject);
    this.prevBurrowPhases.set(player.id, phase);
  }

  private checkLocalPickup(powerups: import('../../types').SyncedPowerUp[]): void {
    const localId = bridge.getLocalPlayerId();
    const player  = this.ctx.playerManager.getPlayer(localId);
    if (!player || !player.active) return;
    if (this.ctx.burrowSystem?.isBurrowed(localId)) return;

    const px = player.x;
    const py = player.y;

    for (const pu of powerups) {
      if (pu.pickupKind === 'objective-marker') continue;
      const dist = Phaser.Math.Distance.Between(px, py, pu.x, pu.y);
      if (dist <= PICKUP_RADIUS * 2) {
        this.ctx.powerUpSystem?.tryPickup(localId, pu.uid, px, py);
        return;
      }
    }
  }

  /**
   * Sammelt die Ziel-Eingaben aller Flowfields und uebergibt sie dem Coordinator. Gerechnet und
   * aktiviert wird ausschliesslich an dessen Nav-Ticks; dieser Aufruf bleibt pro Frame billig.
   *
   * `deltaMs` treibt den Nav-Takt. `force` ist der Arena-Erstaufbau: Dort wird einmalig synchron
   * gerechnet, damit der erste Gameplay-Frame vollstaendige Felder vorfindet.
   */
  private updateEnemyFlowFields(now: number, deltaMs: number, force = false): void {
    const flowFieldCoordinator = this.ctx.flowFieldCoordinator;
    const playerFlowFieldService = this.ctx.enemyPlayerFlowFieldService;
    const bossFlowFieldService = this.ctx.enemyBossFlowFieldService;
    const strategicFlowFieldService = this.ctx.enemyStrategicFlowFieldService;
    const strategicTargetService = this.ctx.enemyStrategicTargetService;

    const targetCatalog = this.ctx.enemyAiTargetCatalog;
    const strategicGrid = strategicFlowFieldService ?? playerFlowFieldService;
    if (targetCatalog) {
      const candidates: EnemyAiTargetCandidate[] = [];
      for (const player of this.ctx.playerManager.getAllPlayers()) {
        const goal = strategicGrid?.worldToGrid(player.x, player.y);
        candidates.push({
          kind: 'player',
          id: player.id,
          x: player.x,
          y: player.y,
          goalCells: goal ? [goal] : [],
          resolvePosition: () => {
            const current = this.ctx.playerManager.getPlayer(player.id);
            return current ? { x: current.x, y: current.y } : null;
          },
          isTargetable: () => (
            player.active
            && this.ctx.combatSystem.isAlive(player.id)
            && !(this.ctx.burrowSystem?.isBurrowed(player.id) ?? false)
            && !this.ctx.decoySystem.isStealthed(player.id)
          ),
        });
      }

      for (const decoy of this.ctx.decoySystem.getHostTargets()) {
        const goal = strategicGrid?.worldToGrid(decoy.sprite.x, decoy.sprite.y);
        candidates.push({
          kind: 'decoy',
          id: String(decoy.id),
          ownerId: decoy.ownerId,
          x: decoy.sprite.x,
          y: decoy.sprite.y,
          radius: Math.max(decoy.sprite.displayWidth, decoy.sprite.displayHeight) * 0.5,
          goalCells: goal ? [goal] : [],
          resolvePosition: () => {
            const current = this.ctx.decoySystem.getHostTarget(decoy.id);
            return current ? { x: current.sprite.x, y: current.sprite.y } : null;
          },
          isTargetable: () => this.ctx.decoySystem.getHostTarget(decoy.id) !== null,
        });
      }

      if (strategicFlowFieldService) {
        for (const construction of this.ctx.placementSystem?.getAllRuntimeRocks() ?? []) {
          if (construction.hp <= 0 || construction.kind !== 'turret') continue;
          const world = strategicFlowFieldService.gridToWorld(construction.gridX, construction.gridY);
          if (!world) continue;
          candidates.push({
            kind: 'armed-construct',
            id: String(construction.id),
            x: world.x,
            y: world.y,
            goalCells: this.buildAdjacentGoalCells([{ gridX: construction.gridX, gridY: construction.gridY }]),
            isTargetable: () => construction.hp > 0,
          });
        }

        for (const base of this.ctx.baseManager?.getBasesByFaction('friendly') ?? []) {
          if (base.role !== 'outpost' || base.isInert?.() === true || base.getHp() <= 0 || base.getTurrets().length === 0) continue;
          const turret = base.getTurrets()[0];
          candidates.push({
            kind: 'armed-outpost',
            id: base.id,
            x: turret.x,
            y: turret.y,
            goalCells: this.buildAdjacentGoalCells(base.getSpec().cells),
            resolvePosition: (fromX, fromY) => {
              const surface = base.getNearestSurfacePoint(fromX, fromY);
              return surface ? { x: surface.x, y: surface.y } : null;
            },
            isTargetable: () => (
              base.isInert?.() !== true && base.getHp() > 0 && base.getTurrets().length > 0
            ),
          });
        }
      }
      targetCatalog.updateTargets(candidates);
      if (strategicFlowFieldService && strategicTargetService && flowFieldCoordinator) {
        // Zielzuordnung und Zielmenge reisen als ein Paket: Der Coordinator uebernimmt die
        // Zuordnung erst in dem Moment, in dem er das daraus gerechnete Feld aktiviert.
        const prepared = strategicTargetService.prepareTargets(targetCatalog.getStrategicCandidates());
        flowFieldCoordinator.setGoalCells(
          ENEMY_FLOW_FIELD_IDS.strategic,
          goalCellsToIndexes(prepared.goalCells, flowFieldCoordinator.metrics),
          prepared,
        );
      }
    }

    if (!flowFieldCoordinator) return;
    if (!playerFlowFieldService) {
      this.advanceFlowFields(flowFieldCoordinator, deltaMs, force);
      return;
    }

    const playerGoalCells: { gridX: number; gridY: number }[] = [];
    if (targetCatalog) {
      targetCatalog.forEachTarget('player-like', (target) => {
        const position = target.resolvePosition?.(0, 0) ?? { x: target.x, y: target.y };
        const goalCell = playerFlowFieldService.worldToGrid(position.x, position.y);
        if (!goalCell) return;
        playerGoalCells.push(goalCell);
      });
    } else {
      for (const player of this.ctx.playerManager.getAllPlayers()) {
        if (!player.active) continue;
        if (!this.ctx.combatSystem.isAlive(player.id)) continue;
        if (this.ctx.burrowSystem?.isBurrowed(player.id)) continue;
        if (this.ctx.decoySystem.isStealthed(player.id)) continue;
        const goalCell = playerFlowFieldService.worldToGrid(player.x, player.y);
        if (!goalCell) continue;
        playerGoalCells.push(goalCell);
      }
    }

    const playerGoalIndexes = goalCellsToIndexes(playerGoalCells, flowFieldCoordinator.metrics);
    flowFieldCoordinator.setGoalCells(ENEMY_FLOW_FIELD_IDS.player, playerGoalIndexes);
    if (bossFlowFieldService) {
      flowFieldCoordinator.setGoalCells(ENEMY_FLOW_FIELD_IDS.boss, playerGoalIndexes);
    }

    // Die Nekromantie setzt ihr gemeinsames Besitzer-Flowfield selbst auf den
    // aktuellen Gegner oder, beim Leash-Rueckzug, auf den Besitzer. Ein zweites
    // Ziel-Update hier wuerde das Angriffsziel jeden Frame wieder ueberschreiben.

    this.advanceFlowFields(flowFieldCoordinator, deltaMs, force);
  }

  private advanceFlowFields(
    flowFieldCoordinator: FlowFieldCoordinator,
    deltaMs: number,
    force: boolean,
  ): void {
    // Der Erstaufbau laeuft im verborgenen Ladezustand einmalig synchron durch denselben Kernel.
    if (force) flowFieldCoordinator.prepareNow();
    else flowFieldCoordinator.advance(deltaMs);
  }

  private buildAdjacentGoalCells(
    occupiedCells: readonly { gridX: number; gridY: number }[],
  ): { gridX: number; gridY: number }[] {
    const result: { gridX: number; gridY: number }[] = [];
    for (const cell of occupiedCells) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          result.push({ gridX: cell.gridX + dx, gridY: cell.gridY + dy });
        }
      }
    }
    return result;
  }

  private getLocalUtilityCooldownFrac(): number {
    const localId = bridge.getLocalPlayerId();
    const committed = bridge.getPlayerCommittedLoadout(localId);
    const hasOverride = bridge.getPlayerUtilityOverrideId(localId) !== '';
    if (!hasOverride && this.ctx.inputSystem.getSelectedInspectorUtilityActionForHud() !== null) return 0;
    const selected = hasOverride ? undefined : (this.ctx.inputSystem.getSelectedInspectorToolForHud()
      ?? committed?.coopDefenseProfile?.selectedTool);
    // Konstruktionen und Utilities laufen ueber denselben Cooldown-Kanal; nur die
    // Bezugsdauer unterscheidet sich.
    const fallbackConfig = this.ctx.loadoutManager?.getEquippedUtilityConfig(localId);
    const selectedConfigBase = selected?.kind === 'utility'
      ? getUtilityConfigForMode(selected.id, bridge.getArenaDescriptor()?.gameMode ?? bridge.getGameMode())
      : undefined;
    const selectedConfig = selectedConfigBase
      ? this.ctx.loadoutManager?.resolveUtilityConfig(localId, selectedConfigBase) ?? selectedConfigBase
      : undefined;
    const itemId = selected?.kind === 'construction'
      ? selected.id
      : (selectedConfig?.id ?? fallbackConfig?.id ?? '__default__');
    const cooldown = selected?.kind === 'construction'
      ? getCoopDefenseConstructionDefinition(selected.id).buildCooldownMs
      : selectedConfig?.cooldown ?? fallbackConfig?.cooldown ?? 0;
    if (cooldown <= 0) return 0;
    const remaining = bridge.getPlayerUtilityCooldownUntil(localId, itemId) - bridge.getSynchronizedNow();
    return remaining <= 0 ? 0 : Math.min(1, remaining / cooldown);
  }

  private getFallbackUltimateConfig() {
    return { id: 'HONEY_BADGER_RAGE', rageRequired: 300 };
  }

  private getDefaultAimState(isMoving: boolean): PlayerAimNetState {
    return { revision: 0, isMoving, weapon1DynamicSpread: 0, weapon2DynamicSpread: 0 };
  }
}
