import * as Phaser from 'phaser';
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
import type { LinkDiagnostics } from '../../network/peer/TransportDiagnostics';
import type { FlowFieldDiagnostics } from '../../systems/flowfield/FlowFieldCoordinator';
import type { HostUpdatePerformanceMetrics } from './HostUpdateCoordinator';
import type { ClientUpdatePerformanceMetrics } from './ClientUpdateCoordinator';
import type { LightingPerformanceMetrics } from '../../effects/LightingSystem';
import type { ScopePerformanceMetrics } from '../../ui/ScopeOverlay';
import type { ArenaRuntimeSample, ArenaRuntimeContext, RuntimePhase } from './ArenaRuntimeProfiler';
import { countSceneDisplayObjects, forEachSceneDisplayObject } from './sceneDisplayObjects';

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

/** Read-only Flow-Field-Diagnose ohne Re-Export des konkreten Koordinators. */
export interface ArenaDiagnosticsFlowFieldPort {
  getDiagnostics(atMs?: number): FlowFieldDiagnostics;
}

interface TransportPerformanceCounts {
  linkCount: number;
  backpressureLinkCount: number;
  reliableBufferedBytes: number;
  fastBufferedBytes: number;
  droppedFastMessages: number;
  sentBytes: number;
  receivedBytes: number;
  sentBytesPerSec: number;
  receivedBytesPerSec: number;
  medianRttMs: number;
  medianAppPingMs: number;
  sampleMs: number;
}

function emptyTransportPerformanceCounts(): TransportPerformanceCounts {
  return {
    linkCount: 0,
    backpressureLinkCount: 0,
    reliableBufferedBytes: 0,
    fastBufferedBytes: 0,
    droppedFastMessages: 0,
    sentBytes: 0,
    receivedBytes: 0,
    sentBytesPerSec: 0,
    receivedBytesPerSec: 0,
    medianRttMs: 0,
    medianAppPingMs: 0,
    sampleMs: 0,
  };
}

interface CompanionFlowfieldCounters {
  generationId: number;
  requestedUpdates: number;
  startedJobs: number;
  completedJobs: number;
  droppedStale: number;
  coalescedJobs: number;
  skippedUnchangedFields: number;
  workerComputeTotalMs: number;
  roundTripTotalMs: number;
}

function emptyCompanionFlowfieldCounters(): CompanionFlowfieldCounters {
  return {
    generationId: 0,
    requestedUpdates: 0,
    startedJobs: 0,
    completedJobs: 0,
    droppedStale: 0,
    coalescedJobs: 0,
    skippedUnchangedFields: 0,
    workerComputeTotalMs: 0,
    roundTripTotalMs: 0,
  };
}

interface CompanionFlowfieldInterval {
  requestedUpdates: number;
  completedJobs: number;
  droppedStale: number;
  coalescedJobs: number;
  skippedUnchangedFields: number;
}

function emptyCompanionFlowfieldInterval(): CompanionFlowfieldInterval {
  return {
    requestedUpdates: 0,
    completedJobs: 0,
    droppedStale: 0,
    coalescedJobs: 0,
    skippedUnchangedFields: 0,
  };
}

interface CompanionRockCounters {
  dirtyRocks: number;
  affectedPages: number;
  sparseUploads: number;
  fullUploads: number;
  uploadBytes: number;
}

function emptyCompanionRockCounters(): CompanionRockCounters {
  return {
    dirtyRocks: 0,
    affectedPages: 0,
    sparseUploads: 0,
    fullUploads: 0,
    uploadBytes: 0,
  };
}

interface FirePerformanceMetrics {
  simulationMs: number;
  creationMs: number;
}

export interface ArenaDiagnosticsFrameMetrics {
  firePerformance: FirePerformanceMetrics;
  fireVisualMs: number;
  lightingPerformance: LightingPerformanceMetrics;
  lightingStepMs: number;
  scopePerformance: ScopePerformanceMetrics | null;
  aimGraphicsCommandCount: number;
}

/** Read-only Runtime-/Presentation-Werte des abgeschlossenen Scene-Frames. */
export interface ArenaDiagnosticsFrameInput {
  readonly phase: RuntimePhase;
  readonly mode: string;
  readonly mapId: string | null;
  readonly rawDeltaMs: number;
  readonly deltaMs: number;
  readonly localAlive: boolean;
  readonly aimVisible: boolean;
  readonly scopeActive: boolean;
  readonly utilityPlacementActive: boolean;
  readonly ultimatePlacementActive: boolean;
  readonly optionsOpen: boolean;
  readonly enemyCount: number;
  readonly projectileCount: number;
  readonly playerCount: number;
}

type ArenaDiagnosticsSection =
  | 'networkUpdate'
  | 'primaryStep'
  | 'clientRendererSync'
  | 'lobbyUi'
  | 'arenaHud'
  | 'leaderboardCanopy'
  | 'arenaPanel'
  | 'visualEnemy'
  | 'visualEffects'
  | 'aimPreview'
  | 'aimGraphics'
  | 'scope'
  | 'aimIndicators'
  | 'shadow'
  | 'networkFlush';

type ArenaDiagnosticsMark =
  | 'networkStart'
  | 'networkEnd'
  | 'inputEnd'
  | 'sceneStateEnd'
  | 'visualStart'
  | 'visualCameraEnd'
  | 'visualEffectsEnd'
  | 'visualAimEnd'
  | 'visualEnd'
  | 'updateEnd';

/**
 * Kleine, nur bei detaillierter Diagnose erzeugte Frame-Uhr. Sie haelt keine Gameplay-Daten
 * und verwendet Maps erst dann, wenn der detaillierte Pfad ausdruecklich aktiviert ist.
 */
export class ArenaDiagnosticsFrame {
  private readonly startedAt = performance.now();
  private readonly marks = new Map<ArenaDiagnosticsMark, number>();
  private readonly sectionStarts = new Map<ArenaDiagnosticsSection, number>();
  private readonly sectionDurations = new Map<ArenaDiagnosticsSection, number>();

  mark(name: ArenaDiagnosticsMark): void {
    this.marks.set(name, performance.now());
  }

  begin(name: ArenaDiagnosticsSection): void {
    this.sectionStarts.set(name, performance.now());
  }

  end(name: ArenaDiagnosticsSection): void {
    const startedAt = this.sectionStarts.get(name);
    if (startedAt === undefined) return;
    this.sectionStarts.delete(name);
    const duration = Math.max(0, performance.now() - startedAt);
    this.sectionDurations.set(name, (this.sectionDurations.get(name) ?? 0) + duration);
  }

  duration(name: ArenaDiagnosticsSection): number {
    return this.sectionDurations.get(name) ?? 0;
  }

  sinceStart(name: ArenaDiagnosticsMark): number {
    const markedAt = this.marks.get(name);
    return markedAt === undefined ? 0 : Math.max(0, markedAt - this.startedAt);
  }

  between(start: ArenaDiagnosticsMark, end: ArenaDiagnosticsMark): number {
    const startedAt = this.marks.get(start);
    const endedAt = this.marks.get(end);
    return startedAt === undefined || endedAt === undefined ? 0 : Math.max(0, endedAt - startedAt);
  }

  elapsedAt(name: ArenaDiagnosticsMark): number {
    return this.sinceStart(name);
  }
}

export interface ArenaDiagnosticsInput {
  readonly scene: Phaser.Scene;
  readonly game: Phaser.Game;
  readonly graphicsQuality: GraphicsQualityController;
  readonly payloadDiagnostics: ArenaDiagnosticsPayloadDiagnosticsPort;
  // Die folgenden Getter bleiben lazy Closures ueber `renderers`/`visualFeedback`, die zur
  // Konstruktionszeit dieses Controllers noch nicht existieren (siehe `ArenaScene.create()`).
  readonly getShadowSystem: PerformanceAblationDeps['getShadowSystem'];
  readonly getLightingSystem: PerformanceAblationDeps['getLightingSystem'];
  readonly getPostFxController: NonNullable<PerformanceAblationDeps['getPostFxController']>;
  readonly getGpuParticleSuppressor: NonNullable<PerformanceAblationDeps['getGpuParticleSuppressor']>;
  readonly getVectorLighting: NonNullable<PerformanceAblationDeps['getVectorLighting']>;
  readonly chunkDiagnostics: ChunkRenderingDiagnostics;
  readonly getGpuVfxStats: () => Record<string, GpuVfxPoolStats> | null;
  readonly getFlowFieldDiagnostics: () => ArenaDiagnosticsFlowFieldPort | null;
  readonly getRockVisualSystem: () => ArenaDiagnosticsRockVisualSystemPort | null;
  readonly getHostPerformanceMetrics: () => HostUpdatePerformanceMetrics;
  readonly getClientPerformanceMetrics: () => ClientUpdatePerformanceMetrics;
  readonly getFrameMetrics: () => ArenaDiagnosticsFrameMetrics;
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
  private frame: ArenaDiagnosticsFrame | null = null;
  private destroyed = false;

  private lastScenePerformanceCountAtMs = Number.NEGATIVE_INFINITY;
  private scenePerformanceCounts = {
    visibleObjectCount: 0,
    willRenderObjectCount: 0,
    inCameraBoundsObjectCount: 0,
    hiddenObjectCount: 0,
    particleEmitterCount: 0,
    aliveParticleCount: 0,
    activeFilterCount: 0,
    internalFilterCount: 0,
    externalFilterCount: 0,
    filteredObjectCount: 0,
    cameraFilterCount: 0,
    scanMs: 0,
    filterBreakdown: null as string | null,
  };
  private lastTransportPerformanceSampleAtMs = Number.NEGATIVE_INFINITY;
  private lastTransportByteSampleAtMs = Number.NEGATIVE_INFINITY;
  private lastTransportBytesSent = 0;
  private lastTransportBytesReceived = 0;
  private lastTransportDroppedFastMessages = 0;
  private transportPerformanceCounts: TransportPerformanceCounts = emptyTransportPerformanceCounts();
  private nextCompanionSubsystemSampleAtMs = 0;
  private companionBaselineRecordingId = -1;
  private companionFlowfieldSource: object | null = null;
  private companionRockSource: object | null = null;
  private companionVfxSource: object | null = null;
  private companionBackpressureActive = false;
  private companionFlowfieldCounters = emptyCompanionFlowfieldCounters();
  private companionFlowfieldInterval = emptyCompanionFlowfieldInterval();
  private companionStaleFlowfields = new Set<string>();
  private companionFlowfieldGauge = { ageMs: 0, queueDepth: 0 };
  private companionRockCounters = emptyCompanionRockCounters();
  private companionRockInterval = emptyCompanionRockCounters();
  private companionVfxCounters = { epoch: 0, spawns: 0, capacityDrops: 0 };
  private companionVfxInterval = { spawns: 0, capacityDrops: 0 };
  private companionVisiblePages = 0;
  private companionActiveVfx = 0;

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
      this.seedCompanionBaselines(recordingId);
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
      () => this.captureSceneInspection(),
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

  /** Beginnt den optionalen Detail-Frame; der normale und der Companion-Pfad bleiben billig. */
  beginFrame(): ArenaDiagnosticsFrame | null {
    if (this.destroyed || !this.runtimeProfiler?.wantsDetailedSampling()) return null;
    this.frame = new ArenaDiagnosticsFrame();
    return this.frame;
  }

  /**
   * Schliesst genau einen Frame ab. Der Scene-Caller liefert nur den aktuellen Runtime-Read;
   * Sampling, Counter, Timing-Auswertung und Profiler-Record gehoeren vollstaendig hierher.
   */
  endFrame(input: ArenaDiagnosticsFrameInput): void {
    if (this.destroyed) return;
    const frame = this.frame;
    this.frame = null;
    if (frame) {
      this.recordDetailedFrame(frame, input);
      return;
    }
    if (this.runtimeProfiler?.isDiagnosticsActive()) this.recordCompanionFrame(input);
  }

  private recordDetailedFrame(frame: ArenaDiagnosticsFrame, input: ArenaDiagnosticsFrameInput): void {
    const profiler = this.runtimeProfiler;
    if (!profiler) return;

    const diagnosticsStartedAt = performance.now();
    const role = bridge.isHost() ? 'host' : 'client';
    const hostMetricsActive = role === 'host' && input.phase === 'arena';
    const clientMetricsActive = role === 'client' && input.phase === 'arena';
    const metrics = this.input.getFrameMetrics();
    const hostPerformance = this.input.getHostPerformanceMetrics();
    const clientPerformance = this.input.getClientPerformanceMetrics();
    const sceneCounts = this.sampleScenePerformanceCounts(performance.now(), true);
    const transportCounts = this.sampleTransportPerformanceCounts(performance.now());
    let sceneBreakdown: string | null = null;
    let sceneBreakdownScanMs = 0;
    if (profiler.shouldCaptureSceneBreakdown(role, input.deltaMs)) {
      const breakdownStartedAt = performance.now();
      sceneBreakdown = this.describeSceneObjectBreakdown();
      sceneBreakdownScanMs = performance.now() - breakdownStartedAt;
    }
    const frameLifecycle = profiler.takeLastFrameLifecycleMetrics(frame.elapsedAt('updateEnd'));
    const detailTimings = {
      scenePreludeMs: frame.sinceStart('networkStart'),
      sceneStateMs: frame.between('networkEnd', 'sceneStateEnd'),
      postRoleMs: Math.max(0, frame.between('sceneStateEnd', 'visualStart') - frame.duration('primaryStep')),
      diagnosticsMs: 0,
      inputCameraMs: frame.between('networkEnd', 'inputEnd'),
      lobbyUiMs: frame.duration('lobbyUi'),
      arenaHudMs: frame.duration('arenaHud'),
      leaderboardCanopyMs: frame.duration('leaderboardCanopy'),
      arenaPanelMs: frame.duration('arenaPanel'),
      hostCoordinatorMs: hostMetricsActive ? hostPerformance.totalMs : 0,
      hostEnemyAiMs: hostMetricsActive ? hostPerformance.enemyAiMs : 0,
      hostNavFlowFieldMs: hostMetricsActive ? hostPerformance.navFlowFieldMs : 0,
      hostNavWorkerMs: hostMetricsActive ? hostPerformance.navWorkerComputeMs : 0,
      hostPlayerSystemsMs: hostMetricsActive ? hostPerformance.playerSystemsMs : 0,
      hostPhysicsMs: hostMetricsActive ? hostPerformance.physicsMs : 0,
      hostCombatProjectilesMs: hostMetricsActive ? hostPerformance.combatProjectilesMs : 0,
      hostExplosionsMs: hostMetricsActive ? hostPerformance.explosionsMs : 0,
      hostAreaEffectsMs: hostMetricsActive ? hostPerformance.areaEffectsMs : 0,
      hostWorldVisualsMs: hostMetricsActive ? hostPerformance.worldVisualsMs : 0,
      hostHudMs: hostMetricsActive ? hostPerformance.hudMs : 0,
      hostEffectFlushMs: hostMetricsActive ? hostPerformance.effectFlushMs : 0,
      hostSnapshotBuildMs: hostMetricsActive ? hostPerformance.snapshotBuildMs : 0,
      clientCoordinatorMs: clientMetricsActive ? clientPerformance.totalMs : 0,
      clientSnapshotMs: clientMetricsActive ? clientPerformance.snapshotMs : 0,
      clientPlayersMs: clientMetricsActive ? clientPerformance.playersMs : 0,
      clientProjectilesEffectsMs: clientMetricsActive ? clientPerformance.projectilesEffectsMs : 0,
      clientWorldStateMs: clientMetricsActive ? clientPerformance.worldStateMs : 0,
      clientInterpolationMs: clientMetricsActive ? clientPerformance.interpolationMs : 0,
      clientHudMs: clientMetricsActive ? clientPerformance.hudMs : 0,
      clientRendererSyncMs: frame.duration('clientRendererSync'),
      clientPostSyncMs: role === 'client' ? clientPerformance.postSyncMs : 0,
      aimPreviewMs: frame.duration('aimPreview'),
      aimGraphicsMs: frame.duration('aimGraphics'),
      scopeMs: frame.duration('scope'),
      scopeRasterMs: metrics.scopePerformance?.rasterMs ?? 0,
      scopeUploadMs: metrics.scopePerformance?.uploadMs ?? 0,
      aimIndicatorsMs: frame.duration('aimIndicators'),
      lightingExpireMs: metrics.lightingPerformance.expireMs,
      lightingQueueMs: metrics.lightingPerformance.queueMs,
      lightingCommandBuildMs: metrics.lightingPerformance.commandBuildMs,
      lightingDirectMs: metrics.lightingPerformance.directMs,
      lightingOcclusionMs: metrics.lightingPerformance.occlusionMs,
      lightingShadowGeometryMs: metrics.lightingPerformance.shadowGeometryMs,
      lightingOcclusionRefreshes: metrics.lightingPerformance.occlusionRefreshes,
      lightingOcclusionCacheHits: metrics.lightingPerformance.occlusionCacheHits,
      lightingMaxOcclusionCacheAgeMs: metrics.lightingPerformance.maxOcclusionCacheAgeMs,
      sceneCountScanMs: sceneCounts.scanMs,
      sceneBreakdownScanMs,
      transportSampleMs: transportCounts.sampleMs,
    };
    const detailCounts = {
      willRenderObjectCount: sceneCounts.willRenderObjectCount,
      inCameraBoundsObjectCount: sceneCounts.inCameraBoundsObjectCount,
      hiddenObjectCount: sceneCounts.hiddenObjectCount,
      internalFilterCount: sceneCounts.internalFilterCount,
      externalFilterCount: sceneCounts.externalFilterCount,
      filteredObjectCount: sceneCounts.filteredObjectCount,
      cameraFilterCount: sceneCounts.cameraFilterCount,
      aimGraphicsCommandCount: metrics.aimGraphicsCommandCount,
      scopeRefreshCount: metrics.scopePerformance?.refreshed ? 1 : 0,
      scopeTexturePixels: metrics.scopePerformance?.texturePixels ?? 0,
      directLightCount: metrics.lightingPerformance.directLights,
      occludingLightCount: metrics.lightingPerformance.occludingLights,
      fallbackOccludingLightCount: metrics.lightingPerformance.fallbackOccludingLights,
      radialLightCount: metrics.lightingPerformance.radialLights,
      coneLightCount: metrics.lightingPerformance.coneLights,
      lightShadowQuadCount: metrics.lightingPerformance.shadowQuads,
      lightFalloffQuadCount: metrics.lightingPerformance.falloffQuads,
      lightingOcclusionRefreshCount: metrics.lightingPerformance.occlusionRefreshes,
      lightingOcclusionCacheHitCount: metrics.lightingPerformance.occlusionCacheHits,
      activeExplosionOcclusionCacheCount: metrics.lightingPerformance.activeExplosionCaches,
      explosionOcclusionRefreshCount: metrics.lightingPerformance.explosionOcclusionRefreshes,
      staticOcclusionRefreshCount: metrics.lightingPerformance.staticOcclusionRefreshes,
      dynamicOcclusionRefreshCount: metrics.lightingPerformance.dynamicOcclusionRefreshes,
      dynamicLightOccluderTestCount: metrics.lightingPerformance.dynamicOccluderTests,
      dynamicLightOccluderHitCount: metrics.lightingPerformance.dynamicOccluderHits,
      lightingCommandCount: metrics.lightingPerformance.commandCount,
      lightMapPixelCount: metrics.lightingPerformance.lightMapPixels,
      lightingScratchPixelCount: metrics.lightingPerformance.scratchPixels,
      newNetworkSnapshotCount: clientMetricsActive && clientPerformance.newSnapshot ? 1 : 0,
      hostNetworkTickCount: hostMetricsActive && hostPerformance.networkTick ? 1 : 0,
      hostExplosionEventCount: hostMetricsActive ? hostPerformance.explosionEventCount : 0,
      transportLinkCount: transportCounts.linkCount,
      transportBackpressureLinkCount: transportCounts.backpressureLinkCount,
      transportReliableBufferedBytes: transportCounts.reliableBufferedBytes,
      transportFastBufferedBytes: transportCounts.fastBufferedBytes,
      transportDroppedFastMessages: transportCounts.droppedFastMessages,
      transportSentBytesPerSec: transportCounts.sentBytesPerSec,
      transportReceivedBytesPerSec: transportCounts.receivedBytesPerSec,
      transportMedianRttMs: transportCounts.medianRttMs,
      transportMedianAppPingMs: transportCounts.medianAppPingMs,
    };
    detailTimings.diagnosticsMs = performance.now() - diagnosticsStartedAt;
    const localId = bridge.getLocalPlayerId();
    const runtimeContext: ArenaRuntimeContext = {
      localAlive: input.localAlive,
      aimVisible: input.aimVisible,
      scopeActive: input.scopeActive,
      utilityPlacementActive: input.utilityPlacementActive,
      ultimatePlacementActive: input.ultimatePlacementActive,
      optionsOpen: input.optionsOpen,
      pageVisible: typeof document === 'undefined' || document.visibilityState === 'visible',
      documentFocused: typeof document === 'undefined' || document.hasFocus(),
      weapon1Id: bridge.getPlayerLoadoutSlot(localId, 'weapon1') ?? null,
      weapon2Id: bridge.getPlayerLoadoutSlot(localId, 'weapon2') ?? null,
      utilityId: bridge.getPlayerLoadoutSlot(localId, 'utility') ?? null,
      ultimateId: bridge.getPlayerLoadoutSlot(localId, 'ultimate') ?? null,
    };
    const rockVisualSystem = this.input.getRockVisualSystem();
    const sample: ArenaRuntimeSample = {
      role,
      phase: input.phase,
      quality: this.input.graphicsQuality.getLevel(),
      mode: input.mode,
      mapId: input.mapId,
      ablation: this.performanceAblation?.getCurrentCategory() ?? 'baseline',
      rawDeltaMs: Number.isFinite(input.rawDeltaMs) && input.rawDeltaMs > 0 ? input.rawDeltaMs : input.deltaMs,
      deltaMs: input.deltaMs,
      updateMs: frame.elapsedAt('updateEnd'),
      gameStepMs: frameLifecycle.gameStepMs,
      phaserSceneUpdateMs: frameLifecycle.sceneManagerUpdateMs,
      phaserSceneSystemsMs: frameLifecycle.sceneSystemsAndPluginsMs,
      rendererSetupMs: frameLifecycle.rendererSetupMs,
      betweenFramesMs: frameLifecycle.betweenFramesMs,
      renderSubmitMs: profiler.takeLastRenderSubmitMs(),
      roleStepMs: frame.duration('primaryStep'),
      networkUpdateMs: frame.duration('networkUpdate'),
      networkFlushMs: frame.duration('networkFlush'),
      visualStepMs: frame.between('visualStart', 'visualEnd'),
      visualCameraMs: frame.between('visualStart', 'visualCameraEnd'),
      visualEnemyMs: frame.duration('visualEnemy'),
      visualEffectsMs: Math.max(0, frame.between('visualCameraEnd', 'visualEffectsEnd') - frame.duration('visualEnemy')),
      visualAimMs: frame.between('visualEffectsEnd', 'visualAimEnd'),
      visualHudMs: frame.between('visualAimEnd', 'visualEnd'),
      shadowStepMs: frame.duration('shadow'),
      lightingStepMs: metrics.lightingStepMs,
      fireSimulationMs: metrics.firePerformance.simulationMs,
      fireCreationMs: metrics.firePerformance.creationMs,
      fireVisualMs: metrics.fireVisualMs,
      enemyCount: input.enemyCount,
      projectileCount: input.projectileCount,
      playerCount: input.playerCount,
      displayObjectCount: countSceneDisplayObjects(this.input.scene),
      visibleObjectCount: sceneCounts.visibleObjectCount,
      particleEmitterCount: sceneCounts.particleEmitterCount,
      aliveParticleCount: sceneCounts.aliveParticleCount,
      activeFilterCount: sceneCounts.activeFilterCount,
      activeLightCount: metrics.lightingPerformance.activeLights,
      renderedLightCount: metrics.lightingPerformance.renderedLights,
      drawCallCount: profiler.takeLastDrawCallCount(),
      details: { timings: detailTimings, counts: detailCounts },
      context: runtimeContext,
      lightPresetCounts: metrics.lightingPerformance.presetCounts,
      filterBreakdown: sceneCounts.filterBreakdown,
      sceneBreakdown,
      diagnosticContext: {
        rockRenderer: rockVisualSystem?.getMode() ?? getRockRendererMode(),
        rockGpuPageSize: rockVisualSystem?.getPageSize() ?? getRockGpuPageSize(),
      },
    };
    profiler.record(sample);
  }

  private seedCompanionBaselines(recordingId: number): void {
    const flowfieldSource = this.input.getFlowFieldDiagnostics();
    const rockSource = this.input.getRockVisualSystem();
    const vfxSource = this.gpuVfx;
    const flowfield = flowfieldSource?.getDiagnostics(performance.now()) ?? null;
    const rockGpu = rockSource?.getGpuDiagnostics() ?? null;
    const vfxCounters = vfxSource?.getCompanionCounters() ?? { epoch: 0, spawns: 0, capacityDrops: 0 };
    this.companionBaselineRecordingId = recordingId;
    const transportLinks = bridge.getTransportDiagnostics();
    this.lastTransportBytesSent = transportLinks.reduce((sum, link) => sum + link.bytesSent, 0);
    this.lastTransportBytesReceived = transportLinks.reduce((sum, link) => sum + link.bytesReceived, 0);
    this.lastTransportDroppedFastMessages = transportLinks.reduce((sum, link) => sum + link.droppedFastMessages, 0);
    this.lastTransportByteSampleAtMs = performance.now();
    this.companionFlowfieldSource = flowfieldSource;
    this.companionRockSource = rockSource;
    this.companionVfxSource = vfxSource;
    this.companionFlowfieldCounters = {
      generationId: flowfield?.generationId ?? 0,
      requestedUpdates: flowfield?.requestedUpdates ?? 0,
      startedJobs: flowfield?.startedJobs ?? 0,
      completedJobs: flowfield?.completedJobs ?? 0,
      droppedStale: flowfield?.droppedStale ?? 0,
      coalescedJobs: flowfield?.coalescedJobs ?? 0,
      skippedUnchangedFields: flowfield?.skippedUnchangedFields ?? 0,
      workerComputeTotalMs: flowfield?.workerComputeTotalMs ?? 0,
      roundTripTotalMs: flowfield?.roundTripTotalMs ?? 0,
    };
    this.companionRockCounters = {
      dirtyRocks: rockGpu?.dirtyRocks ?? 0,
      affectedPages: rockGpu?.affectedPages ?? 0,
      sparseUploads: rockGpu?.sparseUploads ?? 0,
      fullUploads: rockGpu?.fullUploads ?? 0,
      uploadBytes: rockGpu?.estimatedUploadBytes ?? 0,
    };
    this.companionVfxCounters = {
      epoch: vfxCounters.epoch,
      spawns: vfxCounters.spawns,
      capacityDrops: vfxCounters.capacityDrops,
    };
    this.companionRockInterval = emptyCompanionRockCounters();
    this.companionVfxInterval = { spawns: 0, capacityDrops: 0 };
    this.companionFlowfieldInterval = emptyCompanionFlowfieldInterval();
    this.companionStaleFlowfields.clear();
  }

  private recordCompanionFrame(input: ArenaDiagnosticsFrameInput): void {
    const profiler = this.runtimeProfiler;
    const role = bridge.isHost() ? 'host' : 'client';
    const rawDelta = input.rawDeltaMs;
    const hostPerformance = role === 'host' ? this.input.getHostPerformanceMetrics() : null;
    const clientPerformance = role === 'client' ? this.input.getClientPerformanceMetrics() : null;
    const performanceNow = performance.now();
    const sampleSubsystems = performanceNow >= this.nextCompanionSubsystemSampleAtMs;
    if (sampleSubsystems) this.nextCompanionSubsystemSampleAtMs = performanceNow + 250;
    const transport = sampleSubsystems
      ? this.sampleTransportPerformanceCounts(performanceNow)
      : {
        ...this.transportPerformanceCounts,
        droppedFastMessages: 0,
        sentBytes: 0,
        receivedBytes: 0,
        sampleMs: 0,
      };
    const backpressureActive = transport.backpressureLinkCount > 0;
    if (backpressureActive !== this.companionBackpressureActive) {
      this.companionBackpressureActive = backpressureActive;
      if (backpressureActive) {
        profiler?.recordSemanticEvent('network:backpressure', {
          bufferedBytes: transport.reliableBufferedBytes + transport.fastBufferedBytes,
          linkCount: transport.backpressureLinkCount,
        });
      }
    }
    let flowfield: FlowFieldDiagnostics | null = null;
    let flowfieldJobs = 0;
    let flowfieldComputeMs = 0;
    let flowfieldRoundTripMs = 0;
    if (sampleSubsystems) {
      flowfield = this.input.getFlowFieldDiagnostics()?.getDiagnostics(performanceNow) ?? null;
      const flowfieldSource = this.input.getFlowFieldDiagnostics();
      const rockSource = this.input.getRockVisualSystem();
      const vfxSource = this.gpuVfx;
      const rockGpu = rockSource?.getGpuDiagnostics() ?? null;
      const vfxCounters = vfxSource?.getCompanionCounters() ?? { epoch: 0, spawns: 0, capacityDrops: 0 };
      const recordingId = profiler?.getRecordingId() ?? 0;
      const previousFlowfieldCounters = this.companionFlowfieldCounters;
      const previousVfxCounters = this.companionVfxCounters;
      const sessionBaseline = this.companionBaselineRecordingId !== recordingId;
      const flowfieldSourceChanged = this.companionFlowfieldSource !== flowfieldSource;
      const rockSourceChanged = this.companionRockSource !== rockSource;
      const vfxSourceChanged = this.companionVfxSource !== vfxSource;
      const flowfieldEpochChanged = flowfield !== null
        && flowfield.generationId !== previousFlowfieldCounters.generationId;
      const vfxEpochChanged = previousVfxCounters.epoch !== vfxCounters.epoch;
      const newBaseline = sessionBaseline || flowfieldSourceChanged || rockSourceChanged || vfxSourceChanged || vfxEpochChanged;
      if (newBaseline) {
        this.companionBaselineRecordingId = profiler?.getRecordingId() ?? 0;
        this.companionFlowfieldSource = flowfieldSource;
        this.companionRockSource = rockSource;
        this.companionVfxSource = vfxSource;
        this.companionFlowfieldCounters = {
          generationId: flowfield?.generationId ?? 0,
          requestedUpdates: flowfield?.requestedUpdates ?? 0,
          startedJobs: flowfield?.startedJobs ?? 0,
          completedJobs: flowfield?.completedJobs ?? 0,
          droppedStale: flowfield?.droppedStale ?? 0,
          coalescedJobs: flowfield?.coalescedJobs ?? 0,
          skippedUnchangedFields: flowfield?.skippedUnchangedFields ?? 0,
          workerComputeTotalMs: flowfield?.workerComputeTotalMs ?? 0,
          roundTripTotalMs: flowfield?.roundTripTotalMs ?? 0,
        };
        this.companionRockCounters = {
          dirtyRocks: rockGpu?.dirtyRocks ?? 0,
          affectedPages: rockGpu?.affectedPages ?? 0,
          sparseUploads: rockGpu?.sparseUploads ?? 0,
          fullUploads: rockGpu?.fullUploads ?? 0,
          uploadBytes: rockGpu?.estimatedUploadBytes ?? 0,
        };
        this.companionVfxCounters = {
          epoch: vfxCounters.epoch,
          spawns: vfxCounters.spawns,
          capacityDrops: vfxCounters.capacityDrops,
        };
        this.companionRockInterval = emptyCompanionRockCounters();
        this.companionVfxInterval = sessionBaseline || (!vfxSourceChanged && !vfxEpochChanged)
          ? { spawns: 0, capacityDrops: 0 }
          : { spawns: vfxCounters.spawns, capacityDrops: vfxCounters.capacityDrops };
        this.companionFlowfieldInterval = emptyCompanionFlowfieldInterval();
        this.companionStaleFlowfields.clear();
      }
      if (flowfield) {
        const sameFlowfieldEpoch = !sessionBaseline && !flowfieldSourceChanged && !flowfieldEpochChanged;
        const flowfieldBase = sameFlowfieldEpoch
          ? previousFlowfieldCounters
          : {
            requestedUpdates: 0,
            startedJobs: 0,
            completedJobs: 0,
            droppedStale: 0,
            coalescedJobs: 0,
            skippedUnchangedFields: 0,
            workerComputeTotalMs: 0,
            roundTripTotalMs: 0,
          };
        flowfieldJobs = Math.max(0, flowfield.startedJobs - flowfieldBase.startedJobs);
        flowfieldComputeMs = Math.max(0, flowfield.workerComputeTotalMs - flowfieldBase.workerComputeTotalMs);
        flowfieldRoundTripMs = Math.max(0, flowfield.roundTripTotalMs - flowfieldBase.roundTripTotalMs);
        const flowfieldRequestedUpdates = Math.max(0, flowfield.requestedUpdates - flowfieldBase.requestedUpdates);
        const flowfieldCompletedJobs = Math.max(0, flowfield.completedJobs - flowfieldBase.completedJobs);
        const flowfieldDroppedStale = Math.max(0, flowfield.droppedStale - flowfieldBase.droppedStale);
        const flowfieldCoalescedJobs = Math.max(0, flowfield.coalescedJobs - flowfieldBase.coalescedJobs);
        const flowfieldSkippedUnchangedFields = Math.max(0, flowfield.skippedUnchangedFields - flowfieldBase.skippedUnchangedFields);
        this.companionFlowfieldInterval = {
          requestedUpdates: flowfieldRequestedUpdates,
          completedJobs: flowfieldCompletedJobs,
          droppedStale: flowfieldDroppedStale,
          coalescedJobs: flowfieldCoalescedJobs,
          skippedUnchangedFields: flowfieldSkippedUnchangedFields,
        };
        this.companionFlowfieldCounters.generationId = flowfield.generationId;
        this.companionFlowfieldCounters.requestedUpdates = flowfield.requestedUpdates;
        this.companionFlowfieldCounters.startedJobs = flowfield.startedJobs;
        this.companionFlowfieldCounters.completedJobs = flowfield.completedJobs;
        this.companionFlowfieldCounters.droppedStale = flowfield.droppedStale;
        this.companionFlowfieldCounters.coalescedJobs = flowfield.coalescedJobs;
        this.companionFlowfieldCounters.skippedUnchangedFields = flowfield.skippedUnchangedFields;
        this.companionFlowfieldCounters.workerComputeTotalMs = flowfield.workerComputeTotalMs;
        this.companionFlowfieldCounters.roundTripTotalMs = flowfield.roundTripTotalMs;
        this.companionFlowfieldGauge.queueDepth = flowfield.backlogTicks;
        this.companionFlowfieldGauge.ageMs = Math.max(0, ...Object.values(flowfield.fields)
          .map((field) => field.recomputePendingAgeMs ?? 0));
        for (const [fieldId, field] of Object.entries(flowfield.fields)) {
          if (field.stale && !this.companionStaleFlowfields.has(fieldId)) {
            profiler?.recordSemanticEvent('flowfield:stale', {
              fieldId,
              goalMode: field.goalMode,
              activeAgeMs: field.activeAgeMs,
              staleAfterMs: field.staleAfterMs,
            });
          }
          if (field.stale) this.companionStaleFlowfields.add(fieldId);
          else this.companionStaleFlowfields.delete(fieldId);
        }
      }
      if (!newBaseline) this.updateCompanionRockCounters(rockGpu);
      else if (!sessionBaseline && rockSourceChanged) {
        this.companionRockInterval = {
          dirtyRocks: rockGpu?.dirtyRocks ?? 0,
          affectedPages: rockGpu?.affectedPages ?? 0,
          sparseUploads: rockGpu?.sparseUploads ?? 0,
          fullUploads: rockGpu?.fullUploads ?? 0,
          uploadBytes: rockGpu?.estimatedUploadBytes ?? 0,
        };
      }
      if (!newBaseline) {
        this.companionVfxInterval = {
          spawns: Math.max(0, vfxCounters.spawns - previousVfxCounters.spawns),
          capacityDrops: Math.max(0, vfxCounters.capacityDrops - previousVfxCounters.capacityDrops),
        };
      }
      this.companionVfxCounters = {
        epoch: vfxCounters.epoch,
        spawns: vfxCounters.spawns,
        capacityDrops: vfxCounters.capacityDrops,
      };
      const vfxStats = vfxSource?.getStats() ?? null;
      this.companionActiveVfx = vfxStats
        ? Object.values(vfxStats).reduce((sum, stats) => sum + stats.liveCount, 0)
        : 0;
      this.companionVisiblePages = rockGpu?.visiblePages ?? 0;
    }
    if (!profiler || (!hostPerformance && !clientPerformance)) return;
    profiler.record({
      role,
      phase: input.phase,
      quality: this.input.graphicsQuality.getLevel(),
      mode: input.mode,
      mapId: input.mapId,
      ablation: this.performanceAblation?.getCurrentCategory() ?? 'baseline',
      rawDeltaMs: Number.isFinite(rawDelta) && rawDelta > 0 ? rawDelta : input.deltaMs,
      deltaMs: input.deltaMs,
      updateMs: role === 'host' ? hostPerformance?.totalMs ?? 0 : clientPerformance?.totalMs ?? 0,
      gameStepMs: Number.isFinite(rawDelta) && rawDelta > 0 ? rawDelta : input.deltaMs,
      phaserSceneUpdateMs: 0,
      phaserSceneSystemsMs: 0,
      rendererSetupMs: 0,
      betweenFramesMs: 0,
      renderSubmitMs: 0,
      roleStepMs: role === 'host' ? hostPerformance?.totalMs ?? 0 : clientPerformance?.totalMs ?? 0,
      networkUpdateMs: 0,
      networkFlushMs: 0,
      visualStepMs: 0,
      visualCameraMs: 0,
      visualEnemyMs: 0,
      visualEffectsMs: 0,
      visualAimMs: 0,
      visualHudMs: 0,
      shadowStepMs: 0,
      lightingStepMs: 0,
      fireSimulationMs: 0,
      fireCreationMs: 0,
      fireVisualMs: 0,
      enemyCount: input.enemyCount,
      projectileCount: input.projectileCount,
      playerCount: input.playerCount,
      displayObjectCount: 0,
      visibleObjectCount: 0,
      particleEmitterCount: 0,
      aliveParticleCount: 0,
      activeFilterCount: 0,
      activeLightCount: 0,
      renderedLightCount: 0,
      drawCallCount: 0,
      details: {
        timings: {
          hostCpuMs: hostPerformance?.totalMs ?? 0,
          clientCpuMs: clientPerformance?.totalMs ?? 0,
          snapshotBuildMs: hostPerformance?.snapshotBuildMs ?? 0,
          flowfieldComputeMs,
          flowfieldRoundTripMs,
          flowfieldAgeMs: this.companionFlowfieldGauge.ageMs,
          flowfieldPendingAgeMs: this.companionFlowfieldGauge.ageMs,
          flowfieldQueueDepth: this.companionFlowfieldGauge.queueDepth,
          flowfieldBacklogTicks: this.companionFlowfieldGauge.queueDepth,
        },
        counts: {
          newNetworkSnapshotCount: clientPerformance?.newSnapshot ? 1 : 0,
          hostNetworkTickCount: hostPerformance?.networkTick ? 1 : 0,
          transportReliableBufferedBytes: transport.reliableBufferedBytes,
          transportFastBufferedBytes: transport.fastBufferedBytes,
          transportDroppedFastMessages: transport.droppedFastMessages,
          transportSentBytes: transport.sentBytes,
          transportReceivedBytes: transport.receivedBytes,
          transportSentBytesPerSec: transport.sentBytesPerSec,
          transportReceivedBytesPerSec: transport.receivedBytesPerSec,
          transportMedianRttMs: transport.medianRttMs,
          transportMedianAppPingMs: transport.medianAppPingMs,
          flowfieldJobs,
          flowfieldRequestedUpdates: this.companionFlowfieldInterval.requestedUpdates,
          flowfieldCompletedJobs: this.companionFlowfieldInterval.completedJobs,
          flowfieldDroppedStale: this.companionFlowfieldInterval.droppedStale,
          flowfieldCoalescedJobs: this.companionFlowfieldInterval.coalescedJobs,
          flowfieldSkippedUnchangedFields: this.companionFlowfieldInterval.skippedUnchangedFields,
          dirtyRocks: this.companionRockInterval.dirtyRocks,
          affectedPages: this.companionRockInterval.affectedPages,
          sparseUploads: this.companionRockInterval.sparseUploads,
          fullUploads: this.companionRockInterval.fullUploads,
          uploadBytes: this.companionRockInterval.uploadBytes,
          vfxSpawns: this.companionVfxInterval.spawns,
          capacityDrops: this.companionVfxInterval.capacityDrops,
          visiblePages: this.companionVisiblePages,
          activeVfx: this.companionActiveVfx,
        },
      },
      context: {
        localAlive: input.localAlive,
        aimVisible: false,
        scopeActive: false,
        utilityPlacementActive: false,
        ultimatePlacementActive: false,
        optionsOpen: input.optionsOpen,
        pageVisible: typeof document === 'undefined' || document.visibilityState === 'visible',
        documentFocused: typeof document === 'undefined' || document.hasFocus(),
        weapon1Id: bridge.getPlayerLoadoutSlot(bridge.getLocalPlayerId(), 'weapon1') ?? null,
        weapon2Id: bridge.getPlayerLoadoutSlot(bridge.getLocalPlayerId(), 'weapon2') ?? null,
        utilityId: bridge.getPlayerLoadoutSlot(bridge.getLocalPlayerId(), 'utility') ?? null,
        ultimateId: bridge.getPlayerLoadoutSlot(bridge.getLocalPlayerId(), 'ultimate') ?? null,
      },
      diagnosticContext: {
        rockRenderer: this.input.getRockVisualSystem()?.getMode() ?? getRockRendererMode(),
        rockGpuPageSize: this.input.getRockVisualSystem()?.getPageSize() ?? getRockGpuPageSize(),
      },
    });
    this.companionRockInterval = emptyCompanionRockCounters();
    this.companionVfxInterval = { spawns: 0, capacityDrops: 0 };
    this.companionFlowfieldInterval = emptyCompanionFlowfieldInterval();
  }

  private updateCompanionRockCounters(current: PersistentGpuWorldDiagnostics | null): void {
    if (!current) {
      this.companionVisiblePages = 0;
      this.companionRockInterval = emptyCompanionRockCounters();
      return;
    }
    const previous = this.companionRockCounters;
    this.companionRockInterval = {
      dirtyRocks: Math.max(0, current.dirtyRocks - previous.dirtyRocks),
      affectedPages: Math.max(0, current.affectedPages - previous.affectedPages),
      sparseUploads: Math.max(0, current.sparseUploads - previous.sparseUploads),
      fullUploads: Math.max(0, current.fullUploads - previous.fullUploads),
      uploadBytes: Math.max(0, current.estimatedUploadBytes - previous.uploadBytes),
    };
    this.companionRockCounters = {
      dirtyRocks: current.dirtyRocks,
      affectedPages: current.affectedPages,
      sparseUploads: current.sparseUploads,
      fullUploads: current.fullUploads,
      uploadBytes: current.estimatedUploadBytes,
    };
    this.companionVisiblePages = current.visiblePages;
  }

  /** Explicit one-shot inspection; never called by the normal Companion sampling path. */
  private captureSceneInspection(): void {
    const scene = this.input.scene;
    const typeCounts: Record<string, number> = {};
    let directLayerChildren = 0;
    let visible = 0;
    let active = 0;
    for (const child of scene.children.list) {
      const displayChild = child as Phaser.GameObjects.GameObject & { visible?: boolean; active?: boolean };
      typeCounts[child.type] = (typeCounts[child.type] ?? 0) + 1;
      if (displayChild.visible) visible += 1;
      if (displayChild.active) active += 1;
      const nested = child as Phaser.GameObjects.GameObject & {
        type?: string;
        list?: Phaser.GameObjects.GameObject[];
      };
      if (nested.type !== 'Layer' || !Array.isArray(nested.list)) continue;
      directLayerChildren += nested.list.length;
      for (const grandChild of nested.list) {
        const displayGrandChild = grandChild as Phaser.GameObjects.GameObject & { visible?: boolean; active?: boolean };
        typeCounts[grandChild.type] = (typeCounts[grandChild.type] ?? 0) + 1;
        if (displayGrandChild.visible) visible += 1;
        if (displayGrandChild.active) active += 1;
      }
    }
    this.runtimeProfiler?.setSceneInspection({
      capturedAtIso: new Date().toISOString(),
      topLevelChildren: scene.children.list.length,
      directLayerChildren,
      totalFlatChildren: scene.children.list.length + directLayerChildren,
      visible,
      active,
      typeCounts,
      boundsIncluded: false,
    });
  }

  private describeSceneObjectBreakdown(): string {
    const counts = new Map<string, number>();
    let visibleCount = 0;
    let activeCount = 0;

    forEachSceneDisplayObject(this.input.scene, (child) => {
      const gameObject = child as Phaser.GameObjects.GameObject & {
        visible?: boolean;
        active?: boolean;
        type?: string;
        texture?: { key?: string };
      };

      if (gameObject.visible !== false) visibleCount += 1;
      if (gameObject.active !== false) activeCount += 1;

      const baseType = gameObject.type || gameObject.constructor.name || 'Unknown';
      const textureKey = typeof gameObject.texture?.key === 'string' && gameObject.texture.key.length > 0
        ? gameObject.texture.key
        : null;
      const label = textureKey ? `${baseType}:${textureKey}` : baseType;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });

    const topEntries = [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([label, count]) => `${label}:${count}`)
      .join(', ');

    return `visible=${visibleCount} active=${activeCount} top=${topEntries}`;
  }

  private sampleScenePerformanceCounts(nowMs: number, enabled: boolean): typeof this.scenePerformanceCounts {
    if (!enabled) return { ...this.scenePerformanceCounts, scanMs: 0 };
    if (nowMs - this.lastScenePerformanceCountAtMs < 250) {
      return { ...this.scenePerformanceCounts, scanMs: 0 };
    }

    const scanStartedAt = performance.now();
    let visibleObjectCount = 0;
    let willRenderObjectCount = 0;
    let inCameraBoundsObjectCount = 0;
    let hiddenObjectCount = 0;
    let particleEmitterCount = 0;
    let aliveParticleCount = 0;
    let activeFilterCount = 0;
    let internalFilterCount = 0;
    let externalFilterCount = 0;
    let filteredObjectCount = 0;
    const filterTypes = new Map<string, number>();
    const camera = this.input.scene.cameras.main;
    forEachSceneDisplayObject(this.input.scene, (child) => {
      const gameObject = child as Phaser.GameObjects.GameObject & {
        visible?: boolean;
        type?: string;
        willRender?: (camera: Phaser.Cameras.Scene2D.Camera) => boolean;
        getBounds?: () => Phaser.Geom.Rectangle;
        getAliveParticleCount?: () => number;
        filters?: {
          internal?: { getActive?: () => unknown[] };
          external?: { getActive?: () => unknown[] };
        };
      };
      if (gameObject.visible !== false) visibleObjectCount += 1;
      else hiddenObjectCount += 1;
      if (gameObject.willRender?.(camera) ?? gameObject.visible !== false) willRenderObjectCount += 1;
      if (gameObject.getBounds) {
        try {
          if (Phaser.Geom.Intersects.RectangleToRectangle(gameObject.getBounds(), camera.worldView)) {
            inCameraBoundsObjectCount += 1;
          }
        } catch {
          // Einzelne Spezialobjekte koennen waehrend ihres Abbaus keine Bounds mehr liefern.
        }
      }
      if (gameObject.type === 'ParticleEmitter' || gameObject.getAliveParticleCount) {
        particleEmitterCount += 1;
        aliveParticleCount += gameObject.getAliveParticleCount?.() ?? 0;
      }
      const internal = gameObject.filters?.internal?.getActive?.() ?? [];
      const external = gameObject.filters?.external?.getActive?.() ?? [];
      internalFilterCount += internal.length;
      externalFilterCount += external.length;
      if (internal.length + external.length > 0) filteredObjectCount += 1;
      for (const filter of [...internal, ...external]) {
        const typedFilter = filter as { type?: string; constructor?: { name?: string } };
        const label = typedFilter.type ?? typedFilter.constructor?.name ?? 'UnknownFilter';
        filterTypes.set(label, (filterTypes.get(label) ?? 0) + 1);
      }
    });
    const cameraFilters = (camera as typeof camera & {
      filters?: {
        internal?: { getActive?: () => unknown[] };
        external?: { getActive?: () => unknown[] };
      };
    }).filters;
    const cameraFilterCount = (cameraFilters?.internal?.getActive?.().length ?? 0)
      + (cameraFilters?.external?.getActive?.().length ?? 0);
    activeFilterCount = internalFilterCount + externalFilterCount + cameraFilterCount;
    const filterBreakdown = filterTypes.size > 0
      ? [...filterTypes.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([name, count]) => `${name}:${count}`)
        .join(', ')
      : null;

    this.scenePerformanceCounts = {
      visibleObjectCount,
      willRenderObjectCount,
      inCameraBoundsObjectCount,
      hiddenObjectCount,
      particleEmitterCount,
      aliveParticleCount,
      activeFilterCount,
      internalFilterCount,
      externalFilterCount,
      filteredObjectCount,
      cameraFilterCount,
      scanMs: performance.now() - scanStartedAt,
      filterBreakdown,
    };
    this.lastScenePerformanceCountAtMs = nowMs;
    return this.scenePerformanceCounts;
  }

  private sampleTransportPerformanceCounts(nowMs: number): TransportPerformanceCounts {
    if (nowMs - this.lastTransportPerformanceSampleAtMs < 500) {
      return {
        ...this.transportPerformanceCounts,
        droppedFastMessages: 0,
        sentBytes: 0,
        receivedBytes: 0,
        sampleMs: 0,
      };
    }

    const startedAt = performance.now();
    const links: LinkDiagnostics[] = bridge.getTransportDiagnostics();
    const bytesSent = links.reduce((sum, link) => sum + link.bytesSent, 0);
    const bytesReceived = links.reduce((sum, link) => sum + link.bytesReceived, 0);
    const droppedFastMessages = links.reduce((sum, link) => sum + link.droppedFastMessages, 0);
    const elapsedMs = nowMs - this.lastTransportByteSampleAtMs;
    const canComputeRate = Number.isFinite(elapsedMs) && elapsedMs > 0;
    const measuredRtts = links
      .map(link => link.medianRttMs)
      .filter((value): value is number => value !== null);
    const measuredAppPings = links
      .map(link => link.medianAppPingMs)
      .filter((value): value is number => value !== null);

    this.lastTransportPerformanceSampleAtMs = nowMs;
    this.lastTransportByteSampleAtMs = nowMs;
    this.transportPerformanceCounts = {
      linkCount: links.length,
      backpressureLinkCount: links.filter(link => link.backpressure).length,
      reliableBufferedBytes: links.reduce((sum, link) => sum + link.reliableBufferedBytes, 0),
      fastBufferedBytes: links.reduce((sum, link) => sum + link.fastBufferedBytes, 0),
      droppedFastMessages: Math.max(0, droppedFastMessages - this.lastTransportDroppedFastMessages),
      sentBytes: canComputeRate ? Math.max(0, bytesSent - this.lastTransportBytesSent) : 0,
      receivedBytes: canComputeRate ? Math.max(0, bytesReceived - this.lastTransportBytesReceived) : 0,
      sentBytesPerSec: canComputeRate
        ? Math.max(0, bytesSent - this.lastTransportBytesSent) * 1000 / elapsedMs
        : 0,
      receivedBytesPerSec: canComputeRate
        ? Math.max(0, bytesReceived - this.lastTransportBytesReceived) * 1000 / elapsedMs
        : 0,
      medianRttMs: measuredRtts.length > 0 ? Math.max(...measuredRtts) : 0,
      medianAppPingMs: measuredAppPings.length > 0 ? Math.max(...measuredAppPings) : 0,
      sampleMs: performance.now() - startedAt,
    };
    this.lastTransportBytesSent = bytesSent;
    this.lastTransportBytesReceived = bytesReceived;
    this.lastTransportDroppedFastMessages = droppedFastMessages;
    return this.transportPerformanceCounts;
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
    this.frame = null;

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
