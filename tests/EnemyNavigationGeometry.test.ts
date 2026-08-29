import { describe, expect, it } from 'vitest';

import { EnemyFlowFieldService, type EnemyFlowFieldMetrics } from '../src/systems/EnemyFlowFieldService';
import { FlowFieldCoordinator } from '../src/systems/flowfield/FlowFieldCoordinator';
import { InlineFlowFieldRunner } from '../src/systems/flowfield/FlowFieldRunner';
import {
  buildStaticKindRaster,
  createFlowFieldTuning,
  goalCellsToIndexes,
  resolveGridChange,
} from '../src/systems/flowfield/FlowFieldSources';
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

function createVerticalTracks(gridX: number): ArenaLayout['tracks'] {
  return Array.from({ length: METRICS.rows }, (_, gridY) => ({ gridX, gridY }));
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
  it('treats collisionless placeables as placement reservations, not flowfield obstacles', () => {
    expect(resolveGridChange({
      reason: 'placeable_added',
      source: 'placeable_turret',
      gridX: 3,
      gridY: 3,
      collisionMode: 'none',
    })).toEqual({ gridX: 3, gridY: 3, occupied: false });
    expect(resolveGridChange({
      reason: 'placeable_added',
      source: 'placeable_turret',
      gridX: 3,
      gridY: 3,
    })).toEqual({ gridX: 3, gridY: 3, occupied: true });
  });

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

  it('rebuilds topology and flow data locally after a map-grid change', () => {
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
    // Die Koordinate schaltet den persistenten Occupancy-Raster direkt; der globale Provider wird
    // im normalen lokalen Pfad nicht erneut gelesen.
    expect(obstacleReads).toBe(initialReads);
    expect(service.getKindAt(3, 3)).toBe('rock');
    expect(service.isTraversableAt(3, 3)).toBe(false);
    expect(service.isDestructibleAt(3, 3)).toBe(true);
    expect(service.getIntegrationValueAt(3, 3)).toBe(EnemyFlowFieldService.INTEGRATION_INFINITY);

    eventBus.emitGridChange({ reason: 'placeable_removed', source: 'placeable_rock', gridX: 3, gridY: 3 });
    expect(service.update(Date.now() + 2_000)).toBe(true);
    expect(obstacleReads).toBe(initialReads);
    expect(service.getKindAt(3, 3)).toBe('ground');
  });

  it('derives one topology for several independent goal fields', () => {
    // Loest den frueheren `topologySource`-Vertrag ab: Statt Arrays zwischen Service-Instanzen zu
    // teilen, haelt der Coordinator eine Topologie und speist daraus mehrere Felder.
    let obstacleCells: ReadonlyArray<{ gridX: number; gridY: number }> = [];
    let obstacleReads = 0;
    const coordinator = new FlowFieldCoordinator({
      metrics: METRICS,
      tuning: createFlowFieldTuning(),
      staticKind: buildStaticKindRaster(createLayout(), METRICS),
      bases: [],
      activeBaseIds: new Set<string>(),
      obstacleCellProvider: () => {
        obstacleReads += 1;
        return obstacleCells;
      },
      runner: new InlineFlowFieldRunner(true),
      navTickIntervalMs: 50,
    });
    const left = EnemyFlowFieldService.fromView(coordinator.registerField('left', { goalMode: 'dynamic' }));
    const right = EnemyFlowFieldService.fromView(coordinator.registerField('right', { goalMode: 'dynamic' }));
    coordinator.setGoalCells('left', goalCellsToIndexes([{ gridX: 2, gridY: 5 }], METRICS));
    coordinator.setGoalCells('right', goalCellsToIndexes([{ gridX: 13, gridY: 5 }], METRICS));
    coordinator.prepareNow();
    const readsAfterSetup = obstacleReads;

    obstacleCells = [{ gridX: 3, gridY: 3 }];
    coordinator.patchCell(3, 3, true);
    coordinator.advance(50);
    coordinator.advance(50);

    // Ein Ereignis mit Koordinate aktualisiert nur die eine Zelle und liest den Provider nicht.
    expect(obstacleReads).toBe(readsAfterSetup);
    expect(left.getKindAt(3, 3)).toBe('rock');
    expect(right.getKindAt(3, 3)).toBe('rock');
    // Beide Felder behalten trotz gemeinsamer Topologie ihre eigene Zielmenge.
    expect(left.getReachedGoalCellAt(4, 5)).toEqual({ gridX: 2, gridY: 5 });
    expect(right.getReachedGoalCellAt(12, 5)).toEqual({ gridX: 13, gridY: 5 });
    coordinator.destroy();
  });

  it('keeps a full provider fallback for coordinate-less topology changes', () => {
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
    eventBus.emitGridChange({ reason: 'placeable_added', source: 'placeable_rock' });

    expect(service.update(Date.now() + 1_000)).toBe(true);
    expect(obstacleReads).toBe(initialReads + 1);
    expect(service.getKindAt(3, 3)).toBe('rock');
  });

  it('keeps tracks passable and exits a vertical rail run before following it longitudinally', () => {
    const service = new EnemyFlowFieldService(
      createLayout({ tracks: createVerticalTracks(6) }),
      [],
      METRICS,
      { goalMode: 'dynamic', dynamicGoalCells: [{ gridX: 12, gridY: 0 }] },
    );

    expect(service.getKindAt(6, 5)).toBe('track');
    expect(service.isTraversableAt(6, 5)).toBe(true);
    expect(service.getIntegrationValueAt(6, 5)).toBeLessThan(EnemyFlowFieldService.INTEGRATION_INFINITY);

    const vector = service.getVectorAt(6, 5);
    expect(vector.x).toBeGreaterThan(0);
    expect(Math.abs(vector.y)).toBeLessThanOrEqual(Math.abs(vector.x));

    const forcedRailRoute = new EnemyFlowFieldService(
      createLayout({
        tracks: createVerticalTracks(6),
        rocks: Array.from({ length: METRICS.rows }, (_, gridY) => [
          { gridX: 5, gridY },
          { gridX: 8, gridY },
        ]).flat() as ArenaLayout['rocks'],
      }),
      [],
      METRICS,
      { goalMode: 'dynamic', dynamicGoalCells: [{ gridX: 6, gridY: 0 }] },
    );
    expect(forcedRailRoute.getIntegrationValueAt(6, 5))
      .toBeLessThan(EnemyFlowFieldService.INTEGRATION_INFINITY);
  });
});
