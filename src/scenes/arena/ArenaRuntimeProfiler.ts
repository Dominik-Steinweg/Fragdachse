import type * as Phaser from 'phaser';
import type { GraphicsQuality } from '../../graphics/GraphicsQuality';
import { ABLATION_CODES, ABLATION_LABELS, type AblationCategory, type AblationSegment } from './PerformanceAblation';
import type { GpuVfxReport } from '../../effects/gpu/GpuVfxProfiler';
import { ARENA_ROCK_DESTROYED_EVENT, type ArenaRockDestroyedEvent } from './ArenaEvents';

export interface GpuVfxReportSource {
  build(): GpuVfxReport;
  reset(): void;
}

export type RuntimePhase = 'lobby' | 'arena' | 'terminated';
export type DetailTimingKey = string;
export type DetailCountKey = string;
export type TimingKey = string;
export type CountKey = string;

export interface ArenaRuntimeDetails {
  timings?: Partial<Record<string, number>>;
  counts?: Partial<Record<string, number>>;
}

export interface ArenaRuntimeContext {
  localAlive: boolean;
  aimVisible: boolean;
  scopeActive: boolean;
  utilityPlacementActive: boolean;
  ultimatePlacementActive: boolean;
  optionsOpen: boolean;
  pageVisible: boolean;
  documentFocused: boolean;
  roundElapsedMs: number | null;
  weapon1Id: string | null;
  weapon2Id: string | null;
  utilityId: string | null;
  ultimateId: string | null;
}

/** Existing ArenaScene input shape retained while collection becomes lightweight. */
export interface ArenaRuntimeSample {
  role: 'host' | 'client';
  phase: RuntimePhase;
  quality: GraphicsQuality;
  mode: string;
  mapId: string | null;
  ablation: AblationCategory;
  rawDeltaMs: number;
  deltaMs: number;
  updateMs: number;
  gameStepMs: number;
  phaserSceneUpdateMs: number;
  phaserSceneSystemsMs: number;
  rendererSetupMs: number;
  betweenFramesMs: number;
  renderSubmitMs: number;
  roleStepMs: number;
  networkUpdateMs: number;
  networkFlushMs: number;
  visualStepMs: number;
  visualCameraMs: number;
  visualEnemyMs: number;
  visualEffectsMs: number;
  visualAimMs: number;
  visualHudMs: number;
  shadowStepMs: number;
  lightingStepMs: number;
  fireSimulationMs: number;
  fireCreationMs: number;
  fireVisualMs: number;
  enemyCount: number;
  projectileCount: number;
  playerCount: number;
  displayObjectCount: number;
  visibleObjectCount: number;
  particleEmitterCount: number;
  aliveParticleCount: number;
  activeFilterCount: number;
  activeLightCount: number;
  renderedLightCount: number;
  drawCallCount: number;
  details?: ArenaRuntimeDetails;
  context?: ArenaRuntimeContext;
  /** Variable session scope that is too configuration-specific for ArenaRuntimeContext. */
  diagnosticContext?: Record<string, unknown>;
  lightPresetCounts?: Readonly<Record<string, number>>;
  filterBreakdown?: string | null;
  sceneBreakdown?: string | null;
}

export interface MetricSummary {
  avg: number;
  p95: number;
  p99: number;
  peak: number;
}

export interface ArenaRuntimeWindowSummary {
  startedAtMs: number;
  durationMs: number;
  role: 'host' | 'client';
  phase: RuntimePhase;
  quality: GraphicsQuality;
  mode: string;
  mapId: string | null;
  ablation: AblationCategory;
  sampleCount: number;
  fps: number;
  smoothedFps: number;
  coveragePercent: number;
  maxSampleGapMs: number;
  over16msPercent: number;
  over33msPercent: number;
  timings: Record<string, MetricSummary>;
  counts: Record<string, { avg: number; peak: number }>;
  detailTimings: Record<string, MetricSummary>;
  detailCounts: Record<string, { avg: number; peak: number }>;
  lightingPresets: Record<string, { avg: number; peak: number }>;
  filterBreakdown: string | null;
  sceneBreakdown: string | null;
}

export interface PerformanceGpuSample {
  /** Session-relative main-thread time of the render frame that issued the query. */
  atMs: number;
  renderFrame: number;
  durationMs: number;
}

export interface CompanionEvent {
  atMs: number;
  type: string;
  [key: string]: unknown;
}

export interface CompanionSeriesSample {
  atMs: number;
  gauges: Record<string, number | string | boolean | null>;
  interval: Record<string, number>;
}

export interface ArenaPerformanceReport {
  schemaVersion: 6;
  recordingId: number;
  createdAt: string;
  session: {
    id: string;
    recordingId: number;
    startedAtIso: string;
    endedAtIso: string | null;
    durationMs: number;
    syncIntervalMs: number;
    syncMarkerCount: number;
  };
  environment: Record<string, unknown>;
  events: CompanionEvent[];
  series: {
    sampleIntervalMs: number;
    samples: CompanionSeriesSample[];
    gpuSamples: PerformanceGpuSample[];
    truncated: boolean;
  };
  summaries: {
    frame: {
      frameCount: number;
      frameTimeTotalMs: number;
      frameTimeMaxMs: number;
      slowFrameCount: number;
      p95Ms: number;
      p99Ms: number;
      fps: number;
      slowFramePercent: number;
    };
    cpu: {
      hostCpuTotalMs: number;
      hostCpuMaxMs: number;
      clientCpuTotalMs: number;
      clientCpuMaxMs: number;
      hostFrameCount: number;
      clientFrameCount: number;
    };
    gpu: {
      status: 'supported' | 'unsupported' | 'unavailable';
      sampleEveryFrames: number;
      pendingQueriesDropped: number;
      disjointSamplesDropped: number;
      samplesCompleted: number;
    };
    observedScope: Record<string, Array<{ fromMs: number; toMs: number | null; value: unknown }>>;
    ablation: {
      segments: AblationSegment[];
      segmentMs: number;
      codes: Record<AblationCategory, number>;
      labels: Record<AblationCategory, string>;
    };
    gpuVfx: GpuVfxReport | null;
    sceneInspection: Record<string, unknown> | null;
  };
  instrumentation: {
    traceAssistEnabled: boolean;
    recordingEnabled: boolean;
    liveHudEnabled: boolean;
    gpuTimerEnabled: boolean;
    drawCallHooksEnabled: boolean;
    glDiagnosticHooksEnabled: boolean;
    semanticSamplingHz: number;
    networkBytes: {
      transport: 'exact_webrtc_stats';
      payload: 'not_collected';
      diagnosticEncodingPass: false;
    };
    recorderCostMs: MetricSummary;
  };
}

export type RuntimeDiagnosticsListener = (active: boolean) => void;

export interface PhaserFrameLifecycleMetrics {
  gameStepMs: number;
  sceneManagerUpdateMs: number;
  sceneSystemsAndPluginsMs: number;
  rendererSetupMs: number;
  betweenFramesMs: number;
}

interface PendingGpuQuery {
  query: WebGLQuery;
  atMs: number;
  renderFrame: number;
}

interface GpuTimerSupport {
  gl: WebGL2RenderingContext;
  extension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
}

const SESSION_SYNC_INTERVAL_MS = 5_000;
const SERIES_INTERVAL_MS = 250;
const MAX_SERIES_SAMPLES = 12_000;
const GPU_QUERY_INTERVAL_FRAMES = 4;
const MAX_PENDING_GPU_QUERIES = 16;
const FRAME_SLOW_THRESHOLD_MS = 16.7;
const GAME_PRE_RENDER_EVENT = 'prerender';
const GAME_POST_RENDER_EVENT = 'postrender';

function emptyMetricSummary(): MetricSummary {
  return { avg: 0, p95: 0, p99: 0, peak: 0 };
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function summarize(values: readonly number[]): MetricSummary {
  if (values.length === 0) return emptyMetricSummary();
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    avg: total / values.length,
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    peak: Math.max(...values),
  };
}

function numberDetail(sample: ArenaRuntimeSample, key: string): number {
  const value = sample.details?.counts?.[key] ?? sample.details?.timings?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sampleContext(sample: ArenaRuntimeSample): Record<string, unknown> {
  return {
    role: sample.role,
    phase: sample.phase,
    mode: sample.mode,
    mapId: sample.mapId,
    quality: sample.quality,
    ablation: sample.ablation,
    ...(sample.context ?? {}),
    ...(sample.diagnosticContext ?? {}),
  };
}

export class ArenaRuntimeProfiler {
  private game: Phaser.Game | null = null;
  private gpuTimer: GpuTimerSupport | null = null;
  private recording = false;
  private liveHudEnabled = false;
  private diagnosticsActive = false;
  private recordingId = 0;
  private sessionId = '';
  private recordingStartedAtMs = 0;
  private recordingStartedEpochMs = 0;
  private recordingEndedAtMs = 0;
  private recordingEndedEpochMs = 0;
  private recordingEnvironment: Record<string, unknown> = {};
  private autoStopped = false;
  private nextSyncAtMs = 0;
  private syncMarkerCount = 0;
  private nextSeriesAtMs = 0;
  private seriesTruncated = false;
  private readonly events: CompanionEvent[] = [];
  private readonly seriesSamples: CompanionSeriesSample[] = [];
  private readonly gpuSamples: PerformanceGpuSample[] = [];
  private readonly frameTimes: number[] = [];
  private readonly recorderCosts: number[] = [];
  private readonly observedScope = new Map<string, Array<{ fromMs: number; toMs: number | null; value: unknown }>>();
  private lastContext: Record<string, unknown> | null = null;
  private currentInterval: Record<string, number> = {};
  private latestGauges: Record<string, number | string | boolean | null> = {};
  private latestSummary: ArenaRuntimeWindowSummary | null = null;
  private latestSceneInspection: Record<string, unknown> | null = null;
  private gpuVfxSource: GpuVfxReportSource | null = null;
  private ablationSegments: AblationSegment[] = [];
  private ablationSegmentMs = 0;
  private readonly diagnosticsListeners = new Set<RuntimeDiagnosticsListener>();
  private renderFrame = 0;
  private activeGpuQuery: PendingGpuQuery | null = null;
  private readonly pendingGpuQueries: PendingGpuQuery[] = [];
  private pendingGpuQueriesDropped = 0;
  private disjointGpuSamplesDropped = 0;
  private lastRenderSubmitMs = 0;
  private lastDrawCallCount = 0;
  private gameEventsInstalled = false;
  private rockDestroyBurstCount = 0;
  private lastRockDestroyedAtMs = Number.NEGATIVE_INFINITY;

  private readonly onPreRender = (): void => {
    if (!this.recording || !this.gpuTimer) return;
    this.renderFrame += 1;
    this.pollGpuQueries();
    if (this.renderFrame % GPU_QUERY_INTERVAL_FRAMES !== 0) return;
    const gl = this.gpuTimer.gl;
    const query = gl.createQuery();
    if (!query) return;
    const atMs = Math.max(0, performance.now() - this.recordingStartedAtMs);
    gl.beginQuery(this.gpuTimer.extension.TIME_ELAPSED_EXT, query);
    this.activeGpuQuery = { query, atMs, renderFrame: this.renderFrame };
  };

  private readonly onPostRender = (): void => {
    if (!this.recording || !this.gpuTimer || !this.activeGpuQuery) return;
    const gl = this.gpuTimer.gl;
    gl.endQuery(this.gpuTimer.extension.TIME_ELAPSED_EXT);
    if (this.pendingGpuQueries.length >= MAX_PENDING_GPU_QUERIES) {
      gl.deleteQuery(this.activeGpuQuery.query);
      this.pendingGpuQueriesDropped += 1;
    } else {
      this.pendingGpuQueries.push(this.activeGpuQuery);
    }
    this.activeGpuQuery = null;
  };

  private readonly onRockDestroyed = (event: ArenaRockDestroyedEvent): void => {
    if (!this.recording) return;
    const now = performance.now();
    if (now - this.lastRockDestroyedAtMs > 50) this.rockDestroyBurstCount = 0;
    this.lastRockDestroyedAtMs = now;
    this.rockDestroyBurstCount += 1;
    if (this.rockDestroyBurstCount === 16) {
      this.recordSemanticEvent('rocks:mass_destroy', {
        destroyedCount: this.rockDestroyBurstCount,
        source: event.source,
        reason: event.reason,
      });
    }
  };

  attachGame(game: Phaser.Game): void {
    if (this.game === game) return;
    this.detachGame();
    this.game = game;
    this.syncDiagnosticsLifecycle();
  }

  subscribeDiagnostics(listener: RuntimeDiagnosticsListener): () => void {
    this.diagnosticsListeners.add(listener);
    listener(this.diagnosticsActive);
    return () => this.diagnosticsListeners.delete(listener);
  }

  isDiagnosticsActive(): boolean {
    return this.diagnosticsActive;
  }

  /** Normal Trace Assist never requests Scene-/DisplayObject-level timing. */
  wantsDetailedSampling(): boolean {
    return false;
  }

  shouldCaptureSceneBreakdown(_role: 'host' | 'client', _deltaMs: number): boolean {
    return false;
  }

  setLiveDiagnosticsEnabled(enabled: boolean): void {
    this.liveHudEnabled = enabled;
    this.syncDiagnosticsLifecycle();
  }

  isCountingDrawCalls(): boolean {
    return false;
  }

  takeLastFrameLifecycleMetrics(_currentSceneUpdateMs: number): PhaserFrameLifecycleMetrics {
    return { gameStepMs: 0, sceneManagerUpdateMs: 0, sceneSystemsAndPluginsMs: 0, rendererSetupMs: 0, betweenFramesMs: 0 };
  }

  takeLastRenderSubmitMs(): number {
    return this.lastRenderSubmitMs;
  }

  takeLastDrawCallCount(): number {
    return this.lastDrawCallCount;
  }

  record(sample: ArenaRuntimeSample): void {
    if (!this.diagnosticsActive) return;
    const startedAt = performance.now();
    const now = startedAt;
    const frameMs = Number.isFinite(sample.rawDeltaMs) && sample.rawDeltaMs > 0 ? sample.rawDeltaMs : sample.deltaMs;
    const roleCpuMs = Math.max(0, sample.roleStepMs);
    this.latestGauges = {
      enemyCount: sample.enemyCount,
      projectileCount: sample.projectileCount,
      playerCount: sample.playerCount,
      phase: sample.phase,
      role: sample.role,
      quality: sample.quality,
      flowfieldAgeMs: numberDetail(sample, 'flowfieldAgeMs'),
      flowfieldQueueDepth: numberDetail(sample, 'flowfieldQueueDepth'),
      visiblePages: numberDetail(sample, 'visiblePages'),
      activeVfx: numberDetail(sample, 'activeVfx'),
      bufferedBytes: numberDetail(sample, 'transportReliableBufferedBytes') + numberDetail(sample, 'transportFastBufferedBytes'),
    };
    this.addInterval('frameCount', 1);
    this.addInterval('frameTimeTotalMs', frameMs);
    this.addInterval('frameTimeMaxMs', frameMs, true);
    if (frameMs > FRAME_SLOW_THRESHOLD_MS) this.addInterval('slowFrameCount', 1);
    if (sample.role === 'host') {
      this.addInterval('hostFrameCount', 1);
      this.addInterval('hostCpuTotalMs', roleCpuMs);
      this.addInterval('hostCpuMaxMs', roleCpuMs, true);
    } else {
      this.addInterval('clientFrameCount', 1);
      this.addInterval('clientCpuTotalMs', roleCpuMs);
      this.addInterval('clientCpuMaxMs', roleCpuMs, true);
    }
    this.addInterval('snapshotCount', numberDetail(sample, 'newNetworkSnapshotCount'));
    this.addInterval('snapshotBytesTotal', numberDetail(sample, 'snapshotBytes'));
    this.addInterval('snapshotBytesMax', numberDetail(sample, 'snapshotBytes'), true);
    this.addInterval('flowfieldJobs', numberDetail(sample, 'flowfieldJobs'));
    this.addInterval('computeTotalMs', numberDetail(sample, 'flowfieldComputeMs'));
    this.addInterval('computeMaxMs', numberDetail(sample, 'flowfieldComputeMs'), true);
    this.addInterval('roundTripTotalMs', numberDetail(sample, 'flowfieldRoundTripMs'));
    this.addInterval('roundTripMaxMs', numberDetail(sample, 'flowfieldRoundTripMs'), true);
    this.addInterval('dirtyRocks', numberDetail(sample, 'dirtyRocks'));
    this.addInterval('affectedPages', numberDetail(sample, 'affectedPages'));
    this.addInterval('sparseUploads', numberDetail(sample, 'sparseUploads'));
    this.addInterval('fullUploads', numberDetail(sample, 'fullUploads'));
    this.addInterval('uploadBytes', numberDetail(sample, 'uploadBytes'));
    this.addInterval('vfxSpawns', numberDetail(sample, 'vfxSpawns'));
    this.addInterval('capacityDrops', numberDetail(sample, 'capacityDrops'));
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 4096) this.frameTimes.shift();
    this.observeContext(sampleContext(sample), now);
    if (this.recording) {
      this.emitSessionSyncIfDue(now);
      if (now >= this.nextSeriesAtMs) this.flushSeries(now);
      this.recorderCosts.push(performance.now() - startedAt);
      if (this.recorderCosts.length > 256) this.recorderCosts.shift();
      if (now - this.recordingStartedAtMs >= 30 * 60 * 1000) this.stopRecording(true);
    }
    this.latestSummary = this.buildLiveSummary(now, sample);
  }

  startRecording(environment: Record<string, unknown> = {}): void {
    if (this.recording) return;
    const now = performance.now();
    this.recording = true;
    this.recordingId += 1;
    this.sessionId = this.createSessionId();
    this.recordingStartedAtMs = now;
    this.recordingStartedEpochMs = Date.now();
    this.recordingEndedAtMs = 0;
    this.recordingEndedEpochMs = 0;
    this.recordingEnvironment = { ...environment };
    this.autoStopped = false;
    this.nextSyncAtMs = now + SESSION_SYNC_INTERVAL_MS;
    this.nextSeriesAtMs = now + SERIES_INTERVAL_MS;
    this.syncMarkerCount = 0;
    this.events.length = 0;
    this.seriesSamples.length = 0;
    this.gpuSamples.length = 0;
    this.frameTimes.length = 0;
    this.recorderCosts.length = 0;
    this.currentInterval = {};
    this.latestGauges = {};
    this.lastContext = null;
    this.rockDestroyBurstCount = 0;
    this.lastRockDestroyedAtMs = Number.NEGATIVE_INFINITY;
    this.observedScope.clear();
    this.ablationSegments = [];
    this.ablationSegmentMs = 0;
    this.latestSceneInspection = null;
    this.seriesTruncated = false;
    this.pendingGpuQueriesDropped = 0;
    this.disjointGpuSamplesDropped = 0;
    this.gpuVfxSource?.reset();
    this.safeMark(`FD:session:start:${this.sessionId}`);
    this.syncDiagnosticsLifecycle();
  }

  stopRecording(autoStopped = false): void {
    if (!this.recording) return;
    const now = performance.now();
    this.flushSeries(now, true);
    this.recording = false;
    this.recordingEndedAtMs = now;
    this.recordingEndedEpochMs = Date.now();
    this.autoStopped = autoStopped;
    this.safeMark(`FD:session:end:${this.sessionId}`);
    this.closeObservedScopes(Math.max(0, now - this.recordingStartedAtMs));
    this.finishGpuQueries();
    this.syncDiagnosticsLifecycle();
  }

  recordQualityChange(from: GraphicsQuality, to: GraphicsQuality): void {
    if (!this.recording) return;
    this.recordSemanticEvent('context_change', { scope: 'quality', from, to });
  }

  recordSemanticEvent(type: string, fields: Record<string, unknown> = {}): void {
    if (!this.recording) return;
    const atMs = Math.max(0, performance.now() - this.recordingStartedAtMs);
    this.events.push({ atMs, type, ...fields });
    const marker = type.startsWith('FD:')
      ? type
      : type.includes(':') ? `FD:${type}` : `FD:event:${type}`;
    this.safeMark(marker);
  }

  setSceneInspection(snapshot: Record<string, unknown> | null): void {
    this.latestSceneInspection = snapshot ? { ...snapshot } : null;
  }

  setAblationSegments(segments: readonly AblationSegment[], segmentMs: number): void {
    this.ablationSegments = segments.map((segment) => ({
      ...segment,
      atMs: Math.max(0, segment.atMs - this.recordingStartedAtMs),
    }));
    this.ablationSegmentMs = segmentMs;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getRecordingDurationMs(): number {
    if (this.recordingStartedAtMs <= 0) return 0;
    return this.recording
      ? Math.max(0, performance.now() - this.recordingStartedAtMs)
      : Math.max(0, this.recordingEndedAtMs - this.recordingStartedAtMs);
  }

  getLatestSummary(): ArenaRuntimeWindowSummary | null {
    return this.latestSummary;
  }

  setGpuVfxSource(source: GpuVfxReportSource | null): void {
    this.gpuVfxSource = source;
  }

  canExport(): boolean {
    return !this.recording && this.sessionId.length > 0;
  }

  buildReport(): ArenaPerformanceReport | null {
    if (!this.canExport()) return null;
    const durationMs = Math.max(0, this.recordingEndedAtMs - this.recordingStartedAtMs);
    const frameSummary = this.buildFrameSummary();
    return {
      schemaVersion: 6,
      recordingId: this.recordingId,
      createdAt: new Date().toISOString(),
      session: {
        id: this.sessionId,
        recordingId: this.recordingId,
        startedAtIso: new Date(this.recordingStartedEpochMs).toISOString(),
        endedAtIso: this.recordingEndedEpochMs > 0 ? new Date(this.recordingEndedEpochMs).toISOString() : null,
        durationMs,
        syncIntervalMs: SESSION_SYNC_INTERVAL_MS,
        syncMarkerCount: this.syncMarkerCount,
      },
      environment: { ...this.recordingEnvironment },
      events: this.events.map((event) => ({ ...event })),
      series: {
        sampleIntervalMs: SERIES_INTERVAL_MS,
        samples: this.seriesSamples.map((sample) => ({
          atMs: sample.atMs,
          gauges: { ...sample.gauges },
          interval: { ...sample.interval },
        })),
        gpuSamples: this.gpuSamples.map((sample) => ({ ...sample })),
        truncated: this.seriesTruncated,
      },
      summaries: {
        frame: frameSummary,
        cpu: {
          hostCpuTotalMs: this.summaryTotal('hostCpuTotalMs'),
          hostCpuMaxMs: this.summaryMax('hostCpuMaxMs'),
          clientCpuTotalMs: this.summaryTotal('clientCpuTotalMs'),
          clientCpuMaxMs: this.summaryMax('clientCpuMaxMs'),
          hostFrameCount: this.summaryTotal('hostFrameCount'),
          clientFrameCount: this.summaryTotal('clientFrameCount'),
        },
        gpu: {
          status: this.game ? (this.gpuTimer ? 'supported' : 'unsupported') : 'unavailable',
          sampleEveryFrames: GPU_QUERY_INTERVAL_FRAMES,
          pendingQueriesDropped: this.pendingGpuQueriesDropped,
          disjointSamplesDropped: this.disjointGpuSamplesDropped,
          samplesCompleted: this.gpuSamples.length,
        },
        observedScope: this.buildObservedScope(),
        ablation: {
          segments: this.ablationSegments.map((segment) => ({ ...segment })),
          segmentMs: this.ablationSegmentMs,
          codes: { ...ABLATION_CODES },
          labels: { ...ABLATION_LABELS },
        },
        gpuVfx: this.gpuVfxSource?.build() ?? null,
        sceneInspection: this.latestSceneInspection ? { ...this.latestSceneInspection } : null,
      },
      instrumentation: {
        traceAssistEnabled: true,
        recordingEnabled: true,
        liveHudEnabled: this.liveHudEnabled,
        gpuTimerEnabled: this.gpuTimer !== null,
        drawCallHooksEnabled: false,
        glDiagnosticHooksEnabled: false,
        semanticSamplingHz: 1000 / SERIES_INTERVAL_MS,
        networkBytes: {
          transport: 'exact_webrtc_stats',
          payload: 'not_collected',
          diagnosticEncodingPass: false,
        },
        recorderCostMs: summarize(this.recorderCosts),
      },
    };
  }

  destroy(): void {
    this.stopRecording();
    this.liveHudEnabled = false;
    this.removeGameDiagnostics();
    this.detachGame();
    this.diagnosticsListeners.clear();
  }

  private addInterval(key: string, value: number, max = false): void {
    if (!Number.isFinite(value) || value === 0) return;
    if (max) this.currentInterval[key] = Math.max(this.currentInterval[key] ?? 0, value);
    else this.currentInterval[key] = (this.currentInterval[key] ?? 0) + value;
  }

  private flushSeries(now: number, final = false): void {
    if (!this.recording) return;
    const atMs = Math.max(0, now - this.recordingStartedAtMs);
    if (this.seriesSamples.length >= MAX_SERIES_SAMPLES) {
      this.seriesSamples.shift();
      this.seriesTruncated = true;
    }
    this.seriesSamples.push({ atMs, gauges: { ...this.latestGauges }, interval: { ...this.currentInterval } });
    this.currentInterval = {};
    this.nextSeriesAtMs = final ? Number.POSITIVE_INFINITY : now + SERIES_INTERVAL_MS;
  }

  private emitSessionSyncIfDue(now: number): void {
    if (now < this.nextSyncAtMs) return;
    const elapsedMs = Math.max(0, Math.round(now - this.recordingStartedAtMs));
    const marker = `FD:session:sync:${this.sessionId}:${elapsedMs}`;
    this.safeMark(marker);
    this.events.push({ atMs: elapsedMs, type: 'session_sync', marker });
    this.syncMarkerCount += 1;
    this.nextSyncAtMs = now + SESSION_SYNC_INTERVAL_MS;
  }

  private observeContext(context: Record<string, unknown>, now: number): void {
    if (!this.recording) return;
    const atMs = Math.max(0, now - this.recordingStartedAtMs);
    if (this.lastContext) {
      for (const key of new Set([...Object.keys(this.lastContext), ...Object.keys(context)])) {
        if (this.lastContext[key] === context[key]) continue;
        this.events.push({ atMs, type: 'context_change', scope: key, from: this.lastContext[key] ?? null, to: context[key] ?? null });
        this.safeMark('FD:context:change');
        const scopes = this.observedScope.get(key) ?? [];
        const current = scopes[scopes.length - 1];
        if (current) current.toMs = atMs;
        scopes.push({ fromMs: atMs, toMs: null, value: context[key] ?? null });
        this.observedScope.set(key, scopes);
      }
    }
    if (!this.lastContext) {
      for (const [key, value] of Object.entries(context)) this.observedScope.set(key, [{ fromMs: 0, toMs: null, value }]);
    }
    this.lastContext = context;
  }

  private closeObservedScopes(atMs: number): void {
    for (const scopes of this.observedScope.values()) {
      const current = scopes[scopes.length - 1];
      if (current && current.toMs === null) current.toMs = atMs;
    }
  }

  private buildObservedScope(): Record<string, Array<{ fromMs: number; toMs: number | null; value: unknown }>> {
    return Object.fromEntries([...this.observedScope.entries()].map(([key, values]) => [key, values.map((value) => ({ ...value }))]));
  }

  private buildFrameSummary(): ArenaPerformanceReport['summaries']['frame'] {
    const frameCount = this.summaryTotal('frameCount');
    const total = this.summaryTotal('frameTimeTotalMs');
    const slow = this.summaryTotal('slowFrameCount');
    return {
      frameCount,
      frameTimeTotalMs: total,
      frameTimeMaxMs: this.summaryMax('frameTimeMaxMs'),
      slowFrameCount: slow,
      p95Ms: percentile(this.frameTimes, 0.95),
      p99Ms: percentile(this.frameTimes, 0.99),
      fps: total > 0 ? frameCount * 1000 / total : 0,
      slowFramePercent: frameCount > 0 ? slow / frameCount * 100 : 0,
    };
  }

  private buildLiveSummary(now: number, sample: ArenaRuntimeSample): ArenaRuntimeWindowSummary {
    const frame = this.buildFrameSummary();
    return {
      startedAtMs: this.recording ? 0 : now,
      durationMs: this.recording ? Math.max(0, now - this.recordingStartedAtMs) : 0,
      role: sample.role,
      phase: sample.phase,
      quality: sample.quality,
      mode: sample.mode,
      mapId: sample.mapId,
      ablation: sample.ablation,
      sampleCount: frame.frameCount,
      fps: frame.fps,
      smoothedFps: sample.deltaMs > 0 ? 1000 / sample.deltaMs : 0,
      coveragePercent: 100,
      maxSampleGapMs: 0,
      over16msPercent: frame.slowFramePercent,
      over33msPercent: this.frameTimes.length > 0 ? this.frameTimes.filter((value) => value > 33.3).length / this.frameTimes.length * 100 : 0,
      timings: {
        rawDeltaMs: summarize(this.frameTimes),
        deltaMs: summarize([sample.deltaMs]),
        gameStepMs: summarize([sample.gameStepMs]),
        roleStepMs: summarize([sample.roleStepMs]),
      },
      counts: {
        enemyCount: { avg: sample.enemyCount, peak: sample.enemyCount },
        projectileCount: { avg: sample.projectileCount, peak: sample.projectileCount },
        playerCount: { avg: sample.playerCount, peak: sample.playerCount },
      },
      detailTimings: {},
      detailCounts: {},
      lightingPresets: {},
      filterBreakdown: null,
      sceneBreakdown: null,
    };
  }

  private summaryTotal(key: string): number {
    return this.seriesSamples.reduce((sum, sample) => sum + (sample.interval[key] ?? 0), 0) + (this.currentInterval[key] ?? 0);
  }

  private summaryMax(key: string): number {
    return Math.max(0, ...this.seriesSamples.map((sample) => sample.interval[key] ?? 0), this.currentInterval[key] ?? 0);
  }

  private safeMark(name: string): void {
    try {
      if (typeof performance !== 'undefined' && typeof performance.mark === 'function') performance.mark(name);
    } catch {
      // User Timing is optional and must never affect gameplay.
    }
  }

  private createSessionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `fd-${Date.now().toString(36)}-${this.recordingId.toString(36)}`;
  }

  private syncDiagnosticsLifecycle(): void {
    const active = this.recording || this.liveHudEnabled;
    if (this.recording) this.installGameDiagnostics();
    else this.removeGameDiagnostics();
    if (active === this.diagnosticsActive) return;
    this.diagnosticsActive = active;
    for (const listener of this.diagnosticsListeners) listener(active);
  }

  private installGameDiagnostics(): void {
    if (!this.game || this.gameEventsInstalled) return;
    this.setupGpuTimer();
    this.game.events.on(GAME_PRE_RENDER_EVENT, this.onPreRender);
    this.game.events.on(GAME_POST_RENDER_EVENT, this.onPostRender);
    this.game.events.on(ARENA_ROCK_DESTROYED_EVENT, this.onRockDestroyed);
    this.gameEventsInstalled = true;
  }

  private removeGameDiagnostics(): void {
    if (this.game && this.gameEventsInstalled) {
      this.game.events.off(GAME_PRE_RENDER_EVENT, this.onPreRender);
      this.game.events.off(GAME_POST_RENDER_EVENT, this.onPostRender);
      this.game.events.off(ARENA_ROCK_DESTROYED_EVENT, this.onRockDestroyed);
    }
    this.gameEventsInstalled = false;
    this.finishGpuQueries();
    this.gpuTimer = null;
  }

  private setupGpuTimer(): void {
    if (this.gpuTimer || !this.game || typeof WebGL2RenderingContext === 'undefined') return;
    const gl = (this.game.renderer as { gl?: WebGLRenderingContext }).gl;
    if (!(gl instanceof WebGL2RenderingContext)) return;
    const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!extension) return;
    this.gpuTimer = { gl, extension };
  }

  private pollGpuQueries(): void {
    const timer = this.gpuTimer;
    if (!timer) return;
    const gl = timer.gl;
    for (let index = this.pendingGpuQueries.length - 1; index >= 0; index -= 1) {
      const pending = this.pendingGpuQueries[index];
      const available = gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE) as boolean;
      if (!available) continue;
      this.pendingGpuQueries.splice(index, 1);
      const disjoint = gl.getParameter(timer.extension.GPU_DISJOINT_EXT) as boolean;
      if (disjoint) {
        this.disjointGpuSamplesDropped += 1;
        gl.deleteQuery(pending.query);
        continue;
      }
      const nanoseconds = gl.getQueryParameter(pending.query, gl.QUERY_RESULT) as number;
      const durationMs = Number.isFinite(nanoseconds) ? nanoseconds / 1_000_000 : 0;
      this.gpuSamples.push({ ...pending, durationMs });
      this.addInterval('gpuCompletedCount', 1);
      this.addInterval('gpuDurationTotalMs', durationMs);
      this.addInterval('gpuDurationMaxMs', durationMs, true);
      gl.deleteQuery(pending.query);
    }
  }

  private finishGpuQueries(): void {
    const timer = this.gpuTimer;
    if (!timer) return;
    const gl = timer.gl;
    if (this.activeGpuQuery) {
      this.pendingGpuQueriesDropped += 1;
      gl.deleteQuery(this.activeGpuQuery.query);
    }
    this.pendingGpuQueriesDropped += this.pendingGpuQueries.length;
    for (const pending of this.pendingGpuQueries) gl.deleteQuery(pending.query);
    this.activeGpuQuery = null;
    this.pendingGpuQueries.length = 0;
  }

  private detachGame(): void {
    this.removeGameDiagnostics();
    this.game = null;
  }
}
