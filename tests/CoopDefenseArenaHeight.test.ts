import { generateArenaWithActiveMetrics } from './ArenaGeneratorTestHelper';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '8' },
}));
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import {
  ARENA_HEIGHT,
  ARENA_MAX_Y,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  GRID_ROWS,
  applyArenaMetricsForMode,
} from '../src/config';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';

const MAP_8 = getCoopDefenseMapConfig('8');
const STANDARD_MAP = getCoopDefenseMapConfig('1');

describe('Coop defense arena height', () => {
  beforeAll(() => {
    applyArenaMetricsForMode(
      COOP_DEFENSE_MODE,
      'ARENA',
      MAP_8.arenaWidthCells,
      MAP_8.arenaHeightCells,
    );
  });

  afterAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'LOBBY');
  });

  it('uses the configured Map 8 height for grid, world bounds and generated cells', () => {
    expect(GRID_ROWS).toBe(MAP_8.arenaHeightCells);
    expect(ARENA_HEIGHT).toBe(MAP_8.arenaHeightCells * CELL_SIZE);
    expect(ARENA_MAX_Y).toBe(ARENA_OFFSET_Y + ARENA_HEIGHT);

    const layout = generateArenaWithActiveMetrics(81_008, MAP_8);
    for (const cell of [
      ...layout.rocks,
      ...layout.trees,
      ...layout.tracks,
      ...layout.dirt,
      ...(layout.decals ?? []),
      ...layout.powerUpPedestals,
    ]) {
      expect(cell.gridY).toBeGreaterThanOrEqual(0);
      expect(cell.gridY).toBeLessThan(GRID_ROWS);
    }

    for (const base of resolveCoopDefenseBases(MAP_8)) {
      for (const cell of base.cells) {
        expect(cell.gridY).toBeGreaterThanOrEqual(0);
        expect(cell.gridY).toBeLessThan(GRID_ROWS);
      }
    }
  });

  it('keeps maps without an explicit height at the legacy grid height', () => {
    applyArenaMetricsForMode(
      COOP_DEFENSE_MODE,
      'ARENA',
      STANDARD_MAP.arenaWidthCells,
      STANDARD_MAP.arenaHeightCells,
    );
    expect(GRID_ROWS).toBe(STANDARD_MAP.arenaHeightCells);
    expect(ARENA_HEIGHT).toBe(STANDARD_MAP.arenaHeightCells * CELL_SIZE);
  });
});
