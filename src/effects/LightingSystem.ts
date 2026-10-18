import * as Phaser from 'phaser';
import { characterLightWeight, characterLightBlockedRect, CHARACTER_MATERIAL_CONFIG,
  type CharacterMaterialLight } from './CharacterMaterialModel';
import {
  DEPTH_LIGHTING,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '../config';
import { ensureCanvasTexture, fillRadialGradientTexture } from './EffectUtils';
import { createVisibleWorldView, getVisibleWorldView } from '../graphics/CameraWorldView';
import { EnemyEyeBatch } from './EnemyEyeBatch';
import type { EnemyEyeLightFrame } from './EnemyEyeGlowModel';
import type { EssenceLightFrame } from '../adrenalineEssence/AdrenalineEssenceLighting';
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
  DEFAULT_LIGHT_FALLOFF_EXPONENT,
  resolveSurfaceReachPx,
  type LightPreset,
  type LightPresetKey,
} from './LightingConfig';
import { MAX_SURFACE_LIGHTS, type SurfaceLightFrame } from './SurfaceLocalLights';
import { OCCLUDER_GROUP_ROCK } from './LightOccluderIndex';
import {
  ROCK_PENETRATION_FRAGMENT, ROCK_PENETRATION_SHADER_NAME, ROCK_SHADOW_POLAR_FRAGMENT, ROCK_SHADOW_POLAR_SHADER_NAME,
  ROCK_SHADOW_ROWS, ROCK_SHADOW_TEXELS, rockShadowSpan,
} from './RockPenetrationShader';
import { ownSunShader, SunRenderTarget } from './sunlight/SunRenderTarget';
import type { FormationCoverageBinding } from '../arena/rocks/RockFormationLighting';
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
  projectRectBackShadowQuads,
  projectRectShadowQuads,
} from './lightShadowGeometry';
import {
  type ArenaVisualAttributionCollector,
} from '../scenes/arena/ArenaVisualAttribution';

const TEX_LIGHT_RADIAL = '__light_radial';
const RADIAL_TEX_SIZE = 256;
const CONE_TEX_WIDTH = 256;
const CONE_TEX_HEIGHT = 512;

const LIGHT_BLEED_FRAGMENT = `
precision highp float;
uniform sampler2D uLightMap;
uniform sampler2D uAmbientLayer;
uniform vec3 uAmbient;
uniform float uBleedFactor;
uniform float uAmbientLayerOn;
uniform float uAmbientLayerWeight;
varying vec2 outTexCoord;
void main() {
  // The shared map already includes light color, falloff, budgets and occlusion. A world-anchored
  // ambient layer (moon islands) belongs to the night itself: only lamps above it may bleed.
  vec3 floorLight = uAmbient + (uAmbientLayerOn > 0.5 ? texture2D(uAmbientLayer, outTexCoord).rgb * uAmbientLayerWeight : vec3(0.0));
  vec3 excess = max(texture2D(uLightMap, outTexCoord).rgb - floorLight, vec3(0.0));
  float peak = max(excess.r, max(excess.g, excess.b));
  // A shared shoulder preserves the residual hue instead of whitening each channel.
  float shoulder = (1.0 - exp(-2.0 * peak)) / max(peak, 0.00001);
  gl_FragColor = vec4(excess * shoulder * uBleedFactor, 1.0);
}
`;

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
/** Wachstumsraster der Lightmap beim Herauszoomen: grob genug, dass ein Zoomverlauf selten neu anlegt. */
const LIGHTMAP_VIEWPORT_GROWTH_STEP_PX = 256;
/** Subpixel-Toleranz gegen Gleitkommarauschen der Kamera-Scrollposition. */
const LIGHTMAP_VIEWPORT_EPSILON_PX = 0.5;

/** Anteil der Felsfront-Eindringtiefe, der voll beleuchtet bleibt; danach läuft der Verlauf. */
const SURFACE_REACH_LIT_SHARE = 0.35;
const SCRATCH_SIZE_UNIFORM = new Float32Array([OCCLUDER_SCRATCH_SIZE, OCCLUDER_SCRATCH_SIZE]);
/** Shader quads drawn into a render texture see their texture coordinates upside down. */
const ROCK_PENETRATION_FLIP_Y = 1;

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

/** Light drawn additively into the light map right after the ambient fill, in light-map pixels. */
export interface LightMapAmbientLayer {
  /** Visible world rectangle of the light map and its pixel size; null draws nothing this frame. */
  update(worldX: number, worldY: number, worldWidth: number, worldHeight: number, width: number, height: number):
    Phaser.GameObjects.GameObject | null;
  /** Light the layer adds at a world point (RGB 0..1), for receivers above the map such as canopies. */
  sampleAt?(x: number, y: number, out: number[]): number[];
  /**
   * The layer's added light in light-map space for the current frame. The bleed treats it as
   * ambient, so world-anchored night light never glows on its own.
   */
  readonly lightTexture?: Phaser.Textures.Texture | null;
  /** Share of `lightTexture` the bleed treats as ambient, 0..1; omitted means all of it. */
  readonly bleedWeight?: number;
}

/** Ausgeliehener Frame kleiner farbiger Bodenleuchten (siehe {@link LightingSystem.setGroundGlowLights}). */
export interface GroundGlowLightFrame {
  readonly lights: readonly { x: number; y: number; radiusPx: number; intensity: number; color: number }[];
  readonly lightCount: number;
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
  /**
   * Organic rock light of this slot's lamp: the polar rock map is drawn at once, the erase that
   * reads it runs at render time, so every slot keeps its own map and uniforms.
   */
  penetration?: { readonly shader: Phaser.GameObjects.Shader; readonly lamp: Float32Array; readonly reach: Float32Array;
    readonly cone: Float32Array; readonly polar: SunRenderTarget; readonly polarLamp: Float32Array;
    readonly frame: Float32Array; span: number; binding: FormationCoverageBinding | null };
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
 * MULTIPLY-Overlay über die Welt gelegt wird. Ein optionaler Bleed-Quad liest dieselbe
 * Textur und addiert nur Licht oberhalb des Ambients. Dadurch werden Spieler, Gegner und
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
  private sunAmbient: number | null = null;
  private timeOfDayMinutes = DEFAULT_TIME_OF_DAY_MINUTES;
  private sky: SkyState = resolveSkyState(DEFAULT_TIME_OF_DAY_MINUTES);

  private lightMap: Phaser.GameObjects.RenderTexture | null = null;
  private lightBleed: Phaser.GameObjects.Shader | null = null;
  private readonly bleedAmbient = new Float32Array(3);
  private readonly slots: OccluderSlot[] = [];
  private readonly occlusionCachePool: OcclusionCache[] = [];
  private activeExplosionCacheCount = 0;

  private readonly lights: ActiveLight[] = [];
  private readonly pool: ActiveLight[] = [];
  private readonly keyed = new Map<string, ActiveLight>();
  private readonly renderQueue: ActiveLight[] = [];
  private enemyEyeFrame: EnemyEyeLightFrame | null = null;
  private enemyEyeBatch: EnemyEyeBatch | null = null;
  private renderedEyeLights = 0;
  private readonly essenceFrames = new Map<object, EssenceLightFrame>();
  private essenceBatch: EnemyEyeBatch | null = null;
  /** Kleine farbige Bodenleuchten (z. B. leuchtende Fußspuren), gesammelt in einem Draw. */
  private readonly groundGlowFrames = new Map<object, GroundGlowLightFrame>();
  private readonly decorativeGlowOwners = new Set<object>();
  private groundGlowBatch: EnemyEyeBatch | null = null;
  private renderedGroundGlowLights = 0;
  private renderedEssenceLights = 0;

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
  private ambientLayer: LightMapAmbientLayer | null = null;
  private readonly onContextRestored = (): void => {
    this.lightMapHoldsAmbientOnly = false;
    for (const light of this.lights) if (light.occlusionCache) light.occlusionCache.valid = false;
  };
  private lastCostMs = 0;
  private lastPerformance = emptyPerformanceMetrics();
  private performanceMetricsEnabled = false;
  private attributionCollector: ArenaVisualAttributionCollector | null = null;
  private quality: GraphicsQualityProfile;
  private unsubscribeQuality: (() => void) | null = null;

  /**
   * Logische Fläche der bildschirmfesten Lightmap. Sie startet beim Basis-Viewport und wächst nur,
   * wenn die Kamera weiter herauszoomt, als dieser abdeckt; sonst bliebe rechts und unten unbeleuchtete Welt.
   */
  private viewport: { width: number; height: number };
  private readonly cameraViewScratch = createVisibleWorldView();

  constructor(private readonly scene: Phaser.Scene,
    private readonly baseViewport: { readonly width: number; readonly height: number } = { width: GAME_WIDTH, height: GAME_HEIGHT }) {
    this.viewport = { width: baseViewport.width, height: baseViewport.height };
    this.quality = getGraphicsQualityProfile(scene);
    this.unsubscribeQuality = getGraphicsQualityController(scene)?.subscribe((profile) => {
      this.setGraphicsQuality(profile);
    }) ?? null;
    this.ensureTextures();
    scene.sys?.renderer?.on(Phaser.Renderer.Events.RESTORE_WEBGL, this.onContextRestored);
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
  /**
   * Resident V7 rock coverage for organic lamp penetration (Nachtsicht N-4). Without coverage the
   * rock front keeps the cell-aligned inset band.
   */
  setRockCoverage(provider: (() => FormationCoverageBinding | null) | null): void {
    this.rockCoverage = provider;
  }
  private rockCoverage: (() => FormationCoverageBinding | null) | null = null;

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

  /**
   * World-anchored light added right after the ambient fill (Dawn blood moon through cloud openings).
   * Its owner is the same as the ambient's; lights are stamped on top unchanged. Null removes it.
   */
  /**
   * Decorative light drawn additively after the ambient layer, e.g. the void creep's night glow.
   * Unlike the ambient layer it counts as light above the night, so the bleed lets it glow.
   */
  setGlowLayer(layer: LightMapAmbientLayer | null): void { this.glowLayer = layer; }
  private glowLayer: LightMapAmbientLayer | null = null;

  setAmbientLayer(layer: LightMapAmbientLayer | null): void {
    if (this.ambientLayer === layer) return;
    this.ambientLayer = layer;
    this.lightMapHoldsAmbientOnly = false;
  }

  /** Reversible dev presentation override; lamps retain their production sky factors. */
  setSunAmbient(color: number | null): void {
    if(color!==null&&(!Number.isInteger(color)||color<0||color>0xffffff))throw new Error('Invalid sunlight ambient');
    if(this.sunAmbient===color)return;
    this.sunAmbient=color;this.lightMapHoldsAmbientOnly=false;
  }
  getAmbientColor(): number { return this.sunAmbient ?? this.sky.ambientColor; }

  getTimeOfDayMinutes(): number {
    return this.timeOfDayMinutes;
  }

  /** Bounded, borrowed presentation port. No new light ownership or irradiance:
   * the material uses these two directions for relative form only. */
  sampleCharacterMaterialLights(x: number, y: number, out: CharacterMaterialLight[]): void {
    for (const sample of out) sample.weight = 0;
    if (!this.enabled || out.length < 2) return;
    for (const light of this.renderQueue) {
      const weight = characterLightWeight(light, x, y);
      if (weight <= out[1].weight) continue;
      if (light.occludes && !this.vectorSuppressed) {
        let blocked = false;
        const rect = (l:number,t:number,r:number,b:number):void => {
          blocked ||= characterLightBlockedRect(light.x,light.y,x,y,l,t,r,b);
        };
        const distance = Math.hypot(x-light.x,y-light.y);
        this.occluders?.queryCircle(light.x,light.y,distance,rect,(cx,cy,radius) => {
          const dx=x-light.x,dy=y-light.y,length2=dx*dx+dy*dy;
          if (Math.hypot(cx-light.x,cy-light.y)<=radius || length2===0) return;
          const t=Math.max(0,Math.min(1,((cx-light.x)*dx+(cy-light.y)*dy)/length2));
          blocked ||= Math.hypot(light.x+t*dx-cx,light.y+t*dy-cy)<radius;
        });
        if (!blocked) this.dynamicOccluders?.queryCircle(light.x,light.y,distance,rect);
        if (blocked) continue;
      }
      const target = weight > out[0].weight ? 0 : 1;
      if (target===0) Object.assign(out[1],out[0]);
      out[target].x=light.x; out[target].y=light.y;
      out[target].height=CHARACTER_MATERIAL_CONFIG.localHeight; out[target].weight=weight;
    }
  }

  /**
   * Bounded, borrowed presentation port for materials below the light map (Nachtsicht N-4):
   * the strongest relief lamps of this frame whose reach meets the world rectangle. The
   * material bends only its relative form; irradiance, budget and shadows stay in the map.
   */
  sampleSurfaceLights(x: number, y: number, width: number, height: number, out: SurfaceLightFrame,
    maxLights = MAX_SURFACE_LIGHTS): SurfaceLightFrame {
    out.count = 0;
    out.ambient = colorLuminance(this.getAmbientColor());
    if (!this.enabled) return out;
    const limit = Math.max(0, Math.min(MAX_SURFACE_LIGHTS, maxLights));
    const strengths = this.surfaceLightStrengths;
    for (const light of this.renderQueue) {
      if (light.effectiveIntensity <= 0 || !(LIGHT_PRESETS[light.presetKey] as LightPreset).surfaceRelief) continue;
      const r = light.radiusPx;
      if (light.x + r < x || light.x - r > x + width || light.y + r < y || light.y - r > y + height) continue;
      const strength = light.effectiveIntensity * colorLuminance(light.color);
      let slot = out.count;
      if (slot >= limit) {
        if (limit === 0) break;
        slot = 0;
        for (let i = 1; i < limit; i += 1) if (strengths[i] < strengths[slot]) slot = i;
        if (strengths[slot] >= strength) continue;
      } else {
        out.count += 1;
      }
      strengths[slot] = strength;
      const p = slot * 4;
      out.position[p] = light.x; out.position[p + 1] = light.y;
      out.position[p + 2] = r; out.position[p + 3] = strength;
      if (light.shape === 'cone') {
        const half = light.coneAngle * 0.5;
        out.cone[p] = Math.cos(light.angle); out.cone[p + 1] = Math.sin(light.angle);
        out.cone[p + 2] = half; out.cone[p + 3] = half * 0.7;
      } else {
        out.cone[p] = 1; out.cone[p + 1] = 0; out.cone[p + 2] = 0; out.cone[p + 3] = 0;
      }
      out.profile[p] = lightFalloffExponent(light);
    }
    return out;
  }
  private readonly surfaceLightStrengths = new Float64Array(MAX_SURFACE_LIGHTS);

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

  getDebugStats(): { activeLights: number; renderedLights: number; occlusionSlots: number; enemyEyeLights: number; essenceLights: number } {
    return {
      activeLights: this.lights.length,
      renderedLights: this.renderQueue.length,
      occlusionSlots: this.slots.length,
      enemyEyeLights: this.renderedEyeLights,
      essenceLights: this.renderedEssenceLights,
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
    const base = this.resolveCanopyBase(x, y);
    if (factor <= 0 || (this.lights.length === 0 && this.essenceFrames.size === 0)) return base;

    const lit = Phaser.Math.Clamp(this.sampleLightAmount(x, y) * factor, 0, 1);
    return mixChannels(base, 0xffffff, lit);
  }

  /** Ambient plus the world-anchored ambient layer (moon islands) at a canopy position. */
  private resolveCanopyBase(x: number, y: number): number {
    const ambient = this.getAmbientColor();
    const sample = this.ambientLayer?.sampleAt?.(x, y, this.canopyLayerSample);
    if (!sample || (sample[0] <= 0 && sample[1] <= 0 && sample[2] <= 0)) return ambient;
    let color = 0;
    for (let channel = 0; channel < 3; channel++) {
      const shift = 16 - channel * 8;
      color |= Math.min(255, ((ambient >> shift) & 0xff) + Math.round(sample[channel] * 255)) << shift;
    }
    return color;
  }
  private readonly canopyLayerSample = [0, 0, 0];

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
      // Most canopy/light pairs are far apart. Reject the enclosing square before
      // evaluating the exact radial falloff; in-range tint arithmetic stays identical.
      if (Math.abs(dx) >= light.radiusPx || Math.abs(dy) >= light.radiusPx) continue;
      const distance = Math.hypot(dx, dy);
      if (distance >= light.radiusPx) continue;

      let contribution = (1 - distance / light.radiusPx) ** lightFalloffExponent(light)
        * light.effectiveIntensity;
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
    if (LIGHT_PRESETS.adrenalineEssence.enabled) {
      const factor = this.sky.lightFactor * GLOBAL_LIGHT_INTENSITY_MULT;
      if (factor > 0) {
        for (const frame of this.essenceFrames.values()) total += frame.sampleLightAmount(x, y) * factor;
      }
    }
    return Math.min(1, total);
  }

  /** Gibt alle Lichter frei, ohne die Texturen zu zerstören. */
  clear(): void {
    this.setEnemyEyeLights(null);
    this.essenceFrames.clear();
    this.essenceBatch?.begin(0);
    this.renderedEssenceLights = 0;
    this.groundGlowFrames.clear();
    this.decorativeGlowOwners.clear();
    this.groundGlowBatch?.begin(0);
    this.renderedGroundGlowLights = 0;
    for (const light of this.lights) {
      this.releaseExplosionCache(light);
      this.pool.push(light);
    }
    this.lights.length = 0;
    this.keyed.clear();
    this.syncOverlayVisibility();
  }

  destroy(): void {
    this.scene.sys?.renderer?.off(Phaser.Renderer.Events.RESTORE_WEBGL, this.onContextRestored);
    this.clear();
    this.enemyEyeBatch?.destroy();
    this.enemyEyeBatch = null;
    this.essenceBatch?.destroy();
    this.essenceBatch = null;
    this.groundGlowBatch?.destroy();
    this.groundGlowBatch = null;
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
    if (this.lightBleed) {
      this.lightBleed.destroy();
      this.lightBleed = null;
      this.bleedLayerTexture = null;
    }
    this.lightMap?.destroy();
    this.lightMap = null;
    // Die neue Textur startet leer, das gemerkte Ambient gilt nicht mehr.
    this.lightMapHoldsAmbientOnly = false;
    for (const slot of this.slots) {
      slot.renderTexture.destroy();
      slot.image.destroy();
      slot.graphics.destroy();
      slot.penetration?.shader.destroy();
      slot.penetration?.polar.destroy();
    }
    this.slots.length = 0;
  }

  // ── Lichtquellen ───────────────────────────────────────────────────────────

  /** Borrowed presentation frames; owner identity prevents one scope's teardown clearing another. */
  setEssenceLights(owner: object, frame: EssenceLightFrame | null): void {
    if (frame && frame.lightCount > 0) this.essenceFrames.set(owner, frame);
    else this.essenceFrames.delete(owner);
    if (this.essenceFrames.size === 0) {
      this.essenceBatch?.begin(0);
      this.renderedEssenceLights = 0;
    }
  }

  /**
   * Viele kleine farbige Bodenleuchten außerhalb des Lichtbudgets, z. B. leuchtende
   * Fußspuren. Ausgeliehene Frames; die Besitzeridentität trennt mehrere Quellen.
   */
  setGroundGlowLights(owner: object, frame: GroundGlowLightFrame | null, options?: { decorative?: boolean }): void {
    if (frame && frame.lightCount > 0) this.groundGlowFrames.set(owner, frame);
    else this.groundGlowFrames.delete(owner);
    // Decorative glow (void flora) fills the shared batch last and never displaces gameplay lights.
    if (frame && frame.lightCount > 0 && options?.decorative) this.decorativeGlowOwners.add(owner);
    else this.decorativeGlowOwners.delete(owner);
    if (this.groundGlowFrames.size === 0) {
      this.groundGlowBatch?.begin(0);
      this.renderedGroundGlowLights = 0;
    }
  }

  private countGroundGlowLights(): number {
    let count = 0;
    for (const frame of this.groundGlowFrames.values()) count += frame.lightCount;
    return count;
  }

  private collectGroundGlowLights(scrollX: number, scrollY: number, overscanX: number, overscanY: number): number {
    this.renderedGroundGlowLights = 0;
    const count = this.countGroundGlowLights();
    const factor = this.sky.lightFactor * GLOBAL_LIGHT_INTENSITY_MULT;
    if (count === 0 || factor <= 0 || this.compositeSuppressed) {
      this.groundGlowBatch?.begin(0);
      return 0;
    }
    if (!this.groundGlowBatch) {
      this.groundGlowBatch = new EnemyEyeBatch(this.scene, TEX_LIGHT_RADIAL, 256);
      this.groundGlowBatch.layer.setBlendMode(Phaser.BlendModes.ADD).setName('ground-glow-lights');
    }
    this.groundGlowBatch.begin(Math.min(count, 256));
    const scale = this.quality.lightMapScale;
    for (let pass = 0; pass < 2; pass++) for (const [owner, frame] of this.groundGlowFrames) {
      if (this.decorativeGlowOwners.has(owner) !== (pass === 1)) continue;
      for (let index = 0; index < frame.lightCount && this.renderedGroundGlowLights < 256; index++) {
        const light = frame.lights[index], x = light.x - scrollX, y = light.y - scrollY, r = light.radiusPx;
        if (x + r < -overscanX || y + r < -overscanY
          || x - r > this.viewport.width + overscanX || y - r > this.viewport.height + overscanY) continue;
        this.groundGlowBatch.write((x + overscanX) * scale, (y + overscanY) * scale,
          r * 2 * scale, r * 2 * scale, 0, light.color, Math.min(1, light.intensity * factor));
        this.renderedGroundGlowLights++;
      }
    }
    this.groundGlowBatch.layer.setVisible(this.renderedGroundGlowLights > 0);
    return this.renderedGroundGlowLights;
  }

  private countEssenceLights(): number {
    let count = 0;
    for (const frame of this.essenceFrames.values()) count += frame.lightCount;
    return count;
  }

  private collectEssenceLights(scrollX: number, scrollY: number, overscanX: number, overscanY: number): number {
    this.renderedEssenceLights = 0;
    const count = this.countEssenceLights();
    const preset = LIGHT_PRESETS.adrenalineEssence;
    const factor = this.sky.lightFactor * GLOBAL_LIGHT_INTENSITY_MULT;
    if (count === 0 || !preset.enabled || factor <= 0 || this.compositeSuppressed) {
      this.essenceBatch?.begin(0);
      return 0;
    }
    if (!this.essenceBatch) {
      // Reuse the proven instanced quad packer, with a separate layer and lifetime from enemy eyes.
      this.essenceBatch = new EnemyEyeBatch(this.scene, TEX_LIGHT_RADIAL, 256);
      this.essenceBatch.layer.setBlendMode(Phaser.BlendModes.ADD).setName('adrenaline-essence-lights');
    }
    this.essenceBatch.begin(count);
    const scale = this.quality.lightMapScale;
    for (const frame of this.essenceFrames.values()) {
      for (let index = 0; index < frame.lightCount; index++) {
        const light = frame.lights[index], x = light.x - scrollX, y = light.y - scrollY, r = light.radiusPx;
        if (x + r < -overscanX || y + r < -overscanY
          || x - r > this.viewport.width + overscanX || y - r > this.viewport.height + overscanY) continue;
        this.essenceBatch.write((x + overscanX) * scale, (y + overscanY) * scale,
          r * 2 * scale, r * 2 * scale, 0, preset.color, Math.min(1, light.intensity * factor));
        this.renderedEssenceLights++;
      }
    }
    this.essenceBatch.layer.setVisible(this.renderedEssenceLights > 0);
    return this.renderedEssenceLights;
  }

  /** Borrowed until the next visual frame; separate from ranked, potentially shadowed lights. */
  setEnemyEyeLights(frame: EnemyEyeLightFrame | null): void {
    this.enemyEyeFrame = frame;
    if (!frame || frame.lightCount === 0) {
      this.enemyEyeBatch?.begin(0);
      this.renderedEyeLights = 0;
    }
  }

  private collectEnemyEyeLights(scrollX: number, scrollY: number, overscanX: number, overscanY: number): number {
    this.renderedEyeLights = 0;
    const frame = this.enemyEyeFrame;
    const factor = this.sky.lightFactor * GLOBAL_LIGHT_INTENSITY_MULT;
    if (!frame || !frame.lightCount || factor <= 0 || this.compositeSuppressed) {
      this.enemyEyeBatch?.begin(0);
      return 0;
    }
    if (!this.enemyEyeBatch) {
      this.enemyEyeBatch = new EnemyEyeBatch(this.scene, TEX_LIGHT_RADIAL, 256);
      this.enemyEyeBatch.layer.setBlendMode(Phaser.BlendModes.ADD).setName('enemy-eye-ground-lights');
    }
    // Up to two quads per light: the wide spill and an optional denser inner pool.
    this.enemyEyeBatch.begin(frame.lightCount * 2);
    const scale = this.quality.lightMapScale;
    for (let i = 0; i < frame.lightCount; i++) {
      const light = frame.lights[i], x = light.x - scrollX, y = light.y - scrollY, r = light.radiusPx;
      if (x + r < -overscanX || y + r < -overscanY
          || x - r > this.viewport.width + overscanX || y - r > this.viewport.height + overscanY) continue;
      const lx = (x + overscanX) * scale, ly = (y + overscanY) * scale;
      this.enemyEyeBatch.write(lx, ly, r * 2 * scale, r * 2 * scale, 0, light.color, Math.min(1, light.intensity * factor));
      const inner = light.innerRadiusPx ?? 0;
      if (inner > 0 && light.innerIntensity) {
        this.enemyEyeBatch.write(lx, ly, inner * 2 * scale, inner * 2 * scale, 0, light.color,
          Math.min(1, light.innerIntensity * factor));
      }
      this.renderedEyeLights++;
    }
    this.enemyEyeBatch.layer.setVisible(this.renderedEyeLights > 0);
    return this.renderedEyeLights;
  }

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

  /** Immediate release also removes an already fading source, for visibility/lifetime changes. */
  releaseLight(key: string, options?: { readonly immediate?: boolean }): void {
    const light = this.keyed.get(key);
    if (!light) return;
    if (options?.immediate) {
      this.keyed.delete(key);
      this.releaseExplosionCache(light);
      const index = this.lights.indexOf(light);
      if (index >= 0) {
        this.lights[index] = this.lights[this.lights.length - 1];
        this.lights.pop();
      }
      const queuedIndex = this.renderQueue.indexOf(light);
      if (queuedIndex >= 0) this.renderQueue.splice(queuedIndex, 1);
      this.pool.push(light);
      return;
    }
    if (light.releasedAt > 0) return;
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

    this.syncViewportToCamera();
    const overlay = this.ensureLightMap();
    const scrollX = this.scene.cameras.main.scrollX;
    const scrollY = this.scene.cameras.main.scrollY;
    const overscanX = this.getLightMapOverscanPx(this.viewport.width);
    const overscanY = this.getLightMapOverscanPx(this.viewport.height);

    const queueStartedAt = metricsEnabled ? performance.now() : 0;
    this.collectRenderQueue(now, scrollX, scrollY);
    const eyeLights = this.collectEnemyEyeLights(scrollX, scrollY, overscanX, overscanY);
    const essenceLights = this.collectEssenceLights(scrollX, scrollY, overscanX, overscanY);
    const groundGlowLights = this.collectGroundGlowLights(scrollX, scrollY, overscanX, overscanY);
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

    const ambientColor = this.getAmbientColor();
    const ambientIsNeutral = ambientColor === NEUTRAL_AMBIENT_COLOR;
    // A world-anchored ambient layer drifts with the camera and the clouds: never reuse last frame's map.
    const noLights = this.renderQueue.length === 0 && eyeLights === 0 && essenceLights === 0 && groundGlowLights === 0;
    const queueEmpty = noLights && this.ambientLayer === null && this.glowLayer === null;
    this.syncLightBleed(overlay, !noLights);

    // Reihenfolge ist tragend: erst Sichtbarkeit entscheiden, dann erst Befehle erzeugen.
    // `setRenderMode('all')` leert den Command-Buffer am Platz des Objekts in der
    // Display-List – ein unsichtbares Objekt mit gefülltem Buffer ließe ihn auflaufen.
    if (ambientIsNeutral || this.compositeSuppressed) {
      // Weißes Ambient bleibt auch mit additiven Lichtern weiß: kein Renderpass, kein
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
    const ambientLayer = this.ambientLayer?.update(scrollX - overscanX, scrollY - overscanY,
      this.viewport.width + overscanX * 2, this.viewport.height + overscanY * 2, overlay.width, overlay.height) ?? null;
    if (ambientLayer) overlay.draw(ambientLayer);
    const glowLayer = this.glowLayer?.update(scrollX - overscanX, scrollY - overscanY,
      this.viewport.width + overscanX * 2, this.viewport.height + overscanY * 2, overlay.width, overlay.height) ?? null;
    if (glowLayer) overlay.draw(glowLayer);
    // One instanced draw for every visible eye light, independent of the ranked light budget.
    if (eyeLights > 0) overlay.draw(this.enemyEyeBatch!.layer);
    if (essenceLights > 0) overlay.draw(this.essenceBatch!.layer);
    if (groundGlowLights > 0) overlay.draw(this.groundGlowBatch!.layer);

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
    let directLights = eyeLights + essenceLights + groundGlowLights;
    let fallbackOccludingLights = 0;
    let directMs = 0;
    let occlusionMs = 0;
    let shadowGeometryMs = 0;
    let shadowQuads = 0;
    let falloffQuads = 0;
    let dynamicOccluderTests = 0;
    let dynamicOccluderHits = 0;
    let commandCount = 1 + (eyeLights > 0 ? 1 : 0) + (essenceLights > 0 ? 1 : 0) + (groundGlowLights > 0 ? 1 : 0);
    let radialLights = eyeLights + essenceLights + groundGlowLights;
    let coneLights = 0;
    const presetCounts = countMetrics ? {} as Record<string, number> : null;
    if (presetCounts && eyeLights > 0) presetCounts.enemyEyes = eyeLights;
    if (presetCounts && essenceLights > 0) presetCounts.adrenalineEssence = essenceLights;
    if (presetCounts && groundGlowLights > 0) presetCounts.groundGlow = groundGlowLights;
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
        this.lights.length + (this.enemyEyeFrame?.lightCount ?? 0) + this.countEssenceLights() + this.countGroundGlowLights(),
        this.renderQueue.length + eyeLights + essenceLights + groundGlowLights,
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
      activeLights: this.lights.length + (this.enemyEyeFrame?.lightCount ?? 0) + this.countEssenceLights() + this.countGroundGlowLights(),
      renderedLights: this.renderQueue.length + eyeLights + essenceLights + groundGlowLights,
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
      lightMapPixels: Math.ceil((this.viewport.width + overscanX * 2) * this.quality.lightMapScale)
        * Math.ceil((this.viewport.height + overscanY * 2) * this.quality.lightMapScale),
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
    const overscanX = this.getLightMapOverscanPx(this.viewport.width);
    const overscanY = this.getLightMapOverscanPx(this.viewport.height);

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
      if (screenX + reach < -overscanX || screenX - reach > this.viewport.width + overscanX) continue;
      if (screenY + reach < -overscanY || screenY - reach > this.viewport.height + overscanY) continue;

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
        (light.x - scrollX + this.getLightMapOverscanPx(this.viewport.width)) * scale,
        (light.y - scrollY + this.getLightMapOverscanPx(this.viewport.height)) * scale,
      );
      return null;
    }

    const overscanX = this.getLightMapOverscanPx(this.viewport.width);
    const overscanY = this.getLightMapOverscanPx(this.viewport.height);
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
      target.stamp(this.ensureConeTexture(light.coneAngle, lightFalloffExponent(light)), undefined, x, y, {
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

    const preset = LIGHT_PRESETS[light.presetKey] as LightPreset;
    const coverage = preset.surfaceReachNearPx !== undefined && preset.surfaceReachFarPx !== undefined
      ? this.rockCoverage?.() ?? null : null;
    const geometryStartedAt = collectMetrics ? performance.now() : 0;
    this.buildShadowGraphics(light, slot.graphics, center, collectCounts, coverage);
    const durationMs = collectMetrics ? performance.now() - geometryStartedAt : 0;
    const shadowQuads = collectCounts ? this.shadowQuads.length : 0;
    const falloffQuads = collectCounts ? this.falloffQuads.length : 0;
    slot.renderTexture.erase([slot.graphics]);
    if (coverage) slot.renderTexture.erase([this.preparePenetration(slot, light, preset, coverage, center)]);
    this.frameOcclusionRefreshes += 1;

    slot.image.setPosition(
      (light.x - scrollX + this.getLightMapOverscanPx(this.viewport.width)) * this.quality.lightMapScale,
      (light.y - scrollY + this.getLightMapOverscanPx(this.viewport.height)) * this.quality.lightMapScale,
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
    organicRocks: FormationCoverageBinding | null = null,
  ): void {
    graphics.clear();
    const core = this.shadowQuads;
    const falloff = this.falloffQuads;
    core.reset();
    falloff.reset();
    this.projectStaticShadowGeometry(light, core, falloff, organicRocks);
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
    organicRocks: FormationCoverageBinding | null = null,
  ): void {
    const extendPx = light.radiusPx * SHADOW_EXTEND_FACTOR;
    const falloffPx = OCCLUDER_SHADE_FALLOFF_PX;
    const preset = LIGHT_PRESETS[light.presetKey] as LightPreset;
    const reaches = preset.surfaceReachNearPx !== undefined && preset.surfaceReachFarPx !== undefined;
    const projectRect = (
      left: number,
      top: number,
      right: number,
      bottom: number,
      exposedEdges: number,
      group?: number,
    ): void => {
      if (reaches && group === OCCLUDER_GROUP_ROCK) {
        // Nachtsicht N-4: Die Lampe leuchtet die Felsfront bis zur Eindringtiefe aus, dahinter
        // bleibt alles dunkel. Resident coverage leaves the rock entirely to the polar rock map,
        // so lit front and shadow share the real contour; cell rectangles would disagree with it.
        if (organicRocks?.covers?.(left, top, right, bottom)) return;
        const distance = Math.hypot((left + right) * 0.5 - light.x, (top + bottom) * 0.5 - light.y);
        const reach = Math.max(falloffPx, resolveSurfaceReachPx(preset, distance, light.radiusPx));
        projectRectShadowQuads(falloff, light.x, light.y, left, top, right, bottom,
          reach * SURFACE_REACH_LIT_SHARE, reach * (1 - SURFACE_REACH_LIT_SHARE), exposedEdges);
        projectRectShadowQuads(core, light.x, light.y, left, top, right, bottom, reach, extendPx, exposedEdges);
        projectRectBackShadowQuads(core, light.x, light.y, left, top, right, bottom, 0, extendPx, exposedEdges);
        return;
      }
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
    // Never display a stale light field between a state change and the next update.
    this.lightBleed?.setVisible(false);
    if (!this.lightMap) return;
    // Der Fall „weißes Ambient" wird bewusst nur in `update()` entschieden,
    // damit beide Stellen nicht auseinanderlaufen können.
    this.lightMap.setVisible(this.enabled && !this.compositeSuppressed);
  }

  private syncLightBleed(lightMap: Phaser.GameObjects.RenderTexture, hasLights: boolean): void {
    if (!hasLights || this.compositeSuppressed || !this.quality.lightBleed
      || this.sky.bleedFactor <= 0 || this.getAmbientColor() === NEUTRAL_AMBIENT_COLOR) {
      this.lightBleed?.setVisible(false);
      return;
    }

    const ambient = this.getAmbientColor();
    this.bleedAmbient[0] = ((ambient >> 16) & 0xff) / 255;
    this.bleedAmbient[1] = ((ambient >> 8) & 0xff) / 255;
    this.bleedAmbient[2] = (ambient & 0xff) / 255;
    if (!this.lightBleed) {
      const quad = new Phaser.GameObjects.Shader(this.scene, {
        name: 'LightBleed', shaderName: 'LightBleed', fragmentSource: LIGHT_BLEED_FRAGMENT,
        setupUniforms: (set: (name: string, value: unknown) => void) => {
          set('uLightMap', 0);
          set('uAmbientLayer', 1);
          set('uAmbientLayerOn', this.bleedLayerTexture ? 1 : 0);
          set('uAmbientLayerWeight', Math.max(0, Math.min(1, this.ambientLayer?.bleedWeight ?? 1)));
          set('uAmbient', this.bleedAmbient);
          set('uBleedFactor', this.sky.bleedFactor);
        },
      }, lightMap.x, lightMap.y, lightMap.displayWidth, lightMap.displayHeight, [lightMap.texture, lightMap.texture]);
      // Capture before Shader.preDestroy clears renderNode, including DisplayList shutdown.
      const node = quad.renderNode;
      quad.once('destroy', () => {
        for (const suite of Object.values(node.programManager.programs)) {
          Phaser.Utils.Array.Remove(node.renderer.glVAOWrappers, suite.vao);
          suite.vao.destroy();
        }
        node.programManager.programs = {};
        node.renderer.deleteBuffer(node.vertexBufferLayout.buffer);
      });
      quad.setTextureCoordinatesFromFrame(lightMap.frame);
      // SCREEN = dst + bleed * (1 - dst): an additive contribution with remaining
      // headroom, so even overlapping lights cannot hard-clip the world to white.
      // No extra lightmap/filter framebuffer; the map's 'all' draw runs first.
      quad.setOrigin(0).setScrollFactor(0).setDepth(DEPTH_LIGHTING + 0.001)
        .setBlendMode(Phaser.BlendModes.SCREEN);
      this.lightBleed = this.scene.add.existing(quad);
    }
    const layerTexture = this.ambientLayer?.lightTexture ?? null;
    if (layerTexture !== this.bleedLayerTexture) {
      this.bleedLayerTexture = layerTexture;
      this.lightBleed.setTextures([lightMap.texture, layerTexture ?? lightMap.texture]);
    }
    this.lightBleed.setVisible(true);
  }
  private bleedLayerTexture: Phaser.Textures.Texture | null = null;

  private ensureLightMap(): Phaser.GameObjects.RenderTexture {
    if (this.lightMap) return this.lightMap;

    const overscanX = this.getLightMapOverscanPx(this.viewport.width);
    const overscanY = this.getLightMapOverscanPx(this.viewport.height);
    const displayWidth = this.viewport.width + overscanX * 2;
    const displayHeight = this.viewport.height + overscanY * 2;
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

  /**
   * Die Lightmap liegt bildschirmfest ab der Kamera-Scrollposition und skaliert mit dem Kamera-Zoom
   * (Ursprung oben links). Zeigt die Kamera mehr Welt als der Basis-Viewport, wächst die Fläche in
   * groben Schritten mit; die Render-Targets werden nur bei einer Größenänderung neu angelegt.
   * `view.right - scrollX` trägt Gleitkommarauschen der Scrollposition: bei Zoom 1 liegt es oft
   * knapp über der Basisbreite. Ohne Toleranz und Hysterese pendelte die Fläche deshalb fast jeden
   * Frame zwischen zwei Stufen und baute Lightmap und Occluder-Slots neu auf. Wachsen geschieht
   * sofort, Schrumpfen erst ab einer vollen Stufe Abstand.
   */
  private syncViewportToCamera(): void {
    const camera = this.scene.cameras?.main;
    if (!camera) return;
    const view = getVisibleWorldView(camera, this.cameraViewScratch);
    const step = LIGHTMAP_VIEWPORT_GROWTH_STEP_PX;
    const cover = (base: number, current: number, extent: number) => {
      const needed = extent <= base + LIGHTMAP_VIEWPORT_EPSILON_PX ? base
        : Math.ceil((extent - LIGHTMAP_VIEWPORT_EPSILON_PX) / step) * step;
      return needed > current || needed <= current - step ? needed : current;
    };
    const width = cover(this.baseViewport.width, this.viewport.width, view.right - camera.scrollX);
    const height = cover(this.baseViewport.height, this.viewport.height, view.bottom - camera.scrollY);
    if (width === this.viewport.width && height === this.viewport.height) return;
    this.viewport = { width, height };
    this.destroyRenderTargets();
  }

  private getLightMapOverscanPx(viewportSize: number): number {
    void viewportSize;
    return LIGHTMAP_OVERSCAN_ALIGNMENT_PX;
  }

  /**
   * Draws the slot's polar rock map for this lamp now and returns the erase quad that reads it
   * at render time; map, quad and uniforms are reused per slot.
   */
  private preparePenetration(slot: OccluderSlot, light: ActiveLight, preset: LightPreset,
    coverage: FormationCoverageBinding, center: number): Phaser.GameObjects.Shader {
    if (!slot.penetration) {
      const lamp = new Float32Array(4), reach = new Float32Array(4), cone = new Float32Array(3);
      const polarLamp = new Float32Array(4), frame = new Float32Array(4);
      const polar = new SunRenderTarget(this.scene, 'RockShadowPolar', ROCK_SHADOW_POLAR_FRAGMENT, set => {
        set('uRockField', 0); set('uRockLookup', 1); set('uRockFrame', frame);
        set('uLamp', polarLamp); set('uSpan', slot.penetration?.span ?? Math.PI * 2);
      }, [coverage.field, coverage.lookup], ROCK_SHADOW_POLAR_SHADER_NAME);
      let shader: Phaser.GameObjects.Shader;
      try {
        shader = new Phaser.GameObjects.Shader(this.scene, {
          name: ROCK_PENETRATION_SHADER_NAME, shaderName: ROCK_PENETRATION_SHADER_NAME, fragmentSource: ROCK_PENETRATION_FRAGMENT,
          setupUniforms: (set: (name: string, value: unknown) => void) => {
            set('uRockShadow', 0); set('uLamp', lamp); set('uReach', reach); set('uCone', cone);
            set('uScratchSize', SCRATCH_SIZE_UNIFORM); set('uFlipY', ROCK_PENETRATION_FLIP_Y);
          },
        }, 0, 0, OCCLUDER_SCRATCH_SIZE, OCCLUDER_SCRATCH_SIZE, [polar.shader.texture!]);
      } catch (error) { polar.destroy(); throw error; }
      // Private VAO and buffer die with the slot; the program stays shared like other fixed keys.
      ownSunShader(shader, ROCK_PENETRATION_SHADER_NAME, true);
      shader.setOrigin(0, 0);
      slot.penetration = { shader, lamp, reach, cone, polar, polarLamp, frame, span: Math.PI * 2, binding: coverage };
    }
    const penetration = slot.penetration;
    if (penetration.binding !== coverage) {
      penetration.polar.shader.setTextures([coverage.field, coverage.lookup]);
      penetration.binding = coverage;
    }
    for (let i = 0; i < 4; i++) penetration.frame[i] = coverage.frame[i];
    const span = rockShadowSpan(light.shape, light.coneAngle);
    penetration.span = span;
    penetration.polarLamp[0] = light.x; penetration.polarLamp[1] = light.y;
    penetration.polarLamp[2] = light.radiusPx; penetration.polarLamp[3] = light.angle;
    penetration.polar.draw(ROCK_SHADOW_TEXELS, ROCK_SHADOW_ROWS);
    penetration.lamp[0] = light.x; penetration.lamp[1] = light.y;
    penetration.lamp[2] = center; penetration.lamp[3] = 1 / this.quality.lightMapScale;
    penetration.reach[0] = preset.surfaceReachNearPx!; penetration.reach[1] = preset.surfaceReachFarPx!;
    penetration.reach[2] = light.radiusPx; penetration.reach[3] = SURFACE_REACH_LIT_SHARE;
    penetration.cone[0] = light.angle; penetration.cone[1] = span; penetration.cone[2] = span >= Math.PI * 2 - 1e-6 ? 1 : 0;
    return penetration.shader;
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
  private ensureConeTexture(coneAngle: number, exponent = DEFAULT_LIGHT_FALLOFF_EXPONENT): string {
    const angleKey = Math.round(coneAngle * 1000) * 1000 + Math.round(exponent * 100);
    const existing = this.coneTextureKeys.get(angleKey);
    if (existing) return existing;

    // The default curve keeps its historical key; flatter beams get their own texture.
    const key = exponent === DEFAULT_LIGHT_FALLOFF_EXPONENT
      ? `__light_cone_${Math.round(coneAngle * 1000)}`
      : `__light_cone_${Math.round(coneAngle * 1000)}_${Math.round(exponent * 100)}`;
    const halfAngle = coneAngle * 0.5;
    const apexY = CONE_TEX_HEIGHT * 0.5;
    const range = CONE_TEX_WIDTH;
    const edgeStart = halfAngle * 0.7;
    const edgeSteps = 12;

    ensureCanvasTexture(this.scene.textures, key, CONE_TEX_WIDTH, CONE_TEX_HEIGHT, (ctx) => {
      // Abstandskurve (1 - d/r)^n; n = 2 entspricht der runden Lichttextur.
      const beam = ctx.createRadialGradient(0, apexY, 0, 0, apexY, range);
      if (exponent === DEFAULT_LIGHT_FALLOFF_EXPONENT) {
        beam.addColorStop(0, 'rgba(255,255,255,1)');
        beam.addColorStop(0.25, 'rgba(255,255,255,0.5625)');
        beam.addColorStop(0.5, 'rgba(255,255,255,0.25)');
        beam.addColorStop(0.75, 'rgba(255,255,255,0.0625)');
        beam.addColorStop(1, 'rgba(255,255,255,0)');
      } else {
        for (let stop = 0; stop <= 16; stop += 1) {
          const t = stop / 16;
          beam.addColorStop(t, `rgba(255,255,255,${((1 - t) ** exponent).toFixed(4)})`);
        }
      }

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

/** Abstandskurve eines Lichts: Kegel dürfen sie abflachen, alles andere bleibt (1 - d/r)². */
function lightFalloffExponent(light: ActiveLight): number {
  if (light.shape !== 'cone') return DEFAULT_LIGHT_FALLOFF_EXPONENT;
  return (LIGHT_PRESETS[light.presetKey] as LightPreset).falloffExponent ?? DEFAULT_LIGHT_FALLOFF_EXPONENT;
}

function colorLuminance(color: number): number {
  return (((color >> 16) & 0xff) * 0.2126 + ((color >> 8) & 0xff) * 0.7152 + (color & 0xff) * 0.0722) / 255;
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
