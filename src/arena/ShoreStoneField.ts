import { CELL_SIZE } from '../config';
import type { ArenaLayout } from '../types';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import type { EcologyPlacement, EcologyWaterField } from './WoodlandEcologyField';
import { ecologyHash } from './ecologyHash';
import stones from '../assets/manifests/shore-stones.json';

const families = ['bank', 'shoal', 'scree'].map(prefix => stones.assets.filter(a => a.name.startsWith(prefix)));
const sides = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

/** Low, sediment-bound patches follow the prepared waterline. Their long axis follows
 * the bank; soil tapers into the terrain and the wet half receives the water film. */
export function buildShoreStones(layout: ArenaLayout, frame: ChunkWorldFrame, water: EcologyWaterField,
  fits: (x: number, y: number, radius: number, dry: boolean) => boolean, budget: number): EcologyPlacement[] {
  const cells = [...(layout.water ?? [])].sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
  const wet = new Set(cells.map(c => `${c.gridX},${c.gridY}`));
  const out: EcologyPlacement[] = [];
  const buckets = new Map<string, {x: number; y: number; radius: number}[]>();
  const bucketSize = CELL_SIZE * 2;
  const add = (x: number, y: number, size: number, family: number, angle: number, salt: number): void => {
    if (out.length >= budget || !fits(x, y, size * .71, false)) return;
    // Overlap the feathered sediment margins, while keeping the stone cores apart.
    const radius = size * (family === 0 ? .21 : .16), bx = Math.floor(x / bucketSize), by = Math.floor(y / bucketSize);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      for (const other of buckets.get(`${bx + dx},${by + dy}`) ?? [])
        if (Math.hypot(x - other.x, y - other.y) < radius + other.radius) return;
    const roll = (n: number) => ecologyHash(x, y, layout.seed + salt + n);
    const variants = families[family];
    out.push({kind: 'shore', frame: variants[Math.floor(roll(1) * variants.length)].name,
      x: x + frame.offsetX, y: y + frame.offsetY, size, rotation: angle + (roll(2) - .5) * .32,
      alpha: family === 0 ? .90 + roll(4) * .07 : .60 + roll(4) * .22,
      rank: roll(3) * .65, floating: false});
    const key = `${bx},${by}`, bucket = buckets.get(key) ?? [];
    bucket.push({x, y, radius}); buckets.set(key, bucket);
  };
  for (const cell of cells) {
    if (out.length >= budget) break;
    for (let side = 0; side < sides.length; side++) {
      const [nx, ny] = sides[side], gx = cell.gridX + nx, gy = cell.gridY + ny;
      // A lake continuing outside the World has no bank at the map boundary.
      if (gx < 0 || gy < 0 || gx * CELL_SIZE >= frame.width || gy * CELL_SIZE >= frame.height
        || wet.has(`${gx},${gy}`)) continue;
      const roll = (salt: number) => ecologyHash(cell.gridX, cell.gridY, layout.seed + side * 137 + salt);
      const patch = ecologyHash(Math.floor(cell.gridX / 3), Math.floor(cell.gridY / 3), layout.seed + 811);
      // Loose gravel follows the bank in irregular deposits, with open soil between
      // them. Large stone groups are selected separately and remain rare accents.
      if (roll(13) > .58 + patch * .26) continue;
      const tangent = (roll(17) - .5) * CELL_SIZE * .8;
      const ex = (cell.gridX + .5 + nx * .5) * CELL_SIZE - ny * tangent;
      const ey = (cell.gridY + .5 + ny * .5) * CELL_SIZE + nx * tangent;
      // Bracket the actual mask edge along the inward normal. Corners may have no
      // sufficiently wet interior; skip them instead of inventing another contour.
      let low = -CELL_SIZE, high = CELL_SIZE;
      const target = 3 + roll(19) * 5;
      if (water.distance(ex - nx * high, ey - ny * high) < target
        || water.distance(ex - nx * low, ey - ny * low) >= target) continue;
      for (let i = 0; i < 7; i++) {
        const mid = (low + high) * .5;
        if (water.distance(ex - nx * mid, ey - ny * mid) < target) low = mid; else high = mid;
      }
      const x = ex - nx * high, y = ey - ny * high;
      // Read the smoothed contour normal a little inside the water, where distance
      // is not clipped. The denser earth contacts face land; open gravel faces water.
      const cx = x - nx * 12, cy = y - ny * 12;
      const dx = water.distance(cx + 6, cy) - water.distance(cx - 6, cy);
      const dy = water.distance(cx, cy + 6) - water.distance(cx, cy - 6);
      const length = Math.hypot(dx, dy), ix = length > 1 ? dx / length : -nx, iy = length > 1 ? dy / length : -ny;
      const angle = Math.atan2(-ix, iy), family = roll(23) < .10 ? 0 : 2;
      const size = family === 0 ? 52 + roll(29) * 16 : 42 + roll(29) * 18;
      add(x - ix * 3, y - iy * 3, size, family, angle, side * 173);
      // Only an occasional small deposit extends into the shallows. Fine gravel
      // remains the dominant detail, with a few slightly larger bank accents.
      if (roll(31) < .40 + patch * .16) {
        const along = (roll(37) - .5) * size;
        const inward = 12 + roll(41) * 16;
        const sx = x + iy * along + ix * inward, sy = y - ix * along + iy * inward;
        const distance = water.distance(sx, sy);
        if (distance < 40 && distance >= 6)
          add(sx, sy, 30 + roll(43) * 14, 1, angle, 997 + side);
      }
    }
  }
  return out;
}
