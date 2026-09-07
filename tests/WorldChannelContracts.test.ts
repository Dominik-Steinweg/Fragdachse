import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from './fakePeerNetwork';
import { AdrenalineEssenceClientReplica, AdrenalineEssenceReplication } from '../src/adrenalineEssence/AdrenalineEssenceReplication';
import type { EssenceState, EssenceTransferReceipt } from '../src/adrenalineEssence/AdrenalineEssenceTypes';

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

      host.publishWorldAndActivity(world({ parameters: { persistentBaseAreaStage: 0 } }), activity());

      const client = bridgeFor(clientRoom);
      expect(client.getWorldDescriptor()).toEqual(world({ parameters: { persistentBaseAreaStage: 0 } }));
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
  it('delivers typed shot events once per broadcast and rejects stale or malformed world feedback', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      host.publishWorldAndActivity(world(), null);
      const client = bridgeFor(clientRoom);
      const received: unknown[] = [];
      client.registerShotFxHandler(event => received.push(event));
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
      const shot = { shooterId: 'shooter', weaponId: 'GLOCK', slot: 'weapon1' as const, angle: 0, sequence: 1, predictionId: 7 };
      host.broadcastShotFx(shot);
      await Promise.resolve();
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject(shot);
      hostRoom.room.broadcast('sfx', { ...shot, wr: 11, sequence: 2 });
      hostRoom.room.broadcast('sfx', { ...shot, wr: 12, angle: 'invalid' });
      await Promise.resolve();
      expect(received).toHaveLength(1);
    } finally { clearActiveSession(); }
  });

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

describe('World-Kanal – Essenz im Lobby-Testgelaende', () => {
  it('traegt null-Activity, Deltas und Latejoin durch die echte Bridge und verwirft die vorherige World', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    const useRoom = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
    const scope = { worldRevision: 12, activityRevision: null } as const;
    const publisher = new AdrenalineEssenceReplication();
    const replica = new AdrenalineEssenceClientReplica(scope);
    const state = (revision: number, value: number): EssenceState => ({
      ...scope, revision, transfers: [], clusters: value === 0 ? [] : [{
        id: '12:null:cluster:1', accessGroup: { kind: 'personal', playerId: 'p1' }, state: 'grounded',
        x: 100, y: 120, originX: 100, originY: 120, seed: 42, value,
        createdAt: 0, landAt: 200, expiresAt: 8200,
      }],
    });
    const emptyWorldState: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [],
      remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
      nukes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
      coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [],
      guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
      targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
    };
    try {
      const host = bridgeFor(hostRoom);
      host.publishLobbySync();
      host.publishWorldAndActivity(world({ definitionId: 'world:lobby' }), null);
      const client = bridgeFor(clientRoom);
      const publish = (next: EssenceState, now: number, full = false) => {
        useRoom(hostRoom);
        host.publishGameState({ ...emptyWorldState, adrenalineEssence: publisher.build(next, now, full) }, full);
        hostRoom.room.update();
        useRoom(clientRoom);
        return client.getLatestGameState()!.adrenalineEssence;
      };

      expect(replica.apply(publish(state(1, 0.125), 0, true))).toBe(true);
      expect(client.getActivityDescriptor()).toBeNull();
      expect(client.getGamePhase()).toBe('LOBBY');
      expect(replica.getState()).toMatchObject({ ...scope, clusters: [{ value: 0.125 }] });

      publish(state(2, 0), 50); // The passive replica misses this removal.
      expect(replica.apply(publish(state(3, 0.375), 100))).toBe(false);
      expect(replica.isAwaitingFull()).toBe(true);
      const receipt: EssenceTransferReceipt = {
        ...scope, id: '12:null:transfer:2', accessGroup: { kind: 'personal', playerId: 'p1' },
        playerId: 'p1', lifeRevision: 1, participationRevision: 1, status: 'committed',
        creditedValue: 0.25, returnedValue: 0, expiredValue: 0, resourceRevision: 3,
        completedAt: 900, sourceX: 100, sourceY: 120, targetX: 130, targetY: 140,
      };
      publisher.addReceipts([receipt]);
      const recoveredFull = publish(state(4, 0.125), 1000, true);
      expect(replica.apply(recoveredFull)).toBe(true);
      expect(replica.getState().clusters[0].value).toBe(0.125);
      expect(replica.drainReceipts()).toEqual([]);

      // A real joining PeerRoom gets the reliable game-state baseline without an Activity.
      const joiningRoom = await addClientRoom(network);
      const joining = bridgeFor(joiningRoom);
      const joinedReplica = new AdrenalineEssenceClientReplica(scope);
      expect(joinedReplica.apply(joining.getLatestGameState()!.adrenalineEssence)).toBe(true);
      expect(joinedReplica.getState()).toEqual(replica.getState());
      const repeatedReceipt = publish(state(4, 0.125), 1050);
      expect(replica.apply(repeatedReceipt)).toBe(true);
      expect(replica.drainReceipts()).toEqual([receipt]);
      useRoom(joiningRoom);
      expect(joinedReplica.apply(joining.getLatestGameState()!.adrenalineEssence)).toBe(true);
      expect(joinedReplica.drainReceipts()).toEqual([]);

      // Omitted slices preserve the current packet; explicit null clears the Bridge cache.
      useRoom(hostRoom);
      host.publishGameState(emptyWorldState);
      hostRoom.room.update();
      useRoom(clientRoom);
      expect(client.getLatestGameState()!.adrenalineEssence).toEqual(repeatedReceipt);
      useRoom(hostRoom);
      host.publishGameState({ ...emptyWorldState, adrenalineEssence: null });
      hostRoom.room.update();
      useRoom(clientRoom);
      expect(client.getLatestGameState()!.adrenalineEssence).toBeNull();

      expect(new AdrenalineEssenceClientReplica({ ...scope, activityRevision: 31 }).apply(recoveredFull)).toBe(false);
      useRoom(hostRoom);
      host.publishWorldAndActivity(world({ worldRevision: 13, definitionId: 'world:lobby' }), null);
      useRoom(clientRoom);
      expect(client.getLatestGameState()).toBeUndefined();
      expect(new AdrenalineEssenceClientReplica({ ...scope, worldRevision: 13 }).apply(recoveredFull)).toBe(false);
    } finally {
      clearActiveSession();
    }
  });
});
