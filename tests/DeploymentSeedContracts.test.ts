import { afterEach, describe, expect, it } from 'vitest';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { generateRoundWorld } from '../src/world/RoundWorldGeneration';
import { generateRoundWorldLayout } from '../src/world/RoundWorldLayout';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from './fakePeerNetwork';

function bridgeFor(room: TestRoom): NetworkBridge {
  useRoom(room);
  const bridge = new NetworkBridge();
  bridge.activate();
  return bridge;
}

function useRoom(room: TestRoom): void {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'SEED1' });
}

afterEach(() => clearActiveSession());

describe('deployment seed', () => {
  it.each(['18', '13'])('previews exactly the terrain that the round on map %s generates', (mapId) => {
    const mapConfig = getCoopDefenseMapConfig(mapId);
    const seed = 424242;
    const preview = generateRoundWorldLayout(COOP_DEFENSE_MODE, mapConfig, seed);
    const round = generateRoundWorld({ roundRevision: 7, gameMode: COOP_DEFENSE_MODE, seed,
      campaignMapConfig: mapConfig, dawn: null, worldParameters: undefined });
    expect(ArenaGenerator.fingerprint(preview)).toBe(round.world.layoutFingerprint);
  });

  it('is published by the host, rolled by a map change and handed over once per round start', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);

      useRoom(hostRoom);
      host.publishLobbySync();
      const first = host.getDeploymentSeed();
      expect(first).not.toBeNull();
      // Republishing the snapshot (join, Ready reset, ...) keeps the seed.
      host.publishLobbySync();
      expect(host.getDeploymentSeed()).toBe(first);
      useRoom(clientRoom);
      expect(client.getDeploymentSeed()).toBe(first);

      useRoom(hostRoom);
      host.setCoopDefenseMapId(host.getCoopDefenseMapId() === '18' ? '19' : '18');
      const afterMapChange = host.getDeploymentSeed();
      expect(afterMapChange).not.toBe(first);

      expect(host.hostTakeDeploymentSeed()).toBe(afterMapChange);
      const next = host.getDeploymentSeed();
      expect(next).not.toBe(afterMapChange);
      useRoom(clientRoom);
      expect(client.getDeploymentSeed()).toBe(next);
      // The seed is not part of the Ready check.
      expect(client.getLobbySyncConsistency().consistent).toBe(true);

      useRoom(hostRoom);
      host.hostSetDeploymentSeed(99);
      expect(host.hostTakeDeploymentSeed()).toBe(99);
      expect(() => host.hostSetDeploymentSeed(1.5)).toThrow();
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });
});
