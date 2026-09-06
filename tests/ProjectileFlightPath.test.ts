import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { ProjectilePathRecorder, ProjectilePathCursor, ProjectileTrailSampler, sampleProjectilePath,
  type ProjectileFlightPath, type ProjectileTrailSegment } from '../src/projectile/ProjectileFlightPath';
import { ProjectileFlightPlayback } from '../src/projectile/ProjectileFlightPlayback';
import { encodeProjectileDynamic, decodeProjectileDynamics, countProjectileDynamics } from '../src/network/projectileSnapshotCodec';
import type { SyncedProjectile } from '../src/types';

function curve(): ProjectileFlightPath {
  return { timeMs: 60, points: [
    { sequence: 1, timeMs: 0, x: 0, y: 0, vx: 1000, vy: 0, breakBefore: true },
    { sequence: 2, timeMs: 20, x: 20, y: 0, vx: 700, vy: 700 },
    { sequence: 3, timeMs: 40, x: 34, y: 14, vx: 0, vy: -1000, bounceSequence: 1 },
    { sequence: 4, timeMs: 60, x: 34, y: -6, vx: 0, vy: -1000 },
  ] };
}
function projectile(path = curve()): SyncedProjectile {
  return { id: 1, ownerId: 'host', x: 34, y: -6, vx: 0, vy: -1000, size: 5, color: 0xffaa00,
    style: 'bullet', tracer: { profile: 'heavy' }, flightPath: path,
    bounce: { sequence: 1, x: 34, y: 14, vx: 0, vy: -1000, tracerBounce: true } };
}

describe('projectile flight path', () => {
  it('turns once on the center trajectories and excludes reset positions on host and wire', () => {
    const recorder = new ProjectilePathRecorder();
    recorder.begin(1, 0, 0, 1000, 1000, 0);
    recorder.observe(1, 30, 30, 1000, 1000, 20);
    // Surface impact (20,20), technical separation to (16,20).
    recorder.bounce(1, 16, 20, -1000, 1000, 20, 1);
    recorder.append(1, 16, 20, -1000, 1000, 20);
    recorder.append(1, 16, 20, -1000, 1000, 20 + 1e-8);
    recorder.observe(1, 16, 20, -1000, 1000, 21);
    recorder.commitThrough(1, 16, 20);
    expect(recorder.read(1, 21)!.points.map(p => [p.x, p.y])).toEqual([[0, 0], [18, 18]]);
    recorder.observe(1, 6, 30, -1000, 1000, 30);
    recorder.commitThrough(1, 6, 30);
    const path = recorder.read(1, 30)!;
    const wire: Array<number | string> = [];
    encodeProjectileDynamic(wire, { ...projectile(path), bounce: {
      sequence: 1, x: 20, y: 20, vx: -1000, vy: 1000, tracerBounce: true,
    } });
    const decoded = decodeProjectileDynamics(wire)[0];
    expect(decoded.bounce).toMatchObject({ x: 20, y: 20 });
    for (const candidate of [path, decoded.flightPath!]) {
      const segments: ProjectileTrailSegment[] = [];
      new ProjectilePathCursor().consume(candidate, 30, s => segments.push(s));
      expect(segments.map(s => [s.from.x, s.from.y, s.to.x, s.to.y])).toEqual([
        [0, 0, 18, 18], [18, 18, 6, 30],
      ]);
    }
  });

  it('plays the corrected pivot and separate impact once on the client', () => {
    const recorder = new ProjectilePathRecorder();
    recorder.begin(1, 0, 0, 1000, 1000, 0);
    recorder.bounce(1, 16, 20, -1000, 1000, 20, 1);
    recorder.append(1, 6, 30, -1000, 1000, 30);
    const shot = { ...projectile(recorder.read(1, 30)!), bounce: {
      sequence: 1, x: 20, y: 20, vx: -1000, vy: 1000, tracerBounce: true,
    } };
    const playback = new ProjectileFlightPlayback(), cursor = new ProjectilePathCursor();
    const segments: ProjectileTrailSegment[] = [], impacts: unknown[] = [];
    playback.sync([shot], 1000);
    for (let now = 1000; now <= 1100; now += 5) {
      playback.read(now, (state, time, _new, bounces) => {
        cursor.consume(state.flightPath!, time, s => segments.push(s));
        impacts.push(...bounces);
      });
    }
    expect(impacts).toEqual([shot.bounce]);
    expect(segments.length).toBeGreaterThan(0);
    for (const { from, to } of segments) {
      if (to.timeMs <= 20) expect(to.x).toBeCloseTo(to.y);
      else expect(to.x - from.x).toBeCloseTo(-(to.y - from.y));
    }
  });

  it('keeps head-on pivots finite and clears bounce origins on discontinuity and reuse', () => {
    const recorder = new ProjectilePathRecorder();
    recorder.begin(1, 0, 0, 1000, 0, 0);
    recorder.bounce(1, 18, 0, -1000, 0, 20, 1);
    recorder.append(1, 18, 0, -1000, 0, 25);
    expect(recorder.read(1, 25)!.points.map(p => p.x)).toEqual([0, 18]);
    recorder.append(1, 100, 100, 0, 1000, 20, true);
    expect(recorder.read(1, 25)!.points.at(-1)).toMatchObject({ x: 100, breakBefore: true });
    recorder.begin(1, 0, 0, 1000, 0, 0);
    recorder.append(1, 18, 0, 1000, 0, 10);
    expect(recorder.read(1, 10)!.points).toHaveLength(2);
  });

  it('publishes only the confirmed physics prefix and preserves recent movement after an observation overflow', () => {
    const recorder = new ProjectilePathRecorder();
    recorder.begin(1, 0, 0, 1000, 0, 0);
    recorder.observe(1, 10, 0, 1000, 0, 10);
    recorder.observe(1, 20, 0, 1000, 0, 20);
    expect(recorder.commitThrough(1, 10, 0)).toBe(true);
    expect(recorder.read(1, 10)!.points.map(p => p.x)).toEqual([0, 10]);
    expect(recorder.commitThrough(1, 19, 0)).toBe(false);
    for (let i = 21; i <= 500; i++) recorder.observe(1, i, i % 2, 1000, 0, i);
    expect(recorder.commitThrough(1, 500, 0)).toBe(true);
    const path = recorder.read(1, 500)!;
    expect(path.points[path.points.length - 1].x).toBe(500);
    expect(path.points[0].breakBefore).toBe(true);
    expect(path.points.length).toBeLessThanOrEqual(128);
  });

  it('retains real curvature and bounce corners and consumes partial sections exactly once', () => {
    const cursor = new ProjectilePathCursor(), segments: ProjectileTrailSegment[] = [];
    const path = curve();
    cursor.consume(path, 10, s => segments.push(s));
    expect(segments[0].to.x).toBe(10);
    expect(segments[0].to.breakBefore).toBeUndefined();
    cursor.consume(path, 60, s => segments.push(s));
    expect(segments.map(s => [s.from.x, s.from.y, s.to.x, s.to.y])).toEqual([
      [0, 0, 10, 0], [10, 0, 20, 0], [20, 0, 34, 14], [34, 14, 34, -6],
    ]);
    cursor.consume(path, 100, s => segments.push(s));
    expect(segments).toHaveLength(4);
    expect(sampleProjectilePath(path, 30)).toMatchObject({ x: 27, y: 7 });
    expect(sampleProjectilePath(path, 100)).toMatchObject({ x: 34, y: -6 });
  });

  it('coalesces only uniform straight travel without re-emitting previously consumed material', () => {
    const recorder = new ProjectilePathRecorder(), cursor = new ProjectilePathCursor();
    recorder.begin(1, 0, 0, 1000, 0, 0);
    recorder.append(1, 20, 0, 1000, 0, 20);
    cursor.consume(recorder.read(1, 20)!, 20, () => {});
    recorder.append(1, 40, 0, 1000, 0, 40);
    const segments: ProjectileTrailSegment[] = [];
    cursor.consume(recorder.read(1, 40)!, 40, s => segments.push(s));
    expect(recorder.read(1, 40)!.points).toHaveLength(2);
    expect(segments).toHaveLength(1);
    expect(segments[0].from.x).toBe(20);
    recorder.append(1, 45, 10, 0, 1000, 60);
    expect(recorder.read(1, 60)!.points).toHaveLength(3);
  });

  it('discards tentative physics overshoot and never connects across a discontinuity', () => {
    const recorder = new ProjectilePathRecorder(), cursor = new ProjectilePathCursor();
    recorder.begin(1, 0, 0, 1000, 0, 0);
    recorder.observe(1, 100, 0, 1000, 0, 20);
    recorder.discardPending(1);
    recorder.append(1, 25, 0, -1000, 0, 20, false, 1);
    recorder.append(1, 200, 200, 0, 1000, 30, true);
    recorder.append(1, 200, 220, 0, 1000, 50);
    const segments: ProjectileTrailSegment[] = [];
    cursor.consume(recorder.read(1, 50)!, 50, s => segments.push(s));
    expect(segments.filter(s => !s.to.breakBefore).map(s => [s.from.x, s.to.x])).toEqual([[0, 25], [200, 200]]);
  });

  it('bounds history and hitch sampling while keeping every emitted point on the actual segment', () => {
    const recorder = new ProjectilePathRecorder();
    recorder.begin(1, 0, 0, 1, 1, 0);
    for (let i = 1; i <= 10000; i++) recorder.append(1, i, i % 2, 1, 1, i);
    const path = recorder.read(1, 10000)!;
    expect(path.points.length).toBeLessThanOrEqual(128);
    expect(path.points[0].timeMs).toBeGreaterThanOrEqual(9000);
    const samples: number[][] = [];
    new ProjectileTrailSampler().sample({ from: curve().points[1], to: curve().points[2], ageMs: 0 }, 0.5, 3,
      (x, y, nx, ny) => samples.push([x, y, nx, ny]));
    expect(samples).toHaveLength(3);
    for (const [x, y, nx, ny] of samples) { expect(x - 20).toBeCloseTo(y); expect(nx).toBeCloseTo(ny); }
  });

  it('round-trips complete paths and rejects malformed or unbounded payloads', () => {
    const stream: Array<number | string> = [];
    encodeProjectileDynamic(stream, projectile());
    encodeProjectileDynamic(stream, { ...projectile(), id: 2, flightPath: { ...curve(), ended: true } });
    expect(countProjectileDynamics(stream)).toBe(2);
    expect(decodeProjectileDynamics(stream).map(p => p.flightPath)).toEqual([curve(), { ...curve(), ended: true }]);
    expect(() => decodeProjectileDynamics(stream.slice(0, -1))).toThrow();
  });
});

describe('buffered projectile playback', () => {
  it('does not restart the presentation clock when an active history is duplicated', () => {
    const playback = new ProjectileFlightPlayback();
    playback.sync([projectile()], 1000);
    playback.read(1000, () => {});
    playback.sync([projectile()], 1030);
    let headY = 0;
    playback.read(1060, p => { headY = p.y; });
    expect(headY).toBe(-6);
  });

  it('heals a late terminal tail after absence without replaying material or resurrecting the head', () => {
    const playback = new ProjectileFlightPlayback(), cursor = new ProjectilePathCursor();
    const segments: ProjectileTrailSegment[] = [];
    const read = (now: number) => playback.read(now, (p, time, _new, _b, _done, headless) => {
      if (now >= 1150) expect(headless).toBe(true);
      cursor.consume(p.flightPath!, time, s => segments.push(s));
    });
    playback.sync([projectile()], 1000); read(1060);
    playback.sync([], 1060); read(1060);
    const count = segments.length;
    const final = { ...curve(), ended: true, timeMs: 80, points: [...curve().points,
      { sequence: 5, timeMs: 80, x: 34, y: -26, vx: 0, vy: -1000 }] };
    playback.sync([projectile(final)], 1100); read(1150);
    expect(segments.slice(count).map(s => [s.from.y, s.to.y])).toEqual([[-6, -26]]);
    playback.sync([projectile(final)], 1160); read(1200);
    expect(segments.length).toBe(count + 1);
    playback.read(2300, () => {});
    expect(playback.has(1)).toBe(false);
  });

  it('keeps head and bounce on the confirmed path and holds during packet loss', () => {
    const playback = new ProjectileFlightPlayback(), results: Array<{ x: number; y: number; bounces: number }> = [];
    playback.sync([projectile()], 1000);
    const read = (now: number) => playback.read(now, (p, _t, _new, b) => results.push({ x: p.x, y: p.y, bounces: b.length }));
    read(1000); read(1030); read(1500);
    expect(results).toEqual([{ x: 10, y: 0, bounces: 0 }, { x: 34, y: 14, bounces: 1 }, { x: 34, y: -6, bounces: 0 }]);
    playback.sync([projectile()], 1501);
    read(1502);
    expect(results[3].bounces).toBe(0);
  });

  it('never resurrects a head from repeated terminal history and clears the world scope', () => {
    const playback = new ProjectileFlightPlayback();
    const ended = projectile({ ...curve(), ended: true });
    playback.sync([ended], 1000);
    playback.read(1000, (_p, _t, _new, _b, _done, headless) => expect(headless).toBe(true));
    playback.sync([ended], 1040);
    let completed = false;
    playback.read(1050, (_p, _t, _new, _b, done) => { completed = done; });
    expect(completed).toBe(true);
    playback.sync([ended], 1100);
    const sink = vi.fn(); playback.read(1200, sink);
    expect(sink).not.toHaveBeenCalled();
    playback.clear(); expect(playback.has(1)).toBe(false);
  });
});
