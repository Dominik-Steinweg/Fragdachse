import { GAME_WIDTH } from '../config';
import { SECONDARY_OBJECTIVE_MAX_CHIPS } from './coopDefenseSecondaryObjectiveModel';

/**
 * Gemeinsamer Bildschirm-Layoutvertrag für Hauptziel, Wellen, Nebenmissionen und rechte
 * Seitenspalte. Die Datei besitzt bewusst keine HUD-Imports: CenterHUD und Nebenziel-HUD
 * beziehen ihre Positionen beide von hier, ohne einen zyklischen Modulpfad aufzubauen.
 */
const PANEL_WIDTH = 400;
const PANEL_CENTER_X = GAME_WIDTH - PANEL_WIDTH / 2 - 24;
const STACK_TOP_Y = 22;
const STACK_GAP = 8;

export const COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT = {
  centerX: PANEL_CENTER_X,
  topY: STACK_TOP_Y,
  width: PANEL_WIDTH,
  height: 64,
} as const;

export const COOP_DEFENSE_ENCOUNTER_LAYOUT = {
  centerX: PANEL_CENTER_X,
  topY: COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT.topY
    + COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT.height
    + STACK_GAP,
  width: PANEL_WIDTH,
  height: 84,
} as const;

export const COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT = {
  panelWidth: PANEL_WIDTH,
  panelHeight: 64,
  chipHeight: 34,
  rowGap: 6,
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
