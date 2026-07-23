import * as Phaser from 'phaser';
import { DASH_F_MIN, DASH_F_START, DASH_T1_S, DASH_T2_S, PLAYER_SIZE } from '../config';
import {
  getCoopDefenseEnemyConfig,
  type CoopDefenseEnemyDodgeConfig,
} from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { TrackedProjectile } from '../types';
import type { CombatSystem } from './CombatSystem';
import type { HostPhysicsSystem } from './HostPhysicsSystem';

/** Prüft, ob an einer Weltposition genug freier, erreichbarer Boden für den Gegner ist. */
export type FreeGroundResolver = (x: number, y: number, radius: number) => boolean;

/** Gesamtdauer eines Ausweichschritts – dieselbe Zweiphasen-Kurve wie beim Spieler-Dash. */
const DODGE_TOTAL_DURATION_MS = (DASH_T1_S + DASH_T2_S) * 1000;

/**
 * Zurückgelegte Dash-Strecke als Vielfaches der Laufgeschwindigkeit: Integral der beiden
 * Phasenkurven (Quad.easeOut über DASH_T1_S, Quad.easeIn über DASH_T2_S). Als Formel statt als
 * Zahl gehalten, damit die Landepunkt-Prüfung mit den Dash-Konstanten mitwandert.
 */
const DASH_DISTANCE_PER_SPEED =
  (DASH_F_START + (DASH_F_MIN - DASH_F_START) * (2 / 3)) * DASH_T1_S
  + (DASH_F_MIN + (1 - DASH_F_MIN) / 3) * DASH_T2_S;

/** Sicherheitsaufschlag auf den Trefferradius bei der Landepunkt-Prüfung. */
const LANDING_CLEARANCE_FACTOR = 1.25;

/**
 * Host-seitige Entscheidung, wann ein Gegner mit `dodge`-Konfiguration ausweicht.
 *
 * Zwei Auslöser, Ausweichen hat Vorrang:
 *  1. Ein Spieler-Projektil würde den Gegner treffen → Satz quer zur Flugbahn.
 *  2. Ein Spieler ist bereits in der Nähe → Satz nach vorne, um den Abstand zu schließen.
 *
 * Ausgeführt wird der Schritt vom {@link HostPhysicsSystem} als ganz normaler Dash – gleiche
 * Kurve, gleiche Hitbox-Verkleinerung, gleiche Darstellung und Sounds wie beim Spieler.
 *
 * Ein Schritt startet nur, wenn Sichtlinie *und* Landepunkt frei sind: der Gegner ist während
 * des Bursts halb so groß und könnte sonst in einer Felslücke landen, in der er beim
 * Zurückwachsen feststeckt.
 */
export class CoopDefenseEnemyDodgeSystem {
  private readonly readyAt = new Map<string, number>();

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly playerManager: PlayerManager,
    private readonly projectileManager: ProjectileManager,
    private readonly combatSystem: CombatSystem,
    private readonly hostPhysics: HostPhysicsSystem,
    private readonly isFreeGroundAt: FreeGroundResolver,
  ) {}

  hostUpdate(now: number): void {
    const activeEnemyIds = new Set<string>();
    // Einmal pro Tick abgefragt und als stabile, allokationsfreie Sicht weitergereicht.
    let projectiles: ReadonlySet<TrackedProjectile> | null = null;

    for (const enemy of this.enemyManager.getAllEnemies()) {
      if (!enemy.sprite.active || enemy.getHp() <= 0) continue;
      activeEnemyIds.add(enemy.id);

      const dodge = enemy.faction === 'hostile' ? getCoopDefenseEnemyConfig(enemy.kind).dodge : undefined;
      if (!dodge) continue;
      if (this.hostPhysics.isEnemyDashing(enemy.id)) continue;
      // Unter der Erde läuft der Gegner stur auf seiner Grabspur, und aus dem Lauffeuer flieht
      // er ohnehin schon – in beiden Fällen kein Ausweichen.
      if (enemy.isBurrowed() || this.enemyManager.isEnemyPanicking(enemy.id)) continue;
      if (now < (this.readyAt.get(enemy.id) ?? 0)) continue;

      projectiles ??= this.projectileManager.getActiveProjectiles();
      const direction = this.findEvadeDirection(enemy, dodge, projectiles)
        ?? this.findApproachDirection(enemy, dodge);
      if (!direction) continue;

      if (this.hostPhysics.startEnemyDash(enemy.id, direction.x, direction.y)) {
        this.readyAt.set(enemy.id, now + DODGE_TOTAL_DURATION_MS + dodge.cooldownMs);
      }
    }

    this.pruneInactiveEnemies(activeEnemyIds);
  }

  clear(): void {
    this.readyAt.clear();
  }

  /**
   * Sucht das dringlichste Projektil, das den Gegner in Kürze treffen würde, und liefert die
   * Richtung quer zu dessen Flugbahn – auf die Seite, auf der der Gegner die Bahn verlässt.
   */
  private findEvadeDirection(
    enemy: EnemyEntity,
    dodge: CoopDefenseEnemyDodgeConfig,
    projectiles: ReadonlySet<TrackedProjectile>,
  ): { x: number; y: number } | null {
    const hitRadius = enemy.getCollisionRadius() + dodge.evadeMissMarginPx;
    const leadTimeSeconds = dodge.evadeLeadTimeMs / 1000;
    let bestTime = Number.POSITIVE_INFINITY;
    let bestOffsetX = 0;
    let bestOffsetY = 0;

    for (const projectile of projectiles) {
      if (!this.isDodgeableProjectile(enemy, projectile, dodge)) continue;

      const velocityX = projectile.body.velocity.x;
      const velocityY = projectile.body.velocity.y;
      const speedSq = velocityX * velocityX + velocityY * velocityY;
      if (speedSq <= 1) continue;

      const toEnemyX = enemy.sprite.x - projectile.sprite.x;
      const toEnemyY = enemy.sprite.y - projectile.sprite.y;
      const timeToClosest = (toEnemyX * velocityX + toEnemyY * velocityY) / speedSq;
      if (timeToClosest <= 0 || timeToClosest > leadTimeSeconds || timeToClosest >= bestTime) continue;

      // Versatz zum Zeitpunkt der größten Annäherung – steht senkrecht auf der Flugbahn.
      const offsetX = toEnemyX - velocityX * timeToClosest;
      const offsetY = toEnemyY - velocityY * timeToClosest;
      if (Math.hypot(offsetX, offsetY) > hitRadius) continue;

      bestTime = timeToClosest;
      bestOffsetX = offsetX;
      bestOffsetY = offsetY;
      // Fällt der Gegner exakt auf die Bahnachse, ist die Ausweichseite beliebig: senkrecht dazu.
      if (Math.hypot(offsetX, offsetY) < 0.001) {
        bestOffsetX = -velocityY;
        bestOffsetY = velocityX;
      }
    }

    if (!Number.isFinite(bestTime)) return null;

    const length = Math.hypot(bestOffsetX, bestOffsetY);
    if (length <= 0.001) return null;
    const away = { x: bestOffsetX / length, y: bestOffsetY / length };
    const stepDistance = this.getStepDistance(enemy);
    if (this.hasClearStep(enemy, away, stepDistance)) return away;

    const back = { x: -away.x, y: -away.y };
    return this.hasClearStep(enemy, back, stepDistance) ? back : null;
  }

  /** Nachsetzen auf den nächsten sichtbaren Spieler, sobald er bereits in Reichweite der Waffe ist. */
  private findApproachDirection(
    enemy: EnemyEntity,
    dodge: CoopDefenseEnemyDodgeConfig,
  ): { x: number; y: number } | null {
    if (dodge.approachMaxDistancePx <= dodge.approachMinDistancePx) return null;

    let bestDistance = Number.POSITIVE_INFINITY;
    let best: { x: number; y: number } | null = null;

    for (const player of this.playerManager.getAllPlayers()) {
      if (!player.sprite.active || !this.combatSystem.isAlive(player.id)) continue;
      if (this.combatSystem.isBurrowed(player.id)) continue;
      if (!this.combatSystem.canDamageTarget(enemy.id, player.id)) continue;

      const distance = Phaser.Math.Distance.Between(
        enemy.sprite.x,
        enemy.sprite.y,
        player.sprite.x,
        player.sprite.y,
      );
      if (distance < dodge.approachMinDistancePx || distance > dodge.approachMaxDistancePx) continue;
      if (distance >= bestDistance) continue;
      if (!this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, player.sprite.x, player.sprite.y)) continue;

      bestDistance = distance;
      best = {
        x: (player.sprite.x - enemy.sprite.x) / distance,
        y: (player.sprite.y - enemy.sprite.y) / distance,
      };
    }

    if (!best) return null;
    // Nie weiter springen als bis kurz vor den Spieler, sonst rennt der Gegner durch ihn hindurch.
    // Fernkämpfer mit Wunschabstand hören zusätzlich genau dort auf – sonst würden sie sich mit
    // dem Satz selbst zu nah heranziehen und müssten anschließend wieder zurückweichen.
    const minimumGap = Math.max(
      enemy.getCollisionRadius() + PLAYER_SIZE * 0.5,
      getCoopDefenseEnemyConfig(enemy.kind).combatPositioning?.preferredDistancePx ?? 0,
    );
    const stepDistance = Math.min(this.getStepDistance(enemy), Math.max(0, bestDistance - minimumGap));
    if (stepDistance <= 0) return null;
    return this.hasClearStep(enemy, best, stepDistance) ? best : null;
  }

  /** Nur scharfe Spieler-Projektile sind eine Bedrohung – nicht die eigenen Geschosse der Horde. */
  private isDodgeableProjectile(
    enemy: EnemyEntity,
    projectile: TrackedProjectile,
    dodge: CoopDefenseEnemyDodgeConfig,
  ): boolean {
    if (!projectile.sprite.active) return false;
    if (projectile.isGrenade || projectile.isFlame) return false;
    if (this.enemyManager.hasEnemy(projectile.ownerId)) return false;
    if (!this.combatSystem.canDamageTarget(projectile.ownerId, enemy.id, projectile.allowTeamDamage)) return false;

    return Phaser.Math.Distance.Between(
      enemy.sprite.x,
      enemy.sprite.y,
      projectile.sprite.x,
      projectile.sprite.y,
    ) <= dodge.evadeScanRadiusPx;
  }

  private getStepDistance(enemy: EnemyEntity): number {
    return enemy.getMoveSpeed() * DASH_DISTANCE_PER_SPEED;
  }

  /**
   * Ein Ausweichschritt ist nur erlaubt, wenn die Sichtlinie frei ist **und** der Gegner am
   * Landepunkt mit voller Größe wieder Platz hat. Während des Bursts ist er nur halb so groß und
   * würde sonst in eine Felslücke rutschen, aus der er beim Zurückwachsen nicht mehr herauskommt.
   */
  private hasClearStep(enemy: EnemyEntity, direction: { x: number; y: number }, distance: number): boolean {
    const targetX = enemy.sprite.x + direction.x * distance;
    const targetY = enemy.sprite.y + direction.y * distance;
    if (!this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, targetX, targetY)) return false;

    // Landepunkt mit Sicherheitsaufschlag prüfen, damit der Gegner nicht direkt an einer Felskante
    // stehen bleibt und beim nächsten Schubser doch wieder in der Lücke landet.
    const clearance = enemy.getCollisionRadius() * LANDING_CLEARANCE_FACTOR;
    return this.isFreeGroundAt(targetX, targetY, clearance);
  }

  private pruneInactiveEnemies(activeEnemyIds: ReadonlySet<string>): void {
    for (const enemyId of this.readyAt.keys()) {
      if (!activeEnemyIds.has(enemyId)) this.readyAt.delete(enemyId);
    }
  }
}
