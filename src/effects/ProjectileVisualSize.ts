/** Shared diameter used by the leaf/dust renderer and its ground-fog footprint. */
export function getLeafBlowerVisualSize(size: number): number {
  return Math.max(size * 4.7 - 12, size);
}

/** Soft visible envelope, rather than the smaller collision core. */
export function getStreamFogRadius(style: string, size: number): number | null {
  if (style === 'flame') return Math.max(12, size * .6 + 8);
  if (style === 'leaf_blower') return Math.max(12, getLeafBlowerVisualSize(size) * .35);
  return null;
}
