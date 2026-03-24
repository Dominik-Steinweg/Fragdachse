import Phaser from 'phaser';
import { bridge }              from '../network/bridge';
import { ArenaBuilder }        from '../arena/ArenaBuilder';
import type { ArenaBuilderResult } from '../arena/ArenaBuilder';
import { ArenaGenerator }      from '../arena/ArenaGenerator';
import { RockRegistry }        from '../arena/RockRegistry';
import { PlayerManager }       from '../entities/PlayerManager';
import type { PlayerEntity }   from '../entities/PlayerEntity';
import { ProjectileManager }   from '../entities/ProjectileManager';
import { InputSystem }         from '../systems/InputSystem';
import { HostPhysicsSystem }   from '../systems/HostPhysicsSystem';
import { CombatSystem }        from '../systems/CombatSystem';
import { ResourceSystem }      from '../systems/ResourceSystem';
import { BurrowSystem }        from '../systems/BurrowSystem';
import { LoadoutManager }      from '../loadout/LoadoutManager';
import type { LoadoutSelection } from '../loadout/LoadoutManager';
import { DEFAULT_LOADOUT, WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../loadout/LoadoutConfig';
import type { UtilityConfig, WeaponConfig }   from '../loadout/LoadoutConfig';
import { EffectSystem }        from '../effects/EffectSystem';
import { SmokeSystem }         from '../effects/SmokeSystem';
import { FireSystem }          from '../effects/FireSystem';
import { StinkCloudSystem }    from '../effects/StinkCloudSystem';
import { BulletRenderer }      from '../effects/BulletRenderer';
import { FlameRenderer }       from '../effects/FlameRenderer';
import { BfgRenderer }         from '../effects/BfgRenderer';
import { EnergyBallRenderer }  from '../effects/EnergyBallRenderer';
import { HolyGrenadeRenderer } from '../effects/HolyGrenadeRenderer';
import { RocketRenderer }      from '../effects/RocketRenderer';
import { TracerRenderer }      from '../effects/TracerRenderer';
import { PowerUpSystem }        from '../powerups/PowerUpSystem';
import { PICKUP_RADIUS, TRAIN_DROP_COUNT, NUKE_CONFIG } from '../powerups/PowerUpConfig';
import { NukeRenderer }        from '../powerups/NukeRenderer';
import { PowerUpRenderer }     from '../powerups/PowerUpRenderer';
import { MeteorRenderer }      from '../effects/MeteorRenderer';
import { DetonationSystem }    from '../systems/DetonationSystem';
import { ArmageddonSystem }    from '../systems/ArmageddonSystem';
import type { MeteorImpactEvent } from '../systems/ArmageddonSystem';
import { TrainManager }        from '../train/TrainManager';
import { TrainRenderer }       from '../train/TrainRenderer';
import { TRAIN }               from '../train/TrainConfig';
import { LeftSidePanel }       from '../ui/LeftSidePanel';
import { RightSidePanel }      from '../ui/RightSidePanel';
import { AimSystem, UtilityChargeIndicator } from '../ui/AimSystem';
import { ArenaCountdownOverlay } from '../ui/ArenaCountdownOverlay';
import { LobbyOverlay }        from './LobbyOverlay';
import type { BurrowPhase, PlayerAimNetState, PlayerNetState, GamePhase, PlayerProfile, WeaponSlot, RoomQualitySnapshot } from '../types';
import type { RoundResult } from '../network/NetworkBridge';
import {
  ARENA_HEIGHT,
  ARENA_COUNTDOWN_SEC, ARENA_DURATION_SEC, PLAYER_COLORS,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_WIDTH,
  CELL_SIZE, COLORS, DEPTH,
  DASH_T2_S,
  NET_TICK_INTERVAL_MS, NET_SMOOTH_TIME_MS,
  ROOM_QUALITY_AUTO_SEARCH_MAX_ATTEMPTS,
} from '../config';
import { isVelocityMoving } from '../loadout/SpreadMath';
import type { LoadoutCommitSnapshot } from '../types';
import { dequantizeAngle } from '../utils/angle';
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
import { RoomQualityMonitor } from '../network/RoomQualityMonitor';


export class ArenaScene extends Phaser.Scene {
  private playerManager!:     PlayerManager;
  private projectileManager!: ProjectileManager;
  private combatSystem!:      CombatSystem;
  private effectSystem!:      EffectSystem;
  private smokeSystem!:       SmokeSystem;
  private fireSystem!:        FireSystem;
  private stinkCloudSystem!:  StinkCloudSystem;
  private bulletRenderer!:    BulletRenderer;
  private flameRenderer!:     FlameRenderer;
  private bfgRenderer!:       BfgRenderer;
  private energyBallRenderer!: EnergyBallRenderer;
  private holyGrenadeRenderer!: HolyGrenadeRenderer;
  private rocketRenderer!:    RocketRenderer;
  private tracerRenderer!:    TracerRenderer;
  private inputSystem!:       InputSystem;
  private hostPhysics!:       HostPhysicsSystem;
  private lobbyOverlay!:      LobbyOverlay;

  // ── HUD / Aim ─────────────────────────────────────────────────────────────
  private leftPanel!:  LeftSidePanel;
  private rightPanel!: RightSidePanel;
  private aimSystem:   AimSystem | null = null;
  private utilityChargeIndicator: UtilityChargeIndicator | null = null;
  private arenaCountdown: ArenaCountdownOverlay | null = null;
  private utilityTargetingHint: Phaser.GameObjects.Container | null = null;

  // Alive/Burrowed-Flags des lokalen Spielers (gesetzt in runHostUpdate/runClientUpdate)
  private localPlayerAlive    = false;
  private localPlayerBurrowed = false;

  // ── Dynamische Arena ──────────────────────────────────────────────────────
  private arenaResult:   ArenaBuilderResult | null = null;
  private rockRegistry:  RockRegistry | null       = null;
  private currentLayout: import('../types').ArenaLayout | null = null;

  // ── Host-only Systeme ─────────────────────────────────────────────────────
  private resourceSystem:    ResourceSystem    | null = null;
  private burrowSystem:      BurrowSystem      | null = null;
  private loadoutManager:    LoadoutManager    | null = null;
  private powerUpSystem:     PowerUpSystem     | null = null;
  private detonationSystem:  DetonationSystem  | null = null;
  private armageddonSystem:  ArmageddonSystem  | null = null;

  // ── Zug-Event ─────────────────────────────────────────────────────────────
  private trainManager:       TrainManager  | null = null;
  private trainRenderer:      TrainRenderer | null = null;
  private nukeRenderer:       NukeRenderer  | null = null;
  private meteorRenderer:     MeteorRenderer | null = null;
  private powerUpRenderer:     PowerUpRenderer | null = null;
  private trainSpawned          = false;
  private trainDestroyedShown   = false;

  private pickupCooldownUntil = 0; // Spam-Schutz für Pickup-RPC
  private clientUtilityOverride: UtilityConfig | null = null; // Client-seitige Vorhersage für Utility-Override (BFG/HHG)

  // ── Client-seitige Waffen-Cooldown-Tracker (für HUD) ───────────────────────
  private weaponLastFired: Record<'weapon1' | 'weapon2', number> = { weapon1: 0, weapon2: 0 };

  // ── Dash-Visual-Tracking (client-seitig) ──────────────────────────────────
  private dashPhase2StartTimes = new Map<string, number>(); // playerId → lokaler Zeitstempel
  private prevDashPhases       = new Map<string, number>(); // playerId → vorherige Phase
  private prevBurrowPhases     = new Map<string, BurrowPhase>(); // playerId → vorherige Burrow-Phase
  private prevAliveStates      = new Map<string, boolean>(); // playerId → vorheriger alive-Status
  private dashTrailTimers      = new Map<string, number>(); // playerId → nächster Ghost ms
  private overlayTrackedLocalAlive: boolean | null = null;
  // ── State Machine ─────────────────────────────────────────────────────────
  private isLocalReady      = false;
  private lastPhase: GamePhase = 'LOBBY';
  private roundStartPending = false;
  private roomQualityMonitor!: RoomQualityMonitor;
  private roomQualitySnapshot: RoomQualitySnapshot | null = null;
  /**
   * Wird true wenn der Host während eines laufenden Matches disconnectet.
   * Sperrt die Arena-Simulation bis die Netzwerkphase auf 'LOBBY' wechselt.
   */
  private matchTerminated   = false;

  // ── Netzwerk-Tick-Rate-Drosselung (Host) ─────────────────────────────────
  private netTickAccumulator = 0;
  // ── Client: letzte verarbeitete GameState-Version ────────────────────────
  private lastGameStateVersion = -1;
  private leaderboardSignature = '';
  private cachedLeaderboardEntries: { name: string; colorHex: number; frags: number; ping: number }[] = [];

  private predictedHitscanCooldownUntil: Record<WeaponSlot, number> = {
    weapon1: 0,
    weapon2: 0,
  };
  private nextPredictedHitscanShotId = 1;

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
    this.load.image('powerup_hp', './assets/sprites/16x16HP.png');
    this.load.image('powerup_arm', './assets/sprites/16x16Armor.png');
    this.load.image('powerup_adr', './assets/sprites/16x16adrenalin.png');
    this.load.image('powerup_dam', './assets/sprites/16x16damageamp.png');
    this.load.image('powerup_hhg', './assets/sprites/16x16holy_grenade.png');
    this.load.image('powerup_nuk', './assets/sprites/16x16nuke.png');
    this.load.image('powerup_bfg', './assets/sprites/16x16bfg.png');
    this.load.image('badger', './assets/sprites/32x32dachsweapon01.png');
    this.load.atlas('dachs_death', './assets/player/dachs_death_ani3.png', './assets/player/dachs_death_ani3.json');
  }

  create(): void {
    // Sterbeanimation registrieren (39 Frames, 60 fps → 16.67 ms/Frame)
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

    // Alte Szenen-Callbacks löschen, neue registrieren
    bridge.clearPlayerCallbacks();

    // Kontextmenü deaktivieren (Rechtsklick soll weapon2 auslösen, nicht Browser-Menü)
    this.input.mouse?.disableContextMenu();

    // ── 1. Statische Arena (einmalig, nie zerstört) ────────────────────────
    const builder = new ArenaBuilder(this);
    builder.buildStatic();

    // ── 2. Spieler-System ─────────────────────────────────────────────────
    this.playerManager = new PlayerManager(this);

    // ── 3. Projektile (ohne rockGroup – wird nach Arena-Aufbau injiziert) ─
    this.projectileManager = new ProjectileManager(this);

    // ── 3b. Bullet-Renderer (verbesserte Projektilgrafik) ─────────────────
    this.bulletRenderer = new BulletRenderer(this);
    this.bulletRenderer.generateTextures();
    this.projectileManager.setBulletRenderer(this.bulletRenderer);
    this.flameRenderer = new FlameRenderer(this);
    this.flameRenderer.generateTextures();
    this.projectileManager.setFlameRenderer(this.flameRenderer);
    this.bfgRenderer = new BfgRenderer(this);
    this.bfgRenderer.generateTextures();
    this.projectileManager.setBfgRenderer(this.bfgRenderer);
    this.energyBallRenderer = new EnergyBallRenderer(this);
    this.energyBallRenderer.generateTextures();
    this.projectileManager.setEnergyBallRenderer(this.energyBallRenderer);
    this.holyGrenadeRenderer = new HolyGrenadeRenderer(this);
    this.holyGrenadeRenderer.generateTextures();
    this.projectileManager.setHolyGrenadeRenderer(this.holyGrenadeRenderer);
    this.rocketRenderer = new RocketRenderer(this);
    this.rocketRenderer.generateTextures();
    this.projectileManager.setRocketRenderer(this.rocketRenderer);
    this.tracerRenderer = new TracerRenderer(this);
    this.projectileManager.setTracerRenderer(this.tracerRenderer);
    this.nukeRenderer = new NukeRenderer(this);
    this.nukeRenderer.generateTextures();
    this.meteorRenderer = new MeteorRenderer(this);
    this.meteorRenderer.generateTextures();
    this.powerUpRenderer = new PowerUpRenderer(this);

    // ── 4. Combat-System ──────────────────────────────────────────────────
    this.combatSystem = new CombatSystem(this.playerManager, this.projectileManager, bridge);
    this.projectileManager.setHomingTargetProvider((_config, _ownerId) => {
      if (!bridge.isHost()) return [];

      const targets = [];
      for (const player of this.playerManager.getAllPlayers()) {
        if (!player.sprite.active) continue;
        if (!this.combatSystem.isAlive(player.id)) continue;
        if (this.burrowSystem?.isBurrowed(player.id)) continue;
        targets.push({
          id: player.id,
          type: 'players' as const,
          x: player.sprite.x,
          y: player.sprite.y,
        });
      }
      return targets;
    });
    this.projectileManager.setHomingLineOfSightChecker((sx, sy, ex, ey) => {
      return this.combatSystem.hasLineOfSight(sx, sy, ex, ey);
    });

    // ── 5. Effekt-System ──────────────────────────────────────────────────
    this.effectSystem = new EffectSystem(this, bridge);
    this.effectSystem.setup(() => {
      this.aimSystem?.notifyConfirmedHit();
    });
    this.nukeRenderer?.setEffectSystem(this.effectSystem);
    this.smokeSystem = new SmokeSystem(this);
    this.fireSystem  = new FireSystem(this);
    this.stinkCloudSystem = new StinkCloudSystem(this);

    // ── 6. Host-Physik (ohne rockGroup – wird nach Arena-Aufbau injiziert) ─
    this.hostPhysics = new HostPhysicsSystem(
      this, this.playerManager, bridge, this.combatSystem,
    );

    // ── 7. Input ──────────────────────────────────────────────────────────
    this.inputSystem = new InputSystem(
      this,
      bridge,
      () => this.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
    );
    this.inputSystem.setup();
    this.inputSystem.setupUtilityConfigProvider(() => this.getLocalUtilityConfig());
    this.inputSystem.setupUtilityCooldownProvider(() => bridge.getPlayerUtilityCooldownUntil(bridge.getLocalPlayerId()));
    this.inputSystem.setupLoadoutListener((slot, angle, targetX, targetY, params) => {
      if (!this.localPlayerAlive || this.localPlayerBurrowed) return;

      let shotId: number | undefined;
      if (slot === 'weapon1' || slot === 'weapon2') {
        // Client-seitige Cooldown-Prüfung: nur feuern wenn bereit
        const now = Date.now();
        const lastFired = this.weaponLastFired[slot];
        const wepConfig = this.getLocalWeaponConfig(slot);
        if (lastFired > 0 && now - lastFired < wepConfig.cooldown) {
          return; // noch auf Cooldown → kein RPC, kein visuelles Feedback
        }
        this.aimSystem?.notifyShot(slot);
        shotId = this.playPredictedLocalHitscanTracer(slot, angle, targetX, targetY);
        this.weaponLastFired[slot] = now;
        this.leftPanel.flashSlot(slot);
      }
      // Client-seitigen Utility-Override nach Benutzung zurücksetzen
      if (slot === 'utility') {
        if (this.clientUtilityOverride) this.clientUtilityOverride = null;
        this.leftPanel.flashSlot('utility');
      }
      // Lokale Sprite-Position mitsenden für Hitscan-Kompensation bei 20Hz Tick-Rate
      const localSprite = this.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
      bridge.sendLoadoutUse(slot, angle, targetX, targetY, shotId, params, localSprite?.x, localSprite?.y);
    });

    bridge.registerDashHandler((playerId, dx, dy) => {
      if (!bridge.isHost()) return;
      if (bridge.getGamePhase() !== 'ARENA') return;
      if (bridge.isArenaCountdownActive()) return;
      this.hostPhysics.handleDashRPC(playerId, dx, dy);
    });

    bridge.registerBurrowHandler((playerId, wantsBurrowed) => {
      if (!bridge.isHost()) return;
      if (bridge.getGamePhase() !== 'ARENA') return;
      if (bridge.isArenaCountdownActive()) return;
      this.burrowSystem?.handleBurrowRequest(playerId, wantsBurrowed);
    });

    // ── 8. Left Side Panel (Namensanzeige + ArenaHUD) ─────────────────────
    this.leftPanel = new LeftSidePanel(this, bridge);
    this.leftPanel.build();

    // ── 8b. Aim-System (Prediction + Host-Reconciliation) ──────────────────
    this.aimSystem = new AimSystem(
      this,
      () => this.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
      (slot) => this.getLocalWeaponConfig(slot),
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    this.utilityChargeIndicator = new UtilityChargeIndicator(
      this,
      () => this.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    this.utilityTargetingHint = this.createUtilityTargetingHint();

    // ── 9. Loadout-RPC-Handler (Dispatch an LoadoutManager auf Host) ──────
    bridge.registerLoadoutUseHandler((slot, angle, targetX, targetY, senderId, shotId, params, clientX, clientY) => {
      if (!bridge.isHost()) return;
      if (bridge.isArenaCountdownActive()) return;
      this.loadoutManager?.use(slot, senderId, angle, targetX, targetY, Date.now(), shotId, params, clientX, clientY);
    });

    // ── 10. Explosions-Effekt-RPC (alle Clients inkl. Host) ───────────────
    bridge.registerExplosionEffectHandler((x, y, radius, color, visualStyle) => {
      this.effectSystem.playExplosionEffect(x, y, radius, color, visualStyle);
    });

    // ── 10b. Granaten-Countdown-RPC (alle Clients inkl. Host) ─────────────
    bridge.registerGrenadeCountdownHandler((x, y, value) => {
      this.effectSystem.playCountdownText(x, y, value);
    });

    // ── 10c. BFG-Laser-Effekt-RPC (alle Clients inkl. Host) ───────────────
    bridge.registerBfgLaserBatchHandler((lines, color) => {
      for (const line of lines) {
        this.effectSystem.playHitscanTracer(line.sx, line.sy, line.ex, line.ey, color, 2);
      }
    });

    // ── 11. RPC-Handler für Burrow-Visualisierung ─────────────────────────
    bridge.registerBurrowVisualHandler((playerId, phase) => {
      const entity = this.playerManager.getPlayer(playerId);
      if (!entity) return;
      if (phase === 'windup' || phase === 'recovery') {
        this.effectSystem.playBurrowPhaseEffect(entity.sprite.x, entity.sprite.y, phase);
      }
      entity.setBurrowPhase(phase, true);
      this.effectSystem.syncBurrowState(playerId, phase, entity.sprite);
      this.prevBurrowPhases.set(playerId, phase);
    });

    // ── 12. Schockwellen-Visualisierung ───────────────────────────────────
    bridge.registerShockwaveEffectHandler((x, y) => {
      this.effectSystem.playShockwaveEffect(x, y);
    });

    // ── 12b. Shot-Feedback (Screenshake beim Schützen bei AWP-Schuss) ──────
    bridge.registerShotFxHandler((shooterId, duration, intensity) => {
      if (shooterId === bridge.getLocalPlayerId()) {
        this.cameras.main.shake(duration, intensity);
      }
    });

    // ── 13. Farb-System ───────────────────────────────────────────────────
    if (bridge.isHost()) {
      bridge.initColorPool(PLAYER_COLORS);
    }
    bridge.registerColorRequestHandler((color, id) => {
      bridge.hostHandleColorRequest(color, id);
    });
    bridge.registerColorAcceptedHandler((id, _color) => {
      if (id === bridge.getLocalPlayerId()) {
        this.leftPanel.onColorAccepted();
      }
      this.leftPanel.refreshColorPickerIfOpen();
    });
    bridge.registerColorDeniedHandler((id) => {
      if (id === bridge.getLocalPlayerId()) {
        this.leftPanel.onColorDenied();
      }
    });
    bridge.registerColorChangeHandler((_id, _color) => {
      // Player-State-Sync via Playroom; Indikator wird im Lobby-Update-Loop aktualisiert.
      this.leftPanel.refreshColorPickerIfOpen();
    });

    // ── 14. Netzwerk-Callbacks (Join/Quit) ────────────────────────────────
    bridge.onPlayerJoin(profile => this.onPlayerJoined(profile));
    bridge.onPlayerQuit(id      => this.onPlayerLeft(id));

    // ── 14. Right Side Panel (Timer, Killfeed, Leaderboard) ───────────────
    this.rightPanel = new RightSidePanel(this);
    this.rightPanel.build();
    this.arenaCountdown = new ArenaCountdownOverlay(
      this,
      () => this.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
    );

    // Kill-Ereignis-Handler: alle Clients (inkl. Host) aktualisieren den Killfeed
    bridge.registerKillEventHandler(event => {
      this.rightPanel.addKillFeedEntry(
        event.killerName, event.killerColor,
        event.weapon,
        event.victimName, event.victimColor,
      );
    });

    // Zug-Zerstörungs-Handler: alle Clients zeigen "fällt leider aus"-Meldung
    bridge.registerTrainDestroyedHandler(() => {
      this.trainDestroyedShown = true;
      this.rightPanel.showTrainDestroyed();
    });

    // ── 15. Lobby-Overlay erstellen und anzeigen ──────────────────────────
    this.lobbyOverlay = new LobbyOverlay(
      this,
      bridge,
      () => this.onReadyToggled(),
      () => { void this.onCopyRoomLink(); },
      () => this.onRetryRoom(),
      () => this.onStartAutomaticRoomSearch(),
    );
    this.lobbyOverlay.build();
    this.lobbyOverlay.show();
    this.roomQualityMonitor = new RoomQualityMonitor({
      bridge,
      getRetryCount: () => getRoomQualityRetryCount(),
      clearRetryCount: () => clearRoomQualityRetryCount(),
      restartRoomForQualityRetry: () => restartRoomForQualityRetry(),
      restartRoomForAutomaticRoomSearch: () => restartRoomForAutomaticRoomSearch(),
      getAutomaticRoomSearchState: () => getAutomaticRoomSearchState(),
      consumeAutomaticRoomSearchAttempt: () => consumeAutomaticRoomSearchAttempt(),
      clearAutomaticRoomSearchState: () => clearAutomaticRoomSearchState(),
      markAutomaticRoomSearchExhausted: () => markAutomaticRoomSearchExhausted(),
    });

    // ── 16. Eigenen Ready-Status hart zurücksetzen ────────────────────────
    this.isLocalReady = false;
    bridge.setLocalReady(false);

    // ── 17. Initiale Phase lesen (Spät-Joiner-Support) ────────────────────
    this.lastPhase = bridge.getGamePhase();
    this.initializeRoomQuality();

    // ── 18. Ping-Messung (läuft dauerhaft, auch in LOBBY) ─────────────────
    bridge.setupPingMeasurement();
    this.time.addEvent({ delay: 2000, callback: () => bridge.sendPingToHost(), loop: true });
  }

  // ── Netzwerk-Events ───────────────────────────────────────────────────────

  private onPlayerJoined(profile: PlayerProfile): void {
    if (bridge.isHost()) bridge.hostAssignColor(profile.id);
  }

  private onPlayerLeft(id: string): void {
    if (bridge.isHost()) bridge.hostReclaimColor(id);
    if (this.playerManager.hasPlayer(id)) {
      if (bridge.isHost()) {
        this.combatSystem.removePlayer(id);
        this.resourceSystem?.removePlayer(id);
        this.burrowSystem?.removePlayer(id);
        this.loadoutManager?.removePlayer(id);
      }
      this.effectSystem.clearBurrowState(id);
      this.prevBurrowPhases.delete(id);
      this.hostPhysics.removePlayer(id);
      this.playerManager.removePlayer(id);
    }
    if (bridge.getGamePhase() === 'ARENA' && id === bridge.getMatchHostId()) {
      this.terminateMatch();
    }
  }

  private terminateMatch(): void {
    if (this.matchTerminated) return;
    this.matchTerminated = true;

    this.isLocalReady    = false;
    bridge.setLocalReady(false);
    this.roundStartPending = false;
    this.arenaCountdown?.clear();

    for (const p of [...this.playerManager.getAllPlayers()]) {
      if (bridge.isHost()) {
        this.combatSystem.removePlayer(p.id);
        this.resourceSystem?.removePlayer(p.id);
        this.burrowSystem?.removePlayer(p.id);
        this.loadoutManager?.removePlayer(p.id);
      }
      this.playerManager.removePlayer(p.id);
    }

    this.tearDownArena();
    this.leftPanel.transitionToLobby();
  this.leftPanel.setLobbyFieldsLocked(false);
    this.rightPanel.transitionToLobby();

    if (bridge.isHost()) {
      bridge.setGamePhase('LOBBY');
    }

    this.lobbyOverlay.setReadyButtonState(false);
    this.lobbyOverlay.show();
    this.lobbyOverlay.showHostDisconnectedMessage();
  }

  private onReadyToggled(): void {
    this.isLocalReady = !this.isLocalReady;
    if (this.isLocalReady) {
      bridge.setLocalReadyWithCommittedLoadout(this.buildLocalCommittedLoadoutSnapshot());
    } else {
      bridge.setLocalReady(false);
    }
    this.lobbyOverlay.setReadyButtonState(this.isLocalReady);
    this.leftPanel.setLobbyFieldsLocked(this.isLocalReady);
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

  // ── State Machine ─────────────────────────────────────────────────────────

  private detectPhaseChange(): void {
    const current = bridge.getGamePhase();

    if (this.matchTerminated) {
      if (current !== this.lastPhase) this.lastPhase = current;
      if (current === 'LOBBY') this.matchTerminated = false;
      return;
    }

    if (current === this.lastPhase) return;
    const prev   = this.lastPhase;
    this.lastPhase = current;
    if (prev === 'LOBBY' && current === 'ARENA') this.onTransitionToArena();
    if (prev === 'ARENA' && current === 'LOBBY') this.onTransitionToLobby();
  }

  private onTransitionToArena(): void {
    const layout = bridge.getArenaLayout();
    if (!layout) {
      this.time.delayedCall(16, () => this.onTransitionToArena());
      return;
    }

    this.buildArena(layout);

    for (const profile of bridge.getConnectedPlayers()) {
      if (bridge.getPlayerReady(profile.id) && !this.playerManager.hasPlayer(profile.id)) {
        this.playerManager.addPlayer(profile);
        if (bridge.isHost()) {
          this.combatSystem.initPlayer(profile.id);
          this.resourceSystem?.initPlayer(profile.id);
          this.burrowSystem?.initPlayer(profile.id);
          this.loadoutManager?.assignDefaultLoadout(profile.id, this.resolveCommittedLoadoutSelection(profile.id));
        }
      }
    }

    this.leftPanel.transitionToGame();
    this.rightPanel.transitionToGame();
    this.syncHostLoadoutsFromCommittedSelections();
    this.overlayTrackedLocalAlive = null;
    this.arenaCountdown?.syncTo(bridge.getArenaStartTime());
    this.lobbyOverlay.lockButton();
    this.lobbyOverlay.hide();
  }

  private onTransitionToLobby(): void {
    this.isLocalReady = false;
    bridge.setLocalReady(false);
    this.roundStartPending = false;
    this.overlayTrackedLocalAlive = null;
    this.clientUtilityOverride = null;
    this.arenaCountdown?.clear();

    for (const p of [...this.playerManager.getAllPlayers()]) {
      if (bridge.isHost()) {
        this.combatSystem.removePlayer(p.id);
        this.resourceSystem?.removePlayer(p.id);
        this.burrowSystem?.removePlayer(p.id);
        this.loadoutManager?.removePlayer(p.id);
      }
      this.playerManager.removePlayer(p.id);
    }

    this.tearDownArena();

    this.leftPanel.transitionToLobby();
    this.leftPanel.setLobbyFieldsLocked(false);
    this.rightPanel.transitionToLobby();
    this.rightPanel.showRoundResults(bridge.getRoundResults());
    this.lobbyOverlay.setReadyButtonState(false);
    this.lobbyOverlay.show();
    this.initializeRoomQuality();
  }

  private hostSaveRoundResults(): void {
    if (!bridge.isHost()) return;
    const results: RoundResult[] = bridge.getConnectedPlayers().map(p => ({
      id:       p.id,
      name:     p.name,
      colorHex: p.colorHex,
      frags:    bridge.getPlayerFrags(p.id),
    }));
    bridge.publishRoundResults(results);
  }

  private hostCheckReadyToStart(): void {
    if (this.roundStartPending || !bridge.areAllPlayersReady()) return;
    if (this.roomQualityMonitor.shouldBlockStart()) return;
    this.roundStartPending = true;
    this.lobbyOverlay.lockButton();
    bridge.setMatchHostId();
    bridge.resetAllFrags();
    const arenaStartTime = Date.now() + ARENA_COUNTDOWN_SEC * 1000;
    const layout = ArenaGenerator.generate(Date.now());
    bridge.publishArenaLayout(layout);
    bridge.setArenaStartTime(arenaStartTime);
    bridge.setRoundEndTime(arenaStartTime + ARENA_DURATION_SEC * 1000);
    bridge.setGamePhase('ARENA');
  }

  private spawnReadyPlayers(): void {
    if (!bridge.isHost()) return;
    for (const profile of bridge.getConnectedPlayers()) {
      if (bridge.getPlayerReady(profile.id) && !this.playerManager.hasPlayer(profile.id)) {
        this.playerManager.addPlayer(profile);
        this.combatSystem.initPlayer(profile.id);
        this.resourceSystem?.initPlayer(profile.id);
        this.burrowSystem?.initPlayer(profile.id);
        this.loadoutManager?.assignDefaultLoadout(profile.id, this.resolveCommittedLoadoutSelection(profile.id));
      }
    }
  }

  private buildLocalCommittedLoadoutSnapshot(): LoadoutCommitSnapshot {
    const localId = bridge.getLocalPlayerId();
    return {
      weapon1: bridge.getPlayerLoadoutSlot(localId, 'weapon1') ?? DEFAULT_LOADOUT.weapon1.id,
      weapon2: bridge.getPlayerLoadoutSlot(localId, 'weapon2') ?? DEFAULT_LOADOUT.weapon2.id,
      utility: bridge.getPlayerLoadoutSlot(localId, 'utility') ?? DEFAULT_LOADOUT.utility.id,
      ultimate: bridge.getPlayerLoadoutSlot(localId, 'ultimate') ?? DEFAULT_LOADOUT.ultimate.id,
    };
  }

  private resolveLoadoutSelection(playerId: string): LoadoutSelection {
    const w1Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon1');
    const w2Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon2');
    const utId = bridge.getPlayerLoadoutSlot(playerId, 'utility');
    const ulId = bridge.getPlayerLoadoutSlot(playerId, 'ultimate');
    return {
      weapon1:  w1Id ? WEAPON_CONFIGS[w1Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      weapon2:  w2Id ? WEAPON_CONFIGS[w2Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      utility:  utId ? UTILITY_CONFIGS[utId as keyof typeof UTILITY_CONFIGS]  : undefined,
      ultimate: ulId ? ULTIMATE_CONFIGS[ulId as keyof typeof ULTIMATE_CONFIGS]: undefined,
    };
  }

  private resolveCommittedLoadoutSelection(playerId: string): LoadoutSelection {
    const committed = bridge.getPlayerCommittedLoadout(playerId);
    if (!committed) return this.resolveLoadoutSelection(playerId);
    return {
      weapon1: WEAPON_CONFIGS[committed.weapon1 as keyof typeof WEAPON_CONFIGS],
      weapon2: WEAPON_CONFIGS[committed.weapon2 as keyof typeof WEAPON_CONFIGS],
      utility: UTILITY_CONFIGS[committed.utility as keyof typeof UTILITY_CONFIGS],
      ultimate: ULTIMATE_CONFIGS[committed.ultimate as keyof typeof ULTIMATE_CONFIGS],
    };
  }

  private syncHostLoadoutsFromCommittedSelections(): void {
    if (!bridge.isHost() || !this.loadoutManager) return;
    for (const profile of bridge.getConnectedPlayers()) {
      if (!this.playerManager.hasPlayer(profile.id)) continue;
      this.loadoutManager.syncSelectedLoadout(profile.id, this.resolveCommittedLoadoutSelection(profile.id));
    }
  }

  // ── Arena Aufbau / Teardown ───────────────────────────────────────────────

  private buildArena(layout: import('../types').ArenaLayout): void {
    this.tearDownArena();

    this.currentLayout = layout;
    const builder = new ArenaBuilder(this);
    this.arenaResult = builder.buildDynamic(layout);

    this.playerManager.setLayout(layout);

    this.projectileManager.setRockGroup(
      this.arenaResult.rockGroup,
      this.arenaResult.rockObjects,
      this.arenaResult.trunkGroup,
    );
    this.combatSystem.setArenaObstacles(this.arenaResult.rockObjects, this.arenaResult.trunkObjects);

    // Rock/Train-Damage-Callbacks für Hitscan/Melee-Objektschaden
    this.combatSystem.setRockDamageCallback((rockIndex, damage) => {
      if (!this.rockRegistry || !this.arenaResult) return;
      const newHp = this.rockRegistry.applyDamage(rockIndex, damage);
      ArenaBuilder.updateRockVisual(this.arenaResult.rockObjects, this.arenaResult.rockGroup, this.arenaResult.rockGrid, this.currentLayout!.rocks, rockIndex, newHp);
      if (newHp <= 0) this.powerUpSystem?.onRockDestroyed(rockIndex);
    });
    this.combatSystem.setTrainDamageCallback((damage, attackerId) => {
      this.trainManager?.applyDamage(damage, attackerId);
    });
    this.hostPhysics.setRockGroup(
      this.arenaResult.rockGroup,
      this.arenaResult.trunkGroup,
    );

    if (bridge.isHost()) {
      this.resourceSystem = new ResourceSystem();
      this.burrowSystem   = new BurrowSystem(
        this.resourceSystem,
        this.playerManager,
        this.combatSystem,
        this.hostPhysics,
        bridge,
      );
      this.burrowSystem.setGroups(this.arenaResult.rockGroup, this.arenaResult.trunkGroup);

      this.loadoutManager = new LoadoutManager(
        this.playerManager,
        this.projectileManager,
        this.resourceSystem,
        bridge,
      );

      // Rück-Referenzen setzen
      this.loadoutManager.setCombatSystem(this.combatSystem);
      this.loadoutManager.setDashBurstChecker(id => this.hostPhysics.isDashBurst(id));
      this.loadoutManager.setPhysicsSystem(this.hostPhysics);
      this.loadoutManager.setActionBlockedChecker((playerId, slot) => {
        if (!this.combatSystem.isAlive(playerId)) return true;
        if (slot === 'weapon1' || slot === 'weapon2') {
          if (this.burrowSystem?.isWeaponBlocked(playerId)) return true;
        }
        if (slot === 'utility' || slot === 'ultimate') {
          if (this.burrowSystem?.isUtilityBlocked(playerId)) return true;
        }
        return false;
      });
      this.loadoutManager.setNukeStrikeHandler((playerId, targetX, targetY) => {
        return this.powerUpSystem?.scheduleNukeStrike(playerId, targetX, targetY) ?? false;
      });
      this.combatSystem.setBurrowSystem(this.burrowSystem);
      this.combatSystem.setResourceSystem(this.resourceSystem);
      this.combatSystem.setLoadoutManager(this.loadoutManager);

      // PowerUpSystem initialisieren
      this.powerUpSystem = new PowerUpSystem(this.playerManager, this.combatSystem, layout, {
        onNukePickup: (playerId) => {
          this.loadoutManager?.overrideUtility(playerId, UTILITY_CONFIGS.NUKE, 1);
        },
        onNukeExploded: (x, y, radius, triggeredBy) => {
          bridge.broadcastExplosionEffect(x, y, radius, 0xffd26a, 'nuke');
          this.applyNukeEnvironmentDamage(x, y, radius, triggeredBy);
        },
        onHolyHandGrenadePickup: (playerId) => {
          this.loadoutManager?.overrideUtility(playerId, UTILITY_CONFIGS.HOLY_HAND_GRENADE, 1);
        },
        onBfgPickup: (playerId) => {
          this.loadoutManager?.overrideUtility(playerId, UTILITY_CONFIGS.BFG, 1);
        },
      });
      this.powerUpSystem.setArenaStartTime(bridge.getArenaStartTime());
      this.combatSystem.setPowerUpSystem(this.powerUpSystem);
      this.resourceSystem.setPowerUpSystem(this.powerUpSystem);

      // DetonationSystem initialisieren
      this.detonationSystem = new DetonationSystem(this.projectileManager);
      this.combatSystem.setDetonationSystem(this.detonationSystem);

      // ArmageddonSystem initialisieren (Meteor-Ultimate)
      this.armageddonSystem = new ArmageddonSystem();
      this.armageddonSystem.setRockGrid(this.arenaResult.rockGrid);
      this.loadoutManager.setArmageddonSystem(this.armageddonSystem);
      this.loadoutManager.setStinkCloudSystem(this.stinkCloudSystem);
      this.combatSystem.setStinkCloudSystem(this.stinkCloudSystem);
      this.burrowSystem.setStinkCloudSystem(this.stinkCloudSystem);

      // BFG Laser-Callback: Host löst periodische Laser-Strahlen aus
      this.projectileManager.setBfgLaserCallback((proj) => {
        this.resolveBfgLasers(proj);
      });

      this.hostPhysics.setBurrowSystem(this.burrowSystem);
      this.hostPhysics.setLoadoutManager(this.loadoutManager);

      // Kill-Callback: Frags erhöhen + Kill-Ereignis broadcasten + PowerUp-Drop
      this.combatSystem.setKillCallback((killerId, victimId, weapon, x, y) => {
        // Zug-Kills: kein Frag, aber Killfeed-Eintrag + Power-Up-Drop
        if (killerId === TRAIN.TRAIN_KILLER_ID) {
          this.powerUpSystem?.onPlayerKilled(x, y);
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
        bridge.incrementPlayerFrags(killerId);
        const allPlayers    = bridge.getConnectedPlayers();
        const killerProfile = allPlayers.find(p => p.id === killerId);
        const victimProfile  = allPlayers.find(p => p.id === victimId);
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
        }
        // Power-Up droppen an der Todesposition
        this.powerUpSystem?.onPlayerKilled(x, y);
      });

      // RockRegistry nur auf dem Host
      this.rockRegistry = new RockRegistry(layout);
      const arenaResult  = this.arenaResult;

      this.projectileManager.setRockHitCallback((rockId, damage) => {
        if (!this.rockRegistry || !arenaResult) return;
        const newHp = this.rockRegistry.applyDamage(rockId, damage);
        ArenaBuilder.updateRockVisual(arenaResult.rockObjects, arenaResult.rockGroup, arenaResult.rockGrid, this.currentLayout!.rocks, rockId, newHp);
        // Power-Up droppen wenn der Fels zerstört wurde
        if (newHp <= 0) {
          this.powerUpSystem?.onRockDestroyed(rockId);
        }
      });

      // Pickup-RPC vom Client entgegennehmen
      bridge.registerPickupPowerUpHandler((uid, playerId) => {
        const player = this.playerManager.getPlayer(playerId);
        if (!player) return;
        this.powerUpSystem?.tryPickup(playerId, uid, player.sprite.x, player.sprite.y);
      });

      // ── Zug-Event (Host-only) ────────────────────────────────────────────
      const trackCell = layout.tracks?.[0];
      if (trackCell !== undefined) {
        this.setupHostTrainEvent(trackCell.gridX);
      }
    }

    // ── TrainRenderer (alle Clients inkl. Host) ──────────────────────────────
    this.trainRenderer = new TrainRenderer(this);
  }

  /**
   * Erstellt und verdrahtet den Zug-Event auf dem Host (TrainManager, Callbacks, Projektil-Kollision).
   * Ausgelagert aus buildArena() zur besseren Übersichtlichkeit.
   */
  private setupHostTrainEvent(trackGridX: number): void {
    const trackX  = ARENA_OFFSET_X + trackGridX * CELL_SIZE + CELL_SIZE;
    const direction: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const spawnAt = bridge.getArenaStartTime() + TRAIN.SPAWN_DELAY_S * 1000;

    bridge.publishTrainEvent({ trackX, direction, spawnAt });

    this.trainManager = new TrainManager(this, this.playerManager, trackX, direction);
    this.trainSpawned = false;
    this.trainDestroyedShown = false;

    // Projektil-Kollision mit dem Zug verdrahten
    this.projectileManager.setTrainGroup(this.trainManager.getGroup());
    this.projectileManager.setTrainHitCallback((damage, attackerId) => {
      this.trainManager?.applyDamage(damage, attackerId);
    });

    // Spieler-Kollision → sofortiger Kill (skipBurrowCheck=true, kein Frag-Kredit)
    this.trainManager.setCanHitPlayerCallback((playerId) => {
      return !this.burrowSystem?.isBurrowed(playerId);
    });

    this.trainManager.setPlayerHitCallback((playerId) => {
      this.combatSystem.applyDamage(playerId, 9999, true, TRAIN.TRAIN_KILLER_ID, 'Zug RB 54');
    });

    // Zerstörungs-Callback
    this.trainManager.setDestroyCallback((result) => {
      // KILL_FRAGS an den letzten Treffer-Spieler vergeben
      if (result.lastHitterId) {
        bridge.addPlayerFrags(result.lastHitterId, TRAIN.KILL_FRAGS);
        const allPlayers  = bridge.getConnectedPlayers();
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
      // Große Explosionen an jedem Segment + zentrale Mega-Explosion
      for (const seg of result.segmentPositions) {
        bridge.broadcastExplosionEffect(seg.x, seg.y, 80);
      }
      bridge.broadcastExplosionEffect(result.centerX, result.centerY, 160);

      // Power-Ups nur an Segmenten, die sich noch innerhalb der Arena befinden
      const arenaTop    = ARENA_OFFSET_Y;
      const arenaBottom = ARENA_OFFSET_Y + ARENA_HEIGHT;
      const validSegs = result.segmentPositions.filter(
        seg => seg.y >= arenaTop && seg.y <= arenaBottom,
      );
      const dropSegs = validSegs.length > 0 ? validSegs : result.segmentPositions;
      for (let i = 0; i < TRAIN_DROP_COUNT; i++) {
        // Gleichmäßig über die gültigen Segmente verteilen
        const idx = Math.floor(i * dropSegs.length / TRAIN_DROP_COUNT);
        const seg = dropSegs[idx];
        const scatter = 28;
        const ox = (Math.random() - 0.5) * scatter;
        const oy = (Math.random() - 0.5) * scatter;
        this.powerUpSystem?.spawnFromTable('TRAIN_DESTROY', seg.x + ox, seg.y + oy);
      }
      bridge.broadcastTrainDestroyed();
    });

    // Natürlicher Ausfahrt-Callback: Zug nach Wartezeit erneut spawnen, Richtung alternieren
    this.trainManager.setExitedCallback(() => {
      const currentEvent = bridge.getTrainEvent();
      if (!currentEvent) return;
      // Richtung umkehren
      const newDirection: 1 | -1 = currentEvent.direction === 1 ? -1 : 1;
      const newSpawnAt = Date.now() + TRAIN.SPAWN_DELAY_S * 1000;
      bridge.publishTrainEvent({
        trackX:    currentEvent.trackX,
        direction: newDirection,
        spawnAt:   newSpawnAt,
      });
      // HP bleibt erhalten; nur Fahrtrichtung und Position werden neu gesetzt
      this.trainManager?.prepareReentry(newDirection);
      this.trainSpawned = false;
    });
  }

  private tearDownArena(): void {
    // Projektile (und ihre Phaser-Collider) VOR dem Gruppen-Destroy aufräumen,
    // sonst greifen verwaiste Collider auf die zerstörten StaticGroups zu und crashen.
    this.projectileManager.destroyAll();
    this.smokeSystem.destroyAll();
    this.fireSystem.destroyAll();
    this.stinkCloudSystem.destroyAll();
    this.effectSystem.clearAllBurrowStates();
    this.prevBurrowPhases.clear();

    if (this.arenaResult) {
      ArenaBuilder.destroyDynamic(this.arenaResult);
      this.arenaResult = null;
    }
    this.rockRegistry   = null;
    this.currentLayout  = null;
    this.powerUpSystem?.reset();
    this.powerUpSystem   = null;
    this.resourceSystem?.setPowerUpSystem(null);
    this.resourceSystem = null;
    this.burrowSystem   = null;
    this.combatSystem.setDetonationSystem(null);
    this.detonationSystem?.reset();
    this.detonationSystem = null;
    this.loadoutManager?.setCombatSystem(null);
    this.loadoutManager?.setActionBlockedChecker(null);
    this.loadoutManager = null;
    this.combatSystem.setBurrowSystem(null);
    this.combatSystem.setResourceSystem(null);
    this.combatSystem.setLoadoutManager(null);
    this.combatSystem.setPowerUpSystem(null);
    this.combatSystem.setStinkCloudSystem(null);
    this.combatSystem.setArenaObstacles(null, null);
    this.combatSystem.setTrainSegments(null);
    this.combatSystem.setRockDamageCallback(null);
    this.combatSystem.setTrainDamageCallback(null);
    this.combatSystem.setKillCallback(() => { /* noop */ });
    this.hostPhysics.setBurrowSystem(null);
    this.hostPhysics.setLoadoutManager(null);
    this.projectileManager.setRockGroup(null, null, null);
    this.hostPhysics.setRockGroup(null, null);

    this.powerUpRenderer?.clear();
    this.nukeRenderer?.clear();
    this.meteorRenderer?.clear();
    this.armageddonSystem?.destroyAll();
    this.armageddonSystem = null;

    // Zug aufräumen
    this.trainManager?.destroy();
    this.trainManager = null;
    this.trainRenderer?.destroy();
    this.trainRenderer = null;
    this.projectileManager.setTrainGroup(null);
    this.projectileManager.setTrainHitCallback(null);
    this.trainSpawned        = false;
    this.trainDestroyedShown = false;
    this.rightPanel.hideTrainWidget();
    this.clientUtilityOverride = null;
  }

  // ── Update ───────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    this.detectPhaseChange();

    const phase  = bridge.getGamePhase();
    const inGame = phase === 'ARENA';
    const countdownActive = bridge.isArenaCountdownActive();

    if (inGame) {
      this.inputSystem.setInputEnabled(!countdownActive);
      this.inputSystem.update();
    } else {
      this.inputSystem.setInputEnabled(false);
    }

    if (!this.matchTerminated && phase === 'LOBBY') {
      if (!this.lobbyOverlay.isVisible()) this.lobbyOverlay.show();
      const players = bridge.getConnectedPlayers();
      this.updateRoomQuality(this.time.now, players);
      this.lobbyOverlay.setRoomQuality(this.roomQualitySnapshot, bridge.isHost());
      this.lobbyOverlay.refreshPlayerList(players);
      const localProfile = players.find(p => p.id === bridge.getLocalPlayerId());
      if (localProfile) this.leftPanel.updateLocalName(localProfile.name);
      this.leftPanel.refreshColorIndicator();
      this.leftPanel.refreshColorPickerIfOpen();
      this.leftPanel.updateLobby();
      if (bridge.isHost()) this.hostCheckReadyToStart();
    } else if (!this.matchTerminated && this.lobbyOverlay.isVisible()) {
      this.lobbyOverlay.hide();
    }

    if (phase === 'ARENA' && !this.matchTerminated) {
      const secs = bridge.computeSecondsLeft();
      this.rightPanel.updateTimer(secs);

      // ── Zug-Widget aktualisieren ──────────────────────────────────────────
      const trainEvent = bridge.getTrainEvent();
      if (trainEvent) {
        if (this.trainDestroyedShown) {
          // showTrainDestroyed() wurde bereits via RPC gesetzt – nichts tun
        } else {
          // Letzten State aus GameState lesen (Client + Host teilen denselben Pfad)
          const latestState = bridge.getLatestGameState();
          const trainState  = latestState?.train ?? null;
          if (trainState?.alive) {
            this.rightPanel.updateTrainHP(trainState.hp, trainState.maxHp);
          } else if (bridge.getSynchronizedNow() < trainEvent.spawnAt) {
            // Noch nicht gespawnt – feste Ankunftszeit auf dem Runden-Timer anzeigen
            const arrivalTimerSecs = Math.max(0, Math.ceil((bridge.getRoundEndTime() - trainEvent.spawnAt) / 1000));
            this.rightPanel.setTrainArrival(arrivalTimerSecs);
          }
        }
      }

      if (bridge.isHost()) {
        this.spawnReadyPlayers();
        if (countdownActive) this.syncHostLoadoutsFromCommittedSelections();
        this.runHostUpdate(delta);
        if (!countdownActive && secs <= 0) {
          this.hostSaveRoundResults();
          bridge.setGamePhase('LOBBY');
        }
      } else {
        this.runClientUpdate(delta);
      }

      // Leaderboard mit aktuellen Frags und Ping aktualisieren (alle Clients)
      this.rightPanel.updateLeaderboard(this.getLeaderboardEntries());

      if (this.arenaResult) {
        const localSprite = this.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite ?? null;
        ArenaBuilder.updateCanopyTransparency(this.arenaResult.canopyObjects, localSprite);
      }
    }

    // AimSystem jeden Frame aktualisieren (auch wenn inGame=false → Cursor + gfx.clear())
    // Läuft nach Host-/Client-Update, damit lokale Autoritätsdaten im selben Frame wirken.
    const inArena = inGame && !this.matchTerminated;
    this.syncArenaFogOverlay(bridge.getSynchronizedNow(), inArena, countdownActive);
    const utilityTargeting = this.inputSystem.getUtilityTargetingPreviewState();
    const showAim = inArena
           && this.localPlayerAlive
           && !this.localPlayerBurrowed
           && !this.inputSystem.isUtilityChargePreviewActive();
    this.aimSystem?.update(showAim || utilityTargeting !== undefined, inArena, delta, utilityTargeting);
    this.utilityChargeIndicator?.update(this.inputSystem.getUtilityChargePreviewState());
        this.syncUtilityTargetingHint(inArena, utilityTargeting !== undefined);
  }

  private syncArenaFogOverlay(now: number, inArena: boolean, countdownActive: boolean): void {
    if (!this.arenaCountdown) return;

    if (!inArena) {
      this.overlayTrackedLocalAlive = null;
      this.arenaCountdown.clear();
      return;
    }

    if (countdownActive) {
      this.overlayTrackedLocalAlive = this.localPlayerAlive;
      this.arenaCountdown.update(now);
      return;
    }

    if (this.localPlayerAlive) {
      if (this.overlayTrackedLocalAlive === false) {
        this.arenaCountdown.playRespawnReveal();
      }
    } else if (this.overlayTrackedLocalAlive !== false) {
      this.arenaCountdown.showDeathVeil();
    }

    this.overlayTrackedLocalAlive = this.localPlayerAlive;
    this.arenaCountdown.update(now);
  }

  private createUtilityTargetingHint(): Phaser.GameObjects.Container {
    const x = ARENA_OFFSET_X + ARENA_WIDTH * 0.5;
    const y = ARENA_OFFSET_Y + 54;
    const panel = this.add.rectangle(0, 0, 500, 64, COLORS.GREY_10, 0.72);
    panel.setStrokeStyle(2, COLORS.RED_2, 0.9);
    const title = this.add.text(0, -11, 'ATOMBOMBE: ZIELMODUS', {
      fontFamily: 'monospace',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#fff1cf',
      stroke: '#241527',
      strokeThickness: 5,
    }).setOrigin(0.5);
    const subtitle = this.add.text(0, 15, 'Linksklick: platzieren   Rechtsklick oder E: abbrechen', {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: '#ebede9',
      stroke: '#241527',
      strokeThickness: 4,
    }).setOrigin(0.5);

    const container = this.add.container(x, y, [panel, title, subtitle]);
    container.setDepth(DEPTH.OVERLAY - 1);
    container.setScrollFactor(0);
    container.setVisible(false);
    return container;
  }

  private syncUtilityTargetingHint(inArena: boolean, isTargeting: boolean): void {
    const hint = this.utilityTargetingHint;
    if (!hint) return;

    const visible = inArena && isTargeting && this.localPlayerAlive && !this.localPlayerBurrowed;
    hint.setVisible(visible);
    if (!visible) return;

    hint.alpha = 0.9 + 0.1 * Math.sin(this.time.now / 160);
  }

  private getLeaderboardEntries(): { name: string; colorHex: number; frags: number; ping: number }[] {
    const playerIds = bridge.getConnectedPlayerIds();
    const signatureParts: string[] = [];

    for (const playerId of playerIds) {
      const name = bridge.getPlayerName(playerId);
      const colorHex = bridge.getPlayerColor(playerId) ?? 0xffffff;
      const frags = bridge.getPlayerFrags(playerId);
      const ping = bridge.getPlayerPing(playerId);
      signatureParts.push(`${playerId}:${name}:${colorHex}:${frags}:${ping}`);
    }

    const nextSignature = signatureParts.join('|');
    if (nextSignature === this.leaderboardSignature) return this.cachedLeaderboardEntries;

    this.leaderboardSignature = nextSignature;
    this.cachedLeaderboardEntries = playerIds
      .map(playerId => ({
        name: bridge.getPlayerName(playerId),
        colorHex: bridge.getPlayerColor(playerId) ?? 0xffffff,
        frags: bridge.getPlayerFrags(playerId),
        ping: bridge.getPlayerPing(playerId),
      }))
      .sort((a, b) => b.frags - a.frags);

    return this.cachedLeaderboardEntries;
  }

  // ── AoE-Umgebungsschaden (Felsen + Zug) ──────────────────────────────────

  /**
   * Wendet Flächenschaden auf Felsen und Zug an (Host-only).
   * Aufgerufen von Granaten-Explosionen, Feuer-Ticks, Detonationen und Nuklear-Schlägen.
   */
  private applyAoeEnvironmentDamage(
    x: number,
    y: number,
    radius: number,
    damage: number,
    rockMult: number,
    trainMult: number,
    attackerId: string,
  ): void {
    const arenaResult = this.arenaResult;

    // Felsschaden
    if (rockMult !== 0 && arenaResult && this.rockRegistry) {
      const rockObjects = arenaResult.rockObjects;
      for (let i = 0; i < rockObjects.length; i++) {
        const rock = rockObjects[i];
        if (!rock?.active) continue;
        const dist = Phaser.Math.Distance.Between(x, y, rock.x, rock.y);
        if (dist > radius) continue;
        const newHp = this.rockRegistry.applyDamage(i, damage * rockMult);
        ArenaBuilder.updateRockVisual(rockObjects, arenaResult.rockGroup, arenaResult.rockGrid, this.currentLayout!.rocks, i, newHp);
        if (newHp <= 0) {
          this.powerUpSystem?.onRockDestroyed(i);
        }
      }
    }

    // Zugschaden
    if (trainMult !== 0 && this.trainManager) {
      const trainState = this.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        // Treffer, wenn irgendein Segment-Mittelpunkt im AoE-Radius liegt
        const segments = this.trainManager.getSegmentPositions();
        for (const seg of segments) {
          if (Phaser.Math.Distance.Between(x, y, seg.x, seg.y) <= radius) {
            this.trainManager.applyDamage(damage * trainMult, attackerId);
            break; // Nur einmal pro AoE treffen
          }
        }
      }
    }
  }

  private applyExplosionEnvironmentDamage(
    x: number,
    y: number,
    effect: import('../types').ProjectileExplosionConfig,
    attackerId: string,
  ): void {
    const arenaResult = this.arenaResult;
    const rockMult = effect.rockDamageMult ?? 1;
    const trainMult = effect.trainDamageMult ?? 1;

    if (rockMult !== 0 && arenaResult && this.rockRegistry) {
      const rockObjects = arenaResult.rockObjects;
      for (let i = 0; i < rockObjects.length; i++) {
        const rock = rockObjects[i];
        if (!rock?.active) continue;
        const dist = Phaser.Math.Distance.Between(x, y, rock.x, rock.y);
        if (dist > effect.radius) continue;
        const t = Phaser.Math.Clamp(dist / effect.radius, 0, 1);
        const damage = Math.round(Phaser.Math.Linear(effect.maxDamage, effect.minDamage, t) * rockMult);
        if (damage <= 0) continue;
        const newHp = this.rockRegistry.applyDamage(i, damage);
        ArenaBuilder.updateRockVisual(rockObjects, arenaResult.rockGroup, arenaResult.rockGrid, this.currentLayout!.rocks, i, newHp);
        if (newHp <= 0) {
          this.powerUpSystem?.onRockDestroyed(i);
        }
      }
    }

    if (trainMult !== 0 && this.trainManager) {
      const trainState = this.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        let minDist = Infinity;
        for (const seg of this.trainManager.getSegmentPositions()) {
          const dist = Phaser.Math.Distance.Between(x, y, seg.x, seg.y);
          if (dist < minDist) minDist = dist;
        }
        if (minDist <= effect.radius) {
          const t = Phaser.Math.Clamp(minDist / effect.radius, 0, 1);
          const damage = Math.round(Phaser.Math.Linear(effect.maxDamage, effect.minDamage, t) * trainMult);
          if (damage > 0) {
            this.trainManager.applyDamage(damage, attackerId);
          }
        }
      }
    }
  }

  /**
   * Nuke-spezifischer Umgebungsschaden mit distanzbasiertem Falloff (wie bei Spielern).
   */
  /** Host: löst BFG-Laser-Strahlen auf alle gültigen Ziele im Radius auf. */
  private resolveBfgLasers(proj: import('../types').TrackedProjectile): void {
    const radius  = proj.bfgLaserRadius ?? 256;
    const damage  = proj.bfgLaserDamage ?? 10;
    const px      = proj.sprite.x;
    const py      = proj.sprite.y;
    const laserLines: { sx: number; sy: number; ex: number; ey: number }[] = [];

    // Spieler-Laser
    for (const player of this.playerManager.getAllPlayers()) {
      if (player.id === proj.ownerId) continue;
      if (!this.combatSystem.isAlive(player.id)) continue;
      if (this.burrowSystem?.isBurrowed(player.id)) continue;
      const dist = Phaser.Math.Distance.Between(px, py, player.sprite.x, player.sprite.y);
      if (dist > radius) continue;
      if (!this.combatSystem.hasLineOfSight(px, py, player.sprite.x, player.sprite.y)) continue;
      this.combatSystem.applyDamage(player.id, damage, false, proj.ownerId, 'BFG');
      laserLines.push({ sx: px, sy: py, ex: player.sprite.x, ey: player.sprite.y });
    }

    // Felsen-Laser (skipRockIndex um zu verhindern dass der Zielfels seine eigene LoS blockiert)
    const arenaResult = this.arenaResult;
    if (arenaResult && this.rockRegistry) {
      for (let i = 0; i < arenaResult.rockObjects.length; i++) {
        const rock = arenaResult.rockObjects[i];
        if (!rock?.active) continue;
        const dist = Phaser.Math.Distance.Between(px, py, rock.x, rock.y);
        if (dist > radius) continue;
        if (!this.combatSystem.hasLineOfSight(px, py, rock.x, rock.y, i)) continue;
        const newHp = this.rockRegistry.applyDamage(i, damage);
        ArenaBuilder.updateRockVisual(arenaResult.rockObjects, arenaResult.rockGroup, arenaResult.rockGrid, this.currentLayout!.rocks, i, newHp);
        if (newHp <= 0) {
          this.powerUpSystem?.onRockDestroyed(i);
        }
        laserLines.push({ sx: px, sy: py, ex: rock.x, ey: rock.y });
      }
    }

    // Zug-Laser
    if (this.trainManager) {
      const trainState = this.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        const segments = this.trainManager.getSegmentPositions();
        for (const seg of segments) {
          const dist = Phaser.Math.Distance.Between(px, py, seg.x, seg.y);
          if (dist > radius) continue;
          if (!this.combatSystem.hasLineOfSight(px, py, seg.x, seg.y)) continue;
          this.trainManager.applyDamage(damage, proj.ownerId);
          laserLines.push({ sx: px, sy: py, ex: seg.x, ey: seg.y });
          break; // Nur ein Laser pro Tick auf den Zug
        }
      }
    }

    bridge.broadcastBfgLaserBatch(laserLines, COLORS.GREEN_2);
  }

  private applyNukeEnvironmentDamage(
    x: number,
    y: number,
    radius: number,
    triggeredBy: string,
  ): void {
    const arenaResult = this.arenaResult;
    const rockMult:  number = NUKE_CONFIG.rockDamageMult;
    const trainMult: number = NUKE_CONFIG.trainDamageMult;

    // Felsschaden mit Distanz-Falloff
    if (rockMult !== 0 && arenaResult && this.rockRegistry) {
      for (let i = 0; i < arenaResult.rockObjects.length; i++) {
        const rock = arenaResult.rockObjects[i];
        if (!rock?.active) continue;
        const dist = Phaser.Math.Distance.Between(x, y, rock.x, rock.y);
        if (dist > radius) continue;
        const t = Phaser.Math.Clamp(dist / radius, 0, 1);
        const baseDmg = Phaser.Math.Linear(NUKE_CONFIG.maxDamage, NUKE_CONFIG.minDamage, t);
        const newHp = this.rockRegistry.applyDamage(i, Math.round(baseDmg * rockMult));
        ArenaBuilder.updateRockVisual(arenaResult.rockObjects, arenaResult.rockGroup, arenaResult.rockGrid, this.currentLayout!.rocks, i, newHp);
        if (newHp <= 0) {
          this.powerUpSystem?.onRockDestroyed(i);
        }
      }
    }

    // Zugschaden mit Distanz-Falloff
    if (trainMult !== 0 && this.trainManager) {
      const trainState = this.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        let minDist = Infinity;
        for (const seg of this.trainManager.getSegmentPositions()) {
          const d = Phaser.Math.Distance.Between(x, y, seg.x, seg.y);
          if (d < minDist) minDist = d;
        }
        if (minDist <= radius) {
          const t = Phaser.Math.Clamp(minDist / radius, 0, 1);
          const baseDmg = Phaser.Math.Linear(NUKE_CONFIG.maxDamage, NUKE_CONFIG.minDamage, t);
          this.trainManager.applyDamage(Math.round(baseDmg * trainMult), triggeredBy);
        }
      }
    }
  }

  // ── Host-Update ──────────────────────────────────────────────────────────

  private runHostUpdate(delta: number): void {
    const countdownActive = bridge.isArenaCountdownActive();

    // Ressourcen- und Burrow-Systeme ticken
    if (!countdownActive && this.resourceSystem && this.burrowSystem) {
      for (const player of this.playerManager.getAllPlayers()) {
        if (!this.burrowSystem.isBurrowed(player.id)) {
          this.resourceSystem.regenTick(player.id, delta);
        }
      }
      this.burrowSystem.update(delta);
    }

    // LoadoutManager ticken (Rage-Drain, Ultimate-Ablauf)
    if (!countdownActive) {
      this.loadoutManager?.update(delta);
      this.powerUpSystem?.update(delta);
    }

    this.hostPhysics.update(countdownActive);
    if (!countdownActive) {
      // Projektil-Detonations-Check vor combatSystem.update(), damit bereits gezündete
      // Projektile nicht mehr als Spieler-Treffer gewertet werden.
      this.detonationSystem?.checkProjectileDetonations();
      this.combatSystem.update();
    }

    const { synced: projectiles, explodedProjectiles, explodedGrenades, countdownEvents } = countdownActive
      ? { synced: [], explodedProjectiles: [], explodedGrenades: [], countdownEvents: [] }
      : this.projectileManager.hostUpdate(delta);

    // Granaten-Countdown-Events an alle Clients broadcasten
    for (const evt of countdownEvents) {
      bridge.broadcastGrenadeCountdown(evt.x, evt.y, evt.value);
    }
    // Hitscan-Traces und Melee-Swings werden jetzt per RPC direkt aus CombatSystem gesendet

    // Detonations-Ereignisse verarbeiten (ASMD Secondary Ball, zukünftige Raketen, …)
    const detonations = countdownActive ? [] : (this.detonationSystem?.flushDetonations() ?? []);
    for (const det of detonations) {
      this.combatSystem.applyAoeDamage(
        det.x, det.y, det.effect.aoeRadius, det.effect.aoeDamage, det.detonatorOwnerId,
      );
      if ((det.effect.knockback ?? 0) > 0) {
        this.hostPhysics.applyRadialImpulse(
          det.x,
          det.y,
          det.effect.aoeRadius,
          det.effect.knockback ?? 0,
          det.detonatorOwnerId,
          det.effect.selfKnockbackMult ?? 1,
        );
      }
      this.applyAoeEnvironmentDamage(
        det.x, det.y, det.effect.aoeRadius, det.effect.aoeDamage,
        det.effect.rockDamageMult ?? 1, det.effect.trainDamageMult ?? 1, det.detonatorOwnerId,
      );
      // Explosion in Spielerfarbe des Auslösers (z.B. Roter Spieler zündet grünen Ball → rote Explosion)
      const detonatorColor = bridge.getPlayerColor(det.detonatorOwnerId);
      bridge.broadcastExplosionEffect(
        det.x,
        det.y,
        det.effect.aoeRadius,
        det.effect.explosionColor ?? detonatorColor,
        det.effect.explosionVisualStyle,
      );
    }

    for (const explosion of explodedProjectiles) {
      this.combatSystem.applyExplosionDamage(explosion.x, explosion.y, explosion.effect, explosion.ownerId);
      this.hostPhysics.applyRadialImpulse(
        explosion.x,
        explosion.y,
        explosion.effect.radius,
        explosion.effect.knockback,
        explosion.ownerId,
        explosion.effect.selfKnockbackMult ?? 1,
      );
      this.applyExplosionEnvironmentDamage(explosion.x, explosion.y, explosion.effect, explosion.ownerId);
      bridge.broadcastExplosionEffect(
        explosion.x,
        explosion.y,
        explosion.effect.radius,
        explosion.effect.color,
        explosion.effect.visualStyle,
      );
    }

    // Granaten-Explosionen verarbeiten
    for (const g of explodedGrenades) {
      if (g.effect.type === 'damage') {
        this.combatSystem.applyAoeDamage(g.x, g.y, g.effect.radius, g.effect.damage, g.ownerId);
        this.applyAoeEnvironmentDamage(
          g.x, g.y, g.effect.radius, g.effect.damage,
          g.effect.rockDamageMult ?? 1, g.effect.trainDamageMult ?? 1, g.ownerId,
        );
        bridge.broadcastExplosionEffect(g.x, g.y, g.effect.radius, undefined, g.effect.visualStyle);
      } else if (g.effect.type === 'fire') {
        this.fireSystem.hostCreateZone(g.x, g.y, g.effect, g.ownerId);
      } else {
        this.smokeSystem.hostCreateCloud(g.x, g.y, g.effect);
      }
    }

    const smokes = countdownActive ? [] : this.smokeSystem.hostUpdate(Date.now());
    const { synced: fires, damageEvents: fireDamageEvents } = countdownActive
      ? { synced: [], damageEvents: [] }
      : this.fireSystem.hostUpdate(Date.now());

    // Stinkwolken-Update (spieler-folgend)
    const { synced: stinkClouds, damageEvents: stinkDmg } = countdownActive
      ? { synced: [], damageEvents: [] }
      : this.stinkCloudSystem.hostUpdate(Date.now(), (id) => {
          const player = this.playerManager.getPlayer(id);
          if (!player) return null;
          const profile = bridge.getConnectedPlayers().find(p => p.id === id);
          return {
            x: player.sprite.x,
            y: player.sprite.y,
            alive: this.combatSystem.isAlive(id),
            burrowed: this.burrowSystem?.isBurrowed(id) ?? false,
            color: profile?.colorHex ?? 0xffffff,
          };
        });

    // Feuer-Schadens-Ticks auf CombatSystem anwenden (inkl. Selbstschaden)
    for (const ev of fireDamageEvents) {
      this.combatSystem.applyAoeDamage(ev.x, ev.y, ev.radius, ev.damage, ev.ownerId, true);
      this.applyAoeEnvironmentDamage(
        ev.x, ev.y, ev.radius, ev.damage,
        ev.rockDamageMult, ev.trainDamageMult, ev.ownerId,
      );
    }

    // Stinkwolken-Schadens-Ticks (kein Selbstschaden)
    for (const ev of stinkDmg) {
      this.combatSystem.applyAoeDamage(ev.x, ev.y, ev.radius, ev.damage, ev.ownerId, false);
      this.applyAoeEnvironmentDamage(
        ev.x, ev.y, ev.radius, ev.damage,
        ev.rockDamageMult, ev.trainDamageMult, ev.ownerId,
      );
    }

    // ── Armageddon-Meteore (Host) ──────────────────────────────────────────
    const meteorImpacts = countdownActive ? [] : (this.armageddonSystem?.update(Date.now(), delta) ?? []);
    for (const mi of meteorImpacts) {
      // Spieler-Schaden (selfDamageMult steuert ob Caster getroffen wird)
      this.combatSystem.applyAoeDamage(
        mi.x, mi.y, mi.radius, mi.damage, mi.ownerId,
        mi.selfDamageMult > 0,
      );
      // Umgebungs-Schaden (Felsen, Zug)
      this.applyAoeEnvironmentDamage(
        mi.x, mi.y, mi.radius, mi.damage,
        mi.rockDamageMult, mi.trainDamageMult, mi.ownerId,
      );
      // Explosionseffekt an alle Clients broadcasten
      bridge.broadcastExplosionEffect(mi.x, mi.y, mi.radius, 0xff6622);
    }

    // ── Zug-Update (Host) ─────────────────────────────────────────────────────
    if (!countdownActive && this.trainManager) {
      if (!this.trainSpawned) {
        const trainEvent = bridge.getTrainEvent();
        if (trainEvent && Date.now() >= trainEvent.spawnAt) {
          this.trainManager.spawn();
          this.trainSpawned = true;
          // Zug-Segmente für Hitscan/Melee-Kollision bereitstellen
          this.combatSystem.setTrainSegments(this.trainManager.getSegObjects());
        }
      }
      if (this.trainSpawned) {
        this.trainManager.update(delta);
      }
    }

    const rocks   = this.rockRegistry?.getNetSnapshot() ?? [];

    // Hitscan-Traces und Melee-Swings werden per RPC abgespielt (Host empfängt eigene Broadcasts)

    // Host-lokale Visuals jeden Frame aktualisieren (HP-Bars, Sichtbarkeit, Dash-Trails)
    for (const player of this.playerManager.getAllPlayers()) {
      const hp    = this.combatSystem.getHP(player.id);
      const armor = this.combatSystem.getArmor(player.id);
      const alive = this.combatSystem.isAlive(player.id);
      player.updateHP(hp);
      player.updateArmor(armor);
      player.setVisible(alive);
      player.setRageTint(this.loadoutManager?.isUltimateActive(player.id) ?? false);
      player.syncBar();
      const dashPhase = this.hostPhysics.getDashPhase(player.id);
      if (dashPhase === 0) this.dashTrailTimers.delete(player.id);
      this.applyDashVisual(player, player.id, dashPhase, false);
    }

    const powerups = this.powerUpSystem?.getNetSnapshot() ?? [];
    const nukes    = this.powerUpSystem?.getNukeSnapshot() ?? [];
    const meteors  = this.armageddonSystem?.getSnapshot() ?? [];
    const train    = this.trainManager?.getNetSnapshot() ?? null;

    // Zug-Renderer auf dem Host direkt aktualisieren (kein Client-Update-Pfad)
    this.trainRenderer?.update(train);
    // PowerUp-Sprites auch auf dem Host rendern + Pickup prüfen
    this.powerUpRenderer?.sync(powerups);
    this.nukeRenderer?.sync(nukes);
    this.meteorRenderer?.sync(meteors);
    this.checkLocalPickup(powerups);

    // Rotation aller Spieler-Sprites auf dem Host aktualisieren
    const localId = bridge.getLocalPlayerId();
    for (const p of this.playerManager.getAllPlayers()) {
      if (p.id === localId) continue;
      const remoteInput = bridge.getPlayerInput(p.id);
      if (remoteInput) p.setRotation(dequantizeAngle(remoteInput.aim));
    }

    for (const player of this.playerManager.getAllPlayers()) {
      const burrowPhase = this.burrowSystem?.getPhase(player.id) ?? 'idle';
      this.applyBurrowVisual(player, burrowPhase);
    }

    // HUD des lokalen Host-Spielers aktualisieren
    const localPlayer = this.playerManager.getPlayer(localId);
    if (localPlayer) {
      const isMovingLocal = isVelocityMoving(localPlayer.body.velocity.x, localPlayer.body.velocity.y);
      const aimLocal      = this.loadoutManager?.getAimNetState(localId, isMovingLocal)
                          ?? this.getDefaultAimState(isMovingLocal);
      this.aimSystem?.setAuthoritativeState(aimLocal);
      this.inputSystem.setLocalState(
        this.burrowSystem?.isStunned(localId) ?? false,
        this.burrowSystem?.isBurrowed(localId) ?? false,
        this.burrowSystem?.getPhase(localId) ?? 'idle',
      );
      localPlayer.setRotation(this.inputSystem.getAimAngle());
      const now = Date.now();
      const utilCfg = this.loadoutManager?.getEquippedUtilityConfig(localId);
      const syringeActive = (this.powerUpSystem?.getRegenMultiplier(localId) ?? 1) > 1;
      const activePowerUps = this.powerUpSystem?.getActiveBuffsForHUD(localId) ?? [];
      this.leftPanel.updateArenaHUD({
        hp:                      this.combatSystem.getHP(localId),
        armor:                   this.combatSystem.getArmor(localId),
        adrenaline:              this.resourceSystem?.getAdrenaline(localId) ?? 0,
        rage:                    this.resourceSystem?.getRage(localId) ?? 0,
        isUltimateActive:        this.loadoutManager?.isUltimateActive(localId) ?? false,
        weapon1CooldownFrac:     this.loadoutManager?.getCooldownFrac(localId, 'weapon1', now) ?? 0,
        weapon2CooldownFrac:     this.loadoutManager?.getCooldownFrac(localId, 'weapon2', now) ?? 0,
        utilityCooldownFrac:     this.getLocalUtilityCooldownFrac(),
        utilityDisplayName:      utilCfg?.displayName,
        adrenalineSyringeActive: syringeActive,
        isUtilityOverridden:     bridge.getPlayerUtilityOverrideName(localId) !== '',
        activePowerUps,
      });
      this.localPlayerAlive    = this.combatSystem.isAlive(localId);
      this.localPlayerBurrowed = this.burrowSystem?.isBurrowed(localId) ?? false;
    }

    // ── Netzwerk-Tick-Rate-Drosselung: State nur alle NET_TICK_INTERVAL_MS senden ──
    this.netTickAccumulator += delta;
    if (this.netTickAccumulator < NET_TICK_INTERVAL_MS) return;
    this.netTickAccumulator -= NET_TICK_INTERVAL_MS;
    // Accumulator-Überlauf verhindern (z.B. bei Tab-Wechsel / großen Deltas)
    if (this.netTickAccumulator > NET_TICK_INTERVAL_MS) this.netTickAccumulator = 0;

    const players: Record<string, PlayerNetState> = {};
    for (const player of this.playerManager.getAllPlayers()) {
      const hp         = this.combatSystem.getHP(player.id);
      const armor      = this.combatSystem.getArmor(player.id);
      const alive      = this.combatSystem.isAlive(player.id);
      const adrenaline = this.resourceSystem?.getAdrenaline(player.id) ?? 0;
      const rage       = this.resourceSystem?.getRage(player.id) ?? 0;
      const isBurrowed = this.burrowSystem?.isBurrowed(player.id) ?? false;
      const isStunned  = this.burrowSystem?.isStunned(player.id)  ?? false;
      const burrowPhase = this.burrowSystem?.getPhase(player.id) ?? 'idle';
      const isRaging   = this.loadoutManager?.isUltimateActive(player.id) ?? false;
      const isMoving   = isVelocityMoving(player.body.velocity.x, player.body.velocity.y);
      const aim        = this.loadoutManager?.getAimNetState(player.id, isMoving)
                      ?? this.getDefaultAimState(isMoving);

      // Publish adrenaline syringe state for client HUD
      bridge.publishAdrSyringeActive(player.id, (this.powerUpSystem?.getRegenMultiplier(player.id) ?? 1) > 1);
      // Publish active buff durations for client HUD
      bridge.publishActiveBuffs(player.id, this.powerUpSystem?.getActiveBuffsForHUD(player.id) ?? []);

      const playerInput = bridge.getPlayerInput(player.id);
      players[player.id] = {
        x: Math.round(player.sprite.x),
        y: Math.round(player.sprite.y),
        rot: playerInput?.aim ?? 0,
        hp,
        armor,
        alive,
        adrenaline: Math.round(adrenaline),
        rage: Math.round(rage),
        isBurrowed,
        isStunned,
        burrowPhase,
        isRaging,
        dashPhase: this.hostPhysics.getDashPhase(player.id),
        aim: {
          revision:             aim.revision,
          isMoving:             aim.isMoving,
          weapon1DynamicSpread: Math.round(aim.weapon1DynamicSpread * 10) / 10,
          weapon2DynamicSpread: Math.round(aim.weapon2DynamicSpread * 10) / 10,
        },
      };
    }

    bridge.publishGameState({ players, projectiles, rocks, smokes, fires, stinkClouds, powerups, nukes, meteors, train });

    // BFG-Screenshake während Flug (Host)
    if (projectiles.some(p => p.style === 'bfg')) {
      this.cameras.main.shake(100, 0.003);
    }
  }

  // ── Client-Update ────────────────────────────────────────────────────────

  private runClientUpdate(delta: number): void {
    const state = bridge.getLatestGameState();
    if (!state) return;

    // Zeitbasierte Interpolation: frame-rate-unabhängig
    const lerpFactor = 1 - Math.exp(-delta / NET_SMOOTH_TIME_MS);

    // Prüfen ob ein neuer State vom Server eingetroffen ist
    const currentVersion = bridge.getGameStateVersion();
    const isNewData = currentVersion !== this.lastGameStateVersion;
    if (isNewData) this.lastGameStateVersion = currentVersion;

    // Spieler-Targets nur bei neuem Server-Snapshot setzen
    if (isNewData) {
      const localId = bridge.getLocalPlayerId();
      for (const [id, ps] of Object.entries(state.players)) {
        let player = this.playerManager.getPlayer(id);
        if (!player) {
          const profile = bridge.getConnectedPlayers().find(p => p.id === id);
          if (profile) {
            this.playerManager.addPlayer(profile);
            player = this.playerManager.getPlayer(id);
          }
        }
        if (!player) continue;

        // Respawn-Snap: Wenn alive von false → true wechselt, direkt auf Spawnposition setzen
        const wasAlive = this.prevAliveStates.get(id) ?? false;
        if (ps.alive && !wasAlive) {
          player.sprite.setPosition(ps.x, ps.y);
        }
        this.prevAliveStates.set(id, ps.alive);

        player.setTargetPosition(ps.x, ps.y);
        if (id !== localId) {
          player.setTargetRotation(dequantizeAngle(ps.rot));
        }
        player.updateHP(ps.hp);
        player.updateArmor(ps.armor);
        player.setVisible(ps.alive);
        player.setRageTint(ps.isRaging);

        // ── Dash-Visual-Verarbeitung ──────────────────────────────────────
        const curPhase  = ps.dashPhase ?? 0;

        if (curPhase === 2 && (this.prevDashPhases.get(id) ?? 0) !== 2) {
          this.dashPhase2StartTimes.set(id, this.time.now);
        }
        if (curPhase === 0) {
          this.dashPhase2StartTimes.delete(id);
          this.dashTrailTimers.delete(id);
        }
        this.prevDashPhases.set(id, curPhase);
        this.applyDashVisual(player, id, curPhase);
        this.applyBurrowVisual(player, ps.burrowPhase);
      }

      // Neue Projektil-Snapshots verarbeiten
      this.projectileManager.clientSyncVisuals(state.projectiles);

      // Effekte und Umgebung nur bei neuem State synchronisieren
      this.smokeSystem.syncVisuals(state.smokes);
      this.fireSystem.syncVisuals(state.fires ?? []);
      this.stinkCloudSystem.syncVisuals(state.stinkClouds ?? []);
      // Hitscan-Traces und Melee-Swings werden per RPC empfangen (EffectSystem-Handler)

      if (state.rocks && this.arenaResult && this.currentLayout) {
        for (const rs of state.rocks) {
          ArenaBuilder.updateRockVisual(
            this.arenaResult.rockObjects,
            this.arenaResult.rockGroup,
            this.arenaResult.rockGrid,
            this.currentLayout.rocks,
            rs.id,
            rs.hp,
          );
        }
      }

      this.trainRenderer?.setTarget(state.train ?? null);
      this.powerUpRenderer?.sync(state.powerups ?? []);
      this.nukeRenderer?.sync(state.nukes ?? []);
      this.meteorRenderer?.sync(state.meteors ?? []);
      this.checkLocalPickup(state.powerups ?? []);
    }

    // ── Jeden Frame: Smooth Interpolation + Extrapolation ───────────────
    for (const player of this.playerManager.getAllPlayers()) {
      player.lerpStep(lerpFactor);
    }
    this.trainRenderer?.render(lerpFactor);
    // Projektile zwischen Netzwerk-Ticks extrapolieren
    this.projectileManager.clientExtrapolate();

    const localId2 = bridge.getLocalPlayerId();
    const localPlayerClient = this.playerManager.getPlayer(localId2);
    if (localPlayerClient) {
      localPlayerClient.setRotation(this.inputSystem.getAimAngle());
    }

    const localState = state.players[localId2];
    if (localState) {
      this.aimSystem?.setAuthoritativeState(localState.aim);
      this.inputSystem.setLocalState(localState.isStunned, localState.isBurrowed, localState.burrowPhase);
      const localUtilityConfig = this.getLocalUtilityConfig();
      const overrideName = bridge.getPlayerUtilityOverrideName(localId2);
      const utilDisplayName = overrideName
        || this.clientUtilityOverride?.displayName
        || localUtilityConfig.displayName;
      this.leftPanel.updateArenaHUD({
        hp:                      localState.hp,
        armor:                   localState.armor,
        adrenaline:              localState.adrenaline,
        rage:                    localState.rage,
        isUltimateActive:        localState.isRaging,
        weapon1CooldownFrac:     this.getClientWeaponCooldownFrac('weapon1'),
        weapon2CooldownFrac:     this.getClientWeaponCooldownFrac('weapon2'),
        utilityCooldownFrac:     this.getLocalUtilityCooldownFrac(),
        utilityDisplayName:      utilDisplayName,
        adrenalineSyringeActive: bridge.getPlayerAdrSyringeActive(localId2),
        isUtilityOverridden:     overrideName !== '' || this.clientUtilityOverride !== null,
        activePowerUps:          bridge.getPlayerActiveBuffs(localId2),
      });
      this.localPlayerAlive    = localState.alive;
      this.localPlayerBurrowed = localState.isBurrowed;
    }

    // BFG-Screenshake während Flug (Client)
    if (state.projectiles.some(p => p.style === 'bfg')) {
      this.cameras.main.shake(100, 0.003);
    }
  }

  /**
   * Trail-Ghosts für einen Spieler anhand seiner Dash-Phase spawnen.
   * Auf dem Client auch die Sprite-Skalierung setzen (Host macht das bereits in HostPhysicsSystem).
   */
  private applyDashVisual(player: PlayerEntity, id: string, curPhase: 0 | 1 | 2, setScale = true): void {
    if (curPhase === 1) {
      if (setScale) player.setDashScale(0.5);
      const now = this.time.now;
      const nextGhost = this.dashTrailTimers.get(id) ?? 0;
      if (now >= nextGhost) {
        this.effectSystem.playDashTrailGhost(player.sprite.x, player.sprite.y, player.color, 0.5, player.sprite.rotation);
        this.dashTrailTimers.set(id, now + 50);
      }
    } else if (curPhase === 2) {
      if (setScale) {
        const p2Start = this.dashPhase2StartTimes.get(id);
        const t = p2Start !== undefined
          ? Math.min(1, (this.time.now - p2Start) / (DASH_T2_S * 1000))
          : 1;
        player.setDashScale(0.5 + 0.5 * t * t); // Quad.easeIn 50% → 100%
      }
    } else if (setScale) {
      player.setDashScale(1.0);
    }
  }

  private applyBurrowVisual(player: PlayerEntity, phase: BurrowPhase): void {
    const previousPhase = this.prevBurrowPhases.get(player.id) ?? 'idle';
    const shouldAnimate = previousPhase !== phase
      && ((phase === 'windup' && previousPhase === 'idle')
        || (phase === 'recovery' && (previousPhase === 'underground' || previousPhase === 'trapped')));

    if (shouldAnimate) {
      this.effectSystem.playBurrowPhaseEffect(player.sprite.x, player.sprite.y, phase);
    }
    player.setBurrowPhase(phase, shouldAnimate);
    this.effectSystem.syncBurrowState(player.id, phase, player.sprite);
    this.prevBurrowPhases.set(player.id, phase);
  }

  private getLocalWeaponConfig(slot: WeaponSlot): WeaponConfig {
    const localId = bridge.getLocalPlayerId();
    const equipped = this.loadoutManager?.getEquippedWeaponConfig(localId, slot);
    if (equipped) return equipped;

    const selection = this.resolveCommittedLoadoutSelection(localId);
    return selection[slot] ?? (slot === 'weapon1' ? WEAPON_CONFIGS.GLOCK : WEAPON_CONFIGS.P90);
  }

  private getLocalUtilityConfig(): UtilityConfig {
    const localId = bridge.getLocalPlayerId();
    // Tatsächlich ausgerüstete Utility (inkl. Override, z.B. Heilige Handgranate)
    const equipped = this.loadoutManager?.getEquippedUtilityConfig(localId);
    if (equipped) return equipped;
    // Client-seitige Vorhersage für Utility-Override (BFG/HHG)
    if (this.clientUtilityOverride) return this.clientUtilityOverride;
    // Fallback: Loadout-Menü-Auswahl
    const selection = this.resolveCommittedLoadoutSelection(localId);
    return selection.utility ?? UTILITY_CONFIGS.HE_GRENADE;
  }

  /** Client-seitiger Waffen-Cooldown basierend auf lokalem Fire-Timestamp und Config-Cooldown. */
  private getClientWeaponCooldownFrac(slot: 'weapon1' | 'weapon2'): number {
    const lastFired = this.weaponLastFired[slot];
    if (lastFired === 0) return 0;
    const config = this.getLocalWeaponConfig(slot);
    const elapsed = Date.now() - lastFired;
    if (elapsed >= config.cooldown) return 0;
    return 1 - elapsed / config.cooldown;
  }

  /** Utility-Cooldown als Fraktion 0 (bereit) – 1 (gerade benutzt) für HUD. */
  private getLocalUtilityCooldownFrac(): number {
    const localId = bridge.getLocalPlayerId();
    const cooldownUntil = bridge.getPlayerUtilityCooldownUntil(localId);
    const remaining = cooldownUntil - bridge.getSynchronizedNow();
    if (remaining <= 0) return 0;
    const config = this.getLocalUtilityConfig();
    if (config.cooldown <= 0) return 0;
    return Math.min(1, remaining / config.cooldown);
  }

  private playPredictedLocalHitscanTracer(
    slot: WeaponSlot,
    angle: number,
    targetX: number,
    targetY: number,
  ): number | undefined {
    void targetX;
    void targetY;

    const config = this.getLocalWeaponConfig(slot);
    if (config.fire.type !== 'hitscan') return undefined;

    const now = Date.now();
    if (now < this.predictedHitscanCooldownUntil[slot]) return undefined;
    this.predictedHitscanCooldownUntil[slot] = now + config.cooldown;

    const localPlayer = this.playerManager.getPlayer(bridge.getLocalPlayerId());
    if (!localPlayer) return undefined;

    const shotId = this.nextPredictedHitscanShotId++;
    const trace = this.combatSystem.traceHitscan({
      shooterId: bridge.getLocalPlayerId(),
      startX: localPlayer.sprite.x,
      startY: localPlayer.sprite.y,
      angle,
      range: config.range,
      traceThickness: config.fire.traceThickness,
      applyFavorTheShooter: bridge.isHost(),
    });

    this.effectSystem.playPredictedHitscanTracer(
      localPlayer.sprite.x,
      localPlayer.sprite.y,
      trace.endX,
      trace.endY,
      localPlayer.color,
      config.fire.traceThickness,
      shotId,
    );

    return shotId;
  }

  private getDefaultAimState(isMoving: boolean): PlayerAimNetState {
    return {
      revision: 0,
      isMoving,
      weapon1DynamicSpread: 0,
      weapon2DynamicSpread: 0,
    };
  }

  // ── Power-Up-Pickup (Host + Client) ─────────────────────────────────────

  /**
   * Prüft ob der lokale Spieler ein Power-Up berührt und sendet ggf. einen Pickup-RPC.
   * Debounced auf 100ms um RPC-Spam zu vermeiden.
   */
  private checkLocalPickup(powerups: import('../types').SyncedPowerUp[]): void {
    const now = Date.now();
    if (now < this.pickupCooldownUntil) return;

    const localId = bridge.getLocalPlayerId();
    const player  = this.playerManager.getPlayer(localId);
    if (!player || !player.sprite.active) return;

    const px = player.sprite.x;
    const py = player.sprite.y;

    for (const pu of powerups) {
      const dist = Phaser.Math.Distance.Between(px, py, pu.x, pu.y);
      if (dist <= PICKUP_RADIUS * 2) {
        if (bridge.isHost()) {
          // Host kann direkt einsammeln – kein RPC-Umweg nötig
          this.powerUpSystem?.tryPickup(localId, pu.uid, px, py);
        } else {
          bridge.sendPickupPowerUp(pu.uid);
          // Client-seitige Vorhersage: Utility-Override lokal setzen
          if (pu.defId === 'BFG') {
            this.clientUtilityOverride = UTILITY_CONFIGS.BFG;
          } else if (pu.defId === 'NUKE') {
            this.clientUtilityOverride = UTILITY_CONFIGS.NUKE;
          } else if (pu.defId === 'HOLY_HAND_GRENADE') {
            this.clientUtilityOverride = UTILITY_CONFIGS.HOLY_HAND_GRENADE;
          }
        }
        this.pickupCooldownUntil = now + 100; // 100ms Debounce
        return; // Maximal 1 Pickup-Request pro Check
      }
    }
  }

  private initializeRoomQuality(): void {
    this.roomQualityMonitor.initialize(this.time.now);
    this.roomQualitySnapshot = this.roomQualityMonitor.getSnapshot();
  }

  private updateRoomQuality(now: number, players: PlayerProfile[]): void {
    this.roomQualitySnapshot = this.roomQualityMonitor.update(now, players);
  }
}
