import { GRID_COLS, GRID_ROWS, ROCK_FILL_RATIO, TREE_COUNT, CANOPY_RADIUS, CELL_SIZE } from '../config';
import type { ArenaLayout, RockCell, TreeCell } from '../types';

/**
 * Prozeduraler Arena-Generator – keine Phaser-Abhängigkeit.
 * Generiert ein ArenaLayout mit Felsen und Bäumen auf dem 48px-Raster.
 * Garantiert durch BFS-Konnektivitätsprüfung, dass alle begehbaren Zellen
 * miteinander verbunden sind (keine eingesperrten Bereiche).
 */
export class ArenaGenerator {
  /**
   * Generiert ein ArenaLayout für den gegebenen Seed.
   * Versucht bis zu 100 Mal einen konnektiven Layout zu erzeugen.
   */
  static generate(seed: number): ArenaLayout {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rng = ArenaGenerator.makePrng(seed + attempt);
      const blocked: boolean[][] = Array.from({ length: GRID_ROWS }, () =>
        new Array(GRID_COLS).fill(false),
      );

      // Alle Zellen als Kandidaten sammeln und shuffeln
      const allCells: Array<{ gx: number; gy: number }> = [];
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        for (let gx = 0; gx < GRID_COLS; gx++) {
          allCells.push({ gx, gy });
        }
      }
      ArenaGenerator.shuffle(allCells, rng);

      // Felsen platzieren
      const totalCells    = GRID_COLS * GRID_ROWS;
      const rockCount     = Math.floor(totalCells * ROCK_FILL_RATIO);
      const rocks: RockCell[] = [];
      let placed = 0;
      for (const { gx, gy } of allCells) {
        if (placed >= rockCount) break;
        blocked[gy][gx] = true;
        rocks.push({ gridX: gx, gridY: gy });
        placed++;
      }

      // Konnektivitätsprüfung
      if (!ArenaGenerator.isConnected(blocked)) continue;

      // Bäume auf verbleibenden freien Zellen platzieren.
      // Mindestabstand zum Arena-Rand: ceil(CANOPY_RADIUS / CELL_SIZE) Zellen,
      // damit die Baumkrone nie über die Arena-Grenze hinausragt.
      const treeMargin = Math.ceil(CANOPY_RADIUS / CELL_SIZE); // bei r=96, size=48 → 2
      const trees: TreeCell[] = [];
      const shuffledForTrees = allCells.filter(
        ({ gx, gy }) =>
          !blocked[gy][gx] &&
          gx >= treeMargin && gx < GRID_COLS - treeMargin &&
          gy >= treeMargin && gy < GRID_ROWS - treeMargin,
      );
      // Nochmals shuffeln für unabhängige Baumpositionierung
      ArenaGenerator.shuffle(shuffledForTrees, rng);

      for (const { gx, gy } of shuffledForTrees) {
        if (trees.length >= TREE_COUNT) break;
        blocked[gy][gx] = true;
        trees.push({ gridX: gx, gridY: gy });
      }

      // Nochmalige Konnektivitätsprüfung nach Baumplatzierung
      if (!ArenaGenerator.isConnected(blocked)) continue;

      return { seed: seed + attempt, rocks, trees };
    }

    throw new Error(
      `ArenaGenerator: Konnte nach 100 Versuchen kein konnektives Layout generieren (seed=${seed})`,
    );
  }

  /**
   * BFS-Konnektivitätsprüfung (4-connected).
   * Gibt true zurück, wenn alle nicht-blockierten Zellen erreichbar sind.
   */
  private static isConnected(blocked: boolean[][]): boolean {
    // Erste freie Zelle als BFS-Startpunkt finden
    let startGx = -1;
    let startGy = -1;
    outer: for (let gy = 0; gy < GRID_ROWS; gy++) {
      for (let gx = 0; gx < GRID_COLS; gx++) {
        if (!blocked[gy][gx]) { startGx = gx; startGy = gy; break outer; }
      }
    }
    if (startGx === -1) return false; // Komplett blockiert

    // BFS
    const visited = Array.from({ length: GRID_ROWS }, () =>
      new Array(GRID_COLS).fill(false),
    );
    const queue: Array<[number, number]> = [[startGx, startGy]];
    visited[startGy][startGx] = true;
    let visitedCount = 1;
    const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
        if (visited[ny][nx] || blocked[ny][nx]) continue;
        visited[ny][nx] = true;
        visitedCount++;
        queue.push([nx, ny]);
      }
    }

    // Zähle alle freien Zellen
    let freeCells = 0;
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      for (let gx = 0; gx < GRID_COLS; gx++) {
        if (!blocked[gy][gx]) freeCells++;
      }
    }

    return visitedCount === freeCells;
  }

  /**
   * Fisher-Yates-Shuffle mit seeded PRNG.
   */
  private static shuffle<T>(arr: T[], rng: () => number): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /**
   * Mulberry32 – schneller, seeded PRNG.
   * Gibt eine Funktion zurück, die bei jedem Aufruf eine Zahl in [0, 1) liefert.
   */
  private static makePrng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s  += 0x6d2b79f5;
      let t = s;
      t  = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
