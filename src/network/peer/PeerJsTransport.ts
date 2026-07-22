/**
 * Einzige Stelle im Projekt, die `peerjs` verwendet.
 *
 * Setzt `PeerRoomTransport` um: Raum eröffnen bzw. betreten, eingehende Verbindungen
 * annehmen, Links vollständig öffnen und Nachrichten weiterreichen. PeerJS dient dabei
 * ausschließlich als Signaling- und ICE-Schicht; Kanäle, Serialisierung und Backpressure
 * gehören PeerLink.
 */
import type { DataConnection, Peer } from 'peerjs';
import { PEER_CONNECT_TIMEOUT_MS } from '../../config';
import { PeerLink } from './PeerLink';
import {
  classifyPeerErrorType,
  createPeerNetworkError,
  openClientPeer,
  openHostPeer,
  roomCodeToPeerId,
} from './PeerSignaling';
import type { PeerLinkLike, PeerRoomTransport, PeerTransportHandlers } from './transport';

export class PeerJsTransport implements PeerRoomTransport {
  private handlers: PeerTransportHandlers | null = null;
  private readonly openLinks = new Set<PeerLink>();
  private signalingReconnectTimer: number | null = null;
  private pendingConnectionReject: ((error: ReturnType<typeof createPeerNetworkError>) => void) | null = null;
  private destroyed = false;

  private constructor(
    private readonly peer: Peer,
    readonly isHost: boolean,
    private readonly roomCode: string,
  ) {
    this.peer.on('error', (error) => {
      const kind = classifyPeerErrorType(error.type);
      const networkError = createPeerNetworkError(kind, error);
      if (!this.isHost && this.pendingConnectionReject) {
        const reject = this.pendingConnectionReject;
        this.pendingConnectionReject = null;
        reject(networkError);
      }
      // Ein bereits stehender Link ueberlebt Broker-Stoerungen: ueber den Broker laufen
      // keine Spieldaten. Fatal ist der Fehler nur ohne aufgebaute Verbindung.
      if ((kind === 'broker-unreachable' && this.openLinks.size > 0)
        || (this.isHost && kind === 'connection-failed')) {
        console.warn('[PeerJsTransport] Broker-Fehler bei bestehender Verbindung:', error.type);
        return;
      }
      this.handlers?.onFatal(networkError);
    });
    this.peer.on('disconnected', () => this.scheduleSignalingReconnect());
    this.peer.on('open', () => this.clearSignalingReconnect());
  }

  static async createHost(): Promise<{ transport: PeerJsTransport; roomCode: string }> {
    const { peer, roomCode } = await openHostPeer();
    return { transport: new PeerJsTransport(peer, true, roomCode), roomCode };
  }

  static async createClient(roomCode: string): Promise<PeerJsTransport> {
    const peer = await openClientPeer();
    return new PeerJsTransport(peer, false, roomCode);
  }

  setHandlers(handlers: PeerTransportHandlers): void {
    this.handlers = handlers;
  }

  async start(): Promise<void> {
    if (this.isHost) {
      this.peer.on('connection', (connection: DataConnection) => {
        void this.openLink(connection).catch((error: unknown) => {
          console.warn('[PeerJsTransport] Eingehende Verbindung nicht aufgebaut:', error);
        });
      });
      return;
    }

    await this.connectToHost();
  }

  async reconnect(): Promise<void> {
    if (this.isHost || this.destroyed) return;
    await this.ensureSignalingConnection();
    await this.connectToHost();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearSignalingReconnect();
    for (const link of this.openLinks) link.close();
    this.openLinks.clear();
    this.peer.destroy();
  }

  /** Alle offenen Links. Ausschließlich für die Transportdiagnose. */
  getLinks(): PeerLink[] {
    return [...this.openLinks];
  }

  private async connectToHost(): Promise<void> {
    const connection = this.peer.connect(roomCodeToPeerId(this.roomCode), {
      reliable: true,
      // 'raw' reicht die Nutzlast unveraendert an dataChannel.send() durch: kein Chunking,
      // kein BinaryPack, keine zusaetzliche Kodierungsschicht.
      serialization: 'raw',
    });
    let timeout = 0;
    let rejectPeerFailure: ((error: ReturnType<typeof createPeerNetworkError>) => void) | null = null;
    const peerFailure = new Promise<never>((_, reject) => {
      rejectPeerFailure = reject;
      this.pendingConnectionReject = reject;
    });
    try {
      await Promise.race([
        this.openLink(connection),
        peerFailure,
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(
            () => reject(createPeerNetworkError('connection-failed')),
            PEER_CONNECT_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      connection.close();
      throw error;
    } finally {
      window.clearTimeout(timeout);
      if (this.pendingConnectionReject === rejectPeerFailure) this.pendingConnectionReject = null;
    }
  }

  private async ensureSignalingConnection(): Promise<void> {
    if (this.peer.open) return;
    if (this.peer.disconnected) {
      try {
        this.peer.reconnect();
      } catch {
        // The bounded wait below reports a useful connection error.
      }
    }
    await new Promise<void>((resolve, reject) => {
      let timeout = 0;
      const cleanup = (): void => {
        window.clearTimeout(timeout);
        this.peer.off('open', onOpen);
        this.peer.off('error', onError);
      };
      const onOpen = (): void => { cleanup(); resolve(); };
      const onError = (error: unknown): void => {
        cleanup();
        reject(createPeerNetworkError('broker-unreachable', error));
      };
      timeout = window.setTimeout(() => {
        cleanup();
        reject(createPeerNetworkError('broker-unreachable'));
      }, PEER_CONNECT_TIMEOUT_MS);
      this.peer.on('open', onOpen);
      this.peer.on('error', onError);
    });
  }

  private scheduleSignalingReconnect(): void {
    if (this.destroyed || this.signalingReconnectTimer !== null) return;
    this.signalingReconnectTimer = window.setTimeout(() => {
      this.signalingReconnectTimer = null;
      if (this.destroyed || !this.peer.disconnected) return;
      try {
        this.peer.reconnect();
      } catch {
        this.scheduleSignalingReconnect();
      }
    }, 500);
  }

  private clearSignalingReconnect(): void {
    if (this.signalingReconnectTimer === null) return;
    window.clearTimeout(this.signalingReconnectTimer);
    this.signalingReconnectTimer = null;
  }

  private async openLink(connection: DataConnection): Promise<void> {
    const link = new PeerLink(connection);
    // Vor dem Oeffnen anmelden: link.open() verarbeitet bereits gepufferte Nachrichten der
    // Gegenseite, und was der Raum dabei verschickt, muss diesen Link schon erreichen.
    this.openLinks.add(link);
    this.handlers?.onLinkRegistered(link);

    try {
      await link.open({
        onMessage: (message, channel) => this.handlers?.onMessage(link, message, channel),
        onClose: () => {
          if (!this.openLinks.delete(link)) return;
          this.handlers?.onLinkClosed(link);
        },
      });
    } catch (error) {
      if (this.openLinks.delete(link)) this.handlers?.onLinkClosed(link);
      link.close();
      throw error;
    }

    if (this.destroyed) {
      link.close();
      return;
    }
    this.handlers?.onLinkReady(link);
  }
}

export type { PeerLinkLike };
