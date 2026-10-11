import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemySpecialMovementSource } from '../entities/EnemyManager';

/** Ordered composition preserves the existing special movement precedence. */
export class CompositeEnemySpecialMovementSource implements EnemySpecialMovementSource {
  constructor(private readonly sources: readonly (EnemySpecialMovementSource | null)[]) {}

  getMovementOverride(enemy: EnemyEntity, nowMs: number): { vx: number; vy: number } | null {
    for (const source of this.sources) {
      const movement = source?.getMovementOverride(enemy, nowMs);
      if (movement) return movement;
    }
    return null;
  }
}
