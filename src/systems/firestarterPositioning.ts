import { resolveFirestarterAim, type CoopDefenseEnemyFirestarterConfig } from '../config/coopDefenseEnemies';
import type { CombatGeometryPort } from '../combat/CombatCapabilities';
import type { EnemyEntity } from '../entities/EnemyEntity';
import { findWeaponConfig } from '../loadout/LoadoutConfig';
import type { ProjectileDetonableReadPort } from '../projectile/ProjectileGameplayPort';
import type { EnemyDodgeMode, EnemyDodgeRequestPort } from './CoopDefenseEnemyDodgeSystem';
import { DASH_T1_S, DASH_T2_S } from '../config';

interface Point { readonly x: number; readonly y: number }
type Geometry = Pick<CombatGeometryPort, 'hasClearLineOfFire'>;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Project only still-live, detonatable balls; both attack selection and positioning use this rule. */
function predictedBalls(enemyId: string, config: CoopDefenseEnemyFirestarterConfig,
  projectiles: ProjectileDetonableReadPort, leadMs: number): Point[] {
  const tags = findWeaponConfig(config.lanceWeaponId)!.detonator!.triggerTags;
  const points: Point[] = [];
  projectiles.readDetonableProjectiles(ball => {
    if (!tags.includes(ball.tag) || (!ball.allowCrossTeam && ball.ownerId !== enemyId)
      || (ball.remainingLifetimeMs ?? Infinity) <= leadMs) return;
    points.push({ x: ball.x + (ball.vx ?? 0) * leadMs / 1000, y: ball.y + (ball.vy ?? 0) * leadMs / 1000 });
  });
  return points;
}

function hasLine(origin: Point, target: Point, config: CoopDefenseEnemyFirestarterConfig, geometry: Geometry, clearanceRadius = 0): boolean {
  const aim = resolveFirestarterAim(config.muzzle, origin.x, origin.y, target.x, target.y);
  return geometry.hasClearLineOfFire(aim.x, aim.y, target.x, target.y, { purpose: 'directFire', clearanceRadius });
}

function ballRadius(config: CoopDefenseEnemyFirestarterConfig): number {
  const fire = findWeaponConfig(config.fireballWeaponId)!.fire;
  return fire.type === 'projectile' ? fire.projectileSize / 2 : 0;
}

function intercepts(origin: Point, target: Point, ball: Point, config: CoopDefenseEnemyFirestarterConfig): boolean {
  const aim = resolveFirestarterAim(config.muzzle, origin.x, origin.y, target.x, target.y);
  const dx = target.x - aim.x, dy = target.y - aim.y, lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0) return false;
  const t = ((ball.x - aim.x) * dx + (ball.y - aim.y) * dy) / lengthSq;
  return t >= 0 && t <= 1 && distance(ball, { x: aim.x + t * dx, y: aim.y + t * dy }) <= ballRadius(config);
}

export function hasFirestarterDirectLine(enemyId: string, origin: Point, target: Point,
  config: CoopDefenseEnemyFirestarterConfig, projectiles: ProjectileDetonableReadPort, geometry: Geometry,
  leadMs = config.lance.telegraphMs, clearanceRadius = 0): boolean {
  return directLine(origin, target, config, geometry, clearanceRadius,
    () => predictedBalls(enemyId, config, projectiles, leadMs));
}

function directLine(origin: Point, target: Point, config: CoopDefenseEnemyFirestarterConfig,
  geometry: Geometry, clearanceRadius: number, balls: () => readonly Point[]): boolean {
  return hasLine(origin, target, config, geometry, clearanceRadius)
    && !balls().some(ball => intercepts(origin, target, ball, config));
}

export function findFirestarterCombo(enemyId: string, origin: Point, targets: readonly Point[],
  config: CoopDefenseEnemyFirestarterConfig, projectiles: ProjectileDetonableReadPort, geometry: Geometry,
  leadMs = config.lance.telegraphMs): Point | null {
  return findCombo(origin, targets, config, geometry, predictedBalls(enemyId, config, projectiles, leadMs));
}

function findCombo(origin: Point, targets: readonly Point[], config: CoopDefenseEnemyFirestarterConfig,
  geometry: Geometry, balls: readonly Point[]): Point | null {
  let best: Point | null = null, bestDistance = Infinity;
  for (const ball of balls) {
    // Use the predicted position: a ball outside range now can travel into reach during windup.
    // Reject before the per-target work, but retain all balls for interception checks.
    if (distance(origin, ball) > config.lance.rangePx) continue;
    const proximity = Math.min(...targets.map(target => distance(target, ball)));
    if (proximity > config.comboRadiusPx || proximity >= bestDistance
      || !hasLine(origin, ball, config, geometry)
      // A nearer orb would intercept the lance before its intended combo.
      || balls.some(other => other !== ball && distance(origin, other) < distance(origin, ball)
        && intercepts(origin, ball, other, config))) continue;
    best = ball; bestDistance = proximity;
  }
  return best;
}

/** One enemy's local decision memory. No route, velocity or second dodge cooldown is owned here. */
export class FirestarterPositioning {
  private evaluateAt = -Infinity;
  private holdUntil = -Infinity;

  tryReposition(enemy: EnemyEntity, targets: readonly Point[], config: CoopDefenseEnemyFirestarterConfig,
    projectiles: ProjectileDetonableReadPort, geometry: Geometry, dodge: EnemyDodgeRequestPort, nowMs: number): boolean {
    if (!targets.length || nowMs < this.evaluateAt || nowMs < this.holdUntil || dodge.isDodging(enemy.id)) return false;
    const tuning = config.positioning;
    this.evaluateAt = nowMs + tuning.reevaluateIntervalMs;
    const target = targets[0], origin = enemy.sprite, range = distance(origin, target);
    if (range <= 0) return false;
    const sideways = { x: -(target.y - origin.y) / range, y: (target.x - origin.x) / range };
    // All candidate positions share the same live sample and just two prediction horizons.
    // Keep this cache inside one synchronous decision; firing/conversion cannot leave it stale.
    const predictions = new Map<number, readonly Point[]>();
    const ballsAt = (leadMs: number) => {
      let balls = predictions.get(leadMs);
      if (!balls) {
        balls = predictedBalls(enemy.id, config, projectiles, leadMs);
        predictions.set(leadMs, balls);
      }
      return balls;
    };
    // Quality ranks express attack priority; travel cost and the improvement threshold are authored.
    const quality = (point: Point, leadMs: number): number => {
      if (findCombo(point, targets, config, geometry, ballsAt(leadMs))) return 2;
      return targets.some(player => distance(point, player) <= config.lance.rangePx
        && directLine(point, player, config, geometry, ballRadius(config), () => ballsAt(leadMs))) ? 1 : 0;
    };
    const current = quality(origin, config.lance.telegraphMs);
    let best: { direction: Point; mode: EnemyDodgeMode; score: number } | null = null;
    for (const mode of ['short', 'long'] as const) {
      const step = dodge.getDodgeDistance(enemy.id, mode);
      for (const side of [1, -1]) {
        const direction = { x: sideways.x * side, y: sideways.y * side };
        const point = { x: origin.x + direction.x * step, y: origin.y + direction.y * step };
        const targetDistance = distance(point, target);
        if (step <= 0 || targetDistance < tuning.minDistancePx || targetDistance > tuning.maxDistancePx
          || !dodge.canDodgeTo(enemy.id, direction, mode)) continue;
        const score = quality(point, config.lance.telegraphMs + (DASH_T1_S + DASH_T2_S) * 1000)
          - step * tuning.movementCostPerPx;
        if (score < current + tuning.minImprovement || (best && score <= best.score)) continue;
        best = { direction, mode, score };
      }
    }
    if (!best || !dodge.requestDodge(enemy.id, best.direction, best.mode, nowMs)) return false;
    this.holdUntil = nowMs + tuning.minDwellMs;
    return true;
  }
}
