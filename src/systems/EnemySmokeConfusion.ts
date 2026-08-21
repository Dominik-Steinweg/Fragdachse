import type { SmokeSystem } from '../effects/SmokeSystem';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';

const CONFUSION_DIRECTION_DOT_CUTOFF = 0.5;
const DIRECTION_RANK_SALT = 0x45d9f3b;

export interface EnemySmokeConfusionState {
  readonly cloudId: number;
  readonly direction: { readonly x: number; readonly y: number };
  readonly expiresAt: number;
}

export function resolveEnemySmokeConfusion(
  states: Map<string, EnemySmokeConfusionState>,
  enemyId: string,
  x: number,
  y: number,
  smokeSystem: SmokeSystem | null,
  flowField: Pick<EnemyFlowFieldService, 'forEachReachableNeighbor'>,
  gridX: number,
  gridY: number,
  normalDirection: { x: number; y: number },
  now: number,
): { x: number; y: number } | null {
  if (!smokeSystem) {
    states.delete(enemyId);
    return null;
  }

  const current = states.get(enemyId);
  const cloudId = smokeSystem.getActiveCloudIdAt(x, y, now, current?.cloudId);
  if (cloudId === null) {
    states.delete(enemyId);
    return null;
  }
  if (current && current.cloudId === cloudId && current.expiresAt > now) {
    return mixNavigationDirections(normalDirection, current.direction.x, current.direction.y);
  }

  const seed = hashString(enemyId) ^ Math.imul(cloudId, 0x9e3779b9) ^ (current?.expiresAt ?? 0);
  let bestPreferredRank = Number.POSITIVE_INFINITY;
  let bestPreferredX = 0;
  let bestPreferredY = 0;
  let bestPreferredNewRank = Number.POSITIVE_INFINITY;
  let bestPreferredNewX = 0;
  let bestPreferredNewY = 0;
  let bestFallbackRank = Number.POSITIVE_INFINITY;
  let bestFallbackX = 0;
  let bestFallbackY = 0;
  let bestFallbackNewRank = Number.POSITIVE_INFINITY;
  let bestFallbackNewX = 0;
  let bestFallbackNewY = 0;
  const normalLength = Math.hypot(normalDirection.x, normalDirection.y);
  const normalX = normalLength > 0.001 ? normalDirection.x / normalLength : 0;
  const normalY = normalLength > 0.001 ? normalDirection.y / normalLength : 0;
  flowField.forEachReachableNeighbor(gridX, gridY, (_neighborX, _neighborY, directionIndex) => {
    const [rawX, rawY] = EnemyFlowFieldService.NEIGHBOR_DIRECTIONS[directionIndex];
    const length = Math.hypot(rawX, rawY);
    const directionX = rawX / length;
    const directionY = rawY / length;
    const deviation = directionX * normalX + directionY * normalY;
    const rank = mixDirectionSeed(seed, directionIndex);
    const sameAsPrevious = current !== undefined
      && Math.abs(directionX - current.direction.x) < 0.0001
      && Math.abs(directionY - current.direction.y) < 0.0001;

    if (rank < bestFallbackRank) {
      bestFallbackRank = rank;
      bestFallbackX = directionX;
      bestFallbackY = directionY;
    }
    if (!sameAsPrevious && rank < bestFallbackNewRank) {
      bestFallbackNewRank = rank;
      bestFallbackNewX = directionX;
      bestFallbackNewY = directionY;
    }

    if (deviation <= CONFUSION_DIRECTION_DOT_CUTOFF) {
      if (rank < bestPreferredRank) {
        bestPreferredRank = rank;
        bestPreferredX = directionX;
        bestPreferredY = directionY;
      }
      if (!sameAsPrevious && rank < bestPreferredNewRank) {
        bestPreferredNewRank = rank;
        bestPreferredNewX = directionX;
        bestPreferredNewY = directionY;
      }
    }
  });

  if (bestFallbackRank === Number.POSITIVE_INFINITY) {
    states.delete(enemyId);
    return null;
  }
  const hasPreferredDirection = bestPreferredRank !== Number.POSITIVE_INFINITY;
  const preferredNewDirection = bestPreferredNewRank !== Number.POSITIVE_INFINITY;
  const hasFallbackNewDirection = bestFallbackNewRank !== Number.POSITIVE_INFINITY;
  const confusionX = hasPreferredDirection
    ? (preferredNewDirection ? bestPreferredNewX : bestPreferredX)
    : (hasFallbackNewDirection ? bestFallbackNewX : bestFallbackX);
  const confusionY = hasPreferredDirection
    ? (preferredNewDirection ? bestPreferredNewY : bestPreferredY)
    : (hasFallbackNewDirection ? bestFallbackNewY : bestFallbackY);
  const duration = 500 + ((seed >>> 0) % 301);
  states.set(enemyId, {
    cloudId,
    direction: { x: confusionX, y: confusionY },
    expiresAt: now + duration,
  });
  return mixNavigationDirections(normalDirection, confusionX, confusionY);
}

function mixNavigationDirections(
  normalDirection: { x: number; y: number },
  confusionX: number,
  confusionY: number,
): { x: number; y: number } {
  const x = normalDirection.x * 0.25 + confusionX * 0.75;
  const y = normalDirection.y * 0.25 + confusionY * 0.75;
  const length = Math.hypot(x, y);
  return length > 0.001 ? { x: x / length, y: y / length } : normalDirection;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function mixDirectionSeed(seed: number, directionIndex: number): number {
  let mixed = seed ^ Math.imul(directionIndex + 1, DIRECTION_RANK_SALT);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}
