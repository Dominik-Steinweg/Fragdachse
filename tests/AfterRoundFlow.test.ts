import { describe, it, expect } from 'vitest';
import { AfterRoundFlow, type AfterRoundStep } from '../src/scenes/arena/AfterRoundFlow';

describe('after-round presentation', () => {
  it.each(Array.from({ length: 8 }, (_, mask) => [mask]))('shows only earned steps, in order (combination %i)', mask => {
    const flow = new AfterRoundFlow();
    const order: AfterRoundStep[] = ['items', 'upgrades', 'base'];
    const expected = order.filter((_, index) => (mask & (1 << index)) !== 0);
    flow.prepare(123, [...expected].reverse());
    const actual: AfterRoundStep[] = [];
    for (let step = flow.start(); step; step = flow.finish(step)) actual.push(step);
    expect(actual).toEqual(expected);
    expect(flow.active).toBe(false);
    flow.prepare(123, order);
    expect(flow.start()).toBeNull();
  });
  it('inserts an upgrade earned by item salvage, and ignores repeated callbacks and late duplicate grants', () => {
    const flow = new AfterRoundFlow();
    flow.prepare(1, ['items', 'base']);
    expect(flow.start()).toBe('items');
    flow.add('upgrades'); flow.add('items'); flow.add('upgrades');
    expect(flow.start()).toBeNull();
    expect(flow.finish('items')).toBe('upgrades');
    flow.add('items');
    expect(flow.finish('items')).toBeNull();
    expect(flow.step).toBe('upgrades');
    expect(flow.finish('upgrades')).toBe('base');
    flow.add('upgrades'); flow.add('base');
    expect(flow.finish('base')).toBeNull();
  });
  it('drops pending presentation on teardown without replaying the old round', () => {
    const flow = new AfterRoundFlow();
    flow.prepare(1, ['items', 'upgrades', 'base']); flow.start(); flow.cancel();
    expect(flow.finish('items')).toBeNull();
    flow.prepare(2, ['base']); expect(flow.start()).toBe('base');
  });
});
