import Phaser from 'phaser';
import type { PlayerManager }      from '../entities/PlayerManager';
import type { CombatSystem }       from './CombatSystem';
import type { HostPhysicsSystem }  from './HostPhysicsSystem';
import type { NetworkBridge }      from '../network/NetworkBridge';
import type { ResourceSystem }     from './ResourceSystem';
import {
  ADRENALINE_DRAIN_PER_SEC,
  BURROW_STUCK_DAMAGE_PER_SEC,
  SHOCKWAVE_RADIUS, SHOCKWAVE_DAMAGE, SHOCKWAVE_KNOCKBACK,
  SELF_STUN_DURATION_MS,
  PLAYER_SIZE, TRUNK_RADIUS,
} from '../config';

/**
 * Host-only: Verwaltet den Burrow-Zustand aller Spieler.
 *
 * Zustände:
 *  – burrowed:  aktiv vergrabend (Adrenalin > 0)
 *  – stuckAt0:  Adrenalin aufgebraucht, aber durch Objekt blockiert → Stuck-Schaden
 *  – stun:      kurz nach dem Auftauchen (keine Bewegung/Schuss)
 */
export class BurrowSystem {
  // Aktiv vergrabende Spieler
  private burrowed:      Set<string>          = new Set();
  // Spieler mit Adrenalin=0, die durch Rock/Trunk blockiert sind
  private stuckAt0:      Set<string>          = new Set();
  // Stun-Timestamp pro Spieler (ms)
  private stunnedUntil:  Map<string, number>  = new Map();
  // Akkumulierter Stick-Schaden (Nachkommastellen)
  private stuckDmgAccum: Map<string, number>  = new Map();

  // Arena-Objekte für Overlap-Check
  private rockGroup:  Phaser.Physics.Arcade.StaticGroup | null = null;
  private trunkGroup: Phaser.Physics.Arcade.StaticGroup | null = null;

  constructor(
    private resources:    ResourceSystem,
    private playerMgr:    PlayerManager,
    private combat:       CombatSystem,
    private hostPhysics:  HostPhysicsSystem,
    private bridge:       NetworkBridge,
  ) {}

  // ── Obstacle-Gruppen (nach Arena-Aufbau setzen) ───────────────────────────

  setGroups(
    rock:  Phaser.Physics.Arcade.StaticGroup | null,
    trunk: Phaser.Physics.Arcade.StaticGroup | null,
  ): void {
    this.rockGroup  = rock;
    this.trunkGroup = trunk;
  }

  // ── Spieler-Lifecycle ──────────────────────────────────────────────────────

  initPlayer(id: string): void {
    // Sicherstellen dass kein alter Zustand stören kann
    this.burrowed.delete(id);
    this.stuckAt0.delete(id);
    this.stunnedUntil.delete(id);
    this.stuckDmgAccum.delete(id);
  }

  removePlayer(id: string): void {
    this.burrowed.delete(id);
    this.stuckAt0.delete(id);
    this.stunnedUntil.delete(id);
    this.stuckDmgAccum.delete(id);
  }

  // ── Abfragen ───────────────────────────────────────────────────────────────

  /** true für aktiv vergrabende UND stuck-vergrabene Spieler */
  isBurrowed(id: string): boolean {
    return this.burrowed.has(id) || this.stuckAt0.has(id);
  }

  isStunned(id: string): boolean {
    return Date.now() < (this.stunnedUntil.get(id) ?? 0);
  }

  // ── RPC-Handler ───────────────────────────────────────────────────────────

  /**
   * Wird aufgerufen wenn ein Client graben oder auftauchen möchte.
   */
  handleBurrowRequest(id: string, wantsBurrowed: boolean): void {
    if (!this.combat.isAlive(id)) return;
    if (this.isStunned(id))       return;

    if (wantsBurrowed && !this.isBurrowed(id)) {
      if (this.resources.getAdrenaline(id) > 0) this.enterBurrow(id);
    } else if (!wantsBurrowed && this.isBurrowed(id)) {
      this.tryExitBurrow(id);
    }
  }

  // ── Frame-Update (Host) ───────────────────────────────────────────────────

  update(delta: number): void {
    // Adrenalin drainieren für aktiv vergrabende Spieler
    for (const id of [...this.burrowed]) {
      const drain = ADRENALINE_DRAIN_PER_SEC * delta / 1000;
      this.resources.drainAdrenaline(id, drain);
      if (this.resources.getAdrenaline(id) <= 0) {
        this.tryExitBurrow(id); // forced (Adrenalin = 0)
      }
    }

    // Stuck-Schaden + Befreiungs-Check
    for (const id of [...this.stuckAt0]) {
      const accum = (this.stuckDmgAccum.get(id) ?? 0)
                    + BURROW_STUCK_DAMAGE_PER_SEC * delta / 1000;
      this.stuckDmgAccum.set(id, accum);

      if (accum >= 1) {
        const dmg = Math.floor(accum);
        // Stuck-Schaden ignoriert Burrow-Invulnerabilität (skipBurrowCheck = true)
        this.combat.applyDamage(id, dmg, true);
        this.stuckDmgAccum.set(id, accum - dmg);
      }

      // Prüfen ob Blockierung aufgelöst (z. B. Fels zerstört)
      if (!this.isOverlappingStatic(id)) {
        this.stuckAt0.delete(id);
        this.stuckDmgAccum.delete(id);
        this.finalizeUnburrow(id);
      }
    }
  }

  // ── Privat ─────────────────────────────────────────────────────────────────

  private enterBurrow(id: string): void {
    this.burrowed.add(id);
    this.hostPhysics.setPlayerBurrowed(id, true);
    this.bridge.broadcastBurrowVisual(id, true);
  }

  private tryExitBurrow(id: string): void {
    this.burrowed.delete(id);

    if (this.isOverlappingStatic(id)) {
      // Blockiert → stuck-Zustand (bleibt visuell vergraben, nimmt Schaden)
      this.stuckAt0.add(id);
      this.stuckDmgAccum.set(id, 0);
      // Collider bleiben deaktiviert (isBurrowed() gibt weiterhin true zurück)
    } else {
      this.finalizeUnburrow(id);
    }
  }

  private finalizeUnburrow(id: string): void {
    this.hostPhysics.setPlayerBurrowed(id, false);
    this.bridge.broadcastBurrowVisual(id, false);
    this.applyShockwave(id);
    this.stunnedUntil.set(id, Date.now() + SELF_STUN_DURATION_MS);
  }

  /**
   * Prüft ob der Spieler-Sprite ein Rock- oder Trunk-Objekt überlappt.
   */
  private isOverlappingStatic(id: string): boolean {
    const player = this.playerMgr.getPlayer(id);
    if (!player) return false;

    const bounds = player.sprite.getBounds();

    // Felsen-Overlap (Rechteck-Bounds)
    if (this.rockGroup) {
      for (const child of this.rockGroup.getChildren()) {
        if (!child.active) continue;
        const rock = child as Phaser.GameObjects.Rectangle;
        if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, rock.getBounds())) {
          return true;
        }
      }
    }

    // Trunk-Overlap (Kreisdistanz)
    if (this.trunkGroup) {
      for (const child of this.trunkGroup.getChildren()) {
        if (!child.active) continue;
        const trunk = child as Phaser.GameObjects.Arc;
        const dx    = player.sprite.x - trunk.x;
        const dy    = player.sprite.y - trunk.y;
        if (Math.sqrt(dx * dx + dy * dy) < TRUNK_RADIUS + PLAYER_SIZE / 2) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * AoE-Knockback + Schaden für Spieler im SHOCKWAVE_RADIUS um den Auftauchenden.
   */
  private applyShockwave(id: string): void {
    const origin = this.playerMgr.getPlayer(id);
    if (!origin) return;

    const ox = origin.sprite.x;
    const oy = origin.sprite.y;

    for (const other of this.playerMgr.getAllPlayers()) {
      if (other.id === id) continue;
      if (!this.combat.isAlive(other.id)) continue;

      const dx   = other.sprite.x - ox;
      const dy   = other.sprite.y - oy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < SHOCKWAVE_RADIUS && dist > 0) {
        this.combat.applyDamage(other.id, SHOCKWAVE_DAMAGE);
        const nx = dx / dist;
        const ny = dy / dist;
        (other.sprite.body as Phaser.Physics.Arcade.Body)
          .setVelocity(nx * SHOCKWAVE_KNOCKBACK, ny * SHOCKWAVE_KNOCKBACK);
      }
    }

    // Visueller Effekt für alle Clients (inkl. Host)
    this.bridge.broadcastShockwaveEffect(ox, oy);
  }
}
