import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_WIDTH,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
} from '../config';
import { HELP_CONTROLS } from './helpControls';

export const COOP_DEFENSE_TUTORIAL_DURATION_MS = 20_000;

/** Feste Weltposition des Tutorials, unabhängig vom Screen-Space-HUD. */
const COOP_DEFENSE_TUTORIAL_PANEL_TOP_OFFSET_Y = 7 * CELL_SIZE;

export function getCoopDefenseTutorialPanelTopY(): number {
  return ARENA_OFFSET_Y + COOP_DEFENSE_TUTORIAL_PANEL_TOP_OFFSET_Y;
}
export const COOP_DEFENSE_TUTORIAL_PANEL_WIDTH = 840;
export const COOP_DEFENSE_TUTORIAL_PANEL_HEIGHT = 168;
export const COOP_DEFENSE_TUTORIAL_ROCK_HALO_CELLS = 2;

// ── Innenraster des Tutorial-Fensters ────────────────────────────────────────
// Die Maße sind fest verdrahtet statt aus gemessenem Text abgeleitet, weil die
// Arena-Generierung (Felsformation unter dem Fenster) dieselbe Höhe ohne Phaser
// und ohne Textmetrik kennen muss.
export const COOP_DEFENSE_TUTORIAL_PAD_X = 28;
export const COOP_DEFENSE_TUTORIAL_PAD_TOP = 18;
export const COOP_DEFENSE_TUTORIAL_TITLE_H = 22;
/** Reservierte Höhe des Fließtexts in der Steuerungs-Variante (bis zu 4 umgebrochene Zeilen). */
export const COOP_DEFENSE_TUTORIAL_CONTROLS_BODY_H = 124;
/** Überschrift „STEUERUNG" samt Trennlinie über der Tastenliste. */
export const COOP_DEFENSE_TUTORIAL_CONTROLS_HEADING_H = 40;
export const COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H = 30;
export const COOP_DEFENSE_TUTORIAL_CONTROLS_PAD_BOTTOM = 20;
/** Spaltenversatz der Tastenliste, gemessen vom linken Panelrand. */
export const COOP_DEFENSE_TUTORIAL_CONTROLS_KEY_X = 180;
export const COOP_DEFENSE_TUTORIAL_CONTROLS_DESC_X = 400;

/** Weltmitte der aktuell aktiven Arena; folgt den pro Map angewendeten Arena-Metriken. */
export function getCoopDefenseTutorialPanelCenterX(): number {
  return ARENA_OFFSET_X + ARENA_WIDTH / 2;
}

/**
 * Höhe des Tutorial-Fensters. Die Steuerungs-Variante (`showControls`) hängt die
 * Tastenliste des Hilfe-Fensters unter den Fließtext und ist dadurch deutlich höher.
 */
export function getCoopDefenseTutorialPanelHeight(showControls: boolean): number {
  if (!showControls) return COOP_DEFENSE_TUTORIAL_PANEL_HEIGHT;
  return COOP_DEFENSE_TUTORIAL_PAD_TOP
    + COOP_DEFENSE_TUTORIAL_TITLE_H
    + COOP_DEFENSE_TUTORIAL_CONTROLS_BODY_H
    + COOP_DEFENSE_TUTORIAL_CONTROLS_HEADING_H
    + HELP_CONTROLS.length * COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H
    + COOP_DEFENSE_TUTORIAL_CONTROLS_PAD_BOTTOM;
}

export function getCoopDefenseTutorialRockRegion(showControls = false): {
  minGridX: number;
  maxGridX: number;
  minGridY: number;
  maxGridY: number;
} {
  const left = getCoopDefenseTutorialPanelCenterX() - COOP_DEFENSE_TUTORIAL_PANEL_WIDTH / 2;
  const right = left + COOP_DEFENSE_TUTORIAL_PANEL_WIDTH;
  const top = getCoopDefenseTutorialPanelTopY();
  const bottom = top + getCoopDefenseTutorialPanelHeight(showControls);
  return {
    minGridX: Math.max(0, Math.floor((left - ARENA_OFFSET_X) / CELL_SIZE)),
    maxGridX: Math.min(GRID_COLS - 1, Math.ceil((right - ARENA_OFFSET_X) / CELL_SIZE) - 1),
    minGridY: Math.max(0, Math.floor((top - ARENA_OFFSET_Y) / CELL_SIZE)),
    maxGridY: Math.min(GRID_ROWS - 1, Math.ceil((bottom - ARENA_OFFSET_Y) / CELL_SIZE) - 1),
  };
}
