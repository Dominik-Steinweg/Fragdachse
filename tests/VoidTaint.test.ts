import { describe, expect, it } from 'vitest';
import { createVoidMarcherSample, type VoidMarchers, type VoidMarcherSample } from '../src/arena/VoidDangerField';
import { createVoidLiftWave, liftArrivalSec, liftFront, LIFT_SEC } from '../src/arena/VoidLiftWave';
import {
  VOID_TAINT, VOID_TAINT_LIFTED, VOID_TAINT_OCCUPIED, VOID_TAINT_QUICK, VoidTaintTrails, voidTaintAge,
} from '../src/arena/VoidTaint';

const frame = { offsetX: 0, offsetY: 0, width: 4000, height: 4000 };

/** Bodies visited through one reused sample, like the mission's enemies. */
function marchers(bodies: Partial<VoidMarcherSample>[], retired?: VoidMarchers['retired']): VoidMarchers {
  const sample = createVoidMarcherSample();
  return {
    retired,
    forEach(visit) {
      for (const body of bodies) { Object.assign(sample, createVoidMarcherSample(), { active: true, size: 28 }, body); visit(sample); }
    },
  };
}
function stamps(trails: VoidTaintTrails) {
  return Array.from({ length: trails.used }, (_, i) => trails.stampAt(i)).filter(stamp => stamp !== undefined);
}

describe('Void taint trails (E12)', () => {
  it('lays a trail only while a body is active', () => {
    const trails = new VoidTaintTrails(frame);
    trails.feed(0, marchers([{ id: 'e1', x: 100, y: 100, active: false }]));
    expect(trails.size).toBe(0);
    trails.feed(16, marchers([{ id: 'e1', x: 100, y: 100 }]));
    expect(trails.size).toBe(1);
  });

  it('grows one capsule along a straight walk and connects a new one at a bend', () => {
    const trails = new VoidTaintTrails(frame);
    for (const [t, x] of [[0, 100], [100, 140], [200, 180]]) trails.feed(t, marchers([{ id: 'e1', x, y: 100 }]));
    expect(stamps(trails)).toHaveLength(1);
    expect(stamps(trails)[0]).toMatchObject({ ax: 100, bx: 180, birthB: 200 });
    trails.feed(300, marchers([{ id: 'e1', x: 180, y: 160 }]));
    const [first, second] = stamps(trails);
    expect(second).toMatchObject({ ax: 180, ay: 100, bx: 180, by: 160, birthA: first!.birthB, retireA: first!.retireB });
  });

  it('keeps the haze open only where a body still stands at its stamp', () => {
    const trails = new VoidTaintTrails(frame);
    trails.feed(0, marchers([{ id: 'e1', x: 100, y: 100 }]));
    trails.feed(100, marchers([{ id: 'e1', x: 140, y: 100 }]));
    trails.feed(200, marchers([{ id: 'e1', x: 140, y: 160 }]));
    expect(stamps(trails).map(s => s.flags)).toEqual([0, VOID_TAINT_OCCUPIED]);
    trails.feed(300, marchers([{ id: 'e1', x: 140, y: 160, active: false }]));
    expect(stamps(trails).map(s => s.flags)).toEqual([0, 0]);
  });

  it('breaks the trail on a new revision instead of bridging the jump', () => {
    const trails = new VoidTaintTrails(frame);
    trails.feed(0, marchers([{ id: 'e1', x: 100, y: 100 }]));
    trails.feed(100, marchers([{ id: 'e1', x: 140, y: 100, revision: 1 }]));
    expect(stamps(trails).map(s => [s.ax, s.bx])).toEqual([[100, 100], [140, 140]]);
  });

  it('keeps one stamp alive under a standing body with every birth inside the clock window', () => {
    const trails = new VoidTaintTrails(frame);
    for (let t = 0; t <= 60_000; t += 100) {
      trails.feed(t, marchers([{ id: 'e1', x: 300, y: 300 }]));
      const [stamp] = stamps(trails);
      const end = Math.max(stamp!.retireA, stamp!.retireB) + VOID_TAINT.fadeMs;
      expect(end - Math.min(stamp!.birthA, stamp!.birthB)).toBeLessThanOrEqual(VOID_TAINT.birthWindowMs);
      expect(stamp!.retireB).toBeGreaterThanOrEqual(t + VOID_TAINT.holdMs - VOID_TAINT.refreshMs);
    }
    expect(trails.size).toBe(1);
  });

  it('returns to ordinary fog by itself after hold and fade', () => {
    const trails = new VoidTaintTrails(frame);
    trails.feed(0, marchers([{ id: 'e1', x: 100, y: 100 }]));
    trails.feed(VOID_TAINT.holdMs + VOID_TAINT.fadeMs - 100, marchers([]));
    expect(trails.size).toBe(1);
    trails.feed(VOID_TAINT.holdMs + VOID_TAINT.fadeMs + 1, marchers([]));
    expect(trails.size).toBe(0);
  });

  it('lifts only its zone, later further out, and spares trails laid after the wave started', () => {
    const trails = new VoidTaintTrails(frame);
    const bodies = [{ id: 'near', x: 100, y: 0, zone: 'north' }, { id: 'far', x: 900, y: 0, zone: 'north' },
      { id: 'other', x: 500, y: 0, zone: 'south' }, { id: 'free', x: 300, y: 0, zone: null }];
    trails.feed(0, marchers(bodies));
    const wave = createVoidLiftWave(0, 0, 120, trails.reachOf('north', 0, 0));
    expect(wave.radius).toBeGreaterThan(900);
    expect(wave.durationSec).toBeGreaterThan(LIFT_SEC);
    expect(wave.durationSec).toBeLessThanOrEqual(LIFT_SEC * 2);
    trails.lift('north', 1000, wave);
    const byX = new Map(stamps(trails).map(s => [s.ax, s]));
    // The bodies of the lifted zone are gone from their stamps; the others still stand on theirs.
    expect(byX.get(100)!.flags).toBe(VOID_TAINT_LIFTED);
    expect(byX.get(900)!.flags).toBe(VOID_TAINT_LIFTED);
    expect(byX.get(900)!.retireA).toBeGreaterThan(byX.get(100)!.retireA);
    expect(byX.get(900)!.retireA).toBeLessThanOrEqual(1000 + wave.durationSec * 1000);
    expect(byX.get(500)!.flags).toBe(VOID_TAINT_OCCUPIED);
    expect(byX.get(300)!.flags).toBe(VOID_TAINT_OCCUPIED);
    trails.feed(1100, marchers([{ id: 'near', x: 100, y: 40, zone: 'north', revision: 2 }]));
    expect(stamps(trails).find(s => s.ay === 40)!.flags).toBe(VOID_TAINT_OCCUPIED);
    trails.feed(1000 + wave.durationSec * 1000 + VOID_TAINT.quickFadeMs + 1, marchers([]));
    expect(stamps(trails).some(s => s.zone === 'north' && s.ay === 0)).toBe(false);
  });

  it('runs one wave front whose arrival grows with the distance', () => {
    const wave = createVoidLiftWave(0, 0, 200, 1500);
    let previous = -1;
    for (let d = 0; d <= wave.radius; d += 50) {
      const arrival = liftArrivalSec(wave, d);
      expect(arrival).toBeGreaterThanOrEqual(previous);
      expect(liftFront(wave, arrival)).toBeCloseTo(d, 3);
      previous = arrival;
    }
    expect(createVoidLiftWave(0, 0, 200).durationSec).toBe(LIFT_SEC);
  });

  it('fades dropped groups quickly and only once per revision', () => {
    const trails = new VoidTaintTrails(frame);
    trails.feed(0, marchers([{ id: 'r1', x: 100, y: 100, group: 3 }, { id: 'r2', x: 400, y: 100, group: 4 }]));
    trails.feed(100, marchers([{ id: 'r2', x: 400, y: 100, group: 4 }], { revision: 1, groups: [3] }));
    expect(stamps(trails).map(s => [s.group, s.flags])).toEqual([[3, VOID_TAINT_QUICK], [4, VOID_TAINT_OCCUPIED]]);
    trails.feed(100 + VOID_TAINT.quickFadeMs + 1, marchers([{ id: 'r2', x: 400, y: 100, group: 4 }], { revision: 1, groups: [3] }));
    expect(stamps(trails).map(s => s.group)).toEqual([4]);
  });

  it('replaces the stamp that retires first when it is full', () => {
    const trails = new VoidTaintTrails(frame, 3);
    for (const [t, id] of [[0, 'a'], [10, 'b'], [20, 'c'], [30, 'd']] as const) trails.feed(t, marchers([{ id, x: t * 10 + 100, y: 0 }]));
    expect(stamps(trails).map(s => s.ax).sort()).toEqual([200, 300, 400]);
    expect(trails.dropped).toBe(1);
  });

  it('encodes times as signed ages modulo the clock, as the GPU decodes them', () => {
    const at = (now: number, time: number) => voidTaintAge(VoidTaintTrails.clock(now), VoidTaintTrails.clock(time));
    expect(at(5_000, 0)).toBe(5_000);
    expect(at(61_000, 59_000)).toBe(2_000);
    expect(at(119_500, 120_500 + VOID_TAINT.holdMs)).toBe(-VOID_TAINT.holdMs - 1_000);
  });
});
