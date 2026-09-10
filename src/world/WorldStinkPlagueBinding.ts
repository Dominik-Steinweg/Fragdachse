import { StinkPlagueRuntime, type PlagueTarget, type PlagueDeathContribution } from '../systems/StinkPlagueRuntime';
import type { WorldCombatCore } from '../combat/WorldCombatCore';
import { combatTargetInstanceKey, isSameCombatTargetInstance } from '../combat/CombatScope';
import type { EnemyManager } from '../entities/EnemyManager';
import type { TargetStatusSystem } from '../systems/TargetStatusSystem';
import type { StinkCloudDamageEvent } from '../effects/StinkCloudSystem';
import type { SlimeDeathBurst } from '../systems/SlimeTrailSystem';
import type { EnemyFlowFieldService } from '../systems/EnemyFlowFieldService';

export interface WorldStinkPlagueBindingOptions {
  readonly combat: WorldCombatCore;
  readonly getEnemies: () => EnemyManager | null;
  readonly getNavigation: () => EnemyFlowFieldService | null;
  readonly status: TargetStatusSystem;
  readonly isPlayerPresent: (playerId: string) => boolean;
  readonly areAllies: (left: string, right: string) => boolean;
  readonly deathBurst: (enemyId: string, x: number, y: number, now: number, plague: PlagueDeathContribution) => SlimeDeathBurst | null;
  readonly publishBurst: (burst: SlimeDeathBurst) => void;
}

/** Connects primary cloud contacts, committed damage and the existing slime death owner. */
export class WorldStinkPlagueBinding {
  readonly runtime: StinkPlagueRuntime;
  private readonly unsubscribe: () => void;
  private readonly owners = new Set<string>();
  private enemies: EnemyManager | null = null;
  private destroyed = false;

  constructor(private readonly options: WorldStinkPlagueBindingOptions) {
    const { combat, status } = options;
    this.runtime = new StinkPlagueRuntime({
      damage: (target, source) => {
        combat.applyDamage(String(target.id), source.config.damagePerTick * source.damageMultiplier, false, source.ownerId, 'weapon.stink_plague',
          undefined, { target, damageKind: 'ground', sourceSlot: 'utility', allowCritical: false,
            source: { gameplaySource: { kind: 'player', id: source.ownerId }, attribution: { kind: 'player', id: source.ownerId },
              allegiance: { ownerId: source.ownerId, kind: 'player' }, authoredSourceId: 'weapon.stink_plague', sourceSlot: 'utility', origin: 'ground' },
            basis: { kind: 'source-resolved', amount: source.config.damagePerTick * source.damageMultiplier, sourceFactors: [
              { kind: 'outgoing-modifier', multiplier: source.damageMultiplier, resolvedAt: 'execution' },
            ] } });
      },
      vulnerability: (target, until) => status.setVulnerabilityContribution(`plague:${combatTargetInstanceKey(target)}`,
        { targetType: 'enemy', targetId: String(target.id) }, until),
      canReach: (from, to) => options.getNavigation()?.hasWalkableCircleLine(from.x, from.y, to.x, to.y, from.radius) ?? false,
      canTransfer: (from, to) => combat.hasLineOfSight(from.x, from.y, to.x, to.y),
      areAllies: options.areAllies,
    });
    combat.setTargetLifeLeechFractionResolver((attackerId, target, now) => this.runtime.getLifeLeech(target, attackerId, now));
    this.unsubscribe = combat.observeEnemyDamageCommitted((outcome, x, y, now) => {
      if (this.destroyed || outcome.transition.kind !== 'dead') return;
      const plague = this.runtime.consumeDeath(outcome.target, now);
      if (!plague) return;
      const burst = options.deathBurst(String(outcome.target.id), x, y, now, plague);
      if (burst) options.publishBurst(burst);
    });
  }

  advance(now: number): void {
    if (this.destroyed) return;
    this.bindEnemies();
    for (const owner of this.owners) if (!this.options.isPlayerPresent(owner)) {
      this.runtime.removeOwner(owner, now); this.owners.delete(owner);
    }
    this.runtime.advance(this.targets(), now);
  }

  applyPrimaryContact(event: StinkCloudDamageEvent, now: number): void {
    if (this.destroyed || event.kind !== 'player-primary' || !event.plague) return;
    this.bindEnemies();
    this.owners.add(event.ownerId);
    for (const target of this.targets()) {
      // Same center-based membership as the existing primary AoE damage path.
      if (Math.hypot(target.x - event.x, target.y - event.y) <= event.radius) this.runtime.applyDirect(target, event.plague, now);
    }
  }

  spread(now: number): void { if (!this.destroyed) this.runtime.spread(this.targets(), now); }

  removeOwner(playerId: string, now: number): void {
    this.runtime.removeOwner(playerId, now); this.owners.delete(playerId);
  }

  clearTargets(): void {
    this.enemies?.setPlagueMovementSource(null); this.enemies = null;
    this.runtime.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.enemies?.setPlagueMovementSource(null);
    this.unsubscribe(); this.options.combat.setTargetLifeLeechFractionResolver(null);
    this.runtime.clear(); this.owners.clear(); this.enemies = null;
  }

  private bindEnemies(): void {
    const manager = this.options.getEnemies();
    if (manager === this.enemies) return;
    this.enemies?.setPlagueMovementSource(null);
    this.runtime.clear();
    this.enemies = manager;
    manager?.setPlagueMovementSource({ getTarget: (enemyId, now) => {
      const ref = manager.getCombatTargetRef(enemyId);
      const target = ref ? this.runtime.getMovementTarget(ref, now) : null;
      const currentRef = target ? manager.getCombatTargetRef(String(target.ref.id)) : null;
      const entity = currentRef ? manager.getEnemy(String(currentRef.id)) : null;
      return target && currentRef && isSameCombatTargetInstance(target.ref, currentRef) && entity && entity.getHp() > 0
        ? { x: entity.sprite.x, y: entity.sprite.y } : null;
    } });
  }

  private targets(): PlagueTarget[] {
    const targets: PlagueTarget[] = [];
    for (const enemy of this.enemies?.getHostileEnemies() ?? []) {
      const ref = this.enemies!.getCombatTargetRef(enemy.id);
      if (ref && enemy.sprite.active && enemy.getHp() > 0) targets.push({ ref, x: enemy.sprite.x, y: enemy.sprite.y,
        radius: enemy.getCollisionRadius(), boss: enemy.isBoss() });
    }
    return targets;
  }
}
