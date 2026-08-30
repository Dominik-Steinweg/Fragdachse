import { afterEach, describe, expect, it } from 'vitest';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { PersistentBaseRewardGrantService } from '../src/persistentBase/PersistentBaseRewardGrant';
import { PersistentBaseRoomSession } from '../src/persistentBase/PersistentBaseRoomSession';
import type { PersistentBaseRewardId } from '../src/persistentBase/PersistentBaseRewardTypes';
import { LOBBY_WORLD_DEFINITION_ID } from '../src/config/authoring/lobbyWorld';
import { createAuthoredWorldDescriptor } from '../src/world/WorldLayout';
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
        applyLocal: () => [],
        confirmForPlayer: (_playerId, rewardIds) => {
          confirmed.push([...rewardIds]);
          return rewardIds;
        },
      });
      expect(confirmed).toHaveLength(1);
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });

  it('merges through the reliable state across service restarts and keeps repeats idempotent', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      const clientId = client.getLocalPlayerId();
      const grant = (service: PersistentBaseRewardGrantService, ids: readonly PersistentBaseRewardId[]) => {
        useRoom(hostRoom);
        const result = service.grant(ids, [clientId], {
          localPlayerId: host.getLocalPlayerId(),
          applyLocal: () => [],
          confirmForPlayer: (playerId, rewardIds) => host.hostGrantPersistentBaseRewards(playerId, rewardIds),
        });
        useRoom(clientRoom);
        return result;
      };

      expect(grant(new PersistentBaseRewardGrantService(), ['base_health_pedestal'])
        .newlyGrantedByPlayerId.get(clientId)).toEqual(['base_health_pedestal']);
      expect(client.getConfirmedPersistentBaseRewardGrant()).toEqual({
        revision: 1,
        rewardIds: ['base_health_pedestal'],
      });

      expect(grant(new PersistentBaseRewardGrantService(), ['base_spore_turret'])
        .newlyGrantedByPlayerId.get(clientId)).toEqual(['base_spore_turret']);
      expect(grant(new PersistentBaseRewardGrantService(), ['base_health_pedestal'])
        .newlyGrantedByPlayerId.has(clientId)).toBe(false);
      expect(grant(new PersistentBaseRewardGrantService(), ['base_rocket_turret'])
        .newlyGrantedByPlayerId.get(clientId)).toEqual(['base_rocket_turret']);
      expect(client.getConfirmedPersistentBaseRewardGrant()).toEqual({
        revision: 3,
        rewardIds: ['base_health_pedestal', 'base_spore_turret', 'base_rocket_turret'],
      });

      useRoom(hostRoom);
      host.hostConfirmPersistentBaseRewardGrant(clientId, {
        revision: 4,
        rewardIds: ['base_health_pedestal'],
      });
      expect(host.getPlayerPersistentBaseRewardGrant(clientId)).toEqual({
        revision: 3,
        rewardIds: ['base_health_pedestal', 'base_spore_turret', 'base_rocket_turret'],
      });
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });

  it('replicates the complete current-world placement projection and ignores stale revisions', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      const world = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 404);

      useRoom(hostRoom);
      host.publishWorldAndActivity(world, null);
      host.publishPersistentBaseRewardSessionState({
        worldRevision: 404,
        revision: 2,
        availableRewardIds: ['base_spore_turret', 'base_health_pedestal'],
        placements: [{
          rewardId: 'base_spore_turret', relativeGridX: -2, relativeGridY: 0, angle: 0.5,
        }],
      });

      useRoom(clientRoom);
      expect(client.getPersistentBaseRewardSessionState()).toEqual({
        worldRevision: 404,
        revision: 2,
        availableRewardIds: ['base_spore_turret', 'base_health_pedestal'],
        placements: [{
          rewardId: 'base_spore_turret', relativeGridX: -2, relativeGridY: 0, angle: 0.5,
        }],
      });

      useRoom(hostRoom);
      host.publishPersistentBaseRewardSessionState({
        worldRevision: 404,
        revision: 1,
        availableRewardIds: ['base_spore_turret'],
        placements: [],
      });
      useRoom(clientRoom);
      expect(client.getPersistentBaseRewardSessionState()?.revision).toBe(2);
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });

  it('deduplicates identical snapshots and emits the null transition only once', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      const world = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 406);
      const state = {
        worldRevision: 406,
        revision: 2,
        availableRewardIds: ['base_health_pedestal'] as PersistentBaseRewardId[],
        placements: [],
      };

      useRoom(hostRoom);
      host.publishWorldAndActivity(world, null);
      host.publishPersistentBaseRewardSessionState(state);
      host.publishPersistentBaseRewardSessionState(state);
      const sessionWrites = () => hostRoom.transport.links
        .flatMap((link) => link.sent)
        .filter(({ channel, message }) => channel === 'rel'
          && message.t === 'b'
          && message.g?.some(([key]) => key === 'pbrs'));
      expect(sessionWrites()).toHaveLength(1);

      useRoom(clientRoom);
      expect(client.getPersistentBaseRewardSessionState()).toEqual(state);

      useRoom(hostRoom);
      host.publishPersistentBaseRewardSessionState(null);
      host.publishPersistentBaseRewardSessionState(null);
      host.publishPersistentBaseRewardSessionState(null);
      expect(sessionWrites()).toHaveLength(2);

      useRoom(clientRoom);
      expect(client.getPersistentBaseRewardSessionState()).toBeNull();
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });

  it('routes host-local placement requests through the registered handler', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const world = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 405);
      const calls: Array<{ playerId: string; rewardId: string; x: number; y: number }> = [];

      useRoom(hostRoom);
      host.publishWorldAndActivity(world, null);
      host.registerPersistentBaseRewardPlacementHandler((playerId, request) => {
        calls.push({
          playerId,
          rewardId: request.rewardId,
          x: request.relativeGridX,
          y: request.relativeGridY,
        });
        return { ok: true };
      });

      await expect(host.sendPersistentBaseRewardPlacement({
        worldRevision: 405,
        rewardId: 'base_health_pedestal',
        relativeGridX: 1,
        relativeGridY: 2,
        angle: 0,
      })).resolves.toEqual({ ok: true });
      expect(calls).toEqual([{
        playerId: host.getLocalPlayerId(),
        rewardId: 'base_health_pedestal',
        x: 1,
        y: 2,
      }]);
    } finally {
      hostRoom.room.leave();
    }
  });

  it('bindet dedizierte und generische Requests an die aktuelle Activity-Identity', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      bridgeFor(clientRoom);
      const world = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 407);
      const activity = {
        activityRevision: 8,
        worldRevision: 407,
        kind: 'coop-mission' as const,
        definitionId: 'activity:coop-mission:network',
      };
      const session = new PersistentBaseRoomSession();
      session.beginTransaction({ worldRevision: 407, activityRevision: 8 });

      useRoom(hostRoom);
      host.publishWorldAndActivity(world, activity);
      host.hostPublishWorldParticipation({ [host.getLocalPlayerId()]: 'interactive' });
      host.registerPersistentBaseRewardPlacementHandler((_playerId, request) => (
        session.acceptsMutation(request)
          ? { ok: true }
          : { ok: false, reason: 'blocked' }
      ));
      host.registerLoadoutUseHandler((_slot, _angle, _targetX, _targetY, _senderId, _shotId, params) => (
        session.acceptsMutation({
          worldRevision: 407,
          activityRevision: params?.activityRevision,
        })
          ? { ok: true }
          : { ok: false, reason: 'blocked' }
      ));

      useRoom(hostRoom);
      // An explicit stale identifier remains stale; only a missing identifier is filled from B.
      const staleResult = await host.sendPersistentBaseRewardPlacement({
        worldRevision: 407,
        activityRevision: 7,
        rewardId: 'base_health_pedestal',
        relativeGridX: 0,
        relativeGridY: 0,
        angle: 0,
      });
      const currentRewardResult = await host.sendPersistentBaseRewardPlacement({
        worldRevision: 407,
        rewardId: 'base_health_pedestal',
        relativeGridX: 0,
        relativeGridY: 0,
        angle: 0,
      });
      const currentLoadoutResult = await host.sendLoadoutUse(
        'weapon1', 0, 0, 0, undefined, undefined, undefined, undefined, undefined, true,
      );
      expect(staleResult).toEqual({ ok: false, reason: 'blocked' });
      expect(currentRewardResult).toEqual({ ok: true });
      expect(currentLoadoutResult).toEqual({ ok: true });

      // A delayed A-request reaches the real host RPC adapter but cannot address B's state.
      useRoom(hostRoom);
      await expect(clientRoom.room.callHost('pbrp', {
        wr: 407,
        ar: 7,
        rid: 'base_health_pedestal',
        gx: 0,
        gy: 0,
        angle: 0,
      }, 1_000)).resolves.toEqual({ ok: false, reason: 'blocked' });
      await expect(clientRoom.room.callHost('lu', {
        wr: 407,
        slot: 'weapon1',
        angle: 0,
        tx: 0,
        ty: 0,
        prm: { activityRevision: 7 },
      }, 1_000)).resolves.toEqual({ ok: false, reason: 'blocked' });

      // Invalid wire identifiers are rejected before the host callback.
      await expect(clientRoom.room.callHost('pbrp', {
        wr: 407,
        ar: '8',
        rid: 'base_health_pedestal',
        gx: 0,
        gy: 0,
        angle: 0,
      }, 1_000)).resolves.toEqual({ ok: false, reason: 'invalid' });
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });
});
