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
  private destroyed = false;

  private constructor(
    private readonly peer: Peer,
    readonly isHost: boolean,
    private readonly roomCode: string,
  ) {
    this.peer.on('error', (error) => {
      const kind = classifyPeerErrorType(error.type);
      // Ein bereits stehender Link ueberlebt Broker-Stoerungen: ueber den Broker laufen
      // keine Spieldaten. Fatal ist der Fehler nur ohne aufgebaute Verbindung.
      if (kind === 'broker-unreachable' && this.openLinks.size > 0) {
        console.warn('[PeerJsTransport] Broker-Fehler bei bestehender Verbindung:', error.type);
        return;
      }
      this.handlers?.onFatal(createPeerNetworkError(kind, error));
    });
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

    const connection = this.peer.connect(roomCodeToPeerId(this.roomCode), {
      reliable: true,
      // 'raw' reicht die Nutzlast unveraendert an dataChannel.send() durch: kein Chunking,
      // kein BinaryPack, keine zusaetzliche Kodierungsschicht.
      serialization: 'raw',
    });

    await Promise.race([
      this.openLink(connection),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(createPeerNetworkError('connection-failed')), PEER_CONNECT_TIMEOUT_MS);
      }),
    ]);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const link of this.openLinks) link.close();
    this.openLinks.clear();
    this.peer.destroy();
  }

  /** Alle offenen Links. Ausschließlich für die Transportdiagnose. */
  getLinks(): PeerLink[] {
    return [...this.openLinks];
  }

  private async openLink(connection: DataConnection): Promise<void> {
    const link = new PeerLink(connection);
    try {
      await link.open({
        onMessage: (message, channel) => this.handlers?.onMessage(link, message, channel),
        onClose: () => {
          if (!this.openLinks.delete(link)) return;
          this.handlers?.onLinkClosed(link);
        },
      });
    } catch (error) {
      link.close();
      throw error;
    }
    if (this.destroyed) {
      link.close();
      return;
    }
    this.openLinks.add(link);
    this.handlers?.onLink(link);
  }
}

export type { PeerLinkLike };
