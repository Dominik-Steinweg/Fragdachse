import { GRID_COLS, GRID_ROWS, ROCK_FILL_RATIO, DIRT_FILL_RATIO, TREE_COUNT, CANOPY_RADIUS, CELL_SIZE, CA_SMOOTHING_STEPS, CA_MIN_ROCK_NEIGHBORS, CA_MAX_FLOOR_NEIGHBORS, TRACK_COUNT, TRACK_SPAWN_MIN_COL, TRACK_SPAWN_MAX_COL, getCaptureTheBeerMiddleThirdRegion, isCaptureTheBeerBaseCell, isCaptureTheBeerBaseModeActive, isGridCellInArenaRegion } from '../config';
import { ARENA_DECAL_CONFIG, clampDecalOffsetPx, clampDecalPercent, getDecalTextureKey } from './DecalConfig';
import type { ArenaLayout, DecalCell, DecalTerrainLayer, DirtCell, RockCell, TreeCell, TrackCell } from '../types';
import { POWERUP_PEDESTAL_CONFIG, TIMED_POWERUP_PEDESTAL_CONFIGS, TIMED_POWERUP_PEDESTAL_COUNT } from '../powerups/PowerUpConfig';

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

      // --- Gleise zuerst generieren (vor Felsen) ---
      const { trackCols, tracks } = ArenaGenerator.generateTracks(rng);

      // --- Cellular Automata Felsen-Platzierung ---

      // 1. Initialer Noise
      let map: boolean[][] = Array.from({ length: GRID_ROWS }, () =>
        Array.from({ length: GRID_COLS }, () => rng() < ROCK_FILL_RATIO),
      );

      // 2. Smoothing-Steps
      for (let step = 0; step < CA_SMOOTHING_STEPS; step++) {
        const newMap: boolean[][] = Array.from({ length: GRID_ROWS }, () =>
          new Array(GRID_COLS).fill(false),
        );
        for (let gy = 0; gy < GRID_ROWS; gy++) {
          for (let gx = 0; gx < GRID_COLS; gx++) {
            // Zähle Fels-Nachbarn in 8 umliegenden Zellen (Rand = Fels)
            let rockNeighbors = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = gx + dx;
                const ny = gy + dy;
                if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) {
                  rockNeighbors++; // Rand gilt als Fels
                } else if (map[ny][nx]) {
                  rockNeighbors++;
                }
              }
            }
            if (map[gy][gx]) {
              // Fels: wird zu Boden wenn zu wenig Nachbarn
              newMap[gy][gx] = rockNeighbors >= CA_MIN_ROCK_NEIGHBORS;
            } else {
              // Boden: wird zu Fels wenn zu viele Nachbarn
              newMap[gy][gx] = rockNeighbors > CA_MAX_FLOOR_NEIGHBORS;
            }
          }
        }
        map = newMap;
      }

      // 3. map auf blocked übertragen und rocks-Array befüllen
      //    Gleis-Spalten bleiben frei (trackCols sind begehbar)
      const rocks: RockCell[] = [];
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        for (let gx = 0; gx < GRID_COLS; gx++) {
          if (map[gy][gx] && !trackCols.has(gx) && !isCaptureTheBeerBaseCell(gx, gy)) {
            blocked[gy][gx] = true;
            rocks.push({ gridX: gx, gridY: gy });
          }
        }
      }

      // allCells für Baum-Platzierung aufbauen
      const allCells: Array<{ gx: number; gy: number }> = [];
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        for (let gx = 0; gx < GRID_COLS; gx++) {
          allCells.push({ gx, gy });
        }
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
          !trackCols.has(gx) &&
          !isCaptureTheBeerBaseCell(gx, gy) &&
          gx >= treeMargin && gx < GRID_COLS - treeMargin &&
          gy >= treeMargin && gy < GRID_ROWS - treeMargin,
      );
      // Nochmals shuffeln für unabhängige Baumpositionierung
      ArenaGenerator.shuffle(shuffledForTrees, rng);

      // Mindestabstand zwischen Bäumen: 4 Felder in alle Richtungen (Chebyshev-Distanz ≥ 4).
      // Entspricht 4 × 32 px = 128 px – verhindert das Überdecken von Stämmen und Kronen.
      const TREE_MIN_SPACING = 4;
      for (const { gx, gy } of shuffledForTrees) {
        if (trees.length >= TREE_COUNT) break;
        // Prüfe Chebyshev-Abstand zu allen bereits platzierten Bäumen
        const tooClose = trees.some(
          t => Math.max(Math.abs(gx - t.gridX), Math.abs(gy - t.gridY)) < TREE_MIN_SPACING,
        );
        if (tooClose) continue;
        blocked[gy][gx] = true;
        trees.push({ gridX: gx, gridY: gy });
      }

      // Nochmalige Konnektivitätsprüfung nach Baumplatzierung
      if (!ArenaGenerator.isConnected(blocked)) continue;

      // Dirt-Zellen: Unter/um Felsen, unter/um Gleise + zusammenhängende Zufallsflecken
      const dirtSet = new Set<number>(); // gy * GRID_COLS + gx
      const addWithMargin = (gx: number, gy: number) => {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
              if (isCaptureTheBeerBaseCell(nx, ny)) continue;
              dirtSet.add(ny * GRID_COLS + nx);
            }
          }
        }
      };
      // 1. Felsen-Positionen + 1-Zellen-Rand drumherum
      for (const { gridX, gridY } of rocks) addWithMargin(gridX, gridY);
      // 2. Gleis-Positionen + 1-Zellen-Rand drumherum (beide Gleisspalten: col und col+1)
      for (const { gridX, gridY } of tracks) {
        addWithMargin(gridX, gridY);
        addWithMargin(gridX + 1, gridY);
      }
      // 3. Zufällige Flecken – nur an Nachbarzellen von bestehendem Dirt (zusammenhängend)
      //    Mehrere Passes, damit das Netz organisch wächst.
      const passes = 3;
      for (let p = 0; p < passes; p++) {
        const frontier: number[] = [];
        for (const key of dirtSet) {
          const gx = key % GRID_COLS;
          const gy = Math.floor(key / GRID_COLS);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = gx + dx;
              const ny = gy + dy;
              if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
              if (isCaptureTheBeerBaseCell(nx, ny)) continue;
              const nk = ny * GRID_COLS + nx;
              if (!dirtSet.has(nk)) frontier.push(nk);
            }
          }
        }
        for (const nk of frontier) {
          if (rng() < DIRT_FILL_RATIO) dirtSet.add(nk);
        }
      }
      const dirt: DirtCell[] = [];
      for (const key of dirtSet) {
        dirt.push({ gridX: key % GRID_COLS, gridY: Math.floor(key / GRID_COLS) });
      }

      const powerUpPedestals = ArenaGenerator.generatePowerUpPedestals(rng, blocked, trackCols);
      const decals = ArenaGenerator.generateDecals(rng, rocks, trees, tracks, dirtSet, powerUpPedestals);

      return { seed: seed + attempt, rocks, trees, tracks, dirt, decals, powerUpPedestals };
    }

    throw new Error(
      `ArenaGenerator: Konnte nach 100 Versuchen kein konnektives Layout generieren (seed=${seed})`,
    );
  }

  /**
   * Generiert TRACK_COUNT zufällige vertikale Gleis-Spalten in der mittleren
   * Hälfte der Arena (TRACK_SPAWN_MIN_COL … TRACK_SPAWN_MAX_COL).
   * Gibt die Set der gewählten Spalten zurück (für Felsen/Baum-Filter)
   * sowie alle TrackCells (jede Zelle einer Gleis-Spalte).
   */
  private static generateTracks(rng: () => number): { trackCols: Set<number>; tracks: TrackCell[] } {
    const trackCols = new Set<number>();
    const tracks: TrackCell[] = [];

    if (isCaptureTheBeerBaseModeActive()) {
      // CTB: Gleise exakt in die Mitte der Arena setzen (2 Spalten zentriert)
      const col = Math.floor((GRID_COLS - 2) / 2);
      trackCols.add(col);
      trackCols.add(col + 1);
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        tracks.push({ gridX: col, gridY: gy });
      }
      return { trackCols, tracks };
    }

    const available: number[] = [];
    for (let c = TRACK_SPAWN_MIN_COL; c <= TRACK_SPAWN_MAX_COL; c++) {
      available.push(c);
    }
    ArenaGenerator.shuffle(available, rng);

    for (let i = 0; i < Math.min(TRACK_COUNT, available.length); i++) {
      const col = available[i];
      trackCols.add(col);
      trackCols.add(col + 1);
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        tracks.push({ gridX: col, gridY: gy });
      }
    }
    return { trackCols, tracks };
  }

  private static generatePowerUpPedestals(
    rng: () => number,
    blocked: boolean[][],
    trackCols: Set<number>,
  ) {
    const candidates: Array<{ gx: number; gy: number }> = [];
    const margin = POWERUP_PEDESTAL_CONFIG.edgePaddingCells;
    const middleThirdRegion = isCaptureTheBeerBaseModeActive() ? getCaptureTheBeerMiddleThirdRegion() : null;

    for (let gy = margin; gy < GRID_ROWS - margin; gy++) {
      for (let gx = margin; gx < GRID_COLS - margin; gx++) {
        if (blocked[gy][gx]) continue;
        if (trackCols.has(gx)) continue;
        if (isCaptureTheBeerBaseCell(gx, gy)) continue;
        if (middleThirdRegion && !isGridCellInArenaRegion(middleThirdRegion, gx, gy)) continue;
        candidates.push({ gx, gy });
      }
    }

    const pedestals: ArenaLayout['powerUpPedestals'] = [];
    const selectedCells = ArenaGenerator.pickDistributedPedestalCells(rng, candidates, TIMED_POWERUP_PEDESTAL_COUNT);
    for (let i = 0; i < selectedCells.length; i++) {
      const cell = selectedCells[i];
      const defId = ArenaGenerator.pickWeightedPedestalDef(rng);
      if (!defId) break;
      pedestals.push({ id: i + 1, defId, gridX: cell.gx, gridY: cell.gy });
    }

    return pedestals;
  }

  private static generateDecals(
    rng: () => number,
    rocks: readonly RockCell[],
    trees: readonly TreeCell[],
    tracks: readonly TrackCell[],
    dirtSet: ReadonlySet<number>,
    powerUpPedestals: ArenaLayout['powerUpPedestals'],
  ): DecalCell[] {
    const blockedCells = new Set<number>();
    for (const { gridX, gridY } of rocks) {
      blockedCells.add(ArenaGenerator.cellKey(gridX, gridY));
    }
    for (const { gridX, gridY } of trees) {
      blockedCells.add(ArenaGenerator.cellKey(gridX, gridY));
    }
    for (const { gridX, gridY } of tracks) {
      blockedCells.add(ArenaGenerator.cellKey(gridX, gridY));
      if (gridX + 1 < GRID_COLS) {
        blockedCells.add(ArenaGenerator.cellKey(gridX + 1, gridY));
      }
    }
    for (const { gridX, gridY } of powerUpPedestals) {
      blockedCells.add(ArenaGenerator.cellKey(gridX, gridY));
    }

    const decals: DecalCell[] = [];
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      for (let gx = 0; gx < GRID_COLS; gx++) {
        const key = ArenaGenerator.cellKey(gx, gy);
        if (blockedCells.has(key) || isCaptureTheBeerBaseCell(gx, gy)) continue;

        const terrain: DecalTerrainLayer = dirtSet.has(key) ? 'dirt' : 'grass';
        const layerConfig = ARENA_DECAL_CONFIG[terrain];
        if (!ArenaGenerator.rollPercent(rng, layerConfig.coveragePercent)) continue;

        const textureKey = ArenaGenerator.pickWeightedDecalKey(rng, layerConfig.variants);
        if (!textureKey) continue;

        const maxOffsetX = clampDecalOffsetPx(layerConfig.maxOffsetX);
        const maxOffsetY = clampDecalOffsetPx(layerConfig.maxOffsetY);
        decals.push({
          gridX: gx,
          gridY: gy,
          textureKey,
          offsetX: ArenaGenerator.randomOffset(rng, maxOffsetX),
          offsetY: ArenaGenerator.randomOffset(rng, maxOffsetY),
          terrain,
        });
      }
    }

    return decals;
  }

  private static pickDistributedPedestalCells(
    rng: () => number,
    candidates: Array<{ gx: number; gy: number }>,
    requestedCount: number,
  ): Array<{ gx: number; gy: number }> {
    if (candidates.length === 0 || requestedCount <= 0) return [];

    const pool = [...candidates];
    ArenaGenerator.shuffle(pool, rng);

    const selected: Array<{ gx: number; gy: number }> = [pool.shift()!];
    const targetCount = Math.min(requestedCount, candidates.length);
    const minSpacingSq = POWERUP_PEDESTAL_CONFIG.minSpacingCells * POWERUP_PEDESTAL_CONFIG.minSpacingCells;

    while (selected.length < targetCount && pool.length > 0) {
      let bestIndex = 0;
      let bestScore = -1;
      let bestMinDistSq = -1;

      for (let index = 0; index < pool.length; index++) {
        const candidate = pool[index];
        let minDistSq = Number.POSITIVE_INFINITY;
        for (const chosen of selected) {
          const dx = candidate.gx - chosen.gx;
          const dy = candidate.gy - chosen.gy;
          const distSq = dx * dx + dy * dy;
          if (distSq < minDistSq) minDistSq = distSq;
        }

        const spacingBonus = Math.min(minDistSq, minSpacingSq) / minSpacingSq;
        const edgeBias = ArenaGenerator.distanceToArenaEdge(candidate.gx, candidate.gy) * 0.12;
        const jitter = rng() * 0.025;
        const score = minDistSq + spacingBonus + edgeBias + jitter;
        if (score > bestScore) {
          bestScore = score;
          bestMinDistSq = minDistSq;
          bestIndex = index;
        }
      }

      const chosen = pool.splice(bestIndex, 1)[0];
      selected.push(chosen);

      if (bestMinDistSq >= minSpacingSq) {
        for (let index = pool.length - 1; index >= 0; index--) {
          const candidate = pool[index];
          let tooClose = false;
          for (const existing of selected) {
            const dx = candidate.gx - existing.gx;
            const dy = candidate.gy - existing.gy;
            if (dx * dx + dy * dy < minSpacingSq) {
              tooClose = true;
              break;
            }
          }
          if (tooClose && pool.length > (targetCount - selected.length)) {
            pool.splice(index, 1);
          }
        }
      }
    }

    return selected;
  }

  private static distanceToArenaEdge(gx: number, gy: number): number {
    const distLeft = gx;
    const distRight = GRID_COLS - 1 - gx;
    const distTop = gy;
    const distBottom = GRID_ROWS - 1 - gy;
    return Math.min(distLeft, distRight, distTop, distBottom);
  }

  private static pickWeightedPedestalDef(rng: () => number): string | null {
    const entries = Object.values(TIMED_POWERUP_PEDESTAL_CONFIGS).filter(cfg => cfg.weight > 0);
    if (entries.length === 0) return null;

    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = rng() * total;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll <= 0) return entry.defId;
    }

    return entries[entries.length - 1].defId;
  }

  private static pickWeightedDecalKey(
    rng: () => number,
    entries: ReadonlyArray<{ fileName: string; frequencyPercent: number }>,
  ): DecalCell['textureKey'] | null {
    const weightedEntries = entries.filter((entry) => clampDecalPercent(entry.frequencyPercent) > 0);
    if (weightedEntries.length === 0) return null;

    const total = weightedEntries.reduce(
      (sum, entry) => sum + clampDecalPercent(entry.frequencyPercent),
      0,
    );
    let roll = rng() * total;
    for (const entry of weightedEntries) {
      roll -= clampDecalPercent(entry.frequencyPercent);
      if (roll <= 0) return getDecalTextureKey(entry.fileName);
    }

    return getDecalTextureKey(weightedEntries[weightedEntries.length - 1].fileName);
  }

  private static rollPercent(rng: () => number, percent: number): boolean {
    return rng() * 100 < clampDecalPercent(percent);
  }

  private static randomOffset(rng: () => number, maxOffset: number): number {
    if (maxOffset <= 0) return 0;
    return Math.floor(rng() * (maxOffset * 2 + 1)) - maxOffset;
  }

  private static cellKey(gx: number, gy: number): number {
    return gy * GRID_COLS + gx;
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
