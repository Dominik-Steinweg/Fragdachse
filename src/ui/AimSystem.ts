import Phaser from 'phaser';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import { AimSpreadModel } from './AimSpreadModel';
import type { PlayerAimNetState, UtilityChargePreviewState, WeaponSlot } from '../types';
import {
  COLORS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH,    ARENA_HEIGHT,
} from '../config';

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
const CHARGE_STRIKE_X = CHARGE_BAR_START_X + CHARGE_BAR_WIDTH * 0.5;

export class AimSystem {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly spreadModel: AimSpreadModel;

  private prevX: number | null = null;
  private prevY: number | null = null;
  private prevShowAim = false;
  private confirmedHitUntil = 0;

  constructor(
    private readonly scene:           Phaser.Scene,
    private readonly getLocalSprite:  () => Phaser.GameObjects.Rectangle | undefined,
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

  update(showAim: boolean, inArena: boolean, delta: number): void {
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
    const totalSpread = baseSpread + aimState.dynamicSpread;
    const maxTotal = cfg.spreadMoving + cfg.maxDynamicSpread;
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

    const { x: cx, y: cy, inside } = this.clipToArena(sx, sy, ex, ey);
    const tx = this.snap(cx);
    const ty = this.snap(cy);

    this.drawBeam(sx, sy, tx, ty, palette, frac);

    if (!inside) return;

    this.drawCrosshair(tx, ty, frac, palette, this.getAccentColor());
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
  private readonly barStrikeShadow: Phaser.GameObjects.Rectangle;
  private readonly barStrikeCore: Phaser.GameObjects.Rectangle;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getLocalSprite: () => Phaser.GameObjects.Rectangle | undefined,
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
    this.barStrikeShadow = scene.add.rectangle(CHARGE_STRIKE_X, 0, CHARGE_BAR_WIDTH + 10, 5, COLORS.GREY_10, 0.82);
    this.barStrikeShadow.setAngle(-23);
    this.barStrikeCore = scene.add.rectangle(CHARGE_STRIKE_X, 0, CHARGE_BAR_WIDTH + 8, 2, COLORS.RED_2, 0.92);
    this.barStrikeCore.setAngle(-23);

    this.container = scene.add.container(0, 0, [
      this.anchorShadow,
      this.anchorCore,
      this.stemShadow,
      this.stemCore,
      this.barShadow,
      this.barBg,
      this.barFill,
      this.barEdge,
      this.barStrikeShadow,
      this.barStrikeCore,
    ]);
    this.container.setDepth(14);
    this.container.setVisible(false);
  }

  update(preview: UtilityChargePreviewState | undefined): void {
    const sprite = this.getLocalSprite();
    if (!preview || !sprite) {
      this.container.setVisible(false);
      return;
    }

    const charge = Phaser.Math.Clamp(preview.chargeFraction, 0, 1);
    const playerColor = this.getPlayerColor();

    this.container.setVisible(true);
    this.container.setPosition(sprite.x, sprite.y);
    this.container.setRotation(preview.angle);

    if (preview.isBlocked) {
      this.anchorCore.setFillStyle(COLORS.GREY_3, 0.92);
      this.stemCore.setFillStyle(COLORS.GREY_4, 0.78);
      this.barFill.width = 0;
      this.barEdge.setAlpha(0.36);
      this.barBg.setFillStyle(COLORS.GREY_7, 0.94);
      this.barStrikeShadow.setVisible(true);
      this.barStrikeCore.setVisible(true);
      return;
    }

    this.anchorCore.setFillStyle(playerColor, 0.98);
    this.stemCore.setFillStyle(playerColor, 0.72 + charge * 0.18);
    this.barBg.setFillStyle(COLORS.GREY_8, 0.92);
    this.barFill.setFillStyle(playerColor, 0.88 + charge * 0.10);
    this.barFill.width = CHARGE_BAR_WIDTH * charge;
    this.barEdge.setAlpha(0.4 + charge * 0.45);
    this.barBg.setAlpha(0.72 + charge * 0.16);
    this.barStrikeShadow.setVisible(false);
    this.barStrikeCore.setVisible(false);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
