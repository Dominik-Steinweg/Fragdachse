import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, unlink, rmdir, rm, stat } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { metric, summarizeWindows, compareResults, findings } from '../scripts/performance/metrics.mjs';
import { analyzeTrace, createSourceResolver, traceEvents, archiveDependencySources } from '../scripts/performance/trace.mjs';
import { acquireOwned, preserveFailedChromeTrace, transferChromeTrace, readBrowserJson } from '../scripts/performance/lifecycle.mjs';
import { createBuildStorage, checkDiskSpace, MINIMUM_FREE_BYTES, DISK_HEADROOM_BYTES } from '../scripts/performance/storage.mjs';
import { parsePerformanceOptions } from '../scripts/performance/options.mjs';
import { checkProbePair, summarizeProbe } from '../scripts/performance/network-report.mjs';

describe('Performance lab offline evidence', () => {
  it('rejects unrelated network captures even if their settings match', () => {
    const host = { schemaVersion: 1, experiment: 'p90-bubble-1', role: 'host', room: 'room', roundStart: 100,
      quality: 'high', buildSignature: 'build', cooldownMs: 200 };
    const client = { ...host, role: 'client' };
    expect(() => checkProbePair(host, client)).not.toThrow();
    expect(() => checkProbePair(host, { ...client, roundStart: 101 })).toThrow('roundStart');
    expect(() => checkProbePair(host, { ...client, error: 'disconnected' })).toThrow('Abgebrochener');
  });

  it('marks absent client updates as missing evidence, preserving the whole observation gap', () => {
    const result = { role: 'client', updates: [], samples: [],
      windows: [{ id: 'idle', kind: 'measurement', fromMs: 100, toMs: 2100 }], game: {
        frameCapture: { version: 2, startedAtPerformanceMs: 0, frames: [[1, 200, 16, 1, 1, 0, 0]] },
        series: { gpuSamples: [], samples: [], sampleIntervalMs: 1000 }, session: {}, summaries: { gpu: { status: 'unsupported' } },
      } };
    const phase = summarizeProbe(result)[0];
    expect(phase.errors).toContain('Keine laufenden Zustandsupdates');
    expect(phase.updateGapMaxMs).toBe(2000);
    expect(phase.sentKiBs).toBeNull();
  });

  it('uses exact phase action counts and rejects underload despite large cumulative counters', () => {
    const link = { bytesSent: 1000, reliableBufferedBytes: 0, fastBufferedBytes: 0 };
    const result = { role: 'host', cooldownMs: 100, updates: [],
      windows: [{ id: 'p90', kind: 'measurement', fromMs: 0, toMs: 6000, load: { shots: 1, hits: 2 } }],
      samples: [100, 5900].map((atMs, i) => ({ atMs, shots: 100 + 80 * i, projectiles: 5, links: [link] })), game: {
        frameCapture: { version: 2, startedAtPerformanceMs: 0, frames: [[1, 200, 16, 1, 1, 0, 5]] },
        series: { gpuSamples: [], samples: [], sampleIntervalMs: 1000 }, session: {}, summaries: { gpu: { status: 'unsupported' } },
      } };
    const phase = summarizeProbe(result)[0];
    expect(phase.shots).toBe(1);
    expect(phase.errors).toContain('Schusslast unterschritten');
  });
  it('defaults full runs to reduced tracing and focused runs to JS sampling, preserving explicit overrides', () => {
    expect(parsePerformanceOptions([]).captureProfile).toBe('reduced');
    expect(parsePerformanceOptions(['--case', 'standard']).captureProfile).toBe('reduced');
    expect(parsePerformanceOptions(['--case', 'enemies.high']).captureProfile).toBe('standard');
    expect(parsePerformanceOptions(['--capture-profile', 'standard']).captureProfile).toBe('standard');
    expect(parsePerformanceOptions(['--case', 'enemies.high', '--capture-profile', 'reduced']).captureProfile).toBe('reduced');
  });

  it('transfers large result JSON in bounded text chunks and releases the browser handle on cancellation', async () => {
    const encoded = JSON.stringify({ name: 'ä😀some more text', values: [1, null, 3] });
    let disposed = 0;
    let cancelDuringRead = false;
    const cancelled = new AbortController();
    const sizes: number[] = [];
    const page = { evaluateHandle: async (producer: Function) => {
      const remote = producer();
      // Primitive handles cross CDP by value, defeating bounded transfers.
      expect(remote).toEqual({ json: encoded });
      return {
        evaluate: async (fn: Function, args: unknown) => {
          const value = fn(remote, args);
          if (typeof value === 'string') sizes.push(value.length);
          if (cancelDuringRead && typeof value === 'string') cancelled.abort(new Error('cancelled'));
          return value;
        },
        dispose: async () => { disposed++; },
      };
    } };
    expect(await readBrowserJson(page, () => ({ json: encoded }), { chunkChars: 4 })).toBe(encoded);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(5);
    cancelDuringRead = true;
    await expect(readBrowserJson(page, () => ({ json: encoded }), { signal: cancelled.signal, chunkChars: 4 })).rejects.toThrow('cancelled');
    expect(disposed).toBe(2);
  });

  it('shares immutable build copies while edits to working files leave older captures intact', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'fd-build-storage-'));
    try {
      const source = join(folder, 'live');
      await mkdir(source);
      await writeFile(join(source, 'asset.txt'), 'original');
      const objects = join(folder, 'objects'), first = join(folder, 'first'), second = join(folder, 'second');
      const a = createBuildStorage(objects, first), b = createBuildStorage(objects, second);
      await a.archiveTree(source, join(first, 'site'));
      await b.archiveTree(source, join(second, 'site'));
      expect(b.statistics).toMatchObject({ storedBytes: 0, reusedBytes: 8, linkedFiles: 1 });
      expect((await stat(join(first, 'site/asset.txt'))).ino).toBe((await stat(join(second, 'site/asset.txt'))).ino);
      await writeFile(join(source, 'asset.txt'), 'changed');
      await b.archiveTree(source, join(second, 'site'));
      expect(await readFile(join(second, 'site/asset.txt'), 'utf8')).toBe('changed');
      expect(await readFile(join(first, 'site/asset.txt'), 'utf8')).toBe('original');
      const third = join(folder, 'third');
      await createBuildStorage(objects, third).archiveTree(source, join(third, 'site'));
      expect(await readFile(join(third, 'site/asset.txt'), 'utf8')).toBe('changed');
      await expect(a.archiveTree(source, join(folder, 'outside'))).rejects.toThrow('escapes');
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('reserves disk headroom before a write, including its projected size', async () => {
    const free = MINIMUM_FREE_BYTES + DISK_HEADROOM_BYTES + 100;
    const stats = async () => ({ bavail: free, bsize: 1 });
    expect(await checkDiskSpace('.', 100, stats)).toBe(free);
    await expect(checkDiskSpace('.', 101, stats)).rejects.toMatchObject({ code: 'PERF_DISK_SPACE' });
  });

  it('does not overwrite shared dependency sources when retrying an archive', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'fd-dependency-storage-'));
    try {
      const first = join(folder, 'first'), second = join(folder, 'second'), objects = join(folder, 'objects');
      const map = (content: string) => JSON.stringify({ sources: ['../node_modules/example/index.js'], sourcesContent: [content] });
      await mkdir(join(first, 'site/assets'), { recursive: true });
      await writeFile(join(first, 'site/assets/index.js.map'), map('original'));
      await archiveDependencySources(first);
      await createBuildStorage(objects, first).deduplicateTree(join(first, 'source'));
      await createBuildStorage(objects, second).archiveTree(join(first, 'source'), join(second, 'source'));
      await mkdir(join(second, 'site/assets'), { recursive: true });
      await writeFile(join(second, 'site/assets/index.js.map'), map('changed'));
      await archiveDependencySources(second);
      const dependency = 'source/dependencies/node_modules/example/index.js';
      expect(await readFile(join(first, dependency), 'utf8')).toBe('original');
      expect(await readFile(join(second, dependency), 'utf8')).toBe('changed');
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('streams a complete compressed Chrome trace and closes its handle when disk checks fail', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'fd-compressed-trace-'));
    const closed: string[] = [];
    const send = async (method: string, args: { handle: string }) => {
      if (method === 'IO.close') closed.push(args.handle);
      return { data: '{"traceEvents":[{"name":"ä"}]}', eof: true };
    };
    try {
      const path = join(folder, 'trace.json.gz');
      await transferChromeTrace({ send }, 'complete', path);
      expect(JSON.parse(gunzipSync(await readFile(path)).toString())).toEqual({ traceEvents: [{ name: 'ä' }] });
      await expect(transferChromeTrace({ send }, 'failed', join(folder, 'failed.gz'), {
        checkSpace: async () => { throw new Error('disk full'); },
      })).rejects.toThrow('disk full');
      expect(closed).toEqual(['complete', 'failed']);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('salvages a failed trace independently of the lost page and retains its data-loss flag', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fd-partial-trace-')), path = join(directory, 'partial.json');
    const session = Object.assign(new EventEmitter(), { send: async (method: string) => {
      if (method === 'Tracing.end') session.emit('Tracing.tracingComplete', { stream: 'trace', dataLossOccurred: true });
      if (method === 'IO.read') return { data: Buffer.from('{"traceEvents":[]}').toString('base64'), base64Encoded: true, eof: true };
      return {};
    } });
    try {
      expect(await preserveFailedChromeTrace(session, path)).toEqual({ dataLossOccurred: true });
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ traceEvents: [] });
      expect(session.listenerCount('Tracing.tracingComplete')).toBe(0);
    } finally { await unlink(path); await rmdir(directory); }
  });

  it('bounds failed-trace recovery and removes listeners when Chrome no longer answers', async () => {
    const session = Object.assign(new EventEmitter(), { send: () => new Promise(() => {}) });
    await expect(preserveFailedChromeTrace(session, 'unused.json', 5)).rejects.toThrow('timeout');
    expect(session.listenerCount('Tracing.tracingComplete')).toBe(0);
  });

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
      frameCapture: { version: 2, startedAtPerformanceMs: 100, frames: [[1, 5, 600, 2, null, 3, 4], [2, 50, 20, 2, 1, 3, 4], [3, 200, 10, 2, 1, 3, 4]] },
      series: { gpuSamples: [] }, session: {}, summaries: { gpu: { status: 'unsupported' } },
    } };
    const [window] = summarizeWindows(result);
    expect(window.frame.count).toBe(1);
    expect(window.frame.maximum).toBe(20);
    expect(window.boundaryIntervals[0]).toMatchObject({ durationMs: 600, overlapMs: 5, fromMs: -495, toMs: 105 });
    expect(window.spikes[0].durationMs).toBe(600);
    expect(window.renderSubmit).toBeNull();
    expect(window.gpu).toBeNull();
    expect(window.gpuStatus).toBe('unsupported');
    const gpu = summarizeWindows({ ...result, game: { ...result.game, series: { gpuSamples: [
      { renderFrame: 1, atMs: 10, submissionEndMs: 20, durationMs: 7 },
      { renderFrame: 2, atMs: 999, submissionEndMs: 1002, durationMs: 100 },
      { renderFrame: 3, atMs: 95, submissionEndMs: 105, durationMs: 50 },
    ] } } });
    expect(gpu[0].gpu).toMatchObject({ count: 1, average: 7 });
    expect(gpu[0].gpuBoundary).toHaveLength(1);
  });

  it('keeps first-use POST_UPDATE cost visible and joins a hang to the preceding callback', () => {
    const result = { windows: [{ id: 'prepare', kind: 'preparation', fromMs: 0, toMs: 10 },
      { id: 'smoke', kind: 'measurement', fromMs: 10, toMs: 400 }], game: {
      frameCapture: { version: 2, startedAtPerformanceMs: 0,
        frames: [[1, 0, 16, 2, 10, 4, 5], [2, 220, 220, 2, 1, 8, 9], [3, 236, 16, 2, 1, 8, 9]], work: [
          { frameId: 1, fromMs: 0, toMs: 218, complete: true, drawCalls: 9, offscreenDrawCalls: 6, spans: [
            { scope: 'sceneManager', fromMs: 1, toMs: 208 }, { scope: 'sceneUpdate', fromMs: 2, toMs: 8 },
            { scope: 'gameplay', fromMs: 3, toMs: 5 }, { scope: 'scenePostUpdate', fromMs: 20, toMs: 208 },
            { scope: 'renderSubmit', fromMs: 208, toMs: 218 }] },
          { frameId: 2, fromMs: 220, toMs: 224, complete: true, drawCalls: 4, offscreenDrawCalls: 0,
            spans: [{ scope: 'gameplay', fromMs: 221, toMs: 223 }] },
        ] }, series: { gpuSamples: [] }, session: {}, summaries: { gpu: { status: 'unsupported' } },
    } };
    const [prep, smoke] = summarizeWindows(result);
    expect(smoke.frame).toMatchObject({ count: 1, maximum: 16 });
    expect(smoke.costs.scopes.scenePostUpdate.maximum).toBe(188);
    expect(smoke.costs.scopes.gameplay.maximum).toBe(2);
    expect(smoke.spikes[0].work.callbacks.map(c => c.frameId)).toEqual([1]);
    expect(smoke.spikes[0].work.outsideCapturedCallbacksMs).toBe(2);
    expect(smoke.spikes[0].enemies).toBe(4);
    expect(smoke.boundaryIntervals[0].frameId).toBe(prep.boundaryIntervals[0].frameId);
    expect(smoke.drawCalls.maximum).toBe(4);
  });

  it('assigns intervals ending on a phase boundary to the preceding phase and keeps long contained frames', () => {
    const result = { windows: [{ id: 'a', fromMs: 0, toMs: 600 }, { id: 'b', fromMs: 600, toMs: 616 }], game: {
      frameCapture: { version: 2, startedAtPerformanceMs: 0, frames: [[1, 600, 600, 2, 1, 1, 2], [2, 616, 16, 2, 1, 1, 2]] },
      series: { gpuSamples: [] }, session: {}, summaries: { gpu: { status: 'unsupported' } },
    } };
    const [a, b] = summarizeWindows(result);
    expect(a.frame.maximum).toBe(600); expect(b.frame.maximum).toBe(16);
    expect(a.boundaryIntervals).toEqual([]); expect(b.boundaryIntervals).toEqual([]);
  });

  it('does not let persistent load findings crowd out stalls and transitions', () => {
    const windows = Array.from({ length: 10 }, (_, n) => ({ id: `load${n}`, kind: 'measurement', frame: { median: 30, p95: 40 }, spikes: [] }));
    windows.push({ id: 'smoke', kind: 'measurement', frame: { median: 5, p95: 6 },
      spikes: [{ frameId: 1, durationMs: 188, fromMs: 0, toMs: 188 }] } as any);
    windows.push({ id: 'load', kind: 'preparation', durationMs: 3000, overlappingFrame: { maximum: 500 } } as any);
    expect(findings(windows).slice(0, 3).map(f => f.type)).toEqual(['Einzelhänger', 'Dauerlast', 'Laden / Übergang']);
    const a = { manifest: {}, summary: { schemaVersion: 1, windows: [{ id: 'x', kind: 'measurement' }] } };
    const b = { ...a, summary: { ...a.summary, schemaVersion: 2 } };
    expect(compareResults(a, b).cases[0].status).toBe('incompatible-measurement');
  });

  it('exposes worsening frame pace and growing actual load in readable time sections', () => {
    const frames: number[][] = [];
    for (let at = 0, id = 0; at < 8000;) {
      const delta = at < 4000 ? 10 : 30; at += delta;
      frames.push([++id, at, delta, 1, 1, at < 4000 ? 40 : 120, at < 4000 ? 2 : 20]);
    }
    const result = { windows: [{ id: 'combat', kind: 'measurement', fromMs: 0, toMs: 8010 }], game: {
      frameCapture: { version: 2, startedAtPerformanceMs: 0, frames }, series: { gpuSamples: [] }, session: {}, summaries: { gpu: { status: 'unsupported' } },
    } };
    const [window] = summarizeWindows(result);
    expect(window.trend.ratio).toBe(3);
    expect(window.trend.first.enemies.median).toBe(40);
    expect(window.trend.last.enemies.median).toBe(120);
    expect(window.sections.at(-1).toMs).toBe(8010);
    expect(window.sections.at(-1).toMs - window.sections.at(-1).fromMs).toBeGreaterThan(1000);
    expect(findings([window]).some(f => f.type === 'Verschlechterung im Verlauf')).toBe(true);
  });

  it('flags changed conditions and actual load instead of automatically claiming an improvement', () => {
    const run = (browserVersion: string, enemies: number) => ({ manifest: { browserVersion }, summary: {
      windows: [{ id: 'a', kind: 'measurement', load: { enemies }, frame: { median: 10, p95: 20, p99: 40, maximum: 50 } }],
    } });
    const comparison = compareResults(run('1', 20), run('2', 10));
    expect(comparison.warnings).toContain('Abweichung: browserVersion');
    expect(comparison.cases[0]).toMatchObject({ loadChanged: true, status: 'conditions-differ' });
    const a = run('1', 20), b = run('1', 20);
    Object.assign(a.summary.windows[0], { costs: { scopes: { scenePostUpdate: { median: 8 } } } });
    Object.assign(b.summary.windows[0], { costs: { scopes: { scenePostUpdate: { median: 2 } } } });
    expect(compareResults(a, b).cases[0].differences['scope.scenePostUpdate'].median)
      .toEqual({ before: 8, after: 2, absolute: -6, percent: -75 });
    expect(compareResults(a, b).cases[0].differences['scope.scenePostUpdate'].p95).toBeNull();
    Object.assign(a.manifest, { caseId: 'standard' });
    Object.assign(b.manifest, { caseId: 'weapon.glock', durationMs: 60_000 });
    expect(compareResults(a, b).warnings).toEqual(['Abweichung: caseId', 'Abweichung: durationMs']);
    a.summary.windows[0].id = b.summary.windows[0].id = 'lobby';
    b.summary.windows[0].frame.median = 20;
    expect(compareResults(a, b).warnings.some(w => w.includes('Lobby-Frame-Takt'))).toBe(true);
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
    const report = await analyzeTrace(events, result, [
      { id: 'a', fromMs: 5, toMs: 15, spikes: [{ atMs: 15, durationMs: 10 }] },
      { id: 'later', fromMs: 15, toMs: 20, spikes: [] },
      { id: 'earlier', fromMs: 0, toMs: 5, spikes: [] },
      { id: 'after-last-sample', fromMs: 20, toMs: 30, spikes: [] },
    ]);
    expect(report.windows[0].threads).toHaveLength(2);
    expect(report.windows[0].threads.map(t => t.role)).toEqual(['main', 'worker']);
    expect(report.windows[0].threads[0].sampledMs).toBe(10);
    expect(report.windows[0].threads[0].self[0].ms).toBe(10);
    expect(report.windows[0].threads[0].inclusive).toHaveLength(2);
    expect(report.windows[0].spikes[0].gc).toHaveLength(1);
    expect(report.windows[1].threads[0].self[0].ms).toBe(5);
    expect(report.windows[2].threads[0].self[0].ms).toBe(5);
    expect(report.windows[3].threads).toEqual([]);
    expect(report.cpuSamples).toBe(6);
    expect(report.reorderedDeltas).toBe(2);
  });

  it('rejects traces without synchronization markers', async () => {
    await expect(analyzeTrace([], { request: { runId: 'r' }, markers: [] }, [])).rejects.toThrow('synchronization');
  });
  it('keeps project hotspots even when engine frames fill the inclusive ranking', async () => {
    const nodes = Array.from({ length: 25 }, (_, index) => ({ id: index + 1, parent: index || undefined,
      callFrame: { functionName: `engine-${index}` } }));
    nodes.push({ id: 26, parent: 25, callFrame: { functionName: 'game' } });
    const result = { request: { runId: 'r', captureProfile: 'standard' },
      markers: [{ name: 'boot-start', atMs: 0 }, { name: 'run-end', atMs: 100 }] };
    const events = [
      { name: 'FD:lab:r:boot-start', pid: 1, tid: 10, ts: 1_000_000 },
      { name: 'FD:lab:r:run-end', pid: 1, tid: 10, ts: 1_100_000 },
      { name: 'Profile', pid: 1, tid: 10, id: 1, args: { data: { startTime: 1_000_000 } } },
      { name: 'ProfileChunk', pid: 1, tid: 10, id: 1, ts: 1_100_000, args: { data: {
        cpuProfile: { nodes, samples: [25, 26, 26] }, timeDeltas: [0, 60_000, 40_000] } } },
    ];
    const report = await analyzeTrace(events, result, [{ id: 'a', fromMs: 0, toMs: 100, spikes: [] }],
      async frame => ({ ...frame, name: frame.functionName, mapped: true,
        snapshot: frame.functionName === 'game' ? 'source/src/game.ts' : 'source/dependencies/engine.js' }));
    const thread = report.windows[0].threads[0];
    expect(thread.inclusive).toHaveLength(20);
    expect(thread.inclusive.some(frame => frame.name === 'game')).toBe(false);
    expect(thread.projectInclusive).toEqual([expect.objectContaining({ name: 'game', ms: 40, percent: 40 })]);
    expect(thread.projectSelf).toEqual(thread.projectInclusive);
  });
  it('honors cancellation during offline trace processing', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Technical timeout'));
    await expect(analyzeTrace([{ name: 'anything' }], {}, [], undefined, controller.signal)).rejects.toThrow('Technical timeout');
  });
});


it('validates load mode and excludes throttled evidence from all aggregates', async () => {
  const { rafEvidence, summarizeLoadSamples, LOAD_VIEWPORT } = await import('../scripts/performance/load.mjs');
  expect(parsePerformanceOptions(['--load'])).toMatchObject({ load: true, runs: 5, network: 'local', headless: false });
  expect(parsePerformanceOptions(['--runs', '2', '--load', '--network', '50mbps', '--headless', 'on'])).toMatchObject({ runs: 2, network: '50mbps', headless: true });
  for (const args of [['--runs','5'],['--load','--runs','0'],['--load','--case','weapon.glock'],['--load','--network','bad']]) expect(() => parsePerformanceOptions(args)).toThrow();
  const probe = { viewport: { ...LOAD_VIEWPORT, dpr: 1 }, hidden: [], truncated: false, times: [0,16,32,48,64] };
  expect(rafEvidence(probe,0,64).errors).toEqual([]);
  expect(rafEvidence({ ...probe, times: [0,1000,2000,3000,4000] },0,4000).errors).toContain('Median rAF below 20 fps: throttled or overloaded');
  expect(rafEvidence({ ...probe, hidden: [{ hidden: true }], truncated: true },0,64).errors).toHaveLength(2);
  const good = { iteration: 1, phase: 'cold-lobby', valid: true, bootRevealMs: 100, worldReadyMs: 40,
    resources: { groups: [{ group: 'sprites', transferBytes: 42, encodedBytes: 40, requests: 1, wallSpanMs: 5 }] },
    raf: { medianFps: 60 }, lastFulfilled: ['world:render'], sections: [{ scope: 'world', name: 'bake', kind: 'cpu-submit', totalMs: 3 }] };
  const results = summarizeLoadSamples([good, { ...good, iteration: 2, bootRevealMs: 200 }, { ...good, valid: false, bootRevealMs: 50_000 }]);
  expect(results[0]).toMatchObject({ valid: 2, invalid: 1, bootRevealMs: { median: 100, p95: 200 } });
  expect(results[0].downloads[0].transferBytes.count).toBe(2);
  expect(results[0].topSections[0].durationMs.count).toBe(2);
  expect(summarizeLoadSamples([{ ...good, valid: false }])[0].bootRevealMs).toBeNull();
});
