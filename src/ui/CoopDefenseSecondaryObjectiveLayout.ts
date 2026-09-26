import { GAME_WIDTH } from '../config';
import { SECONDARY_OBJECTIVE_MAX_CHIPS } from './coopDefenseSecondaryObjectiveModel';

/**
 * Gemeinsamer Bildschirm-Layoutvertrag für Hauptziel, Wellen, Nebenmissionen und rechte
 * Seitenspalte. Die Datei besitzt bewusst keine HUD-Imports: CenterHUD und Nebenziel-HUD
 * beziehen ihre Positionen beide von hier, ohne einen zyklischen Modulpfad aufzubauen.
 *
 * Die Karten sind Waldboden-Rahmen (`HudCard`) mit fester Quellhöhe von 98 px; `scale` legt
 * damit Höhe und Rahmenstärke fest. Alle Karten der Spalte teilen Breite und rechte Kante.
 */
const PANEL_WIDTH = 340;
const RIGHT_MARGIN = 14;
const PANEL_CENTER_X = GAME_WIDTH - PANEL_WIDTH / 2 - RIGHT_MARGIN;
const STACK_TOP_Y = 10;
/**
 * Die Rahmen tragen oben und unten transparente Polster (Efeu, Schatten); die sichtbaren
 * Abstände entstehen daraus. Ein zusätzlicher Spalt ließe die Spalte zerfallen.
 */
const STACK_GAP = 2;
const CARD_SOURCE_HEIGHT = 98;
const CARD_SCALE = 0.5;
const CHIP_SCALE = 0.36;
const CARD_HEIGHT = CARD_SOURCE_HEIGHT * CARD_SCALE;
const CHIP_HEIGHT = CARD_SOURCE_HEIGHT * CHIP_SCALE;

/** Screen-Space-Layout des serialisierten Coop-Objective-Ankündigungskanals. */
export const COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT = {
  centerY: 196,
  /** Karte plus Detailzeile darunter. */
  height: 112,
  width: 560,
  cardScale: 0.8,
  entryOffsetY: 12,
} as const;

export const COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT = {
  centerX: PANEL_CENTER_X,
  topY: STACK_TOP_Y,
  width: PANEL_WIDTH,
  height: CARD_HEIGHT,
  scale: CARD_SCALE,
} as const;

export const COOP_DEFENSE_ENCOUNTER_LAYOUT = {
  centerX: PANEL_CENTER_X,
  topY: COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT.topY
    + COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT.height
    + STACK_GAP,
  width: PANEL_WIDTH,
  height: CARD_HEIGHT,
  scale: CARD_SCALE,
} as const;

export const COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT = {
  panelWidth: PANEL_WIDTH,
  panelHeight: CARD_HEIGHT,
  panelScale: CARD_SCALE,
  chipHeight: CHIP_HEIGHT,
  chipScale: CHIP_SCALE,
  rowGap: 0,
  columnTopY: COOP_DEFENSE_ENCOUNTER_LAYOUT.topY
    + COOP_DEFENSE_ENCOUNTER_LAYOUT.height
    + STACK_GAP,
  columnCenterX: PANEL_CENTER_X,
} as const;

export const COOP_DEFENSE_SECONDARY_OBJECTIVE_STACK_BOTTOM_Y =
  COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT.columnTopY
  + COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT.panelHeight
  + SECONDARY_OBJECTIVE_MAX_CHIPS
    * (COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT.chipHeight
      + COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT.rowGap);
