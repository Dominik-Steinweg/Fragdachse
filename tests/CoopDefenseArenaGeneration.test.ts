import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '2' },
}));

import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import {
  COOP_DEFENSE_BASE_TRACK_CLEARANCE_CELLS,
  resolveCoopDefenseBases,
} from '../src/arena/BaseRegistry';
import { applyArenaMetricsForMode } from '../src/config';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';

describe('Coop defense arena generation', () => {
  const map = getCoopDefenseMapConfig('2');

  beforeAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
  });

  afterAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'LOBBY');
  });

  it('keeps the railway away from the authored base footprint', () => {
    const layout = ArenaGenerator.generate(2_002, map);
    const trackColumns = new Set(layout.tracks.flatMap((track) => [track.gridX, track.gridX + 1]));

    for (const base of resolveCoopDefenseBases(map)) {
      for (const trackColumn of trackColumns) {
        expect(
          trackColumn < base.region.minGridX - COOP_DEFENSE_BASE_TRACK_CLEARANCE_CELLS
            || trackColumn > base.region.maxGridX + COOP_DEFENSE_BASE_TRACK_CLEARANCE_CELLS,
        ).toBe(true);
      }
    }
  });

  it('places Map 6 on the authored left lane independently of the arena seed', () => {
    const map6 = getCoopDefenseMapConfig('6');
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map6.arenaWidthCells, map6.arenaHeightCells);

    const first = ArenaGenerator.generate(6_001, map6);
    const second = ArenaGenerator.generate(6_002, map6);

    expect(first.tracks[0]?.gridX).toBe(second.tracks[0]?.gridX);
    expect(first.tracks[0]?.gridX).toBeLessThan(Math.floor((map6.arenaWidthCells - 2) / 2));

    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
  });

  it('accepts a safe authored grid lane and rejects one inside base clearance', () => {
    const baseSpecs = resolveCoopDefenseBases(map);
    const safeGridX = Math.max(
      0,
      Math.min(...baseSpecs.map((base) => base.region.minGridX))
        - COOP_DEFENSE_BASE_TRACK_CLEARANCE_CELLS - 2,
    );
    const safeMap = { ...map, trackPosition: { kind: 'grid' as const, gridX: safeGridX } };
    const safeLayout = ArenaGenerator.generate(2_003, safeMap);
    expect(safeLayout.tracks[0]?.gridX).toBe(safeGridX);

    const overlappingGridX = baseSpecs[0]?.region.minGridX ?? safeGridX;
    const overlappingMap = { ...map, trackPosition: { kind: 'grid' as const, gridX: overlappingGridX } };
    expect(() => ArenaGenerator.generate(2_004, overlappingMap)).toThrow(/overlaps a base or its clearance/);
  });
});
