/**
 * Drahtformat zwischen Host und Client.
 *
 * Alle Nachrichten sind JSON-Objekte mit dem Diskriminator `t`. Feldnamen sind
 * absichtlich kurz: Der Snapshot-Batch geht mit NET_TICK_RATE_HZ über die Leitung.
 *
 * Zuverlässigkeit wird NICHT im Envelope kodiert, sondern über den Kanal gewählt,
 * auf dem gesendet wird (siehe PeerLink). Der Host relayt eine Client-Nachricht
 * immer über denselben Kanaltyp, über den sie eingetroffen ist.
 */

/** Wird im Handshake verglichen; unterschiedliche Deploys dürfen sich nicht verbinden. */
export const PEER_PROTOCOL_VERSION = 1;

/** Kanaltyp eines Links. 'rel' = geordnet+zuverlässig, 'fast' = ungeordnet+ohne Retransmit. */
export type PeerChannelKind = 'rel' | 'fast';

/** Client → Host, erste Nachricht nach dem Öffnen des zuverlässigen Kanals. */
export interface HelloMessage {
  t: 'hello';
  /** Protokollversion des Clients. */
  v: number;
}

/** Ein Eintrag des Host-autoritativen Rosters. */
export interface RosterEntry {
  /** Spiel-seitige Spieler-ID (kurz, vom Host vergeben). */
  id: string;
}

/** Host → Client, Antwort auf `hello`. Enthält den vollständigen Store-Stand. */
export interface WelcomeMessage {
  t: 'welcome';
  v: number;
  /** Die dem Client zugewiesene Spieler-ID. */
  id: string;
  /** Spieler-ID des Hosts. */
  h: string;
  roster: RosterEntry[];
  /** Vollständiger globaler Store. */
  g: Record<string, unknown>;
  /** Vollständiger Per-Spieler-Store, außen nach Spieler-ID indiziert. */
  p: Record<string, Record<string, unknown>>;
}

/** Host → Client: ein weiterer Spieler ist beigetreten. */
export interface JoinMessage {
  t: 'join';
  id: string;
  /** Bereits bekannter Zustand des neuen Spielers (kann leer sein). */
  s: Record<string, unknown>;
}

/** Host → Client: ein Spieler hat den Raum verlassen. */
export interface QuitMessage {
  t: 'quit';
  id: string;
}

/**
 * Gebündelte Store-Schreibvorgänge.
 * `g` = globale Keys als [key, value], `p` = Per-Spieler-Keys als [playerId, key, value].
 * Innerhalb eines Batches gewinnt der letzte Eintrag pro Key (die Sendeseite dedupliziert bereits).
 */
export interface BatchMessage {
  t: 'b';
  g?: Array<[string, unknown]>;
  p?: Array<[string, string, unknown]>;
}

/**
 * RPC-Aufruf. `c` ist die Correlation-ID des Aufrufers (0 = keine Antwort erwartet).
 * `s` trägt die Absender-Spieler-ID und wird ausschließlich vom Host gesetzt,
 * wenn er einen Client-Aufruf an alle weiterreicht – ein Client kann sie nicht fälschen,
 * weil der Host eingehende `s`-Felder verwirft.
 */
export interface RpcMessage {
  t: 'rpc';
  c: number;
  n: string;
  d: unknown;
  s?: string;
}

/** Antwort auf einen RPC-Aufruf mit `c > 0`. */
export interface RpcResultMessage {
  t: 'res';
  c: number;
  d: unknown;
}

export type PeerMessage =
  | HelloMessage
  | WelcomeMessage
  | JoinMessage
  | QuitMessage
  | BatchMessage
  | RpcMessage
  | RpcResultMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function parseGlobalEntries(value: unknown): Array<[string, unknown]> | null {
  if (!Array.isArray(value)) return null;
  const entries: Array<[string, unknown]> = [];
  for (const raw of value) {
    if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== 'string') continue;
    entries.push([raw[0], raw[1]]);
  }
  return entries;
}

function parsePlayerEntries(value: unknown): Array<[string, string, unknown]> | null {
  if (!Array.isArray(value)) return null;
  const entries: Array<[string, string, unknown]> = [];
  for (const raw of value) {
    if (!Array.isArray(raw) || raw.length !== 3 || typeof raw[0] !== 'string' || typeof raw[1] !== 'string') continue;
    entries.push([raw[0], raw[1], raw[2]]);
  }
  return entries;
}

function parseRoster(value: unknown): RosterEntry[] | null {
  if (!Array.isArray(value)) return null;
  const roster: RosterEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id.length === 0) continue;
    roster.push({ id: raw.id });
  }
  return roster;
}

function parsePlayerStates(value: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(value)) return {};
  const result: Record<string, Record<string, unknown>> = {};
  for (const [playerId, state] of Object.entries(value)) {
    if (isPlainRecord(state)) result[playerId] = { ...state };
  }
  return result;
}

/**
 * Validiert eine eingehende Nachricht. Gibt `null` zurück, wenn sie unbrauchbar ist –
 * unbekannte oder fehlerhafte Nachrichten werden verworfen, nicht geworfen, damit ein
 * einzelnes kaputtes Paket den Link nicht beendet.
 */
export function parsePeerMessage(raw: unknown): PeerMessage | null {
  if (typeof raw !== 'string') return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.t !== 'string') return null;

  switch (value.t) {
    case 'hello': {
      if (!Number.isSafeInteger(value.v)) return null;
      return { t: 'hello', v: value.v as number };
    }
    case 'welcome': {
      if (!Number.isSafeInteger(value.v)
        || typeof value.id !== 'string' || value.id.length === 0
        || typeof value.h !== 'string' || value.h.length === 0) return null;
      const roster = parseRoster(value.roster);
      if (!roster) return null;
      return {
        t: 'welcome',
        v: value.v as number,
        id: value.id,
        h: value.h,
        roster,
        g: isPlainRecord(value.g) ? { ...value.g } : {},
        p: parsePlayerStates(value.p),
      };
    }
    case 'join': {
      if (typeof value.id !== 'string' || value.id.length === 0) return null;
      return { t: 'join', id: value.id, s: isPlainRecord(value.s) ? { ...value.s } : {} };
    }
    case 'quit': {
      if (typeof value.id !== 'string' || value.id.length === 0) return null;
      return { t: 'quit', id: value.id };
    }
    case 'b': {
      const message: BatchMessage = { t: 'b' };
      if (value.g !== undefined) {
        const entries = parseGlobalEntries(value.g);
        if (!entries) return null;
        if (entries.length > 0) message.g = entries;
      }
      if (value.p !== undefined) {
        const entries = parsePlayerEntries(value.p);
        if (!entries) return null;
        if (entries.length > 0) message.p = entries;
      }
      if (!message.g && !message.p) return null;
      return message;
    }
    case 'rpc': {
      if (!Number.isSafeInteger(value.c) || (value.c as number) < 0
        || typeof value.n !== 'string' || value.n.length === 0) return null;
      const message: RpcMessage = { t: 'rpc', c: value.c as number, n: value.n, d: value.d };
      if (typeof value.s === 'string' && value.s.length > 0) message.s = value.s;
      return message;
    }
    case 'res': {
      if (!Number.isSafeInteger(value.c) || (value.c as number) <= 0) return null;
      return { t: 'res', c: value.c as number, d: value.d };
    }
    default:
      return null;
  }
}

export function encodePeerMessage(message: PeerMessage): string {
  return JSON.stringify(message);
}
