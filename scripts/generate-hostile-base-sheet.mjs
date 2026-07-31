import { Jimp } from 'jimp';
import * as path from 'path';

/**
 * Erzeugt `base47blob_hostile.png` als rote Variante des blauen Basis-Tilesets.
 *
 * Warum ein eigenes Sheet statt `setTint(rot)`: das Quell-Tileset ist gesaettigt blau, und
 * Phasers Standard-Tint multipliziert – blau mal rot ergibt nahezu Schwarz. Deshalb wird die
 * Farbe hier im Farbtonraum gedreht: Helligkeit und Struktur bleiben exakt erhalten, nur der
 * Farbton wandert nach Rot. Nahezu neutrale Pixel (die dunkle Kontur) bleiben unberuehrt, damit
 * die Umrisse nicht ausbleichen.
 *
 * Aufruf: node scripts/generate-hostile-base-sheet.mjs
 */

const SOURCE = path.join('public', 'assets', 'sprites', 'base47blob.png');
const TARGET = path.join('public', 'assets', 'sprites', 'base47blob_hostile.png');

/** Zielfarbton in Grad (0 = Rot). Leicht ins Orange gezogen, damit es nicht ins Magenta kippt. */
const TARGET_HUE = 4;
/** Unterhalb dieser Saettigung gilt ein Pixel als neutral und bleibt unveraendert. */
const NEUTRAL_SATURATION = 0.12;
/** Rot wirkt bei gleicher Saettigung dunkler als Blau; ein leichter Zuschlag gleicht das aus. */
const SATURATION_GAIN = 1.08;

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function hueToRgbChannel(p, q, t) {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = (((h % 360) + 360) % 360) / 360;
  return {
    r: Math.round(hueToRgbChannel(p, q, hn + 1 / 3) * 255),
    g: Math.round(hueToRgbChannel(p, q, hn) * 255),
    b: Math.round(hueToRgbChannel(p, q, hn - 1 / 3) * 255),
  };
}

const image = await Jimp.read(SOURCE);
image.scan(0, 0, image.bitmap.width, image.bitmap.height, function scanPixel(_x, _y, idx) {
  const data = this.bitmap.data;
  if (data[idx + 3] < 8) return;

  const { h, s, l } = rgbToHsl(data[idx], data[idx + 1], data[idx + 2]);
  if (s < NEUTRAL_SATURATION) return;

  const { r, g, b } = hslToRgb(TARGET_HUE, Math.min(1, s * SATURATION_GAIN), l);
  data[idx] = r;
  data[idx + 1] = g;
  data[idx + 2] = b;
  void h;
});

await image.write(TARGET);
console.log(`[generate-hostile-base-sheet] ${TARGET} (${image.bitmap.width}x${image.bitmap.height})`);
