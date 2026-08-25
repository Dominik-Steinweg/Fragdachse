import type { PersistentBaseRewardId, PlaceableKind } from '../types';
export type { PersistentBaseRewardId } from '../types';

export interface PersistentBaseRewardDefinition {
  readonly id: PersistentBaseRewardId;
  readonly constructionType: 'watchtower' | 'holy-hand-pedestal' | 'burrow';
  readonly unlockAfterMapId: string;
  readonly unique: true;
  readonly footprint: readonly { readonly dx: number; readonly dy: number }[];
  readonly rebuildCooldownMs: number;
  readonly runtimeDestructible: boolean;
  readonly maxHp: number;
  readonly kind: PlaceableKind;
  readonly capacityCost: number;
  readonly indestructible?: boolean;
  readonly powerUpDefId?: 'HOLY_HAND_GRENADE';
  readonly weaponRangeMultiplier?: number;
  readonly adrenalineRegenMultiplier?: number;
}

const SINGLE_CELL_FOOTPRINT = Object.freeze([{ dx: 0, dy: 0 }]);
const WATCHTOWER_FOOTPRINT = Object.freeze([
  { dx: 0, dy: 0 }, { dx: 1, dy: 0 },
  { dx: 0, dy: 1 }, { dx: 1, dy: 1 },
]);

/** One source of truth for reward unlocks, runtime rules and prototype tuning. */
export const PERSISTENT_BASE_REWARD_DEFINITIONS: Readonly<Record<PersistentBaseRewardId, PersistentBaseRewardDefinition>> = Object.freeze({
  watchtower: {
    id: 'watchtower',
    constructionType: 'watchtower',
    unlockAfterMapId: '11',
    unique: true,
    footprint: WATCHTOWER_FOOTPRINT,
    rebuildCooldownMs: 5_000,
    runtimeDestructible: true,
    maxHp: 1_500,
    kind: 'turret',
    capacityCost: 0,
    weaponRangeMultiplier: 1.25,
    adrenalineRegenMultiplier: 1.5,
  },
  holy_hand_pedestal: {
    id: 'holy_hand_pedestal',
    constructionType: 'holy-hand-pedestal',
    unlockAfterMapId: '12',
    unique: true,
    footprint: SINGLE_CELL_FOOTPRINT,
    rebuildCooldownMs: 0,
    runtimeDestructible: false,
    maxHp: 1,
    kind: 'pedestal',
    capacityCost: 0,
    indestructible: true,
    powerUpDefId: 'HOLY_HAND_GRENADE',
  },
  burrow: {
    id: 'burrow',
    constructionType: 'burrow',
    unlockAfterMapId: '13',
    unique: true,
    footprint: SINGLE_CELL_FOOTPRINT,
    rebuildCooldownMs: 5_000,
    runtimeDestructible: true,
    maxHp: 2_000,
    kind: 'rock',
    capacityCost: 0,
  },
});

export interface PersistentBaseRewardPlacement {
  readonly rewardId: PersistentBaseRewardId;
  readonly persistentId: string;
  readonly relativeGridX: number;
  readonly relativeGridY: number;
  readonly angle: number;
  readonly placementOrder: number;
}

export type PersistentBaseRewardAvailability =
  | 'locked'
  | 'available'
  | 'placed'
  | 'reconstruction-cooldown';

export interface PersistentBaseRewardRuntimeState {
  readonly rewardId: PersistentBaseRewardId;
  readonly availability: PersistentBaseRewardAvailability;
  readonly cooldownRemainingMs: number;
  readonly cooldownTotalMs: number;
  readonly placement: PersistentBaseRewardPlacement | null;
}

export function getPersistentBaseRewardDefinition(
  rewardId: string,
): PersistentBaseRewardDefinition | null {
  return PERSISTENT_BASE_REWARD_DEFINITIONS[rewardId as PersistentBaseRewardId] ?? null;
}

/** Only structural rewards participate in enemy target selection; the pedestal is never a target. */
export function isPersistentBaseRewardEnemyTarget(rewardId: string): boolean {
  const definition = getPersistentBaseRewardDefinition(rewardId);
  return definition?.constructionType === 'watchtower' || definition?.constructionType === 'burrow';
}
