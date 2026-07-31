import * as Phaser from 'phaser';
import { COLORS } from '../config';
import type { CoopDefenseItemSlot } from '../types';
import { rgbStr } from './LivingBarEffect';
import { ensureRoundedTexture, lerpColor, roundRectPath } from './uiTextures';

/**
 * Item-Symbole und Seltenheits-Rahmen fuer Inventar und Belohnungsauswahl.
 *
 * Die Symbole sind **Platzhalter**: flache, orthografische Top-down-Silhouetten aus Canvas-Pfaden,
 * bewusst ohne Perspektive oder sichtbare Objektseiten. Sobald echte Grafiken existieren, reicht es,
 * eine Textur `coop_item_<slot>` zu laden – `resolveCoopDefenseItemIconTexture()` nimmt sie dann
 * automatisch statt des Platzhalters. Das ist der einzige Austauschpunkt.
 */

const ICON_KEY_PREFIX = '_cdi_icon';
const CELL_KEY_PREFIX = '_cdi_cell';

/** Texturname einer spaeteren echten Item-Grafik – gleiche Konvention wie bei Loadout-Icons. */
export function getCoopDefenseItemArtKey(slot: CoopDefenseItemSlot): string {
  return `coop_item_${slot}`;
}

export function resolveCoopDefenseItemIconTexture(
  scene: Phaser.Scene,
  slot: CoopDefenseItemSlot,
  size: number,
): string {
  const artKey = getCoopDefenseItemArtKey(slot);
  if (scene.textures.exists(artKey)) return artKey;
  return ensureCoopDefenseItemIconTexture(scene, slot, size);
}

/** Zellenrahmen in Seltenheitsfarbe. `variant` trennt Ruhe-, Hover- und Leer-Zustand im Cache. */
export function ensureCoopDefenseItemCellTexture(
  scene: Phaser.Scene,
  w: number,
  h: number,
  color: number,
  variant: 'rest' | 'hot' | 'empty' = 'rest',
): string {
  return ensureRoundedTexture(scene, {
    // ensureRoundedTexture cached ausschliesslich ueber den Key: Farbe, Groesse und Zustand
    // muessen deshalb alle darin stehen.
    key: `${CELL_KEY_PREFIX}_${variant}_${color.toString(16)}_${w}x${h}`,
    w,
    h,
    radius: 10,
    topColor: variant === 'hot' ? lerpColor(COLORS.GREY_8, color, 0.22) : COLORS.GREY_9,
    bottomColor: variant === 'hot' ? lerpColor(COLORS.GREY_9, color, 0.1) : COLORS.GREY_10,
    fillAlpha: variant === 'empty' ? 0.55 : 0.95,
    strokeColor: color,
    strokeAlpha: variant === 'empty' ? 0.35 : 0.95,
    strokeWidth: variant === 'hot' ? 3 : 2.5,
    highlightAlpha: variant === 'hot' ? 0.12 : 0.04,
  });
}

export function ensureCoopDefenseItemIconTexture(
  scene: Phaser.Scene,
  slot: CoopDefenseItemSlot,
  size: number,
): string {
  const key = `${ICON_KEY_PREFIX}_${slot}_${Math.round(size)}`;
  if (scene.textures.exists(key)) return key;

  const s = Math.max(8, Math.round(size));
  const canvas = scene.textures.createCanvas(key, s, s);
  if (!canvas) return key;
  const ctx = canvas.context;
  ctx.clearRect(0, 0, s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  DRAW_BY_SLOT[slot](ctx, s);

  canvas.refresh();
  return key;
}

// ── Zeichnen ────────────────────────────────────────────────────────────────
// Alle Formen liegen in normalisierten Koordinaten (0..1) und werden mit `s` skaliert, damit
// dieselbe Silhouette in jeder Zellgroesse identisch aussieht.

const PLATE = COLORS.GREY_3;
const PLATE_LIGHT = COLORS.GREY_2;
const PLATE_DARK = COLORS.GREY_5;
const SEAM = COLORS.GREY_6;

function fill(ctx: CanvasRenderingContext2D, color: number, alpha = 1): void {
  ctx.fillStyle = rgbStr(color, alpha);
  ctx.fill();
}

function stroke(ctx: CanvasRenderingContext2D, color: number, width: number, alpha = 1): void {
  ctx.strokeStyle = rgbStr(color, alpha);
  ctx.lineWidth = width;
  ctx.stroke();
}

function ellipse(
  ctx: CanvasRenderingContext2D, s: number,
  cx: number, cy: number, rx: number, ry: number,
): void {
  ctx.beginPath();
  ctx.ellipse(cx * s, cy * s, rx * s, ry * s, 0, 0, Math.PI * 2);
  ctx.closePath();
}

function line(
  ctx: CanvasRenderingContext2D, s: number,
  x1: number, y1: number, x2: number, y2: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x1 * s, y1 * s);
  ctx.lineTo(x2 * s, y2 * s);
}

/** Helm von oben: Kuppel mit Mittelkamm und angedeutetem Nackenschutz. */
function drawHelmet(ctx: CanvasRenderingContext2D, s: number): void {
  ellipse(ctx, s, 0.5, 0.54, 0.34, 0.38);
  fill(ctx, PLATE);
  stroke(ctx, PLATE_DARK, s * 0.035);

  ellipse(ctx, s, 0.5, 0.48, 0.24, 0.27);
  fill(ctx, PLATE_LIGHT, 0.85);

  ctx.beginPath();
  roundRectPath(ctx, 0.455 * s, 0.16 * s, 0.09 * s, 0.7 * s, 0.045 * s);
  fill(ctx, PLATE_DARK);

  line(ctx, s, 0.2, 0.74, 0.8, 0.74);
  stroke(ctx, SEAM, s * 0.05, 0.9);
}

/** Handschuhe von oben: zwei Faeustlinge nebeneinander, Daumen nach aussen. */
function drawGloves(ctx: CanvasRenderingContext2D, s: number): void {
  const hand = (offsetX: number, thumbDir: number): void => {
    ctx.beginPath();
    roundRectPath(ctx, (offsetX - 0.115) * s, 0.24 * s, 0.23 * s, 0.5 * s, 0.09 * s);
    fill(ctx, PLATE);
    stroke(ctx, PLATE_DARK, s * 0.03);

    ellipse(ctx, s, offsetX + thumbDir * 0.15, 0.52, 0.06, 0.1);
    fill(ctx, PLATE_DARK);

    ctx.beginPath();
    roundRectPath(ctx, (offsetX - 0.115) * s, 0.63 * s, 0.23 * s, 0.11 * s, 0.05 * s);
    fill(ctx, SEAM, 0.9);

    line(ctx, s, offsetX - 0.06, 0.28, offsetX - 0.06, 0.58);
    stroke(ctx, PLATE_LIGHT, s * 0.025, 0.7);
    line(ctx, s, offsetX + 0.06, 0.28, offsetX + 0.06, 0.58);
    stroke(ctx, PLATE_LIGHT, s * 0.025, 0.7);
  };
  hand(0.29, -1);
  hand(0.71, 1);
}

/** Ruestung von oben: Brustplatte mit Schulterstuecken und Mittelnaht. */
function drawArmor(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0.5 * s, 0.14 * s);
  ctx.lineTo(0.84 * s, 0.3 * s);
  ctx.lineTo(0.78 * s, 0.74 * s);
  ctx.lineTo(0.5 * s, 0.88 * s);
  ctx.lineTo(0.22 * s, 0.74 * s);
  ctx.lineTo(0.16 * s, 0.3 * s);
  ctx.closePath();
  fill(ctx, PLATE);
  stroke(ctx, PLATE_DARK, s * 0.035);

  ellipse(ctx, s, 0.19, 0.3, 0.1, 0.09);
  fill(ctx, PLATE_LIGHT);
  ellipse(ctx, s, 0.81, 0.3, 0.1, 0.09);
  fill(ctx, PLATE_LIGHT);

  ellipse(ctx, s, 0.5, 0.42, 0.12, 0.1);
  fill(ctx, PLATE_LIGHT, 0.9);

  line(ctx, s, 0.5, 0.2, 0.5, 0.84);
  stroke(ctx, SEAM, s * 0.045, 0.9);
}

/** Stiefel von oben: zwei Sohlen mit Absatzkante und Schaftriemen. */
function drawBoots(ctx: CanvasRenderingContext2D, s: number): void {
  const boot = (offsetX: number): void => {
    ctx.beginPath();
    roundRectPath(ctx, (offsetX - 0.11) * s, 0.16 * s, 0.22 * s, 0.68 * s, 0.1 * s);
    fill(ctx, PLATE);
    stroke(ctx, PLATE_DARK, s * 0.03);

    ellipse(ctx, s, offsetX, 0.32, 0.08, 0.1);
    fill(ctx, PLATE_LIGHT, 0.85);

    ctx.beginPath();
    roundRectPath(ctx, (offsetX - 0.11) * s, 0.6 * s, 0.22 * s, 0.1 * s, 0.04 * s);
    fill(ctx, SEAM, 0.9);

    line(ctx, s, offsetX - 0.09, 0.78, offsetX + 0.09, 0.78);
    stroke(ctx, PLATE_DARK, s * 0.04, 0.85);
  };
  boot(0.3);
  boot(0.7);
}

const DRAW_BY_SLOT: Record<CoopDefenseItemSlot, (ctx: CanvasRenderingContext2D, s: number) => void> = {
  helmet: drawHelmet,
  gloves: drawGloves,
  armor: drawArmor,
  boots: drawBoots,
};
