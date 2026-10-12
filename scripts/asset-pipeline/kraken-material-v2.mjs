import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inside, resizeMaster } from './export.mjs';

export const krakenNormalEncoding = 'linear-unorm8-z-oct-normal-v1';
export function validateKrakenMaterial(m) {
  if (!m.materialPass) {
    if (m.elevationPass?.encoding === krakenNormalEncoding || m.shadowMesh) throw Error('Packed Kraken data requires material semantics');
    return;
  }
  const p = m.materialPass;
  if (p.version !== 1 || p.color !== 'srgb-albedo-baked-cavity-v1' || p.normal !== krakenNormalEncoding
    || p.emission !== 'linear-rgb-unorm8-scaled-v1' || p.emissionRange !== 8
    || p.worldPxPerBU !== m.targetSize * (m.displayScale ?? 1) / m.orthoScale
    || m.elevationPass?.encoding !== krakenNormalEncoding || m.shadowMesh?.version !== 1
    || m.shadowMesh.encoding !== 'u16-world-xyz-per-pose-v1' || m.shadowMesh.frames.length !== m.frames.length) throw Error('Invalid Kraken material/mesh semantics');
  for (const f of m.frames) {
    if (f.material?.encoding !== krakenNormalEncoding || f.material.worldPxPerBU !== p.worldPxPerBU
      || JSON.stringify(f.material.mesh) !== JSON.stringify(m.shadowMesh.frames[f.index])
      || f.material.heightGeometryBU[0] <= m.elevation.min || f.material.heightGeometryBU[1] >= m.elevation.max) throw Error('Invalid Kraken material pose mapping/range');
  }
}
export async function readKrakenPasses(folder, frame) {
  const passes = {};
  for (const [key, record] of Object.entries(frame.material.passes)) {
    const data = await readFile(inside(folder, record.file));
    if (data.length !== record.bytes || createHash('sha256').update(data).digest('hex') !== record.sha256) throw Error('Kraken material master changed');
    if (key.endsWith('Png')) passes[key] = data;
  }
  for (const key of ['positions', 'indices']) {
    const record = frame.material.mesh[key], data = await readFile(inside(folder, record.file));
    if (data.length !== record.bytes || createHash('sha256').update(data).digest('hex') !== record.sha256) throw Error('Kraken mesh master changed');
  }
  return passes;
}
export function decodeOct(x, y) {
  x = x * 2 - 1; y = y * 2 - 1;
  const z = 1 - Math.abs(x) - Math.abs(y), t = Math.max(0, -z);
  x += x >= 0 ? -t : t; y += y >= 0 ? -t : t;
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}
export function encodeOct(x, y, z) {
  const length = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  x /= length; y /= length;
  if (z < 0) { const a = x; x = (1 - Math.abs(y)) * (a < 0 ? -1 : 1); y = (1 - Math.abs(a)) * (y < 0 ? -1 : 1); }
  return [Math.round((x * .5 + .5) * 255), Math.round((y * .5 + .5) * 255)];
}
/** Decode before averaging: octahedral seams must never be interpolated as GB. */
export async function resizeKrakenElevation(input, beauty, size) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const coverage = await sharp(await resizeMaster(beauty, size)).raw().toBuffer(), out = Buffer.alloc(size * size * 4);
  const ratio = info.width / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = [0, 0, 0], x0 = x * ratio, y0 = y * ratio, x1 = x0 + ratio, y1 = y0 + ratio;
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
      const i = (sy * info.width + sx) * 4, weight = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy)) * data[i + 3];
      const normal = decodeOct(data[i + 1] / 255, data[i + 2] / 255);
      normal.forEach((v, c) => n[c] += v * weight);
    }
    const i = (y * size + x) * 4, nearest = (Math.min(info.height - 1, Math.floor(y0 + ratio / 2)) * info.width + Math.min(info.width - 1, Math.floor(x0 + ratio / 2))) * 4;
    const oct = encodeOct(...n);
    out[i] = data[nearest]; out[i + 1] = oct[0]; out[i + 2] = oct[1]; out[i + 3] = coverage[i + 3];
  }
  return sharp(out, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}
/** Emission is linear data, never sRGB-resized; sparse coverage is kept for compact atlases. */
export async function resizeKrakenEmission(input, size) {
  return sharp(input).resize(size, size, { kernel: 'nearest' }).png().toBuffer();
}

const linear = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
const srgb = x => x <= .0031308 ? x * 12.92 : 1.055 * Math.max(0, x) ** (1 / 2.4) - .055;
/** One constant fit per asset, using opaque purple mantle pixels of its rest pose.
 * Four 45-degree azimuths prevent baking a preferred light direction into the fit.
 */
export async function calibrateKrakenMaterial(albedo, packed, beauty, size, exposure, mantleBounds = null) {
  const [a, n, b] = await Promise.all([albedo, packed, beauty].map(p => sharp(p).raw().toBuffer()));
  const samples = [], reference = [];
  for (let i = 0; i < b.length; i += 4) {
    const rgb = [b[i], b[i + 1], b[i + 2]].map(v => v / 255), max = Math.max(...rgb), min = Math.min(...rgb);
    // Exclude pale suction rims, emissive eyes/core and antialiasing; retain dark dermis/AO.
    if (b[i + 3] < 254 || max < .04 || max > .72 || rgb[2] < rgb[1] * 1.12 || (max - min) / max < .18) continue;
    const x = i / 4 % size, y = Math.floor(i / 4 / size), j = (Math.floor(y / 2) * (size / 2) + Math.floor(x / 2)) * 4;
    if (mantleBounds && (x / size < mantleBounds[0] || x / size > mantleBounds[2]
      || y / size < mantleBounds[1] || y / size > mantleBounds[3])) continue;
    const normal = decodeOct(n[j + 1] / 255, n[j + 2] / 255);
    reference.push(rgb);
    for (const azimuth of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const factor = (.2 + Math.max(0, (normal[0] * Math.cos(azimuth) - normal[1] * Math.sin(azimuth) + normal[2]) * Math.SQRT1_2)) / (.2 + Math.SQRT1_2);
      samples.push([0, 1, 2].map(c => linear(a[i + c] / 255) * factor));
    }
  }
  if (samples.length < 32) return { exposure, tint: [1, 1, 1], saturation: 1, calibration: { samples: 0, reason: 'No mantle ROI (egg/emission)' } };
  const stats = values => {
    let luminance = 0, saturation = 0, red = 0, blue = 0;
    for (const c of values) {
      const max = Math.max(...c), min = Math.min(...c);
      luminance += linear(c[0]) * .2126 + linear(c[1]) * .7152 + linear(c[2]) * .0722;
      saturation += max > 0 ? (max - min) / max : 0; red += c[0]; blue += c[2];
    }
    return [luminance / values.length, saturation / values.length, red / Math.max(1e-8, blue)];
  };
  const target = stats(reference), params = [1, 1, 1];
  const measure = () => stats(samples.map(c => {
    const color = [c[0] * params[2], c[1], c[2]], l = color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
    return color.map(v => Math.max(0, Math.min(1, srgb(l + (v - l) * params[1]) * params[0])));
  }));
  for (let iteration = 0; iteration < 6; iteration++) for (const axis of [0, 1, 2]) {
    let low = .25, high = 2;
    for (let step = 0; step < 13; step++) {
      params[axis] = (low + high) / 2;
      if (measure()[axis] < target[axis]) low = params[axis]; else high = params[axis];
    }
  }
  return { exposure: exposure * params[0], tint: [params[2], 1, 1], saturation: params[1],
    calibration: { method: 'Rest opaque purple dermis; four azimuths, elevation 45 degrees; linear luminance, HSV saturation, R/B ratio',
      mantleBounds, samples: reference.length, beauty: target, material: measure() } };
}
