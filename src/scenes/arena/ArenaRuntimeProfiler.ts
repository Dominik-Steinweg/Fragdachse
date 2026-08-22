import type * as Phaser from 'phaser';
import type { GraphicsQuality } from '../../graphics/GraphicsQuality';
import { ABLATION_CODES, ABLATION_LABELS, type AblationCategory, type AblationSegment } from './PerformanceAblation';
import type { GpuVfxReport } from '../../effects/gpu/GpuVfxProfiler';
import { ARENA_ROCK_DESTROYED_EVENT, type ArenaRockDestroyedEvent } from './ArenaEvents';
import type {
  ArenaVisualAttributionCatalog,
  ArenaVisualAttributionSample,
  ArenaVisualAttributionSource,
  ArenaVisualAttributionSummary,
} from './ArenaVisualAttribution';

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

export interface ArenaAttributionReport {
  catalog: ArenaVisualAttributionCatalog;
  summary: ArenaVisualAttributionSummary;
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
  attribution?: ArenaVisualAttributionSample;
}

export interface ArenaPerformanceReport {
  schemaVersion: 7;
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
    eventsTruncated: boolean;
  };
  environment: Record<string, unknown>;
  attributionCatalog: ArenaVisualAttributionCatalog | null;
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
    attribution: ArenaAttributionReport | null;
    sceneInspection: Record<string, unknown> | null;
    network: {
      /** Logical host net-ticks/client snapshot arrivals; not a per-peer send count. */
      snapshotCount: number;
      logicalSnapshotCount: number;
      /** Payload sends and payload bytes are counted once per PeerLink/connection. */
      payloadSendCount: number;
      payloadBytesTotal: number;
      payloadBytesMax: number;
      /** Compatibility aliases for payloadBytesTotal/payloadBytesMax. */
      snapshotBytesTotal: number;
      snapshotBytesMax: number;
      /** Per-peer full/delta payload sends, not logical snapshot builds. */
      fullSnapshotCount: number;
      deltaSnapshotCount: number;
      droppedFastMessages: number;
      sentBytes: number;
      receivedBytes: number;
    };
    flowfield: {
      requestedUpdates: number;
      startedJobs: number;
      completedJobs: number;
      droppedStale: number;
      coalescedJobs: number;
      skippedUnchangedFields: number;
      workerComputeTotalMs: number;
      workerComputeMaxMs: number;
      roundTripTotalMs: number;
      roundTripMaxMs: number;
    };
    rocks: {
      dirtyRocks: number;
      affectedPages: number;
      sparseUploads: number;
      fullUploads: number;
      uploadBytes: number;
    };
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
      payload: 'estimated_utf16_code_units';
      payloadAggregation: 'per_peer_send';
      logicalSnapshotCounter: 'host_net_tick_or_client_snapshot';
      diagnosticEncodingPass: false;
    };
    recorderCostMs: MetricSummary;
  };
}

export type RuntimeDiagnosticsListener = (active: boolean) => void;
export type RuntimeRecordingListener = (recordingId: number) => void;
export type RuntimeRecordingLifecycleListener = (recording: boolean, recordingId: number) => void;

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
const FRAME_OVER_33MS_THRESHOLD = 33.3;
const FRAME_RING_CAPACITY = 4096;
const FRAME_HISTOGRAM_BUCKET_MS = 0.5;
const FRAME_HISTOGRAM_BUCKET_COUNT = 512;
const MAX_EVENTS = 4096;
const CONTEXT_SAMPLE_INTERVAL_MS = 250;
const LIVE_SUMMARY_INTERVAL_MS = 500;
const SNAPSHOT_SPIKE_BYTES = 64 * 1024;
const ROCK_MASS_DESTROY_THRESHOLD = 16;
const ROCK_DESTROY_WAVE_IDLE_MS = 50;
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

function numberDetail(sample: ArenaRuntimeSample, key: string, fallback = 0): number {
  const value = sample.details?.counts?.[key] ?? sample.details?.timings?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const OBSERVED_CONTEXT_KEYS = new Set([
  'role', 'phase', 'mode', 'mapId', 'quality', 'ablation',
  'localAlive', 'aimVisible', 'scopeActive', 'utilityPlacementActive',
  'ultimatePlacementActive', 'optionsOpen', 'pageVisible', 'documentFocused',
  'weapon1Id', 'weapon2Id', 'utilityId', 'ultimateId',
  'rockRenderer', 'rockGpuPageSize', 'rockPageSize', 'rendererMode',
]);

function sampleContext(sample: ArenaRuntimeSample): Record<string, unknown> {
  const candidate: Record<string, unknown> = {
    role: sample.role,
    phase: sample.phase,
    mode: sample.mode,
    mapId: sample.mapId,
    quality: sample.quality,
    ablation: sample.ablation,
    ...(sample.context ?? {}),
    ...(sample.diagnosticContext ?? {}),
  };
  return Object.fromEntries(Object.entries(candidate).filter(([key]) => OBSERVED_CONTEXT_KEYS.has(key)));
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
  private eventsTruncated = false;
  private nextSeriesAtMs = 0;
  private nextLiveAttributionAtMs = 0;
  private nextContextObserveAtMs = 0;
  private nextLiveSummaryAtMs = 0;
  private seriesTruncated = false;
  private readonly events: CompanionEvent[] = [];
  private readonly seriesSamples: CompanionSeriesSample[] = [];
  private readonly gpuSamples: PerformanceGpuSample[] = [];
  private readonly frameTimeRing = new Array<number>(FRAME_RING_CAPACITY).fill(0);
  private frameTimeRingIndex = 0;
  private frameTimeRingCount = 0;
  private frameTimeRingTotalMs = 0;
  private frameTimeRingOver33Ms = 0;
  private readonly frameTimeHistogram = new Array<number>(FRAME_HISTOGRAM_BUCKET_COUNT).fill(0);
  private frameTimeHistogramTotal = 0;
  private readonly liveFrameTimeHistogram = new Array<number>(FRAME_HISTOGRAM_BUCKET_COUNT).fill(0);
  private liveFrameTimeHistogramTotal = 0;
  private readonly sessionTotals = new Map<string, number>();
  private readonly sessionMaxima = new Map<string, number>();
  private readonly liveTotals = new Map<string, number>();
  private readonly liveMaxima = new Map<string, number>();
  private readonly recorderCosts: number[] = [];
  private readonly observedScope = new Map<string, Array<{ fromMs: number; toMs: number | null; value: unknown }>>();
  private lastContext: Record<string, unknown> | null = null;
  private pendingContext: Record<string, unknown> | null = null;
  private pendingContextSample: ArenaRuntimeSample | null = null;
  private pendingContextSampleAtMs = 0;
  private currentInterval: Record<string, number> = {};
  private latestGauges: Record<string, number | string | boolean | null> = {};
  private latestSummary: ArenaRuntimeWindowSummary | null = null;
  private latestSceneInspection: Record<string, unknown> | null = null;
  private gpuVfxSource: GpuVfxReportSource | null = null;
  private attributionSource: ArenaVisualAttributionSource | null = null;
  private latestAttribution: ArenaVisualAttributionSample | null = null;
  private frozenAttribution: ArenaAttributionReport | null = null;
  private frozenGpuVfxReport: GpuVfxReport | null = null;
  private frozenFrameSummary: ArenaPerformanceReport['summaries']['frame'] | null = null;
  private ablationSegments: AblationSegment[] = [];
  private ablationSegmentMs = 0;
  private readonly diagnosticsListeners = new Set<RuntimeDiagnosticsListener>();
  private readonly recordingListeners = new Set<RuntimeRecordingListener>();
  private readonly recordingLifecycleListeners = new Set<RuntimeRecordingLifecycleListener>();
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
  private readonly rockDestroyWaveSources = new Set<string>();
  private readonly rockDestroyWaveReasons = new Set<string>();
  private pendingSnapshotBytesTotal = 0;
  private pendingSnapshotBytesMax = 0;
  private pendingFullSnapshotCount = 0;
  private pendingDeltaSnapshotCount = 0;
  private gpuTimerStatus: 'supported' | 'unsupported' | 'unavailable' = 'unavailable';
  private gpuTimerWasEnabled = false;

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
    if (now - this.lastRockDestroyedAtMs > ROCK_DESTROY_WAVE_IDLE_MS) this.finalizeRockDestroyWave();
    this.lastRockDestroyedAtMs = now;
    this.rockDestroyBurstCount += 1;
    if (event.source) this.rockDestroyWaveSources.add(event.source);
    if (event.reason) this.rockDestroyWaveReasons.add(event.reason);
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

  subscribeRecording(listener: RuntimeRecordingListener): () => void {
    this.recordingListeners.add(listener);
    return () => this.recordingListeners.delete(listener);
  }

  subscribeRecordingLifecycle(listener: RuntimeRecordingLifecycleListener): () => void {
    this.recordingLifecycleListeners.add(listener);
    return () => this.recordingLifecycleListeners.delete(listener);
  }

  isDiagnosticsActive(): boolean {
    return this.diagnosticsActive;
  }

  getRecordingId(): number {
    return this.recordingId;
  }

  /**
   * Receives the payload size measured at the existing PeerLink encoding boundary. The callback
   * never serializes again; the value is intentionally classified as an estimate because the
   * existing string payload length is not a byte-level transport measurement.
   */
  recordNetworkPayload(info: {
    channel: 'rel' | 'fast';
    payloadLength: number;
    gameState: 'none' | 'delta' | 'full';
  }): void {
    if (!this.recording || info.gameState === 'none' || !Number.isFinite(info.payloadLength)) return;
    const bytes = Math.max(0, info.payloadLength);
    this.pendingSnapshotBytesTotal += bytes;
    this.pendingSnapshotBytesMax = Math.max(this.pendingSnapshotBytesMax, bytes);
    if (info.gameState === 'full') this.pendingFullSnapshotCount += 1;
    else if (info.gameState === 'delta') this.pendingDeltaSnapshotCount += 1;
    if (bytes >= SNAPSHOT_SPIKE_BYTES) {
      this.recordSemanticEvent('network:snapshot_spike', {
        channel: info.channel,
        gameState: info.gameState,
        payloadBytes: bytes,
        payloadBytesExact: false,
        payloadSizeKind: 'estimated_utf16_code_units',
      });
    }
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
    if (!enabled) this.latestSummary = null;
    else this.nextLiveSummaryAtMs = 0;
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
    this.finalizeRockDestroyWaveIfIdle(now);
    const frameMs = Number.isFinite(sample.rawDeltaMs) && sample.rawDeltaMs > 0 ? sample.rawDeltaMs : sample.deltaMs;
    const roleCpuMs = Math.max(0, sample.roleStepMs);
    const snapshotCount = numberDetail(sample, 'newNetworkSnapshotCount')
      + numberDetail(sample, 'hostNetworkTickCount');
    const snapshotBytes = numberDetail(sample, 'snapshotBytes') + this.pendingSnapshotBytesTotal;
    const fullSnapshotCount = numberDetail(sample, 'fullSnapshotCount') + this.pendingFullSnapshotCount;
    const deltaSnapshotCount = numberDetail(sample, 'deltaSnapshotCount') + this.pendingDeltaSnapshotCount;
    this.latestGauges = {
      enemyCount: sample.enemyCount,
      projectileCount: sample.projectileCount,
      playerCount: sample.playerCount,
      phase: sample.phase,
      role: sample.role,
      quality: sample.quality,
      flowfieldAgeMs: numberDetail(sample, 'flowfieldAgeMs'),
      flowfieldPendingAgeMs: numberDetail(sample, 'flowfieldPendingAgeMs', numberDetail(sample, 'flowfieldAgeMs')),
      flowfieldQueueDepth: numberDetail(sample, 'flowfieldQueueDepth'),
      flowfieldBacklogTicks: numberDetail(sample, 'flowfieldBacklogTicks', numberDetail(sample, 'flowfieldQueueDepth')),
      visiblePages: numberDetail(sample, 'visiblePages'),
      activeVfx: numberDetail(sample, 'activeVfx'),
      bufferedBytes: numberDetail(sample, 'transportReliableBufferedBytes') + numberDetail(sample, 'transportFastBufferedBytes'),
      reliableBufferedBytes: numberDetail(sample, 'transportReliableBufferedBytes'),
      fastBufferedBytes: numberDetail(sample, 'transportFastBufferedBytes'),
      rttMs: numberDetail(sample, 'transportMedianRttMs'),
      appPingMs: numberDetail(sample, 'transportMedianAppPingMs'),
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
    this.addInterval('snapshotCount', snapshotCount);
    this.addInterval('logicalSnapshotCount', snapshotCount);
    this.addInterval('snapshotBytesTotal', snapshotBytes);
    const snapshotBytesMax = Math.max(numberDetail(sample, 'snapshotBytes'), this.pendingSnapshotBytesMax);
    this.addInterval('snapshotBytesMax', snapshotBytesMax, true);
    this.addInterval('payloadBytesTotal', snapshotBytes);
    this.addInterval('payloadBytesMax', snapshotBytesMax, true);
    this.addInterval('fullSnapshotCount', fullSnapshotCount);
    this.addInterval('deltaSnapshotCount', deltaSnapshotCount);
    this.addInterval('payloadSendCount', fullSnapshotCount + deltaSnapshotCount);
    this.addInterval('snapshotBuildTotalMs', numberDetail(sample, 'snapshotBuildMs'));
    this.addInterval('snapshotBuildMaxMs', numberDetail(sample, 'snapshotBuildMs'), true);
    this.addInterval('flowfieldJobs', numberDetail(sample, 'flowfieldJobs'));
    this.addInterval('flowfieldRequestedUpdates', numberDetail(sample, 'flowfieldRequestedUpdates'));
    this.addInterval('flowfieldCompletedJobs', numberDetail(sample, 'flowfieldCompletedJobs'));
    this.addInterval('flowfieldDroppedStale', numberDetail(sample, 'flowfieldDroppedStale'));
    this.addInterval('flowfieldCoalescedJobs', numberDetail(sample, 'flowfieldCoalescedJobs'));
    this.addInterval('flowfieldSkippedUnchangedFields', numberDetail(sample, 'flowfieldSkippedUnchangedFields'));
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
    this.addInterval('droppedFastMessages', numberDetail(sample, 'transportDroppedFastMessages'));
    this.addInterval('sentBytes', numberDetail(sample, 'transportSentBytes'));
    this.addInterval('receivedBytes', numberDetail(sample, 'transportReceivedBytes'));
    this.recordFrameTime(frameMs);
    this.pendingContextSample = sample;
    this.pendingContextSampleAtMs = now;
    if (!this.lastContext || now >= this.nextContextObserveAtMs) {
      const context = sampleContext(sample);
      this.pendingContext = context;
      this.observeContext(context, now);
      this.nextContextObserveAtMs = now + CONTEXT_SAMPLE_INTERVAL_MS;
    }
    this.pendingSnapshotBytesTotal = 0;
    this.pendingSnapshotBytesMax = 0;
    this.pendingFullSnapshotCount = 0;
    this.pendingDeltaSnapshotCount = 0;
    if (this.recording) {
      this.emitSessionSyncIfDue(now);
      if (now >= this.nextSeriesAtMs) this.flushSeries(now);
      this.recorderCosts.push(performance.now() - startedAt);
      if (this.recorderCosts.length > 256) this.recorderCosts.shift();
      if (now - this.recordingStartedAtMs >= 30 * 60 * 1000) this.stopRecording(true);
    }
    if (this.liveHudEnabled && (this.latestSummary === null || now >= this.nextLiveSummaryAtMs)) {
      this.latestSummary = this.buildLiveSummary(now, sample);
      this.nextLiveSummaryAtMs = now + LIVE_SUMMARY_INTERVAL_MS;
    } else if (!this.liveHudEnabled) {
      this.latestSummary = null;
    }
    if (!this.recording && this.liveHudEnabled && now >= this.nextLiveAttributionAtMs) {
      this.latestAttribution = this.attributionSource?.sampleAndReset() ?? null;
      this.nextLiveAttributionAtMs = now + SERIES_INTERVAL_MS;
    }
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
    this.eventsTruncated = false;
    this.events.length = 0;
    this.seriesSamples.length = 0;
    this.gpuSamples.length = 0;
    this.frameTimeRingIndex = 0;
    this.frameTimeRingCount = 0;
    this.frameTimeRingTotalMs = 0;
    this.frameTimeRingOver33Ms = 0;
    this.frameTimeHistogram.fill(0);
    this.frameTimeHistogramTotal = 0;
    this.sessionTotals.clear();
    this.sessionMaxima.clear();
    this.liveTotals.clear();
    this.liveMaxima.clear();
    this.liveFrameTimeHistogram.fill(0);
    this.liveFrameTimeHistogramTotal = 0;
    this.recorderCosts.length = 0;
    this.currentInterval = {};
    this.latestGauges = {};
    this.lastContext = null;
    this.pendingContext = null;
    this.pendingContextSample = null;
    this.pendingContextSampleAtMs = 0;
    this.nextContextObserveAtMs = now;
    this.nextLiveSummaryAtMs = now;
    this.nextLiveAttributionAtMs = now;
    this.latestAttribution = null;
    this.frozenAttribution = null;
    this.frozenGpuVfxReport = null;
    this.frozenFrameSummary = null;
    this.rockDestroyBurstCount = 0;
    this.lastRockDestroyedAtMs = Number.NEGATIVE_INFINITY;
    this.rockDestroyWaveSources.clear();
    this.rockDestroyWaveReasons.clear();
    this.observedScope.clear();
    this.ablationSegments = [];
    this.ablationSegmentMs = 0;
    this.latestSceneInspection = null;
    this.seriesTruncated = false;
    this.pendingGpuQueriesDropped = 0;
    this.disjointGpuSamplesDropped = 0;
    this.pendingSnapshotBytesTotal = 0;
    this.pendingSnapshotBytesMax = 0;
    this.pendingFullSnapshotCount = 0;
    this.pendingDeltaSnapshotCount = 0;
    this.gpuTimerWasEnabled = false;
    this.gpuTimerStatus = this.game ? 'unsupported' : 'unavailable';
    this.gpuVfxSource?.reset();
    this.attributionSource?.resetRecording();
    this.attributionSource?.setRecording(true);
    for (const listener of this.recordingListeners) listener(this.recordingId);
    for (const listener of this.recordingLifecycleListeners) listener(true, this.recordingId);
    this.safeMark(`FD:session:start:${this.sessionId}`);
    this.syncDiagnosticsLifecycle();
  }

  stopRecording(autoStopped = false): void {
    if (!this.recording) return;
    const now = performance.now();
    this.finalizeRockDestroyWave();
    const finalContext = this.pendingContextSample ? sampleContext(this.pendingContextSample) : this.pendingContext;
    if (finalContext && (!this.lastContext || !this.sameContext(this.lastContext, finalContext))) {
      this.observeContext(finalContext, this.pendingContextSampleAtMs || now);
    }
    this.flushSeries(now, true);
    this.frozenFrameSummary = this.buildFrameSummary(true);
    this.frozenGpuVfxReport = this.gpuVfxSource?.build() ?? null;
    this.frozenAttribution = this.attributionSource
      ? { catalog: this.attributionSource.getCatalog(), summary: this.attributionSource.getRecordingSummary() }
      : null;
    this.recording = false;
    this.attributionSource?.setRecording(false);
    for (const listener of this.recordingLifecycleListeners) listener(false, this.recordingId);
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
    if (this.lastContext) {
      const atMs = Math.max(0, performance.now() - this.recordingStartedAtMs);
      const scopes = this.observedScope.get('quality') ?? [];
      const current = scopes[scopes.length - 1];
      if (current) current.toMs = atMs;
      scopes.push({ fromMs: atMs, toMs: null, value: to });
      this.observedScope.set('quality', scopes);
      this.lastContext.quality = to;
    }
  }

  recordSemanticEvent(type: string, fields: Record<string, unknown> = {}): void {
    if (!this.recording) return;
    const atMs = Math.max(0, performance.now() - this.recordingStartedAtMs);
    this.pushEvent({ atMs, type, ...fields });
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

  setAttributionSource(source: ArenaVisualAttributionSource | null): void {
    if (this.attributionSource === source) return;
    this.attributionSource?.setRecording(false);
    this.attributionSource = source;
    this.attributionSource?.setActive(this.diagnosticsActive);
    this.attributionSource?.setRecording(this.recording);
  }

  canExport(): boolean {
    return !this.recording && this.sessionId.length > 0;
  }

  buildReport(): ArenaPerformanceReport | null {
    if (!this.canExport()) return null;
    const durationMs = Math.max(0, this.recordingEndedAtMs - this.recordingStartedAtMs);
    const frameSummary = this.frozenFrameSummary ?? this.buildFrameSummary(true);
    const frozenAttribution = this.frozenAttribution;
    return {
      schemaVersion: 7,
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
        eventsTruncated: this.eventsTruncated,
      },
      environment: { ...this.recordingEnvironment },
      attributionCatalog: frozenAttribution?.catalog ?? this.attributionSource?.getCatalog() ?? null,
      events: this.events.map((event) => ({ ...event })),
      series: {
        sampleIntervalMs: SERIES_INTERVAL_MS,
        samples: this.seriesSamples.map((sample) => ({
          atMs: sample.atMs,
          gauges: { ...sample.gauges },
          interval: { ...sample.interval },
          attribution: sample.attribution
            ? {
              particleFamilies: Object.fromEntries(Object.entries(sample.attribution.particleFamilies)
                .map(([family, gauge]) => [family, { ...gauge }])),
              graphicsFamilies: Object.fromEntries(Object.entries(sample.attribution.graphicsFamilies)
                .map(([family, gauge]) => [family, { ...gauge }])),
              ...(sample.attribution.interval ? {
                interval: {
                  particleSpawns: sample.attribution.interval.particleSpawns
                    ? { ...sample.attribution.interval.particleSpawns } : undefined,
                  graphicsWork: sample.attribution.interval.graphicsWork
                    ? Object.fromEntries(Object.entries(sample.attribution.interval.graphicsWork)
                      .map(([family, work]) => [family, { ...work }])) : undefined,
                },
              } : {}),
            }
            : undefined,
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
          status: this.gpuTimerStatus,
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
        gpuVfx: this.frozenGpuVfxReport ?? null,
        attribution: frozenAttribution,
        sceneInspection: this.latestSceneInspection ? { ...this.latestSceneInspection } : null,
        network: {
          snapshotCount: this.summaryTotal('snapshotCount'),
          logicalSnapshotCount: this.summaryTotal('logicalSnapshotCount'),
          payloadSendCount: this.summaryTotal('payloadSendCount'),
          payloadBytesTotal: this.summaryTotal('payloadBytesTotal'),
          payloadBytesMax: this.summaryMax('payloadBytesMax'),
          snapshotBytesTotal: this.summaryTotal('snapshotBytesTotal'),
          snapshotBytesMax: this.summaryMax('snapshotBytesMax'),
          fullSnapshotCount: this.summaryTotal('fullSnapshotCount'),
          deltaSnapshotCount: this.summaryTotal('deltaSnapshotCount'),
          droppedFastMessages: this.summaryTotal('droppedFastMessages'),
          sentBytes: this.summaryTotal('sentBytes'),
          receivedBytes: this.summaryTotal('receivedBytes'),
        },
        flowfield: {
          requestedUpdates: this.summaryTotal('flowfieldRequestedUpdates'),
          startedJobs: this.summaryTotal('flowfieldJobs'),
          completedJobs: this.summaryTotal('flowfieldCompletedJobs'),
          droppedStale: this.summaryTotal('flowfieldDroppedStale'),
          coalescedJobs: this.summaryTotal('flowfieldCoalescedJobs'),
          skippedUnchangedFields: this.summaryTotal('flowfieldSkippedUnchangedFields'),
          workerComputeTotalMs: this.summaryTotal('computeTotalMs'),
          workerComputeMaxMs: this.summaryMax('computeMaxMs'),
          roundTripTotalMs: this.summaryTotal('roundTripTotalMs'),
          roundTripMaxMs: this.summaryMax('roundTripMaxMs'),
        },
        rocks: {
          dirtyRocks: this.summaryTotal('dirtyRocks'),
          affectedPages: this.summaryTotal('affectedPages'),
          sparseUploads: this.summaryTotal('sparseUploads'),
          fullUploads: this.summaryTotal('fullUploads'),
          uploadBytes: this.summaryTotal('uploadBytes'),
        },
      },
      instrumentation: {
        traceAssistEnabled: true,
        recordingEnabled: true,
        liveHudEnabled: this.liveHudEnabled,
        gpuTimerEnabled: this.gpuTimerWasEnabled,
        drawCallHooksEnabled: false,
        glDiagnosticHooksEnabled: false,
        semanticSamplingHz: 1000 / SERIES_INTERVAL_MS,
        networkBytes: {
          transport: 'exact_webrtc_stats',
          payload: 'estimated_utf16_code_units',
          payloadAggregation: 'per_peer_send',
          logicalSnapshotCounter: 'host_net_tick_or_client_snapshot',
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
    if (this.recording) {
      if (max) {
        this.currentInterval[key] = Math.max(this.currentInterval[key] ?? 0, value);
        this.sessionMaxima.set(key, Math.max(this.sessionMaxima.get(key) ?? 0, value));
      } else {
        this.currentInterval[key] = (this.currentInterval[key] ?? 0) + value;
        this.sessionTotals.set(key, (this.sessionTotals.get(key) ?? 0) + value);
      }
    }
    if (this.liveHudEnabled) {
      if (max) this.liveMaxima.set(key, Math.max(this.liveMaxima.get(key) ?? 0, value));
      else this.liveTotals.set(key, (this.liveTotals.get(key) ?? 0) + value);
    }
  }

  private finalizeRockDestroyWaveIfIdle(now: number): void {
    if (this.rockDestroyBurstCount > 0 && now - this.lastRockDestroyedAtMs > ROCK_DESTROY_WAVE_IDLE_MS) {
      this.finalizeRockDestroyWave();
    }
  }

  private finalizeRockDestroyWave(): void {
    if (this.recording && this.rockDestroyBurstCount >= ROCK_MASS_DESTROY_THRESHOLD) {
      this.recordSemanticEvent('rocks:mass_destroy', {
        destroyedCount: this.rockDestroyBurstCount,
        sources: [...this.rockDestroyWaveSources],
        reasons: [...this.rockDestroyWaveReasons],
      });
    }
    this.rockDestroyBurstCount = 0;
    this.lastRockDestroyedAtMs = Number.NEGATIVE_INFINITY;
    this.rockDestroyWaveSources.clear();
    this.rockDestroyWaveReasons.clear();
  }

  private recordFrameTime(frameMs: number): void {
    const index = this.frameTimeRingIndex;
    if (this.frameTimeRingCount === FRAME_RING_CAPACITY) {
      const retired = this.frameTimeRing[index];
      this.frameTimeRingTotalMs -= retired;
      if (retired > FRAME_OVER_33MS_THRESHOLD) this.frameTimeRingOver33Ms -= 1;
    } else {
      this.frameTimeRingCount += 1;
    }
    this.frameTimeRing[index] = frameMs;
    this.frameTimeRingTotalMs += frameMs;
    if (frameMs > FRAME_OVER_33MS_THRESHOLD) this.frameTimeRingOver33Ms += 1;
    this.frameTimeRingIndex = (index + 1) % FRAME_RING_CAPACITY;

    const bucket = Math.min(
      FRAME_HISTOGRAM_BUCKET_COUNT - 1,
      Math.max(0, Math.floor(frameMs / FRAME_HISTOGRAM_BUCKET_MS)),
    );
    if (this.recording) {
      this.frameTimeHistogram[bucket] += 1;
      this.frameTimeHistogramTotal += 1;
    }
    if (this.liveHudEnabled) {
      this.liveFrameTimeHistogram[bucket] += 1;
      this.liveFrameTimeHistogramTotal += 1;
    }
  }

  private frameRingSummary(p95: number, p99: number): MetricSummary {
    if (this.frameTimeRingCount === 0) return emptyMetricSummary();
    let peak = 0;
    for (let offset = 0; offset < this.frameTimeRingCount; offset += 1) {
      peak = Math.max(peak, this.frameTimeRing[(this.frameTimeRingIndex - this.frameTimeRingCount + offset + FRAME_RING_CAPACITY) % FRAME_RING_CAPACITY]);
    }
    return {
      avg: this.frameTimeRingTotalMs / this.frameTimeRingCount,
      p95,
      p99,
      peak,
    };
  }

  private histogramPercentile(fraction: number, recording = true): number {
    const histogram = recording ? this.frameTimeHistogram : this.liveFrameTimeHistogram;
    const total = recording ? this.frameTimeHistogramTotal : this.liveFrameTimeHistogramTotal;
    if (total === 0) return 0;
    const target = Math.max(1, Math.ceil(total * fraction));
    let cumulative = 0;
    for (let index = 0; index < histogram.length; index += 1) {
      cumulative += histogram[index];
      if (cumulative >= target) {
        return (index + 0.5) * FRAME_HISTOGRAM_BUCKET_MS;
      }
    }
    return FRAME_HISTOGRAM_BUCKET_COUNT * FRAME_HISTOGRAM_BUCKET_MS;
  }

  private flushSeries(now: number, final = false): void {
    if (!this.recording) return;
    const atMs = Math.max(0, now - this.recordingStartedAtMs);
    this.latestAttribution = this.attributionSource?.sampleAndReset() ?? null;
    if (this.seriesSamples.length >= MAX_SERIES_SAMPLES) {
      this.seriesSamples.shift();
      this.seriesTruncated = true;
    }
    this.seriesSamples.push({
      atMs,
      gauges: { ...this.latestGauges },
      interval: { ...this.currentInterval },
      attribution: this.latestAttribution ?? undefined,
    });
    this.currentInterval = {};
    this.nextSeriesAtMs = final ? Number.POSITIVE_INFINITY : now + SERIES_INTERVAL_MS;
  }

  private emitSessionSyncIfDue(now: number): void {
    if (now < this.nextSyncAtMs) return;
    const elapsedMs = Math.max(0, Math.round(now - this.recordingStartedAtMs));
    const marker = `FD:session:sync:${this.sessionId}:${elapsedMs}`;
    this.safeMark(marker);
    this.pushEvent({ atMs: elapsedMs, type: 'session_sync', marker });
    this.syncMarkerCount += 1;
    this.nextSyncAtMs = now + SESSION_SYNC_INTERVAL_MS;
  }

  private observeContext(context: Record<string, unknown>, now: number): void {
    if (!this.recording) return;
    const atMs = Math.max(0, now - this.recordingStartedAtMs);
    if (this.lastContext) {
      for (const key of new Set([...Object.keys(this.lastContext), ...Object.keys(context)])) {
        if (this.lastContext[key] === context[key]) continue;
        this.applyContextValue(key, context[key] ?? null, atMs, this.lastContext[key] ?? null);
      }
    }
    if (!this.lastContext) {
      for (const [key, value] of Object.entries(context)) this.observedScope.set(key, [{ fromMs: 0, toMs: null, value }]);
    }
    this.lastContext = context;
  }

  private applyContextValue(key: string, value: unknown, atMs: number, from: unknown): void {
    this.pushEvent({ atMs, type: 'context_change', scope: key, from, to: value });
    this.safeMark('FD:context:change');
    const scopes = this.observedScope.get(key) ?? [];
    const current = scopes[scopes.length - 1];
    if (current) current.toMs = atMs;
    scopes.push({ fromMs: atMs, toMs: null, value });
    this.observedScope.set(key, scopes);
  }

  private sameContext(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) if (left[key] !== right[key]) return false;
    return true;
  }

  private pushEvent(event: CompanionEvent): void {
    if (this.events.length >= MAX_EVENTS) {
      this.events.shift();
      this.eventsTruncated = true;
    }
    this.events.push(event);
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

  private buildFrameSummary(recording = this.recording): ArenaPerformanceReport['summaries']['frame'] {
    const frameCount = this.summaryTotal('frameCount', recording);
    const total = this.summaryTotal('frameTimeTotalMs', recording);
    const slow = this.summaryTotal('slowFrameCount', recording);
    return {
      frameCount,
      frameTimeTotalMs: total,
      frameTimeMaxMs: this.summaryMax('frameTimeMaxMs', recording),
      slowFrameCount: slow,
      p95Ms: this.histogramPercentile(0.95, recording),
      p99Ms: this.histogramPercentile(0.99, recording),
      fps: total > 0 ? frameCount * 1000 / total : 0,
      slowFramePercent: frameCount > 0 ? slow / frameCount * 100 : 0,
    };
  }

  private buildLiveSummary(now: number, sample: ArenaRuntimeSample): ArenaRuntimeWindowSummary {
    const frame = this.buildFrameSummary(this.recording);
    const liveRawDelta = this.frameRingSummary(frame.p95Ms, frame.p99Ms);
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
      over33msPercent: this.frameTimeRingCount > 0 ? this.frameTimeRingOver33Ms / this.frameTimeRingCount * 100 : 0,
      timings: {
        rawDeltaMs: liveRawDelta,
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

  private summaryTotal(key: string, recording = true): number {
    return (recording ? this.sessionTotals : this.liveTotals).get(key) ?? 0;
  }

  private summaryMax(key: string, recording = true): number {
    return (recording ? this.sessionMaxima : this.liveMaxima).get(key) ?? 0;
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
    this.attributionSource?.setActive(active);
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
    if (this.gpuTimer) {
      this.gpuTimerWasEnabled = true;
      this.gpuTimerStatus = 'supported';
      return;
    }
    if (!this.game || typeof WebGL2RenderingContext === 'undefined') {
      this.gpuTimerStatus = this.game ? 'unsupported' : 'unavailable';
      return;
    }
    const gl = (this.game.renderer as { gl?: WebGLRenderingContext }).gl;
    if (!(gl instanceof WebGL2RenderingContext)) {
      this.gpuTimerStatus = 'unsupported';
      return;
    }
    const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!extension) {
      this.gpuTimerStatus = 'unsupported';
      return;
    }
    this.gpuTimer = { gl, extension };
    this.gpuTimerWasEnabled = true;
    this.gpuTimerStatus = 'supported';
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
