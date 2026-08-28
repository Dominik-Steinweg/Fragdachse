import {
  CELL_SIZE,
  PLAYER_SIZE,
} from '../config';
import type { WorldMetrics } from '../world/WorldMetrics';

export const GRID_CORNER_ASSIST_LOOKAHEAD_PX = 10;
export const GRID_CORNER_ASSIST_MAX_CORRECTION_PX = 16;

const PLAYER_RADIUS = PLAYER_SIZE * 0.5;
const TANGENCY_EPSILON_PX = 0.000001;
const CORRECTION_STEP_PX = 0.25;
const CORRECTION_TIE_EPSILON_PX = CORRECTION_STEP_PX;
const CORRECTION_STEPS = GRID_CORNER_ASSIST_MAX_CORRECTION_PX / CORRECTION_STEP_PX;

export type MovementBlockedCell = (gridX: number, gridY: number) => boolean;

export interface GridCornerAssistOutput {
  dx: number;
  dy: number;
}

/**
 * Applies the stateless, normal-movement-only corner assist.
 *
 * The caller owns `output` so this hot-path helper does not allocate. If the forward path is
 * free, or if both side corrections are equally good, the original input is copied exactly.
 */
export function applyGridCornerAssist(
  worldX: number,
  worldY: number,
  inputDx: number,
  inputDy: number,
  worldMetrics: WorldMetrics,
  isMovementBlockedCell: MovementBlockedCell,
  output: GridCornerAssistOutput,
): void {
  output.dx = inputDx;
  output.dy = inputDy;

  const inputLength = Math.sqrt(inputDx * inputDx + inputDy * inputDy);
  if (inputLength <= Number.EPSILON) return;

  const forwardX = inputDx / inputLength;
  const forwardY = inputDy / inputLength;
  const forwardDx = forwardX * GRID_CORNER_ASSIST_LOOKAHEAD_PX;
  const forwardDy = forwardY * GRID_CORNER_ASSIST_LOOKAHEAD_PX;

  if (!isMovementPathBlocked(
    worldX,
    worldY,
    forwardDx,
    forwardDy,
    worldMetrics,
    isMovementBlockedCell,
  )) {
    return;
  }

  const sideX = -forwardY;
  const sideY = forwardX;
  const positiveCorrection = findMinimumSideCorrection(
    worldX,
    worldY,
    forwardDx,
    forwardDy,
    sideX,
    sideY,
    worldMetrics,
    isMovementBlockedCell,
  );
  const negativeCorrection = findMinimumSideCorrection(
    worldX,
    worldY,
    forwardDx,
    forwardDy,
    -sideX,
    -sideY,
    worldMetrics,
    isMovementBlockedCell,
  );

  if (positiveCorrection < 0 && negativeCorrection < 0) return;

  if (
    positiveCorrection >= 0
    && negativeCorrection >= 0
    && Math.abs(positiveCorrection - negativeCorrection) <= CORRECTION_TIE_EPSILON_PX
  ) {
    // Symmetric or geometrically ambiguous obstacles must not turn the assist into navigation.
    return;
  }

  const usePositiveSide = negativeCorrection < 0
    || (positiveCorrection >= 0 && positiveCorrection < negativeCorrection);
  const correction = usePositiveSide ? positiveCorrection : negativeCorrection;
  const correctionSideX = usePositiveSide ? sideX : -sideX;
  const correctionSideY = usePositiveSide ? sideY : -sideY;
  const correctionFactor = correction / GRID_CORNER_ASSIST_LOOKAHEAD_PX;

  output.dx = forwardX + correctionSideX * correctionFactor;
  output.dy = forwardY + correctionSideY * correctionFactor;
}

function findMinimumSideCorrection(
  worldX: number,
  worldY: number,
  forwardDx: number,
  forwardDy: number,
  sideX: number,
  sideY: number,
  worldMetrics: WorldMetrics,
  isMovementBlockedCell: MovementBlockedCell,
): number {
  for (let step = 0; step <= CORRECTION_STEPS; step += 1) {
    const correction = step * CORRECTION_STEP_PX;
    if (!isMovementPathBlocked(
      worldX,
      worldY,
      forwardDx + sideX * correction,
      forwardDy + sideY * correction,
      worldMetrics,
      isMovementBlockedCell,
    )) {
      return correction;
    }
  }
  return -1;
}

function isMovementPathBlocked(
  worldX: number,
  worldY: number,
  deltaX: number,
  deltaY: number,
  worldMetrics: WorldMetrics,
  isMovementBlockedCell: MovementBlockedCell,
): boolean {
  const endX = worldX + deltaX;
  const endY = worldY + deltaY;
  const radius = PLAYER_RADIUS;

  const minGridX = Math.max(
    0,
    Math.floor((Math.min(worldX, endX) - radius - worldMetrics.offsetX) / CELL_SIZE),
  );
  const maxGridX = Math.min(
    worldMetrics.gridCols - 1,
    Math.floor((Math.max(worldX, endX) + radius - worldMetrics.offsetX) / CELL_SIZE),
  );
  const minGridY = Math.max(
    0,
    Math.floor((Math.min(worldY, endY) - radius - worldMetrics.offsetY) / CELL_SIZE),
  );
  const maxGridY = Math.min(
    worldMetrics.gridRows - 1,
    Math.floor((Math.max(worldY, endY) + radius - worldMetrics.offsetY) / CELL_SIZE),
  );

  for (let gridY = minGridY; gridY <= maxGridY; gridY += 1) {
    for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
      if (!isMovementBlockedCell(gridX, gridY)) continue;

      const left = worldMetrics.offsetX + gridX * CELL_SIZE;
      const top = worldMetrics.offsetY + gridY * CELL_SIZE;
      const right = left + CELL_SIZE;
      const bottom = top + CELL_SIZE;
      if (circlePathOverlapsRect(
        worldX,
        worldY,
        endX,
        endY,
        left,
        top,
        right,
        bottom,
        radius,
      )) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Returns true only for positive circle/rectangle overlap. A path that starts embedded in a
 * blocker but exits it during this assisted step is allowed; Arcade will resolve the existing
 * contact while the assist supplies the escape direction.
 */
function circlePathOverlapsRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  radius: number,
): boolean {
  const radiusWithTolerance = Math.max(0, radius - TANGENCY_EPSILON_PX);
  const radiusSquared = radiusWithTolerance * radiusWithTolerance;
  const startDistanceSquared = pointToRectDistanceSquared(startX, startY, left, top, right, bottom);
  const endDistanceSquared = pointToRectDistanceSquared(endX, endY, left, top, right, bottom);

  if (
    startDistanceSquared < radiusSquared
    && endDistanceSquared >= radiusSquared
  ) {
    return false;
  }

  return segmentToRectDistanceSquared(
    startX,
    startY,
    endX,
    endY,
    left,
    top,
    right,
    bottom,
  ) < radiusSquared;
}

function pointToRectDistanceSquared(
  x: number,
  y: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): number {
  const dx = x < left ? left - x : x > right ? x - right : 0;
  const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
  return dx * dx + dy * dy;
}

function segmentToRectDistanceSquared(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): number {
  if (segmentIntersectsRect(startX, startY, endX, endY, left, top, right, bottom)) return 0;

  let best = Number.POSITIVE_INFINITY;
  best = Math.min(best, segmentToSegmentDistanceSquared(startX, startY, endX, endY, left, top, right, top));
  best = Math.min(best, segmentToSegmentDistanceSquared(startX, startY, endX, endY, right, top, right, bottom));
  best = Math.min(best, segmentToSegmentDistanceSquared(startX, startY, endX, endY, right, bottom, left, bottom));
  best = Math.min(best, segmentToSegmentDistanceSquared(startX, startY, endX, endY, left, bottom, left, top));
  return best;
}

function segmentToSegmentDistanceSquared(
  firstStartX: number,
  firstStartY: number,
  firstEndX: number,
  firstEndY: number,
  secondStartX: number,
  secondStartY: number,
  secondEndX: number,
  secondEndY: number,
): number {
  return Math.min(
    pointToSegmentDistanceSquared(
      firstStartX,
      firstStartY,
      secondStartX,
      secondStartY,
      secondEndX,
      secondEndY,
    ),
    pointToSegmentDistanceSquared(
      firstEndX,
      firstEndY,
      secondStartX,
      secondStartY,
      secondEndX,
      secondEndY,
    ),
    pointToSegmentDistanceSquared(
      secondStartX,
      secondStartY,
      firstStartX,
      firstStartY,
      firstEndX,
      firstEndY,
    ),
    pointToSegmentDistanceSquared(
      secondEndX,
      secondEndY,
      firstStartX,
      firstStartY,
      firstEndX,
      firstEndY,
    ),
  );
}

function pointToSegmentDistanceSquared(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) {
    const offsetX = pointX - startX;
    const offsetY = pointY - startY;
    return offsetX * offsetX + offsetY * offsetY;
  }

  const t = Math.max(0, Math.min(1, ((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared));
  const closestX = startX + t * dx;
  const closestY = startY + t * dy;
  const offsetX = pointX - closestX;
  const offsetY = pointY - closestY;
  return offsetX * offsetX + offsetY * offsetY;
}

function segmentIntersectsRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  let enter = 0;
  let exit = 1;
  const dx = endX - startX;
  const dy = endY - startY;

  if (Math.abs(dx) <= Number.EPSILON) {
    if (startX < left || startX > right) return false;
  } else {
    let first = (left - startX) / dx;
    let second = (right - startX) / dx;
    if (first > second) {
      const swap = first;
      first = second;
      second = swap;
    }
    enter = Math.max(enter, first);
    exit = Math.min(exit, second);
    if (enter > exit) return false;
  }

  if (Math.abs(dy) <= Number.EPSILON) {
    if (startY < top || startY > bottom) return false;
  } else {
    let first = (top - startY) / dy;
    let second = (bottom - startY) / dy;
    if (first > second) {
      const swap = first;
      first = second;
      second = swap;
    }
    enter = Math.max(enter, first);
    exit = Math.min(exit, second);
    if (enter > exit) return false;
  }

  return true;
}
