import * as Phaser from 'phaser';
import { CELL_SIZE, COOP_DEFENSE_NAV_TICK_DIVISOR_STRATEGIC, COOP_DEFENSE_NAV_TICK_INTERVAL_MS } from '../config';
import type { BaseSpec } from '../arena/BaseRegistry';
import type { ArenaLayout } from '../types';
import {
  getCoopDefenseEnemyConfig,
  type ResolvedCoopDefenseEnemyConfigs,
} from '../config/coopDefenseEnemies';
import type {
  CoopDefenseMapBossConfig,
  CoopDefenseMapObjective,
  ResolvedCoopDefenseMapEncounterConfig,
  ResolvedCoopDefenseMapPersistentSpawnConfig,
} from '../config/coopDefenseMaps';
import type { EntityBurnGpuController } from '../effects/EntityBurnGpuController';
import type { LightingSystem } from '../effects/LightingSystem';
import { EnemyManager, type EnemyVisualSink } from '../entities/EnemyManager';
import { CoopDefenseBossSystem } from '../systems/CoopDefenseBossSystem';
import { CoopDefenseMapDirector } from '../systems/CoopDefenseMapDirector';
import { CoopDefensePersistentPressureSystem } from '../systems/CoopDefensePersistentPressureSystem';
import { CoopDefenseSpawnExecutor } from '../systems/CoopDefenseSpawnExecutor';
import { EnemyAiTargetCatalog } from '../systems/EnemyAiTargetCatalog';
import { EnemyFlowFieldService } from '../systems/EnemyFlowFieldService';
import { EnemyStrategicTargetService, type PreparedStrategicTargets } from '../systems/EnemyStrategicTargetService';
import {
  ENEMY_FLOW_FIELD_IDS,
  FlowFieldCoordinator,
} from '../systems/flowfield/FlowFieldCoordinator';
import { createFlowFieldRunner } from '../systems/flowfield/FlowFieldRunnerFactory';
import {
  buildBaseDescriptors,
  buildStaticKindRaster,
  createFlowFieldTuning,
  resolveGridChange,
} from '../systems/flowfield/FlowFieldSources';
import type { FlowFieldMetrics } from '../systems/flowfield/FlowFieldKernel';
import { ARENA_MAP_GRID_CHANGED_EVENT, type ArenaMapGridChangedEvent } from '../scenes/arena/ArenaEvents';
import type { WorldMetrics } from '../world/WorldMetrics';
import type {
  CoopMissionEncounterRuntime,
  CoopMissionNavigationRuntime,
  CoopMissionRuntime,
} from './CoopMissionRuntime';

interface BaseStatePort {
  isDestroyed(): boolean;
}

export interface CoopMissionCombatCompositionOptions {
  readonly scene: Phaser.Scene;
  readonly enemyConfigs: ResolvedCoopDefenseEnemyConfigs;
  readonly worldMetrics: WorldMetrics;
  readonly layout: ArenaLayout;
  readonly isHost: boolean;
  readonly getBaseSpecs: () => readonly BaseSpec[];
  readonly getActiveBaseIds: () => ReadonlySet<string>;
  readonly getBase: (baseId: string) => BaseStatePort | null;
  readonly obstacleCellProvider: () => ReadonlyArray<{ gridX: number; gridY: number }>;
  readonly barrierCells: readonly { gridX: number; gridY: number }[];
  readonly boss: CoopDefenseMapBossConfig | undefined;
  readonly objective: CoopDefenseMapObjective;
  readonly persistentSpawnConfigs: readonly ResolvedCoopDefenseMapPersistentSpawnConfig[];
  readonly encounterConfigs: readonly ResolvedCoopDefenseMapEncounterConfig[];
  readonly nextGenerationId: () => number;
  readonly visualSink: EnemyVisualSink | null;
  readonly lighting: LightingSystem | null;
  readonly entityBurnGpuController: EntityBurnGpuController | null;
  readonly onBossSpawned?: (spawnedAtMs: number) => void;
  readonly onDiagnosticEvent?: (type: string, fields: Record<string, unknown>) => void;
}

/**
 * Baut den konkreten Enemy-/Navigation-/Encounter-Graphen einer Coop-Activity.
 *
 * Diese Klasse besitzt keinen Runtime-State. `CoopMissionRuntime` bleibt der Lifetime-Owner;
 * die Composition liefert nur frische Materialisierungen und ihre activity-lokalen Ports.
 */
export class CoopMissionCombatComposition {
  constructor(private readonly options: CoopMissionCombatCompositionOptions) {}

  materialize(runtime: CoopMissionRuntime): void {
    runtime.setEnemyManager(this.createEnemyManager());
    if (!this.options.isHost) return;

    const navigation = this.createNavigation();
    runtime.setNavigation(navigation);
    if (
      this.options.persistentSpawnConfigs.length > 0
      || this.options.encounterConfigs.length > 0
      || this.options.boss !== undefined
    ) {
      runtime.setEncounter(this.createEncounter(runtime, navigation));
    }
  }

  private createEnemyManager(): EnemyManager {
    const enemyManager = new EnemyManager(this.options.scene, this.options.enemyConfigs);
    enemyManager.setWorldMetrics(this.options.worldMetrics);
    enemyManager.setVisualSink(this.options.visualSink);
    enemyManager.setLightingSystem(this.options.lighting);
    enemyManager.setEntityBurnGpuController(this.options.entityBurnGpuController);
    return enemyManager;
  }

  private createNavigation(): CoopMissionNavigationRuntime {
    const bossConfig = this.options.boss
      ? getCoopDefenseEnemyConfig(this.options.boss.enemyKind)
      : null;
    const bossClearanceCells = bossConfig
      ? Math.ceil(Math.max(0, bossConfig.size * 0.5 - CELL_SIZE * 0.5) / CELL_SIZE)
      : 0;
    const metrics: FlowFieldMetrics = {
      cols: this.options.worldMetrics.gridCols,
      rows: this.options.worldMetrics.gridRows,
      cellSize: CELL_SIZE,
      arenaOffsetX: this.options.worldMetrics.offsetX,
      arenaOffsetY: this.options.worldMetrics.offsetY,
    };
    const flowFieldCoordinator = new FlowFieldCoordinator({
      metrics,
      tuning: createFlowFieldTuning(),
      staticKind: buildStaticKindRaster(this.options.layout, metrics),
      bases: buildBaseDescriptors(this.options.getBaseSpecs()),
      activeBaseIds: this.options.getActiveBaseIds(),
      obstacleCellProvider: this.options.obstacleCellProvider,
      barrierCells: this.options.barrierCells,
      runner: createFlowFieldRunner(),
      navTickIntervalMs: COOP_DEFENSE_NAV_TICK_INTERVAL_MS,
      generationId: this.options.nextGenerationId(),
    });
    console.info(`[flowfield] runner=${flowFieldCoordinator.getDiagnostics().runnerKind}`);

    const enemyFlowFieldService = EnemyFlowFieldService.fromView(
      flowFieldCoordinator.registerField(ENEMY_FLOW_FIELD_IDS.base, { goalMode: 'bases' }),
    );
    const enemyPlayerFlowFieldService = EnemyFlowFieldService.fromView(
      flowFieldCoordinator.registerField(ENEMY_FLOW_FIELD_IDS.player, {
        goalMode: 'dynamic-fallback-bases',
      }),
    );
    const enemyStrategicFlowFieldService = EnemyFlowFieldService.fromView(
      flowFieldCoordinator.registerField(ENEMY_FLOW_FIELD_IDS.strategic, {
        goalMode: 'dynamic',
        tickDivisor: COOP_DEFENSE_NAV_TICK_DIVISOR_STRATEGIC,
      }),
    );
    const enemyBossFlowFieldService = bossConfig
      ? EnemyFlowFieldService.fromView(
        flowFieldCoordinator.registerField(ENEMY_FLOW_FIELD_IDS.boss, {
          goalMode: bossConfig.movementTarget === 'players' ? 'dynamic-fallback-bases' : 'bases',
          clearanceCells: bossClearanceCells,
        }),
      )
      : null;
    const enemyStrategicTargetService = new EnemyStrategicTargetService(
      enemyStrategicFlowFieldService,
    );
    const enemyAiTargetCatalog = new EnemyAiTargetCatalog();
    const flowFieldGridListener = (event: ArenaMapGridChangedEvent): void => {
      const change = resolveGridChange(event);
      if (change) flowFieldCoordinator.patchCell(change.gridX, change.gridY, change.occupied);
      else flowFieldCoordinator.requestFullResync();
    };
    this.options.scene.game.events.on(ARENA_MAP_GRID_CHANGED_EVENT, flowFieldGridListener);
    const releaseStrategicActivation = flowFieldCoordinator
      .getFieldView(ENEMY_FLOW_FIELD_IDS.strategic)
      ?.onActivated((payload) => {
        if (payload) enemyStrategicTargetService.activate(payload as PreparedStrategicTargets);
      });

    const navigation: CoopMissionNavigationRuntime = {
      coordinator: flowFieldCoordinator,
      enemy: enemyFlowFieldService,
      player: enemyPlayerFlowFieldService,
      strategic: enemyStrategicFlowFieldService,
      boss: enemyBossFlowFieldService,
      targetCatalog: enemyAiTargetCatalog,
      strategicTarget: enemyStrategicTargetService,
      releaseGridChanges: () => {
        this.options.scene.game.events.off(ARENA_MAP_GRID_CHANGED_EVENT, flowFieldGridListener);
        releaseStrategicActivation?.();
      },
    };
    return navigation;
  }

  private createEncounter(
    runtime: CoopMissionRuntime,
    navigation: CoopMissionNavigationRuntime,
  ): CoopMissionEncounterRuntime {
    const enemyManager = runtime.enemyManager;
    if (!enemyManager) {
      throw new Error('[CoopMissionCombatComposition] Encounter needs materialized enemy navigation');
    }
    const spawnExecutor = new CoopDefenseSpawnExecutor(
      enemyManager,
      navigation.enemy,
      navigation.boss,
      navigation.player,
      navigation.strategic,
    );
    const persistentPressure = this.options.persistentSpawnConfigs.length > 0
      ? new CoopDefensePersistentPressureSystem(
        this.options.persistentSpawnConfigs,
        spawnExecutor,
        this.options.getBaseSpecs(),
        this.options.getActiveBaseIds,
      )
      : null;
    const bossSystem = this.options.boss
      ? new CoopDefenseBossSystem(
        this.options.boss,
        enemyManager,
        spawnExecutor,
        this.options.onBossSpawned,
      )
      : null;
    const mapDirector = this.options.encounterConfigs.length > 0
      ? new CoopDefenseMapDirector(
        this.options.encounterConfigs,
        (enemyKind, count, originId, front, spawnArea) => spawnExecutor
          .hostSpawnEncounterGroup(enemyKind, count, originId, front, spawnArea),
        {
          mode: this.options.objective === 'repel-assault' ? 'repel-assault' : 'scheduled',
          showComplete: this.options.objective === 'repel-assault',
          isEnemyActive: (enemyId) => enemyManager.getEnemy(enemyId)?.sprite.active === true,
          isEncounterStartSatisfied: (start) => {
            switch (start.type) {
              case 'after-event':
                return runtime.coopDefenseMapEventDirector?.isEventCompleted(start.eventId) ?? false;
              case 'boss-phase':
                return runtime.coopDefenseVoidHunterSystem?.hasReachedPhase(start.phase) ?? false;
              case 'after-encounter':
                return runtime.coopDefenseMapDirector?.isEncounterCleared(start.encounterId) ?? false;
              case 'after-checkpoint':
                return runtime.coopDefenseMissionProgressSystem?.isCheckpointActivated(start.checkpointId) ?? false;
              case 'after-defense':
                return runtime.coopDefenseMissionProgressSystem?.isDefenseResolved(start.defenseId) ?? false;
              case 'base-destroyed':
                return this.options.getBase(start.baseId)?.isDestroyed() ?? false;
              case 'time':
              case 'after-previous':
                return false;
            }
          },
          isEnemyOriginActive: (originId) => enemyManager.hasActiveEnemyOrigin(originId),
          getActiveEnemyIdsForOrigin: (originId) => enemyManager.getActiveEnemyIdsForOrigin(originId),
          isEnemyTechnicallyStuck: (enemyId) => {
            const enemy = enemyManager.getEnemy(enemyId);
            return enemy?.sprite.active === true && enemy.getHp() > 0 && enemy.isPathBlocked();
          },
          removeEnemy: (enemyId) => enemyManager.hostRemoveWithoutKill(enemyId) !== null,
          onDiagnosticEvent: this.options.onDiagnosticEvent,
        },
      )
      : null;
    return {
      spawnExecutor,
      persistentPressure,
      boss: bossSystem,
      director: mapDirector,
    };
  }
}
