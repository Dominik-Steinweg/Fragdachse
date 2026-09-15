import { describe, expect, it, vi } from 'vitest';
import { PEER_DISCONNECTED_GRACE_MS, PEER_FAST_BUFFER_LIMIT_BYTES } from '../src/config';
import { PeerLink } from '../src/network/peer/PeerLink';
import { PEER_PROTOCOL_VERSION, type PeerMessage } from '../src/network/peer/protocol';
import { PeerPacketAssembler, decodePeerPayload } from '../src/network/peer/PeerPacketCodec';
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
