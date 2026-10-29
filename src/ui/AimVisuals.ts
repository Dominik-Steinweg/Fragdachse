import * as Phaser from 'phaser';
import { COLORS, DEPTH_AIM } from '../config';
import { ensureCanvasTexture, fillRadialGradientTexture } from '../effects/EffectUtils';

export type SlotPalette = {
  beamShadow: number;
  beamGlow: number;
  beamCore: number;
  crossGlow: number;
  crossMain: number;
};

const CROSS_SHADOW_COLOR = COLORS.GREY_10;

// ── Beam ───────────────────────────────────────────────────────────────────
// Der Querschnitt steckt in der Textur, die Laenge kommt aus der Skalierung. U ist normalisiert,
// das Strecken auf beliebige Strahllaengen laesst die Ausblendung deshalb bei 10 % und 90 %.
const STRIP_W            = 256;
const BEAM_STRIP_H       = 8;
const BEAM_SHADOW_H      = 10;
const BEAM_CORE_W        = 1;
const BEAM_GLOW_W        = 2;
const BEAM_START_FADE_AT = 0.10;
const BEAM_END_FADE_AT   = 0.90;
/** Weicher Kontrastsaum: haelt die farbige Linie auf hellem Boden lesbar, ohne harte Kontur. */
const BEAM_SHADOW_ALPHA  = 0.30;
const BEAM_CORE_ALPHA    = 0.60;
const BEAM_CORE_ALPHA_MIN = 0.46;

// ── Schusspuls ─────────────────────────────────────────────────────────────
const PULSE_TEX_SIZE     = 32;
const PULSE_WORLD_LEN    = 30;
const PULSE_WORLD_H      = 7;

// ── Reichweiten-Indikator ──────────────────────────────────────────────────
const RANGE_BAR_HALF_LEN = 9;
const RANGE_TICK_H       = 10;

// ── Fadenkreuz-Ring ────────────────────────────────────────────────────────
// Frames werden nach Radius indiziert und mit Skalierung 1 gezeichnet. Die Strichstaerke bleibt
// dadurch ueber den gesamten Spread-Bereich konstant; ein einzelner skalierter Ring wuerde sie
// vervierfachen. Bewusst ohne Achsen-Ticks: Striche gehoeren allein dem Hitmarker.
const RING_R_MIN    = 5;
const RING_R_STEP   = 0.5;
const RING_COLS     = 8;
/** Spread-Maximum 20 * 1.1 = 22 plus Federueberschwinger und Schuss-Kick. */
export const AIM_CROSS_RING_R_MAX = 26;
const CROSS_FRAMES  = Math.round((AIM_CROSS_RING_R_MAX - RING_R_MIN) / RING_R_STEP) + 1;
const RING_GLOW_W   = 3;
const HALO_MAX_W    = 9;
// Groesste Ausdehnung: r + HALO_MAX_W / 2 = 30.5. Die Zelle muss gerade sein, damit ein
// ganzzahliges Zentrum mit Origin 0.5 auf ganzen Pixeln landet.
const CROSS_CELL    = 64;
const CROSS_ROWS    = Math.ceil(CROSS_FRAMES / RING_COLS);

// ── AWP-Ladering ───────────────────────────────────────────────────────────
const CHARGE_SHADOW_W = 5;
const CHARGE_R_MAX    = 34;   // AIM_CROSS_RING_R_MAX + AIM_CHARGE_RING_OFFSET
const CHARGE_FRAMES   = Math.round((CHARGE_R_MAX - RING_R_MIN) / RING_R_STEP) + 1;
// Groesste gezeichnete Ausdehnung: r + CHARGE_SHADOW_W / 2 = 38.5.
const CHARGE_CELL     = 82;
const CHARGE_ROWS     = Math.ceil(CHARGE_FRAMES / RING_COLS);
/** Abstand des AWP-Laderings zum Spread-Ring, damit sich beide Glowbaender nicht beruehren. */
export const AIM_CHARGE_RING_OFFSET = 8;

// ── Mittelpunkt ────────────────────────────────────────────────────────────
const CENTER_DOT_R     = 1.5;
const DOT_TEX_SIZE     = 32;
const DOT_TEX_RADIUS   = DOT_TEX_SIZE / 2;
const DOT_WORLD_RADIUS = 8;

// ── Hitmarker ──────────────────────────────────────────────────────────────
// Vier diagonale Bogensegmente, konzentrisch zum Ring und mit demselben Glowprofil und Saum: Ein
// Treffer liest als Aufbluehen des Fadenkreuzes, nicht als fremdes Symbol. Atlas nach Radius wie
// beim Ring, damit die Strichstaerke bei jedem Abstand gleich bleibt.
/** Ringradius-Maximum + Abstand + Pop-Ausdehnung. */
const HIT_R_MAX     = 36;
const HIT_FRAMES    = Math.round((HIT_R_MAX - RING_R_MIN) / RING_R_STEP) + 1;
// Groesste Ausdehnung: r + HALO_MAX_W / 2 = 40.5.
const HIT_CELL      = 82;
const HIT_ROWS      = Math.ceil(HIT_FRAMES / RING_COLS);
const HIT_DIAGONALS: readonly number[] = [-0.75, -0.25, 0.25, 0.75].map((turn) => turn * Math.PI);

/** Bogenlaenge waechst leicht mit dem Radius, damit Segmente weder zu Punkten noch zu Halbkreisen werden. */
function hitArcHalfAngle(radius: number): number {
  return Math.min(0.34, (2.2 + radius * 0.12) / radius);
}

const RING_FRAME_NAMES: readonly string[] = Array.from(
  { length: Math.max(CROSS_FRAMES, CHARGE_FRAMES, HIT_FRAMES) },
  (_, index) => String(RING_R_MIN + index * RING_R_STEP),
);

function ringFrameIndex(radius: number, frames: number): number {
  return Phaser.Math.Clamp(Math.round((radius - RING_R_MIN) / RING_R_STEP), 0, frames - 1);
}

// ── Ziel-Reticle ───────────────────────────────────────────────────────────
const RETICLE_TEX_SIZE = 100;

// ── Gauss ──────────────────────────────────────────────────────────────────
const GAUSS_WIDE_TEX_H      = 32;
const GAUSS_WIDE_WORLD_H    = 20;
const GAUSS_CORE_TEX_H      = 16;
const GAUSS_CORE_WORLD_H    = 8;
const GAUSS_EMIT_TEX_SIZE   = 64;
const GAUSS_EMIT_TEX_RADIUS = GAUSS_EMIT_TEX_SIZE / 2;

/**
 * Texturschluessel tragen alle darstellungsrelevanten Varianten. Die Farbe kommt zur Laufzeit per
 * Tint, die Geometrie aber aus den Konstanten oben – deren Werte gehoeren deshalb in den
 * Schluessel, damit eine Konstantenaenderung keinen veralteten Cache trifft.
 */
const TEX = {
  beamShadow: `__aim/beam-shadow-soft/${STRIP_W}x${BEAM_STRIP_H}/f${BEAM_START_FADE_AT}-${BEAM_END_FADE_AT}`,
  beamEnergy: `__aim/beam-energy/${STRIP_W}x${BEAM_STRIP_H}/w${BEAM_CORE_W}-${BEAM_GLOW_W}/f${BEAM_START_FADE_AT}-${BEAM_END_FADE_AT}`,
  pulse:      `__aim/shot-pulse/${PULSE_TEX_SIZE}`,
  crossHalo:  `__aim/cross-halo/${CROSS_CELL}/${RING_R_MIN}-${AIM_CROSS_RING_R_MAX}-${RING_R_STEP}/h${HALO_MAX_W}`,
  crossGlow:  `__aim/cross-glow/${CROSS_CELL}/${RING_R_MIN}-${AIM_CROSS_RING_R_MAX}-${RING_R_STEP}/w${RING_GLOW_W}`,
  chargeRing: `__aim/charge-ring/${CHARGE_CELL}/${RING_R_MIN}-${CHARGE_R_MAX}-${RING_R_STEP}/w${CHARGE_SHADOW_W}`,
  dot:        `__aim/cross-dot/${DOT_TEX_SIZE}/v2`,
  hitHalo:    `__aim/hit-arcs-halo/${HIT_CELL}/${RING_R_MIN}-${HIT_R_MAX}-${RING_R_STEP}/h${HALO_MAX_W}`,
  hitGlow:    `__aim/hit-arcs-glow/${HIT_CELL}/${RING_R_MIN}-${HIT_R_MAX}-${RING_R_STEP}/w${RING_GLOW_W}`,
  reticle:    `__aim/reticle-targeting/${RETICLE_TEX_SIZE}/26-12-34-12-9`,
  gaussWide:  `__aim/gauss-wide/${STRIP_W}x${GAUSS_WIDE_TEX_H}`,
  gaussCore:  `__aim/gauss-core/${STRIP_W}x${GAUSS_CORE_TEX_H}`,
  gaussEmit:  `__aim/gauss-emitter/${GAUSS_EMIT_TEX_SIZE}`,
} as const;

/**
 * Weicher Glowpunkt. Wird von den Sparks des Statusrings geteilt und deshalb eigenstaendig
 * exportiert statt in `AimVisuals` gekapselt.
 */
export const AIM_GLOW_DOT_TEXTURE = `__aim/center-dot/${DOT_TEX_SIZE}/r${CENTER_DOT_R}`;

/** Radius der Textur in Texeln – Basis fuer `setScale`, wenn ein anderer Weltradius gebraucht wird. */
export const AIM_GLOW_DOT_TEXTURE_RADIUS = DOT_TEX_RADIUS;

export function ensureAimGlowDotTexture(scene: Phaser.Scene): void {
  fillRadialGradientTexture(scene.textures, AIM_GLOW_DOT_TEXTURE, DOT_TEX_SIZE, [
    [0.000, 'rgba(255,255,255,0.97)'],  // Kern, r = 0
    [0.188, 'rgba(255,255,255,0.97)'],  // r = 1.5
    [0.260, 'rgba( 20, 20, 26,0.55)'],  // dunkler Rand: CROSS_SHADOW als Luminanz ~0.08
    [0.375, 'rgba( 20, 20, 26,0.55)'],  // r = 3.0
    [0.470, 'rgba(255,255,255,0.28)'],
    [0.625, 'rgba(255,255,255,0.28)'],  // r = 5.0
    [0.720, 'rgba(255,255,255,0.12)'],
    [0.938, 'rgba(255,255,255,0.12)'],  // r = 7.5
    [1.000, 'rgba(255,255,255,0.00)'],
  ]);
}

type GradientStop = readonly [offset: number, css: string];

/**
 * Laengsrampe des Beams: Smoothstep-Ausblendung an beiden Enden, stufenlos abgetastet.
 */
const LENGTH_RAMP_STOPS: readonly (readonly [number, number])[] = (() => {
  const samples = [0, 0.25, 0.5, 0.75, 1];
  const smoothStep = (value: number): number => value * value * (3 - 2 * value);
  const stops: [number, number][] = [];
  for (const sample of samples) {
    stops.push([BEAM_START_FADE_AT * sample, smoothStep(sample)]);
  }
  for (const sample of samples) {
    stops.push([
      BEAM_END_FADE_AT + (1 - BEAM_END_FADE_AT) * sample,
      smoothStep(1 - sample),
    ]);
  }
  return stops;
})();

/**
 * Streifen mit gebackenem Querschnitt. Alles wird in Weiss/Graustufen gezeichnet: Phaser tintet
 * per Default multiplikativ, weiss mal Tint ergibt exakt die Zielfarbe.
 */
function bakeStrip(
  textures: Phaser.Textures.TextureManager,
  key: string,
  height: number,
  crossStops: readonly GradientStop[],
  applyLengthRamp: boolean,
): void {
  ensureCanvasTexture(textures, key, STRIP_W, height, (ctx) => {
    const cross = ctx.createLinearGradient(0, 0, 0, height);
    for (const [offset, css] of crossStops) cross.addColorStop(offset, css);
    ctx.fillStyle = cross;
    ctx.fillRect(0, 0, STRIP_W, height);

    if (!applyLengthRamp) return;

    // `destination-in` multipliziert den bestehenden Alphakanal mit dem der Quelle.
    ctx.globalCompositeOperation = 'destination-in';
    const along = ctx.createLinearGradient(0, 0, STRIP_W, 0);
    for (const [offset, alpha] of LENGTH_RAMP_STOPS) {
      along.addColorStop(offset, `rgba(0,0,0,${alpha})`);
    }
    ctx.fillStyle = along;
    ctx.fillRect(0, 0, STRIP_W, height);
    ctx.globalCompositeOperation = 'source-over';
  });
}

function strokeRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  width: number,
  alpha: number,
): void {
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
}

const AXES: readonly (readonly [number, number])[] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function bakeRingAtlas(
  textures: Phaser.Textures.TextureManager,
  key: string,
  cell: number,
  frames: number,
  rows: number,
  drawRing: (ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) => void,
): void {
  ensureCanvasTexture(textures, key, RING_COLS * cell, rows * cell, (ctx, canvas) => {
    ctx.strokeStyle = '#ffffff';
    for (let index = 0; index < frames; index += 1) {
      const x = (index % RING_COLS) * cell;
      const y = ((index / RING_COLS) | 0) * cell;
      drawRing(ctx, x + cell / 2, y + cell / 2, RING_R_MIN + index * RING_R_STEP);
      // `Texture.add()` zieht den ersten benannten Frame zum `firstFrame` hoch und verdraengt
      // `__BASE`. Bilder aus diesem Atlas muessen deshalb immer mit explizitem Frame entstehen.
      canvas.add(RING_FRAME_NAMES[index], 0, x, y, cell, cell);
    }
    ctx.globalAlpha = 1;
  });
}

/** Ring-Frame-Cache eines Images: `setFrame` nur bei Wechsel. */
class RingImage {
  private frame = -1;

  constructor(readonly image: Phaser.GameObjects.Image, private readonly frames: number) {}

  setRadius(radius: number): Phaser.GameObjects.Image {
    const frame = ringFrameIndex(radius, this.frames);
    if (frame !== this.frame) {
      this.image.setFrame(RING_FRAME_NAMES[frame]);
      this.frame = frame;
    }
    return this.image;
  }
}

/** Darstellungsparameter des Fadenkreuzes eines Frames; Animation rechnet `AimSystem`. */
export interface CrosshairLook {
  ringRadius: number;
  ringColor: number;
  ringAlpha: number;
  /** Additiver Glow: Farbe und Deckkraft relativ zu `ringAlpha`. */
  bloomColor: number;
  bloom: number;
  dotColor: number;
  dotScale: number;
  /** Gesamtdeckkraft: Einblenden und Ausser-Reichweite-Dimmung. */
  opacity: number;
}

export interface HitMarkerLook {
  color: number;
  /** Radius der Bogensegmente. */
  radius: number;
  alpha: number;
  /** Additiver Glow relativ zu `alpha`. */
  bloom: number;
}

/**
 * Darstellung der Zielhilfe. Alle Visuals entstehen einmalig und werden pro Frame nur noch ueber
 * Transform, Frame, Tint und Alpha aktualisiert – kein Immediate-Mode-Neuaufbau.
 *
 * Hintergrund: `Graphics.strokeCircle`, `fillCircle` und `arc` erzeugen im WebGL-Renderer rund 101
 * Punkte pro Bogen, unabhaengig vom Radius, und die Tessellierung laeuft in jedem gezeichneten
 * Frame erneut ueber den gesamten Command-Buffer.
 *
 * Lesbarkeit entsteht aus drei Schichten statt harter Konturen: ein weicher dunkler Saum fuer
 * hellen Boden, der getintete Glowkoerper und ein additiver Glow, der nachts traegt. Alles liegt
 * auf `DEPTH_AIM`, der obersten Ebene der Weltkamera.
 */
export class AimVisuals {
  private readonly beamShadow:   Phaser.GameObjects.Image;
  private readonly beamEnergy:   Phaser.GameObjects.Image;
  private readonly beamPulse:    Phaser.GameObjects.Image;
  private readonly tickShadow:   Phaser.GameObjects.Image;
  private readonly tickCore:     Phaser.GameObjects.Image;
  private readonly crossHalo:    RingImage;
  private readonly crossGlow:    RingImage;
  private readonly crossBloom:   RingImage;
  private readonly centerDot:    Phaser.GameObjects.Image;
  private readonly hitHalo:      RingImage;
  private readonly hitGlow:      RingImage;
  private readonly hitBloom:     RingImage;
  private readonly chargeShadow: RingImage;
  private readonly chargeGlow:   RingImage;
  private readonly chargeFlash:  RingImage;
  private readonly chargeGfx:    Phaser.GameObjects.Graphics;
  private readonly gaussWide:    Phaser.GameObjects.Image;
  private readonly gaussCore:    Phaser.GameObjects.Image;
  private readonly gaussEmit:    Phaser.GameObjects.Image;
  private readonly reticle:      Phaser.GameObjects.Image;

  private readonly images: readonly Phaser.GameObjects.Image[];

  constructor(private readonly scene: Phaser.Scene) {
    this.generateTextures();

    // Alles liegt auf DEPTH_AIM; Phaser sortiert bei gleicher Tiefe stabil nach
    // Einfuegereihenfolge. Die Reihenfolge hier IST also die Z-Reihenfolge.
    this.beamShadow   = this.addStrip(TEX.beamShadow, BEAM_SHADOW_H);
    this.beamEnergy   = this.addStrip(TEX.beamEnergy, BEAM_STRIP_H);
    this.beamPulse    = this.addImage(TEX.pulse).setBlendMode(Phaser.BlendModes.ADD);
    this.beamPulse.setDisplaySize(PULSE_WORLD_LEN, PULSE_WORLD_H);
    this.tickShadow   = this.addStrip(TEX.beamShadow, RANGE_TICK_H + 2, RANGE_BAR_HALF_LEN * 2);
    this.tickCore     = this.addStrip(TEX.beamEnergy, RANGE_TICK_H, RANGE_BAR_HALF_LEN * 2);
    this.crossHalo    = new RingImage(this.addImage(TEX.crossHalo, RING_FRAME_NAMES[0]), CROSS_FRAMES);
    this.crossGlow    = new RingImage(this.addImage(TEX.crossGlow, RING_FRAME_NAMES[0]), CROSS_FRAMES);
    this.crossBloom   = new RingImage(this.addImage(TEX.crossGlow, RING_FRAME_NAMES[0]), CROSS_FRAMES);
    this.crossBloom.image.setBlendMode(Phaser.BlendModes.ADD);
    this.centerDot    = this.addImage(TEX.dot);
    this.centerDot.setDisplaySize(DOT_WORLD_RADIUS * 2, DOT_WORLD_RADIUS * 2);
    this.hitHalo      = new RingImage(this.addImage(TEX.hitHalo, RING_FRAME_NAMES[0]), HIT_FRAMES);
    this.hitGlow      = new RingImage(this.addImage(TEX.hitGlow, RING_FRAME_NAMES[0]), HIT_FRAMES);
    this.hitBloom     = new RingImage(this.addImage(TEX.hitGlow, RING_FRAME_NAMES[0]), HIT_FRAMES);
    this.hitBloom.image.setBlendMode(Phaser.BlendModes.ADD);
    this.chargeShadow = new RingImage(this.addImage(TEX.chargeRing, RING_FRAME_NAMES[0]), CHARGE_FRAMES);
    this.chargeGlow   = new RingImage(this.addImage(TEX.chargeRing, RING_FRAME_NAMES[0]), CHARGE_FRAMES);
    this.chargeFlash  = new RingImage(this.addImage(TEX.chargeRing, RING_FRAME_NAMES[0]), CHARGE_FRAMES);
    this.chargeFlash.image.setBlendMode(Phaser.BlendModes.ADD);

    this.chargeGfx = scene.add.graphics();
    this.chargeGfx.setDepth(DEPTH_AIM);
    this.chargeGfx.setVisible(false);

    this.gaussWide = this.addStrip(TEX.gaussWide, GAUSS_WIDE_WORLD_H);
    this.gaussCore = this.addStrip(TEX.gaussCore, GAUSS_CORE_WORLD_H);
    this.gaussEmit = this.addImage(TEX.gaussEmit);
    this.reticle   = this.addImage(TEX.reticle);

    this.images = [
      this.beamShadow, this.beamEnergy, this.beamPulse,
      this.tickShadow, this.tickCore,
      this.crossHalo.image, this.crossGlow.image, this.crossBloom.image, this.centerDot,
      this.hitHalo.image, this.hitGlow.image, this.hitBloom.image,
      this.chargeShadow.image, this.chargeGlow.image, this.chargeFlash.image,
      this.gaussWide, this.gaussCore, this.gaussEmit,
      this.reticle,
    ];
  }

  /**
   * Ersetzt das fruehere `gfx.clear()` am Kopf von `AimSystem.update()`. Weil hier alles versteckt
   * wird, bleibt jeder Early-Return-Pfad automatisch rueckstandsfrei.
   */
  beginFrame(): void {
    for (const image of this.images) image.setVisible(false);
    if (this.chargeGfx.commandBuffer.length > 0) this.chargeGfx.clear();
    this.chargeGfx.setVisible(false);
  }

  showBeam(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    palette: SlotPalette,
    frac: number,
    opacity: number,
  ): void {
    const dx = ex - sx;
    const dy = ey - sy;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 0.5) return;
    const rotation = Math.atan2(dy, dx);

    this.beamShadow.setVisible(true).setPosition(sx, sy).setRotation(rotation)
      .setTint(CROSS_SHADOW_COLOR).setAlpha(BEAM_SHADOW_ALPHA * opacity);
    this.beamShadow.displayWidth = length;

    this.beamEnergy.setVisible(true).setPosition(sx, sy).setRotation(rotation)
      .setTint(palette.beamCore)
      .setAlpha(Math.max(BEAM_CORE_ALPHA_MIN, BEAM_CORE_ALPHA - frac * 0.14) * opacity);
    this.beamEnergy.displayWidth = length;
  }

  /** Heller Fleck, der nach einem Schuss den Beam vom Lauf zum Fadenkreuz entlanglaeuft. */
  showShotPulse(x: number, y: number, rotation: number, color: number, alpha: number): void {
    if (alpha <= 0.01) return;
    this.beamPulse.setVisible(true).setPosition(x, y).setRotation(rotation)
      .setTint(color).setAlpha(alpha);
  }

  /** `nx`/`ny` ist die Schussrichtung; der Tick steht senkrecht dazu. */
  showRangeTick(rx: number, ry: number, nx: number, ny: number, accentColor: number, scale: number): void {
    const perpX = -ny;
    const perpY = nx;
    const rotation = Math.atan2(perpY, perpX);
    const halfLen = RANGE_BAR_HALF_LEN * scale;
    const startX = rx - perpX * halfLen;
    const startY = ry - perpY * halfLen;

    this.tickShadow.setVisible(true).setPosition(startX, startY).setRotation(rotation)
      .setTint(CROSS_SHADOW_COLOR).setAlpha(0.45);
    this.tickShadow.displayWidth = halfLen * 2;
    this.tickCore.setVisible(true).setPosition(startX, startY).setRotation(rotation)
      .setTint(accentColor).setAlpha(0.9);
    this.tickCore.displayWidth = halfLen * 2;
  }

  showCrosshair(cx: number, cy: number, look: CrosshairLook): void {
    const { ringRadius, opacity } = look;
    this.crossHalo.setRadius(ringRadius).setVisible(true).setPosition(cx, cy)
      .setTint(CROSS_SHADOW_COLOR).setAlpha(0.5 * opacity);
    this.crossGlow.setRadius(ringRadius).setVisible(true).setPosition(cx, cy)
      .setTint(look.ringColor).setAlpha(look.ringAlpha * opacity);
    if (look.bloom > 0.01) {
      this.crossBloom.setRadius(ringRadius).setVisible(true).setPosition(cx, cy)
        .setTint(look.bloomColor).setAlpha(Math.min(1, look.ringAlpha * look.bloom) * opacity);
    }
    this.centerDot.setVisible(true).setPosition(cx, cy)
      .setScale((DOT_WORLD_RADIUS * 2 * look.dotScale) / DOT_TEX_SIZE)
      .setTint(look.dotColor).setAlpha(opacity);
  }

  showHitMarker(cx: number, cy: number, look: HitMarkerLook): void {
    if (look.alpha <= 0.01) return;
    this.hitHalo.setRadius(look.radius).setVisible(true).setPosition(cx, cy)
      .setTint(CROSS_SHADOW_COLOR).setAlpha(0.5 * look.alpha);
    this.hitGlow.setRadius(look.radius).setVisible(true).setPosition(cx, cy)
      .setTint(look.color).setAlpha(look.alpha);
    this.hitBloom.setRadius(look.radius).setVisible(true).setPosition(cx, cy)
      .setTint(look.color).setAlpha(Math.min(1, look.alpha * look.bloom));
  }

  showChargeRing(
    cx: number,
    cy: number,
    radius: number,
    chargeFrac: number,
    palette: SlotPalette,
    color: number,
    pulse: number,
    full: boolean,
    readyFlash: number,
  ): void {
    this.chargeShadow.setRadius(radius).setVisible(true).setPosition(cx, cy)
      .setTint(CROSS_SHADOW_COLOR).setAlpha(0.38);
    this.chargeGlow.setRadius(radius).setVisible(true).setPosition(cx, cy)
      .setTint(palette.crossGlow).setAlpha(0.22);
    if (readyFlash > 0.01) {
      // Einmaliger Ausdehnungsblitz bei Vollladung; die Skalierung verbreitert den Strich bewusst.
      this.chargeFlash.setRadius(radius).setVisible(true).setPosition(cx, cy)
        .setScale(1 + (1 - readyFlash) * 0.45)
        .setTint(color).setAlpha(readyFlash * 0.9);
    }

    const sweep = Math.PI * 2 * Phaser.Math.Clamp(chargeFrac, 0, 1);
    if (sweep <= 0) return;

    // Der Fortschrittsbogen ist die einzige echt dynamische Winkelgeometrie. Von Hand tesseliert,
    // weil `gfx.arc()` unabhaengig vom Radius rund 101 Punkte erzeugt. Die Sehnenhoehe bleibt bei
    // dieser Segmentzahl ueber den ganzen Radiusbereich unter einem Pixel.
    const fullSegments = Phaser.Math.Clamp(Math.ceil(radius * 0.9), 12, 40);
    const segments = Math.max(2, Math.ceil(fullSegments * (sweep / (Math.PI * 2))));
    this.chargeGfx.lineStyle(full ? 3 : 2.5, color, pulse);
    this.chargeGfx.beginPath();
    for (let index = 0; index <= segments; index += 1) {
      const angle = -Math.PI / 2 + sweep * (index / segments);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (index === 0) this.chargeGfx.moveTo(x, y);
      else this.chargeGfx.lineTo(x, y);
    }
    this.chargeGfx.strokePath();
    this.chargeGfx.setVisible(true);
  }

  showTargetingReticle(cx: number, cy: number): void {
    // Vollstaendig gebacken – die Geometrie ist konstant, nur die Mitte wandert.
    this.reticle.setVisible(true).setPosition(cx, cy);
  }

  showGauss(
    startX: number,
    startY: number,
    angle: number,
    length: number,
    color: number,
    coreColor: number,
    alpha: number,
    pulse: number,
    emitterRadius: number,
  ): void {
    this.gaussWide.setVisible(true).setPosition(startX, startY).setRotation(angle)
      .setTint(color).setAlpha(alpha * pulse);
    this.gaussWide.displayWidth = length;

    this.gaussCore.setVisible(true).setPosition(startX, startY).setRotation(angle)
      .setTint(coreColor).setAlpha(alpha);
    this.gaussCore.displayWidth = length;

    this.gaussEmit.setVisible(true).setPosition(startX, startY)
      .setScale((emitterRadius * 2.1) / GAUSS_EMIT_TEX_RADIUS)
      .setTint(color).setAlpha(alpha * pulse);
  }

  /**
   * Nur der AWP-Ladebogen zeichnet noch im Immediate Mode. Der Wert ist im Normalfall 0 und damit
   * das Signal, ob die Zielhilfe ueberhaupt noch Vektorarbeit leistet.
   */
  getGraphicsCommandCount(): number {
    return this.chargeGfx.commandBuffer.length;
  }

  destroy(): void {
    for (const image of this.images) image.destroy();
    this.chargeGfx.destroy();
  }

  private addImage(key: string, frame?: string): Phaser.GameObjects.Image {
    const image = frame === undefined
      ? this.scene.add.image(0, 0, key)
      : this.scene.add.image(0, 0, key, frame);
    image.setDepth(DEPTH_AIM);
    image.setVisible(false);
    return image;
  }

  /** Streifen mit Ursprung am linken Rand: Position ist der Startpunkt, `displayWidth` die Laenge. */
  private addStrip(key: string, worldHeight: number, initialWidth = 1): Phaser.GameObjects.Image {
    const image = this.addImage(key);
    image.setOrigin(0, 0.5);
    image.setDisplaySize(initialWidth, worldHeight);
    return image;
  }

  private generateTextures(): void {
    const textures = this.scene.textures;

    // Beam-Saum: weiches, gaussaehnliches Band ohne Plateau – kein harter Rand.
    bakeStrip(textures, TEX.beamShadow, BEAM_STRIP_H, [
      [0.00, 'rgba(255,255,255,0.00)'],
      [0.20, 'rgba(255,255,255,0.35)'],
      [0.38, 'rgba(255,255,255,0.85)'],
      [0.50, 'rgba(255,255,255,1.00)'],
      [0.62, 'rgba(255,255,255,0.85)'],
      [0.80, 'rgba(255,255,255,0.35)'],
      [1.00, 'rgba(255,255,255,0.00)'],
    ], true);

    // Beam-Energie: Kern (1 px) → Glow (2 px) → weicher Halo (5 px), Gewichte im Alphakanal.
    bakeStrip(textures, TEX.beamEnergy, BEAM_STRIP_H, [
      [0.000, 'rgba(255,255,255,0.00)'],
      [0.190, 'rgba(255,255,255,0.18)'],
      [0.375, 'rgba(255,255,255,0.55)'],
      [0.440, 'rgba(255,255,255,1.00)'],
      [0.560, 'rgba(255,255,255,1.00)'],
      [0.625, 'rgba(255,255,255,0.55)'],
      [0.810, 'rgba(255,255,255,0.18)'],
      [1.000, 'rgba(255,255,255,0.00)'],
    ], true);

    fillRadialGradientTexture(textures, TEX.pulse, PULSE_TEX_SIZE, [
      [0.00, 'rgba(255,255,255,1.00)'],
      [0.30, 'rgba(255,255,255,0.65)'],
      [0.65, 'rgba(255,255,255,0.18)'],
      [1.00, 'rgba(255,255,255,0.00)'],
    ]);

    // Saum: mehrere weite, schwache Striche ergeben eine weich auslaufende dunkle Zone.
    bakeRingAtlas(textures, TEX.crossHalo, CROSS_CELL, CROSS_FRAMES, CROSS_ROWS, (ctx, cx, cy, radius) => {
      strokeRing(ctx, cx, cy, radius, HALO_MAX_W, 0.16);
      strokeRing(ctx, cx, cy, radius, 6, 0.28);
      strokeRing(ctx, cx, cy, radius, 4, 0.42);
    });

    // Glowkoerper: breitester Strich zuerst, der Verlauf ersetzt eine harte Kante durch einen
    // weichen Halo.
    bakeRingAtlas(textures, TEX.crossGlow, CROSS_CELL, CROSS_FRAMES, CROSS_ROWS, (ctx, cx, cy, radius) => {
      strokeRing(ctx, cx, cy, radius, RING_GLOW_W + 3, 0.16);
      strokeRing(ctx, cx, cy, radius, RING_GLOW_W + 1, 0.32);
      strokeRing(ctx, cx, cy, radius, 2, 1);
    });

    bakeRingAtlas(textures, TEX.chargeRing, CHARGE_CELL, CHARGE_FRAMES, CHARGE_ROWS, (ctx, cx, cy, radius) => {
      strokeRing(ctx, cx, cy, radius, CHARGE_SHADOW_W, 1);
    });

    // Mittelpunkt: deckender Kern (r = 2) mit dunklem Zwischenring und farbigem Glow bis r = 7.
    fillRadialGradientTexture(textures, TEX.dot, DOT_TEX_SIZE, [
      [0.000, 'rgba(255,255,255,1.00)'],
      [0.250, 'rgba(255,255,255,1.00)'],  // r = 2.0
      [0.330, 'rgba( 20, 20, 26,0.62)'],
      [0.440, 'rgba( 20, 20, 26,0.62)'],  // r = 3.5
      [0.540, 'rgba(255,255,255,0.42)'],
      [0.700, 'rgba(255,255,255,0.20)'],
      [0.880, 'rgba(255,255,255,0.06)'],  // r = 7.0
      [1.000, 'rgba(255,255,255,0.00)'],
    ]);
    ensureAimGlowDotTexture(this.scene);

    this.bakeHitMarker(textures);
    this.bakeTargetingReticle(textures);

    // Gauss-Strahl: der frueher aus fuenf Strichen gestapelte Querschnitt als Verlauf. Ohne
    // Laengsrampe – dieser Strahl blendet an den Enden nicht aus.
    bakeStrip(textures, TEX.gaussWide, GAUSS_WIDE_TEX_H, [
      [0.000, 'rgba( 71, 71, 71,0.00)'],
      [0.050, 'rgba( 71, 71, 71,0.05)'],
      [0.150, 'rgba(184,184,184,0.18)'],
      [0.275, 'rgba(255,255,255,0.43)'],
      [0.725, 'rgba(255,255,255,0.43)'],
      [0.850, 'rgba(184,184,184,0.18)'],
      [0.950, 'rgba( 71, 71, 71,0.05)'],
      [1.000, 'rgba( 71, 71, 71,0.00)'],
    ], false);

    bakeStrip(textures, TEX.gaussCore, GAUSS_CORE_TEX_H, [
      [0.000, 'rgba(255,255,255,0.00)'],
      [0.175, 'rgba(255,255,255,0.00)'],
      [0.250, 'rgba(255,255,255,0.55)'],
      [0.375, 'rgba(255,255,255,0.90)'],
      [0.625, 'rgba(255,255,255,0.90)'],
      [0.750, 'rgba(255,255,255,0.55)'],
      [0.825, 'rgba(255,255,255,0.00)'],
      [1.000, 'rgba(255,255,255,0.00)'],
    ], false);

    fillRadialGradientTexture(textures, TEX.gaussEmit, GAUSS_EMIT_TEX_SIZE, [
      [0.00, 'rgba(255,255,255,0.65)'],
      [0.26, 'rgba(255,255,255,0.50)'],
      [0.40, 'rgba(255,255,255,0.25)'],
      [0.62, 'rgba(255,255,255,0.25)'],
      [0.78, 'rgba(230,230,230,0.12)'],
      [1.00, 'rgba(230,230,230,0.00)'],
    ]);
  }

  /** Hitmarker-Bogen in Saum und Glowkoerper, Strichaufbau identisch zum Fadenkreuz-Ring. */
  private bakeHitMarker(textures: Phaser.Textures.TextureManager): void {
    const arcs = (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      radius: number,
      width: number,
      alpha: number,
    ): void => {
      const half = hitArcHalfAngle(radius);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      for (const angle of HIT_DIAGONALS) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, angle - half, angle + half);
        ctx.stroke();
      }
    };
    bakeRingAtlas(textures, TEX.hitHalo, HIT_CELL, HIT_FRAMES, HIT_ROWS, (ctx, cx, cy, radius) => {
      arcs(ctx, cx, cy, radius, HALO_MAX_W, 0.16);
      arcs(ctx, cx, cy, radius, 6, 0.28);
      arcs(ctx, cx, cy, radius, 4, 0.42);
    });
    bakeRingAtlas(textures, TEX.hitGlow, HIT_CELL, HIT_FRAMES, HIT_ROWS, (ctx, cx, cy, radius) => {
      arcs(ctx, cx, cy, radius, RING_GLOW_W + 3, 0.16);
      arcs(ctx, cx, cy, radius, RING_GLOW_W + 1, 0.32);
      arcs(ctx, cx, cy, radius, 2, 1);
    });
  }

  /**
   * Das Ziel-Reticle animiert nicht und alle seine Farben sind Konstanten. Es wird deshalb in
   * Vollfarbe gebacken und nie getintet – die Optik bleibt damit unveraendert.
   */
  private bakeTargetingReticle(textures: Phaser.Textures.TextureManager): void {
    const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
    const outerRadius = 26;
    const innerRadius = 12;
    const bracketGap = 34;
    const bracketLen = 12;
    const diamondRadius = 9;

    ensureCanvasTexture(textures, TEX.reticle, RETICLE_TEX_SIZE, RETICLE_TEX_SIZE, (ctx) => {
      const c = RETICLE_TEX_SIZE / 2;
      ctx.lineCap = 'round';

      const ring = (radius: number, width: number, color: number, alpha: number): void => {
        ctx.strokeStyle = hex(color);
        strokeRing(ctx, c, c, radius, width, alpha);
      };
      const line = (
        width: number, color: number, alpha: number,
        x1: number, y1: number, x2: number, y2: number,
      ): void => {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.strokeStyle = hex(color);
        ctx.beginPath();
        ctx.moveTo(c + x1, c + y1);
        ctx.lineTo(c + x2, c + y2);
        ctx.stroke();
      };

      ring(outerRadius + 2, 7, COLORS.RED_6, 0.34);
      ring(outerRadius, 4, COLORS.RED_3, 0.46);
      ring(innerRadius, 2, COLORS.GREY_1, 0.90);

      for (const [dx, dy] of AXES) {
        line(4, COLORS.RED_6, 0.28,
          dx * bracketGap, dy * bracketGap,
          dx * (bracketGap + bracketLen), dy * (bracketGap + bracketLen));
      }
      for (const [dx, dy] of AXES) {
        line(2, COLORS.RED_1, 0.95,
          dx * bracketGap, dy * bracketGap,
          dx * (bracketGap + bracketLen), dy * (bracketGap + bracketLen));
      }

      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      ctx.strokeStyle = hex(COLORS.RED_2);
      ctx.beginPath();
      ctx.moveTo(c, c - diamondRadius);
      ctx.lineTo(c + diamondRadius, c);
      ctx.lineTo(c, c + diamondRadius);
      ctx.lineTo(c - diamondRadius, c);
      ctx.closePath();
      ctx.stroke();

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = hex(COLORS.GREY_1);
      ctx.beginPath();
      ctx.arc(c, c, 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
    });
  }
}
