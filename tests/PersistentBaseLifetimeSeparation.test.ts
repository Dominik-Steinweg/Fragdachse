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
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import { ActivityRuntimeHost } from '../src/world/ActivityRuntimeHost';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { WorldLifecycle, type WorldLifecycleSink } from '../src/world/WorldLifecycle';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';

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

const WORLD: WorldDescriptor = {
  worldRevision: 21,
  definitionId: 'world:coop-defense:7',
  seed: 4242,
  generatorVersion: 3,
  layoutFingerprint: 'deadbeef',
  parameters: {
    persistentBaseUnlocked: true,
    persistentBaseAreaStage: 1,
  },
};

function activityDescriptor(activityRevision: number): ActivityDescriptor {
  return {
    activityRevision,
    worldRevision: WORLD.worldRevision,
    kind: 'coop-mission',
    definitionId: 'activity:coop-mission:7',
  };
}

function worldContext(): WorldRuntimeContext {
  return { descriptor: WORLD } as WorldRuntimeContext;
}

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

function createLifecycleSessionHarness(): {
  readonly lifecycle: WorldLifecycle;
  readonly session: PersistentBaseRoomSession;
  readonly identityBegins: number[];
  readonly identityEnds: number[];
  readonly runtimes: ActivityRuntimeHost;
} {
  const session = new PersistentBaseRoomSession();
  const identityBegins: number[] = [];
  const identityEnds: number[] = [];
  const runtimes = new ActivityRuntimeHost(WORLD.worldRevision);
  const sink: WorldLifecycleSink = {
    publish: () => {},
    publishActivity: () => {},
    clear: () => {},
    attach: () => {},
    detach: () => {},
    activityIdentity: {
      begin: (activity) => {
        identityBegins.push(activity.activityRevision);
        session.beginTransaction({
          worldRevision: activity.worldRevision,
          activityRevision: activity.activityRevision,
        });
      },
      end: (activity) => {
        identityEnds.push(activity.activityRevision);
        applyPersistentBaseRoundOutcome('rollback', {
          session,
          isRuntimeObjectAlive: () => true,
          identity: {
            worldRevision: activity.worldRevision,
            activityRevision: activity.activityRevision,
          },
        });
      },
    },
    activity: {
      attach: (activity) => {
        runtimes.attach(activity, { destroy: () => {} });
      },
      detach: () => { runtimes.detach(); },
    },
  };
  return {
    lifecycle: new WorldLifecycle(sink),
    session,
    identityBegins,
    identityEnds,
    runtimes,
  };
}

describe('PersistentBaseRoomSession – der Raum ueberlebt seine Activities', () => {
  it('haelt Owner-Bindungen ueber World-Ende und neuen World-Beginn', () => {
    const harness = createLifecycleSessionHarness();
    expect(harness.session.bindPlayerOwner('player-guest', 'owner-guest')).toBe(true);

    harness.lifecycle.beginCreate(WORLD, null);
    harness.lifecycle.endInstance();
    const nextWorld = { ...WORLD, worldRevision: WORLD.worldRevision + 1 };
    harness.lifecycle.beginCreate(nextWorld, null);

    expect(harness.session.getOwnerIdForPlayer('player-guest')).toBe('owner-guest');
    expect(harness.session.getPlayerIdForOwner('owner-guest')).toBe('player-guest');
  });

  it('haelt Owner-Bindungen ueber einen Activity-Wechsel innerhalb derselben World', () => {
    const session = new PersistentBaseRoomSession();
    expect(session.bindPlayerOwner('player-guest', 'owner-guest')).toBe(true);

    session.beginTransaction(MISSION_A);
    session.beginTransaction(MISSION_B);

    expect(session.getOwnerIdForPlayer('player-guest')).toBe('owner-guest');
    expect(session.getPlayerIdForOwner('owner-guest')).toBe('player-guest');
  });

  it('loest Leave-Bindung und Room-State, ohne den persoenlichen Save zu loeschen, und erlaubt Rejoin', () => {
    const session = new PersistentBaseRoomSession();
    const personalSave = contribution('owner-guest', [blueprint('guest-save')], 4);

    expect(session.acceptContributionOffer('player-guest', personalSave)).toBe(true);
    expect(session.removePlayerOwner('player-guest')).toEqual([]);
    expect(session.getOwnerIdForPlayer('player-guest')).toBeNull();
    expect(session.contributions.getContribution('owner-guest')).toBeNull();

    // Der Save lebt ausserhalb der RoomSession und kann nach dem Rejoin wieder angeboten werden.
    expect(personalSave.ownerId).toBe('owner-guest');
    expect(session.acceptContributionOffer('player-guest', personalSave)).toBe(true);
    expect(session.getOwnerIdForPlayer('player-guest')).toBe('owner-guest');
  });

  it('schuetzt Owner-Claims vor Kollisionen, ohne den bestehenden Room-State zu veraendern', () => {
    const session = new PersistentBaseRoomSession();
    const first = contribution('owner-guest', [blueprint('first')], 2);
    const second = contribution('owner-guest', [blueprint('collision')], 3);

    expect(session.acceptContributionOffer('player-a', first)).toBe(true);
    expect(session.acceptContributionOffer('player-b', second)).toBe(false);
    expect(session.getPlayerIdForOwner('owner-guest')).toBe('player-a');
    expect(session.getOwnerIdForPlayer('player-b')).toBeNull();
    expect(session.contributions.getContribution('owner-guest')?.constructions[0]?.persistentId)
      .toBe('first');
  });

  it('wendet gleiche und stale Contribution-Revisionen nicht doppelt an und behaelt den Ingest-Stand', () => {
    const session = new PersistentBaseRoomSession();
    const first = contribution('owner-a', [blueprint('first')], 2);
    const same = contribution('owner-a', [blueprint('first')], 2);
    const stale = contribution('owner-a', [blueprint('stale')], 1);
    const newer = contribution('owner-a', [blueprint('newer')], 3);

    expect(session.acceptContributionOffer('player-a', first)).toBe(true);
    expect(session.acceptContributionOffer('player-a', same)).toBe(false);
    expect(session.acceptContributionOffer('player-a', stale)).toBe(false);

    session.beginTransaction(MISSION_A);
    session.beginTransaction(MISSION_B);
    expect(session.acceptContributionOffer('player-a', same)).toBe(false);
    expect(session.acceptContributionOffer('player-a', newer)).toBe(true);
    expect(session.getOwnerIdForPlayer('player-a')).toBe('owner-a');
    expect(session.contributions.getCommittedContribution('owner-a')?.revision).toBe(3);
  });

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
  it('akzeptiert Mutationen nur fuer die offene Activity und erlaubt danach nur Lobby-Requests', () => {
    const session = new PersistentBaseRoomSession();
    session.beginTransaction(MISSION_A);

    expect(session.acceptsMutation(MISSION_A)).toBe(true);
    expect(session.acceptsMutation({ worldRevision: WORLD.worldRevision })).toBe(false);
    expect(session.acceptsMutation(MISSION_B)).toBe(false);
    expect(session.acceptsMutation({
      worldRevision: WORLD.worldRevision,
      activityRevision: Number.NaN,
    })).toBe(false);

    session.completeTransaction('rollback', () => true, MISSION_A);
    expect(session.acceptsMutation({ worldRevision: WORLD.worldRevision })).toBe(true);
    expect(session.acceptsMutation(MISSION_A)).toBe(false);
  });

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

describe('PersistentBaseTransaction – Activity-Identity folgt dem echten World-Lifecycle', () => {
  it('beendet A und oeffnet B innerhalb derselben World ohne A-Working-State', () => {
    const harness = createLifecycleSessionHarness();
    const store = harness.session.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('committed')], 4));

    harness.lifecycle.beginCreate(WORLD, activityDescriptor(MISSION_A.activityRevision));
    harness.lifecycle.attachRuntime(worldContext());
    const transactionA = harness.session.transaction;
    expect(transactionA?.identity).toEqual(MISSION_A);
    store.registerNew('owner-a', runtime(1, 11), tool, footprint, anchor, buildArea);

    harness.lifecycle.beginCreate(WORLD, activityDescriptor(MISSION_B.activityRevision));

    expect(transactionA?.isOpen).toBe(false);
    expect(transactionA?.outcome).toBe('rollback');
    expect(harness.session.transaction?.identity).toEqual(MISSION_B);
    expect(store.getContribution('owner-a')?.constructions.map((entry) => entry.persistentId))
      .toEqual(['committed']);
    expect(harness.identityBegins).toEqual([MISSION_A.activityRevision, MISSION_B.activityRevision]);
    expect(harness.identityEnds).toEqual([MISSION_A.activityRevision]);
  });

  it('rollt A bei Activity-los zurueck und schreibt danach wieder committed', () => {
    const harness = createLifecycleSessionHarness();
    const store = harness.session.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('committed')], 4));

    harness.lifecycle.beginCreate(WORLD, activityDescriptor(MISSION_A.activityRevision));
    harness.lifecycle.attachRuntime(worldContext());
    store.registerNew('owner-a', runtime(1, 11), tool, footprint, anchor, buildArea);

    harness.lifecycle.beginCreate(WORLD, null);

    expect(harness.session.hasOpenTransaction).toBe(false);
    expect(store.hasActiveMission).toBe(false);
    store.registerNew('owner-a', runtime(2, 11), tool, footprint, anchor, buildArea);
    expect(store.getCommittedContribution('owner-a')?.constructions.map((entry) => entry.persistentId))
      .toEqual(['committed', 'pb-owner-a-5-1']);
    expect(harness.identityEnds).toEqual([MISSION_A.activityRevision]);
  });

  it('behaelt dieselbe Transaction bei lokalem ActivityRuntime-Detach und Reattach', () => {
    const harness = createLifecycleSessionHarness();
    harness.lifecycle.beginCreate(WORLD, activityDescriptor(MISSION_A.activityRevision));
    harness.lifecycle.attachRuntime(worldContext());
    const transaction = harness.session.transaction;

    harness.lifecycle.detachRuntime();
    expect(harness.lifecycle.activity.descriptor?.activityRevision).toBe(MISSION_A.activityRevision);
    expect(harness.session.transaction).toBe(transaction);
    expect(harness.session.hasOpenTransaction).toBe(true);

    harness.lifecycle.attachRuntime(worldContext());
    expect(harness.session.transaction).toBe(transaction);
    expect(harness.identityBegins).toEqual([MISSION_A.activityRevision]);
    expect(harness.identityEnds).toEqual([]);
    expect(harness.runtimes.isAttached()).toBe(true);
  });

  it('behandelt wiederholtes Synchronisieren derselben Activity-Identity idempotent', () => {
    const harness = createLifecycleSessionHarness();
    const activity = activityDescriptor(MISSION_A.activityRevision);
    harness.lifecycle.attachRuntime(worldContext(), activity);
    const transaction = harness.session.transaction;

    harness.lifecycle.syncObservedActivity({ ...activity });
    harness.lifecycle.syncObservedActivity({ ...activity });

    expect(harness.session.transaction).toBe(transaction);
    expect(harness.identityBegins).toEqual([MISSION_A.activityRevision]);
    expect(harness.identityEnds).toEqual([]);
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

  it('haelt fachliche Player-Owner-Bindungen und Contribution-Ingest im Room-Owner', () => {
    const session = readFileSync(
      resolve(process.cwd(), 'src/persistentBase/PersistentBaseRoomSession.ts'),
      'utf8',
    );
    expect(session).toContain('private readonly persistentBaseOwnerByPlayerId');
    expect(session).toContain('private readonly ingestedContributionRevisions');
    expect(session).toContain('bindPlayerOwner(');
    expect(session).toContain('acceptContributionOffer(');
    expect(session).toContain('removePlayerOwner(');
    expect(coordinator).not.toContain('private readonly persistentBaseOwnerByPlayerId');
    expect(coordinator).not.toContain('private readonly ingestedContributionRevisions');
    expect(coordinator).not.toContain('private canClaimPersistentBaseOwnerId(');
  });

  it('kennzeichnet Reward-Revision und Signatur als reine Projection-Caches', () => {
    expect(coordinator).toContain('private persistentBaseRewardProjectionRevision = 0;');
    expect(coordinator).toContain('private persistentBaseRewardProjectionSignature: string | null = null;');
    expect(coordinator).not.toContain('persistentBaseRewardSessionRevision');
    expect(coordinator).not.toContain('persistentBaseRewardSessionSignature');
  });

  it('oeffnet den Arbeitsstand mit der Identitaet der Activity und schliesst ihn damit ab', () => {
    expect(coordinator).toContain('this.persistentBaseSession.beginTransaction({');
    expect(coordinator).toContain('identity: this.resolvePersistentBaseTransactionIdentity(),');
    expect(coordinator).toContain('private resolvePersistentBaseTransactionIdentity(): PersistentBaseTransactionIdentity | undefined {');
    expect(coordinator).toContain('activityIdentity: {');
    expect(coordinator).toContain('private beginPersistentBaseTransaction(activity: ActivityDescriptor): void {');
    expect(coordinator).toContain('private endPersistentBaseTransaction(activity: ActivityDescriptor): void {');
    const buildStart = coordinator.indexOf('  buildWorld(');
    const buildEnd = coordinator.indexOf('  tearDownArena(', buildStart);
    expect(coordinator.slice(buildStart, buildEnd)).not.toContain('beginTransaction(');
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
