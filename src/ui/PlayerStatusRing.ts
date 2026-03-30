import Phaser from 'phaser';
import {
  ADRENALINE_MAX,
  ARMOR_COLOR,
  ARMOR_MAX,
  COLORS,
  DEPTH,
  HP_MAX,
  PLAYER_SIZE,
  RAGE_MAX,
} from '../config';
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

const RING_GAP_PX = 5;
const RING_THICKNESS = 7;
const RING_OUTER_RADIUS = PLAYER_SIZE / 2 + RING_GAP_PX + RING_THICKNESS;
const RING_INNER_RADIUS = RING_OUTER_RADIUS - RING_THICKNESS;
const ARMOR_RIM_THICKNESS = 1.8;
const CELL_COUNT = 11;
const CELL_GAP_DEGREES = 2;
const POLY_STEPS = 3;
const SHADOW_OFFSET = 1;
const HP_TRAIL_DELAY_MS = 220;
const HP_TRAIL_DURATION_MS = 420;
const FLASH_MS = 180;
const BURST_MS = 320;

const PAL_HP: SegmentPalette = { dark: COLORS.GREEN_5, mid: COLORS.GREEN_3, light: COLORS.GREEN_1, spark: 0xffffff };
const PAL_ADR: SegmentPalette = { dark: COLORS.BLUE_5, mid: COLORS.BLUE_3, light: COLORS.BLUE_1, spark: 0xffffff };
const PAL_RAGE: SegmentPalette = { dark: COLORS.RED_5, mid: COLORS.RED_2, light: COLORS.RED_1, spark: 0xffffff };
const PAL_ARMOR: SegmentPalette = { dark: COLORS.GOLD_5, mid: ARMOR_COLOR, light: COLORS.GOLD_1, spark: COLORS.GREY_1 };

const SEGMENTS: readonly SegmentConfig[] = [
  { key: 'adrenaline', fillStartAngle: 116, fillEndAngle: 4, palette: PAL_ADR },
  { key: 'hp',         fillStartAngle: 236, fillEndAngle: 124, palette: PAL_HP },
  { key: 'rage',       fillStartAngle: 244, fillEndAngle: 356, palette: PAL_RAGE },
];

function clamp01(value: number): number {
  return Phaser.Math.Clamp(value, 0, 1);
}

function degToRadFromTop(angle: number): number {
  return Phaser.Math.DegToRad(angle - 90);
}

function polarPoint(angle: number, radius: number): Phaser.Geom.Point {
  const rad = degToRadFromTop(angle);
  return new Phaser.Geom.Point(Math.cos(rad) * radius, Math.sin(rad) * radius);
}

function buildArcPolygon(startAngle: number, endAngle: number, innerRadius: number, outerRadius: number): Phaser.Geom.Point[] {
  const points: Phaser.Geom.Point[] = [];
  for (let index = 0; index <= POLY_STEPS; index += 1) {
    const angle = Phaser.Math.Linear(startAngle, endAngle, index / POLY_STEPS);
    points.push(polarPoint(angle, outerRadius));
  }
  for (let index = POLY_STEPS; index >= 0; index -= 1) {
    const angle = Phaser.Math.Linear(startAngle, endAngle, index / POLY_STEPS);
    points.push(polarPoint(angle, innerRadius));
  }
  return points;
}

function fillPolygon(graphics: Phaser.GameObjects.Graphics, points: Phaser.Geom.Point[], color: number, alpha: number): void {
  graphics.fillStyle(color, alpha);
  graphics.beginPath();
  graphics.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    graphics.lineTo(points[index].x, points[index].y);
  }
  graphics.closePath();
  graphics.fillPath();
}

export class PlayerStatusRing {
  private readonly container: Phaser.GameObjects.Container;
  private readonly shadowGraphics: Phaser.GameObjects.Graphics;
  private readonly baseGraphics: Phaser.GameObjects.Graphics;
  private readonly glowGraphics: Phaser.GameObjects.Graphics;
  private readonly fillGraphics: Phaser.GameObjects.Graphics;
  private readonly markerGraphics: Phaser.GameObjects.Graphics;
  private readonly sparkGraphics: Phaser.GameObjects.Graphics;

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

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getLocalSprite: () => Phaser.GameObjects.Image | undefined,
  ) {
    this.shadowGraphics = scene.add.graphics();
    this.shadowGraphics.setPosition(SHADOW_OFFSET, SHADOW_OFFSET);

    this.baseGraphics = scene.add.graphics();
    this.glowGraphics = scene.add.graphics();
    this.glowGraphics.setBlendMode(Phaser.BlendModes.ADD);
    this.fillGraphics = scene.add.graphics();
    this.markerGraphics = scene.add.graphics();
    this.sparkGraphics = scene.add.graphics();
    this.sparkGraphics.setBlendMode(Phaser.BlendModes.ADD);

    this.container = scene.add.container(0, 0, [
      this.shadowGraphics,
      this.baseGraphics,
      this.glowGraphics,
      this.fillGraphics,
      this.markerGraphics,
      this.sparkGraphics,
    ]);
    this.container.setDepth(DEPTH.LOCAL_UI);
    this.container.setVisible(false);
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.container.setVisible(false);
    }
  }

  update(data: LocalArenaHudData): void {
    this.latestData = data;

    const nextHpFrac = clamp01(data.hp / HP_MAX);
    const nextAdrFrac = clamp01(data.adrenaline / ADRENALINE_MAX);
    const nextRageFrac = clamp01(data.rage / RAGE_MAX);
    const nextArmorFrac = clamp01(data.armor / ARMOR_MAX);
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
    this.container.destroy(true);
  }

  private render(now: number): void {
    const sprite = this.getLocalSprite();
    if (!this.active || !this.latestData || !sprite || !sprite.active || !sprite.visible) {
      this.container.setVisible(false);
      return;
    }

    this.container.setVisible(true);
    this.container.setPosition(sprite.x, sprite.y);
    this.container.setAlpha(Phaser.Math.Clamp(sprite.alpha * 0.95, 0, 0.95));

    this.updateHpTrail(now);

    this.shadowGraphics.clear();
    this.baseGraphics.clear();
    this.glowGraphics.clear();
    this.fillGraphics.clear();
    this.markerGraphics.clear();
    this.sparkGraphics.clear();

    this.drawBackdrop();
    this.drawSegmentShadows();
    this.drawBaseSegments();
    this.drawEffectGlows(now);
    this.drawFilledSegments(now);
    this.drawMarkers();
    this.drawSparks(now);
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

  private drawBackdrop(): void {
    this.baseGraphics.lineStyle(1, COLORS.GREY_9, 0.42);
    this.baseGraphics.strokeCircle(0, 0, RING_INNER_RADIUS - 2);
    this.baseGraphics.lineStyle(1, COLORS.GREY_7, 0.24);
    this.baseGraphics.strokeCircle(0, 0, RING_OUTER_RADIUS + 1.2);
  }

  private drawSegmentShadows(): void {
    for (const segment of SEGMENTS) {
      this.drawSegmentFill(this.shadowGraphics, segment, 1, RING_INNER_RADIUS, RING_OUTER_RADIUS, COLORS.GREY_10, 0.28);
    }
    this.drawSegmentFill(this.shadowGraphics, SEGMENTS[1], 1, RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS, RING_OUTER_RADIUS + 0.4, COLORS.GREY_10, 0.32);
  }

  private drawBaseSegments(): void {
    for (const segment of SEGMENTS) {
      this.drawSegmentFill(this.baseGraphics, segment, 1, RING_INNER_RADIUS, RING_OUTER_RADIUS, segment.palette.dark, 0.26);
      this.drawSegmentFill(this.baseGraphics, segment, 1, RING_INNER_RADIUS + 0.8, RING_INNER_RADIUS + RING_THICKNESS * 0.52, COLORS.GREY_10, 0.18);
    }
    this.drawSegmentFill(this.baseGraphics, SEGMENTS[1], 1, RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS, RING_OUTER_RADIUS + 0.4, PAL_ARMOR.dark, 0.2);
  }

  private drawEffectGlows(now: number): void {
    const ragePulse = 0.45 + 0.55 * Math.sin(now * 0.008);
    const boostPulse = 0.45 + 0.55 * Math.sin(now * 0.01);
    const hpFlash = clamp01((this.hpFlashUntil - now) / FLASH_MS);

    if (hpFlash > 0.01) {
      this.drawSegmentFill(this.glowGraphics, SEGMENTS[1], this.hpTrailFrac, RING_INNER_RADIUS - 1.2, RING_OUTER_RADIUS + 1.8, COLORS.RED_2, 0.16 + hpFlash * 0.22);
    }

    if (this.adrenalineBoostActive) {
      this.drawSegmentFill(this.glowGraphics, SEGMENTS[0], Math.max(this.adrFrac, 0.12), RING_INNER_RADIUS - 0.8, RING_OUTER_RADIUS + 1.8, PAL_ADR.light, 0.18 + boostPulse * 0.18);
    }

    if (this.rageReady) {
      this.drawSegmentFill(this.glowGraphics, SEGMENTS[2], Math.max(this.rageFrac, 0.12), RING_INNER_RADIUS - 0.8, RING_OUTER_RADIUS + 1.8, this.ultimateActive ? PAL_RAGE.spark : PAL_RAGE.light, 0.18 + ragePulse * (this.ultimateActive ? 0.22 : 0.16));
    }
  }

  private drawFilledSegments(now: number): void {
    const hpFlash = clamp01((this.hpFlashUntil - now) / FLASH_MS);

    if (this.hpTrailFrac > this.hpFrac + 0.002) {
      this.drawSegmentFill(this.fillGraphics, SEGMENTS[1], this.hpTrailFrac, RING_INNER_RADIUS, RING_OUTER_RADIUS, COLORS.RED_2, 0.28);
      this.drawSegmentFill(this.fillGraphics, SEGMENTS[1], this.hpTrailFrac, RING_INNER_RADIUS + 1.5, RING_INNER_RADIUS + RING_THICKNESS * 0.54, COLORS.RED_1, 0.18);
    }

    this.drawResourceSegment(SEGMENTS[1], this.hpFrac, PAL_HP, 0.78, 0.58 + hpFlash * 0.22);
    this.drawResourceSegment(SEGMENTS[0], this.adrFrac, PAL_ADR, this.adrenalineBoostActive ? 0.88 : 0.76, this.adrenalineBoostActive ? 0.72 : 0.56);
    this.drawResourceSegment(SEGMENTS[2], this.rageFrac, PAL_RAGE, this.ultimateActive ? 0.92 : 0.8, this.rageReady ? 0.74 : 0.58);

    this.drawSegmentFill(this.fillGraphics, SEGMENTS[1], this.armorFrac, RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS, RING_OUTER_RADIUS + 0.4, PAL_ARMOR.mid, 0.88);
    this.drawSegmentFill(this.fillGraphics, SEGMENTS[1], this.armorFrac, RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS + 0.3, RING_OUTER_RADIUS, PAL_ARMOR.light, 0.42);
  }

  private drawResourceSegment(
    segment: SegmentConfig,
    fraction: number,
    palette: SegmentPalette,
    mainAlpha: number,
    highlightAlpha: number,
  ): void {
    this.drawSegmentFill(this.fillGraphics, segment, fraction, RING_INNER_RADIUS, RING_OUTER_RADIUS, palette.mid, mainAlpha);
    this.drawSegmentFill(this.fillGraphics, segment, fraction, RING_INNER_RADIUS + 0.9, RING_INNER_RADIUS + RING_THICKNESS * 0.55, palette.light, highlightAlpha);
    this.drawSegmentFill(this.fillGraphics, segment, fraction, RING_OUTER_RADIUS - 1.4, RING_OUTER_RADIUS, palette.dark, 0.24);
  }

  private drawMarkers(): void {
    this.drawAdrenalineCostMarkers();
    this.drawRageThresholdMarkers();
  }

  private drawAdrenalineCostMarkers(): void {
    const cost = this.latestData?.weapon2AdrenalineCost ?? 0;
    if (cost < 5) return;

    const count = Math.floor(ADRENALINE_MAX / cost);
    for (let step = 1; step <= count; step += 1) {
      const fraction = clamp01((step * cost) / ADRENALINE_MAX);
      this.drawMarker(SEGMENTS[0], fraction, COLORS.GREY_1, 0.44, 1.2);
    }
  }

  private drawRageThresholdMarkers(): void {
    const thresholds = this.latestData?.ultimateThresholds ?? [];
    for (const threshold of thresholds) {
      if (threshold <= 0 || threshold >= RAGE_MAX) continue;
      this.drawMarker(SEGMENTS[2], clamp01(threshold / RAGE_MAX), COLORS.GREY_1, 0.42, 1.4);
    }
  }

  private drawMarker(segment: SegmentConfig, fraction: number, color: number, alpha: number, lineWidth: number): void {
    const angle = Phaser.Math.Linear(segment.fillStartAngle, segment.fillEndAngle, fraction);
    const inner = polarPoint(angle, RING_INNER_RADIUS - 1);
    const outer = polarPoint(angle, RING_OUTER_RADIUS + 1.2);
    this.markerGraphics.lineStyle(lineWidth, color, alpha);
    this.markerGraphics.beginPath();
    this.markerGraphics.moveTo(inner.x, inner.y);
    this.markerGraphics.lineTo(outer.x, outer.y);
    this.markerGraphics.strokePath();
  }

  private drawSparks(now: number): void {
    const adrBurst = clamp01((this.adrBurstUntil - now) / BURST_MS);
    if (adrBurst > 0.01) {
      this.drawEndpointSpark(SEGMENTS[0], this.adrFrac, PAL_ADR, 0.22 + adrBurst * 0.42, now, 3);
    }
    if (this.adrenalineBoostActive) {
      this.drawEndpointSpark(SEGMENTS[0], Math.max(this.adrFrac, 0.08), PAL_ADR, 0.24, now + 190, 2);
    }
    if (this.rageReady) {
      this.drawEndpointSpark(SEGMENTS[2], Math.max(this.rageFrac, 0.08), PAL_RAGE, this.ultimateActive ? 0.34 : 0.24, now + 90, this.ultimateActive ? 4 : 2);
    }
  }

  private drawEndpointSpark(
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
      const wave = now * 0.01 + index * 1.7;
      const radius = RING_OUTER_RADIUS + 1.5 + Math.sin(wave) * 1.2;
      const offsetAngle = angle + Math.sin(wave * 1.35) * 2.4;
      const point = polarPoint(offsetAngle, radius);
      const size = 1.2 + ((Math.sin(wave * 1.9) + 1) * 0.5);
      this.sparkGraphics.fillStyle(palette.spark, alpha * 0.7);
      this.sparkGraphics.fillCircle(point.x, point.y, size);
      this.sparkGraphics.fillStyle(palette.light, alpha);
      this.sparkGraphics.fillCircle(point.x, point.y, size * 0.58);
    }
  }

  private drawSegmentFill(
    graphics: Phaser.GameObjects.Graphics,
    segment: SegmentConfig,
    fraction: number,
    innerRadius: number,
    outerRadius: number,
    color: number,
    alpha: number,
  ): void {
    const clamped = clamp01(fraction);
    if (clamped <= 0) return;

    const sweep = Math.abs(segment.fillEndAngle - segment.fillStartAngle);
    const cellSweep = (sweep - CELL_GAP_DEGREES * (CELL_COUNT - 1)) / CELL_COUNT;
    const direction = segment.fillEndAngle >= segment.fillStartAngle ? 1 : -1;
    const stride = direction * (cellSweep + CELL_GAP_DEGREES);

    for (let index = 0; index < CELL_COUNT; index += 1) {
      const cellStart = segment.fillStartAngle + stride * index;
      const cellEnd = cellStart + direction * cellSweep;
      const startProgress = Math.abs(cellStart - segment.fillStartAngle) / sweep;
      const endProgress = Math.abs(cellEnd - segment.fillStartAngle) / sweep;
      const cellMin = Math.min(startProgress, endProgress);
      const cellMax = Math.max(startProgress, endProgress);
      const coverage = clamp01((clamped - cellMin) / Math.max(0.0001, cellMax - cellMin));
      if (coverage <= 0) continue;

      const partialEnd = Phaser.Math.Linear(cellStart, cellEnd, coverage);
      fillPolygon(graphics, buildArcPolygon(cellStart, partialEnd, innerRadius, outerRadius), color, alpha);
    }
  }
}