import { describe, expect, it } from 'vitest';
import { PersistentBaseCompositeService } from '../src/persistentBase/PersistentBaseCompositeService';
import type { PersistentPlayerBaseContribution } from '../src/persistentBase/PersistentBaseTypes';

const cell = [{ dx: 0, dy: 0 }] as const;

function contribution(
  ownerId: string,
  constructions: PersistentPlayerBaseContribution['constructions'] = [],
  revision = 0,
): PersistentPlayerBaseContribution {
  return { schemaVersion: 4, ownerId, revision, constructions };
}

function composite(contributions: readonly PersistentPlayerBaseContribution[] = [contribution('host-owner')]) {
  return new PersistentBaseCompositeService({
    ownerId: 'host-owner',
    anchor: { gridX: 10, gridY: 10 },
    radiusCells: 5,
    highestUnlockedMapId: '13',
    contributions,
    authoredCells: new Set(['10:10']),
    capacityMaxByOwner: new Map([['host-owner', 5]]),
    resolveTool: () => ({ footprint: cell, capacityCost: 1 }),
  });
}

describe('persistent base composite service', () => {
  it('commits place/remove/reposition immediately and rejects stale or invalid mutations atomically', () => {
    const state = composite();
    const placed = state.apply({
      operation: 'place', ownerId: 'host-owner', revision: 0,
      tool: { kind: 'construction', id: 'rock_barrier' },
      relativeGridX: 1, relativeGridY: 0, angle: 0,
    });
    expect(placed.accepted).toBe(true);
    const persistentId = placed.contribution!.constructions[0].persistentId;
    expect(placed.snapshot.active[0].blueprint.persistentId).toBe(persistentId);

    expect(state.apply({ operation: 'remove', ownerId: 'host-owner', revision: 0, persistentId }))
      .toMatchObject({ accepted: false, reason: 'stale-revision' });
    expect(state.apply({
      operation: 'reposition', ownerId: 'host-owner', revision: 1, persistentId,
      relativeGridX: 99, relativeGridY: 0, angle: 0,
    })).toMatchObject({ accepted: false, reason: 'conflict' });
    expect(state.getContribution('host-owner')!.constructions[0].relativeGridX).toBe(1);

    const moved = state.apply({
      operation: 'reposition', ownerId: 'host-owner', revision: 1, persistentId,
      relativeGridX: 2, relativeGridY: 0, angle: 0.25,
    });
    expect(moved.accepted).toBe(true);
    expect(moved.contribution!.constructions[0]).toMatchObject({ persistentId, placementOrder: 0, relativeGridX: 2, angle: 0.25 });

    const removed = state.apply({ operation: 'remove', ownerId: 'host-owner', revision: 2, persistentId });
    expect(removed.accepted).toBe(true);
    expect(removed.contribution!.constructions).toEqual([]);
  });

  it('keeps conflict blueprints and only exposes them to their owner', () => {
    const conflicted = contribution('guest-owner', [{
      persistentId: 'guest-conflict', tool: { kind: 'construction', id: 'rock_barrier' },
      relativeGridX: 0, relativeGridY: 0, angle: 0, placementOrder: 0, ownerId: 'guest-owner',
    }]);
    const state = composite([contribution('host-owner'), conflicted]);
    expect(state.getConflictsForOwner('guest-owner')).toHaveLength(1);
    expect(state.getConflictsForOwner('host-owner')).toEqual([]);
    expect(state.apply({ operation: 'remove', ownerId: 'guest-owner', revision: 0, persistentId: 'guest-conflict' }))
      .toMatchObject({ accepted: false, reason: 'not-found' });
  });

  it('allows any owner to place a reward but only the host to unplace it', () => {
    const state = composite([contribution('host-owner'), contribution('guest-owner')]);
    const placed = state.apply({
      operation: 'reward-place', ownerId: 'guest-owner', revision: 0,
      rewardId: 'watchtower', relativeGridX: 2, relativeGridY: 0, angle: 0,
    });
    expect(placed.accepted).toBe(true);
    expect(placed.snapshot.rewards.find((reward) => reward.rewardId === 'watchtower')?.availability).toBe('placed');

    const moved = state.apply({
      operation: 'reposition', ownerId: 'host-owner', revision: 0,
      persistentId: 'reward-watchtower', relativeGridX: 3, relativeGridY: 0, angle: 0.5,
    });
    expect(moved.accepted).toBe(true);
    expect(moved.snapshot.rewards.find((reward) => reward.rewardId === 'watchtower')?.placement)
      .toMatchObject({ relativeGridX: 3, angle: 0.5, persistentId: 'reward-watchtower' });
    expect(state.apply({ operation: 'reward-unplace', ownerId: 'guest-owner', revision: 0, rewardId: 'watchtower' }))
      .toMatchObject({ accepted: false, reason: 'host-only' });
    expect(state.apply({ operation: 'reward-unplace', ownerId: 'host-owner', revision: 0, rewardId: 'watchtower' }).accepted).toBe(true);
  });

  it('restores failed runtime transactions and keeps stable blueprints across reconnect sync', () => {
    const state = composite();
    const placed = state.apply({
      operation: 'place', ownerId: 'host-owner', revision: 0,
      tool: { kind: 'construction', id: 'rock_barrier' },
      relativeGridX: 1, relativeGridY: 0, angle: 0,
    });
    expect(placed.accepted).toBe(true);
    const checkpoint = state.createCheckpoint();

    expect(state.apply({
      operation: 'reposition', ownerId: 'host-owner', revision: 1,
      persistentId: placed.contribution!.constructions[0].persistentId,
      relativeGridX: 2, relativeGridY: 0, angle: 0.5,
    }).accepted).toBe(true);
    state.restoreCheckpoint(checkpoint);
    expect(state.getContribution('host-owner')!.constructions[0])
      .toMatchObject({ relativeGridX: 1, angle: 0 });

    const stableId = 'guest-stable-blueprint';
    state.setContribution(contribution('guest-owner', [{
      persistentId: stableId,
      tool: { kind: 'construction', id: 'rock_barrier' },
      relativeGridX: 3,
      relativeGridY: 0,
      angle: 0,
      placementOrder: 0,
      ownerId: 'guest-owner',
    }], 7));
    state.setContribution(contribution('guest-owner', [{
      persistentId: stableId,
      tool: { kind: 'construction', id: 'rock_barrier' },
      relativeGridX: 4,
      relativeGridY: 0,
      angle: 0.25,
      placementOrder: 0,
      ownerId: 'guest-owner',
    }], 8));
    const reconnected = state.getSnapshot().active.find(
      (entry) => entry.blueprint.persistentId === stableId,
    );
    expect(reconnected).toMatchObject({ gridX: 14, gridY: 10, blueprint: { angle: 0.25 } });
  });
});
