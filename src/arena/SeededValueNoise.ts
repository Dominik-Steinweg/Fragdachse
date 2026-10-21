import { hashSeededCell01 } from './CellHash';

/** Lattice side; the noise wraps after this many periods, far beyond any visible scale. */
const SIZE = 256;
/** A few Worlds' tables at most: the current one, a lobby and a preview. */
const MAX_CACHED = 4;
const tables = new Map<number, Float32Array>();

function table(seed: number): Float32Array {
  const key = seed >>> 0;
  let values = tables.get(key);
  if (!values) {
    values = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < values.length; i++) values[i] = hashSeededCell01(key, i % SIZE, Math.floor(i / SIZE), 0x6e01);
    if (tables.size >= MAX_CACHED) tables.delete(tables.keys().next().value!);
    tables.set(key, values);
  }
  return values;
}

const smooth = (v: number): number => v * v * (3 - 2 * v);

/**
 * Smooth, seeded value noise for per-pixel ground bakes. The lattice is hashed once per seed and
 * shared, so a pixel reads four table entries instead of hashing four lattice corners. Every
 * input is a world-fixed coordinate: chunk partition and bake order never change the result.
 */
export class SeededValueNoise {
  private readonly values: Float32Array;

  constructor(seed: number) {
    this.values = table(seed);
  }

  /** Noise in [0, 1] at a point; each salt reads its own window of the shared lattice. */
  sample(x: number, y: number, period: number, salt: number): number {
    const u = x / period + salt * 37, v = y / period + salt * 71;
    const fx = Math.floor(u), fy = Math.floor(v);
    const tx = smooth(u - fx), ty = smooth(v - fy);
    const x0 = fx & (SIZE - 1), y0 = (fy & (SIZE - 1)) * SIZE;
    const x1 = (x0 + 1) & (SIZE - 1), y1 = ((fy + 1) & (SIZE - 1)) * SIZE;
    const l = this.values, a = l[y0 + x0], b = l[y0 + x1], c = l[y1 + x0], d = l[y1 + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
}
