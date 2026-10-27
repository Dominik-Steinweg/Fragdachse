import type { ArenaBridge, ArenaLayout } from '../types';

/** Inclusive cell rectangle of a World. */
export interface ArenaGridWindow {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * The part of a layout that lies inside a cell window, in unchanged World coordinates.
 *
 * Used where only a detail of a large World is shown (the base editor's situation map). Rock
 * indices are renumbered; decals follow their rocks and drop out when none of them remains.
 * Bridges stay whole when they touch the window, because their deck is drawn from the bridge.
 */
export function cropArenaLayout(layout: ArenaLayout, window: ArenaGridWindow): ArenaLayout {
  const inside = (cell: { readonly gridX: number; readonly gridY: number }): boolean => (
    cell.gridX >= window.minX && cell.gridX <= window.maxX && cell.gridY >= window.minY && cell.gridY <= window.maxY
  );
  const rockIndex = new Map<number, number>();
  const rocks: ArenaLayout['rocks'] = [];
  layout.rocks.forEach((rock, index) => {
    if (!inside(rock)) return;
    rockIndex.set(index, rocks.length);
    rocks.push({ ...rock });
  });
  const decals = layout.decals?.flatMap((decal) => {
    if (!decal.rockIds?.length) return inside(decal) ? [{ ...decal }] : [];
    const rockIds = decal.rockIds.flatMap((id) => rockIndex.has(id) ? [rockIndex.get(id)!] : []);
    return rockIds.length ? [{ ...decal, rockIds }] : [];
  });
  const cropped: ArenaLayout = {
    seed: layout.seed,
    rocks,
    trees: layout.trees.filter(inside).map((tree) => ({ ...tree })),
    tracks: layout.tracks.filter(inside).map((track) => ({ ...track })),
    dirt: layout.dirt.filter(inside).map((dirt) => ({ ...dirt })),
    powerUpPedestals: layout.powerUpPedestals.filter(inside).map((pedestal) => ({ ...pedestal })),
  };
  if (layout.water) cropped.water = layout.water.filter(inside).map((water) => ({ ...water }));
  if (layout.bridges) cropped.bridges = layout.bridges.filter((bridge) => bridgeTouchesWindow(bridge, window));
  if (decals) cropped.decals = decals;
  if (layout.reactiveProps) cropped.reactiveProps = layout.reactiveProps.filter(inside).map((prop) => ({ ...prop }));
  return cropped;
}

function bridgeTouchesWindow(bridge: ArenaBridge, window: ArenaGridWindow): boolean {
  const width = bridge.axis === 'horizontal' ? bridge.spanCells : bridge.deckWidthCells;
  const height = bridge.axis === 'horizontal' ? bridge.deckWidthCells : bridge.spanCells;
  return bridge.gridX <= window.maxX && bridge.gridX + width - 1 >= window.minX
    && bridge.gridY <= window.maxY && bridge.gridY + height - 1 >= window.minY;
}
