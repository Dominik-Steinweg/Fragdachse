import { generateArenaWithActiveMetrics } from './ArenaGeneratorTestHelper';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { Jimp } from 'jimp';

import { generateRockMossPlacements } from '../src/arena/RockMossField';
import {
  getRockMossPlacementBudget,
  ROCK_MOSS_CONFIG,
  getRockMossTextureKey,
} from '../src/arena/RockMossConfig';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  applyArenaMetricsForMode,
} from '../src/config';
import type { RockCell } from '../src/types';

function placementsFor(seed: number, rocks: readonly RockCell[]) {
  return generateRockMossPlacements({ seed, rocks });
}

const LARGE_COOP_METRICS = {
  offsetX: ARENA_OFFSET_X,
  offsetY: ARENA_OFFSET_Y,
  gridCols: 400,
  gridRows: 80,
};

function allRockCells(width: number, height: number): RockCell[] {
  const rocks: RockCell[] = [];
  for (let gridY = 0; gridY < height; gridY += 1) {
    for (let gridX = 0; gridX < width; gridX += 1) rocks.push({ gridX, gridY });
  }
  return rocks;
}

describe('Rock moss field', () => {
  beforeEach(() => {
    applyArenaMetricsForMode('deathmatch', 'ARENA');
  });

  it('sums the variant weights to a hundred and ships every listed file', () => {
    const total = ROCK_MOSS_CONFIG.variants.reduce((sum, variant) => sum + variant.frequencyPercent, 0);
    expect(total).toBe(100);
    const assetDir = path.join(__dirname, '..', 'public', 'assets', 'sprites', 'rockmoss');
    const shipped = new Set(fs.readdirSync(assetDir).filter((name) => name.endsWith('.png')));
    for (const variant of ROCK_MOSS_CONFIG.variants) {
      expect(variant.fileName).toMatch(/^rock_moss_\d\d\.png$/);
      expect(shipped.has(variant.fileName)).toBe(true);
    }
    expect(shipped.size).toBe(ROCK_MOSS_CONFIG.variants.length);
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const layout = generateArenaWithActiveMetrics(81_000);
    expect(placementsFor(layout.seed, layout.rocks)).toStrictEqual(placementsFor(layout.seed, layout.rocks));
    expect(placementsFor(layout.seed, layout.rocks)).not.toStrictEqual(placementsFor(layout.seed + 1, layout.rocks));
  });

  it('does not depend on the order of the rock list', () => {
    const layout = generateArenaWithActiveMetrics(81_001);
    const shuffled = [...layout.rocks].reverse();
    expect(placementsFor(layout.seed, shuffled)).toStrictEqual(placementsFor(layout.seed, layout.rocks));
  });

  it('keeps the field unchanged when rocks are destroyed, as long as the full list is passed', () => {
    // Der Vertrag der Schicht: Sichtbarkeit regelt die Stanzform, nicht die Platzierung. Wer
    // stattdessen den lebenden Bestand einsetzt, wuerfelt bei jeder Zerstoerung alles neu aus –
    // dieser Test haelt beide Haelften der Aussage fest.
    const layout = generateArenaWithActiveMetrics(81_002);
    const full = placementsFor(layout.seed, layout.rocks);
    expect(placementsFor(layout.seed, layout.rocks)).toStrictEqual(full);

    const survivors = layout.rocks.filter((_, id) => id % 3 !== 0);
    expect(survivors.length).toBeLessThan(layout.rocks.length);
    expect(placementsFor(layout.seed, survivors)).not.toStrictEqual(full);
  });

  it('anchors every patch on a rock cell', () => {
    for (let index = 0; index < 10; index += 1) {
      const layout = generateArenaWithActiveMetrics(82_000 + index);
      const rockKeys = new Set(layout.rocks.map((rock) => `${rock.gridX}:${rock.gridY}`));
      for (const placement of placementsFor(layout.seed, layout.rocks)) {
        const gridX = Math.floor((placement.worldX - ARENA_OFFSET_X) / CELL_SIZE);
        const gridY = Math.floor((placement.worldY - ARENA_OFFSET_Y) / CELL_SIZE);
        expect(rockKeys.has(`${gridX}:${gridY}`)).toBe(true);
      }
    }
  });

  it('never lands on the cell grid', () => {
    const octiles = new Set<number>();
    for (let index = 0; index < 10; index += 1) {
      const layout = generateArenaWithActiveMetrics(83_000 + index);
      for (const placement of placementsFor(layout.seed, layout.rocks)) {
        const localX = placement.worldX - ARENA_OFFSET_X;
        const localY = placement.worldY - ARENA_OFFSET_Y;
        expect(localX % CELL_SIZE).not.toBe(0);
        expect(localY % CELL_SIZE).not.toBe(0);
        octiles.add(Math.floor(((localX % CELL_SIZE) / CELL_SIZE) * 8));
      }
    }
    expect(octiles.size).toBe(8);
  });

  it('keeps size, alpha and texture inside the configured bounds', () => {
    const known = new Set(ROCK_MOSS_CONFIG.variants.map((variant) => getRockMossTextureKey(variant.fileName)));
    const layout = generateArenaWithActiveMetrics(84_000);
    const placements = placementsFor(layout.seed, layout.rocks);
    expect(placements.length).toBeGreaterThan(0);
    for (const placement of placements) {
      expect(known.has(placement.textureKey)).toBe(true);
      expect(placement.sizePx).toBeGreaterThanOrEqual(ROCK_MOSS_CONFIG.minSizeCells * CELL_SIZE);
      expect(placement.sizePx).toBeLessThanOrEqual(ROCK_MOSS_CONFIG.maxSizeCells * CELL_SIZE);
      expect(placement.alpha).toBeGreaterThanOrEqual(ROCK_MOSS_CONFIG.minAlpha);
      expect(placement.alpha).toBeLessThanOrEqual(ROCK_MOSS_CONFIG.maxAlpha);
    }
  });

  it('stays inside the placement budget', () => {
    const blocks = Math.ceil(GRID_COLS / ROCK_MOSS_CONFIG.blockCells) * Math.ceil(GRID_ROWS / ROCK_MOSS_CONFIG.blockCells);
    for (let index = 0; index < 10; index += 1) {
      const layout = generateArenaWithActiveMetrics(85_000 + index);
      const placements = placementsFor(layout.seed, layout.rocks);
      expect(placements.length).toBeLessThanOrEqual(getRockMossPlacementBudget(GRID_COLS, GRID_ROWS));
      expect(placements.length).toBeLessThanOrEqual(blocks * ROCK_MOSS_CONFIG.maxPerBlock);
    }
  });

  it('keeps the local density through the full 400 x 80 Test-Map 0 raster', () => {
    const placements = generateRockMossPlacements({
      seed: 85_010,
      rocks: allRockCells(400, 80),
      metrics: LARGE_COOP_METRICS,
    });
    const upperHalf = placements.filter((placement) =>
      placement.worldY - LARGE_COOP_METRICS.offsetY < 40 * CELL_SIZE).length;
    const lowerHalf = placements.length - upperHalf;

    // 400 x 80 has 3 618 Moss-Bloecke. Der alte globale Deckel von 768 liess den zeilenweise
    // spaeter verarbeiteten unteren Kartenbereich leer.
    expect(placements.length).toBeGreaterThan(768);
    expect(placements.length).toBeLessThanOrEqual(getRockMossPlacementBudget(400, 80));
    expect(lowerHalf).toBeGreaterThan(upperHalf * 0.5);
  });

  it('produces nothing without rocks', () => {
    expect(placementsFor(86_000, [])).toHaveLength(0);
  });
});

describe('Rock moss silhouette mask sheet', () => {
  const readSheet = async (name: string) => Jimp.read(fileURLToPath(new URL(
    `../public/assets/sprites/${name}`,
    import.meta.url,
  )));

  it('matches the rock sheet frame for frame and fades inward from every open edge', async () => {
    const rocks = await readSheet('rocks47blob.png');
    const mask = await readSheet('rocks47blob_mossmask.png');

    // Ohne identische Geometrie zeigte die Maske einen anderen Autotile-Frame als der Fels,
    // auf den sie sich bezieht.
    expect(mask.bitmap.width).toBe(rocks.bitmap.width);
    expect(mask.bitmap.height).toBe(rocks.bitmap.height);

    const alphaOf = (image: typeof rocks, x: number, y: number) =>
      image.bitmap.data[(y * image.bitmap.width + x) * 4 + 3];

    let ramp = 0;
    let solid = 0;
    for (let y = 0; y < mask.bitmap.height; y += 1) {
      for (let x = 0; x < mask.bitmap.width; x += 1) {
        const maskAlpha = alphaOf(mask, x, y);
        // Wo kein Fels ist, darf kein Moos stehen bleiben.
        if (alphaOf(rocks, x, y) < 128) expect(maskAlpha).toBe(0);
        if (maskAlpha > 8 && maskAlpha < 247) ramp += 1;
        if (maskAlpha === 255) solid += 1;
      }
    }
    // Ein echter Verlauf, keine harte Stanzform: beide Enden und das Band dazwischen kommen vor.
    expect(ramp).toBeGreaterThan(0);
    expect(solid).toBeGreaterThan(0);
  });
});
