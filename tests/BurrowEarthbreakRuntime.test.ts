import { describe, expect, it, vi } from 'vitest';
import { BURROW_EARTHBREAK as tuning } from '../src/config/burrowEarthbreak';
import { BurrowEarthbreakRuntime } from '../src/systems/BurrowEarthbreakRuntime';
import { encodeBurrowEarthbreak, decodeBurrowEarthbreak } from '../src/network/burrowEarthbreakCodec';

const pose = (x: number, y = 0, positionRevision = 0) => ({ x, y, positionRevision });
function setup() { const damage = vi.fn(); return { damage, runtime: new BurrowEarthbreakRuntime(damage) }; }

describe('Earthbreak excavation and detonation', () => {
  it('samples travelled distance across corners, stationary frames and repeated ground', () => {
    const { runtime, damage } = setup();
    const d = tuning.spacingPx;
    runtime.start('p', pose(0));
    runtime.move('p', pose(d / 2));
    runtime.move('p', pose(d / 2));
    runtime.move('p', pose(d / 2, d / 2));
    runtime.move('p', pose(d / 2, d / 2 + d));
    runtime.move('p', pose(d / 2, d / 2));
    expect(runtime.snapshot()[0].points).toEqual([pose(d / 2, d / 2), pose(d / 2, d / 2 + d), pose(d / 2, d / 2)]
      .map(({ x, y }) => ({ x, y })));
    expect(damage).not.toHaveBeenCalled();
  });

  it('detonates the corrected emergence first and the entire trail backwards, exactly once', () => {
    const { runtime, damage } = setup();
    runtime.start('p', pose(0));
    runtime.move('p', pose(tuning.spacingPx * 3));
    runtime.exit('p', pose(tuning.spacingPx * 3 + 4), 1000);
    expect(damage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ damage: tuning.exitDamage, radius: tuning.exitRadius }));
    runtime.advance(1000 + tuning.intervalMs - 1, () => true);
    expect(damage).toHaveBeenCalledTimes(1);
    runtime.advance(1000 + tuning.intervalMs * 3, () => true);
    expect(damage.mock.calls.slice(1).map(([hit]) => hit.x)).toEqual([3, 2, 1].map(i => i * tuning.spacingPx));
    expect(damage.mock.calls.slice(1).every(([hit]) => hit.damage === tuning.damage
      && hit.vulnerabilityDurationMs === tuning.vulnerabilityDurationMs)).toBe(true);
    runtime.advance(1000 + tuning.intervalMs * 3, () => true);
    expect(damage).toHaveBeenCalledTimes(4);
    runtime.advance(1000 + tuning.intervalMs * 3 + tuning.presentationRetentionMs, () => true);
    expect(runtime.snapshot()).toEqual([]);
  });

  it('discards a teleported excavation and never joins the intervening ground', () => {
    const { runtime, damage } = setup();
    runtime.start('p', pose(0)); runtime.move('p', pose(tuning.spacingPx));
    runtime.move('p', pose(1000, 0, 1)); runtime.exit('p', pose(1000, 0, 1), 0);
    expect(runtime.snapshot()).toEqual([]); expect(damage).not.toHaveBeenCalled();
  });

  it('retains independently ignited chains and cancels every pending hit on owner removal or death', () => {
    const { runtime, damage } = setup();
    for (const offset of [0, 100]) {
      runtime.start('p', pose(offset)); runtime.move('p', pose(offset + tuning.spacingPx)); runtime.exit('p', pose(offset), 0);
    }
    expect(new Set(runtime.snapshot().map(s => s.id)).size).toBe(2);
    runtime.advance(tuning.intervalMs, () => true);
    expect(damage).toHaveBeenCalledTimes(4);
    runtime.advance(tuning.intervalMs * 2, () => false);
    expect(runtime.snapshot()).toEqual([]);
    runtime.start('p', pose(0)); runtime.removePlayer('p'); runtime.exit('p', pose(0), 1000);
    expect(damage).toHaveBeenCalledTimes(4);
    runtime.start('p', pose(0)); runtime.clear(); expect(runtime.snapshot()).toEqual([]);
  });

  it('preserves a whole, immutable snapshot through the wire, including empty refreshes', () => {
    const { runtime } = setup();
    runtime.start('p', pose(0)); runtime.move('p', pose(tuning.spacingPx));
    const digging = runtime.snapshot();
    runtime.move('p', pose(tuning.spacingPx * 2)); runtime.exit('p', pose(50), 500);
    expect(digging[0].points).toHaveLength(1);
    expect(decodeBurrowEarthbreak(encodeBurrowEarthbreak(digging))).toEqual(digging);
    expect(decodeBurrowEarthbreak(encodeBurrowEarthbreak(runtime.snapshot()))).toEqual(runtime.snapshot());
    expect(decodeBurrowEarthbreak([])).toEqual([]);
    expect(decodeBurrowEarthbreak([[1, 'p', [[NaN, 0]], null, null], [2, 'p', [], null, 0]])).toEqual([]);
  });
});
