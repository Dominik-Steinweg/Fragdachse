import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { parseTimeBubbleUtilityState, type TimeBubbleUtilityState } from '../../src/loadout/TimeBubbleUtilityState';
import { FakeNetwork, createHostRoom, addClientRoom, dropConnection } from '../fakePeerNetwork';

describe('TimeBubble reliable utility state without an Activity', () => {
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
