import type { HudOcclusionRect } from '../../ui/hudOcclusionFade';
import { MARKER_LIMITS } from './MarkerTypes';

export interface MarkerPoint { readonly x: number; readonly y: number }
export interface MarkerViewport extends MarkerPoint { readonly width: number; readonly height: number }

/** Conservative design-pixel bounds: includes pointer, maximum pop and 11px bold labels.
 * Labels sit below the badge; the bottom edge moves inward enough to keep them on screen.
 * A renderer can use these same bounds when arranging its label pool. */
export function getMarkerEdgeBounds(
  point: MarkerPoint, distanceLabel?: string, countLabel?: string,
): HudOcclusionRect {
  const radius = MARKER_LIMITS.edgeBadgeDiameter * 1.1 / 2 + 8;
  const label = [countLabel, distanceLabel].filter(Boolean).join(' · ');
  const halfWidth = Math.max(radius, Array.from(label).length * 8 / 2 + 2);
  return {
    left: point.x - halfWidth, right: point.x + halfWidth,
    top: point.y - radius, bottom: point.y + radius + (label ? 17 : 0),
  };
}

interface Segment { horizontal: boolean; fixed: number; min: number; max: number }
interface Interval { min: number; max: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const squaredDistance = (a: MarkerPoint, b: MarkerPoint) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function onSegment(segment: Segment, value: number): MarkerPoint {
  return segment.horizontal ? { x: value, y: segment.fixed } : { x: segment.fixed, y: value };
}

function subtract(intervals: readonly Interval[], min: number, max: number): Interval[] {
  return intervals.flatMap((interval) => {
    if (max <= interval.min || min >= interval.max) return [interval];
    const result: Interval[] = [];
    if (min >= interval.min) result.push({ min: interval.min, max: min });
    if (max <= interval.max) result.push({ min: max, max: interval.max });
    return result;
  });
}

/** Finds the nearest free point on four inset edge intervals. No world/render pixel mixing.
 * HUD and already placed glyph/label rectangles remove intervals before selection. */
export function placeMarkerOnEdge(
  target: MarkerPoint, viewport: MarkerViewport, reserved: readonly HudOcclusionRect[],
  occupied: readonly HudOcclusionRect[], distanceLabel?: string, countLabel?: string,
  previous?: MarkerPoint,
): MarkerPoint | null {
  const bounds = getMarkerEdgeBounds({ x: 0, y: 0 }, distanceLabel, countLabel);
  const left = viewport.x + Math.max(MARKER_LIMITS.edgeInsetPx, -bounds.left);
  const right = viewport.x + viewport.width - Math.max(MARKER_LIMITS.edgeInsetPx, bounds.right);
  const top = viewport.y + Math.max(MARKER_LIMITS.edgeInsetPx, -bounds.top);
  const bottom = viewport.y + viewport.height - Math.max(MARKER_LIMITS.edgeInsetPx, bounds.bottom);
  if (right < left || bottom < top) return null;
  const segments: Segment[] = [
    { horizontal: true, fixed: top, min: left, max: right },
    { horizontal: false, fixed: right, min: top, max: bottom },
    { horizontal: true, fixed: bottom, min: left, max: right },
    { horizontal: false, fixed: left, min: top, max: bottom },
  ];
  const center = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
  let dx = target.x - center.x;
  let dy = target.y - center.y;
  if (Math.abs(dx) + Math.abs(dy) < 1e-9) dy = -1;
  // Ray/segment intersection, also valid for onscreen edge-only targets.
  let ideal: MarkerPoint | undefined;
  let nearestT = Infinity;
  for (const segment of segments) {
    const delta = segment.horizontal ? dy : dx;
    if (Math.abs(delta) < 1e-9) continue;
    const t = (segment.fixed - (segment.horizontal ? center.y : center.x)) / delta;
    const value = (segment.horizontal ? center.x : center.y) + t * (segment.horizontal ? dx : dy);
    if (t >= 0 && t < nearestT && value >= segment.min - 1e-8 && value <= segment.max + 1e-8) {
      ideal = onSegment(segment, clamp(value, segment.min, segment.max));
      nearestT = t;
    }
  }
  ideal ??= { x: clamp(center.x, left, right), y: top };
  const blockers = [
    ...reserved,
    ...occupied.map((rect) => ({
      left: rect.left - MARKER_LIMITS.edgeMinSpacingPx,
      right: rect.right + MARKER_LIMITS.edgeMinSpacingPx,
      top: rect.top - MARKER_LIMITS.edgeMinSpacingPx,
      bottom: rect.bottom + MARKER_LIMITS.edgeMinSpacingPx,
    })),
  ];
  let best: MarkerPoint | null = null;
  let bestDistance = Infinity;
  let validPrevious: MarkerPoint | undefined;
  for (const segment of segments) {
    let intervals: Interval[] = [{ min: segment.min, max: segment.max }];
    for (const rect of blockers) {
      const fixedMin = segment.horizontal ? rect.top - bounds.bottom : rect.left - bounds.right;
      const fixedMax = segment.horizontal ? rect.bottom - bounds.top : rect.right - bounds.left;
      if (segment.fixed <= fixedMin || segment.fixed >= fixedMax) continue;
      intervals = subtract(intervals,
        segment.horizontal ? rect.left - bounds.right : rect.top - bounds.bottom,
        segment.horizontal ? rect.right - bounds.left : rect.bottom - bounds.top);
    }
    for (const interval of intervals) {
      const point = onSegment(segment, clamp(segment.horizontal ? ideal.x : ideal.y, interval.min, interval.max));
      const distance = squaredDistance(point, ideal);
      if (distance < bestDistance) { best = point; bestDistance = distance; }
      if (previous && Math.abs((segment.horizontal ? previous.y : previous.x) - segment.fixed) < 1e-6) {
        const value = segment.horizontal ? previous.x : previous.y;
        if (value >= interval.min && value <= interval.max) validPrevious = previous;
      }
    }
  }
  // Small camera/target motion must not alternate between equivalent free intervals.
  if (validPrevious && squaredDistance(validPrevious, ideal) <= bestDistance + MARKER_LIMITS.edgeMinSpacingPx ** 2) {
    return validPrevious;
  }
  return best;
}
