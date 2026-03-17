import Phaser from 'phaser';
import { bridge }              from '../network/bridge';
import { ArenaBuilder }        from '../arena/ArenaBuilder';
import type { ArenaBuilderResult } from '../arena/ArenaBuilder';
import { ArenaGenerator }      from '../arena/ArenaGenerator';
import { RockRegistry }        from '../arena/RockRegistry';
import { PlayerManager }       from '../entities/PlayerManager';
import { ProjectileManager }   from '../entities/ProjectileManager';
import { InputSystem }         from '../systems/InputSystem';
import { HostPhysicsSystem }   from '../systems/HostPhysicsSystem';
import { CombatSystem }        from '../systems/CombatSystem';
import { ResourceSystem }      from '../systems/ResourceSystem';
import { BurrowSystem }        from '../systems/BurrowSystem';
import { LoadoutManager }      from '../loadout/LoadoutManager';
import type { LoadoutSelection } from '../loadout/LoadoutManager';
import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../loadout/LoadoutConfig';
import type { WeaponConfig }   from '../loadout/LoadoutConfig';
import { EffectSystem }        from '../effects/EffectSystem';
import { SmokeSystem }         from '../effects/SmokeSystem';
import { FireSystem }          from '../effects/FireSystem';
import { PowerUpSystem }        from '../powerups/PowerUpSystem';
import { POWERUP_DEFS, POWERUP_RENDER_SIZE, PICKUP_RADIUS, TRAIN_DROP_COUNT } from '../powerups/PowerUpConfig';
import { DetonationSystem }    from '../systems/DetonationSystem';
import { TrainManager }        from '../train/TrainManager';
import { TrainRenderer }       from '../train/TrainRenderer';
import { TRAIN }               from '../train/TrainConfig';
import { LeftSidePanel }       from '../ui/LeftSidePanel';
import { RightSidePanel }      from '../ui/RightSidePanel';
import { AimSystem }           from '../ui/AimSystem';
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
} from '../config';
import { isVelocityMoving } from '../loadout/SpreadMath';


export class ArenaScene extends Phaser.Scene {
  private playerManager!:     PlayerManager;
  private projectileManager!: ProjectileManager;
  private combatSystem!:      CombatSystem;
  private effectSystem!:      EffectSystem;
  private smokeSystem!:       SmokeSystem;
  private fireSystem!:        FireSystem;
  private inputSystem!:       InputSystem;
  private hostPhysics!:       HostPhysicsSystem;
  private lobbyOverlay!:      LobbyOverlay;

  // ── HUD / Aim ─────────────────────────────────────────────────────────────
  private leftPanel!:  LeftSidePanel;
  private rightPanel!: RightSidePanel;
  private aimSystem:   AimSystem | null = null;
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
  private trainSpawned          = false;
  private trainDestroyedShown   = false;

  // ── Client-seitiges PowerUp-Rendering ───────────────────────────────────────
  /**
   * Container je UID: enthält [0] Glow-Kreis (Arc) und [1] Grafik (Image/Rectangle).
   * Container.destroy(true) räumt Kinder + deren Tweens automatisch auf.
   */
  private powerUpSprites = new Map<number, Phaser.GameObjects.Container>();
  private pickupCooldownUntil = 0; // Spam-Schutz für Pickup-RPC
  // ── State Machine ─────────────────────────────────────────────────────────
  private isLocalReady      = false;
  private lastPhase: GamePhase = 'LOBBY';
  private roundStartPending = false;
  /**
   * Wird true wenn der Host während eines laufenden Matches disconnectet.
   * Sperrt die Arena-Simulation bis die Netzwerkphase auf 'LOBBY' wechselt.
   */
  private matchTerminated   = false;
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
  }

  create(): void {
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
    this.inputSystem.setupLoadoutListener((slot, angle, targetX, targetY) => {
      let shotId: number | undefined;
      if (slot === 'weapon1' || slot === 'weapon2') {
        this.aimSystem?.notifyShot(slot);
        shotId = this.playPredictedLocalHitscanTracer(slot, angle, targetX, targetY);
      }
      bridge.sendLoadoutUse(slot, angle, targetX, targetY, shotId);
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

    // ── 9. Loadout-RPC-Handler (Dispatch an LoadoutManager auf Host) ──────
    bridge.registerLoadoutUseHandler((slot, angle, targetX, targetY, senderId, shotId) => {
      if (!bridge.isHost()) return;
      if (bridge.isArenaCountdownActive()) return;
      this.loadoutManager?.use(slot, senderId, angle, targetX, targetY, Date.now(), shotId);
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
      this.combatSystem.setBurrowSystem(this.burrowSystem);
      this.combatSystem.setResourceSystem(this.resourceSystem);
      this.combatSystem.setLoadoutManager(this.loadoutManager);

      // PowerUpSystem initialisieren
      this.powerUpSystem = new PowerUpSystem(this.playerManager, this.combatSystem, layout);
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
      // Gleisspalte aus dem Layout lesen (erste TrackCell → gridX)
      const trackCell = layout.tracks?.[0];
      if (trackCell !== undefined) {
        const trackX  = ARENA_OFFSET_X + trackCell.gridX * CELL_SIZE + CELL_SIZE / 2;
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
    }

    // ── TrainRenderer (alle Clients inkl. Host) ──────────────────────────────
    this.trainRenderer = new TrainRenderer(this);
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
    this.combatSystem.setKillCallback(() => { /* noop */ });
    this.hostPhysics.setBurrowSystem(null);
    this.hostPhysics.setLoadoutManager(null);
    this.projectileManager.setRockGroup(null, null, null);
    this.hostPhysics.setRockGroup(null, null);

    // Client-seitige PowerUp-Container aufräumen (destroy(true) räumt Kinder + Tweens mit auf)
    for (const container of this.powerUpSprites.values()) container.destroy(true);
    this.powerUpSprites.clear();

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
        this.runClientUpdate();
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
                 && !this.localPlayerBurrowed;
    this.aimSystem?.update(showAim, inArena, delta);
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
      : this.projectileManager.hostUpdate();
    const hitscanTraces = countdownActive
      ? []
      : this.combatSystem.collectReplicatedHitscanTraces(Date.now());
    const meleeSwings = countdownActive
      ? []
      : this.combatSystem.collectReplicatedMeleeSwings(Date.now());

    // Detonations-Ereignisse verarbeiten (ASMD Secondary Ball, zukünftige Raketen, …)
    const detonations = countdownActive ? [] : (this.detonationSystem?.flushDetonations() ?? []);
    for (const det of detonations) {
      this.combatSystem.applyAoeDamage(
        det.x, det.y, det.effect.aoeRadius, det.effect.aoeDamage, det.detonatorOwnerId,
      );
      // Explosion in Spielerfarbe des Auslösers (z.B. Roter Spieler zündet grünen Ball → rote Explosion)
      const detonatorColor = bridge.getPlayerColor(det.detonatorOwnerId);
      bridge.broadcastExplosionEffect(det.x, det.y, det.effect.aoeRadius, detonatorColor);
    }

    // Granaten-Explosionen verarbeiten
    for (const g of explodedGrenades) {
      if (g.effect.type === 'damage') {
        this.combatSystem.applyAoeDamage(g.x, g.y, g.effect.radius, g.effect.damage, g.ownerId);
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
    }

    // ── Zug-Update (Host) ─────────────────────────────────────────────────────
    if (!countdownActive && this.trainManager) {
      if (!this.trainSpawned) {
        const trainEvent = bridge.getTrainEvent();
        if (trainEvent && Date.now() >= trainEvent.spawnAt) {
          this.trainManager.spawn();
          this.trainSpawned = true;
        }
      }
      if (this.trainSpawned) {
        this.trainManager.update(delta);
      }
    }

    const rocks   = this.rockRegistry?.getNetSnapshot() ?? [];

    for (const trace of hitscanTraces) {
      this.effectSystem.playSyncedHitscanTracer(trace);
    }
    for (const swing of meleeSwings) {
      this.effectSystem.playSyncedMeleeSwing(swing);
    }

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

      players[player.id] = {
        x: player.sprite.x,
        y: player.sprite.y,
        hp,
        alive,
        adrenaline,
        rage,
        isBurrowed,
        isStunned,
        isRaging,
        aim,
      };

      player.updateHP(hp);
      player.setVisible(alive);
      player.setRageTint(isRaging);
      player.syncBar();
    }

    const powerups = this.powerUpSystem?.getNetSnapshot() ?? [];
    const train    = this.trainManager?.getNetSnapshot() ?? null;
    bridge.publishGameState({ players, projectiles, rocks, hitscanTraces, meleeSwings, smokes, fires, powerups, train });

    // Zug-Renderer auf dem Host direkt aktualisieren (kein Client-Update-Pfad)
    this.trainRenderer?.update(train);

    // PowerUp-Sprites auch auf dem Host rendern + Pickup prüfen
    this.syncPowerUpSprites(powerups);
    this.checkLocalPickup(powerups);

    // HUD des lokalen Host-Spielers aktualisieren
    const localId = bridge.getLocalPlayerId();
    if (players[localId]) {
      const ls = players[localId];
      this.aimSystem?.setAuthoritativeState(ls.aim);
      this.inputSystem.setLocalState(ls.isStunned, ls.isBurrowed);
      this.leftPanel.updateResources(ls.adrenaline, ls.rage, this.inputSystem.getDashCooldownFrac());
      this.localPlayerAlive    = ls.alive;
      this.localPlayerBurrowed = ls.isBurrowed;
    }
  }

  // ── Client-Update ────────────────────────────────────────────────────────

  private runClientUpdate(): void {
    const state = bridge.getLatestGameState();
    if (!state) return;

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

      player.setTargetPosition(ps.x, ps.y);
      player.updateHP(ps.hp);
      player.setVisible(ps.alive);
      player.setBurrowVisual(ps.isBurrowed);
      player.setRageTint(ps.isRaging);
    }

    const LERP_FACTOR = 0.2;
    for (const player of this.playerManager.getAllPlayers()) {
      player.lerpStep(LERP_FACTOR);
    }

    this.projectileManager.clientSyncVisuals(state.projectiles);
    this.smokeSystem.syncVisuals(state.smokes);
    this.fireSystem.syncVisuals(state.fires ?? []);
    for (const trace of state.hitscanTraces) {
      this.effectSystem.playSyncedHitscanTracer(trace);
    }
    for (const swing of state.meleeSwings ?? []) {
      this.effectSystem.playSyncedMeleeSwing(swing);
    }

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

    // ── Zug-Renderer aktualisieren ────────────────────────────────────────
    this.trainRenderer?.update(state.train ?? null);

    // ── PowerUp-Sprites synchronisieren ──────────────────────────────────
    this.syncPowerUpSprites(state.powerups ?? []);

    // ── Lokaler Pickup-Check ─────────────────────────────────────────────
    this.checkLocalPickup(state.powerups ?? []);

    const localId    = bridge.getLocalPlayerId();
    const localState = state.players[localId];
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

  private getLocalWeaponConfig(slot: WeaponSlot): WeaponConfig {
    const localId = bridge.getLocalPlayerId();
    const equipped = this.loadoutManager?.getEquippedWeaponConfig(localId, slot);
    if (equipped) return equipped;

    const selection = this.resolveLoadoutSelection(localId);
    return selection[slot] ?? (slot === 'weapon1' ? WEAPON_CONFIGS.GLOCK : WEAPON_CONFIGS.P90);
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

    const localSprite = this.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
    if (!localSprite) return undefined;

    const shotId = this.nextPredictedHitscanShotId++;
    const trace = this.combatSystem.traceHitscan({
      shooterId: bridge.getLocalPlayerId(),
      startX: localSprite.x,
      startY: localSprite.y,
      angle,
      range: config.range,
      traceThickness: config.fire.traceThickness,
      applyFavorTheShooter: bridge.isHost(),
    });

    this.effectSystem.playPredictedHitscanTracer(
      localSprite.x,
      localSprite.y,
      trace.endX,
      trace.endY,
      localSprite.fillColor,
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

  // ── Power-Up-Rendering (Host + Client) ─────────────────────────────────

  /**
   * Synchronisiert die sichtbaren PowerUp-Container mit dem aktuellen Netzwerk-Snapshot.
   *
   * Aufbau je Container (Schicht-Reihenfolge = Render-Reihenfolge):
   *   [0] Image | Rectangle – die eigentliche Grafik (feste Größe)
   *       └─ preFX.addGlow()  – Pixel-Lichtaura direkt an der Grafikkante,
   *                             outerStrength pulsiert via Tween
   *
   * Der preFX-Glow rendert die Aura hinter dem Sprite-Pixel, die Grafik bleibt
   * immer sichtbar vorne. Der Glow-Tween-Cleanup erfolgt über das destroy-Event
   * der Grafik – keine separate Tween-Map nötig.
   * Container.destroy(true) räumt Grafik + deren Tweens automatisch auf.
   */
  private syncPowerUpSprites(powerups: import('../types').SyncedPowerUp[]): void {
    const activeUids = new Set<number>();

    for (const pu of powerups) {
      activeUids.add(pu.uid);
      if (this.powerUpSprites.has(pu.uid)) {
        this.powerUpSprites.get(pu.uid)!.setPosition(pu.x, pu.y);
        continue;
      }

      const def       = POWERUP_DEFS[pu.defId];
      const glowColor = def?.color ?? 0xffffff;
      // Deterministischer Phasen-Offset: Items pulsieren leicht gegeneinander versetzt
      const phaseMs   = (pu.uid * 137) % 1400;

      // ── Container ─────────────────────────────────────────────────────────
      const container = this.add.container(pu.x, pu.y);
      container.setDepth(DEPTH.PLAYERS - 1);

      // ── Grafik: feste Größe, kein Scale-Tween ─────────────────────────────
      const graphic: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle =
        def?.spriteKey
          ? this.add.image(0, 0, def.spriteKey).setDisplaySize(POWERUP_RENDER_SIZE, POWERUP_RENDER_SIZE)
          : this.add.rectangle(0, 0, POWERUP_RENDER_SIZE, POWERUP_RENDER_SIZE, glowColor);
      container.add(graphic);

      // ── preFX-Glow: Pixel-Aura, outerStrength pulsiert ───────────────────
      const glow = graphic.preFX?.addGlow(glowColor, 2, 0, false, 0.1, 14);
      if (glow) {
        const glowTween = this.tweens.add({
          targets:       glow,
          outerStrength: { from: 2, to: 8 },
          duration:      900,
          yoyo:          true,
          repeat:        -1,
          ease:          'Sine.easeInOut',
          delay:         phaseMs,
        });
        // Tween-Cleanup ohne separate Map: destroy-Event der Grafik abfangen
        graphic.once(Phaser.GameObjects.Events.DESTROY, () => glowTween.stop());
      }

      this.powerUpSprites.set(pu.uid, container);
    }

    // Entfernte Items aufräumen
    for (const [uid, container] of this.powerUpSprites) {
      if (!activeUids.has(uid)) {
        container.destroy(true); // Kinder (Arc, Grafik) + deren Tweens werden mitgelöscht
        this.powerUpSprites.delete(uid);
      }
    }
  }

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
