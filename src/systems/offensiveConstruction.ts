import type { PlaceableKind } from '../types';

/** Offensive ground installations are targetable even when their weapon flies separately. */
export function isOffensiveConstruction(value: { readonly kind: PlaceableKind }): boolean {
  return value.kind === 'turret' || value.kind === 'drone_station';
}
