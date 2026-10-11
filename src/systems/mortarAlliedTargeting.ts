import type { CoopDefenseEnemyMortarConfig } from '../config/coopDefenseEnemies';
import type { SyncedMortarStrike } from '../types';

/** Structural reads only: targeting can run without entities, Phaser or a scene. */
export interface AlliedMortarEnemy {
  readonly id: string;
  readonly faction: 'hostile' | 'allied';
  readonly sprite: { readonly active: boolean; readonly x: number; readonly y: number };
  getHp(): number;
  isBurrowed(): boolean;
  isBoss(): boolean;
}

/** Capture a real enemy position, never a centroid that could leave the firing annulus.
 * Neighbours include all valid hostiles, even outside the nearest-N firing shortlist. */
export function selectAlliedMortarTarget(
  source: Pick<AlliedMortarEnemy, 'id' | 'sprite'>,
  enemies: readonly AlliedMortarEnemy[],
  config: CoopDefenseEnemyMortarConfig,
  strikes: readonly SyncedMortarStrike[],
  nowMs: number,
  isTargetable: (enemyId: string) => boolean,
): { x: number; y: number } | null {
  const hostiles = enemies.filter(enemy => enemy.faction === 'hostile' && enemy.sprite.active
    && enemy.getHp() > 0 && !enemy.isBurrowed() && isTargetable(enemy.id))
    .map(enemy => ({ id: enemy.id, x: enemy.sprite.x, y: enemy.sprite.y,
      weight: enemy.isBoss() ? config.alliedBossWeight : 1,
      distance: Math.hypot(enemy.sprite.x - source.sprite.x, enemy.sprite.y - source.sprite.y) }));
  // A close hostile blocks new windups even if a more distant group would score well.
  if (hostiles.some(enemy => enemy.distance < config.minRangePx)) return null;
  const candidates = hostiles.filter(enemy => enemy.distance <= config.maxRangePx)
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
    .slice(0, config.alliedTargetCandidateLimit);
  const occupied = strikes.filter(strike => strike.impactAt > nowMs && strike.sourceEnemyId !== source.id);
  let best: { x: number; y: number; score: number } | null = null;
  for (const candidate of candidates) {
    const density = hostiles.reduce((sum, neighbour) => sum + (
      Math.hypot(neighbour.x - candidate.x, neighbour.y - candidate.y) <= config.impactRadiusPx
        ? neighbour.weight : 0), 0);
    const overlaps = occupied.filter(strike => Math.hypot(strike.targetX - candidate.x, strike.targetY - candidate.y)
      < strike.radius + config.impactRadiusPx + config.overlapMarginPx).length;
    const rangePreference = Math.min(1, candidate.distance / config.preferredRangeMinPx);
    const score = density * rangePreference / (1 + config.overlapPenalty * overlaps);
    if (!best || score > best.score) best = { x: candidate.x, y: candidate.y, score };
  }
  return best ? { x: best.x, y: best.y } : null;
}
