import { describe, expect, it, vi } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';
import type { PlasmaBurnerPulseEvent } from '../../src/combat/plasmaBurner/PlasmaBurnerContracts';

describe('plasma burner World replication', () => {
  it('replicates complete pulses and overload, supports late join and rejects expired World events', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'BURNER' });
    const connect = (room: TestRoom) => { use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge; };
    const host = connect(hostRoom);
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'burner' };
    host.publishLobbySync(); host.publishWorldAndActivity(world, null);
    const client = connect(clientRoom), pulses = vi.fn();
    client.registerPlasmaBurnerPulseHandler(pulses);
    const player = { x: 0, y: 0, rot: 0, hp: 70, maxHp: 100, armor: 0, adrenaline: 21.5, rage: 0,
      alive: true, isBurrowed: false, isStunned: false, isRaging: false, burnStacks: 0, dashPhase: 0 as const,
      burrowPhase: 'idle' as const, aim: { revision: 1, isMoving: false, weapon1DynamicSpread: 0, weapon2DynamicSpread: 0 },
      plasmaBurnerOverload: { q: 37.5, qMax: 120, building: true } };
    const base: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime: 0, players: { p: player }, projectiles: null, enemies: null, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [],
      remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
      nukes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
      coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [],
      guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
      targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
    };
    const publish = (state = base) => { use(hostRoom); host.publishGameState(state, true); hostRoom.room.update(); use(clientRoom); };
    const pulse: PlasmaBurnerPulseEvent = { id: 'p', sid: 5, lk: false, m: 1.375, p: 2,
      s: [[0, 0, 50, 0, 0], [300, 0, 350, 0, 1], [350, 0, 360, 40, 2]] };
    try {
      publish();
      expect(client.getLatestGameState()!.players.p.plasmaBurnerOverload).toEqual(player.plasmaBurnerOverload);
      const late = connect(await addClientRoom(network));
      expect(late.getLatestGameState()!.players.p.plasmaBurnerOverload).toEqual(player.plasmaBurnerOverload);
      use(hostRoom); host.broadcastPlasmaBurnerPulse(pulse);
      host.broadcastPlasmaBurnerPulse({ ...pulse, p: 1, lk: true, s: [pulse.s[0]] });
      expect(pulses).toHaveBeenCalledTimes(2); // Same shot id still applies the authoritative replacement.
      expect(pulses.mock.calls[0][0]).toMatchObject(pulse);
      expect(pulses.mock.calls[1][0]).toMatchObject({ p: 1, lk: true, s: [pulse.s[0]] });
      publish({ ...base, players: { p: { ...player, plasmaBurnerOverload: undefined } } });
      expect(client.getLatestGameState()!.players.p.plasmaBurnerOverload).toBeUndefined();
      use(hostRoom); host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null);
      hostRoom.room.broadcast('pbfx', { ...pulse, wr: 1 });
      hostRoom.room.broadcast('pbfx', { ...pulse, wr: 2, s: [[0, 0, 1, 1, 9]] });
      expect(pulses).toHaveBeenCalledTimes(2);
      use(clientRoom); expect(client.getLatestGameState()).toBeUndefined();
    } finally { clearActiveSession(); }
  });
});
