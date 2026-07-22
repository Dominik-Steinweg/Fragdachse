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
import {
  MAX_PLAYERS,
  PEER_HANDSHAKE_TIMEOUT_MS,
  PEER_RECONNECT_MAX_DELAY_MS,
  PEER_RESUME_GRACE_MS,
} from '../../config';
import { createPeerNetworkError, type PeerNetworkError } from './PeerSignaling';
import {
  PEER_PROTOCOL_VERSION,
  type BatchMessage,
  type PeerChannelKind,
  type PeerMessage,
  type RosterEntry,
} from './protocol';
import type { PeerLinkLike, PeerRoomTransport } from './transport';

let temporaryResumeTokenSequence = 0;

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
  /** Stable per-room client token used only for the short resume window. */
  resumeToken?: string;
}

export type PeerReconnectStatus =
  | { state: 'reconnecting' | 'resumed' | 'failed' }
  | { state: 'player-disconnected' | 'player-resumed' | 'player-expired'; playerId: string };

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingHandshake {
  resolve: () => void;
  reject: (error: PeerNetworkError) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface ResumeSlot {
  playerId: string;
  link: PeerLinkLike | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
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
  private readonly fastSendSequences = new Map<PeerLinkLike, number>();
  private readonly fastReceiveSequences = new Map<PeerLinkLike, number>();
  private readonly globalState = new Map<string, unknown>();
  private readonly playerStates = new Map<string, Map<string, unknown>>();
  private readonly playerHandles = new Map<string, PeerPlayerHandle>();
  private readonly quitCallbacks = new Map<string, Array<() => void>>();
  private readonly hostOnlyPlayerKeys: ReadonlySet<string>;
  private readonly resumeToken: string;
  private readonly resumeSlots = new Map<string, ResumeSlot>();
  private readonly linkResumeTokens = new Map<PeerLinkLike, string>();

  private readonly joinCallbacks: Array<(handle: PeerPlayerHandle) => void> = [];
  private readonly playerQuitCallbacks: Array<(playerId: string) => void> = [];
  private fatalCallback: ((error: PeerNetworkError) => void) | null = null;
  private reconnectStatusCallback: ((status: PeerReconnectStatus) => void) | null = null;

  private readonly hostHandlers = new Map<string, PeerRpcHandler>();
  private readonly allHandlers = new Map<string, PeerRpcHandler>();
  private readonly pendingRpcs = new Map<number, PendingRpc>();
  private nextRpcCorrelation = 1;

  private hostLink: PeerLinkLike | null = null;
  private localPlayerId = '';
  private hostPlayerId = '';
  private pendingHandshake: PendingHandshake | null = null;
  private reconnecting = false;
  private reconnectDelayTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private readonly transport: PeerRoomTransport, options: PeerRoomOptions = {}) {
    this.hostOnlyPlayerKeys = new Set(options.hostOnlyPlayerKeys ?? []);
    this.resumeToken = options.resumeToken ?? `temporary-client-token-${++temporaryResumeTokenSequence}`;
    this.transport.setHandlers({
      onLinkRegistered: (link) => this.handleLinkRegistered(link),
      onLinkReady: (link) => this.handleLinkReady(link),
      onMessage: (link, message, channel) => this.handleMessage(link, message, channel),
      onLinkClosed: (link) => this.handleLinkClosed(link),
      onFatal: (error) => this.handleTransportFatal(error),
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

    const welcome = this.createHandshakeWaiter();
    try {
      await Promise.all([this.transport.start(), welcome]);
    } catch (error) {
      this.rejectHandshake(this.asPeerError(error));
      throw error;
    }
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

  onReconnectStatus(callback: (status: PeerReconnectStatus) => void): void {
    this.reconnectStatusCallback = callback;
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
      if (!batch) continue;
      const sequence = (this.fastSendSequences.get(link) ?? 0) + 1;
      this.fastSendSequences.set(link, sequence);
      batch.q = sequence;
      link.send(batch, 'fast');
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
    if (message.t === 'b' && channel === 'fast' && !this.acceptFastBatch(link, message)) return;
    if (this.transport.isHost) this.handleHostMessage(link, message, channel);
    else this.handleClientMessage(link, message, channel);
  }

  private handleHostMessage(link: PeerLinkLike, message: PeerMessage, channel: PeerChannelKind): void {
    switch (message.t) {
      case 'hello':
        this.completeHandshake(link, message.v, message.k, message.r === true);
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

  private handleClientMessage(
    link: PeerLinkLike,
    message: PeerMessage,
    _channel: PeerChannelKind,
  ): void {
    switch (message.t) {
      case 'welcome':
        this.applyWelcome(link, message);
        return;
      case 'reject':
        this.rejectHandshake(createPeerNetworkError(message.k));
        link.close();
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

  private acceptFastBatch(link: PeerLinkLike, message: BatchMessage): boolean {
    if (message.q === undefined) return false;
    const lastSeen = this.fastReceiveSequences.get(link) ?? 0;
    if (message.q <= lastSeen) return false;
    this.fastReceiveSequences.set(link, message.q);
    return true;
  }

  private completeHandshake(
    link: PeerLinkLike,
    version: number,
    resumeToken: string,
    isResume: boolean,
  ): void {
    if (version !== PEER_PROTOCOL_VERSION) {
      console.warn(`[PeerRoom] Protokollversion passt nicht (Gegenseite ${version}, hier ${PEER_PROTOCOL_VERSION}).`);
      link.send({ t: 'reject', k: 'protocol-mismatch' }, 'rel');
      link.close();
      return;
    }
    if (link.playerId.length > 0) return;

    const existing = this.resumeSlots.get(resumeToken);
    if (existing) {
      if (existing.link && existing.link !== link) {
        link.send({ t: 'reject', k: 'resume-expired' }, 'rel');
        link.close();
        return;
      }
      if (existing.expiryTimer) clearTimeout(existing.expiryTimer);
      existing.expiryTimer = null;
      existing.link = link;
      link.playerId = existing.playerId;
      this.linkResumeTokens.set(link, resumeToken);
      this.sendWelcome(link, existing.playerId);
      this.reconnectStatusCallback?.({ state: 'player-resumed', playerId: existing.playerId });
      return;
    }

    if (isResume) {
      link.send({ t: 'reject', k: 'resume-expired' }, 'rel');
      link.close();
      return;
    }
    if (this.playerStates.size >= MAX_PLAYERS) {
      console.warn('[PeerRoom] Raum ist voll, Verbindung wird abgewiesen.');
      link.send({ t: 'reject', k: 'room-full' }, 'rel');
      link.close();
      return;
    }

    const playerId = this.allocatePlayerId();
    link.playerId = playerId;
    this.playerStates.set(playerId, new Map());
    this.resumeSlots.set(resumeToken, { playerId, link, expiryTimer: null });
    this.linkResumeTokens.set(link, resumeToken);

    this.sendWelcome(link, playerId);

    for (const other of this.links) {
      if (other !== link) other.send({ t: 'join', id: playerId, s: {} }, 'rel');
    }

    this.emitJoin(playerId);
  }

  private sendWelcome(link: PeerLinkLike, playerId: string): void {
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
  }

  private applyWelcome(
    link: PeerLinkLike,
    message: Extract<PeerMessage, { t: 'welcome' }>,
  ): void {
    if (message.v !== PEER_PROTOCOL_VERSION) {
      this.reportFatal(createPeerNetworkError('protocol-mismatch'));
      return;
    }
    const wasReconnect = this.reconnecting;

    link.playerId = message.h;
    this.localPlayerId = message.id;
    this.hostPlayerId = message.h;

    this.globalState.clear();
    for (const [key, value] of Object.entries(message.g)) this.globalState.set(key, value);

    const incomingPlayerIds = new Set([...Object.keys(message.p), message.id]);
    for (const playerId of [...this.playerHandles.keys()]) {
      if (!incomingPlayerIds.has(playerId)) this.removePlayer(playerId);
    }
    this.playerStates.clear();
    for (const [playerId, state] of Object.entries(message.p)) {
      this.playerStates.set(playerId, new Map(Object.entries(state)));
    }
    if (!this.playerStates.has(message.id)) this.playerStates.set(message.id, new Map());

    for (const entry of message.roster) this.emitJoin(entry.id);
    this.emitJoin(message.id);

    this.resolveHandshake();
    if (wasReconnect) {
      this.reconnecting = false;
      this.reconnectStatusCallback?.({ state: 'resumed' });
    }
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
    this.fastSendSequences.set(link, 0);
    this.fastReceiveSequences.set(link, 0);
    if (!this.transport.isHost) this.hostLink = link;
  }

  private handleLinkReady(link: PeerLinkLike): void {
    if (this.transport.isHost) return;
    this.armHandshakeTimeout();
    link.send({
      t: 'hello',
      v: PEER_PROTOCOL_VERSION,
      k: this.resumeToken,
      r: this.reconnecting || undefined,
    }, 'rel');
  }

  private handleLinkClosed(link: PeerLinkLike): void {
    if (!this.links.delete(link)) return;
    this.fastBuffers.delete(link);
    this.fastSendSequences.delete(link);
    this.fastReceiveSequences.delete(link);

    if (!this.transport.isHost) {
      if (this.hostLink === link) this.hostLink = null;
      if (this.localPlayerId.length === 0) {
        this.rejectHandshake(createPeerNetworkError('connection-failed'));
        return;
      }
      this.beginReconnect();
      return;
    }

    const playerId = link.playerId;
    if (playerId.length === 0) return;
    const token = this.linkResumeTokens.get(link);
    this.linkResumeTokens.delete(link);
    if (!token) return;
    const slot = this.resumeSlots.get(token);
    if (!slot || slot.link !== link) return;
    slot.link = null;
    this.reconnectStatusCallback?.({ state: 'player-disconnected', playerId });
    slot.expiryTimer = setTimeout(() => this.expireResumeSlot(token, slot), PEER_RESUME_GRACE_MS);
  }

  private expireResumeSlot(token: string, slot: ResumeSlot): void {
    if (this.destroyed || this.resumeSlots.get(token) !== slot || slot.link) return;
    this.resumeSlots.delete(token);
    slot.expiryTimer = null;
    this.removePlayer(slot.playerId);
    this.sendToLinks({ t: 'quit', id: slot.playerId }, 'rel', null);
    this.reconnectStatusCallback?.({ state: 'player-expired', playerId: slot.playerId });
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

  private createHandshakeWaiter(): Promise<void> {
    if (this.pendingHandshake) {
      this.rejectHandshake(createPeerNetworkError('connection-failed'));
    }
    return new Promise<void>((resolve, reject) => {
      this.pendingHandshake = { resolve, reject, timer: null };
    });
  }

  private armHandshakeTimeout(): void {
    const pending = this.pendingHandshake;
    if (!pending || pending.timer) return;
    pending.timer = setTimeout(() => {
      this.rejectHandshake(createPeerNetworkError('connection-failed'));
      this.hostLink?.close();
    }, PEER_HANDSHAKE_TIMEOUT_MS);
  }

  private resolveHandshake(): void {
    const pending = this.pendingHandshake;
    if (!pending) return;
    this.pendingHandshake = null;
    if (pending.timer) clearTimeout(pending.timer);
    pending.resolve();
  }

  private rejectHandshake(error: PeerNetworkError): void {
    const pending = this.pendingHandshake;
    if (!pending) return;
    this.pendingHandshake = null;
    if (pending.timer) clearTimeout(pending.timer);
    pending.reject(error);
  }

  private beginReconnect(): void {
    if (this.destroyed || this.reconnecting) return;
    this.reconnecting = true;
    this.reconnectStatusCallback?.({ state: 'reconnecting' });
    void this.reconnectWithinGracePeriod();
  }

  private async reconnectWithinGracePeriod(): Promise<void> {
    const deadline = Date.now() + PEER_RESUME_GRACE_MS;
    let delayMs = 0;

    while (!this.destroyed && Date.now() < deadline) {
      if (delayMs > 0) await this.waitForReconnectDelay(Math.min(delayMs, deadline - Date.now()));
      if (this.destroyed || Date.now() >= deadline) break;

      const welcome = this.createHandshakeWaiter();
      try {
        await Promise.all([this.transport.reconnect(), welcome]);
        return;
      } catch (error) {
        const peerError = this.asPeerError(error);
        this.rejectHandshake(peerError);
        if (peerError.kind === 'protocol-mismatch'
          || peerError.kind === 'room-full'
          || peerError.kind === 'resume-expired') {
          this.finishFailedReconnect(peerError);
          return;
        }
      }
      delayMs = delayMs === 0 ? 500 : Math.min(delayMs * 2, PEER_RECONNECT_MAX_DELAY_MS);
    }

    if (!this.destroyed) this.finishFailedReconnect(createPeerNetworkError('resume-expired'));
  }

  private waitForReconnectDelay(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.reconnectDelayTimer = setTimeout(() => {
        this.reconnectDelayTimer = null;
        resolve();
      }, Math.max(0, delayMs));
    });
  }

  private finishFailedReconnect(error: PeerNetworkError): void {
    this.reconnecting = false;
    this.reconnectStatusCallback?.({ state: 'failed' });
    this.reportFatal(error.kind === 'resume-expired' ? error : createPeerNetworkError(error.kind, error));
  }

  private handleTransportFatal(error: PeerNetworkError): void {
    if (this.pendingHandshake) {
      this.rejectHandshake(error);
      return;
    }
    if (!this.reconnecting) this.reportFatal(error);
  }

  private asPeerError(error: unknown): PeerNetworkError {
    return error instanceof Error && error.name === 'PeerNetworkError'
      ? error as PeerNetworkError
      : createPeerNetworkError('connection-failed', error);
  }

  private reportFatal(error: PeerNetworkError): void {
    if (this.destroyed) return;
    if (this.fatalCallback) this.fatalCallback(error);
    else console.error(error);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.reconnectDelayTimer) clearTimeout(this.reconnectDelayTimer);
    this.reconnectDelayTimer = null;
    for (const slot of this.resumeSlots.values()) {
      if (slot.expiryTimer) clearTimeout(slot.expiryTimer);
    }
    this.resumeSlots.clear();
    this.linkResumeTokens.clear();
    this.rejectHandshake(createPeerNetworkError('connection-failed'));
    for (const pending of this.pendingRpcs.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('PeerRoom destroyed'));
    }
    this.pendingRpcs.clear();
    this.links.clear();
    this.fastBuffers.clear();
    this.fastSendSequences.clear();
    this.fastReceiveSequences.clear();
    this.transport.destroy();
  }
}
