import { afterEach, describe, expect, it } from 'vitest';
import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import {
  ARENA_OFFSET_X,
  ARENA_WIDTH,
  CELL_SIZE,
  applyArenaMetricsForMode,
} from '../src/config';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import {
  COOP_DEFENSE_TUTORIAL_PANEL_HEIGHT,
  COOP_DEFENSE_TUTORIAL_PANEL_WIDTH,
  COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS,
  getCoopDefenseTutorialPanelCenterX,
  getCoopDefenseTutorialRockRegion,
} from '../src/config/coopDefenseTutorial';

describe('Coop defense tutorial arena formation', () => {
  afterEach(() => {
    applyArenaMetricsForMode('deathmatch', 'LOBBY');
  });

  it('uses one shared panel footprint large enough for all tutorial maps', () => {
    expect(COOP_DEFENSE_TUTORIAL_PANEL_WIDTH).toBe(840);
    expect(COOP_DEFENSE_TUTORIAL_PANEL_HEIGHT).toBe(168);
    for (let mapId = 1; mapId <= 5; mapId++) {
      expect(getCoopDefenseMapConfig(String(mapId)).tutorialText).toBeTruthy();
    }
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

  it('fills the tutorial footprint with rocks except for railway cells', () => {
    const mapConfig = getCoopDefenseMapConfig('1');
    const layout = ArenaGenerator.generate(42_424, mapConfig);
    const rocks = new Set(layout.rocks.map((rock) => `${rock.gridX}:${rock.gridY}`));
    const trackColumns = new Set<number>();
    for (const track of layout.tracks) {
      trackColumns.add(track.gridX);
      trackColumns.add(track.gridX + 1);
    }
    const region = getCoopDefenseTutorialRockRegion(true);
    for (let gy = region.minGridY; gy <= region.maxGridY; gy++) {
      for (let gx = region.minGridX; gx <= region.maxGridX; gx++) {
        if (!trackColumns.has(gx)) expect(rocks.has(`${gx}:${gy}`)).toBe(true);
      }
    }

    let haloRockCount = 0;
    for (const rock of layout.rocks) {
      const insideExpanded = rock.gridX >= region.minGridX - COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS
        && rock.gridX <= region.maxGridX + COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS
        && rock.gridY >= region.minGridY - COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS
        && rock.gridY <= region.maxGridY + COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS;
      const insideCore = rock.gridX >= region.minGridX && rock.gridX <= region.maxGridX
        && rock.gridY >= region.minGridY && rock.gridY <= region.maxGridY;
      if (insideExpanded && !insideCore) haloRockCount++;
    }
    expect(haloRockCount).toBeGreaterThan(0);
  });

  it('keeps panel and rocks world-centered on 60- and 120-cell arenas while the camera moves', () => {
    const cameraScrolls = [0, 320, 960];
    for (const mapId of ['1', '13']) {
      const mapConfig = getCoopDefenseMapConfig(mapId);
      applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', mapConfig.arenaWidthCells);

      const panelWorldCenterX = getCoopDefenseTutorialPanelCenterX();
      expect(panelWorldCenterX).toBe(ARENA_OFFSET_X + ARENA_WIDTH / 2);

      const region = getCoopDefenseTutorialRockRegion(mapConfig.tutorialShowControls);
      const rockWorldCenterX = ARENA_OFFSET_X
        + (region.minGridX + region.maxGridX + 1) * CELL_SIZE / 2;
      expect(rockWorldCenterX).toBe(panelWorldCenterX);

      for (const scrollX of cameraScrolls) {
        expect(panelWorldCenterX - scrollX).toBe(rockWorldCenterX - scrollX);
      }
    }
  });
});
