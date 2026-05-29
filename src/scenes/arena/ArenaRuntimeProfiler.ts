import {
  DEBUG_RUNTIME_PERF_METRICS,
  DEBUG_RUNTIME_PERF_METRICS_WINDOW_MS,
} from '../../config';

export interface ArenaRuntimeSample {
  role: 'host' | 'client';
  deltaMs: number;
  frameCostMs: number;
  primaryStepMs: number;
  visualStepMs: number;
  shadowStepMs: number;
  enemyCount: number;
  projectileCount: number;
  playerCount: number;
  displayObjectCount: number;
  sceneBreakdown?: string | null;
}

interface ArenaRuntimeMetricsWindow {
  startedAtMs: number;
  sampleCount: number;
  role: 'host' | 'client';
  deltaSumMs: number;
  deltaPeakMs: number;
  frameCostSumMs: number;
  frameCostPeakMs: number;
  primaryStepSumMs: number;
  primaryStepPeakMs: number;
  visualStepSumMs: number;
  visualStepPeakMs: number;
  shadowStepSumMs: number;
  shadowStepPeakMs: number;
  enemyCountSum: number;
  enemyCountPeak: number;
  projectileCountSum: number;
  projectileCountPeak: number;
  playerCountSum: number;
  playerCountPeak: number;
  displayObjectCountSum: number;
  displayObjectCountPeak: number;
  latestSceneBreakdown: string | null;
}

export class ArenaRuntimeProfiler {
  private metricsWindow: ArenaRuntimeMetricsWindow | null = null;

  record(sample: ArenaRuntimeSample): void {
    if (!DEBUG_RUNTIME_PERF_METRICS) return;

    const now = performance.now();
    const window = this.metricsWindow && this.metricsWindow.role === sample.role
      ? this.metricsWindow
      : this.createWindow(now, sample.role);

    window.sampleCount += 1;
    window.deltaSumMs += sample.deltaMs;
    window.deltaPeakMs = Math.max(window.deltaPeakMs, sample.deltaMs);
    window.frameCostSumMs += sample.frameCostMs;
    window.frameCostPeakMs = Math.max(window.frameCostPeakMs, sample.frameCostMs);
    window.primaryStepSumMs += sample.primaryStepMs;
    window.primaryStepPeakMs = Math.max(window.primaryStepPeakMs, sample.primaryStepMs);
    window.visualStepSumMs += sample.visualStepMs;
    window.visualStepPeakMs = Math.max(window.visualStepPeakMs, sample.visualStepMs);
    window.shadowStepSumMs += sample.shadowStepMs;
    window.shadowStepPeakMs = Math.max(window.shadowStepPeakMs, sample.shadowStepMs);
    window.enemyCountSum += sample.enemyCount;
    window.enemyCountPeak = Math.max(window.enemyCountPeak, sample.enemyCount);
    window.projectileCountSum += sample.projectileCount;
    window.projectileCountPeak = Math.max(window.projectileCountPeak, sample.projectileCount);
    window.playerCountSum += sample.playerCount;
    window.playerCountPeak = Math.max(window.playerCountPeak, sample.playerCount);
    window.displayObjectCountSum += sample.displayObjectCount;
    window.displayObjectCountPeak = Math.max(window.displayObjectCountPeak, sample.displayObjectCount);
    if (sample.sceneBreakdown) {
      window.latestSceneBreakdown = sample.sceneBreakdown;
    }
    this.metricsWindow = window;

    if (now - window.startedAtMs < DEBUG_RUNTIME_PERF_METRICS_WINDOW_MS) return;

    const avgDeltaMs = window.deltaSumMs / window.sampleCount;
    const avgFrameCostMs = window.frameCostSumMs / window.sampleCount;
    const avgPrimaryMs = window.primaryStepSumMs / window.sampleCount;
    const avgVisualMs = window.visualStepSumMs / window.sampleCount;
    const avgShadowMs = window.shadowStepSumMs / window.sampleCount;
    const avgEnemies = window.enemyCountSum / window.sampleCount;
    const avgProjectiles = window.projectileCountSum / window.sampleCount;
    const avgPlayers = window.playerCountSum / window.sampleCount;
    const avgObjects = window.displayObjectCountSum / window.sampleCount;
    const approxFps = avgDeltaMs > 0 ? 1000 / avgDeltaMs : 0;

    console.log(
      `[PERF][${window.role}] fps=${approxFps.toFixed(1)} `
      + `frame=${avgFrameCostMs.toFixed(2)}/${window.frameCostPeakMs.toFixed(2)}ms `
      + `step=${avgPrimaryMs.toFixed(2)}/${window.primaryStepPeakMs.toFixed(2)}ms `
      + `visuals=${avgVisualMs.toFixed(2)}/${window.visualStepPeakMs.toFixed(2)}ms `
      + `shadows=${avgShadowMs.toFixed(2)}/${window.shadowStepPeakMs.toFixed(2)}ms `
      + `delta=${avgDeltaMs.toFixed(2)}/${window.deltaPeakMs.toFixed(2)}ms `
      + `enemies=${avgEnemies.toFixed(1)}/${window.enemyCountPeak} `
      + `projectiles=${avgProjectiles.toFixed(1)}/${window.projectileCountPeak} `
      + `players=${avgPlayers.toFixed(1)}/${window.playerCountPeak} `
      + `objects=${avgObjects.toFixed(1)}/${window.displayObjectCountPeak}`,
    );

    if (window.latestSceneBreakdown) {
      console.log(`[PERF][${window.role}][scene] ${window.latestSceneBreakdown}`);
    }

    this.metricsWindow = this.createWindow(now, sample.role);
  }

  shouldCaptureSceneBreakdown(role: 'host' | 'client', deltaMs: number): boolean {
    if (!DEBUG_RUNTIME_PERF_METRICS) return false;
    const now = performance.now();
    const window = this.metricsWindow;
    if (!window || window.role !== role) return true;
    return now - window.startedAtMs >= DEBUG_RUNTIME_PERF_METRICS_WINDOW_MS - Math.max(deltaMs * 2, 100);
  }

  private createWindow(startedAtMs: number, role: 'host' | 'client'): ArenaRuntimeMetricsWindow {
    return {
      startedAtMs,
      sampleCount: 0,
      role,
      deltaSumMs: 0,
      deltaPeakMs: 0,
      frameCostSumMs: 0,
      frameCostPeakMs: 0,
      primaryStepSumMs: 0,
      primaryStepPeakMs: 0,
      visualStepSumMs: 0,
      visualStepPeakMs: 0,
      shadowStepSumMs: 0,
      shadowStepPeakMs: 0,
      enemyCountSum: 0,
      enemyCountPeak: 0,
      projectileCountSum: 0,
      projectileCountPeak: 0,
      playerCountSum: 0,
      playerCountPeak: 0,
      displayObjectCountSum: 0,
      displayObjectCountPeak: 0,
      latestSceneBreakdown: null,
    };
  }
}