import { getUtilityIdForConstruction, normalizeConstructionId } from '../config/coopDefenseConstructions';
import type { LoadoutToolRef } from '../types';

export function loadoutToolFromId(id: string): LoadoutToolRef {
  const constructionId = normalizeConstructionId(id);
  return constructionId ? { kind: 'construction', id: constructionId } : { kind: 'utility', id };
}

/** Compatibility projection for the existing single-utility runtime and wire field. */
export function getLoadoutUtilityId(tools: readonly LoadoutToolRef[]): string {
  const tool = tools[0];
  if (!tool) return '';
  return tool.kind === 'utility' ? tool.id : getUtilityIdForConstruction(tool.id) ?? tool.id;
}
