import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('waits for the runner start command even when audio is already running, and cleans up on focus loss', async () => {
  vi.resetModules();
  const win = Object.assign(new EventTarget(), { __FD_PERF_REQUEST__: {
    schemaVersion: 1, runId: 'test', caseId: 'weapon.glock', timeoutMs: 10_000, captureProfile: 'standard',
  } }) as any;
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hasFocus: () => true, hidden: false }));
  vi.stubGlobal('innerWidth', 1920); vi.stubGlobal('innerHeight', 1080); vi.stubGlobal('devicePixelRatio', 1);
  vi.spyOn(performance, 'now').mockReturnValue(100);
  const boot = await import('../src/debug/performanceLab/boot');
  const stop = vi.fn(), factory = vi.fn();
  boot.beginPerformanceBoot();
  boot.startPerformanceCapture({ startScenarioRecording: vi.fn(), stopScenarioRecording: stop } as any);
  boot.attachPerformanceLab(factory, () => 'running');
  boot.performanceLobbyRevealed();
  boot.updatePerformanceLab();
  expect(win.__FD_PERF__.state).toBe('awaiting-audio');
  expect(factory).not.toHaveBeenCalled();
  win.__FD_PERF__.start();
  boot.updatePerformanceLab();
  expect(win.__FD_PERF__.state).toBe('lobby');
  win.dispatchEvent(new Event('blur'));
  expect(win.__FD_PERF__.state).toBe('failed');
  expect(stop).toHaveBeenCalledOnce();
  win.dispatchEvent(new Event('blur'));
  expect(stop).toHaveBeenCalledOnce();
});


it('loads real maps through the host port without fixtures or full frame recording', async () => {
  vi.resetModules();
  vi.doMock('../src/debug/performanceLab/loadouts', () => ({ buildPerformanceLoadout: () => ({ commit: { weapon1: 'GLOCK' } }) }));
  const win = { __FD_PERF_REQUEST__: { schemaVersion: 1, runId: 'load', caseId: 'standard', timeoutMs: 10_000, captureProfile: 'reduced', load: true } } as any;
  vi.stubGlobal('window', win);
  vi.spyOn(performance, 'now').mockReturnValue(100);
  const boot = await import('../src/debug/performanceLab/boot');
  const recording = vi.fn(), discard = vi.fn(), start = vi.fn();
  const port = { isLobbyReady: vi.fn(() => true), isReady: () => false, start, discard,
    readLoadingState: () => ({ worldId: 'world:lobby', revealReady: true }), prepareCase: vi.fn() };
  const factory = vi.fn(async () => port as any);
  boot.beginPerformanceBoot();
  boot.startPerformanceCapture({ startScenarioRecording: recording } as any);
  boot.attachPerformanceLab(factory, () => 'running');
  await expect(win.__FD_PERF__.prepareLoad()).rejects.toThrow('revealed lobby');
  boot.performanceLobbyRevealed();
  await win.__FD_PERF__.prepareLoad();
  boot.updatePerformanceLab();
  expect(recording).not.toHaveBeenCalled();
  expect(factory).toHaveBeenCalledOnce();
  expect(port.prepareCase).not.toHaveBeenCalled();
  expect(win.__FD_PERF__.load.status().worldId).toBe('world:lobby');
  expect(() => win.__FD_PERF__.load.start('unknown')).toThrow('Unsupported');
  win.__FD_PERF__.load.start('7');
  expect(start).toHaveBeenCalledWith('7', expect.any(Number), { weapon1: 'GLOCK' });
  win.__FD_PERF__.load.lobby();
  expect(discard).toHaveBeenCalledOnce();
  port.isLobbyReady.mockReturnValue(false);
  expect(() => win.__FD_PERF__.load.start('1')).toThrow('ready lobby');
  boot.failPerformanceLab('stop');
  boot.failPerformanceLab('stop again');
  expect(discard).toHaveBeenCalledTimes(2);
  vi.doUnmock('../src/debug/performanceLab/loadouts');
});


it('runs cold/warm pairs and real map switches in one context, saving evidence before reload', async () => {
  const { runLoadMeasurements, LOAD_NETWORKS } = await import('../scripts/performance/load.mjs');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'fd-load-runner-'));
  let now = 1000, world = 'world:lobby', started = 20;
  const commands: string[] = [];
  const timeline = () => ({ runs: [{ scope: 'world', id: world, startedAt: started, durationMs: 400,
    outcome: world === 'world:lobby' ? 'revealed' : 'ready', topSections: [], resources: { groups: [] },
    criticalPath: { lastFulfilled: 'render' } }], resources: { groups: [] } });
  const win: any = { __FD_BOOT__: { timeline }, __FD_LOAD_PROBE__: {
    read: (from: number, to: number) => ({ times: Array.from({ length: Math.floor((to-from)/16) }, (_,i) => from+i*16),
      hidden: [], truncated: false, viewport: { width: 1664, height: 936, dpr: 1 } }),
  } };
  const reset = () => { now = 1000; world = 'world:lobby'; started = 20; win.__FD_PERF__ = {
    state: 'awaiting-audio', audioState: () => 'running', prepareLoad: async () => {},
    load: { start: (map: string) => { commands.push(map); world = 'world:coop-defense:'+map; started = now+10; now += 600; },
      lobby: () => { world = 'world:lobby'; started = now+10; now += 600; }, status: () => ({ worldId: world, revealReady: true, ready: world !== 'world:lobby', lobbyReady: world === 'world:lobby' }) },
  }; };
  vi.stubGlobal('window', win); vi.stubGlobal('history', { replaceState: vi.fn() });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(performance, 'getEntriesByType').mockImplementation(type => type === 'mark' ? [{ name: 'FD:lab:test:lobby-revealed', startTime: 900 } as any] : []);
  const cdp = { send: vi.fn(async () => ({})), detach: vi.fn(async () => {}) };
  const context = { newCDPSession: async () => cdp, addInitScript: vi.fn(async () => {}) };
  const page = { goto: vi.fn(async () => reset()), reload: vi.fn(async () => reset()), bringToFront: async () => {},
    evaluate: async (fn: Function, arg: unknown) => fn(arg), mouse: { click: async () => {} } };
  try {
    const result = await runLoadMeasurements({ page, context, url: 'http://127.0.0.1:1234/', directory,
      request: { runs: 2, network: '50mbps', timeoutMs: 10000 }, signal: new AbortController().signal });
    expect(result.samples).toHaveLength(16);
    expect(result.samples.filter((s: any) => s.phase.endsWith('-to-lobby'))).toHaveLength(6);
    expect(result.samples.every((s: any) => s.valid)).toBe(true);
    expect(commands).toEqual(['1','7','15','1','7','15']);
    expect(page.reload).toHaveBeenCalledTimes(2);
    expect(cdp.send.mock.calls.filter(([name]) => name === 'Network.clearBrowserCache')).toHaveLength(2);
    expect(cdp.send).toHaveBeenCalledWith('Network.emulateNetworkConditions', LOAD_NETWORKS['50mbps']);
    expect(cdp.detach).toHaveBeenCalledOnce();
    const cold = JSON.parse(await readFile(join(directory,'load-01-cold-lobby.json'),'utf8'));
    expect(cold.timeline.runs[0].id).toBe('world:lobby');
    expect(await readFile(join(directory,'load-summary.md'),'utf8')).toContain('2 / 2');
    page.goto.mockRejectedValueOnce(new Error('navigation failed'));
    await expect(runLoadMeasurements({ page, context, url: 'http://127.0.0.1:1234/', directory,
      request: { runs: 1, network: 'local', timeoutMs: 10000 }, signal: new AbortController().signal })).rejects.toThrow('navigation failed');
    expect(cdp.detach).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await readFile(join(directory,'load-failed-timeline.json'),'utf8')).timeline).toBeDefined();
  } finally {
    expect(directory.startsWith(join(tmpdir(), 'fd-load-runner-'))).toBe(true);
    await rm(directory, { recursive: true, force: true });
  }
});
