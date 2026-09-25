import type * as Phaser from 'phaser';
import {
  BANK_MATERIAL_KEY, BANK_MATERIAL_WET_KEY, DIRT_MATERIAL_ALT_KEY, DIRT_MATERIAL_KEY, GRASS_MATERIAL_KEY,
  GRAVEL_MATERIAL_ALT_KEY, GRAVEL_MATERIAL_KEY,
} from './GroundMaterialConfig';

/** CPU copy of a seamless material at native world scale (straight RGBA). */
export interface GroundMaterialPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: ArrayLike<number>;
}

/** Relative grass height 0..255 on the grass material's own period: blades high, gaps low. */
export interface GrassHeightMap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface GroundMaterialSamples {
  readonly dirt: GroundMaterialPixels;
  /** Optional drier second soil, mixed in by the soil field's broad dry/moist mask. */
  readonly dirtAlt?: GroundMaterialPixels;
  /** Optional riverbank soil and wet waterline silt; without them water keeps no bank. */
  readonly bank?: GroundMaterialPixels;
  readonly bankWet?: GroundMaterialPixels;
  /** Optional Persistent-Base gravel and its sandier admixture. */
  readonly gravel?: GroundMaterialPixels;
  readonly gravelAlt?: GroundMaterialPixels;
  readonly grassHeight: GrassHeightMap;
}

/** Blade-scale neighbourhood; larger structures are left to the clump noise of the seam. */
const HEIGHT_MEAN_RADIUS = 6;

function wrappedBoxMean(values: Float32Array, width: number, height: number, radius: number): Float32Array {
  const pass = new Float32Array(values.length), out = new Float32Array(values.length);
  const span = radius * 2 + 1;
  const wrap = (v: number, n: number): number => ((v % n) + n) % n;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += values[y * width + wrap(k, width)];
    for (let x = 0; x < width; x++) {
      pass[y * width + x] = sum / span;
      sum += values[y * width + wrap(x + radius + 1, width)] - values[y * width + wrap(x - radius, width)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += pass[wrap(k, height) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / span;
      sum += pass[wrap(y + radius + 1, height) * width + x] - pass[wrap(y - radius, height) * width + x];
    }
  }
  return out;
}

/**
 * Derives a height map from the authored grass itself, so the seam follows the visible
 * blades: bright green strokes stand high, dark or brown gaps between them lie low.
 */
export function deriveGrassHeight(grass: GroundMaterialPixels): GrassHeightMap {
  const { width, height, rgba } = grass;
  const count = width * height;
  const light = new Float32Array(count), green = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    light[i] = r * .3 + g * .59 + b * .11;
    green[i] = g - (r + b) * .5;
  }
  const lightMean = wrappedBoxMean(light, width, height, HEIGHT_MEAN_RADIUS);
  let greenMean = 0;
  for (let i = 0; i < count; i++) greenMean += green[i];
  greenMean /= count;
  let lightVar = 0, greenVar = 0;
  for (let i = 0; i < count; i++) {
    lightVar += (light[i] - lightMean[i]) ** 2;
    greenVar += (green[i] - greenMean) ** 2;
  }
  const lightStd = Math.sqrt(lightVar / count) || 1, greenStd = Math.sqrt(greenVar / count) || 1;
  const data = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const h = .5 + .2 * (light[i] - lightMean[i]) / lightStd + .1 * (green[i] - greenMean) / greenStd;
    data[i] = Math.round(255 * Math.max(0, Math.min(1, h)));
  }
  return { width, height, data };
}

const cache = new WeakMap<object, GroundMaterialSamples>();
let nextReadId = 0;

function readPixels(scene: Phaser.Scene, key: string): { source: object; pixels: GroundMaterialPixels } {
  const source = scene.textures.get(key).getSourceImage() as HTMLImageElement;
  const scratchKey = `__ground_material_read_${nextReadId++}`;
  const canvas = scene.textures.createCanvas(scratchKey, source.width, source.height);
  if (!canvas) throw new Error(`[GroundMaterialSamples] Could not read ${key}.`);
  try {
    canvas.draw(0, 0, source, false);
    const image = canvas.getData(0, 0, source.width, source.height);
    return { source, pixels: { width: image.width, height: image.height, rgba: image.data } };
  } finally {
    scene.textures.remove(scratchKey);
  }
}

/** Read once per loaded material set and shared by every World, bake and snapshot. */
export function readGroundMaterialSamples(scene: Phaser.Scene): GroundMaterialSamples {
  const grassSource = scene.textures.get(GRASS_MATERIAL_KEY).getSourceImage() as object;
  const cached = cache.get(grassSource);
  const dirtSource = scene.textures.get(DIRT_MATERIAL_KEY).getSourceImage() as object;
  if (cached && cache.get(dirtSource) === cached) return cached;
  const samples: GroundMaterialSamples = {
    dirt: readPixels(scene, DIRT_MATERIAL_KEY).pixels,
    dirtAlt: readPixels(scene, DIRT_MATERIAL_ALT_KEY).pixels,
    bank: readPixels(scene, BANK_MATERIAL_KEY).pixels,
    bankWet: readPixels(scene, BANK_MATERIAL_WET_KEY).pixels,
    gravel: readPixels(scene, GRAVEL_MATERIAL_KEY).pixels,
    gravelAlt: readPixels(scene, GRAVEL_MATERIAL_ALT_KEY).pixels,
    grassHeight: deriveGrassHeight(readPixels(scene, GRASS_MATERIAL_KEY).pixels),
  };
  cache.set(grassSource, samples);
  cache.set(dirtSource, samples);
  return samples;
}
