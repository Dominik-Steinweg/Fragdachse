import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRAPHICS_QUALITY_PROFILES,
  GraphicsQualityController,
  isGraphicsQuality,
} from '../src/graphics/GraphicsQuality';
import {
  getStoredGraphicsQuality,
  setStoredGraphicsQuality,
} from '../src/utils/localPreferences';
import { ArenaRuntimeProfiler, type ArenaRuntimeSample } from '../src/scenes/arena/ArenaRuntimeProfiler';
import { ABLATION_CODES, ABLATION_LABELS } from '../src/scenes/arena/PerformanceAblation';

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
  deletedQueries = 0;
  private nextQueryId = 0;
  readonly VERSION = 0x1f02;

  constructor(private readonly version = 'WebGL 2.0 (test)') {}

  drawArrays(count: number): void { this.drawnVertices += count; }
  drawElements(count: number): void { this.drawnVertices += count; }
  bindFramebuffer(): void { this.framebufferBinds += 1; }
  useProgram(_program?: unknown): void {}
  texImage2D(..._args: unknown[]): void { this.textureUploads += 1; }
  bufferData(): void {}
  createQuery(): { id: number } { return { id: this.nextQueryId += 1 }; }
  beginQuery(): void {}
  endQuery(): void {}
  getExtension(): { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } {
    return { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  }
  getParameter(parameter: unknown): boolean | string {
    return parameter === this.VERSION ? this.version : false;
  }
  getQueryParameter(_query: unknown, parameter: unknown): boolean | number {
    return parameter === 1 ? true : 1_000_000;
  }
  deleteQuery(): void { this.deletedQueries += 1; }
  readonly QUERY_RESULT_AVAILABLE = 1;
  readonly QUERY_RESULT = 2;
}

class FakeWebGl1Context {
  private nextQueryId = 0;
  readonly VERSION = 0x1f02;
  readonly timerExtension = {
    TIME_ELAPSED_EXT: 1,
    GPU_DISJOINT_EXT: 2,
    QUERY_RESULT_AVAILABLE_EXT: 3,
    QUERY_RESULT_EXT: 4,
    createQueryEXT: () => ({ id: this.nextQueryId += 1 }),
    beginQueryEXT: () => undefined,
    endQueryEXT: () => undefined,
    getQueryObjectEXT: (_query: unknown, parameter: number) => parameter === 3 ? true : 1_000_000,
    deleteQueryEXT: () => undefined,
  };

  getParameter(parameter: unknown): boolean | string {
    return parameter === this.VERSION ? 'WebGL 1.0 (test)' : false;
  }

  getExtension(name: string): typeof this.timerExtension | null {
    return name === 'EXT_disjoint_timer_query' ? this.timerExtension : null;
  }
}

class FakePerformanceObserver {
  static readonly supportedEntryTypes = ['longtask', 'long-animation-frame', 'event', 'gc'];
  static readonly instances: FakePerformanceObserver[] = [];
  observedType = '';
  disconnected = false;

  constructor(private readonly callback: (list: { getEntries: () => PerformanceEntry[] }) => void) {
    FakePerformanceObserver.instances.push(this);
  }

  observe(options: { entryTypes?: string[]; type?: string }): void {
    this.observedType = options.entryTypes?.[0] ?? options.type ?? '';
  }

  disconnect(): void { this.disconnected = true; }

  emit(entries: PerformanceEntry[]): void {
    this.callback({ getEntries: () => entries });
  }
}

function fakeGame(gl: unknown): {
  events: {
    on: (event: string, listener: () => void) => void;
    off: (event: string, listener: () => void) => void;
  };
  renderer: { gl: unknown };
  loop: { callback: (time: number, delta: number) => void };
  originalLoopCallback: (time: number, delta: number) => void;
  emit: (event: string) => void;
  listenerCount: (event: string) => number;
} {
  const listeners = new Map<string, (() => void)[]>();
  const originalLoopCallback = vi.fn((_time: number, _delta: number) => undefined);
  return {
    events: {
      on: (event: string, listener: () => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      off: (event: string, listener: () => void) => {
        listeners.set(event, (listeners.get(event) ?? []).filter((candidate) => candidate !== listener));
      },
    },
    renderer: { gl },
    loop: { callback: originalLoopCallback },
    originalLoopCallback,
    emit: (event: string) => (listeners.get(event) ?? []).forEach((listener) => listener()),
    listenerCount: (event: string) => listeners.get(event)?.length ?? 0,
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
    const critical = controller.scaleParticleCount(10, 'critical');
    const standard = controller.scaleParticleCount(10, 'standard');
    const decorative = controller.scaleParticleCount(10, 'decorative');
    expect(critical).toBeGreaterThan(standard);
    expect(standard).toBeGreaterThanOrEqual(decorative);
    expect(decorative).toBeGreaterThanOrEqual(0);
  });

  it('schaltet den persistenten Standardfilter nur über active um', () => {
    const controller = new GraphicsQualityController('high');
    const handle = { active: false };
    controller.trackFilter({}, handle, false, 'standard');

    expect(handle.active).toBe(true);
    controller.setLevel('low');
    expect(handle.active).toBe(false);
    controller.setLevel('medium');
    expect(handle.active).toBe(true);
  });
  it('deaktiviert bei der Filter-Ablation nur Objektfilter', () => {
    const controller = new GraphicsQualityController('high');
    const objectFilter = { active: false };
    const cameraFilter = { active: false };
    controller.trackFilter({}, objectFilter, false, 'standard', 'object');
    controller.trackFilter({}, cameraFilter, false, 'standard', 'camera');

    controller.setAblationFiltersDisabled(true);
    expect(objectFilter.active).toBe(false);
    expect(cameraFilter.active).toBe(true);
  });

  it('entfernt den leeren Phaser-Sort-Callback nur ohne explizite Sortierung', () => {
    const makeEmitter = () => ({
      maxAliveParticles: 0,
      explode: vi.fn(),
      emitParticleAt: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      setFrequency: vi.fn(),
      setSortCallback: vi.fn(),
    });
    const controller = new GraphicsQualityController('high');
    const unsorted = makeEmitter();
    const explicitlySorted = makeEmitter();

    controller.trackEmitter(unsorted as never, {});
    controller.trackEmitter(explicitlySorted as never, { sortProperty: 'y' });

    expect(unsorted.setSortCallback).toHaveBeenCalledOnce();
    expect(explicitlySorted.setSortCallback).not.toHaveBeenCalled();
  });
});

describe('ArenaRuntimeProfiler Companion collector', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('bleibt im normalen Spielbetrieb vollständig inaktiv', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const profiler = new ArenaRuntimeProfiler();

    profiler.record(sample());

    expect(profiler.isDiagnosticsActive()).toBe(false);
    expect(profiler.wantsDetailedSampling()).toBe(false);
    expect(profiler.isCountingDrawCalls()).toBe(false);
    expect(now).not.toHaveBeenCalled();
    expect(profiler.getLatestSummary()).toBeNull();
  });

  it('exposes the latest raw-frame FPS separately in the live summary', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('PerformanceObserver', undefined);
    const profiler = new ArenaRuntimeProfiler();

    profiler.setLiveDiagnosticsEnabled(true);
    profiler.record(sample({ rawDeltaMs: 40, deltaMs: 20 }));
    expect(profiler.getLatestSummary()?.currentFps).toBe(25);
    expect(profiler.getLatestSummary()?.fps).toBe(25);

    now = 600;
    profiler.record(sample({ rawDeltaMs: 60, deltaMs: 20 }));
    expect(profiler.getLatestSummary()?.currentFps).toBeCloseTo(1000 / 60, 10);
    expect(profiler.getLatestSummary()?.fps).toBe(20);
  });

  it('exportiert Session-ID, Environment, Start/Ende und den 5-Sekunden-Sync', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const mark = vi.spyOn(performance, 'mark');
    const profiler = new ArenaRuntimeProfiler();

    profiler.startRecording({ renderer: 'webgl' });
    profiler.record(sample());
    now = 5_100;
    profiler.record(sample());
    now = 5_200;
    profiler.stopRecording();

    const report = profiler.buildReport();
    expect(report?.schemaVersion).toBe(8);
    expect(report?.session.id).toMatch(/^\S+$/);
    expect(report?.session.durationMs).toBe(5_100);
    expect(report?.session.syncMarkerCount).toBe(1);
    expect(report?.environment).toEqual({ renderer: 'webgl' });
    expect(report?.events.find((event) => event.type === 'session_sync')).toMatchObject({
      atMs: 5_000,
      marker: expect.stringMatching(/^FD:session:sync:/),
    });
    expect(mark.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^FD:session:start:/),
      expect.stringMatching(/^FD:session:sync:/),
      expect.stringMatching(/^FD:session:end:/),
    ]));
  });

  it('trennt 4-Hz-Gauges von Intervallwerten und bewahrt CPU-Spikes', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const profiler = new ArenaRuntimeProfiler();

    profiler.startRecording();
    profiler.record(sample({
      rawDeltaMs: 12,
      roleStepMs: 3,
      enemyCount: 4,
      details: { timings: { flowfieldAgeMs: 40 }, counts: { activeVfx: 2 } },
    }));
    now = 200;
    profiler.record(sample({
      rawDeltaMs: 42,
      roleStepMs: 18,
      enemyCount: 8,
      details: {
        timings: { flowfieldAgeMs: 55 },
        counts: {
          newNetworkSnapshotCount: 2,
          snapshotBytes: 1_200,
          flowfieldJobs: 3,
          flowfieldComputeMs: 7,
          dirtyRocks: 4,
          affectedPages: 2,
          sparseUploads: 3,
          fullUploads: 1,
          uploadBytes: 9_000,
          vfxSpawns: 5,
          capacityDrops: 1,
          activeVfx: 6,
        },
      },
    }));
    now = 400;
    profiler.stopRecording();

    const report = profiler.buildReport();
    const series = report?.series.samples.at(-1);
    expect(series?.gauges.enemyCount).toBe(8);
    expect(series?.gauges.flowfieldAgeMs).toBe(55);
    expect(series?.gauges.activeVfx).toBe(6);
    expect(series?.interval).toMatchObject({
      frameCount: 2,
      frameTimeTotalMs: 54,
      frameTimeMaxMs: 42,
      slowFrameCount: 1,
      hostCpuTotalMs: 21,
      hostCpuMaxMs: 18,
      snapshotCount: 2,
      snapshotBytesTotal: 1_200,
      snapshotBytesMax: 1_200,
      flowfieldJobs: 3,
      computeTotalMs: 7,
      computeMaxMs: 7,
      dirtyRocks: 4,
      affectedPages: 2,
      sparseUploads: 3,
      fullUploads: 1,
      uploadBytes: 9_000,
      vfxSpawns: 5,
      capacityDrops: 1,
    });
    expect(report?.summaries.frame.frameTimeMaxMs).toBe(42);
    expect(report?.summaries.cpu.hostCpuTotalMs).toBe(21);
    expect(report?.summaries.cpu.hostCpuMaxMs).toBe(18);
  });

  it('hält veränderlichen Kontext und explizite Scene Inspection im Report', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const profiler = new ArenaRuntimeProfiler();
    profiler.startRecording();
    profiler.record(sample({ diagnosticContext: { rockRenderer: 'spriteGpu', rockGpuPageSize: 128 } }));
    now = 200;
    profiler.record(sample({
      quality: 'low',
      phase: 'lobby',
      diagnosticContext: { rockRenderer: 'classic', rockGpuPageSize: 256 },
    }));
    profiler.setSceneInspection({ topLevelChildren: 10, boundsIncluded: false });
    profiler.stopRecording();

    const report = profiler.buildReport();
    expect(report?.summaries.observedScope.rockRenderer).toEqual([
      { fromMs: 0, toMs: 100, value: 'spriteGpu' },
      { fromMs: 100, toMs: 100, value: 'classic' },
    ]);
    expect(report?.summaries.observedScope.rockGpuPageSize?.at(-1)?.value).toBe(256);
    expect(report?.events.filter((event) => event.type === 'context_change').length).toBeGreaterThanOrEqual(2);
    expect(report?.summaries.sceneInspection).toEqual({ topLevelChildren: 10, boundsIncluded: false });
  });

  it('exportiert VFX, Ablation und sparse GPU-Ergebnisserie getrennt', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const profiler = new ArenaRuntimeProfiler();
    const sourceReport = {
      frames: 3,
      lanes: [{ id: 0, label: 'rocket-exhaust', capacity: 2048, active: 4, highWaterMark: 9,
        rearms: 12, retirements: 8, capacityDrops: 0, utilization: 0.004, visibleFrames: 3,
        segmentsTouched: 5, fullUploadFrames: 0 }],
      effects: [{ id: 2, label: 'rocket.exhaust', laneLabel: 'rocket-exhaust',
        spawnAttempts: 14, spawns: 12, qualityDrops: 2, capacityDrops: 0 }],
      coVisibleFrames: [[3]],
    };
    let resets = 0;
    profiler.setGpuVfxSource({ build: () => sourceReport, reset: () => { resets += 1; } });
    profiler.startRecording();
    profiler.setAblationSegments([{ atMs: 140, durationMs: 100, category: 'gpuParticles' }], 100);
    profiler.recordSemanticEvent('rocks:mass_destroy', { destroyedCount: 16 });
    now = 200;
    profiler.stopRecording();

    const report = profiler.buildReport();
    expect(resets).toBe(1);
    expect(report?.summaries.gpuVfx?.lanes[0].highWaterMark).toBe(9);
    expect(report?.summaries.ablation.codes).toEqual(ABLATION_CODES);
    expect(report?.summaries.ablation.labels).toEqual(ABLATION_LABELS);
    expect(report?.summaries.ablation.segments[0]).toMatchObject({ atMs: 40, category: 'gpuParticles' });
    expect(report?.events).toContainEqual(expect.objectContaining({ type: 'rocks:mass_destroy', destroyedCount: 16 }));
    expect(report?.series.gpuSamples).toEqual([]);
    expect(report?.summaries.gpu.samplesCompleted).toBe(0);
  });

  it('nutzt den WebGL2-Timer über EXT_disjoint_timer_query_webgl2', () => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const gl = new FakeGlContext();
    const game = fakeGame(gl);
    const profiler = new ArenaRuntimeProfiler();
    profiler.attachGame(game as never);

    profiler.startRecording();
    for (let frame = 0; frame < 4; frame += 1) {
      game.emit('prerender');
      game.emit('postrender');
    }
    // The next render polls the query submitted by frame four.
    game.emit('prerender');
    profiler.stopRecording();

    const report = profiler.buildReport();
    expect(report?.summaries.gpu.status).toBe('supported');
    expect(report?.summaries.gpu.samplesCompleted).toBe(1);
    expect(report?.series.gpuSamples[0]).toMatchObject({ durationMs: 1, renderFrame: 4 });
  });

  it('lässt den GPU-Timer auf WebGL1 deaktiviert', () => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const gl = new FakeGlContext('WebGL 1.0 (test)');
    const game = fakeGame(gl);
    const profiler = new ArenaRuntimeProfiler();
    profiler.attachGame(game as never);

    profiler.startRecording();
    game.emit('prerender');
    game.emit('postrender');
    profiler.stopRecording();

    const report = profiler.buildReport();
    expect(report?.summaries.gpu.status).toBe('unsupported');
    expect(report?.series.gpuSamples).toEqual([]);
  });

  it('nutzt den WebGL1-Timer-Fallback asynchron und exportiert die GPU-Statistik', () => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const gl = new FakeWebGl1Context();
    const game = fakeGame(gl);
    const profiler = new ArenaRuntimeProfiler();
    profiler.attachGame(game as never);

    profiler.startRecording();
    for (let frame = 0; frame < 4; frame += 1) {
      game.emit('prerender');
      game.emit('postrender');
    }
    game.emit('prerender');
    profiler.stopRecording();

    const report = profiler.buildReport();
    expect(report?.summaries.gpu).toMatchObject({
      status: 'supported',
      backend: 'webgl1_ext',
      samplesCompleted: 1,
    });
    expect(report?.summaries.gpu.frameTime).toEqual({ avg: 1, p95: 1, p99: 1, peak: 1 });
  });

  it('exportiert Draw Calls und Phaser-Batch-Flushes ohne GL-Aufzeichnung', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const gl = new FakeGlContext();
    const game = fakeGame(gl);
    const node = {
      name: 'BatchHandlerQuad',
      instanceCount: 1,
      run: function run(this: { instanceCount: number }): void { this.instanceCount = 0; },
    };
    const renderer = game.renderer as unknown as {
      drawElements: () => void;
      renderNodes: { _nodes: Record<string, typeof node>; getNode(name: string): typeof node };
    };
    renderer.drawElements = vi.fn();
    renderer.renderNodes = {
      _nodes: { BatchHandlerQuad: node },
      getNode: (name: string) => renderer.renderNodes._nodes[name],
    };
    const profiler = new ArenaRuntimeProfiler();
    profiler.attachGame(game as never);
    profiler.startRecording();
    game.emit('prerender');
    renderer.drawElements();
    node.run();
    game.emit('postrender');
    profiler.record(sample({ drawCallCount: profiler.takeLastDrawCallCount() }));
    profiler.stopRecording();

    const pipeline = profiler.buildReport()?.summaries.renderPipeline;
    expect(pipeline?.backend).toBe('webgl');
    expect(pipeline?.drawCalls).toMatchObject({ avg: 1, p95: 1, p99: 1, peak: 1 });
    expect(pipeline?.phaserBatchFlushes).toMatchObject({ avg: 1, p95: 1, p99: 1, peak: 1 });
    expect(pipeline?.pipelineChanges).toBe('unsupported');
    expect(pipeline?.textureBatchChanges).toBe('unsupported');
  });

  it('lässt Live-HUD, Recording und destroy ohne schwere Hooks koexistieren', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const profiler = new ArenaRuntimeProfiler();
    const states: boolean[] = [];
    profiler.subscribeDiagnostics((active) => states.push(active));

    profiler.setLiveDiagnosticsEnabled(true);
    expect(profiler.isDiagnosticsActive()).toBe(true);
    expect(profiler.isCountingDrawCalls()).toBe(false);
    expect(profiler.wantsDetailedSampling()).toBe(false);
    profiler.startRecording();
    profiler.stopRecording();
    profiler.setLiveDiagnosticsEnabled(false);
    profiler.destroy();
    profiler.destroy();

    expect(states).toEqual([false, true, false]);
    expect(profiler.isDiagnosticsActive()).toBe(false);
  });
});
