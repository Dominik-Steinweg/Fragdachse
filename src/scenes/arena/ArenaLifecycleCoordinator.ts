import type Phaser from 'phaser';
import { bridge }            from '../../network/bridge';
import { ArenaBuilder } from '../../arena/ArenaBuilder';
import { ArenaGenerator, ARENA_GENERATOR_VERSION, resolveArenaGenerationInput } from '../../arena/ArenaGenerator';
import { TerrainColorSnapshotBuilder } from '../../arena/TerrainColorSnapshotBuilder';
import type { WorldViewRect } from '../../ui/HostileBaseIndicator';
import { getLocale, t } from '../../i18n';
import { getMapName } from '../../i18n/contentPresentation';
import {
  ArenaTimeOfDayController,
  type ArenaTimeOfDaySignals,
} from '../../systems/ArenaTimeOfDayController';
import { resolveEffectiveLoadoutSelection } from '../../loadout/LoadoutRules';
import { TranslocatorTeleportRenderer } from '../../effects/TranslocatorTeleportRenderer';
import { DEFAULT_TIME_OF_DAY_MINUTES, parseTimeOfDay, resolveSkyState } from '../../effects/TimeOfDay';
import { setEmissiveScale } from '../../effects/EmissiveScale';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, ULTIMATE_CONFIGS } from '../../loadout/LoadoutConfig';
import type { LoadoutSelection } from '../../loadout/LoadoutManager';
import {
  resolveCoopDefenseActivityBaseOverlays,
} from '../../arena/BaseRegistry';
import { getCoopDefenseMapConfig, getCoopDefenseMapXpReference, isWeaponBalanceLabMapId, resolveCoopDefenseMapPersistentSpawnConfigs, type CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import { buildInitialLocalArenaHudData } from '../../ui/LocalArenaHudData';
import { ARENA_DURATION_SEC, COOP_DEFENSE_BASE_TURRET_OWNER_ID, applyArenaMetricsForMode, getArenaMetricsProfile } from '../../config';
import type { ArenaContext }          from './ArenaContext';
import type { RendererBundle }        from './RendererBundle';
import {
  resetRenderersForWorldGameplayTeardown,
  resetRenderersForWorldPresentationTeardown,
} from './rendererWorldTeardown';
import type { RockVisualHelper }      from './RockVisualHelper';
import type { PlacementPreviewRenderer } from './PlacementPreviewRenderer';
import type { PersistentBasePreviewRenderer } from './PersistentBasePreviewRenderer';
import type { HostUpdateCoordinator } from './HostUpdateCoordinator';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { LobbyOverlay }          from '../LobbyOverlay';
import type {
  ArenaLayout,
  GameMode,
  LoadoutCommitSnapshot,
  PlayerProfile,
  RoundConclusion,
} from '../../types';
import type { RoundResult, RoundState } from '../../network/NetworkBridge';
import { resolvePvpWinnerIds } from '../../network/RoomStatistics';
import type { RoomQualityMonitor }    from '../../network/RoomQualityMonitor';
import { CAPTURE_THE_BEER_MODE, isCoopDefenseMode, isTeamGameMode } from '../../gameModes';
import {
  BASE_DESTRUCTION_GROUND_BURN_DAMAGE_PER_TICK,
  BASE_DESTRUCTION_GROUND_BURN_DURATION_MS,
  BASE_DESTRUCTION_GROUND_FIRE_DURATION_MS,
} from '../../effects/BaseDestructionPlan';
import {
  CoopMissionRuntime,
  type CoopMissionActivityStep,
  type CoopMissionRuntimePorts,
} from '../../activity/CoopMissionRuntime';
import {
  CoopMissionPresentationBinding,
  type CoopMissionPresentationReadPort,
  type CoopMissionPresentationUiPort,
} from '../../activity/CoopMissionPresentationBinding';
import type { CoopMissionPresentationInfrastructure } from './CoopMissionPresentationInfrastructure';
import { CoopMissionPlayerRuntime } from '../../activity/CoopMissionPlayerRuntime';
import {
  createArenaCoopMissionPorts,
  createArenaCoopMissionPresentationPort,
} from './ArenaCoopMissionPorts';
import { CaptureTheBeerActivityRuntime } from '../../activity/CaptureTheBeerActivityRuntime';
import type { CaptureTheBeerPresentationBinding } from '../../activity/CaptureTheBeerPresentationBinding';
import {
  createCoopMissionCompletion,
  getCoopMissionConclusion,
  type CoopMissionActivityCompletion,
} from '../../activity/ActivityCompletion';
import { ResultApplication } from '../../activity/ResultApplication';
import type { ArenaPersistentBaseSession } from './ArenaPersistentBaseSession';
import {
  composeArenaWorldGameplay,
  type ArenaWorldGameplay,
  type ArenaWorldGameplayFlowPorts,
} from './ArenaWorldGameplayComposition';
import {
  findSafeEnemyGroundPosition,
  hasWalkableEnemyCircleLine,
  isFreeEnemyGroundAt,
  isSafeEnemyGroundAt,
  resolveObstacleDamage,
} from './arenaWorldQueries';
import { resolveCoopMissionActivityConfiguration } from '../../activity/CoopMissionActivityConfig';
import { CoopMissionComposition } from '../../activity/CoopMissionComposition';
import type { LoadoutToolRef } from '../../types';
import { resolveWorldLoadProgress } from '../../world/WorldLoadReady';
import { getActiveRoundParticipantIds } from './RoundParticipationPolicy';
import { resolveArenaStartTime } from './ArenaStartTiming';
import {
  getStoredPersistentBaseAreaStage,
  getStoredPersistentBaseUnlocked,
  getStoredPersistentBaseRewardState,
} from '../../utils/localPreferences';
import type { PersistentBaseContributionStore } from '../../persistentBase/PersistentBaseContributionStore';
import type { PersistentBaseRewardStore } from '../../persistentBase/PersistentBaseRewardStore';
import type { PersistentBaseTransactionIdentity } from '../../persistentBase/PersistentBaseTransaction';
import type {
  PersistentBaseAreaStage,
  PersistentBaseBuildArea,
} from '../../persistentBase/PersistentBaseCore';
import { nextMonotonicRevision } from '../../world/WorldRevision';
import {
  resolveActiveGameMode,
  toActivityDefinitionId,
  toActivityKind,
  toMapId,
  toWorldDefinitionId,
} from '../../world/arenaDescriptorAdapter';
import { getActivityDefinition, getWorldDefinition } from '../../config/authoring/authoredScenarios';
import { isLobbyWorldDefinitionId, LOBBY_WORLD_DEFINITION_ID } from '../../config/authoring/lobbyWorld';
import { createAuthoredWorldDescriptor } from '../../world/WorldLayout';
import { isArenaTransitionReady } from './ArenaTransitionReadiness';
import { isValidPersistentBaseSite } from '../../world/WorldRuntimeContext';
import { WorldLifecycle } from '../../world/WorldLifecycle';
import { WorldPresentationHandoff } from '../../world/WorldPresentationHandoff';
import { ArenaExitEntityPresentation } from '../../world/ArenaExitEntityPresentation';
import {
  PersistentBaseWorldBinding,
} from '../../world/PersistentBaseWorldBinding';
import { WorldRuntime } from '../../world/WorldRuntime';
import {
  WorldPresentationFrameBinding,
  type WorldPresentationPersistentBaseVisuals,
} from '../../world/WorldPresentationFrameBinding';
import type { ArenaSpectatorCameraInput } from './ArenaInputBindings';
import type { WorldPowerUpRuntime } from '../../world/WorldPowerUpRuntime';
import type { WorldTrainRuntime } from '../../world/WorldTrainRuntime';
import type { ConstructionWorldRuntime } from '../../world/ConstructionWorldRuntime';
import type { WorldPlayerGameplayRuntime } from '../../world/WorldPlayerGameplayRuntime';
import type { WorldCombatGameplayBinding } from '../../world/WorldCombatGameplayBinding';
import type { WorldTargetingRuntime } from '../../world/WorldTargetingRuntime';
import type { WorldSupportGameplayRuntime } from '../../world/WorldSupportGameplayRuntime';
import type { CoopTrainPort } from '../../activity/CoopTrainPort';
import {
  PlayerWorldRuntime,
  resolvePlayerRuntimeFeatures,
  type PlayerRuntimeFeatures,
} from '../../world/PlayerWorldRuntime';
import { composePlayerWorldRuntime } from '../../world/PlayerWorldRuntimeComposition';
import {
  materializeWorldComposition,
  prepareWorldComposition,
  resolveWorldCompositionProfile,
} from '../../world/WorldComposition';
import type { WorldGeometryBinding } from '../../world/WorldGeometryBinding';
import {
  hasWorldFigure,
  hasWorldRuntimeEntry,
  maySendWorldInput,
  requiresLocalWorldPresentation,
  resolveWorldParticipation,
  type WorldParticipation,
} from '../../world/WorldParticipation';
import { resolvePlayerCapabilities, type PlayerCapabilities } from '../../world/PlayerCapabilities';
import {
  resolveWorldPresentation,
  WORLD_PRESENTATION_SURFACES,
  type WorldPresentationRequirement,
} from '../../world/WorldPresentation';
import { resolveWorldMetrics } from '../../world/WorldMetrics';
import {
  hasPersistentBaseConfigurationChanged,
  isSameWorldInstance,
  type WorldDescriptor,
  type WorldParameters,
} from '../../world/WorldDescriptor';
import type { ActivityDescriptor } from '../../world/ActivityDescriptor';
import type {
  PersistentBaseAnchor,
} from '../../persistentBase/PersistentBaseTypes';
import {
  resolvePersistentBaseVisualSite,
  toPersistentBaseGravelZone,
  type PersistentBaseVisualSite,
} from '../../persistentBase/PersistentBasePresentation';

type RuntimeDiagnosticEventSink = (type: string, fields?: Record<string, unknown>) => void;

/**
 * Manages the World and Activity lifecycles inside the arena scene.
 *
 * Responsibilities: buildArena / tearDownArena, LOBBY ↔ ARENA phase transitions,
 * host quality checks, round result saving, train event setup.
 * Runtime state stays at the concrete World-/Activity owners; the context contains only
 * scene-lifetime infrastructure.
 */
export class ArenaLifecycleCoordinator {
  private matchTerminated   = false;
  private roundTimeOfDayMinutes = DEFAULT_TIME_OF_DAY_MINUTES;
  private timeOfDayController: ArenaTimeOfDayController | null = null;
  private appliedRuntimeTimeOfDayMinutes: number | null = null;
  private roundStartPending = false;
  private isLocalReady      = false;
  private lastPhase: import('../../types').GamePhase = 'LOBBY';
  private trainDestroyedShown = false;

  /**
   * Zaehlt ueber Runden hinweg hoch. Ein verspaetetes Worker-Ergebnis aus einer alten Arena traegt
   * die alte Generation und kann deshalb nie mehr aktiviert werden.
   */
  private flowFieldGenerationId = 0;
  /**
   * Die World-Gameplay-Owner der laufenden Instanz.
   *
   * Sie entstehen an ihrer Composition-Grenze und gehoeren der `WorldRuntime`; der Flow haelt
   * nur diese eine Referenz, um seine wenigen benannten Fragen an sie zu stellen.
   */
  private worldGameplay: ArenaWorldGameplay | null = null;
  /** Scoped Sicht scene-langlebiger Geometrie-Consumer auf die aktuelle World. */
  private get worldGeometryBinding(): WorldGeometryBinding | null {
    return this.worldGameplay?.geometry ?? null;
  }

  private layoutRetryCount = 0;
  private arenaEnteredAt   = 0;
  private arenaBuilt       = false;
  /**
   * Revision der lokal gebauten World-Instanz. Der Aufbau folgt der Instanz, nicht der Phase –
   * eine neue Instanz muss deshalb auch dann erkannt werden, wenn schon eine gebaut ist.
   */
  private builtWorldRevision = 0;
  /** Letzter angewandter Stand der Lobby-Oberflaeche; sie wird nur bei echtem Wechsel umgebaut. */
  private lobbySurfaceShown = true;
  /**
   * Eine gemeinsame monotone Quelle fuer jede vom Host eroeffnete Instanz.
   *
   * LobbyWorld und Match-World liegen unmittelbar hintereinander; zwei getrennte Zaehler koennten
   * in derselben Millisekunde dieselbe Revision vergeben, und der World-Lifecycle wiese die
   * zweite Instanz dann als bereits beendet zurueck.
   */
  private lastRoundRevision = 0;
  /**
   * Nur Vergleichsmarker fuer den bei der aktuellen LobbyWorld eroeffneten Raum-Modus.
   * Die fachliche Aufloesung bleibt `resolveActiveGameMode`/`bridge.getActiveGameMode()`;
   * dieser Wert wird weder repliziert noch als Gameplay-SSOT verwendet.
   */
  private lobbyWorldModeAtRevision: GameMode | null = null;
  /**
   * Nur Vergleichsmarker fuer den effektiven Lobby-Base-Stand (Coop plus gespeicherte
   * Entitlements), mit dem die aktuelle LobbyWorld eroeffnet wurde.
   *
   * Der erste Sieg auf der Freischaltmap faellt zwischen zwei Lobby-Instanzen; ohne diesen
   * Marker haette die Reihenfolge von Sieg-Verbuchung und Lobby-Aufbau entschieden, ob die Basis
   * erscheint. Aendert sich der Wert, wird die LobbyWorld neu instanziiert - ihre Neuerzeugung
   * ist ohnehin ihr Reset.
  */
  private lobbyWorldPersistentBaseUnlockedAtRevision: boolean | null = null;
  /** Area-Stage-Marker der aktuellen LobbyWorld; ein Wechsel erzwingt eine neue World. */
  private lobbyWorldPersistentBaseAreaStageAtRevision: PersistentBaseAreaStage | null = null;
  /** Lokaler Uebergang: alte LobbyWorld ist beendet, neue Descriptor-Runtime wird gebunden. */
  private pendingLobbyWorldReinstance = false;
  /** True, wenn der Lobby-Reinstance neue strukturelle Base-Presentation benoetigt. */
  private pendingLobbyWorldPresentationRebuild = false;
  private localArenaLoadReady = false;
  private terrainSnapshotReady = false;
  private terrainSnapshotGenerationId = 0;
  private terrainSnapshotRetryCount = 0;
  /** Verhindert parallelen Re-Eintritt in `onTransitionToArena()` durch Timer-Retry und `detectWorldChange()`. */
  private arenaTransitionInProgress = false;
  private roundStartPrepared = false;
  private preparedRoundLayout: { descriptor: WorldDescriptor; layout: ArenaLayout } | null = null;
  private pendingHostArenaGeneration: {
    readonly roundRevision: number;
    readonly gameMode: GameMode;
    readonly mapConfig: CoopDefenseMapConfig | null;
    readonly seed: number;
    /** World-Parameter dieser Instanz; sie reisen im WorldDescriptor, nicht im RoundState. */
    readonly worldParameters: WorldParameters | undefined;
  } | null = null;
  private runtimeDiagnosticEventSink: RuntimeDiagnosticEventSink | null = null;
  private hostArenaGenerationTimer: Phaser.Time.TimerEvent | null = null;
  private boundRoundStartTime = 0;
  /**
   * Lokale Realisierung der laufenden World-Instanz. Sie entsteht und vergeht mit dem Attach und
   * Detach des Lifecycles; dieselbe World-Instanz kann sie verlieren und eine neue bekommen.
   *
   * Ausserhalb ihrer Lifetime ist sie `null` und wird nicht als Dependency weitergereicht.
   */
  private worldRuntime: WorldRuntime | null = null;
  /** World-owned PowerUp runtime exposed by the current gameplay composition. */
  private get worldPowerUpRuntime(): WorldPowerUpRuntime | null {
    return this.worldGameplay?.powerUp ?? null;
  }
  /** Stable narrow port passed to the Activity composition; implementation lives in WorldTrainRuntime. */
  private readonly coopTrainPort: CoopTrainPort = {
    materializeAuthoredTrain: (trackGridX, direction) => {
      if (!this.worldTrainRuntime) throw new Error('[ArenaLifecycleCoordinator] Train WorldRuntime is missing');
      return this.worldTrainRuntime.materializeAuthoredTrain(trackGridX, direction);
    },
    getCurrentTrain: () => this.worldTrainRuntime?.getCurrentTrain() ?? null,
    getCurrentTrainEvent: () => this.worldTrainRuntime?.getCurrentTrainEvent(),
    releaseActivityTrain: () => { this.worldTrainRuntime?.releaseActivityTrain(); },
    clearTrainEvent: () => { this.worldTrainRuntime?.clearTrainEvent(); },
  };
  /** World-owned train runtime; its Activity train child is released on Activity detach. */
  private get worldTrainRuntime(): WorldTrainRuntime | null {
    return this.worldGameplay?.train ?? null;
  }
  /** World-owned player/loadout gameplay exposed by the current gameplay composition. */
  private get worldPlayerGameplayRuntime(): WorldPlayerGameplayRuntime | null {
    return this.worldGameplay?.player ?? null;
  }
  /** World binding owner for scene-long Combat/Physics/Projectile/Decoy services. */
  private get worldCombatGameplayBinding(): WorldCombatGameplayBinding | null {
    return this.worldGameplay?.combat ?? null;
  }
  /** World-owned construction rules and Loadout handlers. */
  private get constructionWorldRuntime(): ConstructionWorldRuntime | null {
    return this.worldGameplay?.construction ?? null;
  }
  /** Lokale Coop-Realisierung direkt aus dem kanonischen Activity-Slot der World. */
  private get coopMissionRuntime(): CoopMissionRuntime | null {
    const runtime = this.worldRuntime?.activity.runtime;
    return runtime instanceof CoopMissionRuntime ? runtime : null;
  }
  /** Lokale Capture-the-Beer-Realisierung direkt aus dem kanonischen Activity-Slot der World. */
  private get captureTheBeerActivityRuntime(): CaptureTheBeerActivityRuntime | null {
    const runtime = this.worldRuntime?.activity.runtime;
    return runtime instanceof CaptureTheBeerActivityRuntime ? runtime : null;
  }
  /** Activity-specific orchestration; focused composers remain behind this boundary. */
  private readonly coopMissionComposition: CoopMissionComposition;
  /**
   * Die Fragen der Coop-Mission an World, Scene und Netz.
   *
   * Sie sind bewusst Closures und kein Container: Die Activity bekommt Antworten, nicht die
   * Systeme, die sie heute geben. Ein Activity-Wechsel in derselben World nutzt dieselben Ports.
   * Die Antworten selbst sind Activity-Lesesicht und stehen deshalb neben dem Flow.
   */
  private readonly coopMissionPorts: CoopMissionRuntimePorts;
  /** Adapter boundary for Activity-owned screen- and world-space Coop presentation. */
  private readonly coopMissionPresentationPorts: CoopMissionPresentationReadPort;
  /** Active Activity-scoped presentation binding; inert after its Activity detaches. */
  private coopMissionPresentationBinding: CoopMissionPresentationBinding | null = null;
  /**
   * Besitzer der laufenden World-Instanz. Erzeugung, lokale Runtime und Ende laufen
   * ausschliesslich hierueber; `ArenaContext.world` wird nur von diesem Sink geschrieben.
   */
  private readonly worldLifecycle = new WorldLifecycle({
    publish: (world, activity) => bridge.publishWorldAndActivity(world, activity),
    publishActivity: (activity) => bridge.publishActivity(activity),
    clear: () => bridge.clearWorldAndActivity(),
    attach: (context) => {
      this.worldRuntime = new WorldRuntime(context);
      // Wer in dieser World steht, gehoert ihr: Die Player-Runtime entsteht mit der Instanz und
      // ueberlebt darin jeden Activity-Wechsel.
      this.worldRuntime.setPlayers(this.composePlayerRuntime());
      // Jede World bekommt ihren eigenen Presentation-Frame-Binding - auch eine World ohne
      // Activity (LobbyWorld). Er traegt die aktive World-Display-Verdrahtung und faellt vor dem
      // Handoff dieser World.
      this.worldRuntime.bindPresentationFrame(new WorldPresentationFrameBinding({
        scene: this.scene,
        getLocalWorldPresentation: () => this.getLocalWorldPresentation(),
        getSpectatorCameraInput: this.getSpectatorCameraInput,
        getLocalPlayerSprite: () => (
          this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.displayObject ?? null
        ),
        isLocalPlayerSpectator: () => this.localPlayerState.spectator || bridge.isLocalSpectator(),
        isLocalPlayerAlive: () => this.localPlayerState.alive,
        isArenaLoading: () => bridge.isArenaLoading(),
        isArenaCountdownActive: () => bridge.isArenaCountdownActive(),
        getArenaResult: () => this.worldRuntime?.materialization?.arena ?? null,
        clientWorldPresentation: {
          timeBubble: this.renderers.timeBubble,
          teslaDome: this.renderers.teslaDome,
          energyShield: this.renderers.energyShield,
          guardianSpirit: this.renderers.guardianSpirit,
          repairDrone: this.renderers.repairDrone,
          slimeTrail: this.renderers.slimeTrail,
          flamethrowerUpgrades: this.renderers.flamethrowerUpgrades,
          train: this.renderers.train,
          powerUp: this.renderers.powerUp,
          nuke: this.renderers.nuke,
          airstrike: this.renderers.airstrike,
          meteor: this.renderers.meteor,
        },
        shadow: this.renderers.shadow,
        lighting: this.renderers.lighting,
        getWorldLayout: () => this.worldRuntime?.presentation?.layout ?? null,
        getWorldMetrics: () => this.worldRuntime?.context.metrics ?? null,
        getPersistentBaseSite: () => this.worldRuntime?.context.persistentBaseSite ?? null,
        getPersistentBaseVisualSite: () => this.getPersistentBaseVisualSite(),
        isPersistentBasePlacementOverlayActive: () => (
          this.ctx.inputSystem.isUtilityPlacementActive()
          || this.ctx.inputSystem.isConstructionPlacementActive()
          || this.ctx.inputSystem.isDismantlePlacementActive()
          || this.ctx.inputSystem.isPersistentRewardPlacementActive()
          || this.ctx.inputSystem.isRepositionActive()
        ),
        persistentBaseVisuals: this.persistentBaseVisuals,
        persistentBasePreview: this.persistentBasePreviewRenderer,
        setLocalPlayerStatusRingActive: (active) => this.ctx.playerStatusRing?.setActive(active),
        setLocalPlayerWorldBarsVisible: (visible) => {
          this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.setWorldBarsVisible(visible);
        },
        isLocalPlayerAttachedToWorld: () => this.isPlayerAttachedToWorld(bridge.getLocalPlayerId()),
        getPlayers: () => this.ctx.playerManager.getAllPlayers(),
        getProjectileShadowSamples: () => this.ctx.projectileManager.getShadowSamples(),
        getProjectileLightSamples: () => this.ctx.projectileManager.getLightSamples(),
        getTrainState: (inRoundWorld) => inRoundWorld
          ? (this.renderers.train?.getShadowState()
            ?? (bridge.isHost()
              ? (this.worldTrainRuntime?.getCurrentTrain()?.getNetSnapshot() ?? null)
              : (bridge.getLatestGameState()?.train ?? null)))
          : null,
        getLiveTrainSegments: (inRoundWorld) => (
          inRoundWorld && bridge.isHost() && this.worldTrainRuntime?.getCurrentTrain()?.isActive()
            ? this.worldTrainRuntime.getCurrentTrain()?.getSegObjects() ?? null
            : null
        ),
        getTrainVisual: () => this.renderers.train,
        syncTurretLights: (inArena) => this.rockVisualHelper.syncTurretLights(inArena),
        syncBaseLights: (inArena) => {
          if (inArena) this.worldRuntime?.materialization?.bases?.syncLights();
          else this.worldRuntime?.materialization?.bases?.releaseLights();
        },
        getSynchronizedNow: () => bridge.getSynchronizedNow(),
      }));
    },
    detach: () => {
      const runtime = this.worldRuntime;
      this.worldRuntime = null;
      // Die aktive Presentation-Verdrahtung faellt zuerst: Sie adressiert world-scoped Zustand,
      // den ein Uebergang gerade beendet, und darf nie in den Handoff gelangen.
      runtime?.detachPresentationFrame();
      // Die Darstellung verlaesst die World danach: Ein Uebergang zeigt sie weiter oder
      // verwendet sie erneut, waehrend der Gameplay-State dieser Instanz vollstaendig faellt.
      // Nach der Uebergabe sieht kein world-scoped Consumer sie mehr.
      this.worldPresentationHandoff.release(runtime?.releasePresentation() ?? null);
      runtime?.destroy();
      // Mit der World enden ihre Runtime-Objekte. Der Raumzustand haelt danach keine mehr - er
      // haelt weiter die Blueprints, aber nichts, was sie in einer Welt darstellte.
      this.persistentBase.useWorldRuntimes(null);
    },
    activityIdentity: {
      resolveStartAnchor: (_activity, previousActivity) => {
        if (previousActivity) return bridge.getSynchronizedNow();
        const arenaStartTime = bridge.getArenaStartTime();
        return arenaStartTime > 0 ? arenaStartTime : null;
      },
      begin: (activity) => { this.persistentBase.beginPersistentBaseTransaction(activity); },
      end: (activity) => {
        // Held Actions sind aktions-/rundenbezogen. Nur das Ende der fachlichen Identity leert
        // sie; ein technischer Runtime-Detach derselben Activity laesst sie bewusst bestehen.
        this.worldPlayerGameplayRuntime?.invalidateHeldActionsOnActivityEnd();
        this.persistentBase.endPersistentBaseTransaction(activity);
      },
    },
    activity: {
      attach: (activity) => { this.attachActivityRuntime(activity); },
      detach: () => { this.detachActivityRuntime(); },
    },
  });
  /**
   * Traegt die Darstellung einer endenden World-Runtime ueber einen Uebergang: Match-Exit,
   * Rundenstart, Lobby-Fast-Reinstance und Lobby-Rueckkehr nehmen denselben Weg.
   */
  private readonly worldPresentationHandoff = new WorldPresentationHandoff();
  /**
   * Die Antworten des Flows an die World-Gameplay-Composition.
   *
   * Sie sind bewusst Fragen und keine Systeme: Der Flow sagt, welche Activity laeuft, was ein
   * Spieler darf und wann ein benannter Activity-Schritt faellig ist - nicht, wie die World ihre
   * Systeme baut.
   */
  private readonly worldGameplayFlowPorts: ArenaWorldGameplayFlowPorts = {
    getCoopMissionRuntime: () => this.coopMissionRuntime,
    getCaptureTheBeerSystem: () => this.captureTheBeerActivityRuntime?.system ?? null,
    getPlayerActivityRuntime: () => this.playerActivityRuntime,
    isCoopMissionActivity: () => this.worldLifecycle.activity.is('coop-mission'),
    isActivityActive: () => this.worldLifecycle.activity.isActive(),
    getActivityStartAnchor: () => this.worldLifecycle.activityStartAnchor,
    getPlayerCapabilities: (playerId) => this.getPlayerCapabilities(playerId),
    getWorldParticipation: (playerId) => this.getWorldParticipation(playerId),
    getConfiguredGameMode: () => this.resolveConfiguredGameMode(),
    getWorldMapId: () => this.worldRuntime?.context.definition?.sourceMapId ?? null,
    onDiagnosticEvent: (type, fields) => this.runtimeDiagnosticEventSink?.(type, fields),
    materializeActivityCore: (activity, runtime, layout) => {
      const configuration = activity
        ? resolveCoopMissionActivityConfiguration(activity, this.worldRuntime?.context.definition ?? null)
        : null;
      this.coopMissionComposition.materializeCore(configuration, runtime, layout);
    },
    bindActivityPowerUpPedestals: (activity, runtime, activityStartTime) => {
      this.attachCoopMissionPowerUpBinding(activity, runtime, activityStartTime);
    },
    syncActivityXpReference: () => { this.syncCoopDefenseMapXpReference(this.coopMissionRuntime); },
    syncHostPlayerModifiers: () => { this.syncHostCoopDefensePlayerModifiersFromCurrentBuild(); },
    resolveOwnerId: (playerId) => this.persistentBase.resolveOwnerId(playerId),
    resolvePlayerIdForOwner: (ownerId) => this.persistentBase.resolvePlayerIdForOwner(ownerId),
    acceptsCurrentPersistentBaseMutation: (activityRevision) => (
      this.persistentBase.acceptsCurrentPersistentBaseMutation(activityRevision)
    ),
    mayManagePersistentBase: (playerId) => this.persistentBase.mayManagePersistentBase(playerId),
    getPersistentBaseConstructionContext: () => {
      const anchor = this.persistentBaseAnchor;
      const buildArea = this.persistentBaseBuildArea;
      return anchor && buildArea
        ? {
          anchor,
          buildArea,
          contributions: this.persistentBaseContributions,
          rewards: this.persistentBaseRewards,
        }
        : null;
    },
    reconcilePersistentBaseWorld: () => { this.persistentBase.reconcilePersistentBaseWorld(); },
    publishImmediatePersistentBaseContribution: (ownerId) => {
      this.persistentBase.publishImmediatePersistentBaseContribution(ownerId);
    },
    persistCommittedPersistentBaseRewards: () => { this.persistentBase.persistCurrentCommittedPersistentBaseRewards(); },
    publishPersistentBaseRewardSessionState: () => { this.persistentBase.publishPersistentBaseRewardSessionState(); },
    relocatePlaceableRuntimePresentation: (previous, next) => {
      this.persistentBase.relocatePlaceableRuntimePresentation(previous, next);
    },
    emitPersistentRestoreAdded: (runtime) => { this.persistentBase.emitPersistentRestoreAdded(runtime); },
  };
  /** Reine Player-/Enemy-Snapshots waehrend des sichtbaren Match-Exit-Fades. */
  private arenaExitEntityPresentation: ArenaExitEntityPresentation | null = null;
  /** Baut das feste PlayerWorldRuntime-Rezept aus konkreten Scene-Operationen. */
  private composePlayerRuntime(): PlayerWorldRuntime {
    return composePlayerWorldRuntime({
      attachEntity: ({ profile, spawn }) => {
        const authoritativeSpawn = bridge.isHost() ? undefined : spawn;
        this.ctx.playerManager.addPlayer(
          profile,
          bridge.isHost() || authoritativeSpawn
            ? { spawn: authoritativeSpawn }
            : { spawnEffect: false },
        );
      },
      detachEntity: (playerId) => {
        this.ctx.effectSystem.clearBurrowState(playerId);
        this.clientUpdate.removePlayerState(playerId);
        this.ctx.hostPhysics.removePlayer(playerId);
        this.ctx.playerManager.removePlayer(playerId);
      },
      attachCombat: (profile, reconnectAfterDeath) => {
        if (reconnectAfterDeath) return this.ctx.combatSystem.spawnPlayerAfterReconnect(profile.id);
        this.ctx.combatSystem.initPlayer(profile.id);
        return true;
      },
      detachCombat: (playerId) => { this.ctx.combatSystem.removePlayer(playerId); },
      attachCombatResources: (playerId) => { this.worldPlayerGameplayRuntime?.attachPlayerResources(playerId); },
      detachCombatResources: (playerId) => {
        this.worldPlayerGameplayRuntime?.detachPlayerResources(playerId);
        bridge.clearWeapon2PredictionState(playerId);
      },
      attachPlayerBuild: (playerId) => { this.worldPlayerGameplayRuntime?.attachPlayerBuild(playerId); },
      detachPlayerBuild: (playerId) => { this.worldPlayerGameplayRuntime?.detachPlayerBuild(playerId); },
      attachBurrow: (playerId) => { this.worldPlayerGameplayRuntime?.attachPlayerBurrow(playerId); },
      detachBurrow: (playerId) => { this.worldPlayerGameplayRuntime?.detachPlayerBurrow(playerId); },
      attachLoadout: (playerId) => {
        this.worldPlayerGameplayRuntime?.attachPlayerLoadout(playerId, this.resolveCommittedLoadoutSelection(playerId));
      },
      detachLoadout: (playerId) => {
        this.worldPlayerGameplayRuntime?.detachPlayerLoadout(playerId);
        this.worldPowerUpRuntime?.system.removePlayer(playerId);
      },
      detachWorldTargeting: (playerId) => {
        this.worldGameplay?.targeting?.systems.targetStatus.removeTarget({ targetType: 'player', targetId: playerId });
        this.worldGameplay?.targeting?.systems.energyInjector.removeOwner(playerId);
      },
    });
  }
  /**
   * Der Player-Lifecycle der laufenden World; `null`, solange keine World lokal materialisiert
   * ist. Er gehoert der `WorldRuntime`; beim Exit ueberlebt nur der eingefrorene
   * Presentation-Snapshot.
   */
  private get playerRuntime(): PlayerWorldRuntime | null {
    return this.worldRuntime?.players ?? null;
  }

  /** Der activity-spezifische Spielerzustand der laufenden Mission; `null` ohne Coop-Activity. */
  private get playerActivityRuntime(): CoopMissionPlayerRuntime | null {
    return this.coopMissionRuntime?.playerActivity ?? null;
  }
  private get persistentBaseContributions(): PersistentBaseContributionStore {
    return this.persistentBase.session.contributions;
  }
  private get persistentBaseRewards(): PersistentBaseRewardStore {
    return this.persistentBase.session.rewards;
  }
  /**
   * Wendet einen revisionsgebundenen Coop-Abschluss auf seine realen nachgelagerten Consumer an.
   * Die Closures bilden die Infrastrukturgrenze; der Owner selbst kennt weder Bridge noch Scene.
   */
  private readonly resultApplication = new ResultApplication({
    getCurrentActivity: () => this.worldLifecycle.activity.descriptor,
    resolveVictoryRewardIds: (definitionId) => (
      getActivityDefinition(definitionId)?.persistentBaseRewardsOnVictory ?? []
    ),
    grantPersistentBaseRewards: (rewardIds) => {
      this.persistentBase.grantAuthoredPersistentBaseRewards(rewardIds);
    },
    applyPersistentBaseOutcome: (outcome, identity) => {
      this.persistentBase.applyRoundOutcome(outcome, identity);
    },
    clearActivityPresentation: () => { this.clearCoopMissionPresentationState(); },
    publishCompletion: (completion, endedAt) => {
      this.publishCoopMissionCompletion(completion, endedAt);
    },
  });
  /**
   * Die world-lokale Materialisierung der persistenten Basis dieser Instanz. Sie gehoert der
   * `WorldRuntime`; ausserhalb einer World gibt es keine world-lokalen Runtime-IDs.
   */
  private get persistentBaseWorldBinding(): PersistentBaseWorldBinding | null {
    return this.worldRuntime?.persistentBase ?? null;
  }
  /** Leerstand ohne World: Ohne Instanz existiert nichts world-lokal Materialisiertes. */
  private get persistentBaseAnchor(): PersistentBaseAnchor | null {
    return this.persistentBaseWorldBinding?.anchor ?? null;
  }
  private get persistentBaseBuildArea(): PersistentBaseBuildArea | null {
    return this.persistentBaseWorldBinding?.buildArea ?? null;
  }
  private persistentBaseVisualSite: PersistentBaseVisualSite | null = null;
  private readonly coopMissionPresentationUi: CoopMissionPresentationUiPort | null;
  private static readonly LAYOUT_RETRY_LIMIT = 312; // ~5s at 16ms per retry
  private static readonly TERRAIN_SNAPSHOT_TIMEOUT_MS = 8000;
  private static readonly TERRAIN_SNAPSHOT_MAX_RETRIES = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
    private readonly renderers: RendererBundle,
    private readonly rockVisualHelper: RockVisualHelper,
    private readonly placementPreview: PlacementPreviewRenderer,
    private readonly persistentBasePreviewRenderer: PersistentBasePreviewRenderer,
    private readonly persistentBaseVisuals: WorldPresentationPersistentBaseVisuals,
    private readonly lobbyOverlay: LobbyOverlay,
    private readonly hostUpdate: HostUpdateCoordinator,
    private readonly clientUpdate: ClientUpdateCoordinator,
    private readonly roomQualityMonitor: RoomQualityMonitor,
    coopMissionPresentation: CoopMissionPresentationInfrastructure | null,
    private readonly captureTheBeerPresentation: CaptureTheBeerPresentationBinding | null,
    /**
     * Der raumlanglebige Persistent-Base-Owner. Er ueberlebt jede World und jede Runde und
     * gehoert deshalb der `ArenaRuntime`; der Flow fragt ihn nur.
     */
    private readonly persistentBase: ArenaPersistentBaseSession,
    /** Lazy: Die Input-Bindings der Scene entstehen erst nach diesem Owner. */
    private readonly getSpectatorCameraInput: () => ArenaSpectatorCameraInput | undefined,
  ) {
    this.coopMissionPresentationUi = coopMissionPresentation?.createUiPort({
      centerHUD: ctx.centerHUD,
      playerManager: ctx.playerManager,
      clientUpdate,
      renderers,
      getBaseManager: () => this.worldRuntime?.materialization?.bases ?? null,
      getEnemyManager: () => this.coopMissionRuntime?.enemyManager ?? null,
    }) ?? null;
    this.coopMissionPorts = createArenaCoopMissionPorts({
      ctx,
      getWorldRuntime: () => this.worldRuntime,
      getBaseManager: () => this.worldRuntime?.materialization?.bases ?? null,
      getEnemyManager: () => this.coopMissionRuntime?.enemyManager ?? null,
      getBurrowSystem: () => this.worldPlayerGameplayRuntime?.systems.burrow ?? null,
      getPlayerCapabilities: (playerId) => this.getPlayerCapabilities(playerId),
    });
    this.coopMissionPresentationPorts = createArenaCoopMissionPresentationPort({
      getBaseManager: () => this.worldRuntime?.materialization?.bases ?? null,
      getEnemyManager: () => this.coopMissionRuntime?.enemyManager ?? null,
      getCoopMissionRuntime: () => this.coopMissionRuntime,
      getEnemyVulnerability: (enemyId, now) => this.worldGameplay?.targeting?.systems.targetStatus.isVulnerable(
        { targetType: 'enemy', targetId: enemyId },
        now,
      ) ?? false,
    });
    this.coopMissionComposition = new CoopMissionComposition({
      scene,
      getWorld: () => this.worldRuntime?.context ?? null,
      getLayout: () => this.worldRuntime?.presentation?.layout ?? null,
      getArenaResult: () => this.worldRuntime?.materialization?.arena ?? null,
      getBaseManager: () => this.worldRuntime?.materialization?.bases ?? null,
      getPlayerManager: () => this.ctx.playerManager,
      getCombatSystem: () => this.ctx.combatSystem,
      getProjectileManager: () => this.ctx.projectileManager,
      getHostPhysics: () => this.ctx.hostPhysics,
      getPlacementSystem: () => this.worldRuntime?.materialization?.placement ?? null,
      getLoadoutManager: () => this.worldPlayerGameplayRuntime?.systems.loadout ?? null,
      getAutomatedWeaponExecution: () => this.worldGameplay?.automatedWeaponExecution ?? null,
      getPowerUpSystem: () => this.worldPowerUpRuntime?.system ?? null,
      getPlayerModifierSystem: () => this.worldPlayerGameplayRuntime?.systems.playerModifier ?? null,
      getEnergyShieldSystem: () => this.worldCombatGameplayBinding?.systems?.energyShield ?? null,
      getStinkCloudSystem: () => this.ctx.stinkCloudSystem,
      getFlamethrowerUpgradeSystem: () => this.worldPlayerGameplayRuntime?.systems.flamethrowerUpgrade ?? null,
      getFireSystem: () => this.ctx.fireSystem,
      getDecoySystem: () => this.ctx.decoySystem,
      getArmageddonSystem: () => this.worldGameplay?.support?.systems.armageddon ?? null,
      getAirstrikeSystem: () => this.worldGameplay?.support?.systems.airstrike ?? null,
      getGameAudioSystem: () => this.ctx.gameAudioSystem,
      getLightingSystem: () => this.renderers.lighting,
      getPlayerWorldRuntime: () => this.worldRuntime?.players ?? null,
      train: this.coopTrainPort,
      isHost: () => bridge.isHost(),
      getHumanPlayerCount: () => Math.max(
        1,
        Math.floor(bridge.getRoundState()?.coopDefenseHumanPlayerCount ?? 1),
      ),
      getParticipantIds: () => bridge.getRoundParticipation()?.participantIds ?? bridge.getConnectedPlayerIds(),
      nextGenerationId: () => this.nextFlowFieldGenerationId(),
      getPlayerCapabilities: (playerId) => this.getPlayerCapabilities(playerId),
      getSecondsLeft: () => bridge.computeSecondsLeft(),
      getConnectedPlayerIds: () => bridge.getConnectedPlayerIds(),
      getSpectatorIds: () => bridge.getRoundParticipation()?.spectatorIds ?? [],
      isPlayerBurrowed: (playerId) => this.worldPlayerGameplayRuntime?.isBurrowed(playerId) ?? false,
      isSafeEnemyGroundAt: (x, y, radius) => isSafeEnemyGroundAt(this.coopMissionRuntime, x, y, radius),
      findSafeEnemyGroundPosition: (x, y, radius, maxRadiusCells) => (
        findSafeEnemyGroundPosition(this.coopMissionRuntime, x, y, radius, maxRadiusCells)
      ),
      isFreeEnemyGroundAt: (x, y, radius) => isFreeEnemyGroundAt(this.coopMissionRuntime, x, y, radius),
      hasWalkableEnemyCircleLine: (fromX, fromY, toX, toY, radius) => (
        hasWalkableEnemyCircleLine(this.coopMissionRuntime, fromX, fromY, toX, toY, radius)
      ),
      damageConstruction: (id, damage, attackerId) => {
        const resolvedDamage = resolveObstacleDamage(
          this.ctx.combatSystem,
          this.worldRuntime?.materialization?.placement ?? null,
          id,
          damage,
          attackerId,
        );
        if (resolvedDamage <= 0) return;
        const hp = this.rockVisualHelper.applyObstacleDamageById(id, resolvedDamage, attackerId);
        if (hp <= 0) this.rockVisualHelper.handleDestroyedRock(id, 'damage', attackerId);
      },
      releaseMissionObjectives: (runtime, playerId) => {
        runtime.coopDefenseObjectivePlacementRewardSystem?.handlePlayerUnavailable(playerId);
        runtime.coopDefenseCarrySystem?.handlePlayerUnavailable(playerId);
      },
      publishMissionProgress: (state) => bridge.publishCoopDefenseMissionProgressPresentationState(state),
      broadcastCarryDeliveredFx: (x, y) => bridge.broadcastCoopDefenseCarryDeliveredFx(x, y),
      enemyAbilityNetwork: {
        broadcastTranslocatorFlash: (x, y, color, phase, ownerId) => bridge.broadcastTranslocatorFlash(x, y, color, phase, ownerId),
      },
      publishRespawnBudget: (state) => bridge.publishCoopDefenseRespawnBudgetState(state),
      patchBarrierCells: (changes) => this.coopMissionRuntime?.flowFieldCoordinator?.patchBarrierCells(changes),
      markLightDirty: () => this.worldRuntime?.materialization?.lightOccluders?.markDirty(),
      grantPersistentBaseRewards: (rewardIds) => this.persistentBase.grantAuthoredPersistentBaseRewards(rewardIds),
      removeEnemyFromItemRuntime: (enemyId) => this.worldPlayerGameplayRuntime?.systems.itemRuntime.removeEnemy(enemyId),
      broadcastExplosion: (x, y, radius, style) => bridge.broadcastExplosionEffect(x, y, radius, 0xb82fff, style),
      broadcastCorpseMarker: (corpseId, x, y, enemySize, lifetimeMs) => (
        bridge.broadcastCorpseMarker(corpseId, x, y, enemySize, lifetimeMs)
      ),
      removeCorpseMarker: (corpseId) => bridge.broadcastCorpseMarkerRemoval(corpseId),
      getNowMs: () => Date.now(),
      onDiagnosticEvent: (type, fields) => this.runtimeDiagnosticEventSink?.(type, fields),
      onBossSpawned: (spawnedAtMs) => {
        this.runtimeDiagnosticEventSink?.('boss:spawn', { spawnedAtMs });
        const current = bridge.getRoundState();
        if (!current || current.status !== 'active') return;
        bridge.publishRoundState({ ...current, coopDefenseBossSpawnedAtMs: spawnedAtMs });
      },
      visualSink: this.ctx.effectSystem,
      entityBurnGpuController: this.renderers.entityBurnGpu,
    });
  }

  // ── Public state accessors ────────────────────────────────────────────────

  isMatchTerminated(): boolean { return this.matchTerminated; }

  setRuntimeDiagnosticEventSink(sink: RuntimeDiagnosticEventSink | null): void {
    this.runtimeDiagnosticEventSink = sink;
  }

  /**
   * Die von der Map vorgegebene Uhrzeit der laufenden Runde – der Wert, auf den der
   * Debug-Regler zurücksetzt. Unabhängig davon, was gerade lokal eingestellt ist.
   */
  getRoundTimeOfDayMinutes(): number {
    return this.roundTimeOfDayMinutes;
  }

  getCurrentTimeOfDayMinutes(): number {
    return this.timeOfDayController?.getCurrentMinutes()
      ?? this.renderers.lighting.getTimeOfDayMinutes();
  }

  getAutomaticTimeOfDayMinutes(): number {
    return this.timeOfDayController?.getAutomaticMinutes()
      ?? this.renderers.lighting.getTimeOfDayMinutes();
  }

  setTimeOfDayDebugOverride(minutes: number): void {
    this.timeOfDayController?.setDebugOverride(minutes);
  }

  clearTimeOfDayDebugOverride(): void {
    this.timeOfDayController?.clearDebugOverride();
  }

  /** Wendet genau einen aus synchronisierter Zeit berechneten Arena-Zeitwert an. */
  syncRuntimeTimeOfDay(synchronizedNowMs: number, signals: ArenaTimeOfDaySignals = {}): boolean {
    const controller = this.timeOfDayController;
    if (!controller) return false;
    const sample = controller.sample(synchronizedNowMs, signals);
    if (sample.minutes !== this.appliedRuntimeTimeOfDayMinutes) {
      this.applyRuntimeTimeOfDay(sample.minutes);
    }
    return sample.transitionCompleted;
  }

  /** Hält die Lobby-Beleuchtung auf der host-autoritativen Slider-Uhrzeit. */
  syncLobbyTimeOfDay(): void {
    if (bridge.getGamePhase() !== 'LOBBY') return;
    const minutes = bridge.getLobbyTimeOfDayMinutes();
    this.renderers.lighting.setTimeOfDay(minutes);
    this.renderers.lighting.setActive(true);
    setEmissiveScale(resolveSkyState(minutes).emissiveScale);
  }

  private applyRuntimeTimeOfDay(minutes: number): void {
    this.appliedRuntimeTimeOfDayMinutes = minutes;
    this.renderers.lighting.setTimeOfDay(minutes);
    this.renderers.shadow.setTimeOfDay(minutes);
    setEmissiveScale(resolveSkyState(minutes).emissiveScale);
  }
  getIsLocalReady(): boolean   { return this.isLocalReady; }
  isTrainDestroyedShown(): boolean { return this.trainDestroyedShown; }

  getPersistentBaseVisualSite(): PersistentBaseVisualSite | null {
    return this.persistentBaseVisualSite;
  }

  setIsLocalReady(v: boolean): void {
    this.isLocalReady = v;
    this.lobbyOverlay.setReadyButtonState(v);
    this.ctx.leftPanel.setLobbyFieldsLocked(v);
  }

  onTrainDestroyed(): void {
    this.trainDestroyedShown = true;
  }

  initialize(): void {
    this.isLocalReady = false;
    bridge.setLocalReady(false);
    this.lastPhase = bridge.getGamePhase();

    // Start lobby music on initial load
    if (this.lastPhase === 'LOBBY') {
      this.ctx.gameAudioSystem.playMusic('music_lobby');
      this.syncLobbyTimeOfDay();
    }

    // If the scene was created after the host already transitioned to ARENA,
    // detectPhaseChange() will never see LOBBY→ARENA. Schedule the transition
    // on the next frame so all create()-time setup (RPC, callbacks) completes first.
    if (this.lastPhase === 'ARENA') {
      this.scene.time.delayedCall(0, () => {
        if (bridge.getGamePhase() === 'ARENA' && !this.arenaBuilt && !this.matchTerminated) {
          this.onTransitionToArena();
        }
      });
    }
  }

  // ── Phase detection ───────────────────────────────────────────────────────

  detectPhaseChange(deferArenaToLobby = false): void {
    const current = bridge.getGamePhase();

    if (this.matchTerminated) {
      if (current !== this.lastPhase) this.lastPhase = current;
      if (current === 'LOBBY') this.matchTerminated = false;
      return;
    }

    if (current === this.lastPhase) {
      // Safety net: if we've been in ARENA for >5s without having built the
      // arena, something went wrong during the transition — recover gracefully.
      if (current === 'ARENA' && !this.arenaBuilt) {
        const now = Date.now();
        if (this.arenaEnteredAt === 0) {
          this.arenaEnteredAt = now;
        } else if (now - this.arenaEnteredAt > 5_000) {
          this.arenaEnteredAt = 0;
          this.terminateMatch();
        }
      }
      return;
    }

    const prev     = this.lastPhase;
    if (deferArenaToLobby && prev === 'ARENA' && current === 'LOBBY') return;
    this.lastPhase = current;
    if (prev === 'LOBBY' && current === 'ARENA') {
      this.arenaEnteredAt = Date.now();
      this.onTransitionToArena();
    }
    if (prev === 'ARENA' && current === 'LOBBY') this.onTransitionToLobby();
  }

  /**
   * Beendet die lokale World-Runtime und entscheidet ueber die uebergebene Darstellung.
   *
   * Der Gameplay-State der World faellt mit ihrer Runtime. Ihre Darstellung geht dabei in den
   * Handoff; nur ein Uebergang, der sie weiterverwendet, laesst sie stehen.
   */
  private releaseWorldRuntime(preservePresentation: boolean): void {
    const hadRuntime = this.worldRuntime !== null;
    this.worldLifecycle.detachRuntime();
    if (!preservePresentation) this.worldPresentationHandoff.discard();
    if (!hadRuntime) this.finalizePersistentBaseRuntimeObjects();
  }

  /**
   * Schliesst den persistenten Basisbestand dieser World ab: Was als Runtime-Objekt noch steht,
   * bleibt im Arbeitsstand; alles andere faellt heraus.
   *
   * Laeuft im Abbau des Persistent-Base-Bindings – mit noch lebender Bau-Runtime, aber ohne
   * Darstellung. Danach waere jedes Objekt "zerstoert" und der Arbeitsstand leer.
   */
  private finalizePersistentBaseRuntimeObjects(): void {
    this.persistentBaseWorldBinding?.finalizeWorldRuntimeObjects();
  }

  /**
   * Die Instanz, zu der ein Persistent-Base-Abschluss gehoert.
   *
   * World- und Activity-Revision zusammen: Ein Abschluss, der zu einer anderen Instanz
   * gehoert, laeuft ins Leere, statt einen inzwischen neuen Arbeitsstand zu treffen.
   */
  private resolvePersistentBaseTransactionIdentity(): PersistentBaseTransactionIdentity | undefined {
    const activity = this.worldLifecycle.activity.descriptor;
    return activity
      ? { worldRevision: activity.worldRevision, activityRevision: activity.activityRevision }
      : undefined;
  }

  /**
   * Die Fragen des raumlanglebigen Persistent-Base-Owners an die laufende World.
   *
   * Der Flow beantwortet sie, weil er die World-Identitaet und ihre lokale Runtime kennt; die
   * Materialisierung und die Management-Regeln bleiben beim Persistent-Base-Owner.
   */
  readonly persistentBaseWorldPorts = {
    getWorldBinding: () => this.persistentBaseWorldBinding,
    getConstructionRuntime: () => this.constructionWorldRuntime,
    getPlayerCapabilities: (playerId: string) => this.getPlayerCapabilities(playerId),
    hasPersistentBaseSite: () => this.hasPersistentBaseForCurrentWorld(),
    getConfiguredGameMode: () => this.resolveConfiguredGameMode(),
  };

  /** Prueft die PB-Site auch beim Identity-Start vor der lokalen World-Materialisierung. */
  private hasPersistentBaseForCurrentWorld(): boolean {
    const context = this.worldLifecycle.context;
    if (context) return context.persistentBaseSite !== null;
    const descriptor = this.worldLifecycle.descriptor;
    if (!descriptor?.parameters?.persistentBaseUnlocked) return false;
    return getWorldDefinition(descriptor.definitionId)?.persistentBaseSite !== undefined;
  }

  /**
   * Taktet die lokale World-Runtime dieses Frames.
   *
   * Update folgt Ownership: Wer einen world-scoped Child-Owner besitzt, taktet ihn auch. Ohne
   * lokale Runtime taktet niemand – eine World ohne Activity und ein Peer ohne Runtime bleiben
   * damit ausdruecklich ohne Sonderpfad.
   */
  updateWorldRuntime(deltaMs: number): void {
    this.worldRuntime?.update(deltaMs);
  }

  /** Direkter Zugriff auf die tatsaechlichen Runtime-Owner fuer Scene-/Coordinator-Consumer. */
  getWorldRuntime(): WorldRuntime | null { return this.worldRuntime; }
  getWorldTargetingRuntime(): WorldTargetingRuntime | null { return this.worldGameplay?.targeting ?? null; }
  getWorldTrainRuntime(): WorldTrainRuntime | null { return this.worldTrainRuntime; }
  getWorldPlayerGameplayRuntime(): WorldPlayerGameplayRuntime | null { return this.worldPlayerGameplayRuntime; }
  getWorldCombatGameplayBinding(): WorldCombatGameplayBinding | null { return this.worldCombatGameplayBinding; }
  getWorldPowerUpRuntime(): WorldPowerUpRuntime | null { return this.worldPowerUpRuntime; }
  getConstructionWorldRuntime(): ConstructionWorldRuntime | null { return this.constructionWorldRuntime; }
  getWorldSupportGameplayRuntime(): WorldSupportGameplayRuntime | null { return this.worldGameplay?.support ?? null; }
  getCoopMissionRuntime(): CoopMissionRuntime | null { return this.coopMissionRuntime; }
  getCaptureTheBeerActivityRuntime(): CaptureTheBeerActivityRuntime | null {
    return this.captureTheBeerActivityRuntime;
  }

  /**
   * Der Missionsanteil des laufenden Frames.
   *
   * Der Frame-Owner bekommt benannte Schritte, nicht die Systeme dahinter: Reihenfolge und
   * Bestand der Coop-Activity gehoeren ihrer eigenen Runtime.
   */
  getActivityStep(): CoopMissionActivityStep | null {
    return this.coopMissionRuntime;
  }

  /** Taktet die screen-space Coop-Presentation fuer die laufende Activity. */
  syncCoopMissionPresentation(deltaMs: number, active: boolean): void {
    this.coopMissionPresentationBinding?.sync(deltaMs, active);
  }

  /** Bindet die konkrete Coop-Runtime an den Activity-Slot der laufenden World. */
  private attachActivityRuntime(activity: ActivityDescriptor): void {
    const worldRuntime = this.worldRuntime;
    if (!worldRuntime) {
      throw new Error(
        `[ArenaLifecycleCoordinator] Cannot attach activity ${activity.definitionId} without WorldRuntime`,
      );
    }
    if (activity.kind === 'capture-the-beer') {
      const runtime = new CaptureTheBeerActivityRuntime({
        playerManager: this.ctx.playerManager,
        isPlayerInteractionAllowed: (playerId) => (
          this.ctx.combatSystem.isAlive(playerId)
          && !(this.worldPlayerGameplayRuntime?.isBurrowed(playerId) ?? false)
        ),
        roster: {
          getPlayerTeam: (playerId) => bridge.getPlayerTeam(playerId),
          getPlayerIdentity: (playerId) => bridge.getConnectedPlayers()
            .find((player) => player.id === playerId) ?? null,
        },
        onFx: (event) => {
          if (bridge.isHost()) bridge.broadcastCaptureTheBeerFx(event);
        },
      });
      worldRuntime.activity.attach(activity, runtime);
      this.captureTheBeerPresentation?.bind(runtime);
      return;
    }
    if (activity.kind !== 'coop-mission') return;
    const runtime = new CoopMissionRuntime(
      activity,
      (current) => { this.onCoopMissionRuntimeChanged(current); },
      this.coopMissionPorts,
    );
    worldRuntime.activity.attach(activity, runtime);
    runtime.bind({
      attach: (current) => {
        const enemyManager = current.enemyManager;
        // The World combat owner projects the current Activity barrier; objective materialization
        // republishes this binding once the actual BarrierManager exists.
        this.worldCombatGameplayBinding?.updateActivityBindings();
        this.ctx.combatSystem.setEnemyManager(enemyManager);
        this.ctx.hostPhysics.setEnemyManager(enemyManager);
        this.worldTrainRuntime?.setEnemyManager(enemyManager);
        this.worldCombatGameplayBinding?.updateEnemyManager(enemyManager);
        this.worldPlayerGameplayRuntime?.updateEnemyManager(enemyManager);
      },
      detach: () => {
        this.worldCombatGameplayBinding?.clearActivityBindings();
        this.worldTrainRuntime?.setEnemyManager(null);
        this.worldPlayerGameplayRuntime?.updateEnemyManager(null);
        this.worldCombatGameplayBinding?.updateEnemyManager(null);
        this.ctx.hostPhysics.setEnemyRockContactCallback(null);
        this.ctx.hostPhysics.setEnemyManager(null);
        this.ctx.combatSystem.setEnemyManager(null);
      },
    });
    const activityConfiguration = resolveCoopMissionActivityConfiguration(
      activity,
      worldRuntime.context.definition,
    );
    if (this.coopMissionPresentationUi) {
      const presentationBinding = new CoopMissionPresentationBinding(
        activityConfiguration.mapConfig,
        this.coopMissionPresentationPorts,
        this.coopMissionPresentationUi,
      );
      this.coopMissionPresentationBinding = presentationBinding;
      runtime.bind(presentationBinding);
    }
    this.attachCoopMissionBaseBinding(activity, runtime);
    this.onCoopMissionRuntimeChanged(runtime);
    if (this.worldRuntime?.materialization?.arena) {
      this.attachCoopMissionPowerUpBinding(
        activity,
        runtime,
        this.worldLifecycle.activityStartAnchor ?? undefined,
      );
      this.coopMissionComposition.materializeCore(activityConfiguration, runtime);
      this.coopMissionComposition.materializeDependents(activityConfiguration, runtime);
      this.onCoopMissionRuntimeChanged(runtime);
    }
  }

  /** Bindet nur den aktuellen Coop-Overlay-State an die world-owned Base-Grundlage. */
  private attachCoopMissionBaseBinding(
    activity: ActivityDescriptor,
    runtime: CoopMissionRuntime,
  ): void {
    if (activity.kind !== 'coop-mission') return;
    const baseManager = this.worldRuntime?.materialization?.bases ?? null;
    const world = this.worldRuntime?.context;
    if (!baseManager || !world) return;

    const activityConfiguration = resolveCoopMissionActivityConfiguration(activity, world.definition);
    const humanPlayerCount = Math.max(
      1,
      Math.floor(bridge.getRoundState()?.coopDefenseHumanPlayerCount ?? 1),
    );
    const overlays = resolveCoopDefenseActivityBaseOverlays(
      activityConfiguration.mapConfig,
      humanPlayerCount,
      world.metrics,
    );
    const binding = baseManager.createActivityBinding(overlays, () => {
      this.ctx.combatSystem.setBaseObstacles(baseManager.getObstacleRectangles());
      this.worldGeometryBinding?.syncBaseObstacles();
    });
    runtime.bind({
      attach: () => { binding.attach(); },
      detach: () => { binding.detach(); },
    });
  }

  /** Bindet die linked Pedestal-Projektion an die Activity, ohne World-Geometrie neu aufzubauen. */
  private attachCoopMissionPowerUpBinding(
    activity: ActivityDescriptor,
    runtime: CoopMissionRuntime,
    activityStartTime?: number,
  ): void {
    if (activity.kind !== 'coop-mission') return;
    const powerUpSystem = this.worldPowerUpRuntime?.system ?? null;
    const world = this.worldRuntime?.context;
    if (!powerUpSystem || !world) return;
    const activityConfiguration = resolveCoopMissionActivityConfiguration(activity, world.definition);

    const humanPlayerCount = Math.max(
      1,
      Math.floor(bridge.getRoundState()?.coopDefenseHumanPlayerCount ?? 1),
    );
    const overlays = resolveCoopDefenseActivityBaseOverlays(
      activityConfiguration.mapConfig,
      humanPlayerCount,
      world.metrics,
    );
    const binding = powerUpSystem.createActivityPedestalBinding(
      overlays.flatMap((overlay) => overlay.powerUpPedestals),
      activityStartTime,
    );
    runtime.bind({
      attach: () => { binding.attach(); },
      detach: () => { binding.detach(); },
    });
  }

  /** Loest ausschliesslich die lokale Activity; World-Identitaet und World-Runtime bleiben stehen. */
  private detachActivityRuntime(): void {
    this.captureTheBeerPresentation?.detach();
    this.worldRuntime?.activity.detach();
  }

  /** Teardown-Einstieg ausserhalb des Lifecycles; haelt dessen Runtime-Phase synchron. */
  private detachLocalActivityForTeardown(): void {
    if (this.worldLifecycle.activity.isActive()) {
      this.worldLifecycle.activity.detachRuntime();
      return;
    }
    this.detachActivityRuntime();
  }

  private onCoopMissionRuntimeChanged(runtime: CoopMissionRuntime | null): void {
    this.worldCombatGameplayBinding?.updateActivityBindings();
    this.syncCoopDefenseMapXpReference(runtime);
  }

  private syncCoopDefenseMapXpReference(runtime: CoopMissionRuntime | null): void {
    const powerUpRuntime = this.worldPowerUpRuntime;
    if (!powerUpRuntime) return;
    const activity = this.worldLifecycle.activity.descriptor;
    const world = this.worldRuntime?.context;
    if (!runtime || !activity || activity.kind !== 'coop-mission' || !world) {
      powerUpRuntime.setCoopDefenseMapXpReference(null);
      return;
    }
    const configuration = resolveCoopMissionActivityConfiguration(activity, world.definition);
    const humanPlayerCount = Math.max(
      1,
      Math.floor(bridge.getRoundState()?.coopDefenseHumanPlayerCount ?? 1),
    );
    powerUpRuntime.setCoopDefenseMapXpReference(getCoopDefenseMapXpReference(
      configuration.mapConfig,
      resolveCoopDefenseMapPersistentSpawnConfigs(configuration.mapConfig, humanPlayerCount),
      humanPlayerCount,
    ));
  }

  /**
   * Aufbau und Abbau einer World ohne Activity folgen dem World-Kanal, nicht der Raumphase.
   *
   * Eine World **mit** Activity haengt weiterhin am Rundenwechsel: ihre Besetzung und ihr
   * Startzeitpunkt kommen aus der Runde. Eine World **ohne** Activity hat keinen Phasenwechsel,
   * auf den sie warten koennte - sie entsteht und vergeht mit ihrem Descriptor.
   */
  detectWorldChange(deferArenaToLobby = false): void {
    if (this.matchTerminated) return;
    const deferredMatchToLobby = deferArenaToLobby
      && bridge.getGamePhase() === 'LOBBY'
      && this.lastPhase === 'ARENA';
    if (deferredMatchToLobby && this.arenaExitEntityPresentation) return;
    const world = bridge.getWorldDescriptor();
    if (!world) {
      if (this.arenaBuilt
        && !this.worldLifecycle.activity.isActive()
        && bridge.getGamePhase() === 'LOBBY'
        && !deferredMatchToLobby) {
        this.onTransitionToLobby();
      }
      return;
    }
    // Eine neue Instanz derselben oder einer anderen World ersetzt die gebaute. Ohne diese
    // Pruefung bliebe nach einem LobbyWorld-Reset die alte Runtime stehen: es gibt eine World,
    // aber die lokal gebaute meint eine andere.
    const localWorld = this.worldLifecycle.descriptor;
    const worldChanged = this.arenaBuilt && (
      this.builtWorldRevision !== world.worldRevision
      || (localWorld !== null && !isSameWorldInstance(localWorld, world))
    );
    if (worldChanged) {
      const previousWorld = localWorld ?? this.worldRuntime?.descriptor ?? null;
      const previousDefinitionId = previousWorld?.definitionId;
      const lobbyToMatch = isLobbyWorldDefinitionId(previousDefinitionId ?? '')
        && !isLobbyWorldDefinitionId(world.definitionId);
      const matchToLobby = !isLobbyWorldDefinitionId(previousDefinitionId ?? '')
        && isLobbyWorldDefinitionId(world.definitionId);
      const lobbyPresentationStructureChanged = isLobbyWorldDefinitionId(previousDefinitionId ?? '')
        && isLobbyWorldDefinitionId(world.definitionId)
        && hasPersistentBaseConfigurationChanged(previousWorld, world);
      // Waehren des expliziten Arena-Exit-Fades bleibt die lokale Match-World bestehen, auch
      // wenn der Host bereits den WorldDescriptor entfernt oder der Lobby-Descriptor frueh ankommt.
      if (deferredMatchToLobby && matchToLobby) return;
      // Eine weiterverwendbare Darstellung steht entweder noch in der laufenden Runtime – so
      // erreicht ein Client den Wechsel – oder liegt bereits im Handoff, weil der Host seine
      // Instanz zuvor beendet hat.
      const reusablePresentation = this.worldRuntime?.presentation
        ?? this.worldPresentationHandoff.pending;
      const canFastReinstance = bridge.getGamePhase() !== 'ARENA'
        && isLobbyWorldDefinitionId(world.definitionId)
        && (this.pendingLobbyWorldReinstance
          || (isLobbyWorldDefinitionId(previousDefinitionId ?? '')
            && bridge.getActivityDescriptor() === null
            && reusablePresentation !== null));
      if (canFastReinstance) {
        // Clients still hold the old local lifecycle when the reliable replacement arrives.
        // The host already ended it while publishing the new descriptor; both paths converge
        // here before the new runtime is attached.
        if (lobbyPresentationStructureChanged) {
          this.pendingLobbyWorldPresentationRebuild = true;
        }
        if (!this.pendingLobbyWorldReinstance) {
          this.prepareLobbyWorldReinstance(lobbyPresentationStructureChanged);
        }
        this.onTransitionToArena();
        return;
      }
      if (lobbyToMatch || (bridge.getGamePhase() === 'ARENA' && !matchToLobby)) {
        this.onTransitionToArena();
        return;
      }
      this.onTransitionToLobby();
      return;
    }
    if (this.arenaBuilt && localWorld && isSameWorldInstance(localWorld, world)) {
      this.worldLifecycle.syncObservedActivity(bridge.getActivityDescriptor());
      return;
    }
    if (this.arenaBuilt || bridge.getActivityDescriptor() !== null) return;
    this.onTransitionToArena();
  }

  /**
   * Host-only: haelt waehrend der Lobby genau eine LobbyWorld offen.
   *
   * Sie ist eine gewoehnliche World ohne Activity und ohne Teilnehmer und laeuft ueber denselben
   * World-Kanal wie jede Match-World. Ihre Neuerzeugung nach einer Runde ist zugleich ihr Reset;
   * es gibt keinen zweiten Lobby-Lebenszyklus daneben.
   */
  hostSyncLobbyWorld(): void {
    if (!bridge.isHost() || this.matchTerminated) return;
    if (bridge.getGamePhase() !== 'LOBBY' || this.roundStartPending) return;

    const currentMode = bridge.getActiveGameMode();
    const persistentBaseUnlocked = isCoopDefenseMode(currentMode)
      && getStoredPersistentBaseUnlocked();
    const persistentBaseAreaStage = isCoopDefenseMode(currentMode)
      ? getStoredPersistentBaseAreaStage()
      : null;
    const currentWorld = this.worldLifecycle.descriptor;
    if (currentWorld !== null) {
      if (isLobbyWorldDefinitionId(currentWorld.definitionId)
        && bridge.getActivityDescriptor() === null) {
        if (this.lobbyWorldModeAtRevision === null) {
          this.lobbyWorldModeAtRevision = currentMode;
          this.lobbyWorldPersistentBaseUnlockedAtRevision = persistentBaseUnlocked;
          this.lobbyWorldPersistentBaseAreaStageAtRevision = persistentBaseAreaStage;
        } else if (this.lobbyWorldModeAtRevision !== currentMode
          || this.lobbyWorldPersistentBaseUnlockedAtRevision !== persistentBaseUnlocked
          || this.lobbyWorldPersistentBaseAreaStageAtRevision !== persistentBaseAreaStage) {
          const previousRevision = currentWorld.worldRevision;
          const worldRevision = nextMonotonicRevision(
            Math.max(this.lastRoundRevision, previousRevision),
            Date.now(),
          );
          this.lastRoundRevision = worldRevision;
          const nextWorld = createAuthoredWorldDescriptor(
            LOBBY_WORLD_DEFINITION_ID,
            worldRevision,
            resolveLobbyWorldParameters(persistentBaseUnlocked, persistentBaseAreaStage),
          );
          const lobbyPresentationStructureChanged = hasPersistentBaseConfigurationChanged(
            currentWorld,
            nextWorld,
          );
          this.prepareLobbyWorldReinstance(lobbyPresentationStructureChanged);
          this.lobbyWorldModeAtRevision = currentMode;
          this.lobbyWorldPersistentBaseUnlockedAtRevision = persistentBaseUnlocked;
          this.lobbyWorldPersistentBaseAreaStageAtRevision = persistentBaseAreaStage;
          this.worldLifecycle.beginCreate(nextWorld, null);
        }
      } else {
        this.lobbyWorldModeAtRevision = null;
        this.lobbyWorldPersistentBaseUnlockedAtRevision = null;
        this.lobbyWorldPersistentBaseAreaStageAtRevision = null;
      }
      return;
    }

    // Solange noch eine Match-World-Runtime steht - etwa waehrend der Lobby-Ausblendung nach dem
    // Rundenende - entsteht keine neue LobbyWorld. Sonst wuerde ihr Aufbau die alte Arena
    // mitten in der Transition ersetzen.
    if (this.arenaBuilt) return;

    const worldRevision = nextMonotonicRevision(this.lastRoundRevision, Date.now());
    this.lastRoundRevision = worldRevision;
    this.lobbyWorldModeAtRevision = currentMode;
    this.lobbyWorldPersistentBaseUnlockedAtRevision = persistentBaseUnlocked;
    this.lobbyWorldPersistentBaseAreaStageAtRevision = persistentBaseAreaStage;
    this.worldLifecycle.beginCreate(
      createAuthoredWorldDescriptor(
        LOBBY_WORLD_DEFINITION_ID,
        worldRevision,
        resolveLobbyWorldParameters(persistentBaseUnlocked, persistentBaseAreaStage),
      ),
      null,
    );
  }

  /**
   * Schliesst die alte LobbyWorld sofort und oeffnet ein kleines lokales Rebind-Fenster.
   * `buildWorld()` uebernimmt anschliessend den neuen World-Runtime-Aufbau; bis dahin bleiben
   * weder Spieler-Runtimes noch World-Aktionen an die alte Revision gebunden.
   */
  private prepareLobbyWorldReinstance(presentationStructureChanged = false): void {
    this.pendingLobbyWorldReinstance = true;
    this.pendingLobbyWorldPresentationRebuild = presentationStructureChanged;
    this.synchronizeLocalWorldLifecycle(null);
    this.hostUpdate.setActive(false);
    this.localArenaLoadReady = false;
    this.terrainSnapshotReady = false;
    this.roundStartPrepared = false;
    this.isLocalReady = false;
    bridge.setLocalReady(false);
    bridge.sendLocalPlacementPreview(null);
    this.ctx.arenaCountdown?.clear();
    this.localPlayerState.spectator = false;
    this.localPlayerState.overlayTrackedAlive = null;
    this.resetLocalArenaHudState();
    this.ctx.gameAudioSystem.playMusic('music_lobby');
    this.syncLobbySurface(true);
    this.ctx.leftPanel.setLobbyFieldsLocked(false);
    this.syncLobbyTimeOfDay();
  }

  // ── Host helpers called from ArenaScene.update() ─────────────────────────

  hostCheckReadyToStart(): void {
    // Defensiv: eine Runde darf ausschließlich aus einer sauberen LOBBY-Phase heraus starten.
    if (bridge.getGamePhase() !== 'LOBBY') return;
    if (this.roundStartPending) return;
    // "Alles stimmt überein" vor dem Start: ALLE verbundenen Spieler sind bereit UND haben ein
    // verbindliches Loadout (im Coop zusätzlich ein Coop-Profil) – siehe areAllPlayersReady. Da die
    // Ready-Flags beim Rundenwechsel host-autoritativ zurückgesetzt wurden, kann hier kein veralteter
    // Stand aus der Vorrunde durchschlagen.
    if (!bridge.areAllPlayersReady()) return;
    if (this.roomQualityMonitor.shouldBlockStart()) return;
    this.roundStartPending = true;
    this.lobbyOverlay.lockButton();
    // Autoritativen Lobby-Snapshot final aktualisieren, damit der Stand, mit dem gestartet wird,
    // exakt dem entspricht, gegen den die Clients beim "Bereit" geprüft haben.
    bridge.publishLobbySync();
    bridge.setMatchHostId();
    bridge.resetAllFrags();
    bridge.resetCoopDefenseRoundXp();
    // Der Endstand der Vorrunde bleibt in der Lobby sichtbar, wird aber beim Start atomar
    // geleert. So kann ein Client beim naechsten Phasenwechsel keine veraltete Auswertung zeigen.
    bridge.publishRoundResults([]);
    bridge.publishCoopDefenseEncounterPresentationState(null);
    bridge.publishCoopDefenseMapEventPresentationState(null);
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(null);
    bridge.publishCoopDefenseMissionProgressPresentationState(null);
    const coopDefenseMapConfig = isCoopDefenseMode(bridge.getGameMode())
      ? getCoopDefenseMapConfig(bridge.getCoopDefenseMapId())
      : null;
    applyArenaMetricsForMode(
      bridge.getGameMode(),
      'ARENA',
      coopDefenseMapConfig?.arenaWidthCells,
      coopDefenseMapConfig?.arenaHeightCells,
    );
    // Enter ARENA with no gameplay timestamp yet. The round revision is the identity used by
    // the separate local arena-load barrier; it must not be confused with Lobby Ready or with
    // the later authoritative gameplay start timestamp.
    // Keep the revision monotone even when an abort/restart happens within the same millisecond;
    // a stale reliable acknowledgement must never be able to match a new round by coincidence.
    // Die LobbyWorld endet mit dem Matchstart. Ohne diesen Schnitt haelten Host und Clients im
    // Wartefenster bis zum Match-Descriptor die Lobby-Instanz fuer die Rundenwelt. Ihre
    // Teilnehmer fallen mit ihr - kein Testgelaende-Spieler reist in die Match-World mit.
    this.detachAllWorldPlayers();
    this.worldLifecycle.endInstance();
    this.clearWorldAdmission();
    this.lobbyWorldModeAtRevision = null;
    this.lobbyWorldPersistentBaseUnlockedAtRevision = null;
    this.lobbyWorldPersistentBaseAreaStageAtRevision = null;
    this.pendingLobbyWorldReinstance = false;
    this.pendingLobbyWorldPresentationRebuild = false;
    const roundRevision = nextMonotonicRevision(this.lastRoundRevision, Date.now());
    this.lastRoundRevision = roundRevision;
    bridge.hostStartRoundParticipants(bridge.getConnectedPlayerIds(), 0, roundRevision);
    bridge.setArenaStartTime(0);
    bridge.setRoundEndTime(0);
    bridge.requestFullGameState();
    const timeOfDayMinutes = resolveRoundTimeOfDayMinutes(coopDefenseMapConfig, bridge.getLobbyTimeOfDayMinutes());
    const seed = Date.now();
    // The phase and participation state deliberately become visible before the expensive
    // generator/fingerprint step. The next scene tick installs the loading veil and schedules
    // generation, so a host never blocks the lobby while still reporting LOBBY.
    this.pendingHostArenaGeneration = {
      roundRevision,
      gameMode: bridge.getGameMode(),
      mapConfig: coopDefenseMapConfig,
      seed,
      // Auf einer Kampagnenkarte ist der Basiskern Map-Inhalt: Wer die Karte erreicht, hat die
      // Basis laengst freigeschaltet. Nur die LobbyWorld fragt das Entitlement ab, weil dort
      // "besitzt der Spieler eine Basis" die eigentliche Aussage ist.
      worldParameters: coopDefenseMapConfig?.persistentBase
        ? {
          persistentBaseUnlocked: true,
          persistentBaseAreaStage: getStoredPersistentBaseAreaStage(),
        }
        : undefined,
    };
    const roundState: RoundState = {
      status: 'active',
      roundStartTime: 0,
      timeOfDayMinutes,
      coopDefenseHumanPlayerCount: isCoopDefenseMode(bridge.getGameMode())
        ? Math.max(1, bridge.getConnectedPlayers().length)
        : undefined,
      coopDefenseMapId: isCoopDefenseMode(bridge.getGameMode())
        ? bridge.getCoopDefenseMapId()
        : undefined,
    };
    bridge.publishRoundState(roundState);
    bridge.setGamePhase('ARENA');
  }

  /** Called after the shared chunk scheduler has had its frame budget. */
  syncArenaLoadReady(view: WorldViewRect | null): void {
    if (this.matchTerminated || !this.arenaBuilt) return;
    this.syncAuthoritativeRoundStartAnchors();
    // Der Ladezustand gehoert zur World-Instanz, nicht zur Runde.
    const worldRevision = bridge.getWorldDescriptor()?.worldRevision ?? 0;
    if (worldRevision <= 0) return;

    // Ohne lokale World-Presentation gibt es nichts darzustellen und damit nichts zu laden.
    // Ein Host, der eine Shared World nur simuliert, ist sofort bereit.
    if (!this.getLocalWorldPresentation().required) {
      bridge.setLocalWorldLoadReady(worldRevision, true);
      this.localArenaLoadReady = true;
      if (bridge.isHost()) this.tryScheduleArenaStart();
      return;
    }
    if (!view || !this.worldRuntime?.materialization?.arena || !this.worldRuntime.presentation?.layout) return;

    const work = this.collectWorldRenderWork(view);
    // Die replizierte Barriere wartet zusaetzlich auf den Terrain-Farb-Snapshot; der Boot-Reveal
    // tut das ausdruecklich nicht (siehe getWorldRevealState).
    const localRenderReady = work.renderReady && this.terrainSnapshotReady;
    const loadProgress = resolveWorldLoadProgress(work.pending, work.resident, localRenderReady);
    bridge.setLocalWorldLoadProgress(
      worldRevision,
      loadProgress.progress,
      loadProgress.stage,
      loadProgress.ready,
    );
    this.localArenaLoadReady = loadProgress.ready;

    if (bridge.isHost()) this.tryScheduleArenaStart();
  }

  /** View-bezogene Ladearbeit gehoert der aktiven World-Presentation-Verdrahtung. */
  private collectWorldRenderWork(view: WorldViewRect) {
    return this.worldRuntime?.presentationFrame?.getWorldRenderWork(view)
      ?? { pending: 0, resident: 0, renderReady: false };
  }

  /**
   * Darstellungszustand der lokalen World fuer den Boot-Reveal: steht die Welt so vollstaendig,
   * dass ein deckender Ladescreen ihr weichen darf?
   *
   * Bewusst getrennt von der replizierten Ladebarriere - hier zaehlt allein, was der Spieler
   * sieht. Der Terrain-Farb-Snapshot speist nur den Leaf-Blower, laeuft asynchron und darf den
   * Reveal deshalb nicht aufhalten; Runden- und Netzbedingungen haben hier ohnehin keinen Platz.
   */
  getWorldRevealState(view: WorldViewRect | null): { ready: boolean; progress: number } {
    // Ein technischer Abbruch zeigt seine eigene Meldung; der Ladescreen darf sie nicht verdecken.
    if (this.matchTerminated) return { ready: true, progress: 100 };
    // Wer nichts darstellt, hat nichts zu zeigen und damit nichts abzuwarten.
    if (this.arenaBuilt && !this.getLocalWorldPresentation().required) {
      return { ready: true, progress: 100 };
    }
    if (!this.arenaBuilt || !view || !this.worldRuntime?.materialization?.arena
      || !this.worldRuntime.presentation?.layout) {
      return { ready: false, progress: 0 };
    }
    const work = this.collectWorldRenderWork(view);
    const loadProgress = resolveWorldLoadProgress(work.pending, work.resident, work.renderReady);
    return { ready: loadProgress.ready, progress: loadProgress.progress };
  }

  /**
   * World Loading und Round Loading sind getrennte Bedingungen.
   *
   * Die replizierte Ladebarriere beantwortet nur: steht die World bei allen Teilnehmern? Ob die
   * Runde starten darf, entscheidet zusaetzlich der host-lokale Rundenaufbau – Spawns und
   * Startup-Caches. Eine World ohne Activity waere fertig geladen, ohne dass je eine Runde
   * beginnt; genau deshalb duerfen beide Bedingungen nicht in einem Flag stecken.
   */
  private tryScheduleArenaStart(): void {
    if (!bridge.isHost() || bridge.getGamePhase() !== 'ARENA') return;
    if (bridge.getArenaStartTime() > 0) return;
    if (!bridge.areWorldParticipantsLoadReady()) return;
    if (!this.prepareRoundStart(Date.now())) return;

    const arenaStartTime = resolveArenaStartTime(Date.now());
    bridge.setArenaStartTime(arenaStartTime);
    bridge.setRoundEndTime(this.resolveRoundEndTime(arenaStartTime));

    const currentRoundState = bridge.getRoundState();
    if (currentRoundState?.status === 'active') {
      bridge.publishRoundState({ ...currentRoundState, roundStartTime: arenaStartTime });
    }
    this.syncAuthoritativeRoundStartAnchors();
    this.hostUpdate.setActive(true);
  }

  private syncAuthoritativeRoundStartAnchors(): void {
    const roundStartTime = bridge.getArenaStartTime();
    if (roundStartTime <= 0 || roundStartTime === this.boundRoundStartTime) return;
    this.boundRoundStartTime = roundStartTime;
    this.timeOfDayController?.setRoundStartTime(roundStartTime);
    this.worldLifecycle.bindActivityStartAnchor(roundStartTime);
    this.worldTrainRuntime?.bindRoundStart(roundStartTime);
    this.worldPowerUpRuntime?.system.setArenaStartTime(roundStartTime);
  }

  private resolveRoundEndTime(arenaStartTime: number): number {
    if (!isCoopDefenseMode(this.resolveConfiguredGameMode())) {
      return arenaStartTime + ARENA_DURATION_SEC * 1000;
    }
    const mapConfig = getCoopDefenseMapConfig(this.resolveConfiguredCoopDefenseMapId());
    if (mapConfig?.objective !== 'survive') return 0;
    const surviveDurationSec = mapConfig.surviveDurationSec;
    if (surviveDurationSec === undefined) {
      throw new Error(`[ArenaLifecycleCoordinator] Survival map ${mapConfig.mapId} has no surviveDurationSec`);
    }
    return arenaStartTime + surviveDurationSec * 1000;
  }

  spawnReadyPlayers(): void {
    // The phase switches to ARENA before host generation now. Do not create activity/round
    // entities until buildArena has installed the matching layout and runtime systems.
    if (!bridge.isHost() || !this.arenaBuilt) return;
    // Die Features eines Spielers haengen an seiner Teilnahme. Sie muss aktuell sein, bevor
    // hier jemand eintritt - sonst bekaeme ein frisch Zugelassener die Module von gestern.
    this.hostSyncWorldParticipation();
    for (const profile of bridge.getConnectedPlayers()) {
      const canInitialSpawn = bridge.canPlayerInitialSpawn(profile.id);
      const reconnectAfterDeath = (this.playerActivityRuntime?.hasRespawnBudget ?? false)
        && bridge.canPlayerRespawn(profile.id);
      if ((canInitialSpawn || reconnectAfterDeath)
        && bridge.getPlayerReady(profile.id)
        && !this.ctx.playerManager.hasPlayer(profile.id)) {
        // Erst spawnen, wenn der host das verbindliche Loadout-Snapshot wirklich hat. Sonst würde
        // resolveCommittedLoadoutSelection() auf die separat propagierten Live-Slots zurückfallen –
        // die bei umgekehrter Key-Reihenfolge noch veraltet sein können (Ursache von "mit falscher
        // Waffe gestartet"). Das Match startet ohnehin erst, wenn alle committed sind (areAllPlayersReady),
        // daher verzögert das den Spawn höchstens um wenige Frames im Countdown.
        if (!this.hostHasCommittedLoadoutForSpawn(profile.id)) continue;
        // Ein Weg hinein: der gemeinsame Player-Lifecycle. Lehnt ein Modul ab, bleibt der Spieler
        // unberuehrt statt halb initialisiert.
        this.attachPlayerToWorld(profile, reconnectAfterDeath);
      }
    }
    // Ein neuer Runtime-Eintrag verschiebt die Teilnahme von `joining` auf `interactive`.
    this.hostSyncWorldParticipation();
  }

  /**
   * Round Loading: die host-lokale Startbedingung der Runde, unabhaengig vom World-Ladezustand.
   *
   * Sie ist erfuellt, wenn jeder aktive Rundenteilnehmer wirklich in der Welt steht und der
   * Host-Tick seine Caches aufgebaut hat.
   */
  private prepareRoundStart(now: number): boolean {
    if (!bridge.isHost() || this.roundStartPrepared) return this.roundStartPrepared;

    // A reconnect or a delayed committed-loadout snapshot can make the initial spawn arrive one
    // or more frames after the arena itself. Keep the cache gate behind the actual spawn state.
    this.spawnReadyPlayers();
    const participation = bridge.getRoundParticipation();
    if (!participation || participation.roundRevision <= 0) return false;

    // Wer aktiv teilnimmt, entscheidet die Teilnahme-Policy – nicht eine zweite Filterregel hier.
    const requiredIds = getActiveRoundParticipantIds(
      participation,
      [...bridge.getConnectedPlayerIds(), bridge.getLocalPlayerId()],
    );
    if (requiredIds.length === 0) return false;
    const allInitialPlayersSpawned = requiredIds.every((id) => {
      const player = this.ctx.playerManager.getPlayer(id);
      return player?.active === true && this.ctx.combatSystem.isAlive(id);
    });
    if (!allInitialPlayersSpawned) return false;

    this.hostUpdate.prepareStartupCaches(now);
    this.roundStartPrepared = true;
    return true;
  }

  /**
   * Host: True, wenn das verbindliche Loadout (und im Coop-Modus das Coop-Profil) eines Spielers
   * vorliegt – Vorbedingung, um ihn mit der korrekten, eingefrorenen Auswahl zu spawnen statt mit
   * einem Live-Slot-Fallback. Spiegelt die Pro-Spieler-Bedingung aus {@link NetworkBridge.areAllPlayersReady}.
   */
  private hostHasCommittedLoadoutForSpawn(playerId: string): boolean {
    if (!bridge.hasCommittedLoadout(playerId)) return false;
    if (isCoopDefenseMode(this.resolveConfiguredGameMode()) && !bridge.hasCommittedCoopDefenseProfile(playerId)) return false;
    return true;
  }

  syncHostLoadoutsFromCommittedSelections(): void {
    if (!bridge.isHost()) return;
    this.syncHostCoopDefensePlayerModifiersFromCurrentBuild();
    this.persistentBaseWorldBinding?.refreshForRelevantBuildChanges();
    const playerGameplay = this.worldPlayerGameplayRuntime;
    if (!playerGameplay) return;
    for (const profile of bridge.getConnectedPlayers()) {
      if (!this.ctx.playerManager.hasPlayer(profile.id)) continue;
      playerGameplay.reconcilePlayerLoadout(profile.id, this.resolveCommittedLoadoutSelection(profile.id));
      this.ctx.combatSystem.reconcilePlayerRuntimeState(profile.id);
    }
  }

  hostSaveRoundResults(roundEndedAt = Date.now(), countPvpMatch = false): void {
    if (!bridge.isHost()) return;
    const gameMode = this.resolveConfiguredGameMode();
    const roundState = bridge.getRoundState();
    const mapName = isCoopDefenseMode(gameMode)
      ? getMapName(this.resolveConfiguredCoopDefenseMapId(), getLocale())
      : 'Zufallsarena';
    const epicGuaranteeCount = isCoopDefenseMode(gameMode) && roundState?.status === 'victory'
      ? this.coopMissionRuntime?.coopDefenseSecondaryObjectiveSystem?.getEpicGuaranteeCount() ?? 0
      : 0;
    const eligibleIds = new Set(bridge.getRoundResultEligiblePlayerIds());
    const results: RoundResult[] = bridge.getConnectedPlayers()
      .filter((p) => eligibleIds.has(p.id))
      .map((p) => {
        const teamId = isTeamGameMode(gameMode) ? bridge.getPlayerTeam(p.id) : null;
        return {
          id:       p.id,
          name:     p.name,
          colorHex: p.colorHex,
          frags:    bridge.getPlayerFrags(p.id),
          teamId,
          roundEndedAt,
          gameMode,
          mapName,
          teamScore: gameMode === CAPTURE_THE_BEER_MODE && teamId
            ? this.captureTheBeerActivityRuntime?.system.getTeamScore(teamId) ?? 0
            : undefined,
          sharedXp: isCoopDefenseMode(gameMode) ? bridge.getCoopDefenseRoundXp() : undefined,
          epicGuaranteeCount: isCoopDefenseMode(gameMode) ? epicGuaranteeCount : undefined,
        };
      });
    bridge.publishRoundResults(results);
    if (countPvpMatch && !isCoopDefenseMode(gameMode)) {
      const winnerIds = resolvePvpWinnerIds(gameMode, results);
      bridge.recordCompletedPvpMatch([...eligibleIds], winnerIds);
    }
    bridge.hostPublishRoomStatistics();
  }

  /** Entfernt ausschliesslich die replizierte Darstellung der beendeten Coop-Activity. */
  private clearCoopMissionPresentationState(): void {
    bridge.publishCoopDefenseEncounterPresentationState(null);
    bridge.publishCoopDefenseMapEventPresentationState(null);
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(null);
    bridge.publishCoopDefenseMissionProgressPresentationState(null);
  }

  /** Publiziert den bestehenden Wire-Vertrag eines angewendeten, aktuellen Coop-Abschlusses. */
  private publishCoopMissionCompletion(
    completion: CoopMissionActivityCompletion,
    roundEndedAt: number,
  ): void {
    const conclusion = getCoopMissionConclusion(completion);
    this.publishRoundConclusion(conclusion, roundEndedAt);
    // Ein Abbruch liefert weiterhin die bis dahin erspielten Coop-XP, zaehlt aber nicht als
    // abgeschlossene PvP-Partie. Die lokale Progression bleibt Consumer dieses Snapshots.
    this.hostSaveRoundResults(roundEndedAt, conclusion !== 'aborted');
  }

  private publishRoundConclusion(
    roundConclusion: RoundConclusion | null,
    roundEndedAt: number,
  ): void {
    if (roundConclusion) {
      const currentRoundState = bridge.getRoundState();
      bridge.publishRoundState({
        status: roundConclusion,
        roundStartTime: bridge.getArenaStartTime(),
        timeOfDayMinutes: currentRoundState?.timeOfDayMinutes,
        coopDefenseBossSpawnedAtMs: currentRoundState?.coopDefenseBossSpawnedAtMs,
        coopDefenseHumanPlayerCount: currentRoundState?.coopDefenseHumanPlayerCount,
        coopDefenseMapId: currentRoundState?.coopDefenseMapId,
        resultEligiblePlayerIds: bridge.getRoundResultEligiblePlayerIds(),
        endedAt: roundEndedAt,
      });
    } else {
      bridge.publishRoundState(null);
    }
  }

  hostCompleteRound(roundConclusion: RoundConclusion | null = null): void {
    if (!bridge.isHost() || bridge.getGamePhase() !== 'ARENA') return;
    const roundEndedAt = Date.now();
    const activity = this.worldLifecycle.activity.descriptor;
    if (activity?.kind === 'coop-mission' && roundConclusion !== null) {
      const completion = createCoopMissionCompletion(activity, roundConclusion);
      // Der aktuelle Descriptor wurde gerade in den Completion-Vertrag kopiert. Ein false kann
      // deshalb nur einen bereits angewendeten oder inzwischen abgeloesten Abschluss bedeuten;
      // in beiden Faellen darf auch der Flow kein zweites Mal fortschreiten.
      if (!this.resultApplication.apply(completion, roundEndedAt)) return;
    } else {
      // PvP und der bestehende ergebnislose Ablauf besitzen heute keinen eigenen Activity-Result-
      // Consumer. Sie behalten ihren bisherigen Abschlussweg, ohne eine leere Abstraktion zu bauen.
      this.persistentBase.applyRoundConclusion(
        roundConclusion,
        this.resolvePersistentBaseTransactionIdentity(),
      );
      this.clearCoopMissionPresentationState();
      this.publishRoundConclusion(roundConclusion, roundEndedAt);
      this.hostSaveRoundResults(roundEndedAt, roundConclusion !== 'aborted');
    }
    bridge.publishCoopDefenseRespawnBudgetState(null);
    // Ein regulaerer Ausgang blendet die letzte Ansicht aus. Sie wird hier eingefroren, weil die
    // World-Instanz gleich endet und Player- wie Enemy-Runtime mit ihr fallen; der Fade zeigt
    // danach ausschliesslich diese Projektion.
    if (roundConclusion === 'victory' || roundConclusion === 'defeat') {
      this.captureArenaExitEntityPresentation();
    }
    // Diese Match-World endet hier gemeinsam mit ihrem Durchlauf. Ohne Phase, Activity und World bleibt kein
    // replizierter Weltzustand stehen, den eine spaetere Instanz faelschlich uebernehmen koennte.
    this.worldLifecycle.endInstance();
    this.clearWorldAdmission();
    this.lobbyWorldModeAtRevision = null;
    this.lobbyWorldPersistentBaseUnlockedAtRevision = null;
    this.lobbyWorldPersistentBaseAreaStageAtRevision = null;
    this.pendingLobbyWorldReinstance = false;
    this.pendingLobbyWorldPresentationRebuild = false;
    bridge.hostResetRoundParticipation();
    // Alle Spieler host-autoritativ auf "nicht bereit" setzen, BEVOR die Lobby-Phase greift. So ist der
    // Host-Zustandsspeicher garantiert sauber (auch wenn ein Client seinen Ready-Status nicht selbst
    // zurücksetzt) und es kann keine neue Runde durch stehengebliebene Ready-Flags sofort starten.
    bridge.hostResetAllLobbyReady();
    bridge.setGamePhase('LOBBY');
  }

  /**
   * Host: beendet die laufende Partie vorzeitig über das Optionsmenü – in jedem Modus. Läuft
   * bewusst durch {@link hostCompleteRound}, damit Endstand, Ready-Reset und Phasenwechsel exakt
   * dem regulären Rundenende entsprechen; der abweichende Status `aborted` steuert allein die
   * Beschriftung im Lobby-Panel. Im Coop-Modus trägt der publizierte RoundState damit auch ein
   * `endedAt`, wodurch die bis dahin erspielten XP wie nach Sieg/Niederlage gutgeschrieben werden.
   */
  hostAbortRound(): void {
    if (!bridge.isHost() || bridge.getGamePhase() !== 'ARENA') return;
    this.hostCompleteRound('aborted');
  }

  /**
   * Beendet eine interne Diagnose-Runde ohne Ergebnis, Fortschritt oder Raumstatistik.
   * Der regulaere Teardown bleibt am normalen ARENA→LOBBY-Phasenwechsel haengen.
   */
  hostDiscardRound(): void {
    if (!bridge.isHost() || bridge.getGamePhase() !== 'ARENA') return;
    const mapId = this.resolveConfiguredCoopDefenseMapId();
    if (!isWeaponBalanceLabMapId(mapId)) return;
    this.persistentBase.rollbackPersistentBaseMissionIfActive();
    bridge.publishCoopDefenseEncounterPresentationState(null);
    bridge.publishCoopDefenseMapEventPresentationState(null);
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(null);
    bridge.publishCoopDefenseMissionProgressPresentationState(null);
    bridge.publishRoundState(null);
    bridge.publishRoundResults([]);
    bridge.publishCoopDefenseRespawnBudgetState(null);
    this.worldLifecycle.endInstance();
    this.clearWorldAdmission();
    this.lobbyWorldModeAtRevision = null;
    this.lobbyWorldPersistentBaseUnlockedAtRevision = null;
    this.lobbyWorldPersistentBaseAreaStageAtRevision = null;
    this.pendingLobbyWorldReinstance = false;
    this.pendingLobbyWorldPresentationRebuild = false;
    bridge.hostResetRoundParticipation();
    bridge.hostResetAllLobbyReady();
    bridge.setGamePhase('LOBBY');
  }

  /** True, wenn der lokale Spieler die laufende Partie gerade abbrechen darf. */
  canHostAbortRound(): boolean {
    return bridge.isHost() && bridge.getGamePhase() === 'ARENA' && !this.matchTerminated;
  }

  /** True, solange die lokale Rolle eine laufende Runde verlassen darf. */
  canEnterSpectatorMode(): boolean {
    const localId = bridge.getLocalPlayerId();
    return bridge.getGamePhase() === 'ARENA'
      && !this.matchTerminated
      && maySendWorldInput(this.getWorldParticipation(localId));
  }

  /** Wird vom Optionsmenue nach der zweiten Bestaetigung aufgerufen. */
  enterSpectatorMode(): void {
    if (!this.canEnterSpectatorMode()) return;
    void bridge.requestSpectatorMode();
  }

  /**
   * Synchronisiert die lokale Rolle und entfernt gesperrte Entitaeten ohne Todespfad.
   * Dadurch gibt es weder Frag-/Kill-Callbacks noch einen Respawn-Timer fuer Spectatoren.
   */
  syncRoundParticipation(): void {
    if (bridge.getGamePhase() !== 'ARENA') {
      this.localPlayerState.spectator = false;
      return;
    }

    const localId = bridge.getLocalPlayerId();
    // Die Budget-Eliminierung ist nur eine lokale Darstellungs-/Aktionssperre. Die Netzwerkrolle
    // bleibt participant, damit Result-/Reward-Eligibility und der Round-Snapshot erhalten bleiben.
    const spectator = bridge.isRoundSpectator(localId)
      || bridge.getLocalCoopDefenseRespawnBudgetState()?.eliminated === true;
    this.localPlayerState.spectator = spectator;
    if (spectator) {
      this.localPlayerState.alive = false;
      this.localPlayerState.burrowed = false;
    }

    for (const player of [...this.ctx.playerManager.getAllPlayers()]) {
      if (!bridge.canPlayerSpawnOrRespawn(player.id)) {
        this.removePlayerFromActiveRound(player.id);
      }
    }
  }

  handleSpectatorEntered(playerId: string): void {
    if (bridge.getGamePhase() !== 'ARENA') return;
    this.persistentBase.removeGuestSessionOwner(playerId);
    this.removePlayerFromActiveRound(playerId);
    if (playerId === bridge.getLocalPlayerId()) {
      this.localPlayerState.spectator = true;
      this.localPlayerState.alive = false;
      this.localPlayerState.burrowed = false;
      this.localPlayerState.overlayTrackedAlive = null;
    }
  }

  /** Final owner-removal hook for explicit leave, expiry and spectator promotion. */
  handleGuestSessionOwnerRemoved(playerId: string): void {
    this.persistentBase.removeGuestSessionOwner(playerId);
  }

  getActiveConstructionToolsForPlayer(playerId: string): readonly LoadoutToolRef[] {
    return this.constructionWorldRuntime?.getActiveTools(playerId) ?? [];
  }

  getConstructionCapacityForPlayer(playerId: string): number {
    return this.constructionWorldRuntime?.getCapacity(playerId) ?? 0;
  }

  /** Gemeinsamer Entkopplungspfad fuer Spectator, Disconnect und Arena-Teardown. */
  /** Ein Weg hinaus: derselbe Lifecycle, gefiltert ueber denselben Kontext. */
  removePlayerFromActiveRound(playerId: string): void {
    if (bridge.isHost() && bridge.isArenaLoading() && bridge.getArenaStartTime() <= 0) {
      this.roundStartPrepared = false;
    }
    // Der Abbau raeumt immer den vollen Anteil ab – unabhaengig davon, wie weit der Spieler
    // gekommen war. Sonst bliebe von einem Beobachter Kampfzustand stehen.
    this.detachPlayerFromWorld(playerId);
  }

  /**
   * Teilnahme eines Spielers an der laufenden World.
   *
   * Kanonisch repliziert: der Host leitet sie einmal aus seinem autoritativen Zustand ab, alle
   * Peers lesen denselben Wert. Sie wird nirgends aus Runden- oder Phasenzustaenden
   * rekonstruiert - sonst hinge eine World ohne Runde an einer Runde.
   */
  getWorldParticipation(playerId: string): WorldParticipation {
    return bridge.getWorldParticipation(playerId);
  }

  /**
   * Host-seitige Admission: wer diese World-Instanz betreten hat. Die Aufnahme ist eine
   * separate Entscheidung von Room-Mitgliedschaft und RoundParticipation.
   *
   * Raum-Mitgliedschaft ist ausdruecklich **keine** World-Mitgliedschaft. Wer in der Lobby
   * steht, waehrend eine Shared World laeuft, bleibt ausserhalb, bis er wirklich eintritt.
   * Nur so gibt es ueberhaupt ein Join und ein Leave.
   */
  private readonly admittedToWorld = new Set<string>();

  /** Host-only: laesst einen Spieler in die laufende World eintreten. */
  hostAdmitToWorld(playerId: string): void {
    if (!bridge.isHost() || this.admittedToWorld.has(playerId)) return;
    this.admittedToWorld.add(playerId);
    this.hostSyncWorldParticipation();
  }

  /** Host-only: loest einen Spieler aus der World; er steht danach wieder in der Lobby. */
  hostRemoveFromWorld(playerId: string): void {
    if (!bridge.isHost() || !this.admittedToWorld.delete(playerId)) return;
    this.hostSyncWorldParticipation();
  }

  isAdmittedToWorld(playerId: string): boolean {
    return this.admittedToWorld.has(playerId);
  }

  /**
   * Ob diese World Eintritt und Austritt aus eigenem Entschluss zulaesst.
   *
   * Eine Activity taktet ihre Besetzung selbst ({@link admitActivityRoster}); daneben tritt
   * niemand eigenmaechtig ein oder aus. Ohne Activity fehlt dieser Taktgeber - dann entscheidet
   * die World selbst, ob ihre Tuer offensteht. Waehrend Aufbau, Abbruch und Matchstart bleibt
   * sie zu, damit keine Runtime in eine gerade endende Instanz faellt.
   */
  canSelfAdmitToWorld(): boolean {
    return bridge.getGamePhase() === 'LOBBY'
      && this.worldLifecycle.isActive()
      && this.arenaBuilt
      && !this.matchTerminated
      && !this.roundStartPending
      && !this.worldLifecycle.activity.isActive()
      && this.worldRuntime?.context.definition?.participationPolicy?.selfAdmit === true;
  }

  /**
   * Host-only: nimmt den Eintritts-/Austrittswunsch genau eines Spielers entgegen.
   *
   * Idempotent - Aufnahme und Entlassung aendern nur einen Set-Eintrag, und ein Wunsch, der den
   * Stand schon erfuellt, gilt trotzdem als erfuellt. Ein zweites Join erzeugt deshalb keine
   * zweite Runtime, ein zweites Leave keinen zweiten Abbau.
   */
  hostHandleWorldParticipationRequest(playerId: string, join: boolean): boolean {
    if (!bridge.isHost() || !this.canSelfAdmitToWorld()) return false;
    if (!bridge.getConnectedPlayerIds().includes(playerId)) return false;
    // Ready bedeutet abgeschlossene Vorbereitung. Ein bereit markierter Spieler darf daher
    // nicht neu in die interaktive LobbyWorld aufgenommen werden; Leave bleibt unabhaengig
    // davon moeglich und veraendert den Ready-State nicht.
    if (join && bridge.getPlayerReady(playerId)) return false;
    if (join) this.hostAdmitToWorld(playerId);
    else this.hostRemoveFromWorld(playerId);
    // Aufnahme und Runtime gehoeren zum selben Schritt: erst danach steht `interactive`.
    this.hostSyncWorldMembers();
    return true;
  }

  /** Der lokale Wunsch. Der Host entscheidet - auch dann, wenn er selbst der Antragsteller ist. */
  requestLocalWorldParticipation(join: boolean): void {
    void bridge.requestWorldParticipation(join);
  }

  /** True, solange der lokale Spieler in der laufenden World steht. */
  isLocalWorldParticipant(): boolean {
    return hasWorldRuntimeEntry(this.getWorldParticipation(bridge.getLocalPlayerId()));
  }

  /** True, wenn der gemeinsame PlayerWorldRuntime-Lifecycle diesen Spieler wirklich traegt. */
  isPlayerAttachedToWorld(playerId: string): boolean {
    return this.playerRuntime?.isAttached(playerId) ?? false;
  }

  /**
   * Host-only: schliesst `joining → interactive` ab und raeumt `leaving → none` auf.
   *
   * Eine Runde taktet den Eintritt ihrer Besetzung ueber {@link spawnReadyPlayers} - mit
   * Ready, committed Loadout und Spawn-Berechtigung. Eine World ohne Activity hat diesen Takt
   * nicht: dort folgt die Runtime unmittelbar der Aufnahme, ueber denselben gemeinsamen
   * Player-Lifecycle und ohne einen einzigen Rundenbegriff.
   */
  hostSyncWorldMembers(): void {
    if (!bridge.isHost() || !this.arenaBuilt || this.matchTerminated) return;
    if (!this.worldLifecycle.isActive() || this.worldLifecycle.activity.isActive()) return;

    let changed = false;
    for (const profile of bridge.getConnectedPlayers()) {
      const admitted = this.isAdmittedToWorld(profile.id);
      if (admitted === this.ctx.playerManager.hasPlayer(profile.id)) continue;
      if (admitted) changed = this.attachPlayerToWorld(profile) || changed;
      else {
        this.detachPlayerFromWorld(profile.id);
        changed = true;
      }
    }
    // Wer den Raum verlassen hat, laesst keine Runtime zurueck - auch nicht mitten im Eintritt.
    const connected = new Set(bridge.getConnectedPlayerIds());
    for (const player of [...this.ctx.playerManager.getAllPlayers()]) {
      if (connected.has(player.id)) continue;
      this.detachPlayerFromWorld(player.id);
      changed = true;
    }
    if (changed) this.hostSyncWorldParticipation();
  }

  /** Mit der World-Instanz endet jede Aufnahme in sie. */
  private clearWorldAdmission(): void {
    this.admittedToWorld.clear();
  }

  /**
   * Eine laufende Activity nimmt ihre eigene Rundenbesetzung auf.
   *
   * Das ist ein ausdruecklicher Aufnahmeakt der Activity, nicht die stillschweigende Annahme,
   * jeder im Raum sei in der World. Ohne Activity nimmt niemand automatisch auf.
   */
  private admitActivityRoster(): void {
    const roster = bridge.getRoundParticipation();
    if (!roster) return;
    for (const id of roster.participantIds) this.admittedToWorld.add(id);
    for (const id of roster.spectatorIds) this.admittedToWorld.add(id);
  }

  /**
   * Host-only: leitet den Teilnahmestand der World aus der Admission ab und repliziert ihn.
   *
   * Die einzige Stelle, an der Teilnahme entsteht. Sie liest die Admission - sie erfindet
   * keine. Was ein Mitglied darf, entscheidet die Activity; laeuft keine, handelt jedes
   * aufgenommene Mitglied.
   */
  hostSyncWorldParticipation(): void {
    // The host publishes the initial `joining`/`observer` snapshot while the local World is
    // still creating. Clients must wait for that snapshot before choosing their presentation.
    if (!bridge.isHost()
      || (this.worldLifecycle.phase !== 'active' && this.worldLifecycle.phase !== 'creating')) return;
    const activityPresent = this.worldLifecycle.activity.descriptor !== null;
    if (activityPresent) this.admitActivityRoster();

    const connected = bridge.getConnectedPlayers();
    const connectedIds = new Set(connected.map((profile) => profile.id));
    // Wer den Raum verlassen hat, ist auch aus der World heraus.
    for (const id of [...this.admittedToWorld]) {
      if (!connectedIds.has(id)) this.admittedToWorld.delete(id);
    }
    const participants: Record<string, WorldParticipation> = {};
    for (const profile of connected) {
      const member = this.admittedToWorld.has(profile.id);
      // Beim ersten Sync existiert der neue WorldParticipation-Snapshot noch nicht. Die
      // Activity-Besetzung muss deshalb aus der autoritativen Rundenrolle kommen und darf nicht
      // ueber getPlayerCapabilities() den gerade zu erzeugenden World-Snapshot wieder einlesen:
      // sonst waere jeder neue Teilnehmer zunaechst `none`, danach dauerhaft `observer`.
      const mayAct = member && (!activityPresent || bridge.getRoundRole(profile.id) === 'participant');
      participants[profile.id] = resolveWorldParticipation({
        worldActive: true,
        admitted: member,
        hasRuntimeEntry: this.ctx.playerManager.hasPlayer(profile.id),
        mayAct,
      });
    }
    bridge.hostPublishWorldParticipation(participants);
    // Die Ausgabe des Host-Ticks folgt seiner eigenen Teilnahme. Simuliert er eine World, an
    // der er nicht teilnimmt, laeuft derselbe Tick ohne jede Darstellung.
    this.hostUpdate.setPresentationActive(this.getLocalWorldPresentation().required);
  }

  /**
   * Ob dieser Peer die laufende World lokal darstellt.
   *
   * Die Simulation haengt nicht davon ab: ein Host kann eine Shared World autoritativ simulieren,
   * ohne selbst an ihr teilzunehmen – dann entsteht bei ihm keine World-Presentation.
   */
  getLocalWorldPresentation(): WorldPresentationRequirement {
    if (this.arenaExitEntityPresentation && this.worldPresentationHandoff.pending) {
      return {
        required: true,
        mode: 'interactive',
        surfaces: WORLD_PRESENTATION_SURFACES,
      };
    }
    return resolveWorldPresentation({
      participation: this.getWorldParticipation(bridge.getLocalPlayerId()),
      worldActive: this.worldLifecycle.isActive(),
      // Ob eine World auch ohne Teilnahme sichtbar sein darf, entscheidet ausschliesslich sie
      // selbst. Aus Raumzustand oder fehlender Activity wird das nie erschlossen.
      previewWithoutParticipation:
        this.worldRuntime?.context.definition?.presentationPolicy?.previewWithoutParticipation === true,
    });
  }

  isArenaExitPresentationActive(): boolean {
    return this.arenaExitEntityPresentation !== null
      && this.worldPresentationHandoff.pending !== null;
  }

  /**
   * Friert das letzte Entity-Bild ein und beendet danach sofort jede lokale Gameplay-Runtime.
   * Der World-Handoff behaelt nur die reine Darstellung; die Snapshots tragen keine Physics.
   */
  beginArenaExitPresentation(): void {
    // Auf dem Client steht die World hier noch; der Host hat sie mit dem Rundenabschluss bereits
    // beendet und sein Bild dort eingefroren. Beide Wege enden in derselben Projektion.
    this.captureArenaExitEntityPresentation();
    this.synchronizeLocalWorldLifecycle(null);
    this.tearDownArena(true);
  }

  /**
   * Friert das aktuelle Entity-Bild als reine Darstellung ein.
   *
   * Sie muss stehen, **bevor** die World-Instanz endet: Player- und Enemy-Runtime fallen mit ihr,
   * und ein sichtbarer Exit verlaengert keine Gameplay-Lifetime, sondern zeigt nur noch diese
   * physik- und managerfreie Projektion. Idempotent – wer zuerst kommt, friert ein.
   */
  private captureArenaExitEntityPresentation(): void {
    if (this.arenaExitEntityPresentation) return;
    const playerSprites = this.ctx.playerManager.getAllPlayers()
      .map((player) => player.displayObject)
      .filter((sprite): sprite is Phaser.GameObjects.Sprite => sprite !== null);
    const enemySprites = (this.coopMissionRuntime?.enemyManager?.getAllEnemies() ?? []).map((enemy) => enemy.sprite);
    this.arenaExitEntityPresentation = new ArenaExitEntityPresentation(
      this.scene,
      [...playerSprites, ...enemySprites],
    );
  }

  private clearArenaExitPresentation(): void {
    this.arenaExitEntityPresentation?.destroy();
    this.arenaExitEntityPresentation = null;
  }

  /**
   * Die lokale Lobby-Oberflaeche: Panel, Seitenmenues und Lobby-HUD.
   *
   * Sie folgt der Presentation, nicht der Raumphase. Wer die LobbyWorld betritt, soll sie
   * sehen – nicht das Panel darueber. Es ist derselbe Umschalter wie beim Rundenstart, nur
   * ohne Runde: Rundenflaechen (Timer, Missionsziele, Ergebnis) bleiben aus, weil keine
   * Activity laeuft, nicht weil hier eine zweite Regel sie ausblendet.
   */
  syncLobbySurface(showLobby: boolean): void {
    if (this.lobbySurfaceShown === showLobby) return;
    this.lobbySurfaceShown = showLobby;
    if (showLobby) {
      this.lobbyOverlay.show();
      this.ctx.leftPanel.transitionToLobby();
      this.ctx.rightPanel.transitionToLobby();
      this.ctx.centerHUD.transitionToLobby();
      return;
    }
    this.lobbyOverlay.hide();
    this.ctx.leftPanel.transitionToGame();
    this.ctx.rightPanel.transitionToGame();
    this.ctx.centerHUD.transitionToGame();
  }

  /**
   * Was dieser Spieler in der laufenden World konkret darf.
   *
   * Der Host loest die Policy aus seinem eigenen autoritativen Zustand auf und validiert damit;
   * ein Client benutzt dieselbe reine Regel nur fuer Eingabe-UX und Vorschau.
   */
  getPlayerCapabilities(playerId: string): PlayerCapabilities {
    return resolvePlayerCapabilities({
      participation: this.getWorldParticipation(playerId),
      activityKind: this.worldLifecycle.activity.kind,
      worldCombatAllowed: this.worldLifecycle.activity.kind !== null
        || this.worldRuntime?.context.definition?.actionPolicy?.combat === true,
    });
  }

  /**
   * Kontext des world-scoped Player-Lifecycles: Rolle und Teilnahme dieses Spielers.
   *
   * Die laufende Activity kommt hier nicht mehr vor - ihr Spieleranteil gehoert der
   * {@link CoopMissionPlayerRuntime} und faellt mit ihr.
   */
  private resolvePlayerFeatures(participation: WorldParticipation): PlayerRuntimeFeatures {
    return resolvePlayerRuntimeFeatures({
      isHost: bridge.isHost(),
      participation,
    });
  }

  /**
   * Einziger Attach-Pfad fuer Host und Client; WorldParticipation liefert den Kontext.
   *
   * `spawn` traegt die autoritative Startposition, wo der Aufrufer sie kennt - beim Client die
   * aus dem World-Snapshot gelesene. Der Host laesst sie leer und waehlt selbst.
   */
  attachPlayerToWorld(
    profile: PlayerProfile,
    reconnectAfterDeath = false,
    spawn?: { readonly x: number; readonly y: number },
  ): boolean {
    const playerRuntime = this.playerRuntime;
    if (!playerRuntime) return false;
    const attached = playerRuntime.attach(
      { profile, reconnectAfterDeath, spawn },
      this.resolvePlayerFeatures(this.getWorldParticipation(profile.id)),
    );
    // Erst die World, dann ihre Activity: Der Missionsanteil setzt eine stehende Figur voraus.
    if (attached) this.playerActivityRuntime?.attach(profile.id, reconnectAfterDeath);
    return attached;
  }

  /** Einziger Detach-Pfad fuer Host und Client; der volle Abbau bleibt idempotent. */
  detachPlayerFromWorld(playerId: string): void {
    // Umgekehrte Reihenfolge: Der Missionsanteil geht zuerst, solange seine Ziele noch stehen.
    this.playerActivityRuntime?.detach(playerId);
    this.worldPlayerGameplayRuntime?.invalidateHeldActionsForPlayer(playerId);
    this.playerRuntime?.detach(playerId);
  }

  /**
   * Loest jede Player-Runtime dieser World.
   *
   * Der Abbau folgt dem Materialisierungs-Ledger jedes Spielers, nicht einer erneut aufgeloesten
   * Policy. Idempotent, und fuer Host wie Client gueltig.
   */
  private detachAllWorldPlayers(): void {
    this.playerActivityRuntime?.detachAll();
    this.playerRuntime?.detachAll();
  }

  terminateMatch(reason?: string): void {
    // Ein Abbruch beendet auch einen laufenden Arena-Uebergang samt Retry-Kette; sonst bliebe
    // der Re-Eintritts-Guard nach einem Abbruch im Retry-Fenster dauerhaft gesetzt.
    this.arenaTransitionInProgress = false;
    if (this.matchTerminated) return;
    this.matchTerminated = true;
    this.arenaBuilt = false;
    this.builtWorldRevision = 0;
    this.arenaEnteredAt = 0;
    this.lobbyWorldModeAtRevision = null;
    this.lobbyWorldPersistentBaseUnlockedAtRevision = null;
    this.lobbyWorldPersistentBaseAreaStageAtRevision = null;
    this.pendingLobbyWorldReinstance = false;
    this.pendingLobbyWorldPresentationRebuild = false;

    // A technical abort can happen before the normal round-conclusion path runs. Never carry a
    // half-written mission working state into a later round in the same room.
    this.persistentBase.rollbackPersistentBaseMissionIfActive();

    this.isLocalReady = false;
    bridge.setLocalReady(false);
    if (bridge.isHost()) bridge.hostResetAllLobbyReady();
    this.roundStartPending = false;
    this.ctx.arenaCountdown?.clear();

    // Auch das Rundenende nimmt den gemeinsamen Weg hinaus; den Abbau der Spieler traegt der
    // World-Teardown selbst.
    this.tearDownArena();
    this.syncLobbySurface(true);
    this.ctx.leftPanel.setLobbyFieldsLocked(false);
    this.hostUpdate.setActive(false);

    // Die World-Instanz endet auf jedem Peer; den replizierten Kanal raeumt nur der Host.
    this.worldLifecycle.endInstance();
    this.clearWorldAdmission();
    if (bridge.isHost()) bridge.setGamePhase('LOBBY');

    this.lobbyOverlay.setReadyButtonState(false);
    if (reason) this.lobbyOverlay.showArenaFailureMessage(reason);
    else this.lobbyOverlay.showHostDisconnectedMessage();
  }

  // ── Arena build / teardown ────────────────────────────────────────────────

  /**
   * Baut die lokale Runtime einer World-Instanz auf.
   *
   * Der Aufbau gehoert der World: Metrik, Layout, Geometrie und Basisstelle folgen dem
   * `WorldDescriptor`. Eine Activity ist optional und haengt nur ihre eigenen Systeme an -
   * ohne sie entsteht eine vollstaendige, betretbare World ohne Runde.
   */
  buildWorld(
    worldDescriptor: WorldDescriptor,
    activityDescriptor: ActivityDescriptor | null,
    preserveLobbyPresentation = false,
  ): void {
    // Die Darstellung des Vorgaengers steht entweder noch in seiner Runtime oder liegt bereits
    // im Handoff – ein Uebergang endet nicht zwingend im selben Frame, in dem er beginnt.
    const reusablePresentation = preserveLobbyPresentation
      && isLobbyWorldDefinitionId(worldDescriptor.definitionId)
      && activityDescriptor === null
      ? this.worldRuntime?.presentation ?? this.worldPresentationHandoff.pending
      : null;
    const prepared = this.preparedRoundLayout;
    this.tearDownArena(reusablePresentation !== null);
    // Materialisierungsrezepte gehören zur vorherigen Activity/World und dürfen eine neue World
    // ohne Activity nicht in eine spätere Mission hineinvererben.

    // Merge-Baseline der Delta-Slices (rocks/powerups/pedestals) verwerfen, damit keine Zustände aus
    // der Vorrunde in die neue Runde lecken (z. B. beschädigte Felsen direkt zu Match-Beginn).
    bridge.resetGameStateCache();

    // Spielerzahl und Gegnerbesetzung sind Activity-Zustand und existieren nur mit ihr.
    const roundState = activityDescriptor ? bridge.getRoundState() : null;
    const preparedWorld = prepareWorldComposition({
      descriptor: worldDescriptor,
      activity: activityDescriptor,
      roomGameMode: bridge.getActiveGameMode(),
      humanPlayerCount: roundState?.coopDefenseHumanPlayerCount ?? 1,
      preparedLayout: prepared,
    });
    const {
      world,
      mode: layoutMode,
      mapConfig: coopDefenseMapConfig,
      isCoopMission,
      humanPlayerCount: coopDefenseHumanPlayerCount,
      bases: worldBases,
      locallyGeneratedLayout,
    } = preparedWorld;
    // Die authored Map gehoert der World - Missionssysteme entstehen aber nur mit laufender
    // Mission. Ohne diese getrennte Sicht wuerde eine Coop-World ohne Activity Bosse, Ziele und
    // Respawn-Budgets aufbauen, fuer die es keine Runde gibt.
    const missionMapConfig = isCoopMission ? coopDefenseMapConfig : null;
    const activityConfiguration = isCoopMission && activityDescriptor?.kind === 'coop-mission'
      ? resolveCoopMissionActivityConfiguration(activityDescriptor, world.definition)
      : null;
    // Die lokale Runtime haengt sich an die laufende World-Instanz; der Lifecycle prueft, dass
    // Runtime und Instanz dieselbe World meinen.
    this.worldLifecycle.attachRuntime(world, activityDescriptor);
    const coopMissionRuntime = isCoopMission ? this.coopMissionRuntime : null;
    if (isCoopMission && !coopMissionRuntime) {
      throw new Error('[ArenaLifecycleCoordinator] Coop activity runtime was not attached');
    }
    // Die World laeuft ab hier. Wer an ihr teilnimmt, entscheidet der Host sofort - sonst
    // haette die neue Instanz einen Frame lang gar keinen Teilnahmestand.
    this.hostSyncWorldParticipation();
    const presentation = this.getLocalWorldPresentation().required;
    this.preparedRoundLayout = null;
    bridge.setLocalWorldLoadProgress(worldDescriptor.worldRevision, 35, 'building');
    const coopDefensePersistentSpawnConfigs = activityConfiguration
      ? resolveCoopDefenseMapPersistentSpawnConfigs(activityConfiguration.mapConfig, coopDefenseHumanPlayerCount)
      : [];
    // Ziele, Fortschritt und Barrieren gehoeren der Coop-Activity; sie entstehen und fallen mit
    // ihr und brauchen deshalb kein Zuruecksetzen im World-Aufbau.
    const persistentBaseSite = world.persistentBaseSite;
    const persistentBaseVisualSite = resolvePersistentBaseVisualSite(
      missionMapConfig,
      persistentBaseSite,
      worldDescriptor.seed,
    );
    const persistentBaseGravel = persistentBaseVisualSite
      ? toPersistentBaseGravelZone(persistentBaseVisualSite, worldDescriptor.seed)
      : null;
    this.persistentBaseVisualSite = persistentBaseVisualSite;
    this.persistentBasePreviewRenderer.sync(
      persistentBaseSite === null ? persistentBaseVisualSite : null,
      world.metrics,
    );
    const worldRuntime = this.worldRuntime;
    if (!worldRuntime) throw new Error('[ArenaLifecycleCoordinator] WorldRuntime was not attached');
    const builtWorld = materializeWorldComposition({
      scene: this.scene,
      runtime: worldRuntime,
      prepared: preparedWorld,
      presentationRequired: presentation,
      reusablePresentation,
      handoff: this.worldPresentationHandoff,
      persistentBaseGravel,
      playerManager: this.ctx.playerManager,
      baseDestructionHooks: {
        playExplosion: (x, y, radius, color) => {
          this.ctx.effectSystem.playExplosionEffect(x, y, radius, color);
        },
        playExplosionSound: (x, y, volumeScale) => {
          this.ctx.gameAudioSystem.playSound('sfx_explosion_he', x, y, undefined, volumeScale);
        },
        playFireChunks: (x, y, targets, landsAt, now) => {
          this.renderers.flamethrowerUpgrades.playFireChunkBurst(x, y, targets, landsAt, now);
        },
        onFireChunksLanded: bridge.isHost()
          ? (baseId, _cellIndex, targets, landedAt) => {
            for (const target of targets) {
              this.ctx.fireSystem.hostRefreshGroundCell(target.x, target.y, {
                sourceKey: `base-destruction:${baseId}`,
                ownerId: COOP_DEFENSE_BASE_TURRET_OWNER_ID,
                durationMs: BASE_DESTRUCTION_GROUND_FIRE_DURATION_MS,
                burn: {
                  durationMs: BASE_DESTRUCTION_GROUND_BURN_DURATION_MS,
                  damagePerTick: BASE_DESTRUCTION_GROUND_BURN_DAMAGE_PER_TICK,
                },
                sourceId: 'ground_fire.base_destruction',
              }, landedAt);
            }
          }
          : undefined,
      },
      lighting: this.renderers.lighting,
      createRockRegistry: bridge.isHost(),
    });
    const {
      materialization,
      persistentBase: persistentBaseBinding,
      layout,
      arena: arenaResult,
      placement: placementSystem,
      bases: baseManager,
    } = builtWorld;
    this.persistentBase.useWorldRuntimes(persistentBaseBinding.constructionRuntimes);
    if (coopMissionRuntime && baseManager && missionMapConfig && activityDescriptor) {
      this.attachCoopMissionBaseBinding(activityDescriptor, coopMissionRuntime);
    }
    bridge.setLocalWorldLoadProgress(worldDescriptor.worldRevision, 60, 'building');
    // Der Basiskern und sein committed Contribution-State gehoeren zur persistenten World. Nur
    // eine aktive Mission oeffnet zusaetzlich eine Working Copy; die LobbyWorld bearbeitet den
    // committed Stand dagegen unmittelbar.
    if (bridge.isHost() && persistentBaseSite !== null) {
      if (!isValidPersistentBaseSite(persistentBaseSite)) {
        throw new Error(
          `[ArenaLifecycleCoordinator] Persistent base anchor cannot resolve on world ${world.descriptor.definitionId}`,
        );
      }
      // Der Identity-Hook bereitet den committed Stand vor und oeffnet den Working State bereits
      // beim Activity-Beginn. Nur eine Activity-lose World muss ihren committed Raumstand hier
      // rehydrieren; der World-Aufbau startet oder beendet keine Transaction.
      if (!this.persistentBase.session.hasOpenTransaction) {
        this.persistentBase.ingestOfferedPersistentBaseContributions();
        this.persistentBaseRewards.replaceCommittedState(getStoredPersistentBaseRewardState());
      }
      if (activityDescriptor !== null && !this.persistentBase.session.hasOpenTransaction) {
        throw new Error(
          '[ArenaLifecycleCoordinator] Activity identity has no PersistentBase transaction',
        );
      }
      persistentBaseBinding.setSite(persistentBaseSite.anchor, persistentBaseSite.buildArea);
    } else {
      persistentBaseBinding.setSite(null, null);
    }
    // Der konkrete World-Gameplay-Graph entsteht an seiner eigenen Composition-Grenze; der Flow
    // kennt weder die beteiligten Systeme noch ihre Verdrahtung.
    this.worldGameplay = composeArenaWorldGameplay({
      scene: this.scene,
      ctx: this.ctx,
      renderers: this.renderers,
      rockVisualHelper: this.rockVisualHelper,
      hostUpdate: this.hostUpdate,
      flow: this.worldGameplayFlowPorts,
      persistentBaseStores: {
        contributions: this.persistentBaseContributions,
        rewards: this.persistentBaseRewards,
      },
      worldRuntime,
      world,
      layout,
      layoutMode,
      arenaResult,
      placementSystem,
      baseManager,
      worldBases,
      persistentBaseBinding,
      presentation,
      isCoopMission,
      coopMissionRuntime,
      activityDescriptor,
    });

    if (coopMissionRuntime && activityConfiguration) {
      this.coopMissionComposition.materializeDependents(activityConfiguration, coopMissionRuntime);
      this.onCoopMissionRuntimeChanged(coopMissionRuntime);
    }

    // World-/Activity-renderers are owned by WorldTrainRuntime.
    this.renderers.translocatorTeleport = presentation ? new TranslocatorTeleportRenderer(this.scene) : null;
    this.renderers.translocatorTeleport?.setLightingSystem(this.renderers.lighting);
    // Uhrzeit vor dem Schattenaufbau setzen: zur Nacht hin werden die statischen
    // Sonnenschatten zu kurzen, blassen Mondschatten abgeschwächt.
    const timeOfDayMinutes = roundState?.timeOfDayMinutes
      ?? resolveRoundTimeOfDayMinutes(coopDefenseMapConfig, bridge.getLobbyTimeOfDayMinutes());
    this.roundTimeOfDayMinutes = timeOfDayMinutes;
    this.timeOfDayController = new ArenaTimeOfDayController({
      startMinutes: timeOfDayMinutes,
      roundStartTime: roundState?.roundStartTime ?? bridge.getArenaStartTime(),
      dynamic: coopDefenseMapConfig?.dynamicTimeOfDay,
      bossSpawnAtMs: coopDefenseMapConfig?.boss?.spawnAtMs,
    });
    const runtimeTimeOfDayMinutes = this.timeOfDayController
      .sample(bridge.getSynchronizedNow(), {
        bossSpawnedAtMs: roundState?.coopDefenseBossSpawnedAtMs,
      }).minutes;
    this.appliedRuntimeTimeOfDayMinutes = runtimeTimeOfDayMinutes;
    this.renderers.shadow.setTimeOfDay(runtimeTimeOfDayMinutes);
    if (presentation) {
      this.renderers.shadow.rebuildArenaStaticShadows(
        layout,
        arenaResult,
        placementSystem.getAllRuntimeRocks(),
        preserveLobbyPresentation,
      );
    }
    this.worldGeometryBinding?.attachLightOccluders(
      materialization,
      () => this.coopMissionRuntime?.coopDefenseMissionBarrierManager?.getObstacleRectangles() ?? null,
    );
    this.persistentBase.reconcilePersistentBaseWorld();
    this.renderers.lighting.setTimeOfDay(runtimeTimeOfDayMinutes);
    this.renderers.lighting.setActive(true);
    // Additive Effektgrafiken liegen teils über dem Lightmap-Overlay und werden vom
    // Ambient gar nicht erfasst; über hellem Boden brennen sie ohne diese Dämpfung aus.
    setEmissiveScale(resolveSkyState(runtimeTimeOfDayMinutes).emissiveScale);


    // Reset per-round state in coordinators
    this.hostUpdate.resetPerRound();
    this.clientUpdate.resetPerRound();
    this.trainDestroyedShown = false;
  }

  tearDownArena(preserveAuthoredPresentation = false): void {
    // Mit der World fallen ihre Spieler. Das gilt fuer jede Instanz und auf jedem Peer: ein
    // Testgelaende-Teilnehmer darf beim Matchstart genauso wenig stehen bleiben wie ein
    // Rundenteilnehmer beim Rundenende. Der Abbau laeuft vor dem Fachsystem-Cleanup, weil die
    // Detach-Module genau diese Systeme noch brauchen.
    this.detachAllWorldPlayers();
    // Danach faellt die konkrete Activity als ein Owner. Ihre Event-Handler werden dabei noch
    // vor den scene-langlebigen World-Gameplay-Bindings geloest; Enemy-State und Navigation
    // erreichen den anschliessenden globalen Cleanup nicht mehr als manuelle Systemliste.
    this.detachLocalActivityForTeardown();
    this.terrainSnapshotGenerationId += 1;
    const preserveTerrainSnapshot = preserveAuthoredPresentation && this.terrainSnapshotReady;
    if (!preserveTerrainSnapshot) {
      this.terrainSnapshotReady = false;
    }
    this.cancelPendingHostArenaGeneration();
    this.localArenaLoadReady = false;
    this.roundStartPrepared = false;
    this.preparedRoundLayout = null;
    this.boundRoundStartTime = 0;
    this.persistentBasePreviewRenderer.clear();
    this.persistentBaseVisualSite = null;
    this.timeOfDayController = null;
    this.appliedRuntimeTimeOfDayMinutes = null;
    this.roundTimeOfDayMinutes = DEFAULT_TIME_OF_DAY_MINUTES;
    // Beim World-Teardown gibt es keinen gebundenen Runtime-Zustand; neutral zurücksetzen, damit
    // die nächste World ihre Beleuchtung selbst setzt.
    setEmissiveScale(1);
    // Die scene-langlebigen Effektsysteme behalten keinen Bestand der vergangenen World.
    this.ctx.smokeSystem.destroyAll();
    this.ctx.fireSystem.destroyAll();
    this.ctx.stinkCloudSystem.destroyAll();
    this.ctx.effectSystem.clearAllBurrowStates();
    // Die Effektdarstellung der vergangenen World raeumt ihr eigener Owner ab.
    resetRenderersForWorldGameplayTeardown(this.renderers);
    // Laufende Kameraquellen und Trefferkopien dürfen nicht in die Lobby überlaufen.
    this.ctx.visualFeedback.reset();
    this.placementPreview.clearForTeardown();
    this.rockVisualHelper.destroyAllTurretVisuals();

    // Die lokale World-Runtime faellt: Bau-Runtime, Basen und die world-lokale Persistent-Base
    // fallen mit ihr. Ihre Darstellung geht in den Handoff und bleibt nur stehen, wenn der
    // naechste Aufbau sie uebernimmt.
    this.releaseWorldRuntime(preserveAuthoredPresentation);
    if (bridge.isHost()) {
      for (const player of bridge.getConnectedPlayers()) bridge.publishActiveBuffs(player.id, []);
    }
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(null);
    bridge.publishCoopDefenseMissionProgressPresentationState(null);
    bridge.publishCoopDefenseMapEventPresentationState(null);
    // Die World-Gameplay-Owner sind mit ihrer `WorldRuntime` bereits zerstoert; hier faellt nur
    // noch die Flow-Referenz auf die vergangene Instanz.
    this.worldGameplay = null;
    // Die World-Darstellung raeumt ihr eigener Owner ab; der Flow sagt nur, ob eine uebernommene
    // authored Presentation stehen bleibt.
    resetRenderersForWorldPresentationTeardown(this.renderers, preserveAuthoredPresentation);
    this.ctx.centerHUD.hideTrainWidget();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private scheduleHostArenaGeneration(request: {
    readonly roundRevision: number;
    readonly gameMode: GameMode;
    readonly mapConfig: CoopDefenseMapConfig | null;
    readonly seed: number;
    readonly worldParameters: WorldParameters | undefined;
  }): void {
    if (this.hostArenaGenerationTimer) return;

    this.hostArenaGenerationTimer = this.scene.time.delayedCall(0, () => {
      this.hostArenaGenerationTimer = null;
      if (this.pendingHostArenaGeneration !== request
        || this.matchTerminated
        || bridge.getGamePhase() !== 'ARENA'
        || bridge.getRoundParticipation()?.roundRevision !== request.roundRevision) {
        return;
      }

      // Keep the technical loading stage explicit while the synchronous generator runs. The
      // phase/overlay was already committed in the preceding frame; this callback is the only
      // place that performs the host's layout work for the new round.
      this.pendingHostArenaGeneration = null;
      bridge.setLocalWorldLoadProgress(request.roundRevision, 10, 'generating');
      try {
        applyArenaMetricsForMode(
          request.gameMode,
          'ARENA',
          request.mapConfig?.arenaWidthCells,
          request.mapConfig?.arenaHeightCells,
        );
        const worldMetrics = resolveWorldMetrics(getArenaMetricsProfile(
          request.gameMode,
          'ARENA',
          request.mapConfig?.arenaWidthCells,
          request.mapConfig?.arenaHeightCells,
        ));
        const layout = ArenaGenerator.generate(
          request.seed,
          resolveArenaGenerationInput(request.gameMode, worldMetrics),
          request.mapConfig ?? undefined,
        );
        const world: WorldDescriptor = {
          worldRevision: request.roundRevision,
          definitionId: toWorldDefinitionId(request.mapConfig?.mapId ?? null),
          seed: request.seed,
          generatorVersion: ARENA_GENERATOR_VERSION,
          layoutFingerprint: ArenaGenerator.fingerprint(layout),
          ...(request.worldParameters ? { parameters: request.worldParameters } : {}),
        };
        const activityKind = toActivityKind(request.gameMode);
        const activity: ActivityDescriptor = {
          activityRevision: request.roundRevision,
          worldRevision: request.roundRevision,
          kind: activityKind,
          definitionId: toActivityDefinitionId(activityKind, request.mapConfig?.mapId ?? null),
        };
        this.preparedRoundLayout = { descriptor: world, layout };
        // Der eine World-Kanal: Weltidentitaet und Activity gehen gemeinsam raus, abgeleitet
        // aus derselben lokal erzeugten Runde.
        this.worldLifecycle.beginCreate(world, activity);
        this.onTransitionToArena();
      } catch (error) {
        console.error('[ArenaLifecycleCoordinator] Lokale Arena konnte nicht aufgebaut werden:', error);
        this.terminateMatch(t('ui.lobby.arenaBuildFailed'));
      }
    });
  }

  private cancelPendingHostArenaGeneration(): void {
    this.hostArenaGenerationTimer?.remove(false);
    this.hostArenaGenerationTimer = null;
    this.pendingHostArenaGeneration = null;
  }

  private onTransitionToArena(): void {
    // Der Retry-Timer (delayedCall unten) und `detectWorldChange()` im Update-Loop koennen am
    // selben Frame feuern. Ohne Guard wuerde ein doppelter Eintritt den laufenden Snapshot
    // invalidieren und einen zweiten Build starten, der den ersten zerstoerten Scratch erbt.
    if (this.arenaTransitionInProgress) return;
    this.arenaTransitionInProgress = true;
    // Eine Runde nimmt jeden Teilnehmer mit hinein: dann verdeckt der unabhaengige Ladeschirm
    // die Arena, bevor der Descriptor da ist - ein Phasenwechsel darf sie im Wartefenster nie
    // zeigen. Eine World ohne Activity laesst die Lobby dagegen stehen: wer sie nicht betritt -
    // und ein Host, der sie nur simuliert - sieht weiterhin die Lobby.
    const entersWorld = bridge.getActivityDescriptor() !== null
      || requiresLocalWorldPresentation(bridge.getLocalWorldParticipation());
    if (entersWorld) {
      this.ctx.arenaCountdown?.showLoading();
      this.lobbyOverlay.lockButton();
      this.lobbyOverlay.hide();
    }
    // In ARENA ist die World erst mit ihrer Activity, dem aktiven Round-State und der passenden
    // RoundParticipation vollstaendig. Nur echte Activity-lose Worlds (z. B. die Lobby) duerfen
    // ausserhalb der ARENA-Phase ohne Activity aufgebaut werden.
    const worldDescriptor = bridge.getWorldDescriptor();
    const activityDescriptor = bridge.getActivityDescriptor();
    const roundState = bridge.getRoundState();
    const participation = bridge.getRoundParticipation();
    if (bridge.isHost() && bridge.getGamePhase() === 'ARENA') {
      // `publishWorldAndActivity()` intentionally published an empty participation snapshot.
      // Fill it from the host's authoritative admission before the shared readiness barrier.
      this.hostSyncWorldParticipation();
    }
    const activityReady = isArenaTransitionReady({
      phase: bridge.getGamePhase(),
      worldDescriptor,
      activityDescriptor,
      roundState,
      arenaStartTime: bridge.getArenaStartTime(),
      participation,
      worldParticipationState: bridge.getWorldParticipationState(),
      localPlayerId: bridge.getLocalPlayerId(),
    });
    const pendingHostGeneration = this.pendingHostArenaGeneration;
    if (bridge.isHost()
      && pendingHostGeneration
      && participation?.roundRevision === pendingHostGeneration.roundRevision
      && roundState?.status === 'active'
      && worldDescriptor?.worldRevision !== pendingHostGeneration.roundRevision) {
      this.arenaTransitionInProgress = false;
      this.scheduleHostArenaGeneration(pendingHostGeneration);
      return;
    }
    if (!worldDescriptor || !activityReady) {
      this.layoutRetryCount++;
      if (this.layoutRetryCount >= ArenaLifecycleCoordinator.LAYOUT_RETRY_LIMIT) {
        this.layoutRetryCount = 0;
        this.terminateMatch(t('ui.lobby.arenaTransitionTimeout'));
        return;
      }
      // Der Guard bleibt ueber das Retry-Fenster gesetzt und faellt erst, wenn dieser Timer
      // selbst wieder eintritt. So bleibt die Retry-Kette exklusiv: `detectWorldChange()` kann
      // waehrenddessen keinen zweiten, konkurrierenden Uebergang starten.
      this.scene.time.delayedCall(16, () => {
        this.arenaTransitionInProgress = false;
        this.onTransitionToArena();
      });
      return;
    }
    this.layoutRetryCount = 0;

    const { mode: layoutMode, mapConfig: coopDefenseMapConfig } = resolveWorldCompositionProfile(
      worldDescriptor,
      activityDescriptor,
      bridge.getActiveGameMode(),
    );
    applyArenaMetricsForMode(
      layoutMode,
      'ARENA',
      coopDefenseMapConfig?.arenaWidthCells,
      coopDefenseMapConfig?.arenaHeightCells,
    );
    const preserveLobbyPresentation = this.pendingLobbyWorldReinstance
      && !this.pendingLobbyWorldPresentationRebuild;
    const preserveTerrainSnapshot = preserveLobbyPresentation && this.terrainSnapshotReady;
    try {
      this.synchronizeLocalWorldLifecycle(worldDescriptor);
      this.buildWorld(
        worldDescriptor,
        activityDescriptor,
        preserveLobbyPresentation,
      );
    } catch (error) {
      console.error('[ArenaLifecycleCoordinator] Lokale Arena konnte nicht aufgebaut werden:', error);
      this.terminateMatch(t('ui.lobby.arenaBuildFailed'));
      return;
    }
    this.pendingLobbyWorldReinstance = false;
    this.pendingLobbyWorldPresentationRebuild = false;
    this.arenaBuilt = true;
    this.builtWorldRevision = worldDescriptor.worldRevision;
    this.localArenaLoadReady = false;
    this.terrainSnapshotReady = preserveTerrainSnapshot;
    if (this.getLocalWorldPresentation().required && !this.terrainSnapshotReady) {
      this.terrainSnapshotRetryCount = 0;
      this.startTerrainSnapshotBuild(worldDescriptor.worldRevision);
    } else if (!this.getLocalWorldPresentation().required) {
      this.terrainSnapshotReady = true;
    }

    for (const profile of bridge.getConnectedPlayers()) {
      // Mit Activity entscheidet deren Zulassung, ohne sie allein die World-Teilnahme. Eine
      // World ohne Runde kennt kein `canPlayerSpawnOrRespawn` - sie kennt nur, wer in ihr steht.
      const participation = bridge.getWorldParticipation(profile.id);
      const canCreatePlayer = activityDescriptor !== null
        ? bridge.canPlayerSpawnOrRespawn(profile.id)
          && (!bridge.isHost() || bridge.canPlayerInitialSpawn(profile.id))
        : hasWorldRuntimeEntry(participation) || participation === 'joining';
      if (canCreatePlayer
        && (activityDescriptor === null || bridge.getPlayerReady(profile.id))
        && !this.ctx.playerManager.hasPlayer(profile.id)) {
        this.attachPlayerToWorld(profile);
      }
    }

    // HUD-Flaechen und Arenamusik gehoeren zur lokalen World-Presentation. Wer die World nur
    // simuliert, behaelt Lobby-HUD und Lobby-Musik.
    if (entersWorld) {
      this.syncLobbySurface(false);
      this.resetLocalArenaHudState();
      this.ctx.gameAudioSystem.playMusic('music_arena');
    }
    this.syncHostLoadoutsFromCommittedSelections();
    this.localPlayerState.spectator = false;
    this.localPlayerState.overlayTrackedAlive = null;
    // Eine Activity wartet auf ihren gemeinsamen Startzeitpunkt. Eine World ohne Activity
    // laeuft sofort; sie besitzt keinen Round-Timestamp, auf den sie warten koennte.
    this.hostUpdate.setActive(activityDescriptor === null);
    this.arenaTransitionInProgress = false;
  }

  /**
   * Baut den Terrain-Farb-Snapshot der laufenden World-Instanz.
   *
   * Der Snapshot ist Teil der lokalen Ladebereitschaft: Ohne ihn bleibt der Ladeschirm stehen.
   * Deshalb hat hier jeder Pfad ein definiertes Ende - Erfolg, Abbruch oder Watchdog-Timeout -
   * und niemals einen stillen Early-Return ohne Nachfolger.
   */
  private startTerrainSnapshotBuild(worldRevision: number): void {
    const layout = this.worldRuntime?.presentation?.layout ?? null;
    const arenaResult = this.worldRuntime?.materialization?.arena ?? null;
    const world = this.worldRuntime?.context ?? null;
    if (!layout || !arenaResult || !world) {
      // Nach einem erfolgreichen Arenaaufbau muessen Layout, Arena-Ergebnis und World stehen.
      // Fehlt eines davon, gibt es keinen Nachfolge-Build mehr: deterministisch abbrechen.
      console.error('[ArenaLifecycleCoordinator] Terrain-Snapshot-Voraussetzungen fehlen nach Arena-Build.');
      this.terminateMatch(t('ui.lobby.terrainSnapshotStartFailed'));
      return;
    }

    const generation = ++this.terrainSnapshotGenerationId;
    const isCurrent = (): boolean => (
      generation === this.terrainSnapshotGenerationId
      && this.arenaBuilt
      && this.worldRuntime?.presentation?.layout === layout
      && this.worldRuntime?.materialization?.arena === arenaResult
      && bridge.getWorldDescriptor()?.worldRevision === worldRevision
    );

    bridge.setLocalWorldLoadProgress(worldRevision, 70, 'rendering');
    let build: Promise<import('../../arena/TerrainColorSnapshot').TerrainColorSnapshot>;
    try {
      build = new TerrainColorSnapshotBuilder({
        scene: this.scene,
        mode: this.resolveConfiguredGameMode(),
        layout,
        arenaResult,
        worldMetrics: world.metrics,
      }).build();
    } catch (error) {
      console.error('[ArenaLifecycleCoordinator] Terrain-Farb-Snapshot konnte nicht gestartet werden:', error);
      if (isCurrent()) this.terminateMatch(t('ui.lobby.terrainSnapshotStartFailed'));
      return;
    }

    // `settled` verriegelt Timeout und Promise gegeneinander, `isCurrent()` haelt verspaetete
    // Ergebnisse von neueren Builds fern.
    let settled = false;
    const timeoutTimer = this.scene.time.delayedCall(
      ArenaLifecycleCoordinator.TERRAIN_SNAPSHOT_TIMEOUT_MS,
      () => {
        if (settled || !isCurrent()) return;
        settled = true;
        if (this.terrainSnapshotRetryCount < ArenaLifecycleCoordinator.TERRAIN_SNAPSHOT_MAX_RETRIES) {
          this.terrainSnapshotRetryCount += 1;
          console.warn(
            '[ArenaLifecycleCoordinator] Terrain-Snapshot-Timeout, starte Retry',
            this.terrainSnapshotRetryCount,
          );
          this.startTerrainSnapshotBuild(worldRevision);
          return;
        }
        console.error('[ArenaLifecycleCoordinator] Terrain-Snapshot-Timeout nach maximalem Retry.');
        this.terminateMatch(t('ui.lobby.terrainSnapshotTimeoutFailed'));
      },
    );

    build.then((snapshot) => {
      if (settled || !isCurrent()) return;
      settled = true;
      timeoutTimer.remove(false);
      this.renderers.leafBlower.setTerrainColorSnapshot(snapshot);
      this.terrainSnapshotReady = true;
    }).catch((error: unknown) => {
      if (settled || !isCurrent()) return;
      settled = true;
      timeoutTimer.remove(false);
      console.error('[ArenaLifecycleCoordinator] Terrain-Farb-Snapshot fehlgeschlagen:', error);
      this.terminateMatch(t('ui.lobby.terrainSnapshotCreateFailed'));
    });
  }

  private get localPlayerState() { return this.hostUpdate['localPlayerState']; }

  /**
   * Beendet eine alte lokale World-Instanz vor dem Aufbau einer anderen.
   *
   * `WorldLifecycle.attachRuntime()` bleibt absichtlich strikt: Die Replacement-Orchestrierung
   * liegt hier, damit ein verzögertes Retry niemals eine Runtime an eine alte Instanz bindet.
   * `null` wird beim Lobby-Fast-Reinstance verwendet, wenn der eingehende Descriptor noch nicht
   * feststeht; in diesem Fall wird nur die aktuelle lokale Instanz beendet.
   */
  private synchronizeLocalWorldLifecycle(incomingWorld: WorldDescriptor | null): void {
    const currentWorld = this.worldLifecycle.descriptor;
    if (currentWorld && incomingWorld && isSameWorldInstance(currentWorld, incomingWorld)) return;

    this.detachAllWorldPlayers();
    if (currentWorld) this.worldLifecycle.endInstance();
    this.clearWorldAdmission();
  }

  private onTransitionToLobby(): void {
    this.arenaTransitionInProgress = false;
    this.arenaBuilt = false;
    this.builtWorldRevision = 0;
    this.arenaEnteredAt = 0;
    this.lobbyWorldModeAtRevision = null;
    this.lobbyWorldPersistentBaseUnlockedAtRevision = null;
    this.lobbyWorldPersistentBaseAreaStageAtRevision = null;
    this.pendingLobbyWorldReinstance = false;
    this.pendingLobbyWorldPresentationRebuild = false;
    this.isLocalReady = false;
    bridge.setLocalReady(false);
    this.roundStartPending = false;
    this.localPlayerState.spectator = false;
    this.localPlayerState.overlayTrackedAlive = null;
    this.ctx.arenaCountdown?.clear();
    this.resetLocalArenaHudState();
    this.ctx.gameAudioSystem.playMusic('music_lobby');

    // Auch das Rundenende nimmt den gemeinsamen lokalen World-Cleanup; die UI-Behandlung bleibt
    // trotzdem exklusiv in diesem vollstaendigen Lobby-Uebergang.
    this.synchronizeLocalWorldLifecycle(null);
    this.tearDownArena();
    this.clearArenaExitPresentation();
    this.syncLobbyTimeOfDay();

    this.syncLobbySurface(true);
    this.ctx.leftPanel.setLobbyFieldsLocked(false);
    const roundResults = bridge.getRoundResults();
    this.ctx.rightPanel.showRoomStatistics(bridge.getRoomPlayerStatistics());
    this.ctx.rightPanel.showRoundResults(
      bridge.isLocalRoundResultEligible(roundResults) ? roundResults : null,
      bridge.getRoundState(),
    );
    this.lobbyOverlay.setReadyButtonState(false);
  }

  /** Liefert das gemeinsame Boden-/Flowfield-Raster fuer Gegner-Sonderbewegungen. */
  private nextFlowFieldGenerationId(): number {
    this.flowFieldGenerationId += 1;
    return this.flowFieldGenerationId;
  }

  private resetLocalArenaHudState(): void {
    const config = this.clientUpdate.getLocalUltimateConfig();
    const radialAction = this.ctx.inputSystem.getSelectedRadialActionForHud();
    const managementAction = radialAction?.kind === 'management' ? radialAction.action : null;
    const persistentBaseRewardId = radialAction?.kind === 'persistent-reward'
      ? radialAction.rewardId
      : null;
    const hudData = buildInitialLocalArenaHudData({
      maxArmor: this.clientUpdate.getLocalMaxArmor(),
      maxAdrenaline: this.clientUpdate.getLocalMaxAdrenaline(),
      maxRage: this.clientUpdate.getLocalMaxRage(),
      ultimateRequiredRage: config.rageRequired,
      ultimateThresholds:   this.clientUpdate.getLocalUltimateThresholds(),
      ultimateId:            config.id,
      utilityId:             managementAction || persistentBaseRewardId
        ? undefined
        : this.clientUpdate.getLocalUtilityConfig().id,
      utilityAction:         managementAction ?? undefined,
      persistentBaseRewardId: persistentBaseRewardId ?? undefined,
      weapon2AdrenalineCost: this.clientUpdate.getLocalWeaponConfig('weapon2').adrenalinCost ?? 0,
    });
    this.ctx.leftPanel.updateArenaHUD(hudData);
    this.ctx.playerStatusRing?.update(hudData);
  }

  private syncHostCoopDefensePlayerModifiersFromCurrentBuild(): void {
    const playerGameplay = this.worldPlayerGameplayRuntime;
    if (!bridge.isHost() || !playerGameplay) return;

    const builds = new Map(
      bridge.getConnectedPlayers().map((profile) => [
        profile.id,
        bridge.getPlayerCurrentLoadoutSnapshot(profile.id),
      ] as const),
    );
    playerGameplay.reconcilePlayerBuildModifiers(
      builds,
      (playerId) => this.ctx.playerManager.hasPlayer(playerId),
    );
  }

  private resolveCommittedLoadoutSelection(playerId: string): LoadoutSelection {
    const activity = bridge.getActivityDescriptor();
    const committed = activity ? bridge.getPlayerCommittedLoadout(playerId) : null;
    if (!committed) {
      // Eingefroren wird eine Auswahl nur fuer eine Runde. Ohne Activity gibt es nichts
      // einzufrieren – dort ist die laufende Lobby-Auswahl die richtige Quelle, kein Fehlerfall.
      // Innerhalb einer Runde bleibt es der bekannte Risikofall ("falsche Waffe") und wird
      // geloggt, damit er im Realbetrieb auffaellt.
      if (this.worldLifecycle.activity.isActive()) {
        console.warn(`[Loadout] Kein committed Loadout für ${playerId} – nutze Live-Slot-Fallback.`);
      }
      return this.resolveLoadoutSelection(
        playerId,
        activity ? null : bridge.getPlayerCurrentLoadoutSnapshot(playerId),
      );
    }
    return resolveEffectiveLoadoutSelection({
      weapon1:  WEAPON_CONFIGS[committed.weapon1  as keyof typeof WEAPON_CONFIGS],
      weapon2:  committed.weapon2
        ? WEAPON_CONFIGS[committed.weapon2 as keyof typeof WEAPON_CONFIGS]
        : undefined,
      utility:  UTILITY_CONFIGS[committed.utility  as keyof typeof UTILITY_CONFIGS],
      ultimate: ULTIMATE_CONFIGS[committed.ultimate as keyof typeof ULTIMATE_CONFIGS],
    }, this.resolveConfiguredGameMode(), committed.coopDefenseProfile, committed.coopDefenseClassId, committed.equippedItems);
  }

  private resolveLoadoutSelection(
    playerId: string,
    currentSnapshot: LoadoutCommitSnapshot | null = bridge.getPlayerCurrentLoadoutSnapshot(playerId),
  ): LoadoutSelection {
    const w1Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon1');
    const w2Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon2');
    const utId = bridge.getPlayerLoadoutSlot(playerId, 'utility');
    const ulId = bridge.getPlayerLoadoutSlot(playerId, 'ultimate');
    return resolveEffectiveLoadoutSelection({
      weapon1:  w1Id ? WEAPON_CONFIGS[w1Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      weapon2:  w2Id ? WEAPON_CONFIGS[w2Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      utility:  utId ? UTILITY_CONFIGS[utId  as keyof typeof UTILITY_CONFIGS]   : undefined,
      ultimate: ulId ? ULTIMATE_CONFIGS[ulId as keyof typeof ULTIMATE_CONFIGS]: undefined,
    }, this.resolveConfiguredGameMode(), currentSnapshot?.coopDefenseProfile,
    currentSnapshot?.coopDefenseClassId, currentSnapshot?.equippedItems);
  }

  /**
   * Waehrend einer aktiven Activity ist deren replizierter Descriptor die Quelle. Nur solange
   * noch keine Activity existiert (Lobby/Startvorbereitung), gilt die Lobby-Auswahl.
   */
  private resolveConfiguredGameMode(): GameMode {
    const activity = bridge.getActivityDescriptor();
    const descriptor = bridge.getWorldDescriptor();
    return resolveActiveGameMode({
      activityKind: activity?.kind ?? null,
      roomGameMode: bridge.getGameMode(),
      worldDefinitionId: descriptor?.definitionId ?? null,
    });
  }

  /** World-first Map-Aufloesung; der Lobby-Wert ist nur vor der World-Erzeugung zulaessig. */
  private resolveConfiguredCoopDefenseMapId(): string {
    const descriptor = bridge.getWorldDescriptor();
    // Die LobbyWorld beschreibt keine Runde. Sie traegt deshalb keine Coop-Map, und die
    // Lobby-Auswahl bleibt weiterhin die Quelle - genau wie ohne laufende World.
    if (!descriptor || isLobbyWorldDefinitionId(descriptor.definitionId)) {
      return bridge.getCoopDefenseMapId();
    }
    const mapId = toMapId(descriptor.definitionId);
    if (mapId === null) {
      throw new Error('[ArenaLifecycleCoordinator] Active World has no Coop-Defense map');
    }
    return mapId;
  }
}


/**
 * Uhrzeit der laufenden Activity. Nur Coop-Defense-Maps setzen eine eigene; alle übrigen Modi bleiben
 * beim Mittag und damit exakt bei den bisherigen Kosten und der bisherigen Optik. Host
 * und Client lösen dieselbe Map-Konfiguration auf, deshalb ist kein eigener Netzwerkpfad
 * nötig – das gilt auch für den lokalen Debug-Regler, der bewusst nur den eigenen Client
 * betrifft.
 */
/**
 * Uebersetzt die Verfuegbarkeit eines Werkzeugs in einen Konfliktgrund des Composites.
 *
 * Rein und ohne Weltzustand: Der Merge entscheidet damit fuer jeden Besitzer nach dessen eigenen
 * Regeln, ohne dass die Tool-, Klassen- und Loadout-Semantik hier neu definiert wuerde.
 */
/**
 * World-Parameter der LobbyWorld.
 *
 * Die Area-Stufe reist nur mit, wenn der Kern ueberhaupt existiert: Eine gesperrte Lobby traegt
 * gar keine persistente Basisstelle, und eine Stufe ohne Stelle waere eine Konfiguration fuer
 * etwas, das es in dieser Instanz nicht gibt.
 */
function resolveLobbyWorldParameters(
  persistentBaseUnlocked: boolean,
  areaStage: PersistentBaseAreaStage | null,
): WorldParameters | undefined {
  if (!persistentBaseUnlocked || areaStage === null) return undefined;
  return {
    persistentBaseUnlocked: true,
    persistentBaseAreaStage: areaStage,
  };
}

function resolveRoundTimeOfDayMinutes(mapConfig: CoopDefenseMapConfig | null, lobbyMinutes: number): number {
  const configured = mapConfig?.timeOfDay;
  if (configured === undefined) return lobbyMinutes;
  // Die Konfiguration ist beim Laden validiert worden; der Rückfall deckt nur den Fall
  // ab, dass jemand die Registry zur Laufzeit umgeht.
  return parseTimeOfDay(configured) ?? DEFAULT_TIME_OF_DAY_MINUTES;
}
