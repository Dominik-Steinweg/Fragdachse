import { describe, expect, it, vi } from 'vitest';
import {
  MAX_PLAYERS,
  PEER_HEARTBEAT_INTERVAL_MS,
  PEER_HEARTBEAT_TIMEOUT_MS,
  PEER_RESUME_GRACE_MS,
} from '../src/config';
import { PeerRoom, type PeerPlayerHandle } from '../src/network/peer/PeerRoom';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { createPeerNetworkError } from '../src/network/peer/PeerSignaling';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { PEER_PROTOCOL_VERSION } from '../src/network/peer/protocol';

import {
  FailingClientTransport,
  FakeNetwork,
  SilentClientTransport,
  SilentLink,
  addClientRoom,
  createHostRoom,
  dropConnection,
  startRoom,
} from './fakePeerNetwork';

describe('PeerRoom handshake and roster', () => {
  it('rejects boot when an open link never receives welcome', async () => {
    vi.useFakeTimers();
    try {
      const room = new PeerRoom(new SilentClientTransport(), { resumeToken: 'handshake-timeout-token' });
      const start = room.start();
      const assertion = expect(start).rejects.toMatchObject({ kind: 'connection-failed' });
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards transport errors to the pending boot', async () => {
    const error = createPeerNetworkError('host-not-found');
    const room = new PeerRoom(new FailingClientTransport(error), { resumeToken: 'missing-host-token' });

    await expect(room.start()).rejects.toMatchObject({ kind: 'host-not-found' });
  });

  it('assigns short player ids and lets both sides see the full roster', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);

    expect(host.room.getLocalPlayerId()).toBe('p0');
    expect(client.room.getLocalPlayerId()).toBe('p1');
    expect(client.room.getHostPlayerId()).toBe('p0');
    expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p1']);
    expect(client.room.getPlayerIds().sort()).toEqual(['p0', 'p1']);
    expect(host.joined).toEqual(['p0', 'p1']);
    expect(client.joined.sort()).toEqual(['p0', 'p1']);
  });

  it('replays already connected players for late join callbacks', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    await addClientRoom(network);

    const replayed: string[] = [];
    host.room.onPlayerJoin((handle) => replayed.push(handle.id));
    expect(replayed.sort()).toEqual(['p0', 'p1']);
  });

  it('tells existing clients about a newly joined player', async () => {
    const network = new FakeNetwork();
    await createHostRoom(network);
    const first = await addClientRoom(network);
    await addClientRoom(network);

    expect(first.joined.sort()).toEqual(['p0', 'p1', 'p2']);
    expect(first.room.getPlayerIds().sort()).toEqual(['p0', 'p1', 'p2']);
  });

  it('rejects a full room without disturbing existing players', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const clients: TestRoom[] = [];
    for (let index = 1; index < MAX_PLAYERS; index++) clients.push(await addClientRoom(network));

    await expect(addClientRoom(network)).rejects.toMatchObject({ kind: 'room-full' });
    expect(host.room.getPlayerIds()).toHaveLength(MAX_PLAYERS);
    expect(clients.every(client => client.fatals.length === 0)).toBe(true);
    expect(clients.every(client => client.transport.links.some(link => !link.closed))).toBe(true);
  });

  it('isolates a protocol-mismatched incoming join to that link', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const existing = await addClientRoom(network);
    const badLink = new SilentLink('outdated-client');

    host.transport.handlers?.onLinkRegistered(badLink);
    host.transport.handlers?.onMessage(
      badLink,
      { t: 'hello', v: PEER_PROTOCOL_VERSION - 1, k: 'outdated-client-token' },
      'rel',
    );

    expect(badLink.sent).toContainEqual({ message: { t: 'reject', k: 'protocol-mismatch' }, channel: 'rel' });
    expect(badLink.closed).toBe(true);
    expect(existing.transport.links.some(link => !link.closed)).toBe(true);
    expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p1']);
  });

  it('delivers state the host writes while handling the join to the new client', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    // Genau das Muster von hostAssignColor/hostEnsureTeamAssignment: der Host schreibt einen
    // Zustand des neuen Spielers, während er dessen Join verarbeitet.
    host.room.onPlayerJoin((handle) => {
      if (handle.id === host.room.getLocalPlayerId()) return;
      host.room.setPlayerState(handle.id, 'clr', 0x33cc66, true);
    });

    const client = await addClientRoom(network);
    const localId = client.room.getLocalPlayerId();

    expect(host.room.getPlayerState(localId, 'clr')).toBe(0x33cc66);
    expect(client.room.getPlayerState(localId, 'clr')).toBe(0x33cc66);
  });

  it('reuses the id after the resume grace period expired', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network);
      const first = await addClientRoom(network);
      expect(first.room.getLocalPlayerId()).toBe('p1');
      first.transport.reconnectEnabled = false;

      dropConnection(first);
      await vi.advanceTimersByTimeAsync(10_000);
      const replacement = await addClientRoom(network);

      expect(replacement.room.getLocalPlayerId()).toBe('p1');
      expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p1']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PeerRoom replicated state', () => {
  it('applies local writes immediately without a network roundtrip', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);

    host.room.setGlobal('gph', 'ARENA', true);
    expect(host.room.getGlobal('gph')).toBe('ARENA');

    const handle = host.room.getPlayerHandle('p0') as PeerPlayerHandle;
    handle.setState('isr', true, true);
    expect(handle.getState('isr')).toBe(true);
  });

  it('delivers reliable writes right away and defers replaceable ones to update()', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);

    host.room.setGlobal('genericReliable', { seed: 1 }, true);
    expect(client.room.getGlobal('genericReliable')).toEqual({ seed: 1 });

    host.room.setGlobal('gs', { _s: 1 }, false);
    expect(client.room.getGlobal('gs')).toBeUndefined();

    host.room.update();
    expect(client.room.getGlobal('gs')).toEqual({ _s: 1 });
  });

  it('coalesces replaceable writes so only the newest value goes out', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);
    const hostLink = host.transport.links[0];

    host.room.setGlobal('gs', { _s: 1 }, false);
    host.room.setGlobal('gs', { _s: 2 }, false);
    host.room.setGlobal('gs', { _s: 3 }, false);
    const before = hostLink.sent.length;
    host.room.update();

    expect(hostLink.sent.length - before).toBe(1);
    expect(client.room.getGlobal('gs')).toEqual({ _s: 3 });
  });

  it('sends replaceable traffic on the fast channel and ordered traffic on the reliable one', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    await addClientRoom(network);
    const hostLink = host.transport.links[0];
    hostLink.sent.length = 0;

    host.room.setGlobal('gph', 'ARENA', true);
    host.room.setGlobal('gs', { _s: 9 }, false);
    host.room.update();

    const channels = hostLink.sent.filter((entry) => entry.message.t === 'b').map((entry) => entry.channel);
    expect(channels).toEqual(['rel', 'fast']);
  });

  it('never falls back to reliable when a flush happens before the fast channel is ready', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    network.afterLinksRegistered = () => {
      host.room.setGlobal('gs', { _s: 1 }, false);
      host.room.update();
    };

    const client = await addClientRoom(network);
    const hostLink = host.transport.links[0];
    const preReadyBatch = hostLink.sent.find(entry => entry.message.t === 'b');

    expect(preReadyBatch?.channel).toBe('fast');
    expect(client.room.getGlobal('gs')).toEqual({ _s: 1 });
    expect(hostLink.sent.some(entry => entry.message.t === 'b' && entry.channel === 'rel')).toBe(false);
  });

  it('ignores delayed and duplicate fast batches', async () => {
    const network = new FakeNetwork();
    await createHostRoom(network);
    const client = await addClientRoom(network);
    const link = client.transport.links[0];

    client.transport.handlers?.onMessage(link, { t: 'b', q: 5, g: [['gs', { _s: 5 }]] }, 'fast');
    client.transport.handlers?.onMessage(link, { t: 'b', q: 4, g: [['gs', { _s: 4 }]] }, 'fast');
    client.transport.handlers?.onMessage(link, { t: 'b', q: 5, g: [['gs', { _s: 0 }]] }, 'fast');

    expect(client.room.getGlobal('gs')).toEqual({ _s: 5 });
  });

  it('relays a client write to the other clients but not back to its origin', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const first = await addClientRoom(network);
    const second = await addClientRoom(network);
    const firstLink = first.transport.links[0];

    first.room.setPlayerState('p1', 'pnm', 'Dachs', true);
    expect(host.room.getPlayerState('p1', 'pnm')).toBe('Dachs');
    expect(second.room.getPlayerState('p1', 'pnm')).toBe('Dachs');

    firstLink.sent.length = 0;
    first.room.setPlayerState('p1', 'png', 42, false);
    first.room.update();
    host.room.update();

    expect(host.room.getPlayerState('p1', 'png')).toBe(42);
    expect(second.room.getPlayerState('p1', 'png')).toBe(42);
    // Der Ursprung darf seinen eigenen Wert nicht zurueckgespiegelt bekommen.
    expect(firstLink.counterpart.sent.some((entry) => entry.message.t === 'b')).toBe(false);
  });

  it('keeps host-only keys off the relay path but still delivers them to the host', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network, ['inp']);
    const first = await addClientRoom(network, ['inp']);
    const second = await addClientRoom(network, ['inp']);

    first.room.setPlayerState('p1', 'inp', { dx: 1, dy: 0 }, false);
    first.room.update();
    host.room.update();

    expect(host.room.getPlayerState('p1', 'inp')).toEqual({ dx: 1, dy: 0 });
    expect(second.room.getPlayerState('p1', 'inp')).toBeUndefined();
  });

  it('relays a client-owned placement preview but rejects a foreign player id', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network, ['inp']);
    const first = await addClientRoom(network, ['inp']);
    const second = await addClientRoom(network, ['inp']);
    const preview = {
      active: true,
      kind: 'turret',
      gridX: 3,
      gridY: 4,
      x: 224,
      y: 288,
      isValid: true,
      frame: 1,
    } as const;

    first.room.setPlayerState('p1', 'ppv', preview, false);
    first.room.update();
    host.room.update();

    expect(host.room.getPlayerState('p1', 'ppv')).toEqual(preview);
    expect(second.room.getPlayerState('p1', 'ppv')).toEqual(preview);

    first.room.setPlayerState('p0', 'ppv', preview, false);
    first.room.update();
    host.room.update();

    expect(host.room.getPlayerState('p0', 'ppv')).toBeUndefined();
    expect(second.room.getPlayerState('p0', 'ppv')).toBeUndefined();
  });

  it('hands a late joiner the complete current state', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const first = await addClientRoom(network);

    host.room.setGlobal('gmd', 'deathmatch', true);
    host.room.setPlayerState('p0', 'pnm', 'Host', true);
    host.room.setPlayerState('p0', 'inp', { dx: 1, dy: 0 }, false);
    host.room.setPlayerState('p0', 'ppv', { active: true }, false);
    first.room.setPlayerState('p1', 'pnm', 'Erster', true);
    first.room.setPlayerState('p1', 'ppv', { active: true }, false);

    const late = await addClientRoom(network);
    expect(late.room.getGlobal('gmd')).toBe('deathmatch');
    expect(late.room.getPlayerState('p0', 'pnm')).toBe('Host');
    expect(late.room.getPlayerState('p1', 'pnm')).toBe('Erster');
    expect(late.room.getPlayerState('p0', 'inp')).toBeUndefined();
    expect(late.room.getPlayerState('p0', 'ppv')).toBeUndefined();
    expect(late.room.getPlayerState('p1', 'ppv')).toBeUndefined();
  });

  it('lets the host write state that belongs to another player', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);

    host.room.setPlayerState('p1', 'ucd', 1234, true);
    expect(client.room.getPlayerState('p1', 'ucd')).toBe(1234);
  });
});

describe('PeerRoom rpc', () => {
  it('runs host handlers locally when the caller is the host', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const handler = vi.fn(() => ({ ok: true }));
    host.room.registerHostHandler('lu', handler);

    await expect(host.room.callHost('lu', { slot: 'weapon1' }, 500)).resolves.toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith({ slot: 'weapon1' }, 'p0');
  });

  it('returns the host result to a calling client and attributes the sender', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);
    const senders: string[] = [];
    host.room.registerHostHandler('lu', (_payload, senderId) => {
      senders.push(senderId);
      return { ok: false, reason: 'cooldown' };
    });

    await expect(client.room.callHost('lu', { slot: 'weapon2' }, 500)).resolves.toEqual({ ok: false, reason: 'cooldown' });
    expect(senders).toEqual(['p1']);
  });

  it('awaits asynchronous host handlers', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);
    host.room.registerHostHandler('lu', async () => {
      await Promise.resolve();
      return 'fertig';
    });

    await expect(client.room.callHost('lu', {}, 500)).resolves.toBe('fertig');
  });

  it('delivers fire-and-forget commands without a reply', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);
    const handler = vi.fn();
    host.room.registerHostHandler('dash', handler);

    client.room.sendHost('dash', { dx: 1, dy: 0 });
    expect(handler).toHaveBeenCalledWith({ dx: 1, dy: 0 }, 'p1');
    expect(client.transport.links[0].counterpart.sent.some((entry) => entry.message.t === 'res')).toBe(false);
  });

  it('dispatches host broadcasts on every peer including the host itself', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const first = await addClientRoom(network);
    const second = await addClientRoom(network);

    const seen: string[] = [];
    host.room.registerAllHandler('xfx', (_payload, senderId) => { seen.push(`host:${senderId}`); });
    first.room.registerAllHandler('xfx', (_payload, senderId) => { seen.push(`first:${senderId}`); });
    second.room.registerAllHandler('xfx', (_payload, senderId) => { seen.push(`second:${senderId}`); });

    host.room.broadcast('xfx', { x: 1 });
    expect(seen.sort()).toEqual(['first:p0', 'host:p0', 'second:p0']);
  });

  it('relays a client broadcast through the host with a host-stamped sender id', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const first = await addClientRoom(network);
    const second = await addClientRoom(network);

    const seen: string[] = [];
    host.room.registerAllHandler('crq', (_payload, senderId) => { seen.push(`host:${senderId}`); });
    first.room.registerAllHandler('crq', (_payload, senderId) => { seen.push(`first:${senderId}`); });
    second.room.registerAllHandler('crq', (_payload, senderId) => { seen.push(`second:${senderId}`); });

    first.room.broadcast('crq', { color: 1 });
    expect(seen.sort()).toEqual(['first:p1', 'host:p1', 'second:p1']);
  });

  it('rejects a pending call when the timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network);
      const client = await addClientRoom(network);
      host.room.registerHostHandler('lu', () => new Promise(() => undefined));

      const pending = client.room.callHost('lu', {}, 200);
      const assertion = expect(pending).rejects.toThrow('RPC timeout: lu');
      await vi.advanceTimersByTimeAsync(250);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PeerRoom disconnects', () => {
  it('enforces host/lobby/target checks in NetworkBridge and resets remaining ready state', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network);
      const target = await addClientRoom(network);
      const observer = await addClientRoom(network);
      const bridge = new NetworkBridge();
      setActiveSession({
        room: host.room,
        transport: host.transport as never,
        roomCode: 'ABC123',
      });
      bridge.activate();

      host.room.setGlobal('gph', 'ARENA', true);
      await expect(bridge.kickPlayer('p1')).resolves.toEqual({ ok: false, reason: 'lobby-only' });
      expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p1', 'p2']);

      host.room.setGlobal('gph', 'LOBBY', true);
      bridge.hostSetPlayerReady('p0', true);
      bridge.hostSetPlayerReady('p1', true);
      bridge.hostSetPlayerReady('p2', true);

      await expect(bridge.kickPlayer('p0')).resolves.toEqual({ ok: false, reason: 'self' });
      await expect(bridge.kickPlayer('missing')).resolves.toEqual({ ok: false, reason: 'unknown-player' });
      await expect(bridge.kickPlayer('p1')).resolves.toEqual({ ok: true });

      expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p2']);
      expect(bridge.getPlayerReady('p0')).toBe(false);
      expect(bridge.getPlayerReady('p2')).toBe(false);
      expect(target.kicked).toBe(1);
      expect(observer.quit).toEqual(['p1']);
    } finally {
      clearActiveSession();
      vi.useRealTimers();
    }
  });

  it('removes a kicked client from state, roster and resume slots without reconnecting it', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network);
      const target = await addClientRoom(network, [], 'kick-target-token');
      const observer = await addClientRoom(network);
      setActiveSession({
        room: target.room,
        transport: target.transport as never,
        roomCode: 'ABC123',
      });
      const kickedBridge = new NetworkBridge();
      kickedBridge.activate();
      const kickedNotice = vi.fn();
      kickedBridge.onKicked(kickedNotice);

      expect(target.room.kickPlayer('p0')).toBe(false);
      expect(host.room.kickPlayer('p0')).toBe(false);
      expect(host.room.kickPlayer('does-not-exist')).toBe(false);

      host.room.setPlayerState('p1', 'hp', 73, true);
      const targetLink = host.transport.links.find(link => link.playerId === 'p1');
      expect(targetLink).toBeDefined();

      expect(host.room.kickPlayer('p1')).toBe(true);

      expect(target.kicked).toBe(1);
      expect(target.fatals).toEqual([]);
      expect(target.room.getPlayerHandle('p1')).toBeUndefined();
      expect(target.room.getPlayerState('p1', 'hp')).toBeUndefined();
      expect(host.room.getPlayerHandle('p1')).toBeUndefined();
      expect(host.room.getPlayerState('p1', 'hp')).toBeUndefined();
      expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p2']);
      expect(observer.room.getPlayerIds().sort()).toEqual(['p0', 'p2']);
      expect(host.quit).toEqual(['p1']);
      expect(observer.quit).toEqual(['p1']);
      expect(targetLink?.sent).toContainEqual({ message: { t: 'kicked' }, channel: 'rel' });

      await vi.advanceTimersByTimeAsync(PEER_RESUME_GRACE_MS);
      expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p2']);
      expect(target.kicked).toBe(1);
      expect(target.transport.links.some(link => !link.closed)).toBe(false);

      // Der Kick loescht den lokalen Roster-/State-Eintrag. Die Bridge darf den noch laufenden
      // Abschlussframe trotzdem ohne Ausnahme aktualisieren.
      expect(target.room.isKicked()).toBe(true);
      expect(kickedNotice).toHaveBeenCalledTimes(1);
      expect(() => {
        kickedBridge.updateNetwork();
        kickedBridge.getLocalPlayerId();
        kickedBridge.sendPingToHost();
      }).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes an explicitly leaving client immediately and consumes its resume slot', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const leaving = await addClientRoom(network, [], 'explicit-leave-token');
    const observer = await addClientRoom(network);
    const handleQuit = vi.fn();
    host.room.getPlayerHandle('p1')?.onQuit(handleQuit);

    const clientLink = leaving.transport.links[0];
    leaving.room.leave();

    expect(clientLink.sent).toContainEqual({ message: { t: 'leave' }, channel: 'rel' });
    expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p2']);
    expect(host.room.getPlayerHandle('p1')).toBeUndefined();
    expect(host.room.getPlayerState('p1', 'anything')).toBeUndefined();
    expect(handleQuit).toHaveBeenCalledTimes(1);
    expect(host.quit).toEqual(['p1']);
    expect(observer.quit).toEqual(['p1']);

    const replacement = await addClientRoom(network, [], 'explicit-leave-token');
    expect(replacement.room.getLocalPlayerId()).toBe('p1');
    expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p1', 'p2']);
  });

  it('closes a silent link after the heartbeat timeout but keeps the resume grace period', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network);
      const vanished = await addClientRoom(network);
      const hostLink = host.transport.links[0];

      // A destroyed client no longer answers heartbeats, while the in-memory link itself stays
      // open so this exercises the liveness timeout rather than the close callback.
      vanished.room.destroy();
      await vi.advanceTimersByTimeAsync(PEER_HEARTBEAT_INTERVAL_MS + PEER_HEARTBEAT_TIMEOUT_MS);

      expect(hostLink.closed).toBe(true);
      expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p1']);
      expect(host.quit).toEqual([]);

      await vi.advanceTimersByTimeAsync(PEER_RESUME_GRACE_MS);
      expect(host.quit).toEqual(['p1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes within ten seconds without changing player id or state', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const leaving = await addClientRoom(network, [], 'stable-resume-token');
    const observer = await addClientRoom(network);
    host.room.setPlayerState('p1', 'hp', 73, true);

    const handleQuit = vi.fn();
    host.room.getPlayerHandle('p1')?.onQuit(handleQuit);

    dropConnection(leaving);
    await Promise.resolve();

    expect(handleQuit).not.toHaveBeenCalled();
    expect(host.quit).toEqual([]);
    expect(observer.quit).toEqual([]);
    expect(leaving.room.getLocalPlayerId()).toBe('p1');
    expect(leaving.room.getPlayerState('p1', 'hp')).toBe(73);
    expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p1', 'p2']);
  });

  it('removes an unresumed player exactly once after ten seconds', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network);
      const client = await addClientRoom(network);
      const observer = await addClientRoom(network);
      client.transport.reconnectEnabled = false;

      dropConnection(client);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(host.quit).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);

      expect(host.quit).toEqual(['p1']);
      expect(observer.quit).toEqual(['p1']);
      expect(client.fatals).toHaveLength(1);
      expect(client.fatals[0]).toMatchObject({ kind: 'resume-expired' });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(host.quit).toEqual(['p1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops relaying to a link that is gone', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network);
      const leaving = await addClientRoom(network);
      const observer = await addClientRoom(network);
      leaving.transport.reconnectEnabled = false;

      dropConnection(leaving);
      await vi.advanceTimersByTimeAsync(10_000);
      host.room.setGlobal('gph', 'ARENA', true);

      expect(observer.room.getGlobal('gph')).toBe('ARENA');
      expect(leaving.room.getGlobal('gph')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('arena loading barrier', () => {
  it('replicates a compact descriptor, exposes per-player progress, and ignores spectators', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const participant = await addClientRoom(network);
    const lateJoiner = await addClientRoom(network);
    const bridge = new NetworkBridge();
    setActiveSession({ room: host.room, transport: host.transport, roomCode: 'ABC123' });
    bridge.activate();

    try {
      host.room.setGlobal('gph', 'ARENA', true);
      bridge.hostStartRoundParticipants(['p0', 'p1'], 0, 42);
      bridge.setLocalWorldLoadProgress(42, 20, 'building');
      expect(bridge.getPlayerWorldLoadState('p0', 42)).toEqual({
        worldRevision: 42,
        progress: 20,
        stage: 'building',
        ready: false,
      });
      expect(bridge.areRoundParticipantsWorldLoadReady()).toBe(false);

      host.room.setPlayerState('p1', 'wlr', {
        worldRevision: 42,
        progress: 100,
        stage: 'ready',
        ready: true,
      }, true);
      bridge.setLocalWorldLoadReady(42);
      expect(bridge.areRoundParticipantsWorldLoadReady()).toBe(true);

      bridge.publishWorldAndActivity(
        {
          worldRevision: 42,
          definitionId: 'world:coop-defense:0',
          seed: 123,
          generatorVersion: 1,
          layoutFingerprint: 'deadbeef',
        },
        {
          activityRevision: 42,
          worldRevision: 42,
          kind: 'coop-mission',
          definitionId: 'activity:coop-mission:0',
        },
      );
      expect(JSON.stringify(participant.room.getGlobal('wld')).length).toBeLessThan(1024);
      expect(lateJoiner.room.getGlobal('wld')).toEqual(host.room.getGlobal('wld'));
      expect(lateJoiner.room.getGlobal('act')).toEqual(host.room.getGlobal('act'));
      expect(host.room.getGlobal('aly')).toBeUndefined();

      bridge.hostEnterSpectator('p1');
      expect(bridge.areRoundParticipantsWorldLoadReady()).toBe(true);
    } finally {
      clearActiveSession();
    }
  });

  it('starts the solo barrier as soon as the local working set is ready', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const bridge = new NetworkBridge();
    setActiveSession({ room: host.room, transport: host.transport, roomCode: 'ABC123' });
    bridge.activate();
    try {
      host.room.setGlobal('gph', 'ARENA', true);
      bridge.hostStartRoundParticipants(['p0'], 0, 7);
      bridge.setLocalWorldLoadProgress(7, 100, 'ready', true);
      expect(bridge.areRoundParticipantsWorldLoadReady()).toBe(true);
    } finally {
      clearActiveSession();
    }
  });
});

describe('NetworkBridge placement preview presence', () => {
  it('sends changes immediately, refreshes active previews, and expires remote state', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network, ['inp']);
      const senderRoom = await addClientRoom(network, ['inp']);
      const observerRoom = await addClientRoom(network, ['inp']);
      const preview = {
        active: true,
        kind: 'turret',
        gridX: 3,
        gridY: 4,
        x: 224,
        y: 288,
        isValid: true,
        frame: 1,
      } as const;
      const sender = new NetworkBridge();
      setActiveSession({ room: senderRoom.room, transport: senderRoom.transport, roomCode: 'ABC123' });
      sender.activate();

      sender.sendLocalPlacementPreview(preview);
      senderRoom.room.update();
      host.room.update();
      expect(observerRoom.room.getPlayerState('p1', 'ppv')).toEqual(preview);

      senderRoom.transport.links[0].sent.length = 0;
      sender.sendLocalPlacementPreview(preview);
      senderRoom.room.update();
      expect(senderRoom.transport.links[0].sent.some(entry => entry.message.t === 'b')).toBe(false);

      await vi.advanceTimersByTimeAsync(150);
      sender.sendLocalPlacementPreview(preview);
      senderRoom.room.update();
      host.room.update();
      expect(senderRoom.transport.links[0].sent.some(entry => entry.message.t === 'b')).toBe(true);

      const observer = new NetworkBridge();
      setActiveSession({ room: observerRoom.room, transport: observerRoom.transport, roomCode: 'ABC123' });
      observer.activate();
      expect(observer.getPlayerPlacementPreview('p1')).toEqual(preview);

      await vi.advanceTimersByTimeAsync(599);
      expect(observer.getPlayerPlacementPreview('p1')).toEqual(preview);
      await vi.advanceTimersByTimeAsync(2);
      expect(observer.getPlayerPlacementPreview('p1')).toBeNull();
    } finally {
      clearActiveSession();
      vi.useRealTimers();
    }
  });
});
