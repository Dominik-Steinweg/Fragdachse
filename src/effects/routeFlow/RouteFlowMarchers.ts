import type { VoidMarchers, VoidMarcherSample } from '../../arena/VoidDangerField';
import { createVoidMarcherSample } from '../../arena/VoidDangerField';
import type { RouteFlowPoint, RouteFlowRoute } from './RouteFlowStore';

interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/**
 * Phantom marchers of the situation map (GDD Void-Gefahrenzonen V1, E14): they walk the planned
 * routes like the round's enemies and lay the same void trails into the fog, so the map reads as
 * the round will. A new or rerouted route sends a fast surge out of its zone first; the marchers
 * behind it start laying their trail as it passes, so fresh contamination sweeps along the route.
 */
export const ROUTE_MARCH = {
  /** Walking pace of the marchers (px/s), about a zombie badger's. */
  speedPxPerSec: 90,
  /** Distance between marchers on a route (px): each point is walked again long before its trail fades. */
  spacingPx: 240,
  /** Pace of the surge that carries a new route's first contamination out of its zone (px/s). */
  surgePxPerSec: 900,
  /** Body size the marchers lay their trail with (px). */
  size: 32,
  /** Marchers beyond the view and this margin lay nothing. */
  clipMarginPx: 400,
} as const;

/** A walked path: points with cumulative arc length; a portal point is reached by a jump of zero length. */
interface Path { readonly points: readonly RouteFlowPoint[]; readonly arc: readonly number[]; readonly length: number; readonly jumps: number }
interface Track {
  readonly key: string;
  readonly group: number;
  readonly strength: number;
  readonly main: Path;
  readonly arms: readonly Path[];
  readonly bornMs: number;
}

function pathOf(points: readonly RouteFlowPoint[]): Path {
  const arc = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    arc.push(arc[i - 1]! + (b.portal ? 0 : Math.hypot(b.x - a.x, b.y - a.y)));
  }
  return { points, arc, length: arc[arc.length - 1] ?? 0, jumps: points.filter(point => point.portal).length };
}

/** Same route, same way: its key and its points to a few pixels. */
function signatureOf(route: RouteFlowRoute, key: string): string {
  return `${key}|${route.points.map(p => `${Math.round(p.x / 8)},${Math.round(p.y / 8)}${p.portal ? 'p' : ''}`).join(';')}|${route.strength}`;
}

/** The point at arc `s` along a path and how many portal jumps lie behind it. */
function pointAt(path: Path, s: number, out: { x: number; y: number; jumps: number }): void {
  const points = path.points, arc = path.arc;
  let i = 1, jumps = 0;
  while (i < points.length - 1 && arc[i]! < s) { if (points[i]!.portal) jumps++; i++; }
  if (points[i]?.portal && arc[i]! <= s) jumps++;
  const a = points[i - 1]!, b = points[i] ?? a, span = arc[i]! - arc[i - 1]!;
  const t = span > 0 ? Math.max(0, Math.min(1, (s - arc[i - 1]!) / span)) : 1;
  out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.jumps = jumps;
}

/** The situation map's marchers as the void presentation pulls them; one stable object. */
export class RouteFlowMarchers implements VoidMarchers {
  private tracks: Track[] = [];
  private readonly signatures = new Map<string, Track>();
  private nextGroup = 1;
  private clip: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private readonly sample = createVoidMarcherSample();
  private readonly at = { x: 0, y: 0, jumps: 0 };
  /** Routes that are no longer planned fade quickly; a new revision each time some drop. */
  retired: { readonly revision: number; readonly groups: readonly number[] } | null = null;
  clockMs = 0;

  /** The routes now planned (with their keys); kept routes keep marching, new ones surge in. */
  setRoutes(routes: readonly RouteFlowRoute[], clip: Rect): void {
    this.clip = clip;
    const next = new Map<string, Track>(), tracks: Track[] = [];
    routes.forEach((route, index) => {
      if (route.points.length < 2) return;
      const key = route.key ?? `route-${index}`, signature = signatureOf(route, key);
      const track = this.signatures.get(signature) ?? next.get(signature) ?? {
        key, group: this.nextGroup++, strength: Math.max(0, Math.min(1, route.strength)), main: pathOf(route.points),
        arms: (route.arms ?? []).filter(arm => arm.length > 1).map(arm => pathOf([route.points[route.points.length - 1]!, ...arm])),
        bornMs: this.clockMs,
      };
      if (next.has(signature)) return;
      next.set(signature, track); tracks.push(track);
    });
    const dropped = [...this.signatures.values()].filter(track => ![...next.values()].includes(track)).map(track => track.group);
    if (dropped.length) this.retired = { revision: (this.retired?.revision ?? 0) + 1, groups: dropped };
    this.signatures.clear();
    for (const [signature, track] of next) this.signatures.set(signature, track);
    this.tracks = tracks;
  }

  clear(): void { this.setRoutes([], this.clip); }

  update(deltaMs: number): void { this.clockMs += Math.max(0, deltaMs); }

  forEach(visit: (sample: Readonly<VoidMarcherSample>) => void): void {
    const sample = this.sample, at = this.at, clip = this.clip, margin = ROUTE_MARCH.clipMarginPx;
    for (const track of this.tracks) {
      const elapsed = Math.max(0, this.clockMs - track.bornMs) / 1000;
      const surge = elapsed * ROUTE_MARCH.surgePxPerSec, walked = elapsed * ROUTE_MARCH.speedPxPerSec;
      const longest = track.main.length + Math.max(0, ...track.arms.map(arm => arm.length));
      // The marchers stand evenly along the route from the start, as if the round had run a while.
      const first = Math.ceil((walked - longest - track.main.length) / ROUTE_MARCH.spacingPx);
      const last = Math.floor((walked + track.main.length) / ROUTE_MARCH.spacingPx);
      const visitOne = (id: string, s: number, n: number, active: boolean): void => {
        const arm = s > track.main.length && track.arms.length ? track.arms[((n % track.arms.length) + track.arms.length) % track.arms.length]! : null;
        // An arm goes on from the route's end: its jumps count after all of the route's.
        if (arm) { pointAt(arm, s - track.main.length, at); at.jumps += track.main.jumps; }
        else pointAt(track.main, Math.min(s, track.main.length), at);
        sample.id = id; sample.x = at.x; sample.y = at.y; sample.size = ROUTE_MARCH.size; sample.revision = at.jumps;
        sample.zone = null; sample.strength = track.strength; sample.group = track.group;
        sample.active = active && at.x > clip.x - margin && at.y > clip.y - margin
          && at.x < clip.x + clip.width + margin && at.y < clip.y + clip.height + margin;
        visit(sample);
      };
      if (surge < track.main.length) visitOne(`${track.group}:surge`, surge, 0, true);
      for (let n = first; n <= last; n++) {
        const s = track.main.length + walked - n * ROUTE_MARCH.spacingPx;
        if (s < 0) continue;
        const end = s > track.main.length && track.arms.length
          ? track.main.length + track.arms[((n % track.arms.length) + track.arms.length) % track.arms.length]!.length : track.main.length;
        if (s > end) continue;
        // Behind the surge only: the route takes the void as the surge passes.
        visitOne(`${track.group}:${n}`, s, n, s <= surge);
      }
    }
  }
}
