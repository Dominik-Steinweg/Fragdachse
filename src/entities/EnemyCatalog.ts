import type { WeaponConfig } from '../loadout/LoadoutConfig';

export type CoopDefenseEnemyKind = 'zombie-badger' | 'rabid-badger';

export interface CoopDefenseEnemySpawnConfig {
  readonly intervalMs: number;
  readonly countPerWave: number;
}

export interface CoopDefenseEnemyConfig {
  readonly maxHp: number;
  readonly size: number;
  readonly moveSpeed: number;
  readonly weaponId: WeaponConfig['id'];
  readonly attackScanIntervalMs: number;
  readonly attackStopDurationMs: number;
  readonly imageKey: string;
  readonly color?: number;
  readonly spawnConfig: CoopDefenseEnemySpawnConfig;
}

export const COOP_DEFENSE_ENEMY_CONFIGS = {
  'zombie-badger': {
    maxHp: 40,
    size: 28,
    moveSpeed: 92,
    weaponId: 'BITE',
    attackScanIntervalMs: 200,
    attackStopDurationMs: 200,
    imageKey: 'badger',
    color: 0xe07830,
    spawnConfig: {
      intervalMs: 2000,
      countPerWave: 1,
    },
  },
  'rabid-badger': {
    maxHp: 20,
    size: 22,
    moveSpeed: 170,
    weaponId: 'BITE',
    attackScanIntervalMs: 200,
    attackStopDurationMs: 100,
    imageKey: 'badger',
    color: 0xcc2020,
    spawnConfig: {
      intervalMs: 20000,
      countPerWave: 3,
    },
  },
} as const satisfies Record<CoopDefenseEnemyKind, CoopDefenseEnemyConfig>;
