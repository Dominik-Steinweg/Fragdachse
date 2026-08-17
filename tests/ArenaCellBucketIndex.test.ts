import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, MULTIPLY: 1 },
  Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) },
  GameObjects: { Image: class {} },
}));

import { CELL_SIZE } from '../src/config';
import { ArenaCellBucketIndex } from '../src/arena/chunks/ArenaCellBucketIndex';
import { RockViewportCuller } from '../src/arena/chunks/RockViewportCuller';
import { ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX } from '../src/arena/chunks/ArenaChunkGrid';
import type { RockCell } from '../src/types';

/**
 * Der raeumliche Index und die Sichtbarkeitsauswahl der Felsen.
 *
 * Beide ersetzen einen Durchlauf ueber den gesamten Felsbestand. Die Zusicherung ist deshalb
 * nicht "schneller", sondern **vollstaendig**: Der Index darf nie eine Zelle unterschlagen, die
 * der vorherige Vollscan gefunden haette. Eine fehlende Zelle waere im Spiel kein Absturz,
 * sondern ein fehlender Streifen Bewuchs oder ein faelschlich wegradiertes Decal.
 */

const FRAME = { offsetX: 0, offsetY: 12, width: 400 * CELL_SIZE, height: 80 * CELL_SIZE };

function grid(cols: number, rows: number): RockCell[] {
  const cells: RockCell[] = [];
  for (let gridY = 0; gridY < rows; gridY += 1) {
    for (let gridX = 0; gridX < cols; gridX += 1) cells.push({ gridX, gridY });
  }
  return cells;
}

/** Der Vollscan, den der Index ersetzt – die Referenz fuer jeden Vergleich. */
function scanAll(cells: readonly RockCell[], localX: number, localY: number, size: number, reach: number): number[] {
  const hits: number[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const minX = cell.gridX * CELL_SIZE;
    const minY = cell.gridY * CELL_SIZE;
    if (minX + CELL_SIZE + reach > localX && minX - reach < localX + size
      && minY + CELL_SIZE + reach > localY && minY - reach < localY + size) {
      hits.push(index);
    }
  }
  return hits;
}

describe('arena cell bucket index', () => {
  it('returns a superset of the full scan for every region and reach', () => {
    const cells = grid(60, 30);
    const index = new ArenaCellBucketIndex(FRAME.width);
    index.sync(cells);

    for (const size of [128, 512]) {
      for (const reach of [0, 32, 76.8, 160]) {
        for (const localX of [0, 96, 512, 1024]) {
          for (const localY of [0, 64, 384]) {
            const expected = scanAll(cells, localX, localY, size, reach);
            const actual = new Set(index.collect(localX, localY, size, reach));
            for (const hit of expected) {
              expect(actual.has(hit), `missing ${hit} at ${localX}/${localY} size ${size} reach ${reach}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('stays far smaller than the full inventory for a single dirty chunk', () => {
    const cells = grid(400, 80);
    const index = new ArenaCellBucketIndex(FRAME.width);
    index.sync(cells);

    const candidates = index.collect(5_000, 1_000, 128, 76.8);
    expect(candidates.length).toBeGreaterThan(0);
    // Genau darum geht es: Eine Dirty-Region sieht ein paar hundert Kandidaten, nicht 32 000.
    expect(candidates.length).toBeLessThan(cells.length / 50);
  });

  it('only indexes new entries on repeated sync', () => {
    const cells = grid(4, 4);
    const index = new ArenaCellBucketIndex(FRAME.width);
    index.sync(cells);
    index.sync(cells);
    expect(index.size).toBe(cells.length);

    const before = index.collect(0, 0, 128, 0).length;
    index.sync(cells);
    expect(index.collect(0, 0, 128, 0)).toHaveLength(before);
  });

  it('grows with the source instead of rebuilding', () => {
    const cells = grid(4, 4);
    const index = new ArenaCellBucketIndex(FRAME.width);
    index.sync(cells);
    cells.push({ gridX: 20, gridY: 20 });
    index.sync(cells);
    expect(index.collect(20 * CELL_SIZE, 20 * CELL_SIZE, CELL_SIZE, 0)).toContain(cells.length - 1);
  });

  it('does not let a column beyond the frame collide with the next row', () => {
    const narrow = new ArenaCellBucketIndex(256);
    narrow.sync([{ gridX: 0, gridY: 4 }]);
    // Zelle (0, 4) liegt bei y = 128, also in Bucketzeile 1. Eine Abfrage, die klar in Zeile 0
    // bleibt, darf sie nicht finden – sonst hiesse das, dass Spalten- und Zeilenschluessel sich
    // ueberlagern.
    expect(narrow.collect(0, 0, 64, 0)).toHaveLength(0);
    expect(narrow.collect(0, 128, 64, 0)).toHaveLength(1);
    // Eine Abfrage jenseits der Rahmenbreite darf ebenfalls keine fremde Zeile treffen.
    expect(narrow.collect(4_000, 0, 64, 0)).toHaveLength(0);
  });

  it('rejects a bucket size that would split a cell', () => {
    expect(() => new ArenaCellBucketIndex(1024, 48)).toThrow();
  });
});

interface FakeRockImage {
  active: boolean;
  visible: boolean;
  setVisible(visible: boolean): FakeRockImage;
}

function fakeRockImages(count: number): FakeRockImage[] {
  return Array.from({ length: count }, () => {
    const image: FakeRockImage = {
      active: true,
      visible: true,
      setVisible(visible: boolean) { image.visible = visible; return image; },
    };
    return image;
  });
}

describe('rock viewport culler', () => {
  it('hides the whole inventory before the first camera update', () => {
    const cells = grid(60, 30);
    const images = fakeRockImages(cells.length);
    new RockViewportCuller(FRAME, cells, images as never);
    expect(images.every((image) => !image.visible)).toBe(true);
  });

  it('shows only the rocks around the view', () => {
    const cells = grid(400, 80);
    const images = fakeRockImages(cells.length);
    const culler = new RockViewportCuller(FRAME, cells, images as never);

    culler.update({ x: 0, y: 12, width: 1920, height: 1080 });

    const visible = images.filter((image) => image.visible).length;
    expect(visible).toBeGreaterThan(0);
    // Grob der Bildausschnitt plus Rand – keinesfalls der gesamte Bestand.
    expect(visible).toBeLessThan(cells.length / 8);

    // Eine Zelle weit im Osten bleibt verdeckt ...
    const farEast = cells.findIndex((cell) => cell.gridX === 380 && cell.gridY === 40);
    expect(images[farEast].visible).toBe(false);
    // ... und eine im Ausschnitt ist sichtbar.
    const nearOrigin = cells.findIndex((cell) => cell.gridX === 10 && cell.gridY === 10);
    expect(images[nearOrigin].visible).toBe(true);
  });

  it('follows the camera east and releases what it leaves behind', () => {
    const cells = grid(400, 80);
    const images = fakeRockImages(cells.length);
    const culler = new RockViewportCuller(FRAME, cells, images as never);

    culler.update({ x: 0, y: 12, width: 1920, height: 1080 });
    const nearOrigin = cells.findIndex((cell) => cell.gridX === 10 && cell.gridY === 10);
    expect(images[nearOrigin].visible).toBe(true);

    culler.update({ x: 9_000, y: 12, width: 1920, height: 1080 });
    expect(images[nearOrigin].visible).toBe(false);
    const farEast = cells.findIndex((cell) => cell.gridX === 300 && cell.gridY === 20);
    expect(images[farEast].visible).toBe(true);
  });

  it('does not touch anything while the camera stands still', () => {
    const cells = grid(60, 30);
    const images = fakeRockImages(cells.length);
    const culler = new RockViewportCuller(FRAME, cells, images as never);
    const view = { x: 0, y: 12, width: 1920, height: 1080 };
    culler.update(view);

    const calls = images.map((image) => {
      const spy = vi.spyOn(image, 'setVisible');
      return spy;
    });
    culler.update(view);
    expect(calls.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it('leaves destroyed rocks alone', () => {
    const cells = grid(60, 30);
    const images = fakeRockImages(cells.length);
    const culler = new RockViewportCuller(FRAME, cells, images as never);
    images[5].active = false;

    culler.update({ x: 0, y: 12, width: 1920, height: 1080 });

    // `active` ist die Wahrheit ueber "steht dieser Fels noch"; die Cullung fasst ihn nicht an.
    expect(images[5].visible).toBe(false);
  });

  it('applies the current state to a rock built at runtime', () => {
    const cells = grid(400, 80);
    const images = fakeRockImages(cells.length);
    const culler = new RockViewportCuller(FRAME, cells, images as never);
    culler.update({ x: 0, y: 12, width: 1920, height: 1080 });

    const inside = fakeRockImages(1)[0];
    culler.applyTo(inside as never, 10, 10);
    expect(inside.visible).toBe(true);

    const outside = fakeRockImages(1)[0];
    culler.applyTo(outside as never, 380, 40);
    expect(outside.visible).toBe(false);
  });

  it('acquires slightly beyond the visible edge', () => {
    expect(ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX).toBeGreaterThan(0);
  });
});
