import type { WeaponConfig } from '../loadout/LoadoutConfig';

export type CoopDefenseEnemyKind = 'dummy';

export interface CoopDefenseEnemyConfig {
  readonly maxHp: number;
  readonly size: number;
  readonly moveSpeed: number;
  readonly weaponId: WeaponConfig['id'];
  readonly attackScanIntervalMs: number;
  readonly attackStopDurationMs: number;
}

export const COOP_DEFENSE_ENEMY_CONFIGS = {
  dummy: {
    maxHp: 100,
    size: 28,
    moveSpeed: 92,
    weaponId: 'BITE',
    attackScanIntervalMs: 200,
    attackStopDurationMs: 200,
  },
} as const satisfies Record<CoopDefenseEnemyKind, CoopDefenseEnemyConfig>;