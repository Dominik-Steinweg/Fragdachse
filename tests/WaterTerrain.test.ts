import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { WaterGeometry } from '../src/arena/WaterGeometry';
import { WaterSurfaceModel, WATER_MASK_HALO, WATER_MASK_STEP, waterBlobDistance } from '../src/arena/WaterSurfaceModel';
import { AutoTiler } from '../src/arena/AutoTiler';
import { CELL_SIZE, getArenaMetricsProfile } from '../src/config';
import { getCoopDefenseMapConfig, normalizeCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import { resolveWorldMetrics } from '../src/world/WorldMetrics';
import { ArenaObstacleIndex } from '../src/systems/ArenaObstacleIndex';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import { RockGridIndex } from '../src/arena/RockGridIndex';

const metrics = resolveWorldMetrics(getArenaMetricsProfile('coop_defense', 'ARENA', 400, 80));
const cell = { gridX: 8, gridY: 8 };
const x = metrics.offsetX + (cell.gridX + .5) * CELL_SIZE;
const y = metrics.offsetY + (cell.gridY + .5) * CELL_SIZE;

describe('Water terrain contracts', () => {
  it.each([1, -1])('slides diagonally along a bank without losing tangential speed (%s)', direction => {
    const water = new WaterGeometry(Array.from({ length: 8 }, (_, i) => ({ gridX: 8, gridY: 5 + i })), metrics);
    const out = { x: 0, y: 0, vx: 0, vy: 0 };
    const left = x - CELL_SIZE / 2;
    expect(water.slideCircle(left - 40, y, left + 80, y + direction * 40, 12, 120, direction * 40, out)).toBe(true);
    expect(out.x).toBeCloseTo(left - 12, 3);
    expect(out.y).toBeCloseTo(y + direction * 40);
    expect(out.vx).toBe(0);
    expect(out.vy).toBe(direction * 40);
    expect(water.isCircleBlocked(out.x, out.y, 12)).toBe(false);
  });

  it('uses round body corners and sweeps the slide against a second bank', () => {
    const water = new WaterGeometry([cell], metrics);
    const out = { x: 0, y: 0, vx: 0, vy: 0 };
    const left = x - CELL_SIZE / 2, top = y - CELL_SIZE / 2;
    expect(water.slideCircle(left - 10, top - 10, left - 8, top - 10, 12, 2, 0, out)).toBe(false);
    expect(out.x).toBe(left - 8);
    const corner = new WaterGeometry([
      ...Array.from({ length: 8 }, (_, i) => ({ gridX: 8, gridY: 5 + i })),
      ...Array.from({ length: 4 }, (_, i) => ({ gridX: 5 + i, gridY: 10 })),
    ], metrics);
    corner.slideCircle(left - 40, y, left + 300, y + 300, 12, 300, 300, out);
    expect(out.x).toBeLessThanOrEqual(left - 12);
    expect(out.y).toBeLessThanOrEqual(metrics.offsetY + 10 * CELL_SIZE - 12);
    expect(corner.isCircleBlocked(out.x, out.y, 12)).toBe(false);
    expect(Math.hypot(out.vx, out.vy)).toBeCloseTo(0);
  });

  it('blocks ground clearance and swept motion without entering shot obstacle traversal', () => {
    const water = new WaterGeometry([cell], metrics);
    const index = new ArenaObstacleIndex({ bounds: () => ({ offsetX: metrics.offsetX, offsetY: metrics.offsetY,
      width: metrics.widthPx, height: metrics.heightPx }), rocks: () => [], trunks: () => [], bases: () => [] });
    index.setWaterGeometry(water);
    expect(index.isCircleBlocked(x, y, 10)).toBe(true);
    expect(index.isCircleBlocked(x - CELL_SIZE, y, 10)).toBe(false);
    const hits: unknown[] = [];
    index.querySegment(x - 100, y, x + 100, y, (...args) => { hits.push(args); return false; }, () => false);
    expect(hits).toEqual([]);
    expect(water.sweep(x - 100, y, x + 100, y, 10)).toBeLessThan(.5);
    expect(water.sweep(x - 100, y - 100, x + 100, y + 100, 10)).toBeLessThan(.5);
    expect(water.sweep(x - 100, y - CELL_SIZE / 2 - 10, x + 100, y - CELL_SIZE / 2 - 10, 10)).toBe(1);
    index.setWaterGeometry(null);
    expect(index.isCircleBlocked(x, y, 10)).toBe(false);
  });

  it('rejects construction on water even when runtime replacements are allowed', () => {
    const layout = { seed: 1, rocks: [], trees: [], dirt: [], tracks: [], powerUpPedestals: [], water: [cell] };
    const placement = new PlacementSystem(layout, new RockGridIndex([]), { getAllPlayers: () => [] } as never, metrics);
    expect(placement.canPlaceSingleCell(cell.gridX, cell.gridY)).toBe(false);
    expect(placement.canPlaceSingleCell(cell.gridX - 1, cell.gridY)).toBe(true);
  });

  it('generates reproducible water and reserves it from scenery and pickups', () => {
    const map = getCoopDefenseMapConfig('0');
    const input = resolveArenaGenerationInput('coop_defense', metrics);
    const layout = ArenaGenerator.generate(183, input, map);
    expect(layout.water).toEqual(map.water);
    expect(layout.water!.length).toBeGreaterThan(0);
    const occupied = new Set(layout.water!.map(c => `${c.gridX},${c.gridY}`));
    for (const c of [...layout.rocks, ...layout.trees, ...layout.powerUpPedestals, ...layout.dirt, ...(layout.decals ?? [])]) {
      expect(occupied.has(`${c.gridX},${c.gridY}`)).toBe(false);
    }
    expect(ArenaGenerator.fingerprint(ArenaGenerator.generate(183, input, map))).toBe(ArenaGenerator.fingerprint(layout));
  });

  it('rejects invalid authored coordinates, duplicates and structural overlaps', () => {
    // This fixture has no persistent site, so its normalized base shapes remain valid authoring inputs.
    const map = getCoopDefenseMapConfig('0');
    for (const water of [[{ gridX: -1, gridY: 3 }], [{ gridX: 3.5, gridY: 4 }], [cell, cell],
      [{ gridX: 1, gridY: 39 }]]) {
      expect(() => normalizeCoopDefenseMapConfig({ ...map, water })).toThrow(/water/i);
    }
  });

  it('supports all 47 neighbor forms with continuous connected edges', () => {
    const masks = new Set<number>();
    const offsets = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
    for (let raw = 0; raw < 256; raw++) masks.add(AutoTiler.computeMask(0, 0,
      (gx, gy) => offsets.some(([dx,dy], i) => gx === dx && gy === dy && !!(raw & (1 << i)))));
    expect(masks.size).toBe(47);
    for (const mask of masks) {
      expect(waterBlobDistance(mask, CELL_SIZE / 2, CELL_SIZE / 2)).toBeGreaterThan(0);
      expect(Number.isFinite(waterBlobDistance(mask, 1, 1))).toBe(true);
    }
    const model = new WaterSurfaceModel([{ gridX: 0, gridY: 0 }, { gridX: 1, gridY: 0 }]);
    expect(model.sample(CELL_SIZE - .001, CELL_SIZE / 2)).toBeCloseTo(model.sample(CELL_SIZE + .001, CELL_SIZE / 2));
  });

  it.each([false, true])('bakes matching mask pixels across either chunk axis (vertical: %s)', vertical => {
    const cells = Array.from({ length: 20 * 20 }, (_, i) => ({ gridX: 8 + i % 20, gridY: 8 + Math.floor(i / 20) }));
    const model = new WaterSurfaceModel(cells);
    const left = model.bake(0, 0, 512), right = model.bake(vertical ? 0 : 512, vertical ? 512 : 0, 512);
    for (let py = WATER_MASK_HALO / WATER_MASK_STEP; py < left.size - WATER_MASK_HALO / WATER_MASK_STEP; py++) {
      for (let dx = -2; dx <= 2; dx++) {
        const lp = (512 + WATER_MASK_HALO) / WATER_MASK_STEP + dx, rp = WATER_MASK_HALO / WATER_MASK_STEP + dx;
        const li = (vertical ? lp * left.size + py : py * left.size + lp) * 4;
        const ri = (vertical ? rp * right.size + py : py * right.size + rp) * 4;
        expect(left.data[li + 2]).toBe(right.data[ri + 2]);
        expect(Math.abs(left.data[li] - right.data[ri])).toBeLessThanOrEqual(1);
      }
    }
  });
});
