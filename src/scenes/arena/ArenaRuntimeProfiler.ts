import type * as Phaser from 'phaser';
import {
  DEBUG_RUNTIME_PERF_METRICS,
  DEBUG_RUNTIME_PERF_METRICS_WINDOW_MS,
} from '../../config';
import type { GraphicsQuality } from '../../graphics/GraphicsQuality';

const MAX_RECORDING_MS = 30 * 60 * 1000;
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

export interface ArenaRuntimeSample {
  role: 'host' | 'client';
  quality: GraphicsQuality;
  mode: string;
  mapId: string | null;
  deltaMs: number;
  updateMs: number;
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
  sceneBreakdown?: string | null;
}

/** Vom Profiler abgeleitete Restposten, die zeigen, wie viel Zeit keine Instrumentierung erfasst. */
interface DerivedSampleTimings {
  /** `updateMs` minus aller instrumentierten Teilschritte des Frames. */
  unaccountedUpdateMs: number;
  /** `deltaMs` minus Update und Render-Abgabe: Phaser-Interna, Compositing, GC. */
  unaccountedFrameMs: number;
}

type RecordedSample = ArenaRuntimeSample & DerivedSampleTimings;

interface MetricSummary {
  avg: number;
  p95: number;
  p99: number;
  peak: number;
}

export interface ArenaRuntimeWindowSummary {
  startedAtMs: number;
  durationMs: number;
  role: 'host' | 'client';
  quality: GraphicsQuality;
  mode: string;
  mapId: string | null;
  sampleCount: number;
  /** Aus der mittleren Frame-Zeit, also nur ueber tatsaechlich erfasste Frames. */
  fps: number;
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
  qualities: GraphicsQuality[];
  modes: string[];
  mapIds: (string | null)[];
}

export interface ArenaPerformanceReport {
  schemaVersion: 2;
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
  longTasks: { startMs: number; durationMs: number }[];
}

type TimingKey =
  | 'deltaMs'
  | 'updateMs'
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
  | 'fireSimulationMs'
  | 'fireCreationMs'
  | 'fireVisualMs';

type CountKey =
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
  'deltaMs', 'updateMs', 'renderSubmitMs', 'unaccountedFrameMs',
  'roleStepMs', 'networkUpdateMs', 'networkFlushMs',
  'visualStepMs', 'visualCameraMs', 'visualEnemyMs', 'visualEffectsMs', 'visualAimMs', 'visualHudMs',
  'shadowStepMs', 'lightingStepMs', 'unaccountedUpdateMs',
  'fireSimulationMs', 'fireCreationMs', 'fireVisualMs',
];

const COUNT_KEYS: readonly CountKey[] = [
  'enemyCount', 'projectileCount', 'playerCount', 'displayObjectCount', 'visibleObjectCount',
  'particleEmitterCount', 'aliveParticleCount', 'activeFilterCount', 'activeLightCount', 'renderedLightCount',
  'drawCallCount',
];

interface RuntimeWindow {
  startedAtMs: number;
  role: 'host' | 'client';
  quality: GraphicsQuality;
  mode: string;
  mapId: string | null;
  samples: RecordedSample[];
  latestSceneBreakdown: string | null;
  lastSampleAtMs: number;
  maxSampleGapMs: number;
}

/**
 * Restposten des Update-Budgets. `fire*` bleibt aussen vor: die Feuerkosten laufen innerhalb des
 * Host-Schritts und wuerden sonst doppelt zaehlen.
 */
function deriveSampleTimings(sample: ArenaRuntimeSample): DerivedSampleTimings {
  const accountedUpdateMs = sample.roleStepMs
    + sample.networkUpdateMs
    + sample.networkFlushMs
    + sample.visualStepMs
    + sample.shadowStepMs
    + sample.lightingStepMs;
  return {
    unaccountedUpdateMs: sample.updateMs - accountedUpdateMs,
    unaccountedFrameMs: sample.deltaMs - sample.updateMs - sample.renderSubmitMs,
  };
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
  private readonly longTasks: { startMs: number; durationMs: number }[] = [];
  private longTaskObserver: PerformanceObserver | null = null;
  private renderStartedAtMs = 0;
  private lastRenderSubmitMs = 0;
  private game: Phaser.Game | null = null;
  private glContext: GlContext | null = null;
  private drawCallHooksInstalled = false;
  private liveDrawCallTracking = false;
  private frameDrawCallCount = 0;
  private lastFrameDrawCallCount = 0;

  private readonly onPreRender = (): void => {
    this.renderStartedAtMs = performance.now();
    this.frameDrawCallCount = 0;
  };

  private readonly onPostRender = (): void => {
    this.lastFrameDrawCallCount = this.frameDrawCallCount;
    if (this.renderStartedAtMs <= 0) return;
    this.lastRenderSubmitMs = performance.now() - this.renderStartedAtMs;
    this.renderStartedAtMs = 0;
  };

  attachGame(game: Phaser.Game): void {
    if (this.game === game) return;
    this.detachGame();
    this.game = game;
    this.glContext = (game.renderer as { gl?: GlContext }).gl ?? null;
    game.events.on(GAME_PRE_RENDER_EVENT, this.onPreRender);
    game.events.on(GAME_POST_RENDER_EVENT, this.onPostRender);
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
    const now = performance.now();
    const metadataMatches = this.metricsWindow
      && this.metricsWindow.role === sample.role
      && this.metricsWindow.quality === sample.quality
      && this.metricsWindow.mode === sample.mode
      && this.metricsWindow.mapId === sample.mapId;
    if (this.metricsWindow && !metadataMatches) this.finishWindow(now);
    const window = metadataMatches && this.metricsWindow
      ? this.metricsWindow
      : this.createWindow(now, sample);

    window.maxSampleGapMs = Math.max(window.maxSampleGapMs, now - window.lastSampleAtMs);
    window.lastSampleAtMs = now;
    window.samples.push({ ...sample, ...deriveSampleTimings(sample) });
    if (sample.sceneBreakdown) window.latestSceneBreakdown = sample.sceneBreakdown;
    this.metricsWindow = window;

    if (now - window.startedAtMs >= DEBUG_RUNTIME_PERF_METRICS_WINDOW_MS) {
      this.finishWindow(now);
    }

    if (this.recording && now - this.recordingStartedAtMs >= MAX_RECORDING_MS) {
      this.stopRecording(true);
    }
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
    this.longTasks.length = 0;
    this.metricsWindow = null;
    this.startLongTaskObserver();
    this.syncDrawCallHooks();
  }

  stopRecording(autoStopped = false): void {
    if (!this.recording) return;
    this.finishWindow(performance.now());
    this.recording = false;
    this.recordingEndedEpochMs = Date.now();
    this.autoStopped = autoStopped;
    this.stopLongTaskObserver();
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
      schemaVersion: 2,
      recordingId: this.recordingId,
      createdAt: new Date().toISOString(),
      recordingStartedAt: new Date(this.recordingStartedEpochMs).toISOString(),
      recordingEndedAt: new Date(this.recordingEndedEpochMs).toISOString(),
      autoStopped: this.autoStopped,
      environment: { ...this.recordingEnvironment },
      recordingScope: {
        roles: uniqueInOrder(this.recordedWindows.map((window) => window.role)),
        qualities: uniqueInOrder(this.recordedWindows.map((window) => window.quality)),
        modes: uniqueInOrder(this.recordedWindows.map((window) => window.mode)),
        mapIds: uniqueInOrder(this.recordedWindows.map((window) => window.mapId)),
      },
      qualityChanges: [...this.qualityChanges],
      windows: [...this.recordedWindows],
      longTasks: [...this.longTasks],
    };
  }

  destroy(): void {
    this.stopLongTaskObserver();
    this.liveDrawCallTracking = false;
    // Direkt statt ueber `syncDrawCallHooks()`: die Wrapper muessen weg, auch wenn die
    // Aufzeichnung noch als laufend markiert ist, sonst bleiben sie am toten GL-Kontext haengen.
    this.removeDrawCallHooks();
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

    const delta = timings.deltaMs;
    const durationMs = Math.max(0, now - window.startedAtMs);
    // Wie viele Frames haetten bei dieser Frame-Zeit in das Fenster gepasst.
    const expectedSampleCount = delta.avg > 0 ? durationMs / delta.avg : window.samples.length;
    const summary: ArenaRuntimeWindowSummary = {
      startedAtMs: this.recording ? Math.max(0, window.startedAtMs - this.recordingStartedAtMs) : window.startedAtMs,
      durationMs,
      role: window.role,
      quality: window.quality,
      mode: window.mode,
      mapId: window.mapId,
      sampleCount: window.samples.length,
      fps: delta.avg > 0 ? 1000 / delta.avg : 0,
      coveragePercent: expectedSampleCount > 0
        ? Math.min(100, window.samples.length / expectedSampleCount * 100)
        : 100,
      maxSampleGapMs: Math.max(window.maxSampleGapMs, now - window.lastSampleAtMs),
      over16msPercent: window.samples.filter((sample) => sample.deltaMs > 16.7).length / window.samples.length * 100,
      over33msPercent: window.samples.filter((sample) => sample.deltaMs > 33.3).length / window.samples.length * 100,
      timings,
      counts,
      sceneBreakdown: window.latestSceneBreakdown,
    };
    this.latestSummary = summary;
    if (this.recording) this.recordedWindows.push(summary);

    if (DEBUG_RUNTIME_PERF_METRICS) {
      console.log(
        `[PERF][${summary.role}][${summary.quality}] fps=${summary.fps.toFixed(1)} `
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
      quality: sample.quality,
      mode: sample.mode,
      mapId: sample.mapId,
      samples: [],
      latestSceneBreakdown: null,
      lastSampleAtMs: now,
      maxSampleGapMs: 0,
    };
  }

  private startLongTaskObserver(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTasks.push({
            startMs: Math.max(0, entry.startTime - this.recordingStartedAtMs),
            durationMs: entry.duration,
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

  /**
   * Die Wrapper kosten einen Funktionsaufruf pro Zeichenaufruf. Sie liegen deshalb nur an,
   * solange die Diagnose offen ist oder eine Aufzeichnung laeuft, und nie im normalen Spiel.
   */
  private syncDrawCallHooks(): void {
    const wanted = this.recording || this.liveDrawCallTracking;
    if (wanted === this.drawCallHooksInstalled) return;
    if (wanted) this.installDrawCallHooks();
    else this.removeDrawCallHooks();
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

  private detachGame(): void {
    if (!this.game) return;
    this.game.events.off(GAME_PRE_RENDER_EVENT, this.onPreRender);
    this.game.events.off(GAME_POST_RENDER_EVENT, this.onPostRender);
    this.game = null;
    this.glContext = null;
  }
}
