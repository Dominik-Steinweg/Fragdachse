import Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { CombatSystem }  from './CombatSystem';
import {
  PLAYER_SPEED,
  DASH_SPEED, DASH_DURATION_MS,
  BURROW_SPEED_FACTOR,
} from '../config';

// Zirkuläre Abhängigkeiten vermeiden: nur Typ-Imports
type BurrowSystemType   = { isBurrowed(id: string): boolean; isStunned(id: string): boolean };
type LoadoutManagerType = { getSpeedMultiplier(id: string): number };

export class HostPhysicsSystem {
  private scene:         Phaser.Scene;
  private playerManager: PlayerManager;
  private bridge:        NetworkBridge;
  private combatSystem:  CombatSystem;

  // Obstacle-Gruppen – werden nach Arena-Aufbau injiziert
  private rockGroup:   Phaser.Physics.Arcade.StaticGroup | null = null;
  private trunkGroup:  Phaser.Physics.Arcade.StaticGroup | null = null;

  // Pro-Spieler Collider-Tracking
  private rockCollidersSetup  = new Set<string>();
  private trunkCollidersSetup = new Set<string>();
  private playerColliders     = new Map<string, Phaser.Physics.Arcade.Collider[]>();

  // Optionale Referenzen
  private burrowSystem:   BurrowSystemType   | null = null;
  private loadoutManager: LoadoutManagerType | null = null;

  // Dash-Zustand pro Spieler
  private dashingUntil  = new Map<string, number>();   // ms-Timestamp
  private dashVelocity  = new Map<string, { vx: number; vy: number }>();

  // Burrow-State (Collider-Enable-Tracking)
  private burrowedPlayers = new Set<string>();

  constructor(
    scene:         Phaser.Scene,
    playerManager: PlayerManager,
    bridge:        NetworkBridge,
    combatSystem:  CombatSystem,
  ) {
    this.scene         = scene;
    this.playerManager = playerManager;
    this.bridge        = bridge;
    this.combatSystem  = combatSystem;
  }

  // ── Referenz-Injection ────────────────────────────────────────────────────

  setBurrowSystem(bs: BurrowSystemType | null): void       { this.burrowSystem   = bs; }
  setLoadoutManager(lm: LoadoutManagerType | null): void  { this.loadoutManager = lm; }

  // ── Dash-Handler (aufgerufen von NetworkBridge-RPC) ───────────────────────

  /**
   * Verarbeitet einen Dash-RPC vom Client.
   * Setzt für DASH_DURATION_MS die Geschwindigkeit auf DASH_SPEED in (dx,dy)-Richtung.
   */
  handleDashRPC(playerId: string, dx: number, dy: number): void {
    if (!this.combatSystem.isAlive(playerId)) return;
    if (this.burrowSystem?.isStunned(playerId)) return;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return; // kein Dash im Stand
    this.dashVelocity.set(playerId, { vx: (dx / len) * DASH_SPEED, vy: (dy / len) * DASH_SPEED });
    this.dashingUntil.set(playerId, Date.now() + DASH_DURATION_MS);
  }

  // ── Burrow-Kollisions-Steuerung (aufgerufen von BurrowSystem) ────────────

  /**
   * Aktiviert oder deaktiviert die Rock/Trunk-Collider für einen Spieler.
   * Wird von BurrowSystem beim Betreten/Verlassen des Burrow-Zustands aufgerufen.
   */
  setPlayerBurrowed(id: string, burrowed: boolean): void {
    if (burrowed) {
      this.burrowedPlayers.add(id);
      // Vorhandene Collider deaktivieren
      const colliders = this.playerColliders.get(id) ?? [];
      for (const c of colliders) c.active = false;
    } else {
      this.burrowedPlayers.delete(id);
      // Collider reaktivieren
      const colliders = this.playerColliders.get(id) ?? [];
      for (const c of colliders) c.active = true;
    }
  }

  // ── Obstacle-Gruppen ─────────────────────────────────────────────────────

  /**
   * Setzt die Kollisions-Gruppen nach dem Arena-Aufbau.
   * Bei null (Lobby-Teardown) werden alle existierenden Collider zerstört
   * und die Tracking-Sets geleert, damit die nächste Runde sauber startet.
   */
  setRockGroup(
    rockGroup:  Phaser.Physics.Arcade.StaticGroup | null,
    trunkGroup: Phaser.Physics.Arcade.StaticGroup | null,
  ): void {
    if (rockGroup === null) {
      for (const colliders of this.playerColliders.values()) {
        for (const c of colliders) c.destroy();
      }
      this.playerColliders.clear();
      this.rockCollidersSetup.clear();
      this.trunkCollidersSetup.clear();
      this.burrowedPlayers.clear();
      this.dashingUntil.clear();
      this.dashVelocity.clear();
    }
    this.rockGroup  = rockGroup;
    this.trunkGroup = trunkGroup;
  }

  /**
   * Spieler-Collider zerstören wenn ein Spieler die Lobby verlässt.
   */
  removePlayer(id: string): void {
    const colliders = this.playerColliders.get(id);
    if (colliders) {
      for (const c of colliders) c.destroy();
      this.playerColliders.delete(id);
    }
    this.rockCollidersSetup.delete(id);
    this.trunkCollidersSetup.delete(id);
    this.burrowedPlayers.delete(id);
    this.dashingUntil.delete(id);
    this.dashVelocity.delete(id);
  }

  // ── Frame-Update ─────────────────────────────────────────────────────────

  /**
   * Jeden Frame – nur auf dem Host aktiv.
   * Priorität: Stun > Dash > Burrow-Speed > Normale Bewegung.
   */
  update(): void {
    if (!this.bridge.isHost()) return;

    const now = Date.now();

    for (const player of this.playerManager.getAllPlayers()) {
      // Lazy: Collider mit Felsen anlegen
      if (this.rockGroup && !this.rockCollidersSetup.has(player.id)) {
        const existing = this.playerColliders.get(player.id) ?? [];
        const c = this.scene.physics.add.collider(player.sprite, this.rockGroup);
        // Wenn Spieler bereits burrowed ist → sofort deaktivieren
        if (this.burrowedPlayers.has(player.id)) c.active = false;
        existing.push(c);
        this.playerColliders.set(player.id, existing);
        this.rockCollidersSetup.add(player.id);
      }

      // Lazy: Collider mit Baumstümpfen anlegen
      if (this.trunkGroup && !this.trunkCollidersSetup.has(player.id)) {
        const existing = this.playerColliders.get(player.id) ?? [];
        const c = this.scene.physics.add.collider(player.sprite, this.trunkGroup);
        if (this.burrowedPlayers.has(player.id)) c.active = false;
        existing.push(c);
        this.playerColliders.set(player.id, existing);
        this.trunkCollidersSetup.add(player.id);
      }

      // Tote Spieler überspringen (body.enable = false durch CombatSystem)
      if (!this.combatSystem.isAlive(player.id)) continue;

      // ── 1. Stun: Keine Bewegung ───────────────────────────────────────
      if (this.burrowSystem?.isStunned(player.id)) {
        player.body.setVelocity(0, 0);
        continue;
      }

      // ── 2. Dash: Überschreibe Velocity für DASH_DURATION_MS ──────────
      const dashEnd = this.dashingUntil.get(player.id) ?? 0;
      if (now < dashEnd) {
        const dv = this.dashVelocity.get(player.id);
        if (dv) {
          player.body.setVelocity(dv.vx, dv.vy);
          continue;
        }
      }

      // ── 3. Normaler Input mit optionalem Burrow-Speed-Faktor ─────────
      const input = this.bridge.getPlayerInput(player.id);
      const dx    = input?.dx ?? 0;
      const dy    = input?.dy ?? 0;
      const len   = Math.sqrt(dx * dx + dy * dy);

      const burrowed   = this.burrowSystem?.isBurrowed(player.id) ?? false;
      const speedMult  = this.loadoutManager?.getSpeedMultiplier(player.id) ?? 1;
      const speed      = (burrowed ? PLAYER_SPEED * BURROW_SPEED_FACTOR : PLAYER_SPEED) * speedMult;

      if (len > 0) {
        player.body.setVelocity((dx / len) * speed, (dy / len) * speed);
      } else {
        player.body.setVelocity(0, 0);
      }
    }
  }
}
