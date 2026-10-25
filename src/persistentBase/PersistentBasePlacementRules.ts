import { getCoopDefenseConstructionDefinition, normalizeConstructionId } from '../config/coopDefenseConstructions';
import { getPersistentBaseRewardDefinition } from './PersistentBaseRewardCatalog';
import { resolvePersistentBaseCell, rotatePersistentBaseCoreOffset, DEFAULT_PERSISTENT_BASE_BUILD_AREA, DEFAULT_PERSISTENT_BASE_ORIENTATION, getCanonicalPersistentBaseCoreCells, isCellInsidePersistentBaseBuildArea, type PersistentBaseBuildArea, type PersistentBaseOrientation } from './PersistentBaseCore';
import type { PersistentBaseRewardId, PersistentBaseRewardPlacement, PersistentBaseRewardState } from './PersistentBaseRewardTypes';
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

/**
 * Moves stored base-surface rewards whose cell is no longer base surface (the core footprint
 * shrank from 20 to 12 ring cells) onto the nearest free base-surface cell. Without a free cell the
 * reward drops out of the placements and is unplaced again. Idempotent; valid states pass unchanged.
 */
export function relocateStrandedBaseSurfaceRewards(state: PersistentBaseRewardState): PersistentBaseRewardState {
  const isStranded = (placement: PersistentBaseRewardPlacement) =>
    getPersistentBaseRewardDefinition(placement.rewardId).placementRule === 'base-surface'
    && !isPersistentBaseRewardCellAllowed(placement.rewardId, placement.relativeGridX, placement.relativeGridY,
      DEFAULT_PERSISTENT_BASE_BUILD_AREA);
  if (!state.placements.some(isStranded)) return state;
  const taken = state.placements.filter((placement) => !isStranded(placement));
  const relocated = new Map<PersistentBaseRewardId, PersistentBaseRewardPlacement>();
  for (const stranded of state.placements.filter(isStranded)) {
    const distance = (cell: { relativeGridX: number; relativeGridY: number }) =>
      Math.hypot(cell.relativeGridX - stranded.relativeGridX, cell.relativeGridY - stranded.relativeGridY);
    const target = getCanonicalPersistentBaseCoreCells('base-surface')
      .map((cell): PersistentBaseRewardPlacement => ({ ...stranded, relativeGridX: cell.relativeGridX, relativeGridY: cell.relativeGridY }))
      .filter((candidate) => isPersistentBaseRewardCellAllowed(candidate.rewardId, candidate.relativeGridX,
        candidate.relativeGridY, DEFAULT_PERSISTENT_BASE_BUILD_AREA)
        && !taken.some((other) => persistentBaseRewardsOverlap(other, candidate)))
      .sort((a, b) => distance(a) - distance(b) || a.relativeGridY - b.relativeGridY || a.relativeGridX - b.relativeGridX)[0];
    if (!target) continue;
    taken.push(target);
    relocated.set(target.rewardId, target);
  }
  return {
    ...state,
    placements: state.placements.flatMap((placement) => {
      if (!isStranded(placement)) return [placement];
      const target = relocated.get(placement.rewardId);
      return target ? [target] : [];
    }),
  };
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
