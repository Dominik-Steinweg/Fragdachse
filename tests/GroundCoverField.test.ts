import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { generateGroundCoverPlacements } from '../src/arena/GroundCoverField';
import {
  getGroundCoverPlacementBudget,
  GROUND_COVER_CONFIG,
  getGroundCoverTextureKey,
} from '../src/arena/GroundCoverConfig';
import type { GroundCoverPlacement } from '../src/arena/GroundCoverField';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  applyArenaMetricsForMode,
} from '../src/config';
import type { DirtCell } from '../src/types';

function placementsFor(seed: number, dirt: readonly DirtCell[]): GroundCoverPlacement[] {
  return generateGroundCoverPlacements({ seed, dirt });
}

function dirtKeys(dirt: readonly DirtCell[]): Set<string> {
  return new Set(dirt.map((cell) => `${cell.gridX}:${cell.gridY}`));
}

const LARGE_COOP_METRICS = {
  offsetX: ARENA_OFFSET_X,
  offsetY: ARENA_OFFSET_Y,
  gridCols: 400,
  gridRows: 80,
};

describe('Ground cover field', () => {
  beforeEach(() => {
    applyArenaMetricsForMode('deathmatch', 'ARENA');
  });

  it('sums the variant weights to a hundred and names every file by convention', () => {
    const total = GROUND_COVER_CONFIG.variants.reduce((sum, variant) => sum + variant.frequencyPercent, 0);
    expect(total).toBe(100);
    expect(GROUND_COVER_CONFIG.variants).toHaveLength(16);
    for (const variant of GROUND_COVER_CONFIG.variants) {
      expect(variant.fileName).toMatch(/^ground_cover_\d\d\.png$/);
    }
  });

  it('ships every variant listed in the config', () => {
    // Die Liste wird von Hand gepflegt, die Dateien entstehen im Generatorskript. Ein Tippfehler
    // faellt sonst erst im Spiel auf, wo Phaser die fehlende Textur still durch ihren
    // Platzhalter ersetzt.
    const assetDir = path.join(__dirname, '..', 'public', 'assets', 'sprites', 'groundcover');
    const shipped = new Set(fs.readdirSync(assetDir).filter((name) => name.endsWith('.png')));
    for (const variant of GROUND_COVER_CONFIG.variants) {
      expect(shipped.has(variant.fileName)).toBe(true);
    }
    expect(shipped.size).toBe(GROUND_COVER_CONFIG.variants.length);
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const layout = ArenaGenerator.generate(51_000);
    expect(placementsFor(layout.seed, layout.dirt)).toStrictEqual(placementsFor(layout.seed, layout.dirt));
    expect(placementsFor(layout.seed, layout.dirt)).not.toStrictEqual(placementsFor(layout.seed + 1, layout.dirt));
  });

  it('does not depend on the order of the dirt cell list', () => {
    // Host und Client leiten die Schicht unabhaengig voneinander ab. Haenge das Ergebnis an der
    // Listenreihenfolge, liefen beide Seiten auseinander, sobald die Liste anders sortiert ankommt.
    const layout = ArenaGenerator.generate(51_001);
    const shuffled = [...layout.dirt].reverse();
    expect(placementsFor(layout.seed, shuffled)).toStrictEqual(placementsFor(layout.seed, layout.dirt));
  });

  it('weights placement toward the dirt/grass seam and covers both sides', () => {
    let seam = 0;
    let dirt = 0;
    let grass = 0;
    let overDirt = 0;
    let overGrass = 0;

    for (let index = 0; index < 20; index += 1) {
      const layout = ArenaGenerator.generate(52_000 + index);
      const keys = dirtKeys(layout.dirt);
      for (const placement of placementsFor(layout.seed, layout.dirt)) {
        if (placement.anchor === 'seam') seam += 1;
        else if (placement.anchor === 'dirt') dirt += 1;
        else grass += 1;

        const gridX = Math.floor((placement.worldX - ARENA_OFFSET_X) / CELL_SIZE);
        const gridY = Math.floor((placement.worldY - ARENA_OFFSET_Y) / CELL_SIZE);
        if (keys.has(`${gridX}:${gridY}`)) overDirt += 1;
        else overGrass += 1;
      }
    }

    expect(seam).toBeGreaterThan(grass * 3);
    expect(dirt).toBeGreaterThan(0);
    expect(grass).toBeGreaterThan(0);
    // Die Flecken sollen die Grenze bewusst ueberlaufen, es muessen also beide Seiten vorkommen.
    expect(overDirt).toBeGreaterThan(0);
    expect(overGrass).toBeGreaterThan(0);
  });

  it('never lands on the cell grid', () => {
    const octiles = new Set<number>();
    for (let index = 0; index < 10; index += 1) {
      const layout = ArenaGenerator.generate(53_000 + index);
      for (const placement of placementsFor(layout.seed, layout.dirt)) {
        const localX = placement.worldX - ARENA_OFFSET_X;
        const localY = placement.worldY - ARENA_OFFSET_Y;
        expect(localX % CELL_SIZE).not.toBe(0);
        expect(localY % CELL_SIZE).not.toBe(0);
        // Auch die Zellmitte waere eine Rasterbindung.
        expect(localX % CELL_SIZE).not.toBe(CELL_SIZE / 2);
        octiles.add(Math.floor(((localX % CELL_SIZE) / CELL_SIZE) * 8));
      }
    }
    expect(octiles.size).toBe(8);
  });

  it('keeps size, alpha and texture inside the configured bounds', () => {
    const known = new Set(GROUND_COVER_CONFIG.variants.map((variant) => getGroundCoverTextureKey(variant.fileName)));
    const layout = ArenaGenerator.generate(54_000);
    const placements = placementsFor(layout.seed, layout.dirt);
    expect(placements.length).toBeGreaterThan(0);

    for (const placement of placements) {
      const anchorConfig = GROUND_COVER_CONFIG[placement.anchor];
      expect(known.has(placement.textureKey)).toBe(true);
      expect(placement.sizePx).toBeGreaterThanOrEqual(anchorConfig.minSizeCells * CELL_SIZE);
      expect(placement.sizePx).toBeLessThanOrEqual(anchorConfig.maxSizeCells * CELL_SIZE);
      expect(placement.alpha).toBeGreaterThanOrEqual(anchorConfig.minAlpha);
      expect(placement.alpha).toBeLessThanOrEqual(anchorConfig.maxAlpha);
      expect(placement.rotation).toBeGreaterThanOrEqual(0);
      expect(placement.rotation).toBeLessThan(Math.PI * 2);
    }
  });

  it('stays inside the placement budget', () => {
    const blocks = Math.ceil(GRID_COLS / GROUND_COVER_CONFIG.blockCells) * Math.ceil(GRID_ROWS / GROUND_COVER_CONFIG.blockCells);
    for (let index = 0; index < 10; index += 1) {
      const layout = ArenaGenerator.generate(55_000 + index);
      const placements = placementsFor(layout.seed, layout.dirt);
      expect(placements.length).toBeLessThanOrEqual(getGroundCoverPlacementBudget(GRID_COLS, GRID_ROWS));
      expect(placements.length).toBeLessThanOrEqual(blocks * GROUND_COVER_CONFIG.maxPerBlock);
    }
  });

  it('keeps the local density through the full 400 x 80 Test-Map 0 raster', () => {
    const placements = generateGroundCoverPlacements({
      seed: 55_010,
      dirt: [],
      metrics: LARGE_COOP_METRICS,
    });
    const upperHalf = placements.filter((placement) =>
      placement.worldY - LARGE_COOP_METRICS.offsetY < 40 * CELL_SIZE).length;
    const lowerHalf = placements.length - upperHalf;

    // 400 x 80 has 1 280 Ground-Cover-Bloecke. Der alte globale Deckel von 512 liess den
    // zeilenweise spaeter verarbeiteten unteren Kartenbereich leer.
    expect(placements.length).toBeGreaterThan(512);
    expect(placements.length).toBeLessThanOrEqual(getGroundCoverPlacementBudget(400, 80));
    expect(lowerHalf).toBeGreaterThan(upperHalf * 0.5);
  });

  it('honours the exclusion predicate', () => {
    const layout = ArenaGenerator.generate(56_000);
    const placements = generateGroundCoverPlacements({
      seed: layout.seed,
      dirt: layout.dirt,
      excludeCell: () => true,
    });
    expect(placements).toHaveLength(0);
  });

  it('produces only grass anchors without any dirt', () => {
    const placements = placementsFor(57_000, []);
    expect(placements.length).toBeGreaterThan(0);
    expect(placements.every((placement) => placement.anchor === 'grass')).toBe(true);
  });
});
