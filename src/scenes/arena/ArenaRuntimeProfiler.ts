import type * as Phaser from 'phaser';
import {
  DEBUG_RUNTIME_PERF_METRICS,
  DEBUG_RUNTIME_PERF_METRICS_WINDOW_MS,
} from '../../config';
import type { GraphicsQuality } from '../../graphics/GraphicsQuality';

const MAX_RECORDING_MS = 30 * 60 * 1000;
const MAX_RAW_FRAME_SAMPLES = 60_000;
const MEMORY_SAMPLE_INTERVAL_MS = 1000;
const GPU_QUERY_INTERVAL_FRAMES = 4;
const MAX_PENDING_GPU_QUERIES = 16;
const MAX_EVENT_TIMING_SAMPLES = 5_000;
const GAME_PRE_STEP_EVENT = 'prestep';
const GAME_STEP_EVENT = 'step';
const GAME_POST_STEP_EVENT = 'poststep';
const GAME_PRE_RENDER_EVENT = 'prerender';
const GAME_POST_RENDER_EVENT = 'postrender';

/**
 * Phaser 4 fuehrt fuer WebGL keinen Draw-Call-Zaehler: `drawCount` existiert nur am
 * CanvasRenderer, und der RenderNodeManager bietet nur einen Debug-Graphen fuer einen Einzelframe.
 * Die Zeichenaufrufe werden deshalb am GL-Kontext gezaehlt. Die Wrapper liegen als eigene
 * Eigenschaft auf dem Kontext und verdecken die Prototyp-Methode, `delete` stellt sie wieder her.
 */
const GL_DRAW_METHODS = [
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
  'drawRangeElements',
] as const;

type GlContext = WebGLRenderingContext | WebGL2RenderingContext;
export type RuntimePhase = 'lobby' | 'arena' | 'terminated';

const GL_DIAGNOSTIC_METHODS = [
  'bindFramebuffer',
  'useProgram',
  'texImage2D',
  'texSubImage2D',
  'bufferData',
  'bufferSubData',
] as const;

type GlDiagnosticMethod = typeof GL_DIAGNOSTIC_METHODS[number];

export type DetailTimingKey =
  | 'scenePreludeMs'
  | 'sceneStateMs'
  | 'postRoleMs'
  | 'diagnosticsMs'
  | 'inputCameraMs'
  | 'lobbyUiMs'
  | 'arenaHudMs'
  | 'leaderboardCanopyMs'
  | 'arenaPanelMs'
  | 'hostCoordinatorMs'
  | 'hostEnemyAiMs'
  | 'hostPlayerSystemsMs'
  | 'hostPhysicsMs'
  | 'hostCombatProjectilesMs'
  | 'hostExplosionsMs'
  | 'hostAreaEffectsMs'
  | 'hostWorldVisualsMs'
  | 'hostHudMs'
  | 'hostEffectFlushMs'
  | 'hostSnapshotBuildMs'
  | 'clientCoordinatorMs'
  | 'clientSnapshotMs'
  | 'clientPlayersMs'
  | 'clientProjectilesEffectsMs'
  | 'clientWorldStateMs'
  | 'clientInterpolationMs'
  | 'clientHudMs'
  | 'clientRendererSyncMs'
  | 'clientPostSyncMs'
  | 'aimPreviewMs'
  | 'aimGraphicsMs'
  | 'scopeMs'
  | 'scopeRasterMs'
  | 'scopeUploadMs'
  | 'aimIndicatorsMs'
  | 'lightingExpireMs'
  | 'lightingQueueMs'
  | 'lightingCommandBuildMs'
  | 'lightingDirectMs'
  | 'lightingOcclusionMs'
  | 'lightingShadowGeometryMs'
  | 'sceneCountScanMs'
  | 'sceneBreakdownScanMs'
  | 'transportSampleMs';

export type DetailCountKey =
  | 'willRenderObjectCount'
  | 'inCameraBoundsObjectCount'
  | 'hiddenObjectCount'
  | 'internalFilterCount'
  | 'externalFilterCount'
  | 'filteredObjectCount'
  | 'cameraFilterCount'
  | 'framebufferBindCount'
  | 'programSwitchCount'
  | 'textureUploadCount'
  | 'textureUploadPixels'
  | 'bufferUploadCount'
  | 'aimGraphicsCommandCount'
  | 'scopeRefreshCount'
  | 'scopeTexturePixels'
  | 'directLightCount'
  | 'occludingLightCount'
  | 'fallbackOccludingLightCount'
  | 'radialLightCount'
  | 'coneLightCount'
  | 'lightShadowQuadCount'
  | 'lightFalloffQuadCount'
  | 'lightingCommandCount'
  | 'lightMapPixelCount'
  | 'lightingScratchPixelCount'
  | 'newNetworkSnapshotCount'
  | 'hostNetworkTickCount'
  | 'hostExplosionEventCount'
  | 'transportLinkCount'
  | 'transportBackpressureLinkCount'
  | 'transportReliableBufferedBytes'
  | 'transportFastBufferedBytes'
  | 'transportDroppedFastMessages'
  | 'transportSentBytesPerSec'
  | 'transportReceivedBytesPerSec'
  | 'transportMedianRttMs'
  | 'transportMedianAppPingMs';

export interface ArenaRuntimeDetails {
  timings?: Partial<Record<DetailTimingKey, number>>;
  counts?: Partial<Record<DetailCountKey, number>>;
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

export interface ArenaRuntimeSample {
  role: 'host' | 'client';
  phase: RuntimePhase;
  quality: GraphicsQuality;
  mode: string;
  mapId: string | null;
  /** Unglaettete reale Zeit seit dem vorherigen Phaser-Step. */
  rawDeltaMs: number;
  /** Von Phaser geglaettetes Spiel-Delta. Nicht fuer echte FPS oder Hiccup-Spitzen verwenden. */
  deltaMs: number;
  updateMs: number;
  /** Vorheriger vollstaendig abgeschlossener Phaser-Frame. */
  gameStepMs: number;
  phaserSceneUpdateMs: number;
  phaserSceneSystemsMs: number;
  rendererSetupMs: number;
  betweenFramesMs: number;
  /** Vorheriger Frame: `update` laeuft vor `render`, der Wert stammt aus dem letzten postrender. */
  renderSubmitMs: number;
  roleStepMs: number;
  networkUpdateMs: number;
  networkFlushMs: number;
  /** Summe der fuenf `visual*`-Buckets darunter. */
  visualStepMs: number;
  visualCameraMs: number;
  visualEnemyMs: number;
  visualEffectsMs: number;
  visualAimMs: number;
  visualHudMs: number;
  shadowStepMs: number;
  lightingStepMs: number;
  /** Teilkosten von `roleStepMs`, nicht additiv zum Update-Budget. */
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
  /** Zeichenaufrufe des vorherigen Frames. 0, solange die Zaehlung nicht aktiv ist. */
  drawCallCount: number;
  details?: ArenaRuntimeDetails;
  context?: ArenaRuntimeContext;
  lightPresetCounts?: Readonly<Record<string, number>>;
  filterBreakdown?: string | null;
  sceneBreakdown?: string | null;
}

/** Vom Profiler abgeleitete Restposten, die zeigen, wie viel Zeit keine Instrumentierung erfasst. */
interface DerivedSampleTimings {
  /** `updateMs` minus aller instrumentierten Teilschritte des Frames. */
  unaccountedUpdateMs: number;
  /** Ueberlappende Teilmessungen, falls die Summe groesser als `updateMs` ist. */
  overaccountedUpdateMs: number;
  /** Gemessener CPU-Spielschritt minus SceneManager, Renderer-Setup und Render-Abgabe. */
  unaccountedFrameMs: number;
  overaccountedFrameMs: number;
}

interface RecordedSample extends ArenaRuntimeSample, DerivedSampleTimings {
  atMs: number;
  detailTimings: Record<DetailTimingKey, number>;
  detailCounts: Record<DetailCountKey, number>;
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
  sampleCount: number;
  /** Aus dem unglaetteten Phaser-`rawDelta`. */
  fps: number;
  /** Nur zum Vergleich mit dem Spielgefuehl: aus Phasers geglaettetem `delta`. */
  smoothedFps: number;
  /**
   * Anteil der Fensterdauer, der wirklich gesampelt wurde. Unter 100 bedeutet, dass `record()`
   * zeitweise nicht lief (Runde beendet, Tab inaktiv) und `fps` den Zeitraum nicht beschreibt.
   */
  coveragePercent: number;
  /** Groesste Luecke zwischen zwei Samples, inklusive des Endes bis zum Fensterschluss. */
  maxSampleGapMs: number;
  over16msPercent: number;
  over33msPercent: number;
  timings: Record<TimingKey, MetricSummary>;
  counts: Record<CountKey, { avg: number; peak: number }>;
  detailTimings: Record<DetailTimingKey, MetricSummary>;
  detailCounts: Record<DetailCountKey, { avg: number; peak: number }>;
  lightingPresets: Record<string, { avg: number; peak: number }>;
  filterBreakdown: string | null;
  sceneBreakdown: string | null;
}

export interface PerformanceQualityChange {
  atMs: number;
  from: GraphicsQuality;
  to: GraphicsQuality;
}

/** Aus den erfassten Fenstern abgeleitet, damit der Kopf des Reports nicht veralten kann. */
export interface PerformanceRecordingScope {
  roles: ('host' | 'client')[];
  phases: RuntimePhase[];
  qualities: GraphicsQuality[];
  modes: string[];
  mapIds: (string | null)[];
}

export interface PerformanceContextChange extends ArenaRuntimeContext {
  atMs: number;
  phase: RuntimePhase;
  role: 'host' | 'client';
  quality: GraphicsQuality;
  mode: string;
  mapId: string | null;
}

export interface PerformanceLongTask {
  startMs: number;
  durationMs: number;
  frameIndex: number | null;
  phase: RuntimePhase | null;
  role: 'host' | 'client' | null;
  rawDeltaMs: number | null;
  updateMs: number | null;
  attribution: Array<{
    name: string;
    entryType: string;
    containerType: string | null;
    containerName: string | null;
    containerId: string | null;
    containerSrc: string | null;
  }>;
}

export interface PerformanceMemorySample {
  atMs: number;
  usedJsHeapBytes: number;
  totalJsHeapBytes: number;
  jsHeapLimitBytes: number;
}

export interface PerformanceGcSample {
  atMs: number;
  durationMs: number;
  kind: number | null;
}

export interface PerformanceLongAnimationFrame {
  startMs: number;
  durationMs: number;
  blockingDurationMs: number;
  renderStartMs: number | null;
  styleAndLayoutStartMs: number | null;
  firstUiEventMs: number | null;
  frameIndex: number | null;
  phase: RuntimePhase | null;
  role: 'host' | 'client' | null;
  scripts: Array<{
    durationMs: number;
    executionStartMs: number | null;
    forcedStyleAndLayoutMs: number;
    pauseMs: number;
    invoker: string;
    invokerType: string;
    source: string;
    functionName: string;
  }>;
}

export interface PerformanceEventTimingSample {
  startMs: number;
  durationMs: number;
  inputDelayMs: number;
  processingMs: number;
  presentationDelayMs: number;
  name: string;
  interactionId: number | null;
}

export interface PerformanceLifecycleEvent {
  atMs: number;
  type: 'visibility' | 'focus' | 'blur';
  value: string;
}

export interface PerformanceGpuSample {
  atMs: number;
  renderFrame: number;
  durationMs: number;
}

export interface ArenaPerformanceReport {
  schemaVersion: 4;
  /** Laufende Nummer der Messung. Zwei Exporte derselben Messung tragen dieselbe Nummer. */
  recordingId: number;
  createdAt: string;
  recordingStartedAt: string;
  recordingEndedAt: string;
  autoStopped: boolean;
  /** Geraetedaten, aufgenommen beim Start der Messung. Enthaelt keine Laufzeitzustaende. */
  environment: Record<string, unknown>;
  recordingScope: PerformanceRecordingScope;
  qualityChanges: PerformanceQualityChange[];
  windows: ArenaRuntimeWindowSummary[];
  contextChanges: PerformanceContextChange[];
  frameSeries: {
    columns: string[];
    rows: number[][];
    phaseCodes: Record<RuntimePhase, number>;
    maxRows: number;
    truncated: boolean;
  };
  longTasks: PerformanceLongTask[];
  longAnimationFrames: PerformanceLongAnimationFrame[];
  eventTimings: PerformanceEventTimingSample[];
  memorySamples: PerformanceMemorySample[];
  gcSamples: PerformanceGcSample[];
  lifecycleEvents: PerformanceLifecycleEvent[];
  gpu: {
    status: 'supported' | 'unsupported' | 'unavailable';
    sampleEveryFrames: number;
    pendingQueriesDropped: number;
    disjointSamplesDropped: number;
    samples: PerformanceGpuSample[];
  };
  instrumentation: {
    drawCallHooks: boolean;
    glDiagnosticHooks: boolean;
    rawFrameLimit: number;
    eventTimingLimit: number;
    eventTimingsTruncated: boolean;
    profilerRecordMs: MetricSummary;
    observability: {
      longTasks: 'supported' | 'unsupported' | 'unavailable';
      longAnimationFrames: 'supported' | 'unsupported' | 'unavailable';
      eventTiming: 'supported' | 'unsupported' | 'unavailable';
      gc: 'supported' | 'unsupported' | 'unavailable';
      memory: 'supported' | 'unsupported';
      gpuTimer: 'supported' | 'unsupported' | 'unavailable';
    };
  };
}

export type TimingKey =
  | 'rawDeltaMs'
  | 'deltaMs'
  | 'updateMs'
  | 'gameStepMs'
  | 'phaserSceneUpdateMs'
  | 'phaserSceneSystemsMs'
  | 'rendererSetupMs'
  | 'betweenFramesMs'
  | 'renderSubmitMs'
  | 'unaccountedFrameMs'
  | 'roleStepMs'
  | 'networkUpdateMs'
  | 'networkFlushMs'
  | 'visualStepMs'
  | 'visualCameraMs'
  | 'visualEnemyMs'
  | 'visualEffectsMs'
  | 'visualAimMs'
  | 'visualHudMs'
  | 'shadowStepMs'
  | 'lightingStepMs'
  | 'unaccountedUpdateMs'
  | 'overaccountedUpdateMs'
  | 'overaccountedFrameMs'
  | 'fireSimulationMs'
  | 'fireCreationMs'
  | 'fireVisualMs';

export type CountKey =
  | 'enemyCount'
  | 'projectileCount'
  | 'playerCount'
  | 'displayObjectCount'
  | 'visibleObjectCount'
  | 'particleEmitterCount'
  | 'aliveParticleCount'
  | 'activeFilterCount'
  | 'activeLightCount'
  | 'renderedLightCount'
  | 'drawCallCount';

const TIMING_KEYS: readonly TimingKey[] = [
  'rawDeltaMs', 'deltaMs', 'updateMs',
  'gameStepMs', 'phaserSceneUpdateMs', 'phaserSceneSystemsMs', 'rendererSetupMs', 'betweenFramesMs',
  'renderSubmitMs', 'unaccountedFrameMs',
  'roleStepMs', 'networkUpdateMs', 'networkFlushMs',
  'visualStepMs', 'visualCameraMs', 'visualEnemyMs', 'visualEffectsMs', 'visualAimMs', 'visualHudMs',
  'shadowStepMs', 'lightingStepMs', 'unaccountedUpdateMs', 'overaccountedUpdateMs', 'overaccountedFrameMs',
  'fireSimulationMs', 'fireCreationMs', 'fireVisualMs',
];

export const DETAIL_TIMING_KEYS: readonly DetailTimingKey[] = [
  'scenePreludeMs', 'sceneStateMs', 'postRoleMs', 'diagnosticsMs',
  'inputCameraMs', 'lobbyUiMs', 'arenaHudMs', 'leaderboardCanopyMs', 'arenaPanelMs',
  'hostCoordinatorMs', 'hostEnemyAiMs', 'hostPlayerSystemsMs', 'hostPhysicsMs',
  'hostCombatProjectilesMs', 'hostExplosionsMs', 'hostAreaEffectsMs', 'hostWorldVisualsMs',
  'hostHudMs', 'hostEffectFlushMs', 'hostSnapshotBuildMs',
  'clientCoordinatorMs', 'clientSnapshotMs', 'clientPlayersMs', 'clientProjectilesEffectsMs',
  'clientWorldStateMs', 'clientInterpolationMs', 'clientHudMs', 'clientRendererSyncMs', 'clientPostSyncMs',
  'aimPreviewMs', 'aimGraphicsMs', 'scopeMs', 'scopeRasterMs', 'scopeUploadMs', 'aimIndicatorsMs',
  'lightingExpireMs', 'lightingQueueMs', 'lightingCommandBuildMs', 'lightingDirectMs',
  'lightingOcclusionMs', 'lightingShadowGeometryMs',
  'sceneCountScanMs', 'sceneBreakdownScanMs', 'transportSampleMs',
];

const COUNT_KEYS: readonly CountKey[] = [
  'enemyCount', 'projectileCount', 'playerCount', 'displayObjectCount', 'visibleObjectCount',
  'particleEmitterCount', 'aliveParticleCount', 'activeFilterCount', 'activeLightCount', 'renderedLightCount',
  'drawCallCount',
];

export const DETAIL_COUNT_KEYS: readonly DetailCountKey[] = [
  'willRenderObjectCount', 'inCameraBoundsObjectCount', 'hiddenObjectCount',
  'internalFilterCount', 'externalFilterCount', 'filteredObjectCount', 'cameraFilterCount',
  'framebufferBindCount', 'programSwitchCount', 'textureUploadCount', 'textureUploadPixels', 'bufferUploadCount',
  'aimGraphicsCommandCount', 'scopeRefreshCount', 'scopeTexturePixels',
  'directLightCount', 'occludingLightCount', 'fallbackOccludingLightCount', 'radialLightCount', 'coneLightCount',
  'lightShadowQuadCount', 'lightFalloffQuadCount', 'lightingCommandCount',
  'lightMapPixelCount', 'lightingScratchPixelCount', 'newNetworkSnapshotCount',
  'hostNetworkTickCount', 'hostExplosionEventCount',
  'transportLinkCount', 'transportBackpressureLinkCount',
  'transportReliableBufferedBytes', 'transportFastBufferedBytes', 'transportDroppedFastMessages',
  'transportSentBytesPerSec', 'transportReceivedBytesPerSec',
  'transportMedianRttMs', 'transportMedianAppPingMs',
];

interface RuntimeWindow {
  startedAtMs: number;
  role: 'host' | 'client';
  phase: RuntimePhase;
  quality: GraphicsQuality;
  mode: string;
  mapId: string | null;
  samples: RecordedSample[];
  latestSceneBreakdown: string | null;
  latestFilterBreakdown: string | null;
  lastSampleAtMs: number;
  maxSampleGapMs: number;
}

/**
 * Restposten des Update-Budgets. `fire*` bleibt aussen vor: die Feuerkosten laufen innerhalb des
 * Host-Schritts und wuerden sonst doppelt zaehlen.
 */
function deriveSampleTimings(
  sample: ArenaRuntimeSample,
  details: Readonly<Record<DetailTimingKey, number>>,
): DerivedSampleTimings {
  const accountedUpdateMs = details.scenePreludeMs
    + sample.networkUpdateMs
    + details.sceneStateMs
    + sample.roleStepMs
    + details.postRoleMs
    + sample.networkFlushMs
    + sample.visualStepMs
    + sample.shadowStepMs
    + sample.lightingStepMs
    + details.diagnosticsMs;
  const updateDifferenceMs = sample.updateMs - accountedUpdateMs;
  const frameDifferenceMs = sample.gameStepMs
    - sample.phaserSceneUpdateMs
    - sample.rendererSetupMs
    - sample.renderSubmitMs;
  return {
    unaccountedUpdateMs: Math.max(0, updateDifferenceMs),
    overaccountedUpdateMs: Math.max(0, -updateDifferenceMs),
    unaccountedFrameMs: Math.max(0, frameDifferenceMs),
    overaccountedFrameMs: Math.max(0, -frameDifferenceMs),
  };
}

const PHASE_CODES: Record<RuntimePhase, number> = {
  lobby: 0,
  arena: 1,
  terminated: 2,
};

const FRAME_SERIES_COLUMNS = [
  'atMs',
  'phaseCode',
  ...TIMING_KEYS,
  ...COUNT_KEYS,
  ...DETAIL_TIMING_KEYS.map((key) => `detail.${key}`),
  ...DETAIL_COUNT_KEYS.map((key) => `detail.${key}`),
  'context.localAlive',
  'context.aimVisible',
  'context.scopeActive',
  'context.utilityPlacementActive',
  'context.ultimatePlacementActive',
  'context.optionsOpen',
  'context.pageVisible',
  'context.documentFocused',
  'context.roundElapsedMs',
] as const;

function normalizeDetailTimings(details: ArenaRuntimeDetails | undefined): Record<DetailTimingKey, number> {
  const result = {} as Record<DetailTimingKey, number>;
  for (const key of DETAIL_TIMING_KEYS) result[key] = details?.timings?.[key] ?? 0;
  return result;
}

function normalizeDetailCounts(details: ArenaRuntimeDetails | undefined): Record<DetailCountKey, number> {
  const result = {} as Record<DetailCountKey, number>;
  for (const key of DETAIL_COUNT_KEYS) result[key] = details?.counts?.[key] ?? 0;
  return result;
}

function contextsEqual(left: PerformanceContextChange | null, right: PerformanceContextChange): boolean {
  if (!left) return false;
  for (const key of Object.keys(right) as Array<keyof PerformanceContextChange>) {
    if (key === 'atMs') continue;
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function uniqueInOrder<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function summarizeMetric(values: number[]): MetricSummary {
  if (values.length === 0) return { avg: 0, p95: 0, p99: 0, peak: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    avg: sum / values.length,
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    peak: sorted[sorted.length - 1],
  };
}

interface GlFrameDiagnostics {
  framebufferBindCount: number;
  programSwitchCount: number;
  textureUploadCount: number;
  textureUploadPixels: number;
  bufferUploadCount: number;
}

interface GpuTimerSupport {
  gl: WebGL2RenderingContext;
  extension: {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  };
}

interface PendingGpuQuery {
  query: WebGLQuery;
  atMs: number;
  renderFrame: number;
}

function emptyGlFrameDiagnostics(): GlFrameDiagnostics {
  return {
    framebufferBindCount: 0,
    programSwitchCount: 0,
    textureUploadCount: 0,
    textureUploadPixels: 0,
    bufferUploadCount: 0,
  };
}

function estimateTextureUploadPixels(method: GlDiagnosticMethod, args: unknown[]): number {
  const numericWidthIndex = method === 'texImage2D' ? 3 : 4;
  const width = args[numericWidthIndex];
  const height = args[numericWidthIndex + 1];
  if (typeof width === 'number' && typeof height === 'number') return Math.max(0, width * height);

  for (let index = args.length - 1; index >= 0; index -= 1) {
    const source = args[index] as { width?: unknown; height?: unknown } | null;
    if (
      source
      && typeof source === 'object'
      && typeof source.width === 'number'
      && typeof source.height === 'number'
    ) {
      return Math.max(0, source.width * source.height);
    }
  }
  return 0;
}

export interface PhaserFrameLifecycleMetrics {
  gameStepMs: number;
  sceneManagerUpdateMs: number;
  sceneSystemsAndPluginsMs: number;
  rendererSetupMs: number;
  betweenFramesMs: number;
}

function emptyPhaserFrameLifecycleMetrics(): PhaserFrameLifecycleMetrics {
  return {
    gameStepMs: 0,
    sceneManagerUpdateMs: 0,
    sceneSystemsAndPluginsMs: 0,
    rendererSetupMs: 0,
    betweenFramesMs: 0,
  };
}

type ObserverSupport = 'supported' | 'unsupported' | 'unavailable';

function getObserverSupport(entryType: string): ObserverSupport {
  if (typeof PerformanceObserver === 'undefined') return 'unavailable';
  const supported = PerformanceObserver.supportedEntryTypes;
  if (!Array.isArray(supported)) return 'unsupported';
  return supported.includes(entryType) ? 'supported' : 'unsupported';
}

function sanitizeSourceUrl(sourceUrl: string): string {
  if (!sourceUrl) return '';
  try {
    const parsed = new URL(sourceUrl, typeof document === 'undefined' ? 'http://local/' : document.baseURI);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.slice(-2).join('/');
  } catch {
    return sourceUrl.split(/[?#]/, 1)[0].slice(-160);
  }
}

export class ArenaRuntimeProfiler {
  private metricsWindow: RuntimeWindow | null = null;
  private latestSummary: ArenaRuntimeWindowSummary | null = null;
  private recording = false;
  private recordingStartedEpochMs = 0;
  private recordingStartedAtMs = 0;
  private recordingEndedEpochMs = 0;
  private recordingId = 0;
  private recordingEnvironment: Record<string, unknown> = {};
  private autoStopped = false;
  private readonly recordedWindows: ArenaRuntimeWindowSummary[] = [];
  private readonly qualityChanges: PerformanceQualityChange[] = [];
  private readonly contextChanges: PerformanceContextChange[] = [];
  private readonly rawFrameRows: number[][] = [];
  private rawFrameRowsTruncated = false;
  private readonly longTasks: PerformanceLongTask[] = [];
  private readonly longAnimationFrames: PerformanceLongAnimationFrame[] = [];
  private readonly eventTimings: PerformanceEventTimingSample[] = [];
  private eventTimingsTruncated = false;
  private readonly memorySamples: PerformanceMemorySample[] = [];
  private readonly gcSamples: PerformanceGcSample[] = [];
  private nextMemorySampleAtMs = 0;
  private readonly lifecycleEvents: PerformanceLifecycleEvent[] = [];
  private readonly gpuSamples: PerformanceGpuSample[] = [];
  private readonly profilerRecordCostsMs: number[] = [];
  private longTaskObserver: PerformanceObserver | null = null;
  private longAnimationFrameObserver: PerformanceObserver | null = null;
  private eventTimingObserver: PerformanceObserver | null = null;
  private gcObserver: PerformanceObserver | null = null;
  private latestRecordedSample: RecordedSample | null = null;
  private renderStartedAtMs = 0;
  private lastRenderSubmitMs = 0;
  private preStepStartedAtMs = 0;
  private sceneManagerStartedAtMs = 0;
  private postStepAtMs = 0;
  private lastPostRenderAtMs = 0;
  private previousSceneUpdateMs = 0;
  private currentBetweenFramesMs = 0;
  private currentSceneManagerUpdateMs = 0;
  private currentRendererSetupMs = 0;
  private lastFrameLifecycle = emptyPhaserFrameLifecycleMetrics();
  private originalLoopCallback: ((time: number, delta: number) => void) | null = null;
  private wrappedLoopCallback: ((time: number, delta: number) => void) | null = null;
  private lastLoopCallbackEndedAtMs = 0;
  private game: Phaser.Game | null = null;
  private glContext: GlContext | null = null;
  private drawCallHooksInstalled = false;
  private glDiagnosticHooksInstalled = false;
  private recordingUsedDrawCallHooks = false;
  private recordingUsedGlDiagnosticHooks = false;
  private liveDrawCallTracking = false;
  private frameDrawCallCount = 0;
  private lastFrameDrawCallCount = 0;
  private frameGlDiagnostics = emptyGlFrameDiagnostics();
  private lastFrameGlDiagnostics = emptyGlFrameDiagnostics();
  private lastGlProgram: unknown = undefined;
  private gpuTimer: GpuTimerSupport | null = null;
  private activeGpuQuery: PendingGpuQuery | null = null;
  private readonly pendingGpuQueries: PendingGpuQuery[] = [];
  private renderFrame = 0;
  private pendingGpuQueriesDropped = 0;
  private disjointGpuSamplesDropped = 0;

  private readonly onPreStep = (): void => {
    const now = performance.now();
    this.currentBetweenFramesMs = this.lastPostRenderAtMs > 0 ? Math.max(0, now - this.lastPostRenderAtMs) : 0;
    this.preStepStartedAtMs = now;
  };

  private readonly onStep = (): void => {
    this.sceneManagerStartedAtMs = performance.now();
  };

  private readonly onPostStep = (): void => {
    const now = performance.now();
    this.currentSceneManagerUpdateMs = this.sceneManagerStartedAtMs > 0
      ? Math.max(0, now - this.sceneManagerStartedAtMs)
      : 0;
    this.postStepAtMs = now;
  };

  private readonly onVisibilityChange = (): void => {
    this.recordLifecycleEvent('visibility', typeof document === 'undefined' ? 'unknown' : document.visibilityState);
  };

  private readonly onFocus = (): void => {
    this.recordLifecycleEvent('focus', 'focused');
  };

  private readonly onBlur = (): void => {
    this.recordLifecycleEvent('blur', 'blurred');
  };

  private readonly onPreRender = (): void => {
    const now = performance.now();
    this.currentRendererSetupMs = this.postStepAtMs > 0 ? Math.max(0, now - this.postStepAtMs) : 0;
    this.renderStartedAtMs = now;
    this.frameDrawCallCount = 0;
    this.frameGlDiagnostics = emptyGlFrameDiagnostics();
    this.renderFrame += 1;
    this.pollGpuQueries();
    this.beginGpuQuery();
  };

  private readonly onPostRender = (): void => {
    const now = performance.now();
    this.endGpuQuery();
    this.lastFrameDrawCallCount = this.frameDrawCallCount;
    this.lastFrameGlDiagnostics = { ...this.frameGlDiagnostics };
    if (this.renderStartedAtMs <= 0) return;
    this.lastRenderSubmitMs = now - this.renderStartedAtMs;
    this.lastFrameLifecycle = {
      gameStepMs: this.preStepStartedAtMs > 0 ? Math.max(0, now - this.preStepStartedAtMs) : 0,
      sceneManagerUpdateMs: this.currentSceneManagerUpdateMs,
      sceneSystemsAndPluginsMs: Math.max(0, this.currentSceneManagerUpdateMs - this.previousSceneUpdateMs),
      rendererSetupMs: this.currentRendererSetupMs,
      betweenFramesMs: this.currentBetweenFramesMs,
    };
    this.lastPostRenderAtMs = now;
    this.renderStartedAtMs = 0;
  };

  attachGame(game: Phaser.Game): void {
    if (this.game === game) return;
    this.detachGame();
    this.game = game;
    this.glContext = (game.renderer as { gl?: GlContext }).gl ?? null;
    const loop = (game as Phaser.Game & {
      loop?: { callback?: (time: number, delta: number) => void };
    }).loop;
    if (loop && typeof loop.callback === 'function') {
      this.originalLoopCallback = loop.callback;
      this.wrappedLoopCallback = (time: number, delta: number): void => {
        const startedAt = performance.now();
        const betweenFramesMs = this.lastLoopCallbackEndedAtMs > 0
          ? Math.max(0, startedAt - this.lastLoopCallbackEndedAtMs)
          : 0;
        this.originalLoopCallback?.(time, delta);
        const endedAt = performance.now();
        this.lastFrameLifecycle = {
          ...this.lastFrameLifecycle,
          gameStepMs: Math.max(0, endedAt - startedAt),
          betweenFramesMs,
        };
        this.lastLoopCallbackEndedAtMs = endedAt;
      };
      loop.callback = this.wrappedLoopCallback;
    }
    this.setupGpuTimer();
    game.events.on(GAME_PRE_STEP_EVENT, this.onPreStep);
    game.events.on(GAME_STEP_EVENT, this.onStep);
    game.events.on(GAME_POST_STEP_EVENT, this.onPostStep);
    game.events.on(GAME_PRE_RENDER_EVENT, this.onPreRender);
    game.events.on(GAME_POST_RENDER_EVENT, this.onPostRender);
  }

  /**
   * Liefert den zuletzt vollstaendig abgeschlossenen Phaser-Frame. Der aktuelle Scene-Update-Wert
   * wird fuer die Systems/Plugins-Restzeit des naechsten abgeschlossenen Frames vorgemerkt.
   */
  takeLastFrameLifecycleMetrics(currentSceneUpdateMs: number): PhaserFrameLifecycleMetrics {
    const result = { ...this.lastFrameLifecycle };
    this.previousSceneUpdateMs = currentSceneUpdateMs;
    return result;
  }

  takeLastRenderSubmitMs(): number {
    return this.lastRenderSubmitMs;
  }

  /**
   * Zeichenaufrufe des zuletzt abgeschlossenen Renders. Wie `takeLastRenderSubmitMs()` betrifft
   * der Wert den vorherigen Frame, weil `update` vor `render` laeuft.
   */
  takeLastDrawCallCount(): number {
    return this.lastFrameDrawCallCount;
  }

  /** Zaehlung fuer die Live-Ansicht. Waehrend einer Aufzeichnung laeuft sie ohnehin. */
  setLiveDrawCallTracking(enabled: boolean): void {
    this.liveDrawCallTracking = enabled;
    this.syncDrawCallHooks();
  }

  isCountingDrawCalls(): boolean {
    return this.drawCallHooksInstalled;
  }

  record(sample: ArenaRuntimeSample): void {
    const profilerStartedAt = performance.now();
    const now = performance.now();
    const metadataMatches = this.metricsWindow
      && this.metricsWindow.role === sample.role
      && this.metricsWindow.phase === sample.phase
      && this.metricsWindow.quality === sample.quality
      && this.metricsWindow.mode === sample.mode
      && this.metricsWindow.mapId === sample.mapId;
    if (this.metricsWindow && !metadataMatches) this.finishWindow(now);
    const window = metadataMatches && this.metricsWindow
      ? this.metricsWindow
      : this.createWindow(now, sample);

    window.maxSampleGapMs = Math.max(window.maxSampleGapMs, now - window.lastSampleAtMs);
    window.lastSampleAtMs = now;
    const detailTimings = normalizeDetailTimings(sample.details);
    const detailCounts = normalizeDetailCounts(sample.details);
    detailCounts.framebufferBindCount = this.lastFrameGlDiagnostics.framebufferBindCount;
    detailCounts.programSwitchCount = this.lastFrameGlDiagnostics.programSwitchCount;
    detailCounts.textureUploadCount = this.lastFrameGlDiagnostics.textureUploadCount;
    detailCounts.textureUploadPixels = this.lastFrameGlDiagnostics.textureUploadPixels;
    detailCounts.bufferUploadCount = this.lastFrameGlDiagnostics.bufferUploadCount;
    const recordedSample: RecordedSample = {
      ...sample,
      ...deriveSampleTimings(sample, detailTimings),
      atMs: this.recording ? Math.max(0, now - this.recordingStartedAtMs) : now,
      detailTimings,
      detailCounts,
    };
    window.samples.push(recordedSample);
    if (sample.sceneBreakdown) window.latestSceneBreakdown = sample.sceneBreakdown;
    if (sample.filterBreakdown) window.latestFilterBreakdown = sample.filterBreakdown;
    this.metricsWindow = window;
    this.latestRecordedSample = recordedSample;

    if (this.recording) {
      this.recordContextChange(recordedSample);
      this.recordRawFrame(recordedSample);
      this.sampleMemory(now);
    }

    if (now - window.startedAtMs >= DEBUG_RUNTIME_PERF_METRICS_WINDOW_MS) {
      this.finishWindow(now);
    }

    if (this.recording && now - this.recordingStartedAtMs >= MAX_RECORDING_MS) {
      this.stopRecording(true);
    }
    if (this.recording) this.profilerRecordCostsMs.push(performance.now() - profilerStartedAt);
  }

  shouldCaptureSceneBreakdown(role: 'host' | 'client', deltaMs: number): boolean {
    const now = performance.now();
    const window = this.metricsWindow;
    if (!window || window.role !== role) return true;
    return now - window.startedAtMs >= DEBUG_RUNTIME_PERF_METRICS_WINDOW_MS - Math.max(deltaMs * 2, 100);
  }

  /**
   * Das Environment wird hier und nicht beim Export erfasst. Sonst beschreibt der Reportkopf den
   * Zustand zum Zeitpunkt des Klicks statt den der Messung.
   */
  startRecording(environment: Record<string, unknown> = {}): void {
    const now = performance.now();
    this.recording = true;
    this.recordingId += 1;
    this.recordingEnvironment = { ...environment };
    this.recordingStartedAtMs = now;
    this.recordingStartedEpochMs = Date.now();
    this.recordingEndedEpochMs = 0;
    this.autoStopped = false;
    this.recordedWindows.length = 0;
    this.qualityChanges.length = 0;
    this.contextChanges.length = 0;
    this.rawFrameRows.length = 0;
    this.rawFrameRowsTruncated = false;
    this.longTasks.length = 0;
    this.longAnimationFrames.length = 0;
    this.eventTimings.length = 0;
    this.eventTimingsTruncated = false;
    this.memorySamples.length = 0;
    this.gcSamples.length = 0;
    this.lifecycleEvents.length = 0;
    this.gpuSamples.length = 0;
    this.profilerRecordCostsMs.length = 0;
    this.latestRecordedSample = null;
    this.nextMemorySampleAtMs = now;
    this.pendingGpuQueriesDropped = 0;
    this.disjointGpuSamplesDropped = 0;
    this.recordingUsedDrawCallHooks = false;
    this.recordingUsedGlDiagnosticHooks = false;
    this.metricsWindow = null;
    this.startLongTaskObserver();
    this.startLongAnimationFrameObserver();
    this.startEventTimingObserver();
    this.startGcObserver();
    this.startLifecycleTracking();
    this.setupGpuTimer();
    this.syncDrawCallHooks();
    this.recordingUsedDrawCallHooks = this.drawCallHooksInstalled;
    this.recordingUsedGlDiagnosticHooks = this.glDiagnosticHooksInstalled;
  }

  stopRecording(autoStopped = false): void {
    if (!this.recording) return;
    this.finishWindow(performance.now());
    this.recording = false;
    this.recordingEndedEpochMs = Date.now();
    this.autoStopped = autoStopped;
    this.stopLongTaskObserver();
    this.stopLongAnimationFrameObserver();
    this.stopEventTimingObserver();
    this.stopGcObserver();
    this.stopLifecycleTracking();
    this.finishGpuQueries();
    this.syncDrawCallHooks();
  }

  recordQualityChange(from: GraphicsQuality, to: GraphicsQuality): void {
    if (!this.recording) return;
    this.qualityChanges.push({ atMs: performance.now() - this.recordingStartedAtMs, from, to });
  }

  isRecording(): boolean {
    return this.recording;
  }

  getRecordingDurationMs(): number {
    if (this.recordingStartedAtMs <= 0) return 0;
    return this.recording
      ? performance.now() - this.recordingStartedAtMs
      : Math.max(0, this.recordingEndedEpochMs - this.recordingStartedEpochMs);
  }

  getLatestSummary(): ArenaRuntimeWindowSummary | null {
    return this.latestSummary;
  }

  canExport(): boolean {
    return !this.recording && this.recordedWindows.length > 0;
  }

  buildReport(): ArenaPerformanceReport | null {
    if (!this.canExport()) return null;
    return {
      schemaVersion: 4,
      recordingId: this.recordingId,
      createdAt: new Date().toISOString(),
      recordingStartedAt: new Date(this.recordingStartedEpochMs).toISOString(),
      recordingEndedAt: new Date(this.recordingEndedEpochMs).toISOString(),
      autoStopped: this.autoStopped,
      environment: { ...this.recordingEnvironment },
      recordingScope: {
        roles: uniqueInOrder(this.recordedWindows.map((window) => window.role)),
        phases: uniqueInOrder(this.recordedWindows.map((window) => window.phase)),
        qualities: uniqueInOrder(this.recordedWindows.map((window) => window.quality)),
        modes: uniqueInOrder(this.recordedWindows.map((window) => window.mode)),
        mapIds: uniqueInOrder(this.recordedWindows.map((window) => window.mapId)),
      },
      qualityChanges: [...this.qualityChanges],
      windows: [...this.recordedWindows],
      contextChanges: [...this.contextChanges],
      frameSeries: {
        columns: [...FRAME_SERIES_COLUMNS],
        rows: this.rawFrameRows.map((row) => [...row]),
        phaseCodes: { ...PHASE_CODES },
        maxRows: MAX_RAW_FRAME_SAMPLES,
        truncated: this.rawFrameRowsTruncated,
      },
      longTasks: [...this.longTasks],
      longAnimationFrames: [...this.longAnimationFrames],
      eventTimings: [...this.eventTimings],
      memorySamples: [...this.memorySamples],
      gcSamples: [...this.gcSamples],
      lifecycleEvents: [...this.lifecycleEvents],
      gpu: {
        status: this.glContext
          ? (this.gpuTimer ? 'supported' : 'unsupported')
          : 'unavailable',
        sampleEveryFrames: GPU_QUERY_INTERVAL_FRAMES,
        pendingQueriesDropped: this.pendingGpuQueriesDropped,
        disjointSamplesDropped: this.disjointGpuSamplesDropped,
        samples: [...this.gpuSamples],
      },
      instrumentation: {
        drawCallHooks: this.recordingUsedDrawCallHooks,
        glDiagnosticHooks: this.recordingUsedGlDiagnosticHooks,
        rawFrameLimit: MAX_RAW_FRAME_SAMPLES,
        eventTimingLimit: MAX_EVENT_TIMING_SAMPLES,
        eventTimingsTruncated: this.eventTimingsTruncated,
        profilerRecordMs: summarizeMetric(this.profilerRecordCostsMs),
        observability: {
          longTasks: getObserverSupport('longtask'),
          longAnimationFrames: getObserverSupport('long-animation-frame'),
          eventTiming: getObserverSupport('event'),
          gc: getObserverSupport('gc'),
          memory: typeof (performance as Performance & { memory?: unknown }).memory === 'object'
            ? 'supported'
            : 'unsupported',
          gpuTimer: this.glContext
            ? (this.gpuTimer ? 'supported' : 'unsupported')
            : 'unavailable',
        },
      },
    };
  }

  destroy(): void {
    this.stopLongTaskObserver();
    this.stopLongAnimationFrameObserver();
    this.stopEventTimingObserver();
    this.stopGcObserver();
    this.stopLifecycleTracking();
    this.finishGpuQueries();
    this.liveDrawCallTracking = false;
    // Direkt statt ueber `syncDrawCallHooks()`: die Wrapper muessen weg, auch wenn die
    // Aufzeichnung noch als laufend markiert ist, sonst bleiben sie am toten GL-Kontext haengen.
    this.removeDrawCallHooks();
    this.removeGlDiagnosticHooks();
    this.detachGame();
    this.metricsWindow = null;
  }

  private finishWindow(now: number): void {
    const window = this.metricsWindow;
    if (!window || window.samples.length === 0) return;

    const timings = {} as Record<TimingKey, MetricSummary>;
    for (const key of TIMING_KEYS) timings[key] = summarizeMetric(window.samples.map((sample) => sample[key]));

    const counts = {} as Record<CountKey, { avg: number; peak: number }>;
    for (const key of COUNT_KEYS) {
      const values = window.samples.map((sample) => sample[key]);
      counts[key] = {
        avg: values.reduce((sum, value) => sum + value, 0) / values.length,
        peak: Math.max(...values),
      };
    }

    const detailTimings = {} as Record<DetailTimingKey, MetricSummary>;
    for (const key of DETAIL_TIMING_KEYS) {
      detailTimings[key] = summarizeMetric(window.samples.map((sample) => sample.detailTimings[key]));
    }

    const detailCounts = {} as Record<DetailCountKey, { avg: number; peak: number }>;
    for (const key of DETAIL_COUNT_KEYS) {
      const values = window.samples.map((sample) => sample.detailCounts[key]);
      detailCounts[key] = {
        avg: values.reduce((sum, value) => sum + value, 0) / values.length,
        peak: Math.max(...values),
      };
    }

    const lightingPresets: Record<string, { avg: number; peak: number }> = {};
    const presetKeys = uniqueInOrder(window.samples.flatMap((sample) => Object.keys(sample.lightPresetCounts ?? {})));
    for (const presetKey of presetKeys) {
      const values = window.samples.map((sample) => sample.lightPresetCounts?.[presetKey] ?? 0);
      lightingPresets[presetKey] = {
        avg: values.reduce((sum, value) => sum + value, 0) / values.length,
        peak: Math.max(...values),
      };
    }

    const rawDelta = timings.rawDeltaMs;
    const durationMs = Math.max(0, now - window.startedAtMs);
    // Wie viele Frames haetten bei der unglaetteten Frame-Zeit in das Fenster gepasst.
    const expectedSampleCount = rawDelta.avg > 0 ? durationMs / rawDelta.avg : window.samples.length;
    const summary: ArenaRuntimeWindowSummary = {
      startedAtMs: this.recording ? Math.max(0, window.startedAtMs - this.recordingStartedAtMs) : window.startedAtMs,
      durationMs,
      role: window.role,
      phase: window.phase,
      quality: window.quality,
      mode: window.mode,
      mapId: window.mapId,
      sampleCount: window.samples.length,
      fps: rawDelta.avg > 0 ? 1000 / rawDelta.avg : 0,
      smoothedFps: timings.deltaMs.avg > 0 ? 1000 / timings.deltaMs.avg : 0,
      coveragePercent: expectedSampleCount > 0
        ? Math.min(100, window.samples.length / expectedSampleCount * 100)
        : 100,
      maxSampleGapMs: Math.max(window.maxSampleGapMs, now - window.lastSampleAtMs),
      over16msPercent: window.samples.filter((sample) => sample.rawDeltaMs > 16.7).length / window.samples.length * 100,
      over33msPercent: window.samples.filter((sample) => sample.rawDeltaMs > 33.3).length / window.samples.length * 100,
      timings,
      counts,
      detailTimings,
      detailCounts,
      lightingPresets,
      filterBreakdown: window.latestFilterBreakdown,
      sceneBreakdown: window.latestSceneBreakdown,
    };
    this.latestSummary = summary;
    if (this.recording) this.recordedWindows.push(summary);

    if (DEBUG_RUNTIME_PERF_METRICS) {
      console.log(
        `[PERF][${summary.phase}][${summary.role}][${summary.quality}] fps=${summary.fps.toFixed(1)} `
        + `rawP95=${timings.rawDeltaMs.p95.toFixed(2)}ms `
        + `coverage=${summary.coveragePercent.toFixed(0)}% `
        + `update=${timings.updateMs.avg.toFixed(2)}/${timings.updateMs.peak.toFixed(2)}ms `
        + `renderSubmit=${timings.renderSubmitMs.avg.toFixed(2)}/${timings.renderSubmitMs.peak.toFixed(2)}ms `
        + `roleStep=${timings.roleStepMs.avg.toFixed(2)}/${timings.roleStepMs.peak.toFixed(2)}ms `
        + `visuals=${timings.visualStepMs.avg.toFixed(2)}/${timings.visualStepMs.peak.toFixed(2)}ms `
        + `(cam=${timings.visualCameraMs.avg.toFixed(2)} enemy=${timings.visualEnemyMs.avg.toFixed(2)} `
        + `fx=${timings.visualEffectsMs.avg.toFixed(2)} aim=${timings.visualAimMs.avg.toFixed(2)} `
        + `hud=${timings.visualHudMs.avg.toFixed(2)}) `
        + `rest=${timings.unaccountedUpdateMs.avg.toFixed(2)}/${timings.unaccountedFrameMs.avg.toFixed(2)}ms `
        + `drawCalls=${counts.drawCallCount.avg.toFixed(0)}/${counts.drawCallCount.peak} `
        + `particles=${counts.aliveParticleCount.avg.toFixed(0)}/${counts.aliveParticleCount.peak}`,
      );
    }
    this.metricsWindow = null;
  }

  private createWindow(now: number, sample: ArenaRuntimeSample): RuntimeWindow {
    return {
      startedAtMs: now,
      role: sample.role,
      phase: sample.phase,
      quality: sample.quality,
      mode: sample.mode,
      mapId: sample.mapId,
      samples: [],
      latestSceneBreakdown: null,
      latestFilterBreakdown: null,
      lastSampleAtMs: now,
      maxSampleGapMs: 0,
    };
  }

  private startLongTaskObserver(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const attributedEntry = entry as PerformanceEntry & {
            attribution?: Array<{
              name?: string;
              entryType?: string;
              containerType?: string;
              containerName?: string;
              containerId?: string;
              containerSrc?: string;
            }>;
          };
          const sample = this.latestRecordedSample;
          this.longTasks.push({
            startMs: Math.max(0, entry.startTime - this.recordingStartedAtMs),
            durationMs: entry.duration,
            frameIndex: sample ? Math.max(0, this.rawFrameRows.length - 1) : null,
            phase: sample?.phase ?? null,
            role: sample?.role ?? null,
            rawDeltaMs: sample?.rawDeltaMs ?? null,
            updateMs: sample?.updateMs ?? null,
            attribution: (attributedEntry.attribution ?? []).map((item) => ({
              name: item.name ?? '',
              entryType: item.entryType ?? '',
              containerType: item.containerType ?? null,
              containerName: item.containerName ?? null,
              containerId: item.containerId ?? null,
              containerSrc: item.containerSrc ?? null,
            })),
          });
        }
      });
      this.longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      this.longTaskObserver = null;
    }
  }

  private stopLongTaskObserver(): void {
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
  }

  private startLongAnimationFrameObserver(): void {
    if (getObserverSupport('long-animation-frame') !== 'supported') return;
    try {
      this.longAnimationFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const loaf = entry as PerformanceEntry & {
            blockingDuration?: number;
            renderStart?: number;
            styleAndLayoutStart?: number;
            firstUIEventTimestamp?: number;
            scripts?: Array<{
              duration?: number;
              executionStart?: number;
              forcedStyleAndLayoutDuration?: number;
              pauseDuration?: number;
              invoker?: string;
              invokerType?: string;
              sourceURL?: string;
              sourceFunctionName?: string;
            }>;
          };
          const sample = this.latestRecordedSample;
          const relativeTime = (value: number | undefined): number | null => (
            typeof value === 'number' && value > 0
              ? Math.max(0, value - this.recordingStartedAtMs)
              : null
          );
          this.longAnimationFrames.push({
            startMs: Math.max(0, entry.startTime - this.recordingStartedAtMs),
            durationMs: entry.duration,
            blockingDurationMs: loaf.blockingDuration ?? 0,
            renderStartMs: relativeTime(loaf.renderStart),
            styleAndLayoutStartMs: relativeTime(loaf.styleAndLayoutStart),
            firstUiEventMs: relativeTime(loaf.firstUIEventTimestamp),
            frameIndex: sample ? Math.max(0, this.rawFrameRows.length - 1) : null,
            phase: sample?.phase ?? null,
            role: sample?.role ?? null,
            scripts: (loaf.scripts ?? []).map((script) => ({
              durationMs: script.duration ?? 0,
              executionStartMs: relativeTime(script.executionStart),
              forcedStyleAndLayoutMs: script.forcedStyleAndLayoutDuration ?? 0,
              pauseMs: script.pauseDuration ?? 0,
              invoker: script.invoker ?? '',
              invokerType: script.invokerType ?? '',
              source: sanitizeSourceUrl(script.sourceURL ?? ''),
              functionName: script.sourceFunctionName ?? '',
            })),
          });
        }
      });
      this.longAnimationFrameObserver.observe({ entryTypes: ['long-animation-frame'] });
    } catch {
      this.longAnimationFrameObserver = null;
    }
  }

  private stopLongAnimationFrameObserver(): void {
    this.longAnimationFrameObserver?.disconnect();
    this.longAnimationFrameObserver = null;
  }

  private startEventTimingObserver(): void {
    if (getObserverSupport('event') !== 'supported') return;
    try {
      this.eventTimingObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (this.eventTimings.length >= MAX_EVENT_TIMING_SAMPLES) {
            this.eventTimingsTruncated = true;
            return;
          }
          const event = entry as PerformanceEntry & {
            processingStart?: number;
            processingEnd?: number;
            interactionId?: number;
          };
          const processingStart = event.processingStart ?? entry.startTime;
          const processingEnd = event.processingEnd ?? processingStart;
          this.eventTimings.push({
            startMs: Math.max(0, entry.startTime - this.recordingStartedAtMs),
            durationMs: entry.duration,
            inputDelayMs: Math.max(0, processingStart - entry.startTime),
            processingMs: Math.max(0, processingEnd - processingStart),
            presentationDelayMs: Math.max(0, entry.startTime + entry.duration - processingEnd),
            name: entry.name,
            interactionId: typeof event.interactionId === 'number' ? event.interactionId : null,
          });
        }
      });
      this.eventTimingObserver.observe({
        type: 'event',
        durationThreshold: 16,
      } as PerformanceObserverInit);
    } catch {
      this.eventTimingObserver = null;
    }
  }

  private stopEventTimingObserver(): void {
    this.eventTimingObserver?.disconnect();
    this.eventTimingObserver = null;
  }

  private startGcObserver(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      this.gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const gcEntry = entry as PerformanceEntry & { detail?: { kind?: number }; kind?: number };
          this.gcSamples.push({
            atMs: Math.max(0, entry.startTime - this.recordingStartedAtMs),
            durationMs: entry.duration,
            kind: gcEntry.detail?.kind ?? gcEntry.kind ?? null,
          });
        }
      });
      this.gcObserver.observe({ entryTypes: ['gc'] });
    } catch {
      this.gcObserver = null;
    }
  }

  private stopGcObserver(): void {
    this.gcObserver?.disconnect();
    this.gcObserver = null;
  }

  private startLifecycleTracking(): void {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      this.recordLifecycleEvent('visibility', document.visibilityState);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.onFocus);
      window.addEventListener('blur', this.onBlur);
      const focused = typeof document !== 'undefined' ? document.hasFocus() : true;
      this.recordLifecycleEvent(focused ? 'focus' : 'blur', focused ? 'focused' : 'blurred');
    }
  }

  private stopLifecycleTracking(): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.onFocus);
      window.removeEventListener('blur', this.onBlur);
    }
  }

  private recordLifecycleEvent(type: PerformanceLifecycleEvent['type'], value: string): void {
    if (!this.recording) return;
    this.lifecycleEvents.push({
      atMs: Math.max(0, performance.now() - this.recordingStartedAtMs),
      type,
      value,
    });
  }

  private recordContextChange(sample: RecordedSample): void {
    if (!sample.context) return;
    const change: PerformanceContextChange = {
      atMs: sample.atMs,
      phase: sample.phase,
      role: sample.role,
      quality: sample.quality,
      mode: sample.mode,
      mapId: sample.mapId,
      ...sample.context,
    };
    const previous = this.contextChanges[this.contextChanges.length - 1] ?? null;
    if (!contextsEqual(previous, change)) this.contextChanges.push(change);
  }

  private recordRawFrame(sample: RecordedSample): void {
    if (this.rawFrameRows.length >= MAX_RAW_FRAME_SAMPLES) {
      this.rawFrameRowsTruncated = true;
      return;
    }
    const context = sample.context;
    this.rawFrameRows.push([
      sample.atMs,
      PHASE_CODES[sample.phase],
      ...TIMING_KEYS.map((key) => sample[key]),
      ...COUNT_KEYS.map((key) => sample[key]),
      ...DETAIL_TIMING_KEYS.map((key) => sample.detailTimings[key]),
      ...DETAIL_COUNT_KEYS.map((key) => sample.detailCounts[key]),
      context?.localAlive ? 1 : 0,
      context?.aimVisible ? 1 : 0,
      context?.scopeActive ? 1 : 0,
      context?.utilityPlacementActive ? 1 : 0,
      context?.ultimatePlacementActive ? 1 : 0,
      context?.optionsOpen ? 1 : 0,
      context?.pageVisible ? 1 : 0,
      context?.documentFocused ? 1 : 0,
      context?.roundElapsedMs ?? -1,
    ]);
  }

  private sampleMemory(now: number): void {
    if (now < this.nextMemorySampleAtMs) return;
    this.nextMemorySampleAtMs = now + MEMORY_SAMPLE_INTERVAL_MS;
    const memory = (performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    }).memory;
    if (!memory) return;
    this.memorySamples.push({
      atMs: Math.max(0, now - this.recordingStartedAtMs),
      usedJsHeapBytes: memory.usedJSHeapSize,
      totalJsHeapBytes: memory.totalJSHeapSize,
      jsHeapLimitBytes: memory.jsHeapSizeLimit,
    });
  }

  /**
   * Die Wrapper kosten einen Funktionsaufruf pro Zeichenaufruf. Sie liegen deshalb nur an,
   * solange die Diagnose offen ist oder eine Aufzeichnung laeuft, und nie im normalen Spiel.
   */
  private syncDrawCallHooks(): void {
    const drawCallsWanted = this.recording || this.liveDrawCallTracking;
    if (drawCallsWanted && !this.drawCallHooksInstalled) this.installDrawCallHooks();
    if (!drawCallsWanted && this.drawCallHooksInstalled) this.removeDrawCallHooks();
    if (this.recording && !this.glDiagnosticHooksInstalled) this.installGlDiagnosticHooks();
    if (!this.recording && this.glDiagnosticHooksInstalled) this.removeGlDiagnosticHooks();
  }

  private installDrawCallHooks(): void {
    const gl = this.glContext;
    if (!gl) return;
    const target = gl as unknown as Record<string, unknown>;
    for (const method of GL_DRAW_METHODS) {
      const original = target[method];
      if (typeof original !== 'function') continue;
      const bound = (original as (...args: unknown[]) => unknown).bind(gl);
      target[method] = (...args: unknown[]): unknown => {
        this.frameDrawCallCount += 1;
        return bound(...args);
      };
    }
    this.drawCallHooksInstalled = true;
  }

  private removeDrawCallHooks(): void {
    const gl = this.glContext;
    this.drawCallHooksInstalled = false;
    this.frameDrawCallCount = 0;
    this.lastFrameDrawCallCount = 0;
    if (!gl) return;
    const target = gl as unknown as Record<string, unknown>;
    // Die Wrapper sind eigene Eigenschaften; `delete` legt die Prototyp-Methode wieder frei.
    for (const method of GL_DRAW_METHODS) {
      if (Object.prototype.hasOwnProperty.call(target, method)) delete target[method];
    }
  }

  private installGlDiagnosticHooks(): void {
    const gl = this.glContext;
    if (!gl) return;
    const target = gl as unknown as Record<string, unknown>;
    for (const method of GL_DIAGNOSTIC_METHODS) {
      const original = target[method];
      if (typeof original !== 'function') continue;
      const bound = (original as (...args: unknown[]) => unknown).bind(gl);
      target[method] = (...args: unknown[]): unknown => {
        this.trackGlDiagnosticCall(method, args);
        return bound(...args);
      };
    }
    this.glDiagnosticHooksInstalled = true;
  }

  private removeGlDiagnosticHooks(): void {
    const gl = this.glContext;
    this.glDiagnosticHooksInstalled = false;
    this.lastGlProgram = undefined;
    this.frameGlDiagnostics = emptyGlFrameDiagnostics();
    this.lastFrameGlDiagnostics = emptyGlFrameDiagnostics();
    if (!gl) return;
    const target = gl as unknown as Record<string, unknown>;
    for (const method of GL_DIAGNOSTIC_METHODS) {
      if (Object.prototype.hasOwnProperty.call(target, method)) delete target[method];
    }
  }

  private trackGlDiagnosticCall(method: GlDiagnosticMethod, args: unknown[]): void {
    if (method === 'bindFramebuffer') {
      this.frameGlDiagnostics.framebufferBindCount += 1;
      return;
    }
    if (method === 'useProgram') {
      if (args[0] !== this.lastGlProgram) {
        this.frameGlDiagnostics.programSwitchCount += 1;
        this.lastGlProgram = args[0];
      }
      return;
    }
    if (method === 'bufferData' || method === 'bufferSubData') {
      this.frameGlDiagnostics.bufferUploadCount += 1;
      return;
    }
    this.frameGlDiagnostics.textureUploadCount += 1;
    this.frameGlDiagnostics.textureUploadPixels += estimateTextureUploadPixels(method, args);
  }

  private setupGpuTimer(): void {
    this.gpuTimer = null;
    const gl = this.glContext;
    if (!gl || !('createQuery' in gl) || !('beginQuery' in gl)) return;
    const gl2 = gl as WebGL2RenderingContext;
    const extension = gl2.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimerSupport['extension'] | null;
    if (extension) this.gpuTimer = { gl: gl2, extension };
  }

  private beginGpuQuery(): void {
    const timer = this.gpuTimer;
    if (!this.recording || !timer || this.renderFrame % GPU_QUERY_INTERVAL_FRAMES !== 0) return;
    if (this.pendingGpuQueries.length >= MAX_PENDING_GPU_QUERIES) {
      this.pendingGpuQueriesDropped += 1;
      return;
    }
    const query = timer.gl.createQuery();
    if (!query) return;
    try {
      timer.gl.beginQuery(timer.extension.TIME_ELAPSED_EXT, query);
      this.activeGpuQuery = {
        query,
        atMs: Math.max(0, performance.now() - this.recordingStartedAtMs),
        renderFrame: this.renderFrame,
      };
    } catch {
      timer.gl.deleteQuery(query);
      this.activeGpuQuery = null;
    }
  }

  private endGpuQuery(): void {
    const timer = this.gpuTimer;
    const active = this.activeGpuQuery;
    if (!timer || !active) return;
    try {
      timer.gl.endQuery(timer.extension.TIME_ELAPSED_EXT);
      this.pendingGpuQueries.push(active);
    } catch {
      timer.gl.deleteQuery(active.query);
      this.pendingGpuQueriesDropped += 1;
    }
    this.activeGpuQuery = null;
  }

  private pollGpuQueries(): void {
    const timer = this.gpuTimer;
    if (!timer || this.pendingGpuQueries.length === 0) return;
    const disjoint = Boolean(timer.gl.getParameter(timer.extension.GPU_DISJOINT_EXT));
    for (let index = this.pendingGpuQueries.length - 1; index >= 0; index -= 1) {
      const pending = this.pendingGpuQueries[index];
      const available = Boolean(timer.gl.getQueryParameter(pending.query, timer.gl.QUERY_RESULT_AVAILABLE));
      if (!available && !disjoint) continue;
      this.pendingGpuQueries.splice(index, 1);
      if (disjoint) {
        this.disjointGpuSamplesDropped += 1;
      } else {
        const nanoseconds = Number(timer.gl.getQueryParameter(pending.query, timer.gl.QUERY_RESULT));
        if (Number.isFinite(nanoseconds)) {
          this.gpuSamples.push({
            atMs: pending.atMs,
            renderFrame: pending.renderFrame,
            durationMs: nanoseconds / 1_000_000,
          });
        }
      }
      timer.gl.deleteQuery(pending.query);
    }
  }

  private finishGpuQueries(): void {
    this.pollGpuQueries();
    const timer = this.gpuTimer;
    if (timer && this.activeGpuQuery) {
      try {
        timer.gl.endQuery(timer.extension.TIME_ELAPSED_EXT);
      } catch {
        // Der Kontext kann beim Scene-Abbau bereits verloren sein.
      }
      timer.gl.deleteQuery(this.activeGpuQuery.query);
      this.activeGpuQuery = null;
      this.pendingGpuQueriesDropped += 1;
    }
    if (timer) {
      for (const pending of this.pendingGpuQueries) timer.gl.deleteQuery(pending.query);
    }
    this.pendingGpuQueriesDropped += this.pendingGpuQueries.length;
    this.pendingGpuQueries.length = 0;
  }

  private detachGame(): void {
    if (!this.game) return;
    this.finishGpuQueries();
    const loop = (this.game as Phaser.Game & {
      loop?: { callback?: (time: number, delta: number) => void };
    }).loop;
    if (loop && this.wrappedLoopCallback && loop.callback === this.wrappedLoopCallback && this.originalLoopCallback) {
      loop.callback = this.originalLoopCallback;
    }
    this.game.events.off(GAME_PRE_STEP_EVENT, this.onPreStep);
    this.game.events.off(GAME_STEP_EVENT, this.onStep);
    this.game.events.off(GAME_POST_STEP_EVENT, this.onPostStep);
    this.game.events.off(GAME_PRE_RENDER_EVENT, this.onPreRender);
    this.game.events.off(GAME_POST_RENDER_EVENT, this.onPostRender);
    this.game = null;
    this.glContext = null;
    this.gpuTimer = null;
    this.preStepStartedAtMs = 0;
    this.sceneManagerStartedAtMs = 0;
    this.postStepAtMs = 0;
    this.lastPostRenderAtMs = 0;
    this.previousSceneUpdateMs = 0;
    this.lastFrameLifecycle = emptyPhaserFrameLifecycleMetrics();
    this.originalLoopCallback = null;
    this.wrappedLoopCallback = null;
    this.lastLoopCallbackEndedAtMs = 0;
  }
}
