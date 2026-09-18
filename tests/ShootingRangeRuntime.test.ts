import { describe, expect, it, vi } from 'vitest';
import { ShootingRangeRuntime } from '../src/shootingRange/ShootingRangeRuntime';
import { shootingRangeAction, parseShootingRangeRequest, type ShootingRangeControl } from '../src/shootingRange/ShootingRangeContracts';
import { SHOOTING_RANGE } from '../src/shootingRange/ShootingRangeLayout';
import { shootingRangeChartPoints } from '../src/shootingRange/ShootingRangeChart';
import { decodeShootingRange, encodeShootingRange } from '../src/network/shootingRangeCodec';

function fixture() {
  let identity = 0;
  const live = new Set<string>();
  const remove = vi.fn(target => live.delete(target.id));
  const spawn = vi.fn(() => {
    const id = `target-${++identity}`;
    live.add(id);
    return { id, generation: identity };
  });
  const runtime = new ShootingRangeRuntime({ spawn, remove, alive: target => live.has(target.id) });
  const press = (control: ShootingRangeControl, now = 0) => {
    const state = runtime.snapshot();
    const action = shootingRangeAction(state, control);
    return action ? runtime.request({ session: state.session, control, action }, now) : false;
  };
  return { runtime, live, remove, spawn, press };
}

describe('Lobby shooting range', () => {
  it('scrolls between confirmed samples without overshooting or extrapolating missing packets', () => {
    const state = fixture().runtime.snapshot();
    const interval = SHOOTING_RANGE.sampleIntervalMs;
    state.samples = [{ at: 0, dps: 0 }, { at: interval, dps: 100 }, { at: interval * 2, dps: 0 }];
    const halfway = shootingRangeChartPoints(state, interval * 3.5);
    expect(halfway.at(-1)).toEqual({ x: 1, value: 50 });
    expect(halfway.every(point => point.x >= 0 && point.x <= 1 && point.value >= 0 && point.value <= 100)).toBe(true);
    const later = shootingRangeChartPoints(state, interval * 3.75);
    expect(later[0].x).toBeLessThan(halfway[0].x);
    expect(later.at(-1)?.value).toBeCloseTo(25);
    expect(shootingRangeChartPoints(state, interval * 100)).toEqual(shootingRangeChartPoints(state, interval * 4));
    state.samples = [];
    expect(shootingRangeChartPoints(state, 1000)).toEqual([]);
  });

  it('preserves surviving slots while adding/removing, and replaces a defeated group only at step end', () => {
    const f = fixture();
    expect(f.runtime.snapshot()).toMatchObject({ enabled: false, targets: [], samples: [] });
    f.press('power'); f.press('plus'); f.press('plus');
    const original = f.runtime.snapshot().targets;
    f.live.delete(original[0]!.id);
    f.runtime.finishHostStep(0);
    expect(f.runtime.snapshot().targets).toEqual([null, original[1], original[2]]);
    f.press('minus');
    expect(f.remove).toHaveBeenCalledExactlyOnceWith(original[2]);
    f.press('plus');
    const added = f.runtime.snapshot().targets[2];
    expect(added).not.toEqual(original[2]);
    expect(f.runtime.snapshot().targets).toEqual([null, original[1], added]);
    f.live.clear();
    expect(f.spawn).toHaveBeenCalledTimes(4);
    f.runtime.finishHostStep(16);
    const next = f.runtime.snapshot().targets;
    expect(next).toHaveLength(3);
    expect(next.every(target => target && !original.some(old => old?.id === target.id))).toBe(true);
    expect(f.spawn).toHaveBeenCalledTimes(7);
  });

  it('bounds controls, consumes concrete intentions in order and rejects old activation sessions', () => {
    const f = fixture();
    expect(f.press('plus')).toBe(false);
    f.press('power');
    const session = f.runtime.snapshot().session;
    for (let i = 1; i < SHOOTING_RANGE.targets.length; i++) expect(f.press('plus')).toBe(true);
    expect(f.press('plus')).toBe(false);
    for (let i = 1; i < SHOOTING_RANGE.targets.length; i++) expect(f.press('minus')).toBe(true);
    expect(f.press('minus')).toBe(false);
    const request = { control: 'supply', action: 'supply-on', session } as const;
    expect(f.runtime.request(request, 0)).toBe(true);
    expect(f.runtime.request(request, 0)).toBe(false);
    f.press('power'); f.press('power', 1000);
    expect(f.runtime.request(request, 1000)).toBe(false);
    expect(f.runtime.snapshot()).toMatchObject({ count: 1, enabled: true, supply: false, samples: [], dps: 0 });
    f.runtime.destroy(); f.runtime.destroy();
    expect(f.live.size).toBe(0);
    expect(f.press('power')).toBe(false);
  });

  it('measures committed loss across groups, exact window boundaries and pauses without shrinking its scale', () => {
    const f = fixture();
    f.press('power');
    const target = f.runtime.snapshot().targets[0]!;
    f.runtime.recordDamage({ id: 'outside', generation: 1 }, 99999, 0);
    f.runtime.recordDamage({ ...target, generation: target.generation + 1 }, 99999, 0);
    f.runtime.recordDamage(target, 70, 0);
    f.runtime.recordDamage(target, 30, 0);
    f.live.clear();
    f.runtime.finishHostStep(0);
    expect(f.runtime.snapshot().dps).toBe(100);
    const next = f.runtime.snapshot().targets[0]!;
    f.runtime.recordDamage(target, 99999, 300);
    f.runtime.recordDamage(next, 20, 300);
    f.press('plus', 300); f.press('supply', 300);
    f.runtime.finishHostStep(300);
    expect(f.runtime.snapshot()).toMatchObject({ dps: 120, scale: 200 });
    f.runtime.finishHostStep(1000);
    expect(f.runtime.snapshot().dps).toBe(20);
    f.runtime.finishHostStep(1300);
    expect(f.runtime.snapshot()).toMatchObject({ dps: 0, scale: 200 });
    expect(f.runtime.snapshot().samples).toEqual(expect.arrayContaining([
      { at: 0, dps: 100 }, { at: 300, dps: 120 }, { at: 1000, dps: 20 }, { at: 1300, dps: 0 },
    ]));
    f.runtime.finishHostStep(12000);
    expect(f.runtime.snapshot().samples).toHaveLength(SHOOTING_RANGE.historyMs / SHOOTING_RANGE.sampleIntervalMs + 1);
    expect(f.runtime.snapshot().samples.every(sample => sample.dps === 0)).toBe(true);
    f.press('power', 12000); f.press('power', 12000);
    expect(f.runtime.snapshot()).toMatchObject({ scale: 100, samples: [] });
  });

  it('round-trips complete bounded history so a dropped packet needs no damage replay', () => {
    const f = fixture(); f.press('power'); f.press('plus');
    const target = f.runtime.snapshot().targets[0]!;
    f.runtime.recordDamage(target, 40, 0);
    f.live.delete(target.id); f.runtime.finishHostStep(0);
    const first = decodeShootingRange(encodeShootingRange(f.runtime.snapshot()));
    f.runtime.finishHostStep(250);
    f.runtime.finishHostStep(500);
    const lateJoin = decodeShootingRange(encodeShootingRange(f.runtime.snapshot()));
    expect(lateJoin).toEqual(f.runtime.snapshot());
    expect(lateJoin!.samples).toHaveLength(500 / SHOOTING_RANGE.sampleIntervalMs + 1);
    expect(first!.samples).toHaveLength(1);
    expect(lateJoin!.targets[0]).toBeNull();
    expect(decodeShootingRange([0, 1, 100000, 0, [], 0, 100, null, []])).toBeNull();
    expect(parseShootingRangeRequest({ session: 0, control: 'power', action: 'enable' })).not.toBeNull();
    expect(parseShootingRangeRequest({ session: NaN, control: 'power', action: 'enable' })).toBeNull();
    expect(parseShootingRangeRequest({ session: 0, control: 'unknown', action: 'enable' })).toBeNull();
  });
});
