import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION } from '../src/config/persistentBase';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA } from '../src/persistentBase/PersistentBaseCore';
import { PersistentBaseRoomSession } from '../src/persistentBase/PersistentBaseRoomSession';
import { PersistentBaseRuntimeBindings } from '../src/persistentBase/PersistentBaseRuntimeBindings';
import {
  applyPersistentBaseRoundOutcome,
  resolvePersistentBaseRoundOutcome,
} from '../src/persistentBase/PersistentBaseRoundOutcome';
import type {
  PersistentConstruction,
  PersistentPlayerBaseContribution,
} from '../src/persistentBase/PersistentBaseTypes';
import type { SyncedPlaceableRock } from '../src/types';

/**
 * Phase 8: Drei Lifetimes, drei Owner.
 *
 * - committed Raumstand: `PersistentBaseRoomSession` – ueberlebt jede World und jede Activity;
 * - Arbeitsstand: `PersistentBaseTransaction` – endet mit ihrer Activity, genau einmal;
 * - Runtime-Objekte: `PersistentBaseRuntimeBindings` der World – enden mit ihr.
 */

const anchor = { gridX: 10, gridY: 10 };
const buildArea = DEFAULT_PERSISTENT_BASE_BUILD_AREA;
const footprint = [{ dx: 0, dy: 0 }] as const;
const tool = { kind: 'construction', id: 'rock_barrier' } as const;

const MISSION_A = { worldRevision: 21, activityRevision: 7 } as const;
const MISSION_B = { worldRevision: 21, activityRevision: 8 } as const;

function runtime(id: number, gridX: number): SyncedPlaceableRock {
  return {
    id,
    kind: 'rock',
    gridX,
    gridY: 10,
    hp: 100,
    maxHp: 100,
    ownerId: 'owner-a',
    ownerColor: 0xffffff,
    expiresAt: 0,
    warningStartsAt: 0,
    angle: 0,
    toolRef: tool,
  };
}

function blueprint(persistentId: string, relativeGridX = 1): PersistentConstruction {
  return {
    persistentId,
    tool: { kind: 'construction', id: 'rock_barrier' },
    relativeGridX,
    relativeGridY: 0,
    angle: 0,
    placementOrder: 0,
  };
}

function contribution(
  ownerId: string,
  constructions: readonly PersistentConstruction[],
  revision = 1,
): PersistentPlayerBaseContribution {
  return {
    schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
    ownerId,
    revision,
    constructions: [...constructions],
  };
}

describe('PersistentBaseRoomSession – der Raum ueberlebt seine Activities', () => {
  it('haelt den committed Stand und oeffnet je Activity genau einen Arbeitsstand', () => {
    const session = new PersistentBaseRoomSession();
    const store = session.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('lobby')], 4));

    expect(session.hasOpenTransaction).toBe(false);
    const first = session.beginTransaction(MISSION_A);
    // Dieselbe Instanz eroeffnet keinen zweiten Arbeitsstand.
    expect(session.beginTransaction(MISSION_A)).toBe(first);
    expect(first.identity).toEqual(MISSION_A);
    expect(store.hasActiveMission).toBe(true);

    store.registerNew('owner-a', runtime(1, 11), tool, footprint, anchor, buildArea);
    // Der committed Stand bleibt unberuehrt, solange die Activity laeuft.
    expect(store.getCommittedContribution('owner-a')?.constructions).toHaveLength(1);
    expect(store.getContribution('owner-a')?.constructions).toHaveLength(2);

    session.completeTransaction('rollback', () => true);
    expect(session.hasOpenTransaction).toBe(false);
    expect(first.isOpen).toBe(false);
    expect(first.outcome).toBe('rollback');
    expect(store.getContribution('owner-a')?.constructions).toHaveLength(1);
  });

  it('verwirft den Arbeitsstand einer anderen Instanz, bevor eine neue Activity ihren oeffnet', () => {
    const session = new PersistentBaseRoomSession();
    const store = session.contributions;
    const abandoned = session.beginTransaction(MISSION_A);
    store.registerNew('owner-a', runtime(1, 11), tool, footprint, anchor, buildArea);

    const next = session.beginTransaction(MISSION_B);
    expect(next).not.toBe(abandoned);
    expect(abandoned.isOpen).toBe(false);
    expect(abandoned.outcome).toBe('rollback');
    // Der Bau der aufgegebenen Activity ist in der neuen nicht mehr da.
    expect(store.getContribution('owner-a')).toBeNull();
  });
});

describe('PersistentBaseTransaction – genau ein terminaler Abschluss', () => {
  it('bucht denselben Arbeitsstand kein zweites Mal', () => {
    const session = new PersistentBaseRoomSession();
    const store = session.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('kept')], 4));
    session.beginTransaction(MISSION_A);

    const confirmed = applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome('victory'), {
      session,
      isRuntimeObjectAlive: () => true,
      identity: MISSION_A,
    });
    expect(confirmed).toHaveLength(1);
    expect(store.getCommittedContribution('owner-a')?.revision).toBe(5);

    expect(applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome('victory'), {
      session,
      isRuntimeObjectAlive: () => true,
      identity: MISSION_A,
    })).toEqual([]);
    expect(store.getCommittedContribution('owner-a')?.revision).toBe(5);
  });

  it('laesst einen verspaeteten Abschluss die neue Activity nicht erreichen', () => {
    const session = new PersistentBaseRoomSession();
    const store = session.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('kept')], 4));

    session.beginTransaction(MISSION_A);
    applyPersistentBaseRoundOutcome('rollback', {
      session,
      isRuntimeObjectAlive: () => true,
      identity: MISSION_A,
    });

    // Die naechste Activity oeffnet ihren eigenen Arbeitsstand ...
    session.beginTransaction(MISSION_B);
    store.registerNew('owner-a', runtime(1, 11), tool, footprint, anchor, buildArea);

    // ... und der verspaetete Abschluss der vorherigen trifft ihn nicht.
    expect(applyPersistentBaseRoundOutcome('commit', {
      session,
      isRuntimeObjectAlive: () => true,
      identity: MISSION_A,
    })).toEqual([]);
    expect(session.hasOpenTransaction).toBe(true);
    expect(store.getCommittedContribution('owner-a')?.revision).toBe(4);

    // Der eigene Abschluss wirkt weiterhin.
    expect(applyPersistentBaseRoundOutcome('commit', {
      session,
      isRuntimeObjectAlive: () => true,
      identity: MISSION_B,
    })).toHaveLength(1);
    expect(store.getCommittedContribution('owner-a')?.constructions).toHaveLength(2);
  });
});

describe('PersistentBaseRuntimeBindings – die Objekte gehoeren der World', () => {
  it('verliert mit der World ihre Objekte, aber nie die Blueprints', () => {
    const session = new PersistentBaseRoomSession();
    const store = session.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('restored')], 4));
    session.beginTransaction(MISSION_A);

    const world = new PersistentBaseRuntimeBindings();
    session.useWorldRuntimes(world);
    store.registerRestored('owner-a', blueprint('restored'), 42);
    expect(store.isMaterialized('owner-a', 'restored')).toBe(true);
    expect(world.entries().map((entry) => entry.runtimeId)).toEqual([42]);

    // Die World endet: Ihre Objekte fallen, der Besitz bleibt.
    world.clear();
    session.useWorldRuntimes(null);
    expect(store.isMaterialized('owner-a', 'restored')).toBe(false);
    expect(store.getContribution('owner-a')?.constructions).toHaveLength(1);
    // Ohne Runtime-Objekt gilt ein Blueprint als dormant und ueberlebt den Sieg unveraendert.
    expect(session.completeTransaction('commit', () => false)[0]?.constructions
      .map((entry) => entry.persistentId)).toEqual(['restored']);
  });

  it('schliesst den Bestand der endenden World gegen den Arbeitsstand ab', () => {
    const session = new PersistentBaseRoomSession();
    const store = session.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('destroyed')], 4));
    session.beginTransaction(MISSION_A);
    const world = new PersistentBaseRuntimeBindings();
    session.useWorldRuntimes(world);
    store.registerRestored('owner-a', blueprint('destroyed'), 7);

    // Das Objekt hat die Runde nicht ueberlebt; sein Blueprint faellt aus dem Arbeitsstand.
    session.finalizeWorldRuntimeObjects(() => false);
    expect(store.getContribution('owner-a')?.constructions).toEqual([]);
  });
});

describe('Phase 8 – Ownership im Koordinator', () => {
  const coordinator = readFileSync(
    resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
    'utf8',
  );

  it('fuehrt genau einen Raum-Owner statt zweier loser Speicher', () => {
    expect(coordinator).toContain('private readonly persistentBaseSession = new PersistentBaseRoomSession();');
    expect(coordinator).not.toContain('new PersistentBaseContributionStore()');
    expect(coordinator).not.toContain('new PersistentBaseRewardStore()');
  });

  it('oeffnet den Arbeitsstand mit der Identitaet der Activity und schliesst ihn damit ab', () => {
    expect(coordinator).toContain('this.persistentBaseSession.beginTransaction({');
    expect(coordinator).toContain('identity: this.resolvePersistentBaseTransactionIdentity(),');
    expect(coordinator).toContain('private resolvePersistentBaseTransactionIdentity(): PersistentBaseTransactionIdentity | undefined {');
  });

  it('bindet die Runtime-Objekte an die World-Instanz', () => {
    expect(coordinator).toContain('this.persistentBaseSession.useWorldRuntimes(persistentBaseBinding.constructionRuntimes);');
    expect(coordinator).toContain('this.persistentBaseSession.useWorldRuntimes(null);');
    const worldBinding = readFileSync(
      resolve(process.cwd(), 'src/world/PersistentBaseWorldBinding.ts'),
      'utf8',
    );
    expect(worldBinding).toContain('private readonly constructionRuntimeBindings = new PersistentBaseRuntimeBindings();');
    expect(worldBinding).toContain('this.constructionRuntimeBindings.clear();');
  });

  it('haelt die drei Lifetimes in getrennten Modulen', () => {
    const contributionStore = readFileSync(
      resolve(process.cwd(), 'src/persistentBase/PersistentBaseContributionStore.ts'),
      'utf8',
    );
    // Kein eigener Arbeitsstand und keine eigenen Runtime-Objekte mehr: beides gehoert anderen.
    expect(contributionStore).not.toContain('private baseline:');
    expect(contributionStore).not.toContain('private working:');
    expect(contributionStore).not.toContain('runtimeBlueprints');
    const rewardStore = readFileSync(
      resolve(process.cwd(), 'src/persistentBase/PersistentBaseRewardStore.ts'),
      'utf8',
    );
    expect(rewardStore).not.toContain('private baseline:');
    expect(rewardStore).not.toContain('private working:');
  });
});
