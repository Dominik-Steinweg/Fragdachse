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
  lightingStepMs: number;
  fireSimulationMs: number;
  fireCreationMs: number;
  fireVisualMs: number;
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
  lightingStepSumMs: number;
  lightingStepPeakMs: number;
  fireSimulationSumMs: number;
  fireSimulationPeakMs: number;
  fireCreationPeakMs: number;
  fireVisualSumMs: number;
  fireVisualPeakMs: number;
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
    window.lightingStepSumMs += sample.lightingStepMs;
    window.lightingStepPeakMs = Math.max(window.lightingStepPeakMs, sample.lightingStepMs);
    window.fireSimulationSumMs += sample.fireSimulationMs;
    window.fireSimulationPeakMs = Math.max(window.fireSimulationPeakMs, sample.fireSimulationMs);
    window.fireCreationPeakMs = Math.max(window.fireCreationPeakMs, sample.fireCreationMs);
    window.fireVisualSumMs += sample.fireVisualMs;
    window.fireVisualPeakMs = Math.max(window.fireVisualPeakMs, sample.fireVisualMs);
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
    const avgLightingMs = window.lightingStepSumMs / window.sampleCount;
    const avgFireSimulationMs = window.fireSimulationSumMs / window.sampleCount;
    const avgFireVisualMs = window.fireVisualSumMs / window.sampleCount;
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
      + `lighting=${avgLightingMs.toFixed(2)}/${window.lightingStepPeakMs.toFixed(2)}ms `
      + `fireSim=${avgFireSimulationMs.toFixed(2)}/${window.fireSimulationPeakMs.toFixed(2)}ms `
      + `fireCreatePeak=${window.fireCreationPeakMs.toFixed(2)}ms `
      + `fireVisual=${avgFireVisualMs.toFixed(2)}/${window.fireVisualPeakMs.toFixed(2)}ms `
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
      lightingStepSumMs: 0,
      lightingStepPeakMs: 0,
      fireSimulationSumMs: 0,
      fireSimulationPeakMs: 0,
      fireCreationPeakMs: 0,
      fireVisualSumMs: 0,
      fireVisualPeakMs: 0,
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
