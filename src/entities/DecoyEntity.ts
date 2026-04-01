import Phaser from 'phaser';
import {
  PLAYER_SIZE, DEPTH, COLORS,
  ARMOR_BAR_HEIGHT, ARMOR_BAR_OFFSET_Y, ARMOR_BAR_WIDTH,
  ARMOR_COLOR,
  HP_BAR_WIDTH, HP_BAR_HEIGHT, HP_BAR_OFFSET_Y,
} from '../config';

export class DecoyEntity {
  readonly id: number;
  readonly ownerId: string;
  readonly sprite: Phaser.GameObjects.Image;

  private readonly colorHex: number;
  private readonly isEnemy: boolean;
  private hpBarBg: Phaser.GameObjects.Rectangle;
  private hpBarFg: Phaser.GameObjects.Rectangle;
  private armorBarBg: Phaser.GameObjects.Rectangle;
  private armorBarFg: Phaser.GameObjects.Rectangle;
  private targetX = 0;
  private targetY = 0;
  private targetRotation = 0;
  private currentHp = 0;
  private currentMaxHp = 1;
  private currentArmor = 0;
  private currentMaxArmor = 1;
  private glowFx: Phaser.FX.Glow | null = null;
  private anomalyTween: Phaser.Tweens.Tween | null = null;
  private anomalyState = { alpha: 0.92, outerStrength: 4.2 };

  private static readonly ROTATION_OFFSET = Math.PI / 2;

  constructor(
    private readonly scene: Phaser.Scene,
    id: number,
    ownerId: string,
    x: number,
    y: number,
    colorHex: number,
    isEnemy: boolean,
    enablePhysics: boolean,
  ) {
    this.id = id;
    this.ownerId = ownerId;
    this.colorHex = colorHex;
    this.isEnemy = isEnemy;
    this.targetX = x;
    this.targetY = y;

    this.sprite = scene.add.image(x, y, 'badger');
    this.sprite.setDisplaySize(PLAYER_SIZE, PLAYER_SIZE);
    this.sprite.setDepth(DEPTH.PLAYERS - 0.02);
    if (enablePhysics) {
      scene.physics.add.existing(this.sprite);
      const body = this.body;
      if (body) {
        body.setCircle(PLAYER_SIZE / 2);
        body.setCollideWorldBounds(true);
        body.setAllowGravity(false);
      }
    }

    this.sprite.preFX?.setPadding(20);
    this.glowFx = this.sprite.preFX?.addGlow(colorHex, 4, 0, false, 0.08, 16) ?? null;

    this.hpBarBg = scene.add.rectangle(x, y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x333333);
    this.hpBarBg.setDepth(DEPTH.PLAYERS + 1);
    this.hpBarFg = scene.add.rectangle(x - HP_BAR_WIDTH / 2, y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, isEnemy ? COLORS.RED_2 : 0x00cc44);
    this.hpBarFg.setOrigin(0, 0.5);
    this.hpBarFg.setDepth(DEPTH.PLAYERS + 2);

    this.armorBarBg = scene.add.rectangle(x, y + ARMOR_BAR_OFFSET_Y, ARMOR_BAR_WIDTH, ARMOR_BAR_HEIGHT, 0x333333);
    this.armorBarBg.setDepth(DEPTH.PLAYERS + 1);
    this.armorBarFg = scene.add.rectangle(x - ARMOR_BAR_WIDTH / 2, y + ARMOR_BAR_OFFSET_Y, ARMOR_BAR_WIDTH, ARMOR_BAR_HEIGHT, ARMOR_COLOR);
    this.armorBarFg.setOrigin(0, 0.5);
    this.armorBarFg.setDepth(DEPTH.PLAYERS + 2);

    this.startAnomalyTween();
    this.syncBar();
  }

  get body(): Phaser.Physics.Arcade.Body | null {
    return (this.sprite.body as Phaser.Physics.Arcade.Body | undefined) ?? null;
  }

  setPosition(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.sprite.setPosition(x, y);
    this.body?.reset(x, y);
    this.syncBar();
  }

  setTargetPosition(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  setRotation(rotation: number): void {
    this.targetRotation = rotation;
    this.sprite.rotation = rotation + DecoyEntity.ROTATION_OFFSET;
  }

  setTargetRotation(rotation: number): void {
    this.targetRotation = rotation;
  }

  lerpStep(factor: number): void {
    this.sprite.x = Phaser.Math.Linear(this.sprite.x, this.targetX, factor);
    this.sprite.y = Phaser.Math.Linear(this.sprite.y, this.targetY, factor);
    this.lerpRotation(factor);
    this.syncBar();
  }

  syncBar(): void {
    const x = this.sprite.x;
    const hpY = this.sprite.y + HP_BAR_OFFSET_Y;
    const armorY = this.sprite.y + ARMOR_BAR_OFFSET_Y;
    this.hpBarBg.setPosition(x, hpY);
    this.hpBarFg.setPosition(x - HP_BAR_WIDTH / 2, hpY);
    this.armorBarBg.setPosition(x, armorY);
    this.armorBarFg.setPosition(x - ARMOR_BAR_WIDTH / 2, armorY);
  }

  updateVitals(hp: number, maxHp: number, armor: number, maxArmor: number): void {
    this.currentHp = Math.max(0, hp);
    this.currentMaxHp = Math.max(1, maxHp);
    this.currentArmor = Math.max(0, armor);
    this.currentMaxArmor = Math.max(1, maxArmor);

    const hpRatio = Phaser.Math.Clamp(this.currentHp / this.currentMaxHp, 0, 1);
    this.hpBarFg.width = HP_BAR_WIDTH * hpRatio;
    const hpColor = this.isEnemy
      ? (hpRatio > 0.5 ? COLORS.RED_2 : hpRatio > 0.25 ? COLORS.RED_3 : COLORS.RED_4)
      : (hpRatio > 0.5 ? 0x00cc44 : hpRatio > 0.25 ? 0xffcc00 : 0xff3300);
    this.hpBarFg.setFillStyle(hpColor);

    const armorRatio = Phaser.Math.Clamp(this.currentArmor / this.currentMaxArmor, 0, 1);
    this.armorBarFg.width = ARMOR_BAR_WIDTH * armorRatio;
    const showArmor = this.currentArmor > 0;
    this.armorBarBg.setVisible(showArmor);
    this.armorBarFg.setVisible(showArmor);
  }

  private lerpRotation(factor: number): void {
    const current = this.sprite.rotation - DecoyEntity.ROTATION_OFFSET;
    const diff = Phaser.Math.Angle.Wrap(this.targetRotation - current);
    this.sprite.rotation = current + diff * factor + DecoyEntity.ROTATION_OFFSET;
  }

  private startAnomalyTween(): void {
    this.applyAnomalyVisual();
    this.anomalyTween = this.scene.tweens.add({
      targets: this.anomalyState,
      alpha: { from: 0.86, to: 0.98 },
      outerStrength: { from: 3.6, to: 5.4 },
      duration: 1350,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
      onUpdate: () => this.applyAnomalyVisual(),
    });
  }

  private applyAnomalyVisual(): void {
    this.sprite.setAlpha(this.anomalyState.alpha);
    this.hpBarBg.setAlpha(this.anomalyState.alpha * 0.92);
    this.hpBarFg.setAlpha(this.anomalyState.alpha);
    this.armorBarBg.setAlpha(this.anomalyState.alpha * 0.92);
    this.armorBarFg.setAlpha(this.anomalyState.alpha);
    if (this.glowFx) {
      this.glowFx.color = this.colorHex;
      this.glowFx.outerStrength = this.anomalyState.outerStrength;
    }
  }

  destroy(): void {
    this.anomalyTween?.stop();
    this.hpBarBg.destroy();
    this.hpBarFg.destroy();
    this.armorBarBg.destroy();
    this.armorBarFg.destroy();
    this.sprite.destroy();
  }
}