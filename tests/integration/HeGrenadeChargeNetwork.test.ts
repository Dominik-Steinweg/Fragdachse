import { describe, expect, it, vi } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { UtilityChargePrediction } from '../../src/loadout/UtilityChargePrediction';
import { FakeNetwork, createHostRoom, addClientRoom, dropConnection } from '../fakePeerNetwork';

describe('HE reliable player state without an Activity', () => {
  it('carries stock, utility-slot replies, late-join/bootstrap, resume and teardown through the existing player channel', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network, [], 'he-grenade-client-resume-token');
    try {
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'HE-TEST' });
      const host = new NetworkBridge(); host.activate();
      host.publishWorldAndActivity({ worldRevision: 1, definitionId: 'world:coop-defense:7',
        seed: 1, generatorVersion: 3, layoutFingerprint: 'he-test' }, null);
      const initial = { utilityId: 'HE_GRENADE', revision: 1, availableCharges: 4, maxCharges: 4,
        rechargeIntervalMs: 2000, nextChargeAt: null, lockoutUntil: 0 };
      host.publishUtilityChargeState('p1', initial.utilityId, initial);
      const used = { ...initial, revision: 2, availableCharges: 3, nextChargeAt: 2100,
        lockoutUntil: 200, lastCommittedAttemptId: 'throw-one' };
      host.registerLoadoutUseHandler(vi.fn(() => {
        host.publishUtilityChargeState('p1', used.utilityId, used);
        return { ok: true, utilityChargeState: used };
      }));
      const prediction = new UtilityChargePrediction();
      prediction.observe(initial); prediction.predict(initial.utilityId, 'throw-one', 100, 100);
      const reply = await clientRoom.room.callHost('lu', { slot: 'utility', angle: 0, tx: 100, ty: 0,
        wr: 1, prm: { attemptId: 'throw-one' } }, 500);
      expect(reply).toMatchObject({ ok: true, worldRevision: 1, utilityChargeState: used });
      expect(clientRoom.room.getPlayerState('p1', 'uch')).toEqual({ HE_GRENADE: used });
      prediction.acknowledge('throw-one', (reply as { utilityChargeState: typeof used }).utilityChargeState);
      expect(prediction.project(initial.utilityId, 500)?.availableCharges).toBe(3);
      expect(host.getPlayerUtilityCooldownUntil('p1', initial.utilityId)).toBe(used.lockoutUntil);

      const late = await addClientRoom(network);
      setActiveSession({ room: late.room, transport: late.transport, roomCode: 'HE-TEST' });
      const lateBridge = new NetworkBridge(); lateBridge.activate();
      expect(lateBridge.getPlayerUtilityChargeState('p1', initial.utilityId)).toEqual(used);
      clientRoom.transport.reconnectEnabled = false;
      dropConnection(clientRoom);
      const resumed = await addClientRoom(network, [], 'he-grenade-client-resume-token');
      expect(resumed.room.getLocalPlayerId()).toBe('p1');
      expect(resumed.room.getPlayerState('p1', 'uch')).toEqual({ HE_GRENADE: used });

      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'HE-TEST' });
      host.publishUtilityChargeState('p1', initial.utilityId, null);
      expect(lateBridge.getPlayerUtilityChargeState('p1', initial.utilityId)).toBeNull();
      expect(resumed.room.getPlayerState('p1', 'uch')).toEqual({});
    } finally { clearActiveSession(); }
  });
});
