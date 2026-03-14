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
import { EffectSystem }        from '../effects/EffectSystem';
import { ResourceHUD }         from '../ui/ResourceHUD';
import { LobbyOverlay }        from './LobbyOverlay';
import type { PlayerNetState, GamePhase, PlayerProfile } from '../types';
import {
  GAME_WIDTH, ARENA_DURATION_SEC,
  ROCK_DAMAGE_PER_HIT,
} from '../config';

// ── HUD-Konstanten ────────────────────────────────────────────────────────────
const HUD_Y               = 28;
const TIMER_COLOR_NORMAL  = '#e0e0e0';
const TIMER_COLOR_WARNING = '#ff4444';

export class ArenaScene extends Phaser.Scene {
  private playerManager!:     PlayerManager;
  private projectileManager!: ProjectileManager;
  private combatSystem!:      CombatSystem;
  private effectSystem!:      EffectSystem;
  private inputSystem!:       InputSystem;
  private hostPhysics!:       HostPhysicsSystem;
  private lobbyOverlay!:      LobbyOverlay;

  // ── HUD ──────────────────────────────────────────────────────────────────
  private timerText!: Phaser.GameObjects.Text;
  private resourceHUD: ResourceHUD | null = null;

  // ── Dynamische Arena ──────────────────────────────────────────────────────
  private arenaResult:  ArenaBuilderResult | null = null;
  private rockRegistry: RockRegistry | null       = null;

  // ── Host-only Systeme ─────────────────────────────────────────────────────
  private resourceSystem: ResourceSystem | null = null;
  private burrowSystem:   BurrowSystem   | null = null;
  private loadoutManager: LoadoutManager | null = null;

  // ── State Machine ─────────────────────────────────────────────────────────
  private isLocalReady      = false;
  private lastPhase: GamePhase = 'LOBBY';
  private roundStartPending = false;
  /**
   * Wird true wenn der Host während eines laufenden Matches disconnectet.
   * Sperrt die Arena-Simulation bis die Netzwerkphase auf 'LOBBY' wechselt.
   */
  private matchTerminated   = false;

  constructor() {
    super({ key: 'ArenaScene' });
  }

  preload(): void {
    this.load.image('bg_grass', 'assets/sprites/32x32grass01.png');
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
    this.effectSystem.setup();

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
      bridge.sendLoadoutUse(slot, angle, targetX, targetY);
    });

    // ── 8. Ressourcen-HUD ─────────────────────────────────────────────────
    this.resourceHUD = new ResourceHUD(this);

    // ── 9. Loadout-RPC-Handler (Dispatch an LoadoutManager auf Host) ──────
    bridge.registerLoadoutUseHandler((slot, angle, targetX, targetY, senderId) => {
      if (!bridge.isHost()) return;
      this.loadoutManager?.use(slot, senderId, angle, targetX, targetY, Date.now());
    });

    // ── 10. Explosions-Effekt-RPC (alle Clients inkl. Host) ───────────────
    bridge.registerExplosionEffectHandler((x, y, radius) => {
      this.effectSystem.playExplosionEffect(x, y, radius);
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

    // ── 13. Netzwerk-Callbacks ────────────────────────────────────────────
    bridge.onPlayerJoin(profile => this.onPlayerJoined(profile));
    bridge.onPlayerQuit(id      => this.onPlayerLeft(id));

    // ── 14. HUD erstellen ─────────────────────────────────────────────────
    this.createHUD();

    // ── 15. Lobby-Overlay erstellen und anzeigen ──────────────────────────
    this.lobbyOverlay = new LobbyOverlay(this, bridge, () => this.onReadyToggled());
    this.lobbyOverlay.build();
    this.lobbyOverlay.show();

    // ── 16. Eigenen Ready-Status hart zurücksetzen ────────────────────────
    this.isLocalReady = false;
    bridge.setLocalReady(false);

    // ── 17. Initiale Phase lesen (Spät-Joiner-Support) ────────────────────
    this.lastPhase = bridge.getGamePhase();
  }

  // ── Netzwerk-Events ───────────────────────────────────────────────────────

  private onPlayerJoined(_profile: PlayerProfile): void {
    // Nur protokollieren – kein Entity-Spawn. Spawn erfolgt wenn isReady === true.
  }

  private onPlayerLeft(id: string): void {
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
          this.loadoutManager?.assignDefaultLoadout(profile.id);
        }
      }
    }

    this.resourceHUD?.setVisible(true);
    this.lobbyOverlay.lockButton();
    this.lobbyOverlay.hide();
  }

  private onTransitionToLobby(): void {
    this.isLocalReady = false;
    bridge.setLocalReady(false);
    this.roundStartPending = false;

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

    this.resourceHUD?.setVisible(false);
    this.lobbyOverlay.setReadyButtonState(false);
    this.lobbyOverlay.show();
  }

  private hostCheckReadyToStart(): void {
    if (this.roundStartPending || !bridge.areAllPlayersReady()) return;
    this.roundStartPending = true;
    this.lobbyOverlay.lockButton();
    bridge.setMatchHostId();
    const layout = ArenaGenerator.generate(Date.now());
    bridge.publishArenaLayout(layout);
    bridge.setRoundEndTime(Date.now() + ARENA_DURATION_SEC * 1000);
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
        this.loadoutManager?.assignDefaultLoadout(profile.id);
      }
    }
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
      this.combatSystem.setBurrowSystem(this.burrowSystem);
      this.combatSystem.setResourceSystem(this.resourceSystem);
      this.combatSystem.setLoadoutManager(this.loadoutManager);

      this.hostPhysics.setBurrowSystem(this.burrowSystem);
      this.hostPhysics.setLoadoutManager(this.loadoutManager);

      // Dash-RPC: Client → Host
      bridge.registerDashHandler((playerId, dx, dy) => {
        this.hostPhysics.handleDashRPC(playerId, dx, dy);
      });

      // Burrow-RPC: Client → Host
      bridge.registerBurrowHandler((playerId, wantsBurrowed) => {
        this.burrowSystem?.handleBurrowRequest(playerId, wantsBurrowed);
      });

      // RockRegistry nur auf dem Host
      this.rockRegistry = new RockRegistry(layout);
      const arenaResult  = this.arenaResult;

      this.projectileManager.setRockHitCallback((rockId) => {
        if (!this.rockRegistry || !arenaResult) return;
        const newHp = this.rockRegistry.applyDamage(rockId, ROCK_DAMAGE_PER_HIT);
        ArenaBuilder.updateRockVisual(arenaResult.rockObjects, arenaResult.rockGroup, rockId, newHp);
      });
    }
  }

  private tearDownArena(): void {
    if (this.arenaResult) {
      ArenaBuilder.destroyDynamic(this.arenaResult);
      this.arenaResult = null;
    }
    this.rockRegistry   = null;
    this.resourceSystem = null;
    this.burrowSystem   = null;
    this.loadoutManager = null;
    this.combatSystem.setBurrowSystem(null);
    this.combatSystem.setResourceSystem(null);
    this.combatSystem.setLoadoutManager(null);
    this.hostPhysics.setBurrowSystem(null);
    this.hostPhysics.setLoadoutManager(null);
    this.projectileManager.setRockGroup(null, null, null);
    this.hostPhysics.setRockGroup(null, null);
  }

  // ── HUD ──────────────────────────────────────────────────────────────────

  private createHUD(): void {
    this.add.rectangle(GAME_WIDTH / 2, HUD_Y, 200, 44, 0x000000, 0.2).setDepth(50).setScrollFactor(0);
    this.timerText = this.add.text(GAME_WIDTH / 2, HUD_Y, '2:00', {
      fontSize:   '32px',
      fontFamily: 'monospace',
      color:      TIMER_COLOR_NORMAL,
      fontStyle:  'bold',
    }).setOrigin(0.5).setDepth(51).setScrollFactor(0);
  }

  private updateTimerDisplay(secs: number): void {
    const mm  = Math.floor(secs / 60);
    const ss  = secs % 60;
    const str = `${mm}:${ss.toString().padStart(2, '0')}`;
    this.timerText.setText(str);
    this.timerText.setColor(secs <= 10 ? TIMER_COLOR_WARNING : TIMER_COLOR_NORMAL);
  }

  // ── Update ───────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    this.detectPhaseChange();

    const phase  = bridge.getGamePhase();
    const inGame = phase === 'ARENA';

    if (inGame) {
      this.inputSystem.update();
    }

    if (!this.matchTerminated && phase === 'LOBBY') {
      if (!this.lobbyOverlay.isVisible()) this.lobbyOverlay.show();
      this.lobbyOverlay.refreshPlayerList(bridge.getConnectedPlayers());
      if (bridge.isHost()) this.hostCheckReadyToStart();
    } else if (!this.matchTerminated && this.lobbyOverlay.isVisible()) {
      this.lobbyOverlay.hide();
    }

    if (phase === 'ARENA' && !this.matchTerminated) {
      const secs = bridge.computeSecondsLeft();
      this.updateTimerDisplay(secs);

      if (bridge.isHost()) {
        this.spawnReadyPlayers();
        this.runHostUpdate(delta);
        if (secs <= 0) bridge.setGamePhase('LOBBY');
      } else {
        this.runClientUpdate();
      }

      if (this.arenaResult) {
        const localSprite = this.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite ?? null;
        ArenaBuilder.updateCanopyTransparency(this.arenaResult.canopyObjects, localSprite);
      }
    }
  }

  // ── Host-Update ──────────────────────────────────────────────────────────

  private runHostUpdate(delta: number): void {
    // Ressourcen- und Burrow-Systeme ticken
    if (this.resourceSystem && this.burrowSystem) {
      for (const player of this.playerManager.getAllPlayers()) {
        if (!this.burrowSystem.isBurrowed(player.id)) {
          this.resourceSystem.regenTick(player.id, delta);
        }
      }
      this.burrowSystem.update(delta);
    }

    // LoadoutManager ticken (Rage-Drain, Ultimate-Ablauf)
    this.loadoutManager?.update(delta);

    this.hostPhysics.update();
    this.combatSystem.update();

    const { synced: projectiles, explodedGrenades } = this.projectileManager.hostUpdate();

    // Granaten-Explosionen verarbeiten
    for (const g of explodedGrenades) {
      this.combatSystem.applyAoeDamage(g.x, g.y, g.aoeRadius, g.aoeDamage, g.ownerId);
      bridge.broadcastExplosionEffect(g.x, g.y, g.aoeRadius);
    }

    const rocks   = this.rockRegistry?.getNetSnapshot() ?? [];

    const players: Record<string, PlayerNetState> = {};
    for (const player of this.playerManager.getAllPlayers()) {
      const hp         = this.combatSystem.getHP(player.id);
      const alive      = this.combatSystem.isAlive(player.id);
      const adrenaline = this.resourceSystem?.getAdrenaline(player.id) ?? 0;
      const rage       = this.resourceSystem?.getRage(player.id) ?? 0;
      const isBurrowed = this.burrowSystem?.isBurrowed(player.id) ?? false;
      const isStunned  = this.burrowSystem?.isStunned(player.id)  ?? false;
      const isRaging   = this.loadoutManager?.isUltimateActive(player.id) ?? false;

      players[player.id] = { x: player.sprite.x, y: player.sprite.y, hp, alive, adrenaline, rage, isBurrowed, isStunned, isRaging };

      player.updateHP(hp);
      player.setVisible(alive);
      player.syncBar();
    }

    bridge.publishGameState({ players, projectiles, rocks });

    // HUD des lokalen Host-Spielers aktualisieren
    const localId = bridge.getLocalPlayerId();
    if (players[localId]) {
      const ls = players[localId];
      this.inputSystem.setLocalState(ls.isStunned, ls.isBurrowed);
      this.resourceHUD?.update(ls.adrenaline, ls.rage, this.inputSystem.getDashCooldownFrac());
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

    const localId    = bridge.getLocalPlayerId();
    const localState = state.players[localId];
    if (localState) {
      this.inputSystem.setLocalState(localState.isStunned, localState.isBurrowed);
      this.resourceHUD?.update(
        localState.adrenaline,
        localState.rage,
        this.inputSystem.getDashCooldownFrac(),
      );
    }
  }
}
