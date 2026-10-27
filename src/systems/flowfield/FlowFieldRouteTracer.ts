import { navigationPoint } from '../navigation/NavigationGraph';
import type { FlowFieldMetrics } from './FlowFieldKernel';
import { PORTAL_LINK_STRIDE } from './FlowFieldProtocol';

/** What a route needs from a computed field. */
export interface FlowFieldRouteSnapshot {
  readonly integrationField: Float32Array;
  readonly vectorField: Float32Array;
  readonly portalLinks: Int32Array;
}

export interface FlowFieldRoutePoint {
  readonly x: number;
  readonly y: number;
  /** Remaining integration cost to the goal; it falls along the route and is shared where routes merge. */
  readonly goalDistance: number;
}

export interface FlowFieldRoute {
  readonly points: readonly FlowFieldRoutePoint[];
  readonly reachedGoal: boolean;
}

/**
 * The node one step downhill along the field, or -1 at a goal, a portal entry or a dead end.
 * Enemy steering and route tracing take the same step.
 */
export function nextFlowFieldNode(snapshot: Pick<FlowFieldRouteSnapshot, 'vectorField'>, metrics: FlowFieldMetrics, index: number): number {
  const vx = snapshot.vectorField[index * 2], vy = snapshot.vectorField[index * 2 + 1];
  if (!vx && !vy) return -1;
  return index + Math.sign(vx) + Math.sign(vy) * metrics.cols;
}

/**
 * Follows a field from a start node down to its goal, jumping portal links like an enemy does.
 * Stops without reaching a goal when the start has no path (infinite cost) or a cycle appears.
 */
export function traceFlowFieldRoute(snapshot: FlowFieldRouteSnapshot, metrics: FlowFieldMetrics, startIndex: number): FlowFieldRoute {
  const points: FlowFieldRoutePoint[] = [];
  const visited = new Set<number>();
  let index = startIndex;
  const total = metrics.cols * metrics.rows;
  while (index >= 0 && index < total && !visited.has(index)) {
    const cost = snapshot.integrationField[index];
    if (!Number.isFinite(cost)) return { points, reachedGoal: false };
    visited.add(index);
    const point = navigationPoint(metrics, index);
    points.push({ x: point.x, y: point.y, goalDistance: cost });
    if (cost === 0) return { points, reachedGoal: true };
    const next = nextFlowFieldNode(snapshot, metrics, index);
    if (next >= 0) { index = next; continue; }
    index = portalExit(snapshot.portalLinks, index);
  }
  return { points, reachedGoal: false };
}

function portalExit(links: Int32Array, entry: number): number {
  for (let cursor = 0; cursor + PORTAL_LINK_STRIDE <= links.length; cursor += PORTAL_LINK_STRIDE) {
    if (links[cursor] === entry) return links[cursor + 1];
  }
  return -1;
}
