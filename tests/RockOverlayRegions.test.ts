import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { CELL_SIZE } from '../src/config';
import type { RockCell } from '../src/types';
import { ROCK_BLOB_SURFACE_PROFILE, getBlobSurfaceMottleReachPx } from '../src/arena/BlobSurfaceProfile';
import { ROCK_VEGETATION_MASK_MARGIN_PX } from '../src/arena/RockVegetationConfig';
import {
  ROCK_OVERLAY_CHUNK_SIZE,
  collectRockCellKeys,
  collectRockOverlayChunks,
  createRockOverlaySource,
  getRockOverlaySilhouetteReachPx,
  getRockOverlaySourceReachPx,
  hasFallenRockCells,
  syncRockOverlaySource,
} from '../src/arena/RockOverlayRegions';

const FRAME = { width: 512, height: 256 };

function cell(gridX: number, gridY: number): RockCell {
  return { gridX, gridY };
}

function chunkKeys(chunks: readonly { localX: number; localY: number }[]): string[] {
  return chunks.map(({ localX, localY }) => `${localX}:${localY}`).sort();
}

describe('rock overlay material source', () => {
  it('keeps destroyed rocks in the source so their material stays put', () => {
    const rocks = [cell(0, 0), cell(1, 0), cell(2, 0)];
    const source = createRockOverlaySource();
    expect(syncRockOverlaySource(source, rocks)).toHaveLength(3);

    // Eine Zerstoerung leert den Slot nicht – aber selbst wenn: die Quelle darf nicht schrumpfen,
    // sonst verschwaenden die Materialflecken, die dieser Fels auf seine Nachbarn geworfen hat.
    const survivors = [rocks[0], rocks[2]];
    expect(syncRockOverlaySource(source, survivors)).toEqual([]);
    expect(source.cells).toEqual(rocks);
  });

  it('reports only genuinely new cells, so a built rock can be re-baked', () => {
    const source = createRockOverlaySource();
    syncRockOverlaySource(source, [cell(4, 4)]);

    const added = syncRockOverlaySource(source, [cell(4, 4), cell(5, 4)]);
    expect(added).toEqual([cell(5, 4)]);
    expect(source.cells).toHaveLength(2);
  });

  it('deduplicates by cell, so a rock built on a cleared cell does not double the stamps', () => {
    const source = createRockOverlaySource();
    syncRockOverlaySource(source, [cell(7, 2)]);
    // Ein gebauter Fels bekommt einen eigenen Slot, sitzt aber auf derselben Zelle.
    expect(syncRockOverlaySource(source, [cell(7, 2), cell(7, 2)])).toEqual([]);
    expect(source.cells).toHaveLength(1);
  });

  it('detects fallen cells for the decal cutout', () => {
    const source = createRockOverlaySource();
    syncRockOverlaySource(source, [cell(1, 1), cell(2, 1)]);

    expect(hasFallenRockCells(source, collectRockCellKeys([cell(1, 1), cell(2, 1)]))).toBe(false);
    expect(hasFallenRockCells(source, collectRockCellKeys([cell(1, 1)]))).toBe(true);
  });
});

describe('rock overlay dirty chunks', () => {
  it('covers the retiled neighbours plus the vegetation mask margin', () => {
    expect(getRockOverlaySilhouetteReachPx()).toBe(CELL_SIZE + ROCK_VEGETATION_MASK_MARGIN_PX);
  });

  it('stays inside one chunk when nothing can reach across its border', () => {
    // Zelle 1 liegt bei 32..63. Selbst mit Nachbarzelle und Maskenrand endet die Wirkung bei 111,
    // also klar vor der Chunkgrenze bei 128 – ein zweiter Chunk waere reine Mehrarbeit.
    const chunks = collectRockOverlayChunks([cell(1, 1)], [], FRAME);
    expect(chunkKeys(chunks)).toEqual(['0:0']);
  });

  it('adds the neighbouring chunk when the vegetation mask crosses a 128 px border', () => {
    // Zelle 2 endet bei 95. Ihr retileter Nachbar (Zelle 3) reicht bis 127, dessen
    // Reichweitenmaske deckt bis 143 – also in den Chunk bei 128 hinein. Ohne diesen Chunk bliebe
    // an der Grenze ein Streifen alter Vegetation stehen.
    const chunks = collectRockOverlayChunks([cell(2, 1)], [], FRAME);
    expect(chunkKeys(chunks)).toEqual(['0:0', '128:0']);
    expect(2 * CELL_SIZE + CELL_SIZE - 1 + getRockOverlaySilhouetteReachPx())
      .toBeGreaterThanOrEqual(ROCK_OVERLAY_CHUNK_SIZE);
  });

  it('adds the chunk below when a destruction sits on a horizontal chunk border', () => {
    // Zelle (1, 3) endet bei y = 127, sitzt also unmittelbar auf der Grenze.
    const chunks = collectRockOverlayChunks([cell(1, 3)], [], FRAME);
    expect(chunkKeys(chunks)).toEqual(['0:0', '0:128']);
  });

  it('uses the wider material reach for newly added source cells', () => {
    const reach = getBlobSurfaceMottleReachPx(ROCK_BLOB_SURFACE_PROFILE);
    expect(getRockOverlaySourceReachPx()).toBe(reach);
    expect(reach).toBeGreaterThan(getRockOverlaySilhouetteReachPx());

    // Dieselbe Zelle, die als reine Silhouettenaenderung in einem Chunk bliebe, bringt als neue
    // Quellzelle eigene Flecken mit und muss deshalb weiter neu gebacken werden.
    expect(chunkKeys(collectRockOverlayChunks([cell(1, 1)], [], FRAME))).toEqual(['0:0']);
    expect(chunkKeys(collectRockOverlayChunks([], [cell(1, 1)], FRAME)))
      .toEqual(['0:0', '0:128', '128:0', '128:128']);
  });

  it('clamps to the frame instead of baking chunks that do not exist', () => {
    const narrow = { width: ROCK_OVERLAY_CHUNK_SIZE, height: ROCK_OVERLAY_CHUNK_SIZE };
    const chunks = collectRockOverlayChunks([cell(3, 3)], [], narrow);
    expect(chunkKeys(chunks)).toEqual(['0:0']);
  });

  it('merges the chunks of a whole destruction wave without duplicates', () => {
    const chunks = collectRockOverlayChunks([cell(1, 1), cell(1, 1), cell(2, 1)], [], FRAME);
    expect(chunkKeys(chunks)).toEqual(['0:0', '128:0']);
  });
});

describe('rock overlay wiring', () => {
  it('feeds the mottle bake from the stable source, never from the living rocks', () => {
    const builder = readFileSync(new URL('../src/arena/ArenaBuilder.ts', import.meta.url), 'utf8')
      .replace(/\r\n/g, '\n');
    // Der Vollbake stempelt aus `rockOverlaySource`; `activeRocks` darf nur noch die Maske sein.
    expect(builder).toContain('result.rockOverlaySource.cells,\n      activeRocks,');
    // Und die Chunk-Quelle ebenso – ein Rueckfall auf `activeRockIds` waere genau der alte Fehler.
    expect(builder).toContain('for (const cell of result.rockOverlaySource.cells)');
  });
});
