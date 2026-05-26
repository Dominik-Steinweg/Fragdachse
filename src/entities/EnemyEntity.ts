import * as Phaser from 'phaser';
import {
  COLORS,
  COOP_DEFENSE_ENEMY_HP_MAX,
  COOP_DEFENSE_ENEMY_SIZE,
  DEPTH,
} from '../config';
import type { SyncedEnemyState } from '../types';

export class EnemyEntity {
  readonly id: string;
  readonly sprite: Phaser.GameObjects.Rectangle;

  private readonly authoritative: boolean;
  private currentHp = COOP_DEFENSE_ENEMY_HP_MAX;
  private targetX: number;
  private targetY: number;

  constructor(scene: Phaser.Scene, id: string, x: number, y: number, authoritative: boolean) {
    this.id = id;
    this.authoritative = authoritative;
    this.targetX = x;
    this.targetY = y;

    this.sprite = scene.add.rectangle(x, y, COOP_DEFENSE_ENEMY_SIZE, COOP_DEFENSE_ENEMY_SIZE, COLORS.RED_2);
    this.sprite.setDepth(DEPTH.PLAYERS - 0.05);
    this.sprite.setStrokeStyle(2, 0x4a0000, 0.9);

    if (authoritative) {
      scene.physics.add.existing(this.sprite);
      const body = this.body;
      body.setSize(COOP_DEFENSE_ENEMY_SIZE, COOP_DEFENSE_ENEMY_SIZE);
      body.setImmovable(true);
      body.moves = false;
      body.pushable = false;
      body.allowGravity = false;
    }
  }

  get body(): Phaser.Physics.Arcade.Body {
    return this.sprite.body as Phaser.Physics.Arcade.Body;
  }

  setPosition(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.sprite.setPosition(x, y);
    if (this.authoritative) {
      this.body.reset(x, y);
    }
  }

  setTargetPosition(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  lerpStep(factor: number): void {
    if (this.authoritative) return;
    this.sprite.x = Phaser.Math.Linear(this.sprite.x, this.targetX, factor);
    this.sprite.y = Phaser.Math.Linear(this.sprite.y, this.targetY, factor);
  }

  setHp(hp: number): void {
    this.currentHp = Phaser.Math.Clamp(hp, 0, COOP_DEFENSE_ENEMY_HP_MAX);
  }

  getNetSnapshot(): SyncedEnemyState {
    return {
      id: this.id,
      x: this.sprite.x,
      y: this.sprite.y,
      hp: this.currentHp,
      maxHp: COOP_DEFENSE_ENEMY_HP_MAX,
    };
  }

  destroy(): void {
    this.sprite.destroy();
  }
}