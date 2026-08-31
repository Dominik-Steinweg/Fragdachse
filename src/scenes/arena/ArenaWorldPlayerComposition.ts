import { bridge } from '../../network/bridge';
import { BurrowSystem } from '../../systems/BurrowSystem';
import { LoadoutManager } from '../../loadout/LoadoutManager';
import {
  WorldPlayerGameplayRuntime,
  type WorldPlayerGameplaySystems,
} from '../../world/WorldPlayerGameplayRuntime';
import type {
  ArenaWorldGameplay,
  ArenaWorldGameplayCompositionInput,
} from './ArenaWorldGameplayComposition';

/**
 * Der world-lokale Player-/Loadout-/Build-Graph des Hosts.
 *
 * Er gehoert der World und ueberlebt darin jeden Activity-Wechsel; die Activity liefert nur ihre
 * aktuellen Reads nach. Ohne Host entsteht er nicht - ein Client haelt keine autoritative
 * Player-Gameplay-Runtime.
 */
export function composeWorldPlayerGameplay(
  input: ArenaWorldGameplayCompositionInput,
  gameplay: ArenaWorldGameplay,
): void {
  const { ctx, flow, worldRuntime, world, placementSystem } = input;
  // Der Coop-Build gehoert zur laufenden World und kann deshalb auch in einer Activity-losen
  // LobbyWorld wirken. Die darunterliegenden Missionssysteme bleiben weiterhin an
  // `isCoopMission`/`missionMapConfig` gebunden.
  const playerGameplayRuntime = new WorldPlayerGameplayRuntime({
    playerManager: ctx.playerManager,
    projectileManager: ctx.projectileManager,
    combatSystem: ctx.combatSystem,
    hostPhysics: ctx.hostPhysics,
    fireSystem: ctx.fireSystem,
    placementSystem,
    gameAudioSystem: ctx.gameAudioSystem,
    worldMetrics: world.metrics,
    getEnemyManager: () => ctx.enemyManager,
    getTargetStatusSystem: () => ctx.targetStatusSystem,
    getPowerUpSystem: () => ctx.powerUpSystem,
    getPlayerCapabilities: (playerId) => flow.getPlayerCapabilities(playerId),
    getTeamAdrenalineRegenMultiplier: (playerId) => ctx.coopDefenseTeamBuffSystem?.getAdrenalineRegenMultiplier(
      Date.now(),
      bridge.canPlayerReceiveRoundRewards(playerId),
      ctx.combatSystem.isAlive(playerId),
    ) ?? 1,
    resetPlayerPosition: (playerId, x, y) => {
      flow.getCoopMissionRuntime()?.coopDefenseMissionProgressSystem?.resetPlayerPosition(playerId, x, y);
    },
    dropBeer: (playerId, x, y) => ctx.captureTheBeerSystem?.dropBeerForPlayer(playerId, x, y),
    createLoadoutManager: (resourceSystem) => new LoadoutManager(
      ctx.playerManager,
      ctx.projectileManager,
      resourceSystem,
      bridge,
    ),
    createBurrowSystem: (resourceSystem) => new BurrowSystem(
      resourceSystem,
      ctx.playerManager,
      ctx.combatSystem,
      ctx.hostPhysics,
      bridge,
    ),
    network: {
      teams: {
        isEnemyPair: (firstPlayerId, secondPlayerId) => bridge.isEnemyPair(firstPlayerId, secondPlayerId),
      },
      input: {
        getPlayerInput: (playerId) => bridge.getPlayerInput(playerId),
      },
      presentation: {
        broadcastExplosionEffect: (x, y, radius, color) => bridge.broadcastExplosionEffect(x, y, radius, color),
        broadcastFireChunkEffect: (x, y, targets, landsAt, visualStyle) => bridge.broadcastFireChunkEffect(x, y, targets, landsAt, visualStyle),
        broadcastMiniRocketCollectionEffect: (x, y, color) => bridge.broadcastMiniRocketCollectionEffect(x, y, color),
        broadcastMiniRocketDestructionEffect: (x, y, color) => bridge.broadcastMiniRocketDestructionEffect(x, y, color),
      },
      roundStats: {
        canPlayerReceiveRoundRewards: (playerId) => bridge.canPlayerReceiveRoundRewards(playerId),
        recordUtilityUsed: (playerId) => bridge.recordUtilityUsed(playerId),
        recordConstructionBuilt: (playerId) => bridge.recordConstructionBuilt(playerId),
        recordUltimateUsed: (playerId) => bridge.recordUltimateUsed(playerId),
      },
    },
    onSystemsChanged: (systems: WorldPlayerGameplaySystems | null) => {
      ctx.coopDefensePlayerModifierSystem = systems?.playerModifier ?? null;
      ctx.coopDefenseItemRuntimeSystem = systems?.itemRuntime ?? null;
      ctx.resourceSystem = systems?.resource ?? null;
      ctx.burrowSystem = systems?.burrow ?? null;
      ctx.loadoutManager = systems?.loadout ?? null;
      ctx.translocatorSystem = systems?.translocator ?? null;
      ctx.tunnelSystem = systems?.tunnel ?? null;
      ctx.guardianSpiritSystem = systems?.guardianSpirit ?? null;
      ctx.repairDroneSystem = systems?.repairDrone ?? null;
      ctx.slimeTrailSystem = systems?.slimeTrail ?? null;
      ctx.flamethrowerUpgradeSystem = systems?.flamethrowerUpgrade ?? null;
      ctx.weaponUpgradeSystem = systems?.weaponUpgrade ?? null;
      ctx.ak47StrategicTargetSystem = systems?.ak47StrategicTarget ?? null;
    },
  });
  gameplay.player = playerGameplayRuntime;
  worldRuntime.bind(playerGameplayRuntime);
  flow.syncHostPlayerModifiers();
  
}
