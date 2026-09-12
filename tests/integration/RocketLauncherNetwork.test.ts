import { describe, expect, it, vi } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';

describe('Rocket network state', () => {
  it('replicates the confirmed magazine and support state, bootstraps late join and clears at World replacement', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ROCKET' });
    const connect = (room: TestRoom) => { use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge; };
    const host = connect(hostRoom);
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'rocket' };
    host.publishLobbySync(); host.publishWorldAndActivity(world, null);
    const client = connect(clientRoom), chunks = vi.fn(); client.registerFireChunkEffectHandler(chunks);
    const player = { x: 0, y: 0, rot: 0, hp: 70, maxHp: 100, armor: 0, adrenaline: 21.5, rage: 0,
      alive: true, isBurrowed: false, isStunned: false, isRaging: false, burnStacks: 0, dashPhase: 0 as const,
      burrowPhase: 'idle' as const, aim: { revision: 1, isMoving: false, weapon1DynamicSpread: 0, weapon2DynamicSpread: 0 },
      rocketMagazine: { id: 9, loaded: 2, capacity: 4, nextLoadAt: 1500, intervalMs: 600, focused: true },
      pressureShieldUntil: 2400, rocketHealSequence: 3 };
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
    try {
      publish();
      expect(client.getLatestGameState()!.players.p).toMatchObject(player);
      const late = connect(await addClientRoom(network));
      expect(late.getLatestGameState()!.players.p.rocketMagazine).toEqual(player.rocketMagazine);
      const targets = [{ x: 10, y: 20, landsAt: 1001 }, { x: 40, y: 50, landsAt: 1270 }];
      use(hostRoom); host.broadcastFireChunkEffect(0, 0, targets, 1000);
      expect(chunks).toHaveBeenCalledExactlyOnceWith(0, 0, targets, 1000, 'normal');
      publish({ ...base, players: { p: { ...player, alive: false, rocketMagazine: undefined, pressureShieldUntil: 0, rocketHealSequence: 0 } } });
      expect(client.getLatestGameState()!.players.p.rocketMagazine).toBeUndefined();
      expect(client.getLatestGameState()!.players.p.pressureShieldUntil ?? 0).toBe(0);
      use(hostRoom); host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null);
      use(clientRoom); expect(client.getLatestGameState()).toBeUndefined();
    } finally { clearActiveSession(); }
  });
});
