import { describe, expect, it } from 'vitest';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';
import { LightOccluderIndex } from '../src/effects/LightOccluderIndex';

/**
 * Minimaler Stand-in für die Phaser-Objekte, aus denen der Index gebaut wird.
 * `LightOccluderIndex` importiert Phaser nur als Typ und ruft ausschließlich
 * `getBounds()` auf den übergebenen Objekten auf – deshalb reicht dieses Fake hier,
 * ohne DOM oder Renderer.
 */
class FakeBox {
  active = true;

  constructor(
    private readonly centerX: number,
    private readonly centerY: number,
    private readonly size = CELL_SIZE,
  ) {}

  getBounds(output?: { left: number; top: number; right: number; bottom: number }) {
    const half = this.size / 2;
    const bounds = output ?? ({} as { left: number; top: number; right: number; bottom: number });
    bounds.left = this.centerX - half;
    bounds.top = this.centerY - half;
    bounds.right = this.centerX + half;
    bounds.bottom = this.centerY + half;
    return bounds;
  }
}

function worldPosition(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE / 2,
    y: ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE / 2,
  };
}

function countOccluders(
  index: LightOccluderIndex,
  x: number,
  y: number,
  radius: number,
): { rects: number; circles: number } {
  let rects = 0;
  let circles = 0;
  index.queryCircle(x, y, radius, () => { rects += 1; }, () => { circles += 1; });
  return { rects, circles };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- FakeBox ersetzt Phaser-Objekte */
type AnyBox = any;

describe('LightOccluderIndex', () => {
  it('meldet jeden Occluder pro Abfrage genau einmal, auch über Bucket-Grenzen hinweg', () => {
    const spot = worldPosition(5, 5);
    // Eine Basis ist deutlich größer als ein Bucket und liegt damit in mehreren.
    const bigBase = new FakeBox(spot.x, spot.y, 320);
    const index = new LightOccluderIndex({
      rocks: () => null,
      trunks: () => null,
      baseCells: () => [bigBase as AnyBox],
      baseGeneration: () => 0,
    });

    expect(countOccluders(index, spot.x, spot.y, 400)).toEqual({ rects: 1, circles: 0 });
  });

  it('liefert nur Occluder in Reichweite der Lichtquelle', () => {
    const near = worldPosition(4, 4);
    const far = worldPosition(30, 20);
    const index = new LightOccluderIndex({
      rocks: () => [new FakeBox(near.x, near.y) as AnyBox, new FakeBox(far.x, far.y) as AnyBox],
      trunks: () => null,
      baseCells: () => null,
      baseGeneration: () => 0,
    });

    expect(countOccluders(index, near.x, near.y, 120).rects).toBe(1);
  });

  it('vergisst einen zerstörten Felsen, sobald der gemeinsame Trichter invalidiert', () => {
    const spot = worldPosition(6, 6);
    const rocks: (FakeBox | null)[] = [new FakeBox(spot.x, spot.y)];
    const index = new LightOccluderIndex({
      rocks: () => rocks as AnyBox,
      trunks: () => null,
      baseCells: () => null,
      baseGeneration: () => 0,
    });

    expect(countOccluders(index, spot.x, spot.y, 150).rects).toBe(1);

    // Genau das, was ArenaBuilder.destroyRock() macht: Slot auf null.
    rocks[0] = null;
    // Ohne Invalidierung darf der Cache noch den alten Stand liefern …
    expect(countOccluders(index, spot.x, spot.y, 150).rects).toBe(1);
    // … nach dem Trichter (RockVisualHelper.refreshObstacleVisuals) ist er weg.
    index.markDirty();
    expect(countOccluders(index, spot.x, spot.y, 150).rects).toBe(0);
  });

  it('vergisst eine zerstörte Basis allein anhand der Generation', () => {
    const spot = worldPosition(8, 8);
    let generation = 0;
    let cells: FakeBox[] = [new FakeBox(spot.x, spot.y)];
    const index = new LightOccluderIndex({
      rocks: () => null,
      trunks: () => null,
      baseCells: () => cells as AnyBox,
      baseGeneration: () => generation,
    });

    expect(countOccluders(index, spot.x, spot.y, 150).rects).toBe(1);

    // BaseEntity.handleDestruction() entsorgt die Zell-Bodies, BaseManager zählt hoch.
    cells = [];
    generation += 1;
    expect(countOccluders(index, spot.x, spot.y, 150).rects).toBe(0);
  });

  it('führt Baumstämme als Kreis-Occluder', () => {
    const spot = worldPosition(3, 7);
    const trunk = { active: true, x: spot.x, y: spot.y, radius: 10 };
    const index = new LightOccluderIndex({
      rocks: () => null,
      trunks: () => [trunk as AnyBox],
      baseCells: () => null,
      baseGeneration: () => 0,
    });

    expect(countOccluders(index, spot.x, spot.y, 150)).toEqual({ rects: 0, circles: 1 });
  });
});
