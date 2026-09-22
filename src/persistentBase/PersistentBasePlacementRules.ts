import { getCoopDefenseConstructionDefinition, normalizeConstructionId } from '../config/coopDefenseConstructions';
import { getPersistentBaseRewardDefinition } from './PersistentBaseRewardCatalog';
import { resolvePersistentBaseCell, isCellInsidePersistentBaseBuildArea, type PersistentBaseBuildArea, type PersistentBaseOrientation } from './PersistentBaseCore';
import type { PersistentBaseRewardId } from './PersistentBaseRewardTypes';
import type { PersistentConstruction } from './PersistentBaseTypes';

/** Shared by in-world reward placement and the editor; presentation never invents a domain. */
export function isPersistentBaseRewardCellAllowed(id: PersistentBaseRewardId, x: number, y: number,
  area: PersistentBaseBuildArea, orientation?: PersistentBaseOrientation): boolean {
  const cell = resolvePersistentBaseCell({ gridX: 0, gridY: 0 }, x, y, orientation, area);
  if (!cell) return false;
  return getPersistentBaseRewardDefinition(id).placementRule === 'base-surface'
    ? cell.domain === 'base-surface'
    : cell.domain !== 'base-surface' && isCellInsidePersistentBaseBuildArea(x, y, area);
}

export function getPersistentConstructionFootprint(entry: PersistentConstruction) {
  const id = normalizeConstructionId(entry.tool.id);
  return id ? getCoopDefenseConstructionDefinition(id).footprint : null;
}
