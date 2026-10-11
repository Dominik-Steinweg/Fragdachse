import type { CoopDefenseEnemyMortarConfig } from '../config/coopDefenseEnemies';
import type { EnemyFlowFieldService } from './EnemyFlowFieldService';

export interface MortarPoint { readonly x: number; readonly y: number }
export interface MortarLocalPosition extends MortarPoint {
  readonly travelDistance: number;
  readonly path: readonly MortarPoint[];
}

export type MortarNavigation = Pick<EnemyFlowFieldService, 'worldToGrid' | 'gridToWorld' | 'getCellSize'
  | 'forEachReachableNeighbor' | 'hasWalkableCircleLine' | 'findNearestReachableWorldPosition'
  | 'getTopologyVersion'>;

/** A bounded local flood of the existing topology; no second occupancy grid or global route search. */
export function findMortarLocalPositions(origin: MortarPoint, radius: number, config: CoopDefenseEnemyMortarConfig,
  field: MortarNavigation | null): MortarLocalPosition[] {
  const positions: MortarLocalPosition[] = [{ ...origin, travelDistance: 0, path: [] }];
  if (!field) return positions;
  const cell = field.worldToGrid(origin.x, origin.y);
  if (!cell) return positions;
  const pending: MortarPoint[] = [];
  const directKeys = new Set<string>();
  for (let ring = 1; ring <= config.positionCandidateRings; ring++) {
    for (let direction = 0; direction < config.positionCandidateDirections; direction++) {
      const angle = direction * Math.PI * 2 / config.positionCandidateDirections;
      const reach = config.localSearchRadiusPx * ring / config.positionCandidateRings;
      const desired = { x: origin.x + Math.cos(angle) * reach, y: origin.y + Math.sin(angle) * reach };
      const targetCell = field.worldToGrid(desired.x, desired.y);
      const point = targetCell && field.gridToWorld(targetCell.gridX, targetCell.gridY);
      if (point && distance(origin, point) <= config.localSearchRadiusPx
        && field.hasWalkableCircleLine(origin.x, origin.y, point.x, point.y, radius)) {
        const key = `${point.x}:${point.y}`;
        if (!directKeys.has(key) && distance(origin, point) > config.positionArrivalTolerancePx) {
          positions.push({ ...point, travelDistance: distance(origin, point), path: [point] });
          directKeys.add(key);
        }
      } else pending.push(desired);
    }
  }
  if (!pending.length) return positions;
  const cellPoint = field.gridToWorld(cell.gridX, cell.gridY);
  const start = cellPoint && field.hasWalkableCircleLine(origin.x, origin.y, cellPoint.x, cellPoint.y, radius)
    ? cellPoint : field.findNearestReachableWorldPosition(cell.gridX, cell.gridY);
  if (!start || distance(origin, start) > config.localSearchRadiusPx
    || !field.hasWalkableCircleLine(origin.x, origin.y, start.x, start.y, radius)) return positions;
  const startCell = field.worldToGrid(start.x, start.y);
  if (!startCell) return positions;
  type Node = MortarPoint & { gridX: number; gridY: number; parent: number; distance: number };
  const nodes: Node[] = [{ ...start, ...startCell, parent: -1, distance: distance(origin, start) }];
  const visited = new Set([`${startCell.gridX}:${startCell.gridY}`]);
  for (let cursor = 0; cursor < nodes.length && nodes.length < config.maxLocalSearchCells; cursor++) {
    const node = nodes[cursor];
    field.forEachReachableNeighbor(node.gridX, node.gridY, (gridX, gridY) => {
      if (nodes.length >= config.maxLocalSearchCells) return;
      const key = `${gridX}:${gridY}`;
      if (visited.has(key)) return;
      const point = field.gridToWorld(gridX, gridY);
      if (!point || distance(origin, point) > config.localSearchRadiusPx) return;
      if (!field.hasWalkableCircleLine(node.x, node.y, point.x, point.y, radius)) return;
      visited.add(key);
      nodes.push({ ...point, gridX, gridY, parent: cursor, distance: node.distance + distance(node, point) });
    });
  }
  const selected = new Set<number>();
  for (const desired of pending) {
    let best = -1, bestDistance = field.getCellSize() * Math.SQRT2;
    for (let i = 0; i < nodes.length; i++) {
      const delta = distance(desired, nodes[i]);
      if (delta < bestDistance) { best = i; bestDistance = delta; }
    }
    if (best < 0 || selected.has(best) || directKeys.has(`${nodes[best].x}:${nodes[best].y}`)
      || distance(origin, nodes[best]) <= config.positionArrivalTolerancePx) continue;
    selected.add(best);
    const point = nodes[best];
    if (field.hasWalkableCircleLine(origin.x, origin.y, point.x, point.y, radius)) {
      positions.push({ x: point.x, y: point.y, travelDistance: distance(origin, point), path: [point] });
    } else {
      const path: MortarPoint[] = [];
      for (let i = best; i >= 0; i = nodes[i].parent) path.push({ x: nodes[i].x, y: nodes[i].y });
      path.reverse();
      positions.push({ x: point.x, y: point.y, travelDistance: point.distance, path });
    }
  }
  return positions;
}

export function distance(a: MortarPoint, b: MortarPoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }
