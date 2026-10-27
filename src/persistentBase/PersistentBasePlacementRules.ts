import { getCoopDefenseConstructionDefinition, normalizeConstructionId } from '../config/coopDefenseConstructions';
import { getPersistentBaseRewardDefinition } from './PersistentBaseRewardCatalog';
import { resolvePersistentBaseCell, DEFAULT_PERSISTENT_BASE_BUILD_AREA, CANONICAL_PERSISTENT_BASE_CORE_CELLS,
  isCellInsidePersistentBaseBuildArea, isPersistentBaseSolidDomain, type PersistentBaseBuildArea } from './PersistentBaseCore';
import { toCanonicalFootprintOrigin, toWorldFootprint, type PersistentBaseFrame } from './PersistentBaseFrame';
import type { PersistentBaseRewardId, PersistentBaseRewardPlacement, PersistentBaseRewardState } from './PersistentBaseRewardTypes';
import type { PersistentConstruction } from './PersistentBaseTypes';

/**
 * Shared by in-world reward placement and the editor; presentation never invents a domain.
 * Checks canonical cells: domains and build areas are identical under every base rotation.
 */
export function isPersistentBaseRewardCellAllowed(id: PersistentBaseRewardId, x: number, y: number,
  area: PersistentBaseBuildArea): boolean {
  const rule = getPersistentBaseRewardDefinition(id).placementRule;
  return getPersistentBaseRewardFootprint(id).every(({ dx, dy }) => {
    const cell = resolvePersistentBaseCell({ gridX: 0, gridY: 0 }, x + dx, y + dy, area);
    return !!cell && (rule === 'base-surface' ? cell.domain === 'base-surface'
      : !isPersistentBaseSolidDomain(cell.domain) && isCellInsidePersistentBaseBuildArea(x + dx, y + dy, area));
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
 * True when a stored placement lies on a core cell its rule no longer allows: a base turret off the
 * bastions (the ring shrank from 20 to 12 cells), or a courtyard reward on the fort itself (the
 * hearth took the anchor cell). Cells outside the 7x7 core are judged by the area stage, not here.
 */
function isStrandedOnCore(placement: PersistentBaseRewardPlacement): boolean {
  const baseSurface = getPersistentBaseRewardDefinition(placement.rewardId).placementRule === 'base-surface';
  return getPersistentBaseRewardCells(placement).some(({ gridX, gridY }) => {
    const core = CANONICAL_PERSISTENT_BASE_CORE_CELLS.find((cell) => cell.relativeGridX === gridX && cell.relativeGridY === gridY);
    return baseSurface ? core?.domain !== 'base-surface' : !!core && isPersistentBaseSolidDomain(core.domain);
  });
}

/**
 * Moves stored rewards stranded by a change of the core's shape onto the nearest free core cell
 * their rule allows. Without a free cell the reward drops out of the placements and is unplaced
 * again. Idempotent; valid states pass unchanged.
 */
export function relocateStrandedCoreRewards(state: PersistentBaseRewardState): PersistentBaseRewardState {
  if (!state.placements.some(isStrandedOnCore)) return state;
  const taken = state.placements.filter((placement) => !isStrandedOnCore(placement));
  const relocated = new Map<PersistentBaseRewardId, PersistentBaseRewardPlacement>();
  for (const stranded of state.placements.filter(isStrandedOnCore)) {
    const distance = (cell: { relativeGridX: number; relativeGridY: number }) =>
      Math.hypot(cell.relativeGridX - stranded.relativeGridX, cell.relativeGridY - stranded.relativeGridY);
    const target = CANONICAL_PERSISTENT_BASE_CORE_CELLS
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
      if (!isStrandedOnCore(placement)) return [placement];
      const target = relocated.get(placement.rewardId);
      return target ? [target] : [];
    }),
  };
}

/**
 * World top-left cell of a stored reward placement inside the base frame, or `null` when the
 * canonical cell lies outside the core and the build area.
 */
export function resolvePersistentRewardWorldCell(
  frame: PersistentBaseFrame,
  buildArea: PersistentBaseBuildArea,
  placement: { rewardId?: PersistentBaseRewardId; relativeGridX: number; relativeGridY: number },
) {
  const canonical = resolvePersistentBaseCell(frame.anchor, placement.relativeGridX, placement.relativeGridY, buildArea);
  if (!canonical) return null;
  const footprint = placement.rewardId ? getPersistentBaseRewardFootprint(placement.rewardId) : [{ dx: 0, dy: 0 }];
  const world = toWorldFootprint(frame, placement.relativeGridX, placement.relativeGridY, footprint);
  return { gridX: world.gridX, gridY: world.gridY, domain: canonical.domain };
}

/** Inverse of {@link resolvePersistentRewardWorldCell}: canonical origin of a world top-left cell. */
export function resolvePersistentRewardCanonicalCell(
  frame: PersistentBaseFrame,
  buildArea: PersistentBaseBuildArea,
  gridX: number,
  gridY: number,
  rewardId?: PersistentBaseRewardId,
) {
  const footprint = rewardId ? getPersistentBaseRewardFootprint(rewardId) : [{ dx: 0, dy: 0 }];
  const relative = toCanonicalFootprintOrigin(frame, gridX, gridY, footprint);
  const canonical = resolvePersistentBaseCell(frame.anchor, relative.relativeGridX, relative.relativeGridY, buildArea);
  return canonical ? { ...relative, domain: canonical.domain } : null;
}
