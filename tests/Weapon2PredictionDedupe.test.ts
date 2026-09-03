import { describe, expect, it, vi } from 'vitest';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from './fakePeerNetwork';

function world(worldRevision: number): WorldDescriptor {
  return {
    worldRevision,
    definitionId: 'world:coop-defense:7',
    seed: 4242,
    generatorVersion: 3,
    layoutFingerprint: 'deadbeef',
  };
}

function useRoom(room: TestRoom): void {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'PREDICT' });
}

describe('Weapon2 prediction deduplication', () => {
  it('returns the stored final result without firing or draining twice', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      useRoom(hostRoom);
      const host = new NetworkBridge();
      host.activate();
      host.publishWorldAndActivity(world(1), null);
      const handler = vi.fn(() => ({ ok: true }));
      host.registerLoadoutUseHandler(handler);

      useRoom(hostRoom);
      const request = { slot: 'weapon2', angle: 0.2, tx: 10, ty: 20, wr: 1, pid: 1 };
      const first = await clientRoom.room.callHost('lu', request, 500);
      const retry = await clientRoom.room.callHost('lu', request, 500);

      expect(first).toMatchObject({ ok: true, worldRevision: 1, weapon2PredictionAck: 1 });
      expect(retry).toMatchObject({ ok: true, worldRevision: 1, weapon2PredictionAck: 1 });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      clearActiveSession();
    }
  });

  it('does not skip a missing ID and closes the ACK gap when that ID is retried', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      useRoom(hostRoom);
      const host = new NetworkBridge();
      host.activate();
      host.publishWorldAndActivity(world(1), null);
      const handler = vi.fn(() => ({ ok: true }));
      host.registerLoadoutUseHandler(handler);
      const use = async (predictionId: number) => clientRoom.room.callHost('lu', {
        slot: 'weapon2', angle: 0, tx: 0, ty: 0, wr: 1, pid: predictionId,
      }, 500);

      useRoom(hostRoom);
      const twelve = await use(12);
      expect(twelve).toMatchObject({ weapon2PredictionAck: 0 });
      const eleven = await use(11);
      expect(eleven).toMatchObject({ weapon2PredictionAck: 0 });

      // IDs are per World and the stream starts at 1: the example's ACK 10 is represented by
      // feeding the preceding contiguous range without changing the dedupe call count.
      for (let id = 1; id <= 10; id++) await use(id);
      expect(host.getWeapon2PredictionAck('p1')).toBe(12);
      expect(handler).toHaveBeenCalledTimes(12);
    } finally {
      clearActiveSession();
    }
  });

  it('leitet keinen Client-Timestamp aus dem lu-Payload an den Host-Handler weiter', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      useRoom(hostRoom);
      const host = new NetworkBridge();
      host.activate();
      host.publishWorldAndActivity(world(1), null);
      const handler = vi.fn(() => ({ ok: true }));
      host.registerLoadoutUseHandler(handler);

      useRoom(hostRoom);
      // Absurd alte / weit in der Zukunft liegende Client-Zeit darf den Host nicht erreichen.
      await clientRoom.room.callHost('lu', { slot: 'weapon1', angle: 0, tx: 1, ty: 2, wr: 1, ts: 1 }, 500);
      await clientRoom.room.callHost('lu', { slot: 'weapon1', angle: 0, tx: 1, ty: 2, wr: 1, ts: 9_999_999_999_999 }, 500);

      expect(handler).toHaveBeenCalledTimes(2);
      for (const call of handler.mock.calls) {
        // (slot, angle, targetX, targetY, senderId, shotId, params, clientX, clientY) – kein Zeit-Argument.
        expect(call.length).toBeLessThanOrEqual(9);
        expect(call.slice(0, 4)).toEqual(['weapon1', 0, 1, 2]);
      }
    } finally {
      clearActiveSession();
    }
  });

  it('deduplicates final rejects as well as accepted shots', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      useRoom(hostRoom);
      const host = new NetworkBridge();
      host.activate();
      host.publishWorldAndActivity(world(1), null);
      const handler = vi.fn(() => ({ ok: false, reason: 'resource' as const }));
      host.registerLoadoutUseHandler(handler);

      useRoom(hostRoom);
      const request = { slot: 'weapon2', angle: 0, tx: 0, ty: 0, wr: 1, pid: 1 };
      expect(await clientRoom.room.callHost('lu', request, 500)).toMatchObject({ ok: false });
      expect(await clientRoom.room.callHost('lu', request, 500)).toMatchObject({ ok: false });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      clearActiveSession();
    }
  });
});
