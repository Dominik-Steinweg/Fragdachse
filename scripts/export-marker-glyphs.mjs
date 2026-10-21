import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const assets = new URL('public/assets/ui/markers/', root);
const runtime = new URL('runtime/', assets);
const review = new URL('art/poc/dawn/markers/glyphs-review.png', root);
const ids = [
  'base', 'boss',
  'site-wreck', 'site-extractor', 'site-brood-nest', 'site-supply', 'site-scrap-heaps', 'scavenger',
  'mission-destroy', 'mission-hold', 'mission-carry',
  'crate', 'flag', 'hazard', 'timebomb', 'tool',
  'check', 'cross', 'portal',
];
// Exact MARKER_GLYPH_IDS order from dawn 0eb7d320, MarkerTypes.ts.
const sizes = [16, 24, 32];
const renderSizes = [...sizes, 64]; // 64px stage exists in memory for the optional SDF.
const padding = 2, columns = 5, rows = Math.ceil(ids.length / columns), spread = 6;
const pngOptions = { compressionLevel: 9, adaptiveFiltering: false, palette: false };
await mkdir(runtime, { recursive: true });
await mkdir(new URL('./', review), { recursive: true });

// No filesystem iteration order, timestamps, random seeds or absolute paths in outputs.
assert.deepEqual((await readdir(new URL('glyphs/', assets)))
  .filter(n => n.endsWith('.svg') && n !== 'merchant.svg').sort(),
  ids.map(id => `${id}.svg`).sort(), 'Update the explicit ID list when adding/removing a source');
const sources = await Promise.all(ids.map(async id => {
  const svg = await readFile(new URL(`glyphs/${id}.svg`, assets));
  assert.match(svg.toString(), /viewBox="0 0 64 64"/, `${id}: expected 64px viewBox`);
  assert.doesNotMatch(svg.toString(), /<(image|text|filter|script)\b|\bstroke\s*=|\bhref\s*=/i,
    `${id}: sources must be self-contained filled silhouettes`);
  return svg;
}));
const manifest = {
  version: 2, sourceSize: 64, sourceMargin: 4, padding, columns, rows,
  frameOrigin: 'top-left', trimmed: false,
  glyphs: Object.fromEntries(ids.map((id, i) => [id, {
    source: `../glyphs/${id}.svg`, sha256: createHash('sha256').update(sources[i]).digest('hex'),
  }])),
};
const atlases = {};
const rasters = new Map();

function layout(size) {
  const stride = size + padding * 2;
  return {
    width: columns * stride, height: rows * stride,
    frames: Object.fromEntries(ids.map((id, i) => [id, {
      x: (i % columns) * stride + padding,
      y: Math.floor(i / columns) * stride + padding, w: size, h: size,
    }])),
  };
}

function whiteImage(width, height) {
  const data = Buffer.alloc(width * height * 4, 255);
  for (let i = 3; i < data.length; i += 4) data[i] = 0;
  return data;
}

function blit(target, targetWidth, input, width, height, x, y) {
  for (let row = 0; row < height; row++) {
    input.copy(target, ((y + row) * targetWidth + x) * 4, row * width * 4, (row + 1) * width * 4);
  }
}

async function writeAtlas(atlas, data) {
  const raw = { width: atlas.width, height: atlas.height, channels: 4 };
  const encoded = await sharp(data, { raw }).webp({ lossless: true, effort: 6 }).toBuffer();
  const decoded = await sharp(encoded).ensureAlpha().raw().toBuffer();
  // WebP may discard RGB in zero-alpha texels. Coverage/distance must remain exact.
  for (let p = 0; p < data.length; p += 4) {
    assert.equal(decoded[p + 3], data[p + 3], `${atlas.file}: alpha changed`);
    if (data[p + 3]) assert(decoded[p] === 255 && decoded[p + 1] === 255 && decoded[p + 2] === 255);
  }
  await writeFile(new URL(atlas.file, runtime), encoded);
  await writeFile(new URL(atlas.file.replace('.webp', '.json'), runtime),
    JSON.stringify({ ...manifest, ...atlas }, null, 2) + '\n');
}

for (const size of renderSizes) {
  const atlas = { file: `marker-glyphs-${size}.webp`, size, ...layout(size) };
  const data = whiteImage(atlas.width, atlas.height);
  const glyphs = [];
  for (const [i, id] of ids.entries()) {
    const pixels = await sharp(sources[i], { density: 288 }).resize(size, size, { kernel: 'lanczos3' })
      .ensureAlpha().raw().toBuffer();
    let occupied = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = (y * size + x) * 4;
        // White even in transparent texels avoids dark fringes with straight-alpha filtering.
        pixels[p] = pixels[p + 1] = pixels[p + 2] = 255;
        if (pixels[p + 3] > 0) occupied++;
        if (size === 64 && (x < 4 || y < 4 || x >= 60 || y >= 60)) {
          // Lanczos may leave a tiny reconstruction fringe; no visible source may violate the margin.
          assert(pixels[p + 3] <= 8, `${id}: visible coverage outside the 4px source margin at ${x},${y}`);
        }
      }
    }
    assert(occupied > 0, `${id}: empty glyph`);
    glyphs.push(pixels);
    const frame = atlas.frames[id];
    blit(data, atlas.width, pixels, size, size, frame.x, frame.y);
  }
  rasters.set(size, glyphs);
  if (sizes.includes(size)) {
    await writeAtlas(atlas, data);
    atlases[size] = atlas;
  }
}

// Separable squared Euclidean distance transform. The lower envelope of parabolas
// computes each row/column in linear time. Fractional coverage seeds preserve AA edges.
function distanceTransform(grid, width, height) {
  const n = Math.max(width, height), f = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  function transform(length) {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let s;
      do {
        const r = v[k];
        s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * (q - r));
        if (s > z[k]) break;
        k--;
      } while (k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) ** 2 + f[v[k]];
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    transform(height);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x];
    transform(width);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x];
  }
}

function makeSdf(pixels) {
  const side = 64 + 2 * padding;
  const outer = new Float64Array(side * side), inner = new Float64Array(side * side);
  const data = whiteImage(side, side), infinity = 1e12;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const i = y * side + x;
      const a = x >= padding && y >= padding && x < side - padding && y < side - padding
        ? pixels[((y - padding) * 64 + x - padding) * 4 + 3] / 255 : 0;
      outer[i] = a === 0 ? infinity : Math.max(0, 0.5 - a) ** 2;
      inner[i] = a === 1 ? infinity : Math.max(0, a - 0.5) ** 2;
    }
  }
  distanceTransform(outer, side, side);
  distanceTransform(inner, side, side);
  for (let i = 0; i < side * side; i++) {
    const signedDistance = Math.sqrt(inner[i]) - Math.sqrt(outer[i]);
    data[i * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, 0.5 + signedDistance / (2 * spread))));
  }
  return data;
}

const sdf = {
  file: 'marker-glyphs-sdf.webp', size: 64, ...layout(64),
  channel: 'alpha', spread, edge: 0.5, inside: 'positive',
  decode: '(alpha - 0.5) * 12', filter: 'linear', mipmaps: false,
};
const sdfPixels = whiteImage(sdf.width, sdf.height);
for (const [i, id] of ids.entries()) {
  const tile = makeSdf(rasters.get(64)[i]);
  const frame = sdf.frames[id];
  // Compute per glyph including its gutter, so adjacent glyphs cannot affect distance.
  blit(sdfPixels, sdf.width, tile, 68, 68, frame.x - padding, frame.y - padding);
}
await writeAtlas(sdf, sdfPixels);
// Remove only the superseded M3-G outputs, never unrelated files.
for (const name of ['marker-glyphs.json', 'marker-glyphs-16.png', 'marker-glyphs-24.png',
  'marker-glyphs-32.png', 'marker-glyphs-64.png', 'marker-glyphs-sdf.png']) {
  await unlink(new URL(name, runtime)).catch(error => { if (error.code !== 'ENOENT') throw error; });
}

// Review reads encoded outputs back from disk: atlas packing, WebP alpha, linear
// SDF sampling and thresholding are all exercised. No vector substitute for SDF.
const decoded = new Map();
for (const size of sizes) {
  decoded.set(size, await sharp(fileURLToPath(new URL(atlases[size].file, runtime))).ensureAlpha().raw().toBuffer());
}
const sdfDecoded = await sharp(fileURLToPath(new URL(sdf.file, runtime))).ensureAlpha().raw().toBuffer();
function framePixels(atlas, data, id) {
  const f = atlas.frames[id], pixels = whiteImage(f.w, f.h);
  for (let y = 0; y < f.h; y++) {
    data.copy(pixels, y * f.w * 4, ((f.y + y) * atlas.width + f.x) * 4,
      ((f.y + y) * atlas.width + f.x + f.w) * 4);
  }
  return pixels;
}

function sdfPreview(id, scale = 3) {
  const frame = sdf.frames[id], size = frame.w * scale, pixels = whiteImage(size, size);
  function sample(x, y) { return sdfDecoded[(y * sdf.width + x) * 4 + 3] / 255; }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = frame.x + (x + 0.5) / scale - 0.5, v = frame.y + (y + 0.5) / scale - 0.5;
      const x0 = Math.floor(u), y0 = Math.floor(v), tx = u - x0, ty = v - y0;
      const a = (sample(x0, y0) * (1 - tx) + sample(x0 + 1, y0) * tx) * (1 - ty)
        + (sample(x0, y0 + 1) * (1 - tx) + sample(x0 + 1, y0 + 1) * tx) * ty;
      const d = (a - 0.5) * 2 * spread;
      const t = Math.max(0, Math.min(1, 0.5 + d * scale));
      pixels[(y * size + x) * 4 + 3] = Math.round(255 * t * t * (3 - 2 * t));
    }
  }
  return { input: pixels, raw: { width: size, height: size, channels: 4 } };
}

// Resolve the four review swatches from the same source as HUD_TONES. They are
// preview decoration only, never baked into the runtime glyphs or their manifest.
const config = await readFile(new URL('src/config.ts', root), 'utf8');
const tones = [['Gold', 'GOLD_1'], ['Blau', 'BLUE_2'], ['Violett', 'PURPLE_1'], ['Rot', 'RED_1']]
  .map(([label, key]) => {
    const match = config.match(new RegExp(`\\b${key}:\\s*0x([0-9a-f]{6})`, 'i'));
    assert(match, `Missing review tone ${key}`);
    return { label, color: `#${match[1]}` };
  });
const width = 1160, cardWidth = 556, cardHeight = 268, headerHeight = 132;
const height = headerHeight + Math.ceil(ids.length / 2) * cardHeight + 30;
const shapes = [], labels = [], overlays = [];
const text = (x, y, value, size = 12, fill = '#b9b2a3') => labels.push(
  `<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="${size}" fill="${fill}">${value}</text>`);
text(24, 36, 'M3 / MARKER GLYPHS', 26, '#f5f0e4');
text(24, 62, '18 Vertrags-IDs | lossless WebP / echte Atlas-Pixel | Weiss auf Walnuss #2b211b', 14);
text(24, 85, 'Links: 16 / 24 / 32 px in vier HUD-Tonfamilien. Rechts: SDF 64 → 192 px (3×).', 14);
text(24, 107, 'SDF: Alpha-Distanz ±6 px, bilinear + smoothstep. Keine Spielszene; Badge-Raender nur im Pruefbogen.', 12);
for (const [index, id] of ids.entries()) {
  const left = 24 + (index % 2) * (cardWidth + 16), top = headerHeight + Math.floor(index / 2) * cardHeight;
  shapes.push(`<rect x="${left}" y="${top}" width="${cardWidth}" height="252" rx="12" fill="#242522"/>`);
  text(left + 16, top + 26, `${String(index + 1).padStart(2, '0')} / ${id}`, 17, '#f5f0e4');
  const centers = [left + 100, left + 170, left + 242];
  [16, 24, 32].forEach((size, i) => text(centers[i] - 16, top + 49, `${size} px`));
  for (const [r, tone] of tones.entries()) {
    const cy = top + 76 + r * 46;
    text(left + 14, cy + 4, tone.label, 11, tone.color);
    for (const [c, size] of [16, 24, 32].entries()) {
      const cx = centers[c], radius = size / 2 + 6;
      if (id === 'hazard') {
        shapes.push(`<path d="M${cx} ${cy - radius - 2}L${cx + radius + 3} ${cy + radius - 2}H${cx - radius - 3}Z" fill="#2b211b" stroke="${tone.color}" stroke-width="2" stroke-linejoin="round"/>`);
      } else {
        shapes.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#2b211b" stroke="${tone.color}" stroke-width="2"/>`);
      }
      overlays.push({ input: framePixels(atlases[size], decoded.get(size), id),
        raw: { width: size, height: size, channels: 4 }, left: cx - size / 2, top: cy - size / 2 });
    }
  }
  text(left + 346, top + 26, 'SDF / 3× / 192 px', 12);
  shapes.push(`<rect x="${left + 320}" y="${top + 42}" width="216" height="200" rx="8" fill="#2b211b"/>`);
  overlays.push({ ...sdfPreview(id), left: left + 332, top: top + 46 });
}
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#191c1a"/>${shapes.join('')}${labels.join('')}</svg>`);
await sharp(svg).composite(overlays).png(pngOptions).toFile(fileURLToPath(review));
console.log(`Exported ${ids.length} contract glyphs at ${sizes.join('/')} px, SDF ±${spread}px, per-atlas JSON and review.`);
