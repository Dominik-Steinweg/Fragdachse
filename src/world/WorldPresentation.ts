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

export interface WorldPresentationRequirement {
  /** True, solange dieser Peer die World ueberhaupt lokal darstellt. */
  readonly required: boolean;
  /** Die Flaechen, die dafuer entstehen duerfen. Ohne Teilnahme ist die Liste leer. */
  readonly surfaces: readonly WorldPresentationSurface[];
}

const NO_PRESENTATION: WorldPresentationRequirement = { required: false, surfaces: [] };

export interface WorldPresentationInput {
  /** Teilnahme dieses Peers an der World. */
  readonly participation: WorldParticipation;
  /** Eine World-Instanz mit lokaler Runtime existiert. */
  readonly worldActive: boolean;
}

/**
 * Entscheidet, ob dieser Peer eine lokale World-Presentation besitzt.
 *
 * Die Simulation fragt hier nichts ab – sie laeuft unabhaengig davon weiter. Presentation darf
 * Simulation beobachten, aber nie deren Voraussetzung sein.
 */
export function resolveWorldPresentation(input: WorldPresentationInput): WorldPresentationRequirement {
  if (!input.worldActive) return NO_PRESENTATION;
  if (!requiresLocalWorldPresentation(input.participation)) return NO_PRESENTATION;
  return { required: true, surfaces: WORLD_PRESENTATION_SURFACES };
}

/** True, wenn diese Flaeche fuer den gegebenen Zustand lokal entstehen darf. */
export function allowsWorldPresentationSurface(
  requirement: WorldPresentationRequirement,
  surface: WorldPresentationSurface,
): boolean {
  return requirement.surfaces.includes(surface);
}
