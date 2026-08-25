import { describe, expect, it } from 'vitest';
import type { SyncedPlaceableRock } from '../src/types';
import { PersistentBaseRoomState } from '../src/persistentBase/PersistentBaseRoomState';

function runtime(id: number, ownerId: string, gridX: number): SyncedPlaceableRock {
  return {
    id,
    kind: 'rock',
    constructionId: 'rock_barrier',
    gridX,
    gridY: 10,
    hp: 200,
    maxHp: 200,
    ownerId,
    ownerColor: 0xffffff,
    expiresAt: 0,
    warningStartsAt: 0,
    angle: 0,
    ownership: 'guest-session',
    toolRef: { kind: 'construction', id: 'rock_barrier' },
  };
}

const anchor = { gridX: 10, gridY: 10 };
const footprint = [{ dx: 0, dy: 0 }] as const;

describe('room-scoped persistent guest state', () => {
  it('commits live guest blueprints but never needs a repository', () => {
    const state = new PersistentBaseRoomState();
    state.beginMission();
    const blueprint = state.registerNew(
      runtime(1, 'guest-a', 11),
      'guest-a',
      { kind: 'utility', id: 'ROCK_BARRIER_COOP' },
      footprint,
      anchor,
      5,
    );
    expect(blueprint).toMatchObject({ ownerId: 'guest-a', tool: { kind: 'construction', id: 'rock_barrier' } });

    state.commit(() => true);
    expect(state.getCommittedBlueprints()).toHaveLength(1);
    expect(state.getCommittedBlueprints()[0]).toMatchObject({ ownerId: 'guest-a', relativeGridX: 1 });
  });

  it('rolls back a mission and removes a final owner idempotently', () => {
    const state = new PersistentBaseRoomState();
    state.beginMission();
    state.registerNew(runtime(1, 'guest-a', 11), 'guest-a', { kind: 'construction', id: 'rock_barrier' }, footprint, anchor, 5);
    state.rollback();
    expect(state.getCommittedBlueprints()).toEqual([]);

    state.beginMission();
    state.registerNew(runtime(2, 'guest-a', 11), 'guest-a', { kind: 'construction', id: 'rock_barrier' }, footprint, anchor, 5);
    expect(state.removeGuestSessionOwner('guest-a')).toEqual([2]);
    expect(state.removeGuestSessionOwner('guest-a')).toEqual([]);
    state.commit(() => true);
    expect(state.getCommittedBlueprints()).toEqual([]);
  });

  it('keeps live blueprints across map teardown while dropping dead runtime objects', () => {
    const state = new PersistentBaseRoomState();
    state.beginMission();
    state.registerNew(runtime(1, 'guest-a', 11), 'guest-a', { kind: 'construction', id: 'rock_barrier' }, footprint, anchor, 5);
    state.registerNew(runtime(2, 'guest-a', 12), 'guest-a', { kind: 'construction', id: 'rock_barrier' }, footprint, anchor, 5);
    state.detachRuntimeObjects((runtimeId) => runtimeId === 2);
    state.commit(() => false);
    expect(state.getCommittedBlueprints().map((entry) => entry.relativeGridX)).toEqual([2]);
  });
});
