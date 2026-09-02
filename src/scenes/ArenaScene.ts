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
import { preloadPersistentBaseGravelAssets } from '../arena/PersistentBaseGravelConfig';
import { preloadRockMossAssets } from '../arena/RockMossConfig';
import { preloadRockVegetationAssets } from '../arena/RockVegetationConfig';
import { preloadTurretVisualAssets } from '../config/turretVisuals';
import { PlayerManager }         from '../entities/PlayerManager';
import { ProjectileManager }     from '../entities/ProjectileManager';
import { InputSystem }           from '../systems/InputSystem';
import { HostPhysicsSystem }     from '../systems/HostPhysicsSystem';
import { CombatSystem }          from '../systems/CombatSystem';
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
import { HostileBaseIndicator, getVisibleWorldView } from '../ui/HostileBaseIndicator';
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
import { TimeOfDayDebugOverlay } from '../ui/TimeOfDayDebugOverlay';
import { DEFAULT_TIME_OF_DAY_MINUTES, resolveSkyState } from '../effects/TimeOfDay';
import type { WorldGradeInputs } from '../effects/postfx/worldGrade';
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
} from '../ui/CoopDefenseItemsOverlay';
import {
  resolvePersonalMatchOutcome,
} from '../ui/MatchResultsModel';
import { LeftSidePanel }         from '../ui/LeftSidePanel';
import { RightSidePanel }        from '../ui/RightSidePanel';
import { CenterHUD }             from '../ui/CenterHUD';
import { CoopDefenseObjectiveAnnouncement } from '../ui/CoopDefenseObjectiveAnnouncement';
import { CoopDefenseMapEventAnnouncementPresenter } from '../ui/CoopDefenseMapEventAnnouncementPresenter';
import { CoopDefenseSecondaryObjectiveHud } from '../ui/CoopDefenseSecondaryObjectiveHud';
import { LobbyOverlay }          from './LobbyOverlay';
import { BootScreen }             from '../ui/BootScreen';
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
import { preloadTrainMaterialAssets } from '../train/TrainRenderer';
import {
  preloadBadgerAnimationAssets,
  registerBadgerAnimations,
} from '../animations/BadgerAnimations';
import { resolveLoadoutSelectionIds } from '../loadout/LoadoutRules';
import type { PlaceableTurretUtilityConfig } from '../loadout/LoadoutConfig';
import { copyRoomShareUrl, rejoinCurrentRoom, restartWithNewRoom } from '../utils/roomQuality';
import { WebGLRectMaskTexture } from '../utils/webglRectMask';
import { coversDesignSpace } from './arena/ArenaClipPolicy';
import { ArenaMetaController } from './arena/ArenaMetaController';
import { createArenaMetaProgressStore } from './arena/ArenaMetaPersistence';
import {
  getStoredEffectsVolume,
  getStoredGraphicsQuality,
  getStoredMasterVolume,
  getStoredMusicVolume,
} from '../utils/localPreferences';
import { GraphicsQualityController } from '../graphics/GraphicsQuality';
import { destroySharedGlowSystem, installSharedGlowSystem } from '../effects/SharedGlowSystem';
import { getRenderResolutionController, toDesignSpace } from '../graphics/RenderResolution';
import { installTextResolution } from '../graphics/TextResolution';
import type { CoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';
import {
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  getCoopDefenseUpgradeTextureKey,
  hasCoopDefenseDedicatedUpgradeIcon,
} from '../utils/coopDefenseUpgrades';
import type { ConstructionId, GameMode, GamePhase, LoadoutCommitSnapshot, LobbyLoadoutPreviewState, PlayerProfile, RoomQualitySnapshot, SyncedProjectile } from '../types';
import { getTrainArrivalCountdownSecs } from '../train/TrainEvent';
import { COOP_DEFENSE_MODE, isCoopDefenseMode, isTeamGameMode } from '../gameModes';
import { getCoopDefenseMapConfig, isWeaponBalanceLabMapId, resolveCoopDefenseMapMissionProgress, WEAPON_BALANCE_LAB_MAP_ID } from '../config/coopDefenseMaps';
import { resolveActiveGameMode, toMapId } from '../world/arenaDescriptorAdapter';
import type { WorldDescriptor } from '../world/WorldDescriptor';
import { isLobbyWorldDefinitionId } from '../config/authoring/lobbyWorld';
import { toArenaMetricsProfile } from '../world/WorldMetrics';
import { resolvePresentationPolicy } from '../world/PresentationPolicy';
import { buildCountdownGroundFirePreview } from '../effects/CountdownGroundFirePreview';
import { getLocale, t } from '../i18n';
import { getLocalizedGameModeLabel } from '../i18n/gameModePresentation';
import { getMapName } from '../i18n/contentPresentation';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../config/coopDefenseEnemies';
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
  ArenaLifecycleCoordinator,
  ArenaRuntime,
  GaussWarningRenderer,
  createRendererBundle,
  wireRenderersToProjManager,
  wireRenderersToEffectSystem,
  wireRenderersToAudioSystem,
  wireRenderersToCameraFeedback,
  wireRenderersToDistortion,
} from './arena';
import { resolveCoopDefenseCarryPresentationSnapshot } from './arena/CoopDefenseCarryPresentation';
import type { CoopMissionPresentationUiPort } from '../activity/CoopMissionPresentationBinding';

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

/**
 * Anteil des Bootscreen-Balkens, den der Asset-Preload einnimmt. Das restliche Fuenftel gehoert
 * der Reveal-Barriere, damit der Balken ueber beide Phasen monoton bleibt.
 */
const BOOT_PRELOAD_PROGRESS_SHARE = 0.8;

/**
 * Notausgang der Reveal-Barriere. Ein Client, dessen World-Descriptor ausbleibt, soll nicht
 * dauerhaft vor dem Bootscreen sitzen - nach dieser Zeit weicht er in jedem Fall.
 */
const BOOT_REVEAL_TIMEOUT_MS = 2500;

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
  private placementPreview!: PlacementPreviewRenderer;
  private persistentBaseVisuals!: PersistentBaseVisuals;
  private persistentBasePreviewRenderer!: PersistentBasePreviewRenderer;
  private tunnelRenderer!: TunnelRenderer;
  private gaussWarning!: GaussWarningRenderer;
  private hostUpdate!: HostUpdateCoordinator;
  private clientUpdate!: ClientUpdateCoordinator;
  private rpcCoordinator!: RpcCoordinator;
  private arenaRuntime!: ArenaRuntime;
  /** Der Arena-Flow der laufenden Szene; sein Owner ist die `ArenaRuntime`. */
  private get lifecycle(): ArenaLifecycleCoordinator { return this.arenaRuntime.flow; }
  private get worldRuntime() { return this.arenaRuntime?.flow.getWorldRuntime() ?? null; }
  private get world() { return this.worldRuntime?.context ?? null; }
  private get arenaResult() { return this.worldRuntime?.materialization?.arena ?? null; }
  private get currentLayout() { return this.worldRuntime?.presentation?.layout ?? null; }
  private get placementSystem() { return this.worldRuntime?.materialization?.placement ?? null; }
  private get rockRegistry() { return this.worldRuntime?.materialization?.rocks ?? null; }
  private get baseManager() { return this.worldRuntime?.materialization?.bases ?? null; }
  private get targetingSystems() { return this.arenaRuntime?.flow.getWorldTargetingRuntime()?.systems ?? null; }
  private get playerSystems() { return this.arenaRuntime?.flow.getWorldPlayerGameplayRuntime()?.systems ?? null; }
  private get combatSystems() { return this.arenaRuntime?.flow.getWorldCombatGameplayBinding()?.systems ?? null; }
  private get supportSystems() { return this.arenaRuntime?.flow.getWorldSupportGameplayRuntime()?.systems ?? null; }
  private get powerUpSystem() { return this.arenaRuntime?.flow.getWorldPowerUpRuntime()?.system ?? null; }
  private get trainManager() { return this.arenaRuntime?.flow.getWorldTrainRuntime()?.getCurrentTrain() ?? null; }
  private get coopMissionRuntime() { return this.arenaRuntime?.flow.getCoopMissionRuntime() ?? null; }
  private get enemyManager() { return this.coopMissionRuntime?.enemyManager ?? null; }
  private get captureTheBeerSystem() {
    return this.arenaRuntime?.flow.getCaptureTheBeerActivityRuntime()?.system ?? null;
  }
  private replicatedCoopDefenseCarryItems: readonly import('../types').SyncedCoopDefenseCarryItem[] = [];
  private get coopDefenseCarryPresentationItems() {
    return resolveCoopDefenseCarryPresentationSnapshot(
      bridge.isHost(),
      this.coopMissionRuntime?.coopDefenseCarrySystem ?? null,
      this.replicatedCoopDefenseCarryItems,
    );
  }

  // ── Lobby / Room-quality (not round-scoped) ───────────────────────────────
  private lobbyOverlay!: LobbyOverlay;
  private roomQualityMonitor!: RoomQualityMonitor;
  private roomQualitySnapshot: RoomQualitySnapshot | null = null;
  private timeOfDayDebugOverlay: TimeOfDayDebugOverlay | null = null;
  /** Scene-langlebiger Owner der Diagnose (Profiler, Ablation, Net-/Performance-Overlay). */
  private diagnostics: ArenaDiagnosticsController | null = null;
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
  private matchResultsOverlay: MatchResultsOverlay | null = null;
  private roomStatisticsOverlay: RoomStatisticsOverlay | null = null;
  private arenaExitFadeOverlay: ArenaExitFadeOverlay | null = null;
  private arenaExitFadeComplete = false;
  private arenaExitOutcomeWaitStartedAt = 0;
  /** Nur das Angebot der gerade abgeschlossenen Runde darf automatisch erscheinen. */
  private lastObservedGamePhase: GamePhase | null = null;
  /** Solange gesetzt, deckt der Bootscreen die Lobby noch ab (siehe `syncBootReveal`). */
  private bootRevealPending = true;
  private bootRevealDeadlineMs = 0;
  private itemRewardOverlay: CoopDefenseItemRewardOverlay | null = null;
  private itemsOverlay: CoopDefenseItemsOverlay | null = null;
  private lastLobbySidebarSignature: string | null = null;
  private graphicsQuality!: GraphicsQualityController;

  constructor() {
    super({ key: 'ArenaScene' });
  }

  preload(): void {
    BootScreen.setStatus(t('ui.boot.loadingData'));
    BootScreen.setProgress(0);

    const onProgress = (ratio: number) => {
      BootScreen.setProgress(ratio * BOOT_PRELOAD_PROGRESS_SHARE);
    };

    const cleanupLoader = () => {
      this.load.off(Phaser.Loader.Events.PROGRESS, onProgress);
    };

    this.load.on(Phaser.Loader.Events.PROGRESS, onProgress);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      cleanupLoader();
      BootScreen.setStatus(t('ui.boot.preparingLobby'));
      BootScreen.setProgress(BOOT_PRELOAD_PROGRESS_SHARE);
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
    this.load.spritesheet('dirt_mottle', './assets/sprites/dirt47blob_mottle.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('kies', './assets/sprites/kies47blob.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('base',  './assets/sprites/base47blob.png',  { frameWidth: 32, frameHeight: 32 });
    // Rote Variante fuer Gegnerbasen (scripts/generate-hostile-base-sheet.mjs). Gleiche
    // Frame-Indizes, daher unveraenderte Autotile-Logik.
    this.load.spritesheet('base_hostile', './assets/sprites/base47blob_hostile.png', { frameWidth: 32, frameHeight: 32 });
    preloadArenaDecalAssets(this.load);
    preloadGroundCoverAssets(this.load);
    preloadPersistentBaseGravelAssets(this.load);
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
    this.load.atlas('dachs_death', './assets/player/dachs_death_ani3.png', './assets/player/dachs_death_ani3.json');
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
    installSharedGlowSystem(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => destroySharedGlowSystem(this));
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
        getState: () => ({
          staticShadows: this.renderers?.shadow?.isStaticVisible() ?? true,
          groundSurface: this.arenaResult?.groundSurface?.isVisible() ?? true,
          rockOverlay: this.arenaResult?.rockOverlaySurface?.isVisible() ?? true,
          chunkSampling: this.renderers?.shadow?.getSamplingMode()
            ?? this.arenaResult?.groundSurface?.getSamplingMode()
            ?? 'default',
          rockRenderer: this.arenaResult?.rockVisualSystem?.getMode() ?? getRockRendererMode(),
          rockGpuPageSize: this.arenaResult?.rockVisualSystem?.getPageSize() ?? getRockGpuPageSize(),
          rockGpu: this.arenaResult?.rockVisualSystem?.getGpuDiagnostics() ?? null,
        }),
        setStaticShadowsVisible: (visible) => this.renderers?.shadow?.setStaticVisible(visible),
        setGroundSurfaceVisible: (visible) => this.arenaResult?.groundSurface?.setVisible(visible),
        setRockOverlayVisible: (visible) => this.arenaResult?.rockOverlaySurface?.setVisible(visible),
        setChunkSampling: (mode) => {
          this.renderers?.shadow?.setSamplingMode(mode);
          this.arenaResult?.groundSurface?.setSamplingMode(mode);
          this.arenaResult?.rockOverlaySurface?.setSamplingMode(mode);
        },
        setRockRenderer: (mode) => {
          setRockRendererMode(mode);
          this.arenaResult?.rockVisualSystem?.setMode(mode);
        },
        setRockGpuPageSize: (size) => {
          setRockGpuPageSize(size);
          this.arenaResult?.rockVisualSystem?.setPageSize(size);
        },
      },
      getGpuVfxStats: () => this.renderers?.gpuVfx.getStats() ?? null,
      getFlowFieldCoordinator: () => this.coopMissionRuntime?.flowFieldCoordinator ?? null,
      getRockVisualSystem: (): ArenaDiagnosticsRockVisualSystemPort | null => this.arenaResult?.rockVisualSystem ?? null,
      getHostPerformanceMetrics: () => this.hostUpdate.getPerformanceMetrics(),
      getClientPerformanceMetrics: () => this.clientUpdate.getPerformanceMetrics(),
      getFrameMetrics: () => ({
        firePerformance: this.ctx.fireSystem.takePerformanceMetrics(),
        fireVisualMs: this.renderers.flamethrowerUpgrades.getLastUpdateCostMs(),
        lightingPerformance: this.renderers.lighting.getPerformanceMetrics(),
        lightingStepMs: this.renderers.lighting.getLastUpdateCostMs(),
        scopePerformance: this.scopeOverlay?.getPerformanceMetrics() ?? null,
        aimGraphicsCommandCount: this.ctx.aimSystem?.getGraphicsCommandCount() ?? 0,
      }),
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.diagnostics?.destroy();
      this.diagnostics = null;
    });

    if (!this.anims.exists('player_death')) {
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
    }
    registerBadgerAnimations(this.anims);

    bridge.clearPlayerCallbacks();

    // ── Static arena (never destroyed) ────────────────────────────────────
    this.arenaBuilder = new ArenaBuilder(this);
    this.arenaBuilder.buildStatic(bridge.getGameMode(), bridge.getGamePhase());
    // ── Scene-lifetime systems ─────────────────────────────────────────────
    const playerManager    = new PlayerManager(this);
    playerManager.setLocalPlayerId(bridge.getLocalPlayerId());
    playerManager.setRelationshipResolver((localPlayerId, otherPlayerId) => bridge.isEnemyPair(localPlayerId, otherPlayerId));
    playerManager.setTeamResolver((playerId) => bridge.getPlayerTeam(playerId));
    const projectileManager = new ProjectileManager(this);
    const combatSystem     = new CombatSystem(playerManager, projectileManager, bridge);
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
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => gameAudioSystem.cleanup());
    const smokeSystem      = new SmokeSystem(this);
    const fireSystem       = new FireSystem(this);
    this.diagnostics?.subscribeDiagnostics((enabled) => {
      fireSystem.setPerformanceMetricsEnabled(enabled && this.diagnostics?.wantsDetailedSampling() === true);
    });
    const stinkCloudSystem = new StinkCloudSystem(this);
    const hostPhysics      = new HostPhysicsSystem(this, playerManager, bridge, combatSystem);
    const inputSystem      = new InputSystem(
      this, bridge, () => playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject ?? undefined,
    );
    projectileManager.setAudioSystem(gameAudioSystem);
    effectSystem.setAudioSystem(gameAudioSystem);

    this.visualFeedback = new VisualFeedbackDirector(this, {
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
      const enemy = this.enemyManager?.getEnemy(targetId);
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
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject ?? undefined,
      (slot) => this.clientUpdate.getLocalWeaponConfig(slot),
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    this.scopeOverlay = new ScopeOverlay(this);
    this.diagnostics?.subscribeDiagnostics((enabled) => {
      this.scopeOverlay?.setPerformanceMetricsEnabled(enabled && this.diagnostics?.wantsDetailedSampling() === true);
    });
    this.utilityChargeIndicator = new UtilityChargeIndicator(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject ?? undefined,
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    this.ultimateChargeIndicator = new UtilityChargeIndicator(
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
      progressStore: createArenaMetaProgressStore(),
      session: {
        getGamePhase: () => bridge.getGamePhase(),
        getGameMode: () => bridge.getGameMode(),
        getLocalPlayerId: () => bridge.getLocalPlayerId(),
        isHost: () => bridge.isHost(),
        getCoopDefenseMapId: () => bridge.getCoopDefenseMapId(),
        setCoopDefenseMapId: (mapId) => bridge.setCoopDefenseMapId(mapId),
        isLocalReady: () => this.lifecycle.getIsLocalReady(),
        isAuthoritativeLocalReady: () => bridge.getPlayerReady(bridge.getLocalPlayerId()),
        getPlayerLoadoutSlot: (playerId, slot) => bridge.getPlayerLoadoutSlot(playerId, slot),
        setLocalLoadoutSlot: (slot, itemId) => bridge.setLocalLoadoutSlot(slot, itemId),
        setLocalReady: (ready) => {
          bridge.setLocalReady(ready);
          this.lifecycle.setIsLocalReady(ready);
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
        refreshUpgradeOverlay: () => this.coopDefenseUpgradesOverlay?.refresh(),
        scheduleUpgradeOverlayRefresh: () => this.coopDefenseUpgradesOverlay?.scheduleRefresh(),
        refreshColorIndicator: () => this.ctx.leftPanel.refreshColorIndicator(),
        hideDebugOverlay: () => this.coopDefenseDebugOverlay?.hide(),
        showUpgradeOverlay: () => this.coopDefenseUpgradesOverlay?.show(),
        showItemsOverlay: () => this.itemsOverlay?.show(),
        refreshItemsOverlay: () => this.itemsOverlay?.refresh(),
        isItemsOverlayOpen: () => this.itemsOverlay?.isOpen() ?? false,
        showItemRewardOverlay: (presentation, closeAfterClaim) => this.itemRewardOverlay?.show(presentation, closeAfterClaim),
        isItemRewardOverlayVisible: () => this.itemRewardOverlay?.isVisible() ?? false,
        showMatchResultsSyncing: (modeLabel, mapLabel) => this.matchResultsOverlay?.showSyncing(modeLabel, mapLabel),
        hideMatchResults: () => this.matchResultsOverlay?.hide(),
        showMatchResults: (presentation) => this.matchResultsOverlay?.show(presentation),
        showMatchResultsReplay: (presentation) => this.matchResultsOverlay?.showReplay(presentation),
        isMatchResultsVisible: () => this.matchResultsOverlay?.isVisible() ?? false,
        setMatchResultsBalanceFeedbackVisible: (visible) => this.matchResultsOverlay?.setBalanceFeedbackVisible(visible),
        showMatchResultsTechnicalAbort: (message) => this.matchResultsOverlay?.showTechnicalAbort(message),
        setResultsReplayAvailable: (available) => rightPanel.setResultsReplayAvailable(available),
      },
    });
    this.coopDefenseDebugOverlay = new CoopDefenseDebugOverlay(
      () => {
        const stored = this.meta!.getStoredProgress();
        return {
          totalXp: stored.totalXp,
          bossPoints: stored.completedBossMapIds.length,
          highestUnlockedMapId: stored.highestUnlockedMapId,
          unlockedClassIds: [...stored.unlockedClassIds],
          itemsUnlocked: stored.itemsUnlocked,
          persistentBaseUnlocked: stored.persistentBaseUnlocked,
          persistentBaseAreaStage: stored.persistentBaseAreaStage,
          persistentBaseRewardUnlocks: [...stored.persistentBaseRewardUnlocks],
        };
      },
      (totalXp, bossPoints, highestUnlockedMapId) => {
        this.meta?.setDebugProgress(totalXp, bossPoints, highestUnlockedMapId);
        this.refreshCoopDefenseDebugState({ applyMapSelection: true, metaAlreadyRefreshed: true });
      },
      () => {
        this.meta?.resetCharacter();
        this.refreshCoopDefenseDebugState({ applyMapSelection: true, metaAlreadyRefreshed: true });
      },
      () => {
        this.meta?.setDebugPersistentBaseUnlocked(true);
        this.refreshCoopDefenseDebugState();
      },
      () => {
        this.meta?.setDebugPersistentBaseAreaStage(1);
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
    );
    this.timeOfDayDebugOverlay = new TimeOfDayDebugOverlay(
      () => this.lifecycle.getCurrentTimeOfDayMinutes(),
      () => this.lifecycle.getAutomaticTimeOfDayMinutes(),
      (minutes, settled) => this.applyDebugTimeOfDay(minutes, settled),
      () => this.clearDebugTimeOfDay(),
    );
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
    );
    this.coopDefenseUpgradesOverlay.build();
    this.itemRewardOverlay = new CoopDefenseItemRewardOverlay(
      this,
      (roundEndedAt, offerUid, salvageUid, action) => Boolean(
        this.meta?.claimItemReward(roundEndedAt, offerUid, salvageUid, action),
      ),
      () => this.meta?.getItemRewardPresentation() ?? null,
      () => {
        this.lobbyOverlay.setReadyButtonState(false);
        this.itemsOverlay?.refresh();
      },
    );
    this.itemRewardOverlay.build();
    this.itemsOverlay = new CoopDefenseItemsOverlay(
      this,
      () => this.meta!.getItemsOverlayState(),
      (uid) => { this.meta?.equipItem(uid); },
      (slot) => { this.meta?.unequipItem(slot); },
      (uid) => { this.meta?.salvageItem(uid); },
      () => this.meta?.openItemRewardOverlay(),
      () => this.lobbyOverlay.setReadyButtonState(false),
    );
    this.itemsOverlay.build();
    this.matchResultsOverlay = new MatchResultsOverlay(this, () => {
      // Die Netzwerkphase ist bereits LOBBY. Der lokale Layer gibt lediglich die darunter
      // vorbereitete Lobby frei; Ready bleibt durch den Host-Reset weiterhin false.
      this.lobbyOverlay.setReadyButtonState(false);
      // Nur der Reward dieser Runde folgt direkt auf die Auswertung. Altbestand bleibt bewusst
      // im Item-Menue und wird nicht nach einem Match ohne neuen Drop aufgezwungen.
      this.meta?.openItemRewardOverlay(
        this.meta?.getLastMatchResultsPresentation()?.itemReward?.roundEndedAt,
        true,
      );
    }, () => this.openBalanceFeedback());
    this.matchResultsOverlay.build();
    this.roomStatisticsOverlay = new RoomStatisticsOverlay(this);
    this.roomStatisticsOverlay.build();
    this.arenaExitFadeOverlay = new ArenaExitFadeOverlay(this);
    this.arenaExitFadeOverlay.build();
    rightPanel.setResultsReplayHandler(() => {
      const presentation = this.meta?.getLastMatchResultsPresentation();
      const roundEndedAt = presentation?.leaderboard[0]?.roundEndedAt ?? null;
      this.meta?.replayMatchResults(
        !!presentation
        && isCoopDefenseMode(presentation.mode)
        && roundEndedAt !== null
        && this.coopDefenseBalanceTracker.hasRound(roundEndedAt),
      );
    });
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
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject ?? undefined,
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
    };

    playerManager.setSpawnContextProvider((playerId) => {
      const latestState = bridge.getLatestGameState();
      const missionState = bridge.getCoopDefenseMissionProgressPresentationState();
      const worldMapId = this.world ? toMapId(this.world.descriptor.definitionId) : null;
      const missionConfig = worldMapId === null
        ? null
        : resolveCoopDefenseMapMissionProgress(getCoopDefenseMapConfig(worldMapId));
      const respawnCheckpoint = missionConfig?.checkpoints.find(
        ({ id }) => id === missionState?.respawnCheckpointId,
      );
      // Ohne aktivierten Respawn-Checkpoint bleibt der authored Startbereich der Fokus. Auf einer
      // langen Routenkarte waere der Initialspawn sonst ueber die gesamte Arena verteilt.
      const spawnFocusCell = respawnCheckpoint ?? missionConfig?.startArea;
      const runtimePlaceables = this.placementSystem?.getAllRuntimeRocks() ?? latestState?.placeableRocks ?? [];
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
          const livingBases = this.baseManager?.getBasesByFaction('friendly')
            .filter((base) => !(base.isInert?.() ?? false) && base.getHp() > 0) ?? [];
          return (this.enemyManager?.getAllEnemies() ?? [])
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
        livingCoopBaseIds: this.baseManager?.getActiveMainBaseIds('friendly'),
        preferredSpawnFocus: spawnFocusCell
          ? {
            x: ARENA_OFFSET_X + (spawnFocusCell.gridX + 0.5) * CELL_SIZE,
            y: ARENA_OFFSET_Y + (spawnFocusCell.gridY + 0.5) * CELL_SIZE,
          }
          : undefined,
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
    this.diagnostics?.attachGpuVfx(this.renderers.gpuVfx);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.renderers?.explosionGpu.clearPending();
      this.renderers?.combatGoreGpu.destroy();
      this.renderers?.gpuVfx.destroy();
    });
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
    playerManager.setEntityBurnGpuController(this.renderers.entityBurnGpu);
    stinkCloudSystem.setLightingSystem(this.renderers.lighting);
    stinkCloudSystem.setGpuVfxSystem(this.renderers.gpuVfx);
    smokeSystem.setLightingSystem(this.renderers.lighting);
    wireRenderersToProjManager(this.renderers, projectileManager, playerManager);
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
        for (const turret of this.combatSystems?.turret?.getTurrets() ?? []) {
          if (!inRange(turret.x, turret.y)) continue;
          emit(String(turret.id), 'turrets', turret.x, turret.y);
        }
      }
      for (const player of playerManager.getAllPlayers()) {
        if (player.id === ownerId) continue;
        if (!player.active) continue;
        if (!inRange(player.x, player.y)) continue;
        if (!combatSystem.isAlive(player.id)) continue;
        if (this.playerSystems?.burrow?.isBurrowed(player.id)) continue;
        if (!combatSystem.canDamageTarget(ownerId, player.id)) continue;
        emit(player.id, 'players', player.x, player.y);
      }
      if (config.targetTypes?.includes('decoys')) {
        for (const decoy of this.ctx.decoySystem.getHostTargets()) {
          if (decoy.ownerId === ownerId) continue;
          if (!inRange(decoy.sprite.x, decoy.sprite.y)) continue;
          emit(String(decoy.id), 'decoys', decoy.sprite.x, decoy.sprite.y);
        }
      }
      for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
        if (!enemy.sprite.active) continue;
        if (!inRange(enemy.sprite.x, enemy.sprite.y)) continue;
        if (!combatSystem.isAlive(enemy.id)) continue;
        if (!combatSystem.canDamageTarget(ownerId, enemy.id)) continue;
        emit(enemy.id, 'enemies', enemy.sprite.x, enemy.sprite.y);
      }
      if (config.targetTypes?.includes('bases') && !this.enemyManager?.hasEnemy(ownerId)) {
        for (const base of this.baseManager?.getBasesByFaction('hostile') ?? []) {
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
      const catalog = this.coopMissionRuntime?.enemyAiTargetCatalog;
      if (!catalog) return true;
      return catalog.isTargetValid({ kind: type === 'players' ? 'player' : 'decoy', id });
    });

    effectSystem.setup(() => { aimSystem.notifyConfirmedHit(); });

    // ── Shared state & helpers ─────────────────────────────────────────────
    this.localPlayerState = new LocalPlayerState();
    this.rockVisualHelper  = new RockVisualHelper(
      this,
      this.ctx,
      this.renderers.shadow,
      this.renderers.rockDestruction,
      this.renderers.lighting,
      {
        getWorldRuntime: () => this.arenaRuntime?.flow.getWorldRuntime() ?? null,
        getTargetingRuntime: () => this.arenaRuntime?.flow.getWorldTargetingRuntime() ?? null,
        getPlayerGameplayRuntime: () => this.arenaRuntime?.flow.getWorldPlayerGameplayRuntime() ?? null,
        getPowerUpRuntime: () => this.arenaRuntime?.flow.getWorldPowerUpRuntime() ?? null,
      },
    );
    this.hostileBaseIndicator = new HostileBaseIndicator(this);
    this.secondaryObjectiveHud = new CoopDefenseSecondaryObjectiveHud(this, this.objectiveAnnouncements!);
    this.secondaryObjectiveHud.build();
    this.placementPreview  = new PlacementPreviewRenderer(this, this.ctx);
    this.persistentBaseVisuals = new PersistentBaseVisuals(this);
    this.persistentBasePreviewRenderer = new PersistentBasePreviewRenderer(this, this.renderers.lighting);
    this.tunnelRenderer    = new TunnelRenderer(this);
    this.gaussWarning      = new GaussWarningRenderer(
      this,
      () => this.enemyManager?.getAllEnemies() ?? [],
    );

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
      () => this.meta?.openUpgradeOverlay(),
      () => this.meta?.openItemsOverlay(),
      (enter) => enter
        ? this.lifecycle.requestLocalWorldParticipation(true)
        : this.requestLocalLobbyWorldLeave(),
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
    this.meta?.refreshItemsPresentation();

    this.roomQualityMonitor = new RoomQualityMonitor(bridge);

    // ── RPC + Lifecycle coordinators ──────────────────────────────────────
    const coopMissionPresentationUi: CoopMissionPresentationUiPort = {
      centerHud: {
        resetCoopMissionPresentation: () => centerHUD.resetCoopMissionPresentation(),
        updateLifeStatus: (model) => centerHUD.updateLifeStatus(model),
        updateMainObjectivePresentation: (model) => centerHUD.updateMainObjectivePresentation(model),
        updateEncounterPresentation: (state, elapsedMs) => centerHUD.updateEncounterPresentation(state, elapsedMs),
        updateMissionStackOcclusion: (deltaMs) => centerHUD.updateMissionStackOcclusion(
          deltaMs,
          playerManager,
          this.enemyManager,
        ),
        updateTutorial: (text, showControls, anchor) => centerHUD.updateTutorial(text, showControls, anchor),
        updateTutorialStep: (text, anchor) => centerHUD.updateTutorialStep(text, anchor),
      },
      mapEvents: {
        setMapEvents: (events) => this.mapEventAnnouncementPresenter?.setMapEvents(events),
        sync: (state) => this.mapEventAnnouncementPresenter?.sync(state),
        reset: () => this.mapEventAnnouncementPresenter?.reset(),
      },
      secondaryObjectives: {
        sync: (snapshot, configs, elapsedMs) => this.secondaryObjectiveHud?.sync(
          snapshot,
          configs,
          elapsedMs,
          true,
        ),
        updateOcclusionFade: (deltaMs) => this.secondaryObjectiveHud?.updateOcclusionFade(
          deltaMs,
          playerManager,
          this.enemyManager,
        ),
        reset: () => this.secondaryObjectiveHud?.reset(),
      },
    };
    this.arenaRuntime   = new ArenaRuntime({
      scene: this,
      ctx: this.ctx,
      renderers: this.renderers,
      rockVisualHelper: this.rockVisualHelper,
      placementPreview: this.placementPreview,
      persistentBasePreviewRenderer: this.persistentBasePreviewRenderer,
      persistentBaseVisuals: this.persistentBaseVisuals,
      lobbyOverlay: this.lobbyOverlay,
      hostUpdate: this.hostUpdate,
      clientUpdate: this.clientUpdate,
      roomQualityMonitor: this.roomQualityMonitor,
      coopMissionPresentationUi,
      getLocalPlayerId: () => bridge.getLocalPlayerId(),
      getSynchronizedNow: () => bridge.getSynchronizedNow(),
      // Lazy: `this.inputBindings` entsteht erst nach der ArenaRuntime.
      getSpectatorCameraInput: () => this.inputBindings?.getSpectatorCameraInput(),
    });
    this.clientUpdate.setPlayerWorldRuntime(
      (profile, spawn) => this.lifecycle.attachPlayerToWorld(profile, false, spawn),
      (playerId) => this.lifecycle.detachPlayerFromWorld(playerId),
    );
    this.clientUpdate.setWorldPresentationResolver(
      () => this.lifecycle.getLocalWorldPresentation(),
    );
    this.hostUpdate.setPlayerCapabilitiesResolver(
      (playerId) => this.lifecycle.getPlayerCapabilities(playerId),
    );
    this.ctx.hostPhysics.setCanMoveResolver(
      (playerId) => this.lifecycle.getPlayerCapabilities(playerId).canMove,
    );
    this.lifecycle.setRuntimeDiagnosticEventSink(this.diagnostics?.getSemanticEventSink() ?? null);
    this.weaponBalanceLabRuntime = new WeaponBalanceLabRuntime(
      () => this.ctx,
      () => this.lifecycle.getWorldPlayerGameplayRuntime(),
      () => this.lifecycle.getCoopMissionRuntime(),
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
        this.time.delayedCall(0, () => this.lifecycle.hostDiscardRound());
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
      this.ctx.combatSystem,
      this.ctx.decoySystem,
      this.ctx.effectSystem,
      this.ctx.visualFeedback,
      this.ctx.gameAudioSystem,
      { handleRequest: (playerId, join) => this.lifecycle.hostHandleWorldParticipationRequest(playerId, join) },
      { get: (playerId) => this.lifecycle.getPlayerCapabilities(playerId) },
      {
        placeInspectorConstruction: (playerId, constructionId, targetX, targetY, activityRevision) => (
          this.lifecycle.getConstructionWorldRuntime()?.placeInspectorConstruction(
            playerId,
            constructionId,
            targetX,
            targetY,
            activityRevision,
          ) ?? { ok: false, reason: 'blocked' }
        ),
        useInspectorUtility: (playerId, tool, angle, targetX, targetY, now, params) => (
          this.lifecycle.getConstructionWorldRuntime()?.useInspectorUtility(
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
          this.lifecycle.getConstructionWorldRuntime()?.dismantleConstruction(
            playerId,
            targetX,
            targetY,
            activityRevision,
          ) ?? { ok: false, reason: 'blocked' }
        ),
        dismantleAllOwnedConstructions: (playerId, activityRevision) => (
          this.lifecycle.getConstructionWorldRuntime()?.dismantleAllOwnedConstructions(
            playerId,
            activityRevision,
          ) ?? { ok: false, reason: 'blocked' }
        ),
      },
      {
        placeReward: (playerId, request) => (
          this.arenaRuntime.persistentBase.placePersistentBaseReward(playerId, request)
        ),
        moveObject: (playerId, request) => (
          this.arenaRuntime.persistentBase.movePersistentBaseObject(playerId, request)
        ),
      },
      {
        getBurrowSystem: () => this.lifecycle.getWorldPlayerGameplayRuntime()?.systems.burrow ?? null,
        getLoadoutManager: () => this.lifecycle.getWorldPlayerGameplayRuntime()?.systems.loadout ?? null,
        getTranslocatorSystem: () => this.lifecycle.getWorldPlayerGameplayRuntime()?.systems.translocator ?? null,
        getResourceSystem: () => this.lifecycle.getWorldPlayerGameplayRuntime()?.systems.resource ?? null,
        getPowerUpSystem: () => this.lifecycle.getWorldPowerUpRuntime()?.system ?? null,
      },
      { getSystem: () => this.lifecycle.getWorldPlayerGameplayRuntime()?.systems.heldAction ?? null },
      { markDestroyed: () => this.lifecycle.onTrainDestroyed() },
    );
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
    leftPanel.setWorldLeaveBinding({
      canLeave: () => this.canLeaveLocalLobbyWorld(),
      leave: () => this.requestLocalLobbyWorldLeave(),
    });

    if (bridge.isHost()) {
      bridge.initColorPool(PLAYER_COLORS);
    }

    bridge.onPlayerJoin(profile => this.onPlayerJoined(profile));
    bridge.onPlayerQuit(id      => this.onPlayerLeft(id));
    bridge.onSpectatorEntered(id => this.lifecycle.handleSpectatorEntered(id));
    bridge.onKicked(() => {
      this.lobbyOverlay.showHostDisconnectedMessage(t('ui.lobby.kickedFromRoom'));
    });
    this.removeReconnectStatusListener = bridge.onReconnectStatus((status) => {
      if (status.state === 'reconnecting' || status.state === 'resumed') {
        this.mapEventAnnouncementPresenter?.resetForHydration();
      }
      if (status.state === 'resumed') {
        this.clientUpdate.retryUnresolvedWeapon2Predictions();
      }
      if (status.state === 'player-expired') {
        this.lifecycle.handleGuestSessionOwnerRemoved(status.playerId);
      }
    });
    // Verbindungsabbruch: es gibt keinen Hostwechsel und keinen Ersatztransport, die Partie
    // endet mit der konkreten Ursache statt still weiterzulaufen.
    bridge.onNetworkFailure(message => {
      if (bridge.getGamePhase() === 'ARENA') {
        this.meta?.abortMatchResults(message);
      }
      this.lifecycle.terminateMatch(message);
    });

    this.lifecycle.initialize();
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
        sendLoadoutUse: (slot, angle, targetX, targetY, shotId, params, clientX, clientY, clientNow, awaitResult, predictionId) => bridge.sendLoadoutUse(
          slot,
          angle,
          targetX,
          targetY,
          shotId,
          params,
          clientX,
          clientY,
          clientNow,
          awaitResult,
          predictionId,
        ),
        getPlayerCapabilities: () => {
          return this.lifecycle.getPlayerCapabilities(bridge.getLocalPlayerId());
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
        getConstructionCapacityForPlayer: (playerId) => this.arenaRuntime?.flow.getConstructionCapacityForPlayer(playerId),
        getTranslocatorActivePuckId: (playerId) => this.playerSystems?.translocator?.getActivePuckId(playerId),
        placement: {
          getUsedCapacity: (ownerId) => this.placementSystem?.getUsedCapacity(ownerId) ?? 0,
          getDismantlePreview: (ownerId, originX, originY, pointerX, pointerY, range) => this.placementSystem?.getDismantlePreview(
            ownerId,
            originX,
            originY,
            pointerX,
            pointerY,
            range,
          ),
          getPlacementPreview: (config, originX, originY, pointerX, pointerY) => this.placementSystem?.getPlacementPreview(
            config,
            originX,
            originY,
            pointerX,
            pointerY,
          ),
          getTunnelPlacementPreview: (config, originX, originY, pointerX, pointerY, anchor) => this.placementSystem?.getTunnelPlacementPreview(
            config,
            originX,
            originY,
            pointerX,
            pointerY,
            anchor,
          ),
          getConstructionPlacementPreview: (definition, originX, originY, pointerX, pointerY) => this.placementSystem?.getConstructionPlacementPreview(
            definition,
            originX,
            originY,
            pointerX,
            pointerY,
          ),
        },
        persistentBase: {
          getRewardIdsForPlayer: (playerId) => this.arenaRuntime?.persistentBase.getPersistentBaseRewardIdsForPlayer(playerId) ?? [],
          getRewardPlacementPreview: (playerId, rewardId, pointerX, pointerY) => this.arenaRuntime?.persistentBase.getPersistentBaseRewardPlacementPreview(
            playerId,
            rewardId,
            pointerX,
            pointerY,
          ),
          requestRewardPlacement: (rewardId, preview) => this.arenaRuntime?.persistentBase.requestPersistentBaseRewardPlacement(rewardId, preview)
            ?? Promise.resolve({ ok: false, reason: 'blocked' as const }),
          getMoveSourcePreview: (playerId, pointerX, pointerY) => this.arenaRuntime?.persistentBase.getPersistentBaseMoveSourcePreview(
            playerId,
            pointerX,
            pointerY,
          ),
          getMoveTargetPreview: (playerId, sourceRuntimeId, pointerX, pointerY) => this.arenaRuntime?.persistentBase.getPersistentBaseMoveTargetPreview(
            playerId,
            sourceRuntimeId,
            pointerX,
            pointerY,
          ),
          requestMove: (sourceRuntimeId, preview) => this.arenaRuntime?.persistentBase.requestPersistentBaseMove(sourceRuntimeId, preview)
            ?? Promise.resolve({ ok: false, reason: 'blocked' as const }),
        },
        feedback: {
          notifyAdrenalineInsufficientShot: () => this.playerStatusRing?.notifyAdrenalineInsufficientShot(),
          flashUltimateInsufficientRage: () => this.ctx.centerHUD.flashUltimateInsufficientRage(),
          flashUtilityCooldown: (fraction, displayName) => this.ctx.centerHUD.flashUtilityCooldown(fraction, displayName),
          showPlacementError: (message) => this.placementPreview.showPlacementError(message),
        },
      },
      onFlowFieldDebugHotkey: (type: ArenaInputDebugHotkey) => this.handleFlowFieldDebugHotkey(type),
      hotkeys: {
        getGamePhase: () => bridge.getGamePhase(),
        isMatchTerminated: () => this.lifecycle.isMatchTerminated(),
        isCoopDefenseMode: () => isCoopDefenseMode(bridge.getGameMode()),
        canLeaveLocalLobbyWorld: () => this.canLeaveLocalLobbyWorld(),
        requestLocalLobbyWorldLeave: () => this.requestLocalLobbyWorldLeave(),
        isHotkeyInputBlocked: () => this.ctx.leftPanel.isHotkeyInputBlocked(),
        isHelpOverlayOpen: () => this.ctx.leftPanel.isHelpOverlayOpen(),
        hideHelpOverlay: () => this.ctx.leftPanel.hideHelpOverlay(),
        isOptionsOverlayOpen: () => this.ctx.leftPanel.isOptionsOverlayOpen(),
        hideOptionsOverlay: () => this.ctx.leftPanel.hideOptionsOverlay(),
        toggleOptionsOverlay: () => this.ctx.leftPanel.toggleOptionsOverlay(),
        isCoopDefenseUpgradesOpen: () => this.coopDefenseUpgradesOverlay?.isOpen() ?? false,
        hideCoopDefenseUpgrades: () => this.coopDefenseUpgradesOverlay?.hide(),
        isCoopDefenseDebugOpen: () => this.coopDefenseDebugOverlay?.isOpen() ?? false,
        hideCoopDefenseDebug: () => this.coopDefenseDebugOverlay?.hide(),
        toggleCoopDefenseDebug: () => this.coopDefenseDebugOverlay?.toggle(),
        isItemsOpen: () => this.itemsOverlay?.isOpen() ?? false,
        hideItems: () => this.itemsOverlay?.hide(),
        isItemRewardVisible: () => this.itemRewardOverlay?.isVisible() ?? false,
        hideItemReward: () => this.itemRewardOverlay?.hide(),
        isMatchResultsVisible: () => this.matchResultsOverlay?.isVisible() ?? false,
        hideMatchResults: () => this.matchResultsOverlay?.hide(),
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
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      inputBindings.destroy();
      if (this.inputBindings === inputBindings) this.inputBindings = null;
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.lobbyOverlay?.destroy();
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
      this.hostileBaseIndicator?.destroy();
      this.hostileBaseIndicator = null;
      // Der Ring lebt so lange wie die Szene. Ohne diesen Aufruf bliebe seine
      // Qualitaets-Subscription im szenenuebergreifenden GraphicsQualityController haengen.
      this.playerStatusRing?.destroy();
      this.playerStatusRing = null;
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
    bridge.sendPingToHost();
    this.time.addEvent({ delay: 1000, callback: () => bridge.sendPingToHost(), loop: true });
    this.initializeRoomQuality();
    this.meta?.refresh();
    this.meta?.applyDefaultCoopDefenseMapSelection();
    this.lastObservedGamePhase = bridge.getGamePhase();

    // Der Bootscreen weicht nicht dem ersten Frame, sondern der fertigen Lobby; `syncBootReveal`
    // entscheidet das am Frame-Ende. Die Frist ist nur der Notausgang.
    this.bootRevealDeadlineMs = this.time.now + BOOT_REVEAL_TIMEOUT_MS;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      BootScreen.dismissImmediate();
    });
  }

  update(_time: number, delta: number): void {
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

    const phase           = bridge.getGamePhase();
    const deferArenaExit  = this.weaponBalanceLabPreviousMapId === null
      && this.syncArenaExitFade(phase);
    this.lifecycle.detectPhaseChange(deferArenaExit);
    // Eine World ohne Activity haengt an keinem Phasenwechsel; sie entsteht und vergeht mit
    // ihrem eigenen Kanal. Der Host haelt waehrend der Lobby genau eine LobbyWorld offen; jeder
    // Peer baut sie danach ueber denselben Kanal wie jede Match-World. Waehrend des lokalen
    // Arena-Exit-Fades bleibt nur die freigegebene Match-Presentation sichtbar; ihre Runtime ist
    // bereits vollstaendig beendet.
    if (!deferArenaExit) this.lifecycle.hostSyncLobbyWorld();
    // Jeder Peer bietet seinen persoenlichen Basisbeitrag an und uebernimmt, was der Host ihm
    // bestaetigt hat. Beides haengt am Raum, nicht an Phase oder Runde.
    this.arenaRuntime.syncRoomOwners();
    this.lifecycle.detectWorldChange(deferArenaExit);
    // Erst steht fest, welche World lokal laeuft - dann taktet ihre Runtime. Sie taktet nur die
    // eigenen Child-Owner; Rundenphase und Rolle entscheiden darueber nichts.
    this.arenaRuntime.update(delta);
    if (!deferArenaExit && phase === 'LOBBY') this.arenaExitFadeOverlay?.hide();
    const configuredPhase = deferArenaExit ? 'ARENA' : phase;
    const configuredGameMode = this.resolveConfiguredGameMode(configuredPhase);
    const configuredCoopDefenseMapId = isCoopDefenseMode(configuredGameMode)
      ? this.resolveConfiguredCoopDefenseMapId(configuredPhase)
      : null;
    const enteredLobbyFromArena = !deferArenaExit
      && this.lastObservedGamePhase === 'ARENA'
      && phase === 'LOBBY';
    const returningFromWeaponBalanceLab = enteredLobbyFromArena
      && this.weaponBalanceLabPreviousMapId !== null;
    if (returningFromWeaponBalanceLab) this.restoreMapAfterWeaponBalanceLab();
    const inGame          = phase === 'ARENA';
    const countdownVisible = bridge.isArenaCountdownVisible();
    const arenaLoading    = bridge.isArenaLoading();
    const arenaStarted    = bridge.isArenaStarted();
    const arenaVisible    = countdownVisible || deferArenaExit;
    const countdownActive = bridge.isArenaCountdownActive();
    const terminated      = this.lifecycle.isMatchTerminated();
    const gameplayActive  = inGame && arenaStarted && !terminated;
    const weaponBalanceLabArena = inGame
      && configuredCoopDefenseMapId !== null
      && isWeaponBalanceLabMapId(configuredCoopDefenseMapId);
    const optionsOpen     = this.ctx?.leftPanel.isOptionsOverlayOpen() ?? false;
    // Teilnahme haengt an der World, nicht an der Rundenphase - deshalb steht der Abgleich
    // ausdruecklich vor und unabhaengig von der Rundenrolle. Ohne Activity taktet niemand den
    // Eintritt: dort folgt die Runtime unmittelbar der Aufnahme.
    this.lifecycle.hostSyncWorldMembers();
    this.lifecycle.hostSyncWorldParticipation();
    this.lifecycle.syncRoundParticipation();
    const spectator = inGame && (this.localPlayerState.spectator || bridge.isLocalSpectator());
    const worldActive = this.world !== null && this.world !== undefined;
    const activityActive = bridge.getActivityDescriptor() !== null;
    const exitPresentationActive = deferArenaExit && this.lifecycle.isArenaExitPresentationActive();
    const localWorldPresentation = this.lifecycle.getLocalWorldPresentation();
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
    this.arenaRuntime.syncWorldCamera(delta, presentationPolicy.showWorld);
    // Direkt nach der Kamera und vor allem Weiteren: Die gestreamten Bodenbaender und
    // Fels-Overlays halten nur Renderziele um den sichtbaren Ausschnitt herum. Der
    // Sicherheitsrand deckt den Kamera-Feedback-Versatz mit ab, der erst am Frame-Ende
    // dazukommt.
    if (presentationPolicy.showWorld) {
      this.arenaRuntime.syncWorldSurfaceResidency(presentationPolicy.showWorld);
    }
    // Der Owner loest die zentrale Policy auf und taktet den vorhandenen InputSystem; die Scene
    // liefert nur den bereits orchestrierten World-/Round-/UI-Framekontext.
    this.inputBindings?.updateFrame({
      enabled: worldActive && localWorldPresentation.required,
      gameplayActive: worldActive && (!activityActive || gameplayActive),
      countdownActive,
      uiBlocking: optionsOpen,
      diagnosticsArena: weaponBalanceLabArena,
    });
    if (worldActive && localWorldPresentation.required && countdownActive) {
      this.syncCountdownPlayerPresentation();
    }
    diagnosticsFrame?.mark('inputEnd');

    if (phase !== 'LOBBY' || deferArenaExit) this.roomStatisticsOverlay?.hide();
    // Weltlicht der Lobby haengt an der Raumphase, nicht an der Oberflaeche: wer den
    // das Testgelaende betritt, sieht dieselbe host-autoritative Uhrzeit wie alle anderen.
    if (!terminated && phase === 'LOBBY' && !deferArenaExit) this.lifecycle.syncLobbyTimeOfDay();
    // Die Oberflaeche folgt der Presentation. Ein technischer Abbruch fuehrt sie selbst zurueck
    // und darf hier nicht ueberschrieben werden.
    if (!terminated) this.lifecycle.syncLobbySurface(presentationPolicy.showLobby);
    // Der Live-Build bleibt auch im interaktiven Testgelaende sichtbar. Er ist absichtlich kein
    // Ready-Commit und wird deshalb unabhaengig davon pro Lobby-Frame publiziert.
    if (!terminated && phase === 'LOBBY' && !deferArenaExit) {
      bridge.setLocalLobbyLoadoutPreview(this.buildLocalLobbyLoadoutPreview());
    }
    this.lobbyOverlay.setWorldEntryState(
      this.lifecycle.canSelfAdmitToWorld()
        ? {
          inside: this.lifecycle.isLocalWorldParticipant(),
          canEnter: bridge.getPlayerReady(bridge.getLocalPlayerId()) === false,
        }
        : null,
    );
    if (!terminated && presentationPolicy.showLobby) {
      diagnosticsFrame?.begin('lobbyUi');
      if (enteredLobbyFromArena && !returningFromWeaponBalanceLab) this.meta?.beginMatchResults();
      if (this.meta?.isMatchResultsPending()) {
        this.meta.tryFinalizeMatchResults({
          finalizeBalanceRound: (roundEndedAt) => {
            this.coopDefenseBalanceTracker.finalizePendingRound(roundEndedAt);
            return this.coopDefenseBalanceTracker.hasRound(roundEndedAt);
          },
        });
      }
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
      this.lobbyOverlay.refreshPlayerList(players);
      const roundResults = bridge.getRoundResults();
      const roomStatistics = bridge.getRoomPlayerStatistics();
      this.ctx.rightPanel.showRoomStatistics(roomStatistics);
      this.ctx.rightPanel.setRoomStatisticsDetailAvailable(roomStatistics.length > 0);
      this.ctx.rightPanel.showRoundResults(
        bridge.isLocalRoundResultEligible(roundResults) ? roundResults : null,
        bridge.getRoundState(),
      );
      this.meta?.refreshLobbyProjection();
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
      diagnosticsFrame?.end('lobbyUi');
    } else {
      this.coopDefenseDebugOverlay?.hide();
      this.coopDefenseUpgradesOverlay?.hide();
      this.meta?.refreshLobbyProjection(false);
      this.lastLobbySidebarSignature = null;
    }

    if (!deferArenaExit) this.lastObservedGamePhase = phase;
    diagnosticsFrame?.mark('sceneStateEnd');

    // Same-Mode-Live-Builds bleiben in derselben LobbyWorld reconciled. Ein vollstaendiger
    // GameMode-Wechsel wurde davor bereits als neue World-Instanz orchestriert.
    if (worldActive && bridge.isHost() && !terminated) {
      this.lifecycle.syncHostLoadoutsFromCommittedSelections();
    }

    if (worldActive && !activityActive && !terminated) {
      diagnosticsFrame?.begin('primaryStep');
      if (bridge.isHost()) this.arenaRuntime.runHostFrame(delta);
      else {
        this.arenaRuntime.runClientFrame(delta);
        const clientState = bridge.getLatestGameState();
        this.syncClientActivitySnapshotPresentation(clientState);
        this.arenaRuntime.syncWorldClientPresentation(
          clientState,
          delta,
          false,
          { cells: [] },
          this.powerUpSystem?.getPedestalSnapshot() ?? [],
        );
      }
      diagnosticsFrame?.end('primaryStep');
    }

    if ((gameplayActive || countdownActive) && !terminated) {
      diagnosticsFrame?.begin('arenaHud');
      const secs = bridge.computeSecondsLeft();
      const activeMapConfig = configuredCoopDefenseMapId !== null
        ? getCoopDefenseMapConfig(configuredCoopDefenseMapId)
        : null;
      this.ctx.centerHUD.updateTimer(
        secs,
        activeMapConfig === null || activeMapConfig.objective === 'survive',
      );

      // Train widget: Das Zug-Event selbst entscheidet, ob etwas anzuzeigen ist – Maps mit
      // Gleisen ohne Zug und Runden ohne weitere Einfahrt haben schlicht kein Event.
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
      diagnosticsFrame?.end('arenaHud');

      if (bridge.isHost()) {
        diagnosticsFrame?.begin('primaryStep');
        this.weaponBalanceLabRuntime.update(phase, gameplayActive, delta);
        if (isCoopDefenseMode(configuredGameMode)
          && this.inputBindings?.isCoopDefenseDebugDamageJustDown()
          && !this.ctx.leftPanel.isHotkeyInputBlocked()
          && !countdownActive) {
          this.arenaRuntime.applyDebugBaseDamage(50);
        }
        const coopRoundOutcome = this.arenaRuntime.runHostFrame(delta, gameplayActive);
        if (coopRoundOutcome) {
          // Die Momentaufnahme der Runde entsteht vor ihrem Abschluss: `hostCompleteRound()`
          // beendet die World-Instanz, und danach gibt es weder Basen noch Spielerzustand.
          this.prepareCoopDefenseBalanceRound(coopRoundOutcome);
          this.lifecycle.hostCompleteRound(coopRoundOutcome);
        } else if (!isCoopDefenseMode(configuredGameMode) && !countdownActive && secs <= 0) {
          this.lifecycle.hostCompleteRound();
        }
        diagnosticsFrame?.end('primaryStep');
      } else {
        diagnosticsFrame?.begin('primaryStep');
        this.arenaRuntime.runClientFrame(delta);

        // Sync renderers that HostUpdateCoordinator handles for host but client needs too
        diagnosticsFrame?.begin('clientRendererSync');
        const clientState = bridge.getLatestGameState();
        this.syncClientActivitySnapshotPresentation(clientState);
        this.arenaRuntime.syncWorldClientPresentation(
          clientState,
          delta,
          countdownActive,
          countdownActive && activeMapConfig
            ? buildCountdownGroundFirePreview(
              this.currentLayout,
              activeMapConfig,
              bridge.getArenaStartTime(),
            )
            : { cells: [] },
          this.powerUpSystem?.getPedestalSnapshot() ?? [],
        );
        diagnosticsFrame?.end('clientRendererSync');
        diagnosticsFrame?.end('primaryStep');
      }

      const transitionCompleted = this.lifecycle.syncRuntimeTimeOfDay(
        bridge.getSynchronizedNow(),
        this.resolveArenaTimeOfDaySignals(),
      );
      this.arenaRuntime.requestWorldStaticShadowBake(transitionCompleted);

      diagnosticsFrame?.begin('leaderboardCanopy');
      if (gameplayActive && this.inputBindings?.isArenaPanelHeld()) {
        this.ctx.rightPanel.updateLeaderboard(this.hostUpdate.getLeaderboardEntries());
      }
      diagnosticsFrame?.end('leaderboardCanopy');
    }

    // Baumkronen haengen an der Darstellung, nicht an der Runde: der Abgleich ist rein lokal und
    // kennt weder Activity noch Rundenphase. Deshalb blenden sie ueber der eigenen Figur auch in
    // der LobbyWorld aus. Ohne eigene Figur - reine Preview - bleiben sie deckend.
    if (presentationPolicy.showWorld) {
      diagnosticsFrame?.begin('leaderboardCanopy');
      this.arenaRuntime.syncWorldCanopy(presentationPolicy.showWorld);
      diagnosticsFrame?.end('leaderboardCanopy');
    }

    diagnosticsFrame?.begin('arenaPanel');
    this.syncArenaPanelOverlayState(gameplayActive && !terminated);
    diagnosticsFrame?.end('arenaPanel');

    diagnosticsFrame?.mark('visualStart');

    // ── Per-frame visuals (always) ─────────────────────────────────────────
    // Der GPU-Partikel-Tick haengt bewusst nicht am Zustands-Sync: auf Clients laufen die
    // Renderer-Syncs nur mit frischem Netzzustand, die bisherigen Emitter liefen dagegen
    // autonom weiter. Erst stilllegen, dann emittieren – die Registry garantiert die Reihenfolge.
    this.renderers.gpuVfx.update(delta);
    const inArena = presentationPolicy.showWorld;
    // Eine Preview zeigt die Welt, ohne dass dieser Peer in ihr steht. Zielhilfe, Systemcursor
    // und Platzierungsvorschau gehoeren deshalb der interaktiven Darstellung, nicht der blossen
    // Sichtbarkeit.
    const worldInteractive = presentationPolicy.worldMode === 'interactive';
    // Und Rundenpraesentation - Missionsansagen, Encounter, Zug, strategische Ziele - haengt
    // zusaetzlich an der Activity: interaktiv zu spielen heisst nicht, dass eine Runde laeuft.
    const inRoundWorld = worldInteractive && activityActive;
    const strategicTargets = bridge.isHost()
      ? (this.playerSystems?.ak47StrategicTarget?.getNetSnapshot(bridge.getSynchronizedNow()) ?? [])
      : (bridge.getLatestGameState()?.ak47StrategicTargets ?? []);
    this.renderers.ak47StrategicTargets.sync(
      strategicTargets,
      this.enemyManager,
      bridge.getLocalPlayerId(),
      bridge.getSynchronizedNow(),
      inRoundWorld && isCoopDefenseMode(configuredGameMode),
    );
    // Beim Spectator ist die Kamera bereits vor dem Netzwerk-/Render-Schritt fortgeschrieben;
    // der zweite normale Sync-Punkt darf die A/D-Geschwindigkeit nicht verdoppeln.
    // Keep the camera active while the arena is hidden behind the loading veil. Its position is
    // part of the local startup working set and must not be reset to the lobby origin before the
    // readiness check at the end of the frame.
    this.arenaRuntime.syncWorldCamera(spectator ? 0 : delta, presentationPolicy.showWorld);
    const coopDefensePresentationActive = inRoundWorld && isCoopDefenseMode(configuredGameMode);
    const presentationMapConfig = coopDefensePresentationActive
      ? getCoopDefenseMapConfig(configuredCoopDefenseMapId!)
      : null;
    const encounterPresentation = coopDefensePresentationActive
      ? bridge.getCoopDefenseEncounterPresentationState()
      : null;
    const secondaryObjectivesActive = coopDefensePresentationActive;
    const secondaryObjectivePresentation = secondaryObjectivesActive
      ? bridge.getCoopDefenseSecondaryObjectivePresentationState()
      : null;
    const encounterElapsedMs = bridge.getSynchronizedNow() - bridge.getArenaStartTime();
    const missionProgressPresentation = coopDefensePresentationActive
      ? bridge.getCoopDefenseMissionProgressPresentationState()
      : null;
    this.arenaRuntime.syncCoopMissionPresentation(delta, coopDefensePresentationActive);
    this.renderers.encounterTelegraph.sync(encounterPresentation, encounterElapsedMs, inArena);
    this.renderers.secondaryObjectiveMarkers.sync(
      secondaryObjectivePresentation,
      (this.coopMissionRuntime?.secondaryObjectiveConfigs ?? []),
      this.baseManager,
      this.coopDefenseCarryPresentationItems,
      secondaryObjectivesActive,
    );
    this.renderers.missionProgress.sync(
      presentationMapConfig ? resolveCoopDefenseMapMissionProgress(presentationMapConfig) : undefined,
      missionProgressPresentation,
      coopDefensePresentationActive,
    );
    this.renderers.carryZones.sync(
      secondaryObjectivePresentation,
      (this.coopMissionRuntime?.secondaryObjectiveConfigs ?? []),
      secondaryObjectivesActive,
    );
    this.renderers.objectiveRepairDrones.sync(
      secondaryObjectivePresentation,
      (this.coopMissionRuntime?.secondaryObjectiveConfigs ?? []),
      this.baseManager,
      encounterElapsedMs,
      secondaryObjectivesActive,
    );
    this.syncSpectatorPlayerNames(inArena);
    if (coopDefensePresentationActive) {
      this.hostileBaseIndicator?.sync(
        this.baseManager,
        this.enemyManager,
        presentationMapConfig,
        true,
      );
    } else {
      this.hostileBaseIndicator?.clear();
    }
    this.arenaRuntime.syncWorldLocalPlayerPresentation(inArena, spectator);
    if (inArena) {
      this.enemyHoverNameLabel?.sync(this.getEnemyHoverNameTarget());
    } else {
      this.enemyHoverNameLabel?.clear(true);
    }
    // Loading uses the full-screen veil even though the arena itself is still hidden; once the
    // authoritative countdown timestamp exists, the same overlay switches to 3 → 2 → 1.
    this.syncArenaFogOverlay(bridge.getSynchronizedNow(), inGame && !terminated, countdownActive);
    diagnosticsFrame?.mark('visualCameraEnd');

    this.renderers.beer.update(bridge.getSynchronizedNow(), delta);
    this.renderers.timeBubble.update(delta);
    this.renderers.blackHole.update(delta);
    this.renderers.bfg.update();
    this.renderers.plasmaBurner.update(delta);
    // Nach dem Positionsabgleich der Entities: die Trefferkopien führen ihre Ziele nach.
    this.visualFeedback?.update(delta);
    // Host und Client halten denselben Feldbestand, deshalb genuegt ein Sync-Punkt.
    this.renderers.reinforcementMatrix.syncVisuals(
      inArena ? (this.targetingSystems?.reinforcementMatrix?.getActiveMatrices() ?? []) : [],
      bridge.getSynchronizedNow(),
    );
    this.renderers.energyInjector.syncVisuals(
      inArena ? (this.targetingSystems?.energyInjector?.getActiveEffects() ?? []) : [],
      bridge.getSynchronizedNow(),
    );
    const remoteControlTargets = !inArena
      ? []
      : bridge.isHost()
        ? (this.playerSystems?.itemRuntime?.getRemoteControlSnapshot(
          this.ctx.playerManager.getAllPlayers().map((player) => player.id),
          this.combatSystems?.turret?.getTurrets() ?? [],
        ) ?? [])
        : (bridge.getLatestGameState()?.remoteControlTurrets ?? []);
    this.renderers.remoteControl.syncVisuals(remoteControlTargets, bridge.getSynchronizedNow());
    this.renderers.teslaDome.update(delta);
    this.renderers.teslaNova.update();
    diagnosticsFrame?.begin('visualEnemy');
    const auraEnemies = inArena ? (this.enemyManager?.getAllEnemies() ?? []) : [];
    this.enemyManager?.syncHostVisuals();
    diagnosticsFrame?.end('visualEnemy');
    this.renderers.healingAura.syncEnemies(auraEnemies);
    this.renderers.healingAura.update(delta);
    this.renderers.miniTeslaDome.syncEnemies(auraEnemies);
    this.renderers.miniTeslaDome.update(delta);
    this.renderers.energyShield.update(delta);
    this.renderers.guardianSpirit.update(delta);
    this.renderers.repairDrone.update(delta);
    this.renderers.slimeTrail.update(delta);
    this.renderers.flamethrowerUpgrades.update(bridge.getSynchronizedNow());
    diagnosticsFrame?.mark('visualEffectsEnd');

    diagnosticsFrame?.begin('aimPreview');
    const utilityTargeting    = inArena && !spectator ? this.ctx.inputSystem.getUtilityTargetingPreviewState() : undefined;
    const airstrikeTargeting  = inArena && !spectator ? this.ctx.inputSystem.getAirstrikeTargetingPreviewState() : undefined;
    const utilityPlacement    = inArena && !spectator ? this.inputBindings?.getLocalPlacementPreview() : undefined;
    const ultimatePlacement   = inArena && !spectator ? this.inputBindings?.getLocalUltimatePlacementPreview() : undefined;
    const constructionPlacement = inArena && !spectator
      ? this.ctx.inputSystem.getConstructionPlacementPreviewState()
      : undefined;
    const activePlacement     = ultimatePlacement ?? utilityPlacement ?? constructionPlacement;
    this.arenaRuntime.syncWorldPersistentBasePresentation(inArena, spectator);
    const ultimatePreview     = inArena && !spectator ? this.ctx.inputSystem.getUltimateChargePreviewState() : undefined;
    const aimPresentation = this.inputBindings?.getAimPresentationState(worldInteractive, spectator, optionsOpen)
      ?? { aimVisible: false, cursorVisible: false };
    const showAim = aimPresentation.aimVisible;
    const scopeProgress = this.ctx.inputSystem.getScopeProgress();
    diagnosticsFrame?.end('aimPreview');
    diagnosticsFrame?.begin('aimGraphics');
    this.ctx.aimSystem?.setScopeProgress(scopeProgress);
    this.ctx.aimSystem?.setScoping(this.ctx.inputSystem.isScoping());
    this.ctx.aimSystem?.setWeaponChargeProgress(this.ctx.inputSystem.getScopeChargeProgress());
    const targetingForReticle = utilityTargeting ?? airstrikeTargeting;
    this.ctx.aimSystem?.update(
      (showAim || targetingForReticle !== undefined) && aimPresentation.cursorVisible,
      // Das Fadenkreuz ersetzt den Systemcursor genau dort, wo es die Zielhilfe gibt. Eine
      // Preview hat keine: ueber der LobbyWorld bleibt der normale Cursor sichtbar.
      aimPresentation.cursorVisible,
      delta,
      optionsOpen ? undefined : targetingForReticle,
      optionsOpen ? undefined : ultimatePreview,
    );
    diagnosticsFrame?.end('aimGraphics');

    // Scope-Overlay (Sichtverdunkelung bei AWP und anderen Scope-Waffen)
    diagnosticsFrame?.begin('scope');
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
    diagnosticsFrame?.end('scope');

    diagnosticsFrame?.begin('aimIndicators');
    this.utilityChargeIndicator?.update(inArena && !spectator ? this.ctx.inputSystem.getUtilityChargePreviewState() : undefined);
    this.ultimateChargeIndicator?.update(ultimatePreview);
    diagnosticsFrame?.end('aimIndicators');
    diagnosticsFrame?.mark('visualAimEnd');

    this.gaussWarning.update(inArena);
    this.placementPreview.syncUtilityTargetingHint(inArena, utilityTargeting !== undefined, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.syncAirstrikeTargetingHint(inArena, airstrikeTargeting !== undefined, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.syncPlaceableUtilityHint(inArena, activePlacement, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.renderPlacementPreview(inArena, activePlacement, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.renderRemotePlacementPreviews(inArena);
    const tunnelSnapshot = bridge.isHost()
      ? (this.playerSystems?.tunnel?.getSnapshot() ?? [])
      : (bridge.getLatestGameState()?.tunnels ?? []);
    this.tunnelRenderer.sync(inArena ? tunnelSnapshot : []);
    this.tunnelRenderer.update(this.time.now);

    diagnosticsFrame?.mark('visualEnd');

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

    diagnosticsFrame?.begin('shadow');
    // Keep World-scoped static shadows alive while the arena is hidden behind the loading veil;
    // clearing them here would destroy the startup surface before the load barrier can observe it.
    const shadowArenaActive = inArena || (inGame && !terminated);
    this.arenaRuntime.syncWorldShadows(shadowArenaActive, inRoundWorld);
    diagnosticsFrame?.end('shadow');
    this.arenaRuntime.syncWorldLighting(inArena, inRoundWorld);

    // Erst jetzt, nachdem alle drei Schichten und moegliche Dirty-Wellen des Frames ihre Arbeit
    // eingereiht haben: ein gemeinsames kleines Budget statt eines separaten Vollbakes je Layer.
    // Das grosszuegige Budget gilt, solange ein deckender Ladescreen davor steht - in der Arena
    // ihr eigener Schleier, beim Start der Bootscreen.
    ChunkedRenderSurface.flushBakeBudget(
      this,
      arenaLoading || this.bootRevealPending ? CHUNK_BAKE_STARTUP_FRAME_BUDGET_MS : undefined,
    );
    if (inGame && !terminated) {
      this.lifecycle.syncArenaLoadReady(getVisibleWorldView(this.cameras.main));
    }
    // Ganz am Ende des Frames: die Barriere sieht damit eine vollstaendig aufgebaute Lobby
    // inklusive ihres UI-Durchlaufs, nicht einen halb aufgebauten Zwischenstand.
    if (this.bootRevealPending) this.syncBootReveal(phase);

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
        ? configuredCoopDefenseMapId
        : isCoopDefenseMode(diagnosticMode)
          ? this.resolveConfiguredCoopDefenseMapId(phase)
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
        utilityPlacementActive: utilityPlacement !== undefined,
        ultimatePlacementActive: ultimatePlacement !== undefined,
        optionsOpen,
        enemyCount: this.enemyManager?.getAllEnemies().length ?? 0,
        projectileCount: this.ctx.projectileManager.getDebugActiveProjectileCount(),
        playerCount: this.ctx.playerManager.getAllPlayers().length,
      };
      this.diagnostics?.endFrame(diagnosticsInput);
    }
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
    this.lifecycle.handleGuestSessionOwnerRemoved(id);
    if (this.ctx.playerManager.hasPlayer(id)) {
      this.lifecycle.removePlayerFromActiveRound(id);
    }
    if (bridge.getGamePhase() === 'ARENA' && id === bridge.getMatchHostId()) {
      this.lifecycle.terminateMatch();
    }
  }

  // ── Lobby callbacks ───────────────────────────────────────────────────────

  private startWeaponBalanceLab(request: RuntimeBenchmarkRequest): WeaponBalanceLabStartResult {
    if (bridge.getGamePhase() !== 'LOBBY' || !isCoopDefenseMode(bridge.getGameMode())) {
      return { ok: false, message: 'Das Testgelände kann nur in der Coop-Defense-Lobby starten.' };
    }
    if (!bridge.isHost()) return { ok: false, message: 'Nur der Host kann das Testgelände starten.' };
    if (bridge.getConnectedPlayers().length !== 1) {
      return { ok: false, message: 'Balance Lab 2.0 ist zunächst ausschließlich für Solo-Hosts verfügbar.' };
    }
    if (this.lifecycle.getIsLocalReady() || bridge.getPlayerReady(bridge.getLocalPlayerId())) {
      return { ok: false, message: 'Vor dem Testgelände muss der Spieler nicht bereit sein.' };
    }
    if (this.roomQualityMonitor.shouldBlockStart()) {
      return { ok: false, message: 'Der normale Startschutz blockiert den Rundenstart momentan.' };
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
      this.lifecycle.setIsLocalReady(true);
      return { ok: true };
    } catch (error) {
      this.weaponBalanceLabRuntime.cancel();
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Der neutrale Waffen-Build ist ungültig.',
      };
    }
  }

  private restoreMapAfterWeaponBalanceLab(): void {
    const previousMapId = this.weaponBalanceLabPreviousMapId;
    this.weaponBalanceLabPreviousMapId = null;
    this.weaponBalanceLabRuntime.cancel();
    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    if (previousMapId && bridge.isHost()) bridge.setCoopDefenseMapId(previousMapId);
  }

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
      if (this.weaponBalanceLabRuntime.isActive() && isWeaponBalanceLabMapId(bridge.getCoopDefenseMapId())) {
        this.restoreMapAfterWeaponBalanceLab();
      }
    }
    this.lifecycle.setIsLocalReady(nowReady);
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
      tools: classId === 'inspector_gadachs'
        ? (profile?.toolLoadout ?? []).map((tool) => ({ ...tool }))
        : [],
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
    }, bridge.getGameMode(), build.coopDefenseProfile, build.coopDefenseClassId);
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
    this.lifecycle.requestLocalWorldParticipation(false);
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
    this.arenaRuntime.syncWorldStaticShadowProfile(forceStaticBake);
  }

  private resolveArenaTimeOfDaySignals(): {
    bossSpawnedAtMs: number | null;
    bossPhase: number;
  } {
    const observedPhase = this.enemyManager?.getMaxBossPhase() ?? 0;
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

    const service = type === 'flowfield_players'
      ? this.coopMissionRuntime?.enemyPlayerFlowFieldService
      : this.coopMissionRuntime?.enemyFlowFieldService;
    if (!service) return;

    if (!this.flowFieldDebugOverlay) {
      console.log('[ArenaScene] Creating EnemyFlowFieldDebugOverlay');
      this.flowFieldDebugOverlay = new EnemyFlowFieldDebugOverlay(this, service);
    }

    console.log(`[ArenaScene] Showing ${type} overlay`);
    this.flowFieldDebugOverlay.showForService(service);
  }

  private syncArenaPanelOverlayState(inArena = bridge.getGamePhase() === 'ARENA' && !this.arenaRuntime?.flow.isMatchTerminated()): void {
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
    const worldMetrics = this.world?.metrics ?? null;
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
    this.ctx?.combatSystem.setWorldMetrics(worldMetrics);
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

  /** Synchronisiert nur die activity-spezifische Client-Presentation dieser World. */
  private syncClientActivitySnapshotPresentation(state: GameState | undefined): void {
    if (!this.lifecycle.getLocalWorldPresentation().required) return;
    if (!state) return;
    this.captureTheBeerSystem?.syncSnapshot(state.captureTheBeer ?? null);
    this.renderers.beer.sync(state.captureTheBeer?.beers ?? []);
    this.replicatedCoopDefenseCarryItems = state.coopDefenseCarry ?? [];
    this.renderers.beer.syncCoopDefenseCarry(this.replicatedCoopDefenseCarryItems);
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
    const worldMode = inArena ? this.resolveConfiguredGameMode('ARENA') : bridge.getGameMode();
    const mapId = inArena && isCoopDefenseMode(worldMode)
      ? this.resolveConfiguredCoopDefenseMapId('ARENA')
      : null;
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
      isVoidMap: mapId !== null && getCoopDefenseMapConfig(mapId).trackMode === 'void-fire',
      bossVisualProfile: inArena && mapId === '15' ? 'void-hunter' : undefined,
      bossPhase: inArena ? (this.enemyManager?.getMaxBossPhase() ?? 0) : 0,
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
    if (this.world) return this.world.metrics.gridCols;
    return getCoopDefenseMapConfig(this.resolveConfiguredCoopDefenseMapId(phase)).arenaWidthCells;
  }

  private resolveCoopDefenseArenaHeightCells(phase = bridge.getGamePhase()): number | undefined {
    if (!isCoopDefenseMode(this.resolveConfiguredGameMode(phase))) return undefined;
    if (this.world) return this.world.metrics.gridRows;
    return getCoopDefenseMapConfig(this.resolveConfiguredCoopDefenseMapId(phase)).arenaHeightCells;
  }

  /** Active Activities use their immutable descriptor; the Lobby value is pre-World only. */
  /**
   * Die World, die den Rundeninhalt beschreibt – oder `null`.
   *
   * Die LobbyWorld ist ausdruecklich keine: sie steht *neben* der Lobby-Auswahl, nicht an ihrer
   * Stelle. Waehrend sie laeuft, beantworten Modus und Map weiterhin die Lobby.
   */
  private resolveRoundWorldDescriptor(phase = bridge.getGamePhase()): WorldDescriptor | null {
    if (!this.world && phase !== 'ARENA') return null;
    const descriptor = this.world?.descriptor ?? bridge.getWorldDescriptor();
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

  /** Active Worlds use their definition id; the Lobby map is only a creation input. */
  private resolveConfiguredCoopDefenseMapId(phase = bridge.getGamePhase()): string {
    const descriptor = this.resolveRoundWorldDescriptor(phase);
    if (descriptor) {
      const mapId = toMapId(descriptor.definitionId);
      if (mapId === null) throw new Error('[ArenaScene] Active World has no Coop-Defense map');
      return mapId;
    }
    return bridge.getCoopDefenseMapId();
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
   * noch aufbaut. Erst wenn der sichtbare Ausschnitt vollstaendig steht, faellt der Bootscreen -
   * und der Auftritt des Lobby-Panels beginnt danach, nicht in seinen Fade hinein.
   */
  private syncBootReveal(phase: GamePhase): void {
    // Wer mitten in eine laufende Partie kommt, bekommt den eigenen Ladeschleier der Arena;
    // die Lobby-Barriere hat dort nichts zu halten.
    const reveal = phase === 'LOBBY'
      ? this.lifecycle.getWorldRevealState(getVisibleWorldView(this.cameras.main))
      : { ready: true, progress: 100 };
    if (!reveal.ready && this.time.now < this.bootRevealDeadlineMs) {
      const share = Phaser.Math.Clamp((reveal.progress - 70) / 30, 0, 1);
      BootScreen.setProgress(
        BOOT_PRELOAD_PROGRESS_SHARE + (1 - BOOT_PRELOAD_PROGRESS_SHARE) * share,
      );
      return;
    }
    this.bootRevealPending = false;
    BootScreen.setProgress(1);
    void BootScreen.fadeOut().then(() => this.lobbyOverlay?.playEntrance());
  }

  /**
   * Haelt den sichtbaren Lobby-Uebergang, waehrend World-/Activity-Gameplay bereits beendet ist.
   * Nur World-Presentation und eingefrorene Player-/Enemy-Snapshots bleiben bis zum Fade-Ende.
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
      this.lifecycle.beginArenaExitPresentation();
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
    const gameMode = this.resolveConfiguredGameMode('ARENA');
    if (!isCoopDefenseMode(gameMode)) return;
    const roundState = bridge.getRoundState();
    if (!roundState || roundState.coopDefenseHumanPlayerCount !== 1) return;
    const localPlayerId = bridge.getLocalPlayerId();
    const localPlayerState = this.ctx.combatSystem;
    const ownMainBases = this.baseManager?.getMainBasesByFaction('friendly') ?? [];
    const hostileMainBases = this.baseManager?.getMainBasesByFaction('hostile') ?? [];
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
    const storedProgress = this.meta!.getStoredProgress();
    const committed = bridge.getPlayerCommittedLoadout(localPlayerId);
    this.coopDefenseBalanceTracker.preparePendingRound({
      gameMode,
      roundState,
      mapConfig: getCoopDefenseMapConfig(this.resolveConfiguredCoopDefenseMapId('ARENA')),
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
    if (!roundEndedAt || !this.coopDefenseBalanceTracker.hasRound(roundEndedAt)) return;
    this.coopDefenseBalanceReportOverlay?.showFeedback(roundEndedAt);
  }
}
