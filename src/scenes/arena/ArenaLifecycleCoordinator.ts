import type Phaser from 'phaser';
import { bridge }            from '../../network/bridge';
import { ArenaBuilder }      from '../../arena/ArenaBuilder';
import { ArenaGenerator, ARENA_GENERATOR_VERSION, resolveArenaGenerationInput } from '../../arena/ArenaGenerator';
import { TerrainColorSnapshotBuilder } from '../../arena/TerrainColorSnapshotBuilder';
import { getVisibleWorldView } from '../../ui/HostileBaseIndicator';
import type { WorldViewRect } from '../../ui/HostileBaseIndicator';
import { RockRegistry }      from '../../arena/RockRegistry';
import { PlacementSystem }   from '../../systems/PlacementSystem';
import { ReinforcementMatrixSystem, type TargetFootprint } from '../../systems/ReinforcementMatrixSystem';
import { EnergyInjectorSystem } from '../../systems/EnergyInjectorSystem';
import { TargetStatusSystem } from '../../systems/TargetStatusSystem';
import { ResourceSystem }    from '../../systems/ResourceSystem';
import { TeslaDomeSystem }   from '../../systems/TeslaDomeSystem';
import { EnergyShieldSystem } from '../../systems/EnergyShieldSystem';
import { ShieldBuffSystem }   from '../../systems/ShieldBuffSystem';
import { TurretSystem, type AutomatedTurretId } from '../../systems/TurretSystem';
import { BurrowSystem }      from '../../systems/BurrowSystem';
import { CaptureTheBeerSystem } from '../../systems/CaptureTheBeerSystem';
import { TunnelSystem } from '../../systems/TunnelSystem';
import { EnemyFlowFieldService } from '../../systems/EnemyFlowFieldService';
import {
  ENEMY_FLOW_FIELD_IDS,
  FlowFieldCoordinator,
  allyFlowFieldId,
} from '../../systems/flowfield/FlowFieldCoordinator';
import { createFlowFieldRunner } from '../../systems/flowfield/FlowFieldRunnerFactory';
import {
  buildBaseDescriptors,
  buildStaticKindRaster,
  createFlowFieldTuning,
  resolveGridChange,
} from '../../systems/flowfield/FlowFieldSources';
import { CoopDefenseEnemyAttackSystem } from '../../systems/CoopDefenseEnemyAttackSystem';
import { CoopDefenseEnemyAbilitySystem } from '../../systems/CoopDefenseEnemyAbilitySystem';
import { CoopDefenseEnemyTrainAwarenessSystem } from '../../systems/CoopDefenseEnemyTrainAwarenessSystem';
import { CoopDefenseEnemyBurrowSystem } from '../../systems/CoopDefenseEnemyBurrowSystem';
import { CoopDefenseEnemyDodgeSystem } from '../../systems/CoopDefenseEnemyDodgeSystem';
import { CoopDefenseEnemyCombatPositioningSystem } from '../../systems/CoopDefenseEnemyCombatPositioningSystem';
import { CoopDefenseVoidHunterSystem } from '../../systems/CoopDefenseVoidHunterSystem';
import { CoopDefenseTimebombSystem } from '../../systems/CoopDefenseTimebombSystem';
import { EnemyStrategicTargetService, type PreparedStrategicTargets } from '../../systems/EnemyStrategicTargetService';
import { EnemyAiTargetCatalog } from '../../systems/EnemyAiTargetCatalog';
import { CoopDefensePlayerModifierSystem } from '../../systems/CoopDefensePlayerModifierSystem';
import { CoopDefenseItemRuntimeSystem } from '../../systems/CoopDefenseItemRuntimeSystem';
import { COOP_DEFENSE_AFFIX_RULES } from '../../config/coopDefenseItems';
import { getLocale, t } from '../../i18n';
import { getMapName } from '../../i18n/contentPresentation';
import { GuardianSpiritSystem } from '../../systems/GuardianSpiritSystem';
import { RepairDroneSystem } from '../../systems/RepairDroneSystem';
import { SlimeTrailSystem } from '../../systems/SlimeTrailSystem';
import { FlamethrowerUpgradeSystem } from '../../systems/FlamethrowerUpgradeSystem';
import { WeaponUpgradeSystem } from '../../systems/WeaponUpgradeSystem';
import { Ak47StrategicTargetSystem } from '../../systems/Ak47StrategicTargetSystem';
import { NecromancySystem } from '../../systems/NecromancySystem';
import { CoopDefenseRoundStateSystem } from '../../systems/CoopDefenseRoundStateSystem';
import { CoopDefenseRespawnBudgetSystem } from '../../systems/CoopDefenseRespawnBudgetSystem';
import { CoopDefenseSpawnExecutor } from '../../systems/CoopDefenseSpawnExecutor';
import { CoopDefensePersistentPressureSystem } from '../../systems/CoopDefensePersistentPressureSystem';
import { CoopDefenseBossSystem } from '../../systems/CoopDefenseBossSystem';
import {
  ArenaTimeOfDayController,
  type ArenaTimeOfDaySignals,
} from '../../systems/ArenaTimeOfDayController';
import { CoopDefenseMapDirector } from '../../systems/CoopDefenseMapDirector';
import { CoopDefenseMapEventDirector, type CoopDefenseMapEventHandler } from '../../systems/CoopDefenseMapEventDirector';
import { CoopDefenseGroundHazardEventHandler } from '../../systems/CoopDefenseGroundHazardEventHandler';
import { CoopDefenseObjectiveRepairSystem } from '../../systems/CoopDefenseObjectiveRepairSystem';
import { CoopDefenseObjectivePlacementRewardSystem } from '../../systems/CoopDefenseObjectivePlacementRewardSystem';
import { CoopDefenseSecondaryObjectiveSystem } from '../../systems/CoopDefenseSecondaryObjectiveSystem';
import { CoopDefenseMissionProgressSystem } from '../../systems/CoopDefenseMissionProgressSystem';
import { CoopDefenseMissionBarrierManager } from '../../systems/CoopDefenseMissionBarrierManager';
import { HostHeldActionSystem } from '../../systems/HostHeldActionSystem';
import { CoopDefenseCarrySystem } from '../../systems/CoopDefenseCarrySystem';
import { CoopDefenseTeamBuffSystem } from '../../systems/CoopDefenseTeamBuffSystem';
import {
  CoopDefenseAirstrikeEventHandler,
  isPointNearBaseRegion,
} from '../../systems/CoopDefenseAirstrikeEventHandler';
import { LoadoutManager }    from '../../loadout/LoadoutManager';
import { applyCoopDefenseModifiersToUtilityConfig } from '../../loadout/CoopDefenseLoadoutModifiers';
import { resolveEffectiveLoadoutSelection } from '../../loadout/LoadoutRules';
import { TimeBubbleSystem }  from '../../systems/TimeBubbleSystem';
import { TranslocatorSystem } from '../../systems/TranslocatorSystem';
import { PowerUpSystem }     from '../../powerups/PowerUpSystem';
import { DetonationSystem }  from '../../systems/DetonationSystem';
import { ArmageddonSystem }  from '../../systems/ArmageddonSystem';
import { AirstrikeSystem }   from '../../systems/AirstrikeSystem';
import { TrainManager }      from '../../train/TrainManager';
import { CoopDefenseTrainEventHandler } from '../../train/CoopDefenseTrainEventHandler';
import { TrainRenderer }     from '../../train/TrainRenderer';
import { TranslocatorTeleportRenderer } from '../../effects/TranslocatorTeleportRenderer';
import { GROUND_FIRE_CELL_SIZE } from '../../effects/FireSystem';
import { FireObstacleIndex } from '../../effects/FireObstacleIndex';
import { LightOccluderIndex }  from '../../effects/LightOccluderIndex';
import { DEFAULT_TIME_OF_DAY_MINUTES, parseTimeOfDay, resolveSkyState } from '../../effects/TimeOfDay';
import { setEmissiveScale } from '../../effects/EmissiveScale';
import { getUtilityConfigForMode, UTILITY_CONFIGS, WEAPON_CONFIGS, ULTIMATE_CONFIGS, DEFAULT_LOADOUT } from '../../loadout/LoadoutConfig';
import type { PlaceableUtilityConfig, PlaceableTurretUtilityConfig, TeslaDomeWeaponFireConfig, UtilityConfig, WeaponConfig } from '../../loadout/LoadoutConfig';
import type { LoadoutSelection } from '../../loadout/LoadoutManager';
import { getBaseRewardPickupWorldPosition, getBaseWorldBounds, resolveCoopDefenseActivityBases } from '../../arena/BaseRegistry';
import { getCoopDefenseMapConfig, getCoopDefenseMapXpReference, isWeaponBalanceLabMapId, objectiveUsesRespawnBudget, resolveCoopDefenseMapEncounterConfigs, resolveCoopDefenseMapMissionProgress, resolveCoopDefenseMapPersistentSpawnConfigs, resolveCoopDefenseMapSecondaryObjectives, type CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import { buildInitialLocalArenaHudData } from '../../ui/LocalArenaHudData';
import { ARENA_DURATION_SEC, HP_MAX, PLAYER_COLORS, COLORS, CELL_SIZE, TEAM_BLUE_COLOR, TEAM_RED_COLOR, COOP_DEFENSE_BASE_TURRET_OWNER_ID, COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID, COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID, applyArenaMetricsForMode, getArenaMetricsProfile, getAuthoredWorldMetricsProfile, type ArenaMetricsProfile, COOP_DEFENSE_NAV_TICK_INTERVAL_MS, COOP_DEFENSE_NAV_TICK_DIVISOR_STRATEGIC } from '../../config';
import { DASH_GROUND_FIRE_BURN_DURATION_MS, DASH_GROUND_FIRE_DAMAGE_PER_TICK, DASH_T2_S, PLAYER_SPEED, SHOCKWAVE_DAMAGE, SHOCKWAVE_RADIUS } from '../../config';
import { TRAIN }             from '../../train/TrainConfig';
import { getClassicTrainEventPlan, getNextClassicTrainArrivalAt, type TrainEventPlan } from '../../train/TrainEvent';
import { TRAIN_DROP_COUNT }  from '../../powerups/PowerUpConfig';
import type { ArenaContext }          from './ArenaContext';
import type { RendererBundle }        from './RendererBundle';
import type { RockVisualHelper }      from './RockVisualHelper';
import type { PlacementPreviewRenderer } from './PlacementPreviewRenderer';
import type { HostUpdateCoordinator } from './HostUpdateCoordinator';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { LobbyOverlay }          from '../LobbyOverlay';
import type { ArenaLayout, GameMode, LoadoutCommitSnapshot, LoadoutUseParams, PlayerProfile, RoomQualitySnapshot } from '../../types';
import type { RoundConclusion, RoundResult, RoundState } from '../../network/NetworkBridge';
import { resolvePvpWinnerIds } from '../../network/RoomStatistics';
import type { RoomQualityMonitor }    from '../../network/RoomQualityMonitor';
import { CAPTURE_THE_BEER_MODE, COOP_DEFENSE_MODE, isCoopDefenseMode, isTeamGameMode } from '../../gameModes';
import { BaseManager } from '../../entities/BaseManager';
import {
  BASE_DESTRUCTION_GROUND_BURN_DAMAGE_PER_TICK,
  BASE_DESTRUCTION_GROUND_BURN_DURATION_MS,
  BASE_DESTRUCTION_GROUND_FIRE_DURATION_MS,
  getBaseDestructionBlast,
} from '../../effects/BaseDestructionPlan';
import { EnemyManager } from '../../entities/EnemyManager';
import { getCoopDefenseEnemyConfig, resolveCoopDefenseEnemyConfigs } from '../../config/coopDefenseEnemies';
import { ARENA_MAP_GRID_CHANGED_EVENT, emitArenaMapGridChanged, type ArenaMapGridChangedEvent } from './ArenaEvents';
import {
  COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT,
  COOP_DEFENSE_CONSTRUCTION_IDS,
  COOP_DEFENSE_DISMANTLE_RANGE,
  COOP_DEFENSE_REPAIR_DRONE_UPGRADE_ID,
  getCoopDefenseConstructionDefinition,
  getConstructionIdForUtility,
  getUtilityIdForConstruction,
  getToolCapacityCost,
  normalizeConstructionId,
  resolveConstructionCapacity,
} from '../../config/coopDefenseConstructions';
import type { ConstructionId, ConstructionOwnership, LoadoutToolRef, LoadoutUseResult, SyncedPlaceableRock } from '../../types';
import { getConstructionAccessContext, getActiveConstructionToolRefs, resolveConstructionAccess } from '../../systems/ConstructionAccessResolver';
import type { TargetStatusTarget } from '../../systems/TargetStatusSystem';
import { resolveWorldLoadProgress } from '../../world/WorldLoadReady';
import { getActiveRoundParticipantIds } from './RoundParticipationPolicy';
import { resolveArenaStartTime } from './ArenaStartTiming';
import {
  getStoredLocalOwnerId,
  getStoredPersistentBaseRadiusCells,
  getStoredPersistentBaseUnlocked,
  getStoredPersonalBaseContribution,
  setStoredPersonalBaseContribution,
} from '../../utils/localPreferences';
import { PersistentBaseContributionStore } from '../../persistentBase/PersistentBaseContributionStore';
import {
  mergePersistentBaseComposite,
  type PersistentCompositeActiveEntry,
  type PersistentCompositeConflictReason,
  type PersistentCompositeTool,
} from '../../persistentBase/PersistentBaseComposite';
import {
  applyPersistentBaseRoundOutcome,
  resolvePersistentBaseRoundOutcome,
} from '../../persistentBase/PersistentBaseRoundOutcome';
import type {
  PersistentRestoreCandidate,
  PersistentRestoreToolDefinition,
} from '../../persistentBase/PersistentBaseTools';
import { nextMonotonicRevision } from '../../world/WorldRevision';
import {
  resolveActiveGameMode,
  toActivityDefinitionId,
  toActivityKind,
  toMapId,
  toWorldDefinitionId,
} from '../../world/arenaDescriptorAdapter';
import { toWorldGenerationConfig } from '../../config/authoring/coopDefenseAuthoringAdapter';
import { getWorldDefinition } from '../../config/authoring/authoredScenarios';
import { isLobbyWorldDefinitionId, LOBBY_WORLD_DEFINITION_ID } from '../../config/authoring/lobbyWorld';
import type { WorldDefinition } from '../../config/authoring/WorldDefinition';
import { createAuthoredWorldDescriptor, generateWorldLayout } from '../../world/WorldLayout';
import { isArenaTransitionReady } from './ArenaTransitionReadiness';
import {
  createWorldRuntimeContext,
  isValidPersistentBaseSite,
  type WorldPersistentBaseSite,
} from '../../world/WorldRuntimeContext';
import { WorldLifecycle } from '../../world/WorldLifecycle';
import {
  PlayerWorldRuntime,
  resolvePlayerRuntimeFeatures,
  type PlayerRuntimeFeatures,
} from '../../world/PlayerWorldRuntime';
import {
  hasWorldFigure,
  hasWorldRuntimeEntry,
  maySendWorldInput,
  requiresLocalWorldPresentation,
  resolveWorldParticipation,
  type WorldParticipation,
} from '../../world/WorldParticipation';
import { resolvePlayerCapabilities, type PlayerCapabilities } from '../../world/PlayerCapabilities';
import { resolveWorldPresentation, type WorldPresentationRequirement } from '../../world/WorldPresentation';
import { resolveWorldMetrics } from '../../world/WorldMetrics';
import { isSameWorldInstance, type WorldDescriptor, type WorldParameters } from '../../world/WorldDescriptor';
import type { ActivityDescriptor } from '../../world/ActivityDescriptor';
import type {
  PersistentBaseAnchor,
  PersistentPlayerBaseContribution,
  PersistentToolRef,
} from '../../persistentBase/PersistentBaseTypes';
import type { PersistentBaseBuildArea } from '../../persistentBase/PersistentBaseCore';

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
  private trainExplosionTimers: Phaser.Time.TimerEvent[] = [];

  /**
   * Zaehlt ueber Runden hinweg hoch. Ein verspaetetes Worker-Ergebnis aus einer alten Arena traegt
   * die alte Generation und kann deshalb nie mehr aktiviert werden.
   */
  private flowFieldGenerationId = 0;
  private flowFieldGridListener: ((event: ArenaMapGridChangedEvent) => void) | null = null;
  private fireObstacleGridListener: ((event: ArenaMapGridChangedEvent) => void) | null = null;
  private fireObstacleIndex: FireObstacleIndex | null = null;

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
   * Nur Vergleichsmarker fuer den effektiven Lobby-Base-Stand (Coop plus gespeichertes
   * Entitlement), mit dem die aktuelle LobbyWorld eroeffnet wurde.
   *
   * Der erste Sieg auf der Freischaltmap faellt zwischen zwei Lobby-Instanzen; ohne diesen
   * Marker haette die Reihenfolge von Sieg-Verbuchung und Lobby-Aufbau entschieden, ob die Basis
   * erscheint. Aendert sich der Wert, wird die LobbyWorld neu instanziiert - ihre Neuerzeugung
   * ist ohnehin ihr Reset.
   */
  private lobbyWorldPersistentBaseUnlockedAtRevision: boolean | null = null;
  /** Lokaler Uebergang: alte LobbyWorld ist beendet, neue Descriptor-Runtime wird gebunden. */
  private pendingLobbyWorldReinstance = false;
  private localArenaLoadReady = false;
  private terrainSnapshotReady = false;
  private terrainSnapshotGenerationId = 0;
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
  private pendingClassicTrainEvent: {
    readonly trackX: number;
    readonly direction: 1 | -1;
    readonly plan: TrainEventPlan;
  } | null = null;
  /**
   * Besitzer der laufenden World-Instanz. Erzeugung, lokale Runtime und Ende laufen
   * ausschliesslich hierueber; `ArenaContext.world` wird nur von diesem Sink geschrieben.
   */
  private readonly worldLifecycle = new WorldLifecycle({
    publish: (world, activity) => bridge.publishWorldAndActivity(world, activity),
    publishActivity: (activity) => bridge.publishActivity(activity),
    clear: () => bridge.clearWorldAndActivity(),
    attach: (context) => { this.ctx.world = context; },
    detach: () => { this.ctx.world = null; },
  });
  /**
   * Gemeinsamer Player-Lifecycle dieser World. Es gibt genau einen Weg hinein und einen hinaus;
   * welche Module laufen, entscheidet {@link resolvePlayerRuntimeFeatures} aus Rolle und Activity.
   */
  private readonly playerRuntime = new PlayerWorldRuntime({
    attach: [
      {
        id: 'player-entity',
        feature: 'entity',
        // Spawns entscheidet der Host. Ein Client setzt die Figur ausschliesslich auf die
        // replizierte Position; kennt er sie beim Eintritt noch nicht, entsteht sie still - ein
        // Materialisierungseffekt an einer selbst gewuerfelten Stelle waere schlicht falsch.
        run: ({ profile, spawn }) => {
          const authoritativeSpawn = bridge.isHost() ? undefined : spawn;
          this.ctx.playerManager.addPlayer(
            profile,
            bridge.isHost() || authoritativeSpawn
              ? { spawn: authoritativeSpawn }
              : { spawnEffect: false },
          );
        },
        rollback: ({ profile }) => { this.ctx.playerManager.removePlayer(profile.id); },
      },
      {
        id: 'combat-state',
        feature: 'combat',
        run: ({ profile, reconnectAfterDeath }) => {
          if (reconnectAfterDeath) return this.ctx.combatSystem.spawnPlayerAfterReconnect(profile.id);
          this.ctx.combatSystem.initPlayer(profile.id);
          return true;
        },
      },
      {
        id: 'respawn-budget',
        feature: 'missionStatus',
        run: ({ profile, reconnectAfterDeath }) => {
          if (!reconnectAfterDeath) this.ctx.coopDefenseRespawnBudgetSystem?.registerInitialSpawn(profile.id);
        },
      },
      {
        // Nachzuegler (Reconnect, verspaetetes Loadout) bekommen ihr Ally-Flowfield hier; beim
        // Arenaaufbau existierten sie noch nicht.
        id: 'ally-flow-field',
        feature: 'navigation',
        run: ({ profile }) => { this.ensureAllyFlowField(profile.id); },
      },
      {
        id: 'combat-resources',
        feature: 'combatResources',
        run: ({ profile }) => { this.ctx.resourceSystem?.initPlayer(profile.id); },
      },
      {
        // Coop-Build und Item-Affixe sind World-Gameplay; sie brauchen keine laufende Mission.
        id: 'player-build',
        feature: 'playerBuild',
        run: ({ profile }) => { this.ctx.coopDefenseItemRuntimeSystem?.initPlayer(profile.id); },
      },
      {
        id: 'burrow-state',
        feature: 'combatResources',
        run: ({ profile }) => { this.ctx.burrowSystem?.initPlayer(profile.id); },
      },
      {
        id: 'loadout',
        feature: 'loadoutTools',
        run: ({ profile }) => {
          this.ctx.loadoutManager?.resetUltimateState(profile.id);
          this.ctx.loadoutManager?.assignDefaultLoadout(profile.id, this.resolveCommittedLoadoutSelection(profile.id));
        },
      },
    ],
    detach: [
      {
        // Zielstatus und Injector-Fokus gehoeren zur laufenden Runde, nicht zur Lobby-Persona.
        id: 'world-targeting',
        feature: 'worldTargeting',
        run: (playerId) => {
          this.ctx.targetStatusSystem?.removeTarget({ targetType: 'player', targetId: playerId });
          this.ctx.energyInjectorSystem?.removeOwner(playerId);
        },
      },
      {
        id: 'mission-objectives',
        feature: 'missionStatus',
        run: (playerId) => {
          this.ctx.coopDefenseObjectivePlacementRewardSystem?.handlePlayerUnavailable(playerId);
          this.ctx.coopDefenseCarrySystem?.handlePlayerUnavailable(playerId);
        },
      },
      { id: 'combat-state', feature: 'combat', run: (playerId) => { this.ctx.combatSystem.removePlayer(playerId); } },
      {
        id: 'combat-resources',
        feature: 'combatResources',
        run: (playerId) => { this.ctx.resourceSystem?.removePlayer(playerId); },
      },
      {
        id: 'player-build',
        feature: 'playerBuild',
        run: (playerId) => { this.ctx.coopDefenseItemRuntimeSystem?.removePlayer(playerId); },
      },
      { id: 'burrow-state', feature: 'combatResources', run: (playerId) => { this.ctx.burrowSystem?.removePlayer(playerId); } },
      {
        id: 'loadout',
        feature: 'loadoutTools',
        run: (playerId) => {
          this.ctx.loadoutManager?.removePlayer(playerId);
          this.ctx.powerUpSystem?.removePlayer(playerId);
          this.ctx.tunnelSystem?.removePlayer(playerId);
        },
      },
      {
        id: 'player-entity',
        feature: 'entity',
        run: (playerId) => {
          this.ctx.effectSystem.clearBurrowState(playerId);
          this.clientUpdate.removePlayerState(playerId);
          this.ctx.hostPhysics.removePlayer(playerId);
          this.ctx.playerManager.removePlayer(playerId);
        },
      },
    ],
  });
  /** Host-only room lifetime; never stored in local preferences and never cleared by map teardown. */
  /**
   * Host-seitiger Arbeitsstand aller persoenlichen Beitraege dieses Raums.
   *
   * Genau ein Besitzpfad fuer Host und Gaeste. Er lebt laenger als eine Runde, weil ein Spieler
   * ueber einen Kartenwechsel hinweg Besitzer seiner Konstruktionen bleibt, und stirbt mit dem
   * Raum - nie mit einer Runde.
   */
  private readonly persistentBaseContributions = new PersistentBaseContributionStore();
  /** Zuletzt angebotene Beitragsrevision je Spieler; verhindert wiederholtes Uebernehmen. */
  private readonly ingestedContributionRevisions = new Map<string, number>();
  /**
   * Raum-Spieler-ID zu dauerhafter Besitzeridentitaet.
   *
   * Beides bleibt getrennt: Die Spieler-ID gilt fuer diesen Raum und bestimmt Farbe, Loadout und
   * Freischaltungen; die Besitzeridentitaet gilt fuer das Bauwerk und ueberlebt jeden Raum.
   */
  private readonly persistentBaseOwnerByPlayerId = new Map<string, string>();
  /** Letzter fuer das Composite relevanter Live-Build je Besitzer. */
  private readonly persistentBaseCompositeBuildSignatures = new Map<string, string>();
  private persistentBaseAnchor: PersistentBaseAnchor | null = null;
  private persistentBaseBuildArea: PersistentBaseBuildArea | null = null;
  private static readonly LAYOUT_RETRY_LIMIT = 312; // ~5s at 16ms per retry

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
    private readonly renderers: RendererBundle,
    private readonly rockVisualHelper: RockVisualHelper,
    private readonly placementPreview: PlacementPreviewRenderer,
    private readonly lobbyOverlay: LobbyOverlay,
    private readonly hostUpdate: HostUpdateCoordinator,
    private readonly clientUpdate: ClientUpdateCoordinator,
    private readonly roomQualityMonitor: RoomQualityMonitor,
  ) {}

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
   * Aufbau und Abbau einer World ohne Activity folgen dem World-Kanal, nicht der Raumphase.
   *
   * Eine World **mit** Activity haengt weiterhin am Rundenwechsel: ihre Besetzung und ihr
   * Startzeitpunkt kommen aus der Runde. Eine World **ohne** Activity hat keinen Phasenwechsel,
   * auf den sie warten koennte - sie entsteht und vergeht mit ihrem Descriptor.
   */
  detectWorldChange(): void {
    if (this.matchTerminated) return;
    const world = bridge.getWorldDescriptor();
    if (!world) {
      if (this.arenaBuilt
        && !this.worldLifecycle.activity.isActive()
        && bridge.getGamePhase() === 'LOBBY') {
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
      const previousDefinitionId = localWorld?.definitionId ?? this.ctx.world?.descriptor.definitionId;
      const canFastReinstance = bridge.getGamePhase() !== 'ARENA'
        && isLobbyWorldDefinitionId(world.definitionId)
        && (this.pendingLobbyWorldReinstance
          || (isLobbyWorldDefinitionId(previousDefinitionId ?? '')
            && bridge.getActivityDescriptor() === null
            && this.ctx.arenaResult !== null
            && this.ctx.currentLayout !== null));
      if (canFastReinstance) {
        // Clients still hold the old local lifecycle when the reliable replacement arrives.
        // The host already ended it while publishing the new descriptor; both paths converge
        // here before the new runtime is attached.
        if (!this.pendingLobbyWorldReinstance) this.prepareLobbyWorldReinstance();
        this.onTransitionToArena();
        return;
      }
      const lobbyToMatch = isLobbyWorldDefinitionId(previousDefinitionId ?? '')
        && !isLobbyWorldDefinitionId(world.definitionId);
      const matchToLobby = !isLobbyWorldDefinitionId(previousDefinitionId ?? '')
        && isLobbyWorldDefinitionId(world.definitionId);
      if (lobbyToMatch || (bridge.getGamePhase() === 'ARENA' && !matchToLobby)) {
        this.onTransitionToArena();
        return;
      }
      this.onTransitionToLobby();
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
    const currentWorld = this.worldLifecycle.descriptor;
    if (currentWorld !== null) {
      if (isLobbyWorldDefinitionId(currentWorld.definitionId)
        && bridge.getActivityDescriptor() === null) {
        if (this.lobbyWorldModeAtRevision === null) {
          this.lobbyWorldModeAtRevision = currentMode;
          this.lobbyWorldPersistentBaseUnlockedAtRevision = persistentBaseUnlocked;
        } else if (this.lobbyWorldModeAtRevision !== currentMode
          || this.lobbyWorldPersistentBaseUnlockedAtRevision !== persistentBaseUnlocked) {
          const previousRevision = currentWorld.worldRevision;
          this.prepareLobbyWorldReinstance();
          const worldRevision = nextMonotonicRevision(
            Math.max(this.lastRoundRevision, previousRevision),
            Date.now(),
          );
          this.lastRoundRevision = worldRevision;
          this.lobbyWorldModeAtRevision = currentMode;
          this.lobbyWorldPersistentBaseUnlockedAtRevision = persistentBaseUnlocked;
          this.worldLifecycle.beginCreate(
            createAuthoredWorldDescriptor(
              LOBBY_WORLD_DEFINITION_ID,
              worldRevision,
              resolveLobbyWorldParameters(persistentBaseUnlocked),
            ),
            null,
          );
        }
      } else {
        this.lobbyWorldModeAtRevision = null;
        this.lobbyWorldPersistentBaseUnlockedAtRevision = null;
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
    this.worldLifecycle.beginCreate(
      createAuthoredWorldDescriptor(
        LOBBY_WORLD_DEFINITION_ID,
        worldRevision,
        resolveLobbyWorldParameters(persistentBaseUnlocked),
      ),
      null,
    );
  }

  /**
   * Schliesst die alte LobbyWorld sofort und oeffnet ein kleines lokales Rebind-Fenster.
   * `buildWorld()` uebernimmt anschliessend den neuen World-Runtime-Aufbau; bis dahin bleiben
   * weder Spieler-Runtimes noch World-Aktionen an die alte Revision gebunden.
   */
  private prepareLobbyWorldReinstance(): void {
    this.pendingLobbyWorldReinstance = true;
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
    this.clientUpdate.clientUtilityOverride = null;
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
    this.pendingLobbyWorldReinstance = false;
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
          persistentBaseRadiusCells: getStoredPersistentBaseRadiusCells(),
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
  private collectWorldRenderWork(view: WorldViewRect): {
    pending: number;
    resident: number;
    renderReady: boolean;
  } {
    const renderReady = ArenaBuilder.isSurfaceWorkingSetReady(this.ctx.arenaResult, view)
      && this.renderers.shadow.isStaticReadyForView(view, true);
    const groundStats = this.ctx.arenaResult?.groundSurface?.getStats();
    const rockStats = this.ctx.arenaResult?.rockOverlaySurface?.getStats();
    const shadowStats = this.renderers.shadow.getStaticSurfaceStats();
    const pending = (groundStats?.pendingChunks ?? 0) + (groundStats?.pendingRegions ?? 0)
      + (groundStats?.pendingTextureAcquisitions ?? 0)
      + (rockStats?.pendingChunks ?? 0) + (rockStats?.pendingRegions ?? 0)
      + (rockStats?.pendingTextureAcquisitions ?? 0)
      + (shadowStats?.pendingChunks ?? 0) + (shadowStats?.pendingRegions ?? 0)
      + (shadowStats?.pendingTextureAcquisitions ?? 0);
    const resident = (groundStats?.residentChunks ?? 0)
      + (rockStats?.residentChunks ?? 0)
      + (shadowStats?.residentChunks ?? 0);
    return { pending, resident, renderReady };
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
    if (this.pendingClassicTrainEvent) {
      const { trackX, direction, plan } = this.pendingClassicTrainEvent;
      bridge.publishTrainEvent({
        trackX,
        direction,
        spawnAt: arenaStartTime + plan.firstArrivalDelayMs,
      });
    }
    this.hostUpdate.setActive(true);
  }

  private syncAuthoritativeRoundStartAnchors(): void {
    const roundStartTime = bridge.getArenaStartTime();
    if (roundStartTime <= 0 || roundStartTime === this.boundRoundStartTime) return;
    this.boundRoundStartTime = roundStartTime;
    this.timeOfDayController?.setRoundStartTime(roundStartTime);
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
      const reconnectAfterDeath = this.ctx.coopDefenseRespawnBudgetSystem !== null
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
    this.hostRefreshPersistentBaseCompositeForRelevantBuildChanges();
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
      ? this.ctx.coopDefenseSecondaryObjectiveSystem?.getEpicGuaranteeCount() ?? 0
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

  hostCompleteRound(roundConclusion: RoundConclusion | null = null): void {
    if (!bridge.isHost() || bridge.getGamePhase() !== 'ARENA') return;
    const roundEndedAt = Date.now();
    // Defeat, abort and non-Coop completion discard the round-local working copy.
    this.publishConfirmedPersistentBaseContributions(
      applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(roundConclusion), {
        contributions: this.persistentBaseContributions,
        isRuntimeObjectAlive: (runtimeId) => this.ctx.placementSystem?.hasRuntimeRock(runtimeId) === true,
      }),
    );
    bridge.publishCoopDefenseEncounterPresentationState(null);
    bridge.publishCoopDefenseMapEventPresentationState(null);
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(null);
    bridge.publishCoopDefenseMissionProgressPresentationState(null);

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

    this.hostSaveRoundResults(roundEndedAt, roundConclusion !== 'aborted');
    bridge.publishCoopDefenseRespawnBudgetState(null);
    // Diese Match-World endet hier gemeinsam mit ihrem Durchlauf. Ohne Phase, Activity und World bleibt kein
    // replizierter Weltzustand stehen, den eine spaetere Instanz faelschlich uebernehmen koennte.
    this.worldLifecycle.endInstance();
    this.clearWorldAdmission();
    this.lobbyWorldModeAtRevision = null;
    this.lobbyWorldPersistentBaseUnlockedAtRevision = null;
    this.pendingLobbyWorldReinstance = false;
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
    this.pendingLobbyWorldReinstance = false;
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
    const currentLoadout = bridge.getPlayerCurrentLoadoutSnapshot(playerId);
    return getActiveConstructionToolRefs(getConstructionAccessContext(this.resolveConfiguredGameMode(), currentLoadout));
  }

  getConstructionCapacityForPlayer(playerId: string): number {
    return this.getConstructionCapacity(playerId);
  }

  private removeGuestSessionOwner(playerId: string): void {
    if (!bridge.isHost() || playerId === bridge.getLocalPlayerId()) return;
    const runtimeIds = this.persistentBaseContributions.removeOwner(this.resolveOwnerId(playerId));
    this.ingestedContributionRevisions.delete(playerId);
    // Mit dem Spieler faellt sein Anspruch auf die Besitzeridentitaet; ein spaeterer Beitritt
    // darf sie wieder fuehren.
    this.persistentBaseOwnerByPlayerId.delete(playerId);
    let removedCount = 0;
    for (const runtimeId of runtimeIds) {
      const removed = this.ctx.placementSystem?.removeRock(runtimeId);
      if (!removed) continue;
      this.finalizeDismantledConstruction(removed, false);
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
      this.finalizeDismantledConstruction(removed, false);
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
    this.hostRefreshPersistentBaseComposite();
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
    return this.playerRuntime.isAttached(playerId);
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
    if (!bridge.isHost() || !this.worldLifecycle.isActive()) return;
    const activityRunning = this.worldLifecycle.activity.isActive();
    if (activityRunning) this.admitActivityRoster();

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
      const mayAct = member && (!activityRunning || bridge.getRoundRole(profile.id) === 'participant');
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
    return resolveWorldPresentation({
      participation: this.getWorldParticipation(bridge.getLocalPlayerId()),
      worldActive: this.worldLifecycle.isActive(),
      // Ob eine World auch ohne Teilnahme sichtbar sein darf, entscheidet ausschliesslich sie
      // selbst. Aus Raumzustand oder fehlender Activity wird das nie erschlossen.
      previewWithoutParticipation:
        this.ctx.world?.definition?.presentationPolicy?.previewWithoutParticipation === true,
    });
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
   * Kontext des Player-Lifecycles: Rolle, laufende Activity und die Teilnahme dieses Spielers.
   * Er entscheidet, welche Runtime-Module ein Spieler ueberhaupt bekommt.
   */
  private resolvePlayerFeatures(participation: WorldParticipation): PlayerRuntimeFeatures {
    return resolvePlayerRuntimeFeatures({
      activityKind: this.worldLifecycle.activity.kind,
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
    return this.playerRuntime.attach(
      { profile, reconnectAfterDeath, spawn },
      this.resolvePlayerFeatures(this.getWorldParticipation(profile.id)),
    );
  }

  /** Einziger Detach-Pfad fuer Host und Client; der volle Abbau bleibt idempotent. */
  detachPlayerFromWorld(playerId: string): void {
    this.playerRuntime.detach(playerId, this.resolvePlayerFeatures('interactive'));
  }

  /**
   * Loest jede Player-Runtime dieser World.
   *
   * Der Abbau laeuft bewusst immer mit dem vollen Modulanteil, damit von einem Beobachter kein
   * Kampfzustand stehen bleibt. Idempotent, und fuer Host wie Client gueltig.
   */
  private detachAllWorldPlayers(): void {
    const playerFeatures = this.resolvePlayerFeatures('interactive');
    for (const player of [...this.ctx.playerManager.getAllPlayers()]) {
      this.playerRuntime.detach(player.id, playerFeatures);
    }
  }

  terminateMatch(reason?: string): void {
    if (this.matchTerminated) return;
    this.matchTerminated = true;
    this.arenaBuilt = false;
    this.builtWorldRevision = 0;
    this.arenaEnteredAt = 0;
    this.lobbyWorldModeAtRevision = null;
    this.lobbyWorldPersistentBaseUnlockedAtRevision = null;
    this.pendingLobbyWorldReinstance = false;

    // A technical abort can happen before the normal round-conclusion path runs. Never carry a
    // half-written mission working state into a later round in the same room.
    if (bridge.isHost()) {
      applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(null), {
        contributions: this.persistentBaseContributions,
        isRuntimeObjectAlive: (runtimeId) => this.ctx.placementSystem?.hasRuntimeRock(runtimeId) === true,
      });
    }

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
  /**
   * Modus und authored Map dieser World.
   *
   * Metrik und Layout sind Weltanteile. Solange der Modus sie traegt, leitet ihn eine laufende
   * Activity ab; ohne Activity antwortet die World aus ihrer eigenen Identitaet. Die authored
   * Map gehoert immer der World - eine Coop-World ohne Mission bleibt eine Coop-World.
   */
  private resolveWorldLayout(
    world: WorldDescriptor,
    activity: ActivityDescriptor | null,
  ): {
    mode: GameMode;
    mapConfig: CoopDefenseMapConfig | null;
    definition: WorldDefinition | null;
    metricsProfile: ArenaMetricsProfile;
  } {
    const mapId = toMapId(world.definitionId);
    const mapConfig = mapId !== null ? getCoopDefenseMapConfig(mapId) : null;
    // Die authored World gehoert der World-Identitaet. Sie loest ueber dieselbe Registry auf,
    // ob sie aus einer Coop-Map adaptiert wurde oder – wie die LobbyWorld – nativ authoriert ist.
    const definition = getWorldDefinition(world.definitionId);
    const mode = resolveActiveGameMode({
      activityKind: activity?.kind ?? null,
      roomGameMode: bridge.getActiveGameMode(),
      worldDefinitionId: world.definitionId,
    });
    return {
      mode,
      mapConfig,
      definition,
      // Eine authored World bringt ihr Mass selbst mit; nur die prozedurale Arena leitet es
      // noch aus dem Modus ab.
      metricsProfile: definition
        ? getAuthoredWorldMetricsProfile(definition.metrics.widthCells, definition.metrics.heightCells)
        : getArenaMetricsProfile(mode, 'ARENA'),
    };
  }

  buildWorld(
    worldDescriptor: WorldDescriptor,
    activityDescriptor: ActivityDescriptor | null,
    preserveLobbyPresentation = false,
  ): void {
    if (worldDescriptor.generatorVersion !== ARENA_GENERATOR_VERSION) {
      throw new Error(
        `[ArenaLifecycleCoordinator] Unsupported arena generator version ${worldDescriptor.generatorVersion}; expected ${ARENA_GENERATOR_VERSION}`,
      );
    }

    const reusableArenaResult = preserveLobbyPresentation
      && isLobbyWorldDefinitionId(worldDescriptor.definitionId)
      && activityDescriptor === null
      ? this.ctx.arenaResult
      : null;
    const reusableLayout = reusableArenaResult ? this.ctx.currentLayout : null;
    const prepared = this.preparedRoundLayout;
    this.tearDownArena(reusableArenaResult !== null);

    // Merge-Baseline der Delta-Slices (rocks/powerups/pedestals) verwerfen, damit keine Zustände aus
    // der Vorrunde in die neue Runde lecken (z. B. beschädigte Felsen direkt zu Match-Beginn).
    bridge.resetGameStateCache();

    // Activity-Systeme entstehen, weil eine Activity laeuft – nicht, weil ein Modus-Flag gesetzt
    // ist. Diese eine Entscheidung traegt alle Activity-Gates dieses Aufbaus.
    const isCoopMission = activityDescriptor?.kind === 'coop-mission';
    const {
      mode: layoutMode,
      mapConfig: coopDefenseMapConfig,
      definition: worldDefinition,
      metricsProfile,
    } = this.resolveWorldLayout(worldDescriptor, activityDescriptor);
    if (isCoopMission && coopDefenseMapConfig === null) {
      throw new Error(`[ArenaLifecycleCoordinator] Coop activity has no authored World map`);
    }
    // Die authored Map gehoert der World - Missionssysteme entstehen aber nur mit laufender
    // Mission. Ohne diese getrennte Sicht wuerde eine Coop-World ohne Activity Bosse, Ziele und
    // Respawn-Budgets aufbauen, fuer die es keine Runde gibt.
    const missionMapConfig = isCoopMission ? coopDefenseMapConfig : null;

    // Spielerzahl und Gegnerbesetzung sind Activity-Zustand und existieren nur mit ihr.
    const roundState = activityDescriptor ? bridge.getRoundState() : null;
    const coopDefenseHumanPlayerCount = isCoopMission
      ? Math.max(1, Math.floor(roundState?.coopDefenseHumanPlayerCount ?? 1))
      : 1;
    const coopDefenseEnemyConfigs = isCoopMission
      ? resolveCoopDefenseEnemyConfigs(coopDefenseHumanPlayerCount)
      : null;

    // Kanonischer Kontext dieser World-Instanz. Metrik, Basen und die persistente Basisstelle
    // haengen ab hier an der World, nicht an der Lobby-Auswahl oder an globalen Variablen.
    const world = createWorldRuntimeContext({
      descriptor: worldDescriptor,
      metricsProfile,
      definition: worldDefinition,
    });
    // Die lokale Runtime haengt sich an die laufende World-Instanz; der Lifecycle schreibt
    // `ctx.world` und prueft, dass Runtime und Instanz dieselbe World meinen.
    this.worldLifecycle.attachRuntime(world, activityDescriptor);
    // Die World laeuft ab hier. Wer an ihr teilnimmt, entscheidet der Host sofort - sonst
    // haette die neue Instanz einen Frame lang gar keinen Teilnahmestand.
    this.hostSyncWorldParticipation();
    const presentation = this.getLocalWorldPresentation().required;
    // Figuren entstehen nur sichtbar, wenn dieser Peer die World ueberhaupt darstellt.
    this.ctx.playerManager.setVisualsEnabledResolver(
      () => presentation,
    );
    this.ctx.combatSystem.setWorldMetrics(world.metrics);
    this.ctx.decoySystem.setWorldMetrics(world.metrics);
    this.scene.physics.world.setBounds(
      world.metrics.offsetX,
      world.metrics.offsetY,
      world.metrics.widthPx,
      world.metrics.heightPx,
    );
    const coopDefenseBases = isCoopMission && coopDefenseMapConfig
      ? resolveCoopDefenseActivityBases(coopDefenseMapConfig, coopDefenseHumanPlayerCount, world.metrics)
      : world.bases;
    const generationMapConfig = isCoopMission && coopDefenseMapConfig
      ? coopDefenseMapConfig
      : world.definition
        ? toWorldGenerationConfig(world.definition)
        : undefined;
    this.ctx.playerManager.setWorldGeometry({
      metrics: world.metrics,
      bases: coopDefenseBases,
      captureTheBeerBasesActive: layoutMode === CAPTURE_THE_BEER_MODE,
      // Authored Startverbot dieser World; begehbar bleibt die Flaeche trotzdem.
      spawnExclusionZones: world.definition?.spawnExclusionZones,
      // Authored Wunschmitte dieser World; ein Missionsfokus sticht sie.
      spawnFocusCell: world.definition?.spawnFocusCell,
    });
    const locallyGeneratedLayout = prepared
      && prepared.descriptor.seed === worldDescriptor.seed
      && prepared.descriptor.layoutFingerprint === worldDescriptor.layoutFingerprint
      ? prepared.layout
      : generateWorldLayout({
        definitionId: worldDescriptor.definitionId,
        seed: worldDescriptor.seed,
        generation: resolveArenaGenerationInput(layoutMode, world.metrics),
        mapConfig: generationMapConfig,
      });
    const actualFingerprint = ArenaGenerator.fingerprint(locallyGeneratedLayout);
    if (actualFingerprint !== worldDescriptor.layoutFingerprint) {
      throw new Error(
        `[ArenaLifecycleCoordinator] Arena fingerprint mismatch: expected ${worldDescriptor.layoutFingerprint}, got ${actualFingerprint}`,
      );
    }
    const canReuseLobbyPresentation = reusableArenaResult !== null
      && reusableLayout !== null
      && presentation
      && reusableArenaResult.groundSurface !== null
      && reusableArenaResult.rockOverlaySurface !== null
      && reusableArenaResult.rockVisualSystem !== null;
    const layout = canReuseLobbyPresentation ? reusableLayout : locallyGeneratedLayout;
    this.renderers.leafBlower.setTerrainMaterialLayout(
      layout,
      coopDefenseBases.flatMap((base) => base.cells),
    );
    this.preparedRoundLayout = null;
    bridge.setLocalWorldLoadProgress(worldDescriptor.worldRevision, 35, 'building');
    const coopDefensePersistentSpawnConfigs = missionMapConfig
      ? resolveCoopDefenseMapPersistentSpawnConfigs(missionMapConfig, coopDefenseHumanPlayerCount)
      : [];
    const coopDefenseEncounterConfigs = missionMapConfig
      ? resolveCoopDefenseMapEncounterConfigs(missionMapConfig, coopDefenseHumanPlayerCount)
      : [];
    const coopDefenseSecondaryObjectiveConfigs = missionMapConfig
      ? resolveCoopDefenseMapSecondaryObjectives(missionMapConfig, coopDefenseHumanPlayerCount)
      : [];
    const missionProgressConfig = missionMapConfig
      ? resolveCoopDefenseMapMissionProgress(missionMapConfig)
      : undefined;
    this.ctx.coopDefenseSecondaryObjectiveSystem = null;
    this.ctx.coopDefenseMissionProgressSystem = null;
    this.ctx.coopDefenseMissionBarrierManager?.destroy();
    this.ctx.coopDefenseMissionBarrierManager = null;
    this.ctx.hostHeldActionSystem?.reset();
    this.ctx.hostHeldActionSystem = bridge.isHost() ? new HostHeldActionSystem() : null;
    this.ctx.coopDefenseCarrySystem = null;
    this.ctx.coopDefenseTeamBuffSystem?.reset();
    this.ctx.coopDefenseTeamBuffSystem = bridge.isHost() && missionMapConfig
      ? new CoopDefenseTeamBuffSystem()
      : null;
    this.ctx.coopDefenseObjectiveRepairSystem = null;
    this.ctx.coopDefenseObjectivePlacementRewardSystem = null;
    this.ctx.coopDefenseSecondaryObjectiveConfigs = coopDefenseSecondaryObjectiveConfigs;
    if (bridge.isHost()) {
      if (missionMapConfig && objectiveUsesRespawnBudget(missionMapConfig.objective)) {
        const respawnsPerPlayer = missionMapConfig.respawnsPerPlayer;
        if (respawnsPerPlayer === undefined) {
          throw new Error(`[ArenaLifecycleCoordinator] Map ${missionMapConfig.mapId} has no respawnsPerPlayer`);
        }
        const participantIds = bridge.getRoundParticipation()?.participantIds
          ?? bridge.getConnectedPlayerIds();
        this.ctx.coopDefenseRespawnBudgetSystem = new CoopDefenseRespawnBudgetSystem({
          respawnsPerPlayer,
          participantIds,
        });
        bridge.publishCoopDefenseRespawnBudgetState(this.ctx.coopDefenseRespawnBudgetSystem.getSnapshot());
      } else {
        this.ctx.coopDefenseRespawnBudgetSystem = null;
        bridge.publishCoopDefenseRespawnBudgetState(null);
      }
    } else {
      this.ctx.coopDefenseRespawnBudgetSystem = null;
    }
    this.ctx.currentLayout = layout;
    const builder = new ArenaBuilder(this.scene);
    const persistentBaseSite = world.persistentBaseSite;
    if (canReuseLobbyPresentation) {
      builder.rebindWorldRuntime(
        reusableArenaResult,
        reusableLayout,
        locallyGeneratedLayout,
        world.metrics,
        presentation,
      );
      this.ctx.arenaResult = reusableArenaResult;
    } else {
      this.ctx.arenaResult = builder.buildDynamic(layout, {
        worldMetrics: world.metrics,
        // Ohne lokale World-Presentation entstehen Staemme und Kronen gar nicht erst.
        presentation,
        // Die LobbyWorld traegt die Gravel-Layer auch ohne materialisierten Kern, damit der
        // bestehende Fast-Reinstance beim Moduswechsel Coop <-> Nicht-Coop dieselbe Presentation
        // wiederverwenden kann. Ohne Site bleibt der State leer; die Basis wird dadurch nicht
        // sichtbar und nicht als World-Geometrie materialisiert.
        enablePersistentBaseGravel: Boolean(world.definition?.persistentBaseSite),
        persistentBaseGravel: persistentBaseSite
          ? {
            seed: worldDescriptor.seed,
            anchor: persistentBaseSite.anchor,
            buildArea: persistentBaseSite.buildArea,
          }
          : undefined,
      });
    }
    // Beim Fast-Reinstance muss der wiederverwendete Ground-Streamer vor dem ersten Residency-
    // Bake bereits den neuen World-Zustand sehen; der regulaere Scene-Sync bestaetigt ihn danach.
    this.ctx.arenaResult.groundSurface?.setPersistentBaseGravel(
      persistentBaseSite
        ? {
          seed: worldDescriptor.seed,
          anchor: persistentBaseSite.anchor,
          buildArea: persistentBaseSite.buildArea,
        }
        : null,
    );
    bridge.setLocalWorldLoadProgress(worldDescriptor.worldRevision, 60, 'building');
    // Die gestreamten Weltschichten haben nach dem Bau noch keinen residenten Chunk. Ohne diesen
    // Aufruf zeigte der erste Frame einen leeren Boden – die Kamera steht hier bereits.
    ArenaBuilder.updateSurfaceResidency(this.ctx.arenaResult, getVisibleWorldView(this.scene.cameras.main));
    this.ctx.placementSystem = new PlacementSystem(
      layout,
      this.ctx.arenaResult.rockGrid,
      this.ctx.playerManager,
      world.metrics,
      coopDefenseBases,
    );
    this.ctx.persistentBaseContributions = null;
    this.persistentBaseCompositeBuildSignatures.clear();
    // Der Basiskern und sein committed Contribution-State gehoeren zur persistenten World. Nur
    // eine aktive Mission oeffnet zusaetzlich eine Working Copy; die LobbyWorld bearbeitet den
    // committed Stand dagegen unmittelbar.
    if (bridge.isHost() && persistentBaseSite !== null) {
      if (!isValidPersistentBaseSite(persistentBaseSite)) {
        throw new Error(
          `[ArenaLifecycleCoordinator] Persistent base anchor cannot resolve on world ${world.descriptor.definitionId}`,
        );
      }
      // Erst alle aktuell angebotenen Beitraege einsammeln. Eine Mission startet danach ihren
      // Working State genau bei diesem committed Stand; ohne Activity bleibt er direkt editierbar.
      this.ingestOfferedPersistentBaseContributions();
      if (activityDescriptor !== null) this.persistentBaseContributions.beginMission();
      this.ctx.persistentBaseContributions = this.persistentBaseContributions;
      this.persistentBaseAnchor = persistentBaseSite.anchor;
      this.persistentBaseBuildArea = persistentBaseSite.buildArea;
    } else {
      this.persistentBaseAnchor = null;
      this.persistentBaseBuildArea = null;
    }
    this.ctx.coopDefenseMissionBarrierManager = missionProgressConfig
      ? new CoopDefenseMissionBarrierManager(this.scene, missionProgressConfig, world.metrics, {
        physicsGroup: this.ctx.arenaResult.trunkGroup,
        onOccupancyChanged: (changes) => {
          this.ctx.flowFieldCoordinator?.patchBarrierCells(changes);
          this.ctx.lightOccluderIndex?.markDirty();
        },
      })
      : null;
    this.ctx.placementSystem.setClosedBarrierCellResolver((gridX, gridY) => (
      this.ctx.coopDefenseMissionBarrierManager?.isCellClosed(gridX, gridY) ?? false
    ));
    // Eine vorbereitete Gefahrenflaeche sperrt das Bauen erst ab ihrer Ankuendigung. Host und
    // Client lesen dafuer denselben replizierten Event-Snapshot, damit Bauvorschau und
    // Host-Pruefung nicht auseinanderlaufen.
    this.ctx.placementSystem.setHazardEventArmedResolver((eventId) => {
      const entry = bridge.getCoopDefenseMapEventPresentationState()
        ?.find((candidate) => candidate.eventId === eventId);
      return entry === undefined ? true : entry.state !== 'dormant';
    });
    // Host und Client halten das System: der Host autoritativ, der Client fuer die Darstellung.
    this.ctx.reinforcementMatrixSystem = new ReinforcementMatrixSystem();
    this.ctx.energyInjectorSystem = new EnergyInjectorSystem();
    this.ctx.targetStatusSystem = new TargetStatusSystem();
    this.ctx.captureTheBeerSystem = activityDescriptor?.kind === 'capture-the-beer'
      ? new CaptureTheBeerSystem(this.ctx.playerManager)
      : null;

    // Coop-Defense: BaseManager besitzt die Basis-Entities (Visual + Physik + HP + Sync).
    // Host und Client erzeugen identische BaseEntities aus der gemeinsamen Registry –
    // HP-Werte fließen über GameState.bases (Host → Client).
    this.ctx.baseManager = coopDefenseBases.length > 0
      ? new BaseManager(this.scene, coopDefenseBases, world.metrics, {
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
                // Gleiche Rasterzellen frischen sich auf, statt pro Brocken
                // separate Schadens-/Brandquellen zu stapeln.
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
      // Ohne Activity kennt keine Struktur dieser World Schaden: Sie steht als Bauwerk da, nicht
      // als Missionsziel. Das ist derselbe Grund, aus dem hier keine Working Copy entsteht.
      }, presentation, activityDescriptor !== null)
      : null;
    this.ctx.baseManager?.setLightingSystem(this.renderers.lighting);
    this.ctx.enemyManager = isCoopMission && coopDefenseEnemyConfigs
      ? new EnemyManager(this.scene, coopDefenseEnemyConfigs)
      : null;
    this.ctx.enemyManager?.setWorldMetrics(world.metrics);
    // Buddel- und Spawn-Visuals der Gegner laufen über dieselbe Effekt-Schicht wie die der
    // Spieler – auf Host und Client, da beide Seiten Entstehung und Einbuddel-Zustand aus dem
    // Snapshot kennen.
    this.ctx.enemyManager?.setVisualSink(this.ctx.effectSystem);
    // Brennende Gegner leuchten wie brennende Projektile; das Licht hängt am
    // EntityBurnRenderer der jeweiligen Entity.
    this.ctx.enemyManager?.setLightingSystem(this.renderers.lighting);
    this.ctx.enemyManager?.setEntityBurnGpuController(this.renderers.entityBurnGpu);
    this.ctx.coopDefenseRoundStateSystem = bridge.isHost()
      && this.ctx.baseManager
      && isCoopMission
      && missionMapConfig
      ? new CoopDefenseRoundStateSystem({
        baseManager: this.ctx.baseManager,
        objective: missionMapConfig.objective,
        getSecondsLeft: () => bridge.computeSecondsLeft(),
        isBossDefeated: () => this.ctx.coopDefenseBossSystem?.isBossDefeated() ?? false,
        isAssaultRepelled: () => this.ctx.coopDefenseMapDirector?.isAssaultRepelled() ?? false,
        // Dieselbe Quelle fuer survive und advance: das authored Respawn-Budget entscheidet,
        // wann ein Team-Wipe endgueltig ist.
        isTeamWipedOut: () => {
          const budget = this.ctx.coopDefenseRespawnBudgetSystem;
          if (!budget) return false;
          return budget.isTeamWiped(
            bridge.getConnectedPlayerIds(),
            bridge.getRoundParticipation()?.spectatorIds ?? [],
          );
        },
        // Der Vorstoss-Sieg gehoert vollstaendig dem Missionsfortschritt.
        isAdvanceComplete: () => this.ctx.coopDefenseMissionProgressSystem?.isRouteComplete() ?? false,
        isAdvanceFailed: () => this.ctx.coopDefenseMissionProgressSystem?.isMissionFailed() ?? false,
      })
      : null;
    const baseManager = this.ctx.baseManager;
    // Eine Basisaenderung trifft alle Felder gemeinsam: Der Coordinator verschickt den Patch
    // prioritaer und sperrt die entfallenen Zielzellen sofort, bis das neue Feld aktiv ist.
    const syncActiveBaseIds = (): void => {
      this.ctx.flowFieldCoordinator?.setActiveBaseIds(
        baseManager?.getActiveBaseIds() ?? new Set<string>(),
      );
    };
    if (bridge.isHost()) {
      // Der Coop-Build gehoert zur laufenden World und kann deshalb auch in einer Activity-losen
      // LobbyWorld wirken. Die darunterliegenden Missionssysteme bleiben weiterhin an
      // `isCoopMission`/`missionMapConfig` gebunden.
      this.ctx.coopDefensePlayerModifierSystem = new CoopDefensePlayerModifierSystem();
      this.ctx.coopDefenseItemRuntimeSystem = this.ctx.coopDefensePlayerModifierSystem
        ? new CoopDefenseItemRuntimeSystem({
          getAffixValue: (playerId, affixId) => (
            this.ctx.coopDefensePlayerModifierSystem?.getItemAffixValue(playerId, affixId) ?? 0
          ),
          getPlayerHp: (playerId) => (
            this.ctx.playerManager.getPlayer(playerId)
              ? { hp: this.ctx.combatSystem.getHP(playerId), maxHp: this.ctx.combatSystem.getMaxHp(playerId) }
              : null
          ),
          getPlayerPosition: (playerId) => {
            const player = this.ctx.playerManager.getPlayer(playerId);
            return player ? { x: player.x, y: player.y } : null;
          },
          getPlayerClassId: (playerId) => this.ctx.coopDefensePlayerModifierSystem?.getClassId(playerId) ?? null,
        })
        : null;
      this.ctx.coopDefenseItemRuntimeSystem?.setTargetStatusSystem(this.ctx.targetStatusSystem);
      this.syncHostCoopDefensePlayerModifiersFromCurrentBuild();

      const obstacleCellProvider = () => {
        const staticRockCells = layout.rocks.flatMap((rock, index) => {
          const isActive = this.ctx.arenaResult?.rockPhysicsProxies[index]?.active ?? false;
          return isActive ? [{ gridX: rock.gridX, gridY: rock.gridY }] : [];
        });
        const runtimeRockCells = (this.ctx.placementSystem?.getAllRuntimeRocks() ?? [])
          .filter((rock) => rock.kind !== 'pedestal')
          .map((rock) => ({
            gridX: rock.gridX,
            gridY: rock.gridY,
          }));

        return [...staticRockCells, ...runtimeRockCells];
      };
      const flowFieldMetrics = {
        cols: world.metrics.gridCols,
        rows: world.metrics.gridRows,
        cellSize: CELL_SIZE,
        arenaOffsetX: world.metrics.offsetX,
        arenaOffsetY: world.metrics.offsetY,
      };

      // Ein Coordinator fuer alle Runtime-Flowfields. Er haelt den Topologiespiegel, taktet die
      // Nav-Ticks und besitzt den Worker; die Services sind nur noch synchrone Lesefassaden.
      if (isCoopMission) {
        const bossConfig = missionMapConfig?.boss
          ? getCoopDefenseEnemyConfig(missionMapConfig.boss.enemyKind)
          : null;
        const bossClearanceCells = bossConfig
          ? Math.ceil(Math.max(0, bossConfig.size * 0.5 - CELL_SIZE * 0.5) / CELL_SIZE)
          : 0;
        const flowFieldCoordinator = new FlowFieldCoordinator({
          metrics: flowFieldMetrics,
          tuning: createFlowFieldTuning(),
          staticKind: buildStaticKindRaster(layout, flowFieldMetrics),
          bases: buildBaseDescriptors(coopDefenseBases),
          activeBaseIds: this.ctx.baseManager?.getActiveBaseIds()
            ?? new Set(coopDefenseBases.map((spec) => spec.id)),
          obstacleCellProvider,
          barrierCells: missionProgressConfig?.barriers.flatMap((barrier) => barrier.cells) ?? [],
          runner: createFlowFieldRunner(),
          navTickIntervalMs: COOP_DEFENSE_NAV_TICK_INTERVAL_MS,
          generationId: this.nextFlowFieldGenerationId(),
        });
        this.ctx.flowFieldCoordinator = flowFieldCoordinator;
        // Einmalige Ansage, welches Substrat wirklich laeuft. Ohne sie greift der Inline-Fallback
        // still, und ein Trace zeigt dann faelschlich "die Verlagerung hat nichts gebracht".
        console.info(`[flowfield] runner=${flowFieldCoordinator.getDiagnostics().runnerKind}`);

        this.ctx.enemyFlowFieldService = EnemyFlowFieldService.fromView(
          flowFieldCoordinator.registerField(ENEMY_FLOW_FIELD_IDS.base, { goalMode: 'bases' }),
        );
        this.ctx.enemyPlayerFlowFieldService = EnemyFlowFieldService.fromView(
          flowFieldCoordinator.registerField(ENEMY_FLOW_FIELD_IDS.player, {
            goalMode: 'dynamic-fallback-bases',
          }),
        );
        this.ctx.enemyStrategicFlowFieldService = EnemyFlowFieldService.fromView(
          flowFieldCoordinator.registerField(ENEMY_FLOW_FIELD_IDS.strategic, {
            goalMode: 'dynamic',
            tickDivisor: COOP_DEFENSE_NAV_TICK_DIVISOR_STRATEGIC,
          }),
        );
        this.ctx.enemyBossFlowFieldService = bossConfig
          ? EnemyFlowFieldService.fromView(
            flowFieldCoordinator.registerField(ENEMY_FLOW_FIELD_IDS.boss, {
              goalMode: bossConfig.movementTarget === 'players' ? 'dynamic-fallback-bases' : 'bases',
              clearanceCells: bossClearanceCells,
            }),
          )
          : null;
        // Ally-Felder gibt es fuer alle bereits vorhandenen Spieler; Nachzuegler registriert
        // `ensureAllyFlowField` beim Spawn nach.
        this.ctx.allyFlowFieldServices.clear();
        for (const player of this.ctx.playerManager.getAllPlayers()) {
          this.ensureAllyFlowField(player.id);
        }

        this.flowFieldGridListener = (event: ArenaMapGridChangedEvent): void => {
          const change = resolveGridChange(event);
          if (change) flowFieldCoordinator.patchCell(change.gridX, change.gridY, change.occupied);
          else flowFieldCoordinator.requestFullResync();
        };
        this.scene.game.events.on(ARENA_MAP_GRID_CHANGED_EVENT, this.flowFieldGridListener);
      } else {
        this.ctx.enemyFlowFieldService = null;
        this.ctx.enemyPlayerFlowFieldService = null;
        this.ctx.enemyStrategicFlowFieldService = null;
        this.ctx.enemyBossFlowFieldService = null;
        this.ctx.allyFlowFieldServices.clear();
      }
      this.ctx.enemyStrategicTargetService = this.ctx.enemyStrategicFlowFieldService
        ? new EnemyStrategicTargetService(this.ctx.enemyStrategicFlowFieldService)
        : null;
      if (this.ctx.enemyStrategicTargetService && this.ctx.flowFieldCoordinator) {
        // Die Zielzuordnung wird exakt mit dem Feld aktiv, aus dessen Zielmenge sie stammt.
        this.ctx.flowFieldCoordinator.getFieldView(ENEMY_FLOW_FIELD_IDS.strategic)?.onActivated(
          (payload) => {
            if (payload) {
              this.ctx.enemyStrategicTargetService?.activate(payload as PreparedStrategicTargets);
            }
          },
        );
      }
      this.ctx.enemyAiTargetCatalog = new EnemyAiTargetCatalog();
      if (
        this.ctx.enemyManager
        && this.ctx.enemyFlowFieldService
        && (
          coopDefensePersistentSpawnConfigs.length > 0
          || coopDefenseEncounterConfigs.length > 0
          || missionMapConfig?.boss !== undefined
        )
      ) {
        this.ctx.coopDefenseSpawnExecutor = new CoopDefenseSpawnExecutor(
          this.ctx.enemyManager,
          this.ctx.enemyFlowFieldService,
          this.ctx.enemyBossFlowFieldService,
          this.ctx.enemyPlayerFlowFieldService,
          this.ctx.enemyStrategicFlowFieldService,
        );
        this.ctx.coopDefensePersistentPressureSystem = coopDefensePersistentSpawnConfigs.length > 0
          ? new CoopDefensePersistentPressureSystem(
            coopDefensePersistentSpawnConfigs,
            this.ctx.coopDefenseSpawnExecutor,
            coopDefenseBases,
            () => this.ctx.baseManager?.getActiveBaseIds() ?? new Set<string>(),
          )
          : null;
        this.ctx.coopDefenseBossSystem = missionMapConfig?.boss
          ? new CoopDefenseBossSystem(
            missionMapConfig.boss,
            this.ctx.enemyManager,
            this.ctx.coopDefenseSpawnExecutor,
            (spawnedAtMs) => {
              this.runtimeDiagnosticEventSink?.('boss:spawn', { spawnedAtMs });
              const current = bridge.getRoundState();
              if (!current || current.status !== 'active') return;
              bridge.publishRoundState({
                ...current,
                coopDefenseBossSpawnedAtMs: spawnedAtMs,
              });
            },
          )
          : null;
        if (coopDefenseEncounterConfigs.length > 0) {
          this.ctx.coopDefenseMapDirector = new CoopDefenseMapDirector(
            coopDefenseEncounterConfigs,
            (enemyKind, count, originId, front, spawnArea) => this.ctx.coopDefenseSpawnExecutor
              ?.hostSpawnEncounterGroup(enemyKind, count, originId, front, spawnArea),
            {
              mode: missionMapConfig?.objective === 'repel-assault' ? 'repel-assault' : 'scheduled',
              showComplete: missionMapConfig?.objective === 'repel-assault',
              isEnemyActive: (enemyId) => this.ctx.enemyManager?.getEnemy(enemyId)?.sprite.active === true,
              isEncounterStartSatisfied: (start) => {
                switch (start.type) {
                  case 'after-event':
                    return this.ctx.coopDefenseMapEventDirector?.isEventCompleted(start.eventId) ?? false;
                  case 'boss-phase':
                    return this.ctx.coopDefenseVoidHunterSystem?.hasReachedPhase(start.phase) ?? false;
                  case 'after-encounter':
                    return this.ctx.coopDefenseMapDirector?.isEncounterCleared(start.encounterId) ?? false;
                  case 'after-checkpoint':
                    return this.ctx.coopDefenseMissionProgressSystem?.isCheckpointActivated(start.checkpointId) ?? false;
                  case 'after-defense':
                    return this.ctx.coopDefenseMissionProgressSystem?.isDefenseResolved(start.defenseId) ?? false;
                  case 'base-destroyed':
                    return this.ctx.baseManager?.getBase(start.baseId)?.isDestroyed() ?? false;
                  case 'time':
                  case 'after-previous':
                    return false;
                }
              },
              isEnemyOriginActive: (originId) => this.ctx.enemyManager?.hasActiveEnemyOrigin(originId) ?? false,
              getActiveEnemyIdsForOrigin: (originId) => this.ctx.enemyManager?.getActiveEnemyIdsForOrigin(originId) ?? [],
              isEnemyTechnicallyStuck: (enemyId) => {
                const enemy = this.ctx.enemyManager?.getEnemy(enemyId);
                return enemy?.sprite.active === true && enemy.getHp() > 0 && enemy.isPathBlocked();
              },
              removeEnemy: (enemyId) => (this.ctx.enemyManager?.hostRemoveWithoutKill(enemyId) ?? null) !== null,
              onDiagnosticEvent: (type, fields) => this.runtimeDiagnosticEventSink?.(type, fields),
            },
          );
        }
      }
      this.ctx.coopDefenseObjectiveRepairSystem = bridge.isHost() && baseManager
        ? new CoopDefenseObjectiveRepairSystem({
          healBase: (baseId, amount) => baseManager.heal(baseId, amount),
          getBaseHp: (baseId) => baseManager.getBase(baseId)?.getHp() ?? null,
          getBaseMaxHp: (baseId) => baseManager.getBase(baseId)?.getMaxHp() ?? null,
        })
        : null;
      this.ctx.coopDefenseObjectivePlacementRewardSystem = bridge.isHost() && baseManager
        ? new CoopDefenseObjectivePlacementRewardSystem(coopDefenseSecondaryObjectiveConfigs, {
          isEligiblePlayer: (playerId) => this.getPlayerCapabilities(playerId).canUseMissionActions,
          getBasePosition: (baseId) => {
            const base = baseManager.getBase(baseId);
            if (!base) return null;
            return getBaseRewardPickupWorldPosition(
              base.getSpec(),
              world.metrics,
              baseManager.getBases().map((entry) => entry.getSpec()),
            );
          },
          spawnMarker: (objectiveId, powerUpDefId, x, y) => (
            this.ctx.powerUpSystem?.spawnObjectiveRewardMarker(objectiveId, powerUpDefId, x, y) !== null
          ),
          removeMarker: (objectiveId) => this.ctx.powerUpSystem?.clearObjectiveReward(objectiveId),
          spawnPickup: (objectiveId, powerUpDefId, x, y) => (
            this.ctx.powerUpSystem?.spawnObjectiveRewardPickup(objectiveId, powerUpDefId, x, y) !== null
          ),
          overrideUtility: (playerId, config) => this.ctx.loadoutManager?.overrideUtility(playerId, config, 1) ?? false,
          releaseUtilityOverride: (playerId) => this.ctx.loadoutManager?.releaseUtilityOverride(playerId),
        })
        : null;
      this.ctx.coopDefenseSecondaryObjectiveSystem = coopDefenseSecondaryObjectiveConfigs.length > 0
        ? new CoopDefenseSecondaryObjectiveSystem(coopDefenseSecondaryObjectiveConfigs, {
          isObjectivePriorityRequested: (objectiveId) => (
            this.ctx.coopDefenseMissionProgressSystem?.isMandatoryDefenseObjectivePrioritized(objectiveId) ?? false
          ),
          isEncounterCleared: (encounterId) => this.ctx.coopDefenseMapDirector?.isEncounterCleared(encounterId) ?? false,
          isExternalTriggerSatisfied: (trigger) => {
            if (trigger.type === 'after-checkpoint') {
              return this.ctx.coopDefenseMissionProgressSystem?.isCheckpointActivated(trigger.checkpointId) ?? false;
            }
            if (trigger.type === 'after-defense') {
              return this.ctx.coopDefenseMissionProgressSystem?.isDefenseResolved(trigger.defenseId) ?? false;
            }
            return false;
          },
          onObjectiveActivated: (objectiveId) => {
            if (!bridge.isHost()) return;
            this.ctx.coopDefenseCarrySystem?.activateObjective(objectiveId);
            const config = coopDefenseSecondaryObjectiveConfigs.find((entry) => entry.id === objectiveId);
            if (config?.rewards?.placeablePedestalOnComplete) {
              this.ctx.coopDefenseObjectivePlacementRewardSystem?.begin(objectiveId);
            }
          },
          onObjectiveCompleted: (objectiveId) => {
            if (!bridge.isHost()) return;
            const reward = coopDefenseSecondaryObjectiveConfigs
              .find((entry) => entry.id === objectiveId)
              ?.rewards?.teamBuffOnComplete;
            if (reward) this.ctx.coopDefenseTeamBuffSystem?.activate(reward, Date.now());
          },
          onHoldFailed: (objectiveId) => {
            if (!bridge.isHost()) return;
            this.ctx.coopDefenseObjectivePlacementRewardSystem?.cancel(objectiveId);
          },
          // Das Objective-System fordert den Reward nur an; welcher es ist, steht in der Map.
          onHoldCompleted: (objectiveId) => {
            if (!bridge.isHost()) return;
            const config = coopDefenseSecondaryObjectiveConfigs.find((entry) => entry.id === objectiveId);
            if (config?.rewards?.repairTargetOnComplete === true) {
              for (const targetId of config.targets) {
                this.ctx.coopDefenseObjectiveRepairSystem?.start(targetId);
              }
            }
            if (config?.rewards?.placeablePedestalOnComplete) {
              this.ctx.coopDefenseObjectivePlacementRewardSystem?.activate(objectiveId);
            }
          },
        })
        : null;
      this.ctx.coopDefenseMissionProgressSystem = bridge.isHost() && missionProgressConfig
        ? new CoopDefenseMissionProgressSystem(missionProgressConfig, {
          roundRevision: worldDescriptor.worldRevision,
          worldMetrics: world.metrics,
          getDefenseObjectiveState: (objectiveId) => (
            this.ctx.coopDefenseSecondaryObjectiveSystem?.getObjectiveState(objectiveId) ?? null
          ),
          isEncounterCleared: (encounterId) => (
            this.ctx.coopDefenseMapDirector?.isEncounterCleared(encounterId) ?? false
          ),
          onPresentationChanged: (state) => {
            this.ctx.coopDefenseMissionBarrierManager?.syncPresentationState(state);
            bridge.publishCoopDefenseMissionProgressPresentationState(state);
          },
        })
        : null;
      for (const player of this.ctx.playerManager.getAllPlayers()) {
        this.ctx.coopDefenseMissionProgressSystem?.resetPlayerPosition(
          player.id,
          player.x,
          player.y,
        );
      }
      bridge.publishCoopDefenseMissionProgressPresentationState(
        this.ctx.coopDefenseMissionProgressSystem?.getPresentationState() ?? null,
      );
      this.ctx.coopDefenseCarrySystem = coopDefenseSecondaryObjectiveConfigs.some(
        (config) => config.type === 'carry' && config.carry !== undefined,
      )
        ? new CoopDefenseCarrySystem(coopDefenseSecondaryObjectiveConfigs, this.ctx.playerManager, {
          isPlayerEligible: (playerId) => this.getPlayerCapabilities(playerId).canUseMissionActions,
          isPlayerAlive: (playerId) => this.ctx.combatSystem.isAlive(playerId),
          isPlayerBurrowed: (playerId) => this.ctx.burrowSystem?.isBurrowed(playerId) ?? false,
          onDelivered: (objectiveId, itemId) => (
            this.ctx.coopDefenseSecondaryObjectiveSystem?.reportCarryDelivered(objectiveId, itemId) ?? false
          ),
          onDeliveredFx: (x, y) => {
            if (!bridge.isHost()) return;
            bridge.broadcastCoopDefenseCarryDeliveredFx(x, y);
          },
        })
        : null;
      // Wenn eine Basis zerstört wird, soll die Wegfindung sich neu orientieren:
      // Goal-Cells werden nur noch aus den verbleibenden Basen aufgebaut, so dass
      // Gegner zur nächstgelegenen aktiven Basis laufen.
      if (baseManager) {
        baseManager.setOnBaseActivated((activatedBase) => {
          this.ctx.combatSystem.setBaseObstacles(baseManager.getObstacleRectangles());
          const activatedEntity = baseManager.getBases().find((base) => base.id === activatedBase.id);
          if (activatedEntity) {
            this.fireObstacleIndex?.setBase(
              activatedEntity.id,
              activatedEntity.getCellBodies().map((body) => body.getBounds()),
            );
          }
          this.ctx.powerUpSystem?.activatePedestalsLinkedToBase(activatedBase.id);
          syncActiveBaseIds();
        });
        // Flow fields are created from the complete prebuilt base list; remove dormant mission
        // structures from their initial active-ID set before the first movement tick.
        syncActiveBaseIds();
      }
    }
    if (baseManager) {
      baseManager.setOnBaseDestroyed((destroyedBase) => {
        this.fireObstacleIndex?.removeBase(destroyedBase.id);
        this.ctx.targetStatusSystem?.removeTarget({ targetType: 'base', targetId: destroyedBase.id });
        this.ctx.energyInjectorSystem?.removeTarget({ targetType: 'base', targetId: destroyedBase.id });
        this.ctx.powerUpSystem?.destroyPedestalsLinkedToBase(destroyedBase.id);

        if (bridge.isHost()) {
          // Ob die Zerstörung Fortschritt (Destroy) oder Fehlschlag (Hold) bedeutet, entscheidet der
          // Archetyp im Objective-System; hier wird nur die gemeldete Team-XP gebucht.
          const objectiveId = destroyedBase.dormantObjectiveId;
          const xp = objectiveId
            ? this.ctx.coopDefenseSecondaryObjectiveSystem?.reportTargetDestroyed(objectiveId, destroyedBase.id) ?? 0
            : 0;
          if (xp > 0) bridge.addCoopDefenseRoundXp(xp);

          const blast = getBaseDestructionBlast(destroyedBase);
          this.ctx.hostPhysics.applyRadialImpulse(
            blast.x,
            blast.y,
            blast.radius,
            blast.force,
            undefined,
            1,
            blast.durationMs,
          );
        }

        syncActiveBaseIds();
      });
    }
    if (!bridge.isHost()) {
      this.ctx.baseManager?.setOnBaseActivated((activatedBase) => {
        // Clients have no host flow fields, but their shared obstacle index still needs the
        // newly materialized cell bodies for local LoS and presentation-side queries.
        this.ctx.combatSystem.setBaseObstacles(this.ctx.baseManager?.getObstacleRectangles() ?? null);
        const activatedEntity = this.ctx.baseManager?.getBases().find((base) => base.id === activatedBase.id);
        if (activatedEntity) {
          this.fireObstacleIndex?.setBase(
            activatedEntity.id,
            activatedEntity.getCellBodies().map((body) => body.getBounds()),
          );
        }
        syncActiveBaseIds();
      });
    }
    // Both peers derive activation from B1's reliable presentation snapshot. The host additionally
    // wires flow-field and pedestal follow-ups above; the BaseEntity materialization itself must
    // also happen on clients that do not run host flow fields.
    this.ctx.baseManager?.setSecondaryObjectiveStateProvider((objectiveId) => {
      const state = bridge.getCoopDefenseSecondaryObjectivePresentationState();
      return state?.find((entry) => entry.objectiveId === objectiveId)?.state ?? null;
    });
    if (bridge.isHost()) {
      this.ctx.captureTheBeerSystem?.setFxHandler((event) => {
        bridge.broadcastCaptureTheBeerFx(event);
      });
    }

    this.ctx.playerManager.setLayout(layout);

    this.ctx.projectileManager.setRockGroup(
      this.ctx.arenaResult.rockGroup,
      this.ctx.arenaResult.rockPhysicsProxies,
      this.ctx.arenaResult.trunkGroup,
    );
    this.ctx.projectileManager.setBaseGroup(this.ctx.baseManager?.getBaseGroup() ?? null);
    this.ctx.decoySystem.setObstacleGroups(
      this.ctx.arenaResult.rockGroup,
      this.ctx.arenaResult.trunkGroup,
    );
    this.ctx.combatSystem.setArenaObstacles(this.ctx.arenaResult.rockPhysicsProxies, this.ctx.arenaResult.trunkBodies);
    this.ctx.combatSystem.setBaseObstacles(this.ctx.baseManager?.getObstacleRectangles() ?? null);
    this.ctx.combatSystem.setBarrierObstacles(this.ctx.coopDefenseMissionBarrierManager?.getObstacleRectangles() ?? null);
    // Dieselbe Index-Instanz, damit Sichtlinie und Projektil-Kollision denselben Stand sehen.
    this.ctx.projectileManager.setObstacleIndex(this.ctx.combatSystem.getObstacleIndex());
    // Brandraster-Hindernisse werden einmalig in 16-px-Zellen projiziert. Danach werden nur
    // die Footprints der betroffenen Map-Zellen gepatcht; Fire-Cell-Lookups bleiben konstant.
    if (this.fireObstacleGridListener) {
      this.scene.game.events.off(ARENA_MAP_GRID_CHANGED_EVENT, this.fireObstacleGridListener);
      this.fireObstacleGridListener = null;
    }
    this.fireObstacleIndex?.reset();
    const fireObstacleIndex = new FireObstacleIndex({
      width: Math.ceil((world.metrics.offsetX + world.metrics.widthPx) / GROUND_FIRE_CELL_SIZE),
      height: Math.ceil((world.metrics.offsetY + world.metrics.heightPx) / GROUND_FIRE_CELL_SIZE),
      fireCellSize: GROUND_FIRE_CELL_SIZE,
      worldOriginX: world.metrics.offsetX,
      worldOriginY: world.metrics.offsetY,
      worldCellSize: CELL_SIZE,
    });
    this.fireObstacleIndex = fireObstacleIndex;

    const rebuildFireObstacleIndex = (): void => {
      fireObstacleIndex.reset();
      for (let rockId = 0; rockId < (this.ctx.arenaResult?.rockPhysicsProxies.length ?? 0); rockId += 1) {
        const rock = this.ctx.arenaResult?.rockPhysicsProxies[rockId];
        if (!rock?.active) continue;
        fireObstacleIndex.addStaticRock(rockId, rock.getBounds());
      }
      for (const rock of this.ctx.placementSystem?.getAllRuntimeRocks() ?? []) {
        if (rock.kind !== 'pedestal') fireObstacleIndex.addPlaceableRock(rock.id, rock.gridX, rock.gridY);
      }
      for (const trunk of this.ctx.arenaResult?.trunkBodies ?? []) {
        if (trunk?.active) fireObstacleIndex.addLineOfSightBounds(trunk.getBounds());
      }
      for (const base of this.ctx.baseManager?.getBases() ?? []) {
        if (base.isInert()) continue;
        fireObstacleIndex.setBase(
          base.id,
          base.getCellBodies().map((body) => body.getBounds()),
        );
      }
    };
    rebuildFireObstacleIndex();
    this.fireObstacleGridListener = (event: ArenaMapGridChangedEvent): void => {
      if (event.source === 'placeable_pedestal') return;
      if (event.source === 'static_rock'
        && event.reason === 'static_rock_destroyed'
        && event.obstacleId !== undefined) {
        fireObstacleIndex.removeStaticRock(event.obstacleId);
        return;
      }
      if ((event.reason === 'placeable_added'
        || event.reason === 'placeable_removed'
        || event.reason === 'placeable_expired')
        && event.obstacleId !== undefined
        && event.gridX !== undefined
        && event.gridY !== undefined) {
        if (event.reason === 'placeable_added') {
          fireObstacleIndex.addPlaceableRock(event.obstacleId, event.gridX, event.gridY);
        } else {
          fireObstacleIndex.removePlaceableRock(event.obstacleId);
        }
        return;
      }
      // Unknown map-grid payloads are handled outside the FireSystem call stack. This keeps
      // the normal resolver hotpath free of a hidden full-map fallback.
      rebuildFireObstacleIndex();
    };
    this.scene.game.events.on(ARENA_MAP_GRID_CHANGED_EVENT, this.fireObstacleGridListener);
    this.ctx.fireSystem.setGroundResolvers(
      (bounds) => fireObstacleIndex.isCellBlocked(
        Math.floor(bounds.centerX / GROUND_FIRE_CELL_SIZE),
        Math.floor(bounds.centerY / GROUND_FIRE_CELL_SIZE),
      ),
      (startX, startY, endX, endY) => {
        const dx = endX - startX;
        const dy = endY - startY;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / GROUND_FIRE_CELL_SIZE));
        for (let step = 1; step < steps; step += 1) {
          const t = step / steps;
          const gridX = Math.floor((startX + dx * t) / GROUND_FIRE_CELL_SIZE);
          const gridY = Math.floor((startY + dy * t) / GROUND_FIRE_CELL_SIZE);
          if (fireObstacleIndex.hasLineOfSightObstacle(gridX, gridY)) return false;
        }
        return true;
      },
      () => fireObstacleIndex.revision,
    );
    this.ctx.combatSystem.setBaseManager(this.ctx.baseManager);
    this.ctx.combatSystem.setEnemyManager(this.ctx.enemyManager);
    this.ctx.combatSystem.setPlayerMaxHpResolver((playerId) => {
      return this.ctx.coopDefensePlayerModifierSystem?.getMaxHp(playerId) ?? HP_MAX;
    });
    // Wer in dieser World eine Spielfigur bekommt, entscheidet die Runde – solange es eine gibt.
    // `canPlayerInitialSpawn()`/`canPlayerRespawn()` verlangen ARENA-Phase und Rundenbesetzung
    // und koennen eine World ohne Activity gar nicht beantworten; dort traegt die World-Teilnahme
    // die Antwort. Ohne diese Trennung bekaeme ein Testgelaende-Teilnehmer nie Leben.
    this.ctx.combatSystem.setInitialSpawnAllowedResolver((playerId) => (
      this.worldLifecycle.activity.isActive()
        ? bridge.canPlayerInitialSpawn(playerId)
        : hasWorldFigure(this.getWorldParticipation(playerId))
    ));
    this.ctx.combatSystem.setRespawnAllowedResolver((playerId) => (
      this.worldLifecycle.activity.isActive()
        ? bridge.canPlayerRespawn(playerId)
        : hasWorldFigure(this.getWorldParticipation(playerId))
    ));
    this.ctx.combatSystem.setRespawnCallback((playerId) => {
      const survival = this.ctx.coopDefenseRespawnBudgetSystem;
      if (!survival) return true;
      const consumed = survival.consumeRespawn(playerId);
      if (consumed) bridge.publishCoopDefenseRespawnBudgetState(survival.getSnapshot());
      return consumed;
    });
    this.ctx.combatSystem.setAuthoritativePositionResetCallback((playerId, x, y) => {
      this.ctx.coopDefenseMissionProgressSystem?.resetPlayerPosition(playerId, x, y);
    });
    // Kampfhandlungen haengen an der Kampf-Capability, nicht an einer universellen Freigabe.
    this.ctx.combatSystem.setPlayerActionAllowedResolver(
      (playerId) => this.getPlayerCapabilities(playerId).canUseCombat,
    );
    this.ctx.combatSystem.setPlayerDamageReductionResolver((playerId) => {
      // Waffen- und Item-Reduktion addieren sich. Die Summe bleibt hier ungedeckelt; das
      // `CombatSystem` klemmt den fertigen Anteil auf [0,1], damit Schaden nicht negativ wird.
      const fromWeapon = this.ctx.loadoutManager?.getEquippedWeaponConfig(playerId, 'weapon1')?.damageReduction ?? 0;
      const fromItems = this.ctx.coopDefensePlayerModifierSystem?.getPercentageStat(playerId, 'player.damageReduction') ?? 0;
      // "Letzte Bastion" liest hier bewusst die HP **vor** dem Treffer: der Schlag, der unter die
      // Schwelle drueckt, wird noch nicht reduziert, erst der naechste.
      const conditional = this.ctx.coopDefenseItemRuntimeSystem?.getConditionalDamageReduction(playerId) ?? 0;
      const player = this.ctx.playerManager.getPlayer(playerId);
      const matrix = player
        ? this.ctx.reinforcementMatrixSystem?.getDamageReductionForFootprint(
          this.getTargetFootprint({ targetType: 'player', targetId: playerId })!,
          Date.now(),
          (field) => !bridge.isEnemyPair(field.ownerId, playerId),
        ) ?? 0
        : 0;
      return fromWeapon + fromItems + conditional + matrix;
    });
    this.ctx.combatSystem.setPlayerHpRegenPerSecondResolver((playerId) => {
      const base = this.ctx.coopDefensePlayerModifierSystem?.getHpRegenPerSecond(playerId) ?? 0;
      return base + (this.ctx.coopDefenseTeamBuffSystem?.getHpRegenBonus(
        Date.now(),
        bridge.canPlayerReceiveRoundRewards(playerId),
        this.ctx.combatSystem.isAlive(playerId),
      ) ?? 0);
    });
    this.ctx.combatSystem.setPlayerMaxArmorResolver((playerId) => {
      return this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.maxArmor', 100) ?? 100;
    });
    this.ctx.combatSystem.setPlayerArmorGainMultiplierResolver((playerId) => {
      return 1 + (this.ctx.coopDefensePlayerModifierSystem?.getPercentageStat(playerId, 'player.armorGain') ?? 0);
    });
    this.ctx.combatSystem.setPlayerArmorDamageGrantsRageResolver((playerId) => {
      return (this.ctx.coopDefensePlayerModifierSystem?.getNumericStat(playerId, 'ultimate.rageGainFromArmorDamage') ?? 0) > 0;
    });
    this.ctx.combatSystem.setPlayerLifeLeechFractionResolver((playerId) => {
      return (this.ctx.coopDefensePlayerModifierSystem?.getNumericStat(playerId, 'player.lifeLeechFraction') ?? 0)
        + (this.ctx.coopDefenseItemRuntimeSystem?.getConditionalLifeLeechBonus(playerId) ?? 0);
    });
    this.ctx.combatSystem.setPlayerArmorRegenPerSecondResolver((playerId) => {
      return this.ctx.coopDefensePlayerModifierSystem?.getNumericStat(playerId, 'player.armorRegenPerSecond') ?? 0;
    });
    this.ctx.combatSystem.setPlayerBonusArmorRegenPerSecondResolver((playerId) => {
      return this.ctx.coopDefenseItemRuntimeSystem?.getBonusArmorRegenPerSecond(playerId) ?? 0;
    });
    this.ctx.combatSystem.setPlayerOutgoingDamageResolver((attackerId, targetId, amount, allowCritical, sourceSlot) => {
      return this.ctx.coopDefensePlayerModifierSystem?.resolveOutgoingDamage(
        attackerId,
        targetId,
        amount,
        allowCritical,
        Math.random,
        // Blutrausch und Unversehrt haengen an den aktuellen HP des Angreifers, Kreuzfeuer am
        // Slot und einem laufenden Zeitfenster – alle drei koennen deshalb nicht im committeten
        // Stat-Bucket liegen.
        this.ctx.coopDefenseItemRuntimeSystem?.getConditionalOutgoingDamageBonus(attackerId, sourceSlot) ?? 0,
      ) ?? { amount, isCritical: false };
    });
    this.ctx.combatSystem.setEnemyIncomingDamageMultiplierResolver((enemyId) => {
      return this.ctx.coopDefenseItemRuntimeSystem?.getEnemyIncomingDamageMultiplier(enemyId) ?? 1;
    });
    this.ctx.combatSystem.setTargetIncomingDamageMultiplierResolver((target) => {
      const vulnerability = this.ctx.targetStatusSystem?.getIncomingDamageMultiplier(target) ?? 1;
      const footprint = this.getTargetFootprint(target);
      if (!footprint || target.targetType === 'enemy') return vulnerability;

      const matrixApplies = target.targetType === 'player'
        ? (field: { ownerId: string }) => !bridge.isEnemyPair(field.ownerId, target.targetId)
        : target.targetType === 'base'
          ? () => this.ctx.baseManager?.getBase(target.targetId)?.faction === 'friendly'
          : target.targetType === 'construction'
            ? (field: { ownerId: string }) => {
              const rock = this.ctx.placementSystem?.getRuntimeRock(Number(target.targetId));
              return Boolean(rock && !bridge.isEnemyPair(field.ownerId, rock.ownerId));
            }
            : target.targetType === 'rock' || target.targetType === 'wall'
              ? (field: { ownerId: string }) => {
                const rock = this.ctx.placementSystem?.getRuntimeRock(Number(target.targetId));
                return !rock || !bridge.isEnemyPair(field.ownerId, rock.ownerId);
              }
              : () => false;
      const matrixMultiplier = this.ctx.reinforcementMatrixSystem?.getDamageMultiplierForFootprint(
        footprint,
        Date.now(),
        matrixApplies,
      ) ?? 1;
      return vulnerability * matrixMultiplier;
    });
    this.ctx.combatSystem.setApplyVulnerabilityHandler((target, durationMs) => {
      this.ctx.targetStatusSystem?.applyVulnerability(target, durationMs);
    });
    this.ctx.combatSystem.setEnergyInjectorTargetHitCallback((targetType, targetId, x, y, projectile) => {
      if (targetType === 'player' && !bridge.isEnemyPair(projectile.ownerId, targetId)) return;
      this.hostUpdate.applyEnergyInjectorTargetHit(targetType, targetId, x, y, projectile);
    });
    this.ctx.combatSystem.setHitscanSupportImpactCallback((impact, effect, attackerId, sourceSlot) => {
      this.hostUpdate.applyHitscanSupportImpact(impact, effect, attackerId, sourceSlot);
    });
    this.ctx.combatSystem.setDirectPrimaryHitHandler((attackerId, enemyId, remainingHp, maxHp, isBoss) => {
      const runtime = this.ctx.coopDefenseItemRuntimeSystem;
      if (!runtime) return;

      const slow = runtime.rollDirectPrimaryHitEffects(attackerId, enemyId);
      if (slow.slowFraction > 0) {
        this.ctx.combatSystem.applyEnemySlow(enemyId, slow.slowFraction, slow.slowDurationMs);
      }

      if (runtime.rollCulling(attackerId, remainingHp, maxHp, isBoss)) {
        // Genau die Rest-HP als Schaden: der Tod laeuft dadurch ueber den regulaeren Pfad und
        // zaehlt als normaler Kill des Spielers. `skipLifeLeech` verhindert, dass der
        // Hinrichtungsschlag Leben zurueckgibt; eine Rekursion ist ausgeschlossen, weil der
        // Treffer-Handler nur bei ueberlebenden Gegnern feuert.
        this.ctx.combatSystem.applyDamage(
          enemyId,
          remainingHp,
          false,
          attackerId,
          'Hinrichtung',
          undefined,
          { damageKind: 'direct', sourceSlot: 'weapon1', allowCritical: false, skipLifeLeech: true },
        );
      }
    });
    this.ctx.combatSystem.setPlayerDamageTakenHandler((playerId, attackerId, hpLost, armorLost, damageKind) => {
      bridge.recordPlayerDamageTaken(playerId, hpLost, armorLost);
      const runtime = this.ctx.coopDefenseItemRuntimeSystem;
      if (!runtime) return;
      const result = runtime.handlePlayerDamageTaken(playerId, attackerId, hpLost, armorLost, damageKind);

      if (result.adrenalineGain > 0) this.ctx.resourceSystem?.addAdrenaline(playerId, result.adrenalineGain);
      if (result.reflectedDamage > 0 && result.reflectTargetId) {
        this.ctx.combatSystem.applyDamage(
          result.reflectTargetId,
          result.reflectedDamage,
          false,
          playerId,
          'Dornenplatten',
          undefined,
          { damageKind: 'reflect', allowCritical: false },
        );
      }
    });
    this.ctx.combatSystem.setDamageDealtHandler((targetType, targetId, attackerId, damage) => {
      if (!bridge.isHost() || !attackerId || attackerId === targetId || damage <= 0) return;
      if (!bridge.getPlayerProfile(attackerId)) return;

      if (targetType === 'enemy') {
        if (this.ctx.enemyManager?.getEnemy(targetId)?.faction !== 'hostile') return;
      } else if (
        isCoopMission
        || !bridge.isEnemyPair(attackerId, targetId)
      ) {
        return;
      }

      bridge.addPlayerRoomDamage(attackerId, damage);
    });
    this.ctx.combatSystem.setHealingReceivedHandler((playerId, amount) => {
      bridge.recordHealingReceived(playerId, amount);
    });
    this.ctx.combatSystem.setArmorReceivedHandler((playerId, amount) => {
      bridge.recordArmorReceived(playerId, amount);
    });
    this.ctx.guardianSpiritSystem = bridge.isHost() && this.ctx.enemyManager && this.ctx.coopDefensePlayerModifierSystem
      ? new GuardianSpiritSystem(
        this.ctx.playerManager,
        this.ctx.enemyManager,
        this.ctx.combatSystem,
        (playerId, stat, baseValue) => this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, stat, baseValue) ?? baseValue,
      )
      : null;
    this.ctx.repairDroneSystem = bridge.isHost() && this.ctx.coopDefensePlayerModifierSystem
      ? new RepairDroneSystem(
        this.ctx.playerManager,
        this.ctx.combatSystem,
        this.ctx.placementSystem!,
        (playerId) => {
          if (this.ctx.coopDefensePlayerModifierSystem?.getClassId(playerId) !== 'inspector_gadachs') {
            return false;
          }
          return (
            this.ctx.coopDefensePlayerModifierSystem
              .getCommittedProfile(playerId)
              ?.upgrades[COOP_DEFENSE_REPAIR_DRONE_UPGRADE_ID]
              ?.level ?? 0
          ) > 0;
        },
      )
      : null;
    this.ctx.slimeTrailSystem = bridge.isHost() && this.ctx.enemyManager && this.ctx.coopDefensePlayerModifierSystem
      ? new SlimeTrailSystem(
        this.ctx.playerManager,
        this.ctx.enemyManager,
        this.ctx.combatSystem,
        (playerId, stat, baseValue) => this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, stat, baseValue) ?? baseValue,
        (playerId) => {
          const input = bridge.getPlayerInput(playerId);
          return this.ctx.hostPhysics.getDashPhase(playerId) === 0
            && !(this.ctx.burrowSystem?.isBurrowed(playerId) ?? false)
            && Math.hypot(input?.dx ?? 0, input?.dy ?? 0) > 0.01;
        },
      )
      : null;
    this.ctx.projectileManager.setNaturalFlameExpiryCallback((projectile, x, y) => {
      this.ctx.flamethrowerUpgradeSystem?.handleNaturalFlameExpiry(projectile, x, y);
    });
    this.ctx.hostPhysics.setEnemyMovementFactorResolver((enemyId, now) => {
      const slimeFactor = this.ctx.slimeTrailSystem?.getEnemyMovementFactor(enemyId, now) ?? 1;
      const shotgunFactor = this.ctx.combatSystem.getEnemyMovementFactor(enemyId, now);
      return Math.min(slimeFactor, shotgunFactor);
    });
    this.ctx.combatSystem.setEnemyDeathCallback((enemyId, x, y, burnSources, death) => {
      const wasTimebomb = death ? (this.ctx.coopDefenseTimebombSystem?.handleKilled(death) ?? false) : false;
      if (wasTimebomb) {
        this.ctx.targetStatusSystem?.removeTarget({ targetType: 'enemy', targetId: enemyId });
        this.ctx.energyInjectorSystem?.removeTarget({ targetType: 'enemy', targetId: enemyId });
        this.ctx.coopDefenseItemRuntimeSystem?.removeEnemy(enemyId);
        return true;
      }
      this.ctx.flamethrowerUpgradeSystem?.handleEnemyDeath(x, y, burnSources);
      const burst = this.ctx.slimeTrailSystem?.handleEnemyDeath(enemyId, x, y, Date.now());
      if (burst) bridge.broadcastSlimeBloomEffect(burst.x, burst.y, burst.targets);
      if (death) this.ctx.necromancySystem?.recordEnemyDeath(death);
      // Sonst bliebe die Verwundbarkeit als Karteileiche stehen, bis ihre Dauer ablaeuft – und
      // eine wiederverwendete Gegner-ID erbte sie.
      this.ctx.targetStatusSystem?.removeTarget({ targetType: 'enemy', targetId: enemyId });
      this.ctx.energyInjectorSystem?.removeTarget({ targetType: 'enemy', targetId: enemyId });
      this.ctx.coopDefenseItemRuntimeSystem?.removeEnemy(enemyId);
      return false;
    });

    this.ctx.combatSystem.setRockDamageCallback((rockIndex, damage, attackerId) => {
      const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(rockIndex);
      const resolvedDamage = this.ctx.combatSystem.resolveExternalTargetDamage(
        {
          targetType: runtimeRock?.constructionId ? 'construction' : 'rock',
          targetId: String(rockIndex),
        },
        damage,
        attackerId,
      );
      const newHp = this.rockVisualHelper.applyObstacleDamageById(rockIndex, resolvedDamage, attackerId);
      if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(rockIndex, 'damage', attackerId);
    });
    // Ein Trichter fuer allen Basisschaden – dieselbe Verdrahtung wie bei Felsen und Zug, damit
    // Klassen- und Item-Multiplikatoren auch hier greifen.
    this.ctx.combatSystem.setBaseDamageCallback((baseId, damage, attackerId) => {
      const base = this.ctx.baseManager?.getBase(baseId);
      // Vor dem Schaden anrechnen: Der tödliche Treffer löst den Destroy-Callback noch in
      // applyDamage() aus, und der bucht die Bonus-XP bereits gegen diese Anrechnung. Der
      // Bonus gehört dem Team der laufenden Runde – ein Ziel, das nur Schaden von Spectators
      // oder Latejoinern erhält, bleibt Fortschritt, erzeugt aber keine XP.
      const objectiveId = base?.spec.dormantObjectiveId;
      if (objectiveId && bridge.canPlayerReceiveRoundRewards(attackerId)) {
        this.ctx.coopDefenseSecondaryObjectiveSystem?.reportTargetContribution(objectiveId, baseId);
      }
      base?.applyDamage(damage);
    });
    this.ctx.combatSystem.setTrainDamageCallback((damage, attackerId) => {
      const resolvedDamage = this.ctx.coopDefensePlayerModifierSystem?.resolveOutgoingDamage(
        attackerId,
        'train',
        damage,
        false,
      ).amount ?? damage;
      this.ctx.trainManager?.applyDamage(resolvedDamage, attackerId);
    });
    this.ctx.combatSystem.setProjectileImpactCallback((projectileId, x, y) => {
      const projectile = this.ctx.projectileManager.getProjectileById(projectileId);
      if (!projectile) return;
      this.spawnImpactCloudFromProjectile(projectile, x, y);
    });
    this.ctx.combatSystem.setPlayerImpulseCallback((playerId, vx, vy, durationMs, sourcePlayerId) => {
      this.ctx.hostPhysics.addRecoil(playerId, vx, vy, durationMs, sourcePlayerId);
    });
    this.ctx.combatSystem.setEnemyImpulseCallback((enemyId, vx, vy, durationMs, sourcePlayerId) => {
      this.ctx.hostPhysics.addRecoil(enemyId, vx, vy, durationMs, sourcePlayerId);
    });
    this.ctx.combatSystem.setDeathCallback((playerId, x, y) => {
      bridge.recordPlayerDeath(playerId);
      this.ctx.coopDefenseObjectivePlacementRewardSystem?.handlePlayerUnavailable(playerId);
      this.ctx.coopDefenseRespawnBudgetSystem?.handlePlayerDeath(playerId);
      if (this.ctx.coopDefenseRespawnBudgetSystem) {
        bridge.publishCoopDefenseRespawnBudgetState(this.ctx.coopDefenseRespawnBudgetSystem.getSnapshot());
      }
      this.ctx.flamethrowerUpgradeSystem?.handlePlayerDeath(playerId, x, y);
      this.ctx.captureTheBeerSystem?.dropBeerForPlayer(playerId, x, y);
      this.ctx.coopDefenseCarrySystem?.dropForPlayer(playerId, x, y);
      this.ctx.gameAudioSystem.playSound('sfx_player_death', x, y);
    });
    this.ctx.projectileManager.setProjectileImpactCallback((proj, x, y) => {
      this.spawnImpactCloudFromProjectile(proj, x, y);
    });
    this.ctx.hostPhysics.setRockGroup(
      this.ctx.arenaResult.rockGroup,
      this.ctx.arenaResult.trunkGroup,
    );
    this.ctx.hostPhysics.setBaseGroup(this.ctx.baseManager?.getBaseGroup() ?? null);
    this.ctx.hostPhysics.setWorldMetrics(world.metrics);
    this.ctx.hostPhysics.setMovementBlockedCellResolver((gridX, gridY) => {
      const arenaResult = this.ctx.arenaResult;
      const rockId = arenaResult?.rockGrid.getIndex(gridX, gridY) ?? -1;
      if (rockId >= 0 && arenaResult?.rockPhysicsProxies[rockId]?.active === true) return true;
      if (this.ctx.baseManager?.isMovementBlockedCell(gridX, gridY) === true) return true;
      return this.ctx.coopDefenseMissionBarrierManager?.isCellClosed(gridX, gridY) ?? false;
    });
    this.ctx.hostPhysics.setEnemyManager(this.ctx.enemyManager);
    this.ctx.hostPhysics.setRunSpeedResolver((playerId) => {
      const base = this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.runSpeed', PLAYER_SPEED) ?? PLAYER_SPEED;
      // "Unter Druck" und "Nachbrenner" sind zeit- bzw. HP-abhaengig und liegen deshalb nicht im
      // committeten Bucket. Der Wert wird pro Frame neu aufgeloest, ein Zeitbonus wirkt sofort.
      return base * (this.ctx.coopDefenseItemRuntimeSystem?.getRunSpeedMultiplier(playerId) ?? 1);
    });
    this.ctx.hostPhysics.setDashRangeMultiplierResolver((playerId) => {
      return 1 + (this.ctx.coopDefensePlayerModifierSystem?.getPercentageStat(playerId, 'player.dashRange') ?? 0);
    });
    this.ctx.hostPhysics.setDashRecoveryDurationResolver((playerId) => {
      return this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.dashRecovery', DASH_T2_S) ?? DASH_T2_S;
    });
    this.ctx.hostPhysics.setDashImpactDamageResolver((playerId) => this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.dashImpactDamage', 0) ?? 0);
    this.ctx.hostPhysics.setDashImpactKnockbackResolver((playerId) => this.ctx.coopDefensePlayerModifierSystem?.getNumericStat(playerId, 'player.dashImpactKnockback') ?? 0);
    this.ctx.hostPhysics.setDashGroundFireDurationResolver((playerId) => this.ctx.coopDefensePlayerModifierSystem?.getNumericStat(playerId, 'player.dashGroundFireDurationMs') ?? 0);
    this.ctx.hostPhysics.setDashGroundFireHandler((playerId, sourceKey, fromX, fromY, toX, toY, durationMs, now) => {
      this.ctx.fireSystem.hostRefreshGroundCellsAlongSegment(fromX, fromY, toX, toY, {
        sourceKey,
        ownerId: playerId,
        durationMs,
        burn: {
          durationMs: DASH_GROUND_FIRE_BURN_DURATION_MS,
          damagePerTick: DASH_GROUND_FIRE_DAMAGE_PER_TICK,
        },
        sourceId: 'ground_fire.dash_trail',
      }, now);
    });
    this.ctx.hostPhysics.setDashHoldEnabledResolver((playerId) => {
      return (this.ctx.coopDefensePlayerModifierSystem?.getNumericStat(playerId, 'player.dashHoldEnabled') ?? 0) > 0;
    });

    if (bridge.isHost()) {
      this.ctx.resourceSystem = new ResourceSystem();
      this.ctx.resourceSystem.setAdrenalineMaxResolver((playerId) => {
        return this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.maxAdrenaline', 100) ?? 100;
      });
      this.ctx.resourceSystem.setAdrenalineRegenRateResolver((playerId) => {
        const base = this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.adrenalineRegenRate', 10) ?? 10;
        // Kampfaufladung laeuft ueber die Regenerationsrate, nicht ueber den Regen-Multiplikator
        // des PowerUpSystems: dessen Pfad wuerde zusaetzlich die Regenerationspause nach
        // Adrenalinverbrauch unterdruecken.
        const itemMultiplier = this.ctx.coopDefenseItemRuntimeSystem?.getAdrenalineRegenMultiplier(playerId) ?? 1;
        const teamMultiplier = this.ctx.coopDefenseTeamBuffSystem?.getAdrenalineRegenMultiplier(
          Date.now(),
          bridge.canPlayerReceiveRoundRewards(playerId),
          this.ctx.combatSystem.isAlive(playerId),
        ) ?? 1;
        return base * itemMultiplier * teamMultiplier;
      });
      this.ctx.resourceSystem.setRageMaxResolver((playerId) => {
        return this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'ultimate.maxRage', 600) ?? 600;
      });
      this.ctx.resourceSystem.setRageGainMultiplierResolver((playerId) => {
        return 1 + (this.ctx.coopDefensePlayerModifierSystem?.getPercentageStat(playerId, 'ultimate.rageGainPerDamage') ?? 0);
      });
      this.ctx.resourceSystem.setAdrenalineGainMultiplierResolver((playerId) => {
        return 1 + (this.ctx.coopDefensePlayerModifierSystem?.getPercentageStat(playerId, 'player.adrenalineGain') ?? 0);
      });
      this.ctx.resourceSystem.setAdrenalineCostMultiplierResolver((playerId) => {
        return 1 + (this.ctx.coopDefensePlayerModifierSystem?.getPercentageStat(playerId, 'player.adrenalineCost') ?? 0);
      });
      this.ctx.resourceSystem.setAdrenalineSpawnFullResolver((playerId) => {
        return (this.ctx.coopDefensePlayerModifierSystem?.getNumericStat(playerId, 'player.adrenalineSpawnFull') ?? 0) > 0;
      });
      this.ctx.shieldBuffSystem = new ShieldBuffSystem();
      this.ctx.timeBubbleSystem = new TimeBubbleSystem();
      this.ctx.timeBubbleSystem.setFriendlyResolver((ownerId, subjectId) => !bridge.isEnemyPair(ownerId, subjectId));
      this.ctx.teslaDomeSystem = new TeslaDomeSystem(
        this.ctx.playerManager,
        this.ctx.combatSystem,
        this.ctx.resourceSystem,
      );
      this.ctx.energyShieldSystem = new EnergyShieldSystem(
        this.ctx.playerManager,
        this.ctx.resourceSystem,
        bridge,
        this.ctx.shieldBuffSystem,
      );
      this.ctx.turretSystem = new TurretSystem(
        this.ctx.playerManager,
        this.ctx.combatSystem,
      );
      this.ctx.teslaDomeSystem.setLineOfSightChecker((sx, sy, ex, ey, skipRockIndex) => {
        return this.ctx.combatSystem.hasLineOfSight(sx, sy, ex, ey, skipRockIndex);
      });
      this.ctx.turretSystem.setLineOfFireChecker((sx, sy, ex, ey, skipRockIndex, ignoreBaseObstacles) => {
        return this.ctx.combatSystem.hasClearLineOfFire(sx, sy, ex, ey, { skipRockIndex, ignoreBaseObstacles });
      });
      this.ctx.turretSystem.setTurretProvider(
        () => {
          const placeableTurrets = (this.ctx.placementSystem?.getAllRuntimeRocks() ?? [])
            .filter((rock) => rock.kind === 'turret')
            .map((rock) => ({
              id: rock.id,
              x: world.metrics.offsetX + rock.gridX * CELL_SIZE + CELL_SIZE / 2,
              y: world.metrics.offsetY + rock.gridY * CELL_SIZE + CELL_SIZE / 2,
              ownerId: rock.ownerId,
              ownerColor: rock.ownerColor,
              skipRockIndex: rock.id,
              secondProjectileDamageFactor: rock.secondProjectileDamageFactor,
              targetRange: rock.targetRange,
              muzzleOffset: rock.constructionId
                ? (() => {
                  const definition = getCoopDefenseConstructionDefinition(rock.constructionId!);
                  return definition.kind === 'turret' ? definition.muzzleOffset : undefined;
                })()
                : undefined,
              weaponId: rock.turretWeaponId ?? ('SPORES' as const),
            }));
          const baseTurrets = (this.ctx.baseManager?.getTurrets() ?? []).map((turret) => ({
            id: turret.id,
            x: turret.x,
            y: turret.y,
            ownerId: turret.faction === 'hostile'
              ? COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID
              : COOP_DEFENSE_BASE_TURRET_OWNER_ID,
            ownerColor: turret.faction === 'hostile' ? TEAM_RED_COLOR : TEAM_BLUE_COLOR,
            weaponId: turret.weaponId,
            ignoreBaseObstacles: true,
            targetMode: turret.faction === 'hostile' ? 'players' as const : 'enemies' as const,
          }));
          return [...placeableTurrets, ...baseTurrets];
        },
        (id: AutomatedTurretId, angle) => {
          if (typeof id === 'number') {
            this.ctx.placementSystem?.updateAngle(id, angle);
            this.rockVisualHelper.updateTurretAngle(id, angle);
          } else {
            this.ctx.baseManager?.setTurretAngle(id, angle);
          }
        },
      );
      this.ctx.turretSystem.setEnemyTargetProvider(
        () => (this.ctx.enemyManager?.getAllEnemies() ?? [])
          .filter(enemy => enemy.sprite.active)
          .map(enemy => ({ id: enemy.id, x: enemy.sprite.x, y: enemy.sprite.y })),
      );
      this.ctx.turretSystem.setFocusTargetProvider(
        (ownerId) => this.ctx.energyInjectorSystem?.getFocusTarget(ownerId) as { targetType: 'enemy' | 'base'; targetId: string } | null,
      );
      this.ctx.turretSystem.setFocusedBaseTargetProvider((targetId, turretX, turretY) => {
        const base = this.ctx.baseManager?.getBase(targetId);
        if (!base || base.faction !== 'hostile' || (base.isInert?.() ?? false) || base.getHp() <= 0) return null;
        const surface = base.getNearestSurfacePoint(turretX, turretY);
        return surface ? { id: base.id, x: surface.x, y: surface.y } : null;
      });
      this.ctx.teslaDomeSystem.setConstructionSourceProvider(
        () => {
          const turrets = this.ctx.turretSystem?.getTurrets() ?? [];
          return (this.ctx.placementSystem?.getAllRuntimeRocks() ?? [])
            .filter(rock => (
              rock.kind === 'turret'
              && rock.constructionId === 'tesla_turret'
              && rock.turretWeaponId === 'TURRET_TESLA'
              && rock.hp > 0
            ))
            .map(rock => {
              const x = world.metrics.offsetX + rock.gridX * CELL_SIZE + CELL_SIZE / 2;
              const y = world.metrics.offsetY + rock.gridY * CELL_SIZE + CELL_SIZE / 2;
              const injectorMultiplier = this.ctx.energyInjectorSystem?.getTurretDamageMultiplierAt(x, y) ?? 1;
              const turret = turrets.find(candidate => String(candidate.id) === String(rock.id));
              const remoteControlMultiplier = turret
                ? (this.ctx.coopDefenseItemRuntimeSystem?.getRemoteControlDamageMultiplier(
                  rock.ownerId,
                  turret,
                  turrets,
                ) ?? 1)
                : 1;
              return {
                id: rock.id,
                ownerId: rock.ownerId,
                x,
                y,
                color: rock.ownerColor,
                config: WEAPON_CONFIGS.TURRET_TESLA as WeaponConfig & { fire: TeslaDomeWeaponFireConfig },
                damageMultiplier: injectorMultiplier
                  * remoteControlMultiplier
                  * (this.ctx.loadoutManager?.getDamageMultiplier(rock.ownerId) ?? 1)
                  * (this.ctx.powerUpSystem?.getDamageMultiplier(rock.ownerId) ?? 1),
              };
            });
        },
      );
      // Der Konstrukteffekt ist ortsbezogen und wirkt dadurch auf platzierte Tuerme,
      // Fliegenpilze und Basistuerme gleichermassen. Die Matrix liefert hier bewusst
      // keinen Turm-Schadens- oder Feuerratenbuff.
      this.ctx.turretSystem.setTurretDamageBuffProvider((x, y) => {
        const damageMultiplier = this.ctx.energyInjectorSystem?.getTurretDamageMultiplierAt(x, y) ?? 1;
        return damageMultiplier > 1 ? { damageMultiplier } : null;
      });
      this.ctx.turretSystem.setTurretDamageMultiplierProvider((turret, turrets) => (
        this.ctx.coopDefenseItemRuntimeSystem?.getRemoteControlDamageMultiplier(
          turret.ownerId,
          turret,
          turrets,
        ) ?? 1
      ));
      this.ctx.teslaDomeSystem.setRockCallbacks(
        () => (this.ctx.arenaResult?.rockPhysicsProxies ?? [])
          .flatMap((rock, index) => (rock && rock.active)
            ? [{ index, x: rock.x, y: rock.y }]
            : []),
        (index, damage, ownerId) => this.hostUpdate.applyTeslaRockDamage(index, damage, ownerId),
      );
      this.ctx.teslaDomeSystem.setTurretCallbacks(
        () => (this.ctx.placementSystem?.getAllRuntimeRocks() ?? [])
          .filter(r => r.kind === 'turret')
          .map(r => ({
            id: r.id,
            x: world.metrics.offsetX + r.gridX * CELL_SIZE + CELL_SIZE / 2,
            y: world.metrics.offsetY + r.gridY * CELL_SIZE + CELL_SIZE / 2,
            ownerId: r.ownerId,
          })),
        (id, damage, ownerId) => this.hostUpdate.applyTeslaTurretDamage(id, damage, ownerId),
      );
      this.ctx.teslaDomeSystem.setEnemyTargetProvider(
        () => (this.ctx.enemyManager?.getAllEnemies() ?? [])
          .filter(enemy => enemy.sprite.active)
          .map(enemy => ({ id: enemy.id, x: enemy.sprite.x, y: enemy.sprite.y })),
      );
      this.ctx.teslaDomeSystem.setBaseCallbacks(
        () => this.ctx.baseManager?.getBasesByFaction('hostile') ?? [],
        (baseId, damage, ownerId, sourceSlot) => this.ctx.combatSystem.applyBaseDamage(baseId, damage, ownerId, sourceSlot),
      );
      this.ctx.teslaDomeSystem.setEnergyShieldSystem(this.ctx.energyShieldSystem);
      this.ctx.teslaDomeSystem.setTrainCallbacks(
        () => this.ctx.trainManager?.getNetSnapshot()?.alive ? this.ctx.trainManager.getSegmentPositions() : [],
        (damage, ownerId) => this.ctx.trainManager?.applyDamage(damage, ownerId),
      );
      // Gewitterentladung: reguläre Projektile über die bestehende Projektil-/Homing-Infrastruktur.
      this.ctx.teslaDomeSystem.setStormProjectileSpawner((request) => {
        const lifetimeMs = request.speed > 0 ? (request.rangePx / request.speed) * 1000 : 0;
        this.ctx.projectileManager.spawnProjectile(request.x, request.y, request.angle, request.ownerId, {
          speed: request.speed,
          size: request.size,
          damage: request.damage,
          color: request.color,
          ownerColor: request.color,
          lifetime: lifetimeMs,
          remainingRangePx: request.rangePx,
          maxBounces: 0,
          isGrenade: false,
          adrenalinGain: 0,
          sourceId: request.weaponId,
          projectileStyle: 'tesla_bolt',
          piercesTargets: true,
          homing: request.homing,
          // Felsen bleiben Weltblocker und sind kein Ziel der Gewitterentladung.
          rockDamageMult: 0,
          sourceSlot: request.sourceSlot,
          suppressSpawnFx: true,
        });
      });
      // Blitznova: kein Schaden, nur Slow auf Gegner und Rückstoß auf jede getroffene Entität.
      this.ctx.teslaDomeSystem.setNovaHitHandler((hit) => {
        if (hit.type === 'enemies' && hit.slowFraction > 0 && hit.slowDurationMs > 0) {
          this.ctx.combatSystem.applyEnemySlow(hit.targetId, hit.slowFraction, hit.slowDurationMs);
        }
        if (hit.knockback <= 0) return;
        if (hit.type !== 'enemies' && hit.type !== 'players') return;
        const dome = this.ctx.playerManager.getPlayer(hit.ownerId);
        const dirX = hit.x - (dome?.x ?? hit.x);
        const dirY = hit.y - (dome?.y ?? hit.y);
        const length = Math.hypot(dirX, dirY);
        const nx = length > 0.001 ? dirX / length : 0;
        const ny = length > 0.001 ? dirY / length : -1;
        this.ctx.hostPhysics.addRecoil(hit.targetId, nx * hit.knockback, ny * hit.knockback, 260, hit.ownerId);
      });
      this.ctx.burrowSystem = new BurrowSystem(
        this.ctx.resourceSystem,
        this.ctx.playerManager,
        this.ctx.combatSystem,
        this.ctx.hostPhysics,
        bridge,
      );
      this.ctx.burrowSystem.setUndergroundSpeedResolver((playerId) => {
        return this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.burrowSpeed', 1.3) ?? 1.3;
      });
      this.ctx.burrowSystem.setDrainMultiplierResolver((playerId) => {
        return 1 + (this.ctx.coopDefensePlayerModifierSystem?.getPercentageStat(playerId, 'player.burrowCost') ?? 0);
      });
      this.ctx.burrowSystem.setShockwaveDamageResolver((playerId) => {
        return this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.unburrowShockwaveDamage', SHOCKWAVE_DAMAGE) ?? SHOCKWAVE_DAMAGE;
      });
      this.ctx.burrowSystem.setShockwaveRadiusResolver((playerId) => {
        return this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.unburrowShockwaveRadius', SHOCKWAVE_RADIUS) ?? SHOCKWAVE_RADIUS;
      });
      this.ctx.burrowSystem.setGroups(
        this.ctx.arenaResult.rockGroup,
        this.ctx.arenaResult.trunkGroup,
        this.ctx.baseManager?.getBaseGroup() ?? null,
      );
      this.ctx.burrowSystem.setBurrowStartCallback((playerId) => {
        this.ctx.captureTheBeerSystem?.dropBeerForPlayer(playerId);
      });

      this.ctx.loadoutManager = new LoadoutManager(
        this.ctx.playerManager,
        this.ctx.projectileManager,
        this.ctx.resourceSystem,
        bridge,
      );
      this.ctx.flamethrowerUpgradeSystem = this.ctx.enemyManager
        && this.ctx.coopDefensePlayerModifierSystem
        ? new FlamethrowerUpgradeSystem(
          this.ctx.playerManager,
          this.ctx.enemyManager,
          this.ctx.projectileManager,
          this.ctx.combatSystem,
          this.ctx.loadoutManager,
          this.ctx.fireSystem,
          (playerId) => this.ctx.burrowSystem?.isBurrowed(playerId) ?? false,
          (firstPlayerId, secondPlayerId) => !bridge.isEnemyPair(firstPlayerId, secondPlayerId),
          (x, y, radius) => bridge.broadcastExplosionEffect(x, y, radius, 0xff6600),
          (playerId, stat, baseValue) => this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, stat, baseValue) ?? baseValue,
          (x, y, targets, landsAt, visualStyle) => bridge.broadcastFireChunkEffect(
            x,
            y,
            targets,
            landsAt,
            visualStyle,
          ),
        )
        : null;
      this.ctx.weaponUpgradeSystem = this.ctx.enemyManager
        ? new WeaponUpgradeSystem(
          this.ctx.projectileManager,
          this.ctx.enemyManager,
          this.ctx.combatSystem,
          this.ctx.hostPhysics,
          this.ctx.fireSystem,
        )
        : null;
      this.ctx.ak47StrategicTargetSystem = this.ctx.enemyManager
        ? new Ak47StrategicTargetSystem(
          this.ctx.playerManager,
          this.ctx.enemyManager,
          this.ctx.combatSystem,
          this.ctx.loadoutManager,
        )
        : null;
      this.ctx.loadoutManager.setAk47StrategicTargetHitResolver((playerId, enemyId) => (
        this.ctx.ak47StrategicTargetSystem?.isCurrentTarget(playerId, enemyId) ?? false
      ));
      this.ctx.combatSystem.setAk47DirectEnemyHitHandler((projectile, enemyId) => (
        this.ctx.ak47StrategicTargetSystem?.handleDirectAk47EnemyHit(projectile, enemyId) ?? null
      ));
      this.ctx.loadoutManager.setNegevKillstreakExplosionHandler((event) => {
        bridge.broadcastExplosionEffect(event.x, event.y, event.radius, 0xff8a2d);
        this.ctx.flamethrowerUpgradeSystem?.hostCreateFireChunkBurst(
          event.ownerId,
          event.x,
          event.y,
          {
            count: event.kills,
            searchRadius: event.radius,
            flightMs: 320,
            igniteCenter: false,
            durationMs: event.fireChunkDurationMs,
            burnDurationMs: event.fireChunkBurnDurationMs,
            burnDamagePerTick: event.fireChunkBurnDamagePerTick,
            sourceId: 'weapon.NEGEV.killstreak',
          },
          `negev-killstreak:${event.ownerId}:${Date.now()}`,
        );
      });
      this.ctx.necromancySystem = this.ctx.enemyManager
        && this.ctx.coopDefensePlayerModifierSystem
        ? new NecromancySystem(
          this.ctx.playerManager,
          this.ctx.enemyManager,
          this.ctx.combatSystem,
          this.ctx.loadoutManager,
          this.ctx.allyFlowFieldServices,
          (playerId, stat, baseValue) => this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, stat, baseValue) ?? baseValue,
        )
        : null;
      if (this.ctx.necromancySystem) {
        // Leichen-Marker laufen ueber denselben Weg wie andere Host-Effekte: lokal ueber den
        // Broadcast-Loopback, damit Host und Clients dieselbe Darstellung zeigen.
        this.ctx.necromancySystem.setCorpseSink({
          onCorpseAdded: (corpseId, x, y, enemySize, lifetimeMs) => {
            bridge.broadcastCorpseMarker(corpseId, x, y, enemySize, lifetimeMs);
          },
          onCorpseRemoved: (corpseId) => bridge.broadcastCorpseMarkerRemoval(corpseId),
        });
        this.ctx.enemyManager?.setLethalDamageGuard(
          (enemy) => this.ctx.necromancySystem?.handleLethalDamage(enemy) ?? false,
        );
      }
      this.ctx.projectileManager.setProjectileResolvedCallback((projectile) => {
        this.ctx.loadoutManager?.resolveAk47Projectile(projectile);
      });
      this.ctx.projectileManager.setMiniRocketCollectedCallback((projectile, x, y) => {
        const refund = Math.max(0, projectile.miniRocketAdrenalineCostPaid ?? 0)
          * Math.max(0, projectile.miniRocketPickupAdrenalineRefundFraction ?? 0);
        const armor = Math.max(0, projectile.miniRocketPickupArmor ?? 0);
        if (refund > 0) this.ctx.resourceSystem?.refundAdrenaline(projectile.ownerId, refund);
        if (armor > 0) this.ctx.combatSystem.addArmor(projectile.ownerId, armor);
        bridge.broadcastMiniRocketCollectionEffect(x, y, projectile.ownerColor ?? projectile.color);
      });
      this.ctx.projectileManager.setMiniRocketDestroyedCallback((projectile, x, y) => {
        bridge.broadcastMiniRocketDestructionEffect(x, y, projectile.ownerColor ?? projectile.color);
      });
      this.ctx.loadoutManager.setUtilityConfigModifierSource((playerId) => {
        const modifiers = this.ctx.coopDefensePlayerModifierSystem?.getModifiers(playerId);
        return modifiers
          ? { additive: modifiers.additiveStats, percentage: modifiers.percentageStats }
          : null;
      });
      this.ctx.loadoutManager.setItemRuntimeChargeConsumer((playerId) => {
        return this.ctx.coopDefenseItemRuntimeSystem?.consumeMovementCharge(playerId) ?? 0;
      });
      this.ctx.loadoutManager.setItemRuntimeWeaponFiredHandler((playerId, sourceSlot) => {
        this.ctx.coopDefenseItemRuntimeSystem?.registerWeaponFired(playerId, sourceSlot);
      });
      this.ctx.decoySystem.setCombatStateReader(this.ctx.combatSystem);
      this.ctx.decoySystem.setRunSpeedResolver((playerId) => {
        const runSpeed = this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.runSpeed', PLAYER_SPEED) ?? PLAYER_SPEED;
        return runSpeed * (this.ctx.loadoutManager?.getSpeedMultiplier(playerId) ?? 1);
      });
      this.ctx.decoySystem.setCooldownStarter((playerId, utilityId, when) => {
        this.ctx.loadoutManager?.beginUtilityCooldown(playerId, utilityId, when);
      });
      this.ctx.decoySystem.setExplosionCallback((ownerId, x, y, radius, damage, knockback) => {
        this.ctx.combatSystem.applyAoeDamage(x, y, radius, damage, ownerId, false, { category: 'explosion', allowTeamDamage: false, sourceId: 'environment.decoy_explosion', sourceSlot: 'utility' });
        this.ctx.hostPhysics.applyRadialImpulse(x, y, radius, knockback, ownerId, 0);
        bridge.broadcastExplosionEffect(x, y, radius);
      });

      this.ctx.translocatorSystem = new TranslocatorSystem(
        this.ctx.playerManager,
        this.ctx.projectileManager,
        this.ctx.combatSystem,
        null,
      );
      this.ctx.translocatorSystem.setUseCallback((playerId) => {
        this.ctx.captureTheBeerSystem?.dropBeerForPlayer(playerId);
      });
      this.ctx.translocatorSystem.setRadialImpulseCallback((x, y, radius, knockback, ownerId) => {
        this.ctx.hostPhysics.applyRadialImpulse(x, y, radius, knockback, ownerId, 0);
      });
      this.ctx.translocatorSystem.setPositionResetCallback((playerId, x, y) => {
        this.ctx.coopDefenseMissionProgressSystem?.resetPlayerPosition(playerId, x, y);
      });

      this.ctx.loadoutManager.setCombatSystem(this.ctx.combatSystem);
      this.ctx.loadoutManager.setDashBurstChecker(id => this.ctx.hostPhysics.isDashBurst(id));
      this.ctx.loadoutManager.setPhysicsSystem(this.ctx.hostPhysics);
      this.ctx.loadoutManager.setTeslaDomeSystem(this.ctx.teslaDomeSystem);
      this.ctx.loadoutManager.setEnergyShieldSystem(this.ctx.energyShieldSystem);
      this.ctx.loadoutManager.setShieldBuffSystem(this.ctx.shieldBuffSystem);
      this.ctx.loadoutManager.setTranslocatorSystem(this.ctx.translocatorSystem);
      this.ctx.loadoutManager.setDecoySystem(this.ctx.decoySystem);
      this.ctx.loadoutManager.setUtilityUsedCallback((playerId, utilityType) => {
        if (utilityType === 'decoy') {
          this.ctx.captureTheBeerSystem?.dropBeerForPlayer(playerId);
          const player = this.ctx.playerManager.getPlayer(playerId);
          if (player) this.ctx.gameAudioSystem.playSound('sfx_place_decoy', player.x, player.y, playerId);
        }
      });
      this.ctx.loadoutManager.setUtilityUsedObserver((playerId, utilityType) => {
        bridge.recordUtilityUsed(playerId);
        if (utilityType === 'placeable_rock' || utilityType === 'placeable_turret' || utilityType === 'placeable_pedestal') {
          bridge.recordConstructionBuilt(playerId);
        }
      });
      this.ctx.loadoutManager.setUltimateUsedObserver((playerId) => {
        bridge.recordUltimateUsed(playerId);
      });
      this.ctx.turretSystem.setFireHandler((ownerId, color, weaponId, x, y, angle, targetX, targetY, damageFactor = 1, rangeFactor = 1, sourceTurretId, skipRockIndex) => {
        const turretCfg = UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig;
        const weapon    = WEAPON_CONFIGS[weaponId] ?? WEAPON_CONFIGS[turretCfg.weaponId as keyof typeof WEAPON_CONFIGS];
        const isFriendlyBaseTurret = ownerId === COOP_DEFENSE_BASE_TURRET_OWNER_ID;
        const isHostileBaseTurret = ownerId === COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID;
        const isBaseTurret = isFriendlyBaseTurret || isHostileBaseTurret;
        const ownerRuntimeDamageMultiplier = isBaseTurret
          ? 1
          : (this.ctx.loadoutManager?.getDamageMultiplier(ownerId) ?? 1)
            * (this.ctx.powerUpSystem?.getDamageMultiplier(ownerId) ?? 1);
        const fire = isBaseTurret && weapon.fire.type === 'projectile'
          ? {
            ...weapon.fire,
            homing: weapon.fire.homing
              ? {
                ...weapon.fire.homing,
                targetTypes: isHostileBaseTurret ? ['players'] as const : ['enemies'] as const,
              }
              : undefined,
          }
          : weapon.fire;
        this.ctx.loadoutManager?.fireAutomatedWeapon(
          { ...weapon, fire, range: weapon.range * rangeFactor },
          x,
          y,
          angle,
          targetX,
          targetY,
          ownerId,
          color,
          {
            ignoreBaseCollisions: isBaseTurret,
            ignoreRockIndex: skipRockIndex,
            // Spielerbauten bleiben ihrem Besitzer zugerechnet und laufen als Utility-Schaden
            // durch denselben ausgehenden Modifier-/Krit-Pfad wie dessen eigene Treffer.
            sourceSlot: isBaseTurret ? undefined : 'utility',
            sourceTurretId: sourceTurretId === undefined ? undefined : String(sourceTurretId),
            directDamageMultiplier: damageFactor,
            // Explosionen, Brand und Schadenswolken laufen nicht durch computeProjectileDamage;
            // ihr Besitzer-/Power-up-Faktor wird deshalb beim Turmschuss eingefroren.
            payloadDamageMultiplier: damageFactor * ownerRuntimeDamageMultiplier,
          },
        );
      });
      if (this.ctx.enemyManager && this.ctx.baseManager) {
        this.ctx.coopDefenseEnemyTrainAwarenessSystem = new CoopDefenseEnemyTrainAwarenessSystem(
          () => this.ctx.trainManager,
          () => bridge.getTrainEvent(),
          (enemy, now) => enemy.getMoveSpeed()
            * this.ctx.hostPhysics.getWorldMovementFactorAt(enemy.sprite.x, enemy.sprite.y, now),
        );
        this.ctx.coopDefenseEnemyBurrowSystem = new CoopDefenseEnemyBurrowSystem(
          this.ctx.enemyManager,
          (enemyId, enabled) => this.ctx.hostPhysics.setEnemyBurrowed(enemyId, !enabled),
          (x, y, radius) => this.isSafeEnemyGroundAt(x, y, radius),
          (x, y, radius, maxRadiusCells) => this.findSafeEnemyGroundPosition(x, y, radius, maxRadiusCells),
        );
        this.ctx.coopDefenseEnemyTrainAwarenessSystem.setBurrowSource(this.ctx.coopDefenseEnemyBurrowSystem);
        this.ctx.enemyManager.setEnemySpawnedCallback((enemy, options) => {
          this.ctx.coopDefenseEnemyBurrowSystem?.notifyEnemySpawned(enemy, options);
        });
        this.ctx.coopDefenseEnemyDodgeSystem = new CoopDefenseEnemyDodgeSystem(
          this.ctx.enemyManager,
          this.ctx.playerManager,
          this.ctx.projectileManager,
          this.ctx.combatSystem,
          this.ctx.hostPhysics,
          (x, y, radius) => this.isFreeEnemyGroundAt(x, y, radius),
          (fromX, fromY, toX, toY, radius) => this.hasWalkableEnemyCircleLine(fromX, fromY, toX, toY, radius),
        );
        this.ctx.coopDefenseEnemyCombatPositioningSystem = new CoopDefenseEnemyCombatPositioningSystem(
          this.ctx.enemyManager,
          this.ctx.playerManager,
          this.ctx.combatSystem,
          (x, y, radius) => this.isFreeEnemyGroundAt(x, y, radius),
          (fromX, fromY, toX, toY, radius) => this.hasWalkableEnemyCircleLine(fromX, fromY, toX, toY, radius),
          this.ctx.enemyAiTargetCatalog,
        );
        this.ctx.coopDefenseEnemyAbilitySystem = new CoopDefenseEnemyAbilitySystem(
          this.ctx.enemyManager,
          this.ctx.playerManager,
          this.ctx.projectileManager,
          this.ctx.combatSystem,
          this.ctx.energyShieldSystem,
          this.ctx.stinkCloudSystem,
          this.ctx.flamethrowerUpgradeSystem,
          this.ctx.fireSystem,
          this.ctx.enemyAiTargetCatalog,
          this.ctx.decoySystem,
        );
        this.ctx.coopDefenseEnemyAttackSystem = new CoopDefenseEnemyAttackSystem(
          this.ctx.enemyManager,
          this.ctx.playerManager,
          this.ctx.baseManager,
          this.ctx.combatSystem,
          this.ctx.loadoutManager,
          () => this.ctx.arenaResult?.rockPhysicsProxies ?? null,
          this.ctx.coopDefenseEnemyTrainAwarenessSystem,
          this.ctx.placementSystem,
          this.ctx.enemyAiTargetCatalog,
        );
        this.ctx.hostPhysics.setEnemyRockContactCallback((enemyId, rock, now) => {
          this.ctx.coopDefenseEnemyAttackSystem?.recordObstacleContact(enemyId, rock, now);
        });
      }
      this.ctx.loadoutManager.setPlaceableRockHandler((cfg, playerId, x, y, targetX, targetY, now, playerColor) => {
        return this.placePlaceableRock(cfg, playerId, x, y, targetX, targetY, now, playerColor);
      });
      this.ctx.tunnelSystem = new TunnelSystem(
        this.ctx.playerManager,
        this.ctx.combatSystem,
        this.ctx.placementSystem,
        this.ctx.burrowSystem,
        this.ctx.hostPhysics,
      );
      this.ctx.tunnelSystem.setTunnelEnterCallback((playerId, x, y) => {
        this.ctx.captureTheBeerSystem?.dropBeerForPlayer(playerId, x, y);
        this.ctx.gameAudioSystem.playSound('sfx_use_dachstunnel', x, y, playerId);
      });
      this.ctx.tunnelSystem.setPositionResetCallback((playerId, x, y) => {
        this.ctx.coopDefenseMissionProgressSystem?.resetPlayerPosition(playerId, x, y);
      });
      this.ctx.burrowSystem.setTunnelTransitEndedCallback((playerId) => {
        this.ctx.tunnelSystem?.notifyTransitEnded(playerId);
      });
      this.ctx.loadoutManager.setTunnelPlacementHandler((cfg, playerId, x, y, targetX, targetY, playerColor, params) => {
        return this.placeTunnel(cfg, playerId, x, y, targetX, targetY, playerColor, params);
      });
      this.ctx.loadoutManager.setActionBlockedChecker((playerId, slot) => {
        if (!this.getPlayerCapabilities(playerId).canInteract) return true;
        if (!this.ctx.combatSystem.isAlive(playerId)) return true;
        if (slot === 'weapon1' || slot === 'weapon2') {
          if (this.ctx.burrowSystem?.isWeaponBlocked(playerId)) return true;
        }
        if (slot === 'utility' || slot === 'ultimate') {
          if (this.ctx.burrowSystem?.isUtilityBlocked(playerId)) return true;
        }
        return false;
      });
      this.ctx.loadoutManager.setNukeStrikeHandler((playerId, targetX, targetY) => {
        return this.ctx.powerUpSystem?.scheduleNukeStrike(playerId, targetX, targetY) ?? false;
      });
      this.ctx.combatSystem.setBurrowSystem(this.ctx.burrowSystem);
      this.ctx.combatSystem.setResourceSystem(this.ctx.resourceSystem);
      this.ctx.combatSystem.setLoadoutManager(this.ctx.loadoutManager);
      this.ctx.combatSystem.setEnergyShieldSystem(this.ctx.energyShieldSystem);
      this.ctx.energyShieldSystem?.setCombatSystem(this.ctx.combatSystem);
      this.ctx.energyShieldSystem?.setEnemyManager(this.ctx.enemyManager);
      this.ctx.energyShieldSystem?.setBaseManager(this.ctx.baseManager);
      this.ctx.energyShieldSystem?.setWeaponUsageBlockedChecker((playerId) => {
        if (!this.ctx.combatSystem.isAlive(playerId)) return true;
        if (this.ctx.burrowSystem?.isWeaponBlocked(playerId)) return true;
        if (this.ctx.hostPhysics?.isDashBurst(playerId)) return true;
        return false;
      });
      this.ctx.combatSystem.setDecoySystem(this.ctx.decoySystem);

      this.ctx.powerUpSystem = new PowerUpSystem(this.ctx.playerManager, this.ctx.combatSystem, layout, {
        onPickupCollected: (playerId) => bridge.recordPowerUpCollected(playerId),
        onNukePickup: (playerId) => {
          return this.ctx.loadoutManager?.overrideUtility(playerId, UTILITY_CONFIGS.NUKE, 1) ?? false;
        },
        onNukeExploded: (x, y, radius, triggeredBy) => {
          this.runtimeDiagnosticEventSink?.('nuke:explode', { variant: 'standard', radius, triggeredBy });
          bridge.broadcastExplosionEffect(x, y, radius, 0xffd26a, 'nuke');
          this.hostUpdate.applyNukeEnvironmentDamage(x, y, radius, triggeredBy);
        },
        onConfiguredNukeExploded: (strike) => {
          if (strike.variant !== 'void') return;
          this.runtimeDiagnosticEventSink?.('nuke:explode', {
            variant: strike.variant,
            radius: strike.radius,
            triggeredBy: strike.triggeredBy,
          });
          bridge.broadcastExplosionEffect(strike.x, strike.y, strike.radius, 0xa631ff, 'void_nuke');
          this.ctx.coopDefenseVoidHunterSystem?.notifyNukeExploded(strike);
        },
        onHolyHandGrenadePickup: (playerId) => {
          return this.ctx.loadoutManager?.overrideUtility(playerId, UTILITY_CONFIGS.HOLY_HAND_GRENADE, 1) ?? false;
        },
        onBfgPickup: (playerId) => {
          return this.ctx.loadoutManager?.overrideUtility(playerId, UTILITY_CONFIGS.BFG, 1) ?? false;
        },
        onObjectiveRewardPickup: (objectiveId, playerId) => (
          this.ctx.coopDefenseObjectivePlacementRewardSystem?.claim(objectiveId, playerId) ?? false
        ),
        coopDefenseMapXpReference: missionMapConfig
          ? getCoopDefenseMapXpReference(
            missionMapConfig,
            coopDefensePersistentSpawnConfigs,
            coopDefenseHumanPlayerCount,
          )
          : 1,
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
      }, world.metrics);
      this.ctx.powerUpSystem.setConstructionRespawnMultiplierProvider((constructionId) => {
        const rock = this.ctx.placementSystem?.getRuntimeRock(constructionId);
        if (!rock) return 1;
        const world = this.rockVisualHelper.gridToWorld(rock.gridX, rock.gridY);
        return this.ctx.energyInjectorSystem?.getPowerUpRespawnMultiplierAt(world.x, world.y) ?? 1;
      });
      this.ctx.powerUpSystem.setArenaStartTime(bridge.getArenaStartTime());
      this.ctx.combatSystem.setPowerUpSystem(this.ctx.powerUpSystem);
      this.ctx.resourceSystem.setPowerUpSystem(this.ctx.powerUpSystem);

      this.ctx.detonationSystem = new DetonationSystem(this.ctx.projectileManager);
      this.ctx.combatSystem.setDetonationSystem(this.ctx.detonationSystem);

      this.ctx.armageddonSystem = new ArmageddonSystem(world.metrics);
      this.ctx.armageddonSystem.setRockGrid(this.ctx.arenaResult.rockGrid);
      this.ctx.loadoutManager.setArmageddonSystem(this.ctx.armageddonSystem);
      if (
        this.ctx.enemyManager
        && this.ctx.baseManager
        && this.ctx.placementSystem
        && this.ctx.enemyStrategicTargetService
        && this.ctx.enemyStrategicFlowFieldService
      ) {
        this.ctx.coopDefenseTimebombSystem = new CoopDefenseTimebombSystem(
          this.ctx.enemyManager,
          this.ctx.playerManager,
          this.ctx.baseManager,
          this.ctx.placementSystem,
          this.ctx.combatSystem,
          this.ctx.enemyStrategicTargetService,
          this.ctx.enemyStrategicFlowFieldService,
          this.ctx.flamethrowerUpgradeSystem,
          {
            playExplosion: (x, y, radius, style) => {
              bridge.broadcastExplosionEffect(x, y, radius, 0xb82fff, style);
            },
            applyRadialImpulse: (x, y, radius, force, ownerId) => {
              this.ctx.hostPhysics.applyRadialImpulse(x, y, radius, force, ownerId, 0);
            },
            damageConstruction: (id, damage, attackerId) => {
              const resolvedDamage = this.resolveObstacleDamage(id, damage, attackerId);
              if (resolvedDamage <= 0) return;
              const hp = this.rockVisualHelper.applyObstacleDamageById(id, resolvedDamage, attackerId);
              if (hp <= 0) this.rockVisualHelper.handleDestroyedRock(id, 'damage', attackerId);
            },
            onSelfDetonated: (enemyId) => {
              this.ctx.coopDefenseItemRuntimeSystem?.removeEnemy(enemyId);
            },
            // Zentrale Vorbereitung fuer spaetere Zuordnungen. Die Detonation selbst verwendet
            // bereits den vorhandenen Explosionssound ueber den Effekt-RPC.
            sound: (_event) => { /* intentionally unmapped */ },
          },
          this.ctx.decoySystem,
        );
      }
      if (
        this.ctx.enemyManager
        && this.ctx.coopDefenseEnemyBurrowSystem
        && this.ctx.flamethrowerUpgradeSystem
      ) {
        this.ctx.coopDefenseVoidHunterSystem = new CoopDefenseVoidHunterSystem(
          this.ctx.enemyManager,
          this.ctx.playerManager,
          this.ctx.combatSystem,
          this.ctx.loadoutManager,
          this.ctx.powerUpSystem,
          this.ctx.armageddonSystem,
          this.ctx.coopDefenseEnemyBurrowSystem,
          this.ctx.flamethrowerUpgradeSystem,
          this.ctx.enemyAiTargetCatalog,
          (phase: number) => this.runtimeDiagnosticEventSink?.('boss:phase', { phase }),
          world.metrics,
        );
      }
      this.ctx.coopDefenseEnemyAttackSystem?.setActionBlockedChecker((enemyId) => (
        (this.ctx.coopDefenseVoidHunterSystem?.blocksRegularAttacks(enemyId) ?? false)
        || (this.ctx.coopDefenseTimebombSystem?.blocksRegularBehavior(enemyId) ?? false)
        || (this.ctx.coopDefenseEnemyAbilitySystem?.blocksRegularAttacks(enemyId) ?? false)
      ));

      this.ctx.airstrikeSystem = new AirstrikeSystem();
      this.ctx.airstrikeSystem.setExplodedCallback((x, y, radius, triggeredBy, cfg) => {
        this.runtimeDiagnosticEventSink?.('airstrike:explode', { radius, triggeredBy, delayMs: cfg.delayMs });
        bridge.broadcastExplosionEffect(x, y, radius, 0xff9933, 'nuke');
        this.hostUpdate.applyAirstrikeEnvironmentDamage(x, y, radius, cfg, triggeredBy);
      });
      const coopDefenseAirstrikeEventHandler = isCoopMission && missionMapConfig
        ? new CoopDefenseAirstrikeEventHandler({
          scheduleStrike: (x, y, cfg, metadata) => this.ctx.airstrikeSystem?.scheduleStrike(
            COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID,
            x,
            y,
            cfg,
            metadata,
          ) ?? false,
          getAlivePlayerPositions: () => this.ctx.playerManager.getAllPlayers()
            .filter((player) => this.ctx.combatSystem.isAlive(player.id))
            .map((player) => ({ x: player.x, y: player.y })),
          isProtectedBasePoint: (x, y) => isPointNearBaseRegion(
            x,
            y,
            coopDefenseBases.map((base) => getBaseWorldBounds(base.region, world.metrics)),
          ),
          playStrikeAudio: (x, y) => {
            this.ctx.gameAudioSystem.playSound('sfx_airstrike_countdown', x, y);
          },
          arenaWidthCells: world.metrics.gridCols,
          arenaHeightCells: world.metrics.gridRows,
          worldMetrics: world.metrics,
          tutorialShowControls: missionMapConfig.tutorialShowControls,
        })
        : null;
      const coopDefenseGroundHazardEventHandler = isCoopMission && missionMapConfig
        ? new CoopDefenseGroundHazardEventHandler({
          fireSystem: this.ctx.fireSystem,
          prebuiltZones: layout.groundHazardZones ?? [],
          getNowMs: () => Date.now(),
          worldMetrics: world.metrics,
        })
        : null;
      this.ctx.airstrikeSystem.setResolvedCallback((resolution) => {
        coopDefenseAirstrikeEventHandler?.handleStrikeResolved(resolution);
      });
      this.ctx.loadoutManager.setAirstrikeHandler((playerId, targetX, targetY, cfg) => {
        const player = this.ctx.playerManager.getPlayer(playerId);
        if (!player || !this.ctx.combatSystem.isAlive(playerId)) return false;
        this.ctx.gameAudioSystem.playSound('sfx_airstrike_countdown', targetX, targetY);
        return this.ctx.airstrikeSystem?.scheduleStrike(playerId, targetX, targetY, cfg) ?? false;
      });
      // Player-Ultimates and authored Map-Events share the same AirstrikeSystem.
      // Authored event parameters remain behind the typed airstrike handler boundary.
      this.ctx.loadoutManager.setStinkCloudSystem(this.ctx.stinkCloudSystem);
      this.ctx.combatSystem.setStinkCloudSystem(this.ctx.stinkCloudSystem);
      this.ctx.burrowSystem.setStinkCloudSystem(this.ctx.stinkCloudSystem);

      this.ctx.projectileManager.setProximityPulseCallback((proj) => {
        const pulse = this.hostUpdate.resolveProjectileProximityPulse(proj);
        const playerLines = proj.isBfg ? this.hostUpdate.resolveBfgPlayerProximityPulse(proj) : [];
        bridge.broadcastBfgLaserBatch(
          [...playerLines, ...pulse.lines],
          proj.isBfg ? COLORS.GREEN_2 : proj.color,
          proj.isBfg ? undefined : 'asmd_primary',
          proj.isBfg ? proj.id : undefined,
        );
      });
      this.ctx.projectileManager.setTimeBubbleFactorProvider((x, y, now, ownerId) => {
        return this.ctx.timeBubbleSystem?.getProjectileMovementFactorAt(x, y, now, ownerId) ?? 1;
      });

      this.ctx.hostPhysics.setBurrowSystem(this.ctx.burrowSystem);
      this.ctx.hostPhysics.setLoadoutManager(this.ctx.loadoutManager);
      this.ctx.hostPhysics.setTimeBubbleSystem(this.ctx.timeBubbleSystem);

      this.ctx.combatSystem.setKillCallback((killerId, victimId, sourceId, x, y, source) => {
        if (bridge.getPlayerProfile(killerId)) {
          if (bridge.getPlayerProfile(victimId) && bridge.isEnemyPair(killerId, victimId)) {
            bridge.recordPlayerKill(killerId, 'pvp');
          } else if (this.ctx.enemyManager?.getEnemy(victimId)?.faction === 'hostile') {
            bridge.recordPlayerKill(killerId, 'pve');
          }
        }
        this.ctx.loadoutManager?.handleKill(killerId, sourceId, x, y, source);
        if (isCoopMission && (source?.enemyXp ?? 0) > 0) {
          this.hostHandleCoopDefenseItemKill(killerId, victimId, x, y);
          this.ctx.powerUpSystem?.onCoopDefenseEnemyKilled(killerId, source?.enemyXp ?? 0, x, y);
          for (const profile of bridge.getConnectedPlayers()) {
            const classDefinition = this.ctx.coopDefensePlayerModifierSystem?.getClassDefinition(profile.id);
            const adrenalineGain = classDefinition?.adrenalinePerEnemyDeath ?? 0;
            if (adrenalineGain > 0) {
              this.ctx.resourceSystem?.addAdrenaline(profile.id, adrenalineGain);
            }
          }
        }
        // Power-up-Drops sind eine Match-Konsequenz. Eine Activity-lose World fuehrt echten
        // Combat aus, erzeugt daraus aber weder Belohnung noch einen impliziten Match-Loop.
        const allowKillDrop = activityDescriptor !== null && !isCoopMission;
        if (killerId === TRAIN.TRAIN_KILLER_ID) {
          if (allowKillDrop) {
            this.ctx.powerUpSystem?.onPlayerKilled(x, y);
          }
          const victimProfile = bridge.getConnectedPlayers().find(p => p.id === victimId);
          if (victimProfile) {
            bridge.broadcastKillEvent({
              killerId:    TRAIN.TRAIN_KILLER_ID,
              killerName:  'RB 54',
              killerColor: 0xcf573c,
              sourceId:    'environment.train_push',
              victimId,
              victimName:  victimProfile.name,
              victimColor: victimProfile.colorHex,
            });
          }
          return;
        }
        if (killerId === COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID) {
          const victimProfile = bridge.getConnectedPlayers().find(p => p.id === victimId);
          if (victimProfile) {
            bridge.broadcastKillEvent({
              killerId:    COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID,
              killerName:  'Zombie-Bomber',
              killerColor: 0xff9933,
              sourceId:    'environment.airstrike',
              victimId,
              victimName:  victimProfile.name,
              victimColor: victimProfile.colorHex,
            });
          }
          return;
        }
        const allPlayers    = bridge.getConnectedPlayers();
        const killerProfile = allPlayers.find(p => p.id === killerId);
        const victimProfile  = allPlayers.find(p => p.id === victimId);
        if (victimProfile) {
          bridge.incrementPlayerFrags(killerId);
        }
        if (killerProfile && victimProfile) {
          bridge.broadcastKillEvent({
            killerId,
            killerName:  killerProfile.name,
            killerColor: killerProfile.colorHex,
            sourceId,
            victimId,
            victimName:  victimProfile.name,
            victimColor: victimProfile.colorHex,
          });
          if (allowKillDrop) {
            this.ctx.powerUpSystem?.onPlayerKilled(x, y);
          }
        }
      });

      this.ctx.rockRegistry = new RockRegistry(layout);

      this.ctx.projectileManager.setRockHitCallback((rockId, damage, attackerId) => {
        if (!this.ctx.arenaResult) return;
        const resolvedDamage = this.resolveObstacleDamage(rockId, damage, attackerId);
        if (resolvedDamage <= 0) return;
        const newHp = this.rockVisualHelper.applyObstacleDamageById(rockId, resolvedDamage, attackerId);
        if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(rockId, 'damage', attackerId);
      });
      this.ctx.projectileManager.setObstacleKindResolver(
        (rockId) => this.ctx.placementSystem?.getRuntimeRock(rockId)?.kind,
      );

      // Nur feindliche Basen nehmen Projektilschaden; eigene Basen bleiben unzerstoerbar
      // durch Spielerbeschuss.
      this.ctx.projectileManager.setBaseHitCallback((baseId, damage, attackerId, projectile) => {
        const base = this.ctx.baseManager?.getBase(baseId);
        if (!base || base.faction !== 'hostile' || (base.isInert?.() ?? false) || base.getHp() <= 0) return;
        if (projectile) this.ctx.combatSystem.applyProjectileBaseDamage(baseId, projectile);
        else this.ctx.combatSystem.applyBaseDamage(baseId, damage, attackerId);
      });

      this.ctx.projectileManager.setSupportImpactCallback((projectile, impact) => {
        this.hostUpdate.applySupportProjectileImpact(projectile, impact);
      });

      // Gleise und Map-Events sind getrennt. Der Coop-Director besitzt Trigger, Lifecycle und
      // Wiederholungsplanung; der bestehende Zug bleibt im typisierten Fachhandler.
      const trackCell = layout.tracks?.[0];
      const coopDefenseMapEvents = missionMapConfig?.mapEvents ?? [];
      if (isCoopMission && missionMapConfig) {
        const mapEventHandlers: CoopDefenseMapEventHandler[] = [];
        if (trackCell !== undefined && coopDefenseMapEvents.some((event) => event.type === 'train')) {
          const trainHandler = this.setupCoopTrainEventHandler(trackCell.gridX);
          mapEventHandlers.push(trainHandler);
        }
        if (coopDefenseAirstrikeEventHandler) mapEventHandlers.push(coopDefenseAirstrikeEventHandler);
        if (coopDefenseGroundHazardEventHandler) mapEventHandlers.push(coopDefenseGroundHazardEventHandler);
        if (coopDefenseMapEvents.length > 0) {
          this.ctx.coopDefenseMapEventDirector = new CoopDefenseMapEventDirector(
            coopDefenseMapEvents,
            mapEventHandlers,
            {
              isTriggerSatisfied: (start) => start.type === 'after-checkpoint'
                ? (this.ctx.coopDefenseMissionProgressSystem?.isCheckpointActivated(start.checkpointId) ?? false)
                : start.type === 'after-encounter'
                  ? (this.ctx.coopDefenseMapDirector?.isEncounterCleared(start.encounterId) ?? false)
                : start.type === 'after-event'
                  ? (this.ctx.coopDefenseMapEventDirector?.isEventCompleted(start.eventId) ?? false)
                : start.type === 'boss-phase'
                  ? (this.ctx.coopDefenseVoidHunterSystem?.hasReachedPhase(start.phase) ?? false)
                  : start.type === 'base-destroyed'
                    ? (this.ctx.baseManager?.getBase(start.baseId)?.isDestroyed() ?? false)
                    : false,
            },
          );
        } else {
          bridge.clearTrainEvent();
        }
      } else if (trackCell !== undefined) {
        // Nicht-Coop-Modi behalten ihren klassischen, wiederholbaren Zugrhythmus.
        this.setupTrainManager(trackCell.gridX, getClassicTrainEventPlan());
      } else {
        // Das Zug-Event ist reliable und überlebt den Rundenwechsel; ohne aktives Löschen
        // würde eine zuglose Map das HUD der Vorrunde weiterspielen.
        bridge.clearTrainEvent();
      }

      this.ctx.captureTheBeerSystem?.setInteractionPredicate((playerId) => {
        return this.ctx.combatSystem.isAlive(playerId)
          && !(this.ctx.burrowSystem?.isBurrowed(playerId) ?? false);
      });
    }

    // World-/Activity-renderers (all clients)
    this.renderers.train = presentation ? new TrainRenderer(this.scene) : null;
    this.renderers.train?.setAudioSystem(this.ctx.gameAudioSystem);
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
    // Lichtverdeckung liest dieselben Hindernis-Referenzen wie `CombatSystem`
    // (siehe setArenaObstacles/setBaseObstacles weiter oben) – keine eigene Liste.
    this.ctx.lightOccluderIndex = presentation ? new LightOccluderIndex({
      rocks: () => this.ctx.arenaResult?.rockPhysicsProxies ?? null,
      trunks: () => this.ctx.arenaResult?.trunkBodies ?? null,
      baseCells: () => this.ctx.baseManager?.getObstacleRectangles() ?? null,
      barrierCells: () => this.ctx.coopDefenseMissionBarrierManager?.getObstacleRectangles() ?? null,
      baseGeneration: () => this.ctx.baseManager?.getObstacleGeneration() ?? 0,
    }) : null;
    this.materializePersistentBaseComposite(world.persistentBaseSite, world.definition?.sourceMapId ?? null);
    this.renderers.lighting.setOccluderIndex(this.ctx.lightOccluderIndex);
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
    this.terrainSnapshotGenerationId += 1;
    const preserveTerrainSnapshot = preserveAuthoredPresentation && this.terrainSnapshotReady;
    if (!preserveTerrainSnapshot) this.terrainSnapshotReady = false;
    this.cancelPendingHostArenaGeneration();
    this.localArenaLoadReady = false;
    this.roundStartPrepared = false;
    this.preparedRoundLayout = null;
    this.boundRoundStartTime = 0;
    this.pendingClassicTrainEvent = null;
    this.cancelTrainExplosionTimers();
    // Event-Handler besitzen occurrence-/sourcebezogene Zustaende. Sie muessen vor dem
    // Fachsystem-Cleanup laufen, damit Ground-Hazard-Quellen sauber aus dem FireSystem entfernt
    // und Airstrike-/Train-Callbacks entkoppelt werden koennen.
    this.ctx.coopDefenseMapEventDirector?.reset();
    this.ctx.coopDefenseMapEventDirector = null;
    this.timeOfDayController = null;
    this.appliedRuntimeTimeOfDayMinutes = null;
    this.roundTimeOfDayMinutes = DEFAULT_TIME_OF_DAY_MINUTES;
    // Beim World-Teardown gibt es keinen gebundenen Runtime-Zustand; neutral zurücksetzen, damit
    // die nächste World ihre Beleuchtung selbst setzt.
    setEmissiveScale(1);
    this.ctx.coopDefenseEnemyAbilitySystem?.clear();
    this.ctx.coopDefenseEnemyBurrowSystem?.clear();
    this.ctx.coopDefenseEnemyDodgeSystem?.clear();
    this.ctx.coopDefenseEnemyCombatPositioningSystem?.clear();
    this.ctx.coopDefenseVoidHunterSystem?.clear();
    this.ctx.coopDefenseTimebombSystem?.clear();
    this.ctx.coopDefenseEnemyTrainAwarenessSystem?.clear();
    this.ctx.projectileManager.destroyAll();
    this.ctx.smokeSystem.destroyAll();
    if (this.fireObstacleGridListener) {
      this.scene.game.events.off(ARENA_MAP_GRID_CHANGED_EVENT, this.fireObstacleGridListener);
      this.fireObstacleGridListener = null;
    }
    this.fireObstacleIndex?.reset();
    this.fireObstacleIndex = null;
    this.ctx.fireSystem.destroyAll();
    this.ctx.fireSystem.setGroundResolvers(null, null);
    this.ctx.stinkCloudSystem.destroyAll();
    this.ctx.timeBubbleSystem?.destroyAll();
    this.ctx.decoySystem.clearAll();
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

    this.ctx.coopDefenseMissionBarrierManager?.destroy();
    this.ctx.coopDefenseMissionBarrierManager = null;

    if (this.ctx.arenaResult && !preserveAuthoredPresentation) {
      ArenaBuilder.destroyDynamic(this.ctx.arenaResult);
      this.ctx.arenaResult = null;
    }
    this.ctx.captureTheBeerSystem?.destroy();
    this.ctx.captureTheBeerSystem = null;
    this.ctx.baseManager?.destroy();
    this.ctx.baseManager = null;
    this.ctx.necromancySystem?.setCorpseSink(null);
    this.ctx.necromancySystem?.clear();
    this.ctx.necromancySystem = null;
    this.ctx.enemyManager?.setLethalDamageGuard(null);
    this.ctx.enemyManager?.setEnemySpawnedCallback(null);
    this.ctx.enemyManager?.destroy();
    this.ctx.enemyManager?.setVisualSink(null);
    this.ctx.enemyManager = null;
    this.ctx.coopDefenseEnemyAbilitySystem = null;
    this.ctx.coopDefenseEnemyBurrowSystem = null;
    this.ctx.coopDefenseEnemyDodgeSystem = null;
    this.ctx.coopDefenseEnemyCombatPositioningSystem = null;
    this.ctx.coopDefenseVoidHunterSystem = null;
    this.ctx.coopDefenseTimebombSystem = null;
    this.ctx.coopDefenseEnemyTrainAwarenessSystem = null;
    this.ctx.coopDefensePlayerModifierSystem?.clear();
    this.ctx.coopDefensePlayerModifierSystem = null;
    this.ctx.coopDefenseItemRuntimeSystem?.clear();
    this.ctx.coopDefenseItemRuntimeSystem = null;
    this.ctx.guardianSpiritSystem?.clear();
    this.ctx.guardianSpiritSystem = null;
    this.ctx.repairDroneSystem?.clear();
    this.ctx.repairDroneSystem = null;
    this.ctx.slimeTrailSystem?.clear();
    this.ctx.slimeTrailSystem = null;
    this.ctx.flamethrowerUpgradeSystem?.clear();
    this.ctx.flamethrowerUpgradeSystem = null;
    this.ctx.weaponUpgradeSystem = null;
    this.ctx.coopDefenseRespawnBudgetSystem = null;
    this.ctx.projectileManager.setNaturalFlameExpiryCallback(null);
    this.ctx.hostPhysics.setEnemyMovementFactorResolver(null);
    this.ctx.combatSystem.setDeathCallback(null);
    this.ctx.combatSystem.setEnemyDeathCallback(null);
    this.ctx.combatSystem.setPlayerMaxHpResolver(null);
    this.ctx.combatSystem.setInitialSpawnAllowedResolver(null);
    this.ctx.combatSystem.setRespawnAllowedResolver(null);
    this.ctx.combatSystem.setRespawnCallback(null);
    this.ctx.combatSystem.setAuthoritativePositionResetCallback(null);
    this.ctx.combatSystem.setPlayerActionAllowedResolver(null);
    this.ctx.combatSystem.setPlayerDamageReductionResolver(null);
    this.ctx.combatSystem.setPlayerHpRegenPerSecondResolver(null);
    this.ctx.combatSystem.setPlayerMaxArmorResolver(null);
    this.ctx.combatSystem.setPlayerArmorGainMultiplierResolver(null);
    this.ctx.combatSystem.setPlayerArmorDamageGrantsRageResolver(null);
    this.ctx.combatSystem.setPlayerLifeLeechFractionResolver(null);
    this.ctx.combatSystem.setPlayerArmorRegenPerSecondResolver(null);
    this.ctx.combatSystem.setPlayerBonusArmorRegenPerSecondResolver(null);
    this.ctx.combatSystem.setEnemyIncomingDamageMultiplierResolver(null);
    this.ctx.combatSystem.setTargetIncomingDamageMultiplierResolver(null);
    this.ctx.combatSystem.setEnergyInjectorTargetHitCallback(null);
    this.ctx.combatSystem.setHitscanSupportImpactCallback(null);
    this.ctx.combatSystem.setDirectPrimaryHitHandler(null);
    this.ctx.combatSystem.setPlayerDamageTakenHandler(null);
    this.ctx.combatSystem.setDamageDealtHandler(null);
    this.ctx.combatSystem.setHealingReceivedHandler(null);
    this.ctx.combatSystem.setArmorReceivedHandler(null);
    this.ctx.combatSystem.setPlayerOutgoingDamageResolver(null);
    this.worldLifecycle.detachRuntime();
    this.ctx.rockRegistry   = null;
    this.ctx.currentLayout  = null;
    const detachedPlacementSystem = this.ctx.placementSystem;
    this.persistentBaseContributions.detachRuntimeObjects(
      (runtimeId) => detachedPlacementSystem?.hasRuntimeRock(runtimeId) === true,
    );
    // Der Lobby-Fast-Reinstance verwendet den authored RockGridIndex erneut. Runtime-Objekte
    // muessen ihre Zellen deshalb vor dem Verwerfen des PlacementSystems freigeben; andernfalls
    // kollidieren persistente Blueprints beim naechsten Coop-Aufbau mit ihren eigenen Altzellen.
    detachedPlacementSystem?.clearRuntimeRocks();
    this.ctx.persistentBaseContributions = null;
    this.persistentBaseAnchor = null;
    this.persistentBaseBuildArea = null;
    this.ctx.placementSystem = null;
    this.ctx.turretSystem?.setTurretDamageBuffProvider(null);
    this.ctx.turretSystem?.setTurretDamageMultiplierProvider(null);
    this.ctx.turretSystem?.setFocusTargetProvider(null);
    this.ctx.turretSystem?.setFocusedBaseTargetProvider(null);
    this.ctx.turretSystem?.setFireHandler(null);
    this.ctx.reinforcementMatrixSystem?.clear();
    this.ctx.reinforcementMatrixSystem = null;
    this.ctx.energyInjectorSystem?.clear();
    this.ctx.energyInjectorSystem = null;
    this.ctx.targetStatusSystem?.clear();
    this.ctx.targetStatusSystem = null;
    this.ctx.powerUpSystem?.setConstructionRespawnMultiplierProvider(null);
    this.ctx.powerUpSystem?.reset();
    this.ctx.powerUpSystem  = null;
    this.ctx.shieldBuffSystem = null;
    this.ctx.energyShieldSystem = null;
    this.ctx.timeBubbleSystem = null;
    this.ctx.teslaDomeSystem?.setBaseCallbacks(null, null);
    this.ctx.teslaDomeSystem = null;
    this.ctx.turretSystem    = null;
    this.ctx.resourceSystem?.setPowerUpSystem(null);
    this.ctx.resourceSystem?.setAdrenalineRegenRateResolver(null);
    this.ctx.resourceSystem  = null;
    this.ctx.burrowSystem?.setTunnelTransitEndedCallback(null);
    this.ctx.burrowSystem    = null;
    this.ctx.combatSystem.setDetonationSystem(null);
    this.ctx.detonationSystem?.reset();
    this.ctx.detonationSystem = null;
    this.ctx.loadoutManager?.setCombatSystem(null);
    this.ctx.loadoutManager?.setAk47StrategicTargetHitResolver(null);
    this.ctx.loadoutManager?.setTeslaDomeSystem(null);
    this.ctx.loadoutManager?.setEnergyShieldSystem(null);
    this.ctx.loadoutManager?.setShieldBuffSystem(null);
    this.ctx.loadoutManager?.setNegevKillstreakExplosionHandler(null);
    this.ctx.loadoutManager?.setDecoySystem(null);
    this.ctx.loadoutManager?.setPlaceableRockHandler(null);
    this.ctx.loadoutManager?.setTunnelPlacementHandler(null);
    this.ctx.loadoutManager?.setUtilityUsedObserver(null);
    this.ctx.loadoutManager?.setUltimateUsedObserver(null);
    this.ctx.loadoutManager?.setActionBlockedChecker(null);
    this.ctx.loadoutManager?.resetAllUltimateStates();
    // Temporary utility state belongs to the round. Clear it centrally before the manager is
    // detached so neither saved ammo nor the replicated descriptor can enter the next round.
    if (bridge.isHost()) {
      for (const profile of bridge.getConnectedPlayers()) {
        this.ctx.loadoutManager?.releaseUtilityOverride(profile.id);
      }
    }
    this.ctx.loadoutManager = null;
    this.ctx.ak47StrategicTargetSystem?.clear();
    this.ctx.ak47StrategicTargetSystem = null;
    this.ctx.combatSystem.setBurrowSystem(null);
    this.ctx.combatSystem.setResourceSystem(null);
    this.ctx.combatSystem.setLoadoutManager(null);
    this.ctx.combatSystem.setAk47DirectEnemyHitHandler(null);
    this.ctx.combatSystem.setEnergyShieldSystem(null);
    this.ctx.combatSystem.setDecoySystem(null);
    this.ctx.combatSystem.setPowerUpSystem(null);
    this.ctx.combatSystem.setStinkCloudSystem(null);
    this.ctx.combatSystem.setArenaObstacles(null, null);
    this.ctx.combatSystem.setWorldMetrics(null);
    this.ctx.decoySystem.setWorldMetrics(null);
    this.ctx.combatSystem.setBaseObstacles(null);
    this.ctx.combatSystem.setBarrierObstacles(null);
    this.ctx.combatSystem.setBaseManager(null);
    this.ctx.combatSystem.setEnemyManager(null);
    this.ctx.combatSystem.setTrainSegments(null);
    this.ctx.combatSystem.setRockDamageCallback(null);
    this.ctx.combatSystem.setTrainDamageCallback(null);
    this.ctx.combatSystem.setProjectileImpactCallback(null);
    this.ctx.combatSystem.setPlayerImpulseCallback(null);
    this.ctx.combatSystem.setEnemyImpulseCallback(null);
    this.ctx.combatSystem.setKillCallback(() => { /* noop */ });
    this.ctx.hostPhysics.setBurrowSystem(null);
    this.ctx.hostPhysics.setLoadoutManager(null);
    this.ctx.hostPhysics.setTimeBubbleSystem(null);
    this.ctx.hostPhysics.setEnemyManager(null);
    this.ctx.hostPhysics.setEnemyRockContactCallback(null);
    this.ctx.hostPhysics.setDashRangeMultiplierResolver(null);
    this.ctx.hostPhysics.setDashRecoveryDurationResolver(null);
    this.ctx.hostPhysics.setDashImpactDamageResolver(null);
    this.ctx.hostPhysics.setDashImpactKnockbackResolver(null);
    this.ctx.hostPhysics.setDashGroundFireDurationResolver(null);
    this.ctx.hostPhysics.setDashGroundFireHandler(null);
    this.ctx.hostPhysics.setDashHoldEnabledResolver(null);
    this.ctx.coopDefenseEnemyAttackSystem = null;
    this.ctx.coopDefenseMapDirector?.reset();
    this.ctx.coopDefenseMapDirector = null;
    this.ctx.coopDefenseSecondaryObjectiveSystem?.reset();
    this.ctx.coopDefenseSecondaryObjectiveSystem = null;
    this.ctx.coopDefenseMissionProgressSystem?.reset();
    this.ctx.coopDefenseMissionProgressSystem = null;
    this.ctx.hostHeldActionSystem?.reset();
    this.ctx.hostHeldActionSystem = null;
    this.ctx.coopDefenseCarrySystem?.reset();
    this.ctx.coopDefenseCarrySystem = null;
    this.ctx.coopDefenseCarryItems = [];
    this.renderers.beer.syncCoopDefenseCarry([]);
    this.renderers.carryZones.clear();
    this.ctx.coopDefenseSecondaryObjectiveConfigs = [];
    this.ctx.coopDefenseTeamBuffSystem?.reset();
    this.ctx.coopDefenseTeamBuffSystem = null;
    if (bridge.isHost()) {
      for (const player of bridge.getConnectedPlayers()) bridge.publishActiveBuffs(player.id, []);
    }
    this.ctx.coopDefenseObjectiveRepairSystem?.reset();
    this.ctx.coopDefenseObjectiveRepairSystem = null;
    this.ctx.coopDefenseObjectivePlacementRewardSystem?.reset();
    this.ctx.coopDefenseObjectivePlacementRewardSystem = null;
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(null);
    bridge.publishCoopDefenseMissionProgressPresentationState(null);
    bridge.publishCoopDefenseMapEventPresentationState(null);
    this.ctx.coopDefensePersistentPressureSystem?.reset();
    this.ctx.coopDefensePersistentPressureSystem = null;
    this.ctx.coopDefenseBossSystem?.reset();
    this.ctx.coopDefenseBossSystem = null;
    this.ctx.coopDefenseSpawnExecutor = null;
    this.ctx.decoySystem.setCombatStateReader(null);
    this.ctx.decoySystem.setRunSpeedResolver(null);
    this.ctx.decoySystem.setCooldownStarter(null);
    this.ctx.decoySystem.setObstacleGroups(null, null);
    this.ctx.projectileManager.setRockGroup(null, null, null);
    this.ctx.projectileManager.setObstacleIndex(null);
    this.ctx.projectileManager.setObstacleKindResolver(null);
    this.ctx.projectileManager.setBaseGroup(null);
    this.ctx.projectileManager.setRockHitCallback(() => { /* noop */ });
    this.ctx.projectileManager.setBaseHitCallback(null);
    this.ctx.projectileManager.setSupportImpactCallback(null);
    this.ctx.projectileManager.setProjectileImpactCallback(null);
    this.ctx.projectileManager.setProjectileResolvedCallback(null);
    this.ctx.projectileManager.setMiniRocketCollectedCallback(null);
    this.ctx.projectileManager.setMiniRocketDestroyedCallback(null);
    this.ctx.projectileManager.setProximityPulseCallback(null);
    this.ctx.projectileManager.setTimeBubbleFactorProvider(null);
    this.ctx.hostPhysics.setRockGroup(null, null);
    this.ctx.hostPhysics.setBaseGroup(null);
    this.ctx.hostPhysics.setMovementBlockedCellResolver(null);
    this.ctx.hostPhysics.setWorldMetrics(null);
    if (!preserveAuthoredPresentation) this.renderers.leafBlower.setTerrainColorSnapshot(null);
    this.renderers.leafBlower.setTerrainMaterialLayout(null);
    this.ctx.tunnelSystem?.clear();
    this.ctx.tunnelSystem = null;
    // Der Translocator haelt Puck-IDs der Runde. Ohne Entkopplung meldete er in der Lobby und in
    // der naechsten Runde noch Pucks, deren Projektile hier laengst zerstoert wurden.
    this.ctx.translocatorSystem?.setTrainManager(null);
    this.ctx.translocatorSystem?.setUseCallback(null);
    this.ctx.translocatorSystem?.setRadialImpulseCallback(null);
    this.ctx.translocatorSystem?.setPositionResetCallback(null);
    this.ctx.translocatorSystem = null;
    this.ctx.coopDefenseRoundStateSystem = null;

    this.renderers.powerUp.clear();
    this.renderers.nuke.clear();
    this.renderers.airstrike.clear();
    this.renderers.encounterTelegraph.clear();
    this.renderers.meteor.clear();
    this.renderers.rockDestruction.clear();
    this.ctx.armageddonSystem?.destroyAll();
    this.ctx.armageddonSystem = null;
    this.ctx.airstrikeSystem?.clear();
    this.ctx.airstrikeSystem?.setResolvedCallback(null);
    this.ctx.airstrikeSystem = null;

    this.ctx.trainManager?.destroy();
    this.ctx.trainManager = null;
    if (this.flowFieldGridListener) {
      this.scene.game.events.off(ARENA_MAP_GRID_CHANGED_EVENT, this.flowFieldGridListener);
      this.flowFieldGridListener = null;
    }
    this.ctx.enemyFlowFieldService?.destroy();
    this.ctx.enemyFlowFieldService = null;
    this.ctx.enemyPlayerFlowFieldService?.destroy();
    this.ctx.enemyPlayerFlowFieldService = null;
    this.ctx.enemyStrategicTargetService?.clear();
    this.ctx.enemyStrategicTargetService = null;
    this.ctx.enemyAiTargetCatalog?.clear();
    this.ctx.enemyAiTargetCatalog = null;
    this.ctx.enemyStrategicFlowFieldService?.destroy();
    this.ctx.enemyStrategicFlowFieldService = null;
    this.ctx.enemyBossFlowFieldService?.destroy();
    this.ctx.enemyBossFlowFieldService = null;
    for (const flowField of this.ctx.allyFlowFieldServices.values()) flowField.destroy();
    this.ctx.allyFlowFieldServices.clear();
    // Zuletzt: erhoeht die Generation und beendet den Worker, wodurch jedes noch unterwegs
    // befindliche Ergebnis dieser Runde unbrauchbar wird.
    this.ctx.flowFieldCoordinator?.destroy();
    this.ctx.flowFieldCoordinator = null;
    this.renderers.train?.destroy();
    this.renderers.train = null;
    this.renderers.beer.clear();
    if (preserveAuthoredPresentation) this.renderers.shadow.clearDynamicShadows();
    else this.renderers.shadow.clear();
    this.renderers.lighting.setActive(false);
    this.renderers.lighting.setOccluderIndex(null);
    this.ctx.lightOccluderIndex = null;
    this.renderers.translocatorTeleport = null;
    this.ctx.projectileManager.setTrainGroup(null);
    this.ctx.projectileManager.setTrainHitCallback(null);
    this.ctx.centerHUD.hideTrainWidget();
    this.clientUpdate.clientUtilityOverride = null;
    this.ctx.playerManager.setWorldGeometry(null);
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
    let ingestedSomething = false;
    for (const playerId of bridge.getConnectedPlayerIds()) {
      const offered = playerId === bridge.getLocalPlayerId()
        ? getStoredPersonalBaseContribution()
        : bridge.getPlayerPersistentBaseContribution(playerId);
      if (!offered) continue;
      // Eine Besitzeridentitaet gehoert in diesem Raum genau einem Spieler. Zwei Spieler mit
      // derselben - geklonter Speicherstand oder Manipulation - wuerden sonst gegenseitig ihre
      // Beitraege ueberschreiben; wer die Identitaet des Hosts uebernaehme, koennte ihm sogar
      // seinen eigenen Save ueberschreiben lassen. Der erste Anspruch gilt, jeder weitere nicht.
      if (!this.canClaimPersistentBaseOwnerId(playerId, offered.ownerId)) continue;
      if (this.ingestedContributionRevisions.get(playerId) === offered.revision) continue;
      if (!this.persistentBaseContributions.offerContribution(offered)) continue;
      this.ingestedContributionRevisions.set(playerId, offered.revision);
      this.persistentBaseOwnerByPlayerId.set(playerId, offered.ownerId);
      ingestedSomething = true;
    }
    // Ein waehrend der Mission eingetroffener Beitrag traegt sofort bei, statt bis zur naechsten
    // World zu warten.
    if (ingestedSomething && this.persistentBaseContributions.hasActiveMission) {
      this.hostRefreshPersistentBaseComposite();
    }
  }

  /**
   * Ob dieser Spieler die angebotene Besitzeridentitaet in diesem Raum fuehren darf.
   *
   * Die Identitaet des Hosts ist dabei gesetzt, bevor irgendein Gast etwas anbieten kann: Sie
   * kommt aus dem lokalen Profil und nicht aus dem Netz.
   */
  private canClaimPersistentBaseOwnerId(playerId: string, ownerId: string): boolean {
    if (playerId !== bridge.getLocalPlayerId() && ownerId === getStoredLocalOwnerId()) return false;
    const claimedBy = this.resolvePlayerIdForOwner(ownerId);
    return claimedBy === null || claimedBy === playerId;
  }

  /** Die dauerhafte Besitzeridentitaet hinter einer Raum-Spieler-ID; leer, wenn keine bekannt ist. */
  private resolveOwnerId(playerId: string): string {
    if (playerId === bridge.getLocalPlayerId()) return getStoredLocalOwnerId();
    return this.persistentBaseOwnerByPlayerId.get(playerId)
      ?? bridge.getPlayerPersistentBaseContribution(playerId)?.ownerId
      ?? '';
  }

  /**
   * Die Raum-Spieler-ID hinter einer Besitzeridentitaet; sie bestimmt Farbe und Berechtigungen.
   *
   * Nur der lokale Spieler leitet seine Identitaet aus dem eigenen Profil ab; jede andere kommt
   * aus einem bereits angenommenen Angebot. Beides bleibt getrennt, damit eine Spieler-ID nie
   * aus einer Besitzeridentitaet erraten wird.
   */
  private resolvePlayerIdForOwner(ownerId: string): string | null {
    if (ownerId === getStoredLocalOwnerId()) return bridge.getLocalPlayerId();
    for (const [playerId, candidate] of this.persistentBaseOwnerByPlayerId) {
      if (candidate === ownerId && playerId !== bridge.getLocalPlayerId()) return playerId;
    }
    return null;
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
  private hostRefreshPersistentBaseComposite(): void {
    if (!bridge.isHost() || !this.ctx.persistentBaseContributions) return;
    this.materializePersistentBaseComposite(
      this.ctx.world?.persistentBaseSite ?? null,
      this.ctx.world?.definition?.sourceMapId ?? null,
    );
  }

  /**
   * Reconciled nur bei einer echten Aenderung der Sicht, die auch der Composite-Merge verwendet.
   * Der separat replizierte Lobby-Build kann nach einem Moduswechsel spaeter als die World
   * eintreffen; insbesondere `active: false` bleibt dabei weiterhin regulaere Dormancy.
   */
  private hostRefreshPersistentBaseCompositeForRelevantBuildChanges(): void {
    const store = this.ctx.persistentBaseContributions;
    if (!bridge.isHost() || !store) {
      this.persistentBaseCompositeBuildSignatures.clear();
      return;
    }

    const nextSignatures = new Map<string, string>();
    for (const ownerId of store.ownerIds) {
      const playerId = this.resolvePlayerIdForOwner(ownerId);
      if (!playerId) continue;
      nextSignatures.set(ownerId, JSON.stringify({
        capacityMax: this.getConstructionCapacity(playerId),
        tools: this.buildPersistentRestoreTools(playerId),
      }));
    }

    let changed = nextSignatures.size !== this.persistentBaseCompositeBuildSignatures.size;
    if (!changed) {
      for (const [ownerId, signature] of nextSignatures) {
        if (this.persistentBaseCompositeBuildSignatures.get(ownerId) !== signature) {
          changed = true;
          break;
        }
      }
    }

    this.persistentBaseCompositeBuildSignatures.clear();
    for (const [ownerId, signature] of nextSignatures) {
      this.persistentBaseCompositeBuildSignatures.set(ownerId, signature);
    }
    if (changed) this.hostRefreshPersistentBaseComposite();
  }

  private materializePersistentBaseComposite(
    site: WorldPersistentBaseSite | null,
    mapId: string | null,
  ): void {
    const store = this.ctx.persistentBaseContributions;
    if (!store || !site || !this.ctx.placementSystem) return;

    const hostOwnerId = getStoredLocalOwnerId();
    const toolCache = new Map<string, ReadonlyMap<string, PersistentRestoreToolDefinition>>();
    const resolveOwnerTools = (ownerId: string): ReadonlyMap<string, PersistentRestoreToolDefinition> => {
      const cached = toolCache.get(ownerId);
      if (cached) return cached;
      // Freischaltung, Klasse und Loadout gehoeren dem Besitzer der Konstruktion, nicht dem Host:
      // Ein Gast darf ein Werkzeug einsetzen, das der Host selbst nicht besitzt.
      const playerId = this.resolvePlayerIdForOwner(ownerId);
      const tools = new Map<string, PersistentRestoreToolDefinition>();
      if (playerId) {
        for (const tool of this.buildPersistentRestoreTools(playerId)) tools.set(tool.id, tool);
      }
      toolCache.set(ownerId, tools);
      return tools;
    };

    // Zellen, die bereits von persoenlichen Konstruktionen dieses Composites belegt sind.
    const materializedCells = new Set<string>();
    for (const binding of store.getRuntimeBindings()) {
      const tool = resolveOwnerTools(binding.ownerId).get(binding.blueprint.tool.id);
      const footprint = tool && tool.footprint.length > 0 ? tool.footprint : [{ dx: 0, dy: 0 }];
      const gridX = site.anchor.gridX + binding.blueprint.relativeGridX;
      const gridY = site.anchor.gridY + binding.blueprint.relativeGridY;
      for (const offset of footprint) materializedCells.add(cellKey(gridX + offset.dx, gridY + offset.dy));
    }

    const capacityMaxByOwner = new Map<string, number>();
    for (const ownerId of store.ownerIds) {
      const playerId = this.resolvePlayerIdForOwner(ownerId);
      // Kapazitaet gilt pro Besitzer, nicht als gemeinsamer Basis-Pool.
      if (playerId) capacityMaxByOwner.set(ownerId, this.getConstructionCapacity(playerId));
    }

    const result = mergePersistentBaseComposite({
      anchor: site.anchor,
      buildArea: site.buildArea,
      hostContribution: store.getContribution(hostOwnerId),
      guestContributions: store.getContributions()
        .filter((contribution) => contribution.ownerId !== hostOwnerId),
      resolveTool: (ownerId, toolId): PersistentCompositeTool | null => {
        const tool = resolveOwnerTools(ownerId).get(toolId);
        if (!tool) return null;
        return {
          footprint: tool.footprint,
          capacityCost: tool.capacityCost,
          unavailableReason: resolveCompositeToolUnavailability(tool),
        };
      },
      capacityMaxByOwner,
      // Bereits materialisierte persoenliche Konstruktionen belegen ihre Zellen im
      // PlacementSystem. Wuerde der Merge sie als statische Kollision lesen, kollidierte jede
      // von ihnen bei einem erneuten Lauf mit sich selbst - und keine Prioritaet koennte je
      // greifen. Der Merge entscheidet deshalb ueber diese Zellen selbst.
      isCellBlocked: (gridX, gridY) => !materializedCells.has(cellKey(gridX, gridY))
        && !this.ctx.placementSystem!.canMaterializeCells([{ dx: 0, dy: 0 }], gridX, gridY),
    });

    // Was der Merge nicht mehr traegt, verlaesst die Welt: Ein spaeter beitretender Spieler mit
    // hoeherer Prioritaet verdraengt sonst nichts, und ein Blueprint bliebe stehen, obwohl das
    // Composite ihn nicht mehr enthaelt. Der Besitz bleibt dabei ausdruecklich unberuehrt.
    const activeKeys = new Set(result.active.map(
      (entry) => `${entry.ownerId} ${entry.blueprint.persistentId}`,
    ));
    let dematerializedCount = 0;
    for (const binding of store.getRuntimeBindings()) {
      if (activeKeys.has(`${binding.ownerId} ${binding.blueprint.persistentId}`)) continue;
      // Erst die Bindung loesen, dann das Objekt entfernen: Der gemeinsame Abbaupfad wuerde den
      // Blueprint sonst als Abriss werten und den Besitz loeschen.
      store.releaseRuntimeBinding(binding.runtimeId);
      const removed = this.ctx.placementSystem.removeRock(binding.runtimeId);
      if (!removed) continue;
      this.releasePlaceableRuntime(removed, false);
      dematerializedCount += 1;
    }
    if (dematerializedCount > 0) {
      emitArenaMapGridChanged(this.scene.game.events, {
        reason: 'placeables_batch_removed',
        source: 'placeable_rock',
      });
    }

    for (const entry of result.active) {
      // Was bereits steht, bleibt stehen: Ein erneuter Merge darf eine laufende Mission nicht
      // neu aufbauen.
      if (store.isMaterialized(entry.ownerId, entry.blueprint.persistentId)) continue;
      const playerId = this.resolvePlayerIdForOwner(entry.ownerId);
      const tool = resolveOwnerTools(entry.ownerId).get(entry.blueprint.tool.id);
      if (!playerId || !tool) continue;
      const runtime = this.materializePersistentRestoreCandidate(
        { blueprint: entry.blueprint, tool, gridX: entry.gridX, gridY: entry.gridY },
        playerId,
        bridge.getPlayerColor(playerId) ?? PLAYER_COLORS[0],
        this.getConstructionOwnership(playerId),
      );
      if (!runtime) continue;
      store.registerRestored(entry.ownerId, entry.blueprint, runtime.id);
      this.emitPersistentRestoreAdded(runtime);
    }
    if (result.conflicts.length > 0) {
      this.runtimeDiagnosticEventSink?.('persistent-base:composite-conflicts', {
        mapId,
        count: result.conflicts.length,
      });
    }
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
    });
  }

  private buildPersistentRestoreTools(
    playerId: string,
  ): PersistentRestoreToolDefinition[] {
    const currentLoadout = bridge.getPlayerCurrentLoadoutSnapshot(playerId);
    const accessContext = getConstructionAccessContext(this.resolveConfiguredGameMode(), currentLoadout);
    const modifiers = this.ctx.coopDefensePlayerModifierSystem?.getModifiers(playerId);
    const constructionHpMultiplier = 1 + (
      this.ctx.coopDefensePlayerModifierSystem?.getPercentageStat(playerId, 'construction.maxHp') ?? 0
    );
    const tools: PersistentRestoreToolDefinition[] = [];

    for (const constructionId of COOP_DEFENSE_CONSTRUCTION_IDS) {
      const definition = getCoopDefenseConstructionDefinition(constructionId);
      const access = resolveConstructionAccess(constructionId, accessContext);
      const utilityId = getUtilityIdForConstruction(constructionId);
      let footprint = definition.footprint;
      let maxHp = definition.maxHp;
      if (utilityId) {
        const config = getUtilityConfigForMode(utilityId, this.resolveConfiguredGameMode());
        if (config && 'placeable' in config) {
          const effectiveConfig = modifiers
            ? applyCoopDefenseModifiersToUtilityConfig(config as PlaceableUtilityConfig, {
              additive: modifiers.additiveStats,
              percentage: modifiers.percentageStats,
            }) as PlaceableUtilityConfig
            : config as PlaceableUtilityConfig;
          footprint = effectiveConfig.placeable.footprint;
          maxHp = effectiveConfig.placeable.maxHp;
        }
      }
      tools.push({
        kind: 'construction',
        id: constructionId,
        footprint,
        capacityCost: definition.capacityCost,
        maxHp: utilityId ? maxHp : maxHp * (definition.indestructible ? 1 : constructionHpMultiplier),
        unlocked: access.unlocked,
        active: access.active,
        unavailableReason: access.reason === 'class-not-allowed' || access.reason === 'mode-not-allowed'
          ? access.reason
          : undefined,
      });
    }
    return tools;
  }

  private materializePersistentRestoreCandidate(
    candidate: PersistentRestoreCandidate,
    ownerId: string,
    ownerColor: number,
    ownership: ConstructionOwnership,
  ): SyncedPlaceableRock | null {
    if (!this.ctx.placementSystem) return null;
    const constructionId = normalizeConstructionId(candidate.tool.id);
    if (constructionId) {
      const utilityId = getUtilityIdForConstruction(constructionId);
      if (utilityId) {
        const config = getUtilityConfigForMode(utilityId, this.resolveConfiguredGameMode());
        if (!config || !('placeable' in config)) return null;
        const modifiers = this.ctx.coopDefensePlayerModifierSystem?.getModifiers(ownerId);
        const modifiedConfig = modifiers
          ? applyCoopDefenseModifiersToUtilityConfig(config as PlaceableUtilityConfig, {
            additive: modifiers.additiveStats,
            percentage: modifiers.percentageStats,
          }) as PlaceableUtilityConfig
          : config as PlaceableUtilityConfig;
        const effectiveConfig = {
          ...modifiedConfig,
          id: utilityId,
          placeable: {
            ...modifiedConfig.placeable,
            lifetimeMs: 0,
            maxHp: candidate.tool.maxHp,
          },
        } as PlaceableUtilityConfig;
        const runtime = this.ctx.placementSystem.materializePersistentPlaceable(
          effectiveConfig,
          candidate.gridX,
          candidate.gridY,
          candidate.blueprint.angle,
          ownerId,
          ownerColor,
          ownership,
        );
        if (!runtime) return null;
        this.rockVisualHelper.materializePlaceableRock(runtime, false);
        return runtime;
      }

      const definition = getCoopDefenseConstructionDefinition(constructionId);
      const effectiveDefinition = {
        ...definition,
        maxHp: candidate.tool.maxHp,
      };
      const runtime = this.ctx.placementSystem.materializePersistentPlaceable(
        effectiveDefinition,
        candidate.gridX,
        candidate.gridY,
        candidate.blueprint.angle,
        ownerId,
        ownerColor,
        ownership,
      );
      if (!runtime) return null;
      if (definition.kind === 'pedestal') {
        const world = this.rockVisualHelper.gridToWorld(runtime.gridX, runtime.gridY);
        const registered = this.ctx.powerUpSystem?.registerConstructionPedestal(
          runtime.id,
          definition.powerUpDefId,
          world.x,
          world.y,
          ownerColor,
        ) ?? false;
        if (!registered) {
          this.ctx.placementSystem.removeRock(runtime.id);
          return null;
        }
      }
      this.rockVisualHelper.materializePlaceableRock(runtime, false);
      return runtime;
    }
    return null;
  }

  private registerNewPersistentPlaceable(
    runtime: SyncedPlaceableRock,
    tool: PersistentToolRef,
    footprint: readonly { readonly dx: number; readonly dy: number }[],
  ): void {
    const constructionId = normalizeConstructionId(runtime.constructionId) ?? normalizeConstructionId(tool.id);
    const normalizedTool: PersistentToolRef = constructionId
      ? { kind: 'construction', id: constructionId }
      : { ...tool };
    if (!this.persistentBaseAnchor || !this.persistentBaseBuildArea) return;
    // Ein einziger Besitzpfad: Ob die Konstruktion dem Host oder einem Gast gehoert, ist nur noch
    // eine Frage der Besitzeridentitaet.
    const ownerId = this.resolveOwnerId(runtime.ownerId);
    if (!ownerId) return;
    const store = this.ctx.persistentBaseContributions;
    const registered = store?.registerNew(
      ownerId,
      runtime,
      normalizedTool,
      footprint,
      this.persistentBaseAnchor,
      this.persistentBaseBuildArea,
    );
    if (store && registered && !store.hasActiveMission) {
      this.publishImmediatePersistentBaseContribution(ownerId);
    }
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
    const activityReady = isArenaTransitionReady({
      phase: bridge.getGamePhase(),
      worldDescriptor,
      activityDescriptor,
      roundState,
      arenaStartTime: bridge.getArenaStartTime(),
      participation,
    });
    const pendingHostGeneration = this.pendingHostArenaGeneration;
    if (bridge.isHost()
      && pendingHostGeneration
      && participation?.roundRevision === pendingHostGeneration.roundRevision
      && roundState?.status === 'active'
      && worldDescriptor?.worldRevision !== pendingHostGeneration.roundRevision) {
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
      this.scene.time.delayedCall(16, () => this.onTransitionToArena());
      return;
    }
    this.layoutRetryCount = 0;

    const { mode: layoutMode, mapConfig: coopDefenseMapConfig } =
      this.resolveWorldLayout(worldDescriptor, activityDescriptor);
    applyArenaMetricsForMode(
      layoutMode,
      'ARENA',
      coopDefenseMapConfig?.arenaWidthCells,
      coopDefenseMapConfig?.arenaHeightCells,
    );
    const preserveLobbyPresentation = this.pendingLobbyWorldReinstance;
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
    this.arenaBuilt = true;
    this.builtWorldRevision = worldDescriptor.worldRevision;
    this.localArenaLoadReady = false;
    this.terrainSnapshotReady = preserveTerrainSnapshot;
    if (this.getLocalWorldPresentation().required && !this.terrainSnapshotReady) {
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
  }

  private startTerrainSnapshotBuild(worldRevision: number): void {
    const layout = this.ctx.currentLayout;
    const arenaResult = this.ctx.arenaResult;
    const world = this.ctx.world;
    if (!layout || !arenaResult || !world) return;

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

    build.then((snapshot) => {
      if (!isCurrent()) return;
      this.renderers.leafBlower.setTerrainColorSnapshot(snapshot);
      this.terrainSnapshotReady = true;
    }).catch((error: unknown) => {
      if (!isCurrent()) return;
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
    this.arenaBuilt = false;
    this.builtWorldRevision = 0;
    this.arenaEnteredAt = 0;
    this.lobbyWorldModeAtRevision = null;
    this.lobbyWorldPersistentBaseUnlockedAtRevision = null;
    this.pendingLobbyWorldReinstance = false;
    this.isLocalReady = false;
    bridge.setLocalReady(false);
    this.roundStartPending = false;
    this.localPlayerState.spectator = false;
    this.localPlayerState.overlayTrackedAlive = null;
    this.clientUpdate.clientUtilityOverride = null;
    this.ctx.arenaCountdown?.clear();
    this.resetLocalArenaHudState();
    this.ctx.gameAudioSystem.playMusic('music_lobby');

    // Auch das Rundenende nimmt den gemeinsamen lokalen World-Cleanup; die UI-Behandlung bleibt
    // trotzdem exklusiv in diesem vollstaendigen Lobby-Uebergang.
    this.synchronizeLocalWorldLifecycle(null);
    this.tearDownArena();
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

  /**
   * Legt das Ally-Flowfield eines Spielers an, falls es noch fehlt. Wird sowohl beim Arenaaufbau
   * als auch beim Nachspawnen gerufen: Spieler, die erst nach `buildArena()` dazukommen (Reconnect,
   * verspaetetes Loadout), hatten frueher dauerhaft kein eigenes Feld.
   */
  ensureAllyFlowField(playerId: string): void {
    const coordinator = this.ctx.flowFieldCoordinator;
    if (!coordinator || this.ctx.allyFlowFieldServices.has(playerId)) return;
    this.ctx.allyFlowFieldServices.set(
      playerId,
      EnemyFlowFieldService.fromView(
        coordinator.registerField(allyFlowFieldId(playerId), { goalMode: 'dynamic-fallback-bases' }),
      ),
    );
  }

  private getEnemyNavigationFlowField(): EnemyFlowFieldService | null {
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

  private setupTrainManager(
    trackGridX: number,
    plan: TrainEventPlan | null,
    direction: 1 | -1 = Math.random() < 0.5 ? 1 : -1,
  ): TrainManager {
    const world = this.ctx.world;
    if (!world) {
      throw new Error('[ArenaLifecycleCoordinator] Cannot create a train without an active World');
    }
    const trackX     = world.metrics.offsetX + trackGridX * CELL_SIZE + CELL_SIZE;
    const arenaStartTime = bridge.getArenaStartTime();
    const spawnAt    = plan && arenaStartTime > 0
      ? arenaStartTime + plan.firstArrivalDelayMs
      : null;

    if (plan) {
      this.pendingClassicTrainEvent = { trackX, direction, plan };
      if (spawnAt !== null && bridge.isHost()) bridge.publishTrainEvent({ trackX, direction, spawnAt });
    }

    this.ctx.trainManager = new TrainManager(
      this.scene,
      this.ctx.playerManager,
      trackX,
      direction,
      world.metrics,
    );
    this.ctx.trainManager.setTimeBubbleSystem(this.ctx.timeBubbleSystem);
    this.ctx.trainManager.setEnemyManager(this.ctx.enemyManager);
    this.ctx.translocatorSystem?.setTrainManager(this.ctx.trainManager);
    if (plan) this.hostUpdate.setClassicTrainSpawned(false);

    this.ctx.projectileManager.setTrainGroup(this.ctx.trainManager.getGroup());
    this.ctx.projectileManager.setTrainHitCallback((damage, attackerId) => {
      this.ctx.trainManager?.applyDamage(damage, attackerId);
    });

    this.ctx.trainManager.setCanHitPlayerCallback((playerId) => {
      return !this.ctx.burrowSystem?.isBurrowed(playerId);
    });
    this.ctx.trainManager.setPlayerHitCallback((playerId, sourceX, sourceY) => {
      const recentPusherId = this.ctx.hostPhysics.getRecentImpulseSource(playerId);
      const attackerId = recentPusherId ?? TRAIN.TRAIN_KILLER_ID;
      const sourceId = recentPusherId ? 'environment.train_push' : 'environment.train';
      this.ctx.combatSystem.applyDamage(playerId, 9999, true, attackerId, sourceId, {
        sourceX,
        sourceY,
      });
    });
    this.ctx.trainManager.setEnemyHitCallback((enemyId, sourceX, sourceY) => {
      const enemy = this.ctx.enemyManager?.getEnemy(enemyId);
      const trainCollision = enemy
        ? getCoopDefenseEnemyConfig(enemy.kind).trainCollision
        : undefined;
      const isRevivedAlly = enemy?.faction === 'allied';
      const recentPusherId = this.ctx.hostPhysics.getRecentImpulseSource(enemyId);
      const attackerId = recentPusherId ?? TRAIN.TRAIN_KILLER_ID;
      const sourceId = recentPusherId ? 'environment.train_push' : 'environment.train';
      const collisionDamage = isRevivedAlly
        ? Math.max(9999, enemy?.getHp() ?? 0)
        : (trainCollision?.damageToEnemy ?? 9999);
      this.ctx.combatSystem.applyDamage(enemyId, collisionDamage, true, attackerId, sourceId, {
        sourceX,
        sourceY,
      }, { allowTeamDamage: isRevivedAlly });
      return trainCollision
        ? { destroysTrain: !isRevivedAlly && trainCollision.destroysTrain }
        : undefined;
    });

    this.ctx.trainManager.setIsPlayerBurrowedCallback((playerId) => {
      return this.ctx.burrowSystem?.isBurrowed(playerId) ?? false;
    });
    this.ctx.trainManager.setOnBurrowDamageDealtCallback((_playerId, x, y) => {
      bridge.broadcastTrainBurrowSparks(x, y);
    });

    this.ctx.trainManager.setDestroyCallback((result) => {
      if (result.lastHitterId) {
        bridge.addPlayerFrags(result.lastHitterId, TRAIN.KILL_FRAGS);
        const allPlayers = bridge.getConnectedPlayers();
        const hitter = allPlayers.find(p => p.id === result.lastHitterId);
        if (hitter) {
          bridge.broadcastKillEvent({
            killerId:    hitter.id,
            killerName:  hitter.name,
            killerColor: hitter.colorHex,
            sourceId:    'environment.train',
            victimId:    '__train__',
            victimName:  'RB 54',
            victimColor: 0xcf573c,
          });
        }
      }
      let latestWagonDelay = 0;
      for (const seg of result.segmentPositions) {
        const delay = Math.round(Math.random() * TRAIN.EXPLOSION_WAGON_DELAY_MAX_MS);
        latestWagonDelay = Math.max(latestWagonDelay, delay);
        this.scheduleTrainExplosion(seg.x, seg.y, 80, delay);
      }
      this.scheduleTrainExplosion(
        result.centerX,
        result.centerY,
        160,
        latestWagonDelay + TRAIN.EXPLOSION_CENTER_DELAY_MS,
      );

      const arenaTop    = world.metrics.offsetY;
      const arenaBottom = world.metrics.offsetY + world.metrics.heightPx;
      const validSegs = result.segmentPositions.filter(seg => seg.y >= arenaTop && seg.y <= arenaBottom);
      const dropSegs  = validSegs.length > 0 ? validSegs : result.segmentPositions;
      for (let i = 0; i < TRAIN_DROP_COUNT; i++) {
        const idx     = Math.floor(i * dropSegs.length / TRAIN_DROP_COUNT);
        const seg     = dropSegs[idx];
        const scatter = 28;
        const ox = (Math.random() - 0.5) * scatter;
        const oy = (Math.random() - 0.5) * scatter;
        this.ctx.powerUpSystem?.spawnFromTable('TRAIN_DESTROY', seg.x + ox, seg.y + oy);
      }
      bridge.broadcastTrainDestroyed();
    });

    if (plan) this.ctx.trainManager.setExitedCallback(() => {
      const currentEvent = bridge.getTrainEvent();
      if (!currentEvent) return;
      const newSpawnAt = getNextClassicTrainArrivalAt(Date.now(), plan);
      const newDirection: 1 | -1 = currentEvent.direction === 1 ? -1 : 1;
      bridge.publishTrainEvent({ trackX: currentEvent.trackX, direction: newDirection, spawnAt: newSpawnAt });
      this.ctx.trainManager?.prepareReentry(newDirection);
      this.hostUpdate.setClassicTrainSpawned(false);
    });
    return this.ctx.trainManager;
  }

  private setupCoopTrainEventHandler(trackGridX: number): CoopDefenseTrainEventHandler {
    const initialDirection: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const trainManager = this.setupTrainManager(trackGridX, null, initialDirection);
    return new CoopDefenseTrainEventHandler(trainManager, this.ctx.combatSystem, initialDirection);
  }

  private scheduleTrainExplosion(x: number, y: number, radius: number, delayMs: number): void {
    let timer: Phaser.Time.TimerEvent;
    timer = this.scene.time.delayedCall(delayMs, () => {
      this.trainExplosionTimers = this.trainExplosionTimers.filter(candidate => candidate !== timer);
      bridge.broadcastExplosionEffect(x, y, radius, undefined, 'train');
    });
    this.trainExplosionTimers.push(timer);
  }

  private cancelTrainExplosionTimers(): void {
    for (const timer of this.trainExplosionTimers) timer.remove();
    this.trainExplosionTimers.length = 0;
  }

  private placePlaceableRock(
    cfg: PlaceableUtilityConfig,
    playerId: string,
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    now: number,
    playerColor: number,
  ): boolean {
    if (cfg.type === 'placeable_pedestal') {
      const rewardSystem = this.ctx.coopDefenseObjectivePlacementRewardSystem;
      if (!rewardSystem?.canPlace(cfg.rewardObjectiveId, playerId)) return false;

      const pedestal = this.ctx.placementSystem?.tryPlaceRock(
        cfg,
        playerId,
        playerColor,
        originX,
        originY,
        targetX,
        targetY,
        now,
      );
      if (!pedestal) return false;

      const world = this.rockVisualHelper.gridToWorld(pedestal.gridX, pedestal.gridY);
      const registered = this.ctx.powerUpSystem?.registerConstructionPedestal(
        pedestal.id,
        cfg.powerUpDefId,
        world.x,
        world.y,
        playerColor,
      ) ?? false;
      if (!registered || !rewardSystem.consume(cfg.rewardObjectiveId, playerId)) {
        if (registered) this.ctx.powerUpSystem?.unregisterConstructionPedestal(pedestal.id);
        this.ctx.placementSystem?.removeRock(pedestal.id);
        return false;
      }

      this.rockVisualHelper.materializePlaceableRock(pedestal, true);
      // Mission reward pedestals are intentionally not part of the persistent-base utility set.
      emitArenaMapGridChanged(this.scene.game.events, {
        reason: 'placeable_added',
        source: 'placeable_pedestal',
        obstacleId: pedestal.id,
        gridX: pedestal.gridX,
        gridY: pedestal.gridY,
      });
      return true;
    }

    const constructionId = getConstructionIdForUtility(cfg.id);
    if (constructionId) {
      const currentLoadout = bridge.getPlayerCurrentLoadoutSnapshot(playerId);
      const access = resolveConstructionAccess(
        constructionId,
        getConstructionAccessContext(this.resolveConfiguredGameMode(), currentLoadout),
      );
      if (!access.allowed || !this.hasFreeConstructionCapacity(playerId, access.definition?.capacityCost ?? 0)) return false;
    }
    const rock = this.ctx.placementSystem?.tryPlaceRock(
      cfg,
      playerId,
      playerColor,
      originX,
      originY,
      targetX,
      targetY,
      now,
      constructionId ? this.getConstructionOwnership(playerId) : undefined,
    );
    if (!rock) return false;
    this.rockVisualHelper.materializePlaceableRock(rock, true);
    this.registerNewPersistentPlaceable(
      rock,
      constructionId ? { kind: 'construction', id: constructionId } : { kind: 'utility', id: cfg.id },
      cfg.placeable.footprint,
    );
    emitArenaMapGridChanged(this.scene.game.events, {
      reason: 'placeable_added',
      source: rock.kind === 'turret' ? 'placeable_turret' : 'placeable_rock',
      obstacleId: rock.id,
      gridX: rock.gridX,
      gridY: rock.gridY,
    });
    return true;
  }

  placeInspectorConstruction(
    playerId: string,
    constructionId: ConstructionId,
    targetX: number,
    targetY: number,
  ): LoadoutUseResult {
    const canonicalConstructionId = normalizeConstructionId(constructionId);
    if (!bridge.isHost() || !canonicalConstructionId) return { ok: false, reason: 'invalid' };
    if (!this.getPlayerCapabilities(playerId).canPlace) return { ok: false, reason: 'blocked' };
    constructionId = canonicalConstructionId;
    const currentLoadout = bridge.getPlayerCurrentLoadoutSnapshot(playerId);
    const access = resolveConstructionAccess(
      constructionId,
      getConstructionAccessContext(this.resolveConfiguredGameMode(), currentLoadout),
    );
    if (!access.allowed) return { ok: false, reason: access.reason === 'locked' ? 'invalid' : 'blocked' };
    const player = this.ctx.playerManager.getPlayer(playerId);
    if (
      !player
      || !player.active
      || !this.ctx.combatSystem.isAlive(playerId)
      || this.ctx.combatSystem.isBurrowed(playerId)
    ) {
      return { ok: false, reason: 'blocked' };
    }
    const definition = getCoopDefenseConstructionDefinition(constructionId);
    if (this.ctx.loadoutManager?.isConstructionOnCooldown(playerId, constructionId, Date.now())) {
      return { ok: false, reason: 'cooldown' };
    }
    if (!this.hasFreeConstructionCapacity(playerId, definition.capacityCost)) {
      return { ok: false, reason: 'capacity' };
    }
    const hpMultiplier = definition.indestructible
      ? 1
      : 1 + (
        this.ctx.coopDefensePlayerModifierSystem?.getPercentageStat(playerId, 'construction.maxHp') ?? 0
      );
    const ownership = this.getConstructionOwnership(playerId);
    const utilityId = getUtilityIdForConstruction(constructionId);
    const utilityConfig = utilityId ? this.getEffectiveConstructionUtilityConfig(playerId, constructionId) : null;
    const construction = utilityConfig
      ? this.ctx.placementSystem?.tryPlaceRock(
        utilityConfig,
        playerId,
        player.color,
        player.x,
        player.y,
        targetX,
        targetY,
        Date.now(),
        ownership,
      )
      : this.ctx.placementSystem?.tryPlaceConstruction(
        definition,
        definition.maxHp * hpMultiplier,
        playerId,
        player.color,
        player.x,
        player.y,
        targetX,
        targetY,
        ownership,
      );
    if (!construction) return { ok: false, reason: 'placement' };

    if (definition.kind === 'pedestal') {
      const world = this.rockVisualHelper.gridToWorld(construction.gridX, construction.gridY);
      const registered = this.ctx.powerUpSystem?.registerConstructionPedestal(
        construction.id,
        definition.powerUpDefId,
        world.x,
        world.y,
        player.color,
      ) ?? false;
      if (!registered) {
        this.ctx.placementSystem?.removeRock(construction.id);
        return { ok: false, reason: 'placement' };
      }
    }

    const placedAt = Date.now();
    this.ctx.loadoutManager?.markConstructionUsed(playerId, constructionId, placedAt);
    // Ueber denselben Kanal wie Utility-Cooldowns, damit auch Clients den Bau-Cooldown
    // des gewaehlten Konstrukts im HUD sehen.
    bridge.publishUtilityCooldownUntil(playerId, placedAt + definition.buildCooldownMs, constructionId);
    this.rockVisualHelper.materializePlaceableRock(construction, true);
    this.registerNewPersistentPlaceable(
      construction,
      { kind: 'construction', id: constructionId },
      definition.footprint,
    );
    emitArenaMapGridChanged(this.scene.game.events, {
      reason: 'placeable_added',
      source: 'placeable_turret',
      obstacleId: construction.id,
      gridX: construction.gridX,
      gridY: construction.gridY,
    });
    bridge.recordConstructionBuilt(playerId);
    return { ok: true };
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
    if (!bridge.isHost() || tool.kind !== 'utility') return { ok: false, reason: 'invalid' };
    const currentLoadout = bridge.getPlayerCurrentLoadoutSnapshot(playerId);
    if (!currentLoadout || currentLoadout.coopDefenseClassId !== 'inspector_gadachs') {
      return { ok: false, reason: 'blocked' };
    }
    if (!(currentLoadout.tools ?? []).some((entry) => (
      entry.kind === 'utility' && (entry.id === tool.id || normalizeConstructionId(entry.id) === normalizeConstructionId(tool.id))
    ))) {
      return { ok: false, reason: 'blocked' };
    }
    const config = getUtilityConfigForMode(tool.id, this.resolveConfiguredGameMode()) as UtilityConfig | undefined;
    if (!config) return { ok: false, reason: 'invalid' };
    const constructionId = getConstructionIdForUtility(tool.id);
    if (constructionId) {
      const access = resolveConstructionAccess(
        constructionId,
        getConstructionAccessContext(this.resolveConfiguredGameMode(), currentLoadout),
      );
      if (!access.allowed) return { ok: false, reason: 'blocked' };
    }
    // Platzierbare Utilities (Mauer, Fliegenpilz) sind Konstrukte und belegen Kapazitaet;
    // Granaten und andere Utilities nicht.
    const capacityCost = getToolCapacityCost(tool);
    if (capacityCost > 0 && !this.hasFreeConstructionCapacity(playerId, capacityCost)) {
      return { ok: false, reason: 'capacity' };
    }
    return this.ctx.loadoutManager?.useInspectorUtility(
      playerId,
      config,
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

  private hasFreeConstructionCapacity(playerId: string, capacityCost: number): boolean {
    const used = this.ctx.placementSystem?.getUsedCapacity(playerId) ?? 0;
    return used + capacityCost <= this.getConstructionCapacity(playerId);
  }

  /** Persoenliches Kapazitaetsmaximum inklusive Item-Boni. Host-Autoritaet fuer das Bau-Gate. */
  private getConstructionCapacity(playerId: string): number {
    const currentLoadout = bridge.getPlayerCurrentLoadoutSnapshot(playerId);
    return resolveConstructionCapacity({
      gameMode: this.resolveConfiguredGameMode(),
      classId: currentLoadout?.coopDefenseClassId,
      modifiers: this.ctx.coopDefensePlayerModifierSystem?.getNumericStat(
        playerId,
        COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT,
      ) ?? 0,
    });
  }

  private getConstructionOwnership(playerId: string): ConstructionOwnership {
    return playerId === bridge.getLocalPlayerId() ? 'host-persistent' : 'guest-session';
  }

  private getEffectiveConstructionUtilityConfig(
    playerId: string,
    constructionId: ConstructionId,
  ): PlaceableUtilityConfig | null {
    const utilityId = getUtilityIdForConstruction(constructionId);
    if (!utilityId) return null;
    const base = getUtilityConfigForMode(utilityId, this.resolveConfiguredGameMode());
    if (!base || !('placeable' in base)) return null;
    const modifiers = this.ctx.coopDefensePlayerModifierSystem?.getModifiers(playerId);
    const effective = modifiers
      ? applyCoopDefenseModifiersToUtilityConfig(base as PlaceableUtilityConfig, {
        additive: modifiers.additiveStats,
        percentage: modifiers.percentageStats,
      }) as PlaceableUtilityConfig
      : base as PlaceableUtilityConfig;
    return {
      ...effective,
      id: utilityId,
      placeable: {
        ...effective.placeable,
        lifetimeMs: 0,
      },
    } as PlaceableUtilityConfig;
  }

  /**
   * Rueckbau eines eigenen Konstrukts. Gibt die Kapazitaet sofort frei und laeuft bewusst
   * nicht ueber den Zerstoerungspfad: Es gibt weder Explosion noch Sporenwolke.
   */
  dismantleInspectorConstruction(
    playerId: string,
    targetX: number,
    targetY: number,
  ): LoadoutUseResult {
    if (!bridge.isHost()) return { ok: false, reason: 'invalid' };
    if (!this.getPlayerCapabilities(playerId).canDismantle) return { ok: false, reason: 'blocked' };
    const currentLoadout = bridge.getPlayerCurrentLoadoutSnapshot(playerId);
    if (getActiveConstructionToolRefs(getConstructionAccessContext(this.resolveConfiguredGameMode(), currentLoadout)).length === 0) {
      return { ok: false, reason: 'blocked' };
    }
    const player = this.ctx.playerManager.getPlayer(playerId);
    if (
      !player
      || !player.active
      || !this.ctx.combatSystem.isAlive(playerId)
      || this.ctx.combatSystem.isBurrowed(playerId)
    ) {
      return { ok: false, reason: 'blocked' };
    }
    const cell = this.ctx.placementSystem?.getClampedTargetCell(
      player.x,
      player.y,
      targetX,
      targetY,
      COOP_DEFENSE_DISMANTLE_RANGE,
    );
    if (!cell) return { ok: false, reason: 'blocked' };
    const removed = this.ctx.placementSystem?.removeRockAt(
      cell.gridX,
      cell.gridY,
      playerId,
      this.getConstructionOwnership(playerId),
    );
    if (!removed) return { ok: false, reason: 'blocked' };

    this.finalizeDismantledConstruction(removed, true);
    this.ctx.gameAudioSystem.playSound('sfx_place_rock', cell.x, cell.y, playerId);
    emitArenaMapGridChanged(this.scene.game.events, {
      reason: 'placeable_removed',
      source: removed.kind === 'rock'
        ? 'placeable_rock'
        : removed.kind === 'pedestal' ? 'placeable_pedestal' : 'placeable_turret',
      obstacleId: removed.id,
      gridX: removed.gridX,
      gridY: removed.gridY,
    });
    return { ok: true };
  }

  /** Host-autorisierter Batch-Rueckbau ohne Reichweitenpruefung und ohne N-fache Finalisierung. */
  dismantleAllInspectorConstructions(playerId: string): LoadoutUseResult {
    if (!bridge.isHost()) return { ok: false, reason: 'invalid' };
    if (!this.getPlayerCapabilities(playerId).canDismantle) return { ok: false, reason: 'blocked' };
    const currentLoadout = bridge.getPlayerCurrentLoadoutSnapshot(playerId);
    const player = this.ctx.playerManager.getPlayer(playerId);
    if (getActiveConstructionToolRefs(getConstructionAccessContext(this.resolveConfiguredGameMode(), currentLoadout)).length === 0
      || !player?.active
      || !this.ctx.combatSystem.isAlive(playerId)
      || this.ctx.combatSystem.isBurrowed(playerId)) {
      return { ok: false, reason: 'blocked' };
    }

    const removed = this.ctx.placementSystem?.removeOwnedConstructions(
      playerId,
      this.getConstructionOwnership(playerId),
    ) ?? [];
    for (const construction of removed) {
      // Die visuellen Einzelobjekte muessen verschwinden; deren teure Schatten-/Occluder-
      // Aktualisierung wird vom RockVisualHelper auf genau einen POST_UPDATE-Flush gebuendelt.
      this.finalizeDismantledConstruction(construction, false);
    }
    if (removed.length > 0) {
      // Unvollstaendige Payload erzwingt bewusst genau einen Flowfield-/Fire-Resync fuer den Batch.
      emitArenaMapGridChanged(this.scene.game.events, {
        reason: 'placeables_batch_removed',
        source: 'placeable_rock',
      });
      this.ctx.gameAudioSystem.playSound('sfx_place_rock', player.x, player.y, playerId);
    }
    return { ok: true };
  }

  private finalizeDismantledConstruction(removed: SyncedPlaceableRock, playDust: boolean): void {
    // Abriss gibt den Besitz auf. Ohne diesen Schritt bliebe der Blueprint als dormant stehen und
    // erschiene bei der naechsten Mission wieder - der Spieler koennte nichts dauerhaft abbauen.
    const store = this.ctx.persistentBaseContributions;
    const ownerId = store?.getRuntimeBindings()
      .find((binding) => binding.runtimeId === removed.id)?.ownerId;
    const removedPersistentBlueprint = store?.removeByRuntimeId(removed.id) === true;
    if (store && ownerId && removedPersistentBlueprint && !store.hasActiveMission) {
      this.publishImmediatePersistentBaseContribution(ownerId);
    }
    this.releasePlaceableRuntime(removed, playDust);
  }

  /**
   * Raeumt das Runtime-Objekt einer Konstruktion ab, ohne ihren Besitz anzutasten.
   *
   * Der Unterschied zum Abriss ist der ganze Punkt: Eine durch einen Konflikt verdraengte
   * Konstruktion verschwindet aus der Welt, bleibt aber im persoenlichen Beitrag ihres Besitzers.
   */
  private releasePlaceableRuntime(removed: SyncedPlaceableRock, playDust: boolean): void {
    this.ctx.targetStatusSystem?.removeTarget({ targetType: 'construction', targetId: String(removed.id) });
    this.ctx.energyInjectorSystem?.removeTarget({ targetType: 'construction', targetId: String(removed.id) });
    if (removed.kind === 'pedestal') {
      this.ctx.powerUpSystem?.unregisterConstructionPedestal(removed.id);
    }
    this.rockVisualHelper.removePlaceableRockVisual(removed, playDust);
  }

  private placeTunnel(
    cfg: import('../../loadout/LoadoutConfig').TunnelUltimateConfig,
    playerId: string,
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    playerColor: number,
    params?: LoadoutUseParams,
  ): boolean {
    if (params?.tunnelStartGridX === undefined || params.tunnelStartGridY === undefined) return false;
    const placed = this.ctx.tunnelSystem?.tryPlaceTunnel(
      cfg,
      playerId,
      playerColor,
      originX,
      originY,
      params.tunnelStartGridX,
      params.tunnelStartGridY,
      targetX,
      targetY,
    ) ?? false;
    if (placed) {
      this.ctx.gameAudioSystem.playSound('sfx_place_dachstunnel', originX, originY, playerId);
    }
    return placed;
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
    const inspectorUtilityAction = this.ctx.inputSystem.getSelectedInspectorUtilityActionForHud();
    const hudData = buildInitialLocalArenaHudData({
      maxArmor: this.clientUpdate.getLocalMaxArmor(),
      maxAdrenaline: this.clientUpdate.getLocalMaxAdrenaline(),
      maxRage: this.clientUpdate.getLocalMaxRage(),
      ultimateRequiredRage: config.rageRequired,
      ultimateThresholds:   this.clientUpdate.getLocalUltimateThresholds(),
      ultimateId:            config.id,
      utilityId:             inspectorUtilityAction ? undefined : this.clientUpdate.getLocalUtilityConfig().id,
      utilityAction:         inspectorUtilityAction ?? undefined,
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
/** Rasterschluessel fuer Zellmengen des Composites. */
function cellKey(gridX: number, gridY: number): string {
  return `${gridX}:${gridY}`;
}

function resolveCompositeToolUnavailability(
  tool: PersistentRestoreToolDefinition,
): PersistentCompositeConflictReason | undefined {
  if (tool.unavailableReason === 'class-not-allowed') return 'class-not-allowed';
  if (tool.unavailableReason === 'mode-not-allowed') return 'mode-not-allowed';
  if (!tool.unlocked) return 'locked';
  if (tool.active === false) return 'not-in-loadout';
  return undefined;
}

/**
 * World-Parameter der LobbyWorld.
 *
 * Der Radius reist nur mit, wenn der Kern ueberhaupt existiert: Eine gesperrte Lobby traegt gar
 * keine persistente Basisstelle, und ein Radius ohne Stelle waere eine Konfiguration fuer etwas,
 * das es in dieser Instanz nicht gibt.
 */
function resolveLobbyWorldParameters(persistentBaseUnlocked: boolean): WorldParameters | undefined {
  if (!persistentBaseUnlocked) return undefined;
  return {
    persistentBaseUnlocked: true,
    persistentBaseRadiusCells: getStoredPersistentBaseRadiusCells(),
  };
}

function resolveRoundTimeOfDayMinutes(mapConfig: CoopDefenseMapConfig | null, lobbyMinutes: number): number {
  const configured = mapConfig?.timeOfDay;
  if (configured === undefined) return lobbyMinutes;
  // Die Konfiguration ist beim Laden validiert worden; der Rückfall deckt nur den Fall
  // ab, dass jemand die Registry zur Laufzeit umgeht.
  return parseTimeOfDay(configured) ?? DEFAULT_TIME_OF_DAY_MINUTES;
}
