import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

/**
 * Large-scale ground variation: a seamless, low-frequency Multiply map. At runtime it is
 * stretched (GROUND_MACRO_TILE_SCALE) so its period does not share a small multiple with the
 * 1024 px materials. It carries value (damp/dark vs. open/light areas) and a slight hue drift,
 * never blade or grain detail.
 */
const size = 512, output = 'public/assets/sprites';
await mkdir(output, { recursive: true });

let seed = 0x5eed1234;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const smooth = v => v * v * v * (v * (v * 6 - 15) + 10);

/** Periodic value noise: `cells` lattice cells across the tile, wrapping on both axes. */
function layer(cells) {
  const lattice = Float32Array.from({ length: cells * cells }, random);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * cells, v = y / size * cells;
    const ix = Math.floor(u), iy = Math.floor(v), tx = smooth(u - ix), ty = smooth(v - iy);
    const at = (i, j) => lattice[(j % cells) * cells + (i % cells)];
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
  return out;
}

const fbm = (octaves) => {
  const layers = octaves.map(([cells, weight]) => [layer(cells), weight]);
  const total = octaves.reduce((sum, [, weight]) => sum + weight, 0);
  return Float32Array.from({ length: size * size }, (_, i) =>
    layers.reduce((sum, [values, weight]) => sum + values[i] * weight, 0) / total);
};

// Value: broad clearings and hollows plus medium patches of a few metres.
const value = fbm([[3, .7], [6, .7], [12, .6], [24, .5], [48, .45], [96, .25]]);
// Hue drift: independent field, drier olive vs. cooler damp green.
const hue = fbm([[4, 1], [8, .5]]);

const contrast = (field) => {
  let min = Infinity, max = -Infinity;
  for (const v of field) { min = Math.min(min, v); max = Math.max(max, v); }
  return field.map(v => (v - min) / (max - min));
};
const v01 = contrast(value), h01 = contrast(hue);
const data = Buffer.alloc(size * size * 3);
for (let i = 0; i < size * size; i++) {
  const shade = .64 + .36 * smooth(v01[i]);
  const dry = Math.max(0, h01[i] - .5) * 2, damp = Math.max(0, .5 - h01[i]) * 2;
  const tint = [1 - damp * .06, 1 - dry * .03, 1 - dry * .12 - damp * .01];
  for (let c = 0; c < 3; c++) data[i * 3 + c] = Math.round(255 * Math.min(1, shade * tint[c]));
}
await sharp(data, { raw: { width: size, height: size, channels: 3 } }).png().toFile(output + '/ground_macro.png');
console.log(`ground_macro: ${size} x ${size} seamless Multiply map`);
