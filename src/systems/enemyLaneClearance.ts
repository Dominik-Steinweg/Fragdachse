import type { CombatGeometryPort } from '../combat/CombatCapabilities';

type LaneMeasure = { measureChargeLane?: (x: number, y: number, angle: number, length: number, radius: number) => number };

/**
 * Free travel of a body of `radius` along a straight lane: world geometry from combat, then
 * water and other walkability limits shorten it until the swept body path is walkable. Shared by
 * every host-locked lane (charger runs and leaps, Kabummtula leaps).
 */
export function createEnemyLaneClearance(combat: Partial<CombatGeometryPort> & LaneMeasure,
  hasWalkableEnemyCircleLine: (fromX: number, fromY: number, toX: number, toY: number, radius: number) => boolean,
): (x: number, y: number, angle: number, length: number, radius: number) => number {
  return (x, y, angle, length, radius) => {
    let free = combat.measureChargeLane?.(x, y, angle, length, radius) ?? 0;
    const walkable = (distance: number) => hasWalkableEnemyCircleLine(x, y,
      x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, radius);
    if (free > 0 && !walkable(free)) {
      let low = 0, high = free;
      for (let i = 0; i < 10; i++) { const mid = (low + high) / 2; if (walkable(mid)) low = mid; else high = mid; }
      free = low;
    }
    return free;
  };
}
