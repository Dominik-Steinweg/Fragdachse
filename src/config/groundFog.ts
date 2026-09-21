/** Shared by authored maps, their adapter and the map editor. */
export const DEFAULT_FOG_STRENGTH = 1;
export const MAX_FOG_STRENGTH = 2;
export function normalizeFogStrength(value: number | undefined): number {
  if (value === undefined) return DEFAULT_FOG_STRENGTH;
  if (!Number.isFinite(value) || value < 0 || value > MAX_FOG_STRENGTH)
    throw new Error('fogStrength must be a finite number between 0 and 2');
  return value;
}
