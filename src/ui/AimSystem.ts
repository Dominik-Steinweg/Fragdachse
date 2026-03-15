import Phaser from 'phaser';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import { AimSpreadModel } from './AimSpreadModel';
import type { PlayerAimNetState, WeaponSlot } from '../types';
import {
  COLORS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH,    ARENA_HEIGHT,
} from '../config';

// ── Visuelle Konstanten ────────────────────────────────────────────────────
const LASER_SHADOW_COLOR = COLORS.BLUE_6;
const LASER_GLOW_COLOR   = COLORS.BLUE_3;
const LASER_CORE_COLOR   = COLORS.BLUE_1;
const LASER_SHADOW_ALPHA = 0.22;
const LASER_GLOW_ALPHA   = 0.30;
const LASER_CORE_ALPHA   = 0.88;
const LASER_SHADOW_W     = 5;
const LASER_GLOW_W       = 3;
const LASER_CORE_W       = 1;

const CROSS_SHADOW_COLOR = COLORS.GREY_10;
const CROSS_MAIN_COLOR   = COLORS.GREY_1;
const CROSS_ACCENT_COLOR = COLORS.GOLD_1;
const CROSS_GLOW_COLOR   = COLORS.BLUE_2;
const CROSS_LINE_LEN     = 10;
const CROSS_LINE_W       = 2;
const CROSS_GAP_MIN      = 5;
const CROSS_GAP_MAX      = 28;
const CROSS_SHADOW_W     = 6;
const CROSS_GLOW_W       = 4;
const END_RING_MIN       = 6;
const END_RING_MAX       = 11;
const CENTER_DOT_MIN     = 2;
const CENTER_DOT_MAX     = 4;
const END_CAP_LEN        = 3;
const PULSE_SPEED        = 0.014;
const PULSE_AMOUNT       = 1.25;

// Bewegungserkennung: Mindest-Positionsänderung pro Frame in px
const MOVE_THRESHOLD = 0.3;

// ── Arena-Grenzen (gecacht) ────────────────────────────────────────────────
const AX1 = ARENA_OFFSET_X;
const AY1 = ARENA_OFFSET_Y;
const AX2 = ARENA_OFFSET_X + ARENA_WIDTH;
const AY2 = ARENA_OFFSET_Y + ARENA_HEIGHT;

/**
 * AimSystem – lokales Crosshair mit Prediction + optionaler Host-Reconciliation.
 *
 * Zeichnet jeden Frame:
 *   1. Laser-Linie: halbtransparente Linie vom Spieler zur Maus,
 *      auf die Reichweite (cfg.range) der aktiven Waffe gekürzt.
 *   2. Dynamisches Fadenkreuz: 4 Arme am Endpunkt; der Arm-Abstand wächst
 *      proportional zum aktuellen Gesamtspread (Basis + dynamischer Bloom).
 *
 * Clipping: Schusslinie und Fadenkreuz werden per Software auf die
 * Arena-Grenzen geclipt (kein GeometryMask, da dieser in Phaser 3 WebGL
 * das Objekt in zwei Render-Passes aufteilt → Doppelbild-Artefakt).
 * Da der Spieler stets innerhalb der Arena liegt, genügt es, den Endpunkt
 * parametrisch an die nächste Arena-Kante zu klemmen.
 *
 * Cursor-Management: In der Arena-Phase wird der System-Mauszeiger via
 * Phaser-API ausgeblendet; in der Lobby-Phase (inArena=false) ist er sichtbar.
 *
 * Die Spread-Logik lebt im AimSpreadModel:
 *   - lokale Prediction für direktes Feedback beim Schuss
 *   - autoritative Host-Snapshots zur Reconciliation
 *   - kein separater Host-/Client-Codepfad im AimSystem selbst
 */
export class AimSystem {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly spreadModel: AimSpreadModel;

  // Bewegungserkennung via Positions-Delta
  private prevX: number | null = null;  // null = noch nicht initialisiert
  private prevY: number | null = null;
  private prevShowAim = false;  // Flankenerkennung für prevX-Reset bei Respawn

  /**
   * @param scene           Phaser-Szene
   * @param getLocalSprite  Liefert das Sprite des lokalen Spielers (null wenn nicht vorhanden)
   * @param getWeaponConfig Liefert die aktuelle WeaponConfig des angegebenen Slots.
   *                        Prediction und Reconciliation teilen sich dieselbe Config-Quelle.
   */
  constructor(
    private readonly scene:            Phaser.Scene,
    private readonly getLocalSprite:   () => Phaser.GameObjects.Rectangle | undefined,
    private readonly getWeaponConfig:  (slot: WeaponSlot) => WeaponConfig,
  ) {
    this.gfx = scene.add.graphics();
    this.gfx.setDepth(14);  // unter Projektilen (15), über Spielern (10)
    this.spreadModel = new AimSpreadModel(getWeaponConfig);
  }

  /**
   * Aufrufen wenn der lokale Spieler eine Waffe betätigt.
   * Aktualisiert den aktiven Slot und simuliert lokal einen sofortigen Spread-Anstieg.
   * Autoritative Host-Daten korrigieren die Prediction später automatisch.
   */
  notifyShot(slot: WeaponSlot): void {
    this.spreadModel.notifyShot(slot);
  }

  setAuthoritativeState(state: PlayerAimNetState | undefined): void {
    this.spreadModel.setAuthoritativeState(state);
  }

  /**
   * Jeden Frame aufrufen.
   * @param showAim  true → Schusslinie + Fadenkreuz zeichnen (alive, nicht vergraben)
   * @param inArena  true → Arena-Phase aktiv; steuert die Cursor-Sichtbarkeit
   * @param delta    Frame-Delta in Millisekunden
   */
  update(showAim: boolean, inArena: boolean, delta: number): void {
    // ── Cursor-Sichtbarkeit ──────────────────────────────────────────────────
    // In der Arena verstecken, in der Lobby wieder zeigen.
    this.scene.input.setDefaultCursor(inArena ? 'none' : 'default');

    // ── Reset Positions-Baseline bei Respawn / erstem Sichtbarwerden ────────
    if (showAim && !this.prevShowAim) {
      this.prevX = null;
      this.prevY = null;
    }
    this.prevShowAim = showAim;

    this.gfx.clear();
    if (!showAim) return;

    // ── 1. Lokalen Spieler ermitteln ────────────────────────────────────────
    const sprite = this.getLocalSprite();
    if (!sprite) return;

    const sx = this.snap(sprite.x);
    const sy = this.snap(sprite.y);

    // ── 2. Bewegungserkennung via Positions-Delta ────────────────────────────
    let localIsMoving = false;
    if (this.prevX === null) {
      // Erster sichtbarer Frame nach (Re-)Spawn: Baseline setzen, kein falsches "isMoving"
      this.prevX    = sx;
      this.prevY    = sy;
    } else {
      localIsMoving = Math.abs(sx - this.prevX) > MOVE_THRESHOLD
                   || Math.abs(sy - (this.prevY ?? sy)) > MOVE_THRESHOLD;
      this.prevX = sx;
      this.prevY = sy;
    }

    this.spreadModel.setLocalMovement(localIsMoving);
    this.spreadModel.update(delta);

    // ── 4. Aktive Waffe: Config + Spread-Werte ───────────────────────────────
    const aimState = this.spreadModel.getResolvedState();
    const cfg = this.getWeaponConfig(aimState.activeSlot);

    // Basisspread (abhängig von Bewegungsstatus) + dynamischer Bloom = Gesamtspread
    const baseSpread  = aimState.isMoving ? cfg.spreadMoving : cfg.spreadStanding;
    const totalSpread = baseSpread + aimState.dynamicSpread;

    // Normierung: Gesamtspread / maximaler möglicher Gesamtspread → Fadenkreuz-Frac
    const maxTotal = cfg.spreadMoving + cfg.maxDynamicSpread;
    const frac     = maxTotal > 0 ? Math.min(1, totalSpread / maxTotal) : 0;

    // ── 5. Richtungsvektor + geklemmter Endpunkt ────────────────────────────
    const pointer = this.scene.input.activePointer;
    const px = pointer.x;
    const py = pointer.y;
    const dx = px - sx;
    const dy = py - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx   = dist > 0 ? dx / dist : 1;
    const ny   = dist > 0 ? dy / dist : 0;
    // Erster Clip: Reichweiten-Grenze (Waffe)
    const rangeDist = Math.min(dist, cfg.range);
    const ex = sx + nx * rangeDist;
    const ey = sy + ny * rangeDist;

    // Zweiter Clip: Arena-Grenze (Software-Clipping statt GeometryMask)
    // Startpunkt (Spieler) liegt immer innerhalb der Arena →
    // parametrisches Klemmen an die nächste überschrittene Kante.
    const { x: cx, y: cy, inside } = this.clipToArena(sx, sy, ex, ey);
    const tx = this.snap(cx);
    const ty = this.snap(cy);

    // ── 6. Laser-Linie ──────────────────────────────────────────────────────
    this.drawBeam(sx, sy, tx, ty, frac);

    // ── 7. Dynamisches Fadenkreuz (nur wenn Endpunkt innerhalb der Arena) ───
    if (!inside) return;

    this.drawCrosshair(tx, ty, frac);
  }

  /** Cursor wiederherstellen und Graphics-Objekt zerstören. */
  destroy(): void {
    this.scene.input.setDefaultCursor('default');
    this.gfx.destroy();
  }

  private drawBeam(sx: number, sy: number, ex: number, ey: number, frac: number): void {
    const beamGlowAlpha = LASER_GLOW_ALPHA + frac * 0.08;
    const beamCoreAlpha = LASER_CORE_ALPHA - frac * 0.12;

    this.strokeLine(LASER_SHADOW_W, LASER_SHADOW_COLOR, LASER_SHADOW_ALPHA, sx, sy, ex, ey);
    this.strokeLine(LASER_GLOW_W, LASER_GLOW_COLOR, beamGlowAlpha, sx, sy, ex, ey);
    this.strokeLine(LASER_CORE_W, LASER_CORE_COLOR, beamCoreAlpha, sx, sy, ex, ey);
  }

  private drawCrosshair(cx: number, cy: number, frac: number): void {
    const pulse = Math.sin(this.scene.time.now * PULSE_SPEED) * PULSE_AMOUNT;
    const gap = CROSS_GAP_MIN + frac * (CROSS_GAP_MAX - CROSS_GAP_MIN) + pulse * (0.35 + frac * 0.4);
    const ringRadius = END_RING_MIN + frac * (END_RING_MAX - END_RING_MIN) + pulse * 0.3;
    const dotSize = CENTER_DOT_MIN + frac * (CENTER_DOT_MAX - CENTER_DOT_MIN);

    this.strokeCircle(CROSS_SHADOW_W, CROSS_SHADOW_COLOR, 0.34, cx, cy, ringRadius + 1);
    this.strokeCircle(CROSS_GLOW_W, CROSS_GLOW_COLOR, 0.24 + frac * 0.12, cx, cy, ringRadius);
    this.strokeCircle(CROSS_LINE_W, CROSS_MAIN_COLOR, 0.95, cx, cy, ringRadius);

    this.gfx.fillStyle(CROSS_SHADOW_COLOR, 0.45);
    this.gfx.fillRect(cx - dotSize, cy - dotSize, dotSize * 2, dotSize * 2);
    this.gfx.fillStyle(CROSS_ACCENT_COLOR, 0.95);
    this.gfx.fillRect(cx - dotSize + 1, cy - dotSize + 1, Math.max(1, dotSize * 2 - 2), Math.max(1, dotSize * 2 - 2));

    this.drawCrosshairArm(cx + gap, cy, cx + gap + CROSS_LINE_LEN, cy, 'horizontal', 1, frac);
    this.drawCrosshairArm(cx - gap, cy, cx - gap - CROSS_LINE_LEN, cy, 'horizontal', -1, frac);
    this.drawCrosshairArm(cx, cy + gap, cx, cy + gap + CROSS_LINE_LEN, 'vertical', 1, frac);
    this.drawCrosshairArm(cx, cy - gap, cx, cy - gap - CROSS_LINE_LEN, 'vertical', -1, frac);
  }

  private drawCrosshairArm(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    axis: 'horizontal' | 'vertical',
    dir: 1 | -1,
    frac: number,
  ): void {
    const sx1 = this.snap(x1);
    const sy1 = this.snap(y1);
    const sx2 = this.snap(x2);
    const sy2 = this.snap(y2);

    this.strokeLine(CROSS_SHADOW_W, CROSS_SHADOW_COLOR, 0.34, sx1, sy1, sx2, sy2);
    this.strokeLine(CROSS_GLOW_W, CROSS_GLOW_COLOR, 0.22 + frac * 0.10, sx1, sy1, sx2, sy2);
    this.strokeLine(CROSS_LINE_W, CROSS_MAIN_COLOR, 0.95, sx1, sy1, sx2, sy2);

    if (axis === 'horizontal') {
      const capX = sx2;
      this.strokeLine(2, CROSS_ACCENT_COLOR, 0.9, capX, sy2 - END_CAP_LEN, capX, sy2 + END_CAP_LEN);
      this.strokeLine(1, CROSS_ACCENT_COLOR, 0.95, capX - dir * 2, sy1, sx1 + dir * 2, sy1);
      return;
    }

    const capY = sy2;
    this.strokeLine(2, CROSS_ACCENT_COLOR, 0.9, sx2 - END_CAP_LEN, capY, sx2 + END_CAP_LEN, capY);
    this.strokeLine(1, CROSS_ACCENT_COLOR, 0.95, sx1, capY - dir * 2, sx1, sy1 + dir * 2);
  }

  private strokeLine(width: number, color: number, alpha: number, x1: number, y1: number, x2: number, y2: number): void {
    this.gfx.lineStyle(width, color, alpha);
    this.gfx.beginPath();
    this.gfx.moveTo(x1, y1);
    this.gfx.lineTo(x2, y2);
    this.gfx.strokePath();
  }

  private strokeCircle(width: number, color: number, alpha: number, x: number, y: number, radius: number): void {
    this.gfx.lineStyle(width, color, alpha);
    this.gfx.strokeCircle(x, y, Math.max(1, radius));
  }

  private snap(value: number): number {
    return Math.round(value);
  }

  // ── Privat: Software-Clipping ─────────────────────────────────────────────

  /**
   * Klemmt den Endpunkt (ex, ey) einer Linie ab (sx, sy) an die Arena-Grenzen.
   * (sx, sy) muss innerhalb der Arena liegen.
   *
   * @returns geklemmter Endpunkt + `inside`: true wenn (ex,ey) innerhalb der Arena lag.
   */
  private clipToArena(
    sx: number, sy: number,
    ex: number, ey: number,
  ): { x: number; y: number; inside: boolean } {
    const inside = ex >= AX1 && ex <= AX2 && ey >= AY1 && ey <= AY2;
    if (inside) return { x: ex, y: ey, inside: true };

    // Parametrisch: Linie P(t) = (sx,sy) + t * (dx,dy), t ∈ [0,1]
    // Suche kleinstes t, bei dem die Linie eine Arena-Kante erreicht.
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
