import type { EnemyManager } from '../entities/EnemyManager';
import type { FireSystem } from '../effects/FireSystem';
import type { CombatSystem } from './CombatSystem';
import type { HostPhysicsSystem } from './HostPhysicsSystem';
import type { ProjectileAwpCorridorCapability, ProjectileFireTrailCapability, ProjectileTravelReadPort, ProjectileTravelSample } from '../projectile/ProjectileTravelPort';
import type { ProjectileId } from '../projectile/ProjectileSpawnPort';

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
  private readonly corridorHitIds = new Map<ProjectileId, Set<string>>();
  private readonly activeCorridorIds = new Set<ProjectileId>();
  private enemyManager: EnemyManager | null;

  constructor(
    private readonly projectileTravel: ProjectileTravelReadPort,
    enemyManager: EnemyManager | null,
    private readonly combatSystem: WeaponUpgradeCombat,
    private readonly hostPhysics: HostPhysicsSystem,
    private readonly fireSystem: FireSystem,
  ) {
    this.enemyManager = enemyManager;
  }

  setEnemyManager(enemyManager: EnemyManager | null): void {
    this.enemyManager = enemyManager;
  }

  clear(): void {
    this.corridorDots.length = 0;
    this.corridorHitIds.clear();
    this.activeCorridorIds.clear();
  }

  hostUpdate(now: number): void {
    this.activeCorridorIds.clear();
    for (const sample of this.projectileTravel.getTravelSamples()) {
      const pathEffect = sample.capabilities.pathEffect;
      if (!pathEffect) continue;
      if (pathEffect.kind === 'awp' && pathEffect.fireTrail) {
        this.refreshAwpFireTrail(sample, pathEffect.fireTrail, now);
      }
      if (pathEffect.awpCorridor) {
        this.activeCorridorIds.add(sample.projectileId);
        this.applyAwpDestructionCorridor(sample, pathEffect.awpCorridor, now);
      }
    }
    for (const projectileId of this.corridorHitIds.keys()) {
      if (!this.activeCorridorIds.has(projectileId)) this.corridorHitIds.delete(projectileId);
    }
    this.tickCorridorDots(now);
  }

  private refreshAwpFireTrail(
    sample: ProjectileTravelSample,
    trail: ProjectileFireTrailCapability,
    now: number,
  ): void {
    if (trail.effect.durationMs <= 0) return;
    const dx = sample.toX - sample.fromX;
    const dy = sample.toY - sample.fromY;
    const length = Math.hypot(dx, dy);
    if (length <= 0.01) return;

    const normalX = -dy / length;
    const normalY = dx / length;
    for (let offsetCell = -trail.halfWidthCells; offsetCell <= trail.halfWidthCells; offsetCell += 1) {
      const offset = offsetCell * 16;
      this.fireSystem.hostRefreshGroundCellsAlongSegment(
        sample.fromX + normalX * offset,
        sample.fromY + normalY * offset,
        sample.toX + normalX * offset,
        sample.toY + normalY * offset,
        {
          sourceKey: `awp-trail:${sample.projectileId}`,
          ownerId: sample.provenance.allegiance.ownerId,
          durationMs: trail.effect.durationMs,
          burn: {
            durationMs: trail.effect.burnDurationMs,
            damagePerTick: trail.effect.burnDamagePerTick,
          },
          sourceId: trail.effect.sourceId,
        },
        now,
      );
    }
  }

  private applyAwpDestructionCorridor(
    sample: ProjectileTravelSample,
    corridor: ProjectileAwpCorridorCapability,
    now: number,
  ): void {
    const halfWidth = corridor.halfWidth;
    const damage = corridor.damage;
    if (halfWidth <= 0 || damage <= 0) return;

    const fromX = sample.fromX;
    const fromY = sample.fromY;
    const dx = sample.toX - fromX;
    const dy = sample.toY - fromY;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 0.01) return;
    const length = Math.sqrt(lengthSq);
    const normalX = -dy / length;
    const normalY = dx / length;

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      const hitIds = this.getCorridorHitIds(sample.projectileId);
      if (hitIds.has(enemy.id)) continue;
      const ownerId = sample.provenance.allegiance.ownerId;
      if (!this.combatSystem.canDamageTarget(ownerId, enemy.id, false)) continue;
      const relativeX = enemy.sprite.x - fromX;
      const relativeY = enemy.sprite.y - fromY;
      const progress = Math.max(0, Math.min(1, (relativeX * dx + relativeY * dy) / lengthSq));
      const nearestX = fromX + dx * progress;
      const nearestY = fromY + dy * progress;
      const distance = Math.hypot(enemy.sprite.x - nearestX, enemy.sprite.y - nearestY);
      if (distance > halfWidth + enemy.getCollisionRadius()) continue;

      hitIds.add(enemy.id);
      const cross = dx * relativeY - dy * relativeX;
      const side = Math.abs(cross) > 0.001 ? Math.sign(cross) : this.stableSide(enemy.id);
      const pushX = normalX * side;
      const pushY = normalY * side;

      // Erst wegstossen, dann verwunden: Der Gegner soll die Flugbahn sichtbar
      // verlassen, statt neben dem Projektil sofort umzufallen.
      if ((corridor.knockback ?? 0) > 0) {
        this.hostPhysics.addRecoil(
          enemy.id,
          pushX * (corridor.knockback ?? 0),
          pushY * (corridor.knockback ?? 0),
          corridor.knockbackDurationMs ?? 260,
          ownerId,
        );
      }
      this.startCorridorDot(enemy.id, ownerId, corridor, damage, pushX, pushY, now);
    }
  }

  /** Verteilt den Schneisen-Schaden als kurzen Nachbrenner auf mehrere Ticks. */
  private startCorridorDot(
    enemyId: string,
    ownerId: string,
    corridor: ProjectileAwpCorridorCapability,
    damage: number,
    dirX: number,
    dirY: number,
    now: number,
  ): void {
    const durationMs = corridor.dotDurationMs ?? CORRIDOR_DOT_FALLBACK_DURATION_MS;
    const tickIntervalMs = Math.max(1, corridor.dotTickIntervalMs ?? CORRIDOR_DOT_FALLBACK_TICK_MS);
    const tickCount = Math.max(1, Math.round(durationMs / tickIntervalMs));

    this.corridorDots.push({
      enemyId,
      ownerId,
      damagePerTick: damage / tickCount,
      ticksRemaining: tickCount,
      nextTickAt: now + tickIntervalMs,
      tickIntervalMs,
      dirX,
      dirY,
    });
  }

  private getCorridorHitIds(projectileId: ProjectileId): Set<string> {
    let hitIds = this.corridorHitIds.get(projectileId);
    if (!hitIds) {
      hitIds = new Set<string>();
      this.corridorHitIds.set(projectileId, hitIds);
    }
    return hitIds;
  }

  private tickCorridorDots(now: number): void {
    if (this.corridorDots.length === 0) return;

    let writeIndex = 0;
    for (const dot of this.corridorDots) {
      while (dot.ticksRemaining > 0 && now >= dot.nextTickAt) {
        const enemy = this.enemyManager?.getEnemy(dot.enemyId);
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
