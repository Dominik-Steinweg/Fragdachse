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
