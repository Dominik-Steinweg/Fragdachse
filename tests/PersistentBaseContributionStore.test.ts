import { describe, expect, it } from 'vitest';
import { PersistentBaseContributionStore } from '../src/persistentBase/PersistentBaseContributionStore';
import { PersistentBaseRoomSession } from '../src/persistentBase/PersistentBaseRoomSession';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA } from '../src/persistentBase/PersistentBaseCore';
import { PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION } from '../src/config/persistentBase';
import type {
  PersistentConstruction,
  PersistentPlayerBaseContribution,
} from '../src/persistentBase/PersistentBaseTypes';
import type { SyncedPlaceableRock } from '../src/types';

/**
 * Phase 3B – ein einziger Besitzpfad fuer Host und Gaeste.
 *
 * Abgesicherter Pflichtzustand: Der Host haelt den Arbeitsstand aller Beitraege, aber er besitzt
 * keinen davon. Wer den Raum verlaesst, nimmt seinen Besitz mit; was er zurueckgelassen hat,
 * verschwindet aus der Welt und nicht aus seinem Save.
 */

const anchor = { gridX: 10, gridY: 10 };
const buildArea = DEFAULT_PERSISTENT_BASE_BUILD_AREA;
const footprint = [{ dx: 0, dy: 0 }] as const;
const tool = { kind: 'construction', id: 'rock_barrier' } as const;

function runtime(id: number, gridX: number, gridY = 10): SyncedPlaceableRock {
  return {
    id,
    kind: 'rock',
    gridX,
    gridY,
    hp: 100,
    maxHp: 100,
    ownerId: `player-${id}`,
    ownerColor: 0xffffff,
    expiresAt: 0,
    warningStartsAt: 0,
    angle: 0,
    toolRef: tool,
  };
}

function blueprint(persistentId: string, relativeGridX: number, placementOrder = 0): PersistentConstruction {
  return {
    persistentId,
    tool: { kind: 'construction', id: 'rock_barrier' },
    relativeGridX,
    relativeGridY: 0,
    angle: 0,
    placementOrder,
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
    constructions,
  };
}


/** Die Instanz, zu der ein Arbeitsstand in diesen Tests gehoert. */
const MISSION = { worldRevision: 21, activityRevision: 7 } as const;

describe('PersistentBaseContributionStore – Angebot und Revision', () => {
  it('nimmt jeden Beitrag unter seiner eigenen Besitzeridentitaet auf', () => {
    const store = new PersistentBaseRoomSession().contributions;
    expect(store.offerContribution(contribution('owner-a', [blueprint('a-1', 0)]))).toBe(true);
    expect(store.offerContribution(contribution('owner-b', [blueprint('b-1', 1)]))).toBe(true);

    expect(store.ownerIds).toEqual(['owner-a', 'owner-b']);
    expect(store.getContribution('owner-a')?.constructions).toHaveLength(1);
  });

  it('weist eine veraltete Revision ab und behaelt den neueren Stand', () => {
    const store = new PersistentBaseRoomSession().contributions;
    store.offerContribution(contribution('owner-a', [blueprint('new', 0)], 5));

    expect(store.offerContribution(contribution('owner-a', [blueprint('stale', 1)], 4))).toBe(false);
    expect(store.getContribution('owner-a')?.constructions.map((entry) => entry.persistentId))
      .toEqual(['new']);

    // Dieselbe Revision erneut anzubieten ist erlaubt: Ein wiederholter Zustand ist kein Konflikt.
    expect(store.offerContribution(contribution('owner-a', [blueprint('new', 0)], 5))).toBe(true);
  });

  it('laesst dieselbe Revision keinen abweichenden Inhalt bedeuten', () => {
    const store = new PersistentBaseRoomSession().contributions;
    store.offerContribution(contribution('owner-a', [blueprint('original', 0)], 5));

    // Sonst koennte ein Client einen bereits akzeptierten Stand still austauschen, ohne dass die
    // Revision es je anzeigen wuerde.
    expect(store.offerContribution(contribution('owner-a', [blueprint('swapped', 1)], 5))).toBe(false);
    expect(store.getContribution('owner-a')?.constructions.map((entry) => entry.persistentId))
      .toEqual(['original']);
  });

  it('nimmt einen waehrend der Mission beitretenden Spieler auf, ohne laufende Staende zu ersetzen', () => {
    const storeSession = new PersistentBaseRoomSession();
    const store = storeSession.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('a-1', 0)]));
    storeSession.beginTransaction(MISSION);
    store.registerNew('owner-a', runtime(1, 11), tool, footprint, anchor, buildArea);

    store.offerContribution(contribution('owner-b', [blueprint('b-1', 1)]));
    expect(store.ownerIds).toEqual(['owner-a', 'owner-b']);
    // Der laufende Arbeitsstand von A bleibt, was er ist - ein Angebot ersetzt ihn nicht.
    expect(store.getContribution('owner-a')?.constructions).toHaveLength(2);
  });
});

describe('PersistentBaseContributionStore – Verlassen und Wiederkommen', () => {
  it('entfernt beim Verlassen die Runtime-Objekte und den Raumzustand des Besitzers', () => {
    const storeSession = new PersistentBaseRoomSession();
    const store = storeSession.contributions;
    store.offerContribution(contribution('owner-guest', [blueprint('g-1', 0)]));
    storeSession.beginTransaction(MISSION);
    store.registerRestored('owner-guest', blueprint('g-1', 0), 42);

    expect(store.removeOwner('owner-guest')).toEqual([42]);
    expect(store.ownerIds).toEqual([]);
    expect(store.getContribution('owner-guest')).toBeNull();
    // Andere Spieler uebernehmen seine Konstruktionen ausdruecklich nicht.
    expect(store.getContributions()).toEqual([]);
  });

  it('nimmt denselben Besitzer nach einem erneuten Angebot wieder auf', () => {
    const store = new PersistentBaseRoomSession().contributions;
    store.offerContribution(contribution('owner-guest', [blueprint('g-1', 0)], 3));
    store.removeOwner('owner-guest');

    // Sein Save lag die ganze Zeit auf seinem Geraet; der Raum erfaehrt ihn erst wieder durch das
    // neue Angebot.
    expect(store.offerContribution(contribution('owner-guest', [blueprint('g-1', 0)], 3))).toBe(true);
    expect(store.getContribution('owner-guest')?.revision).toBe(3);
  });
});

describe('PersistentBaseContributionStore – Lobby-Sofort-Commit', () => {
  it('committed eine host-validierte Platzierung sofort und erhoeht die Revision', () => {
    const store = new PersistentBaseRoomSession().contributions;
    store.offerContribution(contribution('owner-a', [], 4));

    expect(store.registerNew('owner-a', runtime(1, 11), tool, footprint, anchor, buildArea))
      .toMatchObject({ origin: 'new' });
    expect(store.hasActiveMission).toBe(false);
    expect(store.getCommittedContribution('owner-a')).toMatchObject({
      ownerId: 'owner-a',
      revision: 5,
      constructions: [expect.objectContaining({ relativeGridX: 1 })],
    });
  });

  it('committed den Abriss eines eigenen materialisierten Blueprints sofort', () => {
    const store = new PersistentBaseRoomSession().contributions;
    const restored = blueprint('lobby-object', 1);
    store.offerContribution(contribution('owner-a', [restored], 5));
    store.registerRestored('owner-a', restored, 12);

    expect(store.removeByRuntimeId(12)).toBe(true);
    expect(store.getCommittedContribution('owner-a')).toMatchObject({
      ownerId: 'owner-a',
      revision: 6,
      constructions: [],
    });
  });

  it('verwendet den bestaetigten Stand nach erneutem Betreten als neue Grundlage', () => {
    const firstVisit = new PersistentBaseRoomSession().contributions;
    firstVisit.offerContribution(contribution('owner-a', [], 2));
    firstVisit.registerNew('owner-a', runtime(1, 11), tool, footprint, anchor, buildArea);
    const confirmed = firstVisit.getCommittedContribution('owner-a')!;

    const reload = new PersistentBaseRoomSession().contributions;
    expect(reload.offerContribution(confirmed)).toBe(true);
    expect(reload.getContribution('owner-a')).toEqual(confirmed);
  });

  it('schreibt eine Gastplatzierung nur in den Beitrag ihres Besitzers', () => {
    const store = new PersistentBaseRoomSession().contributions;
    store.offerContribution(contribution('owner-host', [blueprint('host-kept', 0)], 9));
    store.offerContribution(contribution('owner-guest', [], 3));

    store.registerNew('owner-guest', runtime(2, 11), tool, footprint, anchor, buildArea);

    expect(store.getCommittedContribution('owner-host')).toEqual(
      contribution('owner-host', [blueprint('host-kept', 0)], 9),
    );
    expect(store.getCommittedContribution('owner-guest')).toMatchObject({
      ownerId: 'owner-guest',
      revision: 4,
      constructions: [expect.objectContaining({ relativeGridX: 1 })],
    });
  });
});

describe('PersistentBaseContributionStore – Missionsarbeitsstand', () => {
  it('nimmt nur Neubauten innerhalb des Baubereichs auf', () => {
    const storeSession = new PersistentBaseRoomSession();
    const store = storeSession.contributions;
    storeSession.beginTransaction(MISSION);

    expect(store.registerNew('owner-a', runtime(1, 11), tool, footprint, anchor, buildArea))
      .toMatchObject({ origin: 'new' });
    // Zwei Zellen rechts vom Anker liegt bereits auf der festen Basisflaeche.
    expect(store.registerNew('owner-a', runtime(2, 12), tool, footprint, anchor, buildArea))
      .toBeNull();
    expect(store.getContribution('owner-a')?.constructions).toHaveLength(1);
  });

  it('laesst den committed Stand waehrend einer Mission bis zum Sieg unveraendert', () => {
    const storeSession = new PersistentBaseRoomSession();
    const store = storeSession.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('lobby-kept', 0)], 4));
    storeSession.beginTransaction(MISSION);

    expect(store.registerNew('owner-a', runtime(1, 11), tool, footprint, anchor, buildArea))
      .toMatchObject({ origin: 'new' });
    expect(store.getContribution('owner-a')?.constructions).toHaveLength(2);
    expect(store.getCommittedContribution('owner-a')).toEqual(
      contribution('owner-a', [blueprint('lobby-kept', 0)], 4),
    );

    expect(storeSession.completeTransaction('commit', () => true)[0]).toMatchObject({ revision: 5 });
  });

  it('unterscheidet wiederhergestellte und neue Runtime-Objekte', () => {
    const storeSession = new PersistentBaseRoomSession();
    const store = storeSession.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('restored', 1)]));
    storeSession.beginTransaction(MISSION);
    store.registerRestored('owner-a', blueprint('restored', 1), 7);
    store.registerNew('owner-a', runtime(8, 9), tool, footprint, anchor, buildArea);

    expect(store.getRuntimeMetadata(7)).toMatchObject({ persistentId: 'restored', origin: 'restored' });
    expect(store.getRuntimeMetadata(8)).toMatchObject({ origin: 'new' });
    expect(store.getRuntimeMetadata(999)).toBeNull();
  });

  it('laesst einen Blueprint ohne Runtime-Objekt unangetastet stehen', () => {
    const storeSession = new PersistentBaseRoomSession();
    const store = storeSession.contributions;
    // Ein Blueprint, den der Merge wegen eines Konflikts gar nicht materialisiert hat.
    store.offerContribution(contribution('owner-a', [blueprint('dormant', 0)]));
    storeSession.beginTransaction(MISSION);

    const confirmed = storeSession.completeTransaction('commit', () => false);
    expect(confirmed[0]?.constructions.map((entry) => entry.persistentId)).toEqual(['dormant']);
  });

  it('gibt beim Verdraengen nur die Runtime-Bindung auf, nicht den Besitz', () => {
    const storeSession = new PersistentBaseRoomSession();
    const store = storeSession.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('suppressed', 0)]));
    storeSession.beginTransaction(MISSION);
    store.registerRestored('owner-a', blueprint('suppressed', 0), 21);

    expect(store.getRuntimeBindings().map((entry) => entry.runtimeId)).toEqual([21]);
    expect(store.releaseRuntimeBinding(21)).toBe(true);
    expect(store.releaseRuntimeBinding(21)).toBe(false);
    expect(store.isMaterialized('owner-a', 'suppressed')).toBe(false);

    // Der Blueprint ueberlebt die Verdraengung und wird bei Sieg unveraendert fortgeschrieben.
    expect(storeSession.completeTransaction('commit', () => true)[0]?.constructions.map((entry) => entry.persistentId))
      .toEqual(['suppressed']);
  });

  it('unterscheidet Abriss von Konflikt', () => {
    const storeSession = new PersistentBaseRoomSession();
    const store = storeSession.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('torn-down', 0)]));
    storeSession.beginTransaction(MISSION);
    store.registerRestored('owner-a', blueprint('torn-down', 0), 12);

    expect(store.removeByRuntimeId(12)).toBe(true);
    expect(store.removeByRuntimeId(12)).toBe(false);
    expect(storeSession.completeTransaction('commit', () => true)[0]?.constructions).toEqual([]);
  });

  it('haelt eine zerstoerte Runtime bis zum Round Outcome gebunden', () => {
    const storeSession = new PersistentBaseRoomSession();
    const store = storeSession.contributions;
    const restored = blueprint('destroyed', 0);
    store.offerContribution(contribution('owner-a', [restored], 4));
    storeSession.beginTransaction(MISSION);
    store.registerRestored('owner-a', restored, 21);

    // Der Destruction-Pfad entfernt nur das Runtime-Objekt; die Bindung bleibt erhalten, damit
    // Commit und Rollback denselben Blueprint unterschiedlich behandeln koennen.
    expect(store.getRuntimeBindings()).toEqual([{
      runtimeId: 21,
      ownerId: 'owner-a',
      blueprint: restored,
    }]);
    expect(storeSession.completeTransaction('commit', (runtimeId) => runtimeId !== 21)[0]?.constructions).toEqual([]);
    expect(store.getCommittedContribution('owner-a')?.revision).toBe(5);
  });

  it('haelt den Rollback beim zuletzt bestaetigten Stand jedes Besitzers', () => {
    const storeSession = new PersistentBaseRoomSession();
    const store = storeSession.contributions;
    store.offerContribution(contribution('owner-a', [blueprint('kept', 0)], 4));
    storeSession.beginTransaction(MISSION);
    store.registerNew('owner-a', runtime(1, 11), tool, footprint, anchor, buildArea);

    storeSession.completeTransaction('rollback', () => true);
    const kept = store.getCommittedContribution('owner-a');
    expect(kept?.revision).toBe(4);
    expect(kept?.constructions.map((entry) => entry.persistentId)).toEqual(['kept']);
  });
});
