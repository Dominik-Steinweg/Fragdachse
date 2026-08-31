import * as Phaser from 'phaser';
import {
  getBaseRewardPickupWorldPosition,
} from '../arena/BaseRegistry';
import type { BaseManager } from '../entities/BaseManager';
import {
  resolveCoopDefenseMapMissionProgress,
  resolveCoopDefenseMapSecondaryObjectives,
} from '../config/coopDefenseMaps';
import type { PersistentBaseRewardId } from '../persistentBase/PersistentBaseRewardTypes';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem } from '../systems/CombatSystem';
import type { PowerUpSystem } from '../powerups/PowerUpSystem';
import type { LoadoutManager } from '../loadout/LoadoutManager';
import { CoopDefenseCarrySystem } from '../systems/CoopDefenseCarrySystem';
import { CoopDefenseMissionBarrierManager } from '../systems/CoopDefenseMissionBarrierManager';
import { CoopDefenseMissionProgressSystem } from '../systems/CoopDefenseMissionProgressSystem';
import { CoopDefenseObjectivePlacementRewardSystem } from '../systems/CoopDefenseObjectivePlacementRewardSystem';
import { CoopDefenseObjectiveRepairSystem } from '../systems/CoopDefenseObjectiveRepairSystem';
import { CoopDefenseRoundStateSystem } from '../systems/CoopDefenseRoundStateSystem';
import { CoopDefenseSecondaryObjectiveSystem } from '../systems/CoopDefenseSecondaryObjectiveSystem';
import type { CoopDefenseTeamBuffSystem } from '../systems/CoopDefenseTeamBuffSystem';
import type { CoopMissionActivityConfiguration } from './CoopMissionActivityConfig';
import type { CoopMissionObjectiveRuntime, CoopMissionRuntime } from './CoopMissionRuntime';
import type { PlayerCapabilities } from '../world/PlayerCapabilities';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { CoopDefenseMissionProgressPresentationState } from '../types';

export interface CoopMissionObjectiveCompositionOptions {
  readonly activity: CoopMissionActivityConfiguration;
  readonly humanPlayerCount: number;
  readonly worldRevision: number;
  readonly worldMetrics: WorldMetrics;
  readonly scene: Phaser.Scene;
  readonly physicsGroup: Phaser.Physics.Arcade.StaticGroup | undefined;
  readonly isHost: boolean;
  readonly baseManager: BaseManager | null;
  readonly playerManager: PlayerManager;
  readonly combatSystem: CombatSystem;
  readonly powerUpSystem: PowerUpSystem | null;
  readonly loadoutManager: LoadoutManager | null;
  readonly teamBuffSystem: CoopDefenseTeamBuffSystem | null;
  readonly getPlayerCapabilities: (playerId: string) => PlayerCapabilities;
  readonly getSecondsLeft: () => number;
  readonly getConnectedPlayerIds: () => readonly string[];
  readonly getSpectatorIds: () => readonly string[];
  readonly isPlayerBurrowed: (playerId: string) => boolean;
  readonly publishMissionProgress: (state: CoopDefenseMissionProgressPresentationState | null) => void;
  readonly broadcastCarryDeliveredFx: (x: number, y: number) => void;
  readonly patchBarrierCells: (changes: readonly { gridX: number; gridY: number; occupied: boolean }[]) => void;
  readonly markLightDirty: () => void;
  readonly grantPersistentBaseRewards: (rewardIds: readonly PersistentBaseRewardId[] | undefined) => void;
}

/** Owns the complete objective/progress/barrier/round-state Activity graph. */
export class CoopMissionObjectiveComposition {
  constructor(private readonly options: CoopMissionObjectiveCompositionOptions) {}

  materialize(runtime: CoopMissionRuntime): void {
    const mapConfig = this.options.activity.mapConfig;
    const objectives = resolveCoopDefenseMapSecondaryObjectives(mapConfig, this.options.humanPlayerCount);
    const progressConfig = resolveCoopDefenseMapMissionProgress(mapConfig);
    const baseManager = this.options.baseManager;
    const barriers = progressConfig
      ? new CoopDefenseMissionBarrierManager(this.options.scene, progressConfig, this.options.worldMetrics, {
        physicsGroup: this.options.physicsGroup,
        onOccupancyChanged: (changes) => {
          this.options.patchBarrierCells(changes);
          this.options.markLightDirty();
        },
      })
      : null;
    const repair = this.options.isHost && baseManager
      ? new CoopDefenseObjectiveRepairSystem({
        healBase: (baseId, amount) => baseManager.heal(baseId, amount),
        getBaseHp: (baseId) => baseManager.getBase(baseId)?.getHp() ?? null,
        getBaseMaxHp: (baseId) => baseManager.getBase(baseId)?.getMaxHp() ?? null,
      })
      : null;
    const placementReward = this.options.isHost && baseManager
      ? new CoopDefenseObjectivePlacementRewardSystem(objectives, {
        isEligiblePlayer: (playerId) => this.options.getPlayerCapabilities(playerId).canUseMissionActions,
        getBasePosition: (baseId) => {
          const base = baseManager.getBase(baseId);
          if (!base) return null;
          return getBaseRewardPickupWorldPosition(
            base.getSpec(),
            this.options.worldMetrics,
            baseManager.getBases().map((entry) => entry.getSpec()),
          );
        },
        spawnMarker: (objectiveId, powerUpDefId, x, y) => (
          this.options.powerUpSystem?.spawnObjectiveRewardMarker(objectiveId, powerUpDefId, x, y) !== null
        ),
        removeMarker: (objectiveId) => this.options.powerUpSystem?.clearObjectiveReward(objectiveId),
        spawnPickup: (objectiveId, powerUpDefId, x, y) => (
          this.options.powerUpSystem?.spawnObjectiveRewardPickup(objectiveId, powerUpDefId, x, y) !== null
        ),
        addTemporaryUtility: (playerId, config) => (
          this.options.loadoutManager?.addTemporaryUtility(playerId, config, 1) !== null
        ),
        releaseTemporaryUtility: (playerId, objectiveId) => (
          this.options.loadoutManager?.releaseTemporaryUtilityForObjective(playerId, objectiveId)
        ),
      })
      : null;
    const secondaryObjectives = this.options.isHost && objectives.length > 0
      ? new CoopDefenseSecondaryObjectiveSystem(objectives, {
        isObjectivePriorityRequested: (objectiveId) => (
          runtime.coopDefenseMissionProgressSystem?.isMandatoryDefenseObjectivePrioritized(objectiveId) ?? false
        ),
        isEncounterCleared: (encounterId) => runtime.coopDefenseMapDirector?.isEncounterCleared(encounterId) ?? false,
        isExternalTriggerSatisfied: (trigger) => {
          if (trigger.type === 'after-checkpoint') {
            return runtime.coopDefenseMissionProgressSystem?.isCheckpointActivated(trigger.checkpointId) ?? false;
          }
          if (trigger.type === 'after-defense') {
            return runtime.coopDefenseMissionProgressSystem?.isDefenseResolved(trigger.defenseId) ?? false;
          }
          return false;
        },
        onObjectiveActivated: (objectiveId) => {
          runtime.coopDefenseCarrySystem?.activateObjective(objectiveId);
          const config = objectives.find((entry) => entry.id === objectiveId);
          if (config?.rewards?.placeablePedestalOnComplete) {
            runtime.coopDefenseObjectivePlacementRewardSystem?.begin(objectiveId);
          }
        },
        onObjectiveCompleted: (objectiveId) => {
          const config = objectives.find((entry) => entry.id === objectiveId);
          this.options.grantPersistentBaseRewards(config?.rewards?.persistentBaseRewardsOnComplete);
          const reward = config?.rewards?.teamBuffOnComplete;
          if (reward) this.options.teamBuffSystem?.activate(reward, Date.now());
        },
        onHoldFailed: (objectiveId) => {
          runtime.coopDefenseObjectivePlacementRewardSystem?.cancel(objectiveId);
        },
        onHoldCompleted: (objectiveId) => {
          const config = objectives.find((entry) => entry.id === objectiveId);
          if (config?.rewards?.repairTargetOnComplete === true) {
            for (const targetId of config.targets) runtime.coopDefenseObjectiveRepairSystem?.start(targetId);
          }
          if (config?.rewards?.placeablePedestalOnComplete) {
            runtime.coopDefenseObjectivePlacementRewardSystem?.activate(objectiveId);
          }
        },
      })
      : null;
    const missionProgress = this.options.isHost && progressConfig
      ? new CoopDefenseMissionProgressSystem(progressConfig, {
        roundRevision: this.options.worldRevision,
        worldMetrics: this.options.worldMetrics,
        getDefenseObjectiveState: (objectiveId) => (
          runtime.coopDefenseSecondaryObjectiveSystem?.getObjectiveState(objectiveId) ?? null
        ),
        isEncounterCleared: (encounterId) => runtime.coopDefenseMapDirector?.isEncounterCleared(encounterId) ?? false,
        onPresentationChanged: (state) => {
          barriers?.syncPresentationState(state);
          this.options.publishMissionProgress(state);
        },
      })
      : null;
    for (const player of this.options.playerManager.getAllPlayers()) {
      missionProgress?.resetPlayerPosition(player.id, player.x, player.y);
    }
    this.options.publishMissionProgress(missionProgress?.getPresentationState() ?? null);
    const carry = this.options.isHost && objectives.some(
      (config) => config.type === 'carry' && config.carry !== undefined,
    )
      ? new CoopDefenseCarrySystem(objectives, this.options.playerManager, {
        isPlayerEligible: (playerId) => this.options.getPlayerCapabilities(playerId).canUseMissionActions,
        isPlayerAlive: (playerId) => this.options.combatSystem.isAlive(playerId),
        isPlayerBurrowed: this.options.isPlayerBurrowed,
        onDelivered: (objectiveId, itemId) => (
          runtime.coopDefenseSecondaryObjectiveSystem?.reportCarryDelivered(objectiveId, itemId) ?? false
        ),
        onDeliveredFx: (x, y) => this.options.broadcastCarryDeliveredFx(x, y),
      })
      : null;
    const roundState = this.options.isHost && baseManager
      ? this.createRoundState(runtime, baseManager)
      : null;
    runtime.setObjectives({
      secondaryObjectives,
      missionProgress,
      barriers,
      carry,
      repair,
      placementReward,
      roundState,
    });
  }

  private createRoundState(
    runtime: CoopMissionRuntime,
    baseManager: BaseManager,
  ): CoopDefenseRoundStateSystem {
    const objective = this.options.activity.mapConfig.objective;
    return new CoopDefenseRoundStateSystem({
      baseManager,
      objective,
      getSecondsLeft: this.options.getSecondsLeft,
      isBossDefeated: () => runtime.coopDefenseBossSystem?.isBossDefeated() ?? false,
      isAssaultRepelled: () => runtime.coopDefenseMapDirector?.isAssaultRepelled() ?? false,
      isTeamWipedOut: () => runtime.playerActivity?.isTeamWiped(
        this.options.getConnectedPlayerIds(),
        this.options.getSpectatorIds(),
      ) ?? false,
      isAdvanceComplete: () => runtime.coopDefenseMissionProgressSystem?.isRouteComplete() ?? false,
      isAdvanceFailed: () => runtime.coopDefenseMissionProgressSystem?.isMissionFailed() ?? false,
    });
  }
}
