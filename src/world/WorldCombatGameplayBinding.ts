import type { BaseManager } from '../entities/BaseManager';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { FireSystem } from '../effects/FireSystem';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { DecoySystem } from '../systems/DecoySystem';
import type { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import type { CombatSystem, HitscanSupportImpact } from '../systems/CombatSystem';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { ResourceSystem } from '../systems/ResourceSystem';
import type { BurrowSystem } from '../systems/BurrowSystem';
import type { LoadoutManager } from '../loadout/LoadoutManager';
import type { PowerUpSystem } from '../powerups/PowerUpSystem';
import type { TargetStatusSystem } from '../systems/TargetStatusSystem';
import type { WorldMetrics } from './WorldMetrics';
import type { WorldScopedBinding } from './WorldRuntime';
import type { WorldGeometryBinding } from './WorldGeometryBinding';
import type { WorldParticipation } from './WorldParticipation';
import { hasWorldFigure } from './WorldParticipation';
import type { WorldPlayerGameplaySystems } from './WorldPlayerGameplayRuntime';
import type {
  ExplosionVisualStyle,
  FireChunkTarget,
  GroundFireVisualStyle,
  HitscanSupportEffect,
  LoadoutSlot,
  PlayerProfile,
  SlimeBloomTarget,
  SupportProjectileImpact,
  TrackedProjectile,
} from '../types';
import type { TargetStatusTarget } from '../systems/TargetStatusSystem';
import type { EnergyInjectorSystem } from '../systems/EnergyInjectorSystem';
import type { TargetFootprint } from '../systems/ReinforcementMatrixSystem';
import type { CoopDefenseSecondaryObjectiveState } from '../types';
import type { CoopDefenseTimebombSystem } from '../systems/CoopDefenseTimebombSystem';
import type { NecromancySystem } from '../systems/NecromancySystem';
import type { TeslaDomeSystem } from '../systems/TeslaDomeSystem';
import type { EnergyShieldSystem } from '../systems/EnergyShieldSystem';
import type { ShieldBuffSystem } from '../systems/ShieldBuffSystem';
import type { TimeBubbleSystem } from '../systems/TimeBubbleSystem';
import type { TurretSystem, AutomatedTurretId } from '../systems/TurretSystem';
import {
  COOP_DEFENSE_BASE_TURRET_OWNER_ID,
  COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID,
  COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID,
  COLORS,
  CELL_SIZE,
  HP_MAX,
  PLAYER_SPEED,
  TEAM_BLUE_COLOR,
  TEAM_RED_COLOR,
  DASH_GROUND_FIRE_BURN_DURATION_MS,
  DASH_GROUND_FIRE_DAMAGE_PER_TICK,
  DASH_T2_S,
  PLAYER_COLORS,
} from '../config';
import { getBaseDestructionBlast } from '../effects/BaseDestructionPlan';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, type PlaceableTurretUtilityConfig, type TeslaDomeWeaponFireConfig, type WeaponConfig } from '../loadout/LoadoutConfig';
import { TeslaDomeSystem as ConcreteTeslaDomeSystem } from '../systems/TeslaDomeSystem';
import { EnergyShieldSystem as ConcreteEnergyShieldSystem } from '../systems/EnergyShieldSystem';
import { ShieldBuffSystem as ConcreteShieldBuffSystem } from '../systems/ShieldBuffSystem';
import { TimeBubbleSystem as ConcreteTimeBubbleSystem } from '../systems/TimeBubbleSystem';
import { TurretSystem as ConcreteTurretSystem } from '../systems/TurretSystem';

export interface WorldCombatKillEvent {
  readonly killerId: string;
  readonly killerName: string;
  readonly killerColor: number;
  readonly sourceId: string;
  readonly victimId: string;
  readonly victimName: string;
  readonly victimColor: number;
}

export interface WorldCombatNetworkPort {
  readonly authority: {
    readonly isHost: () => boolean;
    readonly isEnemyPair: (firstPlayerId: string, secondPlayerId: string) => boolean;
    readonly getPlayerProfile: (playerId: string) => PlayerProfile | undefined;
    readonly getConnectedPlayers: () => readonly PlayerProfile[];
  };
  readonly round: {
    readonly canPlayerInitialSpawn: (playerId: string) => boolean;
    readonly canPlayerRespawn: (playerId: string) => boolean;
    readonly canPlayerReceiveRoundRewards: (playerId: string) => boolean;
    readonly addCoopDefenseRoundXp: (amount: number) => void;
  };
  readonly stats: {
    readonly recordPlayerDamageTaken: (playerId: string, hpLost: number, armorLost: number) => void;
    readonly addPlayerRoomDamage: (playerId: string, amount: number) => void;
    readonly recordHealingReceived: (playerId: string, amount: number) => void;
    readonly recordArmorReceived: (playerId: string, amount: number) => void;
    readonly recordPlayerDeath: (playerId: string) => void;
    readonly recordPlayerKill: (playerId: string, kind: 'pvp' | 'pve') => void;
    readonly incrementPlayerFrags: (playerId: string) => void;
  };
  readonly effects: {
    readonly broadcastSlimeBloomEffect: (x: number, y: number, targets: readonly SlimeBloomTarget[]) => void;
    readonly broadcastExplosionEffect: (x: number, y: number, radius: number, color?: number, style?: ExplosionVisualStyle) => void;
    readonly broadcastBfgLaserBatch: (
      lines: readonly { sx: number; sy: number; ex: number; ey: number }[],
      color: number,
      visualPreset?: 'asmd_primary',
      projectileId?: number,
    ) => void;
    readonly broadcastMiniRocketCollectionEffect: (x: number, y: number, color: number) => void;
    readonly broadcastMiniRocketDestructionEffect: (x: number, y: number, color: number) => void;
    readonly broadcastKillEvent: (event: WorldCombatKillEvent) => void;
  };
}

export interface WorldCombatGameplaySystems {
  readonly shieldBuff: ShieldBuffSystem;
  readonly timeBubble: TimeBubbleSystem;
  readonly teslaDome: TeslaDomeSystem;
  readonly energyShield: EnergyShieldSystem;
  readonly turret: TurretSystem;
}

export interface WorldCombatImpactPort {
  readonly applyEnergyInjectorTargetHit: (
    targetType: 'player' | 'enemy' | 'construction' | 'base',
    targetId: string,
    x: number,
    y: number,
    projectile: TrackedProjectile,
  ) => void;
  readonly applyHitscanSupportImpact: (
    impact: HitscanSupportImpact,
    effect: HitscanSupportEffect,
    attackerId: string,
    sourceSlot?: LoadoutSlot,
  ) => void;
  readonly applySupportProjectileImpact: (
    projectile: TrackedProjectile,
    impact: SupportProjectileImpact,
  ) => void;
  readonly applyTeslaRockDamage: (index: number, damage: number, ownerId: string) => void;
  readonly applyTeslaTurretDamage: (id: number, damage: number, ownerId: string) => void;
  readonly resolveProjectileProximityPulse: (
    projectile: TrackedProjectile,
  ) => { lines: { sx: number; sy: number; ex: number; ey: number }[] };
  readonly resolveBfgPlayerProximityPulse: (
    projectile: TrackedProjectile,
  ) => { sx: number; sy: number; ex: number; ey: number }[];
}

export interface WorldCombatGameplayBindingOptions {
  readonly playerManager: PlayerManager;
  readonly projectileManager: ProjectileManager;
  readonly combatSystem: CombatSystem;
  readonly hostPhysics: HostPhysicsSystem;
  readonly decoySystem: DecoySystem;
  readonly fireSystem: FireSystem;
  readonly gameAudioSystem: GameAudioSystem;
  readonly placementSystem: PlacementSystem;
  readonly baseManager: BaseManager | null;
  readonly worldMetrics: WorldMetrics;
  readonly isCoopMission: () => boolean;
  readonly isActivityActive: () => boolean;
  readonly getWorldParticipation: (playerId: string) => WorldParticipation;
  readonly getPlayerCapabilities: (playerId: string) => { canUseCombat: boolean };
  readonly getEnemyManager: () => EnemyManager | null;
  readonly getPlayerSystems: () => WorldPlayerGameplaySystems | null;
  readonly getPowerUpSystem: () => PowerUpSystem | null;
  readonly getTargetStatusSystem: () => TargetStatusSystem | null;
  readonly getEnergyInjectorSystem: () => EnergyInjectorSystem | null;
  readonly getWorldGeometryBinding: () => WorldGeometryBinding | null;
  readonly getPersistentBaseId: () => string | undefined;
  readonly getConstructionMuzzleOffset: (constructionId: string | number | undefined) => number | undefined;
  readonly getTargetFootprint: (target: TargetStatusTarget) => TargetFootprint | null;
  readonly resolveObstacleDamage: (rockId: number, damage: number, attackerId: string) => number;
  readonly applyObstacleDamageById: (rockId: number, damage: number, attackerId: string) => number;
  readonly handleDestroyedRock: (rockId: number, reason: 'damage', attackerId: string) => void;
  readonly updateTurretAngle: (rockId: number, angle: number) => void;
  readonly spawnImpactCloud: (projectile: TrackedProjectile, x: number, y: number) => void;
  readonly resetPlayerPosition: (playerId: string, x: number, y: number) => void;
  readonly dropBeer: (playerId: string, x: number, y: number) => void;
  readonly dropCarryForPlayer: (playerId: string, x: number, y: number) => void;
  readonly handlePlayerUnavailable: (playerId: string) => void;
  readonly handlePlayerDeath: (playerId: string) => void;
  readonly handleCoopItemKill: (killerId: string, victimId: string, x: number, y: number) => void;
  readonly getSecondaryObjectiveState: (objectiveId: string) => CoopDefenseSecondaryObjectiveState | null;
  readonly reportTargetContribution: (objectiveId: string, baseId: string) => void;
  readonly reportTargetDestroyed: (objectiveId: string, baseId: string) => number;
  readonly reconcilePersistentBaseWorld: () => void;
  readonly syncActiveBaseIds: () => void;
  readonly getMissionBarrierObstacles: () => Parameters<CombatSystem['setBarrierObstacles']>[0];
  readonly getRockTargets: () => readonly { active: boolean; x: number; y: number }[];
  readonly getWorldTrain: () => { getActiveSegmentPositions: () => { x: number; y: number }[]; applyDamage: (damage: number, ownerId: string) => void } | null;
  readonly getTimebombSystem: () => CoopDefenseTimebombSystem | null;
  readonly getNecromancySystem: () => NecromancySystem | null;
  readonly hostUpdate: WorldCombatImpactPort;
  readonly createEnergyShieldSystem: (resourceSystem: ResourceSystem, shieldBuffSystem: ShieldBuffSystem) => EnergyShieldSystem;
  readonly network: WorldCombatNetworkPort;
  readonly respawnPlayer: (playerId: string) => boolean;
  readonly getTeamHpRegenBonus?: (playerId: string) => number;
  readonly getMatrixDamageReduction?: (footprint: TargetFootprint, applies: (field: { ownerId: string }) => boolean) => number;
  readonly getMatrixDamageMultiplier?: (footprint: TargetFootprint, applies: (field: { ownerId: string }) => boolean) => number;
  readonly onSystemsChanged: (systems: WorldCombatGameplaySystems | null) => void;
}

/** Owns the World binding graph for combat, physics, projectile, turret and decoy systems. */
export class WorldCombatGameplayBinding implements WorldScopedBinding {
  readonly systems: WorldCombatGameplaySystems | null;
  private destroyed = false;

  constructor(private readonly options: WorldCombatGameplayBindingOptions) {
    const playerSystems = options.getPlayerSystems();
    if (playerSystems) {
      const shieldBuff = new ConcreteShieldBuffSystem();
      const timeBubble = new ConcreteTimeBubbleSystem();
      timeBubble.setFriendlyResolver((ownerId, subjectId) => !options.network.authority.isEnemyPair(ownerId, subjectId));
      const teslaDome = new ConcreteTeslaDomeSystem(options.playerManager, options.combatSystem, playerSystems.resource);
      const energyShield = options.createEnergyShieldSystem(playerSystems.resource, shieldBuff);
      const turret = new ConcreteTurretSystem(options.playerManager, options.combatSystem);
      this.systems = { shieldBuff, timeBubble, teslaDome, energyShield, turret };
      options.onSystemsChanged(this.systems);
      this.bindHostSystems(this.systems, playerSystems);
    } else {
      this.systems = null;
      options.onSystemsChanged(null);
    }
    this.bindSharedSystems();
  }

  updateEnemyManager(enemyManager: EnemyManager | null): void {
    this.systems?.energyShield.setEnemyManager(enemyManager);
  }

  /** Projects the currently materialized Activity barrier into the World-owned CombatSystem. */
  updateActivityBindings(): void {
    if (this.destroyed) return;
    this.options.combatSystem.setBarrierObstacles(this.options.getMissionBarrierObstacles());
  }

  /** Removes the Activity projection without touching the World-owned CombatSystem itself. */
  clearActivityBindings(): void {
    if (this.destroyed) return;
    this.options.combatSystem.setBarrierObstacles(null);
  }

  setPowerUpSystem(powerUpSystem: PowerUpSystem | null): void {
    this.options.combatSystem.setPowerUpSystem(powerUpSystem);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clearActivityBindings();
    this.destroyed = true;
    const { combatSystem, hostPhysics, projectileManager, decoySystem, baseManager } = this.options;
    baseManager?.setOnBaseActivated(null);
    baseManager?.setOnBaseDestroyed(null);
    baseManager?.setSecondaryObjectiveStateProvider(null);
    combatSystem.setBurrowSystem(null);
    combatSystem.setResourceSystem(null);
    combatSystem.setLoadoutManager(null);
    combatSystem.setEnergyShieldSystem(null);
    combatSystem.setPowerUpSystem(null);
    combatSystem.setDecoySystem(null);
    combatSystem.setEnemyManager(null);
    combatSystem.setRockDamageCallback(null);
    combatSystem.setBaseDamageCallback(null);
    combatSystem.setTrainDamageCallback(null);
    combatSystem.setProjectileImpactCallback(null);
    combatSystem.setPlayerImpulseCallback(null);
    combatSystem.setEnemyImpulseCallback(null);
    combatSystem.setKillCallback(() => { /* noop */ });
    combatSystem.setDeathCallback(null);
    combatSystem.setEnemyDeathCallback(null);
    combatSystem.setAk47DirectEnemyHitHandler(null);
    combatSystem.setPlayerMaxHpResolver(null);
    combatSystem.setInitialSpawnAllowedResolver(null);
    combatSystem.setRespawnAllowedResolver(null);
    combatSystem.setRespawnCallback(null);
    combatSystem.setAuthoritativePositionResetCallback(null);
    combatSystem.setPlayerActionAllowedResolver(null);
    combatSystem.setPlayerDamageReductionResolver(null);
    combatSystem.setPlayerHpRegenPerSecondResolver(null);
    combatSystem.setPlayerMaxArmorResolver(null);
    combatSystem.setPlayerArmorGainMultiplierResolver(null);
    combatSystem.setPlayerArmorDamageGrantsRageResolver(null);
    combatSystem.setPlayerLifeLeechFractionResolver(null);
    combatSystem.setPlayerArmorRegenPerSecondResolver(null);
    combatSystem.setPlayerBonusArmorRegenPerSecondResolver(null);
    combatSystem.setPlayerOutgoingDamageResolver(null);
    combatSystem.setEnemyIncomingDamageMultiplierResolver(null);
    combatSystem.setTargetIncomingDamageMultiplierResolver(null);
    combatSystem.setEnergyInjectorTargetHitCallback(null);
    combatSystem.setHitscanSupportImpactCallback(null);
    combatSystem.setDirectPrimaryHitHandler(null);
    combatSystem.setPlayerDamageTakenHandler(null);
    combatSystem.setDamageDealtHandler(null);
    combatSystem.setHealingReceivedHandler(null);
    combatSystem.setArmorReceivedHandler(null);
    hostPhysics.setEnemyMovementFactorResolver(null);
    hostPhysics.setRunSpeedResolver(null);
    hostPhysics.setDashRangeMultiplierResolver(null);
    hostPhysics.setDashRecoveryDurationResolver(null);
    hostPhysics.setDashImpactDamageResolver(null);
    hostPhysics.setDashImpactKnockbackResolver(null);
    hostPhysics.setDashGroundFireDurationResolver(null);
    hostPhysics.setDashGroundFireHandler(null);
    hostPhysics.setDashHoldEnabledResolver(null);
    hostPhysics.setBurrowSystem(null);
    hostPhysics.setLoadoutManager(null);
    hostPhysics.setTimeBubbleSystem(null);
    hostPhysics.setEnemyManager(null);
    projectileManager.setNaturalFlameExpiryCallback(null);
    projectileManager.setProjectileImpactCallback(null);
    projectileManager.setProjectileResolvedCallback(null);
    projectileManager.setMiniRocketCollectedCallback(null);
    projectileManager.setMiniRocketDestroyedCallback(null);
    projectileManager.setProximityPulseCallback(null);
    projectileManager.setTimeBubbleFactorProvider(null);
    projectileManager.setRockHitCallback(() => { /* noop */ });
    projectileManager.setObstacleKindResolver(null);
    projectileManager.setBaseHitCallback(null);
    projectileManager.setSupportImpactCallback(null);
    decoySystem.setCombatStateReader(null);
    decoySystem.setRunSpeedResolver(null);
    decoySystem.setCooldownStarter(null);
    decoySystem.setExplosionCallback(null);
    projectileManager.destroyAll();
    decoySystem.clearAll();
    if (this.systems) {
      this.systems.timeBubble.destroyAll();
      for (const player of this.options.playerManager.getAllPlayers()) {
        this.systems.energyShield.hostDeactivateForPlayer(player.id);
        this.systems.teslaDome.hostDeactivateForPlayer(player.id);
      }
      this.systems.teslaDome.setConstructionSourceProvider(null);
      this.systems.teslaDome.setRockCallbacks(null, null);
      this.systems.teslaDome.setTrainCallbacks(null, null);
      this.systems.teslaDome.setTurretCallbacks(null, null);
      this.systems.teslaDome.setEnemyTargetProvider(null);
      this.systems.teslaDome.setBaseCallbacks(null, null);
      this.systems.teslaDome.setEnergyShieldSystem(null);
      this.systems.teslaDome.setStormProjectileSpawner(null);
      this.systems.teslaDome.setNovaHitHandler(null);
      this.systems.turret.setTurretProvider(null, null);
      this.systems.turret.setEnemyTargetProvider(null);
      this.systems.turret.setFocusTargetProvider(null);
      this.systems.turret.setFocusedBaseTargetProvider(null);
      this.systems.turret.setFireHandler(null);
      this.systems.turret.setTurretDamageBuffProvider(null);
      this.systems.turret.setTurretDamageMultiplierProvider(null);
    }
    this.options.onSystemsChanged(null);
  }

  private bindSharedSystems(): void {
    const o = this.options;
    const { combatSystem: combat, hostPhysics, projectileManager: projectiles, baseManager } = o;
    combat.setEnemyManager(o.getEnemyManager());
    combat.setPlayerMaxHpResolver((playerId) => o.getPlayerSystems()?.playerModifier.getMaxHp(playerId) ?? HP_MAX);
    combat.setInitialSpawnAllowedResolver((playerId) => (
      o.isActivityActive() ? o.network.round.canPlayerInitialSpawn(playerId) : hasWorldFigure(o.getWorldParticipation(playerId))
    ));
    combat.setRespawnAllowedResolver((playerId) => (
      o.isActivityActive() ? o.network.round.canPlayerRespawn(playerId) : hasWorldFigure(o.getWorldParticipation(playerId))
    ));
    combat.setRespawnCallback((playerId) => o.respawnPlayer(playerId));
    combat.setAuthoritativePositionResetCallback((playerId, x, y) => o.resetPlayerPosition(playerId, x, y));
    combat.setPlayerActionAllowedResolver((playerId) => o.getPlayerCapabilities(playerId).canUseCombat);
    combat.setPlayerDamageReductionResolver((playerId) => {
      const playerSystems = o.getPlayerSystems();
      const fromWeapon = playerSystems?.loadout.getEquippedWeaponConfig(playerId, 'weapon1')?.damageReduction ?? 0;
      const fromItems = playerSystems?.playerModifier.getPercentageStat(playerId, 'player.damageReduction') ?? 0;
      const conditional = playerSystems?.itemRuntime.getConditionalDamageReduction(playerId) ?? 0;
      const player = o.playerManager.getPlayer(playerId);
      const footprint = player ? o.getTargetFootprint({ targetType: 'player', targetId: playerId }) : null;
      const matrix = footprint ? (o.getMatrixDamageReduction?.(
        footprint,
        field => !o.network.authority.isEnemyPair(field.ownerId, playerId),
      ) ?? 0) : 0;
      return fromWeapon + fromItems + conditional + matrix;
    });
    combat.setPlayerHpRegenPerSecondResolver((playerId) => {
      const p = o.getPlayerSystems();
      return (p?.playerModifier.getHpRegenPerSecond(playerId) ?? 0)
        + (o.getTeamHpRegenBonus?.(playerId) ?? 0);
    });
    combat.setPlayerMaxArmorResolver((playerId) => o.getPlayerSystems()?.playerModifier.getResolvedStat(playerId, 'player.maxArmor', 100) ?? 100);
    combat.setPlayerArmorGainMultiplierResolver((playerId) => 1 + (o.getPlayerSystems()?.playerModifier.getPercentageStat(playerId, 'player.armorGain') ?? 0));
    combat.setPlayerArmorDamageGrantsRageResolver((playerId) => (o.getPlayerSystems()?.playerModifier.getNumericStat(playerId, 'ultimate.rageGainFromArmorDamage') ?? 0) > 0);
    combat.setPlayerLifeLeechFractionResolver((playerId) => (
      (o.getPlayerSystems()?.playerModifier.getNumericStat(playerId, 'player.lifeLeechFraction') ?? 0)
      + (o.getPlayerSystems()?.itemRuntime.getConditionalLifeLeechBonus(playerId) ?? 0)
    ));
    combat.setPlayerArmorRegenPerSecondResolver((playerId) => o.getPlayerSystems()?.playerModifier.getNumericStat(playerId, 'player.armorRegenPerSecond') ?? 0);
    combat.setPlayerBonusArmorRegenPerSecondResolver((playerId) => o.getPlayerSystems()?.itemRuntime.getBonusArmorRegenPerSecond(playerId) ?? 0);
    combat.setPlayerOutgoingDamageResolver((attackerId, targetId, amount, allowCritical, sourceSlot) => {
      const p = o.getPlayerSystems();
      return p?.playerModifier.resolveOutgoingDamage(
        attackerId,
        targetId,
        amount,
        allowCritical,
        Math.random,
        p.itemRuntime.getConditionalOutgoingDamageBonus(attackerId, sourceSlot),
      ) ?? { amount, isCritical: false };
    });
    combat.setEnemyIncomingDamageMultiplierResolver((enemyId) => o.getPlayerSystems()?.itemRuntime.getEnemyIncomingDamageMultiplier(enemyId) ?? 1);
    combat.setTargetIncomingDamageMultiplierResolver((target) => {
      const targeting = o.getTargetStatusSystem();
      const vulnerability = targeting?.getIncomingDamageMultiplier(target) ?? 1;
      const footprint = o.getTargetFootprint(target);
      if (!footprint || target.targetType === 'enemy') return vulnerability;
      const matrixApplies = target.targetType === 'player'
        ? (field: { ownerId: string }) => !o.network.authority.isEnemyPair(field.ownerId, target.targetId)
        : target.targetType === 'base'
          ? () => o.baseManager?.getBase(target.targetId)?.faction === 'friendly'
          : target.targetType === 'construction'
            ? (field: { ownerId: string }) => {
              const rock = o.placementSystem.getRuntimeRock(Number(target.targetId));
              return Boolean(rock && !o.network.authority.isEnemyPair(field.ownerId, rock.ownerId));
            }
            : target.targetType === 'rock' || target.targetType === 'wall'
              ? (field: { ownerId: string }) => {
                const rock = o.placementSystem.getRuntimeRock(Number(target.targetId));
                return !rock || !o.network.authority.isEnemyPair(field.ownerId, rock.ownerId);
              }
              : () => false;
      return vulnerability * (o.getMatrixDamageMultiplier?.(footprint, matrixApplies) ?? 1);
    });
    combat.setApplyVulnerabilityHandler((target, durationMs) => o.getTargetStatusSystem()?.applyVulnerability(target, durationMs));
    combat.setEnergyInjectorTargetHitCallback((targetType, targetId, x, y, projectile) => {
      if (targetType === 'player' && !o.network.authority.isEnemyPair(projectile.ownerId, targetId)) return;
      o.hostUpdate.applyEnergyInjectorTargetHit(targetType, targetId, x, y, projectile);
    });
    combat.setHitscanSupportImpactCallback((impact, effect, attackerId, sourceSlot) => o.hostUpdate.applyHitscanSupportImpact(impact, effect, attackerId, sourceSlot));
    combat.setDirectPrimaryHitHandler((attackerId, enemyId, remainingHp, maxHp, isBoss) => {
      const runtime = o.getPlayerSystems()?.itemRuntime;
      if (!runtime) return;
      const slow = runtime.rollDirectPrimaryHitEffects(attackerId, enemyId);
      if (slow.slowFraction > 0) combat.applyEnemySlow(enemyId, slow.slowFraction, slow.slowDurationMs);
      if (runtime.rollCulling(attackerId, remainingHp, maxHp, isBoss)) {
        combat.applyDamage(enemyId, remainingHp, false, attackerId, 'Hinrichtung', undefined, {
          damageKind: 'direct', sourceSlot: 'weapon1', allowCritical: false, skipLifeLeech: true,
        });
      }
    });
    combat.setPlayerDamageTakenHandler((playerId, attackerId, hpLost, armorLost, damageKind) => {
      o.network.stats.recordPlayerDamageTaken(playerId, hpLost, armorLost);
      const runtime = o.getPlayerSystems()?.itemRuntime;
      if (!runtime) return;
      const result = runtime.handlePlayerDamageTaken(playerId, attackerId, hpLost, armorLost, damageKind);
      if (result.adrenalineGain > 0) o.getPlayerSystems()?.resource.addAdrenaline(playerId, result.adrenalineGain);
      if (result.reflectedDamage > 0 && result.reflectTargetId) {
        combat.applyDamage(result.reflectTargetId, result.reflectedDamage, false, playerId, 'Dornenplatten', undefined, { damageKind: 'reflect', allowCritical: false });
      }
    });
    combat.setDamageDealtHandler((targetType, targetId, attackerId, damage) => {
      if (!o.network.authority.isHost() || !attackerId || attackerId === targetId || damage <= 0) return;
      if (!o.network.authority.getPlayerProfile(attackerId)) return;
      if (targetType === 'enemy') {
        if (o.getEnemyManager()?.getEnemy(targetId)?.faction !== 'hostile') return;
      } else if (o.isCoopMission() || !o.network.authority.isEnemyPair(attackerId, targetId)) return;
      o.network.stats.addPlayerRoomDamage(attackerId, damage);
    });
    combat.setHealingReceivedHandler((playerId, amount) => o.network.stats.recordHealingReceived(playerId, amount));
    combat.setArmorReceivedHandler((playerId, amount) => o.network.stats.recordArmorReceived(playerId, amount));
    projectiles.setNaturalFlameExpiryCallback((projectile, x, y) => o.getPlayerSystems()?.flamethrowerUpgrade?.handleNaturalFlameExpiry(projectile, x, y));
    hostPhysics.setEnemyMovementFactorResolver((enemyId, now) => Math.min(
      o.getPlayerSystems()?.slimeTrail?.getEnemyMovementFactor(enemyId, now) ?? 1,
      combat.getEnemyMovementFactor(enemyId, now),
    ));
    combat.setEnemyDeathCallback((enemyId, x, y, burnSources, death) => {
      const wasTimebomb = death ? (o.getTimebombSystem()?.handleKilled(death) ?? false) : false;
      if (wasTimebomb) {
        o.getTargetStatusSystem()?.removeTarget({ targetType: 'enemy', targetId: enemyId });
        o.getEnergyInjectorSystem()?.removeTarget({ targetType: 'enemy', targetId: enemyId });
        o.getPlayerSystems()?.itemRuntime.removeEnemy(enemyId);
        return true;
      }
      o.getPlayerSystems()?.flamethrowerUpgrade?.handleEnemyDeath(x, y, burnSources);
      const burst = o.getPlayerSystems()?.slimeTrail?.handleEnemyDeath(enemyId, x, y, Date.now());
      if (burst) o.network.effects.broadcastSlimeBloomEffect(burst.x, burst.y, burst.targets);
      if (death) o.getNecromancySystem()?.recordEnemyDeath(death);
      o.getTargetStatusSystem()?.removeTarget({ targetType: 'enemy', targetId: enemyId });
      o.getEnergyInjectorSystem()?.removeTarget({ targetType: 'enemy', targetId: enemyId });
      o.getPlayerSystems()?.itemRuntime.removeEnemy(enemyId);
      return false;
    });
    combat.setRockDamageCallback((rockIndex, damage, attackerId) => {
      const resolvedDamage = o.resolveObstacleDamage(rockIndex, damage, attackerId);
      if (resolvedDamage <= 0) return;
      const newHp = o.applyObstacleDamageById(rockIndex, resolvedDamage, attackerId);
      if (newHp <= 0) o.handleDestroyedRock(rockIndex, 'damage', attackerId);
    });
    combat.setBaseDamageCallback((baseId, damage, attackerId) => {
      const base = o.baseManager?.getBase(baseId);
      const objectiveId = base?.getSpec().dormantObjectiveId;
      if (objectiveId && o.network.round.canPlayerReceiveRoundRewards(attackerId)) o.reportTargetContribution(objectiveId, baseId);
      base?.applyDamage(damage);
    });
    combat.setTrainDamageCallback((damage, attackerId) => {
      const p = o.getPlayerSystems();
      const resolvedDamage = p?.playerModifier.resolveOutgoingDamage(attackerId, 'train', damage, false).amount ?? damage;
      o.getWorldTrain()?.applyDamage(resolvedDamage, attackerId);
    });
    combat.setProjectileImpactCallback((projectileId, x, y) => {
      const projectile = o.projectileManager.getProjectileById(projectileId);
      if (projectile) o.spawnImpactCloud(projectile, x, y);
    });
    combat.setPlayerImpulseCallback((playerId, vx, vy, durationMs, sourcePlayerId) => hostPhysics.addRecoil(playerId, vx, vy, durationMs, sourcePlayerId));
    combat.setEnemyImpulseCallback((enemyId, vx, vy, durationMs, sourcePlayerId) => hostPhysics.addRecoil(enemyId, vx, vy, durationMs, sourcePlayerId));
    combat.setDeathCallback((playerId, x, y) => {
      o.network.stats.recordPlayerDeath(playerId);
      o.handlePlayerUnavailable(playerId);
      o.handlePlayerDeath(playerId);
      o.getPlayerSystems()?.flamethrowerUpgrade?.handlePlayerDeath(playerId, x, y);
      o.dropCarryForPlayer(playerId, x, y);
      o.dropBeer(playerId, x, y);
      o.gameAudioSystem.playSound('sfx_player_death', x, y);
    });
    combat.setKillCallback((killerId, victimId, sourceId, x, y, source) => {
      const killerProfile = o.network.authority.getPlayerProfile(killerId);
      if (killerProfile) {
        if (o.network.authority.getPlayerProfile(victimId)
          && o.network.authority.isEnemyPair(killerId, victimId)) {
          o.network.stats.recordPlayerKill(killerId, 'pvp');
        } else if (o.getEnemyManager()?.getEnemy(victimId)?.faction === 'hostile') {
          o.network.stats.recordPlayerKill(killerId, 'pve');
        }
      }
      o.getPlayerSystems()?.loadout.handleKill(killerId, sourceId, x, y, source);
      if (o.isCoopMission() && (source?.enemyXp ?? 0) > 0 && o.network.authority.isHost()) {
        o.handleCoopItemKill(killerId, victimId, x, y);
        o.getPowerUpSystem()?.onCoopDefenseEnemyKilled(killerId, source?.enemyXp ?? 0, x, y);
        for (const profile of o.network.authority.getConnectedPlayers()) {
          const gain = o.getPlayerSystems()?.playerModifier.getClassDefinition(profile.id)?.adrenalinePerEnemyDeath ?? 0;
          if (gain > 0) o.getPlayerSystems()?.resource.addAdrenaline(profile.id, gain);
        }
      }
      const allowKillDrop = o.isActivityActive() && !o.isCoopMission();
      if (killerId === '__train__' || killerId === COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID) {
        if (killerId === '__train__' && allowKillDrop) o.getPowerUpSystem()?.onPlayerKilled(x, y);
        const victimProfile = o.network.authority.getConnectedPlayers().find(profile => profile.id === victimId);
        if (victimProfile) o.network.effects.broadcastKillEvent({
          killerId,
          killerName: killerId === '__train__' ? 'RB 54' : 'Zombie-Bomber',
          killerColor: killerId === '__train__' ? 0xcf573c : 0xff9933,
          sourceId: killerId === '__train__' ? 'environment.train_push' : 'environment.airstrike',
          victimId,
          victimName: victimProfile.name,
          victimColor: victimProfile.colorHex,
        });
        return;
      }
      const profiles = o.network.authority.getConnectedPlayers();
      const victimProfile = profiles.find(profile => profile.id === victimId);
      if (victimProfile) o.network.stats.incrementPlayerFrags(killerId);
      if (killerProfile && victimProfile) {
        o.network.effects.broadcastKillEvent({
          killerId,
          killerName: killerProfile.name,
          killerColor: killerProfile.colorHex,
          sourceId,
          victimId,
          victimName: victimProfile.name,
          victimColor: victimProfile.colorHex,
        });
        if (allowKillDrop) o.getPowerUpSystem()?.onPlayerKilled(x, y);
      }
    });
    projectiles.setProjectileImpactCallback((projectile, x, y) => o.spawnImpactCloud(projectile, x, y));
    hostPhysics.setEnemyManager(o.getEnemyManager());
    this.bindHostPhysics(hostPhysics);
    combat.setDecoySystem(o.decoySystem);
    this.bindDecoy();
    this.bindProjectiles();
    this.bindBaseManager();
  }

  private bindHostSystems(systems: WorldCombatGameplaySystems, player: WorldPlayerGameplaySystems): void {
    const o = this.options;
    const { teslaDome, turret, energyShield, timeBubble } = systems;
    teslaDome.setLineOfSightChecker((sx, sy, ex, ey, skipRockIndex) => o.combatSystem.hasLineOfSight(sx, sy, ex, ey, skipRockIndex));
    turret.setLineOfFireChecker((sx, sy, ex, ey, skipRockIndex, ignoreBaseObstacles) => o.combatSystem.hasClearLineOfFire(sx, sy, ex, ey, { skipRockIndex, ignoreBaseObstacles }));
    turret.setTurretProvider(() => this.getTurretDefinitions(), (id, angle) => {
      if (typeof id === 'number') {
        o.placementSystem.updateAngle(id, angle);
        o.updateTurretAngle(id, angle);
      } else o.baseManager?.setTurretAngle(id, angle);
    });
    turret.setEnemyTargetProvider(() => (o.getEnemyManager()?.getAllEnemies() ?? []).filter(enemy => enemy.sprite.active).map(enemy => ({ id: enemy.id, x: enemy.sprite.x, y: enemy.sprite.y })));
    turret.setFocusTargetProvider((ownerId) => o.getEnergyInjectorSystem()?.getFocusTarget(ownerId) as { targetType: 'enemy' | 'base'; targetId: string } | null);
    turret.setFocusedBaseTargetProvider((targetId, turretX, turretY) => {
      const base = o.baseManager?.getBase(targetId);
      if (!base || base.faction !== 'hostile' || base.isInert?.() || base.getHp() <= 0) return null;
      const surface = base.getNearestSurfacePoint(turretX, turretY);
      return surface ? { id: base.id, x: surface.x, y: surface.y } : null;
    });
    teslaDome.setConstructionSourceProvider(() => this.getTeslaConstructionSources());
    turret.setTurretDamageBuffProvider((x, y) => {
      const damageMultiplier = o.getEnergyInjectorSystem()?.getTurretDamageMultiplierAt(x, y) ?? 1;
      return damageMultiplier > 1 ? { damageMultiplier } : null;
    });
    turret.setTurretDamageMultiplierProvider((turretData, turrets) => player.itemRuntime.getRemoteControlDamageMultiplier(turretData.ownerId, turretData, turrets));
    teslaDome.setRockCallbacks(
      () => o.getRockTargets().flatMap((rock, index) => rock.active ? [{ index, x: rock.x, y: rock.y }] : []),
      (index, damage, ownerId) => o.hostUpdate.applyTeslaRockDamage(index, damage, ownerId),
    );
    teslaDome.setTurretCallbacks(
      () => o.placementSystem.getAllRuntimeRocks().filter(rock => rock.kind === 'turret').map(rock => ({ id: rock.id, x: o.worldMetrics.offsetX + rock.gridX * CELL_SIZE + CELL_SIZE / 2, y: o.worldMetrics.offsetY + rock.gridY * CELL_SIZE + CELL_SIZE / 2, ownerId: rock.ownerId })),
      (id, damage, ownerId) => o.hostUpdate.applyTeslaTurretDamage(id, damage, ownerId),
    );
    teslaDome.setEnemyTargetProvider(() => (o.getEnemyManager()?.getAllEnemies() ?? []).filter(enemy => enemy.sprite.active).map(enemy => ({ id: enemy.id, x: enemy.sprite.x, y: enemy.sprite.y })));
    teslaDome.setBaseCallbacks(
      () => o.baseManager?.getBasesByFaction('hostile') ?? [],
      (baseId, damage, ownerId, sourceSlot) => o.combatSystem.applyBaseDamage(baseId, damage, ownerId, sourceSlot),
    );
    teslaDome.setEnergyShieldSystem(energyShield);
    teslaDome.setTrainCallbacks(
      () => o.getWorldTrain()?.getActiveSegmentPositions() ?? [],
      (damage, ownerId) => o.getWorldTrain()?.applyDamage(damage, ownerId),
    );
    teslaDome.setStormProjectileSpawner((request) => {
      const lifetime = request.speed > 0 ? request.rangePx / request.speed * 1000 : 0;
      o.projectileManager.spawnProjectile(request.x, request.y, request.angle, request.ownerId, { speed: request.speed, size: request.size, damage: request.damage, color: request.color, ownerColor: request.color, lifetime, remainingRangePx: request.rangePx, maxBounces: 0, isGrenade: false, adrenalinGain: 0, sourceId: request.weaponId, projectileStyle: 'tesla_bolt', piercesTargets: true, homing: request.homing, rockDamageMult: 0, sourceSlot: request.sourceSlot, suppressSpawnFx: true });
    });
    teslaDome.setNovaHitHandler((hit) => {
      if (hit.type === 'enemies' && hit.slowFraction > 0 && hit.slowDurationMs > 0) o.combatSystem.applyEnemySlow(hit.targetId, hit.slowFraction, hit.slowDurationMs);
      if (hit.knockback <= 0 || (hit.type !== 'enemies' && hit.type !== 'players')) return;
      const dome = o.playerManager.getPlayer(hit.ownerId);
      const dx = hit.x - (dome?.x ?? hit.x);
      const dy = hit.y - (dome?.y ?? hit.y);
      const distance = Math.hypot(dx, dy);
      o.hostPhysics.addRecoil(hit.targetId, (distance > 0.001 ? dx / distance : 0) * hit.knockback, (distance > 0.001 ? dy / distance : -1) * hit.knockback, 260, hit.ownerId);
    });
    energyShield.setCombatSystem(o.combatSystem);
    energyShield.setEnemyManager(o.getEnemyManager());
    energyShield.setBaseManager(o.baseManager);
    energyShield.setWeaponUsageBlockedChecker((playerId) => !o.combatSystem.isAlive(playerId) || player.burrow.isWeaponBlocked(playerId) || o.hostPhysics.isDashBurst(playerId));
    o.combatSystem.setEnergyShieldSystem(energyShield);
    o.combatSystem.setBurrowSystem(player.burrow);
    o.combatSystem.setResourceSystem(player.resource);
    o.combatSystem.setLoadoutManager(player.loadout);
    o.hostPhysics.setBurrowSystem(player.burrow);
    o.hostPhysics.setLoadoutManager(player.loadout);
    o.hostPhysics.setTimeBubbleSystem(timeBubble);
    player.loadout.setTeslaDomeSystem(teslaDome);
    player.loadout.setEnergyShieldSystem(energyShield);
    player.loadout.setShieldBuffSystem(systems.shieldBuff);
    player.loadout.setTranslocatorSystem(player.translocator);
    player.loadout.setDecoySystem(o.decoySystem);
    timeBubble.setFriendlyResolver((ownerId, subjectId) => !o.network.authority.isEnemyPair(ownerId, subjectId));
  }

  private bindHostPhysics(hostPhysics: HostPhysicsSystem): void {
    const o = this.options;
    hostPhysics.setRunSpeedResolver((playerId) => {
      const p = o.getPlayerSystems();
      return (p?.playerModifier.getResolvedStat(playerId, 'player.runSpeed', PLAYER_SPEED) ?? PLAYER_SPEED) * (p?.itemRuntime.getRunSpeedMultiplier(playerId) ?? 1);
    });
    hostPhysics.setDashRangeMultiplierResolver((playerId) => 1 + (o.getPlayerSystems()?.playerModifier.getPercentageStat(playerId, 'player.dashRange') ?? 0));
    hostPhysics.setDashRecoveryDurationResolver((playerId) => o.getPlayerSystems()?.playerModifier.getResolvedStat(playerId, 'player.dashRecovery', DASH_T2_S) ?? DASH_T2_S);
    hostPhysics.setDashImpactDamageResolver((playerId) => o.getPlayerSystems()?.playerModifier.getResolvedStat(playerId, 'player.dashImpactDamage', 0) ?? 0);
    hostPhysics.setDashImpactKnockbackResolver((playerId) => o.getPlayerSystems()?.playerModifier.getNumericStat(playerId, 'player.dashImpactKnockback') ?? 0);
    hostPhysics.setDashGroundFireDurationResolver((playerId) => o.getPlayerSystems()?.playerModifier.getNumericStat(playerId, 'player.dashGroundFireDurationMs') ?? 0);
    hostPhysics.setDashGroundFireHandler((playerId, sourceKey, fromX, fromY, toX, toY, durationMs, now) => o.fireSystem.hostRefreshGroundCellsAlongSegment(fromX, fromY, toX, toY, { sourceKey, ownerId: playerId, durationMs, burn: { durationMs: DASH_GROUND_FIRE_BURN_DURATION_MS, damagePerTick: DASH_GROUND_FIRE_DAMAGE_PER_TICK }, sourceId: 'ground_fire.dash_trail' }, now));
    hostPhysics.setDashHoldEnabledResolver((playerId) => (o.getPlayerSystems()?.playerModifier.getNumericStat(playerId, 'player.dashHoldEnabled') ?? 0) > 0);
  }

  private bindDecoy(): void {
    const o = this.options;
    o.decoySystem.setCombatStateReader(o.combatSystem);
    o.decoySystem.setRunSpeedResolver((playerId) => (o.getPlayerSystems()?.playerModifier.getResolvedStat(playerId, 'player.runSpeed', PLAYER_SPEED) ?? PLAYER_SPEED) * (o.getPlayerSystems()?.loadout.getSpeedMultiplier(playerId) ?? 1));
    o.decoySystem.setCooldownStarter((playerId, utilityId, when) => o.getPlayerSystems()?.loadout.beginUtilityCooldown(playerId, utilityId, when));
    o.decoySystem.setExplosionCallback((ownerId, x, y, radius, damage, knockback) => {
      o.combatSystem.applyAoeDamage(x, y, radius, damage, ownerId, false, { category: 'explosion', allowTeamDamage: false, sourceId: 'environment.decoy_explosion', sourceSlot: 'utility' });
      o.hostPhysics.applyRadialImpulse(x, y, radius, knockback, ownerId, 0);
      o.network.effects.broadcastExplosionEffect(x, y, radius);
    });
  }

  private bindProjectiles(): void {
    const o = this.options;
    o.projectileManager.setProjectileResolvedCallback((projectile) => o.getPlayerSystems()?.loadout.resolveAk47Projectile(projectile));
    o.projectileManager.setMiniRocketCollectedCallback((projectile, x, y) => {
      const refund = Math.max(0, projectile.miniRocketAdrenalineCostPaid ?? 0) * Math.max(0, projectile.miniRocketPickupAdrenalineRefundFraction ?? 0);
      const armor = Math.max(0, projectile.miniRocketPickupArmor ?? 0);
      if (refund > 0) o.getPlayerSystems()?.resource.refundAdrenaline(projectile.ownerId, refund);
      if (armor > 0) o.combatSystem.addArmor(projectile.ownerId, armor);
      o.network.effects.broadcastMiniRocketCollectionEffect(x, y, projectile.ownerColor ?? projectile.color);
    });
    o.projectileManager.setMiniRocketDestroyedCallback((projectile, x, y) => o.network.effects.broadcastMiniRocketDestructionEffect(x, y, projectile.ownerColor ?? projectile.color));
    o.projectileManager.setProximityPulseCallback((projectile) => {
      const pulse = o.hostUpdate.resolveProjectileProximityPulse(projectile);
      const playerLines = projectile.isBfg ? o.hostUpdate.resolveBfgPlayerProximityPulse(projectile) : [];
      o.network.effects.broadcastBfgLaserBatch([...playerLines, ...pulse.lines], projectile.isBfg ? COLORS.GREEN_2 : projectile.color, projectile.isBfg ? undefined : 'asmd_primary', projectile.isBfg ? projectile.id : undefined);
    });
    o.projectileManager.setTimeBubbleFactorProvider((x, y, now, ownerId) => this.systems?.timeBubble.getProjectileMovementFactorAt(x, y, now, ownerId) ?? 1);
    o.projectileManager.setRockHitCallback((rockId, damage, attackerId) => {
      const resolvedDamage = o.resolveObstacleDamage(rockId, damage, attackerId);
      if (resolvedDamage <= 0) return;
      const newHp = o.applyObstacleDamageById(rockId, resolvedDamage, attackerId);
      if (newHp <= 0) o.handleDestroyedRock(rockId, 'damage', attackerId);
    });
    o.projectileManager.setObstacleKindResolver((rockId) => o.placementSystem.getRuntimeRock(rockId)?.kind);
    o.projectileManager.setBaseHitCallback((baseId, damage, attackerId, projectile) => {
      const base = o.baseManager?.getBase(baseId);
      if (!base || base.faction !== 'hostile' || base.isInert?.() || base.getHp() <= 0) return;
      if (projectile) o.combatSystem.applyProjectileBaseDamage(baseId, projectile);
      else o.combatSystem.applyBaseDamage(baseId, damage, attackerId);
    });
    o.projectileManager.setSupportImpactCallback((projectile, impact) => o.hostUpdate.applySupportProjectileImpact(projectile, impact));
  }

  private bindBaseManager(): void {
    const o = this.options;
    o.baseManager?.setSecondaryObjectiveStateProvider((objectiveId) => o.getSecondaryObjectiveState(objectiveId));
    const updateActivatedBasePresentation = (activatedBase: { id: string }): void => {
      o.combatSystem.setBaseObstacles(o.baseManager?.getObstacleRectangles() ?? null);
      const entity = o.baseManager?.getBases().find(base => base.id === activatedBase.id);
      if (entity) o.getWorldGeometryBinding()?.setBase(entity.id, entity.getCellBodies().map(body => body.getBounds()));
      o.syncActiveBaseIds();
    };
    if (o.network.authority.isHost()) {
      o.baseManager?.setOnBaseActivated((activatedBase) => {
        updateActivatedBasePresentation(activatedBase);
        o.getPowerUpSystem()?.activatePedestalsLinkedToBase(activatedBase.id);
        if (activatedBase.id === o.getPersistentBaseId()) o.reconcilePersistentBaseWorld();
      });
      o.syncActiveBaseIds();
    } else {
      o.baseManager?.setOnBaseActivated(updateActivatedBasePresentation);
    }
    o.baseManager?.setOnBaseDestroyed((destroyedBase) => {
      o.getWorldGeometryBinding()?.removeBase(destroyedBase.id);
      o.getTargetStatusSystem()?.removeTarget({ targetType: 'base', targetId: destroyedBase.id });
      o.getEnergyInjectorSystem()?.removeTarget({ targetType: 'base', targetId: destroyedBase.id });
      o.getPowerUpSystem()?.destroyPedestalsLinkedToBase(destroyedBase.id);
      o.reconcilePersistentBaseWorld();
      if (o.network.authority.isHost()) {
        const objectiveId = destroyedBase.dormantObjectiveId;
        const xp = objectiveId ? o.reportTargetDestroyed(objectiveId, destroyedBase.id) : 0;
        if (xp > 0) o.network.round.addCoopDefenseRoundXp(xp);
        const blast = getBaseDestructionBlast(destroyedBase);
        o.hostPhysics.applyRadialImpulse(blast.x, blast.y, blast.radius, blast.force, undefined, 1, blast.durationMs);
      }
      o.syncActiveBaseIds();
    });
  }

  private getTurretDefinitions(): readonly {
    id: AutomatedTurretId; x: number; y: number; ownerId: string; ownerColor: number;
    skipRockIndex?: number; secondProjectileDamageFactor?: number; targetRange?: number;
    muzzleOffset?: number; weaponId?: keyof typeof WEAPON_CONFIGS; ignoreBaseObstacles?: boolean;
    targetMode?: 'players' | 'enemies';
  }[] {
    const o = this.options;
    const placeable = o.placementSystem.getAllRuntimeRocks()
      .filter(rock => rock.kind === 'turret')
      .filter(rock => !(rock.ownership === 'base-owned' && o.baseManager?.getBase(o.getPersistentBaseId() ?? '')?.isInert()))
      .map(rock => ({
        id: rock.id,
        x: o.worldMetrics.offsetX + rock.gridX * CELL_SIZE + CELL_SIZE / 2,
        y: o.worldMetrics.offsetY + rock.gridY * CELL_SIZE + CELL_SIZE / 2,
        ownerId: rock.ownership === 'base-owned' ? COOP_DEFENSE_BASE_TURRET_OWNER_ID : rock.ownerId,
        ownerColor: rock.ownership === 'base-owned' ? TEAM_BLUE_COLOR : rock.ownerColor,
        skipRockIndex: rock.collisionMode === 'none' ? undefined : rock.id,
        secondProjectileDamageFactor: rock.secondProjectileDamageFactor,
        targetRange: rock.targetRange,
        muzzleOffset: rock.constructionId ? o.getConstructionMuzzleOffset(rock.constructionId) : undefined,
        weaponId: rock.turretWeaponId ?? ('SPORES' as const),
        ignoreBaseObstacles: rock.ownership === 'base-owned',
      }));
    const bases = (o.baseManager?.getTurrets() ?? []).map(turret => ({
      id: turret.id,
      x: turret.x,
      y: turret.y,
      ownerId: turret.faction === 'hostile' ? COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID : COOP_DEFENSE_BASE_TURRET_OWNER_ID,
      ownerColor: turret.faction === 'hostile' ? TEAM_RED_COLOR : TEAM_BLUE_COLOR,
      weaponId: turret.weaponId,
      ignoreBaseObstacles: true,
      targetMode: turret.faction === 'hostile' ? 'players' as const : 'enemies' as const,
    }));
    return [...placeable, ...bases];
  }

  private getTeslaConstructionSources(): readonly {
    id: number; ownerId: string; x: number; y: number; color: number;
    config: WeaponConfig & { fire: TeslaDomeWeaponFireConfig }; damageMultiplier: number;
  }[] {
    const o = this.options;
    const player = o.getPlayerSystems();
    const turrets = this.systems?.turret.getTurrets() ?? [];
    return o.placementSystem.getAllRuntimeRocks()
      .filter(rock => rock.kind === 'turret' && rock.constructionId === 'tesla_turret' && rock.turretWeaponId === 'TURRET_TESLA' && rock.hp > 0)
      .map(rock => {
        const x = o.worldMetrics.offsetX + rock.gridX * CELL_SIZE + CELL_SIZE / 2;
        const y = o.worldMetrics.offsetY + rock.gridY * CELL_SIZE + CELL_SIZE / 2;
        const turret = turrets.find(candidate => String(candidate.id) === String(rock.id));
        const injectorMultiplier = o.getEnergyInjectorSystem()?.getTurretDamageMultiplierAt(x, y) ?? 1;
        const remote = turret && player ? player.itemRuntime.getRemoteControlDamageMultiplier(rock.ownerId, turret, turrets) : 1;
        return {
          id: rock.id,
          ownerId: rock.ownerId,
          x,
          y,
          color: rock.ownerColor,
          config: WEAPON_CONFIGS.TURRET_TESLA as WeaponConfig & { fire: TeslaDomeWeaponFireConfig },
          damageMultiplier: injectorMultiplier * remote * (player?.loadout.getDamageMultiplier(rock.ownerId) ?? 1) * (o.getPowerUpSystem()?.getDamageMultiplier(rock.ownerId) ?? 1),
        };
      });
  }
}
