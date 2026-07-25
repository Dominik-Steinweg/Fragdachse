/**
 * Steuerungsübersicht – gemeinsame Quelle für das Hilfe-Fenster (`ui/HelpOverlay`) und
 * das Tutorial-Fenster der Einstiegs-Map (`ui/CenterHUD`).
 *
 * Hier stehen ausschließlich Spieler-Steuerungen. Entwickler-Werkzeuge (Debug-Overlays,
 * Diagnose-Tasten) gehören bewusst nicht in diese Liste, weil sie in beiden Fenstern
 * sichtbar wären.
 */
export type HelpControlEntry = readonly [key: string, description: string];

export const HELP_CONTROLS: readonly HelpControlEntry[] = [
  ['W A S D',       'Bewegen'],
  ['LEERTASTE',     'Dash'],
  ['LINKE MAUST.',  'Weapon 1  (Treffer → Adrenalin)'],
  ['RECHTE MAUST.', 'Weapon 2  (kostet Adrenalin)'],
  ['E  (halten)',   'Utility'],
  ['Q',             'Ultimate  (füllt sich durch Schaden)'],
  ['SHIFT',         'Einbuddeln  (kostet Adrenalin)'],
  ['O',             'Optionen'],
];
