import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '0' },
}));

import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { applyArenaMetricsForMode, GRID_COLS, GRID_ROWS } from '../src/config';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';

const TEST_MAP = getCoopDefenseMapConfig('0');

describe('Coop defense arena width', () => {
  beforeAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', TEST_MAP.arenaWidthCells);
  });

  afterAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'LOBBY');
  });

  it('generates the enlarged test map inside a 90-column grid', () => {
    expect(GRID_COLS).toBe(90);
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
  });

  it('keeps every configured base cell inside the enlarged grid', () => {
    for (const base of resolveCoopDefenseBases(TEST_MAP)) {
      for (const cell of base.cells) {
        expect(cell.gridX).toBeGreaterThanOrEqual(0);
        expect(cell.gridX).toBeLessThan(GRID_COLS);
        expect(cell.gridY).toBeGreaterThanOrEqual(0);
        expect(cell.gridY).toBeLessThan(GRID_ROWS);
      }
    }
  });
});
