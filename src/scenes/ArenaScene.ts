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
import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../loadout/LoadoutConfig';
import type { UtilityConfig, WeaponConfig }   from '../loadout/LoadoutConfig';
import { EffectSystem }        from '../effects/EffectSystem';
import { SmokeSystem }         from '../effects/SmokeSystem';
import { FireSystem }          from '../effects/FireSystem';
import { BulletRenderer }      from '../effects/BulletRenderer';
import { FlameRenderer }       from '../effects/FlameRenderer';
import { PowerUpSystem }        from '../powerups/PowerUpSystem';
import { PICKUP_RADIUS, TRAIN_DROP_COUNT, NUKE_CONFIG } from '../powerups/PowerUpConfig';
import { NukeRenderer }        from '../powerups/NukeRenderer';
import { PowerUpRenderer }     from '../powerups/PowerUpRenderer';
import { DetonationSystem }    from '../systems/DetonationSystem';
import { TrainManager }        from '../train/TrainManager';
import { TrainRenderer }       from '../train/TrainRenderer';
import { TRAIN }               from '../train/TrainConfig';
import { LeftSidePanel }       from '../ui/LeftSidePanel';
import { RightSidePanel }      from '../ui/RightSidePanel';
import { AimSystem, UtilityChargeIndicator } from '../ui/AimSystem';
import { ArenaCountdownOverlay } from '../ui/ArenaCountdownOverlay';
import { LobbyOverlay }        from './LobbyOverlay';
import type { PlayerAimNetState, PlayerNetState, GamePhase, PlayerProfile, WeaponSlot } from '../types';
import type { RoundResult } from '../network/NetworkBridge';
import {
  ARENA_HEIGHT,
  ARENA_COUNTDOWN_SEC, ARENA_DURATION_SEC, PLAYER_COLORS,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_WIDTH,
  CELL_SIZE, DEPTH,
  DASH_T2_S,
  NET_TICK_INTERVAL_MS, NET_SMOOTH_TIME_MS,
} from '../config';
import { isVelocityMoving } from '../loadout/SpreadMath';
import { dequantizeAngle } from '../utils/angle';


export class ArenaScene extends Phaser.Scene {
  private playerManager!:     PlayerManager;
  private projectileManager!: ProjectileManager;
  private combatSystem!:      CombatSystem;
  private effectSystem!:      EffectSystem;
  private smokeSystem!:       SmokeSystem;
  private fireSystem!:        FireSystem;
  private bulletRenderer!:    BulletRenderer;
  private flameRenderer!:     FlameRenderer;
  private inputSystem!:       InputSystem;
  private hostPhysics!:       HostPhysicsSystem;
  private lobbyOverlay!:      LobbyOverlay;

  // ── HUD / Aim ─────────────────────────────────────────────────────────────
  private leftPanel!:  LeftSidePanel;
  private rightPanel!: RightSidePanel;
  private aimSystem:   AimSystem | null = null;
  private utilityChargeIndicator: UtilityChargeIndicator | null = null;
  private arenaCountdown: ArenaCountdownOverlay | null = null;

  // Alive/Burrowed-Flags des lokalen Spielers (gesetzt in runHostUpdate/runClientUpdate)
  private localPlayerAlive    = false;
  private localPlayerBurrowed = false;

  // ── Dynamische Arena ──────────────────────────────────────────────────────
  private arenaResult:  ArenaBuilderResult | null = null;
  private rockRegistry: RockRegistry | null       = null;

  // ── Host-only Systeme ─────────────────────────────────────────────────────
  private resourceSystem:    ResourceSystem    | null = null;
  private burrowSystem:      BurrowSystem      | null = null;
  private loadoutManager:    LoadoutManager    | null = null;
  private powerUpSystem:     PowerUpSystem     | null = null;
  private detonationSystem:  DetonationSystem  | null = null;

  // ── Zug-Event ─────────────────────────────────────────────────────────────
  private trainManager:       TrainManager  | null = null;
  private trainRenderer:      TrainRenderer | null = null;
  private nukeRenderer:       NukeRenderer  | null = null;
  private powerUpRenderer:     PowerUpRenderer | null = null;
  private trainSpawned          = false;
  private trainDestroyedShown   = false;

  private pickupCooldownUntil = 0; // Spam-Schutz für Pickup-RPC

  // ── Dash-Visual-Tracking (client-seitig) ──────────────────────────────────
  private dashPhase2StartTimes = new Map<string, number>(); // playerId → lokaler Zeitstempel
  private prevDashPhases       = new Map<string, number>(); // playerId → vorherige Phase
  private prevAliveStates      = new Map<string, boolean>(); // playerId → vorheriger alive-Status
  private dashTrailTimers      = new Map<string, number>(); // playerId → nächster Ghost ms
  // ── State Machine ─────────────────────────────────────────────────────────
  private isLocalReady      = false;
  private lastPhase: GamePhase = 'LOBBY';
  private roundStartPending = false;
  /**
   * Wird true wenn der Host während eines laufenden Matches disconnectet.
   * Sperrt die Arena-Simulation bis die Netzwerkphase auf 'LOBBY' wechselt.
   */
  private matchTerminated   = false;

  // ── Netzwerk-Tick-Rate-Drosselung (Host) ─────────────────────────────────
  private netTickAccumulator = 0;
  // ── Client: letzte verarbeitete GameState-Version ────────────────────────
  private lastGameStateVersion = -1;

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
    this.load.image('bg_tracks',  './assets/sprites/48x48tracks02.png');
    this.load.image('bg_canopy',  './assets/sprites/192x192canopy01.png');
    this.load.image('lobby_logo', './assets/sprites/fragdachselogo.png');
    this.load.image('powerup_hp', './assets/sprites/16x16HP.png');
    this.load.image('powerup_adr', './assets/sprites/16x16adrenalin.png');
    this.load.image('powerup_dam', './assets/sprites/16x16damageamp.png');
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
    this.nukeRenderer = new NukeRenderer(this);
    this.nukeRenderer.generateTextures();
    this.powerUpRenderer = new PowerUpRenderer(this);

    // ── 4. Combat-System ──────────────────────────────────────────────────
    this.combatSystem = new CombatSystem(this.playerManager, this.projectileManager, bridge);

    // ── 5. Effekt-System ──────────────────────────────────────────────────
    this.effectSystem = new EffectSystem(this, bridge);
    this.effectSystem.setup(() => {
      this.aimSystem?.notifyConfirmedHit();
    });
    this.smokeSystem = new SmokeSystem(this);
    this.fireSystem  = new FireSystem(this);

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
      let shotId: number | undefined;
      if (slot === 'weapon1' || slot === 'weapon2') {
        this.aimSystem?.notifyShot(slot);
        shotId = this.playPredictedLocalHitscanTracer(slot, angle, targetX, targetY);
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

    // ── 8. Left Side Panel (Namensanzeige + ResourceHUD) ──────────────────
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

    // ── 9. Loadout-RPC-Handler (Dispatch an LoadoutManager auf Host) ──────
    bridge.registerLoadoutUseHandler((slot, angle, targetX, targetY, senderId, shotId, params, clientX, clientY) => {
      if (!bridge.isHost()) return;
      if (bridge.isArenaCountdownActive()) return;
      this.loadoutManager?.use(slot, senderId, angle, targetX, targetY, Date.now(), shotId, params, clientX, clientY);
    });

    // ── 10. Explosions-Effekt-RPC (alle Clients inkl. Host) ───────────────
    bridge.registerExplosionEffectHandler((x, y, radius, color) => {
      this.effectSystem.playExplosionEffect(x, y, radius, color);
    });

    // ── 11. RPC-Handler für Burrow-Visualisierung ─────────────────────────
    bridge.registerBurrowVisualHandler((playerId, isBurrowed) => {
      const entity = this.playerManager.getPlayer(playerId);
      if (!entity) return;
      entity.setBurrowVisual(isBurrowed);
    });

    // ── 12. Schockwellen-Visualisierung ───────────────────────────────────
    bridge.registerShockwaveEffectHandler((x, y) => {
      this.effectSystem.playShockwaveEffect(x, y);
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
    this.lobbyOverlay = new LobbyOverlay(this, bridge, () => this.onReadyToggled());
    this.lobbyOverlay.build();
    this.lobbyOverlay.show();

    // ── 16. Eigenen Ready-Status hart zurücksetzen ────────────────────────
    this.isLocalReady = false;
    bridge.setLocalReady(false);

    // ── 17. Initiale Phase lesen (Spät-Joiner-Support) ────────────────────
    this.lastPhase = bridge.getGamePhase();

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
    bridge.setLocalReady(this.isLocalReady);
    this.lobbyOverlay.setReadyButtonState(this.isLocalReady);
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
          this.loadoutManager?.assignDefaultLoadout(profile.id, this.resolveLoadoutSelection(profile.id));
        }
      }
    }

    this.leftPanel.transitionToGame();
    this.rightPanel.transitionToGame();
    this.arenaCountdown?.syncTo(bridge.getArenaStartTime());
    this.lobbyOverlay.lockButton();
    this.lobbyOverlay.hide();
  }

  private onTransitionToLobby(): void {
    this.isLocalReady = false;
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
    this.rightPanel.transitionToLobby();
    this.rightPanel.showRoundResults(bridge.getRoundResults());
    this.lobbyOverlay.setReadyButtonState(false);
    this.lobbyOverlay.show();
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
        this.loadoutManager?.assignDefaultLoadout(profile.id, this.resolveLoadoutSelection(profile.id));
      }
    }
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

  // ── Arena Aufbau / Teardown ───────────────────────────────────────────────

  private buildArena(layout: import('../types').ArenaLayout): void {
    this.tearDownArena();

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
      ArenaBuilder.updateRockVisual(this.arenaResult.rockObjects, this.arenaResult.rockGroup, rockIndex, newHp);
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
      this.combatSystem.setBurrowSystem(this.burrowSystem);
      this.combatSystem.setResourceSystem(this.resourceSystem);
      this.combatSystem.setLoadoutManager(this.loadoutManager);

      // PowerUpSystem initialisieren
      this.powerUpSystem = new PowerUpSystem(this.playerManager, this.combatSystem, layout, {
        onNukeExploded: (x, y, radius, triggeredBy) => {
          bridge.broadcastExplosionEffect(x, y, radius, 0xffd26a);
          this.applyNukeEnvironmentDamage(x, y, radius, triggeredBy);
        },
      });
      this.powerUpSystem.setArenaStartTime(bridge.getArenaStartTime());
      this.combatSystem.setPowerUpSystem(this.powerUpSystem);
      this.resourceSystem.setPowerUpSystem(this.powerUpSystem);

      // DetonationSystem initialisieren
      this.detonationSystem = new DetonationSystem(this.projectileManager);
      this.combatSystem.setDetonationSystem(this.detonationSystem);

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
        ArenaBuilder.updateRockVisual(arenaResult.rockObjects, arenaResult.rockGroup, rockId, newHp);
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
    const trackX  = ARENA_OFFSET_X + trackGridX * CELL_SIZE + CELL_SIZE / 2;
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

    if (this.arenaResult) {
      ArenaBuilder.destroyDynamic(this.arenaResult);
      this.arenaResult = null;
    }
    this.rockRegistry   = null;
    this.powerUpSystem?.reset();
    this.powerUpSystem   = null;
    this.resourceSystem?.setPowerUpSystem(null);
    this.resourceSystem = null;
    this.burrowSystem   = null;
    this.combatSystem.setDetonationSystem(null);
    this.detonationSystem?.reset();
    this.detonationSystem = null;
    this.loadoutManager?.setCombatSystem(null);
    this.loadoutManager = null;
    this.combatSystem.setBurrowSystem(null);
    this.combatSystem.setResourceSystem(null);
    this.combatSystem.setLoadoutManager(null);
    this.combatSystem.setPowerUpSystem(null);
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
      this.arenaCountdown?.update();
    } else {
      this.inputSystem.setInputEnabled(false);
      this.arenaCountdown?.clear();
    }

    if (!this.matchTerminated && phase === 'LOBBY') {
      if (!this.lobbyOverlay.isVisible()) this.lobbyOverlay.show();
      const players = bridge.getConnectedPlayers();
      this.lobbyOverlay.refreshPlayerList(players);
      const localProfile = players.find(p => p.id === bridge.getLocalPlayerId());
      if (localProfile) this.leftPanel.updateLocalName(localProfile.name);
      this.leftPanel.refreshColorIndicator();
      this.leftPanel.refreshColorPickerIfOpen();
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
          } else if (Date.now() < trainEvent.spawnAt) {
            // Noch nicht gespawnt – feste Ankunftszeit auf dem Runden-Timer anzeigen
            const arrivalTimerSecs = Math.max(0, Math.ceil((bridge.getRoundEndTime() - trainEvent.spawnAt) / 1000));
            this.rightPanel.setTrainArrival(arrivalTimerSecs);
          }
        }
      }

      if (bridge.isHost()) {
        this.spawnReadyPlayers();
        this.runHostUpdate(delta);
        if (!countdownActive && secs <= 0) {
          this.hostSaveRoundResults();
          bridge.setGamePhase('LOBBY');
        }
      } else {
        this.runClientUpdate(delta);
      }

      // Leaderboard mit aktuellen Frags und Ping aktualisieren (alle Clients)
      const leaderboardEntries = bridge.getConnectedPlayers()
        .map(p => ({ name: p.name, colorHex: p.colorHex, frags: bridge.getPlayerFrags(p.id), ping: bridge.getPlayerPing(p.id) }))
        .sort((a, b) => b.frags - a.frags);
      this.rightPanel.updateLeaderboard(leaderboardEntries);

      if (this.arenaResult) {
        const localSprite = this.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite ?? null;
        ArenaBuilder.updateCanopyTransparency(this.arenaResult.canopyObjects, localSprite);
      }
    }

    // AimSystem jeden Frame aktualisieren (auch wenn inGame=false → Cursor + gfx.clear())
    // Läuft nach Host-/Client-Update, damit lokale Autoritätsdaten im selben Frame wirken.
    const inArena = inGame && !this.matchTerminated;
    const showAim = inArena
                 && this.localPlayerAlive
                 && !this.localPlayerBurrowed
                 && !this.inputSystem.isUtilityPreviewActive();
    this.aimSystem?.update(showAim, inArena, delta);
    this.utilityChargeIndicator?.update(this.inputSystem.getUtilityChargePreviewState());
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
        ArenaBuilder.updateRockVisual(rockObjects, arenaResult.rockGroup, i, newHp);
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

  /**
   * Nuke-spezifischer Umgebungsschaden mit distanzbasiertem Falloff (wie bei Spielern).
   */
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
        ArenaBuilder.updateRockVisual(arenaResult.rockObjects, arenaResult.rockGroup, i, newHp);
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

    const { synced: projectiles, explodedGrenades } = countdownActive
      ? { synced: [], explodedGrenades: [] }
      : this.projectileManager.hostUpdate(delta);
    // Hitscan-Traces und Melee-Swings werden jetzt per RPC direkt aus CombatSystem gesendet

    // Detonations-Ereignisse verarbeiten (ASMD Secondary Ball, zukünftige Raketen, …)
    const detonations = countdownActive ? [] : (this.detonationSystem?.flushDetonations() ?? []);
    for (const det of detonations) {
      this.combatSystem.applyAoeDamage(
        det.x, det.y, det.effect.aoeRadius, det.effect.aoeDamage, det.detonatorOwnerId,
      );
      this.applyAoeEnvironmentDamage(
        det.x, det.y, det.effect.aoeRadius, det.effect.aoeDamage,
        det.effect.rockDamageMult ?? 1, det.effect.trainDamageMult ?? 1, det.detonatorOwnerId,
      );
      // Explosion in Spielerfarbe des Auslösers (z.B. Roter Spieler zündet grünen Ball → rote Explosion)
      const detonatorColor = bridge.getPlayerColor(det.detonatorOwnerId);
      bridge.broadcastExplosionEffect(det.x, det.y, det.effect.aoeRadius, detonatorColor);
    }

    // Granaten-Explosionen verarbeiten
    for (const g of explodedGrenades) {
      if (g.effect.type === 'damage') {
        this.combatSystem.applyAoeDamage(g.x, g.y, g.effect.radius, g.effect.damage, g.ownerId);
        this.applyAoeEnvironmentDamage(
          g.x, g.y, g.effect.radius, g.effect.damage,
          g.effect.rockDamageMult ?? 1, g.effect.trainDamageMult ?? 1, g.ownerId,
        );
        bridge.broadcastExplosionEffect(g.x, g.y, g.effect.radius);
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

    // Feuer-Schadens-Ticks auf CombatSystem anwenden (inkl. Selbstschaden)
    for (const ev of fireDamageEvents) {
      this.combatSystem.applyAoeDamage(ev.x, ev.y, ev.radius, ev.damage, ev.ownerId, true);
      this.applyAoeEnvironmentDamage(
        ev.x, ev.y, ev.radius, ev.damage,
        ev.rockDamageMult, ev.trainDamageMult, ev.ownerId,
      );
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
      const alive = this.combatSystem.isAlive(player.id);
      player.updateHP(hp);
      player.setVisible(alive);
      player.setRageTint(this.loadoutManager?.isUltimateActive(player.id) ?? false);
      player.syncBar();
      const dashPhase = this.hostPhysics.getDashPhase(player.id);
      if (dashPhase === 0) this.dashTrailTimers.delete(player.id);
      this.applyDashVisual(player, player.id, dashPhase, false);
    }

    const powerups = this.powerUpSystem?.getNetSnapshot() ?? [];
    const nukes    = this.powerUpSystem?.getNukeSnapshot() ?? [];
    const train    = this.trainManager?.getNetSnapshot() ?? null;

    // Zug-Renderer auf dem Host direkt aktualisieren (kein Client-Update-Pfad)
    this.trainRenderer?.update(train);
    // PowerUp-Sprites auch auf dem Host rendern + Pickup prüfen
    this.powerUpRenderer?.sync(powerups);
    this.nukeRenderer?.sync(nukes);
    this.checkLocalPickup(powerups);

    // Rotation aller Spieler-Sprites auf dem Host aktualisieren
    const localId = bridge.getLocalPlayerId();
    for (const p of this.playerManager.getAllPlayers()) {
      if (p.id === localId) continue;
      const remoteInput = bridge.getPlayerInput(p.id);
      if (remoteInput) p.setRotation(dequantizeAngle(remoteInput.aim));
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
      );
      localPlayer.setRotation(this.inputSystem.getAimAngle());
      this.leftPanel.updateResources(
        this.resourceSystem?.getAdrenaline(localId) ?? 0,
        this.resourceSystem?.getRage(localId) ?? 0,
        this.inputSystem.getDashCooldownFrac(),
      );
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
      const alive      = this.combatSystem.isAlive(player.id);
      const adrenaline = this.resourceSystem?.getAdrenaline(player.id) ?? 0;
      const rage       = this.resourceSystem?.getRage(player.id) ?? 0;
      const isBurrowed = this.burrowSystem?.isBurrowed(player.id) ?? false;
      const isStunned  = this.burrowSystem?.isStunned(player.id)  ?? false;
      const isRaging   = this.loadoutManager?.isUltimateActive(player.id) ?? false;
      const isMoving   = isVelocityMoving(player.body.velocity.x, player.body.velocity.y);
      const aim        = this.loadoutManager?.getAimNetState(player.id, isMoving)
                      ?? this.getDefaultAimState(isMoving);

      const playerInput = bridge.getPlayerInput(player.id);
      players[player.id] = {
        x: Math.round(player.sprite.x),
        y: Math.round(player.sprite.y),
        rot: playerInput?.aim ?? 0,
        hp,
        alive,
        adrenaline: Math.round(adrenaline),
        rage: Math.round(rage),
        isBurrowed,
        isStunned,
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

    bridge.publishGameState({ players, projectiles, rocks, smokes, fires, powerups, nukes, train });
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
        player.setVisible(ps.alive);
        player.setBurrowVisual(ps.isBurrowed);
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
      }

      // Neue Projektil-Snapshots verarbeiten
      this.projectileManager.clientSyncVisuals(state.projectiles);

      // Effekte und Umgebung nur bei neuem State synchronisieren
      this.smokeSystem.syncVisuals(state.smokes);
      this.fireSystem.syncVisuals(state.fires ?? []);
      // Hitscan-Traces und Melee-Swings werden per RPC empfangen (EffectSystem-Handler)

      if (state.rocks && this.arenaResult) {
        for (const rs of state.rocks) {
          ArenaBuilder.updateRockVisual(
            this.arenaResult.rockObjects,
            this.arenaResult.rockGroup,
            rs.id,
            rs.hp,
          );
        }
      }

      this.trainRenderer?.setTarget(state.train ?? null);
      this.powerUpRenderer?.sync(state.powerups ?? []);
      this.nukeRenderer?.sync(state.nukes ?? []);
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
      this.inputSystem.setLocalState(localState.isStunned, localState.isBurrowed);
      this.leftPanel.updateResources(
        localState.adrenaline,
        localState.rage,
        this.inputSystem.getDashCooldownFrac(),
      );
      this.localPlayerAlive    = localState.alive;
      this.localPlayerBurrowed = localState.isBurrowed;
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
        this.effectSystem.playDashTrailGhost(player.sprite.x, player.sprite.y, player.color, 0.5);
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

  private getLocalWeaponConfig(slot: WeaponSlot): WeaponConfig {
    const localId = bridge.getLocalPlayerId();
    const equipped = this.loadoutManager?.getEquippedWeaponConfig(localId, slot);
    if (equipped) return equipped;

    const selection = this.resolveLoadoutSelection(localId);
    return selection[slot] ?? (slot === 'weapon1' ? WEAPON_CONFIGS.GLOCK : WEAPON_CONFIGS.P90);
  }

  private getLocalUtilityConfig(): UtilityConfig {
    const localId = bridge.getLocalPlayerId();
    const selection = this.resolveLoadoutSelection(localId);
    return selection.utility ?? UTILITY_CONFIGS.HE_GRENADE;
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
        }
        this.pickupCooldownUntil = now + 100; // 100ms Debounce
        return; // Maximal 1 Pickup-Request pro Check
      }
    }
  }
}
