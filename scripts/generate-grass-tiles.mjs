import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';

const source = 'tools/source-art/ground-materials', output = 'public/assets/sprites';
/** Selected sources, their physical size and a mild authored grade: materials.json. */
const recipe = JSON.parse(await readFile(source + '/materials.json', 'utf8'));
const size = recipe.tileSize, patch = 128, overlap = 32, step = patch - overlap;
await mkdir(output, { recursive: true });

/** Offline quilting preserves authored blade/grain scale. Overlapping patches
 * are joined along minimum-error paths, without a new noise or detail layer. */
function quilt(input, nativeSize, seed) {
  const data = Buffer.alloc(size * size * 3);
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sourcePixel = (p, x, y, c) => {
    let u = p.flip ? patch - 1 - x : x, v = y;
    for (let r = 0; r < p.rotation; r++) [u, v] = [patch - 1 - v, u];
    return input[((p.y + v) * nativeSize + p.x + u) * 3 + c];
  };
  for (let oy = 0; oy < size; oy += step) for (let ox = 0; ox < size; ox += step) {
    const w = Math.min(patch, size - ox), h = Math.min(patch, size - oy);
    let best, score = Infinity;
    const error = (p, x, y) => {
      let sum = 0;
      for (let c = 0; c < 3; c++) sum += (data[((oy + y) * size + ox + x) * 3 + c] - sourcePixel(p, x, y, c)) ** 2;
      return sum;
    };
    for (let candidate = 0; candidate < 24; candidate++) {
      const p = { x: Math.floor(random() * (nativeSize - patch + 1)), y: Math.floor(random() * (nativeSize - patch + 1)),
        flip: random() < .5, rotation: Math.floor(random() * 4) };
      let total = 0;
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
        if ((ox && x < overlap) || (oy && y < overlap)) total += error(p, x, y);
      }
      if (total < score) { best = p; score = total; }
    }
    const cut = (length, across, horizontal) => {
      const cost = new Float64Array(length * across), parent = new Int16Array(cost.length);
      for (let i = 0; i < length; i++) for (let j = 0; j < across; j++) {
        let prev = j;
        if (i) for (let k = Math.max(0, j - 1); k <= Math.min(across - 1, j + 1); k++) {
          if (cost[(i - 1) * across + k] < cost[(i - 1) * across + prev]) prev = k;
        }
        cost[i * across + j] = error(best, horizontal ? i : j, horizontal ? j : i)
          + (i ? cost[(i - 1) * across + prev] : 0);
        parent[i * across + j] = prev;
      }
      let j = 0;
      for (let k = 1; k < across; k++) if (cost[(length - 1) * across + k] < cost[(length - 1) * across + j]) j = k;
      const path = new Int16Array(length);
      for (let i = length - 1; i >= 0; i--) { path[i] = j; j = parent[i * across + j]; }
      return path;
    };
    const left = ox ? cut(h, Math.min(overlap, w), false) : null;
    const top = oy ? cut(w, Math.min(overlap, h), true) : null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((left && x < left[y]) || (top && y < top[x])) continue;
      for (let c = 0; c < 3; c++) data[((oy + y) * size + ox + x) * 3 + c] = sourcePixel(best, x, y, c);
    }
  }
  return data;
}

function reconcileTileEdges(data, band = 8) {
  for (let axis = 0; axis < 2; axis++) for (let line = 0; line < size; line++) {
    for (let offset = 0; offset < band; offset++) {
      const t = 1 - offset / band, weight = t * t * (3 - 2 * t) * .5;
      const a = (axis === 0 ? line * size + offset : offset * size + line) * 3;
      const b = (axis === 0 ? line * size + size - 1 - offset : (size - 1 - offset) * size + line) * 3;
      for (let c = 0; c < 3; c++) {
        const first = data[a + c], last = data[b + c];
        data[a + c] = Math.round(first + (last - first) * weight);
        data[b + c] = Math.round(last + (first - last) * weight);
      }
    }
  }
}
/** Grade in linear-ish display space: per-channel gain, saturation about luma, gamma. */
function grade(data, { gain = [1, 1, 1], saturation = 1, gamma = 1 } = {}) {
  for (let i = 0; i < data.length; i += 3) {
    let r = data[i] * gain[0] / 255, g = data[i + 1] * gain[1] / 255, b = data[i + 2] * gain[2] / 255;
    const luma = r * .3 + g * .59 + b * .11;
    r = luma + (r - luma) * saturation; g = luma + (g - luma) * saturation; b = luma + (b - luma) * saturation;
    data[i] = Math.round(255 * Math.max(0, Math.min(1, r)) ** gamma);
    data[i + 1] = Math.round(255 * Math.max(0, Math.min(1, g)) ** gamma);
    data[i + 2] = Math.round(255 * Math.max(0, Math.min(1, b)) ** gamma);
  }
}

/** Seamless value-noise fBm over the whole tile; `cells` lattice cells per octave. */
function periodicNoise(octaves, seed) {
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const fade = v => v * v * (3 - 2 * v);
  const out = new Float32Array(size * size);
  for (const cells of octaves) {
    const lattice = Float32Array.from({ length: cells * cells }, random);
    const at = (i, j) => lattice[(j % cells) * cells + (i % cells)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size * cells, v = y / size * cells, i = Math.floor(u), j = Math.floor(v);
      const tx = fade(u - i), ty = fade(v - j);
      out[y * size + x] += ((at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty)
        + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty) / octaves.length;
    }
  }
  return out;
}

/** Blade height of the base layer: luminance above its wrapped local mean, about 0..1. */
function bladeHeight(data, radius = 6) {
  const light = new Float32Array(size * size), height = new Float32Array(size * size);
  for (let i = 0; i < light.length; i++) light[i] = data[i * 3] * .3 + data[i * 3 + 1] * .59 + data[i * 3 + 2] * .11;
  const wrap = v => (v + size) % size;
  let variance = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += light[y * size + wrap(x + k)] + light[wrap(y + k) * size + x];
    height[y * size + x] = light[y * size + x] - sum / (4 * radius + 2);
    variance += height[y * size + x] ** 2;
  }
  const deviation = Math.sqrt(variance / height.length) || 1;
  return height.map(v => .5 + .2 * v / deviation);
}

async function nativeQuilt(layer) {
  const nativeSize = Math.round(layer.sourceMetres * recipe.pixelsPerMetre);
  const native = await sharp(source + '/' + layer.source).resize(nativeSize, nativeSize, { kernel: 'lanczos3' })
    .removeAlpha().raw().toBuffer();
  return quilt(native, nativeSize, layer.seed);
}

/**
 * Material variation inside the tile: each blend layer covers roughly `coverage` of the
 * area in patches of the given lattice scales. The mask is height-biased, so tall blades of
 * the base survive at patch borders instead of a soft cross-fade.
 */
function blendLayer(data, height, layerData, layer) {
  const noise = periodicNoise(layer.cells, layer.seed ^ 0x9e3779b9);
  const threshold = Float32Array.from(noise).sort()[Math.floor(noise.length * (1 - layer.coverage))];
  for (let i = 0; i < noise.length; i++) {
    const t = Math.max(0, Math.min(1, (noise[i] - threshold - (height[i] - .5) * layer.heightBias) / layer.softness + .5));
    const mask = t * t * (3 - 2 * t);
    for (let c = 0; c < 3; c++) data[i * 3 + c] = Math.round(data[i * 3 + c] + (layerData[i * 3 + c] - data[i * 3 + c]) * mask);
  }
}

for (const [target, material] of Object.entries(recipe.materials)) {
  const data = await nativeQuilt(material);
  const height = bladeHeight(data);
  for (const layer of material.blend ?? []) blendLayer(data, height, await nativeQuilt(layer), layer);
  reconcileTileEdges(data);
  grade(data, material.grade);
  await sharp(data, { raw: { width: size, height: size, channels: 3 } }).png().toFile(output + '/' + target + '.png');
  console.log(target + ': ' + size + ' x ' + size + ' from ' + material.source + ', ' + recipe.pixelsPerMetre + ' pixels/metre');
}
// Neutral compatibility tile for the independent, intentionally untouched fog lab.
await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } })
  .png().toFile(output + '/gras_detail_tile.png');
