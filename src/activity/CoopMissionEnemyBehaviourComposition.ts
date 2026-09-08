import { CoopDefenseDecoyTargetSystem } from '../systems/CoopDefenseDecoyTargetSystem';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import { ENEMY_FLOW_FIELD_IDS } from '../systems/flowfield/FlowFieldCoordinator';
import type { BaseManager } from '../entities/BaseManager';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { PlayerManager } from '../entities/PlayerManager';
import { CoopDefenseEnemyAbilitySystem, type CoopDefenseEnemyAbilityNetworkPort } from '../systems/CoopDefenseEnemyAbilitySystem';
import { CoopDefenseEnemyAttackSystem } from '../systems/CoopDefenseEnemyAttackSystem';
import { CoopDefenseEnemyBurrowSystem } from '../systems/CoopDefenseEnemyBurrowSystem';
import { CoopDefenseEnemyCombatPositioningSystem } from '../systems/CoopDefenseEnemyCombatPositioningSystem';
import { CoopDefenseEnemyDodgeSystem } from '../systems/CoopDefenseEnemyDodgeSystem';
import { CoopDefenseEnemyTrainAwarenessSystem } from '../systems/CoopDefenseEnemyTrainAwarenessSystem';
import type { EnergyShieldSystem } from '../systems/EnergyShieldSystem';
import type { StinkCloudSystem } from '../effects/StinkCloudSystem';
import type { FireChunkBurstPort } from '../systems/FlamethrowerUpgradeSystem';
import type { FireSystem } from '../effects/FireSystem';
import type { DecoySystem } from '../systems/DecoySystem';
import type { CombatActivityPort } from '../combat/CombatCapabilities';
import type { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { TrainAwarenessSource } from '../systems/CoopDefenseEnemyTrainAwarenessSystem';
import type { CoopMissionRuntime } from './CoopMissionRuntime';
import type { TrainEventConfig } from '../types';
import type { AutomatedWeaponExecution } from '../world/AutomatedWeaponExecutionAdapter';
import type { TranslocatorProjectilePort } from '../projectile/ProjectileExternalInteractionPort';
import type { ProjectileThreatReadPort } from '../projectile/ProjectileReadPorts';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';

export interface CoopMissionEnemyBehaviourCompositionOptions {
  readonly playerManager: PlayerManager;
  readonly projectileSpawn: ProjectileSpawnPort;
  readonly projectileThreatReadPort: ProjectileThreatReadPort;
  readonly translocatorProjectilePort: TranslocatorProjectilePort;
  readonly combatSystem: CombatActivityPort;
  readonly hostPhysics: HostPhysicsSystem;
  readonly baseManager: BaseManager;
  readonly weaponExecution: AutomatedWeaponExecution;
  readonly placementSystem: PlacementSystem;
  readonly energyShieldSystem: EnergyShieldSystem | null;
  readonly stinkCloudSystem: StinkCloudSystem;
  readonly playerFireChunkPort: FireChunkBurstPort | null;
  readonly fireSystem: FireSystem;
  readonly decoySystem: DecoySystem | null;
  readonly enemyAbilityNetwork: CoopDefenseEnemyAbilityNetworkPort;
  readonly getTrainManager: () => TrainAwarenessSource | null;
  readonly getTrainEvent: () => TrainEventConfig | undefined;
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
  readonly getRockObjects: () => readonly (import('../arena/rocks/RockPhysicsProxy').RockPhysicsProxy | null)[] | null;
}

/** Owns all Activity-scoped enemy behaviour callbacks and behaviour systems. */
export class CoopMissionEnemyBehaviourComposition {
  constructor(private readonly options: CoopMissionEnemyBehaviourCompositionOptions) {}

  materialize(runtime: CoopMissionRuntime): void {
    const enemyManager = runtime.enemyManager;
    if (!enemyManager) throw new Error('[CoopMissionEnemyBehaviourComposition] EnemyManager is missing');

    const trainAwareness = new CoopDefenseEnemyTrainAwarenessSystem(
      this.options.getTrainManager,
      this.options.getTrainEvent,
      (enemy, now) => enemy.getMoveSpeed()
        * this.options.hostPhysics.getWorldMovementFactorAt(enemy.sprite.x, enemy.sprite.y, now),
    );
    const burrow = new CoopDefenseEnemyBurrowSystem(
      enemyManager,
      (enemyId, enabled) => this.options.hostPhysics.setEnemyBurrowed(enemyId, !enabled),
      this.options.isSafeEnemyGroundAt,
      this.options.findSafeEnemyGroundPosition,
    );
    trainAwareness.setBurrowSource(burrow);
    const dodge = new CoopDefenseEnemyDodgeSystem(
      enemyManager,
      this.options.playerManager,
      this.options.projectileThreatReadPort,
      this.options.combatSystem,
      this.options.hostPhysics,
      this.options.isFreeEnemyGroundAt,
      this.options.hasWalkableEnemyCircleLine,
    );
    const combatPositioning = new CoopDefenseEnemyCombatPositioningSystem(
      enemyManager,
      this.options.playerManager,
      this.options.combatSystem,
      this.options.isFreeEnemyGroundAt,
      this.options.hasWalkableEnemyCircleLine,
      runtime.enemyAiTargetCatalog,
    );
    const ability = new CoopDefenseEnemyAbilitySystem(
      enemyManager,
      this.options.playerManager,
      this.options.projectileSpawn,
      this.options.combatSystem,
      this.options.energyShieldSystem,
      this.options.stinkCloudSystem,
      this.options.playerFireChunkPort,
      this.options.fireSystem,
      this.options.enemyAbilityNetwork,
      runtime.enemyAiTargetCatalog,
      this.options.decoySystem,
      this.options.translocatorProjectilePort,
    );
    const attack = new CoopDefenseEnemyAttackSystem(
      enemyManager,
      this.options.playerManager,
      this.options.baseManager,
      this.options.combatSystem,
      this.options.weaponExecution,
      this.options.getRockObjects,
      trainAwareness,
      this.options.placementSystem,
      runtime.enemyAiTargetCatalog,
    );

    const coordinator = runtime.flowFieldCoordinator;
    const decoyTargets = coordinator && runtime.enemyStrategicTargetService ? new CoopDefenseDecoyTargetSystem({
      coordinator,
      strategicTargets: runtime.enemyStrategicTargetService,
      getEnemies: () => enemyManager.getAllEnemies().map(enemy => {
        const config = getCoopDefenseEnemyConfig(enemy.kind);
        const movementFieldId = config.movementTarget === 'players-and-armed-constructs'
          ? ENEMY_FLOW_FIELD_IDS.strategic : config.isBoss && runtime.enemyBossFlowFieldService
            ? ENEMY_FLOW_FIELD_IDS.boss : config.movementTarget === 'players'
              || runtime.enemyFlowFieldService?.hasGoalCells() === false
              ? ENEMY_FLOW_FIELD_IDS.player : ENEMY_FLOW_FIELD_IDS.base;
        return {
          id: enemy.id, x: enemy.sprite.x, y: enemy.sprite.y,
          alive: enemy.sprite.active && enemy.getHp() > 0, hostile: enemy.faction === 'hostile',
          movementFieldId, clearanceCells: coordinator.getFieldClearanceCells(movementFieldId),
        };
      }),
      getAttackTarget: enemyId => runtime.coopDefenseVoidHunterSystem?.getCurrentTarget(enemyId)
        ?? runtime.coopDefenseTimebombSystem?.getCurrentTarget(enemyId)
        ?? ability.getCurrentTarget(enemyId)
        ?? attack.getCurrentTarget(enemyId),
      isEnemyOfOwner: (enemyId, ownerId) => this.options.combatSystem.canDamageTarget(enemyId, ownerId),
      canSee: (enemy, x, y, range) => enemyManager.canSeeThroughSmoke(enemy.id, x, y, range)
        && this.options.combatSystem.hasLineOfSight(enemy.x, enemy.y, x, y),
    }) : null;
    attack.setDecoyTargets(decoyTargets);
    combatPositioning.setDecoyTargets(decoyTargets);
    ability.setDecoyTargets(decoyTargets);

    runtime.setEnemyBehaviour({
      trainAwareness,
      burrow,
      dodge,
      combatPositioning,
      ability,
      attack,
      decoyTargets,
    });
    runtime.bind({
      attach: () => {
        this.options.decoySystem?.setLifecyclePort(decoyTargets);
        if (decoyTargets) for (const decoy of this.options.decoySystem?.runtime.values() ?? []) decoyTargets.activated(decoy);
        enemyManager.setEnemySpawnedCallback((enemy: EnemyEntity, options) => {
          burrow.notifyEnemySpawned(enemy, options);
        });
        this.options.hostPhysics.setEnemyRockContactCallback((enemyId, rock, now) => {
          attack.recordObstacleContact(enemyId, rock, now);
        });
      },
      detach: () => {
        this.options.decoySystem?.setLifecyclePort(null);
        enemyManager.setEnemySpawnedCallback(null);
        this.options.hostPhysics.setEnemyRockContactCallback(null);
      },
    });
  }
}
