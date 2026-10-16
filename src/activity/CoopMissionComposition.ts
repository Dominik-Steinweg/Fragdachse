import { ENEMY_BURST_PRESETS } from '../config/enemyBurstPresets';
import { isDawnActivityDefinitionId } from '../dawn/contracts/DawnIds';
import { resolveDawnSites } from '../dawn/resolution/DawnScenarioResolution';
import { getDawnArenaTemplate, getDawnSchedule, getDawnThreatCurve } from '../config/dawn/dawnContent';
import { createDawnScavengerPort } from '../dawn/runtime/DawnScavengerPort';
import { CELL_SIZE } from '../config';
import { DawnActivityRuntime } from '../dawn/runtime/DawnActivityRuntime';
import { worldCellCenter } from '../world/WorldMetrics';
import type { BossIntroState } from '../config/bossIntros';
import type { WorldHealthBarRenderer } from '../effects/health/WorldHealthBarRenderer';
import * as Phaser from 'phaser';
import type { ArenaBuilderResult } from '../arena/ArenaBuilder';
import type { ArenaLayout } from '../types';
import type { BaseManager } from '../entities/BaseManager';
import type { CombatActivityPort } from '../combat/CombatCapabilities';
import type { PlayerManager } from '../entities/PlayerManager';
import type { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { PowerUpSystem } from '../powerups/PowerUpSystem';
import type { EnergyShieldSystem } from '../systems/EnergyShieldSystem';
import type { StinkCloudSystem } from '../effects/StinkCloudSystem';
import type { FireChunkBurstPort } from '../systems/FlamethrowerUpgradeSystem';
import type { FireSystem } from '../effects/FireSystem';
import type { DecoySystem } from '../systems/DecoySystem';
import type { CoopDefenseEnemyAbilityNetworkPort } from '../systems/CoopDefenseEnemyAbilitySystem';
import type { ArmageddonSystem } from '../systems/ArmageddonSystem';
import type { AirstrikeSystem } from '../systems/AirstrikeSystem';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { LightingSystem } from '../effects/LightingSystem';
import type { CoopDefensePlayerModifierReadPort } from '../systems/CoopDefensePlayerModifierSystem';
import type { PlayerWorldRuntime } from '../world/PlayerWorldRuntime';
import type { WorldRuntimeContext } from '../world/WorldRuntimeContext';
import type { PlayerCapabilities } from '../world/PlayerCapabilities';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { EnemyVisualSink } from '../entities/EnemyManager';
import type { EntityBurnGpuController } from '../effects/EntityBurnGpuController';
import type { CoopMissionActivityConfiguration } from './CoopMissionActivityConfig';
import { resolveCoopMissionActivityConfiguration } from './CoopMissionActivityConfig';
import { CoopMissionCombatComposition } from './CoopMissionCombatComposition';
import { CoopMissionEnemyBehaviourComposition } from './CoopMissionEnemyBehaviourComposition';
import { CoopMissionEnemySupportComposition } from './CoopMissionEnemySupportComposition';
import { CoopMissionMapEventComposition } from './CoopMissionMapEventComposition';
import { BaseVoidFireSystem, collectBaseFireContacts } from '../systems/BaseVoidFireSystem';
import { CoopMissionObjectiveComposition } from './CoopMissionObjectiveComposition';
import { CoopMissionPlayerComposition } from './CoopMissionPlayerComposition';
import type { CoopMissionRuntime } from './CoopMissionRuntime';
import { resolveCoopDefenseEnemyConfigs } from '../config/coopDefenseEnemies';
import {
  resolveCoopDefenseMapMissionProgress,
  resolveCoopDefenseMapSecondaryObjectives,
} from '../config/coopDefenseMaps';
import type { CoopDefenseMissionProgressPresentationState } from '../types';
import type { PersistentBaseRewardId } from '../persistentBase/PersistentBaseRewardTypes';
import type { CoopTrainPort } from './CoopTrainPort';
import type { AutomatedWeaponExecution } from '../world/AutomatedWeaponExecutionAdapter';
import type { ProjectileThreatReadPort } from '../projectile/ProjectileReadPorts';
import type { TranslocatorProjectilePort } from '../projectile/ProjectileExternalInteractionPort';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';

/**
 * Netzwerk-Sicht der Dawn-Runtime. Die Composition-Grenze, die die Bridge besitzt, liefert sie;
 * Activity-Code importiert das Transport-Singleton nicht.
 */
export interface CoopMissionDawnNetworkPort {
  readonly getRoundScrap: () => number;
  readonly publishRoundScrap: (total: number) => void;
  readonly broadcastScrapFeedback: (x: number, y: number, amount: number) => void;
  readonly getSynchronizedNow: () => number;
  readonly getArenaStartTime: () => number;
  /** True, solange genau diese Activity laeuft (kein Countdown, Runde aktiv). */
  readonly isActivityLive: (activity: { readonly worldRevision: number; readonly activityRevision: number }) => boolean;
}

export interface CoopMissionCompositionOptions {
  readonly dawnNetwork?: CoopMissionDawnNetworkPort;
  readonly getKrakenPorts?: () => import('./CoopMissionKrakenComposition').CoopMissionKrakenPorts;
  readonly getCombatScope?: () => import('../combat/CombatScope').CombatScope;
  readonly getNavigationGeometry?: () => import('../systems/navigation/NavigationGeometry').NavigationGeometrySnapshot;
  readonly getNavigationObstacleIntegrity?: (enemy: import('../entities/EnemyEntity').EnemyEntity, id: string) => number | null;
  readonly scene: Phaser.Scene;
  readonly getWorld: () => WorldRuntimeContext | null;
  readonly getLayout: () => ArenaLayout | null;
  readonly isAuthoredRockDestroyed: (id: number) => boolean;
  readonly getArenaResult: () => ArenaBuilderResult | null;
  readonly getBaseManager: () => BaseManager | null;
  readonly getPlayerManager: () => PlayerManager;
  readonly getWorldCombatCore: () => CombatActivityPort;
  readonly getProjectileSpawnPort: () => ProjectileSpawnPort | null;
  readonly getProjectileDetonableReadPort: () => import('../projectile/ProjectileGameplayPort').ProjectileDetonableReadPort | null;
  readonly getProjectileThreatReadPort: () => ProjectileThreatReadPort | null;
  readonly getTranslocatorProjectilePort: () => TranslocatorProjectilePort | null;
  readonly getHostPhysics: () => HostPhysicsSystem;
  readonly getPlacementSystem: () => PlacementSystem | null;
  readonly getTemporaryUtilityPort: () => import('../world/PlayerUtilityActionRuntime').TemporaryUtilityPort | null;
  readonly getAutomatedWeaponExecution: () => AutomatedWeaponExecution | null;
  readonly getPowerUpSystem: () => PowerUpSystem | null;
  readonly getEnergyShieldSystem: () => EnergyShieldSystem | null;
  readonly getStinkCloudSystem: () => StinkCloudSystem;
  readonly getPlayerFireChunkPort: () => FireChunkBurstPort | null;
  readonly getFireSystem: () => FireSystem;
  readonly getDecoySystem: () => DecoySystem;
  readonly getArmageddonSystem: () => ArmageddonSystem | null;
  readonly getAirstrikeSystem: () => AirstrikeSystem | null;
  readonly getGameAudioSystem: () => GameAudioSystem;
  readonly getLightingSystem: () => LightingSystem;
  readonly getPlayerModifierReadPort: () => CoopDefensePlayerModifierReadPort | null;
  readonly getPlayerWorldRuntime: () => PlayerWorldRuntime | null;
  readonly train: CoopTrainPort;
  readonly isHost: () => boolean;
  readonly getHumanPlayerCount: () => number;
  readonly getParticipantIds: () => readonly string[];
  readonly nextGenerationId: () => number;
  readonly getPlayerCapabilities: (playerId: string) => PlayerCapabilities;
  readonly getSecondsLeft: () => number;
  readonly getConnectedPlayerIds: () => readonly string[];
  readonly getSpectatorIds: () => readonly string[];
  readonly isPlayerBurrowed: (playerId: string) => boolean;
  readonly isSafeEnemyGroundAt: (x: number, y: number, radius: number) => boolean;
  readonly findSafeEnemyGroundPosition: (
    x: number,
    y: number,
    radius: number,
    maxRadiusCells: number,
  ) => { x: number; y: number } | null;
  readonly isFreeEnemyGroundAt: (x: number, y: number, radius: number) => boolean;
  readonly hasWalkableEnemyCircleLine: (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    radius: number,
  ) => boolean;
  readonly damageConstruction: (id: number, damage: number, attackerId: string) => void;
  readonly releaseMissionObjectives: (runtime: CoopMissionRuntime, playerId: string) => void;
  readonly publishMissionProgress: (state: CoopDefenseMissionProgressPresentationState | null) => void;
  readonly broadcastCarryDeliveredFx: (x: number, y: number) => void;
  readonly enemyClawNetwork: import('../systems/EnemyClawAttack').EnemyClawNetworkPort;
  readonly enemyAbilityNetwork: CoopDefenseEnemyAbilityNetworkPort;
  readonly publishRespawnBudget: (state: import('../types').CoopDefenseRespawnBudgetState | null) => void;
  readonly patchBarrierCells: (changes: readonly { gridX: number; gridY: number; occupied: boolean }[]) => void;
  readonly markLightDirty: () => void;
  readonly grantPersistentBaseRewards: (rewardIds: readonly PersistentBaseRewardId[] | undefined) => void;
  readonly removeEnemyFromPlayerItems: (enemyId: string) => void;
  readonly mortarImpact: import('../systems/CoopDefenseMortarStrikeSystem').CoopDefenseMortarImpactPort;
  /** Host damage of enemy abilities that outlive or sweep past their source (death burst, leap path). */
  readonly enemyAreaEffects?: import('./CoopMissionEnemyBehaviourComposition').EnemyAreaEffectsPort;
  readonly broadcastExplosion: (x: number, y: number, radius: number, style: 'timebomb' | 'timebomb_pop' | 'mortar' | 'brood_hatch', color?: number) => void;
  readonly broadcastCorpseMarker: (corpseId: number, x: number, y: number, enemySize: number, lifetimeMs: number) => void;
  readonly removeCorpseMarker: (corpseId: number) => void;
  readonly getNowMs: () => number;
  readonly onDiagnosticEvent: (type: string, fields: Record<string, unknown>) => void;
  readonly onBossSpawned: (spawnedAtMs: number) => void;
  readonly onBossIntroStarted: (state: BossIntroState) => void;
  readonly onWaveStarted?: (encounterId: string) => void;
  readonly onObjectiveCompleted?: (objectiveId: string) => void;
  readonly onCheckpointActivated?: (checkpointId: string) => void;
  readonly visualSink: EnemyVisualSink | null;
  readonly getHealthBarRenderer?: () => WorldHealthBarRenderer | null;
  readonly entityBurnGpuController: EntityBurnGpuController | null;
}

/**
 * Activity-specific orchestration boundary for the Coop graph.
 *
 * The boundary owns no runtime state. It coordinates the focused composers and hands every fresh
 * child to `CoopMissionRuntime`, so the lifecycle coordinator only knows this boundary.
 */
export class CoopMissionComposition {
  constructor(private readonly options: CoopMissionCompositionOptions) {}

  /** Materializes the private core combat child without exposing its concrete type. */
  materializeCore(
    activity: CoopMissionActivityConfiguration | null,
    runtime: CoopMissionRuntime,
    layoutOverride: ArenaLayout | null = null,
  ): void {
    if (!activity) return;
    const world = this.options.getWorld();
    const layout = layoutOverride ?? this.options.getLayout();
    const arenaResult = this.options.getArenaResult();
    if (!world || !layout || !arenaResult) return;
    const humanPlayerCount = this.options.getHumanPlayerCount();
    const missionProgressConfig = resolveCoopDefenseMapMissionProgress(activity.mapConfig);
    const baseManager = this.options.getBaseManager();
    const obstacleCellProvider = () => {
      const staticRockCells = layout.rocks.flatMap((rock, index) => {
        const isActive = arenaResult.rockPhysicsProxies[index]?.active ?? false;
        return isActive ? [{ gridX: rock.gridX, gridY: rock.gridY }] : [];
      });
      const runtimeRockCells = (this.options.getPlacementSystem()?.getAllRuntimeRocks() ?? [])
        .filter((rock) => rock.kind !== 'pedestal' && rock.collisionMode !== 'none')
        .map((rock) => ({ gridX: rock.gridX, gridY: rock.gridY }));
      return [...staticRockCells, ...runtimeRockCells];
    };

    new CoopMissionCombatComposition({
      krakenPorts: this.options.isHost() ? this.options.getKrakenPorts?.() : undefined,
      combatScope: this.options.getCombatScope?.(),
      scene: this.options.scene,
      activity,
      enemyConfigs: resolveCoopDefenseEnemyConfigs(humanPlayerCount),
      humanPlayerCount,
      worldMetrics: world.metrics,
      layout,
      isHost: this.options.isHost(),
      getBaseSpecs: () => baseManager?.getBaseSpecs() ?? world.bases,
      getActiveBaseIds: () => baseManager?.getActiveBaseIds()
        ?? new Set(world.bases.map((spec) => spec.id)),
      getBase: (baseId) => baseManager?.getBase(baseId) ?? null,
      obstacleCellProvider,
      geometryProvider: this.options.getNavigationGeometry,
      barrierCells: missionProgressConfig?.barriers.flatMap((barrier) => barrier.cells) ?? [],
      nextGenerationId: this.options.nextGenerationId,
      visualSink: this.options.visualSink,
      lighting: this.options.getLightingSystem(),
      healthBars: this.options.getHealthBarRenderer?.(),
      entityBurnGpuController: this.options.entityBurnGpuController,
      onBossSpawned: this.options.onBossSpawned,
      onBossIntroStarted: this.options.onBossIntroStarted,
      // Activity core precedes world player gameplay; resolve the capability at spawn time.
      playerFireChunkPort: {
        hostCreateFireChunkBurst: (...args) => this.options.getPlayerFireChunkPort()?.hostCreateFireChunkBurst(...args),
      },
      onWaveStarted: this.options.onWaveStarted,
      onDiagnosticEvent: this.options.onDiagnosticEvent,
    }).materialize(runtime);
    if (this.options.isHost() && isDawnActivityDefinitionId(activity.definitionId)) {
      const plan = runtime.descriptor.parameters?.dawn;
      if (!plan) throw new Error('[CoopMissionComposition] Dawn elites need the Activity plan');
      runtime.enemyManager!.bindDawnElites({ roundSeed: world.descriptor.seed, threat: plan.threat }, (id, x, y, effect) => {
        this.options.getWorldCombatCore().applyExplosionDamage(x, y, effect, id, undefined, 'elite-volatile', {
          gameplaySource: { kind: 'enemy', id }, actor: { kind: 'enemy', id }, attribution: { kind: 'enemy', id },
          allegiance: { ownerId: id, factionId: 'hostile' }, authoredSourceId: 'elite-volatile', origin: 'explosion',
        });
        this.options.getHostPhysics().applyRadialImpulse(x, y, effect.radius, effect.knockback, id, 0);
        this.options.broadcastExplosion(x, y, effect.radius, 'timebomb_pop');
      });
    }
    const areaEffects = this.options.enemyAreaEffects;
    if (this.options.isHost() && areaEffects) runtime.enemyManager!.bindDeathBurst((id, x, y, burst) => {
      areaEffects.deathBurst(id, x, y, burst, this.options.getNowMs());
      const preset = ENEMY_BURST_PRESETS[burst.presentation ?? 'ink'];
      this.options.broadcastExplosion(x, y, burst.radiusPx, preset.style, preset.color);
    });
    if (this.options.getNavigationObstacleIntegrity) runtime.enemyIntents?.setObstacleIntegrityResolver(this.options.getNavigationObstacleIntegrity);
  }

  /** Materializes dependent Activity children after the core combat owner exists. */
  materializeDependents(
    activity: CoopMissionActivityConfiguration,
    runtime: CoopMissionRuntime,
  ): void {
    const world = this.options.getWorld();
    const layout = this.options.getLayout();
    const arenaResult = this.options.getArenaResult();
    const baseManager = this.options.getBaseManager();
    if (!world || !layout || !arenaResult) {
      throw new Error(`[CoopMissionComposition] Cannot materialize ${activity.definitionId} without World geometry`);
    }
    const humanPlayerCount = this.options.getHumanPlayerCount();
    const activityMapConfig = activity.mapConfig;
    const playerManager = this.options.getPlayerManager();
    const combatSystem = this.options.getWorldCombatCore();
    const powerUpSystem = this.options.getPowerUpSystem();
    const temporaryUtilityPort = this.options.getTemporaryUtilityPort();
    const weaponExecution = this.options.getAutomatedWeaponExecution();
    const placementSystem = this.options.getPlacementSystem();
    const projectileSpawnPort = this.options.getProjectileSpawnPort();
    const projectileThreatReadPort = this.options.getProjectileThreatReadPort();
    const translocatorProjectilePort = this.options.getTranslocatorProjectilePort();
    // The concrete train child lives behind the World owner's Activity slot. Register the
    // release before any dependent event composition so it is always removed on Activity end,
    // including maps without an AirstrikeSystem.
    runtime.bind({
      attach: () => { /* train is materialized by the map-event composition */ },
      detach: () => { this.options.train.releaseActivityTrain(); },
    });
    runtime.setSecondaryObjectiveConfigs(
      resolveCoopDefenseMapSecondaryObjectives(activityMapConfig, humanPlayerCount),
    );

    let dawn: DawnActivityRuntime | null = null;
    if (this.options.isHost() && isDawnActivityDefinitionId(activity.definitionId)) {
      const worldPlan = world.descriptor.parameters?.dawn;
      const activityPlan = runtime.descriptor.parameters?.dawn;
      const network = this.options.dawnNetwork;
      if (!worldPlan || !activityPlan || !powerUpSystem || !network) {
        throw new Error('[CoopMissionComposition] Dawn needs its plans, host pickups and network port');
      }
      const schedule = getDawnSchedule(activityPlan.scheduleId);
      dawn = new DawnActivityRuntime(resolveDawnSites(worldPlan), getDawnThreatCurve(activityPlan.threat), schedule, {
        // Eine Re-Materialisierung derselben Runde setzt den Stand nicht zurueck; der Rundenstart tut es.
        initialScrap: network.getRoundScrap(),
        publishScrap: total => network.publishRoundScrap(total),
        sitePosition: site => worldCellCenter(world.metrics, site.slot.anchor.gridX, site.slot.anchor.gridY),
        feedback: (x, y, amount) => network.broadcastScrapFeedback(x, y, amount),
        elapsedMs: () => runtime.getMissionNow(network.getSynchronizedNow()) - network.getArenaStartTime(),
        isActive: () => network.isActivityLive(runtime.descriptor),
        pickups: powerUpSystem,
        scavengers: { spawn: request => runtime.enemyManager
          ? createDawnScavengerPort(runtime.enemyManager, () => network.isActivityLive(runtime.descriptor)).spawn(request) : [] },
        escapeTarget: site => {
          // Away from the base core, to the arena edge two cells inside.
          const m = world.metrics, from = worldCellCenter(m, site.slot.anchor.gridX, site.slot.anchor.gridY);
          const anchor = getDawnArenaTemplate(worldPlan.templateId).world.persistentBase.anchor;
          const core = worldCellCenter(m, anchor.gridX, anchor.gridY);
          const dx = from.x - core.x, dy = from.y - core.y, length = Math.hypot(dx, dy) || 1;
          const inset = 2 * CELL_SIZE;
          return { x: Math.max(m.offsetX + inset, Math.min(m.offsetX + m.widthPx - inset, from.x + dx / length * m.widthPx)),
            y: Math.max(m.offsetY + inset, Math.min(m.offsetY + m.heightPx - inset, from.y + dy / length * m.heightPx)) };
        },
      });
      runtime.bind({ attach: () => {}, detach: () => { dawn?.destroy(); dawn = null; } });
    }

    new CoopMissionObjectiveComposition({
      activity,
      authoredRocks: layout.rocks,
      isAuthoredRockDestroyed: this.options.isAuthoredRockDestroyed,
      humanPlayerCount,
      worldRevision: world.descriptor.worldRevision,
      worldMetrics: world.metrics,
      scene: this.options.scene,
      physicsGroup: arenaResult.trunkGroup,
      isHost: this.options.isHost(),
      baseManager,
      playerManager,
      combatSystem,
      powerUpSystem,
      temporaryUtilityPort,
      getPlayerCapabilities: this.options.getPlayerCapabilities,
      getSecondsLeft: this.options.getSecondsLeft,
      getConnectedPlayerIds: this.options.getConnectedPlayerIds,
      getSpectatorIds: this.options.getSpectatorIds,
      isPlayerBurrowed: this.options.isPlayerBurrowed,
      publishMissionProgress: this.options.publishMissionProgress,
      onObjectiveCompleted: objectiveId => {
        dawn?.onObjectiveCompleted(objectiveId);
        this.options.onObjectiveCompleted?.(objectiveId);
      },
      onObjectiveActivated: objectiveId => dawn?.onObjectiveActivated(objectiveId),
      onCheckpointActivated: this.options.onCheckpointActivated,
      broadcastCarryDeliveredFx: this.options.broadcastCarryDeliveredFx,
      patchBarrierCells: this.options.patchBarrierCells,
      markLightDirty: this.options.markLightDirty,
      grantPersistentBaseRewards: this.options.grantPersistentBaseRewards,
    }).materialize(runtime);

    new CoopMissionPlayerComposition({
      activity,
      isHost: this.options.isHost(),
      playerWorldRuntime: this.options.getPlayerWorldRuntime(),
      getParticipantIds: this.options.getParticipantIds,
      releaseMissionObjectives: this.options.releaseMissionObjectives,
      publishRespawnBudget: this.options.publishRespawnBudget,
    }).materialize(runtime);

    if (!this.options.isHost() || !runtime.enemyManager || !placementSystem || !weaponExecution
      || !projectileSpawnPort
      || !projectileThreatReadPort || !translocatorProjectilePort) return;
    new CoopMissionEnemyBehaviourComposition({
      playerManager,
      enemyAreaEffects: this.options.enemyAreaEffects,
      getNowMs: this.options.getNowMs,
      projectileSpawn: projectileSpawnPort,
      projectileThreatReadPort,
      translocatorProjectilePort,
      combatSystem,
      hostPhysics: this.options.getHostPhysics(),
      baseManager,
      weaponExecution,
      placementSystem,
      energyShieldSystem: this.options.getEnergyShieldSystem(),
      stinkCloudSystem: this.options.getStinkCloudSystem(),
      playerFireChunkPort: this.options.getPlayerFireChunkPort(),
      fireSystem: this.options.getFireSystem(),
      decoySystem: this.options.getDecoySystem(),
      enemyAbilityNetwork: this.options.enemyAbilityNetwork,
      enemyClawNetwork: this.options.enemyClawNetwork,
      getTrainManager: this.options.train.getCurrentTrain,
      getTrainEvent: this.options.train.getCurrentTrainEvent,
      isSafeEnemyGroundAt: this.options.isSafeEnemyGroundAt,
      findSafeEnemyGroundPosition: this.options.findSafeEnemyGroundPosition,
      isFreeEnemyGroundAt: this.options.isFreeEnemyGroundAt,
      hasWalkableEnemyCircleLine: this.options.hasWalkableEnemyCircleLine,
      getRockObjects: () => this.options.getArenaResult()?.rockPhysicsProxies ?? null,
    }).materialize(runtime);

    new CoopMissionEnemySupportComposition({
      projectileDetonables: this.options.getProjectileDetonableReadPort(),
      playerManager,
      combatSystem,
      baseManager,
      placementSystem,
      hostPhysics: this.options.getHostPhysics(),
      weaponExecution,
      playerFireChunkPort: this.options.getPlayerFireChunkPort(),
      powerUpSystem,
      armageddonSystem: this.options.getArmageddonSystem(),
      decoySystem: this.options.getDecoySystem(),
      playerModifierReadPort: this.options.getPlayerModifierReadPort(),
      removeEnemyFromPlayerItems: this.options.removeEnemyFromPlayerItems,
      damageConstruction: this.options.damageConstruction,
      mortarImpact: this.options.mortarImpact,
      broadcastExplosion: this.options.broadcastExplosion,
      broadcastCorpseMarker: this.options.broadcastCorpseMarker,
      removeCorpseMarker: this.options.removeCorpseMarker,
      onDiagnosticEvent: this.options.onDiagnosticEvent,
      worldMetrics: world.metrics,
    }).materialize(runtime);

    const fire = this.options.getFireSystem();
    if (baseManager) runtime.setBaseVoidFire(new BaseVoidFireSystem({
      getBases: () => baseManager.getBases(),
      getContacts: (baseId, now) => collectBaseFireContacts(fire,
        baseManager.getBase(baseId)?.spec.cells ?? [], world.metrics, now),
      captureSource: contact => combatSystem.captureWorldDamageSource(contact.ownerId, contact.sourceId, 'burn'),
      canDamage: (source, faction) => combatSystem.canDamageStructure(source, undefined, faction),
      damage: (id, amount, source, now) => { combatSystem.applyBaseStatusDamage(id, amount, source, now); },
    }));

    const airstrikeSystem = this.options.getAirstrikeSystem();
    if (!airstrikeSystem) return;
    new CoopMissionMapEventComposition({
      activity,
      layout,
      worldMetrics: world.metrics,
      worldBases: world.bases,
      playerManager,
      combatSystem,
      baseManager,
      fireSystem: this.options.getFireSystem(),
      airstrikeSystem,
      gameAudioSystem: this.options.getGameAudioSystem(),
      train: this.options.train,
      getNowMs: this.options.getNowMs,
    }).materialize(runtime);
  }
}
