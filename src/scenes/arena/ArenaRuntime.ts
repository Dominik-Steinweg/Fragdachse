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
import type {
  ArenaInputDebugHotkey,
  ArenaSpectatorCameraInput,
} from './ArenaInputBindings';
import type { WeaponBalanceLabWorldPort } from '../../debug/coopDefenseBalance/WeaponBalanceLabRuntime';
import type { WorldPresentationRequirement } from '../../world/WorldPresentation';
import type { PlayerCapabilities } from '../../world/PlayerCapabilities';
import type { WorldMetrics } from '../../world/WorldMetrics';
import type { WorldDescriptor } from '../../world/WorldDescriptor';
import type { WorldProjectileRuntime } from '../../projectile/WorldProjectileRuntime';
import type { EnemyVisualSource } from '../../entities/EnemyVisualSource';
import type {
  ArenaLayout,
  SyncedReinforcementMatrix,
  SyncedEnergyInjectorEffect,
  SyncedRemoteControlTurret,
  SyncedTunnel,
} from '../../types';
import type { WorldViewRect } from '../../ui/HostileBaseIndicator';
import type {
  ArenaDiagnosticsFlowFieldPort,
  ArenaDiagnosticsRockVisualSystemPort,
} from './ArenaDiagnosticsController';
import type { ChunkRenderingDiagnosticsState } from '../../ui/PerformanceDiagnosticsOverlay';
import type { ChunkSamplingMode } from '../../arena/chunks/ChunkedRenderSurface';
import {
  getRockGpuPageSize,
  getRockRendererMode,
  type RockGpuPageSize,
  type RockRendererMode,
} from '../../arena/rocks/RockRendererSettings';
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
import type { CaptureTheBeerPresentationBinding } from '../../activity/CaptureTheBeerPresentationBinding';
import {
  createArenaPersistentBasePort,
  createArenaFlowFieldDebugPort,
  createArenaPlacementPorts,
  createArenaRuntimeDiagnosticsPort,
  createArenaRuntimePresentationPort,
  createArenaRuntimeRpcPorts,
  createArenaStrategicTargetsPort,
  createWeaponBalanceLabWorldPort,
} from './ArenaRuntimeAdapters';
import type {
  ArenaRuntimePersistentBasePort,
  ArenaRuntimePlacementPort,
  ArenaRuntimeDiagnosticsPort,
  ArenaRuntimePresentationPort,
  ArenaRuntimeRpcPorts,
  ArenaRuntimeStrategicTargetsPort,
  EnemyFlowFieldDebugPort,
} from './ArenaRuntimePorts';

export type RuntimeDiagnosticEventSink = (type: string, fields?: Record<string, unknown>) => void;

export type {
  ArenaRuntimeDiagnosticsPort,
  ArenaRuntimePresentationPort,
  ArenaRuntimeRpcPorts,
  ArenaRuntimeStrategicTargetsPort,
  EnemyFlowFieldDebugPort,
} from './ArenaRuntimePorts';

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
  readonly getLocalPlayerId: () => string;
  readonly getSynchronizedNow: () => number;
  readonly captureTheBeerPresentation?: CaptureTheBeerPresentationBinding;
  /**
   * A/D- bzw. Pfeiltasten-Eingabe der freien Zuschauerkamera. Lazy, weil die Input-Bindings der
   * Scene erst nach der `ArenaRuntime` entstehen – wie bei `rockVisualHelper`s World-Ports.
   */
  readonly getSpectatorCameraInput: () => ArenaSpectatorCameraInput | undefined;
}

export class ArenaRuntime {
  /** Raumlanglebiger Persistent-Base-Owner; er ueberlebt jede World und jede Runde. */
  readonly persistentBase: ArenaRuntimePersistentBasePort;
  /** Gebuendelte RPC-Ports fuer den RpcCoordinator; entkoppelt von konkreten Runtime-Interna. */
  readonly rpcPorts: ArenaRuntimeRpcPorts;
  /** Schmale Platzierungsports fuer die Scene-Eingabe. */
  readonly placementPorts: ArenaRuntimePlacementPort;
  /** Schmaler Port fuer das Weapon-Balance-Lab. */
  readonly weaponBalanceLabPort: WeaponBalanceLabWorldPort;
  /** Schmaler Source-Port fuer die Strategic-Target-Presentation. */
  readonly strategicTargetsPort: ArenaRuntimeStrategicTargetsPort;
  /** Gebuendelte World-/Activity-Praesentationsschritte fuer die Scene. */
  readonly presentation: ArenaRuntimePresentationPort;
  /** Explizite Diagnose- und Debug-Queries ohne Gameplay-Owner an der Boundary. */
  readonly diagnostics: ArenaRuntimeDiagnosticsPort;

  /** Der Arena-Flow bleibt private Implementierungsdetail der ArenaRuntime. */
  private readonly flow: ArenaLifecycleCoordinator;
  private readonly scene: Phaser.Scene;
  private readonly ctx: ArenaContext;
  private readonly renderers: RendererBundle;
  private readonly hostUpdate: HostUpdateCoordinator;
  private readonly clientUpdate: ClientUpdateCoordinator;
  private readonly persistentBaseOwner: ArenaPersistentBaseSession;
  private readonly getLocalPlayerId: () => string;
  private readonly getSynchronizedNow: () => number;

  constructor(input: ArenaRuntimeInput) {
    this.scene = input.scene;
    this.ctx = input.ctx;
    this.renderers = input.renderers;
    this.hostUpdate = input.hostUpdate;
    this.clientUpdate = input.clientUpdate;
    this.getLocalPlayerId = input.getLocalPlayerId;
    this.getSynchronizedNow = input.getSynchronizedNow;
    // Der Persistent-Base-Owner entsteht vor dem Flow und fragt ihn erst zur Laufzeit nach der
    // aktuellen World; dadurch bleibt seine Lifetime unabhaengig von jeder World-Instanz.
    this.persistentBaseOwner = new ArenaPersistentBaseSession({
      scene: input.scene,
      ctx: input.ctx,
      rockVisualHelper: input.rockVisualHelper,
      world: {
        getWorldBinding: () => this.flow.persistentBaseWorldPorts.getWorldBinding(),
        getConstructionRuntime: () => this.flow.persistentBaseWorldPorts.getConstructionRuntime(),
        getConstructionReadiness: () => this.flow.persistentBaseWorldPorts.getConstructionReadiness(),
        getWorldRuntime: () => this.flow.getWorldRuntime(),
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
      input.captureTheBeerPresentation ?? null,
      this.persistentBaseOwner,
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
    this.rpcPorts = createArenaRuntimeRpcPorts(this.flow, this.persistentBaseOwner);
    this.placementPorts = createArenaPlacementPorts(this.flow);
    this.persistentBase = createArenaPersistentBasePort(this.persistentBaseOwner);
    this.weaponBalanceLabPort = createWeaponBalanceLabWorldPort(this.flow, this.ctx.playerManager);
    this.strategicTargetsPort = createArenaStrategicTargetsPort(this.flow);
    this.presentation = createArenaRuntimePresentationPort(
      this.syncWorldCamera.bind(this),
      this.syncWorldSurfaceResidency.bind(this),
      this.syncWorldClientPresentation.bind(this),
      this.syncWorldCanopy.bind(this),
      this.syncCoopMissionPresentation.bind(this),
      this.syncWorldLocalPlayerPresentation.bind(this),
      this.syncWorldPersistentBasePresentation.bind(this),
      this.requestWorldStaticShadowBake.bind(this),
      this.syncWorldStaticShadowProfile.bind(this),
      this.syncWorldShadows.bind(this),
      this.syncWorldLighting.bind(this),
    );
    this.diagnostics = createArenaRuntimeDiagnosticsPort(
      this.getChunkRenderingDiagnosticsState.bind(this),
      this.setGroundSurfaceVisible.bind(this),
      this.setRockOverlayVisible.bind(this),
      this.setChunkSampling.bind(this),
      this.setRockRenderer.bind(this),
      this.setRockGpuPageSize.bind(this),
      this.getFlowFieldDebugPort.bind(this),
      this.getFlowFieldDiagnosticsPort.bind(this),
      this.getRockVisualDiagnostics.bind(this),
    );
    this.hostUpdate.setWorldFramePort({
      getWorldRuntime: () => this.flow.getWorldRuntime(),
      getTrainRuntime: () => this.flow.getWorldTrainRuntime(),
      getProjectileRuntime: () => this.flow.getWorldProjectileRuntime(),
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
      getPlayerGameplayReadViews: () => this.flow.getWorldPlayerGameplayRuntime(),
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
  private syncWorldCamera(deltaMs: number, showWorld: boolean): void {
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
  private syncWorldSurfaceResidency(showWorld: boolean): void {
    this.flow.getWorldRuntime()?.presentationFrame?.syncSurfaceResidency(showWorld);
  }

  private syncWorldClientPresentation(
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

  private syncWorldCanopy(showWorld: boolean): void {
    this.flow.getWorldRuntime()?.presentationFrame?.syncCanopyTransparency(showWorld);
  }

  /** Taktet die vollständige lokale Coop-Missionsdarstellung genau einmal pro Frame. */
  private syncCoopMissionPresentation(deltaMs: number, active: boolean): void {
    this.flow.syncCoopMissionPresentation(deltaMs, active);
  }

  private syncWorldLocalPlayerPresentation(showWorld: boolean, spectator: boolean): void {
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

  private syncWorldPersistentBasePresentation(showWorld: boolean, spectator: boolean): void {
    this.flow.getWorldRuntime()?.presentationFrame?.syncPersistentBasePresentation(showWorld, spectator);
  }

  private requestWorldStaticShadowBake(force: boolean): void {
    this.flow.getWorldRuntime()?.presentationFrame?.requestStaticShadowBake(force);
  }

  private syncWorldStaticShadowProfile(force: boolean): void {
    const presentationFrame = this.flow.getWorldRuntime()?.presentationFrame;
    if (presentationFrame) {
      presentationFrame.syncStaticShadowProfile(force);
      return;
    }
    this.renderers.shadow.syncStaticProfile(this.getSynchronizedNow(), force);
  }

  private syncWorldShadows(shadowArenaActive: boolean, inRoundWorld: boolean): void {
    const presentationFrame = this.flow.getWorldRuntime()?.presentationFrame;
    if (presentationFrame) {
      presentationFrame.syncWorldShadows(shadowArenaActive, inRoundWorld);
      return;
    }
    // Preserve the old no-runtime cleanup during a World handoff.
    this.renderers.shadow.clear();
  }

  private syncWorldLighting(inArena: boolean, inRoundWorld: boolean): void {
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
    this.persistentBaseOwner.syncPersistentBaseContributions();
    this.persistentBaseOwner.syncPersistentBaseRewards();
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

  getWorldProjectileRuntime(): WorldProjectileRuntime | null {
    return this.flow.getWorldProjectileRuntime();
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
    return this.flow.getWorldPlayerGameplayRuntime()?.getTranslocatorActivePuckId(playerId);
  }

  // --- Presentation & Combat Sources ---

  getReinforcementMatrices(): readonly SyncedReinforcementMatrix[] {
    return this.flow.getWorldTargetingRuntime()?.systems?.reinforcementMatrix?.getActiveMatrices() ?? [];
  }

  getEnergyInjectorEffects(): readonly SyncedEnergyInjectorEffect[] {
    return this.flow.getWorldTargetingRuntime()?.systems?.energyInjector?.getActiveEffects() ?? [];
  }

  getHostRemoteControlTargets(playerIds: readonly string[]): readonly SyncedRemoteControlTurret[] {
    return this.flow.getWorldPlayerGameplayRuntime()?.getRemoteControlSnapshot(
      [...playerIds],
      this.flow.getWorldCombatGameplayBinding()?.systems?.turret?.getTurrets() ?? [],
    ) ?? [];
  }

  getCombatEnemyVisuals(): readonly EnemyVisualSource[] {
    return this.flow.getCoopMissionRuntime()?.enemyManager?.getAllEnemies() ?? [];
  }

  syncEnemyHostVisuals(): void {
    this.flow.getCoopMissionRuntime()?.enemyManager?.syncHostVisuals();
  }

  getEnemyCount(): number {
    return this.flow.getCoopMissionRuntime()?.enemyManager?.getAllEnemies().length ?? 0;
  }

  getHostTunnelSnapshot(): readonly SyncedTunnel[] {
    return this.flow.getWorldPlayerGameplayRuntime()?.getTunnelNetSnapshot() ?? [];
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

  private getFlowFieldDebugPort(type: ArenaInputDebugHotkey): EnemyFlowFieldDebugPort | null {
    const coop = this.flow.getCoopMissionRuntime();
    const service = type === 'flowfield_players'
      ? coop?.enemyPlayerFlowFieldService ?? null
      : coop?.enemyFlowFieldService ?? null;
    return service ? createArenaFlowFieldDebugPort(service) : null;
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

  private getChunkRenderingDiagnosticsState(
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

  private setGroundSurfaceVisible(visible: boolean): void {
    this.flow.getWorldRuntime()?.materialization?.arena?.groundSurface?.setVisible(visible);
  }

  private setRockOverlayVisible(visible: boolean): void {
    this.flow.getWorldRuntime()?.materialization?.arena?.rockOverlaySurface?.setVisible(visible);
  }

  private setChunkSampling(mode: ChunkSamplingMode): void {
    const arena = this.flow.getWorldRuntime()?.materialization?.arena;
    arena?.groundSurface?.setSamplingMode(mode);
    arena?.rockOverlaySurface?.setSamplingMode(mode);
  }

  private setRockRenderer(mode: RockRendererMode): void {
    this.flow.getWorldRuntime()?.materialization?.arena?.rockVisualSystem?.setMode(mode);
  }

  private setRockGpuPageSize(size: RockGpuPageSize): void {
    this.flow.getWorldRuntime()?.materialization?.arena?.rockVisualSystem?.setPageSize(size);
  }

  private getFlowFieldDiagnosticsPort(): ArenaDiagnosticsFlowFieldPort | null {
    return this.flow.getCoopMissionRuntime()?.flowFieldCoordinator ?? null;
  }

  private getRockVisualDiagnostics(): ArenaDiagnosticsRockVisualSystemPort | null {
    return this.flow.getWorldRuntime()?.materialization?.arena?.rockVisualSystem ?? null;
  }
}
