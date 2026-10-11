import { describe, expect, it, vi } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, dropConnection, type TestRoom } from '../fakePeerNetwork';
import { event, gameState, kraken, phases } from '../krakenNetworkFixtures';

const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'KRAKEN' });
const connect = (room: TestRoom) => { use(room); const b = new NetworkBridge(); b.activate(); return b; };
const world = { worldRevision: 2, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'kraken' };
const activity = { worldRevision: 2, activityRevision: 5, kind: 'coop-mission' as const, definitionId: 'activity:coop-mission:7' };

describe('Kraken reliable, fast and welcome cutover', () => {
  it.each(phases)('joins and resumes during $kind from the complete current baseline without replay', async phase => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network), host = connect(hostRoom);
    const rooms: TestRoom[] = [hostRoom];
    try {
      host.publishLobbySync(); host.publishWorldAndActivity(world, activity);
      const state = kraken(phase), snapshot = gameState(state);
      // These phases intentionally have no combat entity in their bootstrap.
      if (['waiting', 'intro', 'dying', 'removed'].includes(phase.kind)) snapshot.enemies = { c: 0, u: [], r: [1], a: [] };
      host.publishGameState(snapshot, true); hostRoom.room.update();
      const lateRoom = await addClientRoom(network, [], 'kraken-resume-token'); rooms.push(lateRoom);
      const late = connect(lateRoom), effects = vi.fn();
      late.subscribeEnemyAreaClawAttack(effects); late.registerMeleeSwingHandler(effects);
      expect(late.getLatestGameState()?.kraken).toEqual(state);
      expect(effects).not.toHaveBeenCalled();
      const playerId = late.getLocalPlayerId();
      lateRoom.transport.reconnectEnabled = false; dropConnection(lateRoom); lateRoom.room.destroy();
      const resumedRoom = await addClientRoom(network, [], 'kraken-resume-token'); rooms.push(resumedRoom);
      const resumed = connect(resumedRoom);
      expect(resumed.getLocalPlayerId()).toBe(playerId);
      expect(resumed.getLatestGameState()?.kraken).toEqual(state);
      expect(effects).not.toHaveBeenCalled();
    } finally { for (const room of rooms) room.room.destroy(); clearActiveSession(); }
  });

  it('carries independent reliable slots and confirmations, heals fast loss, and clears within the same World', async () => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network), host = connect(hostRoom);
    let clientRoom: TestRoom | undefined;
    try {
      host.publishLobbySync(); host.publishWorldAndActivity(world, activity);
      host.publishGameState(gameState(), true); hostRoom.room.update();
      clientRoom = await addClientRoom(network); const client = connect(clientRoom);
      client.getLatestGameState(); client.flushNetwork();
      const claws = vi.fn(), impacts = vi.fn(), hits = vi.fn();
      client.subscribeEnemyAreaClawAttack(claws); client.registerMeleeSwingHandler(impacts);
      client.subscribeKrakenPartHit(hits);
      const e = event(), { state, ...address } = e;
      const swing = { swingId: 1, shooterId: 'e1', x: 1, y: 2, angle: .7, range: 0, arcDegrees: 0, color: 0,
        areaClaw: { ...address, revision: state.revision, attack: state.attack! } };
      use(hostRoom); host.broadcastMeleeSwing(swing); host.broadcastMeleeSwing(swing);
      expect(impacts).toHaveBeenCalledOnce(); expect(impacts.mock.calls[0][0].areaClaw).toEqual(swing.areaClaw);
      host.broadcastEnemyAreaClawAttack({ ...e, state: { revision: 2, attack: null } });
      host.broadcastMeleeSwing(swing);
      expect(impacts).toHaveBeenCalledOnce(); expect(claws).toHaveBeenCalledOnce();
      const contact = kraken().tentacles[1].contact;
      const receipt = { event: { scope: contact.identity.boss.scope, activityRevision: 5, eventId: 'pellet' },
        part: contact.identity, contactId: contact.contactId, x: 14, y: 15, outcomeId: 'hit' };
      host.broadcastKrakenPartHit(receipt); host.broadcastKrakenPartHit(receipt);
      expect(hits).toHaveBeenCalledOnce();
      const next = { ...kraken(), revision: 7, tentacles: [], eggs: [] };
      hostRoom.transport.links[0].fastReady = false;
      host.publishKrakenState(next); hostRoom.room.update();
      use(clientRoom); expect(client.getKrakenState()).toEqual(next);
      use(hostRoom); host.broadcastKrakenPartHit(receipt); expect(hits).toHaveBeenCalledOnce();
      host.publishKrakenState(null); hostRoom.room.update();
      use(clientRoom); expect(client.getKrakenState()).toBeNull();
      use(hostRoom); host.publishActivity({ ...activity, activityRevision: 6 }); hostRoom.room.update();
      hostRoom.room.broadcast('earea', e);
      use(clientRoom); expect(client.getKrakenState()).toBeNull(); expect(claws).toHaveBeenCalledOnce();
    } finally { clientRoom?.room.destroy(); hostRoom.room.destroy(); clearActiveSession(); }
  });
});
