import { DAWN_MERCHANT, type DawnInfrastructureId, type DawnMerchantCatalog } from '../../config/dawn/merchant';
import { DAWN_MAX_SCRAP, type DawnProgress } from './DawnProgress';

export function getDawnInfrastructureLevel(progress: Pick<DawnProgress, 'infrastructure'>, id: DawnInfrastructureId): number {
  const level = Object.prototype.hasOwnProperty.call(progress.infrastructure, id) ? progress.infrastructure[id] : 0;
  return Number.isSafeInteger(level) && level >= 0 ? level : 0;
}

export function resolveDawnInfrastructureCost(
  progress: Pick<DawnProgress, 'infrastructure'>,
  id: DawnInfrastructureId,
  catalog: DawnMerchantCatalog = DAWN_MERCHANT,
): number | null {
  const level = progress.infrastructure[id] ?? 0;
  if (!Number.isSafeInteger(level) || level < 0) return null;
  return catalog.infrastructure.find(entry => entry.id === id)?.levelPrices[level] ?? null;
}

export function isDawnInfrastructureMaxed(
  progress: Pick<DawnProgress, 'infrastructure'>,
  id: DawnInfrastructureId,
  catalog: DawnMerchantCatalog = DAWN_MERCHANT,
): boolean {
  const entry = catalog.infrastructure.find(candidate => candidate.id === id);
  return entry !== undefined && getDawnInfrastructureLevel(progress, id) >= entry.levelPrices.length;
}

/** Personal persistence draft: a rejected purchase never mutates either balance or level. */
export function purchaseDawnInfrastructure(
  draft: DawnProgress,
  id: DawnInfrastructureId,
  unlocked: boolean,
  catalog: DawnMerchantCatalog = DAWN_MERCHANT,
): boolean {
  const price = resolveDawnInfrastructureCost(draft, id, catalog);
  if (!unlocked || price === null || !Number.isSafeInteger(price) || price <= 0
    || !Number.isSafeInteger(draft.scrap) || draft.scrap > DAWN_MAX_SCRAP || draft.scrap < price) return false;
  draft.scrap -= price;
  draft.infrastructure[id] = getDawnInfrastructureLevel(draft, id) + 1;
  return true;
}

/** Host-only round input; no reference to the mutable personal save survives the freeze. */
export function freezeDawnInfrastructure(progress: Pick<DawnProgress, 'infrastructure'>) {
  return Object.freeze({
    repairDrones: Math.min(3, getDawnInfrastructureLevel(progress, 'repair-drones')),
    scrapMagnet: Math.min(1, getDawnInfrastructureLevel(progress, 'scrap-magnet')),
    scrapScanner: Math.min(1, getDawnInfrastructureLevel(progress, 'scrap-scanner')),
  });
}
