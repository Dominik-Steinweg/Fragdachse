/** Linear minification at this integer scale samples only the two central native
 * texels on each axis. Keep those exact values, not an average or coarser field.
 * Native tile/batch origins must be multiples of this scale relative to the World. */
export const TERRAIN_SNAPSHOT_SAMPLE_SCALE = 4;
export function terrainSnapshotTexel(index: number): boolean {
  const phase = index & 3;
  return phase === 1 || phase === 2;
}
