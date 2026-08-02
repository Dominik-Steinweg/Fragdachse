import { describe, expect, it } from 'vitest';

import { EnemyFlowFieldService, type EnemyFlowFieldMetrics } from '../src/systems/EnemyFlowFieldService';
import type { ArenaEventBus, ArenaMapGridChangedEvent } from '../src/scenes/arena/ArenaEvents';
import type { ArenaLayout } from '../src/types';
import type { BaseSpec } from '../src/arena/BaseRegistry';

const METRICS: EnemyFlowFieldMetrics = {
  cols: 16,
  rows: 11,
  cellSize: 32,
  arenaOffsetX: 0,
  arenaOffsetY: 0,
};

function createLayout(overrides: Partial<ArenaLayout> = {}): ArenaLayout {
  return {
    seed: 1,
    rocks: [],
    trees: [],
    tracks: [],
    dirt: [],
    powerUpPedestals: [],
    ...overrides,
  } as ArenaLayout;
}

function createBase(
  id: string,
  minGridX: number,
  minGridY: number,
  width: number,
  height: number,
): BaseSpec {
  const cells: { gridX: number; gridY: number }[] = [];
  for (let gridY = minGridY; gridY < minGridY + height; gridY += 1) {
    for (let gridX = minGridX; gridX < minGridX + width; gridX += 1) {
      cells.push({ gridX, gridY });
    }
  }
  return {
    id,
    cells,
    region: {
      minGridX,
      minGridY,
      maxGridX: minGridX + width - 1,
      maxGridY: minGridY + height - 1,
    },
    hpMax: 1000,
    faction: 'friendly',
    role: 'main',
    turrets: [],
    powerUpPedestals: [],
  } as unknown as BaseSpec;
}

function createEventBus(): ArenaEventBus & { emitGridChange(event: ArenaMapGridChangedEvent): void } {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const bus = {
    on(event: string, listener: (...args: any[]) => void, context?: unknown) {
      const bound = context ? listener.bind(context) : listener;
      listeners.set(event, [...(listeners.get(event) ?? []), bound]);
      return bus;
    },
    off() {
      return bus;
    },
    emit(event: string, ...args: any[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
      return true;
    },
    emitGridChange(event: ArenaMapGridChangedEvent) {
      bus.emit('arena-map-grid-changed', event);
    },
  } as ArenaEventBus & { emitGridChange(event: ArenaMapGridChangedEvent): void };
  return bus;
}

describe('Enemy navigation geometry', () => {
  it('keeps a 30px body inside a designated one-cell corridor', () => {
    const service = new EnemyFlowFieldService(
      createLayout(),
      [createBase('top', 4, 0, 3, 5), createBase('bottom', 4, 7, 3, 4)],
      METRICS,
    );

    expect(service.isCirclePositionFreeAt(5 * 32 + 16, 6 * 32 + 16, 15)).toBe(true);
  });

  it('detects a diagonal circle overlap at an obstacle corner', () => {
    const service = new EnemyFlowFieldService(
      createLayout({ rocks: [{ gridX: 2, gridY: 2 }] as ArenaLayout['rocks'] }),
      [],
      METRICS,
    );

    // Mittelpunkt und die kardinalen Randproben bleiben in freien Zellen; die diagonale Probe
    // tritt in die Felszelle ein, weil der Kreis die Ecke bei (64, 64) schneidet.
    expect(service.hasWalkableLine(62, 62, 62, 62)).toBe(true);
    expect(service.isCircleGroundFreeAt(62, 62, 15)).toBe(false);
  });

  it('rejects a special movement whose circular corridor clips an obstacle', () => {
    const service = new EnemyFlowFieldService(
      createLayout({ rocks: [{ gridX: 2, gridY: 2 }] as ArenaLayout['rocks'] }),
      [],
      METRICS,
    );

    // Die Mittelpunktlinie bleibt in Reihe 1 frei; der 30px-Koerper schneidet die Felsecke in
    // Reihe 2 dennoch.
    expect(service.hasWalkableLine(48, 62, 112, 62)).toBe(true);
    expect(service.hasWalkableCircleLine(48, 62, 112, 62, 15)).toBe(false);
  });

  it('does not rebuild static topology for a dynamic target update', () => {
    let obstacleReads = 0;
    const service = new EnemyFlowFieldService(createLayout(), [], METRICS, {
      goalMode: 'dynamic',
      obstacleCellProvider: () => {
        obstacleReads += 1;
        return [];
      },
    });
    const readsAfterConstruction = obstacleReads;
    const now = Date.now();

    service.setDynamicGoalCells([{ gridX: 8, gridY: 5 }]);
    expect(service.update(now + 1_000)).toBe(true);
    expect(obstacleReads).toBe(readsAfterConstruction);
  });

  it('rebuilds topology and flow data after a map-grid change', () => {
    let obstacleCells: ReadonlyArray<{ gridX: number; gridY: number }> = [];
    let obstacleReads = 0;
    const eventBus = createEventBus();
    const service = new EnemyFlowFieldService(createLayout(), [], METRICS, {
      eventBus,
      obstacleCellProvider: () => {
        obstacleReads += 1;
        return obstacleCells;
      },
      goalMode: 'dynamic',
      dynamicGoalCells: [{ gridX: 8, gridY: 5 }],
    });
    const initialReads = obstacleReads;
    obstacleCells = [{ gridX: 3, gridY: 3 }];
    eventBus.emitGridChange({ reason: 'placeable_added', source: 'placeable_rock', gridX: 3, gridY: 3 });

    expect(service.update(Date.now() + 1_000)).toBe(true);
    expect(obstacleReads).toBe(initialReads + 1);
    expect(service.getKindAt(3, 3)).toBe('rock');
    expect(service.isTraversableAt(3, 3)).toBe(false);
    expect(service.isDestructibleAt(3, 3)).toBe(true);
    expect(service.getIntegrationValueAt(3, 3)).toBe(EnemyFlowFieldService.INTEGRATION_INFINITY);
  });

  it('shares one topology refresh while keeping dynamic goal fields independent', () => {
    let obstacleCells: ReadonlyArray<{ gridX: number; gridY: number }> = [];
    let obstacleReads = 0;
    const eventBus = createEventBus();
    const source = new EnemyFlowFieldService(createLayout(), [], METRICS, {
      eventBus,
      obstacleCellProvider: () => {
        obstacleReads += 1;
        return obstacleCells;
      },
      goalMode: 'dynamic',
      dynamicGoalCells: [{ gridX: 2, gridY: 5 }],
    });
    const dependent = new EnemyFlowFieldService(createLayout(), [], METRICS, {
      eventBus,
      obstacleCellProvider: () => {
        throw new Error('shared topology must not query its own obstacle provider');
      },
      goalMode: 'dynamic',
      dynamicGoalCells: [{ gridX: 13, gridY: 5 }],
      topologySource: source,
    });
    const readsAfterConstruction = obstacleReads;

    obstacleCells = [{ gridX: 3, gridY: 3 }];
    eventBus.emitGridChange({ reason: 'placeable_added', source: 'placeable_rock', gridX: 3, gridY: 3 });
    expect(dependent.update(Date.now() + 1_000)).toBe(true);

    expect(obstacleReads).toBe(readsAfterConstruction + 1);
    expect(source.getKindAt(3, 3)).toBe('rock');
    expect(dependent.getKindAt(3, 3)).toBe('rock');
    expect(source.getReachedGoalCellAt(4, 5)).toEqual({ gridX: 2, gridY: 5 });
    expect(dependent.getReachedGoalCellAt(12, 5)).toEqual({ gridX: 13, gridY: 5 });
  });
});
