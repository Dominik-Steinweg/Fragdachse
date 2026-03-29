import Phaser from 'phaser';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import { AimSpreadModel } from './AimSpreadModel';
import type { PlayerAimNetState, UltimateChargePreviewState, UtilityChargePreviewState, UtilityTargetingPreviewState, WeaponSlot } from '../types';
import {
  COLORS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH,    ARENA_HEIGHT,
  getTopDownMuzzleOrigin,
} from '../config';
import { LivingBarEffect, paletteFromColor } from './LivingBarEffect';

type SlotPalette = {
  beamShadow: number;
  beamGlow: number;
  beamCore: number;
  crossGlow: number;
  crossMain: number;
};

const SLOT_PALETTES: Record<WeaponSlot, SlotPalette> = {
  weapon1: {
    beamShadow: COLORS.BLUE_6,
    beamGlow:   COLORS.BLUE_4,
    beamCore:   COLORS.BLUE_2,
    crossGlow:  COLORS.BLUE_3,
    crossMain:  COLORS.BLUE_1,
  },
  weapon2: {
    beamShadow: COLORS.GOLD_6,
    beamGlow:   COLORS.GOLD_4,
    beamCore:   COLORS.GOLD_2,
    crossGlow:  COLORS.GOLD_3,
    crossMain:  COLORS.GOLD_1,
  },
};

const TARGETING_PALETTE: SlotPalette = {
  beamShadow: COLORS.RED_6,
  beamGlow:   COLORS.RED_4,
  beamCore:   COLORS.RED_2,
  crossGlow:  COLORS.RED_3,
  crossMain:  COLORS.RED_1,
};

// ── Visuelle Konstanten ────────────────────────────────────────────────────
const CROSS_SHADOW_COLOR = COLORS.GREY_10;
const CROSS_LINE_LEN     = 9;
const CROSS_LINE_W       = 2;
const CROSS_GAP_MIN      = 5;
const CROSS_GAP_MAX      = 28;
const CROSS_SHADOW_W     = 5;
const CROSS_GLOW_W       = 3;
const CENTER_DOT_SIZE    = 2;
const END_CAP_LEN        = 3;
const HIT_FLASH_MS       = 100;

const BEAM_SEGMENTS      = 14;
const BEAM_SHADOW_W      = 4;
const BEAM_GLOW_W        = 2;
const BEAM_CORE_W        = 1;
const BEAM_SHADOW_ALPHA  = 0.10;
const BEAM_GLOW_ALPHA    = 0.14;
const BEAM_CORE_ALPHA    = 0.34;
const BEAM_START_FADE_AT = 0.10;
const BEAM_END_FADE_AT   = 0.90;

const RANGE_BAR_HALF_LEN = 8;

const MOVE_THRESHOLD = 0.3;

const AX1 = ARENA_OFFSET_X;
const AY1 = ARENA_OFFSET_Y;
const AX2 = ARENA_OFFSET_X + ARENA_WIDTH;
const AY2 = ARENA_OFFSET_Y + ARENA_HEIGHT;

const CHARGE_ANCHOR_OFFSET_X = 18;
const CHARGE_STEM_LENGTH = 12;
const CHARGE_BAR_GAP = 6;
const CHARGE_BAR_WIDTH = 52;
const CHARGE_BAR_HEIGHT = 8;
const CHARGE_BAR_START_X = CHARGE_ANCHOR_OFFSET_X + CHARGE_STEM_LENGTH + CHARGE_BAR_GAP;

export class AimSystem {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly spreadModel: AimSpreadModel;

  private prevX: number | null = null;
  private prevY: number | null = null;
  private prevShowAim = false;
  private confirmedHitUntil = 0;

  constructor(
    private readonly scene:           Phaser.Scene,
    private readonly getLocalSprite:  () => Phaser.GameObjects.Image | undefined,
    private readonly getWeaponConfig: (slot: WeaponSlot) => WeaponConfig,
    private readonly getPlayerColor:  () => number,
  ) {
    this.gfx = scene.add.graphics();
    this.gfx.setDepth(14);
    this.spreadModel = new AimSpreadModel(getWeaponConfig);
  }

  notifyShot(slot: WeaponSlot): void {
    this.spreadModel.notifyShot(slot);
  }

  setAuthoritativeState(state: PlayerAimNetState | undefined): void {
    this.spreadModel.setAuthoritativeState(state);
  }

  notifyConfirmedHit(): void {
    this.confirmedHitUntil = this.scene.time.now + HIT_FLASH_MS;
  }

  update(
    showAim: boolean,
    inArena: boolean,
    delta: number,
    utilityTargeting?: UtilityTargetingPreviewState,
    ultimatePreview?: UltimateChargePreviewState,
  ): void {
    this.scene.input.setDefaultCursor(inArena ? 'none' : 'default');

    if (showAim && !this.prevShowAim) {
      this.prevX = null;
      this.prevY = null;
    }
    this.prevShowAim = showAim;

    this.gfx.clear();
    if (!showAim) return;

    const sprite = this.getLocalSprite();
    if (!sprite) return;

    const sx = this.snap(sprite.x);
    const sy = this.snap(sprite.y);

    if (utilityTargeting) {
      const tx = this.snap(utilityTargeting.targetX);
      const ty = this.snap(utilityTargeting.targetY);
      this.drawTargetingReticle(tx, ty);
      return;
    }

    if (ultimatePreview?.reticleStyle === 'gauss' && ultimatePreview.range) {
      this.drawGaussAimReticle(sx, sy, ultimatePreview);
      return;
    }

    let localIsMoving = false;
    if (this.prevX === null) {
      this.prevX = sx;
      this.prevY = sy;
    } else {
      localIsMoving = Math.abs(sx - this.prevX) > MOVE_THRESHOLD
                   || Math.abs(sy - (this.prevY ?? sy)) > MOVE_THRESHOLD;
      this.prevX = sx;
      this.prevY = sy;
    }

    this.spreadModel.setLocalMovement(localIsMoving);
    this.spreadModel.update(delta);

    const aimState = this.spreadModel.getResolvedState();
    const cfg = this.getWeaponConfig(aimState.activeSlot);
    const palette = SLOT_PALETTES[aimState.activeSlot];

    const baseSpread = aimState.isMoving ? cfg.spreadMoving : cfg.spreadStanding;
    const totalSpread = Math.max(0, baseSpread + aimState.dynamicSpread);
    const maxTotal = cfg.spreadMoving + Math.max(0, cfg.maxDynamicSpread);
    const frac = maxTotal > 0 ? Math.min(1, totalSpread / maxTotal) : 0;

    const pointer = this.scene.input.activePointer;
    const px = pointer.x;
    const py = pointer.y;
    const dx = px - sx;
    const dy = py - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = dist > 0 ? dx / dist : 1;
    const ny = dist > 0 ? dy / dist : 0;
    const rangeDist = Math.min(dist, cfg.range);
    const ex = sx + nx * rangeDist;
    const ey = sy + ny * rangeDist;

    const { x: cx, y: cy } = this.clipToArena(sx, sy, ex, ey);
    const tx = this.snap(cx);
    const ty = this.snap(cy);

    this.drawBeam(sx, sy, tx, ty, palette, frac);

    if (cfg.showCrosshair === false) return;

    const accentColor = this.getAccentColor();
    this.drawCrosshair(this.snap(px), this.snap(py), frac, palette, accentColor);

    if (dist > cfg.range) {
      const rx = sx + nx * cfg.range;
      const ry = sy + ny * cfg.range;
      this.drawRangeIndicator(this.snap(rx), this.snap(ry), nx, ny, palette, accentColor);
    }
  }

  destroy(): void {
    this.scene.input.setDefaultCursor('default');
    this.gfx.destroy();
  }

  private drawBeam(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    palette: SlotPalette,
    frac: number,
  ): void {
    this.strokeSegmentedLine(BEAM_SHADOW_W, palette.beamShadow, BEAM_SHADOW_ALPHA + frac * 0.04, sx, sy, ex, ey);
    this.strokeSegmentedLine(BEAM_GLOW_W, palette.beamGlow, BEAM_GLOW_ALPHA + frac * 0.05, sx, sy, ex, ey);
    this.strokeSegmentedLine(BEAM_CORE_W, palette.beamCore, Math.max(0.14, BEAM_CORE_ALPHA - frac * 0.08), sx, sy, ex, ey);
  }

  private drawCrosshair(
    cx: number,
    cy: number,
    frac: number,
    palette: SlotPalette,
    accentColor: number,
  ): void {
    const gap = CROSS_GAP_MIN + frac * (CROSS_GAP_MAX - CROSS_GAP_MIN);

    this.gfx.fillStyle(CROSS_SHADOW_COLOR, 0.42);
    this.gfx.fillRect(cx - CENTER_DOT_SIZE, cy - CENTER_DOT_SIZE, CENTER_DOT_SIZE * 2, CENTER_DOT_SIZE * 2);
    this.gfx.fillStyle(accentColor, 0.96);
    this.gfx.fillRect(cx - CENTER_DOT_SIZE + 1, cy - CENTER_DOT_SIZE + 1, CENTER_DOT_SIZE * 2 - 2, CENTER_DOT_SIZE * 2 - 2);

    this.drawCrosshairArm(cx + gap, cy, cx + gap + CROSS_LINE_LEN, cy, 'horizontal', 1, frac, palette, accentColor);
    this.drawCrosshairArm(cx - gap, cy, cx - gap - CROSS_LINE_LEN, cy, 'horizontal', -1, frac, palette, accentColor);
    this.drawCrosshairArm(cx, cy + gap, cx, cy + gap + CROSS_LINE_LEN, 'vertical', 1, frac, palette, accentColor);
    this.drawCrosshairArm(cx, cy - gap, cx, cy - gap - CROSS_LINE_LEN, 'vertical', -1, frac, palette, accentColor);
  }

  private drawRangeIndicator(
    rx: number,
    ry: number,
    nx: number,
    ny: number,
    palette: SlotPalette,
    accentColor: number,
  ): void {
    // Perpendicular to the aim direction
    const px = -ny;
    const py =  nx;
    const x1 = rx - px * RANGE_BAR_HALF_LEN;
    const y1 = ry - py * RANGE_BAR_HALF_LEN;
    const x2 = rx + px * RANGE_BAR_HALF_LEN;
    const y2 = ry + py * RANGE_BAR_HALF_LEN;

    this.strokeLine(CROSS_SHADOW_W, CROSS_SHADOW_COLOR, 0.40, x1, y1, x2, y2);
    this.strokeLine(CROSS_GLOW_W,   palette.crossGlow,  0.30, x1, y1, x2, y2);
    this.strokeLine(CROSS_LINE_W + 1, accentColor,      0.88, x1, y1, x2, y2);
  }

  private drawTargetingReticle(cx: number, cy: number): void {
    const outerRadius = 26;
    const innerRadius = 12;
    const bracketGap = 34;
    const bracketLen = 12;
    const diamondRadius = 9;

    this.gfx.lineStyle(7, TARGETING_PALETTE.beamShadow, 0.34);
    this.gfx.strokeCircle(cx, cy, outerRadius + 2);
    this.gfx.lineStyle(4, TARGETING_PALETTE.crossGlow, 0.46);
    this.gfx.strokeCircle(cx, cy, outerRadius);
    this.gfx.lineStyle(2, COLORS.GREY_1, 0.9);
    this.gfx.strokeCircle(cx, cy, innerRadius);

    this.strokeLine(4, TARGETING_PALETTE.beamShadow, 0.28, cx - bracketGap, cy, cx - bracketGap - bracketLen, cy);
    this.strokeLine(4, TARGETING_PALETTE.beamShadow, 0.28, cx + bracketGap, cy, cx + bracketGap + bracketLen, cy);
    this.strokeLine(4, TARGETING_PALETTE.beamShadow, 0.28, cx, cy - bracketGap, cx, cy - bracketGap - bracketLen);
    this.strokeLine(4, TARGETING_PALETTE.beamShadow, 0.28, cx, cy + bracketGap, cx, cy + bracketGap + bracketLen);

    this.strokeLine(2, TARGETING_PALETTE.crossMain, 0.95, cx - bracketGap, cy, cx - bracketGap - bracketLen, cy);
    this.strokeLine(2, TARGETING_PALETTE.crossMain, 0.95, cx + bracketGap, cy, cx + bracketGap + bracketLen, cy);
    this.strokeLine(2, TARGETING_PALETTE.crossMain, 0.95, cx, cy - bracketGap, cx, cy - bracketGap - bracketLen);
    this.strokeLine(2, TARGETING_PALETTE.crossMain, 0.95, cx, cy + bracketGap, cx, cy + bracketGap + bracketLen);

    this.strokeLine(2, TARGETING_PALETTE.beamCore, 0.9, cx, cy - diamondRadius, cx + diamondRadius, cy);
    this.strokeLine(2, TARGETING_PALETTE.beamCore, 0.9, cx + diamondRadius, cy, cx, cy + diamondRadius);
    this.strokeLine(2, TARGETING_PALETTE.beamCore, 0.9, cx, cy + diamondRadius, cx - diamondRadius, cy);
    this.strokeLine(2, TARGETING_PALETTE.beamCore, 0.9, cx - diamondRadius, cy, cx, cy - diamondRadius);

    this.gfx.fillStyle(COLORS.GREY_1, 0.9);
    this.gfx.fillCircle(cx, cy, 2);
  }

  private drawGaussAimReticle(sx: number, sy: number, preview: UltimateChargePreviewState): void {
    const range = Math.max(0, preview.range ?? 0);
    const chargeFraction = Phaser.Math.Clamp(preview.chargeFraction, 0, 1);
    const color = preview.colorOverride ?? this.getAccentColor();
    const nx = Math.cos(preview.angle);
    const ny = Math.sin(preview.angle);
    const muzzle = getTopDownMuzzleOrigin(sx, sy, preview.angle);
    const beamLength = Math.max(10, range * chargeFraction);
    const ex = muzzle.x + nx * beamLength;
    const ey = muzzle.y + ny * beamLength;
    const clipped = this.clipToArena(muzzle.x, muzzle.y, ex, ey);
    const startX = this.snap(muzzle.x);
    const startY = this.snap(muzzle.y);
    const tx = this.snap(clipped.x);
    const ty = this.snap(clipped.y);
    const glowColor = this.mixWithWhite(color, 0.2);
    const coreColor = this.mixWithWhite(color, 0.62);
    const alpha = Math.max(0.04, chargeFraction * chargeFraction);
    const pulse = 0.92 + 0.08 * Math.sin(this.scene.time.now * 0.018);

    this.strokeLine(18, COLORS.GREY_10, 0.05 * alpha, startX, startY, tx, ty);
    this.strokeLine(14, glowColor, 0.14 * alpha * pulse, startX, startY, tx, ty);
    this.strokeLine(9, color, 0.3 * alpha * pulse, startX, startY, tx, ty);
    this.strokeLine(4, coreColor, 0.55 * alpha, startX, startY, tx, ty);
    this.strokeLine(2, 0xffffff, 0.9 * alpha, startX, startY, tx, ty);

    const emitterRadius = 6 + chargeFraction * 6;
    this.gfx.fillStyle(glowColor, 0.12 * alpha * pulse);
    this.gfx.fillCircle(startX, startY, emitterRadius * 2.1);
    this.gfx.fillStyle(color, 0.25 * alpha);
    this.gfx.fillCircle(startX, startY, emitterRadius * 1.3);
    this.gfx.fillStyle(0xffffff, 0.5 * alpha);
    this.gfx.fillCircle(startX, startY, Math.max(2, emitterRadius * 0.55));
  }

  private drawCrosshairArm(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    axis: 'horizontal' | 'vertical',
    dir: 1 | -1,
    frac: number,
    palette: SlotPalette,
    accentColor: number,
  ): void {
    const sx1 = this.snap(x1);
    const sy1 = this.snap(y1);
    const sx2 = this.snap(x2);
    const sy2 = this.snap(y2);

    this.strokeLine(CROSS_SHADOW_W, CROSS_SHADOW_COLOR, 0.30, sx1, sy1, sx2, sy2);
    this.strokeLine(CROSS_GLOW_W, palette.crossGlow, 0.18 + frac * 0.08, sx1, sy1, sx2, sy2);
    this.strokeLine(CROSS_LINE_W, palette.crossMain, 0.95, sx1, sy1, sx2, sy2);

    if (axis === 'horizontal') {
      this.strokeLine(2, accentColor, 0.88, sx2, sy2 - END_CAP_LEN, sx2, sy2 + END_CAP_LEN);
      this.strokeLine(1, accentColor, 0.94, sx2 - dir * 2, sy1, sx1 + dir * 2, sy1);
      return;
    }

    this.strokeLine(2, accentColor, 0.88, sx2 - END_CAP_LEN, sy2, sx2 + END_CAP_LEN, sy2);
    this.strokeLine(1, accentColor, 0.94, sx1, sy2 - dir * 2, sx1, sy1 + dir * 2);
  }

  private strokeSegmentedLine(
    width: number,
    color: number,
    baseAlpha: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;

    for (let index = 0; index < BEAM_SEGMENTS; index += 1) {
      const startT = index / BEAM_SEGMENTS;
      const endT = (index + 1) / BEAM_SEGMENTS;
      const midT = (startT + endT) * 0.5;
      const alpha = baseAlpha * this.getBeamFade(midT);
      if (alpha <= 0.01) continue;

      this.strokeLine(
        width,
        color,
        alpha,
        x1 + dx * startT,
        y1 + dy * startT,
        x1 + dx * endT,
        y1 + dy * endT,
      );
    }
  }

  private getBeamFade(progress: number): number {
    const fadeIn = this.smoothStep(0, BEAM_START_FADE_AT, progress);
    const fadeOut = this.smoothStep(1, BEAM_END_FADE_AT, progress);
    return Math.min(fadeIn, fadeOut);
  }

  private getAccentColor(): number {
    const playerColor = this.getPlayerColor();
    if (this.scene.time.now <= this.confirmedHitUntil) {
      return this.mixWithWhite(playerColor, 0.52);
    }
    return playerColor;
  }

  private mixWithWhite(color: number, amount: number): number {
    const mix = Phaser.Math.Clamp(amount, 0, 1);
    const red = (color >> 16) & 0xff;
    const green = (color >> 8) & 0xff;
    const blue = color & 0xff;

    const mixedRed = Math.round(red + (255 - red) * mix);
    const mixedGreen = Math.round(green + (255 - green) * mix);
    const mixedBlue = Math.round(blue + (255 - blue) * mix);
    return (mixedRed << 16) | (mixedGreen << 8) | mixedBlue;
  }

  private smoothStep(edge0: number, edge1: number, value: number): number {
    if (edge0 === edge1) {
      return value < edge0 ? 0 : 1;
    }

    const t = Phaser.Math.Clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  private strokeLine(width: number, color: number, alpha: number, x1: number, y1: number, x2: number, y2: number): void {
    this.gfx.lineStyle(width, color, alpha);
    this.gfx.beginPath();
    this.gfx.moveTo(x1, y1);
    this.gfx.lineTo(x2, y2);
    this.gfx.strokePath();
  }

  private snap(value: number): number {
    return Math.round(value);
  }

  private clipToArena(
    sx: number, sy: number,
    ex: number, ey: number,
  ): { x: number; y: number; inside: boolean } {
    const inside = ex >= AX1 && ex <= AX2 && ey >= AY1 && ey <= AY2;
    if (inside) return { x: ex, y: ey, inside: true };

    const dx = ex - sx;
    const dy = ey - sy;
    let t = 1;

    if (dx > 0) t = Math.min(t, (AX2 - sx) / dx);
    else if (dx < 0) t = Math.min(t, (AX1 - sx) / dx);

    if (dy > 0) t = Math.min(t, (AY2 - sy) / dy);
    else if (dy < 0) t = Math.min(t, (AY1 - sy) / dy);

    return { x: sx + t * dx, y: sy + t * dy, inside: false };
  }
}

export class UtilityChargeIndicator {
  private readonly container: Phaser.GameObjects.Container;
  private readonly anchorShadow: Phaser.GameObjects.Arc;
  private readonly anchorCore: Phaser.GameObjects.Arc;
  private readonly stemShadow: Phaser.GameObjects.Rectangle;
  private readonly stemCore: Phaser.GameObjects.Rectangle;
  private readonly barShadow: Phaser.GameObjects.Rectangle;
  private readonly barBg: Phaser.GameObjects.Rectangle;
  private readonly barFill: Phaser.GameObjects.Rectangle;
  private readonly barEdge: Phaser.GameObjects.Rectangle;
  private readonly barHatch: Phaser.GameObjects.Graphics;

  private livingEffect: LivingBarEffect | null = null;
  private currentEffectColor = 0;
  private wasVisible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getLocalSprite: () => Phaser.GameObjects.Image | undefined,
    private readonly getPlayerColor: () => number,
  ) {
    this.anchorShadow = scene.add.circle(CHARGE_ANCHOR_OFFSET_X, 0, 5, COLORS.GREY_10, 0.42);
    this.anchorCore = scene.add.circle(CHARGE_ANCHOR_OFFSET_X, 0, 2.5, COLORS.GREY_1, 0.95);

    this.stemShadow = scene.add.rectangle(CHARGE_ANCHOR_OFFSET_X + 1, 0, CHARGE_STEM_LENGTH + 2, 4, COLORS.GREY_10, 0.32);
    this.stemShadow.setOrigin(0, 0.5);
    this.stemCore = scene.add.rectangle(CHARGE_ANCHOR_OFFSET_X, 0, CHARGE_STEM_LENGTH, 2, COLORS.GREY_3, 0.9);
    this.stemCore.setOrigin(0, 0.5);

    this.barShadow = scene.add.rectangle(CHARGE_BAR_START_X + 1, 0, CHARGE_BAR_WIDTH + 2, CHARGE_BAR_HEIGHT + 2, COLORS.GREY_10, 0.38);
    this.barShadow.setOrigin(0, 0.5);
    this.barBg = scene.add.rectangle(CHARGE_BAR_START_X, 0, CHARGE_BAR_WIDTH, CHARGE_BAR_HEIGHT, COLORS.GREY_8, 0.92);
    this.barBg.setOrigin(0, 0.5);
    this.barFill = scene.add.rectangle(CHARGE_BAR_START_X, 0, 0, CHARGE_BAR_HEIGHT, this.getPlayerColor(), 0.95);
    this.barFill.setOrigin(0, 0.5);
    this.barEdge = scene.add.rectangle(CHARGE_BAR_START_X + CHARGE_BAR_WIDTH, 0, 2, CHARGE_BAR_HEIGHT + 2, COLORS.GREY_1, 0.75);
    this.barEdge.setOrigin(0.5, 0.5);
    this.barHatch = scene.add.graphics();

    this.container = scene.add.container(0, 0, [
      this.anchorShadow,
      this.anchorCore,
      this.stemShadow,
      this.stemCore,
      this.barShadow,
      this.barBg,
      this.barFill,
      this.barEdge,
      this.barHatch,
    ]);
    this.container.setDepth(14);
    this.container.setVisible(false);
  }

  /** Lazily create or recreate the LivingBarEffect when the color changes. */
  private ensureLivingEffect(color: number): void {
    if (this.livingEffect && this.currentEffectColor === color) return;
    if (this.livingEffect) this.livingEffect.destroy();
    const palette = paletteFromColor(color);
    // Bar top-left in container-local coords: (CHARGE_BAR_START_X, -CHARGE_BAR_HEIGHT/2)
    this.livingEffect = new LivingBarEffect(
      this.scene, this.container,
      CHARGE_BAR_START_X, -CHARGE_BAR_HEIGHT / 2,
      CHARGE_BAR_WIDTH, CHARGE_BAR_HEIGHT,
      palette,
    );
    this.currentEffectColor = color;
  }

  update(preview: UtilityChargePreviewState | UltimateChargePreviewState | undefined): void {
    const sprite = this.getLocalSprite();
    if (!preview || !sprite) {
      if (this.wasVisible && this.livingEffect) this.livingEffect.stop();
      this.wasVisible = false;
      this.container.setVisible(false);
      return;
    }

    const charge = Phaser.Math.Clamp(preview.chargeFraction, 0, 1);
    const playerColor = this.getPlayerColor();

    this.container.setVisible(true);
    this.container.setPosition(sprite.x, sprite.y);
    this.container.setRotation(preview.angle);
    this.barHatch.clear();

    if (preview.isBlocked) {
      this.anchorCore.setFillStyle(COLORS.GREY_3, 0.92);
      this.stemCore.setFillStyle(COLORS.GREY_4, 0.78);
      this.barFill.width = 0;
      this.barEdge.setAlpha(0.36);
      this.barBg.setFillStyle(COLORS.GREY_7, 0.94);
      if (this.livingEffect) this.livingEffect.stop();
      this.wasVisible = false;
      this.drawBlockedHatch();
      return;
    }

    const fillColor = preview.colorOverride ?? (preview.isGateCharge ? COLORS.GREEN_2 : playerColor);
    this.ensureLivingEffect(fillColor);

    if (!this.wasVisible && this.livingEffect) this.livingEffect.start();
    this.wasVisible = true;

    this.anchorCore.setFillStyle(fillColor, 0.98);
    this.stemCore.setFillStyle(fillColor, 0.72 + charge * 0.18);
    this.barBg.setFillStyle(COLORS.GREY_8, 0.92);
    this.barFill.setFillStyle(fillColor, 0.88 + charge * 0.10);
    this.barFill.width = CHARGE_BAR_WIDTH * charge;
    this.barEdge.setAlpha(0.4 + charge * 0.45);
    this.barBg.setAlpha(0.72 + charge * 0.16);

    if (this.livingEffect) this.livingEffect.setFilledWidth(CHARGE_BAR_WIDTH * charge);
  }

  private drawBlockedHatch(): void {
    const left = CHARGE_BAR_START_X;
    const right = CHARGE_BAR_START_X + CHARGE_BAR_WIDTH;
    const top = -CHARGE_BAR_HEIGHT / 2;
    const bottom = CHARGE_BAR_HEIGHT / 2;
    const spacing = 8;

    this.barHatch.lineStyle(2, COLORS.RED_2, 0.9);
    for (let start = left - CHARGE_BAR_HEIGHT; start < right + CHARGE_BAR_HEIGHT; start += spacing) {
      const x1 = Phaser.Math.Clamp(start, left, right);
      const y1 = Phaser.Math.Clamp(top + Math.max(left - start, 0), top, bottom);
      const x2 = Phaser.Math.Clamp(start + CHARGE_BAR_HEIGHT, left, right);
      const y2 = Phaser.Math.Clamp(bottom - Math.max(start + CHARGE_BAR_HEIGHT - right, 0), top, bottom);
      this.barHatch.beginPath();
      this.barHatch.moveTo(x1, y1);
      this.barHatch.lineTo(x2, y2);
      this.barHatch.strokePath();
    }
  }

  destroy(): void {
    if (this.livingEffect) this.livingEffect.destroy();
    this.container.destroy(true);
  }
}
