import type { SmokeSystem } from '../effects/SmokeSystem';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';

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
  let bestScore = Number.POSITIVE_INFINITY;
  let bestX = 0;
  let bestY = 0;
  const normalLength = Math.hypot(normalDirection.x, normalDirection.y);
  const normalX = normalLength > 0.001 ? normalDirection.x / normalLength : 0;
  const normalY = normalLength > 0.001 ? normalDirection.y / normalLength : 0;
  flowField.forEachReachableNeighbor(gridX, gridY, (_neighborX, _neighborY, directionIndex) => {
    const [rawX, rawY] = EnemyFlowFieldService.NEIGHBOR_DIRECTIONS[directionIndex];
    const length = Math.hypot(rawX, rawY);
    const directionX = rawX / length;
    const directionY = rawY / length;
    const deviation = directionX * normalX + directionY * normalY;
    const tieBreak = ((directionIndex + (seed >>> 0)) & 7) * 0.0001;
    const score = deviation + tieBreak;
    if (score < bestScore) {
      bestScore = score;
      bestX = directionX;
      bestY = directionY;
    }
  });

  if (bestScore === Number.POSITIVE_INFINITY) {
    states.delete(enemyId);
    return null;
  }
  const duration = 500 + ((seed >>> 0) % 301);
  states.set(enemyId, {
    cloudId,
    direction: { x: bestX, y: bestY },
    expiresAt: now + duration,
  });
  return mixNavigationDirections(normalDirection, bestX, bestY);
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
