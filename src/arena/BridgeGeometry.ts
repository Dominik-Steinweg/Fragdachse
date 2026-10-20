import { CELL_SIZE } from '../config';
import type { ArenaBridge, WaterCell } from '../types';

/** Grid rectangle in cells; dimensions count from the inclusive origin. */
export interface BridgeCellRect {
  readonly gridX: number;
  readonly gridY: number;
  readonly widthCells: number;
  readonly heightCells: number;
}

/** World-space rectangle in pixels. */
export interface BridgeWorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Just the world origin of a WorldMetrics; keeps this module free of the metrics resolver. */
export interface BridgeWorldOrigin {
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Deck rectangle in cells: `spanCells` along the axis of travel, `deckWidthCells` across it. */
export function getBridgeDeckRect(bridge: ArenaBridge): BridgeCellRect {
  return bridge.axis === 'horizontal'
    ? { gridX: bridge.gridX, gridY: bridge.gridY, widthCells: bridge.spanCells, heightCells: bridge.deckWidthCells }
    : { gridX: bridge.gridX, gridY: bridge.gridY, widthCells: bridge.deckWidthCells, heightCells: bridge.spanCells };
}

export function getBridgeDeckCells(bridge: ArenaBridge): WaterCell[] {
  const rect = getBridgeDeckRect(bridge);
  const cells: WaterCell[] = [];
  for (let y = rect.gridY; y < rect.gridY + rect.heightCells; y++) {
    for (let x = rect.gridX; x < rect.gridX + rect.widthCells; x++) cells.push({ gridX: x, gridY: y });
  }
  return cells;
}

/** The two dry rows the deck rests on: the row before the deck and the row after it, along the axis. */
export function getBridgeAbutmentCells(bridge: ArenaBridge): { readonly start: WaterCell[]; readonly end: WaterCell[] } {
  const start: WaterCell[] = [];
  const end: WaterCell[] = [];
  for (let i = 0; i < bridge.deckWidthCells; i++) {
    if (bridge.axis === 'horizontal') {
      start.push({ gridX: bridge.gridX - 1, gridY: bridge.gridY + i });
      end.push({ gridX: bridge.gridX + bridge.spanCells, gridY: bridge.gridY + i });
    } else {
      start.push({ gridX: bridge.gridX + i, gridY: bridge.gridY - 1 });
      end.push({ gridX: bridge.gridX + i, gridY: bridge.gridY + bridge.spanCells });
    }
  }
  return { start, end };
}

/**
 * Round keep-clear areas in front of both abutments, so generated rock and trees never seal a
 * bridge end. Centers lie one cell beyond the abutment row on dry land.
 */
export function getBridgeApproachClearings(bridge: ArenaBridge): { gridX: number; gridY: number; radiusCells: number }[] {
  const across = (bridge.deckWidthCells - 1) / 2;
  const radiusCells = Math.max(1.5, bridge.deckWidthCells / 2 + 0.5);
  return bridge.axis === 'horizontal'
    ? [
      { gridX: bridge.gridX - 2, gridY: bridge.gridY + across, radiusCells },
      { gridX: bridge.gridX + bridge.spanCells + 1, gridY: bridge.gridY + across, radiusCells },
    ]
    : [
      { gridX: bridge.gridX + across, gridY: bridge.gridY - 2, radiusCells },
      { gridX: bridge.gridX + across, gridY: bridge.gridY + bridge.spanCells + 1, radiusCells },
    ];
}

export function getBridgeDeckWorldRect(bridge: ArenaBridge, origin: BridgeWorldOrigin): BridgeWorldRect {
  const rect = getBridgeDeckRect(bridge);
  return {
    x: origin.offsetX + rect.gridX * CELL_SIZE,
    y: origin.offsetY + rect.gridY * CELL_SIZE,
    width: rect.widthCells * CELL_SIZE,
    height: rect.heightCells * CELL_SIZE,
  };
}

/** Where a charge is planted: the deck centre. */
export function getBridgeChargePoint(bridge: ArenaBridge, origin: BridgeWorldOrigin): { x: number; y: number } {
  const rect = getBridgeDeckWorldRect(bridge, origin);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Centre-in-rectangle rule shared by the collapse resolution and presentation. */
export function isPointOnBridgeDeck(bridge: ArenaBridge, origin: BridgeWorldOrigin, x: number, y: number): boolean {
  const rect = getBridgeDeckWorldRect(bridge, origin);
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

export function nearestBridgeDeckPoint(
  bridge: ArenaBridge,
  origin: BridgeWorldOrigin,
  x: number,
  y: number,
): { x: number; y: number } {
  const rect = getBridgeDeckWorldRect(bridge, origin);
  return {
    x: Math.max(rect.x, Math.min(rect.x + rect.width, x)),
    y: Math.max(rect.y, Math.min(rect.y + rect.height, y)),
  };
}

/**
 * The one geometry rule of bridges: collision water is authored water minus the decks of the
 * bridges that still stand. Presentation, placement and spawn rules keep reading authored water.
 */
export function resolveCollisionWater(
  water: readonly WaterCell[],
  bridges: readonly ArenaBridge[] | undefined,
  collapsedIds: ReadonlySet<string> = new Set(),
): WaterCell[] {
  const standing = (bridges ?? []).filter((bridge) => !collapsedIds.has(bridge.id));
  if (standing.length === 0) return water.slice();
  const deck = new Set<string>();
  for (const bridge of standing) for (const cell of getBridgeDeckCells(bridge)) deck.add(`${cell.gridX}_${cell.gridY}`);
  return water.filter((cell) => !deck.has(`${cell.gridX}_${cell.gridY}`));
}
