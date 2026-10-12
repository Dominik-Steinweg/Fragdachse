import { getCoopDefenseConstructionDefinition, normalizeConstructionId } from '../config/coopDefenseConstructions';
import { getPersistentBaseRewardDefinition } from './PersistentBaseRewardCatalog';
import { resolvePersistentBaseCell, rotatePersistentBaseCoreOffset, DEFAULT_PERSISTENT_BASE_ORIENTATION, isCellInsidePersistentBaseBuildArea, type PersistentBaseBuildArea, type PersistentBaseOrientation } from './PersistentBaseCore';
import type { PersistentBaseRewardId } from './PersistentBaseRewardTypes';
import type { PersistentConstruction } from './PersistentBaseTypes';

/** Shared by in-world reward placement and the editor; presentation never invents a domain. */
export function isPersistentBaseRewardCellAllowed(id: PersistentBaseRewardId, x: number, y: number,
  area: PersistentBaseBuildArea, orientation?: PersistentBaseOrientation): boolean {
  const rule = getPersistentBaseRewardDefinition(id).placementRule;
  return getPersistentBaseRewardFootprint(id).every(({ dx, dy }) => {
    const cell = resolvePersistentBaseCell({ gridX: 0, gridY: 0 }, x + dx, y + dy, orientation, area);
    return !!cell && (rule === 'base-surface' ? cell.domain === 'base-surface'
      : cell.domain !== 'base-surface' && isCellInsidePersistentBaseBuildArea(x + dx, y + dy, area));
  });
}

export function getPersistentConstructionFootprint(entry: PersistentConstruction) {
  const id = normalizeConstructionId(entry.tool.id);
  return id ? getCoopDefenseConstructionDefinition(id).footprint : null;
}

export function getPersistentBaseRewardFootprint(id: PersistentBaseRewardId) {
  const source = getPersistentBaseRewardDefinition(id).gameplaySource;
  return source.kind === 'construction-definition'
    ? getCoopDefenseConstructionDefinition(source.constructionId).footprint : [{ dx: 0, dy: 0 }];
}

export function getPersistentBaseRewardCells(placement: { rewardId: PersistentBaseRewardId; relativeGridX: number; relativeGridY: number }) {
  return getPersistentBaseRewardFootprint(placement.rewardId).map(({ dx, dy }) => ({
    gridX: placement.relativeGridX + dx, gridY: placement.relativeGridY + dy,
  }));
}

export function persistentBaseRewardsOverlap(a: Parameters<typeof getPersistentBaseRewardCells>[0], b: Parameters<typeof getPersistentBaseRewardCells>[0]): boolean {
  const occupied = new Set(getPersistentBaseRewardCells(a).map(c => c.gridX + ':' + c.gridY));
  return getPersistentBaseRewardCells(b).some(c => occupied.has(c.gridX + ':' + c.gridY));
}

/** Rotate the stored footprint with the site, then recover its top-left runtime anchor. */
export function resolvePersistentRewardWorldCell(
  site: { anchor: { gridX: number; gridY: number }; orientation?: PersistentBaseOrientation; buildArea: PersistentBaseBuildArea },
  placement: { rewardId?: PersistentBaseRewardId; relativeGridX: number; relativeGridY: number },
) {
  const anchor = resolvePersistentBaseCell(site.anchor, placement.relativeGridX, placement.relativeGridY, site.orientation, site.buildArea);
  if (!anchor) return null;
  const footprint = placement.rewardId ? getPersistentBaseRewardFootprint(placement.rewardId) : [{ dx: 0, dy: 0 }];
  const offsets = footprint.map(c => rotatePersistentBaseCoreOffset(c.dx, c.dy, site.orientation ?? DEFAULT_PERSISTENT_BASE_ORIENTATION));
  return { ...anchor, gridX: anchor.gridX + Math.min(...offsets.map(c => c.relativeGridX)),
    gridY: anchor.gridY + Math.min(...offsets.map(c => c.relativeGridY)) };
}
