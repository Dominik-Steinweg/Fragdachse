/**
 * uiTextures — geteilte Canvas-Texturen fuer einen einheitlichen, modernen UI-Look.
 *
 * Stellt abgerundete Rechteck-Texturen mit Verlauf, Glanz-Highlight und farbiger
 * Kontur bereit. Wird vom Upgrade-Overlay-Stil abgeleitet und in der Lobby sowie
 * den Overlays (Options, Help) verwendet, damit ueberall der gleiche Look entsteht.
 */
import * as Phaser from 'phaser';
import { rgbStr } from './LivingBarEffect';

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export interface RoundedTextureParams {
  key: string;
  w: number;
  h: number;
  radius: number;
  topColor: number;
  bottomColor: number;
  fillAlpha: number;
  strokeColor: number;
  strokeAlpha: number;
  strokeWidth: number;
  highlightAlpha: number;
}

/** Erzeugt (oder liefert gecacht) eine abgerundete Rechteck-Textur mit Verlauf + Glanz. */
export function ensureRoundedTexture(scene: Phaser.Scene, params: RoundedTextureParams): string {
  if (scene.textures.exists(params.key)) return params.key;

  const w = Math.max(1, Math.round(params.w));
  const h = Math.max(1, Math.round(params.h));
  const ct = scene.textures.createCanvas(params.key, w, h);
  if (!ct) return params.key;
  const ctx = ct.context;
  ctx.clearRect(0, 0, w, h);

  const inset = Math.max(1, params.strokeWidth);
  const rectW = w - inset * 2;
  const rectH = h - inset * 2;

  roundRectPath(ctx, inset, inset, rectW, rectH, params.radius);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, rgbStr(params.topColor, params.fillAlpha));
  grad.addColorStop(1, rgbStr(params.bottomColor, params.fillAlpha));
  ctx.fillStyle = grad;
  ctx.fill();

  if (params.highlightAlpha > 0) {
    ctx.save();
    roundRectPath(ctx, inset, inset, rectW, rectH, params.radius);
    ctx.clip();
    const hi = ctx.createLinearGradient(0, 0, 0, h * 0.55);
    hi.addColorStop(0, `rgba(255,255,255,${params.highlightAlpha})`);
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hi;
    ctx.fillRect(0, 0, w, h * 0.55);
    ctx.restore();
  }

  if (params.strokeAlpha > 0) {
    roundRectPath(ctx, inset, inset, rectW, rectH, params.radius);
    ctx.lineWidth = params.strokeWidth;
    ctx.strokeStyle = rgbStr(params.strokeColor, params.strokeAlpha);
    ctx.stroke();
  }

  ct.refresh();
  return params.key;
}

/** Modale Hauptflaeche: dunkler Verlauf, dezenter Goldrand, leichter Glanz oben. */
export function ensureModalPanelTexture(
  scene: Phaser.Scene, key: string, w: number, h: number,
  baseColor: number, accentColor: number,
): string {
  return ensureRoundedTexture(scene, {
    key, w, h,
    radius: 22,
    topColor: lerpColor(baseColor, 0xffffff, 0.07),
    bottomColor: lerpColor(baseColor, 0x000000, 0.3),
    fillAlpha: 0.96,
    strokeColor: accentColor,
    strokeAlpha: 0.5,
    strokeWidth: 2,
    highlightAlpha: 0.05,
  });
}

/** Glaenzender, drueckbarer Button in der angegebenen Grundfarbe. */
export function ensureGlossyButtonTexture(
  scene: Phaser.Scene, key: string, w: number, h: number,
  baseColor: number, strokeColor?: number,
): string {
  return ensureRoundedTexture(scene, {
    key, w, h,
    radius: 11,
    topColor: lerpColor(baseColor, 0xffffff, 0.16),
    bottomColor: lerpColor(baseColor, 0x000000, 0.30),
    fillAlpha: 0.97,
    strokeColor: strokeColor ?? lerpColor(baseColor, 0xffffff, 0.12),
    strokeAlpha: 0.9,
    strokeWidth: 2,
    highlightAlpha: 0.24,
  });
}

/** Flache, eingefasste Sektions-/Listenflaeche (kein Glanz -> wirkt nicht drueckbar). */
export function ensureFlatPanelTexture(
  scene: Phaser.Scene, key: string, w: number, h: number,
  fillColor: number, strokeColor: number,
  opts?: { radius?: number; fillAlpha?: number; strokeAlpha?: number },
): string {
  return ensureRoundedTexture(scene, {
    key, w, h,
    radius: opts?.radius ?? 12,
    topColor: lerpColor(fillColor, 0xffffff, 0.04),
    bottomColor: lerpColor(fillColor, 0x000000, 0.18),
    fillAlpha: opts?.fillAlpha ?? 0.9,
    strokeColor,
    strokeAlpha: opts?.strokeAlpha ?? 0.5,
    strokeWidth: 1.5,
    highlightAlpha: 0,
  });
}

/** Sektions-Panel mit dezenter Farb-Toenung + farbigem Rand (wie der Upgrade-Inhaltsbereich). */
export function ensureTintedSectionTexture(
  scene: Phaser.Scene, key: string, w: number, h: number,
  color: number, baseDark: number,
): string {
  if (scene.textures.exists(key)) return key;

  const iw = Math.max(1, Math.round(w));
  const ih = Math.max(1, Math.round(h));
  const ct = scene.textures.createCanvas(key, iw, ih);
  if (!ct) return key;
  const ctx = ct.context;
  ctx.clearRect(0, 0, iw, ih);

  const radius = 16;
  const inset = 1.5;
  const rectW = iw - inset * 2;
  const rectH = ih - inset * 2;

  roundRectPath(ctx, inset, inset, rectW, rectH, radius);
  const grad = ctx.createLinearGradient(0, 0, 0, ih);
  grad.addColorStop(0, rgbStr(lerpColor(baseDark, color, 0.22), 0.92));
  grad.addColorStop(1, rgbStr(lerpColor(baseDark, color, 0.06), 0.96));
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.save();
  roundRectPath(ctx, inset, inset, rectW, rectH, radius);
  ctx.clip();
  const rad = ctx.createRadialGradient(iw / 2, ih * 0.02, 0, iw / 2, ih * 0.02, iw * 0.62);
  rad.addColorStop(0, rgbStr(color, 0.16));
  rad.addColorStop(1, rgbStr(color, 0));
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, iw, ih);
  ctx.restore();

  roundRectPath(ctx, inset, inset, rectW, rectH, radius);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgbStr(color, 0.4);
  ctx.stroke();

  ct.refresh();
  return key;
}
