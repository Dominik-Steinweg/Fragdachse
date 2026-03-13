import Phaser from 'phaser';
import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { NetworkBridge }     from '../network/NetworkBridge';
import {
  HP_MAX, DAMAGE_PER_HIT, RESPAWN_DELAY_MS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
} from '../config';

export class CombatSystem {
  private hp:            Map<string, number>                           = new Map();
  private alive:         Map<string, boolean>                          = new Map();
  private respawnTimers: Map<string, ReturnType<typeof setTimeout>>    = new Map();

  constructor(
    private playerManager:     PlayerManager,
    private projectileManager: ProjectileManager,
    private bridge:            NetworkBridge,
  ) {}

  // ── Spieler-Lifecycle ──────────────────────────────────────────────────────

  initPlayer(id: string): void {
    this.hp.set(id, HP_MAX);
    this.alive.set(id, true);
  }

  removePlayer(id: string): void {
    this.hp.delete(id);
    this.alive.delete(id);
    const t = this.respawnTimers.get(id);
    if (t) { clearTimeout(t); this.respawnTimers.delete(id); }
  }

  // ── Abfragen ───────────────────────────────────────────────────────────────

  getHP(id: string):    number  { return this.hp.get(id)    ?? HP_MAX; }
  isAlive(id: string):  boolean { return this.alive.get(id) ?? false;  }

  // ── Host-Update: Projektil-Spieler-Kollisionserkennung ────────────────────

  /**
   * Jeden Frame auf dem Host aufrufen.
   * Prüft Überschneidungen zwischen Projektilen und Spielern.
   * Selbst-Treffer werden ignoriert.
   */
  update(): void {
    if (!this.bridge.isHost()) return;

    for (const proj of this.projectileManager.getActiveProjectiles()) {
      const projBounds = proj.sprite.getBounds();

      for (const player of this.playerManager.getAllPlayers()) {
        if (!this.isAlive(player.id))       continue;  // toter Spieler schützbar
        if (proj.ownerId === player.id)     continue;  // kein Selbst-Schaden

        if (Phaser.Geom.Intersects.RectangleToRectangle(projBounds, player.sprite.getBounds())) {
          this.handleHit(proj.id, player.id, player.sprite.x, player.sprite.y);
          break;  // Projektil trifft maximal einen Spieler pro Frame
        }
      }
    }
  }

  // ── Privat: Treffer, Tod, Respawn ──────────────────────────────────────────

  private handleHit(projectileId: number, playerId: string, x: number, y: number): void {
    this.projectileManager.destroyProjectile(projectileId);

    const newHp = Math.max(0, (this.hp.get(playerId) ?? HP_MAX) - DAMAGE_PER_HIT);
    this.hp.set(playerId, newHp);

    this.bridge.broadcastEffect('hit', x, y);

    if (newHp === 0) this.handleDeath(playerId, x, y);
  }

  private handleDeath(playerId: string, x: number, y: number): void {
    this.alive.set(playerId, false);

    // Physik-Body deaktivieren → Spieler bewegt sich nicht mehr
    const player = this.playerManager.getPlayer(playerId);
    if (player) player.body.enable = false;

    this.bridge.broadcastEffect('death', x, y);

    const timer = setTimeout(() => this.respawn(playerId), RESPAWN_DELAY_MS);
    this.respawnTimers.set(playerId, timer);
  }

  private respawn(playerId: string): void {
    this.hp.set(playerId, HP_MAX);
    this.alive.set(playerId, true);
    this.respawnTimers.delete(playerId);

    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    // Body re-aktivieren und an Spawn-Point setzen (reset() löscht auch Velocity)
    player.body.enable = true;
    const spawn = this.playerManager.getSpawnPoint(playerId);
    player.setPosition(ARENA_OFFSET_X + spawn.x, ARENA_OFFSET_Y + spawn.y);
  }
}
