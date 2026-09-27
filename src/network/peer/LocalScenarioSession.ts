import { PeerRoom, type PeerRoomOptions } from './PeerRoom';
import { setActiveSession, type PeerSession } from './session';
import { isDevScenarioMode } from '../../utils/devScenarioMode';

/** Real room/RPC authority with no broker, links or multiplayer entry point. */
export async function createLocalScenarioSession(options: PeerRoomOptions): Promise<PeerSession> {
  if (!isDevScenarioMode()) throw new Error('Local scenario session requires the isolated dev entry.');
  const transport: PeerSession['transport'] = {
    isHost: true,
    setHandlers: () => {},
    start: async () => {},
    reconnect: async () => { throw new Error('Local scenarios cannot reconnect to peers.'); },
    destroy: () => {},
    getLinks: () => [],
  };
  const room = new PeerRoom(transport, options);
  await room.start();
  const session = { room, transport, roomCode: 'DEV' };
  setActiveSession(session);
  return session;
}
