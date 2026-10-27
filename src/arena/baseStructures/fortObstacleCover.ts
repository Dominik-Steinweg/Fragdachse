/** Caster heights around a cell: RGBA rows (R = height between min and max), their world origin and texel size. */
export interface FortHeightWindow {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly texelPx: number;
}

/**
 * How much of a world point is covered by something rising more than `risePx` above the deck (stakes, posts,
 * fire bowls): 0 on the deck and on low parts (moss, beams, the palisade's binding wale), 1 under a stake. The
 * caster heights are sampled bilinearly, so the cut follows the round stakes with a soft edge of about a texel.
 */
export function fortObstacleCover(window: FortHeightWindow, heightPx: { readonly min: number; readonly max: number },
  deckPx: number, risePx: number, x: number, y: number): number {
  const { data, width, height, texelPx } = window, { min, max } = heightPx;
  const fx = (x - window.left) / texelPx - .5, fy = (y - window.top) / texelPx - .5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const at = (cx: number, cy: number) => {
    const sx = Math.min(width - 1, Math.max(0, cx)), sy = Math.min(height - 1, Math.max(0, cy));
    return min + data[(sy * width + sx) * 4] / 255 * (max - min);
  };
  const h = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  return Math.min(1, Math.max(0, (h - deckPx - risePx) / 4 + .5));
}
