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
import { CoopDefenseShieldChargerSystem } from '../systems/CoopDefenseShieldChargerSystem';
import { CoopDefenseEnergyConeSystem } from '../systems/CoopDefenseEnergyConeSystem';
import { PLAYER_SIZE } from '../config';
import { getFirestarterFactionTargets } from '../systems/firestarterAlliedTargeting';
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
  readonly baseManager: BaseManager | null;
  readonly weaponExecution: AutomatedWeaponExecution;
  readonly placementSystem: PlacementSystem;
  readonly energyShieldSystem: EnergyShieldSystem | null;
  readonly stinkCloudSystem: StinkCloudSystem;
  readonly playerFireChunkPort: FireChunkBurstPort | null;
  readonly fireSystem: FireSystem;
  readonly decoySystem: DecoySystem | null;
  readonly enemyClawNetwork: import('../systems/EnemyClawAttack').EnemyClawNetworkPort;
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
      getMovementTarget: runtime.enemyIntents ? enemyId => runtime.enemyIntents?.get(enemyId)?.target ?? null : undefined,
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
    attack.setIntents(runtime.enemyIntents);
    runtime.enemyIntents?.setDecoys(decoyTargets);
    runtime.enemyIntents?.setPerception((enemy, x, y, range) => enemyManager.canSeeThroughSmoke(enemy.id, x, y, range));
    combatPositioning.setDecoyTargets(decoyTargets);
    ability.setDecoyTargets(decoyTargets);

    if (runtime.enemyIntents && runtime.enemyAiTargetCatalog) {
      const catalog = runtime.enemyAiTargetCatalog, intents = runtime.enemyIntents, combat = this.options.combatSystem;
      runtime.setShieldCharger(new CoopDefenseShieldChargerSystem({
        enemies: enemyManager,
        combat,
        readTarget: enemy => {
          // Necromancy allies charge the nearest hostile enemy; the lane is fixed the same way.
          if (enemy.faction === 'allied') return getFirestarterFactionTargets(enemy, catalog, 0)[0] ?? null;
          const decoy = decoyTargets?.getTarget(enemy.id);
          if (decoy) return { x: decoy.x, y: decoy.y };
          const target = intents.get(enemy.id)?.target;
          if (!target || target.kind === 'base' || target.kind === 'ally' || target.kind === 'decoy') return null;
          const resolved = catalog.resolve(target);
          return resolved ? catalog.getPosition(resolved, enemy.sprite.x, enemy.sprite.y) : null;
        },
        // Bodies of the opposing side; combat still applies the faction and shield rules per strike.
        contactTargets: enemy => {
          const opposing = enemyManager.getAllEnemies().filter(other => other !== enemy && other.faction !== enemy.faction
            && other.sprite.active && other.getHp() > 0 && !other.isBurrowed())
            .map(other => ({ id: other.id, x: other.sprite.x, y: other.sprite.y, radius: other.getCollisionRadius() }));
          if (enemy.faction === 'allied') return opposing;
          const players = this.options.playerManager.getAllPlayers().filter(player => player.active)
            .map(player => ({ id: player.id, x: player.x, y: player.y, radius: PLAYER_SIZE / 2 }));
          return [...players, ...opposing];
        },
        laneClearance: (x, y, angle, length, radius) => {
          let free = combat.measureChargeLane?.(x, y, angle, length, radius) ?? 0;
          // Water and other walkability limits: shorten until the swept body path is walkable.
          const walkable = (distance: number) => this.options.hasWalkableEnemyCircleLine(x, y,
            x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, radius);
          if (free > 0 && !walkable(free)) {
            let low = 0, high = free;
            for (let i = 0; i < 10; i++) { const mid = (low + high) / 2; if (walkable(mid)) low = mid; else high = mid; }
            free = low;
          }
          return free;
        },
        strike: (targetId, chargerId, damage, x, y, now) => combat.resolveChargeContact?.(targetId, chargerId, damage, x, y, now) ?? false,
        knockback: (targetId, vx, vy, durationMs, sourceId) => this.options.hostPhysics.addRecoil(targetId, vx, vy, durationMs, sourceId),
      }));
      runtime.setEnergyCone(new CoopDefenseEnergyConeSystem({
        enemies: enemyManager,
        combat,
        readTarget: enemy => {
          if (enemy.faction === 'allied') return getFirestarterFactionTargets(enemy, catalog, 0)[0] ?? null;
          const decoy = decoyTargets?.getTarget(enemy.id);
          if (decoy) return { x: decoy.x, y: decoy.y };
          const target = intents.get(enemy.id)?.target;
          if (!target || target.kind === 'base' || target.kind === 'ally' || target.kind === 'decoy') return null;
          const resolved = catalog.resolve(target);
          return resolved ? catalog.getPosition(resolved, enemy.sprite.x, enemy.sprite.y) : null;
        },
        impulseTargets: enemy => {
          // Opposing faction bodies (allies hit hostiles and vice versa), plus players and decoys for hostile casters.
          const opposing = enemyManager.getAllEnemies().filter(other => other !== enemy && other.faction !== enemy.faction
            && other.sprite.active && other.getHp() > 0 && !other.isBurrowed())
            .map(other => ({ id: other.id, x: other.sprite.x, y: other.sprite.y, radius: other.getCollisionRadius() }));
          if (enemy.faction === 'allied') return opposing;
          const players = this.options.playerManager.getAllPlayers().filter(player => player.active)
            .map(player => ({ id: player.id, x: player.x, y: player.y, radius: PLAYER_SIZE / 2 }));
          const decoys = (this.options.decoySystem?.getHostTargets() ?? []).filter(decoy => decoy.hp > 0)
            .map(decoy => ({ id: `decoy_${decoy.id}`, x: decoy.x, y: decoy.y, radius: decoy.radius }));
          return [...players, ...decoys, ...opposing];
        },
        measureRay: (x, y, angle, length) => combat.measureConeRay?.(x, y, angle, length) ?? 0,
        impulse: (targetId, casterId, damage, originX, originY, targetX, targetY, now) =>
          combat.resolveConeImpulse?.(targetId, casterId, damage, originX, originY, targetX, targetY, now) ?? false,
      }));
    }

    runtime.setEnemyBehaviour({
      trainAwareness,
      burrow,
      dodge,
      combatPositioning,
      ability,
      attack,
      decoyTargets,
    });
    let unsubscribeClaw: (() => void) | null = null;
    runtime.bind({
      attach: () => {
        unsubscribeClaw = this.options.enemyClawNetwork.subscribe(event => enemyManager.applyClawEvent(event));
        enemyManager.setEnemyRemovingCallback(enemy => attack.removeEnemy(enemy));
        attack.setClawStateSink((enemy, state) => {
          const event = enemyManager.publishClawState(enemy, state);
          if (event) this.options.enemyClawNetwork.broadcast(event);
        });
        this.options.decoySystem?.setLifecyclePort(decoyTargets);
        if (decoyTargets) for (const decoy of this.options.decoySystem?.runtime.values() ?? []) decoyTargets.activated(decoy);
        enemyManager.setEnemySpawnedCallback((enemy: EnemyEntity, options) => {
          burrow.notifyEnemySpawned(enemy, options);
        });
      },
      detach: () => {
        attack.destroy();
        enemyManager.setEnemyRemovingCallback(null);
        unsubscribeClaw?.(); unsubscribeClaw = null;
        this.options.decoySystem?.setLifecyclePort(null);
        enemyManager.setEnemySpawnedCallback(null);
        this.options.hostPhysics.setEnemyRockContactCallback(null);
      },
    });
  }
}
