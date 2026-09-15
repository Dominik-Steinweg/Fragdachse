/**
 * Ein Host↔Client-Link mit genau zwei Kanälen.
 *
 * `rel`  – die PeerJS-DataConnection selbst (`serialization: 'raw'`, `reliable: true`):
 *          geordnet und zuverlässig, für Handshake, Roster, Commands, Events und
 *          ordnungskritische Zustände.
 * `fast` – ein zusätzlicher RTCDataChannel mit `{ordered: false, maxRetransmits: 0}`:
 *          echte "neuester Stand gewinnt"-Semantik für Snapshots, Input und Ping.
 *
 * Der schnelle Kanal wird mit `negotiated: true` und fester Stream-ID angelegt. Damit feuert
 * auf der Gegenseite kein 'datachannel'-Event – zwingend nötig, weil PeerJS' interner Handler
 * jeden eingehenden Kanal als seine eigene DataConnection interpretiert und diese sonst
 * kapern würde.
 */
import type { DataConnection } from 'peerjs';
import {
  PEER_DISCONNECTED_GRACE_MS,
  PEER_FAST_CHANNEL_ID,
  PEER_FAST_CHANNEL_LABEL,
  PEER_FAST_CHANNEL_TIMEOUT_MS,
} from '../../config';
import { createPeerNetworkError, type PeerNetworkError } from './PeerSignaling';
import { encodePeerMessage, parsePeerMessage, type PeerChannelKind, type PeerMessage } from './protocol';
import type { PeerLinkLike, PeerPayloadDiagnostics } from './transport';
import { PeerPacketAssembler, decodePeerPayload, encodePeerBytes, PEER_COMPRESSION_THRESHOLD_BYTES,
  PEER_MESSAGE_LIMIT_BYTES, supportsPeerCompression, type EncodedPeerPayload } from './PeerPacketCodec';
import { PeerSendQueue } from './PeerSendQueue';

interface QueuedMessage {
  message: PeerMessage;
  channel: PeerChannelKind;
}

export interface PeerLinkHandlers {
  onMessage: (message: PeerMessage, channel: PeerChannelKind) => void;
  onClose: () => void;
}

export class PeerLink implements PeerLinkLike {
  private fastChannel: RTCDataChannel | null = null;
  private handlers: PeerLinkHandlers | null = null;
  private inbox: QueuedMessage[] = [];
  private closed = false;
  private droppedFastMessages = 0;
  private monitoredPeerConnection: RTCPeerConnection | null = null;
  private peerConnectionStateHandler: ((event: Event) => void) | null = null;
  private disconnectedTimer: ReturnType<typeof setTimeout> | null = null;
  private reliableClosedWarningShown = false;
  private payloadDiagnosticsSink: ((info: PeerPayloadDiagnostics) => void) | null = null;
  private compressionAllowed = false;
  private readonly reliablePackets = new PeerPacketAssembler(true);
  private readonly fastPackets = new PeerPacketAssembler(false);
  private reliableReceiveTail: Promise<void> = Promise.resolve();
  private reliableReceiveBytes = 0;
  private fastDecoding = false;
  private pendingFastDecode: EncodedPeerPayload | null = null;
  private readonly reliableSends = this.createSendQueue(false);
  private readonly fastSends = this.createSendQueue(true);
  closeError?: PeerNetworkError;

  playerId = '';

  /** Zeitpunkte für die Messung der Verbindungsaufbauzeit. */
  readonly createdAtMs = Date.now();
  openedAtMs = 0;

  constructor(private readonly connection: DataConnection) {
    // Sofort lauschen, nicht erst nach open(): die Gegenseite kann ihr 'hello' schicken,
    // waehrend hier noch der schnelle Kanal aufgeht. Bis Handler gesetzt sind, wird gepuffert.
    this.connection.on('data', (data: unknown) => {
      this.receive(data, 'rel');
    });
    this.connection.on('close', () => this.handleRemoteClose());
    this.connection.on('error', () => this.handleRemoteClose());
    // PeerJS' close/error events are useful but not sufficient on every browser. The native
    // connection state is the authoritative second signal for a vanished WebRTC link.
    this.bindPeerConnectionState();
  }

  get remotePeerId(): string {
    return this.connection.peer;
  }

  get peerConnection(): RTCPeerConnection | undefined {
    return this.connection.peerConnection;
  }

  get reliableChannel(): RTCDataChannel | undefined {
    return this.connection.dataChannel;
  }

  get unreliableChannel(): RTCDataChannel | null {
    return this.fastChannel;
  }

  get isOpen(): boolean {
    return !this.closed && this.connection.open;
  }

  /** Anzahl verworfener Fast-Nachrichten (Backpressure). Kennzahl für die Diagnose. */
  get droppedFastCount(): number {
    return this.droppedFastMessages;
  }

  setPayloadDiagnosticsSink(sink: ((info: PeerPayloadDiagnostics) => void) | null): void {
    this.payloadDiagnosticsSink = sink;
  }

  /**
   * Wartet, bis der zuverlässige Kanal offen ist, legt danach den schnellen Kanal an und
   * wartet auch auf dessen `open`. Erst danach gilt der Link als benutzbar.
   */
  async open(handlers: PeerLinkHandlers): Promise<void> {
    await this.awaitReliableOpen();
    this.bindDrain(this.connection.dataChannel, this.reliableSends);
    this.bindPeerConnectionState();
    if (this.closed) throw createPeerNetworkError('connection-failed');
    await this.openFastChannel();
    this.openedAtMs = Date.now();
    this.handlers = handlers;
    const queued = this.inbox;
    this.inbox = [];
    for (const item of queued) handlers.onMessage(item.message, item.channel);
    if (this.closed) handlers.onClose();
  }

  send(message: PeerMessage, channel: PeerChannelKind): void {
    if (this.closed) return;
    if (channel === 'fast') {
      if (this.fastChannel?.readyState !== 'open') {
        this.droppedFastMessages++;
        return;
      }
    } else if (!this.connection.open) {
      if (!this.reliableClosedWarningShown) {
        this.reliableClosedWarningShown = true;
        console.warn(`[PeerLink] Reliable-Send verworfen: Verbindung nicht offen (peer=${this.remotePeerId}, type=${message.t}).`);
      }
      return;
    }
    if ((message.t === 'hello' || message.t === 'welcome') && supportsPeerCompression()) {
      message = { ...message, z: 1 };
    }
    try {
      const payload = encodePeerMessage(message);
      const bytes = encodePeerBytes(payload);
      (channel === 'fast' ? this.fastSends : this.reliableSends).enqueue({
        message,
        textLength: payload.length,
        payload: bytes,
        text: bytes.rawBytes < PEER_COMPRESSION_THRESHOLD_BYTES ? payload : undefined,
        sent: (wireBytes, item) => this.emitPayloadDiagnostics(item.message, channel, item.textLength, wireBytes),
      });
    } catch (error) {
      // A local schema/size failure is not an ICE failure. Reliable data cannot be silently
      // dropped; expose the bounded queue/size failure explicitly if recovery is impossible.
      this.closeError = createPeerNetworkError('transport-overloaded', error);
      this.handleRemoteClose(this.closeError);
    }
  }

  private createSendQueue(fast: boolean): PeerSendQueue {
    return new PeerSendQueue({ fast,
      channel: () => fast ? this.fastChannel : this.connection.dataChannel,
      maxMessageSize: () => this.connection.peerConnection?.sctp?.maxMessageSize,
      compress: () => this.compressionAllowed,
      dropped: () => { this.droppedFastMessages++; },
      failed: (reason, error) => {
        if (reason === 'overload') this.closeError = createPeerNetworkError('transport-overloaded', error);
        this.handleRemoteClose(this.closeError ?? error);
      },
    });
  }

  private bindDrain(channel: RTCDataChannel | undefined, queue: PeerSendQueue): void {
    if (!channel) return;
    channel.bufferedAmountLowThreshold = 32 * 1024;
    channel.addEventListener('bufferedamountlow', queue.resume);
  }

  private receive(data: unknown, channel: PeerChannelKind): void {
    if (this.closed) return;
    const payload = typeof data === 'string' ? data
      : (channel === 'rel' ? this.reliablePackets : this.fastPackets).accept(data);
    if (payload === null) return;
    if (typeof payload === 'string' && (channel === 'fast' || this.reliableReceiveBytes === 0)) {
      this.parseAndDeliver(payload, channel); return;
    }
    if (channel === 'fast') {
      this.pendingFastDecode = payload as EncodedPeerPayload;
      void this.decodeFast();
    } else {
      const bytes = typeof payload === 'string' ? payload.length * 2 : payload.rawBytes;
      this.reliableReceiveBytes += bytes;
      if (this.reliableReceiveBytes > PEER_MESSAGE_LIMIT_BYTES * 2) {
        this.closeError = createPeerNetworkError('transport-overloaded');
        this.handleRemoteClose(this.closeError); return;
      }
      this.reliableReceiveTail = this.reliableReceiveTail.then(async () => {
        if (this.closed) return;
        try { this.parseAndDeliver(typeof payload === 'string' ? payload : await decodePeerPayload(payload), channel); }
        catch (error) { console.warn('[PeerLink] Ungültige Reliable-Nachricht.', error); }
        finally { this.reliableReceiveBytes -= bytes; }
      });
    }
  }

  private async decodeFast(): Promise<void> {
    if (this.fastDecoding) return;
    this.fastDecoding = true;
    try {
      while (this.pendingFastDecode && !this.closed) {
        const payload = this.pendingFastDecode;
        this.pendingFastDecode = null;
        try { this.parseAndDeliver(await decodePeerPayload(payload), 'fast'); }
        catch { /* Corrupt/lost fast message: a subsequent complete snapshot heals it. */ }
      }
    } finally { this.fastDecoding = false; }
  }

  private parseAndDeliver(payload: string, channel: PeerChannelKind): void {
    if (this.closed) return;
    const message = parsePeerMessage(payload);
    if (!message) return;
    if (message.t === 'hello' || message.t === 'welcome') this.compressionAllowed = message.z === 1;
    this.deliver(message, channel);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearPackets();
    this.clearPeerConnectionMonitor();
    try {
      this.fastChannel?.close();
    } catch {
      // Kanal war bereits geschlossen – irrelevant.
    }
    this.fastChannel = null;
    this.connection.close();
    this.handlers?.onClose();
  }

  private deliver(message: PeerMessage, channel: PeerChannelKind): void {
    if (this.handlers) this.handlers.onMessage(message, channel);
    else this.inbox.push({ message, channel });
  }

  private awaitReliableOpen(): Promise<void> {
    if (this.connection.open) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        this.connection.off('open', onOpen);
        this.connection.off('close', onClose);
        this.connection.off('error', onError);
      };
      const onOpen = (): void => { cleanup(); resolve(); };
      const onClose = (): void => { cleanup(); reject(createPeerNetworkError('connection-failed')); };
      const onError = (error: unknown): void => { cleanup(); reject(createPeerNetworkError('connection-failed', error)); };
      this.connection.on('open', onOpen);
      this.connection.on('close', onClose);
      this.connection.on('error', onError);
    });
  }

  private openFastChannel(): Promise<void> {
    const peerConnection = this.connection.peerConnection;
    if (!peerConnection) return Promise.reject(createPeerNetworkError('connection-failed'));
    if (this.closed) return Promise.reject(createPeerNetworkError('connection-failed'));

    const channel = peerConnection.createDataChannel(PEER_FAST_CHANNEL_LABEL, {
      negotiated: true,
      id: PEER_FAST_CHANNEL_ID,
      ordered: false,
      maxRetransmits: 0,
    });
    this.fastChannel = channel;
    channel.binaryType = 'arraybuffer';
    this.bindDrain(channel, this.fastSends);
    channel.addEventListener('message', (event: MessageEvent) => {
      this.receive(event.data, 'fast');
    });

    if (channel.readyState === 'open') {
      this.bindFastChannelFailure(channel);
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        globalThis.clearTimeout(timeout);
        channel.removeEventListener('open', onOpen);
        channel.removeEventListener('close', onClose);
        channel.removeEventListener('error', onError);
      };
      const onOpen = (): void => {
        cleanup();
        this.bindFastChannelFailure(channel);
        resolve();
      };
      const onClose = (): void => { cleanup(); reject(createPeerNetworkError('connection-failed')); };
      const onError = (): void => { cleanup(); reject(createPeerNetworkError('connection-failed')); };
      const timeout = globalThis.setTimeout(() => {
        cleanup();
        reject(createPeerNetworkError('connection-failed'));
      }, PEER_FAST_CHANNEL_TIMEOUT_MS);
      channel.addEventListener('open', onOpen);
      channel.addEventListener('close', onClose);
      channel.addEventListener('error', onError);
    });
  }

  private emitPayloadDiagnostics(message: PeerMessage, channel: PeerChannelKind, payloadLength: number, wireBytes: number): void {
    const sink = this.payloadDiagnosticsSink;
    if (!sink) return;
    const globalEntries = message.t === 'b' ? (message.g ?? [])
      : message.t === 'welcome' ? Object.entries(message.g) : [];
    const gameStateEntry = globalEntries.find(([key]) => key === 'gsi')
      ?? globalEntries.find(([key]) => key === 'gs');
    const gameState: PeerPayloadDiagnostics['gameState'] = gameStateEntry
      ? gameStateEntry[0] === 'gsi' || (
        typeof gameStateEntry[1] === 'object'
        && gameStateEntry[1] !== null
        && (gameStateEntry[1] as { _full?: unknown })._full === true
      ) ? 'full' : 'delta'
      : 'none';
    sink({
      channel,
      messageType: message.t,
      payloadLength,
      payloadSizeKind: 'estimated_utf16_code_units',
      wireBytes,
      gameState,
    });
  }

  private bindFastChannelFailure(channel: RTCDataChannel): void {
    const fail = (): void => this.handleRemoteClose();
    channel.addEventListener('close', fail, { once: true });
    channel.addEventListener('error', fail, { once: true });
  }

  private handleRemoteClose(reason?: unknown): void {
    if (this.closed) return;
    console.warn(`[PeerLink] Verbindung geschlossen (peer=${this.remotePeerId}).`, reason ?? 'kein Grund vom Transport');
    this.closed = true;
    this.clearPackets();
    this.clearPeerConnectionMonitor();
    try {
      this.fastChannel?.close();
    } catch {
      // Already closed.
    }
    this.fastChannel = null;
    if (this.connection.open) this.connection.close();
    this.handlers?.onClose();
  }

  private bindPeerConnectionState(): void {
    if (this.closed) return;
    const peerConnection = this.connection.peerConnection;
    if (!peerConnection || this.monitoredPeerConnection === peerConnection) return;

    this.clearPeerConnectionMonitor();
    const onStateChange = (_event: Event): void => this.handlePeerConnectionState(peerConnection);
    this.monitoredPeerConnection = peerConnection;
    this.peerConnectionStateHandler = onStateChange;
    peerConnection.addEventListener('connectionstatechange', onStateChange);
    this.handlePeerConnectionState(peerConnection);
  }

  private clearPackets(): void {
    this.connection.dataChannel?.removeEventListener('bufferedamountlow', this.reliableSends.resume);
    this.fastChannel?.removeEventListener('bufferedamountlow', this.fastSends.resume);
    this.reliableSends.close(); this.fastSends.close();
    this.reliablePackets.clear(); this.fastPackets.clear();
    this.pendingFastDecode = null; this.inbox = [];
  }

  private handlePeerConnectionState(peerConnection: RTCPeerConnection): void {
    if (this.closed) return;
    const state = peerConnection.connectionState;
    if (state === 'failed' || state === 'closed') {
      this.handleRemoteClose();
      return;
    }
    if (state === 'disconnected') {
      this.scheduleDisconnectedClose(peerConnection);
      return;
    }
    this.clearDisconnectedTimer();
  }

  private scheduleDisconnectedClose(peerConnection: RTCPeerConnection): void {
    if (this.disconnectedTimer !== null) return;
    this.disconnectedTimer = globalThis.setTimeout(() => {
      this.disconnectedTimer = null;
      if (!this.closed && peerConnection.connectionState === 'disconnected') {
        this.handleRemoteClose();
      }
    }, PEER_DISCONNECTED_GRACE_MS);
  }

  private clearDisconnectedTimer(): void {
    if (this.disconnectedTimer === null) return;
    globalThis.clearTimeout(this.disconnectedTimer);
    this.disconnectedTimer = null;
  }

  private clearPeerConnectionMonitor(): void {
    this.clearDisconnectedTimer();
    if (this.monitoredPeerConnection && this.peerConnectionStateHandler) {
      this.monitoredPeerConnection.removeEventListener('connectionstatechange', this.peerConnectionStateHandler);
    }
    this.monitoredPeerConnection = null;
    this.peerConnectionStateHandler = null;
  }
}
