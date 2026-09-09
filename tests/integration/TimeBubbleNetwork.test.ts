import { describe, expect, it, vi } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { parseTimeBubbleUtilityState, type TimeBubbleUtilityState } from '../../src/loadout/TimeBubbleUtilityState';
import { FakeNetwork, createHostRoom, addClientRoom, dropConnection, type TestRoom } from '../fakePeerNetwork';

describe('TimeBubble reliable utility state without an Activity', () => {
  it('replicates charge, bootstraps late join, transmits explicit release strength and clears old World state', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'RESONANCE' });
    const connect = (room: TestRoom) => { use(room); const b = new NetworkBridge(); b.activate(); return b; };
    const host = connect(hostRoom);
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'resonance' };
    host.publishLobbySync(); host.publishWorldAndActivity(world, null);
    const client = connect(clientRoom);
    const released = vi.fn(); client.registerExplosionEffectHandler(released);
    const bubble = { id: 1, ownerId: 'p1', x: 30, y: 40, radius: 90, alpha: 1,
      color: 0xffffff, distortion: 0.75, charge: 13, chargeCapacity: 60 };
    const base: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [],
      remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
      nukes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
      coopDefenseCarry: [], stinkClouds: [], timeBubbles: [bubble], teslaDomes: [], energyShields: [],
      guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
      targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
    };
    const publish = (state = base, full = false) => { use(hostRoom); host.publishGameState(state, full); hostRoom.room.update(); use(clientRoom); };
    try {
      publish(base, true);
      expect(client.getLatestGameState()!.timeBubbles).toEqual([bubble]);
      bubble.charge = bubble.chargeCapacity;
      publish(base, true);
      expect(client.getLatestGameState()!.timeBubbles[0].charge).toBe(bubble.charge);
      const late = connect(await addClientRoom(network));
      expect(late.getLatestGameState()!.timeBubbles).toEqual([bubble]);
      use(hostRoom); host.broadcastExplosionEffect(bubble.x, bubble.y, bubble.radius, 0xff5b18, 'time_bubble_release', bubble.charge);
      expect(released).toHaveBeenCalledExactlyOnceWith(bubble.x, bubble.y, bubble.radius, 0xff5b18, 'time_bubble_release', bubble.charge);
      publish({ ...base, timeBubbles: [] });
      expect(client.getLatestGameState()!.timeBubbles).toEqual([]);
      expect(released).toHaveBeenCalledTimes(1);
      use(hostRoom); host.broadcastExplosionEffect(0, 0, 10);
      expect(released).toHaveBeenLastCalledWith(0, 0, 10, undefined, undefined);
      host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null);
      use(clientRoom); expect(client.getLatestGameState()).toBeUndefined();
    } finally { clearActiveSession(); }
  });
  it('replicates flight, active control, cooldown, late join, resume and cleanup', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const client = await addClientRoom(network, [], 'time-bubble-resume');
    try {
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'BUBBLE-TEST' });
      const host = new NetworkBridge(); host.activate();
      host.publishWorldAndActivity({ worldRevision: 1, definitionId: 'world:lobby', seed: 1,
        generatorVersion: 3, layoutFingerprint: 'bubble-test' }, null);
      const flying: TimeBubbleUtilityState = { phase: 'flying', projectileId: 7, utilityId: 'TIME_BUBBLE',
        cooldownDurationMs: 370, focusEnabled: true, temporaryUtilityInstanceId: 'last-charge' };
      host.publishTimeBubbleUtilityState('p1', flying);
      expect(client.room.getPlayerState('p1', 'tbu')).toEqual(flying);
      const active: TimeBubbleUtilityState = { phase: 'active', bubbleId: 8, utilityId: flying.utilityId,
        cooldownDurationMs: flying.cooldownDurationMs, focusEnabled: flying.focusEnabled, temporaryUtilityInstanceId: 'last-charge' };
      host.publishTimeBubbleUtilityState('p1', active);
      expect(host.getPlayerUtilityCooldownUntil('p1', 'TIME_BUBBLE')).toBe(0);
      const late = await addClientRoom(network);
      setActiveSession({ room: late.room, transport: late.transport, roomCode: 'BUBBLE-TEST' });
      const lateBridge = new NetworkBridge(); lateBridge.activate();
      expect(lateBridge.getPlayerTimeBubbleUtilityState('p1')).toEqual(active);
      client.transport.reconnectEnabled = false; dropConnection(client);
      const resumed = await addClientRoom(network, [], 'time-bubble-resume');
      expect(resumed.room.getPlayerState('p1', 'tbu')).toEqual(active);
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'BUBBLE-TEST' });
      const cooldown: TimeBubbleUtilityState = { phase: 'cooldown', cooldownUntil: 1370, utilityId: active.utilityId,
        cooldownDurationMs: active.cooldownDurationMs, focusEnabled: active.focusEnabled };
      host.publishTimeBubbleUtilityState('p1', cooldown);
      expect(lateBridge.getPlayerUtilityCooldownUntil('p1', 'TIME_BUBBLE')).toBe(cooldown.cooldownUntil);
      host.publishTimeBubbleUtilityState('p1', null);
      expect(lateBridge.getPlayerTimeBubbleUtilityState('p1')).toBeNull();
      expect(resumed.room.getPlayerState('p1', 'tbu')).toBeNull();
      expect(parseTimeBubbleUtilityState({ ...active, bubbleId: NaN })).toBeNull();
      expect(parseTimeBubbleUtilityState({ ...cooldown, cooldownUntil: Infinity })).toBeNull();
    } finally { clearActiveSession(); }
  });
});
