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
  PEER_FAST_BUFFER_LIMIT_BYTES,
  PEER_FAST_CHANNEL_ID,
  PEER_FAST_CHANNEL_LABEL,
  PEER_FAST_CHANNEL_TIMEOUT_MS,
} from '../../config';
import { createPeerNetworkError } from './PeerSignaling';
import { encodePeerMessage, parsePeerMessage, type PeerChannelKind, type PeerMessage } from './protocol';
import type { PeerLinkLike } from './transport';

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

  playerId = '';

  constructor(private readonly connection: DataConnection) {
    // Sofort lauschen, nicht erst nach open(): die Gegenseite kann ihr 'hello' schicken,
    // waehrend hier noch der schnelle Kanal aufgeht. Bis Handler gesetzt sind, wird gepuffert.
    this.connection.on('data', (data: unknown) => {
      const message = parsePeerMessage(data);
      if (message) this.deliver(message, 'rel');
    });
    this.connection.on('close', () => this.handleRemoteClose());
    this.connection.on('error', () => this.handleRemoteClose());
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

  /**
   * Wartet, bis der zuverlässige Kanal offen ist, legt danach den schnellen Kanal an und
   * wartet auch auf dessen `open`. Erst danach gilt der Link als benutzbar.
   */
  async open(handlers: PeerLinkHandlers): Promise<void> {
    await this.awaitReliableOpen();
    await this.openFastChannel();
    this.handlers = handlers;
    const queued = this.inbox;
    this.inbox = [];
    for (const item of queued) handlers.onMessage(item.message, item.channel);
    if (this.closed) handlers.onClose();
  }

  send(message: PeerMessage, channel: PeerChannelKind): void {
    if (this.closed) return;
    const payload = encodePeerMessage(message);

    if (channel === 'fast' && this.fastChannel?.readyState === 'open') {
      // Ueberlaufender Sendepuffer heisst: die Leitung kommt nicht hinterher. Bei ersetzbaren
      // Daten ist Verwerfen richtig – der naechste Snapshot ist ohnehin aktueller.
      if (this.fastChannel.bufferedAmount > PEER_FAST_BUFFER_LIMIT_BYTES) {
        this.droppedFastMessages++;
        return;
      }
      this.fastChannel.send(payload);
      return;
    }

    if (!this.connection.open) return;
    this.connection.send(payload);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
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

    const channel = peerConnection.createDataChannel(PEER_FAST_CHANNEL_LABEL, {
      negotiated: true,
      id: PEER_FAST_CHANNEL_ID,
      ordered: false,
      maxRetransmits: 0,
    });
    this.fastChannel = channel;
    channel.addEventListener('message', (event: MessageEvent) => {
      const message = parsePeerMessage(event.data);
      if (message) this.deliver(message, 'fast');
    });

    if (channel.readyState === 'open') return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        window.clearTimeout(timeout);
        channel.removeEventListener('open', onOpen);
        channel.removeEventListener('error', onError);
      };
      const onOpen = (): void => { cleanup(); resolve(); };
      const onError = (): void => { cleanup(); reject(createPeerNetworkError('connection-failed')); };
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(createPeerNetworkError('connection-failed'));
      }, PEER_FAST_CHANNEL_TIMEOUT_MS);
      channel.addEventListener('open', onOpen);
      channel.addEventListener('error', onError);
    });
  }

  private handleRemoteClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.fastChannel = null;
    this.handlers?.onClose();
  }
}
