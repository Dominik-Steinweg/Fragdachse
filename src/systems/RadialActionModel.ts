import { COLORS } from '../config';
import {
  getCoopDefenseConstructionDefinition,
  getToolCapacityCost,
  normalizeConstructionId,
} from '../config/coopDefenseConstructions';
import { getLocale, t } from '../i18n';
import { getPowerUpName } from '../i18n/contentPresentation';
import { describeLoadoutTool } from '../loadout/LoadoutCatalog';
import { getUtilityConfigForMode } from '../loadout/LoadoutConfig';
import { getPersistentBaseRewardDefinition } from '../persistentBase/PersistentBaseRewardCatalog';
import type { PersistentBaseRewardId } from '../persistentBase/PersistentBaseRewardTypes';
import { POWERUP_DEFS } from '../powerups/PowerUpConfig';
import type { ConstructionId, GameMode, LoadoutToolRef, TemporaryUtilityInstanceDescriptor } from '../types';

export type RadialActionCategory =
  | 'utility'
  | 'temporaryUtility'
  | 'construction'
  | 'persistentReward'
  | 'managementAction'
  | 'specialPower';

export type RadialManagementAction = 'reposition' | 'dismantle' | 'dismantle-own-all';

export type RadialActionRef =
  | { readonly kind: 'utility'; readonly utilityId: string }
  | { readonly kind: 'temporary-utility'; readonly instanceId: string; readonly utilityId: string }
  | { readonly kind: 'construction'; readonly constructionId: ConstructionId }
  | { readonly kind: 'persistent-reward'; readonly rewardId: PersistentBaseRewardId }
  | { readonly kind: 'management'; readonly action: RadialManagementAction };

export type RadialToolActionRef = Extract<RadialActionRef, { kind: 'utility' | 'construction' }>;

export type RadialActionDisabledReason =
  | 'cooldown'
  | 'capacity'
  | 'no-charges'
  | 'player-blocked'
  | 'unavailable';

export interface RadialActionState {
  readonly ref: RadialActionRef;
  readonly category: RadialActionCategory;
  readonly label: string;
  readonly iconKey: string | null;
  readonly accentColor: number;
  readonly visible: boolean;
  readonly available: boolean;
  readonly disabledReason?: RadialActionDisabledReason;
  readonly cooldownUntil: number;
  readonly cooldownDurationMs: number;
  readonly charges?: number;
  readonly capacityCost?: number;
}

export interface ResolveRadialActionsInput {
  readonly gameMode: GameMode;
  readonly tools: readonly LoadoutToolRef[];
  readonly temporaryUtilities?: readonly TemporaryUtilityInstanceDescriptor[];
  readonly persistentRewardIds: readonly PersistentBaseRewardId[];
  readonly usedCapacity: number;
  readonly capacityMax: number;
  readonly now: number;
  readonly canUseUtility: boolean;
  readonly canPlace: boolean;
  readonly canManage: boolean;
  readonly managementActions?: readonly RadialManagementAction[];
  readonly getCooldownUntil?: (ref: RadialActionRef) => number;
}

const MANAGEMENT_ORDER: Readonly<Record<RadialManagementAction, number>> = Object.freeze({
  reposition: 0,
  dismantle: 1,
  'dismantle-own-all': 2,
});

/** Stable serializable identity shared by input, HUD and the radial renderer. */
export function radialActionKey(ref: RadialActionRef): string {
  switch (ref.kind) {
    case 'utility': return `utility:${ref.utilityId}`;
    case 'temporary-utility': return `temporaryUtility:${ref.instanceId}`;
    case 'construction': return `construction:${ref.constructionId}`;
    case 'persistent-reward': return `persistentReward:${ref.rewardId}`;
    case 'management': return `management:${ref.action}`;
  }
}

export function isSameRadialActionRef(
  left: RadialActionRef | null,
  right: RadialActionRef | null,
): boolean {
  return left === null || right === null
    ? left === right
    : radialActionKey(left) === radialActionKey(right);
}

export function cloneRadialActionRef(ref: RadialActionRef): RadialActionRef {
  return { ...ref } as RadialActionRef;
}

/** Converts legacy shared tool slots into the canonical action identity. */
export function radialActionRefFromTool(tool: LoadoutToolRef): RadialToolActionRef {
  const constructionId = normalizeConstructionId(tool.id);
  return constructionId
    ? { kind: 'construction', constructionId }
    : { kind: 'utility', utilityId: tool.id };
}

/**
 * Pure read-model resolver for Radial Menu V2. Domain providers decide which tools and rewards
 * exist; this resolver only normalizes identity, availability and deterministic presentation.
 */
export function resolveRadialActions(input: ResolveRadialActionsInput): RadialActionState[] {
  const freeCapacity = Math.max(0, input.capacityMax - input.usedCapacity);
  const entries: Array<RadialActionState & { readonly sourceOrder: number }> = [];
  const seen = new Set<string>();

  input.tools.forEach((tool, sourceOrder) => {
    const ref = radialActionRefFromTool(tool);
    const key = radialActionKey(ref);
    if (seen.has(key)) return;
    seen.add(key);

    const canonicalTool: LoadoutToolRef = ref.kind === 'construction'
      ? { kind: 'construction', id: ref.constructionId }
      : { kind: 'utility', id: ref.utilityId };
    const presentation = describeLoadoutTool(canonicalTool);
    const capacityCost = ref.kind === 'construction' ? getToolCapacityCost(canonicalTool) : 0;
    const cooldownDurationMs = ref.kind === 'construction'
      ? getCoopDefenseConstructionDefinition(ref.constructionId).buildCooldownMs
      : getUtilityConfigForMode(ref.utilityId, input.gameMode)?.cooldown ?? 0;
    const cooldownUntil = Math.max(0, input.getCooldownUntil?.(ref) ?? 0);
    const capabilityAllowed = ref.kind === 'construction' ? input.canPlace : input.canUseUtility;
    const hasCapacity = ref.kind !== 'construction' || capacityCost <= freeCapacity;
    const cooldownReady = cooldownUntil <= input.now;
    const disabledReason = !capabilityAllowed
      ? 'player-blocked'
      : !hasCapacity
        ? 'capacity'
        : !cooldownReady
          ? 'cooldown'
          : undefined;
    entries.push({
      ref,
      category: ref.kind === 'construction' ? 'construction' : 'utility',
      label: presentation.displayName,
      iconKey: presentation.textureKey,
      accentColor: presentation.accentColor,
      visible: true,
      available: disabledReason === undefined,
      ...(disabledReason ? { disabledReason } : {}),
      cooldownUntil,
      cooldownDurationMs,
      ...(capacityCost > 0 ? { capacityCost } : {}),
      sourceOrder,
    });
  });

  for (const instance of input.temporaryUtilities ?? []) {
    const ref: RadialActionRef = {
      kind: 'temporary-utility',
      instanceId: instance.instanceId,
      utilityId: instance.utilityId,
    };
    const key = radialActionKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    const utilityPresentation = describeLoadoutTool({ kind: 'utility', id: instance.utilityId });
    const powerUp = instance.kind === 'objective-placement'
      ? POWERUP_DEFS[instance.powerUpDefId]
      : undefined;
    const capabilityAllowed = input.canUseUtility;
    const hasCharges = instance.charges > 0;
    const cooldownReady = instance.cooldownUntil <= input.now;
    const disabledReason = !capabilityAllowed
      ? 'player-blocked'
      : !hasCharges
        ? 'no-charges'
        : !cooldownReady
          ? 'cooldown'
          : undefined;
    entries.push({
      ref,
      category: 'temporaryUtility',
      label: instance.kind === 'objective-placement'
        ? getPowerUpName(instance.powerUpDefId, getLocale())
        : utilityPresentation.displayName,
      iconKey: powerUp?.spriteKey ?? utilityPresentation.textureKey,
      accentColor: powerUp?.color ?? utilityPresentation.accentColor,
      visible: true,
      available: disabledReason === undefined,
      ...(disabledReason ? { disabledReason } : {}),
      cooldownUntil: instance.cooldownUntil,
      cooldownDurationMs: instance.cooldownDurationMs,
      charges: instance.charges,
      sourceOrder: instance.acquisitionOrder,
    });
  }

  input.persistentRewardIds.forEach((rewardId, sourceOrder) => {
    const ref: RadialActionRef = { kind: 'persistent-reward', rewardId };
    const key = radialActionKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    const definition = getPersistentBaseRewardDefinition(rewardId);
    entries.push({
      ref,
      category: 'persistentReward',
      label: t(definition.presentation.labelKey),
      iconKey: definition.presentation.iconKey,
      accentColor: COLORS.GOLD_2,
      visible: true,
      available: input.canPlace,
      ...(!input.canPlace ? { disabledReason: 'player-blocked' as const } : {}),
      cooldownUntil: 0,
      cooldownDurationMs: 0,
      sourceOrder,
    });
  });

  for (const action of input.managementActions ?? []) {
    const ref: RadialActionRef = { kind: 'management', action };
    const key = radialActionKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      ref,
      category: 'managementAction',
      label: getManagementActionLabel(action),
      iconKey: null,
      accentColor: action === 'dismantle-own-all' ? COLORS.GOLD_2 : COLORS.GREY_3,
      visible: true,
      available: input.canManage,
      ...(!input.canManage ? { disabledReason: 'player-blocked' as const } : {}),
      cooldownUntil: 0,
      cooldownDurationMs: 0,
      sourceOrder: MANAGEMENT_ORDER[action],
    });
  }

  const categoryOrder: Readonly<Record<RadialActionCategory, number>> = {
    utility: 0,
    temporaryUtility: 1,
    construction: 2,
    persistentReward: 3,
    managementAction: 4,
    specialPower: 5,
  };
  return entries
    .filter((entry) => entry.visible)
    .sort((left, right) => (
      categoryOrder[left.category] - categoryOrder[right.category]
      || left.sourceOrder - right.sourceOrder
      || radialActionKey(left.ref).localeCompare(radialActionKey(right.ref))
    ))
    .map(({ sourceOrder: _sourceOrder, ...entry }) => entry);
}

function getManagementActionLabel(action: RadialManagementAction): string {
  switch (action) {
    case 'reposition': return t('ui.radial.reposition');
    case 'dismantle': return t('ui.radial.dismantle');
    case 'dismantle-own-all': return t('ui.radial.dismantleAll');
  }
}
