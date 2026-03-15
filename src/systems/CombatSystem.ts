import Phaser from 'phaser';
import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { NetworkBridge }     from '../network/NetworkBridge';
import type { ResourceSystem }    from './ResourceSystem';
import {
  ARENA_HEIGHT,
  HP_MAX, RESPAWN_DELAY_MS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH,
  HITSCAN_FAVOR_THE_SHOOTER_MAX_OFFSET,
  HITSCAN_FAVOR_THE_SHOOTER_MS,
  PLAYER_SIZE,
  RAGE_PER_DAMAGE, ADRENALINE_START,
} from '../config';

// Zirkuläre Abhängigkeiten vermeiden: nur Typ-Imports
type BurrowSystemType    = { isBurrowed(id: string): boolean };
type LoadoutManagerType  = { getDamageMultiplier(id: string): number };

export class CombatSystem {
  private hp:            Map<string, number>                           = new Map();
  private alive:         Map<string, boolean>                          = new Map();
  private respawnTimers: Map<string, ReturnType<typeof setTimeout>>    = new Map();
  private readonly hitscanLine = new Phaser.Geom.Line();
  private readonly arenaBounds = new Phaser.Geom.Rectangle(ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT);
  private readonly scratchCircle = new Phaser.Geom.Circle();
  private readonly scratchPoints: Phaser.Geom.Point[] = [];

  // Kill-Tracking: letzter Angreifer & Waffe pro Ziel (für Frag-Vergabe)
  private lastAttacker: Map<string, string> = new Map();  // victimId → attackerId
  private lastWeapon:   Map<string, string> = new Map();  // victimId → weaponName

  // Callback: (killerId, victimId, weaponName) – Host-only
  private onKillCb: ((killerId: string, victimId: string, weapon: string) => void) | null = null;

  // Optionale Referenzen – werden nach Konstruktion gesetzt
  private burrowSystem:   BurrowSystemType   | null  = null;
  private resourceSystem: ResourceSystem     | null  = null;
  private loadoutManager: LoadoutManagerType | null  = null;
  private rockObjects: readonly (Phaser.GameObjects.Rectangle | null)[] | null = null;
  private trunkObjects: readonly Phaser.GameObjects.Arc[] | null = null;

  constructor(
    private playerManager:     PlayerManager,
    private projectileManager: ProjectileManager,
    private bridge:            NetworkBridge,
  ) {}

  // ── Referenz-Injection ────────────────────────────────────────────────────

  setBurrowSystem(bs: BurrowSystemType | null): void     { this.burrowSystem   = bs; }
  setResourceSystem(rs: ResourceSystem | null): void     { this.resourceSystem = rs; }
  setLoadoutManager(lm: LoadoutManagerType | null): void { this.loadoutManager = lm; }
  setArenaObstacles(
    rockObjects: readonly (Phaser.GameObjects.Rectangle | null)[] | null,
    trunkObjects: readonly Phaser.GameObjects.Arc[] | null,
  ): void {
    this.rockObjects = rockObjects;
    this.trunkObjects = trunkObjects;
  }

  /** Setzt den Kill-Callback (Host-only). */
  setKillCallback(cb: (killerId: string, victimId: string, weapon: string) => void): void {
    this.onKillCb = cb;
  }

  // ── Spieler-Lifecycle ──────────────────────────────────────────────────────

  initPlayer(id: string): void {
    this.hp.set(id, HP_MAX);
    this.alive.set(id, true);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
  }

  removePlayer(id: string): void {
    this.hp.delete(id);
    this.alive.delete(id);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
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
   * attackerId/weaponName werden für die Kill-Zuordnung getrackt.
   */
  applyDamage(
    targetId:        string,
    amount:          number,
    skipBurrowCheck  = false,
    attackerId?:     string,
    weaponName?:     string,
  ): void {
    if (!this.isAlive(targetId)) return;
    if (!skipBurrowCheck && this.burrowSystem?.isBurrowed(targetId)) return;

    // Letzten Angreifer tracken (Selbstschaden ausgenommen)
    if (attackerId && attackerId !== targetId) {
      this.lastAttacker.set(targetId, attackerId);
      if (weaponName) this.lastWeapon.set(targetId, weaponName);
    }

    const player = this.playerManager.getPlayer(targetId);
    const x = player?.sprite.x ?? 0;
    const y = player?.sprite.y ?? 0;

    const newHp = Math.max(0, (this.hp.get(targetId) ?? HP_MAX) - amount);
    this.hp.set(targetId, newHp);

    // Wut-Gewinn proportional zum Schaden
    this.resourceSystem?.addRage(targetId, amount * RAGE_PER_DAMAGE);

    this.bridge.broadcastEffect('hit', x, y, attackerId);

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
        this.applyDamage(player.id, damage, false, ownerId, 'Granate');
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
          this.handleHit(proj.id, player.id, actualDamage, proj.ownerId, proj.adrenalinGain, proj.weaponName);
          break;  // Projektil trifft maximal einen Spieler pro Frame
        }
      }
    }
  }

  resolveHitscanShot(
    shooterId: string,
    startX: number,
    startY: number,
    angle: number,
    range: number,
    damage: number,
    traceThickness: number,
    adrenalinGain: number,
    weaponName: string,
  ): boolean {
    if (!this.bridge.isHost()) return false;

    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const maxEndX = startX + dirX * range;
    const maxEndY = startY + dirY * range;
    this.hitscanLine.setTo(startX, startY, maxEndX, maxEndY);

    let closestDistance = Phaser.Geom.Line.Length(this.hitscanLine);
    const obstacleHit = this.findNearestObstacleHit(this.hitscanLine);
    if (obstacleHit) closestDistance = obstacleHit.distance;

    let hitPlayerId: string | null = null;
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isAlive(player.id)) continue;
      if (player.id === shooterId) continue;
      if (this.burrowSystem?.isBurrowed(player.id)) continue;

      const hitDistance = this.getFavorTheShooterHitDistance(this.hitscanLine, player, traceThickness);
      if (hitDistance === null || hitDistance > closestDistance) continue;

      closestDistance = hitDistance;
      hitPlayerId = player.id;
    }

    if (!hitPlayerId) return true;

    const multiplier = this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1;
    const actualDamage = damage * multiplier;
    this.applyDamage(hitPlayerId, actualDamage, true, shooterId, weaponName);

    if (adrenalinGain > 0) {
      this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
    }

    return true;
  }

  // ── Privat: Treffer, Tod, Respawn ──────────────────────────────────────────

  private findNearestObstacleHit(
    line: Phaser.Geom.Line,
  ): { distance: number; x: number; y: number } | null {
    let bestHit = this.findNearestRectangleHit(line, this.arenaBounds);

    if (this.rockObjects) {
      for (const rock of this.rockObjects) {
        if (!rock?.active) continue;
        const hit = this.findNearestRectangleHit(line, rock.getBounds());
        if (hit && (!bestHit || hit.distance < bestHit.distance)) bestHit = hit;
      }
    }

    if (this.trunkObjects) {
      for (const trunk of this.trunkObjects) {
        if (!trunk.active) continue;
        const hit = this.findNearestCircleHit(line, trunk.x, trunk.y, trunk.radius);
        if (hit && (!bestHit || hit.distance < bestHit.distance)) bestHit = hit;
      }
    }

    return bestHit;
  }

  private getFavorTheShooterHitDistance(
    line: Phaser.Geom.Line,
    player: ReturnType<PlayerManager['getAllPlayers']>[number],
    traceThickness: number,
  ): number | null {
    const baseRadius = PLAYER_SIZE * 0.5 + traceThickness * 0.5;
    const currentHit = this.findNearestCircleHit(line, player.sprite.x, player.sprite.y, baseRadius);

    const velocity = player.body.velocity;
    const rewindX = player.sprite.x - velocity.x * (HITSCAN_FAVOR_THE_SHOOTER_MS / 1000);
    const rewindY = player.sprite.y - velocity.y * (HITSCAN_FAVOR_THE_SHOOTER_MS / 1000);
    const rewindHit = this.findNearestCircleHit(line, rewindX, rewindY, baseRadius);

    const rewindOffset = Math.min(
      HITSCAN_FAVOR_THE_SHOOTER_MAX_OFFSET,
      Phaser.Math.Distance.Between(player.sprite.x, player.sprite.y, rewindX, rewindY),
    );
    const sweepHit = this.findNearestCircleHit(
      line,
      (player.sprite.x + rewindX) * 0.5,
      (player.sprite.y + rewindY) * 0.5,
      baseRadius + rewindOffset * 0.5,
    );

    return [currentHit, rewindHit, sweepHit]
      .filter((hit): hit is { distance: number; x: number; y: number } => hit !== null)
      .reduce<number | null>((best, hit) => {
        if (best === null || hit.distance < best) return hit.distance;
        return best;
      }, null);
  }

  private findNearestRectangleHit(
    line: Phaser.Geom.Line,
    rect: Phaser.Geom.Rectangle,
  ): { distance: number; x: number; y: number } | null {
    const points = Phaser.Geom.Intersects.GetLineToRectangle(line, rect, this.scratchPoints);
    return this.pickNearestIntersection(line, points);
  }

  private findNearestCircleHit(
    line: Phaser.Geom.Line,
    centerX: number,
    centerY: number,
    radius: number,
  ): { distance: number; x: number; y: number } | null {
    this.scratchCircle.setTo(centerX, centerY, radius);
    const points = Phaser.Geom.Intersects.GetLineToCircle(line, this.scratchCircle, this.scratchPoints);
    return this.pickNearestIntersection(line, points);
  }

  private pickNearestIntersection(
    line: Phaser.Geom.Line,
    points: Phaser.Geom.Point[],
  ): { distance: number; x: number; y: number } | null {
    let bestHit: { distance: number; x: number; y: number } | null = null;

    for (const point of points) {
      const distance = Phaser.Math.Distance.Between(line.x1, line.y1, point.x, point.y);
      if (distance <= 0.01) continue;
      if (!bestHit || distance < bestHit.distance) {
        bestHit = { distance, x: point.x, y: point.y };
      }
    }

    points.length = 0;
    return bestHit;
  }

  private handleHit(
    projectileId:  number,
    playerId:      string,
    damage:        number,
    shooterId:     string,
    adrenalinGain: number,
    weaponName:    string,
  ): void {
    this.projectileManager.destroyProjectile(projectileId);
    this.applyDamage(playerId, damage, true, shooterId, weaponName);

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

    // Kill-Callback auslösen (Host-only, kein Selbstkill)
    const killerId = this.lastAttacker.get(playerId);
    if (killerId && killerId !== playerId) {
      const weapon = this.lastWeapon.get(playerId) ?? 'Waffe';
      this.onKillCb?.(killerId, playerId, weapon);
    }

    const timer = setTimeout(() => this.respawn(playerId), RESPAWN_DELAY_MS);
    this.respawnTimers.set(playerId, timer);
  }

  private respawn(playerId: string): void {
    this.hp.set(playerId, HP_MAX);
    this.alive.set(playerId, true);
    this.respawnTimers.delete(playerId);
    this.lastAttacker.delete(playerId);
    this.lastWeapon.delete(playerId);

    this.resourceSystem?.setAdrenaline(playerId, ADRENALINE_START);

    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    player.body.enable = true;
    const spawn = this.playerManager.getSpawnPoint();
    player.setPosition(ARENA_OFFSET_X + spawn.x, ARENA_OFFSET_Y + spawn.y);
  }
}
