import { runtimeTextureFrame } from '../assets/RuntimeAtlases';
import type * as Phaser from 'phaser';
import { drawModalFrame, MODAL_FRAME_ASSET } from './ForestModal';
import { roundRectPath, lerpColor } from './uiTextures';
import { UPGRADE_CATEGORY_FRAME, UPGRADE_XP_FRAME, UPGRADE_APPLY } from './UpgradeForestAssets';
import { ensureForestActionButton } from './forestTextures';

/** Source and destination insets describe the authored opening, not transparent outer margins. */
function drawSlicedFrame(ctx: CanvasRenderingContext2D, image: HTMLImageElement, w: number, h: number,
  sourceX: number, sourceY: number, capX: number, capY: number): void {
  const sx = [0, sourceX, image.width - sourceX], sy = [0, sourceY, image.height - sourceY];
  const sw = [sourceX, image.width - sourceX * 2, sourceX], sh = [sourceY, image.height - sourceY * 2, sourceY];
  const dx = [0, capX, w - capX], dy = [0, capY, h - capY];
  const dw = [capX, w - capX * 2, capX], dh = [capY, h - capY * 2, capY];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    if (x === 1 && y === 1) continue;
    ctx.drawImage(image, sx[x], sy[y], sw[x], sh[y], dx[x], dy[y], dw[x], dh[y]);
  }
}

export function ensureUpgradeXpFrame(scene: Phaser.Scene, barW: number, barH: number): string {
  const ready = scene.textures.exists(UPGRADE_XP_FRAME.key);
  const w = barW + 10, h = barH + 10;
  const key = `_upgrade_xp_v2_${ready}_${w}_${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w, h)!;
  if (ready) drawSlicedFrame(texture.context, scene.textures.get(UPGRADE_XP_FRAME.key).getSourceImage() as HTMLImageElement,
    w, h, 20, 22, 5, 5);
  else drawUpgradeFrame(scene, texture.context, w, h, .2);
  texture.refresh();
  return key;
}

export function ensureUpgradeApply(scene: Phaser.Scene, w: number, h: number): string {
  if (!scene.textures.exists(UPGRADE_APPLY.key)) return ensureForestActionButton(scene, w, h, 'ready', 'primary', 'rest');
  const key = `_upgrade_apply_v2_${w}_${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w, h)!;
  texture.context.drawImage(scene.textures.get(UPGRADE_APPLY.key).getSourceImage() as HTMLImageElement, 0, 0, w, h);
  texture.refresh();
  return key;
}

const cssColor = (value: number) => '#' + value.toString(16).padStart(6, '0');
const rgba = (value: number, alpha: number) =>
  `rgba(${(value >> 16) & 0xff},${(value >> 8) & 0xff},${value & 0xff},${alpha})`;

/**
 * Insets keep glass inside the timber, including the rounded corner cutouts. `tinted` gives a
 * card its accent colour, so every category column stays recognisable while inactive.
 */
export function ensureUpgradeSurface(scene: Phaser.Scene, w: number, h: number,
  accent: number, active: boolean, card = false, tinted = false): string {
  const ready = scene.textures.exists(UPGRADE_CATEGORY_FRAME.key);
  const key = `_upgrade_surface_v4_${ready}_${w}_${h}_${accent}_${active}_${card}_${tinted}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w, h)!;
  const ctx = texture.context;
  const idleTint = tinted && card && !active;
  let top = 0x202a24, bottom = 0x101913;
  if (active && !card) {
    top = lerpColor(accent, 0xd4e8a1, .52); bottom = lerpColor(accent, 0x536333, .55);
  } else if (active) {
    top = tinted ? lerpColor(accent, 0x344331, .58) : 0x344331; bottom = tinted ? lerpColor(accent, 0x101913, .78) : 0x101913;
  } else if (idleTint) {
    top = lerpColor(accent, 0x1a241d, .84); bottom = lerpColor(accent, 0x0d140f, .92);
  }
  const gradient = ctx.createLinearGradient(0, 6, 0, h - 6);
  gradient.addColorStop(0, cssColor(top));
  gradient.addColorStop(1, cssColor(bottom));
  roundRectPath(ctx, 5, 5, w - 10, h - 10, 9);
  ctx.fillStyle = gradient;
  ctx.fill();
  if (active) {
    ctx.strokeStyle = '#d6e9a2'; ctx.lineWidth = 2;
    ctx.stroke();
  } else if (idleTint) {
    ctx.strokeStyle = rgba(accent, .35); ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (ready) drawSlicedFrame(ctx, scene.textures.get(UPGRADE_CATEGORY_FRAME.key).getSourceImage() as HTMLImageElement,
    w, h, 140, 60, 24, 12);
  else drawUpgradeFrame(scene, ctx, w, h, .25);
  texture.refresh();
  return key;
}

const REGISTER_TAB_RADIUS = 11;
const REGISTER_FLARE_RADIUS = 9;
const REGISTER_PANEL_RADIUS = 18;

/** Horizontaler Verlauf, der zu den Enden ausblendet und zwischen `from` und `to` voll leuchtet. */
function horizontalFade(ctx: CanvasRenderingContext2D, x0: number, x1: number, from: number, to: number,
  color: number, peak: number, shoulder: number): CanvasGradient {
  const span = Math.max(1, x1 - x0);
  const a = clamp01((from - x0) / span), b = clamp01((to - x0) / span);
  const gradient = ctx.createLinearGradient(x0, 0, x1, 0);
  gradient.addColorStop(0, rgba(color, 0));
  gradient.addColorStop(a * .45, rgba(color, shoulder));
  gradient.addColorStop(a, rgba(color, peak));
  gradient.addColorStop(b, rgba(color, peak));
  gradient.addColorStop(b + (1 - b) * .55, rgba(color, shoulder));
  gradient.addColorStop(1, rgba(color, 0));
  return gradient;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Geschlossener Register-Tab: nur oben gerundet, die Unterkante verschwindet hinter dem Blatt.
 * Farbe und Kante laufen als Verlauf von oben nach unten aus, statt harte Linien zu ziehen.
 */
export function ensureUpgradeRegisterTab(scene: Phaser.Scene, w: number, h: number, accent: number): string {
  const key = `_upgrade_register_tab_v2_${w}_${h}_${accent}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w, h)!;
  const ctx = texture.context;
  const r = REGISTER_TAB_RADIUS;
  const outline = (): void => {
    ctx.beginPath();
    ctx.moveTo(1, h);
    ctx.lineTo(1, r + 1);
    ctx.arcTo(1, 1, r + 1, 1, r);
    ctx.lineTo(w - r - 1, 1);
    ctx.arcTo(w - 1, 1, w - 1, r + 1, r);
    ctx.lineTo(w - 1, h);
  };
  outline();
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, rgba(lerpColor(accent, 0x1a241d, .42), .95));
  fill.addColorStop(.55, rgba(lerpColor(accent, 0x111a14, .76), .95));
  fill.addColorStop(1, rgba(lerpColor(accent, 0x0d140f, .88), .95));
  ctx.fillStyle = fill;
  ctx.fill();
  outline();
  const edge = ctx.createLinearGradient(0, 0, 0, h);
  edge.addColorStop(0, rgba(lerpColor(accent, 0xffffff, .35), .75));
  edge.addColorStop(.6, rgba(accent, .18));
  edge.addColorStop(1, rgba(accent, 0));
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  texture.refresh();
  return key;
}

/** Geometrie eines Register-Blatts in Texturkoordinaten; `sheetTop` ist die Oberkante des Blatts. */
export interface UpgradeRegisterSheet {
  width: number;
  height: number;
  sheetLeft: number;
  sheetTop: number;
  sheetRight: number;
  sheetBottom: number;
  tabLeft: number;
  tabRight: number;
  tabTop: number;
  accent: number;
}

/**
 * Zeichnet aktiven Tab und Baumflaeche als eine einzige Form: Der Tab waechst ohne Trennlinie
 * aus dem Blatt heraus und leuchtet in seiner Kategoriefarbe hinein. Kanten sind Verlaeufe: Die
 * Oberkante leuchtet am Tab und blendet zu den Seiten aus, das Blatt laeuft nach unten weich aus.
 * Das Blatt ist gross; der Aufrufer haelt deshalb nur die Textur des offenen Tabs am Leben.
 */
export function ensureUpgradeRegisterSheet(scene: Phaser.Scene, key: string, sheet: UpgradeRegisterSheet): string {
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, sheet.width, sheet.height)!;
  const ctx = texture.context;
  const { sheetLeft: left, sheetTop: top, sheetRight: right, sheetBottom: bottom,
    tabLeft, tabRight, tabTop, accent } = sheet;
  const R = REGISTER_PANEL_RADIUS, r = REGISTER_TAB_RADIUS, f = REGISTER_FLARE_RADIUS;
  const topContour = (): void => {
    ctx.moveTo(left, top + R);
    ctx.arcTo(left, top, left + R, top, R);
    ctx.lineTo(tabLeft - f, top);
    ctx.arcTo(tabLeft, top, tabLeft, top - f, f);
    ctx.lineTo(tabLeft, tabTop + r);
    ctx.arcTo(tabLeft, tabTop, tabLeft + r, tabTop, r);
    ctx.lineTo(tabRight - r, tabTop);
    ctx.arcTo(tabRight, tabTop, tabRight, tabTop + r, r);
    ctx.lineTo(tabRight, top - f);
    ctx.arcTo(tabRight, top, tabRight + f, top, f);
    ctx.lineTo(right - R, top);
    ctx.arcTo(right, top, right, top + R, R);
  };
  const outline = (): void => {
    ctx.beginPath();
    topContour();
    ctx.lineTo(right, bottom - R);
    ctx.arcTo(right, bottom, right - R, bottom, R);
    ctx.lineTo(left + R, bottom);
    ctx.arcTo(left, bottom, left, bottom - R, R);
    ctx.closePath();
  };

  // Grundflaeche: dunkles Glas, das zum unteren Rand hin weich in den Wald ausblendet.
  const base = lerpColor(0x0d1510, accent, .05);
  const body = ctx.createLinearGradient(0, tabTop, 0, bottom);
  const fadeStart = clamp01((bottom - 110 - tabTop) / Math.max(1, bottom - tabTop));
  body.addColorStop(0, rgba(base, .84));
  body.addColorStop(fadeStart, rgba(base, .8));
  body.addColorStop(1, rgba(base, .38));
  outline();
  ctx.fillStyle = body;
  ctx.fill();

  ctx.save();
  outline();
  ctx.clip();
  const tabCenter = (tabLeft + tabRight) / 2;
  const tabW = tabRight - tabLeft;
  // Der aktive Tab ist beleuchtet. Der lineare Anteil endet exakt an der Blattkante bei Alpha 0,
  // ein durchgehendes elliptisches Licht ueberbrueckt den Uebergang ohne sichtbare Naht.
  const tabLight = ctx.createLinearGradient(0, tabTop, 0, top);
  tabLight.addColorStop(0, rgba(lerpColor(accent, 0xffffff, .15), .42));
  tabLight.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = tabLight;
  ctx.fillRect(tabLeft, tabTop, tabW, top - tabTop);
  ctx.save();
  ctx.translate(tabCenter, tabTop + (top - tabTop) / 2);
  ctx.scale(1, .42);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, tabW);
  glow.addColorStop(0, rgba(accent, .26));
  glow.addColorStop(.55, rgba(accent, .1));
  glow.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(-tabW, -tabW, tabW * 2, tabW * 2);
  ctx.restore();
  // Seitenkanten als Lichtkante, die von oben nach unten ausblendet.
  const sideFade = ctx.createLinearGradient(0, top, 0, top + (bottom - top) * .55);
  sideFade.addColorStop(0, rgba(accent, .22));
  sideFade.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = sideFade;
  ctx.fillRect(left, top, 2, bottom - top);
  ctx.fillRect(right - 2, top, 2, bottom - top);
  ctx.restore();

  // Oberkante: leuchtet am offenen Tab und laeuft zu beiden Seiten weich aus.
  const edgeColor = lerpColor(accent, 0xf2f7da, .35);
  ctx.save();
  ctx.beginPath();
  topContour();
  ctx.shadowColor = rgba(accent, .6);
  ctx.shadowBlur = 10;
  ctx.strokeStyle = horizontalFade(ctx, left, right, tabLeft, tabRight, edgeColor, .95, .32);
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();

  texture.refresh();
  return key;
}

/** Cache desaturated UI copies; original weapon and upgrade artwork stays untouched. */
export function ensureUpgradeIcon(scene: Phaser.Scene, source: string, active: boolean, locked: boolean): string {
  if (active) return source;
  const key = `_upgrade_muted_v2_${source}_${locked}`;
  if (scene.textures.exists(key)) return key;
  const frame = runtimeTextureFrame(scene.textures, source);
  const texture = scene.textures.createCanvas(key, frame.cutWidth, frame.cutHeight)!;
  const ctx = texture.context;
  ctx.drawImage(frame.source.image as HTMLImageElement, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
    0, 0, frame.cutWidth, frame.cutHeight);
  const pixels = ctx.getImageData(0, 0, frame.cutWidth, frame.cutHeight);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const grey = pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722;
    for (let channel = 0; channel < 3; channel++) {
      pixels.data[i + channel] = locked ? grey * .62 : pixels.data[i + channel] * .72 + grey * .28;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  texture.refresh();
  return key;
}

/** Shared wood rails at a consistent small scale, without stretching the corner ornaments. */
export function drawUpgradeFrame(scene: Phaser.Scene, ctx: CanvasRenderingContext2D,
  w: number, h: number, scale = .28): void {
  if (!scene.textures.exists(MODAL_FRAME_ASSET.key)) return;
  ctx.save();
  ctx.scale(scale, scale);
  drawModalFrame(ctx, scene.textures.get(MODAL_FRAME_ASSET.key).getSourceImage() as HTMLImageElement,
    w / scale, h / scale);
  ctx.restore();
}

export function ensureUpgradeFrame(scene: Phaser.Scene, w: number, h: number): string {
  const key = `_upgrade_frame_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w, h)!;
  drawUpgradeFrame(scene, texture.context, w, h, .45);
  texture.refresh();
  return key;
}
