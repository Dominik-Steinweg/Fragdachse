import type { WorldCombatCore } from './WorldCombatCore';
import type { ProjectileCollisionTargetQueryPort, ProjectileCollisionTargetSink, ProjectileTargetRef } from '../projectile/ProjectileTargetPort';
import type { ProjectileTargetQueryPort } from '../entities/ProjectileHomingController';
import { CombatGeometry } from '../systems/CombatGeometry';

/** AP2 composes this Combat subset with the existing World target provider. */
export class CombatProjectileQueryAdapter implements ProjectileCollisionTargetQueryPort, ProjectileTargetQueryPort {
  constructor(private readonly combat: Pick<WorldCombatCore, 'readCollisionTargets' | 'getPartProjectileHit' | 'readPartTargets' | 'canDamageTarget'>,
    private readonly homing?: ProjectileTargetQueryPort) {}

  readonly queryTargets: ProjectileTargetQueryPort['queryTargets'] = (config, owner, x, y, radius, emit) => {
    this.homing?.queryTargets(config, owner, x, y, radius, (id, type, tx, ty) => {
      if (type !== 'enemies' || this.combat.canDamageTarget(owner, id)) emit(id, type, tx, ty);
    });
    if (!config.targetTypes?.includes('enemies')) return;
    for (const part of this.combat.readPartTargets()) {
      if (!this.combat.canDamageTarget(owner, part.id)) continue;
      const point = CombatGeometry.nearestPartPoint(part.snapshot, x, y);
      if (point && point.distance <= radius) emit(part.id, 'enemies', point.x, point.y);
    }
  };

  readonly readTargetPosition: NonNullable<ProjectileTargetQueryPort['readTargetPosition']> = (config, owner, id, type, x, y) => {
    if (type === 'enemies') {
      if (!this.combat.canDamageTarget(owner, id)) return null;
      const part = this.combat.readPartTargets().find(p => p.id === id);
      if (part) {
        const point = CombatGeometry.nearestPartPoint(part.snapshot, x, y);
        return point ? { id, type, x: point.x, y: point.y } : null;
      }
    }
    return this.homing?.readTargetPosition?.(config, owner, id, type, x, y) ?? null;
  };

  readCollisionTargets(sink: ProjectileCollisionTargetSink): void { this.combat.readCollisionTargets(sink); }

  getWorldTargetHit(target: ProjectileTargetRef, sx: number, sy: number, ex: number, ey: number, halfWidth: number, halfHeight: number) {
    return target.kind === 'enemy'
      ? this.combat.getPartProjectileHit(target.id, sx, sy, ex, ey, Math.max(halfWidth, halfHeight))
      : undefined;
  }
}
