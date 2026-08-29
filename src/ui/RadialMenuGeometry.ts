const TAU = Math.PI * 2;
const RADIAL_START_ANGLE = -Math.PI / 2;

/** Segment zero starts at twelve o'clock and proceeds clockwise in screen space. */
export function getRadialMenuSegmentIndex(
  offsetX: number,
  offsetY: number,
  segmentCount: number,
  deadZoneRadius: number,
): number | null {
  if (segmentCount <= 0 || Math.hypot(offsetX, offsetY) < deadZoneRadius) return null;

  const angle = Math.atan2(offsetY, offsetX);
  const normalized = ((angle - RADIAL_START_ANGLE) % TAU + TAU) % TAU;
  return Math.min(segmentCount - 1, Math.floor(normalized / (TAU / segmentCount)));
}
