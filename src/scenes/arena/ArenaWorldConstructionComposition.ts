import { bridge } from '../../network/bridge';
import { PLAYER_COLORS } from '../../config';
import { getStoredLocalOwnerId } from '../../utils/localPreferences';
import { emitArenaMapGridChanged, emitArenaRockDestroyed } from './ArenaEvents';
import { WorldPowerUpRuntime } from '../../world/WorldPowerUpRuntime';
import { ConstructionWorldRuntime, type ConstructionPersistentBaseContext } from '../../world/ConstructionWorldRuntime';
import { PersistentBaseWorldMaterializer } from '../../world/PersistentBaseWorldMaterializer';
import type {
  ArenaWorldGameplay,
  ArenaWorldGameplayCompositionInput,
} from './ArenaWorldGameplayComposition';
import { shouldDropRockArmor, WorldRockRuntime } from '../../world/WorldRockRuntime';
import { WorldObjectMutationRuntime } from '../../world/WorldObjectMutationRuntime';
import { isCoopDefenseMode } from '../../gameModes';
import { worldCellCenter } from '../../world/WorldMetrics';

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
  const combatSystem = gameplay.combatSystem;
  if (!combatSystem) throw new Error('[ArenaWorldComposition] Combat runtime is missing');
  const powerUpRuntime = new WorldPowerUpRuntime({
    playerManager: ctx.playerManager,
    combatSystem,
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
      (gameplay.player?.getPlayerModifierReadPort().getResolvedStat(playerId, 'player.adrenalineDropEnabled', 0) ?? 0) > 0
    ),
    getAdrenalineDropChanceMultiplier: (playerId) => (
      1 + (gameplay.player?.getPlayerModifierReadPort().getPercentageStat(playerId, 'player.adrenalineDropChance') ?? 0)
    ),
    getAdrenalineSyringeDurationMultiplier: (playerId) => (
      1 + (gameplay.player?.getPlayerModifierReadPort().getPercentageStat(playerId, 'player.adrenalineSyringeDuration') ?? 0)
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
    scene, ctx, rockVisualHelper, flow, persistentBaseStores, worldRuntime, world,
    placementSystem, baseManager, persistentBaseBinding, coopMissionRuntime, activityDescriptor,
  } = input;
  const combatSystem = gameplay.combatSystem;
  if (!combatSystem) throw new Error('[ArenaWorldComposition] Combat runtime is missing');
  const playerGameplay = gameplay.player;
  if (!playerGameplay) {
    throw new Error('[ArenaWorldComposition] Player gameplay runtime is missing on host');
  }
  const constructionRuntime = new ConstructionWorldRuntime({
    scene: scene,
    playerManager: ctx.playerManager,
    combatSystem,
    placementSystem,
    utilityAction: playerGameplay,
    targetStatusSystem: gameplay.targeting?.systems.targetStatus ?? null,
    energyInjectorSystem: gameplay.targeting?.systems.energyInjector ?? null,
    powerUpSystem: gameplay.powerUp?.system ?? null,
    modifierReadPort: playerGameplay.getPlayerModifierReadPort(),
    tunnelPlacementPort: playerGameplay.getTunnelPlacementPort(),
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
    onPlacementExecuted: playerId => ctx.decoySystem.breakStealth(playerId, Date.now()),
    recordConstructionBuilt: (playerId) => bridge.recordConstructionBuilt(playerId),
    onConstructionDestroyed: (runtime, cause, attackerId) => {
      if (cause === 'damage' && runtime.kind === 'rock'
        && attackerId !== runtime.ownerId && (runtime.enemyDestroyedExplosionRadius ?? 0) > 0) {
        const point = worldCellCenter(world.metrics, runtime.gridX, runtime.gridY);
        combatSystem.applyAoeDamage(
          point.x, point.y, runtime.enemyDestroyedExplosionRadius ?? 0,
          runtime.enemyDestroyedExplosionDamage ?? 0, runtime.ownerId, false,
          { category: 'explosion', allowTeamDamage: false, sourceId: 'environment.rock_collapse', sourceSlot: 'utility' },
        );
        ctx.hostPhysics.applyRadialImpulse(
          point.x, point.y, runtime.enemyDestroyedExplosionRadius ?? 0,
          runtime.enemyDestroyedExplosionKnockback ?? 0, runtime.ownerId, 0,
        );
        try { bridge.broadcastExplosionEffect(point.x, point.y, runtime.enemyDestroyedExplosionRadius ?? 0); }
        catch (error) { console.error('[ConstructionWorldRuntime] Collapse presentation failed', error); }
      }
      if (runtime.kind === 'rock' && (cause === 'damage' || cause === 'decay')) {
        emitArenaRockDestroyed(scene.game.events, { rockId: runtime.id, source: 'placeable_rock', reason: cause });
      }
      if ((cause === 'damage' || cause === 'decay') && runtime.kind === 'turret') {
        try { rockVisualHelper.spawnTurretDeathCloud(runtime); }
        catch (error) { console.error('[ConstructionWorldRuntime] Death presentation failed', error); }
      }
    },
    onDestroy: () => {
      playerGameplay.setTunnelPlacementCapability(null);
      if (gameplay.construction === constructionRuntime) gameplay.construction = null;
    },
    rockVisualHelper: {
      gridToWorld: (gridX, gridY) => rockVisualHelper.gridToWorld(gridX, gridY),
      materializePlaceableRock: (runtime, playDust) => rockVisualHelper.materializePlaceableRock(runtime, playDust),
      updatePlaceableRock: (runtime) => rockVisualHelper.updateRockVisualById(runtime.id, runtime.hp),
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
      getBuildRevision: (playerId) => constructionRuntime.getPersistentBaseBuildRevision(playerId),
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

/** Atomic World-object writers plus the narrow alias-deduplicating domain dispatcher. */
export function composeWorldObjectMutation(
  input: ArenaWorldGameplayCompositionInput,
  gameplay: ArenaWorldGameplay,
): void {
  const { ctx, worldRuntime, world, layout, arenaResult, placementSystem, baseManager, rockVisualHelper } = input;
  const combatSystem = gameplay.combatSystem;
  if (!combatSystem) throw new Error('[ArenaWorldComposition] Combat runtime is missing');
  const construction = gameplay.construction;
  const rockRegistry = worldRuntime.materialization?.rocks;
  if (!construction || !rockRegistry) {
    throw new Error('[ArenaWorldComposition] World mutation dependencies are missing');
  }
  const rockRuntime = new WorldRockRuntime({
    registry: rockRegistry,
    arena: arenaResult,
    layout,
    metrics: world.metrics,
    onIntegrityChanged: (id, integrity) => rockVisualHelper.updateRockVisualById(id, integrity),
    onBeforeDestroyedPresentation: (id) => rockVisualHelper.presentStaticRockDestruction(id),
    onDestroyed: ({ id, cause, attackerId }) => {
      if (cause === 'damage' || cause === 'decay') {
        emitArenaRockDestroyed(input.scene.game.events, { rockId: id, source: 'static_rock', reason: cause });
      }
      const dropsArmor = shouldDropRockArmor(
        isCoopDefenseMode(bridge.getActiveGameMode()),
        cause,
        gameplay.player?.getPlayerClassId(attackerId ?? ''),
      );
      if (dropsArmor) gameplay.powerUp?.system.onRockDestroyed(id);
      const cell = layout.rocks[id];
      emitArenaMapGridChanged(input.scene.game.events, {
        reason: 'static_rock_destroyed', source: 'static_rock', obstacleId: id,
        gridX: cell?.gridX, gridY: cell?.gridY,
      });
      try { rockVisualHelper.observeStaticRockRemoved(id); }
      catch (error) { console.error('[WorldRockRuntime] Removal presentation failed', error); }
    },
  });
  const runtime = new WorldObjectMutationRuntime({
    scope: combatSystem.getCombatScope(),
    metrics: world.metrics,
    rockRegistry,
    rockRuntime,
    placement: placementSystem,
    construction,
    bases: baseManager,
    train: gameplay.train,
    onDestroy: (destroyed) => { if (gameplay.worldMutation === destroyed) gameplay.worldMutation = null; },
  });
  gameplay.worldMutation = runtime;
  worldRuntime.bind(runtime);
}
