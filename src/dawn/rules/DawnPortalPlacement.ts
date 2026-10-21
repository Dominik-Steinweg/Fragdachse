import type { DawnArenaTemplate, DawnSalvageSlot, DawnSitePortalConfig } from '../../config/dawn/dawnContent';

/** Clearing of either portal endpoint; generous enough for arrivals to spread out. */
export const DAWN_PORTAL_ANCHOR_RADIUS_CELLS = 3;
/** Closest an entry may sit to the slot anchor; the 3×3 generator occupies the cells within 1. */
const MIN_ENTRY_OFFSET_CELLS = 2;

type GridPoint = { readonly gridX: number; readonly gridY: number };

/** Authored wet cells of a template: single cells and areas, as the map normalization reads them. */
export function collectDawnTemplateWetCells(template: DawnArenaTemplate): ReadonlySet<string> {
  const wet = new Set<string>();
  for (const cell of template.world.water ?? []) wet.add(`${cell.gridX}:${cell.gridY}`);
  for (const area of template.world.waterAreas ?? []) {
    for (let dy = 0; dy < area.heightCells; dy++) for (let dx = 0; dx < area.widthCells; dx++) {
      wet.add(`${area.gridX + dx}:${area.gridY + dy}`);
    }
  }
  return wet;
}

/** The same land rule the portal anchor normalization enforces. */
export function isDawnPortalClearingDry(point: GridPoint, wet: ReadonlySet<string>): boolean {
  const r = DAWN_PORTAL_ANCHOR_RADIUS_CELLS;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy <= r * r && wet.has(`${point.gridX + dx}:${point.gridY + dy}`)) return false;
  }
  return true;
}

/**
 * Entry endpoint of a generator slot: toward the base core, as far out as authored and moved
 * closer to the generator until its clearing stays on land; null when no offset is dry.
 */
export function resolveDawnPortalEntryAnchor(template: DawnArenaTemplate, slot: DawnSalvageSlot,
  portal: DawnSitePortalConfig, wet: ReadonlySet<string> = collectDawnTemplateWetCells(template)): GridPoint | null {
  const base = template.world.persistentBase.anchor, anchor = slot.anchor;
  const length = Math.hypot(base.gridX - anchor.gridX, base.gridY - anchor.gridY) || 1;
  for (let offset = portal.entryOffsetCells; offset >= MIN_ENTRY_OFFSET_CELLS; offset--) {
    const point = {
      gridX: Math.round(anchor.gridX + (base.gridX - anchor.gridX) / length * offset),
      gridY: Math.round(anchor.gridY + (base.gridY - anchor.gridY) / length * offset),
    };
    if (isDawnPortalClearingDry(point, wet)) return point;
  }
  return null;
}
