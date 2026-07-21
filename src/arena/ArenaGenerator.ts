import { GRID_COLS, GRID_ROWS, ROCK_FILL_RATIO, DIRT_FILL_RATIO, TREE_COUNT, CANOPY_RADIUS, CELL_SIZE, CA_SMOOTHING_STEPS, CA_MIN_ROCK_NEIGHBORS, CA_MAX_FLOOR_NEIGHBORS, TRACK_COUNT, TRACK_SPAWN_MIN_COL, TRACK_SPAWN_MAX_COL, getCaptureTheBeerMiddleThirdRegion, isCaptureTheBeerBaseModeActive, isGridCellInArenaRegion } from '../config';
import { isReservedBaseObstacleCell, isReservedBaseSurfaceCell, resolveCoopDefenseBases, usesCenteredTrackSpawn } from './BaseRegistry';
import { ARENA_DECAL_CONFIG, clampDecalOffsetPx, clampDecalPercent, getDecalTextureKey } from './DecalConfig';
import type { ArenaLayout, DecalCell, DecalTerrainLayer, DirtCell, RockCell, TreeCell, TrackCell } from '../types';
import { POWERUP_PEDESTAL_CONFIG, TIMED_POWERUP_PEDESTAL_CONFIGS, TIMED_POWERUP_PEDESTAL_COUNT } from '../powerups/PowerUpConfig';
import type {
  CoopDefenseMapConfig,
  CoopDefenseMapCorridorPoint,
  CoopDefenseMapPowerUpConfig,
  CoopDefenseMapRockFieldConfig,
  CoopDefensePowerUpRegion,
} from '../config/coopDefenseMaps';
import {
  COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS,
  getCoopDefenseTutorialRockRegion,
} from '../config/coopDefenseTutorial';

// ── Felsfeld-Gänge ──────────────────────────────────────────────────────────
/** Abtastschritt entlang eines Gangs in Zellen; kleiner = glattere Wand, mehr Rechenaufwand. */
const CORRIDOR_SAMPLE_STEP_CELLS = 0.4;
/** Dämpfung der Random Walks: nahe 1 = weite Bögen, kleiner = nervöser Verlauf. */
const CORRIDOR_WANDER_DAMPING = 0.94;
const CORRIDOR_WANDER_STEP = 0.14;
const CORRIDOR_RADIUS_DAMPING = 0.9;
const CORRIDOR_RADIUS_STEP = 0.22;
/** Auf dieser Länge läuft der seitliche Versatz an den Gang-Enden auf 0 aus. */
const CORRIDOR_TAPER_CELLS = 3;
/** Harte Untergrenze des Aushubradius, damit nie eine unpassierbare Engstelle entsteht. */
const MIN_CARVED_RADIUS_CELLS = 1.05;

function clampToUnitRange(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

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
  static generate(seed: number, coopMapConfig?: CoopDefenseMapConfig): ArenaLayout {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rng = ArenaGenerator.makePrng(seed + attempt);
      const blocked: boolean[][] = Array.from({ length: GRID_ROWS }, () =>
        new Array(GRID_COLS).fill(false),
      );

      // --- Gleise zuerst generieren (vor Felsen) ---
      const { trackCols, tracks } = ArenaGenerator.generateTracks(rng);

      // --- Cellular Automata Felsen-Platzierung ---

      // 1. Initialer Noise
      const rockFillRatio = coopMapConfig?.rockFillRatio ?? ROCK_FILL_RATIO;
      let map: boolean[][] = Array.from({ length: GRID_ROWS }, () =>
        Array.from({ length: GRID_COLS }, () => rng() < rockFillRatio),
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

      // Ein konfiguriertes Felsfeld ersetzt die prozedurale Verteilung komplett – auch die
      // Tutorial-Formation, deren Zweck (Bereich unter dem Hinweisfenster zubauen) es ohnehin
      // bereits erfüllt.
      let tutorialRockCells: Set<string> | null = null;
      if (coopMapConfig?.rockField) {
        ArenaGenerator.applyRockField(map, coopMapConfig.rockField, rng);
      } else if (coopMapConfig?.tutorialText) {
        tutorialRockCells = ArenaGenerator.applyTutorialRockFormation(map, trackCols, rng);
      }

      // 3. map auf blocked übertragen und rocks-Array befüllen
      //    Gleis-Spalten bleiben frei (trackCols sind begehbar)
      const tutorialRockArmorDropMult = coopMapConfig?.tutorialRockArmorDropMult;
      const rocks: RockCell[] = [];
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        for (let gx = 0; gx < GRID_COLS; gx++) {
          if (map[gy][gx] && !trackCols.has(gx) && !isReservedBaseObstacleCell(gx, gy)) {
            blocked[gy][gx] = true;
            const isTutorialRock = tutorialRockCells?.has(`${gx}_${gy}`) ?? false;
            rocks.push({
              gridX: gx,
              gridY: gy,
              armorDropMult: isTutorialRock ? tutorialRockArmorDropMult : undefined,
            });
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

      // Konnektivität sicherstellen: Statt bei einer abgeschnürten Tasche den kompletten Versuch
      // zu verwerfen (was bei höherem rockFillRatio schnell alle 100 Versuche verbraucht und in
      // einer Exception endet), wird die günstigste Verbindung zwischen den Regionen nachgefräst.
      ArenaGenerator.ensureConnected(blocked, rocks);

      // Bäume auf verbleibenden freien Zellen platzieren.
      // Mindestabstand zum Arena-Rand: ceil(CANOPY_RADIUS / CELL_SIZE) Zellen,
      // damit die Baumkrone nie über die Arena-Grenze hinausragt.
      const treeMargin = Math.ceil(CANOPY_RADIUS / CELL_SIZE); // bei r=96, size=48 → 2
      const trees: TreeCell[] = [];
      // Im Felsfeld sind die einzigen freien Zellen die Gänge – ein Baum darin würde sie
      // verstopfen und die Konnektivität kippen. Deshalb wachsen dort keine Bäume.
      const shuffledForTrees = coopMapConfig?.rockField ? [] : allCells.filter(
        ({ gx, gy }) =>
          !blocked[gy][gx] &&
          !trackCols.has(gx) &&
          !isReservedBaseObstacleCell(gx, gy) &&
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
        // Ein Baum darf keine Engstelle komplett zustellen – notfalls wird nur dieser eine
        // Baum übersprungen statt den ganzen (bereits konnektiven) Versuch zu verwerfen.
        blocked[gy][gx] = true;
        if (!ArenaGenerator.isConnected(blocked)) {
          blocked[gy][gx] = false;
          continue;
        }
        trees.push({ gridX: gx, gridY: gy });
      }

      // Dirt-Zellen: Unter/um Felsen, unter/um Gleise + zusammenhängende Zufallsflecken
      const dirtSet = new Set<number>(); // gy * GRID_COLS + gx
      const addWithMargin = (gx: number, gy: number) => {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
              if (isReservedBaseSurfaceCell(nx, ny)) continue;
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
              if (isReservedBaseSurfaceCell(nx, ny)) continue;
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

      const powerUpPedestals = coopMapConfig === undefined
        ? ArenaGenerator.generateRandomPowerUpPedestals(rng, blocked, trackCols)
        : ArenaGenerator.generateCoopPowerUpPedestals(rng, blocked, trackCols, coopMapConfig);
      // Eine Coop-Map soll exakt die konfigurierten Podeste erhalten. Falls der aktuelle
      // prozedurale Versuch in einem Bereich keinen freien Platz lässt, wird die Arena
      // mit dem nächsten Seed-Versuch neu erzeugt.
      if (powerUpPedestals === null) continue;
      const decals = ArenaGenerator.generateDecals(
        ArenaGenerator.makeDecalPrng(seed + attempt),
        rocks,
        trees,
        tracks,
        dirtSet,
        powerUpPedestals,
      );

      return { seed: seed + attempt, rocks, trees, tracks, dirt, decals, powerUpPedestals };
    }

    throw new Error(
      `ArenaGenerator: Konnte nach 100 Versuchen kein konnektives Layout generieren (seed=${seed})`,
    );
  }

  static stripVisualOnlyFields(layout: ArenaLayout): ArenaLayout {
    const { decals: _decals, ...networkLayout } = layout;
    return networkLayout;
  }

  static hydrateVisualOnlyFields(layout: ArenaLayout): ArenaLayout {
    if (layout.decals !== undefined) return layout;

    const dirtSet = new Set<number>();
    for (const { gridX, gridY } of layout.dirt) {
      dirtSet.add(ArenaGenerator.cellKey(gridX, gridY));
    }

    return {
      ...layout,
      decals: ArenaGenerator.generateDecals(
        ArenaGenerator.makeDecalPrng(layout.seed),
        layout.rocks,
        layout.trees,
        layout.tracks,
        dirtSet,
        layout.powerUpPedestals,
      ),
    };
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

    if (usesCenteredTrackSpawn()) {
      // CTB & Coop-Defense: Gleise exakt in die Mitte der Arena setzen (2 Spalten zentriert)
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

  /**
   * Baut die komplette Arena mit Fels zu und fräst anschließend die konfigurierten Gänge frei.
   * Gleisspalten und die Schutzradien der Basen werden erst beim Übertragen nach `blocked`
   * ausgenommen (siehe generate()) und brauchen hier keine Sonderbehandlung.
   */
  private static applyRockField(
    map: boolean[][],
    rockField: CoopDefenseMapRockFieldConfig,
    rng: () => number,
  ): void {
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      for (let gx = 0; gx < GRID_COLS; gx++) {
        map[gy][gx] = true;
      }
    }

    for (const corridor of rockField.corridors) {
      ArenaGenerator.carveOrganicCorridor(map, corridor, rockField, rng);
    }
  }

  /**
   * Fräst einen Gang entlang seines Streckenzugs frei. Statt eines Rechtecks konstanter Breite
   * wandert die Mittellinie in weichen Bögen um den Sollverlauf und der Aushubradius schwankt –
   * so entstehen Engstellen und Ausbuchtungen wie in einem gewachsenen Höhlensystem.
   *
   * Beide Zufallsanteile sind gedämpfte Random Walks: der neue Wert hängt am alten, deshalb
   * ergeben sich Bögen statt Zickzack. Zum Anfang und Ende hin läuft der Versatz auf 0 aus, damit
   * der Gang exakt an seinem Start- und Zielpunkt ankommt (Spawnrand bzw. Basis-Schutzradius).
   */
  private static carveOrganicCorridor(
    map: boolean[][],
    corridor: CoopDefenseMapRockFieldConfig['corridors'][number],
    rockField: CoopDefenseMapRockFieldConfig,
    rng: () => number,
  ): void {
    const points = ArenaGenerator.jitterCorridorWaypoints(corridor.points, rockField.waypointJitterCells, rng);
    const baseRadius = corridor.radiusCells ?? rockField.corridorRadiusCells;
    const totalLength = ArenaGenerator.measurePathLength(points);
    if (totalLength <= 0) return;

    let wander = 0;
    let radiusOffset = 0;
    let travelled = 0;

    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1];
      const to = points[index];
      const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
      if (segmentLength <= 0) continue;

      const dirX = (to.x - from.x) / segmentLength;
      const dirY = (to.y - from.y) / segmentLength;
      const steps = Math.max(1, Math.ceil(segmentLength / CORRIDOR_SAMPLE_STEP_CELLS));

      for (let step = 0; step <= steps; step++) {
        const alongSegment = (segmentLength * step) / steps;
        wander = clampToUnitRange(wander * CORRIDOR_WANDER_DAMPING + (rng() * 2 - 1) * CORRIDOR_WANDER_STEP);
        radiusOffset = clampToUnitRange(
          radiusOffset * CORRIDOR_RADIUS_DAMPING + (rng() * 2 - 1) * CORRIDOR_RADIUS_STEP,
        );

        const distanceToEnd = totalLength - (travelled + alongSegment);
        const taper = Math.min(
          1,
          (travelled + alongSegment) / CORRIDOR_TAPER_CELLS,
          distanceToEnd / CORRIDOR_TAPER_CELLS,
        );
        const offset = wander * rockField.corridorWanderCells * Math.max(0, taper);
        const radius = Math.max(
          MIN_CARVED_RADIUS_CELLS,
          baseRadius + radiusOffset * rockField.corridorRadiusVarianceCells,
        );

        ArenaGenerator.carveDisc(
          map,
          from.x + dirX * alongSegment - dirY * offset,
          from.y + dirY * alongSegment + dirX * offset,
          radius,
        );
      }

      travelled += segmentLength;
    }
  }

  /** Verschiebt die Zwischenpunkte zufällig; Start und Ende bleiben als Andockstellen unangetastet. */
  private static jitterCorridorWaypoints(
    points: readonly CoopDefenseMapCorridorPoint[],
    jitterCells: number,
    rng: () => number,
  ): Array<{ x: number; y: number }> {
    return points.map((point, index) => {
      const isEndpoint = index === 0 || index === points.length - 1;
      if (isEndpoint || jitterCells <= 0) return { x: point.gridX, y: point.gridY };
      return {
        x: point.gridX + (rng() * 2 - 1) * jitterCells,
        y: point.gridY + (rng() * 2 - 1) * jitterCells,
      };
    });
  }

  private static measurePathLength(points: readonly { x: number; y: number }[]): number {
    let length = 0;
    for (let index = 1; index < points.length; index++) {
      length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    }
    return length;
  }

  /** Räumt alle Zellen frei, deren Mittelpunkt im Radius um (centerX, centerY) liegt. */
  private static carveDisc(map: boolean[][], centerX: number, centerY: number, radiusCells: number): void {
    const minGridX = Math.max(0, Math.ceil(centerX - radiusCells));
    const maxGridX = Math.min(GRID_COLS - 1, Math.floor(centerX + radiusCells));
    const minGridY = Math.max(0, Math.ceil(centerY - radiusCells));
    const maxGridY = Math.min(GRID_ROWS - 1, Math.floor(centerY + radiusCells));
    const radiusSq = radiusCells * radiusCells;

    for (let gy = minGridY; gy <= maxGridY; gy++) {
      for (let gx = minGridX; gx <= maxGridX; gx++) {
        const dx = gx - centerX;
        const dy = gy - centerY;
        if (dx * dx + dy * dy <= radiusSq) map[gy][gx] = false;
      }
    }
  }

  private static applyTutorialRockFormation(
    map: boolean[][],
    trackCols: ReadonlySet<number>,
    rng: () => number,
  ): Set<string> {
    const tutorialRockCells = new Set<string>();
    const panelRegion = getCoopDefenseTutorialRockRegion();
    // Bis zum oberen Arenarand auffüllen, damit oberhalb des HUD-Blocks keine
    // kleinen, vom restlichen Spielfeld abgeschnittenen Bodentaschen entstehen.
    const region = { ...panelRegion, minGridY: 0 };
    const halo = COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS;
    for (let gy = Math.max(0, region.minGridY - halo); gy <= Math.min(GRID_ROWS - 1, region.maxGridY + halo); gy++) {
      for (let gx = Math.max(0, region.minGridX - halo); gx <= Math.min(GRID_COLS - 1, region.maxGridX + halo); gx++) {
        if (trackCols.has(gx) || isReservedBaseObstacleCell(gx, gy)) continue;
        const dx = gx < region.minGridX ? region.minGridX - gx : gx > region.maxGridX ? gx - region.maxGridX : 0;
        const dy = gy < region.minGridY ? region.minGridY - gy : gy > region.maxGridY ? gy - region.maxGridY : 0;
        const distance = Math.max(dx, dy);
        if (distance === 0 || rng() < (distance === 1 ? 0.72 : 0.36)) {
          map[gy][gx] = true;
          tutorialRockCells.add(`${gx}_${gy}`);
        }
      }
    }
    return tutorialRockCells;
  }

  private static generateRandomPowerUpPedestals(
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
        if (isReservedBaseObstacleCell(gx, gy)) continue;
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

  private static generateConfiguredPowerUpPedestals(
    rng: () => number,
    blocked: boolean[][],
    trackCols: Set<number>,
    configs: readonly CoopDefenseMapPowerUpConfig[],
  ): ArenaLayout['powerUpPedestals'] | null {
    const margin = POWERUP_PEDESTAL_CONFIG.edgePaddingCells;
    const candidatesByRegion = new Map<CoopDefensePowerUpRegion, Array<{ gx: number; gy: number }>>([
      ['front', []],
      ['middle', []],
      ['rear', []],
    ]);

    for (let gy = margin; gy < GRID_ROWS - margin; gy++) {
      for (let gx = margin; gx < GRID_COLS - margin; gx++) {
        if (blocked[gy][gx]) continue;
        if (trackCols.has(gx)) continue;
        if (isReservedBaseObstacleCell(gx, gy)) continue;
        candidatesByRegion.get(ArenaGenerator.getPowerUpRegion(gx))!.push({ gx, gy });
      }
    }

    const selected: Array<{ gx: number; gy: number }> = [];
    const pedestals: ArenaLayout['powerUpPedestals'] = [];
    for (let index = 0; index < configs.length; index++) {
      const config = configs[index];
      const candidates = candidatesByRegion.get(config.region) ?? [];
      const available = candidates.filter(
        (candidate) => !selected.some((cell) => cell.gx === candidate.gx && cell.gy === candidate.gy),
      );
      const cell = ArenaGenerator.pickConfiguredPedestalCell(rng, available, selected);
      if (!cell) return null;

      selected.push(cell);
      pedestals.push({
        id: index + 1,
        defId: config.defId,
        gridX: cell.gx,
        gridY: cell.gy,
        respawnMs: config.respawnMs,
        spawnOnArenaStart: config.spawnOnArenaStart ?? false,
      });
    }

    return pedestals;
  }

  private static generateCoopPowerUpPedestals(
    rng: () => number,
    blocked: boolean[][],
    trackCols: Set<number>,
    mapConfig: CoopDefenseMapConfig,
  ): ArenaLayout['powerUpPedestals'] | null {
    const pedestals = ArenaGenerator.generateConfiguredPowerUpPedestals(
      rng,
      blocked,
      trackCols,
      mapConfig.powerUps,
    );
    if (pedestals === null) return null;

    const occupied = new Set(pedestals.map((pedestal) => ArenaGenerator.cellKey(pedestal.gridX, pedestal.gridY)));
    for (const base of resolveCoopDefenseBases(mapConfig)) {
      for (const config of base.powerUpPedestals) {
        const key = ArenaGenerator.cellKey(config.gridX, config.gridY);
        if (trackCols.has(config.gridX)) {
          throw new Error(`[ArenaGenerator] Linked pedestal ${config.id} overlaps the railway`);
        }
        if (occupied.has(key)) {
          throw new Error(`[ArenaGenerator] Multiple power-up pedestals occupy cell ${config.gridX},${config.gridY}`);
        }
        // Ein weit außerhalb der Basis konfiguriertes Podest kann auf prozeduralen Bewuchs
        // treffen. In diesem Fall wird der nächste Arena-Versuch verwendet.
        if (blocked[config.gridY][config.gridX]) return null;

        occupied.add(key);
        pedestals.push({
          id: pedestals.length + 1,
          defId: config.defId,
          gridX: config.gridX,
          gridY: config.gridY,
          respawnMs: config.respawnMs,
          spawnOnArenaStart: config.spawnOnArenaStart,
          linkedBaseId: config.baseId,
        });
      }
    }
    return pedestals;
  }

  /** Linkes, mittleres bzw. rechtes Drittel der Coop-Arena. */
  private static getPowerUpRegion(gx: number): CoopDefensePowerUpRegion {
    const third = GRID_COLS / 3;
    if (gx < third) return 'front';
    if (gx < third * 2) return 'middle';
    return 'rear';
  }

  private static pickConfiguredPedestalCell(
    rng: () => number,
    candidates: readonly { gx: number; gy: number }[],
    selected: readonly { gx: number; gy: number }[],
  ): { gx: number; gy: number } | null {
    if (candidates.length === 0) return null;
    if (selected.length === 0) return candidates[Math.floor(rng() * candidates.length)];

    let best: { gx: number; gy: number } | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      let minDistanceSq = Number.POSITIVE_INFINITY;
      for (const existing of selected) {
        const dx = candidate.gx - existing.gx;
        const dy = candidate.gy - existing.gy;
        minDistanceSq = Math.min(minDistanceSq, dx * dx + dy * dy);
      }
      // Weit auseinander, aber mit kleinem Seed-Jitter für abwechslungsreiche Layouts.
      const score = minDistanceSq + ArenaGenerator.distanceToArenaEdge(candidate.gx, candidate.gy) * 0.12 + rng() * 0.025;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
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
        if (blockedCells.has(key) || isReservedBaseSurfaceCell(gx, gy)) continue;

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
   * Garantiert Konnektivität durch minimales Nachfräsen statt komplettem Neuversuch: verschmilzt
   * iterativ die größte freie Region mit der jeweils nächstgrößten, indem der Pfad mit den
   * wenigsten neu zu fräsenden Fels-Zellen gesucht wird (siehe `findCheapestPath`). Bei höheren
   * `rockFillRatio`-Werten kann die CA-Verteilung vereinzelt Taschen abschnüren – ohne dieses
   * Nachfräsen würde `generate()` dafür alle 100 Versuche verbrauchen und mit einer Exception
   * abbrechen.
   */
  private static ensureConnected(blocked: boolean[][], rocks: RockCell[]): void {
    const rockIndexByKey = new Map<number, number>();
    rocks.forEach((rock, index) => rockIndexByKey.set(ArenaGenerator.cellKey(rock.gridX, rock.gridY), index));

    // Obergrenze schützt vor einer Endlosschleife; jede Iteration verschmilzt mindestens zwei
    // Regionen zu einer, mehr als GRID_ROWS * GRID_COLS Regionen kann es nie geben.
    for (let guard = 0; guard < GRID_ROWS * GRID_COLS; guard++) {
      const components = ArenaGenerator.findFreeComponents(blocked);
      if (components.length <= 1) return;

      components.sort((a, b) => b.length - a.length);
      const main = components[0];
      const other = components[1];
      const path = ArenaGenerator.findCheapestPath(blocked, other, main);

      for (const [gx, gy] of path) {
        if (!blocked[gy][gx]) continue;
        blocked[gy][gx] = false;

        const key = ArenaGenerator.cellKey(gx, gy);
        const index = rockIndexByKey.get(key);
        if (index === undefined) continue;
        const lastIndex = rocks.length - 1;
        const lastRock = rocks[lastIndex];
        rocks[index] = lastRock;
        rockIndexByKey.set(ArenaGenerator.cellKey(lastRock.gridX, lastRock.gridY), index);
        rocks.pop();
        rockIndexByKey.delete(key);
      }
    }
  }

  /** Alle zusammenhängenden Regionen freier (nicht blockierter) Zellen (4-connected). */
  private static findFreeComponents(blocked: boolean[][]): Array<Array<[number, number]>> {
    const visited = Array.from({ length: GRID_ROWS }, () => new Array(GRID_COLS).fill(false));
    const components: Array<Array<[number, number]>> = [];
    const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let gy = 0; gy < GRID_ROWS; gy++) {
      for (let gx = 0; gx < GRID_COLS; gx++) {
        if (blocked[gy][gx] || visited[gy][gx]) continue;

        const component: Array<[number, number]> = [];
        const queue: Array<[number, number]> = [[gx, gy]];
        visited[gy][gx] = true;
        while (queue.length > 0) {
          const [cx, cy] = queue.shift()!;
          component.push([cx, cy]);
          for (const [dx, dy] of DIRS) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
            if (visited[ny][nx] || blocked[ny][nx]) continue;
            visited[ny][nx] = true;
            queue.push([nx, ny]);
          }
        }
        components.push(component);
      }
    }
    return components;
  }

  /**
   * 0/1-BFS von `sourceCells` zu einer beliebigen Zelle aus `targetCells`: Bewegung über bereits
   * freie Zellen kostet 0, das Durchbrechen einer Fels-Zelle kostet 1. Liefert damit den Pfad, der
   * am wenigsten zusätzlichen Fels wegfräst – meist eine einzelne, natürlich wirkende Engstelle
   * statt eines langen geraden Tunnels.
   */
  private static findCheapestPath(
    blocked: boolean[][],
    sourceCells: ReadonlyArray<[number, number]>,
    targetCells: ReadonlyArray<[number, number]>,
  ): Array<[number, number]> {
    const targetSet = new Set(targetCells.map(([gx, gy]) => ArenaGenerator.cellKey(gx, gy)));
    const dist: number[][] = Array.from({ length: GRID_ROWS }, () => new Array(GRID_COLS).fill(Infinity));
    const prevX: number[][] = Array.from({ length: GRID_ROWS }, () => new Array(GRID_COLS).fill(-1));
    const prevY: number[][] = Array.from({ length: GRID_ROWS }, () => new Array(GRID_COLS).fill(-1));
    const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const deque: Array<[number, number, number]> = [];

    for (const [gx, gy] of sourceCells) {
      if (dist[gy][gx] > 0) {
        dist[gy][gx] = 0;
        deque.push([gx, gy, 0]);
      }
    }

    let targetX = -1;
    let targetY = -1;
    while (deque.length > 0) {
      const [cx, cy, d] = deque.shift()!;
      if (d > dist[cy][cx]) continue; // veralteter Queue-Eintrag, bereits verbessert
      if (targetSet.has(ArenaGenerator.cellKey(cx, cy))) {
        targetX = cx;
        targetY = cy;
        break;
      }
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
        const weight = blocked[ny][nx] ? 1 : 0;
        const nextDist = d + weight;
        if (nextDist < dist[ny][nx]) {
          dist[ny][nx] = nextDist;
          prevX[ny][nx] = cx;
          prevY[ny][nx] = cy;
          if (weight === 0) deque.unshift([nx, ny, nextDist]);
          else deque.push([nx, ny, nextDist]);
        }
      }
    }

    if (targetX === -1) return [];

    const path: Array<[number, number]> = [];
    let cx = targetX;
    let cy = targetY;
    while (cx !== -1 && cy !== -1) {
      path.push([cx, cy]);
      const px = prevX[cy][cx];
      const py = prevY[cy][cx];
      cx = px;
      cy = py;
    }
    return path;
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

  private static makeDecalPrng(seed: number): () => number {
    return ArenaGenerator.makePrng((seed ^ 0x9e3779b9) >>> 0);
  }
}
