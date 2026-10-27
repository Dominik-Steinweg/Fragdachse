import { describe, expect, it } from 'vitest';
import {
  buildRouteFlowGeometry, ROUTE_FLOW_INSTANCE_FLOATS, RouteFlowKind, RouteFlowStore, type RouteFlowRoute,
} from '../src/effects/routeFlow/RouteFlowStore';

/** A flow-field route on the 16 px node grid: straight runs and 45° steps. */
function route(steps: readonly [number, number][], start: [number, number], extra: Partial<RouteFlowRoute> = {}): RouteFlowRoute {
  const points = [{ x: start[0] * 16, y: start[1] * 16 }];
  let [x, y] = start;
  for (const [dx, dy] of steps) { x += dx; y += dy; points.push({ x: x * 16, y: y * 16 }); }
  return { points, breach: false, strength: 1, ...extra };
}
const repeat = (step: [number, number], count: number): [number, number][] => Array.from({ length: count }, () => step);

// Two routes from the north-west and south-west meet at (20, 10) and flow east together.
const trunk = repeat([1, 0], 20);
const north = route([...repeat([1, 1], 10), ...repeat([1, 0], 10), ...trunk], [0, 0]);
const south = route([...repeat([1, -1], 10), ...trunk], [10, 20]);

describe('route flow geometry', () => {
  it('merges shared route sections into one wider stream', () => {
    const geometry = buildRouteFlowGeometry([north, south], { tolerance: .75 });
    const shared = geometry.segments.filter((segment) => segment.ax >= 20 * 16 - .01);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.every((segment) => segment.usage === 2)).toBe(true);
    expect(geometry.segments.filter((segment) => segment.ax < 20 * 16 - .01).every((segment) => segment.usage === 1)).toBe(true);
    // No duplicate stream on the trunk.
    const keys = geometry.segments.map((segment) => segment.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('flows on across a junction: distances to the goal agree and fall along every segment', () => {
    const geometry = buildRouteFlowGeometry([north, south], { tolerance: .75 });
    for (const segment of geometry.segments) expect(segment.distB).toBeLessThan(segment.distA);
    const junction = { x: 20 * 16, y: 10 * 16 };
    const at = (x: number, y: number) => Math.hypot(x - junction.x, y - junction.y) < .01;
    const into = geometry.segments.filter((segment) => at(segment.bx, segment.by));
    const out = geometry.segments.filter((segment) => at(segment.ax, segment.ay));
    expect(into).toHaveLength(2);
    expect(out).toHaveLength(1);
    for (const segment of into) expect(segment.distB).toBeCloseTo(out[0]!.distA, 6);
    // The goal is where the distance ends.
    const end = geometry.segments.find((segment) => Math.abs(segment.bx - 40 * 16) < .01)!;
    expect(end.distB).toBeCloseTo(0, 6);
  });

  it('heats a breach route towards the wall and marks sources, entries and the breach', () => {
    const breach = route(repeat([1, 0], 30), [0, 40], { breach: true });
    const geometry = buildRouteFlowGeometry([breach], { tolerance: .75, isInsideBuildArea: (x) => x >= 24 * 16 });
    const last = geometry.segments.reduce((best, segment) => segment.bx > best.bx ? segment : best);
    const first = geometry.segments.reduce((best, segment) => segment.ax < best.ax ? segment : best);
    expect(last.heatB).toBeCloseTo(1, 6);
    expect(first.heatA).toBe(0);
    expect(geometry.marks.map((mark) => mark.kind).sort()).toEqual([RouteFlowKind.Source, RouteFlowKind.Entry, RouteFlowKind.Breach].sort());
    expect(geometry.marks.find((mark) => mark.kind === RouteFlowKind.Entry)!.x).toBe(24 * 16);
  });

  it('keeps a stream that still flows at its age and fades a new one in', () => {
    const store = new RouteFlowStore();
    store.setGeometry(buildRouteFlowGeometry([north], { tolerance: .75 }), 1000);
    const bornAt = (slot: number) => store.data[slot * ROUTE_FLOW_INSTANCE_FLOATS + 16];
    store.setGeometry(buildRouteFlowGeometry([north, south], { tolerance: .75 }), 5000);
    const ages = Array.from({ length: store.count }, (_, slot) => bornAt(slot));
    expect(ages).toContain(1000);
    expect(ages).toContain(5000);
  });
});
