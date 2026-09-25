import { generateArenaWithActiveMetrics } from '../ArenaGeneratorTestHelper';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { generateGroundCoverPlacements } from '../../src/arena/GroundCoverField';
import {
  getGroundCoverPlacementBudget,
  FOREST_VEGETATION_CONFIG,
  GROUND_COVER_TIERS,
  getGroundCoverTextureKey,
} from '../../src/arena/GroundCoverConfig';
import type { GroundCoverLayerConfig, GroundCoverVariantConfig } from '../../src/arena/GroundCoverConfig';
import type { GroundCoverPlacement } from '../../src/arena/GroundCoverField';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  applyArenaMetricsForMode,
} from '../../src/config';
import type { DirtCell } from '../../src/types';

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

  it('sums the variant weights to a hundred per tier and names every file by convention', () => {
    expect(new Set(GROUND_COVER_TIERS.map((tier) => tier.seedSalt)).size).toBe(GROUND_COVER_TIERS.length);
    for (const tier of GROUND_COVER_TIERS) {
      const total = tier.variants.reduce((sum, variant) => sum + variant.frequencyPercent, 0);
      expect(total).toBeCloseTo(100, 6);
      expect(tier.variants.length).toBeGreaterThan(1);
      for (const variant of tier.variants) {
        expect(variant.fileName).toMatch(/^(ground_(cover|patch)_\d\d|(forest|ground_area)_[a-z]+-\d\d-[a-z-]+)\.png$/);
      }
    }
  });

  it('ships every variant listed in the config', () => {
    // Die Liste wird von Hand gepflegt, die Dateien entstehen im Generatorskript. Ein Tippfehler
    // faellt sonst erst im Spiel auf, wo Phaser die fehlende Textur still durch ihren
    // Platzhalter ersetzt.
    const assetDir = path.join(__dirname, '..', '..', 'public', 'assets', 'sprites', 'groundcover');
    const shipped = new Set(fs.readdirSync(assetDir).filter((name) => name.endsWith('.png')));
    const listed = GROUND_COVER_TIERS.flatMap((tier) => tier.variants.map((variant) => variant.fileName));
    for (const fileName of listed) expect(shipped.has(fileName)).toBe(true);
    expect(shipped.size).toBe(new Set(listed).size);
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const layout = generateArenaWithActiveMetrics(51_000);
    expect(placementsFor(layout.seed, layout.dirt)).toStrictEqual(placementsFor(layout.seed, layout.dirt));
    expect(placementsFor(layout.seed, layout.dirt)).not.toStrictEqual(placementsFor(layout.seed + 1, layout.dirt));
  });

  it('does not depend on the order of the dirt cell list', () => {
    // Host und Client leiten die Schicht unabhaengig voneinander ab. Haenge das Ergebnis an der
    // Listenreihenfolge, liefen beide Seiten auseinander, sobald die Liste anders sortiert ankommt.
    const layout = generateArenaWithActiveMetrics(51_001);
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
      const layout = generateArenaWithActiveMetrics(52_000 + index);
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
      const layout = generateArenaWithActiveMetrics(53_000 + index);
      for (const placement of placementsFor(layout.seed, layout.dirt)) {
        const localX = placement.worldX - ARENA_OFFSET_X;
        const localY = placement.worldY - ARENA_OFFSET_Y;
        expect(localX % CELL_SIZE).not.toBe(0);
        expect(localY % CELL_SIZE).not.toBe(0);
        // Auch die Zellmitte waere eine Rasterbindung.
        expect(localX % CELL_SIZE).not.toBe(CELL_SIZE / 2);
        // Positive remainder: cluster members may sit just outside the frame.
        octiles.add(Math.floor((((localX % CELL_SIZE) + CELL_SIZE) % CELL_SIZE / CELL_SIZE) * 8));
      }
    }
    expect(octiles.size).toBe(8);
  });

  it('keeps size, alpha and texture inside the configured bounds', () => {
    const byTexture = new Map<string, { tier: GroundCoverLayerConfig; variant: GroundCoverVariantConfig }>();
    for (const tier of GROUND_COVER_TIERS) {
      for (const variant of tier.variants) byTexture.set(getGroundCoverTextureKey(variant.fileName), { tier, variant });
    }
    const layout = generateArenaWithActiveMetrics(54_000);
    const placements = generateGroundCoverPlacements({ seed: layout.seed, dirt: layout.dirt, rocks: layout.rocks });
    expect(placements.length).toBeGreaterThan(0);

    for (const placement of placements) {
      const entry = byTexture.get(placement.textureKey);
      expect(entry).toBeDefined();
      const anchorConfig = entry!.tier[placement.anchor]!;
      expect(anchorConfig).toBeDefined();
      const [minCells, maxCells] = entry!.variant.sizeCells ?? [anchorConfig.minSizeCells, anchorConfig.maxSizeCells];
      expect(placement.sizePx).toBeGreaterThanOrEqual(minCells * CELL_SIZE - 1e-9);
      expect(placement.sizePx).toBeLessThanOrEqual(maxCells * CELL_SIZE + 1e-9);
      expect(placement.alpha).toBeGreaterThanOrEqual(anchorConfig.minAlpha);
      expect(placement.alpha).toBeLessThanOrEqual(anchorConfig.maxAlpha);
      expect(placement.rotation).toBeGreaterThanOrEqual(0);
      expect(placement.rotation).toBeLessThan(Math.PI * 2);
    }
  });

  it('stays inside the placement budget', () => {
    for (let index = 0; index < 10; index += 1) {
      const layout = generateArenaWithActiveMetrics(55_000 + index);
      for (const tier of GROUND_COVER_TIERS) {
        const placements = generateGroundCoverPlacements({ seed: layout.seed, dirt: layout.dirt, config: tier });
        const blocks = Math.ceil(GRID_COLS / tier.blockCells) * Math.ceil(GRID_ROWS / tier.blockCells);
        expect(placements.length).toBeLessThanOrEqual(getGroundCoverPlacementBudget(GRID_COLS, GRID_ROWS, tier));
        expect(placements.length).toBeLessThanOrEqual(blocks * tier.maxPerBlock * (tier.cluster?.members[1] ?? 1));
      }
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
    expect(placements.length).toBeLessThanOrEqual(
      GROUND_COVER_TIERS.reduce((sum, tier) => sum + getGroundCoverPlacementBudget(400, 80, tier), 0));
    expect(lowerHalf).toBeGreaterThan(upperHalf * 0.5);
  });

  it('honours the exclusion predicate', () => {
    const layout = generateArenaWithActiveMetrics(56_000);
    const placements = generateGroundCoverPlacements({
      seed: layout.seed,
      dirt: layout.dirt,
      excludeCell: () => true,
    });
    expect(placements).toHaveLength(0);
  });

  it('keeps rock cells free and anchors rock-foot detail right beside rocks', () => {
    const layout = generateArenaWithActiveMetrics(58_000);
    const rocks = new Set(layout.rocks.map((cell) => `${cell.gridX}:${cell.gridY}`));
    const placements = generateGroundCoverPlacements({ seed: layout.seed, dirt: layout.dirt, rocks: layout.rocks });
    const cellOf = (placement: GroundCoverPlacement) => [
      Math.min(GRID_COLS - 1, Math.max(0, Math.floor((placement.worldX - ARENA_OFFSET_X) / CELL_SIZE))),
      Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((placement.worldY - ARENA_OFFSET_Y) / CELL_SIZE))),
    ];
    expect(placements.some((placement) => placement.anchor === 'rockFoot')).toBe(true);
    for (const placement of placements) {
      const [x, y] = cellOf(placement);
      expect(rocks.has(`${x}:${y}`)).toBe(false);
      if (placement.anchor !== 'rockFoot') continue;
      let beside = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) beside ||= rocks.has(`${x + dx}:${y + dy}`);
      expect(beside).toBe(true);
    }
  });

  it('keeps water cells free and anchors bank growth on the dry cells beside water', () => {
    const water: { gridX: number; gridY: number }[] = [];
    for (let gridY = 8; gridY < 14; gridY += 1) for (let gridX = 10; gridX < 22; gridX += 1) water.push({ gridX, gridY });
    const wet = new Set(water.map((cell) => `${cell.gridX}:${cell.gridY}`));
    const placements = generateGroundCoverPlacements({ seed: 58_100, dirt: [], water });
    expect(placements.some((placement) => placement.anchor === 'bank')).toBe(true);
    for (const placement of placements) {
      const x = Math.floor((placement.worldX - ARENA_OFFSET_X) / CELL_SIZE);
      const y = Math.floor((placement.worldY - ARENA_OFFSET_Y) / CELL_SIZE);
      expect(wet.has(`${x}:${y}`)).toBe(false);
      if (placement.anchor !== 'bank') continue;
      let beside = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) beside ||= wet.has(`${x + dx}:${y + dy}`);
      expect(beside).toBe(true);
    }
  });

  it('groups vegetation into clusters with calm open ground in between', () => {
    const metrics = { offsetX: 0, offsetY: 0, gridCols: 120, gridRows: 80 };
    const placements = generateGroundCoverPlacements({ seed: 58_200, dirt: [], metrics, config: FOREST_VEGETATION_CONFIG });
    const nearest = placements.map((a, i) => {
      let best = Infinity;
      for (let j = 0; j < placements.length; j++) {
        if (j !== i) best = Math.min(best, Math.hypot(a.worldX - placements[j].worldX, a.worldY - placements[j].worldY));
      }
      return best / CELL_SIZE;
    }).sort((a, b) => a - b);
    // A uniform scatter of the same count would space plants about this far apart.
    const uniformSpacing = 0.5 * Math.sqrt(metrics.gridCols * metrics.gridRows / placements.length);
    expect(nearest[nearest.length >> 1]).toBeLessThan(uniformSpacing * 0.7);
    let open = 0, windows = 0;
    for (let y = 0; y < metrics.gridRows; y += 4) for (let x = 0; x < metrics.gridCols; x += 4) {
      windows += 1;
      if (!placements.some((p) => p.worldX >= x * CELL_SIZE && p.worldX < (x + 4) * CELL_SIZE
        && p.worldY >= y * CELL_SIZE && p.worldY < (y + 4) * CELL_SIZE)) open += 1;
    }
    expect(open / windows).toBeGreaterThan(0.25);
  });

  it('produces only grass anchors without any dirt', () => {
    const placements = placementsFor(57_000, []);
    expect(placements.length).toBeGreaterThan(0);
    expect(placements.every((placement) => placement.anchor === 'grass')).toBe(true);
  });
});
