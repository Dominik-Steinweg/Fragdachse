/**
 * Teilnahme eines Spielers an einer World.
 *
 * Ein eigener host-autoritaerer Lebenszyklus neben der Rundenrolle. Er beantwortet
 * ausschliesslich weltbezogene Fragen: Besitzt der Spieler einen Runtime-Eintrag in dieser
 * World? Darf er World Input senden? Konsumiert er World Replication? Braucht er eine lokale
 * World-Presentation?
 *
 * `Lobby` ist ausdruecklich **kein** Participation-State: wer in der Lobby steht, nimmt an
 * keiner World teil – das ist `none`.
 *
 * Die Rundenrolle bleibt davon getrennt. Ein Missions-Spectator ist in der World `observer` und
 * in der Runde `spectator`; beides zusammenzulegen wuerde die Editor-World unmoeglich machen,
 * die gar keine Runde besitzt.
 */
export type WorldParticipation = 'none' | 'joining' | 'interactive' | 'observer' | 'leaving';

export interface WorldParticipationInput {
  /** Eine World-Instanz laeuft, an der ueberhaupt teilgenommen werden kann. */
  readonly worldActive: boolean;
  /** Host-autoritative Zugehoerigkeit zu dieser World. */
  readonly admitted: boolean;
  /** Die lokale Runtime des Spielers steht in dieser World. */
  readonly hasRuntimeEntry: boolean;
  /** Der Spieler darf in dieser World handeln. */
  readonly mayAct: boolean;
  /** Der Spieler wird gerade aus der World geloest. */
  readonly leaving?: boolean;
}

export function resolveWorldParticipation(input: WorldParticipationInput): WorldParticipation {
  if (!input.worldActive || !input.admitted) return 'none';
  if (input.leaving === true) return 'leaving';
  if (!input.hasRuntimeEntry) return 'joining';
  return input.mayAct ? 'interactive' : 'observer';
}

/** Besitzt der Spieler einen Runtime-Eintrag in dieser World? */
export function hasWorldRuntimeEntry(participation: WorldParticipation): boolean {
  return participation === 'interactive' || participation === 'observer' || participation === 'leaving';
}

/** Darf der Spieler World Input senden? Nur eine vollwertige Teilnahme handelt. */
export function maySendWorldInput(participation: WorldParticipation): boolean {
  return participation === 'interactive';
}

/** Konsumiert der Spieler World Replication? Auch wer noch laedt oder nur zusieht. */
export function consumesWorldReplication(participation: WorldParticipation): boolean {
  return participation !== 'none';
}

/** Braucht dieser Peer eine lokale World-Presentation? */
export function requiresLocalWorldPresentation(participation: WorldParticipation): boolean {
  return participation !== 'none';
}
