import type { FlightSignatureTuning } from '../../projectile/FlightSignature';
import type { ProjectilePathPoint, ProjectileTrailSegment } from '../../projectile/ProjectileFlightPath';
import type { GpuVfxPoolStats } from './GpuVfxPool';
import { GpuVfxEffectId } from './GpuVfxEffects';

export const FLIGHT_RIBBON_CAPACITY = 16384;
export const FLIGHT_RIBBON_PAGE_SIZE = 2048;
export const FLIGHT_RIBBON_VERTEX_WORDS = 18;
export const FLIGHT_RIBBON_VERTICES = 9; // Two body triangles and one optional bevel triangle.
export const FLIGHT_RIBBON_SLOT_WORDS = FLIGHT_RIBBON_VERTICES * FLIGHT_RIBBON_VERTEX_WORDS;
const MAX_HANDLES = 8192;
const MAX_SPANS = 255;
const MAX_AGE_MS = 1000;
const TERMINAL_WIDTH_SCALE = 0.65;

export interface FlightRibbonStyle {
  readonly tuning: FlightSignatureTuning;
  readonly color: number;
  readonly emissive: number;
}
export interface FlightRibbonHandle { readonly id: number; readonly generation: number }
type Vec = readonly [number, number];
export interface FlightRibbonKnot {
  readonly x: number; readonly y: number; readonly pathTime: number; readonly born: number;
  readonly life: number; readonly width: number; readonly spread: number;
  readonly alpha: number; readonly heat: number; readonly turbulence: number;
  readonly color: number; bounce: boolean;
}
export interface FlightRibbonSpan {
  readonly slot: number; readonly from: FlightRibbonKnot; readonly to: FlightRibbonKnot;
  readonly wake: boolean; previous: FlightRibbonSpan | null; next: FlightRibbonSpan | null;
  terminal: boolean;
}
interface Chain { spans: FlightRibbonSpan[]; last: FlightRibbonKnot | null; knots: number }
interface Flight {
  source: number; readonly style: FlightRibbonStyle; readonly core: Chain; readonly wake: Chain;
  closed: boolean;
}
export interface FlightRibbonAdmission {
  admit(effect: GpuVfxEffectId): boolean;
  attempt(effect: GpuVfxEffectId): void;
  spawn(effect: GpuVfxEffectId): void;
  drop(effect: GpuVfxEffectId): void;
}
export interface FlightRibbonFrame { readonly u: number; readonly top: number; readonly bottom: number }

/** Technical response uses physical velocity, never the spacing of batched callbacks. */
export function flightRibbonResponse(t: FlightSignatureTuning, point: ProjectilePathPoint, fallbackSpeed = 0) {
  const speed = Math.hypot(point.vx, point.vy) || fallbackSpeed;
  const response = Math.max(0.45, Math.min(2.5, 1 + (speed / 1000 - 1) * t.speedResponse));
  return { width: t.coreWidth / Math.sqrt(response),
    hotMs: Math.max(18, Math.min(500, t.coreLength * response * 1000 / Math.max(100, speed))) };
}

function tangent(a: FlightRibbonKnot, b: FlightRibbonKnot): Vec {
  const x = b.x - a.x, y = b.y - a.y, length = Math.hypot(x, y);
  return length > 1e-6 ? [x / length, y / length] : [1, 0];
}
interface Join { incoming: readonly [Vec, Vec]; outgoing: readonly [Vec, Vec]; bevel: readonly [Vec, Vec, Vec] | null; normal: Vec }
/** One join is evaluated from the same neighbours by both adjoining spans. */
function join(knot: FlightRibbonKnot, previous: FlightRibbonKnot | null, next: FlightRibbonKnot | null): Join {
  const a = previous ? tangent(previous, knot) : tangent(knot, next!);
  const b = next ? tangent(knot, next) : a;
  const na: Vec = [-a[1], a[0]], nb: Vec = [-b[1], b[0]];
  const dot = a[0] * b[0] + a[1] * b[1];
  const sum = Math.hypot(na[0] + nb[0], na[1] + nb[1]);
  const normal: Vec = sum > 1e-5 ? [(na[0] + nb[0]) / sum, (na[1] + nb[1]) / sum] : na;
  const cap = (n: Vec): readonly [Vec, Vec] => [n, [-n[0], -n[1]]];
  if (dot < -0.98) return { incoming: cap(na), outgoing: cap(nb), bevel: null, normal: [0, 0] };
  const divisor = normal[0] * nb[0] + normal[1] * nb[1];
  const ratio = 1 / Math.max(0.001, divisor);
  const m: Vec = [normal[0] * Math.min(2, ratio), normal[1] * Math.min(2, ratio)];
  if (ratio <= 2) return { incoming: cap(m), outgoing: cap(m), bevel: null, normal };
  // Partition the corner into two bodies and one triangle, rather than overlaying a cap.
  const left = a[0] * b[1] - a[1] * b[0] > 0;
  const inner: Vec = left ? m : [-m[0], -m[1]];
  const outerA: Vec = left ? [-na[0], -na[1]] : na;
  const outerB: Vec = left ? [-nb[0], -nb[1]] : nb;
  return { incoming: left ? [inner, outerA] : [outerA, inner],
    outgoing: left ? [inner, outerB] : [outerB, inner], bevel: [inner, outerA, outerB], normal };
}

/** Renderer-free, bounded material storage. Simulation never reads this projection. */
export class GpuFlightRibbonStore {
  readonly data: Float32Array;
  readonly pageLive: Uint16Array;
  readonly pageVersion: Uint32Array;
  private readonly flights = new Map<number, Flight>();
  private readonly slots: (FlightRibbonSpan | null)[];
  private readonly free: number[] = [];
  private readonly dirty = new Set<number>();
  private nextId = 1;
  private generation = 0;
  private active = 0;
  private peak = 0;
  private rearms = 0;
  private retirements = 0;
  private drops = 0;
  private writes = 0;
  private coreWork: number;
  private wakeWork: number;

  constructor(private readonly admission: FlightRibbonAdmission,
    private readonly frames: readonly [FlightRibbonFrame, FlightRibbonFrame],
    readonly capacity = FLIGHT_RIBBON_CAPACITY) {
    this.data = new Float32Array(capacity * FLIGHT_RIBBON_SLOT_WORDS);
    this.coreWork = this.wakeWork = capacity;
    this.slots = new Array(capacity).fill(null);
    this.pageLive = new Uint16Array(Math.ceil(capacity / FLIGHT_RIBBON_PAGE_SIZE));
    this.pageVersion = new Uint32Array(this.pageLive.length);
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
  }
  create(source: number, style: FlightRibbonStyle): FlightRibbonHandle | null {
    if (this.flights.size >= MAX_HANDLES) return null;
    const id = this.nextId++;
    this.flights.set(id, { source, style, core: { spans: [], last: null, knots: 0 }, wake: { spans: [], last: null, knots: 0 }, closed: false });
    return { id, generation: this.generation };
  }
  private get(handle: FlightRibbonHandle): Flight | undefined {
    return handle.generation === this.generation ? this.flights.get(handle.id) : undefined;
  }
  break(handle: FlightRibbonHandle): void {
    const f = this.get(handle);
    if (f) { f.core.last = null; f.wake.last = null; }
  }
  end(handle: FlightRibbonHandle): void { const f = this.get(handle); if (f) this.close(f); }
  private close(flight: Flight): void {
    if (flight.closed) return;
    flight.closed = true;
    for (const chain of [flight.core, flight.wake]) {
      const last = chain.spans[chain.spans.length - 1];
      if (!last) continue;
      // Only the final real span tapers. Live heads and historical joins stay full-strength;
      // positions, birth times and pool lifetimes are not changed by closing.
      last.terminal = true;
      this.dirty.add(last.slot);
    }
  }

  append(handle: FlightRibbonHandle, segment: ProjectileTrailSegment, now: number, wake: boolean, factor: number): void {
    const flight = this.get(handle);
    if (!flight || flight.closed) return;
    const chain = wake ? flight.wake : flight.core;
    if (segment.to.breakBefore) { chain.last = null; return; }
    if (wake && factor <= 0) { chain.last = null; return; }
    const dx = segment.to.x - segment.from.x, dy = segment.to.y - segment.from.y;
    const length = Math.hypot(dx, dy), duration = Math.max(0, segment.to.timeMs - segment.from.timeMs);
    if (length < 0.01 || !Number.isFinite(length + duration + segment.ageMs)) return;
    // Duplicate/overlapping data cannot move a material cursor backwards.
    if (chain.last && segment.to.timeMs <= chain.last.pathTime
      && (duration > 0 || Math.hypot(segment.to.x - chain.last.x, segment.to.y - chain.last.y) < 0.01)) return;
    const response = flightRibbonResponse(flight.style.tuning, segment.from,
      Math.hypot(segment.to.vx, segment.to.vy) || (duration ? length * 1000 / duration : 0));
    const life = response.hotMs + (wake ? flight.style.tuning.wakePersistence * factor : 0);
    if (segment.ageMs >= life) return;
    let start = duration ? Math.max(0, 1 - (life - segment.ageMs) / duration) : 0;
    // Partial replay: clip overlapping time; never fabricate a bridge to a discontinuity.
    if (chain.last && duration > 0 && chain.last.pathTime > segment.from.timeMs) {
      start = Math.max(start, Math.min(1, (chain.last.pathTime - segment.from.timeMs) / duration));
    }
    const parts = Math.max(1, Math.ceil(length * (1 - start) / 64));
    // Retain a recent suffix if a single huge confirmed step exceeds the local bound.
    const count = Math.min(parts, MAX_SPANS, wake ? this.wakeWork : this.coreWork);
    if (wake) this.wakeWork -= count; else this.coreWork -= count;
    if (!count) {
      const effect = wake ? GpuVfxEffectId.FlightWake : GpuVfxEffectId.FlightCore;
      this.admission.attempt(effect); this.admission.drop(effect); this.drops++;
      chain.last = null;
      return;
    }
    const first = parts - count;
    if (first) chain.last = null;
    const point = (u: number): FlightRibbonKnot => ({
      x: segment.from.x + dx * u, y: segment.from.y + dy * u,
      pathTime: segment.from.timeMs + duration * u,
      born: now - segment.ageMs - duration * (1 - u), life,
      width: response.width * (wake ? 1.3 : 1), spread: wake ? flight.style.tuning.wakeSpread * factor : 0,
      alpha: flight.style.emissive * (wake ? flight.style.tuning.wakeIntensity * factor : flight.style.tuning.coreIntensity * 0.95),
      heat: wake ? 0.65 : 1 - flight.style.tuning.heatContrast,
      turbulence: wake ? flight.style.tuning.wakeTurbulence : 0,
      color: flight.style.color,
      bounce: (u === 0 && segment.from.bounceSequence !== undefined) || (u === 1 && segment.to.bounceSequence !== undefined),
    });
    // Count the bounded work, not a potentially unrepresentable huge world-distance index.
    for (let i = 0; i < count; i++) {
      const from = point(start + (1 - start) * (first + i) / parts), to = point(start + (1 - start) * (first + i + 1) / parts);
      if (Math.hypot(to.x - from.x, to.y - from.y) < 0.01) continue;
      const last = chain.last;
      const connects = last && Math.abs(last.pathTime - from.pathTime) < 0.001 && Math.hypot(last.x - from.x, last.y - from.y) < 0.01;
      const a = connects ? last : from;
      // Contact confirmation can arrive with the outgoing leg after a partial incoming leg.
      // Promote only the contact marker; historical position and time remain immutable.
      if (connects && from.bounce) a.bounce = true;
      const effect = wake ? GpuVfxEffectId.FlightWake : GpuVfxEffectId.FlightCore;
      this.admission.attempt(effect);
      const canLink = () => connects && chain.spans[chain.spans.length - 1]?.to === a;
      while (chain.spans.length && chain.knots + (canLink() ? 1 : 2) > MAX_SPANS + 1) this.removeFirst(chain);
      // On pressure, shorten a prefix instead of puncturing the middle of a ribbon.
      while ((!this.free.length || !this.admission.admit(effect)) && chain.spans.length) this.removeFirst(chain);
      // A new projectile may reclaim an older prefix too; a full lane must not lock all
      // material slots to the projectiles that happened to arrive first.
      while ((!this.free.length || !this.admission.admit(effect)) && this.evictOldPrefix(wake)) { /* bounded by live slots */ }
      if (!this.free.length || !this.admission.admit(effect)) {
        this.drops++; this.admission.drop(effect); chain.last = null; continue;
      }
      const previous = connects ? chain.spans[chain.spans.length - 1] ?? null : null;
      const slot = this.free.pop()!;
      const span: FlightRibbonSpan = { slot, from: a, to, wake, previous, next: null, terminal: false };
      if (previous && previous.to === a) { previous.next = span; this.dirty.add(previous.slot); }
      else span.previous = null;
      chain.knots += span.previous ? 1 : 2;
      chain.spans.push(span); chain.last = to; this.slots[slot] = span;
      this.active++; this.rearms++; this.peak = Math.max(this.peak, this.active);
      this.pageLive[Math.floor(slot / FLIGHT_RIBBON_PAGE_SIZE)]++;
      this.dirty.add(slot); this.admission.spawn(effect);
    }
  }
  private removeFirst(chain: Chain): void {
    const span = chain.spans.shift();
    if (!span) return;
    chain.knots -= span.next ? 1 : 2;
    if (span.next) { span.next.previous = null; this.dirty.add(span.next.slot); }
    this.slots[span.slot] = null; this.free.push(span.slot); this.dirty.add(span.slot);
    this.active--; this.retirements++; this.pageLive[Math.floor(span.slot / FLIGHT_RIBBON_PAGE_SIZE)]--;
  }
  private evictOldPrefix(wake: boolean): boolean {
    // Wake cannot evict critical material. Core first reclaims optional material.
    for (const kind of wake ? ['wake'] as const : ['wake', 'core'] as const) {
      let candidate: Chain | null = null;
      for (const f of this.flights.values()) {
        const chain = f[kind];
        if (chain.spans.length && (!candidate || chain.spans[0].to.born < candidate.spans[0].to.born)) candidate = chain;
      }
      if (candidate) { this.removeFirst(candidate); return true; }
    }
    return false;
  }
  retire(now: number): void {
    this.coreWork = this.wakeWork = this.capacity;
    for (const [id, f] of this.flights) {
      for (const chain of [f.core, f.wake]) {
        // Retain an expired interior slot until the prefix can retire: no premature deletion
        // of earlier material whose speed-derived lifetime is longer.
        while (chain.spans.length) {
          const s = chain.spans[0];
          if (now < Math.max(s.from.born + s.from.life, s.to.born + s.to.life)
            && now - s.to.born < MAX_AGE_MS) break;
          this.removeFirst(chain);
        }
        if (!chain.spans.length) chain.last = null;
      }
      if (f.closed && !f.core.spans.length && !f.wake.spans.length) this.flights.delete(id);
    }
  }
  clearSource(source: number, detach = false): void {
    for (const [id, f] of this.flights) if (f.source === source) {
      if (detach) { f.source = -1; this.close(f); continue; }
      for (const chain of [f.core, f.wake]) while (chain.spans.length) this.removeFirst(chain);
      this.flights.delete(id);
    }
  }
  clear(): void {
    this.generation++;
    for (const f of this.flights.values()) for (const chain of [f.core, f.wake]) while (chain.spans.length) this.removeFirst(chain);
    this.flights.clear();
  }
  flush(): void {
    const pages = new Set<number>();
    for (const slot of this.dirty) {
      const span = this.slots[slot], offset = slot * FLIGHT_RIBBON_SLOT_WORDS;
      this.data.fill(0, offset, offset + FLIGHT_RIBBON_SLOT_WORDS);
      if (span) this.writeSpan(span);
      pages.add(Math.floor(slot / FLIGHT_RIBBON_PAGE_SIZE));
    }
    this.writes += pages.size;
    for (const page of pages) this.pageVersion[page]++;
    this.dirty.clear();
  }
  private writeSpan(s: FlightRibbonSpan): void {
    const a = join(s.from, s.previous?.from ?? null, s.to);
    const b = join(s.to, s.from, s.next?.to ?? null);
    let offset = s.slot * FLIGHT_RIBBON_SLOT_WORDS;
    const frame = this.frames[s.wake ? 1 : 0];
    const data = this.data;
    const vertex = (k: FlightRibbonKnot, v: Vec, normal: Vec, side: number) => {
      const terminal = s.terminal && k === s.to;
      const widthScale = terminal ? TERMINAL_WIDTH_SCALE : 1;
      const drift = k.bounce ? 0 : Math.sin((k.x * 0.6 + k.y * 0.8) / 96) * k.turbulence * k.spread;
      data[offset++] = k.x; data[offset++] = k.y;
      data[offset++] = v[0]; data[offset++] = v[1];
      data[offset++] = normal[0] * drift; data[offset++] = normal[1] * drift;
      data[offset++] = k.born; data[offset++] = k.life;
      data[offset++] = k.width * widthScale; data[offset++] = k.spread * widthScale;
      data[offset++] = ((k.color >> 16) & 255) / 255;
      data[offset++] = ((k.color >> 8) & 255) / 255;
      data[offset++] = (k.color & 255) / 255;
      data[offset++] = terminal ? 0 : k.alpha; data[offset++] = k.heat;
      data[offset++] = s.wake ? 1 : 0;
      data[offset++] = frame.u; data[offset++] = frame.top + (frame.bottom - frame.top) * side;
    };
    vertex(s.from, a.outgoing[0], a.normal, 0); vertex(s.from, a.outgoing[1], a.normal, 1); vertex(s.to, b.incoming[0], b.normal, 0);
    vertex(s.to, b.incoming[0], b.normal, 0); vertex(s.from, a.outgoing[1], a.normal, 1); vertex(s.to, b.incoming[1], b.normal, 1);
    if (s.next && b.bevel) {
      const innerSide = b.incoming[0] === b.bevel[0] ? 0 : 1;
      vertex(s.to, b.bevel[0], b.normal, innerSide);
      vertex(s.to, b.bevel[1], b.normal, 1 - innerSide);
      vertex(s.to, b.bevel[2], b.normal, 1 - innerSide);
    }
  }
  get liveCount(): number { return this.active; }
  get handleCount(): number { return this.flights.size; }
  /** Read-only material inspection; no Phaser objects or gameplay state are exposed. */
  spans(handle: FlightRibbonHandle, wake = false): readonly FlightRibbonSpan[] {
    const f = this.get(handle); return f ? (wake ? f.wake : f.core).spans : [];
  }
  stats(): GpuVfxPoolStats {
    return { capacity: this.capacity, liveCount: this.active, peakLive: this.peak, rearms: this.rearms,
      retirements: this.retirements, capacityDrops: this.drops, skipSteps: 0, segmentsTouched: this.writes, fullUploadFrames: 0 };
  }
  resetStats(): void { this.peak = this.active; this.rearms = this.retirements = this.drops = this.writes = 0; }
}
