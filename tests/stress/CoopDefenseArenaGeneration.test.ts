import { generateArenaWithActiveMetrics } from '../ArenaGeneratorTestHelper';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '2' },
}));

import {
  COOP_DEFENSE_BASE_TRACK_CLEARANCE_CELLS,
  resolveCoopDefenseBases,
} from '../../src/arena/BaseRegistry';
import { COOP_DEFENSE_MAX_REQUIRED_TRACK_RUN_CELLS, applyArenaMetricsForMode, GRID_COLS, GRID_ROWS } from '../../src/config';
import { getCoopDefenseMapConfig } from '../../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../../src/gameModes';
import { resolveCoopDefenseMapMissionProgress } from '../../src/config/coopDefenseMaps';
import { CoopDefenseMissionProgressSystem } from '../../src/systems/CoopDefenseMissionProgressSystem';
import { resolveActiveArenaWorldMetrics } from '../../src/world/WorldMetrics';
import { CELL_SIZE } from '../../src/config';

describe('Coop defense arena generation', () => {
  it('keeps a two-cell dry walk around the authored test pond across seeds', () => {
    const pondMap = getCoopDefenseMapConfig('0');
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', pondMap.arenaWidthCells, pondMap.arenaHeightCells);
    for (const seed of [1, 183, 444, 1907, 7733]) {
      const layout = generateArenaWithActiveMetrics(seed, pondMap);
      const solids = new Set([...layout.rocks, ...layout.trees].map(c => `${c.gridX}:${c.gridY}`));
      for (const c of layout.water ?? []) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        expect(solids.has(`${c.gridX + dx}:${c.gridY + dy}`), `${seed} pond clearance at ${c.gridX + dx},${c.gridY + dy}`).toBe(false);
    }
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
  });
  const map = getCoopDefenseMapConfig('2');

  beforeAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
  });

  afterAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'LOBBY');
  });

  it('generates every campaign map with valid in-bounds content', () => {
    for (let id = 1; id <= 17; id++) {
      const campaign = getCoopDefenseMapConfig(String(id));
      applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', campaign.arenaWidthCells, campaign.arenaHeightCells);
      const layout = generateArenaWithActiveMetrics(81000 + id, campaign);
      for (const cell of [...layout.rocks, ...layout.trees, ...layout.powerUpPedestals,
        ...(layout.groundHazardZones ?? []).flatMap(zone => zone.cells)]) {
        expect(cell.gridX, `Map ${id}`).toBeGreaterThanOrEqual(0);
        expect(cell.gridX, `Map ${id}`).toBeLessThan(GRID_COLS);
        expect(cell.gridY, `Map ${id}`).toBeGreaterThanOrEqual(0);
        expect(cell.gridY, `Map ${id}`).toBeLessThan(GRID_ROWS);
      }
    }
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
  });

  it('keeps authored advance encounters reachable and extraction behind their final barrier across seeds', () => {
    for (const id of ['7', '16']) for (const seed of [101, 444, 1907, 7733]) {
      const campaign = getCoopDefenseMapConfig(id);
      applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', campaign.arenaWidthCells, campaign.arenaHeightCells);
      const metrics = resolveActiveArenaWorldMetrics();
      const layout = generateArenaWithActiveMetrics(seed, campaign);
      const route = resolveCoopDefenseMapMissionProgress(campaign)!;
      const occupied = new Set([...layout.rocks, ...layout.trees,
        ...resolveCoopDefenseBases(campaign).flatMap(base => base.cells)].map(cell => `${cell.gridX}:${cell.gridY}`));
      const cleared = new Set<string>();
      const progress = new CoopDefenseMissionProgressSystem(route, { roundRevision: 1, worldMetrics: metrics,
        getDefenseObjectiveState: () => null, isEncounterCleared: encounter => cleared.has(encounter) });
      const flood = (x: number, y: number, closed: Set<string>) => {
        const seen = new Set<string>(); const queue = [{ gridX: x, gridY: y }];
        for (let i = 0; i < queue.length; i++) {
          const c = queue[i], key = `${c.gridX}:${c.gridY}`;
          if (seen.has(key) || occupied.has(key) || closed.has(key) || c.gridX < 0 || c.gridY < 0
            || c.gridX >= GRID_COLS || c.gridY >= GRID_ROWS) continue;
          seen.add(key);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) queue.push({ gridX: c.gridX + dx, gridY: c.gridY + dy });
        }
        return seen;
      };
      for (const [index, checkpoint] of route.checkpoints.entries()) {
        const closed = new Set(route.barriers.filter(barrier => barrier.openOn.type === 'after-encounter'
          && !cleared.has(barrier.openOn.encounterId)).flatMap(barrier => barrier.cells.map(cell => `${cell.gridX}:${cell.gridY}`)));
        const reachable = flood(checkpoint.gridX, checkpoint.gridY, closed);
        expect(reachable.size, `${id}/${seed}/${checkpoint.id}`).toBeGreaterThan(0);
        const previous = route.checkpoints[index - 1] ?? route.startArea!;
        expect([...reachable].some(key => {
          const [x, y] = key.split(':').map(Number);
          return Math.hypot(x - previous.gridX, y - previous.gridY) <= previous.radiusCells;
        }), `${id}/${seed}/${checkpoint.id} approach`).toBe(true);
        const encounter = campaign.encounters?.find(entry => entry.start.type === 'after-checkpoint'
          && entry.start.checkpointId === checkpoint.id);
        if (encounter) {
          const extraction = route.checkpoints.at(-1)!;
          expect(reachable.has(`${extraction.gridX}:${extraction.gridY}`)).toBe(false);
          for (const group of encounter.groups) {
            const area = group.spawnArea!;
            expect([...reachable].some(key => {
              const [x, y] = key.split(':').map(Number);
              return x >= area.gridX && x < area.gridX + area.widthCells && y >= area.gridY && y < area.gridY + area.heightCells;
            }), `${id}/${seed}/${encounter.id} spawn`).toBe(true);
          }
        }
        progress.hostUpdate(16, false, [{ playerId: 'p', eligible: true,
          x: metrics.offsetX + (checkpoint.gridX + .5) * CELL_SIZE,
          y: metrics.offsetY + (checkpoint.gridY + .5) * CELL_SIZE }]);
        expect(progress.isCheckpointActivated(checkpoint.id)).toBe(true);
        if (encounter) { expect(progress.isRouteComplete()).toBe(false); cleared.add(encounter.id); }
      }
      expect(progress.isRouteComplete()).toBe(true);
      if (id === '7') expect(progress.getRespawnCheckpointId()).toBeNull();
    }
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
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
