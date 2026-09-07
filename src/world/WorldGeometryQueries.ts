import * as Phaser from 'phaser';
import type { MuzzleOrigin } from '../config';
import { CombatGeometry, type ObstacleTraceOptions } from '../systems/CombatGeometry';
import type { ArenaObstacleIndex } from '../systems/ArenaObstacleIndex';
import type { WorldMetrics } from './WorldMetrics';

export interface WorldGeometryQueryOptions extends ObstacleTraceOptions {
  readonly clearanceRadius?: number;
}

export interface WorldTargetGeometry {
  readonly x: number;
  readonly y: number;
  /** The authored gameplay hit radius, never a renderer-derived radius. */
  readonly hitRadius: number;
}

export interface WorldGeometryQueries {
  readonly metrics: WorldMetrics;
  /** Explicit startup warmup; does not mutate gameplay state. */
  prepare(): void;
  getWorldMetrics(): WorldMetrics;
  hasLineOfSight(
    startX: number, startY: number, endX: number, endY: number,
    options?: WorldGeometryQueryOptions,
  ): boolean;
  hasLineOfFire(
    startX: number, startY: number, endX: number, endY: number,
    options?: WorldGeometryQueryOptions,
  ): boolean;
  /** Circle clearance query for mechanics such as Burrow exit placement. */
  isCircleBlocked(x: number, y: number, radius: number): boolean;
  /** Bounded deterministic ground placement. Null means invalid geometry, never a renderer fallback. */
  resolveSafeGroundPoint(x: number, y: number, radius: number): { x: number; y: number } | null;
  resolveSafeGameplayMuzzle(
    shooterX: number,
    shooterY: number,
    desiredMuzzle: MuzzleOrigin,
    options?: WorldGeometryQueryOptions,
  ): MuzzleOrigin;
  resolveTargetGeometry?(targetId: string, targetType: string): WorldTargetGeometry | null;
}

interface WorldGeometryQueryInput {
  readonly metrics: WorldMetrics;
  readonly index: ArenaObstacleIndex;
  readonly getTrainBounds?: () => Phaser.Geom.Rectangle | null;
  readonly resolveTargetGeometry?: (targetId: string, targetType: string) => WorldTargetGeometry | null;
  readonly isActive?: () => boolean;
}

/**
 * Read-only World geometry adapter.  It owns no Combat state and can therefore be used by
 * host queries and passive client previews alike.  The index and train provider are supplied by
 * the World binding; callers never reach into WorldCombatCore internals.
 */
export function createWorldGeometryQueries(input: WorldGeometryQueryInput): WorldGeometryQueries {
  // Keep the binding constructible in headless/lobby contexts where Phaser geometry classes are
  // deliberately not installed.  The numeric adapter is materialized only on first query.
  let geometry: CombatGeometry | null = null;
  let line: Phaser.Geom.Line | null = null;
  let expandedTrain: Phaser.Geom.Rectangle | null = null;
  const ensureGeometry = (): { geometry: CombatGeometry; line: Phaser.Geom.Line; expandedTrain: Phaser.Geom.Rectangle } => {
    if (!geometry) {
      geometry = new CombatGeometry(input.index);
      line = new Phaser.Geom.Line();
      expandedTrain = new Phaser.Geom.Rectangle();
    }
    return { geometry, line: line!, expandedTrain: expandedTrain! };
  };
  const active = (): boolean => input.isActive?.() !== false;

  const resolveSafeGroundPoint = (x: number, y: number, radius: number): { x: number; y: number } | null => {
    if (!active() || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) return null;
    const { offsetX, offsetY, widthPx, heightPx } = input.metrics;
    if (widthPx < radius * 2 || heightPx < radius * 2) return null;
    const cx = Math.max(offsetX + radius, Math.min(offsetX + widthPx - radius, x));
    const cy = Math.max(offsetY + radius, Math.min(offsetY + heightPx - radius, y));
    const train = input.getTrainBounds?.();
    const valid = (px: number, py: number): boolean => (
      px >= offsetX + radius && px <= offsetX + widthPx - radius
      && py >= offsetY + radius && py <= offsetY + heightPx - radius
      && !input.index.isCircleBlocked(px, py, radius)
      && !(train && px + radius >= train.x && px - radius <= train.x + train.width
        && py + radius >= train.y && py - radius <= train.y + train.height)
    );
    if (valid(cx, cy)) return { x: cx, y: cy };
    // Fixed radial order and finite work; do not turn malformed layouts into a persistent retry job.
    for (let ring = 1; ring <= 16; ring++) {
      const distance = ring * 16;
      const samples = Math.min(32, ring * 8);
      for (let sample = 0; sample < samples; sample++) {
        const angle = sample * Math.PI * 2 / samples;
        const px = cx + Math.cos(angle) * distance;
        const py = cy + Math.sin(angle) * distance;
        if (valid(px, py)) return { x: px, y: py };
      }
    }
    return null;
  };

  const getTrainHit = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    clearanceRadius: number,
  ): boolean => {
    const train = input.getTrainBounds?.();
    if (!train) return false;
    const adapter = ensureGeometry();
    adapter.line.setTo(startX, startY, endX, endY);
    adapter.expandedTrain.setTo(
      train.x - clearanceRadius,
      train.y - clearanceRadius,
      train.width + clearanceRadius * 2,
      train.height + clearanceRadius * 2,
    );
    const hit = adapter.geometry.nearestRectangleHit(adapter.line, adapter.expandedTrain);
    return hit !== null && hit.distance < Phaser.Geom.Line.Length(adapter.line) - 2;
  };

  const resolveSafeGameplayMuzzle = (
    shooterX: number,
    shooterY: number,
    desiredMuzzle: MuzzleOrigin,
    options: WorldGeometryQueryOptions = {},
  ): MuzzleOrigin => {
    if (!active()) return { ...desiredMuzzle };
    const dx = desiredMuzzle.x - shooterX;
    const dy = desiredMuzzle.y - shooterY;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.0001) return { ...desiredMuzzle };
    const adapter = ensureGeometry();
    adapter.line.setTo(shooterX, shooterY, desiredMuzzle.x, desiredMuzzle.y);
    const clearance = Math.max(0, options.clearanceRadius ?? 0);
    let blockerDistance = Number.POSITIVE_INFINITY;
    const obstacle = adapter.geometry.nearestObstacleHit(adapter.line, { ...options, clearanceRadius: clearance });
    if (obstacle) blockerDistance = Math.min(blockerDistance, obstacle.distance);
    const train = input.getTrainBounds?.();
    if (train) {
      adapter.expandedTrain.setTo(
        train.x - clearance,
        train.y - clearance,
        train.width + clearance * 2,
        train.height + clearance * 2,
      );
      const trainHit = adapter.geometry.nearestRectangleHit(adapter.line, adapter.expandedTrain);
      if (trainHit) blockerDistance = Math.min(blockerDistance, trainHit.distance);
    }
    const minX = input.metrics.offsetX + clearance;
    const maxX = input.metrics.offsetX + input.metrics.widthPx - clearance;
    const minY = input.metrics.offsetY + clearance;
    const maxY = input.metrics.offsetY + input.metrics.heightPx - clearance;
    let exit = 1;
    if (dx > 0 && desiredMuzzle.x > maxX) exit = Math.min(exit, (maxX - shooterX) / dx);
    if (dx < 0 && desiredMuzzle.x < minX) exit = Math.min(exit, (minX - shooterX) / dx);
    if (dy > 0 && desiredMuzzle.y > maxY) exit = Math.min(exit, (maxY - shooterY) / dy);
    if (dy < 0 && desiredMuzzle.y < minY) exit = Math.min(exit, (minY - shooterY) / dy);
    if (exit < 1 && exit >= 0) blockerDistance = Math.min(blockerDistance, distance * exit);
    if (!Number.isFinite(blockerDistance)) return { ...desiredMuzzle };
    const safeDistance = Math.max(0, Math.min(distance, blockerDistance) - 0.25);
    return { x: shooterX + (dx / distance) * safeDistance, y: shooterY + (dy / distance) * safeDistance };
  };

  return {
    metrics: input.metrics,
    prepare: () => { if (active()) input.index.prepare(); },
    getWorldMetrics: () => input.metrics,
    resolveSafeGroundPoint,
    hasLineOfSight: (startX, startY, endX, endY, options = {}) => (
      !active() || ensureGeometry().geometry.hasLineOfSight(startX, startY, endX, endY, options)
    ),
    hasLineOfFire: (startX, startY, endX, endY, options = {}) => (
      !active()
      || (ensureGeometry().geometry.hasLineOfSight(startX, startY, endX, endY, options)
        && !getTrainHit(startX, startY, endX, endY, Math.max(0, options.clearanceRadius ?? 0)))
    ),
    isCircleBlocked: (x, y, radius) => (
      active() ? input.index.isCircleBlocked(x, y, radius) : false
    ),
    resolveSafeGameplayMuzzle,
    ...(input.resolveTargetGeometry
      ? { resolveTargetGeometry: (targetId: string, targetType: string) => (
        active() ? input.resolveTargetGeometry!(targetId, targetType) : null
      ) }
      : {}),
  };
}
