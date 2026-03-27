import Phaser from 'phaser';
import { bridge }                from '../network/bridge';
import { ArenaBuilder }          from '../arena/ArenaBuilder';
import { PlayerManager }         from '../entities/PlayerManager';
import { ProjectileManager }     from '../entities/ProjectileManager';
import { InputSystem }           from '../systems/InputSystem';
import { HostPhysicsSystem }     from '../systems/HostPhysicsSystem';
import { CombatSystem }          from '../systems/CombatSystem';
import { EffectSystem }          from '../effects/EffectSystem';
import { SmokeSystem }           from '../effects/SmokeSystem';
import { FireSystem }            from '../effects/FireSystem';
import { StinkCloudSystem }      from '../effects/StinkCloudSystem';
import { AimSystem, UtilityChargeIndicator } from '../ui/AimSystem';
import { ArenaCountdownOverlay } from '../ui/ArenaCountdownOverlay';
import { LeftSidePanel }         from '../ui/LeftSidePanel';
import { RightSidePanel }        from '../ui/RightSidePanel';
import { LobbyOverlay }          from './LobbyOverlay';
import { RoomQualityMonitor }    from '../network/RoomQualityMonitor';
import {
  ARENA_COUNTDOWN_SEC, ARENA_DURATION_SEC,
  PLAYER_COLORS, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH, ARENA_HEIGHT, CELL_SIZE, COLORS, DEPTH,
  ROOM_QUALITY_AUTO_SEARCH_MAX_ATTEMPTS,
  getTopDownMuzzleOrigin,
  NET_SMOOTH_TIME_MS,
} from '../config';
import { DEFAULT_LOADOUT, WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../loadout/LoadoutConfig';
import type { PlaceableUtilityConfig } from '../loadout/LoadoutConfig';
import { dequantizeAngle }       from '../utils/angle';
import {
  beginAutomaticRoomSearch,
  clearAutomaticRoomSearchState,
  clearRoomQualityRetryCount,
  consumeAutomaticRoomSearchAttempt,
  copyCurrentRoomShareUrl,
  getAutomaticRoomSearchState,
  getRoomQualityRetryCount,
  markAutomaticRoomSearchExhausted,
  restartRoomForAutomaticRoomSearch,
  restartRoomForQualityRetry,
} from '../utils/roomQuality';
import type { GamePhase, LoadoutCommitSnapshot, PlayerProfile, RoomQualitySnapshot } from '../types';

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
  createRendererBundle,
  wireRenderersToProjManager,
  wireRenderersToEffectSystem,
} from './arena';

export class ArenaScene extends Phaser.Scene {
  // ── Phaser-scoped objects (must stay in scene) ────────────────────────────
  private arenaClipMaskShape: Phaser.GameObjects.Graphics | null = null;
  private arenaClipMask: Phaser.Display.Masks.GeometryMask | null = null;
  private gaussWarningGraphics: Phaser.GameObjects.Graphics | null = null;
  private utilityChargeIndicator: UtilityChargeIndicator | null = null;
  private ultimateChargeIndicator: UtilityChargeIndicator | null = null;

  // ── Coordinators ──────────────────────────────────────────────────────────
  private ctx!: ArenaContext;
  private renderers!: RendererBundle;
  private localPlayerState!: LocalPlayerState;
  private rockVisualHelper!: RockVisualHelper;
  private placementPreview!: PlacementPreviewRenderer;
  private hostUpdate!: HostUpdateCoordinator;
  private clientUpdate!: ClientUpdateCoordinator;
  private rpcCoordinator!: RpcCoordinator;
  private lifecycle!: ArenaLifecycleCoordinator;

  // ── Lobby / Room-quality (not round-scoped) ───────────────────────────────
  private lobbyOverlay!: LobbyOverlay;
  private roomQualityMonitor!: RoomQualityMonitor;
  private roomQualitySnapshot: RoomQualitySnapshot | null = null;

  constructor() {
    super({ key: 'ArenaScene' });
  }

  preload(): void {
    this.load.image('bg_grass',   './assets/sprites/32x32grass01.png');
    this.load.image('bg_tracks',  './assets/sprites/64x32tracks.png');
    this.load.spritesheet('rocks', './assets/sprites/rocks47blob.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('dirt',  './assets/sprites/dirt47blob.png',  { frameWidth: 32, frameHeight: 32 });
    this.load.image('bg_canopy',  './assets/sprites/192x192canopy01.png');
    this.load.image('lobby_logo', './assets/sprites/fragdachselogo.png');
    this.load.image('powerup_hp',  './assets/sprites/16x16HP.png');
    this.load.image('powerup_arm', './assets/sprites/16x16Armor.png');
    this.load.image('powerup_adr', './assets/sprites/16x16adrenalin.png');
    this.load.image('powerup_dam', './assets/sprites/16x16damageamp.png');
    this.load.image('powerup_hhg', './assets/sprites/16x16holy_grenade.png');
    this.load.image('powerup_nuk', './assets/sprites/16x16nuke.png');
    this.load.image('powerup_bfg', './assets/sprites/16x16bfg.png');
    this.load.image('badger',      './assets/sprites/32x32dachsweapon01.png');
    this.load.atlas('dachs_death', './assets/player/dachs_death_ani3.png', './assets/player/dachs_death_ani3.json');
  }

  create(): void {
    this.anims.create({
      key:       'player_death',
      frames:    this.anims.generateFrameNames('dachs_death', {
        prefix:  'Animation test (Dachs tot) (geist dunkler fade)-NEU ',
        suffix:  '.aseprite',
        start:   0,
        end:     38,
      }),
      frameRate: 60,
      repeat:    0,
    });

    bridge.clearPlayerCallbacks();
    this.input.mouse?.disableContextMenu();

    // ── Static arena (never destroyed) ────────────────────────────────────
    const builder = new ArenaBuilder(this);
    builder.buildStatic();
    this.ensureArenaClipMask();
    this.ensureTurretTexture();

    // ── Scene-lifetime systems ─────────────────────────────────────────────
    const playerManager    = new PlayerManager(this);
    const projectileManager = new ProjectileManager(this);
    const combatSystem     = new CombatSystem(playerManager, projectileManager, bridge);
    const effectSystem     = new EffectSystem(this, bridge);
    const smokeSystem      = new SmokeSystem(this);
    const fireSystem       = new FireSystem(this);
    const stinkCloudSystem = new StinkCloudSystem(this);
    const hostPhysics      = new HostPhysicsSystem(this, playerManager, bridge, combatSystem);
    const inputSystem      = new InputSystem(
      this, bridge, () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
    );

    // ── UI (scene-lifetime) ────────────────────────────────────────────────
    const leftPanel  = new LeftSidePanel(this, bridge);
    leftPanel.build();
    const rightPanel = new RightSidePanel(this);
    rightPanel.build();

    const aimSystem = new AimSystem(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
      (slot) => this.clientUpdate.getLocalWeaponConfig(slot),
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
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

    const arenaCountdown = new ArenaCountdownOverlay(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
    );

    // ── Assemble ArenaContext ──────────────────────────────────────────────
    this.ctx = {
      playerManager, projectileManager, combatSystem, effectSystem,
      smokeSystem, fireSystem, stinkCloudSystem, hostPhysics, inputSystem,
      leftPanel, rightPanel, aimSystem, arenaCountdown,
      // Round-scoped (start null)
      arenaResult: null, currentLayout: null, placementSystem: null, rockRegistry: null,
      resourceSystem: null, burrowSystem: null, loadoutManager: null,
      powerUpSystem: null, detonationSystem: null, armageddonSystem: null,
      teslaDomeSystem: null, turretSystem: null, translocatorSystem: null, trainManager: null,
    };

    // ── Renderers ─────────────────────────────────────────────────────────
    this.renderers = createRendererBundle(this);
    wireRenderersToProjManager(this.renderers, projectileManager, playerManager);
    wireRenderersToEffectSystem(this.renderers, effectSystem);

    // Homing providers (closed over ctx, read at call-time → safe after teardown)
    projectileManager.setHomingTargetProvider((_config, _ownerId) => {
      if (!bridge.isHost()) return [];
      const targets = [];
      for (const player of playerManager.getAllPlayers()) {
        if (!player.sprite.active) continue;
        if (!combatSystem.isAlive(player.id)) continue;
        if (this.ctx.burrowSystem?.isBurrowed(player.id)) continue;
        targets.push({ id: player.id, type: 'players' as const, x: player.sprite.x, y: player.sprite.y });
      }
      return targets;
    });
    projectileManager.setHomingLineOfSightChecker((sx, sy, ex, ey) => {
      return combatSystem.hasLineOfSight(sx, sy, ex, ey);
    });

    effectSystem.setup(() => { aimSystem.notifyConfirmedHit(); });

    // ── Shared state & helpers ─────────────────────────────────────────────
    this.gaussWarningGraphics = this.add.graphics().setDepth(DEPTH.OVERLAY - 2);
    this.localPlayerState = new LocalPlayerState();
    this.rockVisualHelper  = new RockVisualHelper(this, this.ctx, this.arenaClipMask);
    this.placementPreview  = new PlacementPreviewRenderer(this, this.ctx);

    // ── Coordinators ──────────────────────────────────────────────────────
    this.hostUpdate   = new HostUpdateCoordinator(this, this.ctx, this.renderers, this.localPlayerState, this.rockVisualHelper);
    this.clientUpdate = new ClientUpdateCoordinator(this, this.ctx, this.localPlayerState, this.rockVisualHelper);

    // ── Input setup ───────────────────────────────────────────────────────
    inputSystem.setup();
    inputSystem.setupUtilityConfigProvider(() => this.clientUpdate.getLocalUtilityConfig());
    inputSystem.setupUtilityCooldownProvider(() => bridge.getPlayerUtilityCooldownUntil(bridge.getLocalPlayerId()));
    inputSystem.setupUltimateConfigProvider(() => this.clientUpdate.getLocalUltimateConfig());
    inputSystem.setupLocalRageProvider(() => this.clientUpdate.getLocalRage());
    inputSystem.setupUtilityPlacementPreviewProvider(() => this.getLocalPlacementPreview());
    inputSystem.setupTranslocatorRecallCheck(() => {
      const cfg = this.clientUpdate.getLocalUtilityConfig();
      if (!cfg || cfg.type !== 'translocator') return false;
      return this.ctx.translocatorSystem?.getActivePuckId(bridge.getLocalPlayerId()) !== undefined;
    });
    inputSystem.setupLoadoutListener((slot, angle, targetX, targetY, params) => {
      if (!this.localPlayerState.alive || this.localPlayerState.burrowed) return;

      let shotId: number | undefined;
      if (slot === 'weapon1' || slot === 'weapon2') {
        const now = Date.now();
        const lastFired = this.clientUpdate.weaponLastFiredRecord()[slot];
        const wepConfig = this.clientUpdate.getLocalWeaponConfig(slot);
        if (lastFired > 0 && now - lastFired < wepConfig.cooldown) return;
        shotId = this.clientUpdate.notifyLoadoutFired(slot, angle, targetX, targetY);
      }
      if (slot === 'utility') {
        this.clientUpdate.notifyUtilityFired();
      }

      const localSprite = playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
      const awaitResult = slot === 'utility'
        && inputSystem.isUtilityPlacementActive()
        && this.clientUpdate.getLocalUtilityConfig().activation.type === 'placement_mode';
      const loadoutPromise = bridge.sendLoadoutUse(slot, angle, targetX, targetY, shotId, params, localSprite?.x, localSprite?.y, Date.now(), awaitResult);
      if (awaitResult) {
        void loadoutPromise.then((ok) => {
          if (!ok) this.placementPreview.showPlacementError('Bau fehlgeschlagen');
        }).catch(() => {
          this.placementPreview.showPlacementError('Bau fehlgeschlagen');
        });
      }
    });

    // ── Lobby overlay & room-quality ───────────────────────────────────────
    this.lobbyOverlay = new LobbyOverlay(
      this, bridge,
      () => this.onReadyToggled(),
      () => { void this.onCopyRoomLink(); },
      () => this.onRetryRoom(),
      () => this.onStartAutomaticRoomSearch(),
    );
    this.lobbyOverlay.build();
    this.lobbyOverlay.show();

    this.roomQualityMonitor = new RoomQualityMonitor({
      bridge,
      getRetryCount:    () => getRoomQualityRetryCount(),
      clearRetryCount:  () => clearRoomQualityRetryCount(),
      restartRoomForQualityRetry:       () => restartRoomForQualityRetry(),
      restartRoomForAutomaticRoomSearch: () => restartRoomForAutomaticRoomSearch(),
      getAutomaticRoomSearchState:      () => getAutomaticRoomSearchState(),
      consumeAutomaticRoomSearchAttempt: () => consumeAutomaticRoomSearchAttempt(),
      clearAutomaticRoomSearchState:    () => clearAutomaticRoomSearchState(),
      markAutomaticRoomSearchExhausted: () => markAutomaticRoomSearchExhausted(),
    });

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

    bridge.onPlayerJoin(profile => this.onPlayerJoined(profile));
    bridge.onPlayerQuit(id      => this.onPlayerLeft(id));

    if (bridge.isHost()) {
      bridge.initColorPool(PLAYER_COLORS);
    }

    this.lifecycle.initialize();
    bridge.setupPingMeasurement();
    this.time.addEvent({ delay: 2000, callback: () => bridge.sendPingToHost(), loop: true });
    this.initializeRoomQuality();
  }

  update(_time: number, delta: number): void {
    this.lifecycle.detectPhaseChange();

    const phase           = bridge.getGamePhase();
    const inGame          = phase === 'ARENA';
    const countdownActive = bridge.isArenaCountdownActive();
    const terminated      = this.lifecycle.isMatchTerminated();

    if (inGame) {
      this.ctx.inputSystem.setInputEnabled(!countdownActive);
      this.ctx.inputSystem.update();
    } else {
      this.ctx.inputSystem.setInputEnabled(false);
    }

    if (!terminated && phase === 'LOBBY') {
      if (!this.lobbyOverlay.isVisible()) this.lobbyOverlay.show();
      const players = bridge.getConnectedPlayers();
      this.updateRoomQuality(this.time.now, players);
      this.lobbyOverlay.setRoomQuality(this.roomQualitySnapshot, bridge.isHost());
      this.lobbyOverlay.refreshPlayerList(players);
      const localProfile = players.find(p => p.id === bridge.getLocalPlayerId());
      if (localProfile) this.ctx.leftPanel.updateLocalName(localProfile.name);
      this.ctx.leftPanel.refreshColorIndicator();
      this.ctx.leftPanel.refreshColorPickerIfOpen();
      this.ctx.leftPanel.updateLobby();
      if (bridge.isHost()) this.lifecycle.hostCheckReadyToStart();
    } else if (!terminated && this.lobbyOverlay.isVisible()) {
      this.lobbyOverlay.hide();
    }

    if (inGame && !terminated) {
      const secs = bridge.computeSecondsLeft();
      this.ctx.rightPanel.updateTimer(secs);

      // Train widget
      const trainEvent = bridge.getTrainEvent();
      if (trainEvent) {
        if (!this.lifecycle.isTrainDestroyedShown()) {
          const latestState = bridge.getLatestGameState();
          const trainState  = latestState?.train ?? null;
          if (trainState?.alive) {
            this.ctx.rightPanel.updateTrainHP(trainState.hp, trainState.maxHp);
          } else if (bridge.getSynchronizedNow() < trainEvent.spawnAt) {
            const arrivalTimerSecs = Math.max(0, Math.ceil((bridge.getRoundEndTime() - trainEvent.spawnAt) / 1000));
            this.ctx.rightPanel.setTrainArrival(arrivalTimerSecs);
          }
        }
      }

      if (bridge.isHost()) {
        this.lifecycle.spawnReadyPlayers();
        if (countdownActive) this.lifecycle.syncHostLoadoutsFromCommittedSelections();
        this.hostUpdate.runHostUpdate(delta);
        if (!countdownActive && secs <= 0) {
          this.lifecycle.hostSaveRoundResults();
          bridge.setGamePhase('LOBBY');
        }
      } else {
        this.clientUpdate.runClientUpdate(delta);

        // Sync renderers that HostUpdateCoordinator handles for host but client needs too
        const state = bridge.getLatestGameState();
        if (state) {
          this.renderers.teslaDome.syncVisuals(state.teslaDomes ?? []);
          this.renderers.train?.setTarget(state.train ?? null);
          this.renderers.powerUp.syncPedestals(state.pedestals ?? []);
          this.renderers.powerUp.sync(state.powerups ?? []);
          this.renderers.nuke.sync(state.nukes ?? []);
          this.renderers.meteor.sync(state.meteors ?? []);
        }
        this.renderers.powerUp.updatePedestals(bridge.getSynchronizedNow());
        this.renderers.train?.render(1 - Math.exp(-delta / NET_SMOOTH_TIME_MS));
      }

      this.ctx.rightPanel.updateLeaderboard(this.hostUpdate.getLeaderboardEntries());

      if (this.ctx.arenaResult) {
        const localSprite = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite ?? null;
        ArenaBuilder.updateCanopyTransparency(this.ctx.arenaResult.canopyObjects, localSprite);
      }
    }

    // ── Per-frame visuals (always) ─────────────────────────────────────────
    const inArena = inGame && !terminated;
    this.syncArenaFogOverlay(bridge.getSynchronizedNow(), inArena, countdownActive);
    this.renderers.teslaDome.update(delta);

    const utilityTargeting = this.ctx.inputSystem.getUtilityTargetingPreviewState();
    const utilityPlacement = this.getLocalPlacementPreview();
    const ultimatePreview  = this.ctx.inputSystem.getUltimateChargePreviewState();
    const showAim = inArena
      && this.localPlayerState.alive
      && !this.localPlayerState.burrowed
      && !this.ctx.inputSystem.isUtilityChargePreviewActive()
      && !this.ctx.inputSystem.isUtilityPlacementActive();
    this.ctx.aimSystem?.update(showAim || utilityTargeting !== undefined, inArena, delta, utilityTargeting, ultimatePreview);
    this.utilityChargeIndicator?.update(this.ctx.inputSystem.getUtilityChargePreviewState());
    this.ultimateChargeIndicator?.update(ultimatePreview);

    this.renderRemoteGaussWarnings(inArena);
    this.placementPreview.syncUtilityTargetingHint(inArena, utilityTargeting !== undefined, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.syncPlaceableUtilityHint(inArena, utilityPlacement !== undefined, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.renderPlacementPreview(inArena, utilityPlacement, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.renderRemotePlacementPreviews(inArena);
  }

  // ── Network events ────────────────────────────────────────────────────────

  private onPlayerJoined(profile: PlayerProfile): void {
    if (bridge.isHost()) bridge.hostAssignColor(profile.id);
  }

  private onPlayerLeft(id: string): void {
    if (bridge.isHost()) bridge.hostReclaimColor(id);
    if (this.ctx.playerManager.hasPlayer(id)) {
      if (bridge.isHost()) {
        this.ctx.combatSystem.removePlayer(id);
        this.ctx.resourceSystem?.removePlayer(id);
        this.ctx.burrowSystem?.removePlayer(id);
        this.ctx.loadoutManager?.removePlayer(id);
      }
      this.ctx.effectSystem.clearBurrowState(id);
      this.clientUpdate.removeBurrowPhase(id);
      this.ctx.hostPhysics.removePlayer(id);
      this.ctx.playerManager.removePlayer(id);
    }
    if (bridge.getGamePhase() === 'ARENA' && id === bridge.getMatchHostId()) {
      this.lifecycle.terminateMatch();
    }
  }

  // ── Lobby callbacks ───────────────────────────────────────────────────────

  private onReadyToggled(): void {
    const nowReady = !this.lifecycle.getIsLocalReady();
    if (nowReady) {
      bridge.setLocalReadyWithCommittedLoadout(this.buildLocalCommittedLoadoutSnapshot());
    } else {
      bridge.setLocalReady(false);
    }
    this.lifecycle.setIsLocalReady(nowReady);
  }

  private async onCopyRoomLink(): Promise<void> {
    const copied = await copyCurrentRoomShareUrl();
    if (copied) this.lobbyOverlay.showCopySuccess();
  }

  private onRetryRoom(): void {
    clearAutomaticRoomSearchState();
    restartRoomForQualityRetry();
  }

  private onStartAutomaticRoomSearch(): void {
    const autoSearchState = getAutomaticRoomSearchState();
    if (autoSearchState.active) {
      clearAutomaticRoomSearchState();
      clearRoomQualityRetryCount();
      return;
    }
    clearRoomQualityRetryCount();
    beginAutomaticRoomSearch(ROOM_QUALITY_AUTO_SEARCH_MAX_ATTEMPTS);
    restartRoomForAutomaticRoomSearch();
  }

  // ── Visual helpers ────────────────────────────────────────────────────────

  private syncArenaFogOverlay(now: number, inArena: boolean, countdownActive: boolean): void {
    if (!this.ctx.arenaCountdown) return;

    if (!inArena) {
      this.localPlayerState.overlayTrackedAlive = null;
      this.ctx.arenaCountdown.clear();
      return;
    }

    if (countdownActive) {
      this.localPlayerState.overlayTrackedAlive = this.localPlayerState.alive;
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

  private renderRemoteGaussWarnings(inArena: boolean): void {
    const graphics = this.gaussWarningGraphics;
    graphics?.clear();
    if (!graphics) return;

    const state = bridge.getLatestGameState();
    if (!state || !inArena) return;

    const localId = bridge.getLocalPlayerId();
    const time = this.time.now;
    for (const [playerId, playerState] of Object.entries(state.players)) {
      if (playerId === localId || !playerState.alive || !playerState.isChargingUltimate) continue;
      const range = Math.max(0, playerState.ultimateChargeRange ?? 0);
      const chargeFraction = Phaser.Math.Clamp(playerState.ultimateChargeFraction ?? 0, 0, 1);
      if (range <= 0 || chargeFraction <= 0) continue;

      const aimAngle = dequantizeAngle(playerState.rot);
      const dirX = Math.cos(aimAngle);
      const dirY = Math.sin(aimAngle);
      const pulse = 0.92 + 0.08 * Math.sin(time * 0.018);
      const beamLength = Math.max(10, range * chargeFraction);
      const muzzle = getTopDownMuzzleOrigin(playerState.x, playerState.y, aimAngle);
      const clipped = this.clipBeamToArena(muzzle.x, muzzle.y, muzzle.x + dirX * beamLength, muzzle.y + dirY * beamLength);
      const startX = Math.round(muzzle.x);
      const startY = Math.round(muzzle.y);
      const endX   = Math.round(clipped.x);
      const endY   = Math.round(clipped.y);
      const alpha  = Math.max(0.04, chargeFraction * chargeFraction);

      graphics.lineStyle(18, 0x0a1118, 0.05 * alpha);
      graphics.beginPath(); graphics.moveTo(startX, startY); graphics.lineTo(endX, endY); graphics.strokePath();
      graphics.lineStyle(14, 0xbcefff, 0.14 * alpha * pulse);
      graphics.beginPath(); graphics.moveTo(startX, startY); graphics.lineTo(endX, endY); graphics.strokePath();
      graphics.lineStyle(9, 0x78d6ff, 0.3 * alpha * pulse);
      graphics.beginPath(); graphics.moveTo(startX, startY); graphics.lineTo(endX, endY); graphics.strokePath();
      graphics.lineStyle(4, 0xe1fbff, 0.55 * alpha);
      graphics.beginPath(); graphics.moveTo(startX, startY); graphics.lineTo(endX, endY); graphics.strokePath();
      graphics.lineStyle(2, 0xffffff, 0.9 * alpha);
      graphics.beginPath(); graphics.moveTo(startX, startY); graphics.lineTo(endX, endY); graphics.strokePath();

      const emitterRadius = 6 + chargeFraction * 6;
      graphics.fillStyle(0xbcefff, 0.12 * alpha * pulse);
      graphics.fillCircle(startX, startY, emitterRadius * 2.1);
      graphics.fillStyle(0x78d6ff, 0.25 * alpha);
      graphics.fillCircle(startX, startY, emitterRadius * 1.3);
      graphics.fillStyle(0xffffff, 0.5 * alpha);
      graphics.fillCircle(startX, startY, Math.max(2, emitterRadius * 0.55));
    }
  }

  private clipBeamToArena(sx: number, sy: number, ex: number, ey: number): { x: number; y: number } {
    const inside = ex >= ARENA_OFFSET_X && ex <= ARENA_OFFSET_X + ARENA_WIDTH
      && ey >= ARENA_OFFSET_Y && ey <= ARENA_OFFSET_Y + ARENA_HEIGHT;
    if (inside) return { x: ex, y: ey };

    const dx = ex - sx;
    const dy = ey - sy;
    let t = 1;
    const maxX = ARENA_OFFSET_X + ARENA_WIDTH;
    const maxY = ARENA_OFFSET_Y + ARENA_HEIGHT;
    if (dx > 0) t = Math.min(t, (maxX - sx) / dx);
    else if (dx < 0) t = Math.min(t, (ARENA_OFFSET_X - sx) / dx);
    if (dy > 0) t = Math.min(t, (maxY - sy) / dy);
    else if (dy < 0) t = Math.min(t, (ARENA_OFFSET_Y - sy) / dy);
    return { x: sx + t * dx, y: sy + t * dy };
  }

  private getLocalPlacementPreview() {
    const sprite = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
    const cfg = this.clientUpdate.getLocalUtilityConfig();
    if (!sprite || !this.ctx.placementSystem || !this.ctx.inputSystem.isUtilityPlacementActive()) return undefined;
    if (cfg.activation.type !== 'placement_mode') return undefined;
    const pointer = this.input.activePointer;
    return this.ctx.placementSystem.getPlacementPreview(cfg as PlaceableUtilityConfig, sprite.x, sprite.y, pointer.x, pointer.y);
  }

  private buildLocalCommittedLoadoutSnapshot(): LoadoutCommitSnapshot {
    const localId = bridge.getLocalPlayerId();
    return {
      weapon1:  bridge.getPlayerLoadoutSlot(localId, 'weapon1')  ?? DEFAULT_LOADOUT.weapon1.id,
      weapon2:  bridge.getPlayerLoadoutSlot(localId, 'weapon2')  ?? DEFAULT_LOADOUT.weapon2.id,
      utility:  bridge.getPlayerLoadoutSlot(localId, 'utility')  ?? DEFAULT_LOADOUT.utility.id,
      ultimate: bridge.getPlayerLoadoutSlot(localId, 'ultimate') ?? DEFAULT_LOADOUT.ultimate.id,
    };
  }

  private ensureTurretTexture(): void {
    if (!this.textures.exists('placeable_turret')) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.clear();
      g.fillStyle(0x000000, 0.18); g.fillEllipse(16, 18, 20, 12);
      g.fillStyle(0x78161e, 1);    g.fillCircle(16, 14, 10.5);
      g.fillStyle(0xa91e24, 1);    g.fillCircle(16, 13, 9.5);
      g.fillStyle(0xcf3135, 1);    g.fillCircle(16, 12, 8.4);
      g.fillStyle(0xf4f0e6, 1);
      g.fillCircle(11.5, 9.8, 1.9); g.fillCircle(16.2, 8.4, 1.5);
      g.fillCircle(20.3, 10.8, 1.8); g.fillCircle(12.8, 14.2, 1.6);
      g.fillCircle(19.4, 15.2, 1.3);
      g.fillStyle(0xe6dcc1, 1);    g.fillEllipse(16, 18.6, 7.5, 5.5);
      g.lineStyle(1.2, 0x4a1014, 0.7); g.strokeCircle(16, 13.4, 9.8);
      g.generateTexture('placeable_turret', 32, 32);
      g.destroy();
    }
    if (!this.textures.exists('placeable_turret_proxy')) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.clear(); g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 32, 32);
      g.generateTexture('placeable_turret_proxy', 32, 32);
      g.destroy();
    }
  }

  private ensureArenaClipMask(): void {
    if (this.arenaClipMaskShape && this.arenaClipMask) return;
    const maskShape = this.add.graphics();
    maskShape.fillStyle(0xffffff, 1);
    maskShape.fillRect(ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT);
    maskShape.setVisible(false);
    this.arenaClipMaskShape = maskShape;
    this.arenaClipMask = maskShape.createGeometryMask();
  }

  private initializeRoomQuality(): void {
    this.roomQualityMonitor.initialize(this.time.now);
    this.roomQualitySnapshot = this.roomQualityMonitor.getSnapshot();
  }

  private updateRoomQuality(now: number, players: PlayerProfile[]): void {
    this.roomQualitySnapshot = this.roomQualityMonitor.update(now, players);
  }
}
