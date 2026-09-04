import * as Phaser from 'phaser';
import type { MuzzleOrigin } from '../config';
import type { ProjectileSpawnConfig } from '../types';
import { CombatGeometry } from './CombatGeometry';
import { MIN_PROJECTILE_BODY_LENGTH } from '../projectile/ProjectileFlightConstants';

/** Minimale Body-Länge entlang der Flugrichtung für das bestehende Anti-Tunneling. */
export const MIN_BODY_LEN = MIN_PROJECTILE_BODY_LENGTH;

/** Der Leaf-Blower nutzt bewusst einen kleineren Hinderniskörper als seine Visual-/Trefferfläche. */
export const LEAF_BLOWER_OBSTACLE_BODY_SCALE = 0.6;

/** Nur ein kleiner Rückversatz vom bereits aufgeblasenen Hindernistreffer. */
const SAFE_MUZZLE_EPSILON = 0.25;

export interface ProjectileBodyProfile {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  /** Konservativer radialer Abstand des tatsächlich verwendeten Arcade-Body-Rechtecks. */
  conservativeClearance: number;
}

/**
 * Gemeinsames Body-Profil für Safe-Muzzle und die anschließende Arcade-Body-Erzeugung.
 * Die Werte spiegeln bewusst die bisherige ProjectileManager-Logik wider.
 */
export function resolveProjectileBodyProfile(
  cfg: ProjectileSpawnConfig,
  angle: number,
): ProjectileBodyProfile {
  const isFlame = cfg.projectileStyle === 'flame';
  const isLeafBlower = cfg.projectileStyle === 'leaf_blower';
  const isBfg = cfg.projectileStyle === 'bfg';
  const isAntiTunnelingBody = !isFlame
    && !isLeafBlower
    && !isBfg
    && !cfg.isGrenade
    && cfg.size < MIN_BODY_LEN;

  let width = cfg.size;
  let height = cfg.size;
  let offsetX = 0;
  let offsetY = 0;

  if (isAntiTunnelingBody) {
    const vx = Math.abs(Math.cos(angle));
    const vy = Math.abs(Math.sin(angle));
    width = Math.max(cfg.size, vx * MIN_BODY_LEN);
    height = Math.max(cfg.size, vy * MIN_BODY_LEN);
    offsetX = (cfg.size - width) / 2;
    offsetY = (cfg.size - height) / 2;
  } else if (isLeafBlower) {
    const obstacleBodySize = Math.max(cfg.size * LEAF_BLOWER_OBSTACLE_BODY_SCALE, 10);
    width = obstacleBodySize;
    height = obstacleBodySize;
    offsetX = (cfg.size - obstacleBodySize) / 2;
    offsetY = (cfg.size - obstacleBodySize) / 2;
  }

  return {
    width,
    height,
    offsetX,
    offsetY,
    conservativeClearance: Math.hypot(width, height) * 0.5,
  };
}

export interface SafeMuzzleSpawnContext {
  /** Gemeinsamer CombatGeometry-Wrapper über dem bestehenden ArenaObstacleIndex. */
  geometry?: CombatGeometry | null;
  /** Aktuelle zusammengefasste Zug-Bounds; der Zug gehört nicht zum statischen Index. */
  trainBounds?: Phaser.Geom.Rectangle | null;
  /** Tatsächliche Arcade-World-Bounds der laufenden Arena. */
  worldBounds?: Phaser.Geom.Rectangle | null;
}

/**
 * Löst ausschließlich die kurze Strecke vom Fire-Request-Ursprung zur sichtbaren Mündung auf.
 * Trefferpunkt und Körper-Clearance kommen aus derselben aufgeblasenen Geometrie; nach dem
 * Treffer wird deshalb nur ein minimales Epsilon entgegen der Strecke abgezogen.
 */
export function resolveSafeMuzzleSpawn(
  shooterX: number,
  shooterY: number,
  desiredMuzzle: MuzzleOrigin,
  angle: number,
  cfg: ProjectileSpawnConfig,
  context: SafeMuzzleSpawnContext,
  bodyProfile = resolveProjectileBodyProfile(cfg, angle),
): MuzzleOrigin {
  const dx = desiredMuzzle.x - shooterX;
  const dy = desiredMuzzle.y - shooterY;
  const length = Math.hypot(dx, dy);
  if (length <= 0.0001) return { x: shooterX, y: shooterY };

  const directionX = dx / length;
  const directionY = dy / length;
  const line = new Phaser.Geom.Line(shooterX, shooterY, desiredMuzzle.x, desiredMuzzle.y);
  const clearanceRadius = bodyProfile.conservativeClearance;

  // Die bestehende Geometry-API kann penetrative Rock-Pfade nicht selektiv
  // genug filtern. Daher bleibt hier der bisherige Shooter-Ursprung erhalten,
  // statt neue Blocker- oder Kollisionssemantik einzuführen.
  if (cfg.penetratesRocks) {
    return { x: shooterX, y: shooterY };
  }

  let blockerDistance = Number.POSITIVE_INFINITY;

  const isBfgOrGauss = cfg.projectileStyle === 'bfg' || cfg.projectileStyle === 'gauss';
  // Diese Projektiltypen passieren Welt-Hindernisse im normalen Flug per Overlap. Für sie
  // werden deshalb nur die normalen World-Bounds berücksichtigt.
  const resolvesWorldObstacleBlockers = !isBfgOrGauss;

  if (resolvesWorldObstacleBlockers && context.geometry) {
    const obstacleHit = context.geometry.nearestObstacleHit(line, {
      clearanceRadius,
      skipRockIndex: cfg.ignoreRockIndex,
      ignoreBases: cfg.ignoreBaseCollisions,
    });
    if (obstacleHit) blockerDistance = Math.min(blockerDistance, obstacleHit.distance);

    if (context.trainBounds) {
      const train = context.trainBounds;
      const expandedTrain = new Phaser.Geom.Rectangle(
        train.x - clearanceRadius,
        train.y - clearanceRadius,
        train.width + clearanceRadius * 2,
        train.height + clearanceRadius * 2,
      );
      const trainHit = context.geometry.nearestRectangleHit(line, expandedTrain);
      if (trainHit) blockerDistance = Math.min(blockerDistance, trainHit.distance);
    }
  }

  const worldExitDistance = findWorldExitDistance(
    shooterX,
    shooterY,
    desiredMuzzle,
    clearanceRadius,
    context.worldBounds,
  );
  if (worldExitDistance !== null) blockerDistance = Math.min(blockerDistance, worldExitDistance);

  if (!Number.isFinite(blockerDistance)) return { x: desiredMuzzle.x, y: desiredMuzzle.y };

  const safeDistance = Math.max(0, Math.min(length, blockerDistance) - SAFE_MUZZLE_EPSILON);
  return {
    x: shooterX + directionX * safeDistance,
    y: shooterY + directionY * safeDistance,
  };
}

function findWorldExitDistance(
  startX: number,
  startY: number,
  end: MuzzleOrigin,
  clearance: number,
  bounds?: Phaser.Geom.Rectangle | null,
): number | null {
  if (!bounds) return null;

  const minX = bounds.left + clearance;
  const maxX = bounds.right - clearance;
  const minY = bounds.top + clearance;
  const maxY = bounds.bottom - clearance;
  const dx = end.x - startX;
  const dy = end.y - startY;
  let exitT = 1;

  if (dx > 0 && end.x > maxX) exitT = Math.min(exitT, (maxX - startX) / dx);
  if (dx < 0 && end.x < minX) exitT = Math.min(exitT, (minX - startX) / dx);
  if (dy > 0 && end.y > maxY) exitT = Math.min(exitT, (maxY - startY) / dy);
  if (dy < 0 && end.y < minY) exitT = Math.min(exitT, (minY - startY) / dy);

  if (exitT >= 1 || exitT < 0) return null;
  return Math.hypot(dx, dy) * exitT;
}
