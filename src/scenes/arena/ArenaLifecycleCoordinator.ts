import type Phaser from 'phaser';
import { bridge }            from '../../network/bridge';
import { ArenaBuilder }      from '../../arena/ArenaBuilder';
import { ArenaGenerator, ARENA_GENERATOR_VERSION } from '../../arena/ArenaGenerator';
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
import { getLocale } from '../../i18n';
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
import { getBaseRewardPickupWorldPosition, getBaseWorldBounds, getCoopDefenseBases, setActiveCoopDefenseBases, type BaseSpec } from '../../arena/BaseRegistry';
import { getCoopDefenseMapConfig, getPersistentBaseEditorMapConfig, getCoopDefenseMapXpReference, isWeaponBalanceLabMapId, objectiveUsesRespawnBudget, resolveCoopDefenseMapEncounterConfigs, resolveCoopDefenseMapMissionProgress, resolveCoopDefenseMapPersistentSpawnConfigs, resolveCoopDefenseMapSecondaryObjectives, type CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import { buildInitialLocalArenaHudData } from '../../ui/LocalArenaHudData';
import { ARENA_DURATION_SEC, HP_MAX, PLAYER_COLORS, COLORS, ARENA_OFFSET_X, CELL_SIZE, ARENA_WIDTH, ARENA_HEIGHT, ARENA_OFFSET_Y, GRID_COLS, GRID_ROWS, TEAM_BLUE_COLOR, TEAM_RED_COLOR, COOP_DEFENSE_BASE_TURRET_OWNER_ID, COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID, COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID, applyArenaMetricsForMode, COOP_DEFENSE_NAV_TICK_INTERVAL_MS, COOP_DEFENSE_NAV_TICK_DIVISOR_STRATEGIC } from '../../config';
import { DASH_GROUND_FIRE_BURN_DURATION_MS, DASH_GROUND_FIRE_DAMAGE_PER_TICK, DASH_T2_S, PLAYER_SPEED, SHOCKWAVE_DAMAGE, SHOCKWAVE_RADIUS } from '../../config';
import { TRAIN }             from '../../train/TrainConfig';
import { getClassicTrainEventPlan, getNextClassicTrainArrivalAt, type TrainEventPlan } from '../../train/TrainEvent';
import { TRAIN_DROP_COUNT }  from '../../powerups/PowerUpConfig';
import {
  getArenaRuntimeProfile,
  type ArenaRuntimeProfile,
} from './ArenaRuntimeProfile';
import {
  toMissionWorldDescriptor,
  toPersistentBaseEditorWorldDescriptor,
  type ArenaWorldDescriptor,
} from './ArenaWorldDescriptor';
import type { ArenaContext }          from './ArenaContext';
import type { RendererBundle }        from './RendererBundle';
import type { RockVisualHelper }      from './RockVisualHelper';
import type { PlacementPreviewRenderer } from './PlacementPreviewRenderer';
import type { HostUpdateCoordinator } from './HostUpdateCoordinator';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { LobbyOverlay }          from '../LobbyOverlay';
import type { ArenaDescriptor, ArenaLayout, GameMode, LoadoutCommitSnapshot, LoadoutUseParams, PersistentBaseEditorWorld, PlayerProfile, RoomQualitySnapshot } from '../../types';
import type { RoundConclusion, RoundResult, RoundState } from '../../network/NetworkBridge';
import { resolvePvpWinnerIds } from '../../network/RoomStatistics';
import type { RoomQualityMonitor }    from '../../network/RoomQualityMonitor';
import { CAPTURE_THE_BEER_MODE, isCoopDefenseMode, isTeamGameMode } from '../../gameModes';
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
  COOP_DEFENSE_CONSTRUCTION_MAX_SLOTS,
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
import { resolveArenaLoadProgress } from './ArenaLoadProgress';
import { resolveArenaStartTime } from './ArenaStartTiming';
import {
  getStoredHighestUnlockedCoopDefenseMapId,
  getStoredPersistentBaseOwnerId,
  getStoredPersistentBaseContribution,
  getStoredPersistentBaseRewardPlacements,
  getStoredPersistentBaseRadiusCells,
  getStoredPersistentBaseState,
  setStoredPersistentBaseContribution,
  setStoredPersistentBaseRewardPlacements,
} from '../../utils/localPreferences';
import { PersistentBaseRepository } from '../../persistentBase/PersistentBaseRepository';
import { PERSISTENT_BASE_CORE_ID, type PersistentBaseSiteView } from '../../persistentBase/PersistentBaseSite';
import { PersistentBaseSession } from '../../persistentBase/PersistentBaseSession';
import { PersistentBaseRoomState, type GuestPersistentConstruction } from '../../persistentBase/PersistentBaseRoomState';
import {
  planPersistentBaseRestore,
  type PersistentRestoreCandidate,
  type PersistentRestoreToolDefinition,
} from '../../persistentBase/PersistentBaseRestorePlanner';
import { getPersistentBaseAnchor, isPersistentFootprintInsideZone } from '../../persistentBase/PersistentBaseZone';
import type { PersistentBaseAnchor, PersistentToolRef } from '../../persistentBase/PersistentBaseTypes';
import { PersistentBaseRewardState } from '../../persistentBase/PersistentBaseRewardState';
import {
  PersistentBaseCompositeService,
  type PersistentBaseCompositeCheckpoint,
  type PersistentBaseCompositeSnapshot,
  type PersistentBaseMutation,
} from '../../persistentBase/PersistentBaseCompositeService';
import {
  getPersistentBaseRewardDefinition,
  type PersistentBaseRewardId,
} from '../../config/persistentBaseRewards';
import type {
  PersistentBaseMutationOperation,
  PersistentBaseMutationRequest,
  StructureOccupancyRequest,
} from '../../network/NetworkBridge';
import {
  StructureOccupancySystem,
  type StructureOccupancyDefinition,
} from '../../systems/StructureOccupancySystem';

type RuntimeDiagnosticEventSink = (type: string, fields?: Record<string, unknown>) => void;

type PersistentConstructionRemovalAcceptance = {
  readonly accepted: boolean;
  readonly checkpoint: PersistentBaseCompositeCheckpoint | null;
};

/**
 * Manages the arena round lifecycle.
 *
 * Responsibilities: buildArena / tearDownArena, LOBBY ↔ ARENA phase transitions,
 * host quality checks, round result saving, train event setup.
 * Mutates ArenaContext round-scoped fields (arenaResult, currentLayout, etc.).
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
  private lastRoundRevision = 0;
  private localArenaLoadReady = false;
  private terrainSnapshotReady = false;
  private terrainSnapshotGenerationId = 0;
  private hostStartupCachesPrepared = false;
  private preparedWorldLayout: { world: ArenaWorldDescriptor; layout: ArenaLayout } | null = null;
  private pendingHostArenaGeneration: {
    readonly roundRevision: number;
    readonly gameMode: GameMode;
    readonly mapConfig: CoopDefenseMapConfig | null;
    readonly seed: number;
  } | null = null;
  private runtimeDiagnosticEventSink: RuntimeDiagnosticEventSink | null = null;
  private hostArenaGenerationTimer: Phaser.Time.TimerEvent | null = null;
  private boundRoundStartTime = 0;
  private pendingClassicTrainEvent: {
    readonly trackX: number;
    readonly direction: 1 | -1;
    readonly plan: TrainEventPlan;
  } | null = null;
  /** Host-only room lifetime; never stored in local preferences and never cleared by map teardown. */
  private readonly persistentBaseRoomState = new PersistentBaseRoomState();
  private persistentBaseSession: PersistentBaseSession | null = null;
  private persistentBaseAnchor: PersistentBaseAnchor | null = null;
  private persistentBaseRadiusCells = 0;
  private persistentBaseRewardState: PersistentBaseRewardState | null = null;
  private persistentBaseCompositeService: PersistentBaseCompositeService | null = null;
  /** Profil der aktuell aufgebauten Welt; `null` bedeutet: keine Welt aufgebaut. */
  private runtimeProfile: ArenaRuntimeProfile | null = null;
  /** Nur die Editor-Runtime; die Mission-Ladebarriere hängt weiterhin an `arenaBuilt`. */
  private editorWorldRevision = 0;
  private readonly persistentBaseMutationRequests = new Map<string, Set<string>>();
  private readonly persistentRewardOccupancyIds = new Set<string>();
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

  /** True, sobald lokal eine Persistent-Base-Editor-Welt aufgebaut ist. */
  isPersistentBaseEditorRuntimeActive(): boolean {
    return this.runtimeProfile?.kind === 'persistent-base-editor';
  }

  getPersistentBaseCompositeSnapshot(): PersistentBaseCompositeSnapshot | null {
    return this.persistentBaseCompositeService?.getSnapshot() ?? bridge.getPersistentBaseCompositeSnapshot();
  }

  getPersistentBaseRadiusCells(): number {
    return this.persistentBaseRadiusCells > 0
      ? this.persistentBaseRadiusCells
      : bridge.getPersistentBaseCompositeSnapshot()?.radiusCells
        ?? bridge.getPersistentBaseEditorWorld()?.radiusCells
        ?? getStoredPersistentBaseRadiusCells();
  }

  /**
   * Die eine aufgelöste Site der gerade aufgebauten Welt. Kies, Bauzone, Zonenvorschau und
   * Platzierungsprüfung lesen ausschließlich diese Instanz.
   */
  getPersistentBaseSite(): PersistentBaseSiteView | null {
    const anchor = this.persistentBaseAnchor;
    if (!anchor || this.persistentBaseRadiusCells <= 0) return null;
    return { anchor, radiusCells: this.persistentBaseRadiusCells };
  }

  /**
   * Spawn-Fokus der Editor-Runtime. Mission und Editor benutzen denselben
   * Player-Runtime-Aktivierungspfad; der Fokus ist der einzige Unterschied.
   */
  getPersistentBaseEditorSpawnFocusCell(): { readonly gridX: number; readonly gridY: number } | null {
    return this.isPersistentBaseEditorRuntimeActive() ? this.persistentBaseAnchor : null;
  }

  /**
   * Einziger Einstiegspunkt der Editor-Runtime, pro Frame aus der Lobby gerufen.
   *
   * Host: hält die Welt, solange mindestens ein Teilnehmer existiert.
   * Client: baut die Welt ausschließlich, wenn der lokale Spieler selbst teilnimmt.
   * Alle übrigen Clients bleiben vollständig in der Lobby.
   */
  syncPersistentBaseEditorRuntime(): void {
    if (bridge.getGamePhase() !== 'LOBBY') {
      // In ARENA besitzt allein die Mission den Lifecycle. Ein Editor-Rest darf hier nicht
      // aufräumen und damit den Missionsaufbau anfassen.
      return;
    }
    if (bridge.isHost()) this.hostPublishPersistentBaseEditorWorld();

    const world = bridge.getPersistentBaseEditorWorld();
    const shouldHoldWorld = world !== null && (bridge.isHost()
      ? bridge.hasPersistentBaseEditorParticipant()
      : bridge.isLocalPersistentBaseEditorActive());
    if (!shouldHoldWorld) {
      this.tearDownPersistentBaseEditorRuntime();
      return;
    }
    if (!this.isPersistentBaseEditorRuntimeActive() || this.editorWorldRevision !== world.revision) {
      try {
        this.buildPersistentBaseEditorWorld(world);
      } catch (error) {
        console.error('[ArenaLifecycleCoordinator] Persistent-base editor world could not be built:', error);
        this.tearDownPersistentBaseEditorRuntime();
        return;
      }
    }
    this.syncPersistentBaseEditorPlayers();
  }

  /** Host-autoritativer Welt-Snapshot; er lebt ausschließlich, solange jemand editiert. */
  private hostPublishPersistentBaseEditorWorld(): void {
    if (!bridge.hasPersistentBaseEditorParticipant()) {
      if (bridge.getPersistentBaseEditorWorld()) bridge.publishPersistentBaseEditorWorld(null);
      return;
    }
    if (bridge.getPersistentBaseEditorWorld()) return;

    const mapConfig = getPersistentBaseEditorMapConfig();
    const seed = Date.now();
    this.applyWorldArenaMetrics(bridge.getGameMode(), mapConfig);
    const layout = ArenaGenerator.generate(seed, mapConfig);
    bridge.publishPersistentBaseEditorWorld({
      revision: seed,
      gameMode: bridge.getGameMode(),
      seed,
      arenaGeneratorVersion: ARENA_GENERATOR_VERSION,
      layoutFingerprint: ArenaGenerator.fingerprint(layout),
      radiusCells: getStoredPersistentBaseRadiusCells(),
    });
  }

  private buildPersistentBaseEditorWorld(world: PersistentBaseEditorWorld): void {
    this.applyWorldArenaMetrics(world.gameMode, getPersistentBaseEditorMapConfig());
    this.buildArena(toPersistentBaseEditorWorldDescriptor(world));
    this.editorWorldRevision = world.revision;
    // Der Host-Tick repliziert Spieler und Placeables. Alles Missionshafte ist bereits über das
    // Runtime-Profil abgeschaltet, deshalb braucht es hier keine weiteren Sonderfälle.
    this.hostUpdate.setActive(true);
    if (bridge.isHost()) {
      bridge.setPersistentBaseCompositeSnapshot(this.getPersistentBaseCompositeSnapshot());
    }
  }

  /** Räumt ausschließlich Editor-Zustand ab; der Mission-Lifecycle bleibt unberührt. */
  tearDownPersistentBaseEditorRuntime(): void {
    if (!this.isPersistentBaseEditorRuntimeActive()) return;
    for (const player of [...this.ctx.playerManager.getAllPlayers()]) {
      this.deactivatePlayerRuntime(player.id);
    }
    this.hostUpdate.setActive(false);
    this.tearDownArena();
    this.editorWorldRevision = 0;
    this.persistentBaseCompositeService = null;
    this.persistentBaseRewardState = null;
    this.persistentBaseAnchor = null;
    this.persistentBaseRadiusCells = 0;
    if (bridge.isHost()) {
      bridge.setPersistentBaseCompositeSnapshot(null);
      bridge.setPersistentBaseRewardRuntimeStates(null);
    }
  }

  /** Einzige Stelle, an der die globale Arena-Metrik an eine aufgebaute Welt gebunden wird. */
  private applyWorldArenaMetrics(gameMode: GameMode, mapConfig: CoopDefenseMapConfig | null): void {
    applyArenaMetricsForMode(
      gameMode,
      'ARENA',
      mapConfig?.arenaWidthCells,
      mapConfig?.arenaHeightCells,
    );
  }

  private syncPersistentBaseEditorPlayers(): void {
    if (!this.isPersistentBaseEditorRuntimeActive() || !this.ctx.currentLayout) return;
    const activeIds = new Set(bridge.getPersistentBaseEditorPlayerIds());
    const connectedIds = new Set(bridge.getConnectedPlayerIds());
    for (const player of [...this.ctx.playerManager.getAllPlayers()]) {
      if (!activeIds.has(player.id)) this.deactivatePlayerRuntime(player.id);
    }
    for (const runtime of this.ctx.placementSystem?.getAllRuntimeRocks() ?? []) {
      if (runtime.persistentRewardId || connectedIds.has(runtime.ownerId)) continue;
      const removed = this.ctx.placementSystem?.removeRock(runtime.id);
      if (!removed) continue;
      this.rockVisualHelper.removePlaceableRockVisual(removed, false);
      this.emitPersistentRestoreRemoved(removed);
    }
    for (const profile of bridge.getConnectedPlayers()) {
      if (!activeIds.has(profile.id)) continue;
      this.activatePlayerRuntime(profile);
    }
    this.syncPersistentBaseRuntimeContributions(connectedIds);
    const localParticipates = activeIds.has(bridge.getLocalPlayerId());
    this.localPlayerState.alive = localParticipates;
    this.localPlayerState.spectator = false;
    if (!localParticipates) this.localPlayerState.burrowed = false;
  }

  private syncPersistentBaseRuntimeContributions(connectedIds: ReadonlySet<string>): void {
    const service = this.persistentBaseCompositeService;
    if (!bridge.isHost() || !service) return;
    for (const playerId of connectedIds) {
      const contribution = bridge.getPlayerPersistentBaseContribution(playerId);
      if (!contribution) continue;
      const existing = service.getContribution(contribution.ownerId);
      if (!existing || contribution.revision >= existing.revision) service.setContribution(contribution);
    }

    const snapshot = service.getSnapshot();
    const activeById = new Map(snapshot.active.map((entry) => [entry.blueprint.persistentId, entry]));
    for (const runtime of this.ctx.placementSystem?.getAllRuntimeRocks() ?? []) {
      if (runtime.persistentRewardId || !runtime.persistentId) continue;
      if (!activeById.has(runtime.persistentId) || !connectedIds.has(runtime.ownerId)) {
        const removed = this.ctx.placementSystem?.removeRock(runtime.id);
        if (removed) {
          this.rockVisualHelper.removePlaceableRockVisual(removed, false);
          this.emitPersistentRestoreRemoved(removed);
        }
      }
    }
    for (const entry of snapshot.active) {
      const ownerId = entry.ownerId === getStoredPersistentBaseOwnerId()
        ? bridge.getHostPlayerId()
        : bridge.getConnectedPlayerIds().find((playerId) => (
          bridge.getPlayerPersistentBaseContribution(playerId)?.ownerId === entry.ownerId
        ));
      if (!ownerId || !connectedIds.has(ownerId)) continue;
      const existing = this.ctx.placementSystem?.getAllRuntimeRocks()
        .find((runtime) => runtime.persistentId === entry.blueprint.persistentId);
      if (existing) {
        if (existing.gridX === entry.gridX && existing.gridY === entry.gridY
          && existing.angle === entry.blueprint.angle) continue;
        const footprint = this.getPersistentRuntimeFootprint(existing);
        if (footprint) {
          const previous = { ...existing };
          const moved = this.ctx.placementSystem?.repositionRuntimeRock(
            existing.id,
            entry.gridX,
            entry.gridY,
            footprint,
            entry.blueprint.angle,
          );
          if (moved) {
            this.rockVisualHelper.removePlaceableRockVisual(previous, false);
            this.rockVisualHelper.materializePlaceableRock(moved, false);
            this.emitPersistentRestoreRemoved(previous);
            this.emitPersistentRestoreAdded(moved);
          }
        }
        continue;
      }
      if (entry.blueprint.rewardId) {
        const definition = getPersistentBaseRewardDefinition(entry.blueprint.rewardId);
        if (!definition) continue;
        const runtime = this.ctx.placementSystem?.materializePersistentReward(
          definition,
          entry.gridX,
          entry.gridY,
          entry.blueprint.angle,
          bridge.getHostPlayerId(),
          bridge.getPlayerColor(ownerId) ?? PLAYER_COLORS[0],
          entry.blueprint.persistentId,
        );
        if (runtime) {
          this.rockVisualHelper.materializePlaceableRock(runtime, false);
          this.registerPersistentRewardOccupancy(runtime);
          this.emitPersistentRestoreAdded(runtime);
        }
        continue;
      }
      const tool = this.buildPersistentCompositeRestoreTool(entry.blueprint.tool);
      if (!tool) continue;
      const runtime = this.materializePersistentRestoreCandidate(
        { blueprint: entry.blueprint, tool, gridX: entry.gridX, gridY: entry.gridY },
        ownerId,
        bridge.getPlayerColor(ownerId) ?? PLAYER_COLORS[0],
        ownerId === bridge.getHostPlayerId() ? 'host-persistent' : 'guest-session',
      );
      if (runtime) this.emitPersistentRestoreAdded(runtime);
    }
    bridge.setPersistentBaseCompositeSnapshot(snapshot);
  }

  private createPersistentBaseCompositeService(
    profile: ArenaRuntimeProfile,
    anchorBase: BaseSpec,
  ): void {
    if (!bridge.isHost() || !this.persistentBaseAnchor || !this.persistentBaseRewardState) return;

    const editorRuntime = !profile.missionPersistentBaseSession;
    const localContribution = editorRuntime
      ? getStoredPersistentBaseContribution()
      : this.persistentBaseSession?.getPersonalContribution() ?? getStoredPersistentBaseContribution();
    const contributions = new Map<string, import('../../persistentBase/PersistentBaseTypes').PersistentPlayerBaseContribution>();
    contributions.set(localContribution.ownerId, localContribution);

    if (editorRuntime) {
      for (const playerId of bridge.getConnectedPlayerIds()) {
        const contribution = bridge.getPlayerPersistentBaseContribution(playerId);
        if (contribution) contributions.set(contribution.ownerId, contribution);
      }
    } else {
      for (const entry of this.persistentBaseRoomState.getWorkingPersonalContributionsByPlayer()) {
        contributions.set(entry.contribution.ownerId, entry.contribution);
      }
    }

    const capacityMaxByOwner = new Map<string, number>();
    for (const contribution of contributions.values()) {
      const playerId = bridge.getConnectedPlayerIds().find((candidate) => (
        bridge.getPlayerPersistentBaseContribution(candidate)?.ownerId === contribution.ownerId
      )) ?? (contribution.ownerId === localContribution.ownerId ? bridge.getLocalPlayerId() : undefined);
      capacityMaxByOwner.set(
        contribution.ownerId,
        playerId ? this.getConstructionCapacity(playerId) : COOP_DEFENSE_CONSTRUCTION_MAX_SLOTS,
      );
    }

    this.persistentBaseCompositeService = new PersistentBaseCompositeService({
      ownerId: getStoredPersistentBaseOwnerId(),
      anchor: this.persistentBaseAnchor,
      radiusCells: this.persistentBaseRadiusCells,
      highestUnlockedMapId: getStoredHighestUnlockedCoopDefenseMapId(),
      contributions: [...contributions.values()],
      rewardState: this.persistentBaseRewardState,
      capacityMaxByOwner,
      authoredCells: new Set(anchorBase.cells.map((cell) => `${cell.gridX}:${cell.gridY}`)),
      resolveTool: (tool) => this.resolvePersistentTool(tool),
    });
    this.persistentBaseRewardState = this.persistentBaseCompositeService.getRewardState();
  }

  setRuntimeDiagnosticEventSink(sink: RuntimeDiagnosticEventSink | null): void {
    this.runtimeDiagnosticEventSink = sink;
  }

  getPersistentBaseRewardRuntimeStates(): readonly import('../../config/persistentBaseRewards').PersistentBaseRewardRuntimeState[] {
    return this.persistentBaseRewardState?.getRuntimeStates(
      getStoredHighestUnlockedCoopDefenseMapId(),
      Date.now(),
    ) ?? bridge.getPersistentBaseRewardRuntimeStates();
  }

  /** Host endpoint for editor/mission mutation requests registered by ArenaScene. */
  handlePersistentBaseMutation(
    playerId: string,
    operation: PersistentBaseMutationOperation,
    request: PersistentBaseMutationRequest,
  ): void {
    if (!bridge.isHost() || !request.requestId || !Number.isSafeInteger(request.revision)) return;
    const seen = this.persistentBaseMutationRequests.get(playerId) ?? new Set<string>();
    if (seen.has(request.requestId)) return;
    seen.add(request.requestId);
    this.persistentBaseMutationRequests.set(playerId, seen);

    // Das Profil der aufgebauten Welt entscheidet, welcher Persistenzpfad gilt – nicht die
    // Kombination aus Phase und Spielerpräsenz.
    const profile = this.runtimeProfile;
    if (!profile || !this.persistentBaseAnchor || !this.persistentBaseCompositeService) return;
    const editorRuntime = !profile.missionPersistentBaseSession;
    if (editorRuntime && !bridge.isPlayerPersistentBaseEditorActive(playerId)) return;
    if (!editorRuntime && (bridge.getGamePhase() !== 'ARENA' || !isCoopDefenseMode(bridge.getGameMode()))) return;
    this.handlePersistentBaseRuntimeMutation(playerId, operation, request, editorRuntime);
  }

  handleStructureEnterRequest(playerId: string, request: StructureOccupancyRequest): void {
    if (!bridge.isHost() || bridge.getGamePhase() !== 'ARENA' || !this.ctx.structureOccupancySystem) return;
    if (!request.requestId || (request.aimAngle !== undefined && !Number.isFinite(request.aimAngle))) return;
    if (!bridge.canPlayerAct(playerId) || !this.ctx.combatSystem.isAlive(playerId)) return;
    const aimAngle = request.aimAngle ?? 0;
    const structureId = this.ctx.structureOccupancySystem.selectStructure(playerId, aimAngle);
    if (request.structureId !== undefined && request.structureId !== structureId) return;
    if (!structureId) return;
    this.ctx.structureOccupancySystem.enter(playerId, structureId);
    bridge.setStructureOccupancySnapshot(this.ctx.structureOccupancySystem.getSnapshot());
  }

  handleStructureExitRequest(playerId: string, _request: StructureOccupancyRequest): void {
    if (!bridge.isHost() || !this.ctx.structureOccupancySystem) return;
    if (!_request.requestId) return;
    this.ctx.structureOccupancySystem.exit(playerId);
    bridge.setStructureOccupancySnapshot(this.ctx.structureOccupancySystem.getSnapshot());
  }

  /** Keeps the generic occupancy registry aligned with reliable placeable-rock snapshots. */
  syncPersistentBaseRewardOccupancy(): void {
    const occupancy = this.ctx.structureOccupancySystem;
    const placementSystem = this.ctx.placementSystem;
    if (!occupancy || !placementSystem) return;
    const liveIds = new Set<string>();
    for (const runtime of placementSystem.getAllRuntimeRocks()) {
      if (!runtime.persistentRewardId || !runtime.persistentId) continue;
      liveIds.add(runtime.persistentId);
      if (!this.persistentRewardOccupancyIds.has(runtime.persistentId)) {
        this.registerPersistentRewardOccupancy(runtime);
      }
    }
    for (const structureId of [...this.persistentRewardOccupancyIds]) {
      if (liveIds.has(structureId)) continue;
      occupancy.unregisterStructure(structureId);
      this.persistentRewardOccupancyIds.delete(structureId);
    }
    const snapshot = bridge.getStructureOccupancySnapshot();
    if (snapshot) occupancy.applySnapshot(snapshot);
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
    // Der Editor-Welt-Kanal ist reliable und global. Er wird beim Rundenstart aktiv geleert,
    // damit kein Editor-Zustand als alter globaler Wert in die Mission hineinreicht.
    bridge.publishPersistentBaseEditorWorld(null);
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
    const roundRevision = Math.max(Date.now(), this.lastRoundRevision + 1);
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
      persistentBaseRadiusCells: coopDefenseMapConfig?.persistentBase
        ? getStoredPersistentBaseState().radiusCells
        : undefined,
    };
    bridge.publishRoundState(roundState);
    bridge.setGamePhase('ARENA');
  }

  /** Called after the shared chunk scheduler has had its frame budget. */
  syncArenaLoadReady(view: WorldViewRect | null): void {
    if (bridge.getGamePhase() !== 'ARENA' || this.matchTerminated || !this.arenaBuilt || !view) return;
    this.syncAuthoritativeRoundStartAnchors();
    const participation = bridge.getRoundParticipation();
    const roundRevision = participation?.roundRevision ?? 0;
    if (roundRevision <= 0 || !this.ctx.arenaResult || !this.ctx.currentLayout) return;

    const hostStartupReady = bridge.isHost()
      ? this.prepareHostStartupCaches(Date.now())
      : true;
    const renderReady = ArenaBuilder.isSurfaceWorkingSetReady(this.ctx.arenaResult, view)
      && this.renderers.shadow.isStaticReadyForView(view, true);
    const localRenderReady = renderReady && this.terrainSnapshotReady;
    const groundStats = this.ctx.arenaResult.groundSurface?.getStats();
    const rockStats = this.ctx.arenaResult.rockOverlaySurface?.getStats();
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
    const loadProgress = resolveArenaLoadProgress(pending, resident, localRenderReady, hostStartupReady);
    bridge.setLocalArenaLoadProgress(
      roundRevision,
      loadProgress.progress,
      loadProgress.stage,
      loadProgress.ready,
    );
    this.localArenaLoadReady = loadProgress.ready;

    if (bridge.isHost()) this.tryScheduleArenaStart();
  }

  private tryScheduleArenaStart(): void {
    if (!bridge.isHost() || bridge.getGamePhase() !== 'ARENA') return;
    if (bridge.getArenaStartTime() > 0 || !bridge.areRoundParticipantsArenaLoadReady()) return;

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
    if (!isCoopDefenseMode(bridge.getGameMode())) {
      return arenaStartTime + ARENA_DURATION_SEC * 1000;
    }
    const mapConfig = getCoopDefenseMapConfig(bridge.getCoopDefenseMapId());
    if (mapConfig?.objective !== 'survive') return 0;
    const surviveDurationSec = mapConfig.surviveDurationSec;
    if (surviveDurationSec === undefined) {
      throw new Error(`[ArenaLifecycleCoordinator] Survival map ${mapConfig.mapId} has no surviveDurationSec`);
    }
    return arenaStartTime + surviveDurationSec * 1000;
  }

  spawnReadyPlayers(): void {
    // The phase switches to ARENA before host generation now. Do not create round entities until
    // buildArena has installed the matching layout and round-scoped systems.
    if (!bridge.isHost() || !this.arenaBuilt) return;
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
        this.activatePlayerRuntime(profile, { reconnectAfterDeath });
      }
    }
  }

  /**
   * Gemeinsamer Player-Runtime-Aktivierungspfad von Mission und Editor.
   *
   * Entity, Combat, Ressourcen, Items, Burrow, Ally-Flowfield und Loadout entstehen für beide
   * Laufzeiten in derselben Reihenfolge. Den Unterschied macht ausschließlich der Spawnpunkt,
   * den der PlayerManager über den Spawn-Fokus der jeweiligen Welt auflöst.
   */
  private activatePlayerRuntime(
    profile: PlayerProfile,
    options: { readonly reconnectAfterDeath?: boolean } = {},
  ): boolean {
    if (this.ctx.playerManager.hasPlayer(profile.id)) return false;
    this.ctx.playerManager.addPlayer(profile);
    if (!this.ctx.playerManager.getPlayer(profile.id)) return false;
    if (bridge.isHost()) {
      if (options.reconnectAfterDeath) {
        if (!this.ctx.combatSystem.spawnPlayerAfterReconnect(profile.id)) {
          this.ctx.playerManager.removePlayer(profile.id);
          return false;
        }
      } else {
        this.ctx.combatSystem.initPlayer(profile.id);
        this.ctx.coopDefenseRespawnBudgetSystem?.registerInitialSpawn(profile.id);
      }
      this.ctx.resourceSystem?.initPlayer(profile.id);
      this.ctx.coopDefenseItemRuntimeSystem?.initPlayer(profile.id);
      this.ctx.burrowSystem?.initPlayer(profile.id);
      this.ctx.loadoutManager?.resetUltimateState(profile.id);
      this.ctx.loadoutManager?.assignDefaultLoadout(profile.id, this.resolveRuntimeLoadoutSelection(profile.id));
    }
    // Nachzuegler (Reconnect, verspaetetes Loadout) bekommen ihr Ally-Flowfield hier; beim
    // Arenaaufbau existierten sie noch nicht.
    this.ensureAllyFlowField(profile.id);
    return true;
  }

  /** Gegenstück zu {@link activatePlayerRuntime}; identisch für Mission und Editor. */
  private deactivatePlayerRuntime(playerId: string): void {
    if (bridge.isHost()) {
      this.ctx.combatSystem.removePlayer(playerId);
      this.ctx.resourceSystem?.removePlayer(playerId);
      this.ctx.coopDefenseItemRuntimeSystem?.removePlayer(playerId);
      this.ctx.burrowSystem?.removePlayer(playerId);
      this.ctx.loadoutManager?.removePlayer(playerId);
    }
    this.ctx.hostPhysics.removePlayer(playerId);
    this.ctx.playerManager.removePlayer(playerId);
  }

  private prepareHostStartupCaches(now: number): boolean {
    if (!bridge.isHost() || this.hostStartupCachesPrepared) return this.hostStartupCachesPrepared;

    // A reconnect or a delayed committed-loadout snapshot can make the initial spawn arrive one
    // or more frames after the arena itself. Keep the cache gate behind the actual spawn state.
    this.spawnReadyPlayers();
    const participation = bridge.getRoundParticipation();
    if (!participation || participation.roundRevision <= 0) return false;

    const connected = new Set([...bridge.getConnectedPlayerIds(), bridge.getLocalPlayerId()]);
    const requiredIds = participation.participantIds.filter((id) => (
      connected.has(id) && !participation.spectatorIds.includes(id)
    ));
    if (requiredIds.length === 0) return false;
    const allInitialPlayersSpawned = requiredIds.every((id) => {
      const player = this.ctx.playerManager.getPlayer(id);
      return player?.sprite.active === true && this.ctx.combatSystem.isAlive(id);
    });
    if (!allInitialPlayersSpawned) return false;

    this.hostUpdate.prepareStartupCaches(now);
    this.hostStartupCachesPrepared = true;
    return true;
  }

  /**
   * Host: True, wenn das verbindliche Loadout (und im Coop-Modus das Coop-Profil) eines Spielers
   * vorliegt – Vorbedingung, um ihn mit der korrekten, eingefrorenen Auswahl zu spawnen statt mit
   * einem Live-Slot-Fallback. Spiegelt die Pro-Spieler-Bedingung aus {@link NetworkBridge.areAllPlayersReady}.
   */
  private hostHasCommittedLoadoutForSpawn(playerId: string): boolean {
    if (!bridge.hasCommittedLoadout(playerId)) return false;
    if (isCoopDefenseMode(bridge.getGameMode()) && !bridge.hasCommittedCoopDefenseProfile(playerId)) return false;
    return true;
  }

  syncHostLoadoutsFromCommittedSelections(): void {
    if (!bridge.isHost() || !this.ctx.loadoutManager) return;
    for (const profile of bridge.getConnectedPlayers()) {
      if (!this.ctx.playerManager.hasPlayer(profile.id)) continue;
      this.ctx.loadoutManager.syncSelectedLoadout(profile.id, this.resolveCommittedLoadoutSelection(profile.id));
    }
  }

  hostSaveRoundResults(roundEndedAt = Date.now(), countPvpMatch = false): void {
    if (!bridge.isHost()) return;
    const gameMode = bridge.getGameMode();
    const roundState = bridge.getRoundState();
    const mapName = isCoopDefenseMode(gameMode)
      ? getMapName(roundState?.coopDefenseMapId ?? bridge.getCoopDefenseMapId(), getLocale())
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
    const persistentSession = this.persistentBaseSession ?? this.ctx.persistentBaseSession;
    if (persistentSession) {
      if (roundConclusion === 'victory') {
        const committed = persistentSession.commit(
          (runtimeId) => this.ctx.placementSystem?.hasRuntimeRock(runtimeId) === true,
        );
        const contribution = {
          schemaVersion: 4 as const,
          ownerId: getStoredPersistentBaseOwnerId(),
          revision: committed.revision,
          constructions: committed.constructions.map((construction) => ({
            ...construction,
            ownerId: construction.ownerId ?? getStoredPersistentBaseOwnerId(),
            tool: { ...construction.tool },
          })),
        };
        setStoredPersistentBaseContribution(contribution);
        bridge.setLocalPersistentBaseContribution(contribution);
      } else {
        // Defeat, abort and non-Coop completion discard the round-local working copy.
        persistentSession.discard();
      }
    }
    if (this.persistentBaseRoomState.hasActiveMission) {
      if (roundConclusion === 'victory') {
        this.persistentBaseRoomState.commit((runtimeId) => this.ctx.placementSystem?.hasRuntimeRock(runtimeId) === true);
        for (const entry of this.persistentBaseRoomState.getCommittedPersonalContributionsByPlayer()) {
          if (entry.playerId === bridge.getLocalPlayerId()) continue;
          bridge.hostSetPlayerPersistentBaseContribution(entry.playerId, entry.contribution);
        }
      } else {
        this.persistentBaseRoomState.rollback();
      }
    }
    if (this.persistentBaseRewardState) {
      if (roundConclusion === 'victory') {
        this.persistentBaseRewardState.commitMission();
        setStoredPersistentBaseRewardPlacements(this.persistentBaseRewardState.getPlacements());
      } else {
        this.persistentBaseRewardState.rollbackMission();
      }
      this.publishPersistentBaseRewards();
      this.persistentBaseRewardState = null;
    }
    // A new round must load the repository's newly committed baseline. During an in-round map
    // transition the field remains alive; it is cleared only after the round outcome is decided.
    this.persistentBaseSession = null;
    this.persistentRewardOccupancyIds.clear();
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
        persistentBaseRadiusCells: currentRoundState?.persistentBaseRadiusCells,
        resultEligiblePlayerIds: bridge.getRoundResultEligiblePlayerIds(),
        endedAt: roundEndedAt,
      });
    } else {
      bridge.publishRoundState(null);
    }

    this.hostSaveRoundResults(roundEndedAt, roundConclusion !== 'aborted');
    bridge.publishCoopDefenseRespawnBudgetState(null);
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
    const mapId = bridge.getRoundState()?.coopDefenseMapId ?? bridge.getCoopDefenseMapId();
    if (!isWeaponBalanceLabMapId(mapId)) return;
    bridge.publishCoopDefenseEncounterPresentationState(null);
    bridge.publishCoopDefenseMapEventPresentationState(null);
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(null);
    bridge.publishCoopDefenseMissionProgressPresentationState(null);
    bridge.publishRoundState(null);
    bridge.publishRoundResults([]);
    bridge.publishCoopDefenseRespawnBudgetState(null);
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
      && bridge.canPlayerAct(localId);
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

  /**
   * Persönliche Konstruktionen unterliegen im Editor exakt denselben Klassen-, Unlock- und
   * Tool-Regeln wie in der Mission. Der Editor ersetzt nur die Quelle des Snapshots (Editor-Build
   * statt Ready-Commit) – er überspringt die Prüfung nicht.
   */
  getActiveConstructionToolsForPlayer(playerId: string): readonly LoadoutToolRef[] {
    return getActiveConstructionToolRefs(getConstructionAccessContext(
      bridge.getGameMode(),
      bridge.getPlayerRuntimeLoadout(playerId),
    ));
  }

  getConstructionCapacityForPlayer(playerId: string): number {
    return this.getConstructionCapacity(playerId);
  }

  private removeGuestSessionOwner(playerId: string): void {
    if (!bridge.isHost() || playerId === bridge.getLocalPlayerId()) return;
    this.ctx.structureOccupancySystem?.onPlayerDisconnect(playerId);
    const runtimeIds = this.persistentBaseRoomState.removeGuestSessionOwner(playerId);
    let removedCount = 0;
    for (const runtimeId of runtimeIds) {
      const removed = this.ctx.placementSystem?.removeRock(runtimeId);
      if (!removed) continue;
      this.finalizeDismantledConstruction(removed, false);
      removedCount += 1;
    }
    // Guest constructions outside a persistent base are still round-owned runtime objects and
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
  }

  /** Gemeinsamer Entkopplungspfad fuer Spectator, Disconnect und Arena-Teardown. */
  removePlayerFromActiveRound(playerId: string): void {
    if (bridge.isHost() && bridge.isArenaLoading() && bridge.getArenaStartTime() <= 0) {
      this.hostStartupCachesPrepared = false;
    }
    // Zielstatus und Injector-Fokus gehoeren zur laufenden Runde, nicht zur Lobby-Persona.
    // Deshalb muessen sie auch beim Disconnect/Spectator-Wechsel vor dem naechsten Snapshot
    // entfernt werden.
    this.ctx.targetStatusSystem?.removeTarget({ targetType: 'player', targetId: playerId });
    this.ctx.structureOccupancySystem?.onPlayerDisconnect(playerId);
    this.ctx.energyInjectorSystem?.removeOwner(playerId);
    if (bridge.isHost()) {
      this.ctx.coopDefenseObjectivePlacementRewardSystem?.handlePlayerUnavailable(playerId);
      this.ctx.coopDefenseCarrySystem?.handlePlayerUnavailable(playerId);
      this.ctx.combatSystem.removePlayer(playerId);
      this.ctx.resourceSystem?.removePlayer(playerId);
      this.ctx.coopDefenseItemRuntimeSystem?.removePlayer(playerId);
      this.ctx.burrowSystem?.removePlayer(playerId);
      this.ctx.loadoutManager?.removePlayer(playerId);
      this.ctx.powerUpSystem?.removePlayer(playerId);
      this.ctx.tunnelSystem?.removePlayer(playerId);
    }
    this.ctx.effectSystem.clearBurrowState(playerId);
    this.clientUpdate.removeBurrowPhase(playerId);
    this.ctx.hostPhysics.removePlayer(playerId);
    this.ctx.playerManager.removePlayer(playerId);
  }

  terminateMatch(reason?: string): void {
    if (this.matchTerminated) return;
    this.matchTerminated = true;
    this.arenaBuilt = false;
    this.arenaEnteredAt = 0;

    // A technical abort can happen before the normal round-conclusion path runs. Never carry a
    // half-written mission working state into a later round in the same room.
    if (bridge.isHost()) {
      this.persistentBaseSession?.discard();
      this.persistentBaseRoomState.rollback();
      this.persistentBaseSession = null;
    }

    this.isLocalReady = false;
    bridge.setLocalReady(false);
    if (bridge.isHost()) bridge.hostResetAllLobbyReady();
    this.roundStartPending = false;
    this.ctx.arenaCountdown?.clear();

    for (const p of [...this.ctx.playerManager.getAllPlayers()]) {
      if (bridge.isHost()) {
        this.ctx.combatSystem.removePlayer(p.id);
        this.ctx.resourceSystem?.removePlayer(p.id);
        this.ctx.coopDefenseItemRuntimeSystem?.removePlayer(p.id);
        this.ctx.burrowSystem?.removePlayer(p.id);
        this.ctx.loadoutManager?.removePlayer(p.id);
      }
      this.ctx.playerManager.removePlayer(p.id);
    }

    this.tearDownArena();
    this.ctx.leftPanel.transitionToLobby();
    this.ctx.leftPanel.setLobbyFieldsLocked(false);
    this.ctx.rightPanel.transitionToLobby();
    this.ctx.centerHUD.transitionToLobby();
    this.hostUpdate.setActive(false);

    if (bridge.isHost()) {
      bridge.setGamePhase('LOBBY');
    }

    this.lobbyOverlay.setReadyButtonState(false);
    this.lobbyOverlay.show();
    this.lobbyOverlay.showHostDisconnectedMessage(reason);
  }

  // ── Arena build / teardown ────────────────────────────────────────────────

  /**
   * ArenaWorld-Core. Baut Layout, Rendering, Placement und die Spieler-Runtime für jede
   * Laufzeit gleich; alles Missionsspezifische hängt an genau einem Flag des Runtime-Profils.
   */
  buildArena(world: ArenaWorldDescriptor): void {
    if (world.arenaGeneratorVersion !== ARENA_GENERATOR_VERSION) {
      throw new Error(
        `[ArenaLifecycleCoordinator] Unsupported arena generator version ${world.arenaGeneratorVersion}; expected ${ARENA_GENERATOR_VERSION}`,
      );
    }

    const prepared = this.preparedWorldLayout;
    const profile = getArenaRuntimeProfile(world.runtimeKind);
    this.tearDownArena();
    this.runtimeProfile = profile;
    this.ctx.runtimeProfile = profile;

    // Merge-Baseline der Delta-Slices (rocks/powerups/pedestals) verwerfen, damit keine Zustände aus
    // der Vorrunde in die neue Runde lecken (z. B. beschädigte Felsen direkt zu Match-Beginn).
    bridge.resetGameStateCache();

    // Map-ID bevorzugt aus dem (gegateten) RoundState lesen – derselbe reliable-Snapshot, der auch die
    // Spielerzahl trägt. So bauen Host und Client garantiert dieselben Basen aus EINEM Objekt. Fallback
    // auf den separaten Key für Alt-/Edge-Fälle (z. B. RoundState-Updates ohne Map-ID).
    const roundState = profile.roundLifecycle ? bridge.getRoundState() : null;
    // Der Weltinhalt hängt am Runtime-Profil, nicht an Sonderfällen: Die Mission löst ihre
    // Kampagnenkarte auf, der Editor seine eigene, kartenunabhängige Welt.
    const coopDefenseMapConfig = resolveWorldMapConfig(world, roundState?.coopDefenseMapId);
    const coopDefenseHumanPlayerCount = isCoopDefenseMode(world.gameMode)
      ? Math.max(1, Math.floor(roundState?.coopDefenseHumanPlayerCount ?? 1))
      : 1;
    const coopDefenseEnemyConfigs = isCoopDefenseMode(world.gameMode) && profile.enemies
      ? resolveCoopDefenseEnemyConfigs(coopDefenseHumanPlayerCount)
      : null;
    const coopDefenseBases = coopDefenseMapConfig
      ? getCoopDefenseBases(coopDefenseMapConfig, coopDefenseHumanPlayerCount)
      : [];
    // Ab hier ist das die eine Basenmenge der Welt; alle argumentlosen Leser sehen genau sie.
    setActiveCoopDefenseBases(coopDefenseBases);
    const locallyGeneratedLayout = prepared
      && prepared.world.revision === world.revision
      && prepared.world.seed === world.seed
      && prepared.world.layoutFingerprint === world.layoutFingerprint
      ? prepared.layout
      : ArenaGenerator.generate(world.seed, coopDefenseMapConfig ?? undefined);
    const actualFingerprint = ArenaGenerator.fingerprint(locallyGeneratedLayout);
    if (actualFingerprint !== world.layoutFingerprint) {
      throw new Error(
        `[ArenaLifecycleCoordinator] Arena fingerprint mismatch: expected ${world.layoutFingerprint}, got ${actualFingerprint}`,
      );
    }
    const layout = locallyGeneratedLayout;
    this.renderers.leafBlower.setTerrainMaterialLayout(
      layout,
      coopDefenseBases.flatMap((base) => base.cells),
    );
    this.preparedWorldLayout = null;
    // Die Ladebarriere gehört ausschließlich der Mission; der Editor darf sie nicht anfassen.
    if (profile.roundLifecycle) bridge.setLocalArenaLoadProgress(world.revision, 35, 'building');
    const coopDefensePersistentSpawnConfigs = coopDefenseMapConfig
      ? resolveCoopDefenseMapPersistentSpawnConfigs(coopDefenseMapConfig, coopDefenseHumanPlayerCount)
      : [];
    const coopDefenseEncounterConfigs = coopDefenseMapConfig
      ? resolveCoopDefenseMapEncounterConfigs(coopDefenseMapConfig, coopDefenseHumanPlayerCount)
      : [];
    const coopDefenseSecondaryObjectiveConfigs = coopDefenseMapConfig
      ? resolveCoopDefenseMapSecondaryObjectives(coopDefenseMapConfig, coopDefenseHumanPlayerCount)
      : [];
    const missionProgressConfig = coopDefenseMapConfig
      ? resolveCoopDefenseMapMissionProgress(coopDefenseMapConfig)
      : undefined;
    this.ctx.coopDefenseSecondaryObjectiveSystem = null;
    this.ctx.coopDefenseMissionProgressSystem = null;
    this.ctx.coopDefenseMissionBarrierManager?.destroy();
    this.ctx.coopDefenseMissionBarrierManager = null;
    this.ctx.hostHeldActionSystem?.reset();
    this.ctx.hostHeldActionSystem = bridge.isHost() ? new HostHeldActionSystem() : null;
    this.ctx.coopDefenseCarrySystem = null;
    this.ctx.coopDefenseTeamBuffSystem?.reset();
    this.ctx.coopDefenseTeamBuffSystem = bridge.isHost() && coopDefenseMapConfig
      ? new CoopDefenseTeamBuffSystem()
      : null;
    this.ctx.coopDefenseObjectiveRepairSystem = null;
    this.ctx.coopDefenseObjectivePlacementRewardSystem = null;
    this.ctx.coopDefenseSecondaryObjectiveConfigs = coopDefenseSecondaryObjectiveConfigs;
    if (bridge.isHost()) {
      if (profile.roundConclusion
        && coopDefenseMapConfig
        && objectiveUsesRespawnBudget(coopDefenseMapConfig.objective)) {
        const respawnsPerPlayer = coopDefenseMapConfig.respawnsPerPlayer;
        if (respawnsPerPlayer === undefined) {
          throw new Error(`[ArenaLifecycleCoordinator] Map ${coopDefenseMapConfig.mapId} has no respawnsPerPlayer`);
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
    const persistentBaseAnchorBase = coopDefenseBases
      .find((base) => base.id === PERSISTENT_BASE_CORE_ID);
    const persistentBaseGravelRadius = profile.roundLifecycle
      ? roundState?.persistentBaseRadiusCells
        ?? getStoredPersistentBaseState().radiusCells
      : world.persistentBaseRadiusCells
        ?? bridge.getPersistentBaseCompositeSnapshot()?.radiusCells
        ?? getStoredPersistentBaseRadiusCells();
    this.ctx.arenaResult = builder.buildDynamic(layout, {
      enablePersistentBaseGravel: Boolean(coopDefenseMapConfig?.persistentBase),
      persistentBaseGravel: persistentBaseAnchorBase
        ? {
          seed: world.seed,
          anchor: getPersistentBaseAnchor(persistentBaseAnchorBase),
          radiusCells: persistentBaseGravelRadius,
        }
        : undefined,
    });
    if (profile.roundLifecycle) bridge.setLocalArenaLoadProgress(world.revision, 60, 'building');
    // Die gestreamten Weltschichten haben nach dem Bau noch keinen residenten Chunk. Ohne diesen
    // Aufruf zeigte der erste Frame einen leeren Boden – die Kamera steht hier bereits.
    ArenaBuilder.updateSurfaceResidency(this.ctx.arenaResult, getVisibleWorldView(this.scene.cameras.main));
    this.ctx.placementSystem = new PlacementSystem(
      layout,
      this.ctx.arenaResult.rockGrid,
      this.ctx.playerManager,
      coopDefenseBases,
    );
    this.ctx.persistentBaseSession = null;
    this.persistentBaseCompositeService = null;
    if (coopDefenseMapConfig?.persistentBase) {
      const anchorBase = persistentBaseAnchorBase;
      if (!anchorBase || anchorBase.faction !== 'friendly' || anchorBase.role !== 'main') {
        throw new Error(
          `[ArenaLifecycleCoordinator] Persistent base anchor cannot resolve on map ${coopDefenseMapConfig.mapId}`,
        );
      }
      this.persistentBaseAnchor = getPersistentBaseAnchor(anchorBase);
      this.persistentBaseRadiusCells = persistentBaseGravelRadius;
      if (bridge.isHost() && profile.missionPersistentBaseSession && !this.persistentBaseSession) {
        const repository = new PersistentBaseRepository();
        const committedState = repository.load();
        this.persistentBaseSession = new PersistentBaseSession(
          repository,
          {
            anchor: getPersistentBaseAnchor(anchorBase),
            activeRadiusCells: committedState.radiusCells,
          ownerId: getStoredPersistentBaseOwnerId(),
          },
          committedState,
        );
      }
      if (bridge.isHost() && this.persistentBaseSession) {
        this.persistentBaseSession.rebindArena(
          getPersistentBaseAnchor(anchorBase),
          persistentBaseGravelRadius,
        );
        this.ctx.persistentBaseSession = this.persistentBaseSession;
      }
      if (bridge.isHost() && !this.persistentBaseRewardState) {
        this.persistentBaseRewardState = new PersistentBaseRewardState({
          placements: getStoredPersistentBaseRewardPlacements(),
          nowMs: Date.now(),
        });
        // Nur die Mission verbraucht Belohnungs-Cooldowns; der Editor plant sie nur um.
        if (profile.missionPersistentBaseSession) this.persistentBaseRewardState.beginMission();
      }
      if (bridge.isHost() && profile.missionPersistentBaseSession) this.persistentBaseRoomState.hydratePersonalContributions(
        bridge.getConnectedPlayerIds()
          .filter((playerId) => playerId !== bridge.getLocalPlayerId())
          .map((playerId) => ({
            playerId,
            contribution: bridge.getPlayerPersistentBaseContribution(playerId),
          }))
          .filter((entry): entry is { playerId: string; contribution: import('../../persistentBase/PersistentBaseTypes').PersistentPlayerBaseContribution } => entry.contribution !== null),
      );
      if (bridge.isHost() && profile.missionPersistentBaseSession) this.persistentBaseRoomState.beginMission();
      if (bridge.isHost()) this.createPersistentBaseCompositeService(profile, anchorBase);
      if (bridge.isHost()) this.publishPersistentBaseRewards();
      if (!bridge.isHost() && !profile.missionPersistentBaseSession) {
        const snapshot = bridge.getPersistentBaseCompositeSnapshot();
        if (snapshot) this.restorePersistentBaseComposite(snapshot, anchorBase);
      }
    } else {
      this.persistentBaseAnchor = null;
      this.persistentBaseRadiusCells = 0;
    }
    this.ctx.coopDefenseMissionBarrierManager = missionProgressConfig
      ? new CoopDefenseMissionBarrierManager(this.scene, missionProgressConfig, {
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
    this.ctx.captureTheBeerSystem = bridge.getGameMode() === CAPTURE_THE_BEER_MODE
      ? new CaptureTheBeerSystem(this.ctx.playerManager)
      : null;

    // Coop-Defense: BaseManager besitzt die Basis-Entities (Visual + Physik + HP + Sync).
    // Host und Client erzeugen identische BaseEntities aus der gemeinsamen Registry –
    // HP-Werte fließen über GameState.bases (Host → Client).
    this.ctx.baseManager = isCoopDefenseMode(bridge.getGameMode())
      ? new BaseManager(this.scene, coopDefenseBases, {
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
      })
      : null;
    this.ctx.baseManager?.setLightingSystem(this.renderers.lighting);
    this.ctx.enemyManager = isCoopDefenseMode(bridge.getGameMode()) && coopDefenseEnemyConfigs
      ? new EnemyManager(this.scene, coopDefenseEnemyConfigs)
      : null;
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
      && isCoopDefenseMode(bridge.getGameMode())
      && profile.roundConclusion
      && coopDefenseMapConfig
      ? new CoopDefenseRoundStateSystem({
        baseManager: this.ctx.baseManager,
        objective: coopDefenseMapConfig.objective,
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
      this.ctx.coopDefensePlayerModifierSystem = isCoopDefenseMode(bridge.getGameMode())
        ? new CoopDefensePlayerModifierSystem()
        : null;
      // Der lebende Affix-Zustand haengt am Modifier-System: ohne gerollte Affixwerte gibt es
      // nichts zu verfolgen.
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
            return player ? { x: player.sprite.x, y: player.sprite.y } : null;
          },
          getPlayerClassId: (playerId) => this.ctx.coopDefensePlayerModifierSystem?.getClassId(playerId) ?? null,
        })
        : null;
      this.ctx.coopDefenseItemRuntimeSystem?.setTargetStatusSystem(this.ctx.targetStatusSystem);
      this.syncHostCoopDefensePlayerModifiersFromCommittedSelections();

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
        cols: GRID_COLS,
        rows: GRID_ROWS,
        cellSize: CELL_SIZE,
        arenaOffsetX: ARENA_OFFSET_X,
        arenaOffsetY: ARENA_OFFSET_Y,
      };

      // Ein Coordinator fuer alle Runtime-Flowfields. Er haelt den Topologiespiegel, taktet die
      // Nav-Ticks und besitzt den Worker; die Services sind nur noch synchrone Lesefassaden.
      if (isCoopDefenseMode(bridge.getGameMode())) {
        const bossConfig = coopDefenseMapConfig?.boss
          ? getCoopDefenseEnemyConfig(coopDefenseMapConfig.boss.enemyKind)
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
          || coopDefenseMapConfig?.boss !== undefined
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
        this.ctx.coopDefenseBossSystem = coopDefenseMapConfig?.boss
          ? new CoopDefenseBossSystem(
            coopDefenseMapConfig.boss,
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
              mode: coopDefenseMapConfig?.objective === 'repel-assault' ? 'repel-assault' : 'scheduled',
              showComplete: coopDefenseMapConfig?.objective === 'repel-assault',
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
          isEligiblePlayer: (playerId) => bridge.canPlayerAct(playerId),
          getBasePosition: (baseId) => {
            const base = baseManager.getBase(baseId);
            if (!base) return null;
            return getBaseRewardPickupWorldPosition(
              base.getSpec(),
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
          roundRevision: world.revision,
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
          player.sprite.x,
          player.sprite.y,
        );
      }
      bridge.publishCoopDefenseMissionProgressPresentationState(
        this.ctx.coopDefenseMissionProgressSystem?.getPresentationState() ?? null,
      );
      this.ctx.coopDefenseCarrySystem = coopDefenseSecondaryObjectiveConfigs.some(
        (config) => config.type === 'carry' && config.carry !== undefined,
      )
        ? new CoopDefenseCarrySystem(coopDefenseSecondaryObjectiveConfigs, this.ctx.playerManager, {
          isPlayerEligible: (playerId) => bridge.canPlayerAct(playerId),
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
    this.ctx.combatSystem.setArenaObstacles(this.ctx.arenaResult.rockPhysicsProxies, this.ctx.arenaResult.trunkObjects);
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
      width: Math.ceil((ARENA_OFFSET_X + ARENA_WIDTH) / GROUND_FIRE_CELL_SIZE),
      height: Math.ceil((ARENA_OFFSET_Y + ARENA_HEIGHT) / GROUND_FIRE_CELL_SIZE),
      fireCellSize: GROUND_FIRE_CELL_SIZE,
      worldOriginX: ARENA_OFFSET_X,
      worldOriginY: ARENA_OFFSET_Y,
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
      for (const trunk of this.ctx.arenaResult?.trunkObjects ?? []) {
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
    this.ctx.combatSystem.setInitialSpawnAllowedResolver((playerId) => bridge.canPlayerInitialSpawn(playerId));
    this.ctx.combatSystem.setRespawnAllowedResolver((playerId) => bridge.canPlayerRespawn(playerId));
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
    this.ctx.combatSystem.setPlayerActionAllowedResolver((playerId) => bridge.canPlayerAct(playerId));
    this.ctx.loadoutManager?.setPlayerWeaponRangeMultiplierResolver((playerId) => (
      this.ctx.structureOccupancySystem?.getPlayerModifiers(playerId).weaponRangeMultiplier ?? 1
    ));
    this.ctx.combatSystem.setPlayerDirectDamageAllowedResolver((playerId) => (
      this.ctx.structureOccupancySystem?.isPlayerProtectedFromDirectDamage(playerId) !== true
    ));
    this.ctx.hostPhysics.setPlayerMovementAllowedResolver((playerId) => (
      this.ctx.structureOccupancySystem?.isActionAllowed(playerId, 'move') !== false
    ));
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
        isCoopDefenseMode(bridge.getGameMode())
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
      this.ctx.structureOccupancySystem?.onPlayerDeath(playerId);
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
        const occupancyMultiplier = this.ctx.structureOccupancySystem?.getPlayerModifiers(playerId)
          .adrenalineRegenMultiplier ?? 1;
        return base * itemMultiplier * teamMultiplier * occupancyMultiplier;
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
            .filter((rock) => rock.kind === 'turret' && rock.persistentRewardId === undefined)
            .map((rock) => ({
              id: rock.id,
              x: ARENA_OFFSET_X + rock.gridX * CELL_SIZE + CELL_SIZE / 2,
              y: ARENA_OFFSET_Y + rock.gridY * CELL_SIZE + CELL_SIZE / 2,
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
              && rock.persistentRewardId === undefined
              && rock.constructionId === 'tesla_turret'
              && rock.turretWeaponId === 'TURRET_TESLA'
              && rock.hp > 0
            ))
            .map(rock => {
              const x = ARENA_OFFSET_X + rock.gridX * CELL_SIZE + CELL_SIZE / 2;
              const y = ARENA_OFFSET_Y + rock.gridY * CELL_SIZE + CELL_SIZE / 2;
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
          .filter(r => r.kind === 'turret' && r.persistentRewardId === undefined)
          .map(r => ({
            id: r.id,
            x: ARENA_OFFSET_X + r.gridX * CELL_SIZE + CELL_SIZE / 2,
            y: ARENA_OFFSET_Y + r.gridY * CELL_SIZE + CELL_SIZE / 2,
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
        const dirX = hit.x - (dome?.sprite.x ?? hit.x);
        const dirY = hit.y - (dome?.sprite.y ?? hit.y);
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
          if (player) this.ctx.gameAudioSystem.playSound('sfx_place_decoy', player.sprite.x, player.sprite.y, playerId);
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
        if (!bridge.canPlayerAct(playerId)) return true;
        if (!this.ctx.combatSystem.isAlive(playerId)) return true;
        const occupancyAction = slot === 'weapon1' || slot === 'weapon2' ? 'weapon'
          : slot === 'utility' || slot === 'ultimate' ? 'utility' : null;
        if (occupancyAction && this.ctx.structureOccupancySystem?.isActionAllowed(playerId, occupancyAction) === false) return true;
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
        if (this.ctx.structureOccupancySystem?.isActionAllowed(playerId, 'weapon') === false) return true;
        if (this.ctx.burrowSystem?.isWeaponBlocked(playerId)) return true;
        if (this.ctx.hostPhysics?.isDashBurst(playerId)) return true;
        return false;
      });
      this.ctx.combatSystem.setDecoySystem(this.ctx.decoySystem);

      // Power-Ups, Pedestals und Nuke-Overrides gehören zu den Weltereignissen der Mission. Ohne
      // sie existiert das System gar nicht erst, statt inert mitzulaufen.
      this.ctx.powerUpSystem = !profile.worldEvents ? null : new PowerUpSystem(this.ctx.playerManager, this.ctx.combatSystem, layout, {
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
        coopDefenseMapXpReference: coopDefenseMapConfig
          ? getCoopDefenseMapXpReference(
            coopDefenseMapConfig,
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
      });
      this.ctx.powerUpSystem?.setConstructionRespawnMultiplierProvider((constructionId) => {
        const rock = this.ctx.placementSystem?.getRuntimeRock(constructionId);
        if (!rock) return 1;
        const world = this.rockVisualHelper.gridToWorld(rock.gridX, rock.gridY);
        return this.ctx.energyInjectorSystem?.getPowerUpRespawnMultiplierAt(world.x, world.y) ?? 1;
      });
      this.ctx.powerUpSystem?.setArenaStartTime(bridge.getArenaStartTime());
      this.ctx.combatSystem.setPowerUpSystem(this.ctx.powerUpSystem);
      this.ctx.resourceSystem.setPowerUpSystem(this.ctx.powerUpSystem);

      this.ctx.detonationSystem = new DetonationSystem(this.ctx.projectileManager);
      this.ctx.combatSystem.setDetonationSystem(this.ctx.detonationSystem);

      // Armageddon ist eine Ultimate-Wirkung; ohne Kampfsimulation gibt es sie nicht.
      this.ctx.armageddonSystem = profile.combatSimulation ? new ArmageddonSystem() : null;
      this.ctx.armageddonSystem?.setRockGrid(this.ctx.arenaResult.rockGrid);
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
        && this.ctx.powerUpSystem
        && this.ctx.armageddonSystem
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
      const coopDefenseAirstrikeEventHandler = isCoopDefenseMode(bridge.getGameMode()) && coopDefenseMapConfig
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
            .map((player) => ({ x: player.sprite.x, y: player.sprite.y })),
          isProtectedBasePoint: (x, y) => isPointNearBaseRegion(
            x,
            y,
            coopDefenseBases.map((base) => getBaseWorldBounds(base.region)),
          ),
          playStrikeAudio: (x, y) => {
            this.ctx.gameAudioSystem.playSound('sfx_airstrike_countdown', x, y);
          },
          arenaWidthCells: coopDefenseMapConfig.arenaWidthCells ?? GRID_COLS,
          arenaHeightCells: coopDefenseMapConfig.arenaHeightCells ?? GRID_ROWS,
          tutorialShowControls: coopDefenseMapConfig.tutorialShowControls,
        })
        : null;
      const coopDefenseGroundHazardEventHandler = isCoopDefenseMode(bridge.getGameMode()) && coopDefenseMapConfig
        ? new CoopDefenseGroundHazardEventHandler({
          fireSystem: this.ctx.fireSystem,
          prebuiltZones: layout.groundHazardZones ?? [],
          getNowMs: () => Date.now(),
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
        if (isCoopDefenseMode(bridge.getGameMode()) && (source?.enemyXp ?? 0) > 0) {
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
        const allowKillDrop = !isCoopDefenseMode(bridge.getGameMode());
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
      const coopDefenseMapEvents = coopDefenseMapConfig?.mapEvents ?? [];
      if (isCoopDefenseMode(bridge.getGameMode()) && coopDefenseMapConfig) {
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

    // Round-scoped renderers (all clients)
    this.renderers.train = new TrainRenderer(this.scene);
    this.renderers.train.setAudioSystem(this.ctx.gameAudioSystem);
    this.renderers.translocatorTeleport = new TranslocatorTeleportRenderer(this.scene);
    this.renderers.translocatorTeleport.setLightingSystem(this.renderers.lighting);
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
    // Vor dem Aufbau: Basiszellen und Basistürme sind reguläre statische Caster und müssen im
    // ersten Bake der Runde bereits mitlaufen. Dieselbe Quelle und dasselbe Gate wie die
    // Lichtverdeckung weiter unten – der Schatten kann nicht von der Kollision abweichen.
    this.renderers.shadow.setBaseShadowSource(
      () => this.ctx.baseManager?.getShadowCasters() ?? null,
    );
    this.renderers.shadow.rebuildArenaStaticShadows(
      this.ctx.currentLayout,
      this.ctx.arenaResult,
      this.ctx.placementSystem?.getAllRuntimeRocks() ?? [],
    );
    // Lichtverdeckung liest dieselben Hindernis-Referenzen wie `CombatSystem`
    // (siehe setArenaObstacles/setBaseObstacles weiter oben) – keine eigene Liste.
    this.ctx.lightOccluderIndex = new LightOccluderIndex({
      rocks: () => this.ctx.arenaResult?.rockPhysicsProxies ?? null,
      trunks: () => this.ctx.arenaResult?.trunkObjects ?? null,
      baseCells: () => this.ctx.baseManager?.getObstacleRectangles() ?? null,
      barrierCells: () => this.ctx.coopDefenseMissionBarrierManager?.getObstacleRectangles() ?? null,
      baseGeneration: () => this.ctx.baseManager?.getObstacleGeneration() ?? 0,
    });
    this.restorePersistentBase(coopDefenseMapConfig, coopDefenseBases);
    this.renderers.lighting.setOccluderIndex(this.ctx.lightOccluderIndex);
    this.renderers.lighting.setTimeOfDay(runtimeTimeOfDayMinutes);
    this.renderers.lighting.setActive(true);
    // Additive Effektgrafiken liegen teils über dem Lightmap-Overlay und werden vom
    // Ambient gar nicht erfasst; über hellem Boden brennen sie ohne diese Dämpfung aus.
    setEmissiveScale(resolveSkyState(runtimeTimeOfDayMinutes).emissiveScale);

    this.ctx.structureOccupancySystem = new StructureOccupancySystem({
      getPlayerPosition: (playerId) => {
        const player = this.ctx.playerManager.getPlayer(playerId);
        return player ? { x: player.sprite.x, y: player.sprite.y } : null;
      },
      getStructurePosition: (structureId) => {
        const runtime = this.ctx.placementSystem?.getAllRuntimeRocks()
          .find((candidate) => candidate.persistentId === structureId);
        if (!runtime) return null;
        return this.rockVisualHelper.gridToWorld(runtime.gridX, runtime.gridY);
      },
      getTeamPlayerIds: () => bridge.getConnectedPlayerIds(),
      onPlayerLockChanged: () => {
        if (bridge.isHost()) bridge.setStructureOccupancySnapshot(this.ctx.structureOccupancySystem?.getSnapshot() ?? null);
      },
      onStructureDestroyed: (_structureId, occupants) => {
        if (!bridge.isHost()) return;
        for (const playerId of occupants) {
          this.ctx.combatSystem.applyDamage(
            playerId,
            Number.MAX_SAFE_INTEGER,
            true,
            undefined,
            'persistent-base.structure-destroyed',
            undefined,
            { allowTeamDamage: true, ignoreDirectDamageProtection: true, damageKind: 'explosion' },
          );
        }
        bridge.setStructureOccupancySnapshot(this.ctx.structureOccupancySystem?.getSnapshot() ?? null);
      },
    });
    if (bridge.isHost()) {
      this.ctx.structureOccupancySystem.applySnapshot(bridge.getStructureOccupancySnapshot());
    }
    this.ctx.placementSystem?.setPersistentRewardDestroyedHandler(
      bridge.isHost() ? (runtime) => this.handlePersistentRewardDestroyed(runtime) : null,
    );

    // Reset per-round state in coordinators
    this.hostUpdate.resetPerRound();
    this.clientUpdate.resetPerRound();
    this.trainDestroyedShown = false;
  }

  tearDownArena(): void {
    this.terrainSnapshotGenerationId += 1;
    this.terrainSnapshotReady = false;
    this.cancelPendingHostArenaGeneration();
    this.localArenaLoadReady = false;
    this.hostStartupCachesPrepared = false;
    this.preparedWorldLayout = null;
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
    // Ausserhalb einer Runde gibt es keine Tageszeit; neutral zurücksetzen, damit die
    // Lobby nicht die Dämpfung der letzten Map erbt.
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

    if (this.ctx.arenaResult) {
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
    this.ctx.hostPhysics.setPlayerMovementAllowedResolver(null);
    this.ctx.hostPhysics.setMovementBlockedCellResolver(null);
    this.ctx.combatSystem.setDeathCallback(null);
    this.ctx.combatSystem.setEnemyDeathCallback(null);
    this.ctx.combatSystem.setPlayerMaxHpResolver(null);
    this.ctx.combatSystem.setInitialSpawnAllowedResolver(null);
    this.ctx.combatSystem.setRespawnAllowedResolver(null);
    this.ctx.combatSystem.setRespawnCallback(null);
    this.ctx.combatSystem.setAuthoritativePositionResetCallback(null);
    this.ctx.combatSystem.setPlayerActionAllowedResolver(null);
    this.ctx.loadoutManager?.setPlayerWeaponRangeMultiplierResolver(null);
    this.ctx.combatSystem.setPlayerDirectDamageAllowedResolver(null);
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
    this.ctx.rockRegistry   = null;
    this.ctx.currentLayout  = null;
    const detachedPlacementSystem = this.ctx.placementSystem;
    this.persistentBaseSession?.detachRuntimeObjects(
      (runtimeId) => detachedPlacementSystem?.hasRuntimeRock(runtimeId) === true,
    );
    this.persistentBaseRoomState.detachRuntimeObjects(
      (runtimeId) => detachedPlacementSystem?.hasRuntimeRock(runtimeId) === true,
    );
    this.ctx.persistentBaseSession = null;
    this.ctx.placementSystem = null;
    this.ctx.structureOccupancySystem?.onMapChange();
    for (const structureId of this.persistentRewardOccupancyIds) {
      this.ctx.structureOccupancySystem?.unregisterStructure(structureId);
    }
    this.persistentRewardOccupancyIds.clear();
    if (bridge.isHost()) bridge.setStructureOccupancySnapshot(null);
    this.ctx.structureOccupancySystem = null;
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
    this.renderers.leafBlower.setTerrainColorSnapshot(null);
    this.renderers.leafBlower.setTerrainMaterialLayout(null);
    this.ctx.tunnelSystem?.clear();
    this.ctx.tunnelSystem = null;
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
    this.renderers.shadow.clear();
    // Der ShadowSystem lebt über die Szene, der BaseManager nur über die Runde: Ohne Lösen zeigte
    // die Quelle auf die Basen der Vorrunde. Gleiche Begründung wie `setOccluderIndex(null)`.
    this.renderers.shadow.setBaseShadowSource(null);
    this.renderers.lighting.setActive(false);
    this.renderers.lighting.setOccluderIndex(null);
    this.ctx.lightOccluderIndex = null;
    this.renderers.translocatorTeleport = null;
    this.ctx.projectileManager.setTrainGroup(null);
    this.ctx.projectileManager.setTrainHitCallback(null);
    this.ctx.centerHUD.hideTrainWidget();
    this.clientUpdate.clientUtilityOverride = null;
    setActiveCoopDefenseBases(null);
    this.runtimeProfile = null;
    this.ctx.runtimeProfile = null;
  }

  private restorePersistentBase(
    mapConfig: CoopDefenseMapConfig | null,
    bases: readonly BaseSpec[],
  ): void {
    const session = this.ctx.persistentBaseSession;
    if (!mapConfig?.persistentBase || !this.ctx.placementSystem) return;

    const anchorBase = bases.find((base) => base.id === PERSISTENT_BASE_CORE_ID);
    const hostId = bridge.getLocalPlayerId();
    if (!anchorBase) return;

    // The shared composite service also gates mission mutations, but mission restoration must
    // still register runtime IDs in the transaction session/room state. Only the peaceful mode,
    // which has no mission session, uses the composite restore adapter here.
    if (this.persistentBaseCompositeService && !session) {
      this.restorePersistentBaseComposite(
        this.persistentBaseCompositeService.getSnapshot(),
        anchorBase,
      );
      return;
    }

    if (bridge.isHost() && this.persistentBaseRewardState) {
      for (const placement of this.persistentBaseRewardState.getPlacements()) {
        const definition = getPersistentBaseRewardDefinition(placement.rewardId);
        const availability = this.persistentBaseRewardState.getRuntimeState(
          placement.rewardId,
          getStoredHighestUnlockedCoopDefenseMapId(),
        ).availability;
        if (!definition || availability !== 'placed') continue;
        const gridX = getPersistentBaseAnchor(anchorBase).gridX + placement.relativeGridX;
        const gridY = getPersistentBaseAnchor(anchorBase).gridY + placement.relativeGridY;
        const runtime = this.ctx.placementSystem.materializePersistentReward(
          definition,
          gridX,
          gridY,
          placement.angle,
          hostId,
          bridge.getPlayerColor(hostId) ?? PLAYER_COLORS[0],
          placement.persistentId,
        );
        if (!runtime) continue;
        this.rockVisualHelper.materializePlaceableRock(runtime, false);
        if (definition.powerUpDefId) {
          const world = this.rockVisualHelper.gridToWorld(runtime.gridX, runtime.gridY);
          this.ctx.powerUpSystem?.registerPersistentPedestal(
            placement.persistentId,
            definition.powerUpDefId,
            world.x,
            world.y,
            runtime.ownerColor,
          );
        }
        this.registerPersistentRewardOccupancy(runtime);
        this.emitPersistentRestoreAdded(runtime);
      }
      this.publishPersistentBaseRewards();
    }
    if (!session) return;
    const committed = bridge.getPlayerCommittedLoadout(hostId);
    const tools = this.buildPersistentRestoreTools(hostId, committed?.coopDefenseProfile ?? null);
    const capacityMax = this.getConstructionCapacity(hostId);

    const plan = planPersistentBaseRestore({
      state: session.workingState,
      anchor: getPersistentBaseAnchor(anchorBase),
      activeRadiusCells: session.radiusCells,
      capacityUsed: this.ctx.placementSystem.getUsedCapacity(hostId),
      capacityMax,
      tools,
      isCellBlocked: (gridX, gridY) => !this.ctx.placementSystem!.canMaterializeCells(
        [{ dx: 0, dy: 0 }],
        gridX,
        gridY,
      ),
    });

    const ownerColor = bridge.getPlayerColor(hostId) ?? PLAYER_COLORS[0];
    for (const candidate of plan.active) {
      const runtime = this.materializePersistentRestoreCandidate(candidate, hostId, ownerColor, 'host-persistent');
      if (!runtime) continue;
      session.registerRestored(candidate.blueprint, runtime.id);
      this.emitPersistentRestoreAdded(runtime);
    }
    if (plan.dormant.length > 0) {
      this.runtimeDiagnosticEventSink?.('persistent-base:restore-dormant', {
        mapId: mapConfig.mapId,
        count: plan.dormant.length,
      });
    }

    // Guest blueprints are planned in one deterministic owner/order sequence after the host. The
    // placement grid is the shared collision authority, so a host object always wins a cell race.
    const guestBlueprints = [...this.persistentBaseRoomState.getWorkingBlueprints()]
      .sort(compareGuestRestoreBlueprints);
    for (const blueprint of guestBlueprints) {
      const guestCommitted = bridge.getPlayerCommittedLoadout(blueprint.ownerId);
      const guestTools = this.buildPersistentRestoreTools(
        blueprint.ownerId,
        guestCommitted?.coopDefenseProfile ?? null,
      );
      const guestPlan = planPersistentBaseRestore({
        state: {
          schemaVersion: session.workingState.schemaVersion,
          radiusCells: session.workingState.radiusCells,
          revision: session.workingState.revision,
          constructions: [blueprint],
        },
        anchor: getPersistentBaseAnchor(anchorBase),
        activeRadiusCells: session.radiusCells,
        capacityUsed: this.ctx.placementSystem.getUsedCapacity(blueprint.ownerId),
        capacityMax: this.getConstructionCapacity(blueprint.ownerId),
        tools: guestTools,
        isCellBlocked: (gridX, gridY) => !this.ctx.placementSystem!.canMaterializeCells(
          [{ dx: 0, dy: 0 }],
          gridX,
          gridY,
        ),
      });
      const guestColor = bridge.getPlayerColor(blueprint.ownerId) ?? PLAYER_COLORS[0];
      for (const candidate of guestPlan.active) {
        const runtime = this.materializePersistentRestoreCandidate(
          candidate,
          blueprint.ownerId,
          guestColor,
          'guest-session',
        );
        if (!runtime) continue;
        this.persistentBaseRoomState.registerRestored(blueprint, runtime.id);
        this.emitPersistentRestoreAdded(runtime);
      }
    }
  }

  private restorePersistentBaseComposite(
    snapshot: PersistentBaseCompositeSnapshot,
    anchorBase: BaseSpec,
  ): void {
    if (!this.ctx.placementSystem) return;
    const hostId = bridge.getLocalPlayerId();
    for (const entry of snapshot.active) {
      const ownerId = entry.ownerId === getStoredPersistentBaseOwnerId()
        ? hostId
        : bridge.getConnectedPlayerIds().find((playerId) => (
          bridge.getPlayerPersistentBaseContribution(playerId)?.ownerId === entry.ownerId
        )) ?? hostId;
      const ownerColor = bridge.getPlayerColor(ownerId) ?? PLAYER_COLORS[0];
      if (entry.blueprint.rewardId) {
        const definition = getPersistentBaseRewardDefinition(entry.blueprint.rewardId);
        if (!definition) continue;
        const runtime = this.ctx.placementSystem.materializePersistentReward(
          definition,
          entry.gridX,
          entry.gridY,
          entry.blueprint.angle,
          hostId,
          ownerColor,
          entry.blueprint.persistentId,
        );
        if (!runtime) continue;
        this.rockVisualHelper.materializePlaceableRock(runtime, false);
        this.registerPersistentRewardOccupancy(runtime);
        this.emitPersistentRestoreAdded(runtime);
        continue;
      }
      const tool = this.buildPersistentCompositeRestoreTool(entry.blueprint.tool);
      if (!tool) continue;
      const runtime = this.materializePersistentRestoreCandidate(
        { blueprint: entry.blueprint, tool, gridX: entry.gridX, gridY: entry.gridY },
        ownerId,
        ownerColor,
        ownerId === hostId ? 'host-persistent' : 'guest-session',
      );
      if (runtime) this.emitPersistentRestoreAdded(runtime);
    }
    if (bridge.isHost()) {
      bridge.setPersistentBaseCompositeSnapshot(snapshot);
      this.publishPersistentBaseRewards();
    }
  }

  private handlePersistentBaseRuntimeMutation(
    playerId: string,
    operation: PersistentBaseMutationOperation,
    request: PersistentBaseMutationRequest,
    editorRuntime: boolean,
  ): void {
    const service = this.persistentBaseCompositeService;
    const placementSystem = this.ctx.placementSystem;
    const anchor = this.persistentBaseAnchor;
    if (!service || !placementSystem || !anchor
      || (editorRuntime ? bridge.getGamePhase() !== 'LOBBY' : bridge.getGamePhase() !== 'ARENA')) return;

    const ownerId = this.getPersistentBaseMutationOwnerId(playerId);
    const revision = editorRuntime
      ? request.revision
      : service.getContribution(ownerId)?.revision ?? request.revision;
    const angle = request.angle ?? 0;
    let mutation: PersistentBaseMutation | null = null;

    if (operation === 'place' && request.toolRef
      && Number.isSafeInteger(request.relativeGridX)
      && Number.isSafeInteger(request.relativeGridY)
      && Number.isFinite(angle)) {
      const resolved = this.resolvePersistentTool(request.toolRef);
      if (!resolved) return;
      const relativeGridX = request.relativeGridX as number;
      const relativeGridY = request.relativeGridY as number;
      const gridX = anchor.gridX + relativeGridX;
      const gridY = anchor.gridY + relativeGridY;
      if (!this.isPersistentBaseMutationInRange(playerId, gridX, gridY)
        || !isPersistentFootprintInsideZone(gridX, gridY, resolved.footprint, anchor, this.persistentBaseRadiusCells)
        || !placementSystem.canMaterializeCells(resolved.footprint, gridX, gridY)) return;
      mutation = {
        operation,
        ownerId,
        revision,
        tool: request.toolRef,
        relativeGridX,
        relativeGridY,
        angle,
      };
    } else if ((operation === 'remove' || operation === 'reposition') && request.persistentId) {
      const runtime = placementSystem.getAllRuntimeRocks()
        .find((candidate) => candidate.persistentId === request.persistentId);
      if (!runtime || !this.canPersistentRuntimeOwnerMutate(playerId, runtime)) return;
      if (!this.ctx.structureOccupancySystem?.canMoveStructure(request.persistentId)) return;
      if (operation === 'remove') {
        if (!this.isPersistentBaseMutationInRange(playerId, runtime.gridX, runtime.gridY)) return;
        if (runtime.persistentRewardId) {
          mutation = {
            operation: 'reward-unplace',
            ownerId,
            revision,
            rewardId: runtime.persistentRewardId,
          };
        } else {
          mutation = { operation, ownerId, revision, persistentId: request.persistentId };
        }
      } else if (Number.isSafeInteger(request.relativeGridX)
        && Number.isSafeInteger(request.relativeGridY)
        && Number.isFinite(angle)) {
        const footprint = this.getPersistentRuntimeFootprint(runtime);
        if (!footprint) return;
        const relativeGridX = request.relativeGridX as number;
        const relativeGridY = request.relativeGridY as number;
        const gridX = anchor.gridX + relativeGridX;
        const gridY = anchor.gridY + relativeGridY;
        if (!this.isPersistentBaseMutationInRange(playerId, gridX, gridY)
          || !isPersistentFootprintInsideZone(gridX, gridY, footprint, anchor, this.persistentBaseRadiusCells)
          || !placementSystem.canRepositionCells(runtime.id, gridX, gridY, footprint)) return;
        mutation = {
          operation,
          ownerId,
          revision,
          persistentId: request.persistentId,
          relativeGridX,
          relativeGridY,
          angle,
        };
      }
    } else if (operation === 'reward-place' && request.rewardId
      && Number.isSafeInteger(request.relativeGridX)
      && Number.isSafeInteger(request.relativeGridY)) {
      const rewardId = request.rewardId as PersistentBaseRewardId;
      const definition = getPersistentBaseRewardDefinition(rewardId);
      if (!definition || service.getRewardState().getPlacement(rewardId)) return;
      const relativeGridX = request.relativeGridX as number;
      const relativeGridY = request.relativeGridY as number;
      const gridX = anchor.gridX + relativeGridX;
      const gridY = anchor.gridY + relativeGridY;
      if (!this.isPersistentBaseMutationInRange(playerId, gridX, gridY)
        || !isPersistentFootprintInsideZone(gridX, gridY, definition.footprint, anchor, this.persistentBaseRadiusCells)
        || !placementSystem.canMaterializeCells(definition.footprint, gridX, gridY)) return;
      mutation = {
        operation,
        ownerId,
        revision,
        rewardId,
        relativeGridX,
        relativeGridY,
        angle,
      };
    } else if (operation === 'reward-unplace' && request.rewardId) {
      if (playerId !== bridge.getHostPlayerId()) return;
      const placement = service.getRewardState().getPlacement(request.rewardId as PersistentBaseRewardId);
      const runtime = placement
        ? placementSystem.getAllRuntimeRocks().find((candidate) => candidate.persistentId === placement.persistentId)
        : undefined;
      if (!placement || !runtime || !this.isPersistentBaseMutationInRange(playerId, runtime.gridX, runtime.gridY)) return;
      mutation = {
        operation,
        ownerId,
        revision,
        rewardId: request.rewardId as PersistentBaseRewardId,
      };
    }
    if (!mutation) return;

    const checkpoint = service.createCheckpoint();
    const result = service.apply(mutation);
    if (!result.accepted) return;

    if (mutation.operation === 'place' && result.contribution) {
      const blueprint = result.contribution.constructions[result.contribution.constructions.length - 1];
      const active = blueprint
        ? result.snapshot.active.find((entry) => entry.blueprint.persistentId === blueprint.persistentId)
        : undefined;
      const tool = blueprint ? this.buildPersistentCompositeRestoreTool(blueprint.tool) : null;
      if (!active || !tool) {
        service.restoreCheckpoint(checkpoint);
        return;
      }
      const runtime = this.materializePersistentRestoreCandidate(
        { blueprint: active.blueprint, tool, gridX: active.gridX, gridY: active.gridY },
        playerId,
        bridge.getPlayerColor(playerId) ?? PLAYER_COLORS[0],
        playerId === bridge.getHostPlayerId() ? 'host-persistent' : 'guest-session',
      );
      if (!runtime || !this.registerAcceptedPersistentRuntime(
        runtime,
        active.blueprint,
        playerId,
        ownerId,
      )) {
        if (runtime) {
          if (runtime.kind === 'pedestal') this.ctx.powerUpSystem?.unregisterConstructionPedestal(runtime.id);
          placementSystem.removeRock(runtime.id);
          this.rockVisualHelper.removePlaceableRockVisual(runtime, false);
        }
        service.restoreCheckpoint(checkpoint);
        return;
      }
      this.emitPersistentRestoreAdded(runtime);
    } else if (mutation.operation === 'reward-place') {
      const rewardMutation = mutation;
      const placement = service.getRewardState().getPlacement(rewardMutation.rewardId);
      const definition = placement ? getPersistentBaseRewardDefinition(placement.rewardId) : null;
      if (placement && definition) {
        const runtime = placementSystem.materializePersistentReward(
          definition,
          anchor.gridX + placement.relativeGridX,
          anchor.gridY + placement.relativeGridY,
          placement.angle,
          bridge.getHostPlayerId(),
          bridge.getPlayerColor(bridge.getHostPlayerId()) ?? PLAYER_COLORS[0],
          placement.persistentId,
        );
        if (runtime) {
          this.rockVisualHelper.materializePlaceableRock(runtime, false);
          this.registerPersistentRewardOccupancy(runtime);
          this.emitPersistentRestoreAdded(runtime);
        } else {
          service.restoreCheckpoint(checkpoint);
          return;
        }
      } else {
        service.restoreCheckpoint(checkpoint);
        return;
      }
    } else if (mutation.operation === 'remove' || mutation.operation === 'reposition' || mutation.operation === 'reward-unplace') {
      const rewardMutation = mutation.operation === 'reward-unplace'
        ? mutation as Extract<PersistentBaseMutation, { operation: 'reward-unplace' }>
        : null;
      const repositionMutation = mutation.operation === 'reposition'
        ? mutation as Extract<PersistentBaseMutation, { operation: 'reposition' }>
        : null;
      const runtime = request.persistentId
        ? placementSystem.getAllRuntimeRocks().find((candidate) => candidate.persistentId === request.persistentId)
        : rewardMutation
          ? placementSystem.getAllRuntimeRocks().find((candidate) => candidate.persistentRewardId === rewardMutation.rewardId)
          : undefined;
      if (runtime && (mutation.operation === 'remove' || mutation.operation === 'reward-unplace')) {
        if (runtime.persistentRewardId) {
          if (!this.removePersistentRewardRuntime(runtime)) {
            service.restoreCheckpoint(checkpoint);
            return;
          }
        } else {
          const removed = placementSystem.removeRock(runtime.id);
          if (removed) {
            this.removeAcceptedPersistentRuntime(removed, playerId);
            this.finalizeDismantledConstruction(removed, false);
            this.emitPersistentRestoreRemoved(removed);
          } else {
            service.restoreCheckpoint(checkpoint);
            return;
          }
        }
      } else if (runtime && mutation.operation === 'reposition') {
        const previous = { ...runtime };
        const footprint = this.getPersistentRuntimeFootprint(runtime);
        if (footprint && repositionMutation) {
          const moved = placementSystem.repositionRuntimeRock(
            runtime.id,
            anchor.gridX + repositionMutation.relativeGridX,
            anchor.gridY + repositionMutation.relativeGridY,
            footprint,
            repositionMutation.angle ?? 0,
          );
          if (moved) {
            if (!this.updateAcceptedPersistentRuntime(moved, playerId)) {
              const restored = placementSystem.repositionRuntimeRock(
                moved.id,
                previous.gridX,
                previous.gridY,
                footprint,
                previous.angle,
              );
              if (restored) {
                this.rockVisualHelper.removePlaceableRockVisual(moved, false);
                this.rockVisualHelper.materializePlaceableRock(restored, false);
              }
              service.restoreCheckpoint(checkpoint);
              return;
            }
            this.rockVisualHelper.removePlaceableRockVisual(previous, false);
            this.rockVisualHelper.materializePlaceableRock(moved, false);
            this.emitPersistentRestoreRemoved(previous);
            this.emitPersistentRestoreAdded(moved);
          } else {
            service.restoreCheckpoint(checkpoint);
            return;
          }
        } else {
          service.restoreCheckpoint(checkpoint);
          return;
        }
      } else {
        service.restoreCheckpoint(checkpoint);
        return;
      }
    }

    // Persist only after the runtime adapter has accepted/materialized the mutation. A failed
    // materialization restores the service checkpoint and must not leave a half-committed
    // contribution in local storage or in the reliable per-player snapshot.
    if (result.contribution && editorRuntime) {
      if (ownerId === getStoredPersistentBaseOwnerId()) {
        setStoredPersistentBaseContribution(result.contribution);
        bridge.setLocalPersistentBaseContribution(result.contribution);
      } else {
        bridge.hostSetPlayerPersistentBaseContribution(playerId, result.contribution);
      }
    }
    if (editorRuntime && (
      mutation.operation === 'reward-place'
      || mutation.operation === 'reward-unplace'
      || (mutation.operation === 'reposition'
        && service.getRewardState().getPlacements().some((placement) => (
          placement.persistentId === mutation.persistentId
        )))
    )) {
      setStoredPersistentBaseRewardPlacements(service.getRewardState().getPlacements());
    }
    bridge.setPersistentBaseCompositeSnapshot(result.snapshot);
    this.publishPersistentBaseRewards();
  }

  private getPersistentBaseMutationOwnerId(playerId: string): string {
    return playerId === bridge.getLocalPlayerId()
      ? getStoredPersistentBaseOwnerId()
      : bridge.getPlayerPersistentBaseContribution(playerId)?.ownerId ?? playerId;
  }

  private registerAcceptedPersistentRuntime(
    runtime: SyncedPlaceableRock,
    blueprint: import('../../persistentBase/PersistentBaseTypes').PersistentConstruction,
    playerId: string,
    ownerId: string,
  ): boolean {
    const footprint = this.getPersistentRuntimeFootprint(runtime);
    const anchor = this.persistentBaseAnchor;
    if (!footprint || !anchor) return false;
    // Ohne Missions-Session gibt es keine Runden-Buchführung, die etwas übernehmen könnte.
    if (!this.runtimeProfile?.missionPersistentBaseSession) return true;
    if (runtime.ownership === 'guest-session') {
      return this.persistentBaseRoomState.registerAccepted(
        runtime,
        blueprint,
        playerId,
        ownerId,
        footprint,
        anchor,
        this.persistentBaseRadiusCells,
      ) !== null;
    }
    return this.persistentBaseSession?.registerAccepted(runtime, blueprint, footprint) !== null;
  }

  /** Mission und Editor teilen denselben Persistent-Base-Runtime-Pfad, sobald er aufgebaut ist. */
  private isSharedPersistentBaseRuntime(): boolean {
    if (this.persistentBaseCompositeService === null || this.persistentBaseAnchor === null) return false;
    return this.runtimeProfile?.missionPersistentBaseSession
      ? bridge.getGamePhase() === 'ARENA' && isCoopDefenseMode(bridge.getGameMode())
      : bridge.getGamePhase() === 'LOBBY';
  }

  private acceptPersistentConstructionPlacement(
    playerId: string,
    runtime: SyncedPlaceableRock,
    constructionId: ConstructionId,
  ): boolean {
    const service = this.persistentBaseCompositeService;
    const anchor = this.persistentBaseAnchor;
    if (!service || !anchor) return false;
    const checkpoint = service.createCheckpoint();
    const ownerId = this.getPersistentBaseMutationOwnerId(playerId);
    const contribution = service.getContribution(ownerId);
    const result = service.apply({
      operation: 'place',
      ownerId,
      revision: contribution?.revision ?? 0,
      tool: { kind: 'construction', id: constructionId },
      relativeGridX: runtime.gridX - anchor.gridX,
      relativeGridY: runtime.gridY - anchor.gridY,
      angle: Number.isFinite(runtime.angle) ? runtime.angle : 0,
    });
    if (!result.accepted || !result.contribution) return false;
    const blueprint = result.contribution.constructions[result.contribution.constructions.length - 1];
    const active = blueprint
      ? result.snapshot.active.find((entry) => entry.blueprint.persistentId === blueprint.persistentId)
      : undefined;
    if (!blueprint || !active || !this.ctx.placementSystem?.setPersistentId(runtime.id, blueprint.persistentId)) {
      service.restoreCheckpoint(checkpoint);
      return false;
    }
    if (!this.registerAcceptedPersistentRuntime(runtime, active.blueprint, playerId, ownerId)) {
      this.ctx.placementSystem?.removeRock(runtime.id);
      service.restoreCheckpoint(checkpoint);
      return false;
    }
    if (bridge.getGamePhase() === 'LOBBY') {
      if (ownerId === getStoredPersistentBaseOwnerId()) {
        setStoredPersistentBaseContribution(result.contribution);
        bridge.setLocalPersistentBaseContribution(result.contribution);
      } else {
        bridge.hostSetPlayerPersistentBaseContribution(playerId, result.contribution);
      }
    }
    bridge.setPersistentBaseCompositeSnapshot(result.snapshot);
    this.publishPersistentBaseRewards();
    return true;
  }

  private acceptPersistentConstructionRemoval(
    playerId: string,
    runtime: SyncedPlaceableRock,
  ): PersistentConstructionRemovalAcceptance {
    if (!this.isSharedPersistentBaseRuntime()) return { accepted: true, checkpoint: null };
    const service = this.persistentBaseCompositeService;
    if (!service || !runtime.persistentId) return { accepted: false, checkpoint: null };
    const ownerId = this.getPersistentBaseMutationOwnerId(playerId);
    const contribution = service.getContribution(ownerId);
    const checkpoint = service.createCheckpoint();
    const mutation: PersistentBaseMutation = runtime.persistentRewardId
      ? {
        operation: 'reward-unplace',
        ownerId,
        revision: contribution?.revision ?? 0,
        rewardId: runtime.persistentRewardId,
      }
      : {
        operation: 'remove',
        ownerId,
        revision: contribution?.revision ?? 0,
        persistentId: runtime.persistentId,
      };
    const result = service.apply(mutation);
    return result.accepted
      ? { accepted: true, checkpoint }
      : { accepted: false, checkpoint: null };
  }

  private publishPersistentBaseMutationState(): void {
    const service = this.persistentBaseCompositeService;
    if (!service) return;
    if (bridge.getGamePhase() === 'LOBBY') {
      setStoredPersistentBaseRewardPlacements(service.getRewardState().getPlacements());
    }
    bridge.setPersistentBaseCompositeSnapshot(service.getSnapshot());
    this.publishPersistentBaseRewards();
  }

  private removeAcceptedPersistentRuntime(runtime: SyncedPlaceableRock, playerId: string): void {
    if (runtime.ownership === 'guest-session') {
      this.persistentBaseRoomState.removeRuntimePlacement(runtime.id);
      return;
    }
    this.persistentBaseSession?.removeRuntimePlacement(runtime.id);
    if (playerId !== bridge.getHostPlayerId()) {
      this.persistentBaseRoomState.removeRuntimePlacement(runtime.id);
    }
  }

  private updateAcceptedPersistentRuntime(runtime: SyncedPlaceableRock, playerId: string): boolean {
    const anchor = this.persistentBaseAnchor;
    if (!anchor) return false;
    if (!this.runtimeProfile?.missionPersistentBaseSession) return true;
    if (runtime.ownership === 'guest-session') {
      return this.persistentBaseRoomState.updateRuntimePlacement(
        runtime.id,
        runtime.gridX,
        runtime.gridY,
        runtime.angle,
        anchor,
      );
    }
    if (!this.persistentBaseSession?.updateRuntimePlacement(
      runtime.id,
      runtime.gridX,
      runtime.gridY,
      runtime.angle,
    )) return false;
    if (playerId !== bridge.getHostPlayerId()) {
      if (!this.persistentBaseRoomState.updateRuntimePlacement(
        runtime.id,
        runtime.gridX,
        runtime.gridY,
        runtime.angle,
        anchor,
      )) return false;
    }
    return true;
  }

  private canPersistentRuntimeOwnerMutate(playerId: string, runtime: SyncedPlaceableRock): boolean {
    if (runtime.persistentRewardId) return playerId === bridge.getHostPlayerId();
    if (runtime.ownerId === playerId) return true;
    return runtime.ownerId === bridge.getPlayerPersistentBaseContribution(playerId)?.ownerId;
  }

  private buildPersistentCompositeRestoreTool(tool: PersistentToolRef): PersistentRestoreToolDefinition | null {
    const resolved = this.resolvePersistentTool(tool);
    if (!resolved) return null;
    let maxHp = 1;
    if (tool.kind === 'construction') {
      try {
        maxHp = getCoopDefenseConstructionDefinition(tool.id as ConstructionId).maxHp;
      } catch {
        return null;
      }
    } else {
      const config = getUtilityConfigForMode(tool.id, bridge.getGameMode());
      if (!config || !('placeable' in config)) return null;
      maxHp = config.placeable.maxHp;
    }
    return {
      kind: tool.kind,
      id: tool.id,
      footprint: resolved.footprint,
      capacityCost: resolved.capacityCost ?? 0,
      maxHp,
      unlocked: true,
      active: true,
    };
  }

  private isPersistentBaseMutationInRange(playerId: string, gridX: number, gridY: number): boolean {
    const player = this.ctx.playerManager.getPlayer(playerId);
    const placementSystem = this.ctx.placementSystem;
    // Ohne Kampfsimulation gibt es keinen Lebenszustand, gegen den geprüft werden könnte.
    const requiresAliveCheck = this.runtimeProfile?.combatSimulation ?? true;
    if (!player || !placementSystem || !player.sprite.active
      || (requiresAliveCheck && !this.ctx.combatSystem.isAlive(playerId))) return false;
    const target = placementSystem.getWorldPointForCell(gridX, gridY);
    return Math.hypot(player.sprite.x - target.x, player.sprite.y - target.y) <= COOP_DEFENSE_DISMANTLE_RANGE;
  }

  private getPersistentRuntimeFootprint(
    runtime: SyncedPlaceableRock,
  ): readonly { readonly dx: number; readonly dy: number }[] | null {
    if (runtime.persistentRewardId) {
      return getPersistentBaseRewardDefinition(runtime.persistentRewardId)?.footprint ?? null;
    }
    if (runtime.footprint && runtime.footprint.length > 0) return runtime.footprint;
    if (runtime.constructionId) {
      return getCoopDefenseConstructionDefinition(runtime.constructionId).footprint;
    }
    if (runtime.toolRef?.kind === 'utility') {
      const config = getUtilityConfigForMode(runtime.toolRef.id, bridge.getGameMode());
      if (config && 'placeable' in config) return config.placeable.footprint;
    }
    return null;
  }

  private findPersistentRewardRuntime(persistentId: string): SyncedPlaceableRock | null {
    return this.ctx.placementSystem?.getAllRuntimeRocks()
      .find((runtime) => runtime.persistentId === persistentId && runtime.persistentRewardId !== undefined) ?? null;
  }

  private removePersistentRewardRuntime(runtime: SyncedPlaceableRock): boolean {
    const removed = this.ctx.placementSystem?.removeRock(runtime.id);
    if (!removed) return false;
    if (runtime.persistentId) {
      this.ctx.structureOccupancySystem?.unregisterStructure(runtime.persistentId);
      this.persistentRewardOccupancyIds.delete(runtime.persistentId);
    }
    if (runtime.persistentId) this.ctx.powerUpSystem?.unregisterPersistentPedestal(runtime.persistentId);
    this.rockVisualHelper.removePlaceableRockVisual(runtime, false);
    emitArenaMapGridChanged(this.scene.game.events, {
      reason: 'placeable_removed',
      source: runtime.kind === 'pedestal' ? 'placeable_pedestal' : runtime.kind === 'turret' ? 'placeable_turret' : 'placeable_rock',
      obstacleId: runtime.id,
      gridX: runtime.gridX,
      gridY: runtime.gridY,
    });
    return true;
  }

  private handlePersistentRewardDestroyed(runtime: SyncedPlaceableRock): void {
    if (!bridge.isHost() || !runtime.persistentRewardId || !this.persistentBaseRewardState) return;
    const persistentId = runtime.persistentId;
    if (persistentId) this.ctx.structureOccupancySystem?.onStructureDestroyed(persistentId);
    const changed = this.persistentBaseRewardState.markRuntimeDestroyed(
      runtime.persistentRewardId,
      getStoredHighestUnlockedCoopDefenseMapId(),
      Date.now(),
    );
    if (changed) this.publishPersistentBaseRewards();
  }

  private publishPersistentBaseRewards(): void {
    if (!bridge.isHost()) return;
    const state = this.persistentBaseRewardState;
    if (!state) {
      bridge.setPersistentBaseRewardRuntimeStates(null);
      return;
    }
    state.setNow(Date.now());
    bridge.setPersistentBaseRewardRuntimeStates(
      state.getRuntimeStates(getStoredHighestUnlockedCoopDefenseMapId(), Date.now()),
    );
  }

  private registerPersistentRewardOccupancy(runtime: SyncedPlaceableRock): void {
    const occupancy = this.ctx.structureOccupancySystem;
    const persistentId = runtime.persistentId;
    const rewardId = runtime.persistentRewardId;
    if (!occupancy || !persistentId || !rewardId) return;
    const definition = getPersistentBaseRewardDefinition(rewardId);
    if (!definition || (definition.constructionType !== 'watchtower' && definition.constructionType !== 'burrow')) return;
    occupancy.registerStructure({
      id: persistentId,
      kind: definition.constructionType,
      capacity: definition.constructionType === 'watchtower' ? 4 : 'team',
      interactionRange: CELL_SIZE * 1.5,
      movementLocked: true,
      weaponsAllowed: definition.constructionType === 'watchtower',
      utilityAllowed: definition.constructionType === 'watchtower',
      dashAllowed: false,
      constructionAllowed: false,
      directDamageImmune: definition.constructionType === 'burrow',
      weaponRangeMultiplier: definition.weaponRangeMultiplier,
      adrenalineRegenMultiplier: definition.adrenalineRegenMultiplier,
    } satisfies StructureOccupancyDefinition);
    this.persistentRewardOccupancyIds.add(persistentId);
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

  private emitPersistentRestoreRemoved(runtime: SyncedPlaceableRock): void {
    emitArenaMapGridChanged(this.scene.game.events, {
      reason: 'placeable_removed',
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
    profile: NonNullable<LoadoutCommitSnapshot['coopDefenseProfile']> | null,
  ): PersistentRestoreToolDefinition[] {
    const committed = bridge.getPlayerCommittedLoadout(playerId);
    const accessContext = getConstructionAccessContext(bridge.getGameMode(), committed);
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
        const config = getUtilityConfigForMode(utilityId, bridge.getGameMode());
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
        const config = getUtilityConfigForMode(utilityId, bridge.getGameMode());
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
          candidate.blueprint.persistentId,
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
        candidate.blueprint.persistentId,
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
    if (!this.persistentBaseAnchor || this.persistentBaseRadiusCells <= 0) return;
    if (runtime.ownership === 'guest-session') {
      this.persistentBaseRoomState.registerNew(
        runtime,
        runtime.ownerId,
        normalizedTool,
        footprint,
        this.persistentBaseAnchor,
        this.persistentBaseRadiusCells,
        bridge.getPlayerPersistentBaseContribution(runtime.ownerId)?.ownerId ?? runtime.ownerId,
      );
      return;
    }
    this.ctx.persistentBaseSession?.registerNew(runtime, normalizedTool, footprint);
  }

  private resolvePersistentTool(tool: PersistentToolRef): {
    readonly footprint: readonly { readonly dx: number; readonly dy: number }[];
    readonly capacityCost?: number;
  } | null {
    if (tool.kind === 'construction') {
      try {
        const definition = getCoopDefenseConstructionDefinition(tool.id as ConstructionId);
        return { footprint: definition.footprint, capacityCost: definition.capacityCost };
      } catch {
        return null;
      }
    }
    const config = getUtilityConfigForMode(tool.id, bridge.getGameMode());
    if (!config || !('placeable' in config)) return null;
    return {
      footprint: config.placeable.footprint,
      capacityCost: getToolCapacityCost({ kind: 'utility', id: tool.id }),
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private scheduleHostArenaGeneration(request: {
    readonly roundRevision: number;
    readonly gameMode: GameMode;
    readonly mapConfig: CoopDefenseMapConfig | null;
    readonly seed: number;
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
      bridge.setLocalArenaLoadProgress(request.roundRevision, 10, 'generating');
      try {
        applyArenaMetricsForMode(
          request.gameMode,
          'ARENA',
          request.mapConfig?.arenaWidthCells,
          request.mapConfig?.arenaHeightCells,
        );
        const layout = ArenaGenerator.generate(request.seed, request.mapConfig ?? undefined);
        const descriptor: ArenaDescriptor = {
          roundRevision: request.roundRevision,
          gameMode: request.gameMode,
          mapId: request.mapConfig?.mapId ?? null,
          seed: request.seed,
          arenaGeneratorVersion: ARENA_GENERATOR_VERSION,
          layoutFingerprint: ArenaGenerator.fingerprint(layout),
        };
        this.preparedWorldLayout = { world: toMissionWorldDescriptor(descriptor), layout };
        bridge.publishArenaDescriptor(descriptor);
        this.onTransitionToArena();
      } catch (error) {
        console.error('[ArenaLifecycleCoordinator] Lokale Arena-Erzeugung fehlgeschlagen:', error);
        this.terminateMatch('Lokale Arena-Erzeugung fehlgeschlagen (Generator/Fingerprint abweichend).');
      }
    });
  }

  private cancelPendingHostArenaGeneration(): void {
    this.hostArenaGenerationTimer?.remove(false);
    this.hostArenaGenerationTimer = null;
    this.pendingHostArenaGeneration = null;
  }

  private onTransitionToArena(): void {
    // Install the independent black loading screen before the descriptor/round snapshot arrives.
    // A phase change must never expose the arena during the retry window.
    this.ctx.arenaCountdown?.showLoading();
    this.lobbyOverlay.lockButton();
    this.lobbyOverlay.hide();
    const descriptor = bridge.getArenaDescriptor();
    // Im Coop-Modus zusätzlich auf den reliable RoundState warten: er trägt Spielerzahl und
    // bestätigt die Runde, aus denen Basen/Druckquellen/Gegner lokal gebaut werden.
    const roundState = bridge.getRoundState();
    const roundStateReady = roundState?.status === 'active'
      && roundState.roundStartTime === bridge.getArenaStartTime();
    const participation = bridge.getRoundParticipation();
    const pendingHostGeneration = this.pendingHostArenaGeneration;
    if (bridge.isHost()
      && pendingHostGeneration
      && participation?.roundRevision === pendingHostGeneration.roundRevision
      && roundStateReady
      && descriptor?.roundRevision !== pendingHostGeneration.roundRevision) {
      this.scheduleHostArenaGeneration(pendingHostGeneration);
      return;
    }
    if (!descriptor
      || !participation
      || descriptor.roundRevision !== participation.roundRevision
      || descriptor.gameMode !== bridge.getGameMode()
      || !roundStateReady) {
      this.layoutRetryCount++;
      if (this.layoutRetryCount >= ArenaLifecycleCoordinator.LAYOUT_RETRY_LIMIT) {
        this.layoutRetryCount = 0;
        this.terminateMatch('Arena-Descriptor oder Round-State wurde nicht rechtzeitig repliziert.');
        return;
      }
      this.scene.time.delayedCall(16, () => this.onTransitionToArena());
      return;
    }
    this.layoutRetryCount = 0;

    const coopDefenseMapConfig = isCoopDefenseMode(bridge.getGameMode())
      ? getCoopDefenseMapConfig(roundState.coopDefenseMapId ?? bridge.getCoopDefenseMapId())
      : null;
    const coopDefenseArenaWidthCells = coopDefenseMapConfig?.arenaWidthCells;
    const coopDefenseArenaHeightCells = coopDefenseMapConfig?.arenaHeightCells;
    applyArenaMetricsForMode(
      bridge.getGameMode(),
      'ARENA',
      coopDefenseArenaWidthCells,
      coopDefenseArenaHeightCells,
    );
    try {
      this.buildArena(toMissionWorldDescriptor(descriptor));
    } catch (error) {
      console.error('[ArenaLifecycleCoordinator] Lokale Arena-Erzeugung fehlgeschlagen:', error);
      this.terminateMatch('Lokale Arena-Erzeugung fehlgeschlagen (Generator/Fingerprint abweichend).');
      return;
    }
    this.arenaBuilt = true;
    this.localArenaLoadReady = false;
    this.terrainSnapshotReady = false;
    this.startTerrainSnapshotBuild(descriptor.roundRevision);

    for (const profile of bridge.getConnectedPlayers()) {
      const canCreatePlayer = bridge.canPlayerSpawnOrRespawn(profile.id)
        && (!bridge.isHost() || bridge.canPlayerInitialSpawn(profile.id));
      if (canCreatePlayer && bridge.getPlayerReady(profile.id)) {
        this.activatePlayerRuntime(profile);
      }
    }

    this.ctx.leftPanel.transitionToGame();
    this.ctx.rightPanel.transitionToGame();
    this.ctx.centerHUD.transitionToGame();
    this.syncHostLoadoutsFromCommittedSelections();
    this.resetLocalArenaHudState();
    this.localPlayerState.spectator = false;
    this.localPlayerState.overlayTrackedAlive = null;
    // Round systems exist locally, but simulation stays inert until the common start timestamp.
    this.hostUpdate.setActive(false);
    this.ctx.gameAudioSystem.playMusic('music_arena');
  }

  private startTerrainSnapshotBuild(roundRevision: number): void {
    const layout = this.ctx.currentLayout;
    const arenaResult = this.ctx.arenaResult;
    if (!layout || !arenaResult) return;

    const generation = ++this.terrainSnapshotGenerationId;
    const isCurrent = (): boolean => (
      generation === this.terrainSnapshotGenerationId
      && this.arenaBuilt
      && this.ctx.currentLayout === layout
      && this.ctx.arenaResult === arenaResult
      && bridge.getRoundParticipation()?.roundRevision === roundRevision
    );

    bridge.setLocalArenaLoadProgress(roundRevision, 70, 'rendering');
    let build: Promise<import('../../arena/TerrainColorSnapshot').TerrainColorSnapshot>;
    try {
      build = new TerrainColorSnapshotBuilder({
        scene: this.scene,
        mode: bridge.getGameMode(),
        layout,
        arenaResult,
      }).build();
    } catch (error) {
      console.error('[ArenaLifecycleCoordinator] Terrain-Farb-Snapshot konnte nicht gestartet werden:', error);
      if (isCurrent()) this.terminateMatch('Terrain-Farb-Snapshot konnte nicht gestartet werden.');
      return;
    }

    build.then((snapshot) => {
      if (!isCurrent()) return;
      this.renderers.leafBlower.setTerrainColorSnapshot(snapshot);
      this.terrainSnapshotReady = true;
    }).catch((error: unknown) => {
      if (!isCurrent()) return;
      console.error('[ArenaLifecycleCoordinator] Terrain-Farb-Snapshot fehlgeschlagen:', error);
      this.terminateMatch('Terrain-Farb-Snapshot konnte nicht erstellt werden.');
    });
  }

  private get localPlayerState() { return this.hostUpdate['localPlayerState']; }

  private onTransitionToLobby(): void {
    this.arenaBuilt = false;
    this.arenaEnteredAt = 0;
    this.isLocalReady = false;
    bridge.setLocalReady(false);
    this.roundStartPending = false;
    this.localPlayerState.spectator = false;
    this.localPlayerState.overlayTrackedAlive = null;
    this.clientUpdate.clientUtilityOverride = null;
    this.ctx.arenaCountdown?.clear();
    this.resetLocalArenaHudState();
    this.ctx.gameAudioSystem.playMusic('music_lobby');

    for (const p of [...this.ctx.playerManager.getAllPlayers()]) {
      if (bridge.isHost()) {
        this.ctx.combatSystem.removePlayer(p.id);
        this.ctx.resourceSystem?.removePlayer(p.id);
        this.ctx.coopDefenseItemRuntimeSystem?.removePlayer(p.id);
        this.ctx.burrowSystem?.removePlayer(p.id);
        this.ctx.loadoutManager?.removePlayer(p.id);
      }
      this.ctx.playerManager.removePlayer(p.id);
    }

    this.tearDownArena();
    this.syncLobbyTimeOfDay();

    this.ctx.leftPanel.transitionToLobby();
    this.ctx.leftPanel.setLobbyFieldsLocked(false);
    this.ctx.rightPanel.transitionToLobby();
    this.ctx.centerHUD.transitionToLobby();
    const roundResults = bridge.getRoundResults();
    this.ctx.rightPanel.showRoomStatistics(bridge.getRoomPlayerStatistics());
    this.ctx.rightPanel.showRoundResults(
      bridge.isLocalRoundResultEligible(roundResults) ? roundResults : null,
      bridge.getRoundState(),
    );
    this.lobbyOverlay.setReadyButtonState(false);
    this.lobbyOverlay.show();
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
    const trackX     = ARENA_OFFSET_X + trackGridX * CELL_SIZE + CELL_SIZE;
    const arenaStartTime = bridge.getArenaStartTime();
    const spawnAt    = plan && arenaStartTime > 0
      ? arenaStartTime + plan.firstArrivalDelayMs
      : null;

    if (plan) {
      this.pendingClassicTrainEvent = { trackX, direction, plan };
      if (spawnAt !== null && bridge.isHost()) bridge.publishTrainEvent({ trackX, direction, spawnAt });
    }

    this.ctx.trainManager = new TrainManager(this.scene, this.ctx.playerManager, trackX, direction);
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

      const arenaTop    = ARENA_OFFSET_Y;
      const arenaBottom = ARENA_OFFSET_Y + ARENA_HEIGHT;
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
      const access = resolveConstructionAccess(
        constructionId,
        getConstructionAccessContext(bridge.getGameMode(), bridge.getPlayerRuntimeLoadout(playerId)),
      );
      if (!access.allowed) return false;
      if (!this.hasFreeConstructionCapacity(
        playerId,
        getCoopDefenseConstructionDefinition(constructionId).capacityCost,
      )) return false;
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
    const sharedPersistentBase = constructionId !== null && this.isSharedPersistentBaseRuntime();
    if (sharedPersistentBase && !this.acceptPersistentConstructionPlacement(playerId, rock, constructionId)) {
      this.ctx.placementSystem?.removeRock(rock.id);
      this.rockVisualHelper.removePlaceableRockVisual(rock, false);
      return false;
    }
    this.rockVisualHelper.materializePlaceableRock(rock, true);
    if (!sharedPersistentBase) {
      this.registerNewPersistentPlaceable(
        rock,
        constructionId ? { kind: 'construction', id: constructionId } : { kind: 'utility', id: cfg.id },
        cfg.placeable.footprint,
      );
    }
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
    constructionId = canonicalConstructionId;
    const access = resolveConstructionAccess(
      constructionId,
      getConstructionAccessContext(bridge.getGameMode(), bridge.getPlayerRuntimeLoadout(playerId)),
    );
    if (!access.allowed) return { ok: false, reason: access.reason === 'locked' ? 'invalid' : 'blocked' };
    const player = this.ctx.playerManager.getPlayer(playerId);
    if (
      !player
      || !player.sprite.active
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
        player.sprite.x,
        player.sprite.y,
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
        player.sprite.x,
        player.sprite.y,
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

    const sharedPersistentBase = this.isSharedPersistentBaseRuntime();
    if (sharedPersistentBase && !this.acceptPersistentConstructionPlacement(
      playerId,
      construction,
      constructionId,
    )) {
      if (definition.kind === 'pedestal') {
        this.ctx.powerUpSystem?.unregisterConstructionPedestal(construction.id);
      }
      this.ctx.placementSystem?.removeRock(construction.id);
      this.rockVisualHelper.removePlaceableRockVisual(construction, false);
      return { ok: false, reason: 'placement' };
    }

    const placedAt = Date.now();
    this.ctx.loadoutManager?.markConstructionUsed(playerId, constructionId, placedAt);
    // Ueber denselben Kanal wie Utility-Cooldowns, damit auch Clients den Bau-Cooldown
    // des gewaehlten Konstrukts im HUD sehen.
    bridge.publishUtilityCooldownUntil(playerId, placedAt + definition.buildCooldownMs, constructionId);
    this.rockVisualHelper.materializePlaceableRock(construction, true);
    if (!sharedPersistentBase) {
      this.registerNewPersistentPlaceable(
        construction,
        { kind: 'construction', id: constructionId },
        definition.footprint,
      );
    }
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
    const committed = bridge.getPlayerCommittedLoadout(playerId);
    if (!committed || committed.coopDefenseClassId !== 'inspector_gadachs') {
      return { ok: false, reason: 'blocked' };
    }
    if (!(committed.tools ?? []).some((entry) => (
      entry.kind === 'utility' && (entry.id === tool.id || normalizeConstructionId(entry.id) === normalizeConstructionId(tool.id))
    ))) {
      return { ok: false, reason: 'blocked' };
    }
    const config = getUtilityConfigForMode(tool.id, bridge.getGameMode()) as UtilityConfig | undefined;
    if (!config) return { ok: false, reason: 'invalid' };
    const constructionId = getConstructionIdForUtility(tool.id);
    if (constructionId) {
      const access = resolveConstructionAccess(
        constructionId,
        getConstructionAccessContext(bridge.getGameMode(), committed),
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
    const committed = bridge.getPlayerRuntimeLoadout(playerId);
    return resolveConstructionCapacity({
      gameMode: bridge.getGameMode(),
      classId: committed?.coopDefenseClassId,
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
    const base = getUtilityConfigForMode(utilityId, bridge.getGameMode());
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
    if (this.getActiveConstructionToolsForPlayer(playerId).length === 0) {
      return { ok: false, reason: 'blocked' };
    }
    const player = this.ctx.playerManager.getPlayer(playerId);
    if (
      !player
      || !player.sprite.active
      || !this.ctx.combatSystem.isAlive(playerId)
      || this.ctx.combatSystem.isBurrowed(playerId)
    ) {
      return { ok: false, reason: 'blocked' };
    }
    const cell = this.ctx.placementSystem?.getClampedTargetCell(
      player.sprite.x,
      player.sprite.y,
      targetX,
      targetY,
      COOP_DEFENSE_DISMANTLE_RANGE,
    );
    if (!cell) return { ok: false, reason: 'blocked' };
    const candidate = this.ctx.placementSystem?.getRuntimeRockAt(cell.gridX, cell.gridY);
    if (!candidate || candidate.constructionId === undefined
      || candidate.ownerId !== playerId
      || candidate.ownership === 'base-owned') return { ok: false, reason: 'blocked' };
    const removal = this.acceptPersistentConstructionRemoval(playerId, candidate);
    if (!removal.accepted) {
      return { ok: false, reason: 'blocked' };
    }
    const removed = this.ctx.placementSystem?.removeRock(candidate.id);
    if (!removed) {
      if (removal.checkpoint) this.persistentBaseCompositeService?.restoreCheckpoint(removal.checkpoint);
      return { ok: false, reason: 'blocked' };
    }

    this.removeAcceptedPersistentRuntime(removed, playerId);
    this.finalizeDismantledConstruction(removed, true);
    if (removal.checkpoint) this.publishPersistentBaseMutationState();
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
    const player = this.ctx.playerManager.getPlayer(playerId);
    if (this.getActiveConstructionToolsForPlayer(playerId).length === 0
      || !player?.sprite.active
      || !this.ctx.combatSystem.isAlive(playerId)
      || this.ctx.combatSystem.isBurrowed(playerId)) {
      return { ok: false, reason: 'blocked' };
    }

    const removed: SyncedPlaceableRock[] = [];
    let acceptedPersistentMutation = false;
    for (const candidate of this.ctx.placementSystem?.getOwnedConstructions(playerId) ?? []) {
      if (!candidate.constructionId || candidate.ownership === 'base-owned'
        || candidate.ownership !== this.getConstructionOwnership(playerId)) continue;
      const removal = this.acceptPersistentConstructionRemoval(playerId, candidate);
      if (!removal.accepted) continue;
      const runtime = this.ctx.placementSystem?.removeRock(candidate.id);
      if (runtime) {
        this.removeAcceptedPersistentRuntime(runtime, playerId);
        removed.push(runtime);
        acceptedPersistentMutation = acceptedPersistentMutation || removal.checkpoint !== null;
      } else if (removal.checkpoint) {
        this.persistentBaseCompositeService?.restoreCheckpoint(removal.checkpoint);
      }
    }
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
      this.ctx.gameAudioSystem.playSound('sfx_place_rock', player.sprite.x, player.sprite.y, playerId);
    }
    if (acceptedPersistentMutation) this.publishPersistentBaseMutationState();
    return { ok: true };
  }

  private finalizeDismantledConstruction(removed: SyncedPlaceableRock, playDust: boolean): void {
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
    if (runtimeRock?.persistentRewardId) {
      const reward = getPersistentBaseRewardDefinition(runtimeRock.persistentRewardId);
      if (reward?.runtimeDestructible !== true) return 0;
    }
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
      if (!player?.sprite.active) return null;
      const bounds = player.sprite.getBounds();
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

  private syncHostCoopDefensePlayerModifiersFromCommittedSelections(): void {
    if (!bridge.isHost() || !this.ctx.coopDefensePlayerModifierSystem) return;

    this.ctx.coopDefensePlayerModifierSystem.syncPlayers(
      bridge.getConnectedPlayers().map((profile) => [profile.id, bridge.getPlayerCommittedLoadout(profile.id)] as const),
    );
  }

  /**
   * Einziger Loadout-Auflöser der Player-Runtime. Mission liest den Ready-Snapshot, der Editor
   * seinen Editor-Snapshot; beide durchlaufen dieselbe Effektivauflösung.
   */
  private resolveRuntimeLoadoutSelection(playerId: string): LoadoutSelection {
    return bridge.isPlayerPersistentBaseEditorActive(playerId)
      ? this.resolveLoadoutSnapshotSelection(playerId, bridge.getPlayerPersistentBaseEditorLoadout(playerId))
      : this.resolveCommittedLoadoutSelection(playerId);
  }

  private resolveCommittedLoadoutSelection(playerId: string): LoadoutSelection {
    return this.resolveLoadoutSnapshotSelection(playerId, bridge.getPlayerCommittedLoadout(playerId));
  }

  private resolveLoadoutSnapshotSelection(
    playerId: string,
    committed: LoadoutCommitSnapshot | null,
  ): LoadoutSelection {
    if (!committed) {
      // Nach dem Spawn-Gate (hostHasCommittedLoadoutForSpawn) sollte das nicht mehr vorkommen.
      // Tritt es doch auf, ist die eingefrorene Auswahl noch nicht da → Live-Slot-Fallback (Risiko
      // "falsche Waffe"); loggen, um den Fall im Realbetrieb zu erkennen.
      console.warn(`[Loadout] Kein committed Loadout für ${playerId} – nutze Live-Slot-Fallback.`);
      return this.resolveLoadoutSelection(playerId);
    }
    return resolveEffectiveLoadoutSelection({
      weapon1:  WEAPON_CONFIGS[committed.weapon1  as keyof typeof WEAPON_CONFIGS],
      weapon2:  committed.weapon2
        ? WEAPON_CONFIGS[committed.weapon2 as keyof typeof WEAPON_CONFIGS]
        : undefined,
      utility:  UTILITY_CONFIGS[committed.utility  as keyof typeof UTILITY_CONFIGS],
      ultimate: ULTIMATE_CONFIGS[committed.ultimate as keyof typeof ULTIMATE_CONFIGS],
    }, bridge.getGameMode(), committed.coopDefenseProfile, committed.coopDefenseClassId, committed.equippedItems);
  }

  private resolveLoadoutSelection(playerId: string): LoadoutSelection {
    const w1Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon1');
    const w2Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon2');
    const utId = bridge.getPlayerLoadoutSlot(playerId, 'utility');
    const ulId = bridge.getPlayerLoadoutSlot(playerId, 'ultimate');
    return resolveEffectiveLoadoutSelection({
      weapon1:  w1Id ? WEAPON_CONFIGS[w1Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      weapon2:  w2Id ? WEAPON_CONFIGS[w2Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      utility:  utId ? UTILITY_CONFIGS[utId  as keyof typeof UTILITY_CONFIGS]   : undefined,
      ultimate: ulId ? ULTIMATE_CONFIGS[ulId as keyof typeof ULTIMATE_CONFIGS]: undefined,
    }, bridge.getGameMode());
  }
}

/**
 * Weltinhalt einer aufgebauten Welt.
 *
 * Der Editor überspringt Missionssysteme nicht per Sonderfall – seine Welt enthält schlicht
 * nichts, woraus Gegner, Ziele, Events oder eine Rundenauswertung entstehen könnten.
 */
export function resolveWorldMapConfig(
  world: ArenaWorldDescriptor,
  roundStateMapId?: string,
): CoopDefenseMapConfig | null {
  if (world.runtimeKind === 'persistent-base-editor') return getPersistentBaseEditorMapConfig();
  if (!isCoopDefenseMode(world.gameMode)) return null;
  return getCoopDefenseMapConfig(world.mapId ?? roundStateMapId ?? bridge.getCoopDefenseMapId());
}

function compareGuestRestoreBlueprints(
  left: GuestPersistentConstruction,
  right: GuestPersistentConstruction,
): number {
  return left.placementOrder - right.placementOrder
    || (left.ownerId < right.ownerId ? -1 : left.ownerId > right.ownerId ? 1 : 0)
    || (left.persistentId < right.persistentId ? -1 : left.persistentId > right.persistentId ? 1 : 0);
}

/**
 * Uhrzeit der Runde. Nur Coop-Defense-Maps setzen eine eigene; alle übrigen Modi bleiben
 * beim Mittag und damit exakt bei den bisherigen Kosten und der bisherigen Optik. Host
 * und Client lösen dieselbe Map-Konfiguration auf, deshalb ist kein eigener Netzwerkpfad
 * nötig – das gilt auch für den lokalen Debug-Regler, der bewusst nur den eigenen Client
 * betrifft.
 */
function resolveRoundTimeOfDayMinutes(mapConfig: CoopDefenseMapConfig | null, lobbyMinutes: number): number {
  const configured = mapConfig?.timeOfDay;
  if (configured === undefined) return lobbyMinutes;
  // Die Konfiguration ist beim Laden validiert worden; der Rückfall deckt nur den Fall
  // ab, dass jemand die Registry zur Laufzeit umgeht.
  return parseTimeOfDay(configured) ?? DEFAULT_TIME_OF_DAY_MINUTES;
}
