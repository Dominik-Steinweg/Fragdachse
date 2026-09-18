import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootPreparation, onBootSceneTeardown } from '../src/ui/BootPreparation';

describe('cooperative boot preparation', () => {
  let frames: Map<number, FrameRequestCallback>;
  let now: number;
  beforeEach(() => {
    vi.useFakeTimers();
    frames = new Map(); now = 0;
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const frame = () => {
    const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(now);
  };

  it('gives the browser a paint opportunity before work and batches cheap steps without delays', () => {
    const work = vi.fn(), ready = vi.fn(), error = vi.fn(), step = vi.fn();
    function* steps() { work(); yield 'one'; work(); yield 'two'; }
    new BootPreparation(steps(), step, ready, error).start();
    expect(work).not.toHaveBeenCalled();
    frame();
    expect(work).not.toHaveBeenCalled(); // rAF is still before paint
    vi.runOnlyPendingTimers();
    expect(work).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('yields at the budget and never publishes readiness with only partial work', () => {
    const ready = vi.fn(), step = vi.fn(), completed: string[] = [];
    function* steps() {
      now += 9; completed.push('first'); yield 'first';
      completed.push('second'); yield 'second';
    }
    new BootPreparation(steps(), step, ready, vi.fn(), 8).start();
    frame(); vi.runOnlyPendingTimers();
    expect(completed).toEqual(['first']);
    expect(step).toHaveBeenCalledWith('first', 9);
    expect(ready).not.toHaveBeenCalled();
    frame(); vi.runOnlyPendingTimers();
    expect(completed).toEqual(['first', 'second']);
    expect(ready).toHaveBeenCalledOnce();
  });

  it.each(['frame', 'task', 'partial'] as const)('cancels while waiting for %s without continuing initialization', (where) => {
    const ready = vi.fn(), work = vi.fn(), released = vi.fn();
    function* steps() {
      try { now += 9; yield 'first'; work(); }
      finally { released(); }
    }
    const run = new BootPreparation(steps(), vi.fn(), ready, vi.fn());
    run.start();
    if (where !== 'frame') frame();
    if (where === 'partial') vi.runOnlyPendingTimers();
    run.cancel(); run.cancel();
    frame(); vi.runAllTimers();
    expect(work).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    expect(released).toHaveBeenCalledTimes(where === 'partial' ? 1 : 0);
  });

  it('routes initialization errors once and never marks the scene ready', () => {
    const error = new Error('texture setup failed'), failed = vi.fn(), ready = vi.fn();
    function* steps(): Generator<string, void> { throw error; }
    new BootPreparation(steps(), vi.fn(), ready, failed).start();
    frame(); vi.runAllTimers();
    expect(failed).toHaveBeenCalledExactlyOnceWith(error);
    expect(ready).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it.each(['shutdown', 'destroy'])('releases partial resources once on %s', (event) => {
    const events = new EventEmitter(), cleanup = vi.fn();
    onBootSceneTeardown(events, cleanup);
    events.emit(event); events.emit('destroy'); events.emit('shutdown');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(events.eventNames()).toEqual([]);
  });
});
