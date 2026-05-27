import rawCoopDefenseMaps from './coopDefenseMaps.json';
import {
  resolveCoopDefenseEnemyWaveConfig,
  type CoopDefenseEnemyKind,
} from '../entities/EnemyCatalog';

export interface CoopBaseCellOffset {
  readonly gridX: number;
  readonly gridY: number;
}

export type CoopBaseAnchor =
  | { kind: 'right-center'; edgeInsetCells: number }
  | { kind: 'left-center'; edgeInsetCells: number }
  | { kind: 'center-offset'; dxCells: number; dyCells: number };

export type CoopBaseShape =
  | { kind: 'rectangle'; widthCells: number; heightCells: number }
  | { kind: 'cells'; cells: readonly CoopBaseCellOffset[] };

export interface CoopBaseConfig {
  readonly id: string;
  readonly hpMax: number;
  readonly anchor: CoopBaseAnchor;
  readonly shape: CoopBaseShape;
}

export interface CoopDefenseMapWaveConfig {
  readonly enemyKind: CoopDefenseEnemyKind;
  readonly intervalMs: number;
  readonly countPerWave: number;
  readonly startAtMs?: number;
}

export interface ResolvedCoopDefenseMapWaveConfig {
  readonly enemyKind: CoopDefenseEnemyKind;
  readonly intervalMs: number;
  readonly countPerWave: number;
  readonly startAtMs: number;
}

export interface CoopDefenseMapConfig {
  readonly mapId: string;
  readonly displayName: string;
  readonly roundDurationSec: number;
  readonly bases: readonly CoopBaseConfig[];
  readonly waves: readonly CoopDefenseMapWaveConfig[];
}

interface CoopDefenseMapRegistryFile {
  readonly defaultMapId: string;
  readonly maps: readonly CoopDefenseMapConfig[];
}

const COOP_DEFENSE_MAP_REGISTRY = normalizeMapRegistry(rawCoopDefenseMaps as CoopDefenseMapRegistryFile);

export const COOP_DEFENSE_MAP_CONFIGS = COOP_DEFENSE_MAP_REGISTRY.maps;
export const DEFAULT_COOP_DEFENSE_MAP_ID = COOP_DEFENSE_MAP_REGISTRY.defaultMapId;

const MAPS_BY_ID = new Map<string, CoopDefenseMapConfig>(
  COOP_DEFENSE_MAP_CONFIGS.map((mapConfig) => [mapConfig.mapId, mapConfig]),
);

export function getCoopDefenseMapConfig(mapId: string): CoopDefenseMapConfig {
  return MAPS_BY_ID.get(mapId) ?? getDefaultCoopDefenseMapConfig();
}

export function getDefaultCoopDefenseMapConfig(): CoopDefenseMapConfig {
  const mapConfig = MAPS_BY_ID.get(DEFAULT_COOP_DEFENSE_MAP_ID);
  if (!mapConfig) {
    throw new Error(`[coopDefenseMaps] Unknown default map id: ${DEFAULT_COOP_DEFENSE_MAP_ID}`);
  }
  return mapConfig;
}

export function resolveCoopDefenseMapWaveConfigs(
  mapConfig: CoopDefenseMapConfig,
  humanPlayerCount: number,
): readonly ResolvedCoopDefenseMapWaveConfig[] {
  return mapConfig.waves.map((waveConfig) => {
    const resolvedWaveConfig = resolveCoopDefenseEnemyWaveConfig(waveConfig.enemyKind, waveConfig, humanPlayerCount);
    return {
      enemyKind: waveConfig.enemyKind,
      intervalMs: resolvedWaveConfig.intervalMs,
      countPerWave: resolvedWaveConfig.countPerWave,
      startAtMs: Math.max(0, Math.floor(waveConfig.startAtMs ?? 0)),
    };
  });
}

function normalizeMapRegistry(registry: CoopDefenseMapRegistryFile): CoopDefenseMapRegistryFile {
  const maps = registry.maps.map(normalizeMapConfig);
  const uniqueMapIds = new Set<string>();
  for (const mapConfig of maps) {
    if (uniqueMapIds.has(mapConfig.mapId)) {
      throw new Error(`[coopDefenseMaps] Duplicate map id: ${mapConfig.mapId}`);
    }
    uniqueMapIds.add(mapConfig.mapId);
  }
  if (!uniqueMapIds.has(registry.defaultMapId)) {
    throw new Error(`[coopDefenseMaps] Default map id is missing from maps: ${registry.defaultMapId}`);
  }
  return {
    defaultMapId: registry.defaultMapId,
    maps,
  };
}

function normalizeMapConfig(mapConfig: CoopDefenseMapConfig): CoopDefenseMapConfig {
  const uniqueBaseIds = new Set<string>();
  const bases = mapConfig.bases.map((baseConfig) => {
    if (uniqueBaseIds.has(baseConfig.id)) {
      throw new Error(`[coopDefenseMaps] Duplicate base id in map ${mapConfig.mapId}: ${baseConfig.id}`);
    }
    uniqueBaseIds.add(baseConfig.id);
    return normalizeBaseConfig(baseConfig);
  });

  return {
    mapId: mapConfig.mapId,
    displayName: mapConfig.displayName,
    roundDurationSec: Math.max(1, Math.floor(mapConfig.roundDurationSec)),
    bases,
    waves: mapConfig.waves.map(normalizeWaveConfig),
  };
}

function normalizeBaseConfig(baseConfig: CoopBaseConfig): CoopBaseConfig {
  return {
    id: baseConfig.id,
    hpMax: Math.max(1, Math.floor(baseConfig.hpMax)),
    anchor: normalizeBaseAnchor(baseConfig.anchor),
    shape: normalizeBaseShape(baseConfig.shape),
  };
}

function normalizeBaseAnchor(anchor: CoopBaseAnchor): CoopBaseAnchor {
  switch (anchor.kind) {
    case 'right-center':
    case 'left-center':
      return {
        kind: anchor.kind,
        edgeInsetCells: Math.max(0, Math.floor(anchor.edgeInsetCells)),
      };
    case 'center-offset':
      return {
        kind: 'center-offset',
        dxCells: Math.floor(anchor.dxCells),
        dyCells: Math.floor(anchor.dyCells),
      };
  }
}

function normalizeBaseShape(shape: CoopBaseShape): CoopBaseShape {
  if (shape.kind === 'rectangle') {
    return {
      kind: 'rectangle',
      widthCells: Math.max(1, Math.floor(shape.widthCells)),
      heightCells: Math.max(1, Math.floor(shape.heightCells)),
    };
  }

  return {
    kind: 'cells',
    cells: shape.cells.map((cell) => ({
      gridX: Math.max(0, Math.floor(cell.gridX)),
      gridY: Math.max(0, Math.floor(cell.gridY)),
    })),
  };
}

function normalizeWaveConfig(waveConfig: CoopDefenseMapWaveConfig): CoopDefenseMapWaveConfig {
  return {
    enemyKind: waveConfig.enemyKind,
    intervalMs: Math.max(1, Math.floor(waveConfig.intervalMs)),
    countPerWave: Math.max(0, Math.floor(waveConfig.countPerWave)),
    startAtMs: Math.max(0, Math.floor(waveConfig.startAtMs ?? 0)),
  };
}