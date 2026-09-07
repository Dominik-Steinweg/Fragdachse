import { describe, expect, it, vi } from 'vitest';
import { BURN_TICK_INTERVAL_MS } from '../src/config';
import { CombatBurnStatusOwner } from '../src/combat/CombatBurnStatusOwner';
import { BurnStateMachine } from '../src/combat/rules/BurnStateMachine';
import type { CombatSource, CombatTargetRef } from '../src/combat/CombatScope';
import { EnemyMovementStatusSystem } from '../src/systems/EnemyMovementStatusSystem';
import { resolveEnemyHitStaggerDuration } from '../src/combat/rules/EnemyHitStagger';
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
  it('preserves overlapping provenance without changing stack counts, expiry or tick damage totals', () => {
    const owner = new CombatBurnStatusOwner();
    const baseline = new BurnStateMachine();
    const target = enemy('victim');
    const oldSource: CombatSource = {
      ...source('e2'), gameplaySource: { kind: 'enemy', id: 'e2' },
      actor: { kind: 'enemy', id: 'e2' }, attribution: { kind: 'player', id: 'old-owner' },
    };
    const newSource: CombatSource = { ...oldSource, attribution: { kind: 'player', id: 'new-owner' } };
    const tick = BURN_TICK_INTERVAL_MS;
    for (const [now, provenance, duration, damage] of [
      [0, oldSource, 3 * tick, 4],
      // A separate object with equal facts still shares its contribution with the old source.
      [0, { ...oldSource }, 3 * tick, 4],
      [0, newSource, 3 * tick, 4],
      [tick / 2, newSource, 5 * tick, 2],
    ] as const) {
      owner.applyBurn({ target, source: provenance, durationMs: duration,
        damagePerTick: damage, tickIntervalMs: tick, nowMs: now }, { stackKey: 'fire' });
      baseline.applyHit({ targetId: 'victim', attackerId: 'e2', sourceKey: 'fire',
        sourceId: oldSource.authoredSourceId!, durationMs: duration, damagePerTick: damage, now });
    }
    expect(owner.getActiveSources(target, tick).map(entry => entry.sourceKey)).toEqual(['fire', 'fire']);
    for (const now of [tick, 2 * tick, 3 * tick, 12 * tick]) {
      expect(owner.getVisualState(target, now).stackCount).toBe(baseline.getStackCount('victim', now));
      const actual = owner.advance(now, () => true);
      const expected = baseline.advanceTo(now);
      for (const tickAt of new Set([...actual, ...expected].map(entry => entry.tickAt))) {
        const sum = (entries: readonly { tickAt: number; damage: number }[]) => entries
          .filter(entry => entry.tickAt === tickAt).reduce((total, entry) => total + entry.damage, 0);
        expect(sum(actual)).toBe(sum(expected));
      }
      if (now === tick) {
        expect(actual.map(entry => [entry.source.attribution.id, entry.damage])).toEqual([
          ['old-owner', 8], ['new-owner', 6],
        ]);
        expect(actual.every(entry => entry.sourceKey === 'fire')).toBe(true);
      }
    }
  });

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

  it('invalidates issued final ticks on detach even when identical source facts are attached again', () => {
    const owner = new CombatBurnStatusOwner();
    const target = enemy('victim');
    const tick = BURN_TICK_INTERVAL_MS;
    const request = { target, source: source('attacker'), damagePerTick: 3,
      tickIntervalMs: tick, durationMs: 2 * tick, nowMs: 0 };
    owner.applyBurn(request);
    const due = owner.advance(2 * tick, () => true);
    expect(due).toHaveLength(1);
    // The stack has expired, but its legitimately due tick remains valid until source detach.
    expect(owner.getActiveSources(target, 2 * tick)).toEqual([]);
    expect(due[0].isSourceValid()).toBe(true);
    owner.clearSource('attacker');
    owner.applyBurn({ ...request, nowMs: 2 * tick });
    const replacement = owner.advance(3 * tick, () => true);
    expect(replacement).toHaveLength(1);
    expect(due[0].isSourceValid()).toBe(false);
    expect(replacement[0].isSourceValid()).toBe(true);
    owner.destroy();
    expect(replacement[0].isSourceValid()).toBe(false);
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

  it('scales hit stagger with weight and one base duration, including disable and immunity', () => {
    const base = 90;
    const duration = (factor: number, tuning = base) => resolveEnemyHitStaggerDuration('direct', factor, tuning);
    expect(duration(1)).toBe(base);
    expect(duration(0.1)).toBeLessThan(duration(1));
    expect(duration(1.5)).toBeGreaterThan(duration(1));
    expect(duration(0.01)).toBe(duration(1 / 3));
    expect(duration(100)).toBe(duration(2));
    expect(duration(1.5, base / 2)).toBe(duration(1.5) / 2);
    expect(duration(1, 0)).toBe(0);
    expect(duration(0)).toBe(0);
    expect(duration(-1)).toBe(0);
    expect(duration(NaN)).toBe(0);
    expect(duration(1, Infinity)).toBe(0);
  });

  it('refreshes stagger without extending a slow or accumulating hit durations', () => {
    const owner = new EnemyMovementStatusSystem(), target = enemy('e1');
    owner.applySlow({ target, source: source('p1'), factor: 0.5, durationMs: 1000, nowMs: 0 });
    owner.applyHitStagger({ target, durationMs: 80, nowMs: 0 });
    owner.applyHitStagger({ target, durationMs: 80, nowMs: 60 });
    expect(owner.isHitStaggered(target, 139)).toBe(true);
    expect(owner.getMovementFactor(target, 139)).toBe(0.5);
    expect(owner.isHitStaggered(target, 140)).toBe(false);
    expect(owner.getMovementFactor(target, 140)).toBe(0.5);
    expect(owner.isHitStaggered(enemy('e1', 2), 60)).toBe(false);
    expect(owner.applyHitStagger({ target: player('p1'), durationMs: 80, nowMs: 0 })).toBe(false);
    expect(owner.isHitStaggered(player('p1'), 0)).toBe(false);
    expect(owner.applyHitStagger({ target, durationMs: 0, nowMs: 0 })).toBe(false);
    // Reads do not mutate; pruning only removes the expired stagger, preserving the slow.
    expect(owner.isHitStaggered(target, 139)).toBe(true);
    owner.prune(140);
    expect(owner.isHitStaggered(target, 139)).toBe(false);
    expect(owner.getMovementFactor(target, 140)).toBe(0.5);
  });

  it.each(['target', 'id', 'stale', 'world'] as const)('clears both movement statuses at the %s boundary', boundary => {
    const owner = new EnemyMovementStatusSystem(), target = enemy('e1');
    owner.applySlow({ target, source: source('p1'), factor: 0.5, durationMs: 1000, nowMs: 0 });
    owner.applyHitStagger({ target, durationMs: 80, nowMs: 0 });
    if (boundary === 'target') owner.clearMovementStatus(target);
    if (boundary === 'id') owner.clearTargetId('e1');
    if (boundary === 'stale') owner.prune(1, () => false);
    if (boundary === 'world') owner.clear();
    expect(owner.isHitStaggered(target, 1)).toBe(false);
    expect(owner.getMovementFactor(target, 1)).toBe(1);
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
