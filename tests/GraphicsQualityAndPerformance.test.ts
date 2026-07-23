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
    phase: 'arena',
    quality: 'medium',
    mode: 'coop_defense',
    mapId: 'test-map',
    rawDeltaMs: 16,
    deltaMs: 16,
    updateMs: 7,
    gameStepMs: 12,
    phaserSceneUpdateMs: 8,
    phaserSceneSystemsMs: 1,
    rendererSetupMs: 1,
    betweenFramesMs: 4,
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
  framebufferBinds = 0;
  textureUploads = 0;
  drawArrays(count: number): void { this.drawnVertices += count; }
  drawElements(count: number): void { this.drawnVertices += count; }
  bindFramebuffer(): void { this.framebufferBinds += 1; }
  useProgram(_program?: unknown): void {}
  texImage2D(..._args: unknown[]): void { this.textureUploads += 1; }
  bufferData(): void {}
}

class FakePerformanceObserver {
  static readonly supportedEntryTypes = ['longtask', 'long-animation-frame', 'event', 'gc'];
  static readonly instances: FakePerformanceObserver[] = [];
  observedType = '';

  constructor(private readonly callback: (list: { getEntries: () => PerformanceEntry[] }) => void) {
    FakePerformanceObserver.instances.push(this);
  }

  observe(options: { entryTypes?: string[]; type?: string }): void {
    this.observedType = options.entryTypes?.[0] ?? options.type ?? '';
  }

  disconnect(): void {}

  emit(entries: PerformanceEntry[]): void {
    this.callback({ getEntries: () => entries });
  }
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
    profiler.record(sample({ rawDeltaMs: 34, deltaMs: 34, updateMs: 11, renderSubmitMs: 5, roleStepMs: 8 }));
    profiler.recordQualityChange('medium', 'low');
    now = 300;
    profiler.stopRecording();

    const report = profiler.buildReport();
    expect(report?.schemaVersion).toBe(4);
    expect(report?.environment).toEqual({ renderer: 'webgl' });
    expect(report?.longAnimationFrames).toEqual([]);
    expect(report?.eventTimings).toEqual([]);
    expect(report?.instrumentation.observability.longAnimationFrames).toBe('unavailable');
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
      profiler.record(sample({
        rawDeltaMs: 20,
        deltaMs: 20,
        updateMs: 8,
        gameStepMs: 21,
        phaserSceneUpdateMs: 8,
        rendererSetupMs: 1,
        renderSubmitMs: 9,
      }));
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
    gl.bindFramebuffer();
    gl.useProgram({});
    gl.texImage2D(0, 0, 0, 64, 32);
    gl.bufferData();
    game.emit('postrender');
    expect(profiler.takeLastDrawCallCount()).toBe(1);

    now = 100;
    profiler.record(sample({ drawCallCount: profiler.takeLastDrawCallCount() }));
    now = 200;
    profiler.stopRecording();

    expect(profiler.buildReport()?.windows[0].counts.drawCallCount.avg).toBe(1);
    const detailCounts = profiler.buildReport()?.windows[0].detailCounts;
    expect(detailCounts?.framebufferBindCount.avg).toBe(1);
    expect(detailCounts?.programSwitchCount.avg).toBe(1);
    expect(detailCounts?.textureUploadCount.avg).toBe(1);
    expect(detailCounts?.textureUploadPixels.avg).toBe(64 * 32);
    expect(detailCounts?.bufferUploadCount.avg).toBe(1);
    expect(profiler.isCountingDrawCalls()).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(gl, 'drawArrays')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(gl, 'drawElements')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(gl, 'bindFramebuffer')).toBe(false);
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

  it('separates Phaser scene systems, renderer setup and between-frame time', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('PerformanceObserver', undefined);
    const game = fakeGame(null);
    const profiler = new ArenaRuntimeProfiler();
    profiler.attachGame(game as never);

    now = 1;
    game.emit('prestep');
    now = 2;
    game.emit('step');
    // Der Scene-Update-Wert wird waehrend des laufenden Frames vorgemerkt.
    profiler.takeLastFrameLifecycleMetrics(5);
    now = 9;
    game.emit('poststep');
    now = 10;
    game.emit('prerender');
    now = 14;
    game.emit('postrender');

    const first = profiler.takeLastFrameLifecycleMetrics(6);
    expect(first.gameStepMs).toBe(13);
    expect(first.sceneManagerUpdateMs).toBe(7);
    expect(first.sceneSystemsAndPluginsMs).toBe(2);
    expect(first.rendererSetupMs).toBe(1);
    expect(first.betweenFramesMs).toBe(0);

    now = 20;
    game.emit('prestep');
    now = 21;
    game.emit('step');
    now = 27;
    game.emit('poststep');
    now = 29;
    game.emit('prerender');
    now = 32;
    game.emit('postrender');

    const second = profiler.takeLastFrameLifecycleMetrics(4);
    expect(second.gameStepMs).toBe(12);
    expect(second.sceneManagerUpdateMs).toBe(6);
    expect(second.sceneSystemsAndPluginsMs).toBe(0);
    expect(second.rendererSetupMs).toBe(2);
    expect(second.betweenFramesMs).toBe(6);
    profiler.destroy();
  });

  it('exports browser long-animation-frame and event attribution when supported', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    FakePerformanceObserver.instances.length = 0;
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);
    const profiler = new ArenaRuntimeProfiler();

    profiler.startRecording();
    profiler.record(sample());

    const loafObserver = FakePerformanceObserver.instances.find(observer => observer.observedType === 'long-animation-frame');
    loafObserver?.emit([{
      name: 'long-animation-frame',
      entryType: 'long-animation-frame',
      startTime: 110,
      duration: 70,
      blockingDuration: 22,
      renderStart: 150,
      styleAndLayoutStart: 160,
      firstUIEventTimestamp: 0,
      scripts: [{
        duration: 45,
        executionStart: 112,
        forcedStyleAndLayoutDuration: 6,
        pauseDuration: 2,
        invoker: 'requestAnimationFrame',
        invokerType: 'user-callback',
        sourceURL: 'https://example.test/assets/index-abc.js?room=secret',
        sourceFunctionName: 'step',
      }],
      toJSON: () => ({}),
    } as PerformanceEntry]);

    const eventObserver = FakePerformanceObserver.instances.find(observer => observer.observedType === 'event');
    eventObserver?.emit([{
      name: 'pointerdown',
      entryType: 'event',
      startTime: 120,
      duration: 32,
      processingStart: 124,
      processingEnd: 140,
      interactionId: 7,
      toJSON: () => ({}),
    } as PerformanceEntry]);

    now = 200;
    profiler.stopRecording();
    const report = profiler.buildReport();
    expect(report?.instrumentation.observability.longAnimationFrames).toBe('supported');
    expect(report?.longAnimationFrames[0].blockingDurationMs).toBe(22);
    expect(report?.longAnimationFrames[0].scripts[0].source).toBe('assets/index-abc.js');
    expect(report?.eventTimings[0]).toMatchObject({
      name: 'pointerdown',
      inputDelayMs: 4,
      processingMs: 16,
      presentationDelayMs: 12,
      interactionId: 7,
    });
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

  it('uses raw frame deltas and keeps the smoothed Phaser FPS separate', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('PerformanceObserver', undefined);
    const profiler = new ArenaRuntimeProfiler();

    profiler.startRecording();
    profiler.record(sample({ rawDeltaMs: 40, deltaMs: 20 }));
    now = 140;
    profiler.record(sample({ rawDeltaMs: 60, deltaMs: 20 }));
    now = 200;
    profiler.stopRecording();

    const window = profiler.buildReport()?.windows[0];
    expect(window?.fps).toBe(20);
    expect(window?.smoothedFps).toBe(50);
    expect(window?.timings.rawDeltaMs.p95).toBe(60);
    expect(window?.over33msPercent).toBe(100);
  });

  it('exports phase-separated raw frames, context changes and fine-grained details', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('PerformanceObserver', undefined);
    const profiler = new ArenaRuntimeProfiler();
    const context = {
      localAlive: true,
      aimVisible: true,
      scopeActive: false,
      utilityPlacementActive: false,
      ultimatePlacementActive: false,
      optionsOpen: false,
      pageVisible: true,
      documentFocused: true,
      roundElapsedMs: null,
      weapon1Id: 'GLOCK',
      weapon2Id: 'AWP',
      utilityId: 'HE_GRENADE',
      ultimateId: 'HONEY_BADGER_RAGE',
    };

    profiler.startRecording();
    profiler.record(sample({
      phase: 'lobby',
      context,
      details: {
        timings: { scopeUploadMs: 1.5, lightingShadowGeometryMs: 0.75 },
        counts: { scopeRefreshCount: 1, lightShadowQuadCount: 12 },
      },
      lightPresetCounts: { muzzleFlash: 2 },
      filterBreakdown: 'GlowFilter:2',
    }));
    now = 120;
    profiler.record(sample({ phase: 'arena', context: { ...context, roundElapsedMs: 20 } }));
    now = 140;
    profiler.stopRecording();

    const report = profiler.buildReport();
    expect(report?.recordingScope.phases).toEqual(['lobby', 'arena']);
    expect(report?.windows.map((window) => window.phase)).toEqual(['lobby', 'arena']);
    expect(report?.windows[0].detailTimings.scopeUploadMs.avg).toBe(1.5);
    expect(report?.windows[0].detailCounts.lightShadowQuadCount.peak).toBe(12);
    expect(report?.windows[0].lightingPresets.muzzleFlash.peak).toBe(2);
    expect(report?.windows[0].filterBreakdown).toBe('GlowFilter:2');
    expect(report?.contextChanges).toHaveLength(2);
    expect(report?.frameSeries.rows).toHaveLength(2);
    expect(report?.frameSeries.columns).toContain('detail.scopeUploadMs');
    expect(report?.frameSeries.columns).toContain('context.scopeActive');
  });
});
