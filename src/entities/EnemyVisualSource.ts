import type Phaser from 'phaser';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type { SyncedEnemyState } from '../types';

/** Read-only capabilities needed by scene-lifetime enemy presentation consumers. */
export interface EnemyVisualSource {
  readonly id: string;
  readonly kind: CoopDefenseEnemyKind;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly getHp: () => number;
  readonly getNetSnapshot: () => SyncedEnemyState;
}
