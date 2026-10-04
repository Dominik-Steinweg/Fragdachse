import { t } from '../i18n';
import { BUTTON_CURSOR } from './gameCursor';
import { COLORS, toCssColor } from '../config';
import { getOverlayRoot } from './fullscreen';
import type {
  ArenaPerformanceReport,
  ArenaRuntimeProfiler,
  ArenaRuntimeWindowSummary,
} from '../scenes/arena/ArenaRuntimeProfiler';
import { ABLATION_LABELS, type PerformanceAblationController } from '../scenes/arena/PerformanceAblation';
import type { ChunkSamplingMode } from '../arena/chunks/ChunkedRenderSurface';
import type { GpuVfxPoolStats } from '../effects/gpu/GpuVfxPool';
import type { PersistentGpuWorldDiagnostics } from '../arena/rocks/PersistentGpuWorldSystem';
import type { RockGpuPageSize, RockRendererMode } from '../arena/rocks/RockRendererSettings';

const REFRESH_INTERVAL_MS = 500;

export interface ChunkRenderingDiagnosticsState {
  staticShadows: boolean;
  groundSurface: boolean;
  rockOverlay: boolean;
  chunkSampling: ChunkSamplingMode;
  rockRenderer: RockRendererMode;
  rockGpuPageSize: RockGpuPageSize;
  rockGpu: PersistentGpuWorldDiagnostics | null;
}

export interface ChunkRenderingDiagnostics {
  getState(): ChunkRenderingDiagnosticsState;
  setStaticShadowsVisible(visible: boolean): void;
  setGroundSurfaceVisible(visible: boolean): void;
  setRockOverlayVisible(visible: boolean): void;
  setChunkSampling(mode: ChunkSamplingMode): void;
  setRockRenderer(mode: RockRendererMode): void;
  setRockGpuPageSize(size: RockGpuPageSize): void;
}

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
  if (!summary) return [t('ui.performance.noSample')];
  const timings = summary.timings;
  const counts = summary.counts;
  return [
    `${summary.role.toUpperCase()} · ${summary.phase.toUpperCase()} · ${summary.quality.toUpperCase()} · ${summary.mode}`
      + (summary.mapId ? ` · ${summary.mapId}` : ''),
    t('ui.performance.fps', { current: summary.currentFps.toFixed(1), average: summary.fps.toFixed(1) })
      + ` · Frame-p95 ${ms(timings.rawDeltaMs.p95)} · p99 ${ms(timings.rawDeltaMs.p99)}`,
    t('ui.performance.slowFrames', { percent: summary.over16msPercent.toFixed(1), samples: summary.sampleCount }),
    t('ui.performance.cpu', { cpu: ms(timings.roleStepMs.avg), enemies: count(counts.enemyCount.avg), projectiles: count(counts.projectileCount.avg) }),
    t('ui.performance.traceHint'),
  ];
}

export class PerformanceDiagnosticsOverlay {
  private panel: HTMLDivElement | null = null;
  private output: HTMLPreElement | null = null;
  private status: HTMLDivElement | null = null;
  private startButton: HTMLButtonElement | null = null;
  private stopButton: HTMLButtonElement | null = null;
  private exportButton: HTMLButtonElement | null = null;
  private sceneInspectionButton: HTMLButtonElement | null = null;
  private timer: number | null = null;

  private ablationButton: HTMLButtonElement | null = null;
  private chunkDiagnosticsSection: HTMLDivElement | null = null;
  private chunkDiagnosticControls: Array<{ render(state: ChunkRenderingDiagnosticsState): void }> = [];

  constructor(
    private readonly profiler: ArenaRuntimeProfiler,
    private readonly getEnvironment: () => Record<string, unknown>,
    private readonly ablation: PerformanceAblationController | null = null,
    private readonly chunkDiagnostics: ChunkRenderingDiagnostics | null = null,
    /**
     * GPU-Partikel tauchen in `particleEmitterCount`/`aliveParticleCount` naturgemaess nicht
     * auf – die zaehlen weiterhin klassische Emitter. Diese Zeile haelt die Diagnose ehrlich.
     */
    private readonly getGpuVfxStats: (() => Record<string, GpuVfxPoolStats> | null) | null = null,
    private readonly captureSceneInspection: (() => void) | null = null,
  ) {}

  toggle(): void {
    if (this.panel) this.hide();
    else this.show();
  }

  isOpen(): boolean {
    return this.panel !== null;
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
    title.textContent = t('ui.performance.title');
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '8px';

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.marginBottom = '8px';
    this.startButton = this.createButton(t('ui.performance.start'), () => this.profiler.startRecording(this.getEnvironment()));
    this.stopButton = this.createButton(t('ui.performance.stop'), () => this.stopRecording());
    this.exportButton = this.createButton(t('ui.diagnostics.exportJson'), () => this.exportJson());
    this.sceneInspectionButton = this.captureSceneInspection
      ? this.createButton(t('ui.performance.inspect'), () => this.captureSceneInspection?.())
      : null;
    controls.append(this.startButton, this.stopButton, this.exportButton);
    if (this.sceneInspectionButton) controls.append(this.sceneInspectionButton);
    if (this.ablation) {
      this.ablationButton = this.createButton(t('ui.performance.diagnose'), () => this.startAblationRecording());
      this.ablationButton.title = t('ui.performance.ablationHint');
      controls.append(this.ablationButton);
    }

    this.status = document.createElement('div');
    this.status.style.color = '#b7c7b7';
    this.status.style.marginBottom = '6px';

    this.output = document.createElement('pre');
    Object.assign(this.output.style, { margin: '0', whiteSpace: 'pre-wrap', font: 'inherit' });
    this.chunkDiagnosticsSection = this.createChunkDiagnosticsSection();
    panel.append(title, controls);
    if (this.chunkDiagnosticsSection) panel.append(this.chunkDiagnosticsSection);
    panel.append(this.status, this.output);
    getOverlayRoot().appendChild(panel);
    this.panel = panel;
    this.profiler.setLiveDiagnosticsEnabled(true);
    this.render();
    this.timer = window.setInterval(() => this.render(), REFRESH_INTERVAL_MS);
  }

  hide(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    // Waehrend einer laufenden Aufzeichnung haelt der Profiler die Zaehlung selbst aktiv.
    this.profiler.setLiveDiagnosticsEnabled(false);
    this.panel?.remove();
    this.panel = null;
    this.output = null;
    this.status = null;
    this.startButton = null;
    this.stopButton = null;
    this.exportButton = null;
    this.sceneInspectionButton = null;
    this.ablationButton = null;
    this.chunkDiagnosticsSection = null;
    this.chunkDiagnosticControls = [];
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
      cursor: BUTTON_CURSOR,
      font: 'inherit',
    });
    return button;
  }

  private render(): void {
    if (!this.output || !this.status) return;
    const recording = this.profiler.isRecording();
    // Der Profiler stoppt nach 30 Minuten selbst. Dann die Ablation mitbeenden und ihre
    // Segmente noch in den Report uebernehmen, damit der Export vollstaendig bleibt.
    if (!recording && this.ablation?.isActive()) {
      this.ablation.stop();
      this.profiler.setAblationSegments(this.ablation.getSegments(), this.ablation.getSegmentMs());
    }
    this.status.textContent = recording
      ? t('ui.performance.recording', { duration: formatDuration(this.profiler.getRecordingDurationMs()) })
      : this.profiler.canExport() ? t('ui.performance.finished') : t('ui.performance.idle');
    this.status.style.color = recording ? '#7ee787' : '#b7c7b7';
    if (this.startButton) this.startButton.disabled = recording;
    if (this.stopButton) this.stopButton.disabled = !recording;
    if (this.exportButton) this.exportButton.disabled = !this.profiler.canExport();
    if (this.ablationButton) this.ablationButton.disabled = recording;
    this.renderChunkDiagnostics();
    const lines = buildSummaryLines(this.profiler.getLatestSummary());
    const rockGpu = this.chunkDiagnostics?.getState().rockGpu ?? null;
    if (rockGpu) {
      lines.push(
        `GPU-Rocks Pages ${rockGpu.visiblePages}/${rockGpu.pageCount} · Slots ${rockGpu.capacity}`
        + ` · Buffer ${(rockGpu.bufferBytes / 1024 / 1024).toFixed(2)} MiB`,
        t('ui.performance.rockUploads', { rocks: rockGpu.dirtyRocks, pages: rockGpu.affectedPages })
        + t('ui.performance.rockSegments', { segments: rockGpu.dirtyBufferSegments, sparse: rockGpu.sparseUploads, full: rockGpu.fullUploads })
        + ` · Upload ~${(rockGpu.estimatedUploadBytes / 1024).toFixed(1)} KiB`,
      );
    }
    const gpuVfx = this.getGpuVfxStats?.() ?? null;
    if (gpuVfx) {
      for (const [label, stats] of Object.entries(gpuVfx)) {
        // Nur belegte Lanes zeigen; leere sind nach dem Idle-Hiding ohnehin unsichtbar.
        if (stats.liveCount === 0 && stats.peakLive === 0) continue;
        lines.push(
          t('ui.performance.vfx', { lane: label, live: stats.liveCount, capacity: stats.capacity })
          + ` · Peak ${stats.peakLive} · Rearms ${stats.rearms}`
          + t('ui.performance.vfxDrops', { drops: stats.capacityDrops, segments: stats.segmentsTouched }),
        );
      }
    }
    if (this.ablation?.isActive()) {
      const category = this.ablation.getCurrentCategory();
      lines.unshift(
        `◆ ABLATION: ${ABLATION_LABELS[category]}`
        + (category === 'baseline' ? '' : t('ui.performance.disabled'))
        + ` · Segment ${(this.ablation.getSegmentMs() / 1000).toFixed(0)}s`
        + t('ui.performance.cycle', { seconds: (this.ablation.getCycleDurationMs() / 1000).toFixed(0) }),
        '',
      );
    }
    this.output.textContent = lines.join('\n');
  }

  /** Ablation und Aufzeichnung starten immer gemeinsam – ohne Trace hat die Ablation keinen Zweck. */
  private startAblationRecording(): void {
    if (!this.ablation) return;
    this.profiler.startRecording(this.getEnvironment());
    this.ablation.start();
  }

  /** Beim Stoppen die Segmentliste in den Report uebernehmen, bevor die Aufzeichnung endet. */
  private stopRecording(): void {
    if (this.ablation?.isActive()) {
      this.ablation.stop();
      this.profiler.setAblationSegments(this.ablation.getSegments(), this.ablation.getSegmentMs());
    }
    this.profiler.stopRecording();
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
    const stamp = report.session.startedAtIso.replace(/[:.]/g, '-');
    link.download = `fragdachse-performance-${stamp}-${report.session.id}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private createChunkDiagnosticsSection(): HTMLDivElement | null {
    if (!this.chunkDiagnostics) return null;

    const section = document.createElement('div');
    Object.assign(section.style, {
      marginBottom: '8px',
      padding: '8px',
      border: '1px solid #555',
      background: 'rgba(35, 35, 35, 0.72)',
    });

    const heading = document.createElement('div');
    heading.textContent = t('ui.performance.chunks');
    heading.style.fontWeight = 'bold';
    heading.style.marginBottom = '5px';
    section.appendChild(heading);

    const addToggle = (
      label: string,
      read: (state: ChunkRenderingDiagnosticsState) => boolean,
      onToggle: (visible: boolean) => void,
    ): void => {
      const button = this.createButton('', () => {
        const state = this.chunkDiagnostics?.getState();
        if (!state) return;
        onToggle(!read(state));
        this.render();
      });
      button.style.display = 'block';
      button.style.width = '100%';
      button.style.marginTop = '4px';
      this.chunkDiagnosticControls.push({
        render: (state) => {
          const enabled = read(state);
          button.textContent = `${label}: ${enabled ? 'ON' : 'OFF'}`;
          button.setAttribute('aria-pressed', String(enabled));
        },
      });
      section.appendChild(button);
    };

    addToggle(
      t('ui.performance.staticShadows'),
      (state) => state.staticShadows,
      (visible) => this.chunkDiagnostics?.setStaticShadowsVisible(visible),
    );
    addToggle(
      t('ui.performance.groundSurface'),
      (state) => state.groundSurface,
      (visible) => this.chunkDiagnostics?.setGroundSurfaceVisible(visible),
    );
    addToggle(
      t('ui.performance.rockOverlay'),
      (state) => state.rockOverlay,
      (visible) => this.chunkDiagnostics?.setRockOverlayVisible(visible),
    );

    const samplingButton = this.createButton('', () => {
      const state = this.chunkDiagnostics?.getState();
      if (!state) return;
      this.chunkDiagnostics?.setChunkSampling(state.chunkSampling === 'default' ? 'nearest' : 'default');
      this.render();
    });
    samplingButton.style.display = 'block';
    samplingButton.style.width = '100%';
    samplingButton.style.marginTop = '4px';
    this.chunkDiagnosticControls.push({
      render: (state) => {
        samplingButton.textContent = `Chunk Sampling: ${state.chunkSampling.toUpperCase()}`;
        samplingButton.setAttribute('aria-pressed', String(state.chunkSampling === 'nearest'));
      },
    });
    section.appendChild(samplingButton);

    const rendererButton = this.createButton('', () => {
      const state = this.chunkDiagnostics?.getState();
      if (!state) return;
      this.chunkDiagnostics?.setRockRenderer(state.rockRenderer === 'classic' ? 'spriteGpu' : 'classic');
      this.render();
    });
    rendererButton.style.display = 'block';
    rendererButton.style.width = '100%';
    rendererButton.style.marginTop = '4px';
    this.chunkDiagnosticControls.push({
      render: (state) => {
        rendererButton.textContent = `Rock Renderer: ${state.rockRenderer === 'classic' ? 'CLASSIC' : 'SPRITE GPU'}`;
        rendererButton.setAttribute('aria-pressed', String(state.rockRenderer === 'spriteGpu'));
      },
    });
    section.appendChild(rendererButton);

    const pageSizes: readonly RockGpuPageSize[] = [512, 1024, 2048, 'global'];
    const pageSizeButton = this.createButton('', () => {
      const state = this.chunkDiagnostics?.getState();
      if (!state) return;
      const index = pageSizes.indexOf(state.rockGpuPageSize);
      this.chunkDiagnostics?.setRockGpuPageSize(pageSizes[(index + 1) % pageSizes.length]);
      this.render();
    });
    pageSizeButton.style.display = 'block';
    pageSizeButton.style.width = '100%';
    pageSizeButton.style.marginTop = '4px';
    this.chunkDiagnosticControls.push({
      render: (state) => {
        pageSizeButton.textContent = `Rock GPU Page: ${String(state.rockGpuPageSize).toUpperCase()}`;
      },
    });
    section.appendChild(pageSizeButton);

    return section;
  }

  private renderChunkDiagnostics(): void {
    const state = this.chunkDiagnostics?.getState();
    if (!state) return;
    for (const control of this.chunkDiagnosticControls) control.render(state);
  }
}
