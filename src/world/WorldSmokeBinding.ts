import { SmokeRuntime, type SmokeTarget } from '../systems/SmokeRuntime';
import type { WorldCombatCore } from '../combat/WorldCombatCore';
import type { EnemyManager } from '../entities/EnemyManager';
import type { TargetStatusSystem } from '../systems/TargetStatusSystem';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';
import type { ProjectileGrenadePayloadRequest } from '../projectile/ProjectileExplosionPort';
import { adaptProjectileCombatSource } from '../combat/ProjectileCombatContractAdapter';
import { combatTargetInstanceKey } from '../combat/CombatScope';

/** World-owned integration; activity targets are borrowed through a lifetime-aware read. */
export class WorldSmokeBinding {
  readonly runtime: SmokeRuntime;
  private readonly unsubscribe: () => void;
  constructor(private readonly combat: WorldCombatCore,
    private readonly getEnemies: () => EnemyManager | null,
    status: TargetStatusSystem, projectiles: ProjectileSpawnPort) {
    this.runtime = new SmokeRuntime({
      hasVisibleSegment: (cx, cy, ax, ay, bx, by) => combat.hasVisibleSegmentFrom(cx, cy, ax, ay, bx, by),
      hasClearLine: (sx, sy, ex, ey) => combat.hasLineOfSight(sx, sy, ex, ey),
      setVulnerability: (target, until) => status.setVulnerabilityContribution(`smoke:${combatTargetInstanceKey(target)}`,
        { targetType: 'enemy', targetId: String(target.id) }, until),
      spawnProjectile: request => { projectiles.spawnProjectile(request); },
      isFriendlySource: source => source.allegiance.factionId !== 'hostile' && (
        source.attribution.kind === 'player' || source.allegiance.kind === 'player'
        || source.allegiance.factionId === 'allied' || source.allegiance.factionId === 'friendly'),
    });
    this.unsubscribe = combat.observeEnemyDamageCommitted((outcome, x, y, now) => this.runtime.onDamage(outcome, x, y, now));
  }

  refresh(now: number): void {
    const manager = this.getEnemies();
    manager?.setSmokePerception(this.runtime, now);
    const targets: SmokeTarget[] = [];
    for (const enemy of manager?.getHostileEnemies() ?? []) {
      const ref = manager!.getCombatTargetRef(enemy.id);
      if (ref && enemy.sprite.active && enemy.getHp() > 0) targets.push({ ref, x: enemy.sprite.x, y: enemy.sprite.y, boss: enemy.isBoss() });
    }
    this.runtime.updateExposure(targets, now);
  }
  step(now: number): void {
    this.refresh(now);
    this.runtime.advanceStorm(now, (cloud, target, damage, source) => {
      this.combat.applyDamage(String(target.ref.id), damage, false, source.attribution.id, source.authoredSourceId,
        undefined, { source, target: target.ref, damageKind: 'ground', sourceSlot: 'utility', allowCritical: false,
          basis: { kind: 'source-resolved', amount: damage, sourceFactors: [
            { kind: 'runtime-power', multiplier: cloud.config.sourceDamageMultiplier ?? 1, resolvedAt: 'execution' },
            { kind: 'outgoing-modifier', multiplier: cloud.config.sourceOutgoingDamage?.damageMultiplier ?? 1, resolvedAt: 'execution' },
          ] } });
    });
  }
  createCloud(request: ProjectileGrenadePayloadRequest, now: number): void {
    if (request.effect.type !== 'smoke') return;
    const p = request.provenance;
    this.runtime.createCloud(request.x, request.y, request.effect,
      adaptProjectileCombatSource(p, request.projectileId, {
        gameplaySourceKind: p.gameplaySourceKind ?? 'player', attributionKind: p.attributionKind ?? 'player',
      }), now);
  }
  destroy(): void { this.getEnemies()?.setSmokePerception(null, 0); this.unsubscribe(); this.runtime.destroy(); }
}
