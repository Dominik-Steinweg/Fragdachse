/**
 * Signaling-Schicht: erzeugt den PeerJS-Peer, verwaltet den Raumcode und übersetzt
 * PeerJS-Fehler in Meldungen, die in der Lobby angezeigt werden können.
 *
 * PeerJS wird hier ausschließlich für Rendezvous, Offer/Answer und ICE genutzt.
 * Die Datenebene (Kanäle, Serialisierung, Backpressure) gehört PeerLink.
 */
import { Peer } from 'peerjs';
import type { PeerError, PeerOptions } from 'peerjs';
import {
  PEER_BROKER,
  PEER_BROKER_TIMEOUT_MS,
  PEER_ICE_SERVERS,
  PEER_ID_PREFIX,
  PEER_ROOM_CODE_LENGTH,
  PEER_ROOM_CODE_MAX_ATTEMPTS,
} from '../../config';

/** Crockford-Base32 ohne I, L, O und U – vermeidet Verwechslungen beim Vorlesen. */
const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type PeerFailureKind =
  | 'broker-unreachable'
  | 'host-not-found'
  | 'room-code-taken'
  | 'invalid-room-code'
  | 'browser-unsupported'
  | 'connection-failed'
  | 'relay-rejected'
  | 'protocol-mismatch'
  | 'host-left'
  | 'room-full'
  | 'resume-expired';

export class PeerNetworkError extends Error {
  constructor(readonly kind: PeerFailureKind, message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'PeerNetworkError';
  }
}

const FAILURE_MESSAGES: Record<PeerFailureKind, string> = {
  'invalid-room-code': 'Der Raumcode im Einladungslink ist ungültig.',
  'resume-expired': 'Die Wiederverbindungsfrist ist abgelaufen. Bitte erneut beitreten.',
  'broker-unreachable': 'Verbindungsserver nicht erreichbar. Internetverbindung prüfen und neu laden.',
  'host-not-found': 'Host nicht gefunden. Der Raum existiert nicht mehr oder der Code ist falsch.',
  'room-code-taken': 'Kein freier Raumcode verfügbar. Bitte neu laden.',
  'browser-unsupported': 'Dieser Browser unterstützt die benötigten WebRTC-Funktionen nicht.',
  'connection-failed': 'Direkte Verbindung zum Host nicht möglich. Netzwerk oder Firewall blockiert WebRTC.',
  'relay-rejected': 'Verbindung lief über einen Relay-Server und wurde abgelehnt (Konfigurationsfehler).',
  'protocol-mismatch': 'Host und Client haben unterschiedliche Spielversionen. Beide Seiten neu laden.',
  'host-left': 'Verbindung zum Host verloren.',
  'room-full': 'Der Raum ist voll.',
};

export function describePeerFailure(kind: PeerFailureKind): string {
  return FAILURE_MESSAGES[kind];
}

export function createPeerNetworkError(kind: PeerFailureKind, cause?: unknown): PeerNetworkError {
  return new PeerNetworkError(kind, FAILURE_MESSAGES[kind], cause);
}

/** Bildet einen PeerJS-Fehlertyp auf unsere Fehlerklassen ab. */
export function classifyPeerErrorType(type: string): PeerFailureKind {
  switch (type) {
    case 'unavailable-id':
      return 'room-code-taken';
    case 'peer-unavailable':
      return 'host-not-found';
    case 'browser-incompatible':
      return 'browser-unsupported';
    case 'webrtc':
      return 'connection-failed';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'ssl-unavailable':
    case 'invalid-key':
    case 'invalid-id':
    case 'disconnected':
    default:
      return 'broker-unreachable';
  }
}

export function generateRoomCode(): string {
  const bytes = new Uint8Array(PEER_ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  return code;
}

export function roomCodeToPeerId(roomCode: string): string {
  return `${PEER_ID_PREFIX}${roomCode.trim().toUpperCase()}`;
}

/** True, wenn der Code aus dem URL-Hash überhaupt ein gültiger Raumcode sein kann. */
export function isValidRoomCode(roomCode: string): boolean {
  if (roomCode.length !== PEER_ROOM_CODE_LENGTH) return false;
  for (const char of roomCode.toUpperCase()) {
    if (!ROOM_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

function buildPeerOptions(): PeerOptions {
  return {
    host: PEER_BROKER.host,
    port: PEER_BROKER.port,
    path: PEER_BROKER.path,
    key: PEER_BROKER.key,
    secure: PEER_BROKER.secure,
    debug: 0,
    // Muss explizit gesetzt sein: PeerJS' Default enthält TURN-Server.
    config: { iceServers: PEER_ICE_SERVERS },
  };
}

/**
 * Erzeugt einen Peer und wartet, bis der Broker die ID bestätigt hat.
 * `peerId === undefined` lässt den Broker eine ID vergeben (Client-Fall).
 */
function openPeer(peerId: string | undefined): Promise<Peer> {
  return new Promise<Peer>((resolve, reject) => {
    const peer = peerId === undefined ? new Peer(buildPeerOptions()) : new Peer(peerId, buildPeerOptions());
    let settled = false;

    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      peer.destroy();
      reject(createPeerNetworkError('broker-unreachable'));
    }, PEER_BROKER_TIMEOUT_MS);

    const finish = (): void => {
      settled = true;
      window.clearTimeout(timeout);
      peer.off('open', onOpen);
      peer.off('error', onError);
    };

    const onOpen = (): void => {
      if (settled) return;
      finish();
      resolve(peer);
    };

    const onError = (error: PeerError<string>): void => {
      if (settled) return;
      finish();
      peer.destroy();
      reject(createPeerNetworkError(classifyPeerErrorType(error.type), error));
    };

    peer.on('open', onOpen);
    peer.on('error', onError);
  });
}

export interface OpenedHostPeer {
  peer: Peer;
  roomCode: string;
}

/**
 * Host: belegt einen zufälligen Raumcode auf dem Broker. Bei Kollision (`unavailable-id`)
 * wird ein neuer Code gezogen – die PeerJS-Cloud teilt sich den ID-Namensraum mit allen
 * anderen Nutzern, deshalb ist eine Kollision möglich und nicht fatal.
 */
export async function openHostPeer(): Promise<OpenedHostPeer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PEER_ROOM_CODE_MAX_ATTEMPTS; attempt++) {
    const roomCode = generateRoomCode();
    try {
      const peer = await openPeer(roomCodeToPeerId(roomCode));
      return { peer, roomCode };
    } catch (error) {
      lastError = error;
      if (error instanceof PeerNetworkError && error.kind === 'room-code-taken') continue;
      throw error;
    }
  }
  throw createPeerNetworkError('room-code-taken', lastError);
}

/** Client: eigene ID wird vom Broker vergeben, sie ist rein transportintern. */
export function openClientPeer(): Promise<Peer> {
  return openPeer(undefined);
}
