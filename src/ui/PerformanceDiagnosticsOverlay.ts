import { COLORS, toCssColor } from '../config';
import type {
  ArenaPerformanceReport,
  ArenaRuntimeProfiler,
  ArenaRuntimeWindowSummary,
} from '../scenes/arena/ArenaRuntimeProfiler';

const REFRESH_INTERVAL_MS = 500;

function ms(value: number): string {
  return `${value.toFixed(value < 10 ? 2 : 1)} ms`;
}

function count(value: number): string {
  return value.toFixed(value < 10 ? 1 : 0);
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function buildSummaryLines(summary: ArenaRuntimeWindowSummary | null): string[] {
  if (!summary) return ['Noch kein vollständiges Messfenster vorhanden.'];
  const timings = summary.timings;
  const counts = summary.counts;
  const roleLabel = summary.role === 'host' ? 'Host-Simulation' : 'Client-Synchronisierung';
  return [
    `${summary.role.toUpperCase()} · ${summary.quality.toUpperCase()} · ${summary.mode}${summary.mapId ? ` · ${summary.mapId}` : ''}`,
    `FPS ${summary.fps.toFixed(1)} · Frame p95 ${ms(timings.deltaMs.p95)} · p99 ${ms(timings.deltaMs.p99)}`,
    summary.coveragePercent < 95
      ? `⚠ Nur ${summary.coveragePercent.toFixed(0)}% des Fensters gesampelt · größte Lücke ${ms(summary.maxSampleGapMs)} · FPS oben nicht repräsentativ`
      : `Abdeckung ${summary.coveragePercent.toFixed(0)}% · ${summary.sampleCount} Samples`,
    `Langsame Frames >16,7 ${summary.over16msPercent.toFixed(1)}% · >33,3 ${summary.over33msPercent.toFixed(1)}%`,
    `Update ${ms(timings.updateMs.avg)} · Render-Abgabe ${ms(timings.renderSubmitMs.avg)} · Rest/Frame ${ms(timings.unaccountedFrameMs.avg)}`,
    `${roleLabel} ${ms(timings.roleStepMs.avg)} · Visuals ${ms(timings.visualStepMs.avg)} · Rest/Update ${ms(timings.unaccountedUpdateMs.avg)}`,
    `  Kamera ${ms(timings.visualCameraMs.avg)} · Gegner ${ms(timings.visualEnemyMs.avg)} · Effekte ${ms(timings.visualEffectsMs.avg)}`,
    `  Zielen ${ms(timings.visualAimMs.avg)} · HUD ${ms(timings.visualHudMs.avg)}`,
    `Netz Update ${ms(timings.networkUpdateMs.avg)} · Flush ${ms(timings.networkFlushMs.avg)}`,
    `Schatten ${ms(timings.shadowStepMs.avg)} · Licht ${ms(timings.lightingStepMs.avg)}`,
    `Feuer Sim ${ms(timings.fireSimulationMs.avg)} · Erzeugung ${ms(timings.fireCreationMs.avg)} · Visuals ${ms(timings.fireVisualMs.avg)}`,
    `Objekte ${count(counts.displayObjectCount.avg)} · sichtbar ${count(counts.visibleObjectCount.avg)} · Filter ${count(counts.activeFilterCount.avg)}`,
    `Draw-Calls ${count(counts.drawCallCount.avg)} · Spitze ${counts.drawCallCount.peak} · ${count(counts.visibleObjectCount.avg / Math.max(1, counts.drawCallCount.avg))} Objekte/Call`,
    `Partikel ${count(counts.aliveParticleCount.avg)} in ${count(counts.particleEmitterCount.avg)} Emittern`,
    `Lichter ${count(counts.renderedLightCount.avg)} / ${count(counts.activeLightCount.avg)} · Gegner ${count(counts.enemyCount.avg)} · Projektile ${count(counts.projectileCount.avg)}`,
  ];
}

export class PerformanceDiagnosticsOverlay {
  private panel: HTMLDivElement | null = null;
  private output: HTMLPreElement | null = null;
  private status: HTMLDivElement | null = null;
  private startButton: HTMLButtonElement | null = null;
  private stopButton: HTMLButtonElement | null = null;
  private exportButton: HTMLButtonElement | null = null;
  private timer: number | null = null;

  constructor(
    private readonly profiler: ArenaRuntimeProfiler,
    private readonly getEnvironment: () => Record<string, unknown>,
  ) {}

  toggle(): void {
    if (this.panel) this.hide();
    else this.show();
  }

  show(): void {
    if (this.panel || typeof document === 'undefined') return;
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      width: 'min(590px, calc(100vw - 24px))',
      maxHeight: 'calc(100vh - 24px)',
      overflowY: 'auto',
      boxSizing: 'border-box',
      padding: '12px 14px',
      border: `1px solid ${toCssColor(COLORS.GREY_5)}`,
      backgroundColor: 'rgba(12, 12, 12, 0.92)',
      color: toCssColor(COLORS.GREY_1),
      fontFamily: 'monospace',
      fontSize: '12px',
      lineHeight: '1.5',
      zIndex: '4000',
    });

    const title = document.createElement('div');
    title.textContent = 'PERFORMANCE · T zum Schließen';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '8px';

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.marginBottom = '8px';
    this.startButton = this.createButton('Messung starten', () => this.profiler.startRecording(this.getEnvironment()));
    this.stopButton = this.createButton('Messung stoppen', () => this.profiler.stopRecording());
    this.exportButton = this.createButton('JSON exportieren', () => this.exportJson());
    controls.append(this.startButton, this.stopButton, this.exportButton);

    this.status = document.createElement('div');
    this.status.style.color = '#b7c7b7';
    this.status.style.marginBottom = '6px';

    this.output = document.createElement('pre');
    Object.assign(this.output.style, { margin: '0', whiteSpace: 'pre-wrap', font: 'inherit' });
    panel.append(title, controls, this.status, this.output);
    document.body.appendChild(panel);
    this.panel = panel;
    this.profiler.setLiveDrawCallTracking(true);
    this.render();
    this.timer = window.setInterval(() => this.render(), REFRESH_INTERVAL_MS);
  }

  hide(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    // Waehrend einer laufenden Aufzeichnung haelt der Profiler die Zaehlung selbst aktiv.
    this.profiler.setLiveDrawCallTracking(false);
    this.panel?.remove();
    this.panel = null;
    this.output = null;
    this.status = null;
    this.startButton = null;
    this.stopButton = null;
    this.exportButton = null;
  }

  destroy(): void {
    this.hide();
  }

  private createButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    Object.assign(button.style, {
      padding: '5px 8px',
      border: '1px solid #777',
      borderRadius: '3px',
      background: '#292929',
      color: '#f1f1f1',
      cursor: 'pointer',
      font: 'inherit',
    });
    return button;
  }

  private render(): void {
    if (!this.output || !this.status) return;
    const recording = this.profiler.isRecording();
    this.status.textContent = recording
      ? `● Messung läuft ${formatDuration(this.profiler.getRecordingDurationMs())} (max. 30:00)`
      : this.profiler.canExport() ? 'Messung beendet · JSON kann exportiert werden.' : 'Live-Ansicht · Messung noch nicht gestartet.';
    this.status.style.color = recording ? '#7ee787' : '#b7c7b7';
    if (this.startButton) this.startButton.disabled = recording;
    if (this.stopButton) this.stopButton.disabled = !recording;
    if (this.exportButton) this.exportButton.disabled = !this.profiler.canExport();
    this.output.textContent = buildSummaryLines(this.profiler.getLatestSummary()).join('\n');
  }

  private exportJson(): void {
    const report: ArenaPerformanceReport | null = this.profiler.buildReport();
    if (!report || typeof document === 'undefined') return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    // Startzeit der Messung statt Exportzeit: Zwei Exporte derselben Messung kollidieren im
    // Dateinamen und sind dadurch sofort als Dublette erkennbar.
    const stamp = report.recordingStartedAt.replace(/[:.]/g, '-');
    link.download = `fragdachse-performance-${stamp}-${report.recordingScope.qualities.join('-')}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
