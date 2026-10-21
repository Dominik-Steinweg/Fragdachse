import { describe, expect, it } from 'vitest';
import type { CombatSource } from '../src/combat/CombatScope';
import { getReactivePropKind } from '../src/config/reactiveProps/reactivePropKinds';
import { ReactivePropRuntime } from '../src/world/reactiveProps/ReactivePropRuntime';
import { resolveObstacleIdPartition } from '../src/world/reactiveProps/ReactivePropObstacleIds';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';
import type { ReactivePropCell } from '../src/types';

const source = (id: string): CombatSource => ({
  gameplaySource: { kind: 'player', id }, attribution: { kind: 'player', id },
  allegiance: { ownerId: id, allowTeamDamage: true }, authoredSourceId: 'test', origin: 'direct',
});

function create(cells: ReactivePropCell[] = [
  { kind: 'explosive_barrel', gridX: 4, gridY: 4 }, { kind: 'explosive_barrel', gridX: 6, gridY: 4 },
]) {
  const removed: number[] = [];
  const layout = { rocks: [{ gridX: 0, gridY: 0 }, { gridX: 1, gridY: 0 }], reactiveProps: cells };
  const runtime = new ReactivePropRuntime({
    cells, partition: resolveObstacleIdPartition(layout), metrics: resolveCoopDefenseWorldMetrics(20, 20),
    removeObstacle: id => removed.push(id), random: () => 0.5,
  });
  return { runtime, removed, first: 2 };
}

const phases = (runtime: ReactivePropRuntime) => {
  const result: string[] = [];
  runtime.forEachPresentationState(state => result.push(state.phase));
  return result;
};

describe('ReactivePropRuntime (explosive barrel)', () => {
  const barrel = getReactivePropKind('explosive_barrel');

  it('owns the obstacle ids directly behind the authored rocks', () => {
    const { runtime, first } = create();
    expect(runtime.isPropId(first - 1)).toBe(false);
    expect(runtime.isPropId(first)).toBe(true);
    expect(runtime.isPropId(first + 2)).toBe(false);
    expect(runtime.partition.firstRuntimeObstacleId).toBe(first + 2);
  });

  it('ignites on any damage and burns down to one explosion owned by the last damager', () => {
    const { runtime, removed, first } = create();
    expect(runtime.commitDamage(first, 1, source('a')).kind).toBe('applied');
    runtime.commitDamage(first, 1, source('b'));
    expect(phases(runtime)[0]).toBe('primed');
    const effects = [];
    for (let now = 0; now < 20_000 && effects.length === 0; now += 50) effects.push(...runtime.hostAdvance(now));
    expect(effects).toHaveLength(1);
    expect(effects[0].request.provenance.attributionId).toBe('b');
    expect(effects[0].request.provenance.allegiance.allowTeamDamage).toBe(false);
    expect(effects[0].request.provenance.weaponSourceId).toBe(barrel.effect.sourceId);
    expect(effects[0].request.effect.selfDamageMult).toBe(0.25);
    expect(removed).toEqual([first]);
    expect(phases(runtime)).toEqual(['destroyed', 'idle']);
    // Destroyed is terminal: further hits find no target, and nothing explodes twice.
    expect(runtime.isAlive(first)).toBe(false);
    expect(runtime.commitDamage(first, 999, source('c')).kind).toBe('inert');
    expect(runtime.hostAdvance(30_000)).toEqual([]);
  });

  it('never removes or explodes inside a damage commit', () => {
    const { runtime, removed, first } = create();
    const result = runtime.commitDamage(first, barrel.integrity.maxHp * 10, source('a'), 'explosion');
    expect(result.kind === 'applied' && result.transition).toBe('destroyed');
    expect(removed).toEqual([]);
    expect(phases(runtime)[0]).toBe('triggered');
    const late = runtime.hostAdvance(0);
    expect(late).toEqual([]);
    const effects = runtime.hostAdvance(10_000);
    expect(effects).toHaveLength(1);
    expect(removed).toEqual([first]);
  });

  it('replicates deltas, periodic full states and removal to a client mirror', () => {
    const host = create();
    const client = create();
    expect(host.runtime.getNetSnapshot(false)).toBeNull();
    host.runtime.commitDamage(host.first + 1, 5, source('a'));
    const delta = host.runtime.getNetSnapshot(false)!;
    expect(delta.full).toBe(false);
    expect(delta.entries[0]).toBe(1);
    host.runtime.commitDamage(host.first + 1, 999, source('a'));
    host.runtime.hostAdvance(0); host.runtime.hostAdvance(10_000);
    const full = host.runtime.getNetSnapshot(true)!;
    expect(full.full).toBe(true);
    client.runtime.applyReplicated(full.entries, true);
    expect(phases(client.runtime)).toEqual(['idle', 'destroyed']);
    expect(client.removed).toEqual([client.first + 1]);
    // A later full snapshot cannot revive a removed prop.
    client.runtime.applyReplicated([], true);
    expect(phases(client.runtime)).toEqual(['idle', 'destroyed']);
  });
});
