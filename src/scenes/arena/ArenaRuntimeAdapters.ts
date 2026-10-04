import type { PlayerManager } from '../../entities/PlayerManager';
import type { TrainShowcaseState } from '../../dev/scenario/trainShowcase';
import { TRAIN } from '../../train/TrainConfig';
import type { TrainDevPassOptions } from '../../train/TrainManager';
import { planTrainDestruction } from '../../effects/train/TrainVfxModel';
import { getCoopDefenseMapConfig, resolveCoopDefenseMapEncounterConfigs } from '../../config/coopDefenseMaps';
import type { NavigationLabWorldPort } from '../../debug/navigationLab/NavigationLabPort';
import type { EnemyIntent, MovementFeedback } from '../../systems/navigation/NavigationContracts';
import { bridge } from '../../network/bridge';
import { isDevScenarioMode } from '../../utils/devScenarioMode';
import { isLocalScenarioBotPeer } from '../../network/peer/LocalScenarioSession';
import type { UtilityConfig } from '../../loadout/LoadoutConfig';
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

/** Dev-only mutations resolve activity-owned managers afresh on every command. */
export function createDevScenarioWorldPort(flow: ArenaLifecycleCoordinator, players: PlayerManager) {
  const trainOwners = new WeakMap<object, number>();
  let nextTrainOwnerId = 1;
  // Scripted bot peers are the only allowed additional participants of the isolated host.
  const requireLocal = () => {
    if (!isDevScenarioMode() || !bridge.isHost() || bridge.getConnectedPlayers()
      .some(player => player.id !== bridge.getLocalPlayerId() && !isLocalScenarioBotPeer(player.id))) throw new Error('Isolated dev host required.');
  };
  return {
    findDestructibleRock(gridX: number, gridY: number) {
      requireLocal();
      const materialization=flow.getWorldRuntime()?.materialization, arena=materialization?.arena, registry=materialization?.rocks;
      if(!arena||!registry)return null;
      let best:{id:number;gridX:number;gridY:number;distance:number}|null=null;
      for(let y=Math.floor(gridY)-8;y<=Math.floor(gridY)+8;y++)for(let x=Math.floor(gridX)-8;x<=Math.floor(gridX)+8;x++) {
        const id=arena.rockGrid.getIndex(x,y);
        if(id<0||registry.isIndestructible(id)||!registry.readIntegrity(id)?.integrity)continue;
        const distance=(x-gridX)**2+(y-gridY)**2;
        if(!best||distance<best.distance)best={id,gridX:x,gridY:y,distance};
      }
      return best;
    },
    spawnPowerUp(defId: string, x: number, y: number): number | null {
      requireLocal();
      return flow.getWorldPowerUpRuntime()?.system.spawnPickup(defId, x, y) ?? null;
    },
    destroyRock(id:number): boolean {
      requireLocal();
      const hp=flow.getWorldRuntime()?.materialization?.rocks?.readIntegrity(id)?.integrity;
      if(!hp)return false;
      const outcome=flow.getWorldObjectMutationRuntime()?.applyResolvedDamage('rock',id,hp,bridge.getLocalPlayerId(),'dev-scenario.single-rock');
      return outcome?.kind==='damage-applied'&&outcome.transition.kind==='destroyed';
    },
    destroyRocksNear(gridX:number,gridY:number,radius:number):number[] {
      requireLocal();
      const world=flow.getWorldRuntime()?.materialization,arena=world?.arena,registry=world?.rocks;
      const mutation=flow.getWorldObjectMutationRuntime(),ids:number[]=[];
      if(!arena||!registry||!mutation)return ids;
      for(let y=Math.floor(gridY-radius);y<=Math.ceil(gridY+radius);y++)for(let x=Math.floor(gridX-radius);x<=Math.ceil(gridX+radius);x++){
        if((x-gridX)**2+(y-gridY)**2>radius*radius)continue;
        const id=arena.rockGrid.getIndex(x,y);if(id<0||registry.isIndestructible(id))continue;
        const hp=registry.readIntegrity(id)?.integrity;if(!hp)continue;
        const result=mutation.applyResolvedDamage('rock',id,hp,bridge.getLocalPlayerId(),'dev-scenario.rock-explosion');
        if(result?.kind==='damage-applied'&&result.transition.kind==='destroyed')ids.push(id);
      }
      return ids;
    },
    getPlayer(id: string): { x: number; y: number; alive: boolean; burrowed: boolean } | null {
      const player = players.getPlayer(id), combat = flow.getWorldCombatCore();
      return player ? { x: player.x, y: player.y, alive: combat?.isAlive(id) ?? false, burrowed: combat?.isBurrowed(id) ?? false } : null;
    },
    placePlayer(id: string, x: number, y: number): void {
      requireLocal();
      players.getPlayer(id)?.setPosition(x, y);
    },
    healPlayer(id: string): void {
      const combat = flow.getWorldCombatCore();
      if (combat?.isAlive(id)) combat.heal(id, combat.getMaxHp(id));
    },
    /** Grants a pickup-only utility (e.g. NUKE, BFG) through the normal temporary-utility owner. */
    addTemporaryUtility(id: string, config: UtilityConfig): string | null {
      requireLocal();
      return flow.getWorldPlayerGameplayRuntime()?.addTemporaryUtility(id, config, 1) ?? null;
    },
    /** Read the actual track, consist and host speed; the scenario never guesses map coordinates. */
    readTrain(): TrainShowcaseState | null {
      requireLocal();
      const train = flow.getWorldTrainRuntime()?.getCurrentTrain();
      const metrics = flow.getWorldRuntime()?.context.metrics;
      if (!train || !metrics) return null;
      const segments = train.getSegmentPositions(), heights = train.segHeights();
      const x = train.getTrackX();
      const blast = planTrainDestruction(segments, metrics.offsetY, metrics.maxY)[0];
      const handler = flow.getWorldTrainRuntime()?.getActivityTrainHandler();
      if (handler && !trainOwners.has(handler)) trainOwners.set(handler, nextTrainOwnerId++);
      return { state: train.getNetSnapshot(), speed: train.getCurrentSpeed(),
        ...(handler ? { devPass: { ownerId: trainOwners.get(handler)!, ...handler.getDevPassStatus() } } : {}),
        bounds: { left: x - TRAIN.VISUAL_WIDTH / 2, right: x + TRAIN.VISUAL_WIDTH / 2,
          top: Math.min(...segments.map((p, i) => p.y - heights[i] / 2)),
          bottom: Math.max(...segments.map((p, i) => p.y + heights[i] / 2)) },
        trackBounds: { left: x - TRAIN.VISUAL_WIDTH / 2, right: x + TRAIN.VISUAL_WIDTH / 2,
          top: metrics.offsetY, bottom: metrics.maxY },
        explosionCenter: blast ? { x: blast.x, y: blast.y } : null };
    },
    /** Runs one train pass now, independent of authored map events and suppressed encounters. */
    startTrain(reason = 'train', options?: TrainDevPassOptions): boolean {
      requireLocal();
      const handler = flow.getWorldTrainRuntime()?.getActivityTrainHandler();
      if (!handler) return false;
      handler.startDevPass(reason, options);
      return true;
    },
    /** Reproduce the normal authoritative destruction, including drops and replicated VFX. */
    destroyTrain(): boolean {
      requireLocal();
      const runtime = flow.getWorldTrainRuntime();
      const train = runtime?.getCurrentTrain();
      if (!runtime || !train?.isAlive()) return false;
      runtime.applyDamage(train.readIntegrity().integrity, '__train__');
      return train.isDestroyed();
    },
    /** Explicit dev passes use scenario delta, regardless of encounter/mission clock suppression. */
    updateTrain(deltaMs: number, invulnerable = false): void {
      if (invulnerable) flow.getWorldTrainRuntime()?.getCurrentTrain()?.restoreIntegrity();
      flow.getWorldTrainRuntime()?.getActivityTrainHandler()?.updateDevPass(deltaMs);
      if (invulnerable) flow.getWorldTrainRuntime()?.getCurrentTrain()?.restoreIntegrity();
    },
    setOptions(freezeMission: boolean, hideTutorial: boolean): void {
      requireLocal();
      const now = Math.max(bridge.getSynchronizedNow(), bridge.getArenaStartTime());
      flow.getCoopMissionRuntime()?.setScenarioOptions(freezeMission && bridge.isArenaStarted(), hideTutorial, now);
    },
    readMission() {
      const runtime = flow.getCoopMissionRuntime();
      return { frozen: runtime?.scenarioMissionFrozen ?? false,
        elapsedMs: Math.max(0, (runtime?.getMissionNow(bridge.getSynchronizedNow()) ?? bridge.getSynchronizedNow()) - bridge.getArenaStartTime()),
        respawnBudget: bridge.getLocalCoopDefenseRespawnBudgetState(),
        progress: bridge.getCoopDefenseMissionProgressPresentationState() };
    },
    suppressEncounters(value: boolean): void {
      requireLocal();
      const runtime = flow.getCoopMissionRuntime();
      if (runtime) runtime.analysisScenarioActive = value;
    },
    setEnemyHp(id: string, hp: number): void {
      requireLocal();
      flow.getCoopMissionRuntime()?.enemyManager?.hostSetVitalsBaseline(id, hp, hp);
    },
  };
}

/** Scenario commands use the current lifecycle owner, never retained managers from an old round. */
export function createNavigationLabWorldPort(
  flow: ArenaLifecycleCoordinator, players: PlayerManager,
): NavigationLabWorldPort {
  const geometry = () => flow.getWorldGeometryBinding()?.getQueries();
  const spawnCases = () => resolveCoopDefenseMapEncounterConfigs(getCoopDefenseMapConfig(bridge.getCoopDefenseMapId()), 1)
    .flatMap(encounter => encounter.groups.map((group, i) => ({ id: `${encounter.id}/${i}`, group })));
  const freePositions = (radius: number): { x: number; y: number }[] => {
    const queries = geometry();
    if (!queries) return [];
    const metrics = queries.metrics;
    const result: { x: number; y: number }[] = [];
    for (let row = 1; row < metrics.gridRows - 1; row++) {
      for (let col = 1; col < metrics.gridCols - 1; col++) {
        const x = metrics.offsetX + col * 32 + 16, y = metrics.offsetY + row * 32 + 16;
        if (!queries.isCircleBlocked(x, y, radius)) result.push({ x, y });
      }
    }
    return result;
  };
  return {
    getAuthoredSpawnCases: () => {
      const metrics = flow.getWorldRuntime()?.context.metrics;
      if (!metrics) return [];
      return spawnCases().map(({ id, group }) => ({ id, kind: group.enemyKind,
        target: { x: metrics.offsetX + (group.spawnArea ? group.spawnArea.gridX + group.spawnArea.widthCells / 2 : 2) * 32,
          y: metrics.offsetY + (group.spawnArea ? group.spawnArea.gridY + group.spawnArea.heightCells / 2 : metrics.gridRows / 2) * 32 } }));
    },
    spawnAuthoredCase: id => {
      const runtime = flow.getCoopMissionRuntime();
      if (!runtime?.analysisScenarioActive || !bridge.isHost()) return [];
      const entry = spawnCases().find(entry => entry.id === id);
      return entry ? runtime.coopDefenseSpawnExecutor?.hostSpawnEncounterGroup(entry.group.enemyKind, 1,
        'navigation-spawn-audit', entry.group.front, entry.group.spawnArea).enemyIds ?? [] : [];
    },
    setNextRoundSeed: seed => flow.setNextScenarioSeed(seed),
    isReady: () => flow.getCoopMissionRuntime()?.enemyManager != null
      && bridge.getGamePhase() === 'ARENA' && !bridge.isArenaCountdownActive()
      && bridge.getArenaStartTime() > 0,
    setScenarioActive: active => {
      const runtime = flow.getCoopMissionRuntime();
      if (runtime) {
        if (active && !runtime.analysisScenarioActive) {
          // A fixed, damageable reference target survives simultaneous volleys. This is a lab fixture.
          flow.getWorldCombatCore()?.setPlayerMaxHpResolver(() => 1_000_000);
          flow.getWorldCombatCore()?.heal(bridge.getLocalPlayerId(), 1_000_000);
        }
        runtime.analysisScenarioActive = active;
      }
    },
    getMetrics: () => flow.getWorldRuntime()?.context.metrics ?? null,
    getFreePositions: freePositions,
    getGeometry: () => flow.getWorldGeometryBinding()?.snapshotMovementGeometry() ?? null,
    getGeometryFingerprint: () => {
      let hash = 2166136261;
      const serialized = JSON.stringify(flow.getWorldGeometryBinding()?.snapshotMovementGeometry() ?? null);
      for (let i = 0; i < serialized.length; i++) hash = Math.imul(hash ^ serialized.charCodeAt(i), 16777619);
      return (hash >>> 0).toString(16);
    },
    getNavigationMetrics: (): Record<string, number> => {
      const d = flow.getCoopMissionRuntime()?.flowFieldCoordinator?.getDiagnostics();
      if (!d) return {};
      const manager = flow.getCoopMissionRuntime()?.enemyManager as unknown as { getNavigationWorkCounters?: () => Record<string, number> } | undefined;
      return { ...manager?.getNavigationWorkCounters?.(), ...flow.getWorldGeometryBinding()?.getObstacleWorkCounters(), fields: Object.keys(d.fields).length, dispatchedJobs: d.dispatchedJobs, completedJobs: d.completedJobs,
        droppedStale: d.droppedStale, workerComputeTotalMs: d.workerComputeTotalMs, workerComputeMaxMs: d.workerComputeMaxMs,
        roundTripMaxMs: d.roundTripMaxMs, backlogTicks: d.backlogTicks,
        maxPendingAgeMs: Math.max(0, ...Object.values(d.fields).map(f => f.recomputePendingAgeMs ?? 0)) };
    },
    observeCombatantDamage: observer => flow.getWorldCombatCore()?.addDamageDealtObserver(observer) ?? (() => {}),
    setDensityEnabled: enabled => {
      const runtime = flow.getCoopMissionRuntime() as unknown as { enemyIntents?: { setDensityEnabled(value: boolean): void } } | null;
      runtime?.enemyIntents?.setDensityEnabled(enabled);
    },
    destroyScenarioRock: id => {
      if (!flow.getCoopMissionRuntime()?.analysisScenarioActive || !bridge.isHost()) return false;
      const outcome = flow.getWorldObjectMutationRuntime()?.applyResolvedDamage(
        'rock', id, 1_000_000, bridge.getLocalPlayerId(), 'navigation-lab.geometry-change');
      return outcome?.kind === 'damage-applied';
    },
    spawnEnemy: (x, y, kind, allied) => {
      const manager = flow.getCoopMissionRuntime()?.enemyManager;
      if (!manager) return null;
      const enemy = allied
        ? manager.hostSpawnAllyAtWorld(x, y, kind, bridge.getLocalPlayerId(), 0x79cb72, 1)
        : manager.hostSpawnAtWorld(x, y, kind, { originId: 'navigation-lab' });
      return enemy.id;
    },
    removeEnemies: () => {
      const manager = flow.getCoopMissionRuntime()?.enemyManager;
      for (const enemy of manager?.getAllEnemies() ?? []) manager?.hostRemoveEnemy(enemy.id);
    },
    readEnemies: () => {
      const runtime = flow.getCoopMissionRuntime(), now = bridge.getSynchronizedNow();
      // Optional observation keeps exactly the same lab adapter usable in the frozen baseline.
      const navigation = runtime?.enemyManager as unknown as {
        getNavigationIntent?: (id: string) => EnemyIntent | null;
        getMovementFeedback?: (id: string) => MovementFeedback | null;
      } | undefined;
      return (runtime?.enemyManager?.getAllEnemies() ?? []).map(enemy => {
        const velocity = enemy.getDesiredVelocity();
        const target = runtime?.coopDefenseEnemyAttackSystem?.getCurrentTarget(enemy.id, now);
        return { id: enemy.id, kind: enemy.kind, faction: enemy.faction,
          x: enemy.sprite.x, y: enemy.sprite.y, radius: enemy.getCollisionRadius(),
          vx: velocity.vx, vy: velocity.vy, moving: enemy.wantsToMove(),
          blocked: enemy.isPathBlocked(), attacking: enemy.isAttackMovementPaused(now),
          hp: enemy.getHp(), target: target ? `${target.kind}:${target.id}` : null,
          bodyFree: !geometry()?.isCircleBlocked(enemy.sprite.x, enemy.sprite.y, enemy.getCollisionRadius()),
          special: enemy.isBurrowed() || enemy.getDashPhase() > 0,
          intent: navigation?.getNavigationIntent?.(enemy.id), movement: navigation?.getMovementFeedback?.(enemy.id) };
      });
    },
    getPlayerPosition: () => {
      const player = players.getPlayer(bridge.getLocalPlayerId());
      return player ? { x: player.x, y: player.y,
        alive: flow.getWorldCombatCore()?.isAlive(player.id) ?? false } : null;
    },
    placePlayer: (x, y) => {
      const id = bridge.getLocalPlayerId();
      players.getPlayer(id)?.setPosition(x, y);
      const combat = flow.getWorldCombatCore();
      combat?.heal(id, combat.getMaxHp(id));
    },
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
  getAdrenalineEssence: ArenaRuntimeDiagnosticsPort['getAdrenalineEssence'] = () => null,
): ArenaRuntimeDiagnosticsPort {
  return {
    getChunkRenderingDiagnosticsState,
    getAdrenalineEssence,
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
  syncConstructionOwnership: ArenaRuntimePresentationPort['syncConstructionOwnership'],
  syncGroundFog: ArenaRuntimePresentationPort['syncGroundFog'] = () => {},
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
    syncConstructionOwnership,
    syncGroundFog,
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
      editLayout: (playerId, edit) => persistentBase.editPersonalLayout(playerId, edit),
      placeReward: (playerId, request) => persistentBase.placePersistentBaseReward(playerId, request),
      moveObject: (playerId, request, hostNowMs) => persistentBase.movePersistentBaseObject(playerId, request, hostNowMs),
    },
    playerLoadout: {
      handleDashRequest: (playerId, dx, dy, hostNowMs) => {
        flow.getWorldPlayerGameplayRuntime()?.handleDashRequest(playerId, dx, dy, hostNowMs);
      },
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
      startUtilityHeldAction: (playerId, actionId, kind, hostNowMs, toolRef, temporaryUtilityInstanceId) => (
        flow.getWorldPlayerGameplayRuntime()?.startUtilityHeldAction(
          playerId,
          actionId,
          kind,
          hostNowMs,
          toolRef,
          temporaryUtilityInstanceId,
        ) ?? false
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
        flow.getConstructionWorldRuntime()?.getEffectiveDefinition(definition.id, bridge.getLocalPlayerId()) ?? definition,
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
    getProjectileDiagnostics: () => flow.getWorldProjectileRuntime(),
    getEssenceAccounting: () => {
      const activity = flow.getAdrenalineEssence();
      const diagnostics = activity?.runtime?.getDiagnostics();
      return activity && diagnostics && activity.scope.activityRevision !== null ? {
        worldRevision: activity.scope.worldRevision,
        activityRevision: activity.scope.activityRevision,
        authoredValue: diagnostics.authoredValue, materializedValue: diagnostics.materializedValue,
        committedValue: diagnostics.committedValue, expiredValue: diagnostics.expiredValue,
        placementFailedValue: diagnostics.placementFailedValue,
        lifecycleDiscardedValue: diagnostics.lifecycleDiscardedValue,
      } : null;
    },
    isReady: () => {
      const playerGameplay = flow.getWorldPlayerGameplayRuntime();
      const enemyManager = flow.getCoopMissionRuntime()?.enemyManager;
      return playerGameplay != null && enemyManager != null;
    },
    spawnTarget: (x, y, hp = 1_000_000_000) => {
      const enemyManager = flow.getCoopMissionRuntime()?.enemyManager;
      if (!enemyManager) return null;
      const enemy = enemyManager.hostSpawnAtWorld(x, y, 'zombie-badger', {
        originId: 'weapon-balance-lab',
      });
      enemyManager.hostSetVitalsBaseline(enemy.id, hp, hp);
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
    useWeaponAction: (slot, playerId, angle, targetX, targetY, now, shotSequence, inputStarted) => {
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
        scopeTrigger: 'tap',
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
    getEnemyVisual: (enemyId) => flow.getWorldEnemyManager()?.getEnemy(enemyId) ?? null,
  };
}
