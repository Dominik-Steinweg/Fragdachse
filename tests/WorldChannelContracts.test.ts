import { describe, expect, it, vi } from 'vitest';
import { TurretControlSystem } from '../src/systems/TurretControlSystem';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { FakeNetwork, addClientRoom, createHostRoom, dropConnection, type TestRoom } from './fakePeerNetwork';
import { AdrenalineEssenceClientReplica, AdrenalineEssenceReplication } from '../src/adrenalineEssence/AdrenalineEssenceReplication';
import type { EssenceState, EssenceTransferReceipt } from '../src/adrenalineEssence/AdrenalineEssenceTypes';
import { RockRegistry } from '../src/arena/RockRegistry';
import type { ArenaLayout } from '../src/types';

/**
 * Der eine kanonische World-Kanal.
 *
 * Mission, PvP und jede spaetere friedliche World beschreiben ihre Welt ueber denselben Kanal.
 * Die Activity liegt daneben und gilt nur zusammen mit ihrer World-Instanz.
 */

const WORLD_KEY = 'wld';
const ACTIVITY_KEY = 'act';

function bridgeFor(room: TestRoom): NetworkBridge {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
  const bridge = new NetworkBridge();
  bridge.activate();
  return bridge;
}

function world(overrides: Partial<WorldDescriptor> = {}): WorldDescriptor {
  return {
    worldRevision: 12,
    definitionId: 'world:coop-defense:7',
    seed: 4242,
    generatorVersion: 3,
    layoutFingerprint: 'deadbeef',
    ...overrides,
  };
}

function activity(overrides: Partial<ActivityDescriptor> = {}): ActivityDescriptor {
  return {
    activityRevision: 31,
    worldRevision: 12,
    kind: 'coop-mission',
    definitionId: 'activity:coop-mission:7',
    ...overrides,
  };
}

function snapshot(x: number, rocks: Parameters<NetworkBridge['publishGameState']>[0]['rocks'] = null): Parameters<NetworkBridge['publishGameState']>[0] {
  return {
    roundStartTime: 0,
    players: { p0: { x, y: 0, rot: 0, hp: 100, maxHp: 100, armor: 0, alive: true,
      adrenaline: 0, rage: 0, isBurrowed: false, isStunned: false, burrowPhase: 'idle',
      isRaging: false, burnStacks: 0, dashPhase: 0,
      aim: { revision: 0, isMoving: false, weapon1DynamicSpread: 0, weapon2DynamicSpread: 0 } } },
    rocks, projectiles: null, enemies: null, placeableRocks: [], reinforcementMatrices: [],
    energyInjectorEffects: [], energyInjectorFocus: [], remoteControlTurrets: [], decoys: [],
    smokes: [], fires: [], powerups: null, pedestals: null, nukes: [], airstrikes: [], meteors: [],
    tunnels: [], train: null, bases: [], captureTheBeer: null, coopDefenseCarry: [], stinkClouds: [],
    timeBubbles: [], teslaDomes: [], energyShields: [], guardianSpirits: [], repairDrones: [],
    slimeTrail: { cells: [], affectedEnemies: [] }, targetVulnerabilities: [], ak47StrategicTargets: [],
    burningGround: { cells: [] },
  };
}

async function createRoom(playerCount: number): Promise<TestRoom[]> {
  const network = new FakeNetwork();
  const rooms = [await createHostRoom(network)];
  for (let i = 1; i < playerCount; i += 1) rooms.push(await addClientRoom(network));
  return rooms;
}

describe('World-Kanal – Replikation', () => {
  it('can consume the fast full copy before its reliable copy and keeps ordinary delta loss recoverable', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), null);
      host.publishGameState(snapshot(10), true);
      hostRoom.room.update();
      const client = bridgeFor(clientRoom);
      expect(client.getLatestGameState()?.players.p0.x).toBe(10);
      client.flushNetwork();
      const link = hostRoom.transport.links[0];
      const send = link.send.bind(link);
      let delayed: Parameters<typeof link.send> | undefined;
      vi.spyOn(link, 'send').mockImplementation((message, channel) => {
        if (channel === 'rel' && message.t === 'b' && message.g?.some(([key]) => key === 'gsi')) {
          delayed = [message, channel];
        } else send(message, channel);
      });
      use(hostRoom);
      host.publishGameState(snapshot(20), true);
      hostRoom.room.update();
      // Host-side display reads must not discard the just-published basis.
      expect(host.getLatestGameState()?.players.p0.x).toBe(20);
      use(clientRoom);
      expect(client.getLatestGameState()?.players.p0.x).toBe(20);
      client.flushNetwork();
      use(hostRoom);
      link.fastReady = false;
      host.publishGameState(snapshot(30));
      hostRoom.room.update();
      link.fastReady = true;
      host.publishGameState(snapshot(40));
      hostRoom.room.update();
      use(clientRoom);
      const latest = client.getLatestGameState();
      expect(latest?.players.p0.x).toBe(40);
      expect(delayed).toBeDefined();
      send(...delayed!);
      expect(client.getLatestGameState()).toBe(latest);
    } finally { clearActiveSession(); clientRoom.room.destroy(); hostRoom.room.destroy(); }
  });

  it.each(['World', 'cache'] as const)('rebuilds the baseline after a %s reset and preserves pre-bootstrap Lobby publication', async (reset) => {
    const [hostRoom, clientRoom] = await createRoom(2);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), null);
      host.publishGameState(snapshot(10), true);
      hostRoom.room.update();
      const oldFull = hostRoom.room.getGlobal('gsi');
      const client = bridgeFor(clientRoom);
      expect(client.getLatestGameState()?.players.p0.x).toBe(10);
      use(hostRoom);
      if (reset === 'World') host.publishWorldAndActivity(world({ worldRevision: 13 }), null);
      else host.resetGameStateCache();
      host.publishGameState(snapshot(20));
      hostRoom.room.update();
      expect(hostRoom.room.getGlobal('gs')).toMatchObject({ _b: 0 });
      use(clientRoom);
      if (reset === 'cache') client.resetGameStateCache();
      expect(client.getLatestGameState()?.players.p0.x).toBe(reset === 'World' ? 20 : 10);
      client.flushNetwork();
      use(hostRoom);
      host.publishGameState(snapshot(30), true);
      hostRoom.room.update();
      use(clientRoom);
      expect(client.getLatestGameState()?.players.p0.x).toBe(30);
      client.flushNetwork();
      use(hostRoom);
      host.publishGameState(snapshot(40));
      hostRoom.room.update();
      use(clientRoom);
      const latest = client.getLatestGameState();
      expect(latest?.players.p0.x).toBe(40);
      clientRoom.transport.links[0].counterpart.send({ t: 'b', g: [['gsi', oldFull]] }, 'rel');
      expect(client.getLatestGameState()).toBe(latest);
    } finally { clearActiveSession(); clientRoom.room.destroy(); hostRoom.room.destroy(); }
  });

  it('requires explicit valid baseline metadata and keeps ARENA behind its complete bootstrap', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), null);
      host.setGamePhase('ARENA');
      host.setArenaStartTime(100);
      host.publishGameState({ ...snapshot(10), roundStartTime: 100 });
      hostRoom.room.update();
      const client = bridgeFor(clientRoom);
      expect(client.getLatestGameState()).toBeUndefined();
      const sender = clientRoom.transport.links[0].counterpart;
      const send = sender.send.bind(sender);
      let reliableFull: Parameters<typeof sender.send> | undefined;
      const intercept = vi.spyOn(sender, 'send').mockImplementation((message, channel) => {
        if (channel === 'rel' && message.t === 'b' && message.g?.some(([key]) => key === 'gsi')) {
          reliableFull = [message, channel];
        } else send(message, channel);
      });
      use(hostRoom);
      host.publishGameState({ ...snapshot(20), roundStartTime: 100 }, true);
      hostRoom.room.update();
      const full = hostRoom.room.getGlobal('gsi') as Record<string, unknown>;
      use(clientRoom);
      expect(clientRoom.room.getGlobal('gs')).toMatchObject({ _full: true });
      expect(client.getLatestGameState()).toBeUndefined();
      expect(reliableFull).toBeDefined();
      send(...reliableFull!);
      intercept.mockRestore();
      const accepted = client.getLatestGameState();
      expect(accepted?.players.p0.x).toBe(20);
      client.flushNetwork();
      for (const baseline of [undefined, null, '2', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 100]) {
        sender.send({ t: 'b', g: [['gs', { ...full, _s: 3, _b: baseline }]] }, 'rel');
        expect(client.getLatestGameState(), `invalid full basis ${String(baseline)}`).toBe(accepted);
        sender.send({ t: 'b', g: [['gs', { ...full, _full: false, _s: 3, _b: baseline }]] }, 'rel');
        expect(client.getLatestGameState(), `invalid delta basis ${String(baseline)}`).toBe(accepted);
      }
      use(hostRoom);
      host.publishGameState({ ...snapshot(30), roundStartTime: 100 });
      hostRoom.room.update();
      use(clientRoom);
      expect(client.getLatestGameState()?.players.p0.x).toBe(30);
    } finally { clearActiveSession(); clientRoom.room.destroy(); hostRoom.room.destroy(); }
  });

  it.each(['live', 'late join', 'resume'] as const)('waits for an overtaken full baseline on %s without rolling newer state back', async (connection) => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const firstRoom = await addClientRoom(network, [], 'ordered-full-token');
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    let receiverRoom = firstRoom;
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world({ definitionId: 'world:lobby' }), null);
      const rocks = new RockRegistry({ rocks: [{}] } as ArenaLayout);
      rocks.applyDamage(0, 10);
      host.publishGameState(snapshot(10, rocks.getNetSnapshot()), true);
      hostRoom.room.update();
      const originalFull = hostRoom.room.getGlobal('gsi');
      const first = bridgeFor(firstRoom);
      expect(first.getLatestGameState()?.players.p0.x).toBe(10);
      first.flushNetwork();
      use(hostRoom);
      firstRoom.transport.links[0].counterpart.fastReady = false;
      if (connection === 'resume') {
        firstRoom.transport.destroy();
        dropConnection(firstRoom);
      }
      rocks.applyDamage(0, 20);
      host.publishGameState(snapshot(20, rocks.getNetSnapshot()));
      hostRoom.room.update();
      host.publishGameState(snapshot(30, rocks.getNetSnapshot()));
      hostRoom.room.update();
      if (connection !== 'live') {
        receiverRoom = await addClientRoom(network, [], connection === 'resume' ? 'ordered-full-token' : undefined);
      }
      const receiver = connection === 'live' ? first : bridgeFor(receiverRoom);
      use(receiverRoom);
      receiver.getLatestGameState();
      const before = receiver.getLatestGameState();
      receiver.flushNetwork();
      const hostLink = receiverRoom.transport.links.at(-1)!.counterpart;
      const send = hostLink.send.bind(hostLink);
      const delayed: Parameters<typeof hostLink.send>[] = [];
      vi.spyOn(hostLink, 'send').mockImplementation((message, channel) => {
        if (channel === 'rel' && message.t === 'b' && message.g?.some(([key]) => key === 'gsi')) {
          delayed.push([message, channel]);
        } else send(message, channel);
      });
      use(hostRoom);
      rocks.requestFullNetSnapshot();
      hostLink.fastReady = false;
      host.publishGameState(snapshot(200, rocks.getNetSnapshot()), true);
      hostRoom.room.update();
      const refreshedFull = hostRoom.room.getGlobal('gsi');
      hostLink.fastReady = true;
      host.publishGameState(snapshot(300, rocks.getNetSnapshot()));
      hostRoom.room.update();
      use(receiverRoom);
      expect.soft(receiver.getLatestGameState()).toBe(before);
      expect(delayed).toHaveLength(1);
      for (const args of delayed) send(...args);
      const full = receiver.getLatestGameState();
      expect.soft(full?.players.p0.x).toBe(200);
      expect.soft(full?.rocks).toEqual([{ id: 0, hp: rocks.getHP(0) }]);
      expect(receiver.getLatestGameState()).toBe(full);
      receiver.flushNetwork();
      const newer = receiver.getLatestGameState();
      expect(newer?.players.p0.x).toBe(300);
      expect.soft(newer?.rocks).toEqual([{ id: 0, hp: rocks.getHP(0) }]);
      const version = receiver.getGameStateVersion();
      send({ t: 'b', g: [['gsi', originalFull], ['gs', refreshedFull]] }, 'rel');
      expect(receiver.getLatestGameState()).toBe(newer);
      expect(receiver.getGameStateVersion()).toBe(version);
    } finally {
      clearActiveSession();
      receiverRoom.room.destroy();
      firstRoom.room.destroy();
      hostRoom.room.destroy();
    }
  });

  it.each(['reload', 'reconnect'] as const)('refreshes the reliable full snapshot after %s resumes the same player', async (kind) => {
    vi.useFakeTimers();
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const firstRoom = await addClientRoom(network, [], 'resume-full-token');
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    let resumedRoom: TestRoom | undefined;
    const emptyWorldState: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [],
      remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
      nukes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
      coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [],
      guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
      targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
    };
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world({ definitionId: 'world:lobby' }), null);
      const rocks = new RockRegistry({ rocks: [{}] } as ArenaLayout);
      rocks.applyDamage(0, 10);
      const previousHp = rocks.getHP(0);
      host.publishGameState({ ...emptyWorldState, rocks: rocks.getNetSnapshot() }, true);
      hostRoom.room.update();
      host.consumeFullGameStateRequest();
      const first = bridgeFor(firstRoom);
      expect(first.getLatestGameState()?.rocks).toEqual([{ id: 0, hp: previousHp }]);

      use(hostRoom);
      if (kind === 'reload') firstRoom.transport.destroy();
      else firstRoom.transport.reconnectEnabled = false;
      dropConnection(firstRoom);
      await vi.advanceTimersByTimeAsync(0);
      rocks.applyDamage(0, 20);
      host.publishGameState({ ...emptyWorldState, rocks: rocks.getNetSnapshot() });
      hostRoom.room.update();
      const unchangedRocks = rocks.getNetSnapshot();
      expect(unchangedRocks).toBeNull();
      host.publishGameState({ ...emptyWorldState, rocks: unchangedRocks });
      hostRoom.room.update();

      if (kind === 'reload') resumedRoom = await addClientRoom(network, [], 'resume-full-token');
      else {
        firstRoom.transport.reconnectEnabled = true;
        await vi.advanceTimersByTimeAsync(500);
        resumedRoom = firstRoom;
      }
      expect(resumedRoom.room.getLocalPlayerId()).toBe('p1');
      const fullRequested = host.consumeFullGameStateRequest();
      expect(fullRequested).toBe(true);
      expect(host.consumeFullGameStateRequest()).toBe(false);
      // The actual host net-tick consumes the request before collecting each slice.
      if (fullRequested) rocks.requestFullNetSnapshot();
      resumedRoom.transport.links.at(-1)!.counterpart.fastReady = false;
      host.publishGameState({ ...emptyWorldState, rocks: rocks.getNetSnapshot() }, fullRequested);
      hostRoom.room.update();
      use(resumedRoom);
      const resumed = kind === 'reload' ? bridgeFor(resumedRoom) : first;
      resumed.getLatestGameState();
      expect(resumed.getLatestGameState()?.rocks).toEqual([{ id: 0, hp: rocks.getHP(0) }]);
    } finally {
      clearActiveSession();
      resumedRoom?.room.destroy();
      firstRoom.room.destroy();
      hostRoom.room.destroy();
      vi.useRealTimers();
    }
  });

  it('reliably stops local input before the next frame and fences delayed fast movement without blocking fresh input', async () => {
    const [hostRoom, clientRoom, observerRoom] = await createRoom(3);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    try {
      const host = bridgeFor(hostRoom); host.publishWorldAndActivity(world(), null);
      const client = bridgeFor(clientRoom);
      vi.spyOn(client, 'getLocalWorldParticipation').mockReturnValue('interactive');
      client.sendLocalInput({ dx: 1, dy: 0, aim: 128, dashHeld: true }); clientRoom.room.update();
      client.sendLocalInput({ dx: 0, dy: 1, aim: 128, dashHeld: true });
      const link = clientRoom.transport.links[0];
      link.fastReady = false; clientRoom.room.update(); link.fastReady = true;
      const delayed = link.sent[link.sent.length - 1];
      client.cancelLocalInput();
      const stoppedSequence = client.getLocalMovementInput()!.movementSequence!;
      expect(client.getLocalMovementInput()).toMatchObject({ dx: 0, dy: 0, dashHeld: false });
      use(hostRoom);
      expect(host.getPlayerInput('p1')).toMatchObject({ dx: 0, dy: 0, aim: 128, dashHeld: false });
      link.send(delayed.message, delayed.channel);
      expect(host.getPlayerInput('p1')).toMatchObject({ dx: 0, dy: 0, movementSequence: stoppedSequence });
      expect(observerRoom.room.getPlayerState('p1', 'ist')).toBeUndefined();

      use(clientRoom); clientRoom.room.update();
      client.sendLocalInput({ dx: 0, dy: 0, aim: 64, dashHeld: true }); clientRoom.room.update();
      use(hostRoom);
      expect(host.getPlayerInput('p1')).toMatchObject({ dx: 0, dy: 0, dashHeld: true });
      expect(host.getPlayerInput('p1')!.movementSequence).toBeGreaterThan(stoppedSequence);

      use(clientRoom);
      client.sendLocalInput({ dx: -1, dy: 0, aim: 64 }); clientRoom.room.update();
      use(hostRoom);
      expect(host.getPlayerInput('p1')).toMatchObject({ dx: -1, dy: 0 });
      expect(host.getPlayerInput('p1')!.movementSequence).toBeGreaterThan(stoppedSequence);
    } finally { clearActiveSession(); clientRoom.room.destroy(); observerRoom.room.destroy(); hostRoom.room.destroy(); }
  });

  it('ignores stale-world and malformed stop fences and rejects another player as their target', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    try {
      const host = bridgeFor(hostRoom); host.publishWorldAndActivity(world(), null);
      host.sendLocalInput({ dx: 1, dy: 0, aim: 0 });
      const client = bridgeFor(clientRoom);
      vi.spyOn(client, 'getLocalWorldParticipation').mockReturnValue('interactive');
      client.sendLocalInput({ dx: 1, dy: 0, aim: 0 }); clientRoom.room.update();
      for (const stop of [null, [], {}, { worldRevision: 12 },
        ...[0, -1, 1.5, '100', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(movementSequence => ({ worldRevision: 12, movementSequence })),
        ...[11, 13, '12', null, NaN].map(worldRevision => ({ worldRevision, movementSequence: 100 }))]) {
        clientRoom.room.setPlayerState('p1', 'ist', stop, true);
        use(hostRoom);
        expect(host.getPlayerInput('p1')?.dx, JSON.stringify(stop)).toBe(1);
      }
      clientRoom.transport.links[0].send({ t: 'b', p: [['p0', 'ist', { worldRevision: 12, movementSequence: 100 }]] }, 'rel');
      expect(hostRoom.room.getPlayerState('p0', 'ist')).toBeUndefined();

      use(clientRoom); client.cancelLocalInput();
      use(hostRoom); host.publishWorldAndActivity(world({ worldRevision: 13 }), null);
      use(clientRoom); client.sendLocalInput({ dx: -1, dy: 0, aim: 0 }); clientRoom.room.update();
      use(hostRoom); expect(host.getPlayerInput('p1')?.dx).toBe(-1);
    } finally { clearActiveSession(); clientRoom.room.destroy(); hostRoom.room.destroy(); }
  });

  it('does not let an older reliable stop cancel a later movement or prediction restart', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    try {
      const host = bridgeFor(hostRoom); host.publishWorldAndActivity(world(), null);
      const client = bridgeFor(clientRoom);
      vi.spyOn(client, 'getLocalWorldParticipation').mockReturnValue('interactive');
      client.sendLocalInput({ dx: 1, dy: 0, aim: 0 }); clientRoom.room.update();
      client.cancelLocalInput();
      const stop = clientRoom.room.getPlayerState('p1', 'ist');
      client.restartLocalMovementInput(100);
      client.sendLocalInput({ dx: 0, dy: -1, aim: 0 }); clientRoom.room.update();
      clientRoom.room.setPlayerState('p1', 'ist', stop, true);
      use(hostRoom);
      expect(host.getPlayerInput('p1')).toMatchObject({ dx: 0, dy: -1 });
      expect(host.getPlayerInput('p1')!.movementSequence).toBeGreaterThan(100);
    } finally { clearActiveSession(); clientRoom.room.destroy(); hostRoom.room.destroy(); }
  });

  it('clears the old stop fence when a reloaded client resumes the same player with a new sequence', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const firstRoom = await addClientRoom(network, [], 'input-stop-reload-token');
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    let reloadedRoom: TestRoom | undefined;
    try {
      const host = bridgeFor(hostRoom); host.publishWorldAndActivity(world(), null);
      const first = bridgeFor(firstRoom);
      vi.spyOn(first, 'getLocalWorldParticipation').mockReturnValue('interactive');
      first.restartLocalMovementInput(100);
      first.sendLocalInput({ dx: 1, dy: 0, aim: 0 }); firstRoom.room.update(); first.cancelLocalInput();
      use(hostRoom); expect(host.getPlayerInput('p1')?.dx).toBe(0);
      firstRoom.transport.destroy(); dropConnection(firstRoom);
      reloadedRoom = await addClientRoom(network, [], 'input-stop-reload-token');
      expect(reloadedRoom.room.getLocalPlayerId()).toBe('p1');
      expect(reloadedRoom.room.getPlayerState('p1', 'ist')).toBeUndefined();
      const reloaded = bridgeFor(reloadedRoom);
      vi.spyOn(reloaded, 'getLocalWorldParticipation').mockReturnValue('interactive');
      reloaded.sendLocalInput({ dx: -1, dy: 0, aim: 0 }); reloadedRoom.room.update();
      use(hostRoom);
      expect(host.getPlayerInput('p1')).toMatchObject({ dx: -1, movementSequence: 1 });
    } finally { clearActiveSession(); reloadedRoom?.room.destroy(); firstRoom.room.destroy(); hostRoom.room.destroy(); }
  });

  it('rejects malformed aim bytes before remote input reaches player rotation or shield targeting', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), null);
      const playerId = clientRoom.room.getLocalPlayerId();
      const sendInput = (aim: unknown) => {
        clientRoom.room.getPlayerHandle(playerId)!.setState('inp', { dx: 1, dy: 0, aim, worldRevision: 12 });
        clientRoom.room.update();
      };
      for (const aim of [0, 1, 128, 255]) {
        sendInput(aim);
        expect(host.getPlayerInput(playerId)?.aim).toBe(aim);
      }
      for (const aim of [undefined, null, 'invalid', '128', {}, [], -1, 256, 1.5, NaN, Infinity]) {
        sendInput(aim);
        expect(host.getPlayerInput(playerId), `invalid aim: ${JSON.stringify(aim)}`).toBeUndefined();
      }
    } finally { clearActiveSession(); }
  });

  it('sequences the policy-filtered movement state independently of aim and keepalive', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const host = bridgeFor(hostRoom); host.publishWorldAndActivity(world(), null);
      const client = bridgeFor(clientRoom);
      vi.spyOn(client, 'getLocalWorldParticipation').mockReturnValue('interactive');
      client.sendLocalInput({ dx: 1, dy: 0, aim: 0 });
      const sequence = client.getLocalMovementInput()!.movementSequence!;
      client.sendLocalInput({ dx: 1, dy: 0, aim: 1 });
      expect(client.getLocalMovementInput()).toMatchObject({ movementSequence: sequence, aim: 1 });
      now += 101; client.sendLocalInput({ dx: 1, dy: 0, aim: 1 });
      expect(client.getLocalMovementInput()!.movementSequence).toBe(sequence);
      client.sendLocalInput({ dx: 0, dy: -1, aim: 1 });
      expect(client.getLocalMovementInput()!.movementSequence).toBe(sequence + 1);
      client.restartLocalMovementInput(1000);
      expect(client.getLocalMovementInput()).toMatchObject({ movementSequence: 1001, dx: 0, dy: -1 });
      vi.mocked(client.getLocalWorldParticipation).mockReturnValue('observer');
      client.sendLocalInput({ dx: 1, dy: 1, aim: 2, dashHeld: true });
      expect(client.getLocalMovementInput()).toMatchObject({ dx: 0, dy: 0, dashHeld: false, movementSequence: 1002 });
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
      host.publishWorldAndActivity(world({ worldRevision: 13 }), null);
      setActiveSession({ room: clientRoom.room, transport: clientRoom.transport, roomCode: 'ABC123' });
      expect(client.getLocalMovementInput()).toBeNull();
      client.sendLocalInput({ dx: 0, dy: 0, aim: 2 });
      expect(client.getLocalMovementInput()).toMatchObject({ movementSequence: 1003, worldRevision: 13 });
    } finally { clock.mockRestore(); clearActiveSession(); }
  });

  it('validates reliable turret requests and repeatedly snapshots typed occupancy for clients and late join', async () => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    try {
      const host = bridgeFor(hostRoom); host.publishLobbySync(); host.publishWorldAndActivity(world(), activity());
      const client = bridgeFor(clientRoom); use(hostRoom);
      const owner = new TurretControlSystem({ getTurrets: () => [{ id: 'base:tesla', x: 50, y: 0, ownerId: 'friendly', ownerColor: 1 }],
        getActor: () => ({ x: 0, y: 0, angle: 0 }), canEnter: () => true, canOccupy: () => true,
        isFriendly: () => true, getInput: () => null, enter: () => {}, pin: () => {}, exit: () => {} });
      host.registerTurretControlHandler((id, request) => owner.request(id, request));
      clientRoom.room.sendHost('turret-control', { action: 'enter', turretId: 'base:tesla', wr: 11 });
      const pilot = clientRoom.room.getLocalPlayerId();
      expect(owner.getState(pilot)).toBeUndefined();
      clientRoom.room.sendHost('turret-control', { action: 'enter', turretId: {}, wr: 12 });
      expect(owner.getState(pilot)).toBeUndefined();
      clientRoom.room.sendHost('turret-control', { action: 'enter', turretId: 'base:tesla', wr: 12, playerId: 'forged' });
      const occupied = owner.getState(pilot)!;
      expect(occupied?.turretId).toBe('base:tesla'); expect(owner.getState('forged')).toBeUndefined();
      const state: Parameters<NetworkBridge['publishGameState']>[0] = {
        roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
        placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [],
        remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
        nukes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
        coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [],
        guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
        targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
      };
      const publish = (full = false) => {
        use(hostRoom);
        host.publishGameState({ ...state, players: { [pilot]: { x: 50, y: 0, positionRevision: 3,
          aim: { revision: 0, isMoving: false, weapon1DynamicSpread: 0, weapon2DynamicSpread: 0 },
          burrowPhase: 'idle', turretControl: owner.getState(pilot) } as never } }, full);
        hostRoom.room.update();
      };
      publish(true); use(clientRoom);
      expect(client.getLatestGameState()!.players[pilot].turretControl).toEqual(occupied);
      client.flushNetwork();
      const joining = bridgeFor(await addClientRoom(network));
      expect(joining.getLatestGameState()!.players[pilot].turretControl).toEqual(occupied);
      publish(); use(clientRoom);
      expect(client.getLatestGameState()!.players[pilot].positionRevision).toBe(3);
      use(hostRoom);
      clientRoom.room.sendHost('turret-control', { action: 'exit', ...occupied, revision: occupied.revision + 1, wr: 12 });
      expect(owner.getState(pilot)).toEqual(occupied);
      clientRoom.room.sendHost('turret-control', { action: 'exit', ...occupied, wr: 12 });
      publish(); use(clientRoom);
      expect(client.getLatestGameState()!.players[pilot].turretControl).toBeUndefined();
      use(hostRoom); host.registerTurretControlHandler(null);
      clientRoom.room.sendHost('turret-control', { action: 'enter', turretId: 'base:tesla', wr: 12 });
      expect(owner.getState(pilot)).toBeUndefined();
      expect(clientRoom.transport.links.flatMap(link => link.sent).filter(item =>
        JSON.stringify(item.message).includes('turret-control')).every(item => item.channel === 'rel')).toBe(true);
    } finally { clearActiveSession(); }
  });
  it('repliziert World und Activity getrennt an jeden Peer, auch an Nachzuegler', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      expect(host.getWorldDescriptor()).toBeNull();

      host.publishWorldAndActivity(world({ parameters: { persistentBaseAreaStage: 0 } }), activity());

      const client = bridgeFor(clientRoom);
      expect(client.getWorldDescriptor()).toEqual(world({ parameters: { persistentBaseAreaStage: 0 } }));
      expect(client.getActivityDescriptor()).toEqual(activity());
      // Genau ein World-Kanal: der frueher parallel gefuehrte Arena-Descriptor existiert nicht mehr.
      expect(clientRoom.room.getGlobal('ard')).toBeUndefined();
      expect(clientRoom.room.getGlobal(WORLD_KEY)).toBeDefined();
      expect(clientRoom.room.getGlobal(ACTIVITY_KEY)).toBeDefined();
    } finally {
      clearActiveSession();
    }
  });

  it('gibt eine World ohne Activity als regulaeren Zustand wieder', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), null);

      const client = bridgeFor(clientRoom);
      expect(client.getWorldDescriptor()).toEqual(world());
      expect(client.getActivityDescriptor()).toBeNull();
    } finally {
      clearActiveSession();
    }
  });

  it('veraendert eine nachtraegliche Lobby-Auswahl die bestehende World und Activity nicht', async () => {
    const [hostRoom] = await createRoom(1);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), activity());
      const expectedWorld = host.getWorldDescriptor();
      const expectedActivity = host.getActivityDescriptor();

      host.setCoopDefenseMapId('17');
      host.setGameMode('deathmatch');

      expect(host.getCoopDefenseMapId()).toBe('17');
      expect(host.getGameMode()).toBe('deathmatch');
      expect(host.getWorldDescriptor()).toEqual(expectedWorld);
      expect(host.getActivityDescriptor()).toEqual(expectedActivity);
    } finally {
      clearActiveSession();
    }
  });

  it('beendet die World-Instanz vollstaendig', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), activity());
      host.clearWorldAndActivity();

      const client = bridgeFor(clientRoom);
      expect(client.getWorldDescriptor()).toBeNull();
      expect(client.getActivityDescriptor()).toBeNull();
    } finally {
      clearActiveSession();
    }
  });
});

describe('World-Kanal – Host-Autoritaet und Verwerfungsregel', () => {
  it.each(['replace', 'clear'] as const)('discards queued combat feedback when the world is ended by %s', async (transition) => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), null);
      const client = bridgeFor(clientRoom);
      const effects = vi.fn();
      const popups = vi.fn();
      client.registerEffectHandler(effects);
      client.registerCoopDefenseXpPopupHandler(popups);
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
      const enqueue = () => {
        host.broadcastEffect({ type: 'death', x: 10, y: 20, targetId: 'old-enemy', rotation: 0, seed: 1 });
        host.broadcastCoopDefenseXpPopup(10, 20, 1);
      };
      enqueue();
      host.publishWorldAndActivity(world(), null);
      host.flushEffects();
      expect(effects).toHaveBeenCalledOnce();
      expect(popups).toHaveBeenCalledOnce();
      effects.mockClear();
      popups.mockClear();

      enqueue();
      if (transition === 'replace') host.publishWorldAndActivity(world({ worldRevision: 13 }), null);
      else host.clearWorldAndActivity();
      host.flushEffects();
      expect(effects).not.toHaveBeenCalled();
      expect(popups).not.toHaveBeenCalled();

      if (transition === 'clear') host.publishWorldAndActivity(world({ worldRevision: 13 }), null);
      enqueue();
      host.flushEffects();
      expect(effects).toHaveBeenCalledOnce();
      expect(popups).toHaveBeenCalledOnce();
    } finally { clearActiveSession(); }
  });

  it('accepts authoritative events only from the host, including relayed client broadcasts', async () => {
    const [hostRoom, attackerRoom, observerRoom] = await createRoom(3);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), null);
      const attacker = bridgeFor(attackerRoom);
      const observer = bridgeFor(observerRoom);
      const received = [vi.fn(), vi.fn(), vi.fn()];
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
      host.registerTrainDestroyedHandler(received[0]);
      setActiveSession({ room: attackerRoom.room, transport: attackerRoom.transport, roomCode: 'ABC123' });
      attacker.registerTrainDestroyedHandler(received[1]);
      setActiveSession({ room: observerRoom.room, transport: observerRoom.transport, roomCode: 'ABC123' });
      observer.registerTrainDestroyedHandler(received[2]);

      attackerRoom.room.broadcast('trdes', {});
      attackerRoom.transport.links[0].send({ t: 'rpc', c: 0, n: 'trdes', d: {}, s: hostRoom.room.getLocalPlayerId() }, 'rel');
      await Promise.resolve();
      for (const handler of received) expect(handler).not.toHaveBeenCalled();

      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
      host.broadcastTrainDestroyed();
      await Promise.resolve();
      for (const handler of received) expect(handler).toHaveBeenCalledOnce();
    } finally { clearActiveSession(); }
  });

  it('delivers typed shot events once per broadcast and rejects stale or malformed world feedback', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), null);
      const client = bridgeFor(clientRoom);
      const received: unknown[] = [];
      client.registerShotFxHandler(event => received.push(event));
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
      const shot = { shooterId: 'shooter', weaponId: 'GLOCK', slot: 'weapon1' as const, angle: 0, sequence: 1, predictionId: 7 };
      host.broadcastShotFx(shot);
      await Promise.resolve();
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject(shot);
      hostRoom.room.broadcast('sfx', { ...shot, wr: 11, sequence: 2 });
      hostRoom.room.broadcast('sfx', { ...shot, wr: 12, angle: 'invalid' });
      await Promise.resolve();
      expect(received).toHaveLength(1);
    } finally { clearActiveSession(); }
  });

  it('laesst keine Activity zu, die zu einer anderen World-Instanz gehoert', async () => {
    const [hostRoom] = await createRoom(1);
    try {
      const host = bridgeFor(hostRoom);
      expect(() => host.publishWorldAndActivity(world(), activity({ worldRevision: 13 })))
        .toThrow(/world revision/);
      expect(host.getWorldDescriptor()).toBeNull();
    } finally {
      clearActiveSession();
    }
  });

  it('verwirft eine Activity der Vorinstanz, die noch auf dem Draht liegt', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world({ worldRevision: 13 }), activity({ worldRevision: 13 }));
      // Verspaetetes reliable Paket der World 12 – direkt auf dem Draht.
      hostRoom.room.setGlobal(ACTIVITY_KEY, activity({ worldRevision: 12 }), true);

      const client = bridgeFor(clientRoom);
      expect(client.getWorldDescriptor()?.worldRevision).toBe(13);
      expect(client.getActivityDescriptor()).toBeNull();
    } finally {
      clearActiveSession();
    }
  });

  it('verwirft unbrauchbare World-Nutzlast an der Netzwerkgrenze', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      hostRoom.room.setGlobal(WORLD_KEY, { worldRevision: 0, definitionId: '' }, true);
      const client = bridgeFor(clientRoom);
      expect(client.getWorldDescriptor()).toBeNull();
      // Ohne gueltige World gibt es auch keine Activity, egal was daneben liegt.
      expect(client.getActivityDescriptor()).toBeNull();
    } finally {
      clearActiveSession();
    }
  });

  it('laesst einen Client die World weder erzeugen noch zerstoeren', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), activity());

      const client = bridgeFor(clientRoom);
      client.publishWorldAndActivity(world({ worldRevision: 99 }), activity({ worldRevision: 99 }));
      client.clearWorldAndActivity();
      expect(client.getWorldDescriptor()?.worldRevision).toBe(12);

      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
      expect(host.getWorldDescriptor()?.worldRevision).toBe(12);
    } finally {
      clearActiveSession();
    }
  });
});

describe('World-Kanal – Essenz im Lobby-Testgelaende', () => {
  it('traegt null-Activity, Deltas und Latejoin durch die echte Bridge und verwirft die vorherige World', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    const useRoom = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    const scope = { worldRevision: 12, activityRevision: null } as const;
    const publisher = new AdrenalineEssenceReplication();
    const replica = new AdrenalineEssenceClientReplica(scope);
    const state = (revision: number, value: number): EssenceState => ({
      ...scope, revision, transfers: [], clusters: value === 0 ? [] : [{
        id: '12:null:cluster:1', accessGroup: { kind: 'personal', playerId: 'p1' }, state: 'grounded',
        x: 100, y: 120, originX: 100, originY: 120, seed: 42, value,
        createdAt: 0, landAt: 200, expiresAt: 8200,
      }],
    });
    const emptyWorldState: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [],
      remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
      nukes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
      coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [],
      guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
      targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
    };
    try {
      const host = bridgeFor(hostRoom);
      host.publishLobbySync();
      host.publishWorldAndActivity(world({ definitionId: 'world:lobby' }), null);
      const client = bridgeFor(clientRoom);
      const publish = (next: EssenceState, now: number, full = false) => {
        useRoom(clientRoom);
        client.flushNetwork();
        useRoom(hostRoom);
        host.publishGameState({ ...emptyWorldState, adrenalineEssence: publisher.build(next, now, full) }, full);
        hostRoom.room.update();
        useRoom(clientRoom);
        return client.getLatestGameState()!.adrenalineEssence;
      };

      expect(replica.apply(publish(state(1, 0.125), 0, true))).toBe(true);
      expect(client.getActivityDescriptor()).toBeNull();
      expect(client.getGamePhase()).toBe('LOBBY');
      expect(replica.getState()).toMatchObject({ ...scope, clusters: [{ value: 0.125 }] });

      publish(state(2, 0), 50); // The passive replica misses this removal.
      expect(replica.apply(publish(state(3, 0.375), 100))).toBe(false);
      expect(replica.isAwaitingFull()).toBe(true);
      const receipt: EssenceTransferReceipt = {
        ...scope, id: '12:null:transfer:2', accessGroup: { kind: 'personal', playerId: 'p1' },
        playerId: 'p1', lifeRevision: 1, participationRevision: 1, status: 'committed',
        creditedValue: 0.25, returnedValue: 0, expiredValue: 0, resourceRevision: 3,
        completedAt: 900, sourceX: 100, sourceY: 120, targetX: 130, targetY: 140,
      };
      publisher.addReceipts([receipt]);
      const recoveredFull = publish(state(4, 0.125), 1000, true);
      expect(replica.apply(recoveredFull)).toBe(true);
      expect(replica.getState().clusters[0].value).toBe(0.125);
      expect(replica.drainReceipts()).toEqual([]);

      // A real joining PeerRoom gets the reliable game-state baseline without an Activity.
      const joiningRoom = await addClientRoom(network);
      const joining = bridgeFor(joiningRoom);
      const joinedReplica = new AdrenalineEssenceClientReplica(scope);
      expect(joinedReplica.apply(joining.getLatestGameState()!.adrenalineEssence)).toBe(true);
      expect(joinedReplica.getState()).toEqual(replica.getState());
      joining.flushNetwork();
      const repeatedReceipt = publish(state(4, 0.125), 1050);
      expect(replica.apply(repeatedReceipt)).toBe(true);
      expect(replica.drainReceipts()).toEqual([receipt]);
      useRoom(joiningRoom);
      expect(joinedReplica.apply(joining.getLatestGameState()!.adrenalineEssence)).toBe(true);
      expect(joinedReplica.drainReceipts()).toEqual([]);

      // Omitted slices preserve the current packet; explicit null clears the Bridge cache.
      useRoom(hostRoom);
      host.publishGameState(emptyWorldState);
      hostRoom.room.update();
      useRoom(clientRoom);
      expect(client.getLatestGameState()!.adrenalineEssence).toEqual(repeatedReceipt);
      useRoom(hostRoom);
      host.publishGameState({ ...emptyWorldState, adrenalineEssence: null });
      hostRoom.room.update();
      useRoom(clientRoom);
      expect(client.getLatestGameState()!.adrenalineEssence).toBeNull();

      expect(new AdrenalineEssenceClientReplica({ ...scope, activityRevision: 31 }).apply(recoveredFull)).toBe(false);
      useRoom(hostRoom);
      host.publishWorldAndActivity(world({ worldRevision: 13, definitionId: 'world:lobby' }), null);
      useRoom(clientRoom);
      expect(client.getLatestGameState()).toBeUndefined();
      expect(new AdrenalineEssenceClientReplica({ ...scope, worldRevision: 13 }).apply(recoveredFull)).toBe(false);
    } finally {
      clearActiveSession();
    }
  });
});
