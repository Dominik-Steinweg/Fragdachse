import { resolveDawnExpansionCost } from '../dawn/economy/DawnEconomy';
import type { DawnProgress } from '../dawn/economy/DawnProgress';
import { CELL_SIZE } from '../config';
import { resolvePersonalPersistentBaseAreaStage } from './PersistentBaseAreaStageResolution';
import { getPersistentBaseBuildAreaExtentCells, isCellInsidePersistentBaseBuildArea, resolvePersistentBaseBuildAreaForStage,
  PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE,
  type CampaignPersistentBaseAreaStage, type PersistentBaseAreaStage, type PersistentBaseBuildArea } from './PersistentBaseCore';

export interface ExpansionBoundaryEdge { x1: number; y1: number; x2: number; y2: number }

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
  return { stage, area, radius: getPersistentBaseBuildAreaExtentCells(area), cost, dawnOnly,
    edges: dawnOnly ? [] : buildPersistentBaseAreaBoundary(area) };
}
