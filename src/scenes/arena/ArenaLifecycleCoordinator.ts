import type Phaser from 'phaser';
import { bridge }            from '../../network/bridge';
import { ArenaBuilder }      from '../../arena/ArenaBuilder';
import { ArenaGenerator }    from '../../arena/ArenaGenerator';
import { createArenaTerrainColorSampler } from '../../arena/ArenaTerrainColorSampler';
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
import { CoopDefenseEnemyAttackSystem } from '../../systems/CoopDefenseEnemyAttackSystem';
import { CoopDefenseEnemyAbilitySystem } from '../../systems/CoopDefenseEnemyAbilitySystem';
import { CoopDefenseEnemyTrainAwarenessSystem } from '../../systems/CoopDefenseEnemyTrainAwarenessSystem';
import { CoopDefenseEnemyBurrowSystem } from '../../systems/CoopDefenseEnemyBurrowSystem';
import { CoopDefenseEnemyDodgeSystem } from '../../systems/CoopDefenseEnemyDodgeSystem';
import { CoopDefenseEnemyCombatPositioningSystem } from '../../systems/CoopDefenseEnemyCombatPositioningSystem';
import { CoopDefenseVoidHunterSystem } from '../../systems/CoopDefenseVoidHunterSystem';
import { CoopDefenseTimebombSystem } from '../../systems/CoopDefenseTimebombSystem';
import { EnemyStrategicTargetService } from '../../systems/EnemyStrategicTargetService';
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
import { CoopDefenseSurvivalSystem } from '../../systems/CoopDefenseSurvivalSystem';
import { CoopDefenseSpawnExecutor } from '../../systems/CoopDefenseSpawnExecutor';
import { CoopDefensePersistentPressureSystem } from '../../systems/CoopDefensePersistentPressureSystem';
import { CoopDefenseBossSystem } from '../../systems/CoopDefenseBossSystem';
import { CoopDefenseMapDirector } from '../../systems/CoopDefenseMapDirector';
import { CoopDefenseMapEventDirector, type CoopDefenseMapEventHandler } from '../../systems/CoopDefenseMapEventDirector';
import { CoopDefenseGroundHazardEventHandler } from '../../systems/CoopDefenseGroundHazardEventHandler';
import { CoopDefenseObjectiveRepairSystem } from '../../systems/CoopDefenseObjectiveRepairSystem';
import { CoopDefenseObjectivePlacementRewardSystem } from '../../systems/CoopDefenseObjectivePlacementRewardSystem';
import { CoopDefenseSecondaryObjectiveSystem } from '../../systems/CoopDefenseSecondaryObjectiveSystem';
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
import { LightOccluderIndex }  from '../../effects/LightOccluderIndex';
import { DEFAULT_TIME_OF_DAY_MINUTES, parseTimeOfDay, resolveSkyState } from '../../effects/TimeOfDay';
import { setEmissiveScale } from '../../effects/EmissiveScale';
import { getUtilityConfigForMode, UTILITY_CONFIGS, WEAPON_CONFIGS, ULTIMATE_CONFIGS, DEFAULT_LOADOUT } from '../../loadout/LoadoutConfig';
import type { PlaceableUtilityConfig, PlaceableTurretUtilityConfig, TeslaDomeWeaponFireConfig, UtilityConfig, WeaponConfig } from '../../loadout/LoadoutConfig';
import type { LoadoutSelection } from '../../loadout/LoadoutManager';
import { getBaseRewardPickupWorldPosition, getBaseWorldBounds, getCoopDefenseBases } from '../../arena/BaseRegistry';
import { getCoopDefenseMapConfig, getCoopDefenseMapXpReference, resolveCoopDefenseMapEncounterConfigs, resolveCoopDefenseMapPersistentSpawnConfigs, resolveCoopDefenseMapSecondaryObjectives, type CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import { buildInitialLocalArenaHudData } from '../../ui/LocalArenaHudData';
import { ARENA_COUNTDOWN_SEC, ARENA_DURATION_SEC, HP_MAX, PLAYER_COLORS, COLORS, ARENA_OFFSET_X, CELL_SIZE, ARENA_HEIGHT, ARENA_OFFSET_Y, GRID_COLS, GRID_ROWS, TEAM_BLUE_COLOR, TEAM_RED_COLOR, COOP_DEFENSE_BASE_TURRET_OWNER_ID, COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID, COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID, applyArenaMetricsForMode } from '../../config';
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
import type { ArenaLayout, LoadoutCommitSnapshot, LoadoutUseParams, RoomQualitySnapshot } from '../../types';
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
import { emitArenaMapGridChanged } from './ArenaEvents';
import {
  COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT,
  COOP_DEFENSE_DISMANTLE_RANGE,
  COOP_DEFENSE_REPAIR_DRONE_UPGRADE_ID,
  getCoopDefenseConstructionCapacity,
  getCoopDefenseConstructionDefinition,
  getToolCapacityCost,
  isConstructionId,
} from '../../config/coopDefenseConstructions';
import { getUnlockedCoopDefenseConstructionIds } from '../../utils/coopDefenseUpgrades';
import type { ConstructionId, LoadoutToolRef, LoadoutUseResult } from '../../types';
import type { TargetStatusTarget } from '../../systems/TargetStatusSystem';

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
  private roundStartPending = false;
  private isLocalReady      = false;
  private lastPhase: import('../../types').GamePhase = 'LOBBY';
  private trainDestroyedShown = false;
  private trainExplosionTimers: Phaser.Time.TimerEvent[] = [];

  private layoutRetryCount = 0;
  private arenaEnteredAt   = 0;
  private arenaBuilt       = false;
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

  /**
   * Die von der Map vorgegebene Uhrzeit der laufenden Runde – der Wert, auf den der
   * Debug-Regler zurücksetzt. Unabhängig davon, was gerade lokal eingestellt ist.
   */
  getRoundTimeOfDayMinutes(): number {
    return this.roundTimeOfDayMinutes;
  }

  /** Hält die Lobby-Beleuchtung auf der host-autoritativen Slider-Uhrzeit. */
  syncLobbyTimeOfDay(): void {
    if (bridge.getGamePhase() !== 'LOBBY') return;
    const minutes = bridge.getLobbyTimeOfDayMinutes();
    this.renderers.lighting.setTimeOfDay(minutes);
    this.renderers.lighting.setActive(true);
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
    bridge.setMatchHostId();
    bridge.resetAllFrags();
    bridge.resetCoopDefenseRoundXp();
    // Der Endstand der Vorrunde bleibt in der Lobby sichtbar, wird aber beim Start atomar
    // geleert. So kann ein Client beim naechsten Phasenwechsel keine veraltete Auswertung zeigen.
    bridge.publishRoundResults([]);
    bridge.publishCoopDefenseEncounterPresentationState(null);
    bridge.publishCoopDefenseMapEventPresentationState(null);
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(null);
    const coopDefenseMapConfig = isCoopDefenseMode(bridge.getGameMode())
      ? getCoopDefenseMapConfig(bridge.getCoopDefenseMapId())
      : null;
    applyArenaMetricsForMode(
      bridge.getGameMode(),
      'ARENA',
      coopDefenseMapConfig?.arenaWidthCells,
      coopDefenseMapConfig?.arenaHeightCells,
    );
    const arenaStartTime = Date.now() + ARENA_COUNTDOWN_SEC * 1000;
    bridge.hostStartRoundParticipants(bridge.getConnectedPlayerIds(), arenaStartTime);
    bridge.requestFullGameState();
    const timeOfDayMinutes = resolveRoundTimeOfDayMinutes(coopDefenseMapConfig, bridge.getLobbyTimeOfDayMinutes());
    const isCoopDefense = isCoopDefenseMode(bridge.getGameMode());
    const layout = ArenaGenerator.generate(Date.now(), coopDefenseMapConfig ?? undefined);
    bridge.publishArenaLayout(ArenaGenerator.stripVisualOnlyFields(layout));
    bridge.setArenaStartTime(arenaStartTime);
    let roundEndTime = arenaStartTime + ARENA_DURATION_SEC * 1000;
    if (isCoopDefense) {
      if (coopDefenseMapConfig?.objective === 'survive') {
        const surviveDurationSec = coopDefenseMapConfig.surviveDurationSec;
        if (surviveDurationSec === undefined) {
          throw new Error(`[ArenaLifecycleCoordinator] Survival map ${coopDefenseMapConfig.mapId} has no surviveDurationSec`);
        }
        roundEndTime = arenaStartTime + surviveDurationSec * 1000;
      } else {
        roundEndTime = 0;
      }
    }
    bridge.setRoundEndTime(roundEndTime);
    const roundState: RoundState = {
      status: 'active',
      roundStartTime: arenaStartTime,
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

  spawnReadyPlayers(): void {
    if (!bridge.isHost()) return;
    for (const profile of bridge.getConnectedPlayers()) {
      const canInitialSpawn = bridge.canPlayerInitialSpawn(profile.id);
      const reconnectAfterDeath = this.ctx.coopDefenseSurvivalSystem !== null
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
        this.ctx.playerManager.addPlayer(profile);
        if (reconnectAfterDeath) {
          if (!this.ctx.combatSystem.spawnPlayerAfterReconnect(profile.id)) {
            this.ctx.playerManager.removePlayer(profile.id);
            continue;
          }
        } else {
          this.ctx.combatSystem.initPlayer(profile.id);
          this.ctx.coopDefenseSurvivalSystem?.registerInitialSpawn(profile.id);
        }
        this.ctx.resourceSystem?.initPlayer(profile.id);
        this.ctx.coopDefenseItemRuntimeSystem?.initPlayer(profile.id);
        this.ctx.burrowSystem?.initPlayer(profile.id);
        this.ctx.loadoutManager?.resetUltimateState(profile.id);
        this.ctx.loadoutManager?.assignDefaultLoadout(profile.id, this.resolveCommittedLoadoutSelection(profile.id));
      }
    }
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
    bridge.publishCoopDefenseEncounterPresentationState(null);
    bridge.publishCoopDefenseMapEventPresentationState(null);
    bridge.publishCoopDefenseSecondaryObjectivePresentationState(null);

    if (roundConclusion) {
      const currentRoundState = bridge.getRoundState();
      bridge.publishRoundState({
        status: roundConclusion,
        roundStartTime: bridge.getArenaStartTime(),
        timeOfDayMinutes: currentRoundState?.timeOfDayMinutes,
        coopDefenseHumanPlayerCount: currentRoundState?.coopDefenseHumanPlayerCount,
        coopDefenseMapId: currentRoundState?.coopDefenseMapId,
        resultEligiblePlayerIds: bridge.getRoundResultEligiblePlayerIds(),
        endedAt: roundEndedAt,
      });
    } else {
      bridge.publishRoundState(null);
    }

    this.hostSaveRoundResults(roundEndedAt, roundConclusion !== 'aborted');
    bridge.publishCoopDefenseSurvivalState(null);
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
    // Survival-Eliminierung ist nur eine lokale Darstellungs-/Aktionssperre. Die Netzwerkrolle
    // bleibt participant, damit Result-/Reward-Eligibility und der Round-Snapshot erhalten bleiben.
    const spectator = bridge.isRoundSpectator(localId)
      || bridge.getLocalCoopDefenseSurvivalState()?.eliminated === true;
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
    this.removePlayerFromActiveRound(playerId);
    if (playerId === bridge.getLocalPlayerId()) {
      this.localPlayerState.spectator = true;
      this.localPlayerState.alive = false;
      this.localPlayerState.burrowed = false;
      this.localPlayerState.overlayTrackedAlive = null;
    }
  }

  /** Gemeinsamer Entkopplungspfad fuer Spectator, Disconnect und Arena-Teardown. */
  removePlayerFromActiveRound(playerId: string): void {
    // Zielstatus und Injector-Fokus gehoeren zur laufenden Runde, nicht zur Lobby-Persona.
    // Deshalb muessen sie auch beim Disconnect/Spectator-Wechsel vor dem naechsten Snapshot
    // entfernt werden.
    this.ctx.targetStatusSystem?.removeTarget({ targetType: 'player', targetId: playerId });
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

  buildArena(networkLayout: ArenaLayout): void {
    this.tearDownArena();

    // Merge-Baseline der Delta-Slices (rocks/powerups/pedestals) verwerfen, damit keine Zustände aus
    // der Vorrunde in die neue Runde lecken (z. B. beschädigte Felsen direkt zu Match-Beginn).
    bridge.resetGameStateCache();

    const layout = ArenaGenerator.hydrateVisualOnlyFields(networkLayout);
    // Map-ID bevorzugt aus dem (gegateten) RoundState lesen – derselbe reliable-Snapshot, der auch die
    // Spielerzahl trägt. So bauen Host und Client garantiert dieselben Basen aus EINEM Objekt. Fallback
    // auf den separaten Key für Alt-/Edge-Fälle (z. B. RoundState-Updates ohne Map-ID).
    const roundState = bridge.getRoundState();
    const coopDefenseMapConfig = isCoopDefenseMode(bridge.getGameMode())
      ? getCoopDefenseMapConfig(roundState?.coopDefenseMapId ?? bridge.getCoopDefenseMapId())
      : null;
    const coopDefenseHumanPlayerCount = isCoopDefenseMode(bridge.getGameMode())
      ? Math.max(1, Math.floor(roundState?.coopDefenseHumanPlayerCount ?? 1))
      : 1;
    const coopDefenseEnemyConfigs = isCoopDefenseMode(bridge.getGameMode())
      ? resolveCoopDefenseEnemyConfigs(coopDefenseHumanPlayerCount)
      : null;
    const coopDefenseBases = coopDefenseMapConfig
      ? getCoopDefenseBases(coopDefenseMapConfig, coopDefenseHumanPlayerCount)
      : [];
    const coopDefensePersistentSpawnConfigs = coopDefenseMapConfig
      ? resolveCoopDefenseMapPersistentSpawnConfigs(coopDefenseMapConfig, coopDefenseHumanPlayerCount)
      : [];
    const coopDefenseEncounterConfigs = coopDefenseMapConfig
      ? resolveCoopDefenseMapEncounterConfigs(coopDefenseMapConfig, coopDefenseHumanPlayerCount)
      : [];
    const coopDefenseSecondaryObjectiveConfigs = coopDefenseMapConfig
      ? resolveCoopDefenseMapSecondaryObjectives(coopDefenseMapConfig, coopDefenseHumanPlayerCount)
      : [];
    this.ctx.coopDefenseSecondaryObjectiveSystem = null;
    this.ctx.coopDefenseCarrySystem = null;
    this.ctx.coopDefenseTeamBuffSystem?.reset();
    this.ctx.coopDefenseTeamBuffSystem = bridge.isHost() && coopDefenseMapConfig
      ? new CoopDefenseTeamBuffSystem()
      : null;
    this.ctx.coopDefenseObjectiveRepairSystem = null;
    this.ctx.coopDefenseObjectivePlacementRewardSystem = null;
    this.ctx.coopDefenseSecondaryObjectiveConfigs = coopDefenseSecondaryObjectiveConfigs;
    if (bridge.isHost()) {
      if (coopDefenseMapConfig?.objective === 'survive') {
        const respawnsPerPlayer = coopDefenseMapConfig.surviveRespawnsPerPlayer;
        if (respawnsPerPlayer === undefined) {
          throw new Error(`[ArenaLifecycleCoordinator] Survival map ${coopDefenseMapConfig.mapId} has no surviveRespawnsPerPlayer`);
        }
        const participantIds = bridge.getRoundParticipation()?.participantIds
          ?? bridge.getConnectedPlayerIds();
        this.ctx.coopDefenseSurvivalSystem = new CoopDefenseSurvivalSystem({
          respawnsPerPlayer,
          participantIds,
        });
        bridge.publishCoopDefenseSurvivalState(this.ctx.coopDefenseSurvivalSystem.getSnapshot());
      } else {
        this.ctx.coopDefenseSurvivalSystem = null;
        bridge.publishCoopDefenseSurvivalState(null);
      }
    } else {
      this.ctx.coopDefenseSurvivalSystem = null;
    }
    this.ctx.currentLayout = layout;
    const builder = new ArenaBuilder(this.scene);
    this.ctx.arenaResult = builder.buildDynamic(layout);
    this.ctx.placementSystem = new PlacementSystem(layout, this.ctx.arenaResult.rockGrid, this.ctx.playerManager);
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
    this.ctx.coopDefenseRoundStateSystem = bridge.isHost()
      && this.ctx.baseManager
      && isCoopDefenseMode(bridge.getGameMode())
      && coopDefenseMapConfig
      ? new CoopDefenseRoundStateSystem({
        baseManager: this.ctx.baseManager,
        objective: coopDefenseMapConfig.objective,
        getSecondsLeft: () => bridge.computeSecondsLeft(),
        isBossDefeated: () => this.ctx.coopDefenseBossSystem?.isBossDefeated() ?? false,
        isAssaultRepelled: () => this.ctx.coopDefenseMapDirector?.isAssaultRepelled() ?? false,
        isSurvivalTeamWiped: () => {
          const survival = this.ctx.coopDefenseSurvivalSystem;
          if (!survival) return false;
          return survival.isTeamWiped(
            bridge.getConnectedPlayerIds(),
            bridge.getRoundParticipation()?.spectatorIds ?? [],
          );
        },
      })
      : null;
    const baseManager = this.ctx.baseManager;
    const syncActiveBaseIds = (): void => {
      const activeBaseIds = baseManager?.getActiveBaseIds() ?? new Set<string>();
      this.ctx.enemyFlowFieldService?.setActiveBaseIds(activeBaseIds);
      this.ctx.enemyPlayerFlowFieldService?.setActiveBaseIds(activeBaseIds);
      this.ctx.enemyStrategicFlowFieldService?.setActiveBaseIds(activeBaseIds);
      this.ctx.enemyBossFlowFieldService?.setActiveBaseIds(activeBaseIds);
      for (const allyFlowField of this.ctx.allyFlowFieldServices.values()) {
        allyFlowField.setActiveBaseIds(activeBaseIds);
      }
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
          const isActive = this.ctx.arenaResult?.rockObjects[index]?.active ?? false;
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

      this.ctx.enemyFlowFieldService = isCoopDefenseMode(bridge.getGameMode())
        ? new EnemyFlowFieldService(layout, coopDefenseBases, flowFieldMetrics, {
          eventBus: this.scene.game.events,
          obstacleCellProvider,
        })
        : null;
      this.ctx.enemyPlayerFlowFieldService = isCoopDefenseMode(bridge.getGameMode())
        ? new EnemyFlowFieldService(layout, coopDefenseBases, flowFieldMetrics, {
          eventBus: this.scene.game.events,
          obstacleCellProvider,
          goalMode: 'dynamic-fallback-bases',
          topologySource: this.ctx.enemyFlowFieldService ?? undefined,
        })
        : null;
      this.ctx.enemyStrategicFlowFieldService = isCoopDefenseMode(bridge.getGameMode())
        ? new EnemyFlowFieldService(layout, coopDefenseBases, flowFieldMetrics, {
          eventBus: this.scene.game.events,
          obstacleCellProvider,
          goalMode: 'dynamic',
          topologySource: this.ctx.enemyFlowFieldService ?? undefined,
        })
        : null;
      this.ctx.enemyStrategicTargetService = this.ctx.enemyStrategicFlowFieldService
        ? new EnemyStrategicTargetService(this.ctx.enemyStrategicFlowFieldService)
        : null;
      this.ctx.enemyBossFlowFieldService = coopDefenseMapConfig?.boss
        ? new EnemyFlowFieldService(layout, coopDefenseBases, flowFieldMetrics, {
          eventBus: this.scene.game.events,
          obstacleCellProvider,
          goalMode: getCoopDefenseEnemyConfig(coopDefenseMapConfig.boss.enemyKind).movementTarget === 'players'
            ? 'dynamic-fallback-bases'
            : 'bases',
          clearanceCells: Math.ceil(Math.max(
            0,
            getCoopDefenseEnemyConfig(coopDefenseMapConfig.boss.enemyKind).size * 0.5 - CELL_SIZE * 0.5,
          ) / CELL_SIZE),
          topologySource: this.ctx.enemyFlowFieldService ?? undefined,
        })
        : null;
      for (const flowField of this.ctx.allyFlowFieldServices.values()) flowField.destroy();
      this.ctx.allyFlowFieldServices.clear();
      for (const player of this.ctx.playerManager.getAllPlayers()) {
        this.ctx.allyFlowFieldServices.set(player.id, new EnemyFlowFieldService(layout, coopDefenseBases, flowFieldMetrics, {
          eventBus: this.scene.game.events,
          obstacleCellProvider,
          goalMode: 'dynamic-fallback-bases',
          topologySource: this.ctx.enemyFlowFieldService ?? undefined,
        }));
      }
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
          )
          : null;
        if (coopDefenseEncounterConfigs.length > 0) {
          this.ctx.coopDefenseMapDirector = new CoopDefenseMapDirector(
            coopDefenseEncounterConfigs,
            (enemyKind, count, originId, front) => this.ctx.coopDefenseSpawnExecutor?.hostSpawnEncounterGroup(enemyKind, count, originId, front),
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
          isEncounterCleared: (encounterId) => this.ctx.coopDefenseMapDirector?.isEncounterCleared(encounterId) ?? false,
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
      this.ctx.baseManager?.setOnBaseActivated(() => {
        // Clients have no host flow fields, but their shared obstacle index still needs the
        // newly materialized cell bodies for local LoS and presentation-side queries.
        this.ctx.combatSystem.setBaseObstacles(this.ctx.baseManager?.getObstacleRectangles() ?? null);
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
    this.renderers.leafBlower.setTerrainColorSampler(
      createArenaTerrainColorSampler(this.scene, bridge.getGameMode(), this.ctx.arenaResult),
    );
    if (bridge.isHost()) {
      this.ctx.captureTheBeerSystem?.setFxHandler((event) => {
        bridge.broadcastCaptureTheBeerFx(event);
      });
    }

    this.ctx.playerManager.setLayout(layout);

    this.ctx.projectileManager.setRockGroup(
      this.ctx.arenaResult.rockGroup,
      this.ctx.arenaResult.rockObjects,
      this.ctx.arenaResult.trunkGroup,
    );
    this.ctx.projectileManager.setBaseGroup(this.ctx.baseManager?.getBaseGroup() ?? null);
    this.ctx.decoySystem.setObstacleGroups(
      this.ctx.arenaResult.rockGroup,
      this.ctx.arenaResult.trunkGroup,
    );
    this.ctx.combatSystem.setArenaObstacles(this.ctx.arenaResult.rockObjects, this.ctx.arenaResult.trunkObjects);
    this.ctx.combatSystem.setBaseObstacles(this.ctx.baseManager?.getObstacleRectangles() ?? null);
    // Dieselbe Index-Instanz, damit Sichtlinie und Projektil-Kollision denselben Stand sehen.
    this.ctx.projectileManager.setObstacleIndex(this.ctx.combatSystem.getObstacleIndex());
    // Brandraster-Hindernisse werden einmalig in 16-px-Zellen projiziert und bei
    // platzierten/zerstoerten Felsen periodisch aktualisiert. Damit ist sowohl die
    // Zellpruefung als auch der Sichtstrahl unabhaengig von der Felsanzahl.
    const blockedFireCells = new Set<string>();
    const fireLineOfSightCells = new Set<string>();
    let fireObstacleIndexUpdatedAt = -Infinity;
    const fireCellKey = (gridX: number, gridY: number) => `${gridX}:${gridY}`;
    const addBoundsToFireIndex = (
      left: number, top: number, right: number, bottom: number, blocksCell: boolean,
    ) => {
      const minX = Math.floor(left / GROUND_FIRE_CELL_SIZE);
      const maxX = Math.floor((right - 0.001) / GROUND_FIRE_CELL_SIZE);
      const minY = Math.floor(top / GROUND_FIRE_CELL_SIZE);
      const maxY = Math.floor((bottom - 0.001) / GROUND_FIRE_CELL_SIZE);
      for (let gridY = minY; gridY <= maxY; gridY += 1) {
        for (let gridX = minX; gridX <= maxX; gridX += 1) {
          const key = fireCellKey(gridX, gridY);
          fireLineOfSightCells.add(key);
          if (blocksCell) blockedFireCells.add(key);
        }
      }
    };
    const refreshFireObstacleIndex = () => {
      const now = performance.now();
      if (now - fireObstacleIndexUpdatedAt < 100) return;
      fireObstacleIndexUpdatedAt = now;
      blockedFireCells.clear();
      fireLineOfSightCells.clear();
      for (const rock of this.ctx.arenaResult?.rockObjects ?? []) {
        if (!rock?.active) continue;
        const bounds = rock.getBounds();
        addBoundsToFireIndex(bounds.left, bounds.top, bounds.right, bounds.bottom, true);
      }
      for (const rock of this.ctx.placementSystem?.getAllRuntimeRocks() ?? []) {
        if (rock.kind === 'pedestal') continue;
        const left = ARENA_OFFSET_X + rock.gridX * CELL_SIZE;
        const top = ARENA_OFFSET_Y + rock.gridY * CELL_SIZE;
        addBoundsToFireIndex(left, top, left + CELL_SIZE, top + CELL_SIZE, true);
      }
      for (const trunk of this.ctx.arenaResult?.trunkObjects ?? []) {
        if (!trunk?.active) continue;
        const bounds = trunk.getBounds();
        addBoundsToFireIndex(bounds.left, bounds.top, bounds.right, bounds.bottom, false);
      }
      for (const bounds of this.ctx.baseManager?.getObstacleRectangles() ?? []) {
        addBoundsToFireIndex(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height, false);
      }
    };
    this.ctx.fireSystem.setGroundResolvers(
      (bounds) => {
        refreshFireObstacleIndex();
        return blockedFireCells.has(fireCellKey(
          Math.floor(bounds.centerX / GROUND_FIRE_CELL_SIZE),
          Math.floor(bounds.centerY / GROUND_FIRE_CELL_SIZE),
        ));
      },
      (startX, startY, endX, endY) => {
        refreshFireObstacleIndex();
        const dx = endX - startX;
        const dy = endY - startY;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / GROUND_FIRE_CELL_SIZE));
        for (let step = 1; step < steps; step += 1) {
          const t = step / steps;
          const gridX = Math.floor((startX + dx * t) / GROUND_FIRE_CELL_SIZE);
          const gridY = Math.floor((startY + dy * t) / GROUND_FIRE_CELL_SIZE);
          if (fireLineOfSightCells.has(fireCellKey(gridX, gridY))) return false;
        }
        return true;
      },
    );
    this.ctx.combatSystem.setBaseManager(this.ctx.baseManager);
    this.ctx.combatSystem.setEnemyManager(this.ctx.enemyManager);
    this.ctx.combatSystem.setPlayerMaxHpResolver((playerId) => {
      return this.ctx.coopDefensePlayerModifierSystem?.getMaxHp(playerId) ?? HP_MAX;
    });
    this.ctx.combatSystem.setInitialSpawnAllowedResolver((playerId) => bridge.canPlayerInitialSpawn(playerId));
    this.ctx.combatSystem.setRespawnAllowedResolver((playerId) => bridge.canPlayerRespawn(playerId));
    this.ctx.combatSystem.setRespawnCallback((playerId) => {
      const survival = this.ctx.coopDefenseSurvivalSystem;
      if (!survival) return true;
      const consumed = survival.consumeRespawn(playerId);
      if (consumed) bridge.publishCoopDefenseSurvivalState(survival.getSnapshot());
      return consumed;
    });
    this.ctx.combatSystem.setPlayerActionAllowedResolver((playerId) => bridge.canPlayerAct(playerId));
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
      bridge.recordPlayerDeath(playerId);
      this.ctx.coopDefenseObjectivePlacementRewardSystem?.handlePlayerUnavailable(playerId);
      this.ctx.coopDefenseSurvivalSystem?.handlePlayerDeath(playerId);
      if (this.ctx.coopDefenseSurvivalSystem) {
        bridge.publishCoopDefenseSurvivalState(this.ctx.coopDefenseSurvivalSystem.getSnapshot());
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
        () => (this.ctx.arenaResult?.rockObjects ?? [])
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
        );
        this.ctx.coopDefenseEnemyAttackSystem = new CoopDefenseEnemyAttackSystem(
          this.ctx.enemyManager,
          this.ctx.playerManager,
          this.ctx.baseManager,
          this.ctx.combatSystem,
          this.ctx.loadoutManager,
          () => this.ctx.arenaResult?.rockObjects ?? null,
          this.ctx.coopDefenseEnemyTrainAwarenessSystem,
          this.ctx.placementSystem,
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
      this.ctx.burrowSystem.setTunnelTransitEndedCallback((playerId) => {
        this.ctx.tunnelSystem?.notifyTransitEnded(playerId);
      });
      this.ctx.loadoutManager.setTunnelPlacementHandler((cfg, playerId, x, y, targetX, targetY, playerColor, params) => {
        return this.placeTunnel(cfg, playerId, x, y, targetX, targetY, playerColor, params);
      });
      this.ctx.loadoutManager.setActionBlockedChecker((playerId, slot) => {
        if (!bridge.canPlayerAct(playerId)) return true;
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
          bridge.broadcastExplosionEffect(x, y, radius, 0xffd26a, 'nuke');
          this.hostUpdate.applyNukeEnvironmentDamage(x, y, radius, triggeredBy);
        },
        onConfiguredNukeExploded: (strike) => {
          if (strike.variant !== 'void') return;
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

      this.ctx.armageddonSystem = new ArmageddonSystem();
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
        );
      }
      this.ctx.coopDefenseEnemyAttackSystem?.setActionBlockedChecker((enemyId) => (
        (this.ctx.coopDefenseVoidHunterSystem?.blocksRegularAttacks(enemyId) ?? false)
        || (this.ctx.coopDefenseTimebombSystem?.blocksRegularBehavior(enemyId) ?? false)
        || (this.ctx.coopDefenseEnemyAbilitySystem?.blocksRegularAttacks(enemyId) ?? false)
      ));

      this.ctx.airstrikeSystem = new AirstrikeSystem();
      this.ctx.airstrikeSystem.setExplodedCallback((x, y, radius, triggeredBy, cfg) => {
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
              isTriggerSatisfied: (start) => start.type === 'after-encounter'
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
    this.renderers.shadow.setTimeOfDay(timeOfDayMinutes);
    this.renderers.shadow.rebuildArenaStaticShadows(
      this.ctx.currentLayout,
      this.ctx.arenaResult,
      this.ctx.placementSystem?.getAllRuntimeRocks() ?? [],
    );

    // Lichtverdeckung liest dieselben Hindernis-Referenzen wie `CombatSystem`
    // (siehe setArenaObstacles/setBaseObstacles weiter oben) – keine eigene Liste.
    this.ctx.lightOccluderIndex = new LightOccluderIndex({
      rocks: () => this.ctx.arenaResult?.rockObjects ?? null,
      trunks: () => this.ctx.arenaResult?.trunkObjects ?? null,
      baseCells: () => this.ctx.baseManager?.getObstacleRectangles() ?? null,
      baseGeneration: () => this.ctx.baseManager?.getObstacleGeneration() ?? 0,
    });
    this.renderers.lighting.setOccluderIndex(this.ctx.lightOccluderIndex);
    this.renderers.lighting.setTimeOfDay(timeOfDayMinutes);
    this.renderers.lighting.setActive(true);
    // Additive Effektgrafiken liegen teils über dem Lightmap-Overlay und werden vom
    // Ambient gar nicht erfasst; über hellem Boden brennen sie ohne diese Dämpfung aus.
    setEmissiveScale(resolveSkyState(timeOfDayMinutes).emissiveScale);

    // Reset per-round state in coordinators
    this.hostUpdate.resetPerRound();
    this.clientUpdate.resetPerRound();
    this.trainDestroyedShown = false;
  }

  tearDownArena(): void {
    this.cancelTrainExplosionTimers();
    // Event-Handler besitzen occurrence-/sourcebezogene Zustaende. Sie muessen vor dem
    // Fachsystem-Cleanup laufen, damit Ground-Hazard-Quellen sauber aus dem FireSystem entfernt
    // und Airstrike-/Train-Callbacks entkoppelt werden koennen.
    this.ctx.coopDefenseMapEventDirector?.reset();
    this.ctx.coopDefenseMapEventDirector = null;
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
    this.renderers.healingAura.destroyAll();
    this.renderers.miniTeslaDome.destroyAll();
    this.renderers.energyShield.destroyAll();
    this.renderers.guardianSpirit.destroyAll();
    this.renderers.repairDrone.destroyAll();
    this.renderers.objectiveRepairDrones.destroyAll();
    this.renderers.slimeTrail.clear();
    this.renderers.corpseMarker.clearAll();
    this.renderers.flamethrowerUpgrades.clear();
    this.ctx.effectSystem.clearAllBurrowStates();
    // Laufende Kameraquellen und Trefferkopien dürfen nicht in die Lobby überlaufen.
    this.ctx.visualFeedback.reset();
    this.placementPreview.clearForTeardown();
    this.rockVisualHelper.destroyAllTurretVisuals();

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
    this.ctx.coopDefenseSurvivalSystem = null;
    this.ctx.projectileManager.setNaturalFlameExpiryCallback(null);
    this.ctx.hostPhysics.setEnemyMovementFactorResolver(null);
    this.ctx.combatSystem.setDeathCallback(null);
    this.ctx.combatSystem.setEnemyDeathCallback(null);
    this.ctx.combatSystem.setPlayerMaxHpResolver(null);
    this.ctx.combatSystem.setInitialSpawnAllowedResolver(null);
    this.ctx.combatSystem.setRespawnAllowedResolver(null);
    this.ctx.combatSystem.setRespawnCallback(null);
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
    this.ctx.rockRegistry   = null;
    this.ctx.currentLayout  = null;
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
    this.ctx.combatSystem.setBaseObstacles(null);
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
    this.renderers.leafBlower.setTerrainColorSampler(null);
    this.ctx.tunnelSystem?.clear();
    this.ctx.tunnelSystem = null;
    this.ctx.coopDefenseRoundStateSystem = null;

    this.renderers.powerUp.clear();
    this.renderers.nuke.clear();
    this.renderers.airstrike.clear();
    this.renderers.encounterTelegraph.clear();
    this.renderers.meteor.clear();
    this.ctx.armageddonSystem?.destroyAll();
    this.ctx.armageddonSystem = null;
    this.ctx.airstrikeSystem?.clear();
    this.ctx.airstrikeSystem?.setResolvedCallback(null);
    this.ctx.airstrikeSystem = null;

    this.ctx.trainManager?.destroy();
    this.ctx.trainManager = null;
    this.ctx.enemyFlowFieldService?.destroy();
    this.ctx.enemyFlowFieldService = null;
    this.ctx.enemyPlayerFlowFieldService?.destroy();
    this.ctx.enemyPlayerFlowFieldService = null;
    this.ctx.enemyStrategicTargetService?.clear();
    this.ctx.enemyStrategicTargetService = null;
    this.ctx.enemyStrategicFlowFieldService?.destroy();
    this.ctx.enemyStrategicFlowFieldService = null;
    this.ctx.enemyBossFlowFieldService?.destroy();
    this.ctx.enemyBossFlowFieldService = null;
    for (const flowField of this.ctx.allyFlowFieldServices.values()) flowField.destroy();
    this.ctx.allyFlowFieldServices.clear();
    this.renderers.train?.destroy();
    this.renderers.train = null;
    this.renderers.beer.clear();
    this.renderers.shadow.clear();
    this.renderers.lighting.setActive(false);
    this.renderers.lighting.setOccluderIndex(null);
    this.ctx.lightOccluderIndex = null;
    this.renderers.translocatorTeleport = null;
    this.ctx.projectileManager.setTrainGroup(null);
    this.ctx.projectileManager.setTrainHitCallback(null);
    this.ctx.centerHUD.hideTrainWidget();
    this.clientUpdate.clientUtilityOverride = null;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private onTransitionToArena(): void {
    const layout = bridge.getArenaLayout();
    // Im Coop-Modus zusätzlich auf den (reliable) RoundState warten: er trägt Map-ID und Spielerzahl,
    // aus denen Basen/Druckquellen/Gegner deterministisch gebaut werden. Ohne dieses Gate kann der Client
    // bauen, bevor diese Keys angekommen sind → fehlende/falsche Basis. Das 3-s-Countdown-Fenster
    // (ARENA_COUNTDOWN_SEC) bietet reichlich Zeit für die Retries.
    const roundState = bridge.getRoundState();
    const roundStateReady = roundState?.status === 'active'
      && roundState.roundStartTime === bridge.getArenaStartTime();
    if (!layout || !roundStateReady) {
      this.layoutRetryCount++;
      if (this.layoutRetryCount >= ArenaLifecycleCoordinator.LAYOUT_RETRY_LIMIT) {
        this.layoutRetryCount = 0;
        this.terminateMatch();
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
    this.buildArena(layout);
    this.arenaBuilt = true;

    for (const profile of bridge.getConnectedPlayers()) {
      const canCreatePlayer = bridge.canPlayerSpawnOrRespawn(profile.id)
        && (!bridge.isHost() || bridge.canPlayerInitialSpawn(profile.id));
      if (canCreatePlayer
        && bridge.getPlayerReady(profile.id)
        && !this.ctx.playerManager.hasPlayer(profile.id)) {
        this.ctx.playerManager.addPlayer(profile);
        if (bridge.isHost()) {
          this.ctx.combatSystem.initPlayer(profile.id);
          this.ctx.coopDefenseSurvivalSystem?.registerInitialSpawn(profile.id);
          this.ctx.resourceSystem?.initPlayer(profile.id);
          this.ctx.coopDefenseItemRuntimeSystem?.initPlayer(profile.id);
          this.ctx.burrowSystem?.initPlayer(profile.id);
          this.ctx.loadoutManager?.assignDefaultLoadout(profile.id, this.resolveCommittedLoadoutSelection(profile.id));
        }
      }
    }

    this.ctx.leftPanel.transitionToGame();
    this.ctx.rightPanel.transitionToGame();
    this.ctx.centerHUD.transitionToGame();
    this.syncHostLoadoutsFromCommittedSelections();
    this.resetLocalArenaHudState();
    this.localPlayerState.spectator = false;
    this.localPlayerState.overlayTrackedAlive = null;
    this.ctx.arenaCountdown?.syncTo(bridge.getArenaStartTime());
    this.lobbyOverlay.lockButton();
    this.lobbyOverlay.hide();
    this.hostUpdate.setActive(true);
    this.ctx.gameAudioSystem.playMusic('music_arena');
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
    const spawnAt    = plan ? bridge.getArenaStartTime() + plan.firstArrivalDelayMs : null;

    if (spawnAt !== null) bridge.publishTrainEvent({ trackX, direction, spawnAt });

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
      emitArenaMapGridChanged(this.scene.game.events, {
        reason: 'placeable_added',
        source: 'placeable_pedestal',
        obstacleId: pedestal.id,
        gridX: pedestal.gridX,
        gridY: pedestal.gridY,
      });
      return true;
    }

    const rock = this.ctx.placementSystem?.tryPlaceRock(cfg, playerId, playerColor, originX, originY, targetX, targetY, now);
    if (!rock) return false;
    this.rockVisualHelper.materializePlaceableRock(rock, true);
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
    if (!bridge.isHost() || !isConstructionId(constructionId)) {
      return { ok: false, reason: 'invalid' };
    }
    const committed = bridge.getPlayerCommittedLoadout(playerId);
    if (
      !committed
      || committed.coopDefenseClassId !== 'inspector_gadachs'
      || !committed.coopDefenseProfile
    ) {
      return { ok: false, reason: 'blocked' };
    }
    if (!getUnlockedCoopDefenseConstructionIds(committed.coopDefenseProfile).includes(constructionId)) {
      return { ok: false, reason: 'invalid' };
    }
    if (!(committed.tools ?? []).some((tool) => tool.kind === 'construction' && tool.id === constructionId)) {
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
    const construction = this.ctx.placementSystem?.tryPlaceConstruction(
      definition,
      definition.maxHp * hpMultiplier,
      playerId,
      player.color,
      player.sprite.x,
      player.sprite.y,
      targetX,
      targetY,
    );
    if (!construction) return { ok: false, reason: 'blocked' };

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
        return { ok: false, reason: 'blocked' };
      }
    }

    const placedAt = Date.now();
    this.ctx.loadoutManager?.markConstructionUsed(playerId, constructionId, placedAt);
    // Ueber denselben Kanal wie Utility-Cooldowns, damit auch Clients den Bau-Cooldown
    // des gewaehlten Konstrukts im HUD sehen.
    bridge.publishUtilityCooldownUntil(playerId, placedAt + definition.buildCooldownMs, constructionId);
    this.rockVisualHelper.materializePlaceableRock(construction, true);
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
    if (!(committed.tools ?? []).some((entry) => entry.kind === 'utility' && entry.id === tool.id)) {
      return { ok: false, reason: 'blocked' };
    }
    const config = getUtilityConfigForMode(tool.id, bridge.getGameMode()) as UtilityConfig | undefined;
    if (!config) return { ok: false, reason: 'invalid' };
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
    return getCoopDefenseConstructionCapacity(
      this.ctx.coopDefensePlayerModifierSystem?.getNumericStat(
        playerId,
        COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT,
      ) ?? 0,
    );
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
    const committed = bridge.getPlayerCommittedLoadout(playerId);
    if (!committed || committed.coopDefenseClassId !== 'inspector_gadachs') {
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
    const removed = this.ctx.placementSystem?.removeRockAt(cell.gridX, cell.gridY, playerId);
    if (!removed) return { ok: false, reason: 'blocked' };

    this.ctx.targetStatusSystem?.removeTarget({ targetType: 'construction', targetId: String(removed.id) });
    this.ctx.energyInjectorSystem?.removeTarget({ targetType: 'construction', targetId: String(removed.id) });

    if (removed.kind === 'pedestal') {
      this.ctx.powerUpSystem?.unregisterConstructionPedestal(removed.id);
    }
    this.rockVisualHelper.removePlaceableRockVisual(removed, true);
    this.ctx.gameAudioSystem.playSound('sfx_place_rock', cell.x, cell.y, playerId);
    emitArenaMapGridChanged(this.scene.game.events, {
      reason: 'placeable_removed',
      source: removed.kind === 'rock' ? 'placeable_rock' : 'placeable_turret',
      obstacleId: removed.id,
      gridX: removed.gridX,
      gridY: removed.gridY,
    });
    return { ok: true };
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
    const rock = this.ctx.arenaResult?.rockObjects[rockId];
    if (!rock?.active) return null;
    const bounds = rock.getBounds();
    return { x: bounds.centerX, y: bounds.centerY, width: bounds.width, height: bounds.height };
  }

  private resetLocalArenaHudState(): void {
    const config = this.clientUpdate.getLocalUltimateConfig();
    const hudData = buildInitialLocalArenaHudData({
      maxArmor: this.clientUpdate.getLocalMaxArmor(),
      maxAdrenaline: this.clientUpdate.getLocalMaxAdrenaline(),
      maxRage: this.clientUpdate.getLocalMaxRage(),
      ultimateRequiredRage: config.rageRequired,
      ultimateThresholds:   this.clientUpdate.getLocalUltimateThresholds(),
      ultimateId:            config.id,
      utilityId:             this.clientUpdate.getLocalUtilityConfig().id,
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

  private resolveCommittedLoadoutSelection(playerId: string): LoadoutSelection {
    const committed = bridge.getPlayerCommittedLoadout(playerId);
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
