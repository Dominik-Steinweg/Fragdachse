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

const CORNER_INSET_ERROR = 0.25;
const MAX_CORNER_BANDS = 64;

/**
 * Inscribed horizontal bands, intersected with the fill. In particular, a partial vertical
 * fill does not acquire new rounded corners along its straight upper edge.
 */
export function buildRoundedRectClipBands(
  shape: LivingBarRoundedClip,
  fill: LivingClipRect,
): LivingClipRect[] {
  if (![shape.x, shape.y, shape.width, shape.height, shape.radius,
    fill.x, fill.y, fill.width, fill.height].every(Number.isFinite)
    || shape.width <= 0 || shape.height <= 0 || fill.width <= 0 || fill.height <= 0) return [];

  const radius = Math.max(0, Math.min(shape.radius, shape.width / 2, shape.height / 2));
  const bottom = shape.y + shape.height;
  const edges = [shape.y];
  if (radius > 0) {
    // Equal steps in squared distance from the corner center bound the inward error of
    // each rectangle by CORNER_INSET_ERROR. This spends more bands near the horizontal
    // tangent, where the old half-radius strips left large rectangular cutouts.
    // The cap bounds allocations for unusually large shapes; normal UI radii stay below it.
    const error = Math.min(radius, CORNER_INSET_ERROR);
    const count = Math.min(MAX_CORNER_BANDS, Math.ceil(radius / (error * (2 - error / radius))));
    const offsets = Array.from({ length: count + 1 }, (_, index) =>
      radius * (1 - Math.sqrt(1 - index / count)));
    for (let index = 1; index <= count; index += 1) edges.push(shape.y + offsets[index]);
    for (let index = count; index >= 0; index -= 1) edges.push(bottom - offsets[index]);
  } else {
    edges.push(bottom);
  }
  const bands: LivingClipRect[] = [];
  for (let index = 1; index < edges.length; index += 1) {
    const top = Math.max(edges[index - 1], fill.y);
    const end = Math.min(edges[index], fill.y + fill.height);
    if (end <= top) continue;

    // The most restrictive arc point is the band edge nearest the top or bottom of the shape.
    const distance = Math.max(0, Math.min(radius, top - shape.y, bottom - end));
    const inset = radius - Math.sqrt(Math.max(0, radius * radius - (radius - distance) ** 2));
    const left = Math.max(shape.x + inset, fill.x);
    const right = Math.min(shape.x + shape.width - inset, fill.x + fill.width);
    if (right > left) bands.push({ x: left, y: top, width: right - left, height: end - top });
  }
  return bands;
}
