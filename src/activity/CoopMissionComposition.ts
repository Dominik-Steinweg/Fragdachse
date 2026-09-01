import * as Phaser from 'phaser';
import type { ArenaBuilderResult } from '../arena/ArenaBuilder';
import type { ArenaLayout } from '../types';
import type { BaseManager } from '../entities/BaseManager';
import type { CombatSystem } from '../systems/CombatSystem';
import type { PlayerManager } from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { LoadoutManager } from '../loadout/LoadoutManager';
import type { PowerUpSystem } from '../powerups/PowerUpSystem';
import type { EnergyShieldSystem } from '../systems/EnergyShieldSystem';
import type { StinkCloudSystem } from '../effects/StinkCloudSystem';
import type { FlamethrowerUpgradeSystem } from '../systems/FlamethrowerUpgradeSystem';
import type { FireSystem } from '../effects/FireSystem';
import type { DecoySystem } from '../systems/DecoySystem';
import type { ArmageddonSystem } from '../systems/ArmageddonSystem';
import type { AirstrikeSystem } from '../systems/AirstrikeSystem';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { LightingSystem } from '../effects/LightingSystem';
import type { CoopDefensePlayerModifierSystem } from '../systems/CoopDefensePlayerModifierSystem';
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

export interface CoopMissionCompositionOptions {
  readonly scene: Phaser.Scene;
  readonly getWorld: () => WorldRuntimeContext | null;
  readonly getLayout: () => ArenaLayout | null;
  readonly getArenaResult: () => ArenaBuilderResult | null;
  readonly getBaseManager: () => BaseManager | null;
  readonly getPlayerManager: () => PlayerManager;
  readonly getCombatSystem: () => CombatSystem;
  readonly getProjectileManager: () => ProjectileManager;
  readonly getHostPhysics: () => HostPhysicsSystem;
  readonly getPlacementSystem: () => PlacementSystem | null;
  readonly getLoadoutManager: () => LoadoutManager | null;
  readonly getPowerUpSystem: () => PowerUpSystem | null;
  readonly getEnergyShieldSystem: () => EnergyShieldSystem | null;
  readonly getStinkCloudSystem: () => StinkCloudSystem;
  readonly getFlamethrowerUpgradeSystem: () => FlamethrowerUpgradeSystem | null;
  readonly getFireSystem: () => FireSystem;
  readonly getDecoySystem: () => DecoySystem;
  readonly getArmageddonSystem: () => ArmageddonSystem | null;
  readonly getAirstrikeSystem: () => AirstrikeSystem | null;
  readonly getGameAudioSystem: () => GameAudioSystem;
  readonly getLightingSystem: () => LightingSystem;
  readonly getPlayerModifierSystem: () => CoopDefensePlayerModifierSystem | null;
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
  readonly publishRespawnBudget: (state: import('../types').CoopDefenseRespawnBudgetState | null) => void;
  readonly patchBarrierCells: (changes: readonly { gridX: number; gridY: number; occupied: boolean }[]) => void;
  readonly markLightDirty: () => void;
  readonly grantPersistentBaseRewards: (rewardIds: readonly PersistentBaseRewardId[] | undefined) => void;
  readonly removeEnemyFromItemRuntime: (enemyId: string) => void;
  readonly broadcastExplosion: (x: number, y: number, radius: number, style: 'timebomb' | 'timebomb_pop') => void;
  readonly broadcastCorpseMarker: (corpseId: number, x: number, y: number, enemySize: number, lifetimeMs: number) => void;
  readonly removeCorpseMarker: (corpseId: number) => void;
  readonly getNowMs: () => number;
  readonly onDiagnosticEvent: (type: string, fields: Record<string, unknown>) => void;
  readonly onBossSpawned: (spawnedAtMs: number) => void;
  readonly visualSink: EnemyVisualSink | null;
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
      barrierCells: missionProgressConfig?.barriers.flatMap((barrier) => barrier.cells) ?? [],
      nextGenerationId: this.options.nextGenerationId,
      visualSink: this.options.visualSink,
      lighting: this.options.getLightingSystem(),
      entityBurnGpuController: this.options.entityBurnGpuController,
      onBossSpawned: this.options.onBossSpawned,
      onDiagnosticEvent: this.options.onDiagnosticEvent,
    }).materialize(runtime);
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
    const combatSystem = this.options.getCombatSystem();
    const powerUpSystem = this.options.getPowerUpSystem();
    const loadoutManager = this.options.getLoadoutManager();
    const placementSystem = this.options.getPlacementSystem();
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

    new CoopMissionObjectiveComposition({
      activity,
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
      loadoutManager,
      getPlayerCapabilities: this.options.getPlayerCapabilities,
      getSecondsLeft: this.options.getSecondsLeft,
      getConnectedPlayerIds: this.options.getConnectedPlayerIds,
      getSpectatorIds: this.options.getSpectatorIds,
      isPlayerBurrowed: this.options.isPlayerBurrowed,
      publishMissionProgress: this.options.publishMissionProgress,
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

    if (!this.options.isHost() || !runtime.enemyManager || !baseManager || !placementSystem || !loadoutManager) return;
    new CoopMissionEnemyBehaviourComposition({
      playerManager,
      projectileManager: this.options.getProjectileManager(),
      combatSystem,
      hostPhysics: this.options.getHostPhysics(),
      baseManager,
      loadoutManager,
      placementSystem,
      energyShieldSystem: this.options.getEnergyShieldSystem(),
      stinkCloudSystem: this.options.getStinkCloudSystem(),
      flamethrowerUpgradeSystem: this.options.getFlamethrowerUpgradeSystem(),
      fireSystem: this.options.getFireSystem(),
      decoySystem: this.options.getDecoySystem(),
      getTrainManager: this.options.train.getCurrentTrain,
      getTrainEvent: this.options.train.getCurrentTrainEvent,
      isSafeEnemyGroundAt: this.options.isSafeEnemyGroundAt,
      findSafeEnemyGroundPosition: this.options.findSafeEnemyGroundPosition,
      isFreeEnemyGroundAt: this.options.isFreeEnemyGroundAt,
      hasWalkableEnemyCircleLine: this.options.hasWalkableEnemyCircleLine,
      getRockObjects: () => this.options.getArenaResult()?.rockPhysicsProxies ?? null,
    }).materialize(runtime);

    new CoopMissionEnemySupportComposition({
      playerManager,
      combatSystem,
      baseManager,
      placementSystem,
      hostPhysics: this.options.getHostPhysics(),
      loadoutManager,
      flamethrowerUpgradeSystem: this.options.getFlamethrowerUpgradeSystem(),
      powerUpSystem,
      armageddonSystem: this.options.getArmageddonSystem(),
      decoySystem: this.options.getDecoySystem(),
      playerModifierSystem: this.options.getPlayerModifierSystem(),
      removeEnemyFromItemRuntime: this.options.removeEnemyFromItemRuntime,
      damageConstruction: this.options.damageConstruction,
      broadcastExplosion: this.options.broadcastExplosion,
      broadcastCorpseMarker: this.options.broadcastCorpseMarker,
      removeCorpseMarker: this.options.removeCorpseMarker,
      onDiagnosticEvent: this.options.onDiagnosticEvent,
      worldMetrics: world.metrics,
    }).materialize(runtime);

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
