import type Phaser from 'phaser';
import { bridge }            from '../../network/bridge';
import { ArenaBuilder }      from '../../arena/ArenaBuilder';
import { ArenaGenerator }    from '../../arena/ArenaGenerator';
import { createArenaTerrainColorSampler } from '../../arena/ArenaTerrainColorSampler';
import { RockRegistry }      from '../../arena/RockRegistry';
import { PlacementSystem }   from '../../systems/PlacementSystem';
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
import { CoopDefensePlayerModifierSystem } from '../../systems/CoopDefensePlayerModifierSystem';
import { GuardianSpiritSystem } from '../../systems/GuardianSpiritSystem';
import { SlimeTrailSystem } from '../../systems/SlimeTrailSystem';
import { FlamethrowerUpgradeSystem } from '../../systems/FlamethrowerUpgradeSystem';
import { WeaponUpgradeSystem } from '../../systems/WeaponUpgradeSystem';
import { NecromancySystem } from '../../systems/NecromancySystem';
import { CoopDefenseRoundStateSystem } from '../../systems/CoopDefenseRoundStateSystem';
import { CoopDefenseWaveSpawner } from '../../systems/CoopDefenseWaveSpawner';
import {
  CoopDefenseAirstrikeDirector,
  COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID,
  isPointNearBaseRegion,
} from '../../systems/CoopDefenseAirstrikeDirector';
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
import { TrainRenderer }     from '../../train/TrainRenderer';
import { TranslocatorTeleportRenderer } from '../../effects/TranslocatorTeleportRenderer';
import { GROUND_FIRE_CELL_SIZE } from '../../effects/FireSystem';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, ULTIMATE_CONFIGS, DEFAULT_LOADOUT } from '../../loadout/LoadoutConfig';
import type { PlaceableUtilityConfig, PlaceableTurretUtilityConfig } from '../../loadout/LoadoutConfig';
import type { LoadoutSelection } from '../../loadout/LoadoutManager';
import { getBaseWorldBounds, getCoopDefenseBases } from '../../arena/BaseRegistry';
import { getCoopDefenseMapConfig, getCoopDefenseMapScheduledXp, resolveCoopDefenseMapWaveConfigs } from '../../config/coopDefenseMaps';
import { buildInitialLocalArenaHudData } from '../../ui/LocalArenaHudData';
import { ARENA_COUNTDOWN_SEC, ARENA_DURATION_SEC, HP_MAX, PLAYER_COLORS, ARENA_OFFSET_X, CELL_SIZE, ARENA_HEIGHT, ARENA_OFFSET_Y, GRID_COLS, GRID_ROWS, TEAM_BLUE_COLOR, COOP_DEFENSE_BASE_TURRET_OWNER_ID, applyArenaMetricsForMode } from '../../config';
import { DASH_GROUND_FIRE_BURN_DURATION_MS, DASH_GROUND_FIRE_DAMAGE_PER_TICK, DASH_T2_S, PLAYER_SPEED, SHOCKWAVE_DAMAGE, SHOCKWAVE_RADIUS } from '../../config';
import { TRAIN }             from '../../train/TrainConfig';
import { TRAIN_DROP_COUNT }  from '../../powerups/PowerUpConfig';
import type { ArenaContext }          from './ArenaContext';
import type { RendererBundle }        from './RendererBundle';
import type { RockVisualHelper }      from './RockVisualHelper';
import type { PlacementPreviewRenderer } from './PlacementPreviewRenderer';
import type { HostUpdateCoordinator } from './HostUpdateCoordinator';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { LobbyOverlay }          from '../LobbyOverlay';
import type { ArenaLayout, LoadoutCommitSnapshot, LoadoutUseParams, RoomQualitySnapshot } from '../../types';
import type { RoundOutcome, RoundResult, RoundState } from '../../network/NetworkBridge';
import type { RoomQualityMonitor }    from '../../network/RoomQualityMonitor';
import { CAPTURE_THE_BEER_MODE, isCoopDefenseMode, isTeamGameMode } from '../../gameModes';
import { BaseManager } from '../../entities/BaseManager';
import { EnemyManager } from '../../entities/EnemyManager';
import { getCoopDefenseEnemyConfig, resolveCoopDefenseEnemyConfigs } from '../../config/coopDefenseEnemies';
import { emitArenaMapGridChanged } from './ArenaEvents';

/**
 * Manages the arena round lifecycle.
 *
 * Responsibilities: buildArena / tearDownArena, LOBBY ↔ ARENA phase transitions,
 * host quality checks, round result saving, train event setup.
 * Mutates ArenaContext round-scoped fields (arenaResult, currentLayout, etc.).
 */
export class ArenaLifecycleCoordinator {
  private matchTerminated   = false;
  private roundStartPending = false;
  private isLocalReady      = false;
  private lastPhase: import('../../types').GamePhase = 'LOBBY';
  private trainDestroyedShown = false;

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

  detectPhaseChange(): void {
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
    this.lastPhase = current;
    bridge.resetGameplayTransport();
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
    applyArenaMetricsForMode(bridge.getGameMode(), 'ARENA');
    const arenaStartTime = Date.now() + ARENA_COUNTDOWN_SEC * 1000;
    const coopDefenseMapConfig = isCoopDefenseMode(bridge.getGameMode())
      ? getCoopDefenseMapConfig(bridge.getCoopDefenseMapId())
      : null;
    const roundDurationSec = coopDefenseMapConfig?.roundDurationSec ?? ARENA_DURATION_SEC;
    const layout = ArenaGenerator.generate(Date.now(), coopDefenseMapConfig ?? undefined);
    bridge.publishArenaLayout(ArenaGenerator.stripVisualOnlyFields(layout));
    bridge.setArenaStartTime(arenaStartTime);
    bridge.setRoundEndTime(arenaStartTime + roundDurationSec * 1000);
    const roundState: RoundState | null = isCoopDefenseMode(bridge.getGameMode())
      ? {
        status: 'active',
        roundStartTime: arenaStartTime,
        coopDefenseHumanPlayerCount: Math.max(1, bridge.getConnectedPlayers().length),
        coopDefenseMapId: bridge.getCoopDefenseMapId(),
      }
      : null;
    bridge.publishRoundState(roundState);
    bridge.setGamePhase('ARENA');
  }

  spawnReadyPlayers(): void {
    if (!bridge.isHost()) return;
    for (const profile of bridge.getConnectedPlayers()) {
      if (bridge.getPlayerReady(profile.id) && !this.ctx.playerManager.hasPlayer(profile.id)) {
        // Erst spawnen, wenn der host das verbindliche Loadout-Snapshot wirklich hat. Sonst würde
        // resolveCommittedLoadoutSelection() auf die separat propagierten Live-Slots zurückfallen –
        // die bei umgekehrter Key-Reihenfolge noch veraltet sein können (Ursache von "mit falscher
        // Waffe gestartet"). Das Match startet ohnehin erst, wenn alle committed sind (areAllPlayersReady),
        // daher verzögert das den Spawn höchstens um wenige Frames im Countdown.
        if (!this.hostHasCommittedLoadoutForSpawn(profile.id)) continue;
        this.ctx.playerManager.addPlayer(profile);
        this.ctx.combatSystem.initPlayer(profile.id);
        this.ctx.resourceSystem?.initPlayer(profile.id);
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

  hostSaveRoundResults(): void {
    if (!bridge.isHost()) return;
    const results: RoundResult[] = bridge.getConnectedPlayers().map((p) => {
      const teamId = isTeamGameMode(bridge.getGameMode()) ? bridge.getPlayerTeam(p.id) : null;
      return {
        id:       p.id,
        name:     p.name,
        colorHex: p.colorHex,
        frags:    bridge.getPlayerFrags(p.id),
        teamId,
        teamScore: bridge.getGameMode() === CAPTURE_THE_BEER_MODE && teamId
          ? this.ctx.captureTheBeerSystem?.getTeamScore(teamId) ?? 0
          : undefined,
        sharedXp: isCoopDefenseMode(bridge.getGameMode()) ? bridge.getCoopDefenseRoundXp() : undefined,
      };
    });
    bridge.publishRoundResults(results);
  }

  hostCompleteRound(roundOutcome: RoundOutcome | null = null): void {
    if (!bridge.isHost() || bridge.getGamePhase() !== 'ARENA') return;

    if (roundOutcome) {
      const currentRoundState = bridge.getRoundState();
      bridge.publishRoundState({
        status: roundOutcome,
        roundStartTime: bridge.getArenaStartTime(),
        coopDefenseHumanPlayerCount: currentRoundState?.coopDefenseHumanPlayerCount,
        coopDefenseMapId: currentRoundState?.coopDefenseMapId,
        endedAt: Date.now(),
      });
    } else {
      bridge.publishRoundState(null);
    }

    this.hostSaveRoundResults();
    // Alle Spieler host-autoritativ auf "nicht bereit" setzen, BEVOR die Lobby-Phase greift. So ist der
    // Host-Zustandsspeicher garantiert sauber (auch wenn ein Client seinen Ready-Status nicht selbst
    // zurücksetzt) und es kann keine neue Runde durch stehengebliebene Ready-Flags sofort starten.
    bridge.hostResetAllLobbyReady();
    bridge.setGamePhase('LOBBY');
  }

  terminateMatch(): void {
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
    this.lobbyOverlay.showHostDisconnectedMessage();
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
    const coopRoundState = bridge.getRoundState();
    const coopDefenseMapConfig = isCoopDefenseMode(bridge.getGameMode())
      ? getCoopDefenseMapConfig(coopRoundState?.coopDefenseMapId ?? bridge.getCoopDefenseMapId())
      : null;
    const coopDefenseHumanPlayerCount = isCoopDefenseMode(bridge.getGameMode())
      ? Math.max(1, Math.floor(coopRoundState?.coopDefenseHumanPlayerCount ?? 1))
      : 1;
    const coopDefenseEnemyConfigs = isCoopDefenseMode(bridge.getGameMode())
      ? resolveCoopDefenseEnemyConfigs(coopDefenseHumanPlayerCount)
      : null;
    const coopDefenseBases = coopDefenseMapConfig ? getCoopDefenseBases(coopDefenseMapConfig) : [];
    const coopDefenseWaveConfigs = coopDefenseMapConfig
      ? resolveCoopDefenseMapWaveConfigs(coopDefenseMapConfig, coopDefenseHumanPlayerCount)
      : [];
    this.ctx.currentLayout = layout;
    const builder = new ArenaBuilder(this.scene);
    this.ctx.arenaResult = builder.buildDynamic(layout);
    this.ctx.placementSystem = new PlacementSystem(layout, this.ctx.arenaResult.rockGrid, this.ctx.playerManager);
    this.ctx.captureTheBeerSystem = bridge.getGameMode() === CAPTURE_THE_BEER_MODE
      ? new CaptureTheBeerSystem(this.ctx.playerManager)
      : null;

    // Coop-Defense: BaseManager besitzt die Basis-Entities (Visual + Physik + HP + Sync).
    // Host und Client erzeugen identische BaseEntities aus der gemeinsamen Registry –
    // HP-Werte fließen über GameState.bases (Host → Client).
    this.ctx.baseManager = isCoopDefenseMode(bridge.getGameMode())
      ? new BaseManager(this.scene, coopDefenseBases)
      : null;
    this.ctx.enemyManager = isCoopDefenseMode(bridge.getGameMode()) && coopDefenseEnemyConfigs
      ? new EnemyManager(this.scene, coopDefenseEnemyConfigs)
      : null;
    this.ctx.coopDefenseRoundStateSystem = bridge.isHost() && this.ctx.baseManager && isCoopDefenseMode(bridge.getGameMode())
      ? new CoopDefenseRoundStateSystem(
        this.ctx.baseManager,
        () => bridge.computeSecondsLeft(),
        !!coopDefenseMapConfig?.boss,
        () => this.ctx.coopDefenseWaveSpawner?.isBossDefeated() ?? false,
      )
      : null;
    if (bridge.isHost()) {
      this.ctx.coopDefensePlayerModifierSystem = isCoopDefenseMode(bridge.getGameMode())
        ? new CoopDefensePlayerModifierSystem()
        : null;
      this.syncHostCoopDefensePlayerModifiersFromCommittedSelections();

      const obstacleCellProvider = () => {
        const staticRockCells = layout.rocks.flatMap((rock, index) => {
          const isActive = this.ctx.arenaResult?.rockObjects[index]?.active ?? false;
          return isActive ? [{ gridX: rock.gridX, gridY: rock.gridY }] : [];
        });
        const runtimeRockCells = (this.ctx.placementSystem?.getAllRuntimeRocks() ?? []).map((rock) => ({
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
        })
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
        })
        : null;
      for (const flowField of this.ctx.allyFlowFieldServices.values()) flowField.destroy();
      this.ctx.allyFlowFieldServices.clear();
      for (const player of this.ctx.playerManager.getAllPlayers()) {
        this.ctx.allyFlowFieldServices.set(player.id, new EnemyFlowFieldService(layout, coopDefenseBases, flowFieldMetrics, {
          eventBus: this.scene.game.events,
          obstacleCellProvider,
          goalMode: 'dynamic-fallback-bases',
        }));
      }
      if (this.ctx.enemyManager && this.ctx.enemyFlowFieldService && coopDefenseWaveConfigs.length > 0) {
        this.ctx.coopDefenseWaveSpawner = new CoopDefenseWaveSpawner(
          this.ctx.enemyManager,
          this.ctx.enemyFlowFieldService,
          coopDefenseWaveConfigs,
          coopDefenseMapConfig?.boss,
          this.ctx.enemyBossFlowFieldService,
        );
      }
      // Wenn eine Basis zerstört wird, soll die Wegfindung sich neu orientieren:
      // Goal-Cells werden nur noch aus den verbleibenden Basen aufgebaut, so dass
      // Gegner zur nächstgelegenen aktiven Basis laufen.
      const baseManager = this.ctx.baseManager;
      const flowFieldService = this.ctx.enemyFlowFieldService;
      const playerFlowFieldService = this.ctx.enemyPlayerFlowFieldService;
      const bossFlowFieldService = this.ctx.enemyBossFlowFieldService;
      if (baseManager && flowFieldService && playerFlowFieldService) {
        baseManager.setOnBaseDestroyed((destroyedBase) => {
          this.ctx.powerUpSystem?.destroyPedestalsLinkedToBase(destroyedBase.id);
          const activeBaseIds = baseManager.getActiveBaseIds();
          flowFieldService.setActiveBaseIds(activeBaseIds);
          playerFlowFieldService.setActiveBaseIds(activeBaseIds);
          bossFlowFieldService?.setActiveBaseIds(activeBaseIds);
        });
      }
    }
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
    this.ctx.combatSystem.setPlayerDamageReductionResolver((playerId) => {
      return this.ctx.loadoutManager?.getEquippedWeaponConfig(playerId, 'weapon1')?.damageReduction ?? 0;
    });
    this.ctx.combatSystem.setPlayerHpRegenPerSecondResolver((playerId) => {
      return this.ctx.coopDefensePlayerModifierSystem?.getHpRegenPerSecond(playerId) ?? 0;
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
      return this.ctx.coopDefensePlayerModifierSystem?.getNumericStat(playerId, 'player.lifeLeechFraction') ?? 0;
    });
    this.ctx.combatSystem.setPlayerArmorRegenPerSecondResolver((playerId) => {
      return this.ctx.coopDefensePlayerModifierSystem?.getNumericStat(playerId, 'player.armorRegenPerSecond') ?? 0;
    });
    this.ctx.guardianSpiritSystem = bridge.isHost() && this.ctx.enemyManager && this.ctx.coopDefensePlayerModifierSystem
      ? new GuardianSpiritSystem(
        this.ctx.playerManager,
        this.ctx.enemyManager,
        this.ctx.combatSystem,
        (playerId, stat, baseValue) => this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, stat, baseValue) ?? baseValue,
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
      this.ctx.flamethrowerUpgradeSystem?.handleEnemyDeath(x, y, burnSources);
      const burst = this.ctx.slimeTrailSystem?.handleEnemyDeath(enemyId, x, y, Date.now());
      if (burst) bridge.broadcastSlimeBloomEffect(burst.x, burst.y, burst.targets);
      if (death) this.ctx.necromancySystem?.recordEnemyDeath(death);
    });

    this.ctx.combatSystem.setRockDamageCallback((rockIndex, damage, attackerId) => {
      const newHp = this.rockVisualHelper.applyObstacleDamageById(rockIndex, damage, attackerId);
      if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(rockIndex, 'damage');
    });
    this.ctx.combatSystem.setTrainDamageCallback((damage, attackerId) => {
      this.ctx.trainManager?.applyDamage(damage, attackerId);
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
      this.ctx.flamethrowerUpgradeSystem?.handlePlayerDeath(playerId, x, y);
      this.ctx.captureTheBeerSystem?.dropBeerForPlayer(playerId, x, y);
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
      return this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.runSpeed', PLAYER_SPEED) ?? PLAYER_SPEED;
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
        weaponName: 'Brennende Dash-Spur',
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
        return this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.adrenalineRegenRate', 10) ?? 10;
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
      this.ctx.turretSystem.setLineOfSightChecker((sx, sy, ex, ey, skipRockIndex) => {
        return this.ctx.combatSystem.hasLineOfSight(sx, sy, ex, ey, skipRockIndex);
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
              weaponId: 'SPOREN' as const,
            }));
          const baseTurrets = (this.ctx.baseManager?.getTurrets() ?? []).map((turret) => ({
            id: turret.id,
            x: turret.x,
            y: turret.y,
            ownerId: COOP_DEFENSE_BASE_TURRET_OWNER_ID,
            ownerColor: TEAM_BLUE_COLOR,
            weaponId: turret.weaponId,
          }));
          return [...placeableTurrets, ...baseTurrets];
        },
        (id: AutomatedTurretId, angle) => {
          if (typeof id === 'number') this.ctx.placementSystem?.updateAngle(id, angle);
          else this.ctx.baseManager?.setTurretAngle(id, angle);
        },
      );
      this.ctx.turretSystem.setEnemyTargetProvider(
        () => (this.ctx.enemyManager?.getAllEnemies() ?? [])
          .filter(enemy => enemy.sprite.active)
          .map(enemy => ({ id: enemy.id, x: enemy.sprite.x, y: enemy.sprite.y })),
      );
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
          (x, y, targets, landsAt) => bridge.broadcastFireChunkEffect(x, y, targets, landsAt),
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
            weaponName: 'Negev-Killstreak',
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
      this.ctx.decoySystem.setCombatStateReader(this.ctx.combatSystem);
      this.ctx.decoySystem.setRunSpeedResolver((playerId) => {
        const runSpeed = this.ctx.coopDefensePlayerModifierSystem?.getResolvedStat(playerId, 'player.runSpeed', PLAYER_SPEED) ?? PLAYER_SPEED;
        return runSpeed * (this.ctx.loadoutManager?.getSpeedMultiplier(playerId) ?? 1);
      });
      this.ctx.decoySystem.setCooldownStarter((playerId, utilityId, when) => {
        this.ctx.loadoutManager?.beginUtilityCooldown(playerId, utilityId, when);
      });
      this.ctx.decoySystem.setExplosionCallback((ownerId, x, y, radius, damage, knockback) => {
        this.ctx.combatSystem.applyAoeDamage(x, y, radius, damage, ownerId, false, { category: 'explosion', allowTeamDamage: false, weaponName: 'Sprengattrappe', sourceSlot: 'utility' });
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
      this.ctx.turretSystem.setFireHandler((ownerId, color, weaponId, x, y, angle, targetX, targetY, damageFactor = 1) => {
        const turretCfg = UTILITY_CONFIGS.FLIEGENPILZ as PlaceableTurretUtilityConfig;
        const weapon    = WEAPON_CONFIGS[weaponId] ?? WEAPON_CONFIGS[turretCfg.weaponId as keyof typeof WEAPON_CONFIGS];
        const fire = ownerId === COOP_DEFENSE_BASE_TURRET_OWNER_ID && weapon.fire.type === 'projectile'
          ? {
            ...weapon.fire,
            homing: weapon.fire.homing
              ? { ...weapon.fire.homing, targetTypes: ['enemies'] as const }
              : undefined,
          }
          : weapon.fire;
        this.ctx.loadoutManager?.fireAutomatedWeapon(
          { ...weapon, fire, damage: weapon.damage * damageFactor },
          x,
          y,
          angle,
          targetX,
          targetY,
          ownerId,
          color,
          { ignoreBaseCollisions: ownerId === COOP_DEFENSE_BASE_TURRET_OWNER_ID },
        );
      });
      if (this.ctx.enemyManager && this.ctx.baseManager) {
        this.ctx.coopDefenseEnemyTrainAwarenessSystem = new CoopDefenseEnemyTrainAwarenessSystem(
          () => this.ctx.trainManager,
          () => bridge.getTrainEvent(),
          (enemy, now) => enemy.getMoveSpeed()
            * this.ctx.hostPhysics.getWorldMovementFactorAt(enemy.sprite.x, enemy.sprite.y, now),
        );
        this.ctx.coopDefenseEnemyAbilitySystem = new CoopDefenseEnemyAbilitySystem(
          this.ctx.enemyManager,
          this.ctx.playerManager,
          this.ctx.projectileManager,
          this.ctx.combatSystem,
          this.ctx.energyShieldSystem,
          this.ctx.stinkCloudSystem,
        );
        this.ctx.coopDefenseEnemyAttackSystem = new CoopDefenseEnemyAttackSystem(
          this.ctx.enemyManager,
          this.ctx.playerManager,
          this.ctx.baseManager,
          this.ctx.combatSystem,
          this.ctx.loadoutManager,
          () => this.ctx.arenaResult?.rockObjects ?? null,
          this.ctx.coopDefenseEnemyTrainAwarenessSystem,
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
        onNukePickup: (playerId) => {
          this.ctx.loadoutManager?.overrideUtility(playerId, UTILITY_CONFIGS.NUKE, 1);
        },
        onNukeExploded: (x, y, radius, triggeredBy) => {
          bridge.broadcastExplosionEffect(x, y, radius, 0xffd26a, 'nuke');
          this.hostUpdate.applyNukeEnvironmentDamage(x, y, radius, triggeredBy);
        },
        onHolyHandGrenadePickup: (playerId) => {
          this.ctx.loadoutManager?.overrideUtility(playerId, UTILITY_CONFIGS.HOLY_HAND_GRENADE, 1);
        },
        onBfgPickup: (playerId) => {
          this.ctx.loadoutManager?.overrideUtility(playerId, UTILITY_CONFIGS.BFG, 1);
        },
        coopDefenseMapXpTotal: coopDefenseMapConfig
          ? getCoopDefenseMapScheduledXp(coopDefenseMapConfig, coopDefenseWaveConfigs)
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
      });
      this.ctx.powerUpSystem.setArenaStartTime(bridge.getArenaStartTime());
      this.ctx.combatSystem.setPowerUpSystem(this.ctx.powerUpSystem);
      this.ctx.resourceSystem.setPowerUpSystem(this.ctx.powerUpSystem);

      this.ctx.detonationSystem = new DetonationSystem(this.ctx.projectileManager);
      this.ctx.combatSystem.setDetonationSystem(this.ctx.detonationSystem);

      this.ctx.armageddonSystem = new ArmageddonSystem();
      this.ctx.armageddonSystem.setRockGrid(this.ctx.arenaResult.rockGrid);
      this.ctx.loadoutManager.setArmageddonSystem(this.ctx.armageddonSystem);

      this.ctx.airstrikeSystem = new AirstrikeSystem();
      this.ctx.airstrikeSystem.setExplodedCallback((x, y, radius, triggeredBy, cfg) => {
        bridge.broadcastExplosionEffect(x, y, radius, 0xff9933, 'nuke');
        this.hostUpdate.applyAirstrikeEnvironmentDamage(x, y, radius, cfg, triggeredBy);
      });
      this.ctx.loadoutManager.setAirstrikeHandler((playerId, targetX, targetY, cfg) => {
        const player = this.ctx.playerManager.getPlayer(playerId);
        if (!player || !this.ctx.combatSystem.isAlive(playerId)) return false;
        this.ctx.gameAudioSystem.playSound('sfx_airstrike_countdown', targetX, targetY);
        return this.ctx.airstrikeSystem?.scheduleStrike(playerId, targetX, targetY, cfg) ?? false;
      });
      // Zombie-Luftangriffe: Auf Maps mit enemyAirstrikes bombardiert die Gegner-
      // fraktion erst den Tutorial-Felsbereich und jagt danach zufällige Spieler.
      this.ctx.coopDefenseAirstrikeDirector = coopDefenseMapConfig?.enemyAirstrikes
        ? new CoopDefenseAirstrikeDirector({
          scheduleStrike: (x, y, cfg) => {
            this.ctx.airstrikeSystem?.scheduleStrike(COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID, x, y, cfg);
          },
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
        })
        : null;
      this.ctx.loadoutManager.setStinkCloudSystem(this.ctx.stinkCloudSystem);
      this.ctx.combatSystem.setStinkCloudSystem(this.ctx.stinkCloudSystem);
      this.ctx.burrowSystem.setStinkCloudSystem(this.ctx.stinkCloudSystem);

      this.ctx.projectileManager.setBfgLaserCallback((proj) => {
        this.hostUpdate.resolveBfgLasers(proj);
      });
      this.ctx.projectileManager.setProximityArcCallback((proj) => {
        this.hostUpdate.resolveProjectileProximityArcs(proj);
      });
      this.ctx.projectileManager.setTimeBubbleFactorProvider((x, y, now, ownerId) => {
        return this.ctx.timeBubbleSystem?.getProjectileMovementFactorAt(x, y, now, ownerId) ?? 1;
      });

      this.ctx.hostPhysics.setBurrowSystem(this.ctx.burrowSystem);
      this.ctx.hostPhysics.setLoadoutManager(this.ctx.loadoutManager);
      this.ctx.hostPhysics.setTimeBubbleSystem(this.ctx.timeBubbleSystem);

      this.ctx.combatSystem.setKillCallback((killerId, victimId, weapon, x, y, source) => {
        this.ctx.loadoutManager?.handleKill(killerId, weapon, x, y, source);
        if (isCoopDefenseMode(bridge.getGameMode()) && (source?.enemyXp ?? 0) > 0) {
          this.ctx.powerUpSystem?.onCoopDefenseEnemyKilled(killerId, source?.enemyXp ?? 0, x, y);
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
              weapon:      'überfahren',
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
              weapon:      'Luftangriff',
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
            weapon,
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
        const newHp = this.rockVisualHelper.applyObstacleDamageById(rockId, damage, attackerId);
        if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(rockId, 'damage');
      });

      const trackCell = layout.tracks?.[0];
      if (trackCell !== undefined) {
        this.setupHostTrainEvent(trackCell.gridX);
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
    this.renderers.shadow.rebuildArenaStaticShadows(
      this.ctx.currentLayout,
      this.ctx.arenaResult,
      this.ctx.placementSystem?.getAllRuntimeRocks() ?? [],
    );

    // Reset per-round state in coordinators
    this.hostUpdate.resetPerRound();
    this.clientUpdate.resetPerRound();
    this.trainDestroyedShown = false;
  }

  tearDownArena(): void {
    this.ctx.coopDefenseEnemyAbilitySystem?.clear();
    this.ctx.coopDefenseEnemyTrainAwarenessSystem?.clear();
    this.ctx.projectileManager.destroyAll();
    this.ctx.smokeSystem.destroyAll();
    this.ctx.fireSystem.destroyAll();
    this.ctx.fireSystem.setGroundResolvers(null, null);
    this.ctx.stinkCloudSystem.destroyAll();
    this.ctx.timeBubbleSystem?.destroyAll();
    this.ctx.decoySystem.clearAll();
    this.renderers.timeBubble.destroyAll();
    this.renderers.teslaDome.destroyAll();
    this.renderers.healingAura.destroyAll();
    this.renderers.miniTeslaDome.destroyAll();
    this.renderers.energyShield.destroyAll();
    this.renderers.guardianSpirit.destroyAll();
    this.renderers.slimeTrail.clear();
    this.renderers.flamethrowerUpgrades.clear();
    this.ctx.effectSystem.clearAllBurrowStates();
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
    this.ctx.necromancySystem?.clear();
    this.ctx.necromancySystem = null;
    this.ctx.enemyManager?.destroy();
    this.ctx.enemyManager = null;
    this.ctx.coopDefenseEnemyAbilitySystem = null;
    this.ctx.coopDefenseEnemyTrainAwarenessSystem = null;
    this.ctx.coopDefensePlayerModifierSystem?.clear();
    this.ctx.coopDefensePlayerModifierSystem = null;
    this.ctx.guardianSpiritSystem?.clear();
    this.ctx.guardianSpiritSystem = null;
    this.ctx.slimeTrailSystem?.clear();
    this.ctx.slimeTrailSystem = null;
    this.ctx.flamethrowerUpgradeSystem?.clear();
    this.ctx.flamethrowerUpgradeSystem = null;
    this.ctx.weaponUpgradeSystem = null;
    this.ctx.projectileManager.setNaturalFlameExpiryCallback(null);
    this.ctx.hostPhysics.setEnemyMovementFactorResolver(null);
    this.ctx.combatSystem.setDeathCallback(null);
    this.ctx.combatSystem.setEnemyDeathCallback(null);
    this.ctx.combatSystem.setPlayerMaxHpResolver(null);
    this.ctx.combatSystem.setPlayerDamageReductionResolver(null);
    this.ctx.combatSystem.setPlayerHpRegenPerSecondResolver(null);
    this.ctx.combatSystem.setPlayerMaxArmorResolver(null);
    this.ctx.combatSystem.setPlayerArmorGainMultiplierResolver(null);
    this.ctx.combatSystem.setPlayerArmorDamageGrantsRageResolver(null);
    this.ctx.combatSystem.setPlayerLifeLeechFractionResolver(null);
    this.ctx.combatSystem.setPlayerArmorRegenPerSecondResolver(null);
    this.ctx.rockRegistry   = null;
    this.ctx.currentLayout  = null;
    this.ctx.placementSystem = null;
    this.ctx.powerUpSystem?.reset();
    this.ctx.powerUpSystem  = null;
    this.ctx.shieldBuffSystem = null;
    this.ctx.energyShieldSystem = null;
    this.ctx.timeBubbleSystem = null;
    this.ctx.teslaDomeSystem = null;
    this.ctx.turretSystem    = null;
    this.ctx.resourceSystem?.setPowerUpSystem(null);
    this.ctx.resourceSystem  = null;
    this.ctx.burrowSystem?.setTunnelTransitEndedCallback(null);
    this.ctx.burrowSystem    = null;
    this.ctx.combatSystem.setDetonationSystem(null);
    this.ctx.detonationSystem?.reset();
    this.ctx.detonationSystem = null;
    this.ctx.loadoutManager?.setCombatSystem(null);
    this.ctx.loadoutManager?.setTeslaDomeSystem(null);
    this.ctx.loadoutManager?.setEnergyShieldSystem(null);
    this.ctx.loadoutManager?.setShieldBuffSystem(null);
    this.ctx.loadoutManager?.setNegevKillstreakExplosionHandler(null);
    this.ctx.loadoutManager?.setDecoySystem(null);
    this.ctx.loadoutManager?.setPlaceableRockHandler(null);
    this.ctx.loadoutManager?.setTunnelPlacementHandler(null);
    this.ctx.loadoutManager?.setActionBlockedChecker(null);
    this.ctx.loadoutManager?.resetAllUltimateStates();
    this.ctx.loadoutManager = null;
    this.ctx.combatSystem.setBurrowSystem(null);
    this.ctx.combatSystem.setResourceSystem(null);
    this.ctx.combatSystem.setLoadoutManager(null);
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
    this.ctx.coopDefenseWaveSpawner = null;
    this.ctx.decoySystem.setCombatStateReader(null);
    this.ctx.decoySystem.setRunSpeedResolver(null);
    this.ctx.decoySystem.setCooldownStarter(null);
    this.ctx.decoySystem.setObstacleGroups(null, null);
    this.ctx.projectileManager.setRockGroup(null, null, null);
    this.ctx.projectileManager.setBaseGroup(null);
    this.ctx.projectileManager.setRockHitCallback(() => { /* noop */ });
    this.ctx.projectileManager.setProjectileImpactCallback(null);
    this.ctx.projectileManager.setProjectileResolvedCallback(null);
    this.ctx.projectileManager.setMiniRocketCollectedCallback(null);
    this.ctx.projectileManager.setMiniRocketDestroyedCallback(null);
    this.ctx.projectileManager.setBfgLaserCallback(null);
    this.ctx.projectileManager.setProximityArcCallback(null);
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
    this.renderers.meteor.clear();
    this.ctx.armageddonSystem?.destroyAll();
    this.ctx.armageddonSystem = null;
    this.ctx.airstrikeSystem?.clear();
    this.ctx.airstrikeSystem = null;
    this.ctx.coopDefenseAirstrikeDirector = null;

    this.ctx.trainManager?.destroy();
    this.ctx.trainManager = null;
    this.ctx.enemyFlowFieldService?.destroy();
    this.ctx.enemyFlowFieldService = null;
    this.ctx.enemyPlayerFlowFieldService?.destroy();
    this.ctx.enemyPlayerFlowFieldService = null;
    this.ctx.enemyBossFlowFieldService?.destroy();
    this.ctx.enemyBossFlowFieldService = null;
    for (const flowField of this.ctx.allyFlowFieldServices.values()) flowField.destroy();
    this.ctx.allyFlowFieldServices.clear();
    this.renderers.train?.destroy();
    this.renderers.train = null;
    this.renderers.beer.clear();
    this.renderers.shadow.clear();
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
    // aus denen Basen/Wellen/Gegner deterministisch gebaut werden. Ohne dieses Gate kann der Client
    // bauen, bevor diese Keys angekommen sind → fehlende/falsche Basis. Das 3-s-Countdown-Fenster
    // (ARENA_COUNTDOWN_SEC) bietet reichlich Zeit für die Retries.
    const needsCoopRoundState = isCoopDefenseMode(bridge.getGameMode());
    const coopRoundStateReady = !needsCoopRoundState || bridge.getRoundState() !== null;
    if (!layout || !coopRoundStateReady) {
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

    applyArenaMetricsForMode(bridge.getGameMode(), 'ARENA');
    this.buildArena(layout);
    this.arenaBuilt = true;

    for (const profile of bridge.getConnectedPlayers()) {
      if (bridge.getPlayerReady(profile.id) && !this.ctx.playerManager.hasPlayer(profile.id)) {
        this.ctx.playerManager.addPlayer(profile);
        if (bridge.isHost()) {
          this.ctx.combatSystem.initPlayer(profile.id);
          this.ctx.resourceSystem?.initPlayer(profile.id);
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
    this.localPlayerState.overlayTrackedAlive = null;
    this.clientUpdate.clientUtilityOverride = null;
    this.ctx.arenaCountdown?.clear();
    this.resetLocalArenaHudState();
    this.ctx.gameAudioSystem.playMusic('music_lobby');

    for (const p of [...this.ctx.playerManager.getAllPlayers()]) {
      if (bridge.isHost()) {
        this.ctx.combatSystem.removePlayer(p.id);
        this.ctx.resourceSystem?.removePlayer(p.id);
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
    this.ctx.rightPanel.showRoundResults(bridge.getRoundResults(), bridge.getRoundState());
    this.lobbyOverlay.setReadyButtonState(false);
    this.lobbyOverlay.show();
  }

  private setupHostTrainEvent(trackGridX: number): void {
    const trackX     = ARENA_OFFSET_X + trackGridX * CELL_SIZE + CELL_SIZE;
    const direction: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const spawnAt    = bridge.getArenaStartTime() + TRAIN.SPAWN_DELAY_S * 1000;

    bridge.publishTrainEvent({ trackX, direction, spawnAt });

    this.ctx.trainManager = new TrainManager(this.scene, this.ctx.playerManager, trackX, direction);
    this.ctx.trainManager.setTimeBubbleSystem(this.ctx.timeBubbleSystem);
    this.ctx.trainManager.setEnemyManager(this.ctx.enemyManager);
    this.ctx.translocatorSystem?.setTrainManager(this.ctx.trainManager);
    this.hostUpdate.setTrainSpawned(false);

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
      const weaponName = recentPusherId ? 'in den Zug geschubst' : 'Zug RB 54';
      this.ctx.combatSystem.applyDamage(playerId, 9999, true, attackerId, weaponName, {
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
      const weaponName = recentPusherId ? 'in den Zug geschubst' : 'Zug RB 54';
      const collisionDamage = isRevivedAlly
        ? Math.max(9999, enemy?.getHp() ?? 0)
        : (trainCollision?.damageToEnemy ?? 9999);
      this.ctx.combatSystem.applyDamage(enemyId, collisionDamage, true, attackerId, weaponName, {
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
            weapon:      'Zug RB 54',
            victimId:    '__train__',
            victimName:  'RB 54',
            victimColor: 0xcf573c,
          });
        }
      }
      for (const seg of result.segmentPositions) {
        bridge.broadcastExplosionEffect(seg.x, seg.y, 80, undefined, 'train');
      }
      bridge.broadcastExplosionEffect(result.centerX, result.centerY, 160, undefined, 'train');

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

    this.ctx.trainManager.setExitedCallback(() => {
      const currentEvent = bridge.getTrainEvent();
      if (!currentEvent) return;
      const newDirection: 1 | -1 = currentEvent.direction === 1 ? -1 : 1;
      const newSpawnAt = Date.now() + TRAIN.SPAWN_DELAY_S * 1000;
      bridge.publishTrainEvent({ trackX: currentEvent.trackX, direction: newDirection, spawnAt: newSpawnAt });
      this.ctx.trainManager?.prepareReentry(newDirection);
      this.hostUpdate.setTrainSpawned(false);
    });
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
    );
  }

  private resetLocalArenaHudState(): void {
    const config = this.clientUpdate.getLocalUltimateConfig();
    const hudData = buildInitialLocalArenaHudData({
      maxArmor: this.clientUpdate.getLocalMaxArmor(),
      maxAdrenaline: this.clientUpdate.getLocalMaxAdrenaline(),
      maxRage: this.clientUpdate.getLocalMaxRage(),
      ultimateRequiredRage: config.rageRequired,
      ultimateThresholds:   this.clientUpdate.getLocalUltimateThresholds(),
      ultimateDisplayName:  config.displayName,
      utilityDisplayName:   this.clientUpdate.getLocalUtilityConfig().displayName,
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
      weapon2:  WEAPON_CONFIGS[committed.weapon2  as keyof typeof WEAPON_CONFIGS],
      utility:  UTILITY_CONFIGS[committed.utility  as keyof typeof UTILITY_CONFIGS],
      ultimate: ULTIMATE_CONFIGS[committed.ultimate as keyof typeof ULTIMATE_CONFIGS],
    }, bridge.getGameMode(), committed.coopDefenseProfile);
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
