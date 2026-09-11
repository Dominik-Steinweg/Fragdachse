import {
  COOP_DEFENSE_CONSTRUCTIONS,
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
  isCoopDefenseUpgradeAvailableForClass,
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
  if (!definition.allowedModes.includes(context.gameMode)) {
    return { constructionId, definition, allowed: false, unlocked: false, active: false, reason: 'mode-not-allowed' };
  }
  if (context.gameMode === 'coop_defense'
    && !isCoopDefenseUpgradeAvailableForClass(definition.unlockUpgradeId, context.classId ?? undefined)) {
    return { constructionId, definition, allowed: false, unlocked: false, active: false, reason: 'class-not-allowed' };
  }
  const unlocked = context.gameMode !== 'coop_defense' || (!!context.profile
    && getCoopDefenseUpgradeState(context.profile, definition.unlockUpgradeId, context.classId ?? undefined).level > 0);
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
  const tools = context.loadout?.tools ?? (context.loadout?.utility ? [{ kind: 'utility', id: context.loadout.utility } satisfies LoadoutToolRef] : []);
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
  const tools = loadout.tools ?? [{ kind: 'utility', id: loadout.utility }];
  return tools.some(tool => normalizeConstructionId(tool.id) === constructionId);
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
