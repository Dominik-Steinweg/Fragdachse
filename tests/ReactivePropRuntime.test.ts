import { describe, expect, it } from 'vitest';
import type { CombatSource } from '../src/combat/CombatScope';
import { getExplosiveReactivePropKind } from '../src/config/reactiveProps/reactivePropKinds';
import { ReactivePropRuntime, type ReactivePropEffect } from '../src/world/reactiveProps/ReactivePropRuntime';
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
  const barrel = getExplosiveReactivePropKind('explosive_barrel');

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
    const effects: ReactivePropEffect[] = [];
    for (let now = 0; now < 20_000 && effects.length === 0; now += 50) effects.push(...runtime.hostAdvance(now));
    expect(effects).toHaveLength(1);
    const explosion = effects[0];
    if (explosion.kind !== 'explosion') throw new Error('expected an explosion');
    expect(explosion.request.provenance.attributionId).toBe('b');
    expect(explosion.request.provenance.allegiance.allowTeamDamage).toBe(false);
    expect(explosion.request.provenance.weaponSourceId).toBe(barrel.effect.sourceId);
    expect(explosion.request.effect.selfDamageMult).toBe(0.25);
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

describe('ReactivePropRuntime (recharging kinds)', () => {
  const kinds: [string, 'dot_zone' | 'swarm', 'ground' | 'direct'][] = [
    ['spore_puffball', 'dot_zone', 'ground'], ['bee_hive', 'swarm', 'direct'],
  ];
  for (const [kindId, effectKind, origin] of kinds) {
    const cells = (): ReactivePropCell[] => [{ kind: kindId, gridX: 4, gridY: 4 }];

    it(`${kindId}: one hit triggers once after the anticipation, owned by the last hitter in it`, () => {
      const { runtime, removed, first } = create(cells());
      expect(runtime.commitDamage(first, 0.2, source('weak')).kind).toBe('immune');
      expect(phases(runtime)).toEqual(['idle']);
      const hit = runtime.commitDamage(first, 5, { ...source('a'), sourceSlot: 'weapon1' });
      expect(hit.kind).toBe('applied');
      expect(hit.kind === 'applied' && hit.transition).toBe('none');
      expect(runtime.hostAdvance(1000)).toEqual([]);
      // A later hit inside the anticipation takes over ownership, but never triggers twice.
      expect(runtime.commitDamage(first, 5, source('b')).kind).toBe('immune');
      const effects: ReactivePropEffect[] = [];
      for (let now = 1000; now < 3000; now += 25) effects.push(...runtime.hostAdvance(now));
      expect(effects).toHaveLength(1);
      const effect = effects[0];
      if (effect.kind !== effectKind) throw new Error(`expected ${effectKind}`);
      expect(effect.at).toBe(1000 + effect.config.anticipationMs);
      expect(effect.source.attribution.id).toBe('b');
      expect(effect.source.allegiance.ownerId).toBe('b');
      expect(effect.source.allegiance.allowTeamDamage).toBe(false);
      expect(effect.source.origin).toBe(origin);
      expect(effect.source.authoredSourceId).toBe(effect.config.sourceId);
      expect(effect.source.sourceSlot).toBeUndefined();
      expect(phases(runtime)).toEqual(['recharging']);
      expect(removed).toEqual([]);
    });

    it(`${kindId}: is immune while recharging, never removed, and ready again afterwards`, () => {
      const { runtime, removed, first } = create(cells());
      runtime.commitDamage(first, 5, source('a'));
      runtime.hostAdvance(0);
      const fired = runtime.hostAdvance(1000);
      expect(fired).toHaveLength(1);
      const recharge = fired[0].kind === 'explosion' ? 0 : fired[0].at;
      expect(runtime.commitDamage(first, 999, source('c'), 'explosion').kind).toBe('immune');
      expect(runtime.readIntegrity(first)?.destroyed).toBe(false);
      expect(runtime.isAlive(first)).toBe(true);
      expect(runtime.hostAdvance(recharge + 14_000)).toEqual([]);
      expect(phases(runtime)).toEqual(['recharging']);
      runtime.hostAdvance(recharge + 15_000);
      expect(phases(runtime)).toEqual(['idle']);
      expect(runtime.commitDamage(first, 5, source('d')).kind).toBe('applied');
      runtime.hostAdvance(recharge + 15_000);
      const again = runtime.hostAdvance(recharge + 16_000);
      expect(again).toHaveLength(1);
      expect(again[0].kind !== 'explosion' && again[0].source.lineage?.parentEffectId)
        .not.toBe(fired[0].kind !== 'explosion' && fired[0].source.lineage?.parentEffectId);
      expect(removed).toEqual([]);
    });

    it(`${kindId}: a client mirror never removes it, whatever the wire says`, () => {
      const client = create(cells());
      client.runtime.applyReplicated([0, 4, 0], false);
      client.runtime.applyReplicated([0, 1, 100], false);
      expect(client.removed).toEqual([]);
      expect(phases(client.runtime)).toEqual(['idle']);
      client.runtime.applyReplicated([0, 3, 128], false);
      expect(phases(client.runtime)).toEqual(['recharging']);
      client.runtime.applyReplicated([], true);
      expect(phases(client.runtime)).toEqual(['idle']);
    });
  }
});
