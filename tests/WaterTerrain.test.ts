import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { WaterGeometry } from '../src/arena/WaterGeometry';
import { WaterSurfaceModel, WATER_MASK_HALO, WATER_MASK_STEP, WATER_VISUAL_EXPANSION, waterBlobDistance } from '../src/arena/WaterSurfaceModel';
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
  const readMask = (mask: ReturnType<WaterSurfaceModel['bake']>, x: number, y: number, channel: number): number => {
    const px = Math.floor((x + WATER_MASK_HALO) / WATER_MASK_STEP);
    const py = Math.floor((y + WATER_MASK_HALO) / WATER_MASK_STEP);
    return mask.data[(py * mask.size + px) * 4 + channel];
  };

  it('expands straight banks equally in every direction without changing occupancy', () => {
    const cells = Array.from({ length: 8 * 8 }, (_, i) => ({ gridX: 4 + i % 8, gridY: 4 + Math.floor(i / 8) }));
    const model = new WaterSurfaceModel(cells), baked = model.bake(0, 0, 512);
    const geometry = new WaterGeometry(cells, metrics);
    const center = 8 * CELL_SIZE;
    const edge = 4 * CELL_SIZE + CELL_SIZE * .1 - WATER_VISUAL_EXPANSION;
    for (const [x, y] of [[edge, center], [2 * center - edge, center], [center, edge], [center, 2 * center - edge]]) {
      // Locate the half-coverage contour to within one mask texel; not an alpha tuning snapshot.
      const dx = Math.sign(center - x), dy = Math.sign(center - y);
      expect(readMask(baked, x + dx * WATER_MASK_STEP, y + dy * WATER_MASK_STEP, 2)).toBeGreaterThan(127);
      expect(readMask(baked, x - dx * WATER_MASK_STEP, y - dy * WATER_MASK_STEP, 2)).toBeLessThan(128);
    }
    expect(geometry.hasCell(3, 8)).toBe(false);
    expect(geometry.hasCell(4, 8)).toBe(true);
    expect(readMask(baked, 4 * CELL_SIZE - 1, center, 2)).toBeGreaterThan(127);
  });

  it('gives a one-neighbor water tip a continuous visible mask beyond its authored cell', () => {
    const cells = Array.from({ length: 6 * 6 }, (_, i) => ({ gridX: 5 + i % 6, gridY: 5 + Math.floor(i / 6) }));
    cells.push({ gridX: 4, gridY: 8 });
    const model = new WaterSurfaceModel(cells), baked = model.bake(0, 0, 512);
    const tipX = 4.5 * CELL_SIZE, tipY = 8.5 * CELL_SIZE;
    expect(readMask(baked, tipX, tipY, 2)).toBeGreaterThan(127);
    expect(readMask(baked, tipX, 8 * CELL_SIZE - 1, 2)).toBeGreaterThan(0);
    const distances = [0, 8, 16, 24, 32].map(dx => readMask(baked, tipX + dx, tipY, 0));
    expect(distances[0]).toBeGreaterThan(0);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('keeps empty water empty and bounds expanded chunk residency to the world', () => {
    const empty = new WaterSurfaceModel([]), mask = empty.bake(0, 0, 64);
    expect(empty.getChunkOrigins(512, 1024, 1024)).toEqual([]);
    expect(mask.data.every((value, i) => i % 4 === 3 ? value === 255 : value === 0)).toBe(true);
    expect(new WaterSurfaceModel([{ gridX: 0, gridY: 0 }]).getChunkOrigins(512, 512, 512)).toEqual([{ x: 0, y: 0 }]);
  });

  it.each([false, true])('keeps the expanded exterior bank seamless at a chunk edge (vertical: %s)', vertical => {
    const cells = Array.from({ length: 4 * 4 }, (_, i) => ({ gridX: 12 + i % 4, gridY: 12 + Math.floor(i / 4) }));
    const model = new WaterSurfaceModel(cells);
    const a = model.bake(0, 0, 512), b = model.bake(vertical ? 0 : 512, vertical ? 512 : 0, 512);
    for (let along = 370; along < 550; along += 2) for (let across = 500; across < 530; across += 2)
      for (const channel of [0, 2]) {
        const x = vertical ? along : across, y = vertical ? across : along;
        expect(Math.abs(readMask(a, x, y, channel) - readMask(b, x - (vertical ? 0 : 512), y - (vertical ? 512 : 0), channel))).toBeLessThanOrEqual(1);
      }
  });

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

  it.each([[1, 0], [-1, 0], [0, 1], [0, -1], [Math.SQRT1_2, Math.SQRT1_2]])(
    'keeps a growing recovery hitbox outside water (%s, %s)', (nx, ny) => {
      const water = new WaterGeometry([cell], metrics);
      const bankX = x + Math.sign(nx) * CELL_SIZE / 2;
      const bankY = y + Math.sign(ny) * CELL_SIZE / 2;
      const out = { x: bankX + nx * 6, y: bankY + ny * 6, vx: 0, vy: 0 };
      for (let radius = 7; radius <= 12; radius++) {
        const sx = out.x, sy = out.y;
        water.slideCircle(sx, sy, sx - nx * 2, sy - ny * 2, radius, -nx * 120, -ny * 120, out);
        expect(water.isCircleBlocked(out.x, out.y, radius)).toBe(false);
        expect(out.vx * nx + out.vy * ny).toBeGreaterThanOrEqual(-1e-7);
      }
      expect(water.slideCircle(out.x, out.y, out.x, out.y, 14, 0, 0, out)).toBe(true);
      expect(water.isCircleBlocked(out.x, out.y, 14)).toBe(false);
    },
  );

  it('separates a growing circle from both banks while preserving movement away from water', () => {
    const left = x - CELL_SIZE / 2, top = y - CELL_SIZE / 2;
    const water = new WaterGeometry([
      { gridX: 8, gridY: 7 }, { gridX: 7, gridY: 8 }, cell,
    ], metrics);
    const sx = left - 6, sy = top - 6;
    const out = { x: 0, y: 0, vx: 0, vy: 0 };
    water.slideCircle(sx, sy, sx - 3, sy - 4, 12, -30, -40, out);
    expect(water.isCircleBlocked(out.x, out.y, 12)).toBe(false);
    expect(out.x).toBeCloseTo(left - 12 - 3, 3);
    expect(out.y).toBeCloseTo(top - 12 - 4, 3);
    expect(out.vx).toBe(-30);
    expect(out.vy).toBe(-40);
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

  it.each(['0', '1'])('generates reproducible water and reserves it from scenery and pickups on Map %s', mapId => {
    const map = getCoopDefenseMapConfig(mapId);
    const mapMetrics = resolveWorldMetrics(getArenaMetricsProfile('coop_defense', 'ARENA', map.arenaWidthCells, map.arenaHeightCells));
    const input = resolveArenaGenerationInput('coop_defense', mapMetrics);
    const layout = ArenaGenerator.generate(183, input, map);
    expect(layout.water).toEqual(map.water);
    expect(layout.water!.length).toBeGreaterThan(0);
    const occupied = new Set(layout.water!.map(c => `${c.gridX},${c.gridY}`));
    for (const c of [...layout.rocks, ...layout.trees, ...layout.powerUpPedestals, ...layout.dirt, ...(layout.decals ?? [])]) {
      expect(occupied.has(`${c.gridX},${c.gridY}`)).toBe(false);
    }
    for (const track of layout.tracks) {
      expect(occupied.has(`${track.gridX},${track.gridY}`)).toBe(false);
      expect(occupied.has(`${track.gridX + 1},${track.gridY}`)).toBe(false);
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
