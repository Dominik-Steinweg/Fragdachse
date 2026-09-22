import { isPersistentBaseAreaStage, resolvePersistentBaseBuildAreaForStage, isCellInsidePersistentBaseBuildArea, resolvePersistentBaseCell,
  type PersistentBaseAreaStage } from './PersistentBaseCore';
import { sanitizePersistentConstructions, type PersistentConstruction, type PersistentPlayerBaseContribution } from './PersistentBaseTypes';
import { getPersistentConstructionFootprint } from './PersistentBasePlacementRules';

/** Only positions and removals of already confirmed objects can be edited without a player. */
export interface PersistentBaseLayoutEdit {
  readonly worldRevision: number;
  readonly expectedRevision: number;
  readonly areaStage: PersistentBaseAreaStage;
  readonly constructions: readonly PersistentConstruction[];
}
export type PersistentBaseLayoutEditResult = { readonly ok: true; readonly contribution: PersistentPlayerBaseContribution }
  | { readonly ok: false; readonly reason: 'stale' | 'blocked' | 'invalid' | 'placement' };

export function sanitizePersistentBaseLayoutEdit(value: unknown): PersistentBaseLayoutEdit | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.worldRevision) || (raw.worldRevision as number) < 0
    || !Number.isSafeInteger(raw.expectedRevision) || (raw.expectedRevision as number) < 0
    || !isPersistentBaseAreaStage(raw.areaStage)) return null;
  const constructions = sanitizePersistentConstructions(raw.constructions);
  return constructions ? { worldRevision: raw.worldRevision as number, expectedRevision: raw.expectedRevision as number,
    areaStage: raw.areaStage, constructions } : null;
}

export function applyPersistentBaseLayoutEdit(current: PersistentPlayerBaseContribution, edit: PersistentBaseLayoutEdit): PersistentBaseLayoutEditResult {
  // Retry after a lost acknowledgement is safe; the same mutation never increments twice.
  if (current.revision === edit.expectedRevision + 1 && JSON.stringify(current.constructions) === JSON.stringify(edit.constructions)) {
    return { ok: true, contribution: current };
  }
  if (current.revision !== edit.expectedRevision) return { ok: false, reason: 'stale' };
  const area = resolvePersistentBaseBuildAreaForStage(edit.areaStage);
  const occupied = new Map<string, string>();
  for (const entry of edit.constructions) {
    const before = current.constructions.find(p => p.persistentId === entry.persistentId);
    if (!before || before.tool.id !== entry.tool.id || before.tool.kind !== entry.tool.kind
      || before.angle !== entry.angle || before.placementOrder !== entry.placementOrder) return { ok: false, reason: 'invalid' };
    const moved = before.relativeGridX !== entry.relativeGridX || before.relativeGridY !== entry.relativeGridY;
    const footprint = getPersistentConstructionFootprint(entry);
    if (!footprint && moved) return { ok: false, reason: 'invalid' };
    for (const cell of footprint ?? []) {
      const x = entry.relativeGridX + cell.dx, y = entry.relativeGridY + cell.dy;
      if (moved && (!isCellInsidePersistentBaseBuildArea(x, y, area)
        || resolvePersistentBaseCell({ gridX: 0, gridY: 0 }, x, y, undefined, area)?.domain === 'base-surface')) {
        return { ok: false, reason: 'placement' };
      }
      const key = `${x},${y}`;
      const other = occupied.get(key);
      if (other) {
        const otherBefore = current.constructions.find(p => p.persistentId === other)!;
        const otherAfter = edit.constructions.find(p => p.persistentId === other)!;
        if (moved || otherBefore.relativeGridX !== otherAfter.relativeGridX || otherBefore.relativeGridY !== otherAfter.relativeGridY) {
          return { ok: false, reason: 'placement' };
        }
      }
      occupied.set(key, entry.persistentId);
    }
  }
  return { ok: true, contribution: { ...current, revision: current.revision + 1,
    constructions: edit.constructions.map(p => ({ ...p, tool: { ...p.tool } })) } };
}
