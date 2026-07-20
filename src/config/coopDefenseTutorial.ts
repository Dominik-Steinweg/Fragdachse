import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  GAME_WIDTH,
  GRID_COLS,
  GRID_ROWS,
} from '../config';

export const COOP_DEFENSE_TUTORIAL_DURATION_MS = 20_000;
export const COOP_DEFENSE_TUTORIAL_PANEL_CENTER_X = GAME_WIDTH / 2;
export const COOP_DEFENSE_TUTORIAL_PANEL_TOP_Y = 118;
export const COOP_DEFENSE_TUTORIAL_PANEL_WIDTH = 840;
export const COOP_DEFENSE_TUTORIAL_PANEL_HEIGHT = 168;
export const COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS = 2;

export function getCoopDefenseTutorialRockRegion(): {
  minGridX: number;
  maxGridX: number;
  minGridY: number;
  maxGridY: number;
} {
  const left = COOP_DEFENSE_TUTORIAL_PANEL_CENTER_X - COOP_DEFENSE_TUTORIAL_PANEL_WIDTH / 2;
  const right = left + COOP_DEFENSE_TUTORIAL_PANEL_WIDTH;
  const top = COOP_DEFENSE_TUTORIAL_PANEL_TOP_Y;
  const bottom = top + COOP_DEFENSE_TUTORIAL_PANEL_HEIGHT;
  return {
    minGridX: Math.max(0, Math.floor((left - ARENA_OFFSET_X) / CELL_SIZE)),
    maxGridX: Math.min(GRID_COLS - 1, Math.ceil((right - ARENA_OFFSET_X) / CELL_SIZE) - 1),
    minGridY: Math.max(0, Math.floor((top - ARENA_OFFSET_Y) / CELL_SIZE)),
    maxGridY: Math.min(GRID_ROWS - 1, Math.ceil((bottom - ARENA_OFFSET_Y) / CELL_SIZE) - 1),
  };
}
