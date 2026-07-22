/**
 * Einstiegspunkt der Netzwerk-Substratschicht.
 *
 * Nur diese Datei verdrahtet den PeerJS-Transport mit der Raumlogik; alles darüber
 * (NetworkBridge) kennt ausschließlich `PeerRoom`.
 */
import { PeerJsTransport } from './PeerJsTransport';
import { PeerRoom, type PeerRoomOptions } from './PeerRoom';

export interface PeerSession {
  room: PeerRoom;
  transport: PeerJsTransport;
  roomCode: string;
}

/** Eröffnet einen neuen Raum und belegt einen freien Raumcode auf dem Broker. */
export async function createHostSession(options: PeerRoomOptions = {}): Promise<PeerSession> {
  const { transport, roomCode } = await PeerJsTransport.createHost();
  const room = new PeerRoom(transport, options);
  try {
    await room.start();
  } catch (error) {
    room.destroy();
    throw error;
  }
  return { room, transport, roomCode };
}

/** Betritt einen bestehenden Raum. Löst erst auf, wenn der Host-Zustand vollständig da ist. */
export async function joinHostSession(roomCode: string, options: PeerRoomOptions = {}): Promise<PeerSession> {
  const transport = await PeerJsTransport.createClient(roomCode);
  const room = new PeerRoom(transport, options);
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
