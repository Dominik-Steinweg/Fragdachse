import { describe, expect, it } from 'vitest';
import {
  CAPTURE_THE_BEER_ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_MAX_Y,
  ARENA_OFFSET_Y,
  DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
  FULL_ARENA_WIDTH,
  GRID_ROWS,
  GAME_WIDTH,
  getArenaMetricsProfile,
  MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS,
  normalizeCoopDefenseArenaHeightCells,
  normalizeCoopDefenseArenaWidthCells,
  applyArenaMetricsForMode,
} from '../src/config';
import { CAPTURE_THE_BEER_MODE, COOP_DEFENSE_MODE } from '../src/gameModes';

describe('Arena metrics profiles', () => {
  it('resolves default, intermediate and maximum Coop widths from grid cells', () => {
    expect(getArenaMetricsProfile(COOP_DEFENSE_MODE, 'ARENA')).toMatchObject({
      arenaWidth: FULL_ARENA_WIDTH,
      arenaOffsetX: 0,
      arenaViewportWidth: GAME_WIDTH,
      arenaHeight: 1056,
      arenaOffsetY: ARENA_OFFSET_Y,
      usesDynamicCamera: false,
      showStaticArenaFrames: false,
    });
    expect(getArenaMetricsProfile(COOP_DEFENSE_MODE, 'ARENA', 90)).toMatchObject({
      arenaWidth: 2_880,
      arenaHeight: 1_056,
      usesDynamicCamera: true,
    });
    expect(getArenaMetricsProfile(COOP_DEFENSE_MODE, 'ARENA', undefined, 52)).toMatchObject({
      arenaWidth: FULL_ARENA_WIDTH,
      arenaHeight: 1_664,
      arenaViewportHeight: 1_056,
      usesDynamicCamera: true,
    });
    expect(getArenaMetricsProfile(COOP_DEFENSE_MODE, 'ARENA', 90, 52)).toMatchObject({
      arenaWidth: 2_880,
      arenaHeight: 1_664,
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

  it('keeps legacy height, floors explicit values and clamps the supported range', () => {
    expect(normalizeCoopDefenseArenaHeightCells(undefined))
      .toBe(DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS);
    expect(normalizeCoopDefenseArenaHeightCells(32.9))
      .toBe(DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS);
    expect(normalizeCoopDefenseArenaHeightCells(52.9)).toBe(52);
    expect(normalizeCoopDefenseArenaHeightCells(100))
      .toBe(MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS);
  });

  it('propagates runtime height into world bounds and grid rows', () => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', 90, 52);
    expect(ARENA_HEIGHT).toBe(1_664);
    expect(GRID_ROWS).toBe(52);
    expect(ARENA_MAX_Y).toBe(ARENA_OFFSET_Y + ARENA_HEIGHT);
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'LOBBY');
  });

  it('gives the lobby the same arena as deathmatch, regardless of mode or configured size', () => {
    // Die Lobby-Inszenierung spielt auf der Flaeche, die die Vorschau zeigt: volle Breite,
    // keine Seitenbalken, nur die schmalen Streifen oben und unten bleiben aussen vor.
    for (const mode of [COOP_DEFENSE_MODE, CAPTURE_THE_BEER_MODE, 'deathmatch'] as const) {
      expect(getArenaMetricsProfile(mode, 'LOBBY', 90, 52)).toMatchObject({
        arenaWidth: FULL_ARENA_WIDTH,
        arenaOffsetX: 0,
        arenaViewportWidth: GAME_WIDTH,
        arenaHeight: 1056,
        arenaOffsetY: ARENA_OFFSET_Y,
        usesDynamicCamera: false,
        showStaticArenaFrames: false,
      });
    }
    expect(getArenaMetricsProfile('deathmatch', 'LOBBY'))
      .toEqual(getArenaMetricsProfile('deathmatch', 'ARENA'));
  });

  it('does not change regular arena or Capture the Beer profiles', () => {
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
