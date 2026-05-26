import type { WeaponConfig } from '../loadout/LoadoutConfig';

export type CoopDefenseEnemyKind = 'zombie-badger' | 'demon-badger' | 'rabid-badger';

export type CoopDefenseEnemyMovementTarget = 'bases' | 'players';

export interface CoopDefenseEnemySpawnConfig {
  readonly intervalMs: number;
  readonly countPerWave: number;
}

export interface CoopDefenseEnemyPlayerScaling {
  readonly maxHpFactorPerAdditionalPlayer?: number;
  readonly moveSpeedFactorPerAdditionalPlayer?: number;
  readonly intervalMsFactorPerAdditionalPlayer?: number;
  readonly countPerWaveFactorPerAdditionalPlayer?: number;
}

export interface CoopDefenseEnemyConfig {
  readonly maxHp: number;
  readonly size: number;
  readonly moveSpeed: number;
  readonly movementTarget: CoopDefenseEnemyMovementTarget;
  readonly weaponId: WeaponConfig['id'];
  readonly attackScanIntervalMs: number;
  readonly attackStopDurationMs: number;
  readonly imageKey: string;
  readonly color?: number;
  readonly spawnConfig: CoopDefenseEnemySpawnConfig;
  readonly playerScaling?: CoopDefenseEnemyPlayerScaling;
}

export type ResolvedCoopDefenseEnemyConfig = Omit<CoopDefenseEnemyConfig, 'playerScaling'>;

export type ResolvedCoopDefenseEnemyConfigs = Record<CoopDefenseEnemyKind, ResolvedCoopDefenseEnemyConfig>;

export const COOP_DEFENSE_ENEMY_CONFIGS = {
  'zombie-badger': {
    maxHp: 20,
    size: 28,
    moveSpeed: 70,
    movementTarget: 'bases',
    weaponId: 'BITE',
    attackScanIntervalMs: 200,
    attackStopDurationMs: 200,
    imageKey: 'badger',
    color: 0xe07830,
    spawnConfig: {
      intervalMs: 2000,
      countPerWave: 1,
    },
    playerScaling: {
      maxHpFactorPerAdditionalPlayer: 0.5,
      moveSpeedFactorPerAdditionalPlayer: 0,
      intervalMsFactorPerAdditionalPlayer: -0.5,
      countPerWaveFactorPerAdditionalPlayer: 0,
    },
  },
  'demon-badger': {
    maxHp: 15,
    size: 24,
    moveSpeed: 140,
    movementTarget: 'bases',
    weaponId: 'BITE',
    attackScanIntervalMs: 200,
    attackStopDurationMs: 200,
    imageKey: 'badger',
    color: 0xffaa44,
    spawnConfig: {
      intervalMs: 10000,
      countPerWave: 2,
    },
    playerScaling: {
      maxHpFactorPerAdditionalPlayer: 0.5,
      moveSpeedFactorPerAdditionalPlayer: 0,
      intervalMsFactorPerAdditionalPlayer: 0,
      countPerWaveFactorPerAdditionalPlayer: 0.5,
    },
  },  
  'rabid-badger': {
    maxHp: 10,
    size: 22,
    moveSpeed: 180,
    movementTarget: 'players',
    weaponId: 'BITE',
    attackScanIntervalMs: 200,
    attackStopDurationMs: 100,
    imageKey: 'badger',
    color: 0xcc2020,
    spawnConfig: {
      intervalMs: 20000,
      countPerWave: 3,
    },
    playerScaling: {
      maxHpFactorPerAdditionalPlayer: 0,
      moveSpeedFactorPerAdditionalPlayer: 0,
      intervalMsFactorPerAdditionalPlayer: -1,
      countPerWaveFactorPerAdditionalPlayer: 1 / 3,
    },
  },
} as const satisfies Record<CoopDefenseEnemyKind, CoopDefenseEnemyConfig>;

export function resolveCoopDefenseEnemyConfigs(humanPlayerCount: number): ResolvedCoopDefenseEnemyConfigs {
  const normalizedHumanPlayerCount = Math.max(1, Math.floor(humanPlayerCount));

  return Object.fromEntries(
    (Object.entries(COOP_DEFENSE_ENEMY_CONFIGS) as [CoopDefenseEnemyKind, CoopDefenseEnemyConfig][]).map(([kind, config]) => [
      kind,
      {
        maxHp: resolvePositiveInteger(
          config.maxHp,
          config.playerScaling?.maxHpFactorPerAdditionalPlayer,
          normalizedHumanPlayerCount,
        ),
        size: config.size,
        moveSpeed: resolvePositiveNumber(
          config.moveSpeed,
          config.playerScaling?.moveSpeedFactorPerAdditionalPlayer,
          normalizedHumanPlayerCount,
        ),
        movementTarget: config.movementTarget,
        weaponId: config.weaponId,
        attackScanIntervalMs: config.attackScanIntervalMs,
        attackStopDurationMs: config.attackStopDurationMs,
        imageKey: config.imageKey,
        color: config.color,
        spawnConfig: {
          intervalMs: resolvePositiveNumber(
            config.spawnConfig.intervalMs,
            config.playerScaling?.intervalMsFactorPerAdditionalPlayer,
            normalizedHumanPlayerCount,
          ),
          countPerWave: resolveNonNegativeInteger(
            config.spawnConfig.countPerWave,
            config.playerScaling?.countPerWaveFactorPerAdditionalPlayer,
            normalizedHumanPlayerCount,
          ),
        },
      },
    ]),
  ) as ResolvedCoopDefenseEnemyConfigs;
}

function resolvePositiveInteger(baseValue: number, factor: number | undefined, humanPlayerCount: number): number {
  return Math.max(1, Math.round(scaleByHumanPlayers(baseValue, factor, humanPlayerCount)));
}

function resolveNonNegativeInteger(baseValue: number, factor: number | undefined, humanPlayerCount: number): number {
  return Math.max(0, Math.round(scaleByHumanPlayers(baseValue, factor, humanPlayerCount)));
}

function resolvePositiveNumber(baseValue: number, factor: number | undefined, humanPlayerCount: number): number {
  return Math.max(1, scaleByHumanPlayers(baseValue, factor, humanPlayerCount));
}

function scaleByHumanPlayers(baseValue: number, factor: number | undefined, humanPlayerCount: number): number {
  const extraPlayers = Math.max(0, humanPlayerCount - 1);
  const normalizedFactor = factor ?? 0;
  if (extraPlayers === 0 || normalizedFactor === 0) {
    return baseValue;
  }

  if (normalizedFactor > 0) {
    return baseValue * (1 + normalizedFactor * extraPlayers);
  }

  return baseValue / (1 + Math.abs(normalizedFactor) * extraPlayers);
}
