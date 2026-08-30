import { describe, expect, it } from 'vitest';
import { PersistentBaseContributionStore } from '../src/persistentBase/PersistentBaseContributionStore';
import { PersistentBaseRoomSession } from '../src/persistentBase/PersistentBaseRoomSession';
import {
  applyPersistentBaseRoundOutcome,
  resolvePersistentBaseRoundOutcome,
} from '../src/persistentBase/PersistentBaseRoundOutcome';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA } from '../src/persistentBase/PersistentBaseCore';
import { PersistentBaseRewardStore } from '../src/persistentBase/PersistentBaseRewardStore';
import type { SyncedPlaceableRock } from '../src/types';
import { PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION } from '../src/config/persistentBase';
import type { PersistentPlayerBaseContribution } from '../src/persistentBase/PersistentBaseTypes';

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

function contribution(
  ownerId: string,
  constructions: readonly PersistentPlayerBaseContribution['constructions'][number][],
  revision = 1,
): PersistentPlayerBaseContribution {
  return {
    schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
    ownerId,
    revision,
    constructions,
  };
}

/** Ein Missionsstart mit je einem Neubau des Hosts und eines Gastes im Innenhof. */
function startMission(): PersistentBaseRoomSession {
  const session = new PersistentBaseRoomSession();
  const store = session.contributions;
  session.beginTransaction(MISSION);
  store.registerNew('owner-host', runtime(1, 'host', 11), tool, footprint, anchor, buildArea);
  store.registerNew('owner-guest', runtime(2, 'guest-a', 9), tool, footprint, anchor, buildArea);
  return session;
}

function startMissionFromCommittedConstruction(): PersistentBaseRoomSession {
  const session = new PersistentBaseRoomSession();
  const store = session.contributions;
  store.offerContribution(contribution('owner-host', [
    {
      persistentId: 'restored',
      tool,
      relativeGridX: 0,
      relativeGridY: 0,
      angle: 0,
      placementOrder: 0,
    },
  ], 4));
  session.beginTransaction(MISSION);
  store.registerRestored('owner-host', store.getContribution('owner-host')!.constructions[0]!, 10);
  return session;
}


/** Die Instanz, zu der ein Arbeitsstand in diesen Tests gehoert. */
const MISSION = { worldRevision: 21, activityRevision: 7 } as const;

describe('persistent base round outcome', () => {
  it('schreibt ausschliesslich einen Sieg fort', () => {
    expect(resolvePersistentBaseRoundOutcome('victory')).toBe('commit');
    expect(resolvePersistentBaseRoundOutcome('defeat')).toBe('rollback');
    expect(resolvePersistentBaseRoundOutcome('aborted')).toBe('rollback');
    // Kein Abschluss = technischer Abbruch.
    expect(resolvePersistentBaseRoundOutcome(null)).toBe('rollback');
  });

  it('bestaetigt bei Sieg jedem Besitzer genau einen fortgeschriebenen Beitrag', () => {
    const session = startMission();
    const store = session.contributions;

    const confirmed = applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome('victory'), {
      session,
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
      const session = startMission();
    const store = session.contributions;

      const confirmed = applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(conclusion), {
        session,
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
      const session = new PersistentBaseRoomSession();
      const store = session.contributions;
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
      session.beginTransaction(MISSION);
      store.registerNew('owner-host', runtime(3, 'host', 9), tool, footprint, anchor, buildArea);

      expect(applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(conclusion), {
        session: session,
        isRuntimeObjectAlive: () => true,
      })).toEqual([]);
      expect(store.getCommittedContribution('owner-host')).toMatchObject({
        revision: 7,
        constructions: [expect.objectContaining({ persistentId: 'lobby-kept' })],
      });
    }
  });

  it('entscheidet Contributions und Rewards gemeinsam, atomar und idempotent', () => {
    for (const conclusion of ['victory', 'defeat', 'aborted', null] as const) {
      // Ein Raum, ein Arbeitsstand: Beitraege und Belohnungen teilen ihn und damit ihren
      // Abschluss. Zwei getrennte Ausgaenge kann es gar nicht mehr geben.
      const session = startMission();
      const contributions = session.contributions;
      const rewards = session.rewards;
      const openMission = session.transaction;
      session.completeTransaction('rollback', () => true);
      expect(rewards.placeReward({
        rewardId: 'base_health_pedestal',
        relativeGridX: 0,
        relativeGridY: 0,
        angle: 0,
      }), String(conclusion)).toBe(true);
      const committedRewards = rewards.getState();
      expect(openMission?.isOpen, String(conclusion)).toBe(false);

      session.beginTransaction(MISSION);
      contributions.registerNew('owner-host', runtime(1, 'host', 11), tool, footprint, anchor, buildArea);
      contributions.registerNew('owner-guest', runtime(2, 'guest-a', 9), tool, footprint, anchor, buildArea);
      expect(rewards.dismantleReward('base_health_pedestal'), String(conclusion)).toBe(true);
      const confirmed = applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(conclusion), {
        session,
        isRuntimeObjectAlive: () => true,
      });

      const expectedRewards = conclusion === 'victory'
        ? { ...committedRewards, revision: committedRewards.revision + 1, placements: [] }
        : committedRewards;
      expect(confirmed, String(conclusion)).toHaveLength(conclusion === 'victory' ? 2 : 0);
      expect(contributions.hasActiveMission, String(conclusion)).toBe(false);
      expect(rewards.hasActiveMission, String(conclusion)).toBe(false);
      expect(rewards.getState(), String(conclusion)).toEqual(expectedRewards);

      // Ein zweiter Abschluss darf weder eine weitere Revision noch einen zweiten Store-Aufruf
      // erzeugen, nachdem beide Arbeitsstaende gemeinsam abgeschlossen wurden.
      expect(applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(conclusion), {
        session,
        isRuntimeObjectAlive: () => true,
      }), String(conclusion)).toEqual([]);
      expect(rewards.getState(), String(conclusion)).toEqual(expectedRewards);

      // Der naechste Missionslauf startet ausschliesslich aus dem gemeinsamen Ergebnis.
      session.beginTransaction(MISSION);
      expect(contributions.getContributions(), String(conclusion))
        .toHaveLength(conclusion === 'victory' ? 2 : 0);
      expect(rewards.getState(), String(conclusion)).toEqual(expectedRewards);
      session.completeTransaction('rollback', () => true);
    }
  });

  it('schreibt nur noch lebende Runtime-Objekte fort', () => {
    const session = startMission();
    const store = session.contributions;

    const confirmed = applyPersistentBaseRoundOutcome('commit', {
      session,
      isRuntimeObjectAlive: (runtimeId) => runtimeId === 1,
    });

    const byOwner = new Map(confirmed.map((entry) => [entry.ownerId, entry]));
    expect(byOwner.get('owner-host')?.constructions).toHaveLength(1);
    expect(byOwner.get('owner-guest')?.constructions).toEqual([]);
  });

  it('validiert Neubau, Rueckbau und Runtime-Zerstoerung ueber alle Abschlussarten', () => {
    const mutations = ['build', 'dismantle', 'destruction'] as const;
    const conclusions = ['victory', 'defeat', 'aborted', null] as const;

    for (const mutation of mutations) {
      for (const conclusion of conclusions) {
        const session = startMissionFromCommittedConstruction();
        const store = session.contributions;
        if (mutation === 'build') {
          store.registerNew('owner-host', runtime(11, 'host', 11), tool, footprint, anchor, buildArea);
        } else if (mutation === 'dismantle') {
          expect(store.removeByRuntimeId(10), `${mutation}/${conclusion}`).toBe(true);
        }
        // Eine Zerstoerung entfernt nur das Runtime-Objekt. Die Bindung bleibt bis zum Outcome
        // erhalten, damit Victory sie entfernt und Rollback sie aus dem Baseline-Stand restauriert.
        const destroyed = mutation === 'destruction';
        const confirmed = applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(conclusion), {
          session,
          isRuntimeObjectAlive: (runtimeId) => !(destroyed && runtimeId === 10),
        });

        const expectedIds = conclusion === 'victory'
          ? mutation === 'build' ? ['restored', expect.any(String)] : mutation === 'dismantle' ? [] : []
          : ['restored'];
        const committedIds = store.getCommittedContribution('owner-host')?.constructions
          .map((entry) => entry.persistentId) ?? [];
        if (mutation === 'build' && conclusion === 'victory') {
          expect(committedIds).toHaveLength(2);
          expect(committedIds[0]).toBe('restored');
        } else {
          expect(committedIds, `${mutation}/${conclusion}`).toEqual(expectedIds);
        }
        expect(confirmed.length, `${mutation}/${conclusion}`).toBe(conclusion === 'victory' ? 1 : 0);

        // Der folgende Missionsstart muss genau den zuletzt bestaetigten Stand materialisieren
        // koennen; der Working State der abgeschlossenen Mission darf nicht hineinleaken.
        session.beginTransaction(MISSION);
        const nextMissionIds = store.getContribution('owner-host')?.constructions
          .map((entry) => entry.persistentId) ?? [];
        if (mutation === 'build' && conclusion === 'victory') {
          expect(nextMissionIds).toHaveLength(2);
          expect(nextMissionIds[0]).toBe('restored');
        } else {
          expect(nextMissionIds, `${mutation}/${conclusion}`).toEqual(expectedIds);
        }
      }
    }
  });

  it('schliesst einen Ausgang idempotent ohne eine zweite Revision zu erzeugen', () => {
    const session = startMission();
    const store = session.contributions;
    const first = applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome('victory'), {
      session,
      isRuntimeObjectAlive: () => true,
    });
    expect(first).toHaveLength(2);
    expect(store.getCommittedContribution('owner-host')?.revision).toBe(1);

    expect(applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome('victory'), {
      session,
      isRuntimeObjectAlive: () => true,
    })).toEqual([]);
    expect(store.getCommittedContribution('owner-host')?.revision).toBe(1);
  });

  it('haelt Runtime- und Core-HP aus dem bestaetigten Contribution-State heraus', () => {
    const session = startMissionFromCommittedConstruction();
    const store = session.contributions;
    const runtimeObject = runtime(10, 'host', 10);
    runtimeObject.hp = 17;
    runtimeObject.maxHp = 1650;
    const confirmed = applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome('victory'), {
      session,
      isRuntimeObjectAlive: () => true,
    });

    expect(confirmed[0]).toMatchObject({
      ownerId: 'owner-host',
      revision: 5,
      constructions: [expect.objectContaining({ persistentId: 'restored' })],
    });
    expect(JSON.stringify(confirmed)).not.toMatch(/"(?:hp|maxHp|runtimeId)"/);
    // Der Runtime-Stand bleibt absichtlich ausserhalb des Stores; die lokale Variable stellt
    // sicher, dass der Test keinen Core-/Konstrukt-HP-Wert mit dem Blueprint verwechselt.
    expect(runtimeObject.hp).toBe(17);
    expect(runtimeObject.maxHp).toBe(1650);
  });

  it('laesst eine verworfene Runde nicht in den naechsten Lauf leaken', () => {
    const session = startMission();
    const store = session.contributions;
    applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome('defeat'), {
      session,
      isRuntimeObjectAlive: () => true,
    });

    // Der naechste Lauf beginnt beim zuletzt bestaetigten Stand - hier also beim leeren.
    session.beginTransaction(MISSION);
    expect(store.getContributions()).toEqual([]);
    // Die Runtime-Objekte gehoerten der beendeten World; mit ihr sind sie weg.
    session.useWorldRuntimes(null);
    expect(store.getRuntimeMetadata(1)).toBeNull();

    // Und ein Sieg im zweiten Lauf schreibt genau eine Revision fort, nicht zwei.
    store.registerNew('owner-host', runtime(3, 'host', 9), tool, footprint, anchor, buildArea);
    const confirmed = applyPersistentBaseRoundOutcome('commit', {
      session,
      isRuntimeObjectAlive: () => true,
    });
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({ ownerId: 'owner-host', revision: 1 });
    expect(confirmed[0]?.constructions.map((entry) => entry.relativeGridX)).toEqual([-1]);
  });

  it('ignoriert einen Ausgang, wenn gar keine Mission lief', () => {
    const session = new PersistentBaseRoomSession();
    const store = session.contributions;
    expect(applyPersistentBaseRoundOutcome('commit', {
      session,
      isRuntimeObjectAlive: () => true,
    })).toEqual([]);
    expect(store.hasActiveMission).toBe(false);
  });
});
