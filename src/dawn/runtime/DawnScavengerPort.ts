import type { EnemyManager } from '../../entities/EnemyManager';

export const DAWN_SCAVENGER_KIND = 'dawn-scavenger';
export interface DawnScavengerOutcome {
  readonly enemyId: string;
  readonly originId?: string;
  readonly outcome: 'killed' | 'escaped';
  readonly x: number;
  readonly y: number;
}
export interface DawnScavengerSpawnRequest {
  readonly count: number;
  readonly position: { readonly x: number; readonly y: number };
  readonly escapeTarget?: { readonly x: number; readonly y: number };
  readonly originId?: string;
}

/** Activity-scoped host port. Dispose subscriptions when the Activity ends. */
export function createDawnScavengerPort(
  enemies: Pick<EnemyManager, 'hostSpawnAtWorld' | 'onScavengerOutcome'>,
  isActiveHost: () => boolean,
) {
  return {
    spawn(request: DawnScavengerSpawnRequest): readonly string[] {
      if (!isActiveHost()) return [];
      const points = [request.position, ...(request.escapeTarget ? [request.escapeTarget] : [])];
      if (!Number.isSafeInteger(request.count) || request.count < 0
        || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
        throw new Error('[DawnScavenger] Invalid spawn request');
      }
      const ids: string[] = [];
      for (let i = 0; i < request.count && isActiveHost(); i++) {
        const enemy = enemies.hostSpawnAtWorld(request.position.x, request.position.y, DAWN_SCAVENGER_KIND,
          { originId: request.originId });
        enemy.escapeTarget = request.escapeTarget ? { ...request.escapeTarget } : null;
        ids.push(enemy.id);
      }
      return ids;
    },
    onOutcome(listener: (event: DawnScavengerOutcome) => void): () => void {
      return enemies.onScavengerOutcome(event => { if (isActiveHost()) listener(event); });
    },
  };
}
