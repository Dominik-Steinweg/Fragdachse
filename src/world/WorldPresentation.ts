import {
  requiresLocalWorldPresentation,
  type WorldParticipation,
} from './WorldParticipation';

/**
 * Lokale Darstellung einer World – getrennt von ihrer Simulation.
 *
 * Simulation und Presentation sind zwei Dinge. Ein Host kann eine Shared World autoritativ
 * simulieren, ohne selbst an ihr teilzunehmen; dann entsteht bei ihm ausdruecklich **keine**
 * lokale World-Presentation. "Host bleibt in der Lobby" heisst nicht, die World vollstaendig zu
 * rendern und die Lobby darueberzulegen, und auch nicht, einen unsichtbaren World-Render-Tree zu
 * halten.
 *
 * Nicht-rendernde Infrastruktur, die die Simulation technisch braucht, darf bestehen –
 * Physikdaten duerfen Phaser-gebunden bleiben, solange daraus keine Darstellung entsteht.
 *
 * Aus "keine Teilnahme" folgt trotzdem nicht "unsichtbar": eine World kann ihre Darstellung
 * ohne Teilnahme ausdruecklich erlauben. Die LobbyWorld tut genau das – sie ist zu sehen,
 * obwohl niemand in ihr steht.
 */

/** Was zur lokalen Darstellung einer World gehoert und ohne Teilnahme nicht entsteht. */
export type WorldPresentationSurface =
  | 'terrainSurfaces'
  | 'worldSprites'
  | 'worldCamera'
  | 'worldHud'
  | 'aim'
  | 'worldOverlays'
  | 'localPlayerVisuals';

export const WORLD_PRESENTATION_SURFACES: readonly WorldPresentationSurface[] = [
  'terrainSurfaces',
  'worldSprites',
  'worldCamera',
  'worldHud',
  'aim',
  'worldOverlays',
  'localPlayerVisuals',
];

/**
 * Wie dieser Peer die World lokal darstellt.
 *
 * `interactive` ist die Darstellung eines Teilnehmers: die vollstaendige Flaechenmenge
 * einschliesslich Weltkamera, World-HUD, Zielhilfe und eigener Spielfigur. `preview` zeigt
 * dieselbe World als Kulisse – Terrain, Weltobjekte und Overlays entstehen, aber der Peer steht
 * nicht in ihr: keine Figur, keine Weltkamera, kein World-Input.
 *
 * Preview ist ausdruecklich keine zweite Darstellungshierarchie, sondern dieselbe Darstellung
 * mit einer kleineren Flaechenmenge.
 */
export type WorldPresentationMode = 'none' | 'preview' | 'interactive';

/** Flaechen einer Preview: die Welt ist zu sehen, aber niemand steht in ihr. */
export const WORLD_PREVIEW_PRESENTATION_SURFACES: readonly WorldPresentationSurface[] = [
  'terrainSurfaces',
  'worldSprites',
  'worldOverlays',
];

export interface WorldPresentationRequirement {
  /** True, solange dieser Peer die World ueberhaupt lokal darstellt. */
  readonly required: boolean;
  /** Art der Darstellung; sie unterscheidet Teilnahme von blosser Sicht. */
  readonly mode: WorldPresentationMode;
  /** Die Flaechen, die dafuer entstehen duerfen. Ohne Darstellung ist die Liste leer. */
  readonly surfaces: readonly WorldPresentationSurface[];
}

const NO_PRESENTATION: WorldPresentationRequirement = { required: false, mode: 'none', surfaces: [] };

export interface WorldPresentationInput {
  /** Teilnahme dieses Peers an der World. */
  readonly participation: WorldParticipation;
  /** Eine World-Instanz mit lokaler Runtime existiert. */
  readonly worldActive: boolean;
  /**
   * Diese World erlaubt ihre Darstellung ausdruecklich auch ohne Teilnahme
   * ({@link import('../config/authoring/WorldDefinition').WorldPresentationPolicy}).
   *
   * Ohne diese Erlaubnis bleibt es beim Regelfall: keine Teilnahme, keine Darstellung. Sie wird
   * nie aus Raumzustand, Phase oder Activity erschlossen – nur die World selbst gibt sie.
   */
  readonly previewWithoutParticipation?: boolean;
}

/**
 * Entscheidet, ob und wie dieser Peer eine lokale World-Presentation besitzt.
 *
 * Die Simulation fragt hier nichts ab – sie laeuft unabhaengig davon weiter. Presentation darf
 * Simulation beobachten, aber nie deren Voraussetzung sein.
 */
export function resolveWorldPresentation(input: WorldPresentationInput): WorldPresentationRequirement {
  if (!input.worldActive) return NO_PRESENTATION;
  if (requiresLocalWorldPresentation(input.participation)) {
    return { required: true, mode: 'interactive', surfaces: WORLD_PRESENTATION_SURFACES };
  }
  if (input.previewWithoutParticipation === true) {
    return { required: true, mode: 'preview', surfaces: WORLD_PREVIEW_PRESENTATION_SURFACES };
  }
  return NO_PRESENTATION;
}

/** True, wenn diese Flaeche fuer den gegebenen Zustand lokal entstehen darf. */
export function allowsWorldPresentationSurface(
  requirement: WorldPresentationRequirement,
  surface: WorldPresentationSurface,
): boolean {
  return requirement.surfaces.includes(surface);
}
