import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';
import type { SyncedEnergyShield } from '../../src/types';

describe('enemy frontal shield replication', () => {
  it('round-trips an enemy shield entry beside an unchanged player shield entry', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'SHLD' });
    const connect = (room: TestRoom) => { use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge; };
    try {
      const host = connect(hostRoom);
      host.publishLobbySync();
      host.publishWorldAndActivity({ worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'shield' }, null);
      const client = connect(clientRoom);
      const player: SyncedEnergyShield = { ownerId: 'p1', x: 10, y: 20, angle: 0.5, anchorDistance: 2, radius: 18,
        thickness: 5, arcDegrees: 120, color: 0x44aaff, alpha: 0.56, flashAlpha: 0, isDome: false };
      const enemy: SyncedEnergyShield = { ownerId: 'enemy-7', ownerKind: 'enemy', x: 298, y: 100, angle: Math.PI,
        anchorDistance: 2, radius: 26, thickness: 5, arcDegrees: 120, color: 0xb347ff, alpha: 0.56, flashAlpha: 0.4, isDome: false };
      const state: Parameters<NetworkBridge['publishGameState']>[0] = {
        roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
        placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [], remoteControlTurrets: [],
        decoys: [], smokes: [], fires: [], powerups: null, pedestals: null, nukes: [], mortarStrikes: [], airstrikes: [], meteors: [], tunnels: [],
        train: null, bases: [], captureTheBeer: null, coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [],
        energyShields: [player, enemy], guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
        targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
      };
      use(hostRoom); host.publishGameState(state, true); hostRoom.room.update(); use(clientRoom);
      const received = client.getLatestGameState()!.energyShields;
      expect(received).toEqual([player, enemy]);
      expect(received[0]).not.toHaveProperty('ownerKind');
    } finally { clearActiveSession(); }
  });
});
