import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import { grade, quilt, reconcileTileEdges } from './lib/material-tile.mjs';

const source = 'tools/source-art/ground-materials', output = 'public/assets/sprites';
/** Selected sources, their physical size and a mild authored grade: materials.json. */
const recipe = JSON.parse(await readFile(source + '/materials.json', 'utf8'));
const size = recipe.tileSize;
await mkdir(output, { recursive: true });

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
  return quilt(native, nativeSize, layer.seed, { size });
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
  reconcileTileEdges(data, size);
  grade(data, material.grade);
  await sharp(data, { raw: { width: size, height: size, channels: 3 } }).png().toFile(output + '/' + target + '.png');
  console.log(target + ': ' + size + ' x ' + size + ' from ' + material.source + ', ' + recipe.pixelsPerMetre + ' pixels/metre');
}
// Neutral compatibility tile for the independent, intentionally untouched fog lab.
await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } })
  .png().toFile(output + '/gras_detail_tile.png');
