import { describe, expect, it } from 'vitest';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';
import { LightOccluderIndex } from '../src/effects/LightOccluderIndex';
import { EDGE_BOTTOM, EDGE_LEFT, EDGE_RIGHT, EDGE_TOP } from '../src/effects/lightShadowGeometry';

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

/** Kantenmasken aller getroffenen Rechtecke, sortiert nach x dann y. */
function collectExposedEdges(
  index: LightOccluderIndex,
  x: number,
  y: number,
  radius: number,
): Array<{ left: number; top: number; edges: number }> {
  const result: Array<{ left: number; top: number; edges: number }> = [];
  index.queryCircle(x, y, radius, (left, top, _r, _b, edges) => {
    result.push({ left, top, edges });
  }, () => {});
  return result.sort((a, b) => (a.left - b.left) || (a.top - b.top));
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

  it('markiert die Berührungskante zweier benachbarter Felsen als verdeckt', () => {
    const left = worldPosition(10, 10);
    const right = worldPosition(11, 10);
    const index = new LightOccluderIndex({
      rocks: () => [new FakeBox(left.x, left.y) as AnyBox, new FakeBox(right.x, right.y) as AnyBox],
      trunks: () => null,
      baseCells: () => null,
      baseGeneration: () => 0,
    });

    const [westCell, eastCell] = collectExposedEdges(index, left.x, left.y, 200);
    // Linke Zelle: rechte Kante zeigt auf den Nachbarn → nicht freiliegend.
    expect(westCell.edges & EDGE_RIGHT).toBe(0);
    expect(westCell.edges & EDGE_LEFT).toBe(EDGE_LEFT);
    // Rechte Zelle spiegelbildlich.
    expect(eastCell.edges & EDGE_LEFT).toBe(0);
    expect(eastCell.edges & EDGE_RIGHT).toBe(EDGE_RIGHT);
    // Ober- und Unterkanten bleiben bei beiden frei.
    expect(westCell.edges & (EDGE_TOP | EDGE_BOTTOM)).toBe(EDGE_TOP | EDGE_BOTTOM);
  });

  it('lässt eine vollständig umbaute Zelle ohne freiliegende Kante', () => {
    const center = worldPosition(10, 10);
    const neighbours = [[9, 10], [11, 10], [10, 9], [10, 11]] as const;
    const index = new LightOccluderIndex({
      rocks: () => [
        new FakeBox(center.x, center.y) as AnyBox,
        ...neighbours.map(([gx, gy]) => {
          const p = worldPosition(gx, gy);
          return new FakeBox(p.x, p.y) as AnyBox;
        }),
      ],
      trunks: () => null,
      baseCells: () => null,
      baseGeneration: () => 0,
    });

    const middle = collectExposedEdges(index, center.x, center.y, 200)
      .find((entry) => entry.left === center.x - CELL_SIZE / 2 && entry.top === center.y - CELL_SIZE / 2);
    expect(middle?.edges).toBe(0);
  });

  it('verschmilzt Felsen und Basen nicht miteinander', () => {
    const rock = worldPosition(10, 10);
    const base = worldPosition(11, 10);
    const index = new LightOccluderIndex({
      rocks: () => [new FakeBox(rock.x, rock.y) as AnyBox],
      trunks: () => null,
      baseCells: () => [new FakeBox(base.x, base.y) as AnyBox],
      baseGeneration: () => 0,
    });

    const [rockCell, baseCell] = collectExposedEdges(index, rock.x, rock.y, 200);
    // Unterschiedliche Verbünde: die Berührungskante bleibt eine Silhouette.
    expect(rockCell.edges & EDGE_RIGHT).toBe(EDGE_RIGHT);
    expect(baseCell.edges & EDGE_LEFT).toBe(EDGE_LEFT);
  });

  it('verschmilzt benachbarte Basiszellen untereinander', () => {
    const west = worldPosition(6, 12);
    const east = worldPosition(7, 12);
    const index = new LightOccluderIndex({
      rocks: () => null,
      trunks: () => null,
      baseCells: () => [new FakeBox(west.x, west.y) as AnyBox, new FakeBox(east.x, east.y) as AnyBox],
      baseGeneration: () => 0,
    });

    const [westCell, eastCell] = collectExposedEdges(index, west.x, west.y, 200);
    expect(westCell.edges & EDGE_RIGHT).toBe(0);
    expect(eastCell.edges & EDGE_LEFT).toBe(0);
  });

  it('gibt die Berührungskante wieder frei, wenn der Nachbar zerstört wird', () => {
    const west = worldPosition(10, 10);
    const east = worldPosition(11, 10);
    const rocks: (FakeBox | null)[] = [new FakeBox(west.x, west.y), new FakeBox(east.x, east.y)];
    const index = new LightOccluderIndex({
      rocks: () => rocks as AnyBox,
      trunks: () => null,
      baseCells: () => null,
      baseGeneration: () => 0,
    });

    expect(collectExposedEdges(index, west.x, west.y, 200)[0].edges & EDGE_RIGHT).toBe(0);

    rocks[1] = null;
    index.markDirty();
    expect(collectExposedEdges(index, west.x, west.y, 200)[0].edges & EDGE_RIGHT).toBe(EDGE_RIGHT);
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
