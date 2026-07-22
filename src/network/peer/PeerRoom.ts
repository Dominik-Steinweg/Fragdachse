/**
 * PeerRoom – die Substratschicht unter NetworkBridge.
 *
 * Bietet genau das, was die Bridge braucht: einen replizierten Key-Value-Store
 * (global und pro Spieler, zuverlässig oder ersetzbar), RPC in beide Richtungen und
 * ein Roster mit Join/Quit-Callbacks.
 *
 * Topologie ist ein Stern: Clients verbinden sich ausschließlich zum Host. Der Host ist
 * die einzige Instanz, die Zustände weiterreicht; Clients sprechen nie miteinander.
 * Es gibt keinen Hostwechsel – verlässt der Host den Raum, endet der Raum.
 *
 * Schreibsemantik (bewusst identisch zu der Bibliothek, die hier ersetzt wurde):
 * Ein lokaler Schreibvorgang wirkt sofort lokal und wird danach verteilt. `setLocalReady(true)`
 * gefolgt von `getPlayerReady(localId)` liefert ohne Netzwerk-Roundtrip `true`.
 */
import { MAX_PLAYERS } from '../../config';
import { createPeerNetworkError, type PeerNetworkError } from './PeerSignaling';
import {
  PEER_PROTOCOL_VERSION,
  type BatchMessage,
  type PeerChannelKind,
  type PeerMessage,
  type RosterEntry,
} from './protocol';
import type { PeerLinkLike, PeerRoomTransport } from './transport';

/** Schmales Gegenstück zu einem Spieler-Zustandsobjekt, wie die Bridge es erwartet. */
export interface PeerPlayerHandle {
  readonly id: string;
  getState(key: string): unknown;
  setState(key: string, value: unknown, reliable?: boolean): void;
  onQuit(callback: () => void): void;
}

export type PeerRpcHandler = (payload: unknown, senderId: string) => Promise<unknown> | unknown;

export interface PeerRoomOptions {
  /**
   * Per-Spieler-Keys, die der Host NICHT an die übrigen Clients weiterreicht.
   * Für Daten, die ausschließlich der Host liest (z. B. Bewegungseingaben) – spart bei
   * voller Lobby den Großteil des Relay-Verkehrs.
   */
  hostOnlyPlayerKeys?: readonly string[];
}

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Sammelt ausgehende ersetzbare Schreibvorgänge eines Links bis zum nächsten Flush.
 * Pro Key gewinnt der letzte Wert – genau das Verhalten, das ersetzbare Daten brauchen.
 */
class OutboundBuffer {
  private readonly globals = new Map<string, unknown>();
  private readonly players = new Map<string, [string, string, unknown]>();

  queueGlobal(key: string, value: unknown): void {
    this.globals.set(key, value);
  }

  queuePlayer(playerId: string, key: string, value: unknown): void {
    this.players.set(`${playerId} ${key}`, [playerId, key, value]);
  }

  drain(): BatchMessage | null {
    if (this.globals.size === 0 && this.players.size === 0) return null;
    const message: BatchMessage = { t: 'b' };
    if (this.globals.size > 0) message.g = [...this.globals.entries()];
    if (this.players.size > 0) message.p = [...this.players.values()];
    this.globals.clear();
    this.players.clear();
    return message;
  }
}

export class PeerRoom {
  private readonly links = new Set<PeerLinkLike>();
  private readonly fastBuffers = new Map<PeerLinkLike, OutboundBuffer>();
  private readonly globalState = new Map<string, unknown>();
  private readonly playerStates = new Map<string, Map<string, unknown>>();
  private readonly playerHandles = new Map<string, PeerPlayerHandle>();
  private readonly quitCallbacks = new Map<string, Array<() => void>>();
  private readonly hostOnlyPlayerKeys: ReadonlySet<string>;

  private readonly joinCallbacks: Array<(handle: PeerPlayerHandle) => void> = [];
  private readonly playerQuitCallbacks: Array<(playerId: string) => void> = [];
  private fatalCallback: ((error: PeerNetworkError) => void) | null = null;

  private readonly hostHandlers = new Map<string, PeerRpcHandler>();
  private readonly allHandlers = new Map<string, PeerRpcHandler>();
  private readonly pendingRpcs = new Map<number, PendingRpc>();
  private nextRpcCorrelation = 1;

  private hostLink: PeerLinkLike | null = null;
  private localPlayerId = '';
  private hostPlayerId = '';
  private welcomeReceived: (() => void) | null = null;
  private destroyed = false;

  constructor(private readonly transport: PeerRoomTransport, options: PeerRoomOptions = {}) {
    this.hostOnlyPlayerKeys = new Set(options.hostOnlyPlayerKeys ?? []);
    this.transport.setHandlers({
      onLinkRegistered: (link) => this.handleLinkRegistered(link),
      onLinkReady: (link) => this.handleLinkReady(link),
      onMessage: (link, message, channel) => this.handleMessage(link, message, channel),
      onLinkClosed: (link) => this.handleLinkClosed(link),
      onFatal: (error) => this.reportFatal(error),
    });
  }

  /**
   * Startet den Transport. Der Host ist danach sofort bereit; der Client löst erst auf,
   * wenn der Host mit `welcome` geantwortet hat – erst dann steht der vollständige
   * Ausgangszustand lokal bereit.
   */
  async start(): Promise<void> {
    if (this.transport.isHost) {
      this.localPlayerId = 'p0';
      this.hostPlayerId = 'p0';
      this.playerStates.set('p0', new Map());
      await this.transport.start();
      this.emitJoin('p0');
      return;
    }

    const welcome = new Promise<void>((resolve) => { this.welcomeReceived = resolve; });
    await this.transport.start();
    await welcome;
  }

  // ── Identität und Roster ──────────────────────────────────────────────────

  isHost(): boolean {
    return this.transport.isHost;
  }

  getLocalPlayerId(): string {
    return this.localPlayerId;
  }

  getHostPlayerId(): string {
    return this.hostPlayerId;
  }

  getPlayerIds(): string[] {
    return [...this.playerStates.keys()];
  }

  getPlayerHandle(playerId: string): PeerPlayerHandle | undefined {
    return this.playerHandles.get(playerId);
  }

  onPlayerJoin(callback: (handle: PeerPlayerHandle) => void): void {
    this.joinCallbacks.push(callback);
    for (const handle of this.playerHandles.values()) callback(handle);
  }

  onPlayerQuit(callback: (playerId: string) => void): void {
    this.playerQuitCallbacks.push(callback);
  }

  onFatal(callback: (error: PeerNetworkError) => void): void {
    this.fatalCallback = callback;
  }

  // ── Store ─────────────────────────────────────────────────────────────────

  getGlobal(key: string): unknown {
    return this.globalState.get(key);
  }

  setGlobal(key: string, value: unknown, reliable = false): void {
    this.globalState.set(key, value);
    if (reliable) this.sendToLinks({ t: 'b', g: [[key, value]] }, 'rel', null);
    else for (const buffer of this.fastBuffers.values()) buffer.queueGlobal(key, value);
  }

  getPlayerState(playerId: string, key: string): unknown {
    return this.playerStates.get(playerId)?.get(key);
  }

  setPlayerState(playerId: string, key: string, value: unknown, reliable = false): void {
    this.applyPlayerState(playerId, key, value);
    if (this.isSuppressedRelayKey(key)) {
      // Host-only-Key: der Host verteilt ihn grundsaetzlich nicht weiter. Ein Client
      // schickt ihn weiterhin an den Host, denn genau dort wird er gelesen.
      if (this.transport.isHost) return;
    }
    if (reliable) this.sendToLinks({ t: 'b', p: [[playerId, key, value]] }, 'rel', null);
    else this.queueFastPlayerState(playerId, key, value, null);
  }

  /** Verschickt gesammelte ersetzbare Schreibvorgänge. Einmal pro Frame aufrufen. */
  update(): void {
    if (this.destroyed) return;
    for (const [link, buffer] of this.fastBuffers) {
      const batch = buffer.drain();
      if (batch) link.send(batch, 'fast');
    }
  }

  private applyPlayerState(playerId: string, key: string, value: unknown): void {
    let state = this.playerStates.get(playerId);
    if (!state) {
      state = new Map();
      this.playerStates.set(playerId, state);
    }
    state.set(key, value);
  }

  private isSuppressedRelayKey(key: string): boolean {
    return this.hostOnlyPlayerKeys.has(key);
  }

  private queueFastPlayerState(playerId: string, key: string, value: unknown, origin: PeerLinkLike | null): void {
    if (this.transport.isHost && this.isSuppressedRelayKey(key)) return;
    for (const [link, buffer] of this.fastBuffers) {
      if (link === origin) continue;
      buffer.queuePlayer(playerId, key, value);
    }
  }

  // ── RPC ───────────────────────────────────────────────────────────────────

  registerHostHandler(name: string, handler: PeerRpcHandler): void {
    this.hostHandlers.set(name, handler);
  }

  registerAllHandler(name: string, handler: PeerRpcHandler): void {
    this.allHandlers.set(name, handler);
  }

  /** Client → Host ohne Antwort. Auf dem Host wird direkt lokal ausgeführt. */
  sendHost(name: string, payload: unknown): void {
    if (this.transport.isHost) {
      void this.invokeHostHandler(name, payload, this.localPlayerId);
      return;
    }
    this.hostLink?.send({ t: 'rpc', c: 0, n: name, d: payload }, 'rel');
  }

  /** Client → Host mit Antwort. */
  callHost(name: string, payload: unknown, timeoutMs: number): Promise<unknown> {
    if (this.transport.isHost) {
      return Promise.resolve(this.invokeHostHandler(name, payload, this.localPlayerId));
    }
    const hostLink = this.hostLink;
    if (!hostLink) return Promise.reject(new Error(`RPC ohne Hostverbindung: ${name}`));

    const correlation = this.nextRpcCorrelation++;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRpcs.delete(correlation);
        reject(new Error(`RPC timeout: ${name}`));
      }, timeoutMs);
      this.pendingRpcs.set(correlation, { resolve, reject, timeout });
      hostLink.send({ t: 'rpc', c: correlation, n: name, d: payload }, 'rel');
    });
  }

  /** An alle Teilnehmer inklusive der eigenen Instanz. */
  broadcast(name: string, payload: unknown): void {
    void this.dispatchAllHandler(name, payload, this.localPlayerId);
    this.sendToLinks({ t: 'rpc', c: 0, n: name, d: payload, s: this.localPlayerId }, 'rel', null);
  }

  private invokeHostHandler(name: string, payload: unknown, senderId: string): Promise<unknown> | unknown {
    const handler = this.hostHandlers.get(name);
    if (!handler) return undefined;
    return handler(payload, senderId);
  }

  private dispatchAllHandler(name: string, payload: unknown, senderId: string): Promise<unknown> | unknown {
    const handler = this.allHandlers.get(name);
    if (!handler) return undefined;
    return handler(payload, senderId);
  }

  // ── Nachrichtenverarbeitung ───────────────────────────────────────────────

  private handleMessage(link: PeerLinkLike, message: PeerMessage, channel: PeerChannelKind): void {
    if (this.transport.isHost) this.handleHostMessage(link, message, channel);
    else this.handleClientMessage(link, message);
  }

  private handleHostMessage(link: PeerLinkLike, message: PeerMessage, channel: PeerChannelKind): void {
    switch (message.t) {
      case 'hello':
        this.completeHandshake(link, message.v);
        return;
      case 'b':
        this.applyBatch(message);
        this.relayBatch(message, link, channel);
        return;
      case 'rpc':
        this.handleHostRpc(link, message.c, message.n, message.d, channel);
        return;
      default:
        return;
    }
  }

  private handleClientMessage(link: PeerLinkLike, message: PeerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.applyWelcome(link, message);
        return;
      case 'join':
        this.playerStates.set(message.id, new Map(Object.entries(message.s)));
        this.emitJoin(message.id);
        return;
      case 'quit':
        this.removePlayer(message.id);
        return;
      case 'b':
        this.applyBatch(message);
        return;
      case 'rpc':
        void this.dispatchAllHandler(message.n, message.d, message.s ?? this.hostPlayerId);
        return;
      case 'res': {
        const pending = this.pendingRpcs.get(message.c);
        if (!pending) return;
        this.pendingRpcs.delete(message.c);
        clearTimeout(pending.timeout);
        pending.resolve(message.d);
        return;
      }
      default:
        return;
    }
  }

  private completeHandshake(link: PeerLinkLike, version: number): void {
    if (version !== PEER_PROTOCOL_VERSION) {
      console.warn(`[PeerRoom] Protokollversion passt nicht (Gegenseite ${version}, hier ${PEER_PROTOCOL_VERSION}).`);
      link.close();
      return;
    }
    if (link.playerId.length > 0) return;
    if (this.playerStates.size >= MAX_PLAYERS) {
      console.warn('[PeerRoom] Raum ist voll, Verbindung wird abgewiesen.');
      link.close();
      return;
    }

    const playerId = this.allocatePlayerId();
    link.playerId = playerId;
    this.playerStates.set(playerId, new Map());

    const roster: RosterEntry[] = this.getPlayerIds().map((id) => ({ id }));
    link.send({
      t: 'welcome',
      v: PEER_PROTOCOL_VERSION,
      id: playerId,
      h: this.hostPlayerId,
      roster,
      g: Object.fromEntries(this.globalState),
      p: Object.fromEntries([...this.playerStates].map(([id, state]) => [id, Object.fromEntries(state)])),
    }, 'rel');

    for (const other of this.links) {
      if (other !== link) other.send({ t: 'join', id: playerId, s: {} }, 'rel');
    }

    this.emitJoin(playerId);
  }

  private applyWelcome(
    link: PeerLinkLike,
    message: Extract<PeerMessage, { t: 'welcome' }>,
  ): void {
    if (message.v !== PEER_PROTOCOL_VERSION) {
      this.reportFatal(createPeerNetworkError('protocol-mismatch'));
      return;
    }
    if (this.localPlayerId.length > 0) return;

    link.playerId = message.h;
    this.localPlayerId = message.id;
    this.hostPlayerId = message.h;

    this.globalState.clear();
    for (const [key, value] of Object.entries(message.g)) this.globalState.set(key, value);

    this.playerStates.clear();
    for (const [playerId, state] of Object.entries(message.p)) {
      this.playerStates.set(playerId, new Map(Object.entries(state)));
    }
    if (!this.playerStates.has(message.id)) this.playerStates.set(message.id, new Map());

    for (const entry of message.roster) this.emitJoin(entry.id);
    this.emitJoin(message.id);

    const resolve = this.welcomeReceived;
    this.welcomeReceived = null;
    resolve?.();
  }

  private applyBatch(message: BatchMessage): void {
    for (const [key, value] of message.g ?? []) this.globalState.set(key, value);
    for (const [playerId, key, value] of message.p ?? []) this.applyPlayerState(playerId, key, value);
  }

  private relayBatch(message: BatchMessage, origin: PeerLinkLike, channel: PeerChannelKind): void {
    const players = (message.p ?? []).filter(([, key]) => !this.isSuppressedRelayKey(key));

    if (channel === 'rel') {
      const relayed: BatchMessage = { t: 'b' };
      if (message.g) relayed.g = message.g;
      if (players.length > 0) relayed.p = players;
      if (!relayed.g && !relayed.p) return;
      this.sendToLinks(relayed, 'rel', origin);
      return;
    }

    for (const [key, value] of message.g ?? []) {
      for (const [link, buffer] of this.fastBuffers) {
        if (link !== origin) buffer.queueGlobal(key, value);
      }
    }
    for (const [playerId, key, value] of players) {
      this.queueFastPlayerState(playerId, key, value, origin);
    }
  }

  private handleHostRpc(
    link: PeerLinkLike,
    correlation: number,
    name: string,
    payload: unknown,
    channel: PeerChannelKind,
  ): void {
    const senderId = link.playerId;
    if (this.hostHandlers.has(name)) {
      const result = this.invokeHostHandler(name, payload, senderId);
      if (correlation <= 0) return;
      void Promise.resolve(result)
        .then((value) => link.send({ t: 'res', c: correlation, d: value }, channel))
        .catch((error: unknown) => {
          console.error(error);
          link.send({ t: 'res', c: correlation, d: undefined }, channel);
        });
      return;
    }

    if (!this.allHandlers.has(name)) return;
    // Broadcast eines Clients: lokal ausfuehren und an alle uebrigen weiterreichen. Die
    // Absender-ID setzt ausschliesslich der Host, damit sie nicht faelschbar ist.
    void this.dispatchAllHandler(name, payload, senderId);
    this.sendToLinks({ t: 'rpc', c: 0, n: name, d: payload, s: senderId }, 'rel', link);
  }

  private sendToLinks(message: PeerMessage, channel: PeerChannelKind, origin: PeerLinkLike | null): void {
    for (const link of this.links) {
      if (link === origin) continue;
      link.send(message, channel);
    }
  }

  // ── Lebenszyklus ──────────────────────────────────────────────────────────

  private handleLinkRegistered(link: PeerLinkLike): void {
    this.links.add(link);
    this.fastBuffers.set(link, new OutboundBuffer());
    if (!this.transport.isHost) this.hostLink = link;
  }

  private handleLinkReady(link: PeerLinkLike): void {
    if (this.transport.isHost) return;
    link.send({ t: 'hello', v: PEER_PROTOCOL_VERSION }, 'rel');
  }

  private handleLinkClosed(link: PeerLinkLike): void {
    if (!this.links.delete(link)) return;
    this.fastBuffers.delete(link);

    if (!this.transport.isHost) {
      this.hostLink = null;
      if (this.hostPlayerId.length > 0) this.removePlayer(this.hostPlayerId);
      this.reportFatal(createPeerNetworkError('host-left'));
      return;
    }

    const playerId = link.playerId;
    if (playerId.length === 0) return;
    this.removePlayer(playerId);
    this.sendToLinks({ t: 'quit', id: playerId }, 'rel', null);
  }

  private allocatePlayerId(): string {
    for (let index = 0; index < MAX_PLAYERS; index++) {
      const candidate = `p${index.toString(36)}`;
      if (!this.playerStates.has(candidate)) return candidate;
    }
    // Kann nicht auftreten: completeHandshake prueft MAX_PLAYERS vorher.
    throw createPeerNetworkError('room-full');
  }

  private emitJoin(playerId: string): void {
    if (this.playerHandles.has(playerId)) return;
    const handle = this.createHandle(playerId);
    this.playerHandles.set(playerId, handle);
    for (const callback of this.joinCallbacks) callback(handle);
  }

  private createHandle(playerId: string): PeerPlayerHandle {
    return {
      id: playerId,
      getState: (key: string) => this.getPlayerState(playerId, key),
      setState: (key: string, value: unknown, reliable = false) => this.setPlayerState(playerId, key, value, reliable),
      onQuit: (callback: () => void) => {
        const callbacks = this.quitCallbacks.get(playerId) ?? [];
        callbacks.push(callback);
        this.quitCallbacks.set(playerId, callbacks);
      },
    };
  }

  private removePlayer(playerId: string): void {
    if (!this.playerHandles.has(playerId)) return;
    this.playerHandles.delete(playerId);
    this.playerStates.delete(playerId);
    for (const callback of this.quitCallbacks.get(playerId) ?? []) callback();
    this.quitCallbacks.delete(playerId);
    for (const callback of this.playerQuitCallbacks) callback(playerId);
  }

  private reportFatal(error: PeerNetworkError): void {
    if (this.destroyed) return;
    if (this.fatalCallback) this.fatalCallback(error);
    else console.error(error);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const pending of this.pendingRpcs.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('PeerRoom destroyed'));
    }
    this.pendingRpcs.clear();
    this.links.clear();
    this.fastBuffers.clear();
    this.transport.destroy();
  }
}
