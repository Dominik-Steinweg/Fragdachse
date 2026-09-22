import { generateArenaWithActiveMetrics } from './ArenaGeneratorTestHelper';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Der Generator fragt die aktive Map über die Netzwerk-Bridge ab (Basis-Schutzradien).
// Ohne laufende Netzwerksitzung wird hier nur diese eine Auskunft ersetzt.
vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '14' },
}));

import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { applyArenaMetricsForMode, GRID_COLS, GRID_ROWS } from '../src/config';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { getCoopDefenseMapConfig, normalizeCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';

const MAP_14 = '14';

/** Mehrere Seeds, weil die Gänge pro Runde neu ausgewürfelt werden. */
const SEEDS = [4_711, 20_260_721, 1, 987_654, 31_337];
const blockedGridBySeed = new Map<number, boolean[][]>();

it('retains procedural terrain only in organic fields and defaults to the existing solid field', () => {
  const generate = (fillMode?: 'solid' | 'organic') => {
    const map = normalizeCoopDefenseMapConfig({
      mapId: 'rock-field-mode-test', arenaWidthCells: 40, arenaHeightCells: 33,
      objective: 'survive', surviveDurationSec: 60, balanceReferenceDurationSec: 60,
      respawnsPerPlayer: 1, bases: [], powerUps: [],
      rockFillRatio: 0, treeCount: 0,
      rockField: {
        fillMode, corridorRadiusCells: 2, corridorRadiusVarianceCells: 0,
        corridorWanderCells: 0, waypointJitterCells: 0,
        corridors: [{ id: 'route', points: [{ gridX: 2, gridY: 16 }, { gridX: 37, gridY: 16 }] }],
      },
    });
    const metrics = resolveCoopDefenseWorldMetrics(map.arenaWidthCells, map.arenaHeightCells);
    return ArenaGenerator.generate(123, resolveArenaGenerationInput('coop_defense', metrics), map);
  };
  expect(generate('organic').rocks).toHaveLength(0);
  const solid = generate('solid');
  expect(solid.rocks.length).toBeGreaterThan(0);
  expect(ArenaGenerator.fingerprint(generate())).toBe(ArenaGenerator.fingerprint(solid));
});

function buildBlockedGrid(seed: number): boolean[][] {
  const cached = blockedGridBySeed.get(seed);
  if (cached) return cached;

  const layout = generateArenaWithActiveMetrics(seed, getCoopDefenseMapConfig(MAP_14));
  const blocked = Array.from({ length: GRID_ROWS }, () => new Array<boolean>(GRID_COLS).fill(false));
  for (const rock of layout.rocks) blocked[rock.gridY][rock.gridX] = true;
  for (const tree of layout.trees) blocked[tree.gridY][tree.gridX] = true;
  blockedGridBySeed.set(seed, blocked);
  return blocked;
}

/** Alle von (startX, startY) aus über freie Zellen erreichbaren Felder. */
function floodFill(blocked: boolean[][], startX: number, startY: number): Set<string> {
  const reached = new Set<string>();
  if (blocked[startY][startX]) return reached;

  const queue: Array<[number, number]> = [[startX, startY]];
  reached.add(`${startX}:${startY}`);
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
      if (blocked[ny][nx] || reached.has(`${nx}:${ny}`)) continue;
      reached.add(`${nx}:${ny}`);
      queue.push([nx, ny]);
    }
  }
  return reached;
}

describe('Map 14 rock field', () => {
  beforeAll(() => {
    // Der Generator liest die globalen Arena-Metriken; ohne Coop-Profil fehlen Spaltenzahl
    // und Basis-Schutzradien, und die Gang-Koordinaten der Map lägen daneben.
    const map = getCoopDefenseMapConfig(MAP_14);
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
  });

  it('generates both rock and walkable ground on every seed', () => {
    for (const seed of SEEDS) {
      const blocked = buildBlockedGrid(seed);
      let freeCells = 0;
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        for (let gx = 0; gx < GRID_COLS; gx++) {
          if (!blocked[gy][gx]) freeCells++;
        }
      }

      expect(freeCells).toBeLessThan(GRID_COLS * GRID_ROWS);
      expect(freeCells).toBeGreaterThan(0);
    }
  });

  it('connects the left spawn edge with both bases on every seed', () => {
    for (const seed of SEEDS) {
      const blocked = buildBlockedGrid(seed);
      const spawnRows: number[] = [];
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        if (!blocked[gy][0]) spawnRows.push(gy);
      }
      expect(spawnRows.length).toBeGreaterThan(0);

      const reachable = floodFill(blocked, 0, spawnRows[0]);
      for (const base of resolveCoopDefenseBases(getCoopDefenseMapConfig(MAP_14))) {
        const touchesBase = base.cells.some((cell) => (
          [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
        ).some(([dx, dy]) => reachable.has(`${cell.gridX + dx}:${cell.gridY + dy}`)));
        expect(touchesBase).toBe(true);
      }

      // Jede freie Zelle am linken Rand gehört zum selben Wegenetz – sonst könnten eingebuddelte
      // Gegner in einer abgeschnittenen Tasche auftauchen.
      for (const gy of spawnRows) expect(reachable.has(`0:${gy}`)).toBe(true);
    }
  });

  it('keeps the authored corridor endpoints connected to the spawn route', () => {
    const corridors = getCoopDefenseMapConfig(MAP_14).rockField?.corridors ?? [];
    expect(corridors.length).toBeGreaterThan(0);
    for (const seed of SEEDS) {
      const blocked = buildBlockedGrid(seed);
      const spawnY = blocked.findIndex((row) => !row[0]);
      expect(spawnY).toBeGreaterThanOrEqual(0);
      const reachable = floodFill(blocked, 0, spawnY);
      for (const corridor of corridors) {
        const endpoints = [corridor.points[0], corridor.points[corridor.points.length - 1]];
        for (const point of endpoints) {
          expect(reachable.has(`${point.gridX}:${point.gridY}`), `${seed}/${corridor.id}`).toBe(true);
        }
      }
    }
  });

  it('varies the generated rock field between seeds', () => {
    const signatures = SEEDS.map((seed) => buildBlockedGrid(seed).map((row) => row.map(Number).join('')).join('|'));
    expect(new Set(signatures).size).toBe(SEEDS.length);
  });
});
