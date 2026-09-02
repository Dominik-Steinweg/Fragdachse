import type Phaser from 'phaser';
import type { ArenaContext } from './ArenaContext';
import type { RendererBundle } from './RendererBundle';
import type { RockVisualHelper } from './RockVisualHelper';
import type { PlacementPreviewRenderer } from './PlacementPreviewRenderer';
import type { PersistentBasePreviewRenderer } from './PersistentBasePreviewRenderer';
import type { HostUpdateCoordinator } from './HostUpdateCoordinator';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { LobbyOverlay } from '../LobbyOverlay';
import type { RoomQualityMonitor } from '../../network/RoomQualityMonitor';
import type { CoopMissionOutcome } from '../../activity/CoopMissionRuntime';
import type { CoopMissionPresentationInfrastructure } from './CoopMissionPresentationInfrastructure';
import type { ArenaInputPlacementPorts, ArenaInputDebugHotkey, ArenaSpectatorCameraInput } from './ArenaInputBindings';
import type {
  ConstructionRpcPort,
  HeldActionRpcPort,
  PersistentBaseRpcPort,
  PlayerCapabilitiesRpcPort,
  PlayerLoadoutRpcPort,
  TrainRpcPort,
  WorldParticipationRpcPort,
} from './ArenaRpcPorts';
import type { WeaponBalanceLabWorldPort } from '../../debug/coopDefenseBalance/WeaponBalanceLabRuntime';
import type { WorldPresentationRequirement } from '../../world/WorldPresentation';
import type { PlayerCapabilities } from '../../world/PlayerCapabilities';
import type { WorldMetrics } from '../../world/WorldMetrics';
import type { WorldDescriptor } from '../../world/WorldDescriptor';
import type {
  ArenaLayout,
  GameMode,
  SyncedAk47StrategicTarget,
  SyncedReinforcementMatrix,
  SyncedEnergyInjectorEffect,
  SyncedRemoteControlTurret,
  SyncedTunnel,
} from '../../types';
import type { GameState } from '../../network/NetworkBridge';
import type { WorldViewRect } from '../../ui/HostileBaseIndicator';
import type { EnemyEntity } from '../../entities/EnemyEntity';
import type { EnemyFlowFieldService } from '../../systems/EnemyFlowFieldService';
import type { ArenaDiagnosticsRockVisualSystemPort } from './ArenaDiagnosticsController';
import type { ChunkRenderingDiagnosticsState } from '../../ui/PerformanceDiagnosticsOverlay';
import type { ChunkSamplingMode } from '../../arena/chunks/ChunkedRenderSurface';
import {
  getRockGpuPageSize,
  getRockRendererMode,
  type RockGpuPageSize,
  type RockRendererMode,
} from '../../arena/rocks/RockRendererSettings';
import { bridge } from '../../network/bridge';
import { isCoopDefenseMode } from '../../gameModes';
import {
  resetWorldCameraBase,
  type WorldClientPresentationState,
  type WorldPresentationPersistentBaseVisuals,
} from '../../world/WorldPresentationFrameBinding';
import type {
  SyncedBurningGroundSnapshot,
  SyncedPowerUpPedestal,
} from '../../types';
import { ArenaLifecycleCoordinator } from './ArenaLifecycleCoordinator';
import { ArenaPersistentBaseSession } from './ArenaPersistentBaseSession';

export type RuntimeDiagnosticEventSink = (type: string, fields?: Record<string, unknown>) => void;

export interface ArenaRuntimeRpcPorts {
  readonly worldParticipation: WorldParticipationRpcPort;
  readonly playerCapabilities: PlayerCapabilitiesRpcPort;
  readonly construction: ConstructionRpcPort;
  readonly persistentBase: PersistentBaseRpcPort;
  readonly playerLoadout: PlayerLoadoutRpcPort;
  readonly heldAction: HeldActionRpcPort;
  readonly train: TrainRpcPort;
}

/**
 * Scene-langlebiger Top-Level-Owner des Arena-Layers.
 *
 * Er besitzt die wenigen wirklich uebergeordneten Owner - den Arena-Flow und den raumlanglebigen
 * Persistent-Base-Owner - und die Frame-Orchestrierung der Arena. Er ist ausdruecklich **kein**
 * Dependency-Container: Er wird nicht an Systeme weitergereicht, haelt keinen Gameplay-State und
 * kennt von einer laufenden Activity nur deren benannte Frame-Schritte.
 *
 * Die fachliche Reihenfolge innerhalb eines Schrittes gehoert weiterhin ihrem Owner: Der Host-
 * Frame fuehrt seine Phasen selbst aus, und welche Systeme in `hostSimulationStep` laufen, weiss
 * allein die `CoopMissionRuntime`.
 */
export interface ArenaRuntimeInput {
  readonly scene: Phaser.Scene;
  readonly ctx: ArenaContext;
  readonly renderers: RendererBundle;
  readonly rockVisualHelper: RockVisualHelper;
  readonly placementPreview: PlacementPreviewRenderer;
  readonly persistentBasePreviewRenderer: PersistentBasePreviewRenderer;
  readonly persistentBaseVisuals: WorldPresentationPersistentBaseVisuals;
  readonly lobbyOverlay: LobbyOverlay;
  readonly hostUpdate: HostUpdateCoordinator;
  readonly clientUpdate: ClientUpdateCoordinator;
  readonly roomQualityMonitor: RoomQualityMonitor;
  readonly coopMissionPresentation?: CoopMissionPresentationInfrastructure;
  readonly getLocalPlayerId?: () => string;
  readonly getSynchronizedNow?: () => number;
  /**
   * A/D- bzw. Pfeiltasten-Eingabe der freien Zuschauerkamera. Lazy, weil die Input-Bindings der
   * Scene erst nach der `ArenaRuntime` entstehen – wie bei `rockVisualHelper`s World-Ports.
   */
  readonly getSpectatorCameraInput: () => ArenaSpectatorCameraInput | undefined;
}

export class ArenaRuntime {
  /** Raumlanglebiger Persistent-Base-Owner; er ueberlebt jede World und jede Runde. */
  readonly persistentBase: ArenaPersistentBaseSession;
  /** Gebuendelte RPC-Ports fuer den RpcCoordinator; entkoppelt von konkreten Runtime-Interna. */
  readonly rpcPorts: ArenaRuntimeRpcPorts;
  /** Schmale Platzierungsports fuer die Scene-Eingabe. */
  readonly placementPorts: ArenaInputPlacementPorts;
  /** Schmaler Port fuer das Weapon-Balance-Lab. */
  readonly weaponBalanceLabPort: WeaponBalanceLabWorldPort;

  /** Der Arena-Flow bleibt private Implementierungsdetail der ArenaRuntime. */
  private readonly flow: ArenaLifecycleCoordinator;
  private readonly scene: Phaser.Scene;
  private readonly ctx: ArenaContext;
  private readonly renderers: RendererBundle;
  private readonly hostUpdate: HostUpdateCoordinator;
  private readonly clientUpdate: ClientUpdateCoordinator;
  private readonly getLocalPlayerId: () => string;
  private readonly getSynchronizedNow: () => number;

  constructor(input: ArenaRuntimeInput) {
    this.scene = input.scene;
    this.ctx = input.ctx;
    this.renderers = input.renderers;
    this.hostUpdate = input.hostUpdate;
    this.clientUpdate = input.clientUpdate;
    this.getLocalPlayerId = input.getLocalPlayerId ?? (() => bridge.getLocalPlayerId());
    this.getSynchronizedNow = input.getSynchronizedNow ?? (() => bridge.getSynchronizedNow());
    // Der Persistent-Base-Owner entsteht vor dem Flow und fragt ihn erst zur Laufzeit nach der
    // aktuellen World; dadurch bleibt seine Lifetime unabhaengig von jeder World-Instanz.
    this.persistentBase = new ArenaPersistentBaseSession({
      scene: input.scene,
      ctx: input.ctx,
      rockVisualHelper: input.rockVisualHelper,
      world: {
        getWorldBinding: () => this.flow.persistentBaseWorldPorts.getWorldBinding(),
        getConstructionRuntime: () => this.flow.persistentBaseWorldPorts.getConstructionRuntime(),
        getWorldRuntime: () => this.flow.getWorldRuntime(),
        getPlayerGameplayRuntime: () => this.flow.getWorldPlayerGameplayRuntime(),
        getPlayerCapabilities: (playerId) => (
          this.flow.persistentBaseWorldPorts.getPlayerCapabilities(playerId)
        ),
        hasPersistentBaseSite: () => this.flow.persistentBaseWorldPorts.hasPersistentBaseSite(),
        getConfiguredGameMode: () => this.flow.persistentBaseWorldPorts.getConfiguredGameMode(),
      },
    });
    this.flow = new ArenaLifecycleCoordinator(
      input.scene,
      input.ctx,
      input.renderers,
      input.rockVisualHelper,
      input.placementPreview,
      input.persistentBasePreviewRenderer,
      input.persistentBaseVisuals,
      input.lobbyOverlay,
      input.hostUpdate,
      input.clientUpdate,
      input.roomQualityMonitor,
      input.coopMissionPresentation ?? null,
      this.persistentBase,
      input.getSpectatorCameraInput,
    );
    input.rockVisualHelper?.setWorldPort?.({
      getWorldRuntime: () => this.flow.getWorldRuntime(),
      getTargetingRuntime: () => this.flow.getWorldTargetingRuntime(),
      getPlayerGameplayRuntime: () => this.flow.getWorldPlayerGameplayRuntime(),
      getPowerUpRuntime: () => this.flow.getWorldPowerUpRuntime(),
    });
    input.clientUpdate?.setPlayerWorldRuntime?.(
      (profile, spawn) => this.flow.attachPlayerToWorld(profile, false, spawn),
      (playerId) => this.flow.detachPlayerFromWorld(playerId),
    );
    input.clientUpdate?.setWorldPresentationResolver?.(
      () => this.flow.getLocalWorldPresentation(),
    );
    input.hostUpdate?.setPlayerCapabilitiesResolver?.(
      (playerId) => this.flow.getPlayerCapabilities(playerId),
    );
    input.ctx?.hostPhysics?.setCanMoveResolver?.(
      (playerId) => this.flow.getPlayerCapabilities(playerId).canMove,
    );
    this.rpcPorts = {
      worldParticipation: {
        handleRequest: (playerId, join) => this.flow.hostHandleWorldParticipationRequest(playerId, join),
      },
      playerCapabilities: {
        get: (playerId) => this.flow.getPlayerCapabilities(playerId),
      },
      construction: {
        placeInspectorConstruction: (playerId, constructionId, targetX, targetY, activityRevision) => (
          this.flow.getConstructionWorldRuntime()?.placeInspectorConstruction(
            playerId,
            constructionId,
            targetX,
            targetY,
            activityRevision,
          ) ?? { ok: false, reason: 'blocked' }
        ),
        useInspectorUtility: (playerId, tool, angle, targetX, targetY, now, params) => (
          this.flow.getConstructionWorldRuntime()?.useInspectorUtility(
            playerId,
            tool,
            angle,
            targetX,
            targetY,
            now,
            params,
          ) ?? { ok: false, reason: 'blocked' }
        ),
        dismantleConstruction: (playerId, targetX, targetY, activityRevision) => (
          this.flow.getConstructionWorldRuntime()?.dismantleConstruction(
            playerId,
            targetX,
            targetY,
            activityRevision,
          ) ?? { ok: false, reason: 'blocked' }
        ),
        dismantleAllOwnedConstructions: (playerId, activityRevision) => (
          this.flow.getConstructionWorldRuntime()?.dismantleAllOwnedConstructions(
            playerId,
            activityRevision,
          ) ?? { ok: false, reason: 'blocked' }
        ),
      },
      persistentBase: {
        placeReward: (playerId, request) => this.persistentBase.placePersistentBaseReward(playerId, request),
        moveObject: (playerId, request) => this.persistentBase.movePersistentBaseObject(playerId, request),
      },
      playerLoadout: {
        getBurrowSystem: () => this.flow.getWorldPlayerGameplayRuntime()?.systems.burrow ?? null,
        getLoadoutManager: () => this.flow.getWorldPlayerGameplayRuntime()?.systems.loadout ?? null,
        getTranslocatorSystem: () => this.flow.getWorldPlayerGameplayRuntime()?.systems.translocator ?? null,
        getResourceSystem: () => this.flow.getWorldPlayerGameplayRuntime()?.systems.resource ?? null,
        getPowerUpSystem: () => this.flow.getWorldPowerUpRuntime()?.system ?? null,
      },
      heldAction: {
        getSystem: () => this.flow.getWorldPlayerGameplayRuntime()?.systems.heldAction ?? null,
      },
      train: {
        markDestroyed: () => this.flow.onTrainDestroyed(),
      },
    };
    this.placementPorts = {
      getUsedCapacity: (ownerId) => this.flow.getWorldRuntime()?.materialization?.placement?.getUsedCapacity(ownerId) ?? 0,
      getDismantlePreview: (ownerId, originX, originY, pointerX, pointerY, range) => (
        this.flow.getWorldRuntime()?.materialization?.placement?.getDismantlePreview(
          ownerId,
          originX,
          originY,
          pointerX,
          pointerY,
          range,
        )
      ),
      getPlacementPreview: (config, originX, originY, pointerX, pointerY) => (
        this.flow.getWorldRuntime()?.materialization?.placement?.getPlacementPreview(
          config,
          originX,
          originY,
          pointerX,
          pointerY,
        )
      ),
      getTunnelPlacementPreview: (config, originX, originY, pointerX, pointerY, anchor) => (
        this.flow.getWorldRuntime()?.materialization?.placement?.getTunnelPlacementPreview(
          config,
          originX,
          originY,
          pointerX,
          pointerY,
          anchor,
        )
      ),
      getConstructionPlacementPreview: (definition, originX, originY, pointerX, pointerY) => (
        this.flow.getWorldRuntime()?.materialization?.placement?.getConstructionPlacementPreview(
          definition,
          originX,
          originY,
          pointerX,
          pointerY,
        )
      ),
    };
    this.weaponBalanceLabPort = {
      isReady: () => {
        const playerSystems = this.flow.getWorldPlayerGameplayRuntime()?.systems;
        const enemyManager = this.flow.getCoopMissionRuntime()?.enemyManager;
        return playerSystems !== undefined && enemyManager !== undefined;
      },
      spawnTarget: (x, y) => {
        const enemyManager = this.flow.getCoopMissionRuntime()?.enemyManager;
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
        const enemy = this.flow.getCoopMissionRuntime()?.enemyManager?.getEnemy(id);
        if (!enemy) return;
        enemy.setPosition(x, y);
        enemy.body.setVelocity(0, 0);
      },
      observeAdrenalineDrain: (listener) => {
        const resources = this.flow.getWorldPlayerGameplayRuntime()?.systems.resource;
        return resources?.addAdrenalineDrainObserver((observedPlayerId, _requested, drained) => {
          listener(observedPlayerId, drained);
        }) ?? null;
      },
      observeAdrenalineGain: (listener) => {
        const resources = this.flow.getWorldPlayerGameplayRuntime()?.systems.resource;
        return resources?.addAdrenalineGainObserver((observedPlayerId, _requested, gained) => {
          listener(observedPlayerId, gained);
        }) ?? null;
      },
      setAdrenaline: (playerId, amount) => {
        this.flow.getWorldPlayerGameplayRuntime()?.systems.resource.setAdrenaline(playerId, amount);
      },
      getMaxAdrenaline: (playerId) => {
        return this.flow.getWorldPlayerGameplayRuntime()?.systems.resource.getMaxAdrenaline(playerId) ?? 0;
      },
      useLoadout: (slot, playerId, angle, targetX, targetY, now, shotSequence) => {
        const loadout = this.flow.getWorldPlayerGameplayRuntime()?.systems.loadout;
        if (!loadout) return null;
        const player = this.ctx.playerManager.getPlayer(playerId);
        return loadout.use(
          slot,
          playerId,
          angle,
          targetX,
          targetY,
          now,
          shotSequence,
          undefined,
          player?.x,
          player?.y,
        );
      },
    };
    this.hostUpdate.setWorldFramePort({
      getWorldRuntime: () => this.flow.getWorldRuntime(),
      getTrainRuntime: () => this.flow.getWorldTrainRuntime(),
    });
    this.hostUpdate.setPlayerFramePort({
      getPlayerGameplayRuntime: () => this.flow.getWorldPlayerGameplayRuntime(),
      getPowerUpRuntime: () => this.flow.getWorldPowerUpRuntime(),
    });
    this.hostUpdate.setCombatFramePort({
      getTargetingRuntime: () => this.flow.getWorldTargetingRuntime(),
      getCombatGameplayBinding: () => this.flow.getWorldCombatGameplayBinding(),
      getSupportGameplayRuntime: () => this.flow.getWorldSupportGameplayRuntime(),
    });
    this.hostUpdate.setActivityFramePort({
      getStep: () => this.flow.getActivityStep(),
      getCoopMissionRuntime: () => this.flow.getCoopMissionRuntime(),
      getCaptureTheBeerRuntime: () => this.flow.getCaptureTheBeerActivityRuntime(),
    });
    this.clientUpdate.setWorldFramePort({
      getWorldRuntime: () => this.flow.getWorldRuntime(),
      getTargetingRuntime: () => this.flow.getWorldTargetingRuntime(),
    });
    this.clientUpdate.setPlayerFramePort({
      getPlayerGameplayRuntime: () => this.flow.getWorldPlayerGameplayRuntime(),
      getPowerUpRuntime: () => this.flow.getWorldPowerUpRuntime(),
    });
    this.clientUpdate.setActivityFramePort({
      getStep: () => this.flow.getActivityStep(),
    });
  }

  /**
   * Der world-scoped Anteil dieses Frames.
   *
   * Update folgt Ownership: Der Top-Level-Owner taktet die laufende World-Runtime, und diese
   * taktet ausschliesslich ihre eigenen Child-Owner.
   */
  update(deltaMs: number): void {
    this.flow.updateWorldRuntime(deltaMs);
  }

  /**
   * Positioniert die Weltkamera dieser World fuer diesen Frame; wird pro Frame zweimal gerufen -
   * einmal vor der Simulation, einmal danach auf die finale Spielerposition.
   */
  syncWorldCamera(deltaMs: number, showWorld: boolean): void {
    const presentationFrame = this.flow.getWorldRuntime()?.presentationFrame;
    // Ohne aktive World-Presentation - zwischen zwei Instanzen oder vor der ersten - gilt
    // derselbe neutrale Stand wie fuer eine World ohne Weltkamera. Sonst bliebe die Basis der
    // vorherigen World stehen, und das Kamera-Feedback rechnete am Frame-Ende darauf weiter.
    if (!presentationFrame) {
      resetWorldCameraBase(this.scene);
      return;
    }
    presentationFrame.syncCamera(deltaMs, showWorld);
  }

  /** Gleicht die residenten Render-Chunks dieser World an den sichtbaren Ausschnitt an. */
  syncWorldSurfaceResidency(showWorld: boolean): void {
    this.flow.getWorldRuntime()?.presentationFrame?.syncSurfaceResidency(showWorld);
  }

  syncWorldClientPresentation(
    state: WorldClientPresentationState | undefined,
    delta: number,
    countdownActive: boolean,
    countdownGround: SyncedBurningGroundSnapshot,
    countdownPedestals: SyncedPowerUpPedestal[],
  ): void {
    this.flow.getWorldRuntime()?.presentationFrame?.syncClientWorldPresentation(
      state,
      delta,
      countdownActive,
      countdownGround,
      countdownPedestals,
    );
  }

  syncWorldCanopy(showWorld: boolean): void {
    this.flow.getWorldRuntime()?.presentationFrame?.syncCanopyTransparency(showWorld);
  }

  /** Taktet die vollständige lokale Coop-Missionsdarstellung genau einmal pro Frame. */
  syncCoopMissionPresentation(deltaMs: number, active: boolean): void {
    this.flow.syncCoopMissionPresentation(deltaMs, active);
  }

  syncWorldLocalPlayerPresentation(showWorld: boolean, spectator: boolean): void {
    const presentationFrame = this.flow.getWorldRuntime()?.presentationFrame;
    if (presentationFrame) {
      presentationFrame.syncLocalPlayerPresentation(showWorld, spectator);
      return;
    }
    // Beim Handoff ist kein aktives World-Binding mehr vorhanden; die lokalen HUD-Elemente
    // werden trotzdem neutralisiert, damit kein World-Ring in die Lobby leakt.
    this.ctx.playerStatusRing?.setActive(false);
    this.ctx.playerManager.getPlayer(this.getLocalPlayerId())?.setWorldBarsVisible(!showWorld);
  }

  syncWorldPersistentBasePresentation(showWorld: boolean, spectator: boolean): void {
    this.flow.getWorldRuntime()?.presentationFrame?.syncPersistentBasePresentation(showWorld, spectator);
  }

  requestWorldStaticShadowBake(force: boolean): void {
    this.flow.getWorldRuntime()?.presentationFrame?.requestStaticShadowBake(force);
  }

  syncWorldStaticShadowProfile(force: boolean): void {
    const presentationFrame = this.flow.getWorldRuntime()?.presentationFrame;
    if (presentationFrame) {
      presentationFrame.syncStaticShadowProfile(force);
      return;
    }
    this.renderers.shadow.syncStaticProfile(this.getSynchronizedNow(), force);
  }

  syncWorldShadows(shadowArenaActive: boolean, inRoundWorld: boolean): void {
    const presentationFrame = this.flow.getWorldRuntime()?.presentationFrame;
    if (presentationFrame) {
      presentationFrame.syncWorldShadows(shadowArenaActive, inRoundWorld);
      return;
    }
    // Preserve the old no-runtime cleanup during a World handoff.
    this.renderers.shadow.clear();
  }

  syncWorldLighting(inArena: boolean, inRoundWorld: boolean): void {
    const presentationFrame = this.flow.getWorldRuntime()?.presentationFrame;
    if (presentationFrame) {
      presentationFrame.syncWorldLighting(inArena, inRoundWorld);
      return;
    }
    this.renderers.lighting.update();
  }

  /**
   * Der raumlanglebige Anteil dieses Frames.
   *
   * Er haengt am Raum und nicht an World, Activity oder Rundenphase: Jeder Peer bietet seinen
   * persoenlichen Basisbeitrag an und uebernimmt, was der Host ihm bestaetigt hat. Welche
   * raumlanglebigen Owner das betrifft, entscheidet dieser Top-Level-Owner - nicht die Scene.
   */
  syncRoomOwners(): void {
    this.persistentBase.syncPersistentBaseContributions();
    this.persistentBase.syncPersistentBaseRewards();
  }

  /**
   * Die autoritative Host-Frame-Phase dieser World; liefert den Abschluss der laufenden Activity.
   *
   * Der Frame-Owner fuehrt die Host-Phase aus und fragt danach genau einen benannten
   * Activity-Schritt. Die *Anwendung* des Abschlusses bleibt bewusst beim Aufrufer: Sie beendet
   * die World-Instanz, und die letzte Momentaufnahme dieser Runde muss davor entstehen.
   */
  runHostFrame(deltaMs: number, gameplayActive = false): CoopMissionOutcome | null {
    this.hostUpdate.runHostUpdate(deltaMs);
    if (!gameplayActive) return null;
    return this.flow.getActivityStep()?.hostResolveCompletion() ?? null;
  }

  /** Die darstellende Client-Frame-Phase dieser World. */
  runClientFrame(deltaMs: number): void {
    this.clientUpdate.runClientUpdate(deltaMs);
  }

  /** Debug-Eingriff auf die laufende Activity; ohne Activity passiert nichts. */
  applyDebugBaseDamage(amount: number): void {
    this.flow.getActivityStep()?.hostApplyDebugBaseDamage(amount);
  }

  // --- Lifecycle Operations ---

  initialize(): void {
    this.flow.initialize();
  }

  detectPhaseChange(deferArenaExit: boolean): void {
    this.flow.detectPhaseChange(deferArenaExit);
  }

  detectWorldChange(deferArenaExit: boolean): void {
    this.flow.detectWorldChange(deferArenaExit);
  }

  hostSyncLobbyWorld(): void {
    this.flow.hostSyncLobbyWorld();
  }

  hostSyncWorldMembers(): void {
    this.flow.hostSyncWorldMembers();
  }

  hostSyncWorldParticipation(): void {
    this.flow.hostSyncWorldParticipation();
  }

  syncRoundParticipation(): void {
    this.flow.syncRoundParticipation();
  }

  syncHostLoadoutsFromCommittedSelections(): void {
    this.flow.syncHostLoadoutsFromCommittedSelections();
  }

  syncArenaLoadReady(visibleWorldView: WorldViewRect | null): void {
    this.flow.syncArenaLoadReady(visibleWorldView);
  }

  spawnReadyPlayers(): void {
    this.flow.spawnReadyPlayers();
  }

  syncLobbyTimeOfDay(): void {
    this.flow.syncLobbyTimeOfDay();
  }

  syncLobbySurface(showLobby: boolean): void {
    this.flow.syncLobbySurface(showLobby);
  }

  hostCheckReadyToStart(): void {
    this.flow.hostCheckReadyToStart();
  }

  hostCompleteRound(coopRoundOutcome?: CoopMissionOutcome): void {
    this.flow.hostCompleteRound(coopRoundOutcome);
  }

  hostDiscardRound(): void {
    this.flow.hostDiscardRound();
  }

  canHostAbortRound(): boolean {
    return this.flow.canHostAbortRound();
  }

  hostAbortRound(): void {
    this.flow.hostAbortRound();
  }

  canEnterSpectatorMode(): boolean {
    return this.flow.canEnterSpectatorMode();
  }

  enterSpectatorMode(): void {
    this.flow.enterSpectatorMode();
  }

  handleSpectatorEntered(playerId: string): void {
    this.flow.handleSpectatorEntered(playerId);
  }

  handleGuestSessionOwnerRemoved(playerId: string): void {
    this.flow.handleGuestSessionOwnerRemoved(playerId);
  }

  removePlayerFromActiveRound(playerId: string): void {
    this.flow.removePlayerFromActiveRound(playerId);
  }

  terminateMatch(message?: string): void {
    this.flow.terminateMatch(message);
  }

  isMatchTerminated(): boolean {
    return this.flow.isMatchTerminated();
  }

  getIsLocalReady(): boolean {
    return this.flow.getIsLocalReady();
  }

  setIsLocalReady(ready: boolean): void {
    this.flow.setIsLocalReady(ready);
  }

  requestLocalWorldParticipation(participate: boolean): void {
    this.flow.requestLocalWorldParticipation(participate);
  }

  canSelfAdmitToWorld(): boolean {
    return this.flow.canSelfAdmitToWorld();
  }

  isLocalWorldParticipant(): boolean {
    return this.flow.isLocalWorldParticipant();
  }

  isArenaExitPresentationActive(): boolean {
    return this.flow.isArenaExitPresentationActive();
  }

  beginArenaExitPresentation(): void {
    this.flow.beginArenaExitPresentation();
  }

  getWorldRevealState(visibleWorldView: WorldViewRect | null): { ready: boolean; progress: number } {
    return this.flow.getWorldRevealState(visibleWorldView);
  }

  getLocalWorldPresentation(): WorldPresentationRequirement {
    return this.flow.getLocalWorldPresentation();
  }

  getPlayerCapabilities(playerId: string): PlayerCapabilities {
    return this.flow.getPlayerCapabilities(playerId);
  }

  isTrainDestroyedShown(): boolean {
    return this.flow.isTrainDestroyedShown();
  }

  getCurrentTimeOfDayMinutes(): number {
    return this.flow.getCurrentTimeOfDayMinutes();
  }

  getAutomaticTimeOfDayMinutes(): number {
    return this.flow.getAutomaticTimeOfDayMinutes();
  }

  setTimeOfDayDebugOverride(minutes: number): void {
    this.flow.setTimeOfDayDebugOverride(minutes);
  }

  clearTimeOfDayDebugOverride(): void {
    this.flow.clearTimeOfDayDebugOverride();
  }

  syncRuntimeTimeOfDay(now: number, signals: { bossSpawnedAtMs: number | null; bossPhase: number }): boolean {
    return this.flow.syncRuntimeTimeOfDay(now, signals);
  }

  setRuntimeDiagnosticEventSink(sink: RuntimeDiagnosticEventSink | null): void {
    this.flow.setRuntimeDiagnosticEventSink(sink);
  }

  // --- World & Round Value Queries ---

  isWorldActive(): boolean {
    const context = this.flow.getWorldRuntime()?.context;
    return context !== null && context !== undefined;
  }

  getWorldMetrics(): WorldMetrics | null {
    return this.flow.getWorldRuntime()?.context?.metrics ?? null;
  }

  getWorldDescriptor(): WorldDescriptor | null {
    return this.flow.getWorldRuntime()?.context?.descriptor ?? null;
  }

  getWorldLayout(): ArenaLayout | null {
    return this.flow.getWorldRuntime()?.presentation?.layout ?? null;
  }

  getPowerUpPedestalSnapshot(): SyncedPowerUpPedestal[] {
    return this.flow.getWorldPowerUpRuntime()?.system?.getPedestalSnapshot() ?? [];
  }

  getMaxBossPhase(): number {
    return this.flow.getCoopMissionRuntime()?.enemyManager?.getMaxBossPhase() ?? 0;
  }

  getConstructionCapacityForPlayer(playerId: string): number | undefined {
    return this.flow.getConstructionCapacityForPlayer(playerId);
  }

  getTranslocatorActivePuckId(playerId: string): number | undefined {
    return this.flow.getWorldPlayerGameplayRuntime()?.systems?.translocator?.getActivePuckId(playerId);
  }

  // --- Presentation & Combat Sources ---

  getReinforcementMatrices(): readonly SyncedReinforcementMatrix[] {
    return this.flow.getWorldTargetingRuntime()?.systems?.reinforcementMatrix?.getActiveMatrices() ?? [];
  }

  getEnergyInjectorEffects(): readonly SyncedEnergyInjectorEffect[] {
    return this.flow.getWorldTargetingRuntime()?.systems?.energyInjector?.getActiveEffects() ?? [];
  }

  getHostRemoteControlTargets(playerIds: readonly string[]): readonly SyncedRemoteControlTurret[] {
    return this.flow.getWorldPlayerGameplayRuntime()?.systems?.itemRuntime?.getRemoteControlSnapshot(
      [...playerIds],
      this.flow.getWorldCombatGameplayBinding()?.systems?.turret?.getTurrets() ?? [],
    ) ?? [];
  }

  getAuraEnemies(): readonly EnemyEntity[] {
    return this.flow.getCoopMissionRuntime()?.enemyManager?.getAllEnemies() ?? [];
  }

  syncEnemyHostVisuals(): void {
    this.flow.getCoopMissionRuntime()?.enemyManager?.syncHostVisuals();
  }

  getEnemyCount(): number {
    return this.flow.getCoopMissionRuntime()?.enemyManager?.getAllEnemies().length ?? 0;
  }

  getHostTunnelSnapshot(): readonly SyncedTunnel[] {
    return this.flow.getWorldPlayerGameplayRuntime()?.systems?.tunnel?.getSnapshot() ?? [];
  }

  syncStrategicTargetsPresentation(inRoundWorld: boolean, configuredGameMode: GameMode): void {
    const strategicTargets = bridge.isHost()
      ? (this.flow.getWorldPlayerGameplayRuntime()?.systems?.ak47StrategicTarget?.getNetSnapshot(bridge.getSynchronizedNow()) ?? [])
      : (bridge.getLatestGameState()?.ak47StrategicTargets ?? []);
    this.renderers.ak47StrategicTargets.sync(
      strategicTargets,
      this.flow.getCoopMissionRuntime()?.enemyManager ?? null,
      this.getLocalPlayerId(),
      bridge.getSynchronizedNow(),
      inRoundWorld && isCoopDefenseMode(configuredGameMode),
    );
  }

  syncClientCaptureTheBeerPresentation(state: GameState | undefined): void {
    if (!this.flow.getLocalWorldPresentation().required || !state) return;
    this.flow.getCaptureTheBeerActivityRuntime()?.system?.syncSnapshot(state.captureTheBeer ?? null);
    this.renderers.beer.sync(state.captureTheBeer?.beers ?? []);
  }

  getEnemySilhouette(targetId: string): {
    sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
    materialColor: number;
    knockbackFactor: number;
    isLocalPlayer: false;
  } | null {
    const enemy = this.flow.getCoopMissionRuntime()?.enemyManager?.getEnemy(targetId);
    if (!enemy) return null;
    return {
      sprite: enemy.sprite,
      materialColor: enemy.getTintColor(),
      knockbackFactor: enemy.getKnockbackFactor(),
      isLocalPlayer: false,
    };
  }

  getFlowFieldDebugService(type: ArenaInputDebugHotkey): EnemyFlowFieldService | null {
    const coop = this.flow.getCoopMissionRuntime();
    return type === 'flowfield_players'
      ? coop?.enemyPlayerFlowFieldService ?? null
      : coop?.enemyFlowFieldService ?? null;
  }

  getCoopDefenseBaseHpSummary(): {
    ownBase: { hp: number; maxHp: number } | null;
    hostileBase: { hp: number; maxHp: number } | null;
  } {
    const baseManager = this.flow.getWorldRuntime()?.materialization?.bases;
    const ownMainBases = baseManager?.getMainBasesByFaction('friendly') ?? [];
    const hostileMainBases = baseManager?.getMainBasesByFaction('hostile') ?? [];
    const sumBase = (bases: readonly { getHp(): number; getMaxHp(): number }[]): { hp: number; maxHp: number } | null => (
      bases.length === 0
        ? null
        : bases.reduce((sum, base) => ({
          hp: sum.hp + Math.max(0, base.getHp()),
          maxHp: sum.maxHp + Math.max(0, base.getMaxHp()),
        }), { hp: 0, maxHp: 0 })
    );
    return {
      ownBase: sumBase(ownMainBases),
      hostileBase: sumBase(hostileMainBases),
    };
  }

  // --- Diagnostics Methods ---

  getChunkRenderingDiagnosticsState(
    staticShadows: boolean,
    shadowSamplingMode: ChunkSamplingMode | null,
  ): ChunkRenderingDiagnosticsState {
    const arena = this.flow.getWorldRuntime()?.materialization?.arena;
    return {
      staticShadows,
      groundSurface: arena?.groundSurface?.isVisible() ?? true,
      rockOverlay: arena?.rockOverlaySurface?.isVisible() ?? true,
      chunkSampling: shadowSamplingMode
        ?? arena?.groundSurface?.getSamplingMode()
        ?? 'default',
      rockRenderer: arena?.rockVisualSystem?.getMode() ?? getRockRendererMode(),
      rockGpuPageSize: arena?.rockVisualSystem?.getPageSize() ?? getRockGpuPageSize(),
      rockGpu: arena?.rockVisualSystem?.getGpuDiagnostics() ?? null,
    };
  }

  setGroundSurfaceVisible(visible: boolean): void {
    this.flow.getWorldRuntime()?.materialization?.arena?.groundSurface?.setVisible(visible);
  }

  setRockOverlayVisible(visible: boolean): void {
    this.flow.getWorldRuntime()?.materialization?.arena?.rockOverlaySurface?.setVisible(visible);
  }

  setChunkSampling(mode: ChunkSamplingMode): void {
    const arena = this.flow.getWorldRuntime()?.materialization?.arena;
    arena?.groundSurface?.setSamplingMode(mode);
    arena?.rockOverlaySurface?.setSamplingMode(mode);
  }

  setRockRenderer(mode: RockRendererMode): void {
    this.flow.getWorldRuntime()?.materialization?.arena?.rockVisualSystem?.setMode(mode);
  }

  setRockGpuPageSize(size: RockGpuPageSize): void {
    this.flow.getWorldRuntime()?.materialization?.arena?.rockVisualSystem?.setPageSize(size);
  }

  getFlowFieldDiagnosticsSource(): { getDiagnostics(): any } | null {
    return this.flow.getCoopMissionRuntime()?.flowFieldCoordinator ?? null;
  }

  getRockVisualDiagnostics(): ArenaDiagnosticsRockVisualSystemPort | null {
    return this.flow.getWorldRuntime()?.materialization?.arena?.rockVisualSystem ?? null;
  }
}
