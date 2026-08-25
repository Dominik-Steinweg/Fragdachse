import {
  COOP_DEFENSE_CONSTRUCTIONS,
  getConstructionIdForUtility,
  normalizeConstructionId,
  type CoopDefenseConstructionDefinition,
} from '../config/coopDefenseConstructions';
import type {
  ConstructionId,
  CoopDefenseClassId,
  GameMode,
  LoadoutCommitSnapshot,
  LoadoutToolRef,
} from '../types';
import {
  getCoopDefenseUpgradeState,
  isCoopDefenseLoadoutItemUnlocked,
} from '../utils/coopDefenseUpgrades';

export type ConstructionAccessDormantReason =
  | 'unknown-tool'
  | 'mode-not-allowed'
  | 'class-not-allowed'
  | 'locked'
  | 'not-in-loadout';

export interface ConstructionAccessContext {
  readonly gameMode: GameMode;
  readonly classId: CoopDefenseClassId | null | undefined;
  readonly profile: LoadoutCommitSnapshot['coopDefenseProfile'] | null | undefined;
  readonly loadout: Pick<LoadoutCommitSnapshot, 'utility' | 'tools'> | null | undefined;
}

export interface ConstructionAccessResult {
  readonly constructionId: ConstructionId | null;
  readonly definition: CoopDefenseConstructionDefinition | null;
  readonly allowed: boolean;
  readonly unlocked: boolean;
  readonly active: boolean;
  readonly reason?: ConstructionAccessDormantReason;
}

/**
 * Resolves the complete construction gate in one place. The same result is used by placement,
 * radial selection and persistent restore; an unlocked but unequipped tool is deliberately
 * represented as dormant instead of being deleted.
 */
export function resolveConstructionAccess(
  requestedId: unknown,
  context: ConstructionAccessContext,
): ConstructionAccessResult {
  const constructionId = normalizeConstructionId(requestedId);
  if (!constructionId) return {
    constructionId: null,
    definition: null,
    allowed: false,
    unlocked: false,
    active: false,
    reason: 'unknown-tool',
  };

  const definition = COOP_DEFENSE_CONSTRUCTIONS[constructionId];
  const isSharedUtility = constructionId === 'rock_barrier' || constructionId === 'spore_turret';
  if (context.gameMode === 'coop_defense' && !isSharedUtility && context.classId !== 'inspector_gadachs') {
    return { constructionId, definition, allowed: false, unlocked: false, active: false, reason: 'class-not-allowed' };
  }
  if (context.gameMode !== 'coop_defense' && !isSharedUtility) {
    return { constructionId, definition, allowed: false, unlocked: false, active: false, reason: 'mode-not-allowed' };
  }

  const profile = context.profile;
  const utilityId = constructionId === 'rock_barrier' ? 'ROCK_BARRIER' : 'SPORE_TURRET';
  const unlocked = context.gameMode === 'coop_defense'
    ? !!profile && (isSharedUtility
      ? isCoopDefenseLoadoutItemUnlocked(profile, 'utility', utilityId, context.classId ?? undefined)
      : getCoopDefenseUpgradeState(profile, definition.unlockUpgradeId, context.classId ?? undefined).level > 0)
    : true;
  if (!unlocked) return { constructionId, definition, allowed: false, unlocked: false, active: false, reason: 'locked' };

  const active = isConstructionActiveInLoadout(constructionId, context.loadout);
  if (!active) return { constructionId, definition, allowed: false, unlocked: true, active: false, reason: 'not-in-loadout' };
  return { constructionId, definition, allowed: true, unlocked: true, active: true };
}

export function getAccessibleConstructionIds(context: ConstructionAccessContext): readonly ConstructionId[] {
  return Object.keys(COOP_DEFENSE_CONSTRUCTIONS)
    .map((id) => resolveConstructionAccess(id, context))
    .filter((result) => result.allowed)
    .map((result) => result.constructionId as ConstructionId);
}

/** Returns only construction tools that are both unlocked and currently equipped. */
export function getActiveConstructionToolRefs(context: ConstructionAccessContext): readonly LoadoutToolRef[] {
  const tools = context.classId === 'inspector_gadachs'
    ? ((context.loadout?.tools?.length ?? 0) > 0
      ? context.loadout!.tools!
      : context.loadout?.utility
        ? [{ kind: 'utility', id: context.loadout.utility } satisfies LoadoutToolRef]
        : [])
    : context.loadout?.utility
      ? [{ kind: 'utility', id: context.loadout.utility } satisfies LoadoutToolRef]
      : [];
  const result: LoadoutToolRef[] = [];
  const seen = new Set<ConstructionId>();
  for (const tool of tools) {
    const id = normalizeConstructionId(tool.id);
    if (!id || seen.has(id)) continue;
    const access = resolveConstructionAccess(id, context);
    if (!access.allowed) continue;
    seen.add(id);
    // Canonical identity is used for all runtime actions, including a legacy utility slot.
    result.push({ kind: 'construction', id });
  }
  return result;
}

export function isConstructionActiveInLoadout(
  constructionId: ConstructionId,
  loadout: Pick<LoadoutCommitSnapshot, 'utility' | 'tools'> | null | undefined,
): boolean {
  if (!loadout) return false;
  if (loadout.tools?.some((tool) => normalizeConstructionId(tool.id) === constructionId)) return true;
  return getConstructionIdForUtility(loadout.utility) === constructionId;
}

/** Lightweight helper for callers that already hold a committed snapshot. */
export function getConstructionAccessContext(
  gameMode: GameMode,
  committed: LoadoutCommitSnapshot | null | undefined,
): ConstructionAccessContext {
  return {
    gameMode,
    classId: committed?.coopDefenseClassId,
    profile: committed?.coopDefenseProfile,
    loadout: committed,
  };
}
