import { describe, expect, it, vi } from 'vitest';
import { MAX_PLAYERS } from '../src/config';
import { PeerRoom, type PeerPlayerHandle } from '../src/network/peer/PeerRoom';
import { createPeerNetworkError, type PeerNetworkError } from '../src/network/peer/PeerSignaling';
import {
  PEER_PROTOCOL_VERSION,
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
class FakeLink implements PeerLinkLike {
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

class FakeTransport implements PeerRoomTransport {
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

  destroy(): void {
    this.handlers = null;
  }
}

class FakeNetwork {
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

class SilentLink implements PeerLinkLike {
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

class SilentClientTransport implements PeerRoomTransport {
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

class FailingClientTransport implements PeerRoomTransport {
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

interface TestRoom {
  room: PeerRoom;
  transport: FakeTransport;
  joined: string[];
  quit: string[];
  fatals: PeerNetworkError[];
}

async function startRoom(
  transport: FakeTransport,
  hostOnlyPlayerKeys: string[],
  resumeToken?: string,
): Promise<TestRoom> {
  const room = new PeerRoom(transport, { hostOnlyPlayerKeys, resumeToken });
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

function addClientRoom(
  network: FakeNetwork,
  hostOnlyPlayerKeys: string[] = [],
  resumeToken?: string,
): Promise<TestRoom> {
  return startRoom(network.createClientTransport(), hostOnlyPlayerKeys, resumeToken);
}

/** Schliesst die Verbindung eines Client-Raums, so wie es ein Verbindungsabbruch täte. */
function dropConnection(client: TestRoom): void {
  const link = [...client.transport.links].reverse().find(candidate => !candidate.closed);
  if (!link) throw new Error('Kein Link für diesen Transport bekannt');
  link.close();
}

describe('PeerRoom handshake and roster', () => {
  it('rejects boot when an open link never receives welcome', async () => {
    vi.useFakeTimers();
    try {
      const room = new PeerRoom(new SilentClientTransport(), { resumeToken: 'handshake-timeout-token' });
      const start = room.start();
      const assertion = expect(start).rejects.toMatchObject({ kind: 'connection-failed' });
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards transport errors to the pending boot', async () => {
    const error = createPeerNetworkError('host-not-found');
    const room = new PeerRoom(new FailingClientTransport(error), { resumeToken: 'missing-host-token' });

    await expect(room.start()).rejects.toMatchObject({ kind: 'host-not-found' });
  });

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

  it('rejects a full room without disturbing existing players', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const clients: TestRoom[] = [];
    for (let index = 1; index < MAX_PLAYERS; index++) clients.push(await addClientRoom(network));

    await expect(addClientRoom(network)).rejects.toMatchObject({ kind: 'room-full' });
    expect(host.room.getPlayerIds()).toHaveLength(MAX_PLAYERS);
    expect(clients.every(client => client.fatals.length === 0)).toBe(true);
    expect(clients.every(client => client.transport.links.some(link => !link.closed))).toBe(true);
  });

  it('isolates a protocol-mismatched incoming join to that link', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const existing = await addClientRoom(network);
    const badLink = new SilentLink('outdated-client');

    host.transport.handlers?.onLinkRegistered(badLink);
    host.transport.handlers?.onMessage(
      badLink,
      { t: 'hello', v: PEER_PROTOCOL_VERSION - 1, k: 'outdated-client-token' },
      'rel',
    );

    expect(badLink.sent).toContainEqual({ message: { t: 'reject', k: 'protocol-mismatch' }, channel: 'rel' });
    expect(badLink.closed).toBe(true);
    expect(existing.transport.links.some(link => !link.closed)).toBe(true);
    expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p1']);
  });

  it('delivers state the host writes while handling the join to the new client', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    // Genau das Muster von hostAssignColor/hostEnsureTeamAssignment: der Host schreibt einen
    // Zustand des neuen Spielers, während er dessen Join verarbeitet.
    host.room.onPlayerJoin((handle) => {
      if (handle.id === host.room.getLocalPlayerId()) return;
      host.room.setPlayerState(handle.id, 'clr', 0x33cc66, true);
    });

    const client = await addClientRoom(network);
    const localId = client.room.getLocalPlayerId();

    expect(host.room.getPlayerState(localId, 'clr')).toBe(0x33cc66);
    expect(client.room.getPlayerState(localId, 'clr')).toBe(0x33cc66);
  });

  it('reuses the id after the resume grace period expired', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network);
      const first = await addClientRoom(network);
      expect(first.room.getLocalPlayerId()).toBe('p1');
      first.transport.reconnectEnabled = false;

      dropConnection(first);
      await vi.advanceTimersByTimeAsync(10_000);
      const replacement = await addClientRoom(network);

      expect(replacement.room.getLocalPlayerId()).toBe('p1');
      expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p1']);
    } finally {
      vi.useRealTimers();
    }
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

  it('never falls back to reliable when a flush happens before the fast channel is ready', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    network.afterLinksRegistered = () => {
      host.room.setGlobal('gs', { _s: 1 }, false);
      host.room.update();
    };

    const client = await addClientRoom(network);
    const hostLink = host.transport.links[0];
    const preReadyBatch = hostLink.sent.find(entry => entry.message.t === 'b');

    expect(preReadyBatch?.channel).toBe('fast');
    expect(client.room.getGlobal('gs')).toEqual({ _s: 1 });
    expect(hostLink.sent.some(entry => entry.message.t === 'b' && entry.channel === 'rel')).toBe(false);
  });

  it('ignores delayed and duplicate fast batches', async () => {
    const network = new FakeNetwork();
    await createHostRoom(network);
    const client = await addClientRoom(network);
    const link = client.transport.links[0];

    client.transport.handlers?.onMessage(link, { t: 'b', q: 5, g: [['gs', { _s: 5 }]] }, 'fast');
    client.transport.handlers?.onMessage(link, { t: 'b', q: 4, g: [['gs', { _s: 4 }]] }, 'fast');
    client.transport.handlers?.onMessage(link, { t: 'b', q: 5, g: [['gs', { _s: 0 }]] }, 'fast');

    expect(client.room.getGlobal('gs')).toEqual({ _s: 5 });
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
  it('resumes within ten seconds without changing player id or state', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const leaving = await addClientRoom(network, [], 'stable-resume-token');
    const observer = await addClientRoom(network);
    host.room.setPlayerState('p1', 'hp', 73, true);

    const handleQuit = vi.fn();
    host.room.getPlayerHandle('p1')?.onQuit(handleQuit);

    dropConnection(leaving);
    await Promise.resolve();

    expect(handleQuit).not.toHaveBeenCalled();
    expect(host.quit).toEqual([]);
    expect(observer.quit).toEqual([]);
    expect(leaving.room.getLocalPlayerId()).toBe('p1');
    expect(leaving.room.getPlayerState('p1', 'hp')).toBe(73);
    expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p1', 'p2']);
  });

  it('removes an unresumed player exactly once after ten seconds', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network);
      const client = await addClientRoom(network);
      const observer = await addClientRoom(network);
      client.transport.reconnectEnabled = false;

      dropConnection(client);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(host.quit).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);

      expect(host.quit).toEqual(['p1']);
      expect(observer.quit).toEqual(['p1']);
      expect(client.fatals).toHaveLength(1);
      expect(client.fatals[0]).toMatchObject({ kind: 'resume-expired' });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(host.quit).toEqual(['p1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops relaying to a link that is gone', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network);
      const leaving = await addClientRoom(network);
      const observer = await addClientRoom(network);
      leaving.transport.reconnectEnabled = false;

      dropConnection(leaving);
      await vi.advanceTimersByTimeAsync(10_000);
      host.room.setGlobal('gph', 'ARENA', true);

      expect(observer.room.getGlobal('gph')).toBe('ARENA');
      expect(leaving.room.getGlobal('gph')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
