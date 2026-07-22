/**
 * Einstiegspunkt der Netzwerk-Substratschicht.
 *
 * Nur diese Datei verdrahtet den PeerJS-Transport mit der Raumlogik; alles darüber
 * (NetworkBridge) kennt ausschließlich `PeerRoom`.
 */
import { PeerJsTransport } from './PeerJsTransport';
import { PeerRoom, type PeerRoomOptions } from './PeerRoom';
import { setActiveSession, type PeerSession } from './session';

/** Eröffnet einen neuen Raum und belegt einen freien Raumcode auf dem Broker. */
export async function createHostSession(options: PeerRoomOptions = {}): Promise<PeerSession> {
  const { transport, roomCode } = await PeerJsTransport.createHost();
  const session = await startSession(new PeerRoom(transport, options), transport, roomCode);
  setActiveSession(session);
  return session;
}

/** Betritt einen bestehenden Raum. Löst erst auf, wenn der Host-Zustand vollständig da ist. */
export async function joinHostSession(roomCode: string, options: PeerRoomOptions = {}): Promise<PeerSession> {
  const transport = await PeerJsTransport.createClient(roomCode);
  const session = await startSession(new PeerRoom(transport, options), transport, roomCode);
  setActiveSession(session);
  return session;
}

async function startSession(room: PeerRoom, transport: PeerJsTransport, roomCode: string): Promise<PeerSession> {
  try {
    await room.start();
  } catch (error) {
    room.destroy();
    throw error;
  }
  return { room, transport, roomCode };
}

export { PeerRoom } from './PeerRoom';
export type { PeerPlayerHandle, PeerRoomOptions, PeerRpcHandler } from './PeerRoom';
export { PeerJsTransport } from './PeerJsTransport';
export { PeerLink } from './PeerLink';
export {
  PeerNetworkError,
  describePeerFailure,
  generateRoomCode,
  isValidRoomCode,
  roomCodeToPeerId,
  type PeerFailureKind,
} from './PeerSignaling';
export { PEER_PROTOCOL_VERSION } from './protocol';
export {
  clearActiveSession,
  getActiveSession,
  hasActiveSession,
  requireRoom,
  type PeerSession,
} from './session';
