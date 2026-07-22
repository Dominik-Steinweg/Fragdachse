import { describe, expect, it, vi } from 'vitest';
import { PeerRoom, type PeerPlayerHandle } from '../src/network/peer/PeerRoom';
import type { PeerNetworkError } from '../src/network/peer/PeerSignaling';
import { encodePeerMessage, parsePeerMessage, type PeerChannelKind, type PeerMessage } from '../src/network/peer/protocol';
import type { PeerLinkLike, PeerRoomTransport, PeerTransportHandlers } from '../src/network/peer/transport';

/**
 * In-Memory-Transport: verdrahtet mehrere PeerRoom-Instanzen ohne WebRTC.
 * Nachrichten laufen durch echte Kodierung und Validierung, damit die Tests dasselbe
 * Drahtformat treffen wie der Browser. Zustellung ist synchron, weil die getestete Logik
 * reihenfolge- und nicht zeitgesteuert ist.
 */
class FakeLink implements PeerLinkLike {
  playerId = '';
  closed = false;
  counterpart!: FakeLink;
  owner!: FakeTransport;
  readonly sent: Array<{ message: PeerMessage; channel: PeerChannelKind }> = [];

  constructor(readonly remotePeerId: string) {}

  send(message: PeerMessage, channel: PeerChannelKind): void {
    this.sent.push({ message, channel });
    if (this.closed || this.counterpart.closed) return;
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

class FakeTransport implements PeerRoomTransport {
  handlers: PeerTransportHandlers | null = null;
  readonly links: FakeLink[] = [];

  constructor(readonly isHost: boolean, readonly peerId: string, private readonly network: FakeNetwork) {}

  setHandlers(handlers: PeerTransportHandlers): void {
    this.handlers = handlers;
  }

  async start(): Promise<void> {
    if (this.isHost) return;
    this.network.connectClient(this);
  }

  destroy(): void {
    this.handlers = null;
  }
}

class FakeNetwork {
  hostTransport: FakeTransport | null = null;
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

    // Reihenfolge ist wichtig: der Host muss den Link kennen, bevor der Client sein 'hello' schickt.
    host.handlers?.onLink(hostSide);
    clientTransport.handlers?.onLink(clientSide);
  }
}

interface TestRoom {
  room: PeerRoom;
  transport: FakeTransport;
  joined: string[];
  quit: string[];
  fatals: PeerNetworkError[];
}

async function startRoom(transport: FakeTransport, hostOnlyPlayerKeys: string[]): Promise<TestRoom> {
  const room = new PeerRoom(transport, { hostOnlyPlayerKeys });
  const testRoom: TestRoom = { room, transport, joined: [], quit: [], fatals: [] };
  room.onPlayerJoin((handle) => testRoom.joined.push(handle.id));
  room.onPlayerQuit((id) => testRoom.quit.push(id));
  room.onFatal((error) => testRoom.fatals.push(error));
  await room.start();
  return testRoom;
}

function createHostRoom(network: FakeNetwork, hostOnlyPlayerKeys: string[] = []): Promise<TestRoom> {
  return startRoom(network.createHostTransport(), hostOnlyPlayerKeys);
}

function addClientRoom(network: FakeNetwork, hostOnlyPlayerKeys: string[] = []): Promise<TestRoom> {
  return startRoom(network.createClientTransport(), hostOnlyPlayerKeys);
}

/** Schliesst die Verbindung eines Client-Raums, so wie es ein Verbindungsabbruch täte. */
function dropConnection(client: TestRoom): void {
  const link = client.transport.links[0];
  if (!link) throw new Error('Kein Link für diesen Transport bekannt');
  link.close();
}

describe('PeerRoom handshake and roster', () => {
  it('assigns short player ids and lets both sides see the full roster', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);

    expect(host.room.getLocalPlayerId()).toBe('p0');
    expect(client.room.getLocalPlayerId()).toBe('p1');
    expect(client.room.getHostPlayerId()).toBe('p0');
    expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p1']);
    expect(client.room.getPlayerIds().sort()).toEqual(['p0', 'p1']);
    expect(host.joined).toEqual(['p0', 'p1']);
    expect(client.joined.sort()).toEqual(['p0', 'p1']);
  });

  it('replays already connected players for late join callbacks', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    await addClientRoom(network);

    const replayed: string[] = [];
    host.room.onPlayerJoin((handle) => replayed.push(handle.id));
    expect(replayed.sort()).toEqual(['p0', 'p1']);
  });

  it('tells existing clients about a newly joined player', async () => {
    const network = new FakeNetwork();
    await createHostRoom(network);
    const first = await addClientRoom(network);
    await addClientRoom(network);

    expect(first.joined.sort()).toEqual(['p0', 'p1', 'p2']);
    expect(first.room.getPlayerIds().sort()).toEqual(['p0', 'p1', 'p2']);
  });

  it('reuses the id of a player that left', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const first = await addClientRoom(network);
    expect(first.room.getLocalPlayerId()).toBe('p1');

    dropConnection(first);
    const replacement = await addClientRoom(network);

    expect(replacement.room.getLocalPlayerId()).toBe('p1');
    expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p1']);
  });
});

describe('PeerRoom replicated state', () => {
  it('applies local writes immediately without a network roundtrip', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);

    host.room.setGlobal('gph', 'ARENA', true);
    expect(host.room.getGlobal('gph')).toBe('ARENA');

    const handle = host.room.getPlayerHandle('p0') as PeerPlayerHandle;
    handle.setState('isr', true, true);
    expect(handle.getState('isr')).toBe(true);
  });

  it('delivers reliable writes right away and defers replaceable ones to update()', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);

    host.room.setGlobal('aly', { seed: 1 }, true);
    expect(client.room.getGlobal('aly')).toEqual({ seed: 1 });

    host.room.setGlobal('gs', { _s: 1 }, false);
    expect(client.room.getGlobal('gs')).toBeUndefined();

    host.room.update();
    expect(client.room.getGlobal('gs')).toEqual({ _s: 1 });
  });

  it('coalesces replaceable writes so only the newest value goes out', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);
    const hostLink = host.transport.links[0];

    host.room.setGlobal('gs', { _s: 1 }, false);
    host.room.setGlobal('gs', { _s: 2 }, false);
    host.room.setGlobal('gs', { _s: 3 }, false);
    const before = hostLink.sent.length;
    host.room.update();

    expect(hostLink.sent.length - before).toBe(1);
    expect(client.room.getGlobal('gs')).toEqual({ _s: 3 });
  });

  it('sends replaceable traffic on the fast channel and ordered traffic on the reliable one', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    await addClientRoom(network);
    const hostLink = host.transport.links[0];
    hostLink.sent.length = 0;

    host.room.setGlobal('gph', 'ARENA', true);
    host.room.setGlobal('gs', { _s: 9 }, false);
    host.room.update();

    const channels = hostLink.sent.filter((entry) => entry.message.t === 'b').map((entry) => entry.channel);
    expect(channels).toEqual(['rel', 'fast']);
  });

  it('relays a client write to the other clients but not back to its origin', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const first = await addClientRoom(network);
    const second = await addClientRoom(network);
    const firstLink = first.transport.links[0];

    first.room.setPlayerState('p1', 'pnm', 'Dachs', true);
    expect(host.room.getPlayerState('p1', 'pnm')).toBe('Dachs');
    expect(second.room.getPlayerState('p1', 'pnm')).toBe('Dachs');

    firstLink.sent.length = 0;
    first.room.setPlayerState('p1', 'png', 42, false);
    first.room.update();
    host.room.update();

    expect(host.room.getPlayerState('p1', 'png')).toBe(42);
    expect(second.room.getPlayerState('p1', 'png')).toBe(42);
    // Der Ursprung darf seinen eigenen Wert nicht zurueckgespiegelt bekommen.
    expect(firstLink.counterpart.sent.some((entry) => entry.message.t === 'b')).toBe(false);
  });

  it('keeps host-only keys off the relay path but still delivers them to the host', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network, ['inp']);
    const first = await addClientRoom(network, ['inp']);
    const second = await addClientRoom(network, ['inp']);

    first.room.setPlayerState('p1', 'inp', { dx: 1, dy: 0 }, false);
    first.room.update();
    host.room.update();

    expect(host.room.getPlayerState('p1', 'inp')).toEqual({ dx: 1, dy: 0 });
    expect(second.room.getPlayerState('p1', 'inp')).toBeUndefined();
  });

  it('hands a late joiner the complete current state', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const first = await addClientRoom(network);

    host.room.setGlobal('gmd', 'deathmatch', true);
    host.room.setPlayerState('p0', 'pnm', 'Host', true);
    first.room.setPlayerState('p1', 'pnm', 'Erster', true);

    const late = await addClientRoom(network);
    expect(late.room.getGlobal('gmd')).toBe('deathmatch');
    expect(late.room.getPlayerState('p0', 'pnm')).toBe('Host');
    expect(late.room.getPlayerState('p1', 'pnm')).toBe('Erster');
  });

  it('lets the host write state that belongs to another player', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);

    host.room.setPlayerState('p1', 'ucd', 1234, true);
    expect(client.room.getPlayerState('p1', 'ucd')).toBe(1234);
  });
});

describe('PeerRoom rpc', () => {
  it('runs host handlers locally when the caller is the host', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const handler = vi.fn(() => ({ ok: true }));
    host.room.registerHostHandler('lu', handler);

    await expect(host.room.callHost('lu', { slot: 'weapon1' }, 500)).resolves.toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith({ slot: 'weapon1' }, 'p0');
  });

  it('returns the host result to a calling client and attributes the sender', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);
    const senders: string[] = [];
    host.room.registerHostHandler('lu', (_payload, senderId) => {
      senders.push(senderId);
      return { ok: false, reason: 'cooldown' };
    });

    await expect(client.room.callHost('lu', { slot: 'weapon2' }, 500)).resolves.toEqual({ ok: false, reason: 'cooldown' });
    expect(senders).toEqual(['p1']);
  });

  it('awaits asynchronous host handlers', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);
    host.room.registerHostHandler('lu', async () => {
      await Promise.resolve();
      return 'fertig';
    });

    await expect(client.room.callHost('lu', {}, 500)).resolves.toBe('fertig');
  });

  it('delivers fire-and-forget commands without a reply', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);
    const handler = vi.fn();
    host.room.registerHostHandler('dash', handler);

    client.room.sendHost('dash', { dx: 1, dy: 0 });
    expect(handler).toHaveBeenCalledWith({ dx: 1, dy: 0 }, 'p1');
    expect(client.transport.links[0].counterpart.sent.some((entry) => entry.message.t === 'res')).toBe(false);
  });

  it('dispatches host broadcasts on every peer including the host itself', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const first = await addClientRoom(network);
    const second = await addClientRoom(network);

    const seen: string[] = [];
    host.room.registerAllHandler('xfx', (_payload, senderId) => { seen.push(`host:${senderId}`); });
    first.room.registerAllHandler('xfx', (_payload, senderId) => { seen.push(`first:${senderId}`); });
    second.room.registerAllHandler('xfx', (_payload, senderId) => { seen.push(`second:${senderId}`); });

    host.room.broadcast('xfx', { x: 1 });
    expect(seen.sort()).toEqual(['first:p0', 'host:p0', 'second:p0']);
  });

  it('relays a client broadcast through the host with a host-stamped sender id', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const first = await addClientRoom(network);
    const second = await addClientRoom(network);

    const seen: string[] = [];
    host.room.registerAllHandler('crq', (_payload, senderId) => { seen.push(`host:${senderId}`); });
    first.room.registerAllHandler('crq', (_payload, senderId) => { seen.push(`first:${senderId}`); });
    second.room.registerAllHandler('crq', (_payload, senderId) => { seen.push(`second:${senderId}`); });

    first.room.broadcast('crq', { color: 1 });
    expect(seen.sort()).toEqual(['first:p1', 'host:p1', 'second:p1']);
  });

  it('rejects a pending call when the timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network);
      const client = await addClientRoom(network);
      host.room.registerHostHandler('lu', () => new Promise(() => undefined));

      const pending = client.room.callHost('lu', {}, 200);
      const assertion = expect(pending).rejects.toThrow('RPC timeout: lu');
      await vi.advanceTimersByTimeAsync(250);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PeerRoom disconnects', () => {
  it('propagates a closed client link to the host and the remaining clients', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const leaving = await addClientRoom(network);
    const observer = await addClientRoom(network);

    const handleQuit = vi.fn();
    host.room.getPlayerHandle('p1')?.onQuit(handleQuit);

    dropConnection(leaving);

    expect(handleQuit).toHaveBeenCalledTimes(1);
    expect(host.quit).toEqual(['p1']);
    expect(observer.quit).toEqual(['p1']);
    expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p2']);
    expect(observer.room.getPlayerIds().sort()).toEqual(['p0', 'p2']);
  });

  it('reports a lost host as fatal on the client', async () => {
    const network = new FakeNetwork();
    await createHostRoom(network);
    const client = await addClientRoom(network);

    dropConnection(client);

    expect(client.fatals).toHaveLength(1);
    expect(client.fatals[0]).toMatchObject({ kind: 'host-left' });
    expect(client.quit).toEqual(['p0']);
  });

  it('stops relaying to a link that is gone', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const leaving = await addClientRoom(network);
    const observer = await addClientRoom(network);

    dropConnection(leaving);
    host.room.setGlobal('gph', 'ARENA', true);

    expect(observer.room.getGlobal('gph')).toBe('ARENA');
    expect(leaving.room.getGlobal('gph')).toBeUndefined();
  });
});
