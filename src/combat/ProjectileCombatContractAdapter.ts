import type {
  ProjectileCombatTargetRef,
  ProjectileDirectImpactRequest,
} from '../projectile/ProjectileCombatPort';
import type { ProjectileProvenance } from '../projectile/ProjectileSpawnRequest';
import type { DirectCombatDamageRequest } from './CombatMutation';
import type {
  CombatAttributionRef,
  CombatScope,
  CombatSource,
  CombatSourceEntityRef,
  CombatTargetInstance,
  CombatTargetRef,
} from './CombatScope';

type ProjectileCombatSourceKind = Exclude<CombatSourceEntityRef['kind'], 'decoy'>;

export interface ProjectileCombatSourceClassification {
  readonly gameplaySourceKind: ProjectileCombatSourceKind;
  readonly attributionKind: CombatAttributionRef['kind'];
  readonly actor?: CombatSourceEntityRef;
}

/** Lossless Projectile provenance translation; attribution never falls back to allegiance. */
export function adaptProjectileCombatSource(
  provenance: ProjectileProvenance,
  projectileId: number,
  classification: ProjectileCombatSourceClassification,
): CombatSource {
  const actor = classification.actor ?? (provenance.sourceTurretId
    ? { kind: 'turret' as const, id: provenance.sourceTurretId }
    : undefined);
  return {
    gameplaySource: {
      kind: classification.gameplaySourceKind,
      id: provenance.gameplaySourceId,
    },
    actor,
    attribution: {
      kind: classification.attributionKind,
      id: provenance.attributionId,
    },
    allegiance: { ...provenance.allegiance },
    ...(provenance.portalDamage ? { portalDamage: provenance.portalDamage } : {}),
    authoredSourceId: provenance.weaponSourceId,
    sourceSlot: provenance.sourceSlot,
    origin: 'direct',
    lineage: provenance.lineage ? { ...provenance.lineage } : undefined,
    correlation: {
      projectileId,
      shotId: provenance.correlation?.ak47ShotId,
    },
  };
}

/** The adapter receives a concrete instance from the target owner; ids alone are insufficient. */
export function adaptProjectileCombatTarget(
  target: ProjectileCombatTargetRef,
  scope: CombatScope,
  instance: CombatTargetInstance,
): CombatTargetRef {
  return { ...target, scope, instance };
}

/**
 * Maps only the stable direct-impact contract. Unmarked payloads still need source resolution;
 * factors explicitly applied by automatic execution remain visible and are not applied twice.
 * Neither Projectile flight state nor target modifiers are read at this boundary.
 */
export function adaptProjectileDirectDamageRequest(
  request: ProjectileDirectImpactRequest,
  outcomeId: string,
  scope: CombatScope,
  instance: CombatTargetInstance,
  classification: ProjectileCombatSourceClassification,
): DirectCombatDamageRequest {
  const appliedSourceFactors = request.directHit.appliedSourceDamageFactors;
  return {
    outcomeId,
    entry: 'projectile-direct',
    damageKind: 'direct',
    target: adaptProjectileCombatTarget(request.target, scope, instance),
    source: adaptProjectileCombatSource(request.provenance, request.projectileId, classification),
    basis: appliedSourceFactors && appliedSourceFactors.length > 0
      ? {
        kind: 'source-resolved',
        amount: request.directHit.damage,
        sourceFactors: appliedSourceFactors.map((factor) => ({ ...factor })),
      }
      : { kind: 'authored', amount: request.directHit.damage },
    targetScaling: 'pending',
    allowCritical: true,
  };
}
