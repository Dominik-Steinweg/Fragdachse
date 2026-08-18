import { COOP_DEFENSE_MAX_REQUIRED_TRACK_RUN_CELLS, COOP_DEFENSE_TRACK_CROSSING_CLEARANCE_SIDE_CELLS, COOP_DEFENSE_TRACK_CROSSING_INTERVAL_CELLS, COOP_DEFENSE_TRACK_CROSSING_WIDTH_CELLS, GRID_COLS, GRID_ROWS, ROCK_FILL_RATIO, DIRT_FILL_RATIO, TREE_COUNT, CANOPY_RADIUS, CELL_SIZE, CA_SMOOTHING_STEPS, CA_MIN_ROCK_NEIGHBORS, CA_MAX_FLOOR_NEIGHBORS, TRACK_SPAWN_MIN_COL, TRACK_SPAWN_MAX_COL, getCaptureTheBeerMiddleThirdRegion, isCaptureTheBeerBaseModeActive, isGridCellInArenaRegion } from '../config';
import { COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS, COOP_DEFENSE_BASE_TRACK_CLEARANCE_CELLS, isReservedBaseObstacleCell, isReservedBaseSurfaceCell, resolveCoopDefenseBases, usesCenteredTrackSpawn } from './BaseRegistry';
import type { BaseSpec } from './BaseRegistry';
import { ARENA_DECAL_CONFIG, DIRT_ROCK_UNDERLAY_DECAL_CONFIG, ROCK_DECAL_CONFIG, ROCK_DECAL_SIZE, clampDecalOffsetPx, clampDecalPercent, getDecalTextureKey, getRockDecalMaxOffsetPx, getRockDecalVariant, getRockDecalVariantsForPlacement } from './DecalConfig';
import type { DecalPlacement } from './DecalConfig';
import { generateSolidRockFormation } from './SolidRockFormation';
import type { ArenaGroundHazardZone, ArenaLayout, DecalCell, DecalTerrainLayer, DirtCell, RockCell, SpawnFront, TreeCell, TrackCell } from '../types';
import { POWERUP_PEDESTAL_CONFIG, TIMED_POWERUP_PEDESTAL_CONFIGS, TIMED_POWERUP_PEDESTAL_COUNT } from '../powerups/PowerUpConfig';
import type {
  CoopDefenseMapConfig,
  CoopDefenseMapCorridorPoint,
  CoopDefenseMapGroundHazardEventConfig,
  CoopDefenseMapPowerUpConfig,
  CoopDefenseMapRockFieldConfig,
  CoopDefensePowerUpRegion,
  CoopDefenseMapTrackPosition,
} from '../config/coopDefenseMaps';
import {
  COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS,
  getCoopDefenseTutorialRockRegion,
} from '../config/coopDefenseTutorial';
import { getMapTutorial } from '../i18n/contentPresentation';
import { createOrganicDirtMargin } from './OrganicDirtMargin';
import { DEFAULT_SPAWN_FRONT } from '../utils/spawnFront';

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

// Die gemeinsame Dirt-Randregel liegt in OrganicDirtMargin und wird auch von der Lobby-Vorschau
// verwendet; die Arena behält hier nur ihre eigene Reserveflaechen- und Wachstumslogik.
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
    // Die Basisgeometrie hängt nur von Map-Konfiguration und aktuellen Arena-Metriken ab,
    // nicht vom Retry-Seed. Bei expliziten Coop-Maps wird sie deshalb einmal pro Generate-Aufruf
    // aufgelöst und an alle Zellprüfungen weitergereicht. Ohne Map-Konfiguration bleibt
    // `undefined` bewusst der Fallback auf die aktive Registry-Auflösung.
    const coopBaseSpecs = coopMapConfig ? resolveCoopDefenseBases(coopMapConfig) : undefined;

    for (let attempt = 0; attempt < 100; attempt++) {
      const rng = ArenaGenerator.makePrng(seed + attempt);
      const blocked: boolean[][] = Array.from({ length: GRID_ROWS }, () =>
        new Array(GRID_COLS).fill(false),
      );

      // --- Gleise zuerst generieren (vor Felsen) ---
      const generatedTrackLayout = ArenaGenerator.generateTracks(
        rng,
        // Void-fire keeps its authored centered hazard corridor even though no train track is
        // rendered. All other Coop maps keep a free cell between the railway and every base.
        coopMapConfig?.trackMode === 'void-fire' || coopMapConfig === undefined
          ? []
          : coopBaseSpecs ?? [],
        coopMapConfig?.trackPosition,
      );
      const trackCols = generatedTrackLayout.trackCols;
      const tracks = coopMapConfig?.trackMode === 'void-fire' ? [] : generatedTrackLayout.tracks;

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
      }
      if (coopMapConfig && getMapTutorial(coopMapConfig.mapId, 'de')) {
        tutorialRockCells = ArenaGenerator.applyTutorialRockFormation(
          map,
          trackCols,
          rng,
          coopMapConfig.tutorialShowControls === true,
          coopBaseSpecs,
        );
      }

      // 3. map auf blocked übertragen und rocks-Array befüllen
      //    Gleis-Spalten bleiben frei (trackCols sind begehbar)
      const tutorialRockArmorDropMult = coopMapConfig?.tutorialRockArmorDropMult;
      const rocks: RockCell[] = [];
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        for (let gx = 0; gx < GRID_COLS; gx++) {
          if (
            map[gy][gx]
            && !trackCols.has(gx)
            && !isReservedBaseObstacleCell(gx, gy, coopBaseSpecs)
          ) {
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
          !isReservedBaseObstacleCell(gx, gy, coopBaseSpecs) &&
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

      // Regelmaessige, zweizellige Querungsstreifen halten Felsen nicht nur punktuell von den
      // Gleisen fern: Links und rechts bleibt genug Raum, um die Gleise zu verlassen oder zu
      // queren. Das Entfernen ist gezielt und betrifft nur die ohnehin reservierte Gleisnaehe.
      if (tracks.length > 0) {
        ArenaGenerator.ensureTrackCrossingOptions(
          blocked,
          rocks,
          trees,
          trackCols,
          coopBaseSpecs ?? [],
          tutorialRockCells,
          coopBaseSpecs,
        );
      }
      if (
        coopMapConfig
        && tracks.length > 0
        && !ArenaGenerator.hasAcceptableSpawnToBaseRoutes(
          blocked,
          tracks,
          coopMapConfig,
          coopBaseSpecs ?? [],
        )
      ) {
        // Ein selten unguenstiges Fels-/Baum-Layout wird vollstaendig verworfen. So gelangen
        // keine authored Spawn-Ziele in eine lange notwendige Gleisfahrt.
        continue;
      }

      // Dirt-Zellen: Unter/um Felsen, unter/um Gleise + zusammenhängende Zufallsflecken
      const dirtSet = new Set<number>(); // gy * GRID_COLS + gx
      const marginSources: Array<{ gridX: number; gridY: number }> = [...rocks];
      // Felsen- und Gleis-Positionen + 1-Zellen-Rand drumherum. Gleise belegen zwei Spalten.
      for (const { gridX, gridY } of tracks) {
        marginSources.push({ gridX, gridY }, { gridX: gridX + 1, gridY });
      }
      for (const cell of createOrganicDirtMargin(marginSources, {
        maxCols: GRID_COLS,
        maxRows: GRID_ROWS,
        rng,
        isReservedCell: (gridX, gridY) => isReservedBaseSurfaceCell(gridX, gridY, coopBaseSpecs),
      })) {
        dirtSet.add(cell.gridY * GRID_COLS + cell.gridX);
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
              if (isReservedBaseSurfaceCell(nx, ny, coopBaseSpecs)) continue;
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
        ? ArenaGenerator.generateRandomPowerUpPedestals(rng, blocked, trackCols, coopBaseSpecs)
        : ArenaGenerator.generateCoopPowerUpPedestals(
          rng,
          blocked,
          trackCols,
          coopMapConfig,
          coopBaseSpecs ?? [],
        );
      // Eine Coop-Map soll exakt die konfigurierten Podeste erhalten. Falls der aktuelle
      // prozedurale Versuch in einem Bereich keinen freien Platz lässt, wird die Arena
      // mit dem nächsten Seed-Versuch neu erzeugt.
      if (powerUpPedestals === null) continue;
      const groundHazardZones = ArenaGenerator.generateGroundHazardZones(
        rng,
        blocked,
        trees,
        trackCols,
        tracks,
        powerUpPedestals,
        coopMapConfig,
        coopBaseSpecs ?? [],
      );
      // Nur die prozeduralen Patch-Flaechen rechtfertigen einen neuen Seed-Versuch: Sie haengen
      // an derselben Zufallsgeometrie wie Felsen und Podeste. Authored Rechtecke und Zellenlisten
      // fallen dagegen ohne Layout-Retry aus (siehe generateGroundHazardZones) -- ein
      // ungluecklich gesetztes Rechteck darf die Runde nicht am Start hindern.
      if (groundHazardZones === null) continue;
      const decals = ArenaGenerator.generateDecals(
        ArenaGenerator.makeDecalPrng(seed + attempt),
        rocks,
        trees,
        tracks,
        dirtSet,
        powerUpPedestals,
        groundHazardZones,
        coopBaseSpecs,
      );

      return {
        seed: seed + attempt,
        rocks,
        trees,
        tracks,
        dirt,
        decals,
        powerUpPedestals,
        groundHazardZones,
      };
    }

    throw new Error(
      `ArenaGenerator: Konnte nach 100 Versuchen kein konnektives Layout generieren (seed=${seed})`,
    );
  }

  static stripVisualOnlyFields(layout: ArenaLayout): ArenaLayout {
    const { decals: _decals, ...networkLayout } = layout;
    return networkLayout;
  }

  static hydrateVisualOnlyFields(
    layout: ArenaLayout,
    coopBaseSpecs: readonly BaseSpec[] = [],
  ): ArenaLayout {
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
        layout.groundHazardZones ?? [],
        coopBaseSpecs,
      ),
    };
  }

  /**
   * Generiert TRACK_COUNT zufällige vertikale Gleis-Spalten in der mittleren
   * Hälfte der Arena (TRACK_SPAWN_MIN_COL … TRACK_SPAWN_MAX_COL).
   * Gibt die Set der gewählten Spalten zurück (für Felsen/Baum-Filter)
   * sowie alle TrackCells (jede Zelle einer Gleis-Spalte).
   */
  private static generateTracks(
    rng: () => number,
    bases: readonly BaseSpec[] = [],
    trackPosition?: CoopDefenseMapTrackPosition,
  ): { trackCols: Set<number>; tracks: TrackCell[] } {
    const candidateColumns = Array.from({ length: Math.max(0, GRID_COLS - 1) }, (_, col) => col)
      .filter((col) => ArenaGenerator.isTrackColumnClearOfBases(col, bases));

    if (candidateColumns.length === 0) {
      throw new Error('[ArenaGenerator] Keine Gleisspalte mit ausreichendem Abstand zu den Basen verfügbar');
    }

    const authoredPosition = trackPosition ?? (usesCenteredTrackSpawn() ? 'center' : undefined);
    if (typeof authoredPosition === 'object' && authoredPosition.kind === 'grid') {
      const col = authoredPosition.gridX;
      if (!candidateColumns.includes(col)) {
        throw new Error(
          `[ArenaGenerator] Authored trackPosition gridX ${col} overlaps a base or its clearance on the current map`,
        );
      }
      return ArenaGenerator.buildTrackLayout(col);
    }

    if (authoredPosition === 'left' || authoredPosition === 'right') {
      const available = ArenaGenerator.getMiddleTrackColumns(candidateColumns);
      if (available.length === 0) {
        throw new Error(
          `[ArenaGenerator] No safe ${authoredPosition} track position is available within the authored middle zone`,
        );
      }
      const col = authoredPosition === 'left'
        ? available[0]
        : available[available.length - 1];
      return ArenaGenerator.buildTrackLayout(col);
    }

    if (authoredPosition === 'center') {
      // CTB & Coop-Defense: Gleise bevorzugt in die Mitte der Arena setzen (2 Spalten zentriert).
      // Wenn dort eine Basis liegt, wird die nächstgelegene sichere Spalte verwendet.
      const centeredCol = Math.floor((GRID_COLS - 2) / 2);
      const col = candidateColumns.reduce((best, candidate) => (
        Math.abs(candidate - centeredCol) < Math.abs(best - centeredCol) ? candidate : best
      ), candidateColumns[0]);
      return ArenaGenerator.buildTrackLayout(col);
    }

    const available = ArenaGenerator.getAvailableTrackColumns(candidateColumns);
    ArenaGenerator.shuffle(available, rng);

    return ArenaGenerator.buildTrackLayout(available[0]);
  }

  private static getAvailableTrackColumns(candidateColumns: readonly number[]): number[] {
    const available = ArenaGenerator.getMiddleTrackColumns(candidateColumns);
    return available.length > 0 ? available : [...candidateColumns];
  }

  private static getMiddleTrackColumns(candidateColumns: readonly number[]): number[] {
    return candidateColumns.filter((col) => (
      col >= TRACK_SPAWN_MIN_COL && col <= TRACK_SPAWN_MAX_COL
    ));
  }

  /**
   * Raeumt in regelmaessigen Abstaenden einen breiten Querungsstreifen frei. Die Strecke wird
   * erst nach der Baumplatzierung gesichert, damit auch Baumkronen-/Stammzellen nicht als
   * scheinbare Ausweichroute uebrig bleiben.
   */
  private static ensureTrackCrossingOptions(
    blocked: boolean[][],
    rocks: RockCell[],
    trees: TreeCell[],
    trackCols: ReadonlySet<number>,
    bases: readonly BaseSpec[],
    protectedCells: ReadonlySet<string> | null = null,
    reservationBaseSpecs?: readonly BaseSpec[],
  ): void {
    if (trackCols.size === 0) return;
    const trackMinX = Math.min(...trackCols);
    const trackMaxX = Math.max(...trackCols);
    const removed = new Set<number>();

    for (
      let startY = 1;
      startY < GRID_ROWS;
      startY += COOP_DEFENSE_TRACK_CROSSING_INTERVAL_CELLS
    ) {
      for (
        let offsetY = 0;
        offsetY < COOP_DEFENSE_TRACK_CROSSING_WIDTH_CELLS && startY + offsetY < GRID_ROWS;
        offsetY += 1
      ) {
        const gridY = startY + offsetY;
        for (
          let gridX = trackMinX - COOP_DEFENSE_TRACK_CROSSING_CLEARANCE_SIDE_CELLS;
          gridX <= trackMaxX + COOP_DEFENSE_TRACK_CROSSING_CLEARANCE_SIDE_CELLS;
          gridX += 1
        ) {
          if (
            gridX < 0
            || gridX >= GRID_COLS
            || ArenaGenerator.isTrackCrossingProtectedCell(
              gridX,
              gridY,
              bases,
              reservationBaseSpecs,
            )
            || protectedCells?.has(`${gridX}_${gridY}`)
          ) continue;
          if (!blocked[gridY][gridX]) continue;
          blocked[gridY][gridX] = false;
          removed.add(ArenaGenerator.cellKey(gridX, gridY));
        }
      }
    }

    if (removed.size === 0) return;
    rocks.splice(0, rocks.length, ...rocks.filter((rock) => !removed.has(ArenaGenerator.cellKey(rock.gridX, rock.gridY))));
    trees.splice(0, trees.length, ...trees.filter((tree) => !removed.has(ArenaGenerator.cellKey(tree.gridX, tree.gridY))));
  }

  private static isTrackCrossingProtectedCell(
    gridX: number,
    gridY: number,
    bases: readonly BaseSpec[],
    reservationBaseSpecs?: readonly BaseSpec[],
  ): boolean {
    if (bases.length === 0) {
      return isReservedBaseObstacleCell(gridX, gridY, reservationBaseSpecs);
    }
    return bases.some((base) => (
      gridX >= base.region.minGridX - COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS
      && gridX <= base.region.maxGridX + COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS
      && gridY >= base.region.minGridY - COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS
      && gridY <= base.region.maxGridY + COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS
    ));
  }

  /**
   * Prueft nur die tatsaechlich authored Spawnfronts und strukturgebundenen Quellen. Eine
   * zulassige Route ist 4er-verbunden und darf den zentral konfigurierten Gleislauf-Grenzwert
   * nicht ueberschreiten. Damit wird nicht jede theoretische Randzelle zur Map-Regel, sondern
   * nur ein realer Spawn muss die freundlichen Zielbasen sinnvoll erreichen koennen.
   */
  private static hasAcceptableSpawnToBaseRoutes(
    blocked: boolean[][],
    tracks: readonly TrackCell[],
    mapConfig: CoopDefenseMapConfig,
    bases: readonly BaseSpec[],
  ): boolean {
    const targetCells = ArenaGenerator.getFriendlyBaseGoalCells(blocked, bases);
    if (targetCells.size === 0) return true;

    const trackCells = new Set<number>();
    for (const track of tracks) {
      trackCells.add(ArenaGenerator.cellKey(track.gridX, track.gridY));
      if (track.gridX + 1 < GRID_COLS) {
        trackCells.add(ArenaGenerator.cellKey(track.gridX + 1, track.gridY));
      }
    }

    const baseCells = new Set<number>(bases.flatMap((base) => (
      base.cells.map((cell) => ArenaGenerator.cellKey(cell.gridX, cell.gridY))
    )));
    const sourceGroups: Array<Array<{ gridX: number; gridY: number }>> = [];
    const fronts = new Set<SpawnFront>();
    for (const encounter of mapConfig.encounters ?? []) {
      for (const group of encounter.groups) fronts.add(group.front ?? DEFAULT_SPAWN_FRONT);
    }
    for (const spawn of mapConfig.persistentSpawns ?? []) {
      const sourceConfig = spawn.source;
      if (sourceConfig.type === 'map') fronts.add(spawn.front ?? DEFAULT_SPAWN_FRONT);
      else {
        const source = bases.find((base) => base.id === sourceConfig.baseId);
        if (source?.spawnCenter) sourceGroups.push([source.spawnCenter]);
      }
    }
    if (mapConfig.boss) fronts.add(DEFAULT_SPAWN_FRONT);
    for (const front of fronts) {
      sourceGroups.push(ArenaGenerator.getSpawnFrontCells(front, blocked, baseCells));
    }

    for (const sources of sourceGroups) {
      if (sources.length === 0) return false;
      if (!ArenaGenerator.canReachTrackSafeGoal(sources, targetCells, blocked, trackCells)) return false;
    }
    return true;
  }

  private static getFriendlyBaseGoalCells(
    blocked: boolean[][],
    bases: readonly BaseSpec[],
  ): Set<number> {
    const targetCells = new Set<number>();
    const baseCells = new Set<number>(bases.flatMap((base) => (
      base.cells.map((cell) => ArenaGenerator.cellKey(cell.gridX, cell.gridY))
    )));
    for (const base of bases) {
      if (base.faction === 'hostile' || base.role === 'spawn-point') continue;
      if (base.role === 'outpost' && base.dormantObjectiveId === undefined) continue;
      for (const cell of base.cells) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const gridX = cell.gridX + dx;
          const gridY = cell.gridY + dy;
          if (
            gridX < 0 || gridX >= GRID_COLS || gridY < 0 || gridY >= GRID_ROWS
            || blocked[gridY][gridX]
            || baseCells.has(ArenaGenerator.cellKey(gridX, gridY))
          ) continue;
          targetCells.add(ArenaGenerator.cellKey(gridX, gridY));
        }
      }
    }
    return targetCells;
  }

  private static getSpawnFrontCells(
    front: SpawnFront,
    blocked: boolean[][],
    baseCells: ReadonlySet<number>,
  ): Array<{ gridX: number; gridY: number }> {
    const depthX = Math.min(Math.max(2, Math.floor(GRID_COLS * 0.15)), GRID_COLS - 1);
    const depthY = Math.min(Math.max(2, Math.floor(GRID_ROWS * 0.15)), GRID_ROWS - 1);
    const minGridX = front === 'east' ? GRID_COLS - depthX - 1 : 0;
    const maxGridX = front === 'west' ? depthX : GRID_COLS - 1;
    const minGridY = front === 'south' ? GRID_ROWS - depthY - 1 : 0;
    const maxGridY = front === 'north' ? depthY : GRID_ROWS - 1;
    const cells: Array<{ gridX: number; gridY: number }> = [];
    for (let gridY = minGridY; gridY <= maxGridY; gridY += 1) {
      for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
        const onFrontBand = front === 'west' || front === 'east'
          ? (front === 'west' ? gridX <= depthX : gridX >= GRID_COLS - depthX - 1)
          : (front === 'north' ? gridY <= depthY : gridY >= GRID_ROWS - depthY - 1);
        if (!onFrontBand || blocked[gridY][gridX] || baseCells.has(ArenaGenerator.cellKey(gridX, gridY))) continue;
        cells.push({ gridX, gridY });
      }
    }
    return cells;
  }

  private static canReachTrackSafeGoal(
    sources: readonly { gridX: number; gridY: number }[],
    targets: ReadonlySet<number>,
    blocked: boolean[][],
    trackCells: ReadonlySet<number>,
  ): boolean {
    const runWidth = COOP_DEFENSE_MAX_REQUIRED_TRACK_RUN_CELLS + 1;
    const totalCells = GRID_COLS * GRID_ROWS;
    const visited = new Uint8Array(totalCells * runWidth);
    const queue = new Int32Array(totalCells * runWidth);
    let queueEnd = 0;
    for (const source of sources) {
      const index = ArenaGenerator.cellKey(source.gridX, source.gridY);
      const run = trackCells.has(index) ? 1 : 0;
      const state = index * runWidth + run;
      if (visited[state] === 1) continue;
      visited[state] = 1;
      queue[queueEnd] = state;
      queueEnd += 1;
    }

    for (let queueIndex = 0; queueIndex < queueEnd; queueIndex += 1) {
      const state = queue[queueIndex];
      const index = Math.floor(state / runWidth);
      const currentRun = state % runWidth;
      if (targets.has(index)) return true;
      const gridX = index % GRID_COLS;
      const gridY = Math.floor(index / GRID_COLS);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nextX = gridX + dx;
        const nextY = gridY + dy;
        if (
          nextX < 0 || nextX >= GRID_COLS || nextY < 0 || nextY >= GRID_ROWS
          || blocked[nextY][nextX]
        ) continue;
        const nextIndex = ArenaGenerator.cellKey(nextX, nextY);
        const nextRun = trackCells.has(nextIndex) ? currentRun + 1 : 0;
        if (nextRun > COOP_DEFENSE_MAX_REQUIRED_TRACK_RUN_CELLS) continue;
        const nextState = nextIndex * runWidth + nextRun;
        if (visited[nextState] === 1) continue;
        visited[nextState] = 1;
        queue[queueEnd] = nextState;
        queueEnd += 1;
      }
    }
    return false;
  }

  private static buildTrackLayout(col: number): { trackCols: Set<number>; tracks: TrackCell[] } {
    const trackCols = new Set([col, col + 1]);
    const tracks: TrackCell[] = [];
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      tracks.push({ gridX: col, gridY: gy });
    }
    return { trackCols, tracks };
  }

  /** Der Gleis-Fußabdruck umfasst zwei Rasterspalten; dazwischen bleibt eine freie Zelle. */
  private static isTrackColumnClearOfBases(col: number, bases: readonly BaseSpec[]): boolean {
    const trackMinX = col;
    const trackMaxX = col + 1;
    return bases.every((base) => (
      trackMaxX < base.region.minGridX - COOP_DEFENSE_BASE_TRACK_CLEARANCE_CELLS
      || trackMinX > base.region.maxGridX + COOP_DEFENSE_BASE_TRACK_CLEARANCE_CELLS
    ));
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
    tutorialShowControls: boolean,
    coopBaseSpecs?: readonly BaseSpec[],
  ): Set<string> {
    const tutorialRockCells = new Set<string>();
    // Gemeinsamer Generator; die Lobby-Felslandschaft unter dem Mittelpanel benutzt ihn mit
    // eigener Region und eigenem Randverlauf.
    const cells = generateSolidRockFormation(rng, {
      region: getCoopDefenseTutorialRockRegion(tutorialShowControls),
      haloCells: COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS,
      haloFillChance: [0.72],
      outerHaloFillChance: 0.36,
      gridCols: GRID_COLS,
      gridRows: GRID_ROWS,
      isBlockedCell: (gx, gy) => (
        trackCols.has(gx) || isReservedBaseObstacleCell(gx, gy, coopBaseSpecs)
      ),
    });
    for (const { gridX, gridY } of cells) {
      map[gridY][gridX] = true;
      tutorialRockCells.add(`${gridX}_${gridY}`);
    }
    return tutorialRockCells;
  }

  private static generateRandomPowerUpPedestals(
    rng: () => number,
    blocked: boolean[][],
    trackCols: Set<number>,
    coopBaseSpecs?: readonly BaseSpec[],
  ) {
    const candidates: Array<{ gx: number; gy: number }> = [];
    const margin = POWERUP_PEDESTAL_CONFIG.edgePaddingCells;
    const middleThirdRegion = isCaptureTheBeerBaseModeActive() ? getCaptureTheBeerMiddleThirdRegion() : null;

    for (let gy = margin; gy < GRID_ROWS - margin; gy++) {
      for (let gx = margin; gx < GRID_COLS - margin; gx++) {
        if (blocked[gy][gx]) continue;
        if (trackCols.has(gx)) continue;
        if (isReservedBaseObstacleCell(gx, gy, coopBaseSpecs)) continue;
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
    coopBaseSpecs?: readonly BaseSpec[],
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
        if (isReservedBaseObstacleCell(gx, gy, coopBaseSpecs)) continue;
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
    coopBaseSpecs: readonly BaseSpec[],
  ): ArenaLayout['powerUpPedestals'] | null {
    const pedestals = ArenaGenerator.generateConfiguredPowerUpPedestals(
      rng,
      blocked,
      trackCols,
      mapConfig.powerUps,
      coopBaseSpecs,
    );
    if (pedestals === null) return null;

    const occupied = new Set(pedestals.map((pedestal) => ArenaGenerator.cellKey(pedestal.gridX, pedestal.gridY)));
    for (const base of coopBaseSpecs) {
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
    groundHazardZones: readonly ArenaGroundHazardZone[],
    coopBaseSpecs?: readonly BaseSpec[],
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
    for (const zone of groundHazardZones) {
      for (const { gridX, gridY } of zone.cells) {
        blockedCells.add(ArenaGenerator.cellKey(gridX, gridY));
      }
    }

    const decals: DecalCell[] = [];
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      for (let gx = 0; gx < GRID_COLS; gx++) {
        const key = ArenaGenerator.cellKey(gx, gy);
        if (blockedCells.has(key) || isReservedBaseSurfaceCell(gx, gy, coopBaseSpecs)) continue;

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
          surface: 'ground',
          rotation: ArenaGenerator.randomRotation(rng),
        });
      }
    }

    // Diese zehn graubraunen Varianten liegen bewusst auf der Dirt-Zelle unter einem Fels.
    // Der Fels wird spaeter separat und dynamisch darueber gezeichnet; nach seiner Zerstoerung
    // bleibt der gebackene Dirt-Decal-Layer bestehen und wird dadurch sichtbar.
    const underRockMaxOffsetX = clampDecalOffsetPx(DIRT_ROCK_UNDERLAY_DECAL_CONFIG.maxOffsetX);
    const underRockMaxOffsetY = clampDecalOffsetPx(DIRT_ROCK_UNDERLAY_DECAL_CONFIG.maxOffsetY);
    for (const { gridX, gridY } of rocks) {
      const key = ArenaGenerator.cellKey(gridX, gridY);
      if (!dirtSet.has(key) || isReservedBaseSurfaceCell(gridX, gridY, coopBaseSpecs)) continue;
      if (!ArenaGenerator.rollPercent(rng, DIRT_ROCK_UNDERLAY_DECAL_CONFIG.coveragePercent)) continue;

      const textureKey = ArenaGenerator.pickWeightedDecalKey(rng, DIRT_ROCK_UNDERLAY_DECAL_CONFIG.variants);
      if (!textureKey) continue;
      decals.push({
        gridX,
        gridY,
        textureKey,
        offsetX: ArenaGenerator.randomOffset(rng, underRockMaxOffsetX),
        offsetY: ArenaGenerator.randomOffset(rng, underRockMaxOffsetY),
        terrain: 'dirt',
        surface: 'ground',
        rotation: ArenaGenerator.randomRotation(rng),
      });
    }

    // Fels-Decals werden getrennt vom Boden gebacken. Ein Eintrag kennt alle Felsen,
    // die seine gedrehnete Bounds beruehren; beim naechsten Rock-Bake bleibt er nur
    // sichtbar, wenn diese gesamte kleine Gruppe noch existiert. Dadurch duerfen
    // einzelne Risse/Moosflaechen ueber Zellgrenzen laufen, ohne nach einer Zerstoerung
    // als schwebender Rest auf dem Nachbarfelsen zu bleiben.
    const rockIndexByKey = new Map<number, number>();
    rocks.forEach((rock, index) => rockIndexByKey.set(ArenaGenerator.cellKey(rock.gridX, rock.gridY), index));
    for (let rockId = 0; rockId < rocks.length; rockId += 1) {
      const rock = rocks[rockId];
      const placement = ArenaGenerator.resolveRockDecalPlacement(rock, rockIndexByKey);
      const coveragePercent = placement === 'edge'
        ? ROCK_DECAL_CONFIG.edgeCoveragePercent
        : ROCK_DECAL_CONFIG.interiorCoveragePercent;
      if (!ArenaGenerator.rollPercent(rng, coveragePercent)) continue;

      const textureKey = ArenaGenerator.pickWeightedDecalKey(rng, getRockDecalVariantsForPlacement(placement));
      if (!textureKey) continue;
      const variant = getRockDecalVariant(textureKey);
      const displaySize = variant?.displaySize ?? ROCK_DECAL_SIZE;
      const maxOffset = getRockDecalMaxOffsetPx(displaySize);

      const offsetX = ArenaGenerator.randomOffset(rng, maxOffset);
      const offsetY = ArenaGenerator.randomOffset(rng, maxOffset);
      const rotation = ArenaGenerator.randomRotation(rng);
      const centerX = rock.gridX * CELL_SIZE + CELL_SIZE / 2 + offsetX;
      const centerY = rock.gridY * CELL_SIZE + CELL_SIZE / 2 + offsetY;
      const rockIds = ArenaGenerator.getRockIdsTouchedByDecal(
        rocks,
        rockIndexByKey,
        centerX,
        centerY,
        rotation,
        displaySize,
      );

      decals.push({
        gridX: rock.gridX,
        gridY: rock.gridY,
        textureKey,
        offsetX,
        offsetY,
        terrain: 'rock',
        surface: 'rock',
        rockIds,
        displaySize,
        alpha: variant?.alpha,
        rotation,
      });
    }

    return decals;
  }

  /**
   * Lage einer Felszelle im Verbund. Der Rand der Arena zaehlt bewusst **nicht** als Fels:
   * dort liegt die Silhouette wirklich frei, und genau dort soll auch Bewuchs sitzen.
   */
  private static resolveRockDecalPlacement(
    rock: RockCell,
    rockIndexByKey: ReadonlyMap<number, number>,
  ): DecalPlacement {
    const isRock = (gridX: number, gridY: number) => rockIndexByKey.has(ArenaGenerator.cellKey(gridX, gridY));
    const { gridX, gridY } = rock;

    if (!isRock(gridX, gridY - 1) || !isRock(gridX, gridY + 1)
      || !isRock(gridX - 1, gridY) || !isRock(gridX + 1, gridY)) {
      return 'edge';
    }
    if (!isRock(gridX - 1, gridY - 1) || !isRock(gridX + 1, gridY - 1)
      || !isRock(gridX - 1, gridY + 1) || !isRock(gridX + 1, gridY + 1)) {
      return 'interior';
    }
    return 'core';
  }

  private static getRockIdsTouchedByDecal(
    rocks: readonly RockCell[],
    rockIndexByKey: ReadonlyMap<number, number>,
    centerX: number,
    centerY: number,
    rotation: number,
    displaySize: number,
  ): number[] {
    const halfSize = displaySize * 0.5;
    const halfExtentX = Math.abs(Math.cos(rotation)) * halfSize + Math.abs(Math.sin(rotation)) * halfSize;
    const halfExtentY = Math.abs(Math.sin(rotation)) * halfSize + Math.abs(Math.cos(rotation)) * halfSize;
    const minGridX = Math.max(0, Math.floor((centerX - halfExtentX) / CELL_SIZE));
    const maxGridX = Math.min(GRID_COLS - 1, Math.floor((centerX + halfExtentX - 0.001) / CELL_SIZE));
    const minGridY = Math.max(0, Math.floor((centerY - halfExtentY) / CELL_SIZE));
    const maxGridY = Math.min(GRID_ROWS - 1, Math.floor((centerY + halfExtentY - 0.001) / CELL_SIZE));
    const touched: number[] = [];

    for (let gridY = minGridY; gridY <= maxGridY; gridY += 1) {
      for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
        const id = rockIndexByKey.get(ArenaGenerator.cellKey(gridX, gridY));
        if (id !== undefined) touched.push(id);
      }
    }

    return touched.length > 0 ? touched : [rocks.findIndex((rock) => (
      rock.gridX === Math.floor((centerX - CELL_SIZE / 2) / CELL_SIZE)
      && rock.gridY === Math.floor((centerY - CELL_SIZE / 2) / CELL_SIZE)
    ))];
  }

  /**
   * Loest alle authored Ground-Hazard-Flaechen waehrend des Arena-Aufbaus in konkrete,
   * kollisionsfreie 32px-Zellen auf. Die Rueckgabe ist absichtlich nur Layoutdaten: Feuer,
   * Burn und Visuals entstehen erst, wenn der typisierte Event-Handler die Zellen aktiviert.
   */
  private static generateGroundHazardZones(
    rng: () => number,
    blocked: readonly boolean[][],
    trees: readonly TreeCell[],
    trackCols: ReadonlySet<number>,
    tracks: readonly TrackCell[],
    powerUpPedestals: ArenaLayout['powerUpPedestals'],
    mapConfig?: CoopDefenseMapConfig,
    coopBaseSpecs: readonly BaseSpec[] = [],
  ): ArenaGroundHazardZone[] | null {
    if (!mapConfig) return [];
    const events = (mapConfig.mapEvents ?? []).filter(
      (event): event is CoopDefenseMapGroundHazardEventConfig => event.type === 'ground-hazard',
    );
    if (events.length === 0) return [];

    const occupied = new Set<number>();
    for (const tree of trees) occupied.add(ArenaGenerator.cellKey(tree.gridX, tree.gridY));
    for (const track of tracks) {
      occupied.add(ArenaGenerator.cellKey(track.gridX, track.gridY));
      occupied.add(ArenaGenerator.cellKey(track.gridX + 1, track.gridY));
    }
    for (const pedestal of powerUpPedestals) {
      occupied.add(ArenaGenerator.cellKey(pedestal.gridX, pedestal.gridY));
    }

    const baseCells = coopBaseSpecs.flatMap((base) => base.cells);
    const isValidCell = (
      gridX: number,
      gridY: number,
      baseClearanceCells: number,
      avoidVoidTrackCorridor = false,
    ): boolean => {
      if (gridX < 0 || gridX >= GRID_COLS || gridY < 0 || gridY >= GRID_ROWS) return false;
      const key = ArenaGenerator.cellKey(gridX, gridY);
      if (
        blocked[gridY][gridX]
        || occupied.has(key)
        || isReservedBaseSurfaceCell(gridX, gridY, coopBaseSpecs)
        || (avoidVoidTrackCorridor && trackCols.has(gridX))
      ) return false;
      return baseCells.every((baseCell) => (
        Math.max(Math.abs(gridX - baseCell.gridX), Math.abs(gridY - baseCell.gridY)) > baseClearanceCells
      ));
    };
    const makeZone = (
      event: CoopDefenseMapGroundHazardEventConfig,
      id: string,
      cells: ArenaGroundHazardZone['cells'],
    ): ArenaGroundHazardZone => ({ eventId: event.id, id, cells });

    const zones: ArenaGroundHazardZone[] = [];
    for (const event of events) {
      const area = event.area;
      const baseClearanceCells = area.baseClearanceCells ?? 0;
      // Authored Geometrie: Ein Rechteck bzw. eine Zellenliste, die vollstaendig auf Felsen,
      // Basiszellen oder Gleisen liegt, liefert schlicht keine Zone. Der Fachhandler laesst das
      // Event dann dormant (fail-closed) -- ein Layout-Retry oder gar ein Abbruch der
      // Arena-Erzeugung waere eine unverhaeltnismaessige Reaktion auf einen Authoring-Fehler.
      if (area.type === 'rectangle') {
        const cells: ArenaGroundHazardZone['cells'] = [];
        for (let gridY = area.gridY; gridY < area.gridY + area.heightCells; gridY += 1) {
          for (let gridX = area.gridX; gridX < area.gridX + area.widthCells; gridX += 1) {
            if (isValidCell(gridX, gridY, baseClearanceCells)) cells.push({ gridX, gridY });
          }
        }
        if (cells.length > 0) zones.push(makeZone(event, event.id, cells));
        continue;
      }

      if (area.type === 'cells') {
        const cells = area.cells.filter((cell) => isValidCell(cell.gridX, cell.gridY, baseClearanceCells));
        if (cells.length > 0) zones.push(makeZone(event, event.id, cells));
        continue;
      }

      let selectedPatchCount = 0;
      const usedInEvent = new Set<number>();
      const avoidVoidTrackCorridor = mapConfig.trackMode === 'void-fire';
      for (let patchIndex = 0; patchIndex < area.randomPatchCount; patchIndex += 1) {
        let selected: ArenaGroundHazardZone['cells'] | null = null;
        for (let attempt = 0; attempt < 120 && selected === null; attempt += 1) {
          const radius = area.minPatchRadiusCells
            + rng() * (area.maxPatchRadiusCells - area.minPatchRadiusCells);
          const centerX = Math.floor(rng() * GRID_COLS);
          const centerY = Math.floor(rng() * GRID_ROWS);
          const radiusSq = radius * radius;
          const cells: ArenaGroundHazardZone['cells'] = [];
          for (
            let gridY = Math.max(0, Math.floor(centerY - radius));
            gridY <= Math.min(GRID_ROWS - 1, Math.ceil(centerY + radius));
            gridY += 1
          ) {
            for (
              let gridX = Math.max(0, Math.floor(centerX - radius));
              gridX <= Math.min(GRID_COLS - 1, Math.ceil(centerX + radius));
              gridX += 1
            ) {
              const dx = gridX - centerX;
              const dy = gridY - centerY;
              if (dx * dx + dy * dy > radiusSq) continue;
              const key = ArenaGenerator.cellKey(gridX, gridY);
              if (
                !usedInEvent.has(key)
                && isValidCell(gridX, gridY, baseClearanceCells, avoidVoidTrackCorridor)
              ) {
                cells.push({ gridX, gridY });
              }
            }
          }
          if (cells.length >= 4) selected = cells;
        }
        if (selected === null) continue;
        selectedPatchCount += 1;
        for (const cell of selected) usedInEvent.add(ArenaGenerator.cellKey(cell.gridX, cell.gridY));
        zones.push(makeZone(event, `${event.id}:patch-${patchIndex + 1}`, selected));
      }
      if (selectedPatchCount === 0) return null;
    }
    return zones;
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

  private static randomRotation(rng: () => number): number {
    return rng() * Math.PI * 2;
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
