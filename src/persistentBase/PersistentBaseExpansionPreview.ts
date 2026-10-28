import { resolveDawnExpansionCost } from '../dawn/economy/DawnEconomy';
import type { DawnProgress } from '../dawn/economy/DawnProgress';
import { CELL_SIZE } from '../config';
import { resolveDawnExpansionReward } from '../dawn/economy/DawnExpansionRewards';
import { resolvePersonalPersistentBaseAreaStage } from './PersistentBaseAreaStageResolution';
import { getPersistentBaseBuildAreaExtentCells, isCellInsidePersistentBaseBuildArea, resolvePersistentBaseBuildAreaForStage,
  PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE,
  type CampaignPersistentBaseAreaStage, type PersistentBaseAreaStage, type PersistentBaseBuildArea } from './PersistentBaseCore';

export interface ExpansionBoundaryEdge { x1: number; y1: number; x2: number; y2: number }
interface EditorRect { x: number; y: number; width: number; height: number }

/**
 * Where the editor World appears on screen. Logical UI coordinates; world zoom never scales
 * annotation strokes or text.
 */
export interface PersistentBaseEditorFraming {
  readonly zoom: number;
  /** Screen rectangle of the World view. */
  readonly view: EditorRect;
  /** World-pixel rectangle shown in `view`. */
  readonly world: EditorRect;
  /** Screen position of the anchor cell's centre. */
  readonly anchor: { readonly x: number; readonly y: number };
}

/** The personal base on its own small square World, anchor in the middle. */
export function getPersistentBaseEditorFraming(panel: EditorRect, area: PersistentBaseBuildArea,
  previewArea?: PersistentBaseBuildArea): PersistentBaseEditorFraming {
  const worldSize = getPersistentBaseEditorSize(area, previewArea);
  const anchorCell = (worldSize / CELL_SIZE - 1) / 2;
  return getPersistentBaseEditorWorldFraming(panel, { x: 0, y: 0, width: worldSize, height: worldSize },
    { gridX: anchorCell, gridY: anchorCell });
}

/** Fits a World rectangle into the panel inset by `inset`, never enlarged beyond its native scale. */
export function getPersistentBaseEditorWorldFraming(panel: EditorRect, world: EditorRect,
  anchorCell: { readonly gridX: number; readonly gridY: number }, inset = 40): PersistentBaseEditorFraming {
  const zoom = Math.min(1, (panel.width - inset) / world.width, (panel.height - inset) / world.height);
  const width = world.width * zoom, height = world.height * zoom;
  const view = { x: panel.x + (panel.width - width) / 2, y: panel.y + (panel.height - height) / 2, width, height };
  return { zoom, view, world,
    anchor: { x: view.x + ((anchorCell.gridX + .5) * CELL_SIZE - world.x) * zoom,
      y: view.y + ((anchorCell.gridY + .5) * CELL_SIZE - world.y) * zoom } };
}

/** The situation map's World view on screen; its detail view has the same aspect. */
export const PERSISTENT_BASE_EDITOR_VIEW_SIZE = { width: 1000, height: 660 } as const;
/** Cells the detail view shows from top to bottom; its width follows the view's aspect. */
export const PERSISTENT_BASE_EDITOR_DETAIL_ROWS = 29;

/**
 * World-pixel rectangle of the situation map's detail view: the view's aspect around the anchor,
 * shifted to stay on the map rather than cut off at its edge, so it always fills the view. A map
 * smaller than that shows all of itself in that dimension, a little closer.
 */
export function getPersistentBaseEditorDetailRect(world: { readonly widthCells: number; readonly heightCells: number },
  anchor: { readonly gridX: number; readonly gridY: number }): EditorRect {
  const mapWidth = world.widthCells * CELL_SIZE, mapHeight = world.heightCells * CELL_SIZE;
  let height = PERSISTENT_BASE_EDITOR_DETAIL_ROWS * CELL_SIZE;
  let width = height * PERSISTENT_BASE_EDITOR_VIEW_SIZE.width / PERSISTENT_BASE_EDITOR_VIEW_SIZE.height;
  const fit = Math.min(1, mapWidth / width, mapHeight / height);
  width *= fit; height *= fit;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  return { x: clamp((anchor.gridX + .5) * CELL_SIZE - width / 2, mapWidth - width),
    y: clamp((anchor.gridY + .5) * CELL_SIZE - height / 2, mapHeight - height), width, height };
}

/** Inclusive cells under a World-pixel rectangle, grown by `marginCells` and clamped to the World. */
export function getPersistentBaseEditorDetailWindow(world: { readonly widthCells: number; readonly heightCells: number },
  rect: EditorRect, marginCells = 0) {
  const clampX = (x: number) => Math.max(0, Math.min(world.widthCells - 1, x));
  const clampY = (y: number) => Math.max(0, Math.min(world.heightCells - 1, y));
  return { minX: clampX(Math.floor(rect.x / CELL_SIZE) - marginCells), maxX: clampX(Math.ceil((rect.x + rect.width) / CELL_SIZE) - 1 + marginCells),
    minY: clampY(Math.floor(rect.y / CELL_SIZE) - marginCells), maxY: clampY(Math.ceil((rect.y + rect.height) / CELL_SIZE) - 1 + marginCells) };
}

export function projectPersistentBaseBoundary(edges: readonly ExpansionBoundaryEdge[],
  frame: PersistentBaseEditorFraming): ExpansionBoundaryEdge[] {
  const cx = frame.anchor.x, cy = frame.anchor.y;
  const cell = CELL_SIZE * frame.zoom;
  return edges.map(e => ({ x1: cx + e.x1 * cell, y1: cy + e.y1 * cell,
    x2: cx + e.x2 * cell, y2: cy + e.y2 * cell }));
}

/** Attach to a real northeast contour edge, keeping the measured label inside the map. */
export function getPersistentBaseExpansionLabelPosition(edges: readonly ExpansionBoundaryEdge[], view: EditorRect,
  label: { width: number; height: number }) {
  if (!edges.length) return null;
  const edge = edges.reduce((best, e) => e.x1 + e.x2 - e.y1 - e.y2 > best.x1 + best.x2 - best.y1 - best.y2 ? e : best);
  const anchorX = (edge.x1 + edge.x2) / 2, anchorY = (edge.y1 + edge.y2) / 2;
  return { anchorX, anchorY,
    x: Math.max(view.x + 8, Math.min(anchorX - label.width / 2, view.x + view.width - label.width - 8)),
    y: Math.max(view.y + 8, Math.min(anchorY - label.height - 10, view.y + view.height - label.height - 8)) };
}

/** Presentation bounds include the next outline, independently of which campaign rewards were claimed. */
export function getPersistentBaseEditorSize(area: PersistentBaseBuildArea, previewArea: PersistentBaseBuildArea = area): number {
  const extent = Math.max(getPersistentBaseBuildAreaExtentCells(area), getPersistentBaseBuildAreaExtentCells(previewArea));
  return (2 * (extent + 2) + 1) * CELL_SIZE;
}

/** Cell-edge contour, in cells relative to the anchor centre. Uses the placement geometry, including cardinal strips. */
export function buildPersistentBaseAreaBoundary(area: PersistentBaseBuildArea): ExpansionBoundaryEdge[] {
  const extent = getPersistentBaseBuildAreaExtentCells(area), edges: ExpansionBoundaryEdge[] = [];
  for (let y = -extent; y <= extent; y++) for (let x = -extent; x <= extent; x++) {
    if (!isCellInsidePersistentBaseBuildArea(x, y, area)) continue;
    if (!isCellInsidePersistentBaseBuildArea(x, y - 1, area)) edges.push({ x1: x - .5, y1: y - .5, x2: x + .5, y2: y - .5 });
    if (!isCellInsidePersistentBaseBuildArea(x + 1, y, area)) edges.push({ x1: x + .5, y1: y - .5, x2: x + .5, y2: y + .5 });
    if (!isCellInsidePersistentBaseBuildArea(x, y + 1, area)) edges.push({ x1: x + .5, y1: y + .5, x2: x - .5, y2: y + .5 });
    if (!isCellInsidePersistentBaseBuildArea(x - 1, y, area)) edges.push({ x1: x - .5, y1: y + .5, x2: x - .5, y2: y - .5 });
  }
  return edges;
}

export function buildPersistentBaseExpansionPreview(progress: Pick<DawnProgress, 'expansionLevel'>,
  campaignStage: CampaignPersistentBaseAreaStage, unlocked: boolean,
  siteMaxAreaStage: PersistentBaseAreaStage = PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE) {
  const cost = resolveDawnExpansionCost(progress.expansionLevel);
  if (!unlocked || cost === null) return null;
  const stage = resolvePersonalPersistentBaseAreaStage({ campaignStage, dawnExpansionLevel: progress.expansionLevel + 1 });
  const area = resolvePersistentBaseBuildAreaForStage(stage);
  const dawnOnly = stage > siteMaxAreaStage;
  const reward = resolveDawnExpansionReward(progress.expansionLevel + 1);
  return { stage, area, radius: getPersistentBaseBuildAreaExtentCells(area), cost, dawnOnly, reward,
    // The radius ends at 10 (D-46): later expansions show their reward as text, never a ring.
    edges: reward?.kind === 'core' ? [] : buildPersistentBaseAreaBoundary(area) };
}
