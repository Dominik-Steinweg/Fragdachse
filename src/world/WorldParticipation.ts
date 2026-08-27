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
  // Wer nicht handeln darf, sieht zu - und braucht dafuer keinen eigenen Runtime-Eintrag. Ein
  // Zuschauer steht in der World, ohne je eine Figur zu bekommen; ihn als `joining` zu fuehren
  // hiesse, auf einen Eintrag zu warten, der nie entsteht.
  if (!input.mayAct) return 'observer';
  return input.hasRuntimeEntry ? 'interactive' : 'joining';
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

// ── Kanonische, replizierte Quelle ───────────────────────────────────────────

/**
 * Der host-autoritative Teilnahmestand einer World-Instanz.
 *
 * Teilnahme wird **nicht** aus Rundenzustaenden rekonstruiert. Sie ist ein eigener, replizierter
 * World-Kanal: der Host schreibt ihn, alle Peers lesen denselben Wert. Damit kann eine World
 * Teilnehmer haben, ohne dass eine Runde existiert – und ein Host kann eine World simulieren,
 * ohne selbst in ihr zu stehen.
 *
 * Der Stand gilt nur fuer genau die World-Instanz, aus der er stammt. Ein verspaetetes reliable
 * Paket der Vorinstanz traegt eine kleinere `worldRevision` und wird beim Lesen verworfen.
 */
export interface WorldParticipationState {
  readonly worldRevision: number;
  readonly participants: Readonly<Record<string, WorldParticipation>>;
}

const PARTICIPATION_VALUES: readonly WorldParticipation[] =
  ['none', 'joining', 'interactive', 'observer', 'leaving'];

export function isWorldParticipation(value: unknown): value is WorldParticipation {
  return typeof value === 'string' && PARTICIPATION_VALUES.includes(value as WorldParticipation);
}

/**
 * Liest den Teilnahmestand einer World-Instanz.
 *
 * Gibt `null` zurueck, wenn der Stand fehlt, unlesbar ist oder zu einer anderen World-Instanz
 * gehoert – die Entscheidung darueber faellt hier einmal und nicht an jeder Aufrufstelle.
 */
export function parseWorldParticipationState(
  raw: unknown,
  worldRevision: number,
): WorldParticipationState | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as { r?: unknown; p?: unknown };
  if (typeof source.r !== 'number' || !Number.isFinite(source.r)) return null;
  if (source.r !== worldRevision) return null;
  if (!source.p || typeof source.p !== 'object') return null;
  const participants: Record<string, WorldParticipation> = {};
  for (const [playerId, value] of Object.entries(source.p as Record<string, unknown>)) {
    if (playerId.length > 0 && isWorldParticipation(value)) participants[playerId] = value;
  }
  return { worldRevision: source.r, participants };
}

/** Serialisiert den Teilnahmestand fuer den Draht. */
export function encodeWorldParticipationState(state: WorldParticipationState): unknown {
  return { r: state.worldRevision, p: { ...state.participants } };
}

/** Die Teilnahme eines einzelnen Spielers; wer nicht eingetragen ist, nimmt nicht teil. */
export function readWorldParticipation(
  state: WorldParticipationState | null,
  playerId: string,
): WorldParticipation {
  return state?.participants[playerId] ?? 'none';
}

/** Alle Spieler, die an dieser World teilnehmen – in stabiler Reihenfolge. */
export function listWorldParticipants(state: WorldParticipationState | null): readonly string[] {
  if (!state) return [];
  return Object.keys(state.participants)
    .filter((id) => state.participants[id] !== 'none')
    .sort();
}
