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
/** Land spores: one candidate per cell (world px), only on established creep, never more than this. */
const SPORE_CELL_PX = 56, SPORE_FROM = 0.40, MAX_GROUND_SPORES = 420;

/**
 * Void creep over ground, rock and water (GDD Nachtsicht N-6), presentation only: where the void
 * has taken the flora it soaks the land itself. One byte per texel in [0, 1], frame-local from
 * `offsetX`/`offsetY`. Every peer derives it from the same World field, so it never replicates.
 */
export interface VoidCreepField {
  readonly data: Uint8Array;
  /** Land share per texel in [0, 255]: glints and airborne spores belong to land, ink to water too. */
  readonly land: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly texelPx: number;
}

/** What the creep reads from the World's void field. */
export interface VoidCreepSource {
  intensityAt(x: number, y: number): number;
}

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
    const wx = frame.offsetX + (x + .5) * texel, wy = frame.offsetY + (y + .5) * texel;
    const dx = (warpNoise(wx / WARP_SCALE, wy / WARP_SCALE, 11) - .5) * 2 + (warpNoise(wx / WARP_SCALE * 2.1, wy / WARP_SCALE * 2.1, 13) - .5);
    const dy = (warpNoise(wx / WARP_SCALE, wy / WARP_SCALE, 17) - .5) * 2 + (warpNoise(wx / WARP_SCALE * 2.1, wy / WARP_SCALE * 2.1, 19) - .5);
    const creep = smoothstep(CREEP_FROM, CREEP_FULL, source.intensityAt(wx + dx * WARP_PX * .66, wy + dy * WARP_PX * .66));
    clear[y * width + x] = 1 - creep;
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
  // A one-texel tent removes the texel grid; the shaders add their own organic rim.
  const data = new Uint8Array(width * height), land = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    land[y * width + x] = Math.round(Math.max(0, Math.min(1, landAt(frame.offsetX + (x + .5) * texel, frame.offsetY + (y + .5) * texel))) * 255);
    let sum = 0, weight = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const w = (2 - Math.abs(dx)) * (2 - Math.abs(dy));
      sum += (1 - clear[yy * width + xx]) * w; weight += w;
    }
    const value = Math.round(sum / weight * 255);
    data[y * width + x] = value;
    if (value > 0) found = true;
  }
  return found ? { data, land, width, height, offsetX: frame.offsetX, offsetY: frame.offsetY, texelPx: texel } : null;
}

/** Creep at a world point, bilinear between texel centres; 0 outside the field. */
export function voidCreepAt(creep: VoidCreepField, x: number, y: number): number {
  return sampleBytes(creep, creep.data, x, y);
}

/** Land share at a world point, bilinear; 0 outside the field. */
export function voidCreepLandAt(creep: VoidCreepField, x: number, y: number): number {
  return sampleBytes(creep, creep.land, x, y);
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

/**
 * Spore points over established land creep (x, y, creep triples): a jittered cell grid, denser
 * where the creep is deeper, capped for the GPU layer. Deterministic per World seed.
 */
export function voidCreepSporePoints(creep: VoidCreepField, seed: number): number[] {
  const points: number[] = [];
  const right = creep.offsetX + creep.width * creep.texelPx, bottom = creep.offsetY + creep.height * creep.texelPx;
  for (let cy = 0, y = creep.offsetY; y < bottom; cy++, y += SPORE_CELL_PX)
    for (let cx = 0, x = creep.offsetX; x < right; cx++, x += SPORE_CELL_PX) {
      const px = x + hash(cx, cy, seed ^ 0x51) * SPORE_CELL_PX, py = y + hash(cx, cy, seed ^ 0x52) * SPORE_CELL_PX;
      const amount = voidCreepAt(creep, px, py);
      if (amount < SPORE_FROM || voidCreepLandAt(creep, px, py) < .9 || hash(cx, cy, seed ^ 0x53) > amount * .7) continue;
      points.push(px, py, amount);
      if (points.length >= MAX_GROUND_SPORES * 3) return points;
    }
  return points;
}
