import { describe, expect, it } from 'vitest';
import {
  STRUCTURE_OUTLINE_RULES,
  deriveStructureEdges,
  isInsideStructure,
  nearestStructurePoint,
  rasterizeStructure,
  structureBounds,
  structureMovementCells,
  structureOccupancyCells,
  validateStructureRects,
  type StructureRect,
} from '../src/arena/StructureOutline';
import { EDGE_BOTTOM, EDGE_LEFT, EDGE_RIGHT, EDGE_TOP } from '../src/effects/lightShadowGeometry';
import { CELL_SIZE } from '../src/config';
import { LOBBY_BUILDINGS, LOBBY_BUILDING_BASES, lobbyBuildingOutline } from '../src/config/authoring/lobbyBuildings';

const ALL = EDGE_TOP | EDGE_BOTTOM | EDGE_LEFT | EDGE_RIGHT;
/** 5x4 cells with a 16-px deep niche in the west face, as compound rects. */
const NICHE: StructureRect[] = [
  { x: 0, y: 0, width: 160, height: 40, edges: ALL },
  { x: 16, y: 40, width: 144, height: 48, edges: EDGE_LEFT | EDGE_RIGHT },
  { x: 0, y: 88, width: 160, height: 40, edges: ALL },
];

describe('structure outline rules', () => {
  it('occupies every overlapped cell but blocks movement only where a cell centre is inside', () => {
    expect(structureOccupancyCells(NICHE)).toHaveLength(20);
    expect(structureMovementCells(NICHE)).toHaveLength(20);
    // A niche deeper than half a cell frees the cell centre for movement, never the occupancy.
    const deep = [{ ...NICHE[0] }, { ...NICHE[1], x: 24, width: 136 }, { ...NICHE[2] }];
    expect(structureOccupancyCells(deep)).toHaveLength(20);
    const movement = structureMovementCells(deep).map(cell => `${cell.gridX}:${cell.gridY}`);
    expect(movement).toHaveLength(18);
    expect(movement).not.toContain('0:1');
    expect(movement).not.toContain('0:2');
    const occupancy = new Set(structureOccupancyCells(deep).map(cell => `${cell.gridX}:${cell.gridY}`));
    expect(movement.every(key => occupancy.has(key))).toBe(true);
  });

  it('finds the nearest wall point from every side, including the niche, and zero inside', () => {
    expect(nearestStructurePoint(NICHE, -6, 64)).toEqual({ x: 16, y: 64, distance: 22 });
    expect(nearestStructurePoint(NICHE, -30, 64).distance).toBeCloseTo(Math.hypot(30, 24));
    expect(nearestStructurePoint(NICHE, 80, -20)).toEqual({ x: 80, y: 0, distance: 20 });
    expect(nearestStructurePoint(NICHE, 190, 64)).toEqual({ x: 160, y: 64, distance: 30 });
    expect(nearestStructurePoint(NICHE, 80, 150)).toEqual({ x: 80, y: 128, distance: 22 });
    expect(nearestStructurePoint(NICHE, -3, -4).distance).toBe(5);
    expect(nearestStructurePoint(NICHE, 80, 64).distance).toBe(0);
    expect(structureBounds(NICHE)).toEqual({ left: 0, top: 0, right: 160, bottom: 128 });
  });

  it('rasterizes exactly on the 8-px grid with half-open edges', () => {
    const raster = rasterizeStructure(NICHE);
    expect(raster).toMatchObject({ originX: 0, originY: 0, step: 8, cols: 20, rows: 16 });
    for (let row = 0; row < raster.rows; row++) for (let col = 0; col < raster.cols; col++) {
      expect(raster.mask[row * raster.cols + col]).toBe(Number(isInsideStructure(NICHE, col * 8 + 4, row * 8 + 4)));
    }
    expect(raster.mask[5 * 20 + 1]).toBe(0);
    expect(raster.mask[5 * 20 + 2]).toBe(1);
    expect(isInsideStructure(NICHE, 160, 10)).toBe(false);
    expect(isInsideStructure(NICHE, 0, 10)).toBe(true);
  });

  it('derives exposed edges so fully shared rect edges cast no light shadow', () => {
    expect(deriveStructureEdges(NICHE)).toEqual(NICHE.map(rect => rect.edges));
    const columns = [{ x: 0, y: 0, width: 32, height: 64 }, { x: 32, y: 0, width: 32, height: 64 }];
    expect(deriveStructureEdges(columns)).toEqual([ALL & ~EDGE_RIGHT, ALL & ~EDGE_LEFT]);
  });

  it('rejects off-grid, slivers, overlaps, too many rects, rects outside the shape and stale edges', () => {
    expect(validateStructureRects({ stepPx: 8, rects: NICHE }, 160, 128)).toEqual([]);
    const errors = (rects: StructureRect[], width = 160, height = 128) => validateStructureRects({ stepPx: 8, rects }, width, height);
    expect(errors([{ ...NICHE[0], x: 4 }])).toContainEqual(expect.stringContaining('grid'));
    expect(errors([{ ...NICHE[0], height: 8 }])).toContainEqual(expect.stringContaining('thinner'));
    expect(errors([{ ...NICHE[0], width: 0 }])).toContainEqual(expect.stringContaining('no area'));
    expect(errors([NICHE[0], { ...NICHE[1], y: 32 }])).toContainEqual(expect.stringContaining('overlaps'));
    expect(errors(NICHE, 128)).toContainEqual(expect.stringContaining('outside'));
    expect(errors([{ ...NICHE[0], edges: EDGE_TOP }])).toContainEqual(expect.stringContaining('edges'));
    expect(errors([])).toContainEqual(expect.stringContaining('no rects'));
    const many = Array.from({ length: STRUCTURE_OUTLINE_RULES.maxRects + 1 }, (_, i) => ({ x: i * 16, y: 0, width: 16, height: 16, edges: 0 }));
    expect(errors(many, 1024)).toContainEqual(expect.stringContaining('more than'));
    expect(validateStructureRects({ stepPx: 4, rects: NICHE }, 160, 128)).toContainEqual(expect.stringContaining('stepPx'));
  });

  it('keeps every authored lobby outline valid, about 5x4 cells and equal to its shape', () => {
    for (const building of LOBBY_BUILDINGS) {
      const outline = lobbyBuildingOutline(building);
      const bounds = structureBounds(outline.rects);
      expect(validateStructureRects(outline, bounds.right, bounds.bottom), building.id).toEqual([]);
      expect([bounds.right / CELL_SIZE, bounds.bottom / CELL_SIZE]).toEqual([5, 4]);
      const base = LOBBY_BUILDING_BASES.find(entry => entry.id === building.id)!;
      expect(base.structure).toEqual(outline);
      expect(base.shape).toEqual({ kind: 'cells', cells: structureOccupancyCells(outline.rects) });
    }
  });
});
