import { describe, it, expect, vi } from 'vitest';
import { AfterRoundFlow, type AfterRoundStep } from '../src/scenes/arena/AfterRoundFlow';
import { AfterRoundTransition, type AfterRoundView } from '../src/ui/AfterRoundTransition';

describe('after-round presentation', () => {
  it('separates room revisions and legacy timestamps while deduplicating A/B/A replay', () => {
    const flow = new AfterRoundFlow();
    for (const roomCode of ['AAAAAA', 'BBBBBB']) {
      flow.prepare(42, ['items'], { roomCode, roundRevision: 1 });
      expect(flow.start()).toBe('items'); flow.finish('items');
    }
    flow.prepare(43, ['items'], { roomCode: 'AAAAAA', roundRevision: 1 });
    expect(flow.start()).toBeNull();
    flow.prepare(42, ['items']); expect(flow.start()).toBe('items'); flow.finish('items');
    flow.prepare(42, ['items']); expect(flow.start()).toBeNull();
  });
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

describe('after-round visual handoff', () => {
  function fixture() {
    const animations: any[] = [];
    const block = vi.fn();
    const transition = new AfterRoundTransition({ tweens: { add: (config: any) => {
      animations.push(config); return { remove: vi.fn() };
    } } } as never, block);
    function view(depth: number) {
      const state = { alpha: 1, depth, visible: true };
      const surface: AfterRoundView = { depth, setAlpha: alpha => { state.alpha = alpha; },
        setDepth: value => { state.depth = value; }, retire: vi.fn(() => { state.visible = false; }) };
      return { surface, state };
    }
    function tick(fraction: number) {
      const animation = animations.at(-1)!;
      animation.targets.alpha = fraction;
      animation.onUpdate();
    }
    return { transition, block, view, animations, tick, complete: () => animations.at(-1)!.onComplete() };
  }

  it.each([{ steps: ['items', 'upgrades', 'base'] }, { steps: ['upgrades'] }, { steps: [] }])('retains coverage across the earned sequence $steps', ({ steps }) => {
    const f = fixture();
    let previous = f.view(14);
    for (const _step of steps) {
      f.transition.begin(previous.surface);
      const ready = f.transition.opening(vi.fn())!;
      expect(previous.state).toMatchObject({ alpha: 1, visible: true });
      const next = f.view(11);
      ready.ready(next.surface);
      expect(next.state.depth).toBeGreaterThan(previous.state.depth);
      f.tick(0.5);
      expect(previous.state).toMatchObject({ alpha: 1, visible: true });
      expect(f.block).toHaveBeenLastCalledWith(true);
      f.complete();
      expect(previous.state.visible).toBe(false);
      expect(next.state).toMatchObject({ alpha: 1, depth: 11, visible: true });
      expect(f.block).toHaveBeenLastCalledWith(false);
      previous = next;
    }
    f.transition.begin(previous.surface);
    f.transition.finish();
    f.tick(0.5);
    expect(previous.state.visible).toBe(true);
    f.complete();
    expect(previous.state.visible).toBe(false);
    expect(f.transition.active).toBe(false);
    expect(f.block).toHaveBeenLastCalledWith(false);
  });

  it('keeps the last real screen while a loading destination is skipped', () => {
    const f = fixture(), source = f.view(14);
    f.transition.begin(source.surface);
    const skipped = f.transition.opening(vi.fn())!;
    f.transition.begin(null);
    const next = f.transition.opening(vi.fn())!;
    const stale = f.view(15);
    skipped.ready(stale.surface);
    expect(stale.state.visible).toBe(false);
    expect(source.state).toMatchObject({ alpha: 1, visible: true });
    next.ready(f.view(11).surface); f.complete();
    expect(source.surface.retire).toHaveBeenCalledOnce();
  });

  it.each(['loading', 'blending'] as const)('invalidates callbacks and releases input on cancellation during %s', phase => {
    const f = fixture(), source = f.view(14), incoming = f.view(11), unavailable = vi.fn();
    f.transition.begin(source.surface);
    const opening = f.transition.opening(unavailable)!;
    if (phase === 'blending') opening.ready(incoming.surface);
    f.transition.cancel();
    if (phase === 'loading') opening.ready(incoming.surface);
    else f.complete();
    opening.unavailable();
    expect(unavailable).not.toHaveBeenCalled();
    expect(source.surface.retire).toHaveBeenCalledOnce();
    expect(incoming.surface.retire).toHaveBeenCalledOnce();
    expect(f.transition.active).toBe(false);
    expect(f.block).toHaveBeenLastCalledWith(false);
    f.block.mockClear(); f.transition.cancel();
    expect(f.block).not.toHaveBeenCalled();
  });
});
