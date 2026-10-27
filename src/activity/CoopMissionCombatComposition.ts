import { materializeCoopMissionKraken, type CoopMissionKrakenPorts } from './CoopMissionKrakenComposition';
import { getBossIntroPreset } from '../config/bossIntros';
import type { BossIntroState } from '../config/bossIntros';
import type { FireChunkBurstPort } from '../systems/FlamethrowerUpgradeSystem';
import type { WorldHealthBarRenderer } from '../effects/health/WorldHealthBarRenderer';
import { WaterGeometry } from '../arena/WaterGeometry';
import * as Phaser from 'phaser';
import { CELL_SIZE, COOP_DEFENSE_NAV_TICK_DIVISOR_STRATEGIC, COOP_DEFENSE_NAV_TICK_INTERVAL_MS } from '../config';
import type { BaseSpec } from '../arena/BaseRegistry';
import type { ArenaLayout } from '../types';
import {
  getCoopDefenseEnemyConfig,
  type ResolvedCoopDefenseEnemyConfigs,
} from '../config/coopDefenseEnemies';
import type {
  ResolvedCoopDefenseMapEncounterConfig,
  ResolvedCoopDefenseMapPersistentSpawnConfig,
} from '../config/coopDefenseMaps';
import {
  resolveCoopDefenseMapBossSpawnArea,
  resolveCoopDefenseMapEncounterConfigs,
  resolveCoopDefenseMapPersistentSpawnConfigs,
} from '../config/coopDefenseMaps';
import { isCoopDefenseSideEncounter } from '../config/coopDefenseMapAuthoring';
import type { EntityBurnGpuController } from '../effects/EntityBurnGpuController';
import type { LightingSystem } from '../effects/LightingSystem';
import { EnemyManager, type EnemyVisualSink } from '../entities/EnemyManager';
import { CoopDefenseBossSystem } from '../systems/CoopDefenseBossSystem';
import { CoopDefenseMapDirector } from '../systems/CoopDefenseMapDirector';
import { CoopDefensePersistentPressureSystem } from '../systems/CoopDefensePersistentPressureSystem';
import { CoopDefenseSpawnExecutor } from '../systems/CoopDefenseSpawnExecutor';
import { EnemyAiTargetCatalog } from '../systems/EnemyAiTargetCatalog';
import { EnemyIntentSystem } from '../systems/navigation/EnemyIntentSystem';
import { EnemyFlowFieldService } from '../systems/EnemyFlowFieldService';
import { EnemyStrategicTargetService, type PreparedStrategicTargets } from '../systems/EnemyStrategicTargetService';
import {
  ENEMY_FLOW_FIELD_IDS,
  FlowFieldCoordinator,
} from '../systems/flowfield/FlowFieldCoordinator';
import { createFlowFieldRunner } from '../systems/flowfield/FlowFieldRunnerFactory';
import {
  createFlowFieldTuning,
  resolveCoopMissionFlowFieldInputs,
  resolveGridChange,
} from '../systems/flowfield/FlowFieldSources';
import { ARENA_MAP_GRID_CHANGED_EVENT, type ArenaMapGridChangedEvent } from '../scenes/arena/ArenaEvents';
import type { WorldMetrics } from '../world/WorldMetrics';
import type {
  CoopMissionEncounterRuntime,
  CoopMissionNavigationRuntime,
  CoopMissionRuntime,
} from './CoopMissionRuntime';
import type { CoopMissionActivityConfiguration } from './CoopMissionActivityConfig';

interface BaseStatePort {
  isDestroyed(): boolean;
}

export interface CoopMissionCombatCompositionOptions {
  readonly krakenPorts?: CoopMissionKrakenPorts;
  readonly combatScope?: import('../combat/CombatScope').CombatScope;
  readonly geometryProvider?: () => import('../systems/navigation/NavigationGeometry').NavigationGeometrySnapshot;
  /** World collision water (authored water minus standing bridge decks); absent in isolated tests. */
  readonly getCollisionWater?: () => WaterGeometry | null;
  readonly scene: Phaser.Scene;
  /** Already validated against the current WorldDefinition; mapConfig is only its adapter. */
  readonly activity: CoopMissionActivityConfiguration;
  readonly enemyConfigs: ResolvedCoopDefenseEnemyConfigs;
  readonly humanPlayerCount: number;
  readonly worldMetrics: WorldMetrics;
  readonly layout: ArenaLayout;
  readonly isHost: boolean;
  readonly getBaseSpecs: () => readonly BaseSpec[];
  readonly getActiveBaseIds: () => ReadonlySet<string>;
  readonly getNavigationBaseIds: () => ReadonlySet<string>;
  readonly getBase: (baseId: string) => BaseStatePort | null;
  readonly obstacleCellProvider: () => ReadonlyArray<{ gridX: number; gridY: number }>;
  readonly barrierCells: readonly { gridX: number; gridY: number }[];
  readonly nextGenerationId: () => number;
  readonly visualSink: EnemyVisualSink | null;
  readonly lighting: LightingSystem | null;
  readonly healthBars?: WorldHealthBarRenderer | null;
  readonly entityBurnGpuController: EntityBurnGpuController | null;
  readonly onBossSpawned?: (spawnedAtMs: number) => void;
  readonly onBossIntroStarted?: (state: BossIntroState) => void;
  readonly playerFireChunkPort?: FireChunkBurstPort | null;
  readonly onWaveStarted?: (encounterId: string) => void;
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
    if (this.options.combatScope) runtime.enemyManager!.bindCombatIdentity(this.options.combatScope, runtime.descriptor.activityRevision);
    if (!this.options.isHost) return;

    const navigation = this.createNavigation();
    runtime.setNavigation(navigation);
    const activity = this.options.activity.mapConfig;
    if (this.options.krakenPorts && this.options.geometryProvider) materializeCoopMissionKraken(runtime, activity,
      this.options.layout, this.options.worldMetrics, this.options.krakenPorts, this.options.geometryProvider);
    const persistentSpawnConfigs = resolveCoopDefenseMapPersistentSpawnConfigs(
      activity,
      this.options.humanPlayerCount,
    );
    const encounterConfigs = resolveCoopDefenseMapEncounterConfigs(
      activity,
      this.options.humanPlayerCount,
    );
    if (
      persistentSpawnConfigs.length > 0
      || encounterConfigs.length > 0
      || activity.boss !== undefined
    ) {
      runtime.setEncounter(this.createEncounter(runtime, navigation, persistentSpawnConfigs, encounterConfigs));
    }
  }

  private createEnemyManager(): EnemyManager {
    const enemyManager = new EnemyManager(this.options.scene, this.options.enemyConfigs);
    enemyManager.setWorldMetrics(this.options.worldMetrics);
    if (this.options.getCollisionWater) enemyManager.setWaterGeometryProvider(this.options.getCollisionWater);
    else enemyManager.setWaterGeometry(new WaterGeometry(this.options.layout.water ?? [], this.options.worldMetrics));
    enemyManager.setVisualSink(this.options.visualSink);
    enemyManager.setLightingSystem(this.options.lighting);
    enemyManager.setEntityBurnGpuController(this.options.entityBurnGpuController);
    enemyManager.setHealthBarRenderer(this.options.healthBars ?? null);
    return enemyManager;
  }

  private createNavigation(): CoopMissionNavigationRuntime {
    const bossConfig = this.options.activity.mapConfig.boss
      ? getCoopDefenseEnemyConfig(this.options.activity.mapConfig.boss.enemyKind)
      : null;
    const bossClearanceCells = bossConfig
      ? Math.ceil(Math.max(0, bossConfig.size * 0.5 - CELL_SIZE * 0.5) / CELL_SIZE)
      : 0;
    const exact = this.options.geometryProvider !== undefined;
    const { metrics, staticKind, bases } = resolveCoopMissionFlowFieldInputs({ worldMetrics: this.options.worldMetrics,
      layout: this.options.layout, baseSpecs: this.options.getBaseSpecs(),
      enemyTargeting: this.options.activity.mapConfig.enemyTargeting, exact });
    const flowFieldCoordinator = new FlowFieldCoordinator({
      metrics,
      tuning: createFlowFieldTuning(),
      staticKind,
      bases,
      activeBaseIds: this.options.getNavigationBaseIds(),
      obstacleCellProvider: exact ? () => [] : this.options.obstacleCellProvider,
      barrierCells: exact ? [] : this.options.barrierCells,
      geometryProvider: this.options.geometryProvider,
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
          bodyRadius: bossConfig.size / 2,
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
      intents: exact ? new EnemyIntentSystem(flowFieldCoordinator, enemyAiTargetCatalog) : null,
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
    persistentSpawnConfigs: readonly ResolvedCoopDefenseMapPersistentSpawnConfig[],
    encounterConfigs: readonly ResolvedCoopDefenseMapEncounterConfig[],
  ): CoopMissionEncounterRuntime {
    const enemyManager = runtime.enemyManager;
    if (!enemyManager) {
      throw new Error('[CoopMissionCombatComposition] Encounter needs materialized enemy navigation');
    }
    const spawnExecutor = new CoopDefenseSpawnExecutor(
      enemyManager,
      navigation.enemy,
      this.options.worldMetrics,
      navigation.boss,
      navigation.player,
      navigation.strategic,
      runtime.kraken?.habitat,
      resolveCoopDefenseMapBossSpawnArea(this.options.activity.mapConfig),
    );
    const persistentPressure = persistentSpawnConfigs.length > 0
      ? new CoopDefensePersistentPressureSystem(
        persistentSpawnConfigs,
        spawnExecutor,
        this.options.getBaseSpecs(),
        this.options.getActiveBaseIds,
      )
      : null;
    const bossSystem = this.options.activity.mapConfig.boss
      ? new CoopDefenseBossSystem(
        this.options.activity.mapConfig.boss,
        enemyManager,
        spawnExecutor,
        (now, boss, intro) => {
          if (boss && runtime.kraken && this.options.activity.mapConfig.boss?.habitatId) {
            runtime.kraken.excluded.add(boss.id);
            runtime.kraken.system.start(boss, this.options.activity.mapConfig.boss.habitatId, now,
              intro ? intro.startedAtMs + getBossIntroPreset(intro.preset).durationMs : now, intro?.startedAtMs);
            runtime.kraken.system.originId = enemyManager.getEnemy(boss.id)?.originId ?? boss.id;
          }
          this.options.onBossSpawned?.(now);
        },
        this.options.onBossIntroStarted,
        Math.random,
        () => {
          const encounterId = this.options.activity.mapConfig.boss?.startAfterEncounterId;
          return !encounterId || (runtime.coopDefenseMapDirector?.isEncounterCleared(encounterId) ?? false);
        },
        this.options.playerFireChunkPort,
      )
      : null;
    if (runtime.kraken) bossSystem?.setDefeatCompletionSource(() => runtime.kraken?.system.isDefeatComplete() ?? false);
    const objective = this.options.activity.mapConfig.objective;
    const chainConfigs = encounterConfigs.filter((encounter) => !isCoopDefenseSideEncounter(objective, encounter));
    const sideConfigs = encounterConfigs.filter((encounter) => isCoopDefenseSideEncounter(objective, encounter));
    const createDirector = (configs: readonly ResolvedCoopDefenseMapEncounterConfig[], side: boolean) => configs.length > 0
      ? new CoopDefenseMapDirector(
        configs,
        (enemyKind, count, originId, front, spawnArea) => spawnExecutor
          .hostSpawnEncounterGroup(enemyKind, count, originId, front, spawnArea),
        {
          // Side encounters run on the scheduled path beside the chain and never complete it.
          mode: !side && objective === 'repel-assault' ? 'repel-assault' : 'scheduled',
          showComplete: !side && objective === 'repel-assault',
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
              case 'after-boss-spawn': {
                const sinceSpawn = runtime.coopDefenseBossSystem?.getMsSinceSpawn() ?? null;
                return sinceSpawn !== null && sinceSpawn >= start.delayMs;
              }
              case 'site-activated':
                return runtime.coopDefenseSiteActivationSystem?.isSiteActivated(start.siteId) ?? false;
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
          ...(side ? {} : { onWaveStarted: this.options.onWaveStarted }),
        },
      )
      : null;
    return {
      spawnExecutor,
      persistentPressure,
      boss: bossSystem,
      director: createDirector(chainConfigs, false),
      sideDirector: createDirector(sideConfigs, true),
    };
  }
}
