import { describe, expect, it, vi } from 'vitest';
import { PEER_DISCONNECTED_GRACE_MS } from '../src/config';
import { PeerLink } from '../src/network/peer/PeerLink';

type Listener = (event: Event) => void;

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = 'connected';
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
    return new FakeDataChannel();
  }
}

class FakeDataChannel {
  readyState: RTCDataChannelState = 'open';
  bufferedAmount = 0;
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(_payload: string): void {}

  close(): void {
    this.readyState = 'closed';
    for (const listener of this.listeners.get('close') ?? []) listener(new Event('close'));
  }
}

class FakeDataConnection {
  open = true;
  readonly peer = 'remote-peer';
  readonly peerConnection: FakePeerConnection;
  readonly dataChannel = {} as RTCDataChannel;
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

  close(): void {
    if (!this.open) return;
    this.open = false;
    for (const listener of this.listeners.get('close') ?? []) listener();
  }
}

async function openTestLink(peerConnection: FakePeerConnection): Promise<{ link: PeerLink; connection: FakeDataConnection; onClose: ReturnType<typeof vi.fn> }> {
  const connection = new FakeDataConnection(peerConnection);
  const link = new PeerLink(connection as never);
  const onClose = vi.fn();
  await link.open({ onMessage: vi.fn(), onClose });
  return { link, connection, onClose };
}

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
