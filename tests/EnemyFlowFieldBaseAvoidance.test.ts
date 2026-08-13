import { describe, expect, it } from 'vitest';

import { EnemyFlowFieldService } from '../src/systems/EnemyFlowFieldService';
import type { BaseSpec } from '../src/arena/BaseRegistry';
import type { ArenaLayout } from '../src/types';

const CELL_SIZE = 32;
const COLS = 16;
const ROWS = 11;

const METRICS = {
  cols: COLS,
  rows: ROWS,
  cellSize: CELL_SIZE,
  arenaOffsetX: 0,
  arenaOffsetY: 0,
} as const;

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

/** Rechteckige Basis; nur die Felder, die das Flowfield tatsächlich liest, sind belegt. */
function createBase(
  id: string,
  minGridX: number,
  minGridY: number,
  width: number,
  height: number,
  overrides: Partial<Pick<BaseSpec, 'role' | 'dormantObjectiveId'>> = {},
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
    ...overrides,
  } as unknown as BaseSpec;
}

describe('Flow field around bases', () => {
  it('keeps the concrete source behind a shared dynamic multi-goal field', () => {
    const service = new EnemyFlowFieldService(createLayout(), [], METRICS, {
      goalMode: 'dynamic-fallback-bases',
    });
    service.setDynamicGoalCells([
      { gridX: 2, gridY: 5 },
      { gridX: 13, gridY: 5 },
    ]);
    service.update(Date.now() + 1_000);

    expect(service.getReachedGoalCellAt(3, 5)).toEqual({ gridX: 2, gridY: 5 });
    expect(service.getReachedGoalCellAt(12, 5)).toEqual({ gridX: 13, gridY: 5 });
  });

  it('does not fall back to a base when an exclusive dynamic target set becomes empty', () => {
    const service = new EnemyFlowFieldService(
      createLayout(),
      [createBase('base-1', 12, 4, 2, 2)],
      METRICS,
      { goalMode: 'dynamic', dynamicGoalCells: [{ gridX: 2, gridY: 5 }] },
    );

    expect(service.getIntegrationValueAt(3, 5)).toBeLessThan(EnemyFlowFieldService.INTEGRATION_INFINITY);
    service.setDynamicGoalCells([]);
    service.update(Date.now() + 1_000);

    expect(service.getReachedGoalCellAt(3, 5)).toBeNull();
    expect(service.getIntegrationValueAt(3, 5)).toBe(EnemyFlowFieldService.INTEGRATION_INFINITY);
  });

  it('routes base seekers to an active mission outpost when it is the nearer structure', () => {
    const missionOutpost = createBase('mission-outpost', 2, 5, 1, 1, {
      role: 'outpost',
      dormantObjectiveId: 'hold-outpost',
    });
    const service = new EnemyFlowFieldService(
      createLayout(),
      [createBase('main', 12, 4, 2, 2), missionOutpost],
      METRICS,
    );

    // Solange das Objective die Struktur dormant haelt, existiert sie als Ziel noch nicht.
    service.setActiveBaseIds(new Set(['main']));
    service.update(Date.now() + 1_000);
    expect(service.isGoalCell(3, 5)).toBe(false);
    expect(service.getReachedGoalCellAt(4, 5)?.gridX).toBe(11);

    // Nach der Aktivierung laeuft der pfadnaehere Gegner an den Vorposten statt an der Hauptbasis.
    service.setActiveBaseIds(new Set(['main', 'mission-outpost']));
    service.update(Date.now() + 2_000);
    expect(service.isGoalCell(3, 5)).toBe(true);
    expect(service.getReachedGoalCellAt(4, 5)).toEqual({ gridX: 3, gridY: 5 });
    // Weiter rechts bleibt die Hauptbasis das billigere Ziel; das Mehrzielfeld teilt sich auf.
    expect(service.getReachedGoalCellAt(10, 5)).toEqual({ gridX: 11, gridY: 5 });
  });

  it('keeps a decorative outpost without a secondary objective out of the goal set', () => {
    const service = new EnemyFlowFieldService(
      createLayout(),
      [createBase('main', 12, 4, 2, 2), createBase('decor-outpost', 2, 5, 1, 1, { role: 'outpost' })],
      METRICS,
    );

    expect(service.isGoalCell(3, 5)).toBe(false);
    expect(service.getReachedGoalCellAt(4, 5)?.gridX).toBe(11);
  });

  it('charges a surcharge on cells that touch a base, so open routes bow away from the wall', () => {
    const base = createBase('base-1', 6, 4, 3, 3);
    const service = new EnemyFlowFieldService(createLayout(), [base], METRICS);

    // Direkt über der oberen Basiskante: teuer und als wandnah markiert.
    expect(service.isWallAdjacentAt(7, 3)).toBe(true);
    expect(service.getCostAt(7, 3)).toBeGreaterThan(service.getCostAt(7, 1));
    // Diagonal an der Basisecke zählt ebenfalls – dort klemmen die Körper am stärksten.
    expect(service.isWallAdjacentAt(5, 3)).toBe(true);
    // Zwei Zellen entfernt ist der Weg wieder normal teuer.
    expect(service.isWallAdjacentAt(7, 2)).toBe(false);
  });

  it('leaves rock-adjacent cells untouched so enemies still run into rocks and bite them free', () => {
    const layout = createLayout({ rocks: [{ gridX: 6, gridY: 4 }] as ArenaLayout['rocks'] });
    const service = new EnemyFlowFieldService(layout, [createBase('base-1', 12, 4, 2, 2)], METRICS);

    expect(service.isWallAdjacentAt(6, 3)).toBe(false);
    expect(service.getCostAt(6, 3)).toBe(service.getCostAt(2, 2));
  });

  it('keeps a one-cell corridor between two bases passable despite the surcharge', () => {
    const service = new EnemyFlowFieldService(
      createLayout(),
      [createBase('left', 4, 0, 3, 5), createBase('right', 4, 7, 3, 4)],
      METRICS,
    );

    // Die einzige Lücke zwischen den beiden Footprints bleibt begehbar und behält eine Route.
    expect(service.isTraversableAt(5, 6)).toBe(true);
    expect(service.isWallAdjacentAt(5, 6)).toBe(true);
    expect(service.getIntegrationValueAt(5, 6)).toBeLessThan(EnemyFlowFieldService.INTEGRATION_INFINITY);
  });

  it('expands diagonal Dijkstra entries after Float32 storage', () => {
    const service = new EnemyFlowFieldService(
      createLayout({
        dirt: [
          { gridX: 1, gridY: 0 },
          { gridX: 0, gridY: 1 },
        ] as ArenaLayout['dirt'],
      }),
      [],
      METRICS,
      { goalMode: 'dynamic', dynamicGoalCells: [{ gridX: 0, gridY: 0 }] },
    );

    expect(service.getIntegrationValueAt(2, 2)).toBeCloseTo(2 * Math.SQRT2, 5);
    expect(service.getVectorAt(2, 2).x).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(service.getVectorAt(2, 2).y).toBeCloseTo(-Math.SQRT1_2, 5);
  });

  it('reports a blocked straight line through a base footprint', () => {
    const service = new EnemyFlowFieldService(createLayout(), [createBase('base-1', 6, 4, 3, 3)], METRICS);

    const leftOfBase = { x: 5 * CELL_SIZE + 16, y: 5 * CELL_SIZE + 16 };
    const rightOfBase = { x: 9 * CELL_SIZE + 16, y: 5 * CELL_SIZE + 16 };

    expect(service.hasWalkableLine(leftOfBase.x, leftOfBase.y, rightOfBase.x, rightOfBase.y)).toBe(false);
    // Ein Weg um die Basis herum bleibt frei.
    expect(service.hasWalkableLine(leftOfBase.x, leftOfBase.y, leftOfBase.x, 2 * CELL_SIZE + 16)).toBe(true);
  });

  it('hands out a next-cell waypoint that keeps half a cell of distance from the base wall', () => {
    const service = new EnemyFlowFieldService(createLayout(), [createBase('base-1', 6, 4, 3, 3)], METRICS);

    // Diagonal an der oberen linken Basisecke – dort steuert die Wegfindung um die Kante herum.
    expect(service.isWallAdjacentAt(5, 3)).toBe(true);
    const waypoint = service.getNextCellWorldPosition(5, 3);
    expect(waypoint).not.toBeNull();
    const cell = service.worldToGrid(waypoint!.x, waypoint!.y);
    expect(cell).not.toBeNull();
    expect(service.isTraversableAt(cell!.gridX, cell!.gridY)).toBe(true);
    // Zellmittelpunkt statt Zellrand: garantiert eine halbe Zelle Abstand zu jedem Hindernis.
    expect(waypoint!.x % CELL_SIZE).toBe(CELL_SIZE / 2);
    expect(waypoint!.y % CELL_SIZE).toBe(CELL_SIZE / 2);
  });

  it('reuses the target-path workspace without leaking a previous route', () => {
    const service = new EnemyFlowFieldService(
      createLayout({ rocks: [{ gridX: 3, gridY: 5 }] as ArenaLayout['rocks'] }),
      [],
      METRICS,
      { goalMode: 'dynamic', dynamicGoalCells: [{ gridX: 12, gridY: 5 }] },
    );

    const first = service.findNextWorldPositionTowards(2, 5, 12, 5);
    const second = service.findNextWorldPositionTowards(2, 5, 12, 5);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(service.worldToGrid(first!.x, first!.y)).not.toEqual({ gridX: 3, gridY: 5 });
  });
});
