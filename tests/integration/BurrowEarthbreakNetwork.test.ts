import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { BurrowEarthbreakRuntime } from '../../src/systems/BurrowEarthbreakRuntime';
import { BURROW_EARTHBREAK } from '../../src/config/burrowEarthbreak';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';

describe('Earthbreak authoritative replication', () => {
  it('recovers lost traces and detonations, bootstraps late join, clears explicitly and rejects an old World', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'EARTH' });
    const bridge = (room: TestRoom) => { use(room); const result = new NetworkBridge(); result.activate(); return result; };
    const host = bridge(hostRoom);
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'earth' };
    host.publishLobbySync(); host.publishWorldAndActivity(world, null);
    const client = bridge(clientRoom);
    const hits: unknown[] = [];
    const runtime = new BurrowEarthbreakRuntime(hit => hits.push(hit));
    const base: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [],
      remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
      nukes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
      coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [],
      guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
      targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
    };
    const publish = (full = false) => {
      use(hostRoom); host.publishGameState({ ...base, earthbreak: runtime.snapshot() }, full);
      hostRoom.room.update(); use(clientRoom);
    };
    try {
      publish(true);
      expect(client.getLatestGameState()!.earthbreak).toEqual([]);
      runtime.start('p', { x: 0, y: 0, positionRevision: 0 });
      runtime.move('p', { x: BURROW_EARTHBREAK.spacingPx * 3, y: 0, positionRevision: 0 });
      for (const link of hostRoom.transport.links) link.fastReady = false;
      publish();
      expect(client.getLatestGameState()!.earthbreak).toEqual([]);
      for (const link of hostRoom.transport.links) link.fastReady = true;
      publish();
      expect(client.getLatestGameState()!.earthbreak).toEqual(runtime.snapshot());
      for (const link of hostRoom.transport.links) link.fastReady = false;
      runtime.exit('p', { x: 72, y: 0 }, 1000);
      publish();
      expect(client.getLatestGameState()!.earthbreak![0].phase).toBe('digging');
      for (const link of hostRoom.transport.links) link.fastReady = true;
      publish();
      expect(client.getLatestGameState()!.earthbreak).toEqual(runtime.snapshot());
      expect(hits).toHaveLength(1); // Reading replicas never executes gameplay explosions.
      publish(true);
      const oldWorldPacket = { ...(hostRoom.room.getGlobal('gs') as Record<string, unknown>) };
      const joining = bridge(await addClientRoom(network));
      expect(joining.getLatestGameState()!.earthbreak).toEqual(runtime.snapshot());
      runtime.clear(); publish(); publish();
      expect(client.getLatestGameState()!.earthbreak).toEqual([]);
      use(hostRoom); host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null);
      hostRoom.room.setGlobal('gs', { ...oldWorldPacket, _s: 1000 }, true); hostRoom.room.update();
      use(clientRoom); expect(client.getLatestGameState()).toBeUndefined();
      expect(hits).toHaveLength(1);
    } finally { clearActiveSession(); runtime.clear(); }
  });
});
