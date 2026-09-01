import type Phaser from 'phaser';
import { bridge } from '../../network/bridge';
import { ArenaRuntimeProfiler } from './ArenaRuntimeProfiler';
import { PerformanceAblationController, type PerformanceAblationDeps } from './PerformanceAblation';
import {
  PerformanceDiagnosticsOverlay,
  type ChunkRenderingDiagnostics,
} from '../../ui/PerformanceDiagnosticsOverlay';
import { NetDebugOverlay } from '../../ui/NetDebugOverlay';
import { getArenaVisualAttribution } from './ArenaVisualAttribution';
import type { GraphicsQualityController } from '../../graphics/GraphicsQuality';
import {
  getRockGpuPageSize,
  getRockRendererMode,
  type RockGpuPageSize,
  type RockRendererMode,
} from '../../arena/rocks/RockRendererSettings';
import type { PersistentGpuWorldDiagnostics } from '../../arena/rocks/PersistentGpuWorldSystem';
import type { GpuVfxPoolStats } from '../../effects/gpu/GpuVfxPool';
import type { GpuVfxSystem } from '../../effects/gpu/GpuVfxSystem';
import { getWebGLRendererType } from '../../utils/webglContext';

/** Netzwerk-seitige Diagnose-Payload; deckungsgleich mit `ArenaRuntimeProfiler.recordNetworkPayload`. */
type PayloadDiagnosticsInfo = Parameters<ArenaRuntimeProfiler['recordNetworkPayload']>[0];
type PayloadDiagnosticsSink = (info: PayloadDiagnosticsInfo) => void;

/**
 * Duenner, injizierter Port auf `bridge.setPayloadDiagnosticsSink` statt eines direkten Imports –
 * ausschliesslich fuer Testbarkeit des Controllers ohne echte `NetworkBridge`.
 */
export interface ArenaDiagnosticsPayloadDiagnosticsPort {
  setSink(sink: PayloadDiagnosticsSink | null): void;
}

/** Closure-Port auf `arenaResult?.rockVisualSystem`, mit Fallback auf die globalen Rock-Settings. */
export interface ArenaDiagnosticsRockVisualSystemPort {
  getMode(): RockRendererMode;
  getPageSize(): RockGpuPageSize;
  getGpuDiagnostics(): PersistentGpuWorldDiagnostics | null;
}

export interface ArenaDiagnosticsInput {
  readonly scene: Phaser.Scene;
  readonly game: Phaser.Game;
  readonly graphicsQuality: GraphicsQualityController;
  readonly payloadDiagnostics: ArenaDiagnosticsPayloadDiagnosticsPort;
  /** Wird beim Start jeder Profiler-Aufzeichnung gerufen; die Scene reicht `seedCompanionBaselines` durch. */
  readonly onRecordingStart: (recordingId: number) => void;
  /** Bleibt Scene-Methode (Companion-Diagnose, Phase 2B). */
  readonly captureSceneInspection: () => void;
  // Die folgenden Getter bleiben lazy Closures ueber `renderers`/`visualFeedback`, die zur
  // Konstruktionszeit dieses Controllers noch nicht existieren (siehe `ArenaScene.create()`).
  readonly getShadowSystem: PerformanceAblationDeps['getShadowSystem'];
  readonly getLightingSystem: PerformanceAblationDeps['getLightingSystem'];
  readonly getPostFxController: NonNullable<PerformanceAblationDeps['getPostFxController']>;
  readonly getGpuParticleSuppressor: NonNullable<PerformanceAblationDeps['getGpuParticleSuppressor']>;
  readonly getVectorLighting: NonNullable<PerformanceAblationDeps['getVectorLighting']>;
  readonly chunkDiagnostics: ChunkRenderingDiagnostics;
  readonly getGpuVfxStats: () => Record<string, GpuVfxPoolStats> | null;
  readonly getRockVisualSystem: () => ArenaDiagnosticsRockVisualSystemPort | null;
}

/**
 * Scene-langlebiger Owner der Arena-Diagnose: Laufzeit-Profiler, Performance-Ablation und die
 * beiden Debug-Overlays (Transportdiagnose, Performance).
 *
 * Kennt `ArenaScene` bewusst nicht als Typ und wird nicht als Service-Locator verwendet – alles,
 * was er von Renderern/World/Activity braucht, kommt als lazy Closure ueber `ArenaDiagnosticsInput`
 * herein, exakt wie es die Scene heute schon selbst haelt.
 */
export class ArenaDiagnosticsController {
  private runtimeProfiler: ArenaRuntimeProfiler | null;
  private attribution: ReturnType<typeof getArenaVisualAttribution> | null;
  private performanceAblation: PerformanceAblationController | null;
  private performanceDiagnosticsOverlay: PerformanceDiagnosticsOverlay | null;
  private netDebugOverlay: NetDebugOverlay | null;
  private gpuVfx: GpuVfxSystem | null = null;
  private destroyed = false;

  private readonly unsubscribePayloadDiagnostics: () => void;
  private readonly unsubscribeProfilerRecording: () => void;
  private readonly unsubscribePerformanceQuality: () => void;
  /** Schliesst R-11: bislang wurden `subscribeDiagnostics`-Listener nie abbestellt. */
  private readonly diagnosticsUnsubscribes: Array<() => void> = [];

  constructor(private readonly input: ArenaDiagnosticsInput) {
    const profiler = new ArenaRuntimeProfiler();
    this.runtimeProfiler = profiler;
    const attribution = getArenaVisualAttribution(input.scene);
    this.attribution = attribution;
    profiler.setAttributionSource(attribution);
    profiler.attachGame(input.game);

    const payloadDiagnosticsSink: PayloadDiagnosticsSink = (info: PayloadDiagnosticsInfo) => {
      this.runtimeProfiler?.recordNetworkPayload(info);
    };
    this.unsubscribePayloadDiagnostics = profiler.subscribeRecordingLifecycle((recording) => {
      input.payloadDiagnostics.setSink(recording ? payloadDiagnosticsSink : null);
    });
    this.unsubscribeProfilerRecording = profiler.subscribeRecording((recordingId) => {
      input.onRecordingStart(recordingId);
    });

    const ablation = new PerformanceAblationController(input.scene, {
      onTraceEvent: (type, fields) => this.runtimeProfiler?.recordSemanticEvent(type, fields),
      getQualityController: () => input.graphicsQuality,
      getShadowSystem: input.getShadowSystem,
      getLightingSystem: input.getLightingSystem,
      getPostFxController: input.getPostFxController,
      getGpuParticleSuppressor: input.getGpuParticleSuppressor,
      getVectorEffectSystem: () => ({
        setSuppressed: (suppressed: boolean) => this.attribution?.setGraphicsFamilySuppressed('effectSystemGraphics', suppressed),
      }),
      getVectorLighting: input.getVectorLighting,
      getVectorTreeTrunks: () => ({
        setSuppressed: (suppressed: boolean) => this.attribution?.setGraphicsFamilySuppressed('treeTrunks', suppressed),
      }),
      getVectorPowerUpEffects: () => ({
        setSuppressed: (suppressed: boolean) => this.attribution?.setGraphicsFamilySuppressed('powerUpEffects', suppressed),
      }),
    });
    this.performanceAblation = ablation;

    this.unsubscribePerformanceQuality = input.graphicsQuality.subscribe((profile, previous) => {
      this.runtimeProfiler?.recordQualityChange(previous, profile.level);
    });

    this.performanceDiagnosticsOverlay = new PerformanceDiagnosticsOverlay(
      profiler,
      () => this.describePerformanceEnvironment(),
      ablation,
      input.chunkDiagnostics,
      input.getGpuVfxStats,
      input.captureSceneInspection,
    );

    this.netDebugOverlay = new NetDebugOverlay(
      () => bridge.getTransportDiagnostics(),
      () => bridge.getRoomCode(),
      () => (bridge.isHost() ? `Host ${bridge.getLocalPlayerId()}` : `Client ${bridge.getLocalPlayerId()}`),
      () => bridge.getProjectileSyncMetrics(),
    );
  }

  /**
   * Registriert einen Diagnose-Zustandslistener am Profiler und merkt sich die Unsubscribe-
   * Funktion fuer `destroy()`. Ersetzt die vier direkten `runtimeProfiler.subscribeDiagnostics`-
   * Aufrufe der Scene, die ihre Rueckgabe bislang nie abbestellt haben (R-11).
   */
  subscribeDiagnostics(listener: (enabled: boolean) => void): void {
    if (!this.runtimeProfiler) return;
    const unsubscribe = this.runtimeProfiler.subscribeDiagnostics(listener);
    this.diagnosticsUnsubscribes.push(unsubscribe);
  }

  wantsDetailedSampling(): boolean {
    return this.runtimeProfiler?.wantsDetailedSampling() ?? false;
  }

  isDiagnosticsActive(): boolean {
    return this.runtimeProfiler?.isDiagnosticsActive() ?? false;
  }

  /** Fuer `ArenaLifecycleCoordinator.setRuntimeDiagnosticEventSink`. */
  getSemanticEventSink(): (type: string, fields?: Record<string, unknown>) => void {
    return (type, fields) => this.runtimeProfiler?.recordSemanticEvent(type, fields);
  }

  /**
   * Reicht die GPU-VFX-Statistik/den Diagnose-Event-Sink an den Profiler weiter. Muss von der
   * Scene direkt nach `createRendererBundle` gerufen werden (`renderers` existiert vorher nicht).
   * Das Loesen der Bindung erledigt `destroy()`.
   */
  attachGpuVfx(gpuVfx: GpuVfxSystem): void {
    if (this.destroyed) return;
    this.gpuVfx = gpuVfx;
    this.runtimeProfiler?.setGpuVfxSource({
      build: () => gpuVfx.buildReport(),
      reset: () => gpuVfx.resetProfiling(),
    });
    gpuVfx.setDiagnosticEventSink((type, fields) => {
      this.runtimeProfiler?.recordSemanticEvent(type, fields);
    });
  }

  /** Fuer `renderers.lighting/shadow.setAttributionCollector(...)`. */
  get visualAttribution(): ReturnType<typeof getArenaVisualAttribution> | null {
    return this.attribution;
  }

  toggleNetDebug(): void {
    this.netDebugOverlay?.toggle();
  }

  isNetDebugOpen(): boolean {
    return this.netDebugOverlay?.isOpen() ?? false;
  }

  hideNetDebug(): void {
    this.netDebugOverlay?.hide();
  }

  togglePerformanceOverlay(): void {
    this.performanceDiagnosticsOverlay?.toggle();
  }

  isPerformanceOverlayOpen(): boolean {
    return this.performanceDiagnosticsOverlay?.isOpen() ?? false;
  }

  hidePerformanceOverlay(): void {
    this.performanceDiagnosticsOverlay?.hide();
  }

  updateAblation(): void {
    this.performanceAblation?.update();
  }

  /**
   * Transitional (Phase 2A) – wird in Phase 2B entfernt, sobald die Frame-Messung selbst aus der
   * Scene wandert. Bis dahin liest die dort verbleibende `record(...)`/`takeLast*`-Messung den
   * Profiler ueber diesen Accessor statt ueber ein eigenes Feld.
   */
  get profiler(): ArenaRuntimeProfiler | null {
    return this.runtimeProfiler;
  }

  /**
   * Transitional (Phase 2A) – wird in Phase 2B entfernt, sobald `recordCompanionFrame` selbst
   * aus der Scene wandert. Bis dahin liest sie die aktuelle Ablation-Kategorie ueber diesen
   * Accessor statt ueber ein eigenes Feld.
   */
  get ablation(): PerformanceAblationController | null {
    return this.performanceAblation;
  }

  private describePerformanceEnvironment(): Record<string, unknown> {
    const canvas = this.input.game.canvas;
    const renderer = this.input.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const gl = renderer.gl;
    const debugRendererInfo = gl?.getExtension('WEBGL_debug_renderer_info');
    const gpuRenderer = gl && debugRendererInfo
      ? gl.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL)
      : null;
    const gpuVendor = gl && debugRendererInfo
      ? gl.getParameter(debugRendererInfo.UNMASKED_VENDOR_WEBGL)
      : null;
    const nav = typeof navigator === 'undefined' ? null : navigator as Navigator & { deviceMemory?: number };
    const glLimits = {
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      maxVertexTextureImageUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
      maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
      maxViewportDims: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array),
    };
    const rockVisualSystem = this.input.getRockVisualSystem();

    // Vorwiegend Geraete- und Renderer-Daten. Rock-Renderer und Page-Groesse gehoeren als
    // ausdrueckliche Vergleichsparameter dazu; Rolle, Qualitaet, Modus und Map werden zusaetzlich
    // als beobachteter, veraenderlicher Session-Kontext aufgezeichnet.
    return {
      renderer: getWebGLRendererType(gl),
      gpuRenderer,
      gpuVendor,
      webglVersion: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      supportedExtensions: gl.getSupportedExtensions() ?? [],
      glLimits,
      canvas: { width: canvas.width, height: canvas.height },
      screen: typeof window === 'undefined'
        ? null
        : {
          width: window.screen.width,
          height: window.screen.height,
          availWidth: window.screen.availWidth,
          availHeight: window.screen.availHeight,
        },
      devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      pageVisibility: typeof document === 'undefined' ? null : document.visibilityState,
      documentFocused: typeof document === 'undefined' ? null : document.hasFocus(),
      userAgent: nav?.userAgent ?? null,
      platform: nav?.platform ?? null,
      hardwareConcurrency: nav?.hardwareConcurrency ?? null,
      deviceMemoryGb: nav?.deviceMemory ?? null,
      rockRendering: {
        mode: rockVisualSystem?.getMode() ?? getRockRendererMode(),
        pageSize: rockVisualSystem?.getPageSize() ?? getRockGpuPageSize(),
        gpu: rockVisualSystem?.getGpuDiagnostics() ?? null,
      },
    };
  }

  /** Idempotent: ein zweiter Aufruf ist wirkungslos. Danach sind alle Methoden neutral. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    // Spiegelt die bisherige SHUTDOWN-Registrierungsreihenfolge: Ablation (706) -> Quality-
    // Subscription/Overlay/Profiler/Attribution/Payload-Sink/Recording-Unsubscribes (746-756) ->
    // NetDebugOverlay (909) -> GPU-VFX-Detach (die ersten zwei Zeilen des gemischten Handlers bei
    // 1155-1161; die restlichen drei Zeilen bleiben im eigenen SHUTDOWN-Handler der Scene).
    this.performanceAblation?.destroy();
    this.performanceAblation = null;

    this.unsubscribePerformanceQuality();
    this.performanceDiagnosticsOverlay?.destroy();
    this.performanceDiagnosticsOverlay = null;
    this.runtimeProfiler?.destroy();
    this.attribution = null;
    this.input.payloadDiagnostics.setSink(null);
    this.unsubscribePayloadDiagnostics();
    this.unsubscribeProfilerRecording();
    this.runtimeProfiler = null;

    this.netDebugOverlay?.destroy();
    this.netDebugOverlay = null;

    // Der gemischte SHUTDOWN-Handler bei 1155-1161 rief hier zusaetzlich
    // `this.runtimeProfiler?.setGpuVfxSource(null)`; der lief aber immer erst NACH dem Handler,
    // der `this.runtimeProfiler` bereits auf null gesetzt hat (siehe oben), war also schon vor
    // dieser Extraktion ein reiner No-op. TypeScript beweist das jetzt sogar selbst (der Zugriff
    // waere ein Typfehler auf `never`), deshalb bleibt nur der tatsaechlich wirksame Teil – das
    // Loesen des GPU-VFX-Diagnose-Sinks – hier stehen.
    this.gpuVfx?.setDiagnosticEventSink(null);
    this.gpuVfx = null;

    for (const unsubscribe of this.diagnosticsUnsubscribes) unsubscribe();
    this.diagnosticsUnsubscribes.length = 0;
  }
}
