import { resolveCollisionWater } from '../../arena/BridgeGeometry';
import type { BaseSpec } from '../../arena/BaseRegistry';
import { WaterGeometry } from '../../arena/WaterGeometry';
import { CELL_SIZE, TRUNK_RADIUS } from '../../config';
import type { ArenaLayout } from '../../types';
import type { WorldMetrics } from '../../world/WorldMetrics';
import { ArenaObstacleIndex, type ObstacleCircleBody, type ObstacleRectBody } from '../ArenaObstacleIndex';
import type { NavigationGeometrySnapshot } from './NavigationGeometry';

export interface MissionStartNavigationInput {
  readonly metrics: WorldMetrics;
  readonly layout: ArenaLayout;
  /** Bases that stand when the round starts. */
  readonly bases: readonly BaseSpec[];
  /** Mission barriers, all closed when the round starts. */
  readonly barrierCells: readonly { readonly gridX: number; readonly gridY: number }[];
  /** Cells blocked by placed constructions (persistent base and its rewards). */
  readonly constructionCells: readonly { readonly gridX: number; readonly gridY: number }[];
  /** Bridges already blown: their decks are water again. None at mission start. */
  readonly collapsedBridgeIds?: ReadonlySet<string>;
}

interface Rect { left: number; top: number; right: number; bottom: number; x: number; y: number; width: number; height: number }

/**
 * Movement geometry of a mission World at its start, built from data instead of Phaser bodies.
 *
 * The snapshot runs through the same {@link ArenaObstacleIndex} as a round, so ids, kinds and
 * shapes match what the mission's flow fields read: cell rects for rocks, reactive props and
 * constructions, trunk circles, `base:<id>` cells, closed barriers and collision water with
 * standing bridges.
 */
export function buildMissionStartNavigationGeometry(input: MissionStartNavigationInput): NavigationGeometrySnapshot {
  const { metrics, layout } = input;
  const cellBody = (gridX: number, gridY: number, data?: Record<string, unknown>): ObstacleRectBody => {
    const x = metrics.offsetX + gridX * CELL_SIZE, y = metrics.offsetY + gridY * CELL_SIZE;
    const rect: Rect = { left: x, top: y, right: x + CELL_SIZE, bottom: y + CELL_SIZE, x, y, width: CELL_SIZE, height: CELL_SIZE };
    return { active: true, getBounds: () => rect as never, ...(data ? { getData: (key: string) => data[key] } : {}) };
  };
  // Same id space as a round: layout rocks, then reactive props, then placed constructions.
  const rocks = [...layout.rocks, ...(layout.reactiveProps ?? []), ...input.constructionCells]
    .map((cell) => cellBody(cell.gridX, cell.gridY));
  const trunks: ObstacleCircleBody[] = layout.trees.map((tree) => ({ active: true, radius: TRUNK_RADIUS,
    x: metrics.offsetX + (tree.gridX + .5) * CELL_SIZE, y: metrics.offsetY + (tree.gridY + .5) * CELL_SIZE }));
  const bases = input.bases.flatMap((base) => base.collisionRects
    ? base.collisionRects.map((rect): ObstacleRectBody => {
      const bounds: Rect = { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      return { active: true, getBounds: () => bounds as never, getData: (key: string) => key === 'baseId' ? base.id : undefined };
    })
    : base.cells.map((cell) => cellBody(cell.gridX, cell.gridY, { baseId: base.id })));
  const barriers = input.barrierCells.map((cell) => cellBody(cell.gridX, cell.gridY));
  const index = new ArenaObstacleIndex({
    bounds: () => ({ offsetX: metrics.offsetX, offsetY: metrics.offsetY, width: metrics.widthPx, height: metrics.heightPx }),
    rocks: () => rocks,
    trunks: () => trunks,
    bases: () => bases,
    barriers: () => barriers,
  });
  index.setWaterGeometry(new WaterGeometry(resolveCollisionWater(layout.water ?? [], layout.bridges, input.collapsedBridgeIds), metrics));
  return index.snapshotMovementGeometry();
}
