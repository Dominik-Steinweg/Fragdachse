import Phaser from 'phaser';
import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { NetworkBridge }     from '../network/NetworkBridge';
import type { ResourceSystem }    from './ResourceSystem';
import {
  HP_MAX, RESPAWN_DELAY_MS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  RAGE_PER_DAMAGE, ADRENALINE_START,
} from '../config';

// Zirkuläre Abhängigkeiten vermeiden: nur Typ-Imports
type BurrowSystemType    = { isBurrowed(id: string): boolean };
type LoadoutManagerType  = { getDamageMultiplier(id: string): number };

export class CombatSystem {
  private hp:            Map<string, number>                           = new Map();
  private alive:         Map<string, boolean>                          = new Map();
  private respawnTimers: Map<string, ReturnType<typeof setTimeout>>    = new Map();

  // Optionale Referenzen – werden nach Konstruktion gesetzt
  private burrowSystem:   BurrowSystemType   | null  = null;
  private resourceSystem: ResourceSystem     | null  = null;
  private loadoutManager: LoadoutManagerType | null  = null;

  constructor(
    private playerManager:     PlayerManager,
    private projectileManager: ProjectileManager,
    private bridge:            NetworkBridge,
  ) {}

  // ── Referenz-Injection ────────────────────────────────────────────────────

  setBurrowSystem(bs: BurrowSystemType | null): void     { this.burrowSystem   = bs; }
  setResourceSystem(rs: ResourceSystem | null): void     { this.resourceSystem = rs; }
  setLoadoutManager(lm: LoadoutManagerType | null): void { this.loadoutManager = lm; }

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

  // ── Öffentliche Schadens-Methode ───────────────────────────────────────────

  /**
   * Fügt einem Spieler Schaden zu. Burrowed-Spieler sind unverwundbar
   * (Ausnahme: Stuck-Schaden über skipBurrowCheck=true).
   */
  applyDamage(targetId: string, amount: number, skipBurrowCheck = false): void {
    if (!this.isAlive(targetId)) return;
    if (!skipBurrowCheck && this.burrowSystem?.isBurrowed(targetId)) return;

    const player = this.playerManager.getPlayer(targetId);
    const x = player?.sprite.x ?? 0;
    const y = player?.sprite.y ?? 0;

    const newHp = Math.max(0, (this.hp.get(targetId) ?? HP_MAX) - amount);
    this.hp.set(targetId, newHp);

    // Wut-Gewinn proportional zum Schaden
    this.resourceSystem?.addRage(targetId, amount * RAGE_PER_DAMAGE);

    this.bridge.broadcastEffect('hit', x, y);

    if (newHp === 0) this.handleDeath(targetId, x, y);
  }

  /**
   * Flächenschaden um einen Punkt (z.B. Granaten-Explosion).
   * Burrowed-Spieler sind immun (skipBurrowCheck=false).
   */
  applyAoeDamage(x: number, y: number, radius: number, damage: number, ownerId: string): void {
    for (const player of this.playerManager.getAllPlayers()) {
      if (player.id === ownerId) continue;
      if (!this.isAlive(player.id)) continue;
      const dist = Phaser.Math.Distance.Between(x, y, player.sprite.x, player.sprite.y);
      if (dist <= radius) {
        this.applyDamage(player.id, damage, false);
      }
    }
  }

  // ── Host-Update: Projektil-Spieler-Kollisionserkennung ────────────────────

  /**
   * Jeden Frame auf dem Host aufrufen.
   * Prüft Überschneidungen zwischen Projektilen und Spielern.
   * Selbst-Treffer, Granaten und burrowed Spieler werden ignoriert.
   */
  update(): void {
    if (!this.bridge.isHost()) return;

    for (const proj of this.projectileManager.getActiveProjectiles()) {
      if (proj.isGrenade) continue;  // Granaten treffen nicht direkt, nur AoE
      const projBounds = proj.sprite.getBounds();

      for (const player of this.playerManager.getAllPlayers()) {
        if (!this.isAlive(player.id))                     continue;
        if (proj.ownerId === player.id)                   continue;
        if (this.burrowSystem?.isBurrowed(player.id))     continue;

        if (Phaser.Geom.Intersects.RectangleToRectangle(projBounds, player.sprite.getBounds())) {
          // Damage-Multiplier des Schützen (Ultimate)
          const multiplier   = this.loadoutManager?.getDamageMultiplier(proj.ownerId) ?? 1;
          const actualDamage = proj.damage * multiplier;
          this.handleHit(proj.id, player.id, actualDamage, proj.ownerId, proj.adrenalinGain);
          break;  // Projektil trifft maximal einen Spieler pro Frame
        }
      }
    }
  }

  // ── Privat: Treffer, Tod, Respawn ──────────────────────────────────────────

  private handleHit(
    projectileId:  number,
    playerId:      string,
    damage:        number,
    shooterId:     string,
    adrenalinGain: number,
  ): void {
    this.projectileManager.destroyProjectile(projectileId);
    this.applyDamage(playerId, damage, true);  // skipBurrowCheck: Check bereits oben

    // Adrenalin-Belohnung für den Schützen
    if (adrenalinGain > 0) {
      this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
    }
  }

  private handleDeath(playerId: string, x: number, y: number): void {
    this.alive.set(playerId, false);

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

    this.resourceSystem?.setAdrenaline(playerId, ADRENALINE_START);

    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    player.body.enable = true;
    const spawn = this.playerManager.getSpawnPoint();
    player.setPosition(ARENA_OFFSET_X + spawn.x, ARENA_OFFSET_Y + spawn.y);
  }
}
