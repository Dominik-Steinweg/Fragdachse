import { NavigationGeometry } from './NavigationGeometry';
import { NEIGHBOR_DIRECTIONS, type FlowFieldMetrics, type FlowFieldTopology,
  type FlowFieldNeighborLookups } from '../flowfield/FlowFieldKernel';

export interface NavigationGraph {
  readonly radius: number;
  readonly edges: Uint8Array;
  readonly regions: Int32Array;
  readonly traversable: Uint8Array;
}

export function navigationPoint(metrics: FlowFieldMetrics, index: number): { x: number; y: number } {
  return { x: metrics.arenaOffsetX + ((index % metrics.cols) + (metrics.pointOffset ?? 0.5)) * metrics.cellSize,
    y: metrics.arenaOffsetY + (Math.floor(index / metrics.cols) + (metrics.pointOffset ?? 0.5)) * metrics.cellSize };
}

/** Hard connectivity is independent of terrain and density costs. */
export function buildNavigationGraph(metrics: FlowFieldMetrics, geometry: NavigationGeometry,
  radius: number, lookups: FlowFieldNeighborLookups, topology: FlowFieldTopology): NavigationGraph {
  const total = metrics.cols * metrics.rows;
  const edges = new Uint8Array(total), regions = new Int32Array(total);
  const traversable = topology.traversable;
  for (let index = 0; index < total; index++) {
    const p = navigationPoint(metrics, index);
    traversable[index] = geometry.isFree(p.x, p.y, radius) ? 1 : 0;
  }
  // Only four undirected connections per point; reverse edges are identical by construction.
  for (let index = 0; index < total; index++) {
    if (!traversable[index]) continue;
    const p = navigationPoint(metrics, index);
    for (const direction of [0, 2, 4, 6]) {
      const next = lookups.neighborIndices[index * 8 + direction];
      if (next < 0 || !traversable[next]) continue;
      const [dx, dy] = NEIGHBOR_DIRECTIONS[direction];
      if (!geometry.canMove(p.x, p.y, p.x + dx * metrics.cellSize, p.y + dy * metrics.cellSize, radius)) continue;
      edges[index] |= 1 << direction;
      edges[next] |= 1 << (direction ^ 1);
    }
  }
  const queue = new Int32Array(total);
  let region = 0;
  for (let index = 0; index < total; index++) {
    if (!traversable[index] || regions[index]) continue;
    region++; let head = 0, tail = 1; queue[0] = index; regions[index] = region;
    while (head < tail) {
      const current = queue[head++], mask = edges[current];
      for (let direction = 0; direction < 8; direction++) {
        if (!(mask & (1 << direction))) continue;
        const next = lookups.neighborIndices[current * 8 + direction];
        if (!regions[next]) { regions[next] = region; queue[tail++] = next; }
      }
    }
  }
  topology.edges = edges;
  topology.distanceScale = metrics.cellSize;
  return { radius, edges, regions, traversable };
}
