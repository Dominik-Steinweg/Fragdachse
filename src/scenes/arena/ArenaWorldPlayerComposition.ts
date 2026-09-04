import { bridge } from '../../network/bridge';
import { BurrowSystem } from '../../systems/BurrowSystem';
import { LoadoutManager } from '../../loadout/LoadoutManager';
import {
  WorldPlayerGameplayRuntime,
} from '../../world/WorldPlayerGameplayRuntime';
import { WorldWeaponExecutionRuntime } from '../../world/WorldWeaponExecutionRuntime';
import { AutomatedWeaponExecutionAdapter } from '../../world/AutomatedWeaponExecutionAdapter';
import { SpecializedWeaponExecutionAdapter } from '../../world/SpecializedWeaponExecutionAdapter';
import { getUtilityConfigForMode } from '../../loadout/LoadoutConfig';
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
  // Gemeinsame Immediate-Weapon-Execution-Capability: world-composed, ohne Player-Resource-/
  // Loadout-Autoritaet. Der Loadout delegiert seinen Player-Fire hierher; automatische Quellen
  // verwenden den daneben liegenden world-lokalen Adapter.
  const weaponExecution = new WorldWeaponExecutionRuntime({
    projectileManager: ctx.projectileManager,
    combatSystem: ctx.combatSystem,
  });
  const specializedWeaponExecution = new SpecializedWeaponExecutionAdapter(ctx.projectileManager);
  gameplay.weaponExecution = weaponExecution;
  gameplay.specializedWeaponExecution = specializedWeaponExecution;
  const automatedWeaponExecution = new AutomatedWeaponExecutionAdapter(
    weaponExecution,
    ctx.projectileManager,
    specializedWeaponExecution,
  );
  gameplay.automatedWeaponExecution = automatedWeaponExecution;
  worldRuntime.bind(weaponExecution);
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
    getEnemyManager: () => flow.getCoopMissionRuntime()?.enemyManager ?? null,
    getTargetStatusSystem: () => gameplay.targeting?.systems.targetStatus ?? null,
    getPowerUpSystem: () => gameplay.powerUp?.system ?? null,
    getPlayerCapabilities: (playerId) => flow.getPlayerCapabilities(playerId),
    relationship: {
      isEnemyPair: (firstPlayerId, secondPlayerId) => bridge.isEnemyPair(firstPlayerId, secondPlayerId),
    },
    getTeamAdrenalineRegenMultiplier: (playerId) => flow.getCoopMissionRuntime()?.coopDefenseTeamBuffSystem?.getAdrenalineRegenMultiplier(
      Date.now(),
      bridge.canPlayerReceiveRoundRewards(playerId),
      ctx.combatSystem.isAlive(playerId),
    ) ?? 1,
    resetPlayerPosition: (playerId, x, y) => {
      flow.getCoopMissionRuntime()?.coopDefenseMissionProgressSystem?.resetPlayerPosition(playerId, x, y);
    },
    dropBeer: (playerId, x, y) => flow.getCaptureTheBeerSystem()?.dropBeerForPlayer(playerId, x, y),
    decoySystem: ctx.decoySystem,
    stinkCloudSystem: ctx.stinkCloudSystem,
    resolveToolUtilityConfig: (toolRef) => toolRef.kind === 'utility'
      ? getUtilityConfigForMode(toolRef.id, bridge.getActiveGameMode())
      : undefined,
    isUtilityToolAuthorized: (playerId, toolRef) => {
      const current = bridge.getPlayerCurrentLoadoutSnapshot(playerId);
      return toolRef.kind === 'utility'
        && current?.coopDefenseClassId === 'inspector_gadachs'
        && (current.tools ?? []).some((tool) => tool.kind === 'utility' && tool.id === toolRef.id);
    },
    createLoadoutManager: (resourceSystem) => new LoadoutManager(resourceSystem, {
      getGameMode: () => bridge.getGameMode(),
    } as never),
    weaponExecution,
    specializedWeaponExecution,
    gaussExecution: {
      fireGauss: (config, params) => automatedWeaponExecution.fireGauss(config, params),
    },
    createBurrowSystem: (resourceSystem) => new BurrowSystem(
      resourceSystem,
      ctx.playerManager,
      ctx.combatSystem,
      ctx.hostPhysics,
      bridge,
    ),
    network: {
      input: {
        getPlayerInput: (playerId) => bridge.getPlayerInput(playerId),
      },
      presentation: {
        getPlayerColor: (playerId) => bridge.getPlayerColor(playerId),
        broadcastTranslocatorFlash: (x, y, color, phase, ownerId) => bridge.broadcastTranslocatorFlash(x, y, color, phase, ownerId),
        broadcastExplosionEffect: (x, y, radius, color, visualStyle) => bridge.broadcastExplosionEffect(x, y, radius, color, visualStyle),
        broadcastShotFx: (shooterId, duration, intensity) => bridge.broadcastShotFx(shooterId, duration, intensity),
        broadcastFireChunkEffect: (x, y, targets, landsAt, visualStyle) => bridge.broadcastFireChunkEffect(x, y, targets, landsAt, visualStyle),
        broadcastMiniRocketCollectionEffect: (x, y, color) => bridge.broadcastMiniRocketCollectionEffect(x, y, color),
        broadcastMiniRocketDestructionEffect: (x, y, color) => bridge.broadcastMiniRocketDestructionEffect(x, y, color),
      },
      loadout: {
        publishUtilityCooldownUntil: (playerId, until, utilityId) => bridge.publishUtilityCooldownUntil(playerId, until, utilityId),
        publishTemporaryUtilityInstances: (playerId, descriptors) => bridge.publishTemporaryUtilityInstances(playerId, descriptors),
        publishHeldUtilityId: (playerId, utilityId) => bridge.publishHeldUtilityId(playerId, utilityId),
      },
      roundStats: {
        canPlayerReceiveRoundRewards: (playerId) => bridge.canPlayerReceiveRoundRewards(playerId),
        recordUtilityUsed: (playerId) => bridge.recordUtilityUsed(playerId),
        recordConstructionBuilt: (playerId) => bridge.recordConstructionBuilt(playerId),
        recordUltimateUsed: (playerId) => bridge.recordUltimateUsed(playerId),
      },
    },
  });
  gameplay.player = playerGameplayRuntime;
  worldRuntime.bind(playerGameplayRuntime);
  flow.syncHostPlayerModifiers();
  
}
