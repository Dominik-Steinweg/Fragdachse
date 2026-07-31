import { describe, expect, it } from 'vitest';
import {
  CAPTURE_THE_BEER_ARENA_WIDTH,
  DEFAULT_ARENA_WIDTH,
  DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
  FULL_ARENA_WIDTH,
  GAME_WIDTH,
  getArenaMetricsProfile,
  MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS,
  normalizeCoopDefenseArenaWidthCells,
} from '../src/config';
import { CAPTURE_THE_BEER_MODE, COOP_DEFENSE_MODE } from '../src/gameModes';

describe('Arena metrics profiles', () => {
  it('resolves default, intermediate and maximum Coop widths from grid cells', () => {
    expect(getArenaMetricsProfile(COOP_DEFENSE_MODE, 'ARENA')).toMatchObject({
      arenaWidth: FULL_ARENA_WIDTH,
      arenaOffsetX: 0,
      arenaViewportWidth: GAME_WIDTH,
      usesDynamicCamera: false,
      showStaticArenaFrames: false,
    });
    expect(getArenaMetricsProfile(COOP_DEFENSE_MODE, 'ARENA', 90)).toMatchObject({
      arenaWidth: 2_880,
      usesDynamicCamera: true,
    });
    expect(getArenaMetricsProfile(
      COOP_DEFENSE_MODE,
      'ARENA',
      MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS,
    )).toMatchObject({
      arenaWidth: CAPTURE_THE_BEER_ARENA_WIDTH,
      usesDynamicCamera: true,
    });
  });

  it('floors and clamps Coop width configuration to the supported grid range', () => {
    expect(normalizeCoopDefenseArenaWidthCells(undefined))
      .toBe(DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS);
    expect(normalizeCoopDefenseArenaWidthCells(59))
      .toBe(DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS);
    expect(normalizeCoopDefenseArenaWidthCells(90.9)).toBe(90);
    expect(normalizeCoopDefenseArenaWidthCells(136))
      .toBe(MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS);
  });

  it('does not change lobby, regular arena or Capture the Beer profiles', () => {
    expect(getArenaMetricsProfile(COOP_DEFENSE_MODE, 'LOBBY', 90)).toMatchObject({
      arenaWidth: DEFAULT_ARENA_WIDTH,
      usesDynamicCamera: false,
      showStaticArenaFrames: true,
    });
    expect(getArenaMetricsProfile('deathmatch', 'ARENA', 90)).toMatchObject({
      arenaWidth: FULL_ARENA_WIDTH,
      usesDynamicCamera: false,
    });
    expect(getArenaMetricsProfile(CAPTURE_THE_BEER_MODE, 'ARENA', 60)).toMatchObject({
      arenaWidth: CAPTURE_THE_BEER_ARENA_WIDTH,
      usesDynamicCamera: true,
    });
  });
});
