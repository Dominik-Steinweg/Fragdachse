import rawCoopDefenseEnemies from './coopDefenseEnemies.json';
import type { WeaponConfig } from '../loadout/LoadoutConfig';

export type CoopDefenseEnemyKind = string;

export type CoopDefenseEnemyMovementTarget = 'bases' | 'players';

export type CoopDefenseEnemyWeaponTargetMode = 'all' | 'players';

export interface CoopDefenseEnemyWeaponConfig {
  readonly weaponId: WeaponConfig['id'];
  readonly targetMode: CoopDefenseEnemyWeaponTargetMode;
}

export interface CoopDefenseEnemyTranslocatorConfig {
  readonly utilityId: 'TRANSLOCATOR';
  readonly flightTimeMs: number;
  readonly cooldownMs: number;
  readonly minRange: number;
  readonly maxRange: number;
}

export interface CoopDefenseEnemyPlayerScaling {
  readonly maxHpFactorPerAdditionalPlayer?: number;
  readonly moveSpeedFactorPerAdditionalPlayer?: number;
}

export interface CoopDefenseEnemySpawnScaling {
  readonly intervalMsFactorPerAdditionalPlayer?: number;
  readonly countPerWaveFactorPerAdditionalPlayer?: number;
}

export interface CoopDefenseEnemyConfig {
  readonly maxHp: number;
  readonly xp: number;
  readonly size: number;
  readonly moveSpeed: number;
  readonly movementTarget: CoopDefenseEnemyMovementTarget;
  readonly weapons: readonly CoopDefenseEnemyWeaponConfig[];
  readonly attackScanIntervalMs: number;
  readonly attackStopDurationMs: number;
  readonly imageKey: string;
  readonly isBoss?: boolean;
  readonly displayName?: string;
  readonly color?: number;
  readonly translocator?: CoopDefenseEnemyTranslocatorConfig;
  readonly playerScaling?: CoopDefenseEnemyPlayerScaling;
  readonly spawnScaling?: CoopDefenseEnemySpawnScaling;
}

export type ResolvedCoopDefenseEnemyConfig = Omit<CoopDefenseEnemyConfig, 'playerScaling'>;

export type ResolvedCoopDefenseEnemyConfigs = Record<CoopDefenseEnemyKind, ResolvedCoopDefenseEnemyConfig>;

interface CoopDefenseEnemyRegistryEntry extends CoopDefenseEnemyConfig {
  readonly id: string;
}

interface CoopDefenseEnemyRegistryFile {
  readonly enemies: readonly CoopDefenseEnemyRegistryEntry[];
}

const COOP_DEFENSE_ENEMY_REGISTRY = normalizeEnemyRegistry(rawCoopDefenseEnemies as CoopDefenseEnemyRegistryFile);

export const COOP_DEFENSE_ENEMY_CONFIGS: Record<CoopDefenseEnemyKind, CoopDefenseEnemyConfig> = COOP_DEFENSE_ENEMY_REGISTRY;

/**
 * Stabile, geordnete Liste aller Gegner-Arten. Reihenfolge folgt der Insertion-Order der
 * gebündelten JSON-Registry und ist daher auf Host und Client identisch – nur deshalb darf der
 * Index als kompakter Wire-Wert für `kind` verwendet werden (siehe enemySnapshotCodec.ts).
 */
export const COOP_DEFENSE_ENEMY_KINDS: readonly CoopDefenseEnemyKind[] = Object.keys(COOP_DEFENSE_ENEMY_REGISTRY);

export function getCoopDefenseEnemyKindIndex(kind: CoopDefenseEnemyKind): number {
  return COOP_DEFENSE_ENEMY_KINDS.indexOf(kind);
}

export function getCoopDefenseEnemyKindByIndex(index: number): CoopDefenseEnemyKind | undefined {
  return COOP_DEFENSE_ENEMY_KINDS[index];
}

export function hasCoopDefenseEnemyKind(kind: string): kind is CoopDefenseEnemyKind {
  return Object.prototype.hasOwnProperty.call(COOP_DEFENSE_ENEMY_CONFIGS, kind);
}

export function getCoopDefenseEnemyConfig(kind: CoopDefenseEnemyKind): CoopDefenseEnemyConfig {
  const config = COOP_DEFENSE_ENEMY_CONFIGS[kind];
  if (!config) {
    throw new Error(`[coopDefenseEnemies] Unknown enemy kind: ${kind}`);
  }
  return config;
}

export function getCoopDefenseEnemyXp(kind: CoopDefenseEnemyKind): number {
  return getCoopDefenseEnemyConfig(kind).xp;
}

export function resolveCoopDefenseEnemyConfigs(humanPlayerCount: number): ResolvedCoopDefenseEnemyConfigs {
  const normalizedHumanPlayerCount = Math.max(1, Math.floor(humanPlayerCount));

  return Object.fromEntries(
    Object.entries(COOP_DEFENSE_ENEMY_CONFIGS).map(([kind, config]) => [
      kind,
      {
        maxHp: resolvePositiveInteger(
          config.maxHp,
          config.playerScaling?.maxHpFactorPerAdditionalPlayer,
          normalizedHumanPlayerCount,
        ),
        xp: Math.max(0, Math.floor(config.xp)),
        size: config.size,
        moveSpeed: resolvePositiveNumber(
          config.moveSpeed,
          config.playerScaling?.moveSpeedFactorPerAdditionalPlayer,
          normalizedHumanPlayerCount,
        ),
        movementTarget: config.movementTarget,
        weapons: config.weapons,
        attackScanIntervalMs: config.attackScanIntervalMs,
        attackStopDurationMs: config.attackStopDurationMs,
        imageKey: config.imageKey,
        isBoss: config.isBoss,
        displayName: config.displayName,
        color: config.color,
        translocator: config.translocator,
        spawnScaling: config.spawnScaling,
      },
    ]),
  ) as ResolvedCoopDefenseEnemyConfigs;
}

export function resolveCoopDefenseEnemyWaveConfig(
  kind: CoopDefenseEnemyKind,
  baseWaveConfig: { intervalMs: number; countPerWave: number },
  humanPlayerCount: number,
): { intervalMs: number; countPerWave: number } {
  const normalizedHumanPlayerCount = Math.max(1, Math.floor(humanPlayerCount));
  const config = getCoopDefenseEnemyConfig(kind);

  return {
    intervalMs: resolvePositiveNumber(
      baseWaveConfig.intervalMs,
      config.spawnScaling?.intervalMsFactorPerAdditionalPlayer,
      normalizedHumanPlayerCount,
    ),
    countPerWave: resolveNonNegativeInteger(
      baseWaveConfig.countPerWave,
      config.spawnScaling?.countPerWaveFactorPerAdditionalPlayer,
      normalizedHumanPlayerCount,
    ),
  };
}

function normalizeEnemyRegistry(registry: CoopDefenseEnemyRegistryFile): Record<string, CoopDefenseEnemyConfig> {
  const byId: Record<string, CoopDefenseEnemyConfig> = {};
  for (const enemy of registry.enemies) {
    if (typeof enemy.id !== 'string' || enemy.id.trim().length === 0) {
      throw new Error('[coopDefenseEnemies] Enemy id must be a non-empty string');
    }
    if (byId[enemy.id]) {
      throw new Error(`[coopDefenseEnemies] Duplicate enemy id: ${enemy.id}`);
    }
    byId[enemy.id] = normalizeEnemyConfig(enemy);
  }
  return byId;
}

function normalizeEnemyConfig(enemy: CoopDefenseEnemyRegistryEntry): CoopDefenseEnemyConfig {
  return {
    maxHp: Math.max(1, Math.floor(enemy.maxHp)),
    xp: Math.max(0, Math.floor(enemy.xp)),
    size: Math.max(1, enemy.size),
    moveSpeed: Math.max(1, enemy.moveSpeed),
    movementTarget: normalizeMovementTarget(enemy.movementTarget),
    weapons: normalizeWeapons(enemy.weapons, enemy.id),
    attackScanIntervalMs: Math.max(1, Math.floor(enemy.attackScanIntervalMs)),
    attackStopDurationMs: Math.max(0, Math.floor(enemy.attackStopDurationMs)),
    imageKey: enemy.imageKey,
    isBoss: enemy.isBoss === true,
    displayName: typeof enemy.displayName === 'string' && enemy.displayName.trim().length > 0
      ? enemy.displayName.trim()
      : undefined,
    color: typeof enemy.color === 'number' && Number.isFinite(enemy.color)
      ? Math.max(0, Math.floor(enemy.color))
      : undefined,
    translocator: normalizeTranslocatorConfig(enemy.translocator, enemy.id),
    playerScaling: normalizePlayerScaling(enemy.playerScaling),
    spawnScaling: normalizeSpawnScaling(enemy.spawnScaling),
  };
}

function normalizeTranslocatorConfig(
  config: CoopDefenseEnemyTranslocatorConfig | undefined,
  enemyId: string,
): CoopDefenseEnemyTranslocatorConfig | undefined {
  if (!config) return undefined;
  if (config.utilityId !== 'TRANSLOCATOR') {
    throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} references unsupported translocator utility`);
  }
  const minRange = Math.max(0, config.minRange);
  return {
    utilityId: 'TRANSLOCATOR',
    flightTimeMs: Math.max(1, Math.floor(config.flightTimeMs)),
    cooldownMs: Math.max(1, Math.floor(config.cooldownMs)),
    minRange,
    maxRange: Math.max(minRange, config.maxRange),
  };
}

function normalizeWeapons(
  weapons: readonly CoopDefenseEnemyWeaponConfig[],
  enemyId: string,
): readonly CoopDefenseEnemyWeaponConfig[] {
  if (!Array.isArray(weapons) || weapons.length === 0) {
    throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} must have at least one weapon`);
  }

  const weaponIds = new Set<string>();
  return weapons.map((weapon) => {
    if (typeof weapon.weaponId !== 'string' || weapon.weaponId.trim().length === 0) {
      throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} has an invalid weapon id`);
    }
    if (weaponIds.has(weapon.weaponId)) {
      throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} has duplicate weapon ${weapon.weaponId}`);
    }
    weaponIds.add(weapon.weaponId);
    return {
      weaponId: weapon.weaponId,
      targetMode: normalizeWeaponTargetMode(weapon.targetMode, enemyId),
    };
  });
}

function normalizeWeaponTargetMode(
  targetMode: CoopDefenseEnemyWeaponTargetMode,
  enemyId: string,
): CoopDefenseEnemyWeaponTargetMode {
  if (targetMode === 'all' || targetMode === 'players') return targetMode;
  throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} has unsupported weapon target mode: ${String(targetMode)}`);
}

function normalizeMovementTarget(target: CoopDefenseEnemyMovementTarget): CoopDefenseEnemyMovementTarget {
  if (target === 'bases' || target === 'players') {
    return target;
  }
  throw new Error(`[coopDefenseEnemies] Unsupported movementTarget: ${String(target)}`);
}

function normalizePlayerScaling(
  scaling: CoopDefenseEnemyPlayerScaling | undefined,
): CoopDefenseEnemyPlayerScaling | undefined {
  if (!scaling) return undefined;
  return {
    maxHpFactorPerAdditionalPlayer: normalizeFactor(scaling.maxHpFactorPerAdditionalPlayer),
    moveSpeedFactorPerAdditionalPlayer: normalizeFactor(scaling.moveSpeedFactorPerAdditionalPlayer),
  };
}

function normalizeSpawnScaling(
  scaling: CoopDefenseEnemySpawnScaling | undefined,
): CoopDefenseEnemySpawnScaling | undefined {
  if (!scaling) return undefined;
  return {
    intervalMsFactorPerAdditionalPlayer: normalizeFactor(scaling.intervalMsFactorPerAdditionalPlayer),
    countPerWaveFactorPerAdditionalPlayer: normalizeFactor(scaling.countPerWaveFactorPerAdditionalPlayer),
  };
}

function normalizeFactor(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
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
