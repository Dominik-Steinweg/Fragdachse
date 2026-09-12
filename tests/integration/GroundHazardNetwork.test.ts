import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';

describe('ground hazard and base burn replication', () => {
  it('bootstraps late join, sends warning-only changes and clears burned bases and ground on cleanup', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'FIRE' });
    const connect = (room: TestRoom) => { use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge; };
    const host = connect(hostRoom);
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'fire' };
    host.publishLobbySync(); host.publishWorldAndActivity(world, null);
    const client = connect(clientRoom);
    const state: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [], remoteControlTurrets: [],
      decoys: [], smokes: [], fires: [], powerups: null, pedestals: null, nukes: [], airstrikes: [], meteors: [], tunnels: [],
      train: null, bases: [], captureTheBeer: null, coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [],
      energyShields: [], guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
      targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
    };
    const publish = (full = false) => {
      use(hostRoom); host.publishGameState(state, full); hostRoom.room.update(); use(clientRoom);
      client.getLatestGameState();
    };
    try {
      state.burningGround = { cells: [{ id: 1, gridX: 0, gridY: 0, intensity: 1, expiresAt: Number.MAX_SAFE_INTEGER, visualStyle: 'void' }],
        warnings: [{ gridX: 1, gridY: 0, activatesAt: Date.now() + 60000 }] };
      state.bases = [{ id: 'base', hp: 500, maxHp: 1000, voidBurning: true }];
      publish(true);
      const late = connect(await addClientRoom(network));
      expect(late.getLatestGameState()!.burningGround).toEqual(state.burningGround);
      expect(late.getLatestGameState()!.bases).toEqual(state.bases);
      state.burningGround = { ...state.burningGround, warnings: [{ gridX: 2, gridY: 0, activatesAt: Date.now() + 60000 }] };
      publish(); publish();
      expect(client.getLatestGameState()!.burningGround).toEqual(state.burningGround);
      state.burningGround = { cells: [], warnings: [] }; state.bases = [{ id: 'base', hp: 0, maxHp: 1000 }];
      publish(); publish();
      expect(client.getLatestGameState()!.burningGround).toEqual(state.burningGround);
      expect(client.getLatestGameState()!.bases).toEqual(state.bases);
      use(hostRoom); host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null); use(clientRoom);
      expect(client.getLatestGameState()).toBeUndefined();
    } finally { clearActiveSession(); }
  });
});
