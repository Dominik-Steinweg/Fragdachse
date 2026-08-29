import {
  isPersistentBaseRewardId,
  PERSISTENT_BASE_REWARD_IDS,
  type PersistentBaseRewardCategory,
  type PersistentBaseRewardId,
  type PersistentBaseRewardPlacementRule,
} from './PersistentBaseRewardTypes';

export interface PersistentBaseRewardDefinition {
  readonly id: PersistentBaseRewardId;
  readonly category: PersistentBaseRewardCategory;
  readonly runtime: {
    readonly kind: 'power-up-pedestal' | 'construction';
    readonly powerUpDefId?: string;
    readonly constructionId?: 'spore_turret' | 'rocket_turret';
  };
  readonly initialState: {
    readonly respawnMs: number | null;
    readonly spawnOnArenaStart: boolean;
  };
  readonly placementRule: PersistentBaseRewardPlacementRule;
  readonly presentation: {
    readonly labelKey: string;
    readonly iconKey: string;
  };
}

export const PERSISTENT_BASE_REWARD_DEFINITIONS: readonly PersistentBaseRewardDefinition[] = Object.freeze([
  {
    id: 'base_adrenaline_pedestal',
    category: 'basePedestal',
    runtime: {
      kind: 'power-up-pedestal',
      powerUpDefId: 'ADRENALINE',
    },
    initialState: { respawnMs: 10_000, spawnOnArenaStart: true },
    placementRule: 'courtyard-build-area',
    presentation: { labelKey: 'powerup.ADRENALINE.name', iconKey: 'powerup_adr' },
  },
  {
    id: 'base_spore_turret',
    category: 'baseTurret',
    runtime: { kind: 'construction', constructionId: 'spore_turret' },
    initialState: { respawnMs: null, spawnOnArenaStart: true },
    placementRule: 'base-surface',
    presentation: { labelKey: 'loadout.SPORE_TURRET.name', iconKey: 'UPGRADE_UNLOCK_FLIEGENPILZ' },
  },
  {
    id: 'base_health_pedestal',
    category: 'basePedestal',
    runtime: {
      kind: 'power-up-pedestal',
      powerUpDefId: 'HEALTH_PACK',
    },
    initialState: { respawnMs: 5_000, spawnOnArenaStart: true },
    placementRule: 'courtyard-build-area',
    presentation: { labelKey: 'powerup.HEALTH_PACK.name', iconKey: 'powerup_hp' },
  },
  {
    id: 'base_rocket_turret',
    category: 'baseTurret',
    runtime: { kind: 'construction', constructionId: 'rocket_turret' },
    initialState: { respawnMs: null, spawnOnArenaStart: true },
    placementRule: 'base-surface',
    presentation: { labelKey: 'construction.rocket_turret.name', iconKey: 'UPGRADE_UNLOCK_ROCKET_TURRET' },
  },
  {
    id: 'base_holy_hand_grenade_pedestal',
    category: 'basePedestal',
    runtime: {
      kind: 'power-up-pedestal',
      powerUpDefId: 'HOLY_HAND_GRENADE',
    },
    initialState: { respawnMs: 30_000, spawnOnArenaStart: true },
    placementRule: 'courtyard-build-area',
    presentation: { labelKey: 'powerup.HOLY_HAND_GRENADE.name', iconKey: 'powerup_hhg' },
  },
]);

export function getPersistentBaseRewardDefinition(
  id: PersistentBaseRewardId,
): PersistentBaseRewardDefinition {
  return PERSISTENT_BASE_REWARD_DEFINITIONS.find((definition) => definition.id === id)!;
}

export function isKnownPersistentBaseRewardId(value: unknown): value is PersistentBaseRewardId {
  return isPersistentBaseRewardId(value)
    && PERSISTENT_BASE_REWARD_DEFINITIONS.some((definition) => definition.id === value);
}

export function getPersistentBaseRewardIds(): readonly PersistentBaseRewardId[] {
  return PERSISTENT_BASE_REWARD_IDS;
}
