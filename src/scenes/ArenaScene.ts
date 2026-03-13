import Phaser from 'phaser';
import { bridge }              from '../network/bridge';
import { ArenaBuilder }        from '../arena/ArenaBuilder';
import { PlayerManager }       from '../entities/PlayerManager';
import { ProjectileManager }   from '../entities/ProjectileManager';
import { InputSystem }         from '../systems/InputSystem';
import { HostPhysicsSystem }   from '../systems/HostPhysicsSystem';
import { ShootingSystem }      from '../systems/ShootingSystem';
import { CombatSystem }        from '../systems/CombatSystem';
import { EffectSystem }        from '../effects/EffectSystem';
import { LobbyOverlay }        from './LobbyOverlay';
import type { PlayerNetState, GamePhase, PlayerProfile } from '../types';
import { GAME_WIDTH, ARENA_DURATION_SEC } from '../config';

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

  // ── State Machine ─────────────────────────────────────────────────────────
  private isLocalReady      = false;
  private lastPhase: GamePhase = 'LOBBY';
  private roundStartPending = false;

  constructor() {
    super({ key: 'ArenaScene' });
  }

  create(): void {
    // Alte Szenen-Callbacks löschen, neue registrieren
    bridge.clearPlayerCallbacks();

    // ── 1. Arena ──────────────────────────────────────────────────────────
    const rockGroup = new ArenaBuilder(this).build();

    // ── 2. Spieler-System ─────────────────────────────────────────────────
    this.playerManager = new PlayerManager(this);

    // ── 3. Projektile ─────────────────────────────────────────────────────
    this.projectileManager = new ProjectileManager(this, rockGroup);

    // ── 4. Combat-System ──────────────────────────────────────────────────
    this.combatSystem = new CombatSystem(this.playerManager, this.projectileManager, bridge);

    // ── 5. Effekt-System ──────────────────────────────────────────────────
    this.effectSystem = new EffectSystem(this, bridge);
    this.effectSystem.setup();

    // ── 6. Schuss-System ──────────────────────────────────────────────────
    this.shootingSystem = new ShootingSystem(bridge, this.playerManager, this.projectileManager);
    this.shootingSystem.setup();

    // ── 7. Host-Physik ────────────────────────────────────────────────────
    this.hostPhysics = new HostPhysicsSystem(
      this, this.playerManager, bridge, this.combatSystem, rockGroup,
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
    // Playroom cached Player-State sitzungsübergreifend. Ohne diesen Reset
    // könnte ein Late-Joiner mit altem isReady:true sofort gespawnt werden,
    // bevor er auf "Bereit" geklickt hat.
    this.isLocalReady = false;
    bridge.setLocalReady(false);

    // ── 13. Initiale Phase lesen (Spät-Joiner-Support) ────────────────────
    this.lastPhase = bridge.getGamePhase();
    // Overlay ist bereits sichtbar – onTransitionToArena() wird bewusst NICHT
    // aufgerufen, da der Late-Joiner noch nicht bereit ist.
  }

  // ── Netzwerk-Events ───────────────────────────────────────────────────────

  private onPlayerJoined(_profile: PlayerProfile): void {
    // Nur protokollieren – kein Entity-Spawn. Spawn erfolgt wenn isReady === true.
  }

  private onPlayerLeft(id: string): void {
    if (this.playerManager.hasPlayer(id)) {
      this.combatSystem.removePlayer(id);
      this.playerManager.removePlayer(id);
    }
  }

  private onReadyToggled(): void {
    this.isLocalReady = !this.isLocalReady;
    bridge.setLocalReady(this.isLocalReady);
    this.lobbyOverlay.setReadyButtonState(this.isLocalReady);
  }

  // ── State Machine ─────────────────────────────────────────────────────────

  /** Erkennt Phasenwechsel per Polling (Playroom setState löst kein Event aus). */
  private detectPhaseChange(): void {
    const current = bridge.getGamePhase();
    if (current === this.lastPhase) return;
    const prev   = this.lastPhase;
    this.lastPhase = current;
    if (prev === 'LOBBY' && current === 'ARENA') this.onTransitionToArena();
    if (prev === 'ARENA' && current === 'LOBBY') this.onTransitionToLobby();
  }

  private onTransitionToArena(): void {
    // Alle bereits bereiten Spieler spawnen
    for (const profile of bridge.getConnectedPlayers()) {
      if (bridge.getPlayerReady(profile.id) && !this.playerManager.hasPlayer(profile.id)) {
        this.playerManager.addPlayer(profile);
        if (bridge.isHost()) this.combatSystem.initPlayer(profile.id);
      }
    }
    this.lobbyOverlay.hide();
  }

  private onTransitionToLobby(): void {
    // Eigenen Ready-Status zurücksetzen
    this.isLocalReady = false;
    bridge.setLocalReady(false);
    this.roundStartPending = false;

    // Alle Entities despawnen
    for (const p of [...this.playerManager.getAllPlayers()]) {
      if (bridge.isHost()) this.combatSystem.removePlayer(p.id);
      this.playerManager.removePlayer(p.id);
    }

    // Overlay zurücksetzen und anzeigen
    this.lobbyOverlay.setReadyButtonState(false);
    this.lobbyOverlay.show();
  }

  /** Host-only: Prüft ob alle Spieler bereit sind und startet die Runde. */
  private hostCheckReadyToStart(): void {
    if (this.roundStartPending || !bridge.areAllPlayersReady()) return;
    this.roundStartPending = true;
    this.lobbyOverlay.lockButton();
    // roundEndTime VOR gamePhase setzen – Clients sehen sofort gültigen Timestamp
    bridge.setRoundEndTime(Date.now() + ARENA_DURATION_SEC * 1000);
    bridge.setGamePhase('ARENA');
  }

  /** Host: Spawnt Spieler die isReady === true sind und noch keine Entity haben. */
  private spawnReadyPlayers(): void {
    for (const profile of bridge.getConnectedPlayers()) {
      if (bridge.getPlayerReady(profile.id) && !this.playerManager.hasPlayer(profile.id)) {
        this.playerManager.addPlayer(profile);
        this.combatSystem.initPlayer(profile.id);
      }
    }
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
    // Spieler ist aktiv im Spiel, sobald er bereit UND die Arena läuft.
    const inGame     = phase === 'ARENA' && localReady;

    // ── Input: nur aktiv wenn Spieler tatsächlich im Spiel ist ───────────
    // Verhindert Bewegung/Schießen solange Lobby-Overlay sichtbar ist –
    // auch wenn (durch stale State) irrtümlich eine Entity existiert.
    if (inGame) {
      this.inputSystem.update();
    }

    // ── Overlay-Steuerung ─────────────────────────────────────────────────
    if (phase === 'LOBBY' || !localReady) {
      // Overlay einblenden (normal-flow UND Late-Joiner in laufender Runde)
      if (!this.lobbyOverlay.isVisible()) this.lobbyOverlay.show();
      this.lobbyOverlay.refreshPlayerList(bridge.getConnectedPlayers());
      if (phase === 'LOBBY' && bridge.isHost()) this.hostCheckReadyToStart();
    } else if (this.lobbyOverlay.isVisible()) {
      // phase === 'ARENA' && localReady === true:
      // Late-Joiner hat BEREIT geklickt → Overlay schließen.
      // (Normal-flow wird durch onTransitionToArena() abgedeckt, aber
      // für Late-Joiner, die ohne Transition direkt in ARENA landen,
      // ist dieser Zweig der einzige Weg.)
      this.lobbyOverlay.hide();
    }

    // ── ARENA-Simulation ──────────────────────────────────────────────────
    // runClientUpdate läuft bewusst auch für noch-nicht-bereite Spieler
    // (Late-Joiner sehen die laufende Runde im Hintergrund durch das
    // halbtransparente Overlay – "Live-Spectator"-Feature).
    if (phase === 'ARENA') {
      const secs = bridge.computeSecondsLeft();
      this.updateTimerDisplay(secs);

      if (bridge.isHost()) {
        // Spät-Joiner spawnen, die während der Runde BEREIT gedrückt haben
        this.spawnReadyPlayers();
        this.runHostUpdate();
        if (secs <= 0) bridge.setGamePhase('LOBBY');
      } else {
        this.runClientUpdate();
      }
    }
  }

  // ── Host-Update ──────────────────────────────────────────────────────────

  private runHostUpdate(): void {
    this.hostPhysics.update();
    this.combatSystem.update();

    const projectiles = this.projectileManager.hostUpdate();

    const players: Record<string, PlayerNetState> = {};
    for (const player of this.playerManager.getAllPlayers()) {
      const hp    = this.combatSystem.getHP(player.id);
      const alive = this.combatSystem.isAlive(player.id);
      players[player.id] = { x: player.sprite.x, y: player.sprite.y, hp, alive };

      player.updateHP(hp);
      player.setVisible(alive);
      player.syncBar();
    }

    bridge.publishGameState({ players, projectiles });
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

      player.setPosition(ps.x, ps.y);
      player.updateHP(ps.hp);
      player.setVisible(ps.alive);
    }

    this.projectileManager.clientSyncVisuals(state.projectiles);
  }
}
