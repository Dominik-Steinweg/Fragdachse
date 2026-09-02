import * as Phaser from 'phaser';
import {
  DEPTH_LIGHTING,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '../config';
import { ensureCanvasTexture, fillRadialGradientTexture } from './EffectUtils';
import type { DynamicLightOccluderSource } from './DynamicLightOccluders';
import type { LightOccluderIndex } from './LightOccluderIndex';
import {
  GLOBAL_LIGHT_INTENSITY_MULT,
  EXPLOSION_OCCLUSION_REFRESH_MS,
  LIGHT_PRESETS,
  MAX_OCCLUDING_LIGHT_RADIUS,
  OCCLUDER_SCRATCH_SIZE,
  OCCLUDER_SHADE_FALLOFF_PX,
  SHADOW_EXTEND_FACTOR,
  type LightPreset,
  type LightPresetKey,
} from './LightingConfig';
import {
  DEFAULT_TIME_OF_DAY_MINUTES,
  NEUTRAL_AMBIENT_COLOR,
  normalizeTimeOfDay,
  resolveSkyState,
  type SkyState,
} from './TimeOfDay';
import {
  getGraphicsQualityController,
  getGraphicsQualityProfile,
  type GraphicsQualityProfile,
} from '../graphics/GraphicsQuality';
import {
  ShadowQuadBuffer,
  SHADOW_QUAD_STRIDE,
  projectCircleShadowQuad,
  projectRectShadowQuads,
} from './lightShadowGeometry';
import {
  type ArenaVisualAttributionCollector,
} from '../scenes/arena/ArenaVisualAttribution';

const TEX_LIGHT_RADIAL = '__light_radial';
const RADIAL_TEX_SIZE = 256;
const CONE_TEX_WIDTH = 256;
const CONE_TEX_HEIGHT = 512;

/**
 * Die Lichtkarte ist bildschirmfest, ihre Lichter werden aber bei `x - camera.scrollX`
 * gestempelt. Seit alle Kamerabewegung über `CameraFeedbackController` als **Scroll-Versatz**
 * läuft, wandern Lichter und Welt gemeinsam, während die Lichtkarte selbst stehen bleibt.
 * Damit gibt es keine unbeleuchteten Randstreifen mehr, und die frühere Overscan-Reserve
 * entfällt.
 *
 * Phasers `camera.shake()` verschob dagegen die gesamte Kameramatrix – inklusive
 * bildschirmfester Objekte – und skalierte den Versatz zusätzlich quadratisch mit der
 * Renderauflösung. Dafür war eine Reserve von rund 154 Designpixeln pro Seite nötig, also
 * etwa die 1,5-fache Füllrate. Der Rand hier ist nur noch die Ausrichtungsreserve.
 */
const LIGHTMAP_OVERSCAN_ALIGNMENT_PX = 8;

/** Ausblendzeit, wenn ein Dauerlicht freigegeben wird – verhindert hartes Poppen. */
const RELEASE_FADE_MS = 140;
/**
 * Sicherheitsnetz gegen Lecks: ein Dauerlicht, das mehrere Frames lang nicht mehr
 * per `setLight` bestätigt wurde, gilt als verwaist. Alle Quellen aktualisieren ihre
 * Lichter pro Frame, der Schwellwert liegt also weit über dem Normalfall.
 */
const KEYED_LIGHT_STALE_MS = 400;

interface ActiveLight {
  key: string | null;
  presetKey: LightPresetKey;
  shape: 'radial' | 'cone';
  x: number;
  y: number;
  radiusPx: number;
  color: number;
  intensity: number;
  angle: number;
  coneAngle: number;
  occludes: boolean;
  priority: number;
  flickerAmount: number;
  flickerHz: number;
  flickerPhase: number;
  /** 0 = Dauerlicht, sonst Abklingdauer ab `bornAt`. */
  durationMs: number;
  decayExponent: number;
  bornAt: number;
  touchedAt: number;
  releasedAt: number;
  /** Pro Frame neu berechnet: Intensität inklusive Profil, Abkling- und Flackerterm. */
  effectiveIntensity: number;
  occlusionCache: OcclusionCache | null;
}

export interface LightOverrides {
  radiusPx?: number;
  color?: number;
  intensity?: number;
  angle?: number;
  durationMs?: number;
  occludes?: boolean;
}

interface OccluderSlot {
  readonly renderTexture: Phaser.GameObjects.RenderTexture;
  readonly image: Phaser.GameObjects.Image;
  readonly graphics: Phaser.GameObjects.Graphics;
}

interface OcclusionCache {
  readonly renderTexture: Phaser.GameObjects.RenderTexture;
  readonly image: Phaser.GameObjects.Image;
  readonly graphics: Phaser.GameObjects.Graphics;
  readonly staticCore: ShadowQuadBuffer;
  readonly staticFalloff: ShadowQuadBuffer;
  valid: boolean;
  lastStaticRevision: number;
  lastDynamicOccluderPresence: boolean;
  sourceX: number;
  sourceY: number;
  sourceRadiusPx: number;
  sourceOccludes: boolean;
  lastRefreshAt: number;
  nextRefreshAt: number;
}

export interface LightingPerformanceMetrics {
  totalMs: number;
  expireMs: number;
  queueMs: number;
  commandBuildMs: number;
  directMs: number;
  occlusionMs: number;
  shadowGeometryMs: number;
  activeLights: number;
  renderedLights: number;
  directLights: number;
  occludingLights: number;
  fallbackOccludingLights: number;
  radialLights: number;
  coneLights: number;
  shadowQuads: number;
  falloffQuads: number;
  dynamicOccluderTests: number;
  dynamicOccluderHits: number;
  occlusionRefreshes: number;
  occlusionCacheHits: number;
  activeExplosionCaches: number;
  explosionOcclusionRefreshes: number;
  staticOcclusionRefreshes: number;
  dynamicOcclusionRefreshes: number;
  maxOcclusionCacheAgeMs: number;
  commandCount: number;
  lightMapPixels: number;
  scratchPixels: number;
  presetCounts: Readonly<Record<string, number>>;
}

function emptyPerformanceMetrics(): LightingPerformanceMetrics {
  return {
    totalMs: 0, expireMs: 0, queueMs: 0, commandBuildMs: 0, directMs: 0, occlusionMs: 0,
    shadowGeometryMs: 0, activeLights: 0, renderedLights: 0, directLights: 0,
    occludingLights: 0, fallbackOccludingLights: 0, radialLights: 0, coneLights: 0,
    shadowQuads: 0, falloffQuads: 0, dynamicOccluderTests: 0, dynamicOccluderHits: 0,
    occlusionRefreshes: 0, occlusionCacheHits: 0, activeExplosionCaches: 0,
    explosionOcclusionRefreshes: 0, staticOcclusionRefreshes: 0,
    dynamicOcclusionRefreshes: 0, maxOcclusionCacheAgeMs: 0,
    commandCount: 0, lightMapPixels: 0, scratchPixels: 0,
    presetCounts: {},
  };
}

/**
 * Dynamische Beleuchtung und Lichtverdeckung über eine Lightmap.
 *
 * Alle Lichter werden in eine halbauflösende Bildschirm-Lightmap komponiert, die als
 * ein einziges Overlay über die Welt gelegt wird. Dadurch werden Spieler, Gegner und
 * Effekte ohne Per-Objekt-Kosten beleuchtet – anders als bei Phasers eingebautem
 * Lighting, das `setLighting(true)` pro Objekt braucht, Render-Batches bricht und
 * keinerlei geometrische Verdeckung kennt.
 *
 * Es gibt genau einen Rechenweg, unabhängig von der Uhrzeit: die Lightmap wird mit dem
 * Ambient der Tageszeit gefüllt, Lichter werden additiv hineingestempelt, das Ergebnis
 * komponiert MULTIPLY über die Welt. Zum Mittag hin ist das Ambient weiß und das
 * Composite damit ein bit-exakter No-Op – der Renderpass entfällt dann komplett. Zur
 * Nacht hin wird es dunkel, und dieselben Lichter tragen entsprechend mehr bei. Siehe
 * `TimeOfDay.ts`.
 *
 * Verdeckende Lichter werden einzeln in eine eigene Scratch-RenderTexture gezeichnet,
 * dort um ihre Schattenpolygone erleichtert und anschließend additiv in die Lightmap
 * kopiert. Die Scratch-Texturen liegen als `renderMode: 'redraw'` knapp unter der
 * Lightmap in der Display-List – so ist garantiert, dass ihre Command-Buffer geleert
 * sind, bevor die Lightmap ihre eigenen Zeichenbefehle ausführt.
 */
export class LightingSystem {
  private timeOfDayMinutes = DEFAULT_TIME_OF_DAY_MINUTES;
  private sky: SkyState = resolveSkyState(DEFAULT_TIME_OF_DAY_MINUTES);

  private lightMap: Phaser.GameObjects.RenderTexture | null = null;
  private readonly slots: OccluderSlot[] = [];
  private readonly occlusionCachePool: OcclusionCache[] = [];
  private activeExplosionCacheCount = 0;

  private readonly lights: ActiveLight[] = [];
  private readonly pool: ActiveLight[] = [];
  private readonly keyed = new Map<string, ActiveLight>();
  private readonly renderQueue: ActiveLight[] = [];

  private occluders: LightOccluderIndex | null = null;
  private dynamicOccluders: DynamicLightOccluderSource | null = null;
  private readonly shadowQuads = new ShadowQuadBuffer();
  private readonly falloffQuads = new ShadowQuadBuffer();
  private lastDynamicOccluderTests = 0;
  private lastDynamicOccluderHits = 0;
  private readonly coneTextureKeys = new Map<number, string>();
  private frameOcclusionRefreshes = 0;
  private frameOcclusionCacheHits = 0;
  private frameExplosionOcclusionRefreshes = 0;
  private frameStaticOcclusionRefreshes = 0;
  private frameDynamicOcclusionRefreshes = 0;
  private frameMaxOcclusionCacheAgeMs = 0;
  private frameOcclusionRefreshMs = 0;
  private frameShadowGeometryMs = 0;
  private frameOcclusionRefreshCommands = 0;
  private frameRefreshShadowQuads = 0;
  private frameRefreshFalloffQuads = 0;
  private frameRefreshDynamicTests = 0;
  private frameRefreshDynamicHits = 0;

  private enabled = false;
  private compositeSuppressed = false;
  private vectorSuppressed = false;
  /**
   * Merker für die Fill-Ersparnis: solange das Ambient gleich bleibt und weder in diesem
   * noch im vorigen Frame ein Licht gerendert wurde, steht in der Lightmap bereits genau
   * das, was hineingehört. Dann werden gar keine Zeichenbefehle erzeugt und
   * `DynamicTexture.render()` steigt bei leerem Command-Buffer sofort aus.
   */
  private lightMapHoldsAmbientOnly = false;
  private lastCostMs = 0;
  private lastPerformance = emptyPerformanceMetrics();
  private performanceMetricsEnabled = false;
  private attributionCollector: ArenaVisualAttributionCollector | null = null;
  private quality: GraphicsQualityProfile;
  private unsubscribeQuality: (() => void) | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.quality = getGraphicsQualityProfile(scene);
    this.unsubscribeQuality = getGraphicsQualityController(scene)?.subscribe((profile) => {
      this.setGraphicsQuality(profile);
    }) ?? null;
    this.ensureTextures();
  }

  // ── Lebenszyklus ───────────────────────────────────────────────────────────

  /** Schaltet die Beleuchtung an (Rundenstart) oder aus (Lobby, Teardown). */
  setActive(active: boolean): void {
    if (this.enabled === active) return;
    this.enabled = active;
    if (!active) this.clear();
    this.syncOverlayVisibility();
  }

  setOccluderIndex(index: LightOccluderIndex | null): void {
    this.occluders = index;
  }

  /** Bewegliche Occluder bleiben ausserhalb des statischen Arena-Indexes. */
  setDynamicOccluderSource(source: DynamicLightOccluderSource | null): void {
    this.dynamicOccluders = source;
  }

  /**
   * Loest eine bewegliche World-Occluderquelle nur dann, wenn sie noch die aktive Quelle ist.
   * Das verhindert, dass ein verspaeteter Teardown einer alten World die Quelle einer neuen
   * World entfernt.
   */
  clearDynamicOccluderSource(source: DynamicLightOccluderSource): void {
    if (this.dynamicOccluders === source) this.dynamicOccluders = null;
  }

  /**
   * Uhrzeit der aktuellen World-Darstellung. Ändert ausschließlich Werte, nie den Rechenweg – siehe
   * {@link resolveSkyState}. Vor `setActive(true)` setzen, damit der erste Frame schon
   * mit dem richtigen Ambient läuft.
   */
  setTimeOfDay(minutes: number): void {
    const normalized = normalizeTimeOfDay(minutes);
    if (this.timeOfDayMinutes === normalized) return;
    this.timeOfDayMinutes = normalized;
    this.sky = resolveSkyState(normalized);
    // Das gemerkte Ambient in der Lightmap ist damit veraltet.
    this.lightMapHoldsAmbientOnly = false;
    this.syncOverlayVisibility();
  }

  getTimeOfDayMinutes(): number {
    return this.timeOfDayMinutes;
  }

  /**
   * Stärke der künstlichen Lichter (Taschenlampen, Zugbeleuchtung). 0 heißt: gar nicht
   * erst anmelden – tagsüber existieren sie wie bisher überhaupt nicht.
   */
  getArtificialLightFactor(): number {
    return this.enabled ? this.sky.artificialLightFactor : 0;
  }

  /**
   * Diagnose-Schalter des Ablationsmodus: unterdrückt das Composite, ohne den
   * Lichtzustand anzutasten. Ohne diesen Weg lässt sich das Overlay nicht ausblenden –
   * `update()` würde es im nächsten Frame sofort wieder sichtbar schalten.
   */
  setCompositeSuppressed(suppressed: boolean): void {
    if (this.compositeSuppressed === suppressed) return;
    this.compositeSuppressed = suppressed;
    this.syncOverlayVisibility();
  }

  /** Targeted diagnosis switch for the vector occlusion path; direct light stamps remain intact. */
  setVectorSuppressed(suppressed: boolean): void {
    this.vectorSuppressed = suppressed;
  }

  setPerformanceMetricsEnabled(enabled: boolean): void {
    if (this.performanceMetricsEnabled === enabled) return;
    this.performanceMetricsEnabled = enabled;
    if (!enabled) {
      this.lastCostMs = 0;
      this.lastPerformance = emptyPerformanceMetrics();
      this.lastDynamicOccluderTests = 0;
      this.lastDynamicOccluderHits = 0;
    }
  }

  setAttributionCollector(collector: ArenaVisualAttributionCollector | null): void {
    this.attributionCollector = collector;
  }

  getLastUpdateCostMs(): number {
    return this.lastCostMs;
  }

  getPerformanceMetrics(): LightingPerformanceMetrics {
    return this.lastPerformance;
  }

  getDebugStats(): { activeLights: number; renderedLights: number; occlusionSlots: number } {
    return {
      activeLights: this.lights.length,
      renderedLights: this.renderQueue.length,
      occlusionSlots: this.slots.length,
    };
  }

  /**
   * Tint für eine Baumkrone an dieser Weltposition.
   *
   * Kronen liegen über dem Lightmap-Overlay, damit der Schatten ihres eigenen Stamms
   * nicht auf ihnen landet. Damit sie trotzdem auf Licht reagieren, bekommen sie einen
   * eigenen Tint: unbeleuchtet auf Umgebungsniveau wie der Boden, unter Licht nur um
   * `canopyLightFactor` gedämpft heller. Das nähert die Höhe der Krone über den
   * bodennahen Lichtquellen an, ohne eine zweite Lightmap zu brauchen.
   *
   * Verdeckung wird bewusst ignoriert: eine Krone liegt über Felsen und Stämmen.
   */
  resolveCanopyTint(x: number, y: number): number {
    if (!this.enabled) return 0xffffff;

    // Ohne Licht bleibt die Krone auf Umgebungsniveau – nicht auf Weiß. Sonst leuchten
    // die Kronen bei dunklem Ambient auf voller Helligkeit über einem dunklen Boden.
    // Der Kurzschluss bei leerer Lichtliste spart zugleich `sampleLightAmount()`, das
    // pro Krone über alle aktiven Lichter läuft.
    const factor = this.sky.canopyLightFactor;
    if (factor <= 0 || this.lights.length === 0) return this.sky.ambientColor;

    const lit = Phaser.Math.Clamp(this.sampleLightAmount(x, y) * factor, 0, 1);
    return mixChannels(this.sky.ambientColor, 0xffffff, lit);
  }

  /**
   * Summierte Lichtmenge an einer Weltposition (0…1), ohne Verdeckung.
   * Bildet die Abstandskurve der Lichttexturen nach: (1 - d/r)².
   */
  private sampleLightAmount(x: number, y: number): number {
    let total = 0;
    for (const light of this.lights) {
      if (light.effectiveIntensity <= 0) continue;
      const dx = x - light.x;
      const dy = y - light.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= light.radiusPx) continue;

      let contribution = (1 - distance / light.radiusPx) ** 2 * light.effectiveIntensity;
      if (light.shape === 'cone' && distance > 0.0001) {
        const halfAngle = light.coneAngle * 0.5;
        const delta = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - light.angle));
        if (delta >= halfAngle) continue;
        // Gleicher weicher Rand wie in der Kegeltextur.
        const edgeStart = halfAngle * 0.7;
        if (delta > edgeStart) {
          contribution *= 1 - (delta - edgeStart) / (halfAngle - edgeStart);
        }
      }
      total += contribution;
      if (total >= 1) return 1;
    }
    return total;
  }

  /** Gibt alle Lichter frei, ohne die Texturen zu zerstören. */
  clear(): void {
    for (const light of this.lights) {
      this.releaseExplosionCache(light);
      this.pool.push(light);
    }
    this.lights.length = 0;
    this.keyed.clear();
    this.syncOverlayVisibility();
  }

  destroy(): void {
    this.clear();
    this.vectorSuppressed = false;
    this.destroyRenderTargets();
    this.unsubscribeQuality?.();
    this.unsubscribeQuality = null;
  }

  private setGraphicsQuality(profile: GraphicsQualityProfile): void {
    if (this.quality.level === profile.level) return;
    this.quality = profile;
    this.destroyRenderTargets();
  }

  private destroyRenderTargets(): void {
    for (const light of this.lights) this.releaseExplosionCache(light);
    for (const cache of this.occlusionCachePool) this.destroyOcclusionCache(cache);
    this.occlusionCachePool.length = 0;
    this.activeExplosionCacheCount = 0;
    this.lightMap?.destroy();
    this.lightMap = null;
    // Die neue Textur startet leer, das gemerkte Ambient gilt nicht mehr.
    this.lightMapHoldsAmbientOnly = false;
    for (const slot of this.slots) {
      slot.renderTexture.destroy();
      slot.image.destroy();
      slot.graphics.destroy();
    }
    this.slots.length = 0;
  }

  // ── Lichtquellen ───────────────────────────────────────────────────────────

  /** Einmalimpuls mit eigener Abklingdauer (Mündungsfeuer, Explosion, Aufschlag). */
  pulse(presetKey: LightPresetKey, x: number, y: number, overrides?: LightOverrides): void {
    const preset = LIGHT_PRESETS[presetKey] as LightPreset;
    if (!this.enabled || !preset.enabled) return;

    const light = this.acquire();
    this.applyPreset(light, presetKey, preset, x, y, overrides);
    light.key = null;
    light.flickerPhase = Math.random() * Math.PI * 2;
    this.lights.push(light);
  }

  /**
   * Dauerlicht, dessen Lebenszeit die aufrufende Quelle verwaltet. Pro Frame erneut
   * aufrufen; `releaseLight(key)` beendet es. Die Quellen bringen ihren Lebenszyklus
   * bereits mit (`Map<id, visual>` plus `destroyVisual`), es entsteht kein zweiter.
   */
  setLight(
    key: string,
    presetKey: LightPresetKey,
    x: number,
    y: number,
    overrides?: LightOverrides,
  ): void {
    const preset = LIGHT_PRESETS[presetKey] as LightPreset;
    if (!this.enabled || !preset.enabled) {
      this.releaseLight(key);
      return;
    }

    let light = this.keyed.get(key);
    if (!light) {
      light = this.acquire();
      light.flickerPhase = hashToPhase(key);
      this.lights.push(light);
      this.keyed.set(key, light);
    }
    const bornAt = light.key === key ? light.bornAt : this.now();
    this.applyPreset(light, presetKey, preset, x, y, overrides);
    light.key = key;
    light.bornAt = bornAt;
    light.durationMs = 0;
    light.releasedAt = 0;
  }

  releaseLight(key: string): void {
    const light = this.keyed.get(key);
    if (!light || light.releasedAt > 0) return;
    light.releasedAt = this.now();
  }

  // ── Frame-Update ───────────────────────────────────────────────────────────

  update(): void {
    const metricsEnabled = this.performanceMetricsEnabled;
    const semanticMetricsEnabled = this.attributionCollector?.isActive() === true;
    const countMetrics = metricsEnabled || semanticMetricsEnabled;
    const startMs = metricsEnabled ? performance.now() : 0;
    const now = this.now();

    const expireStartedAt = metricsEnabled ? performance.now() : 0;
    this.expireLights(now);
    const expireMs = metricsEnabled ? performance.now() - expireStartedAt : 0;

    if (!this.enabled) {
      if (semanticMetricsEnabled) {
        this.recordAttributionMetrics(this.lights.length, 0, 0, 0, 0, 0, 0, 0);
      }
      if (metricsEnabled) {
        this.lastCostMs = performance.now() - startMs;
        this.lastPerformance = {
          ...emptyPerformanceMetrics(),
          totalMs: this.lastCostMs,
          expireMs,
          activeLights: this.lights.length,
        };
      }
      return;
    }

    const overlay = this.ensureLightMap();
    const scrollX = this.scene.cameras.main.scrollX;
    const scrollY = this.scene.cameras.main.scrollY;
    const overscanX = this.getLightMapOverscanPx(GAME_WIDTH);
    const overscanY = this.getLightMapOverscanPx(GAME_HEIGHT);

    const queueStartedAt = metricsEnabled ? performance.now() : 0;
    this.collectRenderQueue(now, scrollX, scrollY);
    const queueMs = metricsEnabled ? performance.now() - queueStartedAt : 0;

    this.frameOcclusionRefreshes = 0;
    this.frameOcclusionCacheHits = 0;
    this.frameExplosionOcclusionRefreshes = 0;
    this.frameStaticOcclusionRefreshes = 0;
    this.frameDynamicOcclusionRefreshes = 0;
    this.frameMaxOcclusionCacheAgeMs = 0;
    this.frameOcclusionRefreshMs = 0;
    this.frameShadowGeometryMs = 0;
    this.frameOcclusionRefreshCommands = 0;
    this.frameRefreshShadowQuads = 0;
    this.frameRefreshFalloffQuads = 0;
    this.frameRefreshDynamicTests = 0;
    this.frameRefreshDynamicHits = 0;

    const ambientColor = this.sky.ambientColor;
    const ambientIsNeutral = ambientColor === NEUTRAL_AMBIENT_COLOR;
    const queueEmpty = this.renderQueue.length === 0;

    // Reihenfolge ist tragend: erst Sichtbarkeit entscheiden, dann erst Befehle erzeugen.
    // `setRenderMode('all')` leert den Command-Buffer am Platz des Objekts in der
    // Display-List – ein unsichtbares Objekt mit gefülltem Buffer ließe ihn auflaufen.
    if ((ambientIsNeutral && queueEmpty) || this.compositeSuppressed) {
      // Weißes Ambient ohne Licht multipliziert die Szene mit 1: kein Renderpass, kein
      // Overlay. Der Vergleich ist bewusst exakt – eine Toleranz wie „fast weiß" wäre
      // optisch unsichtbar, würde die Kostenschwelle aber unvorhersehbar verschieben.
      overlay.setVisible(false);
      this.lightMapHoldsAmbientOnly = false;
      if (metricsEnabled) {
        this.lastCostMs = performance.now() - startMs;
        this.lastPerformance = {
          ...emptyPerformanceMetrics(),
          totalMs: this.lastCostMs,
          expireMs,
          queueMs,
          activeLights: this.lights.length,
        };
      }
      if (semanticMetricsEnabled) {
        this.recordAttributionMetrics(this.lights.length, 0, 0, 0, 0, 0, 0, 0);
      }
      return;
    }
    overlay.setVisible(true);

    // Getöntes Ambient ohne Licht: in der Textur steht bereits genau dieses Ambient vom
    // letzten Frame. Keine Befehle erzeugen – `DynamicTexture.render()` steigt bei leerem
    // Command-Buffer aus, es bleibt allein das Composite. Bit-identisch, weil sich der
    // Texturinhalt nachweislich nicht ändert.
    if (queueEmpty && this.lightMapHoldsAmbientOnly) {
      if (metricsEnabled) {
        this.lastCostMs = performance.now() - startMs;
        this.lastPerformance = {
          ...emptyPerformanceMetrics(),
          totalMs: this.lastCostMs,
          expireMs,
          queueMs,
          activeLights: this.lights.length,
        };
      }
      if (semanticMetricsEnabled) {
        this.recordAttributionMetrics(this.lights.length, 0, 0, 0, 0, 0, 0, 0);
      }
      return;
    }
    this.lightMapHoldsAmbientOnly = queueEmpty;

    // Deckend füllen, niemals mit Alpha < 1 und niemals nur teilweise: das Composite
    // rechnet `src.rgb * dst.rgb + dst.rgb * (1 - src.a)`. Bei `src.a = 1` bleibt davon
    // die reine Multiplikation übrig; jedes Pixel mit `src.a < 1` würde stattdessen
    // *aufhellen*. Die additiven Stempel darunter erhalten das Alpha (`ADD` ist
    // `[ONE, DST_ALPHA]`, bei `dst.a = 1` also schlicht `src + dst`).
    //
    // Nebenbei: `lightMap.setAlpha(k)` wäre ein exakter Lerp des gesamten Composites
    // Richtung No-Op – der kostenlose Weg zu einer globalen Lichtstärke.
    overlay.fill(ambientColor, 1);

    const staticOccluderRevision = this.vectorSuppressed
      ? 0
      : (this.occluders?.getRevision() ?? 0);
    this.prepareExplosionOcclusionCaches(
      now,
      staticOccluderRevision,
      metricsEnabled,
      countMetrics,
    );

    let occludingUsed = 0;
    let directLights = 0;
    let fallbackOccludingLights = 0;
    let directMs = 0;
    let occlusionMs = 0;
    let shadowGeometryMs = 0;
    let shadowQuads = 0;
    let falloffQuads = 0;
    let dynamicOccluderTests = 0;
    let dynamicOccluderHits = 0;
    let commandCount = 1;
    let radialLights = 0;
    let coneLights = 0;
    const presetCounts = countMetrics ? {} as Record<string, number> : null;
    for (const light of this.renderQueue) {
      if (countMetrics) {
        presetCounts![light.presetKey] = (presetCounts![light.presetKey] ?? 0) + 1;
        if (light.shape === 'radial') radialLights += 1;
        else coneLights += 1;
      }
      const stationaryExplosion = this.isStationaryExplosion(light);
      const useOcclusion = light.occludes
        && !this.vectorSuppressed
        && occludingUsed < this.quality.maxOccludingLightsPerFrame
        && occludingUsed < this.slots.length
        && (!stationaryExplosion || light.occlusionCache?.valid === true)
        && (this.occluders !== null || this.dynamicOccluders?.hasOccluders() === true);

      if (useOcclusion) {
        const occlusionStartedAt = metricsEnabled ? performance.now() : 0;
        const geometry = stationaryExplosion
          ? this.renderCachedExplosionLight(
            light,
            scrollX,
            scrollY,
          )
          : this.renderOccludingLight(
            light,
            this.slots[occludingUsed],
            scrollX,
            scrollY,
            metricsEnabled,
            countMetrics,
          );
        if (countMetrics && geometry) {
          if (metricsEnabled) occlusionMs += performance.now() - occlusionStartedAt;
          shadowGeometryMs += geometry.durationMs;
          shadowQuads += geometry.shadowQuads;
          falloffQuads += geometry.falloffQuads;
          dynamicOccluderTests += geometry.dynamicOccluderTests;
          dynamicOccluderHits += geometry.dynamicOccluderHits;
          commandCount += 4 + geometry.graphicsCommands;
        }
        occludingUsed += 1;
      } else {
        // Überzählige verdeckende Lichter fallen weich auf den einfachen Pfad zurück:
        // weniger Schatten statt fehlendem Licht.
        const scale = this.quality.lightMapScale;
        const directStartedAt = metricsEnabled ? performance.now() : 0;
        this.stampLight(
          overlay,
          light,
          (light.x - scrollX + overscanX) * scale,
          (light.y - scrollY + overscanY) * scale,
        );
        if (countMetrics) {
          if (metricsEnabled) directMs += performance.now() - directStartedAt;
          directLights += 1;
          commandCount += 1;
          if (light.occludes) fallbackOccludingLights += 1;
        }
      }
    }

    occlusionMs += this.frameOcclusionRefreshMs;
    shadowGeometryMs += this.frameShadowGeometryMs;
    shadowQuads += this.frameRefreshShadowQuads;
    falloffQuads += this.frameRefreshFalloffQuads;
    dynamicOccluderTests += this.frameRefreshDynamicTests;
    dynamicOccluderHits += this.frameRefreshDynamicHits;
    commandCount += this.frameOcclusionRefreshCommands;
    commandCount += this.frameOcclusionCacheHits;

    if (semanticMetricsEnabled) {
      this.recordAttributionMetrics(
        this.lights.length,
        this.renderQueue.length,
        occludingUsed,
        commandCount,
        shadowQuads,
        falloffQuads,
        dynamicOccluderTests,
        dynamicOccluderHits,
        this.frameOcclusionCacheHits,
        this.frameOcclusionRefreshes,
      );
    }
    if (!metricsEnabled) return;

    this.lastCostMs = performance.now() - startMs;
    this.lastPerformance = {
      totalMs: this.lastCostMs,
      expireMs,
      queueMs,
      commandBuildMs: Math.max(0, this.lastCostMs - expireMs - queueMs),
      directMs,
      occlusionMs,
      shadowGeometryMs,
      activeLights: this.lights.length,
      renderedLights: this.renderQueue.length,
      directLights,
      occludingLights: occludingUsed,
      fallbackOccludingLights,
      radialLights,
      coneLights,
      shadowQuads,
      falloffQuads,
      dynamicOccluderTests,
      dynamicOccluderHits,
      occlusionRefreshes: this.frameOcclusionRefreshes,
      occlusionCacheHits: this.frameOcclusionCacheHits,
      activeExplosionCaches: this.activeExplosionCacheCount,
      explosionOcclusionRefreshes: this.frameExplosionOcclusionRefreshes,
      staticOcclusionRefreshes: this.frameStaticOcclusionRefreshes,
      dynamicOcclusionRefreshes: this.frameDynamicOcclusionRefreshes,
      maxOcclusionCacheAgeMs: this.frameMaxOcclusionCacheAgeMs,
      commandCount,
      lightMapPixels: Math.ceil((GAME_WIDTH + overscanX * 2) * this.quality.lightMapScale)
        * Math.ceil((GAME_HEIGHT + overscanY * 2) * this.quality.lightMapScale),
      scratchPixels: occludingUsed * OCCLUDER_SCRATCH_SIZE * OCCLUDER_SCRATCH_SIZE,
      presetCounts: presetCounts!,
    };
  }

  // ── Intern: Lichtverwaltung ────────────────────────────────────────────────

  private now(): number {
    return this.scene.time.now;
  }

  private acquire(): ActiveLight {
    const light = this.pool.pop();
    if (light) return light;
    return {
      key: null,
      presetKey: 'muzzleFlash',
      shape: 'radial',
      x: 0,
      y: 0,
      radiusPx: 0,
      color: 0xffffff,
      intensity: 1,
      angle: 0,
      coneAngle: 0,
      occludes: false,
      priority: 0,
      flickerAmount: 0,
      flickerHz: 0,
      flickerPhase: 0,
      durationMs: 0,
      decayExponent: 1,
      bornAt: 0,
      touchedAt: 0,
      releasedAt: 0,
      effectiveIntensity: 0,
      occlusionCache: null,
    };
  }

  private applyPreset(
    light: ActiveLight,
    presetKey: LightPresetKey,
    preset: LightPreset,
    x: number,
    y: number,
    overrides?: LightOverrides,
  ): void {
    const now = this.now();

    light.presetKey = presetKey;
    light.shape = preset.shape;
    light.x = x;
    light.y = y;
    light.radiusPx = overrides?.radiusPx ?? preset.radiusPx;
    light.color = overrides?.color ?? preset.color;
    // `lightFactor` ist die eine Regel, die früher zwanzig `day`-Overrides je Preset
    // waren: zum Mittag hin lässt das helle Ambient ohnehin keinen Spielraum mehr, ein
    // Licht dort voll zu stempeln wäre reine Füllrate ohne Bildwirkung. Bei 0 fällt das
    // Licht durch die Sichtbarkeitsschwelle in `collectRenderQueue()` und kostet nichts.
    light.intensity = (overrides?.intensity ?? preset.intensity)
      * this.sky.lightFactor
      * GLOBAL_LIGHT_INTENSITY_MULT;
    light.angle = overrides?.angle ?? 0;
    light.coneAngle = preset.coneAngle ?? Math.PI * 0.5;
    light.occludes = overrides?.occludes ?? preset.occludes;
    light.priority = preset.priority;
    light.flickerAmount = preset.flickerAmount;
    light.flickerHz = preset.flickerHz;
    light.durationMs = overrides?.durationMs ?? preset.durationMs;
    light.decayExponent = preset.decayExponent;
    light.bornAt = now;
    light.touchedAt = now;
    light.releasedAt = 0;

    // Verdeckende Lichter müssen in die Scratch-Textur passen. Statt den Radius zu
    // kappen – dann würde eine große Explosion kleiner leuchten als ihr Wirkradius und
    // die Größenstaffelung bräche oben ab – verzichtet ein zu großes Licht lieber auf
    // seinen Schattenwurf. Bei einem Blitz dieser Größe fällt der Schatten ohnehin
    // weniger auf als eine zu kleine Lichtkugel.
    if (light.occludes && light.radiusPx > MAX_OCCLUDING_LIGHT_RADIUS) {
      light.occludes = false;
    }
  }

  private expireLights(now: number): void {
    for (let index = this.lights.length - 1; index >= 0; index -= 1) {
      const light = this.lights[index];
      let expired = false;

      if (light.key === null) {
        expired = now - light.bornAt >= light.durationMs;
      } else if (light.releasedAt > 0) {
        expired = now - light.releasedAt >= RELEASE_FADE_MS;
      } else if (now - light.touchedAt > KEYED_LIGHT_STALE_MS) {
        expired = true;
      }

      if (!expired) continue;
      if (light.key !== null) this.keyed.delete(light.key);
      this.releaseExplosionCache(light);
      this.lights[index] = this.lights[this.lights.length - 1];
      this.lights.pop();
      this.pool.push(light);
    }
  }

  /** Wählt die sichtbaren Lichter aus, berechnet ihre Intensität und sortiert sie. */
  private collectRenderQueue(now: number, scrollX: number, scrollY: number): void {
    this.renderQueue.length = 0;
    const overscanX = this.getLightMapOverscanPx(GAME_WIDTH);
    const overscanY = this.getLightMapOverscanPx(GAME_HEIGHT);

    for (const light of this.lights) {
      let fade = 1;
      if (light.key === null && light.durationMs > 0) {
        const progress = Phaser.Math.Clamp((now - light.bornAt) / light.durationMs, 0, 1);
        fade = Math.pow(1 - progress, light.decayExponent);
      } else if (light.releasedAt > 0) {
        fade = Phaser.Math.Clamp(1 - (now - light.releasedAt) / RELEASE_FADE_MS, 0, 1);
      }

      let intensity = light.intensity * fade;
      if (light.flickerAmount > 0) {
        const wave = Math.sin(now * 0.001 * Math.PI * 2 * light.flickerHz + light.flickerPhase);
        intensity *= 1 + light.flickerAmount * wave;
      }
      light.effectiveIntensity = Phaser.Math.Clamp(intensity, 0, 1);
      if (light.effectiveIntensity <= 0.004) continue;

      const screenX = light.x - scrollX;
      const screenY = light.y - scrollY;
      const reach = light.radiusPx;
      if (screenX + reach < -overscanX || screenX - reach > GAME_WIDTH + overscanX) continue;
      if (screenY + reach < -overscanY || screenY - reach > GAME_HEIGHT + overscanY) continue;

      this.renderQueue.push(light);
    }

    // Verdeckende Lichter zuerst, damit sie die Scratch-Slots bekommen; innerhalb
    // gleicher Priorität gewinnt das hellere Licht.
    this.renderQueue.sort(compareLightImportance);
    if (this.renderQueue.length > this.quality.maxLightsPerFrame) {
      this.renderQueue.length = this.quality.maxLightsPerFrame;
    }
  }

  // ── Intern: Zeichnen ───────────────────────────────────────────────────────

  private isStationaryExplosion(light: ActiveLight): boolean {
    return light.key === null
      && light.presetKey === 'explosion'
      && light.shape === 'radial'
      && light.occludes;
  }

  private getMaxCachedExplosionLights(): number {
    return this.quality.maxOccludingLightsPerFrame * 2;
  }

  private prepareExplosionOcclusionCaches(
    now: number,
    staticRevision: number,
    collectMetrics: boolean,
    collectCounts: boolean,
  ): void {
    if (this.vectorSuppressed || this.getMaxCachedExplosionLights() <= 0) return;
    if (this.occluders === null && this.dynamicOccluders?.hasOccluders() !== true) return;

    const candidates: Array<{ light: ActiveLight; cache: OcclusionCache }> = [];
    const dynamicOccluderPresence = this.dynamicOccluders?.hasOccluders() === true;
    let occludingCandidates = 0;
    for (const light of this.renderQueue) {
      if (!light.occludes) continue;
      if (occludingCandidates >= this.quality.maxOccludingLightsPerFrame) break;
      occludingCandidates += 1;
      if (!this.isStationaryExplosion(light)) continue;

      const cache = this.ensureExplosionCache(light);
      if (!cache) continue;
      const lightGeometryChanged = cache.sourceX !== light.x
        || cache.sourceY !== light.y
        || cache.sourceRadiusPx !== light.radiusPx
        || cache.sourceOccludes !== light.occludes;
      const staticGeometryChanged = !cache.valid || cache.lastStaticRevision !== staticRevision;
      const dynamicPresenceChanged = cache.lastDynamicOccluderPresence !== dynamicOccluderPresence;
      if (staticGeometryChanged || lightGeometryChanged || dynamicPresenceChanged) {
        this.refreshExplosionCache(
          light,
          cache,
          now,
          staticRevision,
          staticGeometryChanged || lightGeometryChanged,
          collectMetrics,
          collectCounts,
        );
        continue;
      }
      if (now >= cache.nextRefreshAt) candidates.push({ light, cache });
    }

    // Deterministic oldest-first order prevents a barrage of explosions from refreshing
    // all cached textures in the same timer tick.
    candidates.sort((left, right) => left.cache.lastRefreshAt - right.cache.lastRefreshAt);
    const refreshBudget = this.quality.level === 'high' ? 2 : 1;
    for (const candidate of candidates.slice(0, refreshBudget)) {
      this.refreshExplosionCache(
        candidate.light,
        candidate.cache,
        now,
        staticRevision,
        false,
        collectMetrics,
        collectCounts,
      );
    }
  }

  private ensureExplosionCache(light: ActiveLight): OcclusionCache | null {
    if (light.occlusionCache) return light.occlusionCache;
    if (this.activeExplosionCacheCount >= this.getMaxCachedExplosionLights()) return null;

    const cache = this.occlusionCachePool.pop() ?? this.createOcclusionCache();
    cache.valid = false;
    cache.lastStaticRevision = -1;
    cache.lastDynamicOccluderPresence = false;
    cache.sourceX = 0;
    cache.sourceY = 0;
    cache.sourceRadiusPx = 0;
    cache.sourceOccludes = false;
    cache.lastRefreshAt = 0;
    cache.nextRefreshAt = 0;
    cache.image.setAlpha(1).setTint(0xffffff).setVisible(true);
    light.occlusionCache = cache;
    this.activeExplosionCacheCount += 1;
    return cache;
  }

  private refreshExplosionCache(
    light: ActiveLight,
    cache: OcclusionCache,
    now: number,
    staticRevision: number,
    refreshStatic: boolean,
    collectMetrics: boolean,
    collectCounts: boolean,
  ): void {
    const center = OCCLUDER_SCRATCH_SIZE * 0.5;
    const refreshStartedAt = collectMetrics ? performance.now() : 0;
    if (refreshStatic) {
      cache.staticCore.reset();
      cache.staticFalloff.reset();
      this.projectStaticShadowGeometry(
        light,
        cache.staticCore,
        cache.staticFalloff,
      );
    }

    const geometryStartedAt = collectMetrics ? performance.now() : 0;
    this.shadowQuads.reset();
    this.falloffQuads.reset();
    const dynamic = this.projectDynamicShadowGeometry(
      light,
      this.shadowQuads,
      this.falloffQuads,
      collectCounts,
    );

    cache.renderTexture.clear();
    this.stampLight(cache.renderTexture, light, center, center, 1, 0xffffff);
    cache.graphics.clear();
    cache.graphics.fillStyle(0xffffff, 1);
    this.fillShadowQuads(cache.graphics, cache.staticCore, light, center);
    this.fillFalloffQuads(cache.graphics, cache.staticFalloff, light, center);
    this.fillShadowQuads(cache.graphics, this.shadowQuads, light, center);
    this.fillFalloffQuads(cache.graphics, this.falloffQuads, light, center);
    const graphicsCommands = cache.graphics.commandBuffer.length;
    if (cache.staticCore.length > 0 || cache.staticFalloff.length > 0
      || this.shadowQuads.length > 0 || this.falloffQuads.length > 0) {
      cache.renderTexture.erase([cache.graphics]);
    }
    cache.renderTexture.render();

    cache.valid = true;
    cache.lastStaticRevision = staticRevision;
    cache.lastDynamicOccluderPresence = this.dynamicOccluders?.hasOccluders() === true;
    cache.sourceX = light.x;
    cache.sourceY = light.y;
    cache.sourceRadiusPx = light.radiusPx;
    cache.sourceOccludes = light.occludes;
    cache.lastRefreshAt = now;
    cache.nextRefreshAt = now + EXPLOSION_OCCLUSION_REFRESH_MS;

    this.frameOcclusionRefreshes += 1;
    this.frameExplosionOcclusionRefreshes += 1;
    if (refreshStatic && this.occluders !== null) {
      this.frameStaticOcclusionRefreshes += 1;
    }
    if (this.dynamicOccluders?.hasOccluders() === true) {
      this.frameDynamicOcclusionRefreshes += 1;
    }
    this.frameRefreshShadowQuads += cache.staticCore.length + this.shadowQuads.length;
    this.frameRefreshFalloffQuads += cache.staticFalloff.length + this.falloffQuads.length;
    this.frameRefreshDynamicTests += dynamic.tests;
    this.frameRefreshDynamicHits += dynamic.hits;
    this.frameOcclusionRefreshCommands += 4 + graphicsCommands;
    if (collectMetrics) {
      this.frameOcclusionRefreshMs += performance.now() - refreshStartedAt;
      this.frameShadowGeometryMs += performance.now() - geometryStartedAt;
    }
  }

  private renderCachedExplosionLight(
    light: ActiveLight,
    scrollX: number,
    scrollY: number,
  ): {
    durationMs: number;
    shadowQuads: number;
    falloffQuads: number;
    dynamicOccluderTests: number;
    dynamicOccluderHits: number;
    graphicsCommands: number;
  } | null {
    const cache = light.occlusionCache;
    if (!cache || !cache.valid) {
      // Pool-/Qualitäts-Fallback: das Licht bleibt sichtbar, aber erzeugt keinen
      // zusätzlichen Schatten-Renderpass. Der normale Update-Pfad entscheidet
      // bereits vorher, dass dafür kein Occlusion-Slot verbraucht wird.
      const scale = this.quality.lightMapScale;
      this.stampLight(
        this.lightMap!,
        light,
        (light.x - scrollX + this.getLightMapOverscanPx(GAME_WIDTH)) * scale,
        (light.y - scrollY + this.getLightMapOverscanPx(GAME_HEIGHT)) * scale,
      );
      return null;
    }

    const overscanX = this.getLightMapOverscanPx(GAME_WIDTH);
    const overscanY = this.getLightMapOverscanPx(GAME_HEIGHT);
    cache.image
      .setPosition(
        (light.x - scrollX + overscanX) * this.quality.lightMapScale,
        (light.y - scrollY + overscanY) * this.quality.lightMapScale,
      )
      .setAlpha(light.effectiveIntensity)
      .setTint(light.color);
    this.lightMap?.draw([cache.image]);

    this.frameOcclusionCacheHits += 1;
    this.frameMaxOcclusionCacheAgeMs = Math.max(
      this.frameMaxOcclusionCacheAgeMs,
      Math.max(0, this.now() - cache.lastRefreshAt),
    );
    return null;
  }

  private stampLight(
    target: Phaser.GameObjects.RenderTexture,
    light: ActiveLight,
    x: number,
    y: number,
    alpha = light.effectiveIntensity,
    tint = light.color,
  ): void {
    const radiusLm = light.radiusPx * this.quality.lightMapScale;
    if (light.shape === 'cone') {
      target.stamp(this.ensureConeTexture(light.coneAngle), undefined, x, y, {
        alpha,
        tint,
        rotation: light.angle,
        scale: radiusLm / CONE_TEX_WIDTH,
        originX: 0,
        originY: 0.5,
        blendMode: Phaser.BlendModes.ADD,
      });
      return;
    }

    target.stamp(TEX_LIGHT_RADIAL, undefined, x, y, {
      alpha,
      tint,
      scale: radiusLm / (RADIAL_TEX_SIZE * 0.5),
      blendMode: Phaser.BlendModes.ADD,
    });
  }

  private renderOccludingLight(
    light: ActiveLight,
    slot: OccluderSlot,
    scrollX: number,
    scrollY: number,
    collectMetrics: boolean,
    collectCounts: boolean,
  ): {
    durationMs: number;
    shadowQuads: number;
    falloffQuads: number;
    dynamicOccluderTests: number;
    dynamicOccluderHits: number;
    graphicsCommands: number;
  } | null {
    const center = OCCLUDER_SCRATCH_SIZE * 0.5;

    slot.renderTexture.clear();
    this.stampLight(slot.renderTexture, light, center, center);

    const geometryStartedAt = collectMetrics ? performance.now() : 0;
    this.buildShadowGraphics(light, slot.graphics, center, collectCounts);
    const durationMs = collectMetrics ? performance.now() - geometryStartedAt : 0;
    const shadowQuads = collectCounts ? this.shadowQuads.length : 0;
    const falloffQuads = collectCounts ? this.falloffQuads.length : 0;
    slot.renderTexture.erase([slot.graphics]);
    this.frameOcclusionRefreshes += 1;

    slot.image.setPosition(
      (light.x - scrollX + this.getLightMapOverscanPx(GAME_WIDTH)) * this.quality.lightMapScale,
      (light.y - scrollY + this.getLightMapOverscanPx(GAME_HEIGHT)) * this.quality.lightMapScale,
    );
    this.lightMap?.draw([slot.image]);
    if (!collectCounts) return null;

    return {
      durationMs,
      shadowQuads,
      falloffQuads,
      dynamicOccluderTests: this.lastDynamicOccluderTests,
      dynamicOccluderHits: this.lastDynamicOccluderHits,
      graphicsCommands: slot.graphics.commandBuffer.length,
    };
  }

  /**
   * Zeichnet die Schattenpolygone einer Lichtquelle in Scratch-Koordinaten.
   *
   * Zwei aneinandergrenzende, überschneidungsfreie Zonen ab der beleuchteten Außenkante
   * des Blocks:
   *   0 … falloff  – weicher Verlauf, Alpha 0 an der Kante bis 1 am Ende (Gouraud)
   *   falloff … ∞  – Vollschatten (Oberseite dahinter und Boden hinter dem Hindernis)
   *
   * Die seitlichen Ränder beider Zonen liegen auf denselben Silhouettenstrahlen, weil
   * das Zurücksetzen entlang des Lichtstrahls den Strahl nicht verlässt. Der Schatten
   * beginnt also exakt an der Hinderniskante und ist nicht versetzt.
   */
  private buildShadowGraphics(
    light: ActiveLight,
    graphics: Phaser.GameObjects.Graphics,
    center: number,
    collectCounts: boolean,
  ): void {
    graphics.clear();
    const core = this.shadowQuads;
    const falloff = this.falloffQuads;
    core.reset();
    falloff.reset();
    this.projectStaticShadowGeometry(light, core, falloff);
    this.projectDynamicShadowGeometry(light, core, falloff, collectCounts);

    if (core.length === 0 && falloff.length === 0) return;

    graphics.fillStyle(0xffffff, 1);
    this.fillShadowQuads(graphics, core, light, center);
    this.fillFalloffQuads(graphics, falloff, light, center);
  }

  private projectStaticShadowGeometry(
    light: ActiveLight,
    core: ShadowQuadBuffer,
    falloff: ShadowQuadBuffer,
  ): void {
    const extendPx = light.radiusPx * SHADOW_EXTEND_FACTOR;
    const falloffPx = OCCLUDER_SHADE_FALLOFF_PX;
    const projectRect = (
      left: number,
      top: number,
      right: number,
      bottom: number,
      exposedEdges: number,
    ): void => {
      projectRectShadowQuads(
        falloff,
        light.x,
        light.y,
        left,
        top,
        right,
        bottom,
        0,
        falloffPx,
        exposedEdges,
      );
      projectRectShadowQuads(
        core,
        light.x,
        light.y,
        left,
        top,
        right,
        bottom,
        falloffPx,
        extendPx,
        exposedEdges,
      );
    };

    this.occluders?.queryCircle(
      light.x,
      light.y,
      light.radiusPx,
      projectRect,
      (centerX, centerY, radius) => {
        projectCircleShadowQuad(falloff, light.x, light.y, centerX, centerY, radius, 0, falloffPx);
        projectCircleShadowQuad(core, light.x, light.y, centerX, centerY, radius, falloffPx, extendPx);
      },
    );
  }

  private projectDynamicShadowGeometry(
    light: ActiveLight,
    core: ShadowQuadBuffer,
    falloff: ShadowQuadBuffer,
    collectCounts: boolean,
  ): { tests: number; hits: number } {
    let hits = 0;
    const extendPx = light.radiusPx * SHADOW_EXTEND_FACTOR;
    const falloffPx = OCCLUDER_SHADE_FALLOFF_PX;
    const tests = this.dynamicOccluders?.queryCircle(
      light.x,
      light.y,
      light.radiusPx,
      (left, top, right, bottom, exposedEdges) => {
        if (collectCounts) hits += 1;
        projectRectShadowQuads(
          falloff,
          light.x,
          light.y,
          left,
          top,
          right,
          bottom,
          0,
          falloffPx,
          exposedEdges,
        );
        projectRectShadowQuads(
          core,
          light.x,
          light.y,
          left,
          top,
          right,
          bottom,
          falloffPx,
          extendPx,
          exposedEdges,
        );
      },
    ) ?? 0;
    this.lastDynamicOccluderTests = collectCounts ? tests : 0;
    this.lastDynamicOccluderHits = collectCounts ? hits : 0;
    return { tests, hits };
  }

  private recordAttributionMetrics(
    activeLights: number,
    renderedLights: number,
    occludingLights: number,
    commandCount: number,
    shadowQuads: number,
    falloffQuads: number,
    dynamicOccluderTests: number,
    dynamicOccluderHits: number,
    cacheHits = 0,
    cacheRefreshes = 0,
  ): void {
    const collector = this.attributionCollector;
    if (!collector?.isActive()) return;
    collector.setGraphicsGauge('lightingOcclusion', {
      objectCount: this.slots.length,
      activeObjects: renderedLights,
      activeLights,
      renderedLights,
      occludingLights,
      primitiveCount: shadowQuads + falloffQuads,
      commandCount,
      shadowQuads,
      falloffQuads,
    });
    collector.recordGraphicsWork('lightingOcclusion', {
      commandsBuilt: commandCount,
      shadowQuadsBuilt: shadowQuads,
      falloffQuadsBuilt: falloffQuads,
      maxCommandsPerFrame: commandCount,
      maxShadowQuadsPerFrame: shadowQuads,
      maxFalloffQuadsPerFrame: falloffQuads,
      dynamicOccluderTests,
      dynamicOccluderHits,
      cacheHits,
      cacheRefreshes,
    });
  }

  private fillShadowQuads(
    graphics: Phaser.GameObjects.Graphics,
    quads: ShadowQuadBuffer,
    light: ActiveLight,
    center: number,
  ): void {
    const data = quads.data;
    const scale = this.quality.lightMapScale;
    for (let quad = 0; quad < quads.length; quad += 1) {
      const offset = quad * SHADOW_QUAD_STRIDE;
      graphics.beginPath();
      graphics.moveTo(
        (data[offset] - light.x) * scale + center,
        (data[offset + 1] - light.y) * scale + center,
      );
      for (let point = 1; point < 4; point += 1) {
        graphics.lineTo(
          (data[offset + point * 2] - light.x) * scale + center,
          (data[offset + point * 2 + 1] - light.y) * scale + center,
        );
      }
      graphics.closePath();
      graphics.fillPath();
    }
  }

  /**
   * Zeichnet den Übergangsstreifen als zwei Gouraud-Dreiecke. Die beiden Ecken an der
   * beleuchteten Kante bekommen Alpha 0, die beiden am Ende des Streifens Alpha 1 –
   * `FillTri` interpoliert dazwischen pro Fragment, der Verlauf ist damit stufenlos.
   */
  private fillFalloffQuads(
    graphics: Phaser.GameObjects.Graphics,
    quads: ShadowQuadBuffer,
    light: ActiveLight,
    center: number,
  ): void {
    const data = quads.data;
    const scale = this.quality.lightMapScale;
    for (let quad = 0; quad < quads.length; quad += 1) {
      const offset = quad * SHADOW_QUAD_STRIDE;
      // Punktreihenfolge aus pushProjectedEdge: 0/1 an der Kante, 2/3 am Streifenende.
      const x0 = (data[offset] - light.x) * scale + center;
      const y0 = (data[offset + 1] - light.y) * scale + center;
      const x1 = (data[offset + 2] - light.x) * scale + center;
      const y1 = (data[offset + 3] - light.y) * scale + center;
      const x2 = (data[offset + 4] - light.x) * scale + center;
      const y2 = (data[offset + 5] - light.y) * scale + center;
      const x3 = (data[offset + 6] - light.x) * scale + center;
      const y3 = (data[offset + 7] - light.y) * scale + center;

      // Alpha-Zuordnung von fillGradientStyle auf fillTriangle: TL→Ecke A, TR→B, BL→C.
      graphics.fillGradientStyle(0xffffff, 0xffffff, 0xffffff, 0xffffff, 0, 0, 1, 1);
      graphics.fillTriangle(x0, y0, x1, y1, x2, y2);
      graphics.fillGradientStyle(0xffffff, 0xffffff, 0xffffff, 0xffffff, 0, 1, 1, 1);
      graphics.fillTriangle(x0, y0, x2, y2, x3, y3);
    }
  }

  // ── Intern: Ressourcen ─────────────────────────────────────────────────────

  private syncOverlayVisibility(): void {
    if (!this.lightMap) return;
    // Der Fall „weißes Ambient ohne Licht" wird bewusst nur in `update()` entschieden,
    // damit beide Stellen nicht auseinanderlaufen können.
    this.lightMap.setVisible(this.enabled && !this.compositeSuppressed);
  }

  private ensureLightMap(): Phaser.GameObjects.RenderTexture {
    if (this.lightMap) return this.lightMap;

    const overscanX = this.getLightMapOverscanPx(GAME_WIDTH);
    const overscanY = this.getLightMapOverscanPx(GAME_HEIGHT);
    const displayWidth = GAME_WIDTH + overscanX * 2;
    const displayHeight = GAME_HEIGHT + overscanY * 2;
    const width = Math.ceil(displayWidth * this.quality.lightMapScale);
    const height = Math.ceil(displayHeight * this.quality.lightMapScale);

    // Scratch-Slots liegen knapp unter der Lightmap: die Display-List-Reihenfolge
    // garantiert, dass ihre Command-Buffer vor dem der Lightmap ausgeführt werden.
    for (let slot = 0; slot < this.quality.maxOccludingLightsPerFrame; slot += 1) {
      this.slots.push(this.createOccluderSlot(slot));
    }

    const lightMap = this.scene.add.renderTexture(-overscanX, -overscanY, width, height)
      .setOrigin(0, 0)
      .setDisplaySize(displayWidth, displayHeight)
      .setScrollFactor(0)
      .setDepth(DEPTH_LIGHTING)
      // Konstant MULTIPLY: die Uhrzeit steckt allein im Ambient, mit dem gefüllt wird.
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    // Die Lightmap bleibt absichtlich halbauflösend, ist aber ein weiches Lichtfeld. Explizit
    // linear filtern, damit die anschließende Kamera-Bloom-Stufe keine halben Lightmap-Zellen
    // als regelmäßiges Raster in die Threshold-Rampe übernimmt.
    lightMap.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    lightMap.setRenderMode('all');
    this.lightMap = lightMap;
    this.syncOverlayVisibility();
    return lightMap;
  }

  private getLightMapOverscanPx(viewportSize: number): number {
    void viewportSize;
    return LIGHTMAP_OVERSCAN_ALIGNMENT_PX;
  }

  private createOccluderSlot(slotIndex: number): OccluderSlot {
    const renderTexture = this.scene.add
      .renderTexture(0, 0, OCCLUDER_SCRATCH_SIZE, OCCLUDER_SCRATCH_SIZE)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_LIGHTING - 0.01 + slotIndex * 0.001);
    // 'redraw': der Command-Buffer wird an dieser Stelle der Display-List geleert,
    // die Textur selbst aber nicht gezeichnet.
    renderTexture.setRenderMode('redraw');

    // Bewusst nicht in der Display-List: beide Objekte werden ausschließlich als
    // Zeichenquelle an `DynamicTexture.draw()`/`erase()` übergeben.
    const image = new Phaser.GameObjects.Image(this.scene, 0, 0, renderTexture.texture.key)
      .setOrigin(0.5, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD);

    const graphics = this.scene.make.graphics({}, false);

    return { renderTexture, image, graphics };
  }

  private createOcclusionCache(): OcclusionCache {
    const renderTexture = this.scene.add
      .renderTexture(0, 0, OCCLUDER_SCRATCH_SIZE, OCCLUDER_SCRATCH_SIZE)
      .setOrigin(0, 0)
      .setVisible(false)
      .setScrollFactor(0)
      .setRenderMode('render');
    const image = new Phaser.GameObjects.Image(this.scene, 0, 0, renderTexture.texture.key)
      .setOrigin(0.5, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(1)
      .setTint(0xffffff);
    const graphics = this.scene.make.graphics({}, false);

    return {
      renderTexture,
      image,
      graphics,
      staticCore: new ShadowQuadBuffer(),
      staticFalloff: new ShadowQuadBuffer(),
      valid: false,
      lastStaticRevision: -1,
      lastDynamicOccluderPresence: false,
      sourceX: 0,
      sourceY: 0,
      sourceRadiusPx: 0,
      sourceOccludes: false,
      lastRefreshAt: 0,
      nextRefreshAt: 0,
    };
  }

  private releaseExplosionCache(light: ActiveLight): void {
    const cache = light.occlusionCache;
    if (!cache) return;
    light.occlusionCache = null;
    cache.valid = false;
    cache.graphics.clear();
    cache.image.setAlpha(1).setTint(0xffffff).setVisible(false);
    this.occlusionCachePool.push(cache);
    this.activeExplosionCacheCount = Math.max(0, this.activeExplosionCacheCount - 1);
  }

  private destroyOcclusionCache(cache: OcclusionCache): void {
    cache.renderTexture.destroy();
    cache.image.destroy();
    cache.graphics.destroy();
  }

  private ensureTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_LIGHT_RADIAL, RADIAL_TEX_SIZE, [
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,255,255,0.5625)'],
      [0.5, 'rgba(255,255,255,0.25)'],
      [0.75, 'rgba(255,255,255,0.0625)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  }

  /**
   * Kegeltextur mit Apex links auf halber Höhe und Strahl nach +X. Der Öffnungswinkel
   * ist eingebacken, deshalb eine Textur pro verwendetem Winkel.
   *
   * Bewusst mit Canvas-Zeichenoperationen statt per `putImageData` aufgebaut: Phasers
   * ADD-Blend verwendet `funcSrc = gl.ONE`, addiert die Quellfarbe also ungewichtet und
   * setzt damit vormultipliziertes Alpha voraus. Ein per `putImageData` geschriebenes
   * `RGB = 255` bei `A = 0` würde außerhalb des Kegels über die gesamte Texturfläche
   * mitleuchten. Beim Zeichnen bleiben unberührte Pixel dagegen vollständig leer.
   *
   * Der weiche Rand entsteht durch gestapelte Keile von außen nach innen: der innerste
   * Bereich sammelt alle Schichten, der äußerste nur eine. Er bleibt bewusst schmal –
   * ein breiter Saum liest sich am Strahlende als flächiger Schein statt als Kegel.
   *
   * Kein Nahfeld-Glow in der Textur: der wäre eine Halbscheibe und würde an der
   * Spielerlinie hart abbrechen. Dafür gibt es das omnidirektionale Preset
   * `flashlightSpill`.
   */
  private ensureConeTexture(coneAngle: number): string {
    const angleKey = Math.round(coneAngle * 1000);
    const existing = this.coneTextureKeys.get(angleKey);
    if (existing) return existing;

    const key = `__light_cone_${angleKey}`;
    const halfAngle = coneAngle * 0.5;
    const apexY = CONE_TEX_HEIGHT * 0.5;
    const range = CONE_TEX_WIDTH;
    const edgeStart = halfAngle * 0.7;
    const edgeSteps = 12;

    ensureCanvasTexture(this.scene.textures, key, CONE_TEX_WIDTH, CONE_TEX_HEIGHT, (ctx) => {
      // Gleiche Abstandskurve wie die runde Lichttextur: (1 - d/r)².
      const beam = ctx.createRadialGradient(0, apexY, 0, 0, apexY, range);
      beam.addColorStop(0, 'rgba(255,255,255,1)');
      beam.addColorStop(0.25, 'rgba(255,255,255,0.5625)');
      beam.addColorStop(0.5, 'rgba(255,255,255,0.25)');
      beam.addColorStop(0.75, 'rgba(255,255,255,0.0625)');
      beam.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = beam;
      ctx.globalAlpha = 1 / edgeSteps;
      for (let step = 0; step < edgeSteps; step += 1) {
        const t = step / (edgeSteps - 1);
        const wedgeAngle = halfAngle + (edgeStart - halfAngle) * t;
        ctx.beginPath();
        ctx.moveTo(0, apexY);
        ctx.arc(0, apexY, range, -wedgeAngle, wedgeAngle);
        ctx.closePath();
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    });

    this.coneTextureKeys.set(angleKey, key);
    return key;
  }
}

function compareLightImportance(left: ActiveLight, right: ActiveLight): number {
  if (left.occludes !== right.occludes) return left.occludes ? -1 : 1;
  if (left.priority !== right.priority) return right.priority - left.priority;
  return right.effectiveIntensity - left.effectiveIntensity;
}

/** Kanalweise Mischung zweier Farben; `amount` 0 liefert `from`, 1 liefert `to`. */
function mixChannels(from: number, to: number, amount: number): number {
  const red = Math.round((from >> 16 & 0xff) + ((to >> 16 & 0xff) - (from >> 16 & 0xff)) * amount);
  const green = Math.round((from >> 8 & 0xff) + ((to >> 8 & 0xff) - (from >> 8 & 0xff)) * amount);
  const blue = Math.round((from & 0xff) + ((to & 0xff) - (from & 0xff)) * amount);
  return (red << 16) | (green << 8) | blue;
}

/** Stabile Flackerphase pro Licht-Key, damit benachbarte Feuer nicht im Takt pulsen. */
function hashToPhase(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}
