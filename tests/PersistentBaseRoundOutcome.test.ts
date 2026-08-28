import { describe, expect, it } from 'vitest';
import { PersistentBaseContributionStore } from '../src/persistentBase/PersistentBaseContributionStore';
import {
  applyPersistentBaseRoundOutcome,
  resolvePersistentBaseRoundOutcome,
} from '../src/persistentBase/PersistentBaseRoundOutcome';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA } from '../src/persistentBase/PersistentBaseCore';
import type { SyncedPlaceableRock } from '../src/types';
import { PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION } from '../src/config/persistentBase';

/**
 * Phase 3B – der Rundenausgang entscheidet ueber alle persoenlichen Beitraege gemeinsam.
 *
 * Abgesicherter Pflichtzustand: Nur ein Sieg schreibt fort, und er tut es fuer jeden Besitzer
 * gleichzeitig. Jeder andere Ausgang laesst den zuletzt bestaetigten Stand jedes Besitzers
 * unveraendert - eine Runde kann nie halb fortgeschrieben werden.
 */

const anchor = { gridX: 10, gridY: 10 };
const buildArea = DEFAULT_PERSISTENT_BASE_BUILD_AREA;
const footprint = [{ dx: 0, dy: 0 }] as const;
const tool = { kind: 'construction', id: 'rocket_turret' } as const;

function runtime(id: number, ownerId: string, gridX: number): SyncedPlaceableRock {
  return {
    id,
    kind: 'turret',
    gridX,
    gridY: 10,
    hp: 100,
    maxHp: 100,
    ownerId,
    ownerColor: 0xffffff,
    expiresAt: 0,
    warningStartsAt: 0,
    angle: 0,
    toolRef: tool,
  };
}

/** Ein Missionsstart mit je einem Neubau des Hosts und eines Gastes im Innenhof. */
function startMission(): PersistentBaseContributionStore {
  const store = new PersistentBaseContributionStore();
  store.beginMission();
  store.registerNew('owner-host', runtime(1, 'host', 11), tool, footprint, anchor, buildArea);
  store.registerNew('owner-guest', runtime(2, 'guest-a', 9), tool, footprint, anchor, buildArea);
  return store;
}

describe('persistent base round outcome', () => {
  it('schreibt ausschliesslich einen Sieg fort', () => {
    expect(resolvePersistentBaseRoundOutcome('victory')).toBe('commit');
    expect(resolvePersistentBaseRoundOutcome('defeat')).toBe('rollback');
    expect(resolvePersistentBaseRoundOutcome('aborted')).toBe('rollback');
    // Kein Abschluss = technischer Abbruch.
    expect(resolvePersistentBaseRoundOutcome(null)).toBe('rollback');
  });

  it('bestaetigt bei Sieg jedem Besitzer genau einen fortgeschriebenen Beitrag', () => {
    const store = startMission();

    const confirmed = applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome('victory'), {
      contributions: store,
      isRuntimeObjectAlive: () => true,
    });

    // Deterministisch nach Besitzeridentitaet, nicht nach Beitrittsreihenfolge.
    expect(confirmed.map((entry) => entry.ownerId)).toEqual(['owner-guest', 'owner-host']);
    expect(confirmed.every((entry) => entry.revision === 1)).toBe(true);
    expect(confirmed.map((entry) => entry.constructions.length)).toEqual([1, 1]);
    expect(store.hasActiveMission).toBe(false);
    expect(store.getCommittedContribution('owner-guest')?.constructions).toHaveLength(1);
  });

  it('verwirft bei Niederlage, Host-Abbruch und technischem Abbruch alle Arbeitsstaende', () => {
    for (const conclusion of ['defeat', 'aborted', null] as const) {
      const store = startMission();

      const confirmed = applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(conclusion), {
        contributions: store,
        isRuntimeObjectAlive: () => true,
      });

      // Nichts wird bestaetigt, also darf auch niemand etwas lokal fortschreiben.
      expect(confirmed, String(conclusion)).toEqual([]);
      expect(store.getCommittedContribution('owner-host'), String(conclusion)).toBeNull();
      expect(store.getCommittedContribution('owner-guest'), String(conclusion)).toBeNull();
      expect(store.hasActiveMission, String(conclusion)).toBe(false);
    }
  });

  it('laesst bei Niederlage oder Abbruch einen zuvor in der Lobby committed Stand unveraendert', () => {
    for (const conclusion of ['defeat', 'aborted', null] as const) {
      const store = new PersistentBaseContributionStore();
      store.offerContribution({
        schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
        ownerId: 'owner-host',
        revision: 7,
        constructions: [{
          persistentId: 'lobby-kept',
          tool,
          relativeGridX: 1,
          relativeGridY: 0,
          angle: 0,
          placementOrder: 0,
        }],
      });
      store.beginMission();
      store.registerNew('owner-host', runtime(3, 'host', 9), tool, footprint, anchor, buildArea);

      expect(applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(conclusion), {
        contributions: store,
        isRuntimeObjectAlive: () => true,
      })).toEqual([]);
      expect(store.getCommittedContribution('owner-host')).toMatchObject({
        revision: 7,
        constructions: [expect.objectContaining({ persistentId: 'lobby-kept' })],
      });
    }
  });

  it('schreibt nur noch lebende Runtime-Objekte fort', () => {
    const store = startMission();

    const confirmed = applyPersistentBaseRoundOutcome('commit', {
      contributions: store,
      isRuntimeObjectAlive: (runtimeId) => runtimeId === 1,
    });

    const byOwner = new Map(confirmed.map((entry) => [entry.ownerId, entry]));
    expect(byOwner.get('owner-host')?.constructions).toHaveLength(1);
    expect(byOwner.get('owner-guest')?.constructions).toEqual([]);
  });

  it('laesst eine verworfene Runde nicht in den naechsten Lauf leaken', () => {
    const store = startMission();
    applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome('defeat'), {
      contributions: store,
      isRuntimeObjectAlive: () => true,
    });

    // Der naechste Lauf beginnt beim zuletzt bestaetigten Stand - hier also beim leeren.
    store.beginMission();
    expect(store.getContributions()).toEqual([]);
    expect(store.getRuntimeMetadata(1)).toBeNull();

    // Und ein Sieg im zweiten Lauf schreibt genau eine Revision fort, nicht zwei.
    store.registerNew('owner-host', runtime(3, 'host', 9), tool, footprint, anchor, buildArea);
    const confirmed = applyPersistentBaseRoundOutcome('commit', {
      contributions: store,
      isRuntimeObjectAlive: () => true,
    });
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({ ownerId: 'owner-host', revision: 1 });
    expect(confirmed[0]?.constructions.map((entry) => entry.relativeGridX)).toEqual([-1]);
  });

  it('ignoriert einen Ausgang, wenn gar keine Mission lief', () => {
    const store = new PersistentBaseContributionStore();
    expect(applyPersistentBaseRoundOutcome('commit', {
      contributions: store,
      isRuntimeObjectAlive: () => true,
    })).toEqual([]);
    expect(store.hasActiveMission).toBe(false);
  });
});
