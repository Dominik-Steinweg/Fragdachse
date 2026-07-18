import { describe, expect, it, vi } from 'vitest';
import {
  GAMEPLAY_COMMAND_STATE_KEY,
  GAMEPLAY_MESSAGE_MAX_AGE_MS,
  GAMEPLAY_PENDING_SOFT_LIMIT,
  GAMEPLAY_RPC_FALLBACK_MS,
  GameplayTransportChannel,
  type GameplayCommandAck,
  type GameplayCommandBatch,
  type GameplayEventBatch,
  type GameplayTransportPlayerState,
} from '../src/network/GameplayTransportChannel';

class FakePlayerState implements GameplayTransportPlayerState {
  readonly values = new Map<string, unknown>();

  constructor(readonly id: string) {}

  getState(key: string): unknown {
    return this.values.get(key);
  }

  setState(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

async function drainMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createDeps(options: {
  host: boolean;
  local: FakePlayerState;
  players: FakePlayerState[];
  global?: Map<string, unknown>;
  now: () => number;
  execute?: ReturnType<typeof vi.fn>;
  fallback?: ReturnType<typeof vi.fn>;
  dispatch?: ReturnType<typeof vi.fn>;
}) {
  const global = options.global ?? new Map<string, unknown>();
  return {
    isHost: () => options.host,
    getMode: () => 'fast' as const,
    getLocalPlayer: () => options.local,
    getPlayers: () => options.players,
    getGlobalState: (key: string) => global.get(key),
    setGlobalState: (key: string, value: unknown) => { global.set(key, value); },
    executeCommand: options.execute ?? vi.fn(() => undefined),
    callCommandFallback: options.fallback ?? vi.fn(async () => ({ epoch: '', throughSeq: 0, results: [] })),
    sendEventFallback: vi.fn(),
    dispatchEvent: options.dispatch ?? vi.fn(() => undefined),
    now: options.now,
  };
}

describe('GameplayTransportChannel commands', () => {
  it('delivers a fast command once and resolves its result from the host ack', async () => {
    let now = 1000;
    const hostPlayer = new FakePlayerState('host');
    const clientPlayer = new FakePlayerState('client');
    const execute = vi.fn(() => ({ ok: true }));
    const client = new GameplayTransportChannel(createDeps({
      host: false, local: clientPlayer, players: [hostPlayer, clientPlayer], now: () => now,
    }));
    const host = new GameplayTransportChannel(createDeps({
      host: true, local: hostPlayer, players: [hostPlayer, clientPlayer], now: () => now, execute,
    }));

    const resultPromise = client.sendCommand('lu', { slot: 'weapon1' }, true);
    host.update();
    await drainMicrotasks();
    client.update();

    await expect(resultPromise).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][2].id).toBe('client');
    expect((clientPlayer.getState(GAMEPLAY_COMMAND_STATE_KEY) as GameplayCommandBatch).commands).toEqual([]);

    host.update();
    await drainMicrotasks();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('deduplicates the same command arriving over fast state and RPC fallback', async () => {
    const now = 2000;
    const hostPlayer = new FakePlayerState('host');
    const clientPlayer = new FakePlayerState('client');
    const execute = vi.fn(() => 'done');
    const client = new GameplayTransportChannel(createDeps({
      host: false, local: clientPlayer, players: [hostPlayer, clientPlayer], now: () => now,
    }));
    const host = new GameplayTransportChannel(createDeps({
      host: true, local: hostPlayer, players: [hostPlayer, clientPlayer], now: () => now, execute,
    }));

    void client.sendCommand('dash', { dx: 1, dy: 0 });
    const batch = clientPlayer.getState(GAMEPLAY_COMMAND_STATE_KEY) as GameplayCommandBatch;
    host.update();
    await drainMicrotasks();
    const ack = await host.handleCommandFallback(batch, clientPlayer);

    expect(ack.throughSeq).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(host.getMetrics().duplicateCommands).toBeGreaterThan(0);
  });

  it('buffers a sequence gap and processes commands in order once the gap arrives', async () => {
    const now = 3000;
    const hostPlayer = new FakePlayerState('host');
    const clientPlayer = new FakePlayerState('client');
    const order: number[] = [];
    const execute = vi.fn((_kind, payload: unknown) => { order.push((payload as { value: number }).value); });
    const host = new GameplayTransportChannel(createDeps({
      host: true, local: hostPlayer, players: [hostPlayer, clientPlayer], now: () => now, execute,
    }));
    const command = (seq: number) => ({
      epoch: 'epoch', seq, kind: 'dash' as const, payload: { value: seq }, sentAt: now, expectsResult: false,
    });

    const gapAck = await host.handleCommandFallback({ epoch: 'epoch', commands: [command(2)] }, clientPlayer);
    expect(gapAck.throughSeq).toBe(0);
    const completeAck = await host.handleCommandFallback({ epoch: 'epoch', commands: [command(1), command(2)] }, clientPlayer);

    expect(completeAck.throughSeq).toBe(2);
    expect(order).toEqual([1, 2]);
  });

  it('does not execute delayed commands from an epoch retired at round change', async () => {
    const now = 3500;
    const hostPlayer = new FakePlayerState('host');
    const clientPlayer = new FakePlayerState('client');
    const execute = vi.fn();
    const host = new GameplayTransportChannel(createDeps({
      host: true, local: hostPlayer, players: [hostPlayer, clientPlayer], now: () => now, execute,
    }));
    const batch: GameplayCommandBatch = {
      epoch: 'old-round',
      commands: [{ epoch: 'old-round', seq: 1, kind: 'dash', payload: {}, sentAt: now, expectsResult: false }],
    };
    await host.handleCommandFallback(batch, clientPlayer);
    host.reset();

    await host.handleCommandFallback(batch, clientPlayer);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('starts RPC fallback after 180ms and expires an unreachable command explicitly', async () => {
    let now = 4000;
    const clientPlayer = new FakePlayerState('client');
    let sentBatch: GameplayCommandBatch | null = null;
    const fallback = vi.fn(async (batch: GameplayCommandBatch): Promise<GameplayCommandAck> => {
      sentBatch = batch;
      return { epoch: batch.epoch, throughSeq: 0, results: [] };
    });
    const client = new GameplayTransportChannel(createDeps({
      host: false, local: clientPlayer, players: [clientPlayer], now: () => now, fallback,
    }));
    const result = client.sendCommand('burrow', { want: true }, true);

    now += GAMEPLAY_RPC_FALLBACK_MS;
    client.update();
    await drainMicrotasks();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(sentBatch?.commands).toHaveLength(1);

    now += GAMEPLAY_MESSAGE_MAX_AGE_MS;
    client.update();
    await expect(result).rejects.toThrow('timed out');
  });

  it('forces fallback under command queue pressure without dropping entries', async () => {
    const now = 5000;
    const clientPlayer = new FakePlayerState('client');
    const fallback = vi.fn(async (batch: GameplayCommandBatch): Promise<GameplayCommandAck> => ({
      epoch: batch.epoch, throughSeq: 0, results: [],
    }));
    const client = new GameplayTransportChannel(createDeps({
      host: false, local: clientPlayer, players: [clientPlayer], now: () => now, fallback,
    }));

    for (let index = 0; index < GAMEPLAY_PENDING_SOFT_LIMIT; index++) {
      void client.sendCommand('dbr', {});
    }
    await drainMicrotasks();

    const batch = clientPlayer.getState(GAMEPLAY_COMMAND_STATE_KEY) as GameplayCommandBatch;
    expect(batch.commands).toHaveLength(GAMEPLAY_PENDING_SOFT_LIMIT);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

describe('GameplayTransportChannel events', () => {
  it('publishes events immediately and adds RPC fallback after 180ms without an ack', () => {
    let now = 5800;
    const hostPlayer = new FakePlayerState('host');
    const clientPlayer = new FakePlayerState('client');
    const global = new Map<string, unknown>();
    const deps = createDeps({
      host: true, local: hostPlayer, players: [hostPlayer, clientPlayer], global, now: () => now,
    });
    const host = new GameplayTransportChannel(deps);

    host.emitEvent('xfx', { x: 1 });
    host.flush();
    expect((global.get('geb') as GameplayEventBatch).events).toHaveLength(1);
    expect(deps.sendEventFallback).not.toHaveBeenCalled();

    now += GAMEPLAY_RPC_FALLBACK_MS;
    host.flush();
    expect(deps.sendEventFallback).toHaveBeenCalledTimes(1);
  });

  it('deduplicates an event received over state and RPC fallback', () => {
    const now = 6000;
    const clientPlayer = new FakePlayerState('client');
    const global = new Map<string, unknown>();
    const dispatch = vi.fn();
    const client = new GameplayTransportChannel(createDeps({
      host: false, local: clientPlayer, players: [clientPlayer], global, now: () => now, dispatch,
    }));
    const batch: GameplayEventBatch = {
      epoch: 'events',
      events: [{ epoch: 'events', seq: 1, kind: 'xfx', payload: { x: 1 }, createdAt: now }],
    };
    global.set('geb', batch);

    client.update();
    client.handleEventFallback(batch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(client.getMetrics().duplicateEvents).toBe(1);
  });

  it('resets epochs and rejects pending result promises during a lifecycle reset', async () => {
    const now = 7000;
    const clientPlayer = new FakePlayerState('client');
    const client = new GameplayTransportChannel(createDeps({
      host: false, local: clientPlayer, players: [clientPlayer], now: () => now,
    }));
    const result = client.sendCommand('lu', {}, true);

    client.reset();

    await expect(result).rejects.toThrow('reset');
  });

  it('ignores delayed events from an epoch retired by a lifecycle reset', () => {
    const now = 8000;
    const clientPlayer = new FakePlayerState('client');
    const global = new Map<string, unknown>();
    const dispatch = vi.fn();
    const client = new GameplayTransportChannel(createDeps({
      host: false, local: clientPlayer, players: [clientPlayer], global, now: () => now, dispatch,
    }));
    const oldBatch: GameplayEventBatch = {
      epoch: 'old-events',
      events: [{ epoch: 'old-events', seq: 1, kind: 'xfx', payload: {}, createdAt: now }],
    };
    global.set('geb', oldBatch);
    client.update();
    client.reset();

    client.handleEventFallback(oldBatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
