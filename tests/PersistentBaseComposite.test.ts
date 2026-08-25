import { describe, expect, it } from 'vitest';
import {
  mergePersistentBaseComposite,
  type PersistentCompositeCandidate,
} from '../src/persistentBase/PersistentBaseComposite';
import type {
  PersistentBaseAnchor,
  PersistentConstruction,
  PersistentPlayerBaseContribution,
} from '../src/persistentBase/PersistentBaseTypes';

const anchor: PersistentBaseAnchor = { gridX: 0, gridY: 0 };
const cell = [{ dx: 0, dy: 0 }] as const;

function construction(
  persistentId: string,
  relativeGridX: number,
  placementOrder: number,
  ownerId?: string,
): PersistentConstruction {
  return {
    persistentId,
    tool: { kind: 'construction', id: 'rock_barrier' },
    relativeGridX,
    relativeGridY: 0,
    angle: 0,
    placementOrder,
    ownerId,
  };
}

function contribution(
  ownerId: string,
  constructions: readonly PersistentConstruction[],
): PersistentPlayerBaseContribution {
  return { schemaVersion: 4, ownerId, revision: 2, constructions };
}

function merge(input: Partial<Parameters<typeof mergePersistentBaseComposite>[0]> = {}) {
  return mergePersistentBaseComposite({
    anchor,
    radiusCells: 5,
    resolveTool: () => ({ footprint: cell, capacityCost: 1 }),
    ...input,
  });
}

describe('persistent base composite merge', () => {
  it('keeps priority deterministic and retains suppressed blueprints as conflicts', () => {
    const baseReward: PersistentCompositeCandidate = {
      ownerId: 'host-owner',
      source: 'base-reward',
      footprint: cell,
      blueprint: {
        ...construction('reward-watchtower', 0, 0, 'host-owner'),
        rewardId: 'watchtower',
      },
    };
    const host = contribution('host-owner', [construction('host-rock', 0, 0, 'host-owner')]);
    const guestA = contribution('owner-a', [construction('guest-a', 2, 0, 'owner-a')]);
    const guestB = contribution('owner-b', [construction('guest-b', 2, 1, 'owner-b')]);

    const result = merge({
      baseRewards: [baseReward],
      hostContribution: host,
      guestContributions: [guestB, guestA],
    });

    expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual([
      'reward-watchtower',
      'guest-a',
    ]);
    expect(result.conflicts).toEqual([
      { ownerId: 'host-owner', persistentId: 'host-rock', toolId: 'rock_barrier', reason: 'collision' },
      { ownerId: 'owner-b', persistentId: 'guest-b', toolId: 'rock_barrier', reason: 'collision' },
    ]);
    expect(result.conflictsByOwner.get('owner-b')).toHaveLength(1);
    expect(host.constructions).toHaveLength(1);
    expect(guestB.constructions[0].persistentId).toBe('guest-b');
  });

  it('uses stable owner sorting for guests and applies capacity per owner', () => {
    const result = merge({
      guestContributions: [
        contribution('z-owner', [construction('z-first', 1, 0, 'z-owner')]),
        contribution('a-owner', [
          construction('a-first', 3, 0, 'a-owner'),
          construction('a-over-capacity', 4, 1, 'a-owner'),
        ]),
      ],
      capacityMaxByOwner: new Map([
        ['a-owner', 1],
        ['z-owner', 1],
      ]),
    });

    expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual([
      'a-first',
      'z-first',
    ]);
    expect(result.conflicts).toContainEqual({
      ownerId: 'a-owner',
      persistentId: 'a-over-capacity',
      toolId: 'rock_barrier',
      reason: 'capacity',
    });
  });

  it('classifies zone and authored collisions without deleting candidates', () => {
    const outside = construction('outside', 6, 0, 'owner');
    const authored = construction('authored', 1, 1, 'owner');
    const result = merge({
      authoredCells: new Set(['1:0']),
      hostContribution: contribution('owner', [outside, authored]),
    });

    expect(result.active).toEqual([]);
    expect(result.conflicts.map((conflict) => conflict.reason)).toEqual([
      'outside-zone',
      'authored-collision',
    ]);
    expect(outside.persistentId).toBe('outside');
    expect(authored.persistentId).toBe('authored');
  });
});
