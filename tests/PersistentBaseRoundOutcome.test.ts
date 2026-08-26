import { describe, expect, it } from 'vitest';
import type { PersistentBaseRepositoryPort } from '../src/persistentBase/PersistentBaseRepository';
import { PersistentBaseRoomState } from '../src/persistentBase/PersistentBaseRoomState';
import {
  applyPersistentBaseRoundOutcome,
  resolvePersistentBaseRoundOutcome,
} from '../src/persistentBase/PersistentBaseRoundOutcome';
import { PersistentBaseSession } from '../src/persistentBase/PersistentBaseSession';
import type { PersistentBaseState } from '../src/persistentBase/PersistentBaseTypes';
import type { SyncedPlaceableRock } from '../src/types';

class MemoryRepository implements PersistentBaseRepositoryPort {
  state: PersistentBaseState = { schemaVersion: 1, radiusCells: 5, revision: 0, constructions: [] };
  saves = 0;

  load(): PersistentBaseState {
    return structuredClone(this.state);
  }

  save(state: PersistentBaseState): void {
    this.saves += 1;
    this.state = structuredClone(state);
  }
}

const anchor = { gridX: 10, gridY: 10 };
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

/** Ein Missionsstart mit je einem host- und einem gastseitigen Neubau in der Zone. */
function startMission(repository: MemoryRepository): {
  session: PersistentBaseSession;
  roomState: PersistentBaseRoomState;
} {
  const session = new PersistentBaseSession(repository, { anchor, activeRadiusCells: 5, ownerId: 'host' });
  const roomState = new PersistentBaseRoomState();
  roomState.beginMission();
  session.registerNew(runtime(1, 'host', 11), tool, footprint);
  roomState.registerNew(runtime(2, 'guest-a', 12), 'guest-a', tool, footprint, anchor, 5);
  return { session, roomState };
}

describe('persistent base round outcome', () => {
  it('schreibt ausschliesslich einen Sieg fort', () => {
    expect(resolvePersistentBaseRoundOutcome('victory')).toBe('commit');
    expect(resolvePersistentBaseRoundOutcome('defeat')).toBe('rollback');
    expect(resolvePersistentBaseRoundOutcome('aborted')).toBe('rollback');
    // Kein Abschluss = technischer Abbruch.
    expect(resolvePersistentBaseRoundOutcome(null)).toBe('rollback');
  });

  it('uebernimmt bei Sieg host- und gastseitige Neubauten gemeinsam', () => {
    const repository = new MemoryRepository();
    const { session, roomState } = startMission(repository);

    applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome('victory'), {
      session,
      roomState,
      isRuntimeObjectAlive: () => true,
    });

    expect(repository.saves).toBe(1);
    expect(repository.state.revision).toBe(1);
    expect(repository.state.constructions.map((entry) => entry.relativeGridX)).toEqual([1]);
    expect(roomState.getCommittedBlueprints().map((entry) => entry.ownerId)).toEqual(['guest-a']);
    expect(roomState.hasActiveMission).toBe(false);
  });

  it('verwirft bei Niederlage, Host-Abbruch und technischem Abbruch beide Arbeitsstaende', () => {
    for (const conclusion of ['defeat', 'aborted', null] as const) {
      const repository = new MemoryRepository();
      const { session, roomState } = startMission(repository);

      applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(conclusion), {
        session,
        roomState,
        isRuntimeObjectAlive: () => true,
      });

      expect(repository.saves, String(conclusion)).toBe(0);
      expect(repository.state.constructions, String(conclusion)).toEqual([]);
      expect(roomState.getCommittedBlueprints(), String(conclusion)).toEqual([]);
      expect(roomState.hasActiveMission, String(conclusion)).toBe(false);
    }
  });

  it('schreibt nur noch lebende Runtime-Objekte fort', () => {
    const repository = new MemoryRepository();
    const { session, roomState } = startMission(repository);

    applyPersistentBaseRoundOutcome('commit', {
      session,
      roomState,
      isRuntimeObjectAlive: (runtimeId) => runtimeId === 1,
    });

    expect(repository.state.constructions).toHaveLength(1);
    expect(roomState.getCommittedBlueprints()).toEqual([]);
  });

  it('laesst eine verworfene Runde nicht in den naechsten Lauf leaken', () => {
    const repository = new MemoryRepository();
    const first = startMission(repository);
    applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome('defeat'), {
      session: first.session,
      roomState: first.roomState,
      isRuntimeObjectAlive: () => true,
    });

    // Der naechste Lauf baut seine Session neu aus dem Repository auf – so wie buildArena() es tut.
    const second = new PersistentBaseSession(repository, { anchor, activeRadiusCells: 5, ownerId: 'host' });
    expect(second.committedState.constructions).toEqual([]);
    expect(second.workingState.constructions).toEqual([]);
    expect(second.getRuntimeMetadata(1)).toBeNull();

    // Auch der raumweite Gastzustand traegt nichts aus der verworfenen Runde weiter.
    first.roomState.beginMission();
    expect(first.roomState.getWorkingBlueprints()).toEqual([]);

    // Und ein Sieg im zweiten Lauf schreibt genau eine Revision fort, nicht zwei.
    second.registerNew(runtime(3, 'host', 9), tool, footprint);
    applyPersistentBaseRoundOutcome('commit', {
      session: second,
      roomState: first.roomState,
      isRuntimeObjectAlive: () => true,
    });
    expect(repository.state.revision).toBe(1);
    expect(repository.state.constructions.map((entry) => entry.relativeGridX)).toEqual([-1]);
  });
});
