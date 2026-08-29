import { BURROW_EXIT_ASSIST_MAX_DISTANCE_PX } from '../config';
import {
  worldCellCenter,
  worldPositionToNearestCell,
  type WorldMetrics,
} from '../world/WorldMetrics';
import type { ArenaObstacleIndex } from './ArenaObstacleIndex';

export interface BurrowExitPosition {
  readonly x: number;
  readonly y: number;
}

const DISTANCE_SQ_EPSILON_FACTOR = Number.EPSILON * 16;

/**
 * Resolves the nearest valid raster-aligned exit position without changing Burrow state.
 *
 * The authored World uses 32-pixel cells, so the only assist candidates are the nearest
 * horizontal centerline, the nearest vertical centerline, and their intersection. The
 * WorldMetrics helpers remain the single owner of the cell-to-world conversion.
 */
export function resolveBurrowExitPosition(
  metrics: WorldMetrics,
  obstacleIndex: ArenaObstacleIndex,
  currentX: number,
  currentY: number,
  playerRadius: number,
  inputDx = 0,
  inputDy = 0,
): BurrowExitPosition | null {
  if (
    !Number.isFinite(currentX)
    || !Number.isFinite(currentY)
    || !Number.isFinite(playerRadius)
    || playerRadius < 0
    || metrics.gridCols <= 0
    || metrics.gridRows <= 0
  ) {
    return null;
  }

  if (isValidExitPosition(metrics, obstacleIndex, currentX, currentY, playerRadius)) {
    return { x: currentX, y: currentY };
  }

  const nearestCell = worldPositionToNearestCell(metrics, currentX, currentY);
  const center = worldCellCenter(metrics, nearestCell.gridX, nearestCell.gridY);
  const maxDistanceSq = BURROW_EXIT_ASSIST_MAX_DISTANCE_PX
    * BURROW_EXIT_ASSIST_MAX_DISTANCE_PX;

  let bestCandidateIndex = -1;
  let bestX = 0;
  let bestY = 0;
  let bestDistanceSq = 0;
  let bestDirectionScore = 0;

  // Fixed A/B/C order is the final deterministic tie-breaker. The raw input vector is
  // sufficient for the direction score because multiplying it by a positive normalization
  // factor cannot change the ordering of candidates.
  for (let candidateIndex = 0; candidateIndex < 3; candidateIndex += 1) {
    let candidateX: number;
    let candidateY: number;
    if (candidateIndex === 0) {
      candidateX = center.x;
      candidateY = currentY;
    } else if (candidateIndex === 1) {
      candidateX = currentX;
      candidateY = center.y;
    } else {
      candidateX = center.x;
      candidateY = center.y;
    }

    const offsetX = candidateX - currentX;
    const offsetY = candidateY - currentY;
    const distanceSq = offsetX * offsetX + offsetY * offsetY;
    if (distanceSq > maxDistanceSq) continue;
    if (!isValidExitPosition(metrics, obstacleIndex, candidateX, candidateY, playerRadius)) continue;

    const directionScore = offsetX * inputDx + offsetY * inputDy;
    if (
      bestCandidateIndex < 0
      || isStrictlyCloser(distanceSq, bestDistanceSq)
      || (
        areDistancesEqual(distanceSq, bestDistanceSq)
        && (
          directionScore > bestDirectionScore
          || (directionScore === bestDirectionScore && candidateIndex < bestCandidateIndex)
        )
      )
    ) {
      bestCandidateIndex = candidateIndex;
      bestX = candidateX;
      bestY = candidateY;
      bestDistanceSq = distanceSq;
      bestDirectionScore = directionScore;
    }
  }

  return bestCandidateIndex < 0 ? null : { x: bestX, y: bestY };
}

function isValidExitPosition(
  metrics: WorldMetrics,
  obstacleIndex: ArenaObstacleIndex,
  x: number,
  y: number,
  radius: number,
): boolean {
  if (
    x - radius < metrics.offsetX
    || x + radius > metrics.maxX
    || y - radius < metrics.offsetY
    || y + radius > metrics.maxY
  ) {
    return false;
  }
  return !obstacleIndex.isCircleBlocked(x, y, radius);
}

function areDistancesEqual(first: number, second: number): boolean {
  const epsilon = Math.max(1, Math.abs(first), Math.abs(second)) * DISTANCE_SQ_EPSILON_FACTOR;
  return Math.abs(first - second) <= epsilon;
}

function isStrictlyCloser(candidate: number, best: number): boolean {
  return candidate < best && !areDistancesEqual(candidate, best);
}
