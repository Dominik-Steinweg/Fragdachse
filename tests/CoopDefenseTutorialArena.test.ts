import { describe, expect, it } from 'vitest';
import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import {
  COOP_DEFENSE_TUTORIAL_PANEL_HEIGHT,
  COOP_DEFENSE_TUTORIAL_PANEL_WIDTH,
  COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS,
  getCoopDefenseTutorialRockRegion,
} from '../src/config/coopDefenseTutorial';

describe('Coop defense tutorial arena formation', () => {
  it('uses one shared panel footprint large enough for all tutorial maps', () => {
    expect(COOP_DEFENSE_TUTORIAL_PANEL_WIDTH).toBe(840);
    expect(COOP_DEFENSE_TUTORIAL_PANEL_HEIGHT).toBe(168);
    for (let mapId = 1; mapId <= 5; mapId++) {
      expect(getCoopDefenseMapConfig(String(mapId)).tutorialText).toBeTruthy();
    }
  });

  it('fills the tutorial footprint with rocks except for railway cells', () => {
    const layout = ArenaGenerator.generate(42_424, getCoopDefenseMapConfig('1'));
    const rocks = new Set(layout.rocks.map((rock) => `${rock.gridX}:${rock.gridY}`));
    const trackColumns = new Set<number>();
    for (const track of layout.tracks) {
      trackColumns.add(track.gridX);
      trackColumns.add(track.gridX + 1);
    }
    const region = getCoopDefenseTutorialRockRegion();
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
});
