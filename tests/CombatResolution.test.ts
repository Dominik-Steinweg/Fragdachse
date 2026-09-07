import { describe, expect, it, vi } from 'vitest';
import { applyCombatDamage, applyCombatSupport, type CombatResolutionContext } from '../src/combat/CombatResolution';
import { createDerivedDamageBasis, type CombatDamageRequest, type TargetDamageMutationPort, type TargetSupportMutationPort } from '../src/combat/CombatMutation';
import { PlayerVitalsOwner } from '../src/combat/PlayerVitalsOwner';
import { resolveCombatRelationship } from '../src/combat/CombatRelationshipPolicy';
import type { CombatSource, CombatTargetRef } from '../src/combat/CombatScope';

const source: CombatSource = {
  gameplaySource: { kind: 'player', id: 'attacker' }, attribution: { kind: 'player', id: 'attacker' },
  allegiance: { ownerId: 'attacker' }, origin: 'direct', sourceSlot: 'weapon1',
};
function harness() {
  const scope = { worldRevision: 1, runtimeGeneration: 3 };
  const vitals = new PlayerVitalsOwner(scope, {
    resolveMaxHp: () => 1000, resolveMaxArmor: () => 100,
    captureTerminalFacts: target => ({ target, position: { x: 0, y: 0 } }),
  });
  const target = vitals.attachAndBeginInitialLife('victim');
  const request: CombatDamageRequest = {
    outcomeId: 'hit', source, target, entry: 'hitscan', damageKind: 'direct',
    basis: { kind: 'authored', amount: 10 }, allowCritical: true, targetScaling: 'pending',
  };
  const context: CombatResolutionContext = {
    authorized: true, nowMs: 1234, random: vi.fn(() => 0.25), acceptsScope: () => true,
    resolveTarget: () => ({
      snapshot: { target, state: vitals.readVitals(target)! },
      relationship: { relationship: 'enemy', canDamage: true, canSupport: false },
    }),
  };
  return { vitals, target, request, context };
}

describe('shared Combat resolution', () => {
  it('applies distinct P/M/T once, preserving execution factors and explicit host inputs', () => {
    const { vitals, request, context } = harness();
    const outgoing = vi.fn((_request, amount, critical, now, random) => {
      expect(now).toBe(1234);
      expect(critical).toBe(true);
      expect(random()).toBe(0.25);
      expect(random()).toBe(0.25);
      return { amount: amount * 5, isCritical: true };
    });
    const outcome = applyCombatDamage({
      ...request,
      basis: { kind: 'source-resolved', amount: 20, sourceFactors: [
        { kind: 'runtime-power', multiplier: 2, resolvedAt: 'execution' },
      ] },
    }, {
      ...context,
      sourceFactors: [
        { kind: 'runtime-power', multiplier: 2, resolvedAt: 'impact' },
        { kind: 'loadout-slot', multiplier: 3, resolvedAt: 'impact' },
      ],
      resolveOutgoing: outgoing, incomingMultiplier: () => 0.5,
      damageReduction: () => 0.2,
    }, vitals);
    // 10 × existing 2 × pending 3 × M 5 × T .5 × reduction .8.
    expect(outcome).toMatchObject({ kind: 'damage-applied', actualDamage: 120, damage: { isCritical: true } });
    expect(context.random).toHaveBeenCalledTimes(1);
  });

  it('blocks once at the characterized damage basis and never draws crit for rejected candidates', () => {
    const { vitals, request, context } = harness();
    const shield = vi.fn(() => true), dome = vi.fn(() => true), outgoing = vi.fn(() => ({ amount: 30, isCritical: false }));
    expect(applyCombatDamage(request, { ...context, blockBeforeModifiers: shield, blockAtTarget: dome, resolveOutgoing: outgoing }, vitals))
      .toMatchObject({ kind: 'accepted-no-effect', reason: 'blocked' });
    expect(shield).toHaveBeenCalledWith(request, 10, 1234);
    expect(outgoing).not.toHaveBeenCalled();
    expect(dome).not.toHaveBeenCalled();
    expect(applyCombatDamage(request, { ...context, resolveOutgoing: outgoing, incomingMultiplier: () => 2, blockAtTarget: dome }, vitals))
      .toMatchObject({ kind: 'accepted-no-effect', reason: 'blocked' });
    expect(dome).toHaveBeenCalledWith(request, 60, 1234);
    for (const amount of [NaN, Infinity, -1]) {
      expect(applyCombatDamage({ ...request, basis: { kind: 'authored', amount } }, context, vitals)).toMatchObject({ kind: 'rejected', reason: 'invalid-value' });
    }
    expect(context.random).not.toHaveBeenCalled();
  });

  it('uses confirmed parent damage for children and applies only their new target rules', () => {
    const { vitals, request, context } = harness();
    const parent = applyCombatDamage(request, { ...context, resolveOutgoing: (_r, amount) => ({ amount: amount * 3, isCritical: false }) }, vitals);
    if (parent.kind !== 'damage-applied') throw new Error('Expected damage');
    const outgoing = vi.fn((_r, amount) => ({ amount: amount * 7, isCritical: false }));
    const child: CombatDamageRequest = {
      ...request, outcomeId: 'child', entry: 'derived-reaction', damageKind: 'chain',
      source: { ...source, origin: 'chain' }, basis: createDerivedDamageBasis(parent, 0.5),
    };
    const outcome = applyCombatDamage(child, {
      ...context, sourceFactors: [{ kind: 'runtime-power', multiplier: 2, resolvedAt: 'impact' }],
      resolveOutgoing: outgoing, incomingMultiplier: () => 2,
    }, vitals);
    expect(outcome).toMatchObject({ actualDamage: 30, damage: { damageKind: 'chain' } });
    expect(outgoing).not.toHaveBeenCalled();
    const reflect = applyCombatDamage({ ...child, damageKind: 'reflect', source: { ...source, origin: 'reflect' }, newSourceModifiers: true }, {
      ...context, resolveOutgoing: outgoing,
    }, vitals);
    expect(reflect).toMatchObject({ actualDamage: 105 });
    expect(parent.actualDamage).toBe(30);
  });

  it('keeps critical permission and origin independent from a weapon1 source slot', () => {
    const { vitals, request, context } = harness();
    const outgoing = vi.fn((_request, amount, allowCritical, _now, random) => ({
      amount, isCritical: allowCritical && random() < 1,
    }));
    const burn: CombatDamageRequest = {
      ...request, entry: 'damage-over-time', damageKind: 'burn', source: { ...source, origin: 'burn' },
      basis: { kind: 'source-resolved', amount: 10, sourceFactors: [] }, allowCritical: false,
    };
    expect(applyCombatDamage(burn, { ...context, resolveOutgoing: outgoing }, vitals)).toMatchObject({
      damage: { damageKind: 'burn', isCritical: false }, source: { sourceSlot: 'weapon1', origin: 'burn' },
    });
    expect(context.random).not.toHaveBeenCalled();
    expect(applyCombatDamage(request, { ...context, resolveOutgoing: outgoing }, vitals)).toMatchObject({ damage: { isCritical: true } });
  });

  it('limits the Telefrag exception to Burrow and still applies protection', () => {
    const { vitals, request, context } = harness();
    const buried = { ...context, resolveTarget: () => ({ ...context.resolveTarget(request.target, source)!, burrowed: true }) };
    expect(applyCombatDamage(request, buried, vitals)).toMatchObject({ kind: 'rejected', reason: 'not-eligible' });
    const dome = vi.fn(() => true);
    expect(applyCombatDamage({ ...request, burrowException: 'telefrag' }, { ...buried, blockAtTarget: dome }, vitals))
      .toMatchObject({ kind: 'accepted-no-effect', reason: 'blocked' });
    expect(dome).toHaveBeenCalledOnce();
  });

  it('rejects stale scopes, replaced lives and inconsistent origins before modifiers', () => {
    const { vitals, request, context } = harness();
    const outgoing = vi.fn(() => ({ amount: 10, isCritical: false }));
    expect(applyCombatDamage(request, { ...context, acceptsScope: () => false, resolveOutgoing: outgoing }, vitals))
      .toMatchObject({ kind: 'rejected', reason: 'stale-scope' });
    const replacement = { ...request.target, instance: { ...request.target.instance, lifeRevision: 2 } };
    expect(applyCombatDamage(request, { ...context, resolveOutgoing: outgoing, resolveTarget: () => ({ ...context.resolveTarget(request.target, source)!, snapshot: { target: replacement, state: vitals.readVitals(request.target)! } }) }, vitals))
      .toMatchObject({ kind: 'rejected', reason: 'stale-target' });
    expect(applyCombatDamage({ ...request, source: { ...source, origin: 'burn' } }, { ...context, resolveOutgoing: outgoing }, vitals))
      .toMatchObject({ kind: 'rejected', reason: 'not-eligible' });
    expect(outgoing).not.toHaveBeenCalled();
  });

  it('supports zero-damage allies, separate armor loss/regen, caps and no implicit revival', () => {
    const { vitals, request, context } = harness();
    applyCombatDamage({ ...request, basis: { kind: 'authored', amount: 50 } }, context, vitals);
    const supportContext = {
      ...context, armorGainMultiplier: () => 3,
      resolveTarget: () => ({ ...context.resolveTarget(request.target, source)!, relationship: { relationship: 'ally' as const, canDamage: false, canSupport: true } }),
    };
    const support = { outcomeId: 'support', source, target: request.target, supportKind: 'heal' as const, amount: 100 };
    expect(applyCombatSupport(support, supportContext, vitals)).toMatchObject({ actualAmount: 50, revived: false });
    expect(applyCombatSupport({ ...support, supportKind: 'armor', amount: 50 }, supportContext, vitals)).toMatchObject({ actualAmount: 100 });
    expect(applyCombatSupport({ ...support, supportKind: 'armor-loss', amount: 10 }, supportContext, vitals)).toMatchObject({ actualAmount: 10 });
    expect(applyCombatSupport({ ...support, supportKind: 'armor-regeneration', amount: 2 }, supportContext, vitals)).toMatchObject({ actualAmount: 2 });
    expect(applyCombatSupport({ ...support, amount: 0 }, supportContext, vitals)).toMatchObject({ kind: 'accepted-no-effect' });
    applyCombatDamage({ ...request, basis: { kind: 'authored', amount: 10000 } }, context, vitals);
    expect(applyCombatSupport(support, supportContext, vitals)).toMatchObject({ kind: 'rejected', reason: 'target-dead' });
    const neutral = resolveCombatRelationship({ sameActor: false, sourceFaction: 'players', targetFaction: 'neutral', bothPlayers: false, playerPairAreTeammates: false, allowTeamDamage: false });
    expect(neutral).toMatchObject({ canDamage: false, canSupport: false });
  });

  it.each(['base', 'construction'] as const)('resolves %s through its canonical external port without introducing runtime P', kind => {
    const { context, request } = harness();
    const target: CombatTargetRef = { ...request.target, kind, id: 'structure' };
    const state = { kind: 'integrity' as const, integrity: 50, maxIntegrity: 100, destroyed: false };
    const port: TargetDamageMutationPort & TargetSupportMutationPort = {
      commitDamage: vi.fn(r => ({
        kind: 'damage-applied', ...r, actualDamage: Math.min(state.integrity, r.damage.amount),
        hpLost: 0, armorLost: 0, integrityLost: Math.min(state.integrity, r.damage.amount),
        resultingState: { ...state, integrity: state.integrity - r.damage.amount }, transition: { kind: 'none' }, rescueHealing: 0,
      })),
      commitSupport: vi.fn(r => ({ ...r, kind: 'support-applied', actualAmount: Math.min(r.amount, 50), resultingState: state, revived: false })),
    };
    const worldContext = { ...context, resolveTarget: () => ({ snapshot: { target, state }, relationship: { relationship: 'neutral' as const, canDamage: true, canSupport: true } }), incomingMultiplier: () => 2 };
    expect(applyCombatDamage({ ...request, target, entry: 'world-object', basis: { kind: 'source-resolved', amount: 15, sourceFactors: [{ kind: 'object-damage', multiplier: 3, resolvedAt: 'impact' }] } }, worldContext, port))
      .toMatchObject({ actualDamage: 30 });
    expect(applyCombatSupport({ outcomeId: 'repair', source, target, supportKind: 'repair', amount: 80 }, worldContext, port)).toMatchObject({ supportKind: 'repair', actualAmount: 50 });
    expect(port.commitDamage).toHaveBeenCalledOnce();
    expect(port.commitSupport).toHaveBeenCalledOnce();
  });
});
