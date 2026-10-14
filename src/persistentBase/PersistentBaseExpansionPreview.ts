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

/** Logical UI coordinates; world zoom never scales annotation strokes or text. */
export function getPersistentBaseEditorFraming(panel: EditorRect, area: PersistentBaseBuildArea,
  previewArea?: PersistentBaseBuildArea) {
  const worldSize = getPersistentBaseEditorSize(area, previewArea);
  const size = Math.min(worldSize, panel.width - 40, panel.height - 40);
  return { worldSize, zoom: size / worldSize,
    view: { x: panel.x + (panel.width - size) / 2, y: panel.y + (panel.height - size) / 2, width: size, height: size } };
}

export function projectPersistentBaseBoundary(edges: readonly ExpansionBoundaryEdge[],
  frame: ReturnType<typeof getPersistentBaseEditorFraming>): ExpansionBoundaryEdge[] {
  const cx = frame.view.x + frame.view.width / 2, cy = frame.view.y + frame.view.height / 2;
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
