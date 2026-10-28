import { describe, expect, it } from 'vitest';
import {
  buildRouteFlowGeometry, ROUTE_FLOW_INSTANCE_FLOATS, RouteFlowKind, routeFlowHalfWidth, RouteFlowStore, type RouteFlowRoute,
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
    // Past the confluence one stream is left, carrying both routes.
    const trunk = geometry.segments.filter((segment) => segment.ax >= 26 * 16);
    expect(trunk.length).toBeGreaterThan(0);
    expect(trunk.every((segment) => segment.usage === 2 && segment.halfWidthA >= routeFlowHalfWidth(2) - 1e-6)).toBe(true);
    expect(geometry.segments.filter((segment) => segment.bx < 19 * 16).every((segment) => segment.usage === 1)).toBe(true);
    // No duplicate stream on the trunk.
    const keys = geometry.segments.map((segment) => segment.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('flows on across a junction: the aligned arm runs on, the other fades into the trunk', () => {
    const geometry = buildRouteFlowGeometry([north, south], { tolerance: .75 });
    for (const segment of geometry.segments) expect(segment.distB).toBeLessThan(segment.distA);
    const starts = geometry.segments.filter((segment) => segment.joinA === null);
    const ends = geometry.segments.filter((segment) => segment.joinB === null);
    // Two sources start; the aligned arm reaches the goal, the other ends as a faded tail in the trunk.
    expect(starts.map((segment) => [segment.ax, segment.ay])).toEqual(expect.arrayContaining([[0, 0], [10 * 16, 20 * 16]]));
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    for (const end of ends) expect(end.presenceB).toBeLessThan(.02);
    const tail = ends.find((segment) => segment.bx < 38 * 16)!;
    expect(tail.by).toBeCloseTo(10 * 16, 0);
    expect(tail.bx).toBeGreaterThan(20 * 16);
    // The goal is where the distance ends; the current dissolves a little past it.
    const goal = geometry.segments.find((segment) => Math.abs(segment.bx - 40 * 16) < .01 && Math.abs(segment.by - 10 * 16) < .01)!;
    expect(goal.distB).toBeCloseTo(0, 6);
    expect(Math.max(...geometry.segments.map((segment) => segment.bx))).toBeGreaterThan(40 * 16);
  });

  it('grows a stream out of its source', () => {
    const geometry = buildRouteFlowGeometry([north], { tolerance: .75 });
    const first = geometry.segments.find((segment) => segment.joinA === null)!;
    const middle = geometry.segments.find((segment) => segment.ax > 25 * 16)!;
    expect(first.halfWidthA).toBeLessThan(middle.halfWidthA * .6);
    expect(first.presenceA).toBeLessThan(.5);
    expect(middle.presenceA).toBeCloseTo(1, 6);
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
