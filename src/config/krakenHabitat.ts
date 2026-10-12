import * as v from 'valibot';
import type { WaterCell } from '../types';

const id = v.pipe(v.string(), v.trim(), v.minLength(1));
const coordinate = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const cell = v.strictObject({ gridX: coordinate, gridY: coordinate });
/** World grid CELL CENTERS. Convert once via WorldMetrics; these are not navigation indices. */
export const KrakenHabitatSchema = v.strictObject({
  id, kind: v.literal('water'), initialAnchorId: id,
  waterAnchors: v.pipe(v.array(v.strictObject({ id, cell })), v.minLength(1)),
  shores: v.pipe(v.array(v.strictObject({ id, waterCell: cell, landCell: cell })), v.minLength(1)),
  exits: v.pipe(v.array(v.strictObject({ id, fromAnchorId: id, shoreId: id,
    widthCells: v.pipe(v.number(), v.finite(), v.minValue(Number.MIN_VALUE)),
    path: v.pipe(v.array(cell), v.minLength(2)),
  })), v.minLength(1)),
});
export type KrakenHabitatConfig = v.InferOutput<typeof KrakenHabitatSchema>;

export interface KrakenHabitatValidationContext {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly water: readonly WaterCell[];
  /** Provided by the boss registry when the Activity binds this habitat. */
  readonly bodyRadiusCells?: number;
}

/** Static authoring validation only. Runtime reservations, obstacles and navigation remain A's
 * KrakenHabitatRules responsibility; a normalized map is NOT a habitat-validated spawn permit.
 */
export function normalizeKrakenHabitat(raw: unknown, context: KrakenHabitatValidationContext): KrakenHabitatConfig {
  const h = v.parse(KrakenHabitatSchema, raw);
  const key = (c: { gridX: number; gridY: number }) => `${c.gridX},${c.gridY}`;
  const water = new Set(context.water.map(key));
  const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(`[krakenHabitat] ${message}`); };
  assert(Number.isSafeInteger(context.widthCells) && context.widthCells > 0
    && Number.isSafeInteger(context.heightCells) && context.heightCells > 0, 'Invalid world dimensions');
  const r = context.bodyRadiusCells ?? 0;
  assert(Number.isFinite(r) && r >= 0, 'Invalid body radius');
  for (const collection of [h.waterAnchors, h.shores, h.exits]) {
    assert(new Set(collection.map(e => e.id)).size === collection.length, 'Duplicate habitat ID');
  }
  const inside = (c: { gridX: number; gridY: number }) => c.gridX < context.widthCells && c.gridY < context.heightCells;
  const initial = h.waterAnchors.find(a => a.id === h.initialAnchorId);
  assert(!!initial, 'Unknown initial anchor');
  const connected = new Set<string>();
  const queue = [initial!.cell];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    if (!inside(c) || c.gridX < 0 || c.gridY < 0 || !water.has(key(c)) || connected.has(key(c))) continue;
    connected.add(key(c));
    queue.push({ gridX: c.gridX - 1, gridY: c.gridY }, { gridX: c.gridX + 1, gridY: c.gridY },
      { gridX: c.gridX, gridY: c.gridY - 1 }, { gridX: c.gridX, gridY: c.gridY + 1 });
  }
  const footprint = (c: { gridX: number; gridY: number }, wet: boolean) => {
    const x = c.gridX + .5, y = c.gridY + .5;
    if (!inside(c) || x - r < 0 || y - r < 0 || x + r > context.widthCells || y + r > context.heightCells) return false;
    if (!r) return water.has(key(c)) === wet;
    for (let gy = Math.floor(y - r); gy <= Math.floor(y + r); gy++) {
      for (let gx = Math.floor(x - r); gx <= Math.floor(x + r); gx++) {
        const dx = x - Math.max(gx, Math.min(x, gx + 1)), dy = y - Math.max(gy, Math.min(y, gy + 1));
        if (dx * dx + dy * dy < r * r && water.has(`${gx},${gy}`) !== wet) return false;
      }
    }
    return true;
  };
  for (const a of h.waterAnchors) assert(connected.has(key(a.cell)) && footprint(a.cell, true), 'Water anchor must cover the full body in one pond');
  for (const s of h.shores) assert(inside(s.landCell) && connected.has(key(s.waterCell)) && !water.has(key(s.landCell))
    && Math.abs(s.waterCell.gridX - s.landCell.gridX) + Math.abs(s.waterCell.gridY - s.landCell.gridY) === 1,
  'Shore must join adjacent water/dry cells');
  for (const e of h.exits) {
    const from = h.waterAnchors.find(a => a.id === e.fromAnchorId), shore = h.shores.find(s => s.id === e.shoreId);
    assert(!!from && !!shore, 'Unknown exit anchor/shore');
    assert(e.widthCells >= 2 * r && key(e.path[0]) === key(from!.cell), 'Exit must fit the body and start at its anchor');
    assert(e.path.every(inside) && e.path.every((p, i) => !i || key(p) !== key(e.path[i - 1])), 'Invalid exit path');
    const halfWidth = e.widthCells / 2;
    assert(e.path.every(p => p.gridX + .5 - halfWidth >= 0 && p.gridY + .5 - halfWidth >= 0
      && p.gridX + .5 + halfWidth <= context.widthCells && p.gridY + .5 + halfWidth <= context.heightCells),
    'Exit corridor leaves world bounds');
    assert(e.path.some(p => key(p) === key(shore!.landCell)), 'Exit must pass its authored shore');
    assert(footprint(e.path[e.path.length - 1], false), 'Exit must end with the full body on land');
  }
  return h;
}
