import type * as Phaser from 'phaser';

/** Draft void flora (GDD Nachtsicht G1): `<atlas>-void-draft`; the Argon atlases replace it in G2. */
export const voidDraftKey = (sourceKey: string): string => `${sourceKey}-void-draft`;
const DARK = [.045, .012, .08] as const;
const LIGHT = [.40, .25, .60] as const;
/** Share of the violet ramp; the rest keeps a trace of the original leaf colour. */
const TAKEOVER = .78;

/**
 * Builds once per texture manager a violet copy of a loaded atlas: luminance drives a dark-to-pale
 * violet ramp, so veins and leaf structure stay readable while the green is gone. The copy keeps
 * every frame rectangle, so placements only switch the texture key.
 */
export function ensureVoidDraftTexture(textures: Phaser.Textures.TextureManager, sourceKey: string): string | null {
  const key = voidDraftKey(sourceKey);
  if (textures.exists(key)) return key;
  if (!textures.exists(sourceKey) || typeof document === 'undefined') return null;
  const source = textures.get(sourceKey);
  const image = source.getSourceImage() as HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  if (!image?.width || !image.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image as CanvasImageSource, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height), data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const luminance = Math.min(1, (r * .3 + g * .59 + b * .11) / .7);
    const t = luminance * luminance * (3 - 2 * luminance);
    data[i] = Math.round((r + (DARK[0] + (LIGHT[0] - DARK[0]) * t - r) * TAKEOVER) * 255);
    data[i + 1] = Math.round((g + (DARK[1] + (LIGHT[1] - DARK[1]) * t - g) * TAKEOVER) * 255);
    data[i + 2] = Math.round((b + (DARK[2] + (LIGHT[2] - DARK[2]) * t - b) * TAKEOVER) * 255);
  }
  context.putImageData(pixels, 0, 0);
  const texture = textures.addCanvas(key, canvas);
  if (!texture) return null;
  for (const name of source.getFrameNames()) {
    const frame = source.get(name);
    texture.add(name, 0, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight);
  }
  return key;
}

/** Emissive companion of a void atlas: `<atlas>-void-emissive`; the Argon masks replace the draft. */
export const voidEmissiveKey = (sourceKey: string): string => `${sourceKey}-void-emissive`;

/**
 * Draft vein mask of a loaded atlas (G1): the fine bright structure of each leaf or tuft (luminance
 * above its local mean) becomes white emission, everything else stays dark. Frames are copied.
 */
export function ensureVoidEmissiveDraftTexture(textures: Phaser.Textures.TextureManager, sourceKey: string): string | null {
  const key = voidEmissiveKey(sourceKey);
  if (textures.exists(key)) return key;
  if (!textures.exists(sourceKey) || typeof document === 'undefined') return null;
  const source = textures.get(sourceKey);
  const image = source.getSourceImage() as HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  if (!image?.width || !image.height) return null;
  const width = image.width, height = image.height;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image as CanvasImageSource, 0, 0);
  const pixels = context.getImageData(0, 0, width, height), data = pixels.data;
  const count = width * height;
  const alpha = new Float32Array(count), weighted = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    alpha[i] = data[i * 4 + 3] / 255;
    weighted[i] = alpha[i] * (data[i * 4] * .3 + data[i * 4 + 1] * .59 + data[i * 4 + 2] * .11) / 255;
  }
  // Alpha-normalised local mean: transparent surroundings never make a leaf rim look bright.
  const meanLuminance = boxBlur(weighted, width, height, 4), meanAlpha = boxBlur(alpha, width, height, 4);
  const interior = boxBlur(alpha, width, height, 7);
  for (let i = 0; i < count; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255;
    if (alpha[i] === 0) { data[i * 4 + 3] = 0; continue; }
    const own = weighted[i] / alpha[i];
    const detail = own - (meanAlpha[i] > .001 ? meanLuminance[i] / meanAlpha[i] : 0);
    const t = Math.max(0, Math.min(1, (detail - .035) / .11));
    // Only well inside the plant: veins, never its outline.
    const inside = Math.max(0, Math.min(1, (interior[i] - .82) / .15));
    data[i * 4 + 3] = Math.round(t * t * (3 - 2 * t) * inside * alpha[i] * 255);
  }
  context.putImageData(pixels, 0, 0);
  const texture = textures.addCanvas(key, canvas);
  if (!texture) return null;
  for (const name of source.getFrameNames()) {
    const frame = source.get(name);
    texture.add(name, 0, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight);
  }
  return key;
}

/**
 * Separable box mean with running sums: cost independent of the radius. Edges average what exists.
 * The vertical pass keeps one running sum per column and walks rows, so memory is read in order.
 */
function boxBlur(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const row = new Float32Array(source.length), out = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    const base = y * width;
    let sum = 0;
    for (let x = 0; x <= Math.min(radius, width - 1); x++) sum += source[base + x];
    for (let x = 0; x < width; x++) {
      const lo = Math.max(0, x - radius), hi = Math.min(width - 1, x + radius);
      row[base + x] = sum / (hi - lo + 1);
      if (x + radius + 1 < width) sum += source[base + x + radius + 1];
      if (x - radius >= 0) sum -= source[base + x - radius];
    }
  }
  const sums = new Float64Array(width);
  for (let y = 0; y <= Math.min(radius, height - 1); y++) for (let x = 0; x < width; x++) sums[x] += row[y * width + x];
  for (let y = 0; y < height; y++) {
    const base = y * width, scale = 1 / (Math.min(height - 1, y + radius) - Math.max(0, y - radius) + 1);
    for (let x = 0; x < width; x++) out[base + x] = sums[x] * scale;
    if (y + radius + 1 < height) { const add = (y + radius + 1) * width; for (let x = 0; x < width; x++) sums[x] += row[add + x]; }
    if (y - radius >= 0) { const sub = (y - radius) * width; for (let x = 0; x < width; x++) sums[x] -= row[sub + x]; }
  }
  return out;
}
