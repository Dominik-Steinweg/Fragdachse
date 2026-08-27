import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    RND: { pick: (values: unknown[]) => values[0] },
    Distance: { Squared: (x1: number, y1: number, x2: number, y2: number) => ((x1 - x2) ** 2) + ((y1 - y2) ** 2) },
  },
}));

import { applyArenaMetricsForMode, GRID_COLS, GRID_ROWS } from '../src/config';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager, EnemySpawnOptions } from '../src/entities/EnemyManager';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { CoopDefenseSpawnExecutor } from '../src/systems/CoopDefenseSpawnExecutor';
import type { EnemyFlowFieldService } from '../src/systems/EnemyFlowFieldService';
import { SPAWN_FRONTS, type SpawnFront } from '../src/utils/spawnFront';

interface SpawnRecord {
  readonly gridX: number;
  readonly gridY: number;
  readonly options: EnemySpawnOptions;
}

function createExecutor(
  records: SpawnRecord[],
  isTraversableAt: (gridX: number, gridY: number) => boolean = () => true,
  getIntegrationValueAt: (gridX: number, gridY: number) => number = () => 0,
  playerFlowFieldService?: EnemyFlowFieldService,
) {
  const enemyManager = {
    getAllEnemies: () => [],
    hostSpawnDummyAt: (
      gridX: number,
      gridY: number,
      _kind: string,
      options: EnemySpawnOptions = {},
    ) => {
      records.push({ gridX, gridY, options });
      return fakeEntity({ id: `spawn-${records.length}`, x: gridX * 32, y: gridY * 32, getCollisionRadius: () => 12 }) as unknown as EnemyEntity;
    },
  } as unknown as EnemyManager;
  const flowField = {
    isTraversableAt,
    getIntegrationValueAt,
    // Erreichbare Integrationswerte bedeuten ein Feld mit Zielen; nur die Zellform bleibt leer.
    hasGoalCells: () => true,
    getGoalCells: () => [],
    getCols: () => GRID_COLS,
    getRows: () => GRID_ROWS,
    gridToWorld: (gridX: number, gridY: number) => ({ x: gridX * 32, y: gridY * 32 }),
  } as unknown as EnemyFlowFieldService;
  return new CoopDefenseSpawnExecutor(enemyManager, flowField, undefined, playerFlowFieldService);
}

function expectOnFront(record: SpawnRecord, front: SpawnFront): void {
  switch (front) {
    case 'west':
      expect(record.gridX).toBeLessThanOrEqual(Math.min(Math.max(2, Math.floor(GRID_COLS * 0.15)), GRID_COLS - 1));
      break;
    case 'east':
      expect(record.gridX).toBeGreaterThanOrEqual(
        GRID_COLS - 1 - Math.min(Math.max(2, Math.floor(GRID_COLS * 0.15)), GRID_COLS - 1),
      );
      break;
    case 'north':
      expect(record.gridY).toBeLessThanOrEqual(Math.min(Math.max(2, Math.floor(GRID_ROWS * 0.15)), GRID_ROWS - 1));
      break;
    case 'south':
      expect(record.gridY).toBeGreaterThanOrEqual(
        GRID_ROWS - 1 - Math.min(Math.max(2, Math.floor(GRID_ROWS * 0.15)), GRID_ROWS - 1),
      );
      break;
  }
}

describe('CoopDefenseSpawnExecutor fronts', () => {
  it('selects a traversable edge band for every authored front', () => {
    const records: SpawnRecord[] = [];
    const executor = createExecutor(records);

    for (const front of SPAWN_FRONTS) {
      executor.hostSpawnPersistentMapGroup('zombie-badger', 1, front);
      const record = records.at(-1)!;
      expect(record.options).toMatchObject({ spawnFront: front });
      expectOnFront(record, front);
    }
  });

  it('keeps edge-burrow spawns on the authored border while passing the front to movement', () => {
    const records: SpawnRecord[] = [];
    const executor = createExecutor(records);

    for (const front of SPAWN_FRONTS) {
      executor.hostSpawnEncounterGroup('alien-badger', 1, `encounter-${front}`, front);
      const record = records.at(-1)!;
      expect(record.options).toMatchObject({ originId: `encounter-${front}`, spawnFront: front });
      if (front === 'west') expect(record.gridX).toBe(0);
      if (front === 'east') expect(record.gridX).toBe(GRID_COLS - 1);
      if (front === 'north') expect(record.gridY).toBe(0);
      if (front === 'south') expect(record.gridY).toBe(GRID_ROWS - 1);
    }
  });

  it('uses live grid dimensions and does not silently replace an exhausted front', () => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', 90, 44);
    try {
      const records: SpawnRecord[] = [];
      const eastBandDepth = Math.min(Math.max(2, Math.floor(GRID_COLS * 0.15)), GRID_COLS - 1);
      const executor = createExecutor(
        records,
        (gridX) => gridX < GRID_COLS - 1 - eastBandDepth,
      );

      expect(executor.hostSpawnPersistentMapGroup('zombie-badger', 1, 'east')).toEqual([]);
      expect(records).toHaveLength(0);
      expect(GRID_COLS).toBe(90);
      expect(GRID_ROWS).toBe(44);
    } finally {
      applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'LOBBY');
    }
  });

  it('uses the player flow field for player-target enemies on a map without bases', () => {
    const records: SpawnRecord[] = [];
    const playerFlowField = {
      isTraversableAt: () => true,
      getIntegrationValueAt: () => 0,
      getGoalCells: () => [{ gridX: 25, gridY: 15 }],
      getCols: () => GRID_COLS,
      getRows: () => GRID_ROWS,
      gridToWorld: (gridX: number, gridY: number) => ({ x: gridX * 32, y: gridY * 32 }),
    } as unknown as EnemyFlowFieldService;
    const executor = createExecutor(
      records,
      () => true,
      () => EnemyFlowFieldService.INTEGRATION_INFINITY,
      playerFlowField,
    );

    expect(executor.hostSpawnEncounterGroup('rabid-badger', 1, 'map-9-opening', 'west')).toHaveLength(1);
    expect(records[0].options).toMatchObject({ originId: 'map-9-opening', spawnFront: 'west' });
  });

  it('allows the first player-target spawn before dynamic player goals are computed', () => {
    const records: SpawnRecord[] = [];
    const playerFlowField = {
      isTraversableAt: () => true,
      getIntegrationValueAt: () => EnemyFlowFieldService.INTEGRATION_INFINITY,
      getGoalCells: () => [],
      getCols: () => GRID_COLS,
      getRows: () => GRID_ROWS,
      gridToWorld: (gridX: number, gridY: number) => ({ x: gridX * 32, y: gridY * 32 }),
    } as unknown as EnemyFlowFieldService;
    const executor = createExecutor(
      records,
      () => true,
      () => EnemyFlowFieldService.INTEGRATION_INFINITY,
      playerFlowField,
    );

    expect(executor.hostSpawnEncounterGroup('void-stalker', 1, 'map-9-opening', 'east')).toHaveLength(1);
    expect(records[0].options).toMatchObject({ originId: 'map-9-opening', spawnFront: 'east' });
  });
});
