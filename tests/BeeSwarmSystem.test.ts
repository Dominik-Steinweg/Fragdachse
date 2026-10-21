import { describe, expect, it } from 'vitest';
import type { CombatSource } from '../src/combat/CombatScope';
import { getReactivePropKind, type ReactivePropSwarmEffect } from '../src/config/reactiveProps/reactivePropKinds';
import { BeeSwarmSystem, type BeeSwarmTarget } from '../src/systems/beeSwarm/BeeSwarmSystem';

const hive = getReactivePropKind('bee_hive');
if (hive.effect.kind !== 'swarm') throw new Error('bee_hive must release a swarm');
const config: ReactivePropSwarmEffect = hive.effect;
const source = (owner: string): CombatSource => ({ gameplaySource: { kind: 'player', id: owner },
  attribution: { kind: 'player', id: owner }, allegiance: { ownerId: owner, kind: 'player', allowTeamDamage: false },
  authoredSourceId: config.sourceId, origin: 'direct' });

interface Target extends BeeSwarmTarget { enemy: boolean }

function fixture(targets: Target[], options: { burning?: () => boolean } = {}) {
  const stings: { key: string; at: number }[] = [];
  const live = new Map(targets.map(t => [t.key, t]));
  const system = new BeeSwarmSystem<Target>({
    targets: () => [...live.values()],
    readTarget: key => live.get(key) ?? null,
    canTarget: (swarm, t) => t.enemy && t.id !== swarm.source.allegiance.ownerId,
    isBurning: () => options.burning?.() ?? false,
    sting: (_swarm, t, at) => stings.push({ key: t.key, at }),
  });
  const release = (at = 0) => system.release({ hiveIndex: 0, x: 0, y: 0, at, source: source('p1'), config, hostile: false });
  return { system, stings, live, release };
}

const enemy = (key: string, x: number, y = 0): Target => ({ key, kind: 'enemy', id: key, x, y, radius: 12, enemy: true });
const ally = (key: string, x: number): Target => ({ key, kind: 'player', id: key, x, y: 0, radius: 12, enemy: false });

function run(system: BeeSwarmSystem<Target>, until: number, from = 0, step = 16) {
  for (let now = from; now <= until; now += step) system.update(now);
}

describe('BeeSwarmSystem', () => {
  it('hunts the nearest enemy first, then rotates through several, never allies or the trigger', () => {
    const f = fixture([enemy('near', 120), enemy('far', -200), ally('p2', 40), ally('p1', 10)]);
    f.release();
    run(f.system, 6_000);
    const order = [...new Set(f.stings.map(s => s.key))];
    expect(order[0]).toBe('near');
    expect(order).toContain('far');
    expect(order).not.toContain('p2');
    expect(order).not.toContain('p1');
  });

  it('keeps the configured sting cadence and stops hunting after its duration', () => {
    const f = fixture([enemy('a', 60)]);
    f.release();
    run(f.system, 20_000);
    for (let i = 1; i < f.stings.length; i++) expect(f.stings[i].at - f.stings[i - 1].at).toBeGreaterThanOrEqual(config.stingIntervalMs);
    expect(Math.max(...f.stings.map(s => s.at))).toBeLessThanOrEqual(config.durationMs);
    // Hunting ends, the bees fly home and the swarm is gone within its lifetime.
    expect(f.system.getSwarms()).toHaveLength(0);
  });

  it('scatters on an overlapping explosion or ground fire: no more stings, then home', () => {
    let burning = false;
    const f = fixture([enemy('a', 60)], { burning: () => burning });
    const swarm = f.release();
    run(f.system, 1_000);
    const before = f.stings.length;
    f.system.observeExplosion(swarm.x, swarm.y, 40, 1_000);
    expect(swarm.phase).toBe('dispersed');
    run(f.system, 6_000, 1_016);
    expect(f.stings.length).toBe(before);
    const g = fixture([enemy('a', 60)], { burning: () => burning });
    const second = g.release();
    burning = true;
    run(g.system, 400);
    expect(second.phase).not.toBe('hunting');
    expect(g.stings).toHaveLength(0);
  });

  it('retargets when its target vanishes and gives up without targets', () => {
    const f = fixture([enemy('a', 60), enemy('b', -90)]);
    const swarm = f.release();
    run(f.system, 600);
    expect(swarm.target?.key).toBe('a');
    f.live.delete('a');
    run(f.system, 1_200, 616);
    expect(swarm.target?.key).toBe('b');
    f.live.clear();
    run(f.system, 1_200 + config.idleGraceMs + 200, 1_216);
    expect(swarm.phase).toBe('returning');
  });

  it('does not depend on the frame size', () => {
    const coarse = fixture([enemy('a', 100), enemy('b', -150, 40)]);
    const fine = fixture([enemy('a', 100), enemy('b', -150, 40)]);
    coarse.release(); fine.release();
    run(coarse.system, 5_000, 0, 50);
    run(fine.system, 5_000, 0, 5);
    expect(coarse.stings.map(s => s.key)).toEqual(fine.stings.map(s => s.key));
    expect(coarse.stings.map(s => s.at)).toEqual(fine.stings.map(s => s.at));
  });
});
