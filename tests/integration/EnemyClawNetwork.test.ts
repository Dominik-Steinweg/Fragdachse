import { describe, expect, it, vi } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';
import { encodeEnemyUpsert, decodeEnemyUpserts } from '../../src/network/enemySnapshotCodec';
import type { EnemyClawEvent } from '../../src/systems/EnemyClawAttack';

describe('enemy claw reliable and baseline replication', () => {
  it('carries start, clear and join state, retains the impact ID, and rejects earlier World/Activity events', async () => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'CLAW' });
    const connect = (room: TestRoom) => { use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge; };
    const host = connect(hostRoom);
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'claw' };
    host.publishLobbySync(); host.publishWorldAndActivity(world, null);
    const client = connect(clientRoom), received = vi.fn(), melee = vi.fn();
    const unsubscribe = client.subscribeEnemyClawAttack(received); client.registerMeleeSwingHandler(melee);
    const start: EnemyClawEvent = { enemyId: 'e1', entityGeneration: 4, state: { revision: 1, attack: {
      attackId: 'e1:1000:1', weaponId: 'ZOMBIE_BADGER_BITE', startedAt: 1000, strikeAt: 1270,
      hitAt: 1350, endsAt: 1570, angle: .7, range: 40, arcDegrees: 100,
    } } };
    const wire: (string | number)[] = [];
    encodeEnemyUpsert(wire, { id: 'e1', entityGeneration: 4, kind: 'zombie-badger', x: 100, y: 100, hp: 50, maxHp: 50, claw: start.state });
    const state: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime: 0, players: {}, projectiles: null, enemies: { u: wire, r: [], f: true }, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [],
      remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
      nukes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
      coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [],
      guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
      targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
    };
    try {
      use(hostRoom); host.broadcastEnemyClawAttack(start);
      expect(received.mock.calls[0][0]).toMatchObject(start);
      host.publishGameState(state, true); hostRoom.room.update();
      const late = connect(await addClientRoom(network));
      expect(decodeEnemyUpserts(late.getLatestGameState()!.enemies!.u)[0].claw).toEqual(start.state);
      const clear = { ...start, state: { revision: 2, attack: null } };
      use(hostRoom); host.broadcastEnemyClawAttack(clear);
      expect(received.mock.calls[1][0]).toMatchObject(clear);
      host.broadcastMeleeSwing({ swingId: 7, shooterId: 'e1', x: 100, y: 100, angle: .7,
        range: 40, arcDegrees: 100, color: 0, visualPreset: 'enemy_claw', clawAttackId: start.state.attack!.attackId });
      expect(melee.mock.calls[0][0].clawAttackId).toBe(start.state.attack!.attackId);
      hostRoom.room.broadcast('eclaw', { ...start, wr: 1, ar: 99 });
      host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null);
      hostRoom.room.broadcast('eclaw', { ...start, wr: 1, ar: null });
      hostRoom.room.broadcast('eclaw', { ...start, wr: 2, ar: null, state: { revision: 3, attack: {} } });
      expect(received).toHaveBeenCalledTimes(2);
      unsubscribe(); host.broadcastEnemyClawAttack(start);
      expect(received).toHaveBeenCalledTimes(2);
    } finally { clearActiveSession(); }
  });
});
