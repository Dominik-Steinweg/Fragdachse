import {
  MAX_PERSISTENT_BASE_RADIUS_CELLS,
  PERSISTENT_BASE_CLEARANCE_CELLS,
} from '../config/persistentBase';
import type { BaseSpec } from '../arena/BaseRegistry';
import type { PersistentBaseAnchor } from './PersistentBaseTypes';

/** Kreisfoermige Zone in relativen Rasterkoordinaten; Randzellen sind eingeschlossen. */
export function isCellInsidePersistentBaseZone(
  relativeGridX: number,
  relativeGridY: number,
  radiusCells: number,
): boolean {
  if (!Number.isFinite(relativeGridX) || !Number.isFinite(relativeGridY)
    || !Number.isFinite(radiusCells) || radiusCells < 0) return false;
  const dx = relativeGridX;
  const dy = relativeGridY;
  return dx * dx + dy * dy <= radiusCells * radiusCells;
}

export function isAbsoluteCellInsidePersistentBaseZone(
  gridX: number,
  gridY: number,
  anchor: PersistentBaseAnchor,
  radiusCells: number,
): boolean {
  return isCellInsidePersistentBaseZone(
    gridX - anchor.gridX,
    gridY - anchor.gridY,
    radiusCells,
  );
}

export function isPersistentFootprintInsideZone(
  originGridX: number,
  originGridY: number,
  footprint: readonly { readonly dx: number; readonly dy: number }[],
  anchor: PersistentBaseAnchor,
  radiusCells: number,
): boolean {
  return footprint.every((cell) => isAbsoluteCellInsidePersistentBaseZone(
    originGridX + cell.dx,
    originGridY + cell.dy,
    anchor,
    radiusCells,
  ));
}

export function isCellInsidePersistentBaseReservation(
  gridX: number,
  gridY: number,
  anchor: PersistentBaseAnchor,
): boolean {
  return isAbsoluteCellInsidePersistentBaseZone(
    gridX,
    gridY,
    anchor,
    MAX_PERSISTENT_BASE_RADIUS_CELLS + PERSISTENT_BASE_CLEARANCE_CELLS,
  );
}

export function getPersistentBaseAnchor(base: Pick<BaseSpec, 'anchorGridX' | 'anchorGridY' | 'region'>): PersistentBaseAnchor {
  return {
    gridX: base.anchorGridX ?? Math.floor((base.region.minGridX + base.region.maxGridX) / 2),
    gridY: base.anchorGridY ?? Math.floor((base.region.minGridY + base.region.maxGridY) / 2),
  };
}
