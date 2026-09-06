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
import type { ProjectileDirectImpactRequest } from '../src/projectile/ProjectileCombatPort';
import { WorldRuntime } from '../src/world/WorldRuntime';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';

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

describe('WorldCombatRuntime build and ownership contract', () => {
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
});
