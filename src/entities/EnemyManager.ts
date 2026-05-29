import * as Phaser from 'phaser';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../config';
import { EnemyFlowFieldService } from '../systems/EnemyFlowFieldService';
import type { SyncedEnemyState } from '../types';
import { EnemyEntity } from './EnemyEntity';
import {
  resolveCoopDefenseEnemyConfigs,
  type CoopDefenseEnemyKind,
  type ResolvedCoopDefenseEnemyConfigs,
} from '../config/coopDefenseEnemies';

export class EnemyManager {
  private readonly scene: Phaser.Scene;
  private readonly resolvedConfigs: ResolvedCoopDefenseEnemyConfigs;
  private readonly enemies = new Map<string, EnemyEntity>();
  private nextEnemyIdSeq = 1;

  constructor(scene: Phaser.Scene, resolvedConfigs: ResolvedCoopDefenseEnemyConfigs = resolveCoopDefenseEnemyConfigs(1)) {
    this.scene = scene;
    this.resolvedConfigs = resolvedConfigs;
  }

  hostSpawnDummyAt(gridX: number, gridY: number, kind: CoopDefenseEnemyKind = 'zombie-badger'): EnemyEntity {
    const { x, y } = this.gridToWorld(gridX, gridY);
    const id = this.generateEnemyId(kind);
    const enemy = new EnemyEntity(this.scene, id, x, y, true, kind, this.resolvedConfigs[kind]);
    this.enemies.set(id, enemy);
    return enemy;
  }

  hostUpdateMovement(
    baseFlowFieldService: EnemyFlowFieldService | null,
    playerFlowFieldService: EnemyFlowFieldService | null,
    movementLocked: boolean,
    now: number,
  ): void {
    for (const enemy of this.enemies.values()) {
      const config = this.resolvedConfigs[enemy.kind];
      const flowFieldService = config.movementTarget === 'players'
        ? playerFlowFieldService ?? baseFlowFieldService
        : baseFlowFieldService;

      if (movementLocked || !flowFieldService || enemy.isAttackMovementPaused(now)) {
        enemy.stopMovement();
        continue;
      }

      const gridCell = flowFieldService.worldToGrid(enemy.sprite.x, enemy.sprite.y);
      if (!gridCell) {
        enemy.stopMovement();
        continue;
      }

      const integrationValue = flowFieldService.getIntegrationValueAt(gridCell.gridX, gridCell.gridY);
      if (integrationValue <= 0 || integrationValue >= EnemyFlowFieldService.INTEGRATION_INFINITY) {
        enemy.stopMovement();
        continue;
      }

      const vector = flowFieldService.getVectorAt(gridCell.gridX, gridCell.gridY);
      if (vector.x === 0 && vector.y === 0) {
        enemy.stopMovement();
        continue;
      }

      const speed = enemy.getMoveSpeed();
      enemy.setDesiredVelocity(vector.x * speed, vector.y * speed);
    }
  }

  getNetSnapshot(): SyncedEnemyState[] {
    return [...this.enemies.values()]
      .map((enemy) => enemy.getNetSnapshot())
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  getEnemy(id: string): EnemyEntity | undefined {
    return this.enemies.get(id);
  }

  getAllEnemies(): EnemyEntity[] {
    return [...this.enemies.values()];
  }

  hasEnemy(id: string): boolean {
    return this.enemies.has(id);
  }

  applyDamage(id: string, damage: number): { died: boolean; remainingHp: number } | null {
    const enemy = this.enemies.get(id);
    if (!enemy || damage <= 0) return null;

    const remainingHp = Math.max(0, enemy.getHp() - damage);
    enemy.setHp(remainingHp);
    if (remainingHp > 0) {
      return { died: false, remainingHp };
    }

    enemy.destroy();
    this.enemies.delete(id);
    return { died: true, remainingHp: 0 };
  }

  syncHostVisuals(): void {
    for (const enemy of this.enemies.values()) {
      enemy.syncBar();
    }
  }

  applySnapshot(snapshot: readonly SyncedEnemyState[]): void {
    const activeIds = new Set(snapshot.map((enemy) => enemy.id));

    for (const [id, enemy] of this.enemies) {
      if (activeIds.has(id)) continue;
      enemy.destroy();
      this.enemies.delete(id);
    }

    for (const remote of snapshot) {
      let enemy = this.enemies.get(remote.id);
      if (!enemy) {
        enemy = new EnemyEntity(this.scene, remote.id, remote.x, remote.y, false, remote.kind, this.resolvedConfigs[remote.kind]);
        enemy.faceAngle(remote.rot);
        this.enemies.set(remote.id, enemy);
      }
      enemy.setHp(remote.hp, remote.maxHp);
      enemy.setTargetPosition(remote.x, remote.y);
      enemy.setTargetRotation(remote.rot);
    }
  }

  updateClientInterpolation(factor: number): void {
    for (const enemy of this.enemies.values()) {
      enemy.lerpStep(factor);
    }
  }

  destroy(): void {
    for (const enemy of this.enemies.values()) {
      enemy.destroy();
    }
    this.enemies.clear();
    this.nextEnemyIdSeq = 1;
  }

  private generateEnemyId(kind: CoopDefenseEnemyKind): string {
    return `coop-${kind}-${this.nextEnemyIdSeq++}`;
  }

  private gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE * 0.5,
      y: ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE * 0.5,
    };
  }
}
