export interface LivingClipRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Full consumer shape, in the same local coordinates as the changing fill rectangle. */
export interface LivingBarRoundedClip extends LivingClipRect {
  readonly kind: 'roundedRect';
  readonly radius: number;
}

export interface ResolvedLivingClip {
  /** The full contour; the radius is clamped to the shape. Corners are cut analytically by the SDF. */
  readonly clip: LivingClipRect & { readonly radius: number };
  /** The visible fill, intersected with the contour bounds. Its edges stay straight. */
  readonly fill: LivingClipRect;
}

/**
 * Validates a living fill against its rounded contour. The shader masks with the contour SDF and
 * the fill rectangle separately, so a partial vertical fill keeps its straight upper edge and does
 * not acquire new rounded corners. Returns null for empty, disjoint or non-finite geometry.
 */
export function resolveLivingClip(shape: LivingBarRoundedClip, fill: LivingClipRect): ResolvedLivingClip | null {
  if (![shape.x, shape.y, shape.width, shape.height, shape.radius,
    fill.x, fill.y, fill.width, fill.height].every(Number.isFinite)
    || shape.width <= 0 || shape.height <= 0 || fill.width <= 0 || fill.height <= 0) return null;
  const left = Math.max(shape.x, fill.x);
  const top = Math.max(shape.y, fill.y);
  const right = Math.min(shape.x + shape.width, fill.x + fill.width);
  const bottom = Math.min(shape.y + shape.height, fill.y + fill.height);
  if (right <= left || bottom <= top) return null;
  const radius = Math.max(0, Math.min(shape.radius, shape.width / 2, shape.height / 2));
  return {
    clip: { x: shape.x, y: shape.y, width: shape.width, height: shape.height, radius },
    fill: { x: left, y: top, width: right - left, height: bottom - top },
  };
}
