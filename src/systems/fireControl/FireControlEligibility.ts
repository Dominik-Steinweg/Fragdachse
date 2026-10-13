export const FIRE_CONTROL_ELIGIBLE_CONSTRUCTION_IDS = [
  'spore_turret',
  'rocket_turret',
  'machine_gun_turret',
  'flame_turret',
  'gravity_turret',
  'slow_bubble_turret',
] as const;

export const FIRE_CONTROL_ELIGIBLE_FIRE_TYPES = ['projectile', 'flamethrower'] as const;

export interface FireControlSourceFacts {
  readonly requesterId: string;
  readonly ownerId: string;
  readonly baseOwned: boolean;
  readonly constructionId: string | undefined;
  readonly weaponFireType: string | undefined;
  /** Includes existence, HP, carrier integrity and regular combat permission. */
  readonly combatReady: boolean;
  readonly isCopy: boolean;
  readonly copyMaterialized?: boolean;
  /** Applies to originals only. */
  readonly pausedByCopies?: boolean;
}

export type FireControlEligibilityReason =
  | 'foreign_owner'
  | 'base_owned'
  | 'construction_excluded'
  | 'fire_type_excluded'
  | 'not_combat_ready'
  | 'copy_materializing'
  | 'copy_not_copyable'
  | 'paused_original'
  | 'eligible';

export interface FireControlSourceEligibility {
  readonly copyable: boolean;
  readonly portalSource: boolean;
  readonly reason: FireControlEligibilityReason;
}

/**
 * First exclusion wins: ownership, construction, fire type, combat readiness, lifecycle.
 * An active copy reports copy_not_copyable while remaining eligible for portals.
 * Missing materialization information never grants a copy portal permission.
 */
export function classifyFireControlSource(facts: FireControlSourceFacts): FireControlSourceEligibility {
  const excluded = (reason: FireControlEligibilityReason): FireControlSourceEligibility =>
    ({ copyable: false, portalSource: false, reason });

  if (facts.ownerId !== facts.requesterId) return excluded('foreign_owner');
  if (facts.baseOwned) return excluded('base_owned');
  if (!FIRE_CONTROL_ELIGIBLE_CONSTRUCTION_IDS.some(id => id === facts.constructionId)) {
    return excluded('construction_excluded');
  }
  if (!FIRE_CONTROL_ELIGIBLE_FIRE_TYPES.some(type => type === facts.weaponFireType)) {
    return excluded('fire_type_excluded');
  }
  if (!facts.combatReady) return excluded('not_combat_ready');
  if (facts.isCopy) {
    if (!facts.copyMaterialized) return excluded('copy_materializing');
    return { copyable: false, portalSource: true, reason: 'copy_not_copyable' };
  }
  if (facts.pausedByCopies) return excluded('paused_original');
  return { copyable: true, portalSource: true, reason: 'eligible' };
}
