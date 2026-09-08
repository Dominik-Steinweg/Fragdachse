import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';
import { smokeHarness, smokeEffect, smokeSource, smokeTarget } from '../SmokeTestHelper';

describe('smoke World replication', () => {
  it('heals missed growth and removal, supports late join and invalidates the previous World', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'SMOKE' });
    const bridge = (room: TestRoom) => { use(room); const result = new NetworkBridge(); result.activate(); return result; };
    const host = bridge(hostRoom);
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'smoke' };
    host.publishLobbySync(); host.publishWorldAndActivity(world, null);
    const client = bridge(clientRoom);
    const { runtime, charge } = smokeHarness();
    const config = smokeEffect(); const cloud = runtime.createCloud(0, 0, config, smokeSource(), 0);
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
      use(hostRoom); host.publishGameState({ ...base, smokes: runtime.getSnapshots(now), smokeTargets: runtime.getTargetSnapshots(now) }, full);
      hostRoom.room.update(); use(clientRoom);
    };
    try {
      runtime.updateExposure([smokeTarget()], 100); charge(smokeTarget(), cloud, 100);
      publish(100, true);
      expect(client.getLatestGameState()).toMatchObject({ smokes: runtime.getSnapshots(100), smokeTargets: runtime.getTargetSnapshots(100) });
      charge(smokeTarget(), cloud, 150, 'kill', true); publish(150); // Client deliberately misses this state.
      publish(200);
      expect(client.getLatestGameState()!.smokes).toEqual(runtime.getSnapshots(200));
      expect(client.getLatestGameState()!.smokeTargets).toEqual([]);
      publish(250, true);
      const lateRoom = await addClientRoom(network), late = bridge(lateRoom);
      expect(late.getLatestGameState()!.smokes).toEqual(runtime.getSnapshots(250));
      runtime.clear(); publish(300); publish(350); // Repeated empty state repairs a missed removal.
      expect(client.getLatestGameState()!.smokes).toEqual([]);
      expect(client.getLatestGameState()!.smokeTargets).toEqual([]);
      use(hostRoom); host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null);
      use(clientRoom); expect(client.getLatestGameState()).toBeUndefined();
    } finally { clearActiveSession(); runtime.destroy(); }
  });
});
