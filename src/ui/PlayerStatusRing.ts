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
import { ensureLivingBarTextures } from './LivingBarEffect';
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

interface SegmentEmitterBundle {
  core: Phaser.GameObjects.Particles.ParticleEmitter;
  outer: Phaser.GameObjects.Particles.ParticleEmitter;
  coreSource: ArcRingRandomSource;
  outerSource: ArcRingRandomSource;
}

const RING_GAP_PX = 16;
const RING_THICKNESS = 6;
const RING_OUTER_RADIUS = PLAYER_SIZE / 2 + RING_GAP_PX + RING_THICKNESS;
const RING_INNER_RADIUS = RING_OUTER_RADIUS - RING_THICKNESS;
const ARMOR_RIM_THICKNESS = 3;
const POLY_STEPS = 8;
const SHADOW_OFFSET = 0;
const HP_TRAIL_DELAY_MS = 220;
const HP_TRAIL_DURATION_MS = 420;
const FLASH_MS = 180;
const BURST_MS = 320;
const WARNING_MS = 380;
const WARNING_DEBOUNCE_MS = 220;
const LIVING_EMITTER_IDLE_FREQUENCY = 50;
const LIVING_EMITTER_ACTIVE_FREQUENCY = 10;

const PAL_HP: SegmentPalette = { dark: COLORS.GREEN_3, mid: 0x00cc44, light: COLORS.GREEN_1, spark: 0xffffff };
const PAL_ADR: SegmentPalette = { dark: COLORS.BLUE_3, mid: COLORS.BLUE_2, light: COLORS.BLUE_1, spark: 0xffffff };
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

class ArcRingRandomSource {
  private innerRadius = 0;
  private outerRadius = 0;
  private section: AngleSection | null = null;

  set(innerRadius: number, outerRadius: number, section: AngleSection | null): void {
    this.innerRadius = innerRadius;
    this.outerRadius = outerRadius;
    this.section = section;
  }

  getRandomPoint(point: Phaser.Types.Math.Vector2Like): Phaser.Types.Math.Vector2Like {
    const target = point as Phaser.Geom.Point;
    if (!this.section) {
      target.x = 0;
      target.y = 0;
      return target;
    }

    const angle = Phaser.Math.FloatBetween(this.section.startAngle, this.section.endAngle);
    const radius = Math.sqrt(Phaser.Math.FloatBetween(this.innerRadius * this.innerRadius, this.outerRadius * this.outerRadius));
    const rad = degToRadFromTop(angle);
    target.x = Math.cos(rad) * radius;
    target.y = Math.sin(rad) * radius;
    return target;
  }
}

export class PlayerStatusRing {
  private readonly container: Phaser.GameObjects.Container;
  private readonly shadowGraphics: Phaser.GameObjects.Graphics;
  private readonly baseGraphics: Phaser.GameObjects.Graphics;
  private readonly warningGraphics: Phaser.GameObjects.Graphics;
  private readonly glowGraphics: Phaser.GameObjects.Graphics;
  private readonly fillGraphics: Phaser.GameObjects.Graphics;
  private readonly sparkGraphics: Phaser.GameObjects.Graphics;

  private readonly livingEmitters = new Map<SegmentKey, SegmentEmitterBundle>();

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
  private lastAdrenalineWarningAt = -Infinity;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getLocalSprite: () => Phaser.GameObjects.Image | undefined,
  ) {
    ensureLivingBarTextures(scene);

    this.shadowGraphics = scene.add.graphics();
    this.shadowGraphics.setPosition(SHADOW_OFFSET, SHADOW_OFFSET);

    this.baseGraphics = scene.add.graphics();
    this.warningGraphics = scene.add.graphics();
    this.glowGraphics = scene.add.graphics();
    this.glowGraphics.setBlendMode(Phaser.BlendModes.ADD);
    this.fillGraphics = scene.add.graphics();
    this.sparkGraphics = scene.add.graphics();
    this.sparkGraphics.setBlendMode(Phaser.BlendModes.ADD);

    for (const segment of SEGMENTS) {
      this.livingEmitters.set(segment.key, this.createLivingEmitters(segment));
    }

    this.container = scene.add.container(0, 0, [
      this.shadowGraphics,
      this.baseGraphics,
      this.warningGraphics,
      this.glowGraphics,
      this.fillGraphics,
      this.sparkGraphics,
    ]);
    this.container.setDepth(DEPTH.LOCAL_UI);
    this.container.setVisible(false);
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.container.setVisible(false);
      this.stopLivingEmitters();
    }
  }

  notifyAdrenalineInsufficientShot(): void {
    const now = this.scene.time.now;
    if (now - this.lastAdrenalineWarningAt < WARNING_DEBOUNCE_MS) return;
    this.lastAdrenalineWarningAt = now;
    this.adrenalineWarningUntil = now + WARNING_MS;
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
    this.stopLivingEmitters();
    for (const bundle of this.livingEmitters.values()) {
      bundle.core.destroy();
      bundle.outer.destroy();
    }
    this.container.destroy(true);
  }

  private createLivingEmitters(segment: SegmentConfig): SegmentEmitterBundle {
    const coreSource = new ArcRingRandomSource();
    const outerSource = new ArcRingRandomSource();
    const coreZone = { type: 'random', source: coreSource } as Phaser.Types.GameObjects.Particles.EmitZoneData;
    const outerZone = { type: 'random', source: outerSource } as Phaser.Types.GameObjects.Particles.EmitZoneData;

    const core = this.scene.add.particles(0, 0, '_living_blob', {
      lifespan: { min: 300, max: 500 },
      frequency: LIVING_EMITTER_IDLE_FREQUENCY,
      quantity: 1,
      speedX: { min: -2, max: 2 },
      speedY: { min: -1, max: 1 },
      scale: { start: 0.72, end: 0.28 },
      alpha: { start: 0.05, end: 0.03 },
      tint: [segment.palette.mid, segment.palette.dark, segment.palette.light],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    core.addEmitZone(coreZone);
    core.setDepth(DEPTH.LOCAL_UI);

    const outer = this.scene.add.particles(0, 0, '_living_blob', {
      lifespan: { min: 300, max: 700 },
      frequency: LIVING_EMITTER_IDLE_FREQUENCY,
      quantity: 1,
      speedX: { min: -1, max: 1 },
      speedY: { min: -0.5, max: 0.5 },
      scale: { start: 1.05, end: 0.5 },
      alpha: { start: 0.09, end: 0.03 },
      tint: [segment.palette.dark, segment.palette.mid],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    outer.addEmitZone(outerZone);
    outer.setDepth(DEPTH.LOCAL_UI);

    return { core, outer, coreSource, outerSource };
  }

  private stopLivingEmitters(): void {
    for (const bundle of this.livingEmitters.values()) {
      bundle.core.stop();
      bundle.outer.stop();
    }
  }

  private render(now: number): void {
    const sprite = this.getLocalSprite();
    if (!this.active || !this.latestData || !sprite || !sprite.active || !sprite.visible) {
      this.container.setVisible(false);
      this.stopLivingEmitters();
      return;
    }

    const warningFrac = clamp01((this.adrenalineWarningUntil - now) / WARNING_MS);
    const wobbleX = warningFrac > 0
      ? Math.sin(now * 0.08) * 1.4 * warningFrac
      : 0;
    const wobbleY = warningFrac > 0
      ? Math.cos(now * 0.06) * 0.5 * warningFrac
      : 0;

    this.container.setVisible(true);
    this.container.setPosition(sprite.x + wobbleX, sprite.y + wobbleY);
    this.container.setAlpha(Phaser.Math.Clamp(sprite.alpha * 0.95, 0, 0.95));

    this.updateHpTrail(now);

    this.shadowGraphics.clear();
    this.baseGraphics.clear();
    this.warningGraphics.clear();
    this.glowGraphics.clear();
    this.fillGraphics.clear();
    this.sparkGraphics.clear();

    this.drawSegmentShadows();
    this.drawBaseSegments();
    this.drawAdrenalineWarning(warningFrac);
    this.drawEffectGlows(now);
    this.drawFilledSegments(now);
    this.drawSparks(now);

    this.syncLivingEmitters(sprite.alpha, now);
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

  private drawSegmentShadows(): void {
    this.drawSegmentLayer(this.shadowGraphics, SEGMENTS[1], 1, RING_INNER_RADIUS, RING_OUTER_RADIUS, COLORS.GREY_10, 0.28);
    this.drawSegmentLayer(this.shadowGraphics, SEGMENTS[0], 1, RING_INNER_RADIUS, RING_OUTER_RADIUS, COLORS.GREY_10, 0.28);
    this.drawSegmentLayer(this.shadowGraphics, SEGMENTS[2], 1, RING_INNER_RADIUS, RING_OUTER_RADIUS, COLORS.GREY_10, 0.28);
    this.drawSegmentLayer(this.shadowGraphics, SEGMENTS[1], 1, RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS, RING_OUTER_RADIUS + 0.4, COLORS.GREY_10, 0.32);
  }

  private drawBaseSegments(): void {
    this.drawResourceBase(SEGMENTS[1]);
    this.drawResourceBase(SEGMENTS[0]);
    this.drawResourceBase(SEGMENTS[2]);
    this.drawSegmentLayer(this.baseGraphics, SEGMENTS[1], 1, RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS, RING_OUTER_RADIUS + 0.4, PAL_ARMOR.dark, 0.2);
  }

  private drawResourceBase(segment: SegmentConfig): void {
    this.drawSegmentLayer(this.baseGraphics, segment, 1, RING_INNER_RADIUS, RING_OUTER_RADIUS, segment.palette.dark, 0.26);
    this.drawSegmentLayer(this.baseGraphics, segment, 1, RING_INNER_RADIUS + 0.8, RING_INNER_RADIUS + RING_THICKNESS * 0.52, COLORS.GREY_10, 0.18);
  }

  private drawAdrenalineWarning(warningFrac: number): void {
    if (warningFrac <= 0.01) return;
    this.drawSegmentLayer(this.warningGraphics, SEGMENTS[0], 1, RING_INNER_RADIUS - 0.6, RING_OUTER_RADIUS + 1.6, COLORS.RED_4, 0.12 + warningFrac * 0.14);
    this.drawSegmentLayer(this.warningGraphics, SEGMENTS[0], 1, RING_INNER_RADIUS + 1.2, RING_OUTER_RADIUS - 0.8, COLORS.RED_2, 0.06 + warningFrac * 0.08);
  }

  private drawEffectGlows(now: number): void {
    const ragePulse = 0.45 + 0.55 * Math.sin(now * 0.008);
    const boostPulse = 0.45 + 0.55 * Math.sin(now * 0.01);
    const hpFlash = clamp01((this.hpFlashUntil - now) / FLASH_MS);

    if (hpFlash > 0.01) {
      this.drawSegmentLayer(this.glowGraphics, SEGMENTS[1], this.hpTrailFrac, RING_INNER_RADIUS - 1.2, RING_OUTER_RADIUS + 1.8, COLORS.RED_2, 0.16 + hpFlash * 0.22);
    }

    if (this.adrenalineBoostActive) {
      this.drawSegmentLayer(this.glowGraphics, SEGMENTS[0], Math.max(this.adrFrac, 0.12), RING_INNER_RADIUS - 0.8, RING_OUTER_RADIUS + 1.8, PAL_ADR.light, 0.18 + boostPulse * 0.18);
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

  private drawFilledSegments(now: number): void {
    const hpFlash = clamp01((this.hpFlashUntil - now) / FLASH_MS);

    if (this.hpTrailFrac > this.hpFrac + 0.002) {
      this.drawSegmentLayer(this.fillGraphics, SEGMENTS[1], this.hpTrailFrac, RING_INNER_RADIUS, RING_OUTER_RADIUS, COLORS.RED_2, 0.28);
      this.drawSegmentLayer(this.fillGraphics, SEGMENTS[1], this.hpTrailFrac, RING_INNER_RADIUS + 1.5, RING_INNER_RADIUS + RING_THICKNESS * 0.54, COLORS.RED_1, 0.18);
    }

    this.drawResourceSegment(SEGMENTS[1], this.hpFrac, PAL_HP, 0.78, 0.58 + hpFlash * 0.22);
    this.drawResourceSegment(SEGMENTS[0], this.adrFrac, PAL_ADR, this.adrenalineBoostActive ? 0.88 : 0.76, this.adrenalineBoostActive ? 0.72 : 0.56);
    this.drawResourceSegment(SEGMENTS[2], this.rageFrac, PAL_RAGE, this.ultimateActive ? 0.92 : 0.8, this.rageReady ? 0.74 : 0.58);

    this.drawSegmentLayer(this.fillGraphics, SEGMENTS[1], this.armorFrac, RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS, RING_OUTER_RADIUS + 0.4, PAL_ARMOR.mid, 0.88);
    this.drawSegmentLayer(this.fillGraphics, SEGMENTS[1], this.armorFrac, RING_OUTER_RADIUS - ARMOR_RIM_THICKNESS + 0.3, RING_OUTER_RADIUS, PAL_ARMOR.light, 0.42);
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

  private syncLivingEmitters(alpha: number, now: number): void {
    this.syncEmitterBundle(SEGMENTS[1], this.hpFrac, alpha, this.isHpEmitterActive(now));
    this.syncEmitterBundle(SEGMENTS[0], this.adrFrac, alpha, this.adrenalineBoostActive);
    this.syncEmitterBundle(SEGMENTS[2], this.rageFrac, alpha, this.rageReady);
  }

  private syncEmitterBundle(segment: SegmentConfig, fraction: number, alpha: number, isActive: boolean): void {
    const bundle = this.livingEmitters.get(segment.key);
    if (!bundle) return;

    const centerX = this.container.x;
    const centerY = this.container.y;
    const section = this.getFilledSection(segment, fraction);

    bundle.core.setPosition(centerX, centerY);
    bundle.outer.setPosition(centerX, centerY);
    bundle.core.setAlpha(alpha * 0.92);
    bundle.outer.setAlpha(alpha * 0.88);
    bundle.core.setFrequency(isActive ? LIVING_EMITTER_ACTIVE_FREQUENCY : LIVING_EMITTER_IDLE_FREQUENCY, 1);
    bundle.outer.setFrequency(isActive ? LIVING_EMITTER_ACTIVE_FREQUENCY : LIVING_EMITTER_IDLE_FREQUENCY, 1);
    bundle.coreSource.set(RING_INNER_RADIUS + 0.8, RING_INNER_RADIUS + RING_THICKNESS * 0.72, section);
    bundle.outerSource.set(RING_INNER_RADIUS + 0.2, RING_OUTER_RADIUS - 0.4, section);

    if (fraction > 0.03 && section) {
      if (!bundle.core.emitting) bundle.core.start();
      if (!bundle.outer.emitting) bundle.outer.start();
    } else {
      bundle.core.stop();
      bundle.outer.stop();
    }
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

  private isHpEmitterActive(now: number): boolean {
    return (this.hpFlashUntil - now) > 0;
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
    fillPolygon(graphics, buildArcPolygon(section.startAngle, section.endAngle, innerRadius, outerRadius), color, alpha);
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
