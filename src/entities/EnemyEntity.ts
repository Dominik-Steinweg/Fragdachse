import * as Phaser from 'phaser';
import {
  COLORS,
  COOP_DEFENSE_ENEMY_HP_MAX,
  COOP_DEFENSE_ENEMY_SIZE,
  DEPTH,
  HP_BAR_HEIGHT,
  HP_BAR_OFFSET_Y,
  HP_BAR_WIDTH,
} from '../config';
import type { SyncedEnemyState } from '../types';

export class EnemyEntity {
  readonly id: string;
  readonly sprite: Phaser.GameObjects.Arc;

  private readonly authoritative: boolean;
  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFg: Phaser.GameObjects.Rectangle;
  private currentHp = COOP_DEFENSE_ENEMY_HP_MAX;
  private targetX: number;
  private targetY: number;

  constructor(scene: Phaser.Scene, id: string, x: number, y: number, authoritative: boolean) {
    this.id = id;
    this.authoritative = authoritative;
    this.targetX = x;
    this.targetY = y;

    this.sprite = scene.add.circle(x, y, COOP_DEFENSE_ENEMY_SIZE * 0.5, COLORS.RED_2);
    this.sprite.setDepth(DEPTH.PLAYERS - 0.05);
    this.sprite.setStrokeStyle(2, 0x4a0000, 0.9);

    this.hpBarBg = scene.add.rectangle(x, y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x333333);
    this.hpBarBg.setDepth(DEPTH.PLAYERS + 1);
    this.hpBarFg = scene.add.rectangle(x, y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, COLORS.RED_2);
    this.hpBarFg.setOrigin(0, 0.5);
    this.hpBarFg.setDepth(DEPTH.PLAYERS + 2);

    if (authoritative) {
      scene.physics.add.existing(this.sprite);
      const body = this.body;
      body.setCircle(COOP_DEFENSE_ENEMY_SIZE * 0.5);
      body.setCollideWorldBounds(true);
      body.setBounce(0, 0);
      body.allowGravity = false;
    }

    this.syncBar();
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
    this.syncBar();
  }

  setTargetPosition(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  lerpStep(factor: number): void {
    if (this.authoritative) return;
    this.sprite.x = Phaser.Math.Linear(this.sprite.x, this.targetX, factor);
    this.sprite.y = Phaser.Math.Linear(this.sprite.y, this.targetY, factor);
    this.syncBar();
  }

  setHp(hp: number): void {
    this.currentHp = Phaser.Math.Clamp(hp, 0, COOP_DEFENSE_ENEMY_HP_MAX);
    const ratio = this.currentHp / COOP_DEFENSE_ENEMY_HP_MAX;
    this.hpBarFg.width = HP_BAR_WIDTH * ratio;
    const color = ratio > 0.5 ? COLORS.RED_2 : ratio > 0.25 ? COLORS.RED_3 : COLORS.RED_4;
    this.hpBarFg.setFillStyle(color);
  }

  getHp(): number {
    return this.currentHp;
  }

  syncBar(): void {
    const x = this.sprite.x;
    const y = this.sprite.y + HP_BAR_OFFSET_Y;
    this.hpBarBg.setPosition(x, y);
    this.hpBarFg.setPosition(x - HP_BAR_WIDTH * 0.5, y);
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
    this.hpBarBg.destroy();
    this.hpBarFg.destroy();
    this.sprite.destroy();
  }
}