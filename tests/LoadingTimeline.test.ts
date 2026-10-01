import { EventEmitter } from 'node:events';
import type * as Phaser from 'phaser';
import { observeLoaderProcessing } from '../src/ui/BootLoaderProgress';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoadingRun, loadingTimeline, summarizeResources } from '../src/diagnostics/LoadingTimeline';

afterEach(() => vi.restoreAllMocks());
describe('loading attribution without readiness authority', () => {
  it('retains overlapping barriers, reopens them and freezes completed runs', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const run = new LoadingRun('world', 'A');
    run.gate('water', false); run.gate('snapshot', false);
    now = 10; run.gate('water', true);
    now = 15; run.gate('water', false);
    now = 20; run.gate('water', true);
    now = 30; run.gate('snapshot', true); run.finish();
    const report = run.report();
    expect(report.durationMs).toBe(30);
    expect(report.barriers.map(g => g.waitingMs)).toEqual([15, 30]);
    expect(report.criticalPath.lastFulfilled).toBe('snapshot');
    now = 900; run.gate('water', false); run.add('stale-worker', 100);
    expect(run.report()).toEqual(report);
  });
  it('never attributes late work from an old world to its replacement', () => {
    const first = loadingTimeline.begin('world', 'first');
    first.add('bake', 5);
    const second = loadingTimeline.begin('world', 'second');
    first.add('late', 20);
    expect(first.outcome).toBe('superseded');
    expect(loadingTimeline.capture()).toBe(second);
    expect(second.report().topSections).toEqual([]);
    second.finish();
    expect(loadingTimeline.begin('world', 'second')).toBe(second);
  });
  it('aggregates slices without inventing additive elapsed time', () => {
    const run = new LoadingRun('boot', 'test');
    run.add('slice', 8); run.add('slice', 12); run.add('worker', 100, 'worker');
    const sections = run.report().topSections;
    expect(sections[0]).toMatchObject({ name: 'worker', kind: 'worker', totalMs: 100 });
    expect(sections[1]).toMatchObject({ calls: 2, totalMs: 20, maxMs: 12 });
  });
  it('distinguishes HTTP bytes, overlapping requests, cache and modules', () => {
    const entry = (name: string, startTime: number, duration: number, transferSize: number) => ({ name, startTime,
      duration, responseEnd: startTime+duration, transferSize, encodedBodySize: 100, decodedBodySize: 200 }) as PerformanceResourceTiming;
    const report = summarizeResources([
      entry('https://game/assets/environment/woodland/rock/a.png', 0, 10, 130),
      entry('https://game/assets/environment/woodland/rock/b.png', 5, 10, 0),
      entry('https://game/src/main.ts?t=5', 0, 5, 20),
    ]);
    expect(report.groups[0]).toMatchObject({ group: 'woodland/rock', requestMs: 20, wallSpanMs: 15,
      transferBytes: 130, encodedBytes: 200, zeroTransfer: 1 });
    expect(report.groups[1].group).toBe('modules');
  });
});
it('attributes processing once per completed file and releases listeners on disposal', () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const run = loadingTimeline.begin('boot', 'loader-test', true);
  const loader = new EventEmitter();
  const stop = observeLoaderProcessing(loader as unknown as Phaser.Loader.LoaderPlugin);
  const file = { key: 'leaf', type: 'image', src: '/assets/environment/woodland/canopy/albedo.png' };
  loader.emit('load', file);
  now = 20; loader.emit('filecomplete', 'leaf', 'image');
  loader.emit('filecomplete', 'leaf', 'image');
  expect(run.report().topSections).toMatchObject([{ calls: 1, totalMs: 20, kind: 'elapsed' }]);
  stop();
  expect(loader.eventNames()).toEqual([]);
  loader.emit('load', file); now = 40; loader.emit('filecomplete', 'leaf', 'image');
  expect(run.report().topSections[0].calls).toBe(1);
  run.finish();
});

it('bounds retained history and stops timing work after all scopes finish', () => {
  for (let i=0;i<20;i++) loadingTimeline.begin('world', 'bounded-'+i).finish();
  expect(loadingTimeline.report().runs.length).toBeLessThanOrEqual(12);
  expect(loadingTimeline.start()).toBe(-1);
});
