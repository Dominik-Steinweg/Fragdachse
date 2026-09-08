import type { SmokePerceptionPort } from '../systems/SmokeRules';
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
  smokeSystem: SmokePerceptionPort | null,
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
  const influence = smokeSystem.getConfusion(enemyId, now);
  if (!influence) {
    states.delete(enemyId);
    return null;
  }
  const cloudId = influence.cloudId;
  if (current && current.expiresAt > now) {
    let reachable = false;
    flowField.forEachReachableNeighbor(gridX, gridY, (_x, _y, index) => {
      const [dx, dy] = EnemyFlowFieldService.NEIGHBOR_DIRECTIONS[index];
      const length = Math.hypot(dx, dy);
      if (dx / length * current.direction.x + dy / length * current.direction.y > 0.999) reachable = true;
    });
    // A cell transition or changed obstacle may invalidate the held direction before its timer.
    if (reachable) return mixNavigationDirections(normalDirection, current.direction.x, current.direction.y, influence.fraction);
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
    const centerDistance = Math.hypot(influence.x - x, influence.y - y);
    const inward = centerDistance > 0 ? (directionX * (influence.x - x) + directionY * (influence.y - y)) / centerDistance : 0;
    const retention = centerDistance >= influence.radius * influence.edgeFraction ? influence.retentionBias : 0;
    const rank = mixDirectionSeed(seed, directionIndex) * (1 - retention * Math.max(0, inward));
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
  const duration = influence.directionMinMs + ((seed >>> 0) % (1 + influence.directionMaxMs - influence.directionMinMs));
  states.set(enemyId, {
    cloudId,
    direction: { x: confusionX, y: confusionY },
    expiresAt: now + duration,
  });
  return mixNavigationDirections(normalDirection, confusionX, confusionY, influence.fraction);
}

function mixNavigationDirections(
  normalDirection: { x: number; y: number },
  confusionX: number,
  confusionY: number,
  fraction: number,
): { x: number; y: number } {
  const x = normalDirection.x * (1 - fraction) + confusionX * fraction;
  const y = normalDirection.y * (1 - fraction) + confusionY * fraction;
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
