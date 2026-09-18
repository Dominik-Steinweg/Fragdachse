import * as Phaser from 'phaser';
import { hasCoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type { EnemyManager } from '../entities/EnemyManager';
import type { WorldCombatCore } from '../combat/WorldCombatCore';
import type { WorldMetrics } from '../world/WorldMetrics';
import { worldCellCenter } from '../world/WorldMetrics';
import type { NecromancySystem } from '../systems/NecromancySystem';
import { allyFlowFieldId, type FlowFieldCoordinator } from '../systems/flowfield/FlowFieldCoordinator';
import { EnemyFlowFieldService } from '../systems/EnemyFlowFieldService';
import type { EnemyIntentSystem } from '../systems/navigation/EnemyIntentSystem';
import { ShootingRangeRuntime } from './ShootingRangeRuntime';
import { SHOOTING_RANGE, isInsideShootingRange } from './ShootingRangeLayout';
import type { ShootingRangeState } from './ShootingRangeContracts';

/** Lobby-owned enemies and training state. Summoned allies share the ordinary enemy plumbing. */
export class ShootingRangeWorldBinding {
  readonly runtime: ShootingRangeRuntime;
  necromancy: NecromancySystem | null = null;
  navigation: FlowFieldCoordinator | null = null;
  ground: EnemyFlowFieldService | null = null;
  readonly allyFlowFields = new Map<string, EnemyFlowFieldService>();
  intents: EnemyIntentSystem | null = null;
  private replica: ShootingRangeState | null = null;
  private readonly stopObserving: () => void;
  private destroyed = false;
  constructor(readonly enemies: EnemyManager, readonly metrics: WorldMetrics,
    combat: WorldCombatCore, readonly authoritative: boolean, private readonly getPlayerIds: () => readonly string[] = () => []) {
    this.runtime = new ShootingRangeRuntime({
      spawn: slot => {
        if (!hasCoopDefenseEnemyKind(SHOOTING_RANGE.enemyKind)) throw new Error('Unknown shooting range enemy kind');
        const [gx, gy] = SHOOTING_RANGE.targets[slot];
        const point = worldCellCenter(metrics, gx, gy);
        const enemy = enemies.hostSpawnAtWorld(point.x, point.y, SHOOTING_RANGE.enemyKind);
        enemies.hostSetVitalsBaseline(enemy.id, SHOOTING_RANGE.targetHp, SHOOTING_RANGE.targetHp);
        enemy.setStationary(true);
        return { id: enemy.id, generation: enemies.getCombatTargetRef(enemy.id)!.instance.entityGeneration };
      },
      alive: target => enemies.getCombatTargetRef(target.id)?.instance.entityGeneration === target.generation,
      remove: target => {
        const ref = enemies.getCombatTargetRef(target.id);
        if (!ref || ref.instance.entityGeneration !== target.generation) return;
        enemies.hostRemoveWithoutKill(target.id);
        combat.releaseRemovedEnemy(ref);
      },
    });
    this.stopObserving = authoritative ? combat.observeEnemyDamageCommitted((outcome, _x, _y, now) => {
      this.runtime.recordDamage({ id: String(outcome.target.id), generation: outcome.target.instance.entityGeneration }, outcome.actualDamage, now);
    }) : () => {};
  }
  snapshot(): ShootingRangeState { return this.authoritative ? this.runtime.snapshot() : this.replica ?? this.runtime.snapshot(); }
  acceptSnapshot(state: ShootingRangeState | null | undefined): void { this.replica = state ?? null; }
  isTrainingTarget(id: string): boolean {
    return this.authoritative ? this.runtime.isTrainingTarget(id) : this.replica?.targets.some(target => target?.id === id) ?? false;
  }
  suppliesPosition(x: number, y: number): boolean {
    const state = this.snapshot();
    return !this.destroyed && state.enabled && state.supply && isInsideShootingRange(this.metrics, x, y);
  }
  prepareHostStep(delta: number, now: number): void {
    if (this.destroyed || !this.authoritative) return;
    if (this.navigation) {
      const present = new Set(this.getPlayerIds());
      for (const id of present) if (!this.allyFlowFields.has(id)) {
        this.allyFlowFields.set(id, EnemyFlowFieldService.fromView(
          this.navigation.registerField(allyFlowFieldId(id), { goalMode: 'dynamic' })));
      }
      for (const [id, field] of this.allyFlowFields) if (!present.has(id)) {
        field.destroy(); this.navigation.unregisterField(allyFlowFieldId(id)); this.allyFlowFields.delete(id);
      }
    }
    this.navigation?.advance(delta);
    this.intents?.update(this.enemies.getAllEnemies().filter(enemy => enemy.faction === 'allied'), now);
    this.necromancy?.hostUpdate(now, delta);
    this.pinTargets();
  }
  finishHostStep(now: number): void {
    if (this.destroyed || !this.authoritative) return;
    this.runtime.finishHostStep(now);
    this.pinTargets();
    this.enemies.syncHostVisuals();
  }
  private pinTargets(): void {
    this.runtime.snapshot().targets.forEach((target, slot) => {
      const enemy = target ? this.enemies.getEnemy(target.id) : undefined;
      if (!enemy) return;
      const [gx, gy] = SHOOTING_RANGE.targets[slot];
      const point = worldCellCenter(this.metrics, gx, gy);
      const body = enemy.sprite.body as Phaser.Physics.Arcade.Body;
      body.reset(point.x, point.y);
      body.moves = false;
      enemy.stopMovement();
      enemy.setWalking(false);
    });
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopObserving();
    this.runtime.destroy();
    this.necromancy?.clear();
    this.necromancy?.setCorpseSink(null);
    this.intents?.clear();
    this.ground?.destroy();
    for (const field of this.allyFlowFields.values()) field.destroy();
    this.allyFlowFields.clear();
    this.navigation?.destroy();
    this.enemies.destroy();
    this.replica = null;
  }
}
