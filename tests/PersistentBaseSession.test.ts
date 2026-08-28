import { describe, expect, it } from 'vitest';
import type { SyncedPlaceableRock } from '../src/types';
import type { PersistentBaseRepositoryPort } from '../src/persistentBase/PersistentBaseRepository';
import { PersistentBaseSession } from '../src/persistentBase/PersistentBaseSession';
import type { PersistentBaseState, PersistentConstruction } from '../src/persistentBase/PersistentBaseTypes';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA } from '../src/persistentBase/PersistentBaseCore';

class MemoryRepository implements PersistentBaseRepositoryPort {
  state: PersistentBaseState;
  saves = 0;

  constructor(state: PersistentBaseState) {
    this.state = state;
  }

  load(): PersistentBaseState {
    return structuredClone(this.state);
  }

  save(state: PersistentBaseState): void {
    this.saves += 1;
    this.state = structuredClone(state);
  }
}

function runtime(id: number, ownerId: string, gridX: number, gridY: number, expiresAt = 0): SyncedPlaceableRock {
  return {
    id,
    kind: 'turret',
    gridX,
    gridY,
    hp: 100,
    maxHp: 100,
    ownerId,
    ownerColor: 0xffffff,
    expiresAt,
    warningStartsAt: 0,
    angle: 0.25,
    toolRef: { kind: 'construction', id: 'rocket_turret' },
  };
}

function stateWith(entry?: Partial<PersistentConstruction>): PersistentBaseState {
  return {
    schemaVersion: 1,
    radiusCells: 5,
    revision: 7,
    constructions: entry ? [{
      persistentId: 'restored-1',
      tool: { kind: 'construction', id: 'rocket_turret' },
      relativeGridX: 0,
      relativeGridY: 0,
      angle: 0,
      placementOrder: 0,
      ...entry,
    }] : [],
  };
}

const anchor = { gridX: 10, gridY: 10 };
const footprint = [{ dx: 0, dy: 0 }] as const;

describe('persistent base session', () => {
  it('limits the current build area to the nine cells of the fixed 3x3 courtyard', () => {
    const repository = new MemoryRepository(stateWith());
    const session = new PersistentBaseSession(repository, {
      anchor,
      activeRadiusCells: 5,
      activeBuildArea: DEFAULT_PERSISTENT_BASE_BUILD_AREA,
      ownerId: 'host',
    });

    expect(session.registerNew(
      runtime(10, 'host', 11, 11),
      { kind: 'construction', id: 'rocket_turret' },
      footprint,
    )).not.toBeNull();
    expect(session.registerNew(
      runtime(11, 'host', 12, 10),
      { kind: 'construction', id: 'rocket_turret' },
      footprint,
    )).toBeNull();
  });

  it('records only permanent host-owned in-zone placements and commits them on victory', () => {
    const repository = new MemoryRepository(stateWith());
    const session = new PersistentBaseSession(repository, { anchor, activeRadiusCells: 5, ownerId: 'host' });

    expect(session.registerNew(runtime(1, 'guest', 10, 10), { kind: 'construction', id: 'rocket_turret' }, footprint)).toBeNull();
    expect(session.registerNew(runtime(2, 'host', 16, 10), { kind: 'construction', id: 'rocket_turret' }, footprint)).toBeNull();
    const metadata = session.registerNew(runtime(3, 'host', 11, 10), { kind: 'construction', id: 'rocket_turret' }, footprint);
    expect(metadata).toMatchObject({ origin: 'new', placementOrder: 0 });
    expect(session.getRuntimeMetadata(3)).toMatchObject({ origin: 'new' });

    const committed = session.commit(() => true);
    expect(repository.saves).toBe(1);
    expect(committed.revision).toBe(8);
    expect(committed.constructions).toHaveLength(1);
    expect(committed.constructions[0]).toMatchObject({
      relativeGridX: 1,
      relativeGridY: 0,
      angle: 0.25,
    });
  });

  it('keeps dormant and destroyed baseline entries separate across victory and defeat', () => {
    const repository = new MemoryRepository(stateWith({}));
    const victory = new PersistentBaseSession(repository, { anchor, activeRadiusCells: 5, ownerId: 'host' });
    const baseline = repository.load();
    victory.registerRestored(baseline.constructions[0]!, 44);
    expect(victory.commit(() => false).constructions).toEqual([]);

    const afterVictory = repository.load();
    expect(afterVictory.constructions).toEqual([]);

    const dormantRepository = new MemoryRepository(stateWith({}));
    const dormant = new PersistentBaseSession(dormantRepository, { anchor, activeRadiusCells: 5, ownerId: 'host' });
    dormant.commit(() => true);
    expect(dormantRepository.state.constructions).toHaveLength(1);

    const defeatRepository = new MemoryRepository(stateWith({}));
    const defeat = new PersistentBaseSession(defeatRepository, { anchor, activeRadiusCells: 5, ownerId: 'host' });
    const defeatBaseline = defeatRepository.load();
    defeat.registerRestored(defeatBaseline.constructions[0]!, 45);
    defeat.discard();
    expect(defeatRepository.saves).toBe(0);
    expect(defeatRepository.state).toEqual(defeatBaseline);
  });

  it('does not classify temporary placeables as persistent', () => {
    const repository = new MemoryRepository(stateWith());
    const session = new PersistentBaseSession(repository, { anchor, activeRadiusCells: 5, ownerId: 'host' });
    expect(session.registerNew(
      runtime(5, 'host', 10, 10, 1234),
      { kind: 'construction', id: 'rocket_turret' },
      footprint,
    )).toBeNull();
  });
});
