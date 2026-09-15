import { describe, expect, it, vi } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, getActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';

describe('confirmed feedback over the reliable Bridge channel', () => {
  it('delivers death once to host and clients before teardown, batches pickups and never bootstraps historical sounds', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'AUDIO' });
    const connect = (room: TestRoom) => {
      use(room);
      // Each simulated browser owns its own active session while processing its wire messages.
      const receive = room.transport.handlers!.onMessage;
      room.transport.handlers!.onMessage = (...args) => {
        const previous = getActiveSession();
        use(room);
        try { receive(...args); } finally { if (previous) setActiveSession(previous); }
      };
      const bridge = new NetworkBridge(); bridge.activate();
      return bridge;
    };
    const host = connect(hostRoom), client = connect(clientRoom);
    const hostSound = vi.fn(), clientSound = vi.fn();
    use(hostRoom); host.registerAudioFeedbackHandler(hostSound);
    use(clientRoom); client.registerAudioFeedbackHandler(clientSound);
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'audio' };
    try {
      use(hostRoom); host.publishLobbySync(); host.publishWorldAndActivity(world, null);
      host.hostPublishWorldParticipation({ [hostRoom.room.getLocalPlayerId()]: 'interactive', [clientRoom.room.getLocalPlayerId()]: 'interactive' });
      hostRoom.room.update();
      const death = { key: 'sfx_player_death' as const, eventId: 'p1:life1', position: { x: 10, y: 20, emitterId: 'p1' } };
      host.broadcastAudioFeedback(death, true);
      expect(hostSound).toHaveBeenCalledOnce();
      expect(clientSound).toHaveBeenCalledOnce();
      host.broadcastAudioFeedback(death, true);
      expect(hostSound).toHaveBeenCalledOnce();
      expect(clientSound).toHaveBeenCalledOnce();
      host.broadcastAudioFeedback({ ...death, eventId: 'p2:life1' }, true);
      // The immediate event is already received before a callback changes the World.
      host.publishWorldAndActivity({ ...world, worldRevision: 2 }, null);
      expect(hostSound).toHaveBeenCalledTimes(2);
      expect(clientSound).toHaveBeenCalledTimes(2);
      host.hostPublishWorldParticipation({ [hostRoom.room.getLocalPlayerId()]: 'interactive', [clientRoom.room.getLocalPlayerId()]: 'interactive' });
      hostRoom.room.update();
      host.broadcastAudioFeedback({ key: 'sfx_pickup_hp', eventId: 'pickup1', recipientId: clientRoom.room.getLocalPlayerId() });
      host.broadcastAudioFeedback({ key: 'sfx_pickup_armor', eventId: 'pickup2', recipientId: clientRoom.room.getLocalPlayerId() });
      expect(clientSound).toHaveBeenCalledTimes(2);
      await Promise.resolve();
      expect(clientSound.mock.calls.slice(2).map(call => call[0].key)).toEqual(['sfx_pickup_hp', 'sfx_pickup_armor']);
      expect(hostSound).toHaveBeenCalledTimes(2);
      const lateRoom = await addClientRoom(network);
      const late = connect(lateRoom), lateSound = vi.fn();
      late.registerAudioFeedbackHandler(lateSound);
      expect(lateSound).not.toHaveBeenCalled();
      use(hostRoom);
      host.broadcastAudioFeedback({ key: 'sfx_enemy_death', eventId: 'retired-world' });
      host.publishWorldAndActivity({ ...world, worldRevision: 3 }, null);
      await Promise.resolve();
      expect(hostSound).toHaveBeenCalledTimes(2);
      expect(clientSound).toHaveBeenCalledTimes(4);
    } finally { use(hostRoom); clearActiveSession(); }
  });
});
