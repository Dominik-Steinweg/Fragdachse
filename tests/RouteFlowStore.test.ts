import { describe, expect, it } from 'vitest';
import {
  buildRouteFlowGeometry, ROUTE_FLOW_INSTANCE_FLOATS, RouteFlowKind, routeFlowHalfWidth, RouteFlowStore, type RouteFlowRoute,
} from '../src/effects/routeFlow/RouteFlowStore';
import { ROUTE_MARCH, RouteFlowMarchers } from '../src/effects/routeFlow/RouteFlowMarchers';

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

  it('gathers a stream out of its spawn zone: wide and faint at the source, a stream past the rim', () => {
    const geometry = buildRouteFlowGeometry([{ ...north, sourceReach: 120 }], { tolerance: .75 });
    const first = geometry.segments.find((segment) => segment.joinA === null)!;
    const middle = geometry.segments.find((segment) => segment.ax > 25 * 16)!;
    expect(first.halfWidthA).toBeGreaterThan(middle.halfWidthA * 1.5);
    expect(first.presenceA).toBeLessThan(.02);
    expect(middle.presenceA).toBeCloseTo(1, 6);
    // Gathered over the way out of the zone and a little beyond.
    const gathered = geometry.segments.find((segment) => segment.presenceA > .99)!;
    expect(Math.hypot(gathered.ax, gathered.ay)).toBeGreaterThan(120);
  });

  it('heats a breach route towards the wall and marks only the breach', () => {
    const breach = route(repeat([1, 0], 30), [0, 40], { breach: true });
    const geometry = buildRouteFlowGeometry([breach], { tolerance: .75 });
    const last = geometry.segments.reduce((best, segment) => segment.bx > best.bx ? segment : best);
    const first = geometry.segments.reduce((best, segment) => segment.ax < best.ax ? segment : best);
    expect(last.heatB).toBeCloseTo(1, 6);
    expect(first.heatA).toBe(0);
    expect(geometry.marks.map((mark) => mark.kind)).toEqual([RouteFlowKind.Breach]);
  });

  it('parts at the goal into arms along the target that flow on and fade at their tips', () => {
    // The stream arrives from the west at (20, 10) and lies along a wall running north and south.
    const arms = [[{ x: 20 * 16, y: 8 * 16 }, { x: 20 * 16, y: 6 * 16 }, { x: 20 * 16, y: 4 * 16 }],
      [{ x: 20 * 16, y: 12 * 16 }, { x: 20 * 16, y: 14 * 16 }, { x: 20 * 16, y: 16 * 16 }]];
    const geometry = buildRouteFlowGeometry([route(repeat([1, 0], 20), [0, 10], { arms })], { tolerance: .75 });
    for (const segment of geometry.segments) expect(segment.distB).toBeLessThan(segment.distA);
    const ends = geometry.segments.filter((segment) => segment.joinB === null);
    expect(ends).toHaveLength(2);
    for (const end of ends) {
      expect(Math.abs(end.bx - 20 * 16)).toBeLessThan(24);
      expect(Math.abs(end.by - 10 * 16)).toBeGreaterThan(5 * 16);
      expect(end.presenceB).toBeLessThan(.02);
    }
    // No mark at the goal: the arms are its whole picture.
    expect(geometry.marks).toHaveLength(0);
  });

  it('splits a route at a portal: the stream ends in the entry, rises out of the exit, the jump is its own arc', () => {
    // From the west into an entry at (20, 10); out of the exit at (60, 30) on to the east, breaking through there.
    const walk = route(repeat([1, 0], 20), [0, 10]), beyond = route(repeat([1, 0], 15), [60, 30]);
    const portal: RouteFlowRoute = { points: [...walk.points, { ...beyond.points[0]!, portal: true }, ...beyond.points.slice(1)],
      breach: true, strength: .8, sourceReach: 40 };
    const geometry = buildRouteFlowGeometry([portal], { tolerance: .75 });
    // Nothing flows over the ground between the portals: past the entry the stream only dissolves.
    for (const segment of geometry.segments) {
      expect(Math.max(segment.ax, segment.bx) <= 20 * 16 + 32 || Math.min(segment.ax, segment.bx) >= 60 * 16).toBe(true);
    }
    expect(geometry.jumps).toEqual([{ key: expect.any(String), ax: 20 * 16, ay: 10 * 16, bx: 60 * 16, by: 30 * 16, strength: .8 }]);
    // The breach belongs to the route's end beyond the exit.
    expect(geometry.marks.map((mark) => [mark.kind, mark.x])).toEqual([[RouteFlowKind.Breach, 75 * 16]]);
    const store = new RouteFlowStore();
    store.setGeometry(geometry, 0);
    const kinds = Array.from({ length: store.count }, (_, slot) => store.data[slot * ROUTE_FLOW_INSTANCE_FLOATS + 15]);
    expect(kinds.filter((kind) => kind === RouteFlowKind.Jump)).toHaveLength(1);
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

describe('situation map marchers (E14)', () => {
  const clip = { x: -1000, y: -1000, width: 4000, height: 4000 };
  const walk = (marchers: RouteFlowMarchers) => {
    const out: { id: string; x: number; y: number; active: boolean; group: number; revision: number }[] = [];
    marchers.forEach(sample => out.push({ id: sample.id, x: sample.x, y: sample.y, active: sample.active, group: sample.group, revision: sample.revision }));
    return out;
  };
  const line = (key: string, length: number, extra: Partial<RouteFlowRoute> = {}): RouteFlowRoute =>
    ({ key, points: [{ x: 0, y: 0 }, { x: length, y: 0 }], breach: false, strength: 1, ...extra });

  it('stand evenly along a new route and take up the void only behind its surge', () => {
    const marchers = new RouteFlowMarchers();
    marchers.setRoutes([line('north', 2400)], clip);
    const start = walk(marchers);
    expect(start.filter(m => !m.id.endsWith('surge')).length).toBeGreaterThanOrEqual(2400 / ROUTE_MARCH.spacingPx);
    expect(start.filter(m => m.active).every(m => m.x <= 1)).toBe(true);
    marchers.update(1000);
    const later = walk(marchers);
    const surge = later.find(m => m.id.endsWith('surge'))!;
    expect(surge.x).toBeCloseTo(ROUTE_MARCH.surgePxPerSec, 0);
    for (const m of later) if (!m.id.endsWith('surge')) expect(m.active).toBe(m.x <= surge.x + .001);
    marchers.update(5000);
    const walked = walk(marchers);
    expect(walked.some(m => m.id.endsWith('surge'))).toBe(false);
    expect(walked.every(m => m.active)).toBe(true);
  });

  it('keeps a route that stays planned and retires the groups of dropped routes once', () => {
    const marchers = new RouteFlowMarchers();
    marchers.setRoutes([line('north', 1200), line('south', 1200, { points: [{ x: 0, y: 400 }, { x: 1200, y: 400 }] })], clip);
    const groups = new Set(walk(marchers).map(m => m.group));
    marchers.update(2000);
    marchers.setRoutes([line('north', 1200)], clip);
    const kept = walk(marchers);
    expect(kept.every(m => groups.has(m.group))).toBe(true);
    expect(kept.some(m => m.id.endsWith('surge'))).toBe(false);
    expect(marchers.retired?.groups).toHaveLength(1);
    const revision = marchers.retired!.revision;
    marchers.setRoutes([line('north', 1200)], clip);
    expect(marchers.retired!.revision).toBe(revision);
    // Rerouted: a new group that surges in again.
    marchers.setRoutes([line('north', 1300)], clip);
    expect(walk(marchers).every(m => !groups.has(m.group))).toBe(true);
    expect(marchers.retired!.revision).toBe(revision + 1);
  });

  it('jumps through a portal without a trail across the gap', () => {
    const marchers = new RouteFlowMarchers();
    marchers.setRoutes([{ key: 'jump', breach: false, strength: 1,
      points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 2000, y: 0, portal: true }, { x: 2300, y: 0 }] }], clip);
    marchers.update(10_000);
    const samples = walk(marchers).filter(m => !m.id.endsWith('surge'));
    expect(samples.filter(m => m.x > 300 && m.x < 2000)).toEqual([]);
    expect(new Set(samples.filter(m => m.x >= 2000).map(m => m.revision))).toEqual(new Set([1]));
    expect(new Set(samples.filter(m => m.x < 300).map(m => m.revision))).toEqual(new Set([0]));
  });
});
