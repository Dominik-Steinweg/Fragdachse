// Offline authoring/export only. Run from any cwd: node scripts/export-dawn-night.mjs
import sharp from 'sharp';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proof = path.join(root, 'art/poc/dawn/fx');
const destination = path.join(root, 'public/assets/sprites/dawn-night');
const runtime = path.join(destination, 'runtime');
const clamp = x => Math.max(0, Math.min(1, x));
const mod = (x, n) => ((x % n) + n) % n;
const smooth = x => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const mix = (a, b, t) => a + (b - a) * t;
const byte = x => Math.round(clamp(x) * 255);
const sha = b => createHash('sha256').update(b).digest('hex');
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Independent random gradient angles; no reflected quadrants or copied subtiles.
function gradientNoise(seed, frequency) {
  const r = rng(seed);
  const gradients = Array.from({ length: frequency ** 2 }, () => {
    const a = r() * Math.PI * 2; return [Math.cos(a), Math.sin(a)];
  });
  return (x, y) => {
    x = mod(x, 1) * frequency; y = mod(y, 1) * frequency;
    const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy;
    const dot = (ox, oy) => {
      const g = gradients[mod(iy + oy, frequency) * frequency + mod(ix + ox, frequency)];
      return g[0] * (dx - ox) + g[1] * (dy - oy);
    };
    return mix(mix(dot(0, 0), dot(1, 0), smooth(dx)), mix(dot(0, 1), dot(1, 1), smooth(dx)), smooth(dy));
  };
}
function octaveField(seed, frequencies, weights) {
  const layers = frequencies.map((f, i) => gradientNoise(seed + i * 1301, f));
  return (x, y) => layers.reduce((s, n, i) => s + weights[i] * n(x + .173 * i, y + .319 * i), 0);
}
function cloudField() {
  const wx = octaveField(48629, [3, 7, 13], [.65, .25, .10]);
  const wy = octaveField(93011, [4, 9, 17], [.65, .25, .10]);
  const wx2 = gradientNoise(67219, 5), wy2 = gradientNoise(18973, 6);
  const density = octaveField(82763, [3, 6, 11, 19, 31], [.48, .29, .15, .06, .02]);
  return (x, y) => {
    const u = x + .14 * wx(x, y), v = y + .14 * wy(x, y);
    const a = u + .055 * wx2(u, v), b = v + .055 * wy2(u, v);
    // Soft continuous density rather than thresholded, recognizable puff silhouettes.
    return smooth(.43 + density(a, b) * .85);
  };
}

// T-5 edge-vignette-02 field, evaluated at the target resolution, never upscaled.
function valueNoise(seed, n) {
  const r = rng(seed), grid = Array.from({ length: n * n }, r);
  return (x, y) => {
    x = mod(x, 1) * n; y = mod(y, 1) * n;
    const ix = Math.floor(x), iy = Math.floor(y), u = smooth(x - ix), v = smooth(y - iy);
    const at = (i, j) => grid[mod(j, n) * n + mod(i, n)];
    return mix(mix(at(ix, iy), at(ix + 1, iy), u), mix(at(ix, iy + 1), at(ix + 1, iy + 1), u), v);
  };
}
function edgeField() {
  const fields = [4, 8, 16, 32, 64].map((n, i) => valueNoise(21908 + i * 71, n));
  const fine = valueNoise(21910, 13);
  return (x, y) => {
    const f = fields.reduce((s, n, i) => s + n(x, y) * [.52, .26, .13, .065, .025][i], 0);
    const n = (f - .5) * 1.5 + (fine(x, y) - .5) * .23;
    const width = .20 * (1 + .55 * n * 2);
    return 1 - [x * 16 / 9, (1 - x) * 16 / 9, y, 1 - y].reduce(
      (a, d) => a * (1 - Math.pow(smooth(1 - d / width), 1.25)), 1);
  };
}
function raster(fn, width, height, periodic) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = byte(fn(x / (periodic ? width : width - 1), y / (periodic ? height : height - 1)));
    const i = (y * width + x) * 3; data[i] = data[i + 1] = data[i + 2] = c;
  }
  return data;
}

// Input/output are display-referred sRGB code values, not linear-light values.
// The grade deliberately preserves black except for the subtle fog floor.
function grade(rgb, style) {
  if (style === 'identity') return rgb;
  const l = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  const t = smooth(l);
  const settings = {
    'blood-moon': { sat: .72, shadow: [1.01, .70, .65], light: [.77, .83, .89] },
    fog: { sat: .38, shadow: [.77, .87, .99], light: [.80, .88, .97] },
    bombers: { sat: .76, shadow: [.78, .87, .98], light: [1.01, .92, .77] },
    fire: { sat: .73, shadow: [.95, .75, .58], light: [1.05, .89, .64] },
  }[style];
  return rgb.map((c, i) => {
    let out = mix(l, c, settings.sat) * mix(settings.shadow[i], settings.light[i], t);
    if (style === 'blood-moon' && i === 0) out += .035 * l * 4 * t * (1 - t);
    if (style === 'fog') out += [2, 3, 4][i] / 255 * (1 - t) ** 3;
    return clamp(out);
  });
}
function makeLut(style) {
  const data = Buffer.alloc(256 * 16 * 3);
  for (let b = 0; b < 16; b++) for (let g = 0; g < 16; g++) for (let r = 0; r < 16; r++) {
    const c = grade([r / 15, g / 15, b / 15], style);
    const i = (g * 256 + b * 16 + r) * 3;
    for (let k = 0; k < 3; k++) data[i + k] = byte(c[k]);
  }
  return data;
}
function sampleLut(lut, rgb) {
  const p = rgb.map(c => c * 15 / 255), low = p.map(Math.floor), high = low.map(c => Math.min(15, c + 1));
  const f = p.map((c, i) => c - low[i]), result = [0, 0, 0];
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const i = (((y ? high[1] : low[1]) * 256) + (z ? high[2] : low[2]) * 16 + (x ? high[0] : low[0])) * 3;
    const w = (x ? f[0] : 1 - f[0]) * (y ? f[1] : 1 - f[1]) * (z ? f[2] : 1 - f[2]);
    for (let k = 0; k < 3; k++) result[k] += lut[i + k] * w;
  }
  return result.map(Math.round);
}

async function writeIfChanged(file, data) {
  const old = await fs.readFile(file).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
  if (old && old.equals(Buffer.isBuffer(data) ? data : Buffer.from(data))) return;
  await fs.writeFile(file, data);
}
const assets = [], validation = { version: 1, losslessRoundTrips: [], cloud: {}, luts: {} };
async function exportAsset(suffix, type, data, width, height, channels = 3) {
  const key = `dawn-night-${suffix}`, filename = `${key}.webp`;
  const encoded = await sharp(data, { raw: { width, height, channels } }).webp({ lossless: true, effort: 6 }).toBuffer();
  const decoded = await sharp(encoded).raw().toBuffer();
  assert.deepEqual(decoded, data, `${key}: lossless pixel round-trip`);
  await writeIfChanged(path.join(runtime, filename), encoded);
  assets.push({ key, file: `runtime/${filename}`, width, height, type });
  validation.losslessRoundTrips.push({ key, sha256: sha(encoded), width, height, channels });
  return { data: decoded, encoded, width, height, channels, key };
}
async function tilePreview(asset) {
  const input = asset.encoded;
  return sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#000' } })
    .composite([{ input, left: 0, top: 0 }, { input, left: 512, top: 0 }, { input, left: 0, top: 512 }, { input, left: 512, top: 512 }]).png().toBuffer();
}
function cloudChecks(fn, data) {
  let periodicError = 0;
  for (let i = 0; i < 512; i++) periodicError = Math.max(periodicError,
    Math.abs(fn(0, i / 512) - fn(1, i / 512)), Math.abs(fn(i / 512, 0) - fn(i / 512, 1)));
  assert(periodicError < 1e-10);
  const a = Array.from({ length: 512 * 512 }, (_, i) => data[i * 3]);
  const mean = a.reduce((s, n) => s + n, 0) / a.length;
  const variance = a.reduce((s, n) => s + (n - mean) ** 2, 0);
  const corr = map => a.reduce((s, n, i) => s + (n - mean) * (a[map(i)] - mean), 0) / variance;
  const shifts = {};
  for (const shift of [64, 128, 256]) shifts[shift] = {
    x: corr(i => Math.floor(i / 512) * 512 + (i % 512 + shift) % 512),
    y: corr(i => ((Math.floor(i / 512) + shift) % 512) * 512 + i % 512),
  };
  let sx = 0, sy = 0, ix = 0, iy = 0;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const i = y * 512 + x;
    if (x) ix += Math.abs(a[i] - a[i - 1]); else sx += Math.abs(a[i] - a[i + 511]);
    if (y) iy += Math.abs(a[i] - a[i - 512]); else sy += Math.abs(a[i] - a[i + 511 * 512]);
  }
  validation.cloud = { periodicError, mean,
    range: a.reduce((r, v) => [Math.min(r[0], v), Math.max(r[1], v)], [255, 0]),
    mirrorCorrelationX: corr(i => Math.floor(i / 512) * 512 + 511 - i % 512),
    mirrorCorrelationY: corr(i => (511 - Math.floor(i / 512)) * 512 + i % 512),
    shiftCorrelations: shifts, seamMean: [sx / 512, sy / 512], interiorStepMean: [ix / (512 * 511), iy / (512 * 511)] };
}
async function bomber() {
  // Symmetric flying wing in direct plan view, nose +X, serrated trailing edge.
  // Keep the span on Y: stretching to fill the wide canvas would distort the aircraft.
  const svg = `<svg width="256" height="128" viewBox="0 0 256 128">
    <path fill="white" d="M154 64 L102 10 L110 30 L98 40 L112 50 L100 64
      L112 78 L98 88 L110 98 L102 118 Z"/>
    </svg>`;
  const alpha = await sharp(Buffer.from(svg), { density: 288 }).resize(256, 128).blur(2.3).ensureAlpha().extractChannel('alpha').raw().toBuffer();
  const rgba = Buffer.alloc(256 * 128 * 4);
  for (let i = 0; i < alpha.length; i++) rgba[i * 4 + 3] = Math.round(alpha[i] * .58);
  return exportAsset('bomber-shadow-256x128', 'sprite', rgba, 256, 128, 4);
}

await fs.mkdir(runtime, { recursive: true });
const cloudFn = cloudField();
const cloud = await exportAsset('noise-cloud-512', 'tile', raster(cloudFn, 512, 512, true), 512, 512);
cloudChecks(cloudFn, cloud.data);
const accepted = async (filename, suffix) => {
  const { data, info } = await sharp(path.join(proof, filename)).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 512); assert.equal(info.height, 512); assert.equal(info.channels, 3);
  return exportAsset(suffix, 'tile', data, 512, 512);
};
const smoke = await accepted('smoke-wisps-03.png', 'noise-smoke-512');
const ember = await accepted('ember-mask-02.png', 'ember-mask-512');
const edge = await exportAsset('edge-mask-1920x1080', 'mask', raster(edgeField(), 1920, 1080, false), 1920, 1080);
for (let x = 0; x < 1920; x++) { assert.equal(edge.data[x * 3], 255); assert.equal(edge.data[((1080 - 1) * 1920 + x) * 3], 255); }
for (let y = 0; y < 1080; y++) { assert.equal(edge.data[y * 1920 * 3], 255); assert.equal(edge.data[(y * 1920 + 1919) * 3], 255); }
assert.equal(edge.data[(540 * 1920 + 960) * 3], 0);

const styles = ['identity', 'blood-moon', 'fog', 'bombers', 'fire'];
const luts = [];
for (const style of styles) {
  const lut = await exportAsset(`lut-${style}-256x16`, 'lut', makeLut(style), 256, 16);
  if (style === 'identity') for (let b = 0; b < 16; b++) for (let g = 0; g < 16; g++) for (let r = 0; r < 16; r++) {
    const i = (g * 256 + b * 16 + r) * 3;
    assert.deepEqual([...lut.data.subarray(i, i + 3)], [r * 17, g * 17, b * 17]);
  }
  validation.luts[style] = { black: sampleLut(lut.data, [0, 0, 0]), mid: sampleLut(lut.data, [128, 128, 128]), white: sampleLut(lut.data, [255, 255, 255]) };
  luts.push(lut);
}
const shadow = await bomber();
Object.assign(assets.find(asset => asset.key === shadow.key), { silhouette: 'stealth-flying-wing', forward: '+X' });
await writeIfChanged(path.join(destination, 'manifest.json'), JSON.stringify({ version: 1, assets }, null, 2) + '\n');

const sceneFile = path.join(proof, 'night-scene-source.png');
const scene = await sharp(sceneFile).removeAlpha().raw().toBuffer({ resolveWithObject: true });
assert.equal(scene.info.channels, 3);
validation.previewSource = { file: 'art/poc/dawn/fx/night-scene-source.png', sha256: sha(await fs.readFile(sceneFile)),
  original: 'C:/Fragdachse-worktrees/dawn/build/dawn/G1/board__lichtung-night.png', crop: { left: 280, top: 1060, width: 736, height: 512 } };
const panels = [];
for (let i = 0; i < luts.length; i++) {
  const result = Buffer.alloc(scene.data.length);
  for (let j = 0; j < result.length; j += 3) {
    const c = sampleLut(luts[i].data, [...scene.data.subarray(j, j + 3)]);
    for (let k = 0; k < 3; k++) result[j + k] = c[k];
  }
  if (i === 0) assert.deepEqual(result, scene.data, 'Identity preview must be pixel-exact');
  const png = await sharp(result, { raw: { width: scene.info.width, height: scene.info.height, channels: 3 } }).png().toBuffer();
  await writeIfChanged(path.join(proof, `night-lut-preview-${styles[i]}.png`), png);
  panels.push(png);
}
const shadowPreview = await sharp(sceneFile).composite([{ input: shadow.encoded, left: 240, top: 266 }]).png().toBuffer();
await writeIfChanged(path.join(proof, 'night-bomber-preview.png'), shadowPreview);
await writeIfChanged(path.join(proof, 'bomber-stealth.png'), shadowPreview);
const tiles = [];
for (const asset of [cloud, smoke, ember]) {
  const p = await tilePreview(asset);
  await writeIfChanged(path.join(proof, `${asset.key}-2x2.png`), p); tiles.push(p);
}

const width = 1920, height = 2260, composites = [], labels = [];
async function panel(input, x, y, w, h, title) {
  composites.push({ input: await sharp(input).resize(w, h).toBuffer(), left: x, top: y + 32 });
  labels.push(`<text x="${x}" y="${y + 22}" font-size="21">${title}</text>`);
}
for (let i = 0; i < 3; i++) await panel(tiles[i], 24 + i * 632, 100, 608, 608, `${['CLOUD / NEW', 'SMOKE / accepted 03', 'EMBER / accepted 02'][i]} — 2 × 2`);
await panel(edge.encoded, 24, 778, 936, 527, 'EDGE / native 1920 × 1080, reduced here');
await panel(shadowPreview, 984, 778, 912, 634, 'BOMBER / black alpha over forest floor, nose +X');
for (let i = 0; i < panels.length; i++) await panel(panels[i], 24 + i % 3 * 632, 1450 + Math.floor(i / 3) * 395, 506, 352, `LUT / ${styles[i]} / same night crop`);
const svg = `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#17191b"/><g fill="#d5d7da" font-family="sans-serif"><text x="24" y="44" font-size="31">DAWN / NIGHT RUNTIME TEXTURES</text><text x="24" y="78" font-size="19">Lossless WebP · decoded-asset previews · LUTs at full strength · no exposure boost</text>${labels.join('')}<text x="1300" y="1930" font-size="19">LUT: 16 slices / 256 × 16</text><text x="1300" y="1965" font-size="18">Black is preserved except fog: RGB 2 / 3 / 4.</text><text x="1300" y="2000" font-size="18">Cloud: periodic warped gradient noise.</text><text x="1300" y="2035" font-size="18">No mirrored quadrants or puff stamps.</text></g></svg>`;
await writeIfChanged(path.join(proof, 'night-runtime-board.png'), await sharp(Buffer.from(svg)).composite(composites).png().toBuffer());
await writeIfChanged(path.join(proof, 'night-runtime-validation.json'), JSON.stringify(validation, null, 2) + '\n');
console.log(`Exported/verified ${assets.length} lossless WebP assets; identity LUT and preview exact; periodic cloud and vignette checks passed.`);
