import { describe, expect, it } from 'vitest';
import {
  CAPTURE_THE_BEER_ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_MAX_Y,
  ARENA_OFFSET_Y,
  DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
  FULL_ARENA_WIDTH,
  GRID_COLS,
  GRID_ROWS,
  GAME_WIDTH,
  getArenaMetricsProfile,
  MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS,
  CELL_SIZE,
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
      arenaHeight: DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS * CELL_SIZE,
      arenaOffsetY: ARENA_OFFSET_Y,
      usesDynamicCamera: false,
      showStaticArenaFrames: false,
    });
    const intermediateWidthCells = 90;
    expect(getArenaMetricsProfile(COOP_DEFENSE_MODE, 'ARENA', intermediateWidthCells)).toMatchObject({
      arenaWidth: intermediateWidthCells * CELL_SIZE,
      arenaHeight: DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS * CELL_SIZE,
      usesDynamicCamera: true,
    });
    const expandedHeightCells = 52;
    expect(getArenaMetricsProfile(COOP_DEFENSE_MODE, 'ARENA', undefined, expandedHeightCells)).toMatchObject({
      arenaWidth: FULL_ARENA_WIDTH,
      arenaHeight: expandedHeightCells * CELL_SIZE,
      arenaViewportHeight: DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS * CELL_SIZE,
      usesDynamicCamera: true,
    });
    expect(getArenaMetricsProfile(COOP_DEFENSE_MODE, 'ARENA', intermediateWidthCells, expandedHeightCells)).toMatchObject({
      arenaWidth: intermediateWidthCells * CELL_SIZE,
      arenaHeight: expandedHeightCells * CELL_SIZE,
      usesDynamicCamera: true,
    });
    expect(getArenaMetricsProfile(
      COOP_DEFENSE_MODE,
      'ARENA',
      MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS,
    )).toMatchObject({
      arenaWidth: MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS * CELL_SIZE,
      usesDynamicCamera: true,
    });
  });

  /**
   * Die Stressgroesse aus Block A. Sie lag frueher jenseits beider Coop-Grenzen: 400 Spalten ueber
   * der aus der CTB-Breite abgeleiteten 135, 80 Zeilen ueber der aus arenagrossen Render- und
   * Sampler-Puffern abgeleiteten 56. Beide Ursachen sind entfallen, die Groesse muss deshalb
   * unveraendert durchkommen – ein stilles Zurueckklemmen waere im Spiel eine andere Karte.
   */
  it('activates the 400 x 80 stress size without clamping it back', () => {
    expect(normalizeCoopDefenseArenaWidthCells(400)).toBe(400);
    expect(normalizeCoopDefenseArenaHeightCells(80)).toBe(80);

    expect(getArenaMetricsProfile(COOP_DEFENSE_MODE, 'ARENA', 400, 80)).toMatchObject({
      arenaWidth: 400 * CELL_SIZE,
      arenaHeight: 80 * CELL_SIZE,
      arenaOffsetX: 0,
      arenaViewportWidth: GAME_WIDTH,
      usesDynamicCamera: true,
      showStaticArenaFrames: false,
    });

    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', 400, 80);
    try {
      expect(GRID_COLS).toBe(400);
      expect(GRID_ROWS).toBe(80);
      expect(ARENA_HEIGHT).toBe(80 * CELL_SIZE);
      expect(ARENA_MAX_Y).toBe(ARENA_OFFSET_Y + 80 * CELL_SIZE);
    } finally {
      applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'LOBBY');
    }
  });

  /**
   * Die verbliebene Obergrenze ist eine technische Grenze der Datenstrukturen, kein Designmass –
   * und sie darf nicht aus der Testgroesse abgeleitet sein, sonst waere 400 x 80 stillschweigend
   * zum neuen Hard-Limit geworden.
   */
  it('keeps its remaining cap well above the stress size on both axes', () => {
    expect(MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS).toBeGreaterThan(400);
    expect(MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS).toBeGreaterThan(80);
    // Beide Achsen bleiben unter dem Stride, mit dem `rockCellKey` sie in eine Zahl packt.
    expect(MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS).toBeLessThan(1 << 16);
    expect(MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS).toBeLessThan(1 << 16);
  });

  it('floors and clamps Coop width configuration to the supported grid range', () => {
    expect(normalizeCoopDefenseArenaWidthCells(undefined))
      .toBe(DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS);
    expect(normalizeCoopDefenseArenaWidthCells(59))
      .toBe(DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS);
    expect(normalizeCoopDefenseArenaWidthCells(90.9)).toBe(90);
    // 136 war frueher der erste geklemmte Wert; heute ist es ein gueltiges Mass.
    expect(normalizeCoopDefenseArenaWidthCells(136)).toBe(136);
    expect(normalizeCoopDefenseArenaWidthCells(MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS + 1))
      .toBe(MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS);
  });

  it('keeps legacy height, floors explicit values and clamps the supported range', () => {
    expect(normalizeCoopDefenseArenaHeightCells(undefined))
      .toBe(DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS);
    expect(normalizeCoopDefenseArenaHeightCells(32.9))
      .toBe(DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS);
    expect(normalizeCoopDefenseArenaHeightCells(52.9)).toBe(52);
    // 100 lag frueher ueber der 56-Zeilen-Grenze; heute ist es ein gueltiges Mass.
    expect(normalizeCoopDefenseArenaHeightCells(100)).toBe(100);
    expect(normalizeCoopDefenseArenaHeightCells(MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS + 1))
      .toBe(MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS);
  });

  it('propagates runtime height into world bounds and grid rows', () => {
    const widthCells = 90;
    const heightCells = 52;
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', widthCells, heightCells);
    expect(ARENA_HEIGHT).toBe(heightCells * CELL_SIZE);
    expect(GRID_ROWS).toBe(heightCells);
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
        arenaHeight: DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS * CELL_SIZE,
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
