import type Phaser from 'phaser';
import { bridge }            from '../../network/bridge';
import type { TargetFootprint } from '../../systems/ReinforcementMatrixSystem';
import type { TargetStatusTarget } from '../../systems/TargetStatusSystem';
import { ArenaBuilder } from '../../arena/ArenaBuilder';
import { ArenaGenerator, ARENA_GENERATOR_VERSION, resolveArenaGenerationInput } from '../../arena/ArenaGenerator';
import { TerrainColorSnapshotBuilder } from '../../arena/TerrainColorSnapshotBuilder';
import type { WorldViewRect } from '../../ui/HostileBaseIndicator';
import { EnergyShieldSystem } from '../../systems/EnergyShieldSystem';
import { BurrowSystem }      from '../../systems/BurrowSystem';
import { COOP_DEFENSE_AFFIX_RULES } from '../../config/coopDefenseItems';
import { getLocale, t } from '../../i18n';
import { getMapName } from '../../i18n/contentPresentation';
import {
  ArenaTimeOfDayController,
  type ArenaTimeOfDaySignals,
} from '../../systems/ArenaTimeOfDayController';
import { HostHeldActionSystem } from '../../systems/HostHeldActionSystem';
import { LoadoutManager }    from '../../loadout/LoadoutManager';
import { resolveEffectiveLoadoutSelection } from '../../loadout/LoadoutRules';
import { TranslocatorTeleportRenderer } from '../../effects/TranslocatorTeleportRenderer';
import { DEFAULT_TIME_OF_DAY_MINUTES, parseTimeOfDay, resolveSkyState } from '../../effects/TimeOfDay';
import { setEmissiveScale } from '../../effects/EmissiveScale';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, ULTIMATE_CONFIGS, DEFAULT_LOADOUT } from '../../loadout/LoadoutConfig';
import type { PlaceableTurretUtilityConfig, TeslaDomeWeaponFireConfig, WeaponConfig } from '../../loadout/LoadoutConfig';
import type { LoadoutSelection } from '../../loadout/LoadoutManager';
import {
  resolveCoopDefenseActivityBaseOverlays,
} from '../../arena/BaseRegistry';
import { getCoopDefenseMapConfig, getCoopDefenseMapXpReference, isWeaponBalanceLabMapId, resolveCoopDefenseMapPersistentSpawnConfigs, type CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import { buildInitialLocalArenaHudData } from '../../ui/LocalArenaHudData';
import { ARENA_DURATION_SEC, HP_MAX, PLAYER_COLORS, COLORS, CELL_SIZE, TEAM_BLUE_COLOR, TEAM_RED_COLOR, COOP_DEFENSE_BASE_TURRET_OWNER_ID, COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID, COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID, applyArenaMetricsForMode, getArenaMetricsProfile } from '../../config';
import { DASH_GROUND_FIRE_BURN_DURATION_MS, DASH_GROUND_FIRE_DAMAGE_PER_TICK, DASH_T2_S, PLAYER_SPEED, SHOCKWAVE_DAMAGE, SHOCKWAVE_RADIUS } from '../../config';
import type { ArenaContext }          from './ArenaContext';
import type { RendererBundle }        from './RendererBundle';
import type { RockVisualHelper }      from './RockVisualHelper';
import type { PlacementPreviewRenderer } from './PlacementPreviewRenderer';
import type { PersistentBasePreviewRenderer } from './PersistentBasePreviewRenderer';
import type { HostUpdateCoordinator } from './HostUpdateCoordinator';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { LobbyOverlay }          from '../LobbyOverlay';
import type { ArenaLayout, GameMode, LoadoutCommitSnapshot, LoadoutUseParams, PlayerProfile, RoomQualitySnapshot } from '../../types';
import type { RoundConclusion, RoundResult, RoundState } from '../../network/NetworkBridge';
import { resolvePvpWinnerIds } from '../../network/RoomStatistics';
import type { RoomQualityMonitor }    from '../../network/RoomQualityMonitor';
import { CAPTURE_THE_BEER_MODE, COOP_DEFENSE_MODE, isCoopDefenseMode, isTeamGameMode } from '../../gameModes';
import {
  BASE_DESTRUCTION_GROUND_BURN_DAMAGE_PER_TICK,
  BASE_DESTRUCTION_GROUND_BURN_DURATION_MS,
  BASE_DESTRUCTION_GROUND_FIRE_DURATION_MS,
  getBaseDestructionBlast,
} from '../../effects/BaseDestructionPlan';
import {
  CoopMissionRuntime,
  type CoopMissionActivityStep,
  type CoopMissionRuntimePorts,
} from '../../activity/CoopMissionRuntime';
import type {
  CoopMissionArmedConstructionView,
  CoopMissionArmedOutpostView,
} from '../../activity/CoopMissionHostUpdate';
import { CoopMissionPlayerRuntime } from '../../activity/CoopMissionPlayerRuntime';
import { CaptureTheBeerActivityRuntime } from '../../activity/CaptureTheBeerActivityRuntime';
import {
  createCoopMissionCompletion,
  getCoopMissionConclusion,
  type CoopMissionActivityCompletion,
} from '../../activity/ActivityCompletion';
import { ResultApplication } from '../../activity/ResultApplication';
import { getCoopDefenseEnemyConfig } from '../../config/coopDefenseEnemies';
import { emitArenaMapGridChanged } from './ArenaEvents';
import { resolveCoopMissionActivityConfiguration } from '../../activity/CoopMissionActivityConfig';
import { CoopMissionComposition } from '../../activity/CoopMissionComposition';
import {
  COOP_DEFENSE_DISMANTLE_RANGE,
  COOP_DEFENSE_MANAGEMENT_COOLDOWN_MS,
  COOP_DEFENSE_REPAIR_DRONE_UPGRADE_ID,
} from '../../config/coopDefenseConstructions';
import type { ConstructionId, LoadoutToolRef, LoadoutUseResult, SyncedPlaceableRock, UtilityPlacementPreviewState } from '../../types';
import { resolveWorldLoadProgress } from '../../world/WorldLoadReady';
import {
  resolveWorldRenderWork,
  type WorldRenderWork,
} from './WorldRenderWork';
import { getActiveRoundParticipantIds } from './RoundParticipationPolicy';
import { resolveArenaStartTime } from './ArenaStartTiming';
import {
  getStoredLocalOwnerId,
  getStoredPersistentBaseAreaStage,
  getStoredPersistentBaseUnlocked,
  getStoredPersonalBaseContribution,
  setStoredPersonalBaseContribution,
  getStoredPersistentBaseRewardState,
  getStoredPersistentBaseRewardUnlocks,
  grantStoredPersistentBaseRewards,
  setStoredPersistentBaseRewardState,
} from '../../utils/localPreferences';
import type { PersistentBaseContributionStore } from '../../persistentBase/PersistentBaseContributionStore';
import type { PersistentBaseRewardStore } from '../../persistentBase/PersistentBaseRewardStore';
import { PersistentBaseRoomSession } from '../../persistentBase/PersistentBaseRoomSession';
import type { PersistentBaseTransactionIdentity } from '../../persistentBase/PersistentBaseTransaction';
import { PersistentBaseRewardGrantService } from '../../persistentBase/PersistentBaseRewardGrant';
import {
  getPersistentBaseRewardDefinition,
  isKnownPersistentBaseRewardId,
  type PersistentBaseRewardDefinition,
} from '../../persistentBase/PersistentBaseRewardCatalog';
import type {
  PersistentBaseRewardId,
  PersistentBaseRewardPlacement,
  PersistentBaseRewardPlacementRequest,
  PersistentBaseRewardSessionState,
} from '../../persistentBase/PersistentBaseRewardTypes';
import { sanitizePersistentBaseRewardPlacementRequest } from '../../persistentBase/PersistentBaseRewardTypes';
import {
  sanitizePersistentBaseMoveRequest,
  type PersistentBaseMoveRequest,
} from '../../persistentBase/PersistentBaseMove';
import {
  getPersistentBaseBuildAreaExtentCells,
  isCellInsidePersistentBaseBuildArea,
  resolvePersistentBaseCell,
  type PersistentBaseBuildArea,
  type PersistentBaseAreaStage,
} from '../../persistentBase/PersistentBaseCore';
import {
  applyPersistentBaseRoundOutcome,
  resolvePersistentBaseRoundOutcome,
} from '../../persistentBase/PersistentBaseRoundOutcome';
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
import type { WorldDefinition } from '../../config/authoring/WorldDefinition';
import { createAuthoredWorldDescriptor } from '../../world/WorldLayout';
import { isArenaTransitionReady } from './ArenaTransitionReadiness';
import {
  isValidPersistentBaseSite,
  type WorldPersistentBaseSite,
} from '../../world/WorldRuntimeContext';
import { WorldLifecycle } from '../../world/WorldLifecycle';
import { WorldPresentationHandoff } from '../../world/WorldPresentationHandoff';
import { ArenaExitEntityPresentation } from '../../world/ArenaExitEntityPresentation';
import {
  PersistentBaseWorldBinding,
} from '../../world/PersistentBaseWorldBinding';
import { PersistentBaseWorldMaterializer } from '../../world/PersistentBaseWorldMaterializer';
import { WorldRuntime } from '../../world/WorldRuntime';
import { WorldPowerUpRuntime } from '../../world/WorldPowerUpRuntime';
import { WorldTrainRuntime } from '../../world/WorldTrainRuntime';
import { ConstructionWorldRuntime, type ConstructionPersistentBaseContext } from '../../world/ConstructionWorldRuntime';
import { WorldTargetingRuntime, type WorldTargetingSystems } from '../../world/WorldTargetingRuntime';
import {
  WorldPlayerGameplayRuntime,
  type WorldPlayerGameplaySystems,
} from '../../world/WorldPlayerGameplayRuntime';
import {
  WorldSupportGameplayRuntime,
  type WorldSupportGameplaySystems,
} from '../../world/WorldSupportGameplayRuntime';
import {
  WorldCombatGameplayBinding,
  type WorldCombatGameplaySystems,
} from '../../world/WorldCombatGameplayBinding';
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
import { WorldGeometryBinding } from '../../world/WorldGeometryBinding';
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
  PersistentPlayerBaseContribution,
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
 * Mutates World-/Activity-scoped ArenaContext fields (arenaResult, currentLayout, etc.).
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
  /** Scoped Sicht scene-langlebiger Geometrie-Consumer auf die aktuelle World. */
  private worldGeometryBinding: WorldGeometryBinding | null = null;
  /** World-owned target field systems; the context fields are compatibility projections. */
  private worldTargetingRuntime: WorldTargetingRuntime | null = null;

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
  /** World-owned PowerUp runtime; the context field below is only a compatibility facade. */
  private worldPowerUpRuntime: WorldPowerUpRuntime | null = null;
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
  private worldTrainRuntime: WorldTrainRuntime | null = null;
  /** World-owned player/loadout gameplay; context fields remain compatibility projections. */
  private worldPlayerGameplayRuntime: WorldPlayerGameplayRuntime | null = null;
  /** World-owned detonation and support-ultimate state. */
  private worldSupportGameplayRuntime: WorldSupportGameplayRuntime | null = null;
  /** World binding owner for scene-long Combat/Physics/Projectile/Decoy services. */
  private worldCombatGameplayBinding: WorldCombatGameplayBinding | null = null;
  /** World-owned construction rules and Loadout handlers. */
  private constructionWorldRuntime: ConstructionWorldRuntime | null = null;
  /** Lokale Realisierung der optionalen Coop-Activity; ihr Besitzer ist der ActivityRuntimeHost. */
  private coopMissionRuntime: CoopMissionRuntime | null = null;
  /** Activity-owned Capture-the-Beer rules; the World keeps only this compatibility projection. */
  private captureTheBeerActivityRuntime: CaptureTheBeerActivityRuntime | null = null;
  /** Activity-specific orchestration; focused composers remain behind this boundary. */
  private readonly coopMissionComposition: CoopMissionComposition;
  /**
   * Die Fragen der Coop-Mission an World, Scene und Netz.
   *
   * Sie sind bewusst Closures und kein Container: Die Activity bekommt Antworten, nicht die
   * Systeme, die sie heute geben. Ein Activity-Wechsel in derselben World nutzt dieselben Ports.
   */
  private readonly coopMissionPorts: CoopMissionRuntimePorts = {
    hostUpdate: {
      getPlayers: () => this.ctx.playerManager.getAllPlayers(),
      getPlayerPosition: (playerId) => {
        const player = this.ctx.playerManager.getPlayer(playerId);
        return player ? { x: player.x, y: player.y } : null;
      },
      isPlayerAlive: (playerId) => this.ctx.combatSystem.isAlive(playerId),
      isPlayerBurrowed: (playerId) => this.ctx.burrowSystem?.isBurrowed(playerId) ?? false,
      isPlayerStealthed: (playerId) => this.ctx.decoySystem.isStealthed(playerId),
      canUseMissionActions: (playerId) => this.getPlayerCapabilities(playerId).canUseMissionActions,
      getDecoyTargets: () => this.ctx.decoySystem.getHostTargets().map((decoy) => ({
        id: decoy.id,
        ownerId: decoy.ownerId,
        x: decoy.sprite.x,
        y: decoy.sprite.y,
        radius: Math.max(decoy.sprite.displayWidth, decoy.sprite.displayHeight) * 0.5,
      })),
      getDecoyPosition: (decoyId) => {
        const decoy = this.ctx.decoySystem.getHostTarget(decoyId);
        return decoy ? { x: decoy.sprite.x, y: decoy.sprite.y } : null;
      },
      isDecoyTargetable: (decoyId) => this.ctx.decoySystem.getHostTarget(decoyId) !== null,
      getArmedConstructions: () => {
        const constructions: CoopMissionArmedConstructionView[] = [];
        for (const construction of this.ctx.placementSystem?.getAllRuntimeRocks() ?? []) {
          if (construction.hp <= 0 || construction.kind !== 'turret') continue;
          constructions.push({
            id: String(construction.id),
            gridX: construction.gridX,
            gridY: construction.gridY,
            isTargetable: () => construction.hp > 0,
          });
        }
        return constructions;
      },
      getArmedOutposts: () => {
        const outposts: CoopMissionArmedOutpostView[] = [];
        for (const base of this.ctx.baseManager?.getBasesByFaction('friendly') ?? []) {
          if (base.role !== 'outpost'
            || base.isInert?.() === true
            || base.getHp() <= 0
            || base.getTurrets().length === 0) continue;
          const turret = base.getTurrets()[0];
          outposts.push({
            id: base.id,
            x: turret.x,
            y: turret.y,
            cells: base.getSpec().cells,
            resolveSurfacePoint: (fromX, fromY) => {
              const surface = base.getNearestSurfacePoint(fromX, fromY);
              return surface ? { x: surface.x, y: surface.y } : null;
            },
            isTargetable: () => (
              base.isInert?.() !== true && base.getHp() > 0 && base.getTurrets().length > 0
            ),
          });
        }
        return outposts;
      },
      syncDormantBaseStates: () => { this.ctx.baseManager?.syncDormantStates(); },
      getActiveBurnSources: (enemyId, atMs) => this.ctx.combatSystem.getActiveBurnSources(enemyId, atMs),
      getFireSystem: () => this.ctx.fireSystem,
      getSmokeSystem: () => this.ctx.smokeSystem,
      publishEncounterPresentation: (state) => {
        bridge.publishCoopDefenseEncounterPresentationState(state);
      },
      publishMapEventPresentation: (state) => {
        bridge.publishCoopDefenseMapEventPresentationState(state);
      },
      publishSecondaryObjectivePresentation: (state) => {
        bridge.publishCoopDefenseSecondaryObjectivePresentationState(state);
      },
    },
    clientPresentation: {
      getMissionProgressPresentationState: () => bridge.getCoopDefenseMissionProgressPresentationState(),
    },
  };
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
      // Compatibility-Pfad waehrend der Migration: Source of Truth ist die WorldRuntime, aber
      // die bestehenden Consumer lesen den Kontext weiterhin ueber `ctx.world`.
      this.ctx.world = context;
    },
    detach: () => {
      const runtime = this.worldRuntime;
      this.worldRuntime = null;
      // Die Darstellung verlaesst die World zuerst: Ein Uebergang zeigt sie weiter oder
      // verwendet sie erneut, waehrend der Gameplay-State dieser Instanz vollstaendig faellt.
      // Nach der Uebergabe sieht kein world-scoped Consumer sie mehr.
      this.ctx.worldPresentation = null;
      this.worldPresentationHandoff.release(runtime?.releasePresentation() ?? null);
      runtime?.destroy();
      // Mit der World enden ihre Runtime-Objekte. Der Raumzustand haelt danach keine mehr - er
      // haelt weiter die Blueprints, aber nichts, was sie in einer Welt darstellte.
      this.persistentBaseSession.useWorldRuntimes(null);
      this.persistentBaseWorldBinding = null;
      this.ctx.worldMaterialization = null;
      this.ctx.world = null;
    },
    activityIdentity: {
      resolveStartAnchor: (_activity, previousActivity) => {
        if (previousActivity) return bridge.getSynchronizedNow();
        const arenaStartTime = bridge.getArenaStartTime();
        return arenaStartTime > 0 ? arenaStartTime : null;
      },
      begin: (activity) => { this.beginPersistentBaseTransaction(activity); },
      end: (activity) => { this.endPersistentBaseTransaction(activity); },
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
      attachCombatResources: (playerId) => { this.ctx.resourceSystem?.initPlayer(playerId); },
      detachCombatResources: (playerId) => {
        this.ctx.resourceSystem?.removePlayer(playerId);
        bridge.clearWeapon2PredictionState(playerId);
      },
      attachPlayerBuild: (playerId) => { this.ctx.coopDefenseItemRuntimeSystem?.initPlayer(playerId); },
      detachPlayerBuild: (playerId) => { this.ctx.coopDefenseItemRuntimeSystem?.removePlayer(playerId); },
      attachBurrow: (playerId) => { this.ctx.burrowSystem?.initPlayer(playerId); },
      detachBurrow: (playerId) => { this.ctx.burrowSystem?.removePlayer(playerId); },
      attachLoadout: (playerId) => {
        this.ctx.loadoutManager?.resetUltimateState(playerId);
        this.ctx.loadoutManager?.assignDefaultLoadout(playerId, this.resolveCommittedLoadoutSelection(playerId));
      },
      detachLoadout: (playerId) => {
        this.ctx.loadoutManager?.removePlayer(playerId);
        this.ctx.powerUpSystem?.removePlayer(playerId);
        this.ctx.tunnelSystem?.removePlayer(playerId);
      },
      detachWorldTargeting: (playerId) => {
        this.ctx.targetStatusSystem?.removeTarget({ targetType: 'player', targetId: playerId });
        this.ctx.energyInjectorSystem?.removeOwner(playerId);
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
  /**
   * Der raumlanglebige Zustand der persistenten Basis: committed Beitraege, committed
   * Belohnungen und der Arbeitsstand einer laufenden Activity.
   *
   * Genau ein Besitzpfad fuer Host und Gaeste. Er lebt laenger als jede World und jede Runde,
   * weil ein Spieler ueber einen Kartenwechsel hinweg Besitzer seiner Konstruktionen bleibt,
   * und stirbt mit dem Raum. Er wird nie lokal gespeichert und nie vom Kartenabbau geleert.
   */
  private readonly persistentBaseSession = new PersistentBaseRoomSession();
  private get persistentBaseContributions(): PersistentBaseContributionStore {
    return this.persistentBaseSession.contributions;
  }
  private get persistentBaseRewards(): PersistentBaseRewardStore {
    return this.persistentBaseSession.rewards;
  }
  /** Shared idempotent grant path for authored map-victory and objective rewards. */
  private readonly persistentBaseRewardGrantService = new PersistentBaseRewardGrantService();
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
      this.grantAuthoredPersistentBaseRewards(rewardIds);
    },
    applyPersistentBaseOutcome: (outcome, identity) => {
      this.publishConfirmedPersistentBaseContributions(
        applyPersistentBaseRoundOutcome(outcome, {
          session: this.persistentBaseSession,
          isRuntimeObjectAlive: (runtimeId) => this.ctx.placementSystem?.hasRuntimeRock(runtimeId) === true,
          identity,
        }),
      );
      this.persistCurrentCommittedPersistentBaseRewards();
      this.publishPersistentBaseRewardSessionState();
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
  private persistentBaseWorldBinding: PersistentBaseWorldBinding | null = null;
  /** Leerstand ohne World: Ohne Instanz existiert nichts world-lokal Materialisiertes. */
  private get persistentBaseAnchor(): PersistentBaseAnchor | null {
    return this.persistentBaseWorldBinding?.anchor ?? null;
  }
  private get persistentBaseBuildArea(): PersistentBaseBuildArea | null {
    return this.persistentBaseWorldBinding?.buildArea ?? null;
  }
  /**
   * Technischer Network-/Projection-Cache: monotone Revision des zuletzt publizierten Reward-
   * Snapshots. Die fachliche Reward-Revision bleibt im `PersistentBaseRewardStore`.
   */
  private persistentBaseRewardProjectionRevision = 0;
  /** Technischer Network-/Projection-Dedup-Cache, keine zweite fachliche Reward-Wahrheit. */
  private persistentBaseRewardProjectionSignature: string | null = null;
  private persistentBaseVisualSite: PersistentBaseVisualSite | null = null;
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
    private readonly lobbyOverlay: LobbyOverlay,
    private readonly hostUpdate: HostUpdateCoordinator,
    private readonly clientUpdate: ClientUpdateCoordinator,
    private readonly roomQualityMonitor: RoomQualityMonitor,
  ) {
    this.coopMissionComposition = new CoopMissionComposition({
      scene,
      getWorld: () => this.worldRuntime?.context ?? null,
      getLayout: () => this.ctx.currentLayout,
      getArenaResult: () => this.ctx.arenaResult,
      getBaseManager: () => this.ctx.baseManager,
      getPlayerManager: () => this.ctx.playerManager,
      getCombatSystem: () => this.ctx.combatSystem,
      getProjectileManager: () => this.ctx.projectileManager,
      getHostPhysics: () => this.ctx.hostPhysics,
      getPlacementSystem: () => this.ctx.placementSystem,
      getLoadoutManager: () => this.ctx.loadoutManager,
      getPowerUpSystem: () => this.ctx.powerUpSystem,
      getPlayerModifierSystem: () => this.ctx.coopDefensePlayerModifierSystem,
      getEnergyShieldSystem: () => this.ctx.energyShieldSystem,
      getStinkCloudSystem: () => this.ctx.stinkCloudSystem,
      getFlamethrowerUpgradeSystem: () => this.ctx.flamethrowerUpgradeSystem,
      getFireSystem: () => this.ctx.fireSystem,
      getDecoySystem: () => this.ctx.decoySystem,
      getArmageddonSystem: () => this.ctx.armageddonSystem,
      getAirstrikeSystem: () => this.ctx.airstrikeSystem,
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
      setSecondaryObjectiveConfigs: (configs) => { this.ctx.coopDefenseSecondaryObjectiveConfigs = configs; },
      nextGenerationId: () => this.nextFlowFieldGenerationId(),
      getPlayerCapabilities: (playerId) => this.getPlayerCapabilities(playerId),
      getSecondsLeft: () => bridge.computeSecondsLeft(),
      getConnectedPlayerIds: () => bridge.getConnectedPlayerIds(),
      getSpectatorIds: () => bridge.getRoundParticipation()?.spectatorIds ?? [],
      isPlayerBurrowed: (playerId) => this.ctx.burrowSystem?.isBurrowed(playerId) ?? false,
      isSafeEnemyGroundAt: (x, y, radius) => this.isSafeEnemyGroundAt(x, y, radius),
      findSafeEnemyGroundPosition: (x, y, radius, maxRadiusCells) => (
        this.findSafeEnemyGroundPosition(x, y, radius, maxRadiusCells)
      ),
      isFreeEnemyGroundAt: (x, y, radius) => this.isFreeEnemyGroundAt(x, y, radius),
      hasWalkableEnemyCircleLine: (fromX, fromY, toX, toY, radius) => (
        this.hasWalkableEnemyCircleLine(fromX, fromY, toX, toY, radius)
      ),
      damageConstruction: (id, damage, attackerId) => {
        const resolvedDamage = this.resolveObstacleDamage(id, damage, attackerId);
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
      publishRespawnBudget: (state) => bridge.publishCoopDefenseRespawnBudgetState(state),
      patchBarrierCells: (changes) => this.ctx.flowFieldCoordinator?.patchBarrierCells(changes),
      markLightDirty: () => this.ctx.lightOccluderIndex?.markDirty(),
      grantPersistentBaseRewards: (rewardIds) => this.grantAuthoredPersistentBaseRewards(rewardIds),
      removeEnemyFromItemRuntime: (enemyId) => this.ctx.coopDefenseItemRuntimeSystem?.removeEnemy(enemyId),
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
    // Der Abschluss des Bestands gehoert dem Persistent-Base-Binding und faellt mit der Runtime.
    // Ein Teardown ohne laufende Runtime hat keinen solchen Owner, muss den Bestand aber genauso
    // abschliessen.
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
   * Host-Gate fuer eine PB-Mutation gegen die aktuell offene Activity-Transaction.
   *
   * `PersistentBaseRoomSession` bleibt die einzige Source of Truth. Der World-Teil wird hier
   * bewusst mitgeprueft, damit dieser Gate sowohl fuer dedizierte Requests als auch fuer den
   * generischen Loadout-RPC dieselbe World-Revision schuetzt.
   */
  private acceptsPersistentBaseMutation(
    worldRevision: number,
    activityRevision?: number,
  ): boolean {
    if (bridge.getCurrentWorldRevision() !== worldRevision) return false;
    return this.persistentBaseSession.acceptsMutation({ worldRevision, activityRevision });
  }

  private acceptsCurrentPersistentBaseMutation(activityRevision?: number): boolean {
    const worldRevision = bridge.getCurrentWorldRevision();
    return worldRevision !== null
      && this.persistentBaseSession.acceptsMutation({ worldRevision, activityRevision });
  }

  /**
   * Oeffnet den PB-Working-State an der fachlichen Activity-Identity – nicht an ihrer lokalen
   * Runtime. Der Host bereitet den committed Raumstand hier vor, damit auch ein Activity-Start
   * ohne World-Rebuild eine frische Baseline erhaelt.
   */
  private beginPersistentBaseTransaction(activity: ActivityDescriptor): void {
    if (!bridge.isHost() || !this.hasPersistentBaseForCurrentWorld()) return;
    this.ingestOfferedPersistentBaseContributions();
    this.persistentBaseRewards.replaceCommittedState(getStoredPersistentBaseRewardState());
    this.persistentBaseSession.beginTransaction({
      worldRevision: activity.worldRevision,
      activityRevision: activity.activityRevision,
    });
  }

  /**
   * Beendet den PB-Working-State beim Ende der Activity-Identity. Ein vorher explizit
   * angewendetes Round-Ergebnis hat die Transaction bereits terminal geschlossen und ist daher
   * idempotent. Ein Activity-Wechsel ohne Ergebnis rollt den alten Working-State zurueck.
   */
  private endPersistentBaseTransaction(activity: ActivityDescriptor): void {
    if (!bridge.isHost() || !this.persistentBaseSession.hasOpenTransaction) return;
    applyPersistentBaseRoundOutcome('rollback', {
      session: this.persistentBaseSession,
      isRuntimeObjectAlive: (runtimeId) => this.ctx.placementSystem?.hasRuntimeRock(runtimeId) === true,
      identity: {
        worldRevision: activity.worldRevision,
        activityRevision: activity.activityRevision,
      },
    });
    this.publishPersistentBaseRewardSessionState();
  }

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

  /**
   * Der Missionsanteil des laufenden Frames.
   *
   * Der Frame-Owner bekommt benannte Schritte, nicht die Systeme dahinter: Reihenfolge und
   * Bestand der Coop-Activity gehoeren ihrer eigenen Runtime.
   */
  getActivityStep(): CoopMissionActivityStep | null {
    return this.coopMissionRuntime;
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
          && !(this.ctx.burrowSystem?.isBurrowed(playerId) ?? false)
        ),
        onFx: (event) => {
          if (bridge.isHost()) bridge.broadcastCaptureTheBeerFx(event);
        },
        onDestroy: () => {
          if (this.captureTheBeerActivityRuntime !== runtime) return;
          this.captureTheBeerActivityRuntime = null;
          if (this.ctx.captureTheBeerSystem === runtime.system) this.ctx.captureTheBeerSystem = null;
        },
      });
      this.captureTheBeerActivityRuntime = runtime;
      this.ctx.captureTheBeerSystem = runtime.system;
      worldRuntime.activity.attach(activity, runtime);
      return;
    }
    if (activity.kind !== 'coop-mission') return;
    const runtime = new CoopMissionRuntime(activity, (current) => {
      if (current === null && this.coopMissionRuntime === runtime) this.coopMissionRuntime = null;
      this.syncCoopMissionCompatibilityBindings(current);
    }, this.coopMissionPorts);
    this.coopMissionRuntime = runtime;
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
    this.attachCoopMissionBaseBinding(activity, runtime);
    this.syncCoopMissionCompatibilityBindings(runtime);
    if (this.ctx.worldMaterialization?.arena) {
      this.attachCoopMissionPowerUpBinding(
        activity,
        runtime,
        this.worldLifecycle.activityStartAnchor ?? undefined,
      );
      const activityConfiguration = resolveCoopMissionActivityConfiguration(
        activity,
        this.worldRuntime?.context.definition ?? null,
      );
      this.coopMissionComposition.materializeCore(activityConfiguration, runtime);
      this.coopMissionComposition.materializeDependents(activityConfiguration, runtime);
      // Objective composition creates the Activity-owned TeamBuff. Refresh the compatibility
      // facade only after all Activity children exist; the Coordinator remains its single writer.
      this.syncCoopMissionCompatibilityBindings(runtime);
    }
  }

  /** Bindet nur den aktuellen Coop-Overlay-State an die world-owned Base-Grundlage. */
  private attachCoopMissionBaseBinding(
    activity: ActivityDescriptor,
    runtime: CoopMissionRuntime,
  ): void {
    if (activity.kind !== 'coop-mission') return;
    const baseManager = this.ctx.baseManager;
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
    const powerUpSystem = this.ctx.powerUpSystem;
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
    if (this.worldRuntime?.activity.isAttached()) {
      this.worldRuntime.activity.detach();
      return;
    }
    this.coopMissionRuntime?.destroy();
    this.captureTheBeerActivityRuntime?.destroy();
  }

  /** Teardown-Einstieg ausserhalb des Lifecycles; haelt dessen Runtime-Phase synchron. */
  private detachLocalActivityForTeardown(): void {
    if (this.worldLifecycle.activity.isActive()) {
      this.worldLifecycle.activity.detachRuntime();
      return;
    }
    this.detachActivityRuntime();
  }

  /**
   * Transitional Compatibility fuer noch nicht migrierte Consumer in Scene/Host-/Client-Update.
   * Die einzige mutable Wahrheit bleibt der konkrete CoopMissionRuntime-Owner.
   */
  private syncCoopMissionCompatibilityBindings(runtime: CoopMissionRuntime | null): void {
    this.ctx.enemyManager = runtime?.enemyManager ?? null;
    this.ctx.flowFieldCoordinator = runtime?.flowFieldCoordinator ?? null;
    this.ctx.enemyFlowFieldService = runtime?.enemyFlowFieldService ?? null;
    this.ctx.enemyPlayerFlowFieldService = runtime?.enemyPlayerFlowFieldService ?? null;
    this.ctx.enemyStrategicFlowFieldService = runtime?.enemyStrategicFlowFieldService ?? null;
    this.ctx.enemyBossFlowFieldService = runtime?.enemyBossFlowFieldService ?? null;
    this.ctx.enemyAiTargetCatalog = runtime?.enemyAiTargetCatalog ?? null;
    this.ctx.enemyStrategicTargetService = runtime?.enemyStrategicTargetService ?? null;
    this.ctx.allyFlowFieldServices = runtime?.allyFlowFields ?? new Map();
    this.ctx.coopDefenseSpawnExecutor = runtime?.coopDefenseSpawnExecutor ?? null;
    this.ctx.coopDefensePersistentPressureSystem = runtime?.coopDefensePersistentPressureSystem ?? null;
    this.ctx.coopDefenseBossSystem = runtime?.coopDefenseBossSystem ?? null;
    this.ctx.coopDefenseMapDirector = runtime?.coopDefenseMapDirector ?? null;
    this.ctx.coopDefenseMapEventDirector = runtime?.coopDefenseMapEventDirector ?? null;
    this.ctx.coopDefenseEnemyTrainAwarenessSystem = runtime?.coopDefenseEnemyTrainAwarenessSystem ?? null;
    this.ctx.coopDefenseEnemyBurrowSystem = runtime?.coopDefenseEnemyBurrowSystem ?? null;
    this.ctx.coopDefenseEnemyDodgeSystem = runtime?.coopDefenseEnemyDodgeSystem ?? null;
    this.ctx.coopDefenseEnemyCombatPositioningSystem = runtime?.coopDefenseEnemyCombatPositioningSystem ?? null;
    this.ctx.coopDefenseEnemyAbilitySystem = runtime?.coopDefenseEnemyAbilitySystem ?? null;
    this.ctx.coopDefenseEnemyAttackSystem = runtime?.coopDefenseEnemyAttackSystem ?? null;
    this.ctx.coopDefenseTimebombSystem = runtime?.coopDefenseTimebombSystem ?? null;
    this.ctx.coopDefenseVoidHunterSystem = runtime?.coopDefenseVoidHunterSystem ?? null;
    this.ctx.necromancySystem = runtime?.necromancySystem ?? null;
    this.ctx.coopDefenseTeamBuffSystem = runtime?.coopDefenseTeamBuffSystem ?? null;
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
      const previousWorld = localWorld ?? this.ctx.world?.descriptor ?? null;
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
      const reusablePresentation = this.ctx.worldPresentation
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
    if (!view || !this.ctx.arenaResult || !this.ctx.currentLayout) return;

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

  /**
   * Aufbauarbeit der lokal dargestellten World-Flaechen. Boden, Fels-Overlay und statische
   * Schatten teilen sich denselben Bake-Scheduler, deshalb zaehlt hier auch nur eine Summe.
   */
  private collectWorldRenderWork(view: WorldViewRect): WorldRenderWork {
    const groundWork = this.ctx.arenaResult?.groundSurface?.getWorkingSet(view, true) ?? null;
    const rockOverlayWork = this.ctx.arenaResult?.rockOverlaySurface?.getWorkingSet(view, true) ?? null;
    const shadowWork = this.renderers.shadow.getStaticSurfaceWorkingSet(view, true);
    const work = resolveWorldRenderWork(groundWork, rockOverlayWork, shadowWork);
    // Die Surface-Readiness bleibt die Authority; Working-Set-Daten liefern nur den
    // view-bezogenen Fortschritt.
    return {
      ...work,
      renderReady: ArenaBuilder.isSurfaceWorkingSetReady(this.ctx.arenaResult, view)
        && this.renderers.shadow.isStaticReadyForView(view, true),
    };
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
    if (!this.arenaBuilt || !view || !this.ctx.arenaResult || !this.ctx.currentLayout) {
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
    this.ctx.powerUpSystem?.setArenaStartTime(roundStartTime);
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
    if (!this.ctx.loadoutManager) return;
    for (const profile of bridge.getConnectedPlayers()) {
      if (!this.ctx.playerManager.hasPlayer(profile.id)) continue;
      this.ctx.loadoutManager.syncSelectedLoadout(profile.id, this.resolveCommittedLoadoutSelection(profile.id));
      this.ctx.combatSystem.reconcilePlayerRuntimeState(profile.id);
      this.ctx.resourceSystem?.reconcilePlayerLimits(profile.id);
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
            ? this.ctx.captureTheBeerSystem?.getTeamScore(teamId) ?? 0
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
      this.publishConfirmedPersistentBaseContributions(
        applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(roundConclusion), {
          session: this.persistentBaseSession,
          isRuntimeObjectAlive: (runtimeId) => this.ctx.placementSystem?.hasRuntimeRock(runtimeId) === true,
          identity: this.resolvePersistentBaseTransactionIdentity(),
        }),
      );
      this.persistCurrentCommittedPersistentBaseRewards();
      this.publishPersistentBaseRewardSessionState();
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
    this.rollbackPersistentBaseMissionIfActive();
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

  /** Grants authored persistent-base rewards to the frozen round participants. */
  private grantAuthoredPersistentBaseRewards(
    rewardIds: readonly PersistentBaseRewardId[] | undefined,
  ): void {
    if (!bridge.isHost() || !rewardIds || rewardIds.length === 0) return;
    const result = this.persistentBaseRewardGrantService.grant(
      rewardIds,
      bridge.getRoundResultEligiblePlayerIds(),
      {
        localPlayerId: bridge.getLocalPlayerId(),
        applyLocal: grantStoredPersistentBaseRewards,
        confirmForPlayer: (playerId, ids) => bridge.hostGrantPersistentBaseRewards(playerId, ids),
      },
    );
    if (result.newlyGrantedByPlayerId.size > 0) this.publishPersistentBaseRewardSessionState();
  }

  /**
   * Haelt persoenlichen Beitrag und Host-Bestaetigung in Fluss.
   *
   * Beide Richtungen sind bewusst Zustand statt Ereignis: Ein spaeter beitretender Host liest den
   * Beitrag ohne Nachfrage, und eine Bestaetigung erreicht ihren Besitzer auch dann noch, wenn
   * sie waehrend eines Szenenwechsels ausgesprochen wurde.
   */
  syncPersistentBaseContributions(): void {
    // Anbieten heisst nicht bauen: Der Host entscheidet, was davon in seiner Welt steht.
    bridge.offerPersistentBaseContribution(getStoredPersonalBaseContribution());

    // Nur ein host-bestaetigter Stand darf lokal fortgeschrieben werden. Ohne diese Regel koennte
    // ein manipulierter Client seine eigene Revision erhoehen und ungeprueftes Bauwerk dauerhaft
    // in den autoritativen Fluss druecken.
    const confirmed = bridge.getConfirmedPersistentBaseContribution();
    if (confirmed && confirmed.ownerId === getStoredLocalOwnerId()) {
      setStoredPersonalBaseContribution(confirmed);
    }

    if (bridge.isHost()) this.ingestOfferedPersistentBaseContributions();
  }

  /**
   * Keeps personal host confirmations and the host-owned reward projection in sync. Clients only
   * persist the reliable cumulative grant state; the host publishes the current-world projection.
   */
  syncPersistentBaseRewards(): void {
    const confirmed = bridge.getConfirmedPersistentBaseRewardGrant();
    if (confirmed) grantStoredPersistentBaseRewards(confirmed.rewardIds);

    if (!bridge.isHost()) return;
    const site = this.ctx.world?.persistentBaseSite ?? null;
    if (!site || !this.ctx.persistentBaseRewards) {
      bridge.publishPersistentBaseRewardSessionState(null);
      return;
    }
    this.publishPersistentBaseRewardSessionState();
  }

  /** Host entry point for the dedicated reward-placement RPC. */
  placePersistentBaseReward(
    playerId: string,
    request: PersistentBaseRewardPlacementRequest,
  ): LoadoutUseResult {
    if (!bridge.isHost()) return { ok: false, reason: 'blocked' };
    const sanitizedRequest = sanitizePersistentBaseRewardPlacementRequest(request);
    if (!sanitizedRequest) return { ok: false, reason: 'invalid' };
    if (!this.acceptsPersistentBaseMutation(
      sanitizedRequest.worldRevision,
      sanitizedRequest.activityRevision,
    )) return { ok: false, reason: 'blocked' };
    const site = this.ctx.world?.persistentBaseSite ?? null;
    const store = this.ctx.persistentBaseRewards;
    const placementSystem = this.ctx.placementSystem;
    const world = bridge.getWorldDescriptor();
    if (!site || !store || !placementSystem || !world || sanitizedRequest.worldRevision !== world.worldRevision) {
      return { ok: false, reason: 'blocked' };
    }
    if (!isKnownPersistentBaseRewardId(sanitizedRequest.rewardId)) return { ok: false, reason: 'invalid' };
    const player = this.ctx.playerManager.getPlayer(playerId);
    if (!player || !player.active || !this.mayManagePersistentBase(playerId)
      || !this.getPlayerCapabilities(playerId).canPlace
      || !this.ctx.combatSystem.isAlive(playerId)
      || this.ctx.combatSystem.isBurrowed(playerId)) {
      return { ok: false, reason: 'blocked' };
    }

    const unlocks = getStoredPersistentBaseRewardUnlocks();
    if (!store.canPlaceReward(sanitizedRequest.rewardId, unlocks)) return { ok: false, reason: 'blocked' };
    const definition = getPersistentBaseRewardDefinition(sanitizedRequest.rewardId);
    if (definition.category === 'baseTurret' && !this.isPersistentBaseRuntimeActive(site)) {
      return { ok: false, reason: 'blocked' };
    }
    const cell = this.resolvePersistentBaseRewardCell(site, sanitizedRequest);
    if (!cell || !this.isPersistentBaseRewardPlacementInDomain(definition, site, sanitizedRequest)) {
      return { ok: false, reason: 'placement' };
    }
    const cellWorld = placementSystem.getWorldPointForCell(cell.gridX, cell.gridY);
    if (Math.hypot(player.x - cellWorld.x, player.y - cellWorld.y) > COOP_DEFENSE_DISMANTLE_RANGE) {
      return { ok: false, reason: 'placement' };
    }
    if (store.getState().placements.some((entry) => {
      const occupied = this.resolvePersistentBaseRewardCell(site, entry);
      return occupied?.gridX === cell.gridX && occupied.gridY === cell.gridY;
    })) return { ok: false, reason: 'placement' };
    if (!placementSystem.canMaterializePersistentBaseRewardCell(cell.gridX, cell.gridY, true)) {
      return { ok: false, reason: 'placement' };
    }

    // A reward has higher composite priority than personal contributions. Remove only the
    // conflicting runtime object and release its runtime binding; the owner's blueprint remains.
    const occupant = placementSystem.getRuntimeRockAt(cell.gridX, cell.gridY);
    let displacedPersonalRuntimeId: number | null = null;
    if (occupant && occupant.ownership !== 'base-owned') {
      const isPersistentContribution = this.ctx.persistentBaseContributions?.getRuntimeBindings()
        .some((binding) => binding.runtimeId === occupant.id) === true;
      // A reward may displace a persistent contribution, but must never silently delete an
      // unrelated live utility for which there is no blueprint to reconstruct on rollback.
      if (!isPersistentContribution) return { ok: false, reason: 'placement' };
      this.persistentBaseWorldBinding?.releasePersonalRuntimeForRewardConflict(occupant.id);
      displacedPersonalRuntimeId = occupant.id;
    }
    const placement: PersistentBaseRewardPlacement = {
      rewardId: sanitizedRequest.rewardId,
      relativeGridX: sanitizedRequest.relativeGridX,
      relativeGridY: sanitizedRequest.relativeGridY,
      angle: sanitizedRequest.angle,
    };
    if (!store.placeReward(placement)) return { ok: false, reason: 'blocked' };
    let runtime: SyncedPlaceableRock | null = null;
    try {
      runtime = this.persistentBaseWorldBinding?.materializeRewardPlacement(placement, definition) ?? null;
    } catch {
      // Keep the request transactional even if a provider throws instead of returning null.
      runtime = null;
    }
    if (!runtime) {
      store.rollbackPlacement(sanitizedRequest.rewardId);
      // Re-run the existing deterministic composite after every failed materialization. This
      // restores the displaced personal runtime from its unchanged blueprint, including any
      // pedestal registration, instead of maintaining a second reconstruction path here.
      this.reconcilePersistentBaseWorld();
      if (displacedPersonalRuntimeId !== null) {
        emitArenaMapGridChanged(this.scene.game.events, {
          reason: 'placeables_batch_removed',
          source: 'placeable_rock',
        });
      }
      return { ok: false, reason: 'placement' };
    }
    if (displacedPersonalRuntimeId !== null) {
      emitArenaMapGridChanged(this.scene.game.events, {
        reason: 'placeables_batch_removed',
        source: 'placeable_rock',
      });
    }
    this.persistCurrentCommittedPersistentBaseRewards();
    this.publishPersistentBaseRewardSessionState();
    this.reconcilePersistentBaseWorld();
    return { ok: true };
  }

  /** Liefert die lokale Reward-Vorschau aus dem verlaesslichen Session-Snapshot. */
  getPersistentBaseRewardIdsForPlayer(playerId: string): PersistentBaseRewardId[] {
    const site = this.ctx.world?.persistentBaseSite ?? null;
    const session = bridge.getPersistentBaseRewardSessionState();
    // Enumeration and temporary availability are deliberately separate: an unlocked, unplaced
    // reward remains visible in the radial while the player is dead, burrowed or otherwise
    // unable to place. The action resolver supplies the disabled state; preview/host validation
    // below still enforce the capability contract.
    if (!site || !this.mayManagePersistentBase(playerId)) return [];

    const hostState = bridge.isHost() ? this.ctx.persistentBaseRewards?.getState() : undefined;
    const availableRewardIds = hostState
      ? getStoredPersistentBaseRewardUnlocks()
      : session?.availableRewardIds;
    const placements = hostState?.placements ?? session?.placements ?? [];
    if (!availableRewardIds) return [];
    // Kanonisches Placement-Gate nach 3F: freigeschaltet und aktuell nicht platziert. Ein
    // zurueckgebautes Reward ist damit wieder platzierbar; eine Platzierungshistorie existiert
    // nicht mehr.
    return availableRewardIds.filter((rewardId) => (
      !placements.some((placement) => placement.rewardId === rewardId)
      && (getPersistentBaseRewardDefinition(rewardId).category !== 'baseTurret'
        || this.isPersistentBaseRuntimeActive(site))
    ));
  }

  /**
   * Ob ein Spieler in dieser World ueberhaupt Persistent-Base-Management ausfuehren darf.
   *
   * Nach 3F ist das keine Klassenfrage mehr: Base-owned Rewards gehoeren der Host-Basis, nicht
   * dem ausfuehrenden Spieler, und jede Coop-Defense-Klasse darf sie platzieren, verschieben und
   * zurueckbauen. Persoenliche Konstruktionen bleiben davon unberuehrt strikt owner-basiert.
   */
  private mayManagePersistentBase(playerId: string): boolean {
    return isCoopDefenseMode(this.resolveConfiguredGameMode())
      && bridge.getPlayerCurrentLoadoutSnapshot(playerId) !== null;
  }

  private isPersistentBaseRuntimeActive(site: WorldPersistentBaseSite): boolean {
    const baseManager = this.ctx.baseManager;
    if (!baseManager) return true;
    const base = baseManager.getBase(site.baseId);
    return base !== undefined && !base.isInert();
  }

  /**
   * Verfuegbarkeit fuer eine lokale Persistent-Base-Vorschau.
   *
   * Der Host liest den autoritativen Combat-Runtime-State. Ein Client hat bewusst keinen lokalen
   * Combat-Runtime-State und verwendet deshalb den zuletzt replizierten PlayerNetState. Diese
   * Entscheidung gilt nur fuer Preview/UI; Commit-Pfade validieren weiterhin hostseitig separat.
   */
  private isPlayerAvailableForPersistentBaseAction(playerId: string): boolean {
    if (bridge.isHost()) {
      return this.ctx.combatSystem.isAlive(playerId)
        && !this.ctx.combatSystem.isBurrowed(playerId);
    }

    const state = bridge.getLatestGameState()?.players[playerId];
    return state?.alive === true && state.isBurrowed !== true;
  }

  /** Liefert die lokale Reward-Vorschau aus dem verlaesslichen Session-Snapshot. */
  getPersistentBaseRewardPlacementPreview(
    playerId: string,
    rewardId: PersistentBaseRewardId,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined {
    const site = this.ctx.world?.persistentBaseSite ?? null;
    const placementSystem = this.ctx.placementSystem;
    const player = this.ctx.playerManager.getPlayer(playerId);
    const session = bridge.getPersistentBaseRewardSessionState();
    if (!site || !placementSystem || !player || !player.active
      || !this.mayManagePersistentBase(playerId)
      || !this.getPlayerCapabilities(playerId).canPlace
      || !this.isPlayerAvailableForPersistentBaseAction(playerId)
      || !isKnownPersistentBaseRewardId(rewardId)) return undefined;

    const hostState = bridge.isHost() ? this.ctx.persistentBaseRewards?.getState() : undefined;
    const placements = hostState?.placements ?? session?.placements ?? [];
    if (!this.getPersistentBaseRewardIdsForPlayer(playerId).includes(rewardId)) return undefined;

    const definition = getPersistentBaseRewardDefinition(rewardId);
    if (definition.category === 'baseTurret' && !this.isPersistentBaseRuntimeActive(site)) return undefined;
    const targetCell = placementSystem.getClampedTargetCell(
      player.x,
      player.y,
      pointerX,
      pointerY,
      COOP_DEFENSE_DISMANTLE_RANGE,
    );
    if (!targetCell) return undefined;
    const relative = this.resolvePersistentBaseRewardRelativeCell(site, targetCell.gridX, targetCell.gridY);
    const angle = Math.atan2(targetCell.y - player.y, targetCell.x - player.x);
    const placement: PersistentBaseRewardPlacement | null = relative
      ? {
          rewardId,
          relativeGridX: relative.relativeGridX,
          relativeGridY: relative.relativeGridY,
          angle,
        }
      : null;
    const domainValid = placement !== null
      && this.isPersistentBaseRewardPlacementInDomain(definition, site, placement);
    const duplicateCell = placement !== null && placements.some((candidate) => {
      const occupied = this.resolvePersistentBaseRewardCell(site, candidate);
      return occupied?.gridX === targetCell.gridX && occupied.gridY === targetCell.gridY;
    });
    const occupant = placementSystem.getRuntimeRockAt(targetCell.gridX, targetCell.gridY);
    const persistentContribution = occupant
      ? this.ctx.persistentBaseContributions?.getRuntimeBindings()
        .some((binding) => binding.runtimeId === occupant.id) === true
      : false;
    const conflictAllowed = !occupant || occupant.ownership === 'base-owned' || persistentContribution;
    const isValid = domainValid
      && !duplicateCell
      && conflictAllowed
      && placementSystem.canMaterializePersistentBaseRewardCell(targetCell.gridX, targetCell.gridY, true);
    return {
      angle,
      targetX: targetCell.x,
      targetY: targetCell.y,
      gridX: targetCell.gridX,
      gridY: targetCell.gridY,
      isValid,
      frame: 0,
      range: COOP_DEFENSE_DISMANTLE_RANGE,
      kind: definition.category === 'baseTurret' ? 'turret' : 'pedestal',
      sourceSlot: 'utility',
      constructionId: definition.gameplaySource.kind === 'construction-definition'
        ? definition.gameplaySource.constructionId
        : undefined,
      powerUpDefId: definition.gameplaySource.kind === 'power-up-definition'
        ? definition.gameplaySource.powerUpDefId
        : undefined,
      mode: 'place',
    };
  }

  /** Sendet eine Preview-Auswahl ueber den dedizierten Reward-Pfad zum Host. */
  async requestPersistentBaseRewardPlacement(
    rewardId: PersistentBaseRewardId,
    preview: Pick<UtilityPlacementPreviewState, 'gridX' | 'gridY' | 'angle'>,
  ): Promise<LoadoutUseResult> {
    const site = this.ctx.world?.persistentBaseSite ?? null;
    const world = bridge.getWorldDescriptor();
    if (!site || !world || !isKnownPersistentBaseRewardId(rewardId)) return { ok: false, reason: 'blocked' };
    const relative = this.resolvePersistentBaseRewardRelativeCell(site, preview.gridX, preview.gridY);
    if (!relative) return { ok: false, reason: 'placement' };
    return bridge.sendPersistentBaseRewardPlacement({
      worldRevision: world.worldRevision,
      rewardId,
      relativeGridX: relative.relativeGridX,
      relativeGridY: relative.relativeGridY,
      angle: preview.angle,
    });
  }

  // ── Repositioning ─────────────────────────────────────────────────────────

  /**
   * Vorschau der Quellwahl: Was der Spieler unter dem Cursor verschieben darf.
   *
   * Bewusst dieselbe Ownership-Domain wie der Rueckbau: eigene persoenliche Konstruktion oder
   * ein base-owned Persistent-Base-Reward. Ein fremder Beitrag, authored Weltgeometrie und
   * nicht als Konstruktion gefuehrte Runtime-Objekte sind keine gueltigen Quellen.
   */
  getPersistentBaseMoveSourcePreview(
    playerId: string,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined {
    const placementSystem = this.ctx.placementSystem;
    const player = this.ctx.playerManager.getPlayer(playerId);
    if (!placementSystem || !player || !player.active
      || !this.mayManagePersistentBase(playerId)
      // Host und Client verwenden dieselbe Availability-Regel; die Quelle des Zustands bleibt
      // dabei role-aware: autoritativer Combat-State beim Host, replizierter Player-State beim Client.
      || !this.getPlayerCapabilities(playerId).canDismantle
      || !this.isPlayerAvailableForPersistentBaseAction(playerId)) return undefined;
    const preview = placementSystem.getManagementSourcePreview(
      playerId,
      player.x,
      player.y,
      pointerX,
      pointerY,
      COOP_DEFENSE_DISMANTLE_RANGE,
      'move-source',
    );
    if (!preview) return undefined;
    const source = preview.sourceRuntimeId === undefined
      ? undefined
      : placementSystem.getRuntimeRock(preview.sourceRuntimeId);
    return { ...preview, isValid: this.isMovablePersistentBaseSource(playerId, source) };
  }

  /** Zielvorschau einer bereits gewaehlten Quelle; ohne gueltige Quelle gibt es keine Vorschau. */
  getPersistentBaseMoveTargetPreview(
    playerId: string,
    sourceRuntimeId: number,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined {
    const placementSystem = this.ctx.placementSystem;
    const player = this.ctx.playerManager.getPlayer(playerId);
    const site = this.ctx.world?.persistentBaseSite ?? null;
    if (!placementSystem || !player || !player.active
      || !this.mayManagePersistentBase(playerId)
      // Host und Client verwenden dieselbe Availability-Regel; die Quelle des Zustands bleibt
      // dabei role-aware: autoritativer Combat-State beim Host, replizierter Player-State beim Client.
      || !this.getPlayerCapabilities(playerId).canDismantle
      || !this.isPlayerAvailableForPersistentBaseAction(playerId)) return undefined;
    const source = placementSystem.getRuntimeRock(sourceRuntimeId);
    if (!this.isMovablePersistentBaseSource(playerId, source) || !source) return undefined;

    const rewardId = source.persistentRewardId;
    if (rewardId !== undefined) {
      if (!site || !isKnownPersistentBaseRewardId(rewardId)) return undefined;
      return this.buildPersistentBaseRewardMovePreview(site, rewardId, source, player, pointerX, pointerY);
    }

    const definition = this.constructionWorldRuntime?.getDefinition(source.constructionId);
    if (!definition) return undefined;
    const preview = placementSystem.getConstructionPlacementPreview(
      definition,
      player.x,
      player.y,
      pointerX,
      pointerY,
      source.id,
    );
    if (!preview) return undefined;
    // Ein persistenter Beitrag ist genau ein Beitrag innerhalb des Baubereichs. Verliesse er
    // ihn, koennte der Store ihn nicht mehr halten - das waere ein Abriss und kein Move.
    const staysPersistent = !this.isPersistentBaseBuildAreaCell(site, source.gridX, source.gridY)
      || this.isPersistentBaseBuildAreaCell(site, preview.gridX, preview.gridY);
    return { ...preview, isValid: preview.isValid && staysPersistent, mode: 'move-target', sourceRuntimeId };
  }

  /** Sendet eine Zielvorschau ueber den dedizierten Move-Pfad zum Host. */
  async requestPersistentBaseMove(
    sourceRuntimeId: number,
    preview: Pick<UtilityPlacementPreviewState, 'gridX' | 'gridY'>,
  ): Promise<LoadoutUseResult> {
    const world = bridge.getWorldDescriptor();
    const source = this.ctx.placementSystem?.getRuntimeRock(sourceRuntimeId);
    if (!world || !source) return { ok: false, reason: 'blocked' };
    return bridge.sendPersistentBaseMove({
      worldRevision: world.worldRevision,
      sourceRuntimeId,
      sourceGridX: source.gridX,
      sourceGridY: source.gridY,
      targetGridX: preview.gridX,
      targetGridY: preview.gridY,
    });
  }

  /**
   * Host-Einstiegspunkt fuer das Verschieben persistenter Basisobjekte.
   *
   * Der Host validiert vollstaendig neu, bevor er mutiert; konkurrierende Anfragen entscheidet
   * damit die erste vom Host akzeptierte Mutation. Ein Fehlschlag laesst die Quelle in jedem
   * Fall unveraendert - es entsteht kein teilweise verschobener Zustand.
   */
  movePersistentBaseObject(playerId: string, request: PersistentBaseMoveRequest): LoadoutUseResult {
    if (!bridge.isHost()) return { ok: false, reason: 'invalid' };
    const sanitized = sanitizePersistentBaseMoveRequest(request);
    if (!sanitized) return { ok: false, reason: 'invalid' };
    if (!this.acceptsPersistentBaseMutation(sanitized.worldRevision, sanitized.activityRevision)) {
      return { ok: false, reason: 'blocked' };
    }
    const world = bridge.getWorldDescriptor();
    const placementSystem = this.ctx.placementSystem;
    if (!world || !placementSystem || sanitized.worldRevision !== world.worldRevision) {
      return { ok: false, reason: 'blocked' };
    }
    const player = this.ctx.playerManager.getPlayer(playerId);
    if (!player || !player.active
      || !this.mayManagePersistentBase(playerId)
      || !this.getPlayerCapabilities(playerId).canDismantle
      || !this.ctx.combatSystem.isAlive(playerId)
      || this.ctx.combatSystem.isBurrowed(playerId)) {
      return { ok: false, reason: 'blocked' };
    }
    const now = Date.now();
    if (this.ctx.loadoutManager?.isManagementActionOnCooldown(playerId, 'reposition', now)) {
      return { ok: false, reason: 'cooldown' };
    }

    const source = placementSystem.getRuntimeRock(sanitized.sourceRuntimeId);
    // Die Quelle muss beim Commit noch dasselbe Objekt an derselben Zelle sein; sonst wurde sie
    // zwischen Vorschau und Bestaetigung zerstoert, zurueckgebaut oder ersetzt.
    if (!source
      || source.gridX !== sanitized.sourceGridX
      || source.gridY !== sanitized.sourceGridY
      || !this.isMovablePersistentBaseSource(playerId, source)) {
      return { ok: false, reason: 'blocked' };
    }

    // Zielpruefung ueber genau dieselbe Vorschau, die auch der Client sieht: Der Host baut damit
    // keine zweite, vereinfachte Placement-Regel nach.
    const targetWorld = placementSystem.getWorldPointForCell(sanitized.targetGridX, sanitized.targetGridY);
    const preview = this.getPersistentBaseMoveTargetPreview(
      playerId,
      source.id,
      targetWorld.x,
      targetWorld.y,
    );
    if (!preview
      || !preview.isValid
      || preview.gridX !== sanitized.targetGridX
      || preview.gridY !== sanitized.targetGridY) {
      return { ok: false, reason: 'placement' };
    }

    const result = source.persistentRewardId === undefined
      ? this.hostMovePersonalConstruction(playerId, source, preview)
      : this.hostMovePersistentBaseReward(source, preview);
    if (result.ok) this.markManagementActionUsed(playerId, 'reposition', now);
    return result;
  }

  /** Thin PB adapter; construction relocation is owned by the World runtime. */
  private hostMovePersonalConstruction(
    playerId: string,
    source: SyncedPlaceableRock,
    preview: UtilityPlacementPreviewState,
  ): LoadoutUseResult {
    return this.constructionWorldRuntime?.movePersonalConstruction(playerId, source, preview)
      ?? { ok: false, reason: 'blocked' };
  }

  /** Base-owned Reward: Store-Placement, Runtime, Podest und Composite wandern in einem Schritt. */
  private hostMovePersistentBaseReward(
    source: SyncedPlaceableRock,
    preview: UtilityPlacementPreviewState,
  ): LoadoutUseResult {
    const placementSystem = this.ctx.placementSystem;
    const site = this.ctx.world?.persistentBaseSite ?? null;
    const store = this.ctx.persistentBaseRewards;
    const rewardId = source.persistentRewardId;
    if (!placementSystem || !site || !store || rewardId === undefined) return { ok: false, reason: 'blocked' };
    const previousPlacement = store.getState().placements.find((entry) => entry.rewardId === rewardId);
    const relative = this.resolvePersistentBaseRewardRelativeCell(site, preview.gridX, preview.gridY);
    if (!previousPlacement || !relative) return { ok: false, reason: 'placement' };

    // Ein Reward hat hoehere Composite-Prioritaet als persoenliche Beitraege. Verdraengt wird nur
    // das Runtime-Objekt; der Blueprint seines Besitzers bleibt gespeichert.
    const occupant = placementSystem.getRuntimeRockAt(preview.gridX, preview.gridY);
    let displacedPersonalRuntime = false;
    if (occupant && occupant.id !== source.id && occupant.ownership !== 'base-owned') {
      const isPersistentContribution = this.ctx.persistentBaseContributions?.getRuntimeBindings()
        .some((binding) => binding.runtimeId === occupant.id) === true;
      if (!isPersistentContribution) return { ok: false, reason: 'placement' };
      this.persistentBaseWorldBinding?.releasePersonalRuntimeForRewardConflict(occupant.id);
      displacedPersonalRuntime = true;
    }

    const previous: SyncedPlaceableRock = { ...source };
    if (!store.moveReward({
      rewardId,
      relativeGridX: relative.relativeGridX,
      relativeGridY: relative.relativeGridY,
      angle: preview.angle,
    })) {
      if (displacedPersonalRuntime) this.reconcilePersistentBaseWorld();
      return { ok: false, reason: 'blocked' };
    }
    const relocated = placementSystem.relocateRock(source.id, preview.gridX, preview.gridY, preview.angle);
    if (!relocated) {
      store.moveReward(previousPlacement);
      this.reconcilePersistentBaseWorld();
      return { ok: false, reason: 'placement' };
    }

    this.persistentBaseWorldBinding?.relocateRewardRuntime(rewardId, relocated);
    this.relocatePlaceableRuntimePresentation(previous, relocated);
    this.persistCurrentCommittedPersistentBaseRewards();
    this.publishPersistentBaseRewardSessionState();
    // Ein einziger Composite-Lauf gegen den neuen Zustand: Die Quellzelle wird wieder frei, die
    // Zielzelle bleibt reserviert.
    this.reconcilePersistentBaseWorld();
    return { ok: true };
  }

  /** Gueltige Move-Quelle: eigenes Konstrukt oder base-owned Persistent-Base-Reward. */
  private isMovablePersistentBaseSource(
    playerId: string,
    source: SyncedPlaceableRock | undefined,
  ): boolean {
    if (!source) return false;
    if (source.ownership === 'base-owned') {
      return source.persistentRewardId !== undefined
        && isKnownPersistentBaseRewardId(source.persistentRewardId);
    }
    return this.constructionWorldRuntime?.isMovableConstructionSource(playerId, source) ?? false;
  }

  /** True, wenn diese absolute Rasterzelle im aktiven Baubereich der persistenten Basis liegt. */
  private isPersistentBaseBuildAreaCell(
    site: WorldPersistentBaseSite | null,
    gridX: number,
    gridY: number,
  ): boolean {
    return site !== null && isCellInsidePersistentBaseBuildArea(
      gridX - site.anchor.gridX,
      gridY - site.anchor.gridY,
      site.buildArea,
    );
  }

  /** Zielvorschau eines bereits platzierten Rewards; seine eigene Zelle ist kein Zielkonflikt. */
  private buildPersistentBaseRewardMovePreview(
    site: WorldPersistentBaseSite,
    rewardId: PersistentBaseRewardId,
    source: SyncedPlaceableRock,
    player: { readonly x: number; readonly y: number },
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined {
    const placementSystem = this.ctx.placementSystem;
    if (!placementSystem) return undefined;
    const definition = getPersistentBaseRewardDefinition(rewardId);
    const targetCell = placementSystem.getClampedTargetCell(
      player.x,
      player.y,
      pointerX,
      pointerY,
      COOP_DEFENSE_DISMANTLE_RANGE,
    );
    if (!targetCell) return undefined;
    const relative = this.resolvePersistentBaseRewardRelativeCell(site, targetCell.gridX, targetCell.gridY);
    const angle = Math.atan2(targetCell.y - player.y, targetCell.x - player.x);
    const placement: PersistentBaseRewardPlacement | null = relative
      ? {
          rewardId,
          relativeGridX: relative.relativeGridX,
          relativeGridY: relative.relativeGridY,
          angle,
        }
      : null;
    const session = bridge.getPersistentBaseRewardSessionState();
    const placements = (bridge.isHost() ? this.ctx.persistentBaseRewards?.getState().placements : undefined)
      ?? session?.placements
      ?? [];
    const duplicateCell = placement !== null && placements.some((candidate) => {
      if (candidate.rewardId === rewardId) return false;
      const occupied = this.resolvePersistentBaseRewardCell(site, candidate);
      return occupied?.gridX === targetCell.gridX && occupied.gridY === targetCell.gridY;
    });
    const occupant = placementSystem.getRuntimeRockAt(targetCell.gridX, targetCell.gridY);
    const persistentContribution = occupant
      ? this.ctx.persistentBaseContributions?.getRuntimeBindings()
        .some((binding) => binding.runtimeId === occupant.id) === true
      : false;
    const conflictAllowed = !occupant
      || occupant.id === source.id
      || occupant.ownership === 'base-owned'
      || persistentContribution;
    const isValid = placement !== null
      && this.isPersistentBaseRewardPlacementInDomain(definition, site, placement)
      && !duplicateCell
      && conflictAllowed
      && (definition.category !== 'baseTurret' || this.isPersistentBaseRuntimeActive(site))
      && placementSystem.canMaterializePersistentBaseRewardCell(
        targetCell.gridX,
        targetCell.gridY,
        true,
        source.id,
      );
    return {
      angle,
      targetX: targetCell.x,
      targetY: targetCell.y,
      gridX: targetCell.gridX,
      gridY: targetCell.gridY,
      isValid,
      frame: 0,
      range: COOP_DEFENSE_DISMANTLE_RANGE,
      kind: definition.category === 'baseTurret' ? 'turret' : 'pedestal',
      sourceSlot: 'utility',
      constructionId: definition.gameplaySource.kind === 'construction-definition'
        ? definition.gameplaySource.constructionId
        : undefined,
      powerUpDefId: definition.gameplaySource.kind === 'power-up-definition'
        ? definition.gameplaySource.powerUpDefId
        : undefined,
      mode: 'move-target',
      sourceRuntimeId: source.id,
    };
  }

  /**
   * Setzt die Darstellung eines verschobenen Runtime-Objekts auf seine neue Zelle um.
   *
   * Nur Darstellung: Runtime-ID, HP, Besitz und alle registrierten Systemreferenzen bleiben
   * bestehen. `releasePlaceableRuntime` waere hier ausdruecklich falsch - es wuerde Podeste und
   * Zielverfolgung abmelden, die dieser Move gerade erhalten soll.
   */
  private relocatePlaceableRuntimePresentation(
    previous: SyncedPlaceableRock,
    next: SyncedPlaceableRock,
  ): void {
    this.rockVisualHelper.removePlaceableRockVisual(previous, false);
    this.rockVisualHelper.materializePlaceableRock(next, false);
    // Zwei Zellen haben sich geaendert; die unvollstaendige Payload erzwingt bewusst genau einen
    // Flowfield-/Fire-Resync fuer beide.
    emitArenaMapGridChanged(this.scene.game.events, {
      reason: 'placeables_batch_removed',
      source: next.kind === 'rock'
        ? 'placeable_rock'
        : next.kind === 'pedestal' ? 'placeable_pedestal' : 'placeable_turret',
    });
  }

  /** Startet den kurzen Doppelinput-Schutz einer Management-Aktion und repliziert ihn. */
  private markManagementActionUsed(playerId: string, action: 'reposition' | 'dismantle', now: number): void {
    this.ctx.loadoutManager?.markManagementActionUsed(
      playerId,
      action,
      now,
      COOP_DEFENSE_MANAGEMENT_COOLDOWN_MS,
    );
    // Ueber denselben keyed Kanal wie Utility- und Bau-Cooldowns, damit das Radial denselben
    // echten Zustand darstellt.
    bridge.publishUtilityCooldownUntil(
      playerId,
      now + COOP_DEFENSE_MANAGEMENT_COOLDOWN_MS,
      `management:${action}`,
    );
  }

  /** Host callback fuer den atomaren Rollenwechsel; kein CombatSystem-Tod. */
  handleSpectatorEntered(playerId: string): void {
    if (bridge.getGamePhase() !== 'ARENA') return;
    this.removeGuestSessionOwner(playerId);
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
    this.removeGuestSessionOwner(playerId);
  }

  getActiveConstructionToolsForPlayer(playerId: string): readonly LoadoutToolRef[] {
    return this.constructionWorldRuntime?.getActiveTools(playerId) ?? [];
  }

  getConstructionCapacityForPlayer(playerId: string): number {
    return this.constructionWorldRuntime?.getCapacity(playerId) ?? 0;
  }

  private removeGuestSessionOwner(playerId: string): void {
    if (!bridge.isHost() || playerId === bridge.getLocalPlayerId()) return;
    const runtimeIds = this.persistentBaseSession.removePlayerOwner(playerId);
    let removedCount = 0;
    for (const runtimeId of runtimeIds) {
      const removed = this.ctx.placementSystem?.removeRock(runtimeId);
      if (!removed) continue;
      this.constructionWorldRuntime?.finalizeDismantledConstruction(removed, false);
      removedCount += 1;
    }
    // Guest constructions outside a persistent base are still World-owned runtime objects and
    // must not survive the owner's final leave/spectator transition.
    for (const construction of this.ctx.placementSystem?.getOwnedConstructions(playerId) ?? []) {
      // Older snapshots may not carry the explicit ownership field yet. The owner identity still
      // makes this a guest-owned runtime; only authored base-owned objects stay reserved.
      if (construction.ownership === 'base-owned') continue;
      const removed = this.ctx.placementSystem?.removeRock(construction.id);
      if (!removed) continue;
      this.constructionWorldRuntime?.finalizeDismantledConstruction(removed, false);
      removedCount += 1;
    }
    if (removedCount > 0) {
      emitArenaMapGridChanged(this.scene.game.events, {
        reason: 'placeables_batch_removed',
        source: 'placeable_rock',
      });
    }
    // Mit dem Verdraenger faellt der Grund: Ein zuvor unterdrueckter Blueprint eines anderen
    // Besitzers darf jetzt wieder erscheinen.
    this.reconcilePersistentBaseWorld();
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
      && this.ctx.world?.definition?.participationPolicy?.selfAdmit === true;
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
        this.ctx.world?.definition?.presentationPolicy?.previewWithoutParticipation === true,
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
    const enemySprites = (this.ctx.enemyManager?.getAllEnemies() ?? []).map((enemy) => enemy.sprite);
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
        || this.ctx.world?.definition?.actionPolicy?.combat === true,
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
    this.rollbackPersistentBaseMissionIfActive();

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
      ? this.ctx.worldPresentation ?? this.worldPresentationHandoff.pending
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
    // Die lokale Runtime haengt sich an die laufende World-Instanz; der Lifecycle schreibt
    // `ctx.world` und prueft, dass Runtime und Instanz dieselbe World meinen.
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
    this.ctx.hostHeldActionSystem?.reset();
    this.ctx.hostHeldActionSystem = bridge.isHost() ? new HostHeldActionSystem() : null;
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
    this.ctx.worldMaterialization = materialization;
    this.ctx.worldPresentation = builtWorld.presentation;
    this.persistentBaseWorldBinding = persistentBaseBinding;
    this.persistentBaseSession.useWorldRuntimes(persistentBaseBinding.constructionRuntimes);
    if (coopMissionRuntime && baseManager && missionMapConfig && activityDescriptor) {
      this.attachCoopMissionBaseBinding(activityDescriptor, coopMissionRuntime);
    }
    bridge.setLocalWorldLoadProgress(worldDescriptor.worldRevision, 60, 'building');
    this.ctx.persistentBaseContributions = null;
    this.ctx.persistentBaseRewards = null;
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
      if (!this.persistentBaseSession.hasOpenTransaction) {
        this.ingestOfferedPersistentBaseContributions();
        this.persistentBaseRewards.replaceCommittedState(getStoredPersistentBaseRewardState());
      }
      if (activityDescriptor !== null && !this.persistentBaseSession.hasOpenTransaction) {
        throw new Error(
          '[ArenaLifecycleCoordinator] Activity identity has no PersistentBase transaction',
        );
      }
      this.ctx.persistentBaseContributions = this.persistentBaseContributions;
      this.ctx.persistentBaseRewards = this.persistentBaseRewards;
      persistentBaseBinding.setSite(persistentBaseSite.anchor, persistentBaseSite.buildArea);
    } else {
      persistentBaseBinding.setSite(null, null);
    }
    placementSystem.setClosedBarrierCellResolver((gridX, gridY) => (
      this.coopMissionRuntime?.coopDefenseMissionBarrierManager?.isCellClosed(gridX, gridY) ?? false
    ));
    // Eine vorbereitete Gefahrenflaeche sperrt das Bauen erst ab ihrer Ankuendigung. Host und
    // Client lesen dafuer denselben replizierten Event-Snapshot, damit Bauvorschau und
    // Host-Pruefung nicht auseinanderlaufen.
    placementSystem.setHazardEventArmedResolver((eventId) => {
      const entry = bridge.getCoopDefenseMapEventPresentationState()
        ?.find((candidate) => candidate.eventId === eventId);
      return entry === undefined ? true : entry.state !== 'dormant';
    });
    const worldGeometryBinding = new WorldGeometryBinding({
      scene: this.scene,
      world,
      layout,
      bases: worldBases,
      arena: arenaResult,
      placement: placementSystem,
      baseManager,
      presentationRequired: presentation,
      playerManager: this.ctx.playerManager,
      combatSystem: this.ctx.combatSystem,
      decoySystem: this.ctx.decoySystem,
      projectileManager: this.ctx.projectileManager,
      hostPhysics: this.ctx.hostPhysics,
      fireSystem: this.ctx.fireSystem,
      leafBlower: this.renderers.leafBlower,
      lighting: this.renderers.lighting,
      isCaptureTheBeer: layoutMode === CAPTURE_THE_BEER_MODE,
      getBarrierCellBlocked: (gridX, gridY) => (
        this.coopMissionRuntime?.coopDefenseMissionBarrierManager?.isCellClosed(gridX, gridY) ?? false
      ),
      onDestroy: (binding) => {
        if (this.worldGeometryBinding === binding) this.worldGeometryBinding = null;
      },
    });
    this.worldGeometryBinding = worldGeometryBinding;
    worldRuntime.bind(worldGeometryBinding);
    // Host und Client halten das System: der Host autoritativ, der Client fuer die Darstellung.
    const targetingRuntime = new WorldTargetingRuntime({
      onSystemsChanged: (systems: WorldTargetingSystems | null) => {
        this.ctx.reinforcementMatrixSystem = systems?.reinforcementMatrix ?? null;
        this.ctx.energyInjectorSystem = systems?.energyInjector ?? null;
        this.ctx.targetStatusSystem = systems?.targetStatus ?? null;
      },
    });
    this.worldTargetingRuntime = targetingRuntime;
    worldRuntime.bind(targetingRuntime);

    // Eine Basisaenderung trifft alle Felder gemeinsam: Der Coordinator verschickt den Patch
    // prioritaer und sperrt die entfallenen Zielzellen sofort, bis das neue Feld aktiv ist.
    const syncActiveBaseIds = (): void => {
      this.coopMissionRuntime?.flowFieldCoordinator?.setActiveBaseIds(
        baseManager?.getActiveBaseIds() ?? new Set<string>(),
      );
    };
    if (coopMissionRuntime && isCoopMission) {
      const activityConfiguration = activityDescriptor
        ? resolveCoopMissionActivityConfiguration(activityDescriptor, world.definition)
        : null;
      this.coopMissionComposition.materializeCore(activityConfiguration, coopMissionRuntime, layout);
    }
    // The renderer is World-scoped on every peer; authoritative train setup is owned by the
    // World train runtime after the systems it references have been bound.
    const trainRuntime = new WorldTrainRuntime({
      scene: this.scene,
      playerManager: this.ctx.playerManager,
      projectileManager: this.ctx.projectileManager,
      combatSystem: this.ctx.combatSystem,
      hostPhysics: this.ctx.hostPhysics,
      worldMetrics: world.metrics,
      presentationRequired: presentation,
      gameAudioSystem: this.ctx.gameAudioSystem,
      network: {
        clock: {
          getArenaStartTime: () => bridge.getArenaStartTime(),
          now: () => bridge.getSynchronizedNow(),
        },
        trainEvents: {
          isHost: () => bridge.isHost(),
          get: () => bridge.getTrainEvent(),
          publish: (event) => bridge.publishTrainEvent(event),
          clear: () => bridge.clearTrainEvent(),
        },
        matchEvents: {
          addPlayerFrags: (playerId, amount) => bridge.addPlayerFrags(playerId, amount),
          getConnectedPlayers: () => bridge.getConnectedPlayers(),
          broadcastKillEvent: (event) => bridge.broadcastKillEvent(event),
          broadcastTrainDestroyed: () => bridge.broadcastTrainDestroyed(),
        },
        effects: {
          broadcastTrainBurrowSparks: (x, y) => bridge.broadcastTrainBurrowSparks(x, y),
          broadcastExplosionEffect: (x, y, radius, color, visualStyle) => (
            bridge.broadcastExplosionEffect(x, y, radius, color, visualStyle)
          ),
        },
      },
      getEnemyManager: () => this.ctx.enemyManager,
      getBurrowSystem: () => this.ctx.burrowSystem,
      getTimeBubbleSystem: () => this.ctx.timeBubbleSystem,
      getTranslocatorSystem: () => this.ctx.translocatorSystem,
      getPowerUpSystem: () => this.ctx.powerUpSystem,
      setCurrentTrain: (train) => { this.ctx.trainManager = train; },
      setClassicTrainSpawned: (spawned) => { this.hostUpdate.setClassicTrainSpawned(spawned); },
      onRendererChanged: (renderer) => { this.renderers.train = renderer; },
    });
    this.worldTrainRuntime = trainRuntime;
    worldRuntime.bind(trainRuntime);
    if (bridge.isHost()) {
      // Der Coop-Build gehoert zur laufenden World und kann deshalb auch in einer Activity-losen
      // LobbyWorld wirken. Die darunterliegenden Missionssysteme bleiben weiterhin an
      // `isCoopMission`/`missionMapConfig` gebunden.
      const playerGameplayRuntime = new WorldPlayerGameplayRuntime({
        playerManager: this.ctx.playerManager,
        projectileManager: this.ctx.projectileManager,
        combatSystem: this.ctx.combatSystem,
        hostPhysics: this.ctx.hostPhysics,
        fireSystem: this.ctx.fireSystem,
        placementSystem,
        gameAudioSystem: this.ctx.gameAudioSystem,
        worldMetrics: world.metrics,
        getEnemyManager: () => this.ctx.enemyManager,
        getTargetStatusSystem: () => this.ctx.targetStatusSystem,
        getPowerUpSystem: () => this.ctx.powerUpSystem,
        getPlayerCapabilities: (playerId) => this.getPlayerCapabilities(playerId),
        getTeamAdrenalineRegenMultiplier: (playerId) => this.ctx.coopDefenseTeamBuffSystem?.getAdrenalineRegenMultiplier(
          Date.now(),
          bridge.canPlayerReceiveRoundRewards(playerId),
          this.ctx.combatSystem.isAlive(playerId),
        ) ?? 1,
        resetPlayerPosition: (playerId, x, y) => {
          this.coopMissionRuntime?.coopDefenseMissionProgressSystem?.resetPlayerPosition(playerId, x, y);
        },
        dropBeer: (playerId, x, y) => this.ctx.captureTheBeerSystem?.dropBeerForPlayer(playerId, x, y),
        createLoadoutManager: (resourceSystem) => new LoadoutManager(
          this.ctx.playerManager,
          this.ctx.projectileManager,
          resourceSystem,
          bridge,
        ),
        createBurrowSystem: (resourceSystem) => new BurrowSystem(
          resourceSystem,
          this.ctx.playerManager,
          this.ctx.combatSystem,
          this.ctx.hostPhysics,
          bridge,
        ),
        network: {
          teams: {
            isEnemyPair: (firstPlayerId, secondPlayerId) => bridge.isEnemyPair(firstPlayerId, secondPlayerId),
          },
          input: {
            getPlayerInput: (playerId) => bridge.getPlayerInput(playerId),
          },
          presentation: {
            broadcastExplosionEffect: (x, y, radius, color) => bridge.broadcastExplosionEffect(x, y, radius, color),
            broadcastFireChunkEffect: (x, y, targets, landsAt, visualStyle) => bridge.broadcastFireChunkEffect(x, y, targets, landsAt, visualStyle),
            broadcastMiniRocketCollectionEffect: (x, y, color) => bridge.broadcastMiniRocketCollectionEffect(x, y, color),
            broadcastMiniRocketDestructionEffect: (x, y, color) => bridge.broadcastMiniRocketDestructionEffect(x, y, color),
          },
          roundStats: {
            canPlayerReceiveRoundRewards: (playerId) => bridge.canPlayerReceiveRoundRewards(playerId),
            recordUtilityUsed: (playerId) => bridge.recordUtilityUsed(playerId),
            recordConstructionBuilt: (playerId) => bridge.recordConstructionBuilt(playerId),
            recordUltimateUsed: (playerId) => bridge.recordUltimateUsed(playerId),
          },
        },
        onSystemsChanged: (systems: WorldPlayerGameplaySystems | null) => {
          this.ctx.coopDefensePlayerModifierSystem = systems?.playerModifier ?? null;
          this.ctx.coopDefenseItemRuntimeSystem = systems?.itemRuntime ?? null;
          this.ctx.resourceSystem = systems?.resource ?? null;
          this.ctx.burrowSystem = systems?.burrow ?? null;
          this.ctx.loadoutManager = systems?.loadout ?? null;
          this.ctx.translocatorSystem = systems?.translocator ?? null;
          this.ctx.tunnelSystem = systems?.tunnel ?? null;
          this.ctx.guardianSpiritSystem = systems?.guardianSpirit ?? null;
          this.ctx.repairDroneSystem = systems?.repairDrone ?? null;
          this.ctx.slimeTrailSystem = systems?.slimeTrail ?? null;
          this.ctx.flamethrowerUpgradeSystem = systems?.flamethrowerUpgrade ?? null;
          this.ctx.weaponUpgradeSystem = systems?.weaponUpgrade ?? null;
          this.ctx.ak47StrategicTargetSystem = systems?.ak47StrategicTarget ?? null;
        },
      });
      this.worldPlayerGameplayRuntime = playerGameplayRuntime;
      worldRuntime.bind(playerGameplayRuntime);
      this.syncHostCoopDefensePlayerModifiersFromCurrentBuild();


    }
    const combatGameplayBinding = new WorldCombatGameplayBinding({
      playerManager: this.ctx.playerManager,
      projectileManager: this.ctx.projectileManager,
      combatSystem: this.ctx.combatSystem,
      hostPhysics: this.ctx.hostPhysics,
      decoySystem: this.ctx.decoySystem,
      fireSystem: this.ctx.fireSystem,
      gameAudioSystem: this.ctx.gameAudioSystem,
      placementSystem,
      baseManager,
      worldMetrics: world.metrics,
      isCoopMission: () => this.worldLifecycle.activity.is('coop-mission'),
      isActivityActive: () => this.worldLifecycle.activity.isActive(),
      getWorldParticipation: (playerId) => this.getWorldParticipation(playerId),
      getPlayerCapabilities: (playerId) => this.getPlayerCapabilities(playerId),
      getEnemyManager: () => this.ctx.enemyManager,
      getPlayerSystems: () => this.worldPlayerGameplayRuntime?.systems ?? null,
      getPowerUpSystem: () => this.ctx.powerUpSystem,
      getTargetStatusSystem: () => this.ctx.targetStatusSystem,
      getEnergyInjectorSystem: () => this.ctx.energyInjectorSystem,
      getWorldGeometryBinding: () => this.worldGeometryBinding,
      getPersistentBaseId: () => this.ctx.world?.persistentBaseSite?.baseId,
      getConstructionMuzzleOffset: (constructionId) => this.constructionWorldRuntime?.getMuzzleOffset(constructionId),
      getTargetFootprint: (target) => this.getTargetFootprint(target),
      resolveObstacleDamage: (rockId, damage, attackerId) => this.resolveObstacleDamage(rockId, damage, attackerId),
      applyObstacleDamageById: (rockId, damage, attackerId) => this.rockVisualHelper.applyObstacleDamageById(rockId, damage, attackerId),
      handleDestroyedRock: (rockId, reason, attackerId) => this.rockVisualHelper.handleDestroyedRock(rockId, reason, attackerId),
      updateTurretAngle: (rockId, angle) => this.rockVisualHelper.updateTurretAngle(rockId, angle),
      spawnImpactCloud: (projectile, x, y) => this.spawnImpactCloudFromProjectile(projectile, x, y),
      resetPlayerPosition: (playerId, x, y) => this.coopMissionRuntime?.coopDefenseMissionProgressSystem?.resetPlayerPosition(playerId, x, y),
      dropBeer: (playerId, x, y) => this.ctx.captureTheBeerSystem?.dropBeerForPlayer(playerId, x, y),
      dropCarryForPlayer: (playerId, x, y) => this.coopMissionRuntime?.coopDefenseCarrySystem?.dropForPlayer(playerId, x, y),
      handlePlayerUnavailable: (playerId) => this.coopMissionRuntime?.coopDefenseObjectivePlacementRewardSystem?.handlePlayerUnavailable(playerId),
      handlePlayerDeath: (playerId) => this.playerActivityRuntime?.handlePlayerDeath(playerId),
      handleCoopItemKill: (killerId, victimId, x, y) => this.hostHandleCoopDefenseItemKill(killerId, victimId, x, y),
      getSecondaryObjectiveState: (objectiveId) => {
        const state = bridge.getCoopDefenseSecondaryObjectivePresentationState();
        return state?.find(entry => entry.objectiveId === objectiveId)?.state ?? null;
      },
      reportTargetContribution: (objectiveId, baseId) => this.coopMissionRuntime?.coopDefenseSecondaryObjectiveSystem?.reportTargetContribution(objectiveId, baseId),
      reportTargetDestroyed: (objectiveId, baseId) => this.coopMissionRuntime?.coopDefenseSecondaryObjectiveSystem?.reportTargetDestroyed(objectiveId, baseId) ?? 0,
      reconcilePersistentBaseWorld: () => this.reconcilePersistentBaseWorld(),
      syncActiveBaseIds,
      getMissionBarrierObstacles: () => this.coopMissionRuntime?.coopDefenseMissionBarrierManager?.getObstacleRectangles() ?? null,
      getRockTargets: () => (this.ctx.arenaResult?.rockPhysicsProxies ?? []).flatMap(rock => rock && rock.active ? [{ active: true, x: rock.x, y: rock.y }] : []),
      getWorldTrain: () => this.worldTrainRuntime,
      getTimebombSystem: () => this.ctx.coopDefenseTimebombSystem,
      getNecromancySystem: () => this.ctx.necromancySystem,
      hostUpdate: this.hostUpdate,
      createEnergyShieldSystem: (resource, shield) => new EnergyShieldSystem(this.ctx.playerManager, resource, bridge, shield),
      network: {
        authority: {
          isHost: () => bridge.isHost(),
          isEnemyPair: (first, second) => bridge.isEnemyPair(first, second),
          getPlayerProfile: (playerId) => bridge.getPlayerProfile(playerId),
          getConnectedPlayers: () => bridge.getConnectedPlayers(),
        },
        round: {
          canPlayerInitialSpawn: (playerId) => bridge.canPlayerInitialSpawn(playerId),
          canPlayerRespawn: (playerId) => bridge.canPlayerRespawn(playerId),
          canPlayerReceiveRoundRewards: (playerId) => bridge.canPlayerReceiveRoundRewards(playerId),
          addCoopDefenseRoundXp: (amount) => { bridge.addCoopDefenseRoundXp(amount); },
        },
        stats: {
          recordPlayerDamageTaken: (playerId, hpLost, armorLost) => bridge.recordPlayerDamageTaken(playerId, hpLost, armorLost),
          addPlayerRoomDamage: (playerId, amount) => bridge.addPlayerRoomDamage(playerId, amount),
          recordHealingReceived: (playerId, amount) => bridge.recordHealingReceived(playerId, amount),
          recordArmorReceived: (playerId, amount) => bridge.recordArmorReceived(playerId, amount),
          recordPlayerDeath: (playerId) => bridge.recordPlayerDeath(playerId),
          recordPlayerKill: (playerId, kind) => bridge.recordPlayerKill(playerId, kind),
          incrementPlayerFrags: (playerId) => bridge.incrementPlayerFrags(playerId),
        },
        effects: {
          broadcastSlimeBloomEffect: (x, y, targets) => bridge.broadcastSlimeBloomEffect(x, y, targets),
          broadcastExplosionEffect: (x, y, radius, color, style) => bridge.broadcastExplosionEffect(x, y, radius, color, style),
          broadcastBfgLaserBatch: (lines, color, preset, projectileId) => bridge.broadcastBfgLaserBatch([...lines], color, preset, projectileId),
          broadcastMiniRocketCollectionEffect: (x, y, color) => bridge.broadcastMiniRocketCollectionEffect(x, y, color),
          broadcastMiniRocketDestructionEffect: (x, y, color) => bridge.broadcastMiniRocketDestructionEffect(x, y, color),
          broadcastKillEvent: (event) => bridge.broadcastKillEvent(event),
        },
      },
      respawnPlayer: (playerId) => this.playerActivityRuntime?.consumeRespawn(playerId) ?? true,
      getTeamHpRegenBonus: (playerId) => this.ctx.coopDefenseTeamBuffSystem?.getHpRegenBonus(Date.now(), bridge.canPlayerReceiveRoundRewards(playerId), this.ctx.combatSystem.isAlive(playerId)) ?? 0,
      getMatrixDamageReduction: (footprint, applies) => this.ctx.reinforcementMatrixSystem?.getDamageReductionForFootprint(footprint, Date.now(), applies) ?? 0,
      getMatrixDamageMultiplier: (footprint, applies) => this.ctx.reinforcementMatrixSystem?.getDamageMultiplierForFootprint(footprint, Date.now(), applies) ?? 1,
      onSystemsChanged: (systems: WorldCombatGameplaySystems | null) => {
        this.ctx.shieldBuffSystem = systems?.shieldBuff ?? null;
        this.ctx.timeBubbleSystem = systems?.timeBubble ?? null;
        this.ctx.teslaDomeSystem = systems?.teslaDome ?? null;
        this.ctx.energyShieldSystem = systems?.energyShield ?? null;
        this.ctx.turretSystem = systems?.turret ?? null;
      },
    });
    this.worldCombatGameplayBinding = combatGameplayBinding;
    worldRuntime.bind(combatGameplayBinding);

    if (!coopMissionRuntime) {
      bridge.publishCoopDefenseRespawnBudgetState(null);
      // Ohne Mission gibt es keinen Fortschritt zu zeigen; ein stehengebliebener Stand waere das
      // Bild der letzten Runde.
      bridge.publishCoopDefenseMissionProgressPresentationState(null);
    }
    if (bridge.isHost()) {
      const powerUpRuntime = new WorldPowerUpRuntime({
        playerManager: this.ctx.playerManager,
        combatSystem: this.ctx.combatSystem,
        layout,
        worldMetrics: world.metrics,
        recordPowerUpCollected: (playerId) => bridge.recordPowerUpCollected(playerId),
        addTemporaryUtility: (playerId, config) => (
          this.ctx.loadoutManager?.addTemporaryUtility(playerId, config, 1) !== null
        ),
        claimObjectiveReward: (objectiveId, playerId) => (
          this.coopMissionRuntime?.coopDefenseObjectivePlacementRewardSystem?.claim(objectiveId, playerId) ?? false
        ),
        reportDiagnosticEvent: (type, fields) => this.runtimeDiagnosticEventSink?.(type, fields),
        broadcastExplosion: (x, y, radius, color, style) => (
          bridge.broadcastExplosionEffect(x, y, radius, color, style)
        ),
        applyNukeEnvironmentDamage: (x, y, radius, triggeredBy) => (
          this.hostUpdate.applyNukeEnvironmentDamage(x, y, radius, triggeredBy)
        ),
        notifyVoidHunterNuke: (strike) => this.ctx.coopDefenseVoidHunterSystem?.notifyNukeExploded(strike),
        coopDefenseMapXpReference: 1,
        isAdrenalineDropEnabled: (playerId) => (
          (this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.adrenalineDropEnabled', 0) ?? 0) > 0
        ),
        getAdrenalineDropChanceMultiplier: (playerId) => (
          1 + (this.ctx.coopDefensePlayerModifierSystem?.getPercentageStat(playerId, 'player.adrenalineDropChance') ?? 0)
        ),
        getAdrenalineSyringeDurationMultiplier: (playerId) => (
          1 + (this.ctx.coopDefensePlayerModifierSystem?.getPercentageStat(playerId, 'player.adrenalineSyringeDuration') ?? 0)
        ),
        isLinkedBaseActive: (baseId) => this.ctx.baseManager?.getActiveBaseIds().has(baseId) ?? false,
        getConstructionRespawnMultiplier: (constructionId) => {
          const rock = this.ctx.placementSystem?.getRuntimeRock(constructionId);
          if (!rock) return 1;
          const rockWorld = this.rockVisualHelper.gridToWorld(rock.gridX, rock.gridY);
          return this.ctx.energyInjectorSystem?.getPowerUpRespawnMultiplierAt(rockWorld.x, rockWorld.y) ?? 1;
        },
        onDestroy: () => {
          if (this.worldPowerUpRuntime === powerUpRuntime) this.worldPowerUpRuntime = null;
          if (this.ctx.powerUpSystem === powerUpRuntime.system) this.ctx.powerUpSystem = null;
        },
      });
      this.worldPowerUpRuntime = powerUpRuntime;
      worldRuntime.bind(powerUpRuntime);
      this.ctx.powerUpSystem = powerUpRuntime.system;
      this.ctx.powerUpSystem.setArenaStartTime(bridge.getArenaStartTime());
      this.syncCoopDefenseMapXpReference(this.coopMissionRuntime);
      this.worldPlayerGameplayRuntime?.setPowerUpSystem(this.ctx.powerUpSystem);
      const loadoutManager = this.ctx.loadoutManager;
      const burrowSystem = this.ctx.burrowSystem;
      const resourceSystem = this.ctx.resourceSystem;
      if (!loadoutManager || !burrowSystem || !resourceSystem) {
        throw new Error('[ArenaLifecycleCoordinator] Player gameplay runtime is missing on host');
      }
      const constructionRuntime = new ConstructionWorldRuntime({
        scene: this.scene,
        playerManager: this.ctx.playerManager,
        combatSystem: this.ctx.combatSystem,
        placementSystem,
        loadoutManager,
        targetStatusSystem: this.ctx.targetStatusSystem,
        energyInjectorSystem: this.ctx.energyInjectorSystem,
        powerUpSystem: this.ctx.powerUpSystem,
        modifierSystem: this.ctx.coopDefensePlayerModifierSystem,
        burrowSystem,
        tunnelSystem: this.ctx.tunnelSystem,
        gameAudioSystem: this.ctx.gameAudioSystem,
        getGameMode: () => this.resolveConfiguredGameMode(),
        getPlayerCapabilities: (playerId) => this.getPlayerCapabilities(playerId),
        getCurrentLoadout: (playerId) => bridge.getPlayerCurrentLoadoutSnapshot(playerId),
        getPersistentBaseContext: (): ConstructionPersistentBaseContext | null => {
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
        persistentBaseBinding,
        resolveOwnerId: (playerId) => this.resolveOwnerId(playerId),
        getLocalPlayerId: () => bridge.getLocalPlayerId(),
        isHost: () => bridge.isHost(),
        acceptsPersistentBaseMutation: (activityRevision) => this.acceptsCurrentPersistentBaseMutation(activityRevision),
        mayManagePersistentBase: (playerId) => this.mayManagePersistentBase(playerId),
        getRewardPlacementRuntime: () => {
          const runtime = this.coopMissionRuntime?.coopDefenseObjectivePlacementRewardSystem;
          return runtime
            ? { canPlace: (objectiveId, playerId) => runtime.canPlace(objectiveId, playerId), consume: (objectiveId, playerId) => runtime.consume(objectiveId, playerId) }
            : null;
        },
        emitGridChanged: (event) => emitArenaMapGridChanged(this.scene.game.events, {
          reason: event.reason,
          source: event.source,
          ...(event.runtime ? {
            obstacleId: event.runtime.id,
            gridX: event.runtime.gridX,
            gridY: event.runtime.gridY,
            collisionMode: event.runtime.collisionMode,
          } : {}),
        }),
        relocatePresentation: (previous, next) => this.relocatePlaceableRuntimePresentation(previous, next),
        reconcilePersistentBaseWorld: () => this.reconcilePersistentBaseWorld(),
        publishImmediateContribution: (ownerId) => this.publishImmediatePersistentBaseContribution(ownerId),
        persistRewards: () => this.persistCurrentCommittedPersistentBaseRewards(),
        publishRewardSessionState: () => this.publishPersistentBaseRewardSessionState(),
        publishUtilityCooldown: (playerId, until, key) => bridge.publishUtilityCooldownUntil(playerId, until, key),
        recordConstructionBuilt: (playerId) => bridge.recordConstructionBuilt(playerId),
        onDestroy: () => {
          if (this.constructionWorldRuntime === constructionRuntime) this.constructionWorldRuntime = null;
        },
        rockVisualHelper: {
          gridToWorld: (gridX, gridY) => this.rockVisualHelper.gridToWorld(gridX, gridY),
          materializePlaceableRock: (runtime, playDust) => this.rockVisualHelper.materializePlaceableRock(runtime, playDust),
          removePlaceableRockVisual: (runtime, playDust) => this.rockVisualHelper.removePlaceableRockVisual(runtime, playDust),
        },
      });
      this.constructionWorldRuntime = constructionRuntime;
      worldRuntime.bind(constructionRuntime);
      persistentBaseBinding.setMaterializer(new PersistentBaseWorldMaterializer({
        binding: persistentBaseBinding,
        contributions: this.persistentBaseContributions,
        rewards: this.persistentBaseRewards,
        placementSystem,
        powerUpSystem: this.ctx.powerUpSystem,
        baseManager,
        // The WorldLifecycle sink clears its local runtime slot before destroying the runtime.
        // Read the descriptor context until that destruction has completed so PB finalization
        // still sees the live World site and can keep R-2's Construction-before-PB order.
        getSite: () => this.ctx.world?.persistentBaseSite ?? null,
        rockVisualHelper: this.rockVisualHelper,
        isHost: () => bridge.isHost(),
        getMapId: () => this.worldRuntime?.context.definition?.sourceMapId ?? null,
        getLocalOwnerId: () => getStoredLocalOwnerId(),
        resolvePlayerIdForOwner: (ownerId) => this.resolvePlayerIdForOwner(ownerId),
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
        emitRestoreAdded: (runtime) => this.emitPersistentRestoreAdded(runtime),
        emitGridChanged: (source) => emitArenaMapGridChanged(this.scene.game.events, {
          reason: 'placeables_batch_removed',
          source,
        }),
        onDiagnosticEvent: (type, fields) => this.runtimeDiagnosticEventSink?.(type, fields),
      }));
      if (coopMissionRuntime && activityDescriptor?.kind === 'coop-mission') {
        this.attachCoopMissionPowerUpBinding(
          activityDescriptor,
          coopMissionRuntime,
          this.worldLifecycle.activityStartAnchor ?? undefined,
        );
      }
      combatGameplayBinding.setPowerUpSystem(this.ctx.powerUpSystem);

      const supportGameplayRuntime = new WorldSupportGameplayRuntime({
        playerManager: this.ctx.playerManager,
        projectileManager: this.ctx.projectileManager,
        combatSystem: this.ctx.combatSystem,
        loadoutManager,
        burrowSystem,
        gameAudioSystem: this.ctx.gameAudioSystem,
        worldMetrics: world.metrics,
        rockGrid: arenaResult.rockGrid,
        stinkCloudSystem: this.ctx.stinkCloudSystem,
        reportDiagnosticEvent: (type, fields) => this.runtimeDiagnosticEventSink?.(type, fields),
        broadcastExplosion: (x, y, radius, color, style) => bridge.broadcastExplosionEffect(x, y, radius, color, style),
        applyAirstrikeEnvironmentDamage: (x, y, radius, config, triggeredBy) => (
          this.hostUpdate.applyAirstrikeEnvironmentDamage(x, y, radius, config, triggeredBy)
        ),
        onSystemsChanged: (systems: WorldSupportGameplaySystems | null) => {
          this.ctx.detonationSystem = systems?.detonation ?? null;
          this.ctx.armageddonSystem = systems?.armageddon ?? null;
          this.ctx.airstrikeSystem = systems?.airstrike ?? null;
        },
      });
      this.worldSupportGameplayRuntime = supportGameplayRuntime;
      worldRuntime.bind(supportGameplayRuntime);


      const trackCell = layout.tracks?.[0];
      if (!isCoopMission && trackCell !== undefined) {
        // Nicht-Coop-Modi behalten ihren klassischen, wiederholbaren Zugrhythmus.
        trainRuntime.setupClassicTrain(trackCell.gridX);
      } else if (!isCoopMission) {
        // Das Zug-Event ist reliable und überlebt den Rundenwechsel; ohne aktives Löschen
        // würde eine zuglose Map das HUD der Vorrunde weiterspielen.
        bridge.clearTrainEvent();
      }

    }

    if (coopMissionRuntime && activityConfiguration) {
      this.coopMissionComposition.materializeDependents(activityConfiguration, coopMissionRuntime);
      this.syncCoopMissionCompatibilityBindings(coopMissionRuntime);
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
        this.ctx.currentLayout,
        this.ctx.arenaResult,
        this.ctx.placementSystem?.getAllRuntimeRocks() ?? [],
        preserveLobbyPresentation,
      );
    }
    this.worldGeometryBinding?.attachLightOccluders(
      materialization,
      () => this.coopMissionRuntime?.coopDefenseMissionBarrierManager?.getObstacleRectangles() ?? null,
    );
    this.reconcilePersistentBaseWorld();
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
    this.ctx.smokeSystem.destroyAll();
    this.ctx.fireSystem.destroyAll();
    this.ctx.stinkCloudSystem.destroyAll();
    this.renderers.timeBubble.destroyAll();
    this.renderers.blackHole.destroyAll();
    this.renderers.reinforcementMatrix.destroyAll();
    this.renderers.energyInjector.destroyAll();
    this.renderers.plasmaBurner.clear();
    this.renderers.remoteControl.destroyAll();
    this.renderers.teslaDome.destroyAll();
    this.renderers.teslaNova.destroyAll();
    this.renderers.teslaBolt.destroyAll();
    this.renderers.healingAura.destroyAll();
    this.renderers.miniTeslaDome.destroyAll();
    this.renderers.energyShield.destroyAll();
    this.renderers.guardianSpirit.destroyAll();
    this.renderers.repairDrone.destroyAll();
    this.renderers.objectiveRepairDrones.destroyAll();
    this.renderers.slimeTrail.clear();
    this.renderers.corpseMarker.clearAll();
    this.renderers.flamethrowerUpgrades.clear();
    // Die Entities geben ihre Brand-Handles beim Zerstoeren selbst frei; das hier raeumt die
    // Partikel derer ab, die den Teardown noch als brennend erleben.
    this.renderers.entityBurnGpu.clearAll();
    this.renderers.explosionGpu.clearPending();
    this.renderers.gpuVfx.releaseAll();
    this.ctx.effectSystem.clearAllBurrowStates();
    // Laufende Kameraquellen und Trefferkopien dürfen nicht in die Lobby überlaufen.
    this.ctx.visualFeedback.reset();
    this.placementPreview.clearForTeardown();
    this.rockVisualHelper.destroyAllTurretVisuals();

    // Die lokale World-Runtime faellt: Bau-Runtime, Basen und die world-lokale Persistent-Base
    // fallen mit ihr. Ihre Darstellung geht in den Handoff und bleibt nur stehen, wenn der
    // naechste Aufbau sie uebernimmt.
    this.releaseWorldRuntime(preserveAuthoredPresentation);
    this.persistentBaseWorldBinding = null;
    this.ctx.persistentBaseContributions = null;
    this.ctx.persistentBaseRewards = null;
    this.ctx.powerUpSystem = null;
    this.ctx.reinforcementMatrixSystem = null;
    this.ctx.energyInjectorSystem = null;
    this.ctx.targetStatusSystem = null;
    this.ctx.shieldBuffSystem = null;
    this.ctx.energyShieldSystem = null;
    this.ctx.timeBubbleSystem = null;
    this.ctx.teslaDomeSystem = null;
    this.ctx.turretSystem = null;
    this.ctx.resourceSystem = null;
    this.ctx.burrowSystem = null;
    this.ctx.detonationSystem = null;
    this.ctx.loadoutManager = null;
    this.ctx.ak47StrategicTargetSystem = null;
    this.ctx.translocatorSystem = null;
    this.ctx.tunnelSystem = null;
    this.ctx.armageddonSystem = null;
    this.ctx.airstrikeSystem = null;
    this.ctx.coopDefensePlayerModifierSystem = null;
    this.ctx.coopDefenseItemRuntimeSystem = null;
    // Compatibility facade only: the ActivityRuntimeHost already destroyed the actual owner
    // above, but the legacy context must not expose its former system during World teardown.
    this.ctx.captureTheBeerSystem = null;
    this.ctx.guardianSpiritSystem = null;
    this.ctx.repairDroneSystem = null;
    this.ctx.slimeTrailSystem = null;
    this.ctx.flamethrowerUpgradeSystem = null;
    this.ctx.weaponUpgradeSystem = null;
    this.ctx.hostPhysics.setEnemyRockContactCallback(null);
    this.ctx.hostHeldActionSystem?.reset();
    this.ctx.hostHeldActionSystem = null;
    this.ctx.coopDefenseCarryItems = [];
    this.renderers.beer.syncCoopDefenseCarry([]);
    this.renderers.carryZones.clear();
    this.ctx.coopDefenseSecondaryObjectiveConfigs = [];
    if (bridge.isHost()) {
      for (const player of bridge.getConnectedPlayers()) bridge.publishActiveBuffs(player.id, []);
    }
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(null);
    bridge.publishCoopDefenseMissionProgressPresentationState(null);
    bridge.publishCoopDefenseMapEventPresentationState(null);
    this.ctx.trainManager = null;
    this.worldTargetingRuntime = null;
    this.worldPlayerGameplayRuntime = null;
    this.worldCombatGameplayBinding = null;
    this.worldSupportGameplayRuntime = null;
    this.worldPowerUpRuntime = null;
    this.worldTrainRuntime = null;
    this.worldGeometryBinding = null;
    this.constructionWorldRuntime = null;

    this.renderers.powerUp.clear();
    this.renderers.nuke.clear();
    this.renderers.airstrike.clear();
    this.renderers.encounterTelegraph.clear();
    this.renderers.meteor.clear();
    this.renderers.rockDestruction.clear();
    if (!preserveAuthoredPresentation) this.renderers.leafBlower.setTerrainColorSnapshot(null);
    this.renderers.beer.clear();
    if (preserveAuthoredPresentation) this.renderers.shadow.clearDynamicShadows();
    else this.renderers.shadow.clear();
    this.renderers.lighting.setActive(false);
    this.renderers.translocatorTeleport = null;
    // Transitional ArenaContext facade: the WorldTrainRuntime already owns destruction; only
    // clear the legacy reference here so no round-scoped object remains observable.
    this.ctx.trainManager = null;
    this.ctx.centerHUD.hideTrainWidget();
  }

  /** Verwirft einen offenen Missions-Working-State vor einem technischen World-Teardown. */
  private rollbackPersistentBaseMissionIfActive(): void {
    if (!bridge.isHost()) return;
    applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(null), {
      session: this.persistentBaseSession,
      isRuntimeObjectAlive: (runtimeId) => this.ctx.placementSystem?.hasRuntimeRock(runtimeId) === true,
    });
    this.publishPersistentBaseRewardSessionState();
  }

  /**
   * Uebernimmt die aktuell angebotenen Beitraege aller verbundenen Spieler.
   *
   * Ein Angebot ist nur ein Angebot: Der Host sanitisiert es an der Netzwerkgrenze und
   * entscheidet erst beim Merge, was davon in der Welt steht. Eine bereits uebernommene Revision
   * wird nicht erneut eingelesen, damit ein wiederholt gesendeter Zustand nichts anstoesst.
   */
  private ingestOfferedPersistentBaseContributions(): void {
    if (!bridge.isHost()) return;
    // Die Profilidentitaet des Hosts ist der erste Claim. Dadurch ist sie fuer Gastangebote
    // reserviert, ohne dass der Coordinator selbst eine zweite Binding-Map fuehrt.
    this.persistentBaseSession.bindPlayerOwner(
      bridge.getLocalPlayerId(),
      getStoredLocalOwnerId(),
    );
    let ingestedSomething = false;
    for (const playerId of bridge.getConnectedPlayerIds()) {
      const offered = playerId === bridge.getLocalPlayerId()
        ? getStoredPersonalBaseContribution()
        : bridge.getPlayerPersistentBaseContribution(playerId);
      if (!offered) continue;
      // Claim, Contribution und Annahme-Revision gehoeren gemeinsam in die RoomSession.
      ingestedSomething = this.persistentBaseSession.acceptContributionOffer(playerId, offered)
        || ingestedSomething;
    }
    // Ein waehrend der Mission eingetroffener Beitrag traegt sofort bei, statt bis zur naechsten
    // World zu warten.
    if (ingestedSomething && this.persistentBaseSession.hasOpenTransaction) {
      this.reconcilePersistentBaseWorld();
    }
  }

  /** Die dauerhafte Besitzeridentitaet hinter einer Raum-Spieler-ID; leer, wenn keine bekannt ist. */
  private resolveOwnerId(playerId: string): string {
    this.ensureLocalPersistentBaseOwnerBinding(playerId);
    return this.persistentBaseSession.getOwnerIdForPlayer(playerId) ?? '';
  }

  /** Der lokale Profil-Owner ist der erste Raum-Claim, auch wenn noch kein Angebot vorliegt. */
  private ensureLocalPersistentBaseOwnerBinding(playerId: string): void {
    if (playerId !== bridge.getLocalPlayerId()) return;
    this.persistentBaseSession.bindPlayerOwner(playerId, getStoredLocalOwnerId());
  }

  /**
   * Die Raum-Spieler-ID hinter einer Besitzeridentitaet; sie bestimmt Farbe und Berechtigungen.
   *
   * Nur der lokale Spieler leitet seine Identitaet aus dem eigenen Profil ab; jede andere kommt
   * aus einem bereits angenommenen Angebot. Beides bleibt getrennt, damit eine Spieler-ID nie
   * aus einer Besitzeridentitaet erraten wird.
   */
  private resolvePlayerIdForOwner(ownerId: string): string | null {
    this.ensureLocalPersistentBaseOwnerBinding(bridge.getLocalPlayerId());
    return this.persistentBaseSession.getPlayerIdForOwner(ownerId);
  }

  /**
   * Baut die sichtbare Basis aus allen persoenlichen Beitraegen auf.
   *
   * Der Merge selbst ist rein und deterministisch; hier wird nur materialisiert, was er
   * freigegeben hat. Ein Konflikt bleibt genau das - er entfernt nichts aus dem Besitz seines
   * Besitzers und erscheint im naechsten Raum moeglicherweise wieder.
   */
  /**
   * Rechnet das Composite nach einem Beitritt neu und materialisiert, was neu dazugekommen ist.
   *
   * Der Merge ist deterministisch und liefert fuer bereits stehende Konstruktionen dasselbe
   * Ergebnis wie zuvor; materialisiert wird deshalb nur, was noch kein Runtime-Objekt hat. So
   * bleibt eine laufende Mission unberuehrt, waehrend der neue Spieler trotzdem sofort beitraegt.
   */
  private reconcilePersistentBaseWorld(): void {
    this.persistentBaseWorldBinding?.reconcile();
  }

  private publishPersistentBaseRewardSessionState(): void {
    if (!bridge.isHost()) return;
    const world = bridge.getWorldDescriptor();
    const store = this.ctx.persistentBaseRewards;
    if (!world || !store || !this.ctx.world?.persistentBaseSite) {
      bridge.publishPersistentBaseRewardSessionState(null);
      return;
    }
    const state = store.getState();
    const availableRewardIds = getStoredPersistentBaseRewardUnlocks();
    const signature = JSON.stringify({
      worldRevision: world.worldRevision,
      availableRewardIds,
      placements: state.placements,
    });
    if (signature === this.persistentBaseRewardProjectionSignature) return;
    this.persistentBaseRewardProjectionSignature = signature;
    this.persistentBaseRewardProjectionRevision = Math.max(
      state.revision,
      this.persistentBaseRewardProjectionRevision + 1,
    );
    const session: PersistentBaseRewardSessionState = {
      worldRevision: world.worldRevision,
      revision: this.persistentBaseRewardProjectionRevision,
      availableRewardIds,
      placements: state.placements,
    };
    bridge.publishPersistentBaseRewardSessionState(session);
  }

  private persistCurrentCommittedPersistentBaseRewards(): void {
    if (!bridge.isHost()) return;
    const store = this.ctx.persistentBaseRewards;
    if (!store || store.hasActiveMission) return;
    setStoredPersistentBaseRewardState(store.getState());
  }

  private resolvePersistentBaseRewardCell(
    site: WorldPersistentBaseSite,
    placement: Pick<PersistentBaseRewardPlacement, 'relativeGridX' | 'relativeGridY'>,
  ): { gridX: number; gridY: number; domain: 'base-surface' | 'courtyard-build-area' | 'entrance' } | null {
    return resolvePersistentBaseCell(
      site.anchor,
      placement.relativeGridX,
      placement.relativeGridY,
      site.orientation,
      site.buildArea,
    );
  }

  private resolvePersistentBaseRewardRelativeCell(
    site: WorldPersistentBaseSite,
    gridX: number,
    gridY: number,
  ): { relativeGridX: number; relativeGridY: number; domain: 'base-surface' | 'courtyard-build-area' | 'entrance' } | null {
    const extent = Math.max(2, getPersistentBaseBuildAreaExtentCells(site.buildArea));
    for (let relativeGridY = -extent; relativeGridY <= extent; relativeGridY += 1) {
      for (let relativeGridX = -extent; relativeGridX <= extent; relativeGridX += 1) {
        const cell = resolvePersistentBaseCell(
          site.anchor,
          relativeGridX,
          relativeGridY,
          site.orientation,
          site.buildArea,
        );
        if (cell?.gridX === gridX && cell.gridY === gridY) {
          return { relativeGridX, relativeGridY, domain: cell.domain };
        }
      }
    }
    return null;
  }

  private isPersistentBaseRewardPlacementInDomain(
    definition: PersistentBaseRewardDefinition,
    site: WorldPersistentBaseSite,
    placement: PersistentBaseRewardPlacement,
  ): boolean {
    const cell = this.resolvePersistentBaseRewardCell(site, placement);
    if (!cell) return false;
    if (definition.placementRule === 'base-surface') return cell.domain === 'base-surface';
    return isCellInsidePersistentBaseBuildArea(
      placement.relativeGridX,
      placement.relativeGridY,
      site.buildArea,
    );
  }

  /** Stellt jedem Besitzer seinen host-bestaetigten Beitrag zu und speichert den eigenen lokal. */
  private publishConfirmedPersistentBaseContributions(
    confirmed: readonly PersistentPlayerBaseContribution[],
  ): void {
    if (!bridge.isHost()) return;
    const localOwnerId = getStoredLocalOwnerId();
    for (const contribution of confirmed) {
      if (contribution.ownerId === localOwnerId) {
        setStoredPersonalBaseContribution(contribution);
        continue;
      }
      const playerId = this.resolvePlayerIdForOwner(contribution.ownerId);
      // Ein bereits getrennter Gast bekommt nichts nachgeliefert: Sein voriger Stand bleibt auf
      // seinem Geraet gueltig, und ein nachtraeglicher Zustellmechanismus gehoert nicht hierher.
      if (playerId) bridge.hostConfirmPersistentBaseContribution(playerId, contribution);
    }
  }

  private emitPersistentRestoreAdded(runtime: SyncedPlaceableRock): void {
    emitArenaMapGridChanged(this.scene.game.events, {
      reason: 'placeable_added',
      source: runtime.kind === 'pedestal'
        ? 'placeable_pedestal'
        : runtime.kind === 'turret' ? 'placeable_turret' : 'placeable_rock',
      obstacleId: runtime.id,
      gridX: runtime.gridX,
      gridY: runtime.gridY,
      collisionMode: runtime.collisionMode,
    });
  }

  /** Bestaetigt genau die bereits host-validierte Lobby-Aenderung ihres Besitzers. */
  private publishImmediatePersistentBaseContribution(ownerId: string): void {
    const confirmed = this.persistentBaseContributions.getCommittedContribution(ownerId);
    if (confirmed) this.publishConfirmedPersistentBaseContributions([confirmed]);
  }

  /**
   * Uebersetzt die Verfuegbarkeit eines Werkzeugs in einen Konfliktgrund des Composites.
   *
   * Ein nicht verfuegbares Werkzeug ist kein Fehler des Blueprints: Sein Besitzer hat es gerade
   * nicht ausgeruestet oder freigeschaltet, und derselbe Blueprint erscheint spaeter wieder.
   */

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
    const layout = this.ctx.currentLayout;
    const arenaResult = this.ctx.arenaResult;
    const world = this.ctx.world;
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
      && this.ctx.currentLayout === layout
      && this.ctx.arenaResult === arenaResult
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

  private getEnemyNavigationFlowField(): NonNullable<CoopMissionRuntime['enemyPlayerFlowFieldService']> | null {
    return this.ctx.enemyPlayerFlowFieldService ?? this.ctx.enemyFlowFieldService;
  }

  /** Physisch freie Bodenposition; Erreichbarkeit ist fuer reine Landepunktpruefungen optional. */
  private isFreeEnemyGroundAt(x: number, y: number, radius: number): boolean {
    const flowFieldService = this.getEnemyNavigationFlowField();
    if (!flowFieldService) return true;
    return flowFieldService.isCircleGroundFreeAt(x, y, radius);
  }

  /** Sichere Auftauchposition: Koerperfreiheit und Flowfield-Erreichbarkeit zugleich. */
  private isSafeEnemyGroundAt(x: number, y: number, radius: number): boolean {
    const flowFieldService = this.getEnemyNavigationFlowField();
    if (!flowFieldService) return true;
    return flowFieldService.isCirclePositionFreeAt(x, y, radius);
  }

  private findSafeEnemyGroundPosition(
    x: number,
    y: number,
    radius: number,
    maxRadiusCells: number,
  ): { x: number; y: number } | null {
    return this.getEnemyNavigationFlowField()?.findNearestSafeWorldPosition(x, y, radius, maxRadiusCells) ?? null;
  }

  private hasWalkableEnemyCircleLine(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    radius: number,
  ): boolean {
    return this.getEnemyNavigationFlowField()?.hasWalkableCircleLine(fromX, fromY, toX, toY, radius) ?? true;
  }

  placeInspectorConstruction(
    playerId: string,
    constructionId: ConstructionId,
    targetX: number,
    targetY: number,
    activityRevision?: number,
  ): LoadoutUseResult {
    return this.constructionWorldRuntime?.placeInspectorConstruction(
      playerId,
      constructionId,
      targetX,
      targetY,
      activityRevision,
    ) ?? { ok: false, reason: 'blocked' };
  }

  useInspectorUtility(
    playerId: string,
    tool: LoadoutToolRef,
    angle: number,
    targetX: number,
    targetY: number,
    now: number,
    params?: LoadoutUseParams,
  ): LoadoutUseResult {
    return this.constructionWorldRuntime?.useInspectorUtility(
      playerId,
      tool,
      angle,
      targetX,
      targetY,
      now,
      params,
    ) ?? { ok: false, reason: 'blocked' };
  }

  /**
   * Item-Affixe, die an einem eigenen Gegner-Kill haengen: Kampfaufladung und Brandzerfall.
   *
   * Laeuft aus dem Kill-Callback, weil dort sowohl der Killer feststeht als auch
   * `getLastDamageOrigin` noch gefuellt ist – aufgeraeumt wird erst danach.
   */
  private hostHandleCoopDefenseItemKill(killerId: string, victimId: string, x: number, y: number): void {
    const runtime = this.ctx.coopDefenseItemRuntimeSystem;
    // Nur der tatsaechliche Killer, nicht das ganze Team: Kills durch Verbuendete zaehlen nicht.
    if (!runtime || bridge.getPlayerProfile(killerId) === undefined) return;

    runtime.registerOwnKill(killerId);

    // Brandzerfall verlangt einen Kill durch *direkten* Primaerwaffenschaden; Explosionen,
    // Brand, Kettenblitze und Bodenflaechen loesen ihn nicht aus.
    const origin = this.ctx.combatSystem.getLastDamageOrigin(victimId);
    if (origin?.kind !== 'direct' || origin.slot !== 'weapon1') return;
    if (!runtime.rollFireChunksOnKill(killerId)) return;

    this.ctx.flamethrowerUpgradeSystem?.hostCreateFireChunkBurst(killerId, x, y, {
      count: COOP_DEFENSE_AFFIX_RULES.fireChunkCount,
      searchRadius: COOP_DEFENSE_AFFIX_RULES.fireChunkRadius,
      flightMs: 320,
      igniteCenter: false,
      durationMs: COOP_DEFENSE_AFFIX_RULES.fireChunkGroundDurationMs,
      burnDurationMs: COOP_DEFENSE_AFFIX_RULES.fireChunkBurnDurationMs,
      burnDamagePerTick: COOP_DEFENSE_AFFIX_RULES.fireChunkBurnDamagePerTick,
      sourceId: 'ground_fire.fire_decay',
    }, `item-fire-chunks:${killerId}`);
  }

  /** Thin RPC adapter; construction rules live in the World owner. */
  dismantleConstruction(
    playerId: string,
    targetX: number,
    targetY: number,
    activityRevision?: number,
  ): LoadoutUseResult {
    return this.constructionWorldRuntime?.dismantleConstruction(
      playerId,
      targetX,
      targetY,
      activityRevision,
    ) ?? { ok: false, reason: 'blocked' };
  }

  /** Host-autorisierter Batch-Rueckbau ohne Reichweitenpruefung und ohne N-fache Finalisierung. */
  dismantleAllOwnedConstructions(
    playerId: string,
    activityRevision?: number,
  ): LoadoutUseResult {
    return this.constructionWorldRuntime?.dismantleAllOwnedConstructions(
      playerId,
      activityRevision,
    ) ?? { ok: false, reason: 'blocked' };
  }

  private spawnImpactCloudFromProjectile(proj: import('../../types').TrackedProjectile, x: number, y: number): void {
    if (!proj.impactCloud) return;
    const ownerColor = proj.ownerColor ?? bridge.getPlayerColor(proj.ownerId) ?? proj.color;
    this.ctx.stinkCloudSystem.hostCreateStationaryCloud(
      proj.ownerId, ownerColor, x, y,
      proj.impactCloud.radius,
      proj.impactCloud.duration,
      proj.impactCloud.damagePerTick,
      proj.impactCloud.tickInterval,
      proj.impactCloud.rockDamageMult ?? 1,
      proj.impactCloud.trainDamageMult ?? 1,
      proj.impactCloud.baseDamageMult ?? 1,
      proj.impactCloud.visualVariant,
    );
  }

  /** Gemeinsamer externer Hindernisschaden fuer Projektile und Gegner-Spezialeffekte. */
  private resolveObstacleDamage(index: number, damage: number, attackerId: string): number {
    const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(index);
    return this.ctx.combatSystem.resolveExternalTargetDamage(
      {
        targetType: runtimeRock?.constructionId ? 'construction' : 'rock',
        targetId: String(index),
      },
      damage,
      attackerId,
    );
  }

  /** Liefert die reale Kollisions-/Darstellungsflaeche fuer Schutz- und Statusabfragen. */
  private getTargetFootprint(target: TargetStatusTarget): TargetFootprint | null {
    if (target.targetType === 'player') {
      const player = this.ctx.playerManager.getPlayer(target.targetId);
      if (!player?.active) return null;
      const bounds = player.getBounds();
      return { x: bounds.centerX, y: bounds.centerY, width: bounds.width, height: bounds.height };
    }
    if (target.targetType === 'enemy') {
      const enemy = this.ctx.enemyManager?.getEnemy(target.targetId);
      if (!enemy?.sprite.active) return null;
      const bounds = enemy.sprite.getBounds();
      return { x: bounds.centerX, y: bounds.centerY, width: bounds.width, height: bounds.height };
    }
    if (target.targetType === 'base') {
      const base = this.ctx.baseManager?.getBase(target.targetId);
      if (!base || (base.isInert?.() ?? false)) return null;
      const parts = base.getCellBodies().map((body) => {
        const bounds = body.getBounds();
        return {
          x: bounds.centerX,
          y: bounds.centerY,
          width: bounds.width,
          height: bounds.height,
        } satisfies TargetFootprint;
      });
      const bounds = parts.reduce<{ left: number; top: number; right: number; bottom: number } | null>((acc, next) => {
        if (!acc) {
          return {
            left: next.x - next.width / 2,
            top: next.y - next.height / 2,
            right: next.x + next.width / 2,
            bottom: next.y + next.height / 2,
          };
        }
        return {
          left: Math.min(acc.left, next.x - next.width / 2),
          top: Math.min(acc.top, next.y - next.height / 2),
          right: Math.max(acc.right, next.x + next.width / 2),
          bottom: Math.max(acc.bottom, next.y + next.height / 2),
        };
      }, null);
      if (!bounds || parts.length === 0) return null;
      return {
        x: (bounds.left + bounds.right) * 0.5,
        y: (bounds.top + bounds.bottom) * 0.5,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
        parts,
      };
    }

    const rockId = Number(target.targetId);
    if (!Number.isFinite(rockId)) return null;
    const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(rockId);
    if (runtimeRock) {
      const world = this.rockVisualHelper.gridToWorld(runtimeRock.gridX, runtimeRock.gridY);
      return { x: world.x, y: world.y, width: CELL_SIZE, height: CELL_SIZE };
    }
    const rock = this.ctx.arenaResult?.rockPhysicsProxies[rockId];
    if (!rock?.active) return null;
    const bounds = rock.getBounds();
    return { x: bounds.centerX, y: bounds.centerY, width: bounds.width, height: bounds.height };
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
    if (!bridge.isHost() || !this.ctx.coopDefensePlayerModifierSystem) return;

    const currentBuilds = bridge.getConnectedPlayers().map((profile) => [
      profile.id,
      bridge.getPlayerCurrentLoadoutSnapshot(profile.id),
    ] as const);
    const changedPlayerIds = this.ctx.coopDefensePlayerModifierSystem.syncPlayers(currentBuilds);
    for (const playerId of changedPlayerIds) {
      const current = bridge.getPlayerCurrentLoadoutSnapshot(playerId);
      if (current?.coopDefenseProfile || (current?.equippedItems?.length ?? 0) > 0) {
        if (this.ctx.playerManager.hasPlayer(playerId)) {
          this.ctx.coopDefenseItemRuntimeSystem?.initPlayer(playerId);
        }
      } else {
        this.ctx.coopDefenseItemRuntimeSystem?.removePlayer(playerId);
      }
    }
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
