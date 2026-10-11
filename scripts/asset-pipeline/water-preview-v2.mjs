// Static CPU counterpart of submersionShader.ts, for disposable authoring sheets.
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import ts from 'typescript';
import { resizeMaster } from './export.mjs';
import { resizeElevation } from './elevation-v2.mjs';

export function waterOptions(spec, options = {}, saved = {}) {
  const value = options.waterLevel ?? saved.waterLevel ?? spec.elevation?.previewWaterLevel ?? 0;
  const waterLevel = typeof value === 'string' && value.trim() ? Number(value) : value;
  const waterMask = options.waterMask ?? saved.waterMask ?? 'all';
  if (!Number.isFinite(waterLevel)) throw new Error('--water-level / elevation.previewWaterLevel muss endlich sein (BU).');
  if (!['all', 'half'].includes(waterMask)) throw new Error('--water-mask muss all oder half sein.');
  return { waterLevel, waterMask };
}

// Read only numeric literals from the actual defaults; never import Phaser or
// execute source code. Unsupported future expressions fail instead of drifting.
export async function submersionDefaults() {
  const file = new URL('../../src/effects/kraken/submersionShader.ts', import.meta.url);
  const source = ts.createSourceFile(file.pathname, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.filter(ts.isVariableStatement)
    .flatMap(s => [...s.declarationList.declarations]).find(d => d.name.getText(source) === 'SUBMERSION_DEFAULTS');
  function literal(node) {
    if (node && ts.isAsExpression(node)) return literal(node.expression);
    if (node && ts.isNumericLiteral(node)) return Number(node.text);
    if (node && ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return -literal(node.operand);
    if (node && ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (node && ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(p => {
      if (!ts.isPropertyAssignment(p)) throw new Error('Unsupported submersion default');
      return [p.name.getText(source), literal(p.initializer)];
    }));
    throw new Error('SUBMERSION_DEFAULTS must contain numeric literals');
  }
  return literal(declaration?.initializer);
}

const clamp = n => Math.max(0, Math.min(1, n));
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = x => x - Math.floor(x);
const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smoothstep(0, 1, fract(x)), fy = smoothstep(0, 1, fract(y));
  return mix(mix(hash(ix, iy), hash(ix + 1, iy), fx), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx), fy);
}

// Bilinear premultiplied texture sampling, returned as straight RGB. PNG height
// is already straight non-color data: unlike GLSL it must NOT be divided by alpha.
function refractedRgb(data, size, x, y, fallback) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = fract(x), fy = fract(y);
  const rgba = [0, 0, 0, 0];
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const sx = Math.max(0, Math.min(size - 1, ix + dx)), sy = Math.max(0, Math.min(size - 1, iy + dy));
    const i = (sy * size + sx) * 4, weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy), a = data[i + 3] / 255;
    for (let c = 0; c < 3; c++) rgba[c] += data[i + c] / 255 * a * weight;
    rgba[3] += a * weight;
  }
  return rgba[3] > .001 ? rgba.slice(0, 3).map(v => v / rgba[3]) : fallback;
}

/** Opaque pond/land tile. displaySize stays nominal even in the enlarged view. */
export async function waterTile(beauty, elevation, encoding, size, displaySize, options, p) {
  if (!Number.isFinite(encoding.min) || !Number.isFinite(encoding.max) || encoding.min >= encoding.max) throw new Error('Invalid preview elevation range');
  const [bm, em] = await Promise.all([beauty, elevation].map(file => sharp(file).metadata()));
  if (bm.width !== em.width || bm.height !== em.height) throw new Error('Elevation and Beauty canvas differ');
  const [b, e] = await Promise.all([
    resizeMaster(beauty, size).then(input => sharp(input).ensureAlpha().raw().toBuffer()),
    resizeElevation(elevation, beauty, size).then(input => sharp(input).ensureAlpha().raw().toBuffer()),
  ]);
  const output = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, u = (x + .5) / size, v = (y + .5) / size;
    const water = options.waterMask !== 'half' || u < .5;
    // Quiet flat midpoint of the viewer pond palette; land marks the dry mask.
    const background = water ? [.035, .1625, .1675] : [.30, .33, .21];
    let rgb = [b[i] / 255, b[i + 1] / 255, b[i + 2] / 255], alpha = b[i + 3] / 255;
    if (water && alpha > 0 && e[i + 3] / 255 > .001) {
      const d = options.waterLevel - mix(encoding.min, encoding.max, e[i] / 255);
      if (d > 0) {
        const f = 1 - Math.exp(-d / Math.max(p.depthFalloff, .0001));
        const shift = Math.min(p.refractionPx, 2) * .70710678 * f * size / Math.max(displaySize, 1);
        // Shader UV Y points up; logical/image Y points down. Time is fixed at 0.
        rgb = refractedRgb(b, size, x + Math.sin(v * 37) * shift, y - Math.cos(u * 31) * shift, rgb);
        const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
        rgb = rgb.map((c, k) => mix(mix(mix(c, luminance, p.desaturation * f), p.shallowColor[k], p.shallowTint * f), p.deepColor[k], f));
        alpha *= 1 - smoothstep(p.fadeStart, p.fadeEnd, d);
      } else {
        const wet = 1 - smoothstep(0, p.wetBand, -d);
        const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
        rgb = rgb.map(c => mix(luminance, c, 1 + p.wetSaturation * wet) * (1 - p.wetDarkening * wet));
      }
      const foam = (1 - smoothstep(0, p.foamBand, Math.abs(d))) * p.foamOpacity
        * smoothstep(.25, .65, noise(u * displaySize * .16, v * displaySize * .16));
      rgb = rgb.map((c, k) => mix(c, p.foamColor[k], foam));
    }
    for (let c = 0; c < 3; c++) output[i + c] = Math.round(255 * mix(background[c], clamp(rgb[c]), alpha));
    output[i + 3] = 255;
  }
  return sharp(output, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}
