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
import { ShootingSystem }      from '../systems/ShootingSystem';
import { CombatSystem }        from '../systems/CombatSystem';
import { EffectSystem }        from '../effects/EffectSystem';
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
  private shootingSystem!:    ShootingSystem;
  private lobbyOverlay!:      LobbyOverlay;

  // ── HUD ──────────────────────────────────────────────────────────────────
  private timerText!: Phaser.GameObjects.Text;

  // ── Dynamische Arena ──────────────────────────────────────────────────────
  private arenaResult:  ArenaBuilderResult | null = null;
  private rockRegistry: RockRegistry | null       = null;

  // ── State Machine ─────────────────────────────────────────────────────────
  private isLocalReady      = false;
  private lastPhase: GamePhase = 'LOBBY';
  private roundStartPending = false;
  /**
   * Wird true wenn der Host während eines laufenden Matches disconnectet.
   * Sperrt die Arena-Simulation und refreshPlayerList() bis die Netzwerkphase
   * auf 'LOBBY' gewechselt ist (neuer Host setzt sie zurück).
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

    // ── 6. Schuss-System ──────────────────────────────────────────────────
    this.shootingSystem = new ShootingSystem(bridge, this.playerManager, this.projectileManager);
    this.shootingSystem.setup();

    // ── 7. Host-Physik (ohne rockGroup – wird nach Arena-Aufbau injiziert) ─
    this.hostPhysics = new HostPhysicsSystem(
      this, this.playerManager, bridge, this.combatSystem,
    );

    // ── 8. Input ──────────────────────────────────────────────────────────
    this.inputSystem = new InputSystem(
      this,
      bridge,
      () => this.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
    );
    this.inputSystem.setup();
    this.inputSystem.setupShootListener(angle => this.shootingSystem.fireShot(angle));

    // ── 9. Netzwerk-Callbacks ─────────────────────────────────────────────
    bridge.onPlayerJoin(profile => this.onPlayerJoined(profile));
    bridge.onPlayerQuit(id      => this.onPlayerLeft(id));

    // ── 10. HUD erstellen ─────────────────────────────────────────────────
    this.createHUD();

    // ── 11. Lobby-Overlay erstellen und anzeigen ──────────────────────────
    this.lobbyOverlay = new LobbyOverlay(this, bridge, () => this.onReadyToggled());
    this.lobbyOverlay.build();
    this.lobbyOverlay.show();

    // ── 12. Eigenen Ready-Status hart zurücksetzen ────────────────────────
    this.isLocalReady = false;
    bridge.setLocalReady(false);

    // ── 13. Initiale Phase lesen (Spät-Joiner-Support) ────────────────────
    this.lastPhase = bridge.getGamePhase();
  }

  // ── Netzwerk-Events ───────────────────────────────────────────────────────

  private onPlayerJoined(_profile: PlayerProfile): void {
    // Nur protokollieren – kein Entity-Spawn. Spawn erfolgt wenn isReady === true.
  }

  private onPlayerLeft(id: string): void {
    if (this.playerManager.hasPlayer(id)) {
      this.combatSystem.removePlayer(id);
      this.hostPhysics.removePlayer(id);
      this.playerManager.removePlayer(id);
    }
    // Host-Disconnect während eines laufenden Matches → Match sofort beenden
    if (bridge.getGamePhase() === 'ARENA' && id === bridge.getMatchHostId()) {
      this.terminateMatch();
    }
  }

  /**
   * Beendet das laufende Match sofort (z. B. weil der Host disconnectet ist).
   */
  private terminateMatch(): void {
    if (this.matchTerminated) return;
    this.matchTerminated = true;

    this.isLocalReady    = false;
    bridge.setLocalReady(false);
    this.roundStartPending = false;

    for (const p of [...this.playerManager.getAllPlayers()]) {
      if (bridge.isHost()) this.combatSystem.removePlayer(p.id);
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
      // Reliable-State sollte bereits da sein; kurze Retry-Verzögerung als Absicherung
      this.time.delayedCall(16, () => this.onTransitionToArena());
      return;
    }

    // Dynamische Arena aufbauen
    this.buildArena(layout);

    // Bereits bereite Spieler spawnen
    for (const profile of bridge.getConnectedPlayers()) {
      if (bridge.getPlayerReady(profile.id) && !this.playerManager.hasPlayer(profile.id)) {
        this.playerManager.addPlayer(profile);
        if (bridge.isHost()) this.combatSystem.initPlayer(profile.id);
      }
    }
    this.lobbyOverlay.hide();
  }

  private onTransitionToLobby(): void {
    this.isLocalReady = false;
    bridge.setLocalReady(false);
    this.roundStartPending = false;

    for (const p of [...this.playerManager.getAllPlayers()]) {
      if (bridge.isHost()) this.combatSystem.removePlayer(p.id);
      this.playerManager.removePlayer(p.id);
    }

    this.tearDownArena();

    this.lobbyOverlay.setReadyButtonState(false);
    this.lobbyOverlay.show();
  }

  /** Host-only: Prüft ob alle Spieler bereit sind und startet die Runde. */
  private hostCheckReadyToStart(): void {
    if (this.roundStartPending || !bridge.areAllPlayersReady()) return;
    this.roundStartPending = true;
    this.lobbyOverlay.lockButton();
    // Host-ID publizieren bevor die Phase wechselt
    bridge.setMatchHostId();
    // Layout generieren und publizieren (reliable → Client bekommt es vor Phase-Wechsel)
    const layout = ArenaGenerator.generate(Date.now());
    bridge.publishArenaLayout(layout);
    // Rundenende nach Layout setzen, Phasenwechsel zuletzt
    bridge.setRoundEndTime(Date.now() + ARENA_DURATION_SEC * 1000);
    bridge.setGamePhase('ARENA');
  }

  /** Host: Spawnt Spieler die isReady === true sind und noch keine Entity haben. */
  private spawnReadyPlayers(): void {
    if (!bridge.isHost()) return;
    for (const profile of bridge.getConnectedPlayers()) {
      if (bridge.getPlayerReady(profile.id) && !this.playerManager.hasPlayer(profile.id)) {
        this.playerManager.addPlayer(profile);
        this.combatSystem.initPlayer(profile.id);
      }
    }
  }

  // ── Arena Aufbau / Teardown ───────────────────────────────────────────────

  private buildArena(layout: import('../types').ArenaLayout): void {
    // Sicherheits-Teardown (sollte in normalem Flow leer sein)
    this.tearDownArena();

    const builder = new ArenaBuilder(this);
    this.arenaResult = builder.buildDynamic(layout);

    // Layout in PlayerManager eintragen (für dynamische Spawn-Punkte)
    this.playerManager.setLayout(layout);

    // Gruppen an Physik-Systeme weitergeben
    this.projectileManager.setRockGroup(
      this.arenaResult.rockGroup,
      this.arenaResult.rockObjects,
      this.arenaResult.trunkGroup,
    );
    this.hostPhysics.setRockGroup(
      this.arenaResult.rockGroup,
      this.arenaResult.trunkGroup,
    );

    // RockRegistry nur auf dem Host initialisieren
    if (bridge.isHost()) {
      this.rockRegistry = new RockRegistry(layout);
      const arenaResult  = this.arenaResult;  // Closure-Referenz sichern

      this.projectileManager.setRockHitCallback((rockId) => {
        if (!this.rockRegistry || !arenaResult) return;
        const newHp = this.rockRegistry.applyDamage(rockId, ROCK_DAMAGE_PER_HIT);
        // Fels-Visual sofort auf dem Host aktualisieren.
        // remove() wird NICHT aufgerufen: hp=0 bleibt im Snapshot, damit Clients
        // in runClientUpdate() destroyRock() auslösen können.
        ArenaBuilder.updateRockVisual(arenaResult.rockObjects, arenaResult.rockGroup, rockId, newHp);
      });
    }
  }

  private tearDownArena(): void {
    if (this.arenaResult) {
      ArenaBuilder.destroyDynamic(this.arenaResult);
      this.arenaResult = null;
    }
    this.rockRegistry = null;
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

  update(): void {
    this.detectPhaseChange();

    const phase      = bridge.getGamePhase();
    const localReady = this.isLocalReady;
    const inGame     = phase === 'ARENA' && localReady;

    if (inGame) {
      this.inputSystem.update();
    }

    if (!this.matchTerminated && (phase === 'LOBBY' || !localReady)) {
      if (!this.lobbyOverlay.isVisible()) this.lobbyOverlay.show();
      this.lobbyOverlay.refreshPlayerList(bridge.getConnectedPlayers());
      if (phase === 'LOBBY' && bridge.isHost()) this.hostCheckReadyToStart();
    } else if (!this.matchTerminated && this.lobbyOverlay.isVisible()) {
      this.lobbyOverlay.hide();
    }

    if (phase === 'ARENA' && !this.matchTerminated) {
      const secs = bridge.computeSecondsLeft();
      this.updateTimerDisplay(secs);

      if (bridge.isHost()) {
        this.spawnReadyPlayers();
        this.runHostUpdate();
        if (secs <= 0) bridge.setGamePhase('LOBBY');
      } else {
        this.runClientUpdate();
      }

      // Canopy-Transparenz – nur für den lokalen Spieler, jede Frame lokal berechnet
      if (this.arenaResult) {
        const localSprite = this.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite ?? null;
        ArenaBuilder.updateCanopyTransparency(this.arenaResult.canopyObjects, localSprite);
      }
    }
  }

  // ── Host-Update ──────────────────────────────────────────────────────────

  private runHostUpdate(): void {
    this.hostPhysics.update();
    this.combatSystem.update();

    const projectiles = this.projectileManager.hostUpdate();
    const rocks       = this.rockRegistry?.getNetSnapshot() ?? [];

    const players: Record<string, PlayerNetState> = {};
    for (const player of this.playerManager.getAllPlayers()) {
      const hp    = this.combatSystem.getHP(player.id);
      const alive = this.combatSystem.isAlive(player.id);
      players[player.id] = { x: player.sprite.x, y: player.sprite.y, hp, alive };

      player.updateHP(hp);
      player.setVisible(alive);
      player.syncBar();
    }

    bridge.publishGameState({ players, projectiles, rocks });
  }

  // ── Client-Update ────────────────────────────────────────────────────────

  private runClientUpdate(): void {
    const state = bridge.getLatestGameState();
    if (!state) return;

    // Entities lazy erstellen wenn der Host Daten für einen Spieler sendet
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
    }

    // Spielerpositionen zur Zielposition interpolieren
    const LERP_FACTOR = 0.2;
    for (const player of this.playerManager.getAllPlayers()) {
      player.lerpStep(LERP_FACTOR);
    }

    this.projectileManager.clientSyncVisuals(state.projectiles);

    // Rock-HP-Sync: beschädigte Felsen visuell aktualisieren
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
  }
}
