import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));
import { FLIGHT_SIGNATURE_PROFILES } from '../src/projectile/FlightSignature';
import { tracerBounceDebug } from '../src/effects/TracerBounceDebugSettings';
import { PRISM_COLOR_PERIOD_MS, prismColorAtTime } from '../src/effects/prismPalette';
import { ProjectilePathCursor, ProjectilePathRecorder, type ProjectilePathPoint } from '../src/projectile/ProjectileFlightPath';
import { FLIGHT_RIBBON_SLOT_WORDS, FLIGHT_RIBBON_VERTEX_WORDS, GpuFlightRibbonStore,
  type FlightRibbonSpan } from '../src/effects/gpu/GpuFlightRibbon';

const point = (x: number, y: number, timeMs: number, bounce = false): ProjectilePathPoint => ({
  x, y, timeMs, sequence: timeMs + 1, vx: 1000, vy: 0, ...(bounce ? { bounceSequence: 1 } : {}),
});
function setup(capacity = 512) {
  const admission = { admit: () => true, attempt: vi.fn(), spawn: vi.fn(), drop: vi.fn() };
  const store = new GpuFlightRibbonStore(admission, [{ u: 0.1, top: 0.9, bottom: 0.8 }, { u: 0.2, top: 0.7, bottom: 0.6 }], capacity);
  const handle = store.create(3, { tuning: FLIGHT_SIGNATURE_PROFILES.heavy, color: 0xffaa66, emissive: 1 })!;
  const append = (from: ProjectilePathPoint, to: ProjectilePathPoint, now = to.timeMs, wake = false, h = handle) => {
    store.append(h, { from, to, ageMs: now - to.timeMs,
      birth: from.sequence === 1 && from.breakBefore }, now, wake, 1); store.flush();
  };
  return { store, handle, append, admission };
}
function vertex(store: GpuFlightRibbonStore, span: FlightRibbonSpan, n: number) {
  const start = span.slot * FLIGHT_RIBBON_SLOT_WORDS + n * FLIGHT_RIBBON_VERTEX_WORDS;
  return Array.from(store.data.subarray(start, start + FLIGHT_RIBBON_VERTEX_WORDS));
}
// Evaluate actual packed shader inputs at one absolute clock, including different birth times.
function evaluate(v: number[], now: number) {
  const age = Math.max(0, Math.min(1, (now - v[6]) / v[7])), cubic = age ** 3;
  return { x: v[0] + v[2] * (v[8] + v[9] * cubic) + v[4] * cubic,
    y: v[1] + v[3] * (v[8] + v[9] * cubic) + v[5] * cubic,
    alpha: v[13] * (1 - age) ** 2, heat: v[14] + (1 - v[14]) * age };
}

describe('GPU flight ribbon geometry and lifetime', () => {
  it('keeps the prism spectrum on curved and slow paths and releases its residual material', () => {
    const { store, append } = setup();
    const handle = store.create(4, { tuning: FLIGHT_SIGNATURE_PROFILES.prismatic,
      color: 0xffffff, emissive: 1, prismatic: true })!;
    const half = PRISM_COLOR_PERIOD_MS / 2;
    const a = { ...point(0, 0, 0), vx: 70, vy: 0 };
    const b = { ...point(8, 0, half), vx: 70, vy: 0 };
    const c = { ...point(8, 8, half * 2), vx: 0, vy: 70 };
    for (const wake of [false, true]) {
      append(a, b, half, wake, handle);
      append(b, c, half * 2, wake, handle);
      const spans = store.spans(handle, wake);
      const knots = spans.flatMap(span => [span.from, span.to]);
      expect(new Set(knots.map(knot => knot.color)).size).toBeGreaterThan(4);
      for (const knot of knots) {
        expect(knot.color).toBe(prismColorAtTime(knot.pathTime));
        expect(knot.y === 0 || knot.x === 8).toBe(true);
      }
      const corner = spans.findIndex(span => span.to.x === b.x && span.to.y === b.y);
      expect(spans[corner].to).toBe(spans[corner + 1].from);
    }
    store.end(handle);
    store.retire(10000);
    expect(store.spans(handle)).toHaveLength(0);
    expect(store.liveCount).toBe(0);
  });
  it('rejects a clipped sequence-one prefix during client interpolation, but recognizes launch', () => {
    for (const clipped of [false, true]) {
      const { store, handle } = setup();
      const recorder = new ProjectilePathRecorder(), cursor = new ProjectilePathCursor();
      recorder.begin(1, 0, 0, 1000, 0, 0);
      recorder.append(1, clipped ? 1100 : 40, 0, 1000, 0, clipped ? 1100 : 40);
      const path = recorder.read(1, clipped ? 1100 : 40)!;
      expect(path.points[0].sequence).toBe(1);
      cursor.consume(path, clipped ? 1050 : 20, segment => store.append(handle, segment, 0, false, 1));
      store.flush();
      const first = store.spans(handle)[0];
      expect(first).toBeDefined();
      if (clipped) expect(vertex(store, first, 0)[13]).toBeCloseTo(first.from.alpha);
      else expect(vertex(store, first, 0)[13]).toBe(0);
    }
  });
  it('debug pinning changes only wake spread at bounce vertices and is reversible live', () => {
    const { store, append } = setup(16);
    const a = point(0, 0, 0), b = point(40, 0, 40, true), c = point(20, 30, 70);
    for (const wake of [false, true]) { append(a, b, 70, wake); append(b, c, 70, wake); }
    const original = store.data.slice();
    try {
      tracerBounceDebug.pinBounceWake = true;
      store.flush();
      let changed = 0;
      for (let offset = 0; offset < original.length; offset += FLIGHT_RIBBON_VERTEX_WORDS) {
        for (let word = 0; word < FLIGHT_RIBBON_VERTEX_WORDS; word++) {
          const atBounceWake = original[offset] === b.x && original[offset + 1] === b.y
            && original[offset + 15] === 1;
          if (atBounceWake && word === 9) {
            expect(store.data[offset + word]).toBe(0);
            if (original[offset + word] !== 0) changed++;
          } else expect(store.data[offset + word]).toBe(original[offset + word]);
        }
      }
      expect(changed).toBeGreaterThan(0);
    } finally {
      tracerBounceDebug.pinBounceWake = false;
      store.flush();
    }
    expect(store.data).toEqual(original);
  });

  it.each([false, true])('tapers only the real birth along the shared path (wake=%s)', wake => {
    const { store, handle, append } = setup();
    const origin = { ...point(100, 80, 0), sequence: 1, breakBefore: true };
    const contact = point(102, 80, 2, true);
    append(origin, contact, 2, wake);
    const first = store.spans(handle, wake)[0];
    const birth = vertex(store, first, 0);
    expect(birth.slice(0, 2)).toEqual([100, 80]);
    expect(birth[13]).toBe(0);
    expect(birth[8]).toBeGreaterThan(0);
    expect(birth[8]).toBeLessThan(first.from.width);
    append(contact, point(102, 120, 42), 42, wake);
    const spans = store.spans(handle, wake);
    expect(vertex(store, spans[1], 0)).toEqual(vertex(store, first, 2));
    let alpha = 0;
    for (const span of spans) {
      const end = vertex(store, span, 2);
      expect(end[13]).toBeGreaterThanOrEqual(alpha);
      alpha = end[13];
      expect(end[0]).toBeGreaterThanOrEqual(100);
    }
    const last = spans[spans.length - 1];
    expect(vertex(store, last, 0)[13]).toBeCloseTo(last.from.alpha);
    expect(vertex(store, last, 0)[8]).toBeCloseTo(last.from.width);
    store.end(handle); store.flush();
    expect(vertex(store, first, 0)).toEqual(birth);
    expect(vertex(store, last, 2)[13]).toBe(0);
  });

  it.each(['break', 'aging', 'eviction', 'missing', 'clipped'] as const)('does not promote %s to a new birth', mode => {
    const { store, handle, append } = setup(mode === 'eviction' ? 2 : 512);
    const origin = { ...point(0, 0, 0), sequence: 1, breakBefore: true };
    if (mode !== 'missing' && mode !== 'clipped') append(origin, point(40, 0, 40));
    if (mode === 'break') store.break(handle);
    if (mode === 'aging') store.retire(1000);
    const from = mode === 'clipped' ? origin : point(40, 0, 40);
    append(from, point(80, 0, 80), mode === 'clipped' ? 1000 : 80);
    // The clipped ancient segment is expired; a later visible suffix stays full strength.
    if (mode === 'clipped') append(point(80, 0, 1000), point(100, 0, 1020));
    const spans = store.spans(handle), last = spans[spans.length - 1];
    expect(vertex(store, last, 0)[13]).toBeCloseTo(last.from.alpha);
    expect(vertex(store, last, 0)[8]).toBeCloseTo(last.from.width);
  });

  it('keeps birth distance through partial replay and does not restart after the taper', () => {
    const { store, handle, append } = setup();
    const origin = { ...point(0, 0, 0), sequence: 1, breakBefore: true };
    append(origin, point(2, 0, 2));
    const early = store.spans(handle)[0];
    append(origin, point(40, 0, 40));
    expect(store.spans(handle)[1].from).toBe(early.to);
    expect(vertex(store, early, 2)).toEqual(vertex(store, store.spans(handle)[1], 0));
    const before = store.spans(handle).length;
    append(origin, point(60, 0, 60));
    const continuation = store.spans(handle)[before];
    expect(continuation.from.x).toBe(40);
    expect(vertex(store, continuation, 0)[13]).toBeCloseTo(continuation.from.alpha);
    expect(vertex(store, continuation, 2)[13]).toBeCloseTo(continuation.to.alpha);
  });

  it.each(['end', 'linger'] as const)('tapers only the final real span on %s, leaving live heads and joins intact', closeMode => {
    const { store, handle, append } = setup();
    const a = point(0, 0, 0), b = point(40, 0, 40, true), c = point(40, 24, 64);
    const before = [false, true].map(wake => {
      append(a, b, 64, wake); append(b, c, 64, wake);
      const [previous, last] = store.spans(handle, wake);
      const end = vertex(store, last, 2);
      // Appending a live head must not introduce any spatial taper.
      expect(end[13]).toBeCloseTo(last.to.alpha);
      expect(end[8]).toBeCloseTo(last.to.width);
      return { previous, last, end, start: vertex(store, last, 0), join: vertex(store, previous, 2) };
    });
    const count = store.liveCount;
    const close = () => closeMode === 'end' ? store.end(handle) : store.clearSource(3, true);
    close(); store.flush();
    expect(store.liveCount).toBe(count);
    for (const { previous, last, end, start, join } of before) {
      expect(vertex(store, previous, 2)).toEqual(join);
      expect(vertex(store, last, 0)).toEqual(start);
      for (const index of [2, 3, 5]) {
        const terminal = vertex(store, last, index);
        expect(terminal[13]).toBe(0);
        expect(terminal[8]).toBeGreaterThan(0);
        expect(terminal[8]).toBeLessThan(end[8]);
        expect(terminal[9]).toBeLessThanOrEqual(end[9]);
        // No extra distance, lifetime reset or invented endpoint.
        expect(terminal.slice(0, 2)).toEqual([c.x, c.y]);
        expect(terminal.slice(6, 8)).toEqual(end.slice(6, 8));
        const middle = start.map((value, i) => (value + terminal[i]) / 2);
        expect(middle[13]).toBeGreaterThan(terminal[13]);
        expect(middle[13]).toBeLessThan(start[13]);
      }
    }
    const versions = [...store.pageVersion];
    close(); store.flush();
    expect([...store.pageVersion]).toEqual(versions);
  });

  it('shares both edges and aging at straight and curved joins at the same absolute time', () => {
    const { store, handle, append } = setup();
    const points = [point(0, 0, 0), point(32, 0, 32), point(55, 24, 64), point(50, 50, 96), point(24, 60, 128)];
    for (const wake of [false, true]) {
      for (let i = 1; i < points.length; i++) append(points[i - 1], points[i], 180 + i, wake);
      const spans = store.spans(handle, wake);
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i].from).toBe(spans[i - 1].to);
        for (const [end, start] of [[2, 0], [5, 1]]) {
          const a = vertex(store, spans[i - 1], end), b = vertex(store, spans[i], start);
          expect(a).toEqual(b);
          for (const now of [190, 300, 500, 750]) expect(evaluate(a, now)).toEqual(evaluate(b, now));
        }
      }
      const early = vertex(store, spans[0], 0), late = vertex(store, spans[0], 2);
      expect(evaluate(early, 190).alpha).toBeLessThan(evaluate(late, 190).alpha);
    }
    expect(Array.from(store.data).every(Number.isFinite)).toBe(true);
  });

  it('partitions sharp corners with a bounded bevel and pins bounce drift', () => {
    const { store, handle, append } = setup();
    const a = point(0, 0, 0), b = point(50, 0, 50, true), c = point(10, 25, 100);
    append(a, b, 100, true); append(b, c, 100, true);
    const [first, second] = store.spans(handle, true);
    const join = [6, 7, 8].map(n => vertex(store, first, n));
    expect(join[0][13]).toBeGreaterThan(0);
    for (const v of join) {
      expect(Math.hypot(v[2], v[3])).toBeLessThanOrEqual(2.00001);
      expect(Math.hypot(v[4], v[5])).toBe(0);
      expect(v.slice(0, 2)).toEqual([b.x, b.y]);
    }
    // Bevel shares its inner vertex with both bodies, and each outer vertex with one body.
    expect(join[0]).toEqual(vertex(store, first, 2));
    expect(join[0]).toEqual(vertex(store, second, 0));
    expect(join[1]).toEqual(vertex(store, first, 5));
    expect(join[2]).toEqual(vertex(store, second, 1));
  });

  it('ends a reversal at its confirmed point and never connects explicit breaks', () => {
    const { store, handle, append } = setup();
    const a = point(0, 0, 0), b = point(40, 0, 40, true), c = point(0, 0, 80);
    append(a, b); append(b, c);
    const [first, second] = store.spans(handle);
    for (const n of [2, 5]) expect(vertex(store, first, n)[2]).toBeCloseTo(0);
    for (const n of [0, 1]) expect(vertex(store, second, n)[2]).toBeCloseTo(0);
    expect(vertex(store, first, 6)[13]).toBe(0);
    store.break(handle);
    append(point(300, 300, 100), point(320, 300, 120));
    expect(store.spans(handle)[2].previous).toBeNull();
    expect(second.next).toBeNull();
  });

  it('clips replay, retains shared birth times, and accepts late terminal material only once', () => {
    const { store, handle, append } = setup();
    append(point(0, 0, 0), point(20, 0, 20), 40);
    const knot = store.spans(handle)[0].to;
    append(point(0, 0, 0), point(40, 0, 40), 140);
    expect(store.spans(handle)[1].from).toBe(knot);
    append(point(0, 0, 0), point(40, 0, 40), 200);
    expect(store.spans(handle)).toHaveLength(2);
    store.end(handle);
    append(point(40, 0, 40), point(60, 0, 60), 220);
    expect(store.spans(handle)).toHaveLength(2);
    // At 1000 px/s, coreLength in pixels equals the lifetime in milliseconds.
    const expiry = 40 + FLIGHT_SIGNATURE_PROFILES.heavy.coreLength;
    store.retire(expiry - 1); expect(store.liveCount).toBeGreaterThan(0);
    store.retire(expiry + 1); expect(store.liveCount).toBe(0);
    expect(store.handleCount).toBe(0);
  });

  it('fades within a span and keeps its newest endpoint alive for its full remaining lifetime', () => {
    const { store, handle, append } = setup();
    append(point(0, 0, 0), point(40, 0, 40), 100);
    const span = store.spans(handle)[0], old = vertex(store, span, 0), recent = vertex(store, span, 2);
    const expiry = span.to.born + span.to.life;
    expect(evaluate(old, expiry - 20).alpha).toBe(0);
    expect(evaluate(recent, expiry - 20).alpha).toBeGreaterThan(0);
    store.retire(expiry - 1); expect(store.liveCount).toBe(1);
    store.retire(expiry); store.flush(); expect(store.liveCount).toBe(0);
    expect(vertex(store, span, 0).every(n => n === 0)).toBe(true);
  });

  it('bounds huge steps and keeps a contiguous recent suffix under admission pressure', () => {
    const { store, handle, append } = setup(4);
    append(point(0, 0, 0), point(100000, 0, 20));
    let spans = store.spans(handle);
    expect(spans).toHaveLength(4);
    expect(spans[3].to.x).toBe(100000);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].from).toBe(spans[i - 1].to);
      expect(spans[i].to.x - spans[i].from.x).toBeLessThanOrEqual(64);
    }
    store.retire(40);
    append(point(100000, 0, 20), point(100020, 0, 40));
    spans = store.spans(handle);
    expect(spans[3].to.x).toBe(100020);
    expect(spans[0].previous).toBeNull();
    expect(store.stats().peakLive).toBeLessThanOrEqual(4);
  });

  it('separates reused IDs and stale handles, detaches linger sources, and clears all pages', () => {
    const { store, handle, append } = setup();
    append(point(0, 0, 0), point(20, 0, 20));
    store.clearSource(3, true);
    const fresh = store.create(3, { tuning: FLIGHT_SIGNATURE_PROFILES.heavy, color: 0xffffff, emissive: 1 })!;
    append(point(80, 0, 40), point(100, 0, 60), 60, false, fresh);
    expect(store.spans(fresh)[0].previous).toBeNull();
    store.clearSource(3);
    expect(store.liveCount).toBe(1);
    store.clear(); store.flush();
    append(point(20, 0, 20), point(40, 0, 40), 40, false, handle);
    expect(store.liveCount).toBe(0); expect(store.handleCount).toBe(0);
    expect([...store.pageLive].every(n => n === 0)).toBe(true);
    expect(store.data.every(n => n === 0)).toBe(true);
  });

  it('does not rewrite data during stillness or aging and never allocates for zero motion', () => {
    const { store, handle, append } = setup();
    append(point(0, 0, 0), point(0, 0, 10));
    expect(store.liveCount).toBe(0);
    append(point(0, 0, 10), point(40, 0, 50));
    store.end(handle); store.flush();
    const data = store.data.slice(), versions = [...store.pageVersion];
    store.retire(100); store.flush();
    expect(store.data).toEqual(data); expect([...store.pageVersion]).toEqual(versions);
  });
});
