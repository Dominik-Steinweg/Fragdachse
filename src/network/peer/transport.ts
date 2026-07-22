/**
 * Grenze zwischen Raumlogik und konkreter WebRTC-/PeerJS-Implementierung.
 *
 * `PeerRoom` kennt ausschließlich diese Schnittstelle. Damit hängt die gesamte
 * Zustands-, Roster- und RPC-Logik nicht an PeerJS und ist ohne echte WebRTC-Verbindung
 * testbar; die einzige Datei mit PeerJS-Bezug ist `PeerJsTransport`.
 */
import type { PeerNetworkError } from './PeerSignaling';
import type { PeerChannelKind, PeerMessage } from './protocol';

/** Eine gerichtete Verbindung zur Gegenseite (Host↔Client). */
export interface PeerLinkLike {
  /** Transportinterne Broker-ID. Nur für Diagnose und als Map-Schlüssel. */
  readonly remotePeerId: string;
  /** Spiel-seitige Spieler-ID der Gegenseite; erst nach dem Handshake gesetzt. */
  playerId: string;
  send(message: PeerMessage, channel: PeerChannelKind): void;
  close(): void;
}

export interface PeerTransportHandlers {
  /**
   * Ein Link existiert und wird gleich geöffnet – so früh wie möglich gemeldet.
   *
   * Die Trennung von `onLinkReady` ist zwingend: Der Handshake der Gegenseite kann bereits
   * verarbeitet werden, während dieser Link noch aufgeht. Wäre er dem Raum zu diesem Zeitpunkt
   * unbekannt, gingen alle Zustände, die der Host während des Handshakes veröffentlicht
   * (Farbe, Team, Lobby-Snapshot), an alle *anderen* Verbindungen – nur nicht an die neue.
   */
  onLinkRegistered: (link: PeerLinkLike) => void;
  /** Beide Kanäle sind offen; erst jetzt darf gesendet werden. */
  onLinkReady: (link: PeerLinkLike) => void;
  onMessage: (link: PeerLinkLike, message: PeerMessage, channel: PeerChannelKind) => void;
  onLinkClosed: (link: PeerLinkLike) => void;
  /** Nicht behebbarer Fehler; der Raum ist danach unbrauchbar. */
  onFatal: (error: PeerNetworkError) => void;
}

export interface PeerRoomTransport {
  readonly isHost: boolean;
  setHandlers(handlers: PeerTransportHandlers): void;
  /**
   * Host: beginnt, eingehende Verbindungen anzunehmen (löst sofort auf).
   * Client: baut die Verbindung zum Host auf und löst auf, sobald der Link offen ist.
   */
  start(): Promise<void>;
  /** Client-only: baut nach einem Linkabriss eine neue Verbindung zum selben Host auf. */
  reconnect(): Promise<void>;
  destroy(): void;
}
