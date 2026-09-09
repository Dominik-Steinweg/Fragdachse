import { describe, expect, it, vi } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { parseTranslocatorUseState, type TranslocatorUseState } from '../../src/loadout/TranslocatorUseState';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';

describe('world scoped Translocator replication', () => {
  it('bootstraps live pairs, propagates cooldown and rejects a previous World projection', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'PORTALS' });
    const connect = (room: TestRoom) => { use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge; };
    try {
      const host = connect(hostRoom);
      const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'portals' };
      host.publishLobbySync(); host.publishWorldAndActivity(world, null);
      const client = connect(clientRoom), collapse = vi.fn();
      client.registerPortalCollapseHandler(collapse);
      const state: TranslocatorUseState = { phase: 'portals', useId: 'pair-1', utilityId: 'TRANSLOCATOR', cooldownDurationMs: 300,
        pair: { id: 'pair-1', ownerId: 'p1', a: { x: 20, y: 30 }, b: { x: 300, y: 50 },
          radius: 16, reentryDistance: 48, damageBonus: 0.4, createdAt: 1000, expiresAt: 6000 } };
      use(hostRoom); host.publishTranslocatorUseState('p1', state);
      expect(client.getTranslocatorPortalPairs()).toEqual([state.pair]);
      const late = connect(await addClientRoom(network));
      expect(late.getPlayerTranslocatorUseState('p1')).toEqual(state);
      use(hostRoom); host.broadcastPortalCollapse(state.pair, 100); host.broadcastPortalCollapse(state.pair, 100);
      expect(collapse).toHaveBeenCalledTimes(1);
      host.publishTranslocatorUseState('p1', { phase: 'cooldown', useId: state.useId,
        utilityId: state.utilityId, cooldownDurationMs: 300, cooldownUntil: 6300 });
      expect(late.getTranslocatorPortalPairs()).toEqual([]);
      expect(late.getPlayerUtilityCooldownUntil('p1', 'TRANSLOCATOR')).toBe(6300);
      host.publishTranslocatorUseState('p1', state);
      host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null);
      use(clientRoom);
      expect(client.getTranslocatorPortalPairs()).toEqual([]);
      expect(client.getPlayerTranslocatorUseState('p1')).toBeNull();
      expect(parseTranslocatorUseState({ ...state, pair: { ...state.pair, a: { x: NaN, y: 3 } } })).toBeNull();
    } finally { clearActiveSession(); }
  });
});
