/**
 * Steuerungsübersicht – gemeinsame Quelle für das Hilfe-Fenster (`ui/HelpOverlay`) und
 * das Tutorial-Fenster der Einstiegs-Map (`ui/CenterHUD`).
 *
 * Hier stehen ausschließlich Spieler-Steuerungen. Entwickler-Werkzeuge (Debug-Overlays,
 * Diagnose-Tasten) gehören bewusst nicht in diese Liste, weil sie in beiden Fenstern
 * sichtbar wären.
 */
export interface HelpControlEntry {
  readonly keyId: string;
  readonly descriptionKey: string;
}

export const HELP_CONTROLS: readonly HelpControlEntry[] = [
  { keyId: 'ui.help.wasd', descriptionKey: 'ui.help.move' },
  { keyId: 'ui.help.space', descriptionKey: 'ui.help.dash' },
  { keyId: 'ui.help.leftMouse', descriptionKey: 'ui.help.weapon1' },
  { keyId: 'ui.help.rightMouse', descriptionKey: 'ui.help.weapon2' },
  { keyId: 'ui.help.holdE', descriptionKey: 'ui.help.utility' },
  { keyId: 'ui.help.holdR', descriptionKey: 'ui.help.utilityWheel' },
  { keyId: 'ui.help.q', descriptionKey: 'ui.help.ultimate' },
  { keyId: 'ui.help.shift', descriptionKey: 'ui.help.burrow' },
  { keyId: 'ui.help.o', descriptionKey: 'ui.help.options' },
];
