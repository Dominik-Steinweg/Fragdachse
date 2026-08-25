import { describe, expect, it } from 'vitest';
import { planPersistentBaseRestore, type PersistentRestoreToolDefinition } from '../src/persistentBase/PersistentBaseRestorePlanner';
import type { PersistentBaseState } from '../src/persistentBase/PersistentBaseTypes';

const tools: readonly PersistentRestoreToolDefinition[] = [
  { kind: 'construction', id: 'rocket_turret', footprint: [{ dx: 0, dy: 0 }], capacityCost: 4, maxHp: 250, unlocked: true },
  { kind: 'construction', id: 'machine_gun_turret', footprint: [{ dx: 0, dy: 0 }], capacityCost: 2, maxHp: 180, unlocked: true },
  { kind: 'construction', id: 'tesla_turret', footprint: [{ dx: 0, dy: 0 }], capacityCost: 2, maxHp: 200, unlocked: false },
  { kind: 'utility', id: 'ROCK_BARRIER', footprint: [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }], capacityCost: 3, maxHp: 200, unlocked: true },
];

function blueprint(
  persistentId: string,
  kind: 'construction' | 'utility',
  id: string,
  relativeGridX: number,
  relativeGridY: number,
  placementOrder: number,
) {
  return {
    persistentId,
    tool: { kind, id },
    relativeGridX,
    relativeGridY,
    angle: 0,
    placementOrder,
  } as const;
}

describe('persistent base restore planner', () => {
  it('filters deterministically and continues after a capacity overflow', () => {
    const state: PersistentBaseState = {
      schemaVersion: 1,
      radiusCells: 5,
      revision: 2,
      constructions: [
        blueprint('first-turret', 'construction', 'rocket_turret', 0, 0, 0),
        blueprint('locked', 'construction', 'tesla_turret', 1, 0, 1),
        blueprint('outside', 'construction', 'machine_gun_turret', 6, 0, 2),
        blueprint('blocked', 'construction', 'machine_gun_turret', 2, 0, 3),
        blueprint('too-expensive', 'utility', 'ROCK_BARRIER', 3, 0, 4),
        blueprint('small-late', 'construction', 'machine_gun_turret', 0, 1, 5),
        blueprint('unknown', 'utility', 'MISSING', 0, 2, 6),
      ],
    };

    const plan = planPersistentBaseRestore({
      state,
      anchor: { gridX: 10, gridY: 10 },
      activeRadiusCells: 5,
      capacityUsed: 0,
      capacityMax: 6,
      tools,
      isCellBlocked: (gridX, gridY) => gridX === 12 && gridY === 10,
    });

    expect(plan.active.map((entry) => entry.blueprint.persistentId)).toEqual([
      'first-turret',
      'small-late',
    ]);
    expect(plan.usedCapacity).toBe(6);
    expect(plan.dormant.map((entry) => [entry.blueprint.persistentId, entry.reason])).toEqual([
      ['locked', 'locked'],
      ['outside', 'outside-zone'],
      ['blocked', 'collision'],
      ['too-expensive', 'capacity'],
      ['unknown', 'unknown-tool'],
    ]);
  });

  it('uses persistentId as the stable tie-breaker', () => {
    const state: PersistentBaseState = {
      schemaVersion: 1,
      radiusCells: 5,
      revision: 0,
      constructions: [
        blueprint('zeta', 'construction', 'machine_gun_turret', 0, 0, 4),
        blueprint('alpha', 'construction', 'machine_gun_turret', 1, 0, 4),
      ],
    };
    const input = {
      state,
      anchor: { gridX: 4, gridY: 4 },
      activeRadiusCells: 5,
      capacityUsed: 0,
      capacityMax: 2,
      tools,
      isCellBlocked: () => false,
    } as const;
    const first = planPersistentBaseRestore(input);
    const second = planPersistentBaseRestore(input);
    expect(first).toEqual(second);
    expect(first.active.map((entry) => entry.blueprint.persistentId)).toEqual(['alpha']);
    expect(first.dormant[0]?.reason).toBe('capacity');
  });
});
