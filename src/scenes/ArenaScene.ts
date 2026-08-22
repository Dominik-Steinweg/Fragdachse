import * as Phaser from 'phaser';
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
import { preloadCanopyAssets }   from '../arena/CanopyConfig';
import { preloadArenaDecalAssets } from '../arena/DecalConfig';
import { preloadGroundCoverAssets } from '../arena/GroundCoverConfig';
import { preloadRockMossAssets } from '../arena/RockMossConfig';
import { preloadRockVegetationAssets } from '../arena/RockVegetationConfig';
import { preloadTurretVisualAssets } from '../config/turretVisuals';
import { MENU_ARENA_PREVIEW_CONFIG } from '../arena/MenuArenaPreviewConfig';
import { MenuArenaPreviewRenderer } from '../arena/MenuArenaPreviewRenderer';
import { LobbyAmbientRuntime } from '../lobby/LobbyAmbientRuntime';
import { PlayerManager }         from '../entities/PlayerManager';
import { ProjectileManager }     from '../entities/ProjectileManager';
import { InputSystem }           from '../systems/InputSystem';
import { HostPhysicsSystem }     from '../systems/HostPhysicsSystem';
import { CombatSystem }          from '../systems/CombatSystem';
import { DecoySystem }           from '../systems/DecoySystem';
import { EffectSystem }          from '../effects/EffectSystem';
import { VisualFeedbackDirector } from '../effects/VisualFeedbackDirector';
import { CAMERA_FEEDBACK_LIMITS } from '../effects/camera/CameraFeedbackModel';
import { getCameraBaseScroll, getUnshakenPointerWorldPoint, setCameraBaseScroll } from '../graphics/cameraBaseScroll';
import { ClarityCameraRegistry } from './arena/ClarityCameraRegistry';
import { getProjectileLightSpec, LIGHT_PRESETS } from '../effects/LightingConfig';
import { mixColors }             from '../effects/EffectUtils';
import { SmokeSystem }           from '../effects/SmokeSystem';
import { FireSystem }            from '../effects/FireSystem';
import { StinkCloudSystem }      from '../effects/StinkCloudSystem';
import { preloadAllAudio }        from '../audio/AudioCatalog';
import { GameAudioSystem }        from '../audio/GameAudioSystem';
import { AimSystem, UtilityChargeIndicator } from '../ui/AimSystem';
import { ScopeOverlay } from '../ui/ScopeOverlay';
import { ArenaCountdownOverlay, type ArenaLoadingScreenState } from '../ui/ArenaCountdownOverlay';
import { EnemyHoverNameLabel }  from '../ui/EnemyHoverNameLabel';
import { HostileBaseIndicator, getVisibleWorldView } from '../ui/HostileBaseIndicator';
import { countSceneDisplayObjects, forEachSceneDisplayObject } from './arena/sceneDisplayObjects';
import { PlayerStatusRing }      from '../ui/PlayerStatusRing';
import { CoopDefenseXpDebugOverlay } from '../ui/CoopDefenseXpDebugOverlay';
import { CoopDefenseBalanceReportOverlay } from '../ui/CoopDefenseBalanceReportOverlay';
import { CoopDefenseBalanceTracker, buildBalanceBuildSnapshot } from '../debug/coopDefenseBalance/tracker';
import { TimeOfDayDebugOverlay } from '../ui/TimeOfDayDebugOverlay';
import { DEFAULT_TIME_OF_DAY_MINUTES, resolveSkyState } from '../effects/TimeOfDay';
import type { WorldGradeInputs } from '../effects/postfx/worldGrade';
import { NetDebugOverlay }          from '../ui/NetDebugOverlay';
import { CoopDefenseUpgradesOverlay } from '../ui/CoopDefenseUpgradesOverlay';
import { MatchResultsOverlay } from '../ui/MatchResultsOverlay';
import { RoomStatisticsOverlay } from '../ui/RoomStatisticsOverlay';
import { ArenaExitFadeOverlay } from '../ui/ArenaExitFadeOverlay';
import { CoopDefenseItemRewardOverlay } from '../ui/CoopDefenseItemRewardOverlay';
import {
  COOP_DEFENSE_ITEM_ART_LEVELS,
  COOP_DEFENSE_ITEM_ART_SLOTS,
  getCoopDefenseItemArtKey,
  getCoopDefenseItemEmptyArtKey,
} from '../ui/coopDefenseItemIcons';
import {
  CoopDefenseItemsOverlay,
  type CoopDefenseItemsOverlayState,
} from '../ui/CoopDefenseItemsOverlay';
import {
  createMatchItemRewardPresentation,
  createMatchProgressDelta,
  resolveCoopDefenseEpicGuaranteeCount,
  resolvePersonalMatchOutcome,
  sortMatchLeaderboard,
  type MatchItemRewardPresentation,
  type MatchProgressDelta,
  type MatchResultsPresentation,
} from '../ui/MatchResultsModel';
import { LeftSidePanel }         from '../ui/LeftSidePanel';
import { RightSidePanel }        from '../ui/RightSidePanel';
import { CenterHUD }             from '../ui/CenterHUD';
import { CoopDefenseObjectiveAnnouncement } from '../ui/CoopDefenseObjectiveAnnouncement';
import { CoopDefenseMapEventAnnouncementPresenter } from '../ui/CoopDefenseMapEventAnnouncementPresenter';
import { CoopDefenseSecondaryObjectiveHud } from '../ui/CoopDefenseSecondaryObjectiveHud';
import { buildMainObjectiveViewModel } from '../ui/coopDefenseMainObjectiveModel';
import { LobbyOverlay }          from './LobbyOverlay';
import { BootScreen }             from '../ui/BootScreen';
import { RoomQualityMonitor }    from '../network/RoomQualityMonitor';
import {
  ARENA_COUNTDOWN_SEC, ARENA_DURATION_SEC,
  PLAYER_COLORS, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH, ARENA_HEIGHT, ARENA_MAX_X, ARENA_MAX_Y, ARENA_VIEWPORT_WIDTH, ARENA_VIEWPORT_HEIGHT, GAME_WIDTH, GAME_HEIGHT, CELL_SIZE, COLORS, DEPTH,
  NET_SMOOTH_TIME_MS,
  ACTIVE_ARENA_METRICS_PROFILE,
  applyArenaMetricsForMode,
} from '../config';
import { DEFAULT_LOADOUT, LOADOUT_CATALOG_ENTRIES, WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../loadout/LoadoutConfig';
import { preloadHeldItemAssets } from '../loadout/HeldItemVisuals';
import { preloadTrainMaterialAssets } from '../train/TrainRenderer';
import {
  preloadBadgerAnimationAssets,
  registerBadgerAnimations,
} from '../animations/BadgerAnimations';
import { resolveLoadoutSelectionIds } from '../loadout/LoadoutRules';
import type { PlaceableTurretUtilityConfig, PlaceableUtilityConfig } from '../loadout/LoadoutConfig';
import { copyRoomShareUrl, rejoinCurrentRoom, restartWithNewRoom } from '../utils/roomQuality';
import { WebGLRectMaskTexture } from '../utils/webglRectMask';
import { coversDesignSpace } from './arena/ArenaClipPolicy';
import {
  addStoredCoopDefenseXp,
  getStoredCoopDefenseProgress,
  getStoredEffectsVolume,
  getStoredGraphicsQuality,
  getStoredMasterVolume,
  getStoredMusicVolume,
  markStoredCoopDefenseBossMapCompleted,
  markStoredCoopDefenseItemsSeen,
  markStoredCoopDefenseRoundProcessed,
  resetStoredCoopDefenseCharacter,
  restoreStoredCoopDefenseProgress,
  setStoredCoopDefenseCheatProgress,
  getStoredCoopDefenseLoadout,
  setStoredCoopDefenseClassesUnlocked,
  setStoredCoopDefenseLoadoutSlot,
  switchStoredCoopDefenseClassLoadout,
  setStoredLoadoutSlot,
  setStoredCoopDefenseUpgradeProfile,
  resetStoredCoopDefenseUpgradeProfiles,
  claimStoredPendingCoopDefenseItemReward,
  equipStoredCoopDefenseItem,
  getStoredCoopDefenseItemsUnlocked,
  salvageStoredCoopDefenseItem,
  setStoredPendingCoopDefenseItemReward,
  unequipStoredCoopDefenseItem,
  unlockStoredCoopDefenseClassesAfterVictory,
  unlockStoredCoopDefenseItemsAfterVictory,
  unlockStoredCoopDefenseMapAfterVictory,
  type CoopDefenseProgressPreferences,
} from '../utils/localPreferences';
import {
  applyCoopDefenseEpicGuarantee,
  getEquippedCoopDefenseItems,
  rollCoopDefenseItemOffer,
} from '../utils/coopDefenseItems';
import { GraphicsQualityController } from '../graphics/GraphicsQuality';
import { getRenderResolutionController, toDesignSpace } from '../graphics/RenderResolution';
import { installTextResolution } from '../graphics/TextResolution';
import { getCoopDefenseProgressSnapshot, type CoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';
import {
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  buildDefaultCoopDefenseUpgradeProfile,
  levelDownCoopDefenseUpgrade,
  levelUpCoopDefenseUpgrade,
  respecCoopDefenseUpgradeCategory,
  getCoopDefenseUpgradeLoadoutSelection,
  getCoopDefenseUpgradeTextureKey,
  hasCoopDefenseDedicatedUpgradeIcon,
  getUnlockedCoopDefenseConstructionIds,
  getUnlockedLoadoutToolRefs,
  getCoopDefenseToolCapacity,
  setLoadoutToolSlots,
  getSpentCoopDefenseUpgradePoints,
  getSpentCoopDefenseBossPoints,
  type CoopDefenseUpgradeCategoryId,
} from '../utils/coopDefenseUpgrades';
import { COOP_DEFENSE_TUTORIAL_DURATION_MS } from '../config/coopDefenseTutorial';
import { COOP_DEFENSE_CLASS_IDS, DEFAULT_COOP_DEFENSE_CLASS_ID } from '../config/coopDefenseClasses';
import type { CoopDefenseClassId, CoopDefenseItemRewardAction, GamePhase, LoadoutCommitSnapshot, LoadoutSlot, LoadoutToolRef, LoadoutUseResult, LobbyLoadoutPreviewState, PlayerProfile, RoomQualitySnapshot, SyncedProjectile, SyncedTrainState } from '../types';
import { TRAIN } from '../train/TrainConfig';
import { getTrainArrivalCountdownSecs } from '../train/TrainEvent';
import { TrainLightOccluderSource } from '../train/TrainLightOccluderSource';
import { isCoopDefenseMode, isTeamGameMode } from '../gameModes';
import { getCoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { getLocale, t } from '../i18n';
import { getLocalizedGameModeLabel } from '../i18n/gameModePresentation';
import { getMapName, getMapTutorial } from '../i18n/contentPresentation';
import { INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID } from '../config/coopDefenseMapUnlocks';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../config/coopDefenseEnemies';
import { COOP_DEFENSE_DISMANTLE_RANGE, getCoopDefenseConstructionDefinition, isConstructionId } from '../config/coopDefenseConstructions';
import { getSelectableLoadoutItems } from '../loadout/LoadoutCatalog';
import { TunnelRenderer } from './arena/TunnelRenderer';
import { EnemyFlowFieldDebugOverlay } from './arena/EnemyFlowFieldDebugOverlay';
import { ArenaRuntimeProfiler } from './arena/ArenaRuntimeProfiler';
import { PerformanceAblationController } from './arena/PerformanceAblation';
import { PerformanceDiagnosticsOverlay } from '../ui/PerformanceDiagnosticsOverlay';
import { advanceSpectatorCameraScroll } from './arena/SpectatorCameraModel';
import { dequantizeAngle } from '../utils/angle';
import type { FlowFieldDiagnostics } from '../systems/flowfield/FlowFieldCoordinator';
import type { PersistentGpuWorldDiagnostics } from '../arena/rocks/PersistentGpuWorldSystem';

import {
  type ArenaContext,
  type RendererBundle,
  LocalPlayerState,
  RockVisualHelper,
  PlacementPreviewRenderer,
  ClientUpdateCoordinator,
  HostUpdateCoordinator,
  RpcCoordinator,
  ArenaLifecycleCoordinator,
  GaussWarningRenderer,
  createRendererBundle,
  wireRenderersToProjManager,
  wireRenderersToEffectSystem,
  wireRenderersToAudioSystem,
  wireRenderersToCameraFeedback,
  wireRenderersToDistortion,
} from './arena';

function resolveSpawnProjectileDangerRadius(projectile: SyncedProjectile): number {
  const baseRadius = Math.max(CELL_SIZE * 2, projectile.size * 4);

  switch (projectile.style) {
    case 'rocket':
    case 'bfg':
      return Math.max(baseRadius, CELL_SIZE * 4);
    case 'grenade':
    case 'holy_grenade':
      return Math.max(baseRadius, CELL_SIZE * 3.5);
    case 'energy_ball':
    case 'hydra':
    case 'spore':
      return Math.max(baseRadius, CELL_SIZE * 3);
    case 'flame':
      return Math.max(baseRadius, CELL_SIZE * 1.5);
    default:
      return baseRadius;
  }
}

/** Eine feste Lampe am Zug, relativ zur Mitte ihres Segments. */
interface TrainLamp {
  readonly key: string;
  readonly offsetX: number;
  readonly offsetY: number;
  /** Index in `TrainRenderer.computeSegYs()`: 0 = Lok, danach die Waggons. */
  readonly segment: number;
  /**
   * `offsetY` relativ zur Fahrtrichtung statt absolut. Für Lampen, die immer vorne am
   * Segment sitzen (Lok-Kabinenfenster): + zeigt zur Nase, egal ob der Zug nach Norden
   * oder Süden fährt.
   */
  readonly frontRelative?: boolean;
}

interface TrainLightPlan {
  readonly headlights: readonly TrainLamp[];
  readonly windows: readonly TrainLamp[];
}

interface TransportPerformanceCounts {
  linkCount: number;
  backpressureLinkCount: number;
  reliableBufferedBytes: number;
  fastBufferedBytes: number;
  droppedFastMessages: number;
  sentBytesPerSec: number;
  receivedBytesPerSec: number;
  medianRttMs: number;
  medianAppPingMs: number;
  sampleMs: number;
}

export class ArenaScene extends Phaser.Scene {
  // ── Phaser-scoped objects (must stay in scene) ────────────────────────────
  private arenaBuilder!: ArenaBuilder;
  private arenaClipMask: WebGLRectMaskTexture | null = null;
  private utilityChargeIndicator: UtilityChargeIndicator | null = null;
  private ultimateChargeIndicator: UtilityChargeIndicator | null = null;
  private playerStatusRing: PlayerStatusRing | null = null;
  private enemyHoverNameLabel: EnemyHoverNameLabel | null = null;
  private hostileBaseIndicator: HostileBaseIndicator | null = null;
  private objectiveAnnouncements: CoopDefenseObjectiveAnnouncement | null = null;
  private mapEventAnnouncementPresenter: CoopDefenseMapEventAnnouncementPresenter | null = null;
  private removeReconnectStatusListener: (() => void) | null = null;
  private secondaryObjectiveHud: CoopDefenseSecondaryObjectiveHud | null = null;
  private scopeOverlay: ScopeOverlay | null = null;
  private menuArenaPreview: MenuArenaPreviewRenderer | null = null;
  /** Lokale Lobby-Inszenierung. Kein Netzwerkzustand, kein Einfluss auf den Matchstart. */
  private lobbyAmbient: LobbyAmbientRuntime | null = null;
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
  /** Links/rechts am Zug – als Konstante, damit die Licht-Keys stabil bleiben. */
  private static readonly TRAIN_LIGHT_SIDES = [-1, 1] as const;
  private trainLightPlan: TrainLightPlan | null = null;
  private trainLightsActive = false;
  private readonly trainLightOccluders = new TrainLightOccluderSource();
  private flashlightsActive = false;
  /** Zwei getauschte Sets statt Neuallokation pro Frame: Projektile wechseln schnell. */
  private activeProjectileLightIds = new Set<number>();
  private projectileLightScratch = new Set<number>();
  private placementPreview!: PlacementPreviewRenderer;
  private tunnelRenderer!: TunnelRenderer;
  private gaussWarning!: GaussWarningRenderer;
  private hostUpdate!: HostUpdateCoordinator;
  private clientUpdate!: ClientUpdateCoordinator;
  private rpcCoordinator!: RpcCoordinator;
  private lifecycle!: ArenaLifecycleCoordinator;

  // ── Lobby / Room-quality (not round-scoped) ───────────────────────────────
  private lobbyOverlay!: LobbyOverlay;
  private roomQualityMonitor!: RoomQualityMonitor;
  private roomQualitySnapshot: RoomQualitySnapshot | null = null;
  private lastCameraScrollX = 0;
  private lastCameraScrollY = 0;
  private spectatorCameraScrollX = 0;
  private spectatorCameraScrollY = 0;
  private spectatorCameraLeftKey: Phaser.Input.Keyboard.Key | null = null;
  private spectatorCameraRightKey: Phaser.Input.Keyboard.Key | null = null;
  private spectatorCameraUpKey: Phaser.Input.Keyboard.Key | null = null;
  private spectatorCameraDownKey: Phaser.Input.Keyboard.Key | null = null;
  private arenaPanelTabKey: Phaser.Input.Keyboard.Key | null = null;
  private coopDefenseDebugDamageKey: Phaser.Input.Keyboard.Key | null = null;
  private arenaPanelsHeld = false;
  private optionsHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private coopDefenseXpDebugHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private netDebugHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private performanceHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private timeOfDayHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private timeOfDayDebugOverlay: TimeOfDayDebugOverlay | null = null;
  private forceStaticTimeOfDayBake = false;
  private netDebugOverlay: NetDebugOverlay | null = null;
  private performanceDiagnosticsOverlay: PerformanceDiagnosticsOverlay | null = null;
  private flowFieldDebugOverlay: EnemyFlowFieldDebugOverlay | null = null;
  private coopDefenseXpDebugOverlay: CoopDefenseXpDebugOverlay | null = null;
  private coopDefenseBalanceTracker!: CoopDefenseBalanceTracker;
  private coopDefenseBalanceReportOverlay: CoopDefenseBalanceReportOverlay | null = null;
  private coopDefenseUpgradesOverlay: CoopDefenseUpgradesOverlay | null = null;
  private matchResultsOverlay: MatchResultsOverlay | null = null;
  private roomStatisticsOverlay: RoomStatisticsOverlay | null = null;
  private arenaExitFadeOverlay: ArenaExitFadeOverlay | null = null;
  private arenaExitFadeComplete = false;
  private arenaExitOutcomeWaitStartedAt = 0;
  private coopDefenseProgress: CoopDefenseProgressSnapshot = getCoopDefenseProgressSnapshot(0);
  // Profil-Stand beim Oeffnen des Upgrade-Overlays – fuer "Abbruch" (Wiederherstellen).
  private coopDefenseUpgradeProfileSnapshot: CoopDefenseProgressPreferences | null = null;
  private coopDefenseLastProcessedRoundEndedAt: number | null = null;
  private coopDefenseHighestUnlockedMapId: string = INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID;
  private coopDefenseItemsUnlocked = false;
  private coopDefenseHasPendingItemReward = false;
  private coopDefenseHasUnseenItems = false;
  private lastObservedGamePhase: GamePhase | null = null;
  private matchResultsPending = false;
  private matchResultsProgressBefore: CoopDefenseProgressSnapshot | null = null;
  /**
   * Die zuletzt ausgewertete Runde, exakt so wie sie am Rundenende gezeigt wurde. Der Knopf
   * "Letzte Runde" im Lobby-Panel spielt genau diese Praesentation erneut ab; der Fortschritt
   * darin ist bereits verbucht und wird beim Wiederholen weder neu berechnet noch gespeichert.
   */
  private lastMatchResultsPresentation: MatchResultsPresentation | null = null;
  private itemRewardOverlay: CoopDefenseItemRewardOverlay | null = null;
  private itemsOverlay: CoopDefenseItemsOverlay | null = null;
  private lastLobbySidebarSignature: string | null = null;
  private runtimeProfiler: ArenaRuntimeProfiler | null = null;
  private performanceAblation: PerformanceAblationController | null = null;
  private graphicsQuality!: GraphicsQualityController;
  private lastScenePerformanceCountAtMs = Number.NEGATIVE_INFINITY;
  private scenePerformanceCounts = {
    visibleObjectCount: 0,
    willRenderObjectCount: 0,
    inCameraBoundsObjectCount: 0,
    hiddenObjectCount: 0,
    particleEmitterCount: 0,
    aliveParticleCount: 0,
    activeFilterCount: 0,
    internalFilterCount: 0,
    externalFilterCount: 0,
    filteredObjectCount: 0,
    cameraFilterCount: 0,
    scanMs: 0,
    filterBreakdown: null as string | null,
  };
  private lastTransportPerformanceSampleAtMs = Number.NEGATIVE_INFINITY;
  private lastTransportByteSampleAtMs = Number.NEGATIVE_INFINITY;
  private lastTransportBytesSent = 0;
  private lastTransportBytesReceived = 0;
  private transportPerformanceCounts: TransportPerformanceCounts = {
    linkCount: 0,
    backpressureLinkCount: 0,
    reliableBufferedBytes: 0,
    fastBufferedBytes: 0,
    droppedFastMessages: 0,
    sentBytesPerSec: 0,
    receivedBytesPerSec: 0,
    medianRttMs: 0,
    medianAppPingMs: 0,
    sampleMs: 0,
  };
  private nextCompanionSubsystemSampleAtMs = 0;
  private companionBaselineRecordingId = -1;
  private companionFlowfieldSource: object | null = null;
  private companionRockSource: object | null = null;
  private companionVfxSource: object | null = null;
  private companionBackpressureActive = false;
  private companionFlowfieldCounters = {
    startedJobs: 0,
    workerComputeTotalMs: 0,
    roundTripTotalMs: 0,
  };
  private companionStaleFlowfields = new Set<string>();
  private companionFlowfieldGauge = { ageMs: 0, queueDepth: 0 };
  private companionRockCounters = {
    dirtyRocks: 0,
    affectedPages: 0,
    sparseUploads: 0,
    fullUploads: 0,
    uploadBytes: 0,
  };
  private companionRockInterval = { ...this.companionRockCounters };
  private companionVfxCounters = { spawns: 0, capacityDrops: 0 };
  private companionVfxInterval = { ...this.companionVfxCounters };
  private companionVisiblePages = 0;
  private companionActiveVfx = 0;

  constructor() {
    super({ key: 'ArenaScene' });
  }

  preload(): void {
    BootScreen.setStatus(t('ui.boot.loadingData'));
    BootScreen.setProgress(0);

    const onProgress = (ratio: number) => {
      BootScreen.setProgress(ratio);
    };

    const cleanupLoader = () => {
      this.load.off(Phaser.Loader.Events.PROGRESS, onProgress);
    };

    this.load.on(Phaser.Loader.Events.PROGRESS, onProgress);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      cleanupLoader();
      BootScreen.setStatus(t('ui.boot.preparingLobby'));
      BootScreen.setProgress(1);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanupLoader);

    preloadAllAudio(this.load);
    // Beide Boden-Kacheln stammen aus scripts/generate-grass-tiles.mjs; die Detailkachel liegt
    // als Multiply-Ebene darueber und bricht die Periode der Basiskachel (siehe ArenaBackground).
    this.load.image('gras_bg_tile', './assets/sprites/gras_bg_tile.png');
    this.load.image('gras_detail_tile', './assets/sprites/gras_detail_tile.png');
    this.load.image('lobby_bg', './assets/sprites/lobby_bg.png');
    this.load.image('bg_tracks',  './assets/sprites/64x32tracks.png');
    this.load.spritesheet('rocks', './assets/sprites/rocks47blob.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('rock_mottle', './assets/sprites/rocks47blob_alt.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('dirt',  './assets/sprites/dirt47blob.png',  { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('dirt_mottle', './assets/sprites/dirt47blob_alt.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('base',  './assets/sprites/base47blob.png',  { frameWidth: 32, frameHeight: 32 });
    // Rote Variante fuer Gegnerbasen (scripts/generate-hostile-base-sheet.mjs). Gleiche
    // Frame-Indizes, daher unveraenderte Autotile-Logik.
    this.load.spritesheet('base_hostile', './assets/sprites/base47blob_hostile.png', { frameWidth: 32, frameHeight: 32 });
    preloadArenaDecalAssets(this.load);
    preloadGroundCoverAssets(this.load);
    preloadRockMossAssets(this.load);
    preloadRockVegetationAssets(this.load);
    preloadTurretVisualAssets(this.load);
    preloadCanopyAssets(this.load);
    preloadTrainMaterialAssets(this.load);
    this.load.image('powerup_hp',  './assets/sprites/16x16HP.png');
    this.load.image('powerup_arm', './assets/sprites/16x16Armor.png');
    this.load.image('powerup_adr', './assets/sprites/16x16adrenalin.png');
    this.load.image('powerup_dam', './assets/sprites/16x16damageamp.png');
    this.load.image('powerup_hhg', './assets/sprites/16x16holy_grenade.png');
    this.load.image('powerup_nuk', './assets/sprites/16x16nuke.png');
    this.load.image('powerup_bfg', './assets/sprites/16x16bfg.png');
    this.load.image('mission_reward_pedestal', './assets/sprites/mission_reward_pedestal.png');
    this.load.image('mission_reward_pickup', './assets/sprites/mission_reward_pickup.png');
    this.load.image('mission_carry_spawn_zone', './assets/sprites/objectives/mission_carry_spawn_zone.png');
    this.load.image('mission_carry_delivery_zone', './assets/sprites/objectives/mission_carry_delivery_zone.png');
    // Die waffenlose Fassung der Figur. Die getragene Waffe ist seit `HeldItemVisual` ein eigenes
    // Bild; `32x32dachsweapon01.png` mit den braunen Platzhalterpixeln wird nicht mehr geladen.
    this.load.image('badger',      './assets/sprites/32x32dachs.png');
    preloadBadgerAnimationAssets(this.load);
    preloadHeldItemAssets(this.load);
    // Mehrere Gegner-Arten duerfen sich dasselbe Sprite teilen (Varianten unterscheiden sich nur
    // ueber die Einfaerbung), deshalb wird jeder Key nur einmal in die Ladeschlange gestellt.
    const enemyImageKeys = new Set(
      Object.values(COOP_DEFENSE_ENEMY_CONFIGS).map((enemyConfig) => enemyConfig.imageKey),
    );
    for (const imageKey of enemyImageKeys) {
      this.load.image(imageKey, `./assets/sprites/enemies/${imageKey}.png`);
    }
    this.load.atlas('dachs_death', './assets/player/dachs_death_ani3.png', './assets/player/dachs_death_ani3.json');

    // Katalogmetadaten bestimmen explizit Auswahlreihenfolge und vorhandene Icons.
    const queuedLoadoutIcons = new Set<string>();
    for (const entry of LOADOUT_CATALOG_ENTRIES) {
      if (!entry.iconKey || queuedLoadoutIcons.has(entry.iconKey)) continue;
      queuedLoadoutIcons.add(entry.iconKey);
      this.load.image(entry.iconKey, `./assets/sprites/Loadout/${entry.iconKey}.png`);
    }

    // Upgrade-Icons direkt aus den Definitionen ableiten, damit neue Upgrades
    // automatisch geladen werden (kein manuelles Pflegen einer Liste noetig).
    const queuedUpgradeTextures = new Set<string>();
    for (const definition of Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)) {
      // Dedicated upgrade-tree artwork also covers unlock nodes that should not fall back to
      // the corresponding loadout-item icon.
      if (definition.kind !== 'upgrade' && !hasCoopDefenseDedicatedUpgradeIcon(definition.id)) continue;
      const key = getCoopDefenseUpgradeTextureKey(definition.id);
      if (key === null) continue;
      if (queuedUpgradeTextures.has(key)) continue;
      queuedUpgradeTextures.add(key);
      this.load.image(key, `./assets/sprites/Loadout/${key}.png`);
    }

    for (const slot of COOP_DEFENSE_ITEM_ART_SLOTS) {
      const emptyKey = getCoopDefenseItemEmptyArtKey(slot);
      this.load.image(emptyKey, `./assets/sprites/coop-defense/${emptyKey}.png`);
      for (const itemLevel of COOP_DEFENSE_ITEM_ART_LEVELS) {
        const key = getCoopDefenseItemArtKey(slot, itemLevel);
        this.load.image(key, `./assets/sprites/coop-defense/${key}.png`);
      }
    }
  }

  create(): void {
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
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clarityRegistry?.destroy();
      this.clarityRegistry = null;
      this.clarityCamera = null;
    });
    this.bindCameraToDesignSpace();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.bindCameraToDesignSpace, this);
    const uninstallTextResolution = installTextResolution(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.bindCameraToDesignSpace, this);
      uninstallTextResolution();
    });

    this.graphicsQuality = new GraphicsQualityController(getStoredGraphicsQuality());
    this.graphicsQuality.attach(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.graphicsQuality.destroy());
    this.graphicsQuality.subscribe((profile) => {
      getRenderResolutionController()?.setMaxRenderScale(profile.maxRenderScale);
    });
    getRenderResolutionController()?.setMaxRenderScale(this.graphicsQuality.getProfile().maxRenderScale);
    this.runtimeProfiler = new ArenaRuntimeProfiler();
    this.runtimeProfiler.attachGame(this.game);
    bridge.setPayloadDiagnosticsSink((info) => this.runtimeProfiler?.recordNetworkPayload(info));
    const unsubscribeProfilerRecording = this.runtimeProfiler.subscribeRecording((recordingId) => {
      this.seedCompanionBaselines(recordingId);
    });
    this.performanceAblation = new PerformanceAblationController(this, {
      onTraceEvent: (type, fields) => this.runtimeProfiler?.recordSemanticEvent(type, fields),
      getQualityController: () => this.graphicsQuality,
      getShadowSystem: () => this.renderers?.shadow ?? null,
      getLightingSystem: () => this.renderers?.lighting ?? null,
      getPostFxController: () => this.visualFeedback?.postFx ?? null,
      getGpuParticleSuppressor: () => this.renderers?.gpuVfx ?? null,
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.performanceAblation?.destroy());
    const unsubscribePerformanceQuality = this.graphicsQuality.subscribe((profile, previous) => {
      this.runtimeProfiler?.recordQualityChange(previous, profile.level);
    });
    this.performanceDiagnosticsOverlay = new PerformanceDiagnosticsOverlay(
      this.runtimeProfiler,
      () => this.describePerformanceEnvironment(),
      this.performanceAblation,
      {
        getState: () => ({
          staticShadows: this.renderers?.shadow?.isStaticVisible() ?? true,
          groundSurface: this.ctx?.arenaResult?.groundSurface?.isVisible() ?? true,
          rockOverlay: this.ctx?.arenaResult?.rockOverlaySurface?.isVisible() ?? true,
          chunkSampling: this.renderers?.shadow?.getSamplingMode()
            ?? this.ctx?.arenaResult?.groundSurface?.getSamplingMode()
            ?? 'default',
          rockRenderer: this.ctx?.arenaResult?.rockVisualSystem.getMode() ?? getRockRendererMode(),
          rockGpuPageSize: this.ctx?.arenaResult?.rockVisualSystem.getPageSize() ?? getRockGpuPageSize(),
          rockGpu: this.ctx?.arenaResult?.rockVisualSystem.getGpuDiagnostics() ?? null,
        }),
        setStaticShadowsVisible: (visible) => this.renderers?.shadow?.setStaticVisible(visible),
        setGroundSurfaceVisible: (visible) => this.ctx?.arenaResult?.groundSurface?.setVisible(visible),
        setRockOverlayVisible: (visible) => this.ctx?.arenaResult?.rockOverlaySurface?.setVisible(visible),
        setChunkSampling: (mode) => {
          this.renderers?.shadow?.setSamplingMode(mode);
          this.ctx?.arenaResult?.groundSurface?.setSamplingMode(mode);
          this.ctx?.arenaResult?.rockOverlaySurface?.setSamplingMode(mode);
        },
        setRockRenderer: (mode) => {
          setRockRendererMode(mode);
          this.ctx?.arenaResult?.rockVisualSystem.setMode(mode);
        },
        setRockGpuPageSize: (size) => {
          setRockGpuPageSize(size);
          this.ctx?.arenaResult?.rockVisualSystem.setPageSize(size);
        },
      },
      () => this.renderers?.gpuVfx.getStats() ?? null,
      () => this.captureSceneInspection(),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribePerformanceQuality();
      this.performanceDiagnosticsOverlay?.destroy();
      this.performanceDiagnosticsOverlay = null;
      this.runtimeProfiler?.destroy();
      bridge.setPayloadDiagnosticsSink(null);
      unsubscribeProfilerRecording();
      this.runtimeProfiler = null;
    });

    this.anims.create({
      key:       'player_death',
      frames:    this.anims.generateFrameNames('dachs_death', {
        prefix:  'Animation test (Dachs tot) (geist dunkler fade)-NEU ',
        suffix:  '.aseprite',
        start:   0,
        end:     37,
      }),
      frameRate: 60,
      repeat:    0,
    });
    registerBadgerAnimations(this.anims);

    bridge.clearPlayerCallbacks();
    this.input.mouse?.disableContextMenu();

    // ── Static arena (never destroyed) ────────────────────────────────────
    this.arenaBuilder = new ArenaBuilder(this);
    this.arenaBuilder.buildStatic(bridge.getGameMode(), bridge.getGamePhase());
    this.menuArenaPreview = new MenuArenaPreviewRenderer(this, MENU_ARENA_PREVIEW_CONFIG);
    this.menuArenaPreview.build();
    this.menuArenaPreview.setVisible(bridge.getGamePhase() === 'LOBBY');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.menuArenaPreview?.destroy();
      this.menuArenaPreview = null;
    });
    // ── Scene-lifetime systems ─────────────────────────────────────────────
    const playerManager    = new PlayerManager(this);
    playerManager.setLocalPlayerId(bridge.getLocalPlayerId());
    playerManager.setRelationshipResolver((localPlayerId, otherPlayerId) => bridge.isEnemyPair(localPlayerId, otherPlayerId));
    playerManager.setTeamResolver((playerId) => bridge.getPlayerTeam(playerId));
    const projectileManager = new ProjectileManager(this);
    const combatSystem     = new CombatSystem(playerManager, projectileManager, bridge);
    const decoySystem      = new DecoySystem(this, playerManager, bridge);
    const effectSystem     = new EffectSystem(this, bridge);
    const gameAudioSystem  = new GameAudioSystem(
      this,
      () => bridge.getLocalPlayerId(),
      () => {
        const sprite = playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
        return sprite ? { x: sprite.x, y: sprite.y } : null;
      },
      getStoredMasterVolume(),
      getStoredEffectsVolume(),
      getStoredMusicVolume(),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => gameAudioSystem.cleanup());
    const smokeSystem      = new SmokeSystem(this);
    const fireSystem       = new FireSystem(this);
    this.runtimeProfiler.subscribeDiagnostics((enabled) => {
      fireSystem.setPerformanceMetricsEnabled(enabled && this.runtimeProfiler?.wantsDetailedSampling() === true);
    });
    const stinkCloudSystem = new StinkCloudSystem(this);
    const hostPhysics      = new HostPhysicsSystem(this, playerManager, bridge, combatSystem);
    const inputSystem      = new InputSystem(
      this, bridge, () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
    );
    this.spectatorCameraLeftKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.A, false) ?? null;
    this.spectatorCameraRightKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D, false) ?? null;
    this.spectatorCameraUpKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.W, false) ?? null;
    this.spectatorCameraDownKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.S, false) ?? null;
    projectileManager.setAudioSystem(gameAudioSystem);
    effectSystem.setAudioSystem(gameAudioSystem);

    this.visualFeedback = new VisualFeedbackDirector(this, {
      getListener: () => {
        const sprite = playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
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
      if (player) {
        return {
          sprite: player.sprite,
          materialColor: player.color,
          knockbackFactor: 1,
          isLocalPlayer: targetId === bridge.getLocalPlayerId(),
        };
      }
      const enemy = this.ctx?.enemyManager?.getEnemy(targetId);
      if (enemy) {
        return {
          sprite: enemy.sprite,
          materialColor: enemy.getTintColor(),
          knockbackFactor: enemy.getKnockbackFactor(),
          isLocalPlayer: false,
        };
      }
      return null;
    });
    effectSystem.setHitFeedbackRenderer(this.visualFeedback.hitFeedback);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.visualFeedback?.destroy();
      this.visualFeedback = null;
    });

    // ── UI (scene-lifetime) ────────────────────────────────────────────────
    const leftPanel  = new LeftSidePanel(
      this,
      bridge,
      gameAudioSystem,
      this.graphicsQuality,
      () => this.handleImportedGameProgress(),
    );
    leftPanel.build();
    const rightPanel = new RightSidePanel(this);
    rightPanel.build();
    this.objectiveAnnouncements = new CoopDefenseObjectiveAnnouncement(this);
    this.objectiveAnnouncements.build();
    this.mapEventAnnouncementPresenter = new CoopDefenseMapEventAnnouncementPresenter(this.objectiveAnnouncements);
    const centerHUD  = new CenterHUD(this, this.objectiveAnnouncements);
    centerHUD.build();
    centerHUD.setPuContainer(leftPanel.getPuContainer());

    const aimSystem = new AimSystem(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
      (slot) => this.clientUpdate.getLocalWeaponConfig(slot),
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    this.scopeOverlay = new ScopeOverlay(this);
    this.runtimeProfiler.subscribeDiagnostics((enabled) => {
      this.scopeOverlay?.setPerformanceMetricsEnabled(enabled && this.runtimeProfiler?.wantsDetailedSampling() === true);
    });
    this.utilityChargeIndicator = new UtilityChargeIndicator(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    this.ultimateChargeIndicator = new UtilityChargeIndicator(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    this.playerStatusRing = new PlayerStatusRing(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
      () => this.localPlayerState?.alive ?? false,
      () => this.localPlayerState?.burrowed ?? false,
    );
    this.enemyHoverNameLabel = new EnemyHoverNameLabel(this);
    this.netDebugOverlay = new NetDebugOverlay(
      () => bridge.getTransportDiagnostics(),
      () => bridge.getRoomCode(),
      () => (bridge.isHost() ? `Host ${bridge.getLocalPlayerId()}` : `Client ${bridge.getLocalPlayerId()}`),
    );
    this.events.once('shutdown', () => this.netDebugOverlay?.destroy());
    this.coopDefenseBalanceTracker = new CoopDefenseBalanceTracker();
    this.coopDefenseBalanceReportOverlay = new CoopDefenseBalanceReportOverlay(
      this.coopDefenseBalanceTracker,
      () => {
        this.matchResultsOverlay?.setBalanceFeedbackVisible(true);
      },
    );
    this.coopDefenseXpDebugOverlay = new CoopDefenseXpDebugOverlay(
      () => {
        const stored = getStoredCoopDefenseProgress();
        return {
          totalXp: stored.totalXp,
          bossPoints: stored.completedBossMapIds.length,
          highestUnlockedMapId: stored.highestUnlockedMapId,
          classesUnlocked: stored.classesUnlocked,
        };
      },
      (totalXp, bossPoints, highestUnlockedMapId, classesUnlocked) => {
        setStoredCoopDefenseCheatProgress(totalXp, bossPoints, highestUnlockedMapId);
        setStoredCoopDefenseClassesUnlocked(classesUnlocked);
        this.refreshStoredCoopDefenseProgress();
        this.applyDefaultCoopDefenseMapSelection();
        this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
      },
      () => {
        resetStoredCoopDefenseCharacter();
        this.refreshStoredCoopDefenseProgress();
        this.applyDefaultCoopDefenseMapSelection();
        this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
        this.ctx.leftPanel.refreshColorIndicator();
      },
      () => this.coopDefenseBalanceTracker.isRecordingEnabled(),
      (enabled) => this.coopDefenseBalanceTracker.setRecordingEnabled(enabled),
      () => this.coopDefenseBalanceReportOverlay?.show(),
    );
    this.timeOfDayDebugOverlay = new TimeOfDayDebugOverlay(
      () => this.lifecycle.getCurrentTimeOfDayMinutes(),
      () => this.lifecycle.getAutomaticTimeOfDayMinutes(),
      (minutes, settled) => this.applyDebugTimeOfDay(minutes, settled),
      () => this.clearDebugTimeOfDay(),
    );
    this.coopDefenseUpgradesOverlay = new CoopDefenseUpgradesOverlay(
      this,
      () => this.coopDefenseProgress,
      (upgradeId) => this.levelUpCoopDefenseUpgrade(upgradeId),
      (upgradeId) => this.levelDownCoopDefenseUpgrade(upgradeId),
      (categoryId) => this.categoryRespecCoopDefenseUpgrades(categoryId),
      () => this.classRespecCoopDefenseUpgrades(),
      () => this.canFullRespecCoopDefenseUpgrades(),
      () => this.fullRespecCoopDefenseUpgrades(),
      (classId) => this.selectCoopDefenseClass(classId),
      (tool) => this.toggleLoadoutTool(tool),
      (tools) => this.setLoadoutTools(tools),
      () => this.getLocalLoadoutSelection(),
      (slot, itemId) => this.selectLoadoutItem(slot, itemId),
      () => this.cancelCoopDefenseUpgradeChanges(),
      () => this.applyCoopDefenseUpgradeChanges(),
    );
    this.coopDefenseUpgradesOverlay.build();
    this.itemRewardOverlay = new CoopDefenseItemRewardOverlay(
      this,
      (offerUid, salvageUid, action) => this.claimItemReward(offerUid, salvageUid, action),
      () => this.buildItemRewardPresentation(),
      () => {
        this.lobbyOverlay.setReadyButtonState(false);
        this.itemsOverlay?.refresh();
      },
    );
    this.itemRewardOverlay.build();
    this.itemsOverlay = new CoopDefenseItemsOverlay(
      this,
      () => this.getCoopDefenseItemsOverlayState(),
      (uid) => { equipStoredCoopDefenseItem(uid); this.afterCoopDefenseItemChange(); },
      (slot) => { unequipStoredCoopDefenseItem(slot); this.afterCoopDefenseItemChange(); },
      (uid) => { salvageStoredCoopDefenseItem(uid); this.afterCoopDefenseItemChange(); },
      () => this.openItemRewardOverlay(),
      () => this.lobbyOverlay.setReadyButtonState(false),
    );
    this.itemsOverlay.build();
    this.matchResultsOverlay = new MatchResultsOverlay(this, () => {
      // Die Netzwerkphase ist bereits LOBBY. Der lokale Layer gibt lediglich die darunter
      // vorbereitete Lobby frei; Ready bleibt durch den Host-Reset weiterhin false.
      this.lobbyOverlay.setReadyButtonState(false);
      // Eine offene Belohnung folgt direkt auf die Auswertung; sie bleibt sonst in der Lobby liegen.
      this.openItemRewardOverlay();
    }, () => this.openBalanceFeedback());
    this.matchResultsOverlay.build();
    this.roomStatisticsOverlay = new RoomStatisticsOverlay(this);
    this.roomStatisticsOverlay.build();
    this.arenaExitFadeOverlay = new ArenaExitFadeOverlay(this);
    this.arenaExitFadeOverlay.build();
    rightPanel.setResultsReplayHandler(() => this.replayMatchResults());
    rightPanel.setRoomStatisticsDetailHandler(() => {
      this.roomStatisticsOverlay?.show(bridge.getRoomPlayerStatistics());
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.arenaExitFadeOverlay?.destroy();
      this.arenaExitFadeOverlay = null;
      this.matchResultsOverlay?.destroy();
      this.coopDefenseBalanceReportOverlay?.destroy();
      this.coopDefenseBalanceReportOverlay = null;
      this.roomStatisticsOverlay?.destroy();
      this.roomStatisticsOverlay = null;
      this.itemRewardOverlay?.destroy();
      this.itemsOverlay?.destroy();
    });

    const arenaCountdown = new ArenaCountdownOverlay(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
      this.visualFeedback.postFx,
    );
    arenaCountdown.setAudioSystem(gameAudioSystem);

    // ── Assemble ArenaContext ──────────────────────────────────────────────
    this.ctx = {
      playerManager, projectileManager, combatSystem, effectSystem,
      visualFeedback: this.visualFeedback,
      gameAudioSystem,
      decoySystem,
      smokeSystem, fireSystem, stinkCloudSystem, hostPhysics, inputSystem,
      leftPanel, rightPanel, centerHUD, aimSystem, arenaCountdown,
      playerStatusRing: this.playerStatusRing,
      // Round-scoped (start null)
      arenaResult: null, currentLayout: null, placementSystem: null, reinforcementMatrixSystem: null, energyInjectorSystem: null, targetStatusSystem: null, rockRegistry: null, lightOccluderIndex: null, captureTheBeerSystem: null, baseManager: null, enemyManager: null,
      resourceSystem: null, burrowSystem: null, loadoutManager: null,
      powerUpSystem: null, detonationSystem: null, armageddonSystem: null, airstrikeSystem: null,
      shieldBuffSystem: null, energyShieldSystem: null,
      timeBubbleSystem: null,
      teslaDomeSystem: null, turretSystem: null, coopDefensePlayerModifierSystem: null, coopDefenseItemRuntimeSystem: null, guardianSpiritSystem: null, repairDroneSystem: null, slimeTrailSystem: null, flamethrowerUpgradeSystem: null, weaponUpgradeSystem: null, ak47StrategicTargetSystem: null, necromancySystem: null, coopDefenseEnemyAttackSystem: null, coopDefenseEnemyAbilitySystem: null, coopDefenseEnemyTrainAwarenessSystem: null, coopDefenseEnemyBurrowSystem: null, coopDefenseEnemyDodgeSystem: null, coopDefenseEnemyCombatPositioningSystem: null, coopDefenseVoidHunterSystem: null, coopDefenseTimebombSystem: null, coopDefenseSurvivalSystem: null, coopDefenseRoundStateSystem: null, coopDefenseSpawnExecutor: null, coopDefensePersistentPressureSystem: null, coopDefenseBossSystem: null, coopDefenseMapDirector: null, coopDefenseMapEventDirector: null, coopDefenseSecondaryObjectiveSystem: null, coopDefenseCarrySystem: null, coopDefenseTeamBuffSystem: null, coopDefenseSecondaryObjectiveConfigs: [], coopDefenseCarryItems: [], coopDefenseObjectiveRepairSystem: null, coopDefenseObjectivePlacementRewardSystem: null, translocatorSystem: null, tunnelSystem: null, trainManager: null,
      flowFieldCoordinator: null,
      enemyFlowFieldService: null,
      enemyPlayerFlowFieldService: null,
      enemyStrategicFlowFieldService: null,
      enemyAiTargetCatalog: null,
      enemyStrategicTargetService: null,
      enemyBossFlowFieldService: null,
      allyFlowFieldServices: new Map(),
    };

    playerManager.setSpawnContextProvider((playerId) => {
      const latestState = bridge.getLatestGameState();
      const runtimePlaceables = this.ctx.placementSystem?.getAllRuntimeRocks() ?? latestState?.placeableRocks ?? [];
      const turretRange = (UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig).placeable.targetRange;

      return {
        fires: latestState?.fires ?? [],
        stinkClouds: latestState?.stinkClouds ?? [],
        teslaDomes: latestState?.teslaDomes ?? [],
        nukes: latestState?.nukes ?? [],
        meteors: latestState?.meteors ?? [],
        turrets: runtimePlaceables
          .filter((placeable) => (
            placeable.kind === 'turret'
            && playerId !== null
            && combatSystem.canDamageTarget(placeable.ownerId, playerId)
          ))
          .map((placeable) => ({
            x: ARENA_OFFSET_X + placeable.gridX * CELL_SIZE + CELL_SIZE * 0.5,
            y: ARENA_OFFSET_Y + placeable.gridY * CELL_SIZE + CELL_SIZE * 0.5,
            ownerId: placeable.ownerId,
            range: placeable.targetRange ?? turretRange,
          })),
        projectiles: (latestState?.projectiles ?? [])
          .filter((projectile) => playerId !== null && combatSystem.canDamageTarget(projectile.ownerId, playerId, projectile.allowTeamDamage))
          .map((projectile) => ({
            x: projectile.x,
            y: projectile.y,
            ownerId: projectile.ownerId,
            radius: resolveSpawnProjectileDangerRadius(projectile),
          })),
        // Coop-Defense: Lebende Gegner mit ihrer effektiven Angriffsreichweite
        // veröffentlichen, damit der Spawn nicht in deren Wirkungskreis fällt.
        enemyThreats: (() => {
          // Nur eigene Basen: der Zombie-Druck wird gegen die Basen gemessen, die sie angreifen.
          const livingBases = this.ctx.baseManager?.getBasesByFaction('friendly')
            .filter((base) => !(base.isInert?.() ?? false) && base.getHp() > 0) ?? [];
          return (this.ctx.enemyManager?.getAllEnemies() ?? [])
          .filter((enemy) => enemy.faction === 'hostile' && enemy.sprite.active && combatSystem.isAlive(enemy.id))
          .map((enemy) => {
            let targetBaseId: string | undefined;
            let targetBaseDistance = Number.POSITIVE_INFINITY;
            for (const base of livingBases) {
              const surface = base.getNearestSurfacePoint(enemy.sprite.x, enemy.sprite.y);
              if (surface && surface.distance < targetBaseDistance) {
                targetBaseId = base.id;
                targetBaseDistance = surface.distance;
              }
            }
            return {
              x: enemy.sprite.x,
              y: enemy.sprite.y,
              attackRange: Math.max(
                0,
                ...enemy.getAttackWeapons().map((attackWeapon) => (
                  attackWeapon.weapon.config.fire.type === 'tesla_dome'
                    ? attackWeapon.weapon.config.fire.radius
                    : attackWeapon.weapon.config.range
                )),
              ),
              targetBaseId,
              targetBaseDistance,
            };
          });
        })(),
        livingCoopBaseIds: this.ctx.baseManager?.getActiveMainBaseIds('friendly'),
        isRelevantOpponent: (otherPlayerId) => playerId === null
          ? combatSystem.isAlive(otherPlayerId)
          : combatSystem.isAlive(otherPlayerId) && bridge.isEnemyPair(playerId, otherPlayerId),
        hasLineOfSight: (sx, sy, ex, ey) => combatSystem.hasLineOfSight(sx, sy, ex, ey),
      };
    });

    // ── Renderers ─────────────────────────────────────────────────────────
    this.renderers = createRendererBundle(this, playerManager);
    // Der Profiler entsteht vor dem Renderer-Bundle; die GPU-VFX-Statistik wird deshalb hier
    // nachgereicht. Ohne sie fehlen Lanes und Effekte im Performance-Export vollstaendig.
    this.runtimeProfiler.setGpuVfxSource({
      build: () => this.renderers!.gpuVfx.buildReport(),
      reset: () => this.renderers?.gpuVfx.resetProfiling(),
    });
    this.renderers.gpuVfx.setDiagnosticEventSink((type, fields) => {
      this.runtimeProfiler?.recordSemanticEvent(type, fields);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.runtimeProfiler?.setGpuVfxSource(null);
      this.renderers?.gpuVfx.setDiagnosticEventSink(null);
      this.renderers?.gpuVfx.destroy();
    });
    this.runtimeProfiler.subscribeDiagnostics((enabled) => {
      const detailed = enabled && this.runtimeProfiler?.wantsDetailedSampling() === true;
      this.renderers?.lighting.setPerformanceMetricsEnabled(detailed);
      this.renderers?.flamethrowerUpgrades.setPerformanceMetricsEnabled(detailed);
    });
    this.renderers.lighting.setDynamicOccluderSource(this.trainLightOccluders);
    this.renderers.plasmaBurner.setLocalAimAngleProvider((ownerId) => (
      ownerId === bridge.getLocalPlayerId() ? inputSystem.getAimAngle() : null
    ));
    // Spawn-Blitz und Brand hängen an der jeweiligen Entity, nicht an einem zentralen
    // Renderer – der Manager reicht die Beleuchtung deshalb an seine Entities durch.
    playerManager.setLightingSystem(this.renderers.lighting);
    stinkCloudSystem.setLightingSystem(this.renderers.lighting);
    stinkCloudSystem.setGpuVfxSystem(this.renderers.gpuVfx);
    smokeSystem.setLightingSystem(this.renderers.lighting);
    wireRenderersToProjManager(this.renderers, projectileManager, playerManager);
    // Die Lobby-Inszenierung braucht die fertige Renderkette und entsteht deshalb hier,
    // nicht schon beim Aufbau der Vorschau.
    if (this.menuArenaPreview) {
      this.lobbyAmbient = new LobbyAmbientRuntime({
        scene: this,
        preview: this.menuArenaPreview,
        renderers: this.renderers,
        effects: effectSystem,
        audio: gameAudioSystem,
        getSelectedWeaponIds: () => {
          const selection = this.getLocalLoadoutSelection();
          return [selection.weapon1, selection.weapon2];
        },
      });
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.lobbyAmbient?.destroy();
        this.lobbyAmbient = null;
      });
    }
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

    // Homing providers (closed over ctx, read at call-time → safe after teardown)
    // Der Suchradius wird hier bereits ausgewertet: bei vielen Splitter-Projektilen läuft
    // dieser Provider mehrfach pro Frame, und die Gegner außerhalb des Radius sind der
    // Großteil der Liste. Die Kandidaten gehen per `emit` in den Pool des Controllers,
    // es entsteht also kein Array und kein Objekt pro Aufruf.
    projectileManager.setHomingTargetProvider((config, ownerId, originX, originY, searchRadius, emit) => {
      if (!bridge.isHost()) return;
      const radiusSq = searchRadius * searchRadius;
      const inRange = (x: number, y: number): boolean => {
        const dx = x - originX;
        const dy = y - originY;
        return dx * dx + dy * dy <= radiusSq;
      };
      // Tuerme sind ein reiner Unterstuetzungs-Zieltyp (Energieinjektor) und werden nur
      // aufgezaehlt, wenn die Waffe sie ausdruecklich anfragt – der Bestand kostet sonst
      // in jedem Homing-Frame jeder Kampfwaffe.
      if (config.targetTypes?.includes('turrets')) {
        for (const turret of this.ctx.turretSystem?.getTurrets() ?? []) {
          if (!inRange(turret.x, turret.y)) continue;
          emit(String(turret.id), 'turrets', turret.x, turret.y);
        }
      }
      for (const player of playerManager.getAllPlayers()) {
        if (player.id === ownerId) continue;
        if (!player.sprite.active) continue;
        if (!inRange(player.sprite.x, player.sprite.y)) continue;
        if (!combatSystem.isAlive(player.id)) continue;
        if (this.ctx.burrowSystem?.isBurrowed(player.id)) continue;
        if (!combatSystem.canDamageTarget(ownerId, player.id)) continue;
        emit(player.id, 'players', player.sprite.x, player.sprite.y);
      }
      if (config.targetTypes?.includes('decoys')) {
        for (const decoy of this.ctx.decoySystem.getHostTargets()) {
          if (decoy.ownerId === ownerId) continue;
          if (!inRange(decoy.sprite.x, decoy.sprite.y)) continue;
          emit(String(decoy.id), 'decoys', decoy.sprite.x, decoy.sprite.y);
        }
      }
      for (const enemy of this.ctx.enemyManager?.getAllEnemies() ?? []) {
        if (!enemy.sprite.active) continue;
        if (!inRange(enemy.sprite.x, enemy.sprite.y)) continue;
        if (!combatSystem.isAlive(enemy.id)) continue;
        if (!combatSystem.canDamageTarget(ownerId, enemy.id)) continue;
        emit(enemy.id, 'enemies', enemy.sprite.x, enemy.sprite.y);
      }
      if (config.targetTypes?.includes('bases') && !this.ctx.enemyManager?.hasEnemy(ownerId)) {
        for (const base of this.ctx.baseManager?.getBasesByFaction('hostile') ?? []) {
          if (base.isInert?.() === true || base.getHp() <= 0) continue;
          const surface = base.getNearestSurfacePoint(originX, originY);
          if (!surface || !inRange(surface.x, surface.y)) continue;
          emit(base.id, 'bases', surface.x, surface.y);
        }
      }
    });
    projectileManager.setHomingLineOfFireChecker((sx, sy, ex, ey) => {
      return combatSystem.hasClearLineOfFire(sx, sy, ex, ey);
    });
    projectileManager.setHomingTargetValidityChecker((id, type) => {
      if (type !== 'players' && type !== 'decoys') return true;
      const catalog = this.ctx.enemyAiTargetCatalog;
      if (!catalog) return true;
      return catalog.isTargetValid({ kind: type === 'players' ? 'player' : 'decoy', id });
    });

    effectSystem.setup(() => { aimSystem.notifyConfirmedHit(); });

    // ── Shared state & helpers ─────────────────────────────────────────────
    this.localPlayerState = new LocalPlayerState();
    this.rockVisualHelper  = new RockVisualHelper(this, this.ctx, this.renderers.shadow, this.renderers.rockDestruction, this.renderers.lighting);
    this.hostileBaseIndicator = new HostileBaseIndicator(this);
    this.secondaryObjectiveHud = new CoopDefenseSecondaryObjectiveHud(this, this.objectiveAnnouncements!);
    this.secondaryObjectiveHud.build();
    this.placementPreview  = new PlacementPreviewRenderer(this, this.ctx);
    this.tunnelRenderer    = new TunnelRenderer(this);
    this.gaussWarning      = new GaussWarningRenderer(
      this,
      () => this.ctx.enemyManager?.getAllEnemies() ?? [],
    );

    // ── Coordinators ──────────────────────────────────────────────────────
    this.hostUpdate   = new HostUpdateCoordinator(this, this.ctx, this.renderers, this.localPlayerState, this.rockVisualHelper);
    this.clientUpdate = new ClientUpdateCoordinator(this, this.ctx, this.localPlayerState, this.rockVisualHelper);
    this.runtimeProfiler.subscribeDiagnostics((enabled) => {
      // Coordinators interpret this as the cheap whole-step Companion metric; their internal
      // phase timers remain disabled until a future detailed mode is explicitly introduced.
      this.hostUpdate?.setPerformanceMetricsEnabled(enabled);
      this.clientUpdate?.setPerformanceMetricsEnabled(enabled);
    });

    // ── Input setup ───────────────────────────────────────────────────────
    inputSystem.setup();
    inputSystem.setAudioSystem(gameAudioSystem);
    inputSystem.setupUtilityConfigProvider(() => this.clientUpdate.getLocalUtilityConfig());
    inputSystem.setupUtilityCooldownProvider(() => {
      return bridge.getPlayerUtilityCooldownUntil(
        bridge.getLocalPlayerId(),
        this.clientUpdate.getLocalUtilityCooldownId(),
      );
    });
    inputSystem.setupInspectorToolProvider(
      () => this.clientUpdate.getLocalInspectorTools(),
      () => this.clientUpdate.getLocalInspectorSelectedTool(),
      (tool) => this.clientUpdate.setLocalInspectorSelectedTool(tool),
      () => bridge.getPlayerCommittedLoadout(bridge.getLocalPlayerId())?.coopDefenseClassId === 'inspector_gadachs',
      () => bridge.getPlayerUtilityOverrideId(bridge.getLocalPlayerId()) !== ''
        || this.clientUpdate.clientUtilityOverride !== null,
      // Host und Client halten denselben Bestand platzierter Objekte, deshalb kann die
      // belegte Baukapazitaet lokal berechnet werden. Das Maximum kommt aus denselben
      // Effekt-Summen wie das HUD, damit das Radialmenue nichts als baubar anzeigt, was das
      // Host-Gate anschliessend ablehnt.
      () => ({
        used: this.ctx.placementSystem?.getUsedCapacity(bridge.getLocalPlayerId()) ?? 0,
        max: this.clientUpdate.getLocalConstructionCapacity(),
      }),
      () => {
        const player = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId());
        const placementSystem = this.ctx.placementSystem;
        if (!player || !placementSystem) return undefined;
        const pointer = this.getPointerWorldPoint();
        return placementSystem.getDismantlePreview(
          bridge.getLocalPlayerId(),
          player.sprite.x,
          player.sprite.y,
          pointer.x,
          pointer.y,
          COOP_DEFENSE_DISMANTLE_RANGE,
        );
      },
    );
    inputSystem.setupUltimateConfigProvider(() => this.clientUpdate.getLocalUltimateConfig());
    inputSystem.setupLocalRageProvider(() => this.clientUpdate.getLocalRage());

    // ── Debug Hotkeys ─────────────────────────────────────────────────────
    inputSystem.setupDebugHotkeys((type) => {
      if (!bridge.isHost()) return;

      const service = type === 'flowfield_players'
        ? this.ctx.enemyPlayerFlowFieldService
        : this.ctx.enemyFlowFieldService;
      if (!service) return;

      if (!this.flowFieldDebugOverlay) {
        console.log('[ArenaScene] Creating EnemyFlowFieldDebugOverlay');
        this.flowFieldDebugOverlay = new EnemyFlowFieldDebugOverlay(this, service);
      }

      console.log(`[ArenaScene] Showing ${type} overlay`);
      this.flowFieldDebugOverlay.showForService(service);
    });
    const playLocalFailureSound = (slot: LoadoutSlot): void => {
      if (slot === 'weapon1' || slot === 'weapon2') {
        const shotAudio = this.clientUpdate.getLocalWeaponConfig(slot).shotAudio;
        gameAudioSystem.playLocalSound(shotAudio?.failureKey);
        return;
      }

      if (slot === 'ultimate') {
        const ultimate = this.clientUpdate.getLocalUltimateConfig();
        if (ultimate.type === 'gauss') {
          gameAudioSystem.playLocalSound(ultimate.shotAudio?.failureKey);
        }
      }
    };
    const getLocalWeapon2AdrenalineCost = (): number => {
      const localId = bridge.getLocalPlayerId();
      const weapon2Config = this.clientUpdate.getLocalWeaponConfig('weapon2');
      const fireSuperiorityAvailable = this.ctx.loadoutManager?.isAk47FireSuperiorityAvailable(localId)
        ?? (weapon2Config.id === 'AK47'
          && bridge.getPlayerActiveBuffs(localId).some((buff) => (
            buff.defId === 'AK47_FIRE_SUPERIORITY' && (buff.availableCount ?? 0) > 0
          )));
      return fireSuperiorityAvailable ? 0 : (weapon2Config.adrenalinCost ?? 0);
    };
    const isWeapon2AdrenalineInsufficient = (assumeRecentLocalShot = false): boolean => {
      const adrenalineCost = getLocalWeapon2AdrenalineCost();
      if (adrenalineCost <= 0) return false;

      const localAdrenaline = this.clientUpdate.getLocalAdrenaline();
      if (localAdrenaline < adrenalineCost) return true;
      if (!assumeRecentLocalShot) return false;

      return localAdrenaline < adrenalineCost * 2;
    };
    const handleLocalFailureFeedback = (
      slot: LoadoutSlot,
      reason: 'cooldown' | 'resource',
      inputStarted: boolean,
      resourceKind?: LoadoutUseResult['resourceKind'],
      assumeRecentLocalWeapon2Shot = false,
    ): void => {
      if (!inputStarted) return;

      if (
        slot === 'weapon2'
        && ((reason === 'resource' && resourceKind === 'adrenaline')
          || (reason === 'cooldown' && isWeapon2AdrenalineInsufficient(assumeRecentLocalWeapon2Shot)))
      ) {
        this.playerStatusRing?.notifyAdrenalineInsufficientShot();
      }

      if (slot === 'ultimate' && reason === 'resource' && resourceKind === 'rage') {
        this.ctx.centerHUD.flashUltimateInsufficientRage();
      }

      playLocalFailureSound(slot);
    };
    inputSystem.setupWeapon2ConfigProvider(() => this.clientUpdate.getLocalWeaponConfig('weapon2'));
    inputSystem.setupCanStartScopeCheck(() => {
      const wepConfig = this.clientUpdate.getLocalWeaponConfig('weapon2');
      const lastFired = this.clientUpdate.weaponLastFiredRecord()['weapon2'];
      const cooldownOk = lastFired === 0 || Date.now() - lastFired >= wepConfig.cooldown;
      const adrenalineOk = wepConfig.adrenalinCost === 0
        || this.clientUpdate.getLocalAdrenaline() >= wepConfig.adrenalinCost;
      if (!cooldownOk) {
        handleLocalFailureFeedback('weapon2', 'cooldown', true, undefined, true);
        return false;
      }
      if (!adrenalineOk) {
        handleLocalFailureFeedback('weapon2', 'resource', true, 'adrenaline');
        return false;
      }
      return true;
    });
    inputSystem.setupUtilityPlacementPreviewProvider(() => this.getLocalPlacementPreview());
    inputSystem.setupUltimatePlacementPreviewProvider(() => this.getLocalUltimatePlacementPreview());
    inputSystem.setupConstructionProviders(
      () => {
        if (bridge.getGamePhase() !== 'ARENA') return [];
        const committed = bridge.getPlayerCommittedLoadout(bridge.getLocalPlayerId());
        if (
          committed?.coopDefenseClassId !== 'inspector_gadachs'
          || !committed.coopDefenseProfile
        ) {
          return [];
        }
        return getUnlockedCoopDefenseConstructionIds(committed.coopDefenseProfile);
      },
      (constructionId) => {
        const player = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId());
        const placementSystem = this.ctx.placementSystem;
        if (!player || !placementSystem) return undefined;
        const pointer = this.getPointerWorldPoint();
        return placementSystem.getConstructionPlacementPreview(
          getCoopDefenseConstructionDefinition(constructionId),
          player.sprite.x,
          player.sprite.y,
          pointer.x,
          pointer.y,
        );
      },
    );
    inputSystem.setupTranslocatorRecallCheck(() => {
      const cfg = this.clientUpdate.getLocalUtilityConfig();
      if (!cfg || cfg.type !== 'translocator') return false;
      return this.ctx.translocatorSystem?.getActivePuckId(bridge.getLocalPlayerId()) !== undefined;
    });
    inputSystem.onUtilityPressedDuringCooldown = () => {
      const localId       = bridge.getLocalPlayerId();
      const config = this.clientUpdate.getLocalUtilityConfig();
      const utilityId = this.clientUpdate.getLocalUtilityCooldownId();
      const cooldownUntil = bridge.getPlayerUtilityCooldownUntil(localId, utilityId);
      const remaining     = Math.max(0, cooldownUntil - bridge.getSynchronizedNow());
      const selected = this.clientUpdate.getLocalInspectorSelectedTool();
      const hasOverride = bridge.getPlayerUtilityOverrideId(localId) !== '' || this.clientUpdate.clientUtilityOverride !== null;
      const cooldown = selected?.kind === 'construction' && !hasOverride
        ? getCoopDefenseConstructionDefinition(selected.id).buildCooldownMs
        : config.cooldown;
      const frac          = cooldown > 0 ? Math.min(1, remaining / cooldown) : 0.8;
      const displayName   = config?.id ?? 'UTILITY';
      this.ctx.centerHUD.flashUtilityCooldown(frac, displayName);
    };
    inputSystem.onUltimatePressedWithoutRage = () => {
      this.ctx.centerHUD.flashUltimateInsufficientRage();
    };
    const handleLocalLoadoutFailure = (
      slot: LoadoutSlot,
      result: LoadoutUseResult | null,
      inputStarted: boolean,
    ): void => {
      if (!result || result.ok) return;

      if (slot === 'ultimate') {
        inputSystem.cancelLocalUltimateChargePreview();
      }

      if ((slot === 'weapon1' || slot === 'weapon2') && (result.reason === 'cooldown' || result.reason === 'resource')) {
        this.clientUpdate.rollbackRejectedLoadoutFire(slot);
      }

      if (result.reason === 'cooldown' || result.reason === 'resource') {
        handleLocalFailureFeedback(slot, result.reason, inputStarted, result.resourceKind);
      }
    };
    inputSystem.setupLoadoutListener((slot, angle, targetX, targetY, params) => {
      if (!bridge.canPlayerAct(bridge.getLocalPlayerId())) return;
      if (!this.localPlayerState.alive || this.localPlayerState.burrowed) return;

      let shotId: number | undefined;
      const inputStarted = params?.inputStarted === true;

      if ((slot === 'weapon1' || slot === 'weapon2') && !params?.constructionId) {
        // scopeHolding: kein Schuss, nur holdSpeedFactor auf Host-Seite aktiv halten.
        // Weder Cooldown-Check noch notifyLoadoutFired – sonst würde der echte Schuss blockiert.
        if (params?.scopeHolding) {
          bridge.sendLoadoutUse(slot, angle, targetX, targetY, undefined, params);
          return;
        }
        const now = Date.now();
        const lastFired = this.clientUpdate.weaponLastFiredRecord()[slot];
        const wepConfig = this.clientUpdate.getLocalWeaponConfig(slot);
        if (lastFired > 0 && now - lastFired < wepConfig.cooldown) {
          handleLocalFailureFeedback(slot, 'cooldown', inputStarted, undefined, slot === 'weapon2');
          return;
        }
        // Der Host prueft Ressourcen autoritativ im LoadoutManager. Dasselbe Gate muss vor
        // der lokalen Prediction liegen, die sowohl Host als auch Clients ausfuehren; sonst
        // werden trotz abgelehntem Schuss weiterhin Strahl und Erfolgssound dargestellt.
        if (slot === 'weapon2' && isWeapon2AdrenalineInsufficient()) {
          handleLocalFailureFeedback(slot, 'resource', inputStarted, 'adrenaline');
          return;
        }
        shotId = this.clientUpdate.notifyLoadoutFired(slot, angle, targetX, targetY);
        if (slot === 'weapon2') {
          this.clientUpdate.recordPredictedAdrenalineSpend(getLocalWeapon2AdrenalineCost());
        }
      }
      // Der Rueckbau nutzt zwar den Utility-Kanal, hat aber weder Config noch Cooldown.
      if (slot === 'utility' && !params?.dismantle && params?.toolRef?.kind !== 'construction') {
        const config = this.clientUpdate.getLocalUtilityConfig();
        const utilityId = this.clientUpdate.getLocalUtilityCooldownId();
        const utilityCooldownUntil = bridge.getPlayerUtilityCooldownUntil(bridge.getLocalPlayerId(), utilityId);
        if (utilityCooldownUntil > Date.now()) {
          if (inputStarted) {
            const utilityShotAudio = this.clientUpdate.getLocalUtilityConfig()?.shotAudio;
            gameAudioSystem.playLocalSound(utilityShotAudio?.failureKey);
          }
          return;
        }
        this.clientUpdate.notifyUtilityFired();
      }

      const localSprite = playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
      const isUtilityPlacementAction = slot === 'utility'
        && inputSystem.isUtilityPlacementActive()
        && this.clientUpdate.getLocalUtilityConfig().activation.type === 'placement_mode';
      const isUltimatePlacementAction = slot === 'ultimate'
          && inputSystem.isUltimatePlacementActive()
          && params?.tunnelAction === 'commit';
      const isInspectorConstructionAction = params?.toolRef?.kind === 'construction';
      const isInspectorUtilityAction = params?.toolRef?.kind === 'utility';
      const isInspectorDismantleAction = params?.dismantle === true;
      const awaitResult = isUtilityPlacementAction
        || isUltimatePlacementAction
        || isInspectorConstructionAction
        || isInspectorUtilityAction
        || isInspectorDismantleAction;
      const awaitFailureResult = inputStarted
        && !params?.constructionId
        && (slot === 'weapon2' || slot === 'ultimate');
      const loadoutPromise = bridge.sendLoadoutUse(slot, angle, targetX, targetY, shotId, params, localSprite?.x, localSprite?.y, Date.now(), awaitResult || awaitFailureResult);
      if (awaitFailureResult) {
        void loadoutPromise.then((result) => {
          handleLocalLoadoutFailure(slot, result, inputStarted);
        });
      }
      if (awaitResult) {
        void loadoutPromise.then((result) => {
          if (result?.ok) return;
          if (isInspectorDismantleAction) {
            this.placementPreview.showPlacementError(t('ui.errors.dismantleFailed'));
            return;
          }
          if (isUtilityPlacementAction || isUltimatePlacementAction || isInspectorConstructionAction) {
            this.placementPreview.showPlacementError(
              result?.reason === 'capacity' ? t('ui.errors.capacity') : t('ui.errors.buildFailed'),
            );
            return;
          }
          handleLocalLoadoutFailure(slot, result, inputStarted);
        }).catch(() => {
          if (isUtilityPlacementAction || isUltimatePlacementAction || isInspectorConstructionAction) {
            this.placementPreview.showPlacementError(t('ui.errors.buildFailed'));
          }
        });
      }
    });

    // ── Lobby overlay & room-quality ───────────────────────────────────────
    this.lobbyOverlay = new LobbyOverlay(
      this, bridge,
      () => this.onReadyToggled(),
      () => { void this.onCopyRoomLink(); },
      () => rejoinCurrentRoom(),
      () => this.onRetryRoom(),
      () => this.netDebugOverlay?.toggle(),
      () => leftPanel.showHelpOverlay(),
      () => leftPanel.showOptionsOverlay(),
      () => this.openCoopDefenseUpgradesOverlay(),
      () => this.openCoopDefenseItemsOverlay(),
    );
    this.lobbyOverlay.build();
    this.lobbyOverlay.show();
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
    this.refreshCoopDefenseItemsButton();

    this.roomQualityMonitor = new RoomQualityMonitor(bridge);

    // ── RPC + Lifecycle coordinators ──────────────────────────────────────
    this.rpcCoordinator = new RpcCoordinator(this, this.ctx, this.renderers, this.clientUpdate, leftPanel);
    this.lifecycle      = new ArenaLifecycleCoordinator(
      this, this.ctx, this.renderers,
      this.rockVisualHelper, this.placementPreview,
      this.lobbyOverlay, this.hostUpdate, this.clientUpdate,
      this.roomQualityMonitor,
    );
    this.rpcCoordinator.setLifecycle(this.lifecycle);
    this.rpcCoordinator.registerAll();
    // Host-Abbruch der laufenden Partie (Optionsmenue, in jedem Spielmodus).
    leftPanel.setAbortMatchBinding({
      canAbort: () => this.lifecycle.canHostAbortRound(),
      abort: () => this.lifecycle.hostAbortRound(),
    });
    leftPanel.setSpectatorMatchBinding({
      canSpectate: () => this.lifecycle.canEnterSpectatorMode(),
      spectate: () => this.lifecycle.enterSpectatorMode(),
    });

    if (bridge.isHost()) {
      bridge.initColorPool(PLAYER_COLORS);
    }

    bridge.onPlayerJoin(profile => this.onPlayerJoined(profile));
    bridge.onPlayerQuit(id      => this.onPlayerLeft(id));
    bridge.onSpectatorEntered(id => this.lifecycle.handleSpectatorEntered(id));
    bridge.onKicked(() => {
      this.lobbyOverlay.showHostDisconnectedMessage('Du wurdest vom Host aus dem Raum entfernt.');
    });
    this.removeReconnectStatusListener = bridge.onReconnectStatus((status) => {
      if (status.state === 'reconnecting' || status.state === 'resumed') {
        this.mapEventAnnouncementPresenter?.resetForHydration();
      }
    });
    // Verbindungsabbruch: es gibt keinen Hostwechsel und keinen Ersatztransport, die Partie
    // endet mit der konkreten Ursache statt still weiterzulaufen.
    bridge.onNetworkFailure(message => {
      if (bridge.getGamePhase() === 'ARENA') {
        this.matchResultsPending = false;
        this.matchResultsOverlay?.showTechnicalAbort(message);
      }
      this.lifecycle.terminateMatch(message);
    });

    this.lifecycle.initialize();
    this.registerArenaPanelHotkeys();
    bridge.sendPingToHost();
    this.time.addEvent({ delay: 1000, callback: () => bridge.sendPingToHost(), loop: true });
    this.initializeRoomQuality();
    this.refreshStoredCoopDefenseProgress();
    this.applyDefaultCoopDefenseMapSelection();
    this.lastObservedGamePhase = bridge.getGamePhase();

    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      void BootScreen.fadeOut();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      BootScreen.dismissImmediate();
    });
  }

  update(_time: number, delta: number): void {
    const companionDiagnosticsActive = this.runtimeProfiler?.isDiagnosticsActive() ?? false;
    const diagnosticsActive = this.runtimeProfiler?.wantsDetailedSampling() ?? false;
    const frameStartMs = diagnosticsActive ? performance.now() : 0;
    // Vor allem anderen, damit die Diagnose-Zaehlungen weiter unten den abgeschalteten
    // Zustand sehen und nicht den des Vorframes.
    if (companionDiagnosticsActive) this.performanceAblation?.update();
    let primaryStepMs = 0;
    let clientRendererSyncMs = 0;
    let inputCameraMs = 0;
    let lobbyUiMs = 0;
    let arenaHudMs = 0;
    let leaderboardCanopyMs = 0;
    let arenaPanelMs = 0;
    const networkUpdateStartMs = diagnosticsActive ? performance.now() : 0;
    const scenePreludeMs = diagnosticsActive ? networkUpdateStartMs - frameStartMs : 0;
    bridge.updateNetwork();
    const networkUpdateMs = diagnosticsActive ? performance.now() - networkUpdateStartMs : 0;

    const phase           = bridge.getGamePhase();
    const deferArenaExit  = this.syncArenaExitFade(phase);
    this.lifecycle.detectPhaseChange(deferArenaExit);
    if (!deferArenaExit && phase === 'LOBBY') this.arenaExitFadeOverlay?.hide();
    this.syncArenaMetrics(deferArenaExit ? 'ARENA' : phase);
    const enteredLobbyFromArena = !deferArenaExit
      && this.lastObservedGamePhase === 'ARENA'
      && phase === 'LOBBY';
    const inGame          = phase === 'ARENA';
    const countdownVisible = bridge.isArenaCountdownVisible();
    const arenaLoading    = bridge.isArenaLoading();
    const arenaStarted    = bridge.isArenaStarted();
    const arenaVisible    = countdownVisible || deferArenaExit;
    const countdownActive = bridge.isArenaCountdownActive();
    const terminated      = this.lifecycle.isMatchTerminated();
    const gameplayActive  = inGame && arenaStarted && !terminated;
    const optionsOpen     = this.ctx?.leftPanel.isOptionsOverlayOpen() ?? false;
    this.lifecycle.syncRoundParticipation();
    const spectator = inGame && (this.localPlayerState.spectator || bridge.isLocalSpectator());

    if (phase === 'LOBBY' && !deferArenaExit) {
      this.clearDebugModes();
      if (!isCoopDefenseMode(bridge.getGameMode())) {
        this.coopDefenseXpDebugOverlay?.hide();
        this.coopDefenseUpgradesOverlay?.hide();
      }
    } else {
      this.coopDefenseXpDebugOverlay?.hide();
      this.coopDefenseUpgradesOverlay?.hide();
    }

    // Initial player placement is a round-build step, not simulation. Keep it before the camera
    // so the same prepared spawn defines the startup working set that the load barrier waits for.
    if (inGame && !terminated && !spectator) {
      if (bridge.isHost()) {
        // Initial spawn is part of the hidden local build. It must happen before the first
        // residency check so the startup working set follows the actual local player focus.
        this.lifecycle.spawnReadyPlayers();
        this.localPlayerState.alive = this.ctx.combatSystem.isAlive(bridge.getLocalPlayerId());
      } else if (arenaLoading || countdownActive) {
        // The client receives the first authoritative alive bit with the first post-start
        // snapshot; the local prepared entity is nevertheless a valid camera focus meanwhile.
        this.localPlayerState.alive = true;
      }
    }

    // The camera must already be positioned while the world is hidden, because its initial view
    // defines the startup working set that the load barrier waits for.
    this.syncMainCamera(delta, inGame && !terminated);
    // Direkt nach der Kamera und vor allem Weiteren: Die gestreamten Bodenbaender und
    // Fels-Overlays halten nur Renderziele um den sichtbaren Ausschnitt herum. Der
    // Sicherheitsrand deckt den Kamera-Feedback-Versatz mit ab, der erst am Frame-Ende
    // dazukommt.
    if (inGame && !terminated) {
      const worldView = getVisibleWorldView(this.cameras.main);
      ArenaBuilder.updateSurfaceResidency(this.ctx?.arenaResult ?? null, worldView);
      this.renderers?.shadow.updateStaticResidency(worldView);
    }
    this.arenaPanelsHeld = !!(gameplayActive && !terminated && this.arenaPanelTabKey?.isDown);

    if (!inGame && this.arenaPanelsHeld) {
      this.arenaPanelsHeld = false;
    }

    const lobbyVisible = phase === 'LOBBY' && !deferArenaExit;
    this.menuArenaPreview?.setVisible(lobbyVisible);
    // Muss vor allem Arena-Aufbau laufen: `setActive(false)` räumt synchron und vollständig
    // auf, damit kein Ambient-Zustand in eine Runde hinüberlebt.
    this.lobbyAmbient?.setActive(lobbyVisible);
    if (lobbyVisible) this.lobbyAmbient?.update(delta);

    if (inGame) {
      // Loading blocks input, while the countdown intentionally keeps aiming and the Inspector
      // radial menu available so the pre-round presentation remains interactive.
      const countdownInputAllowed = countdownActive && !optionsOpen && !spectator;
      this.ctx.inputSystem.setAimEnabled(
        (gameplayActive || countdownActive) && !optionsOpen && !spectator,
      );
      this.ctx.inputSystem.setInputEnabled(
        gameplayActive && !optionsOpen && !spectator,
        gameplayActive && !optionsOpen && !spectator || countdownInputAllowed,
      );
      this.ctx.inputSystem.update();
      if (countdownActive) this.syncCountdownPlayerPresentation();
    } else {
      this.ctx.inputSystem.setAimEnabled(false);
      this.ctx.inputSystem.setInputEnabled(false);
    }
    if (diagnosticsActive) {
      inputCameraMs = performance.now() - (networkUpdateStartMs + networkUpdateMs);
    }

    if (phase !== 'LOBBY' || deferArenaExit) this.roomStatisticsOverlay?.hide();
    if (!terminated && phase === 'LOBBY' && !deferArenaExit) {
      const lobbyUiStartedAt = diagnosticsActive ? performance.now() : 0;
      if (enteredLobbyFromArena) this.beginMatchResults();
      if (this.matchResultsPending) this.tryFinalizeMatchResults();
      this.lifecycle.syncLobbyTimeOfDay();
      this.menuArenaPreview?.setTreeTint(this.renderers.lighting.resolveCanopyTint(0, 0));
      if (!this.lobbyOverlay.isVisible()) this.lobbyOverlay.show();
      const players = bridge.getConnectedPlayers();
      // Lokalen Ready-Stand an den autoritativen Netzwerkwert angleichen. Setzt der Host beim
      // Rundenwechsel (oder bei Modus-/Map-Wechsel) den Spieler auf "nicht bereit", folgt hier sowohl
      // das interne Flag als auch der Button – so ist der Client-Zustandsspeicher garantiert konsistent.
      const localReady = bridge.getPlayerReady(bridge.getLocalPlayerId());
      if (localReady !== this.lifecycle.getIsLocalReady()) {
        this.lifecycle.setIsLocalReady(localReady);
        this.lobbyOverlay.setReadyButtonState(localReady);
      }
      this.updateRoomQuality(this.time.now, players);
      this.lobbyOverlay.setRoomQuality(this.roomQualitySnapshot, bridge.isHost());
      this.lobbyOverlay.setTransportDiagnostics(bridge.getWorstTransportDiagnostics());
      bridge.setLocalLobbyLoadoutPreview(this.buildLocalLobbyLoadoutPreview());
      this.lobbyOverlay.refreshPlayerList(players);
      const roundResults = bridge.getRoundResults();
      const roomStatistics = bridge.getRoomPlayerStatistics();
      this.ctx.rightPanel.showRoomStatistics(roomStatistics);
      this.ctx.rightPanel.setRoomStatisticsDetailAvailable(roomStatistics.length > 0);
      this.ctx.rightPanel.showRoundResults(
        bridge.isLocalRoundResultEligible(roundResults) ? roundResults : null,
        bridge.getRoundState(),
      );
      this.ctx.rightPanel.setResultsReplayAvailable(this.lastMatchResultsPresentation !== null);
      this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
      // Signaturgeschuetzt wie die Fortschrittsanzeige: der Aufruf pro Frame ist billig.
      this.refreshCoopDefenseItemsButton();
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
      if (bridge.isHost()) this.lifecycle.hostCheckReadyToStart();
      if (diagnosticsActive) lobbyUiMs = performance.now() - lobbyUiStartedAt;
    } else if (!terminated && this.lobbyOverlay.isVisible()) {
      this.coopDefenseXpDebugOverlay?.hide();
      this.coopDefenseUpgradesOverlay?.hide();
      this.lobbyOverlay.setCoopDefenseProgress(null);
      this.lastLobbySidebarSignature = null;
      this.lobbyOverlay.hide();
    } else {
      this.coopDefenseXpDebugOverlay?.hide();
      this.coopDefenseUpgradesOverlay?.hide();
      this.lobbyOverlay.setCoopDefenseProgress(null);
      this.lastLobbySidebarSignature = null;
    }

    if (!deferArenaExit) this.lastObservedGamePhase = phase;
    const sceneStateEndMs = diagnosticsActive ? performance.now() : 0;
    const sceneStateMs = diagnosticsActive
      ? sceneStateEndMs - (networkUpdateStartMs + networkUpdateMs)
      : 0;

    if (gameplayActive && !terminated) {
      const arenaHudStartedAt = diagnosticsActive ? performance.now() : 0;
      const secs = bridge.computeSecondsLeft();
      const activeMapConfig = isCoopDefenseMode(bridge.getGameMode())
        ? getCoopDefenseMapConfig(bridge.getRoundState()?.coopDefenseMapId ?? bridge.getCoopDefenseMapId())
        : null;
      this.ctx.centerHUD.updateTimer(
        secs,
        activeMapConfig === null || activeMapConfig.objective === 'survive',
      );
      this.ctx.centerHUD.updateSurvivalStatus(
        activeMapConfig?.objective === 'survive'
          ? bridge.getLocalCoopDefenseSurvivalState()
          : null,
      );
      const roundElapsedMs = bridge.getSynchronizedNow() - bridge.getArenaStartTime();
      const tutorialDurationMs = activeMapConfig?.tutorialDurationMs ?? COOP_DEFENSE_TUTORIAL_DURATION_MS;
      // `tutorialPersistent` blendet das Fenster über die gesamte Rundendauer ein.
      const tutorialText = activeMapConfig
        ? getMapTutorial(activeMapConfig.mapId, getLocale())
        : undefined;
      const tutorialVisible = tutorialText !== undefined
        && roundElapsedMs >= 0
        && (activeMapConfig?.tutorialPersistent === true || roundElapsedMs < tutorialDurationMs);
      this.ctx.centerHUD.updateTutorial(
        tutorialVisible ? tutorialText! : null,
        activeMapConfig?.tutorialShowControls === true,
      );

      // Train widget: Das Zug-Event selbst entscheidet, ob etwas anzuzeigen ist – Maps mit
      // Gleisen ohne Zug und Runden ohne weitere Einfahrt haben schlicht kein Event.
      if (isCoopDefenseMode(bridge.getGameMode())) {
        this.ctx.centerHUD.hideTrainWidget();
      } else {
        const trainEvent = bridge.getTrainEvent();
        if (!trainEvent) {
          this.ctx.centerHUD.hideTrainWidget();
        } else if (!this.lifecycle.isTrainDestroyedShown()) {
          const trainState = bridge.getLatestGameState()?.train ?? null;
          if (trainState?.alive) {
            this.ctx.centerHUD.updateTrainHP(trainState.hp, trainState.maxHp);
          } else {
            // Echte Restzeit bis zur Einfahrt; der Rundentimer spielt dabei keine Rolle.
            const arrivalSecs = getTrainArrivalCountdownSecs(trainEvent.spawnAt, bridge.getSynchronizedNow());
            if (arrivalSecs !== null) this.ctx.centerHUD.setTrainArrival(arrivalSecs);
          }
        }
      }
      if (diagnosticsActive) arenaHudMs = performance.now() - arenaHudStartedAt;

      if (bridge.isHost()) {
        const hostStepStartMs = diagnosticsActive ? performance.now() : 0;
        if (isCoopDefenseMode(bridge.getGameMode())
          && this.coopDefenseDebugDamageKey
          && Phaser.Input.Keyboard.JustDown(this.coopDefenseDebugDamageKey)
          && !this.ctx.leftPanel.isHotkeyInputBlocked()) {
          this.ctx.coopDefenseRoundStateSystem?.applyDebugBaseDamage(50);
        }
        this.hostUpdate.runHostUpdate(delta);
        const coopRoundOutcome = this.ctx.coopDefenseRoundStateSystem?.update() ?? null;
        if (coopRoundOutcome) {
          this.prepareCoopDefenseBalanceRound(coopRoundOutcome);
          this.lifecycle.hostCompleteRound(coopRoundOutcome);
        } else if (!isCoopDefenseMode(bridge.getGameMode()) && !countdownActive && secs <= 0) {
          this.lifecycle.hostCompleteRound();
        }
        if (diagnosticsActive) primaryStepMs += performance.now() - hostStepStartMs;
      } else {
        const clientStepStartMs = diagnosticsActive ? performance.now() : 0;
        this.clientUpdate.runClientUpdate(delta);

        // Sync renderers that HostUpdateCoordinator handles for host but client needs too
        const clientRendererSyncStartedAt = diagnosticsActive ? performance.now() : 0;
        const state = bridge.getLatestGameState();
        if (state) {
          this.ctx.captureTheBeerSystem?.syncSnapshot(state.captureTheBeer ?? null);
          this.renderers.beer.sync(state.captureTheBeer?.beers ?? []);
          this.ctx.coopDefenseCarryItems = state.coopDefenseCarry ?? [];
          this.renderers.beer.syncCoopDefenseCarry(this.ctx.coopDefenseCarryItems);
          this.renderers.timeBubble.syncVisuals(state.timeBubbles ?? []);
          this.renderers.teslaDome.syncVisuals(state.teslaDomes ?? []);
          this.renderers.energyShield.syncVisuals(state.energyShields ?? []);
          this.renderers.guardianSpirit.syncVisuals(state.guardianSpirits ?? []);
          this.renderers.repairDrone.syncVisuals(
            state.repairDrones ?? [],
            state.placeableRocks ?? [],
          );
          this.renderers.slimeTrail.syncVisuals(state.slimeTrail ?? { cells: [], affectedEnemies: [] });
          this.renderers.flamethrowerUpgrades.syncGround(state.burningGround ?? { cells: [] });
          this.renderers.flamethrowerUpgrades.syncRings(state.players);
          this.renderers.train?.setTarget(state.train ?? null);
          this.renderers.powerUp.syncPedestals(state.pedestals ?? []);
          this.renderers.powerUp.sync(state.powerups ?? []);
          this.renderers.nuke.sync(state.nukes ?? []);
          this.renderers.airstrike.sync(state.airstrikes ?? []);
          this.renderers.meteor.sync(state.meteors ?? []);
        }
        this.renderers.powerUp.updatePedestals(bridge.getSynchronizedNow());
        this.renderers.train?.render(1 - Math.exp(-delta / NET_SMOOTH_TIME_MS));
        if (diagnosticsActive) {
          clientRendererSyncMs = performance.now() - clientRendererSyncStartedAt;
          primaryStepMs += performance.now() - clientStepStartMs;
        }
      }

      const transitionCompleted = this.lifecycle.syncRuntimeTimeOfDay(
        bridge.getSynchronizedNow(),
        this.resolveArenaTimeOfDaySignals(),
      );
      this.forceStaticTimeOfDayBake ||= transitionCompleted;

      const leaderboardCanopyStartedAt = diagnosticsActive ? performance.now() : 0;
      if (this.arenaPanelsHeld) {
        this.ctx.rightPanel.updateLeaderboard(this.hostUpdate.getLeaderboardEntries());
      }

      if (this.ctx.arenaResult) {
        const localSprite = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite ?? null;
        ArenaBuilder.updateCanopyTransparency(
          this.ctx.arenaResult.canopyObjects,
          localSprite,
          (worldX, worldY) => this.renderers.lighting.resolveCanopyTint(worldX, worldY),
        );
      }
      if (diagnosticsActive) leaderboardCanopyMs = performance.now() - leaderboardCanopyStartedAt;
    }

    const arenaPanelStartedAt = diagnosticsActive ? performance.now() : 0;
    this.syncArenaPanelOverlayState(gameplayActive && !terminated);
    if (diagnosticsActive) arenaPanelMs = performance.now() - arenaPanelStartedAt;

    const visualsStartMs = diagnosticsActive ? performance.now() : 0;
    const postRoleMs = diagnosticsActive ? visualsStartMs - sceneStateEndMs - primaryStepMs : 0;

    // ── Per-frame visuals (always) ─────────────────────────────────────────
    // Der GPU-Partikel-Tick haengt bewusst nicht am Zustands-Sync: auf Clients laufen die
    // Renderer-Syncs nur mit frischem Netzzustand, die bisherigen Emitter liefen dagegen
    // autonom weiter. Erst stilllegen, dann emittieren – die Registry garantiert die Reihenfolge.
    this.renderers.gpuVfx.update(delta);
    const inArena = arenaVisible && !terminated;
    const strategicTargets = bridge.isHost()
      ? (this.ctx.ak47StrategicTargetSystem?.getNetSnapshot(bridge.getSynchronizedNow()) ?? [])
      : (bridge.getLatestGameState()?.ak47StrategicTargets ?? []);
    this.renderers.ak47StrategicTargets.sync(
      strategicTargets,
      this.ctx.enemyManager,
      bridge.getLocalPlayerId(),
      bridge.getSynchronizedNow(),
      inArena && isCoopDefenseMode(bridge.getGameMode()),
    );
    // Beim Spectator ist die Kamera bereits vor dem Netzwerk-/Render-Schritt fortgeschrieben;
    // der zweite normale Sync-Punkt darf die A/D-Geschwindigkeit nicht verdoppeln.
    // Keep the camera active while the arena is hidden behind the loading veil. Its position is
    // part of the local startup working set and must not be reset to the lobby origin before the
    // readiness check at the end of the frame.
    this.syncMainCamera(spectator ? 0 : delta, (inGame && !terminated) || deferArenaExit);
    const coopDefensePresentationActive = inArena && isCoopDefenseMode(bridge.getGameMode());
    const presentationMapConfig = coopDefensePresentationActive
      ? getCoopDefenseMapConfig(bridge.getRoundState()?.coopDefenseMapId ?? bridge.getCoopDefenseMapId())
      : null;
    const encounterPresentation = coopDefensePresentationActive
      ? bridge.getCoopDefenseEncounterPresentationState()
      : null;
    this.mapEventAnnouncementPresenter?.setMapEvents(presentationMapConfig?.mapEvents ?? []);
    this.mapEventAnnouncementPresenter?.sync(
      coopDefensePresentationActive ? bridge.getCoopDefenseMapEventPresentationState() : null,
    );
    const secondaryObjectivesActive = coopDefensePresentationActive;
    const secondaryObjectivePresentation = secondaryObjectivesActive
      ? bridge.getCoopDefenseSecondaryObjectivePresentationState()
      : null;
    const encounterElapsedMs = bridge.getSynchronizedNow() - bridge.getArenaStartTime();
    const hostileMainBases = presentationMapConfig?.objective === 'destroy-hostile-bases'
      ? (this.ctx.baseManager?.getMainBasesByFaction('hostile') ?? [])
      : [];
    const bossEnemyKind = presentationMapConfig?.boss?.enemyKind;
    const bossEnemy = bossEnemyKind
      ? this.ctx.enemyManager?.getAllEnemies().find((enemy) => (
        enemy.faction === 'hostile'
        && enemy.kind === bossEnemyKind
        && enemy.sprite.active
        && enemy.getHp() > 0
      ))
      : undefined;
    const mainObjective = presentationMapConfig
      ? buildMainObjectiveViewModel({
        mapId: presentationMapConfig.mapId,
        objective: presentationMapConfig.objective,
        elapsedMs: encounterElapsedMs,
        surviveDurationSec: presentationMapConfig.surviveDurationSec,
        encounterCount: presentationMapConfig.encounters?.length ?? 0,
        encounter: encounterPresentation,
        boss: bossEnemy ? { currentHp: bossEnemy.getHp(), maxHp: bossEnemy.getMaxHp() } : null,
        hostileBases: hostileMainBases.length > 0
          ? {
            currentHp: hostileMainBases.reduce((sum, base) => sum + base.getHp(), 0),
            maxHp: hostileMainBases.reduce((sum, base) => sum + base.getMaxHp(), 0),
            remaining: hostileMainBases.filter((base) => !base.isDestroyed()).length,
            total: hostileMainBases.length,
          }
          : null,
      })
      : null;
    this.ctx.centerHUD.updateMainObjectivePresentation(mainObjective);
    this.ctx.centerHUD.updateEncounterPresentation(encounterPresentation, encounterElapsedMs);
    // Die rechte Missionsspalte steht in Coop-Maps über dem Spielfeld und weicht deshalb vor
    // Figuren und Zielpunkt zurück.
    this.ctx.centerHUD.updateMissionStackOcclusion(delta, this.ctx.playerManager, this.ctx.enemyManager);
    this.renderers.encounterTelegraph.sync(encounterPresentation, encounterElapsedMs, inArena);
    // Pflichtziel und Nebenziel werden im selben Frameabschnitt aktualisiert; die Rundenzeit
    // ist dieselbe Bezugsgroesse, gegen die der Host seine Zustandswechsel datiert.
    this.secondaryObjectiveHud?.sync(
      secondaryObjectivePresentation,
      this.ctx.coopDefenseSecondaryObjectiveConfigs,
      encounterElapsedMs,
      secondaryObjectivesActive,
    );
    this.secondaryObjectiveHud?.updateOcclusionFade(
      delta,
      this.ctx.playerManager,
      this.ctx.enemyManager,
    );
    this.renderers.secondaryObjectiveMarkers.sync(
      secondaryObjectivePresentation,
      this.ctx.coopDefenseSecondaryObjectiveConfigs,
      this.ctx.baseManager,
      this.ctx.coopDefenseCarryItems,
      secondaryObjectivesActive,
    );
    this.renderers.carryZones.sync(
      secondaryObjectivePresentation,
      this.ctx.coopDefenseSecondaryObjectiveConfigs,
      secondaryObjectivesActive,
    );
    this.renderers.objectiveRepairDrones.sync(
      secondaryObjectivePresentation,
      this.ctx.coopDefenseSecondaryObjectiveConfigs,
      this.ctx.baseManager,
      encounterElapsedMs,
      secondaryObjectivesActive,
    );
    this.syncSpectatorPlayerNames(inArena);
    if (coopDefensePresentationActive) {
      this.hostileBaseIndicator?.sync(
        this.ctx.baseManager,
        this.ctx.enemyManager,
        presentationMapConfig,
        true,
      );
    } else {
      this.hostileBaseIndicator?.clear();
    }
    this.playerStatusRing?.setActive(inArena && !spectator);
    this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.setWorldBarsVisible(!inArena);
    if (inArena) {
      this.enemyHoverNameLabel?.sync(this.getEnemyHoverNameTarget());
    } else {
      this.enemyHoverNameLabel?.clear(true);
    }
    // Loading uses the full-screen veil even though the arena itself is still hidden; once the
    // authoritative countdown timestamp exists, the same overlay switches to 3 → 2 → 1.
    this.syncArenaFogOverlay(bridge.getSynchronizedNow(), inGame && !terminated, countdownActive);
    const visualCameraEndMs = diagnosticsActive ? performance.now() : 0;

    this.renderers.beer.update(bridge.getSynchronizedNow(), delta);
    this.renderers.timeBubble.update(delta);
    this.renderers.blackHole.update(delta);
    this.renderers.bfg.update();
    this.renderers.plasmaBurner.update(delta);
    // Nach dem Positionsabgleich der Entities: die Trefferkopien führen ihre Ziele nach.
    this.visualFeedback?.update(delta);
    // Host und Client halten denselben Feldbestand, deshalb genuegt ein Sync-Punkt.
    this.renderers.reinforcementMatrix.syncVisuals(
      inArena ? (this.ctx.reinforcementMatrixSystem?.getActiveMatrices() ?? []) : [],
      bridge.getSynchronizedNow(),
    );
    this.renderers.energyInjector.syncVisuals(
      inArena ? (this.ctx.energyInjectorSystem?.getActiveEffects() ?? []) : [],
      bridge.getSynchronizedNow(),
    );
    const remoteControlTargets = !inArena
      ? []
      : bridge.isHost()
        ? (this.ctx.coopDefenseItemRuntimeSystem?.getRemoteControlSnapshot(
          this.ctx.playerManager.getAllPlayers().map((player) => player.id),
          this.ctx.turretSystem?.getTurrets() ?? [],
        ) ?? [])
        : (bridge.getLatestGameState()?.remoteControlTurrets ?? []);
    this.renderers.remoteControl.syncVisuals(remoteControlTargets, bridge.getSynchronizedNow());
    this.renderers.teslaDome.update(delta);
    this.renderers.teslaNova.update();
    const visualEnemyStartMs = diagnosticsActive ? performance.now() : 0;
    const auraEnemies = inArena ? (this.ctx.enemyManager?.getAllEnemies() ?? []) : [];
    this.ctx.enemyManager?.syncHostVisuals();
    const visualEnemyMs = diagnosticsActive ? performance.now() - visualEnemyStartMs : 0;
    this.renderers.healingAura.syncEnemies(auraEnemies);
    this.renderers.healingAura.update(delta);
    this.renderers.miniTeslaDome.syncEnemies(auraEnemies);
    this.renderers.miniTeslaDome.update(delta);
    this.renderers.energyShield.update(delta);
    this.renderers.guardianSpirit.update(delta);
    this.renderers.repairDrone.update(delta);
    this.renderers.slimeTrail.update(delta);
    this.renderers.flamethrowerUpgrades.update(bridge.getSynchronizedNow());
    const visualEffectsEndMs = diagnosticsActive ? performance.now() : 0;

    const aimPreviewStartedAt = diagnosticsActive ? performance.now() : 0;
    const utilityTargeting    = inArena && !spectator ? this.ctx.inputSystem.getUtilityTargetingPreviewState() : undefined;
    const airstrikeTargeting  = inArena && !spectator ? this.ctx.inputSystem.getAirstrikeTargetingPreviewState() : undefined;
    const utilityPlacement    = inArena && !spectator ? this.getLocalPlacementPreview() : undefined;
    const ultimatePlacement   = inArena && !spectator ? this.getLocalUltimatePlacementPreview() : undefined;
    const constructionPlacement = inArena && !spectator
      ? this.ctx.inputSystem.getConstructionPlacementPreviewState()
      : undefined;
    const activePlacement     = ultimatePlacement ?? utilityPlacement ?? constructionPlacement;
    const ultimatePreview     = inArena && !spectator ? this.ctx.inputSystem.getUltimateChargePreviewState() : undefined;
    const showAim = inArena
      && !optionsOpen
      && !spectator
      && this.localPlayerState.alive
      && !this.localPlayerState.burrowed
      && !this.ctx.inputSystem.isUtilityChargePreviewActive()
      && !this.ctx.inputSystem.isUtilityPlacementActive()
      && !this.ctx.inputSystem.isInspectorConstructionPlacementActive()
      && !this.ctx.inputSystem.isUltimatePlacementActive();
    const scopeProgress = this.ctx.inputSystem.getScopeProgress();
    const aimPreviewMs = diagnosticsActive ? performance.now() - aimPreviewStartedAt : 0;
    const aimGraphicsStartedAt = diagnosticsActive ? performance.now() : 0;
    this.ctx.aimSystem?.setScopeProgress(scopeProgress);
    this.ctx.aimSystem?.setScoping(this.ctx.inputSystem.isScoping());
    this.ctx.aimSystem?.setWeaponChargeProgress(this.ctx.inputSystem.getScopeChargeProgress());
    const targetingForReticle = utilityTargeting ?? airstrikeTargeting;
    this.ctx.aimSystem?.update(
      (showAim || targetingForReticle !== undefined) && !optionsOpen && !spectator,
      inArena && !optionsOpen && !spectator,
      delta,
      optionsOpen ? undefined : targetingForReticle,
      optionsOpen ? undefined : ultimatePreview,
    );
    const aimGraphicsMs = diagnosticsActive ? performance.now() - aimGraphicsStartedAt : 0;

    // Scope-Overlay (Sichtverdunkelung bei AWP und anderen Scope-Waffen)
    const scopeStartedAt = diagnosticsActive ? performance.now() : 0;
    if (this.scopeOverlay) {
      const scopeCfg = inArena && !spectator ? this.ctx.inputSystem.getWeapon2ScopeConfig() : undefined;
      if (scopeCfg) {
        // `pointer.x/y` zählen Renderpixel; das Overlay rechnet im Designraum.
        const pointer = this.input.activePointer;
        this.scopeOverlay.update(
          scopeProgress,
          toDesignSpace(this.scale, pointer.x),
          toDesignSpace(this.scale, pointer.y),
          delta,
          scopeCfg,
        );
      } else {
        // Keine Scope-Waffe ausgerüstet – Overlay ausblenden
        this.scopeOverlay.update(0, 0, 0, delta, { scopeInMs: 1, fullScopeViewRadius: 0, edgeSoftnessPx: 0, unscopedSpreadDeg: 0, unscopeSpeedMs: 200 });
      }
    }
    const scopeMs = diagnosticsActive ? performance.now() - scopeStartedAt : 0;

    const aimIndicatorsStartedAt = diagnosticsActive ? performance.now() : 0;
    this.utilityChargeIndicator?.update(inArena && !spectator ? this.ctx.inputSystem.getUtilityChargePreviewState() : undefined);
    this.ultimateChargeIndicator?.update(ultimatePreview);
    const aimIndicatorsMs = diagnosticsActive ? performance.now() - aimIndicatorsStartedAt : 0;
    const visualAimEndMs = diagnosticsActive ? performance.now() : 0;

    this.gaussWarning.update(inArena);
    this.placementPreview.syncUtilityTargetingHint(inArena, utilityTargeting !== undefined, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.syncAirstrikeTargetingHint(inArena, airstrikeTargeting !== undefined, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.syncPlaceableUtilityHint(inArena, activePlacement, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.renderPlacementPreview(inArena, activePlacement, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.renderRemotePlacementPreviews(inArena);
    const tunnelSnapshot = bridge.isHost()
      ? (this.ctx.tunnelSystem?.getSnapshot() ?? [])
      : (bridge.getLatestGameState()?.tunnels ?? []);
    this.tunnelRenderer.sync(inArena ? tunnelSnapshot : []);
    this.tunnelRenderer.update(this.time.now);

    const visualsEndMs = diagnosticsActive ? performance.now() : 0;
    const visualStepMs   = diagnosticsActive ? visualsEndMs - visualsStartMs : 0;
    const visualCameraMs = diagnosticsActive ? visualCameraEndMs - visualsStartMs : 0;
    // Der Gegner-Sync liegt mitten im Effektblock und wird deshalb wieder herausgerechnet.
    const visualEffectsMs = diagnosticsActive ? visualEffectsEndMs - visualCameraEndMs - visualEnemyMs : 0;
    const visualAimMs = diagnosticsActive ? visualAimEndMs - visualEffectsEndMs : 0;
    const visualHudMs = diagnosticsActive ? visualsEndMs - visualAimEndMs : 0;

    // Letzter Schritt vor Schatten, Licht und Rendering – alles davor rechnet mit der
    // unversetzten Kameraposition (siehe `applyCameraFeedback`).
    this.applyCameraFeedback(delta);
    // Das Tutorial ist ein Weltobjekt: Seine Occlusion-Probe braucht deshalb den finalen
    // Scroll-/Shake-Versatz, den auch der anschließende Render-Schritt verwendet.
    this.ctx.centerHUD.updateTutorialOcclusion(
      delta,
      [
        ...this.ctx.centerHUD.getReservedHudRects(),
        ...(this.secondaryObjectiveHud?.getReservedHudRects() ?? []),
      ],
    );
    // Der Fokus wird erst nach dem finalen Scroll-/Shake-Versatz in Bildschirmkoordinaten
    // übersetzt, damit Radialfilter und Low-Fallback denselben Frame wie die Welt sehen.
    this.ctx.arenaCountdown?.syncAfterCameraFeedback();

    const shadowStepStartMs = diagnosticsActive ? visualsEndMs : 0;
    const trainState = inArena ? this.resolveTrainState() : null;
    // Keep round-scoped static shadows alive while the arena is hidden behind the loading veil;
    // clearing them here would destroy the startup surface before the load barrier can observe it.
    const shadowArenaActive = inArena || (inGame && !terminated);
    this.syncWorldShadows(shadowArenaActive, trainState);
    const shadowStepMs = diagnosticsActive ? performance.now() - shadowStepStartMs : 0;
    this.syncWorldLighting(inArena, trainState);
    const lightingStepMs = diagnosticsActive ? this.renderers.lighting.getLastUpdateCostMs() : 0;

    // Erst jetzt, nachdem alle drei Schichten und moegliche Dirty-Wellen des Frames ihre Arbeit
    // eingereiht haben: ein gemeinsames kleines Budget statt eines separaten Vollbakes je Layer.
    ChunkedRenderSurface.flushBakeBudget(
      this,
      arenaLoading ? CHUNK_BAKE_STARTUP_FRAME_BUDGET_MS : undefined,
    );
    if (inGame && !terminated) {
      this.lifecycle.syncArenaLoadReady(getVisibleWorldView(this.cameras.main));
    }

    // Ganz am Frame-Ende: alle im Frame gesammelten ersetzbaren Zustaende (Snapshot, Input,
    // Ping) gehen gebuendelt raus, statt erst im naechsten Frame.
    const networkFlushStartMs = diagnosticsActive ? performance.now() : 0;
    bridge.flushNetwork();
    const networkFlushMs = diagnosticsActive ? performance.now() - networkFlushStartMs : 0;

    if (!diagnosticsActive) {
      if (companionDiagnosticsActive) this.recordCompanionFrame(delta);
      return;
    }

    const diagnosticsStartedAt = performance.now();
    const role = bridge.isHost() ? 'host' : 'client';
    const runtimePhase = terminated ? 'terminated' : (inGame ? 'arena' : 'lobby');
    const clientMetricsActive = role === 'client' && runtimePhase === 'arena';
    const hostMetricsActive = role === 'host' && runtimePhase === 'arena';
    const firePerformance = this.ctx.fireSystem.takePerformanceMetrics();
    const lightingPerformance = this.renderers.lighting.getPerformanceMetrics();
    const scopePerformance = this.scopeOverlay?.getPerformanceMetrics();
    const clientPerformance = this.clientUpdate.getPerformanceMetrics();
    const hostPerformance = this.hostUpdate.getPerformanceMetrics();
    const detailedDiagnostics = this.runtimeProfiler?.wantsDetailedSampling() ?? false;
    const sceneCounts = this.sampleScenePerformanceCounts(performance.now(), detailedDiagnostics);
    const transportCounts = this.sampleTransportPerformanceCounts(performance.now());
    let sceneBreakdown: string | null = null;
    let sceneBreakdownScanMs = 0;
    if (this.runtimeProfiler?.shouldCaptureSceneBreakdown(role, delta)) {
      const breakdownStartedAt = performance.now();
      sceneBreakdown = this.describeSceneObjectBreakdown();
      sceneBreakdownScanMs = performance.now() - breakdownStartedAt;
    }
    const localId = bridge.getLocalPlayerId();
    const rawDelta = this.game.loop.rawDelta;
    const runtimeContext = {
      localAlive: this.localPlayerState.alive,
      aimVisible: showAim,
      scopeActive: scopeProgress > 0.005,
      utilityPlacementActive: utilityPlacement !== undefined,
      ultimatePlacementActive: ultimatePlacement !== undefined,
      optionsOpen,
      pageVisible: typeof document === 'undefined' || document.visibilityState === 'visible',
      documentFocused: typeof document === 'undefined' || document.hasFocus(),
      weapon1Id: bridge.getPlayerLoadoutSlot(localId, 'weapon1') ?? null,
      weapon2Id: bridge.getPlayerLoadoutSlot(localId, 'weapon2') ?? null,
      utilityId: bridge.getPlayerLoadoutSlot(localId, 'utility') ?? null,
      ultimateId: bridge.getPlayerLoadoutSlot(localId, 'ultimate') ?? null,
    };
    const detailTimings = {
      scenePreludeMs,
      sceneStateMs,
      postRoleMs,
      diagnosticsMs: 0,
      inputCameraMs,
      lobbyUiMs,
      arenaHudMs,
      leaderboardCanopyMs,
      arenaPanelMs,
      hostCoordinatorMs: hostMetricsActive ? hostPerformance.totalMs : 0,
      hostEnemyAiMs: hostMetricsActive ? hostPerformance.enemyAiMs : 0,
      hostNavFlowFieldMs: hostMetricsActive ? hostPerformance.navFlowFieldMs : 0,
      hostNavWorkerMs: hostMetricsActive ? hostPerformance.navWorkerComputeMs : 0,
      hostPlayerSystemsMs: hostMetricsActive ? hostPerformance.playerSystemsMs : 0,
      hostPhysicsMs: hostMetricsActive ? hostPerformance.physicsMs : 0,
      hostCombatProjectilesMs: hostMetricsActive ? hostPerformance.combatProjectilesMs : 0,
      hostExplosionsMs: hostMetricsActive ? hostPerformance.explosionsMs : 0,
      hostAreaEffectsMs: hostMetricsActive ? hostPerformance.areaEffectsMs : 0,
      hostWorldVisualsMs: hostMetricsActive ? hostPerformance.worldVisualsMs : 0,
      hostHudMs: hostMetricsActive ? hostPerformance.hudMs : 0,
      hostEffectFlushMs: hostMetricsActive ? hostPerformance.effectFlushMs : 0,
      hostSnapshotBuildMs: hostMetricsActive ? hostPerformance.snapshotBuildMs : 0,
      clientCoordinatorMs: clientMetricsActive ? clientPerformance.totalMs : 0,
      clientSnapshotMs: clientMetricsActive ? clientPerformance.snapshotMs : 0,
      clientPlayersMs: clientMetricsActive ? clientPerformance.playersMs : 0,
      clientProjectilesEffectsMs: clientMetricsActive ? clientPerformance.projectilesEffectsMs : 0,
      clientWorldStateMs: clientMetricsActive ? clientPerformance.worldStateMs : 0,
      clientInterpolationMs: clientMetricsActive ? clientPerformance.interpolationMs : 0,
      clientHudMs: clientMetricsActive ? clientPerformance.hudMs : 0,
      clientRendererSyncMs,
      clientPostSyncMs: clientMetricsActive ? clientPerformance.postSyncMs : 0,
      aimPreviewMs,
      aimGraphicsMs,
      scopeMs,
      scopeRasterMs: scopePerformance?.rasterMs ?? 0,
      scopeUploadMs: scopePerformance?.uploadMs ?? 0,
      aimIndicatorsMs,
      lightingExpireMs: lightingPerformance.expireMs,
      lightingQueueMs: lightingPerformance.queueMs,
      lightingCommandBuildMs: lightingPerformance.commandBuildMs,
      lightingDirectMs: lightingPerformance.directMs,
      lightingOcclusionMs: lightingPerformance.occlusionMs,
      lightingShadowGeometryMs: lightingPerformance.shadowGeometryMs,
      sceneCountScanMs: sceneCounts.scanMs,
      sceneBreakdownScanMs,
      transportSampleMs: transportCounts.sampleMs,
    };
    const detailCounts = {
      willRenderObjectCount: sceneCounts.willRenderObjectCount,
      inCameraBoundsObjectCount: sceneCounts.inCameraBoundsObjectCount,
      hiddenObjectCount: sceneCounts.hiddenObjectCount,
      internalFilterCount: sceneCounts.internalFilterCount,
      externalFilterCount: sceneCounts.externalFilterCount,
      filteredObjectCount: sceneCounts.filteredObjectCount,
      cameraFilterCount: sceneCounts.cameraFilterCount,
      aimGraphicsCommandCount: this.ctx.aimSystem?.getGraphicsCommandCount() ?? 0,
      scopeRefreshCount: scopePerformance?.refreshed ? 1 : 0,
      scopeTexturePixels: scopePerformance?.texturePixels ?? 0,
      directLightCount: lightingPerformance.directLights,
      occludingLightCount: lightingPerformance.occludingLights,
      fallbackOccludingLightCount: lightingPerformance.fallbackOccludingLights,
      radialLightCount: lightingPerformance.radialLights,
      coneLightCount: lightingPerformance.coneLights,
      lightShadowQuadCount: lightingPerformance.shadowQuads,
      lightFalloffQuadCount: lightingPerformance.falloffQuads,
      dynamicLightOccluderTestCount: lightingPerformance.dynamicOccluderTests,
      dynamicLightOccluderHitCount: lightingPerformance.dynamicOccluderHits,
      lightingCommandCount: lightingPerformance.commandCount,
      lightMapPixelCount: lightingPerformance.lightMapPixels,
      lightingScratchPixelCount: lightingPerformance.scratchPixels,
      newNetworkSnapshotCount: clientMetricsActive && clientPerformance.newSnapshot ? 1 : 0,
      hostNetworkTickCount: hostMetricsActive && hostPerformance.networkTick ? 1 : 0,
      hostExplosionEventCount: hostMetricsActive ? hostPerformance.explosionEventCount : 0,
      transportLinkCount: transportCounts.linkCount,
      transportBackpressureLinkCount: transportCounts.backpressureLinkCount,
      transportReliableBufferedBytes: transportCounts.reliableBufferedBytes,
      transportFastBufferedBytes: transportCounts.fastBufferedBytes,
      transportDroppedFastMessages: transportCounts.droppedFastMessages,
      transportSentBytesPerSec: transportCounts.sentBytesPerSec,
      transportReceivedBytesPerSec: transportCounts.receivedBytesPerSec,
      transportMedianRttMs: transportCounts.medianRttMs,
      transportMedianAppPingMs: transportCounts.medianAppPingMs,
    };
    detailTimings.diagnosticsMs = performance.now() - diagnosticsStartedAt;
    const updateMs = performance.now() - frameStartMs;
    const frameLifecycle = this.runtimeProfiler?.takeLastFrameLifecycleMetrics(updateMs) ?? {
      gameStepMs: 0,
      sceneManagerUpdateMs: 0,
      sceneSystemsAndPluginsMs: 0,
      rendererSetupMs: 0,
      betweenFramesMs: 0,
    };
    this.runtimeProfiler?.record({
      role,
      phase: runtimePhase,
      quality: this.graphicsQuality.getLevel(),
      mode: bridge.getGameMode(),
      mapId: isCoopDefenseMode(bridge.getGameMode())
        ? (bridge.getRoundState()?.coopDefenseMapId ?? bridge.getCoopDefenseMapId())
        : null,
      ablation: this.performanceAblation?.getCurrentCategory() ?? 'baseline',
      rawDeltaMs: Number.isFinite(rawDelta) && rawDelta > 0 ? rawDelta : delta,
      deltaMs: delta,
      updateMs,
      gameStepMs: frameLifecycle.gameStepMs,
      phaserSceneUpdateMs: frameLifecycle.sceneManagerUpdateMs,
      phaserSceneSystemsMs: frameLifecycle.sceneSystemsAndPluginsMs,
      rendererSetupMs: frameLifecycle.rendererSetupMs,
      betweenFramesMs: frameLifecycle.betweenFramesMs,
      renderSubmitMs: this.runtimeProfiler.takeLastRenderSubmitMs(),
      roleStepMs: primaryStepMs,
      networkUpdateMs,
      networkFlushMs,
      visualStepMs,
      visualCameraMs,
      visualEnemyMs,
      visualEffectsMs,
      visualAimMs,
      visualHudMs,
      shadowStepMs,
      lightingStepMs,
      fireSimulationMs: firePerformance.simulationMs,
      fireCreationMs: firePerformance.creationMs,
      fireVisualMs: this.renderers.flamethrowerUpgrades.getLastUpdateCostMs(),
      enemyCount: this.ctx.enemyManager?.getAllEnemies().length ?? 0,
      projectileCount: this.ctx.projectileManager.getDebugActiveProjectileCount(),
      playerCount: this.ctx.playerManager.getAllPlayers().length,
      // Einschliesslich der Kinder der Fels-Ebene: Sonst meldete die Diagnose eine Szene ohne Welt.
      displayObjectCount: countSceneDisplayObjects(this),
      visibleObjectCount: sceneCounts.visibleObjectCount,
      particleEmitterCount: sceneCounts.particleEmitterCount,
      aliveParticleCount: sceneCounts.aliveParticleCount,
      activeFilterCount: sceneCounts.activeFilterCount,
      activeLightCount: lightingPerformance.activeLights,
      renderedLightCount: lightingPerformance.renderedLights,
      drawCallCount: this.runtimeProfiler.takeLastDrawCallCount(),
      details: {
        timings: detailTimings,
        counts: detailCounts,
      },
      context: runtimeContext,
      lightPresetCounts: lightingPerformance.presetCounts,
      filterBreakdown: sceneCounts.filterBreakdown,
      sceneBreakdown,
    });
  }

  private seedCompanionBaselines(recordingId: number): void {
    const flowfieldSource = this.ctx.flowFieldCoordinator ?? null;
    const rockSource = this.ctx.arenaResult?.rockVisualSystem ?? null;
    const vfxSource = this.renderers.gpuVfx;
    const flowfield = flowfieldSource?.getDiagnostics(performance.now()) ?? null;
    const rockGpu = rockSource?.getGpuDiagnostics() ?? null;
    const vfxCounters = vfxSource.getCompanionCounters();
    this.companionBaselineRecordingId = recordingId;
    this.companionFlowfieldSource = flowfieldSource;
    this.companionRockSource = rockSource;
    this.companionVfxSource = vfxSource;
    this.companionFlowfieldCounters = {
      startedJobs: flowfield?.startedJobs ?? 0,
      workerComputeTotalMs: flowfield?.workerComputeTotalMs ?? 0,
      roundTripTotalMs: flowfield?.roundTripTotalMs ?? 0,
    };
    this.companionRockCounters = {
      dirtyRocks: rockGpu?.dirtyRocks ?? 0,
      affectedPages: rockGpu?.affectedPages ?? 0,
      sparseUploads: rockGpu?.sparseUploads ?? 0,
      fullUploads: rockGpu?.fullUploads ?? 0,
      uploadBytes: rockGpu?.estimatedUploadBytes ?? 0,
    };
    this.companionVfxCounters = {
      spawns: vfxCounters.spawns,
      capacityDrops: vfxCounters.capacityDrops,
    };
    this.companionRockInterval = { dirtyRocks: 0, affectedPages: 0, sparseUploads: 0, fullUploads: 0, uploadBytes: 0 };
    this.companionVfxInterval = { spawns: 0, capacityDrops: 0 };
    this.companionStaleFlowfields.clear();
  }

  private recordCompanionFrame(delta: number): void {
    const runtimePhase = this.lifecycle.isMatchTerminated()
      ? 'terminated'
      : bridge.getGamePhase() === 'ARENA' ? 'arena' : 'lobby';
    const role = bridge.isHost() ? 'host' : 'client';
    const rawDelta = this.game.loop.rawDelta;
    const hostPerformance = bridge.isHost() ? this.hostUpdate.getPerformanceMetrics() : null;
    const clientPerformance = bridge.isHost() ? null : this.clientUpdate.getPerformanceMetrics();
    const performanceNow = performance.now();
    const sampleSubsystems = performanceNow >= this.nextCompanionSubsystemSampleAtMs;
    if (sampleSubsystems) this.nextCompanionSubsystemSampleAtMs = performanceNow + 250;
    if (sampleSubsystems) this.sampleTransportPerformanceCounts(performanceNow);
    const transport = this.transportPerformanceCounts;
    const backpressureActive = transport.backpressureLinkCount > 0;
    if (backpressureActive !== this.companionBackpressureActive) {
      this.companionBackpressureActive = backpressureActive;
      if (backpressureActive) {
        this.runtimeProfiler?.recordSemanticEvent('network:backpressure', {
          bufferedBytes: transport.reliableBufferedBytes + transport.fastBufferedBytes,
          linkCount: transport.backpressureLinkCount,
        });
      }
    }
    const mapId = isCoopDefenseMode(bridge.getGameMode())
      ? (bridge.getRoundState()?.coopDefenseMapId ?? bridge.getCoopDefenseMapId())
      : null;
    const hostCpuMs = hostPerformance?.totalMs ?? 0;
    const clientCpuMs = clientPerformance?.totalMs ?? 0;
    const roleCpuMs = role === 'host' ? hostCpuMs : clientCpuMs;
    let flowfield: FlowFieldDiagnostics | null = null;
    let flowfieldJobs = 0;
    let flowfieldComputeMs = 0;
    let flowfieldRoundTripMs = 0;
    if (sampleSubsystems) {
      flowfield = this.ctx.flowFieldCoordinator?.getDiagnostics(performanceNow) ?? null;
      const flowfieldSource = this.ctx.flowFieldCoordinator ?? null;
      const rockSource = this.ctx.arenaResult?.rockVisualSystem ?? null;
      const vfxSource = this.renderers.gpuVfx;
      const rockGpu = rockSource?.getGpuDiagnostics() ?? null;
      const vfxCounters = vfxSource.getCompanionCounters();
      const newBaseline = this.companionBaselineRecordingId !== (this.runtimeProfiler?.getRecordingId() ?? 0)
        || this.companionFlowfieldSource !== flowfieldSource
        || this.companionRockSource !== rockSource
        || this.companionVfxSource !== vfxSource;
      if (newBaseline) {
        this.companionBaselineRecordingId = this.runtimeProfiler?.getRecordingId() ?? 0;
        this.companionFlowfieldSource = flowfieldSource;
        this.companionRockSource = rockSource;
        this.companionVfxSource = vfxSource;
        this.companionFlowfieldCounters = {
          startedJobs: flowfield?.startedJobs ?? 0,
          workerComputeTotalMs: flowfield?.workerComputeTotalMs ?? 0,
          roundTripTotalMs: flowfield?.roundTripTotalMs ?? 0,
        };
        this.companionRockCounters = {
          dirtyRocks: rockGpu?.dirtyRocks ?? 0,
          affectedPages: rockGpu?.affectedPages ?? 0,
          sparseUploads: rockGpu?.sparseUploads ?? 0,
          fullUploads: rockGpu?.fullUploads ?? 0,
          uploadBytes: rockGpu?.estimatedUploadBytes ?? 0,
        };
        this.companionVfxCounters = {
          spawns: vfxCounters.spawns,
          capacityDrops: vfxCounters.capacityDrops,
        };
        this.companionRockInterval = { dirtyRocks: 0, affectedPages: 0, sparseUploads: 0, fullUploads: 0, uploadBytes: 0 };
        this.companionVfxInterval = { spawns: 0, capacityDrops: 0 };
        this.companionStaleFlowfields.clear();
      }
      if (flowfield) {
        if (!newBaseline) {
          flowfieldJobs = Math.max(0, flowfield.startedJobs - this.companionFlowfieldCounters.startedJobs);
          flowfieldComputeMs = Math.max(0, flowfield.workerComputeTotalMs - this.companionFlowfieldCounters.workerComputeTotalMs);
          flowfieldRoundTripMs = Math.max(0, flowfield.roundTripTotalMs - this.companionFlowfieldCounters.roundTripTotalMs);
        }
        this.companionFlowfieldCounters.startedJobs = flowfield.startedJobs;
        this.companionFlowfieldCounters.workerComputeTotalMs = flowfield.workerComputeTotalMs;
        this.companionFlowfieldCounters.roundTripTotalMs = flowfield.roundTripTotalMs;
        this.companionFlowfieldGauge.queueDepth = flowfield.backlogTicks;
        this.companionFlowfieldGauge.ageMs = Math.max(0, ...Object.values(flowfield.fields)
          .filter((field) => field.staleEligible && field.activeAgeMs !== null)
          .map((field) => field.activeAgeMs ?? 0));
        for (const [fieldId, field] of Object.entries(flowfield.fields)) {
          if (field.stale && !this.companionStaleFlowfields.has(fieldId)) {
            this.runtimeProfiler?.recordSemanticEvent('flowfield:stale', {
              fieldId,
              goalMode: field.goalMode,
              activeAgeMs: field.activeAgeMs,
              staleAfterMs: field.staleAfterMs,
            });
          }
          if (field.stale) this.companionStaleFlowfields.add(fieldId);
          else this.companionStaleFlowfields.delete(fieldId);
        }
      }
      if (!newBaseline) this.updateCompanionRockCounters(rockGpu);
      if (!newBaseline) {
        this.companionVfxInterval = {
          spawns: Math.max(0, vfxCounters.spawns - this.companionVfxCounters.spawns),
          capacityDrops: Math.max(0, vfxCounters.capacityDrops - this.companionVfxCounters.capacityDrops),
        };
      }
      this.companionVfxCounters = {
        spawns: vfxCounters.spawns,
        capacityDrops: vfxCounters.capacityDrops,
      };
      const vfxStats = vfxSource.getStats();
      this.companionActiveVfx = vfxStats
        ? Object.values(vfxStats).reduce((sum, stats) => sum + stats.liveCount, 0)
        : 0;
      this.companionVisiblePages = rockGpu?.visiblePages ?? 0;
    }
    this.runtimeProfiler?.record({
      role,
      phase: runtimePhase,
      quality: this.graphicsQuality.getLevel(),
      mode: bridge.getGameMode(),
      mapId,
      ablation: this.performanceAblation?.getCurrentCategory() ?? 'baseline',
      rawDeltaMs: Number.isFinite(rawDelta) && rawDelta > 0 ? rawDelta : delta,
      deltaMs: delta,
      updateMs: roleCpuMs,
      gameStepMs: Number.isFinite(rawDelta) && rawDelta > 0 ? rawDelta : delta,
      phaserSceneUpdateMs: 0,
      phaserSceneSystemsMs: 0,
      rendererSetupMs: 0,
      betweenFramesMs: 0,
      renderSubmitMs: 0,
      roleStepMs: roleCpuMs,
      networkUpdateMs: 0,
      networkFlushMs: 0,
      visualStepMs: 0,
      visualCameraMs: 0,
      visualEnemyMs: 0,
      visualEffectsMs: 0,
      visualAimMs: 0,
      visualHudMs: 0,
      shadowStepMs: 0,
      lightingStepMs: 0,
      fireSimulationMs: 0,
      fireCreationMs: 0,
      fireVisualMs: 0,
      enemyCount: this.ctx.enemyManager?.getAllEnemies().length ?? 0,
      projectileCount: this.ctx.projectileManager.getDebugActiveProjectileCount(),
      playerCount: this.ctx.playerManager.getAllPlayers().length,
      displayObjectCount: 0,
      visibleObjectCount: 0,
      particleEmitterCount: 0,
      aliveParticleCount: 0,
      activeFilterCount: 0,
      activeLightCount: 0,
      renderedLightCount: 0,
      drawCallCount: 0,
      details: {
        timings: {
          hostCpuMs,
          clientCpuMs,
          snapshotBuildMs: hostPerformance?.snapshotBuildMs ?? 0,
          flowfieldComputeMs,
          flowfieldRoundTripMs,
          flowfieldAgeMs: this.companionFlowfieldGauge.ageMs,
          flowfieldQueueDepth: this.companionFlowfieldGauge.queueDepth,
        },
        counts: {
          newNetworkSnapshotCount: clientPerformance?.newSnapshot ? 1 : 0,
          hostNetworkTickCount: hostPerformance?.networkTick ? 1 : 0,
          transportReliableBufferedBytes: transport.reliableBufferedBytes,
          transportFastBufferedBytes: transport.fastBufferedBytes,
          transportDroppedFastMessages: transport.droppedFastMessages,
          transportSentBytesPerSec: transport.sentBytesPerSec,
          transportReceivedBytesPerSec: transport.receivedBytesPerSec,
          transportMedianRttMs: transport.medianRttMs,
          transportMedianAppPingMs: transport.medianAppPingMs,
          flowfieldJobs,
          dirtyRocks: this.companionRockInterval.dirtyRocks,
          affectedPages: this.companionRockInterval.affectedPages,
          sparseUploads: this.companionRockInterval.sparseUploads,
          fullUploads: this.companionRockInterval.fullUploads,
          uploadBytes: this.companionRockInterval.uploadBytes,
          vfxSpawns: this.companionVfxInterval.spawns,
          capacityDrops: this.companionVfxInterval.capacityDrops,
          visiblePages: this.companionVisiblePages,
          activeVfx: this.companionActiveVfx,
        },
      },
      context: {
        localAlive: this.localPlayerState.alive,
        aimVisible: false,
        scopeActive: false,
        utilityPlacementActive: false,
        ultimatePlacementActive: false,
        optionsOpen: this.ctx.leftPanel.isOptionsOverlayOpen(),
        pageVisible: typeof document === 'undefined' || document.visibilityState === 'visible',
        documentFocused: typeof document === 'undefined' || document.hasFocus(),
        weapon1Id: bridge.getPlayerLoadoutSlot(bridge.getLocalPlayerId(), 'weapon1') ?? null,
        weapon2Id: bridge.getPlayerLoadoutSlot(bridge.getLocalPlayerId(), 'weapon2') ?? null,
        utilityId: bridge.getPlayerLoadoutSlot(bridge.getLocalPlayerId(), 'utility') ?? null,
        ultimateId: bridge.getPlayerLoadoutSlot(bridge.getLocalPlayerId(), 'ultimate') ?? null,
      },
      diagnosticContext: {
        rockRenderer: this.ctx.arenaResult?.rockVisualSystem.getMode() ?? getRockRendererMode(),
        rockGpuPageSize: this.ctx.arenaResult?.rockVisualSystem.getPageSize() ?? getRockGpuPageSize(),
      },
    });
    // Delta-derived subsystem values belong to this sample only. Gauges above remain live on
    // every frame; repeating an interval delta over the three intervening frames would inflate
    // the 250-ms aggregate.
    this.companionRockInterval = { dirtyRocks: 0, affectedPages: 0, sparseUploads: 0, fullUploads: 0, uploadBytes: 0 };
    this.companionVfxInterval = { spawns: 0, capacityDrops: 0 };
  }

  private updateCompanionRockCounters(current: PersistentGpuWorldDiagnostics | null): void {
    if (!current) {
      this.companionVisiblePages = 0;
      this.companionRockInterval = { dirtyRocks: 0, affectedPages: 0, sparseUploads: 0, fullUploads: 0, uploadBytes: 0 };
      return;
    }
    const previous = this.companionRockCounters;
    this.companionRockInterval = {
      dirtyRocks: Math.max(0, current.dirtyRocks - previous.dirtyRocks),
      affectedPages: Math.max(0, current.affectedPages - previous.affectedPages),
      sparseUploads: Math.max(0, current.sparseUploads - previous.sparseUploads),
      fullUploads: Math.max(0, current.fullUploads - previous.fullUploads),
      uploadBytes: Math.max(0, current.estimatedUploadBytes - previous.uploadBytes),
    };
    this.companionRockCounters = {
      dirtyRocks: current.dirtyRocks,
      affectedPages: current.affectedPages,
      sparseUploads: current.sparseUploads,
      fullUploads: current.fullUploads,
      uploadBytes: current.estimatedUploadBytes,
    };
    this.companionVisiblePages = current.visiblePages;
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
    if (this.ctx.playerManager.hasPlayer(id)) {
      this.lifecycle.removePlayerFromActiveRound(id);
    }
    if (bridge.getGamePhase() === 'ARENA' && id === bridge.getMatchHostId()) {
      this.lifecycle.terminateMatch();
    }
  }

  // ── Lobby callbacks ───────────────────────────────────────────────────────

  private onReadyToggled(): void {
    const nowReady = !this.lifecycle.getIsLocalReady();
    if (nowReady) {
      // Frühwarnung gegen Lobby-Desync (Bug A/B): Nur bereit machen, wenn dieser Client mit dem
      // host-autoritativen Lobby-Stand aufgeschlossen ist (Spieler-Roster, Modus, Coop-Map). Sonst
      // könnte er einen Mitspieler nicht rendern oder ein für den Modus ungültiges Loadout committen.
      // Weiches Blockieren (kein Dauerblock) + Logging; löst sich, sobald der Stand konvergiert.
      const lobbySync = bridge.getLobbySyncConsistency();
      if (!lobbySync.consistent) {
        console.warn(
          `[LobbySync] BEREIT blockiert – lokaler Stand weicht vom Host ab: ${lobbySync.issues.join(' | ')}. `
          + `Lokal bekannt: [${bridge.getConnectedPlayerIds().join(', ')}].`,
        );
        this.lobbyOverlay.showReadySyncNotice();
        return;
      }
      bridge.setLocalReadyWithCommittedLoadout(this.buildLocalCommittedLoadoutSnapshot());
    } else {
      bridge.setLocalReady(false);
    }
    this.lifecycle.setIsLocalReady(nowReady);
  }

  private openCoopDefenseUpgradesOverlay(): void {
    if (bridge.getGamePhase() !== 'LOBBY' || !isCoopDefenseMode(bridge.getGameMode())) return;
    if (this.lifecycle.getIsLocalReady() || bridge.getPlayerReady(bridge.getLocalPlayerId())) return;

    this.coopDefenseXpDebugOverlay?.hide();
    this.refreshStoredCoopDefenseProgress();
    this.coopDefenseUpgradeProfileSnapshot = getStoredCoopDefenseProgress();
    this.coopDefenseUpgradesOverlay?.show();
  }

  /**
   * Items sind nur ausserhalb eines Matches wechselbar. Ein bereiter Spieler muss zuerst
   * „NICHT BEREIT“ waehlen, bevor er dieses Menue oeffnen kann.
   */
  private openCoopDefenseItemsOverlay(): void {
    if (bridge.getGamePhase() !== 'LOBBY' || !isCoopDefenseMode(bridge.getGameMode())) return;
    if (this.lifecycle.getIsLocalReady() || bridge.getPlayerReady(bridge.getLocalPlayerId())) return;
    // Zweite Verteidigungslinie neben der Button-Sperre.
    if (!getStoredCoopDefenseItemsUnlocked()) return;

    this.coopDefenseXpDebugOverlay?.hide();
    // Ab hier hat der Spieler seine Teile gesehen; der Hinweis am Button erlischt.
    markStoredCoopDefenseItemsSeen();
    this.refreshCoopDefenseItemsButton();
    this.itemsOverlay?.show();
  }

  private getCoopDefenseItemsOverlayState(): CoopDefenseItemsOverlayState {
    const progress = getStoredCoopDefenseProgress();
    return {
      items: progress.items,
      equippedItemIds: progress.equippedItemIds,
      hasPendingReward: progress.pendingItemReward !== null,
    };
  }

  /** Nach jeder Item-Aenderung: Lobby-Anzeige und Fortschritts-Cache nachziehen. */
  private afterCoopDefenseItemChange(): void {
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(
      isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null,
    );
    this.refreshCoopDefenseItemsButton();
  }

  private refreshCoopDefenseItemsButton(): void {
    this.lobbyOverlay.setCoopDefenseItemsState(
      isCoopDefenseMode(bridge.getGameMode()) && this.coopDefenseItemsUnlocked,
      this.coopDefenseHasPendingItemReward,
      this.coopDefenseHasUnseenItems,
    );
  }

  private cancelCoopDefenseUpgradeChanges(): void {
    const snapshot = this.coopDefenseUpgradeProfileSnapshot;
    this.coopDefenseUpgradeProfileSnapshot = null;
    if (!snapshot) return;

    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    restoreStoredCoopDefenseProgress(snapshot);
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
    this.ctx.leftPanel.refreshColorIndicator();
  }

  private applyCoopDefenseUpgradeChanges(): void {
    // Aenderungen wurden bereits live uebernommen; Snapshot verwerfen.
    this.coopDefenseUpgradeProfileSnapshot = null;
  }

  private selectCoopDefenseClass(classId: CoopDefenseClassId): void {
    if (bridge.getGamePhase() !== 'LOBBY' || !isCoopDefenseMode(bridge.getGameMode())) return;
    const stored = getStoredCoopDefenseProgress();
    if (!stored.unlockedClassIds.includes(classId)) return;

    // Der Bridge-Zustand ist nur das aktuell aktive Loadout. Vor dem Wechsel wird er
    // deshalb noch einmal explizit im Profil der bisherigen Klasse gesichert. Alle
    // persistenten Änderungen werden anschließend in einem Schreibvorgang gebündelt.
    const previousLoadout: Partial<Record<LoadoutSlot, string>> = {};
    const localId = bridge.getLocalPlayerId();
    for (const slot of ['weapon1', 'weapon2', 'utility', 'ultimate'] as const) {
      const itemId = bridge.getPlayerLoadoutSlot(localId, slot);
      if (itemId) previousLoadout[slot] = itemId;
    }

    const savedNextLoadout = getStoredCoopDefenseLoadout(classId);
    const profile = stored.profilesByClass[classId];
    const nextLoadout: Partial<Record<LoadoutSlot, string>> = {};
    for (const slot of ['weapon1', 'weapon2', 'utility', 'ultimate'] as const) {
      const selectable = getSelectableLoadoutItems(slot, bridge.getGameMode(), profile, classId);
      if (selectable.length === 0) continue;
      const savedId = savedNextLoadout[slot];
      nextLoadout[slot] = savedId && selectable.some((item) => item.id === savedId)
        ? savedId
        : selectable[0].id;
    }

    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    switchStoredCoopDefenseClassLoadout(
      stored.selectedClassId,
      classId,
      previousLoadout,
      nextLoadout,
    );
    for (const slot of ['weapon1', 'weapon2', 'utility', 'ultimate'] as const) {
      const itemId = nextLoadout[slot];
      if (itemId && bridge.getPlayerLoadoutSlot(localId, slot) !== itemId) {
        bridge.setLocalLoadoutSlot(slot, itemId);
      }
    }
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(this.coopDefenseProgress);
    this.ctx.leftPanel.refreshColorIndicator();
  }

  private levelUpCoopDefenseUpgrade(upgradeId: string): boolean {
    const stored = getStoredCoopDefenseProgress();
    const classesUnlocked = stored.unlockedClassIds.length > 0;
    const activeClassId = classesUnlocked
      ? stored.selectedClassId
      : DEFAULT_COOP_DEFENSE_CLASS_ID;
    const activeProfile = classesUnlocked
      ? stored.profilesByClass[stored.selectedClassId]
      : stored.defaultProfile;
    const nextProfile = levelUpCoopDefenseUpgrade(
      activeProfile,
      upgradeId,
      this.coopDefenseProgress.level,
      stored.completedBossMapIds.length,
      activeClassId,
    );
    if (!nextProfile) return false;

    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    setStoredCoopDefenseUpgradeProfile(nextProfile, activeClassId);

    const loadoutSelection = getCoopDefenseUpgradeLoadoutSelection(upgradeId);
    if (loadoutSelection && activeClassId !== 'inspector_gadachs') {
      bridge.setLocalLoadoutSlot(loadoutSelection.slot, loadoutSelection.itemId);
      if (stored.classesUnlocked) {
        setStoredCoopDefenseLoadoutSlot(activeClassId, loadoutSelection.slot, loadoutSelection.itemId);
      } else {
        setStoredLoadoutSlot(loadoutSelection.slot, loadoutSelection.itemId);
      }
    }

    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
    return true;
  }

  private toggleLoadoutTool(tool: LoadoutToolRef): boolean {
    const stored = getStoredCoopDefenseProgress();
    if (stored.selectedClassId !== 'inspector_gadachs') return false;
    const profile = stored.profilesByClass.inspector_gadachs;
    const current = [...(profile.toolLoadout ?? [])];
    const index = current.findIndex((entry) => entry.kind === tool.kind && entry.id === tool.id);
    if (index >= 0) {
      current.splice(index, 1);
    } else {
      const capacity = getCoopDefenseToolCapacity(profile);
      if (current.length >= capacity) return false;
      if (!getUnlockedLoadoutToolRefs(profile).some((entry) => entry.kind === tool.kind && entry.id === tool.id)) return false;
      current.push({ ...tool });
    }
    const selected = profile.selectedTool
      && current.some((entry) => entry.kind === profile.selectedTool?.kind && entry.id === profile.selectedTool?.id)
      ? profile.selectedTool
      : current[0] ?? null;
    const nextProfile = setLoadoutToolSlots(profile, current, selected);
    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    setStoredCoopDefenseUpgradeProfile(nextProfile, 'inspector_gadachs');
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(this.coopDefenseProgress);
    this.ctx.leftPanel.refreshColorIndicator();
    return true;
  }

  /** Setzt die Utility-Slots als Ganzes (Auswahl-Popup); nur freigeschaltete Utilities zaehlen. */
  private setLoadoutTools(tools: readonly LoadoutToolRef[]): boolean {
    const stored = getStoredCoopDefenseProgress();
    if (stored.selectedClassId !== 'inspector_gadachs') return false;
    const profile = stored.profilesByClass.inspector_gadachs;
    if (tools.length > getCoopDefenseToolCapacity(profile)) return false;

    const unlocked = getUnlockedLoadoutToolRefs(profile);
    if (!tools.every((tool) => unlocked.some((entry) => entry.kind === tool.kind && entry.id === tool.id))) {
      return false;
    }

    const previous = profile.selectedTool;
    const selected = previous && tools.some((tool) => tool.kind === previous.kind && tool.id === previous.id)
      ? previous
      : tools[0] ?? null;
    setStoredCoopDefenseUpgradeProfile(
      setLoadoutToolSlots(profile, tools.map((tool) => ({ ...tool })), selected),
      'inspector_gadachs',
    );
    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(this.coopDefenseProgress);
    this.ctx.leftPanel.refreshColorIndicator();
    return true;
  }

  /** Liest die aktuell ausgeruestete Item-ID je Loadout-Slot des lokalen Spielers. */
  private getLocalLoadoutSelection(): Record<LoadoutSlot, string | null> {
    const localId = bridge.getLocalPlayerId();
    return {
      weapon1: bridge.getPlayerLoadoutSlot(localId, 'weapon1') ?? null,
      weapon2: bridge.getPlayerLoadoutSlot(localId, 'weapon2') ?? null,
      utility: bridge.getPlayerLoadoutSlot(localId, 'utility') ?? null,
      ultimate: bridge.getPlayerLoadoutSlot(localId, 'ultimate') ?? null,
    };
  }

  /** Setzt einen Loadout-Slot aus dem Upgrade-Overlay heraus (gleiche Wirkung wie das Lobby-Karussell). */
  private selectLoadoutItem(slot: LoadoutSlot, itemId: string): boolean {
    if (bridge.getGamePhase() !== 'LOBBY' || !isCoopDefenseMode(bridge.getGameMode())) return false;
    if (bridge.getPlayerLoadoutSlot(bridge.getLocalPlayerId(), slot) === itemId) return false;
    const stored = getStoredCoopDefenseProgress();

    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    bridge.setLocalLoadoutSlot(slot, itemId);
    if (stored.classesUnlocked) {
      setStoredCoopDefenseLoadoutSlot(stored.selectedClassId, slot, itemId);
    } else {
      setStoredLoadoutSlot(slot, itemId);
    }
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(this.coopDefenseProgress);
    this.ctx.leftPanel.refreshColorIndicator();
    return true;
  }

  private levelDownCoopDefenseUpgrade(upgradeId: string): boolean {
    const stored = getStoredCoopDefenseProgress();
    const activeClassId = stored.classesUnlocked
      ? stored.selectedClassId
      : DEFAULT_COOP_DEFENSE_CLASS_ID;
    const activeProfile = stored.classesUnlocked
      ? stored.profilesByClass[stored.selectedClassId]
      : stored.defaultProfile;
    const nextProfile = levelDownCoopDefenseUpgrade(
      activeProfile,
      upgradeId,
      activeClassId,
    );
    if (!nextProfile) return false;

    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    setStoredCoopDefenseUpgradeProfile(nextProfile, activeClassId);
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
    // Ein Downgrade kann eine aktuell ausgewaehlte Waffe/Utility/Ultimate wieder sperren.
    this.ctx.leftPanel.refreshColorIndicator();
    return true;
  }

  private categoryRespecCoopDefenseUpgrades(categoryId: CoopDefenseUpgradeCategoryId): boolean {
    const stored = getStoredCoopDefenseProgress();
    const activeClassId = stored.classesUnlocked
      ? stored.selectedClassId
      : DEFAULT_COOP_DEFENSE_CLASS_ID;
    const activeProfile = stored.classesUnlocked
      ? stored.profilesByClass[stored.selectedClassId]
      : stored.defaultProfile;
    const nextProfile = respecCoopDefenseUpgradeCategory(activeProfile, categoryId, activeClassId);
    if (!nextProfile) return false;

    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    setStoredCoopDefenseUpgradeProfile(nextProfile, activeClassId);
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
    this.ctx.leftPanel.refreshColorIndicator();
    return true;
  }

  private classRespecCoopDefenseUpgrades(): boolean {
    const stored = getStoredCoopDefenseProgress();
    if (!stored.classesUnlocked) return false;

    const activeClassId = stored.selectedClassId;
    const activeProfile = stored.profilesByClass[activeClassId];
    if (
      getSpentCoopDefenseUpgradePoints(activeProfile, activeClassId) <= 0
      && getSpentCoopDefenseBossPoints(activeProfile, activeClassId) <= 0
    ) return false;

    const nextProfile = buildDefaultCoopDefenseUpgradeProfile(activeClassId);
    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    setStoredCoopDefenseUpgradeProfile(nextProfile, activeClassId);
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
    this.ctx.leftPanel.refreshColorIndicator();
    return true;
  }

  private canFullRespecCoopDefenseUpgrades(): boolean {
    const stored = getStoredCoopDefenseProgress();
    if (!stored.classesUnlocked) {
      return getSpentCoopDefenseUpgradePoints(stored.defaultProfile, DEFAULT_COOP_DEFENSE_CLASS_ID) > 0
        || getSpentCoopDefenseBossPoints(stored.defaultProfile, DEFAULT_COOP_DEFENSE_CLASS_ID) > 0;
    }

    return COOP_DEFENSE_CLASS_IDS.some((classId) => {
      const profile = stored.profilesByClass[classId];
      return getSpentCoopDefenseUpgradePoints(profile, classId) > 0
        || getSpentCoopDefenseBossPoints(profile, classId) > 0;
    });
  }

  private fullRespecCoopDefenseUpgrades(): boolean {
    if (!this.canFullRespecCoopDefenseUpgrades()) return false;

    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    resetStoredCoopDefenseUpgradeProfiles();
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
    // Nach Full Respec sind alle Loadout-Unlocks zurueckgesetzt; Auswahl neu abgleichen.
    this.ctx.leftPanel.refreshColorIndicator();
    return true;
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

    if (bridge.isArenaLoading()) {
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

  private getArenaLoadingScreenState(): ArenaLoadingScreenState {
    const participation = bridge.getRoundParticipation();
    const descriptor = bridge.getArenaDescriptor();
    const spectatorIds = new Set(participation?.spectatorIds ?? []);
    const participantIds = new Set(participation?.participantIds ?? []);
    const players = bridge.getConnectedPlayers()
      .filter((profile) => participantIds.has(profile.id) && !spectatorIds.has(profile.id))
      .map((profile) => {
        const state = bridge.getPlayerArenaLoadState(
          profile.id,
          participation?.roundRevision ?? descriptor?.roundRevision ?? 0,
        ) ?? {
          roundRevision: participation?.roundRevision ?? descriptor?.roundRevision ?? 0,
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
    const mapLabel = descriptor?.mapId
      ? getMapName(descriptor.mapId, getLocale())
      : modeLabel;
    return { mapLabel, modeLabel, players };
  }

  private syncCountdownPlayerPresentation(): void {
    const localId = bridge.getLocalPlayerId();
    for (const player of this.ctx.playerManager.getAllPlayers()) {
      player.setHeldItemId(bridge.getPlayerHeldItemId(player.id));
      const input = bridge.getPlayerInput(player.id);
      const aim = player.id === localId
        ? this.ctx.inputSystem.getAimAngle()
        : input ? dequantizeAngle(input.aim) : player.getAimAngle();
      player.setRotation(aim);
    }
  }

  private getLocalPlacementPreview() {
    const sprite = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
    const cfg = this.clientUpdate.getLocalUtilityConfig();
    if (!sprite || !this.ctx.placementSystem || !this.ctx.inputSystem.isUtilityPlacementActive()) return undefined;
    if (cfg.activation.type !== 'placement_mode') return undefined;
    const pointer = this.getPointerWorldPoint();
    return this.ctx.placementSystem.getPlacementPreview(cfg as PlaceableUtilityConfig, sprite.x, sprite.y, pointer.x, pointer.y);
  }

  private getLocalUltimatePlacementPreview() {
    const sprite = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
    const cfg = this.clientUpdate.getLocalUltimateConfig();
    if (!sprite || !this.ctx.placementSystem || !this.ctx.inputSystem.isUltimatePlacementActive()) return undefined;
    if (cfg.type !== 'tunnel') return undefined;
    const pointer = this.getPointerWorldPoint();
    return this.ctx.placementSystem.getTunnelPlacementPreview(
      cfg,
      sprite.x,
      sprite.y,
      pointer.x,
      pointer.y,
      this.ctx.inputSystem.getUltimatePlacementAnchor(),
    );
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
    const storedProgress = getStoredCoopDefenseProgress();
    const classId = isCoopDefenseMode(bridge.getGameMode()) && storedProgress.classesUnlocked
      ? storedProgress.selectedClassId
      : null;
    const profile = classId ? storedProgress.profilesByClass[classId] : null;
    return {
      coopDefenseClassId: classId,
      tools: classId === 'inspector_gadachs'
        ? (profile?.toolLoadout ?? []).map((tool) => ({ ...tool }))
        : [],
    };
  }

  private buildLocalCommittedLoadoutSnapshot(): LoadoutCommitSnapshot {
    const localId = bridge.getLocalPlayerId();
    const storedProgress = getStoredCoopDefenseProgress();
    const coopDefenseClassId = storedProgress.classesUnlocked
      ? storedProgress.selectedClassId
      : null;
    const coopDefenseProfile = storedProgress.classesUnlocked
      ? storedProgress.profilesByClass[storedProgress.selectedClassId]
      : storedProgress.defaultProfile;
    // Ausruestung wird hier eingefroren: ab "Bereit" gilt sie fuer das gesamte Match.
    const equippedItems = isCoopDefenseMode(bridge.getGameMode())
      ? getEquippedCoopDefenseItems(storedProgress.items, storedProgress.equippedItemIds)
      : [];
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
    }, bridge.getGameMode(), coopDefenseProfile, coopDefenseClassId);
    return equippedItems.length > 0 ? { ...committed, equippedItems } : committed;
  }

  private getEnemyHoverNameTarget(): { name: string; x: number; y: number } | null {
    const pointer = this.getPointerWorldPoint();
    const localId = bridge.getLocalPlayerId();
    let nearest: { name: string; x: number; y: number; distanceSq: number } | null = null;

    for (const player of this.ctx.playerManager.getAllPlayers()) {
      if (player.id === localId) continue;

      const sprite = player.sprite;
      if (!sprite.active || !sprite.visible) continue;

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

  private registerArenaPanelHotkeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    this.arenaPanelTabKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB, true);
    // K bleibt fuer den optionalen Debug-Schaden abfragbar, darf aber kein DOM-Textfeld
    // blockieren, weil der Buchstabe auch in Spielernamen verwendet wird.
    this.coopDefenseDebugDamageKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K, false);
    if (this.optionsHotkeyHandler) {
      keyboard.off('keydown-O', this.optionsHotkeyHandler);
      this.optionsHotkeyHandler = null;
    }

    this.optionsHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat || !this.ctx) return;

      const phase = bridge.getGamePhase();
      if ((phase !== 'LOBBY' && phase !== 'ARENA') || this.lifecycle.isMatchTerminated()) return;
      if (this.ctx.leftPanel.isHotkeyInputBlocked()) return;
      if (this.ctx.leftPanel.isHelpOverlayOpen()) return;
      if (this.coopDefenseUpgradesOverlay?.isOpen()) return;
      if (this.coopDefenseXpDebugOverlay?.isOpen()) return;

      this.ctx.leftPanel.toggleOptionsOverlay();
    };

    keyboard.on('keydown-O', this.optionsHotkeyHandler);
    if (this.coopDefenseXpDebugHotkeyHandler) {
      keyboard.off('keydown-L', this.coopDefenseXpDebugHotkeyHandler);
      this.coopDefenseXpDebugHotkeyHandler = null;
    }

    this.coopDefenseXpDebugHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat || !this.ctx) return;

      const phase = bridge.getGamePhase();
      if (phase !== 'LOBBY' || this.lifecycle.isMatchTerminated()) return;
      if (!isCoopDefenseMode(bridge.getGameMode())) return;
      if (this.ctx.leftPanel.isHotkeyInputBlocked()) return;
      if (this.ctx.leftPanel.isHelpOverlayOpen()) return;
      if (this.ctx.leftPanel.isOptionsOverlayOpen()) return;
      if (this.coopDefenseUpgradesOverlay?.isOpen()) return;

      this.coopDefenseXpDebugOverlay?.toggle();
    };

    keyboard.on('keydown-L', this.coopDefenseXpDebugHotkeyHandler);

    if (this.netDebugHotkeyHandler) {
      keyboard.off('keydown-P', this.netDebugHotkeyHandler);
      this.netDebugHotkeyHandler = null;
    }
    // Transportdiagnose ist in jeder Phase erreichbar – gerade wenn etwas klemmt.
    this.netDebugHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat || !this.ctx) return;
      if (this.ctx.leftPanel.isHotkeyInputBlocked()) return;
      this.netDebugOverlay?.toggle();
    };
    keyboard.on('keydown-P', this.netDebugHotkeyHandler);

    if (this.performanceHotkeyHandler) {
      keyboard.off('keydown-T', this.performanceHotkeyHandler);
      this.performanceHotkeyHandler = null;
    }
    this.performanceHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      // T ist ein Schreibzeichen: nicht auslösen, während ein Textfeld den Fokus hat.
      if (this.ctx?.leftPanel.isHotkeyInputBlocked()) return;
      this.performanceDiagnosticsOverlay?.toggle();
    };
    keyboard.on('keydown-T', this.performanceHotkeyHandler);

    if (this.timeOfDayHotkeyHandler) {
      keyboard.off('keydown-M', this.timeOfDayHotkeyHandler);
      this.timeOfDayHotkeyHandler = null;
    }
    this.timeOfDayHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      // M ist ein Schreibzeichen: nicht auslösen, während ein Textfeld den Fokus hat.
      if (this.ctx?.leftPanel.isHotkeyInputBlocked()) return;
      this.timeOfDayDebugOverlay?.toggle();
    };
    keyboard.on('keydown-M', this.timeOfDayHotkeyHandler);

    this.events.once('shutdown', () => {
      if (this.timeOfDayHotkeyHandler) {
        keyboard.off('keydown-M', this.timeOfDayHotkeyHandler);
        this.timeOfDayHotkeyHandler = null;
      }
      this.timeOfDayDebugOverlay?.destroy();
      this.timeOfDayDebugOverlay = null;
      if (this.netDebugHotkeyHandler) {
        keyboard.off('keydown-P', this.netDebugHotkeyHandler);
        this.netDebugHotkeyHandler = null;
      }
      if (this.performanceHotkeyHandler) {
        keyboard.off('keydown-T', this.performanceHotkeyHandler);
        this.performanceHotkeyHandler = null;
      }
      if (this.optionsHotkeyHandler) {
        keyboard.off('keydown-O', this.optionsHotkeyHandler);
        this.optionsHotkeyHandler = null;
      }
      if (this.coopDefenseXpDebugHotkeyHandler) {
        keyboard.off('keydown-L', this.coopDefenseXpDebugHotkeyHandler);
        this.coopDefenseXpDebugHotkeyHandler = null;
      }
      this.coopDefenseXpDebugOverlay?.destroy();
      this.coopDefenseXpDebugOverlay = null;
      this.coopDefenseUpgradesOverlay?.destroy();
      this.coopDefenseUpgradesOverlay = null;
      this.hostileBaseIndicator?.destroy();
      this.hostileBaseIndicator = null;
      this.secondaryObjectiveHud?.destroy();
      this.secondaryObjectiveHud = null;
      this.mapEventAnnouncementPresenter?.reset();
      this.mapEventAnnouncementPresenter = null;
      this.objectiveAnnouncements?.destroy();
      this.objectiveAnnouncements = null;
      this.removeReconnectStatusListener?.();
      this.removeReconnectStatusListener = null;
      this.renderers?.secondaryObjectiveMarkers.destroy();
      this.renderers?.carryZones.clear();
      this.renderers?.objectiveRepairDrones.destroy();
    });
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
    this.lifecycle.setTimeOfDayDebugOverride(minutes);
    this.syncDebugTimeOfDay(settled);
  }

  private clearDebugTimeOfDay(): void {
    this.lifecycle.clearTimeOfDayDebugOverride();
    this.syncDebugTimeOfDay(true);
  }

  private syncDebugTimeOfDay(forceStaticBake: boolean): void {
    const now = bridge.getSynchronizedNow();
    this.lifecycle.syncRuntimeTimeOfDay(now, this.resolveArenaTimeOfDaySignals());
    this.renderers.shadow.syncStaticProfile(now, forceStaticBake);
  }

  private resolveArenaTimeOfDaySignals(): {
    bossSpawnedAtMs: number | null;
    bossPhase: number;
  } {
    const observedPhase = this.ctx.enemyManager?.getMaxBossPhase() ?? 0;
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

  private syncArenaPanelOverlayState(inArena = bridge.getGamePhase() === 'ARENA' && !this.lifecycle?.isMatchTerminated()): void {
    if (!this.ctx) return;
    const shouldShow = inArena && this.arenaPanelsHeld;
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

  private syncArenaMetrics(phase = bridge.getGamePhase()): void {
    applyArenaMetricsForMode(
      bridge.getGameMode(),
      phase,
      this.resolveCoopDefenseArenaWidthCells(phase),
      this.resolveCoopDefenseArenaHeightCells(phase),
    );
    this.arenaBuilder?.syncStaticBackdrop(bridge.getGameMode(), phase);
    this.syncArenaClipMask();
    this.physics.world.setBounds(ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT);
    this.syncMainCameraBounds();
    this.ctx?.combatSystem.syncArenaBounds();
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
   * Setzt die Kamera auf ihre **unversetzte** Basisposition. Der visuelle Versatz des
   * Kamera-Feedbacks kommt erst am Frame-Ende über `applyCameraFeedback()` dazu.
   *
   * Die Verfolgung lerpt bewusst aus `lastCameraScrollX` und nicht aus `camera.scrollX`: Zu
   * Beginn eines Frames trägt die Kamera noch den Versatz des Vorframes, und ein Rücklesen
   * würde das Rumpeln in die Verfolgung zurückkoppeln und die Kamera abdriften lassen.
   */
  private syncMainCamera(delta: number, inArena: boolean): void {
    const camera = this.cameras.main;

    const spectator = inArena && (this.localPlayerState.spectator || bridge.isLocalSpectator());
    const arenaWidth = Math.max(0, ARENA_MAX_X - ARENA_OFFSET_X);
    const arenaHeight = Math.max(0, ARENA_MAX_Y - ARENA_OFFSET_Y);
    const canSpectatorPanX = arenaWidth > ARENA_VIEWPORT_WIDTH;
    const canSpectatorPanY = arenaHeight > ARENA_VIEWPORT_HEIGHT;
    const canSpectatorPan = canSpectatorPanX || canSpectatorPanY;
    if (!inArena || (!ACTIVE_ARENA_METRICS_PROFILE.usesDynamicCamera && !(spectator && canSpectatorPan))) {
      this.lastCameraScrollX = 0;
      this.lastCameraScrollY = 0;
      this.spectatorCameraScrollX = 0;
      this.spectatorCameraScrollY = 0;
      camera.scrollX = 0;
      camera.scrollY = 0;
      setCameraBaseScroll(this, 0, 0);
      return;
    }

    if (spectator) {
      this.spectatorCameraScrollX = advanceSpectatorCameraScroll({
        currentScrollX: this.spectatorCameraScrollX,
        deltaMs: delta,
        moveLeft: this.spectatorCameraLeftKey?.isDown === true,
        moveRight: this.spectatorCameraRightKey?.isDown === true,
        arenaWidth,
        viewportWidth: ARENA_VIEWPORT_WIDTH,
      });
      this.spectatorCameraScrollY = advanceSpectatorCameraScroll({
        currentScrollX: this.spectatorCameraScrollY,
        deltaMs: delta,
        moveLeft: this.spectatorCameraUpKey?.isDown === true,
        moveRight: this.spectatorCameraDownKey?.isDown === true,
        arenaWidth: arenaHeight,
        viewportWidth: ARENA_VIEWPORT_HEIGHT,
      });
      this.lastCameraScrollX = this.spectatorCameraScrollX;
      this.lastCameraScrollY = this.spectatorCameraScrollY;
      camera.scrollX = this.spectatorCameraScrollX;
      camera.scrollY = this.spectatorCameraScrollY;
      setCameraBaseScroll(this, this.spectatorCameraScrollX, this.spectatorCameraScrollY);
      return;
    }

    const localSprite = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
    const preparedStartFocus = bridge.isArenaLoading() || bridge.isArenaCountdownActive();
    if (!localSprite?.active || (!this.localPlayerState.alive && !preparedStartFocus)) {
      camera.scrollX = this.lastCameraScrollX;
      camera.scrollY = this.lastCameraScrollY;
      setCameraBaseScroll(this, this.lastCameraScrollX, this.lastCameraScrollY);
      return;
    }

    const maxScrollX = Math.max(0, ARENA_MAX_X - (ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH));
    const maxScrollY = Math.max(0, ARENA_MAX_Y - (ARENA_OFFSET_Y + ARENA_VIEWPORT_HEIGHT));
    const focusScreenX = ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH * 0.5;
    const focusScreenY = ARENA_OFFSET_Y + ARENA_VIEWPORT_HEIGHT * 0.5;
    const targetScrollX = Phaser.Math.Clamp(localSprite.x - focusScreenX, 0, maxScrollX);
    const targetScrollY = Phaser.Math.Clamp(localSprite.y - focusScreenY, 0, maxScrollY);
    // The first local spawn is already known during loading; snap once so the startup working
    // set is not invalidated by a camera glide while the barrier is being evaluated.
    const followLerp = bridge.isArenaLoading() ? 1 : 1 - Math.exp(-delta / 120);
    this.lastCameraScrollX = Phaser.Math.Linear(this.lastCameraScrollX, targetScrollX, followLerp);
    this.lastCameraScrollY = Phaser.Math.Linear(this.lastCameraScrollY, targetScrollY, followLerp);
    camera.scrollX = this.lastCameraScrollX;
    camera.scrollY = this.lastCameraScrollY;
    setCameraBaseScroll(this, this.lastCameraScrollX, this.lastCameraScrollY);
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
        && !this.arenaExitFadeComplete
      );
    const mapId = bridge.getRoundState()?.coopDefenseMapId ?? bridge.getCoopDefenseMapId();
    const localId = bridge.getLocalPlayerId();
    const localPlayer = this.ctx?.playerManager.getPlayer(localId);
    // Tot oder zuschauend gilt als unverletzt: die Gesundheitsdarstellung gehört zum eigenen
    // Körper. Ohne diesen Vorbehalt bliebe der Bildschirm nach dem Tod bis zum Respawn – in
    // Coop-Defense bis zum Wellenende – dauerhaft entsättigt und blutig.
    const localWounded = inArena
      && !this.localPlayerState.spectator
      && !bridge.isLocalSpectator()
      && (this.ctx?.combatSystem.isAlive(localId) ?? false);

    return {
      skyState: resolveSkyState(minutes),
      isVoidMap: inArena && getCoopDefenseMapConfig(mapId).trackMode === 'void-fire',
      bossVisualProfile: inArena && mapId === '15' ? 'void-hunter' : undefined,
      bossPhase: inArena ? (this.ctx?.enemyManager?.getMaxBossPhase() ?? 0) : 0,
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
    if (!isCoopDefenseMode(bridge.getGameMode())) return undefined;
    const mapId = phase === 'ARENA'
      ? (bridge.getRoundState()?.coopDefenseMapId ?? bridge.getCoopDefenseMapId())
      : bridge.getCoopDefenseMapId();
    return getCoopDefenseMapConfig(mapId).arenaWidthCells;
  }

  private resolveCoopDefenseArenaHeightCells(phase = bridge.getGamePhase()): number | undefined {
    if (!isCoopDefenseMode(bridge.getGameMode())) return undefined;
    const mapId = phase === 'ARENA'
      ? (bridge.getRoundState()?.coopDefenseMapId ?? bridge.getCoopDefenseMapId())
      : bridge.getCoopDefenseMapId();
    return getCoopDefenseMapConfig(mapId).arenaHeightCells;
  }

  private getPointerWorldPoint(): Phaser.Math.Vector2 {
    const pointer = this.input.activePointer;
    return getUnshakenPointerWorldPoint(this, pointer);
  }

  /**
   * Aktueller Zugzustand für Schatten und Licht. Bevorzugt den interpolierten Stand des
   * Renderers, damit beide nicht am Netz-Tick kleben.
   */
  private resolveTrainState(): SyncedTrainState | null {
    return this.renderers.train?.getShadowState()
      ?? (bridge.isHost()
        ? (this.ctx.trainManager?.getNetSnapshot() ?? null)
        : (bridge.getLatestGameState()?.train ?? null));
  }

  private syncWorldShadows(inArena: boolean, trainState: SyncedTrainState | null): void {
    if (!inArena || !this.ctx.currentLayout || !this.ctx.arenaResult) {
      this.forceStaticTimeOfDayBake = false;
      this.renderers.shadow.clear();
      return;
    }

    this.renderers.shadow.syncStaticProfile(
      bridge.getSynchronizedNow(),
      this.forceStaticTimeOfDayBake,
    );
    this.forceStaticTimeOfDayBake = false;

    this.renderers.shadow.syncDynamicShadows(
      this.ctx.playerManager.getAllPlayers(),
      this.ctx.projectileManager.getShadowSamples(),
      trainState,
    );
  }

  /**
   * Dynamische Beleuchtung. Die Lichtquellen selbst melden sich in ihren eigenen
   * Renderern an (Mündungsfeuer, Explosionen, Feuer); hier hängen nur die Lichter, die
   * an einem bewegten Träger sitzen – Taschenlampen und Zugscheinwerfer – sowie die
   * Komposition der Lightmap.
   */
  private syncWorldLighting(inArena: boolean, trainState: SyncedTrainState | null): void {
    const lighting = this.renderers.lighting;
    const artificialFactor = inArena ? lighting.getArtificialLightFactor() : 0;
    const artificialLights = artificialFactor > 0;
    const liveTrainSegments = trainState?.alive && bridge.isHost() && this.ctx.trainManager?.isActive()
      ? this.ctx.trainManager.getSegObjects()
      : null;
    this.trainLightOccluders.setTrain(liveTrainSegments, trainState);

    this.syncTrainLights(artificialLights, artificialFactor, trainState);

    if (artificialLights) {
      for (const player of this.ctx.playerManager.getAllPlayers()) {
        const key = `flashlight:${player.id}`;
        const sprite = player.sprite;
        const burrowPhase = player.getBurrowPhase();
        // Exakt dieselben Sichtbarkeitsbedingungen wie beim dynamischen Schatten: wer
        // nicht sichtbar auf dem Feld steht, leuchtet auch nicht.
        //
        // Bewusst kein `combatSystem.isAlive()`: dessen Zustand entsteht in
        // `initPlayer()` und das läuft nur auf dem Host, auf Clients wäre also jeder
        // Spieler tot und keine Taschenlampe sichtbar. Der Lebendzustand steckt ohnehin
        // schon in `sprite.visible` – beide Seiten setzen ihn beim Tod (siehe
        // HostUpdateCoordinator und ClientUpdateCoordinator).
        const visible = sprite.active
          && sprite.visible
          && !player.isDecoyStealthedVisual()
          && burrowPhase !== 'underground'
          && burrowPhase !== 'trapped';

        const spillKey = `flashlightspill:${player.id}`;
        if (!visible) {
          lighting.releaseLight(key);
          lighting.releaseLight(spillKey);
          continue;
        }
        lighting.setLight(key, 'flashlight', sprite.x, sprite.y, {
          angle: player.getAimAngle(),
          intensity: LIGHT_PRESETS.flashlight.intensity * artificialFactor,
        });
        // Nimmt dem Kegelansatz die harte Kante an der Spielerlinie.
        lighting.setLight(spillKey, 'flashlightSpill', sprite.x, sprite.y, {
          intensity: LIGHT_PRESETS.flashlightSpill.intensity * artificialFactor,
        });
      }
      this.flashlightsActive = true;
    } else if (this.flashlightsActive) {
      // Ausdrückliche Freigabe statt Verlass auf das Stale-Notnetz: das blendet über
      // `RELEASE_FADE_MS` aus, während der Stale-Pfad die Lampen 400 ms stehen lässt und
      // dann hart abschaltet. Wird sichtbar, sobald der Debug-Regler in den Tag zieht.
      for (const player of this.ctx.playerManager.getAllPlayers()) {
        lighting.releaseLight(`flashlight:${player.id}`);
        lighting.releaseLight(`flashlightspill:${player.id}`);
      }
      this.flashlightsActive = false;
    }

    this.syncProjectileLights(inArena);
    this.rockVisualHelper.syncTurretLights(inArena);

    if (inArena) this.ctx.baseManager?.syncLights();
    else this.ctx.baseManager?.releaseLights();

    lighting.update();
  }

  /**
   * Eigenleuchten der Projektile.
   *
   * Bewusst ein zentraler Pass statt einer Anmeldung in jedem der zwölf
   * Projektil-Renderer: `ProjectileManager.getLightSamples()` deckt Host und Client aus
   * einer Methode ab – genau wie `getShadowSamples()` beim dynamischen Schatten – und die
   * Zuordnung Stil → Licht bleibt an einer Stelle steuerbar.
   *
   * Der Brand eines Projektils ist davon unabhängig: `ProjectileBurnRenderer` meldet ihn
   * unter einem eigenen Key an, ein brennendes Geschoss trägt also beide Lichter.
   */
  private syncProjectileLights(inArena: boolean): void {
    const lighting = this.renderers.lighting;
    const active = this.activeProjectileLightIds;

    if (!inArena) {
      for (const id of active) lighting.releaseLight(`proj:${id}`);
      active.clear();
      return;
    }

    const seen = this.projectileLightScratch;
    seen.clear();

    for (const sample of this.ctx.projectileManager.getLightSamples()) {
      const spec = getProjectileLightSpec(
        sample.style,
        sample.energyBallVariant,
        sample.grenadeVisualPreset,
        sample.color,
      );
      if (!spec) continue;

      lighting.setLight(`proj:${sample.id}`, spec.preset, sample.x, sample.y, {
        radiusPx: spec.baseRadiusPx + sample.size * spec.radiusPerSizePx,
        color: spec.whitenFromColor === undefined
          ? undefined
          : mixColors(sample.color, 0xffffff, spec.whitenFromColor),
      });
      seen.add(sample.id);
    }

    // Freigabe statt Verlass auf das Stale-Notnetz: das blendet sauber aus, statt das
    // Licht eines längst zerstörten Projektils noch 400 ms stehen zu lassen.
    for (const id of active) {
      if (!seen.has(id)) lighting.releaseLight(`proj:${id}`);
    }

    this.activeProjectileLightIds = seen;
    this.projectileLightScratch = active;
  }

  /**
   * Zugbeleuchtung: zwei Frontscheinwerfer an der Lok, dazu Fensterlichter an beiden
   * Seiten jedes Waggons.
   *
   * Der Zug fährt entlang Y: `dir = 1` bedeutet nach Süden, `dir = -1` nach Norden
   * (`TrainManager` addiert `direction * SPEED` auf `locoY`). Die Lok ist dabei immer
   * das führende Segment, die Nase liegt also eine halbe Loklänge in Fahrtrichtung vor
   * ihrem Mittelpunkt. Die Segmentmitten kommen aus `TrainRenderer.computeSegYs()` –
   * dieselbe Rechnung, aus der auch die Zuggrafik entsteht.
   */
  private syncTrainLights(
    artificialLights: boolean,
    artificialFactor: number,
    trainState: SyncedTrainState | null,
  ): void {
    const lighting = this.renderers.lighting;
    const trainRenderer = this.renderers.train;
    const train = artificialLights ? trainState : null;

    if (!train?.alive || !trainRenderer) {
      if (this.trainLightsActive) {
        const plan = this.getTrainLightPlan();
        for (const lamp of plan.headlights) lighting.releaseLight(lamp.key);
        for (const lamp of plan.windows) lighting.releaseLight(lamp.key);
        this.trainLightsActive = false;
      }
      return;
    }

    const segmentYs = trainRenderer.computeSegYs(train.y, train.dir);
    const beamAngle = train.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
    const noseY = segmentYs[0] + train.dir * TRAIN.HEADLIGHT_OFFSET_Y;
    const plan = this.getTrainLightPlan();

    for (const lamp of plan.headlights) {
      lighting.setLight(lamp.key, 'trainHeadlight', train.x + lamp.offsetX, noseY, {
        angle: beamAngle,
        intensity: LIGHT_PRESETS.trainHeadlight.intensity * artificialFactor,
      });
    }
    for (const lamp of plan.windows) {
      // Waggons hinter dem sichtbaren Bereich fallen in `LightingSystem` durch das
      // Screen-Culling; hier bleibt es bei einem Upsert ohne Allokation.
      const offsetY = lamp.frontRelative ? train.dir * lamp.offsetY : lamp.offsetY;
      lighting.setLight(
        lamp.key,
        'trainWindow',
        train.x + lamp.offsetX,
        segmentYs[lamp.segment] + offsetY,
        { intensity: LIGHT_PRESETS.trainWindow.intensity * artificialFactor },
      );
    }

    this.trainLightsActive = true;
  }

  /**
   * Feste Lampenanordnung des Zugs, einmalig aufgebaut. Die Menge ist konstant, die
   * Keys dürfen deshalb nicht pro Frame neu zusammengesetzt werden.
   */
  private getTrainLightPlan(): TrainLightPlan {
    if (this.trainLightPlan) return this.trainLightPlan;

    const headlights: TrainLamp[] = [];
    const windows: TrainLamp[] = [];

    for (const side of ArenaScene.TRAIN_LIGHT_SIDES) {
      headlights.push({
        key: `trainheadlight:${side}`,
        offsetX: side * TRAIN.HEADLIGHT_OFFSET_X,
        offsetY: 0,
        segment: 0,
      });
      // Zwei Kabinenfenster an den Seiten der Lok, vorne wie beim Vorbild – leuchten wie
      // die Waggonfenster (dasselbe `trainWindow`-Preset), sitzen aber am führenden Ende.
      windows.push({
        key: `trainlocowindow:${side}`,
        offsetX: side * TRAIN.LOCO_WINDOW_LIGHT_OFFSET_X,
        offsetY: TRAIN.LOCO_WINDOW_LIGHT_OFFSET_Y,
        segment: 0,
        frontRelative: true,
      });
      for (let wagon = 1; wagon <= TRAIN.WAGON_COUNT; wagon += 1) {
        for (let slot = 0; slot < TRAIN.WINDOW_LIGHT_OFFSETS_Y.length; slot += 1) {
          windows.push({
            key: `trainwindow:${wagon}:${side}:${slot}`,
            offsetX: side * TRAIN.WINDOW_LIGHT_OFFSET_X,
            offsetY: TRAIN.WINDOW_LIGHT_OFFSETS_Y[slot],
            segment: wagon,
          });
        }
      }
    }

    this.trainLightPlan = { headlights, windows };
    return this.trainLightPlan;
  }

  private describeSceneObjectBreakdown(): string {
    const counts = new Map<string, number>();
    let visibleCount = 0;
    let activeCount = 0;

    forEachSceneDisplayObject(this, (child) => {
      const gameObject = child as Phaser.GameObjects.GameObject & {
        visible?: boolean;
        active?: boolean;
        type?: string;
        texture?: { key?: string };
      };

      if (gameObject.visible !== false) visibleCount += 1;
      if (gameObject.active !== false) activeCount += 1;

      const baseType = gameObject.type || gameObject.constructor.name || 'Unknown';
      const textureKey = typeof gameObject.texture?.key === 'string' && gameObject.texture.key.length > 0
        ? gameObject.texture.key
        : null;
      const label = textureKey ? `${baseType}:${textureKey}` : baseType;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });

    const topEntries = [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([label, count]) => `${label}:${count}`)
      .join(', ');

    return `visible=${visibleCount} active=${activeCount} top=${topEntries}`;
  }

  /** Explicit one-shot inspection; never called by the normal Companion sampling path. */
  private captureSceneInspection(): void {
    const typeCounts: Record<string, number> = {};
    let directLayerChildren = 0;
    let visible = 0;
    let active = 0;
    for (const child of this.children.list) {
      const displayChild = child as Phaser.GameObjects.GameObject & { visible?: boolean; active?: boolean };
      typeCounts[child.type] = (typeCounts[child.type] ?? 0) + 1;
      if (displayChild.visible) visible += 1;
      if (displayChild.active) active += 1;
      const nested = child as Phaser.GameObjects.GameObject & {
        type?: string;
        list?: Phaser.GameObjects.GameObject[];
      };
      if (nested.type !== 'Layer' || !Array.isArray(nested.list)) continue;
      directLayerChildren += nested.list.length;
      for (const grandChild of nested.list) {
        const displayGrandChild = grandChild as Phaser.GameObjects.GameObject & { visible?: boolean; active?: boolean };
        typeCounts[grandChild.type] = (typeCounts[grandChild.type] ?? 0) + 1;
        if (displayGrandChild.visible) visible += 1;
        if (displayGrandChild.active) active += 1;
      }
    }
    this.runtimeProfiler?.setSceneInspection({
      capturedAtIso: new Date().toISOString(),
      topLevelChildren: this.children.list.length,
      directLayerChildren,
      totalFlatChildren: this.children.list.length + directLayerChildren,
      visible,
      active,
      typeCounts,
      boundsIncluded: false,
    });
  }

  private sampleScenePerformanceCounts(
    nowMs: number,
    enabled: boolean,
  ): typeof this.scenePerformanceCounts {
    if (!enabled) return { ...this.scenePerformanceCounts, scanMs: 0 };
    if (nowMs - this.lastScenePerformanceCountAtMs < 250) {
      return { ...this.scenePerformanceCounts, scanMs: 0 };
    }

    const scanStartedAt = performance.now();
    let visibleObjectCount = 0;
    let willRenderObjectCount = 0;
    let inCameraBoundsObjectCount = 0;
    let hiddenObjectCount = 0;
    let particleEmitterCount = 0;
    let aliveParticleCount = 0;
    let activeFilterCount = 0;
    let internalFilterCount = 0;
    let externalFilterCount = 0;
    let filteredObjectCount = 0;
    const filterTypes = new Map<string, number>();
    const camera = this.cameras.main;
    forEachSceneDisplayObject(this, (child) => {
      const gameObject = child as Phaser.GameObjects.GameObject & {
        visible?: boolean;
        type?: string;
        willRender?: (camera: Phaser.Cameras.Scene2D.Camera) => boolean;
        getBounds?: () => Phaser.Geom.Rectangle;
        getAliveParticleCount?: () => number;
        filters?: {
          internal?: { getActive?: () => unknown[] };
          external?: { getActive?: () => unknown[] };
        };
      };
      if (gameObject.visible !== false) visibleObjectCount += 1;
      else hiddenObjectCount += 1;
      if (gameObject.willRender?.(camera) ?? gameObject.visible !== false) willRenderObjectCount += 1;
      if (gameObject.getBounds) {
        try {
          if (Phaser.Geom.Intersects.RectangleToRectangle(gameObject.getBounds(), camera.worldView)) {
            inCameraBoundsObjectCount += 1;
          }
        } catch {
          // Einzelne Spezialobjekte koennen waehrend ihres Abbaus keine Bounds mehr liefern.
        }
      }
      if (gameObject.type === 'ParticleEmitter' || gameObject.getAliveParticleCount) {
        particleEmitterCount += 1;
        aliveParticleCount += gameObject.getAliveParticleCount?.() ?? 0;
      }
      const internal = gameObject.filters?.internal?.getActive?.() ?? [];
      const external = gameObject.filters?.external?.getActive?.() ?? [];
      internalFilterCount += internal.length;
      externalFilterCount += external.length;
      if (internal.length + external.length > 0) filteredObjectCount += 1;
      for (const filter of [...internal, ...external]) {
        const typedFilter = filter as { type?: string; constructor?: { name?: string } };
        const label = typedFilter.type ?? typedFilter.constructor?.name ?? 'UnknownFilter';
        filterTypes.set(label, (filterTypes.get(label) ?? 0) + 1);
      }
    });
    const cameraFilters = (camera as typeof camera & {
      filters?: {
        internal?: { getActive?: () => unknown[] };
        external?: { getActive?: () => unknown[] };
      };
    }).filters;
    const cameraFilterCount = (cameraFilters?.internal?.getActive?.().length ?? 0)
      + (cameraFilters?.external?.getActive?.().length ?? 0);
    activeFilterCount = internalFilterCount + externalFilterCount + cameraFilterCount;
    const filterBreakdown = filterTypes.size > 0
      ? [...filterTypes.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([name, count]) => `${name}:${count}`)
        .join(', ')
      : null;

    this.scenePerformanceCounts = {
      visibleObjectCount,
      willRenderObjectCount,
      inCameraBoundsObjectCount,
      hiddenObjectCount,
      particleEmitterCount,
      aliveParticleCount,
      activeFilterCount,
      internalFilterCount,
      externalFilterCount,
      filteredObjectCount,
      cameraFilterCount,
      scanMs: performance.now() - scanStartedAt,
      filterBreakdown,
    };
    this.lastScenePerformanceCountAtMs = nowMs;
    return this.scenePerformanceCounts;
  }

  private sampleTransportPerformanceCounts(nowMs: number): TransportPerformanceCounts {
    if (nowMs - this.lastTransportPerformanceSampleAtMs < 500) {
      return { ...this.transportPerformanceCounts, sampleMs: 0 };
    }

    const startedAt = performance.now();
    const links = bridge.getTransportDiagnostics();
    const bytesSent = links.reduce((sum, link) => sum + link.bytesSent, 0);
    const bytesReceived = links.reduce((sum, link) => sum + link.bytesReceived, 0);
    const elapsedMs = nowMs - this.lastTransportByteSampleAtMs;
    const canComputeRate = Number.isFinite(elapsedMs) && elapsedMs > 0;
    const measuredRtts = links
      .map(link => link.medianRttMs)
      .filter((value): value is number => value !== null);
    const measuredAppPings = links
      .map(link => link.medianAppPingMs)
      .filter((value): value is number => value !== null);

    this.lastTransportPerformanceSampleAtMs = nowMs;
    this.lastTransportByteSampleAtMs = nowMs;
    this.transportPerformanceCounts = {
      linkCount: links.length,
      backpressureLinkCount: links.filter(link => link.backpressure).length,
      reliableBufferedBytes: links.reduce((sum, link) => sum + link.reliableBufferedBytes, 0),
      fastBufferedBytes: links.reduce((sum, link) => sum + link.fastBufferedBytes, 0),
      droppedFastMessages: links.reduce((sum, link) => sum + link.droppedFastMessages, 0),
      sentBytesPerSec: canComputeRate
        ? Math.max(0, bytesSent - this.lastTransportBytesSent) * 1000 / elapsedMs
        : 0,
      receivedBytesPerSec: canComputeRate
        ? Math.max(0, bytesReceived - this.lastTransportBytesReceived) * 1000 / elapsedMs
        : 0,
      medianRttMs: measuredRtts.length > 0 ? Math.max(...measuredRtts) : 0,
      medianAppPingMs: measuredAppPings.length > 0 ? Math.max(...measuredAppPings) : 0,
      sampleMs: performance.now() - startedAt,
    };
    this.lastTransportBytesSent = bytesSent;
    this.lastTransportBytesReceived = bytesReceived;
    return this.transportPerformanceCounts;
  }

  private describePerformanceEnvironment(): Record<string, unknown> {
    const canvas = this.game.canvas;
    const renderer = this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const gl = renderer.gl;
    const debugRendererInfo = gl?.getExtension('WEBGL_debug_renderer_info');
    const gpuRenderer = gl && debugRendererInfo
      ? gl.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL)
      : null;
    const gpuVendor = gl && debugRendererInfo
      ? gl.getParameter(debugRendererInfo.UNMASKED_VENDOR_WEBGL)
      : null;
    const nav = typeof navigator === 'undefined' ? null : navigator as Navigator & { deviceMemory?: number };
    const glLimits = {
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      maxVertexTextureImageUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
      maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
      maxViewportDims: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array),
    };

    // Vorwiegend Geraete- und Renderer-Daten. Rock-Renderer und Page-Groesse gehoeren als
    // ausdrueckliche Vergleichsparameter dazu; Rolle, Qualitaet, Modus und Map werden zusaetzlich
    // als beobachteter, veraenderlicher Session-Kontext aufgezeichnet.
    return {
      renderer: 'webgl',
      gpuRenderer,
      gpuVendor,
      webglVersion: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      supportedExtensions: gl.getSupportedExtensions() ?? [],
      glLimits,
      canvas: { width: canvas.width, height: canvas.height },
      screen: typeof window === 'undefined'
        ? null
        : {
          width: window.screen.width,
          height: window.screen.height,
          availWidth: window.screen.availWidth,
          availHeight: window.screen.availHeight,
        },
      devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      pageVisibility: typeof document === 'undefined' ? null : document.visibilityState,
      documentFocused: typeof document === 'undefined' ? null : document.hasFocus(),
      userAgent: nav?.userAgent ?? null,
      platform: nav?.platform ?? null,
      hardwareConcurrency: nav?.hardwareConcurrency ?? null,
      deviceMemoryGb: nav?.deviceMemory ?? null,
      rockRendering: {
        mode: this.ctx?.arenaResult?.rockVisualSystem.getMode() ?? getRockRendererMode(),
        pageSize: this.ctx?.arenaResult?.rockVisualSystem.getPageSize() ?? getRockGpuPageSize(),
        gpu: this.ctx?.arenaResult?.rockVisualSystem.getGpuDiagnostics() ?? null,
      },
    };
  }

  private initializeRoomQuality(): void {
    this.roomQualityMonitor.initialize(this.time.now);
    this.roomQualitySnapshot = this.roomQualityMonitor.getSnapshot();
  }

  private updateRoomQuality(now: number, players: PlayerProfile[]): void {
    this.roomQualitySnapshot = this.roomQualityMonitor.update(now, players);
  }

  private refreshStoredCoopDefenseProgress(): void {
    const stored = getStoredCoopDefenseProgress();
    const classesUnlocked = stored.unlockedClassIds.length > 0;
    const activeClassId = classesUnlocked
      ? stored.selectedClassId
      : DEFAULT_COOP_DEFENSE_CLASS_ID;
    const activeProfile = classesUnlocked
      ? stored.profilesByClass[stored.selectedClassId]
      : stored.defaultProfile;
    this.coopDefenseProgress = getCoopDefenseProgressSnapshot(
      stored.totalXp,
      activeProfile,
      stored.completedBossMapIds.length,
      activeClassId,
      classesUnlocked,
      stored.unlockedClassIds,
    );
    this.coopDefenseLastProcessedRoundEndedAt = stored.lastProcessedRoundEndedAt;
    this.coopDefenseHighestUnlockedMapId = stored.highestUnlockedMapId;
    this.coopDefenseItemsUnlocked = stored.itemsUnlocked;
    this.coopDefenseHasPendingItemReward = stored.pendingItemReward !== null;
    this.coopDefenseHasUnseenItems = stored.unseenItems;
    bridge.setLocalCoopDefenseTotalXp(this.coopDefenseProgress.totalXp);
    this.resyncLoadoutWithUnlocks(stored);
    this.coopDefenseUpgradesOverlay?.refresh();
  }

  /** Zieht nach einem validierten Dateiimport alle lobby-lokalen Ableitungen atomar nach. */
  private handleImportedGameProgress(): void {
    if (bridge.getGamePhase() !== 'LOBBY') return;
    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    this.refreshStoredCoopDefenseProgress();
    this.applyDefaultCoopDefenseMapSelection();
    this.lobbyOverlay.setCoopDefenseProgress(
      isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null,
    );
    this.refreshCoopDefenseItemsButton();
    this.clientUpdate.refreshStoredProgressFallback();
  }

  /**
   * Haelt die Loadout-Slots auf tatsaechlich waehlbaren Items. Noetig nach Klassenwechsel,
   * Level-Down und Full Respec: ein Slot darf nie ein inzwischen gesperrtes Item behalten.
   * Beim Inspector schnappt so auch der Waffe-2-Slot auf seine Adrenalinfaehigkeit.
   */
  private resyncLoadoutWithUnlocks(stored: CoopDefenseProgressPreferences): void {
    if (bridge.getGamePhase() !== 'LOBBY' || !isCoopDefenseMode(bridge.getGameMode())) return;
    const classId = stored.classesUnlocked ? stored.selectedClassId : DEFAULT_COOP_DEFENSE_CLASS_ID;
    const profile = stored.classesUnlocked
      ? stored.profilesByClass[stored.selectedClassId]
      : stored.defaultProfile;
    const localId = bridge.getLocalPlayerId();
    for (const slot of ['weapon1', 'weapon2', 'utility', 'ultimate'] as const) {
      const selectable = getSelectableLoadoutItems(slot, bridge.getGameMode(), profile, classId);
      if (selectable.length === 0) continue;
      const current = bridge.getPlayerLoadoutSlot(localId, slot);
      if (current && selectable.some((item) => item.id === current)) continue;
      bridge.setLocalLoadoutSlot(slot, selectable[0].id);
      if (stored.classesUnlocked) {
        setStoredCoopDefenseLoadoutSlot(classId, slot, selectable[0].id);
      } else {
        setStoredLoadoutSlot(slot, selectable[0].id);
      }
    }
  }

  /**
   * Stellt die Lobby-Auswahl auf die hoechste freigeschaltete Map. Nur der Host besitzt die
   * Map-Auswahl; Clients folgen dem replizierten Wert und ihr eigener Freischaltstand zaehlt nicht.
   */
  private applyDefaultCoopDefenseMapSelection(): void {
    if (!bridge.isHost()) return;
    bridge.setCoopDefenseMapId(this.coopDefenseHighestUnlockedMapId);
  }

  /**
   * Verzoegert nur den lokalen Arena-Abbau. Der Host hat Ergebnis und LOBBY-Phase bereits
   * publiziert; Simulation und Eingabe bleiben deshalb aus, waehrend das letzte Bild ausfadet.
   */
  private syncArenaExitFade(phase: GamePhase): boolean {
    if (phase === 'ARENA') {
      this.arenaExitFadeComplete = false;
      this.arenaExitOutcomeWaitStartedAt = 0;
      this.arenaExitFadeOverlay?.hide();
      return false;
    }
    if (
      phase !== 'LOBBY'
      || this.lastObservedGamePhase !== 'ARENA'
      || this.lifecycle.isMatchTerminated()
      || this.arenaExitFadeComplete
    ) {
      return false;
    }
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
      const overlay = this.arenaExitFadeOverlay;
      if (!overlay) {
        this.arenaExitFadeComplete = true;
        return false;
      }
      overlay.play(outcome, () => {
        this.arenaExitFadeComplete = true;
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
    if (!isCoopDefenseMode(bridge.getGameMode())) return;
    const roundState = bridge.getRoundState();
    if (!roundState || roundState.coopDefenseHumanPlayerCount !== 1) return;
    const localPlayerId = bridge.getLocalPlayerId();
    const localPlayerState = this.ctx.combatSystem;
    const ownMainBases = this.ctx.baseManager?.getMainBasesByFaction('friendly') ?? [];
    const hostileMainBases = this.ctx.baseManager?.getMainBasesByFaction('hostile') ?? [];
    const sumBase = (bases: readonly { getHp(): number; getMaxHp(): number }[]): { hp: number; maxHp: number } | null => (
      bases.length === 0
        ? null
        : bases.reduce((sum, base) => ({
          hp: sum.hp + Math.max(0, base.getHp()),
          maxHp: sum.maxHp + Math.max(0, base.getMaxHp()),
        }), { hp: 0, maxHp: 0 })
    );
    const ownBase = sumBase(ownMainBases);
    const hostileBase = sumBase(hostileMainBases);
    const storedProgress = getStoredCoopDefenseProgress();
    const committed = bridge.getPlayerCommittedLoadout(localPlayerId);
    this.coopDefenseBalanceTracker.preparePendingRound({
      gameMode: bridge.getGameMode(),
      roundState,
      mapConfig: getCoopDefenseMapConfig(roundState.coopDefenseMapId ?? bridge.getCoopDefenseMapId()),
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
      survivalRemainingRespawns: bridge.getLocalCoopDefenseSurvivalState()?.remainingRespawns ?? null,
      build: buildBalanceBuildSnapshot(
        storedProgress.totalXp,
        this.coopDefenseProgress.level,
        committed,
      ),
    });
  }

  private beginMatchResults(): void {
    // Die Auswertung darf nicht aus der vorherigen Runde als Replay in den neuen Lobby-Frame
    // hineinragen, insbesondere nicht bei einem Latejoiner/Spectator.
    this.lastMatchResultsPresentation = null;
    const existingResults = bridge.getRoundResults();
    if (existingResults && !bridge.isLocalRoundResultEligible(existingResults)) {
      this.matchResultsPending = false;
      this.matchResultsProgressBefore = null;
      this.matchResultsOverlay?.hide();
      return;
    }
    const mode = bridge.getGameMode();
    const roundState = bridge.getRoundState();
    const mapLabel = isCoopDefenseMode(mode)
      ? getMapName(roundState?.coopDefenseMapId ?? bridge.getCoopDefenseMapId(), getLocale())
      : 'Zufallsarena';

    this.matchResultsPending = true;
    this.matchResultsProgressBefore = isCoopDefenseMode(mode) ? this.coopDefenseProgress : null;
    this.matchResultsOverlay?.showSyncing(getLocalizedGameModeLabel(mode), mapLabel);
  }

  /**
   * Wartet auf den atomaren Endstand und zeigt erst danach den Endzustand. Der Ergebnis-Layer
   * selbst schreibt keine Belohnungen; im Coop-Modus ist die lokale Persistenz vorher abgeschlossen.
   */
  private tryFinalizeMatchResults(): void {
    const results = bridge.getRoundResults();
    if (!results || results.length === 0) return;
    if (!bridge.isLocalRoundResultEligible(results)) {
      this.matchResultsPending = false;
      this.matchResultsProgressBefore = null;
      this.matchResultsOverlay?.hide();
      return;
    }

    const firstResult = results[0];
    const mode = firstResult.gameMode ?? bridge.getGameMode();
    const roundState = bridge.getRoundState();
    if (
      isCoopDefenseMode(mode)
      && (
        !roundState?.endedAt
        || roundState.endedAt !== firstResult.roundEndedAt
        || roundState.status === 'active'
      )
    ) {
      return;
    }

    if (isCoopDefenseMode(mode)) {
      this.coopDefenseBalanceTracker.finalizePendingRound(firstResult.roundEndedAt);
    }

    const progress = isCoopDefenseMode(mode)
      ? this.processCoopDefenseRoundProgress(this.matchResultsProgressBefore ?? this.coopDefenseProgress)
      : null;
    if (isCoopDefenseMode(mode) && !progress) return;

    const outcome = resolvePersonalMatchOutcome(
      mode,
      bridge.getLocalPlayerId(),
      results,
      roundState,
    );
    const presentation: MatchResultsPresentation = {
      outcome,
      mode,
      modeLabel: getLocalizedGameModeLabel(mode),
      mapLabel: firstResult.mapName || 'Zufallsarena',
      localPlayerId: bridge.getLocalPlayerId(),
      leaderboard: sortMatchLeaderboard(results),
      progress,
      technicalMessage: null,
      itemReward: isCoopDefenseMode(mode) ? this.buildItemRewardPresentation() : null,
    };
    this.lastMatchResultsPresentation = presentation;
    this.matchResultsOverlay?.setBalanceFeedbackVisible(
      isCoopDefenseMode(mode) && this.coopDefenseBalanceTracker.hasRound(firstResult.roundEndedAt),
    );
    this.matchResultsOverlay?.show(presentation);
    this.matchResultsPending = false;
    this.matchResultsProgressBefore = null;
  }

  /**
   * Oeffnet die Auswertung der letzten Runde noch einmal. Es wird ausschliesslich die bereits
   * berechnete Praesentation wiederverwendet: kein erneutes Verbuchen von XP, Skillpunkten
   * oder Map-Freischaltungen, und beim Schliessen kein Lobby-Uebergang.
   */
  private replayMatchResults(): void {
    const presentation = this.lastMatchResultsPresentation;
    if (!presentation || this.matchResultsPending) return;
    if (this.matchResultsOverlay?.isVisible()) return;
    const roundEndedAt = presentation.leaderboard[0]?.roundEndedAt ?? null;
    this.matchResultsOverlay?.setBalanceFeedbackVisible(
      isCoopDefenseMode(presentation.mode)
      && roundEndedAt !== null
      && this.coopDefenseBalanceTracker.hasRound(roundEndedAt),
    );
    this.matchResultsOverlay?.showReplay(presentation);
  }

  private openBalanceFeedback(): void {
    const presentation = this.lastMatchResultsPresentation;
    if (!presentation || !isCoopDefenseMode(presentation.mode)) return;
    const roundEndedAt = presentation.leaderboard[0]?.roundEndedAt;
    if (!roundEndedAt || !this.coopDefenseBalanceTracker.hasRound(roundEndedAt)) return;
    this.coopDefenseBalanceReportOverlay?.showFeedback(roundEndedAt);
  }

  /** Zeigt eine offene Belohnung. No-op, wenn keine offen ist oder der Layer schon sichtbar ist. */
  private openItemRewardOverlay(): void {
    if (this.itemRewardOverlay?.isVisible()) return;
    const presentation = this.buildItemRewardPresentation();
    if (!presentation) return;
    this.itemRewardOverlay?.show(presentation);
  }

  /** Liest das offene Angebot frisch aus der Persistenz und baut die Auswahlansicht dazu. */
  private buildItemRewardPresentation(): MatchItemRewardPresentation | null {
    const progress = getStoredCoopDefenseProgress();
    return createMatchItemRewardPresentation(
      progress.pendingItemReward,
      progress.items,
      progress.equippedItemIds,
    );
  }

  /**
   * Loest eine Auswahl im Ergebnis-Screen auf und aktualisiert die Anzeige. Bleibt die Belohnung
   * offen (volle Kategorie ohne Zerlege-Ziel), passiert nichts und der Screen fragt weiter.
   */
  private claimItemReward(
    offerUid: string,
    salvageUid?: string,
    action: CoopDefenseItemRewardAction = 'take',
  ): boolean {
    if (!claimStoredPendingCoopDefenseItemReward(offerUid, salvageUid, action)) return false;
    this.refreshStoredCoopDefenseProgress();
    if (this.lastMatchResultsPresentation) {
      this.lastMatchResultsPresentation = {
        ...this.lastMatchResultsPresentation,
        itemReward: this.buildItemRewardPresentation(),
      };
    }
    this.lobbyOverlay.setCoopDefenseProgress(
      isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null,
    );
    // Wurde die Belohnung aus dem offenen Item-Menue heraus abgeholt, sieht der Spieler das neue
    // Teil sofort - dann darf der Button gar nicht erst zu leuchten anfangen.
    if (this.itemsOverlay?.isOpen()) markStoredCoopDefenseItemsSeen();
    this.refreshCoopDefenseItemsButton();
    this.itemsOverlay?.refresh();
    return true;
  }

  private processCoopDefenseRoundProgress(
    before: CoopDefenseProgressSnapshot,
  ): MatchProgressDelta | null {
    const roundState = bridge.getRoundState();
    const results = bridge.getRoundResults();
    const endedAt = roundState?.endedAt ?? null;
    if (!roundState || !endedAt || !results?.length) return null;
    if (!bridge.isLocalRoundResultEligible(results)) return null;

    if (this.coopDefenseLastProcessedRoundEndedAt !== null && this.coopDefenseLastProcessedRoundEndedAt >= endedAt) {
      return createMatchProgressDelta(before, this.coopDefenseProgress, 0, null);
    }

    const sharedRoundXp = Math.max(
      0,
      Math.floor(
        results.find((result) => typeof result.sharedXp === 'number')?.sharedXp
          ?? bridge.getCoopDefenseRoundXp(),
      ),
    );
    if (sharedRoundXp > 0) addStoredCoopDefenseXp(sharedRoundXp);

    const completedMapId = roundState.coopDefenseMapId;
    let unlockedNewMap = false;
    let unlockedItems = false;
    if (roundState.status === 'victory' && completedMapId) {
      const completedMapConfig = getCoopDefenseMapConfig(completedMapId);
      if (completedMapConfig.boss) {
        markStoredCoopDefenseBossMapCompleted(completedMapId);
      }
      unlockStoredCoopDefenseClassesAfterVictory(completedMapId);
      unlockedItems = unlockStoredCoopDefenseItemsAfterVictory(completedMapId);
      unlockedNewMap = unlockStoredCoopDefenseMapAfterVictory(completedMapId);

      // Jeder Spieler wuerfelt sein eigenes Angebot lokal; der Sieg steht bereits reliable im
      // RoundState, deshalb braucht die Belohnung keinen Netzwerkpfad. Persistiert, damit sie
      // Reload und Verbindungsabbruch waehrend der Auswahl uebersteht.
      if (completedMapConfig.itemDrop && getStoredCoopDefenseItemsUnlocked()) {
        // Klassengebundene Affixe rollen nur fuer die Klasse, mit der die Runde tatsaechlich
        // gespielt wurde. Das committete Loadout ist dafuer die Wahrheit: es ist seit "Bereit"
        // eingefroren, waehrend die Klassenauswahl im Speicher schon wieder wandern koennte.
        const playedClassId = bridge.getPlayerCommittedLoadout(bridge.getLocalPlayerId())
          ?.coopDefenseClassId ?? null;
        const epicGuaranteeCount = resolveCoopDefenseEpicGuaranteeCount(results, roundState);
        const offers = rollCoopDefenseItemOffer(completedMapConfig.itemDrop.itemLevel, playedClassId);
        setStoredPendingCoopDefenseItemReward({
          roundEndedAt: endedAt,
          epicGuaranteeCount,
          offers: applyCoopDefenseEpicGuarantee(offers, epicGuaranteeCount, playedClassId),
        });
      }
    }

    markStoredCoopDefenseRoundProcessed(endedAt);
    this.refreshStoredCoopDefenseProgress();
    const unlockedMapName = unlockedNewMap
      ? getMapName(this.coopDefenseHighestUnlockedMapId, getLocale())
      : null;
    if (unlockedNewMap) this.applyDefaultCoopDefenseMapSelection();
    return createMatchProgressDelta(
      before,
      this.coopDefenseProgress,
      sharedRoundXp,
      unlockedMapName,
      unlockedItems,
    );
  }
}
