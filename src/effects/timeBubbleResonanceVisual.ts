/** Presentation tuning only: absolute stored damage continuously increases the release's weight. */
export function resonanceReleaseStrength(damage: number | undefined): number {
  return Number.isFinite(damage) && damage! > 0 ? 1 - Math.exp(-damage! / 70) : 0;
}

export function resonanceFill(charge: number | undefined, capacity: number | undefined): number {
  return Number.isFinite(charge) && Number.isFinite(capacity) && capacity! > 0
    ? Math.max(0, Math.min(1, charge! / capacity!)) : 0;
}
