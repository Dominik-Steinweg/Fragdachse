import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { createFakePhaserModule } = await import('./fakeArenaRenderScene');
  return createFakePhaserModule();
});

import { RockGridIndex } from '../src/arena/RockGridIndex';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';
import {
  COOP_DEFENSE_MANAGEMENT_COOLDOWN_MS,
  getCoopDefenseConstructionDefinition,
} from '../src/config/coopDefenseConstructions';
import { PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION } from '../src/config/persistentBase';
import { ConstructionReadinessRuntime } from '../src/world/ConstructionReadinessRuntime';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA } from '../src/persistentBase/PersistentBaseCore';
import { PersistentBaseContributionStore } from '../src/persistentBase/PersistentBaseContributionStore';
import { PersistentBaseRoomSession } from '../src/persistentBase/PersistentBaseRoomSession';
import { sanitizePersistentBaseMoveRequest } from '../src/persistentBase/PersistentBaseMove';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import type { ArenaLayout, SyncedPlaceableRock } from '../src/types';
import type { PersistentConstruction, PersistentPlayerBaseContribution } from '../src/persistentBase/PersistentBaseTypes';

const OWNER_ID = 'owner-a';
const ANCHOR = { gridX: 20, gridY: 20 } as const;
const SINGLE_CELL = [{ dx: 0, dy: 0 }] as const;

function makeLayout(): ArenaLayout {
  return { seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [] };
}

function createPlacement(): PlacementSystem {
  const layout = makeLayout();
  return new PlacementSystem(
    layout,
    new RockGridIndex(layout.rocks),
    { getAllPlayers: () => [] } as never,
    resolveActiveArenaWorldMetrics(),
  );
}

function worldPoint(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: ARENA_OFFSET_X + CELL_SIZE * (gridX + 0.5),
    y: ARENA_OFFSET_Y + CELL_SIZE * (gridY + 0.5),
  };
}

function placeRock(
  placement: PlacementSystem,
  gridX: number,
  gridY: number,
  overrides: Partial<SyncedPlaceableRock> = {},
): SyncedPlaceableRock {
  const target = worldPoint(gridX, gridY);
  const rock = placement.tryPlaceConstruction(
    getCoopDefenseConstructionDefinition('rock_barrier'),
    200,
    overrides.ownerId ?? OWNER_ID,
    0xffffff,
    target.x,
    target.y,
    target.x,
    target.y,
  );
  if (!rock) throw new Error('setup failed: construction was not placed');
  return rock;
}

function blueprint(overrides: Partial<PersistentConstruction> = {}): PersistentConstruction {
  return {
    persistentId: 'pb-owner-a-1-0',
    tool: { kind: 'construction', id: 'rock_barrier' },
    relativeGridX: 1,
    relativeGridY: 0,
    angle: 0.25,
    placementOrder: 7,
    ...overrides,
  };
}

function contributionWith(construction: PersistentConstruction): PersistentPlayerBaseContribution {
  return {
    schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
    ownerId: OWNER_ID,
    revision: 3,
    constructions: [construction],
  };
}

/** Die Instanz, zu der ein Arbeitsstand in diesen Tests gehoert. */
const MISSION = { worldRevision: 21, activityRevision: 7 } as const;

describe('PlacementSystem – atomarer Relocate-Pfad', () => {
  it('behaelt Runtime-ID, HP und Besitz und gibt die Quellzelle frei', () => {
    const placement = createPlacement();
    const rock = placeRock(placement, 20, 20);
    placement.applyDamage(rock.id, 60);

    const relocated = placement.relocateRock(rock.id, 22, 21, 1.5, SINGLE_CELL);

    expect(relocated).toMatchObject({
      id: rock.id,
      hp: 140,
      maxHp: 200,
      ownerId: OWNER_ID,
      gridX: 22,
      gridY: 21,
      angle: 1.5,
    });
    expect(placement.getRuntimeRockAt(20, 20)).toBeUndefined();
    expect(placement.getRuntimeRockAt(22, 21)?.id).toBe(rock.id);
    expect(placement.getAllRuntimeRocks()).toHaveLength(1);
  });

  it('laesst die Quelle unveraendert, wenn das Ziel bereits belegt ist', () => {
    const placement = createPlacement();
    const source = placeRock(placement, 20, 20);
    placeRock(placement, 22, 20);

    expect(placement.relocateRock(source.id, 22, 20, 0, SINGLE_CELL)).toBeUndefined();
    expect(placement.getRuntimeRockAt(20, 20)?.id).toBe(source.id);
    expect(placement.getAllRuntimeRocks()).toHaveLength(2);
  });

  it('ignoriert bei der Zielpruefung genau die eigene Belegung der Quelle', () => {
    const placement = createPlacement();
    const source = placeRock(placement, 20, 20);
    const origin = worldPoint(20, 20);
    const definition = getCoopDefenseConstructionDefinition('rock_barrier');

    const withoutSource = placement.getConstructionPlacementPreview(
      definition,
      origin.x,
      origin.y,
      origin.x,
      origin.y,
    );
    const withSource = placement.getConstructionPlacementPreview(
      definition,
      origin.x,
      origin.y,
      origin.x,
      origin.y,
      source.id,
    );

    expect(withoutSource?.isValid).toBe(false);
    expect(withSource?.isValid).toBe(true);
    // Jede andere Occupancy-Regel bleibt in Kraft: ein fremdes Objekt bleibt ein Konflikt.
    const foreign = placeRock(placement, 22, 20);
    const foreignCell = worldPoint(22, 20);
    expect(placement.getConstructionPlacementPreview(
      definition,
      origin.x,
      origin.y,
      foreignCell.x,
      foreignCell.y,
      source.id,
    )?.isValid).toBe(false);
    expect(foreign.id).not.toBe(source.id);
  });

  it('meldet eine Positionsaenderung als Relocate an die Client-Darstellung', () => {
    const host = createPlacement();
    const client = createPlacement();
    const rock = placeRock(host, 20, 20);
    client.syncFromSnapshot(host.getNetSnapshot());

    host.relocateRock(rock.id, 23, 20, 0, SINGLE_CELL);
    const changes = client.syncFromSnapshot(host.getNetSnapshot());

    expect(changes.updated).toEqual([]);
    expect(changes.relocated).toHaveLength(1);
    expect(changes.relocated[0].previous).toMatchObject({ id: rock.id, gridX: 20, gridY: 20 });
    expect(changes.relocated[0].next).toMatchObject({ id: rock.id, gridX: 23, gridY: 20 });
    expect(client.getRuntimeRockAt(20, 20)).toBeUndefined();
    expect(client.getRuntimeRockAt(23, 20)?.id).toBe(rock.id);
  });
});

describe('PersistentBaseContributionStore – Move-Mutation', () => {
  it('erhaelt persistentId, Owner und placementOrder und aendert nur Position und Winkel', () => {
    const store = new PersistentBaseRoomSession().contributions;
    const construction = blueprint();
    store.offerContribution(contributionWith(construction));
    store.registerRestored(OWNER_ID, construction, 42);

    const moved = store.moveConstruction(
      OWNER_ID,
      construction.persistentId,
      { relativeGridX: -1, relativeGridY: 1, angle: 2 },
      SINGLE_CELL,
      DEFAULT_PERSISTENT_BASE_BUILD_AREA,
    );

    expect(moved).toEqual({
      persistentId: construction.persistentId,
      tool: { kind: 'construction', id: 'rock_barrier' },
      relativeGridX: -1,
      relativeGridY: 1,
      angle: 2,
      placementOrder: 7,
    });
    expect(store.getContribution(OWNER_ID)?.constructions).toEqual([moved]);
    // Dieselbe Runtime traegt weiterhin denselben Blueprint, jetzt mit aktueller Position.
    expect(store.getRuntimeBindings()).toEqual([
      { runtimeId: 42, ownerId: OWNER_ID, blueprint: moved },
    ]);
  });

  it('lehnt ein Ziel ausserhalb des Baubereichs ab und laesst den Beitrag unveraendert', () => {
    const store = new PersistentBaseRoomSession().contributions;
    const construction = blueprint();
    store.offerContribution(contributionWith(construction));

    expect(store.moveConstruction(
      OWNER_ID,
      construction.persistentId,
      { relativeGridX: 9, relativeGridY: 0, angle: 0 },
      SINGLE_CELL,
      DEFAULT_PERSISTENT_BASE_BUILD_AREA,
    )).toBeNull();
    expect(store.getContribution(OWNER_ID)?.constructions).toEqual([construction]);
  });

  it('kennt keinen fremden Blueprint als Move-Quelle', () => {
    const store = new PersistentBaseRoomSession().contributions;
    const construction = blueprint();
    store.offerContribution(contributionWith(construction));

    expect(store.moveConstruction(
      'owner-b',
      construction.persistentId,
      { relativeGridX: 0, relativeGridY: 0, angle: 0 },
      SINGLE_CELL,
      DEFAULT_PERSISTENT_BASE_BUILD_AREA,
    )).toBeNull();
    expect(store.getContribution(OWNER_ID)?.constructions).toEqual([construction]);
  });

  it('haelt einen Missions-Move im Arbeitsstand, bis der Rundenausgang entscheidet', () => {
    const construction = blueprint();
    const move = (store: PersistentBaseContributionStore): void => {
      expect(store.moveConstruction(
        OWNER_ID,
        construction.persistentId,
        { relativeGridX: -1, relativeGridY: -1, angle: 0 },
        SINGLE_CELL,
        DEFAULT_PERSISTENT_BASE_BUILD_AREA,
      )).not.toBeNull();
    };

    const defeatedSession = new PersistentBaseRoomSession();

    const defeated = defeatedSession.contributions;
    defeated.offerContribution(contributionWith(construction));
    defeatedSession.beginTransaction(MISSION);
    move(defeated);
    defeatedSession.completeTransaction('rollback', () => true);
    expect(defeated.getContribution(OWNER_ID)?.constructions).toEqual([construction]);

    const wonSession = new PersistentBaseRoomSession();

    const won = wonSession.contributions;
    won.offerContribution(contributionWith(construction));
    wonSession.beginTransaction(MISSION);
    move(won);
    expect(wonSession.completeTransaction('commit', () => true)[0].constructions).toEqual([
      { ...construction, relativeGridX: -1, relativeGridY: -1, angle: 0 },
    ]);
  });
});

describe('Management-Cooldown', () => {
  it('schuetzt Verschieben und Einzel-Rueckbau je fuer 100 ms und getrennt voneinander', () => {
    const readiness = new ConstructionReadinessRuntime();
    readiness.markManagementActionUsed('p1', 'reposition', 1_000);

    expect(COOP_DEFENSE_MANAGEMENT_COOLDOWN_MS).toBe(100);
    expect(readiness.isManagementActionOnCooldown('p1', 'reposition', 1_050)).toBe(true);
    expect(readiness.isManagementActionOnCooldown('p1', 'reposition', 1_100)).toBe(false);
    expect(readiness.isManagementActionOnCooldown('p1', 'dismantle', 1_050)).toBe(false);
    expect(readiness.isManagementActionOnCooldown('p2', 'reposition', 1_050)).toBe(false);
    expect(readiness.getManagementActionCooldownUntil('p1', 'reposition')).toBe(1_100);
  });

  it('gibt allen permanenten Coop-Defense-Constructions denselben 100-ms-Build-Cooldown', () => {
    const sporeTurret = getCoopDefenseConstructionDefinition('spore_turret');
    expect(sporeTurret.buildCooldownMs).toBe(100);
    // Der Spore-Turret bleibt dabei ausdruecklich permanent.
    expect(sporeTurret.kind).toBe('turret');
    expect(getCoopDefenseConstructionDefinition('rocket_turret').buildCooldownMs).toBe(100);
  });
});

describe('Move-Request an der Netzwerkgrenze', () => {
  it('akzeptiert nur vollstaendige, ganzzahlige Quell- und Zielangaben', () => {
    const valid = {
      worldRevision: 12,
      sourceRuntimeId: 5,
      sourceGridX: 20,
      sourceGridY: 21,
      targetGridX: 22,
      targetGridY: 21,
    };
    expect(sanitizePersistentBaseMoveRequest(valid)).toEqual(valid);
    expect(sanitizePersistentBaseMoveRequest({ ...valid, activityRevision: 7 })).toEqual({
      ...valid,
      activityRevision: 7,
    });
    // Der Winkel gehoert nicht zur Anfrage; der Host leitet ihn aus seiner eigenen Vorschau ab.
    expect(sanitizePersistentBaseMoveRequest({ ...valid, angle: 0.5 })).toEqual(valid);
    expect(sanitizePersistentBaseMoveRequest({ ...valid, targetGridX: 1.5 })).toBeNull();
    expect(sanitizePersistentBaseMoveRequest({ ...valid, sourceRuntimeId: -1 })).toBeNull();
    expect(sanitizePersistentBaseMoveRequest({ ...valid, worldRevision: undefined })).toBeNull();
    expect(sanitizePersistentBaseMoveRequest({ ...valid, activityRevision: 0 })).toBeNull();
    expect(sanitizePersistentBaseMoveRequest({ ...valid, activityRevision: '7' })).toBeNull();
    expect(sanitizePersistentBaseMoveRequest(null)).toBeNull();
  });
});
