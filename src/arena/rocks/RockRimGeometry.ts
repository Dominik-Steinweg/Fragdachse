/** Optional V7 presentation geometry. Distances and heights are world pixels;
 * no part of this profile changes coverage or gameplay occupancy. */
export interface RockRimGeometry {
  rockRimWidth: number;
  rockRimHeight: number;
  rockRimLip: number;
}

/** Integral of a trapezoidal slope: rounded foot, sloping flank, short convex
 * upper lip. Monotone, C1, bounded by height; the lip is geometry, not pigment. */
export function rockRimHeight(distance: number, rim: RockRimGeometry): number {
  const width = Math.max(1, rim.rockRimWidth);
  const lip = Math.max(.25, Math.min(width*.45, rim.rockRimLip));
  const d = Math.max(0, Math.min(width, distance));
  const rise = d < lip ? d*d/(2*lip)
    : d > width-lip ? width-lip-(width-d)*(width-d)/(2*lip)
      : d-lip*.5;
  return Math.max(0, rim.rockRimHeight)*rise/(width-lip);
}

/** A short ambient foot, independent of sun/cloud strength. */
export function rockContactVisibility(distance: number): number {
  const t = Math.max(0, Math.min(1, distance/10));
  return t*t*(3-2*t);
}
