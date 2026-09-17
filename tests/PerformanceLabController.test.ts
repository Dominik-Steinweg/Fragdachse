import { afterEach, describe, expect, it, vi } from 'vitest';
const unregister = vi.hoisted(() => vi.fn());
vi.mock('../src/debug/performanceLab/scenarios', () => ({
  PERFORMANCE_MAP_ID: 'test', REFERENCE_SEED: 1, SCENARIO_VERSION: 'test',
  registerReferenceMap: () => unregister,
  resolvePerformanceCases: (id: string) => id === 'recovery-pair' ? ['combat', 'recovery'].map(kind => ({
    id: `${kind}.test`, kind, version: 1, durationMs: 10, tailMs: 1, actionIntervalMs: 400,
    minimumActions: 0, maximumActions: 0, slot: 'weapon1', commit: {}, requireHits: false,
  })) : [{ id: 'weapon.glock', version: 1, durationMs: 1000, tailMs: 100,
    actionIntervalMs: 400, minimumActions: 3, slot: 'weapon1', commit: {} }],
}));
import { PerformanceLabController } from '../src/debug/performanceLab/PerformanceLabController';
import type { PerformanceLabGamePort } from '../src/debug/performanceLab/contracts';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('Performance scenario lifecycle', () => {
  function fixture(caseId = 'weapon.glock') {
    vi.stubGlobal('window', {});
    let hit: () => void = () => {};
    const unsubscribe = vi.fn(), complete = vi.fn(), windows: any[] = [];
    const port = { start: vi.fn(), isReady: () => true, isLobbyReady: () => true,
      prepareTargets: vi.fn(), maintainTargets: vi.fn(), attack: vi.fn(() => { hit(); return { ok: true }; }),
      observeHits: (f: () => void) => { hit = f; return unsubscribe; }, readLoad: () => ({ enemies: 3 }),
      discard: vi.fn(), environment: () => ({}), stopRecording: vi.fn(() => ({ frameCapture: {}, session: {}, series: {} })),
    } as unknown as PerformanceLabGamePort;
    const controller = new PerformanceLabController({ schemaVersion: 1, runId: 'r', caseId, timeoutMs: 10_000, captureProfile: 'standard' },
      port, windows, [], () => 0, complete);
    return { controller, port, unsubscribe, complete, windows };
  }
  it('extends delayed actions without catch-up bursts and includes tail and lobby return', () => {
    const f = fixture();
    f.controller.update(0); f.controller.update(1200);
    expect(f.port.attack).toHaveBeenCalledTimes(2);
    expect(f.port.discard).not.toHaveBeenCalled();
    f.controller.update(1600); f.controller.update(1700); f.controller.update(1800); f.controller.update(4800);
    expect(f.windows.find(w => w.id === 'weapon.glock').toMs).toBe(1600);
    expect(f.complete).toHaveBeenCalledOnce();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
  });
  it('cleans up a cancelled run exactly once', () => {
    const f = fixture(); f.controller.update(0);
    f.controller.cancel('test'); f.controller.cancel('test');
    expect(f.port.discard).toHaveBeenCalledOnce();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
    expect(f.complete).not.toHaveBeenCalled();
  });
  it('rolls back a partially failed start and unregisters the diagnostic map', () => {
    const discard = vi.fn();
    const port = { start: () => { throw new Error('world start failed'); }, discard } as unknown as PerformanceLabGamePort;
    expect(() => new PerformanceLabController({ schemaVersion: 1, runId: 'r', caseId: 'weapon.glock',
      timeoutMs: 10_000, captureProfile: 'standard' }, port, [], [], () => 0, vi.fn())).toThrow('world start failed');
    expect(discard).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
  });
  it('waits for productive asynchronous preparation before observing or acting', () => {
    const f = fixture();
    f.port.prepareCase = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true);
    f.controller.update(0); f.controller.update(20);
    expect(f.port.attack).not.toHaveBeenCalled();
    expect(f.windows.filter(w => w.kind === 'measurement')).toHaveLength(0);
    f.controller.update(40);
    expect(f.port.attack).toHaveBeenCalledOnce();
    expect(f.windows[0].kind).toBe('preparation');
    f.controller.cancel('test');
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
  it('retains the combat world for its connected recovery and tears it down once', () => {
    const f = fixture('recovery-pair');
    for (const at of [0, 10, 11, 12, 13, 14, 3014, 6014]) f.controller.update(at);
    expect(f.port.start).toHaveBeenCalledOnce();
    expect(f.port.discard).toHaveBeenCalledOnce();
    expect(f.unsubscribe).toHaveBeenCalledTimes(2);
    expect(f.complete).toHaveBeenCalledOnce();
    expect(f.windows.filter(w => w.kind === 'measurement').map(w => w.id)).toEqual(['combat.test', 'recovery.test']);
  });
  it('extends the active window until required scenario work has actually completed', () => {
    const f = fixture();
    f.port.isCaseComplete = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    for (const at of [0, 400, 800, 1000]) f.controller.update(at);
    expect(f.windows.some(w => w.id === 'weapon.glock')).toBe(false);
    f.controller.update(1100);
    expect(f.windows.find(w => w.id === 'weapon.glock').toMs).toBe(1100);
    f.controller.cancel('test');
  });
  it('rejects requested attacks without observed mechanics and still allows complete cleanup', () => {
    const f = fixture();
    vi.mocked(f.port.attack).mockReturnValue({ ok: true });
    f.controller.update(0); f.controller.update(500);
    f.controller.update(1000);
    expect(() => f.controller.update(1100)).toThrow('no actual hits');
    f.controller.cancel('mechanic failure');
    expect(f.port.discard).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
    expect(f.complete).not.toHaveBeenCalled();
  });
});
