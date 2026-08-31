import type { CombatSystem } from '../systems/CombatSystem';
import type { EnemyManager } from '../entities/EnemyManager';
import type { FireSystem } from '../effects/FireSystem';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { PlayerManager } from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { TargetStatusSystem } from '../systems/TargetStatusSystem';
import type { WorldMetrics } from './WorldMetrics';
import type { WorldScopedBinding } from './WorldRuntime';
import type { LoadoutManager } from '../loadout/LoadoutManager';
import type { PlayerCapabilities } from './PlayerCapabilities';
import type { PowerUpSystem } from '../powerups/PowerUpSystem';
import { ResourceSystem } from '../systems/ResourceSystem';
import { BurrowSystem } from '../systems/BurrowSystem';
import { TranslocatorSystem } from '../systems/TranslocatorSystem';
import { TunnelSystem } from '../systems/TunnelSystem';
import { CoopDefensePlayerModifierSystem } from '../systems/CoopDefensePlayerModifierSystem';
import { CoopDefenseItemRuntimeSystem } from '../systems/CoopDefenseItemRuntimeSystem';
import { GuardianSpiritSystem } from '../systems/GuardianSpiritSystem';
import { RepairDroneSystem } from '../systems/RepairDroneSystem';
import { SlimeTrailSystem } from '../systems/SlimeTrailSystem';
import { FlamethrowerUpgradeSystem } from '../systems/FlamethrowerUpgradeSystem';
import { WeaponUpgradeSystem } from '../systems/WeaponUpgradeSystem';
import { Ak47StrategicTargetSystem } from '../systems/Ak47StrategicTargetSystem';
import type { FireChunkTarget, GroundFireVisualStyle, PlayerInput } from '../types';
import type { NegevKillstreakExplosionEvent } from '../loadout/LoadoutManager';
import {
  COOP_DEFENSE_REPAIR_DRONE_UPGRADE_ID,
} from '../config/coopDefenseConstructions';
import { SHOCKWAVE_DAMAGE, SHOCKWAVE_RADIUS } from '../config';

export interface WorldPlayerGameplayNetworkPort {
  readonly teams: {
    readonly isEnemyPair: (firstPlayerId: string, secondPlayerId: string) => boolean;
  };
  readonly input: {
    readonly getPlayerInput: (playerId: string) => PlayerInput | undefined;
  };
  readonly presentation: {
    readonly broadcastExplosionEffect: (x: number, y: number, radius: number, color?: number) => void;
    readonly broadcastFireChunkEffect: (
      x: number,
      y: number,
      targets: readonly FireChunkTarget[],
      landsAt: number,
      visualStyle?: GroundFireVisualStyle,
    ) => void;
    readonly broadcastMiniRocketCollectionEffect: (x: number, y: number, color: number) => void;
    readonly broadcastMiniRocketDestructionEffect: (x: number, y: number, color: number) => void;
  };
  readonly roundStats: {
    readonly canPlayerReceiveRoundRewards: (playerId: string) => boolean;
    readonly recordUtilityUsed: (playerId: string) => void;
    readonly recordConstructionBuilt: (playerId: string) => void;
    readonly recordUltimateUsed: (playerId: string) => void;
  };
}

export interface WorldPlayerGameplaySystems {
  readonly playerModifier: CoopDefensePlayerModifierSystem;
  readonly itemRuntime: CoopDefenseItemRuntimeSystem;
  readonly resource: ResourceSystem;
  readonly burrow: BurrowSystem;
  readonly loadout: LoadoutManager;
  readonly translocator: TranslocatorSystem;
  readonly tunnel: TunnelSystem;
  readonly guardianSpirit: GuardianSpiritSystem | null;
  readonly repairDrone: RepairDroneSystem | null;
  readonly slimeTrail: SlimeTrailSystem | null;
  readonly flamethrowerUpgrade: FlamethrowerUpgradeSystem | null;
  readonly weaponUpgrade: WeaponUpgradeSystem | null;
  readonly ak47StrategicTarget: Ak47StrategicTargetSystem | null;
}

export interface WorldPlayerGameplayRuntimeOptions {
  readonly playerManager: PlayerManager;
  readonly projectileManager: ProjectileManager;
  readonly combatSystem: CombatSystem;
  readonly hostPhysics: HostPhysicsSystem;
  readonly fireSystem: FireSystem;
  readonly placementSystem: PlacementSystem;
  readonly gameAudioSystem: GameAudioSystem;
  readonly worldMetrics: WorldMetrics;
  readonly getEnemyManager: () => EnemyManager | null;
  readonly getTargetStatusSystem: () => TargetStatusSystem | null;
  readonly getPowerUpSystem: () => PowerUpSystem | null;
  readonly getPlayerCapabilities: (playerId: string) => PlayerCapabilities;
  readonly getTeamAdrenalineRegenMultiplier?: (playerId: string) => number;
  readonly resetPlayerPosition: (playerId: string, x: number, y: number) => void;
  readonly dropBeer: (playerId: string, x?: number, y?: number) => void;
  readonly createLoadoutManager: (resourceSystem: ResourceSystem) => LoadoutManager;
  readonly createBurrowSystem: (resourceSystem: ResourceSystem) => BurrowSystem;
  readonly network: WorldPlayerGameplayNetworkPort;
  readonly onSystemsChanged: (systems: WorldPlayerGameplaySystems | null) => void;
}

/** World-owned player/loadout state and its ability-side bindings. */
export class WorldPlayerGameplayRuntime implements WorldScopedBinding {
  readonly systems: WorldPlayerGameplaySystems;
  private destroyed = false;

  constructor(private readonly options: WorldPlayerGameplayRuntimeOptions) {
    const playerModifier = new CoopDefensePlayerModifierSystem();
    const itemRuntime = new CoopDefenseItemRuntimeSystem({
      getAffixValue: (playerId, affixId) => playerModifier.getItemAffixValue(playerId, affixId),
      getPlayerHp: (playerId) => {
        const player = options.playerManager.getPlayer(playerId);
        return player
          ? { hp: options.combatSystem.getHP(playerId), maxHp: options.combatSystem.getMaxHp(playerId) }
          : null;
      },
      getPlayerPosition: (playerId) => {
        const player = options.playerManager.getPlayer(playerId);
        return player ? { x: player.x, y: player.y } : null;
      },
      getPlayerClassId: (playerId) => playerModifier.getClassId(playerId) ?? null,
    });
    itemRuntime.setTargetStatusSystem(options.getTargetStatusSystem());

    const resource = new ResourceSystem();
    this.configureResource(resource, playerModifier, itemRuntime);
    const burrow = options.createBurrowSystem(resource);
    burrow.setWorldMetrics(options.worldMetrics);
    this.configureBurrow(burrow, playerModifier);

    const loadout = options.createLoadoutManager(resource);
    const translocator = new TranslocatorSystem(
      options.playerManager,
      options.projectileManager,
      options.combatSystem,
      null,
    );
    const tunnel = new TunnelSystem(
      options.playerManager,
      options.combatSystem,
      options.placementSystem,
      burrow,
      options.hostPhysics,
    );

    const enemyManager = options.getEnemyManager();
    const guardianSpirit = new GuardianSpiritSystem(
      options.playerManager,
      enemyManager,
      options.combatSystem,
      (playerId, stat, baseValue) => playerModifier.getResolvedStat(playerId, stat, baseValue),
    );
    const repairDrone = new RepairDroneSystem(
      options.playerManager,
      options.combatSystem,
      options.placementSystem,
      (playerId) => (
        playerModifier.getClassId(playerId) === 'inspector_gadachs'
        && (playerModifier.getCommittedProfile(playerId)?.upgrades[COOP_DEFENSE_REPAIR_DRONE_UPGRADE_ID]?.level ?? 0) > 0
      ),
    );
    const slimeTrail = new SlimeTrailSystem(
      options.playerManager,
      enemyManager,
      options.combatSystem,
      (playerId, stat, baseValue) => playerModifier.getResolvedStat(playerId, stat, baseValue),
      (playerId) => {
        const input = options.network.input.getPlayerInput(playerId);
        return options.hostPhysics.getDashPhase(playerId) === 0
          && !burrow.isBurrowed(playerId)
          && Math.hypot(input?.dx ?? 0, input?.dy ?? 0) > 0.01;
      },
    );
    const flamethrowerUpgrade = new FlamethrowerUpgradeSystem(
      options.playerManager,
      enemyManager,
      options.projectileManager,
      options.combatSystem,
      loadout,
      options.fireSystem,
      (playerId) => burrow.isBurrowed(playerId),
      (firstPlayerId, secondPlayerId) => !options.network.teams.isEnemyPair(firstPlayerId, secondPlayerId),
      (x, y, radius) => options.network.presentation.broadcastExplosionEffect(x, y, radius, 0xff6600),
      (playerId, stat, baseValue) => playerModifier.getResolvedStat(playerId, stat, baseValue),
      (x, y, targets, landsAt, visualStyle) => options.network.presentation.broadcastFireChunkEffect(
        x,
        y,
        targets,
        landsAt,
        visualStyle,
      ),
    );
    const weaponUpgrade = new WeaponUpgradeSystem(
      options.projectileManager,
      enemyManager,
      options.combatSystem,
      options.hostPhysics,
      options.fireSystem,
    );
    const ak47StrategicTarget = new Ak47StrategicTargetSystem(
      options.playerManager,
      enemyManager,
      options.combatSystem,
      loadout,
    );

    this.systems = {
      playerModifier,
      itemRuntime,
      resource,
      burrow,
      loadout,
      translocator,
      tunnel,
      guardianSpirit,
      repairDrone,
      slimeTrail,
      flamethrowerUpgrade,
      weaponUpgrade,
      ak47StrategicTarget,
    };
    options.onSystemsChanged(this.systems);
    this.bindLoadout(loadout, playerModifier, itemRuntime, burrow, translocator, tunnel);
  }

  updateEnemyManager(enemyManager: EnemyManager | null): void {
    if (enemyManager === null) {
      this.systems.guardianSpirit?.clear();
      this.systems.slimeTrail?.clear();
      this.systems.flamethrowerUpgrade?.clear();
      this.systems.weaponUpgrade?.clear();
      this.systems.ak47StrategicTarget?.clear();
    }
    this.systems.guardianSpirit?.setEnemyManager(enemyManager);
    this.systems.slimeTrail?.setEnemyManager(enemyManager);
    this.systems.flamethrowerUpgrade?.setEnemyManager(enemyManager);
    this.systems.weaponUpgrade?.setEnemyManager(enemyManager);
    this.systems.ak47StrategicTarget?.setEnemyManager(enemyManager);
  }

  setPowerUpSystem(system: PowerUpSystem | null): void {
    this.systems.resource.setPowerUpSystem(system);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const { systems } = this;
    systems.loadout.setAk47StrategicTargetHitResolver(null);
    systems.loadout.setCombatSystem(null);
    systems.loadout.setPhysicsSystem(null);
    systems.loadout.setTranslocatorSystem(null);
    systems.loadout.setDecoySystem(null);
    systems.loadout.setNegevKillstreakExplosionHandler(null);
    systems.loadout.setUtilityConfigModifierSource(null);
    systems.loadout.setItemRuntimeChargeConsumer(null);
    systems.loadout.setItemRuntimeWeaponFiredHandler(null);
    systems.loadout.setUtilityUsedCallback(null);
    systems.loadout.setUtilityUsedObserver(null);
    systems.loadout.setUltimateUsedObserver(null);
    systems.loadout.setActionBlockedChecker(null);
    systems.loadout.setNukeStrikeHandler(null);
    systems.loadout.setStinkCloudSystem(null);
    systems.loadout.resetAllUltimateStates();
    systems.guardianSpirit?.clear();
    systems.repairDrone?.clear();
    systems.slimeTrail?.clear();
    systems.flamethrowerUpgrade?.clear();
    systems.weaponUpgrade?.clear();
    systems.ak47StrategicTarget?.clear();
    systems.tunnel.clear();
    systems.translocator.setUseCallback(null);
    systems.translocator.setRadialImpulseCallback(null);
    systems.translocator.setPositionResetCallback(null);
    for (const player of this.options.playerManager.getAllPlayers()) {
      systems.resource.removePlayer(player.id);
      systems.burrow.removePlayer(player.id);
      systems.translocator.removePlayer(player.id);
    }
    systems.resource.setPowerUpSystem(null);
    systems.resource.setAdrenalineMaxResolver(null);
    systems.resource.setAdrenalineRegenRateResolver(null);
    systems.resource.setRageMaxResolver(null);
    systems.resource.setRageGainMultiplierResolver(null);
    systems.resource.setAdrenalineGainMultiplierResolver(null);
    systems.resource.setAdrenalineCostMultiplierResolver(null);
    systems.resource.setAdrenalineSpawnFullResolver(null);
    systems.burrow.setWorldMetrics(null);
    systems.burrow.setStinkCloudSystem(null);
    systems.burrow.setBurrowStartCallback(null);
    systems.burrow.setPositionResetCallback(null);
    systems.burrow.setTunnelTransitEndedCallback(null);
    systems.burrow.setUndergroundSpeedResolver(null);
    systems.burrow.setDrainMultiplierResolver(null);
    systems.burrow.setShockwaveDamageResolver(null);
    systems.burrow.setShockwaveRadiusResolver(null);
    systems.playerModifier.clear();
    systems.itemRuntime.clear();
    this.options.onSystemsChanged(null);
  }

  private configureResource(
    resource: ResourceSystem,
    playerModifier: CoopDefensePlayerModifierSystem,
    itemRuntime: CoopDefenseItemRuntimeSystem,
  ): void {
    resource.setAdrenalineMaxResolver((playerId) => playerModifier.getResolvedStat(playerId, 'player.maxAdrenaline', 100));
    resource.setAdrenalineRegenRateResolver((playerId) => {
      const base = playerModifier.getResolvedStat(playerId, 'player.adrenalineRegenRate', 10);
      return base
        * itemRuntime.getAdrenalineRegenMultiplier(playerId)
        * (this.options.getTeamAdrenalineRegenMultiplier?.(playerId) ?? 1);
    });
    resource.setRageMaxResolver((playerId) => playerModifier.getResolvedStat(playerId, 'ultimate.maxRage', 600));
    resource.setRageGainMultiplierResolver((playerId) => 1 + playerModifier.getPercentageStat(playerId, 'ultimate.rageGainPerDamage'));
    resource.setAdrenalineGainMultiplierResolver((playerId) => 1 + playerModifier.getPercentageStat(playerId, 'player.adrenalineGain'));
    resource.setAdrenalineCostMultiplierResolver((playerId) => 1 + playerModifier.getPercentageStat(playerId, 'player.adrenalineCost'));
    resource.setAdrenalineSpawnFullResolver((playerId) => playerModifier.getNumericStat(playerId, 'player.adrenalineSpawnFull') > 0);
  }

  private configureBurrow(burrow: BurrowSystem, playerModifier: CoopDefensePlayerModifierSystem): void {
    burrow.setUndergroundSpeedResolver((playerId) => playerModifier.getResolvedStat(playerId, 'player.burrowSpeed', 1.3));
    burrow.setDrainMultiplierResolver((playerId) => 1 + playerModifier.getPercentageStat(playerId, 'player.burrowCost'));
    burrow.setShockwaveDamageResolver((playerId) => playerModifier.getResolvedStat(playerId, 'player.unburrowShockwaveDamage', SHOCKWAVE_DAMAGE));
    burrow.setShockwaveRadiusResolver((playerId) => playerModifier.getResolvedStat(playerId, 'player.unburrowShockwaveRadius', SHOCKWAVE_RADIUS));
    burrow.setPositionResetCallback((playerId, x, y) => this.options.resetPlayerPosition(playerId, x, y));
    burrow.setBurrowStartCallback((playerId) => this.options.dropBeer(playerId));
  }

  private bindLoadout(
    loadout: LoadoutManager,
    playerModifier: CoopDefensePlayerModifierSystem,
    itemRuntime: CoopDefenseItemRuntimeSystem,
    burrow: BurrowSystem,
    translocator: TranslocatorSystem,
    tunnel: TunnelSystem,
  ): void {
    loadout.setCombatSystem(this.options.combatSystem);
    loadout.setDashBurstChecker((playerId) => this.options.hostPhysics.isDashBurst(playerId));
    loadout.setPhysicsSystem(this.options.hostPhysics);
    loadout.setAk47StrategicTargetHitResolver((playerId, enemyId) => this.systems.ak47StrategicTarget?.isCurrentTarget(playerId, enemyId) ?? false);
    loadout.setNegevKillstreakExplosionHandler((event: NegevKillstreakExplosionEvent) => {
      this.options.network.presentation.broadcastExplosionEffect(event.x, event.y, event.radius, 0xff8a2d);
      this.systems.flamethrowerUpgrade?.hostCreateFireChunkBurst(event.ownerId, event.x, event.y, {
        count: event.kills,
        searchRadius: event.radius,
        flightMs: 320,
        igniteCenter: false,
        durationMs: event.fireChunkDurationMs,
        burnDurationMs: event.fireChunkBurnDurationMs,
        burnDamagePerTick: event.fireChunkBurnDamagePerTick,
        sourceId: 'weapon.NEGEV.killstreak',
      }, `negev-killstreak:${event.ownerId}:${Date.now()}`);
    });
    loadout.setUtilityConfigModifierSource((playerId) => {
      const modifiers = playerModifier.getModifiers(playerId);
      return { additive: modifiers.additiveStats, percentage: modifiers.percentageStats };
    });
    loadout.setItemRuntimeChargeConsumer((playerId) => itemRuntime.consumeMovementCharge(playerId));
    loadout.setItemRuntimeWeaponFiredHandler((playerId, sourceSlot) => itemRuntime.registerWeaponFired(playerId, sourceSlot));
    loadout.setUtilityUsedCallback((playerId, utilityType) => {
      if (utilityType !== 'decoy') return;
      this.options.dropBeer(playerId);
      const player = this.options.playerManager.getPlayer(playerId);
      if (player) this.options.gameAudioSystem.playSound('sfx_place_decoy', player.x, player.y, playerId);
    });
    loadout.setUtilityUsedObserver((playerId, utilityType) => {
      this.options.network.roundStats.recordUtilityUsed(playerId);
      if (utilityType === 'placeable_rock' || utilityType === 'placeable_turret' || utilityType === 'placeable_pedestal') {
        this.options.network.roundStats.recordConstructionBuilt(playerId);
      }
    });
    loadout.setUltimateUsedObserver((playerId) => this.options.network.roundStats.recordUltimateUsed(playerId));
    translocator.setUseCallback((playerId) => this.options.dropBeer(playerId));
    translocator.setRadialImpulseCallback((x, y, radius, knockback, ownerId) => {
      this.options.hostPhysics.applyRadialImpulse(x, y, radius, knockback, ownerId, 0);
    });
    translocator.setPositionResetCallback((playerId, x, y) => this.options.resetPlayerPosition(playerId, x, y));
    tunnel.setTunnelEnterCallback((playerId, x, y) => {
      this.options.dropBeer(playerId, x, y);
      this.options.gameAudioSystem.playSound('sfx_use_dachstunnel', x, y, playerId);
    });
    tunnel.setPositionResetCallback((playerId, x, y) => this.options.resetPlayerPosition(playerId, x, y));
    burrow.setTunnelTransitEndedCallback((playerId) => tunnel.notifyTransitEnded(playerId));
    loadout.setActionBlockedChecker((playerId, slot) => {
      if (!this.options.getPlayerCapabilities(playerId).canInteract) return true;
      if (!this.options.combatSystem.isAlive(playerId)) return true;
      if ((slot === 'weapon1' || slot === 'weapon2') && burrow.isWeaponBlocked(playerId)) return true;
      if ((slot === 'utility' || slot === 'ultimate') && burrow.isUtilityBlocked(playerId)) return true;
      return false;
    });
    loadout.setNukeStrikeHandler((playerId, targetX, targetY) => (
      this.options.getPowerUpSystem()?.scheduleNukeStrike(playerId, targetX, targetY) ?? false
    ));
  }
}
