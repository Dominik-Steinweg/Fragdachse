import { DawnScrapLedger } from '../../src/dawn/runtime/DawnScrapLedger';
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../../node_modules/phaser/src/geom/index.js', import.meta.url));
  // Phaser's installed numeric geometry has no browser dependency.
  return { Geom: require('./index'), Math: require('../math') };
});
import {
  PERSISTENT_BASE_MAX_AREA_STAGE,
  resolvePersistentBaseBuildAreaForStage,
  resolvePersistentBaseReservationRadiusCells,
} from '../../src/persistentBase/PersistentBaseCore';
import { resolveFrozenPersistentBaseAreaStage } from '../../src/persistentBase/PersistentBaseAreaStageResolution';
import { PersistentBaseRoomSession } from '../../src/persistentBase/PersistentBaseRoomSession';
import { composeDawnRoundPlans } from '../../src/dawn/composition/DawnRoundComposition';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import type { ActivityDescriptor } from '../../src/world/ActivityDescriptor';
import { generateRoundWorld, type GeneratedRoundWorld } from '../../src/world/RoundWorldGeneration';
import { prepareWorldComposition, type PreparedWorldComposition } from '../../src/world/WorldComposition';
import { WorldLifecycle } from '../../src/world/WorldLifecycle';
import type { WorldDescriptor } from '../../src/world/WorldDescriptor';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from '../fakePeerNetwork';

/**
 * Spike S2: Ein host-komponierter Dawn-Plan baut bei Host, verbundenem Client und Late Join
 * dieselbe World, und die Persistent-Base-Transaktion der Runde oeffnet.
 */
const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'DAWN01' });
const connect = (room: TestRoom) => { use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge; };

function hostComposedRound(roundRevision: number): GeneratedRoundWorld {
  const plans = composeDawnRoundPlans({ seed: roundRevision * 31, threat: 1, dayNumber: 1 });
  return generateRoundWorld({
    roundRevision,
    gameMode: 'coop_defense',
    seed: roundRevision * 31,
    campaignMapConfig: null,
    dawn: plans,
    worldParameters: {
      persistentBaseUnlocked: true,
      persistentBaseAreaStage: resolveFrozenPersistentBaseAreaStage({
        personalStage: PERSISTENT_BASE_MAX_AREA_STAGE,
        siteMaxAreaStage: PERSISTENT_BASE_MAX_AREA_STAGE,
      }),
      persistentBaseHealthRewards: [],
    },
  });
}

function composeFromReplication(room: TestRoom, bridge: NetworkBridge): PreparedWorldComposition {
  use(room);
  const descriptor = bridge.getWorldDescriptor();
  const activity = bridge.getActivityDescriptor();
  expect(descriptor?.parameters?.dawn).toBeDefined();
  expect(activity?.parameters?.dawn).toBeDefined();
  return prepareWorldComposition({
    descriptor: descriptor!,
    activity,
    roomGameMode: bridge.getGameMode(),
    humanPlayerCount: 3,
  });
}

describe('Dawn round lifecycle (S2)', () => {
  it('builds the identical Dawn world on host, connected client and late joiner', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const host = connect(hostRoom);
    const rooms: TestRoom[] = [hostRoom];
    try {
      const clientRoom = await addClientRoom(network); rooms.push(clientRoom);
      const client = connect(clientRoom);

      use(hostRoom);
      host.publishLobbySync();
      const round = hostComposedRound(4101);
      host.publishWorldAndActivity(round.world, round.activity);
      const ledger = new DawnScrapLedger(total => host.hostPublishDawnRoundScrap(total));
      ledger.reset();
      ledger.credit(17, 'site');
      ledger.credit(25, 'drop');
      hostRoom.room.update();

      const lateRoom = await addClientRoom(network); rooms.push(lateRoom);
      const late = connect(lateRoom);

      use(hostRoom);
      const hostPrepared = prepareWorldComposition({
        descriptor: round.world,
        activity: round.activity,
        roomGameMode: host.getGameMode(),
        humanPlayerCount: 3,
        preparedLayout: { descriptor: round.world, layout: round.layout },
      });
      const peers = [composeFromReplication(clientRoom, client), composeFromReplication(lateRoom, late)];
      for (const [room, bridge] of [[clientRoom, client], [lateRoom, late]] as const) {
        use(room);
        expect(bridge.getDawnRoundScrap()).toBe(42);
      }

      expect(hostPrepared.isCoopMission).toBe(true);
      expect(hostPrepared.mapConfig).toEqual(round.mapConfig);
      expect(hostPrepared.world.persistentBaseSite).not.toBeNull();
      for (const peer of peers) {
        // prepareWorldComposition throws on a fingerprint mismatch; equality makes the proof explicit.
        expect(peer.world.descriptor).toEqual(round.world);
        expect(peer.locallyGeneratedLayout).toEqual(round.layout);
        expect(peer.mapConfig).toEqual(hostPrepared.mapConfig);
        expect(peer.world.definition).toEqual(hostPrepared.world.definition);
        expect(peer.world.persistentBaseSite).toEqual(hostPrepared.world.persistentBaseSite);
        expect(peer.bases.map(({ id }) => id)).toEqual(hostPrepared.bases.map(({ id }) => id));
      }
    } finally {
      for (const room of rooms) room.room.destroy();
      clearActiveSession();
    }
  });

  it('opens the persistent base transaction of the Dawn round on the host', () => {
    const round = hostComposedRound(4102);
    const prepared = prepareWorldComposition({
      descriptor: round.world,
      activity: round.activity,
      roomGameMode: 'coop_defense',
      humanPlayerCount: 1,
      preparedLayout: { descriptor: round.world, layout: round.layout },
    });
    const site = prepared.world.persistentBaseSite;
    expect(site?.areaStage).toBe(PERSISTENT_BASE_MAX_AREA_STAGE);
    expect(site?.buildArea).toEqual(resolvePersistentBaseBuildAreaForStage(PERSISTENT_BASE_MAX_AREA_STAGE));
    expect(site?.base.persistentReservationRadiusCells)
      .toBe(resolvePersistentBaseReservationRadiusCells(PERSISTENT_BASE_MAX_AREA_STAGE));

    const session = new PersistentBaseRoomSession();
    const transaction = session.beginTransaction({
      worldRevision: round.activity.worldRevision,
      activityRevision: round.activity.activityRevision,
    });

    expect(session.hasOpenTransaction).toBe(true);
    expect(transaction.belongsTo({
      worldRevision: round.world.worldRevision,
      activityRevision: round.activity.activityRevision,
    })).toBe(true);
  });

  it('refuses mismatched Dawn content and unpaired plans before building anything', () => {
    const round = hostComposedRound(4103);
    const foreignWorld: WorldDescriptor = {
      ...round.world,
      parameters: { ...round.world.parameters, dawn: { ...round.world.parameters!.dawn!, contentHash: 'ffffffffffffffff' } },
    };
    expect(() => prepareWorldComposition({
      descriptor: foreignWorld,
      activity: round.activity,
      roomGameMode: 'coop_defense',
      humanPlayerCount: 1,
    })).toThrow('Dawn content');

    const unpaired: ActivityDescriptor = { ...round.activity, parameters: {} };
    const lifecycle = new WorldLifecycle({
      publish: () => undefined,
      publishActivity: () => undefined,
      clear: () => undefined,
      attach: () => undefined,
      detach: () => undefined,
    } as unknown as ConstructorParameters<typeof WorldLifecycle>[0]);
    expect(() => lifecycle.beginCreate(round.world, unpaired)).toThrow('disagree on their Dawn plan');
  });
});
