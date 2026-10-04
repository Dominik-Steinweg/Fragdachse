import { describe, expect, it, vi } from 'vitest';
import { PEER_DISCONNECTED_GRACE_MS, PEER_FAST_BUFFER_LIMIT_BYTES } from '../src/config';
import { PeerLink } from '../src/network/peer/PeerLink';
import { PEER_PROTOCOL_VERSION, type PeerMessage } from '../src/network/peer/protocol';
import { PeerPacketAssembler, decodePeerPayload, PEER_MESSAGE_LIMIT_BYTES } from '../src/network/peer/PeerPacketCodec';
import { PeerRoom } from '../src/network/peer/PeerRoom';
import type { PeerRoomTransport, PeerTransportHandlers } from '../src/network/peer/transport';
import { FULL_GAME_STATE_SLICE_KEYS, isCompleteGameStatePayload } from '../src/network/FullGameStateBootstrap';

type Listener = (event: Event) => void;

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = 'connected';
  sctp = { maxMessageSize: 64 * 1024 };
  readonly fast = new FakeDataChannel();
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }

  createDataChannel(): FakeDataChannel {
    return this.fast;
  }
}

class FakeDataChannel {
  readyState: RTCDataChannelState = 'open';
  bufferedAmount = 0;
  maxMessageSize = 64 * 1024;
  error: Error | undefined;
  sent: Array<string | ArrayBuffer> = [];
  onSend?: (payload: string | ArrayBuffer) => void;
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(payload: string | ArrayBuffer): void {
    if (this.error) { const error = this.error; this.error = undefined; throw error; }
    const size = typeof payload === 'string' ? new TextEncoder().encode(payload).length : payload.byteLength;
    if (size > this.maxMessageSize) throw new TypeError('Trying to send message larger than max-message-size');
    this.sent.push(payload);
    this.onSend?.(payload);
  }

  emit(type: string, data?: unknown): void {
    const event = type === 'message' ? new MessageEvent(type, { data }) : new Event(type);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close(): void {
    this.readyState = 'closed';
    for (const listener of this.listeners.get('close') ?? []) listener(new Event('close'));
  }
}

class FakeDataConnection {
  open = true;
  readonly peer = 'remote-peer';
  readonly peerConnection: FakePeerConnection;
  readonly dataChannel = new FakeDataChannel();
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(peerConnection: FakePeerConnection) {
    this.peerConnection = peerConnection;
  }

  on(type: string, listener: (...args: unknown[]) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(...args: unknown[]) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  off(type: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  send(_payload: string): void {}

  receive(data: unknown): void {
    for (const listener of this.listeners.get('data') ?? []) listener(data);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    for (const listener of this.listeners.get('close') ?? []) listener();
  }
}

async function openTestLink(peerConnection: FakePeerConnection) {
  const connection = new FakeDataConnection(peerConnection);
  const link = new PeerLink(connection as never);
  const onClose = vi.fn();
  const onMessage = vi.fn();
  await link.open({ onMessage, onClose });
  return { link, connection, onClose, onMessage };
}

const largeState = (q: number): PeerMessage => ({ t: 'b', q, g: [['gs', {
  _s: q, j: { s: [], u: Array.from({ length: 50_000 }, (_, i) => i + q), f: 1 },
}]] });

async function decodedPackets(packets: Array<string | ArrayBuffer>, ordered: boolean): Promise<PeerMessage[]> {
  const assembler = new PeerPacketAssembler(ordered);
  const messages: PeerMessage[] = [];
  for (const packet of packets) {
    if (typeof packet === 'string') messages.push(JSON.parse(packet));
    else {
      const payload = assembler.accept(packet);
      if (payload) messages.push(JSON.parse(await decodePeerPayload(payload)));
    }
  }
  return messages;
}

describe('PeerLink bounded message transport', () => {
  it('bounds decoded messages queued before the fast channel handshake completes', async () => {
    const pc = new FakePeerConnection();
    pc.fast.readyState = 'connecting';
    const connection = new FakeDataConnection(pc);
    const link = new PeerLink(connection as never);
    const onMessage = vi.fn();
    const opening = link.open({ onMessage, onClose: vi.fn() }).catch(error => error);
    await Promise.resolve();
    try {
      const message = JSON.stringify({ t: 'b', q: 1, g: [['waiting', 'x'.repeat(32 * 1024)]] });
      const count = Math.floor(PEER_MESSAGE_LIMIT_BYTES * 2 / (message.length * 2)) + 1;
      for (let i = 0; i < count; i++) connection.receive(message);
      expect(link.closeError?.kind).toBe('transport-overloaded');
      expect(connection.open).toBe(false);
      expect(onMessage).not.toHaveBeenCalled();
      expect(await opening).toMatchObject({ kind: 'connection-failed' });
    } finally { link.close(); await opening; }
  });

  it('delivers the retained early reliable messages once and in order after fast open', async () => {
    const pc = new FakePeerConnection();
    pc.fast.readyState = 'connecting';
    const connection = new FakeDataConnection(pc);
    const link = new PeerLink(connection as never);
    const onMessage = vi.fn();
    const opening = link.open({ onMessage, onClose: vi.fn() });
    await Promise.resolve();
    try {
      connection.receive(JSON.stringify({ t: 'hello', v: PEER_PROTOCOL_VERSION, k: 'early-resume-token' }));
      connection.receive(JSON.stringify({ t: 'b', p: [['p1', 'pnm', 'Early Player']] }));
      expect(onMessage).not.toHaveBeenCalled();
      pc.fast.readyState = 'open'; pc.fast.emit('open');
      await opening;
      expect(onMessage.mock.calls).toEqual([
        [{ t: 'hello', v: PEER_PROTOCOL_VERSION, k: 'early-resume-token' }, 'rel'],
        [{ t: 'b', p: [['p1', 'pnm', 'Early Player']] }, 'rel'],
      ]);
      expect(link.isOpen).toBe(true);
    } finally { link.close(); }
  });

  it('joins and resumes a real room with a fragmented full baseline on small SCTP channels', async () => {
    let hostHandlers!: PeerTransportHandlers, clientHandlers!: PeerTransportHandlers;
    let hostLink!: PeerLink, clientLink!: PeerLink;
    const connect = async () => {
      const hostPc = new FakePeerConnection(), clientPc = new FakePeerConnection();
      const hostConnection = new FakeDataConnection(hostPc), clientConnection = new FakeDataConnection(clientPc);
      hostPc.sctp.maxMessageSize = clientPc.sctp.maxMessageSize = 1024;
      hostConnection.dataChannel.maxMessageSize = clientConnection.dataChannel.maxMessageSize = 1024;
      hostConnection.dataChannel.onSend = p => clientConnection.receive(p);
      clientConnection.dataChannel.onSend = p => hostConnection.receive(p);
      hostPc.fast.onSend = p => clientPc.fast.emit('message', p);
      clientPc.fast.onSend = p => hostPc.fast.emit('message', p);
      const h = hostLink = new PeerLink(hostConnection as never), c = clientLink = new PeerLink(clientConnection as never);
      hostHandlers.onLinkRegistered(h); clientHandlers.onLinkRegistered(c);
      await h.open({ onMessage: (m, k) => hostHandlers.onMessage(h, m, k), onClose: () => hostHandlers.onLinkClosed(h) });
      await c.open({ onMessage: (m, k) => clientHandlers.onMessage(c, m, k), onClose: () => clientHandlers.onLinkClosed(c) });
      hostHandlers.onLinkReady(h); clientHandlers.onLinkReady(c);
      clientHandlers.onMessage(c, { t: 'b', q: 1, g: [['before-welcome', true]] }, 'fast');
      expect(client.getGlobal('before-welcome')).toBeUndefined();
    };
    const hostTransport: PeerRoomTransport = { isHost: true, setHandlers: h => { hostHandlers = h; },
      start: async () => {}, reconnect: async () => {}, destroy: () => hostLink?.close() };
    const clientTransport: PeerRoomTransport = { isHost: false, setHandlers: h => { clientHandlers = h; },
      start: connect, reconnect: connect, destroy: () => clientLink?.close() };
    const host = new PeerRoom(hostTransport), client = new PeerRoom(clientTransport, { resumeToken: 'fragmented-resume-token' });
    const full = { ...Object.fromEntries(FULL_GAME_STATE_SLICE_KEYS.map(k => [k, null])),
      _full: true, _s: 1, p: [], j: { f: 1, s: [], u: [] },
      r: Array.from({ length: 60_000 }, (_, i) => [i, i * 17 % 991, i * 41 % 997]) };
    try {
      await host.start(); host.setGlobal('gsi', full, true);
      await client.start();
      expect(isCompleteGameStatePayload(client.getGlobal('gsi'))).toBe(true);
      expect(client.getGlobal('gsi')).toEqual(full);
      const playerId = client.getLocalPlayerId();
      hostLink.close(); clientLink.close();
      const resumed = { ...full, _s: 2, j: { f: 1, s: [], u: [] } };
      host.setGlobal('gsi', resumed, true);
      await vi.waitFor(() => expect(client.getGlobal('gsi')).toEqual(resumed), { timeout: 4000 });
      expect(client.getLocalPlayerId()).toBe(playerId);
      expect(host.getPlayerIds()).toContain(playerId);
    } finally { client.destroy(); host.destroy(); }
  });
  it.each(['fast', 'rel'] as const)('delivers an oversized Unicode %s message atomically within the negotiated limit', async kind => {
    vi.useFakeTimers();
    try {
      const pc = new FakePeerConnection(); pc.sctp.maxMessageSize = 1024;
      const { link, connection, onClose } = await openTestLink(pc);
      const channel = kind === 'fast' ? pc.fast : connection.dataChannel;
      channel.maxMessageSize = 1024;
      const message: PeerMessage = { t: 'rpc', c: 0, n: 'large', d: '🎯Ä'.repeat(60_000) };
      link.send(message, kind);
      await vi.runAllTimersAsync();
      expect(channel.sent.length).toBeGreaterThan(1);
      expect(channel.sent.every(p => typeof p !== 'string' && p.byteLength <= 1024)).toBe(true);
      expect(await decodedPackets(channel.sent, kind === 'rel')).toEqual([message]);
      expect(onClose).not.toHaveBeenCalled(); link.close();
    } finally { vi.useRealTimers(); }
  });

  it('retries a local size error with smaller fragments and a buffer error without closing the connection', async () => {
    vi.useFakeTimers();
    try {
      const pc = new FakePeerConnection();
      const { link, connection, onClose } = await openTestLink(pc);
      connection.dataChannel.onSend = () => { connection.dataChannel.maxMessageSize = 2048; };
      const operationError = new Error('Send buffer full'); operationError.name = 'OperationError';
      connection.dataChannel.error = operationError;
      const message = largeState(1);
      link.send(message, 'rel');
      await vi.runAllTimersAsync();
      expect(await decodedPackets(connection.dataChannel.sent, true)).toEqual([message]);
      expect(onClose).not.toHaveBeenCalled(); link.close();
    } finally { vi.useRealTimers(); }
  });

  it('finishes the in-flight snapshot under backpressure and then sends the newest waiting fast state', async () => {
    vi.useFakeTimers();
    try {
      const pc = new FakePeerConnection();
      const { link, onClose } = await openTestLink(pc);
      pc.fast.onSend = () => { pc.fast.bufferedAmount = PEER_FAST_BUFFER_LIMIT_BYTES; };
      link.send(largeState(1), 'fast');
      link.send(largeState(2), 'fast');
      link.send(largeState(3), 'fast');
      expect(link.droppedFastCount).toBe(1);
      link.send({ t: 'b', q: 4, p: [['p0', 'input', { dx: 1 }]] }, 'fast');
      pc.fast.onSend = undefined; pc.fast.bufferedAmount = 0;
      pc.fast.emit('bufferedamountlow');
      await vi.runAllTimersAsync();
      expect(await decodedPackets(pc.fast.sent, false)).toEqual([largeState(1),
        { ...largeState(3), q: 4, p: [['p0', 'input', { dx: 1 }]] }]);
      expect(onClose).not.toHaveBeenCalled(); link.close();
    } finally { vi.useRealTimers(); }
  });

  it('preserves welcome/full-baseline/RPC order through async compression and exposes actual wire bytes', async () => {
    const sender = await openTestLink(new FakePeerConnection());
    const receiver = await openTestLink(new FakePeerConnection());
    sender.connection.receive(JSON.stringify({ t: 'hello', v: PEER_PROTOCOL_VERSION, k: '0123456789abcdef', z: 1 }));
    sender.connection.dataChannel.onSend = packet => receiver.connection.receive(packet);
    const metrics = vi.fn(); sender.link.setPayloadDiagnosticsSink(metrics);
    const welcome: PeerMessage = { t: 'welcome', v: PEER_PROTOCOL_VERSION, id: 'p1', h: 'p0',
      roster: [{ id: 'p0' }, { id: 'p1' }], g: { gsi: { data: 'baseline'.repeat(80_000) } }, p: {} };
    sender.link.send(welcome, 'rel');
    sender.link.send({ t: 'rpc', c: 0, n: 'after-baseline', d: {} }, 'rel');
    await vi.waitFor(() => expect(receiver.onMessage).toHaveBeenCalledTimes(2));
    expect(receiver.onMessage.mock.calls.map(c => c[0])).toEqual([{ ...welcome, z: 1 }, { t: 'rpc', c: 0, n: 'after-baseline', d: {} }]);
    expect(metrics.mock.calls[0][0].wireBytes).toBeLessThan(10_000);
    expect(metrics.mock.calls[0][0].gameState).toBe('full');
    expect(sender.onClose).not.toHaveBeenCalled();
    sender.link.close(); receiver.link.close();
  });

  it('does not deliver an incomplete fast snapshot and accepts a later complete one with reordered duplicates', async () => {
    vi.useFakeTimers();
    try {
      const pc = new FakePeerConnection();
      const sender = await openTestLink(pc), receiverPc = new FakePeerConnection();
      const receiver = await openTestLink(receiverPc);
      sender.link.send(largeState(1), 'fast'); await vi.runAllTimersAsync();
      const lost = pc.fast.sent.splice(0);
      for (const packet of lost.slice(1)) receiverPc.fast.emit('message', packet);
      expect(receiver.onMessage).not.toHaveBeenCalled();
      sender.link.send(largeState(2), 'fast'); await vi.runAllTimersAsync();
      for (const packet of [...pc.fast.sent].reverse()) {
        receiverPc.fast.emit('message', packet); receiverPc.fast.emit('message', packet);
      }
      await vi.waitFor(() => expect(receiver.onMessage).toHaveBeenCalledTimes(1));
      for (const packet of lost) receiverPc.fast.emit('message', packet);
      expect(receiver.onMessage.mock.calls[0][0]).toEqual(largeState(2));
      sender.link.close(); receiver.link.close();
    } finally { vi.useRealTimers(); }
  });
});

describe('PeerLink native connection state', () => {
  it('rejects opening when a queued handshake closes the link and stops the remaining inbox', async () => {
    const connection = new FakeDataConnection(new FakePeerConnection());
    const link = new PeerLink(connection as never);
    connection.receive(JSON.stringify({ t: 'hello', v: PEER_PROTOCOL_VERSION - 1, k: '0123456789abcdef' }));
    connection.receive(JSON.stringify({ t: 'hb' }));
    const onClose = vi.fn();
    const onMessage = vi.fn((message: PeerMessage) => {
      if (message.t === 'hello' && message.v !== PEER_PROTOCOL_VERSION) link.close();
    });

    const outcome = await link.open({ onMessage, onClose })
      .then(() => 'opened', error => error.kind);

    expect({ outcome, closeCount: onClose.mock.calls.length, delivered: onMessage.mock.calls.map(([message]) => message.t) })
      .toEqual({ outcome: 'connection-failed', closeCount: 1, delivered: ['hello'] });
  });

  it.each(['close', 'native-failed', 'already-failed'] as const)('settles a pending reliable open after %s', async (cause) => {
    const pc = new FakePeerConnection();
    const connection = new FakeDataConnection(pc);
    connection.open = false;
    if (cause === 'already-failed') pc.connectionState = 'failed';
    const link = new PeerLink(connection as never);
    const settled = vi.fn();
    void link.open({ onMessage: vi.fn(), onClose: vi.fn() })
      .then(() => settled('opened'), error => settled(error.kind));

    if (cause === 'close') link.close();
    else if (cause === 'native-failed') {
      pc.connectionState = 'failed';
      pc.emit('connectionstatechange');
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toHaveBeenCalledExactlyOnceWith('connection-failed');
    expect(connection.listenerCount('open')).toBe(0);
  });

  it('rejects when closed after the fast open event but before the open continuation', async () => {
    const pc = new FakePeerConnection();
    pc.fast.readyState = 'connecting';
    const connection = new FakeDataConnection(pc);
    const link = new PeerLink(connection as never);
    const opening = link.open({ onMessage: vi.fn(), onClose: vi.fn() });
    await Promise.resolve();
    pc.fast.readyState = 'open';
    pc.fast.emit('open');
    link.close();

    await expect(opening).rejects.toMatchObject({ kind: 'connection-failed' });
    expect(link.isOpen).toBe(false);
    expect(link.openedAtMs).toBe(0);
  });

  it('tolerates a short disconnected blip and closes if it persists', async () => {
    vi.useFakeTimers();
    try {
      const peerConnection = new FakePeerConnection();
      const { connection, onClose } = await openTestLink(peerConnection);

      peerConnection.connectionState = 'disconnected';
      peerConnection.emit('connectionstatechange');
      await vi.advanceTimersByTimeAsync(PEER_DISCONNECTED_GRACE_MS - 1);
      expect(onClose).not.toHaveBeenCalled();

      peerConnection.connectionState = 'connected';
      peerConnection.emit('connectionstatechange');
      await vi.advanceTimersByTimeAsync(PEER_DISCONNECTED_GRACE_MS + 1);
      expect(onClose).not.toHaveBeenCalled();

      peerConnection.connectionState = 'disconnected';
      peerConnection.emit('connectionstatechange');
      await vi.advanceTimersByTimeAsync(PEER_DISCONNECTED_GRACE_MS);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(connection.open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['failed', 'closed'] as const)('treats native %s as an immediate link abort', async (state) => {
    const peerConnection = new FakePeerConnection();
    const { connection, onClose } = await openTestLink(peerConnection);

    peerConnection.connectionState = state;
    peerConnection.emit('connectionstatechange');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(connection.open).toBe(false);
  });
});
