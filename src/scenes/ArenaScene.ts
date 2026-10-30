import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { ArenaDeploymentTerrain } from './arena/ArenaDeploymentTerrain';
import type { PersistentBaseEditorTerrain } from '../persistentBase/PersistentBaseEditorWorld';
import type { PersistentBaseEditorRoom } from '../persistentBase/PersistentBaseEditorPreview';
import { toWorldDefinitionId } from '../world/arenaDescriptorAdapter';
import { DEFAULT_PERSISTENT_BASE_AREA_STAGE, PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE, type PersistentBaseAreaStage } from '../persistentBase/PersistentBaseCore';
import { resolveFrozenPersistentBaseAreaStage } from '../persistentBase/PersistentBaseAreaStageResolution';
import { getConstructionAccessContext, resolveConstructionAccess } from '../systems/ConstructionAccessResolver';
import { getRenderScale } from '../graphics/RenderResolution';
import { createMarkerCameraTransform } from '../effects/markers/MarkerLayoutModel';
import { resolveEarnedCoopDefenseBossPoints } from '../utils/coopDefenseUpgrades';
import { preloadWatchtowerAssets } from '../effects/watchtower/WatchtowerVisual';
import { installRuntimeAssetUrls } from '../assets/RuntimeAssetUrls';
import { DAWN_BOMBER_SHADOW_TEXTURE } from '../assets/DawnAssets';
import { resolveScheduledAirstrikeRuns, type ScheduledAirstrikeRun } from '../systems/AirstrikeRun';
import { isDawnUnlocked } from '../dawn/rules/DawnUnlock';
import { preloadPowerUpAssets, assertPowerUpAssetsReady } from '../assets/PowerUpAssets';
import { preloadWoodlandAssets, assertWoodlandAssetsReady } from '../assets/WoodlandAssets';
import { preloadCharacterMeshAssets, assertCharacterMeshAssetsReady } from '../assets/CharacterMeshAssets';
import { preloadGroundMaterials } from '../arena/GroundMaterialConfig';
import { preloadRockBase } from '../arena/RockBaseConfig';
import { PersistentBaseEditorScene, type PersistentBaseEditorSaveResult, type PersistentBaseEditorStageOptions } from './PersistentBaseEditorScene';
import { PersistentBaseEditorModel, type PersistentBaseEditorRoomBase } from '../persistentBase/PersistentBaseEditorModel';
import type { PersistentBaseRewardId } from '../persistentBase/PersistentBaseRewardTypes';
import { getStoredCoopDefenseProgress, getStoredLocalOwnerId, getStoredPersistentBaseUnlocked, getStoredPersistentBaseRewardState, getStoredPersistentBaseRewardUnlocks, getStoredPersonalBaseContribution, getStoredPersonalPersistentBaseAreaStage, setStoredPersonalBaseContribution, setStoredPersistentBaseRewardState } from '../utils/localPreferences';
import { createDeferredAssets, DEFERRED_ASSETS, getDeferredAssets } from '../assets/DeferredAssets';
import { LOBBY_ENEMY_TEXTURE_KEYS, preloadLobbyEnemyImages, registerLoadedFigureAnimations, roundDeferredAssets } from '../assets/RoundAssets';
import { SHOOTING_RANGE_CONTROLS } from '../shootingRange/ShootingRangeLayout';
import { getPipelineAssetForTexture } from '../config/pipelineAssets';
import { preloadAttackDroneAssets } from '../effects/AttackDroneRenderer';
import { preloadBomberSquadronAssets } from '../effects/bomberSquadron/BomberSquadronAssets';
import { preloadRepairDroneAssets } from '../effects/repairDroneVisuals';
import * as Phaser from 'phaser';
import { AfterRoundTransition, type AfterRoundView } from '../ui/AfterRoundTransition';
import { LazyOverlayGate } from '../ui/LazyOverlayGate';
import { loadingTimeline } from '../diagnostics/LoadingTimeline';
import { ArenaBaseEditorPreparation, baseEditorStageKey } from './arena/ArenaBaseEditorPreparation';
/** Standing still this long makes the lobby calm enough for a heavy build step of the Bauhof's stage. */
const BASE_EDITOR_CALM_MS = 400;
/** Standing still this long lets the lobby build a round-end view (up to ~0.2 s of CPU) in one frame. */
const ROUND_END_OVERLAY_CALM_MS = 1500;
/** Boot fade (250 ms) plus the lobby cards' entrance (100 + 500 ms), with a little slack. */
const BOOT_REVEAL_SETTLE_MS = 900;
import { composeArenaVoice } from './arena/ArenaVoiceComposition';
import { voiceLibrary } from '../voice/VoiceLibrary';
import { bindUiAudio } from '../ui/UiAudio';
import { BackdropBlur } from '../effects/postfx/BackdropBlur';
import { getForestModalSurfaces, preloadForestModalAssets } from '../ui/ForestModal';
import { preloadHudFrameAssets } from '../ui/HudFrameAssets';
import { preloadRadialWheelAssets } from '../ui/RadialWheelAssets';
import { preloadForestAssets } from '../ui/LobbyForestAssets';
import { bridge }                from '../network/bridge';
import { ArenaBuilder }          from '../arena/ArenaBuilder';
import {
  getRockGpuPageSize,
  getRockRendererMode,
  setRockGpuPageSize,
  setRockRendererMode,
} from '../arena/rocks/RockRendererSettings';
import { ChunkedRenderSurface }  from '../arena/chunks/ChunkedRenderSurface';
import { CHUNK_BAKE_STARTUP_FRAME_BUDGET_MS } from '../arena/chunks/ChunkBakeScheduler';
import { preloadRuntimeAtlas, assertRuntimeAtlasesReady } from '../assets/RuntimeAtlases';
import { preloadBaseGroundingAssets } from '../arena/BaseGroundingConfig';
import { preloadPersistentBaseGravelAssets } from '../arena/PersistentBaseGravelConfig';
import { preloadRockMossAssets } from '../arena/RockMossConfig';
import { preloadRockVegetationMask } from '../arena/RockVegetationConfig';
import { preloadTurretVisualAssets } from '../config/turretVisuals';
import { PlayerManager }         from '../entities/PlayerManager';
import { InputSystem }           from '../systems/InputSystem';
import { HostPhysicsSystem }     from '../systems/HostPhysicsSystem';
import { WorldCombatCore }          from '../combat/WorldCombatCore';
import { DecoySystem }           from '../systems/DecoySystem';
import { EffectSystem }          from '../effects/EffectSystem';
import { VisualFeedbackDirector } from '../effects/VisualFeedbackDirector';
import { CAMERA_FEEDBACK_LIMITS } from '../effects/camera/CameraFeedbackModel';
import { getCameraBaseScroll, getUnshakenPointerWorldPoint } from '../graphics/cameraBaseScroll';
import { ClarityCameraRegistry } from './arena/ClarityCameraRegistry';
import { SmokeSystem }           from '../effects/SmokeSystem';
import { FireSystem }            from '../effects/FireSystem';
import { StinkCloudSystem }      from '../effects/StinkCloudSystem';
import { preloadAllAudio }        from '../audio/AudioCatalog';
import { GameAudioSystem }        from '../audio/GameAudioSystem';
import { AimSystem, UtilityChargeIndicator } from '../ui/AimSystem';
import { ScopeOverlay } from '../ui/ScopeOverlay';
import { ArenaCountdownOverlay, type ArenaLoadingScreenState } from '../ui/ArenaCountdownOverlay';
import { EnemyHoverNameLabel }  from '../ui/EnemyHoverNameLabel';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import { PlayerStatusRing }      from '../ui/PlayerStatusRing';
import { CoopDefenseDebugOverlay } from '../ui/CoopDefenseDebugOverlay';
import { CoopDefenseBalanceReportOverlay } from '../ui/CoopDefenseBalanceReportOverlay';
import { CoopDefenseBalanceTracker, buildBalanceBuildSnapshot } from '../debug/coopDefenseBalance/tracker';
import {
  WeaponBalanceLabRuntime,
  buildNeutralWeaponBenchmarkCommit,
} from '../debug/coopDefenseBalance/WeaponBalanceLabRuntime';
import type { RuntimeBenchmarkRequest } from '../debug/coopDefenseBalance/runtimeBenchmarkTypes';
import { storeRuntimeBenchmarkResult } from '../debug/coopDefenseBalance/runtimeBenchmarkStorage';
import { WeaponBalanceLabOverlay, type WeaponBalanceLabStartResult } from '../ui/WeaponBalanceLabOverlay';
import { CaptureTheBeerPresentationBinding } from '../activity/CaptureTheBeerPresentationBinding';
import { TimeOfDayDebugOverlay } from '../ui/TimeOfDayDebugOverlay';
import { DEFAULT_TIME_OF_DAY_MINUTES, resolveSkyState } from '../effects/TimeOfDay';
import { resolveMapWorldGrade, type WorldGradeInputs } from '../effects/postfx/worldGrade';
import { CoopDefenseUpgradesOverlay } from '../ui/CoopDefenseUpgradesOverlay';
import { MatchResultsOverlay } from '../ui/MatchResultsOverlay';
import { RoomStatisticsOverlay } from '../ui/RoomStatisticsOverlay';
import { ArenaExitFadeOverlay } from '../ui/ArenaExitFadeOverlay';
import { CoopDefenseItemRewardOverlay } from '../ui/CoopDefenseItemRewardOverlay';
import { getOverlayAssets } from '../ui/OverlayAssets';
import {
  CoopDefenseItemsOverlay,
} from '../ui/CoopDefenseItemsOverlay';
import {
  resolvePersonalMatchOutcome,
} from '../ui/MatchResultsModel';
import { LeftSidePanel }         from '../ui/LeftSidePanel';
import { RightSidePanel }        from '../ui/RightSidePanel';
import { CenterHUD }             from '../ui/CenterHUD';
import { DawnHUD } from '../ui/DawnHUD';
import { LobbyOverlay }          from './LobbyOverlay';
import { BootScreen, BOOT_ERROR_EVENT } from '../ui/BootScreen';
import { BootPreparation, onBootSceneTeardown, waitStep } from '../ui/BootPreparation';
import { enableParallelShaderCompile, type ShaderProgramBarrier } from '../graphics/compileShaderPrograms';
import { prewarmRockFormationWorker } from '../arena/rocks/RockFormationWorkerPool';
import { isDevScenarioMode } from '../utils/devScenarioMode';
import type { DevScenarioController } from '../dev/scenario/controller';
import { observeBootLoader } from '../ui/BootLoaderProgress';
import { RoomQualityMonitor }    from '../network/RoomQualityMonitor';
import {
  ARENA_COUNTDOWN_SEC, ARENA_DURATION_SEC,
  PLAYER_COLORS, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH, ARENA_HEIGHT, ARENA_MAX_X, ARENA_MAX_Y, ARENA_VIEWPORT_WIDTH, ARENA_VIEWPORT_HEIGHT, GAME_WIDTH, GAME_HEIGHT, CELL_SIZE, COLORS, DEPTH,
  applyArenaActivityValuesForMode,
  applyArenaMetricsForMode,
  applyArenaModeFlags,
  applyArenaWorldMetrics,
} from '../config';
import type { GameState } from '../network/NetworkBridge';
import { DEFAULT_LOADOUT, LOADOUT_CATALOG_ENTRIES, WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../loadout/LoadoutConfig';
import { preloadHeldItemAssets } from '../loadout/HeldItemVisuals';
import {
  preloadBadgerAnimationAssets,
} from '../animations/BadgerAnimations';
import { resolveLoadoutSelectionIds } from '../loadout/LoadoutRules';
import { copyRoomShareUrl, rejoinCurrentRoom, restartWithNewRoom } from '../utils/roomQuality';
import { WebGLRectMaskTexture } from '../utils/webglRectMask';
import { coversDesignSpace } from './arena/ArenaClipPolicy';
import { ArenaMetaController } from './arena/ArenaMetaController';
import { createArenaMetaProgressStore } from './arena/ArenaMetaPersistence';
import {
  getStoredEffectsVolume,
  getStoredGraphicsQuality,
  getStoredGroundFogEnabled,
  getStoredMasterVolume,
  getStoredMusicVolume,
} from '../utils/localPreferences';
import { GraphicsQualityController } from '../graphics/GraphicsQuality';
import { warmupFogShaders } from '../effects/groundFog/FogShaderWarmup';
import { warmupWorldMaterials } from '../graphics/WorldMaterialWarmup';
import { destroySharedGlowSystem, installSharedGlowSystem } from '../effects/SharedGlowSystem';
import { getRenderResolutionController, toDesignSpace } from '../graphics/RenderResolution';
import { installTextResolution } from '../graphics/TextResolution';
import {
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  getCoopDefenseNumericStatTotals,
  getCoopDefenseUpgradeTextureKey,
  hasCoopDefenseDedicatedUpgradeIcon,
} from '../utils/coopDefenseUpgrades';
import type { ConstructionId, GameMode, GamePhase, LoadoutCommitSnapshot, LobbyLoadoutPreviewState, PlayerProfile, RoomQualitySnapshot } from '../types';
import { getTrainArrivalCountdownSecs } from '../train/TrainEvent';
import { COOP_DEFENSE_MODE, isCoopDefenseMode, isTeamGameMode } from '../gameModes';
import { getCoopDefenseMapConfig, getCoopMissionTimeLimitSec, isWeaponBalanceLabMapId, WEAPON_BALANCE_LAB_MAP_ID, type CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { resolveActiveGameMode, toMapId } from '../world/arenaDescriptorAdapter';
import { isDawnWorld, resolveCoopDefenseMapConfig, resolveWorldDefinition } from '../world/WorldDefinitionResolution';
import type { ActivityDescriptor } from '../world/ActivityDescriptor';
import type { WorldDescriptor } from '../world/WorldDescriptor';
import type { WorldPresentationRequirement } from '../world/WorldPresentation';
import { lobbyBuildingCandidates, lobbyMenuBlockedLabel, lobbyMenuDenial, type LobbyMenuAccessState } from '../systems/LobbyBuildingInteraction';
import { bridgeChargeCandidates } from '../systems/BridgeInteraction';
import { lobbyBuildingsOfWorld, lobbyBuildingWorldRects, type LobbyMenu } from '../config/authoring/lobbyBuildings';
import { LOBBY_MERCHANT } from '../config/authoring/lobbyMerchant';
import { nearestStructurePoint } from '../arena/StructureOutline';
import { isLobbyWorldDefinitionId } from '../config/authoring/lobbyWorld';
import { toArenaMetricsProfile } from '../world/WorldMetrics';
import { resolvePresentationPolicy } from '../world/PresentationPolicy';
import { buildCountdownGroundFirePreview } from '../effects/CountdownGroundFirePreview';
import { getLocale, t } from '../i18n';
import { getLocalizedGameModeLabel } from '../i18n/gameModePresentation';
import { getMapName } from '../i18n/contentPresentation';
import { TunnelRenderer } from './arena/TunnelRenderer';
import { PersistentBaseVisuals } from './arena/PersistentBaseVisuals';
import { PersistentBasePreviewRenderer } from './arena/PersistentBasePreviewRenderer';
import { EnemyFlowFieldDebugOverlay } from './arena/EnemyFlowFieldDebugOverlay';
import {
  ArenaInputBindings,
  type ArenaInputDebugHotkey,
} from './arena/ArenaInputBindings';
import {
  ArenaDiagnosticsController,
  type ArenaDiagnosticsFrame,
  type ArenaDiagnosticsFrameInput,
  type ArenaDiagnosticsRockVisualSystemPort,
} from './arena/ArenaDiagnosticsController';
import { dequantizeAngle } from '../utils/angle';

import {
  type ArenaContext,
  type RendererBundle,
  LocalPlayerState,
  RockVisualHelper,
  PlacementPreviewRenderer,
  ClientUpdateCoordinator,
  HostUpdateCoordinator,
  RpcCoordinator,
  ArenaRuntime,
  ArenaAimPresentationController,
  ArenaCombatPresentationController,
  CoopMissionPresentationInfrastructure,
  GaussWarningRenderer,
  createRendererBundleSteps,
  wireRenderersToEffectSystem,
  wireRenderersToAudioSystem,
  wireRenderersToCameraFeedback,
  wireRenderersToDistortion,
} from './arena';

/** Der Ladeschleier blendet in 220 ms aus; die Materialisierung beginnt, wenn er weitgehend weg ist. */
const SPAWN_REPLAY_AFTER_VEIL_MS = 160;

/**
 * Reine, immutable Frame-Signale fuer die Scene-Orchestrierung. Das Objekt traegt keine
 * Services oder Owner-Referenzen; fachliche Arbeit bleibt an den benannten Runtime-/Binding-
 * Schritten unten.
 */
type ArenaFrameSignals = Readonly<{
  configuredGameMode: GameMode;
  configuredCoopDefenseMapConfig: CoopDefenseMapConfig | null;
  enteredLobbyFromArena: boolean;
  returningFromWeaponBalanceLab: boolean;
  inGame: boolean;
  arenaLoading: boolean;
  countdownActive: boolean;
  terminated: boolean;
  gameplayActive: boolean;
  weaponBalanceLabArena: boolean;
  optionsOpen: boolean;
  spectator: boolean;
  worldActive: boolean;
  activityActive: boolean;
  localWorldPresentation: WorldPresentationRequirement;
  presentationPolicy: ReturnType<typeof resolvePresentationPolicy>;
}>;

import { startPerformanceCapture, attachPerformanceLab, performanceLobbyRevealed, updatePerformanceLab, failPerformanceLab } from '../debug/performanceLab/boot';

export class ArenaScene extends Phaser.Scene {
  private finishFogWarmup: ShaderProgramBarrier | null = null;
  private finishMaterialWarmup: ShaderProgramBarrier | null = null;
  private isFogShaderWarmupReady(): boolean {
    return (this.finishFogWarmup?.isReady() ?? true) && (this.finishMaterialWarmup?.isReady() ?? true);
  }
  private completeFogShaderWarmup(): void {
    const finish = this.finishFogWarmup; this.finishFogWarmup = null;
    finish?.();
    const material = this.finishMaterialWarmup; this.finishMaterialWarmup = null;
    material?.();
  }
  /** Round-end views, each built once on its first need; the boot never waits for them. */
  private resultsOverlay(): MatchResultsOverlay {
    if (!this.matchResultsOverlay) {
      const results = new MatchResultsOverlay(this, () => {
        this.beginAfterRoundTransition(this.matchResultsOverlay?.getTransitionView() ?? null);
        this.lobbyOverlay.setReadyButtonState(false);
        this.meta?.startAfterRoundFlow();
        return true;
      }, () => this.openBalanceFeedback(), {
        getState: () => ({
          available: this.canRestartDefeatedMap(),
          hasNewRewards: this.meta?.hasNewRoundRewards() ?? false,
        }),
        restart: () => this.restartDefeatedMap(),
      });
      results.build();
      this.matchResultsOverlay = results;
    }
    return this.matchResultsOverlay;
  }
  private statisticsOverlay(): RoomStatisticsOverlay {
    if (!this.roomStatisticsOverlay) {
      const statistics = new RoomStatisticsOverlay(this);
      statistics.build();
      this.roomStatisticsOverlay = statistics;
    }
    return this.roomStatisticsOverlay;
  }
  /** One round-end view per frame of a long calm lobby, so a round rarely builds one on first use. */
  private prepareRoundEndOverlays(): void {
    if (!this.initializationReady || this.bootRevealPending
      || (this.matchResultsOverlay && this.roomStatisticsOverlay && this.arenaExitFadeOverlay)
      || !this.isLobbyCalm(ROUND_END_OVERLAY_CALM_MS)) return;
    if (!this.arenaExitFadeOverlay) this.exitFadeOverlay();
    else if (!this.roomStatisticsOverlay) this.statisticsOverlay();
    else this.resultsOverlay();
  }
  private exitFadeOverlay(): ArenaExitFadeOverlay {
    if (!this.arenaExitFadeOverlay) {
      const exitFade = new ArenaExitFadeOverlay(this);
      exitFade.build();
      this.arenaExitFadeOverlay = exitFade;
    }
    return this.arenaExitFadeOverlay;
  }
  /** Explicit control surface for a separately booted, local-only analysis arena. */
  createNavigationLabPort(): import('../debug/navigationLab/NavigationLabPort').NavigationLabPort | null {
    if (!this.initializationReady) return null;
    return {
      ...this.arenaRuntime.navigationLabPort,
      start: (mapId, seed, loadout) => {
        if (!bridge.isHost() || bridge.getConnectedPlayers().length !== 1
          || bridge.getGamePhase() !== 'LOBBY') throw new Error('Navigation lab requires a solo lobby');
        bridge.setGameMode('coop_defense');
        bridge.setCoopDefenseMapId(mapId);
        this.arenaRuntime.navigationLabPort.setNextRoundSeed(seed);
        bridge.setLocalReadyWithCommittedLoadout(loadout);
        this.arenaRuntime.setIsLocalReady(true);
      },
      fireAt: (x, y, sequence) => {
        const player = this.arenaRuntime.navigationLabPort.getPlayerPosition();
        if (!player) return;
        this.arenaRuntime.weaponBalanceLabPort.useWeaponAction('weapon1', bridge.getLocalPlayerId(),
          Math.atan2(y - player.y, x - player.x), x, y, bridge.getSynchronizedNow(), sequence, true);
      },
      startRecording: environment => {
        this.diagnostics?.startScenarioRecording(environment);
        this.hostUpdate.setDetailedPerformanceMetricsEnabled(true);
      },
      stopRecording: () => {
        const report = this.diagnostics?.stopScenarioRecording() ?? null;
        this.hostUpdate.setDetailedPerformanceMetricsEnabled(false);
        return report;
      },
      getPerformance: () => ({ ...this.hostUpdate.getPerformanceMetrics() }),
      getRenderCpuMs: () => this.diagnostics?.getRenderCpuMs() ?? 0,
      getEyeGlowCounts: () => ({ eyes: this.renderers.enemyEyes.model.eyeCount,
        lights: this.renderers.lighting.getDebugStats().enemyEyeLights }),
    };
  }
  // ── Phaser-scoped objects (must stay in scene) ────────────────────────────
  private arenaBuilder!: ArenaBuilder;
  private arenaClipMask: WebGLRectMaskTexture | null = null;
  private bomberRuns: { events: CoopDefenseMapConfig['mapEvents']; runs: ScheduledAirstrikeRun[] } | null = null;
  private playerStatusRing: PlayerStatusRing | null = null;
  private enemyHoverNameLabel: EnemyHoverNameLabel | null = null;
  private removeReconnectStatusListener: (() => void) | null = null;
  private coopMissionPresentation!: CoopMissionPresentationInfrastructure;
  private dawnHUD: DawnHUD | null = null;
  private captureTheBeerPresentation!: CaptureTheBeerPresentationBinding;
  private aimPresentation: ArenaAimPresentationController | null = null;
  private combatPresentation: ArenaCombatPresentationController | null = null;
  /** Zentrale Regie für Kamerabewegung und Trefferreaktion. Szenenlebensdauer. */
  private visualFeedback: VisualFeedbackDirector | null = null;
  /**
   * Zweite, filterfreie Kamera über der Weltkamera. Trägt HUD und Overlays, damit die
   * Bildkomposition der Welt sie nicht erfasst.
   */
  private clarityCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private clarityRegistry: ClarityCameraRegistry | null = null;

  // ── Coordinators ──────────────────────────────────────────────────────────
  private ctx!: ArenaContext;
  private renderers!: RendererBundle;
  private localPlayerState!: LocalPlayerState;
  private rockVisualHelper!: RockVisualHelper;
  private persistentBaseVisuals!: PersistentBaseVisuals;
  private persistentBasePreviewRenderer!: PersistentBasePreviewRenderer;
  private hostUpdate!: HostUpdateCoordinator;
  private clientUpdate!: ClientUpdateCoordinator;
  private rpcCoordinator!: RpcCoordinator;
  private arenaRuntime!: ArenaRuntime;
  private devScenario: DevScenarioController | null = null;

  // ── Lobby / Room-quality (not round-scoped) ───────────────────────────────
  private lobbyOverlay!: LobbyOverlay;
  private afterRoundTransition: AfterRoundTransition | null = null;
  private roomQualityMonitor!: RoomQualityMonitor;
  private roomQualitySnapshot: RoomQualitySnapshot | null = null;
  private timeOfDayDebugOverlay: TimeOfDayDebugOverlay | null = null;
  /** Scene-langlebiger Owner der Diagnose (Profiler, Ablation, Net-/Performance-Overlay). */
  private diagnostics: ArenaDiagnosticsController | null = null;
  private networkProbe = false;
  /** Scene-langlebiger Owner fuer Keyboard-Setup, Hotkeys und deren Teardown. */
  private inputBindings: ArenaInputBindings | null = null;
  private flowFieldDebugOverlay: EnemyFlowFieldDebugOverlay | null = null;
  private coopDefenseDebugOverlay: CoopDefenseDebugOverlay | null = null;
  private coopDefenseBalanceTracker!: CoopDefenseBalanceTracker;
  private coopDefenseBalanceReportOverlay: CoopDefenseBalanceReportOverlay | null = null;
  private weaponBalanceLabOverlay: WeaponBalanceLabOverlay | null = null;
  private weaponBalanceLabRuntime!: WeaponBalanceLabRuntime;
  private weaponBalanceLabPreviousMapId: string | null = null;
  /** Scene-langlebiger Owner fuer persoenliche Progression, Upgrades und Loadout-Use-Cases. */
  private meta: ArenaMetaController | null = null;
  private coopDefenseUpgradesOverlay: CoopDefenseUpgradesOverlay | null = null;
  private baseEditor: PersistentBaseEditorScene | null = null;
  /** Map, seed and draft of the open base editor; a host map change reopens it with the same draft. */
  private baseEditorSession: { readonly terrainKey: string | null; readonly model: PersistentBaseEditorModel;
    readonly newRewardIds: readonly PersistentBaseRewardId[] } | null = null;
  /** An opening behind the loading panel; it may wait for the next round's terrain, which the lobby generates in the background. */
  private pendingBaseEditor: { readonly newRewardIds: readonly PersistentBaseRewardId[]; readonly model?: PersistentBaseEditorModel } | null = null;
  /** Loading panel from the Bauhof click until the editor shows its World; recreated after a shutdown. */
  private baseEditorGate: LazyOverlayGate | null = null;
  /** Real frame gaps while the Bauhof's loading run is open (Phaser's delta is smoothed). */
  private lastBaseEditorFrameAt = 0;
  /** Where the local player last moved, and since when it stands there (see `isLobbyCalm`). */
  private lobbyCalm = { x: NaN, y: NaN, since: 0 };
  private readonly deploymentTerrain = new ArenaDeploymentTerrain(bridge);
  /** The Bauhof's stage between sessions: kept while its terrain is the next round's. */
  private readonly baseEditorPreparation = new ArenaBaseEditorPreparation({
    add: (options) => {
      const stage = new PersistentBaseEditorScene(options);
      this.scene.add(PersistentBaseEditorScene.KEY, stage, true);
      return stage;
    },
    remove: (stage) => {
      stage.dispose();
      this.scene.stop(PersistentBaseEditorScene.KEY); this.scene.remove(PersistentBaseEditorScene.KEY);
    },
  });
  private matchResultsOverlay: MatchResultsOverlay | null = null;
  private roomStatisticsOverlay: RoomStatisticsOverlay | null = null;
  private arenaExitFadeOverlay: ArenaExitFadeOverlay | null = null;
  private arenaExitFadeComplete = false;
  private arenaExitResultsStarted = false;
  private arenaExitResultsRendered = false;
  private arenaExitRenderListener: (() => void) | null = null;
  private arenaExitOutcomeWaitStartedAt = 0;
  /** Nur das Angebot der gerade abgeschlossenen Runde darf automatisch erscheinen. */
  private lastObservedGamePhase: GamePhase | null = null;
  /** Solange gesetzt, deckt der Bootscreen die Lobby noch ab (siehe `syncBootReveal`). */
  private bootRevealPending = true;
  private initializationReady = false;
  private bootPreparation: BootPreparation | null = null;
  private itemRewardOverlay: CoopDefenseItemRewardOverlay | null = null;
  private itemsOverlay: CoopDefenseItemsOverlay | null = null;
  private lastLobbySidebarSignature: string | null = null;
  private graphicsQuality!: GraphicsQualityController;

  constructor() {
    super({ key: 'ArenaScene' });
  }

  preload(): void {
    installRuntimeAssetUrls(this.load);
    BootScreen.begin();
    // Status queries of the boot links (and every later warmup) must never wait for the driver.
    enableParallelShaderCompile(this.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer);
    // The formation worker's module start-up runs beside the downloads, not on the World's path.
    prewarmRockFormationWorker(this);
    this.finishMaterialWarmup = warmupWorldMaterials(this);
    onBootSceneTeardown(this.events, () => this.completeFogShaderWarmup());
    if (__PERFORMANCE_LAB__ || getStoredGroundFogEnabled()) {
      const started = performance.now();
      const quality = __PERFORMANCE_LAB__ && window.__FD_PERF_REQUEST__
        ? (window.__FD_PERF_REQUEST__.quality ?? 'high') : getStoredGraphicsQuality();
      this.finishFogWarmup = warmupFogShaders(this, quality);
      BootScreen.recordStep('fog-shader-links', performance.now() - started);
    }
    BootScreen.setStatus(t('ui.boot.loadingData'));
    BootScreen.setProgress(0);
    const cleanupLoader = observeBootLoader(this.load, (state) => {
      BootScreen.recordLoader(state);
      BootScreen.setProgress(state.total ? state.processed / state.total : 0);
      BootScreen.setIndeterminate(true);
      BootScreen.setStatus(t(state.downloaded === state.total && state.total > 0
        ? 'ui.boot.processingData' : 'ui.boot.loadingData'));
      BootScreen.setDetail(t('ui.boot.assetProgress', {
        downloaded: state.downloaded, processed: state.processed, total: state.total,
      }));
    }, () => {
      BootScreen.phase('preparation');
      BootScreen.setStatus(t('ui.boot.preparingLobby'));
      BootScreen.setDetail(t('ui.boot.preparingSystems'));
      BootScreen.setIndeterminate(true);
    });
    onBootSceneTeardown(this.events, cleanupLoader);

    preloadAllAudio(this.load);
    preloadForestAssets(this.load);
    preloadForestModalAssets(this.load);
    // Round-only content and large decoration follow behind the revealed lobby (second phase).
    createDeferredAssets(this, [...DEFERRED_ASSETS, ...roundDeferredAssets()]);
    preloadHudFrameAssets(this.load);
    preloadRadialWheelAssets(this.load);
    preloadGroundMaterials(this.load);
    this.load.image('lobby_bg', './assets/sprites/lobby_bg.png');
    this.load.spritesheet('rocks', './assets/sprites/rocks47blob.png', { frameWidth: 32, frameHeight: 32 });
    preloadRockBase(this.load);
    preloadWoodlandAssets(this);
    preloadCharacterMeshAssets(this);
    this.load.spritesheet('walls', './assets/sprites/walls47blob.png', { frameWidth: 32, frameHeight: 32 });
    for (const control of SHOOTING_RANGE_CONTROLS) {
      this.load.image(`shooting-range-${control}`, `./assets/shooting-range/${control}.png`);
    }
    this.load.spritesheet('rock_mottle', './assets/sprites/rocks47blob_alt.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('base',  './assets/sprites/base47blob.png',  { frameWidth: 32, frameHeight: 32 });
    preloadRuntimeAtlas(this.load, 'decals');
    preloadBaseGroundingAssets(this.load);
    preloadRuntimeAtlas(this.load, 'groundcover');
    preloadPersistentBaseGravelAssets(this.load);
    preloadRockMossAssets(this.load);
    preloadRockVegetationMask(this.load);
    preloadTurretVisualAssets(this.load);
    preloadPowerUpAssets(this);
    this.load.image('reward_plasma_turret', './assets/sprites/rewards/plasma_turret.png');
    // Die waffenlose Fassung der Figur. Die getragene Waffe ist seit `HeldItemVisual` ein eigenes
    // Bild; `32x32dachsweapon01.png` mit den braunen Platzhalterpixeln wird nicht mehr geladen.
    this.load.image('badger',      getPipelineAssetForTexture('badger')!.idlePath);
    this.load.atlas('dachs_death', './assets/player/death-a01-r03/death-sheet.png', './assets/player/death-a01-r03/death-atlas.json');
    preloadBadgerAnimationAssets(this.load, LOBBY_ENEMY_TEXTURE_KEYS);
    preloadHeldItemAssets(this.load);
    preloadAttackDroneAssets(this.load);
    preloadBomberSquadronAssets(this.load);
    preloadWatchtowerAssets(this.load);
    preloadRepairDroneAssets(this.load);
    preloadLobbyEnemyImages(this.load);

    preloadRuntimeAtlas(this.load, 'icons');
  }

  create(): void {
    this.initializationReady = false;
    this.bootRevealPending = true;
    this.input.enabled = false;
    if (this.input.keyboard) this.input.keyboard.enabled = false;
    this.sys.setVisible(false);
    // Phaser ignores create() promises and marks the scene RUNNING afterwards. Pause on
    // CREATE instead, so timers, physics and event-driven systems cannot tick partial state.
    this.events.once(Phaser.Scenes.Events.CREATE, () => this.sys.pause());
    bridge.clearPlayerCallbacks();
    let pendingFailure: string | null = null;
    let kicked = false;
    const onFailure = (message: string) => {
      if (!this.initializationReady) { pendingFailure = message; return; }
      if (bridge.getGamePhase() === 'ARENA') this.meta?.abortMatchResults(message);
      this.arenaRuntime.terminateMatch(message);
    };
    const onKicked = () => {
      if (!this.initializationReady) { kicked = true; return; }
      this.lobbyOverlay.showHostDisconnectedMessage(t('ui.lobby.kickedFromRoom'));
    };
    const removeFailure = bridge.onNetworkFailure(onFailure);
    const removeKicked = bridge.onKicked(onKicked);
    const cancel = () => {
      this.initializationReady = false;
      this.bootPreparation?.cancel();
      this.bootPreparation = null;
      removeFailure(); removeKicked();
      bridge.clearPlayerCallbacks();
      this.game.events.off(Phaser.Core.Events.POST_RENDER, this.syncBootReveal, this);
      if (this.bootRevealPending) BootScreen.phase('cancelled');
      BootScreen.dismissImmediate();
    };
    onBootSceneTeardown(this.events, cancel);
    this.bootPreparation = new BootPreparation(this.prepareLobby(),
      (name, durationMs) => BootScreen.recordStep(name, durationMs),
      () => {
        this.initializationReady = true;
        this.bootPreparation = null;
        BootScreen.phase('reveal');
        BootScreen.setDetail(t('ui.boot.preparingLandscape'));
        if (pendingFailure !== null) onFailure(pendingFailure);
        if (kicked) onKicked();
        this.sys.setVisible(true);
        this.sys.resume();
      },
      error => {
        this.initializationReady = false;
        BootScreen.phase('failed', error);
        try { this.sys.shutdown(); }
        finally { this.game.events.emit(BOOT_ERROR_EVENT, error); }
      });
    this.bootPreparation.start();
  }

  private *prepareLobby(): Generator<string, void> {
    // Assets load while the room connection is established; every system below talks to the bridge.
    if (!bridge.isActivated()) BootScreen.setStatus(t('ui.boot.connecting'));
    while (!bridge.isActivated()) yield waitStep('network-connect');
    if (__PERFORMANCE_LAB__ && window.__FD_PERF_REQUEST__?.systemProbe && window.__FD_PERF__) {
      window.__FD_PERF__.probeScene = this;
    }
    assertWoodlandAssetsReady(this);
    assertCharacterMeshAssetsReady(this);
    assertPowerUpAssetsReady(this);
    assertRuntimeAtlasesReady(this.textures);
    onBootSceneTeardown(this.events, () => {
      this.afterRoundTransition?.cancel();
      this.afterRoundTransition = null;
      this.cancelArenaExitRenderWait();
      this.arenaExitFadeOverlay?.destroy();
      this.arenaExitFadeOverlay = null;
      this.closeBaseEditor(false);
      this.baseEditorPreparation.release();
      this.matchResultsOverlay?.destroy();
      this.matchResultsOverlay = null;
      this.coopDefenseBalanceReportOverlay?.destroy();
      this.coopDefenseBalanceReportOverlay = null;
      this.roomStatisticsOverlay?.destroy();
      this.roomStatisticsOverlay = null;
      this.itemRewardOverlay?.destroy();
      this.itemsOverlay?.destroy();
    });
    onBootSceneTeardown(this.events, () => {
      this.lobbyOverlay?.destroy();
      this.aimPresentation?.destroy();
      this.aimPresentation = null;
      this.renderers?.healthBars.destroy();
      this.combatPresentation?.destroy();
      this.combatPresentation = null;
      this.persistentBaseVisuals?.destroy();
      this.persistentBasePreviewRenderer?.destroy();
      this.timeOfDayDebugOverlay?.destroy();
      this.timeOfDayDebugOverlay = null;
      this.weaponBalanceLabRuntime?.cancel();
      this.weaponBalanceLabOverlay?.destroy();
      this.weaponBalanceLabOverlay = null;
      this.coopDefenseDebugOverlay?.destroy();
      this.coopDefenseDebugOverlay = null;
      this.coopDefenseUpgradesOverlay?.destroy();
      this.coopDefenseUpgradesOverlay = null;
      this.meta?.destroy();
      this.meta = null;
      // Der Ring lebt so lange wie die Szene. Ohne diesen Aufruf bliebe seine
      // Qualitaets-Subscription im szenenuebergreifenden GraphicsQualityController haengen.
      this.playerStatusRing?.destroy();
      this.playerStatusRing = null;
      this.coopMissionPresentation?.destroy();
      this.captureTheBeerPresentation?.destroy();
      this.removeReconnectStatusListener?.();
      this.removeReconnectStatusListener = null;
    });

    applyArenaMetricsForMode(
      bridge.getGameMode(),
      bridge.getGamePhase(),
      this.resolveCoopDefenseArenaWidthCells(),
    );

    // Muss vor allem anderen laufen: ab hier gilt der 1920x1080-Designraum unabhängig davon,
    // wie viele Pixel die Canvas tatsächlich hat. Alles Folgende platziert Objekte darin.
    //
    // Die Klarheitskamera entsteht direkt mit, und ihre Registry hängt sich noch vor dem ersten
    // `add.*` ein: ein Objekt ohne Zuordnung würde von beiden Kameras gezeichnet.
    this.clarityCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'clarity');
    this.clarityRegistry = new ClarityCameraRegistry(this, this.cameras.main, this.clarityCamera);
    this.clarityRegistry.install();
    onBootSceneTeardown(this.events, () => {
      this.clarityRegistry?.destroy();
      this.clarityRegistry = null;
      this.clarityCamera = null;
    });
    this.bindCameraToDesignSpace();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.bindCameraToDesignSpace, this);
    const uninstallTextResolution = installTextResolution(this);
    onBootSceneTeardown(this.events, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.bindCameraToDesignSpace, this);
      uninstallTextResolution();
    });

    this.graphicsQuality = new GraphicsQualityController(
      __PERFORMANCE_LAB__ && window.__FD_PERF_REQUEST__ ? (window.__FD_PERF_REQUEST__.quality ?? 'high') : getStoredGraphicsQuality());
    this.graphicsQuality.setGroundFogEnabled(__PERFORMANCE_LAB__ || getStoredGroundFogEnabled());
    this.graphicsQuality.attach(this);
    onBootSceneTeardown(this.events, () => this.graphicsQuality.destroy());
    this.graphicsQuality.subscribe((profile) => {
      getRenderResolutionController()?.setMaxRenderScale(profile.maxRenderScale);
    });
    getRenderResolutionController()?.setMaxRenderScale(this.graphicsQuality.getProfile().maxRenderScale);
    installSharedGlowSystem(this);
    onBootSceneTeardown(this.events, () => destroySharedGlowSystem(this));
    this.diagnostics = new ArenaDiagnosticsController({
      scene: this,
      game: this.game,
      graphicsQuality: this.graphicsQuality,
      payloadDiagnostics: { setSink: (sink) => bridge.setPayloadDiagnosticsSink(sink) },
      getShadowSystem: () => this.renderers?.shadow ?? null,
      getLightingSystem: () => this.renderers?.lighting ?? null,
      getPostFxController: () => this.visualFeedback?.postFx ?? null,
      getGpuParticleSuppressor: () => this.renderers?.gpuVfx ?? null,
      getVectorLighting: () => this.renderers?.lighting
        ? { setSuppressed: (suppressed: boolean) => this.renderers?.lighting.setVectorSuppressed(suppressed) }
        : null,
      chunkDiagnostics: {
        getState: () => {
          const staticShadows = this.renderers?.shadow?.isStaticVisible() ?? true;
          const shadowSampling = this.renderers?.shadow?.getSamplingMode() ?? null;
          return this.arenaRuntime?.diagnostics.getChunkRenderingDiagnosticsState(staticShadows, shadowSampling) ?? {
            staticShadows,
            groundSurface: true,
            rockOverlay: true,
            chunkSampling: shadowSampling ?? 'default',
            rockRenderer: getRockRendererMode(),
            rockGpuPageSize: getRockGpuPageSize(),
            rockGpu: null,
          };
        },
        setStaticShadowsVisible: (visible) => this.renderers?.shadow?.setStaticVisible(visible),
        setGroundSurfaceVisible: (visible) => this.arenaRuntime?.diagnostics.setGroundSurfaceVisible(visible),
        setRockOverlayVisible: (visible) => this.arenaRuntime?.diagnostics.setRockOverlayVisible(visible),
        setChunkSampling: (mode) => {
          this.renderers?.shadow?.setSamplingMode(mode);
          this.arenaRuntime?.diagnostics.setChunkSampling(mode);
        },
        setRockRenderer: (mode) => {
          setRockRendererMode(mode);
          this.arenaRuntime?.diagnostics.setRockRenderer(mode);
        },
        setRockGpuPageSize: (size) => {
          setRockGpuPageSize(size);
          this.arenaRuntime?.diagnostics.setRockGpuPageSize(size);
        },
      },
      getGpuVfxStats: () => this.renderers?.gpuVfx.getStats() ?? null,
      getAdrenalineEssence: () => this.arenaRuntime?.diagnostics.getAdrenalineEssence?.() ?? null,
      getFlowFieldDiagnostics: () => this.arenaRuntime?.diagnostics.getFlowFieldDiagnosticsPort() ?? null,
      getRockVisualSystem: (): ArenaDiagnosticsRockVisualSystemPort | null => this.arenaRuntime?.diagnostics.getRockVisualDiagnostics() ?? null,
      getHostPerformanceMetrics: () => this.hostUpdate.getPerformanceMetrics(),
      getClientPerformanceMetrics: () => this.clientUpdate.getPerformanceMetrics(),
      getFrameMetrics: () => ({
        firePerformance: this.ctx.fireSystem.takePerformanceMetrics(),
        fireVisualMs: this.renderers.flamethrowerUpgrades.getLastUpdateCostMs(),
        lightingPerformance: this.renderers.lighting.getPerformanceMetrics(),
        lightingStepMs: this.renderers.lighting.getLastUpdateCostMs(),
        scopePerformance: this.aimPresentation?.getScopePerformanceMetrics() ?? null,
        aimGraphicsCommandCount: this.aimPresentation?.getAimGraphicsCommandCount() ?? 0,
      }),
    });
    onBootSceneTeardown(this.events, () => {
      this.diagnostics?.destroy();
      this.diagnostics = null;
    });

    if (!this.anims.exists('player_death')) {
      this.anims.create({
        key:       'player_death',
        frames:    this.anims.generateFrameNames('dachs_death', {
          prefix:  'badger-death-',
          zeroPad: 3,
          start:   0,
          end:     71,
        }),
        frameRate: 60,
        repeat:    0,
      });
    }
    registerLoadedFigureAnimations(this);

    yield 'cameras-and-diagnostics';
    if (__PERFORMANCE_LAB__ && this.diagnostics) startPerformanceCapture(this.diagnostics);

    // ── Static arena (never destroyed) ────────────────────────────────────
    this.arenaBuilder = new ArenaBuilder(this);
    this.arenaBuilder.buildStatic(bridge.getGameMode(), bridge.getGamePhase());
    // ── Scene-lifetime systems ─────────────────────────────────────────────
    const playerManager    = new PlayerManager(this);
    playerManager.setLocalPlayerId(bridge.getLocalPlayerId());
    playerManager.setRelationshipResolver((localPlayerId, otherPlayerId) => bridge.isEnemyPair(localPlayerId, otherPlayerId));
    playerManager.setTeamResolver((playerId) => bridge.getPlayerTeam(playerId));
    const decoySystem      = new DecoySystem(this, playerManager, bridge);
    const effectSystem     = new EffectSystem(this, bridge);
    effectSystem.setPlayerDeathResolver((targetId) => playerManager.getPlayer(targetId) !== undefined);
    const gameAudioSystem  = new GameAudioSystem(
      this,
      () => bridge.getLocalPlayerId(),
      () => {
        const sprite = playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject;
        return sprite ? { x: sprite.x, y: sprite.y } : null;
      },
      getStoredMasterVolume(),
      getStoredEffectsVolume(),
      getStoredMusicVolume(),
    );
    onBootSceneTeardown(this.events, () => gameAudioSystem.cleanup());
    const voice = composeArenaVoice(gameAudioSystem);
    onBootSceneTeardown(this.events, () => { bridge.registerVoiceHandler(null); voice.destroy(); });
    onBootSceneTeardown(this.events, bindUiAudio(this, gameAudioSystem));
    const unsubscribeDeferredAssets = getDeferredAssets(this).subscribe(state => {
      // Round figures' animations exist before any peer may start a round on them.
      if (state.ready) registerLoadedFigureAnimations(this);
      bridge.setLocalDeferredAssetsReady(state.ready);
    });
    onBootSceneTeardown(this.events, unsubscribeDeferredAssets);
    const smokeSystem      = new SmokeSystem(this);
    const fireSystem       = new FireSystem(this);
    this.diagnostics?.subscribeDiagnostics((enabled) => {
      fireSystem.setPerformanceMetricsEnabled(enabled && this.diagnostics?.wantsDetailedSampling() === true);
    });
    const stinkCloudSystem = new StinkCloudSystem(this);
    const hostPhysics      = new HostPhysicsSystem(this, playerManager, bridge);
    const inputSystem      = new InputSystem(
      this, bridge, () => playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject ?? undefined,
    );
    effectSystem.setAudioSystem(gameAudioSystem);

    this.visualFeedback = new VisualFeedbackDirector(this, {
      getWeaponPlayer: (id) => playerManager.getPlayer(id),
      getWorldRevision: () => bridge.getCurrentWorldRevision(),
      isWeaponTriggerHeld: (slot) => inputSystem.isWeaponTriggerHeld(slot),
      onWeaponShot: (shooterId) => this.arenaRuntime?.notifyWildlifeShot(shooterId),
      getListener: () => {
        const sprite = playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject;
        return sprite ? { x: sprite.x, y: sprite.y } : null;
      },
      getLocalPlayerId: () => bridge.getLocalPlayerId(),
      getGradeInputs: () => this.resolveWorldGradeInputs(),
    });
    // The world camera owns the single shared arena clip. It is attached after the persistent
    // camera post-FX chain so the hard boundary remains the final internal mask pass.
    this.ensureArenaClipMask();
    // Provider-Closure statt Manager-Referenz im Effektsystem: `enemyManager` ist rundengebunden
    // und muss zum Aufrufzeitpunkt gelesen werden (siehe ArenaContext-Vertrag).
    this.visualFeedback.setSilhouetteProvider((targetId) => {
      const player = playerManager.getPlayer(targetId);
      if (player?.displayObject) {
        return {
          sprite: player.displayObject,
          materialColor: player.color,
          knockbackFactor: 1,
          isLocalPlayer: targetId === bridge.getLocalPlayerId(),
        };
      }
      return this.arenaRuntime?.getEnemySilhouette(targetId) ?? null;
    });
    effectSystem.setHitFeedbackRenderer(this.visualFeedback.hitFeedback);
    onBootSceneTeardown(this.events, () => {
      this.visualFeedback?.destroy();
      this.visualFeedback = null;
    });

    yield 'scene-systems';

    // ── UI (scene-lifetime) ────────────────────────────────────────────────
    const leftPanel  = new LeftSidePanel(
      this,
      bridge,
      gameAudioSystem,
      this.graphicsQuality,
      () => this.handleImportedGameProgress(),
    );
    leftPanel.build();
    onBootSceneTeardown(this.events, () => leftPanel.destroy());
    yield 'left-panel';
    const rightPanel = new RightSidePanel(this);
    rightPanel.build();
    this.coopMissionPresentation = new CoopMissionPresentationInfrastructure(this);
    this.dawnHUD = new DawnHUD(this);
    this.coopMissionPresentation.bindDawnHud(this.dawnHUD);
    onBootSceneTeardown(this.events, () => { this.dawnHUD?.destroy(); this.dawnHUD = null; });
    const centerHUD  = new CenterHUD(this);
    centerHUD.build();
    this.coopMissionPresentation.bindCenterHud(centerHUD);

    const aimSystem = new AimSystem(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject ?? undefined,
      (slot) => this.clientUpdate.getLocalWeaponConfig(slot),
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    const scopeOverlay = new ScopeOverlay(this);
    const utilityChargeIndicator = new UtilityChargeIndicator(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject ?? undefined,
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    const ultimateChargeIndicator = new UtilityChargeIndicator(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject ?? undefined,
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    this.playerStatusRing = new PlayerStatusRing(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject ?? undefined,
      () => this.localPlayerState?.alive ?? false,
      () => this.localPlayerState?.burrowed ?? false,
    );
    this.enemyHoverNameLabel = new EnemyHoverNameLabel(this);
    this.coopDefenseBalanceTracker = new CoopDefenseBalanceTracker();
    this.coopDefenseBalanceReportOverlay = new CoopDefenseBalanceReportOverlay(
      this.coopDefenseBalanceTracker,
      () => {
        this.meta?.setMatchResultsBalanceFeedbackVisible(true);
      },
    );
    this.meta = new ArenaMetaController({
      playSound: key => gameAudioSystem.playLocalSound(key),
      progressStore: createArenaMetaProgressStore(),
      session: {
        getRoomCode: () => bridge.getRoomCode(),
        getGamePhase: () => bridge.getGamePhase(),
        getGameMode: () => bridge.getGameMode(),
        getLocalPlayerId: () => bridge.getLocalPlayerId(),
        isHost: () => bridge.isHost(),
        getCoopDefenseMapId: () => bridge.getCoopDefenseMapId(),
        setCoopDefenseMapId: (mapId) => bridge.setCoopDefenseMapId(mapId),
        isLocalReady: () => this.arenaRuntime.getIsLocalReady(),
        isAuthoritativeLocalReady: () => bridge.getPlayerReady(bridge.getLocalPlayerId()),
        getPlayerLoadoutSlot: (playerId, slot) => bridge.getPlayerLoadoutSlot(playerId, slot),
        setLocalLoadoutSlot: (slot, itemId) => bridge.setLocalLoadoutSlot(slot, itemId),
        setLocalReady: (ready) => {
          bridge.setLocalReady(ready);
          this.arenaRuntime.setIsLocalReady(ready);
        },
        setLocalCoopDefenseTotalXp: (totalXp) => bridge.setLocalCoopDefenseTotalXp(totalXp),
      },
      resultRead: {
        getRoundResults: () => bridge.getRoundResults(),
        getRoundState: () => bridge.getRoundState(),
        isLocalRoundResultEligible: (results) => bridge.isLocalRoundResultEligible(
          results ? [...results] : null,
        ),
        getCoopDefenseRoundXp: () => bridge.getCoopDefenseRoundXp(),
        getLocalCommittedLoadout: () => bridge.getPlayerCommittedLoadout(bridge.getLocalPlayerId()),
      },
      presentation: {
        setCoopDefenseProgress: (progress) => this.lobbyOverlay.setCoopDefenseProgress(progress),
        setCoopDefenseItemsState: (unlocked, pendingRewardCount, hasUnseenItems) => this.lobbyOverlay.setCoopDefenseItemsState(
          unlocked,
          pendingRewardCount,
          hasUnseenItems,
        ),
        setDawnUnlocked: (unlocked) => this.lobbyOverlay.setDawnUnlocked(unlocked),
        refreshUpgradeOverlay: () => this.coopDefenseUpgradesOverlay?.refresh(),
        scheduleUpgradeOverlayRefresh: () => this.coopDefenseUpgradesOverlay?.scheduleRefresh(),
        refreshColorIndicator: () => this.ctx.leftPanel.refreshColorIndicator(),
        hideDebugOverlay: () => this.coopDefenseDebugOverlay?.hide(),
        showBaseOverlay: (ids) => this.openBaseEditor(ids),
        showUpgradeOverlay: () => this.coopDefenseUpgradesOverlay?.show(this.afterRoundOpening()),
        finishAfterRoundPresentation: () => this.afterRoundTransition?.finish(),
        cancelAfterRoundPresentation: () => this.afterRoundTransition?.cancel(),
        showItemsOverlay: () => this.itemsOverlay?.show(),
        refreshItemsOverlay: () => this.itemsOverlay?.refresh(),
        isItemsOverlayOpen: () => this.itemsOverlay?.isOpen() ?? false,
        showItemRewardOverlay: (presentation, closeAfterClaim) => this.itemRewardOverlay?.show(presentation, closeAfterClaim, this.afterRoundOpening()),
        isItemRewardOverlayVisible: () => this.itemRewardOverlay?.isVisible() ?? false,
        showMatchResultsSyncing: (modeLabel, mapLabel) => this.resultsOverlay().showSyncing(modeLabel, mapLabel),
        hideMatchResults: () => this.matchResultsOverlay?.hide(),
        showMatchResults: (presentation) => this.resultsOverlay().show(presentation),
        showMatchResultsReplay: (presentation) => this.resultsOverlay().showReplay(presentation),
        isMatchResultsVisible: () => this.matchResultsOverlay?.isVisible() ?? false,
        setMatchResultsBalanceFeedbackVisible: (visible) => this.resultsOverlay().setBalanceFeedbackVisible(visible),
        showMatchResultsTechnicalAbort: (message) => this.resultsOverlay().showTechnicalAbort(message),
        setResultsReplayAvailable: (available) => this.lobbyOverlay?.setResultsReplayAvailable(available),
      },
    });
    this.coopDefenseDebugOverlay = new CoopDefenseDebugOverlay(
      () => {
        const stored = this.meta!.getStoredProgress();
        return {
          totalXp: stored.totalXp,
          bossPoints: resolveEarnedCoopDefenseBossPoints(stored),
          highestUnlockedMapId: stored.highestUnlockedMapId,
          unlockedClassIds: [...stored.unlockedClassIds],
          itemsUnlocked: stored.itemsUnlocked,
          persistentBaseUnlocked: stored.persistentBaseUnlocked,
          persistentBaseAreaStage: stored.persistentBaseAreaStage,
          persistentBaseRewardUnlocks: [...stored.persistentBaseRewardUnlocks],
          dawnUnlocked: isDawnUnlocked(stored),
        };
      },
      (totalXp, bossPoints, highestUnlockedMapId) => {
        this.meta?.setDebugProgress(totalXp, bossPoints, highestUnlockedMapId);
        this.refreshCoopDefenseDebugState({ applyMapSelection: true, metaAlreadyRefreshed: true });
      },
      () => {
        if (!this.meta?.resetCharacter()) return;
        this.refreshCoopDefenseDebugState({ applyMapSelection: true, metaAlreadyRefreshed: true });
      },
      () => {
        this.meta?.setDebugPersistentBaseUnlocked(true);
        this.refreshCoopDefenseDebugState();
      },
      (stage) => {
        this.meta?.setDebugPersistentBaseAreaStage(stage);
        this.refreshCoopDefenseDebugState();
      },
      (rewardId) => {
        this.meta?.grantDebugPersistentBaseRewards([rewardId]);
        this.refreshCoopDefenseDebugState();
      },
      () => {
        this.meta?.grantAllDebugPersistentBaseRewards();
        this.refreshCoopDefenseDebugState();
      },
      () => {
        this.meta?.setDebugItemsUnlocked(true);
        this.refreshCoopDefenseDebugState({ metaAlreadyRefreshed: true });
      },
      () => this.coopDefenseBalanceTracker.isRecordingEnabled(),
      (enabled) => this.coopDefenseBalanceTracker.setRecordingEnabled(enabled),
      () => this.coopDefenseBalanceReportOverlay?.show(),
      () => {
        this.meta?.setDebugDawnUnlocked();
        this.refreshCoopDefenseDebugState();
      },
    );
    this.timeOfDayDebugOverlay = new TimeOfDayDebugOverlay(
      () => this.arenaRuntime.getCurrentTimeOfDayMinutes(),
      () => this.arenaRuntime.getAutomaticTimeOfDayMinutes(),
      (minutes, settled) => this.applyDebugTimeOfDay(minutes, settled),
      () => this.clearDebugTimeOfDay(),
    );
    yield 'hud-and-meta';
    const canOpenMetaOverlay = () => bridge.getGamePhase() === 'LOBBY'
      && isCoopDefenseMode(bridge.getGameMode())
      && !this.arenaRuntime.getIsLocalReady()
      && !bridge.getPlayerReady(bridge.getLocalPlayerId())
      && !this.lobbyOverlay.hasTerminalFailure();
    this.coopDefenseUpgradesOverlay = new CoopDefenseUpgradesOverlay(
      this,
      () => this.meta!.getProgress(),
      (upgradeId) => this.meta?.levelUpUpgrade(upgradeId) ?? false,
      (upgradeId) => this.meta?.levelDownUpgrade(upgradeId) ?? false,
      (categoryId) => this.meta?.categoryRespec(categoryId) ?? false,
      () => this.meta?.classRespec() ?? false,
      () => this.meta?.canFullRespec() ?? false,
      () => this.meta?.fullRespec() ?? false,
      (classId) => this.meta?.selectClass(classId),
      (tool) => this.meta?.toggleLoadoutTool(tool) ?? false,
      (tools) => this.meta?.setLoadoutTools(tools) ?? false,
      () => this.meta?.getLocalLoadoutSelection() ?? {
        weapon1: null, weapon2: null, utility: null, ultimate: null,
      },
      (slot, itemId) => this.meta?.selectLoadoutItem(slot, itemId) ?? false,
      () => this.meta?.cancelUpgradeChanges(),
      () => this.meta?.applyUpgradeChanges(),
      () => this.advanceAfterRound('upgrades', this.coopDefenseUpgradesOverlay?.getTransitionView() ?? null),
      canOpenMetaOverlay,
    );
    yield 'upgrade-overlay';
    this.itemRewardOverlay = new CoopDefenseItemRewardOverlay(
      this,
      (roundEndedAt, offerUid, salvageUid, action, roundIdentity, salvageTarget) => Boolean(
        this.meta?.claimItemReward(roundEndedAt, offerUid, salvageUid, action, roundIdentity, salvageTarget),
      ),
      (roundEndedAt, roundIdentity) => this.meta?.getItemRewardPresentation(roundEndedAt, roundIdentity) ?? null,
      () => {
        this.lobbyOverlay.setReadyButtonState(false);
        this.itemsOverlay?.refresh();
        return this.advanceAfterRound('items', this.itemRewardOverlay?.getTransitionView() ?? null);
      },
      canOpenMetaOverlay,
    );
    yield "reward-overlay";
    this.itemsOverlay = new CoopDefenseItemsOverlay(
      this,
      () => this.meta!.getItemsOverlayState(),
      (uid) => this.meta?.equipItem(uid) ?? false,
      (slot) => this.meta?.unequipItem(slot) ?? false,
      (uid) => this.meta?.salvageItem(uid) ?? 0,
      () => this.meta?.openItemRewardOverlay(),
      () => this.lobbyOverlay.setReadyButtonState(false),
      canOpenMetaOverlay,
    );
    yield "items-overlay";
    // Results, room statistics and the exit fade are built behind the arena's loading veil or
    // on their first use, not before the lobby appears.


    const arenaCountdown = new ArenaCountdownOverlay(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject ?? undefined,
      this.visualFeedback.postFx,
    );
    arenaCountdown.setAudioSystem(gameAudioSystem);

    // ── Assemble ArenaContext ──────────────────────────────────────────────
    const getWorldCombatCore = (): WorldCombatCore | null => this.arenaRuntime?.getWorldCombatCore() ?? null;
    this.ctx = {
      playerManager, effectSystem,
      getWorldCombatCore,
      voice,
      getProjectileRuntime: () => this.arenaRuntime?.getWorldProjectileRuntime() ?? null,
      visualFeedback: this.visualFeedback,
      gameAudioSystem,
      decoySystem,
      smokeSystem, fireSystem, stinkCloudSystem, hostPhysics, inputSystem,
      leftPanel, rightPanel, centerHUD, aimSystem, arenaCountdown,
      playerStatusRing: this.playerStatusRing,
    };

    // ── Renderers ─────────────────────────────────────────────────────────
    // The boot links keep running in the driver while the remaining systems are built; the
    // invisible Scene draws nothing, and the links finish before the World can appear.
    yield 'context';
    this.renderers = yield* createRendererBundleSteps(this, playerManager);
    this.renderers.attackDrone.setAudio(gameAudioSystem);
    this.captureTheBeerPresentation = new CaptureTheBeerPresentationBinding(this.renderers.beer);
    // Der Profiler entsteht vor dem Renderer-Bundle; die GPU-VFX-Statistik wird deshalb hier
    // nachgereicht. Ohne sie fehlen Lanes und Effekte im Performance-Export vollstaendig.
    this.diagnostics?.attachGpuVfx(this.renderers.gpuVfx);
    this.diagnostics?.subscribeDiagnostics((enabled) => {
      const detailed = enabled && this.diagnostics?.wantsDetailedSampling() === true;
      this.renderers?.lighting.setPerformanceMetricsEnabled(detailed);
      this.renderers?.flamethrowerUpgrades.setPerformanceMetricsEnabled(detailed);
    });
    this.renderers.lighting.setAttributionCollector(this.diagnostics?.visualAttribution ?? null);
    this.renderers.shadow.setAttributionCollector(this.diagnostics?.visualAttribution ?? null);
    this.renderers.plasmaBurner.setLocalAimAngleProvider((ownerId) => (
      ownerId === bridge.getLocalPlayerId() ? inputSystem.getAimAngle() : null
    ));
    // Spawn-Blitz und Brand hängen an der jeweiligen Entity, nicht an einem zentralen
    // Renderer – der Manager reicht die Beleuchtung deshalb an seine Entities durch.
    playerManager.setLightingSystem(this.renderers.lighting);
    decoySystem.setLightingSystem(this.renderers.lighting);
    playerManager.setEntityBurnGpuController(this.renderers.entityBurnGpu);
    playerManager.setHealthBarRenderer(this.renderers.healthBars);
    stinkCloudSystem.setLightingSystem(this.renderers.lighting);
    stinkCloudSystem.setGpuVfxSystem(this.renderers.gpuVfx);
    smokeSystem.setLightingSystem(this.renderers.lighting);
    wireRenderersToEffectSystem(this.renderers, effectSystem);
    wireRenderersToAudioSystem(this.renderers, gameAudioSystem);
    wireRenderersToCameraFeedback(this.renderers, this.visualFeedback.camera);
    wireRenderersToDistortion(this.renderers, this.visualFeedback.distortion);
    effectSystem.setCameraFeedback(this.visualFeedback.camera);
    effectSystem.setPostFx(this.visualFeedback.postFx);
    effectSystem.setVisualFeedback(this.visualFeedback);
    this.renderers.nuke.setNukeCountdownDriver(
      (nukeId, progress, nx, ny) => this.visualFeedback?.driveNukeCountdown(nukeId, progress, nx, ny) ?? 0,
      (nukeId) => this.visualFeedback?.releaseNukeCountdown(nukeId),
    );
    inputSystem.setCameraFeedback(this.visualFeedback.camera);


    // ── Shared state & helpers ─────────────────────────────────────────────
    this.localPlayerState = new LocalPlayerState();
    this.rockVisualHelper  = new RockVisualHelper(
      this,
      this.ctx,
      this.renderers.shadow,
      this.renderers.rockDestruction,
      this.renderers.lighting,
      null,
      this.renderers.healthBars,
      this.renderers.turretAnimations,
    );
    const placementPreview = new PlacementPreviewRenderer(this, this.ctx);
    this.persistentBaseVisuals = new PersistentBaseVisuals(this);
    this.persistentBasePreviewRenderer = new PersistentBasePreviewRenderer(this, this.renderers.lighting);
    const tunnelRenderer = new TunnelRenderer(this);
    const gaussWarning = new GaussWarningRenderer(
      this,
      () => this.arenaRuntime?.getCombatEnemyVisuals() ?? [],
    );
    this.renderers.firestarter.setEnemySource(() => this.arenaRuntime?.getCombatEnemyVisuals() ?? []);
    this.renderers.shieldCharger.setEnemySource(() => this.arenaRuntime?.getCombatEnemyVisuals() ?? []);
    this.renderers.shieldCharger.setClock(() => bridge.getSynchronizedNow());
    this.renderers.alienCone.setEnemySource(() => this.arenaRuntime?.getCombatEnemyVisuals() ?? []);
    this.renderers.alienCone.setClock(() => bridge.getSynchronizedNow());
    this.renderers.enemyHops.setEnemySource(() => this.arenaRuntime?.getCombatEnemyVisuals() ?? []);
    this.renderers.enemyHops.setClock(() => bridge.getSynchronizedNow());
    this.renderers.kaboomtula.setEnemySource(() => this.arenaRuntime?.getCombatEnemyVisuals() ?? []);
    this.renderers.kaboomtula.setClock(() => bridge.getSynchronizedNow());
    // Players are drawn where they are shown (the local player at its predicted position).
    this.renderers.kaboomtula.setTargetResolver(target => {
      if (target.kind !== 'player') return null;
      const player = this.ctx.playerManager.getPlayer(target.id);
      return player ? { x: player.x, y: player.y } : null;
    });
    this.renderers.enemyPounces.setEnemySource(() => this.arenaRuntime?.getCombatEnemyVisuals() ?? []);
    this.renderers.enemyPounces.setClock(() => bridge.getSynchronizedNow());
    this.renderers.enemyHeatBursts.setEnemySource(() => this.arenaRuntime?.getCombatEnemyVisuals() ?? []);
    this.renderers.enemyHeatBursts.setClock(() => bridge.getSynchronizedNow());
    this.renderers.graveTitanGlow.setEnemySource(() => this.arenaRuntime?.getCombatEnemyVisuals() ?? []);
    this.renderers.graveTitanGlow.setClock(() => bridge.getSynchronizedNow());

    this.aimPresentation = new ArenaAimPresentationController(
      {
        getUtilityTargetingPreviewState: () => this.ctx.inputSystem.getUtilityTargetingPreviewState(),
        getAirstrikeTargetingPreviewState: () => this.ctx.inputSystem.getAirstrikeTargetingPreviewState(),
        getConstructionPlacementPreviewState: () => this.ctx.inputSystem.getConstructionPlacementPreviewState(),
        getUltimateChargePreviewState: () => this.ctx.inputSystem.getUltimateChargePreviewState(),
        getUtilityChargePreviewState: () => this.ctx.inputSystem.getUtilityChargePreviewState(),
        getScopeProgress: () => this.ctx.inputSystem.getScopeProgress(),
        isScoping: () => this.ctx.inputSystem.isScoping(),
        getScopeChargeProgress: () => this.ctx.inputSystem.getScopeChargeProgress(),
        getRocketMagazinePreview: () => this.ctx.inputSystem.getRocketMagazinePreview(),
        getWeapon2ScopeConfig: () => this.ctx.inputSystem.getWeapon2ScopeConfig(),
      },
      {
        getLocalPlacementPreview: () => this.inputBindings?.getLocalPlacementPreview(),
        getLocalUltimatePlacementPreview: () => this.inputBindings?.getLocalUltimatePlacementPreview(),
      getFireControlPortalLandingPreview: () => this.inputBindings?.getFireControlPortalLandingPreview(),
        getAimPresentationState: (worldInteractive, spectator, optionsOpen) => (this.devScenario?.hidesAim()
          ? { aimVisible: false, cursorVisible: false }
          : undefined) ?? this.inputBindings?.getAimPresentationState(
          worldInteractive,
          spectator,
          optionsOpen,
        ) ?? { aimVisible: false, cursorVisible: false },
      },
      {
        syncPersistentBasePresentation: (showWorld, spectator) => this.arenaRuntime?.presentation.syncWorldPersistentBasePresentation(showWorld, spectator),
        getTunnelSnapshot: () => bridge.isHost()
          ? (this.arenaRuntime?.getHostTunnelSnapshot() ?? [])
          : (bridge.getLatestGameState()?.tunnels ?? []),
      },
      {
        aimSystem,
        scopeOverlay,
        utilityChargeIndicator,
        ultimateChargeIndicator,
        placementPreview,
        tunnelRenderer,
        gaussWarning,
      },
    );
    this.combatPresentation = new ArenaCombatPresentationController(
      this.renderers,
      {
        getSynchronizedNow: () => bridge.getSynchronizedNow(),
        getPortalPairs: () => bridge.getTranslocatorPortalPairs(),
        updateVisualFeedback: (delta) => this.visualFeedback?.update(delta),
        getStrategicTargets: (now) => bridge.isHost()
          ? (this.arenaRuntime?.strategicTargetsPort.getHostSnapshot(now) ?? [])
          : (bridge.getLatestGameState()?.ak47StrategicTargets ?? []),
        getStrategicTargetEnemy: (enemyId) => this.arenaRuntime?.strategicTargetsPort.getEnemyVisual(enemyId) ?? null,
        getLocalPlayerId: () => bridge.getLocalPlayerId(),
        getReinforcementMatrices: () => this.arenaRuntime?.getReinforcementMatrices() ?? [],
        getEnergyInjectorEffects: () => this.arenaRuntime?.getEnergyInjectorEffects() ?? [],
        getRemoteControlTargets: () => bridge.isHost()
          ? (this.arenaRuntime?.getHostRemoteControlTargets(playerManager.getAllPlayers().map((player) => player.id)) ?? [])
          : (bridge.getLatestGameState()?.remoteControlTurrets ?? []),
        getEnemyVisuals: () => this.arenaRuntime?.getCombatEnemyVisuals() ?? [],
        syncEnemyHostVisuals: deltaMs => this.arenaRuntime?.syncEnemyHostVisuals(deltaMs),
        getEnemyCount: () => this.arenaRuntime?.getEnemyCount() ?? 0,
      },
    );
    this.diagnostics?.subscribeDiagnostics((enabled) => {
      this.aimPresentation?.setScopePerformanceMetricsEnabled(enabled && this.diagnostics?.wantsDetailedSampling() === true);
    });

    // ── Coordinators ──────────────────────────────────────────────────────
    this.hostUpdate   = new HostUpdateCoordinator(this, this.ctx, this.renderers, this.localPlayerState, this.rockVisualHelper);
    this.clientUpdate = new ClientUpdateCoordinator(this, this.ctx, this.localPlayerState, this.rockVisualHelper);
    leftPanel.setAdrenalineCostProvider(() => this.clientUpdate.getLocalWeaponAdrenalineCost('weapon2'));
    this.diagnostics?.subscribeDiagnostics((enabled) => {
      // Coordinators interpret this as the cheap whole-step Companion metric; their internal
      // phase timers remain disabled until a future detailed mode is explicitly introduced.
      this.hostUpdate?.setPerformanceMetricsEnabled(enabled);
      this.clientUpdate?.setPerformanceMetricsEnabled(enabled);
    });

    yield 'renderer-bindings-and-coordinators';

    // ── Lobby overlay & room-quality ───────────────────────────────────────
    this.lobbyOverlay = new LobbyOverlay(
      this, bridge,
      () => this.onReadyToggled(),
      () => { void this.onCopyRoomLink(); },
      () => rejoinCurrentRoom(),
      () => this.onRetryRoom(),
      () => this.diagnostics?.toggleNetDebug(),
      () => leftPanel.showHelpOverlay(),
      () => leftPanel.showOptionsOverlay(),
      () => this.openLobbyMenu('upgrades'),
      () => this.openLobbyMenu('items'),
      (enter) => enter
        ? this.arenaRuntime.requestLocalWorldParticipation(true)
        : this.requestLocalLobbyWorldLeave(),
      leftPanel.getLobbyContentContainer(),
      () => this.openLobbyMenu('base'),
      () => this.openLobbyMenu('merchant'),
    );
    this.lobbyOverlay.build();
    yield 'lobby-overlay';
    this.lobbyOverlay.setResultsReplayHandler(() => {
      const presentation = this.meta?.getLastMatchResultsPresentation();
      const roundEndedAt = presentation?.leaderboard[0]?.roundEndedAt ?? null;
      this.meta?.replayMatchResults(
        !!presentation
        && isCoopDefenseMode(presentation.mode)
        && roundEndedAt !== null
        && this.coopDefenseBalanceTracker.hasRound(roundEndedAt, presentation.roundIdentity),
      );
    });
    this.lobbyOverlay.setRoomStatisticsDetailHandler(() => {
      this.statisticsOverlay().show(bridge.getRoomPlayerStatistics());
    });

    this.lobbyOverlay.show();
    const lobbyBackdrop = new BackdropBlur(this, () => [
      this.lobbyOverlay?.getBackdropSurface() ?? null,
      leftPanel.getBackdropSurface(),
      ...getForestModalSurfaces(this),
    ]);
    onBootSceneTeardown(this.events, () => lobbyBackdrop.destroy());
    leftPanel.setLocaleSelectionBinding({
      canChange: () => bridge.getGamePhase() === 'LOBBY',
      onChanged: () => {
        this.lobbyOverlay?.build();
        this.lobbyOverlay?.show();
        leftPanel.refreshLocale();
        rightPanel.refreshLocale();
        this.roomStatisticsOverlay?.refreshLocale();
      },
    });
    this.meta?.refreshItemsPresentation();

    this.roomQualityMonitor = new RoomQualityMonitor(bridge);

    yield 'lobby-bindings';

    // No checkpoints from here through commit: publish callbacks only with all dependencies built.
    // ── RPC + Lifecycle coordinators ──────────────────────────────────────
    this.arenaRuntime   = new ArenaRuntime({
      scene: this,
      ctx: this.ctx,
      renderers: this.renderers,
      rockVisualHelper: this.rockVisualHelper,
      placementPreview: this.aimPresentation.getPlacementPreviewRenderer(),
      persistentBasePreviewRenderer: this.persistentBasePreviewRenderer,
      persistentBaseVisuals: this.persistentBaseVisuals,
      lobbyOverlay: this.lobbyOverlay,
      hostUpdate: this.hostUpdate,
      clientUpdate: this.clientUpdate,
      roomQualityMonitor: this.roomQualityMonitor,
      coopMissionPresentation: this.coopMissionPresentation,
      captureTheBeerPresentation: this.captureTheBeerPresentation,
      getLocalPlayerId: () => bridge.getLocalPlayerId(),
      getSynchronizedNow: () => bridge.getSynchronizedNow(),
      // Lazy: `this.inputBindings` entsteht erst nach der ArenaRuntime.
      getSpectatorCameraInput: () => this.inputBindings?.getSpectatorCameraInput(),
      deploymentLayouts: this.deploymentTerrain,
    });
    this.arenaRuntime.setRuntimeDiagnosticEventSink(this.diagnostics?.getSemanticEventSink() ?? null);
    if (import.meta.env.DEV && isDevScenarioMode()) {
      let disposed = false;
      onBootSceneTeardown(this.events, () => {
        disposed = true; this.devScenario?.destroy(); this.devScenario = null;
      });
      void import('../dev/scenario/controller').then(({ DevScenarioController }) => {
        if (!disposed) this.devScenario = new DevScenarioController(this, this.arenaRuntime,
          (angle, trigger) => inputSystem.setDiagnosticInput(angle, trigger), () => this.lobbyOverlay.isRevealComplete(),
          () => inputSystem.getInteractionView(),
          () => this.coopDefenseUpgradesOverlay?.isOpen() ? 'upgrades' : this.itemsOverlay?.isOpen() ? 'items'
            : this.lobbyOverlay.isMerchantOpen() ? 'merchant' : this.baseEditor ? 'base' : null);
      }).catch(error => { console.error('[Dev scenario]', error); });
    }
    if (__PERFORMANCE_LAB__) {
      if (new URLSearchParams(location.search).has('network-probe')) {
        this.networkProbe = true;
        let disposed = false;
        let cleanup: (() => void) | undefined;
        onBootSceneTeardown(this.events, () => { disposed = true; cleanup?.(); });
        void import('../debug/performanceLab/networkProbe').then(({ attachNetworkProbe }) => {
          if (!disposed) cleanup = attachNetworkProbe(this, this.arenaRuntime, playerManager, this.diagnostics!,
            (angle, trigger) => inputSystem.setDiagnosticInput(angle, trigger),
            () => this.lobbyOverlay.isRevealComplete(), level => this.graphicsQuality.setLevel(level));
        }).catch(error => { console.error('[Network probe]', error); });
      }
      onBootSceneTeardown(this.events, () => {
        if (window.__FD_PERF__ && !['failed', 'complete'].includes(window.__FD_PERF__.state)) failPerformanceLab('Scene shutdown during capture');
      });
      attachPerformanceLab(async () => {
        this.renderers.enemyEyes.setSuppressed(window.__FD_PERF_REQUEST__?.enemyEyes === 'off');
        const { createPerformanceLabGamePort } = await import('../debug/performanceLab/gamePort');
        return createPerformanceLabGamePort(this, this.arenaRuntime, playerManager, this.diagnostics!,
          (angle, trigger) => inputSystem.setDiagnosticInput(angle, trigger), () => this.lobbyOverlay.isRevealComplete(), 1,
          () => this.renderers.shadow?.getEnemyShadowsStatus() ?? null);
      }, () => (this.sound as Phaser.Sound.WebAudioSoundManager).context?.state ?? 'unavailable');
    }
    this.weaponBalanceLabRuntime = new WeaponBalanceLabRuntime(
      () => this.ctx,
      this.arenaRuntime.weaponBalanceLabPort,
      (result) => {
        storeRuntimeBenchmarkResult(result);
        console.info(
          `[WeaponBalanceLab] ${result.weaponId} ${result.scenario} ${result.dps.toFixed(2)} DPS`,
          result,
        );
      },
      () => {
        // Nicht mitten im Host-Update abbauen: Der naechste Scene-Tick sieht bereits LOBBY
        // und laeuft durch den regulaeren ARENA→LOBBY-Teardown.
        this.time.delayedCall(0, () => this.arenaRuntime.hostDiscardRound());
      },
    );
    this.weaponBalanceLabOverlay = new WeaponBalanceLabOverlay(
      () => ({
        weapon1: bridge.getPlayerLoadoutSlot(bridge.getLocalPlayerId(), 'weapon1')
          ?? DEFAULT_LOADOUT.weapon1.id,
        weapon2: bridge.getPlayerLoadoutSlot(bridge.getLocalPlayerId(), 'weapon2')
          ?? DEFAULT_LOADOUT.weapon2.id,
      }),
      (request) => this.startWeaponBalanceLab(request),
    );
    this.rpcCoordinator = new RpcCoordinator(
      this,
      this.renderers,
      this.clientUpdate,
      leftPanel,
      rightPanel,
      this.ctx.centerHUD,
      this.ctx.playerManager,
      this.ctx.hostPhysics,
      () => this.ctx.getWorldCombatCore(),
      this.ctx.decoySystem,
      this.ctx.effectSystem,
      this.ctx.visualFeedback,
      this.ctx.gameAudioSystem,
      this.arenaRuntime.rpcPorts.worldParticipation,
      this.arenaRuntime.rpcPorts.playerCapabilities,
      this.arenaRuntime.rpcPorts.construction,
      this.arenaRuntime.rpcPorts.persistentBase,
      this.arenaRuntime.rpcPorts.playerLoadout,
      this.arenaRuntime.rpcPorts.heldAction,
      this.arenaRuntime.rpcPorts.train,
      () => bridge.getSynchronizedNow(),
    );
    bridge.registerAudioFeedbackHandler(event => {
      if (event.position) {
        gameAudioSystem.playSound(event.key, event.position.x, event.position.y, event.position.emitterId);
      } else {
        gameAudioSystem.playLocalSound(event.key);
      }
    });
    effectSystem.setup((hit) => { aimSystem.notifyConfirmedHit(hit); });
    this.rpcCoordinator.registerAll();
    // Host-Abbruch der laufenden Partie (Optionsmenue, in jedem Spielmodus).
    leftPanel.setAbortMatchBinding({
      canAbort: () => this.arenaRuntime.canHostAbortRound(),
      abort: () => this.arenaRuntime.hostAbortRound(),
    });
    leftPanel.setSpectatorMatchBinding({
      canSpectate: () => this.arenaRuntime.canEnterSpectatorMode(),
      spectate: () => this.arenaRuntime.enterSpectatorMode(),
    });
    leftPanel.setWorldLeaveBinding({
      canLeave: () => this.canLeaveLocalLobbyWorld(),
      leave: () => this.requestLocalLobbyWorldLeave(),
    });

    if (bridge.isHost()) {
      bridge.initColorPool(PLAYER_COLORS);
    }

    bridge.onPlayerJoin(profile => this.onPlayerJoined(profile));
    bridge.onPlayerQuit(id      => this.onPlayerLeft(id));
    bridge.onSpectatorEntered(id => this.arenaRuntime.handleSpectatorEntered(id));
    this.removeReconnectStatusListener = bridge.onReconnectStatus((status) => {
      if (status.state === 'reconnecting' || status.state === 'resumed') {
        this.clientUpdate.resetMovementPrediction();
        this.coopMissionPresentation.resetMapEventsForHydration();
      }
      if (status.state === 'resumed') {
        this.clientUpdate.retryUnresolvedWeapon2Predictions();
      }
      if (status.state === 'player-expired') {
        this.arenaRuntime.handleGuestSessionOwnerRemoved(status.playerId);
      }
    });
    this.arenaRuntime.initialize();
    inputSystem.setupShootingRangeProvider(() => this.arenaRuntime.getShootingRange());
    inputSystem.setupBridgeChargeProvider((player, worldRevision) => {
      const bridges = this.arenaRuntime.getWorldBridgeRuntime();
      const metrics = this.arenaRuntime.getWorldMetrics();
      if (!bridges || !metrics || bridge.getLocalWorldParticipation() !== 'interactive') return [];
      const localId = bridge.getLocalPlayerId();
      const explosives = this.arenaRuntime.getCarryItems().filter(item => item.item === 'explosive');
      return bridgeChargeCandidates({
        bridges: bridges.getBridges(), readState: id => bridges.getState(id), origin: metrics, player, worldRevision,
        carryingExplosive: explosives.some(item => item.holderId === localId),
        explosivesInPlay: explosives.length > 0,
      });
    });
    inputSystem.setupLobbyMenuProvider({
      candidates: player => {
        const world = this.arenaRuntime.getWorldDescriptor();
        const metrics = this.arenaRuntime.getWorldMetrics();
        if (!world || !metrics || !isLobbyWorldDefinitionId(world.definitionId)
          || bridge.getGamePhase() !== 'LOBBY' || this.isWorldMenuBlocking()
          || bridge.getLocalWorldParticipation() !== 'interactive') return [];
        const access = this.lobbyMenuAccessState();
        return lobbyBuildingCandidates(metrics, world.worldRevision, player, menu => lobbyMenuBlockedLabel(menu, access),
          lobbyBuildingsOfWorld(world.parameters), menu => menu === 'base' && this.baseEditorPreparation.isPreparing());
      },
      open: menu => this.openLobbyMenu(menu),
    });
    inputSystem.setupStructureOccupancyProviders({
      getStructures: () => this.arenaRuntime.getStructurePlatforms(),
      getState: id => bridge.isHost() ? this.arenaRuntime.getStructureOccupancyState(id) : bridge.getLatestGameState()?.players[id]?.structureOccupancy,
    });
    inputSystem.setupTurretControlProviders({
      getTurrets: () => this.arenaRuntime.getTurretDefinitions(),
      getState: id => bridge.isHost() ? this.arenaRuntime.getTurretControlState(id) : bridge.getLatestGameState()?.players[id]?.turretControl,
      isEnabled: () => {
        const loadout = bridge.getPlayerCurrentLoadoutSnapshot(bridge.getLocalPlayerId());
        return isCoopDefenseMode(bridge.getActiveGameMode()) && !!loadout?.coopDefenseProfile
          && (getCoopDefenseNumericStatTotals(loadout.coopDefenseProfile, loadout.coopDefenseClassId ?? undefined)['player.turretControlEnabled'] ?? 0) > 0;
      },
    });
    const inputBindings = new ArenaInputBindings({
      scene: this,
      inputSystem,
      audioSystem: gameAudioSystem,
      actions: {
        getLocalUtilityConfig: () => this.clientUpdate.getLocalUtilityConfig(),
        getLocalUtilityCooldownUntil: (temporaryUtilityInstanceId) => this.clientUpdate.getLocalUtilityCooldownUntil(temporaryUtilityInstanceId),
        getLocalUltimateConfig: () => this.clientUpdate.getLocalUltimateConfig(),
        getLocalRage: () => this.clientUpdate.getLocalRage(),
        getLocalWeaponConfig: (slot) => this.clientUpdate.getLocalWeaponConfig(slot),
        getLocalWeaponAdrenalineCost: (slot) => this.clientUpdate.getLocalWeaponAdrenalineCost(slot),
        getLocalAdrenaline: () => this.clientUpdate.getLocalAdrenaline(),
        getLocalInspectorTools: () => this.clientUpdate.getLocalInspectorTools(),
        getLocalConstructionCapacity: () => this.clientUpdate.getLocalConstructionCapacity(),
        getWeaponLastFired: (slot) => this.clientUpdate.weaponLastFiredRecord()[slot],
        selectAimWeapon: slot => aimSystem.setActiveSlot(slot),
        notifyLoadoutFired: (slot, angle, targetX, targetY) => this.clientUpdate.notifyLoadoutFired(slot, angle, targetX, targetY),
        rollbackRejectedLoadoutFire: (slot, predictionId) => this.clientUpdate.rollbackRejectedLoadoutFire(slot, predictionId),
        notifyUtilityFired: () => this.clientUpdate.notifyUtilityFired(),
        beginPredictedWeapon2Use: (predictionId, request, amount, onReject) => this.clientUpdate.beginPredictedWeapon2Use(predictionId, request, amount, onReject),
        getLocalPlayerId: () => bridge.getLocalPlayerId(),
        getActiveGameMode: () => bridge.getActiveGameMode(),
        isHost: () => bridge.isHost(),
        getSynchronizedNow: () => bridge.getSynchronizedNow(),
        getPlayerCurrentLoadoutSnapshot: (playerId) => bridge.getPlayerCurrentLoadoutSnapshot(playerId),
        getPlayerUtilityCooldownUntil: (playerId, utilityId) => bridge.getPlayerUtilityCooldownUntil(playerId, utilityId),
        getPlayerTemporaryUtilityInstances: (playerId) => bridge.getPlayerTemporaryUtilityInstances(playerId),
        sendLoadoutUse: (slot, angle, targetX, targetY, shotId, params, clientX, clientY, awaitResult, predictionId) => bridge.sendLoadoutUse(
          slot,
          angle,
          targetX,
          targetY,
          shotId,
          params,
          clientX,
          clientY,
          awaitResult,
          predictionId,
        ),
        getPlayerCapabilities: () => {
          return this.arenaRuntime.getPlayerCapabilities(bridge.getLocalPlayerId());
        },
        isLocalPlayerAlive: () => this.localPlayerState.alive,
        isLocalPlayerBurrowed: () => this.localPlayerState.burrowed,
        getLocalPlayerPosition: () => {
          const sprite = playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject;
          return sprite ? { x: sprite.x, y: sprite.y } : undefined;
        },
        getPointerWorldPoint: () => {
          const pointer = this.getPointerWorldPoint();
          return { x: pointer.x, y: pointer.y };
        },
        getConstructionCapacityForPlayer: (playerId) => this.arenaRuntime?.getConstructionCapacityForPlayer(playerId),
        getTranslocatorActivePuckId: (playerId) => this.arenaRuntime?.getTranslocatorActivePuckId(playerId),
        placement: this.arenaRuntime.placementPorts,
        persistentBase: this.arenaRuntime.persistentBase,
        feedback: {
          notifyAdrenalineInsufficientShot: () => this.playerStatusRing?.notifyAdrenalineInsufficientShot(),
          flashUltimateInsufficientRage: () => this.ctx.centerHUD.flashUltimateInsufficientRage(),
          flashUtilityCooldown: (fraction, displayName) => this.ctx.centerHUD.flashUtilityCooldown(fraction, displayName),
          showPlacementError: (message) => this.aimPresentation?.showPlacementError(message),
        },
      },
      onFlowFieldDebugHotkey: (type: ArenaInputDebugHotkey) => this.handleFlowFieldDebugHotkey(type),
      hotkeys: {
        getGamePhase: () => bridge.getGamePhase(),
        isMatchTerminated: () => this.arenaRuntime.isMatchTerminated(),
        isCoopDefenseMode: () => isCoopDefenseMode(bridge.getGameMode()),
        canLeaveLocalLobbyWorld: () => this.canLeaveLocalLobbyWorld(),
        requestLocalLobbyWorldLeave: () => this.requestLocalLobbyWorldLeave(),
        isHotkeyInputBlocked: () => (this.afterRoundTransition?.active || this.ctx.leftPanel.isHotkeyInputBlocked() || this.lobbyOverlay.isHotkeyInputBlocked() || this.lobbyOverlay.isMerchantOpen()),
        isHelpOverlayOpen: () => this.ctx.leftPanel.isHelpOverlayOpen(),
        hideHelpOverlay: () => this.ctx.leftPanel.hideHelpOverlay(),
        isOptionsOverlayOpen: () => this.ctx.leftPanel.isOptionsOverlayOpen(),
        hideOptionsOverlay: () => this.ctx.leftPanel.hideOptionsOverlay(),
        toggleOptionsOverlay: () => this.ctx.leftPanel.toggleOptionsOverlay(),
        isCoopDefenseUpgradesOpen: () => this.coopDefenseUpgradesOverlay?.isOpen() ?? false,
        hideCoopDefenseUpgrades: () => this.coopDefenseUpgradesOverlay?.closeWithCancel(),
        isCoopDefenseDebugOpen: () => this.coopDefenseDebugOverlay?.isOpen() ?? false,
        hideCoopDefenseDebug: () => this.coopDefenseDebugOverlay?.hide(),
        toggleCoopDefenseDebug: () => this.coopDefenseDebugOverlay?.toggle(),
        isItemsOpen: () => this.itemsOverlay?.isOpen() ?? false,
        hideItems: () => this.itemsOverlay?.hide(),
        isItemRewardVisible: () => this.itemRewardOverlay?.isVisible() ?? false,
        hideItemReward: () => this.itemRewardOverlay?.dismiss(),
        isMatchResultsVisible: () => this.matchResultsOverlay?.isVisible() ?? false,
        hideMatchResults: () => this.matchResultsOverlay?.continueToLobby(),
        isRoomStatisticsVisible: () => this.roomStatisticsOverlay?.isVisible() ?? false,
        hideRoomStatistics: () => this.roomStatisticsOverlay?.hide(),
        isWeaponBalanceLabOpen: () => this.weaponBalanceLabOverlay?.isOpen() ?? false,
        hideWeaponBalanceLab: () => this.weaponBalanceLabOverlay?.hide(),
        toggleWeaponBalanceLab: () => this.weaponBalanceLabOverlay?.toggle(),
        isNetDebugOpen: () => this.diagnostics?.isNetDebugOpen() ?? false,
        hideNetDebug: () => this.diagnostics?.hideNetDebug(),
        toggleNetDebug: () => this.diagnostics?.toggleNetDebug(),
        isPerformanceOverlayOpen: () => this.diagnostics?.isPerformanceOverlayOpen() ?? false,
        hidePerformanceOverlay: () => this.diagnostics?.hidePerformanceOverlay(),
        togglePerformanceOverlay: () => this.diagnostics?.togglePerformanceOverlay(),
        isTimeOfDayDebugOpen: () => this.timeOfDayDebugOverlay?.isOpen() ?? false,
        hideTimeOfDayDebug: () => this.timeOfDayDebugOverlay?.hide(),
        toggleTimeOfDayDebug: () => this.timeOfDayDebugOverlay?.toggle(),
      },
    });
    this.inputBindings = inputBindings;
    inputBindings.setup();
    onBootSceneTeardown(this.events, () => {
      inputBindings.destroy();
      if (this.inputBindings === inputBindings) this.inputBindings = null;
    });
    bridge.sendPingToHost();
    this.time.addEvent({ delay: 1000, callback: () => bridge.sendPingToHost(), loop: true });
    this.initializeRoomQuality();
    this.meta?.refresh();
    this.meta?.applyDefaultCoopDefenseMapSelection();
    this.lastObservedGamePhase = bridge.getGamePhase();

    // No World (and therefore no fog or material consumer) exists before this Scene resumes.
    // Wait for the driver without blocking the page, then finish the links without waiting.
    while (!this.isFogShaderWarmupReady()) yield waitStep('fog-shader-wait');
    this.completeFogShaderWarmup();
    yield 'fog-shader-ready';

    // Erst nach dem Rendern pruefen: auch UI, Kamera und die in diesem Frame gebackenen
    // Flaechen muessen bereits im fertigen Bild stehen, bevor der Bootscreen weicht.
    this.game.events.on(Phaser.Core.Events.POST_RENDER, this.syncBootReveal, this);
    onBootSceneTeardown(this.events, () => {
      this.game.events.off(Phaser.Core.Events.POST_RENDER, this.syncBootReveal, this);
      BootScreen.dismissImmediate();
    });
  }

  update(_time: number, delta: number): void {
    if (!this.initializationReady) return;
    this.ctx?.voice?.update();
    const companionDiagnosticsActive = this.diagnostics?.isDiagnosticsActive() ?? false;
    const diagnosticsFrame: ArenaDiagnosticsFrame | null = this.diagnostics?.beginFrame() ?? null;
    // Vor allem anderen, damit die Diagnose-Zaehlungen weiter unten den abgeschalteten
    // Zustand sehen und nicht den des Vorframes.
    if (companionDiagnosticsActive) this.diagnostics?.updateAblation();
    diagnosticsFrame?.mark('networkStart');
    diagnosticsFrame?.begin('networkUpdate');
    bridge.updateNetwork();
    diagnosticsFrame?.end('networkUpdate');
    diagnosticsFrame?.mark('networkEnd');

    // A prepared Bauhof stage never lives on into the build of a round's World.
    if (this.arenaRuntime.isArenaEntryProtected()) this.baseEditorPreparation.release();
    this.arenaRuntime.syncArenaEntryTransition();

    const phase = bridge.getGamePhase();
    const rewardRoundState = bridge.getRoundState();
    if (phase === 'ARENA' && rewardRoundState?.status === 'active') {
      this.meta?.captureRoundRewardBaseline(rewardRoundState.roundStartTime);
    }
    const deferArenaExit = this.weaponBalanceLabPreviousMapId === null
      && this.syncArenaExitFade(phase);
    this.arenaRuntime.detectPhaseChange(deferArenaExit);
    if (this.arenaRuntime.isArenaEntryProtected()) {
      this.updateProtectedArenaEntry(delta);
      return;
    }
    // Auch spaete Netzwerk-Deskriptoren duerfen waehrend des Fades weder Membership
    // noch Activity, Kamera oder Beleuchtung auf den Lobbyzustand umstellen.
    if (deferArenaExit) {
      this.inputBindings?.updateFrame({
        enabled: false, gameplayActive: false, countdownActive: false,
        uiBlocking: true, diagnosticsArena: false,
      });
      this.renderers.gpuVfx.update(delta);
      return;
    }
    if (!deferArenaExit) this.arenaRuntime.hostSyncLobbyWorld();
    // Jeder Peer bietet seinen persoenlichen Basisbeitrag an und uebernimmt, was der Host ihm
    // bestaetigt hat. Beides haengt am Raum, nicht an Phase oder Runde.
    this.arenaRuntime.syncRoomOwners();
    this.arenaRuntime.detectWorldChange(deferArenaExit);
    if (this.arenaRuntime.isArenaEntryProtected()) {
      this.updateProtectedArenaEntry(delta);
      return;
    }
    // Erst steht fest, welche World lokal laeuft - dann taktet ihre Runtime. Sie taktet nur die
    // eigenen Child-Owner; Rundenphase und Rolle entscheiden darueber nichts.
    this.arenaRuntime.update(delta);
    if (!deferArenaExit && phase === 'LOBBY') this.arenaExitFadeOverlay?.hide();

    const frame = this.resolveArenaFrameSignals(phase, deferArenaExit);
    const {
      configuredGameMode,
      configuredCoopDefenseMapConfig,
      enteredLobbyFromArena,
      returningFromWeaponBalanceLab,
      inGame,
      arenaLoading,
      countdownActive,
      terminated,
      gameplayActive,
      weaponBalanceLabArena,
      optionsOpen,
      spectator,
      worldActive,
      activityActive,
      localWorldPresentation,
      presentationPolicy,
    } = frame;

    // Loading work must run under the veil: visibility itself waits for the ready barrier.
    // The same prepared camera view defines both startup residency and the subsequent reveal.
    const prepareWorldSurfaces = presentationPolicy.showWorld
      || (arenaLoading && worldActive && localWorldPresentation.required && !terminated);
    this.arenaRuntime.presentation.syncWorldCamera(delta, prepareWorldSurfaces);
    this.devScenario?.syncCamera();
    // Direkt nach der Kamera und vor allem Weiteren: Die gestreamten Bodenbaender und
    // Fels-Overlays halten nur Renderziele um den sichtbaren Ausschnitt herum. Der
    // Sicherheitsrand deckt den Kamera-Feedback-Versatz mit ab, der erst am Frame-Ende
    // dazukommt.
    if (prepareWorldSurfaces) {
      this.arenaRuntime.presentation.syncWorldSurfaceResidency(prepareWorldSurfaces, delta);
    }
    // Der Owner loest die zentrale Policy auf und taktet den vorhandenen InputSystem; die Scene
    // liefert nur den bereits orchestrierten World-/Round-/UI-Framekontext.
    this.inputBindings?.updateFrame({
      enabled: worldActive && localWorldPresentation.required,
      gameplayActive: worldActive && (!activityActive || gameplayActive),
      countdownActive,
      uiBlocking: optionsOpen,
      diagnosticsArena: weaponBalanceLabArena || (isDevScenarioMode() && !this.devScenario?.humanInput) || (__PERFORMANCE_LAB__
        && (!!window.__FD_PERF_REQUEST__ || this.networkProbe)),
    });
    if (worldActive && localWorldPresentation.required && countdownActive) {
      this.syncCountdownPlayerPresentation();
    }
    diagnosticsFrame?.mark('inputEnd');
    if (__PERFORMANCE_LAB__) updatePerformanceLab();
    this.devScenario?.update();

    this.syncArenaLobbyFrame(
      phase,
      deferArenaExit,
      terminated,
      presentationPolicy,
      enteredLobbyFromArena,
      returningFromWeaponBalanceLab,
      diagnosticsFrame,
    );
    // hostCheckReadyToStart can start the exit inside the lobby frame above.
    if (this.arenaRuntime.isArenaEntryProtected()) {
      this.updateProtectedArenaEntry(delta);
      return;
    }

    if (!deferArenaExit) this.lastObservedGamePhase = phase;
    diagnosticsFrame?.mark('sceneStateEnd');

    // Same-Mode-Live-Builds bleiben in derselben LobbyWorld reconciled. Ein vollstaendiger
    // GameMode-Wechsel wurde davor bereits als neue World-Instanz orchestriert.
    if (worldActive && bridge.isHost() && !terminated) {
      this.arenaRuntime.syncHostLoadoutsFromCommittedSelections();
    }

    this.runArenaWorldWithoutActivityFrame(
      worldActive,
      activityActive,
      terminated,
      delta,
      diagnosticsFrame,
    );

    this.runArenaRoleFrame(
      delta,
      phase,
      configuredGameMode,
      configuredCoopDefenseMapConfig,
      gameplayActive,
      countdownActive,
      terminated,
      diagnosticsFrame,
    );

    this.devScenario?.afterHostFrame();

    // Baumkronen haengen an der Darstellung, nicht an der Runde: der Abgleich ist rein lokal und
    // kennt weder Activity noch Rundenphase. Deshalb blenden sie ueber der eigenen Figur auch in
    // der LobbyWorld aus. Ohne eigene Figur - reine Preview - bleiben sie deckend.
    if (prepareWorldSurfaces) {
      diagnosticsFrame?.begin('leaderboardCanopy');
      this.arenaRuntime.presentation.syncWorldCanopy(prepareWorldSurfaces);
      diagnosticsFrame?.end('leaderboardCanopy');
    }

    diagnosticsFrame?.begin('arenaPanel');
    this.syncArenaPanelOverlayState(gameplayActive && !terminated);
    diagnosticsFrame?.end('arenaPanel');

    diagnosticsFrame?.mark('visualStart');
    if (companionDiagnosticsActive) this.diagnostics?.markVisualStart();

    // ── Per-frame visuals (always) ─────────────────────────────────────────
    // Der GPU-Partikel-Tick haengt bewusst nicht am Zustands-Sync: auf Clients laufen die
    // Renderer-Syncs nur mit frischem Netzzustand, die bisherigen Emitter liefen dagegen
    // autonom weiter. Erst stilllegen, dann emittieren – die Registry garantiert die Reihenfolge.
    this.combatPresentation?.prepareEnemyVisuals(delta, diagnosticsFrame);
    this.renderers.movement.captureFrame(
      delta, presentationPolicy.showWorld,
      presentationPolicy.showWorld ? this.ctx.playerManager.getAllPlayers() : [],
      presentationPolicy.showWorld ? this.arenaRuntime.getMovementEnemyVisuals() : [],
      getVisibleWorldView(this.cameras.main),
    );
    this.visualFeedback?.weaponFire.update();
    // Publish World layers behind the opaque entry veil too. Visibility must not be a
    // prerequisite for the same final render release that permits the veil to fade.
    this.arenaRuntime.presentation.syncConstructionOwnership(prepareWorldSurfaces);
    this.arenaRuntime.presentation.syncGroundFog(delta, prepareWorldSurfaces);
    this.renderers.gpuVfx.update(delta);
    const inArena = presentationPolicy.showWorld;
    // Eine Preview zeigt die Welt, ohne dass dieser Peer in ihr steht. Zielhilfe, Systemcursor
    // und Platzierungsvorschau gehoeren deshalb der interaktiven Darstellung, nicht der blossen
    // Sichtbarkeit.
    const worldInteractive = presentationPolicy.worldMode === 'interactive';
    // AK-Zielhilfe gehoert zur interaktiven World, auch ohne laufende Mission im Schiessstand.
    this.combatPresentation?.syncStrategicTargets(presentationPolicy.worldMode);
    // Und Rundenpraesentation - Missionsansagen, Encounter, Zug - haengt
    // zusaetzlich an der Activity: interaktiv zu spielen heisst nicht, dass eine Runde laeuft.
    const inRoundWorld = worldInteractive && activityActive;
    // Beim Spectator ist die Kamera bereits vor dem Netzwerk-/Render-Schritt fortgeschrieben;
    // der zweite normale Sync-Punkt darf die A/D-Geschwindigkeit nicht verdoppeln.
    // Keep the camera active while the arena is hidden behind the loading veil. Its position is
    // part of the local startup working set and must not be reset to the lobby origin before the
    // readiness check at the end of the frame.
    this.arenaRuntime.presentation.syncWorldCamera(spectator ? 0 : delta, prepareWorldSurfaces);
    this.devScenario?.syncCamera();
    const coopDefensePresentationActive = inRoundWorld && isCoopDefenseMode(configuredGameMode);
    this.arenaRuntime.presentation.syncCoopMissionPresentation(delta, coopDefensePresentationActive);
    this.syncSpectatorPlayerNames(inArena);
    this.arenaRuntime.presentation.syncWorldLocalPlayerPresentation(inArena, spectator);
    if (inArena) {
      this.enemyHoverNameLabel?.sync(this.getEnemyHoverNameTarget());
    } else {
      this.enemyHoverNameLabel?.clear(true);
    }
    // Loading uses the full-screen veil even though the arena itself is still hidden; once the
    // authoritative countdown timestamp exists, the same overlay switches to 3 → 2 → 1.
    this.syncArenaFogOverlay(bridge.getSynchronizedNow(), inGame && !terminated, countdownActive);
    diagnosticsFrame?.mark('visualCameraEnd');

    this.combatPresentation?.sync({ inArena, delta }, diagnosticsFrame);
    this.renderers.turretAnimations.syncControl(
      bridge.getConnectedPlayers().flatMap(profile => {
        const state = bridge.isHost() ? this.arenaRuntime.getTurretControlState(profile.id)
          : bridge.getLatestGameState()?.players[profile.id]?.turretControl;
        return state ? [{ id: String(state.turretId), color: profile.colorHex }] : [];
      }),
    );
    this.renderers.interactions.sync(this.ctx.inputSystem.getInteractionView(),
      this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject);

    const {
      showAim,
      scopeProgress,
      utilityPlacementActive,
      ultimatePlacementActive,
    } = this.aimPresentation?.sync({
      inArena,
      worldInteractive,
      spectator,
      optionsOpen,
      delta,
      now: this.time.now,
      localPlayerAlive: this.localPlayerState.alive,
      localPlayerBurrowed: this.localPlayerState.burrowed,
      scopeCursorX: toDesignSpace(this.scale, this.input.activePointer.x),
      scopeCursorY: toDesignSpace(this.scale, this.input.activePointer.y),
    }, diagnosticsFrame) ?? {
      showAim: false,
      scopeProgress: 0,
      utilityPlacementActive: false,
      ultimatePlacementActive: false,
    };

    // Letzter Schritt vor Schatten, Licht und Rendering – alles davor rechnet mit der
    // unversetzten Kameraposition (siehe `applyCameraFeedback`).
    this.applyCameraFeedback(delta);
    // Das Tutorial ist ein Weltobjekt: Seine Occlusion-Probe braucht deshalb den finalen
    // Scroll-/Shake-Versatz, den auch der anschließende Render-Schritt verwendet.
    const reservedHudRects = [
      ...this.ctx.leftPanel.getReservedHudRects(),
      ...this.ctx.rightPanel.getReservedHudRects(),
      ...this.ctx.centerHUD.getReservedHudRects(true),
      ...(this.dawnHUD?.getReservedHudRects() ?? []),
      ...this.coopMissionPresentation.getReservedHudRects(),
    ];
    this.ctx.centerHUD.updateTutorialOcclusion(delta, [
      ...this.ctx.centerHUD.getReservedHudRects(), ...(this.dawnHUD?.getReservedHudRects() ?? []),
      ...this.coopMissionPresentation.getReservedHudRects(),
    ]);
    const markerCamera = createMarkerCameraTransform(this.cameras.main, getRenderScale(this.scale));
    const markerPlayer = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId());
    this.renderers.markers.update({ camera: markerCamera,
      localPlayer: markerPlayer ? { x: markerPlayer.x, y: markerPlayer.y } : { x: markerCamera.worldView.centerX, y: markerCamera.worldView.centerY },
      reservedHudRects, nowMs: this.time.now, lowQuality: getGraphicsQualityProfile(this).level === 'low' });
    // Der Fokus wird erst nach dem finalen Scroll-/Shake-Versatz in Bildschirmkoordinaten
    // übersetzt, damit Radialfilter und Low-Fallback denselben Frame wie die Welt sehen.
    this.ctx.arenaCountdown?.syncAfterCameraFeedback();

    diagnosticsFrame?.begin('shadow');
    // Keep World-scoped static shadows alive while the arena is hidden behind the loading veil;
    // clearing them here would destroy the startup surface before the load barrier can observe it.
    const shadowArenaActive = inArena || (inGame && !terminated);
    this.arenaRuntime.presentation.syncWorldShadows(shadowArenaActive, inRoundWorld);
    diagnosticsFrame?.end('shadow');
    this.arenaRuntime.presentation.syncWorldLighting(prepareWorldSurfaces, inRoundWorld);

    // Erst jetzt, nachdem alle drei Schichten und moegliche Dirty-Wellen des Frames ihre Arbeit
    // eingereiht haben: ein gemeinsames kleines Budget statt eines separaten Vollbakes je Layer.
    // Das grosszuegige Budget gilt, solange ein deckender Ladescreen davor steht - in der Arena
    // ihr eigener Schleier, beim Start der Bootscreen.
    ChunkedRenderSurface.flushBakeBudget(
      this,
      arenaLoading || this.bootRevealPending ? CHUNK_BAKE_STARTUP_FRAME_BUDGET_MS : undefined,
    );
    if (inGame && !terminated) {
      this.arenaRuntime.syncArenaLoadReady(getVisibleWorldView(this.cameras.main));
    }
    // Ganz am Frame-Ende: alle im Frame gesammelten ersetzbaren Zustaende (Snapshot, Input,
    // Ping) gehen gebuendelt raus, statt erst im naechsten Frame.
    diagnosticsFrame?.begin('networkFlush');
    bridge.flushNetwork();
    diagnosticsFrame?.end('networkFlush');
    diagnosticsFrame?.mark('updateEnd');

    if (companionDiagnosticsActive || diagnosticsFrame) {
      const runtimePhase = terminated ? 'terminated' : (inGame ? 'arena' : 'lobby');
      const diagnosticMode = diagnosticsFrame
        ? configuredGameMode
        : this.resolveConfiguredGameMode(phase === 'ARENA' ? 'ARENA' : 'LOBBY');
      const diagnosticMapId = diagnosticsFrame
        ? configuredCoopDefenseMapConfig?.mapId ?? null
        : isCoopDefenseMode(diagnosticMode)
          ? this.resolveConfiguredCoopDefenseMapConfig(phase)?.mapId ?? null
          : null;
      const diagnosticsInput: ArenaDiagnosticsFrameInput = {
        phase: runtimePhase,
        mode: diagnosticMode,
        mapId: diagnosticMapId,
        rawDeltaMs: this.game.loop.rawDelta,
        deltaMs: delta,
        localAlive: this.localPlayerState.alive,
        aimVisible: showAim,
        scopeActive: scopeProgress > 0.005,
        utilityPlacementActive,
        ultimatePlacementActive,
        optionsOpen,
        enemyCount: this.combatPresentation?.getEnemyCount() ?? 0,
        projectileCount: this.arenaRuntime?.getWorldProjectileRuntime()?.getDebugActiveProjectileCount() ?? 0,
        playerCount: this.ctx.playerManager.getAllPlayers().length,
      };
      this.diagnostics?.endFrame(diagnosticsInput);
    }
  }

  /** Keep the last Lobby frame intact while Phaser's independent UI tweens keep ticking. */
  private updateProtectedArenaEntry(delta: number): void {
    this.inputBindings?.updateFrame({
      enabled: false, gameplayActive: false, countdownActive: false,
      uiBlocking: true, diagnosticsArena: false,
    });
    this.ctx.arenaCountdown?.updateLoadingScreen(this.getArenaLoadingScreenState());
    this.renderers.gpuVfx.update(delta);
    ChunkedRenderSurface.flushBakeBudget(this);
    bridge.flushNetwork();
    this.lastObservedGamePhase = bridge.getGamePhase();
  }

  private resolveArenaFrameSignals(
    phase: GamePhase,
    deferArenaExit: boolean,
  ): ArenaFrameSignals {
    const configuredPhase = deferArenaExit ? 'ARENA' : phase;
    const configuredGameMode = this.resolveConfiguredGameMode(configuredPhase);
    const configuredCoopDefenseMapConfig = isCoopDefenseMode(configuredGameMode)
      ? this.resolveConfiguredCoopDefenseMapConfig(configuredPhase)
      : null;
    const enteredLobbyFromArena = !deferArenaExit
      && this.lastObservedGamePhase === 'ARENA'
      && phase === 'LOBBY';
    const returningFromWeaponBalanceLab = enteredLobbyFromArena
      && this.weaponBalanceLabPreviousMapId !== null;
    if (returningFromWeaponBalanceLab) this.restoreMapAfterWeaponBalanceLab();

    const inGame = phase === 'ARENA';
    const arenaLoading = bridge.isArenaLoading() || this.arenaRuntime.isArenaEntryLoading();
    const arenaVisible = bridge.isArenaCountdownVisible() || deferArenaExit;
    const countdownActive = bridge.isArenaCountdownActive();
    const terminated = this.arenaRuntime.isMatchTerminated();
    const gameplayActive = inGame && bridge.isArenaStarted() && !terminated;
    const weaponBalanceLabArena = inGame
      && configuredCoopDefenseMapConfig !== null
      && isWeaponBalanceLabMapId(configuredCoopDefenseMapConfig.mapId);
    if (phase !== 'LOBBY' || terminated || !isCoopDefenseMode(configuredGameMode)) {
      this.closeBaseEditor(false); this.baseEditorPreparation.release(); this.meta?.cancelAfterRoundFlow();
    }
    const optionsOpen = this.isWorldMenuBlocking();

    // Teilnahme haengt an der World, nicht an der Rundenphase - deshalb steht der Abgleich
    // ausdruecklich vor und unabhaengig von der Rundenrolle. Ohne Activity taktet niemand den
    // Eintritt: dort folgt die Runtime unmittelbar der Aufnahme.
    this.arenaRuntime.hostSyncWorldMembers();
    this.arenaRuntime.hostSyncWorldParticipation();
    this.arenaRuntime.syncRoundParticipation();
    const spectator = inGame && (this.localPlayerState.spectator || bridge.isLocalSpectator());
    const worldActive = this.arenaRuntime.isWorldActive();
    const activityActive = bridge.getActivityDescriptor() !== null;
    const exitPresentationActive = deferArenaExit && this.arenaRuntime.isArenaExitPresentationActive();
    const localWorldPresentation = this.arenaRuntime.getLocalWorldPresentation();
    const presentationPolicy = resolvePresentationPolicy({
      inLobby: phase === 'LOBBY' && !deferArenaExit,
      worldPresentation: localWorldPresentation,
      worldVisible: exitPresentationActive || (worldActive && (!activityActive || arenaVisible)),
      gameplayActive: worldActive && (!activityActive || gameplayActive),
      roundRole: spectator ? 'spectator' : 'participant',
      matchTerminated: terminated,
      spectatorPanAvailable: true,
    });
    this.syncArenaMetrics(configuredPhase, presentationPolicy.showWorld);

    if (phase === 'LOBBY' && !deferArenaExit) {
      this.clearDebugModes();
      if (!isCoopDefenseMode(bridge.getGameMode())) {
        this.coopDefenseDebugOverlay?.hide();
        this.coopDefenseUpgradesOverlay?.hide();
      }
    } else {
      this.coopDefenseDebugOverlay?.hide();
      this.coopDefenseUpgradesOverlay?.hide();
    }

    // Initial player placement is a round-build step, not simulation. Keep it before the camera
    // so the same prepared spawn defines the startup working set that the load barrier waits for.
    if (inGame && !terminated && !spectator) {
      if (bridge.isHost()) {
        // Initial spawn is part of the hidden local build. It must happen before the first
        // residency check so the startup working set follows the actual local player focus.
        this.arenaRuntime.spawnReadyPlayers();
        this.localPlayerState.alive = this.ctx.getWorldCombatCore()!.isAlive(bridge.getLocalPlayerId());
      } else if (arenaLoading || countdownActive) {
        // The client receives the first authoritative alive bit with the first post-start
        // snapshot; the local prepared entity is nevertheless a valid camera focus meanwhile.
        this.localPlayerState.alive = true;
      }
    }

    return {
      configuredGameMode,
      configuredCoopDefenseMapConfig,
      enteredLobbyFromArena,
      returningFromWeaponBalanceLab,
      inGame,
      arenaLoading,
      countdownActive,
      terminated,
      gameplayActive,
      weaponBalanceLabArena,
      optionsOpen,
      spectator,
      worldActive,
      activityActive,
      localWorldPresentation,
      presentationPolicy,
    };
  }

  private syncArenaLobbyFrame(
    phase: GamePhase,
    deferArenaExit: boolean,
    terminated: boolean,
    presentationPolicy: ReturnType<typeof resolvePresentationPolicy>,
    enteredLobbyFromArena: boolean,
    returningFromWeaponBalanceLab: boolean,
    diagnosticsFrame: ArenaDiagnosticsFrame | null,
  ): void {
    // The next round's terrain is generated in the lobby; an open base editor follows the host's map.
    this.deploymentTerrain.prefetch();
    this.followBaseEditorDeployment();
    this.tickBaseEditorPreparation();
    this.prepareRoundEndOverlays();
    this.measureBaseEditorFrame();
    this.matchResultsOverlay?.refreshRestartState();
    if (phase !== 'LOBBY' || deferArenaExit) this.roomStatisticsOverlay?.hide();
    // Weltlicht der Lobby haengt an der Raumphase, nicht an der Oberflaeche: wer das
    // Testgelaende betritt, sieht dieselbe host-autoritative Uhrzeit wie alle anderen.
    if (!terminated && phase === 'LOBBY' && !deferArenaExit) this.arenaRuntime.syncLobbyTimeOfDay();
    // Die Oberflaeche folgt der Presentation. Ein technischer Abbruch fuehrt sie selbst zurueck
    // und darf hier nicht ueberschrieben werden.
    if (!terminated) this.arenaRuntime.syncLobbySurface(presentationPolicy.showLobby);
    // Der Live-Build bleibt auch im interaktiven Testgelaende sichtbar. Er ist absichtlich kein
    // Ready-Commit und wird deshalb unabhaengig davon pro Lobby-Frame publiziert.
    if (!terminated && phase === 'LOBBY' && !deferArenaExit) {
      bridge.setLocalLobbyLoadoutPreview(this.buildLocalLobbyLoadoutPreview());
    }
    this.lobbyOverlay.setWorldEntryState(
      this.arenaRuntime.canSelfAdmitToWorld()
        ? {
          inside: this.arenaRuntime.isLocalWorldParticipant(),
          canEnter: bridge.getPlayerReady(bridge.getLocalPlayerId()) === false,
        }
        : null,
    );
    if (!terminated && presentationPolicy.showLobby) {
      diagnosticsFrame?.begin('lobbyUi');
      if (enteredLobbyFromArena && !returningFromWeaponBalanceLab && !this.arenaExitResultsStarted) {
        this.meta?.beginMatchResults();
      }
      if (this.meta?.isMatchResultsPending()) {
        this.meta.tryFinalizeMatchResults({
          finalizeBalanceRound: (roundEndedAt, roundIdentity) => {
            this.coopDefenseBalanceTracker.finalizePendingRound(roundEndedAt, roundIdentity);
            return this.coopDefenseBalanceTracker.hasRound(roundEndedAt, roundIdentity);
          },
        });
      }
      const players = bridge.getConnectedPlayers();
      // Lokalen Ready-Stand an den autoritativen Netzwerkwert angleichen. Setzt der Host beim
      // Rundenwechsel (oder bei Modus-/Map-Wechsel) den Spieler auf "nicht bereit", folgt hier sowohl
      // das interne Flag als auch der Button – so ist der Client-Zustandsspeicher garantiert konsistent.
      const localReady = bridge.getPlayerReady(bridge.getLocalPlayerId());
      if (localReady !== this.arenaRuntime.getIsLocalReady()) {
        this.arenaRuntime.setIsLocalReady(localReady);
        this.lobbyOverlay.setReadyButtonState(localReady);
      }
      this.updateRoomQuality(this.time.now, players);
      this.lobbyOverlay.setRoomQuality(this.roomQualitySnapshot, bridge.isHost());
      this.lobbyOverlay.setTransportDiagnostics(bridge.getWorstTransportDiagnostics());
      this.lobbyOverlay.refreshPlayerList(players);
      this.meta?.refreshLobbyProjection();
      const baseRewardState = getStoredPersistentBaseRewardState();
      this.lobbyOverlay.setBaseState(getStoredPersistentBaseUnlocked(),
        getStoredPersistentBaseRewardUnlocks().filter(id => !baseRewardState.placements.some(p => p.rewardId === id)).length);
      this.lobbyOverlay.setBasePreparing(this.baseEditorPreparation.isPreparing());
      const localProfile = players.find(p => p.id === bridge.getLocalPlayerId());
      const localId = bridge.getLocalPlayerId();
      const sidebarSignature = [
        localProfile?.name ?? '',
        localProfile?.colorHex ?? '',
        localProfile?.teamId ?? '',
        bridge.isHost(),
        bridge.getGameMode(),
        bridge.getCoopDefenseMapId(),
        bridge.getPlayerLoadoutSlot(localId, 'weapon1') ?? '',
        bridge.getPlayerLoadoutSlot(localId, 'weapon2') ?? '',
        bridge.getPlayerLoadoutSlot(localId, 'utility') ?? '',
        bridge.getPlayerLoadoutSlot(localId, 'ultimate') ?? '',
      ].join('|');
      if (sidebarSignature !== this.lastLobbySidebarSignature) {
        this.lastLobbySidebarSignature = sidebarSignature;
        if (localProfile) this.ctx.leftPanel.updateLocalName(localProfile.name);
        this.ctx.leftPanel.refreshColorIndicator();
      }
      this.ctx.leftPanel.refreshColorPickerIfOpen();
      this.ctx.leftPanel.updateLobby();
      if (bridge.isHost()) this.arenaRuntime.hostCheckReadyToStart();
      diagnosticsFrame?.end('lobbyUi');
    } else if (!terminated && phase === 'LOBBY' && !deferArenaExit) {
      // World participation hides the lobby cards, but personal menus still belong
      // to this Lobby phase. Keep their progress and readiness current while walking.
      const localReady = bridge.getPlayerReady(bridge.getLocalPlayerId());
      if (localReady !== this.arenaRuntime.getIsLocalReady()) {
        this.arenaRuntime.setIsLocalReady(localReady);
        this.lobbyOverlay.setReadyButtonState(localReady);
      }
      this.meta?.refreshLobbyProjection();
      this.lastLobbySidebarSignature = null;
    } else {
      this.coopDefenseDebugOverlay?.hide();
      this.coopDefenseUpgradesOverlay?.hide();
      this.meta?.refreshLobbyProjection(false);
      this.lastLobbySidebarSignature = null;
    }
  }

  private runArenaRoleFrame(
    delta: number,
    phase: GamePhase,
    configuredGameMode: GameMode,
    configuredCoopDefenseMapConfig: CoopDefenseMapConfig | null,
    gameplayActive: boolean,
    countdownActive: boolean,
    terminated: boolean,
    diagnosticsFrame: ArenaDiagnosticsFrame | null,
  ): void {
    this.coopMissionPresentation?.syncDawnSites(
      this.arenaRuntime?.getWorldDescriptor() ?? null,
      this.arenaRuntime?.getActivityDescriptor() ?? null,
      bridge.getCoopDefenseSecondaryObjectivePresentationState(),
    );
    this.dawnHUD?.sync({
      active: gameplayActive && !terminated,
      world: bridge.getWorldDescriptor(), activity: bridge.getActivityDescriptor(),
      startTime: bridge.getArenaStartTime(), now: this.arenaRuntime.getMissionNow(),
      sharedScrap: bridge.getDawnRoundScrap(),
      objectives: bridge.getCoopDefenseSecondaryObjectivePresentationState(),
      encounters: configuredCoopDefenseMapConfig?.encounters,
    });
    this.renderers?.markers?.coop?.set('dawn', this.dawnHUD?.getMarkerDescriptors() ?? [], this.time.now);
    this.syncBomberRuns(gameplayActive && !terminated ? configuredCoopDefenseMapConfig : null);
    if ((gameplayActive || countdownActive) && !terminated) {
      diagnosticsFrame?.begin('arenaHud');
      const secs = bridge.computeSecondsLeft(this.arenaRuntime.getMissionNow());
      const activeMapConfig = configuredCoopDefenseMapConfig;
      const dawnClockActive = !!bridge.getActivityDescriptor()?.parameters?.dawn;
      this.ctx.centerHUD.setDawnClockVisible(dawnClockActive);
      this.ctx.centerHUD.updateTimer(
        secs,
        !dawnClockActive && (activeMapConfig === null || getCoopMissionTimeLimitSec(activeMapConfig) !== null),
      );

      // Train widget: Das Zug-Event selbst entscheidet, ob etwas anzuzeigen ist – Maps mit
      // Gleisen ohne Zug und Runden ohne weitere Einfahrt haben schlicht kein Event.
      const trainEvent = bridge.getTrainEvent();
      if (!trainEvent) {
        this.ctx.centerHUD.hideTrainWidget();
      } else if (!this.arenaRuntime.isTrainDestroyedShown()) {
        const trainState = bridge.getLatestGameState()?.train ?? null;
        if (trainState?.alive) {
          this.ctx.centerHUD.updateTrainHP(trainState.hp, trainState.maxHp);
        } else {
          // Echte Restzeit bis zur Einfahrt; der Rundentimer spielt dabei keine Rolle.
          const arrivalSecs = getTrainArrivalCountdownSecs(trainEvent.spawnAt, bridge.getSynchronizedNow());
          if (arrivalSecs !== null) this.ctx.centerHUD.setTrainArrival(arrivalSecs);
        }
      }
      diagnosticsFrame?.end('arenaHud');

      if (bridge.isHost()) {
        diagnosticsFrame?.begin('primaryStep');
        this.weaponBalanceLabRuntime.update(phase, gameplayActive, delta);
        if (isCoopDefenseMode(configuredGameMode)
          && this.inputBindings?.isCoopDefenseDebugDamageJustDown()
          && !(this.ctx.leftPanel.isHotkeyInputBlocked() || this.lobbyOverlay.isHotkeyInputBlocked())
          && !countdownActive) {
          this.arenaRuntime.applyDebugBaseDamage(50);
        }
        const coopRoundOutcome = this.arenaRuntime.runHostFrame(delta, gameplayActive);
        if (coopRoundOutcome) {
          // Die Momentaufnahme der Runde entsteht vor ihrem Abschluss: `hostCompleteRound()`
          // verbucht den Endstand noch vor dem spaeteren World-Abbau.
          this.prepareCoopDefenseBalanceRound(coopRoundOutcome);
          this.arenaRuntime.hostCompleteRound(coopRoundOutcome);
        } else if (!isCoopDefenseMode(configuredGameMode) && !countdownActive && secs <= 0) {
          this.arenaRuntime.hostCompleteRound();
        }
        diagnosticsFrame?.end('primaryStep');
      } else {
        diagnosticsFrame?.begin('primaryStep');
        this.arenaRuntime.runClientFrame(delta);

        // Sync renderers that HostUpdateCoordinator handles for host but client needs too
        diagnosticsFrame?.begin('clientRendererSync');
        const clientState = bridge.getLatestGameState();
        if (clientState) {
          this.captureTheBeerPresentation.syncClient(
            clientState.captureTheBeer ?? null,
            this.arenaRuntime.getLocalWorldPresentation().required,
          );
        }
        this.arenaRuntime.presentation.syncWorldClientPresentation(
          clientState,
          delta,
          countdownActive,
          countdownActive && activeMapConfig
            ? buildCountdownGroundFirePreview(
              this.arenaRuntime?.getWorldLayout() ?? null,
              activeMapConfig,
              bridge.getArenaStartTime(),
            )
            : { cells: [] },
          this.arenaRuntime?.getPowerUpPedestalSnapshot() ?? [],
        );
        diagnosticsFrame?.end('clientRendererSync');
        diagnosticsFrame?.end('primaryStep');
      }

      const transitionCompleted = this.arenaRuntime.syncRuntimeTimeOfDay(
        bridge.getSynchronizedNow(),
        this.resolveArenaTimeOfDaySignals(),
      );
      this.arenaRuntime.presentation.requestWorldStaticShadowBake(transitionCompleted);

      diagnosticsFrame?.begin('leaderboardCanopy');
      if (gameplayActive && this.inputBindings?.isArenaPanelHeld()) {
        this.ctx.rightPanel.updateLeaderboard(this.hostUpdate.getLeaderboardEntries());
      }
      diagnosticsFrame?.end('leaderboardCanopy');
    }
  }

  private runArenaWorldWithoutActivityFrame(
    worldActive: boolean,
    activityActive: boolean,
    terminated: boolean,
    delta: number,
    diagnosticsFrame: ArenaDiagnosticsFrame | null,
  ): void {
    if (!worldActive || activityActive || terminated) return;

    diagnosticsFrame?.begin('primaryStep');
    if (bridge.isHost()) this.arenaRuntime.runHostFrame(delta);
    else {
      this.arenaRuntime.runClientFrame(delta);
      const clientState = bridge.getLatestGameState();
      if (clientState) {
        this.captureTheBeerPresentation.syncClient(
          clientState.captureTheBeer ?? null,
          this.arenaRuntime.getLocalWorldPresentation().required,
        );
      }
      this.arenaRuntime.presentation.syncWorldClientPresentation(
        clientState,
        delta,
        false,
        { cells: [] },
        this.arenaRuntime?.getPowerUpPedestalSnapshot() ?? [],
      );
    }
    diagnosticsFrame?.end('primaryStep');
  }

  // ── Network events ────────────────────────────────────────────────────────

  private onPlayerJoined(profile: PlayerProfile): void {
    if (bridge.isHost()) {
      bridge.hostAssignColor(profile.id);
      if (isTeamGameMode(bridge.getGameMode())) {
        bridge.hostEnsureTeamAssignment(profile.id);
      }
    }
  }

  private onPlayerLeft(id: string): void {
    if (bridge.isHost()) bridge.hostReclaimColor(id);
    this.arenaRuntime.handleGuestSessionOwnerRemoved(id);
    if (this.ctx.playerManager.hasPlayer(id)) {
      this.arenaRuntime.removePlayerFromActiveRound(id);
    }
    if (bridge.getGamePhase() === 'ARENA' && id === bridge.getMatchHostId()) {
      this.arenaRuntime.terminateMatch();
    }
  }

  // ── Lobby callbacks ───────────────────────────────────────────────────────

  private startWeaponBalanceLab(request: RuntimeBenchmarkRequest): WeaponBalanceLabStartResult {
    if (bridge.getGamePhase() !== 'LOBBY' || !isCoopDefenseMode(bridge.getGameMode())) {
      return { ok: false, message: t('ui.weaponLab.requiresLobby') };
    }
    if (!bridge.isHost()) return { ok: false, message: t('ui.weaponLab.hostOnly') };
    if (bridge.getConnectedPlayers().length !== 1) {
      return { ok: false, message: t('ui.weaponLab.soloOnly') };
    }
    if (this.arenaRuntime.getIsLocalReady() || bridge.getPlayerReady(bridge.getLocalPlayerId())) {
      return { ok: false, message: t('ui.weaponLab.unready') };
    }
    if (this.roomQualityMonitor.shouldBlockStart()) {
      return { ok: false, message: t('ui.weaponLab.startBlocked') };
    }

    try {
      const build = buildNeutralWeaponBenchmarkCommit(
        this.buildLocalCommittedLoadoutSnapshot(),
        request.slot,
      );
      const previousMapId = bridge.getCoopDefenseMapId();
      if (!isWeaponBalanceLabMapId(previousMapId)) this.weaponBalanceLabPreviousMapId = previousMapId;
      this.weaponBalanceLabRuntime.arm(request, build);
      bridge.setCoopDefenseMapId(WEAPON_BALANCE_LAB_MAP_ID);
      bridge.setLocalReadyWithCommittedLoadout(build.commit);
      this.arenaRuntime.setIsLocalReady(true);
      return { ok: true };
    } catch (error) {
      this.weaponBalanceLabRuntime.cancel();
      return {
        ok: false,
        message: error instanceof Error ? error.message : t('ui.weaponLab.invalidBuild'),
      };
    }
  }

  private restoreMapAfterWeaponBalanceLab(): void {
    const previousMapId = this.weaponBalanceLabPreviousMapId;
    this.weaponBalanceLabPreviousMapId = null;
    this.weaponBalanceLabRuntime.cancel();
    bridge.setLocalReady(false);
    this.arenaRuntime.setIsLocalReady(false);
    if (previousMapId && bridge.isHost()) bridge.setCoopDefenseMapId(previousMapId);
  }

  private isWorldMenuBlocking(): boolean {
    return !!this.baseEditor || !!this.afterRoundTransition?.active
      || (this.ctx?.leftPanel.isOptionsOverlayOpen() ?? false)
      || (this.ctx?.leftPanel.isHelpOverlayOpen() ?? false)
      || (this.ctx?.leftPanel.isHotkeyInputBlocked() ?? false)
      || (this.lobbyOverlay?.isHotkeyInputBlocked() ?? false)
      || (this.lobbyOverlay?.isMerchantOpen() ?? false)
      || (this.coopDefenseUpgradesOverlay?.isOpen() ?? false)
      || (this.itemsOverlay?.isOpen() ?? false)
      || (this.itemRewardOverlay?.isVisible() ?? false)
      || (this.matchResultsOverlay?.isVisible() ?? false)
      || (this.roomStatisticsOverlay?.isVisible() ?? false)
      || (this.coopDefenseDebugOverlay?.isOpen() ?? false)
      || (this.timeOfDayDebugOverlay?.isOpen() ?? false)
      || (this.weaponBalanceLabOverlay?.isOpen() ?? false)
      || (this.diagnostics?.isNetDebugOpen() ?? false)
      || (this.diagnostics?.isPerformanceOverlayOpen() ?? false);
  }

  private lobbyMenuAccessState(): LobbyMenuAccessState {
    const progress = getStoredCoopDefenseProgress();
    return {
      coop: isCoopDefenseMode(bridge.getGameMode()),
      ready: this.arenaRuntime.getIsLocalReady() || bridge.getPlayerReady(bridge.getLocalPlayerId()),
      itemsUnlocked: progress.itemsUnlocked,
      baseUnlocked: progress.persistentBaseUnlocked, dawnUnlocked: isDawnUnlocked(progress),
    };
  }

  /** Shared by lobby buttons and local World Shift interactions. */
  private openLobbyMenu(menu: LobbyMenu): void {
    if (bridge.getGamePhase() !== 'LOBBY' || this.isWorldMenuBlocking()
      || this.lobbyOverlay.hasTerminalFailure()) return;
    const denial = lobbyMenuDenial(menu, this.lobbyMenuAccessState());
    if (denial) { this.aimPresentation?.showPlacementError(denial); return; }
    if (menu === 'upgrades') this.meta?.openUpgradeOverlay();
    else if (menu === 'items') this.meta?.openItemsOverlay();
    else if (menu === 'base') this.meta?.openBaseOverlay();
    else this.lobbyOverlay.openMerchant();
    // Cancel movement and any remaining gameplay edges in the same Shift frame.
    this.ctx.inputSystem.setInputEnabled(false);
    bridge.cancelLocalInput();
  }

  /** Reopens the editor with the same draft when the host picks another map or seed. */
  private followBaseEditorDeployment(): void {
    const session = this.baseEditorSession;
    if (!session || !this.baseEditor || bridge.getGamePhase() !== 'LOBBY') return;
    const deployment = this.deploymentTerrain.current();
    const key = deployment ? `${deployment.mapConfig.mapId}|${deployment.seed}` : null;
    if (key === session.terrainKey) return;
    this.closeBaseEditor(false);
    this.openBaseEditor(session.newRewardIds, session.model);
  }

  /**
   * The next round's terrain around the base (Lagekarte) without its layout, cheap enough for every
   * lobby frame; `null` without a previewable map, `undefined` while it is still being generated.
   */
  private resolveBaseEditorTerrainIdentity() {
    const deployment = this.deploymentTerrain.current();
    if (!deployment) return null;
    const fingerprint = this.deploymentTerrain.fingerprint(deployment);
    if (fingerprint === null) return undefined;
    const definition = resolveWorldDefinition({ definitionId: toWorldDefinitionId(deployment.mapConfig.mapId) }, null);
    if (!definition?.persistentBaseSite) return null;
    // The round freezes the host's stage, capped by the map's site.
    const hostStage = bridge.isHost() ? getStoredPersonalPersistentBaseAreaStage()
      : bridge.getPersonalBaseAreaStage(bridge.getHostPlayerId()) ?? DEFAULT_PERSISTENT_BASE_AREA_STAGE;
    const areaStage = resolveFrozenPersistentBaseAreaStage({ personalStage: hostStage,
      siteMaxAreaStage: definition.persistentBaseSite.maxAreaStage ?? PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE });
    return { deployment, mapId: deployment.mapConfig.mapId, seed: deployment.seed, definition, fingerprint, areaStage };
  }

  /** The next round's terrain with its layout (a copy); see `resolveBaseEditorTerrainIdentity`. */
  private resolveBaseEditorTerrain(): PersistentBaseEditorTerrain | null | undefined {
    const identity = this.resolveBaseEditorTerrainIdentity();
    if (!identity) return identity;
    const layout = this.deploymentTerrain.peek(identity.deployment);
    if (!layout) return undefined;
    return { mapId: identity.mapId, definition: identity.definition, seed: layout.seed, fingerprint: layout.fingerprint,
      layout: layout.layout, areaStage: identity.areaStage };
  }

  /** Teammates, ownership and the local owner's tools: what the editor needs to predict the host's merge. */
  private resolveBaseEditorRoom(areaStage: PersistentBaseAreaStage | null): PersistentBaseEditorRoom {
    const localId = bridge.getLocalPlayerId();
    const localOwnerId = getStoredLocalOwnerId();
    const mates = bridge.getConnectedPlayerIds().filter((id) => id !== localId).flatMap((id) => {
      const contribution = bridge.getPlayerPersistentBaseContribution(id);
      return contribution ? [{ ownerId: contribution.ownerId, color: bridge.getPlayerColor(id) ?? 0xffffff, contribution }] : [];
    });
    const hostOwnerId = bridge.isHost() ? localOwnerId
      : bridge.getPlayerPersistentBaseContribution(bridge.getHostPlayerId())?.ownerId ?? '';
    const loadout = bridge.getPlayerCurrentLoadoutSnapshot(localId);
    return { localOwnerId, hostOwnerId, mates,
      localCapacity: this.clientUpdate.getLocalConstructionCapacity(areaStage ?? undefined),
      resolveLocalTool: (toolId) => {
        const access = resolveConstructionAccess(toolId, getConstructionAccessContext(COOP_DEFENSE_MODE, loadout));
        if (!access.definition) return null;
        return { footprint: access.definition.footprint, capacityCost: access.definition.capacityCost,
          unavailableReason: access.allowed ? undefined : access.reason };
      } };
  }

  /**
   * Opens the Bauhof. A stage prepared for the next round's terrain opens at once; otherwise the
   * loading panel shows from the click on while the terrain and the stage are built.
   */
  private openBaseEditor(newRewardIds: readonly PersistentBaseRewardId[], keepModel?: PersistentBaseEditorModel): void {
    if (this.baseEditor || this.pendingBaseEditor || bridge.getGamePhase() !== 'LOBBY') return;
    this.pendingBaseEditor = { newRewardIds, model: keepModel };
    loadingTimeline.begin('editor', 'base-editor', true);
    this.lastBaseEditorFrameAt = performance.now();
    this.ensureBaseEditorGate().open(() => this.showBaseEditor(), () => this.cancelBaseEditorOpening(), () => this.closeBaseEditor(false));
  }

  private measureBaseEditorFrame(): void {
    const run = loadingTimeline.get('editor');
    if (run?.endedAt !== null) return;
    const now = performance.now();
    run.add('frame', now - this.lastBaseEditorFrameAt, 'elapsed');
    this.lastBaseEditorFrameAt = now;
  }

  private ensureBaseEditorGate(): LazyOverlayGate {
    if (!this.baseEditorGate) {
      this.baseEditorGate = new LazyOverlayGate(this, {
        ready: () => this.readyBaseEditorStage() !== null, ensure: () => this.prepareBaseEditor(), immediate: true,
        get label() { return t('ui.base.loading'); },
        status: () => this.baseEditorLoadingStatus(),
      }, () => bridge.getGamePhase() === 'LOBBY');
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.baseEditorGate = null; });
    }
    return this.baseEditorGate;
  }

  /** The loading panel's words: the terrain is explored (layout worker), then the map is drawn (stage). */
  private baseEditorLoadingStatus() {
    if (this.resolveBaseEditorTerrainIdentity() === undefined) return { label: t('ui.base.loadingTerrain'), progress: 0 };
    const stage = this.baseEditorPreparation.currentStage();
    return stage ? { label: t('ui.base.loadingMap'), progress: stage.progress() } : null;
  }

  /** Key of the stage a terrain needs; `null` for the personal draft without map terrain. */
  private baseEditorStageKey(terrain: Parameters<typeof baseEditorStageKey>[0] | null): string | null {
    return terrain ? baseEditorStageKey(terrain, getStoredGraphicsQuality()) : null;
  }

  /** The kept stage for the next round's terrain, when it can open a session at once. */
  private readyBaseEditorStage(): PersistentBaseEditorScene | null {
    const terrain = this.resolveBaseEditorTerrainIdentity();
    return terrain === undefined ? null : this.baseEditorPreparation.readyStage(this.baseEditorStageKey(terrain));
  }

  /** The stage for this terrain, built over the confirmed draft. `urgent`: a player waits for it. */
  private acquireBaseEditorStage(terrain: PersistentBaseEditorTerrain | null, urgent: boolean): PersistentBaseEditorScene {
    return this.baseEditorPreparation.acquire(this.baseEditorStageKey(terrain), () => this.baseEditorStageOptions(terrain), urgent);
  }

  private baseEditorStageOptions(terrain: PersistentBaseEditorTerrain | null): PersistentBaseEditorStageOptions {
    return { terrain, color: bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? 0xffffff,
      model: new PersistentBaseEditorModel(this.confirmedBaseEditorBaseline(), getStoredPersonalPersistentBaseAreaStage(),
        this.roomBaseEditorBase()) };
  }

  /** The Bauhof's stage is prepared in the lobby, ahead of the Bauhof button or building. */
  private tickBaseEditorPreparation(): void {
    // The next round's terrain exists only in co-op campaign lobbies (see ArenaDeploymentTerrain).
    // The stage is lobby waiting work: it never competes with the boot for the first reveal, and it
    // shows the next round's own content (bridges, tracks, hostile bases) from the second phase.
    const eligible = !this.bootRevealPending && getStoredPersistentBaseUnlocked() && bridge.getGamePhase() === 'LOBBY'
      && getDeferredAssets(this).getState().status === 'complete';
    const identity = eligible ? this.resolveBaseEditorTerrainIdentity() : null;
    this.baseEditorPreparation.tick({ now: performance.now(), eligible, busy: this.baseEditor !== null || this.pendingBaseEditor !== null,
      key: identity === undefined ? undefined : this.baseEditorStageKey(identity),
      near: eligible && this.isNearBaseEditorYard(), expected: eligible && (this.meta?.expectsAfterRoundBase() ?? false),
      calm: this.isLobbyCalm(),
      options: () => this.baseEditorStageOptions(this.resolveBaseEditorTerrain() ?? null) });
  }

  /**
   * Calm enough for a heavy build step of the Bauhof's stage: a menu covers the lobby, or the local
   * player has stood still for a moment, so a long frame does not stutter a movement.
   */
  private isLobbyCalm(minimumMs = BASE_EDITOR_CALM_MS): boolean {
    const now = performance.now();
    const sprite = this.ctx?.playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject;
    if (sprite && (Math.abs(sprite.x - this.lobbyCalm.x) > .5 || Math.abs(sprite.y - this.lobbyCalm.y) > .5)) {
      this.lobbyCalm = { x: sprite.x, y: sprite.y, since: now };
    }
    return now - this.lobbyCalm.since >= minimumMs || this.isWorldMenuBlocking();
  }

  /** The local player is about where the Bauhof's name plate shows. */
  private isNearBaseEditorYard(): boolean {
    const world = this.arenaRuntime.getWorldDescriptor(), metrics = this.arenaRuntime.getWorldMetrics();
    if (!world || !metrics || !isLobbyWorldDefinitionId(world.definitionId)) return false;
    const yard = lobbyBuildingsOfWorld(world.parameters).find((building) => building.menu === 'base');
    const sprite = this.ctx?.playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject;
    if (!yard || !sprite) return false;
    return nearestStructurePoint(lobbyBuildingWorldRects(metrics, yard), sprite.x, sprite.y).distance
      <= LOBBY_MERCHANT.nameplate.hiddenAtCells * CELL_SIZE;
  }

  private confirmedBaseEditorBaseline() {
    return { ...getStoredCoopDefenseProgress(), personalBaseContribution: getStoredPersonalBaseContribution() };
  }

  /** Rewards and the orientation belong to the room host's base; a guest sees the replicated one. */
  private roomBaseEditorBase(): PersistentBaseEditorRoomBase | undefined {
    if (bridge.isHost()) return undefined;
    const session = bridge.getPersistentBaseRewardSessionState();
    return { placements: session?.placements ?? [], quarterTurns: session?.quarterTurns ?? 0, editable: false };
  }

  /** Behind the loading panel: the terrain, then the stage; resolves once the stage is ready. */
  private async prepareBaseEditor(): Promise<void> {
    // One painted frame with the panel first (a click arrives between frames); building the World
    // then blocks this thread for a moment while the panel's spinner keeps turning.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    let terrain = this.resolveBaseEditorTerrain();
    const waited = loadingTimeline.start();
    while (terrain === undefined && this.pendingBaseEditor) {
      // Usually ready: the lobby generates the terrain as soon as the host picks the map.
      const generated = await this.deploymentTerrain.request(this.deploymentTerrain.current()!).then(() => true, () => false);
      // Without terrain the editor still opens on the base alone.
      terrain = generated ? this.resolveBaseEditorTerrain() : null;
    }
    loadingTimeline.end('editor/terrain-wait', waited, 'elapsed');
    // The map's own content arrives with the second loading phase, usually long before this.
    const deferred = getDeferredAssets(this);
    deferred.start();
    await deferred.whenSettled();
    if (!this.pendingBaseEditor) return;
    const created = loadingTimeline.start();
    const stage = this.acquireBaseEditorStage(terrain ?? null, true);
    loadingTimeline.end('editor/stage-acquire', created);
    await stage.whenReady();
  }

  /** The stage is ready: the session opens on it. A terrain that changed meanwhile starts over. */
  private showBaseEditor(): void {
    const pending = this.pendingBaseEditor;
    this.pendingBaseEditor = null;
    if (!pending || this.baseEditor || bridge.getGamePhase() !== 'LOBBY') return;
    const stage = this.readyBaseEditorStage();
    if (stage) this.openBaseEditorOn(stage, pending.newRewardIds, pending.model);
    else this.openBaseEditor(pending.newRewardIds, pending.model);
  }

  /** Cancelling the loading panel: an after-round flow moves on from its previous menu. */
  private cancelBaseEditorOpening(): void {
    this.closeBaseEditor(false);
    this.advanceAfterRound('base', null);
  }

  /** A session on the ready stage. Revision, ready state and draft are taken now, as the session starts. */
  private openBaseEditorOn(stage: PersistentBaseEditorScene, newRewardIds: readonly PersistentBaseRewardId[],
    keepModel?: PersistentBaseEditorModel): void {
    if (this.baseEditor || bridge.getGamePhase() !== 'LOBBY') return;
    const terrain = stage.terrain;
    const host = bridge.isHost();
    const personalAreaStage = getStoredPersonalPersistentBaseAreaStage();
    const roomBase = () => this.roomBaseEditorBase();
    const confirmedBaseline = () => this.confirmedBaseEditorBaseline();
    const model = keepModel ?? new PersistentBaseEditorModel(confirmedBaseline(), personalAreaStage, roomBase());
    const revision = bridge.getCurrentWorldRevision();
    if (revision === null) {
      if (this.afterRoundTransition?.active) this.meta?.finishAfterRoundStep('base');
      return;
    }
    bridge.setLocalReady(false); this.arenaRuntime.setIsLocalReady(false);
    this.lobbyOverlay.setReadyButtonState(false);
    // The host validates a layout edit against the stage this player offered.
    bridge.offerPersonalBaseAreaStage(personalAreaStage);
    const opening = this.afterRoundOpening();
    const reload = () => model.reload(confirmedBaseline(), roomBase());
    // Callbacks of an ended session must not touch the next one on the same stage.
    const session = { terrainKey: terrain ? `${terrain.mapId}|${terrain.seed}` : null, model, newRewardIds };
    const current = () => this.baseEditorSession === session;
    this.baseEditor = stage;
    this.baseEditorSession = session;
    opening?.onCancel(() => { if (current()) this.closeBaseEditor(false); });
    this.input.enabled = false;
    if (this.input.keyboard) { this.input.keyboard.resetKeys(); this.input.keyboard.enabled = false; }
    stage.open({ model, newRewardIds, color: bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? 0xffffff,
      room: this.resolveBaseEditorRoom(terrain?.areaStage ?? null),
      resolveTurretRange: (constructionId) => this.clientUpdate.getLocalTurretRange(constructionId),
      presented: opening?.ready,
      retire: () => { if (current()) this.closeBaseEditor(false); },
      close: () => {
        if (current() && !this.advanceAfterRound('base', stage.getTransitionView())) this.closeBaseEditor(false);
      },
      save: async (): Promise<PersistentBaseEditorSaveResult> => {
        const canSave = () => current() && bridge.isHost() === host && bridge.getGamePhase() === 'LOBBY'
          && bridge.getCurrentWorldRevision() === revision && !bridge.getPlayerReady(bridge.getLocalPlayerId());
        if (!canSave()) return { ok: false, reason: 'blocked' };
        if (model.roomBaseChanged
          && getStoredPersistentBaseRewardState().revision !== model.baseline.persistentBaseRewardState.revision) {
          reload();
          return { ok: false, reason: 'stale' };
        }
        if (model.constructionsChanged) {
          bridge.offerPersonalBaseAreaStage(personalAreaStage);
          const result = await bridge.sendPersistentBaseLayoutEdit({ worldRevision: revision,
            expectedRevision: model.baseline.personalBaseContribution.revision, areaStage: personalAreaStage,
            constructions: model.constructions });
          if (!result.ok) {
            if (result.reason === 'stale') reload();
            return { ok: false, reason: result.reason };
          }
          setStoredPersonalBaseContribution(result.contribution);
        }
        if (!canSave()) return { ok: false, reason: 'blocked' };
        const rewardState = model.baseline.persistentBaseRewardState;
        if (model.roomBaseChanged && !setStoredPersistentBaseRewardState({ ...rewardState, revision: rewardState.revision + 1,
          quarterTurns: model.quarterTurns, placements: model.rewards })) return { ok: false, reason: 'invalid' };
        this.meta?.refresh();
        return { ok: true };
      },
    });
  }

  private beginAfterRoundTransition(view: AfterRoundView | null): void {
    this.afterRoundTransition ??= new AfterRoundTransition(this, blocked => {
      this.input.enabled = !blocked && !this.baseEditor;
      if (this.input.keyboard) { this.input.keyboard.resetKeys(); this.input.keyboard.enabled = this.input.enabled; }
      this.baseEditor?.setTransitionInputBlocked(blocked);
    });
    this.afterRoundTransition.begin(view);
  }

  private afterRoundOpening() {
    return this.afterRoundTransition?.opening(() => this.meta?.cancelAfterRoundFlow());
  }

  private advanceAfterRound(step: 'items' | 'upgrades' | 'base', view: AfterRoundView | null): boolean {
    if (!this.meta?.isAfterRoundFlowActive()) return false;
    this.beginAfterRoundTransition(view);
    this.meta.finishAfterRoundStep(step);
    return true;
  }

  private closeBaseEditor(advance: boolean): void {
    // An opening still behind the loading panel ends with it.
    if (this.baseEditorGate?.isPending()) this.baseEditorGate.cancel();
    this.pendingBaseEditor = null;
    if (!this.baseEditor) return;
    const stage = this.baseEditor;
    this.baseEditorSession = null;
    this.baseEditor = null;
    // The stage stays hidden for the next session while its terrain is still the next round's.
    this.baseEditorPreparation.endSession(stage);
    this.input.enabled = !this.afterRoundTransition?.active;
    if (this.input.keyboard) this.input.keyboard.enabled = this.input.enabled;
    if (advance) this.meta?.finishAfterRoundStep('base');
  }

  private onReadyToggled(): void {
    if (this.baseEditor || this.meta?.isAfterRoundFlowActive()) return;
    const nowReady = !this.arenaRuntime.getIsLocalReady();
    if (nowReady) {
      this.commitLocalReady();
      return;
    } else {
      bridge.setLocalReady(false);
      if (this.weaponBalanceLabRuntime.isActive() && isWeaponBalanceLabMapId(bridge.getCoopDefenseMapId())) {
        this.restoreMapAfterWeaponBalanceLab();
      }
    }
    this.arenaRuntime.setIsLocalReady(nowReady);
  }

  /** Shared Ready validation; menu guards remain with the initiating action. */
  private commitLocalReady(): boolean {
    const lobbySync = bridge.getLobbySyncConsistency();
    if (!lobbySync.consistent) {
      console.warn(
        `[LobbySync] BEREIT blockiert – lokaler Stand weicht vom Host ab: ${lobbySync.issues.join(' | ')}. `
        + `Lokal bekannt: [${bridge.getConnectedPlayerIds().join(', ')}].`,
      );
      this.lobbyOverlay.showReadySyncNotice();
      return false;
    }
    bridge.setLocalReadyWithCommittedLoadout(this.buildLocalCommittedLoadoutSnapshot());
    this.arenaRuntime.setIsLocalReady(true);
    return true;
  }

  private canRestartDefeatedMap(): boolean {
    if (!this.matchResultsOverlay?.isVisible() || this.meta?.isMatchResultsPending()
      || this.baseEditor || this.lastObservedGamePhase !== 'LOBBY'
      || bridge.getGamePhase() !== 'LOBBY' || !bridge.isHost()
      || this.arenaRuntime.isMatchTerminated() || this.arenaRuntime.isArenaEntryProtected()
      || !isCoopDefenseMode(bridge.getGameMode())) return false;
    const players = bridge.getConnectedPlayerIds();
    if (players.length !== 1 || players[0] !== bridge.getLocalPlayerId()) return false;
    const presentation = this.meta?.getLastMatchResultsPresentation();
    const round = bridge.getRoundState();
    const results = bridge.getRoundResults();
    return presentation?.outcome === 'defeat' && isCoopDefenseMode(presentation.mode)
      && round?.status === 'defeat' && !!round.coopDefenseMapId && !!round.endedAt
      && presentation.leaderboard.length > 0 && !!results?.length
      && presentation.leaderboard.every(result => result.roundEndedAt === round.endedAt)
      && results.every(result => result.roundEndedAt === round.endedAt);
  }

  private restartDefeatedMap(): boolean {
    if (!this.canRestartDefeatedMap()) return false;
    bridge.setCoopDefenseMapId(bridge.getRoundState()!.coopDefenseMapId!);
    if (this.commitLocalReady()) this.arenaRuntime.hostCheckReadyToStart();
    if (bridge.getGamePhase() !== 'ARENA') {
      // No queued retry: normal Continue must still be able to show all earned rewards.
      bridge.setLocalReady(false);
      this.arenaRuntime.setIsLocalReady(false);
      this.lobbyOverlay.setReadyButtonState(false);
      return false;
    }
    this.meta?.cancelAfterRoundFlow();
    return true;
  }

  /** Hält die lokale Lobby-Projektion nach einer Aktion im Coop-Debug-Overlay synchron. */
  private refreshCoopDefenseDebugState(options: {
    applyMapSelection?: boolean;
    metaAlreadyRefreshed?: boolean;
  } = {}): void {
    if (!options.metaAlreadyRefreshed) this.meta?.refresh();
    if (options.applyMapSelection) this.meta?.applyDefaultCoopDefenseMapSelection();
    this.clientUpdate.refreshStoredProgressFallback();
  }

  private async onCopyRoomLink(): Promise<void> {
    // Aus dem Raumcode gebaut, nicht aus der Adresszeile: die traegt beim Host keinen Code.
    const copied = await copyRoomShareUrl(bridge.getRoomCode());
    if (copied) this.lobbyOverlay.showCopySuccess();
  }

  private onRetryRoom(): void {
    restartWithNewRoom();
  }

  // ── Visual helpers ────────────────────────────────────────────────────────

  private syncArenaFogOverlay(now: number, inArena: boolean, countdownActive: boolean): void {
    if (!this.ctx.arenaCountdown) return;

    if (!inArena) {
      this.localPlayerState.overlayTrackedAlive = null;
      this.ctx.arenaCountdown.clear();
      return;
    }

    // A late join can receive the running round before its own World is resident. Keep the
    // existing loading veil until local readiness, then use the unchanged synchronized time.
    if (bridge.isArenaLoading() || this.arenaRuntime.isArenaEntryLoading()
      || (this.ctx.arenaCountdown.isLoading()
        && !this.arenaRuntime.getWorldRevealState(getVisibleWorldView(this.cameras.main)).ready)) {
      this.localPlayerState.overlayTrackedAlive = null;
      this.ctx.arenaCountdown.showLoading();
      this.ctx.arenaCountdown.updateLoadingScreen(this.getArenaLoadingScreenState());
      this.ctx.arenaCountdown.update(now);
      return;
    }

    // A backgrounded or late-joining peer can miss the three-second window entirely. Switch the
    // loading veil directly into the authoritative reveal instead of leaving it opaque forever.
    if (bridge.isArenaStarted() && this.ctx.arenaCountdown.isLoading()) {
      this.localPlayerState.overlayTrackedAlive = this.localPlayerState.alive;
      this.ctx.arenaCountdown.syncTo(bridge.getArenaStartTime());
      this.ctx.arenaCountdown.update(now);
      // Nur die eigene Figur ist hinter dem Schleier entstanden; alle anderen stehen laengst.
      this.replaySpawnEffectsAfterVeil([bridge.getLocalPlayerId()]);
      return;
    }

    // Spectatoren sehen die Arena direkt: ihre Rolle ist kein Todeszustand und darf deshalb
    // weder den Death-Veil noch den Respawn-Reveal ausloesen.
    if (this.localPlayerState.spectator || bridge.isLocalSpectator()) {
      this.localPlayerState.overlayTrackedAlive = null;
      this.ctx.arenaCountdown.clear();
      return;
    }

    if (countdownActive) {
      this.localPlayerState.overlayTrackedAlive = this.localPlayerState.alive;
      // Der erste Spawn der Runde lief unter dem Ladeschleier: Mit dem Countdown materialisieren
      // sich alle Figuren sichtbar, waehrend die Kamera auf die eigene Figur gezoomt ist.
      if (this.ctx.arenaCountdown.isLoading()) this.replaySpawnEffectsAfterVeil();
      this.ctx.arenaCountdown.syncTo(bridge.getArenaStartTime());
      this.ctx.arenaCountdown.update(now);
      return;
    }

    if (this.localPlayerState.alive) {
      if (this.localPlayerState.overlayTrackedAlive === false) {
        this.ctx.arenaCountdown.playRespawnReveal();
      }
    } else if (this.localPlayerState.overlayTrackedAlive !== false) {
      this.ctx.arenaCountdown.showDeathVeil();
    }

    this.localPlayerState.overlayTrackedAlive = this.localPlayerState.alive;
    this.ctx.arenaCountdown.update(now);
  }

  /** Startet verdeckte Materialisierungen erneut, sobald der Ladeschleier weitgehend ausgeblendet ist. */
  private replaySpawnEffectsAfterVeil(playerIds?: readonly string[]): void {
    this.time.delayedCall(SPAWN_REPLAY_AFTER_VEIL_MS, () => this.ctx?.playerManager.replaySpawnEffects(playerIds));
  }

  private getArenaLoadingScreenState(): ArenaLoadingScreenState {
    const participation = bridge.getRoundParticipation();
    const spectatorIds = new Set(participation?.spectatorIds ?? []);
    const participantIds = new Set(participation?.participantIds ?? []);
    // Die Ladeanzeige liest den World-Ladezustand; ohne aktive World gibt es keinen.
    const worldRevision = participation?.roundRevision ?? bridge.getWorldDescriptor()?.worldRevision ?? 0;
    const players = bridge.getConnectedPlayers()
      .filter((profile) => participantIds.has(profile.id) && !spectatorIds.has(profile.id))
      .map((profile) => {
        const state = bridge.getPlayerWorldLoadState(profile.id, worldRevision) ?? {
          worldRevision,
          progress: 0,
          stage: 'generating' as const,
          ready: false,
        };
        return {
          id: profile.id,
          name: profile.name,
          colorHex: profile.colorHex,
          progress: state.progress,
          stage: state.stage,
          ready: state.ready,
        };
      });
    const modeLabel = getLocalizedGameModeLabel(bridge.getGameMode());
    // Der Kartenname gehoert zur World, nicht zur Runde: er kommt aus der WorldDefinition.
    const worldDefinitionId = bridge.getWorldDescriptor()?.definitionId;
    const mapId = worldDefinitionId ? toMapId(worldDefinitionId) : null;
    const mapLabel = mapId ? getMapName(mapId, getLocale()) : modeLabel;
    return { mapLabel, modeLabel, players };
  }

  private syncCountdownPlayerPresentation(): void {
    const localId = bridge.getLocalPlayerId();
    const playerStates = bridge.getLatestGameState()?.players;
    for (const player of this.ctx.playerManager.getAllPlayers()) {
      const selectedHeldItemId = player.id === localId
        ? this.ctx.inputSystem.getSelectedHeldItemIdForPresentation?.()
        : undefined;
      player.setHeldItemId(
        selectedHeldItemId === undefined ? bridge.getPlayerHeldItemId(player.id) : selectedHeldItemId,
        selectedHeldItemId !== undefined,
      );
      const netState = playerStates?.[player.id];
      const aim = player.id === localId
        ? this.ctx.inputSystem.getAimAngle()
        : netState ? dequantizeAngle(netState.rot) : player.getAimAngle();
      player.setRotation(aim);
    }
  }

  /** Spectator-Ansicht: Namen lebender Spieler bleiben dauerhaft als Entity-Label sichtbar. */
  private syncSpectatorPlayerNames(inArena: boolean): void {
    const visible = inArena && (this.localPlayerState.spectator || bridge.isLocalSpectator());
    for (const player of this.ctx.playerManager.getAllPlayers()) {
      const profile = bridge.getPlayerProfile(player.id);
      if (profile) player.setDisplayName(profile.name);
      player.setNameVisible(visible);
    }
  }

  private buildLocalLobbyLoadoutPreview(): LobbyLoadoutPreviewState {
    return this.buildLocalCoopDefenseBuild();
  }

  private buildLocalCoopDefenseBuild(): LobbyLoadoutPreviewState {
    const storedProgress = this.meta!.getStoredProgress();
    const coopMode = isCoopDefenseMode(bridge.getGameMode());
    const classId = coopMode && storedProgress.classesUnlocked
      ? storedProgress.selectedClassId
      : null;
    const profile = coopMode
      ? storedProgress.classesUnlocked
        ? storedProgress.profilesByClass[storedProgress.selectedClassId]
        : storedProgress.defaultProfile
      : null;
    const equippedItems = coopMode
      ? this.meta!.getEquippedItems()
      : [];
    return {
      coopDefenseClassId: classId,
      coopDefenseProfile: profile,
      equippedItems,
      tools: (profile?.toolLoadout ?? []).map((tool) => ({ ...tool })),
    };
  }

  private buildLocalCommittedLoadoutSnapshot(): LoadoutCommitSnapshot {
    const localId = bridge.getLocalPlayerId();
    const build = this.buildLocalCoopDefenseBuild();
    // Ausruestung wird hier eingefroren: ab "Bereit" gilt sie fuer das gesamte Match.
    const committed = resolveLoadoutSelectionIds({
      weapon1:  (bridge.getPlayerLoadoutSlot(localId, 'weapon1')  ?? DEFAULT_LOADOUT.weapon1.id) in WEAPON_CONFIGS
        ? WEAPON_CONFIGS[(bridge.getPlayerLoadoutSlot(localId, 'weapon1') ?? DEFAULT_LOADOUT.weapon1.id) as keyof typeof WEAPON_CONFIGS]
        : DEFAULT_LOADOUT.weapon1,
      weapon2:  (bridge.getPlayerLoadoutSlot(localId, 'weapon2')  ?? DEFAULT_LOADOUT.weapon2.id) in WEAPON_CONFIGS
        ? WEAPON_CONFIGS[(bridge.getPlayerLoadoutSlot(localId, 'weapon2') ?? DEFAULT_LOADOUT.weapon2.id) as keyof typeof WEAPON_CONFIGS]
        : DEFAULT_LOADOUT.weapon2,
      utility:  (bridge.getPlayerLoadoutSlot(localId, 'utility')  ?? DEFAULT_LOADOUT.utility.id) in UTILITY_CONFIGS
        ? UTILITY_CONFIGS[(bridge.getPlayerLoadoutSlot(localId, 'utility') ?? DEFAULT_LOADOUT.utility.id) as keyof typeof UTILITY_CONFIGS]
        : DEFAULT_LOADOUT.utility,
      ultimate: (bridge.getPlayerLoadoutSlot(localId, 'ultimate') ?? DEFAULT_LOADOUT.ultimate.id) in ULTIMATE_CONFIGS
        ? ULTIMATE_CONFIGS[(bridge.getPlayerLoadoutSlot(localId, 'ultimate') ?? DEFAULT_LOADOUT.ultimate.id) as keyof typeof ULTIMATE_CONFIGS]
        : DEFAULT_LOADOUT.ultimate,
    }, bridge.getGameMode(), build.coopDefenseProfile, build.coopDefenseClassId,
    this.meta!.getStoredProgress().dawn.unlockedBranchIds);
    const equippedItems = build.equippedItems ?? [];
    return equippedItems.length > 0 ? { ...committed, equippedItems } : committed;
  }

  private getEnemyHoverNameTarget(): { name: string; x: number; y: number } | null {
    const pointer = this.getPointerWorldPoint();
    const localId = bridge.getLocalPlayerId();
    let nearest: { name: string; x: number; y: number; distanceSq: number } | null = null;

    for (const player of this.ctx.playerManager.getAllPlayers()) {
      if (player.id === localId) continue;

      const sprite = player.displayObject;
      if (!sprite || !sprite.active || !sprite.visible) continue;

      const dx = pointer.x - sprite.x;
      const dy = pointer.y - sprite.y;
      const radius = Math.max(sprite.displayWidth, sprite.displayHeight) * 0.5;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > radius * radius) continue;

      if (!nearest || distanceSq < nearest.distanceSq) {
        nearest = {
          name: bridge.getPlayerName(player.id),
          x: sprite.x,
          y: sprite.y,
          distanceSq,
        };
      }
    }

    const decoyTarget = this.ctx.decoySystem.getHoverNameTarget(pointer.x, pointer.y);
    if (decoyTarget && (!nearest || decoyTarget.distanceSq < nearest.distanceSq)) {
      nearest = decoyTarget;
    }

    if (!nearest) return null;
    return { name: nearest.name, x: nearest.x, y: nearest.y };
  }

  private canLeaveLocalLobbyWorld(): boolean {
    return bridge.getGamePhase() === 'LOBBY'
      && bridge.getActivityDescriptor() === null
      && bridge.getLocalWorldParticipation() === 'interactive';
  }

  private requestLocalLobbyWorldLeave(): void {
    this.arenaRuntime.requestLocalWorldParticipation(false);
  }

  /**
   * Übernimmt eine per Debug-Regler gewählte Uhrzeit.
   *
   * Rein lokal – die Runde leitet ihre Uhrzeit auf jedem Client aus der replizierten
   * Map-ID ab, hier wird also nur die eigene Ansicht verstellt.
   *
   * Der Override bleibt im zentralen Controller. Waehrend des Ziehens gilt dieselbe
   * Shadow-Drosselung wie fuer die automatische Uhr; erst das Loslassen erzwingt den exakten
   * finalen Bake. AUTO loescht den Override und sampelt die inzwischen weitergelaufene Uhr.
   */
  private applyDebugTimeOfDay(minutes: number, settled: boolean): void {
    this.arenaRuntime.setTimeOfDayDebugOverride(minutes);
    this.syncDebugTimeOfDay(settled);
  }

  private clearDebugTimeOfDay(): void {
    this.arenaRuntime.clearTimeOfDayDebugOverride();
    this.syncDebugTimeOfDay(true);
  }

  private syncDebugTimeOfDay(forceStaticBake: boolean): void {
    const now = bridge.getSynchronizedNow();
    this.arenaRuntime.syncRuntimeTimeOfDay(now, this.resolveArenaTimeOfDaySignals());
    this.arenaRuntime.presentation.syncWorldStaticShadowProfile(forceStaticBake);
  }

  private resolveArenaTimeOfDaySignals(): {
    bossSpawnedAtMs: number | null;
    bossPhase: number;
  } {
    const observedPhase = this.arenaRuntime?.getMaxBossPhase() ?? 0;
    return {
      bossSpawnedAtMs: bridge.getRoundState()?.coopDefenseBossSpawnedAtMs ?? null,
      bossPhase: observedPhase,
    };
  }

  private syncArenaPanelOverlay(visible: boolean, immediate = false): void {
    if (!this.ctx) return;
    this.ctx.leftPanel.setArenaOverlayVisible(visible, immediate);
    this.ctx.rightPanel.setArenaOverlayVisible(visible, immediate);
  }

  private clearDebugModes(): void {
    this.flowFieldDebugOverlay?.destroy();
    this.flowFieldDebugOverlay = null;
  }

  private handleFlowFieldDebugHotkey(type: ArenaInputDebugHotkey): void {
    if (!bridge.isHost()) return;

    const port = this.arenaRuntime?.diagnostics.getFlowFieldDebugPort(type);
    if (!port) return;

    if (!this.flowFieldDebugOverlay) {
      console.log('[ArenaScene] Creating EnemyFlowFieldDebugOverlay');
      this.flowFieldDebugOverlay = new EnemyFlowFieldDebugOverlay(this, port);
    }

    console.log(`[ArenaScene] Showing ${type} overlay`);
    this.flowFieldDebugOverlay.showForPort(port);
  }

  private syncArenaPanelOverlayState(inArena = bridge.getGamePhase() === 'ARENA' && !this.arenaRuntime?.isMatchTerminated()): void {
    if (!this.ctx) return;
    const shouldShow = inArena && this.inputBindings?.isArenaPanelHeld() === true;
    this.syncArenaPanelOverlay(shouldShow);
  }

  private ensureArenaClipMask(): void {
    if (!this.arenaClipMask) {
      this.arenaClipMask = new WebGLRectMaskTexture(this, '__arena_clip_mask', GAME_WIDTH, GAME_HEIGHT);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.arenaClipMask?.destroy();
        this.arenaClipMask = null;
      });
    }
    this.syncArenaClipMask();
  }

  private syncArenaClipMask(): void {
    const bounds = {
      x: ARENA_OFFSET_X,
      y: ARENA_OFFSET_Y,
      width: ARENA_VIEWPORT_WIDTH,
      height: ARENA_VIEWPORT_HEIGHT,
    };
    const mask = this.arenaClipMask;
    if (!mask) return;
    if (coversDesignSpace(bounds, GAME_WIDTH, GAME_HEIGHT)) {
      mask.detachFromCamera();
      return;
    }
    mask.update(bounds);
    mask.attachToCamera(this.cameras.main);
  }

  private syncArenaMetrics(phase = bridge.getGamePhase(), showWorld = phase === 'ARENA'): void {
    const mode = this.resolveConfiguredGameMode(phase);
    const worldMetrics = this.arenaRuntime?.getWorldMetrics() ?? null;
    if (worldMetrics) {
      // Der mutable Kompatibilitaetsspiegel folgt der laufenden World selbst. Ihn erneut aus dem
      // konfigurierten Modus abzuleiten waere eine zweite Quelle - und die LobbyWorld traegt
      // ohnehin ein anderes Mass als die in der Lobby gewaehlte Map.
      applyArenaWorldMetrics(toArenaMetricsProfile(worldMetrics));
      applyArenaActivityValuesForMode(mode);
      applyArenaModeFlags(mode);
    } else {
      applyArenaMetricsForMode(
        mode,
        phase,
        this.resolveCoopDefenseArenaWidthCells(phase),
        this.resolveCoopDefenseArenaHeightCells(phase),
      );
    }
    this.arenaBuilder?.syncStaticBackdrop(mode, showWorld ? 'ARENA' : 'LOBBY');
    this.syncArenaClipMask();
    this.physics.world.setBounds(
      worldMetrics?.offsetX ?? ARENA_OFFSET_X,
      worldMetrics?.offsetY ?? ARENA_OFFSET_Y,
      worldMetrics?.widthPx ?? ARENA_WIDTH,
      worldMetrics?.heightPx ?? ARENA_HEIGHT,
    );
    this.syncMainCameraBounds();
    this.ctx?.getWorldCombatCore()?.setWorldMetrics(worldMetrics);
  }

  /**
   * Koppelt die Hauptkamera an den 1920x1080-Designraum, egal wie groß der Backing-Store der
   * Canvas gerade ist (siehe `graphics/RenderResolution`). Der Zoom stellt die Vergrößerung
   * her, `origin = (0, 0)` sorgt dafür, dass sie Welt und bildschirmfestes HUD gleich
   * behandelt. Bei Renderauflösung 1:1 ist beides ein No-op.
   *
   * Läuft bei jedem RESIZE erneut: Vollbild und Fenstergröße verändern die Auflösung mitten
   * im Spiel, und der CameraManager setzt die Kamera dabei auf die neue Canvas-Größe.
   */
  private bindCameraToDesignSpace(): void {
    const camera = this.cameras.main;
    if (!camera) return;
    camera.setOrigin(0, 0);
    // Nicht auf den Viewport verlassen, den der CameraManager beim RESIZE gesetzt hat: die
    // Kamera soll den gesamten Backing-Store abdecken, damit Zoom und Fläche zusammenpassen.
    camera.setSize(this.scale.width, this.scale.height);
    camera.setZoom(this.scale.width / GAME_WIDTH, this.scale.height / GAME_HEIGHT);
    this.syncMainCameraBounds();

    // Die Klarheitskamera teilt Designraum und Zoom, hat aber bewusst weder Grenzen noch
    // Scroll: sie darf weder vom Kamera-Feedback noch von der Kameraverfolgung bewegt werden.
    const clarity = this.clarityCamera;
    if (!clarity) return;
    clarity.setOrigin(0, 0);
    clarity.setSize(this.scale.width, this.scale.height);
    clarity.setZoom(this.scale.width / GAME_WIDTH, this.scale.height / GAME_HEIGHT);
    clarity.setScroll(0, 0);
  }

  /**
   * Kamera-Grenzen in Designkoordinaten. Phasers `clampX`/`clampY` gehen von einer mittig
   * verankerten Kamera aus und verrechnen die Differenz zwischen Viewport- und Sichtfeldgröße
   * (`width` gegen `displayWidth = width / zoom`) selbst. Bei `origin = (0, 0)` ist diese
   * Differenz falsch, deshalb wird sie hier vorweg herausgerechnet – ohne das würde die
   * Kamera bei Renderauflösungen über 1 dauerhaft nach links versetzt festklemmen.
   */
  private syncMainCameraBounds(): void {
    const camera = this.cameras.main;
    if (!camera) return;
    // The isolated scenario controller supplies its own zoom and world focus. Design-space
    // bounds would clamp that view again later in the same frame.
    if (isDevScenarioMode()) { camera.removeBounds(); return; }
    // Um das Feedback-Budget erweitert: Phaser klemmt `scrollX/scrollY` in `preRender` gegen die
    // Grenzen. Bei fixer Kamera fallen Sichtfeld und Grenzen exakt zusammen, der zulässige
    // Bereich kollabiert dann auf einen einzigen Wert – der Kamera-Versatz würde stillschweigend
    // verschluckt. Die Verfolgung selbst hat ihre eigene Klemmung, die Grenzen sind nur Netz.
    const pad = CAMERA_FEEDBACK_LIMITS.maxOffsetPx;
    camera.setBounds(
      (camera.width  - camera.displayWidth)  / 2 - pad,
      (camera.height - camera.displayHeight) / 2 - pad,
      Math.max(GAME_WIDTH, ARENA_MAX_X + ARENA_OFFSET_X) + pad * 2,
      Math.max(GAME_HEIGHT, ARENA_MAX_Y + ARENA_OFFSET_Y) + pad * 2,
    );
  }

  /**
   * Trägt den Kamera-Versatz auf. Bewusst der letzte Schritt vor Schatten, Licht und Rendering:
   *
   * - Alles davor (Eingabe, Zielerfassung, Snapshots, Platzierungsvorschauen) rechnet mit der
   *   Basisposition und bleibt vom Rumpeln unbeeinflusst.
   * - Die Lichtkarte stempelt ihre Lichter bei `x - camera.scrollX` und muss deshalb **nach**
   *   dem Versatz laufen, damit Lichter und Welt zusammen wackeln. Genau deshalb kommt sie
   *   ohne Overscan-Reserve aus, die Phasers Shake-Effekt noch brauchte.
   */
  /**
   * Eingaben der Basis-Bildkomposition. Die Uhrzeit kommt aus dem Lichtsystem, damit Grading
   * und Beleuchtung dieselbe Quelle haben und nicht auseinanderlaufen können.
   */
  private resolveWorldGradeInputs(): WorldGradeInputs {
    const minutes = this.renderers?.lighting.getTimeOfDayMinutes() ?? DEFAULT_TIME_OF_DAY_MINUTES;
    const phase = bridge.getGamePhase();
    const inArena = phase === 'ARENA'
      || (
        phase === 'LOBBY'
        && this.lastObservedGamePhase === 'ARENA'
        && (!this.arenaExitFadeComplete || !this.arenaExitResultsRendered)
      );
    const worldMode = inArena ? this.resolveConfiguredGameMode('ARENA') : bridge.getGameMode();
    const mapConfig = inArena && isCoopDefenseMode(worldMode)
      ? this.resolveConfiguredCoopDefenseMapConfig('ARENA')
      : null;
    const localId = bridge.getLocalPlayerId();
    const localPlayer = this.ctx?.playerManager.getPlayer(localId);
    // Tot oder zuschauend gilt als unverletzt: die Gesundheitsdarstellung gehört zum eigenen
    // Körper. Ohne diesen Vorbehalt bliebe der Bildschirm nach dem Tod bis zum Respawn – in
    // Coop-Defense bis zum Wellenende – dauerhaft entsättigt und blutig.
    const localWounded = inArena
      && !this.localPlayerState.spectator
      && !bridge.isLocalSpectator()
      && (this.ctx?.getWorldCombatCore()?.isAlive(localId) ?? false);

    return {
      skyState: resolveSkyState(minutes),
      // Without a running coop round there is no map: the lobby look.
      ...resolveMapWorldGrade(mapConfig),
      bossVisualStage: inArena ? (this.arenaRuntime?.getBossVisualStage() ?? 0) : 0,
      bossPhase: inArena ? (this.arenaRuntime?.getMaxBossPhase() ?? 0) : 0,
      localHpFraction: localWounded ? (localPlayer?.getHpFraction() ?? 1) : 1,
      gamePhase: inArena ? 'ARENA' : 'LOBBY',
    };
  }

  private applyCameraFeedback(delta: number): void {
    const base = getCameraBaseScroll(this);
    if (!base) return;
    this.visualFeedback?.applyToCamera(this.cameras.main, base.x, base.y, delta);
  }

  private resolveCoopDefenseArenaWidthCells(phase = bridge.getGamePhase()): number | undefined {
    if (!isCoopDefenseMode(this.resolveConfiguredGameMode(phase))) return undefined;
    const metrics = this.arenaRuntime?.getWorldMetrics();
    if (metrics) return metrics.gridCols;
    return this.resolveConfiguredCoopDefenseMapConfig(phase)?.arenaWidthCells;
  }

  private resolveCoopDefenseArenaHeightCells(phase = bridge.getGamePhase()): number | undefined {
    if (!isCoopDefenseMode(this.resolveConfiguredGameMode(phase))) return undefined;
    const metrics = this.arenaRuntime?.getWorldMetrics();
    if (metrics) return metrics.gridRows;
    return this.resolveConfiguredCoopDefenseMapConfig(phase)?.arenaHeightCells;
  }

  /** Active Activities use their immutable descriptor; the Lobby value is pre-World only. */
  /**
   * Die World, die den Rundeninhalt beschreibt – oder `null`.
   *
   * Die LobbyWorld ist ausdruecklich keine: sie steht *neben* der Lobby-Auswahl, nicht an ihrer
   * Stelle. Waehrend sie laeuft, beantworten Modus und Map weiterhin die Lobby.
   */
  private resolveRoundWorldDescriptor(phase = bridge.getGamePhase()): WorldDescriptor | null {
    const worldActive = this.arenaRuntime?.isWorldActive() ?? false;
    if (!worldActive && phase !== 'ARENA') return null;
    const descriptor = this.arenaRuntime?.getWorldDescriptor() ?? bridge.getWorldDescriptor();
    if (!descriptor || isLobbyWorldDefinitionId(descriptor.definitionId)) return null;
    return descriptor;
  }

  private resolveConfiguredGameMode(phase = bridge.getGamePhase()): GameMode {
    const activity = bridge.getActivityDescriptor();
    const descriptor = this.resolveRoundWorldDescriptor(phase);
    return resolveActiveGameMode({
      activityKind: activity?.kind ?? null,
      roomGameMode: bridge.getGameMode(),
      worldDefinitionId: descriptor?.definitionId ?? null,
    });
  }

  /** Formation shadows of authored bomber runs (Dawn bomber night), on the same round clock as the bombs. */
  private syncBomberRuns(mapConfig: CoopDefenseMapConfig | null): void {
    const start = bridge.getArenaStartTime();
    const metrics = mapConfig?.mapEvents && start > 0 ? this.arenaRuntime?.getWorldMetrics() : null;
    if (!mapConfig?.mapEvents || !metrics) {
      this.renderers?.airstrike?.syncBomberRuns([], 0, 0, null);
      return;
    }
    if (this.bomberRuns?.events !== mapConfig.mapEvents) {
      this.bomberRuns = { events: mapConfig.mapEvents, runs: resolveScheduledAirstrikeRuns(mapConfig.mapEvents, metrics) };
    }
    const now = bridge.getSynchronizedNow();
    this.renderers?.airstrike?.syncBomberRuns(this.bomberRuns.runs, this.arenaRuntime.getMissionNow(now) - start, now,
      DAWN_BOMBER_SHADOW_TEXTURE);
  }

  /**
   * Active Worlds resolve their own Coop config; the Lobby map is only a creation input.
   *
   * A Dawn World resolves only together with its Activity. Once that Activity is gone (exit fade
   * after the round), presentation treats the World like one without a Coop map.
   */
  private resolveConfiguredCoopDefenseMapConfig(phase = bridge.getGamePhase()): CoopDefenseMapConfig | null {
    const descriptor = this.resolveRoundWorldDescriptor(phase);
    if (!descriptor) return getCoopDefenseMapConfig(bridge.getCoopDefenseMapId());
    const activity = this.resolveRoundActivityDescriptor(descriptor);
    if (isDawnWorld(descriptor) && activity === null) return null;
    const mapConfig = resolveCoopDefenseMapConfig(descriptor, activity);
    if (mapConfig === null) throw new Error('[ArenaScene] Active World has no Coop-Defense map');
    return mapConfig;
  }

  private resolveRoundActivityDescriptor(world: WorldDescriptor): ActivityDescriptor | null {
    const activity = this.arenaRuntime?.getActivityDescriptor() ?? bridge.getActivityDescriptor();
    return activity?.worldRevision === world.worldRevision ? activity : null;
  }

  private getPointerWorldPoint(): Phaser.Math.Vector2 {
    const pointer = this.input.activePointer;
    return getUnshakenPointerWorldPoint(this, pointer);
  }

  /**
   * Aktueller Zugzustand für Schatten und Licht. Bevorzugt den interpolierten Stand des
   * Renderers, damit beide nicht am Netz-Tick kleben.
   */
  private initializeRoomQuality(): void {
    this.roomQualityMonitor.initialize(this.time.now);
    this.roomQualitySnapshot = this.roomQualityMonitor.getSnapshot();
  }

  private updateRoomQuality(now: number, players: PlayerProfile[]): void {
    this.roomQualitySnapshot = this.roomQualityMonitor.update(now, players);
  }

  /** Zieht nach einem validierten Dateiimport alle lobby-lokalen Ableitungen atomar nach. */
  private handleImportedGameProgress(): void {
    if (!this.meta?.handleImportedGameProgress()) return;
    this.clientUpdate.refreshStoredProgressFallback();
  }

  /**
   * Haelt den Bootscreen, bis die Lobby fertig ist.
   *
   * Beim ersten Frame existiert die LobbyWorld noch gar nicht - sie entsteht im ersten
   * `update()`-Tick, und ihre Flaechen backen danach ueber mehrere Frames nach. Wer den
   * Ladescreen schon vorher wegnimmt, zeigt eine Lobby, die sich vor den Augen des Spielers
   * noch aufbaut. Welt und Lobby-UI werden deshalb hinter dem deckenden Bootscreen gerendert.
   * Nur ein fertiger Ausschnitt oder ein expliziter Abbruch gibt ihn frei, keine Zeitfrist.
   */
  private syncBootReveal(): void {
    if (!this.initializationReady || !this.bootRevealPending) return;
    // Ein terminaler Lobby-Fehler muss auch ohne World sichtbar werden. Wer mitten in eine
    // laufende Partie kommt, bekommt stattdessen den eigenen Ladeschleier der Arena.
    const reveal = bridge.getGamePhase() === 'LOBBY' && !this.lobbyOverlay.hasTerminalFailure()
      ? this.arenaRuntime.getWorldRevealState(getVisibleWorldView(this.cameras.main))
      : { ready: true, progress: 100 };
    if (!reveal.ready) {
      const pending = reveal.pendingRenderWork;
      const detailKey = pending === undefined ? 'ui.boot.preparingLandscape'
        : pending > 0 ? 'ui.boot.landscapeProgress' : 'ui.boot.finishingPresentation';
      BootScreen.setDetail(t(detailKey,
        pending === undefined ? undefined : { count: pending }));
      BootScreen.setIndeterminate(true);
      return;
    }
    this.bootRevealPending = false;
    // Heavy lobby waiting work starts only after the boot fade and the lobby cards' entrance.
    this.lobbyCalm = { ...this.lobbyCalm, since: performance.now() + BOOT_REVEAL_SETTLE_MS };
    BootScreen.phase('ready');
    this.input.enabled = true;
    if (this.input.keyboard) this.input.keyboard.enabled = true;
    this.game.events.off(Phaser.Core.Events.POST_RENDER, this.syncBootReveal, this);
    BootScreen.setProgress(1);
    void BootScreen.fadeOut().then(() => {
      if (this.sys.isActive()) {
        this.lobbyOverlay.completeBootReveal();
        getOverlayAssets(this).prefetch();
        // Optional voice packs (several MB of script) parse and validate behind the visible lobby.
        void voiceLibrary.load();
      }
      if (__PERFORMANCE_LAB__ && this.sys.isActive()) performanceLobbyRevealed();
    });
  }

  private cancelArenaExitRenderWait(): void {
    if (this.arenaExitRenderListener) {
      this.game.events.off(Phaser.Core.Events.POST_RENDER, this.arenaExitRenderListener);
      this.arenaExitRenderListener = null;
    }
  }

  /** Der bestehende Exit wartet auf Fade-Ende und einen Render der Ergebnisansicht. */
  private syncArenaExitFade(phase: GamePhase): boolean {
    if (phase === 'ARENA') {
      this.cancelArenaExitRenderWait();
      this.arenaExitFadeComplete = false;
      this.arenaExitResultsStarted = false;
      this.arenaExitResultsRendered = false;
      this.arenaExitOutcomeWaitStartedAt = 0;
      this.arenaExitFadeOverlay?.hide();
      return false;
    }
    if (
      phase !== 'LOBBY'
      || this.lastObservedGamePhase !== 'ARENA'
      || this.arenaRuntime.isMatchTerminated()
    ) {
      this.cancelArenaExitRenderWait();
      this.arenaExitFadeOverlay?.hide();
      return false;
    }
    if (this.arenaExitFadeComplete) {
      return this.arenaExitResultsStarted && !this.arenaExitResultsRendered;
    }
    this.arenaRuntime.beginArenaExitPresentation();
    if (this.arenaExitFadeOverlay?.isActive()) return true;

    const results = bridge.getRoundResults();
    const roundState = bridge.getRoundState();
    const eligibilityKnown = results !== null || roundState?.resultEligiblePlayerIds !== undefined;
    if (eligibilityKnown && !bridge.isLocalRoundResultEligible(results)) {
      this.arenaExitFadeComplete = true;
      return false;
    }

    const outcome = resolvePersonalMatchOutcome(
      bridge.getGameMode(),
      bridge.getLocalPlayerId(),
      results ?? [],
      roundState,
    );
    if (outcome === 'victory' || outcome === 'defeat') {
      const overlay = this.exitFadeOverlay();
      overlay.play(outcome, () => {
        if (this.arenaRuntime.isMatchTerminated() || this.arenaExitResultsStarted) return;
        this.arenaExitFadeComplete = true;
        this.arenaExitResultsStarted = true;
        this.arenaRuntime.syncRoomOwners();
        this.meta?.beginMatchResults();
        this.meta?.tryFinalizeMatchResults({
          finalizeBalanceRound: (roundEndedAt, roundIdentity) => {
            this.coopDefenseBalanceTracker.finalizePendingRound(roundEndedAt, roundIdentity);
            return this.coopDefenseBalanceTracker.hasRound(roundEndedAt, roundIdentity);
          },
        });
        overlay.hide();
        // Nur den naechsten Update freigeben: kein Abbau im Tween- oder Render-Callback.
        this.arenaExitRenderListener = () => {
          this.arenaExitRenderListener = null;
          this.arenaExitResultsRendered = true;
        };
        this.game.events.once(Phaser.Core.Events.POST_RENDER, this.arenaExitRenderListener);
      });
      return true;
    }
    if (outcome !== 'syncing') {
      this.arenaExitFadeComplete = true;
      return false;
    }

    // Selten kommen Phasenstatus und Ergebnis-Snapshot in getrennten Netzwerkticks an.
    // Kurz auf den semantischen Ausgang warten, aber bei einem unvollstaendigen Snapshot
    // niemals dauerhaft in der letzten Arenaansicht haengenbleiben.
    if (this.arenaExitOutcomeWaitStartedAt === 0) {
      this.arenaExitOutcomeWaitStartedAt = this.time.now;
    }
    if (this.time.now - this.arenaExitOutcomeWaitStartedAt < 1_200) return true;

    this.arenaExitFadeComplete = true;
    return false;
  }

  /** Einmaliger Endsnapshot vor dem Round-Teardown; nie Teil von update-Hotpaths. */
  private prepareCoopDefenseBalanceRound(outcome: 'victory' | 'defeat'): void {
    const gameMode = this.resolveConfiguredGameMode('ARENA');
    if (!isCoopDefenseMode(gameMode)) return;
    const roundState = bridge.getRoundState();
    if (!roundState || roundState.coopDefenseHumanPlayerCount !== 1) return;
    const mapConfig = this.resolveConfiguredCoopDefenseMapConfig('ARENA');
    if (!mapConfig) return;
    const localPlayerId = bridge.getLocalPlayerId();
    const localPlayerState = this.ctx.getWorldCombatCore()!;
    const baseSummary = this.arenaRuntime?.getCoopDefenseBaseHpSummary() ?? {
      ownBase: null,
      hostileBase: null,
    };
    const ownBase = baseSummary.ownBase;
    const hostileBase = baseSummary.hostileBase;
    const storedProgress = this.meta!.getStoredProgress();
    const committed = bridge.getPlayerCommittedLoadout(localPlayerId);
    this.coopDefenseBalanceTracker.preparePendingRound({
      gameMode,
      roundState,
      ...(roundState.roundRevision === undefined ? {} : {
        roundIdentity: { roomCode: bridge.getRoomCode(), roundRevision: roundState.roundRevision },
      }),
      mapConfig,
      outcome,
      sharedXp: bridge.getCoopDefenseRoundXp(),
      frags: bridge.getPlayerFrags(localPlayerId),
      playerHp: localPlayerState.getHP(localPlayerId),
      playerMaxHp: localPlayerState.getMaxHp(localPlayerId),
      armor: localPlayerState.getArmor(localPlayerId),
      ownMainBaseHp: ownBase?.hp ?? null,
      ownMainBaseMaxHp: ownBase?.maxHp ?? null,
      hostileMainBaseHp: hostileBase?.hp ?? null,
      hostileMainBaseMaxHp: hostileBase?.maxHp ?? null,
      survivalRemainingRespawns: bridge.getLocalCoopDefenseRespawnBudgetState()?.remainingRespawns ?? null,
      build: buildBalanceBuildSnapshot(
        storedProgress.totalXp,
        this.meta!.getProgress().level,
        committed,
      ),
    });
  }

  private openBalanceFeedback(): void {
    const presentation = this.meta?.getLastMatchResultsPresentation();
    if (!presentation || !isCoopDefenseMode(presentation.mode)) return;
    const roundEndedAt = presentation.leaderboard[0]?.roundEndedAt;
    if (!roundEndedAt || !this.coopDefenseBalanceTracker.hasRound(roundEndedAt, presentation.roundIdentity)) return;
    this.coopDefenseBalanceReportOverlay?.showFeedback(roundEndedAt, presentation.roundIdentity);
  }
}
