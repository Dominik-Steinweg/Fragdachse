import { BURROW_EARTHBREAK } from '../config/burrowEarthbreak';
import { BURROW_FX } from '../config/burrowEffects';
import type { EarthbreakPoint, SyncedBurrowEarthbreak } from '../systems/BurrowEarthbreakRuntime';
import { EarthbreakFissureStore, FISSURE_TIMING } from './earthbreak/EarthbreakFissureStore';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';

type Normal = readonly [number, number];

interface TraceView {
  snapshot: SyncedBurrowEarthbreak;
  /** Timeline pulses already played (emergence first, then points from the exit backwards). */
  played: number;
  /** Points already turned into fissure segments. */
  points: number;
  arc: number;
  lastBornAt: number;
  /** Fissures that existed before this client saw them appear open fully grown. */
  instant: boolean;
  detonated: boolean;
  readonly seed: number;
  color: number | null;
  /** Where the dig began, known only when this client watched it start. */
  origin: EarthbreakPoint | null;
  /** End of the live tip segment written last. */
  tip: EarthbreakPoint | null;
}

/** A trace first observed with more points than this was not watched while it was dug. */
const INSTANT_POINT_THRESHOLD = 3;
/** Late growth never trails the badger by more than this many segment growth times. */
const MAX_GROWTH_LAG = 2;
/** The exit connector only bridges ordinary last steps, never an assisted relocation. */
const MAX_EXIT_CONNECTOR_PX = BURROW_EARTHBREAK.spacingPx * 2;
/** Sub-pixel sprite jitter does not rewrite the live tip. */
const TIP_UPDATE_PX = 0.25;

function direction(a: EarthbreakPoint, b: EarthbreakPoint): Normal | null {
  const x = b.x - a.x, y = b.y - a.y, length = Math.hypot(x, y);
  return length > 1e-3 ? [x / length, y / length] : null;
}

/** Joint plane between two travel directions; null where the path doubles back on itself. */
function bisector(a: Normal | null, b: Normal | null): Normal | null {
  if (!a || !b) return null;
  const x = a[0] + b[0], y = a[1] + b[1], length = Math.hypot(x, y);
  return length > 0.1 ? [x / length, y / length] : null;
}

/**
 * Replica-only timeline. Fissure geometry lives in one bounded GPU instance store; the earth
 * bursts reuse the shared particle lanes. A missing visual never changes a hit.
 */
export class BurrowEarthbreakPresentation {
  readonly fissures = new EarthbreakFissureStore();
  private readonly traces = new Map<number, TraceView>();
  private initial = true;
  private clockOffset = 0;
  private hidden = false;

  constructor(private readonly gpu: GpuVfxSystem,
    private readonly burst: (x: number, y: number, emergence: boolean, ageMs: number) => void,
    private readonly earthColor: (x: number, y: number) => number = () => BURROW_FX.terrainFallback,
    /** Displayed underground position of a digging owner; presentation only, never a hit. */
    private readonly ownerPosition: (ownerId: string) => EarthbreakPoint | null = () => null) {}

  sync(snapshots: readonly SyncedBurrowEarthbreak[], hostNow: number, host = false): void {
    const now = this.gpu.now();
    this.clockOffset = hostNow - now;
    const seen = new Set<number>();
    for (const snapshot of snapshots) {
      seen.add(snapshot.id);
      const old = this.traces.get(snapshot.id);
      if (old) old.snapshot = snapshot;
      else this.traces.set(snapshot.id, { snapshot,
        played: this.initial && !host ? this.dueCount(snapshot, hostNow) : 0,
        points: 0, arc: 0, lastBornAt: -Infinity, detonated: false, color: null, origin: null, tip: null,
        instant: snapshot.points.length > INSTANT_POINT_THRESHOLD || snapshot.detonatedAt !== null,
        seed: (snapshot.id * 0.6180339887) % 1 });
    }
    for (const [id, view] of this.traces) {
      if (seen.has(id)) continue;
      // A dig that ends without emergence (death, tunnel, teardown of the owner) closes up.
      if (!view.detonated) this.forEachKey(view, key => this.fissures.cancel(key, now));
      this.traces.delete(id);
    }
    this.initial = false;
    this.fissures.commit();
  }

  private dueCount(s: SyncedBurrowEarthbreak, now: number): number {
    return s.detonatedAt === null || now < s.detonatedAt ? 0
      : Math.min(s.points.length + 1, 1 + Math.floor((now - s.detonatedAt) / BURROW_EARTHBREAK.intervalMs));
  }

  update(gpuNow: number, isVisible: (x: number, y: number) => boolean): void {
    const hostNow = gpuNow + this.clockOffset;
    this.hidden = false;
    for (const view of this.traces.values()) this.writeFissures(view, gpuNow);
    this.fissures.retire(gpuNow);
    this.fissures.commit();
    for (const view of this.traces.values()) {
      const s = view.snapshot, due = this.dueCount(s, hostNow);
      while (view.played < due) {
        const index = view.played++;
        const point = index === 0 ? s.exit : s.points[s.points.length - index];
        const age = hostNow - (s.detonatedAt! + index * BURROW_EARTHBREAK.intervalMs);
        if (point && age <= BURROW_FX.earthbreak.maxReplayAgeMs && isVisible(point.x, point.y))
          this.burst(point.x, point.y, index === 0, Math.max(0, age));
      }
    }
  }

  private key(view: TraceView, suffix: number | string): string { return `${view.snapshot.id}:${suffix}`; }

  private forEachKey(view: TraceView, visit: (key: string) => void): void {
    for (let k = 0; k < view.points; k++) visit(this.key(view, k));
    visit(this.key(view, 'tip'));
    visit(this.key(view, 'exit'));
  }

  private bornAt(view: TraceView, now: number): number {
    if (view.instant) return now - 10_000;
    const grow = FISSURE_TIMING.growMs;
    view.lastBornAt = Math.max(now, Math.min(view.lastBornAt + grow, now + grow * MAX_GROWTH_LAG));
    return view.lastBornAt;
  }

  /** Path vertex `index`; -1 is the dig origin when this client saw the dig begin. */
  private vertex(view: TraceView, index: number): EarthbreakPoint | null {
    return index >= 0 ? view.snapshot.points[index] ?? null : index === -1 ? view.origin : null;
  }

  /** Segment `k` ends at point `k`; segment 0 leads in from the dig origin. */
  private hasSegment(view: TraceView, k: number): boolean {
    return k >= 1 ? k < view.points : k === 0 && view.points > 0 && view.origin !== null;
  }

  /**
   * Incremental: each point, and the detonation, is written exactly once per visible period.
   * The replicated points trail the badger by up to one spacing, so while digging a live tip
   * segment reaches from the newest point to the displayed underground position.
   */
  private writeFissures(view: TraceView, now: number): void {
    const s = view.snapshot, points = s.points;
    const owner = s.detonatedAt === null ? this.ownerPosition(s.ownerId) : null;
    if (view.origin === null && !view.instant && view.points === 0 && points.length === 0 && owner)
      view.origin = { x: owner.x, y: owner.y };
    if (view.color === null) {
      const origin = view.origin ?? points[0] ?? s.exit;
      if (origin) view.color = this.earthColor(origin.x, origin.y);
    }
    const color = view.color ?? BURROW_FX.terrainFallback;
    const grown = now - FISSURE_TIMING.growMs;
    const appended = view.points < points.length;
    while (view.points < points.length) {
      const k = view.points++;
      const a = this.vertex(view, k - 1);
      // Ground the live tip already opened must not grow a second time.
      if (a) this.appendSegment(view, k, this.vertex(view, k - 2), a, points[k], now, color,
        view.tip ? grown : this.bornAt(view, now), this.hasSegment(view, k - 1) ? k - 1 : null);
    }
    const last = this.vertex(view, points.length - 1) ?? view.origin;
    const lastIndex = points.length - 1;
    const tipKey = this.key(view, 'tip');
    if (owner && last) {
      if (appended || !view.tip || Math.hypot(owner.x - view.tip.x, owner.y - view.tip.y) > TIP_UPDATE_PX) {
        const written = this.appendSegment(view, 'tip', this.vertex(view, lastIndex - 1), last, owner, now, color,
          grown, this.hasSegment(view, lastIndex) ? lastIndex : null, false);
        if (written) view.tip = { x: owner.x, y: owner.y };
        else { this.fissures.remove(tipKey); view.tip = null; }
      }
    } else if (view.tip) {
      this.fissures.remove(tipKey); view.tip = null;
    }
    if (view.detonated || s.detonatedAt === null || !s.exit) return;
    view.detonated = true;
    const det = s.detonatedAt - this.clockOffset;
    const interval = BURROW_EARTHBREAK.intervalMs;
    const n = points.length;
    // The lead-in keeps the wave's cadence one interval past the first damage point.
    const collapseAt = (index: number): number => det + (n - index) * interval;
    for (let k = 0; k < n; k++) {
      if (this.hasSegment(view, k)) this.fissures.setCollapse(this.key(view, k), det, collapseAt(k - 1), collapseAt(k));
    }
    if (last && Math.hypot(s.exit.x - last.x, s.exit.y - last.y) <= MAX_EXIT_CONNECTOR_PX) {
      const born = Math.min(now, det) - FISSURE_TIMING.growMs;
      this.appendSegment(view, 'exit', this.vertex(view, n - 2), last, s.exit, now, color, born,
        this.hasSegment(view, n - 1) ? n - 1 : null);
      this.fissures.setCollapse(this.key(view, 'exit'), det, collapseAt(n - 1), det);
    }
    this.fissures.addCrater(this.key(view, 'crater'), { x: s.exit.x, y: s.exit.y,
      radius: BURROW_EARTHBREAK.exitRadius, seed: view.seed, color }, det, now);
  }

  private appendSegment(view: TraceView, suffix: number | 'exit' | 'tip', before: EarthbreakPoint | null,
    a: EarthbreakPoint, b: EarthbreakPoint, now: number, color: number, born: number,
    previous: number | null, advanceArc = true): boolean {
    const dir = direction(a, b);
    if (!dir) return false;
    const joinA = bisector(before ? direction(before, a) : null, dir);
    if (previous !== null) {
      const key = this.key(view, previous);
      this.fissures.setJoin(key, 'b', joinA);
      this.fissures.setNextBorn(key, born);
    }
    const added = this.fissures.addSegment(this.key(view, suffix), { ax: a.x, ay: a.y, bx: b.x, by: b.y,
      arcStart: view.arc, joinA, joinB: null, bornAt: born, seed: view.seed, color }, now);
    if (advanceArc) view.arc += Math.hypot(b.x - a.x, b.y - a.y);
    return added;
  }

  /** Rendering pauses consume the timeline without replaying hidden hits when visibility returns. */
  hide(gpuNow: number): void {
    for (const view of this.traces.values()) view.played = this.dueCount(view.snapshot, gpuNow + this.clockOffset);
    if (this.hidden) return;
    this.hidden = true;
    this.fissures.clear();
    // On return, surviving traces reopen fully grown at their current collapse state.
    for (const view of this.traces.values()) {
      view.points = 0; view.arc = 0; view.detonated = false; view.instant = true; view.tip = null;
    }
  }

  clear(): void {
    this.fissures.clear();
    this.traces.clear(); this.initial = true; this.hidden = false;
  }

  destroy(): void { this.clear(); }
}
