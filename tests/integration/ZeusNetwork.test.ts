import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';
import { zeusFixture, zeusRef } from '../ZeusTestHelper';

describe('Zeus World replication', () => {
  it('retains omitted slices, heals removal, deduplicates states and bootstraps a new peer', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ZEUS' });
    const bridge = (room: TestRoom) => { use(room); const result = new NetworkBridge(); result.activate(); return result; };
    const host = bridge(hostRoom);
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'zeus' };
    host.publishLobbySync(); host.publishWorldAndActivity(world, null);
    const client = bridge(clientRoom);
    const { runtime, use: activation, movement } = zeusFixture({ groundEnabled: 1 });
    runtime.startBall(activation, movement, 0);
    runtime.move({ ...movement, x: 100 }, 20);
    const snapshot = () => runtime.snapshot([{ target: zeusRef(), expiresAt: 600 }]);
    const base: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [],
      remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
      nukes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
      coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [],
      guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
      targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
    };
    const publish = (now: number, full = false) => {
      use(hostRoom); host.publishGameState({ ...base, zeus: snapshot() }, full);
      hostRoom.room.update(); use(clientRoom);
    };
    try {
      publish(100, true);
      expect(client.getLatestGameState()!.zeus).toEqual(snapshot());
      const same = client.getLatestGameState();
      expect(client.getLatestGameState()).toBe(same);
      // A sparse delta must retain the previous Zeus slice.
      use(hostRoom);
      const raw = { ...(hostRoom.room.getGlobal('gs') as Record<string, unknown>) };
      delete raw.zs; delete raw._full; raw._s = (raw._s as number) + 1;
      hostRoom.room.setGlobal('gs', raw, false); hostRoom.room.update();
      use(clientRoom);
      expect(client.getLatestGameState()!.zeus).toEqual(snapshot());
      publish(250, true);
      const lateRoom = await addClientRoom(network), late = bridge(lateRoom);
      expect(late.getLatestGameState()!.zeus).toEqual(snapshot());
      // Skip an intermediate state, then explicitly transmit the end twice.
      runtime.destroy();
      use(hostRoom); host.publishGameState({ ...base, zeus: { balls: [], ground: [], stuns: [] } });
      hostRoom.room.update();
      host.publishGameState({ ...base, zeus: { balls: [], ground: [], stuns: [] } });
      hostRoom.room.update(); use(clientRoom);
      expect(client.getLatestGameState()!.zeus).toEqual({ balls: [], ground: [], stuns: [] });
      use(hostRoom); host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null);
      use(clientRoom); expect(client.getLatestGameState()).toBeUndefined();
    } finally { clearActiveSession(); runtime.destroy(); }
  });
});
