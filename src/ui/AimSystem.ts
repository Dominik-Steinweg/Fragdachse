import * as Phaser from 'phaser';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import { AimSpreadModel } from './AimSpreadModel';
import { AimVisuals, type SlotPalette } from './AimVisuals';
import type { PlayerAimNetState, UltimateChargePreviewState, UtilityChargePreviewState, UtilityTargetingPreviewState, WeaponSlot } from '../types';
import {
  COLORS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH,    ARENA_HEIGHT,
  DEPTH_AIM,
  getTopDownMuzzleOrigin,
} from '../config';
import { LivingBarEffect, paletteFromColor } from './LivingBarEffect';
import { getUnshakenPointerWorldPoint } from '../graphics/cameraBaseScroll';

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
// Reine Darstellungswerte (Strichstaerken, Querschnitte, Ausblendungen) stecken in `AimVisuals`,
// weil sie dort die gebackenen Texturen definieren. Hier bleibt, was pro Frame berechnet wird.
const HIT_FLASH_MS        = 100;

// Fadenkreuz – Punkt + Spread-Ring
const RING_GAP_MIN       = 5;    // Ringradius bei 0 % Spread
const RING_GAP_MAX       = 20;   // Ringradius bei 100 % Spread
const RING_BASE_ALPHA    = 0.08; // Ringalpha ohne Spread
const RING_SPREAD_ALPHA  = 0.14; // Zusatzalpha bei vollem Spread
const PULSE_SPEED        = 0.005;
const PULSE_AMP          = 0.025;

const MOVE_THRESHOLD = 0.3;

const CHARGE_ANCHOR_OFFSET_X = 18;
const CHARGE_STEM_LENGTH = 12;
const CHARGE_BAR_GAP = 6;
const CHARGE_BAR_WIDTH = 52;
const CHARGE_BAR_HEIGHT = 8;
const CHARGE_BAR_START_X = CHARGE_ANCHOR_OFFSET_X + CHARGE_STEM_LENGTH + CHARGE_BAR_GAP;

/**
 * Zielhilfe des lokalen Spielers. Diese Klasse rechnet nur noch: Spread, Richtung, Reichweite,
 * Ladezustand und Trefferblitz. Die Darstellung uebernimmt `AimVisuals` mit langlebigen Images
 * auf gebackenen Texturen – siehe dort, warum Immediate-Mode-Bogen teuer sind.
 */
export class AimSystem {
  private readonly visuals: AimVisuals;
  private readonly spreadModel: AimSpreadModel;

  private prevX: number | null = null;
  private prevY: number | null = null;
  private prevShowAim = false;
  private appliedCursor: string | null = null;
  private confirmedHitUntil = 0;
  private scopeProgress = 0;
  private weaponChargeProgress = 0;

  constructor(
    private readonly scene:           Phaser.Scene,
    private readonly getLocalSprite:  () => Phaser.GameObjects.Image | undefined,
    private readonly getWeaponConfig: (slot: WeaponSlot) => WeaponConfig,
    private readonly getPlayerColor:  () => number,
  ) {
    this.visuals = new AimVisuals(scene);
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

  setScopeProgress(progress: number): void {
    this.scopeProgress = progress;
  }

  /**
   * Zielen mit einer Scope-Waffe uebernimmt sofort das Fadenkreuz von Waffe 2 –
   * inklusive Ladebalken –, auch wenn zuletzt mit Waffe 1 geschossen wurde.
   */
  setScoping(scoping: boolean): void {
    if (scoping) this.spreadModel.setActiveSlot('weapon2');
  }

  setWeaponChargeProgress(progress: number): void {
    this.weaponChargeProgress = Phaser.Math.Clamp(progress, 0, 1);
  }

  update(
    showAim: boolean,
    hideSystemCursor: boolean,
    delta: number,
    utilityTargeting?: UtilityTargetingPreviewState,
    ultimatePreview?: UltimateChargePreviewState,
  ): void {
    // Nur bei Wechsel setzen: der Aufruf schreibt in den Canvas-Style und ist kein No-Op.
    const cursor = hideSystemCursor ? 'none' : 'default';
    if (cursor !== this.appliedCursor) {
      this.scene.input.setDefaultCursor(cursor);
      this.appliedCursor = cursor;
    }

    if (showAim && !this.prevShowAim) {
      this.prevX = null;
      this.prevY = null;
    }
    this.prevShowAim = showAim;

    // Versteckt alle Visuals. Steht bewusst vor jedem Early Return, damit kein Zweig etwas
    // stehen lassen kann – dieselbe Rolle, die frueher `gfx.clear()` hatte.
    this.visuals.beginFrame();
    if (!showAim) return;

    const sprite = this.getLocalSprite();
    if (!sprite) return;

    const sx = this.snap(sprite.x);
    const sy = this.snap(sprite.y);

    if (utilityTargeting) {
      const tx = this.snap(utilityTargeting.targetX);
      const ty = this.snap(utilityTargeting.targetY);
      this.visuals.showTargetingReticle(tx, ty);
      return;
    }

    if (ultimatePreview?.reticleStyle === 'gauss' && ultimatePreview.range) {
      this.showGaussAimReticle(sx, sy, ultimatePreview);
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
    const pointerWorld = getUnshakenPointerWorldPoint(this.scene, pointer);
    const px = pointerWorld.x;
    const py = pointerWorld.y;
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

    const accentColor = this.getAccentColor();

    if (cfg.showCrosshair !== false && this.scopeProgress < 0.1) {
      this.visuals.showBeam(sx, sy, tx, ty, palette, frac);

      if (dist > cfg.range) {
        const rx = sx + nx * cfg.range;
        const ry = sy + ny * cfg.range;
        if (
          rx >= ARENA_OFFSET_X
          && rx <= ARENA_OFFSET_X + ARENA_WIDTH
          && ry >= ARENA_OFFSET_Y
          && ry <= ARENA_OFFSET_Y + ARENA_HEIGHT
        ) {
          this.visuals.showRangeTick(this.snap(rx), this.snap(ry), nx, ny, accentColor);
        }
      }
    }

    // Bewusst ausserhalb des Crosshair-/Scope-Guards: Ring und Mittelpunkt bleiben auch bei
    // `showCrosshair: false` und im Scope sichtbar.
    this.showCrosshair(this.snap(px), this.snap(py), frac, palette, accentColor);
    if ((cfg.awpCharge?.maxDamageBonus ?? 0) > 0 && this.weaponChargeProgress > 0) {
      this.showWeaponChargeRing(this.snap(px), this.snap(py), frac, this.weaponChargeProgress, palette);
    }
  }

  getGraphicsCommandCount(): number {
    return this.visuals.getGraphicsCommandCount();
  }

  destroy(): void {
    this.scene.input.setDefaultCursor('default');
    this.appliedCursor = 'default';
    this.visuals.destroy();
  }

  private showCrosshair(
    cx: number,
    cy: number,
    frac: number,
    palette: SlotPalette,
    accentColor: number,
  ): void {
    const gap   = RING_GAP_MIN + frac * (RING_GAP_MAX - RING_GAP_MIN);
    const pulse = 1 + PULSE_AMP * Math.sin(this.scene.time.now * PULSE_SPEED);
    const isHit = this.scene.time.now <= this.confirmedHitUntil;

    const ringR     = gap * 1.1;
    const ringColor = isHit ? accentColor : palette.crossGlow;
    const ringAlpha = isHit
      ? Math.min(0.85, (RING_BASE_ALPHA + frac * RING_SPREAD_ALPHA) * 5.5)
      : (RING_BASE_ALPHA + frac * RING_SPREAD_ALPHA) * pulse;

    this.visuals.showCrosshair(cx, cy, ringR, ringColor, ringAlpha, accentColor);
  }

  private showWeaponChargeRing(
    cx: number,
    cy: number,
    spreadFrac: number,
    chargeFrac: number,
    palette: SlotPalette,
  ): void {
    const spreadRadius = (RING_GAP_MIN + spreadFrac * (RING_GAP_MAX - RING_GAP_MIN)) * 1.1;
    const radius = spreadRadius + 8;
    const full = chargeFrac >= 0.999;
    const pulse = full ? 0.78 + Math.sin(this.scene.time.now * 0.012) * 0.16 : 0.68;
    const color = full ? 0xff6a2b : palette.crossMain;

    this.visuals.showChargeRing(cx, cy, radius, chargeFrac, palette, color, pulse, full);
  }

  private showGaussAimReticle(sx: number, sy: number, preview: UltimateChargePreviewState): void {
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
    const coreColor = this.mixWithWhite(color, 0.62);
    const alpha = Math.max(0.04, chargeFraction * chargeFraction);
    const pulse = 0.92 + 0.08 * Math.sin(this.scene.time.now * 0.018);
    const clippedLength = Math.hypot(tx - startX, ty - startY);

    this.visuals.showGauss(
      startX,
      startY,
      preview.angle,
      clippedLength,
      color,
      coreColor,
      alpha,
      pulse,
      6 + chargeFraction * 6,
    );
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

  private snap(value: number): number {
    return Math.round(value);
  }

  private clipToArena(
    sx: number, sy: number,
    ex: number, ey: number,
  ): { x: number; y: number; inside: boolean } {
    const minX = ARENA_OFFSET_X;
    const minY = ARENA_OFFSET_Y;
    const maxX = ARENA_OFFSET_X + ARENA_WIDTH;
    const maxY = ARENA_OFFSET_Y + ARENA_HEIGHT;
    const inside = ex >= minX && ex <= maxX && ey >= minY && ey <= maxY;
    if (inside) return { x: ex, y: ey, inside: true };

    const dx = ex - sx;
    const dy = ey - sy;
    let t = 1;

    if (dx > 0) t = Math.min(t, (maxX - sx) / dx);
    else if (dx < 0) t = Math.min(t, (minX - sx) / dx);

    if (dy > 0) t = Math.min(t, (maxY - sy) / dy);
    else if (dy < 0) t = Math.min(t, (minY - sy) / dy);

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
    this.container.setDepth(DEPTH_AIM);
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
