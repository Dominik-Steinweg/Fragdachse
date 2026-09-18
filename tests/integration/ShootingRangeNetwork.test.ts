import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { ShootingRangeRuntime } from '../../src/shootingRange/ShootingRangeRuntime';
import { SHOOTING_RANGE } from '../../src/shootingRange/ShootingRangeLayout';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';

describe('shooting range World requests and replication', () => {
  it('orders remote intentions, bootstraps history, recovers lost state and rejects previous Worlds', async () => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network), secondRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'RANGE' });
    const connect = (room: TestRoom) => { use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge; };
    const host = connect(hostRoom);
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'range' };
    host.publishLobbySync(); host.publishWorldAndActivity(world, null);
    host.hostPublishWorldParticipation({ p1: 'interactive', p2: 'interactive' });
    const client = connect(clientRoom);
    let id = 0;
    const runtime = new ShootingRangeRuntime({ spawn: () => ({ id: `target-${++id}`, generation: id }), remove() {}, alive: () => true });
    const received: string[] = [];
    use(hostRoom);
    host.registerShootingRangeHandler((player, request) => { received.push(player); return runtime.request(request, 0); });
    const base: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [], remoteControlTurrets: [], decoys: [],
      smokes: [], fires: [], powerups: null, pedestals: null, nukes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
      coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [], guardianSpirits: [], repairDrones: [],
      slimeTrail: { cells: [], affectedEnemies: [] }, targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
    };
    const publish = (now: number, full = false) => {
      runtime.finishHostStep(now); use(hostRoom);
      host.publishGameState({ ...base, shootingRange: runtime.snapshot() }, full); hostRoom.room.update();
    };
    try {
      expect(await clientRoom.room.callHost('shooting-range', { wr: 1, session: 0, control: 'power', action: 'enable' }, 500)).toBe(true);
      const responses = await Promise.all([
        clientRoom.room.callHost('shooting-range', { wr: 1, session: 1, control: 'plus', action: 'add' }, 500),
        secondRoom.room.callHost('shooting-range', { wr: 1, session: 1, control: 'minus', action: 'remove' }, 500),
      ]);
      expect(responses).toEqual([true, true]); expect(received).toEqual(['p1', 'p1', 'p2']);
      expect(runtime.snapshot().count).toBe(1);
      runtime.recordDamage(runtime.snapshot().targets[0]!, 80, 0);
      publish(0, true); use(clientRoom);
      expect(client.getLatestGameState()?.shootingRange).toEqual(runtime.snapshot());
      const link = hostRoom.transport.links[0], send = link.send;
      link.send = () => {}; publish(250); link.send = send;
      publish(500); use(clientRoom);
      expect(client.getLatestGameState()?.shootingRange).toEqual(runtime.snapshot());
      use(hostRoom);
      const lateRoom = await addClientRoom(network), late = connect(lateRoom);
      use(hostRoom);
      expect(host.consumeFullGameStateRequest()).toBe(true);
      publish(500, true); // The next host frame fulfills the existing late-join full-state request.
      use(lateRoom);
      expect(late.getLatestGameState()?.shootingRange).toEqual(runtime.snapshot());
      expect(late.getLatestGameState()?.shootingRange?.samples).toHaveLength(500 / SHOOTING_RANGE.sampleIntervalMs + 1);
      use(hostRoom); host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null);
      expect(await clientRoom.room.callHost('shooting-range', { wr: 1, session: 1, control: 'power', action: 'disable' }, 500)).toBe(false);
      expect(received).toHaveLength(3);
      host.registerShootingRangeHandler(null);
      expect(await clientRoom.room.callHost('shooting-range', { wr: 2, session: 1, control: 'power', action: 'disable' }, 500)).toBe(false);
      use(clientRoom); expect(client.getLatestGameState()).toBeUndefined();
    } finally { runtime.destroy(); clearActiveSession(); }
  });
});
