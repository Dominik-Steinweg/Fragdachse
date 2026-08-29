import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from './fakePeerNetwork';

/**
 * Der eine kanonische World-Kanal.
 *
 * Mission, PvP und jede spaetere friedliche World beschreiben ihre Welt ueber denselben Kanal.
 * Die Activity liegt daneben und gilt nur zusammen mit ihrer World-Instanz.
 */

const WORLD_KEY = 'wld';
const ACTIVITY_KEY = 'act';

function bridgeFor(room: TestRoom): NetworkBridge {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
  const bridge = new NetworkBridge();
  bridge.activate();
  return bridge;
}

function world(overrides: Partial<WorldDescriptor> = {}): WorldDescriptor {
  return {
    worldRevision: 12,
    definitionId: 'world:coop-defense:7',
    seed: 4242,
    generatorVersion: 3,
    layoutFingerprint: 'deadbeef',
    ...overrides,
  };
}

function activity(overrides: Partial<ActivityDescriptor> = {}): ActivityDescriptor {
  return {
    activityRevision: 31,
    worldRevision: 12,
    kind: 'coop-mission',
    definitionId: 'activity:coop-mission:7',
    ...overrides,
  };
}

async function createRoom(playerCount: number): Promise<TestRoom[]> {
  const network = new FakeNetwork();
  const rooms = [await createHostRoom(network)];
  for (let i = 1; i < playerCount; i += 1) rooms.push(await addClientRoom(network));
  return rooms;
}

describe('World-Kanal – Replikation', () => {
  it('repliziert World und Activity getrennt an jeden Peer, auch an Nachzuegler', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      expect(host.getWorldDescriptor()).toBeNull();

      host.publishWorldAndActivity(world({ parameters: { persistentBaseRadiusCells: 6 } }), activity());

      const client = bridgeFor(clientRoom);
      expect(client.getWorldDescriptor()).toEqual(world({ parameters: { persistentBaseRadiusCells: 6 } }));
      expect(client.getActivityDescriptor()).toEqual(activity());
      // Genau ein World-Kanal: der frueher parallel gefuehrte Arena-Descriptor existiert nicht mehr.
      expect(clientRoom.room.getGlobal('ard')).toBeUndefined();
      expect(clientRoom.room.getGlobal(WORLD_KEY)).toBeDefined();
      expect(clientRoom.room.getGlobal(ACTIVITY_KEY)).toBeDefined();
    } finally {
      clearActiveSession();
    }
  });

  it('gibt eine World ohne Activity als regulaeren Zustand wieder', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), null);

      const client = bridgeFor(clientRoom);
      expect(client.getWorldDescriptor()).toEqual(world());
      expect(client.getActivityDescriptor()).toBeNull();
    } finally {
      clearActiveSession();
    }
  });

  it('veraendert eine nachtraegliche Lobby-Auswahl die bestehende World und Activity nicht', async () => {
    const [hostRoom] = await createRoom(1);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), activity());
      const expectedWorld = host.getWorldDescriptor();
      const expectedActivity = host.getActivityDescriptor();

      host.setCoopDefenseMapId('17');
      host.setGameMode('deathmatch');

      expect(host.getCoopDefenseMapId()).toBe('17');
      expect(host.getGameMode()).toBe('deathmatch');
      expect(host.getWorldDescriptor()).toEqual(expectedWorld);
      expect(host.getActivityDescriptor()).toEqual(expectedActivity);
    } finally {
      clearActiveSession();
    }
  });

  it('beendet die World-Instanz vollstaendig', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), activity());
      host.clearWorldAndActivity();

      const client = bridgeFor(clientRoom);
      expect(client.getWorldDescriptor()).toBeNull();
      expect(client.getActivityDescriptor()).toBeNull();
    } finally {
      clearActiveSession();
    }
  });
});

describe('World-Kanal – Host-Autoritaet und Verwerfungsregel', () => {
  it('laesst keine Activity zu, die zu einer anderen World-Instanz gehoert', async () => {
    const [hostRoom] = await createRoom(1);
    try {
      const host = bridgeFor(hostRoom);
      expect(() => host.publishWorldAndActivity(world(), activity({ worldRevision: 13 })))
        .toThrow(/world revision/);
      expect(host.getWorldDescriptor()).toBeNull();
    } finally {
      clearActiveSession();
    }
  });

  it('verwirft eine Activity der Vorinstanz, die noch auf dem Draht liegt', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world({ worldRevision: 13 }), activity({ worldRevision: 13 }));
      // Verspaetetes reliable Paket der World 12 – direkt auf dem Draht.
      hostRoom.room.setGlobal(ACTIVITY_KEY, activity({ worldRevision: 12 }), true);

      const client = bridgeFor(clientRoom);
      expect(client.getWorldDescriptor()?.worldRevision).toBe(13);
      expect(client.getActivityDescriptor()).toBeNull();
    } finally {
      clearActiveSession();
    }
  });

  it('verwirft unbrauchbare World-Nutzlast an der Netzwerkgrenze', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      hostRoom.room.setGlobal(WORLD_KEY, { worldRevision: 0, definitionId: '' }, true);
      const client = bridgeFor(clientRoom);
      expect(client.getWorldDescriptor()).toBeNull();
      // Ohne gueltige World gibt es auch keine Activity, egal was daneben liegt.
      expect(client.getActivityDescriptor()).toBeNull();
    } finally {
      clearActiveSession();
    }
  });

  it('laesst einen Client die World weder erzeugen noch zerstoeren', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), activity());

      const client = bridgeFor(clientRoom);
      client.publishWorldAndActivity(world({ worldRevision: 99 }), activity({ worldRevision: 99 }));
      client.clearWorldAndActivity();
      expect(client.getWorldDescriptor()?.worldRevision).toBe(12);

      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
      expect(host.getWorldDescriptor()?.worldRevision).toBe(12);
    } finally {
      clearActiveSession();
    }
  });
});
