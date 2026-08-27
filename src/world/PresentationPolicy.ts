import type { RoundPlayerRole } from '../types';
import type { WorldPresentationMode, WorldPresentationRequirement } from './WorldPresentation';
import { allowsWorldPresentationSurface } from './WorldPresentation';

/**
 * Was die lokale Scene gerade zeigt.
 *
 * Die Scene soll nicht selbst zahlreiche Zustandskombinationen interpretieren. Stattdessen wird
 * aus Raumzustand, World-Zustand, lokaler World-Teilnahme, Activity-Zustand und Rundenrolle
 * genau eine Policy abgeleitet, die alle Darstellungsentscheidungen traegt.
 */
export interface PresentationPolicy {
  readonly showLobby: boolean;
  readonly showWorld: boolean;
  /**
   * Wie die sichtbare World dargestellt wird. `preview` bedeutet: die Welt ist zu sehen, aber
   * dieser Peer steht nicht in ihr – die Lobby bleibt darueber stehen, und nichts, was eine
   * Runde voraussetzt, wird gezeigt.
   */
  readonly worldMode: WorldPresentationMode;
  readonly showHud: boolean;
  readonly useWorldCamera: boolean;
  readonly useSpectatorCamera: boolean;
}

export interface PresentationPolicyInput {
  /** Raumzustand: der Peer steht in der Lobby, nicht in einer World. */
  readonly inLobby: boolean;
  /** Ob dieser Peer die World ueberhaupt lokal darstellt. */
  readonly worldPresentation: WorldPresentationRequirement;
  /** Die World ist sichtbar – Countdown laeuft oder die Runde blendet noch aus. */
  readonly worldVisible: boolean;
  /** Gameplay laeuft; davor bleiben HUD-Flaechen still. */
  readonly gameplayActive: boolean;
  /** Rundenrolle dieses Peers; ein Spectator fuehrt eine eigene Kamera. */
  readonly roundRole: RoundPlayerRole;
  /** Die Runde wurde technisch abgebrochen; danach gilt nur noch der Abbruchzustand. */
  readonly matchTerminated: boolean;
  /** Die aktive World erlaubt freies Schwenken fuer Zuschauer. */
  readonly spectatorPanAvailable: boolean;
}

const NOTHING: PresentationPolicy = {
  showLobby: false,
  showWorld: false,
  worldMode: 'none',
  showHud: false,
  useWorldCamera: false,
  useSpectatorCamera: false,
};

export function resolvePresentationPolicy(input: PresentationPolicyInput): PresentationPolicy {
  // Ein technischer Abbruch beendet jede Darstellung, bevor die Lobby sie wieder aufbaut.
  if (input.matchTerminated) return NOTHING;

  const showWorld = input.worldVisible && input.worldPresentation.required;
  const worldMode = showWorld ? input.worldPresentation.mode : 'none';
  // Nur wer in der World steht, verlaesst dafuer die Lobby. Eine Preview ersetzt sie nicht: die
  // LobbyWorld ist die Kulisse der Lobby, nicht ihr Nachfolger.
  const worldReplacesLobby = worldMode === 'interactive';
  const spectator = input.roundRole === 'spectator';
  return {
    // Eine World ohne Activity kann bei unveraenderter Room-Phase sichtbar sein. Betritt dieser
    // Peer sie, ersetzt ihre Presentation die Lobby; ein nicht teilnehmender Host behaelt sie.
    showLobby: input.inLobby && !worldReplacesLobby,
    showWorld,
    worldMode,
    showHud: worldReplacesLobby && input.gameplayActive,
    // Die Weltkamera ist selbst eine Darstellungsflaeche; ohne sie folgt nichts dem Spieler.
    useWorldCamera: showWorld
      && allowsWorldPresentationSurface(input.worldPresentation, 'worldCamera')
      && !spectator,
    useSpectatorCamera: worldReplacesLobby && spectator && input.spectatorPanAvailable,
  };
}
