import type { WorldParticipation } from './WorldParticipation';
import type { WorldPresentationRequirement } from './WorldPresentation';

/**
 * Entscheidet, ob dieser Peer den laufenden World-State konsumiert.
 *
 * Teilnahme und Darstellung sind absichtlich zwei getrennte Gruende: Ein Teilnehmer braucht
 * Replikation fuer seine Runtime, eine Preview fuer die Darstellung derselben laufenden World.
 * Aus `Participation: none` folgt deshalb nicht automatisch, dass World-Replikation verworfen
 * werden darf.
 */
export function consumesWorldReplication(input: {
  readonly worldActive: boolean;
  readonly participation: WorldParticipation;
  readonly presentation: WorldPresentationRequirement;
}): boolean {
  if (!input.worldActive) return false;
  return input.participation !== 'none' || input.presentation.required;
}
