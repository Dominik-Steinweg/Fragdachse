import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { metric, summarizeWindows, compareResults } from '../scripts/performance/metrics.mjs';
import { analyzeTrace, createSourceResolver, traceEvents } from '../scripts/performance/trace.mjs';
import { acquireOwned } from '../scripts/performance/lifecycle.mjs';

describe('Performance lab offline evidence', () => {
  it('closes resources that finish opening after the run has already timed out', async () => {
    const abort = new AbortController();
    let ready!: (value: object) => void;
    const resource = {}, closed: object[] = [];
    const pending = acquireOwned(() => new Promise(resolve => { ready = resolve; }),
      async value => { closed.push(value); }, abort.signal);
    const rejected = expect(pending).rejects.toThrow('timeout');
    abort.abort(new Error('timeout')); ready(resource);
    await rejected;
    expect(closed).toEqual([resource]);
  });
  it('streams compressed events and resolves the archived TypeScript source through its build map', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'fragdachse-performance-'));
    const assets = join(folder, 'site', 'assets');
    await mkdir(assets, { recursive: true });
    const mapFile = join(assets, 'test.js.map'), traceFile = join(folder, 'trace.json.gz');
    try {
      await writeFile(mapFile, JSON.stringify({ version: 3, sources: ['../../src/demo.ts'], names: ['originalFunction'], mappings: 'AAAAA' }));
      await writeFile(traceFile, gzipSync(JSON.stringify({ traceEvents: [{ name: 'ä marker' }, { name: 'second' }] })));
      const events = [];
      for await (const event of traceEvents(traceFile)) events.push(event);
      expect(events).toEqual([{ name: 'ä marker' }, { name: 'second' }]);
      const resolve = await createSourceResolver(folder);
      expect(await resolve({ functionName: 'a', url: 'http://localhost/assets/test.js', lineNumber: 0, columnNumber: 0 }))
        .toMatchObject({ name: 'originalFunction', snapshot: 'source/src/demo.ts', line: 1, mapped: true });
      expect(await resolve({ functionName: 'external', url: '', lineNumber: -1, columnNumber: -1 })).toMatchObject({ mapped: false });
    } finally {
      await unlink(mapFile); await unlink(traceFile); await rmdir(assets); await rmdir(join(folder, 'site')); await rmdir(folder);
    }
  });

  it('refuses metric comparison across incompatible scenario versions', () => {
    const run = (version: string) => ({ manifest: { scenarioVersion: version }, summary: { windows: [{ id: 'case', kind: 'measurement', caseVersion: 1 }] } });
    expect(compareResults(run('1'), run('2')).cases[0]).toMatchObject({ status: 'incompatible-scenario' });
  });
  it('computes percentiles from frames, preserves long hangs and marks missing GPU timings', () => {
    expect(metric([1, 2, 3, 4, 600])).toMatchObject({ median: 3, p99: 600, maximum: 600 });
    const result = { windows: [{ id: 'a', fromMs: 100, toMs: 200 }], game: {
      frameCapture: { startedAtPerformanceMs: 100, frames: [[1, 5, 600, 2, null, 3, 4], [2, 200, 10, 2, 1, 3, 4]] },
      series: { gpuSamples: [] }, session: {}, summaries: { gpu: { status: 'unsupported' } },
    } };
    const [window] = summarizeWindows(result);
    expect(window.frame.count).toBe(1);
    expect(window.frame.maximum).toBe(600);
    expect(window.renderSubmit).toBeNull();
    expect(window.gpu).toBeNull();
    expect(window.gpuStatus).toBe('unsupported');
    const gpu = summarizeWindows({ ...result, game: { ...result.game, series: { gpuSamples: [
      { renderFrame: 1, atMs: 999, durationMs: 7 }, { renderFrame: 2, atMs: 5, durationMs: 100 },
    ] } } });
    expect(gpu[0].gpu).toMatchObject({ count: 1, average: 7 });
  });

  it('flags changed conditions and actual load instead of automatically claiming an improvement', () => {
    const run = (browserVersion: string, enemies: number) => ({ manifest: { browserVersion }, summary: {
      windows: [{ id: 'a', kind: 'measurement', load: { enemies }, frame: { median: 10, p95: 20, p99: 40, maximum: 50 } }],
    } });
    const comparison = compareResults(run('1', 20), run('2', 10));
    expect(comparison.warnings).toContain('Abweichung: browserVersion');
    expect(comparison.cases[0]).toMatchObject({ loadChanged: true, status: 'conditions-differ' });
    const a = run('1', 20), b = run('1', 20);
    Object.assign(a.manifest, { caseId: 'standard' });
    Object.assign(b.manifest, { caseId: 'weapon.glock', durationMs: 60_000 });
    expect(compareResults(a, b).warnings).toEqual(['Abweichung: caseId', 'Abweichung: durationMs']);
  });

  it('aligns sample clocks, keeps workers separate and reports GC overlap without summing nested samples', async () => {
    const events = [
      { name: 'FD:lab:r:boot-start', pid: 1, tid: 10, ts: 1_000_000 }, { name: 'FD:lab:r:run-end', pid: 1, tid: 10, ts: 1_100_000 },
      ...[10, 20].flatMap(tid => [
        { ph: 'M', name: 'thread_name', pid: 1, tid, args: { name: tid === 10 ? 'CrRendererMain' : 'DedicatedWorker thread' } },
        { name: 'Profile', pid: 1, tid, id: tid, args: { data: { startTime: 1_000_000 } } },
        { name: 'ProfileChunk', pid: 1, tid, id: tid, ts: 1_020_000, args: { data: { cpuProfile: {
          nodes: [{ id: 1, callFrame: { functionName: 'parent' } }, { id: 2, parent: 1, callFrame: { functionName: 'leaf' } }], samples: [2, 2, 2],
        }, timeDeltas: [0, 20_000, -10_000] } } },
      ]),
      { name: 'MajorGC', ph: 'X', pid: 1, tid: 10, ts: 1_010_000, dur: 3000 },
      { name: 'MajorGC', ph: 'X', pid: 2, tid: 99, ts: 1_010_000, dur: 3000 },
    ];
    const result = { request: { runId: 'r', captureProfile: 'standard' }, markers: [{ name: 'boot-start', atMs: 0 }, { name: 'run-end', atMs: 100 }] };
    const report = await analyzeTrace(events, result, [{ id: 'a', fromMs: 5, toMs: 15, spikes: [{ atMs: 15, durationMs: 10 }] }]);
    expect(report.windows[0].threads).toHaveLength(2);
    expect(report.windows[0].threads.map(t => t.role)).toEqual(['main', 'worker']);
    expect(report.windows[0].threads[0].sampledMs).toBe(10);
    expect(report.windows[0].threads[0].self[0].ms).toBe(10);
    expect(report.windows[0].threads[0].inclusive).toHaveLength(2);
    expect(report.windows[0].spikes[0].gc).toHaveLength(1);
    expect(report.cpuSamples).toBe(6);
    expect(report.reorderedDeltas).toBe(2);
  });

  it('rejects traces without synchronization markers', async () => {
    await expect(analyzeTrace([], { request: { runId: 'r' }, markers: [] }, [])).rejects.toThrow('synchronization');
  });
  it('honors cancellation during offline trace processing', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Technical timeout'));
    await expect(analyzeTrace([{ name: 'anything' }], {}, [], undefined, controller.signal)).rejects.toThrow('Technical timeout');
  });
});
