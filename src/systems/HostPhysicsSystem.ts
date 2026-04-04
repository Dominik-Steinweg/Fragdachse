import Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { CombatSystem }  from './CombatSystem';
import {
  PLAYER_SPEED, PLAYER_SIZE,
  DASH_T1_S, DASH_T2_S, DASH_F_MIN, DASH_F_START,
} from '../config';

// Zirkuläre Abhängigkeiten vermeiden: nur Typ-Imports
type BurrowSystemType   = {
  isBurrowed(id: string): boolean;
  isStunned(id: string): boolean;
  isDashBlocked(id: string): boolean;
  getMovementSpeedFactor(id: string): number;
};
type LoadoutManagerType = { getSpeedMultiplier(id: string): number };

interface DashState {
  phase:   1 | 2;
  startMs: number;   // Zeitstempel Phasenbeginn
  dirX:    number;   // normierter Startrichtungsvektor
  dirY:    number;
  vNorm:   number;   // v_norm zum Dash-Zeitpunkt (skaliert mit Buffs)
}

interface ExternalImpulse {
  vx: number;
  vy: number;
  startMs: number;
  durationMs: number;
}

interface ForcedMovement {
  vx: number;
  vy: number;
}

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

  // Dash-Zustand pro Spieler (2-Phasen Speed-Debt-Modell)
  private dashStates       = new Map<string, DashState>();
  private dashBurstPlayers = new Set<string>(); // Phase 1 aktiv → Schießen blockiert

  // Burrow-State (Collider-Enable-Tracking)
  private burrowedPlayers = new Set<string>();

  // Rückstoß-Impulse (Zeit-basiertes Quad-Ease-Out Decay über mehrere Frames)
  private pendingRecoils = new Map<string, ExternalImpulse[]>();
  private forcedMovement = new Map<string, ForcedMovement>();

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

  // ── Rückstoß ─────────────────────────────────────────────────────────────

  /**
   * Startet einen zeitbasierter Rückstoß-Impuls (Quad-Ease-Out Decay über durationMs).
   * Wird in HostPhysicsSystem.update() additiv zur regulären Velocity addiert.
   * Amplitude zum Zeitpunkt t: force * (1 - t/duration)²
   */
  addRecoil(playerId: string, vx: number, vy: number, durationMs = 180): void {
    const impulses = this.pendingRecoils.get(playerId) ?? [];
    impulses.push({ vx, vy, startMs: Date.now(), durationMs });
    this.pendingRecoils.set(playerId, impulses);
  }

  setForcedMovement(playerId: string, vx: number, vy: number): void {
    this.forcedMovement.set(playerId, { vx, vy });
  }

  clearForcedMovement(playerId: string): void {
    this.forcedMovement.delete(playerId);
  }

  applyRadialImpulse(
    x: number,
    y: number,
    radius: number,
    force: number,
    ownerId?: string,
    selfMultiplier = 1,
    durationMs = 260,
  ): void {
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.combatSystem.isAlive(player.id)) continue;

      const dx = player.sprite.x - x;
      const dy = player.sprite.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      const t = Phaser.Math.Clamp(dist / radius, 0, 1);
      const falloff = 1 - t;
      const mult = ownerId && player.id === ownerId ? selfMultiplier : 1;
      const impulse = force * falloff * mult;
      if (impulse <= 0) continue;

      const nx = dist > 0.001 ? dx / dist : 0;
      const ny = dist > 0.001 ? dy / dist : -1;
      this.addRecoil(player.id, nx * impulse, ny * impulse, durationMs);
    }
  }

  private consumeImpulseVelocity(playerId: string, now: number): { vx: number; vy: number } {
    const impulses = this.pendingRecoils.get(playerId);
    if (!impulses || impulses.length === 0) return { vx: 0, vy: 0 };

    let totalVx = 0;
    let totalVy = 0;
    const remaining: ExternalImpulse[] = [];

    for (const impulse of impulses) {
      const elapsed = now - impulse.startMs;
      if (elapsed >= impulse.durationMs) continue;
      const t = elapsed / impulse.durationMs;
      const factor = (1 - t) * (1 - t);
      totalVx += impulse.vx * factor;
      totalVy += impulse.vy * factor;
      remaining.push(impulse);
    }

    if (remaining.length > 0) {
      this.pendingRecoils.set(playerId, remaining);
    } else {
      this.pendingRecoils.delete(playerId);
    }

    return { vx: totalVx, vy: totalVy };
  }

  // ── Dash-Abfragen ─────────────────────────────────────────────────────────

  /** Gibt zurück ob Spieler aktuell in Phase 1 (Burst) ist → Schießen blockiert. */
  isDashBurst(id: string): boolean { return this.dashBurstPlayers.has(id); }

  /** Gibt die aktuelle Dash-Phase zurück: 0 = kein Dash, 1 = Burst, 2 = Recovery. */
  getDashPhase(id: string): 0 | 1 | 2 {
    return (this.dashStates.get(id)?.phase ?? 0) as 0 | 1 | 2;
  }

  // ── Dash-Handler (aufgerufen von NetworkBridge-RPC) ───────────────────────

  /**
   * Verarbeitet einen Dash-RPC vom Client.
   * Startet Phase 1 (Burst) mit Quad.easeOut Geschwindigkeitskurve.
   * Kein Dash wenn: tot, gestunnt, bereits dashend, oder im Stand.
   */
  handleDashRPC(playerId: string, dx: number, dy: number): void {
    if (!this.combatSystem.isAlive(playerId)) return;
    if (this.burrowSystem?.isDashBlocked(playerId)) return;
    if (this.dashStates.has(playerId)) return; // läuft noch → kein Spam

    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return; // kein Dash im Stand

    const burrowSpeedFactor = this.burrowSystem?.getMovementSpeedFactor(playerId) ?? 1;
    const speedMult = this.loadoutManager?.getSpeedMultiplier(playerId) ?? 1;
    const vNorm     = PLAYER_SPEED * burrowSpeedFactor * speedMult;

    this.dashStates.set(playerId, {
      phase:   1,
      startMs: Date.now(),
      dirX:    dx / len,
      dirY:    dy / len,
      vNorm,
    });
    this.dashBurstPlayers.add(playerId);
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
      this.dashStates.clear();
      this.dashBurstPlayers.clear();
      this.pendingRecoils.clear();
      this.forcedMovement.clear();
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
    this.dashStates.delete(id);
    this.dashBurstPlayers.delete(id);
    this.pendingRecoils.delete(id);
    this.forcedMovement.delete(id);
  }

  // ── Frame-Update ─────────────────────────────────────────────────────────

  /**
   * Jeden Frame – nur auf dem Host aktiv.
   * Priorität: Stun > Dash (2-Phasen) > Burrow-Speed > Normale Bewegung.
   */
  update(movementLocked = false): void {
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

      const impulse = this.consumeImpulseVelocity(player.id, now);
      const forcedMovement = this.forcedMovement.get(player.id);

      if (movementLocked) {
        player.body.setVelocity(impulse.vx, impulse.vy);
        continue;
      }

      if (forcedMovement) {
        player.body.setVelocity(forcedMovement.vx + impulse.vx, forcedMovement.vy + impulse.vy);
        continue;
      }

      // ── 1. Stun: Keine Bewegung ───────────────────────────────────────
      if (this.burrowSystem?.isStunned(player.id)) {
        player.body.setVelocity(impulse.vx, impulse.vy);
        continue;
      }

      let baseVx = 0;
      let baseVy = 0;

      // ── 2. Dash: 2-Phasen Speed-Debt-Modell ─────────────────────────
      const dash = this.dashStates.get(player.id);
      if (dash) {
        const elapsed = (now - dash.startMs) / 1000;

        // Air Control: WASD wenn gedrückt, sonst gespeicherte Startrichtung
        const input  = this.bridge.getPlayerInput(player.id);
        const rawX   = input?.dx ?? 0;
        const rawY   = input?.dy ?? 0;
        const rawLen = Math.sqrt(rawX * rawX + rawY * rawY);
        const dirX   = rawLen > 0 ? rawX / rawLen : dash.dirX;
        const dirY   = rawLen > 0 ? rawY / rawLen : dash.dirY;

        let speedFactor: number;
        let done = false;

        if (dash.phase === 1) {
          const t = Math.min(1, elapsed / DASH_T1_S);
          // Quad.easeOut: sofortiger Abfall von f_start auf f_min
          const easeOut = 1 - (1 - t) * (1 - t);
          speedFactor = DASH_F_START + (DASH_F_MIN - DASH_F_START) * easeOut;

          // Hitbox sofort auf 50 % Radius (25 % Fläche)
          player.body.setCircle(PLAYER_SIZE * 0.25);
          player.sprite.setScale(0.5);

          if (elapsed >= DASH_T1_S) {
            // Phasenwechsel: Überschusszeit in Phase 2 übertragen
            dash.phase   = 2;
            dash.startMs = now - (elapsed - DASH_T1_S) * 1000;
            this.dashBurstPlayers.delete(player.id);
          }
        } else {
          const t = Math.min(1, elapsed / DASH_T2_S);
          // Quad.easeIn: zähes Aufrappeln von f_min auf 1.0
          const easeIn = t * t;
          speedFactor = DASH_F_MIN + (1 - DASH_F_MIN) * easeIn;
          const scale = 0.5 + 0.5 * easeIn;
          player.body.setCircle(PLAYER_SIZE * scale / 2);
          player.sprite.setScale(scale);

          if (elapsed >= DASH_T2_S) {
            done = true;
            this.dashStates.delete(player.id);
            player.body.setCircle(PLAYER_SIZE / 2);
            player.sprite.setScale(1.0);
          }
        }

        if (!done) {
          baseVx = dirX * dash.vNorm * speedFactor;
          baseVy = dirY * dash.vNorm * speedFactor;
          player.body.setVelocity(baseVx + impulse.vx, baseVy + impulse.vy);
          continue;
        }
        // done → fällt durch zur normalen Bewegung
      }

      // ── 3. Normaler Input mit optionalem Burrow-Speed-Faktor ─────────
      const input = this.bridge.getPlayerInput(player.id);
      const dx    = input?.dx ?? 0;
      const dy    = input?.dy ?? 0;
      const len   = Math.sqrt(dx * dx + dy * dy);

      const burrowSpeedFactor = this.burrowSystem?.getMovementSpeedFactor(player.id) ?? 1;
      const speedMult  = this.loadoutManager?.getSpeedMultiplier(player.id) ?? 1;
      const speed      = PLAYER_SPEED * burrowSpeedFactor * speedMult;

      if (len > 0) {
        baseVx = (dx / len) * speed;
        baseVy = (dy / len) * speed;
      } else {
        baseVx = 0;
        baseVy = 0;
      }

      player.body.setVelocity(baseVx + impulse.vx, baseVy + impulse.vy);
    }
  }
}
