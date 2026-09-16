import type { PeerRoomTransport, PeerTransportHandlers } from '../../network/peer/transport';
import type { DiagnosableLink } from '../../network/peer/TransportDiagnostics';
import { PeerRoom } from '../../network/peer/PeerRoom';
import { setActiveSession } from '../../network/peer/session';

/** Only imported by the lab entry. Normal boot always uses the real network. */
class LocalLabTransport implements PeerRoomTransport {
  readonly isHost = true;
  setHandlers(_handlers: PeerTransportHandlers): void {}
  async start(): Promise<void> {}
  async reconnect(): Promise<void> { throw new Error('The solo lab cannot reconnect a client.'); }
  destroy(): void {}
  getLinks(): DiagnosableLink[] { return []; }
}

export async function connectLocalNavigationLab(): Promise<void> {
  const transport = new LocalLabTransport();
  const room = new PeerRoom(transport);
  await room.start();
  setActiveSession({ room, transport, roomCode: 'NAVLAB' });
}
