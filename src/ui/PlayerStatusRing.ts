import * as Phaser from 'phaser';
import {
  ARMOR_COLOR,
  COLORS,
  DEPTH,
  PLAYER_SIZE,
} from '../config';
import { getGraphicsQualityController, getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { fillRadialGradientTexture, registerGraphicsObject } from '../effects/EffectUtils';
import {
  STATUS_RING_FILL_FRAGMENT_SOURCE,
  STATUS_RING_FILL_SHADER_NAME,
  STATUS_RING_FRAGMENT_SOURCE,
  STATUS_RING_SEGMENT_COUNT,
  STATUS_RING_SHADER_NAME,
} from '../effects/living/statusRingShader';
import type { LocalArenaHudData } from './LocalArenaHudData';

type SegmentKey = 'hp' | 'adrenaline' | 'rage';

interface SegmentPalette {
  dark: number;
  mid: number;
  light: number;
  spark: number;
}

interface SegmentConfig {
  key: SegmentKey;
  fillStartAngle: number;
  fillEndAngle: number;
  palette: SegmentPalette;
}

interface AngleSection {
  startAngle: number;
  endAngle: number;
}

const RING_GAP_PX = 16;
const RING_THICKNESS = 6;
const RING_OUTER_RADIUS = PLAYER_SIZE / 2 + RING_GAP_PX + RING_THICKNESS;
const RING_INNER_RADIUS = RING_OUTER_RADIUS - RING_THICKNESS;
const ARMOR_RIM_THICKNESS = 3;
const POLY_STEPS = 32;
const SHADOW_OFFSET = 0;
const HP_TRAIL_DELAY_MS = 220;
const HP_TRAIL_DURATION_MS = 420;
const FLASH_MS = 180;
const BURST_MS = 320;
const WARNING_MS = 540;
const WARNING_PUNCH_MS = 140;
const GRAPHICS_REFRESH_INTERVAL_MS = 1000 / 30;
/** Ab dieser Fuellung traegt ein Segment ueberhaupt einen lebendigen Anteil. */
const LIVING_MIN_FRACTION = 0.03;
/** Frueher `setAlpha(alpha * 0.92|0.88 * fraction)` auf den Emittern. */
const LIVING_ALPHA_SCALE = 0.9;
const LIVING_QUAD_ALPHA = 0.95;
const TEX_STATUS_RING_STATIC = '__player_status_ring_static_v2';
const STATUS_RING_TEXTURE_PADDING = 8;
const STATUS_RING_TEXTURE_RADIUS = RING_OUTER_RADIUS + STATUS_RING_TEXTURE_PADDING;
const STATUS_RING_TEXTURE_SIZE = Math.ceil(STATUS_RING_TEXTURE_RADIUS * 2);

/** Innerer Kern des Sparks, als Anteil seines Radius. */
const SPARK_INNER_RATIO = 0.58;
const SPARK_TEXTURE_SIZE = 32;
const TEX_STATUS_RING_SPARK = `__player_status_ring_spark/${SPARK_TEXTURE_SIZE}/${SPARK_INNER_RATIO}`;
/** Gleichzeitig sichtbare Sparks: 3 (Burst) + 2 (Boost) + 4 (Ultimate-Rage). */
const MAX_SPARKS = 9;

const PAL_HP: SegmentPalette = { dark: COLORS.GREEN_3, mid: 0x00cc44, light: COLORS.GREEN_1, spark: 0xffffff };
const PAL_ADR: SegmentPalette = { dark: COLORS.BLUE_3, mid: COLORS.BLUE_2, light: COLORS.BLUE_1, spark: 0xffffff };
const PAL_ADR_LOW: SegmentPalette = { dark: 0x5e1720, mid: COLORS.RED_3, light: 0xff9a8a, spark: 0xffffff };
const PAL_RAGE: SegmentPalette = { dark: COLORS.RED_3, mid: COLORS.RED_2, light: COLORS.RED_1, spark: 0xffffff };
const PAL_ARMOR: SegmentPalette = { dark: COLORS.GOLD_3, mid: ARMOR_COLOR, light: COLORS.GOLD_1, spark: COLORS.GREY_1 };

const SEGMENTS: readonly SegmentConfig[] = [
  { key: 'adrenaline', fillStartAngle: 112, fillEndAngle: 8, palette: PAL_ADR },
  { key: 'hp',         fillStartAngle: 232, fillEndAngle: 128, palette: PAL_HP },
  { key: 'rage',       fillStartAngle: 248, fillEndAngle: 352, palette: PAL_RAGE },
];

function clamp01(value: number): number {
  return Phaser.Math.Clamp(value, 0, 1);
}

function degToRadFromTop(angle: number): number {
  return Phaser.Math.DegToRad(angle - 90);
}

function fillArcPolygon(
  graphics: Phaser.GameObjects.Graphics,
  startAngle: number,
  endAngle: number,
  innerRadius: number,
  outerRadius: number,
  color: number,
  alpha: number,
): void {
  graphics.fillStyle(color, alpha);
  graphics.beginPath();
  for (let index = 0; index <= POLY_STEPS; index += 1) {
    const angle = Phaser.Math.Linear(startAngle, endAngle, index / POLY_STEPS);
    const rad = degToRadFromTop(angle);
    const x = Math.cos(rad) * outerRadius;
    const y = Math.sin(rad) * outerRadius;
    if (index === 0) graphics.moveTo(x, y);
    else graphics.lineTo(x, y);
  }
  for (let index = POLY_STEPS; index >= 0; index -= 1) {
    const angle = Phaser.Math.Linear(startAngle, endAngle, index / POLY_STEPS);
    const rad = degToRadFromTop(angle);
    graphics.lineTo(Math.cos(rad) * innerRadius, Math.sin(rad) * innerRadius);
  }
  graphics.closePath();
  graphics.fillPath();
}

function canvasArcLayer(
  ctx: CanvasRenderingContext2D,
  segment: SegmentConfig,
  innerRadius: number,
  outerRadius: number,
  color: number,
  alpha: number,
): void {
  const center = STATUS_RING_TEXTURE_SIZE / 2;
  const start = degToRadFromTop(segment.fillStartAngle);
  const end = degToRadFromTop(segment.fillEndAngle);
  const anticlockwise = segment.fillEndAngle < segment.fillStartAngle;
  ctx.beginPath();
  ctx.arc(center, center, outerRadius, start, end, anticlockwise);
  ctx.arc(center, center, innerRadius, end, start, !anticlockwise);
  ctx.closePath();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fill();
}

function ensureStatusRingStaticTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX_STATUS_RING_STATIC)) return;
  const texture = scene.textures.createCanvas(
    TEX_STATUS_RING_STATIC,
    STATUS_RING_TEXTURE_SIZE,
    STATUS_RING_TEXTURE_SIZE,
  )!;
  const ctx = texture.context;
  for (const segment of [SEGMENTS[1], SEGMENTS[0], SEGMENTS[2]]) {
    canvasArcLayer(ctx, segment, RING_INNER_RADIUS, RING_OUTER_RADIUS, COLORS.GREY_10, 0.28);
  }
  canvasArcLayer(ctx, SEGMENTS[1], RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS, RING_OUTER_RADIUS + 0.4, COLORS.GREY_10, 0.32);
  for (const segment of [SEGMENTS[1], SEGMENTS[0], SEGMENTS[2]]) {
    canvasArcLayer(ctx, segment, RING_INNER_RADIUS, RING_OUTER_RADIUS, segment.palette.dark, 0.26);
    canvasArcLayer(ctx, segment, RING_INNER_RADIUS + 0.8, RING_INNER_RADIUS + RING_THICKNESS * 0.52, COLORS.GREY_10, 0.18);
  }
  canvasArcLayer(ctx, SEGMENTS[1], RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS, RING_OUTER_RADIUS + 0.4, PAL_ARMOR.dark, 0.2);
  ctx.globalAlpha = 1;
  texture.refresh();
}

/**
 * Zwei ineinanderliegende Scheiben als Radialverlauf: aussen 0.7, innen voll. Frueher waren das
 * zwei `fillCircle` pro Spark – und damit rund 101 tesselierte Punkte je Kreis, in jedem
 * gezeichneten Frame neu, unabhaengig vom Radius.
 */
function ensureStatusRingSparkTexture(scene: Phaser.Scene): void {
  fillRadialGradientTexture(scene.textures, TEX_STATUS_RING_SPARK, SPARK_TEXTURE_SIZE, [
    [0, 'rgba(255,255,255,1.00)'],
    [SPARK_INNER_RATIO - 0.02, 'rgba(255,255,255,1.00)'],
    [SPARK_INNER_RATIO, 'rgba(255,255,255,0.70)'],
    [0.94, 'rgba(255,255,255,0.70)'],
    [1, 'rgba(255,255,255,0.00)'],
  ]);
}

export class PlayerStatusRing {
  private readonly container: Phaser.GameObjects.Container;
  private readonly staticRing: Phaser.GameObjects.Image;
  private readonly warningGraphics: Phaser.GameObjects.Graphics;
  private readonly glowGraphics: Phaser.GameObjects.Graphics;
  private readonly fillGraphics: Phaser.GameObjects.Graphics;
  private readonly sparkImages: readonly Phaser.GameObjects.Image[];
  private sparkCursor = 0;

  /**
   * Der lebendige Anteil des Rings: ein einziger Shader-Quad statt der frueheren acht Emitter.
   * `null`, wenn die Qualitaetsstufe ihn abschaltet oder kein WebGL-Renderer verfuegbar ist.
   */
  private livingQuad: Phaser.GameObjects.Shader | null = null;
  /**
   * Die normale Ringfuellung laeuft unabhaengig von `livingBarEffects` auf einem analytischen
   * GPU-Quad. `null` bedeutet nur, dass der Renderer keinen Shader-Quad bereitstellen kann.
   */
  private fillQuad: Phaser.GameObjects.Shader | null = null;
  private livingEnabled = true;
  private unsubscribeQuality: (() => void) | null = null;

  // Uniform-Puffer der vier Segmente (HP, Adrenalin, Rage, Armor). Sie werden nur bei einer
  // Zustandsaenderung neu befuellt; der Shader liest sie bei jedem Renderschritt.
  private readonly segmentArc = new Float32Array(STATUS_RING_SEGMENT_COUNT * 4);
  private readonly segmentBand = new Float32Array(STATUS_RING_SEGMENT_COUNT * 4);
  private readonly segmentFill = new Float32Array(STATUS_RING_SEGMENT_COUNT * 4);
  private readonly segmentTintMid = new Float32Array(STATUS_RING_SEGMENT_COUNT * 3);
  private readonly segmentTintLight = new Float32Array(STATUS_RING_SEGMENT_COUNT * 3);
  private readonly segmentTintDark = new Float32Array(STATUS_RING_SEGMENT_COUNT * 3);
  private livingElapsedSec = 0;
  private ambientPulse = 1;

  private active = false;
  private latestData: LocalArenaHudData | null = null;

  private hpFrac = 1;
  private prevHpFrac = 1;
  private hpTrailFrac = 1;
  private hpTrailFrom = 1;
  private hpTrailTo = 1;
  private hpTrailDelayUntil = 0;
  private hpTrailStartAt = 0;

  private adrFrac = 0;
  private prevAdrFrac = 0;
  private rageFrac = 0;
  private prevRageFrac = 0;

  private armorFrac = 0;
  private adrenalineBoostActive = false;
  private rageReady = false;
  private ultimateActive = false;
  private hpFlashUntil = 0;
  private adrBurstUntil = 0;
  private adrenalineWarningUntil = 0;
  private adrenalineWarningPunchUntil = 0;
  private lastGraphicsSignature = '';
  private nextAnimatedGraphicsAt = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getLocalSprite: () => Phaser.GameObjects.Image | undefined,
    private readonly isLocalAlive: () => boolean = () => true,
    private readonly isLocalBurrowed: () => boolean = () => false,
  ) {
    ensureStatusRingStaticTexture(scene);
    this.staticRing = scene.add.image(SHADOW_OFFSET, SHADOW_OFFSET, TEX_STATUS_RING_STATIC);
    this.warningGraphics = scene.add.graphics();
    this.glowGraphics = scene.add.graphics();
    this.glowGraphics.setBlendMode(Phaser.BlendModes.ADD);
    this.fillGraphics = scene.add.graphics();
    ensureStatusRingSparkTexture(scene);
    this.sparkImages = Array.from({ length: MAX_SPARKS }, () => scene.add
      .image(0, 0, TEX_STATUS_RING_SPARK)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false));
    registerGraphicsObject(scene, 'playerStatus', this.warningGraphics);
    registerGraphicsObject(scene, 'playerStatus', this.glowGraphics);
    registerGraphicsObject(scene, 'playerStatus', this.fillGraphics);

    // Die Basisdarstellung bleibt auch bei abgeschaltetem Living-Effekt aktiv.
    this.fillQuad = this.createFillQuad();

    // Der Ring teilt sich den Qualitaetsschalter mit dem LivingBarEffect: beide zeigen dasselbe
    // lebendige Feld, nur in unterschiedlicher Geometrie.
    this.livingEnabled = getGraphicsQualityProfile(scene).livingBarEffects;
    if (this.livingEnabled) this.livingQuad = this.createLivingQuad();
    this.unsubscribeQuality = getGraphicsQualityController(scene)?.subscribe((profile) => {
      if (profile.livingBarEffects === this.livingEnabled) return;
      this.livingEnabled = profile.livingBarEffects;
      if (!this.livingEnabled) {
        this.livingQuad?.destroy();
        this.livingQuad = null;
        return;
      }
      const quad = this.createLivingQuad();
      if (quad) this.container.add(quad);
      this.livingQuad = quad;
    }) ?? null;

    const children: Phaser.GameObjects.GameObject[] = [
      this.staticRing,
      ...(this.fillQuad ? [this.fillQuad] : []),
      this.warningGraphics,
      this.glowGraphics,
      this.fillGraphics,
      ...this.sparkImages,
    ];
    // Zuoberst: die frueheren Emitter lagen auf derselben Tiefe, wurden aber nach dem Container
    // erzeugt und zeichneten damit ueber allen seinen Kindern.
    if (this.livingQuad) children.push(this.livingQuad);
    this.container = scene.add.container(0, 0, children);
    this.container.setDepth(DEPTH.LOCAL_UI);
    this.container.setVisible(false);
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.container.setVisible(false);
  }

  notifyAdrenalineInsufficientShot(): void {
    const now = this.scene.time.now;
    this.adrenalineWarningUntil = now + WARNING_MS;
    this.adrenalineWarningPunchUntil = now + WARNING_PUNCH_MS;
  }

  update(data: LocalArenaHudData): void {
    this.latestData = data;

    const nextHpFrac = clamp01(data.hp / Math.max(1, data.maxHp));
    const nextAdrFrac = clamp01(data.adrenaline / Math.max(1, data.maxAdrenaline));
    const nextRageFrac = clamp01(data.rage / Math.max(1, data.maxRage));
    const nextArmorFrac = clamp01(data.armor / Math.max(1, data.maxArmor));
    const now = this.scene.time.now;

    if (nextHpFrac < this.prevHpFrac - 0.005) {
      this.hpTrailFrom = Math.max(this.hpTrailFrac, this.prevHpFrac);
      this.hpTrailTo = nextHpFrac;
      this.hpTrailFrac = this.hpTrailFrom;
      this.hpTrailDelayUntil = now + HP_TRAIL_DELAY_MS;
      this.hpTrailStartAt = this.hpTrailDelayUntil;
      this.hpFlashUntil = now + FLASH_MS;
    } else if (nextHpFrac >= this.prevHpFrac) {
      this.hpTrailFrac = nextHpFrac;
      this.hpTrailFrom = nextHpFrac;
      this.hpTrailTo = nextHpFrac;
      this.hpTrailDelayUntil = 0;
      this.hpTrailStartAt = 0;
    }

    if (nextAdrFrac > this.prevAdrFrac + 0.01) {
      this.adrBurstUntil = now + BURST_MS;
    }

    this.hpFrac = nextHpFrac;
    this.adrFrac = nextAdrFrac;
    this.rageFrac = nextRageFrac;
    this.armorFrac = nextArmorFrac;
    this.adrenalineBoostActive = data.adrenalineSyringeActive ?? false;
    this.ultimateActive = data.isUltimateActive;
    this.rageReady = data.rage >= data.ultimateRequiredRage || data.isUltimateActive;

    this.prevHpFrac = nextHpFrac;
    this.prevAdrFrac = nextAdrFrac;
    this.prevRageFrac = nextRageFrac;

    this.render(now);
  }

  destroy(): void {
    this.unsubscribeQuality?.();
    this.unsubscribeQuality = null;
    this.fillQuad = null;
    this.livingQuad = null;
    // `true` zerstoert auch die Kinder, den Shader-Quad eingeschlossen.
    this.container.destroy(true);
  }

  /**
   * Der Quad haengt an der Display-Liste (anders als das Balkenfeld, das offscreen rendert) und
   * wird deshalb von Phaser selbst gezeichnet. `setupUniforms` laeuft dabei je Renderschritt und
   * liest nur die vorbereiteten Puffer.
   */
  private createLivingQuad(): Phaser.GameObjects.Shader | null {
    const renderer = this.scene.sys?.renderer as { gl?: WebGLRenderingContext } | undefined;
    if (!renderer?.gl || typeof Phaser.GameObjects?.Shader !== 'function') return null;

    const quad = new Phaser.GameObjects.Shader(
      this.scene,
      {
        name: STATUS_RING_SHADER_NAME,
        shaderName: STATUS_RING_SHADER_NAME,
        fragmentSource: STATUS_RING_FRAGMENT_SOURCE,
        setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
          setUniform('uTime', this.livingElapsedSec);
          setUniform('uAlpha', LIVING_QUAD_ALPHA);
          setUniform('uAmbientPulse', this.ambientPulse);
          setUniform('uSize', [STATUS_RING_TEXTURE_SIZE, STATUS_RING_TEXTURE_SIZE]);
          setUniform('uSegmentArc[0]', this.segmentArc);
          setUniform('uSegmentBand[0]', this.segmentBand);
          setUniform('uSegmentFill[0]', this.segmentFill);
          setUniform('uSegmentTintMid[0]', this.segmentTintMid);
          setUniform('uSegmentTintLight[0]', this.segmentTintLight);
          setUniform('uSegmentTintDark[0]', this.segmentTintDark);
        },
      },
      SHADOW_OFFSET,
      SHADOW_OFFSET,
      STATUS_RING_TEXTURE_SIZE,
      STATUS_RING_TEXTURE_SIZE,
    );
    quad.setOrigin(0.5, 0.5);
    quad.setBlendMode(Phaser.BlendModes.ADD);
    return quad;
  }

  private createFillQuad(): Phaser.GameObjects.Shader | null {
    const renderer = this.scene.sys?.renderer as { gl?: WebGLRenderingContext } | undefined;
    if (!renderer?.gl || typeof Phaser.GameObjects?.Shader !== 'function') return null;

    const quad = new Phaser.GameObjects.Shader(
      this.scene,
      {
        name: STATUS_RING_FILL_SHADER_NAME,
        shaderName: STATUS_RING_FILL_SHADER_NAME,
        fragmentSource: STATUS_RING_FILL_FRAGMENT_SOURCE,
        setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
          setUniform('uAlpha', 1);
          setUniform('uSize', [STATUS_RING_TEXTURE_SIZE, STATUS_RING_TEXTURE_SIZE]);
          setUniform('uSegmentArc[0]', this.segmentArc);
          setUniform('uSegmentFill[0]', this.segmentFill);
          setUniform('uSegmentTintMid[0]', this.segmentTintMid);
          setUniform('uSegmentTintLight[0]', this.segmentTintLight);
          setUniform('uSegmentTintDark[0]', this.segmentTintDark);
        },
      },
      SHADOW_OFFSET,
      SHADOW_OFFSET,
      STATUS_RING_TEXTURE_SIZE,
      STATUS_RING_TEXTURE_SIZE,
    );
    quad.setOrigin(0.5, 0.5);
    quad.setBlendMode(Phaser.BlendModes.NORMAL);
    return quad;
  }

  private render(now: number): void {
    const sprite = this.getLocalSprite();
    if (!this.active || !this.latestData || !sprite || !sprite.active || !this.isLocalAlive()) {
      this.container.setVisible(false);
      return;
    }

    if (!sprite.visible && !this.isLocalBurrowed()) {
      this.container.setVisible(false);
      return;
    }

    const warningHoldFrac = clamp01((this.adrenalineWarningUntil - now) / WARNING_MS);
    const warningPunchFrac = clamp01((this.adrenalineWarningPunchUntil - now) / WARNING_PUNCH_MS);
    const warningFrac = Math.max(warningHoldFrac, warningPunchFrac);
    const warningPulse = warningFrac > 0
      ? 0.72 + 0.28 * Math.sin(now * 0.045) + warningPunchFrac * 0.45
      : 0;
    const wobbleX = warningFrac > 0
      ? (Math.sin(now * 0.24) * 2.8 + Math.sin(now * 0.63) * 1.2) * (warningFrac + warningPunchFrac * 0.85)
      : 0;
    const wobbleY = warningFrac > 0
      ? (Math.cos(now * 0.19) * 1.2 + Math.cos(now * 0.51) * 0.7) * (warningFrac + warningPunchFrac * 0.7)
      : 0;

    this.container.setVisible(true);
    this.container.setPosition(sprite.x + wobbleX, sprite.y + wobbleY);
    this.container.setAlpha(LIVING_QUAD_ALPHA);

    this.updateHpTrail(now);

    const animated = warningFrac > 0.01
      || this.hpFlashUntil > now
      || this.adrBurstUntil > now
      || this.adrenalineBoostActive
      || this.rageReady
      || this.hpTrailDelayUntil > 0;
    const flags = (this.adrenalineBoostActive ? 1 : 0)
      | (this.rageReady ? 2 : 0)
      | (this.ultimateActive ? 4 : 0)
      | (this.isAdrenalineInsufficientForWeapon2() ? 8 : 0)
      | (warningFrac > 0.01 ? 16 : 0)
      | (this.hpFlashUntil > now ? 32 : 0)
      | (this.adrBurstUntil > now ? 64 : 0);
    const quantize = (value: number) => Math.round(clamp01(value) * 128);
    const signature = `${quantize(this.hpFrac)}:${quantize(this.hpTrailFrac)}:${quantize(this.adrFrac)}:${quantize(this.rageFrac)}:${quantize(this.armorFrac)}:${flags}`;
    if (signature !== this.lastGraphicsSignature || (animated && now >= this.nextAnimatedGraphicsAt)) {
      this.warningGraphics.clear();
      this.glowGraphics.clear();
      this.fillGraphics.clear();
      this.drawAdrenalineWarning(warningFrac, warningPulse, warningPunchFrac);
      this.drawEffectGlows(now, warningFrac, warningPulse, warningPunchFrac);
      this.drawFilledSegments(now);
      this.lastGraphicsSignature = signature;
      this.nextAnimatedGraphicsAt = now + GRAPHICS_REFRESH_INTERVAL_MS;
    }

    this.syncSparks(now);
    this.syncRingSegments(now);
  }

  private updateHpTrail(now: number): void {
    if (this.hpTrailDelayUntil <= 0) return;
    if (now < this.hpTrailDelayUntil) return;

    const progress = clamp01((now - this.hpTrailStartAt) / HP_TRAIL_DURATION_MS);
    this.hpTrailFrac = Phaser.Math.Linear(this.hpTrailFrom, this.hpTrailTo, progress);
    if (progress >= 1) {
      this.hpTrailFrac = this.hpTrailTo;
      this.hpTrailDelayUntil = 0;
      this.hpTrailStartAt = 0;
    }
  }

  private drawAdrenalineWarning(warningFrac: number, warningPulse: number, warningPunchFrac: number): void {
    if (warningFrac <= 0.01) return;
    const pulseAlpha = 0.92 + warningPulse * 0.3 + warningPunchFrac * 0.45;
    this.drawSegmentLayer(this.warningGraphics, SEGMENTS[0], 1, RING_INNER_RADIUS - 2.4, RING_OUTER_RADIUS + 4.2, COLORS.RED_4, (0.22 + warningFrac * 0.26) * pulseAlpha);
    this.drawSegmentLayer(this.warningGraphics, SEGMENTS[0], 1, RING_INNER_RADIUS - 1.0, RING_OUTER_RADIUS + 2.4, COLORS.RED_3, (0.26 + warningFrac * 0.26) * pulseAlpha);
    this.drawSegmentLayer(this.warningGraphics, SEGMENTS[0], 1, RING_INNER_RADIUS + 0.8, RING_OUTER_RADIUS - 0.2, COLORS.RED_1, (0.16 + warningFrac * 0.18 + warningPunchFrac * 0.12) * pulseAlpha);
  }

  private drawEffectGlows(now: number, warningFrac: number, warningPulse: number, warningPunchFrac: number): void {
    // Auf Canvas bzw. wenn Shader-Quads nicht verfuegbar sind, bleibt der bisherige
    // Polygon-Fallback aktiv. Im WebGL-Pfad liegt der permanente Ambient-Glow im livingQuad.
    if (!this.fillQuad) {
      const ambientPulse = 0.88 + Math.sin(now * 0.0035) * 0.12;
      this.drawAmbientResourceGlow(SEGMENTS[1], this.hpFrac, PAL_HP, ambientPulse);
      this.drawAmbientResourceGlow(
        SEGMENTS[0],
        this.adrFrac,
        this.isAdrenalineInsufficientForWeapon2() ? PAL_ADR_LOW : PAL_ADR,
        ambientPulse,
      );
      this.drawAmbientResourceGlow(SEGMENTS[2], this.rageFrac, PAL_RAGE, ambientPulse);
      this.drawAmbientArmorGlow(ambientPulse);
    }

    const ragePulse = 0.45 + 0.55 * Math.sin(now * 0.008);
    const boostPulse = 0.45 + 0.55 * Math.sin(now * 0.01);
    const hpFlash = clamp01((this.hpFlashUntil - now) / FLASH_MS);
    const adrenalineInsufficient = this.isAdrenalineInsufficientForWeapon2();

    if (hpFlash > 0.01) {
      this.drawSegmentLayer(this.glowGraphics, SEGMENTS[1], this.hpTrailFrac, RING_INNER_RADIUS - 1.2, RING_OUTER_RADIUS + 1.8, COLORS.RED_2, 0.16 + hpFlash * 0.22);
    }

    if (this.adrenalineBoostActive) {
      this.drawSegmentLayer(this.glowGraphics, SEGMENTS[0], Math.max(this.adrFrac, 0.12), RING_INNER_RADIUS - 0.8, RING_OUTER_RADIUS + 1.8, PAL_ADR.light, 0.18 + boostPulse * 0.18);
    }

    if (adrenalineInsufficient) {
      this.drawSegmentLayer(
        this.glowGraphics,
        SEGMENTS[0],
        Math.max(this.adrFrac, 0.1),
        RING_INNER_RADIUS - 1.3,
        RING_OUTER_RADIUS + 2.1,
        PAL_ADR_LOW.mid,
        0.16 + warningFrac * 0.14,
      );
    }

    if (warningFrac > 0.01) {
      this.drawSegmentLayer(
        this.glowGraphics,
        SEGMENTS[0],
        1,
        RING_INNER_RADIUS - 2.6,
        RING_OUTER_RADIUS + 4.4,
        COLORS.RED_1,
        (0.22 + warningFrac * 0.24 + warningPunchFrac * 0.16) * (0.82 + warningPulse * 0.32),
      );
    }

    if (this.rageReady) {
      this.drawSegmentLayer(
        this.glowGraphics,
        SEGMENTS[2],
        Math.max(this.rageFrac, 0.12),
        RING_INNER_RADIUS - 0.8,
        RING_OUTER_RADIUS + 1.8,
        this.ultimateActive ? PAL_RAGE.spark : PAL_RAGE.light,
        0.18 + ragePulse * (this.ultimateActive ? 0.22 : 0.16),
      );
    }
  }

  /** Mehrere additive Breitenlagen bilden einen weichen, farbtreuen Halo ohne Filterpass. */
  private drawAmbientResourceGlow(
    segment: SegmentConfig,
    fraction: number,
    palette: SegmentPalette,
    pulse: number,
  ): void {
    if (fraction <= 0.01) return;
    this.drawSegmentLayer(this.glowGraphics, segment, fraction, RING_INNER_RADIUS - 4.2, RING_OUTER_RADIUS + 4.2, palette.mid, 0.055 * pulse);
    this.drawSegmentLayer(this.glowGraphics, segment, fraction, RING_INNER_RADIUS - 2.4, RING_OUTER_RADIUS + 2.4, palette.light, 0.075 * pulse);
    this.drawSegmentLayer(this.glowGraphics, segment, fraction, RING_INNER_RADIUS - 0.8, RING_OUTER_RADIUS + 1.2, palette.light, 0.1 * pulse);
  }

  private drawAmbientArmorGlow(pulse: number): void {
    if (this.armorFrac <= 0.01) return;
    this.drawSegmentLayer(this.glowGraphics, SEGMENTS[1], this.armorFrac, RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS - 2.4, RING_OUTER_RADIUS + 3.2, PAL_ARMOR.mid, 0.07 * pulse);
    this.drawSegmentLayer(this.glowGraphics, SEGMENTS[1], this.armorFrac, RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS - 0.8, RING_OUTER_RADIUS + 1.8, PAL_ARMOR.light, 0.11 * pulse);
  }

  private drawFilledSegments(now: number): void {
    const hpFlash = clamp01((this.hpFlashUntil - now) / FLASH_MS);
    const adrenalineInsufficient = this.isAdrenalineInsufficientForWeapon2();
    const adrenalinePalette = adrenalineInsufficient ? PAL_ADR_LOW : PAL_ADR;
    const adrenalineMainAlpha = adrenalineInsufficient
      ? (this.adrenalineBoostActive ? 0.9 : 0.84)
      : (this.adrenalineBoostActive ? 0.88 : 0.76);
    const adrenalineHighlightAlpha = adrenalineInsufficient
      ? (this.adrenalineBoostActive ? 0.76 : 0.66)
      : (this.adrenalineBoostActive ? 0.72 : 0.56);

    if (this.hpTrailFrac > this.hpFrac + 0.002) {
      this.drawSegmentLayer(this.fillGraphics, SEGMENTS[1], this.hpTrailFrac, RING_INNER_RADIUS, RING_OUTER_RADIUS, COLORS.RED_2, 0.28);
      this.drawSegmentLayer(this.fillGraphics, SEGMENTS[1], this.hpTrailFrac, RING_INNER_RADIUS + 1.5, RING_INNER_RADIUS + RING_THICKNESS * 0.54, COLORS.RED_1, 0.18);
    }

    if (!this.fillQuad) {
      this.drawResourceSegment(SEGMENTS[1], this.hpFrac, PAL_HP, 0.78, 0.58 + hpFlash * 0.22);
      this.drawResourceSegment(SEGMENTS[0], this.adrFrac, adrenalinePalette, adrenalineMainAlpha, adrenalineHighlightAlpha);
    }
    if (adrenalineInsufficient) {
      this.drawSegmentLayer(this.fillGraphics, SEGMENTS[0], this.adrFrac, RING_INNER_RADIUS - 0.1, RING_OUTER_RADIUS + 0.2, COLORS.RED_3, 0.3);
      this.drawSegmentLayer(this.fillGraphics, SEGMENTS[0], this.adrFrac, RING_INNER_RADIUS + 1.0, RING_INNER_RADIUS + RING_THICKNESS * 0.58, COLORS.RED_1, 0.16);
    }
    if (!this.fillQuad) {
      this.drawResourceSegment(SEGMENTS[2], this.rageFrac, PAL_RAGE, this.ultimateActive ? 0.92 : 0.8, this.rageReady ? 0.74 : 0.58);

      this.drawSegmentLayer(this.fillGraphics, SEGMENTS[1], this.armorFrac, RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS, RING_OUTER_RADIUS + 0.4, PAL_ARMOR.mid, 0.88);
      this.drawSegmentLayer(this.fillGraphics, SEGMENTS[1], this.armorFrac, RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS + 0.3, RING_OUTER_RADIUS, PAL_ARMOR.light, 0.42);
    }
  }

  private drawResourceSegment(
    segment: SegmentConfig,
    fraction: number,
    palette: SegmentPalette,
    mainAlpha: number,
    highlightAlpha: number,
  ): void {
    this.drawSegmentLayer(this.fillGraphics, segment, fraction, RING_INNER_RADIUS, RING_OUTER_RADIUS, palette.mid, mainAlpha);
    this.drawSegmentLayer(this.fillGraphics, segment, fraction, RING_INNER_RADIUS + 0.9, RING_INNER_RADIUS + RING_THICKNESS * 0.55, palette.light, highlightAlpha);
    this.drawSegmentLayer(this.fillGraphics, segment, fraction, RING_OUTER_RADIUS - 1.4, RING_OUTER_RADIUS, palette.dark, 0.24);
  }

  private isAdrenalineInsufficientForWeapon2(): boolean {
    const data = this.latestData;
    if (!data) return false;
    return data.weapon2AdrenalineCost > 0 && data.adrenaline < data.weapon2AdrenalineCost;
  }

  /** Befuellt die gemeinsamen Segmentdaten fuer den Basis-Fill und den Living-/Glow-Quad. */
  private syncRingSegments(now: number): void {
    this.livingElapsedSec = now / 1000;
    this.ambientPulse = 0.88 + Math.sin(now * 0.0035) * 0.12;
    const hpFlash = clamp01((this.hpFlashUntil - now) / FLASH_MS);
    const adrenalineInsufficient = this.isAdrenalineInsufficientForWeapon2();
    const adrenalineMainAlpha = adrenalineInsufficient
      ? (this.adrenalineBoostActive ? 0.9 : 0.84)
      : (this.adrenalineBoostActive ? 0.88 : 0.76);
    const adrenalineHighlightAlpha = adrenalineInsufficient
      ? (this.adrenalineBoostActive ? 0.76 : 0.66)
      : (this.adrenalineBoostActive ? 0.72 : 0.56);

    const coreInner = RING_INNER_RADIUS + 0.8;
    const coreOuter = RING_INNER_RADIUS + RING_THICKNESS * 0.72;
    const bandInner = RING_INNER_RADIUS + 0.2;
    const bandOuter = RING_OUTER_RADIUS - 0.4;
    const rimInner = RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS;
    const rimOuter = RING_OUTER_RADIUS + 0.4;

    // HP wurde frueher nur waehrend des Trefferblitzes dichter, Adrenalin bei aktiver Spritze,
    // Rage ab Ultimate-Bereitschaft. Armor kannte keine Umschaltung.
    this.writeSegment(0, SEGMENTS[1], this.hpFrac, PAL_HP, this.hpFlashUntil > now,
      coreInner, coreOuter, bandInner, bandOuter,
      RING_INNER_RADIUS, RING_OUTER_RADIUS, 0.78, 0.58 + hpFlash * 0.22);
    this.writeSegment(1, SEGMENTS[0], this.adrFrac,
      adrenalineInsufficient ? PAL_ADR_LOW : PAL_ADR, this.adrenalineBoostActive,
      coreInner, coreOuter, bandInner, bandOuter,
      RING_INNER_RADIUS, RING_OUTER_RADIUS, adrenalineMainAlpha, adrenalineHighlightAlpha);
    this.writeSegment(2, SEGMENTS[2], this.rageFrac, PAL_RAGE, this.rageReady,
      coreInner, coreOuter, bandInner, bandOuter,
      RING_INNER_RADIUS, RING_OUTER_RADIUS,
      this.ultimateActive ? 0.92 : 0.8, this.rageReady ? 0.74 : 0.58);
    // Armor folgt dem HP-Bogen, liegt aber auf dem Aussenrand.
    this.writeSegment(3, SEGMENTS[1], this.armorFrac, PAL_ARMOR, false,
      rimInner, rimOuter, rimInner - 0.4, rimOuter + 0.8,
      RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS, RING_OUTER_RADIUS + 0.4, 0.88, 0.42);
  }

  private writeSegment(
    index: number,
    segment: SegmentConfig,
    fraction: number,
    palette: SegmentPalette,
    active: boolean,
    coreInner: number,
    coreOuter: number,
    bandInner: number,
    bandOuter: number,
    fillInner: number,
    fillOuter: number,
    fillMainAlpha: number,
    fillHighlightAlpha: number,
  ): void {
    const arcBase = index * 4;
    const bandBase = index * 4;
    const clamped = clamp01(fraction);
    const section = this.getFilledSection(segment, clamped);

    if (!section) {
      this.segmentArc[arcBase + 1] = 0;
      this.segmentBand[bandBase + 3] = 0;
      this.segmentFill[bandBase + 2] = 0;
      this.segmentFill[bandBase + 3] = 0;
      return;
    }

    // `SEGMENTS`/`getFilledSection` use degrees from the top, clockwise. Keep the signed
    // delta so the shader traverses the same direction as `fillArcPolygon` and `canvasArcLayer`.
    this.segmentArc[arcBase] = Phaser.Math.DegToRad(section.startAngle);
    this.segmentArc[arcBase + 1] = Phaser.Math.DegToRad(section.endAngle - section.startAngle);
    this.segmentArc[arcBase + 2] = coreInner;
    this.segmentArc[arcBase + 3] = coreOuter;

    this.segmentFill[bandBase] = fillInner;
    this.segmentFill[bandBase + 1] = fillOuter;
    this.segmentFill[bandBase + 2] = fillMainAlpha;
    this.segmentFill[bandBase + 3] = fillHighlightAlpha;

    this.segmentBand[bandBase] = bandInner;
    this.segmentBand[bandBase + 1] = bandOuter;
    this.segmentBand[bandBase + 2] = active ? 1 : 0;
    this.segmentBand[bandBase + 3] = this.livingEnabled && clamped > LIVING_MIN_FRACTION
      ? LIVING_ALPHA_SCALE * clamped
      : 0;

    writeColor(this.segmentTintMid, index * 3, palette.mid);
    writeColor(this.segmentTintLight, index * 3, palette.light);
    writeColor(this.segmentTintDark, index * 3, palette.dark);
  }

  /**
   * Sparks sind eigenstaendige Bilder und laufen deshalb ausserhalb des 30-Hz-Gates von
   * `render()` – ihre Kreisbahn bewegt sich damit fluessig statt in Stufen.
   */
  private syncSparks(now: number): void {
    this.sparkCursor = 0;

    const adrBurst = clamp01((this.adrBurstUntil - now) / BURST_MS);
    if (adrBurst > 0.01) {
      this.placeEndpointSparks(SEGMENTS[0], this.adrFrac, PAL_ADR, 0.22 + adrBurst * 0.42, now, 3);
    }
    if (this.adrenalineBoostActive) {
      this.placeEndpointSparks(SEGMENTS[0], Math.max(this.adrFrac, 0.08), PAL_ADR, 0.24, now + 190, 2);
    }
    if (this.rageReady) {
      this.placeEndpointSparks(SEGMENTS[2], Math.max(this.rageFrac, 0.08), PAL_RAGE, this.ultimateActive ? 0.34 : 0.24, now + 90, this.ultimateActive ? 4 : 2);
    }

    for (let index = this.sparkCursor; index < this.sparkImages.length; index += 1) {
      this.sparkImages[index].setVisible(false);
    }
  }

  private placeEndpointSparks(
    segment: SegmentConfig,
    fraction: number,
    palette: SegmentPalette,
    alpha: number,
    now: number,
    sparkCount: number,
  ): void {
    if (fraction <= 0.01) return;

    const angle = Phaser.Math.Linear(segment.fillStartAngle, segment.fillEndAngle, clamp01(fraction));
    for (let index = 0; index < sparkCount; index += 1) {
      const image = this.sparkImages[this.sparkCursor];
      if (!image) return;
      this.sparkCursor += 1;

      const wave = now * 0.01 + index * 1.7;
      const radius = RING_OUTER_RADIUS + 1.5 + Math.sin(wave) * 1.2;
      const offsetAngle = angle + Math.sin(wave * 1.35) * 2.4;
      const rad = degToRadFromTop(offsetAngle);
      const size = 1.2 + ((Math.sin(wave * 1.9) + 1) * 0.5);

      // Beide Scheiben stecken im Verlauf; getintet wird mit der helleren Kernfarbe, weil sie
      // unter ADD den sichtbaren Eindruck traegt.
      image.setVisible(true);
      image.setPosition(Math.cos(rad) * radius, Math.sin(rad) * radius);
      image.setDisplaySize(size * 2, size * 2);
      image.setTint(palette.light);
      image.setAlpha(alpha);
    }
  }

  private drawSegmentLayer(
    graphics: Phaser.GameObjects.Graphics,
    segment: SegmentConfig,
    fraction: number,
    innerRadius: number,
    outerRadius: number,
    color: number,
    alpha: number,
  ): void {
    const section = this.getFilledSection(segment, fraction);
    if (!section) return;
    fillArcPolygon(
      graphics,
      section.startAngle,
      section.endAngle,
      innerRadius,
      outerRadius,
      color,
      alpha,
    );
  }

  private getFilledSection(segment: SegmentConfig, fraction: number): AngleSection | null {
    const clamped = clamp01(fraction);
    if (clamped <= 0) return null;

    const endAngle = Phaser.Math.Linear(segment.fillStartAngle, segment.fillEndAngle, clamped);
    if (Math.abs(endAngle - segment.fillStartAngle) <= 0.3) return null;

    return {
      startAngle: segment.fillStartAngle,
      endAngle,
    };
  }
}

/** Schreibt eine 0xRRGGBB-Farbe als normalisiertes vec3 in einen Uniform-Puffer. */
function writeColor(target: Float32Array, offset: number, color: number): void {
  target[offset] = ((color >> 16) & 0xff) / 255;
  target[offset + 1] = ((color >> 8) & 0xff) / 255;
  target[offset + 2] = (color & 0xff) / 255;
}
