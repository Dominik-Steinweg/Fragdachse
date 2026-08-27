import type { PlayerCapabilities } from './PlayerCapabilities';

/**
 * Was die lokale Eingabe gerade darf.
 *
 * Abgeleitet aus Teilnahme und Capabilities des Spielers, dem UI-Zustand und dem Zustand der
 * Activity – nicht aus einer handgemischten Bedingung, die an jeder Aufrufstelle erneut
 * zusammengesetzt wird.
 *
 * Die Policy ist rein lokal: sie steuert Eingabe-UX und Vorschau. Ob eine Handlung tatsaechlich
 * zaehlt, entscheidet der Host aus seinem eigenen Zustand ueber dieselben Capabilities.
 */
export interface InputPolicy {
  readonly movement: boolean;
  readonly combat: boolean;
  readonly placement: boolean;
  /** Handeln an Weltobjekten – auch waehrend des Countdowns, wo Bewegung noch ruht. */
  readonly worldInteraction: boolean;
  readonly cameraNavigation: boolean;
  /** Zielen bleibt im Countdown erlaubt, damit die Vorschau interaktiv ist. */
  readonly aim: boolean;
}

export interface InputPolicyInput {
  /** Was dieser Spieler in der World darf. */
  readonly capabilities: PlayerCapabilities;
  /** Die Runde laeuft; davor ruht die Simulation. */
  readonly gameplayActive: boolean;
  /** Der synchronisierte Startcountdown laeuft. */
  readonly countdownActive: boolean;
  /** Eine Oberflaeche nimmt die Eingabe entgegen (Optionsmenue, Overlay). */
  readonly uiBlocking: boolean;
  /** Interne Diagnose-Arena: sie fuehrt ihre Eingabe selbst. */
  readonly diagnosticsArena: boolean;
}

const NOTHING: InputPolicy = {
  movement: false,
  combat: false,
  placement: false,
  worldInteraction: false,
  cameraNavigation: false,
  aim: false,
};

export function resolveInputPolicy(input: InputPolicyInput): InputPolicy {
  const { capabilities } = input;
  // Kamerafuehrung bleibt auch dann, wenn sonst nichts erlaubt ist – Zusehen ist Eingabe genug.
  const cameraNavigation = capabilities.canControlCamera && !input.uiBlocking;
  if (input.uiBlocking) return { ...NOTHING, cameraNavigation };

  // Die Diagnose-Arena fuehrt ihre eigene Eingabe und sperrt deshalb das laufende Gameplay.
  const acting = input.gameplayActive && capabilities.canMove && !input.diagnosticsArena;
  // Der Countdown haelt Bewegung an, laesst Zielen und Weltinteraktion aber bewusst zu, damit
  // die Vorbereitungsphase bedienbar bleibt – auch in der Diagnose-Arena.
  const preparing = input.countdownActive && capabilities.canMove;
  return {
    movement: acting,
    combat: acting && capabilities.canUseCombat,
    placement: acting && capabilities.canPlace,
    worldInteraction: acting || preparing,
    cameraNavigation,
    aim: (acting || input.countdownActive) && capabilities.canMove && !input.diagnosticsArena,
  };
}
