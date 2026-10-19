import { ecologyHash } from './ecologyHash';

/** Patch radius over a void plant colony, world px; each patch varies by this share. */
const PLANT_PATCH_PX = 70, PLANT_PATCH_JITTER = .35;
/** Ground patches: noise cells of this many world px, the top share of which keeps haze. */
const GROUND_PATCH_SCALE = 150, GROUND_PATCH_FROM = .74, GROUND_PATCH_FULL = .84;
/** Only where the void has really taken the ground do ground patches stay. */
const GROUND_TAKEN_FROM = .55;
const BUCKET_PX = 192;

const smooth = (edge0: number, edge1: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Where the spore haze lingers after its place was deactivated (user 2026-10-19: "nur noch
 * kleine Flächen übrig, diese aber weiterhin recht dicht"): small dense patches over the void
 * plants that remain as a scar (lily and rock colonies) and a few on soaked ground, so infested
 * plants never stand in clear air. Deterministic per World seed, presentation only.
 */
export class VoidHazeResidue {
  private readonly buckets = new Map<string, number[]>();

  /**
   * `plants` are flat x, y, amount triples of void plant colonies; `takenAt` is the share of
   * void-taken ground at a point.
   */
  constructor(plants: readonly number[], private readonly takenAt: (x: number, y: number) => number, private readonly seed: number) {
    for (let i = 0; i + 2 < plants.length; i += 3) {
      const x = plants[i], y = plants[i + 1], amount = Math.max(0, Math.min(1, plants[i + 2]));
      if (amount <= .05) continue;
      const radius = PLANT_PATCH_PX * (1 - PLANT_PATCH_JITTER + 2 * PLANT_PATCH_JITTER * ecologyHash(x, y, seed + 0x71)) * (.6 + .4 * amount);
      const key = `${Math.floor(x / BUCKET_PX)},${Math.floor(y / BUCKET_PX)}`;
      let bucket = this.buckets.get(key);
      if (!bucket) this.buckets.set(key, bucket = []);
      bucket.push(x, y, radius);
    }
  }

  /** 0..1: how much of the haze stays here; patches are dense inside and feathered at the rim. */
  at(x: number, y: number): number {
    let keep = 0;
    const bx = Math.floor(x / BUCKET_PX), by = Math.floor(y / BUCKET_PX);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const bucket = this.buckets.get(`${bx + dx},${by + dy}`);
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i += 3) {
        const radius = bucket[i + 2], distance = Math.hypot(x - bucket[i], y - bucket[i + 1]);
        if (distance >= radius * 1.3) continue;
        const rim = (this.noise(x / (radius * .6), y / (radius * .6), 3) - .5) * radius * .45;
        keep = Math.max(keep, 1 - smooth(radius * .45, radius, distance + rim));
      }
    }
    if (keep >= 1) return 1;
    const taken = this.takenAt(x, y);
    if (taken > GROUND_TAKEN_FROM) {
      const patch = .75 * this.noise(x / GROUND_PATCH_SCALE, y / GROUND_PATCH_SCALE, 1) + .25 * this.noise(x / GROUND_PATCH_SCALE * 2.3, y / GROUND_PATCH_SCALE * 2.3, 2);
      keep = Math.max(keep, smooth(GROUND_PATCH_FROM, GROUND_PATCH_FULL, patch) * smooth(GROUND_TAKEN_FROM, .85, taken));
    }
    return keep;
  }

  private noise(x: number, y: number, salt: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const corner = (cx: number, cy: number): number => ecologyHash(cx, cy, this.seed * 17 + salt);
    const top = corner(ix, iy) + (corner(ix + 1, iy) - corner(ix, iy)) * u;
    const bottom = corner(ix, iy + 1) + (corner(ix + 1, iy + 1) - corner(ix, iy + 1)) * u;
    return top + (bottom - top) * v;
  }
}
