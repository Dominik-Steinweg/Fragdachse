import * as Phaser from 'phaser';
import { GenericWeapon } from '../loadout/GenericWeapon';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { BaseWeapon } from '../loadout/BaseWeapon';
import {
  COLORS,
  DEPTH,
  ENEMY_HP_BAR_VISIBLE_MS,
  HP_BAR_HEIGHT,
  HP_BAR_OFFSET_Y,
  HP_BAR_WIDTH,
} from '../config';
import {
  type CoopDefenseEnemyKind,
  type ResolvedCoopDefenseEnemyConfig,
} from '../config/coopDefenseEnemies';
import type { SyncedEnemyState } from '../types';

export class EnemyEntity {
  // Bild zeigt nach Norden – Offset um Aim-Angle (0 = rechts) korrekt darzustellen.
  private static readonly ROTATION_OFFSET = Math.PI / 2;

  readonly id: string;
  readonly sprite: Phaser.GameObjects.Image;
  readonly kind: CoopDefenseEnemyKind;

  private readonly authoritative: boolean;
  private readonly config: ResolvedCoopDefenseEnemyConfig;
  private readonly weapon: BaseWeapon | null;
  private hpBarBg: Phaser.GameObjects.Rectangle | null = null;
  private hpBarFg: Phaser.GameObjects.Rectangle | null = null;
  private maxHp = 1;
  private currentHp = 0;
  private targetX: number;
  private targetY: number;
  private desiredVelocityX = 0;
  private desiredVelocityY = 0;
  private attackPauseUntil = 0;
  private nextAttackScanAt = 0;
  private currentAimAngle = 0;
  private targetAimAngle = 0;
  private hpBarVisibleUntilMs = 0;

  constructor(
    scene: Phaser.Scene,
    id: string,
    x: number,
    y: number,
    authoritative: boolean,
    kind: CoopDefenseEnemyKind,
    config: ResolvedCoopDefenseEnemyConfig,
  ) {
    this.id = id;
    this.kind = kind;
    this.authoritative = authoritative;
    this.config = config;
    this.weapon = authoritative ? this.createWeapon() : null;
    this.maxHp = this.config.maxHp;
    this.currentHp = this.maxHp;
    this.targetX = x;
    this.targetY = y;

    this.sprite = scene.add.image(x, y, this.config.imageKey);
    this.sprite.setDisplaySize(this.config.size, this.config.size);
    this.sprite.setDepth(DEPTH.PLAYERS - 0.05);
    if (this.config.color !== undefined) {
      this.sprite.setTint(this.config.color);
    }

    if (authoritative) {
      scene.physics.add.existing(this.sprite);
      const body = this.body;
      body.setCircle(this.config.size * 0.5);
      body.setCollideWorldBounds(true);
      body.setBounce(0, 0);
      body.allowGravity = false;
    }

    this.faceAngle(0);
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
    if ((vx !== 0 || vy !== 0) && !this.isAttackMovementPaused(Date.now())) {
      this.faceAngle(Math.atan2(vy, vx));
    }
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
    const diff = Phaser.Math.Angle.Wrap(this.targetAimAngle - this.currentAimAngle);
    this.currentAimAngle = this.currentAimAngle + diff * factor;
    this.sprite.setRotation(this.currentAimAngle + EnemyEntity.ROTATION_OFFSET);
    this.syncBar();
  }

  setTargetRotation(aimAngle: number): void {
    this.targetAimAngle = aimAngle;
  }

  setHp(hp: number, maxHp: number = this.maxHp): void {
    this.maxHp = Math.max(1, maxHp);
    this.currentHp = Phaser.Math.Clamp(hp, 0, this.maxHp);
    if (this.currentHp < this.maxHp && this.currentHp > 0) {
      this.hpBarVisibleUntilMs = Date.now() + ENEMY_HP_BAR_VISIBLE_MS;
      this.ensureHpBars();
    }
    const ratio = this.maxHp > 0 ? this.currentHp / this.maxHp : 0;
    if (this.hpBarFg) {
      this.hpBarFg.width = HP_BAR_WIDTH * ratio;
    }
    const color = ratio > 0.5 ? COLORS.RED_2 : ratio > 0.25 ? COLORS.RED_3 : COLORS.RED_4;
    this.hpBarFg?.setFillStyle(color);

    if (this.currentHp >= this.maxHp || this.currentHp <= 0) {
      this.destroyHpBars();
    }
  }

  getHp(): number {
    return this.currentHp;
  }

  getMaxHp(): number {
    return this.maxHp;
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
    this.currentAimAngle = angle;
    this.targetAimAngle = angle;
    this.sprite.setRotation(angle + EnemyEntity.ROTATION_OFFSET);
  }

  getAimAngle(): number {
    return this.currentAimAngle;
  }

  syncBar(): void {
    if (!this.shouldShowHpBars()) {
      this.destroyHpBars();
      return;
    }

    this.ensureHpBars();
    if (!this.hpBarBg || !this.hpBarFg) return;
    const x = this.sprite.x;
    const y = this.sprite.y + HP_BAR_OFFSET_Y;
    this.hpBarBg.setPosition(x, y);
    this.hpBarFg.setPosition(x - HP_BAR_WIDTH * 0.5, y);
  }

  getNetSnapshot(): SyncedEnemyState {
    return {
      id: this.id,
      kind: this.kind,
      x: this.sprite.x,
      y: this.sprite.y,
      rot: this.currentAimAngle,
      hp: this.currentHp,
      maxHp: this.getMaxHp(),
    };
  }

  destroy(): void {
    this.destroyHpBars();
    this.sprite.destroy();
  }

  private shouldShowHpBars(): boolean {
    return this.currentHp > 0
      && this.currentHp < this.maxHp
      && Date.now() <= this.hpBarVisibleUntilMs;
  }

  private ensureHpBars(): void {
    if (this.hpBarBg && this.hpBarFg) return;
    const x = this.sprite.x;
    const y = this.sprite.y + HP_BAR_OFFSET_Y;
    this.hpBarBg = this.sprite.scene.add.rectangle(x, y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x333333);
    this.hpBarBg.setDepth(DEPTH.PLAYERS + 1);
    this.hpBarFg = this.sprite.scene.add.rectangle(x, y, HP_BAR_WIDTH, HP_BAR_HEIGHT, COLORS.RED_2);
    this.hpBarFg.setOrigin(0, 0.5);
    this.hpBarFg.setDepth(DEPTH.PLAYERS + 2);
  }

  private destroyHpBars(): void {
    this.hpBarBg?.destroy();
    this.hpBarFg?.destroy();
    this.hpBarBg = null;
    this.hpBarFg = null;
  }

  private createWeapon(): BaseWeapon {
    const weaponConfig = WEAPON_CONFIGS[this.config.weaponId as keyof typeof WEAPON_CONFIGS];
    if (!weaponConfig) {
      throw new Error(`Missing weapon config for coop-defense enemy weapon: ${this.config.weaponId}`);
    }

    return new GenericWeapon(weaponConfig);
  }
}