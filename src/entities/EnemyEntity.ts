import * as Phaser from 'phaser';
import { GenericWeapon } from '../loadout/GenericWeapon';
import { WEAPON_CONFIGS, type WeaponConfig } from '../loadout/LoadoutConfig';
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
  type CoopDefenseEnemyWeaponTargetMode,
  type ResolvedCoopDefenseEnemyConfig,
} from '../config/coopDefenseEnemies';
import type { SyncedEnemyState } from '../types';
import { EntityBurnRenderer, MAX_VISUAL_BURN_STACKS } from '../effects/EntityBurnRenderer';

export type EnemyFaction = 'hostile' | 'allied';

export interface EnemyAttackWeapon {
  readonly weapon: BaseWeapon;
  readonly targetMode: CoopDefenseEnemyWeaponTargetMode;
  readonly minimumFireDurationMs: number;
  readonly playerMeleeWindupMs: number;
}

export class EnemyEntity {
  // Bild zeigt nach Norden – Offset um Aim-Angle (0 = rechts) korrekt darzustellen.
  private static readonly ROTATION_OFFSET = Math.PI / 2;

  readonly id: string;
  readonly sprite: Phaser.GameObjects.Image;
  readonly kind: CoopDefenseEnemyKind;
  readonly faction: EnemyFaction;
  readonly ownerId?: string;
  readonly ownerColor?: number;

  private readonly authoritative: boolean;
  private readonly config: ResolvedCoopDefenseEnemyConfig;
  private readonly attackWeapons: readonly EnemyAttackWeapon[];
  private hpBarBg: Phaser.GameObjects.Rectangle | null = null;
  private hpBarFg: Phaser.GameObjects.Rectangle | null = null;
  private bossAura: Phaser.GameObjects.Ellipse | null = null;
  private bossRing: Phaser.GameObjects.Ellipse | null = null;
  private bossLabel: Phaser.GameObjects.Text | null = null;
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
  private burnRenderer: EntityBurnRenderer | null = null;
  private ownerRing: Phaser.GameObjects.Ellipse | null = null;
  private burnStacks = 0;
  private moveSpeedMultiplier = 1;
  private burrowed = false;

  constructor(
    scene: Phaser.Scene,
    id: string,
    x: number,
    y: number,
    authoritative: boolean,
    kind: CoopDefenseEnemyKind,
    config: ResolvedCoopDefenseEnemyConfig,
    faction: EnemyFaction = 'hostile',
    ownerId?: string,
    ownerColor?: number,
  ) {
    this.id = id;
    this.kind = kind;
    this.faction = faction;
    this.ownerId = ownerId;
    this.ownerColor = ownerColor;
    this.authoritative = authoritative;
    this.config = config;
    this.attackWeapons = authoritative ? this.createWeapons() : [];
    this.maxHp = this.config.maxHp;
    this.currentHp = this.maxHp;
    this.targetX = x;
    this.targetY = y;

    this.sprite = scene.add.image(x, y, this.config.imageKey);
    this.sprite.setDisplaySize(this.config.size, this.config.size);
    this.sprite.setDepth(DEPTH.PLAYERS - 0.05);
    if (faction === 'allied') {
      this.sprite.setTint(0x89d66d);
      this.ownerRing = scene.add.ellipse(x, y + this.config.size * 0.22, this.config.size * 1.15, this.config.size * 0.52, 0x000000, 0)
        .setStrokeStyle(2, ownerColor ?? 0x80ff80, 0.95)
        .setDepth(DEPTH.PLAYERS - 0.08);
    } else if (this.config.color !== undefined) {
      this.sprite.setTint(this.config.color);
    }
    if (faction === 'hostile') this.createBossDecorations(scene);

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
      this.hpBarFg.width = this.getHpBarWidth() * ratio;
    }
    const color = ratio > 0.5 ? COLORS.RED_2 : ratio > 0.25 ? COLORS.RED_3 : COLORS.RED_4;
    this.hpBarFg?.setFillStyle(color);

    if (((this.faction === 'allied' || !this.config.isBoss) && this.currentHp >= this.maxHp) || this.currentHp <= 0) {
      this.destroyHpBars();
    }
  }

  getHp(): number {
    return this.currentHp;
  }

  getMaxHp(): number {
    return this.maxHp;
  }

  updateBurnStacks(stacks: number): void {
    const nextStacks = Math.max(0, Math.floor(stacks));
    this.burnStacks = nextStacks;
    if (nextStacks <= 0) {
      this.burnRenderer?.destroy();
      this.burnRenderer = null;
      return;
    }
    if (!this.burnRenderer) this.burnRenderer = new EntityBurnRenderer(this.sprite.scene);
    this.syncBurnEffect();
  }

  getMoveSpeed(): number {
    return this.config.moveSpeed * this.moveSpeedMultiplier;
  }

  setMoveSpeedMultiplier(multiplier: number): void {
    this.moveSpeedMultiplier = Math.max(0, multiplier);
  }

  getCollisionRadius(): number {
    return this.config.size * 0.5;
  }

  isBurrowed(): boolean {
    return this.burrowed;
  }

  /**
   * Setzt den Einbuddel-Zustand. Unter der Erde ist der Gegner – genau wie ein eingebuddelter
   * Spieler – komplett unsichtbar; nur die Buddel-Partikel verraten seine Position.
   * Liefert true, wenn sich der Zustand geaendert hat (Trigger fuer die Buddel-Visuals).
   */
  setBurrowed(burrowed: boolean): boolean {
    if (this.burrowed === burrowed) return false;
    this.burrowed = burrowed;
    this.sprite.setVisible(!burrowed);
    this.ownerRing?.setVisible(!burrowed);
    this.bossAura?.setVisible(!burrowed);
    this.bossRing?.setVisible(!burrowed);
    this.bossLabel?.setVisible(!burrowed);
    if (burrowed) this.destroyHpBars();
    this.syncBar();
    return true;
  }

  isBoss(): boolean {
    return this.config.isBoss === true;
  }

  getAttackWeapons(): readonly EnemyAttackWeapon[] {
    return this.attackWeapons;
  }

  getObstacleAttackDelayMs(): number {
    return this.config.obstacleAttackDelayMs;
  }

  isWeaponReady(weapon: BaseWeapon, now: number): boolean {
    return !weapon.isOnCooldown(now);
  }

  recordWeaponUse(weapon: BaseWeapon, now: number): void {
    weapon.recordUse(now);
    weapon.addSpread();
  }

  decayWeaponSpread(delta: number, now: number): void {
    for (const attackWeapon of this.attackWeapons) {
      attackWeapon.weapon.decaySpread(delta, now);
    }
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
    this.syncBossDecorations();
    this.syncBurnEffect();
    if (!this.shouldShowHpBars()) {
      this.destroyHpBars();
      return;
    }

    this.ensureHpBars();
    if (!this.hpBarBg || !this.hpBarFg) return;
    const x = this.sprite.x;
    const hpBarWidth = this.getHpBarWidth();
    const y = this.sprite.y + this.getHpBarOffsetY();
    this.hpBarBg.setPosition(x, y);
    this.hpBarFg.setPosition(x - hpBarWidth * 0.5, y);
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
      burnStacks: Math.min(this.burnStacks, MAX_VISUAL_BURN_STACKS),
      faction: this.faction,
      burrowed: this.burrowed,
      ownerId: this.ownerId,
      ownerColor: this.ownerColor,
    };
  }

  destroy(): void {
    this.destroyHpBars();
    this.burnRenderer?.destroy();
    this.burnRenderer = null;
    this.ownerRing?.destroy();
    this.ownerRing = null;
    this.bossAura?.destroy();
    this.bossRing?.destroy();
    this.bossLabel?.destroy();
    this.sprite.destroy();
  }

  private syncBurnEffect(): void {
    this.burnRenderer?.sync(
      this.sprite.x,
      this.sprite.y,
      this.config.size,
      this.burnStacks,
      this.sprite.visible && this.currentHp > 0,
    );
  }

  private shouldShowHpBars(): boolean {
    if (this.burrowed) return false;
    return this.currentHp > 0 && (
      (this.faction === 'hostile' && this.config.isBoss === true)
      || (this.currentHp < this.maxHp && Date.now() <= this.hpBarVisibleUntilMs)
    );
  }

  private ensureHpBars(): void {
    if (this.hpBarBg && this.hpBarFg) return;
    const x = this.sprite.x;
    const hpBarWidth = this.getHpBarWidth();
    const y = this.sprite.y + this.getHpBarOffsetY();
    this.hpBarBg = this.sprite.scene.add.rectangle(x, y, hpBarWidth, HP_BAR_HEIGHT, 0x333333);
    this.hpBarBg.setDepth(DEPTH.SMOKE + 0.5);
    this.hpBarFg = this.sprite.scene.add.rectangle(x, y, hpBarWidth, HP_BAR_HEIGHT, COLORS.RED_2);
    this.hpBarFg.setOrigin(0, 0.5);
    this.hpBarFg.setDepth(DEPTH.SMOKE + 0.6);
  }

  private destroyHpBars(): void {
    this.hpBarBg?.destroy();
    this.hpBarFg?.destroy();
    this.hpBarBg = null;
    this.hpBarFg = null;
  }

  private getHpBarWidth(): number {
    return this.faction === 'hostile' && this.config.isBoss ? Math.max(76, this.config.size * 1.55) : HP_BAR_WIDTH;
  }

  private getHpBarOffsetY(): number {
    return this.faction === 'hostile' && this.config.isBoss ? this.config.size * 0.5 + 12 : HP_BAR_OFFSET_Y;
  }

  private createBossDecorations(scene: Phaser.Scene): void {
    if (!this.config.isBoss) return;

    this.bossAura = scene.add.ellipse(
      this.sprite.x,
      this.sprite.y + this.config.size * 0.2,
      this.config.size * 1.45,
      this.config.size * 0.72,
      0x6d1026,
      0.38,
    ).setDepth(DEPTH.PLAYERS - 0.08);
    this.bossRing = scene.add.ellipse(
      this.sprite.x,
      this.sprite.y + this.config.size * 0.2,
      this.config.size * 1.7,
      this.config.size * 0.88,
      0x000000,
      0,
    ).setStrokeStyle(3, COLORS.GOLD_1, 0.9).setDepth(DEPTH.PLAYERS - 0.07);
    this.bossLabel = scene.add.text(
      this.sprite.x,
      this.sprite.y - this.config.size * 0.5 - 11,
      `BOSS · ${(this.config.displayName ?? 'Boss').toUpperCase()}`,
      {
        fontSize: '13px',
        fontFamily: 'monospace',
        fontStyle: 'bold',
        color: '#ffd166',
        stroke: '#33000d',
        strokeThickness: 4,
      },
    ).setOrigin(0.5, 1).setDepth(DEPTH.PLAYERS + 2);
  }

  private syncBossDecorations(): void {
    this.ownerRing?.setPosition(this.sprite.x, this.sprite.y + this.config.size * 0.22);
    if (!this.config.isBoss) return;
    const auraY = this.sprite.y + this.config.size * 0.2;
    this.bossAura?.setPosition(this.sprite.x, auraY);
    this.bossRing?.setPosition(this.sprite.x, auraY);
    this.bossLabel?.setPosition(this.sprite.x, this.sprite.y - this.config.size * 0.5 - 11);
  }

  private createWeapons(): readonly EnemyAttackWeapon[] {
    return this.config.weapons.map((configuredWeapon) => {
      const baseConfig = WEAPON_CONFIGS[configuredWeapon.weaponId as keyof typeof WEAPON_CONFIGS];
      if (!baseConfig) {
        throw new Error(`Missing weapon config for coop-defense enemy weapon: ${configuredWeapon.weaponId}`);
      }

      return {
        weapon: new GenericWeapon(this.resolveEnemyWeaponConfig(baseConfig, configuredWeapon.targetMode)),
        targetMode: configuredWeapon.targetMode,
        minimumFireDurationMs: configuredWeapon.minimumFireDurationMs ?? 0,
        playerMeleeWindupMs: configuredWeapon.playerMeleeWindupMs ?? 0,
      };
    });
  }

  private resolveEnemyWeaponConfig(
    config: WeaponConfig,
    targetMode: CoopDefenseEnemyWeaponTargetMode,
  ): WeaponConfig {
    if (targetMode !== 'players' || config.fire.type !== 'projectile') return config;

    return {
      ...config,
      rockDamageMult: 0,
      trainDamageMult: 0,
      fire: {
        ...config.fire,
        impactCloud: config.fire.impactCloud
          ? { ...config.fire.impactCloud, rockDamageMult: 0, trainDamageMult: 0 }
          : undefined,
        homing: config.fire.homing
          ? { ...config.fire.homing, targetTypes: this.faction === 'allied' ? ['enemies'] : ['players'] }
          : undefined,
      },
    };
  }
}
