import { afterEach, describe, expect, it } from 'vitest';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { PersistentBaseRewardGrantService } from '../src/persistentBase/PersistentBaseRewardGrant';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from './fakePeerNetwork';

function bridgeFor(room: TestRoom): NetworkBridge {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'PB3D1' });
  const bridge = new NetworkBridge();
  bridge.activate();
  return bridge;
}

function useRoom(room: TestRoom): void {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'PB3D1' });
}

afterEach(() => clearActiveSession());

describe('Persistent-Base-Reward-Grant – reliable host confirmation', () => {
  it('confirms only through the host and retains a cumulative monotone state', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      const clientId = client.getLocalPlayerId();

      useRoom(hostRoom);
      host.hostConfirmPersistentBaseRewardGrant(clientId, {
        revision: 2,
        rewardIds: ['base_health_pedestal'],
      });
      useRoom(clientRoom);
      expect(client.getConfirmedPersistentBaseRewardGrant()).toEqual({
        revision: 2,
        rewardIds: ['base_health_pedestal'],
      });

      useRoom(hostRoom);
      host.hostConfirmPersistentBaseRewardGrant(clientId, {
        revision: 1,
        rewardIds: ['base_spore_turret'],
      });
      host.hostConfirmPersistentBaseRewardGrant(clientId, {
        revision: 3,
        rewardIds: ['base_spore_turret'],
      });
      host.hostConfirmPersistentBaseRewardGrant(clientId, {
        revision: 3,
        rewardIds: ['base_health_pedestal', 'base_spore_turret'],
      });
      useRoom(clientRoom);
      expect(client.getConfirmedPersistentBaseRewardGrant()).toEqual({
        revision: 3,
        rewardIds: ['base_health_pedestal', 'base_spore_turret'],
      });
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });

  it('rejects malformed payloads and cannot be self-granted by a guest', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      const clientId = client.getLocalPlayerId();
      useRoom(clientRoom);
      client.hostConfirmPersistentBaseRewardGrant(clientId, {
        revision: 99,
        rewardIds: ['base_health_pedestal'],
      });
      expect(client.getConfirmedPersistentBaseRewardGrant()).toBeNull();

      clientRoom.room.getPlayerHandle(clientId)!.setState('pbr', {
        revision: 1,
        rewardIds: ['base_health_pedestal', 'base_health_pedestal'],
      }, true);
      useRoom(hostRoom);
      expect(host.getPlayerPersistentBaseRewardGrant(clientId)).toBeNull();

      const service = new PersistentBaseRewardGrantService();
      const confirmed: unknown[] = [];
      service.grant(['base_health_pedestal'] as const, [clientId], {
        localPlayerId: host.getLocalPlayerId(),
        applyLocal: () => undefined,
        confirmForPlayer: (_playerId, grant) => confirmed.push(grant),
      });
      expect(confirmed).toHaveLength(1);
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });
});
