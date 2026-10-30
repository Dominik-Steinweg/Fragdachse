import { CoopDefenseDecoyTargetSystem } from '../systems/CoopDefenseDecoyTargetSystem';
import { createEnemyLaneClearance } from '../systems/enemyLaneClearance';
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
import { CoopDefenseEnemyHopSystem } from '../systems/CoopDefenseEnemyHopSystem';
import { CoopDefenseEnemyPounceSystem, type EnemyPounceTarget } from '../systems/CoopDefenseEnemyPounceSystem';
import { CoopDefenseEnemyHeatBurstSystem } from '../systems/CoopDefenseEnemyHeatBurstSystem';
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

export interface HeatBurstRequest {
  readonly enemyId: string;
  readonly kind: string;
  readonly faction: 'hostile' | 'allied';
  /** Necromancy owner of an allied body (kill credit). */
  readonly ownerId?: string;
  readonly x: number;
  readonly y: number;
  readonly config: import('../config/coopDefenseEnemies').CoopDefenseEnemyHeatBurstConfig;
  readonly nowMs: number;
}

/** Host damage of enemy abilities that outlive or sweep past their source. */
export interface EnemyAreaEffectsPort {
  deathBurst(enemyId: string, x: number, y: number, burst: import('../config/coopDefenseEnemies').CoopDefenseEnemyDeathBurstConfig, nowMs: number): void;
  /** Damage, player push and splash of an armed hop landing. */
  landingShock(enemyId: string, x: number, y: number, shock: import('../config/coopDefenseEnemies').CoopDefenseEnemyLandingShockConfig, nowMs: number): void;
  /** Damage, player push and dust of a pounce arriving at its announced point. */
  pounceImpact(enemyId: string, kind: string, x: number, y: number, impact: import('../config/coopDefenseEnemies').CoopDefenseEnemyLandingImpactConfig, nowMs: number): void;
  /** Area hit, fire chunks and effect of a heat burst around a body; its faction decides targets and palette. */
  heatBurst(burst: HeatBurstRequest): void;
  /** Harmless pop of a body killed with heat in it. */
  heatFizzle(x: number, y: number, radius: number, faction: 'hostile' | 'allied'): void;
  sweepBases(enemyId: string, ax: number, ay: number, bx: number, by: number, radius: number, damage: number, nowMs: number): void;
}

export interface CoopMissionEnemyBehaviourCompositionOptions {
  readonly playerManager: PlayerManager;
  readonly enemyAreaEffects?: EnemyAreaEffectsPort;
  /** Drops a body that left without dying (a heat burst) from player-held references. */
  readonly removeEnemyFromPlayerItems: (enemyId: string) => void;
  readonly getNowMs?: () => number;
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
  /** Reaktive Map-Objekte im Hindernisraum; Gegner greifen sie nie gezielt an. */
  readonly isReactivePropObstacle?: (obstacleIndex: number) => boolean;
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
      this.options.findSafeEnemyGroundPosition,
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
        ?? runtime.coopDefenseKaboomtulaSystem?.getCurrentTarget(enemyId)
        ?? runtime.coopDefenseEnemyPounceSystem?.getCurrentTarget(enemyId)
        ?? ability.getCurrentTarget(enemyId)
        ?? attack.getCurrentTarget(enemyId),
      isEnemyOfOwner: (enemyId, ownerId) => this.options.combatSystem.canDamageTarget(enemyId, ownerId),
      canSee: (enemy, x, y, range) => enemyManager.canSeeThroughSmoke(enemy.id, x, y, range)
        && this.options.combatSystem.hasLineOfSight(enemy.x, enemy.y, x, y),
    }) : null;
    attack.setDecoyTargets(decoyTargets);
    const fireSystem = this.options.fireSystem;
    attack.setFlameGround({ ignite: (enemy, x, y, cell, now) => {
      fireSystem.hostRefreshGroundCell(x, y, { sourceKey: `${cell.sourceId}:${enemy.id}`, ownerId: enemy.id,
        durationMs: cell.durationMs, sourceId: cell.sourceId, visualStyle: cell.visualStyle, damageTarget: cell.damageTarget,
        baseDamageMult: cell.baseDamageMult,
        burn: { durationMs: cell.burnDurationMs, damagePerTick: cell.burnDamagePerTick, visualStyle: cell.visualStyle },
        combatSource: fireSystem.captureCombatSource?.(enemy.id, cell.sourceId) }, now);
    }, scorchBase: (enemy, baseId, damage, sourceId, now) => {
      const combat = this.options.combatSystem, source = combat.captureWorldDamageSource(enemy.id, sourceId, 'direct');
      combat.applyBaseStatusDamage(baseId, damage, source, now);
    } });
    attack.setIntents(runtime.enemyIntents);
    attack.setObstacleExclusion(this.options.isReactivePropObstacle ?? null);
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
        laneClearance: createEnemyLaneClearance(combat, this.options.hasWalkableEnemyCircleLine),
        strike: (targetId, chargerId, damage, x, y, now) => combat.resolveChargeContact?.(targetId, chargerId, damage, x, y, now) ?? false,
        knockback: (targetId, vx, vy, durationMs, sourceId) => this.options.hostPhysics.addRecoil(targetId, vx, vy, durationMs, sourceId),
        structureSweep: (enemy, ax, ay, bx, by, radius, damage, now) => this.options.enemyAreaEffects?.sweepBases(enemy.id, ax, ay, bx, by, radius, damage, now),
      }));
      runtime.setHop(new CoopDefenseEnemyHopSystem({
        enemies: enemyManager,
        combat,
        readSteering: enemy => {
          const intent = intents.get(enemy.id);
          const field = intents.getField(enemy.id);
          const costAt = (x: number, y: number) => {
            const route = field?.queryNavigation(x, y);
            return route?.status === 'ready' ? route.cost : null;
          };
          // Allies steer where necromancy would walk them (null = hold the follow place).
          if (enemy.faction === 'allied') {
            const point = runtime.necromancySystem?.getAllySteeringPoint(enemy.id) ?? null;
            const navigation = intent?.navigation;
            return point ? { point, originCost: navigation?.status === 'ready' ? navigation.cost : null, costAt } : null;
          }
          if (!intent) return null;
          const navigation = intent.navigation;
          const point = navigation.status === 'ready' ? navigation.waypoint
            : navigation.status === 'pending' ? navigation.continuation ?? intent.point
              : intents.getBreach(enemy.id)?.approach ?? intent.point;
          return point ? { point, originCost: navigation.status === 'ready' ? navigation.cost : null, costAt } : null;
        },
        isFree: this.options.isFreeEnemyGroundAt,
        canMove: this.options.hasWalkableEnemyCircleLine,
        combatIntent: (enemy, now) => enemy.faction === 'hostile' ? attack.getCombatMovement(enemy, now) : null,
        shockTargets: () => this.options.playerManager.getAllPlayers().filter(player => player.active)
          .map(player => ({ x: player.x, y: player.y })),
        landingShock: (enemy, x, y, shock, now) => this.options.enemyAreaEffects?.landingShock(enemy.id, x, y, shock, now),
      }));
      const pounceTarget = (ref: { readonly kind: string; readonly id: string }): EnemyPounceTarget | null => {
        if (ref.kind === 'decoy') {
          const decoy = this.options.decoySystem?.getHostTarget(Number(ref.id));
          return decoy && decoy.hp > 0 ? { ref: { kind: 'decoy', id: String(decoy.id) }, x: decoy.x, y: decoy.y, radius: decoy.radius } : null;
        }
        if (ref.kind !== 'player') return null;
        const player = this.options.playerManager.getPlayer(ref.id);
        // Players inside structures are not pounced; the bite and the structure rules handle them.
        if (!player?.active || !combat.isAlive(ref.id) || combat.isBurrowed(ref.id) || combat.getStructureOccupancyId?.(ref.id) !== undefined) return null;
        return { ref: { kind: 'player', id: ref.id }, x: player.x, y: player.y, radius: PLAYER_SIZE / 2 };
      };
      runtime.setPounce(new CoopDefenseEnemyPounceSystem({
        enemies: enemyManager,
        isStunned: (enemyId, now) => combat.isStunned?.(enemyId, now) ?? false,
        readTarget: enemy => {
          const decoy = decoyTargets?.getTarget(enemy.id);
          if (decoy) return decoy.kind === 'decoy' ? pounceTarget(decoy) : null;
          const target = intents.get(enemy.id)?.target;
          return target?.kind === 'player' ? pounceTarget(target) : null;
        },
        resolveTarget: (_enemy, ref) => pounceTarget(ref),
        canSee: (enemy, target, range) => {
          const x = enemy.sprite.x, y = enemy.sprite.y;
          return Math.hypot(target.x - x, target.y - y) <= range && enemyManager.canSeeThroughSmoke(enemy.id, target.x, target.y, range)
            && combat.hasLineOfSight(x, y, target.x, target.y);
        },
        laneClearance: createEnemyLaneClearance(combat, this.options.hasWalkableEnemyCircleLine),
        isFree: this.options.isFreeEnemyGroundAt,
        isBiting: (enemy, now) => !!attack.getCombatMovement(enemy, now)?.committed || enemy.isAttackMovementPaused(now),
        steeringPoint: enemy => {
          const navigation = intents.get(enemy.id)?.navigation;
          return navigation?.status === 'ready' ? navigation.waypoint
            : navigation?.status === 'pending' ? navigation.continuation ?? null : null;
        },
        moveNormally: (enemy, point, speed, aimAngle) => {
          const result = enemyManager.moveNormally(enemy, point, speed, aimAngle);
          return { vx: result.vx, vy: result.vy, blocked: result.waitReason !== 'none' };
        },
        impact: (enemy, x, y, impact, now) => this.options.enemyAreaEffects?.pounceImpact(enemy.id, enemy.kind, x, y, impact, now),
        onCommit: (enemy, ref) => {
          if (ref.kind === 'decoy') decoyTargets?.usedTarget(enemy.id, { kind: 'decoy', id: ref.id });
        },
      }));
      runtime.setHeatBurst(new CoopDefenseEnemyHeatBurstSystem({
        enemies: enemyManager,
        isEvadingTrain: enemyId => trainAwareness.blocksRegularAttacks(enemyId),
        burst: (enemy, x, y, config, now) => this.options.enemyAreaEffects?.heatBurst({ enemyId: enemy.id, kind: enemy.kind,
          faction: enemy.faction, ownerId: enemy.ownerId, x, y, config, nowMs: now }),
        removeWithoutKill: enemy => {
          enemyManager.hostRemoveWithoutKill(enemy.id);
          this.options.removeEnemyFromPlayerItems(enemy.id);
        },
        fizzle: (death, radius) => this.options.enemyAreaEffects?.heatFizzle(death.x, death.y, radius, death.faction),
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
