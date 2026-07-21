import type { EnemyManager } from '../entities/EnemyManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { FireSystem } from '../effects/FireSystem';
import type { CombatSystem } from './CombatSystem';
import type { HostPhysicsSystem } from './HostPhysicsSystem';
import type { TrackedProjectile } from '../types';

type WeaponUpgradeCombat = Pick<CombatSystem, 'applyDamage' | 'canDamageTarget'>;

const CORRIDOR_WEAPON_NAME = 'AWP-Schneise';
const CORRIDOR_DOT_FALLBACK_DURATION_MS = 500;
const CORRIDOR_DOT_FALLBACK_TICK_MS = 100;

/**
 * Nachbrenner eines Schneisen-Treffers: Der Gesamtschaden wird in Ticks zerlegt,
 * damit der Gegner den Wegstoss ueberlebt und die Flugbahn sichtbar verlaesst.
 */
interface CorridorDotState {
  enemyId: string;
  ownerId: string;
  damagePerTick: number;
  ticksRemaining: number;
  nextTickAt: number;
  tickIntervalMs: number;
  /** Stossrichtung des Treffers – haelt Blut-/Treffer-FX in der Wegstoss-Richtung. */
  dirX: number;
  dirY: number;
}

/** Host-autoritative Flugbahneffekte fuer spezielle Waffen-Upgrades. */
export class WeaponUpgradeSystem {
  private corridorDots: CorridorDotState[] = [];

  constructor(
    private readonly projectileManager: ProjectileManager,
    private readonly enemyManager: EnemyManager,
    private readonly combatSystem: WeaponUpgradeCombat,
    private readonly hostPhysics: HostPhysicsSystem,
    private readonly fireSystem: FireSystem,
  ) {}

  hostUpdate(now = Date.now()): void {
    for (const projectile of this.projectileManager.getActiveProjectiles()) {
      if (projectile.projectileStyle !== 'awp') continue;
      this.refreshAwpFireTrail(projectile, now);
      this.applyAwpDestructionCorridor(projectile, now);
    }
    this.tickCorridorDots(now);
  }

  private refreshAwpFireTrail(projectile: TrackedProjectile, now: number): void {
    const trail = projectile.fireTrail;
    if (!trail || trail.durationMs <= 0) return;
    const dx = projectile.sprite.x - projectile.lastX;
    const dy = projectile.sprite.y - projectile.lastY;
    const length = Math.hypot(dx, dy);
    if (length <= 0.01) return;

    const normalX = -dy / length;
    const normalY = dx / length;
    const halfWidthCells = Math.max(0, Math.floor(projectile.fireTrailHalfWidthCells ?? 0));
    for (let offsetCell = -halfWidthCells; offsetCell <= halfWidthCells; offsetCell += 1) {
      const offset = offsetCell * 16;
      this.fireSystem.hostRefreshGroundCellsAlongSegment(
        projectile.lastX + normalX * offset,
        projectile.lastY + normalY * offset,
        projectile.sprite.x + normalX * offset,
        projectile.sprite.y + normalY * offset,
        {
          sourceKey: `awp-trail:${projectile.id}`,
          ownerId: projectile.ownerId,
          durationMs: trail.durationMs,
          burn: {
            durationMs: trail.burnDurationMs,
            damagePerTick: trail.burnDamagePerTick,
          },
          weaponName: trail.weaponName,
        },
        now,
      );
    }
  }

  private applyAwpDestructionCorridor(projectile: TrackedProjectile, now: number): void {
    const halfWidth = projectile.awpCorridorHalfWidth ?? 0;
    const damage = projectile.awpCorridorDamage ?? 0;
    if (halfWidth <= 0 || damage <= 0) return;

    const fromX = projectile.lastX;
    const fromY = projectile.lastY;
    const dx = projectile.sprite.x - fromX;
    const dy = projectile.sprite.y - fromY;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 0.01) return;
    const length = Math.sqrt(lengthSq);
    const normalX = -dy / length;
    const normalY = dx / length;

    for (const enemy of this.enemyManager.getAllEnemies()) {
      if (projectile.awpCorridorHitIds?.has(enemy.id)) continue;
      if (!this.combatSystem.canDamageTarget(projectile.ownerId, enemy.id, false)) continue;
      const relativeX = enemy.sprite.x - fromX;
      const relativeY = enemy.sprite.y - fromY;
      const progress = Math.max(0, Math.min(1, (relativeX * dx + relativeY * dy) / lengthSq));
      const nearestX = fromX + dx * progress;
      const nearestY = fromY + dy * progress;
      const distance = Math.hypot(enemy.sprite.x - nearestX, enemy.sprite.y - nearestY);
      if (distance > halfWidth + enemy.getCollisionRadius()) continue;

      projectile.awpCorridorHitIds?.add(enemy.id);
      const cross = dx * relativeY - dy * relativeX;
      const side = Math.abs(cross) > 0.001 ? Math.sign(cross) : this.stableSide(enemy.id);
      const pushX = normalX * side;
      const pushY = normalY * side;

      // Erst wegstossen, dann verwunden: Der Gegner soll die Flugbahn sichtbar
      // verlassen, statt neben dem Projektil sofort umzufallen.
      if ((projectile.awpCorridorKnockback ?? 0) > 0) {
        this.hostPhysics.addRecoil(
          enemy.id,
          pushX * (projectile.awpCorridorKnockback ?? 0),
          pushY * (projectile.awpCorridorKnockback ?? 0),
          projectile.awpCorridorKnockbackDurationMs ?? 260,
          projectile.ownerId,
        );
      }
      this.startCorridorDot(enemy.id, projectile, damage, pushX, pushY, now);
    }
  }

  /** Verteilt den Schneisen-Schaden als kurzen Nachbrenner auf mehrere Ticks. */
  private startCorridorDot(
    enemyId: string,
    projectile: TrackedProjectile,
    damage: number,
    dirX: number,
    dirY: number,
    now: number,
  ): void {
    const durationMs = projectile.awpCorridorDotDurationMs ?? CORRIDOR_DOT_FALLBACK_DURATION_MS;
    const tickIntervalMs = Math.max(1, projectile.awpCorridorDotTickIntervalMs ?? CORRIDOR_DOT_FALLBACK_TICK_MS);
    const tickCount = Math.max(1, Math.round(durationMs / tickIntervalMs));

    this.corridorDots.push({
      enemyId,
      ownerId: projectile.ownerId,
      damagePerTick: damage / tickCount,
      ticksRemaining: tickCount,
      nextTickAt: now + tickIntervalMs,
      tickIntervalMs,
      dirX,
      dirY,
    });
  }

  private tickCorridorDots(now: number): void {
    if (this.corridorDots.length === 0) return;

    let writeIndex = 0;
    for (const dot of this.corridorDots) {
      while (dot.ticksRemaining > 0 && now >= dot.nextTickAt) {
        const enemy = this.enemyManager.getEnemy(dot.enemyId);
        if (!enemy) {
          dot.ticksRemaining = 0;
          break;
        }
        this.combatSystem.applyDamage(
          dot.enemyId,
          dot.damagePerTick,
          false,
          dot.ownerId,
          CORRIDOR_WEAPON_NAME,
          {
            sourceX: enemy.sprite.x - dot.dirX * 24,
            sourceY: enemy.sprite.y - dot.dirY * 24,
            dirX: dot.dirX,
            dirY: dot.dirY,
          },
        );
        dot.ticksRemaining -= 1;
        dot.nextTickAt += dot.tickIntervalMs;
      }
      if (dot.ticksRemaining > 0) this.corridorDots[writeIndex++] = dot;
    }
    this.corridorDots.length = writeIndex;
  }

  private stableSide(id: string): 1 | -1 {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
    return (hash & 1) === 0 ? 1 : -1;
  }
}
