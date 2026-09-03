import type { PlayerManager } from '../../entities/PlayerManager';
import type { EnemyFlowFieldService } from '../../systems/EnemyFlowFieldService';
import type { WeaponBalanceLabWorldPort } from '../../debug/coopDefenseBalance/WeaponBalanceLabRuntime';
import type { ArenaInputPersistentBasePorts, ArenaInputPlacementPorts } from './ArenaInputBindings';
import type { ArenaLifecycleCoordinator } from './ArenaLifecycleCoordinator';
import type { ArenaPersistentBaseSession } from './ArenaPersistentBaseSession';
import type {
  EnemyFlowFieldDebugPort,
  ArenaRuntimeDiagnosticsPort,
  ArenaRuntimePresentationPort,
  ArenaRuntimeRpcPorts,
  ArenaRuntimeStrategicTargetsPort,
} from './ArenaRuntimePorts';

export function createArenaFlowFieldDebugPort(service: EnemyFlowFieldService): EnemyFlowFieldDebugPort {
  return {
    getCellSize: () => service.getCellSize(),
    getCols: () => service.getCols(),
    getRows: () => service.getRows(),
    getVectorAt: (gridX, gridY) => service.getVectorAt(gridX, gridY),
    getIntegrationValueAt: (gridX, gridY) => service.getIntegrationValueAt(gridX, gridY),
    isTraversableAt: (gridX, gridY) => service.isTraversableAt(gridX, gridY),
    gridToWorld: (gridX, gridY) => service.gridToWorld(gridX, gridY),
    getGoalCells: () => service.getGoalCells(),
    setRefreshListener: (listener) => service.registerDebugOverlayCallback(
      listener ? () => listener() : null,
    ),
  };
}

export function createArenaRuntimeDiagnosticsPort(
  getChunkRenderingDiagnosticsState: ArenaRuntimeDiagnosticsPort['getChunkRenderingDiagnosticsState'],
  setGroundSurfaceVisible: ArenaRuntimeDiagnosticsPort['setGroundSurfaceVisible'],
  setRockOverlayVisible: ArenaRuntimeDiagnosticsPort['setRockOverlayVisible'],
  setChunkSampling: ArenaRuntimeDiagnosticsPort['setChunkSampling'],
  setRockRenderer: ArenaRuntimeDiagnosticsPort['setRockRenderer'],
  setRockGpuPageSize: ArenaRuntimeDiagnosticsPort['setRockGpuPageSize'],
  getFlowFieldDebugPort: ArenaRuntimeDiagnosticsPort['getFlowFieldDebugPort'],
  getFlowFieldDiagnosticsPort: ArenaRuntimeDiagnosticsPort['getFlowFieldDiagnosticsPort'],
  getRockVisualDiagnostics: ArenaRuntimeDiagnosticsPort['getRockVisualDiagnostics'],
): ArenaRuntimeDiagnosticsPort {
  return {
    getChunkRenderingDiagnosticsState,
    setGroundSurfaceVisible,
    setRockOverlayVisible,
    setChunkSampling,
    setRockRenderer,
    setRockGpuPageSize,
    getFlowFieldDebugPort,
    getFlowFieldDiagnosticsPort,
    getRockVisualDiagnostics,
  };
}

export function createArenaRuntimePresentationPort(
  syncWorldCamera: ArenaRuntimePresentationPort['syncWorldCamera'],
  syncWorldSurfaceResidency: ArenaRuntimePresentationPort['syncWorldSurfaceResidency'],
  syncWorldClientPresentation: ArenaRuntimePresentationPort['syncWorldClientPresentation'],
  syncWorldCanopy: ArenaRuntimePresentationPort['syncWorldCanopy'],
  syncCoopMissionPresentation: ArenaRuntimePresentationPort['syncCoopMissionPresentation'],
  syncWorldLocalPlayerPresentation: ArenaRuntimePresentationPort['syncWorldLocalPlayerPresentation'],
  syncWorldPersistentBasePresentation: ArenaRuntimePresentationPort['syncWorldPersistentBasePresentation'],
  requestWorldStaticShadowBake: ArenaRuntimePresentationPort['requestWorldStaticShadowBake'],
  syncWorldStaticShadowProfile: ArenaRuntimePresentationPort['syncWorldStaticShadowProfile'],
  syncWorldShadows: ArenaRuntimePresentationPort['syncWorldShadows'],
  syncWorldLighting: ArenaRuntimePresentationPort['syncWorldLighting'],
): ArenaRuntimePresentationPort {
  return {
    syncWorldCamera,
    syncWorldSurfaceResidency,
    syncWorldClientPresentation,
    syncWorldCanopy,
    syncCoopMissionPresentation,
    syncWorldLocalPlayerPresentation,
    syncWorldPersistentBasePresentation,
    requestWorldStaticShadowBake,
    syncWorldStaticShadowProfile,
    syncWorldShadows,
    syncWorldLighting,
  };
}

export function createArenaRuntimeRpcPorts(
  flow: ArenaLifecycleCoordinator,
  persistentBase: ArenaPersistentBaseSession,
): ArenaRuntimeRpcPorts {
  return {
    worldParticipation: {
      handleRequest: (playerId, join) => flow.hostHandleWorldParticipationRequest(playerId, join),
    },
    playerCapabilities: {
      get: (playerId) => flow.getPlayerCapabilities(playerId),
    },
    construction: {
      placeInspectorConstruction: (playerId, constructionId, targetX, targetY, hostNowMs, activityRevision) => (
        flow.getConstructionWorldRuntime()?.placeInspectorConstruction(
          playerId,
          constructionId,
          targetX,
          targetY,
          hostNowMs,
          activityRevision,
        ) ?? { ok: false, reason: 'blocked' }
      ),
      useInspectorUtility: (playerId, tool, angle, targetX, targetY, now, params) => (
        flow.getConstructionWorldRuntime()?.useInspectorUtility(
          playerId,
          tool,
          angle,
          targetX,
          targetY,
          now,
          params,
        ) ?? { ok: false, reason: 'blocked' }
      ),
      dismantleConstruction: (playerId, targetX, targetY, hostNowMs, activityRevision) => (
        flow.getConstructionWorldRuntime()?.dismantleConstruction(
          playerId,
          targetX,
          targetY,
          hostNowMs,
          activityRevision,
        ) ?? { ok: false, reason: 'blocked' }
      ),
      dismantleAllOwnedConstructions: (playerId, activityRevision) => (
        flow.getConstructionWorldRuntime()?.dismantleAllOwnedConstructions(
          playerId,
          activityRevision,
        ) ?? { ok: false, reason: 'blocked' }
      ),
    },
    persistentBase: {
      placeReward: (playerId, request) => persistentBase.placePersistentBaseReward(playerId, request),
      moveObject: (playerId, request, hostNowMs) => persistentBase.movePersistentBaseObject(playerId, request, hostNowMs),
    },
    playerLoadout: {
      handleBurrowRequest: (playerId, wantsBurrowed) => {
        flow.getWorldPlayerGameplayRuntime()?.handleBurrowRequest(playerId, wantsBurrowed);
      },
      isBurrowed: (playerId) => flow.getWorldPlayerGameplayRuntime()?.isBurrowed(playerId) ?? false,
      isStunned: (playerId) => flow.getWorldPlayerGameplayRuntime()?.isStunned(playerId) ?? false,
      getTemporaryUtilityConfig: (playerId, instanceId) => flow.getWorldPlayerGameplayRuntime()?.getTemporaryUtilityConfig(playerId, instanceId) ?? null,
      getEquippedUtilityConfig: (playerId) => flow.getWorldPlayerGameplayRuntime()?.getEquippedUtilityConfig(playerId),
      hasActiveTranslocatorPuck: (playerId) => flow.getWorldPlayerGameplayRuntime()?.hasActiveTranslocatorPuck(playerId) ?? false,
      usePlayerAction: (request) => (
        flow.getWorldPlayerGameplayRuntime()?.usePlayerAction(request) ?? { ok: false, reason: 'blocked' }
      ),
      useLoadout: (slot, playerId, angle, targetX, targetY, now, shotId, params, clientX, clientY) => (
        slot === 'weapon1' || slot === 'weapon2'
          ? flow.getWorldPlayerGameplayRuntime()?.usePlayerAction({
            category: 'weapon',
            playerId,
            slot,
            angle,
            targetX,
            targetY,
            hostNowMs: now,
            shotId,
            params,
            clientPosition: { x: clientX, y: clientY },
          }) ?? { ok: false, reason: 'blocked' }
          : flow.getWorldPlayerGameplayRuntime()?.useLegacyLoadoutAction(
            slot,
            playerId,
            angle,
            targetX,
            targetY,
            now,
            shotId,
            params,
            clientX,
            clientY,
          ) ?? { ok: false, reason: 'blocked' }
      ),
      getAdrenaline: (playerId) => flow.getWorldPlayerGameplayRuntime()?.getAdrenaline(playerId) ?? 0,
      getAdrenalineRevision: (playerId) => flow.getWorldPlayerGameplayRuntime()?.getAdrenalineRevision(playerId) ?? 0,
      tryPickupPowerUp: (playerId, uid, playerX, playerY) => flow.getWorldPowerUpRuntime()?.system?.tryPickup(playerId, uid, playerX, playerY) ?? false,
    },
    heldAction: {
      start: (playerId, actionId, kind, expectedDurationMs, hostNowMs, identity) => (
        flow.getWorldPlayerGameplayRuntime()?.startHeldAction(
          playerId,
          actionId,
          kind,
          expectedDurationMs,
          hostNowMs,
          identity,
        ) ?? false
      ),
      cancel: (playerId, actionId) => {
        flow.getWorldPlayerGameplayRuntime()?.cancelHeldAction(playerId, actionId);
      },
      consume: (playerId, actionId, kind, fullChargeDurationMs, hostNowMs, expectedIdentity) => (
        flow.getWorldPlayerGameplayRuntime()?.consumeHeldAction(
          playerId,
          actionId,
          kind,
          fullChargeDurationMs,
          hostNowMs,
          expectedIdentity,
        ) ?? null
      ),
      clearPlayer: (playerId) => {
        flow.getWorldPlayerGameplayRuntime()?.clearHeldActionsForPlayer(playerId);
      },
    },
    train: {
      markDestroyed: () => flow.onTrainDestroyed(),
    },
  };
}

export function createArenaPlacementPorts(flow: ArenaLifecycleCoordinator): ArenaInputPlacementPorts {
  return {
    getUsedCapacity: (ownerId) => flow.getWorldRuntime()?.materialization?.placement?.getUsedCapacity(ownerId) ?? 0,
    getDismantlePreview: (ownerId, originX, originY, pointerX, pointerY, range) => (
      flow.getWorldRuntime()?.materialization?.placement?.getDismantlePreview(
        ownerId,
        originX,
        originY,
        pointerX,
        pointerY,
        range,
      )
    ),
    getPlacementPreview: (config, originX, originY, pointerX, pointerY) => (
      flow.getWorldRuntime()?.materialization?.placement?.getPlacementPreview(
        config,
        originX,
        originY,
        pointerX,
        pointerY,
      )
    ),
    getTunnelPlacementPreview: (config, originX, originY, pointerX, pointerY, anchor) => (
      flow.getWorldRuntime()?.materialization?.placement?.getTunnelPlacementPreview(
        config,
        originX,
        originY,
        pointerX,
        pointerY,
        anchor,
      )
    ),
    getConstructionPlacementPreview: (definition, originX, originY, pointerX, pointerY) => (
      flow.getWorldRuntime()?.materialization?.placement?.getConstructionPlacementPreview(
        definition,
        originX,
        originY,
        pointerX,
        pointerY,
      )
    ),
  };
}

export function createArenaPersistentBasePort(
  persistentBase: ArenaPersistentBaseSession,
): ArenaInputPersistentBasePorts {
  return {
    getRewardIdsForPlayer: (playerId) => persistentBase.getPersistentBaseRewardIdsForPlayer(playerId),
    getRewardPlacementPreview: (playerId, rewardId, pointerX, pointerY) => persistentBase.getPersistentBaseRewardPlacementPreview(
      playerId,
      rewardId,
      pointerX,
      pointerY,
    ),
    requestRewardPlacement: (rewardId, preview) => persistentBase.requestPersistentBaseRewardPlacement(rewardId, preview),
    getMoveSourcePreview: (playerId, pointerX, pointerY) => persistentBase.getPersistentBaseMoveSourcePreview(
      playerId,
      pointerX,
      pointerY,
    ),
    getMoveTargetPreview: (playerId, sourceRuntimeId, pointerX, pointerY) => persistentBase.getPersistentBaseMoveTargetPreview(
      playerId,
      sourceRuntimeId,
      pointerX,
      pointerY,
    ),
    requestMove: (sourceRuntimeId, preview) => persistentBase.requestPersistentBaseMove(sourceRuntimeId, preview),
  };
}

export function createWeaponBalanceLabWorldPort(
  flow: ArenaLifecycleCoordinator,
  playerManager: PlayerManager,
): WeaponBalanceLabWorldPort {
  return {
    isReady: () => {
      const playerGameplay = flow.getWorldPlayerGameplayRuntime();
      const enemyManager = flow.getCoopMissionRuntime()?.enemyManager;
      return playerGameplay != null && enemyManager != null;
    },
    spawnTarget: (x, y) => {
      const enemyManager = flow.getCoopMissionRuntime()?.enemyManager;
      if (!enemyManager) return null;
      const enemy = enemyManager.hostSpawnAtWorld(x, y, 'zombie-badger', {
        originId: 'weapon-balance-lab',
      });
      enemy.setHp(1_000_000_000, 1_000_000_000);
      enemy.setPosition(x, y);
      enemy.body.setVelocity(0, 0);
      return { id: enemy.id };
    },
    pinTarget: (id, x, y) => {
      const enemy = flow.getCoopMissionRuntime()?.enemyManager?.getEnemy(id);
      if (!enemy) return;
      enemy.setPosition(x, y);
      enemy.body.setVelocity(0, 0);
    },
    observeAdrenalineDrain: (listener) => (
      flow.getWorldPlayerGameplayRuntime()?.addAdrenalineDrainObserver((observedPlayerId, _requested, drained) => {
        listener(observedPlayerId, drained);
      }) ?? null
    ),
    observeAdrenalineGain: (listener) => (
      flow.getWorldPlayerGameplayRuntime()?.addAdrenalineGainObserver((observedPlayerId, _requested, gained) => {
        listener(observedPlayerId, gained);
      }) ?? null
    ),
    setAdrenaline: (playerId, amount) => {
      flow.getWorldPlayerGameplayRuntime()?.setAdrenaline(playerId, amount);
    },
    getMaxAdrenaline: (playerId) => (
      flow.getWorldPlayerGameplayRuntime()?.getMaxAdrenaline(playerId) ?? 0
    ),
    useLoadout: (slot, playerId, angle, targetX, targetY, now, shotSequence, inputStarted) => {
      const playerRuntime = flow.getWorldPlayerGameplayRuntime();
      if (!playerRuntime) return null;
      const player = playerManager.getPlayer(playerId);
      return playerRuntime.usePlayerAction({
        category: 'weapon',
        playerId,
        slot,
        angle,
        targetX,
        targetY,
        hostNowMs: now,
        shotId: shotSequence,
        params: { inputStarted },
        clientPosition: { x: player?.x, y: player?.y },
      });
    },
  };
}

export function createArenaStrategicTargetsPort(
  flow: ArenaLifecycleCoordinator,
): ArenaRuntimeStrategicTargetsPort {
  return {
    getHostSnapshot: (now) => (
      flow.getWorldPlayerGameplayRuntime()?.getAk47StrategicTargetNetSnapshot(now) ?? []
    ),
    getEnemyVisual: (enemyId) => flow.getCoopMissionRuntime()?.enemyManager?.getEnemy(enemyId) ?? null,
  };
}
