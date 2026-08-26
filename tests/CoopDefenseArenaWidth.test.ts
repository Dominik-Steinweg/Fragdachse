import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '0' },
}));

import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { applyArenaMetricsForMode, GRID_COLS, GRID_ROWS } from '../src/config';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';

const TEST_MAP = getCoopDefenseMapConfig('0');

describe('Coop defense arena width', () => {
  beforeAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', TEST_MAP.arenaWidthCells, TEST_MAP.arenaHeightCells);
  });

  afterAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'LOBBY');
  });

  // Die Metrik traegt jetzt beide authored Masse der Map. Der Generator arbeitet dadurch auf dem
  // vollen Raster dieser Map statt auf dem frueheren Teilraster und braucht spuerbar laenger;
  // das Zeitlimit ist deshalb bewusst grosszuegig.
  it('generates the configured test map inside its column grid', () => {
    expect(GRID_COLS).toBe(TEST_MAP.arenaWidthCells);
    const layout = ArenaGenerator.generate(47_110, TEST_MAP);
    const cells = [
      ...layout.rocks,
      ...layout.trees,
      ...(layout.tracks ?? []),
      ...(layout.dirt ?? []),
      ...(layout.decals ?? []),
      ...(layout.powerUpPedestals ?? []),
    ];
    for (const cell of cells) {
      expect(cell.gridX).toBeGreaterThanOrEqual(0);
      expect(cell.gridX).toBeLessThan(GRID_COLS);
      expect(cell.gridY).toBeGreaterThanOrEqual(0);
      expect(cell.gridY).toBeLessThan(GRID_ROWS);
    }
  }, 20_000);

  it('keeps every configured base cell inside the grid of its own map', () => {
    // Die Basisgeometrie folgt der Metrik dieser Map, nicht der gerade global aktiven Arena.
    const metrics = resolveCoopDefenseWorldMetrics(TEST_MAP.arenaWidthCells, TEST_MAP.arenaHeightCells);
    expect(metrics.gridCols).toBe(GRID_COLS);
    expect(metrics.gridRows).toBe(GRID_ROWS);
    for (const base of resolveCoopDefenseBases(TEST_MAP)) {
      for (const cell of base.cells) {
        expect(cell.gridX).toBeGreaterThanOrEqual(0);
        expect(cell.gridX).toBeLessThan(metrics.gridCols);
        expect(cell.gridY).toBeGreaterThanOrEqual(0);
        expect(cell.gridY).toBeLessThan(metrics.gridRows);
      }
    }
  });
});
