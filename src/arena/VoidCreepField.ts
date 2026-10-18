/** World pixels per creep texel; the creep shaders warp it and draw their veins at full resolution. */
export const VOID_CREEP_TEXEL_PX = 16;
/** Flora share from which the void soaks into ground and rock, and where it is fully established. */
const CREEP_FROM = 0.32, CREEP_FULL = 0.85;
/** Infested ponds seep their ink up the banks (world px) with this much of their own infestation. */
const BANK_INNER = 40, BANK_OUTER = 150, BANK_STRENGTH = 0.55;
/**
 * Domain warp of the creep's sample positions (world px): the flora field's value noise has straight
 * contour lines inside its cells; warping by two smooth octaves turns them into creeping lobes.
 */
const WARP_SCALE = 260, WARP_PX = 150;

/**
 * Void creep over ground, rock and water (GDD Nachtsicht N-6, Void-Gefahrenzonen V1), presentation
 * only: where the void has taken the flora it soaks the land itself, and its spore haze hangs over
 * dangerous places. One byte per texel in [0, 1], frame-local from `offsetX`/`offsetY`. Every peer
 * derives it from the same World field, so it never replicates.
 */
export interface VoidCreepField {
  /** Soaked ground: a scar that stays when the danger is gone. */
  readonly data: Uint8Array;
  /** Land share per texel in [0, 255]: glints and airborne spores belong to land, ink to water too. */
  readonly land: Uint8Array;
  /** Spore haze thickness; follows the presence of its places and may be rewritten in regions. */
  readonly haze: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly texelPx: number;
}

/** What the creep reads from the World's void field. */
export interface VoidCreepSource {
  intensityAt(x: number, y: number): number;
  /** Haze thickness at a point; absent = no haze. */
  hazeAt?(x: number, y: number): number;
}

/** Texel rectangle of a creep field, inclusive. */
export interface VoidCreepTexelRect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Creep from the void field's established takeover, plus the banks of infested ponds (`ponds` as
 * x, y, infestation triples). Null when nothing creeps, so owners keep no textures for clean worlds.
 */
export function buildVoidCreepField(source: VoidCreepSource,
  frame: { offsetX: number; offsetY: number; width: number; height: number },
  ponds: readonly number[] = [], landAt: (x: number, y: number) => number = () => 1): VoidCreepField | null {
  const texel = VOID_CREEP_TEXEL_PX;
  const width = Math.max(1, Math.ceil(frame.width / texel)), height = Math.max(1, Math.ceil(frame.height / texel));
  const clear = new Float32Array(width * height);
  let found = false;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [wx, wy] = warped(frame.offsetX + (x + .5) * texel, frame.offsetY + (y + .5) * texel);
    clear[y * width + x] = 1 - smoothstep(CREEP_FROM, CREEP_FULL, source.intensityAt(wx, wy));
  }
  for (let i = 0; i + 2 < ponds.length; i += 3) {
    const px = (ponds[i] - frame.offsetX) / texel - .5, py = (ponds[i + 1] - frame.offsetY) / texel - .5;
    const amount = Math.max(0, Math.min(1, ponds[i + 2])), reach = BANK_OUTER / texel;
    for (let y = Math.max(0, Math.floor(py - reach)); y <= Math.min(height - 1, Math.ceil(py + reach)); y++)
      for (let x = Math.max(0, Math.floor(px - reach)); x <= Math.min(width - 1, Math.ceil(px + reach)); x++) {
        const bank = (1 - smoothstep(BANK_INNER, BANK_OUTER, Math.hypot(x - px, y - py) * texel)) * amount * BANK_STRENGTH;
        clear[y * width + x] *= 1 - bank;
      }
  }
  for (let i = 0; i < clear.length; i++) clear[i] = 1 - clear[i];
  // A one-texel tent removes the texel grid; the shaders add their own organic rim.
  const data = tent(clear, width, height), land = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    land[y * width + x] = Math.round(Math.max(0, Math.min(1, landAt(frame.offsetX + (x + .5) * texel, frame.offsetY + (y + .5) * texel))) * 255);
  const field = { data, land, haze: new Uint8Array(width * height), width, height, offsetX: frame.offsetX, offsetY: frame.offsetY, texelPx: texel };
  if (source.hazeAt) field.haze.set(buildVoidCreepHaze(field, source, { x0: 0, y0: 0, x1: width - 1, y1: height - 1 }));
  for (let i = 0; i < data.length && !found; i++) found = data[i] > 0 || field.haze[i] > 0;
  return found ? field : null;
}

/**
 * Haze bytes of one texel rectangle (row-major, rectangle-sized) from `source.hazeAt`, warped and
 * smoothed exactly like the full build, so a region rewritten after a change joins seamlessly.
 */
export function buildVoidCreepHaze(creep: Pick<VoidCreepField, 'width' | 'height' | 'offsetX' | 'offsetY' | 'texelPx'>,
  source: VoidCreepSource, rect: VoidCreepTexelRect): Uint8Array {
  // One texel of margin feeds the tent at the rectangle's border.
  const x0 = Math.max(0, rect.x0 - 1), y0 = Math.max(0, rect.y0 - 1);
  const x1 = Math.min(creep.width - 1, rect.x1 + 1), y1 = Math.min(creep.height - 1, rect.y1 + 1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, raw = new Float32Array(w * h);
  if (source.hazeAt) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [wx, wy] = warped(creep.offsetX + (x0 + x + .5) * creep.texelPx, creep.offsetY + (y0 + y + .5) * creep.texelPx);
    raw[y * w + x] = Math.max(0, Math.min(1, source.hazeAt(wx, wy)));
  }
  const smoothed = tent(raw, w, h), out = new Uint8Array((rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1));
  for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++)
    out[(y - rect.y0) * (rect.x1 - rect.x0 + 1) + x - rect.x0] = smoothed[(y - y0) * w + x - x0];
  return out;
}

/** Texel rectangle covering a world rectangle, clamped to the field; null when they do not meet. */
export function voidCreepTexelRect(creep: Pick<VoidCreepField, 'width' | 'height' | 'offsetX' | 'offsetY' | 'texelPx'>,
  bounds: { x: number; y: number; width: number; height: number }): VoidCreepTexelRect | null {
  // The domain warp moves samples by up to WARP_PX; the rectangle grows by as much.
  const grow = WARP_PX + creep.texelPx;
  const x0 = Math.max(0, Math.floor((bounds.x - grow - creep.offsetX) / creep.texelPx));
  const y0 = Math.max(0, Math.floor((bounds.y - grow - creep.offsetY) / creep.texelPx));
  const x1 = Math.min(creep.width - 1, Math.ceil((bounds.x + bounds.width + grow - creep.offsetX) / creep.texelPx));
  const y1 = Math.min(creep.height - 1, Math.ceil((bounds.y + bounds.height + grow - creep.offsetY) / creep.texelPx));
  return x0 <= x1 && y0 <= y1 ? { x0, y0, x1, y1 } : null;
}

/** Sample position after the domain warp that turns the field's contours into creeping lobes. */
function warped(wx: number, wy: number): [number, number] {
  const dx = (warpNoise(wx / WARP_SCALE, wy / WARP_SCALE, 11) - .5) * 2 + (warpNoise(wx / WARP_SCALE * 2.1, wy / WARP_SCALE * 2.1, 13) - .5);
  const dy = (warpNoise(wx / WARP_SCALE, wy / WARP_SCALE, 17) - .5) * 2 + (warpNoise(wx / WARP_SCALE * 2.1, wy / WARP_SCALE * 2.1, 19) - .5);
  return [wx + dx * WARP_PX * .66, wy + dy * WARP_PX * .66];
}

/** One-texel tent filter of a 0..1 grid into bytes. */
function tent(values: Float32Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0, weight = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const w = (2 - Math.abs(dx)) * (2 - Math.abs(dy));
      sum += values[yy * width + xx] * w; weight += w;
    }
    out[y * width + x] = Math.round(sum / weight * 255);
  }
  return out;
}

/** Creep at a world point, bilinear between texel centres; 0 outside the field. */
export function voidCreepAt(creep: VoidCreepField, x: number, y: number): number {
  return sampleBytes(creep, creep.data, x, y);
}

/** Land share at a world point, bilinear; 0 outside the field. */
export function voidCreepLandAt(creep: VoidCreepField, x: number, y: number): number {
  return sampleBytes(creep, creep.land, x, y);
}

/** Haze thickness at a world point, bilinear; 0 outside the field. */
export function voidCreepHazeAt(creep: VoidCreepField, x: number, y: number): number {
  return sampleBytes(creep, creep.haze, x, y);
}

function sampleBytes(creep: VoidCreepField, bytes: Uint8Array, x: number, y: number): number {
  const fx = (x - creep.offsetX) / creep.texelPx - .5, fy = (y - creep.offsetY) / creep.texelPx - .5;
  if (fx < -.5 || fy < -.5 || fx > creep.width - .5 || fy > creep.height - .5) return 0;
  const x0 = Math.max(0, Math.min(creep.width - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(creep.height - 1, Math.floor(fy)));
  const x1 = Math.min(creep.width - 1, x0 + 1), y1 = Math.min(creep.height - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
  const at = (cx: number, cy: number): number => bytes[cy * creep.width + cx] / 255;
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx, bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
  return top + (bottom - top) * ty;
}

/** Smooth value noise for the domain warp; quintic fade keeps its own cells from showing. */
function warpNoise(x: number, y: number, salt: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash(ix, iy, salt), b = hash(ix + 1, iy, salt), c = hash(ix, iy + 1, salt), d = hash(ix + 1, iy + 1, salt);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const hash = (x: number, y: number, salt: number): number => {
  let n = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ salt;
  n = Math.imul(n ^ (n >>> 16), 2246822507);
  n = Math.imul(n ^ (n >>> 13), 3266489909);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
