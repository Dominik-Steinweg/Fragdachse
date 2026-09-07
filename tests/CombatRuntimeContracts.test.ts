import { describe, expect, it } from 'vitest';
import type {
  CombatReactionPort,
  WorldCombatRequiredBindings,
} from '../src/combat/CombatCapabilities';
import {
  createDerivedDamageBasis,
  toTargetDamageMutation,
  toTargetSupportMutation,
  type CombatDamageMutationOutcome,
  type CombatSupportMutationOutcome,
  type TargetDamageAppliedOutcome,
} from '../src/combat/CombatMutation';
import {
  adaptProjectileCombatSource,
  adaptProjectileDirectDamageRequest,
} from '../src/combat/ProjectileCombatContractAdapter';
import {
  combatTargetInstanceKey,
  isSameCombatTargetInstance,
  type CombatScope,
  type CombatSource,
  type CombatTargetRef,
} from '../src/combat/CombatScope';
import { WorldCombatRuntime } from '../src/combat/WorldCombatRuntime';
import { PlayerVitalsOwner } from '../src/combat/PlayerVitalsOwner';
import type { ProjectileDirectImpactRequest } from '../src/projectile/ProjectileCombatPort';
import { WorldRuntime } from '../src/world/WorldRuntime';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';
import type { WorldPresentationFrameBinding } from '../src/world/WorldPresentationFrameBinding';

const scope: CombatScope = { worldRevision: 7, runtimeGeneration: 2 };

const source: CombatSource = {
  gameplaySource: { kind: 'player', id: 'source-player' },
  attribution: { kind: 'player', id: 'credited-player' },
  allegiance: { ownerId: 'team-owner' },
  origin: 'direct',
};

const target: CombatTargetRef = {
  kind: 'enemy',
  id: 'enemy-1',
  scope,
  instance: { entityGeneration: 4, activityRevision: 11 },
};

function rejectedDamage(): CombatDamageMutationOutcome {
  return { kind: 'rejected', outcomeId: 'damage', target, source, reason: 'not-eligible' };
}

function rejectedSupport(): CombatSupportMutationOutcome {
  return { kind: 'rejected', outcomeId: 'support', target, source, reason: 'not-eligible' };
}

function requiredBindings(): WorldCombatRequiredBindings {
  const reactions: CombatReactionPort = {
    onAcceptedHit: () => undefined,
    onDamageApplied: () => undefined,
    onTerminalTransition: () => undefined,
  };
  return {
    damage: { applyDamage: () => rejectedDamage() },
    support: { applySupport: () => rejectedSupport() },
    targetRead: { resolveTarget: () => null },
    relationships: {
      resolveRelationship: () => ({
        relationship: 'neutral',
        canDamage: false,
        canSupport: false,
      }),
    },
    reactions,
  };
}

describe('Combat scope and provenance contracts', () => {
  it('keeps attribution independent from allegiance when adapting Projectile provenance', () => {
    const adapted = adaptProjectileCombatSource({
      gameplaySourceId: 'origin-enemy',
      attributionId: 'credited-player',
      allegiance: { ownerId: 'reflecting-player', allowTeamDamage: true },
      weaponSourceId: 'weapon.reflected',
      sourceSlot: 'weapon1',
      lineage: { parentProjectileId: 40, reflected: true },
    }, 41, {
      gameplaySourceKind: 'enemy',
      attributionKind: 'player',
      actor: { kind: 'player', id: 'reflecting-player' },
    });

    expect(adapted.gameplaySource).toEqual({ kind: 'enemy', id: 'origin-enemy' });
    expect(adapted.attribution).toEqual({ kind: 'player', id: 'credited-player' });
    expect(adapted.allegiance).toEqual({ ownerId: 'reflecting-player', allowTeamDamage: true });
    expect(adapted.actor).toEqual({ kind: 'player', id: 'reflecting-player' });
  });

  it('distinguishes reused target ids by concrete Activity/entity instance', () => {
    const reused: CombatTargetRef = {
      ...target,
      instance: { entityGeneration: 5, activityRevision: 12 },
    };

    expect(isSameCombatTargetInstance(target, reused)).toBe(false);
    expect(combatTargetInstanceKey(target)).not.toBe(combatTargetInstanceKey(reused));
  });
});

describe('Combat damage origin contracts', () => {
  it('derives child damage from confirmed actual damage rather than requested damage', () => {
    const parent: TargetDamageAppliedOutcome = {
      kind: 'damage-applied',
      outcomeId: 'parent',
      target,
      source,
      damage: {
        amount: 100,
        damageKind: 'direct',
        basis: { kind: 'authored', amount: 100 },
        sourceFactors: [],
        targetFactors: [],
        isCritical: false,
      },
      actualDamage: 40,
      hpLost: 40,
      armorLost: 0,
      integrityLost: 0,
      resultingState: { kind: 'combatant', hp: 20, maxHp: 40, armor: 0, maxArmor: 0, alive: true },
      transition: { kind: 'none' },
      rescueHealing: 20,
    };

    expect(createDerivedDamageBasis(parent, 0.5)).toEqual({
      kind: 'derived-outcome',
      amount: 20,
      parentOutcomeId: 'parent',
      parentActualDamage: 40,
      fraction: 0.5,
    });
  });

  it('maps Projectile direct damage as authored with target scaling still pending', () => {
    const request: ProjectileDirectImpactRequest = {
      projectileId: 8,
      target: { kind: 'enemy', id: 'enemy-1' },
      impact: { x: 10, y: 20 },
      velocity: { x: 1, y: 0 },
      provenance: {
        gameplaySourceId: 'player-1',
        attributionId: 'player-1',
        allegiance: { ownerId: 'player-1' },
        weaponSourceId: 'weapon.rifle',
        sourceSlot: 'weapon1',
      },
      directHit: { damage: 12 },
      augments: [],
    };

    const adapted = adaptProjectileDirectDamageRequest(
      request,
      'projectile:8:enemy-1',
      scope,
      target.instance,
      { gameplaySourceKind: 'player', attributionKind: 'player' },
    );

    expect(adapted.entry).toBe('projectile-direct');
    expect(adapted.basis).toEqual({ kind: 'authored', amount: 12 });
    expect(adapted.targetScaling).toBe('pending');
    expect(adapted.target).toEqual(target);

    const mutation = toTargetDamageMutation(adapted, {
      amount: 12,
      damageKind: 'direct',
      basis: adapted.basis,
      sourceFactors: [],
      targetFactors: [],
      isCritical: false,
    });
    expect(mutation.target).toBe(adapted.target);
    expect(mutation.damage.amount).toBe(12);
  });

  it('keeps Support as its own canonical mutation instead of signed Damage', () => {
    expect(toTargetSupportMutation({
      outcomeId: 'heal:enemy-1',
      target,
      source: { ...source, origin: 'support' },
      supportKind: 'heal',
      amount: 15,
    })).toEqual({
      outcomeId: 'heal:enemy-1',
      target,
      source: { ...source, origin: 'support' },
      supportKind: 'heal',
      amount: 15,
    });
  });
});

describe('Canonical Player vitals mutation', () => {
  function owner() {
    return new PlayerVitalsOwner(scope, {
      resolveMaxHp: () => 100,
      resolveMaxArmor: () => 25,
      captureTerminalFacts: (terminalTarget) => ({
        target: terminalTarget,
        position: { x: 12, y: 34 },
        targetCategory: 'player',
      }),
    });
  }

  function resolved(amount: number) {
    return {
      amount,
      damageKind: 'direct' as const,
      basis: { kind: 'authored' as const, amount },
      sourceFactors: [],
      targetFactors: [],
      isCritical: false,
    };
  }

  it('caps armor and reports Armor-to-HP overkill as actual loss with one terminal transition', () => {
    const vitals = owner();
    const player = vitals.attachAndBeginInitialLife('p1');
    const armor = vitals.commitSupport({
      outcomeId: 'armor', target: player, source: { ...source, origin: 'support' },
      supportKind: 'armor', amount: 100,
    });
    expect(armor).toMatchObject({
      kind: 'support-applied', actualAmount: 25,
      resultingState: { hp: 100, armor: 25, maxArmor: 25, alive: true },
    });

    const lethal = vitals.commitDamage({
      outcomeId: 'lethal', target: player, source, damage: resolved(1000),
    });
    expect(lethal).toMatchObject({
      kind: 'damage-applied', actualDamage: 125, armorLost: 25, hpLost: 100,
      resultingState: { hp: 0, armor: 0, alive: false },
      transition: { kind: 'dead', facts: { position: { x: 12, y: 34 } } },
    });
    expect(Object.isFrozen(lethal)).toBe(true);
    expect(Object.isFrozen(lethal.resultingState)).toBe(true);
    expect(vitals.commitDamage({
      outcomeId: 'again', target: player, source, damage: resolved(1),
    })).toMatchObject({ kind: 'rejected', reason: 'target-dead' });
  });

  it('keeps initial attach, death and respawn as distinct life revisions and rejects stale life refs', () => {
    const vitals = owner();
    const firstLife = vitals.attachAndBeginInitialLife('p1');
    vitals.commitDamage({ outcomeId: 'death', target: firstLife, source, damage: resolved(100) });
    expect(vitals.commitSupport({
      outcomeId: 'no-revive', target: firstLife, source: { ...source, origin: 'support' },
      supportKind: 'heal', amount: 100,
    })).toMatchObject({ kind: 'rejected', reason: 'target-dead' });

    const secondLife = vitals.commitRespawn('p1', firstLife.instance.lifeRevision!);
    expect(secondLife?.instance.entityGeneration).toBe(firstLife.instance.entityGeneration);
    expect(secondLife?.instance.lifeRevision).toBe(firstLife.instance.lifeRevision! + 1);
    expect(vitals.commitDamage({
      outcomeId: 'stale-life', target: firstLife, source, damage: resolved(1),
    })).toMatchObject({ kind: 'rejected', reason: 'stale-target' });
    expect(vitals.readVitals(secondLife!)).toMatchObject({ hp: 100, armor: 0, alive: true });

    vitals.detachCurrentPlayer('p1');
    expect(vitals.commitDamage({
      outcomeId: 'removed', target: secondLife!, source, damage: resolved(1),
    })).toMatchObject({ kind: 'rejected', reason: 'target-missing' });
    const reattached = vitals.attachAndBeginInitialLife('p1');
    expect(reattached.instance.entityGeneration).toBeGreaterThan(secondLife!.instance.entityGeneration);
    vitals.destroy();
    expect(vitals.commitDamage({
      outcomeId: 'stale-scope', target: reattached, source, damage: resolved(1),
    })).toMatchObject({ kind: 'rejected', reason: 'stale-scope' });
    expect(Object.isFrozen(source)).toBe(false);
  });

  it('keeps a real Projectile adapter receipt stable when the target is culled afterwards', () => {
    const vitals = owner();
    const player = vitals.attachAndBeginInitialLife('p1');
    const request: ProjectileDirectImpactRequest = {
      projectileId: 42,
      target: { kind: 'player', id: 'p1' },
      impact: { x: 10, y: 20 },
      velocity: { x: 1, y: 0 },
      provenance: {
        gameplaySourceId: 'source-player',
        attributionId: 'credited-player',
        allegiance: { ownerId: 'team-owner' },
        weaponSourceId: 'weapon.projectile',
        sourceSlot: 'weapon1',
      },
      directHit: { damage: 12 },
      augments: [],
    };
    const adapted = adaptProjectileDirectDamageRequest(
      request,
      'projectile:42:p1',
      scope,
      player.instance,
      { gameplaySourceKind: 'player', attributionKind: 'player' },
    );
    const receipt = vitals.commitDamage({
      outcomeId: adapted.outcomeId,
      target: adapted.target,
      source: adapted.source,
      damage: {
        amount: adapted.basis.amount,
        damageKind: 'direct',
        basis: adapted.basis,
        sourceFactors: [],
        targetFactors: [],
        isCritical: false,
      },
    });

    expect(receipt).toMatchObject({ kind: 'damage-applied', actualDamage: 12 });
    expect(Object.isFrozen(receipt)).toBe(true);
    vitals.detachCurrentPlayer('p1');
    expect(receipt).toMatchObject({
      kind: 'damage-applied',
      outcomeId: 'projectile:42:p1',
      target: adapted.target,
      actualDamage: 12,
    });
    expect(vitals.commitDamage({
      outcomeId: 'after-cull',
      target: adapted.target,
      source: adapted.source,
      damage: {
        amount: adapted.basis.amount,
        damageKind: 'direct',
        basis: adapted.basis,
        sourceFactors: [],
        targetFactors: [],
        isCritical: false,
      },
    })).toMatchObject({ kind: 'rejected', reason: 'target-missing' });
  });

  it('rejects non-finite mutation values and clamps non-finite caps to valid state', () => {
    const vitals = new PlayerVitalsOwner(scope, {
      resolveMaxHp: () => Number.NaN,
      resolveMaxArmor: () => Number.POSITIVE_INFINITY,
      captureTerminalFacts: (terminalTarget) => ({ target: terminalTarget, position: { x: 0, y: 0 } }),
    });
    const player = vitals.attachAndBeginInitialLife('p1');
    expect(vitals.readVitals(player)).toMatchObject({ hp: 1, maxHp: 1, armor: 0, maxArmor: 0 });
    expect(vitals.commitDamage({
      outcomeId: 'nan', target: player, source, damage: resolved(Number.NaN),
    })).toMatchObject({ kind: 'rejected', reason: 'invalid-value' });
  });
});

describe('WorldCombatRuntime build and ownership contract', () => {
  it('exposes only active bound capabilities and makes retained ports stale-safe', () => {
    const runtime = new WorldCombatRuntime(7, 2);
    runtime.attachRequiredBindings(requiredBindings());
    const damage = runtime.damage;
    const targetRead = runtime.targetRead;
    runtime.activate();

    expect(damage.applyDamage({
      outcomeId: 'active-damage', target, source, entry: 'automated',
      damageKind: 'direct', basis: { kind: 'authored', amount: 1 },
      targetScaling: 'pending', allowCritical: false,
    })).toMatchObject({ kind: 'rejected', reason: 'not-eligible' });
    runtime.destroy();
    expect(damage.applyDamage({
      outcomeId: 'stale-damage', target, source, entry: 'automated',
      damageKind: 'direct', basis: { kind: 'authored', amount: 1 },
      targetScaling: 'pending', allowCritical: false,
    })).toMatchObject({ kind: 'rejected', reason: 'stale-scope' });
    expect(targetRead.resolveTarget(target)).toBeNull();
  });

  it('refuses activation without required ports and makes an active detach terminal', () => {
    const runtime = new WorldCombatRuntime(7, 2);
    expect(() => runtime.activate()).toThrow(/required bindings/i);

    const first = runtime.attachRequiredBindings(requiredBindings());
    first.detach();
    const current = runtime.attachRequiredBindings(requiredBindings());
    first.detach();
    runtime.activate();

    expect(runtime.accepts(scope)).toBe(true);
    current.detach();
    expect(runtime.phase).toBe('detached');
    expect(runtime.accepts(scope)).toBe(false);
    expect(() => runtime.activate()).toThrow(/detached/i);
  });

  it('is invalidated by its owning WorldRuntime before dependencies can outlive the World', () => {
    const world = new WorldRuntime({
      descriptor: {
        worldRevision: 7,
        definitionId: 'world:test',
        seed: 1,
        generatorVersion: 1,
        layoutFingerprint: 'test',
      },
    } as WorldRuntimeContext);
    const combat = new WorldCombatRuntime(7, 2);
    combat.attachRequiredBindings(requiredBindings());
    combat.activate();
    world.setCombat(combat);

    world.destroy();

    expect(combat.phase).toBe('destroyed');
    expect(combat.accepts(target)).toBe(false);
  });

  it('does not let a stale clear lease detach a replacement Combat runtime', () => {
    const world = new WorldRuntime({
      descriptor: {
        worldRevision: 7,
        definitionId: 'world:test',
        seed: 1,
        generatorVersion: 1,
        layoutFingerprint: 'test',
      },
    } as WorldRuntimeContext);
    const first = new WorldCombatRuntime(7, 2);
    first.attachRequiredBindings(requiredBindings());
    first.activate();
    const clearFirst = world.setCombat(first);

    clearFirst.detach();
    expect(first.phase).toBe('destroyed');

    const replacement = new WorldCombatRuntime(7, 3);
    replacement.attachRequiredBindings(requiredBindings());
    replacement.activate();
    world.setCombat(replacement);
    clearFirst.detach();

    expect(replacement.phase).toBe('active');
    expect(replacement.accepts({ worldRevision: 7, runtimeGeneration: 3 })).toBe(true);
    world.destroy();
    expect(replacement.phase).toBe('destroyed');
  });

  it('invalidates Combat before a throwing Presentation teardown sink runs', () => {
    const world = new WorldRuntime({
      descriptor: {
        worldRevision: 7,
        definitionId: 'world:test',
        seed: 1,
        generatorVersion: 1,
        layoutFingerprint: 'test',
      },
    } as WorldRuntimeContext);
    const combat = new WorldCombatRuntime(7, 2);
    combat.attachRequiredBindings(requiredBindings());
    combat.activate();
    world.setCombat(combat);
    let acceptsDuringPresentationDestroy: boolean | null = null;
    world.bindPresentationFrame({
      destroy: () => {
        acceptsDuringPresentationDestroy = combat.accepts(scope);
        throw new Error('presentation teardown failed');
      },
    } as WorldPresentationFrameBinding);

    expect(() => world.destroy()).toThrow('presentation teardown failed');
    expect(acceptsDuringPresentationDestroy).toBe(false);
    expect(combat.phase).toBe('destroyed');
    expect(combat.accepts(scope)).toBe(false);
  });
});
