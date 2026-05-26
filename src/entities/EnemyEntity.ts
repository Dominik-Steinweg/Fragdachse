import * as Phaser from 'phaser';
import { GenericWeapon } from '../loadout/GenericWeapon';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { BaseWeapon } from '../loadout/BaseWeapon';
import {
  COLORS,
  DEPTH,
  HP_BAR_HEIGHT,
  HP_BAR_OFFSET_Y,
  HP_BAR_WIDTH,
} from '../config';
import {
  COOP_DEFENSE_ENEMY_CONFIGS,
  type CoopDefenseEnemyConfig,
  type CoopDefenseEnemyKind,
} from './EnemyCatalog';
import type { SyncedEnemyState } from '../types';

export class EnemyEntity {
  readonly id: string;
  readonly sprite: Phaser.GameObjects.Arc;
  readonly kind: CoopDefenseEnemyKind;

  private readonly authoritative: boolean;
  private readonly config: CoopDefenseEnemyConfig;
  private readonly weapon: BaseWeapon | null;
  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFg: Phaser.GameObjects.Rectangle;
  private currentHp = 0;
  private targetX: number;
  private targetY: number;
  private desiredVelocityX = 0;
  private desiredVelocityY = 0;
  private attackPauseUntil = 0;
  private nextAttackScanAt = 0;

  constructor(
    scene: Phaser.Scene,
    id: string,
    x: number,
    y: number,
    authoritative: boolean,
    kind: CoopDefenseEnemyKind = 'dummy',
  ) {
    this.id = id;
    this.kind = kind;
    this.authoritative = authoritative;
    this.config = COOP_DEFENSE_ENEMY_CONFIGS[kind];
    this.weapon = authoritative ? this.createWeapon() : null;
    this.currentHp = this.config.maxHp;
    this.targetX = x;
    this.targetY = y;

    this.sprite = scene.add.circle(x, y, this.config.size * 0.5, COLORS.RED_2);
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
      body.setCircle(this.config.size * 0.5);
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

  setDesiredVelocity(vx: number, vy: number): void {
    if (!this.authoritative) return;
    this.desiredVelocityX = vx;
    this.desiredVelocityY = vy;
  }

  getDesiredVelocity(): { vx: number; vy: number } {
    return { vx: this.desiredVelocityX, vy: this.desiredVelocityY };
  }

  stopMovement(): void {
    this.setDesiredVelocity(0, 0);
    if (this.authoritative && this.sprite.body) {
      (this.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    }
  }

  lerpStep(factor: number): void {
    if (this.authoritative) return;
    this.sprite.x = Phaser.Math.Linear(this.sprite.x, this.targetX, factor);
    this.sprite.y = Phaser.Math.Linear(this.sprite.y, this.targetY, factor);
    this.syncBar();
  }

  setHp(hp: number): void {
    const maxHp = this.getMaxHp();
    this.currentHp = Phaser.Math.Clamp(hp, 0, maxHp);
    const ratio = maxHp > 0 ? this.currentHp / maxHp : 0;
    this.hpBarFg.width = HP_BAR_WIDTH * ratio;
    const color = ratio > 0.5 ? COLORS.RED_2 : ratio > 0.25 ? COLORS.RED_3 : COLORS.RED_4;
    this.hpBarFg.setFillStyle(color);
  }

  getHp(): number {
    return this.currentHp;
  }

  getMaxHp(): number {
    return this.config.maxHp;
  }

  getMoveSpeed(): number {
    return this.config.moveSpeed;
  }

  getWeapon(): BaseWeapon | null {
    return this.weapon;
  }

  isWeaponReady(now: number): boolean {
    return this.weapon !== null && !this.weapon.isOnCooldown(now);
  }

  recordWeaponUse(now: number): void {
    if (!this.weapon) return;
    this.weapon.recordUse(now);
    this.weapon.addSpread();
  }

  decayWeaponSpread(delta: number, now: number): void {
    this.weapon?.decaySpread(delta, now);
  }

  getAttackScanIntervalMs(): number {
    return this.config.attackScanIntervalMs;
  }

  canScanForAttack(now: number): boolean {
    return this.authoritative && now >= this.nextAttackScanAt;
  }

  scheduleNextAttackScan(now: number): void {
    this.nextAttackScanAt = now + this.config.attackScanIntervalMs;
  }

  pauseAttackMovement(now: number): void {
    this.attackPauseUntil = Math.max(this.attackPauseUntil, now + this.config.attackStopDurationMs);
    this.stopMovement();
  }

  isAttackMovementPaused(now: number): boolean {
    return this.authoritative && now < this.attackPauseUntil;
  }

  faceAngle(angle: number): void {
    this.sprite.setRotation(angle);
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
      maxHp: this.getMaxHp(),
    };
  }

  destroy(): void {
    this.hpBarBg.destroy();
    this.hpBarFg.destroy();
    this.sprite.destroy();
  }

  private createWeapon(): BaseWeapon {
    const weaponConfig = WEAPON_CONFIGS[this.config.weaponId as keyof typeof WEAPON_CONFIGS];
    if (!weaponConfig) {
      throw new Error(`Missing weapon config for coop-defense enemy weapon: ${this.config.weaponId}`);
    }

    return new GenericWeapon(weaponConfig);
  }
}