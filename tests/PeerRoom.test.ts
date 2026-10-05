import { describe, expect, it, vi } from 'vitest';
import {
  MAX_PLAYERS,
  PEER_HANDSHAKE_TIMEOUT_MS,
  PEER_HEARTBEAT_INTERVAL_MS,
  PEER_HEARTBEAT_TIMEOUT_MS,
  PEER_RESUME_GRACE_MS,
} from '../src/config';
import { PeerRoom, type PeerPlayerHandle } from '../src/network/peer/PeerRoom';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { createPeerNetworkError } from '../src/network/peer/PeerSignaling';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { PEER_PROTOCOL_VERSION, type PeerChannelKind, type PeerMessage } from '../src/network/peer/protocol';
import type { LoadoutCommitSnapshot } from '../src/types';
import { DEFAULT_LOADOUT } from '../src/loadout/LoadoutConfig';
import { CoopDefensePlayerModifierSystem } from '../src/systems/CoopDefensePlayerModifierSystem';

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

function connectUnadmittedClient(network: FakeNetwork) {
  const client = network.createClientTransport();
  client.setHandlers({
    onLinkRegistered: () => {}, onLinkReady: () => {}, onLinkClosed: () => {}, onFatal: () => {},
    onMessage: (link, message) => { if (message.t === 'hb') link.send({ t: 'hba' }, 'rel'); },
  });
  network.connectClient(client);
  return client.links[0];
}

describe('PeerRoom handshake and roster', () => {
  it.each(['team_deathmatch', 'capture_the_beer'] as const)('keeps the team fixed during %s even if its client clears ready', async mode => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);
    try {
      setActiveSession({ room: host.room, transport: host.transport, roomCode: 'ABC123' });
      const bridge = new NetworkBridge();
      bridge.activate();
      bridge.setGameMode(mode);
      bridge.setGamePhase('LOBBY');
      const hostTeam = bridge.getPlayerTeam('p0')!;
      await expect(client.room.callHost('tmr', { teamId: hostTeam }, 500)).resolves.toBe(true);
      expect(bridge.getPlayerTeam('p1')).toBe(hostTeam);
      bridge.hostSetPlayerReady('p1', true);
      const otherTeam = hostTeam === 'blue' ? 'red' : 'blue';
      await expect(client.room.callHost('tmr', { teamId: otherTeam }, 500)).resolves.toBe(false);
      bridge.setGamePhase('ARENA');
      client.room.setPlayerState('p1', 'isr', false, true);
      expect(bridge.getPlayerReady('p1')).toBe(false);
      await expect(client.room.callHost('tmr', { teamId: otherTeam }, 500)).resolves.toBe(false);
      expect(bridge.getPlayerTeam('p1')).toBe(hostTeam);
      expect(bridge.areTeammates('p0', 'p1')).toBe(true);
    } finally { clearActiveSession(); client.room.destroy(); host.room.destroy(); }
  });

  it('expires a ready but unadmitted client even when it keeps answering heartbeats', async () => {
    vi.useFakeTimers();
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = connectUnadmittedClient(network);
    try {
      await vi.advanceTimersByTimeAsync(PEER_HANDSHAKE_TIMEOUT_MS - 1);
      expect(client.closed).toBe(false);
      // Repeated ready notifications must not move the original admission deadline.
      host.transport.handlers!.onLinkReady(host.transport.links[0]);
      await vi.advanceTimersByTimeAsync(1);
      expect(client.closed).toBe(true);
      expect(host.room.getPlayerIds()).toEqual(['p0']);
      expect(vi.getTimerCount()).toBe(0);
    } finally { host.room.destroy(); vi.useRealTimers(); }
  });

  it('starts the host hello deadline at transport readiness and clears it after a valid hello', async () => {
    vi.useFakeTimers();
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const onReady = host.transport.handlers!.onLinkReady;
    host.transport.handlers!.onLinkReady = () => {};
    const client = connectUnadmittedClient(network);
    try {
      await vi.advanceTimersByTimeAsync(PEER_HANDSHAKE_TIMEOUT_MS + 1);
      expect(client.closed).toBe(false);
      onReady(host.transport.links[0]);
      await vi.advanceTimersByTimeAsync(PEER_HANDSHAKE_TIMEOUT_MS - 1);
      client.send({ t: 'hello', v: PEER_PROTOCOL_VERSION, k: 'slow-transport-valid-token' }, 'rel');
      expect(host.room.getPlayerIds()).toEqual(['p0', 'p1']);
      await vi.advanceTimersByTimeAsync(PEER_HANDSHAKE_TIMEOUT_MS * 2);
      expect(client.closed).toBe(false);
      expect(vi.getTimerCount()).toBe(1); // Only the existing room heartbeat remains.
    } finally { host.room.destroy(); vi.useRealTimers(); }
  });

  it.each(['close', 'destroy'] as const)('clears a pending host hello deadline on %s', async cause => {
    vi.useFakeTimers();
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = connectUnadmittedClient(network);
    const close = vi.spyOn(host.transport.links[0], 'close');
    try {
      if (cause === 'close') client.close();
      else host.room.destroy();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(PEER_HANDSHAKE_TIMEOUT_MS * 2);
      expect(close).not.toHaveBeenCalled();
    } finally { host.room.destroy(); vi.useRealTimers(); }
  });

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

    const departedId = clients[0].room.getLocalPlayerId();
    clients[0].room.leave();
    const replacement = await addClientRoom(network);
    expect(replacement.room.getLocalPlayerId()).not.toBe(departedId);
    expect(host.room.getPlayerIds()).toHaveLength(MAX_PLAYERS);
    replacement.room.destroy();
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

  it('frees room capacity after grace expires without reusing the departed identity', async () => {
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

      expect(replacement.room.getLocalPlayerId()).not.toBe(first.room.getLocalPlayerId());
      expect(host.room.getPlayerIds().sort()).toEqual(['p0', replacement.room.getLocalPlayerId()]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('lobby Ready revision', () => {
  it.each(['mode change', 'same configuration reset', 'mode round trip'])(
    'rejects an old in-flight Ready after %s and accepts a fresh Ready', async boundary => {
      const network = new FakeNetwork();
      const hostRoom = await createHostRoom(network);
      const clientRoom = await addClientRoom(network);
      const useHost = () => setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
      const useClient = () => setActiveSession({ room: clientRoom.room, transport: clientRoom.transport, roomCode: 'ABC123' });
      useHost();
      const host = new NetworkBridge();
      host.activate();
      host.setGameMode('deathmatch');
      useClient();
      const client = new NetworkBridge();
      client.activate();
      const commit: LoadoutCommitSnapshot = {
        weapon1: DEFAULT_LOADOUT.weapon1.id, weapon2: DEFAULT_LOADOUT.weapon2.id,
        utility: DEFAULT_LOADOUT.utility.id, ultimate: DEFAULT_LOADOUT.ultimate.id,
      };
      const link = clientRoom.transport.links[0];
      const send = link.send.bind(link);
      const delayed: Array<{ message: PeerMessage; channel: PeerChannelKind }> = [];
      const capture = vi.spyOn(link, 'send').mockImplementation((message, channel) => {
        delayed.push({ message, channel });
      });
      try {
        expect(client.getLobbySyncConsistency().consistent).toBe(true);
        client.setLocalReadyWithCommittedLoadout(commit);
        expect(delayed.length).toBeGreaterThan(0);
        capture.mockRestore();
        useHost();
        if (boundary === 'same configuration reset') host.hostResetAllLobbyReady();
        else {
          host.setGameMode('team_deathmatch');
          if (boundary === 'mode round trip') host.setGameMode('deathmatch');
        }
        expect(host.getPlayerReady('p1')).toBe(false);
        host.setLocalReadyWithCommittedLoadout(commit);
        for (const packet of delayed) send(packet.message, packet.channel);
        expect(host.getPlayerReady('p1')).toBe(false);
        expect(host.areAllPlayersReady()).toBe(false);

        useClient();
        expect(client.getPlayerReady('p1')).toBe(false);
        client.setLocalReadyWithCommittedLoadout(commit);
        useHost();
        expect(host.getPlayerReady('p1')).toBe(true);
        expect(host.areAllPlayersReady()).toBe(true);
        // Republishing the same lobby snapshot is not another readiness reset.
        host.publishLobbySync();
        host.publishLobbySync();
        expect(host.areAllPlayersReady()).toBe(true);
      } finally {
        capture.mockRestore();
        clearActiveSession();
        clientRoom.room.destroy();
        hostRoom.room.destroy();
      }
    },
  );
});

describe('lobby Ready revision across peer lifetimes', () => {
  it('inherits the current Ready revision on joining and reloading the same player', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const useHost = () => setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
    useHost();
    const host = new NetworkBridge();
    host.activate();
    host.hostResetAllLobbyReady();
    host.hostResetAllLobbyReady();
    const joined = await addClientRoom(network, [], 'ready-reload-token');
    let reloaded: typeof joined | undefined;
    try {
      setActiveSession({ room: joined.room, transport: joined.transport, roomCode: 'ABC123' });
      const joinedBridge = new NetworkBridge();
      joinedBridge.activate();
      joinedBridge.setLocalReady(true);
      useHost();
      expect(host.getPlayerReady('p1')).toBe(true);

      // A browser reload creates a fresh Bridge, while the room retains the player's identity.
      joined.room.destroy();
      dropConnection(joined);
      host.hostResetAllLobbyReady();
      reloaded = await addClientRoom(network, [], 'ready-reload-token');
      expect(reloaded.room.getLocalPlayerId()).toBe('p1');
      setActiveSession({ room: reloaded.room, transport: reloaded.transport, roomCode: 'ABC123' });
      const reloadedBridge = new NetworkBridge();
      reloadedBridge.activate();
      expect(reloadedBridge.getPlayerReady('p1')).toBe(false);
      reloadedBridge.setLocalReady(true);
      useHost();
      expect(host.getPlayerReady('p1')).toBe(true);
    } finally {
      clearActiveSession();
      reloaded?.room.destroy();
      joined.room.destroy();
      hostRoom.room.destroy();
    }
  });

  it('requires a current numeric Ready revision instead of truthy or malformed client state', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
    const host = new NetworkBridge();
    host.activate();
    host.hostResetAllLobbyReady();
    host.hostSetPlayerReady('p1', true);
    const current = hostRoom.room.getPlayerState('p1', 'isr') as { r: number };
    try {
      for (const ready of [true, false, null, 1, 'ready', [], {}, { r: null }, { r: String(current.r) },
        { r: current.r - 1 }, { r: current.r + 1 }, { r: -1 }, { r: 1.5 }, { r: Number.MAX_SAFE_INTEGER + 1 }]) {
        clientRoom.room.setPlayerState('p1', 'isr', ready, true);
        expect(host.getPlayerReady('p1')).toBe(false);
      }
      clientRoom.room.setPlayerState('p1', 'isr', current, true);
      expect(host.getPlayerReady('p1')).toBe(true);
    } finally {
      clearActiveSession();
      clientRoom.room.destroy();
      hostRoom.room.destroy();
    }
  });
});

describe('PeerRoom replicated state', () => {
  it.each(['name', 'ready', 'unready', 'committed-ready'] as const)(
    'delivers the one-time %s decision to host and observers even if fast packets are lost',
    async action => {
      const network = new FakeNetwork();
      const host = await createHostRoom(network);
      const client = await addClientRoom(network);
      const observer = await addClientRoom(network);
      const playerId = client.room.getLocalPlayerId();
      const commit: LoadoutCommitSnapshot = {
        weapon1: DEFAULT_LOADOUT.weapon1.id, weapon2: DEFAULT_LOADOUT.weapon2.id,
        utility: DEFAULT_LOADOUT.utility.id, ultimate: DEFAULT_LOADOUT.ultimate.id,
        coopDefenseClassId: null, coopDefenseProfile: null,
      };
      try {
        setActiveSession({ room: host.room, transport: host.transport, roomCode: 'ABC123' });
        const hostBridge = new NetworkBridge();
        hostBridge.activate();
        hostBridge.hostSetPlayerReady(playerId, action === 'unready');
        for (const room of [host, client, observer]) {
          for (const link of room.transport.links) link.fastReady = false;
        }
        setActiveSession({ room: client.room, transport: client.transport, roomCode: 'ABC123' });
        const bridge = new NetworkBridge();
        if (action === 'name') bridge.setLocalName('Neuer Dachs');
        else if (action === 'committed-ready') bridge.setLocalReadyWithCommittedLoadout(commit);
        else bridge.setLocalReady(action === 'ready');
        client.room.update();
        host.room.update();

        const key = action === 'name' ? 'pnm' : 'isr';
        const expected = action === 'name' ? 'Neuer Dachs' : action !== 'unready';
        for (const room of [host, observer]) {
          setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
          const receiver = room === host ? hostBridge : new NetworkBridge();
          receiver.activate();
          expect(action === 'name' ? room.room.getPlayerState(playerId, key) : receiver.getPlayerReady(playerId)).toBe(expected);
          if (action === 'committed-ready') expect(room.room.getPlayerState(playerId, 'lcm')).toEqual(commit);
          if (action === 'unready') expect(room.room.getPlayerState(playerId, 'lcm')).toBeNull();
        }
      } finally {
        clearActiveSession();
        client.room.destroy(); observer.room.destroy(); host.room.destroy();
      }
    },
  );

  it('orders a new player name after the reliable join even when fast traffic overtakes the roster', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const observer = await addClientRoom(network);
    const observerLink = host.transport.links[0];
    const send = observerLink.send.bind(observerLink);
    const reliableQueue: PeerMessage[] = [];
    observerLink.send = (message, channel) => {
      if (channel === 'rel') reliableQueue.push(message);
      else send(message, channel);
    };
    const newcomer = await addClientRoom(network);
    try {
      const playerId = newcomer.room.getLocalPlayerId();
      setActiveSession({ room: newcomer.room, transport: newcomer.transport, roomCode: 'ABC123' });
      new NetworkBridge().setLocalName('Neuer Dachs');
      newcomer.room.update();
      host.room.update();
      expect(host.room.getPlayerState(playerId, 'pnm')).toBe('Neuer Dachs');
      expect(observer.room.getPlayerIds()).not.toContain(playerId);
      expect(reliableQueue[0]?.t).toBe('join');

      for (const message of reliableQueue) send(message, 'rel');
      expect(observer.room.getPlayerState(playerId, 'pnm')).toBe('Neuer Dachs');
    } finally {
      clearActiveSession();
      newcomer.room.destroy(); observer.room.destroy(); host.room.destroy();
    }
  });

  it('keeps ordinary Bridge movement input replaceable and on the host-only fast channel', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network, ['inp']);
    const client = await addClientRoom(network, ['inp']);
    const observer = await addClientRoom(network, ['inp']);
    try {
      host.room.setGlobal('wld', {
        worldRevision: 1, definitionId: 'world:lobby', seed: 1,
        generatorVersion: 1, layoutFingerprint: 'lobby',
      }, true);
      setActiveSession({ room: client.room, transport: client.transport, roomCode: 'ABC123' });
      const bridge = new NetworkBridge();
      vi.spyOn(bridge, 'getLocalWorldParticipation').mockReturnValue('interactive');
      bridge.sendLocalInput({ dx: 1, dy: 0, aim: 0 });
      bridge.sendLocalInput({ dx: 0, dy: 1, aim: 128 });
      expect(host.room.getPlayerState('p1', 'inp')).toBeUndefined();
      client.room.update();
      host.room.update();

      expect(host.room.getPlayerState('p1', 'inp')).toMatchObject({ dx: 0, dy: 1, aim: 128 });
      expect(observer.room.getPlayerState('p1', 'inp')).toBeUndefined();
      const inputPackets = client.transport.links[0].sent.filter(entry =>
        entry.message.t === 'b' && entry.message.p?.some(([, key]) => key === 'inp'));
      expect(inputPackets).toHaveLength(1);
      expect(inputPackets[0].channel).toBe('fast');
    } finally {
      clearActiveSession();
      client.room.destroy(); observer.room.destroy(); host.room.destroy();
    }
  });

  it.each(['rel', 'fast'] as const)('accepts only admitted client-owned state from its origin on %s', async (channel) => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network, ['inp']);
    const first = await addClientRoom(network, ['inp']);
    const second = await addClientRoom(network, ['inp']);
    try {
      host.room.setGlobal('gph', 'LOBBY', true);
      host.room.setPlayerState('p1', 'pbk', { confirmed: true }, true);
      first.transport.links[0].send({
        t: 'b', q: 1, g: [['gph', 'ARENA']], p: [
          ['p1', 'pnm', 'Allowed name'],
          ['p1', 'inp', { dx: 1, dy: 0 }],
          ['p1', 'pbk', { forged: true }],
          ['p2', 'pnm', 'Forged name'],
          ['p2', 'inp', { dx: -1, dy: 0 }],
          ['unknown', 'pnm', 'Ghost'],
        ],
      }, channel);
      host.room.update();

      expect(host.room.getGlobal('gph')).toBe('LOBBY');
      expect(second.room.getGlobal('gph')).toBe('LOBBY');
      expect(host.room.getPlayerState('p1', 'pnm')).toBe('Allowed name');
      expect(second.room.getPlayerState('p1', 'pnm')).toBe('Allowed name');
      expect(host.room.getPlayerState('p1', 'inp')).toEqual({ dx: 1, dy: 0 });
      expect(second.room.getPlayerState('p1', 'inp')).toBeUndefined();
      expect(host.room.getPlayerState('p1', 'pbk')).toEqual({ confirmed: true });
      expect(second.room.getPlayerState('p1', 'pbk')).toEqual({ confirmed: true });
      expect(host.room.getPlayerState('p2', 'pnm')).toBeUndefined();
      expect(host.room.getPlayerState('p2', 'inp')).toBeUndefined();
      expect(host.room.getPlayerIds()).toEqual(['p0', 'p1', 'p2']);
    } finally { first.room.destroy(); second.room.destroy(); host.room.destroy(); }
  });

  it('ignores state and RPCs before admission and after a link is removed', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const pendingLink = new SilentLink('pending-client');
    const handler = vi.fn();
    host.room.registerHostHandler('command', handler);
    host.transport.handlers?.onLinkRegistered(pendingLink);
    try {
      host.transport.handlers?.onMessage(pendingLink, { t: 'rpc', c: 0, n: 'command', d: {} }, 'rel');
      host.transport.handlers?.onMessage(pendingLink, { t: 'b', g: [['gph', 'ARENA']] }, 'rel');
      expect(handler).not.toHaveBeenCalled();
      expect(host.room.getGlobal('gph')).toBeUndefined();

      const client = await addClientRoom(network);
      const removedLink = host.transport.links[0];
      host.room.kickPlayer('p1');
      host.transport.handlers?.onMessage(removedLink, { t: 'rpc', c: 0, n: 'command', d: {} }, 'rel');
      host.transport.handlers?.onMessage(removedLink, { t: 'b', p: [['p1', 'pnm', 'Ghost']] }, 'rel');
      expect(handler).not.toHaveBeenCalled();
      expect(host.room.getPlayerIds()).toEqual(['p0']);
      client.room.destroy();
    } finally { host.room.destroy(); }
  });

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
  it.each(['queued', 'delayed'] as const)('does not resurrect a departed player from %s fast state', async (delivery) => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const first = await addClientRoom(network);
    const observer = await addClientRoom(network);
    try {
      first.room.setPlayerState('p1', 'png', 42, false);
      first.room.update();
      if (delivery === 'delayed') {
        host.transport.links[1].fastReady = false;
        host.room.update();
        host.transport.links[1].fastReady = true;
      }
      host.room.kickPlayer('p1');
      expect(observer.room.getPlayerIds()).toEqual(['p0', 'p2']);

      if (delivery === 'queued') host.room.update();
      else host.transport.links[1].send({ t: 'b', q: 1, p: [['p1', 'png', 42]] }, 'fast');

      expect(observer.room.getPlayerIds()).toEqual(['p0', 'p2']);
      expect(observer.room.getPlayerState('p1', 'png')).toBeUndefined();
      expect(observer.room.getPlayerHandle('p1')).toBeUndefined();

      const replacement = await addClientRoom(network);
      try {
        const replacementId = replacement.room.getLocalPlayerId();
        replacement.room.setPlayerState(replacementId, 'png', 23, false);
        replacement.room.update(); host.room.update();
        expect(observer.room.getPlayerHandle(replacementId)).toBeDefined();
        expect(observer.room.getPlayerState(replacementId, 'png')).toBe(23);
      } finally { replacement.room.destroy(); }
    } finally { first.room.destroy(); observer.room.destroy(); host.room.destroy(); }
  });

  it('keeps a delayed former player snapshot away from a replacement in the same room', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const first = await addClientRoom(network);
    const observer = await addClientRoom(network);
    try {
      host.room.setPlayerState(first.room.getLocalPlayerId(), 'frg', 9, false);
      const observerLink = host.transport.links[1];
      observerLink.fastReady = false;
      host.room.update();
      observerLink.fastReady = true;
      const delayed = observerLink.sent.find(entry => entry.channel === 'fast' && entry.message.t === 'b')!.message;
      host.room.kickPlayer(first.room.getLocalPlayerId());

      const replacement = await addClientRoom(network);
      try {
        const replacementId = replacement.room.getLocalPlayerId();
        host.room.setPlayerState(replacementId, 'frg', 0, true);
        observerLink.send(delayed, 'fast');
        expect(observer.room.getPlayerState(replacementId, 'frg')).toBe(0);
        expect(observer.room.getPlayerIds()).not.toContain(first.room.getLocalPlayerId());
      } finally { replacement.room.destroy(); }
    } finally { first.room.destroy(); observer.room.destroy(); host.room.destroy(); }
  });

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
    expect(replacement.room.getLocalPlayerId()).not.toBe(leaving.room.getLocalPlayerId());
    expect(host.room.getPlayerIds().sort()).toEqual(['p0', 'p2', replacement.room.getLocalPlayerId()]);
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
      // Die Ladebarriere haengt an der World-Instanz - sie muss also zuerst existieren.
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
      bridge.hostPublishWorldParticipation({ p0: 'interactive', p1: 'interactive' });
      bridge.setLocalWorldLoadProgress(42, 20, 'building');
      expect(bridge.getPlayerWorldLoadState('p0', 42)).toEqual({
        worldRevision: 42,
        progress: 20,
        stage: 'building',
        ready: false,
      });
      expect(bridge.areWorldParticipantsLoadReady()).toBe(false);

      host.room.setPlayerState('p1', 'wlr', {
        worldRevision: 42,
        progress: 100,
        stage: 'ready',
        ready: true,
      }, true);
      bridge.setLocalWorldLoadReady(42);
      expect(bridge.areWorldParticipantsLoadReady()).toBe(true);

      expect(JSON.stringify(participant.room.getGlobal('wld')).length).toBeLessThan(1024);
      expect(lateJoiner.room.getGlobal('wld')).toEqual(host.room.getGlobal('wld'));
      expect(lateJoiner.room.getGlobal('act')).toEqual(host.room.getGlobal('act'));
      expect(host.room.getGlobal('aly')).toBeUndefined();

      bridge.hostEnterSpectator('p1');
      expect(bridge.areWorldParticipantsLoadReady()).toBe(true);
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
      bridge.publishWorldAndActivity(
        {
          worldRevision: 7,
          definitionId: 'world:coop-defense:0',
          seed: 5,
          generatorVersion: 1,
          layoutFingerprint: 'feedface',
        },
        null,
      );
      bridge.hostPublishWorldParticipation({ p0: 'interactive' });
      bridge.setLocalWorldLoadProgress(7, 100, 'ready', true);
      expect(bridge.areWorldParticipantsLoadReady()).toBe(true);
    } finally {
      clearActiveSession();
    }
  });
});

describe('NetworkBridge remote loadout selection', () => {
  it('keeps non-string JSON slot values out of host reconciliation and live snapshots', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const senderRoom = await addClientRoom(network);
    const observerRoom = await addClientRoom(network);
    const use = (room: typeof hostRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    try {
      use(hostRoom); const host = new NetworkBridge(); host.activate();
      use(observerRoom); const observer = new NetworkBridge(); observer.activate();
      for (const [slot, key] of [['weapon1', 'lw1'], ['weapon2', 'lw2'], ['utility', 'lut'], ['ultimate', 'lul']] as const) {
        for (const value of [{ toString: null }, { valueOf: 1, toString: 2 }, [], [DEFAULT_LOADOUT[slot].id], null, 42, true]) {
          senderRoom.room.setPlayerState('p1', key, value, true);
          senderRoom.room.update(); hostRoom.room.update();
          use(hostRoom);
          // The real host consumer used to throw while converting a JSON object to a registry key.
          expect(() => host.hostReconcileLoadoutsForMode('deathmatch')).not.toThrow();
          // Re-send after reconciliation, which legitimately replaces invalid selections with defaults.
          senderRoom.room.setPlayerState('p1', key, value, true);
          senderRoom.room.update(); hostRoom.room.update();
          for (const [room, bridge] of [[hostRoom, host], [observerRoom, observer]] as const) {
            use(room);
            expect(bridge.getPlayerLoadoutSlot('p1', slot)).toBeUndefined();
            expect(bridge.getPlayerCurrentLoadoutSnapshot('p1')?.[slot]).toBe(DEFAULT_LOADOUT[slot].id);
          }
        }
        for (const value of [DEFAULT_LOADOUT[slot].id, '']) {
          senderRoom.room.setPlayerState('p1', key, value, true);
          senderRoom.room.update(); hostRoom.room.update();
          use(hostRoom); expect(host.getPlayerLoadoutSlot('p1', slot)).toBe(value);
          use(observerRoom); expect(observer.getPlayerLoadoutSlot('p1', slot)).toBe(value);
        }
      }
    } finally { clearActiveSession(); }
  });
});

describe('NetworkBridge placement preview presence', () => {
  it('rejects malformed relayed previews before they reach host or client renderers', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const senderRoom = await addClientRoom(network);
    const observerRoom = await addClientRoom(network);
    const use = (room: typeof hostRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    try {
      use(hostRoom);
      const host = new NetworkBridge(); host.activate();
      host.publishWorldAndActivity({ worldRevision: 11, definitionId: 'world:test', seed: 5,
        generatorVersion: 1, layoutFingerprint: 'feedface' }, null);
      use(observerRoom);
      const observer = new NetworkBridge(); observer.activate();
      const preview = { active: true, kind: 'turret', worldRevision: 11,
        gridX: 3, gridY: 4, x: 224, y: 288, isValid: true, frame: 1 };
      const send = (value: unknown) => {
        senderRoom.room.setPlayerState('p1', 'ppv', value);
        senderRoom.room.update(); hostRoom.room.update();
      };
      const invalid = [
        { constructionId: 'missing-construction' }, { constructionId: 'constructor' },
        { turretWeaponId: 'missing-weapon' }, { turretWeaponId: 'constructor' },
        { kind: 'missing-kind' }, { active: 'true' }, { isValid: 'false' },
        { x: null }, { x: '224' }, { y: Infinity }, { gridX: 1.5 }, { gridY: '4' },
        { frame: -1 }, { frame: {} }, { stage: 3 }, { anchorX: {} },
        { anchorY: '1' }, { anchorGridX: .5 }, { anchorGridY: null },
        { powerUpDefId: 'constructor' }, { powerUpDefId: {} },
      ];
      for (const overrides of invalid) {
        send({ ...preview, ...overrides });
        use(hostRoom);
        expect(host.getPlayerPlacementPreview('p1'), JSON.stringify(overrides)).toBeNull();
        use(observerRoom);
        expect(observer.getPlayerPlacementPreview('p1'), JSON.stringify(overrides)).toBeNull();
      }
      for (const valid of [
        preview,
        { ...preview, constructionId: 'spore_turret', turretWeaponId: 'SPORE_TURRET_PLASMA' },
        { ...preview, kind: 'rock', gridX: -1, x: -32, isValid: false },
        { ...preview, kind: 'pedestal', powerUpDefId: 'HEALTH_PACK' },
        { ...preview, kind: 'drone_station', constructionId: 'attack_drone_station' },
        { ...preview, kind: 'tunnel', stage: 2, anchorX: -32, anchorY: 0, anchorGridX: -1, anchorGridY: 0 },
      ]) {
        send(valid);
        use(hostRoom); expect(host.getPlayerPlacementPreview('p1')).toEqual(valid);
        use(observerRoom); expect(observer.getPlayerPlacementPreview('p1')).toEqual(valid);
      }
    } finally { clearActiveSession(); }
  });

  it('sends changes immediately, refreshes active previews, and expires remote state', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeNetwork();
      const host = await createHostRoom(network, ['inp']);
      const senderRoom = await addClientRoom(network, ['inp']);
      const observerRoom = await addClientRoom(network, ['inp']);
      const hostBridge = new NetworkBridge();
      setActiveSession({ room: host.room, transport: host.transport, roomCode: 'ABC123' });
      hostBridge.activate();
      hostBridge.publishWorldAndActivity({
        worldRevision: 11,
        definitionId: 'world:test',
        seed: 5,
        generatorVersion: 1,
        layoutFingerprint: 'feedface',
      }, null);
      hostBridge.hostPublishWorldParticipation({
        p0: 'interactive',
        p1: 'interactive',
        p2: 'interactive',
      });
      const preview = {
        active: true,
        kind: 'turret',
        gridX: 3,
        gridY: 4,
        x: 224,
        y: 288,
        isValid: true,
        frame: 1,
        worldRevision: 11,
      } as const;
      const sender = new NetworkBridge();
      setActiveSession({ room: senderRoom.room, transport: senderRoom.transport, roomCode: 'ABC123' });
      sender.activate();

      sender.sendLocalPlacementPreview(preview);
      senderRoom.room.update();
      host.room.update();
      expect(observerRoom.room.getPlayerState('p1', 'ppv')).toEqual(preview);

      senderRoom.transport.links[0].sent.length = 0;
      const plasmaPreview = { ...preview, turretWeaponId: 'SPORE_TURRET_PLASMA' as const };
      sender.sendLocalPlacementPreview(plasmaPreview);
      senderRoom.room.update();
      host.room.update();
      expect(observerRoom.room.getPlayerState('p1', 'ppv')).toEqual(plasmaPreview);
      sender.sendLocalPlacementPreview(preview);
      senderRoom.room.update();
      host.room.update();
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

describe('host-frozen round loadouts', () => {
  type Room = Awaited<ReturnType<typeof createHostRoom>>;
  const use = (room: Room) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
  const activate = (room: Room) => {
    use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge;
  };
  const commit = (hp = 2): LoadoutCommitSnapshot => ({
    weapon1: DEFAULT_LOADOUT.weapon1.id, weapon2: DEFAULT_LOADOUT.weapon2.id,
    utility: DEFAULT_LOADOUT.utility.id, ultimate: DEFAULT_LOADOUT.ultimate.id,
    coopDefenseClassId: null,
    coopDefenseProfile: { upgrades: { hp: { unlocked: true, level: hp } }, toolLoadout: [] },
  });
  const start = (host: NetworkBridge, revision = 1) => {
    host.hostStartRoundParticipants(host.getConnectedPlayerIds(), 0, revision);
    host.publishWorldAndActivity({ worldRevision: revision, definitionId: 'world:coop-defense:1',
      seed: 1, generatorVersion: 1, layoutFingerprint: '12345678', parameters: {} }, {
      worldRevision: revision, activityRevision: revision, kind: 'coop-mission', definitionId: 'activity:coop-mission:1',
    });
    host.setGamePhase('ARENA');
  };

  it.each(['replace', 'clear'] as const)('keeps the actual modifiers and weapons when a client tries to %s its commit', async action => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network), observerRoom = await addClientRoom(network);
    try {
      const host = activate(hostRoom), client = activate(clientRoom), observer = activate(observerRoom);
      use(hostRoom); host.setGameMode('coop_defense');
      use(clientRoom); client.setLocalReadyWithCommittedLoadout(commit());
      use(hostRoom); start(host);
      const modifiers = new CoopDefensePlayerModifierSystem();
      modifiers.syncPlayer('p1', host.getPlayerCurrentLoadoutSnapshot('p1'));
      const initialHp = modifiers.getMaxHp('p1');
      expect(initialHp).toBeGreaterThan(100);
      use(clientRoom);
      if (action === 'replace') client.setLocalReadyWithCommittedLoadout({ ...commit(8), weapon1: 'AK47' });
      else client.setLocalReady(false);
      for (const [room, bridge] of [[hostRoom, host], [clientRoom, client], [observerRoom, observer]] as const) {
        use(room);
        const snapshot = bridge.getPlayerCurrentLoadoutSnapshot('p1');
        expect(snapshot?.weapon1).toBe(DEFAULT_LOADOUT.weapon1.id);
        modifiers.syncPlayer('p1', snapshot);
        expect(modifiers.getMaxHp('p1')).toBe(initialHp);
      }
    } finally {
      clearActiveSession(); observerRoom.room.destroy(); clientRoom.room.destroy(); hostRoom.room.destroy();
    }
  });

  it('captures independent nested Host values before the round starts and keeps lobby selection for the next round', async () => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network);
    try {
      const host = activate(hostRoom);
      host.setGameMode('coop_defense');
      const raw = { ...commit(), equippedItems: [{ uid: 'armor', slot: 'armor' as const,
        rarity: 'white' as const, itemLevel: 1, baseValue: 25, affixes: [] }] };
      host.setLocalReadyWithCommittedLoadout(raw);
      const lobbySnapshot = host.getPlayerCommittedLoadout('p0')!;
      start(host);
      const published = hostRoom.room.getGlobal('rlc') as { loadouts: Record<string, LoadoutCommitSnapshot> };
      expect(published.loadouts.p0.coopDefenseProfile).not.toBe(lobbySnapshot.coopDefenseProfile);
      const frozen = host.getPlayerCommittedLoadout('p0')!;
      expect(frozen).not.toBe(lobbySnapshot);
      expect(frozen.coopDefenseProfile).not.toBe(lobbySnapshot.coopDefenseProfile);
      raw.coopDefenseProfile!.upgrades.hp.level = 8;
      lobbySnapshot.coopDefenseProfile!.upgrades.hp.level = 8;
      raw.equippedItems[0].baseValue = 0;
      host.setLocalReadyWithCommittedLoadout({ ...commit(8), weapon1: 'AK47' });
      expect(host.getPlayerCommittedLoadout('p0')).toMatchObject({
        weapon1: DEFAULT_LOADOUT.weapon1.id, coopDefenseProfile: { upgrades: { hp: { level: 2 } } },
        equippedItems: [{ baseValue: 25 }],
      });
      host.hostResetRoundParticipation();
      host.clearWorldAndActivity(); host.setGamePhase('LOBBY');
      expect(hostRoom.room.getGlobal('rlc')).toBeNull();
      expect(host.getPlayerCommittedLoadout('p0')?.weapon1).toBe('AK47');
      host.setLocalLoadoutSlot('weapon1', 'AK47');
      expect(host.getPlayerCurrentLoadoutSnapshot('p0')?.weapon1).toBe('AK47');
      start(host, 2);
      expect(host.getPlayerCommittedLoadout('p0')?.weapon1).toBe('AK47');
      host.setLocalReady(false);
      expect(host.getPlayerCommittedLoadout('p0')?.weapon1).toBe('AK47');
    } finally { clearActiveSession(); hostRoom.room.destroy(); }
  });

  it('retains the frozen snapshot across resume and admits late joiners only as spectators', async () => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    let late: Room | undefined;
    try {
      const host = activate(hostRoom), client = activate(clientRoom);
      use(clientRoom); client.setLocalReadyWithCommittedLoadout(commit());
      use(hostRoom); start(host);
      use(clientRoom); client.setLocalReadyWithCommittedLoadout({ ...commit(8), weapon1: 'AK47' });
      use(hostRoom); dropConnection(clientRoom); await Promise.resolve();
      use(clientRoom);
      expect(client.getPlayerCommittedLoadout('p1')?.weapon1).toBe(DEFAULT_LOADOUT.weapon1.id);
      expect(client.getPlayerCommittedLoadout('p1')?.coopDefenseProfile?.upgrades.hp.level).toBe(2);
      use(hostRoom); late = await addClientRoom(network);
      const spectator = activate(late);
      spectator.setLocalReadyWithCommittedLoadout(commit(8));
      expect(spectator.getPlayerCommittedLoadout('p1')?.weapon1).toBe(DEFAULT_LOADOUT.weapon1.id);
      expect(spectator.getPlayerCommittedLoadout('p2')).toBeNull();
      expect(spectator.isLocalSpectator()).toBe(true);
      use(hostRoom); expect(host.getPlayerCommittedLoadout('p2')).toBeNull();
    } finally { clearActiveSession(); late?.room.destroy(); clientRoom.room.destroy(); hostRoom.room.destroy(); }
  });

  it('never falls back to client commits for missing, mismatched or inherited round entries', async () => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    try {
      const host = activate(hostRoom), client = activate(clientRoom);
      use(clientRoom); client.setLocalReadyWithCommittedLoadout(commit());
      use(hostRoom); start(host);
      for (const raw of [null, {}, { roundRevision: 2, loadouts: { p1: commit(8) } },
        { roundRevision: 1, loadouts: [] }, { roundRevision: 1, loadouts: Object.create({ p1: commit(8) }) }]) {
        hostRoom.room.setGlobal('rlc', raw, true);
        expect(host.getPlayerCommittedLoadout('p1')).toBeNull();
        use(clientRoom); expect(client.getPlayerCommittedLoadout('p1')).toBeNull();
        use(hostRoom);
      }
      hostRoom.room.setGlobal('rlc', { roundRevision: 1, loadouts: {} }, true);
      expect(host.getPlayerCommittedLoadout('constructor')).toBeNull();
      // A client cannot author the host-owned snapshot even through a raw batch.
      clientRoom.transport.links[0].send({ t: 'b', g: [['rlc', { roundRevision: 1, loadouts: { p1: commit(8) } }]] }, 'rel');
      expect(host.getPlayerCommittedLoadout('p1')).toBeNull();
    } finally { clearActiveSession(); clientRoom.room.destroy(); hostRoom.room.destroy(); }
  });
});
