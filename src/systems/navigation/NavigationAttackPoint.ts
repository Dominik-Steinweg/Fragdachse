import type { NavigationObstacle, NavigationPoint } from './NavigationGeometry';

/** Matches Combat's base-surface and rock/construct-center targeting contracts. */
export function navigationAttackPoint(shape: NavigationObstacle, x: number, y: number): NavigationPoint {
  if (shape.shape === 'circle') return { x: shape.x, y: shape.y };
  return shape.kind === 'base'
    ? { x: Math.max(shape.left, Math.min(shape.right, x)), y: Math.max(shape.top, Math.min(shape.bottom, y)) }
    : { x: (shape.left + shape.right) / 2, y: (shape.top + shape.bottom) / 2 };
}
