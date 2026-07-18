import type { GameplayTransportMode } from '../types';

export const GAMEPLAY_COMMAND_STATE_KEY = 'gcb';
export const GAMEPLAY_COMMAND_ACK_STATE_KEY = 'gca';
export const GAMEPLAY_EVENT_STATE_KEY = 'geb';
export const GAMEPLAY_EVENT_ACK_STATE_KEY = 'gea';

export const GAMEPLAY_FAST_RESEND_MS = 50;
export const GAMEPLAY_RPC_FALLBACK_MS = 180;
export const GAMEPLAY_MESSAGE_MAX_AGE_MS = 2000;
export const GAMEPLAY_PENDING_SOFT_LIMIT = 128;

export type GameplayCommandKind = 'lu' | 'pup' | 'dbr' | 'dash' | 'burrow';

export interface GameplayCommand {
  epoch: string;
  seq: number;
  kind: GameplayCommandKind;
  payload: unknown;
  sentAt: number;
  expectsResult: boolean;
}

export interface GameplayCommandBatch {
  epoch: string;
  commands: GameplayCommand[];
}

export interface GameplayCommandResult {
  seq: number;
  value: unknown;
}

export interface GameplayCommandAck {
  epoch: string;
  throughSeq: number;
  results: GameplayCommandResult[];
}

export interface GameplayEvent {
  epoch: string;
  seq: number;
  kind: string;
  payload: unknown;
  createdAt: number;
}

export interface GameplayEventBatch {
  epoch: string;
  events: GameplayEvent[];
}

export interface GameplayEventAck {
  epoch: string;
  throughSeq: number;
}

export interface GameplayTransportPlayerState {
  id: string;
  getState(key: string): unknown;
  setState(key: string, value: unknown, reliable?: boolean): void;
}

interface PendingCommand {
  command: GameplayCommand;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface HostCommandState {
  epoch: string;
  throughSeq: number;
  results: GameplayCommandResult[];
  processing: Promise<GameplayCommandAck>;
  lastAckSentAt: number;
}

export interface GameplayTransportMetrics {
  fastCommandAcks: number;
  commandFallbacks: number;
  duplicateCommands: number;
  commandTimeouts: number;
  eventFallbacks: number;
  duplicateEvents: number;
  maxPendingCommands: number;
}

interface GameplayTransportChannelDeps {
  isHost: () => boolean;
  getMode: () => GameplayTransportMode;
  getLocalPlayer: () => GameplayTransportPlayerState;
  getPlayers: () => GameplayTransportPlayerState[];
  getGlobalState: (key: string) => unknown;
  setGlobalState: (key: string, value: unknown, reliable?: boolean) => void;
  executeCommand: (kind: GameplayCommandKind, payload: unknown, caller: GameplayTransportPlayerState) => Promise<unknown> | unknown;
  callCommandFallback: (batch: GameplayCommandBatch) => Promise<GameplayCommandAck>;
  sendEventFallback: (batch: GameplayEventBatch) => void;
  dispatchEvent: (kind: string, payload: unknown) => Promise<unknown> | unknown;
  now?: () => number;
}

function createEpoch(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

export function parseCommandBatch(value: unknown): GameplayCommandBatch | null {
  if (!isRecord(value)
    || typeof value.epoch !== 'string'
    || value.epoch.length === 0
    || value.epoch.length > 128
    || !Array.isArray(value.commands)) return null;
  const commands: GameplayCommand[] = [];
  for (const raw of value.commands.slice(0, GAMEPLAY_PENDING_SOFT_LIMIT)) {
    if (!isRecord(raw)
      || raw.epoch !== value.epoch
      || !Number.isSafeInteger(raw.seq)
      || (raw.seq as number) <= 0
      || typeof raw.kind !== 'string'
      || !['lu', 'pup', 'dbr', 'dash', 'burrow'].includes(raw.kind)
      || typeof raw.sentAt !== 'number'
      || !Number.isFinite(raw.sentAt)
      || typeof raw.expectsResult !== 'boolean') continue;
    commands.push(raw as unknown as GameplayCommand);
  }
  commands.sort((left, right) => left.seq - right.seq);
  return { epoch: value.epoch, commands };
}

function parseCommandAck(value: unknown): GameplayCommandAck | null {
  if (!isRecord(value)
    || typeof value.epoch !== 'string'
    || !Number.isSafeInteger(value.throughSeq)
    || !Array.isArray(value.results)) return null;
  const results = value.results.filter((item): item is GameplayCommandResult => (
    isRecord(item) && Number.isSafeInteger(item.seq)
  ));
  return { epoch: value.epoch, throughSeq: value.throughSeq as number, results };
}

export function parseEventBatch(value: unknown): GameplayEventBatch | null {
  if (!isRecord(value)
    || typeof value.epoch !== 'string'
    || value.epoch.length === 0
    || value.epoch.length > 128
    || !Array.isArray(value.events)) return null;
  const events: GameplayEvent[] = [];
  for (const raw of value.events.slice(0, 512)) {
    if (!isRecord(raw)
      || raw.epoch !== value.epoch
      || !Number.isSafeInteger(raw.seq)
      || (raw.seq as number) <= 0
      || typeof raw.kind !== 'string'
      || typeof raw.createdAt !== 'number'
      || !Number.isFinite(raw.createdAt)) continue;
    events.push(raw as unknown as GameplayEvent);
  }
  events.sort((left, right) => left.seq - right.seq);
  return { epoch: value.epoch, events };
}

function parseEventAck(value: unknown): GameplayEventAck | null {
  if (!isRecord(value)
    || typeof value.epoch !== 'string'
    || !Number.isSafeInteger(value.throughSeq)) return null;
  return { epoch: value.epoch, throughSeq: value.throughSeq as number };
}

export class GameplayTransportChannel {
  private commandEpoch = createEpoch();
  private nextCommandSeq = 1;
  private pendingCommands = new Map<number, PendingCommand>();
  private lastCommandPublishAt = 0;
  private commandFallbackInFlight = false;
  private hostCommandStates = new Map<string, HostCommandState>();
  private hostRetiredCommandEpochs = new Map<string, Set<string>>();

  private eventEpoch = createEpoch();
  private nextEventSeq = 1;
  private pendingEvents: GameplayEvent[] = [];
  private eventFallbackSent = new Set<number>();
  private lastEventPublishAt = 0;
  private eventBatchPublished = false;
  private receivedEventEpoch = '';
  private receivedEventThroughSeq = 0;
  private retiredEventEpochs = new Set<string>();

  private metrics: GameplayTransportMetrics = {
    fastCommandAcks: 0,
    commandFallbacks: 0,
    duplicateCommands: 0,
    commandTimeouts: 0,
    eventFallbacks: 0,
    duplicateEvents: 0,
    maxPendingCommands: 0,
  };

  constructor(private readonly deps: GameplayTransportChannelDeps) {}

  sendCommand(kind: GameplayCommandKind, payload: unknown, expectsResult = false): Promise<unknown> {
    const now = this.now();
    const command: GameplayCommand = {
      epoch: this.commandEpoch,
      seq: this.nextCommandSeq++,
      kind,
      payload,
      sentAt: now,
      expectsResult,
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingCommands.set(command.seq, { command, resolve, reject });
    });
    this.metrics.maxPendingCommands = Math.max(this.metrics.maxPendingCommands, this.pendingCommands.size);
    this.publishCommands(now);
    if (this.pendingCommands.size >= GAMEPLAY_PENDING_SOFT_LIMIT) this.startCommandFallback();
    return promise;
  }

  emitEvent(kind: string, payload: unknown): void {
    const event: GameplayEvent = {
      epoch: this.eventEpoch,
      seq: this.nextEventSeq++,
      kind,
      payload,
      createdAt: this.now(),
    };
    this.pendingEvents.push(event);
    this.receivedEventEpoch = this.eventEpoch;
    this.receivedEventThroughSeq = event.seq;
    void Promise.resolve(this.deps.dispatchEvent(kind, payload)).catch(error => console.error(error));
  }

  update(): void {
    if (this.deps.getMode() !== 'fast') return;
    const now = this.now();
    if (this.deps.isHost()) {
      this.processHostCommandStates();
      this.pruneAcknowledgedEvents(now);
      return;
    }

    this.applyCommandAck(parseCommandAck(this.deps.getLocalPlayer().getState(GAMEPLAY_COMMAND_ACK_STATE_KEY)), true);
    this.receiveEventBatch(parseEventBatch(this.deps.getGlobalState(GAMEPLAY_EVENT_STATE_KEY)));
    this.expireCommands(now);
    if (this.pendingCommands.size > 0) {
      if (now - this.lastCommandPublishAt >= GAMEPLAY_FAST_RESEND_MS) this.publishCommands(now);
      const oldest = this.pendingCommands.values().next().value as PendingCommand | undefined;
      if (oldest && now - oldest.command.sentAt >= GAMEPLAY_RPC_FALLBACK_MS) this.startCommandFallback();
    }
  }

  flush(): void {
    if (!this.deps.isHost() || this.deps.getMode() !== 'fast' || this.pendingEvents.length === 0) return;
    const now = this.now();
    if (now - this.lastEventPublishAt >= GAMEPLAY_FAST_RESEND_MS) {
      this.lastEventPublishAt = now;
      this.deps.setGlobalState(GAMEPLAY_EVENT_STATE_KEY, this.currentEventBatch(), false);
      this.eventBatchPublished = true;
    }

    const fallbackEvents = this.pendingEvents.filter(event => (
      now - event.createdAt >= GAMEPLAY_RPC_FALLBACK_MS && !this.eventFallbackSent.has(event.seq)
    ));
    if (fallbackEvents.length > 0) {
      for (const event of fallbackEvents) this.eventFallbackSent.add(event.seq);
      this.metrics.eventFallbacks += fallbackEvents.length;
      this.deps.sendEventFallback({ epoch: this.eventEpoch, events: fallbackEvents });
    }
  }

  async handleCommandFallback(value: unknown, caller: GameplayTransportPlayerState): Promise<GameplayCommandAck> {
    const batch = parseCommandBatch(value);
    if (!batch) return { epoch: '', throughSeq: 0, results: [] };
    return this.submitHostBatch(caller, batch);
  }

  handleEventFallback(value: unknown): void {
    this.receiveEventBatch(parseEventBatch(value));
  }

  reset(): void {
    const error = new Error('Gameplay transport reset');
    for (const pending of this.pendingCommands.values()) pending.reject(error);
    for (const [playerId, state] of this.hostCommandStates) {
      const retired = this.hostRetiredCommandEpochs.get(playerId) ?? new Set<string>();
      retired.add(state.epoch);
      while (retired.size > 8) retired.delete(retired.values().next().value!);
      this.hostRetiredCommandEpochs.set(playerId, retired);
    }
    this.commandEpoch = createEpoch();
    this.nextCommandSeq = 1;
    this.pendingCommands.clear();
    this.lastCommandPublishAt = 0;
    this.commandFallbackInFlight = false;
    this.hostCommandStates.clear();

    if (this.eventEpoch) this.retiredEventEpochs.add(this.eventEpoch);
    if (this.receivedEventEpoch) this.retiredEventEpochs.add(this.receivedEventEpoch);
    while (this.retiredEventEpochs.size > 8) this.retiredEventEpochs.delete(this.retiredEventEpochs.values().next().value!);
    this.eventEpoch = createEpoch();
    this.nextEventSeq = 1;
    this.pendingEvents = [];
    this.eventFallbackSent.clear();
    this.lastEventPublishAt = 0;
    this.eventBatchPublished = false;
    this.receivedEventEpoch = '';
    this.receivedEventThroughSeq = 0;
    if (this.deps.isHost()) {
      this.deps.setGlobalState(GAMEPLAY_EVENT_STATE_KEY, this.currentEventBatch(), false);
    } else {
      this.clearPublishedCommands();
    }
  }

  removePlayer(playerId: string): void {
    this.hostCommandStates.delete(playerId);
    this.hostRetiredCommandEpochs.delete(playerId);
  }

  getMetrics(): Readonly<GameplayTransportMetrics> {
    return { ...this.metrics };
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private currentCommandBatch(): GameplayCommandBatch {
    return {
      epoch: this.commandEpoch,
      commands: [...this.pendingCommands.values()].map(item => item.command),
    };
  }

  private currentEventBatch(): GameplayEventBatch {
    return { epoch: this.eventEpoch, events: [...this.pendingEvents] };
  }

  private publishCommands(now: number): void {
    if (this.deps.isHost() || this.deps.getMode() !== 'fast' || this.pendingCommands.size === 0) return;
    this.lastCommandPublishAt = now;
    this.deps.getLocalPlayer().setState(GAMEPLAY_COMMAND_STATE_KEY, this.currentCommandBatch(), false);
  }

  private startCommandFallback(): void {
    if (this.commandFallbackInFlight || this.pendingCommands.size === 0 || this.deps.getMode() !== 'fast') return;
    this.commandFallbackInFlight = true;
    this.metrics.commandFallbacks++;
    const batch = this.currentCommandBatch();
    void this.deps.callCommandFallback(batch)
      .then(ack => this.applyCommandAck(ack, false))
      .catch(() => undefined)
      .finally(() => { this.commandFallbackInFlight = false; });
  }

  private applyCommandAck(ack: GameplayCommandAck | null, fast: boolean): void {
    if (!ack || ack.epoch !== this.commandEpoch || ack.throughSeq <= 0) return;
    const resultMap = new Map(ack.results.map(result => [result.seq, result.value]));
    let acknowledged = 0;
    for (const [seq, pending] of this.pendingCommands) {
      if (seq > ack.throughSeq) continue;
      pending.resolve(resultMap.get(seq));
      this.pendingCommands.delete(seq);
      acknowledged++;
    }
    if (fast) this.metrics.fastCommandAcks += acknowledged;
    if (acknowledged > 0) {
      if (this.pendingCommands.size > 0) this.publishCommands(this.now());
      else this.clearPublishedCommands();
    }
  }

  private expireCommands(now: number): void {
    const expired = [...this.pendingCommands.values()].filter(pending => (
      now - pending.command.sentAt >= GAMEPLAY_MESSAGE_MAX_AGE_MS
    ));
    if (expired.length === 0) return;

    for (const pending of this.pendingCommands.values()) {
      pending.reject(new Error(`Gameplay command timed out: ${pending.command.kind}`));
      this.metrics.commandTimeouts++;
    }
    this.pendingCommands.clear();
    this.commandEpoch = createEpoch();
    this.nextCommandSeq = 1;
    this.lastCommandPublishAt = 0;
    this.commandFallbackInFlight = false;
    this.clearPublishedCommands();
  }

  private processHostCommandStates(): void {
    const localId = this.deps.getLocalPlayer().id;
    const now = this.now();
    for (const player of this.deps.getPlayers()) {
      if (player.id === localId) continue;
      const batch = parseCommandBatch(player.getState(GAMEPLAY_COMMAND_STATE_KEY));
      if (!batch || batch.commands.length === 0) continue;
      const state = this.hostCommandStates.get(player.id);
      const latestCommand = batch.commands[batch.commands.length - 1];
      if (state?.epoch === batch.epoch && latestCommand.seq <= state.throughSeq) {
        if (now - latestCommand.sentAt < GAMEPLAY_MESSAGE_MAX_AGE_MS
          && now - state.lastAckSentAt >= GAMEPLAY_FAST_RESEND_MS) {
          player.setState(GAMEPLAY_COMMAND_ACK_STATE_KEY, this.buildHostAck(state), false);
          state.lastAckSentAt = now;
        }
        continue;
      }
      void this.submitHostBatch(player, batch).catch(error => console.error(error));
    }
  }

  private submitHostBatch(caller: GameplayTransportPlayerState, batch: GameplayCommandBatch): Promise<GameplayCommandAck> {
    let state = this.hostCommandStates.get(caller.id);
    if (!state || state.epoch !== batch.epoch) {
      const retiredEpochs = this.hostRetiredCommandEpochs.get(caller.id) ?? new Set<string>();
      if (retiredEpochs.has(batch.epoch)) {
        return Promise.resolve({ epoch: batch.epoch, throughSeq: 0, results: [] });
      }
      if (state) retiredEpochs.add(state.epoch);
      while (retiredEpochs.size > 8) retiredEpochs.delete(retiredEpochs.values().next().value!);
      this.hostRetiredCommandEpochs.set(caller.id, retiredEpochs);
      state = {
        epoch: batch.epoch,
        throughSeq: 0,
        results: [],
        processing: Promise.resolve({ epoch: batch.epoch, throughSeq: 0, results: [] }),
        lastAckSentAt: 0,
      };
      this.hostCommandStates.set(caller.id, state);
    }

    const run = state.processing.then(async () => {
      for (const command of batch.commands) {
        if (command.seq <= state!.throughSeq) {
          this.metrics.duplicateCommands++;
          continue;
        }
        if (command.seq !== state!.throughSeq + 1) break;
        const stale = this.now() - command.sentAt >= GAMEPLAY_MESSAGE_MAX_AGE_MS;
        const value = stale
          ? (command.kind === 'lu' ? { ok: false, reason: 'invalid' } : undefined)
          : await this.deps.executeCommand(command.kind, command.payload, caller);
        state!.throughSeq = command.seq;
        if (command.expectsResult) state!.results.push({ seq: command.seq, value });
      }
      if (state!.results.length > GAMEPLAY_PENDING_SOFT_LIMIT) {
        state!.results.splice(0, state!.results.length - GAMEPLAY_PENDING_SOFT_LIMIT);
      }
      const ack = this.buildHostAck(state!);
      caller.setState(GAMEPLAY_COMMAND_ACK_STATE_KEY, ack, false);
      state!.lastAckSentAt = this.now();
      return ack;
    });
    state.processing = run.catch(() => ({ epoch: state!.epoch, throughSeq: state!.throughSeq, results: [...state!.results] }));
    return run;
  }

  private receiveEventBatch(batch: GameplayEventBatch | null): void {
    if (!batch || batch.events.length === 0) return;
    if (this.retiredEventEpochs.has(batch.epoch)) return;
    const latestEvent = batch.events[batch.events.length - 1];
    if (this.receivedEventEpoch === batch.epoch
      && latestEvent.seq <= this.receivedEventThroughSeq
      && this.now() - latestEvent.createdAt >= GAMEPLAY_MESSAGE_MAX_AGE_MS) return;
    if (this.receivedEventEpoch !== batch.epoch) {
      if (this.receivedEventEpoch) this.retiredEventEpochs.add(this.receivedEventEpoch);
      while (this.retiredEventEpochs.size > 8) this.retiredEventEpochs.delete(this.retiredEventEpochs.values().next().value!);
      this.receivedEventEpoch = batch.epoch;
      this.receivedEventThroughSeq = Math.max(0, batch.events[0].seq - 1);
    }

    for (const event of batch.events) {
      if (event.seq <= this.receivedEventThroughSeq) {
        this.metrics.duplicateEvents++;
        continue;
      }
      if (event.seq !== this.receivedEventThroughSeq + 1) break;
      this.receivedEventThroughSeq = event.seq;
      if (this.now() - event.createdAt <= GAMEPLAY_MESSAGE_MAX_AGE_MS) {
        void Promise.resolve(this.deps.dispatchEvent(event.kind, event.payload)).catch(error => console.error(error));
      }
    }

    if (!this.deps.isHost()) {
      this.deps.getLocalPlayer().setState(GAMEPLAY_EVENT_ACK_STATE_KEY, {
        epoch: this.receivedEventEpoch,
        throughSeq: this.receivedEventThroughSeq,
      } satisfies GameplayEventAck, false);
    }
  }

  private buildHostAck(state: HostCommandState): GameplayCommandAck {
    return { epoch: state.epoch, throughSeq: state.throughSeq, results: [...state.results] };
  }

  private pruneAcknowledgedEvents(now: number): void {
    if (this.pendingEvents.length === 0) return;
    const localId = this.deps.getLocalPlayer().id;
    const remotePlayers = this.deps.getPlayers().filter(player => player.id !== localId);
    this.pendingEvents = this.pendingEvents.filter(event => {
      if (now - event.createdAt >= GAMEPLAY_MESSAGE_MAX_AGE_MS) return false;
      if (remotePlayers.length === 0) return false;
      return !remotePlayers.every(player => {
        const ack = parseEventAck(player.getState(GAMEPLAY_EVENT_ACK_STATE_KEY));
        return ack?.epoch === event.epoch && ack.throughSeq >= event.seq;
      });
    });
    const retained = new Set(this.pendingEvents.map(event => event.seq));
    for (const seq of this.eventFallbackSent) {
      if (!retained.has(seq)) this.eventFallbackSent.delete(seq);
    }
    if (this.pendingEvents.length === 0 && this.eventBatchPublished) {
      this.deps.setGlobalState(GAMEPLAY_EVENT_STATE_KEY, this.currentEventBatch(), false);
      this.eventBatchPublished = false;
    }
  }

  private clearPublishedCommands(): void {
    if (this.deps.isHost()) return;
    this.deps.getLocalPlayer().setState(GAMEPLAY_COMMAND_STATE_KEY, this.currentCommandBatch(), false);
  }
}
