import { generateArenaWithActiveMetrics } from './ArenaGeneratorTestHelper';
import { afterEach, describe, expect, it } from 'vitest';
import { COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS, resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { COOP_DEFENSE_MAP_CONFIGS, getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_WIDTH,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  applyArenaMetricsForMode,
} from '../src/config';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import {
  COOP_DEFENSE_TUTORIAL_PANEL_HEIGHT,
  COOP_DEFENSE_TUTORIAL_PANEL_WIDTH,
  COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS,
  getCoopDefenseTutorialPanelCenterX,
  getCoopDefenseTutorialPanelTopY,
  getCoopDefenseTutorialRockRegion,
} from '../src/config/coopDefenseTutorial';
import { COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT } from '../src/ui/CoopDefenseSecondaryObjectiveLayout';
import { getMapTutorial } from '../src/i18n/contentPresentation';

describe('Coop defense tutorial arena formation', () => {
  afterEach(() => {
    applyArenaMetricsForMode('deathmatch', 'LOBBY');
  });

  it('uses one shared panel footprint large enough for all tutorial maps', () => {
    expect(COOP_DEFENSE_TUTORIAL_PANEL_WIDTH).toBe(840);
    expect(COOP_DEFENSE_TUTORIAL_PANEL_HEIGHT).toBe(168);
    for (let mapId = 1; mapId <= 5; mapId++) {
      expect(getMapTutorial(String(mapId), 'de')).toBeTruthy();
    }
  });

  it('keeps tutorial world positioning independent from the screen-space announcement layout', () => {
    const announcementEntryBottom = COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT.centerY
      + COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT.entryOffsetY
      + COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT.height / 2;
    expect(getCoopDefenseTutorialPanelTopY()).toBe(ARENA_OFFSET_Y + 7 * CELL_SIZE);
    expect(getCoopDefenseTutorialPanelTopY()).not.toBe(announcementEntryBottom);
  });

  it('grows the footprint only for the map that shows the controls table', () => {
    const standard = getCoopDefenseTutorialRockRegion(false);
    const withControls = getCoopDefenseTutorialRockRegion(true);
    expect(withControls.maxGridY).toBeGreaterThan(standard.maxGridY);
    expect(withControls.minGridX).toBe(standard.minGridX);
    expect(withControls.maxGridX).toBe(standard.maxGridX);
    expect(getCoopDefenseMapConfig('1').tutorialShowControls).toBe(true);
    for (let mapId = 2; mapId <= 5; mapId++) {
      expect(getCoopDefenseMapConfig(String(mapId)).tutorialShowControls).toBe(false);
    }
  });

  it('fills the tutorial footprint and grows an irregular halo on all four sides', () => {
    const mapConfig = getCoopDefenseMapConfig('1');
    // Der Generator liest GRID_COLS/GRID_ROWS; ohne die Map-Metriken laege die authored
    // Geometrie der Karte teilweise ausserhalb des Rasters.
    applyArenaMetricsForMode(
      COOP_DEFENSE_MODE,
      'ARENA',
      mapConfig.arenaWidthCells,
      mapConfig.arenaHeightCells,
    );
    const layout = generateArenaWithActiveMetrics(42_424, mapConfig);
    const rocks = new Set(layout.rocks.map((rock) => `${rock.gridX}:${rock.gridY}`));
    const region = getCoopDefenseTutorialRockRegion(true, mapConfig.tutorialAnchor);
    const tutorialRocks = layout.rocks.filter((rock) => (
      rock.gridX >= region.minGridX - COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS
      && rock.gridX <= region.maxGridX + COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS
      && rock.gridY >= region.minGridY - COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS
      && rock.gridY <= region.maxGridY + COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS
    ));
    const trackColumns = new Set<number>();
    for (const track of layout.tracks) {
      trackColumns.add(track.gridX);
      trackColumns.add(track.gridX + 1);
    }
    for (let gy = region.minGridY; gy <= region.maxGridY; gy++) {
      for (let gx = region.minGridX; gx <= region.maxGridX; gx++) {
        if (!trackColumns.has(gx)) expect(rocks.has(`${gx}:${gy}`)).toBe(true);
      }
    }

    const haloSides = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const rock of tutorialRocks) {
      const insideExpanded = rock.gridX >= region.minGridX - COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS
        && rock.gridX <= region.maxGridX + COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS
        && rock.gridY >= region.minGridY - COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS
        && rock.gridY <= region.maxGridY + COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS;
      expect(insideExpanded).toBe(true);
      if (rock.gridY < region.minGridY) haloSides.top++;
      if (rock.gridX > region.maxGridX) haloSides.right++;
      if (rock.gridY > region.maxGridY) haloSides.bottom++;
      if (rock.gridX < region.minGridX) haloSides.left++;
    }
    expect(haloSides.top).toBeGreaterThan(0);
    expect(haloSides.right).toBeGreaterThan(0);
    expect(haloSides.bottom).toBeGreaterThan(0);
    expect(haloSides.left).toBeGreaterThan(0);
    expect(Math.min(...tutorialRocks.map((rock) => rock.gridY)))
      .toBeGreaterThanOrEqual(region.minGridY - COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS);
  });

  it('keeps panel and rocks aligned on wide arenas while the camera moves', () => {
    const cameraScrolls = [0, 320, 960];
    for (const mapId of ['1', '13']) {
      const mapConfig = getCoopDefenseMapConfig(mapId);
      applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', mapConfig.arenaWidthCells);

      // Ohne Anker bleibt das Fenster in der Arenamitte; ein authored Anker verschiebt Fenster
      // und Felsformation gemeinsam.
      const panelWorldCenterX = getCoopDefenseTutorialPanelCenterX(mapConfig.tutorialAnchor);
      expect(panelWorldCenterX).toBe(mapConfig.tutorialAnchor
        ? ARENA_OFFSET_X + (mapConfig.tutorialAnchor.gridX + 0.5) * CELL_SIZE
        : ARENA_OFFSET_X + ARENA_WIDTH / 2);

      const region = getCoopDefenseTutorialRockRegion(mapConfig.tutorialShowControls, mapConfig.tutorialAnchor);
      const rockWorldCenterX = ARENA_OFFSET_X
        + (region.minGridX + region.maxGridX + 1) * CELL_SIZE / 2;
      expect(rockWorldCenterX).toBe(panelWorldCenterX);

      for (const scrollX of cameraScrolls) {
        expect(panelWorldCenterX - scrollX).toBe(rockWorldCenterX - scrollX);
      }
    }
  });

  it('keeps the tutorial panel rock region outside the five-cell clearance on every tutorial map', () => {
    const tutorialMaps = COOP_DEFENSE_MAP_CONFIGS.filter((map) => getMapTutorial(map.mapId, 'de') !== undefined);

    for (const map of tutorialMaps) {
      applyArenaMetricsForMode(
        COOP_DEFENSE_MODE,
        'ARENA',
        map.arenaWidthCells,
        map.arenaHeightCells,
      );

      const region = getCoopDefenseTutorialRockRegion(map.tutorialShowControls, map.tutorialAnchor);
      const bases = resolveCoopDefenseBases(map);
      for (const base of bases) {
        expect(
          base.cells.every((cell) => (
            cell.gridX >= 0 && cell.gridX < GRID_COLS
            && cell.gridY >= 0 && cell.gridY < GRID_ROWS
          )),
          `Map ${map.mapId} base ${base.id} has a cell outside the arena`,
        ).toBe(true);

        const clearanceOverlap: string[] = [];
        for (let gridY = region.minGridY; gridY <= region.maxGridY; gridY += 1) {
          for (let gridX = region.minGridX; gridX <= region.maxGridX; gridX += 1) {
            if (
              gridX >= base.region.minGridX - COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS
              && gridX <= base.region.maxGridX + COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS
              && gridY >= base.region.minGridY - COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS
              && gridY <= base.region.maxGridY + COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS
            ) {
              clearanceOverlap.push(`${gridX}:${gridY}`);
            }
          }
        }
        expect(
          clearanceOverlap,
          `Map ${map.mapId} base ${base.id} overlaps the tutorial panel rock region`,
        ).toEqual([]);
      }

      const mainBases = bases.filter((base) => base.role === 'main');
      expect(
        mainBases.every((base) => GRID_ROWS - 1 - base.region.maxGridY >= 15),
        `Map ${map.mapId} moves a main base too close to the lower arena edge`,
      ).toBe(true);
    }
  });
});
