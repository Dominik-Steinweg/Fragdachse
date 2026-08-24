import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => 'weapon-balance-lab' },
}));

import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { applyArenaMetricsForMode } from '../src/config';
import { getCoopDefenseMapConfig, WEAPON_BALANCE_LAB_MAP_ID } from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';

describe('Weapon Balance Lab internal arena', () => {
  const map = getCoopDefenseMapConfig(WEAPON_BALANCE_LAB_MAP_ID);

  beforeAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
  });

  afterAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'LOBBY');
  });

  it('keeps every generated measurement lane free of rocks, trees and authored hazards', () => {
    for (const seed of [1, 2, 3, 4]) {
      const layout = ArenaGenerator.generate(seed, map);
      expect(layout.rocks).toEqual([]);
      expect(layout.trees).toEqual([]);
      expect(layout.powerUpPedestals).toEqual([]);
      expect(layout.groundHazardZones ?? []).toEqual([]);
    }
  });
});
