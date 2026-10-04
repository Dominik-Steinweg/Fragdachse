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
import { CoopDefenseMapDirector } from '../src/systems/CoopDefenseMapDirector';
import { EnemyFlowFieldService } from '../src/systems/EnemyFlowFieldService';
import { SPAWN_FRONTS, type SpawnFront } from '../src/utils/spawnFront';
import { navigationTestWorld } from './navigationTestWorld';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import * as enemyConfigs from '../src/config/coopDefenseEnemies';
import { resolveActiveArenaWorldMetrics, resolveCoopDefenseWorldMetrics, worldCellCenter } from '../src/world/WorldMetrics';

describe('Spawn coordinates across World and navigation grids', () => {
  function setup() {
    const world = navigationTestWorld();
    const metrics = { ...resolveCoopDefenseWorldMetrics(8, 8), gridCols: 8, gridRows: 8,
      widthPx: 256, heightPx: 256, offsetX: 0, offsetY: 0, maxX: 256, maxY: 256 };
    const spawned: { x: number; y: number; radius: number; active: boolean }[] = [];
    const spawn = (x: number, y: number, kind: Parameters<typeof getCoopDefenseEnemyConfig>[0]) => {
      spawned.push({ x, y, radius: getCoopDefenseEnemyConfig(kind).size / 2, active: true });
      return { id: `spawn-${spawned.length}`, getCollisionRadius: () => getCoopDefenseEnemyConfig(kind).size / 2 };
    };
    const manager = { getAllEnemies: () => spawned.filter(p => p.active)
      .map(p => ({ sprite: p, getCollisionRadius: () => p.radius })), hostSpawnAtWorld: spawn,
      hostSpawnDummyAt: (gx: number, gy: number, kind: Parameters<typeof getCoopDefenseEnemyConfig>[0]) => {
        const p = worldCellCenter(metrics, gx, gy); return spawn(p.x, p.y, kind);
      } } as unknown as EnemyManager;
    world.goal(176, 176); world.flush();
    return { ...world, metrics, spawned, manager,
      executor: new CoopDefenseSpawnExecutor(manager, world.field, metrics, undefined, world.field) };
  }

  it('spawns at the checked world position on every front with a finer navigation grid', () => {
    const world = setup();
    for (const front of SPAWN_FRONTS) {
      expect(world.executor.hostSpawnEncounterGroup('zombie-badger', 1, 'front', front).enemyIds).toHaveLength(1);
      const p = world.spawned.at(-1)!;
      expect(world.geometry().isFree(p.x, p.y, p.radius), front).toBe(true);
    }
    world.destroy();
  });

  it('reads authored late-encounter areas in World cells, not navigation indices', () => {
    const world = setup();
    world.snapshot.obstacles.push({ id: 'rock:wrong-area', kind: 'rock', shape: 'rect', left: 64, top: 64, right: 128, bottom: 128, destructible: true });
    world.coordinator.invalidateGeometry(); world.flush();
    expect(world.executor.hostSpawnEncounterGroup('zombie-badger', 1, 'late', 'west',
      { gridX: 5, gridY: 5, widthCells: 1, heightCells: 1 }).enemyIds).toHaveLength(1);
    expect(world.spawned[0]).toMatchObject({ x: 176, y: 176 });
    world.destroy();
  });

  it('rejects a free center when the actual boss body overlaps neighboring rock', () => {
    const world = setup();
    world.snapshot.obstacles.push({ id: 'rock:neighbor', kind: 'rock', shape: 'rect', left: 192, top: 160, right: 224, bottom: 192, destructible: true });
    world.coordinator.invalidateGeometry(); world.flush();
    expect(world.executor.hostSpawnEncounterGroup('grave-titan', 1, 'boss', 'west',
      { gridX: 5, gridY: 5, widthCells: 1, heightCells: 1 })).toEqual({ enemyIds: [], deferred: false });
    expect(world.spawned).toHaveLength(0);
    world.destroy();
  });

  it('uses live physical geometry while a replacement navigation field is still pending', () => {
    const world = setup();
    world.snapshot.obstacles.push({ id: 'rock:new', kind: 'rock', shape: 'rect', left: 160, top: 160, right: 192, bottom: 192, destructible: true });
    world.coordinator.invalidateGeometry();
    expect(world.executor.hostSpawnEncounterGroup('zombie-badger', 1, 'blocked', 'west',
      { gridX: 5, gridY: 5, widthCells: 1, heightCells: 1 }).enemyIds).toHaveLength(0);
    world.destroy();
  });

  it('separates a burst by physical body size even for bodies wider than the usual cell spacing', () => {
    const boss = getCoopDefenseEnemyConfig('grave-titan');
    const config = vi.spyOn(enemyConfigs, 'getCoopDefenseEnemyConfig').mockReturnValue({ ...boss, size: 128 });
    const world = setup();
    try {
      const result = world.executor.hostSpawnEncounterGroup('grave-titan', 10, 'wide', 'west',
        { gridX: 0, gridY: 0, widthCells: 8, heightCells: 8 });
      expect(result.enemyIds.length).toBeGreaterThan(0);
      expect(result.deferred).toBe(true);
      for (let i = 0; i < world.spawned.length; i++) {
        const a = world.spawned[i];
        for (const b of world.spawned.slice(i + 1)) {
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.radius + b.radius);
        }
      }
    } finally { config.mockRestore(); world.destroy(); }
  });

  it('defers safe cells until the current navigation graph is ready', () => {
    const world = setup();
    world.snapshot.obstacles.push({ id: 'rock:elsewhere', kind: 'rock', shape: 'rect', left: 96, top: 0, right: 128, bottom: 32 });
    world.coordinator.invalidateGeometry();
    const area = { gridX: 1, gridY: 1, widthCells: 1, heightCells: 1 };
    expect(world.executor.hostSpawnEncounterGroup('zombie-badger', 1, 'pending', 'west', area))
      .toEqual({ enemyIds: [], deferred: true });
    world.flush();
    expect(world.executor.hostSpawnEncounterGroup('zombie-badger', 1, 'pending', 'west', area).enemyIds).toHaveLength(1);
    world.destroy();
  });

  it('retains a whole wave through prolonged foreign occupancy and drains the one-cell queue after release', () => {
    const world = setup();
    const area = { gridX: 1, gridY: 1, widthCells: 1, heightCells: 1 };
    world.manager.hostSpawnAtWorld(48, 48, 'zombie-badger');
    const waveSize = 5;
    const director = new CoopDefenseMapDirector([{
      id: 'corridor', start: { type: 'time', atMs: 0 },
      groups: [{ enemyKind: 'zombie-badger', count: waveSize, spawnArea: area }],
    }], (...args) => world.executor.hostSpawnEncounterGroup(...args), { spawnBackstopAfterMs: 100 });
    for (let i = 0; i < 100; i++) director.hostUpdate(100, false);
    expect(world.spawned).toHaveLength(1);
    expect(director.isEncounterSpawnComplete('corridor')).toBe(false);
    // Departures free the sole admission cell. Every attempt must re-read its occupancy.
    let elapsed = 0;
    while (!director.isEncounterSpawnComplete('corridor') && elapsed < 5_000) {
      world.spawned.forEach(enemy => { enemy.active = false; });
      director.hostUpdate(200, false);
      elapsed += 200;
      expect(world.spawned.filter(enemy => enemy.active)).toHaveLength(1);
    }
    expect(director.isEncounterSpawnComplete('corridor')).toBe(true);
    expect(world.spawned).toHaveLength(1 + waveSize);
    for (const p of world.spawned) expect(world.geometry().isFree(p.x, p.y, p.radius)).toBe(true);
    world.destroy();
  });

  it('spawns while moving goals await a new field, using current connected regions', () => {
    const world = setup();
    world.goal(224, 176);
    expect(world.field.queryNavigation(48, 48).status).toBe('pending');
    expect(world.executor.hostSpawnEncounterGroup('zombie-badger', 1, 'moving', 'west').enemyIds).toHaveLength(1);
    world.snapshot.obstacles.push({ id: 'new-wall', kind: 'barrier', shape: 'rect', left: 96, top: 0, right: 128, bottom: 256 });
    world.coordinator.invalidateGeometry(); world.flush();
    world.goal(208, 192);
    expect(world.executor.hostSpawnEncounterGroup('zombie-badger', 1, 'wrong-region', 'west').enemyIds).toHaveLength(0);
    world.destroy();
  });

  it('keeps buried arrivals on the World border and bosses inside the checked arena', () => {
    const world = setup();
    expect(world.executor.hostSpawnBoss('grave-titan')).toBe(true);
    const boss = world.spawned[0];
    expect(world.geometry().isFree(boss.x, boss.y, boss.radius)).toBe(true);
    expect(world.executor.hostSpawnEncounterGroup('alien-badger', 1, 'burrow', 'east').enemyIds).toHaveLength(1);
    expect(world.spawned.at(-1)?.x).toBe(240);
    world.destroy();
  });
});

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
  const metrics = resolveActiveArenaWorldMetrics();
  const worldToGrid = (x: number, y: number) => ({ gridX: Math.floor((x - metrics.offsetX) / 32), gridY: Math.floor((y - metrics.offsetY) / 32) });
  const enemyManager = {
    getAllEnemies: () => [],
    hostSpawnAtWorld: (
      x: number,
      y: number,
      _kind: string,
      options: EnemySpawnOptions = {},
    ) => {
      const { gridX, gridY } = worldToGrid(x, y);
      records.push({ gridX, gridY, options });
      return fakeEntity({ id: `spawn-${records.length}`, x: gridX * 32, y: gridY * 32, getCollisionRadius: () => 12 }) as unknown as EnemyEntity;
    },
  } as unknown as EnemyManager;
  const flowField = {
    isTraversableAt,
    getKindAt: () => 'empty',
    getIntegrationValueAt,
    // Erreichbare Integrationswerte bedeuten ein Feld mit Zielen; nur die Zellform bleibt leer.
    hasGoalCells: () => true,
    getGoalCells: () => [],
    getCols: () => GRID_COLS,
    getRows: () => GRID_ROWS,
    worldToGrid,
    getNavigationGeometry: () => null,
    isCircleGroundFreeAt: (x: number, y: number) => { const c = worldToGrid(x, y); return isTraversableAt(c.gridX, c.gridY); },
    gridToWorld: (gridX: number, gridY: number) => ({ x: gridX * 32, y: gridY * 32 }),
  } as unknown as EnemyFlowFieldService;
  if (playerFlowFieldService) Object.assign(playerFlowFieldService, {
    worldToGrid, getNavigationGeometry: () => null,
    isCircleGroundFreeAt: (x: number, y: number) => { const c = worldToGrid(x, y); return playerFlowFieldService.isTraversableAt(c.gridX, c.gridY); },
  });
  return new CoopDefenseSpawnExecutor(enemyManager, flowField, metrics, undefined, playerFlowFieldService);
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

    expect(executor.hostSpawnEncounterGroup('rabid-badger', 1, 'map-9-opening', 'west').enemyIds).toHaveLength(1);
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

    expect(executor.hostSpawnEncounterGroup('void-stalker', 1, 'map-9-opening', 'east').enemyIds).toHaveLength(1);
    expect(records[0].options).toMatchObject({ originId: 'map-9-opening', spawnFront: 'east' });
  });
});
