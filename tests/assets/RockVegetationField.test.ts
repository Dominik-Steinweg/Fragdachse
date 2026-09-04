import { generateArenaWithActiveMetrics } from '../ArenaGeneratorTestHelper';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { Jimp } from 'jimp';

import {
  generateRockVegetationPlacements,
  getRockVegetationPlacementBudget,
} from '../../src/arena/RockVegetationField';
import type { RockVegetationPlacement } from '../../src/arena/RockVegetationField';
import {
  ROCK_VEGETATION_CONFIG,
  ROCK_VEGETATION_MASK_FRAME_SIZE,
  ROCK_VEGETATION_MASK_MARGIN_PX,
  ROCK_VEGETATION_MASK_REACH_PX,
  getRockVegetationFileName,
  getRockVegetationTextureKey,
} from '../../src/arena/RockVegetationConfig';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  applyArenaMetricsForMode,
} from '../../src/config';
import type { RockCell } from '../../src/types';

function placementsFor(seed: number, rocks: readonly RockCell[]) {
  return generateRockVegetationPlacements({ seed, rocks });
}

/**
 * Rechnet eine Platzierung auf die Felszellen zurueck, die sie tragen soll. Das ist die Umkehrung
 * von `buildPlacement` und damit der Pruefstein dafuer, dass eine Matte tatsaechlich an einer
 * freien Kante haengt und nicht irgendwo im Gelaende.
 */
function describePlacement(placement: RockVegetationPlacement) {
  // Die Drehung streut um ihren rechten Winkel; das Vielfache von 90 Grad traegt die Richtung.
  const quadrant = Math.round(placement.rotation / (Math.PI / 2));
  const alongX = quadrant === 0 || quadrant === 2;
  const span = (placement.lengthPx - ROCK_VEGETATION_CONFIG.overlapPx * 2) / CELL_SIZE;
  const alongCenter = (alongX ? placement.worldX - ARENA_OFFSET_X : placement.worldY - ARENA_OFFSET_Y) / CELL_SIZE;
  const across = alongX ? placement.worldY - ARENA_OFFSET_Y : placement.worldX - ARENA_OFFSET_X;
  const line = Math.floor(across / CELL_SIZE);
  const start = Math.round(alongCenter - span / 2);
  const neighbor = quadrant === 0
    ? { dx: 0, dy: -1 }
    : quadrant === 2
      ? { dx: 0, dy: 1 }
      : quadrant === -1
        ? { dx: -1, dy: 0 }
        : { dx: 1, dy: 0 };
  const cells: Array<{ gridX: number; gridY: number }> = [];
  for (let offset = 0; offset < span; offset += 1) {
    cells.push(alongX ? { gridX: start + offset, gridY: line } : { gridX: line, gridY: start + offset });
  }
  return { span, cells, neighbor, across, line, quadrant };
}

/** Eine gerade Wand aus `length` Felsen in einer Zeile – der Fall, den die Schicht bevorzugen soll. */
function straightWall(length: number, row = 5, col = 3): RockCell[] {
  const rocks: RockCell[] = [];
  for (let index = 0; index < length; index += 1) rocks.push({ gridX: col + index, gridY: row });
  return rocks;
}

const LARGE_COOP_METRICS = {
  offsetX: ARENA_OFFSET_X,
  offsetY: ARENA_OFFSET_Y,
  gridCols: 400,
  gridRows: 80,
};

function checkerboardRocks(width: number, height: number): RockCell[] {
  const rocks: RockCell[] = [];
  for (let gridY = 0; gridY < height; gridY += 1) {
    for (let gridX = 0; gridX < width; gridX += 1) {
      if ((gridX + gridY) % 2 === 0) rocks.push({ gridX, gridY });
    }
  }
  return rocks;
}

describe('Rock vegetation field', () => {
  beforeEach(() => {
    applyArenaMetricsForMode('deathmatch', 'ARENA');
  });

  it('sums the variant weights to a hundred and ships every listed file', () => {
    const total = ROCK_VEGETATION_CONFIG.variants.reduce((sum, variant) => sum + variant.frequencyPercent, 0);
    expect(total).toBe(100);
    const assetDir = path.join(__dirname, '..', '..', 'public', 'assets', 'sprites', 'rockvegetation');
    const shipped = new Set(fs.readdirSync(assetDir).filter((name) => name.endsWith('.png')));
    for (const variant of ROCK_VEGETATION_CONFIG.variants) {
      for (const sizeClass of ROCK_VEGETATION_CONFIG.classes) {
        expect(shipped.has(getRockVegetationFileName(variant.index, sizeClass.name))).toBe(true);
      }
    }
    expect(shipped.size).toBe(ROCK_VEGETATION_CONFIG.variants.length * ROCK_VEGETATION_CONFIG.classes.length);
  });

  it('covers every edge length without a gap between the size classes', () => {
    const sorted = [...ROCK_VEGETATION_CONFIG.classes].sort((a, b) => a.minCells - b.minCells);
    expect(sorted[0].minCells).toBe(1);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index].minCells).toBe(sorted[index - 1].maxCells + 1);
    }
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const layout = generateArenaWithActiveMetrics(91_000);
    expect(placementsFor(layout.seed, layout.rocks)).toStrictEqual(placementsFor(layout.seed, layout.rocks));
    expect(placementsFor(layout.seed, layout.rocks)).not.toStrictEqual(placementsFor(layout.seed + 1, layout.rocks));
  });

  it('does not depend on the order of the rock list', () => {
    const layout = generateArenaWithActiveMetrics(91_001);
    const shuffled = [...layout.rocks].reverse();
    expect(placementsFor(layout.seed, shuffled)).toStrictEqual(placementsFor(layout.seed, layout.rocks));
  });

  it('keeps every mat unchanged when rocks are destroyed, as long as the full list is passed', () => {
    // Der Vertrag der Schicht: Eine Zerstoerung entfernt nur den Anteil des gefallenen Felsens,
    // und das regelt die Reichweitenmaske beim Backen – nicht die Platzierung. Wer stattdessen den
    // lebenden Bestand einsetzt, wuerfelt jede Matte neu aus und ordnet den Bewuchs der halben
    // Karte um. Dieser Test haelt beide Haelften der Aussage fest.
    const layout = generateArenaWithActiveMetrics(91_002);
    const full = placementsFor(layout.seed, layout.rocks);
    expect(placementsFor(layout.seed, layout.rocks)).toStrictEqual(full);

    const survivors = layout.rocks.filter((_, id) => id % 3 !== 0);
    expect(survivors.length).toBeLessThan(layout.rocks.length);
    expect(placementsFor(layout.seed, survivors)).not.toStrictEqual(full);
  });

  it('anchors every mat on a run of rock cells that is free towards the mat', () => {
    for (let index = 0; index < 8; index += 1) {
      const layout = generateArenaWithActiveMetrics(92_000 + index);
      const rockKeys = new Set(layout.rocks.map((rock) => `${rock.gridX}:${rock.gridY}`));
      const placements = placementsFor(layout.seed, layout.rocks);
      expect(placements.length).toBeGreaterThan(0);
      for (const placement of placements) {
        const { cells, neighbor } = describePlacement(placement);
        for (const cell of cells) {
          expect(rockKeys.has(`${cell.gridX}:${cell.gridY}`)).toBe(true);
          expect(rockKeys.has(`${cell.gridX + neighbor.dx}:${cell.gridY + neighbor.dy}`)).toBe(false);
        }
      }
    }
  });

  it('overhangs the rock edge without leaving the reach of the mask', () => {
    // Ragt die Matte weiter hinaus als die Maske reicht, schneidet die Stanzform genau den
    // Ueberhang wieder weg, um den es hier geht.
    const layout = generateArenaWithActiveMetrics(92_100);
    const { overhangPx, overhangJitterPx } = ROCK_VEGETATION_CONFIG;
    for (const placement of placementsFor(layout.seed, layout.rocks)) {
      const { across, line, quadrant } = describePlacement(placement);
      const towardsLowEdge = quadrant === 0 || quadrant === -1;
      const edgeLine = (towardsLowEdge ? line : line + 1) * CELL_SIZE;
      const overhang = placement.bandPx / 2 - Math.abs(across - edgeLine);
      expect(overhang).toBeGreaterThanOrEqual(overhangPx - overhangJitterPx);
      expect(overhang).toBeLessThanOrEqual(overhangPx + overhangJitterPx);
      // Die streuende Bandhoehe darf ausschliesslich nach innen wirken.
      expect(overhang).toBeLessThanOrEqual(ROCK_VEGETATION_MASK_REACH_PX);
    }
  });

  it('keeps size, alpha, rotation and texture inside the configured bounds', () => {
    const known = new Set(ROCK_VEGETATION_CONFIG.variants.flatMap((variant) =>
      ROCK_VEGETATION_CONFIG.classes.map((sizeClass) => getRockVegetationTextureKey(variant.index, sizeClass.name))));
    const layout = generateArenaWithActiveMetrics(93_000);
    const placements = placementsFor(layout.seed, layout.rocks);
    expect(placements.length).toBeGreaterThan(0);
    for (const placement of placements) {
      expect(known.has(placement.textureKey)).toBe(true);
      expect(placement.bandPx).toBeGreaterThanOrEqual(ROCK_VEGETATION_CONFIG.minBandPx);
      expect(placement.bandPx).toBeLessThanOrEqual(ROCK_VEGETATION_CONFIG.maxBandPx);
      expect(placement.alpha).toBeGreaterThanOrEqual(ROCK_VEGETATION_CONFIG.minAlpha);
      expect(placement.alpha).toBeLessThanOrEqual(ROCK_VEGETATION_CONFIG.maxAlpha);

      // Die Vorlage muss zur Laenge passen, sonst waere die Matte sichtbar gestaucht oder gezogen.
      const { span, quadrant } = describePlacement(placement);
      expect(Math.abs(placement.rotation - quadrant * (Math.PI / 2)))
        .toBeLessThanOrEqual(ROCK_VEGETATION_CONFIG.rotationJitter);
      const sizeClass = ROCK_VEGETATION_CONFIG.classes.find((entry) =>
        placement.textureKey.endsWith(`_${entry.name}`));
      expect(sizeClass).toBeDefined();
      expect(span).toBeGreaterThanOrEqual(sizeClass!.minCells);
      expect(span).toBeLessThanOrEqual(sizeClass!.maxCells);
    }
  });

  it('never grows more mats on a cell than the edge budget allows', () => {
    for (let index = 0; index < 6; index += 1) {
      const layout = generateArenaWithActiveMetrics(94_000 + index);
      const load = new Map<string, number>();
      for (const placement of placementsFor(layout.seed, layout.rocks)) {
        for (const cell of describePlacement(placement).cells) {
          const key = `${cell.gridX}:${cell.gridY}`;
          load.set(key, (load.get(key) ?? 0) + 1);
        }
      }
      for (const count of load.values()) {
        expect(count).toBeLessThanOrEqual(ROCK_VEGETATION_CONFIG.maxEdgesPerCell);
      }
    }
  });

  it('prefers one large mat on a long straight edge over a chain of small ones', () => {
    const wall = straightWall(20);
    const largest = ROCK_VEGETATION_CONFIG.classes[ROCK_VEGETATION_CONFIG.classes.length - 1];
    for (let index = 0; index < 6; index += 1) {
      const placements = placementsFor(95_000 + index, wall);
      const spans = placements.map((placement) => describePlacement(placement).span);
      expect(Math.max(...spans)).toBeGreaterThanOrEqual(largest.minCells);
      // Die lange Kante soll ueberwiegend zusammenhaengend bewachsen sein, nicht getupft.
      const covered = spans.reduce((sum, span) => sum + span, 0);
      expect(covered).toBeGreaterThan(wall.length);
    }
  });

  it('serves a single rock from the same templates, at the smallest class', () => {
    const single: RockCell[] = [{ gridX: 6, gridY: 6 }];
    const smallest = ROCK_VEGETATION_CONFIG.classes[0];
    let seen = 0;
    for (let index = 0; index < 12; index += 1) {
      const placements = placementsFor(96_000 + index, single);
      seen += placements.length;
      for (const placement of placements) {
        expect(placement.textureKey.endsWith(`_${smallest.name}`)).toBe(true);
        expect(describePlacement(placement).span).toBe(1);
      }
      // Vier freie Kanten, aber gedeckelt: sonst verschwaende der Fels vollstaendig.
      expect(placements.length).toBeLessThanOrEqual(ROCK_VEGETATION_CONFIG.maxEdgesPerCell);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('stays inside the placement budget', () => {
    for (let index = 0; index < 6; index += 1) {
      const layout = generateArenaWithActiveMetrics(97_000 + index);
      expect(placementsFor(layout.seed, layout.rocks).length)
        .toBeLessThanOrEqual(getRockVegetationPlacementBudget(layout.rocks));
    }
  });

  it('keeps edge density through the full 400 x 80 Test-Map 0 raster', () => {
    const rocks = checkerboardRocks(400, 80);
    const placements = generateRockVegetationPlacements({
      seed: 97_010,
      rocks,
      metrics: LARGE_COOP_METRICS,
    });
    const upperHalf = placements.filter((placement) =>
      placement.worldY - LARGE_COOP_METRICS.offsetY < 40 * CELL_SIZE).length;
    const lowerHalf = placements.length - upperHalf;

    // Der alte globale Deckel von 512 stoppte nach dem zeilenweisen Lauf mitten in der Map.
    expect(placements.length).toBeGreaterThan(512);
    expect(placements.length).toBeLessThanOrEqual(
      getRockVegetationPlacementBudget(rocks, LARGE_COOP_METRICS),
    );
    expect(lowerHalf).toBeGreaterThan(upperHalf * 0.5);
  });

  it('produces nothing without rocks', () => {
    expect(placementsFor(98_000, [])).toHaveLength(0);
  });
});

describe('Rock vegetation reach mask sheet', () => {
  const readSheet = async (name: string) => Jimp.read(fileURLToPath(new URL(
    `../../public/assets/sprites/${name}`,
    import.meta.url,
  )));

  it('doubles the rock sheet frame for frame and grows outward from the silhouette', async () => {
    const rocks = await readSheet('rocks47blob.png');
    const mask = await readSheet('rocks47blob_vegmask.png');

    // Ohne dasselbe Frame-Raster zeigte die Maske einen anderen Autotile-Frame als der Fels, auf
    // den sie sich bezieht. Der Faktor zwei ist der Rand, in den sie hinauswachsen kann.
    expect(mask.bitmap.width).toBe(rocks.bitmap.width * 2);
    expect(mask.bitmap.height).toBe(rocks.bitmap.height * 2);

    const alphaOf = (image: typeof rocks, x: number, y: number) =>
      image.bitmap.data[(y * image.bitmap.width + x) * 4 + 3];

    const cols = rocks.bitmap.width / CELL_SIZE;
    const rows = rocks.bitmap.height / CELL_SIZE;
    const margin = ROCK_VEGETATION_MASK_MARGIN_PX;
    let ramp = 0;
    let overhang = 0;

    for (let frameY = 0; frameY < rows; frameY += 1) {
      for (let frameX = 0; frameX < cols; frameX += 1) {
        for (let y = 0; y < ROCK_VEGETATION_MASK_FRAME_SIZE; y += 1) {
          for (let x = 0; x < ROCK_VEGETATION_MASK_FRAME_SIZE; x += 1) {
            const maskAlpha = alphaOf(
              mask,
              frameX * ROCK_VEGETATION_MASK_FRAME_SIZE + x,
              frameY * ROCK_VEGETATION_MASK_FRAME_SIZE + y,
            );
            const localX = x - margin;
            const localY = y - margin;
            const insideFrame = localX >= 0 && localY >= 0 && localX < CELL_SIZE && localY < CELL_SIZE;
            if (insideFrame && alphaOf(rocks, frameX * CELL_SIZE + localX, frameY * CELL_SIZE + localY) >= 128) {
              // Ueber dem Fels darf nichts weggeschnitten werden, sonst fehlte der Bewuchs auf
              // der Flaeche, auf der er sitzt.
              expect(maskAlpha).toBe(255);
            }
            if (!insideFrame && maskAlpha > 0) overhang += 1;
            if (maskAlpha > 8 && maskAlpha < 247) ramp += 1;
            // Am aeussersten Rand des Frames ist jeder Punkt mindestens `margin` von der Zelle
            // entfernt und damit ausserhalb der Reichweite. Bleibt dort etwas stehen, ist die
            // Maske am Framerand abgeschnitten statt ausgelaufen – im Spiel eine harte Kante.
            const atFrameBorder = x === 0 || y === 0
              || x === ROCK_VEGETATION_MASK_FRAME_SIZE - 1
              || y === ROCK_VEGETATION_MASK_FRAME_SIZE - 1;
            if (atFrameBorder) expect(maskAlpha).toBe(0);
          }
        }
      }
    }

    // Ein echter Ueberhang mit weichem Auslauf, keine harte Stanzform an der Kachelgrenze.
    expect(overhang).toBeGreaterThan(0);
    expect(ramp).toBeGreaterThan(0);
  });
});
