import { PeerRoom, type PeerRoomOptions } from './PeerRoom';
import { setActiveSession, type PeerSession } from './session';
import { isDevScenarioMode } from '../../utils/devScenarioMode';
import { PEER_PROTOCOL_VERSION } from './protocol';
import type { PeerLinkLike, PeerTransportHandlers } from './transport';

let addLocalBotPeer: (() => string) | null = null;
const botPeerIds = new Set<string>();

/** True for scripted bot peers of the isolated dev scenario host. */
export function isLocalScenarioBotPeer(playerId: string): boolean {
  return botPeerIds.has(playerId);
}

/**
 * Dev scenario only: joins a scripted in-process peer through the normal host handshake.
 * The host treats it like any client; its client-owned state is written by the dev scenario.
 */
export function addLocalScenarioBotPeer(): string {
  if (!addLocalBotPeer) throw new Error('Bots require the local scenario session.');
  return addLocalBotPeer();
}

/** Real room/RPC authority with no broker, links or multiplayer entry point. */
export async function createLocalScenarioSession(options: PeerRoomOptions): Promise<PeerSession> {
  if (!isDevScenarioMode()) throw new Error('Local scenario session requires the isolated dev entry.');
  let handlers: PeerTransportHandlers | null = null;
  const transport: PeerSession['transport'] = {
    isHost: true,
    setHandlers: (value) => { handlers = value; },
    start: async () => {},
    reconnect: async () => { throw new Error('Local scenarios cannot reconnect to peers.'); },
    destroy: () => {},
    // Bot links carry no transport diagnostics.
    getLinks: () => [],
  };
  const room = new PeerRoom(transport, options);
  await room.start();
  let botSequence = 0;
  addLocalBotPeer = () => {
    if (!handlers) throw new Error('Local scenario transport is not started.');
    const active = handlers;
    const index = ++botSequence;
    const link: PeerLinkLike = {
      remotePeerId: `dev-bot-${index}`,
      playerId: '',
      // Host → bot traffic is discarded; heartbeats are answered so the link stays alive.
      send: (message) => { if (message.t === 'hb') queueMicrotask(() => active.onMessage(link, { t: 'hba' }, 'rel')); },
      close: () => {},
    };
    active.onLinkRegistered(link);
    active.onLinkReady(link);
    active.onMessage(link, { t: 'hello', v: PEER_PROTOCOL_VERSION, k: `dev-bot-${index}` }, 'rel');
    if (!link.playerId) throw new Error('Bot handshake was rejected.');
    botPeerIds.add(link.playerId);
    return link.playerId;
  };
  const session = { room, transport, roomCode: 'DEV' };
  setActiveSession(session);
  return session;
}
