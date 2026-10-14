import { getToolCapacityCost } from '../config/coopDefenseConstructions';
import type { PersistentRuntimeBinding } from './PersistentBaseRuntimeBindings';

/** Global host selection. Call with destroyed bindings still present in the working contribution. */
export function selectDawnRepairDroneRuntimeIds(
  destroyed: readonly PersistentRuntimeBinding[],
  { isDawn, victory, level }: { readonly isDawn: boolean; readonly victory: boolean; readonly level: number },
): ReadonlySet<number> {
  if (!isDawn || !victory || !Number.isSafeInteger(level) || level < 1) return new Set();
  const limit = level >= 3 ? Infinity : level === 2 ? 8 : 3;
  const selected = [...destroyed].sort((a, b) =>
    getToolCapacityCost(b.blueprint.tool) - getToolCapacityCost(a.blueprint.tool)
    || compareId(a.blueprint.persistentId, b.blueprint.persistentId)
    || compareId(a.ownerId, b.ownerId));
  return new Set(selected.slice(0, limit).map(binding => binding.runtimeId));
}

function compareId(a: string, b: string): number { return a === b ? 0 : a < b ? -1 : 1; }
