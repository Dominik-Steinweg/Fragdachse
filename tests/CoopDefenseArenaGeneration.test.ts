import { generateArenaWithActiveMetrics } from './ArenaGeneratorTestHelper';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '2' },
}));

import {
  COOP_DEFENSE_BASE_TRACK_CLEARANCE_CELLS,
  resolveCoopDefenseBases,
} from '../src/arena/BaseRegistry';
import { COOP_DEFENSE_MAX_REQUIRED_TRACK_RUN_CELLS, applyArenaMetricsForMode, GRID_COLS, GRID_ROWS } from '../src/config';
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
    const layout = generateArenaWithActiveMetrics(2_002, map);
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

    const first = generateArenaWithActiveMetrics(6_001, map6);
    const second = generateArenaWithActiveMetrics(6_002, map6);

    expect(first.tracks[0]?.gridX).toBe(second.tracks[0]?.gridX);
    expect(first.tracks[0]?.gridX).toBeLessThan(Math.floor((map6.arenaWidthCells - 2) / 2));

    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
  });

  it('accepts a safe authored grid lane and rejects one inside base clearance', () => {
    const baseSpecs = resolveCoopDefenseBases(map);
    // Eine persistente Basis sperrt nicht nur ihre eigene Flaeche, sondern ihre gesamte
    // Reservierung: Dort darf spaeter gebaut werden, also darf dort kein Gleis liegen.
    const safeGridX = Math.max(
      0,
      Math.min(...baseSpecs.map((base) => (
        base.persistentReservationRadiusCells === undefined
          ? base.region.minGridX
          : Math.min(
            base.region.minGridX,
            (base.anchorGridX ?? base.region.minGridX) - base.persistentReservationRadiusCells,
          )
      )))
        - COOP_DEFENSE_BASE_TRACK_CLEARANCE_CELLS - 2,
    );
    const safeMap = { ...map, trackPosition: { kind: 'grid' as const, gridX: safeGridX } };
    const safeLayout = generateArenaWithActiveMetrics(2_003, safeMap);
    expect(safeLayout.tracks[0]?.gridX).toBe(safeGridX);

    const overlappingGridX = baseSpecs[0]?.region.minGridX ?? safeGridX;
    const overlappingMap = { ...map, trackPosition: { kind: 'grid' as const, gridX: overlappingGridX } };
    expect(() => generateArenaWithActiveMetrics(2_004, overlappingMap)).toThrow(/overlaps a base or its clearance/);
  });

  it('keeps authored mission barrier cells free of generated obstacles and objectives', () => {
    const barrierCell = { gridX: 4, gridY: 4 };
    const missionMap = {
      ...map,
      missionProgress: {
        checkpoints: [{ id: 'entry', gridX: 3, gridY: 4, radiusCells: 0.5, setRespawn: false }],
        mandatoryDefenses: [],
        barriers: [{
          id: 'entry-gate',
          cells: [barrierCell],
          openOn: { type: 'after-checkpoint' as const, checkpointId: 'entry' },
        }],
      },
    };
    const layout = generateArenaWithActiveMetrics(2_005, missionMap);
    const occupiesBarrier = (cell: { gridX: number; gridY: number }) => (
      cell.gridX === barrierCell.gridX && cell.gridY === barrierCell.gridY
    );

    expect(layout.rocks.some(occupiesBarrier)).toBe(false);
    expect(layout.trees.some(occupiesBarrier)).toBe(false);
    expect(layout.powerUpPedestals.some(occupiesBarrier)).toBe(false);
    expect(layout.groundHazardZones?.some((zone) => zone.cells.some(occupiesBarrier)) ?? false).toBe(false);
  });

  it('keeps Map 5 west-spawn routes from requiring a long longitudinal rail run', () => {
    const map5 = getCoopDefenseMapConfig('5');
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map5.arenaWidthCells, map5.arenaHeightCells);
    const baseSpecs = resolveCoopDefenseBases(map5);

    for (const seed of [5_001, 5_002, 5_003, 5_004]) {
      const layout = generateArenaWithActiveMetrics(seed, map5);
      const blocked = new Set([
        ...layout.rocks.map((cell) => `${cell.gridX}:${cell.gridY}`),
        ...layout.trees.map((cell) => `${cell.gridX}:${cell.gridY}`),
      ]);
      const tracks = new Set<string>();
      for (const track of layout.tracks) {
        tracks.add(`${track.gridX}:${track.gridY}`);
        tracks.add(`${track.gridX + 1}:${track.gridY}`);
      }
      const baseCells = new Set(baseSpecs.flatMap((base) => (
        base.cells.map((cell) => `${cell.gridX}:${cell.gridY}`)
      )));
      const targets = new Set<string>();
      for (const base of baseSpecs.filter((entry) => entry.faction !== 'hostile' && entry.role !== 'spawn-point')) {
        for (const cell of base.cells) {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const gridX = cell.gridX + dx;
            const gridY = cell.gridY + dy;
            const key = `${gridX}:${gridY}`;
            if (
              gridX >= 0 && gridX < GRID_COLS && gridY >= 0 && gridY < GRID_ROWS
              && !blocked.has(key) && !baseCells.has(key)
            ) targets.add(key);
          }
        }
      }

      const westDepth = Math.min(Math.max(2, Math.floor(GRID_COLS * 0.15)), GRID_COLS - 1);
      const queue: Array<{ gridX: number; gridY: number; trackRun: number }> = [];
      const visited = new Set<string>();
      for (let gridY = 0; gridY < GRID_ROWS; gridY += 1) {
        for (let gridX = 0; gridX <= westDepth; gridX += 1) {
          const key = `${gridX}:${gridY}`;
          if (blocked.has(key) || baseCells.has(key)) continue;
          const trackRun = tracks.has(key) ? 1 : 0;
          queue.push({ gridX, gridY, trackRun });
          visited.add(`${key}:${trackRun}`);
        }
      }

      let reached = false;
      for (let cursor = 0; cursor < queue.length && !reached; cursor += 1) {
        const current = queue[cursor];
        if (targets.has(`${current.gridX}:${current.gridY}`)) {
          reached = true;
          break;
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const gridX = current.gridX + dx;
          const gridY = current.gridY + dy;
          if (gridX < 0 || gridX >= GRID_COLS || gridY < 0 || gridY >= GRID_ROWS) continue;
          const key = `${gridX}:${gridY}`;
          if (blocked.has(key)) continue;
          const trackRun = tracks.has(key) ? current.trackRun + 1 : 0;
          if (trackRun > COOP_DEFENSE_MAX_REQUIRED_TRACK_RUN_CELLS) continue;
          const stateKey = `${key}:${trackRun}`;
          if (visited.has(stateKey)) continue;
          visited.add(stateKey);
          queue.push({ gridX, gridY, trackRun });
        }
      }

      expect(reached, `Map 5 seed ${seed} has no short west-spawn route`).toBe(true);
    }

    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
  });
});
