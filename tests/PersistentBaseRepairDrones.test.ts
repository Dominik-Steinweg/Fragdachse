import { describe, expect, it } from 'vitest';
import { getToolCapacityCost } from '../src/config/coopDefenseConstructions';
import { selectDawnRepairDroneRuntimeIds } from '../src/persistentBase/PersistentBaseRepairDrones';
import type { PersistentRuntimeBinding } from '../src/persistentBase/PersistentBaseRuntimeBindings';
import { PersistentBaseRoomSession } from '../src/persistentBase/PersistentBaseRoomSession';
import { applyPersistentBaseRoundOutcome, resolvePersistentBaseRoundOutcome } from '../src/persistentBase/PersistentBaseRoundOutcome';

const destroyed: PersistentRuntimeBinding[] = Array.from({ length: 10 }, (_, i) => ({
  runtimeId: i,
  ownerId: i % 2 ? 'guest' : 'host',
  blueprint: { persistentId: `id-${i}`, placementOrder: i, relativeGridX: i, relativeGridY: 0, angle: 0,
    tool: { kind: 'construction', id: i === 9 ? 'rocket_turret' : 'rock_barrier' } },
}));
const identity = { worldRevision: 7, activityRevision: 8 };

describe('host repair drone selection', () => {
  it.each([[0, 0], [1, 3], [2, 8], [3, 10]])('level %i retains up to %i destroyed constructions globally', (level, count) => {
    const input = structuredClone(destroyed);
    const selected = selectDawnRepairDroneRuntimeIds(input, { isDawn: true, victory: true, level });
    expect(selected.size).toBe(count);
    expect(input).toEqual(destroyed);
  });

  it('prioritizes build costs then persistent ID independently of input and owner order', () => {
    expect(getToolCapacityCost(destroyed[9].blueprint.tool)).toBeGreaterThan(getToolCapacityCost(destroyed[0].blueprint.tool));
    const options = { isDawn: true, victory: true, level: 1 };
    expect([...selectDawnRepairDroneRuntimeIds([...destroyed].reverse(), options)]).toEqual([9, 0, 1]);
    const duplicateIds = destroyed.slice(0, 2).map(binding => ({ ...binding,
      blueprint: { ...binding.blueprint, persistentId: 'same' } }));
    expect([...selectDawnRepairDroneRuntimeIds(duplicateIds, options)]).toEqual([1, 0]);
  });

  it.each([{ isDawn: false, victory: true, level: 3 }, { isDawn: true, victory: false, level: 3 }])
    ('does not change campaign or rollback: %j', options => {
      expect(selectDawnRepairDroneRuntimeIds(destroyed, options).size).toBe(0);
    });

  it.each(['victory', 'defeat'] as const)('commits repaired host and guest blueprints only on %s; preserves rollback and dormant ownership', conclusion => {
    const session = new PersistentBaseRoomSession();
    for (const ownerId of ['host', 'guest']) {
      const blueprints = destroyed.filter(b => b.ownerId === ownerId).map(b => b.blueprint);
      session.contributions.offerContribution({ schemaVersion: 1, ownerId, revision: 5, constructions: blueprints });
    }
    session.beginTransaction(identity);
    for (const b of destroyed) session.contributions.registerRestored(b.ownerId, b.blueprint, b.runtimeId);
    session.contributions.removeByRuntimeId(1); // intentional dismantle: never a repair candidate
    session.contributions.releaseRuntimeBinding(2); // dormant conflict: retained without using a drone
    const candidates = session.contributions.getRuntimeBindings().filter(b => b.runtimeId !== 3);
    const repaired = selectDawnRepairDroneRuntimeIds(candidates, { isDawn: true, victory: conclusion === 'victory', level: 1 });
    const complete = (id = identity) => applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(conclusion), {
      session, identity: id, isRuntimeObjectAlive: runtimeId => runtimeId === 3 || repaired.has(runtimeId),
    });
    expect(complete({ ...identity, activityRevision: 99 })).toEqual([]);
    expect(session.hasOpenTransaction).toBe(true);
    const confirmed = complete();
    if (conclusion === 'victory') {
      expect(confirmed).toHaveLength(2);
      expect(confirmed.every(c => c.revision === 6)).toBe(true);
      expect(confirmed.flatMap(c => c.constructions.map(b => b.persistentId)).sort()).toEqual(['id-0', 'id-2', 'id-3', 'id-4', 'id-9']);
    } else {
      expect(confirmed).toEqual([]);
      expect(session.contributions.getContributions().flatMap(c => c.constructions)).toHaveLength(10);
    }
    expect(complete()).toEqual([]);
  });
});
