import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRAPHICS_QUALITY_PROFILES,
  GraphicsQualityController,
  isGraphicsQuality,
} from '../src/graphics/GraphicsQuality';
import { getStoredGraphicsQuality, setStoredGraphicsQuality } from '../src/utils/localPreferences';
import { ArenaRuntimeProfiler, type ArenaRuntimeSample } from '../src/scenes/arena/ArenaRuntimeProfiler';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function sample(overrides: Partial<ArenaRuntimeSample> = {}): ArenaRuntimeSample {
  return {
    role: 'host',
    quality: 'medium',
    mode: 'coop_defense',
    mapId: 'test-map',
    deltaMs: 16,
    updateMs: 7,
    renderSubmitMs: 3,
    roleStepMs: 4,
    networkUpdateMs: 0.5,
    networkFlushMs: 0.25,
    visualStepMs: 2,
    visualCameraMs: 0.4,
    visualEnemyMs: 0.6,
    visualEffectsMs: 0.5,
    visualAimMs: 0.3,
    visualHudMs: 0.2,
    shadowStepMs: 0.5,
    lightingStepMs: 0.75,
    fireSimulationMs: 0.2,
    fireCreationMs: 0.1,
    fireVisualMs: 0.3,
    enemyCount: 20,
    projectileCount: 10,
    playerCount: 2,
    displayObjectCount: 100,
    visibleObjectCount: 80,
    particleEmitterCount: 4,
    aliveParticleCount: 30,
    activeFilterCount: 3,
    activeLightCount: 12,
    renderedLightCount: 10,
    drawCallCount: 0,
    ...overrides,
  };
}

/** Minimaler GL-Kontext: die Zeichenmethoden liegen wie im Browser auf dem Prototyp. */
class FakeGlContext {
  drawnVertices = 0;
  drawArrays(count: number): void { this.drawnVertices += count; }
  drawElements(count: number): void { this.drawnVertices += count; }
}

function fakeGame(gl: unknown): { events: { on: (e: string, l: () => void) => void; off: () => void }; renderer: { gl: unknown }; emit: (event: string) => void } {
  const listeners = new Map<string, (() => void)[]>();
  return {
    events: {
      on: (event: string, listener: () => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      off: () => undefined,
    },
    renderer: { gl },
    emit: (event: string) => (listeners.get(event) ?? []).forEach((listener) => listener()),
  };
}

describe('graphics quality preferences and profiles', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('migrates an older preference payload to high quality and persists changes', () => {
    storage.setItem('fragdachse_local_preferences', JSON.stringify({ version: 12, audio: {} }));

    expect(getStoredGraphicsQuality()).toBe('high');
    setStoredGraphicsQuality('low');
    expect(getStoredGraphicsQuality()).toBe('low');
  });

  it('defines progressively smaller visual budgets without changing gameplay state', () => {
    expect(isGraphicsQuality('medium')).toBe(true);
    expect(isGraphicsQuality('ultra')).toBe(false);
    expect(GRAPHICS_QUALITY_PROFILES.low.maxLightsPerFrame)
      .toBeLessThan(GRAPHICS_QUALITY_PROFILES.medium.maxLightsPerFrame);
    expect(GRAPHICS_QUALITY_PROFILES.medium.maxLightsPerFrame)
      .toBeLessThan(GRAPHICS_QUALITY_PROFILES.high.maxLightsPerFrame);

    const controller = new GraphicsQualityController('high');
    controller.setLevel('low');
    expect(controller.scaleParticleCount(10, 'critical')).toBe(6);
    expect(controller.scaleParticleCount(10, 'standard')).toBe(4);
    expect(controller.scaleParticleCount(10, 'decorative')).toBe(0);
  });
});

describe('ArenaRuntimeProfiler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('records host and rendering costs separately and exports quality changes', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('PerformanceObserver', undefined);
    const profiler = new ArenaRuntimeProfiler();

    profiler.startRecording({ renderer: 'webgl' });
    profiler.record(sample());
    now = 200;
    profiler.record(sample({ deltaMs: 34, updateMs: 11, renderSubmitMs: 5, roleStepMs: 8 }));
    profiler.recordQualityChange('medium', 'low');
    now = 300;
    profiler.stopRecording();

    const report = profiler.buildReport();
    expect(report?.schemaVersion).toBe(2);
    expect(report?.environment).toEqual({ renderer: 'webgl' });
    expect(report?.qualityChanges).toEqual([{ atMs: 100, from: 'medium', to: 'low' }]);
    expect(report?.windows).toHaveLength(1);
    expect(report?.windows[0].role).toBe('host');
    expect(report?.windows[0].timings.roleStepMs.avg).toBe(6);
    expect(report?.windows[0].timings.renderSubmitMs.avg).toBe(4);
    expect(report?.windows[0].over33msPercent).toBe(50);
  });

  it('keeps the environment of the recording instead of the export moment', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('PerformanceObserver', undefined);
    const profiler = new ArenaRuntimeProfiler();

    profiler.startRecording({ deviceMemoryGb: 32 });
    profiler.record(sample({ quality: 'high' }));
    now = 200;
    profiler.stopRecording();

    // Zwei Exporte derselben Messung muessen identische Kopfdaten liefern, auch wenn die
    // Grafikqualitaet zwischendurch umgestellt wurde.
    const first = profiler.buildReport();
    const second = profiler.buildReport();
    expect(second?.recordingId).toBe(first?.recordingId);
    expect(second?.environment).toEqual({ deviceMemoryGb: 32 });
    expect(second?.recordingScope.qualities).toEqual(['high']);
    expect(second?.recordingStartedAt).toBe(first?.recordingStartedAt);

    profiler.startRecording({ deviceMemoryGb: 8 });
    profiler.record(sample({ quality: 'low' }));
    now = 300;
    profiler.stopRecording();

    const third = profiler.buildReport();
    expect(third?.recordingId).toBe((first?.recordingId ?? 0) + 1);
    expect(third?.environment).toEqual({ deviceMemoryGb: 8 });
    expect(third?.recordingScope.qualities).toEqual(['low']);
  });

  it('reports unaccounted time and flags windows with sampling gaps', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('PerformanceObserver', undefined);
    const profiler = new ArenaRuntimeProfiler();

    profiler.startRecording();
    for (let index = 0; index < 10; index += 1) {
      now = index * 20;
      profiler.record(sample({ deltaMs: 20, updateMs: 8, renderSubmitMs: 9 }));
    }
    // Sampling bricht ab, das Fenster laeuft aber noch eine Sekunde Wallclock weiter.
    now = 1180;
    profiler.stopRecording();

    const window = profiler.buildReport()?.windows[0];
    // 8 - (4 roleStep + 0.5 netUpdate + 0.25 netFlush + 2 visual + 0.5 shadow + 0.75 lighting)
    expect(window?.timings.unaccountedUpdateMs.avg).toBeCloseTo(0, 5);
    expect(window?.timings.unaccountedFrameMs.avg).toBeCloseTo(3, 5);
    expect(window?.sampleCount).toBe(10);
    // 10 Samples auf 1180 ms bei 20 ms Frame-Zeit: knapp ein Sechstel des Fensters.
    expect(window?.coveragePercent).toBeCloseTo(1000 / 59, 5);
    expect(window?.maxSampleGapMs).toBe(1000);
    expect(window?.fps).toBe(50);
  });

  it('counts draw calls per frame and leaves the gl context clean afterwards', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('PerformanceObserver', undefined);
    const gl = new FakeGlContext();
    const game = fakeGame(gl);
    const profiler = new ArenaRuntimeProfiler();
    profiler.attachGame(game as never);

    // Ohne Aufzeichnung und ohne offene Diagnose bleibt der Kontext unberuehrt.
    expect(profiler.isCountingDrawCalls()).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(gl, 'drawArrays')).toBe(false);

    profiler.startRecording();
    expect(profiler.isCountingDrawCalls()).toBe(true);

    game.emit('prerender');
    gl.drawArrays(6);
    gl.drawElements(6);
    gl.drawArrays(6);
    game.emit('postrender');
    expect(profiler.takeLastDrawCallCount()).toBe(3);
    // Die Originalmethoden laufen weiter, der Wrapper darf nichts verschlucken.
    expect(gl.drawnVertices).toBe(18);

    // Der naechste Frame zaehlt wieder bei null los.
    game.emit('prerender');
    gl.drawArrays(6);
    game.emit('postrender');
    expect(profiler.takeLastDrawCallCount()).toBe(1);

    now = 100;
    profiler.record(sample({ drawCallCount: profiler.takeLastDrawCallCount() }));
    now = 200;
    profiler.stopRecording();

    expect(profiler.buildReport()?.windows[0].counts.drawCallCount.avg).toBe(1);
    expect(profiler.isCountingDrawCalls()).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(gl, 'drawArrays')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(gl, 'drawElements')).toBe(false);
  });

  it('keeps counting draw calls while the live view is open without a recording', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => 0);
    vi.stubGlobal('PerformanceObserver', undefined);
    const gl = new FakeGlContext();
    const game = fakeGame(gl);
    const profiler = new ArenaRuntimeProfiler();
    profiler.attachGame(game as never);

    profiler.setLiveDrawCallTracking(true);
    profiler.startRecording();
    profiler.stopRecording();
    // Die Aufzeichnung endet, die offene Diagnose haelt die Zaehlung aber weiter aktiv.
    expect(profiler.isCountingDrawCalls()).toBe(true);

    profiler.setLiveDrawCallTracking(false);
    expect(profiler.isCountingDrawCalls()).toBe(false);

    profiler.destroy();
    expect(Object.prototype.hasOwnProperty.call(gl, 'drawArrays')).toBe(false);
  });

  it('splits the visual step into per-subsystem buckets', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('PerformanceObserver', undefined);
    const profiler = new ArenaRuntimeProfiler();

    profiler.startRecording();
    profiler.record(sample({ visualStepMs: 6, visualEffectsMs: 4 }));
    now = 200;
    profiler.stopRecording();

    const timings = profiler.buildReport()?.windows[0].timings;
    expect(timings?.visualEffectsMs.avg).toBe(4);
    expect(timings?.visualCameraMs.avg).toBe(0.4);
    expect(timings?.visualEnemyMs.avg).toBe(0.6);
    expect(timings?.visualAimMs.avg).toBe(0.3);
    expect(timings?.visualHudMs.avg).toBe(0.2);
  });

  it('closes the current window when role or quality changes', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('PerformanceObserver', undefined);
    const profiler = new ArenaRuntimeProfiler();

    profiler.startRecording();
    profiler.record(sample());
    now = 150;
    profiler.record(sample({ role: 'client', quality: 'low', roleStepMs: 1 }));
    now = 200;
    profiler.stopRecording();

    expect(profiler.buildReport()?.windows.map((window) => [window.role, window.quality]))
      .toEqual([['host', 'medium'], ['client', 'low']]);
  });
});
