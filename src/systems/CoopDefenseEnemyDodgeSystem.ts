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
import type { EnemyCirclePathResolver } from './EnemyFlowFieldService';

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
const PROJECTILE_BUCKET_SIZE_PX = 256;
const PROJECTILE_BUCKET_KEY_STRIDE = 4096;

function projectileBucketKey(gridX: number, gridY: number): number {
  return gridX * PROJECTILE_BUCKET_KEY_STRIDE + gridY;
}

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
  private readonly activeEnemyIds = new Set<string>();
  private readonly projectileBuckets = new Map<number, TrackedProjectile[]>();
  private readonly usedProjectileBucketKeys: number[] = [];
  private projectilesPrepared = false;
  private currentNow = 0;

  private readonly processEnemy = (enemy: EnemyEntity): void => {
    if (!enemy.sprite.active || enemy.getHp() <= 0) return;
    this.activeEnemyIds.add(enemy.id);

    const dodge = enemy.faction === 'hostile' ? getCoopDefenseEnemyConfig(enemy.kind).dodge : undefined;
    if (!dodge) return;
    if (
      dodge.enabledBelowHpRatio !== undefined
      && enemy.getHp() / enemy.getMaxHp() > dodge.enabledBelowHpRatio
    ) return;
    if (this.hostPhysics.isEnemyDashing(enemy.id)) return;
    if (enemy.getSpecialAction() === 'gauss-charge') return;
    if (enemy.isBurrowed() || this.enemyManager.isEnemyPanicking(enemy.id)) return;
    if (this.currentNow < (this.readyAt.get(enemy.id) ?? 0)) return;

    if (!this.projectilesPrepared) {
      this.rebuildProjectileBroadphase(this.projectileManager.getActiveProjectiles());
      this.projectilesPrepared = true;
    }
    const direction = this.findEvadeDirection(enemy, dodge)
      ?? this.findApproachDirection(enemy, dodge);
    if (!direction) return;

    if (this.hostPhysics.startEnemyDash(enemy.id, direction.x, direction.y)) {
      this.readyAt.set(enemy.id, this.currentNow + DODGE_TOTAL_DURATION_MS + dodge.cooldownMs);
    }
  };

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly playerManager: PlayerManager,
    private readonly projectileManager: ProjectileManager,
    private readonly combatSystem: CombatSystem,
    private readonly hostPhysics: HostPhysicsSystem,
    private readonly isFreeGroundAt: FreeGroundResolver,
    private readonly hasWalkableCircleLine?: EnemyCirclePathResolver,
  ) {}

  hostUpdate(now: number): void {
    this.currentNow = now;
    this.activeEnemyIds.clear();
    this.projectilesPrepared = false;
    const manager = this.enemyManager as EnemyManager & {
      forEachEnemy?: (visitor: (enemy: EnemyEntity) => void) => void;
    };
    if (manager.forEachEnemy) {
      manager.forEachEnemy(this.processEnemy);
      this.pruneInactiveEnemies(this.activeEnemyIds);
      return;
    }
    for (const enemy of this.enemyManager.getAllEnemies()) {
      if (!enemy.sprite.active || enemy.getHp() <= 0) continue;
      this.activeEnemyIds.add(enemy.id);

      const dodge = enemy.faction === 'hostile' ? getCoopDefenseEnemyConfig(enemy.kind).dodge : undefined;
      if (!dodge) continue;
      if (
        dodge.enabledBelowHpRatio !== undefined
        && enemy.getHp() / enemy.getMaxHp() > dodge.enabledBelowHpRatio
      ) continue;
      if (this.hostPhysics.isEnemyDashing(enemy.id)) continue;
      // Beim Gauss-Zielen steht der Boss fest; ein Dodge darf die tatsächliche Schussachse nicht
      // heimlich verschieben. Während Armageddon bleibt Dodge dagegen ausdrücklich erlaubt.
      if (enemy.getSpecialAction() === 'gauss-charge') continue;
      // Unter der Erde läuft der Gegner stur auf seiner Grabspur, und aus dem Lauffeuer flieht
      // er ohnehin schon – in beiden Fällen kein Ausweichen.
      if (enemy.isBurrowed() || this.enemyManager.isEnemyPanicking(enemy.id)) continue;
      if (now < (this.readyAt.get(enemy.id) ?? 0)) continue;

      if (!this.projectilesPrepared) {
        this.rebuildProjectileBroadphase(this.projectileManager.getActiveProjectiles());
        this.projectilesPrepared = true;
      }
      const direction = this.findEvadeDirection(enemy, dodge)
        ?? this.findApproachDirection(enemy, dodge);
      if (!direction) continue;

      if (this.hostPhysics.startEnemyDash(enemy.id, direction.x, direction.y)) {
        this.readyAt.set(enemy.id, this.currentNow + DODGE_TOTAL_DURATION_MS + dodge.cooldownMs);
      }
    }

    this.pruneInactiveEnemies(this.activeEnemyIds);
  }

  clear(): void {
    this.readyAt.clear();
    this.activeEnemyIds.clear();
    this.projectilesPrepared = false;
    for (const key of this.usedProjectileBucketKeys) this.projectileBuckets.get(key)!.length = 0;
    this.usedProjectileBucketKeys.length = 0;
  }

  /**
   * Sucht das dringlichste Projektil, das den Gegner in Kürze treffen würde, und liefert die
   * Richtung quer zu dessen Flugbahn – auf die Seite, auf der der Gegner die Bahn verlässt.
   */
  private findEvadeDirection(
    enemy: EnemyEntity,
    dodge: CoopDefenseEnemyDodgeConfig,
  ): { x: number; y: number } | null {
    const hitRadius = enemy.getCollisionRadius() + dodge.evadeMissMarginPx;
    const leadTimeSeconds = dodge.evadeLeadTimeMs / 1000;
    let bestTime = Number.POSITIVE_INFINITY;
    let bestOffsetX = 0;
    let bestOffsetY = 0;

    const minBucketX = Math.floor((enemy.sprite.x - dodge.evadeScanRadiusPx) / PROJECTILE_BUCKET_SIZE_PX);
    const maxBucketX = Math.floor((enemy.sprite.x + dodge.evadeScanRadiusPx) / PROJECTILE_BUCKET_SIZE_PX);
    const minBucketY = Math.floor((enemy.sprite.y - dodge.evadeScanRadiusPx) / PROJECTILE_BUCKET_SIZE_PX);
    const maxBucketY = Math.floor((enemy.sprite.y + dodge.evadeScanRadiusPx) / PROJECTILE_BUCKET_SIZE_PX);

    for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
      for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY += 1) {
        const bucket = this.projectileBuckets.get(projectileBucketKey(bucketX, bucketY));
        if (!bucket) continue;
        for (const projectile of bucket) {
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
      if (!player.active || !this.combatSystem.isAlive(player.id)) continue;
      if (this.combatSystem.isBurrowed(player.id)) continue;
      if (!this.combatSystem.canDamageTarget(enemy.id, player.id)) continue;

      const distance = Phaser.Math.Distance.Between(
        enemy.sprite.x,
        enemy.sprite.y,
        player.x,
        player.y,
      );
      if (distance < dodge.approachMinDistancePx || distance > dodge.approachMaxDistancePx) continue;
      if (distance >= bestDistance) continue;
      if (!this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, player.x, player.y)) continue;

      bestDistance = distance;
      best = {
        x: (player.x - enemy.sprite.x) / distance,
        y: (player.y - enemy.sprite.y) / distance,
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

    const dx = enemy.sprite.x - projectile.sprite.x;
    const dy = enemy.sprite.y - projectile.sprite.y;
    return dx * dx + dy * dy <= dodge.evadeScanRadiusPx * dodge.evadeScanRadiusPx;
  }

  private rebuildProjectileBroadphase(projectiles: ReadonlySet<TrackedProjectile>): void {
    for (const key of this.usedProjectileBucketKeys) this.projectileBuckets.get(key)!.length = 0;
    this.usedProjectileBucketKeys.length = 0;

    for (const projectile of projectiles) {
      if (!projectile.sprite.active || projectile.isGrenade || projectile.isFlame) continue;
      if (this.enemyManager.hasEnemy(projectile.ownerId)) continue;
      const bucketX = Math.floor(projectile.sprite.x / PROJECTILE_BUCKET_SIZE_PX);
      const bucketY = Math.floor(projectile.sprite.y / PROJECTILE_BUCKET_SIZE_PX);
      const key = projectileBucketKey(bucketX, bucketY);
      let bucket = this.projectileBuckets.get(key);
      if (!bucket) {
        bucket = [];
        this.projectileBuckets.set(key, bucket);
      }
      if (bucket.length === 0) this.usedProjectileBucketKeys.push(key);
      bucket.push(projectile);
    }
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
    if (
      this.hasWalkableCircleLine
      && !this.hasWalkableCircleLine(
        enemy.sprite.x,
        enemy.sprite.y,
        targetX,
        targetY,
        enemy.getCollisionRadius(),
      )
    ) return false;

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
