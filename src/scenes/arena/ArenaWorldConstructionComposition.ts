import { bridge } from '../../network/bridge';
import { PLAYER_COLORS } from '../../config';
import { getStoredLocalOwnerId } from '../../utils/localPreferences';
import { emitArenaMapGridChanged } from './ArenaEvents';
import { WorldPowerUpRuntime } from '../../world/WorldPowerUpRuntime';
import { ConstructionWorldRuntime, type ConstructionPersistentBaseContext } from '../../world/ConstructionWorldRuntime';
import { PersistentBaseWorldMaterializer } from '../../world/PersistentBaseWorldMaterializer';
import type {
  ArenaWorldGameplay,
  ArenaWorldGameplayCompositionInput,
} from './ArenaWorldGameplayComposition';

/**
 * Der host-seitige Bau- und PowerUp-Anteil einer World.
 *
 * PowerUp-Runtime, Konstruktionsregeln und die world-lokale Persistent-Base-Materialisierung
 * haengen zusammen: Podeste, Belohnungen und Beitraege stehen in denselben Zellen. Sie entstehen
 * deshalb an einer Grenze - und gehoeren danach ihren eigenen Ownern.
 */

/** Die eine World-PowerUp-Runtime dieser Instanz. */
export function composeWorldPowerUp(
  input: ArenaWorldGameplayCompositionInput,
  gameplay: ArenaWorldGameplay,
): void {
  const {
    ctx, rockVisualHelper, hostUpdate, flow, worldRuntime, world, layout,
    placementSystem, baseManager,
  } = input;
  const powerUpRuntime = new WorldPowerUpRuntime({
    playerManager: ctx.playerManager,
    combatSystem: ctx.combatSystem,
    layout,
    worldMetrics: world.metrics,
    recordPowerUpCollected: (playerId) => bridge.recordPowerUpCollected(playerId),
    addTemporaryUtility: (playerId, config) => (
      gameplay.player?.addTemporaryUtility(playerId, config, 1) !== null
    ),
    claimObjectiveReward: (objectiveId, playerId) => (
      flow.getCoopMissionRuntime()?.coopDefenseObjectivePlacementRewardSystem?.claim(objectiveId, playerId) ?? false
    ),
    reportDiagnosticEvent: (type, fields) => flow.onDiagnosticEvent(type, fields),
    broadcastExplosion: (x, y, radius, color, style) => (
      bridge.broadcastExplosionEffect(x, y, radius, color, style)
    ),
    applyNukeEnvironmentDamage: (x, y, radius, triggeredBy) => (
      hostUpdate.applyNukeEnvironmentDamage(x, y, radius, triggeredBy)
    ),
    notifyVoidHunterNuke: (strike) => flow.getCoopMissionRuntime()?.coopDefenseVoidHunterSystem?.notifyNukeExploded(strike),
    coopDefenseMapXpReference: 1,
    isAdrenalineDropEnabled: (playerId) => (
      (gameplay.player?.systems.playerModifier.getResolvedStat(playerId, 'player.adrenalineDropEnabled', 0) ?? 0) > 0
    ),
    getAdrenalineDropChanceMultiplier: (playerId) => (
      1 + (gameplay.player?.systems.playerModifier.getPercentageStat(playerId, 'player.adrenalineDropChance') ?? 0)
    ),
    getAdrenalineSyringeDurationMultiplier: (playerId) => (
      1 + (gameplay.player?.systems.playerModifier.getPercentageStat(playerId, 'player.adrenalineSyringeDuration') ?? 0)
    ),
    isLinkedBaseActive: (baseId) => baseManager?.getActiveBaseIds().has(baseId) ?? false,
    getConstructionRespawnMultiplier: (constructionId) => {
      const rock = placementSystem.getRuntimeRock(constructionId);
      if (!rock) return 1;
      const rockWorld = rockVisualHelper.gridToWorld(rock.gridX, rock.gridY);
      return gameplay.targeting?.systems.energyInjector.getPowerUpRespawnMultiplierAt(rockWorld.x, rockWorld.y) ?? 1;
    },
    onDestroy: () => {
      if (gameplay.powerUp === powerUpRuntime) gameplay.powerUp = null;
    },
  });
  gameplay.powerUp = powerUpRuntime;
  worldRuntime.bind(powerUpRuntime);
  powerUpRuntime.system.setArenaStartTime(bridge.getArenaStartTime());
  flow.syncActivityXpReference();
  gameplay.player?.setPowerUpSystem(powerUpRuntime.system);
}

/** Konstruktionsregeln der World und die world-lokale Materialisierung der persistenten Basis. */
export function composeWorldConstruction(
  input: ArenaWorldGameplayCompositionInput,
  gameplay: ArenaWorldGameplay,
): void {
  const {
    scene, ctx, rockVisualHelper, flow, persistentBaseStores, worldRuntime,
    placementSystem, baseManager, persistentBaseBinding, coopMissionRuntime, activityDescriptor,
  } = input;
  const playerGameplay = gameplay.player;
  const burrowSystem = playerGameplay?.systems.burrow ?? null;
  if (!playerGameplay || !burrowSystem) {
    throw new Error('[ArenaWorldComposition] Player gameplay runtime is missing on host');
  }
  const constructionRuntime = new ConstructionWorldRuntime({
    scene: scene,
    playerManager: ctx.playerManager,
    combatSystem: ctx.combatSystem,
    placementSystem,
    utilityAction: playerGameplay,
    targetStatusSystem: gameplay.targeting?.systems.targetStatus ?? null,
    energyInjectorSystem: gameplay.targeting?.systems.energyInjector ?? null,
    powerUpSystem: gameplay.powerUp?.system ?? null,
    modifierSystem: gameplay.player?.systems.playerModifier ?? null,
    burrowSystem,
    tunnelSystem: gameplay.player?.systems.tunnel ?? null,
    gameAudioSystem: ctx.gameAudioSystem,
    getGameMode: () => flow.getConfiguredGameMode(),
    getPlayerCapabilities: (playerId) => flow.getPlayerCapabilities(playerId),
    getCurrentLoadout: (playerId) => bridge.getPlayerCurrentLoadoutSnapshot(playerId),
    getPersistentBaseContext: (): ConstructionPersistentBaseContext | null => (
      flow.getPersistentBaseConstructionContext()
    ),
    persistentBaseBinding,
    resolveOwnerId: (playerId) => flow.resolveOwnerId(playerId),
    getLocalPlayerId: () => bridge.getLocalPlayerId(),
    isHost: () => bridge.isHost(),
    acceptsPersistentBaseMutation: (activityRevision) => flow.acceptsCurrentPersistentBaseMutation(activityRevision),
    mayManagePersistentBase: (playerId) => flow.mayManagePersistentBase(playerId),
    getRewardPlacementRuntime: () => {
      const runtime = flow.getCoopMissionRuntime()?.coopDefenseObjectivePlacementRewardSystem;
      return runtime
        ? { canPlace: (objectiveId, playerId) => runtime.canPlace(objectiveId, playerId), consume: (objectiveId, playerId) => runtime.consume(objectiveId, playerId) }
        : null;
    },
    emitGridChanged: (event) => emitArenaMapGridChanged(scene.game.events, {
      reason: event.reason,
      source: event.source,
      ...(event.runtime ? {
        obstacleId: event.runtime.id,
        gridX: event.runtime.gridX,
        gridY: event.runtime.gridY,
        collisionMode: event.runtime.collisionMode,
      } : {}),
    }),
    relocatePresentation: (previous, next) => flow.relocatePlaceableRuntimePresentation(previous, next),
    reconcilePersistentBaseWorld: () => flow.reconcilePersistentBaseWorld(),
    publishImmediateContribution: (ownerId) => flow.publishImmediatePersistentBaseContribution(ownerId),
    persistRewards: () => flow.persistCommittedPersistentBaseRewards(),
    publishRewardSessionState: () => flow.publishPersistentBaseRewardSessionState(),
    publishUtilityCooldown: (playerId, until, key) => bridge.publishUtilityCooldownUntil(playerId, until, key),
    recordConstructionBuilt: (playerId) => bridge.recordConstructionBuilt(playerId),
    onDestroy: () => {
      playerGameplay.setTunnelPlacementCapability(null);
      if (gameplay.construction === constructionRuntime) gameplay.construction = null;
    },
    rockVisualHelper: {
      gridToWorld: (gridX, gridY) => rockVisualHelper.gridToWorld(gridX, gridY),
      materializePlaceableRock: (runtime, playDust) => rockVisualHelper.materializePlaceableRock(runtime, playDust),
      removePlaceableRockVisual: (runtime, playDust) => rockVisualHelper.removePlaceableRockVisual(runtime, playDust),
    },
  });
  playerGameplay.setUtilityPlacementCapability((cfg, playerId, x, y, targetX, targetY, now, playerColor, params) => (
    constructionRuntime.placePlaceableRock(cfg, playerId, x, y, targetX, targetY, now, playerColor, params)
  ));
  playerGameplay.setTunnelPlacementCapability({
    placeTunnel: (cfg, playerId, originX, originY, targetX, targetY, playerColor, params) => (
      constructionRuntime.placeTunnel(cfg, playerId, originX, originY, targetX, targetY, playerColor, params)
    ),
  });
  gameplay.construction = constructionRuntime;
  worldRuntime.bind(constructionRuntime);
  persistentBaseBinding.setMaterializer(new PersistentBaseWorldMaterializer({
    binding: persistentBaseBinding,
    contributions: persistentBaseStores.contributions,
    rewards: persistentBaseStores.rewards,
    placementSystem,
    powerUpSystem: gameplay.powerUp?.system ?? null,
    baseManager,
    // The WorldLifecycle sink clears its local runtime slot before destroying the runtime.
    // Read the descriptor context until that destruction has completed so PB finalization
    // still sees the live World site and can keep R-2's Construction-before-PB order.
    getSite: () => worldRuntime.context.persistentBaseSite,
    rockVisualHelper: rockVisualHelper,
    isHost: () => bridge.isHost(),
    getMapId: () => flow.getWorldMapId(),
    getLocalOwnerId: () => getStoredLocalOwnerId(),
    resolvePlayerIdForOwner: (ownerId) => flow.resolvePlayerIdForOwner(ownerId),
    getPlayerColor: (playerId) => bridge.getPlayerColor(playerId) ?? PLAYER_COLORS[0],
    construction: {
      getCapacity: (playerId) => constructionRuntime.getCapacity(playerId),
      getOwnership: (playerId) => constructionRuntime.getOwnership(playerId),
      resolveRestoreTools: (playerId) => constructionRuntime.buildRestoreTools(playerId),
      materializeRestoreCandidate: (candidate, playerId, ownerColor, ownership) => (
        constructionRuntime.materializeRestoreCandidate(candidate, playerId, ownerColor, ownership)
      ),
      materializeRewardConstruction: (constructionId, rewardId, gridX, gridY, angle, ownerId, ownerColor) => (
        constructionRuntime.materializeRewardConstruction(
          constructionId,
          rewardId,
          gridX,
          gridY,
          angle,
          ownerId,
          ownerColor,
        )
      ),
      releaseRuntime: (runtime, playDust) => constructionRuntime.releaseRuntime(runtime, playDust),
    },
    emitRestoreAdded: (runtime) => flow.emitPersistentRestoreAdded(runtime),
    emitGridChanged: (source) => emitArenaMapGridChanged(scene.game.events, {
      reason: 'placeables_batch_removed',
      source,
    }),
    onDiagnosticEvent: (type, fields) => flow.onDiagnosticEvent(type, fields),
  }));
  if (coopMissionRuntime && activityDescriptor?.kind === 'coop-mission') {
    flow.bindActivityPowerUpPedestals(
      activityDescriptor,
      coopMissionRuntime,
      flow.getActivityStartAnchor() ?? undefined,
    );
  }
  gameplay.combat?.setPowerUpSystem(gameplay.powerUp?.system ?? null);
}
