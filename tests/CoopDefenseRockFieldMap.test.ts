import { beforeAll, describe, expect, it, vi } from 'vitest';

// Der Generator fragt die aktive Map über die Netzwerk-Bridge ab (Basis-Schutzradien).
// Ohne laufende Netzwerksitzung wird hier nur diese eine Auskunft ersetzt.
vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '14' },
}));

import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { applyArenaMetricsForMode, GRID_COLS, GRID_ROWS } from '../src/config';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';

const MAP_14 = '14';

/** Mehrere Seeds, weil die Gänge pro Runde neu ausgewürfelt werden. */
const SEEDS = [4_711, 20_260_721, 1, 987_654, 31_337];

function buildBlockedGrid(seed: number): boolean[][] {
  const layout = ArenaGenerator.generate(seed, getCoopDefenseMapConfig(MAP_14));
  const blocked = Array.from({ length: GRID_ROWS }, () => new Array<boolean>(GRID_COLS).fill(false));
  for (const rock of layout.rocks) blocked[rock.gridY][rock.gridX] = true;
  for (const tree of layout.trees) blocked[tree.gridY][tree.gridX] = true;
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
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA');
  });

  it('walls in everything except the corridors, the bases and the railway', () => {
    for (const seed of SEEDS) {
      const blocked = buildBlockedGrid(seed);
      let freeCells = 0;
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        for (let gx = 0; gx < GRID_COLS; gx++) {
          if (!blocked[gy][gx]) freeCells++;
        }
      }

      // Deutlich unter der Hälfte begehbar; der Rest ist Fels. Der freie Anteil besteht fast nur
      // aus den Schutzradien der beiden Basen, den Gleisspalten und den Gängen.
      expect(freeCells).toBeLessThan(GRID_COLS * GRID_ROWS * 0.4);
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

  it('opens three corridors towards the middle base and two towards the rear base', () => {
    const countOpenRuns = (blocked: boolean[][], gridX: number): number => {
      let runs = 0;
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        if (!blocked[gy][gridX] && (gy === 0 || blocked[gy - 1][gridX])) runs++;
      }
      return runs;
    };

    for (const seed of SEEDS) {
      const blocked = buildBlockedGrid(seed);
      // Spalte 15 liegt zwischen Spawnrand und mittlerer Basis, Spalte 48 zwischen den Basen.
      // Die Gleisspalten liegen in beiden Fällen nicht dazwischen.
      expect(countOpenRuns(blocked, 15)).toBe(3);
      expect(countOpenRuns(blocked, 48)).toBe(2);
    }
  });

  it('varies the corridor shape between seeds instead of stamping a fixed pattern', () => {
    const signatures = SEEDS.map((seed) => buildBlockedGrid(seed).map((row) => row.map(Number).join('')).join('|'));
    expect(new Set(signatures).size).toBe(SEEDS.length);

    // Ein Gang schwankt in der Breite: die Anzahl freier Zellen je Spalte darf im vorderen
    // Bereich nicht über die ganze Strecke konstant sein.
    const blocked = buildBlockedGrid(SEEDS[0]);
    const widths: number[] = [];
    for (let gx = 2; gx <= 12; gx++) {
      let openCells = 0;
      for (let gy = 0; gy <= 10; gy++) if (!blocked[gy][gx]) openCells++;
      widths.push(openCells);
    }
    expect(new Set(widths).size).toBeGreaterThan(1);
  });
});
