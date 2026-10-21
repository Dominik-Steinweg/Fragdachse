import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';
import type { SyncedBeeSwarm } from '../../src/types';

describe('bee swarm World replication', () => {
  it('replicates swarms, an empty delta means none, late join gets them, an old World never returns', async () => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'BEES' });
    const connect = (room: TestRoom) => { use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge; };
    const host = connect(hostRoom), world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'bees' };
    host.publishLobbySync(); host.publishWorldAndActivity(world, null); const client = connect(clientRoom);
    const base: Parameters<NetworkBridge['publishGameState']>[0] = { roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [], remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
      nukes: [], mortarStrikes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null, coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [],
      guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] }, targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] } };
    const swarms: SyncedBeeSwarm[] = [
      { id: 4, hiveIndex: 2, phase: 'hunting', phaseStartedAt: 1200, releasedAt: 1200, x: 310.5, y: 88.2,
        target: { kind: 'enemy', id: 'e9' }, hostile: false, stingSequence: 2 },
    ];
    const publish = (beeSwarms: SyncedBeeSwarm[], full: boolean) => {
      use(hostRoom); host.publishGameState({ ...base, beeSwarms }, full); hostRoom.room.update(); use(clientRoom);
    };
    try {
      publish(swarms, true);
      expect(client.getLatestGameState()!.beeSwarms).toEqual(swarms);
      const late = connect(await addClientRoom(network));
      expect(late.getLatestGameState()!.beeSwarms).toEqual(swarms);
      // The swarm went home: an empty delta clears it everywhere.
      use(clientRoom); client.flushNetwork();
      publish([], false);
      expect(client.getLatestGameState()!.beeSwarms).toEqual([]);
      const oldSnapshot = hostRoom.room.getGlobal('gsi');
      use(hostRoom); host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null); use(clientRoom);
      expect(client.getLatestGameState()).toBeUndefined();
      hostRoom.room.setGlobal('gs', oldSnapshot, true); hostRoom.room.update();
      expect(client.getLatestGameState()).toBeUndefined();
    } finally { clearActiveSession(); }
  });
});
