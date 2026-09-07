import { describe, expect, it, vi } from 'vitest';
import { BURN_TICK_INTERVAL_MS } from '../src/config';
import { CombatBurnStatusOwner } from '../src/combat/CombatBurnStatusOwner';
import type { CombatSource, CombatTargetRef } from '../src/combat/CombatScope';
import { EnemyMovementStatusSystem } from '../src/systems/EnemyMovementStatusSystem';
import { PlasmaSwarmReactionSystem } from '../src/systems/PlasmaCharge';

const scope = Object.freeze({ worldRevision: 7, runtimeGeneration: 2 });

function enemy(id: string, entityGeneration = 1): CombatTargetRef {
  return Object.freeze({
    kind: 'enemy' as const,
    id,
    scope,
    instance: Object.freeze({ entityGeneration, activityRevision: 4 }),
  });
}

function player(id: string, lifeRevision = 1): CombatTargetRef {
  return Object.freeze({
    kind: 'player' as const,
    id,
    scope,
    instance: Object.freeze({ entityGeneration: 1, lifeRevision }),
  });
}

function source(id: string, child = false): CombatSource {
  return Object.freeze({
    gameplaySource: { kind: 'player' as const, id },
    actor: { kind: 'player' as const, id },
    attribution: { kind: 'player' as const, id },
    allegiance: { ownerId: id },
    authoredSourceId: 'weapon.PLASMA',
    origin: 'direct' as const,
    lineage: child ? { plasmaSwarmChild: true } : undefined,
  });
}

describe('P5 canonical status owners', () => {
  it('keeps Burn on the concrete target life and retains source facts until final source detach', () => {
    const owner = new CombatBurnStatusOwner();
    const targetLife = player('victim', 1);
    const attacker = source('attacker');
    expect(owner.applyBurn({
      target: targetLife,
      source: attacker,
      damagePerTick: 4,
      tickIntervalMs: BURN_TICK_INTERVAL_MS,
      durationMs: 2_000,
      nowMs: 100,
    }, { stackKey: 'glock' })).toBe(true);

    // Source death has no cancellation call; committed provenance remains usable by the tick.
    const due = owner.advance(250, () => true);
    expect(due).toHaveLength(1);
    expect(due[0].source).toEqual(attacker);
    expect(due[0].target).toEqual(targetLife);
    expect(owner.getVisualState(player('victim', 2), 250).stackCount).toBe(0);

    owner.clearSource('attacker');
    expect(owner.advance(500, () => true)).toEqual([]);
  });

  it('clears Burn on target detach and keeps all HUD-style reads passive', () => {
    const owner = new CombatBurnStatusOwner();
    const target = enemy('e1');
    owner.applyBurn({
      target,
      source: source('p1'),
      damagePerTick: 3,
      tickIntervalMs: BURN_TICK_INTERVAL_MS,
      durationMs: 500,
      nowMs: 0,
    });

    expect(owner.getVisualState(target, 250)).toEqual({ stackCount: 1, visualStyle: 'normal' });
    expect(owner.getActiveSources(target, 250)).toHaveLength(1);
    expect(owner.getVisualState(target, 500)).toEqual({ stackCount: 0, visualStyle: 'normal' });
    expect(owner.advance(250, () => true)).toHaveLength(1);
    owner.clearBurn(target);
    expect(owner.advance(500, () => true)).toEqual([]);
  });

  it('merges Enemy slow in one target slot and never prunes from movement reads', () => {
    const owner = new EnemyMovementStatusSystem();
    const target = enemy('e1');
    owner.applySlow({ target, source: source('p1'), factor: 0.5, durationMs: 3_000, nowMs: 0 });
    owner.applySlow({ target, source: source('p2'), factor: 0.8, durationMs: 5_000, nowMs: 500 });

    expect(owner.getMovementFactor(target, 1_000)).toBe(0.5);
    expect(owner.getMovementFactor(target, 5_500)).toBe(1);
    expect(owner.getMovementFactor(target, 5_499)).toBe(0.5);
    owner.prune(5_500);
    expect(owner.getMovementFactor(target, 1_000)).toBe(1);
    expect(owner.getMovementFactor(enemy('e1', 2), 1_000)).toBe(1);
  });

  it('keeps Plasma charges target-wide, rejects child double-procs and prunes explicitly', () => {
    const projected = vi.fn();
    const owner = new PlasmaSwarmReactionSystem(projected);
    const target = enemy('e1');

    expect(owner.registerDirectContact({ target, source: source('p1'), nowMs: 0, random: () => 1 })?.stacks).toBe(1);
    expect(owner.registerDirectContact({ target, source: source('p2'), nowMs: 100, random: () => 1 })?.stacks).toBe(2);
    expect(owner.registerDirectContact({ target, source: source('p1', true), nowMs: 200, random: () => 0 })).toBeNull();
    expect(owner.read(target, 200)?.stacks).toBe(2);
    expect(owner.read(target, 2_100)).toBeUndefined();
    expect(owner.read(target, 2_099)?.stacks).toBe(2);

    owner.advance(2_100);
    expect(projected).toHaveBeenLastCalledWith(target, 0);
    expect(owner.registerDirectContact({ target: enemy('e1', 2), source: source('p1'), nowMs: 3_000, random: () => 1 })?.stacks).toBe(1);
  });
});
