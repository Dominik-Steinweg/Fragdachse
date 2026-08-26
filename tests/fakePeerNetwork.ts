import { PeerRoom, type PeerPlayerHandle } from '../src/network/peer/PeerRoom';
import type { PeerNetworkError } from '../src/network/peer/PeerSignaling';
import {
  encodePeerMessage,
  parsePeerMessage,
  type PeerChannelKind,
  type PeerMessage,
} from '../src/network/peer/protocol';
import type { PeerLinkLike, PeerRoomTransport, PeerTransportHandlers } from '../src/network/peer/transport';

/**
 * In-Memory-Transport: verdrahtet mehrere PeerRoom-Instanzen ohne WebRTC.
 * Nachrichten laufen durch echte Kodierung und Validierung, damit die Tests dasselbe
 * Drahtformat treffen wie der Browser. Zustellung ist synchron, weil die getestete Logik
 * reihenfolge- und nicht zeitgesteuert ist.
 */
export class FakeLink implements PeerLinkLike {
  playerId = '';
  closed = false;
  fastReady = false;
  counterpart!: FakeLink;
  owner!: FakeTransport;
  readonly sent: Array<{ message: PeerMessage; channel: PeerChannelKind }> = [];

  constructor(readonly remotePeerId: string) {}

  send(message: PeerMessage, channel: PeerChannelKind): void {
    this.sent.push({ message, channel });
    if (this.closed || this.counterpart.closed) return;
    if (channel === 'fast' && !this.fastReady) return;
    const decoded = parsePeerMessage(encodePeerMessage(message));
    if (!decoded) throw new Error(`Nachricht überlebt die Kodierung nicht: ${JSON.stringify(message)}`);
    this.counterpart.owner.handlers?.onMessage(this.counterpart, decoded, channel);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.counterpart.closed = true;
    this.owner.handlers?.onLinkClosed(this);
    this.counterpart.owner.handlers?.onLinkClosed(this.counterpart);
  }
}

export class FakeTransport implements PeerRoomTransport {
  handlers: PeerTransportHandlers | null = null;
  readonly links: FakeLink[] = [];
  reconnectEnabled = true;

  constructor(readonly isHost: boolean, readonly peerId: string, private readonly network: FakeNetwork) {}

  setHandlers(handlers: PeerTransportHandlers): void {
    this.handlers = handlers;
  }

  async start(): Promise<void> {
    if (this.isHost) return;
    this.network.connectClient(this);
  }

  async reconnect(): Promise<void> {
    if (this.isHost) return;
    if (!this.reconnectEnabled) throw new Error('Reconnect disabled by test');
    this.network.connectClient(this);
  }

  getLinks(): FakeLink[] {
    return this.links;
  }

  destroy(): void {
    this.handlers = null;
  }
}

export class FakeNetwork {
  hostTransport: FakeTransport | null = null;
  afterLinksRegistered: (() => void) | null = null;
  private nextClient = 1;

  createHostTransport(): FakeTransport {
    this.hostTransport = new FakeTransport(true, 'host-peer', this);
    return this.hostTransport;
  }

  createClientTransport(): FakeTransport {
    return new FakeTransport(false, `client-peer-${this.nextClient++}`, this);
  }

  connectClient(clientTransport: FakeTransport): void {
    const host = this.hostTransport;
    if (!host) throw new Error('Kein Host im Testnetz');

    const hostSide = new FakeLink(clientTransport.peerId);
    const clientSide = new FakeLink(host.peerId);
    hostSide.counterpart = clientSide;
    clientSide.counterpart = hostSide;
    hostSide.owner = host;
    clientSide.owner = clientTransport;
    host.links.push(hostSide);
    clientTransport.links.push(clientSide);

    // Bildet bewusst den ungünstigsten realen Ablauf nach: der Client ist zuerst fertig und
    // schickt sein 'hello', während der Host seinen Link noch öffnet. Der Host muss den Link
    // deshalb schon beim Anmelden kennen – sonst verpasst der neue Spieler alles, was der Host
    // während des Handshakes veröffentlicht.
    host.handlers?.onLinkRegistered(hostSide);
    clientTransport.handlers?.onLinkRegistered(clientSide);
    this.afterLinksRegistered?.();
    clientSide.fastReady = true;
    clientTransport.handlers?.onLinkReady(clientSide);
    hostSide.fastReady = true;
    host.handlers?.onLinkReady(hostSide);
  }
}

export class SilentLink implements PeerLinkLike {
  playerId = '';
  closed = false;
  readonly sent: Array<{ message: PeerMessage; channel: PeerChannelKind }> = [];

  constructor(readonly remotePeerId: string) {}

  send(message: PeerMessage, channel: PeerChannelKind): void {
    this.sent.push({ message, channel });
  }

  close(): void {
    this.closed = true;
  }
}

export class SilentClientTransport implements PeerRoomTransport {
  readonly isHost = false;
  readonly link = new SilentLink('silent-host');
  handlers: PeerTransportHandlers | null = null;

  setHandlers(handlers: PeerTransportHandlers): void { this.handlers = handlers; }
  async start(): Promise<void> {
    this.handlers?.onLinkRegistered(this.link);
    this.handlers?.onLinkReady(this.link);
  }
  async reconnect(): Promise<void> { throw new Error('not used'); }
  destroy(): void { this.handlers = null; }
}

export class FailingClientTransport implements PeerRoomTransport {
  readonly isHost = false;
  private handlers: PeerTransportHandlers | null = null;

  constructor(private readonly error: PeerNetworkError) {}
  setHandlers(handlers: PeerTransportHandlers): void { this.handlers = handlers; }
  async start(): Promise<void> {
    this.handlers?.onFatal(this.error);
    throw this.error;
  }
  async reconnect(): Promise<void> { throw this.error; }
  destroy(): void { this.handlers = null; }
}

export interface TestRoom {
  room: PeerRoom;
  transport: FakeTransport;
  joined: string[];
  quit: string[];
  kicked: number;
  fatals: PeerNetworkError[];
}

export async function startRoom(
  transport: FakeTransport,
  hostOnlyPlayerKeys: string[],
  resumeToken?: string,
): Promise<TestRoom> {
  const room = new PeerRoom(transport, {
    hostOnlyPlayerKeys,
    welcomeExcludedPlayerKeys: ['inp', 'ppv'],
    clientOwnedPlayerKeys: ['ppv'],
    resumeToken,
  });
  const testRoom: TestRoom = { room, transport, joined: [], quit: [], kicked: 0, fatals: [] };
  room.onPlayerJoin((handle) => testRoom.joined.push(handle.id));
  room.onPlayerQuit((id) => testRoom.quit.push(id));
  room.onKicked(() => { testRoom.kicked++; });
  room.onFatal((error) => testRoom.fatals.push(error));
  await room.start();
  return testRoom;
}

export function createHostRoom(network: FakeNetwork, hostOnlyPlayerKeys: string[] = []): Promise<TestRoom> {
  return startRoom(network.createHostTransport(), hostOnlyPlayerKeys);
}

export function addClientRoom(
  network: FakeNetwork,
  hostOnlyPlayerKeys: string[] = [],
  resumeToken?: string,
): Promise<TestRoom> {
  return startRoom(network.createClientTransport(), hostOnlyPlayerKeys, resumeToken);
}

/** Schliesst die Verbindung eines Client-Raums, so wie es ein Verbindungsabbruch täte. */
export function dropConnection(client: TestRoom): void {
  const link = [...client.transport.links].reverse().find(candidate => !candidate.closed);
  if (!link) throw new Error('Kein Link für diesen Transport bekannt');
  link.close();
}
